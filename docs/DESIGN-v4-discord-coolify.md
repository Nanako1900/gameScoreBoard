# EDG 信誉分 × Discord 整合与迁出 Workers：方案分析

> 路径约定：无前缀的路径指 `/Users/nanako/Dropbox/SProject/scoreboard`（A），`DC:` 前缀指 `/Users/nanako/Dropbox/Project/DC`（B）。
> 域名后来定为：前端 `community.nanako.org`（Pages），API `capi.nanako.org`（`api.` 已被别的服务占用），
> 旧网址 `score.nanako.org` 留在 Worker 上跳转。下文仍按当时的 `score.` / `api.` 书写，部署以 `docs/DEPLOY-*.md` 为准。
>
> 状态：**方案分析，未实施**（2026-10-25）。只读了代码，没有跑测试或构建。行号以本地 main 为准。origin/main（PR #3）没有动 `worker/`，只在 `shared/quickTime.ts` 末尾加了一个纯函数 `isSynthesizedTitle`，所以后端行号在 origin/main 上同样成立。

---

## 0. TL;DR

1. **可行，推荐这样做：**
   - 一个仓库：SPA 留在根目录，新增 `server/` workspace。
   - 一个镜像起两个服务：`api` 和 `bot`。
   - 数据库用 PostgreSQL 17。
   - 源站只通过 Cloudflare Tunnel 对外，不开公网端口。
   - 前端放 Cloudflare Pages。如果用户主要在大陆，改用 EdgeOne Pages 国际版。
2. **迁出 Workers 本身不难。** 运行时耦合只有大约 5 处：`ASSETS`、`export default {fetch, scheduled}`、`waitUntil`、D1 类型、`c.env`。真正的风险是 D1 换成 PG 后的**静默语义差异**：
   - `COUNT` 返回字符串，`'4'+2` 变成 `'42'`；
   - 0/1 改成 boolean 后，`=== 1` 永远为假，管理员会被撤权；
   - jsonb 被 `JSON.parse` 两次；
   - timestamptz 读出来是 `Date` 对象；
   - `GROUP BY` 写法 PG 不认；
   - NUL 字节和 int4 溢出在 PG 里直接报错。
   这些用 4 个 type parser、约 15 处 SQL 修改，再让 tsc 把布尔比较全部报出来，就能收住。
3. **Bot 的形态：**
   - 走 Gateway（只出站，不需要公网 endpoint）；
   - 直接调用 domain 层，不经过 HTTP API；
   - 推送用 PG 的 transactional outbox；
   - 绑定用 Discord OAuth2 `identify`，再加一个网页确认页。
4. **MVP 就是你提的三件事：** 绑定账号、在 Discord 里查分/看榜/看最近判决、判决同步到私有频道。约 **23 个专注人日**，业余时间按 ×1.5 估。私信写陈述、约局按钮、周报推送放在 MVP 之后，按使用情况再决定。
5. **迁移前先修这几个现存问题：**
   - 前端时间显示偏 8 小时（用 V8 实测确认过）；
   - 结算可能只做一半；
   - 头像代理存在 SSRF/XSS 隐患；
   - 换到子域后会出现同站 CSRF；
   - 任何人都能把自己设成裁判；
   - 管理员是按一个可修改的用户名授予的。
6. **分享页 `discord.nanako.org` 由 `api` 服务做 SSR。** Pages 没法在服务端注入 og meta。前面挂 Cloudflare 缓存，源站宕机或部署时也能返回旧页面。
7. **切换分两步：**
   - 先把 SPA 搬到 Pages，把旧 Worker 挂到 `api.nanako.org`。用户会被要求重新登录，整个迁移只有这一次。
   - 再在一个 30–45 分钟的只读窗口里把后端换成 Node + PG。回滚只在 go/no-go 点之前有效，之后只往前修。
8. **开工前必须先回答两件事：** Coolify 服务器在哪个地区；三个 Worker secret（`SESSION_SECRET`、`OAUTH_CLIENT_SECRET`、`AI_API_KEY`）的明文是否还在你手里。Cloudflare 上的 secret 无法读回。

---

## 1. 现状盘点

### 1.1 两个项目

| | A：EDG 信誉分 | B：discord-share |
|---|---|---|
| 用途 | 朋友局的信誉分，包括立案、AI 定性和量刑、每周回血、约局点名、周报 | "Nanako's Community" 的公开邀请/分享页 |
| 技术栈 | Worker + Hono（`worker/`）、D1、React 18 + Vite SPA（`src/`）、纯函数模块 `shared/` | Worker（`DC:src/*.ts`）加无构建的静态页（`DC:public/`） |
| 数据 | D1：users / records / score_events / ai_verdicts / weekly_* / game_sessions / session_players / app_settings | 不用数据库。数据来自 Discord 公共 API（invite、widget.json、application rpc），存进 Cache API |
| 登录 | Nanako OAuth（`OAUTH_BASE_URL=https://nanako.org`），HS256 JWT cookie | 无 |
| 后台任务 | 回血、逾期扫案、周报，都由 `GET /api/config` 里的 `waitUntil` 惰性触发（`worker/routes.ts:154-166`） | 无（请求驱动的 SWR 缓存） |
| 测试 | Miniflare D1 集成测试（`tests/worker/`），PR #3 加了 DOM 测试 | 约 180 个用例，跑在普通 Node 的 vitest 上，已经 stub 掉了 `caches` 和 `HTMLRewriter` |

### 1.2 和 Workers/D1 绑定的关键位置

| # | 位置 | 内容 | 迁出后 |
|---|---|---|---|
| 1 | `worker/index.ts:29` | `c.env.ASSETS.fetch` 做 SPA 兜底 | 删掉，SPA 移到 Pages |
| 2 | `worker/index.ts:31-46` | `export default {fetch, scheduled}`；`scheduled()` 不生成周报 | 换成 `@hono/node-server` 的 `serve()`，加 croner |
| 3 | `worker/routes.ts:154-166` | 三处 `c.executionCtx.waitUntil`。在 node-server 上取 `executionCtx` 会直接抛错 | 删掉，改由 scheduler 跑 |
| 4 | `worker/types.ts:10-11` | `DB: D1Database; ASSETS: Fetcher` | `DB: Queryable`，去掉 ASSETS |
| 5 | `routes.ts` 里约 41 处、`routes-admin.ts` 里约 14 处 `c.env.*` | bindings 和 vars | 启动时从 `process.env` 读取，用 zod 校验，然后注入 `app.fetch(req, env, ctx)` |
| 6 | `worker/oauth.ts:19` | `redirect_uri` 兜底用 `new URL(req.url).origin` | 放到 Tunnel 或代理后面会拿到 http，所以 `APP_URL` 必须配置 |
| 7 | 82 处 `prepare`、10 处 `batch`、`meta.changes`、4 处 `last_row_id` | D1 API | D1 兼容适配层（见 §6） |
| 8 | `worker/session.ts`、`oauth.ts`、`ai/*` | WebCrypto、fetch、AbortController | Node 20 及以上原生支持，**不用改** |
| 9 | `wrangler.toml:5-12`；没有 `workers_dev = false` | Worker 自带静态资源；`*.workers.dev` 地址一直可访问 | 切换后旧入口要 301 或关掉（见 §9） |
| 10 | `wrangler.toml:22-29` | 注释写的是"不需要 Cron，可以在 dashboard 里另配" | 需要你确认 dashboard 里有没有配过 |
| 11 | `functions/api/[[default]].js:17` | EdgeOne 边缘函数写死了反代到 `gamescoreboard-bn.me-22e.workers.dev` | 删掉，或改成整站跳转 |
| 12 | `DC:src/index.ts`、`DC:src/cache-store.ts` | `caches.default`、`HTMLRewriter`、`ASSETS` | 内存 poller，加 linkedom 适配 `page.ts` |
| 13 | `DC:wrangler.jsonc:7` | `discord.nanako.org` 是 Worker Custom Domain | 先删掉 Custom Domain，再指到 Tunnel |
| 14 | `DC:wrangler.jsonc:17` | `INVITE_CODE: ""`，依赖 widget 的轮换邀请 | 现在就设一个永久邀请码 |

### 1.3 现存问题（都已对照代码核实）

| 问题 | 位置 | 影响 | 放在哪期 |
|---|---|---|---|
| 前端时间偏 8 小时 | `src/lib/time.ts:12-20` 先调用 `Date.parse`，V8 会把 `YYYY-MM-DD HH:MM:SS` 当本地时间。用 `TZ=Asia/Shanghai` 实测，`'2026-10-25 08:00:00'` 被解析成 `00:00Z`。origin/main 上没修 | 所有"x 小时前"和倒计时都偏 8 小时 | P0 |
| 结算可能只做一半 | `sessions.ts:645-652` 先把局标成已结算，`:687-703` 再逐个立案；奖励分超上限会抛错（`case-limits.ts:91-93`） | 后面的人没立案，重试返回 409 | P0：上限改成静默跳过；P3b：整个结算放进一个事务 |
| 改判可能被叠加两次 | `cases.ts:479-504`：`decided` 案件改判时状态不变，guard 挡不住并发 | 分数被扣两次 | P3b |
| `ai/config.ts:157` 有两个 NUL 字节 | 从 `ca73f92` 起 git 把这个文件当二进制，diff 和 PR review 都看不到改动 | 审查盲区 | P0：换成 `\u0000` |
| 头像代理 | `routes.ts:256` 的 fetch 默认跟随重定向；`:259` 原样透传上游 Content-Type；`http.ts:73-90` 的 eTLD+1 判断太粗，所有 `*.nanako.org` 都能过 | 迁到 Node 后能被用来探测内网（SSRF）；上游返回 HTML/SVG 时会在持有会话 cookie 的源上执行（XSS） | P0 |
| 同站 CSRF | `http.ts:18-25` 不检查 Content-Type，没有 Origin 校验 | 拆成子域后，`*.nanako.org` 都算同站，`text/plain` 表单可以带着 cookie 发写请求 | P0（要在 P2 之前） |
| 任何人都能自封裁判 | `routes.ts:273-281` 调 `db.ts:183-209` | 裁判权限形同虚设；一旦有推送，就能被拿来刷私信骚扰 | 推送上线前（需要你拍板） |
| 限流不计撤回的案件 | `case-limits.ts:57-75` 带 `status != 'withdrawn'`；`cases.ts:377-394` 允许立案人随时撤回 | 可以无限循环"立案→撤回" | 推送上线前 |
| 管理员按用户名授予 | `db.ts:150` 加 `oauth.ts:94`，取 username/name/nickname 中第一个有值的字段；当前配置是 `"Hongyu Qi"` | 如果 IdP 不总是返回稳定的 `username`，别人改个昵称就能成为管理员 | P0：改为 `ADMIN_SUBJECT_IDS` |
| PG 会拒收的 AI 输出 | `ai/provider.ts:222` 存的 `parsedDelta` 只检查了是有限数，没有范围限制；`prompt.ts:46-60` 不过滤 NUL | 在 PG 上判决写库失败，案件一直卡在 `judging`，sweep 每 2 分钟重试一次 AI 并无限循环（`cases.ts:88,338-363`） | P3a |
| `quickSlots()` 依赖运行环境时区 | `shared/quickTime.ts:35-40,59-82` | 服务端（UTC）生成"今晚 20:00"会变成北京时间凌晨 4 点 | 用到 bot 的 `/yue` 之前 |
| 大量写操作不检查 `changes` | 撤回、申诉、取消、升级确认、改类，以及三个 guarded batch | 竞态下可能重复发通知或误发通知 | P3b（`RETURNING` 加 rowCount 判断） |

