# 部署 Discord bot（P4）

> P4 起 `compose.yaml` 多了一个 `bot` 服务：和 `app` 同一个镜像，只连 Discord Gateway（出站），
> 不开端口、Tunnel 里也不用加任何东西。Coolify 本身见 [DEPLOY-COOLIFY.md](DEPLOY-COOLIFY.md)。
> 绑定页和 bot 都读 PostgreSQL，所以要等 API 切到 Coolify（[DEPLOY-CUTOVER.md](DEPLOY-CUTOVER.md)）之后才有意义。
>
> **合并本期 PR 不会改变线上行为**：`DISCORD_TOKEN` 留空时 `bot` 空闲（不连 Discord，健康检查照常绿）；
> `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` 留空时 `/link/discord` 和 `/api/me/discord` 都是 404，
> 网页上的 Discord 卡片自动隐藏。

| 命令 | 作用 | 谁看得到 |
|---|---|---|
| `/link` | 给一个按钮，跳到 `https://api.nanako.org/link/discord` 绑定账号 | 只有自己 |
| `/unlink` | 解除绑定 | 只有自己 |
| `/score [user]` | 信誉分（查自己时带段位和待办） | 只有自己 |
| `/top` | 排行榜前 10 | 频道里所有人（不 @ 任何人） |
| `/verdicts [user]` | 最近 5 次判决 | 只有自己 |
| `/todo` | 待写陈述、待回应的约局 | 只有自己 |
| `/report` | 最新一期周报 | 频道里所有人 |
| `/notify 开/关` | 私信提醒开关（P6，默认开） | 只有自己 |
| `/yue 时间 [人数]` | 发起约局（P7）：今晚 20/21/22 点、明晚、后天 20 点；卡片发到约局频道 | 只有自己（卡片在频道里） |

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
| `DISCORD_VERDICT_CHANNEL_ID` | bot | 可选：判决播报的私有频道 id，见第 5 节。留空就不播报 |
| `AI_API_KEY` | app + bot | 和网页同一个 key：在 Discord 里写的陈述当场由 AI 裁决（P6） |
| `DISCORD_SESSION_CHANNEL_ID` | bot | 可选：约局卡片发到哪个频道（P7），见第 7 节。留空就不发卡片 |

`DATABASE_URL` 由 `compose.yaml` 拼好，不用填。`DISCORD_TOKEN` 留空时 bot 只是空闲；填了之后
bot 启动时会检查其余变量，缺了或格式不对就直接退出，日志里会列出每一项问题（不会打印 token）。
`app` 没有 `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` 时日志里有一行 `Discord binding disabled`。

改完变量后重新部署整个 stack。

## 4. 谁能用哪些命令

`/score @某人`、`/verdicts @某人` 能把一个 Discord 账号对上他的信誉分账号、分数和扣分记录。
默认服务器里**所有人**都能用这些命令。只想给选手用的话：服务器设置 → 集成 → 这个 bot →
在 `/score`、`/verdicts`（以及想限制的其它命令）上把 `@everyone` 关掉、只允许 `@EDG 选手`，
也可以限制到 `#edg-信誉分` 频道。这是 Discord 自己的权限，bot 不需要改。

## 5. 判决播报（P5）

判决、改判、撤销会自动发到一个私有频道（建议 `#edg-信誉分`，只有 @EDG 选手 能看）。
**默认关闭**：不设 `DISCORD_VERDICT_CHANNEL_ID` 就什么都不发。

1. Discord 里打开开发者模式（用户设置 → 高级），右键频道 → 复制频道 ID。
2. 频道权限里给 bot 的角色：查看频道、发送消息、嵌入链接。
3. Coolify 里设 `DISCORD_VERDICT_CHANNEL_ID`，重新部署 `bot`。日志里会出现
   `posting verdicts to channel …`。

发什么：

- 每个案件**一条帖子**，只有固定字段：名字（不 @）、类型、分数变化、判决方式（当庭 / 缺席 / 管理员改判）、
  网页链接。**不发**事实描述、陈述、AI 的标题和判词：这些是看过陈述之后写的，可能带出私事。
