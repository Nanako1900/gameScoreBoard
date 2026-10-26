# P3a：API 从 Worker（D1）切到 Coolify（Node + PostgreSQL）

> 前提：P1（分享页已在 Coolify）、P2（SPA 在 Pages，Worker 在 `api.nanako.org`）都已完成。
> 整体方案见 [DESIGN-v4-discord-coolify.md](DESIGN-v4-discord-coolify.md)。

**这次切换用户无感**：`api.nanako.org`、cookie 名、`SESSION_SECRET` 都不变，没人需要重新登录。
只有 30–45 分钟的只读窗口，期间能看不能写。

## 为什么敢切

- Node 端跑的是 **Worker 原封不动的代码**（`worker/*.ts` 直接打包进 `server/`），数据库经由
  一个 D1 兼容适配层（`server/src/db/d1.ts`）访问 PostgreSQL。
- 整套 worker 测试（约 470 个）**在 D1 和 PostgreSQL 上各跑一遍**，全部通过（`npm run test:worker` / `npm run test:pg`）。
- PG 的表结构是 D1 的忠实移植：时间仍是 `YYYY-MM-DD HH:MM:SS` 文本、标志仍是 0/1，API 输出逐字节相同。
- 本地完整演练过：真实 API 造数据 → 导出 → 导入并校验 → 新旧两套 API 的 16 个公开接口**完全一致** → 新库上写入正常。

## 准备（不影响线上）

1. **secret 明文**：Coolify 的 `app` 需要 `OAUTH_CLIENT_SECRET`、`SESSION_SECRET`（P2 生成的那个）、
   `AI_API_KEY`。找不到明文的，在切换前一天轮换并**同时**更新 Worker（`wrangler secret put …`）。
2. **备份**：在 `compose.yaml` 里启用 `pg-backup`（取消注释），配好一个 R2 bucket 的只写密钥和
   `BACKUP_PASSPHRASE`（离线保存）。切换前手动跑一次，并**演练一次恢复**。
3. **部署到 Coolify**：`API_HOST` 留空、`JOBS_ENABLED=false`。此时 `app` 只服务分享页，数据库是空的。
4. **Tunnel**：加 `api-next.nanako.org` → `http://app:8787`（预检用）。
5. **彩排一次**（强烈建议，用真实数据）：按下面「切换」的第 2–5 步做一遍，但第 1 步不开只读；
   做完后清空数据库：
   ```bash
   docker compose exec postgres psql -U edg -d edg -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
   docker compose run --rm migrate
   ```

## 切换（选一个没人约局的时间，比如工作日凌晨）

| 时刻 | 步骤 |
|---|---|
| T0 | **Worker 只读**：`wrangler.toml` 的 `[vars]` 加 `READ_ONLY = "1"`，部署。之后所有写请求 503，惰性任务和 Cron 停止 |
| T+1 | 等 60 秒以上（比最长的在途请求更久：AI 调用 20 秒 × 2） |
| T+2 | **导出**（在你本机，已 `wrangler login`）：`node scripts/d1-export.mjs export/`。只读，逐表 SELECT |
| T+5 | **导入**：把 `export/` 传到 Coolify 主机，然后 `docker compose run --rm -v "$PWD/export:/import:ro" migrate node server/dist/import-d1-main.js /import`。导入在一个事务里完成并逐表回读校验，任何不一致整体回滚 |
| T+7 | **顺延截止时间**：只读期间被告没法写陈述，把窗口内到期的案件往后顺延（按实际窗口调整 `+1 hour`）：<br>`docker compose exec postgres psql -U edg -d edg -c "UPDATE records SET deadline_at = datetime(deadline_at, '+1 hour') WHERE status = 'awaiting_statement' AND deadline_at < datetime('now', '+1 hour')"` |
| T+8 | **预检**：Coolify 里设 `API_HOST=api-next.nanako.org`（`JOBS_ENABLED` 仍为 `false`），重新部署 |
| T+10 | **对拍**：`node scripts/compare-api.mjs https://api.nanako.org https://api-next.nanako.org`，期望 `N/N endpoints identical` |
| T+12 | **go / no-go** |
| T+13 | Cloudflare：删除 Worker 的 Custom Domain `api.nanako.org`；在 Tunnel 里加 `api.nanako.org` → `http://app:8787` |
| T+14 | Coolify：`API_HOST=api.nanako.org,api-next.nanako.org`、`JOBS_ENABLED=true`，重新部署 |
| T+16 | 冒烟：登录状态还在、能立案 / 撤案、约局能报名；`https://api.nanako.org/status` 返回 `"ok": true` |
| T+30 | 宣布完成；Tunnel 里删掉 `api-next`，`API_HOST` 改回 `api.nanako.org` |

## 回滚

- **T+13 之前**（新库还没接过真实写入）：Worker 去掉 `READ_ONLY` 并部署即可，PG 的数据直接丢弃。
- **T+13 之后**：只往前修。D1 那边的数据停在 T0，PG 已经有了新写入，没有安全的反向同步。
- Worker 保持只读部署 30 天（D1 当冷备份），`export/` 加密后存一份，保留 90 天。

## 之后

- 外部监控加一条：`https://api.nanako.org/status`（关键字 `"ok":true`），告警发 Discord webhook。
- `/healthz` 只代表进程活着，给 Docker / Coolify 用；`/status` 才检查数据库。