---

## 2. 目标架构

```
                Cloudflare（DNS / CDN / Tunnel；不跑 Workers runtime）
 浏览器 ──► score.nanako.org ──► Cloudflare Pages（SPA 静态文件 + _headers CSP）
   │  fetch(credentials:'include')；顶层跳转 /auth/* /link/*
   ▼
 api.nanako.org ──────┐
 discord.nanako.org ──┤◄── 访客 / 爬虫（og meta；CF 缓存 60s，源站故障回旧页）
                      ▼
                 cloudflared（出站隧道；源站不开入站端口）
                      │
 ┌─ Coolify 主机 · docker compose ─────────────────────────────────────────┐
 │ api（Node 24 · Hono）                     bot（Node 24 · discord.js v14） │
 │  ├ /healthz（在 Host 分流之前，只检查存活）  ├ Gateway（WSS 出站，Guilds）  │
 │  ├ Host=api.*     /api /auth /link /status  ├ slash 命令 / 按钮 / modal    │
 │  ├ Host=discord.* 分享页 SSR + /api/guild   ├ outbox dispatcher（LISTEN）  │
 │  ├ scheduler（croner，Asia/Shanghai）       └ 直接调用 domain 层           │
 │  ├ share poller 每 60s ─► Discord 公共 API                                 │
 │  └ AI 调用（在事务外）─► OpenAI 兼容服务                                   │
 │           │                                   │                           │
 │           └──────────►  postgres:17  ◄────────┘    pg-backup ─► R2（加密）│
 └────────────────────────────────────────────────────────────────────────────┘
   外部监控（UptimeRobot / Better Stack）──► /healthz、/status ──► Discord webhook 告警
```

| 组件 | 职责 |
|---|---|
| Cloudflare Pages | 只托管 SPA 静态文件，构建时注入 `VITE_API_BASE=https://api.nanako.org` |
| cloudflared | 把 `api.`、`discord.`（以及临时的 `api-next.`）这几个域名转发到 `api:8787`。源站 IP 不暴露，也不需要 Let's Encrypt |
| `api` | HTTP API、OAuth、绑定流程、分享页 SSR、全部定时任务。**即使 Discord 挂了，这个服务也照常工作** |
| `bot` | Gateway 连接、交互处理、outbox 投递。崩溃时不影响网页 |
| postgres | 唯一的数据源，只在内网可见，时区固定为 UTC |
| pg-backup | 每天把加密备份写到 R2，保留 14 天 |
| 外部监控 | 不依赖这台主机，主机挂了也能发出告警 |

---

## 3. 关键决策

| 决策 | 选择 | 备选 | 理由 |
|---|---|---|---|
| 仓库形态 | 单仓，用 npm workspaces。SPA 留在根目录，新增 `server/`，DC 代码复制进 `server/src/share/` | pnpm 的 apps/packages 布局；保留两个仓库 | `@shared` alias（`vite.config.ts:11-12`）和 DOM 测试都不用动。bot 要直接 import domain 层，而 API 只认 cookie（`routes.ts:132-144`） |
| 运行时 | Node 24 LTS + Hono 4 + `@hono/node-server` | Bun、Fastify | 路由代码几乎不用改，WebCrypto 是原生的 |
| 进程拆分 | **同一个镜像，起 `api` 和 `bot` 两个 compose 服务，各一个副本** | 一个进程，用 advisory lock 选 leader | 坏掉的 bot 不会拖垮网页。也不需要 leader 锁：session 级锁放在连接池里，连接被回收时锁会悄悄丢失。Coolify 部署是先停旧的再起新的，不会同时有两个实例 |
| 数据访问 | 先写一个 D1 兼容适配层，配 4 个 parser，**改用原生 boolean 和 jsonb**。`batch()` 用 SERIALIZABLE，**冲突时不重试，直接返回 409** | Kysely/Drizzle 重写；遇 40001 自动重试 | 82 处 `prepare` 都能沿用。绝对值写分的批次如果盲目重试，会把一次检测到的冲突变成真正的丢更新 |
| 事务化 | 切换稳定后的 P3b：所有写分路径改成"`FOR UPDATE` 锁行 + 相对值更新" | 切换时一起做 | 切换窗口里改动越少越安全。推送功能以 P3b 为前提 |
| 迁移工具 | 纯 SQL 文件，加一个约 40 行的 runner（advisory lock，每个文件一个事务），作为一次性 `migrate` 服务运行 | node-pg-migrate | 和现有风格一致，迁移失败时 `api` 不会启动 |
| 后台任务 | 在 `api` 里用 croner（`timezone:'Asia/Shanghai'`、`protect:true`），每个任务记一条 `job_runs` | graphile-worker、BullMQ | 所有任务本来就是幂等的，outbox 本身就是队列 |
| 事件 | 在业务事务里写 outbox，只有 `RETURNING` 确实命中了行才写，然后 `pg_notify` | 提交后 fire-and-forget；数据库 trigger | 前者在重新部署时会丢事件；trigger 拿不到业务语义 |
| Bot 传输 | Gateway，只开 `Guilds` intent，Interactions Endpoint URL 留空 | HTTP Interactions | 只需要出站连接，不需要公网端点，也不用做签名校验 |
| 账号绑定 | Discord OAuth2 `identify`，state 用签名 cookie（复用 `session.ts` 的模式，加 `link.` 前缀），回调后显示确认页，确认用 POST 提交 | bot 签发 token；绑定码 | 两边身份各由自己的 IdP 证明。几十个人用不着备用方案，绑定码以后再说 |
| 频道、角色配置 | 写在环境变量里（`FEED_CHANNEL_ID`、`PLAYER_ROLE_ID` 等） | `discord_guild_config` 表加 `/settings` 命令 | 只有一个服务器；而且如果 Discord 账号被盗，攻击者也没法把播报频道改成公开频道 |
| 管理操作 | Discord 里只放跳转网页的链接按钮 | 在 Discord 里直接改判或撤销 | Discord 会话被盗不需要过 2FA，管理权限只能靠 Nanako 会话 |
| 分享页 | `api` 按 Host 分流做 SSR；`page.ts` 原样复用，PatchTarget 改用 linkedom 实现；用 60 秒 poller 替换原来 362 行的缓存层 | Pages 静态页；Pages Functions | 需要服务端 og meta，而 Functions 本质上还是 Workers runtime。同源部署时 CSP（`DC:src/html.ts:19`）和 `fetch("/api/guild")`（`DC:public/app.js:602`）都不用改 |
| 前端托管 | Cloudflare Pages（如果用户在大陆，改用 EdgeOne Pages 国际版） | Coolify 同源托管 | 这是你指定的方案。同站 cookie 的设计在两家都成立 |
| 源站接入 | Cloudflare Tunnel | 橙云 + Let's Encrypt；Cloudflare Origin CA | 不开端口，源站 IP 不暴露，切换时不会出现等证书导致的 526 |
| 域名和 cookie | 全部放在 nanako.org 下。cookie 只发给 `api.` 这个 host，`SameSite=Lax`，P2 起改名为 `__Host-edg_session` 和 `__Host-edg_oauth_state`。**不设置 `COOKIE_DOMAIN`** | 设 `Domain=.nanako.org`；`SameSite=None` | 设成 `.nanako.org` 会把 cookie 发给 IdP 和所有子域。`__Host-` 前缀可以防止兄弟子域伪造同名 cookie |
| 镜像 | GitHub Actions 构建后推到 GHCR，tag 用 git sha；compose 里写 `image:` | 在 Coolify 主机上 `build:` | 回滚只要改回上一个 tag；不在小 VPS 上装 wrangler/workerd 这些开发依赖 |
| 测试数据库 | 真实的 PG 17：CI 用 GitHub Actions `services: postgres`，本地用 `compose.test.yml`，每个测试文件从模板库复制一个库 | PGlite；Testcontainers | 必须和生产用同一个驱动。PGlite 测不了并发 |
| 备份 | 在 compose 里跑 `postgres-backup-s3`，每天 GPG 加密后写到 R2，保留 14 天 | Coolify 的 Database resource（自带 S3 备份）；只备份到本地 volume | 异地、加密、一个 stack 管完。Coolify Database resource 也可以用，见 §14 |
| 设计系统 | 两个站点各用各的主题（Frost 和电竞记分牌）。bot embed 用记分牌配色（金 `0xF5C542`、红 `0xE5484D`）。Rajdhani 字体改为自托管 | 统一成一套主题 | 两边场景不同。Google Fonts（`index.html:9-14`）会和严格的 CSP 冲突，而且在大陆不稳定 |

