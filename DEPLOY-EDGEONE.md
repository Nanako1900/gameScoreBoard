# 拆分部署指南 — 前端 EdgeOne + 后端 Cloudflare

本指南把 EDG 信誉分**前端部署到腾讯 EdgeOne Pages（现 EdgeOne Makers），后端保留在 Cloudflare Worker**。
默认的 [DEPLOY.md](./DEPLOY.md) 是「单 Worker 同时托管前端和 API」的一体化部署；本文档处理拆分后最关键、也最容易被忽略的问题：**跨域会话（Cookie）**。

> 只想一体化部署（前后端都在 Cloudflare）？直接看 [DEPLOY.md](./DEPLOY.md)，无需本文。

---

## 0. 为什么不是「两边各传一份」这么简单

现在登录用的是 **httpOnly 会话 Cookie**（`worker/session.ts` 里 `SameSite=Lax`）。一体化部署时前端和 API 同源，Cookie 是首方的，一切正常。

一旦前端在 EdgeOne、后端在 Cloudflare，两者**不同源**，浏览器会把发往后端的 Cookie 当作**第三方 Cookie**：

- **Safari / 所有 iOS 浏览器**：自 2020 年起默认**完全拦截第三方 Cookie**（ITP）→ 会话 Cookie 被直接丢弃 → **iPhone 用户全体登录失效**。
- Chrome 无痕模式也拦截；且第三方 Cookie 长期在收紧。

所以拆分部署**必须**用下面某种方式让 Cookie 保持「首方」。本指南给出三种方案，**强烈推荐方案 A**。

---

## 1. 三种架构方案

| 方案 | 会话如何保持首方 | 需要自定义域名 / 备案 | Safari 安全 | 代码改动 |
|---|---|:---:|:---:|---|
| **A 边缘函数反代（推荐）** | EdgeOne 边缘函数把 `/api`、`/auth` 反代到 Worker，浏览器**只看到一个 origin**，Cookie 天然首方 | 否（用默认 `*.edgeone.app` + `*.workers.dev` 即可） | ✅ | 最小：加 2 个边缘函数 + 设 `APP_URL` |
| **B 同注册域名子域** | `app.example.com`（EdgeOne）与 `api.example.com`（Worker）同属一个注册域名，Cookie 设 `Domain=.example.com` 后为同站 | 是（两个子域都在你的域名下；大陆加速通常需 ICP 备案） | ✅ | 中：开 CORS + 设 Cookie Domain + 前端 API base |
| **C 跨默认域名直连** | 无法保持首方，只能 `SameSite=None` 跨站 Cookie | 否 | ❌ **Safari 拦截，不推荐** | 中，且登录在 iPhone 上不可用 |

本仓库代码**同时支持三种**，靠环境变量切换，默认即方案 A / 一体化行为。

### 方案 A 数据流

```
浏览器 ──► https://<你的项目>.edgeone.app        (EdgeOne Pages)
              ├── 静态 SPA (dist/)                 ← 直接由 EdgeOne 提供
              ├── /api/*  ─┐  边缘函数 fetch 反代
              └── /auth/* ─┴──► https://edg-credit.<子域>.workers.dev   (Cloudflare Worker)
                                     └── D1 + Cron + Nanako OAuth
   单一浏览器 origin ⇒ httpOnly SameSite=Lax 首方 Cookie；无需 CORS；Safari/iOS 安全
```

---

## 2. 前置条件

- **Cloudflare** 账号（Workers + D1），后端可按 [DEPLOY.md](./DEPLOY.md) 部署。
- **腾讯 EdgeOne** 账号（EdgeOne Pages / Makers），控制台一键开通**永久免费套餐**。
- 域名/备案：**方案 A 不需要**任何自定义域名或 ICP 备案，直接用两个平台的默认域名。方案 B 需要你自有域名，且大陆加速通常需要**备案**。

---

## 3. 方案 A —— 完整步骤（推荐）

顺序有依赖（Worker URL → 填进边缘函数 → EdgeOne 域名 → 回填 Worker 的 `APP_URL`），请按序执行。

