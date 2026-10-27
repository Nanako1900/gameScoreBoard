# 方向 A：工作台优先（我的待办 + 可分享版面）

> 范围：只做设计，不写代码。依据：`analysis.md`（下文简称「分析」）、`raw.json`，以及仓库代码（`src/`、`worker/`、`server/`、`tests/`）。
> 记号：**[复用]** 表示原组件原样保留；**[改]** 表示保留逻辑、换外观或换挂载位置；**[新]** 表示新建组件。

---

## 1. 一句话概念 + 为什么适合这群人

**一句话**：打开网页先看到「轮到我做的事」，处理完再看分数和榜单。每一屏都有自己的链接，可以转发给别人。

**为什么适合这群人**

- **人少，事情集中。** 9 个上榜选手加 4 个旁观账号，平时不会天天来刷榜，只在「被约」「被立案」「该点名」这几个时间点集中来一次（分析 §1）。他们来网页时手里已经有一件具体的事，首屏应该直接把这件事摆出来，而不是先放一张 838px 高的红黑榜。
- **通知已经交给 Discord。** 网页剩下的价值是三样：重操作的工作台、能分享的版面、兜底（分析 §1 第 1、2、4 条）。工作台方向同时满足这三样：
  - 工作台解决「去网页处理」：bot 的 `/todo` 末尾就是一个「去网页处理」按钮（`commands.ts`），落地页就应该是网页版的 /todo。
  - 路由解决「能分享」：每局、每个案件、每个人都有独立 URL。
  - 兜底：没绑 Discord、或者私信发不到（dm_ok=0）的人，打开首页就能看到全部待办，不会漏事。
- **每个角色都能找到入口。** 分析 H4 指出组织者、裁判、管理员现在都没有待办入口：`pending.appeals` 一直没被用过；session #3 已经开局，状态还是 open。工作台把六类角色的待办放进同一个收件箱，按角色显示不同条目。
- **语气。** 工作台的默认情绪是「提醒你、帮你做完」，不是「围观谁被罚」。这和分析 §5 的语气原则一致：罚要有出路，判决前不暗示有罪。梗保留在约局、战报、空状态和庆祝这些地方。

---

## 2. 信息架构

### 2.1 路由表

| 路由 | 页面（组件） | 给谁 | 回答的问题 |
|---|---|---|---|
| `/` | `HomePage`［新］ | 所有人 | 未登录：「这是什么？谁靠谱？最近有什么局？」<br>已登录：「我现在要做什么？我多少分？我排第几？」 |
| `/sessions` | `SessionsPage`［新，内部复用 `SessionsPanel` 逻辑］ | 所有人 | 「接下来有什么局？哪局在等我回？哪局该点名？」<br>tab 写在 `?tab=upcoming\|live\|mine\|past` |
| `/sessions/new` | `SessionFormPage`［改自 `SessionFormDialog`］ | 已登录 | 「约一局要填什么？」 |
| `/sessions/:id` | `SessionPage` = `SessionView`［改自 `SessionDetailDialog`］+ `OrganizerConsole`［新］ | 所有人；控制台只给组织者 | 「几点？谁来？我去不去？」<br>组织者：「还要叫谁？要不要改时间？」 |
| `/sessions/:id/rollcall` | `RollCallPage`［改自 `RollCallDialog`，不再嵌套弹层］ | 组织者 | 「谁准时、谁迟到、谁没来？要不要立案？」 |
| `/board` | `BoardPage`［新：`Leaderboard` 换皮 + `WeekHighlights` + `RecordsFeed`］ | 所有人 | 「谁靠谱？这周发生了什么？」 |
| `/players/:id` | `PlayerPage`［新外壳，主体是 `PlayerDetail`，props 签名不变］ | 所有人；本人和管理员看到的更多 | 「这人为什么是这个分？」 |
| `/cases/:id` | `CasePage`［新：`CaseTimeline` + `CaseActionBar` + `VerdictCard`］ | 所有人；操作栏按角色显示 | 「这事怎么回事？现在到哪一步了？我能做什么？」 |
| `/cases/new` | `CaseFilePage`［改自 `CaseDialog`］ | 裁判 | 「记一笔，AI 归成了什么？」 |
| `/me` | `MePage`［新］ | 已登录 | 「我的分数、约局、案件、通知设置、身份」 |
| `/rules` | `RulesPage`［改自 `RulesPanel`，默认展开］ | 所有人 | 「规则是什么？谁能看到什么？」 |
| `/report` | `ReportPage`［宿主改为 `WeeklyReportCard`］ | 所有人 | 「上周发生了什么？」（P3 起支持 `?week=`） |
| `/admin` | `AdminPage`［新：`ReviewQueue` / `UserAdmin` / `AdminAiPanel` / 战报］ | 管理员 | 「谁在等我复核？」 |
| 其他路径 | `NotFound`［新］ | 所有人 | 「这页不存在」 |

**路由约束**
- 不使用 `/api`、`/auth`、`/link` 开头的路径（它们被 Pages Functions 和 API 占用）。
- 构建产物里不放 `404.html`：Pages 的 SPA 回退依赖它不存在，`NotFound` 由前端渲染。
- 路由手写，放在 `src/lib/router.ts`，约 80 行，提供 `useRoute`、`navigate`、`<Link>`，监听 popstate。不新增依赖。
- 每个页面用 `React.lazy` 拆包（M29）。代码都是同源 chunk，符合 `script-src 'self'`。

### 2.2 导航
- **手机**：底部 `BottomNav`［新］，四项：
  - 「首页」：带待办数红点。
  - 「约局」：有「等你回」时带圆点。
  - 「榜单」
  - 「我的」：管理员有待复核时带圆点。
- **裁判**：右下角保留「记一笔」浮动按钮（FAB），位置在 BottomNav 之上，点击后跳到 `/cases/new`。
- **桌面（≥1024px）**：导航并入顶栏 `TopBar`［重写自 `Header`］，排列为「品牌 · 首页 · 约局 · 榜单 · 规则 ｜ 记一笔（裁判）· 头像菜单」。
- 品牌改用 `<Link>`，不再整页刷新。
- 标签页标题在有待办时显示为 `(3) EDG 信誉分`。

### 2.3 旧深链映射（永久兼容，CONTRACT.md:410-417）

启动时由 `src/lib/deepLink.ts`（扩展现有 `readDeepLink` / `withoutParams`）执行一次，规则如下：

| 旧链接 | 处理 |
|---|---|
| `/?case=N`（N 为正整数） | `replaceState` 到 `/cases/N`，其他参数原样保留（`?case=7&utm=dc` → `/cases/7?utm=dc`）。只读，不写数据。 |
| `/?session=N` | `replaceState` 到 `/sessions/N` |
| `/?case=abc` 等非法 id | 删掉该参数，停在 `/`，不发请求 |
| `/?linked=discord` | 停在 `/`，显示 `DiscordLinkedNotice`（「Discord 绑定成功」+「关闭提示」），只删掉 `linked` |
| `/?onboarding=1`（可与上面任一组合） | 先弹 `OnboardingDialog`，关掉后再去目标路由（保留「首登优先于深链」） |
| `/cases/N` 返回 404 / 500 | CasePage 原地显示「链接里的案件不存在了。」/「打不开链接里的案件，稍后再试。」，附「回首页」。文案和现有测试一致。 |

- bot 发出的旧链接一律可用。
- P2 起，bot 的 `render.ts` 改为发新路径（可选）；旧路径不下线。

### 2.4 首页的 DOM 顺序（等于视觉顺序和 Tab 顺序，不用 CSS order）

- **已登录**：DiscordLinkedNotice / LinkMissingNotice → `ResumeCard`（登录前想做的事）→ **`TodoInbox`** → `MyScoreStrip` → `BoardMini`（含本周看点一行）→ `UpcomingSessions`（含「接下来的约局」标题）→ `ReportTeaser` → `RecentVerdicts`（5 条）→ footer
- **未登录**：`WelcomeCard` → `UpcomingSessions` → `BoardMini` → `ReportTeaser` → footer
- 两种状态下页面上都有含「约局」的 heading，测试用它判断加载完成。待办都排在战报前面（CONTRACT.md:406-407）。

---

## 3. 关键页面线框（375px 优先）