**明确不做：**
- 新旧后端双写；48 小时内手工把数据补回 D1；长期维护一个 staging 环境；
- 判决之前公开案件；
- 把段位做成 Discord 角色（这等于给人贴长期标签，见 `scoring.ts:180`、`ai/report.ts:23`）；
- 在 Discord 里点名或结算（界面太重）；
- 用语音数据判断迟到；
- Linked Roles；
- 用 React 重写分享页，或在分享页上显示分数；
- `/file` 命令（要求所有被告都已绑定，而且会串行调用 8 次 AI）。

---

## 4. Discord 机器人

### 4.1 进程与权限

- **intent：** 只开 `Guilds`，不开 `MESSAGE_CONTENT`，关闭消息缓存。命令只注册到这个服务器，每次启动比较 hash，有变化才重新注册。
- **邀请权限：** 只给 View Channel、Send Messages、Embed Links。要自动发角色时再加 Manage Roles，并且把 bot 的角色放在 @EDG 选手 正上方，**不给 Administrator**。在 Developer Portal 里关掉 Public Bot，团队开启 2FA。staging 用一个单独的 application。
- **身份解析：** `interaction.user.id` → `discord_links` → `getUserById`（`db.ts:59`）→ `toUser`（`db.ts:31`）→ 调 domain 函数。custom_id 里只放资源 id，不放身份。没绑定的用户只能用只读命令。`ApiError` 的中文信息直接作为 ephemeral 消息回复。
- **稳定性：**
  - 注册 `client.on('error')` 和 `process.on('unhandledRejection')`，只记日志，不退出进程。
  - 启动时读取 `GET /gateway/bot` 的 `session_start_limit.remaining`。如果小于 50，就不登录并发告警。原因是 IDENTIFY 每天限 1000 次，用完后 Discord 会重置 bot token。
- **日志：** 不记录 interaction token、OAuth code 或 follow-up URL。

### 4.2 命令

| 命令 | 谁能用 | 调用 | 回复方式 | 阶段 |
|---|---|---|---|---|
| `/link`（绑定） | 所有人 | 回一个 Link 按钮，指向固定地址 `https://api.nanako.org/link/discord` | ephemeral | P4 |
| `/unlink`（解绑） | 已绑定的人 | 事务里删除绑定，写审计 | ephemeral | P4 |
| `/score [user]`（信誉） | @EDG 选手 | 用一个轻量的 profile 查询，加 `tierFor`（`scoring.ts:183`）、`pendingCounts`（`case-reads.ts:169`） | 查自己：ephemeral，显示段位和待办；查别人：只显示分数，不显示段位 | P4 |
| `/top`（榜） | @EDG 选手 | `getLeaderboard`（`db.ts:70`） | 发在频道里，不 @ 任何人 | P4 |
| `/verdicts [user]`（最近判决） | @EDG 选手 | `listRecords({status:'decided'})`（`case-reads.ts:107`） | ephemeral，只显示 §4.6 里的固定字段 | P4 |
| `/todo`（待办） | 已绑定的人 | `listRecords({pendingFor})`、`listMyInvites`（`sessions.ts:331`） | ephemeral，每项附网页链接 | P4 |
| `/report`（战报） | @EDG 选手 | `getLatestReport`（`report.ts:226`） | 发在频道里，不 @ 任何人 | P4 |
| `/notify on\|off` | 已绑定的人 | 修改 `discord_links.notify_dm`，同时把 `dm_ok` 重置为 true | ephemeral | P6 |
| `/yue`（约） | 已绑定的人，且是参与者 | `createSession`（`sessions.ts:273`），用 `interaction.id` 做幂等键 | 在频道里发约局卡片 | P7 |

### 4.3 按钮与 modal

custom_id 统一格式为 `v1:<动作>:<资源id>[:参数]`。

| custom_id | 交互 | 调用 | 阶段 |
|---|---|---|---|
| `v1:verdict:{rid}` 看判词 | ephemeral。当事人、立案人、裁判、管理员能看到完整判词；其他人只能看到固定字段和网页链接 | `loadRecordItem`（`case-reads.ts:151`），结果按角色过滤 | P5 |
| `v1:stmt:{rid}` 写陈述 | 弹出 modal（TextInput 1–1000 字）→ 先 defer（内联 AI 最长 20 秒 ×2）→ follow-up 返回判决，或者提示"AI 裁决中" | `submitStatement`（`cases.ts:147`） | P6 |
| `v1:appeal:{rid}` 申诉 | 弹出 modal 填理由 | `appealCase`（`cases.ts:399`） | P6 |
| `v1:rsvp:{sid}:{going\|maybe\|out}` | 即时回应，并编辑卡片上的人数 | `setRsvp`（`sessions.ts:410`） | P7 |
| `v1:esc:{rid}:{ok\|no}` | 私信给立案裁判 | `case-filing.ts:303 / :330` | P8 |
| 管理操作 | **只用 Link 按钮**跳到网页的管理队列 | — | P8 |

Discord 的限制：
- 交互必须在 3 秒内 ack，token 有效 15 分钟；
- 全局每秒 50 次请求；
- 10 分钟内出现 1 万次 401/403/429 会被封 IP，因此要有熔断（见 §4.5）。

### 4.4 事件和通知对照

"频道"指私有频道 `#edg-信誉分`，只有 @EDG 选手 能看到。

| 事件 | emit 位置 | 频道 | 私信 | dedupe_key | 阶段 |
|---|---|---|---|---|---|
| `case.decided` | `judgeAndDecide`（`cases.ts:249`），record UPDATE 命中 1 行后 | 固定字段帖，附 [看判词] 和网页链接 | 被告收到完整判词，附 [申诉]（P6 起） | `case:{id}:decided` | P5 |
| `case.revoked` | `revokeCase`（`cases.ts:421`） | 编辑原帖，加删除线 | 被告（P6） | `case:{id}:revoked` | P5 |
| `case.overridden` | `overrideCase`（`cases.ts:462`） | 编辑原帖 | 被告（P6） | `score_event:{id}`（同一案件可以多次改判） | P5 |
| `case.filed` | `fileCase`（`case-filing.ts:147` 起） | **不发** | 被告：事实描述、`<t:R>` 格式的截止时间、AI 告知（DESIGN-v2.md:451），附 [写陈述]。**`available_at` 设为 now+3 分钟；投递时如果案件已不在 awaiting_statement 状态就跳过** | `case:{id}:filed` | P6 |
| `case.deadline`（截止前 2 小时） | 和立案在同一个事务里写入；截止时间顺延时 `ON CONFLICT DO UPDATE available_at` | — | 被告，仍在待陈述时才发 | `case:{id}:deadline-2h` | P6 |
| `case.withdrawn` | `withdrawCase`（`cases.ts:377`），需检查 rowCount | — | **只有当立案私信已经发出时**才通知，同时让原来的按钮失效 | `case:{id}:withdrawn` | P6 |
| `case.appealed` | `appealCase`（`cases.ts:399`） | — | 管理员，附网页链接 | `case:{id}:appeal:{n}` | P6 |
| `case.escalation` | `fileCase` 里 `escalation_suggested=1` 时 | — | 立案裁判 | `case:{id}:esc` | P8 |
| `session.created` | `createSession`（`sessions.ts:273`），在 batch 之后 | 约局卡片 | 被邀请且 `notify_dm` 开着的人 | `session:{id}:created` | P7 |
| `session.card` | `setRsvp` / `updateSession` / `cancelSession` | 读当前状态后编辑卡片，不做防抖 | — | `session:{id}:card:{epoch_ms}` | P7 |
| `session.changed` / 取消 | `:349` / `:395`，需检查 rowCount | — | 已回应的人 | `session:{id}:changed:{epoch_ms}` | P7 |
| `session.starting`（开局前 15 分钟） | 创建或改时间时 upsert | — | 报名"来"的人 | `session:{id}:starting` | P7 |
| `session.rollcall` | 创建时写入，`available_at` 设为开始时间加时长 | — | 组织者，附 [去网页点名] | `session:{id}:rollcall` | P7 |
| `report.ready` | 周报 AI 叙述写完之后 | 战报，不 @ 任何人 | — | `report:{week}` | P8 |
| `report.regenerated` | `regenerateReport`（`report.ts:283`） | 编辑原帖 | — | `report:{week}:regen:{epoch_ms}` | P8 |
| `link.*` | 绑定和解绑路由 | — | 本人（新号收欢迎私信，旧号收换绑提醒） | `link:{audit_id}` | P4 |
| `user.score_adjusted` | `adminUpdateUser`（`db.ts:312-324`） | — | 本人 | `score_event:{id}` | P8 |
| 回血、加分 | — | — | 不推送，并入周报 | — | — |

### 4.5 dispatcher 规则

1. **认领：** 用一条 `UPDATE … SET claim_token = gen_random_uuid(), claimed_at = now(), attempts = attempts + 1 WHERE id = (SELECT … FOR UPDATE SKIP LOCKED) RETURNING *` 认领一行。条件包括：`available_at <= now()`；没被认领，或者认领时间超过 2 分钟；**同一个实体上没有更早的未处理事件**，保证每个实体内部按顺序投递。
2. **投递：** 先重新读取当前状态，再检查收件人（`notify_dm`、`dm_ok`），然后渲染并发送，频道消息带上 nonce 和 `enforce_nonce`。发送后 upsert `discord_messages`，最后用 `WHERE id = $1 AND claim_token = $2` 标记完成。**不能拿时间戳当 token**：1184 parser 会把 timestamptz 截到毫秒，而 `now()` 是微秒精度，等值比较永远不成立。
3. **编辑：** 如果编辑时找不到原消息，就按当前状态重新发一条。
4. **错误码处理：**

   | 错误 | 处理 |
   |---|---|
   | 50007（对方关闭了私信） | 设 `dm_ok = false`，**不要**改成在频道里 @ 对方。用户下一次和 bot 交互，或执行 `/notify` 时恢复 |
   | 10003 / 10008（频道或消息不存在） | 删除对应的 `discord_messages` 记录 |
   | 429 以外的其他 4xx | 不重试，标记为 `skipped` 或 `dead` |
   | 5xx | 退避重试，最多 8 次 |
   | 429 | 交给 `@discordjs/rest` 按 bucket 处理 |
   | 401 / 403 / 429 | 在 1 分钟窗口内计数，超过阈值就暂停投递 5 分钟并发告警 |

