# 部署指南 — EDG 信誉分（Cloudflare Workers）

本指南假设你已经完成了 [README.md](./README.md) 中的本地开发流程验证，现在要把 EDG 信誉分部署到 Cloudflare 生产环境。

## 0. 前置条件

- 一个 Cloudflare 账号，且已开通 **Workers** 与 **D1**。
- Node.js + npm 已安装。
- Wrangler CLI：可以全局安装，也可以直接用 `npx` 调用，二选一即可。

```bash
# 方式 A：全局安装
npm i -g wrangler

# 方式 B：不装全局，用 npx（下文命令把 `wrangler` 换成 `npx wrangler` 即可）
npx wrangler --version
```

- 登录 Cloudflare：

```bash
wrangler login
```

浏览器会弹出 Cloudflare 授权页面，授权后终端会显示登录成功。

## 1. 创建 D1 数据库

```bash
wrangler d1 create edg-credit
```

命令输出中会包含类似：

```toml
[[d1_databases]]
binding = "DB"
database_name = "edg-credit"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

把返回的 `database_id` 复制粘贴到项目根目录 `wrangler.toml` 里 `[[d1_databases]]` 段的 `database_id` 字段，替换掉占位符 `REPLACE_WITH_YOUR_D1_DATABASE_ID`。

## 2. 远程建表

D1 数据库创建后是空的，需要用 `schema.sql` 建表：

```bash
npm run db:remote
# 等价于: wrangler d1 execute edg-credit --remote --file=./schema.sql
```

## 3. 配置密钥与变量

以下两个是**密钥**，务必通过 `wrangler secret put` 设置，不要写进 `wrangler.toml` 或提交到仓库：

```bash
# 会话签名密钥（HS256）。先生成一个足够长的随机字符串：
openssl rand -base64 48

# 然后把生成的值粘贴进交互式提示中
wrangler secret put SESSION_SECRET

# OAuth 客户端密钥
wrangler secret put OAUTH_CLIENT_SECRET
```

`OAUTH_BASE_URL` 和 `OAUTH_CLIENT_ID` 不是敏感信息，可以二选一：

- **推荐（更灵活）**：也用 secret 设置，便于随时轮换而不改动 `wrangler.toml`：
  ```bash
  wrangler secret put OAUTH_BASE_URL
  wrangler secret put OAUTH_CLIENT_ID
  ```
- **或者**：直接写进 `wrangler.toml` 的 `[vars]` 段（如果仓库是私有的，或者这两个值本身不敏感）：
  ```toml
  [vars]
  OAUTH_BASE_URL = "https://auth.example.com"
  OAUTH_CLIENT_ID = "your-client-id"
  ```

> 注意：如果同一个变量名既在 `[vars]` 里配置又用 `wrangler secret put` 设置，secret 会覆盖 `[vars]` 中的值。

## 4. 在 Nanako OAuth 后台登记回调地址

在 Nanako OAuth 管理后台为本应用登记以下回调 URL（`redirect_uri`）：

- 生产环境：`https://<你的域名>/auth/callback`
- 本地开发（可选，方便本地联调）：`http://localhost:8787/auth/callback`

授权范围（scope）填写：`profile`

> `<你的域名>` 是你在第 6 步绑定的自定义域名，或 Cloudflare 分配的 `*.workers.dev` 域名（例如 `edg-credit.<your-subdomain>.workers.dev`）。

## 5. 构建并部署

```bash
npm run deploy
# 等价于: vite build && wrangler deploy
```

该命令会：
1. 用 Vite 构建前端产物到 `./dist`；
2. 用 `wrangler deploy` 把 Worker 代码 + `./dist` 静态资源一起发布到 Cloudflare。

部署成功后，终端会输出你的 Worker URL（`*.workers.dev` 或已绑定的自定义域名）。

## 6. 绑定自定义域名（可选）

如果你有自己的域名，可以在 Cloudflare Dashboard → Workers & Pages → 你的 Worker → **Settings → Domains & Routes** 中添加自定义域名，Cloudflare 会自动签发证书并接管流量。

如果暂时不需要自定义域名，直接使用部署输出的 `*.workers.dev` 地址即可 —— 但记得第 4 步的回调地址要和实际访问域名保持一致。

