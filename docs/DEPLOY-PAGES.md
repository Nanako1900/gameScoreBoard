# P2：SPA 迁到 Cloudflare Pages，Worker 只做 API

> 目标拓扑：`community.nanako.org`（Cloudflare Pages，静态 SPA）+ `capi.nanako.org`
> （现在的 Worker；P3a 起换成 Coolify 上的 Node）。两者同属 `nanako.org`，是
> **同站（same-site）**，所以 `SameSite=Lax` 的会话 cookie 在 SPA 的
> `fetch(…, { credentials: 'include' })` 里照常发送，不需要 `SameSite=None`。
>
> 现在的网址 `score.nanako.org` 是这个 Worker 的 Custom Domain，切换时**保留不动**：
> 设了 `FRONTEND_URL` 之后，Worker 把它上面的页面请求 302 到 `community.nanako.org`，旧链接和书签照常能用。

**合并本期 PR 不会改变线上行为**：所有新行为都由下面的变量开启，变量不设就和现在一样。
切换时**所有人需要重新登录一次**（cookie 换名 + 换 `SESSION_SECRET`），整个迁移只有这一次。

## 代码里新增了什么

| 变量（Worker） | 作用 |
|---|---|
| `HOST_ONLY_COOKIES=1` | cookie 改名为 `__Host-edg_session` / `__Host-edg_oauth_state`：浏览器拒绝任何带 Domain 的同名 cookie，兄弟子域没法伪造或覆盖。不能与 `COOKIE_DOMAIN` 同时设置（会直接报配置错误） |
| `FRONTEND_URL` | 已有：登录后跳回这里。**新增**：设置后，Worker 对所有非 `/api`、`/auth` 的路径返回 **302 + `Cache-Control: no-store`** 到这里（同路径同 query），旧链接自动跳到新站。故意不用 301：浏览器会永久缓存 301，回滚后见过它的人会一直被带到新站 |
| `FRONTEND_ORIGIN` | 已有：允许带凭据的 CORS；同时是 CSRF 允许的 Origin |

| 构建 | 作用 |
|---|---|
| `npm run build:pages` | `vite build` 后生成 `dist/_headers`：CSP（只允许连 `VITE_API_BASE` 的源）、HSTS、`X-Frame-Options` 等，`/assets/*` 永久缓存 |

本地已完整演练过这套拓扑：`wrangler pages dev` 托管 SPA（应用生成的 `_headers`）+
`wrangler dev` 跑 Worker，`__Host-` cookie 登录态、跨源读、带预检的 JSON 写、
不带 body 的 POST（CSRF 检查）、旧链接跳转全部通过，浏览器无 CSP 报错。

## 切换步骤（需要你在各家后台操作）

### 准备（不影响线上）

1. **准备新的 `SESSION_SECRET`**：`openssl rand -base64 48`，存进密码管理器。第 4 步才用。
   - 另外两个 secret（`OAUTH_CLIENT_SECRET`、`AI_API_KEY`）**这一期不用动**。P3a 把后端搬到
     Coolify 时才需要它们的明文；Cloudflare 上的 secret 读不回来，到时如果找不到明文再轮换。
   - **不要**在这里提前轮换：大多数 IdP 一重新生成，旧 secret 立刻失效，而线上 Worker 还在用旧的，
     所有人都会登录失败。如果一定要现在轮换，必须**同一时间**执行
     `wrangler secret put OAUTH_CLIENT_SECRET`（AI 同理）。
2. **Cloudflare Pages 项目**：Workers & Pages → Create → Pages → 连接这个仓库。
   - Build command：`npm run build:pages`
   - Build output：`dist`
   - 环境变量：`VITE_API_BASE=https://capi.nanako.org`
   - 可选：`VITE_DISCORD_INVITE_URL=https://discord.nanako.org`（首页欢迎卡的「加入服务器 ↗」；填分享页，
     不要直接填 discord.gg 邀请码；不填或不是 https 地址时整行隐藏）
   - 生产分支：`main`
   - Custom domain：`community.nanako.org`（如果你想用别的名字，下面所有 `community.` 一起换）
   - 仓库根目录**不能有** `functions/`：Pages 会把它部署成 Pages Functions，挂在 `/api/*`、`/auth/*` 上。
     原来那份 EdgeOne 反代（转发到已下线的 workers.dev）已在 P1-0 删除，见文末「SPA 回退核验（P1-0）」。
   - `dist/` 里**不能有** `404.html`：有它 Pages 就不做 SPA 回退，`/sessions/1` 这类地址会变成 404。
     `npm run build:pages` 发现它（任何层级）会直接失败。
3. **OAuth 回调**：在 nanako.org 的 OAuth 后台给这个 client 登记
   `https://capi.nanako.org/auth/callback`（保留旧回调直到切换完成）。

### 切换（几分钟）