- 改判、撤销时**编辑原帖**（撤销后分数划掉，标「已撤销」），不另发新帖；原帖被删了就按当前状态重发一条。
- 帖子上的「看判词」按钮：当事人、立案人、裁判、管理员（需要已用 `/link` 绑定）点了能看到完整判词，
  只有自己可见；其他人只能看到同样的固定字段。
- 加分不播报；立案、陈述、申诉也不播报（「不做有罪推定」）。

可靠性：

- 事件和判决在**同一个数据库事务**里写入（`outbox` 表，由 `records` 上的触发器产生），判决回滚就没有事件；
  bot 停着的时候事件在表里排队，起来后按顺序补发。
- **超过 24 小时还没发出去的判决不再补发**（例如 bot 停了一天），免得一上线刷屏；已经发过的帖子照常编辑。
- Discord 出错（5xx、网络）时退避重试，最多 8 次（约 20 分钟）后放弃，日志里有 `outbox … is dead`。
- 被 Discord 拒绝（403：频道权限没给）时每 5 分钟重试一次、不计次数，补上权限后会自动发出；
  被拒的重试排在新事件后面，不会挡住别的投递。从第一次被拒起 24 小时后放弃——
  但频道里的**改判、撤销、删帖**永不放弃（改为每小时重试一次，日志每次都有 `refused for over a day`），
  免得撤销了的罚分一直挂着。
- 1 分钟内 5 次**新的** 403 暂停投递 5 分钟，日志里有 `!!! Discord keeps refusing the bot`
  （已经被拒过的事件再被拒不算）。401（token 失效）直接暂停。
- 改判、撤销只编辑原帖；频道里从没发过的案件（例如当时还没配频道）不会因为撤销才冒出来。
  换了 `DISCORD_VERDICT_CHANNEL_ID` 之后，后续的更新发到新频道。
- 管理员删除用户时，他的案件帖子也会从频道里删掉。
- 已处理的事件保留 30 天后自动清理。

## 6. 私信（P6）

已绑定的人会收到**关于自己案件**的私信（`/notify 关` 可以关掉，网页照常能看到一切）：

| 什么时候 | 内容 |
|---|---|
| 被立案后 3 分钟 | 事实描述、截止时间、立案人，附 **[写陈述]** 按钮：点开填写，提交后当场裁决（和网页一样，只能写一次）。3 分钟内撤回或已在网页写完的，不发 |
| 截止前 2 小时 | 还没写陈述时提醒一次；截止时间被顺延，提醒也跟着顺延 |
| 出判决 / 管理员改判 | 完整判词，附 **[申诉]** 按钮（填理由后交管理员复核） |
| 判决撤销 | 分数已退回 |
| 立案被撤回 | 不另发，把原来那条立案私信改成「已撤回」，[写陈述] 按钮随之消失 |
| 有人申诉 | 发给每位已绑定的**管理员**，附网页链接 |

- 提醒类（被立案、快截止）每人每天最多 20 条，多出来的跳过（网页上都有）；判决、改判、撤销、申诉这些**结果**
  不受这个限制，一定会发。
- 对方关闭了服务器私信（Discord 返回 50007）就不再给他发，直到他再用 bot 或 `/notify 开`。
- 私信只发给本人，所以可以带事实描述和完整判词；所有文字照样经过转义，不会变成链接或 @。
- 防刷：裁判资格**只能由管理员授予**（管理员在选手主页点「设为裁判」；网页上不能再自己选「裁判」），
  立案再撤回也计入每天的立案上限；约局点名只能给**报了「来」**的人记缺席 / 迟到，只是被邀请的人不会因此被立案。
- 撤回时，已发出的立案私信和截止提醒都会改成「已撤回」，按钮去掉（即使被告后来关了私信提醒）；
  管理员删除用户时，关于他案件的私信改写成「已删除」，不再显示事实描述。
- **上线 P6 之前清点裁判**：以前人人都能在网页上自封裁判，这些标记不会自动清掉。在 Coolify 的
  postgres 终端里看一眼：
  ```sql
  SELECT id, username, display_name, is_participant FROM users WHERE is_judge = 1 AND is_admin = 0;
  ```
  不该是裁判的人在选手主页点「取消裁判资格」；不在榜上（`is_participant = 0`）的人选手主页打不开，用
  `UPDATE users SET is_judge = 0 WHERE id = '…';`。
