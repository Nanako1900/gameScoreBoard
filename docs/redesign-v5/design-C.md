# 方向 C：渐进改造（保留单页计分板，先把地基修好）

---

## 1. 一句话概念，以及为什么这个方向适合这群人

**一句话：首页还是那块电竞直播风的计分板，只是改成手机两屏内看完。弹层变成能后退、能分享的地址。原来只显示一条邀请的横幅换成一个「待办抽屉」。按这个顺序先修地基，再补组织者缺的操作和各种安全网，每个 PR 都能单独上线。**

为什么适合（依据 analysis.md §1 的角色和场景）：

- **人很少，节奏低频**：一共约 13 个账号，9 人在榜。选手每周来几次，而且是被立案或被约的时候才集中来；管理员只有 1–2 人，有申诉时才来。这样的群体用不着一套新的导航体系，大家已经认得这块计分板。方向 C 不重新教用户怎么用，只把「我现在要做什么」放到最上面（§8 原则 1）。
- **通知已经交给 Discord**：网页要承担 Discord 做不了的四件事：重操作的工作台、可分享的版面、解释与建立信任、兜底。这四件事的入口都是 Discord 私信里的链接，比如 `/?case=N`、`/?session=N`。所以最急的是这几条：链接点进来能看全（H2）、能后退（H1）、登录后回得到原页面（H3），然后组织者能接着叫人、改时间（H11/H12）。这些都可以在现有单页上改出来，不必推倒重来。
- **后端只有一个人在维护**：PG 触发器、outbox 和 D1/PG 双栈都已经很完整（analysis §4.1 的「Bot」那一列）。方向 C 只加 **1 个必需的新接口**（`POST /api/sessions/:id/invite`），其余都是复用已有接口（`updateSession`、`scope=mine`、`status=appealed`、`appealCase(id, reason)`、`reclassifyCase`、`withdrawCase`）或者可选的增强。
- **风险可控**：DOM 测试锁定了文案、首屏 URL 和组件签名（§6）。方向 C 保留全部组件签名，新增的 props 都是可选的；首屏请求一个不改；深链测试断言的是 `location.search`，换成路径地址后这些断言照样成立（细节见 §2.3）。

---

## 2. 信息架构

### 2.1 总体形态

```
「计分板」本体（永远在底层渲染，DOM 顺序 = 视觉顺序）
  Header → 提示条 → TodoStrip → SessionsPanel → RedBlackBoard（压缩）
  → .app__grid [ 主列：Leaderboard、RulesPanel | 侧列：WeeklyReportCard(teaser)、RecordsFeed(前 10 条) ]
  → footer → 裁判 FAB「记一笔」

「路由层」（盖在计分板上：桌面是居中弹窗或右侧抽屉，手机 ≤600px 是底部抽屉 sheet）
  由 pathname 决定开哪一个；后退键关掉它；刷新和分享都能还原

「堆叠层」（不改 URL，但每层压一条 history 记录，所以 Android 返回键也是一层一层关）
  RollCallDialog、StatementDialog、AppealSheet、CaseDialog、OnboardingDialog、
  SessionFormDialog、RescheduleSheet、InvitePeopleSheet、ConfirmSheet
```

不加底部 Tab，不拆独立页面，不引入 react-router。新增 `src/lib/route.ts`（约 70 行，基于 `useSyncExternalStore` 和 `popstate`）和 `src/components/OverlayHost.tsx`。App.tsx 里那 15 个 `useState` 收拢成「当前路由 + 一个堆叠层数组」，App.tsx 本身降到 250 行左右。

### 2.2 路由表（共 7 条，全是单数词，避开 `/api`、`/auth`、`/link`）

| 路径 | 打开的层（组件） | 给谁 | 回答什么问题 |
|---|---|---|---|
| `/` | 只有计分板 | 所有人 | 我要做什么（TodoStrip）、接下来有哪些局、谁靠谱 |
| `/session/:id` | `SessionDetailDialog`（改成 sheet，组织者能看到「组织者控制台」区块） | 被邀请的人、组织者、访客 | 这局几点开、谁会来、我回了没有；组织者看谁还没回、要不要改时间或叫人 |
| `/player/:id` | `PlayerDetail` | 所有人 | 这人为什么是这个分；本人还能看到回血预测 |
| `/case/:id` | `PlayerDetail`（`focusRecordId=id`，这一起置顶） | 当事人、立案人、围观者 | 这一起是怎么回事，我能做什么（写说明、申诉、撤销、确认升级） |
| `/todo` | `TodoDrawer`（新） | 登录用户 | 邀请、改期、我答应过的局、待写说明、待点名、待确认升级、待复核申诉，全部列在这里 |
| `/me` | `MeSheet`（新） | 登录用户；访客看到的是登录引导 | 我的分数和回血、我的局、身份和显示名、通知与 Discord |
| `/report` | `ReportSheet`（新，内部复用 `WeeklyReportCard`） | 所有人 | 上周发生了什么。✕ 之后不会再找不到 |
| `/admin` | `AdminSheet`（新：申诉队列、AI 配置入口、重写周报） | 管理员；其他人访问时回到 `/` 并给出提示 | 有几起申诉等我复核 |

`/rules` 不单独设路由，`RulesPanel` 仍然在页面里，默认折叠，加锚点 `#rules`。

`/case/:id` 和 `/player/:id` 的区别：案件页先用 `getRecord(id)` 找到当事人，再打开那个人的页面并把这一起置顶，延续现在「案件在当事人页里打开」的约定（CONTRACT.md:410）。

**解析规则**：id 只接受 `^[1-9]\d{0,14}$`，复用 `deepLink.ts` 里的 `ID`。`/player/:id` 只接受 `^[A-Za-z0-9_-]{1,64}$`，这是 OAuth subject id，本来就出现在 `/api/users/:id` 里，不含名字。不认识的路径一律 `replaceState('/')`，并复用 `LinkMissingNotice` 提示「这个地址不存在，已带你回到首页。」，顺便解决低优先级里的「不存在的页面不报 404」。

### 2.3 旧深链如何映射（永久兼容）

| 旧链接 | 新的处理 | 和现有测试的关系 |
|---|---|---|
| `/?session=N` | 挂载时只读一次，`replaceState` 成 `/session/N`，其余参数保留（例如 `?utm=dc`），然后打开详情 | `deep-link.test.tsx:130-135` 断言 `location.search === ''`：参数挪进了 pathname，这条照样通过 |
| `/?case=N` | 读一次，变成 `/case/N`，然后 `getRecord`，得到 subject 后打开 `PlayerDetail` 并聚焦 | `:94-104` 断言 `search === '?utm=dc'`、`#case-7` 带 `vc--focus` 且获得焦点，都照样通过；`p8-app` 的「opens once」要求 `/api/records/7` 只请求一次：路由解析按导航缓存，数据刷新不会重新解析 |
| `/?case=abc` 等坏值 | 照旧剥掉参数、不发请求；pathname 仍是 `/` | `:106-119` 照样通过 |
| `/?linked=discord[&onboarding=1]` | 不变：显示一次性提示后剥掉；如果 onboarding 还没答，先弹 onboarding | `discord-link.test` 照样通过 |
| `/?onboarding=1` | 不变，首登弹窗的优先级仍高于任何路由层 | `p8-app:139-150` 照样通过 |

**有意改动 CONTRACT 的地方**：CONTRACT.md:413 写的是「the parameter is stripped at once」，改成「参数立即被替换为该视图自己的地址（`/session/N`、`/case/N`）；只读正整数；链接从不写数据；首登弹窗优先」。`A link never writes` 一字不改。Bot 那边 `render.ts:161-172` **不用改**，旧链接永远有效；以后想让 Discord 里的链接更短，再把 bot 切到新路径。

**直接落地在路由层上的情况**：比如分享出去的 `/session/5`。处理方法是先 `replaceState('/')`，再 `pushState('/session/5')`。这样关掉弹层（或按后退）会回到计分板，而不是退出网站。这正是 H1 里提到的 Android 返回键问题。

---

## 3. 关键页面线框（375px 优先）

图例：`[按钮]`；`‹组件名›` 标在每块右侧；**新** 表示新组件；**改** 表示复用现有组件但改了内容或样式。

