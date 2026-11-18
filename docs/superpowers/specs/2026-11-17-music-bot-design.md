# Music 机器人与网页播放器 · 设计

> 2026-11-17 · 分支 `feat/music-bot` · 状态：机主已确认方向，并补充三项决定（SOCKS 代理、登录保存 30 天、页面登录提示）。尚未实现、未部署。

## 1. 目标

房间成员从 Discord 房内控制卡跳到 Community 网页的播放页，把独立的 Music 机器人邀请进自己的语音房，在网页上搜索并播放网易云音乐。所有播放操作都在网页完成，房间成员共用控制。

机主已确认的四项决定：

| 项 | 决定 |
|---|---|
| Bot 身份 | 独立 Discord 应用 / Token，独立进程。同一时间只服务一个房间，先到先得 |
| 音源 | 进程内置精简的网易云网页端接口（weapi），不加第三方容器 |
| 网易云账号 | 成员在网页扫码登录自己的号，登录态按成员加密保存 30 天；每次会话只使用被显式带入的那一个账号，房间之间不互通 |
| 出口代理 | 管理员在「设置 → 社区管理」配置可选的 SOCKS 代理，用于网易云请求 |
| 操作入口 | Discord 只负责跳转；邀请、登录、点歌、队列、控制全部在 Community 网页；能进该房间的成员都可操作 |

不做（本期）：Discord 内 `/play` 等命令、歌词、多 Bot 池、个人歌单浏览、网易云以外的音源。数据模型按「会话」建模，音源走统一接口（见 3.3），后续加 Bot 池或新音源不需要改表结构。

## 2. 边界与既有契约

- 与信誉分、案件、语音证据完全无关：不读不写这些表，不改变语音记录规则。
- Music 进程与主 Bot、网页 API 是三个进程。Music 崩溃或未配置 Token 时，房管与网站不受影响，播放页显示「Music 离线」。
- 沿用社区契约：浏览器只见不透明引用（房间 ref、会话 ref），不出现 Discord ID、频道 ID、网易云 Cookie。
- 沿用网页身份规则：需登录 Nanako、绑定 Discord 且仍在服务器内；权限判断复用 `canReadRoom`（能查看该房间即可操作）。
- 只读模式（`READ_ONLY`）拒绝邀请与所有播放指令。

## 3. 架构

```
浏览器 /community/music/:roomRef
   │  HTTPS（轮询状态 2s，提交指令）
   ▼
app（Hono API）──── 网易云网页端接口（搜索、歌单、扫码登录）
   │  PostgreSQL：music_sessions / music_commands + pg_notify
   ▼
music 进程（新 compose 服务，同一镜像）
   ├─ Discord Gateway（Guilds + GuildVoiceStates）+ @discordjs/voice（含 DAVE）
   ├─ 网易云：播放前取歌曲地址（地址会过期，不提前取）
   └─ ffmpeg → Ogg/Opus → 语音频道
主 Bot：只负责房内控制卡上的跳转按钮，以及临时房的频道权限
```

### 3.1 模块（`server/src/music/`）

| 文件 | 职责 | 依赖 |
|---|---|---|
| `netease/crypto.ts` | weapi 请求加密（AES-CBC + RSA），纯函数 | node:crypto |
| `netease/client.ts` | `search`、`playlist`、`songUrl`、`qrKey`、`qrCheck`、`account`；输入输出均校验，超时与错误码归一 | fetch（可注入） |
| `queue.ts` | 队列与播放模式的纯函数 reducer（不可变） | 无 |
| `store.ts` | `music_sessions`、`music_commands` 读写、租约、心跳 | pg |
| `secrets.ts` | 网易云 Cookie 与代理地址加解密，复用 `worker/ai/secrets` 与 `AI_CONFIG_MASTER_KEY` | — |
| `proxy.ts` | 读取并校验代理配置，生成带 SOCKS 的请求器；未配置时直连 | socks + undici |
| `source.ts` | 音源接口 `MusicSource`（search / playlist / resolve），网易云是第一个实现 | — |
| `routes.ts` | `/api/community/music/*`，挂在现有社区鉴权后 | store、netease、CommunityService |
| `player.ts` | 语音连接、ffmpeg 管线、播放状态机；Discord/ffmpeg 通过接口注入以便测试 | @discordjs/voice |
| `runtime.ts` | 指令循环：LISTEN + 定时兜底，按序执行并写回状态 | store、player、netease |
| `../music-main.ts` | 进程入口；无 Token 时空转（同主 Bot 的 `idle()`） | — |

前端：`src/components/MusicPage.tsx`（页面与数据）、`MusicPlayer.tsx`（当前播放与控制）、`MusicQueue.tsx`、`MusicSearch.tsx`、`MusicLogin.tsx`（二维码）、`src/music-api.ts`，共享类型在 `shared/music.ts`。

