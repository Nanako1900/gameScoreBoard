# EDG 信誉分 · 前端重设计分析（v5 草案）

> 本文只做分析和设计，不写代码。内容合并自 6 份分析结果；凡是结论用到的关键事实，都回到代码里核对过（`src/main.tsx:3-4`、`App.tsx:284-285`、`leaderboard.css:151-161`、`Modal.tsx:85-113`、`worker/session.ts:167-170`、`case-reads.ts:73-80`、`InviteBanner.tsx:30`、`SessionsPanel.tsx:58-76`、`worker/sessions.ts:150-165,409-420`、`pages-headers.mjs:24-38`、`tests/dom/session-rsvp-moved.test.tsx:77,87`）。线上数据都是在未登录状态下实测的。

---

## 1. 用户与场景

| 角色 | 规模 | 来访频率 | 来网页做什么 | Discord 已覆盖 |
|---|---|---|---|---|
| 访客（未登录） | 新朋友、被转发链接的人 | 偶尔 | 想知道这是什么、某人为什么是这个分、某局几点开 | 无，网页是唯一入口 |
| 已登录但不在榜上 | 约 4 个账号 | 很少 | 报名约局、围观 | /todo、约局卡片 |
| 选手（在榜上） | 9 人 | 每周几次，被立案或被约时集中来 | 回应邀请、写说明、申诉、看自己的分数和走势 | 邀请、提醒、立案和判决私信，/score，/todo |
| 组织者（任何登录用户都可以） | 发起约局的人 | 每次组局 | 建局、加人、改期、点名结算 | /yue（5 个固定时段，不能点名邀请），结束时私信提醒点名 |
| 裁判（is_judge） | 少数 | 出事时 | 记一笔、撤销、确认升级、改案由 | 无，立案只能在网页做 |
| 管理员 | 1–2 人 | 有申诉时 | 复核、改判、改分、设裁判、配置 AI、重写周报 | /todo 里的「去复核」会跳回网页 |

**网页的定位**：通知已经交给 Discord 私信了，网页不必再当提醒器。它有四件 Discord 做不了的事：

1. **重操作的工作台**：写说明、记一笔、点名、复核、改期、加人。bot 自己也在把人往网页引，见 `server/src/discord/sessions.ts:276`：「在网页上可以看到它、邀请人」。
2. **能分享的公开版面**：前提是 URL 能表达当前视图，现在还做不到。
3. **解释与建立信任**：分数怎么来的、规则是什么、谁能看到什么。
4. **兜底**：没绑 Discord、或者私信送不到（dm_ok=0）的人只能靠网页。

所以网页要从「一张很长的公告板」改成**「待办工作台 + 可分享的版面」**。首屏回答「我现在要做什么」，往下的页面回答「这是怎么回事」。

---

## 2. 现状结构

整个站只有一个页面，没有路由。App 里有 15 个 `useState` 控制各个弹层，URL 不记录任何视图状态。

```
/ (App.tsx:288-399)
├─ Header（sticky：品牌 <a href="/"> 会整页刷新 | 每周恢复倒计时，每秒重渲染 | 登录 / 头像菜单）
│   └─ 编辑我的身份 → OnboardingDialog(+DiscordLinkCard) · AI 裁判配置 → AdminAiPanel · 退出
├─ DiscordLinkedNotice / LinkMissingNotice
├─ InviteBanner（只显示 invites[0]；只有「来 / 不来」）
├─ PendingBanner（只显示截止最早的一条 → StatementDialog）
├─ SessionsPanel（即将开始 | 已结束；组一局 → SessionFormDialog）
│   └─ 行 → SessionDetailDialog(lg) ──嵌套──> RollCallDialog
├─ RedBlackBoard（participants[0] vs participants[last]）
├─ WeeklyReportCard（点 ✕ 后本周不再显示，没有往期）
├─ .app__grid：左 Leaderboard（→ PlayerDetail）+ RulesPanel（默认折叠）｜右 RecordsFeed（50 条）
├─ footer
└─ 裁判 FAB「记一笔」→ CaseDialog
PlayerDetail 点「说明情况」→ 先关掉 PlayerDetail，再打开 StatementDialog（替换而不是嵌套，App.tsx:456-460）
深链 ?case / ?session / ?linked=discord / ?onboarding=1：挂载时读一次，随即从 URL 去掉
```

