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
   - 生产分支：`main`
   - Custom domain：`community.nanako.org`（如果你想用别的名字，下面所有 `community.` 一起换）
   - 注意：仓库根目录的 `functions/`（EdgeOne 的反代）会被 Pages 一起部署成 Pages Functions，
     挂在 `community.nanako.org/api/*`、`/auth/*` 上。SPA 不会请求它们（所有请求都走
     `VITE_API_BASE`），第 8 步下线 EdgeOne 时删掉 `functions/` 目录即可。
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
   **注意**：EdgeOne 边缘函数反代的上游写死了 workers.dev 地址（`functions/api/[[default]].js`），
   做这一步之前先处理 EdgeOne。
8. **EdgeOne**：在 EdgeOne Pages 项目里把整站重定向到 `https://community.nanako.org`，
   或者直接删除该项目；然后删掉仓库里的 `functions/` 目录。

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