### 3.2 数据（迁移 `server/migrations/0013_music.sql`）

`music_sessions`：`ref`、`room_ref`、`invited_by`（成员 ref）、`status`（`requested`→`connecting`→`active`→`ended`）、`end_reason`、`state`（JSON：当前曲目、队列、模式、音量、是否暂停、`positionMs` 与 `positionAt`）、`state_version`、`account_owner`（成员 ref，可空；指向下面的账号表）、`heartbeat_at`、时间戳。唯一约束：未结束的会话全局至多一个（单 Bot），同一房间至多一个。

`music_commands`：`id`、`session_ref`、`actor`（成员 ref）、`kind`、`payload`、`request_key`（幂等，唯一）、`status`、`error`、时间戳。插入后 `pg_notify('music_commands')`。

`music_accounts`：`member_ref`（主键）、`source`（`netease`）、`cookie_encrypted`、`nickname`、`vip`、`expires_at`（登录起 30 天）、时间戳。到期、主动退出、解绑或离服时删除；网易云返回登录失效时也立即删除。

代理配置存现有 `app_settings`：`music.proxy_url_encrypted`（地址可能带账号密码，故加密）、`music.proxy_audio`（是否连音频下载也走代理）。

会话结束时清空 `account_owner`；已结束会话与指令保留 7 天后清理。

### 3.3 音源接口与出口代理

- `MusicSource` 只有三个方法：`search(keyword)`、`playlist(idOrUrl)`、`resolve(trackId, account?)`（返回可下载的音频地址）。曲目 ID 带音源前缀（`netease:123`），队列与页面不关心音源。
- 本期只实现网易云。后续可接的候选：**Bilibili**（海外可直连、无需登录即可取音频，最适合作为第二音源）、QQ 音乐 / 酷狗 / 酷我（同为非官方接口，海外同样受限）、直链 URL（mp3 / flac）。YouTube 需要捆绑 yt-dlp 且对机房 IP 封锁严格，不建议。
- 代理：仅支持 `socks5://`、`socks5h://`、`socks4://`，保存前校验格式，仅管理员可读写，读取接口只返回「已配置 / 未配置」和主机名，不回显密码。提供「测试连接」按钮（经代理请求一次网易云搜索并返回成功或失败原因）。
- 代理默认只用于网易云接口请求（地区判定发生在取地址这一步）。音频由 music 进程用 Node 下载后喂给 ffmpeg 标准输入，因此打开「音频也走代理」开关即可生效，不依赖 ffmpeg 自身的代理支持。
- app 与 music 两个进程都读取同一份配置，改动在下一次请求生效，无需重启。

## 4. 流程

### 4.1 邀请

1. 主 Bot 的房内控制卡新增一个链接按钮「音乐播放器」，指向 `FRONTEND_URL/community/music/<roomRef>`。Community 的房间卡片也加同一入口。
2. 播放页显示房间名与 Music 状态。点「邀请 Music 进房」→ `POST …/music/:roomRef/invite`。
3. API 校验：成员可查看该房间、房间 `active`、房内至少有一名真人、当前没有未结束会话。已被其他房间占用时返回「Music 正在其他房间使用」，不透露是哪个房间。
4. 临时房：经现有社区操作队列新增 `room.music_access`，由主 Bot 给 Music 账号加查看 / 连接 / 说话权限（锁门、隐藏房也能进），纳入主 Bot 自己的权限模型，避免被对账判成人工改动。固定房不改权限，进不去就如实报「缺少权限」。
5. Music 进程领取会话 → 进语音 → `active`，并在房内文字聊天发一条带播放页链接的提示。30 秒内未连上则结束会话并给出原因。

### 4.2 网易云登录（按成员保存 30 天）

- 播放页「扫码登录网易云」：API 取二维码 key，前端渲染二维码，每 2 秒查一次状态；成功后 Cookie 加密存入该成员的 `music_accounts`，有效期 30 天，页面只显示昵称、是否会员与到期日。
- 30 天内该成员再次使用时免扫码。账号不会自动带入任何房间：成员在播放页点「用我的账号播放」才会把自己设为当前会话的 `account_owner`；邀请者已登录时，邀请确认里可勾选一并带入。
- 会话同一时间只用一个账号；其他已登录成员可以点「换成我的账号」。账号主人或管理员可「停止使用此账号」，会话回到未登录状态。账号主人离开语音房不自动撤回，直到会话结束。
- 不登录也能用，只能播免登录可取到地址的歌曲。
- 登录前页面明示并要求点确认：「这是网易云的非官方接入，账号存在被风控的可能，请自行决定是否登录。登录态加密保存 30 天，可随时在此退出；带入房间后，房内成员可用它播放歌曲，并能看到你的网易云昵称，但看不到其他账号资料。」
- 成员可随时「退出网易云登录」，立即删除保存的登录态，并从正在使用它的会话中撤下。
- Cookie 不返回浏览器、不进日志、不进操作记录。