5. **唤醒：** dispatcher 用一个专用的 `pg.Client` 做 `LISTEN`，断线自动重连，另外每 30 秒轮询一次兜底。需要轮询的原因是 `available_at` 设在未来的行到期时，不会有 NOTIFY。
6. **私信预算：** 每个收件人每天最多 10 条，超出的合并成一条摘要。每个组织者最多同时有 5 个开放的局，每天最多建 10 个。

### 4.6 隐私和语气

- 所有消息都设置 `allowed_mentions: {parse: []}`。只有正面的内容（邀请、本周之星）才允许 @ 被提到的人。
- **频道里只发判决之后的内容。** 原则是"不做有罪推定"（`ai/prompt.ts:24`）。
- **频道帖只放这些固定字段：** 名字（不 @）、类型标签、分数变化、是否缺席、一个网页链接。**不放 AI headline，不放判词。** 原因是 headline 和判词都是 AI 看过陈述之后写的，可能把"家人住院"这类内容带出来。加重因素不展示，因为注入尝试会被记成加重因素（`prompt.ts:30`）。
- 判词是第二人称写的，只通过私信或带权限过滤的 ephemeral 发送。段位只给本人看。
- **所有用户输入和 AI 文本发到 Discord 之前都走同一个渲染函数：**
  - `escapeMarkdown`；
  - `[` 和 `]` 换成全角，防止伪装链接，例如在 claim、note、24 字以内的 display_name 里写 `[写陈述](https://evil)`；
  - 让 URL 失效（defang）；
  - 带上 `SuppressEmbeds` 标志。
  渲染快照测试要复用 DC 里的 XSS fixture。
- **公开 API 不能泄露 Discord 身份。** `discord_user_id` 和 `discord_username` 不能出现在 `PublicUser`、`/api/leaderboard`、`/api/users/:id`、`/api/records` 里，否则任何人都能把这个约 131 人的服务器里的 Discord 账号和扣分记录对上。
- **网页本身也公开了这些内容。** `GET /api/records` 目前不登录也能看到 statement 和 appeal_reason（`routes.ts:185-204`）。只在 Discord 端收紧意义不大，见 §14 的问题 8。
- **隐私告知要更新：** 陈述不只发给 AI 服务商，现在还会出现在 Discord 私信和频道里。

---

## 5. 账号绑定流程

1. 用户执行 `/link`，bot 回一个 ephemeral 的 Link 按钮，指向固定地址 `https://api.nanako.org/link/discord`。**URL 里不带任何 token。** 网页设置页里也有同一个入口。
2. `GET /link/discord`：
   - 没登录时跳到 `/auth/login?next=/link/discord`。`next` 只允许以 `/link/` 开头的路径，并且存在签名的 state 里（`routes.ts:511-547`）。
   - 会话签发时间超过 10 分钟时，同样要求重新登录一次。
3. 生成签名 cookie `__Host-edg_link`，内容是 `nonce.userId.exp`，HMAC 用 `link.` 前缀，10 分钟过期。然后跳到 Discord 授权页：`scope=identify`，带上 `state=nonce`。**不加 `prompt=none`**，每次都让用户看到授权页。
4. `GET /link/discord/callback` 必须同时满足以下条件：
   - state 和 cookie 里的 nonce 一致；
   - HMAC 有效，没有过期；
   - cookie 里的 `userId` 等于当前会话的用户。
   满足后清掉 cookie，用 code 换 token，调用 `/users/@me` 拿到身份，然后**立即丢弃 token**，不存储任何 Discord 凭据。
5. 显示确认页："把 Discord **@name** 绑定到 Nanako 账号 **xxx**？"，并带一个"接收私信通知"的勾选框，默认勾选，用户可以取消。这一步把待确认的 `discordId + userId` 写进一个 5 分钟有效的签名 cookie。
6. `POST /link/discord/confirm`：先校验 Origin，再在一个事务里处理：
   - 这个 Discord 已经绑定了别的账号：返回 409，提示"请先在原账号解绑"；
   - 当前账号已经绑定了另一个 Discord：必须勾选"确认换绑"，旧号会收到私信提醒，同时 `session_epoch + 1`；
   - 其他情况：直接写入。
   以上每种情况都写一条 `link_audit` 和对应的 outbox 事件。
7. 跳回 `FRONTEND_URL/?linked=discord`。新用户再加上 `&onboarding=1`（`App.tsx:145-160`）。
8. outbox 发送欢迎私信，顺便探测私信是否可达。如果用户不在服务器里，私信里附上邀请链接。**MVP 不自动发角色**，由你在 Discord 里手动给 @EDG 选手。以后要自动发，见下面最后一条。
9. 解绑有三个入口：网页设置页、`/unlink`、管理员强制解绑。每次解绑都写审计并 `session_epoch + 1`。

**安全性：**
- 两边身份各由自己的 IdP 证明：Discord 身份来自 Discord OAuth，Nanako 身份来自当前会话。
- state 一次性有效、10 分钟过期，同时绑定发起人和浏览器。
- 要求最近 10 分钟内登录过；必须在确认页点按钮才会写入，这样别的网站把人引过来时不会悄悄完成绑定；确认页的 POST 会校验 Origin。
- cookie 都用 `__Host-` 前缀，兄弟子域没法伪造或覆盖。
- 不允许静默覆盖已有绑定，每次变更都会私信留痕，网页上能看到绑定历史，也能解绑。
- `users.session_epoch` 写进 JWT，`routes.ts:132-144` 的中间件会校验它。"退出所有设备"、解绑、换绑都会让旧会话失效，这样偷来的 cookie 没法通过绑定 Discord 变成长期访问。
- 以后如果要自动发角色：先由管理员批准；解绑、删号、取消参与者身份时，写一条 `role.revoke` 事件，payload 里带上 `discord_user_id`，外键用 `SET NULL`；每天按 `role_grants` 表对账一次。

---

## 6. 数据层

### 6.1 Parser 和适配层

```ts
const tsz = pg.types.getTypeParser(1184);
pg.types.setTypeParser(20, Number);                        // int8：COUNT/SUM。否则 '4'+2 === '42'（case-limits.ts:91、sessions.ts:756）
pg.types.setTypeParser(1700, Number);                      // numeric：AVG（routes-admin.ts:84）
pg.types.setTypeParser(1184, (v) => tsz(v).toISOString()); // timestamptz → ISO-Z（毫秒精度）
pg.types.setTypeParser(1082, (v) => v);                    // date 保持 'YYYY-MM-DD'
// 连接参数加 options=-c TimeZone=UTC，并执行 ALTER DATABASE edg SET timezone='UTC'
// 原因：代码绑定的是不带时区的字符串（worker/time.ts 的 sqlNow 等）
// 角色级超时：ALTER ROLE edg SET lock_timeout='5s', statement_timeout='30s', idle_in_transaction_session_timeout='60s'
```

适配层规则（约 150 行）：

| 规则 | 说明 |
|---|---|
| 占位符 | `?` 改写为 `$n`（已确认 worker 的 SQL 字符串字面量里没有 `?`） |
| `bind()` | 返回新对象，不修改原对象。**所有 string 参数先去掉 `\u0000`**，包括要写进 jsonb 的 JSON 文本 |
| `first` / `all` / `run` | 返回结构和 D1 一致：`changes` 取 rowCount，`last_row_id` 取 `rows[0]?.id` |
| `batch()` | 一个连接上执行 `BEGIN ISOLATION LEVEL SERIALIZABLE` → 按顺序执行 → `COMMIT`。**遇到 40001 不重试**，直接抛 `ApiError(409, '操作冲突，请重试')` |
| `transaction(fn)` | READ COMMITTED，`fn` 拿到的是一个类型为 `Tx` 的句柄。domain 函数统一接受 `Queryable`，在事务里调用时必须传 tx，避免嵌套调用又从连接池拿连接，形成数据库察觉不到的死锁 |
| 测试模式 | 记录执行过的每一条 SQL 文本，用来出 SQL 覆盖率报告 |
| **AI 调用** | **不允许放在事务里，也不允许持有连接池里的连接时调用** |

`app.onError` 增加 SQLSTATE 映射：

| SQLSTATE | 返回 |
|---|---|
| 23505、40001、40P01 | 409 |
| 22003、22P02、22021、22P05 | 400 |
| 其他 | 500，并记录日志 |

### 6.2 P3a 必须改的地方