### 3.1 首页 · 未登录
```
┌─────────────────────────────────────┐
│ ◆ EDG 信誉分                [ 登录 ] │ TopBar[新]，登录是 <a> 顶层跳转
├─────────────────────────────────────┤
│ WelcomeCard[新]（可关，localStorage）│
│ 开黑小队的守约记分板。               │
│ 约了就来，来不了提前说——提前说不扣分。│
│ 放鸽子会被记一笔，每周一自动回血 +15。│
│ [ 用 Nanako 账号登录 ]  看看规则 →   │
│ 还没进群？加入 Discord →             │ discord.nanako.org
├─────────────────────────────────────┤
│ 接下来的约局                 全部 →  │ h2 /约局/；UpcomingSessions[改自 SessionsPanel]
│ ┌─────────────────────────────────┐ │
│ │ 周五 21:00 · 还有 2 天           │ │ SessionRow[新]
│ │ 王者五排 · 小明 组织             │ │
│ │ ●●●○○ 3 人来 · 差 2 个           │ │ going_preview 头像
│ │                  [ 登录后报名 ]  │ │ 记下 resume 意图
│ └─────────────────────────────────┘ │
├─────────────────────────────────────┤
│ 信誉榜                     完整榜 →  │ BoardMini[新]
│ 本周全员守约 🎉                      │ WeekHighlights 一行
│ 1  ◐ 小明                    100    │ 分数一直显示（H6）
│ 2  ◐ 阿飞                    100    │ 同分同名次，不发奖牌
│ 3  ◐ 老王                     96    │
│ 4  ◐ ……                       92    │
│ 5  ◐ ……                       88    │
├─────────────────────────────────────┤
│ 上周战报 · 10/12–10/18     读全文 →  │ ReportTeaser[新，h2 用 WeeklyReportCard 标题规则]
│ 「平平无奇的一周。」 开局 3 · 立案 1  │
└─────────────────────────────────────┘
  首屏 812px 内：欢迎卡 + 第一个约局 + 榜单前 2–3 名
```
- 不再显示红黑榜大卡和完整动态流。动态流移到 `/board`。
- `index.html` 的 description 改为「开黑守约记分板：约了就来，来不了提前说。」，分享预览里不再出现「头号鸽王」（M23）。

### 3.2 首页 · 已登录选手
```
┌─────────────────────────────────────┐
│ ◆ EDG 信誉分                  (◐) ▾ │ 头像菜单：我的 / 编辑身份 / 退出
├─────────────────────────────────────┤
│ 待办 · 3                             │ TodoInbox[新]，h2
│ ┌─────────────────────────────────┐ │ TodoCard variant=statement[新]
│ │ ⚑ 待你说明 · 还剩 5 小时         │ │ 剩余 <2 小时变 --danger
│ │ 放鸽子 · 周三 王者五排           │ │
│ │ 截止 今天 23:40（UTC+8）         │ │
│ │                   [ 写说明 → ]   │ │ → /cases/12#statement
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │ TodoCard variant=invite_moved
│ │ ↻ 改时间了 · 小明 组织           │ │
│ │ 王者五排  周五 20:00 → 22:00     │ │ prev_starts_at 加删除线
│ │ 你之前说「来」，新时间还来吗？   │ │
│ │ [ 来 ] [ 待定 ] [ 不来 ]         │ │ RsvpControl[新]，aria-label 带局名
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │ TodoCard variant=invite
│ │ ✉ 新邀请 · 阿飞 约你             │ │
│ │ 云顶 · 周六 15:00 · 还有 3 天    │ │
│ │ ●●○ 2 人来 · 不限人数            │ │
│ │ [ 来 ] [ 待定 ] [ 不来 ]         │ │
│ └─────────────────────────────────┘ │
│ ▸ 你答应了 1 局（今晚 21:00）        │ 折叠：committed 卡
│   来不了？开局前说不扣分 [改成不来]   │
├─────────────────────────────────────┤
│ MyScoreStrip[新]                     │
│ ◐ 82 分 · 守时楷模（只你可见）       │ 段位只给本人看
│ 第 6 名 · 本周 −5                    │
│ 周一回血 +15 → 预计 97 分 · 还有 2 天│ 宽恕看得见（M7）
├─────────────────────────────────────┤
│ 信誉榜                     完整榜 →  │ BoardMini，你的行加高亮描边
│ 本周之星 老王 +8                     │
│ 1 小明 100 · 2 阿飞 100 · 3 老王 96   │
│ … 6 你 82                            │ 不在前 5 时补一行自己
├─────────────────────────────────────┤
│ 接下来的约局 …（最多 3 条，已在待办  │ 已在待办里的局只标「在待办里」，
│ 里的局不再给按钮）                   │ 不再重复按钮（M1）
├─────────────────────────────────────┤
│ ReportTeaser · RecentVerdicts        │
├─────────────────────────────────────┤
│ [首页•3] [约局•] [榜单] [我的]       │ BottomNav[新]
└─────────────────────────────────────┘
```

**没有待办时**
```
│ 待办                                 │
│ 没有待办，清清爽爽 ✨                 │ 和 bot /todo 空状态同一句
│ 想开一局？ [ 组一局 ]                │
```

**排序规则**（写在 `src/lib/todo.ts` 的 `sortTodo`，DOM 按这个顺序渲染）：
1. 说明截止 < 24h
2. 待点名
3. 改时间
4. 新邀请（按开局时间）
5. 待确认升级
6. 待复核申诉
7. 你答应了
8. 设置类提示（Discord 私信发不出、尚未绑定）

### 3.3 首页 · 裁判 / 管理员（在 3.2 基础上多出的卡片）
```
│ 待办 · 5                             │
│ ┌─────────────────────────────────┐ │ variant=rollcall（任何组织者）
│ │ ☑ 该点名了 · 王者五排            │ │
│ │ 周三 21:00 · 1 小时前结束 · 5 人 │ │
│ │ 结算后才会记分     [ 去点名 → ]  │ │ → /sessions/9/rollcall
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │ variant=escalation（立案裁判 / 管理员）
│ │ ⚖ 待你确认 · AI 建议升级         │ │
│ │ 老王 · 放鸽子 → 团灭级？         │ │ 中性措辞，判决前不写「有罪」
│ │ 需要立案裁判在判决前确认          │ │
│ │                  [ 去看看 → ]   │ │ → /cases/14
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │ variant=appeals（管理员，聚合一条）
│ │ ⚐ 2 个申诉待复核 · 最早 3 天前   │ │
│ │               [ 打开复核队列 → ] │ │ → /admin?tab=review
│ └─────────────────────────────────┘ │
...
                                (＋记一笔)  ← 裁判 FAB，位于 BottomNav 之上
```

**桌面（≥1024px）**
- 两栏，DOM 顺序为左栏在前。
- 左栏 2/3：`TodoInbox` → `UpcomingSessions` → `RecentVerdicts`。
- 右栏 1/3（sticky，内容短于视口才能真正粘住，解决 M27）：`MyScoreStrip` → `BoardMini`（前 8）→ `ReportTeaser`。

### 3.4 约局列表 `/sessions`
```
┌─────────────────────────────────────┐
│ ← 约局                     [ 组一局 ]│
│ ┌────┬───────────┬────┬─────┐       │ Segmented tablist（完整的 roving tabindex）
│ │接下来│进行中·待点名│我的│已结束│      │ ?tab=upcoming|live|mine|past
│ └────┴───────────┴────┴─────┘       │
│ 等你回 · 2                           │ 置顶分组（M2）
│ ┌─────────────────────────────────┐ │ SessionRow
│ │ 周五 22:00 · 改时间了            │ │
│ │ 王者五排 · 小明 · ●●● 3 人来     │ │
│ │ [ 来 ][ 待定 ][ 不来 ]           │ │ 每行一组按钮，aria-label 带局名
│ └─────────────────────────────────┘ │
│ 其他                                 │
│ ┌─────────────────────────────────┐ │
│ │ 周日 20:00 · 云顶 · 阿飞         │ │
│ │ ●● 2 人来 · 你：待定             │ │ 我的状态用文字 chip，不只靠颜色
│ └─────────────────────────────────┘ │
│ （空）第一个开黑的永远是英雄 [组一局] │ 保留原空状态梗
└─────────────────────────────────────┘
```
- 「进行中·待点名」：status=open 且已过开局时间的局（修复 M4）。分两种：
  - 「进行中」：还在开局时长内。
  - 「待点名」：已到 starts+duration，只有组织者能看到「去点名」按钮。
- 「已结束」：已结算和已取消的局。已取消显示「已取消 · 理由：……」，不再直接消失。