4. 在 Worker 设置里给它加 Custom Domain `capi.nanako.org`（`score.nanako.org` 保留），然后打开
   P2 那几个变量（`APP_URL`、`FRONTEND_URL`、`FRONTEND_ORIGIN`、`HOST_ONLY_COOKIES`，值见 `wrangler.toml` 里的注释），
   并换上第 1 步的 `SESSION_SECRET`。两种做法选一种：
   - **Workers Builds 开着**：在 `wrangler.toml` 的 `[vars]` 里取消注释 P2 那一段，执行
     `wrangler secret put SESSION_SECRET`，再合并到 `main`。
   - **Workers Builds 暂停着**（合并到 `main` 不会部署）：在 Cloudflare 后台 → Worker → Settings →
     Variables and Secrets 里加这 4 个变量，`SESSION_SECRET` 改成新值（类型选 Secret），保存并 Deploy。
     之后**重新开启 Workers Builds 之前**，必须先把 `wrangler.toml` 里 P2 那一段取消注释并合并：
     `wrangler deploy` 会删掉 `wrangler.toml` 里没有的变量，后台加的这几个会被悄悄清掉。
5. 部署生效后：
   - `https://community.nanako.org` 是新站；
   - 旧网址 `score.nanako.org` 和 workers.dev 上的页面请求都 302 到新站；
   - 所有人重新登录一次。
6. **在 iPhone Safari 上实测**：登录 → 刷新 → 关掉浏览器再打开仍是登录态。
   （WebKit 对「IP 和主站差异较大的子域」设置的 cookie 有 7 天上限；Pages 和 Worker 都在
   Cloudflare，理论上不触发，但要实测。）

### 收尾

> 第 7、8 步是**不可回头点**：做完之后再回滚，就要走下面「第 7/8 步之后」那条路。

7. 关掉 `*.workers.dev` 入口：在 `wrangler.toml` **最前面**（`compatibility_date` 那一行下面、
   任何 `[表]` 之前）加 `workers_dev = false` 和 `preview_urls = false`。
   放在 `[vars]` 或 `[[d1_databases]]` 下面都不生效——会被当成那张表的字段，wrangler 只给个警告。
   Workers Builds 暂停着的话，改在后台 → Worker → Settings → Domains & Routes 里把 workers.dev 和
   Preview URLs 关掉；重新开启 Builds 之前同样要先把这两行合并进 `wrangler.toml`。
   EdgeOne 的边缘函数反代（上游写死了 workers.dev）已在 P1-0 删除，做这一步不必再先处理 EdgeOne。
8. **EdgeOne**：已完成。EdgeOne 不再使用，仓库里的 `functions/` 和 `edgeone.json` 已在 P1-0 删除。
   EdgeOne 控制台里如果还留着项目，删掉或整站重定向到 `https://community.nanako.org` 即可，与本仓库无关。

## 回滚

**第 5 步之后、第 7 步之前**：
- 把 P2 那几行 `[vars]` 重新注释掉，**但保留 `FRONTEND_ORIGIN`**，然后部署。Worker 恢复自己托管 SPA，
  旧 cookie 名生效；由于 `SESSION_SECRET` 已换，大家还要再登录一次。
- 保留 `FRONTEND_ORIGIN` 是为了已经打开过 `community.nanako.org` 的人：那份 SPA 仍然直连
  `capi.nanako.org`，没有 CORS 许可就完全加载不出来。等确认没人再用新站，再去掉它。
- 旧链接的跳转是 302 + `no-store`，浏览器不会缓存，回滚后立即恢复正常。
- Pages 项目和 `community.` 域名可以保留。
- 第 4 步如果是在后台加的变量，回滚就在后台删掉这几个变量（同样保留 `FRONTEND_ORIGIN`）再 Deploy。

**第 7/8 步之后**：除了上面几步，还要
- 删掉 `workers_dev = false` / `preview_urls = false`（或改成 `true`），让旧的 workers.dev 入口回来；
- 在 OAuth 后台确认旧回调地址还在（第 3 步说过切换完成前保留它）；
- EdgeOne 如果已经删除也不影响：`score.nanako.org` 一直留在 Worker 上，回滚后它就是入口。

## SPA 回退核验（P1-0）

P1 起前端有真实地址（`/sessions/:id`、`/players/:id`、`/players/:id/cases/:caseId`、`/cases/:id`，以及前端渲染的 404 页）。
任何托管都必须把这些未知路径交给 `index.html`（状态码 200），并且不接管 `/api`、`/auth`、`/link`（SPA 的路由规则也从不使用这三个前缀）。

### 各托管的结论