| 改动 | 位置 |
|---|---|
| `datetime('now')` 改成 `now()`，`datetime('now','-7 days')` 改成 `now() - interval '7 days'` | db.ts、cases.ts、sessions.ts、`report.ts:303`、`ai/config.ts:59`、`routes-admin.ts:86` |
| `SUM(clamped)` 改成 `COUNT(*) FILTER (WHERE clamped)` | `routes-admin.ts:83` |
| `INSERT OR IGNORE` 改成 `ON CONFLICT … DO NOTHING`，并检查 rowCount | `sessions.ts:312`、`report.ts:260` |
| 加 `RETURNING id` | `case-filing.ts:137`、`:175`；`sessions.ts:297`、`:772` |
| `GROUP BY` 改成按 `u.id` | `report.ts:109-113`、`:153-156` |
| SQL 里的布尔字面量 | `db.ts:73`、`:360`；`case-filing.ts:321`、`322`、`340`、`369` |
| JS 里的布尔比较，共 11 处。先把 Row 类型改成 boolean，让 tsc 全部报出来 | `db.ts:37-39`、`50-51`、`66`、**`165`**（不改的话管理员会被静默撤权）；`case-reads.ts:74`；`case-filing.ts:312`；`sessions.ts:104`、`745` |
| jsonb 读取兼容已解析的对象：`typeof raw === 'string' ? JSON.parse(raw) : raw` | `case-reads.ts:37-52`、`report.ts:208` |
| `INSERT … SELECT` 的参数加显式类型转换 | `cases.ts:131-135`、`sessions.ts:312-313` |
| `parsedDelta` 和 `latency_ms` 截到 int4 范围内；新增 `records.judge_attempts`，两处认领时都 +1，**达到 3 次就直接按基准刑写判决，不再调 AI** | `ai/provider.ts:222`、`cases.ts:163-174`、`:353-363` |
| `parseId` 上限设为 2147483647 | `http.ts:103-106` |
| 删掉 `waitUntil`，换新入口 `main.ts`，`APP_URL` 改为必填 | `routes.ts:154-166`、`oauth.ts:19` |
| 文案里提到的 "Worker Secret" 改掉 | `http.ts:68`、`routes-admin.ts:116`、`ai/config.ts:171` |
| `AI_ALLOWED_HOSTS` 白名单，生产环境去掉 localhost 例外 | `routes-admin.ts:121-135`；在 `ai/provider.ts`、`classify.ts`、`report.ts` 里 fetch 之前检查 |
| SSRF 防护：用 undici Agent 拒绝回环、RFC1918、链路本地、CGNAT、ULA、Docker 网段 | 头像代理和 AI 调用 |
| `fileCases` 先并发分类（并发 4）再按顺序写库；`POST /api/records` 支持 `Idempotency-Key` | `case-filing.ts:273-292`。Cloudflare 代理有 100 秒上限，8 人串行 AI 分类最长要 160 秒以上，超时后用户重试就会重复立案 |

### 6.3 现有表的类型映射

- **自增 id：** 改为 `integer GENERATED BY DEFAULT AS IDENTITY`。导入时保留原 id，导入后执行 `setval(seq, GREATEST(max(id), sqlite_sequence.seq))`。保留原 id 的原因是 `score_events.reason` 里存的是 `record:<id>`。
- **0/1：** 改为 `boolean`。
- **TEXT 时间：** 改为 `timestamptz`，API 输出 ISO 格式。这是一处契约变更，要同步改 `docs/CONTRACT.md:194-195`。前端的 `parseTimestamp` 两种格式都认，P0 修完后更稳。
- **`week_start`：** 改为 `date`。
- **JSON 列：** 改为 `jsonb`，加 `jsonb_typeof` CHECK。
- **REAL：** 改为 `double precision`。
- **枚举：** 用 `text` 加 CHECK，先建成 `NOT VALID`，导入并清洗后再 `VALIDATE`。
- **score：** 加 `CHECK (score BETWEEN 0 AND 100)`。
- **新增的 4 个外键**（`records.session_id`、`session_players.record_id`、`game_sessions.settled_by`、`app_settings.updated_by`）：一律 `ON DELETE SET NULL`。导入时先把悬空引用置为 NULL，并记录数量。
- **排序规则：** 建库时 `--locale=C.UTF-8`。
- **索引：** 保留原有的，新增 `records(reporter_id, created_at DESC)` 和 `score_events(created_at)`。

### 6.4 事务化（P3b，在推送上线前完成）

**统一做法：**
- 事务内先 `SELECT … FROM records WHERE id = $1 FOR NO KEY UPDATE` 锁住案件，状态不对就直接返回。
- 再锁 `users` 行，按相对值更新：`LEAST(100, GREATEST(0, score + $d))`，然后 `RETURNING`。
- 加锁顺序固定为先 records、后 users。
- 父表行用 `FOR NO KEY UPDATE` 加锁，这样不会和外键检查需要的 `FOR KEY SHARE` 冲突。
- `RETURNING` 返回 0 行时报 409，并且**不写 outbox**。

| 函数 | 修复的问题 |
|---|---|
| `judgeAndDecide`、`revokeCase`、`overrideCase` | 丢更新；无审计的分数变化；改判叠加两次（`overrideCase` 要求 WHERE 里带上 `delta = $old_delta`） |
| `fileCase` 加分分支、`awardOrganizerBonus` | 两次写入不原子；周上限检查有竞态 |
| `weeklyHeal` | 改成先 claim（`INSERT … ON CONFLICT DO NOTHING RETURNING`）再按相对值回血，避免抹掉中间落下的判决 |
| `adminUpdateUser` 改分 | 审计里记录的 delta 不对 |
| `settleSession` | **整个结算放进一个事务**（这条路径不调用 AI）；周上限改为静默跳过 |
| `setRsvp`、`createSession` | 超员；创建一半就失败 |
| `upsertUser` | 改成 `INSERT … ON CONFLICT DO UPDATE … RETURNING *, (xmax = 0) AS is_new` |
| 撤回、申诉、升级确认、改类、取消 | 都补上 rowCount 检查，没命中就返回 409 |

### 6.5 新表和新列 DDL

```sql
ALTER TABLE users          ADD COLUMN session_epoch  integer NOT NULL DEFAULT 0;
ALTER TABLE records        ADD COLUMN judge_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE weekly_reports ADD COLUMN ai_attempts    integer NOT NULL DEFAULT 0;

CREATE TABLE discord_links (
  discord_user_id  text PRIMARY KEY CHECK (discord_user_id ~ '^[0-9]{17,20}$'),
  user_id          text NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  discord_username text NOT NULL,
  notify_dm        boolean NOT NULL DEFAULT false,   -- 确认页里由用户勾选
  dm_ok            boolean NOT NULL DEFAULT true,    -- 遇 50007 置 false；下次交互或 /notify 时恢复
  linked_at        timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE link_audit (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  action          text NOT NULL CHECK (action IN ('link','relink','unlink','admin_unlink')),
  via             text NOT NULL CHECK (via IN ('web','discord','admin')),
  user_id         text REFERENCES users(id) ON DELETE SET NULL,
  discord_user_id text NOT NULL,
  actor_user_id   text REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- 网页 Idempotency-Key，同时作为 Discord 发起的写操作的审计日志（key = interaction.id）
CREATE TABLE idempotency_keys (
  key             text PRIMARY KEY,
  source          text NOT NULL CHECK (source IN ('web','discord')),
  user_id         text REFERENCES users(id) ON DELETE SET NULL,
  discord_user_id text,
  action          text NOT NULL,
  response        jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE outbox (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind              text NOT NULL,
  entity            text NOT NULL CHECK (entity IN ('record','session','report','link','user')),
  entity_id         text NOT NULL,
  target_user_id    text REFERENCES users(id) ON DELETE SET NULL,  -- 删号后事件仍保留（例如撤销角色）
  target_discord_id text,                                          -- 下单时就写入快照
  payload           jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  dedupe_key        text NOT NULL UNIQUE,
  available_at      timestamptz NOT NULL DEFAULT now(),
  claim_token       uuid,
  claimed_at        timestamptz,
  processed_at      timestamptz,
  result            text CHECK (result IN ('sent','skipped','dead')),
  attempts          integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error        text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_outbox_due    ON outbox (available_at, id) WHERE processed_at IS NULL;
CREATE INDEX idx_outbox_entity ON outbox (entity, entity_id, id) WHERE processed_at IS NULL;

CREATE TABLE discord_messages (
  entity     text NOT NULL CHECK (entity IN ('record','session','report')),
  entity_id  text NOT NULL,
  purpose    text NOT NULL,
  channel_id text NOT NULL,
  message_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity, entity_id, purpose)
);

CREATE TABLE job_runs (
  job          text PRIMARY KEY,     -- sweep / heal / report / reminders / cleanup / heartbeat
  last_started timestamptz,
  last_ok      timestamptz,
  last_error   text
);
```

`emit(tx, …)` 的规则：
- 只在 guarded UPDATE 确实命中行之后调用；
- 一次性事件用 `ON CONFLICT (dedupe_key) DO NOTHING`；
- 提醒类事件用 `ON CONFLICT (dedupe_key) DO UPDATE SET available_at = excluded.available_at, processed_at = NULL, claim_token = NULL`；
- 最后调用 `pg_notify('outbox', '')`，它只在事务提交时才真正发出。

### 6.6 D1 能接受、PG 会拒绝的值

导入前预检时，以下各项都要计数并报出来：
- 每个 TEXT 列里含 `char(0)` 的行；
- 每个 INTEGER 列里超出 int4 范围的值；
- `type`、`status`、`reason` 三个字段的 `DISTINCT` 取值，对照 CHECK 约束；
- 4 个新外键上的悬空引用；
- `sqlite_sequence` 和各表 `max(id)` 的关系。

---

## 7. Web 拓扑

| 域名 | 指向 | 内容 |
|---|---|---|
| `score.nanako.org` | Cloudflare Pages | SPA，带 `_headers`（CSP 加安全头），构建时注入 `VITE_API_BASE` |
| `api.nanako.org` | Tunnel 到 `api:8787` | `/api/*`、`/auth/*`、`/link/*`、`/status`。如果这个子域已被占用，改用 `score-api.` |
| `discord.nanako.org` | Tunnel 到 `api:8787`（按 Host 分流） | 分享页 SSR、`/api/guild`、3 个静态文件 |
| `api-next.nanako.org` | Tunnel 到 `api:8787` | 只在 P3 切换前用于预验证，之后删掉 |

**Cookie 与 OAuth**
- 会话 cookie 是 `__Host-edg_session`，只发给 `api.` 这个 host，属性为 `Secure; HttpOnly; SameSite=Lax; Path=/`，**不带 Domain**。`score.` 和 `api.` 属于同一个 site，`fetch(..., {credentials:'include'})` 能带上 cookie（见 `src/api.ts:87-90`）。
- 需要在 OAuth 后台登记的回调：`https://api.nanako.org/auth/callback`（P2）、`https://api-next.nanako.org/auth/callback`（P3 预验证），以及 Discord 绑定的回调 `https://api.nanako.org/link/discord/callback`。
- 环境变量：`APP_URL`（必填）、`FRONTEND_ORIGIN`（CORS 白名单，`routes.ts:119-130`）、`FRONTEND_URL`（登录后跳回的地址，`routes.ts:545`）。