### 3.5 约局详情 `/sessions/:id`（参与者视角）
```
┌─────────────────────────────────────┐
│ ← 约局                      [分享 ⇪] │ ShareSheet[新]
│ 王者五排                              │ h1；标题由服务端合成
│ 周五 10/30 22:00（UTC+8）· 还有 2 天 │ 绝对时间 + 相对时间 + 时区（M19）
│ 小明 组织 · 最多 5 人 · 约 2 小时    │
│ 备注：老地方，开黑语音               │
├─────────────────────────────────────┤
│ 你去吗？                             │ RsvpControl：整个面板只有一个「来」
│ ( 来 )( 待定 )( 不来 )               │ radiogroup + aria-checked + ✓ 后缀
│ 开局前改成「不来」不扣分。            │ M20
├─────────────────────────────────────┤
│ 来 · 3        ◐小明(组织) ◐阿飞 ◐你  │ PeopleGroups[新]
│ 待定 · 1      ◐老王                  │
│ 没回 · 2      ◐大刘 ◐小七            │ 用 --muted，不用 --faint（H10）
│ 不来 · 1      ◐阿杰                  │
├─────────────────────────────────────┤
│ [ 加到日历 .ics ]                    │ 给没绑 Discord 的人补提醒
├─────────────────────────────────────┤
│ 这局的记录（结算后出现）              │ 紧凑版 VerdictCard，可点进 /cases/:id（M12）
└─────────────────────────────────────┘
```
- 未登录时，RSVP 区换成：「登录后就能报名 [ 用 Nanako 账号登录 ]」。点击后把 `{path:'/sessions/3'}` 写进 sessionStorage。
- 409 处理（已有测试锁定）：用 role=alert 显示「约局时间已经改了，新时间是 周五 22:00。再选一次？」。新时间来自刷新后的数据。

### 3.6 组织者控制台（同一页，只在 `session.organizer.id === me.id` 时渲染，放在 RSVP 区之后）
```
├─────────────────────────────────────┤
│ 组织者                               │ OrganizerConsole[新]，h2
│ [ ＋再叫几个人 ] [ 改时间 ]           │
│ [ 复制邀请链接 ] [ 取消这局 ]         │
│ 6 人里 4 人能收到 Discord 私信 ⓘ      │ P2 可选：只显示总数，不点名
├─────────────────────────────────────┤

「＋再叫几个人」→ InviteSheet[新]（底部抽屉，Back 键关闭）
┌─────────────────────────────────────┐
│ 再叫几个人                      ✕    │ 关闭按钮固定在顶栏（H2）
│ 🔍 搜名字                             │
│ 上次一起玩的                          │ GET /api/users/invitable 分组（P1）
│ ☐ ◐ 大刘   ☐ ◐ 小七                  │ 选中显示 ✓，不只靠颜色
│ 在榜的                                │
│ ☐ ◐ 阿杰                              │
│ 其他朋友（不在榜）                     │ M14
│ ☐ ◐ 新人小李  「不在榜，不参与计分」   │
│ ─────────────────────────────────── │
│ 已选 2 人 · 他们会收到 Discord 私信    │
│ [ 发出邀请 ]                          │ POST /api/sessions/:id/invite
└─────────────────────────────────────┘
发完 → Toast：「已邀请 2 人。没绑 Discord 的人收不到私信，记得在群里喊一声。」

「改时间」→ RescheduleSheet[新]
│ 改到什么时候？                        │
│ (今晚 22:00)(明晚 20:00)(其他时间…)   │ shared/quickTime 时段，按看板时区
│ 改了之后，已回复的 4 个人要重新确认，  │
│ 他们会收到一条「约局改时间了」私信。    │
│ [ 确认改到 周五 22:00 ]  [ 再想想 ]   │ PATCH /api/sessions/:id {starts_at}

「取消这局」→ 原地确认（沿用 DiscordLinkCard 的写法，焦点落在「再想想」）
│ 取消这局？已回复的 4 个人会收到取消私信。│
│ 理由（可选）[ 临时加班，改天再约____ ]  │ cancel_reason（P1）
│ [ 确认取消 ]  [ 再想想 ]               │ 确认取消用 --danger 描边按钮

开局后，控制台变为：
│ 进行中 · 22:00 开局 · 预计 24:00 结束  │
结束后：
│ 该点名了    [ 去点名 → ]              │ → /sessions/:id/rollcall
结算后：
│ 已结算 · 立案 1 · 加分 2              │
│ [ 再约一次 ]  同一批人，下周同一时间    │ 预填 /sessions/new?from=9（P2）
```

### 3.7 发起 `/sessions/new`
```
┌─────────────────────────────────────┐
│ ← 组一局                              │
│ 什么时候？（UTC+8）                   │
│ (今晚 20:00)(今晚 21:00)(今晚 22:00) │ chip 和 /yue 同源、同时区（M19）
│ (明晚 20:00)(后天 20:00)(其他时间 ▾) │
│ 叫谁？                                │ InvitePicker（和 InviteSheet 共用组件）
│ 上次一起玩的 ☐大刘 ☐小七 …            │
│ 在榜的 ☐阿杰 …   其他朋友 ☐新人小李    │
│ 几个人？ [ 不限 | 3 | 5 | 10 ]        │ capacity（后端已有字段）
│ 备注（可选）[____________________]    │ note
│ ─────────────────────────────────── │
│ [ 发出邀请 ]                          │ sticky 底部
└─────────────────────────────────────┘
成功 → 跳到 /sessions/:id，并显示一次性卡片：
│ ✓ 约好了！已邀请 3 人，Discord 会通知他们。│
│ [ 复制邀请链接 ] [ 加到日历 ]            │
```
- 表单离开保护：选了人或填了备注后要返回，弹确认「放弃这局？已选的 3 个人不会保存。」，按钮「继续编辑 / 放弃」。

### 3.8 点名 `/sessions/:id/rollcall`
- 页面化后不再有嵌套弹层，Esc 不会丢结果（M10）。
- 第一步「点名」、第二步「结算」，原逻辑保留：加分默认勾选，扣分默认不勾，「跳过全部，仅记录出勤」是一等按钮。
- 未保存时离开，页面提示「点名还没提交，离开会丢失」。

### 3.9 选手页 `/players/:id`
```
┌─────────────────────────────────────┐
│ ← 榜单                                │
│ ◐(128) 老王                           │ h1 = 名字；ScoreGauge[复用]
│ 96 分 · 第 3 名 · 本周 +8             │ 访客看不到段位（M6）
│ ┌ 本人可见 ───────────────────────┐ │
│ │ 段位：守时楷模 · 靠谱             │ │ TierBadge[复用] + blurb，只给本人
│ │ 周一回血 +15 → 预计 100 分 🎉     │ │
│ └─────────────────────────────────┘ │
│ 分数怎么来的                          │ ScoreLedger[新]（P2 需要后端 reason）
│ 10/21 放鸽子（已判决）  −10  → 85    │ 每行链接到 /cases/:id
│ 10/20 每周回血          +15  → 95    │
│ 10/15 管理员调整        +2   → 80  理由：… │
│ ▸ 走势图                              │ HistoryChart[改]：按时间轴、字号 ≥12px（M26）
│ 记录（12）                            │ VerdictCard 列表，#case-N 锚点保留
│ ▸ 管理员工具                          │ AdminScoreForm[复用] + 设为裁判 / 取消裁判资格
└─────────────────────────────────────┘
```
- `PlayerDetail(userId, me, onClose, focusRecordId)` 签名不变，作为页面主体。`onClose` 映射为 `navigate(back)`。
- 原来「先关掉 PlayerDetail 再打开说明框」的替换逻辑，改为跳转到 `/cases/:id#statement`。