## 7. 验证 Cron 每周恢复

`wrangler.toml` 中配置的 Cron 表达式：

```toml
[triggers]
crons = ["0 16 * * 0"]
```

**注意：Cloudflare Cron Trigger 使用 UTC 时区。** `0 16 * * 0` = 每周日 UTC 16:00 = 北京时间（UTC+8）周一 00:00，与 `.dev.vars` / 生产环境变量里的 `RESET_TZ_OFFSET = "8"` 对应。

如果你的团队不在北京时区，需要**同时修改两处**保持一致：
1. `wrangler.toml` 中的 `crons` 表达式（决定 Worker `scheduled()` 何时被触发，UTC 时间）；
2. `RESET_TZ_OFFSET`（决定 `scheduled()` 内部计算「本地周一」用的时区偏移，用于 `week_start` 幂等判断与 `nextResetAt` 展示）。

两者不一致会导致恢复时间点与前端展示的「下次恢复时间」对不上。

验证方法：
```bash
# 查看最近的 Cron 触发与执行日志
wrangler tail
```

或在 Cloudflare Dashboard → Workers & Pages → 你的 Worker → **Triggers** 页面查看 Cron 计划与最近执行记录；也可以直接查询远程 D1 的 `weekly_heals` 表确认某周是否已恢复：

```bash
wrangler d1 execute edg-credit --remote --command="SELECT * FROM weekly_heals ORDER BY week_start DESC LIMIT 5"
```

## 8. 管理员引导

首次部署后，通过 `ADMIN_USERNAMES` 环境变量（逗号分隔用户名）指定谁在登录时自动获得管理员权限：

```toml
# wrangler.toml [vars] 段，或用 wrangler secret put ADMIN_USERNAMES
ADMIN_USERNAMES = "Nanako1900,SomeOtherAdmin"
```

该用户首次通过 OAuth 登录（`/auth/login` → `/auth/callback`）时，Worker 会在 upsert 用户记录时把 `is_admin` 置为 `1`。之后管理员可以通过管理端点（`POST /api/admin/users/:id`）调整任意用户的角色 / 分数，或授予其他人管理员权限。

## 9. 常见问题 (FAQ)

**Q: 部署或访问时报 D1 相关错误 / 找不到数据库？**
检查 `wrangler.toml` 里的 `database_id` 是否还是占位符 `REPLACE_WITH_YOUR_D1_DATABASE_ID`。必须替换成第 1 步 `wrangler d1 create` 返回的真实 ID。

**Q: Worker 启动 / 请求即报错，提示缺少环境变量？**
检查是否已经用 `wrangler secret put` 设置了 `SESSION_SECRET` 和 `OAUTH_CLIENT_SECRET`。这两个是必需的密钥，缺失会导致相关请求（会话签名 / OAuth token 交换）直接失败。可用 `wrangler secret list` 查看已设置的密钥名称（不会显示明文值）。

**Q: OAuth 登录跳转后报 `redirect_uri` 不匹配？**
确认 Nanako OAuth 后台登记的回调地址与实际访问域名**完全一致**（协议、域名、路径均需匹配），包括是否带端口号。生产环境用 `https://<你的域名>/auth/callback`，本地开发用 `http://localhost:8787/auth/callback`。如果同时配置了 `APP_URL`，Worker 会优先用它推导 `redirect_uri`，也要确保它与登记的回调一致。

**Q: 每周恢复的时间点看起来不对？**
Cloudflare Cron 触发器**始终是 UTC 时间**，与本地时区无关。参见第 7 步：确认 `wrangler.toml` 的 `crons` 表达式和 `RESET_TZ_OFFSET` 是否成对匹配。

**Q: OAuth 用户信息字段对不上（用户名 / 头像显示不正确）？**
不同 OAuth 提供方 `userinfo` 返回的字段名可能不同。项目已经做了容错映射（`sub/id/user_id`、`username/name/nickname/preferred_username`、`avatar/picture/avatar_url/photo`），映射逻辑在 `worker/oauth.ts`。如果你的 Nanako OAuth 后台返回的字段不在此列表内，需要在 `worker/oauth.ts` 中补充对应的字段名映射。