### 3.1 首页：未登录访客

```
┌─────────────────────────────────────┐
│ EDG 信誉分        回血 2天3时 [登录] │ ‹Header›改：倒计时每分钟刷新，不再每秒
├─────────────────────────────────────┤
│ 👋 这是我们开黑守约的计分板          │ ‹WelcomeCard›新（仅访客，可关，
│ 约局 → 到点名 → 放鸽子才扣分         │   记在 localStorage）
│ 每周一自动回血 +15，谁都能翻身       │
│ [怎么算分]      [用 Nanako 登录]     │  「登录」会先记下当前地址
├─────────────────────────────────────┤
│ 约局     接下来│进行中│已结束        │ ‹SessionsPanel›改：三个 tab
│ ─────────────────────────────────── │
│ 周五 10/30 21:00 · 3 小时后          │ ‹SessionRow›
│ 🙂小明 · 无畏契约 · 3/5 人         › │
│ 周六 10/31 20:00 · 明天              │
│ 🙂阿杰 · 2 人                      › │
│ 还有 2 局 ›                          │  最多显示 3 行
├─────────────────────────────────────┤
│ 本周 ⭐ 阿杰 100 · 准时 3 局 │ 🕊 本周 │ ‹RedBlackBoard›改：一行双卡，
│                             │全员守约🎉│   约 120px
├─────────────────────────────────────┤
│ 信誉榜                               │ ‹Leaderboard›改：手机也显示分数
│ 1  🙂阿杰     🏆誓约之光        100  │  （在首屏底部露头）
│ 1  🙂小红     🏆誓约之光        100  │  同分同名次，不发奖牌
│ 3  🙂老王     💎守时楷模   ▼3    92  │
│ …                                    │
├─────────────────────────────────────┤
│ ▸ 规则：怎么扣、怎么回血            │ ‹RulesPanel›（折叠）
│ 📮 上周战报 · 打了 4 局，1 起放鸽 › │ ‹WeeklyReportCard compact›改 → /report
│ 最新动态                             │ ‹RecordsFeed›改：前 10 条
│ … 10 行 …                            │
│ [看更多动态]                         │
└─────────────────────────────────────┘
```

页面估算：Header 56 + 欢迎卡 150 + 约局 300 + 红黑榜 120 ≈ 626px，信誉榜第一行出现在首屏内（812px）。整页从 5180px 降到大约 2400px，约 3 屏。

### 3.2 首页：已登录选手

```
┌─────────────────────────────────────┐
│ EDG 信誉分      回血 2天3时 (2)🙂   │ ‹Header›改：头像旁边是待办数徽标
├─────────────────────────────────────┤
│ 要你处理 3 件                    ›  │ ‹TodoStrip›新：替换 InviteBanner
│ 📨 小明约你 周五 21:00               │   和 PendingBanner，放在同一个
│ ✍ 有 1 起待说明 · 周六 09:00 截止    │   DOM 位置；最多两行摘要，
│                     [打开待办 (3)]   │   整条可点 → /todo
├─────────────────────────────────────┤
│ 约局     接下来│进行中│已结束 [组一局]│ ‹SessionsPanel›
│ ┌ 等你回 ─────────────────────────┐ │  等我回复的局置顶，加金色描边
│ │周五 10/30 21:00 · 3 小时后       │ │  和「等你回」文字 chip
│ │🙂小明 · 3/5 人 🙂🙂🙂            │ │  （有 going_preview 时显示头像）
│ │[ 来 ] [待定] [不来]              │ │  ‹SessionRow› RSVP 保留
│ └──────────────────────────────────┘ │  （测试锁定）
│ 周六 10/31 20:00 · 你：来 ✓        › │
├─────────────────────────────────────┤
│ 你  🙂 92 分 · 本周 -8 · 周一回血到 100│ ‹MyScoreLine›新：一行，→ /me
├─────────────────────────────────────┤
│ 本周 ⭐ … │ 🕊 …                     │ ‹RedBlackBoard›
│ 信誉榜 …（自己那一行高亮「你」）      │ ‹Leaderboard›
│ …                                    │
└─────────────────────────────────────┘
```

- TodoStrip 本身不放「来」按钮。理由：同一屏的 SessionsPanel 已经把「等你回」的那一行置顶，并且带 RSVP；如果两处都放，同一局就会在页面上出现两个「来」（M1）。TodoStrip 只负责汇总和打开抽屉。
- 没有待办时 TodoStrip 不渲染，延续「横幅为空就自动隐藏」的做法（App.tsx:306）。

### 3.3 首页：裁判 / 管理员（只列和 3.2 不同的部分）

```
├─────────────────────────────────────┤
│ 要你处理 4 件                    ›  │ ‹TodoStrip›
│ 📋 周四那局该点名了（你组的）        │  组织者
│ ⚖ 2 起 AI 建议升级等你确认           │  裁判（来自 feed 前 50 条）
│ 🧾 1 起申诉等你复核                  │  管理员（pending.appeals）
│                     [打开待办 (4)]   │
├─────────────────────────────────────┤
│ …                                    │
│                         ┌─────────┐ │
│                         │✎ 记一笔 │ │ ‹app__fab›：在 pointer:coarse 下
│                         └─────────┘ │   页面底部留出 FAB 的高度
```

管理员的头像菜单：`我的`（`/me`）、`管理`（`/admin`，带角标 `pending.appeals`）、`退出`。原来的「编辑我的身份」并进 `/me`，「AI 裁判配置」并进 `/admin`。

### 3.4 待办抽屉 `/todo`（‹TodoDrawer›新）

```
手机：底部 sheet（高 92dvh，内部滚动，标题栏 sticky）
┌─────────────────────────────────────┐
│ ━━                                   │ 抓手（只是视觉提示）
│ 待办 · 5                        [✕] │ sticky 标题栏，✕ 为 44px
├─────────────────────────────────────┤
│ 需要你回应                           │
│ ┌──────────────────────────────────┐ │
│ │🔁 改时间了 · 小明的局             │ │ ‹InviteCard›新（有 invite_reason
│ │原定 周五 21:00 → 现在 周六 20:00  │ │   时显示「改时间了」）
│ │已有 2 人确认 🙂🙂                 │ │
│ │[ 来 ] [待定] [不来]   看详情 ›    │ │ 回复时带上 starts_at
│ └──────────────────────────────────┘ │
│ ┌──────────────────────────────────┐ │
│ │📨 阿杰约你 · 周日 15:00 · 2 天后  │ │
│ │[ 来 ] [待定] [不来]   看详情 ›    │ │
│ └──────────────────────────────────┘ │
│ ┌──────────────────────────────────┐ │
│ │✍ 待说明 · 老王记了你一笔「迟到」 │ │ ‹PendingCard›新
│ │周六 10/31 09:00 截止（还剩 14 小时）│ │
│ │草稿已存 · 写了 42 字              │ │ 本地有草稿时显示
│ │                      [写说明]     │ │ → 叠加 StatementDialog
│ └──────────────────────────────────┘ │
├─────────────────────────────────────┤
│ 你答应过的                           │
│ 周六 20:00 小明的局 · 你：来         │ ‹PromiseRow›新
│ 来不了？开局前改成「不来」不扣分 [改成不来]│
├─────────────────────────────────────┤
│ 组织 / 裁判 / 管理                   │ 只对有这些身份的人显示
│ 📋 周四 21:00 的局该点名了 [去点名]  │ → /session/:id，聚焦「点名结算」
│ ⚖ 小红「放鸽子」AI 建议升级团灭级 [去确认]│ → /case/:id
│ 🧾 1 起申诉待复核          [去复核]  │ → /admin
├─────────────────────────────────────┤
│ 通知                                 │
│ 🚫 阿杰取消了 周三 21:00 的局   [知道了]│ 来自 scope=mine 的 cancelled
│ 🔗 绑定 Discord，邀请会私信你，       │ 只对没绑定的人显示
│    一键报名        [去绑定] [不再提示]│
└─────────────────────────────────────┘
空状态：「没有待办，清清爽爽 ✨」（和 bot /todo 一字不差）
部分加载失败：「有一部分待办没加载出来 · [重试]」（role=status，不用 alert）
桌面：从右侧滑出，宽 420px，全高；计分板仍然可见（inert）
```