### 3.10 案件页 `/cases/:id`
```
┌─────────────────────────────────────┐
│ ← 返回                                │
│ 案件 #7 · 放鸽子 · 待说明              │ eyebrow <p>
│ ◐ 选手                                 │ h1 = 被记录人名字（保留深链测试 heading）
├─────────────────────────────────────┤
│ CaseTimeline[新]                      │
│ ● 立案 · 阿飞 · 10/21 22:10           │
│ ● 等当事人说明 · 截止 10/22 10:10      │
│ ○ 判决                                 │
│ ○ 申诉 / 复核（如有）                  │
├─────────────────────────────────────┤
│ VerdictCard[改] id="case-7"            │ 深链进来时加 vc--focus 并聚焦
│ 判决前：「这起案件在等当事人说明，     │ 访客不显示指控（P2 后端脱敏，M5）
│ 判决后再公开。」分数变化：−15 ~ −5 待定│ 不显示 0
├─────────────────────────────────────┤
│ CaseActionBar[新]（手机 sticky 底部）  │ 按角色显示：
│ 当事人：[ 写说明 ]                     │ awaiting_statement
│ 当事人：[ 申诉 ]                       │ decided
│ 立案人：[ 撤案 ] / [ 撤销 · 还剩 12:34 ]│ 判决前撤案；判决后 15 分钟内可撤销，倒计时
│ 立案人或管理员：[ 确认是团灭级 ] [ 不升级 ]│ 文案保留
│ 管理员：[ 维持原判 ] [ 改判 ]           │ 申诉中
│ 访客：无按钮                           │
└─────────────────────────────────────┘
```
**写说明**（点「写说明」后在页内展开 `StatementEditor`［改自 `StatementDialog`］，不再用弹层）
```
│ 说清楚发生了什么                      │
│ 快捷：(网络断了)(临时有事)(提前说过了) │ 只插入文字，不自动提交
│ [__________________________________] │ 草稿自动存到本机 localStorage
│ 草稿已保存在这台设备上 · 0/500         │
│ 只能提交一次，交了不能改。提交后 AI    │
│ 会马上给出判决。说明只有你、立案人、    │
│ 裁判和管理员能看到。                    │ 写清隐私范围（M18）
│ [ 提交说明 ]                          │
```
- 提交后原地显示判决卡：「判决出来了 · −8」，附「每周一回血 +15 → 预计 92 分」和「觉得不公平？可以申诉」。

**申诉**（`AppealSheet`［新］）
```
│ 申诉                                  │
│ 为什么觉得判得不对？（至少 10 个字）   │
│ [__________________________________] │
│ 申诉交给管理员复核，结果出来前分数不变。│
│ [ 提交申诉 ]  [ 再想想 ]               │ appealCase(id, reason)，接口已支持
```

**立案 `/cases/new`**（`CaseFilePage` + `FilingResult`［新］）
```
│ 记一笔                                │
│ 谁？ ☐老王 ☐大刘 …（最多 8 人）        │
│ 发生了什么（大家共用）[__________]     │ 草稿保护
│ ▸ 给某人补一句                        │
│ [ 提交，让 AI 归类 ]                   │
提交后不关页，逐行显示结果（H16）：
│ 老王 · 放鸽子（AI）−15~−5 · 待说明      │
│     [ 改案由 ▾ ] [ 撤回 · 2:59 ]       │ reclassifyCase / withdrawCase
│ 大刘 · 迟到（AI 未参与，按基础分）      │ fallback 有明显标识
│ 失败：小七 · 稍后再试 [ 重试 ]          │
```

### 3.11 我的 `/me`
```
┌─────────────────────────────────────┐
│ 我的                                  │
│ MyScoreCard：82 · 守时楷模 · 回血预告  │
│ ─ 我的约局 ─ 接下来 2 · 待点名 1 →     │ scope=mine
│ ─ 我的案件 ─ 待说明 1 · 申诉中 0 →     │
│ ─ 通知与 Discord ─ (#notify)          │ NotifySetup[新，内嵌 DiscordLinkCard]
│ ① 加入服务器  discord.nanako.org ✓    │
│ ② 绑定账号    已绑定 @… [ 解绑 ]       │ 「绑定 Discord」「解绑」「确认解绑」文案保留
│ ③ 私信提醒    [■ 开]  最近一次：送达 ✓ │ notify_dm / dm_ok（P1）
│   ⚠ 上次私信没发出去：去 Discord 打开  │ dm_ok=0 时显示
│   「允许服务器成员私信」后点 [我改好了] │
│ ─ 名字与身份 ─                         │ OnboardingDialog 的表单做成页内区块
│ 选择身份（radiogroup 保留）            │
│ ─ 账号 ─ [ 退出登录 ]                  │
└─────────────────────────────────────┘
```

---

## 4. 邀请功能整合方案

### 4.1 生命周期：每一步的网页交互和文案

| 步骤 | 网页入口与交互 | 文案示例 | 数据/接口 | Discord 对齐 |
|---|---|---|---|---|
| **① 创建** | `/sessions/new` 或首页空状态「组一局」；时段 chip 按**看板时区** | 「什么时候？（UTC+8）」「发出邀请」 | `POST /api/sessions`（已有，补 capacity、note） | 与 `/yue` 用同一组时段和时区；`/yue` 回复里「在网页上可以看到它、邀请人」这句从此属实 |
| **② 邀请** | 创建时选人，或之后在控制台点「＋再叫几个人」；名单按「上次一起玩的 / 在榜的 / 其他朋友」分组 | 「已邀请 2 人。没绑 Discord 的人收不到私信，记得在群里喊一声。」 | ★ `POST /api/sessions/:id/invite`、★ `GET /api/users/invitable` | 新增的 invited 行由 PG 触发器发 `dm.session.invited`，额度 3 / 10 / 20 不变 |
| **③ 通知** | 首页 `TodoInbox` 显示全部邀请（不只第一个）；BottomNav 红点；标签页标题 `(3)`；页面回到前台时刷新 | 新邀请：「✉ 新邀请 · 阿飞 约你」 | `GET /api/me/invites`（已有）+ ★ `invite_reason` | 同一条邀请在网页和 /todo 同时出现，内容一致 |
| **④ 报名** | `RsvpControl` 三态「来 / 待定 / 不来」，三处共用一份数据；回复后弹 toast，没有消失感 | 「已回复「来」· 周五 22:00」，带「撤回」按钮（仅当之前是 going/maybe/out 时显示，invited 无法撤回，改为「随时可以在约局页改」） | `POST /api/sessions/:id/rsvp {rsvp, starts_at}`；409 时刷新再说明原因 | bot 按钮「可能」改为「待定」，统一引用 `shared/attendance` 的 `RSVP_LABEL`（P2，bot 小改） |
| **⑤ 提醒** | 已答应的局在首页折叠为「你答应了 1 局」；开局前 2 小时内提到最前面；详情页「加到日历 .ics」（本地 Blob 生成，带 VALARM −15 分钟） | 「今晚 21:00 · 还有 3 小时。来不了？开局前说不扣分 [改成不来]」 | 前端从 `scope=mine` 推导 | bot 照常在开局前 15 分钟发私信；.ics 给收不到私信的人兜底 |
| **⑥ 改期** | 控制台「改时间」抽屉，写明影响人数；被邀请者看到「↻ 改时间了」卡，旧时间加删除线 | 组织者：「改了之后，已回复的 4 个人要重新确认」。被邀请者：「你之前说「来」，新时间还来吗？」 | `PATCH /api/sessions/:id`（已有）+ ★ `prev_rsvp` / `prev_starts_at` | 后端已合并发 `dm.session.changed`；P2 可在私信里补「你之前说「来」」 |
| **⑦ 取消** | 原地二次确认，理由可选；取消后列表不消失，挪到「已结束」，显示「已取消 · 理由」 | 「取消这局？已回复的 4 个人会收到取消私信。」 | `POST /api/sessions/:id/cancel {reason?}` + ★ `cancel_reason` | 取消私信里带上理由（bot `render` 小改） |
| **⑧ 进行中** | 列表 tab「进行中·待点名」；详情顶部「进行中 · 预计 24:00 结束」；报名按钮换成「已开局」 | 「已开局，报名已关闭」 | 前端根据 `starts_at` / `duration_min` 推导 | bot 开局时刷新卡片并收起报名按钮，两边状态一致 |
| **⑨ 点名** | 首页「☑ 该点名了」卡 → `/sessions/:id/rollcall` 页面；离开前提示未提交 | 「结算后才会记分。点名本身不扣分。」 | `POST .../rollcall`、`.../settle`（已有） | bot 的 `dm.session.rollcall` 链接落到同一页（旧链接 `/?session=N` → 详情页，详情页对组织者高亮「去点名」） |
| **⑩ 结算** | 结算页沿用原逻辑；结算后详情页列出这局的记录，每条链到 `/cases/:id` | 「已结算 · 立案 1 · 加分 2」 | `GET /api/records?session=N`（已有） | 立案私信照旧 |
| **⑪ 分享** | 控制台和详情页右上角「分享」：`ShareSheet` 提供复制链接（`/sessions/3`）、系统分享（`navigator.share`，有则用）、.ics | 「链接已复制。朋友打开后登录就能报名。」 | 纯前端 | bot 卡片里的链接也能用；P2 起 bot 改发新路径 |