### 步骤 1：部署后端 Worker
照 [DEPLOY.md](./DEPLOY.md) 第 1–5 步做完（建 D1、远程建表、`wrangler secret put SESSION_SECRET`/`OAUTH_CLIENT_SECRET`、设 `OAUTH_BASE_URL`/`OAUTH_CLIENT_ID`、`npm run deploy`）。
部署完记下 Worker 地址，形如：`https://edg-credit.<你的子域>.workers.dev`。**方案 A 下 Worker 不需要自定义域名。**

### 步骤 2：把 Worker 地址填进边缘函数
仓库已内置两个 EdgeOne 边缘函数（反向代理）：

- `functions/api/[[default]].js` —— 反代 `/api/**`
- `functions/auth/[[default]].js` —— 反代 `/auth/**`

把里面的 `UPSTREAM` 常量改成你的 Worker 地址，**二选一**：

```js
// functions/api/[[default]].js 和 functions/auth/[[default]].js
const UPSTREAM = 'https://edg-credit.<你的子域>.workers.dev';
```

或**不改代码**，在 EdgeOne 项目里设置环境变量 `WORKER_UPSTREAM`（边缘函数会优先读它）。

> 为什么用边缘函数而不是 `edgeone.json` 的 rewrites？因为 EdgeOne 的 `rewrites` **只能重写到内部静态资源，无法代理到外部 origin**；反代外部 Worker **只能**用边缘函数 `fetch()`。
>
> 代码里的 `fetch(proxied, { redirect: 'manual' })` 很关键：让 Worker 的 302 跳转（OAuth 登录→授权页、回调→首页）和它们的 `Set-Cookie` **原样回传浏览器**，而不是在边缘被跟随掉、把 Cookie 吞掉。
>
> **目录名提醒**：本仓库用经典的 `functions/` 目录（官方 CORS 示例与 pages-templates 一致）。若你的 EdgeOne 项目模板用较新的 `edge-functions/` 版式，把这两个文件移到 `edge-functions/api/[[default]].js`、`edge-functions/auth/[[default]].js` 即可，写法与路由完全相同。

### 步骤 3：确认 `edgeone.json` 构建配置
仓库根目录已内置 `edgeone.json`：

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "installCommand": "npm install"
}
```

与 Vite 输出目录 `dist` 一致。EdgeOne 也会自动识别 Vite 预设，此文件让配置显式、可复现。
（本应用是单页、无客户端路由，SPA 深链接回退非必需；若将来加了前端路由，用「Build Output `config.json`」在 `{"handle":"filesystem"}` 之后加 `{"src":"/.*","dest":"/index.html"}` 做 200 回退，且**不要**在输出根放 `404.html`——会破坏客户端路由。）

### 步骤 4：把前端部署到 EdgeOne
**方式一 · Git 导入（推荐，自动持续部署）**
1. EdgeOne Pages 控制台 → 新建项目 → 导入仓库 `Nanako1900/gameScoreBoard`（授权 GitHub）。
2. 框架预设自动识别为 **Vite**；确认 Build = `npm run build`、Output = `dist`、Root = `./`。
3. 部署，得到 `https://<你的项目>.edgeone.app`。之后每次推送 `main` 自动重新部署。

**方式二 · CLI**
```bash
npm install -g edgeone
edgeone login              # 选 Global 或 China；edgeone whoami 验证
edgeone makers deploy      # 自动构建并部署（旧命令 edgeone pages deploy 仍可用但已弃用）
```

> EdgeOne 会构建整个仓库：跑 `npm run build`（= `vite build`）产出 `dist/`，并识别根目录的 `functions/`。`worker/` 目录与 `wrangler.toml` 会被 EdgeOne 忽略（那是 Cloudflare 的）。两套配置互不干扰。

### 步骤 5：回填 Worker 的 `APP_URL`，并登记 OAuth 回调
这是方案 A 的**关键一步**。Worker 的 `redirect_uri` 必须指向 EdgeOne origin，否则 OAuth 会跳回 `*.workers.dev`（错误）。