### 3.5 约局详情 `/session/:id`（‹SessionDetailDialog›改，内容分区不变）

**被邀请人 / 访客视角：**

```
┌─────────────────────────────────────┐
│ ━━  周五 10/30 21:00           [✕] │ sticky：时间 + 关闭
│     3 小时后 · 北京时间             │ 有 timezone 配置时标注看板时区
├─────────────────────────────────────┤
│ 🙂小明 组的局 · 无畏契约 · 上限 5 人  │
│ 备注：开黑语音群里见                 │
├─────────────────────────────────────┤
│ 你的回复：还没回                     │ ‹RsvpControl›改：每个面板一个「来」
│ [ 来 ]  [待定]  [不来]               │
│ 只有「来」占名额。开局前改主意不扣分。│ M20 说明
├─────────────────────────────────────┤
│ 来 3   🙂小明(组织) 🙂阿杰 🙂小红    │ ‹PlayerGroups›新：按 4 组显示
│ 待定 1 🙂老王                        │
│ 还没回 2 🙂… 🙂…                     │
│ 不来 0                               │
├─────────────────────────────────────┤
│ [复制链接]  [加到日历 .ics]          │ ‹ShareRow›新
└─────────────────────────────────────┘
访客：RSVP 区域换成
│ 登录后就能报名，我们会带你回到这一局 │
│ [用 Nanako 登录]                     │ <a href=AUTH_LOGIN_URL>，跳转前 rememberReturn
```

**组织者视角（同一个 sheet，多一块「组织者控制台」）：**

```
├─────────────────────────────────────┤
│ 组织者控制台                         │ ‹OrganizerConsole›新（在 SessionDetail 内）
│ 3/5 来 · 2 人还没回 · 1 人待定       │
│ [+ 叫人]   [改时间]   [改人数/备注]  │
│ [复制邀请链接]                       │
│ ─────────────────────────────────── │
│ [取消约局]                           │ ghost 红色，需二次确认
└─────────────────────────────────────┘
开局后：
│ 局已经开始了 · 21:00 开，预计 23:00 结束│
│ [点名结算]                           │ 金色主按钮；在 RollCallDialog 上叠一层
│ 点名不等于扣分；加分默认勾上，扣分要你手动勾。│
```

**叫人（‹InvitePeopleSheet›新，堆叠层）：**

```
┌─────────────────────────────────────┐
│ 再叫几个人                      [✕] │
│ 已经在局里的人不会重复邀请。          │
├─────────────────────────────────────┤
│ 在榜的人                             │ ‹PeoplePicker›新：从 SessionFormDialog
│ [✓ 🙂老王] [  🙂阿杰 已来] [✓ 🙂小红] │   抽出来；选中用 ✓ 后缀，不只靠颜色
│ 其他朋友（P4 有 /api/users/invitable 后出现）│
├─────────────────────────────────────┤
│ 一次最多 20 人。他们会收到 Discord   │
│ 私信（如果绑定了）；同一个人一天最多 │
│ 收到你 3 条邀请私信。                │
│               [取消]  [邀请 2 人]    │
└─────────────────────────────────────┘
成功：toast「已邀请 2 人」，PlayerGroups 的「还没回」+2
```

**改时间（‹RescheduleSheet›新，堆叠层）：**

```
┌─────────────────────────────────────┐
│ 改时间                          [✕] │
│ 现在：周五 10/30 21:00               │
│ [今晚 21:00][明晚 20:00][周六 15:00]…│ 复用 @shared/quickTime 的 chip
│ 或者自己选：[日期][时间]             │
├─────────────────────────────────────┤
│ ⚠ 改到 周六 20:00 后，已回复的 4 人  │ 人数 = going+maybe+out-组织者
│   需要重新确认，Discord 会私信他们。  │
│   之前说「不来」的人也会重新收到邀请。│
│          [先不改]  [确认改时间]      │ 焦点停在「先不改」
└─────────────────────────────────────┘
```

**取消（‹ConfirmSheet›新，套用 DiscordLinkCard 的内联确认）：** 「取消后会私信通知已经回复的 4 人。」→ [先不取消]（焦点）[确认取消约局]。取消理由输入框等后端有 `cancel_reason` 之后才出现（可选）。

### 3.6 发起约局（‹SessionFormDialog›改，堆叠层，不加路由）

```
┌─────────────────────────────────────┐
│ 组一局                          [✕] │
│ 什么时候？（北京时间）               │
│ [今晚 21:00][明晚 20:00][周六 15:00] │ 不改 quickTime
│ 叫谁？                               │ ‹PeoplePicker›
│ [✓🙂阿杰][✓🙂小红][ 🙂老王]…         │
│ ▸ 更多：游戏 / 人数上限 / 时长 / 备注 │ 折叠；capacity 本来就支持
│ 你现在还能开 3 个局（同时最多 5 个） │ 由 scope=mine 计算
│                     [发起，邀请 2 人]│
└─────────────────────────────────────┘
成功后直接跳到 /session/:id，flash：「局建好了。被邀请的人会收到 Discord 私信（如果绑定了）；没绑定的打开网页也能看到。」
```

### 3.7 选手页 `/player/:id`，案件 `/case/:id`（‹PlayerDetail›改）

```
┌─────────────────────────────────────┐
│ ━━  🙂 小红                    [✕] │ sticky 标题栏
├─────────────────────────────────────┤
│  [ScoreGauge 78]  ✅基本靠谱  裁判   │ ‹ScoreGauge›‹TierBadge›不改
│  本周 -12 · 周一 +15 回血            │ ‹HealForecast›新（所有人可见：
│  （本人看到）预计周一回到 93，        │   只是事实；预测那句只给本人）
│   下下周回到 100                     │
│  （本人看到）段位说明：正常          │ 段位说明（blurb）只给本人看（M6）
├─────────────────────────────────────┤
│ 走势  ‹HistoryChart›（手机字号 ≥12px，点按显示数值）│
├─────────────────────────────────────┤
│ ── 你点开的这一起 ──                 │ /case/:id 时这一起置顶，
│ ┌ VerdictCard #case-24 vc--focus ──┐ │   保留 id 和类名（测试）
│ │迟到 · -6（区间 -3~-8）· AI 判    │ │
│ │…判词（有权限才显示）…            │ │
│ │[申诉]                            │ │ 只有当事人看到，打开 AppealSheet
│ └──────────────────────────────────┘ │
│ ── 小红的其他记录 12 ──  [只看待处理]│ 其余记录正常列出
│ …                                    │
├─────────────────────────────────────┤
│ 管理员：‹AdminScoreForm›（文案「调整分数 / 改分 / 确认改分」不变）│
│ [设为裁判] / [取消裁判资格] 不变     │
└─────────────────────────────────────┘
```

「说明情况」改成**叠加**一层 StatementDialog，不再先关掉 PlayerDetail（App.tsx:456-460）。写完关掉，回到原来那一起。

### 3.8 案件四个环节

**立案（‹CaseDialog›改：提交后多一个「结果」步骤）**

```
步骤 1（不改）：选人 → 写事实经过 → [提交]
  草稿自动存本机（localStorage edg.draft.case）
  提交中：「AI 正在逐个归类，3 个人大约 20–60 秒…」+ 进度 1/3
步骤 2（新）：
┌─────────────────────────────────────┐
│ 记好了 · 3 起                        │
│ 🙂阿杰  放鸽子  区间 -10~-20  AI 归类 │ [改案由 ▾] → reclassifyCase
│ 🙂小红  迟到    区间 -3~-8   AI 归类  │ [改案由 ▾]
│ 🙂老王  ⚠ AI 建议团灭级，等你确认     │ [确认是团灭级]（文案不变）
│ ─────────────────────────────────── │
│ 3 分钟内撤回，对方不会收到任何私信。  │ 由 0004_dm.sql:100-104 的
│ [撤回这 3 起（还剩 2:41）]           │   宽限期保证；→ withdrawCase
│                           [完成]     │
└─────────────────────────────────────┘
```

**写说明（‹StatementDialog›改）**