实测（未登录）：
- **375×812**：总高 5180px，约 6.4 屏。红黑榜从 274px 开始，高 838px；战报从 1130px 开始，高 538px；**信誉榜从 1686px 开始，已经是第 3 屏**；动态从 2462px 开始，高 2616px。
- **1280×800**：总高 3567px。左栏 949px，右栏 2425px，左下留出约 1476px 空白。

---

## 3. 问题清单（已去重，按严重度排序）

### 高

| # | 问题 | 证据 | 影响谁 |
|---|---|---|---|
| H1 | URL 不记录视图：后退、刷新、分享都会丢失当前页面；Android 返回键直接离开网站 | `App.tsx:121-144`；只在 `:169-173,188-192` 调了 replaceState，没有 pushState，也没有 popstate；线上 `history.length=1` | 所有人 |
| H2 | 手机上长弹层像整页一样，却很难关掉 | `modal.css:1-31`、`Modal.tsx:145-152`；线上 `/?case=24` 的面板高 3729px，✕ 按钮在 top=-17，已在屏幕外 | 从 Discord 点进来的人 |
| H3 | 登录会丢掉深链；访客也看不出登录后能做什么 | `Header.tsx:150`；`session.ts:167-170` 只放行 `/link/*`；`routes.ts:631-632`；`App.tsx:162-174`；`SessionDetailDialog.tsx:79-81` | 访客、被邀请的人 |
| H4 | 组织者、裁判、管理员都没有待办入口 | `App.tsx:313-315`；`SessionsPanel.tsx:173`；`RecordsFeed.tsx:88-95`；`pending.appeals` 只出现在 `types.ts:168`；线上 session #3 已开局，状态仍是 open | 组织者、裁判、管理员 |
| H5 | 「头号鸽王」是按排序硬选出来的：满分并列时按名字排，92 分、段位写着「靠谱」的人也会上黑榜；标签写「本周」，算的却是总分 | `App.tsx:285`；`db.ts:76-77`；`RedBlackBoard.tsx:79,86,102`；线上同一屏出现了两个鸽王 | 排在最后的人、所有首次访问的人 |
| H6 | 手机上信誉榜看不到分数 | `leaderboard.css:151-161` 隐藏了 gauge，而分数只显示在 gauge 里 | 手机用户 |
| H7 | 手机上要滑到第 3 屏才看到计分板 | 实测数据；`RecordsFeed.tsx:42-46`；`red-black-board.css:178-197` | 手机用户 |
| H8 | CSS 层叠顺序整体颠倒 | `main.tsx:3-4` 先导入 App 再导入 theme.css，导致弹窗阴影、绑定按钮的蓝色、撤销按钮的红色、胶囊形圆角都被覆盖 | 所有人；管理员误点的风险最大 |
| H9 | 金色主按钮没有键盘焦点环；强制颜色模式下全站都没有 | `theme.css:141-149,223-228` | 键盘用户、高对比度模式用户 |
| H10 | `--faint` 的对比度只有 2.80–3.33:1，却用在 36 个地方，包括「未回应」和隐私告知；输入框边框对比度只有 1.23:1 | `session-detail.css:123-131`、`statement-dialog.css:104-107` | 所有人 |
| H11 | 局建好之后不能再叫人，可 /yue 却让人去网页邀请 | `sessions.ts:409-472`；`SessionDetailDialog.tsx:185-210`；`discord/sessions.ts:276` | 组织者 |
| H12 | 改期的后端已经做好了，但没有入口；只能取消再重建，会多发一轮私信、多占额度 | `api.ts:231` 没有调用方；`sessions.ts:455-466`；`0005_sessions.sql:141-155` | 组织者、已报名的人 |
| H13 | 写了一半的长文本，碰一下就没了 | `Modal.tsx:86-89,135`；`CaseDialog.tsx:59-62`；`App.tsx:401-409` | 当事人、裁判、管理员 |
| H14 | 申诉点一下就提交，不用写理由 | `PlayerDetail.tsx:257`；`api.ts:207` 其实支持 reason；bot 那边也有填理由的弹窗（`case-actions.ts:118-122`） | 被判罚的人、管理员 |
| H15 | 没有复核队列，也没有「维持原判」；改判会覆盖原来的判词 | `case-reads.ts:200-218`；`cases.ts:475-486` | 管理员、申诉人 |
| H16 | 记一笔后弹窗直接关掉，看不到归类结果，也没法改案由；后端串行调用 AI，最坏要等 8×20 秒 | `CaseDialog.tsx:105-106`；`reclassifyCase` 没有调用方；`case-filing.ts:288-306` | 裁判 |

