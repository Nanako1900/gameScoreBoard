# API 从 Worker（D1）迁到 Coolify（Node + PostgreSQL）

> 前提：
> - Coolify 上的整套服务已经起来，`API_HOST` 留空、`JOBS_ENABLED=false`，数据库是空的
>   （见 [DEPLOY-COOLIFY.md](DEPLOY-COOLIFY.md)）。
> - **P3b 已在镜像里**（`main` 上的镜像都包含）。只有 P3a 时，PostgreSQL 上并发的改判、撤销、加分会互相覆盖分数
>   （D1 的批处理串行执行，PG 的不是）；P3b 把这些写法改成了 SQL 内的相对更新加行锁。

两种顺序选一种：

- **没人在用**（现在的情况）：走下面的「简化顺序」。不需要先把 Worker 挂到 `capi.`（DEPLOY-PAGES 的第 2 步），
  也不需要按分钟排的只读窗口。大家在新网址重新登录一次。
- **有人在用、要求无感**：走最后的「只读窗口切换」。

## 为什么敢切

- Node 端跑的是 **Worker 原封不动的代码**（`worker/*.ts` 直接打包进 `server/`），数据库经由
  一个 D1 兼容适配层（`server/src/db/d1.ts`）访问 PostgreSQL。
- 整套 worker 测试**在 D1 和 PostgreSQL 上各跑一遍**，全部通过（`npm run test:worker` / `npm run test:pg`）。
- PG 的表结构是 D1 的忠实移植：时间仍是 `YYYY-MM-DD HH:MM:SS` 文本、标志仍是 0/1，API 输出逐字节相同。
- 本地完整演练过：真实 API 造数据 → 导出 → 导入并校验 → 新旧两套 API 的 16 个公开接口**完全一致** → 新库上写入正常。

## 导出与导入（两种顺序共用）

**导出**（在你本机）：需要 Node 22 以上和已登录的 wrangler。

```bash
nvm use 22
npx wrangler login
node scripts/d1-export.mjs export/
```

只读，逐表 SELECT，每张表一个 JSON 文件（含空表），共 10 个。

**导入**（在 Coolify 服务器上，需要 SSH）：在 `app` 容器里运行镜像自带的导入脚本，容器里已经有 `DATABASE_URL`。

```bash
# 本机：把导出目录传到服务器
scp -r export/ <你的服务器>:/tmp/edg-export
```

```bash
# 服务器上：找到这套服务的 app 容器（Coolify 一般命名为 app-<资源 uuid>，uuid 在 Coolify 页面的网址里）
docker ps --format '{{.Names}}' | grep '^app-'
APP=app-<资源 uuid>
docker cp /tmp/edg-export "$APP":/tmp/import
docker exec "$APP" node server/dist/import-d1-main.js /tmp/import
```

导入在一个事务里完成，导完逐表回读做 sha256 校验，任何不一致整体回滚，不会留下半截数据。
它只接受空库：任何一张表里已经有行就直接报错退出。所以**一定要在填 `API_HOST` 之前导入**——
API 一打开，有人登录就会写进 `users`。

需要重来时，先清空数据库再让 `migrate` 重建表（在 Coolify 里 Redeploy 即可，`migrate` 每次部署都会跑）：

```bash
PG=$(docker ps --format '{{.Names}}' | grep '^postgres-<资源 uuid>')
docker exec "$PG" psql -U edg -d edg -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
```

## 没人在用时：简化顺序（推荐）

1. **后端域名**：Cloudflare DNS 加 A 记录 `capi` → 服务器公网 IP（DNS only），Coolify 里 `app` 加域名
   `https://capi.nanako.org`、端口 **8787**，Redeploy（见 [DEPLOY-COOLIFY.md](DEPLOY-COOLIFY.md)「给 `app` 配域名」）。
   此时 `https://capi.nanako.org` 返回 404，证书有效即可——API 还没打开。
2. **冻结 D1**（建议）：Cloudflare 后台 → Worker `gamescoreboard-bn` → Settings → Variables and Secrets 加
   `READ_ONLY` = `1`，保存并 Deploy。之后 D1 不会再变（包括爬虫打开页面触发的惰性回血、判决）。