1. 把 Worker 的 `APP_URL` 设为你的 EdgeOne 地址：
   - 在 `wrangler.toml` 的 `[vars]` 里取消注释并填写：`APP_URL = "https://<你的项目>.edgeone.app"`，然后 `npm run deploy`；
   - 或 `wrangler secret put APP_URL` 后重新部署。
   > 原理：`worker/oauth.ts` 的 `resolveRedirectUri` 会优先用 `APP_URL` 拼 `redirect_uri`，从而让整个 OAuth 环路都锚在 EdgeOne origin 上。

2. 在 **Nanako OAuth 后台**登记回调地址：
   - `https://<你的项目>.edgeone.app/auth/callback`
   - scope：`profile`

### 步骤 6：验证
打开 `https://<你的项目>.edgeone.app` → 点登录：
- 应跳到 Nanako 授权页 → 授权后跳回 EdgeOne 首页并保持登录；
- 用浏览器开发者工具确认 `edg_session` Cookie 挂在 **`*.edgeone.app`（首方）**、`SameSite=Lax`、`HttpOnly`；
- 榜单 / 记一笔 / 撤销等接口正常。

### 步骤 7：本地开发与注意事项
- 本地开发流程不变：`npm run dev`（Worker，:8787）+ `npm run dev:web`（Vite，:5173，代理 `/api` `/auth`）。见 [README.md](./README.md)。
- ⚠️ **EdgeOne 边缘函数的外部 `fetch` 在 EdgeOne 本地 CLI 调试环境里不通**，反代行为**必须在真实部署上验证**。
- 可选加固：边缘函数转发时加一个共享密钥头（如 `x-edge-proxy: <secret>`），并在 Worker 侧校验，防止有人绕过 EdgeOne 直接打 `*.workers.dev`。

---

## 4. 方案 B —— 同注册域名子域（进阶，需自有域名）

适合你已有域名 `example.com`，希望前端直连后端、无代理跳数。前端 `app.example.com`（EdgeOne 自定义域名），后端 `api.example.com`（Worker 自定义域名）。两者同注册域名 = 同站，Cookie 设 `Domain=.example.com` 即为首方同站，绕开第三方 Cookie 拦截。

1. Worker 侧设变量（`wrangler.toml [vars]` 或 secret）并重新部署：
   ```
   APP_URL         = "https://api.example.com"          # 回调在 api 子域
   FRONTEND_ORIGIN = "https://app.example.com"          # 开启带凭证 CORS（精确回显该 origin）
   FRONTEND_URL    = "https://app.example.com"          # /auth/callback 登录后跳回前端
   COOKIE_DOMAIN   = ".example.com"                     # Cookie 跨子域共享（同站）
   ```
2. Worker 绑定自定义域名 `api.example.com`（Cloudflare 控制台 → 你的 Worker → Settings → Domains & Routes）。
3. 前端构建时设 `VITE_API_BASE=https://api.example.com`（在 EdgeOne 项目的构建环境变量里设置；Vite 自动读取 `VITE_*`）。前端会用它拼接 API 地址并 `credentials:'include'`，登录链接也走该地址。
4. EdgeOne 绑定自定义域名 `app.example.com`。
5. Nanako OAuth 回调登记为 `https://api.example.com/auth/callback`。
6. 此方案**不需要** `functions/` 边缘函数（不走代理），可从 EdgeOne 部署中移除或保留不用。

> 大陆加速下自定义域名通常需 **ICP 备案**；无备案可考虑用国际站或退回方案 A。

---

## 5. 方案 C —— 跨默认域名直连（不推荐）

前端 `*.edgeone.app` 与后端 `*.workers.dev` 属**不同注册域名 = 跨站**。会话 Cookie 只能 `SameSite=None; Secure`（第三方 Cookie），**Safari/iOS 默认拦截**，iPhone 用户登录直接失效；Chrome 无痕也拦。仅在你能接受「只支持部分浏览器」或愿意改用 Bearer Token（放弃 httpOnly、需防 XSS）时才用。

若坚持：Worker 设 `FRONTEND_ORIGIN`、`FRONTEND_URL`、`COOKIE_SAMESITE="None"`，前端设 `VITE_API_BASE` 指向 `*.workers.dev`。

---

## 6. 环境变量总表