### 中

| # | 问题 | 证据 |
|---|---|---|
| M1 | 同一个邀请显示在两处，状态不同步 | `SessionsPanel.tsx:58-76` |
| M2 | 横幅只显示第一个邀请；列表里看不出哪局在等我回复、都有谁会来 | `InviteBanner.tsx:30,62`；`SessionsPanel.tsx:143-196` |
| M3 | 改期后需要重新确认的邀请，看起来和新邀请一样 | `sessions.ts:461-466`；对比 bot 的 `discord/sessions.ts:182-186` |
| M4 | 局一开始就被算进「已结束」；被取消的局直接消失 | `sessions.ts:155,163` |
| M5 | 判决前，指控对访客公开，被告的说明却是隐藏的，违背 v4 §4.6「不做有罪推定」 | `case-reads.ts:73-80`；`RecordsFeed.tsx:105-111`；`VerdictCard.tsx:84-89,160-167` |
| M6 | 段位和段位说明（比如「建议收押金」）对所有人公开；bot 的规则是 "The tier is for its owner alone" | `scoring.ts:178-180`；`commands.ts:213` |
| M7 | 每周 +15 的回血几乎看不出来 | `Header.tsx:76-79`；`db.ts:312-315`；`StatementDialog.tsx:70-81` |
| M8 | 说不清分数从哪来：走势图不写原因；改分不留理由；记录数是用最近 50 条推算的 | `HistoryChart.tsx:29`；`App.tsx:68,97-119` |
| M9 | 战报自相矛盾：立案数是 0，却有「鸽王 -3」；标题写上周，内容写本周 | `report.ts:118-127` 与 `:141-153`；`WeeklyReportCard.tsx:108` |
| M10 | 嵌套弹层里按 Esc 会把外层一起关掉，点名结果随之丢失；Tab 焦点也会被抢走（根据代码推断，未实际复现） | `Modal.tsx:85-113` |
| M11 | 全量刷新失败时整页报错，刚出来的判决也一起被卸载 | `App.tsx:146-156,247-250,269-281` |
| M12 | 找一个案件要绕三步；约局里的案件卡不能操作 | `RecordsFeed.tsx:57-131`；`App.tsx:365`；`SessionDetailDialog.tsx:178-180` |
| M13 | 没有「我的」入口；Discord 绑定藏得很深，也没说清绑定有什么好处 | `Header.tsx:98-147`；`DiscordLinkCard.tsx:118-119`；`link-routes.ts:272-279` |
| M14 | 不在榜上的人邀请不到，也设不了裁判，而后端其实都支持 | `SessionFormDialog.tsx:35-38`；`db.ts:76`；`sessions.ts:366-376` |
| M15 | 破坏性操作点一下就执行；15 分钟撤销窗口也不显示剩余时间。项目里已有可复用的确认写法：AdminScoreForm、DiscordLinkCard | `SessionDetailDialog.tsx:187-195`；`PlayerDetail.tsx:44,51-58,174-183,338-357` |
| M16 | 用词混乱：「裁判」一个词有三种意思；「陈述」说不清是谁的；「撤案」和「撤销」分不开 | `VerdictCard.tsx:68,86`；`case-actions.ts:1`；`scoring.ts:155-156` |
| M17 | 已撤案的案件仍显示「按缺席裁决」 | `VerdictCard.tsx:91-104` |
| M18 | 隐私范围写得含糊；也没告诉用户指控本身是公开的 | `StatementDialog.tsx:125`；`case-reads.ts:58-66` |
| M19 | 时间不标时区；「本地时区」是写死的；网页和 /yue 用的时区不一样；截止时间只显示相对时间 | `RulesPanel.tsx:36`；`quickTime.ts:34-40`；`time.ts:80-86` |
| M20 | 没告诉用户「开局前说不来不扣分」；三个地方的叫法不一致 | CONTRACT.md:323-324；`InviteBanner.tsx:69-85`；`attendance.ts:41` |
| M21 | 首次登录默认就上榜，后果没讲；先去绑定会丢掉还没保存的选择 | `OnboardingDialog.tsx:45-53,145`；`DiscordLinkCard.tsx:120-122` |
| M22 | 组织者不知道被邀请的人能不能收到通知 | `SessionFormDialog.tsx:171-173`；`dispatcher.ts:369-378,576-578` |
| M23 | 首次访问没有任何介绍；分享出去的预览里写着「头号鸽王」 | `index.html:7` |
| M24 | 金色一种颜色承担七种含义；两档段位色对比度只有 1.15:1；红色卡片配了蓝色圆环 | `scoring.ts:175,178`；`RedBlackBoard.tsx:23-27,38` |
| M25 | 字号太碎，中文最小用到 0.64rem；display 字体不含中文字形 | `theme.css:47` |
| M26 | 手机上走势图的字只有 6px，只能靠悬停查看 | `HistoryChart.tsx:11-12,84-90` |
| M27 | 桌面端左右两栏高度失衡 | `app.css:84-101` |
| M28 | AI 试跑用的是已保存的配置，不是当前草稿；提示里还写着 wrangler | `AdminAiPanel.tsx:107,157-158` |
| M29 | 所有代码打成一个 233KB 的包 | `App.tsx:30-42` |
| M30 | Pages 预览环境连不上 API | `compose.yaml:99`；`routes.ts:144-154` |