```
┌─────────────────────────────────────┐
│ 说明情况                        [✕] │
│ 老王 记了你一笔「迟到」。             │
│ ⏳ 周六 10/31 09:00 截止（还剩 14 小时）│ 绝对时间 + 相对时间
│   截止前没写，会按缺席裁决。          │
│ ┌ 立案人写的经过 ──────────────────┐ │ 原来叫「裁判陈述」，改名（M16）
│ │说好八点五排结果九点才上线        │ │
│ └──────────────────────────────────┘ │
│ ‹SentencingScale›                    │
│ 你的说明                             │
│ [快捷：提前说了][临时有事][网络/设备]│ 片段只插入到草稿里
│ ┌──────────────────────────────────┐ │
│ │                                  │ │ 每 500ms 存一次草稿
│ └──────────────────────────────────┘ │
│ 草稿已存在这台设备 · [清空]   42/500 │
│ 只能交一次，交了马上裁决。说明和判词只给你、│
│ 立案人、裁判和管理员看；立案经过本身是公开的。│ M18
│                           [提交说明]  │
└─────────────────────────────────────┘
```

**判决（‹VerdictCard›不改结构，只改文案）**

- 已撤案（withdrawn）的案件不再显示「按缺席裁决」（M17）。
- fallback 徽标保留。
- 本人看到的判决下面多一行「这 -6 分会在周一回血时补回来 15 分」（HealForecast 的简版）。

**申诉（‹AppealSheet›新，堆叠层）**

```
┌─────────────────────────────────────┐
│ 申诉这一起                      [✕] │
│ 迟到 · -6 · AI 判                    │
│ 为什么觉得判得不对？（可以不写，但写一句 │
│ 管理员更好判断）                      │
│ ┌──────────────────────────────────┐ │ 和 bot 一致：可选，长度 ≤ APPEAL_MAX
│ └──────────────────────────────────┘ │
│ 申诉后分数先不动，管理员复核后可能维持，│
│ 也可能改判。每起只能申诉一次。         │
│            [先不申诉]  [提交申诉]    │
└─────────────────────────────────────┘
```

### 3.9 我的 `/me`（‹MeSheet›新）

```
┌─────────────────────────────────────┐
│ 我的                            [✕] │
├─────────────────────────────────────┤
│ 🙂 小红 · 78 分 · ✅基本靠谱          │ ‹MyScoreCard›新
│ 周一 +15 → 93 · 下周 → 100           │ HealForecast
│ [看我的全部记录 ›] → /player/<me>     │
├─────────────────────────────────────┤
│ 我的局（scope=mine）                 │ 复用 SessionRow
│ 周六 20:00 · 你：来                  │
│ 周四 21:00 · 你组的 · 待点名         │
├─────────────────────────────────────┤
│ 身份与名字                           │
│ 显示名：小红 · 上榜选手  [修改]      │ → OnboardingDialog
│                                      │   （标题「设置你的显示名字与身份」不变）
├─────────────────────────────────────┤
│ 通知与 Discord（三步）               │ ‹NotifySteps›新
│ ① 加入 EDG 的 Discord 服务器 [打开 ↗]│ VITE_DISCORD_INVITE_URL
│ ② 绑定账号：约局邀请会私信你，一键报名│
│    ‹DiscordLinkCard›（绑定 Discord / 解绑 / 确认解绑，文案不变）│
│ ③ 私信提醒：开着 · 最近送达正常 [关掉]│ P4 有 notify 接口后才显示；
│    之前显示：在 Discord 里用 /notify 开关 │
├─────────────────────────────────────┤
│ [退出登录]                           │
└─────────────────────────────────────┘
```

### 3.10 管理 `/admin`（‹AdminSheet›新）

```
│ 待复核的申诉 1                        │ getRecords({status:'appealed'})
│ 🙂阿杰 放鸽子 -15 · 申诉理由：「我提前在群里说了」│
│ [维持原判]（P4）[改判] [撤销]        │ 改判复用 override 表单
│ 周报：上周 10/19 [重新生成]          │ 复用 regenerateReport
│ AI 裁判配置 [打开]                   │ AdminAiPanel 叠加打开
```

### 3.11 桌面差异（≥1024px）

- 计分板保持两栏。为解决 M27 的高度失衡，右栏放 `WeeklyReportCard compact` 和 `RecordsFeed` 前 15 条加「看更多」，左栏放 `Leaderboard` 和 `RulesPanel`。两栏的 DOM 顺序就是阅读顺序（左栏在前），不使用 CSS `order`。
- 路由层：`/session`、`/player`、`/case`、`/report`、`/admin` 是居中弹窗（宽 760px，高度上限 `calc(100dvh - 4rem)`，**内部滚动**，✕ 永远可见）。`/todo` 和 `/me` 是右侧抽屉，宽 420px。
- TodoStrip 在桌面上排成一行，最多三条摘要，右侧是「打开待办」。

---

## 4. 邀请功能整合方案

### 4.1 全生命周期：网页上每一步怎么做，文案是什么

| 步骤 | 网页交互 | 关键文案 | 实现 |
|---|---|---|---|
| **创建** | `SessionFormDialog`：quickTime chip、PeoplePicker、折叠的「更多」；显示剩余额度 | 「你现在还能开 3 个局（同时最多 5 个）」「一次最多叫 20 人」 | 已有 `createSession`；额度从 `scope=mine` 算，数字来自 `shared` 或后端报错 |
| **邀请** | 建好之后还能在组织者控制台「+ 叫人」；只能邀请不在局里的人 | 「已经在局里的人不会重复邀请」 | ★ `POST /api/sessions/:id/invite` |
| **通知** | 被邀请人：TodoStrip、TodoDrawer 的 InviteCard、SessionsPanel 置顶「等你回」；标签页标题 `(2) EDG 信誉分`；页面重新可见时刷新 | 「小明约你 周五 21:00」 | 前端；私信由 PG 触发器发（0005:190-193），前端不参与 |
| **报名** | 来 / 待定 / 不来，处处带 `starts_at`；成功后发 toast，所有地方同步 | 首次回复：「已回复：来。开局前想改都行，不扣分。」改回复：「已改成：不来 · [撤回]」 | `setRsvp` 统一封装，成功后派发 `edg:session` 事件；409 先刷新再显示原因（行为不变） |
| **提醒** | 开局前 15 分钟由 Discord 私信；网页给没绑 Discord 的人提供「加到日历 .ics」（含 15 分钟 VALARM） | 「没绑 Discord？加到日历，开局前 15 分钟提醒你。」 | 前端用 Blob 生成 .ics，符合 CSP |
| **改期** | 组织者控制台「改时间」→ RescheduleSheet，先预告影响；被邀请人看到「🔁 改时间了，原定 X → 现在 Y」 | 「已回复的 4 人需要重新确认，Discord 会私信他们」 | 已有 `updateSession` PATCH；「原定时间」需要推荐接口 `prev_starts_at` 和 `invite_reason`，没有时显示通用的「等你回」 |
| **取消** | ConfirmSheet 二次确认；被取消的局在 TodoDrawer「通知」里出现一次，点「知道了」后消失（本地已读集合） | 「阿杰取消了 周三 21:00 的局」 | 已有 `cancelSession` 和 `scope=mine` |
| **进行中** | SessionsPanel 新增「进行中」tab：`status=open`，开始时间 ≤ now < 开始时间 + (duration_min ?? 120) 分钟；行上显示「进行中」 | 「21:00 开的局，预计 23:00 结束」 | 纯前端，数据来自 `scope=past`；120 和后端 `COALESCE(duration_min,120)` 一致，抽成 `shared/attendance.ts` 的常量 `DEFAULT_DURATION_MIN` |
| **点名** | 组织者 TodoDrawer 里出现「📋 该点名了」→ `/session/:id` → [点名结算]；RollCallDialog 叠加；选择结果存进草稿（sessionStorage `edg.draft.rollcall.<id>`），误按 Esc 也不会丢 | 「点名不等于扣分；加分默认勾上，扣分要你手动勾。」 | 已有接口；默认勾选规则保持不变 |
| **结算** | 不变；结算后的 flash 加一个链接「看这一局产生的记录」 | 「已结算，立案 2 起，等当事人说明情况。」 | 不变 |
| **分享** | ShareRow「复制链接」得到 `https://community.nanako.org/session/12`；访客打开后是只读详情加「登录后报名」；登录回来后回到这一局，并问一句「刚才想报名这局？」，按钮都在，但**不会自动替你报名** | 「登录后就能报名，我们会带你回到这一局」 | 前端：sessionStorage `edg.return = {path, intent:'rsvp', at}`，有效期 15 分钟，`path` 必须能被 `parseRoute` 解析 |

