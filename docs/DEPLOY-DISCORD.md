# 部署 Discord bot（P4）

> P4 起 `compose.yaml` 多了一个 `bot` 服务：和 `app` 同一个镜像，只连 Discord Gateway（出站），
> 不开端口、Tunnel 里也不用加任何东西。整体方案见
> [DESIGN-v4-discord-coolify.md](DESIGN-v4-discord-coolify.md) §4–§5，Coolify 本身见
> [DEPLOY-COOLIFY.md](DEPLOY-COOLIFY.md)。

| 命令 | 作用 | 谁看得到 |
|---|---|---|
| `/link` | 给一个按钮，跳到 `https://api.nanako.org/link/discord` 绑定账号 | 只有自己 |
| `/unlink` | 解除绑定 | 只有自己 |
| `/score [user]` | 信誉分（查自己时带段位和待办） | 只有自己 |
| `/top` | 排行榜前 10 | 频道里所有人（不 @ 任何人） |
| `/verdicts [user]` | 最近 5 次判决 | 只有自己 |
| `/todo` | 待写陈述、待回应的约局 | 只有自己 |
| `/report` | 最新一期周报 | 频道里所有人 |

Discord 里**没有任何管理操作**，改判、撤销、改分都只在网页上做。

- 查询超过 2 秒时（数据库慢），bot 会先回一个「正在思考」占位再补上结果。占位一律只有自己可见，
  所以这一次的 `/top`、`/report` 也只有自己看得到，再用一次就好。
- 命令只在 `GUILD_ID` 这个服务器里回答；从别的服务器或私信里调用只会收到「这个 bot 只在 EDG 服务器里用。」

## 1. 在 Developer Portal 建应用

在 <https://discord.com/developers/applications> → New Application（名字例如「EDG 信誉分」）。
团队成员都要开 2FA。

1. **General Information**：复制 **Application ID**。它同时是 `DISCORD_APP_ID`（bot 用）和
   `DISCORD_CLIENT_ID`（app 用），两个变量填同一个数。
   **Interactions Endpoint URL 留空**：bot 走 Gateway，不收 HTTP 回调。
2. **Installation**：Installation Contexts 只勾 Guild Install；Install Link 选 **None**
   （否则下一步关不掉 Public Bot）。
3. **Bot**：
   - Reset Token → 复制，就是 `DISCORD_TOKEN`。只显示一次，**只放进 Coolify**，不要贴到任何地方；
   - **Public Bot 关掉**（只有你能把它拉进服务器）；
   - Requires OAuth2 Code Grant 关掉；
   - Privileged Gateway Intents（Presence / Server Members / Message Content）**全部不开**。
     bot 只用 `Guilds` intent，不读任何消息。
4. **OAuth2**：
   - Reset Secret → 复制，就是 `DISCORD_CLIENT_SECRET`；
   - Redirects 加 `https://api.nanako.org/link/discord/callback`。必须和 `APP_URL` 加
     `/link/discord/callback` **一字不差**，否则 Discord 会拒绝授权。

## 2. 把 bot 拉进服务器

浏览器打开（把 `<APP_ID>` 换成 Application ID）：

```
https://discord.com/oauth2/authorize?client_id=<APP_ID>&scope=bot+applications.commands&permissions=19456&guild_id=1114391825336250432&disable_guild_select=true
```

- scope：`bot` + `applications.commands`；
- `permissions=19456` = View Channels + Send Messages + Embed Links。**不要给 Administrator**，
  也不要在授权页上多勾别的权限。
- 如果 `#edg-信誉分` 是私有频道，在频道权限里给 bot 的角色加上「查看频道」。

## 3. Coolify 环境变量

全部标成 runtime-only，不要勾 build variable。

| 变量 | 给谁 | 值 |
|---|---|---|
| `DISCORD_TOKEN` | bot | 第 1 步 Bot 页的 token |
| `DISCORD_APP_ID` | bot | Application ID |
| `DISCORD_CLIENT_ID` | app | Application ID（同上） |
| `DISCORD_CLIENT_SECRET` | app | 第 1 步 OAuth2 页的 secret |
| `GUILD_ID` / `APP_URL` / `FRONTEND_URL` | app + bot | 默认值就是线上配置，一般不用改。bot 只把命令注册到 `GUILD_ID` 这一个服务器 |

`DATABASE_URL` 由 `compose.yaml` 拼好，不用填。bot 启动时会检查以上变量，缺了或格式不对就直接退出，
日志里会列出每一项问题（不会打印 token）。

改完变量后重新部署整个 stack。

## 4. 验证

1. Coolify → `bot` 的日志里依次看到：
   - `gateway session starts left today: 9xx/1000`
   - `gateway ready as <bot 名字>`
   - `registered 7 slash commands in guild 1114391825336250432`
2. 在服务器里输入 `/`，能看到上面 7 个命令（服务器命令是即时生效的）。
3. `/link` → 点按钮 → 网页登录 Nanako → Discord 授权页 → 确认页点「确认绑定」→ 跳回
   `https://score.nanako.org/?linked=discord`。
4. `/score`：只有自己看得到的分数卡片；`/top`：频道里所有人都看得到的榜，没有人被 @。
5. 想看 Gateway 状态：Coolify 里打开 `bot` 的终端，执行
   `wget -qO- http://127.0.0.1:8788/status`，正常是 `{"gateway":"ready"}`（未连上时返回 503）。
   容器健康检查只看 `/healthz`（进程活着就是 200），Discord 断线不会让容器被重启。

## 5. bot 挂了会怎样

- **网页完全不受影响。** `bot` 是独立容器，`app` 不依赖它；网页上的绑定入口
  （`/link/discord`）由 `app` 提供，照常能用。只是 Discord 里的命令会显示「该应用程序未响应」。
- 进程崩溃由 `restart: unless-stopped` 拉起，断线由 discord.js 自己重连。
- 命令执行出错（例如数据库连不上）时，用户只会看到一条只有自己可见的「出错了，请稍后再试」，
  详细错误在 `bot` 日志里（token 已脱敏）。
- **每日登录次数保护：** Discord 每天只允许约 1000 次 IDENTIFY，用完会**直接重置 bot token**。
  所以 bot 每次启动先查剩余次数，低于 50 就不登录，日志里打出 `!!! NOT LOGGING IN`，
  5 分钟后退出、重启后再查，次数恢复后自动上线。看到这条日志先查清楚是什么让 bot 反复重启。
- 日志里出现 `HTTP 401 (DISCORD_TOKEN is wrong or was reset)`：token 失效了。到 Bot 页 Reset Token，
  更新 Coolify 里的 `DISCORD_TOKEN`，重新部署。bot 每 5 分钟才重试一次，不会刷爆 Discord 的失败请求限额。
- 运行中 token 被重置，日志里是 `!!! gateway closed for good (code 4004)`：bot 不再重连，进程照常活着
  （`/healthz` 仍是 200，`/status` 是 503），按上一条换 token 后重新部署。
- token 泄露：立刻在 Bot 页 Reset Token，旧 token 当场失效，再按上一条更新。

## 6. 停用

在 Coolify 里停掉 `bot` 服务即可，其他服务不受影响。要连命令一起去掉，在服务器设置 → 集成里把 bot 移出服务器。
