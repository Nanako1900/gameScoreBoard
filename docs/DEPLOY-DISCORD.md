# 部署 Discord bot

> P4 起 `compose.yaml` 多了一个 `bot` 服务：和 `app` 同一个镜像，只连 Discord Gateway（出站），
> 不开端口，也不用在 Coolify 里给它配域名。Coolify 本身见 [DEPLOY-COOLIFY.md](DEPLOY-COOLIFY.md)。
> 绑定页和 bot 都读 PostgreSQL，所以要等 API 切到 Coolify（[DEPLOY-CUTOVER.md](DEPLOY-CUTOVER.md)）之后才有意义。
>
> **未配置时保持关闭**：`DISCORD_TOKEN` 留空时 `bot` 空闲（不连 Discord，健康检查照常绿）；
> `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` 留空时 `/link/discord` 和 `/api/me/discord*` 都是 404。
> 网页隐藏不受支持的绑定、私信开关和重发控件；入户第 2、3 步不会因此被算作完成，「完成，去首页」仍不可用。

| 命令 | 作用 | 谁看得到 |
|---|---|---|
| `/link` | 给一个按钮，跳到 `https://capi.nanako.org/link/discord` 绑定账号 | 只有自己 |
| `/unlink` | 解除绑定 | 只有自己 |
| `/score [user]` | 信誉分（查自己时带段位和待办） | 只有自己 |
| `/top` | 排行榜前 10 | 频道里所有人（不 @ 任何人） |
| `/verdicts [user]` | 最近 5 次判决 | 只有自己 |
| `/todo` | 待写陈述（可直接点开）；管理员还能看到等得最久的待复核申诉 | 只有自己 |
| `/report` | 最新一期周报 | 频道里所有人 |
| `/notify 开/关` | 私信提醒开关（默认开）；网页 `/welcome` 第 3 步也能开关（`POST /api/me/discord/notify`，和 bot 是同一个开关） | 只有自己 |
| `/help` | 机器人指南，无需绑定；与网页 `/guide`、入户第 5 步和欢迎私信共用文案，附「打开网页」按钮 | 只有自己 |
| `/voice [days] [user]` | 语音进出记录，默认 7 天、最多 14 天；指定他人仅限裁判和管理员 | 只有自己 |

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
     bot 使用 Guilds + GuildVoiceStates（非特权），开发者后台不用为语音记录再开开关；不读任何消息。
4. **OAuth2**：
   - Reset Secret → 复制，就是 `DISCORD_CLIENT_SECRET`；
   - Redirects 加 `https://capi.nanako.org/link/discord/callback`。必须和 `APP_URL` 加
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
- 所有需要留证的语音频道（包括私密频道），机器人也必须有「查看频道」权限；看不见的频道不会被记录。
  不需要连接语音、说话、Presence 或 Server Members 权限，也不要为此增加邀请权限。

## 3. Coolify 环境变量

全部标成 runtime-only，不要勾 build variable。

| 变量 | 给谁 | 值 |
|---|---|---|
| `DISCORD_TOKEN` | bot | 第 1 步 Bot 页的 token |
| `DISCORD_APP_ID` | bot | Application ID |
| `DISCORD_CLIENT_ID` | app | Application ID（同上） |
| `DISCORD_CLIENT_SECRET` | app | 第 1 步 OAuth2 页的 secret |
| `GUILD_ID` / `APP_URL` / `FRONTEND_URL` | app + bot | 默认值就是线上配置，一般不用改。bot 只把命令注册到 `GUILD_ID` 这一个服务器。`FRONTEND_URL` 是网页的根地址：私信和回复里的按钮会直接打开某个案件（`?case=<id>`） |
| `DISCORD_VERDICT_CHANNEL_ID` | bot | 可选：判决播报的私有频道 id，见第 5 节。留空就不播报 |
| `DISCORD_BOARD_CHANNEL_ID` | bot | 可选：信息板所在的文字频道 id；留空就不发送信息板 |
| `AI_API_KEY` | app + bot | 和网页同一个 key：在 Discord 里写的陈述当场由 AI 裁决（P6） |

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
- **周报（P8）**也发在这个频道：每周一上午 10:30（`RESET_TZ_OFFSET` 本地时间）之后、上周的案子都判完时（最多再等到
  周一零点后一个陈述期限加一小时）生成上周战报，约 1 分钟后发出，
  一周一条，不 @ 任何人；AI 文字晚到或管理员重新生成时**编辑原帖**。只发最近一周、已经结束的那周，
  晚了一天以上（bot 停着）就不补发；从 D1 导入的旧周报不发；原帖被删了也不重发。

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