**登录回到原页**（H3，纯前端）
1. 未登录用户在 `/sessions/3` 点「登录后报名」时，写入 `sessionStorage['edg.resume'] = {path:'/sessions/3', intent:{kind:'rsvp', session:3}, exp:+15min}`。
   - path 只接受路由白名单，id 必须是正整数。
   - 不写 rsvp 值，避免「链接替人写数据」。
2. 登录回跳到 `/`（或 `/?onboarding=1`）。如果有首登引导，先弹引导，关闭后再处理 resume。
3. 跳到 `/sessions/3`，RSVP 区上方出现 `ResumeCard`：「你刚才想报名这局 —— 来吗？」，用户点了才写入。
4. resume 只用一次，读完即删。
- 后端 `safeNextPath` 不动，「`next` can never become an open redirect」的约束原样保持。

### 4.2 收件箱数据：P0 拼装，P2 换聚合接口

| 待办类型 | P0 数据来源（不新增必需请求） | P2 来源 |
|---|---|---|
| 新邀请 / 改期 | `/api/me/invites`（P1 起带 `invite_reason`；P0 一律显示为「邀请」） | `GET /api/me/todo` |
| 待说明 | `/api/records?mine=pending`（沿用 `pending.statements>0` 时才拉的规则） | 同上 |
| 你答应了、待点名 | 新增 `/api/sessions?scope=mine`，**只在登录后拉，失败静默** | 同上 |
| 待确认升级 | 从已拉的 `/api/records?limit=50` 里过滤：`escalation_suggested && 判决前 && (reporter.id===me.id \|\| is_admin)` | 精确查询 |
| 待复核申诉 | `pending.appeals>0` 时拉 `/api/records?status=appealed&limit=200` | 同上 |
| 设置提示 | P1：`/api/me/discord` 的 `notify_dm` / `dm_ok` | 同上 |

- 所有附加请求都走 `Promise.allSettled`，失败时只让对应卡片显示「这块没加载出来 [重试]」（M11）。
- 测试锁定的首屏 URL 一个不改。

### 4.3 和 Discord bot 对齐
- **同一份待办逻辑**：P2 新增 `worker/todo.ts` 的 `listTodo(db, user)`，供 `GET /api/me/todo` 和 bot 的 `handleTodo` 共同调用。bot /todo 因此补上「该点名」「待确认升级」「改时间」三类；空状态两边都是「没有待办，清清爽爽 ✨」。
- **同一套词**：RSVP 统一为 来 / 待定 / 不来；「说明」只指被告写的说明；「指控」只指立案人写的内容；「撤案」和「撤销」都附一句解释（见 §5）。
- **同一个时区**：网页时间按看板时区显示（P1 由 `/api/config` 提供 `boardTzOffsetMin`）。浏览器时区与看板时区不一致时，附注「（UTC+8）」。
- **链接**：bot 继续发 `/?case=` 和 `/?session=`，前端负责翻译。P2 可选改成 `/cases/N`、`/sessions/N`、`/sessions/N/rollcall`、`/admin?tab=review`，旧格式永久有效。

### 4.4 「邀请」的其他含义如何并入

1. **Discord 服务器邀请**
   - 未登录的 `WelcomeCard` 里加「还没进群？加入 Discord →」。
   - `/me#notify` 第 ① 步链接到 discord.nanako.org。
2. **Discord 绑定**
   - 从「编辑我的身份」的深处挪到 `/me#notify` 第 ② 步。
   - 文案改为讲清好处：「绑定后，被约、改时间、该写说明都会私信你，在私信里一键报名。」
   - 没绑定的用户，首页待办末尾有一条可关闭的提示。
   - 私信发不出去（dm_ok=0）时提到待办前面，标为 `--attn`。
3. **新人上榜**
   - 分享出去的约局链接就是邀请：朋友打开 → 看到局 → 登录 → 首登引导 → 回到这局 → 「来吗？」。
   - 首登引导讲清后果：「上榜后，你的分数会公开在榜上；答应了却没来会被记一笔。也可以先点「稍后再说」看看，以后在「我的」里随时上榜。」radiogroup「选择身份」的三项不变。
   - 组织者可以邀请不在榜上的人，选项旁标注「不在榜，不参与计分」（M14）。
4. **分享链接**：见 §4.1 第 ⑪ 步和登录回跳。

---

## 5. 人性化功能清单（选自分析 §5）

| 序 | 选用项 | 落地方式（交互 + 文案） | 期 |
|---|---|---|---|
| 1 | 红黑榜去羞辱化 | 删掉 `RedBlackBoard`，换成 `WeekHighlights` 一行（约 40px，嵌在 BoardMini 头部）。<br>「本周之星」：本周已判决净增分最高，且本周无罚，≥ +5 才评。<br>「本周鸽王」：本周有已判决的放鸽子（delta ≤ −10）才评，并写出处：「本周鸽王 老王 · 因为周三王者五排放鸽子」，点开是 `/cases/:id`。<br>没人达标时显示「本周全员守约 🎉」。并列时一起列出，不按名字排。只看本周已判决的记录，不看总分。 | P0（P0 用 50 条记录推算，P2 改用 `week_delta`） |
| 2 | 我的今天 | 首页 `TodoInbox` 就是「我现在要做什么」。P3 加「你不在的这几天」一行：「上次来之后：老王回血到 100，你的申诉维持原判，新约了 2 局。」基于上次访问时间（localStorage）。 | P0 / P3 |
| 3 | 让宽恕看得见 | `MyScoreStrip`：「周一回血 +15 → 预计 97 分 · 还有 2 天」，每分钟刷新一次（不再每秒）。<br>回到 100 时庆祝一次：「满血复活 🎉 你回到 100 分了」（reduced-motion 下不播动画）。<br>判决卡下方固定写：「每周一回血 +15，预计 N 天后回到 X 分。」 | P0 |
| 4 | 草稿保护 | 说明、立案、发起约局、点名都存本机草稿：`localStorage['edg.draft.<kind>.<id>']`。<br>有改动时离开页面或关闭抽屉，弹出确认「草稿已保存在这台设备上，下次回来接着写」，按钮「继续写 / 先离开」。<br>Modal 的 onCloseRef 不变式保留，确认用 Modal 内的原地确认实现，不用 window.confirm。 | P0 |
| 5 | 申诉要写理由，并二次确认 | `AppealSheet`，至少 10 个字。 | P0 |
| 6 | 统一的「确认 + 撤回」 | 新组件 `ConfirmInline`，抽自 `DiscordLinkCard` / `AdminScoreForm` 的写法，焦点落点不变。<br>撤销按钮显示倒计时「撤销 · 还剩 12:34」。<br>立案后 3 分钟内可「撤回」（私信缓冲期内，调用 withdraw）。<br>RSVP 用 toast 撤回。 | P0–P2 |
| 7 | 写清「开局前说不来不扣分」 | RSVP 区固定一句「开局前改成「不来」不扣分。」<br>「你答应了」卡上加一键「改成不来」，不用确认，提供撤回。 | P0 |
| 8 | 隐私对齐 | 段位和 blurb 只在本人的 `MyScoreStrip`、`/me`、自己的选手页显示，公开榜单只显示分数。<br>判决前访客看不到指控：P0 前端先不渲染，P2 由后端 `redactRecord` 真正隐藏。<br>文案：「这起案件在等当事人说明，判决后再公开。」 | P0 / P2 |
| 9 | 时间同时写绝对和相对，标时区 | `formatWhen` 扩展为「周五 10/30 22:00（UTC+8）· 还有 2 天」。<br>截止时间同时给绝对和相对。<br>删掉 RulesPanel 里写死的「本地时区」。 | P1 |
| 10 | 页面保持新鲜，出错不崩 | `useResource` 精确失效；页面回到前台时刷新；首页登录后每 60 秒轻量刷新待办。<br>局部报错「这块没加载出来 [重试]」，保留旧数据。<br>标签页标题显示待办数。 | P0–P1 |
| 11 | 新访客欢迎卡；首次登录讲清后果 | `WelcomeCard`；`OnboardingDialog` 补后果说明（见 §4.4）。 | P0 |
| 12 | 分数账本 | 选手页的 `ScoreLedger`，每一笔都有原因和链接。 | P2（需后端） |
| 13 | 统一用词 + 30 秒指南 | `/rules` 顶部放「30 秒看懂」4 句话，加一个用词表：<br>「指控」= 立案人写的事；「说明」= 当事人的回应；「撤案」= 判决前立案人收回；「撤销」= 判决后 15 分钟内收回；「AI 裁判」只指 AI，立案的人叫「立案人」。 | P1 |
| 14 | 写说明的快捷片段 | 片段 chip：网络断了 / 临时有事 / 提前说过了 / 迟到但到了，只插入文字。 | P1 |
| 15 | 可读性与无障碍 | 见 §6。 | P0 |
| 16 | PWA 基础 | 同源 `manifest.webmanifest` + 图标，可以加到主屏；不做 service worker 缓存，避免旧 SPA 和 API 版本错配。 | P3 |
| 17 | 连胜 / 请假 / 延期 | **不做**：需要先定公平规则（分析 §9 Q7）。 | — |