- 切换当晚从 D1 导入的待陈述案件**不会**补发「被立案」私信（导入时触发器跳过）。

## 7. 约局（P7）

**约局卡片**（设了 `DISCORD_SESSION_CHANNEL_ID` 才发，建议 `#约局`，给 bot 发消息和嵌入链接的权限）：

- 网页上或用 `/yue` 新建约局时，卡片发到频道：时间（每个人看到自己的时区）、组织者、来 / 可能的人数、报名的人，
  附 **[来] [可能] [不来]** 按钮。按钮走和网页同一个报名逻辑（人数上限、已开局不能改、组织者不能退出）。
  按钮记着它对应的开始时间：改期之后，旧邀请私信里的按钮不会按新时间替人回答（来、可能、不来都一样），而是提示按新时间重新选。
- 有人报名、改时间、取消时**编辑同一张卡片**；一连串变化（比如有人来回点）合并成约 2 秒后的一次编辑。
  取消、开局、结算后按钮消失。
- 换了 `DISCORD_SESSION_CHANNEL_ID`：下次刷新时旧频道里的卡片撤下，还没开的局在新频道发新卡片。

**私信**（已绑定、没关提醒）：

- 邀请和「改时间了」每人每天最多 10 条，和案件提醒**分开计**，邀请再多也挡不住「被立案」私信；
  同一个组织者每天最多给同一个人发 3 条邀请。开局、取消、点名提醒不占这个额度（取消、点名每个局最多一条，
  开局提醒每个开始时间最多一条）。

| 什么时候 | 发给谁 |
|---|---|
| 被邀请 | 被邀请的人，附报名按钮；已经回应过的就不发 |
| 开局前 15 分钟 | 那时报了「来」的人（含组织者） |
| 约局改了时间 | 局里所有人（来 / 可能 / 不来 / 被邀请），附新时间的报名按钮。改期后大家要**重新确认**「来」；连改几次只发一条，第一次改完约 3 分钟后发（开局在即就更早）；开局提醒和点名提醒跟着改期 |
| 约局取消 | 还在局里的人：报了来 / 可能的，和 bot 给他发过邀请或改期私信的被邀请人；已经开局后再取消就不发了 |
| 局结束（开始时间 + 时长，默认 2 小时） | 组织者：去网页点名，结算后才记分；已经提醒过的结束时间不会再提醒 |

`/yue` 只能由已绑定的**上榜选手**发起，时间按 `RESET_TZ_OFFSET`（默认 UTC+8）算，标题自动生成。

- 每个组织者同时最多 5 个还没开的局、24 小时内最多发起 10 个（网页和 `/yue` 一样）。
- 管理员代为取消或改期别人的局时，组织者不会收到私信（以为是他自己改的），从卡片和网页上能看到。
- 切换当晚从 D1 导入的、还没开的局没有卡片，也不会补发邀请、开局提醒和点名提醒（导入时触发器跳过）；
  之后新建的局一切照常，导入的局一有变化（有人报名、改时间）也会补上卡片。

## 8. 验证

1. Coolify → `bot` 的日志里依次看到：
   - `gateway session starts left today: 9xx/1000`
   - `gateway ready as <bot 名字>`
   - `registered 9 slash commands in guild 1114391825336250432`
2. 在服务器里输入 `/`，能看到上面 7 个命令（服务器命令是即时生效的）。
3. `/link` → 点按钮 → 网页登录 Nanako → Discord 授权页 → 确认页点「确认绑定」→ 跳回
   `https://score.nanako.org/?linked=discord`。
4. `/score`：只有自己看得到的分数卡片；`/top`：频道里所有人都看得到的榜，没有人被 @。
5. 想看 Gateway 状态：Coolify 里打开 `bot` 的终端，执行
   `wget -qO- http://127.0.0.1:8788/status`，正常是 `{"gateway":"ready"}`（未连上时返回 503）。
   容器健康检查只看 `/healthz`（进程活着就是 200），Discord 断线不会让容器被重启。

## 9. bot 挂了会怎样

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

## 10. 停用

在 Coolify 里停掉 `bot` 服务即可，其他服务不受影响。要连命令一起去掉，在服务器设置 → 集成里把 bot 移出服务器。