## 6. 私信

已绑定、开启私信且上次未被拒收的人会收到欢迎和**关于自己案件**的私信（`/notify 关` 可以关掉，网页照常能看到一切）：

| 什么时候 | 内容 |
|---|---|
| 新绑或换绑成功（`dm.welcome`） | 机器人指南和网页链接，正文来自 `shared/guide.ts`，与 `/help`、`/guide` 和入户第 5 步共用，包含语音记录告知；信息板频道在 S4 加入 |
| 被立案后 3 分钟 | 事实描述、截止时间、立案人，附 **[写陈述]** 按钮：点开填写，提交后当场裁决（和网页一样，只能写一次）。3 分钟内撤回或已在网页写完的，不发 |
| 截止前 2 小时 | 还没写陈述时提醒一次；截止时间被顺延，提醒也跟着顺延 |
| 出判决 / 管理员改判 | 完整判词，附 **[申诉]** 按钮（填理由后交管理员复核） |
| 判决撤销 | 分数已退回 |
| 立案被撤回 | 不另发，把原来那条立案私信改成「已撤回」，[写陈述] 按钮随之消失 |
| 有人申诉 | 发给每位已绑定的**管理员**，附「去复核」链接，直接打开这个案件 |
| AI 建议升级为团灭级（P8） | 发给**立案的裁判**，附 **[确认升级] [维持原案由]**（和网页同一套规则，只能在被告陈述前处理）；处理之后（不管在哪处理的、或案件已撤回 / 进入裁决）这条私信改写成结果，按钮去掉 |
| 案由在判决前被改了（P8） | 不另发：被告原来的立案私信和截止提醒原地改成新案由，[写陈述] 按钮保留 |
| 管理员直接改了分数（P8） | 本人：旧分 → 新分（实际生效的，超出 0–100 会截断）；分数没变就不发。和判决一样不受每天额度限制，晚了一天以上不补发 |

- 欢迎私信不占案件提醒的每日额度。新绑、换绑才自动发送；原绑定只更新昵称不重发，
  迁移不会给已经绑定的老用户补发，导入期间也不触发。私信开关关闭或 `dm_ok = 0` 时跳过。
- `/welcome` 第 3 步提供「再发一次」：同一账号滚动 24 小时最多 3 次手动重发，自动欢迎不计入。
  `POST /api/me/discord/welcome` 会原子地检查额度、把 `dm_ok` 置回 1、排队并唤醒 bot；
  重发失败或被跳过也占次数，跨解绑 / 换绑仍按同一 Nanako 账号计算。
  私信开关关着时不显示重发，接口也返回 409「先打开私信通知」；超额是 429，维护只读是 503。
  网页只提示「已让机器人再发一次，去 Discord 看看；没收到就刷新本页看原因」，不轮询、不追踪单条私信。
- 第 3 步只根据现有 `notify_dm`、`dm_ok` 判断完成。`dm_ok` 为真也不证明某一条欢迎已送达；
  为假时提示先检查已入群和「允许服务器成员私信」，再手动重试。50007 仍会把 `dm_ok` 置为 0。
- 升级确认私信每位裁判每天最多 10 条，和他自己收到的立案提醒分开计。
- 提醒类（被立案、快截止）每人每天最多 20 条，多出来的跳过（网页上都有）；判决、改判、撤销、申诉这些**结果**
  不受这个限制，一定会发。
- 对方关闭了服务器私信（Discord 返回 50007）就不再给他发，直到他再用 bot、`/notify 开` 或网页手动重发重新开放送达。
- 私信只发给本人，所以可以带事实描述和完整判词；所有文字照样经过转义，不会变成链接或 @。
- 防刷：裁判资格**只能由管理员授予**（管理员在选手主页点「设为裁判」；网页上不能再自己选「裁判」），
  立案再撤回也计入每天的立案上限。迟到、放鸽子由裁判在网页记一笔。
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

## 7. S1 下线与历史兼容