| 托管 | 现状 | SPA 回退靠什么 | P1-0 做了什么 |
|---|---|---|---|
| Cloudflare Pages（`community.nanako.org`） | 生产前端 | Pages 的规则：部署里**没有** `404.html` 时，未知路径一律返回 `index.html`（200） | `npm run build:pages` 发现 `dist/` 任何层级有 `404.html` 就失败（`scripts/pages-headers.mjs` 的 `assertSpaFallback`，`tests/unit/pages-headers.test.ts` 覆盖） |
| Pages Functions（根目录 `functions/`） | EdgeOne 遗留，被 Pages 当成 Functions 部署在 `/api/*`、`/auth/*` 上，反代到已下线的 workers.dev（实测 404） | — | **删除** `functions/api/[[default]].js`、`functions/auth/[[default]].js` 和 `edgeone.json`（spec §11 第 16 条默认：EdgeOne 已不用）；`tests/unit/pages-headers.test.ts` 断言它们不会回来 |
| EdgeOne Pages | 不再使用 | — | 不需要回退规则；`DEPLOY-EDGEONE.md` 顶部标注「已停用」 |
| 旧 Worker 单源部署（`wrangler.toml` `[assets]`） | 已由机主下线；配置还在，只给本地 `npm run dev` / `npm run preview` 用 | `not_found_handling = "single-page-application"` + `run_worker_first = true`，`worker/index.ts` 的 `app.all('*')` 回退到 `ASSETS` | 只核验、不改：本地 `npx wrangler dev` 实测 `/sessions/1`、`/players/x/cases/1`、`/xyz` 都是 200 SPA 外壳，`/api/config` 是 Worker 的 JSON；`tests/worker/split-deploy.test.ts`「keeps serving the SPA when FRONTEND_URL is unset…」覆盖 `app.all('*')` 的回退 |
| Node API（`capi.nanako.org`） | 生产 API，**不托管前端** | 不回退：`server/src/api.ts` 的 `NO_ASSETS` 对非 API 路径答 404；设了 `FRONTEND_URL`（`compose.yaml` 默认 `https://community.nanako.org`）时，`legacySpaRedirect` 先把它们带着 path 和 query 302 + `no-store` 到前端 | 新增测试：`split-deploy.test.ts`「old links to the P1 routes」、`node-api.test.ts`「createApi — old SPA links on the API host」 |
| Discord 分享页（`discord.nanako.org`） | 独立的静态页，不是这个 SPA | 不适用 | 无 |

### 实测记录

只发 GET。`<预览>` 是这个 PR 分支在 Pages 上的预览地址：机主 push 分支后，在 Cloudflare 后台 → Workers & Pages → 本项目 → Deployments 里找分支 `claude/p1-0-hosting` 的那次部署（分支别名形如 `https://claude-p1-0-hosting.<项目名>.pages.dev`）。

| 检查 | 命令 | 期望 | 本地 `wrangler pages dev` | P1-0 部署前（生产） | PR 预览 | 合并部署后（生产） |
|---|---|---|---|---|---|---|
| 约局地址 | `curl -sI <站点>/sessions/1` | `200`，`text/html`，预览和生产带 `Content-Security-Policy` | 200 text/html，SPA shell | 200 text/html，带 CSP | 待领队填写 | 待领队填写 |
| 案件地址 | `curl -sI <站点>/players/x/cases/1` | `200`，`text/html` | 200 text/html，SPA shell | 200 text/html，带 CSP | 待领队填写 | 待领队填写 |
| 未知地址 | `curl -s -o /dev/null -w '%{http_code}' <站点>/xyz` | `200`（404 由前端渲染） | 200 | 200 | 待领队填写 | 待领队填写 |
| `/api` 不归 Pages 管 | `curl -s -o /dev/null -w '%{http_code} %{content_type}' <站点>/api/config` | 删除后：`200 text/html`（SPA 外壳，不是反代、不是 JSON） | 200 text/html，SPA shell | 404 text/html（Functions 反代到已下线的 workers.dev） | 待领队填写 | 待领队填写 |
| `/auth` 不归 Pages 管 | `curl -sI <站点>/auth/login` | 删除后：`200 text/html`，没有指向 nanako.org 的 302 | 200 text/html，SPA shell | 404 text/html（同上） | 待领队填写 | 待领队填写 |
| Pages 构建日志 | Pages 后台该次部署的 Build log | 没有 `Found Functions directory` / `Compiled Worker successfully`；部署详情的 Functions 页显示没有函数 | 日志里 `Compiled Worker successfully` 出现 0 次 | 有 Functions（由上面两行的 404 推断，执行时没有看后台日志） | 待领队填写 | 待领队填写 |
| 旧主机 302 | `curl -sI 'https://capi.nanako.org/sessions/1?x=1'` | `302`，`location: https://community.nanako.org/sessions/1?x=1`，`cache-control: no-store` | — | 执行时（2026-10-27 11:14 UTC）无法访问：Cloudflare `502`（`error code: 502`，源站没有响应），待领队补测 | — | 待领队填写 |
| API 本身 | `curl -s https://capi.nanako.org/api/config` | `200` JSON | — | 执行时（同上）无法访问：Cloudflare `502`，待领队补测 | — | 待领队填写 |

删除 `functions/` 要等机主合并并重新部署 Pages 才在生产生效：部署后复测 `/api/config` 在 `community.nanako.org` 上应返回 SPA 的 `index.html`（200、`text/html`），而不是反代结果。SPA 自己从不请求这个地址（所有请求都走 `VITE_API_BASE`），所以删除前后用户都感觉不到差别。