### 低

- 管理工具分散在各处。
- 规则和战报不好找，也没有往期。
- 不存在的页面不报 404；品牌链接会整页刷新。
- 同分仍硬排名次，还发奖牌。
- 用 emoji 当语义图标。
- 部分触控区域太小，hover 状态没有保护。
- 断点和同类样式有好几套写法。
- 没有骨架屏和空状态。
- tablist 只实现了一半。
- 没有浅色模式。
- 字体阻塞渲染；Header 每秒重渲染一次。
- 点名不能补录，有人退出也不提醒。
- 记一笔只能扣分。
- 倒计时不刷新。
- 不能一键退出所有设备。
- 遗留的 Pages Functions 占用了 `/api` 和 `/auth`。

---

## 4. 邀请功能现状与整合

### 4.1 生命周期

| 步骤 | 网页 | Bot | 缺口 |
|---|---|---|---|
| 创建 | 用浏览器时区；只能邀请在榜的人；不能设人数 | /yue 用看板时区，可以设人数，但不能邀请人，而且只有在榜的人能用 | 时区和权限不一致 |
| 邀请 | 只能在创建时附上 | 无 | **建完之后不能再加人** |
| 通知 | 横幅只显示 1 个；只在页面加载时拉一次 | 带 3 个按钮的私信、频道卡片、/todo，有发送额度 | 网页不是实时的；组织者不知道谁收不到 |
| 报名 | 各处叫法不一致；会带 starts_at，冲突时返回 409 | 按钮里带着时间 | 没有反馈，不能撤回，各处不同步 |
| 提醒 | 无 | 开局前 15 分钟 | 没绑 Discord 的人收不到（可以用 .ics 补） |
| 改期 | **没有界面** | 没有命令，但改期后会合并发私信 | 只差一个入口和改期说明 |
| 取消 | 点一下就取消 | 会发私信 | 不能撤回；网页上直接消失 |
| 进行中 | 被归到「已结束」 | 刷新卡片 | 缺少这个状态 |
| 点名 | 嵌套弹层 | 结束时私信组织者 | 首页看不到；不能补录；按 Esc 会丢结果 |
| 结算 | 只给「在榜 + 报了来 + 不是组织者」的人生成草稿 | 立案私信 | 约局和案件之间没有关联 |
| 分享 | `/?session=N`，只读，读完就从 URL 去掉 | 卡片和私信都会带上 | 未登录的人点进来没有下一步，登录后也回不到这一局 |