S1 移除约局创建、报名、邀请、点名和结算，以及相应的频道卡片、私信和命令。
旧卡片 / 私信上的 `v1:rsvp:*` 按钮仍会回复「约局功能已下线，这个按钮不再有效。」，只有点击的人能看到。
旧网页地址 `/sessions` 及任意子路径显示下线页；`?session=N` 回首页并提示「约局功能已下线」。

PG 迁移 `0008_sessions_off.sql` 删除约局触发器和未处理的约局 outbox 事件，
再为每张已发出的旧卡片排一条 `session.removed`，由 bot 删除 Discord 原消息和对应的 `discord_messages` 行。
迁移可重复执行，不删除约局表或历史数据；D1 不需要本期迁移。
部署前备份、迁移和 Coolify Redeploy 由机主按 [v6 HANDOFF §6](redesign-v6/HANDOFF.md#6-部署提醒) 执行。

新周报不再统计开局、出勤或组局。旧周报的历史统计字段仍可显示，缺失或为 0 时隐藏对应行。

## S2 入户与欢迎私信上线

S2 新增 `/help`：无需绑定，回复为 ephemeral，仍只在配置的服务器里使用。
S3 新增 `/voice` 后，当前共上表 10 个命令；信息板频道配置在 S4 加入。

PG 迁移 `0009_welcome.sql` 添加 `discord_links` 的插入触发器与 `queue_welcome_resend` 函数，
分别排自动欢迎和受限的手动重发，都会通知 dispatcher；SQL 可重复执行。
自动事件和手动事件的去重键均带 UUID，避免同一秒重绑或同毫秒重发被误合并。
部署前备份、迁移和 Redeploy 由机主按 HANDOFF 执行；D1 没有本期迁移。

网页 `/welcome`、`/guide` 在手机和桌面上都为整页。入户页同时提供名字、身份、绑定和私信设置；
首页访客点「开始」、头像菜单点「编辑身份」「通知与 Discord」都到这里。
绑定回调仍返回 `?linked=discord`，前端显示成功提示后进入 `/welcome`；首次登录的 `?onboarding=1` 同样进入这里。
若原来有案件、旧 session 提示或登录回跳目标，完成入户回首页后才继续，目标不含自动业务操作。
本人可以看自己的绑定昵称，其他公开接口不因此返回 Discord 账号 ID 或频道 ID。

## S3 语音记录

只记录配置服务器内**已绑定成员**的语音进入、离开和换频道时间，以及当时的频道名称；不录音、不读消息。
解绑或换绑会关掉旧账号尚未闭合的段，标为 `unlinked`，历史继续按原 Nanako 账号保留。
记录保留 90 天，只有裁判、管理员和本人能看；网页、接口和命令回复不含 Discord 账号 ID、频道 ID。
私信开关和送达状态不限制语音记录查询。

- `/voice [days] [user]` 只给调用者看：`days` 为 1–14 的整数，默认 7。省略 `user` 查自己；
  指定 `user` 只允许裁判和管理员（包括显式指定自己）。调用者和指定对象都要绑定。
  一条 embed 按天列首次进入、累计时长和各段；超长先省略各段，再压缩汇总，仍保留不确定性说明及「完整记录请找裁判在网页查看」。
- 裁判和管理员从头像菜单「管理」进入 `/admin` 或 `/admin/voice`，看某一天的名单，或某个人最近 7 / 14 / 31 天的明细。
  普通用户打开管理页只会看到「这页不存在」，仍可通过本人接口和 `/voice` 查自己；「记一笔」选人后可在新标签页打开 TA 的语音记录。
- 时间按榜单时区显示；跨午夜的段在第二天标「接上一天」。当天总秒数相加后向下取整到分钟。
  机器人上线时已在语音里、离线后无法确认离开、尚未记录离开，都有明确说明；未闭段的时长按查询时刻估算。
- 覆盖只认数据库已持久化的 `started_at` 至 `last_seen_at`，即使最后心跳很近，也不会推算覆盖到查询时刻。
  未覆盖时段保留秒级边界并显示「这段时间机器人不在线，没有记录不代表没来。」；空记录显示「没有保存的语音记录，不代表没来」。
  另注明「未覆盖表示缺少完整证据，也可能来自记录清理或尚未持久化的心跳尾段。」，并非断言 Gateway 当时必定离线。
  未闭段只有在查询时刻仍有可信覆盖时才标「在语音里」，否则标「尚未记录离开」。记录与缺口都不能单独作为缺席结论。
- API 的日期范围最多 31 天；范围起点早于滚动 90 天保留线即返回 400，并提示首个完整可查的榜单日期。
  部分过期的整日也拒绝，避免把已清理的记录显示成「没有来过」。D1 和 PG 读取规则相同；D1 没有 Gateway 写入器，空表会返回未覆盖时段。

每小时按进入时间清理超过 90 天的整段（包括未闭段）。若被删长段还覆盖保留期内的时间，
同一事务把保留线至这些长段最晚结束点的覆盖撤销（未闭段取清理时刻）；同一时段所有人的覆盖提示都会变为「未覆盖」，
其他人已有的进出记录仍保留，之后的可信覆盖也保留。清理与撤销有一项失败就整体回滚并降级。
旧覆盖游标作废，缓存完整且可用时重新对账，从当前时刻恢复覆盖；仍在频道的绑定成员从当前时刻开新段，不补写过去。
读取接口在读语音段前后各查一次覆盖，只取交集，防止并发清理造成「旧覆盖完整、记录却已删除」的组合。

`/status` 的 `voice` 是运维状态，不是出勤证据：

| 字段 | 含义 |
|---|---|
| `coverage_since` | 当前可信覆盖的 UTC 起点；未建立覆盖或降级时为 null |
| `degraded` | 记录器失败 / 尚未恢复可信覆盖时为 true；需要看日志排查 |
| `open_segments` | 数据库内尚未闭合段数；可能含离线遗留段，不能当实时在线人数。未启用或查询失败为 null |
| `last_error` | 正常为 null；有错只返回「语音记录暂不可用，请查看机器人日志」，不含数据库错误、账号或频道标识 |

HTTP 状态仍只由 Gateway 决定：`gateway: ready` 返回 HTTP 200，其他状态返回 503。
**HTTP 200 不代表语音记录健康**，还要检查 `degraded` 为 false、`coverage_since` 有值。
未配置 token 时 `gateway: disabled`，`coverage_since: null`、`degraded: false`、`open_segments: null`、`last_error: null`；
此时不查数据库。`/healthz` 只检查进程存活，不查数据库，始终保留原有容器存活检查用途。

部署由机主按 [v6 HANDOFF §6](redesign-v6/HANDOFF.md#6-部署提醒) 执行：

1. 先备份，再在 Coolify 里 Redeploy；迁移服务会执行可重复运行的 PG `0010_voice.sql`。
   D1 已有库要由机主执行 `005_voice.sql`，命令见 [README 的 npm scripts](../README.md#npm-scripts)；新库 `schema.sql` 已包含两张语音表。
2. 开发者后台不用新增特权 intent。逐个检查需要留证的语音频道，包括私密频道的「查看频道」权限。
3. 请机主在服务器里发一条公告：从今天起，已绑定成员进出语音频道的时间会被记录，保存 90 天，只有裁判、管理员和本人能看到。
   指南、入户第 5 步和规则页也已告知，老成员仍需要这条公告。
4. 部署后查看 `/status`，确认 `voice.coverage_since` 有值且 `voice.degraded` 为 false；自己进出一次语音，再用 `/voice` 和网页核对。
   测试断线时检查未覆盖提示，不能仅凭容器健康或 Gateway ready 判断记录完整。

## 8. 验证

1. Coolify → `bot` 的日志里依次看到：
   - `gateway session starts left today: 9xx/1000`
   - `gateway ready as <bot 名字>`
   - `registered 10 slash commands in guild 1114391825336250432`
2. 在服务器里输入 `/`，能看到上面 10 个命令（服务器命令是即时生效的）。
3. `/link` → 点按钮 → 网页登录 Nanako → Discord 授权页 → 确认页点「确认绑定」→ 跳回
   `https://community.nanako.org/?linked=discord`，前端进入 `/welcome` 并显示绑定成功提示；开启私信时会收到欢迎指南。
4. `/score`：只有自己看得到的分数卡片；`/top`：频道里所有人都看得到的榜，没有人被 @；未绑定的人也能用 `/help` 看指南。
5. 想看 Gateway 状态：Coolify 里打开 `bot` 的终端，执行
   `wget -qO- http://127.0.0.1:8788/status`，正常示例为
   `{"gateway":"ready","voice":{"coverage_since":"2026-10-27 10:00:00","degraded":false,"open_segments":0,"last_error":null}}`。
   未连上时返回 503；字段含义和语音健康判断见上面的 S3 一节。
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