### 4.3 播放与控制

指令：`enqueue`（单曲 / 歌单导入，队列上限 200）、`remove`、`move_next`、`clear`、`play`、`pause`、`skip`、`seek`、`volume`（0–100）、`mode`（顺序 / 列表循环 / 单曲循环 / 随机）、`leave`。

- 搜索与歌单解析由 API 直接调网易云并返回曲目元数据（名称、歌手、专辑、时长、封面经现有头像白名单同类代理或仅 https 直链，实施时定）；每人限速 1 次 / 秒。
- 指令返回 `202`，网页以会话 `state_version` 的变化确认生效，不把「已提交」显示成「已完成」。进度条由 `positionMs + (now - positionAt)` 在前端推算。
- 取不到地址（会员曲、地区限制、下架）：该曲标记为不可播并自动跳下一首，页面给出原因；连续 5 首失败则暂停并提示。

### 4.4 离开

主动 `leave`、房内连续 60 秒没有真人、空队列闲置 10 分钟、房间关闭、被移出频道、Music 进程重启——都会结束会话、清除登录态、断开语音。Music 在房内时主 Bot 会把它计入人数，所以「没有真人即离开」是保证临时空房能正常回收的必要条件。

## 5. 错误处理

| 情况 | 行为 |
|---|---|
| Music 未配置 / 离线（心跳超 20 秒） | 播放页显示离线，禁用邀请；已有会话标记结束 |
| 网易云接口超时 / 结构变化 | 归一为「网易云暂不可用」，不向浏览器透出原始响应 |
| 语音断线 | 自动重连至多 3 次，失败则结束会话 |
| 指令针对已结束会话 | `409`，页面回到未邀请状态 |
| 主密钥缺失 | 禁用扫码登录与代理配置，其余功能可用 |
| 代理不可达 | 网易云请求失败并提示「出口代理不可用」；不自动回退直连，避免悄悄换出口 |
| 保存的登录态失效 | 删除该账号、会话回到未登录，提示账号主人重新扫码 |

## 6. 测试

- 单元：weapi 加密对固定向量、队列 reducer 全部模式、指令与输入校验、状态推算。
- 服务端（vitest.server）：路由鉴权与可见性、占用冲突、幂等、扫码状态机；网易云与 Discord 语音均用注入的假实现。
- PG（vitest.pg）：迁移、唯一约束、账号 30 天到期与退出删除、通知与兜底轮询。
- 代理：地址校验、不回显密码、未配置直连、不可达时不回退。
- DOM：播放页各状态（未邀请 / 占用 / 离线 / 播放中 / 失败）、二维码流程、权限丢失时清空页面。
- 真实 Discord 与真实网易云由机主验收，沿用本仓库「代理不部署、不做真实远程操作」的约定。

## 7. 上线（由机主执行）

1. Developer Portal 新建应用「Music」，取 Bot Token，邀请进服务器并授予：查看频道、连接、说话、发送消息、嵌入链接。
2. 环境变量：`MUSIC_DISCORD_TOKEN`、`MUSIC_ENABLED`；app 与 music 共用已有的 `AI_CONFIG_MASTER_KEY`。
3. 镜像运行层增加 `ffmpeg`；compose 新增 `music` 服务（无端口、无域名）。
4. 跑迁移 `0013_music.sql`，升级 app / bot / music。

## 8. 风险

- **服务器出口地区**：网易云对海外 IP 限制大量曲目。通过管理页的 SOCKS 代理（国内出口）解决；代理由机主自备。
- **非官方接口**：网页端接口可能随时变动，且自动化调用不在网易云服务条款允许范围内；登录账号存在被风控的可能。页面会提示成员自行决定是否登录。
- **扫码账号由全房间共用播放**：只共享播放能力，不暴露账号资料；登录前有明示确认。
- **登录态保存 30 天**：数据库多了一份长期凭据。以主密钥加密、到期自动删除、成员可随时退出；主密钥泄露等同于这些登录态泄露。
- **内存**：ffmpeg 转码约 50–80 MB，`music` 服务 `mem_limit` 需单独设定（建议 256m）。

## 9. 交付分期（一个计划，三段）

1. 后端核心：迁移、网易云客户端、store、queue、music 进程与指令循环。
2. 网页：播放页、扫码登录、搜索与队列、Community 入口、管理页的代理设置。
3. Discord 衔接与上线：控制卡链接按钮、临时房权限、Dockerfile / compose、部署文档。