**同步机制（M1）**：不引入状态库。`api.ts` 的 `setRsvp`、`updateSession`、`cancelSession`、`inviteToSession` 成功后派发 `window` 事件 `edg:session`，`detail` 是返回的 session。`SessionsPanel`、`TodoDrawer`、`SessionDetailDialog`、`TodoStrip` 都订阅这个事件并合并数据。组件签名不变，`refreshKey` 继续保留作兜底。

**撤回的边界**：第一次回复之前状态是 `invited`，用户自己不能把状态设回 `invited`（`tests/worker/invites.test.ts:206`）。所以第一次回复只给提示、不给撤回；之后在来 / 待定 / 不来之间切换才给「撤回」，撤回就是再调一次 `setRsvp` 设成旧值。

### 4.2 和 Discord bot 对齐

| 主题 | 对齐方式 | 是否改 bot |
|---|---|---|
| RSVP 标签 | 统一用 `@shared/attendance` 的 `RSVP_LABEL`：来、待定、不来、未回应。网页上的「还没回」作为分组标题，状态值仍是「未回应」 | 否 |
| /todo 与抽屉 | TodoDrawer 是 /todo 的超集，覆盖待写说明、待回应约局、待复核申诉，另外加了待点名、我答应的局、已取消、待确认升级。空状态文案一致 | 可选：`webButton('去网页处理')` 改链到 `/todo`（一行） |
| 改期 | 网页「🔁 改时间了」对应私信 `dm.session.changed`「🔁 约局改时间了」，图标和措辞一致 | 否 |
| /yue 的「去网页邀请人」 | 网页真正有了「+ 叫人」之后，这句话不再是空话 | 可选：回复里附 `/session/:id` 链接 |
| 时区 | 网页显示看板时区标签。需要 `/api/config` 下发 `boardUtcOffsetHours`（可选接口）；没有这个字段时，只在浏览器时区和 +8 不一致时标注「（你的本地时间）」 | 否 |
| 用词 | 被告方：「说明」（网页）、「陈述」（bot）→ 网页统一用「说明」；立案方的叫法从「裁判陈述」改成「立案经过」 | 可选：bot 文案后续再统一，不阻塞 |
| 申诉理由 | 网页和 bot 一样，理由可以不填 | 否 |

### 4.3 「邀请」的其他含义怎么并进来

1. **Discord 服务器邀请**：`/me` 的「通知与 Discord」第 ① 步；WelcomeCard 不放这个链接（访客还没登录，先别打扰）。链接地址从 `VITE_DISCORD_INVITE_URL` 读，不写死；没配置时整行隐藏。
2. **Discord 绑定**：第 ② 步复用 `DiscordLinkCard`，文案多一句好处说明：「绑定后：约局邀请私信你、一键报名、被立案时第一时间知道」。TodoDrawer 对没绑定的人显示一条可关闭的提示。OnboardingDialog 里的 DiscordLinkCard 保留（测试锁定 `还没「确认」的修改不会保存`）。
3. **新人上榜**：OnboardingDialog 讲清楚后果，并把「先看看」（不上榜）放在第一位：「上榜后别人能给你记一笔，也能约你；随时可以在『我的』里改。」默认选项从「上榜选手」改成不预选，用户必须自己选一个（radiogroup「选择身份」名字不变）。
4. **分享链接**：见 4.1「分享」。`index.html` 的 meta description 改成「EDG 信誉分：朋友开黑的守约计分板。约局、点名、每周回血。」，去掉「头号鸽王」（M23）。

---

## 5. 人性化功能清单（选自 analysis §5）

| §5 序号 | 采用 | 落地方式与文案 | 语气 |
|---|---|---|---|
| 1 红黑榜去羞辱化 | ✅ P2 | 红榜「本周之星」：本周没有扣分记录、分数 ≥95，按本周加分排序；并列时显示「并列 N 人」和头像组。黑榜「本周最鸽」：本周净扣分 ≤ -10，并且至少有一起**已判决**的扣分；没人符合时显示「本周全员守约 🎉」。口径用 `computeTrends`（feed 前 50 条，按回血周统计），以后可以换成后端的 `week_delta`。手机上一行双卡，约 120px。黑榜不显示段位说明，只写事实：「本周 -15 · 1 起放鸽子」 | 梗要有出处：称号有门槛，数字照实写 |
| 3 让宽恕看得见 | ✅ P3 | `HealForecast`：「周一 +15 回血 → 93 · 下周 → 100」。Header 的倒计时改为「回血 2天3时」。回到满分那天，本人第一次打开页面时显示一次「回到 100 了，欢迎回来 ✨」（localStorage 记一次；遵守 reduced-motion，没有动效） | **最该放软语气的地方** |
| 4 草稿保护 | ✅ P3 | 说明、记一笔、申诉、点名都存本地草稿：`edg.draft.statement.<caseId>`、`edg.draft.case`、`edg.draft.appeal.<id>`、`edg.draft.rollcall.<sessionId>`。提交成功或退出登录时清掉。关闭时 toast「草稿存在这台设备上，下次打开接着写」。有草稿的长表单禁用点背景关闭，只能用 ✕ 或 Esc。草稿只存在本地，提交前不往服务端写任何东西 | 中性 |
| 5 申诉写理由 + 二次确认 | ✅ P3 | AppealSheet，见 3.8 | 中性、尊重 |
| 6 统一的「确认 + 撤回」 | ✅ P3 | 撤销按钮显示「撤销（还剩 12 分钟）」，每 30 秒刷新，窗口和 `REVOKE_WINDOW_MS` 一致；撤销和撤案都走 ConfirmSheet。记一笔后 3 分钟内可以撤回。取消约局要二次确认。确认写法复用 DiscordLinkCard（焦点在「取消」）和 AdminScoreForm（焦点在确认按钮）两种，不用 `window.confirm` | 中性 |
| 7 开局前说不来不扣分 | ✅ P2 | RsvpControl 下方一句说明；TodoDrawer「你答应过的」里放 [改成不来]，一键完成 | 鼓励 |
| 8 隐私对齐 | 部分 ✅ | P2（前端）：段位说明只给本人看，公开页不显示 blurb，红黑榜卡片也去掉 blurb。判决前隐藏 claim 需要后端改 `redactRecord`，归为**可选**，等待决问题 3 定了再和 bot 一起改 | 第二个该放软语气的地方 |
| 9 时间显示 | ✅ P3 | `formatWhen` 统一输出「周五 10/30 21:00 · 3 小时后」；截止时间一律带绝对时间；RulesPanel 里写死的「本地时区」改成真实的时区 | 中性 |
| 10 页面保持新鲜，出错不崩 | ✅ P0 | 刷新失败时保留旧数据，显示 toast「刷新失败，显示的是 3 分钟前的数据 · [重试]」；页面重新可见且距上次超过 60 秒就重新拉取；标签页标题显示待办数 | 中性 |
| 11 新访客欢迎卡、首登讲清后果 | ✅ P2 | WelcomeCard；OnboardingDialog 加「先看看」 | 玩梗但友好 |
| 13 统一用词 | 部分 ✅ P3 | 网页统一：「立案经过」（立案方写的）、「说明」（当事人写的）、「AI 判」/「保底判」（fallback）、「撤案」（判决前）和「撤销」（判决后），按钮旁加一行说明区分。「30 秒指南」就是 RulesPanel 展开后的第一段 | 中性 |
| 14 说明快捷片段 | ✅ P3 | StatementDialog 上方的 chip，点了只插入草稿文本 | 中性 |
| 15 可读性与无障碍 | ✅ P0 | 见 §6 | — |
| 2 「我的今天」摘要 | 简版 P4 | TodoStrip 上方一行「上次来之后：2 条新判决、1 个新局」，用 localStorage 记 `lastSeenAt`，和 feed 的 `created_at` 比较；没有新内容就不显示 | 轻松 |
| 12 分数账本 | ❌ | 需要后端，属于另一方向的重点；这里只在 HealForecast 里解释回血 | — |
| 16 PWA | ❌ | 不做（单页加 Discord 私信已经够用） | — |
| 17 连胜、请假、延期 | ❌ | 公平规则还没定（待决问题 7） | — |