**语气原则在各场景的应用**

| 场景 | 语气 | 示例 |
|---|---|---|
| 约局邀请、组局成功、空状态 | 玩梗、热情 | 「约好了！」「第一个开黑的永远是英雄」「没有待办，清清爽爽 ✨」 |
| 改期、取消 | 中性、交代影响 | 「改了之后，已回复的 4 个人要重新确认」 |
| 待说明 | 平实，给出路 | 「⚑ 待你说明 · 还剩 5 小时」。不用「被告」，用「你」 |
| 判决前（公开视图） | 不暗示有罪 | 「在等当事人说明」，分数写「待定」，不写 0 |
| 判决后扣分 | 数字照实写，紧跟出路 | 「−8。每周一回血 +15，预计 1 周后回到 90。觉得不公平？可以申诉」 |
| 低分 / 段位 | 只给本人看，用建议的口吻 | 本人看到「需要盯一下 · 组局前先确认一遍」，别人看不到 |
| 本周鸽王 | 有门槛、有出处 | 「因为周三王者五排放鸽子」，可以点开 |
| 报错 | 道歉 + 能做什么 | 「这块没加载出来，你的操作没丢。[重试]」 |
| 庆祝 | 克制，一次性 | 「满血复活 🎉」只出现一次 |

---

## 6. 视觉方向

**保留**
- 深色电竞转播风。
- 4 级表面（`--bg / --bg-elevated / --panel / --panel-2`）、圆角、动效、clamp 字号骨架。
- `ScoreGauge` 环形、Rajdhani 数字字体（只用于数字）。
- pointer:coarse 触控策略、reduced-motion 兜底。

**调整**

1. **层叠顺序（H8）**
   - `main.tsx` 先导入 `theme.css`，再导入 App。
   - `theme.css` 顶部声明 `@layer reset, tokens, base, components, utilities;`，组件 CSS 包进 `@layer components`。
   - 修复后弹窗阴影、`.dlink__bind` 的蓝色、`.pd__revoke-btn` 的红色、胶囊圆角都会恢复。

2. **焦点（H9）**
   - 改为 `:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }`。
   - 不再改写 border-radius，`.btn--gold` 的 box-shadow 也不再覆盖焦点。
   - `--focus: #8ab4ff`，在三级表面上对比度 7.8–9.3:1。
   - `@media (forced-colors: active)` 下 outline 用 `Highlight`。

3. **对比度（H10）**

   | token | 旧值 | 新值 | 在 bg / panel / panel-2 上的对比度 |
   |---|---|---|---|
   | `--faint` | #5c6675（3.33 / 3.00 / 2.80） | **#848fa0** | 5.91 / 5.33 / 4.98 |
   | `--border-input`（新增） | 约 1.23:1 | **#66738a** | 4.04 / 3.64 / 3.40（满足非文字 3:1） |

   - 「未回应」「隐私说明」改用 `--muted`。
   - 红色文字用 `--danger-text: #ff6b6f`（≥5.89:1）；`#e5484d` 只用于填充和边框。

4. **两层 token（M24）**
   - 原始层：`--gold-400`、`--red-500` 等。
   - 语义层，每种颜色只表达一个意思：

   | 语义 token | 值 | 只用于 |
   |---|---|---|
   | `--accent`（金） | #f5c542 | 主行动按钮、当前导航项、最高段位环 |
   | `--attn`（橙） | #ff8a3d | 「需要你处理」、截止 <24h、dm_ok=0 |
   | `--danger` | #e5484d / #ff6b6f | 扣分、破坏性操作 |
   | `--ok` | #3ddc84 | 加分、「来」、回血 |
   | `--info` | #4aa3ff | Discord、链接、AI 来源 |
   | `--neutral` | --muted | 待定、未回应、已取消 |

   - 时间不再上色。
   - 金和橙之间对比只有 1.45:1，所以每处颜色都同时带图标和文字，不单靠颜色区分。
   - 红色卡片上的段位环问题随红黑榜删除一并消失。
   - 段位色只出现在本人视图，并且总带段位名。网页在 CSS 映射层把 55+ 档映射为 `#c98a2b`，与金色对比约 1.6:1，同时加段位图标；`shared/scoring.ts` 的 hex 不动，bot 不受影响。

5. **字体与字号（M25）**
   - 中文一律用系统字体栈；Rajdhani 只用于数字和英文标识（`--font-num`）。
   - P3 起 Rajdhani 自托管 woff2（只含拉丁和数字子集），同时在 CSP 里去掉 `fonts.googleapis.com` / `fonts.gstatic.com`。
   - 字号收为 7 档：12 / 13 / 15 / 17 / 20 / 24 / 32px，数字 hero 48px。
   - 中文最小 12px（只用于时间戳等次要信息），正文 15–16px，输入框 ≥16px。

6. **密度**
   - 手机列表行 56px，卡片间距 12px，触控目标在 pointer:coarse 下 ≥44px（补上 `.wr__close`、`.aai__tab` 等遗漏项）。
   - 榜单行在手机上保留分数数字（H6）：`名次 · 头像 · 名字 · 本周变化 · 分数`。62px 的环只在桌面显示，删除每行的 drop-shadow 滤镜。

7. **图标**
   - 建 `src/components/icons/` 同源 SVG 集，约 16 个：日历、对勾、时钟、旗、天平、铃、链接、分享、人群、改期、关闭、撤回、盾、Discord、加号、箭头。
   - 语义位置的 emoji 全部换成 SVG，加 `aria-hidden` 并配文字。
   - emoji 只留在玩梗文案里（🎉 ✨）。
   - 关闭按钮从 ✕ 字符换成 SVG，加 `aria-label="关闭"`。

8. **深色 / 浅色**
   - P0–P2 只做深色，但全部组件只引用语义 token。
   - P3 加浅色：`prefers-color-scheme` + `/me` 里的手动切换，`<meta name="color-scheme" content="dark light">`。

9. **弹层**
   - Modal 加 `variant="sheet"`：手机底部抽屉，顶栏 sticky 放标题和关闭（H2）。
   - Modal 改为栈管理：只有最上层监听 Esc 和 Tab（M10）。
   - 抽屉打开时 `pushState({sheet:true})`，Back 键关的是抽屉，不是离开网站。
   - 焦点陷阱、#root inert 引用计数、关闭后焦点还原、`onCloseRef` 全部保留（`modal-focus.test.tsx`）。
   - 长内容一律改成页面，弹层只留给短确认和选择器。

---

## 7. 高优先级问题 H1–H16 的处理