**CSRF 与安全头**
- 在 P0，也就是还在 Worker 上的时候就加：`app.use('/api/*', csrf({origin: [FRONTEND_ORIGIN, APP_URL]}))`。所有非 GET 请求都要求 `Content-Type: application/json`，这样跨源请求必须先预检。`/auth/logout` 和 `/link/*` 的 POST 也走同一个中间件。所有 GET 保持无副作用。
- API 响应统一加 `X-Content-Type-Options: nosniff`，以及 CSP `frame-ancestors 'none'`。
- 头像代理：
  - `redirect: 'manual'`，最多跟 2 跳，每一跳都重新校验；
  - 只接受精确匹配的主机名（`nanako.org` 加 `AVATAR_ALLOWED_HOSTS`），不放行本站自己的域名；
  - 只接受 png、jpeg、gif、webp、avif，其他类型返回 415；
  - 固定加 `nosniff`、`CSP: default-src 'none'; sandbox`；
  - 超时 5 秒，最大 2MB，并按 IP 限流。

**限流**

源站只能通过 Tunnel 访问，所以可以信任 `CF-Connecting-IP`。在内存里按 IP 做滑动窗口，覆盖 `/auth/*`、`/link/*`、`/api/avatar` 和所有 POST。Bot 里另外按 Discord 用户限流会触发 AI 的交互。

**分享页**
- `page.ts` 原样保留，只写一个约 10 行的 linkedom 适配：用 `querySelectorAll`，文本走 `textContent`，HTML 走 `innerHTML`。模板在启动时解析一次，每个请求 clone 一份。
- 安全头改成中间件实现，复用 `DC:src/html.ts:13-30` 的 `SECURITY_HEADERS`。
- poller 每 60 秒拉一次，失败就沿用旧快照。
- `/` 的响应头改为 `Cache-Control: public, max-age=0, s-maxage=60, stale-if-error=86400`（原来是 `DC:src/index.ts:16` 的 `no-cache`），再在 Cloudflare 上加一条 Cache Rule 让这个 HTML 可缓存。**上线前要实测一次：停掉源站时，Cloudflare 是否会返回旧页面。**
- **现在就设置永久的 `INVITE_CODE`**。

**其他事项**
- **旧入口：** P2 起，Worker 对所有非 `/api`、`/auth` 的路径返回 301 跳到 `FRONTEND_URL`。设 `workers_dev = false`。EdgeOne 项目改成整站跳转，或者直接删掉。
- **Safari：** WebKit 会把"子域响应里设置的、且 IP 和主站差异较大"的 cookie 限制为最多 7 天。Pages 和 Tunnel 都是 Cloudflare 的 IP，应该不会触发，但要在 iPhone 上实测。如果前端改用 EdgeOne，两边 IP 不同，风险会更高。
- **备选：** 如果只想要一个 origin，可以让 `api` 直接托管 SPA 的 `dist/`，这样不涉及任何 CORS 或 cookie 问题。

---

## 8. 后台任务（替代 `waitUntil` 惰性任务）

| 任务 | 时间（Asia/Shanghai） | 幂等依据 | 说明 |
|---|---|---|---|
| `sweepDueCases(…, 20)` | 每分钟 | 条件认领（`cases.ts:353-363`）；`judge_attempts` 达到 3 次就走兜底 | 原来每次页面加载最多处理 5 件（`cases.ts:90`） |
| `weeklyHeal` | 周一 00:00，之后每 15 分钟补跑一次，启动时也跑一次 | `weekly_heals` 主键 | P3b 改成先 claim 再按相对值回血 |
| `ensureWeeklyReport` | **周一 10:30 以后**才 claim，之后每 15 分钟检查一次 | `weekly_reports` 主键 | 周日晚上立的案要到周一上午才判完，太早生成会漏统计。叙述还是 fallback 时，AI 最多重试 3 次（`ai_attempts`） |
| 提醒补漏 | 每 5 分钟 | `dedupe_key` | 截止前 2 小时提醒、开局前 15 分钟提醒、点名提醒 |
| heartbeat | 每分钟写一次 `job_runs('heartbeat')` | — | 见下 |
| 宕机顺延 | 启动时 | 同一个事务 | 如果 `now - last_heartbeat > 10 分钟`，执行 `UPDATE records SET deadline_at = deadline_at + gap WHERE status = 'awaiting_statement' AND deadline_at > last_heartbeat - interval '1 hour'`，并写 outbox 发"截止时间已顺延"的私信，然后才启用 sweep。**切换窗口也复用这段逻辑** |
| 清理 | 每天 04:00 | — | 已处理超过 30 天的 outbox 行、超过 24 小时的幂等键 |
| share poller | 每 60 秒 | 内存 | — |

- 每个任务都用 croner 的 `protect: true`，加进程内 singleflight，每次运行都写 `job_runs`。
- 启动时断言 `Asia/Shanghai` 当前的偏移等于 `RESET_TZ_OFFSET`（中国没有夏令时，这个断言等于一致性检查）。
- 开关：生产环境 `JOBS_ENABLED` 默认为 **true**，只在 staging 和切换期间显式设为 false。如果是生产环境，且 `users` 表为空或者缺少"已导入"标记，就拒绝启动任务并告警。
- `/healthz` 只检查进程存活，给 Docker 和 Coolify 用。`/status` 返回 PG ping、各任务的 `last_ok`、dead 状态的 outbox 数量、Gateway 状态，给外部监控做关键字检查。`/status` 不参与 healthcheck，否则 PG 或 Discord 一抖动，分享页也会被摘掉。

---

## 9. 生产数据迁移、切换与回滚

### 9.1 前置条件（全部完成才能开始）

- [ ] 三个 secret 的明文都在密码管理器里。`SESSION_SECRET` 在 P2 重新生成，Worker 和 Coolify 用同一个值。`OAUTH_CLIENT_SECRET` 和 `AI_API_KEY` 找不到明文的话，就去 OAuth 后台和 AI 服务商那里轮换。
- [ ] Workers Builds 已经和 main 断开，或者锁定到一个冻结的 `legacy-worker` 分支。`READ_ONLY` 写在这个分支的 `[vars]` 里（只读开关的代码 P0 就加好）。原因是 dashboard 上设置的变量会在下一次部署时被覆盖（见 `wrangler.toml:36-46` 的注释）。
- [ ] `workers_dev = false`，EdgeOne 已经改成跳转，所有旧入口对非 API 请求返回 301。
- [ ] Tunnel 已经配好 `api-next.nanako.org`，对应的 OAuth 回调已登记。
- [ ] 在本地或临时环境用一份真实的导出数据完整彩排过一次（导入 → verify → compare-api → 手工把每条写路径走一遍），并按 docs 里的恢复步骤做过一次备份恢复。
- [ ] 已经约定：有迁移的部署之前，先手动触发一次备份。

### 9.2 导入脚本 `import-d1`

- 每张表用 `wrangler d1 execute --remote --json` 导出，再用 scp 传到服务器。脚本打包在镜像的 `dist/scripts/` 里，通过 `docker compose run --rm api node dist/scripts/import-d1.js /data/export` 执行。
- 整个导入在一个事务里完成：
  1. 预检，内容见 §6.6；
  2. 时间转成 ISO，解析结果是 NaN 就中止；
  3. 0/1 转成布尔，JSON 先校验；
  4. 按外键顺序导入，**保留原 id**；
  5. 悬空引用置为 NULL；
  6. 执行 `setval GREATEST`、`VALIDATE`、`ANALYZE`。
- **必须导入 `weekly_heals` 和 `weekly_reports`。** 导入后断言：只要 D1 里有本周和上周的记录，PG 里也必须有。否则启动时的 heal 会给所有人再加一次 +15。
- `compare-api`：对一组固定的 GET 接口做对比。比较前统一规范化：时间转成 epoch ms，0/1 转成 boolean，对象比较时忽略 key 顺序，另外维护一份"允许差异"白名单。

### 9.3 切换（30–45 分钟，建议工作日北京时间 02:00，避开周一 00:00 前后）

| 时刻 | 步骤 |
|---|---|
| T-1 天 | P2 已稳定运行；Coolify 上的库是空的，`JOBS_ENABLED=false`；记下 D1 Time Travel 书签 |
| T0 | 在 legacy 分支设 `READ_ONLY=1` 并部署。之后非 GET 请求和 `/auth/callback` 返回 503，惰性任务和 `scheduled()` 都跳过 |
| T+1 | 等待 60 秒以上（比最长的在途请求更久：AI 20 秒 ×2）。两次读取 records、score_events、ai_verdicts 的 `max(id)`，确认没有变化 |
| T+2 | 导出、传输、导入 |
| T+8 | 截止时间落在窗口内或窗口后 1 小时内的案件顺延，复用 §8 的顺延逻辑 |
| T+10 | 在 `api-next.` 上跑 verify、规范化后的 compare-api，再做一次登录冒烟。这里产生的写入可以丢弃 |
| T+18 | **go/no-go 判断** |
| T+20 | 在 Cloudflare 删除 Worker 的 Custom Domain `api.nanako.org`，然后在 Tunnel 上添加 public hostname `api.nanako.org` |
| T+22 | 冒烟测试，**用户不需要重新登录**（cookie 名、域名、secret 都没变） |
| T+25 | 打开 `JOBS_ENABLED`。处于 `judging` 状态的案件 2 分钟后会被重新认领（`cases.ts:88`） |
| T+30 | 宣布完成，删除 `api-next.` |

### 9.4 回滚