**语气原则在每个场景的应用：**

- 约局、空状态、庆祝、战报正文：照常玩梗，比如「还没人组局。第一个开黑的永远是英雄。」这句保留。
- 立案、判决、低分、黑榜、报错：数字照实写，不用感叹号，不用 🕊 以外的嘲讽图标。判决前不显示红色扣分数字，只显示区间和「待说明」（CONTRACT 规定不能显示 0）。每起扣分旁边都给出路：「可以申诉」「周一回血 +15」。
- 黑榜卡片：顶部小字「本周最鸽」，正文写事实，不写段位说明。没人达标时显示「全员守约 🎉」，不硬选一个人。

---

## 6. 视觉方向

**保留**：深色电竞直播风；4 级表面 `--bg`、`--bg-elevated`、`--panel`、`--panel-2`；Rajdhani 数字；ScoreGauge、TierBadge、hero glow；圆角和动效 token；`pointer:coarse` 触控规则；reduced-motion 全局兜底。**不做浅色模式**，但 token 拆成两层，给以后留口子。

| 问题 | 处理 |
|---|---|
| **H8 层叠颠倒** | `main.tsx` 改成先 `import './theme.css'` 再 `import { App }`，让 base 先、组件后。在 `tests/unit/source-hygiene.test.ts` 加一条断言：main.tsx 里 theme.css 的导入在 App 之前。再检查一遍被「修好」后反而露出来的旧样式，例如 `.modal__panel` 的阴影、`.dlink__bind` 的蓝色、撤销按钮的红色、胶囊圆角，这些本来就是设计意图。暂不引入 `@layer`，组件 CSS 是从 JS 侧导入的，套 layer 收益小 |
| **H9 焦点环** | `:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }`，`--focus: #7cc4ff`，删掉基于 box-shadow 的 `--focus-ring`。金色按钮的 box-shadow 从此不会盖掉焦点环；outline 在 `forced-colors: active` 下自动生效。隐藏 input 加 label 的组合继续用 `:has(:focus-visible)`，同样改用 outline |
| **H10 对比度** | `--faint: #5c6675 → #7f8a99`（在 `--panel-2` 上约 4.6:1，在 `--bg` 上约 5.5:1）。新增 `--border-input: #5f6b7d`（在 `--panel` 上约 3.2:1，满足非文字 3:1），所有 input、textarea 的边框都用它。「未回应」、人数、隐私告知这些关键信息改用 `--muted` |
| **M24 金色过载** | 拆成两层：底层是原始色板（`--gold-500` 等），上层是语义 token。`--brand`：只用于品牌和主按钮。`--attention`：待办、待说明、等你回，用琥珀描边加文字 chip，不再用金色填充。`--tier-0…5`：在 CSS 映射层按 `data-tier` 取色，网页单独把「需要盯一下」调成 `#d98e04`，和金色的亮度比从 1.15 提到约 1.66，徽章同时改成「描边加图标」，和高段位的「填充」形状不同，不只靠颜色区分。`shared/scoring.ts` 的 hex 不动，bot 继续用原值，以后一起评估。黑榜卡片的头像圆环改用 `--down`，不再取段位色（不会再出现红卡配蓝环） |
| **M25 字号太碎** | 字号收成 6 档：12 / 14 / 16 / 20 / 24 / 32px，再加 hero，中文最小 12px。`--font-display` 加上中文回退：`'Rajdhani', 'PingFang SC', 'Microsoft YaHei', system-ui`；Rajdhani 只给数字和拉丁字母用（加 `.tabular` 和 `.latin` 工具类）。P4 自托管 Rajdhani 的 woff2 子集，同步从 CSP 里去掉 Google Fonts（要改 `pages-headers.test`） |
| 密度 | 手机行高 ≥56px；`pointer:coarse` 下触控区 ≥44px（现在有 40px 的地方都抬上去）；SessionsPanel 默认 3 行，RecordsFeed 默认 10 行，桌面 15 行 |
| 图标 | 有语义的图标（🔒 隐私、⚠ 升级、⏳ 截止、状态）换成同源打包的内联 SVG（`src/icons/`，用 `currentColor`，在 forced-colors 下可见），而且一律配文字；带情绪的 emoji（🎮📮🎉🕊）在玩梗的场景保留。分两批换，P2 和 P4 各一批 |
| Modal / sheet | `.modal` 不再整体滚动，改成 `.modal__panel` 内部滚动，高度上限 `calc(100dvh - 2rem)`。≤600px 时贴底，`border-radius: var(--r-lg) var(--r-lg) 0 0`，高度上限 92dvh，`padding-bottom: env(safe-area-inset-bottom)`。新增 sticky 的 `.modal__bar`（抓手、标题区、44px 的 ✕）。动效只用 transform 和 opacity，遵守 reduced-motion |

---

## 7. 「高」问题 H1–H16 的处理

| # | 处理 |
|---|---|
| H1 | 7 条路径路由加「每层一条 history 记录」，后退关掉当前层；直接落地时先垫一条 `/`；旧 `?case`、`?session` 链接换成新路径（§2）。P1 |
| H2 | Modal 改成内部滚动，手机上是底部 sheet，✕ 和标题 sticky；`/case/:id` 把那一起置顶，不用滚 3700px 去找。P0（sheet）加 P1（置顶） |
| H3 | 前端用 sessionStorage 记下 `edg.return`；访客在详情页看到「登录后报名 / 写说明」，登录回来后在原页面问一句，不自动写入。后端 `safeNextPath` 不动。P1 |
| H4 | TodoDrawer 覆盖组织者（待点名）、裁判（待确认升级，取自 feed 前 50 条）、管理员（`status=appealed`）；Header 显示待办数徽标；标签页标题显示待办数。P2 |
| H5 | 红黑榜设门槛，只算本周，没人达标时显示「全员守约 🎉」，并列显示并列，去掉段位说明。P2 |
| H6 | 手机上的榜单行总是显示分数数字（`.lb-row__score`），只隐藏 gauge；段位缩成「emoji + 色点」。P0 |
| H7 | 首页压缩：约局 3 行、红黑榜约 120px、战报改为 teaser、动态 10 条，信誉榜在首屏露头。P0（榜单和动态）加 P2（红黑榜和战报） |
| H8 | 调换 main.tsx 的导入顺序，加 source-hygiene 断言。P0 |
| H9 | 焦点环改用 outline，支持 forced-colors。P0 |
| H10 | 调整 `--faint`，新增 `--border-input`，关键信息改用 `--muted`。P0 |
| H11 | ★ `POST /api/sessions/:id/invite` 加 InvitePeopleSheet。P3 |
| H12 | RescheduleSheet 接上现有的 PATCH，先预告影响；被邀请人看到「改时间了」（原定时间需要推荐接口）。P3 |
| H13 | 四类长表单都有本地草稿；有草稿时不能点背景关闭；Modal 栈让 Esc 只关最上面一层。P0（栈）加 P3（草稿） |
| H14 | AppealSheet：理由可选，有二次确认，接 `appealCase(id, reason)`。P3 |
| H15 | P3 先做 `/admin` 复核队列（改判、撤销已有）；「维持原判」和「保留原判词」需要后端，P4。在那之前，队列里写明「维持原判请在 Discord 里处理，或暂不处理」。**P3 只解决一半** |
| H16 | CaseDialog 增加「结果」步骤：显示归类、改案由、确认升级、3 分钟内撤回；提交时显示进度文案。后端「AI 并行归类（并发 3）」是**可选**项，不做的话等待时间不变，但用户知道在等什么。P3 |

---

## 8. 后端改动清单

**原则**：领域规则只写在 `worker/sessions.ts` 和 `worker/cases.ts`，网页和 bot 共用；通知只走 PG 触发器加 outbox；新接口返回 404 时前端静默降级（沿用 `api.ts:346-360` 的写法）；D1 迁移放在 `migrations/00x_*.sql`（SQLite 不支持 `IF NOT EXISTS`，有注释说明），PG 迁移放在 `server/migrations/000x_*.sql`，同时更新 `schema.sql`。