3. **导出 D1、导入 PG**：见上一节。
4. **打开 API**：Coolify 里填好下面这些，Redeploy：

   | 变量 | 值 |
   |---|---|
   | `API_HOST` | `capi.nanako.org` |
   | `OAUTH_CLIENT_SECRET` | Nanako OAuth 的 client secret。找不到明文就在 IdP 重新生成（旧 Worker 反正已经不用了） |
   | `SESSION_SECRET` | 新生成：`openssl rand -base64 48`，存进密码管理器 |
   | `AI_API_KEY` | AI 服务的 key |
   | `ADMIN_SUBJECT_IDS` | 你的 `users.id`（建议填；不填则按 `ADMIN_USERNAMES` 的默认值授予） |

   `APP_URL`、`FRONTEND_URL`、`FRONTEND_ORIGIN`、`HOST_ONLY_COOKIES` 的默认值已经对了，不用填。
   填了 `API_HOST` 但缺 secret 时，`capi.nanako.org` 回 503、`/status` 显示 `"api": "misconfigured"`。
5. **OAuth 回调**：在 nanako.org 的 OAuth 后台给这个 client 登记 `https://capi.nanako.org/auth/callback`。
6. **对拍**：在本机执行，期望 `N/N endpoints identical`（D1 已冻结，两边数据相同）：

   ```bash
   node scripts/compare-api.mjs https://score.nanako.org https://capi.nanako.org
   ```

   例外：D1 里如果有已过截止时间、还没判决的案件，只读的 Worker 不会再判它们，而 Node 一侧第一次被访问时
   会把它们判掉，相关接口（案件列表、分数）就会不一致，这是预期的。其余接口应当完全一致。

7. **前端**：按 [DEPLOY-PAGES.md](DEPLOY-PAGES.md) 第 2 步建 Pages 项目（`npm run build:pages`、输出 `dist`、
   `VITE_API_BASE=https://capi.nanako.org`，建议加 `NODE_VERSION=22`），Custom domain `community.nanako.org`。
   DEPLOY-PAGES 里第 4 步以后（把 Worker 挂到 `capi.`）都跳过。
8. **冒烟**：打开 `https://community.nanako.org` 登录，立案 / 撤案、约局报名各走一遍；
   `https://capi.nanako.org/status` 返回 `"ok": true`。
9. **定时任务**：Coolify 里 `JOBS_ENABLED=true`，Redeploy。之后回血、逾期判决、周报都按时跑，不再依赖有人打开网页。
10. **清点裁判**：Coolify → `postgres` 的终端里执行，把以前自封的裁判清掉（详见 [DEPLOY-DISCORD.md](DEPLOY-DISCORD.md) §6）：

    ```bash
    psql -U edg -d edg -c "SELECT id, username, display_name, is_participant FROM users WHERE is_judge = 1 AND is_admin = 0;"
    ```

11. **旧网址**：Worker 保持 `READ_ONLY`，再加 `FRONTEND_URL` = `https://community.nanako.org` 并 Deploy，
    `score.nanako.org` 上的页面请求就会 302 到新站。Worker 和 D1 留 30 天当冷备份。
12. **备份**：启用 `compose.yaml` 里的 `pg-backup`（取消注释并合并），配好 R2 的只写密钥和 `BACKUP_PASSPHRASE`
    （离线保存），手动跑一次并**演练一次恢复**。恢复到别的集群时，库必须用 `--locale=C.UTF-8` 创建
    （文本按码点排序，和 D1 一致），否则 `migrate` 会拒绝运行。
13. **Discord bot**：见 [DEPLOY-DISCORD.md](DEPLOY-DISCORD.md)。

**回滚**：第 4 步之前随时可以停下，去掉 Worker 的 `READ_ONLY` 就回到原样。第 8 步之后 PG 有了新写入，只往前修。

## 有人在用时：只读窗口切换

前提：[DEPLOY-PAGES.md](DEPLOY-PAGES.md) 已做完——SPA 在 `community.nanako.org`（Pages），Worker 挂在
`capi.nanako.org`。切换时 `capi.nanako.org`、cookie 名、`SESSION_SECRET` 都不变，没人需要重新登录，
只有 30–45 分钟的只读窗口，期间能看不能写。

### 准备（不影响线上）

1. **变量**：Coolify 的 `app` 需要 `OAUTH_CLIENT_SECRET`、`SESSION_SECRET`（P2 生成的那个）、`AI_API_KEY`，
   `ADMIN_SUBJECT_IDS` 或 `ADMIN_USERNAMES` 和 Worker 保持一致。找不到明文的 secret，在切换前一天轮换并
   **同时**更新 Worker。
2. **备份**：同上面简化顺序的第 12 步，切换前演练一次恢复。
3. **预检域名**：DNS 加 A 记录 `capi-next` → 服务器 IP（DNS only），Coolify 里 `app` 加域名
   `https://capi-next.nanako.org`、端口 8787。
