# P3a：API 从 Worker（D1）切到 Coolify（Node + PostgreSQL）

> 前提：
> - P1（分享页已在 Coolify）、P2（SPA 在 Pages，Worker 在 `api.nanako.org`）都已完成。
> - **P3b 已合并并部署到 Coolify。** 只有 P3a 时，PostgreSQL 上并发的改判、撤销、加分会互相覆盖分数
>   （D1 的批处理串行执行，PG 的不是）；P3b 把这些写法改成了 SQL 内的相对更新加行锁。
>   在 P3b 上线之前**不要**做下面的切换。

**这次切换用户无感**：`api.nanako.org`、cookie 名、`SESSION_SECRET` 都不变，没人需要重新登录。
只有 30–45 分钟的只读窗口，期间能看不能写。

## 为什么敢切

- Node 端跑的是 **Worker 原封不动的代码**（`worker/*.ts` 直接打包进 `server/`），数据库经由
  一个 D1 兼容适配层（`server/src/db/d1.ts`）访问 PostgreSQL。
- 整套 worker 测试**在 D1 和 PostgreSQL 上各跑一遍**，全部通过（`npm run test:worker` / `npm run test:pg`）。
- PG 的表结构是 D1 的忠实移植：时间仍是 `YYYY-MM-DD HH:MM:SS` 文本、标志仍是 0/1，API 输出逐字节相同。
- 本地完整演练过：真实 API 造数据 → 导出 → 导入并校验 → 新旧两套 API 的 16 个公开接口**完全一致** → 新库上写入正常。

## 准备（不影响线上）

1. **变量**：Coolify 的 `app` 需要下面这些（都标成 runtime-only）。找不到明文的 secret，在切换前一天
   轮换并**同时**更新 Worker（`wrangler secret put …`）：
   - `OAUTH_CLIENT_SECRET`、`SESSION_SECRET`（P2 生成的那个）、`AI_API_KEY`；
   - `ADMIN_SUBJECT_IDS` 或 `ADMIN_USERNAMES`：和 Worker 保持一致（compose 里 `ADMIN_USERNAMES`
     默认就是 Worker 现在的值）。登录时按它补发管理员，管理员永远不会被删光。

   `API_HOST` 为空时这些都用不到：`app` 根本不构建 API，分享页照常；`API_HOST` 设了但缺 secret 时，
   api 的主机名回 503、`/status` 显示 `"api": "misconfigured"`，分享页也不受影响。
2. **备份**：在 `compose.yaml` 里启用 `pg-backup`（取消注释），配好一个 R2 bucket 的只写密钥和
   `BACKUP_PASSPHRASE`（离线保存）。切换前手动跑一次，并**演练一次恢复**。恢复到别的集群时，库必须用
   `--locale=C.UTF-8` 创建（文本按码点排序，和 D1 一致），否则 `migrate` 会拒绝运行。
3. **部署到 Coolify**：`API_HOST` 留空、`JOBS_ENABLED=false`。此时 `app` 只服务分享页，数据库是空的。
4. **Tunnel**：加 `api-next.nanako.org` → `http://app:8787`（预检用）。
5. **彩排一次**（强烈建议，用真实数据）：按下面「切换」的第 T+3–T+10 步做一遍（不开只读、不顺延截止时间）；
   做完后清空数据库，`API_HOST` 改回空：
   ```bash
   docker compose exec postgres psql -U edg -d edg -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
   docker compose run --rm migrate
   ```

## 切换（选一个没人约局的时间，比如工作日凌晨）

| 时刻 | 步骤 |
|---|---|
| T−5 | 打开一次网站（触发 `GET /api/config` 上的惰性判决），让只读前已经过期的案件先判掉 |
| T0 | **Worker 只读**：`wrangler.toml` 的 `[vars]` 加 `READ_ONLY = "1"`，部署。之后所有写请求 503，惰性任务和 Cron 停止 |
| T+1 | 等 60 秒以上（比最长的在途请求更久：AI 调用 20 秒 × 2） |
| T+2 | **顺延截止时间（在 D1 上，导出之前）**：只读期间被告没法写陈述，把只读开始后到窗口结束前到期的案件顺延（按实际窗口调整 `+1 hour`）：<br>`npx wrangler d1 execute edg-credit --remote --command "UPDATE records SET deadline_at = datetime(deadline_at, '+1 hour') WHERE status = 'awaiting_statement' AND deadline_at >= datetime('now', '-5 minutes') AND deadline_at < datetime('now', '+1 hour')"`<br>下限排除只读之前就已过期的案件；在 D1 上做，导出的数据和只读的 Worker 才一致，T+10 的对拍才有意义 |
| T+3 | **导出**（在你本机，已 `wrangler login`）：`node scripts/d1-export.mjs export/`。只读，逐表 SELECT |
| T+5 | **导入**：把 `export/` 传到 Coolify 主机，然后 `docker compose run --rm -v "$PWD/export:/import:ro" migrate node server/dist/import-d1-main.js /import`。导入在一个事务里完成并逐表回读校验，任何不一致整体回滚 |
| T+8 | **预检**：Coolify 里设 `API_HOST=api-next.nanako.org,api.nanako.org`（`JOBS_ENABLED` 仍为 `false`），重新部署。`api.nanako.org` 此时还解析到 Worker，先列进来，T+13 切 DNS 时就不用再部署 |
| T+10 | **对拍**：`node scripts/compare-api.mjs https://api.nanako.org https://api-next.nanako.org`，期望 `N/N endpoints identical` |
| T+12 | **go / no-go** |
| T+13 | Cloudflare：删除 Worker 的 Custom Domain `api.nanako.org`，**紧接着**在 Tunnel 里加 `api.nanako.org` → `http://app:8787`。两步之间请求会失败，尽量在几秒内做完；这期间若有解析器查到 NXDOMAIN 可能会缓存一会儿 |
| T+16 | 冒烟：登录状态还在、能立案 / 撤案、约局能报名；`https://api.nanako.org/status` 返回 `"ok": true` |
| T+30 | 宣布完成。Tunnel 里删掉 `api-next`；Coolify 里 `API_HOST=api.nanako.org`、`JOBS_ENABLED=true`，重新部署（先停后起，中断 30–60 秒）。在这之前惰性任务照常随页面加载运行，不开定时器也不会漏判 |

## 回滚

- **T+13 之前**（新库还没接过真实写入）：Worker 去掉 `READ_ONLY` 并部署即可，PG 的数据直接丢弃。
  T+2 的顺延留在 D1 上无害（本来就是给只读窗口补的时间）。
- **T+13 之后**：只往前修。D1 那边的数据停在 T0，PG 已经有了新写入，没有安全的反向同步。
  这之后用 `APP_TAG` 回滚镜像时，只能回到 P3a 及以后的 sha：更早的镜像没有 API，`api.nanako.org` 会 404。
- Worker 保持只读部署 30 天（D1 当冷备份），`export/` 加密后存一份，保留 90 天。

## 之后

- 外部监控加一条：`https://api.nanako.org/status`（关键字 `"ok":true`），告警发 Discord webhook。
- `/healthz` 只代表进程活着，给 Docker / Coolify 用；`/status` 才检查数据库（只报 `ok` / `error`，细节在容器日志里）。