- **T+20 之前：** 关掉 `READ_ONLY` 就算回滚，PG 那边的数据直接丢弃。
- **T+20 到 T+25：** 先把 Tunnel hostname 删掉，恢复 Worker 的 Custom Domain；再关掉 `READ_ONLY`；然后停掉 Coolify 上的应用，并确认 `JOBS` 和 `PUSH` 都是关闭状态。
- **T+25 之后（PG 已经接受真实写入）：只往前修。** 不做"手工把数据补回 D1"：两边的时间格式、布尔、jsonb 和 id 都已经分叉，手工补回不可能做对。
- D1 保持只读 30 天。导出文件加密后存进 R2，保留 90 天。

---

## 10. docker-compose.yml 草图

```yaml
# 镜像由 GitHub Actions 构建：ghcr.io/nanako1900/gamescoreboard:<git-sha>
# Coolify 里所有 secret 都标成 runtime-only（不要勾 build variable）
services:
  postgres:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: edg
      POSTGRES_USER: edg
      POSTGRES_PASSWORD: ${SERVICE_PASSWORD_POSTGRES}
      POSTGRES_INITDB_ARGS: "--encoding=UTF8 --locale=C.UTF-8"
      TZ: UTC
    command: ["postgres", "-c", "timezone=UTC", "-c", "log_timezone=UTC"]
    volumes: [pgdata:/var/lib/postgresql/data]
    mem_limit: 512m
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U edg -d edg"]
      interval: 10s
      timeout: 5s
      retries: 10
    logging: &logs { driver: json-file, options: { max-size: "10m", max-file: "3" } }

  migrate:                     # 一次性任务；失败时 api 和 bot 不会启动
    image: ghcr.io/nanako1900/gamescoreboard:${APP_TAG}
    command: ["node", "dist/scripts/migrate.js"]
    restart: "no"
    environment:
      DATABASE_URL: postgres://edg:${SERVICE_PASSWORD_POSTGRES}@postgres:5432/edg
    depends_on: { postgres: { condition: service_healthy } }
    logging: *logs

  api:
    image: ghcr.io/nanako1900/gamescoreboard:${APP_TAG}
    command: ["node", "dist/api.js"]
    restart: unless-stopped
    init: true
    expose: ["8787"]
    mem_limit: 512m
    stop_grace_period: 60s
    environment:
      NODE_ENV: production
      NODE_OPTIONS: --max-old-space-size=384
      TZ: UTC
      PORT: "8787"
      DATABASE_URL: postgres://edg:${SERVICE_PASSWORD_POSTGRES}@postgres:5432/edg
      APP_URL: https://api.nanako.org
      FRONTEND_ORIGIN: https://score.nanako.org
      FRONTEND_URL: https://score.nanako.org
      SHARE_HOST: discord.nanako.org
      SITE_URL: https://discord.nanako.org
      SITE_NAME: "Nanako's Community"
      GUILD_ID: "1114391825336250432"
      INVITE_CODE: ${INVITE_CODE}
      RESET_TZ_OFFSET: "8"
      JOB_TIMEZONE: Asia/Shanghai
      JOBS_ENABLED: ${JOBS_ENABLED:-true}
      ADMIN_SUBJECT_IDS: ${ADMIN_SUBJECT_IDS}
      OAUTH_BASE_URL: https://nanako.org
      OAUTH_CLIENT_ID: ${OAUTH_CLIENT_ID}
      OAUTH_CLIENT_SECRET: ${OAUTH_CLIENT_SECRET}
      SESSION_SECRET: ${SESSION_SECRET}
      AI_API_KEY: ${AI_API_KEY}
      AI_ALLOWED_HOSTS: ${AI_ALLOWED_HOSTS}
      AVATAR_ALLOWED_HOSTS: ${AVATAR_ALLOWED_HOSTS}
      DISCORD_CLIENT_ID: ${DISCORD_APP_ID}           # 绑定用的 OAuth2
      DISCORD_CLIENT_SECRET: ${DISCORD_CLIENT_SECRET}
    depends_on:
      postgres: { condition: service_healthy }
      migrate: { condition: service_completed_successfully }
    healthcheck:   # /healthz 在 Host 分流之前注册，只检查存活
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:8787/healthz >/dev/null || exit 1"]
      interval: 15s
      timeout: 5s
      start_period: 30s
      retries: 3
    logging: *logs

  bot:
    image: ghcr.io/nanako1900/gamescoreboard:${APP_TAG}
    command: ["node", "dist/bot.js"]
    restart: unless-stopped
    init: true
    mem_limit: 384m
    stop_grace_period: 30s
    environment:
      NODE_ENV: production
      TZ: UTC
      DATABASE_URL: postgres://edg:${SERVICE_PASSWORD_POSTGRES}@postgres:5432/edg
      DISCORD_TOKEN: ${DISCORD_TOKEN}
      DISCORD_APP_ID: ${DISCORD_APP_ID}
      GUILD_ID: "1114391825336250432"
      FEED_CHANNEL_ID: ${FEED_CHANNEL_ID}
      ADMIN_CHANNEL_ID: ${ADMIN_CHANNEL_ID}
      PLAYER_ROLE_ID: ${PLAYER_ROLE_ID}
      PUBLIC_VERDICTS: ${PUBLIC_VERDICTS:-false}
      PUSH_ENABLED: ${PUSH_ENABLED:-true}
      FRONTEND_URL: https://score.nanako.org
      RESET_TZ_OFFSET: "8"
      AI_API_KEY: ${AI_API_KEY}                      # submitStatement 会在内联流程里调用 AI
      AI_ALLOWED_HOSTS: ${AI_ALLOWED_HOSTS}
    depends_on:
      postgres: { condition: service_healthy }
      migrate: { condition: service_completed_successfully }
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:8788/healthz >/dev/null || exit 1"]
      interval: 30s
      timeout: 5s
      start_period: 60s
      retries: 3
    logging: *logs

  pg-backup:
    image: eeshugerman/postgres-backup-s3:17      # 上线时改成固定的 digest
    restart: unless-stopped
    environment:
      SCHEDULE: "@daily"
      BACKUP_KEEP_DAYS: "14"
      PASSPHRASE: ${BACKUP_PASSPHRASE}            # GPG 对称加密；口令离线保存
      S3_ENDPOINT: https://<account>.r2.cloudflarestorage.com
      S3_REGION: auto
      S3_BUCKET: edg-backups
      S3_PREFIX: pg
      S3_ACCESS_KEY_ID: ${R2_ACCESS_KEY_ID}        # 只授权这一个 bucket 的写权限
      S3_SECRET_ACCESS_KEY: ${R2_SECRET_ACCESS_KEY}
      POSTGRES_HOST: postgres
      POSTGRES_DATABASE: edg
      POSTGRES_USER: edg
      POSTGRES_PASSWORD: ${SERVICE_PASSWORD_POSTGRES}
    depends_on: { postgres: { condition: service_healthy } }
    logging: *logs

  cloudflared:                 # 也可以改用 Coolify 内置的 Tunnel 集成
    image: cloudflare/cloudflared:2026.10.0
    command: ["tunnel", "--no-autoupdate", "run"]
    restart: unless-stopped
    environment:
      TUNNEL_TOKEN: ${CLOUDFLARE_TUNNEL_TOKEN}
    logging: *logs

volumes:
  pgdata:
```

- **Dockerfile：** 多阶段构建，`node:24-alpine`，`npm ci -w server`，用 tsup 打包。运行阶段只复制 `dist`、`migrations`、`share-public`，并且 `--omit=dev`。以 `USER node` 运行，CMD 直接写 `node …`，保证 SIGTERM 能送到 Node 进程。另外加一个 `.dockerignore`。
- **部署：** Coolify 的 compose 部署不是滚动更新，每次部署大约会停 30–60 秒，所以安排在深夜。SPA 遇到 502、503 或网络错误时显示"服务维护中，稍后重试"。回滚就是把 `APP_TAG` 改回上一个值，所以迁移脚本只允许做向前兼容的改动。
- **主机：** 至少 4GB 内存，Coolify 本身就要占 2GB 以上。如果 Coolify 没有默认开启日志轮转，就在每个 service 里加上上面的 `logging` 配置。
- **YAML anchor：** 如果 Coolify 不认 `&logs` / `*logs`，就把它们展开写。

---

## 11. 测试策略

| 层 | 内容 |
|---|---|
| P0，先在 D1 上补 | 给目前完全没有测试的函数补测试：`weeklyHeal`、`upsertUser`（包括 `db.ts:165` 的管理员问题）、`getLeaderboard`、`adminUpdateUser`（包括级联删除）、`updateSession`、`writeSetting`、管理员 AI 统计查询。这些测试在 D1 上通过后，作为 PG 移植必须保持的行为基准 |
| 单元测试 | 现有用例；DC 里保留的约 120 个 `it`（缓存层的 54 个删掉，`index.test.ts` 重写）；`parseTimestamp` 和 `quickSlots` 的时区回归测试 |
| 适配层 | 占位符改写、返回结构、回滚、409 映射、4 个 parser、NUL 过滤；用 lint 禁止在 domain 以外直接使用 `pg` |
| domain 集成测试 | 真实的 PG 17：CI 用 `services: postgres`，本地用 `compose.test.yml`，每个测试文件从模板库复制一个库。**SQL 覆盖报告要求 domain 层的每一条 SQL 至少执行过一次** |
| 并发测试 | 判决和 sweep 并发、两次改判、RSVP 超员、回血和判决交错、结算、首次登录同时发生 |
| PG 拒绝值 | AI 返回 `delta=1e12`、headline 里带 `\u0000`、`parseId(3000000000)`：判决都能落地，或者返回 400，不会无限循环 |
| outbox | 只在命中行时写入且只写一行、去重、事务回滚后没有残留、claim token、同一实体按顺序投递、提醒 upsert |
| HTTP | CORS、CSRF（`text/plain` 表单被拒）、Host 分流、`/healthz` 不受 Host 影响、`next` 白名单、绑定流程的每个失败分支、头像代理（重定向到内网、上游返回 text/html、请求本站自己）、限流、SQLSTATE 映射；原 `DC:test/index.test.ts` 的行为都要覆盖 |
| bot | handler 写成纯函数；渲染快照加隐私断言：不 @ 人、伪装链接被中和、频道帖里没有 headline 和判词、`看判词` 按角色过滤 |
| dispatcher | 用 undici MockAgent 模拟 50007、10008、403、429、5xx、dead、熔断 |
| 迁移 | 用脱敏后的 fixture（含 NUL、旧枚举值、悬空外键）测试 `import-d1`、`verify`、`compare-api` 的规范化 |
| 前端 | DOM 测试，加一条 Playwright 冒烟：登录 → 首页 → 立案页 |