| 变量 | 位置 | 方案 | 说明 |
|---|---|:---:|---|
| `APP_URL` | Worker | A / B / C | OAuth `redirect_uri` 的 origin。**方案 A 必须**设为 EdgeOne 地址 |
| `WORKER_UPSTREAM` | EdgeOne 边缘函数 env | A | Worker 上游地址（或直接改 `functions/**/[[default]].js` 里的 `UPSTREAM`） |
| `FRONTEND_ORIGIN` | Worker | B / C | 允许的 CORS 来源（逗号分隔）。设置后开启带凭证 CORS；不设=关闭（方案 A） |
| `FRONTEND_URL` | Worker | B / C | 登录回调后浏览器跳回的前端地址；不设=相对跳转（方案 A） |
| `COOKIE_DOMAIN` | Worker | B | Cookie `Domain`，如 `.example.com`，跨子域共享 |
| `COOKIE_SAMESITE` | Worker | C | `Lax`（默认）/ `None`（跨站）/ `Strict` |
| `VITE_API_BASE` | EdgeOne 构建 env | B / C | 前端调用的 API 基地址；不设=同源相对路径（方案 A） |

> 全部不设 = 一体化 / 方案 A 的单源行为（与 [DEPLOY.md](./DEPLOY.md) 完全一致），向后兼容。

---

## 7. 本次为拆分部署新增/改动的文件

- **新增** `functions/api/[[default]].js`、`functions/auth/[[default]].js` —— EdgeOne 反代边缘函数
- **新增** `edgeone.json` —— EdgeOne 构建配置
- **新增** `src/vite-env.d.ts` —— `VITE_API_BASE` 类型
- **改动（环境变量门控，默认行为不变）** `worker/session.ts`（Cookie SameSite/Domain 可配）、`worker/routes.ts`（按需开启带凭证 CORS + 回调跳前端）、`worker/types.ts`（新增可选 env）、`src/api.ts`（`VITE_API_BASE` + `credentials:'include'` + 导出登录 URL）、`src/components/Header.tsx`（登录按钮走可配地址）

---

## 8. 常见问题（FAQ）

**Q：登录跳转后报 `redirect_uri` 不匹配。**
方案 A 下必须把 Worker 的 `APP_URL` 设为 EdgeOne 地址，且 Nanako 后台登记的回调与之**完全一致**（协议 + 域名 + `/auth/callback`）。

**Q：能登录但一刷新就掉登录 / 接口 401。**
说明会话 Cookie 没被当作首方。方案 A 要确认浏览器全程只在 EdgeOne origin（即 `/api`、`/auth` 确实走了边缘函数反代，而不是前端直接打了 `*.workers.dev`）；方案 B 要确认 `COOKIE_DOMAIN=.example.com` 且两端同注册域名；方案 C 在 Safari 上无解。

**Q：边缘函数不生效 / 反代 500。**
① 确认目录名：经典版 `functions/`，新版 `edge-functions/`（见步骤 2 提醒）。② 确认是 `[[default]].js` catch-all。③ EdgeOne 本地 CLI 调试**无法** fetch 外部，务必在真实部署上测。④ 确认 `UPSTREAM`/`WORKER_UPSTREAM` 是可访问的 Worker 地址。

**Q：CORS 报错（方案 B/C）。**
确认 Worker 设了 `FRONTEND_ORIGIN`=前端精确 origin；前端所有请求 `credentials:'include'`（已内置）；预检 OPTIONS 会返回 204 + 精确回显的 `Access-Control-Allow-Origin` + `Access-Control-Allow-Credentials: true`。

**Q：免费额度够用吗？**
方案 A 下每个 `/api`、`/auth` 请求都会消耗一次 EdgeOne 边缘函数调用（计入免费函数配额）；额度见 EdgeOne 控制台「用量总览」。追求零代理开销可用方案 B。

**Q：每周信誉恢复（Cron）受影响吗？**
不受影响。Cron 仍在 Cloudflare Worker 侧（`wrangler.toml` 的 `[triggers]`），与前端在哪无关。时区说明见 [DEPLOY.md](./DEPLOY.md) 第 7 步。