| # | 处理 |
|---|---|
| H1 | 手写路由 + pushState / popstate，每个视图都有 URL；旧 `?case` / `?session` 用 replaceState 翻译成新路径（P1）。 |
| H2 | 长内容（选手、案件、约局、点名、立案、发起）全部改成页面；剩下的弹层用底部抽屉，关闭按钮 sticky，Back 键可关（P1）。 |
| H3 | 用 sessionStorage 记住登录前要去的页面，回来后先确认再写入；未登录处显示「登录后报名」「登录后就能写说明」。后端白名单不动（P0 文案，P1 回跳）。 |
| H4 | `TodoInbox` 覆盖八类待办：邀请、改期、答应了、说明、点名、升级、申诉、设置（P0 拼装，P2 改用 `/api/me/todo`）。 |
| H5 | 删掉 `RedBlackBoard`，换成有门槛、有出处、只算本周已判决的 `WeekHighlights`；没人达标就显示「全员守约 🎉」；并列不按名字排（P0）。 |
| H6 | 榜单行在任何宽度下都显示分数数字，仪表环只在桌面显示（P0）。 |
| H7 | 首页改为工作台：待办 → 我的分数 → 榜单前 5，第一屏内可见；动态流移到 `/board`（P0）。 |
| H8 | 先导入 theme.css 再导入 App，并启用 `@layer` 分层（P0）。 |
| H9 | 焦点环改为 outline，支持 forced-colors，金色按钮的阴影和焦点环分开（P0）。 |
| H10 | `--faint` 提到 #848fa0，新增 `--border-input` #66738a，关键信息改用 `--muted`（P0）。 |
| H11 | 控制台加「＋再叫几个人」+ ★ `POST /api/sessions/:id/invite` + 可邀请名单（P1）。 |
| H12 | 控制台加「改时间」抽屉，调用已有的 PATCH，并写明「N 个人需要重新确认」。P0 先在现有 `SessionDetailDialog` 里加入口，P1 迁到页面。 |
| H13 | 四类表单都存本机草稿，离开时确认（P0）。 |
| H14 | `AppealSheet` 必须填理由并二次确认，接口已支持 reason（P0）。 |
| H15 | `/admin` 复核队列（P1 用 `status=appealed` 加改判）+ 后端「维持原判」，改判保留原判词（P2）。 |
| H16 | `CaseFilePage` 提交后不关页，逐人显示 AI 归类，可改案由（`reclassifyCase`）、3 分钟内可撤回（前端 P1）。后端并行归类为可选项（P2）。 |

---

## 8. 后端改动清单

迁移命名：
- D1：`migrations/004_v5_workbench.sql`，同步更新 `schema.sql`。
- PG：`server/migrations/0007_v5_workbench.sql`，用 `ADD COLUMN IF NOT EXISTS`。
- 不改现有触发器的判断条件。导入期间的 `edg.importing` 跳过逻辑不受影响。

### 必需（★，邀请整合依赖）

| # | 方法 / 路径 | 权限 | 请求 / 返回 | 迁移影响 | 期 |
|---|---|---|---|---|---|
| 1 | `POST /api/sessions/:id/invite` | 登录 + 组织者；局为 open 且未开局；只读模式下返回 503 | 请求 `{user_ids: string[]}`（≤20，`normalizeInvites` 复用）。<br>返回 `{session: SessionDetail, added: string[], already: string[]}` | 无新列。<br>`INSERT … ON CONFLICT(session_id,user_id) DO NOTHING`，D1 和 PG 都支持。<br>PG 现有 `session_players_outbox` 会在 INSERT invited 时自动发私信，额度由 dispatcher 管。<br>逻辑写在 `worker/sessions.ts`，bot 以后也能用。 | P1 |
| 2 | `GET /api/users/invitable` | 登录 | `{users: [{id, username, avatar_url, is_participant, played_with_me: number, last_played_at: string\|null}]}`。<br>**不含任何 `discord_*` 字段**。 | 无（按 session_players 聚合） | P1 |
| 3 | `GET /api/me/invites` 扩展；`SessionItem` 扩展 | 同原接口 | 邀请项加 `invite_reason: 'new'\|'moved'`、`prev_rsvp: Rsvp\|null`、`prev_starts_at: string\|null`。<br>`SessionItem` 加 `going_preview: UserRef[]`（≤5，一次批量查询）。 | `session_players ADD COLUMN prev_rsvp TEXT`；`game_sessions ADD COLUMN prev_starts_at TEXT`。<br>`updateSession` 改期时把 `prev_rsvp` 设为 `CASE WHEN rsvp='invited' THEN prev_rsvp ELSE rsvp END`，同时写 `prev_starts_at`。<br>`setRsvp` 时把 `prev_rsvp` 清空。<br>同一条 UPDATE 里 rsvp 有变化，PG 触发器行为不变。 | P1 |
| 4 | `POST /api/sessions/:id/cancel` 扩展 | 组织者（不变） | 可选 JSON `{reason?: string ≤80}`；`SessionItem` 加 `cancel_reason` | `game_sessions ADD COLUMN cancel_reason TEXT`。<br>bot `render.ts` 的取消私信追加「理由：…」。<br>带 JSON body 时走预检，CORS 头只用 Content-Type，不变。 | P1 |
| 5 | `GET /api/me/discord` 扩展 + `POST /api/me/discord/notify` | 本人；**仅 Node 端**（`server/src/link-routes.ts`，discord_links 只在 PG 里有） | GET 加 `notify_dm: boolean, dm_ok: boolean`。<br>POST `{on: boolean}` → 写 `notify_dm`，同时重置 `dm_ok=1`，与 bot `/notify` 一致。 | 无新列。<br>前端在 404 时静默隐藏（沿用 `getDiscordLink` 的写法）。 | P1 |

### 可选

| # | 方法 / 路径 | 权限 | 返回 / 说明 | 迁移影响 | 期 |
|---|---|---|---|---|---|
| 6 | `GET /api/me/todo` | 登录 | `{items: TodoItem[], counts:{statements, invites, rollcalls, escalations, appeals}}`。<br>`TodoItem` = `{kind, id, due_at, session?, record?, reason?}`。<br>`worker/todo.ts` 与 bot `/todo` 共用。前端遇到 404 时退回到拼装模式。 | 无 | P2 |
| 7 | `POST /api/records/:id/uphold` | 管理员；状态必须是 appealed | 状态变为 decided，判词不变。<br>返回 `{record}`，`RecordItem` 加 `appeal_outcome: 'upheld'\|'overridden'\|null`、`reviewed_at`。 | `records ADD COLUMN appeal_outcome TEXT, reviewed_at TEXT, reviewed_by TEXT, prior_verdict TEXT(JSON)`；改判时把原判词写进 `prior_verdict`。<br>PG 新增 outbox 类型 `dm.case.reviewed`，私信申诉人（新增一个触发器函数）。 | P2 |
| 8 | `GET /api/admin/users` | 管理员 | 全部账号（含不在榜的），`{id, username, is_participant, is_judge, score, last_seen_at}` | 无 | P2 |
| 9 | `GET /api/records` 新增筛选 | 按现有规则 | `mine=filed`（立案人是我）、`escalation=pending`、`before=<id>` 游标分页 | 无 | P2 |
| 10 | `GET /api/leaderboard` 扩展 | 公开 | 加 `record_count`、`week_delta`、`week_penalty`（本周已判决），用来替代前端从 50 条记录推算的结果 | 无 | P2 |
| 11 | 分数账本 | 公开（原因按脱敏规则处理） | `history` 每个点加 `kind: 'case'\|'heal'\|'admin'`、`record_id`、`reason`。<br>`POST /api/admin/users/:id` 改分时接受 `reason`。 | `score_events` 已有 reason，只需在组装时不再丢掉；改分理由写入同一列 | P2 |
| 12 | `redactRecord` 判决前隐藏 `claim` / `claim_summary` | 当事人、立案人、裁判、管理员以外的人 | 字段置空，`redacted:true` | 无。<br>需同步 `tests/unit/record-privacy.test.ts`；CONTRACT §4.6 对齐 | P2 |
| 13 | `GET /api/config` 加 `boardTzOffsetMin` | 公开 | 来自 `RESET_TZ_OFFSET` | 无（只改 config 结构，测试只锁 URL） | P1 |
| 14 | `GET /api/sessions/:id/reach` | 组织者；**仅 Node 端** | `{invited: 6, reachable: 4}`，只给总数 | 无 | P2 |
| 15 | 往期战报 `GET /api/reports?limit=` / `GET /api/report?week=` | 公开 | 按周列出 | 无 | P3 |
| 16 | AI 试跑使用草稿配置 | 管理员 | `testAiConfig` 接收未保存的字段（API Key 仍不经过前端） | 无 | P3 |
| 17 | 立案时 AI 并行归类 | 裁判 | `case-filing.ts` 并发上限 4，最坏等待从约 160 秒降到约 40 秒 | 无 | P2 |
| 18 | bot 侧小改 | — | RSVP 标签改为「待定」；`handleTodo` 改用 `listTodo`；`render.ts` 改发新路径；改期私信补「你之前说「来」」 | 无 | P2 |