### 4.2 「邀请」的其他含义

1. **Discord 服务器邀请页**（discord.nanako.org）：网页上从来没有链接过它；「绑定后发欢迎私信」也没有实现。
2. **Discord 绑定**：入口藏得深；看不到 notify_dm 和 dm_ok。
3. **新人上榜**：没有邀请链接，也看不出是谁拉进来的。
4. **分享链接**：它本身就是一种邀请，但走一遍登录就丢了。

### 4.3 整合方案

**A. 统一的待办 / 邀请收件箱**（M，前端可以先做）
- 收进这些内容：全部邀请（区分新邀请和改期）、我答应过的局（附一句「来不了？现在说不扣分」）、待写的说明、待点名、待确认的升级、待复核的申诉。
- 内容和 bot 的 /todo 对齐。
- 先用现有接口加 allSettled 拼起来；以后可以加一个 `GET /api/me/todo`。

**B. 组织者控制台**（M，需要后端）
- 支持再叫人、改时间（直接用现有的 PATCH，提示「N 个人需要重新确认」）、分享链接、导出 .ics。
- 取消要二次确认，可以写理由。
- 参与者按「来 / 待定 / 没回 / 不来」分组显示。
- 后端需要新增 `POST /api/sessions/:id/invite`（触发器会自动发私信）和 `cancel_reason` 字段。

**C. 统一数据源，加上邀请上下文**（S/M）
- 横幅、列表、详情三处共用一份数据，保持同步。
- 等我回复的局显示「等你回」并置顶，附上参与者头像。
- 操作后弹出 toast，可以撤回。
- tab 改成「接下来 / 进行中·待点名 / 我的」。
- 后端需要补 `prev_rsvp`、`prev_starts_at`、`reason`、`going_preview`；迁移要同时兼容 D1 和 PG。

**D. 能用的邀请链接**（S，纯前端）
- 跳转登录前，把目标页面和要做的动作存进 sessionStorage。
- 登录回来后先问一句「继续报名？」，不自动替用户写入。
- 未登录时显示「登录后报名」。
- 如果以后改成服务端回跳，只能用签过名的白名单地址。

**E. 邀请朋友入网**（M）
- 「通知与 Discord」页分三步：加入服务器 → 绑定账号 → 私信开关和送达状态。
- 可邀请名单按「上次一起玩的 / 在榜的人 / 其他朋友」分组。
- 后端：discord 接口返回 notify_dm 和 dm_ok；新增 `POST /api/me/discord/notify`（只在 Node 端实现）；新增 `GET /api/users/invitable`（需要登录，不返回 Discord 字段）。能收到通知的人数只显示总数。

**以后再做**：有人退出或人凑齐时提醒组织者；补录临时来的人（walkin）；固定周期局；webcal 日历订阅。

---

## 5. 人性化机会（按价值和工作量排序）

| 序 | 机会 | 工作量 | 理由 |
|---|---|---|---|
| 1 | 红黑榜去羞辱化：评选设门槛，没人达标时显示「全员守约 🎉」；只算本周；手机上压缩到约 120px | S | 梗要有出处 |
| 2 | 「我的今天」：加一句「你不在的这几天发生了什么」的摘要 | M | 回来的人第一眼就知道该做什么 |
| 3 | 让宽恕看得见：显示回血时间和预计回到多少分；回到满分时庆祝一下 | S | **最该放软语气的地方** |
| 4 | 草稿保护，关闭前先确认 | S | 陈述只能交一次 |
| 5 | 申诉要写理由，并且二次确认 | S | 接口已经支持 |
| 6 | 统一的「确认 + 撤回」：记一笔后 3 分钟内可以撤回；撤销按钮上显示剩余时间 | M | 复用现有写法 |
| 7 | 写清楚「开局前说不来不扣分」，提供一键改成「不来」 | S | 这正是要鼓励的行为 |
| 8 | 隐私对齐：判决前不公开指控；段位说明只给本人看 | S/M | 第二个该放软语气的地方 |
| 9 | 时间同时显示绝对和相对时间，并标注看板时区 | S | |
| 10 | 页面保持新鲜，出错不崩；标签页标题显示待办数 | S | |
| 11 | 新访客欢迎卡；首次登录讲清后果，可以选「先看看」 | S | |
| 12 | 分数账本 | M，需要后端 | |
| 13 | 统一用词，配一份 30 秒指南 | S | |
| 14 | 写陈述时的快捷片段 | S | |
| 15 | 可读性和无障碍 | S | |
| 16 | PWA 基础 | S | |
| 17 | 连胜、请假、延期 | L | 先定公平规则 |