| 级别 | 方法 + 路径 | 权限 | 输入 / 返回 | D1 + PG 迁移影响 |
|---|---|---|---|---|
| **必需 ★** | `POST /api/sessions/:id/invite` | 登录，且是该局组织者（`requireOrganizer`，管理员同样适用）；`status='open'` 且还没开始；READ_ONLY 时返回 503 | `{ user_ids: string[] }`，复用 `normalizeInvites`（≤20，去重，去掉组织者）。用 `INSERT … SELECT … ON CONFLICT DO NOTHING` 写入 `invited`，已在局里的人（包括说过「不来」的）不受影响。返回 `{ session: SessionDetail, added: number, skipped: number }` | **不需要迁移**。PG 触发器 `0005:190` 在 INSERT `invited` 时自动发出 `dm.session.invited`，`INVITES_PER_ORGANIZER=3` 和 `SESSION_DM_BUDGET=10` 自动生效。测试：`tests/worker/invites.test.ts` 加一个 describe「建局后再叫人」，覆盖重复、非组织者 403、已开始 400、已取消 400、上限；`tests/pg/dm.test.ts` 加「后叫的人也收到邀请私信，并受额度限制」 |
| 推荐 | 邀请上下文：`SessionItem` 增加 `invite_reason: 'new' \| 'moved' \| null`、`moved_from: string \| null` | 跟着现有的读接口走 | `updateSession` 改时间时，把 `prev_rsvp` 设成原来的 rsvp，`prev_starts_at` 设成旧时间；`setRsvp` 时清空 `prev_rsvp`。`listMyInvites`、`listSessions`、`getSessionDetail` 返回时由这两个字段推导 | D1：`ALTER TABLE session_players ADD COLUMN prev_rsvp TEXT;`、`ALTER TABLE game_sessions ADD COLUMN prev_starts_at TEXT;`。PG：`ADD COLUMN IF NOT EXISTS`；不影响 `knows` 触发器；`import-d1` 要带上新列（`tests/pg/import-d1.test.ts`） |
| 推荐 | `SessionItem.going_preview: UserRef[]`（前 5 个 going） | 公开（going 名单本来就公开在详情里） | 在 `listSessions` 里批量查一次（`IN (…)`，避免 N+1） | 无迁移 |
| 推荐 | `GET /api/me/discord` 增加 `notify_dm: boolean`、`dm_ok: boolean`；新增 `POST /api/me/discord/notify` `{ on: boolean }` | 只返回本人的数据；只在 Node 端实现（`server/src/link-routes.ts`），D1 端 404，前端隐藏第 ③ 步 | 写入逻辑和 bot 的 `/notify` 共用同一条 UPDATE（同时把 `dm_ok` 重置为 1） | 无迁移（`discord_links` 表已有这两列）；CORS 方法 GET 和 POST 已经允许 |
| 推荐 | `POST /api/admin/records/:id/uphold` `{ note?: string }` | 管理员 | `appealed → decided`，分数不变，保留 `appeal_reason`；返回 `{ record }` | D1：可选新增 `review_note` 列。PG：触发器加 `dm.upheld`（「申诉已复核，维持原判」），并在 `dispatcher.ts` 的 `renderDm` 里加这个 kind。解决 H15 的后一半 |
| 可选 | `GET /api/records?mine=filed` | 登录 | 我立的、还没判决的案件，给裁判的「待确认升级」用，不再受 feed 前 50 条限制 | 无迁移 |
| 可选 | 改判保留原判词 | 管理员 | `overrideCase` 之前把原来的 `verdict_*` 复制到新列 `original_verdict_headline`、`original_verdict_reason`；VerdictCard 里折叠显示「原判」 | D1 和 PG 都要加 2 列 |
| 可选 | `POST /api/sessions/:id/cancel` 接受 `{ reason?: string }`，`SessionItem.cancel_reason` | 组织者 | ≤100 字；私信 `dm.session.cancelled` 带上理由 | 两边都给 `game_sessions` 加 `cancel_reason TEXT`；改 render |
| 可选 | `GET /api/users/invitable` | 登录 | `[{ id, username, avatar_url, is_participant }]`，**不含任何 `discord_*` 字段**，解决 M14 | 无迁移 |
| 可选 | `/api/config` 增加 `boardUtcOffsetHours` | 公开 | 和 `/yue`、`synthesizeTitle` 用同一个 offset | 无迁移 |
| 可选 | AI 批量归类改成并发 3 | 裁判 | `case-filing.ts:288-306` 的 for 循环改成有并发上限的池；每个 subject 仍然各自 try/catch | 无迁移；注意 AI 供应商限流 |
| 可选（等决策） | `redactRecord` 判决前对非当事人隐藏 `claim` 和 `claim_summary` | — | 待决问题 3；要同时改 `tests/unit/record-privacy.test.ts` 和 `tests/worker/record-privacy.test.ts` | 无迁移 |

**明确不做**：不放宽 `safeNextPath`；不加自定义请求头（CORS 不动）；不做「催一下」（要新的 outbox kind 和额度，先不碰）；不做 walk-in 补录。

---

## 9. 交付分期

每期由若干个小 PR 组成，每个 PR 都能单独上线。人日是一个熟悉代码的人的粗估。

### P0 地基（约 4.5 人日，纯前端）

| PR | 内容 | 对测试的影响 |
|---|---|---|
| P0-1 层叠与焦点（1d） | main.tsx 导入顺序；outline 焦点环；forced-colors；`--faint`、`--border-input`；排查被修好后露出来的旧样式 | 现有测试都不受影响；source-hygiene 加导入顺序断言 |
| P0-2 Modal 栈 + 底部 sheet（1.5d） | 模块级栈，Esc 和 Tab 只由栈顶处理；`inertDepth` 引用计数保留；panel 内部滚动；sticky `.modal__bar`；≤600px 贴底；新增**可选** prop `dismissible?: boolean`（是否允许点背景关闭）。签名 `open/onClose/labelledBy/children/size` 不变 | `modal-focus.test.tsx` 必须全部通过（setup 只跑一次、onCloseRef、焦点还原）。新增 `tests/dom/modal-stack.test.tsx`：嵌套时 Esc 只关上层，Tab 只在上层循环 |
| P0-3 数据不崩（1.5d） | `refresh` 失败时保留 ready 数据，用 toast 提示；visibilitychange 时刷新；`edg:session` 同步事件；标签页标题显示待办数 | 首屏请求 URL 一个不改；新增 `tests/dom/app-refresh.test.tsx`（第二次 loadCore 返回 500 时榜单还在） |
| P0-4 榜单与动态（0.5d） | 手机显示分数；同分同名次、不发奖牌；动态默认 10 条加「看更多」 | `RecordsFeed` 的 `.feed-row__status--escalate` 类名不变；p8 的 feed 测试照样通过 |

### P1 URL 化与登录回跳（约 3.5 人日，纯前端）

| PR | 内容 | 对测试的影响 |
|---|---|---|
| P1-1 路由内核（1.5d） | `src/lib/route.ts`（parse、navigate、useRoute、直接落地垫 `/`、未知路径给提示）；`OverlayHost`；App 的状态收拢；PlayerDetail 在 `/case/:id` 时把那一起置顶 | `deep-link.test.tsx` 和 `p8-app.test.tsx` 照样通过（断言的是 `location.search`）。**要补的断言**：`location.pathname` 变成 `/session/3`、`/case/7`。新增 `tests/unit/route.test.ts`（坏 id、未知路径、`/api` 前缀不被路由接管）。`afterEach replaceState('/')` 已经有了 |
| P1-2 history 化的层（1d） | 每层一条 history 记录；UI 关闭走 `history.back()`；popstate 关栈顶 | 新增 `tests/dom/back-closes-layer.test.tsx` |
| P1-3 登录回跳（0.5d） | `rememberReturn` 和 `consumeReturn`；访客看到的 CTA；在首登之后才执行 | 新增 `tests/dom/login-return.test.tsx`（只读页 → 登录 → 回到原页面，有提示，**没有任何 POST**） |
| P1-4 文档（0.5d） | CONTRACT.md「Frontend expectations」改成「替换为视图地址」；README 列出路由表 | — |