服务端测试在 `TZ=UTC` 和 `TZ=Asia/Shanghai` 下各跑一遍。覆盖率要求 80% 以上。工具链统一为 vitest ^5、TS ^7（在 P3a 完成）。

---

## 12. 路线图

工作量按专注人日估。业余时间做的话按 ×1.5 估。

| 阶段 | 做什么 | 上线后用户看到什么 | 工作量 |
|---|---|---|---|
| **P0** | 修时间解析、结算的周上限改为静默跳过、NUL 改成 `\u0000`、CSRF 中间件和 JSON Content-Type 校验、头像代理加固、`ADMIN_SUBJECT_IDS`、加 `READ_ONLY` 开关、分享页设置 `INVITE_CODE`、接入 GitHub Actions CI、在 D1 上补测试、确认三个 secret 的明文 | **时间显示恢复正常**；结算不会再卡在一半；邀请链接固定下来 | 2 |
| **P1** | 建 Coolify 栈：Tunnel、GHCR、外部监控和 webhook。分享页迁成 `server/src/share/`（poller、linkedom、安全头中间件、CF 缓存规则）。删掉 Worker 的 Custom Domain `discord.nanako.org`，改走 Tunnel | 看起来没有变化；基础设施已经验证可用 | 2.5 |
| **P2** | SPA 迁到 Pages，Worker 挂到 `api.nanako.org`；cookie 改名为 `__Host-`；生成新的 `SESSION_SECRET`；旧入口 301；`workers_dev = false`；EdgeOne 改跳转；在 iPhone 上实测 Safari | 新网址；**需要重新登录一次，整个迁移只有这一次** | 1.5 |
| **P3a** | 适配层、parser、§6.2 的全部改动、`main.ts`、scheduler、`job_runs`、`/status`、宕机顺延、SSRF agent、限流、`import-d1`、`verify`、`compare-api`、彩排，然后切换 | 功能不变；**判决、回血、周报都按时执行**，不再依赖有人打开网页；不用重新登录 | 7 |
| **P3b** | §6.4 的事务化，修掉改判叠加和结算半途的问题，补 rowCount 检查，`fileCases` 并发分类加幂等键 | 并发场景下不再出错；批量立案更快 | 2.5 |
| **P4** | `bot` 服务；绑定流程（确认页、审计、session_epoch、网页解绑）；把管理员检查挪进 domain 层；`/score`、`/top`、`/verdicts`、`/todo`、`/report` | **在 Discord 里绑定账号、查分、看榜、看最近判决和自己的待办** | 4 |
| **P5** | outbox 和 dispatcher；`case.decided`、`revoked`、`overridden` 播报到私有频道（只放固定字段），撤销或改判时编辑原帖；`看判词` 按角色过滤 | **判决自动同步到 Discord 频道**。到这里，你提的三件事全部完成 | 4 |
| *MVP 合计* | | | *约 23.5（业余约 35）* |
| P6（建议做） | 立案后私信写陈述（modal）、截止前 2 小时提醒、判决私信、申诉 modal、`/notify`、私信预算。前提：裁判只能由管理员授予、撤回的案件计入限流 | **被立案时 Discord 里会提醒写陈述，缺席判决明显变少** | 4.5 |
| P7（可选） | 约局卡片和 RSVP 按钮、开局前 15 分钟提醒、点名提醒、`/yue`（`quickSlots` 加 offset 参数） | **在 Discord 里约局和报名** | 4 |
| P8（按需） | 周报推送、升级确认、管理员跳转链接、自动角色（需要审批和对账）、由 Gateway 数据生成分享页（之后可以关 widget）、Kysely、陈述隐私 | — | 按需 |

---

## 13. 风险清单

| 风险 | 可能性 / 影响 | 缓解 |
|---|---|---|
| 服务器在大陆，连不上 Discord 和 AI | 未知 / 致命 | 拍板问题 0；放在海外，或者把 bot 拆到海外的小机器上 |
| Worker secret 读不回来 | 中 / 用户被迫重新登录，回滚失效 | P2 重新生成并备份，作为切换前置条件 |
| PG 语义差异导致静默出错 | 高 / 分数算错、管理员被撤权 | parser、tsc 布尔检查、在 D1 上先补测试、SQL 覆盖报告、规范化对拍 |
| 漏迁 heals 或 reports | 中 / 所有人被再回血一次 | 导入时设为必选，导入后断言 |
| AI 输出让写库失败，案件无限循环 | 中 / 罚分不落地，AI 费用持续增加 | NUL 过滤、int4 截断、`judge_attempts` 上限 |
| 旧 Worker 被重新部署后又能写入 | 中 / D1 和 PG 数据分叉 | 断开 Workers Builds，或锁到 legacy 分支；`READ_ONLY` 写进 `[vars]`；`workers_dev = false`；旧入口 301 |
| 主机宕机期间陈述到期 | 中 / 被缺席判决 | heartbeat 加启动时顺延 |
| 部署有停机，或 bot 陷入崩溃循环 | 中 / IDENTIFY 配额耗尽，token 被重置 | 拆成两个服务；不因 error 退出进程；检查 IDENTIFY 剩余预算；深夜部署 |
| 头像代理 SSRF 或 XSS | 中 / 账号被接管 | P0 加固，Node 上加 SSRF agent |
| 同站 CSRF | 中 / 被代为立案 | P0 加 Origin 校验和 JSON Content-Type 校验 |
| 被人利用来刷私信，bot 被 Discord 隔离 | 中 / 核心功能失效 | 裁判只能由管理员授予、撤回计入限流、立案私信延迟发送、私信预算、局数上限 |
| Discord 账号被盗后执行管理操作 | 低 / 中 | Discord 里不放管理写操作；频道 ID 只写在环境变量里 |
| 隐私暴露面变大（社区约 131 人） | 中 | 私有频道、只发固定字段、不 @ 人、Discord ID 不进公开 API、隐私告知更新 |
| 备份和数据在同一台机器上 | 中 / 丢数据 | 每天加密备份到 R2，切换前做一次恢复 |
| 源站绕过 Cloudflare | 低 | Tunnel，不开入站端口 |
| 工期超出 | 高 | MVP 只做你提的三件事，每期按 ×1.5 留余量 |
| 工具链版本不一致（vitest 3 和 5） | 低 | 在 P3a 统一 |

---

## 14. 需要你拍板的问题

| # | 问题 | 推荐 |
|---|---|---|
| 0 | Coolify 服务器在哪个地区？朋友们主要从哪里访问？ | 服务器放在大陆以外（HK/JP/SG）。如果用户主要在大陆，前端改用 EdgeOne Pages 国际版（不需要备案） |
| 1 | 三个 secret（`SESSION_SECRET`、`OAUTH_CLIENT_SECRET`、`AI_API_KEY`）的明文还在吗？ | 不管在不在，P2 都重新生成 `SESSION_SECRET` 并存进密码管理器；另外两个找不到明文就轮换 |
| 2 | 生产 SPA 现在用的是哪个网址（workers.dev、自定义域名还是 EdgeOne）？dashboard 里有没有配过 Cron？ | 把旧网址都 301 到新网址；不管有没有 Cron，迁移后统一由 scheduler 负责 |
| 3 | `score.`、`api.`、`api-next.` 这几个子域能用吗？ | 能用就用；`api.` 被占用的话改用 `score-api.` |
| 4 | Nanako OAuth 能不能登记多个回调？是否开放注册？`sub` 是否稳定？`username` 能不能改？ | 管理员改为 `ADMIN_SUBJECT_IDS`。如果是开放注册，参与者身份也改成需要管理员批准 |
| 5 | 前端用哪家 Pages？ | Cloudflare Pages。如果问题 0 的答案是"大陆用户"，改用 EdgeOne 国际版 |
| 6 | PG 放在 compose 里还是用 Coolify 的 Database resource？备份放 R2 可以吗？ | 放在 compose 里，每天加密备份到 R2；如果你想要一键恢复，Database resource 也可以 |
| 7 | 判决播报到频道吗？要不要允许个人选择"不播报"？ | 播报到私有频道，只放固定字段；不提供个人退出选项（为了公平）；默认值在你确认之前保持关闭 |
| 8 | 陈述隐私：网页 API 现在不登录也能看到陈述和申诉理由，要收紧吗？ | 这次一起做：对未登录访客和非当事人隐藏 statement 和 appeal_reason，改动很小 |
| 9 | 裁判身份改成只能由管理员授予？建局要求是参与者？ | 都改。这是上线私信推送之前必须做的 |
| 10 | MVP 只做绑定、查询、判决播报，还是把私信写陈述也算进来？ | MVP 先做你提的三件事，上线后马上做 P6（私信写陈述），这是价值最高的功能 |
| 11 | @EDG 选手 角色手动发还是由 bot 自动发？ | 手动发（几十个人，不值得做审批和对账） |
| 12 | 分享页要不要放信誉分榜的链接？ | 不放，公开页面不展示朋友们的扣分 |
| 13 | 要不要关掉服务器 widget？ | 等 P8 改成由 Gateway 数据生成分享页之后再关，在那之前分享页还依赖它 |
| 14 | 要不要用语音频道数据作为出勤证据？ | 不做，容易冤枉人，也涉及隐私 |
| 15 | 切换窗口安排在什么时候？是否接受"T+25 之后只往前修"？ | 工作日北京时间 02:00；接受 |