**语气原则**：约局、战报正文、空状态、庆祝这些地方照常玩梗。立案、判决、低分、黑榜、报错这些地方要放软：数字照实写，称号要有门槛，判决前不暗示有罪。

---

## 6. 必须保留的约束

- **深链永久兼容**：`/?case=N`、`/?session=N`、`/?linked=discord[&onboarding=1]`、`/?onboarding=1` 都要一直能用。CONTRACT.md:410-417 原文：「Only a positive integer id is read … stripped at once … A link never writes.」首次登录引导的优先级高于深链。
- **测试锁定的内容**：
  - 每个面板只能有一个「来」（`session-rsvp-moved.test.tsx:77,87`）。
  - 首屏请求的 URL 写死在测试里；新增的请求失败时不能拖垮页面。
  - 页面上要有 /约局/ 标题，以及 /上周战报/ /往期战报/。
  - 以下文案不能改：调整分数、改分、确认改分、设为裁判、取消裁判资格、确认是团灭级、选择身份、绑定 Discord、解绑、确认解绑、Discord 绑定成功、关闭提示。
  - 类名 `vc--focus` 和 `.feed-row__status--escalate` 不能改。
  - 组件签名不能改。
- **隐私**：
  - 脱敏后显示「写了说明」，不能写成「缺席」。
  - 遵守 v4 §4.6 的「不做有罪推定」和「段位只给本人看」。
  - 不暴露 `discord_*` 字段；链接里只用 id。
  - 判决前不能把分数变化显示成 0。
  - fallback 判决要和 AI 判决有明显区分。
- **鉴权与托管**：
  - 登录是顶层页面跳转；cookie 是 `__Host-` 前缀、SameSite=Lax；登录状态只能通过 `/api/me` 判断。
  - `safeNextPath` 的注释：「`next` can never become an open redirect」。
  - CORS 只允许 Content-Type 和 Accept 两个请求头。
  - CSP 的内容被测试逐字锁定：`script-src 'self'`，不能内联 style。
  - 不能有 404.html；路由不能用 `/api`、`/auth`、`/link` 开头。
  - 新接口返回 404 时，前端要静默降级。
- **领域规则**：
  - invited 只能由组织者设置；只有 going 占名额、参与计分。
  - 报名要带上 starts_at，遇到 409 先刷新再解释原因。
  - 结算时加分项默认勾选，扣分项默认不勾。
  - 说明只能交一次；升级必须人工确认；裁判由管理员任命。
  - 额度保持 10 / 3 / 20 / 5 / 10。
  - 常量只从 `shared/*` 读取。
  - 战报数字只来自 SQL。
  - API Key 不经过前端。
- **无障碍**：
  - DOM 顺序就是阅读顺序。`App.tsx:298-307` 的注释写着：「set in the DOM rather than with CSS `order` on purpose … One order, three consumers.」
  - CONTRACT.md:406-407 规定邀请排在战报前面。
  - Modal 要保留焦点陷阱、inert 和关闭后的焦点还原（`modal-focus.test.tsx`）。
  - 选中状态不能只靠颜色表示。
  - 用 `pointer:coarse` 判断触控尺寸。
  - 输入框字号不低于 16px。
  - 支持 reduced-motion。
  - 确认操作后的焦点落点保持不变。

---

## 7. 技术底座