### P2 待办抽屉与首页压缩（约 5 人日，纯前端）

| PR | 内容 | 对测试的影响 |
|---|---|---|
| P2-1 TodoStrip + TodoDrawer（2.5d） | `lib/todo.ts` 用 `Promise.allSettled` 聚合 `me/invites`、`sessions?scope=mine`、`records?mine=pending`（仍然只在 `pending.statements>0` 时请求）、`records?status=appealed`（仅管理员）、core feed；按组排序；本地已读集合；删除 InviteBanner 和 PendingBanner（及它们的 CSS） | 现有测试不引用这两个横幅。p8 和 deep-link 的 mock 里，没有路由的新请求返回 500，**必须静默**（用 `role=status`，不用 `alert`，避免和测试里的 `findByRole('alert')` 冲突）。新增 `tests/unit/todo.test.ts`（分组、排序、降级）和 `tests/dom/todo-drawer.test.tsx`（每张 InviteCard 的回复都带 `starts_at`，409 先刷新再说明原因） |
| P2-2 约局面板（1d） | 三个 tab：接下来 / 进行中 / 已结束；「等你回」置顶；tablist 的方向键；`DEFAULT_DURATION_MIN` 移进 shared | `session-rsvp-moved` 的列表用例（invited 行有一个「来」）照样通过；/约局/ 标题不变 |
| P2-3 红黑榜 + 战报 teaser（1d） | 门槛、本周口径、并列、全员守约；`WeeklyReportCard` 加**可选** prop `compact`；`/report` | 「上周战报 / 往期战报」标题保留（全卡和 compact 都保留） |
| P2-4 访客与首登（0.5d） | WelcomeCard；OnboardingDialog 加「先看看」并取消默认选中；meta description | `onboarding-roles.test.tsx` 第 75-77 行假设默认选中「上榜选手」，直接点「确认」就提交 `{is_participant:true}`。**这条测试必须改**：先选「上榜选手」再确认。这是有意改变默认值，理由是 M21（默认上榜但不说明后果） |

### P3 组织者操作与安全网（约 6 人日：前端 5 + 后端 1）

| PR | 内容 | 对测试的影响 |
|---|---|---|
| P3-1 后端 ★ invite（1d） | `POST /api/sessions/:id/invite` 加 `api.ts` 的 `inviteToSession` | worker 测试和 pg dm 测试新增（见 §8） |
| P3-2 组织者控制台（2d） | 抽出 `PeoplePicker`；InvitePeopleSheet；RescheduleSheet（PATCH）；ConfirmSheet 取消；ShareRow（复制链接、.ics）；PlayerGroups | 没有 DOM 测试点过「取消约局」，没有受影响的测试；新增 `tests/dom/organizer-console.test.tsx` |
| P3-3 草稿（1d） | 四类草稿；有草稿时 `dismissible=false`；退出登录时清掉 | 新增草稿恢复和清除测试；`modal-focus` 照样通过 |
| P3-4 申诉、撤销、撤案（0.5d） | AppealSheet；撤销倒计时；ConfirmSheet | `verdict-privacy.test.tsx` 照样通过（文案不变）；`player-judge` 照样通过 |
| P3-5 CaseDialog 结果步骤（1d） | 归类、改案由、确认升级、3 分钟撤回、进度文案 | 「确认是团灭级」文案复用；新增 `tests/dom/case-dialog-result.test.tsx` |
| P3-6 回血与时间（0.5d） | HealForecast；`formatWhen` 加绝对时间；RulesPanel 时区修正；撤案后不再显示「按缺席裁决」 | `client-time.test.ts` 和 `time.test.ts` 要同步更新 `formatWhen` 的输出格式期望（有意改动） |
| P3-7 `/me` 与 `/admin`（1d，可能挪到 P4 初） | MeSheet、AdminSheet（复核队列用现有接口） | discord-link 测试照样通过（OnboardingDialog 里仍然有 DiscordLinkCard） |

### P4 推荐后端与收尾（约 7 人日，可以按 PR 拆开或跳过）

| PR | 内容 | 人日 | 对测试的影响 |
|---|---|---|---|
| P4-1 | `invite_reason`、`moved_from` 迁移（D1 + PG + schema.sql + import） | 1.5 | worker 的 session-update 测试、pg 的 import-d1 测试 |
| P4-2 | `going_preview` | 0.5 | sessions 测试 |
| P4-3 | discord notify 接口加第 ③ 步 | 1.5 | pg 的 link-flow 测试 |
| P4-4 | uphold 加 `dm.upheld` | 1.5 | worker 的 cases 测试、pg 的 dm 测试 |
| P4-5 | `users/invitable` 加 PeoplePicker 里的「其他朋友」 | 1 | users 测试 |
| P4-6 | 自托管字体，从 CSP 去掉 Google Fonts；React.lazy 拆出 AdminAiPanel、RollCallDialog、CaseDialog、HistoryChart（M29） | 1 | `pages-headers.test.ts` 的 CSP 原文**必须改**（有意改动：`style-src 'self'`、`font-src 'self'`） |
| P4-7 | 「上次来之后」摘要；第二批 SVG 图标 | 0.5 | — |

**合计约 26 人日**。P0 和 P1（8 人日）做完，就能修好 H1、H2、H3、H6、H8、H9、H10，以及 H13 的一部分；P2 做完，首页就是「待办工作台加计分板」。

---

## 10. 风险与取舍：这个方向放弃了什么

1. **仍然是一条长页面**。手机从 6.4 屏降到大约 3 屏，但不是「每个视图一页」。没有底部 Tab，「榜单」「约局」「我的」不是并列的一级入口；回访的人要靠 TodoStrip 和 Header 头像菜单找到 `/me`、`/todo`。
2. **路由层是「盖在计分板上的抽屉」，不是真正的页面**。选手页和案件页仍然受弹层尺寸和焦点陷阱的限制；`/case/:id` 仍然在当事人页里打开（置顶缓解了一部分），没有做单案时间线视图。以后要做成独立页面，`OverlayHost` 需要再改一次。
3. **待办靠前端拼起来**。最多会多发 3–4 个请求；裁判的「待确认升级」只能从 feed 前 50 条里找（加了可选的 `mine=filed` 才完整）；后端的 `/api/me/todo` 不做，网页和 bot 的 /todo 聚合逻辑会各写一份。
4. **「本周」口径是近似的**。红黑榜用 feed 前 50 条计算，极端情况下（一周内超过 50 条记录）会少算；后端的 `week_delta` 没有列进必需项。
5. **隐私只往前走了一半**。段位说明改成只给本人看了，但**段位名字仍然公开**（比如「资深鸽王」）；判决前的指控仍然对访客公开，等待决问题 3 和 bot 一起定。网页这时还没有比 bot 更严格，只是不比现在更宽松。
6. **H15 要到 P4 才完整**。P3 的复核队列里没有「维持原判」，改判也还会覆盖原判词。
7. **不做浅色模式、PWA、连胜、请假、分数账本、催一下、walk-in、固定周期局**。
8. **几处有意改动**（都已标出替代方案）：
   - CONTRACT 的深链措辞改为「替换为视图地址」。
   - `onboarding-roles.test` 的默认选中改成不预选，用例改为先选再确认。
   - `formatWhen` 的输出格式改为「绝对时间 + 相对时间」，同步改对应单测。
   - P4 改 CSP 原文。
   - InviteBanner 和 PendingBanner 被 TodoStrip 取代，CONTRACT 的「邀请排在战报前面」仍然成立。
   - 「裁判陈述」改名为「立案经过」，没有测试锁定这个文案。
9. **App 外壳仍然集中**。用 OverlayHost 收拢了状态，但单入口、单包的结构基本保留，只在 P4 用 lazy 拆了 4 个大组件。
10. **依赖 Pages 的 SPA fallback**。路径路由要求 `dist` 根目录永远不出现 `404.html`；EdgeOne 部署时要确认也有 SPA 回退（DEPLOY-EDGEONE.md:95）。实施 P1 之前，要在两个托管上都实测一次 `/session/1` 返回 200 的 index.html。