**明确不动的**：`safeNextPath`、cookie、CORS allowHeaders、额度常量（10 / 3 / 20 / 5 / 10）、团灭级升级必须人工确认、说明只能交一次、`/api/records/:id/dispute` 旧别名。

---

## 9. 交付分期

### P0 · 地基 + 工作台首页（不引入路由）约 7 人日，可单独上线

**内容**
- `@layer` 和导入顺序、焦点环、对比度 token、语义 token 第一版、SVG 图标集（H8 / H9 / H10）。
- `HomePage` 重排：`TodoInbox`（拼装模式）、`MyScoreStrip`（回血预告）、`BoardMini`（显示分数，同分同名次）、`WeekHighlights`（替代 `RedBlackBoard`）、`WelcomeCard`、`ReportTeaser`。动态流收成 5 条，下面放「全部动态」展开（H4 / H5 / H6 / H7）。
- 在现有 `SessionDetailDialog` 里加：改时间（PATCH）、取消前确认、RSVP toast、「开局前说不来不扣分」（H12、M15、M20）。
- 草稿保护（H13）、申诉理由（H14）、未登录「登录后报名」文案。
- `index.html` 的 description、标签页标题待办数、局部报错（M11）。

**对测试的影响**
- 首屏必需请求不变，新请求只在登录后发，失败静默；`p8-app` 不用改。
- `/约局/` heading 保留（「接下来的约局」），`/上周战报/` 和 `/往期战报/` 保留（`ReportTeaser` 复用 `WeeklyReportCard` 的标题规则）。
- `session-rsvp-moved`：`SessionsPanel` 和 `SessionDetailDialog` 里仍然各只有一个「来」。改时间按钮叫「改时间」，不冲突。
- 新增测试：`TodoInbox` 排序、`WeekHighlights` 门槛（满分并列时不出鸽王）、`MyScoreStrip` 回血计算、草稿恢复、申诉理由校验。

### P1 · 路由 + 邀请整合 约 10 人日前端 + 3 人日后端；先上后端，前端在 404 时降级

**内容**
- `router.ts`、`AppShell` / `TopBar` / `BottomNav`、旧深链翻译、`NotFound`、lazy 拆包（H1 / M29）。
- 页面：`/sessions`（四个 tab）、`/sessions/:id` + `OrganizerConsole`、`/sessions/new`、`/sessions/:id/rollcall`、`/players/:id`、`/cases/:id`、`/cases/new` + `FilingResult`、`/me`（`NotifySetup`）、`/rules`（30 秒指南 + 用词表）、`/report`、`/admin`（复核队列 + 改判 + AI 面板宿主）。
- Modal 栈和底部抽屉（H2 / M10）、登录回跳（H3）、`ShareSheet` 与 .ics、看板时区显示。
- 后端 ★1–5 和 #13；D1 与 PG 迁移 `004` / `0007`。

**对测试的影响（有意打破的部分及替代）**

| 测试 | 变化 | 替代 |
|---|---|---|
| `deep-link.test.tsx` | `?case=7&utm=dc` 仍然得到 heading「选手」（CasePage 的 h1 是被记录人名字）、`#case-7` 带 `vc--focus`、`location.search` 为 `?utm=dc`。新增断言 `pathname === '/cases/7'`。<br>`case-6` 那条断言改成「页面上其他 VerdictCard 都没有 `vc--focus`」，因为案件页可能不渲染 case-6。<br>`?session=3` 保持 search 为 `''`，新增 pathname 断言。 | 改测试 |
| `p8-app.test.tsx`「opens once」 | 改分不在案件页，原断言（`/api/records/7` 只请求一次）与案件页自身刷新冲突。 | 改写为：深链只翻译一次；回到 `/` 再刷新不会重新打开 `/cases/7`；不发非 GET 请求 |
| `p8-app.test.tsx`「waits for first-run dialog」 | 行为不变，heading 仍是「选手」 | 不改 |
| `session-rsvp-moved.test.tsx` | `SessionDetailDialog` 不再是弹层。**有意改变组件签名**：新组件为 `SessionView(sessionId, me, onChanged)`。 | 测试改为渲染 `SessionView`，断言不变（只有一个「来」、409 时 role=alert、body 为 `{rsvp:'going', starts_at}`）；`SessionsPanel` 签名保留 |
| `player-judge.test.tsx` | `PlayerDetail` 签名不变；如果测试里查询了 `role=dialog`，改成查询页面区域 | 视情况改 |
| `discord-link` / `onboarding-roles` | 文案和 radiogroup 不变 | 不改 |
| 新增 | 路由单测（白名单、非法 id、popstate）、resume 单测（只用一次、过期、不自动写）、`/invite` 的 worker 测试（D1）+ pg 测试（触发器发私信、额度） | 新增 |

- 同步更新 CONTRACT.md 的 Frontend expectations：深链从「打开弹层」改为「翻译成路由」，其余规则原文保留。

### P2 · 裁判 / 管理员工作台 + 分数解释 约 5 人日后端 + 4 人日前端

**内容**
- 后端 #6–12、14、17、18。
- 前端：`/api/me/todo` 接入，改期卡显示 prev；复核队列加「维持原判」，复核结果通知到申诉人的待办；`ScoreLedger`；榜单用 `week_delta`；判决前隐藏指控；`/admin?tab=users` 管理全部账号；私信送达状态与开关 UI；「6 人里 4 人能收到私信」；「再约一次」。
- bot 的 /todo 与网页共用 `listTodo`；bot 链接改发新路径。

**对测试的影响**
- `record-privacy.test.ts` 和 `verdict-privacy.test.tsx` 新增「判决前访客看不到 claim」的用例。原有「写了说明」「按缺席裁决」「该选手已申诉」的断言不变。

### P3 · 分享与锦上添花 约 5 人日

**内容**
- 往期战报（`/report?week=`）、「你不在的这几天」、浅色模式、Rajdhani 自托管并收紧 CSP、PWA manifest、AI 试跑使用草稿配置、给预览环境配 staging API（M30）。
- 可选：「催一下」，只发给未回应的人，每局每人 12 小时一次，走 outbox 并计入额度。

**对测试的影响**
- `tests/unit/pages-headers.test.ts`：CSP 逐字断言里去掉两个 Google Fonts 源（有意修改）。

**合计**：约 38 人日。P0 单独上线就能解决 H4–H10、H12–H14，覆盖 12 / 16 个高优先级问题里的大部分。

---

## 10. 风险与取舍

**这个方向放弃了什么**
1. **「看热闹」的首屏。** 红黑榜大卡、长动态流不再是门面，访客第一眼看不到「谁是鸽王」，围观乐趣和传播性都下降。梗只在有出处时出现在一行看点里，战报降为预告卡。
2. **公开段位。** 为了「段位只给本人看」，别人的「资深鸽王」称号和「建议收押金」建议都看不到了。这是群里玩笑的一部分，可能会有人觉得变无聊。
3. **一页看完。** 大屏「挂着看」整个记分板的用法被拆成了 `/board`、`/report`、`/sessions` 几页。
4. **测试和契约的稳定性。** P1 有意修改了 `SessionDetailDialog` 的签名、两条深链断言、CONTRACT 的深链描述。P3 修改了 CSP 逐字测试。改动集中，但范围不小。

**风险**
5. **P0 拼装待办不完全准确。** 待确认升级只看最近 50 条记录，太早立的案可能漏掉；改期在 P1 之前和新邀请长得一样。要到 P2 的 `/api/me/todo` 才完全准确。
6. **登录后的首屏请求变多**（加 `scope=mine`、可能还有 appeals），在 Pages 加 capi 的跨站延迟下，首屏会多出一个 RTT。缓解：并发请求，先渲染骨架，待办卡逐张出现。
7. **路由带来新的维护面**：NotFound、Back 键、抽屉和 history 的交互、旧链接翻译。手写路由意味着这些边界情况要自己测。
8. **依赖登录才有价值。** 工作台对未登录和不在榜的人价值有限，他们只看到欢迎卡和公开榜。这也是为什么分享链接 + 登录回跳在 P1 是必需项。
9. **网页先于 bot。** 在 bot 还发「可能」、/todo 还不含点名的这段时间（P0–P1），两边用词和待办内容会短暂不一致。
10. **不做的事**：
    - 每个路由的 OG 预览需要 SSR 或 Pages Function，与「/api、/auth 以外不加 Functions」的现状冲突。
    - 连胜、请假、延期等公平规则没定。
    - service worker 缓存可能导致旧 SPA 和新 API 错配。