- **原样保留（约 22%）**：Avatar、ScoreGauge、TierBadge、Modal、SentencingScale、LinkMissingNotice，以及 api、types、lib、shared 和 token 骨架。
- **换皮或换宿主（约 50%）**：各个对话框、VerdictCard、DiscordLinkCard、Leaderboard 的行、RecordsFeed、WeeklyReportCard、RulesPanel、HistoryChart；SessionDetail 和 AdminAi 改成独立页面。
- **重写（约 28%）**：App 外壳和布局、Header、RedBlackBoard、待办和约局区、PlayerDetail。
- **先修地基（每项都是 S）**：
  - 修正层叠顺序，或者改用 `@layer`。
  - 焦点环改用 outline，并支持 forced-colors。
  - Modal 改为栈管理，增加底部抽屉样式。
  - token 拆成两层。
- **路由**：
  - 手写 60–80 行，或者用 wouter。
  - 路径包括 `/`、`/sessions(/:id)`、`/board`、`/players/:id`、`/cases/:id`、`/me`、`/rules`、`/report`、`/admin`，以及 NotFound。
  - 旧链接用 replaceState 转到新路径。
  - 用 lazy 拆包。
  - 字体改为自托管并加中文回退，CSP 里去掉 Google Fonts。
- **数据层**：
  - 用 `useResource(key)` 精确失效。
  - 请求失败时保留旧数据。
  - 页面重新可见时（visibilitychange）重新拉取。
  - 操作采用乐观更新。
  - 测试依赖的 URL 保持不变。
- **需要新增的接口**（★ 表示整合邀请必需）：
  - ★ `POST /api/sessions/:id/invite`
  - ★ `GET /api/users/invitable`
  - ★ invites 增加 `reason` 和 `prev_rsvp`；session 增加 `going_preview`
  - ★ discord 返回 `notify_dm` 和 `dm_ok`；新增 `POST /api/me/discord/notify`
  - 可选：`GET /api/me/todo`
  - 维持原判（uphold）
  - `GET /api/admin/users`
  - records 支持 `mine=filed`、OR 查询和游标分页
  - leaderboard 返回 `record_count` 和 `week_delta`
  - history 和改分记录带上 `reason`
  - redactRecord 在判决前隐藏 claim
  - 往期战报
  - AI 试跑能用草稿配置
- **已有、前端直接接上就能用**：`updateSession`、`scope=mine`、`status=appealed`、`appealCase(id, reason)`、`reclassifyCase`。

---

## 8. 设计原则草案

1. **首屏回答「我现在要做什么」**：所有角色的待办都汇总在这里，邀请排在战报前面。
2. **URL 就是视图**：链接里只用 id；后退键关的是当前视图；旧链接永久有效。
3. **一件事只有一份数据**：各处同步，操作有反馈，能撤回。
4. **梗要有出处，罚要有出路**：称号有门槛；扣分时写明回血时间和申诉入口；判决前不暗示有罪。
5. **网页不比 Discord 宽松**：用词、时区、RSVP 标签都和 Discord 保持一致。
6. **手机优先，计分板优先**：1–1.5 屏内看到待办、自己的分数和前几名；分数在任何地方都能看到。
7. **默认有安全网**：危险操作要确认，长文本要有草稿，出错只降级局部。
8. **底座克制**：先修地基，再统一组件原语；不加重依赖；遵守 CSP；DOM 顺序就是视觉顺序。

---

## 9. 待决问题

1. 要不要引入路由？案件做成独立页面，还是在选手页里定位？
2. 红黑榜：加门槛、和战报合并，还是只保留「本周之星」？
3. 判决前的指控和段位说明公开到什么程度？要不要和 bot 一起改？
4. 网页和 /yue 发起约局的权限要不要统一？
5. 能不能邀请不在榜上的人？他们参加后怎么点名？
6. 复核后还能再申诉吗？要不要加「维持原判」？
7. 允许下榜或请假吗？怎么防止有人借此躲罚？
8. 第一批后端是不是只做标 ★ 的那几项？
9. 时间统一用看板时区，还是用本地时区再加标注？
10. 保持深色风格，还是同时做浅色？段位色要不要和 bot 一起重新定？
11. 周报按判决时间还是立案时间统计？要不要重算旧周报？
12. 要不要给预览环境配一个 staging API？