4. **彩排一次**（强烈建议，用真实数据）：按下面的 T+3–T+10 做一遍（不开只读、不顺延截止时间），
   做完按「导出与导入」一节清空数据库，`API_HOST` 改回空。

### 切换（选一个没人约局的时间，比如工作日凌晨）

| 时刻 | 步骤 |
|---|---|
| T−5 | 打开一次网站（触发 `GET /api/config` 上的惰性判决），让只读前已经过期的案件先判掉 |
| T0 | **Worker 只读**：`wrangler.toml` 的 `[vars]` 加 `READ_ONLY = "1"`，部署。Workers Builds 暂停着的话，改在后台 → Worker → Settings → Variables and Secrets 里加 `READ_ONLY` = `1`，保存并 Deploy（用的是现有代码，不需要构建）。之后所有写请求 503，惰性任务和 Cron 停止 |
| T+1 | 等 60 秒以上（比最长的在途请求更久：AI 调用 20 秒 × 2） |
| T+2 | **顺延截止时间（在 D1 上，导出之前，只执行一次）**：只读期间被告没法写陈述，把 T0 之后到窗口结束前到期的案件顺延（按实际窗口调整 `+1 hour`）。把 `<T0>` 换成 T0 的 **UTC** 时间，格式 `2026-11-04 18:00:00`：<br>`npx wrangler d1 execute edg-credit --remote --command "UPDATE records SET deadline_at = datetime(deadline_at, '+1 hour') WHERE status = 'awaiting_statement' AND deadline_at >= '<T0>' AND deadline_at < datetime('<T0>', '+1 hour')"`<br>下限用 T0 本身而不是执行时刻：晚几分钟执行也不会漏掉 T0 之后到期的案件，而只读之前就已过期的照常缺席判决。重复执行会再顺延一次，所以**只跑一次**（不确定是否成功时，先用 `SELECT id, deadline_at FROM records WHERE status = 'awaiting_statement'` 看一眼）。在 D1 上做，导出的数据和只读的 Worker 才一致，T+10 的对拍才有意义 |
| T+3 | **导出**：见「导出与导入」 |
| T+5 | **导入**：见「导出与导入」 |
| T+8 | **预检**：Coolify 里设 `API_HOST=capi-next.nanako.org,capi.nanako.org`（`JOBS_ENABLED` 仍为 `false`），重新部署。`capi.nanako.org` 此时还解析到 Worker，先列进来，T+13 切 DNS 时就不用再改变量 |
| T+10 | **对拍**：`node scripts/compare-api.mjs https://capi.nanako.org https://capi-next.nanako.org`，期望 `N/N endpoints identical` |
| T+12 | **go / no-go** |
| T+13 | Cloudflare：删除 Worker 的 Custom Domain `capi.nanako.org`，**紧接着**在 DNS 加 A 记录 `capi` → 服务器 IP（DNS only），再在 Coolify 里给 `app` 加域名 `https://capi.nanako.org`、端口 8787 并 Redeploy。证书要等 DNS 指过来才能签（通常一分钟内），这期间请求会失败或报证书错误 |
| T+16 | 冒烟：登录状态还在、能立案 / 撤案、约局能报名；`https://capi.nanako.org/status` 返回 `"ok": true` |
| T+30 | 宣布完成。删掉 `capi-next` 的域名和 DNS 记录；Coolify 里 `API_HOST=capi.nanako.org`、`JOBS_ENABLED=true`，重新部署（先停后起，中断 30–60 秒）。在这之前惰性任务照常随页面加载运行，不开定时器也不会漏判 |

### 回滚

- **T+13 之前**（新库还没接过真实写入）：Worker 去掉 `READ_ONLY` 并部署即可（后台加的就在后台删掉再 Deploy），PG 的数据直接丢弃。
  T+2 的顺延留在 D1 上无害（本来就是给只读窗口补的时间）。
- **T+13 之后**：只往前修。D1 那边的数据停在 T0，PG 已经有了新写入，没有安全的反向同步。
  这之后用 `APP_TAG` 回滚镜像时，只能回到 P3a 及以后的 sha：更早的镜像没有 API，`capi.nanako.org` 会 404。
- Worker 保持只读部署 30 天（D1 当冷备份），`export/` 加密后存一份，保留 90 天。

## 之后

- 外部监控加一条：`https://capi.nanako.org/status`（关键字 `"ok":true`），告警发 Discord webhook。
- `/healthz` 只代表进程活着，给 Docker / Coolify 用；`/status` 才检查数据库（只报 `ok` / `error`，细节在容器日志里）。
