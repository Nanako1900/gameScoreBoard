# spec.md 的草案 完整性审查：缺口与错误清单

> 逐条对照 `analysis.md`（H1–H16、M1–M30、低优先级、邀请整合 A–E、人性化 1–17、§6 约束、§9 待决问题），并回到代码核对了可疑的技术说法。每条都写了「问题 → 证据 → spec 要怎么改」。按严重度排序：先列事实错误和会让测试变红的地方，再列覆盖缺口，最后列内部矛盾和工作量。

---

## 一、核对代码后发现的事实错误（必须改）

1. **「撤销」窗口写错了起算点**
   - spec 原文：用词表「撤销 = 判决后 15 分钟内收回」；§3.8 CaseActionBar「立案人 · 判决后：[撤销 · 还剩 12:34]（15 分钟内）」。
   - 代码：`worker/cases.ts:423` 是 `Date.now() - created_at <= REVOKE_WINDOW_MS`，**从立案时间算起**，并且只对已判决的记录生效（`:418-420` 判决前一律要求改用撤案）。AI 案件有 12 小时说明窗口（`shared/scoring.ts:18`），所以立案人实际上几乎撤销不了；只有点名加分这类立案即判决的记录才用得上。
   - 改法：用词表改成「撤销：立案后 15 分钟内、且已判决时，立案人可收回；管理员任何时候都能撤销」。CaseActionBar 的倒计时从 `created_at` 算；窗口过了就隐藏按钮，不要显示负数。§3.11 的「我立的案 · 撤销窗口」照此改。

2. **「3 分钟内撤回」被写成了撤案的期限**
   - spec 原文：§3.3 `TodoCard kind=withdraw`（立案后 3 分钟内）；§3.10「[撤回这 3 起（还剩 2:41）]」；§5 #6「立案后 3 分钟内可撤回」。
   - 代码：`withdrawCase`（`worker/cases.ts:364-384`）只要求状态是 `awaiting_statement`，**没有时间限制**。3 分钟只是立案私信的延迟发送期（`server/migrations/0004_dm.sql:100-104`）。过了 3 分钟撤案，dispatcher 会改写已经发出的私信（`server/src/outbox/dispatcher.ts:475-487`），不会再发新私信。D1 Worker 上根本没有私信。另外「撤回」是第 4 个说法，和 M16「统一用词」相冲突。
   - 改法：只保留「撤案」这一个词。文案改成「3 分钟内撤案，对方不会收到私信；之后在对方写说明前仍可撤案」。倒计时结束后按钮继续可用，只是换掉提示语。3 分钟要在 `shared/` 里定义常量（例如 `FILED_DM_GRACE_MS`），并注明要和 SQL 的 `interval '3 minutes'` 保持一致。

3. **`REVOKE_WINDOW_MS` 和 `APPEAL_MAX` 不在 `shared/`，违反「常量只从 shared 读」**
   - 代码：`REVOKE_WINDOW_MS` 在 `worker/cases.ts:95` 和 `src/components/PlayerDetail.tsx:44` 各写了一份。`APPEAL_MAX = 500` 只在 `server/src/discord/case-actions.ts:40`。后端申诉理由实际截到的是 `MAX_NARRATIVE_LEN = 1000`（`worker/cases.ts:398`），所以网页和 bot 的上限本来就不一样。
   - 改法：P0-5 增加一步，把两个常量都移到 `shared/scoring.ts`，前后端和 bot 统一引用。同时明确申诉理由上限取 500，还是让后端也截到 500。

4. **`isFilingJudge` 前端拿不到；CaseActionBar 的权限写宽了**
   - 代码：`isFilingJudge` 是 `worker/case-filing.ts` 的私有函数，`src/` 和 `shared/` 里都没有。它要求 `is_admin || (is_judge && reporter 是自己)`。点名结算产生的案件，立案人是不一定有裁判身份的组织者（见同文件的注释）。
   - 改法：§3.3 用到的前端过滤要先把它搬进 `shared/`。§3.8 的「立案人或管理员 · 有升级建议」改为「立案的裁判或管理员」，和 §3.3 保持一致。

5. **ScoreGauge 原样复用会把段位泄露给所有人**
   - 代码：`src/components/ScoreGauge.tsx:23,34,36` 的圆环颜色取自 `tierFor(score).color`，`aria-label` 是「… 分，段位 ${tier.name}」。spec 在公开选手页（§3.8）和桌面榜单（§6.4 的 62px 圆环）都把它标成 [复用]。
   - 改法：ScoreGauge 增加可选 prop（例如 `tone="neutral"`）。非本人视图一律用中性色，`aria-label` 里不念段位。在 §6.2 写明「公开处的 ScoreGauge 一律 neutral」。ScoreGauge 从「原样保留」改为「加可选 props」。

6. **规则页仍会公开段位表和「建议收押金」**
   - 代码：`RulesPanel.tsx:113-121` 列出全部 `TIERS`，包括 `blurb`；`/api/config` 也公开返回 `tiers: TIERS`（`worker/routes.ts:233`）。段位完全由公开的分数决定（`tierFor`），所以「段位只给本人看」只能是**展示层**的约定，算不上隐私保护。
   - 改法：§3.6 的 `/board/rules` 写明段位表只显示「名称 + 区间 + selfHint」，不再显示 `blurb`。§5 #8 和 §10 第 3 条如实写出「这是语气上的约定，不是保密，任何人都能从分数反推出段位」，免得给 §11 第 4 条拍板的人造成误解。

7. **B1-1「有意修改 record-privacy 两个测试」是错的，那里没有可改的断言**
   - 代码：`tests/worker/record-privacy.test.ts:60-81` 和 `tests/unit/record-privacy.test.ts` 用的都是 `status: 'appealed'`（判决后）的记录，断言 `claim` 公开。这正好符合 B1-1 之后「判决后公开」的规则，**不用改**。三个测试文件里都没有 `awaiting_statement` 或 `judging` 状态的用例。
   - 改法：§8 B1-1、§9 P1 表和 §10 第 11 条都改成「**新增**判决前（awaiting_statement / judging）隐藏 claim 的用例；现有用例原样通过」。另外写明 redaction 必须保留 `statement_at`，这样脱敏后照样显示「写了说明」（§6 约束，`record-privacy.test.ts:81` 已锁定）。

8. **「bot 测试里『可能』改『待定』」所指的测试并不存在**
   - 代码：在 `tests/` 里 grep「可能」没有结果。只有 `server/src/discord/sessions.ts:36,120` 两处源码。
   - 改法：§4.2、B2-4、P2-4、§10 第 11 条去掉「改 tests/pg 里断言『可能』的用例」，换成「**新增**断言：按钮和卡片字段都用 `RSVP_LABEL.maybe`」。

9. **H16「进度 1/3」做不到**
   - 代码：`POST /api/records` 在一个请求里串行处理所有人（`worker/case-filing.ts:288-306`），最后一次性返回 `{records, failed}`，中途没有进度可读。
   - 改法：§3.10 删掉「进度 1/3」，改成不确定进度的提示（「AI 正在归类 3 个人，最多约 1 分钟」）。如果确实要逐人进度，就得让前端拆成每人一个请求，这会改变「共用描述只校验一次」的语义（同文件 `:276-283` 的注释），需要单独评估。§3.10「最多 8 人」改为读取 `config.maxBatchSubjects`，不要写死。

10. **P3-1 的 `scope=past&limit=20` 会被后端忽略**
    - 代码：`GET /api/sessions`（`worker/routes.ts:284-292`）不读取 `limit`，固定返回 50 条；`getSessions` 也没有 limit 参数。
    - 改法：要么在 B2-3 ④ 里顺带让路由接受 `limit`（标为后端改动），要么前端直接用 50 条，删掉 `&limit=20`。

11. **P0-6「`canManage` 包含管理员」已经是现状**
    - 代码：`SessionDetailDialog.tsx:79` 已经是 `isOrganizer || me?.is_admin === true`。
    - 改法：删掉这一项，或者改成「保持 canManage 现有的判断」。

12. **「你现在还能开 N 个局」漏了每日上限**
    - 代码：`worker/sessions.ts:262-263` 有两个上限：`MAX_OPEN_SESSIONS = 5`（只数还没开局的）和 `MAX_SESSIONS_PER_DAY = 10`。
    - 改法：两个常量一起移到 `shared/`。提示文案按两者里更紧的那个计算，或者只在快到上限时才提示。

13. **改期重置的 CASE 表达式是多余的，spec 的推理依据也不对**
    - 代码：重置语句是 `WHERE … rsvp IN ('going','maybe','out')`（`worker/sessions.ts:463-467`），`invited` 的行本来就不会被更新，所以 `CASE WHEN rsvp='invited'` 永远不会命中。spec 想要的「连续改期仍显示当时回答的时间」是靠 WHERE 条件实现的。
    - 改法：B2-3 ① 直接写 `prev_rsvp = rsvp, prev_starts_at = <旧值>`，并说明 WHERE 条件已经保证不会覆盖。这样能少一个看起来有用、实际上不会生效的分支。

14. **「周一 0 点回血」说得太死**
    - 代码：回血是惰性执行的：Monday 0 点之后，第一次 `GET /api/config` 或者 cron 触发时才执行（`worker/routes.ts:210-229`、`worker/db.ts:410`）。
    - 改法：保留「周一 0 点回血」这个说法，但 `MyScoreLine` 的「还有 X 天」以 `config.nextResetAt` 为准。过了这个时间点就重新拉一次 config（P0-3 只说了「visibilitychange 时不请求 config」，结果是页面开着跨过周一时倒计时会变成负数）。另外，「不请求 config 是因为会触发回血」这个理由不成立：这些任务都是幂等的，真正的理由只是没必要多发请求。

---

## 二、会让现有测试变红、或改了锁定行为却没写出来的地方

15. **改分后必须重新请求 `records?limit=50`，这一点被测试锁定了**
    - 证据：`tests/dom/p8-app.test.tsx:128` 断言管理员改分后 `/api/records?limit=50` 至少被请求 2 次。spec 的 `useResource` 按 key 精确失效（§5 #10、P0-3），如果改分只让榜单和用户失效，这条测试就会失败。
    - 改法：在 P0-3 的测试影响里写明：管理员写操作（改分、设裁判、改判、撤销）之后，动态流的 key 也要失效。

16. **「已在收件箱的局，大厅卡片不给按钮」不能做成 SessionsPanel 的默认行为**
    - 证据：`session-rsvp-moved.test.tsx:84-89` 单独渲染 `SessionsPanel`，数据桩里的局是 `my_rsvp: 'invited'`，测试要能找到「来」按钮。如果 SessionsPanel 自己判断「这局在收件箱里」并隐藏按钮，这条用例就会变红。
    - 改法：§3.2 和 P3-1 写明由 App 传入可选 prop（例如 `handledElsewhere?: Set<number>`），不传时行为和现在一样。

17. **选中态的「✓」会改掉按钮的可访问名**
    - 证据：测试按 `{ name: '来' }` 精确匹配。如果 ✓ 是按钮里的文字，选中后可访问名就变成「来 ✓」。
    - 改法：§3.5 和 §6.4 写明 ✓ 用 `aria-hidden` 的 SVG 或伪元素，选中状态只通过 `aria-pressed` 表达。

18. **DiscordLinkCard 和 OnboardingDialog 都不能增加请求**
    - 证据：`discord-link.test.tsx:82,194` 断言 `calls` 长度为 1。
    - 改法：§3.9 写明 `NotifySetup` 的私信状态复用 `GET /api/me/discord` 的扩展字段（B2-5 已经这样设计），不能往 DiscordLinkCard 里加新请求；「先看看」选项也不能触发额外请求。

19. **置顶案件卡不能复制一份**
    - 证据：`deep-link.test.tsx:100-103` 用 `getElementById('case-7')` 检查焦点和 `vc--focus`，`p8-app.test.tsx:146-156` 要求 `scrollIntoView({block:'center'})`。如果「置顶」是在顶部另渲染一张、列表里又保留一张，就会出现重复 id。
    - 改法：§2.3 和 §3.8 写明置顶是**移动**（在列表里跳过这一条），全页只有一个 `id="case-N"`。保留 `focusRecordId` 和 `block:'center'` 的行为。

20. **Modal 的 `page` 形态不能给 `#root` 加 inert，也不能困住焦点**
    - 证据：Modal 现在会 portal 出去，并把 `#root` 设成 inert。spec 让 PlayerDetail、SessionDetailDialog 通过 `<Modal variant="page">` 渲染成页面，而 BottomTabs 和 PageBar 都在 `#root` 里，如果照旧加 inert，页面就没法操作了。
    - 改法：§6.4 定义 `page` 形态：不 portal、不加 inert、不做焦点陷阱，打开时把焦点移到 h1/h2；`center`、`sheet`、`drawer` 保持现有语义。另外 Modal 栈和 inert 引用计数都是模块级状态，P0-2 要在 `tests/dom/setup.ts` 里和路由一起在 afterEach 重置。

21. **spec 没列出的测试锁定文案**（新设计会碰到，需要在 §10 第 11 条或各 PR 的测试影响里写明不改）
    - `判词只有当事人、立案人、裁判和管理员能看`（verdict-privacy:48）
    - `该选手已申诉`（:62）
    - `按缺席裁决`（:55，和 M17 的修改有关，只能在 withdrawn 时隐藏）
    - `周一 10:30 之后发布` 和 `往期战报`（p8-app:184-188）
    - `私信通知本人`（player-judge:138）
    - `够得上「团灭级放鸽」`
    - `裁判资格由管理员授予` 必须正好出现 2 次（onboarding-roles:42）。新增的「先看看」卡片不能再带这句。
    - `需要管理员重新授予`、`还没「确认」的修改不会保存`
    - 按钮名 `取消`、`确认`（discord-link:113、onboarding-roles:75）
    - 链接名 `绑定 Discord`
    - `操作冲突，请重试`、`请先登录` 以 `role=alert` 出现
    - 改法：§6 增加一张「锁定文案清单」，P0-6 的取消确认和 ConfirmInline 不能改 DiscordLinkCard 里「取消」「确认」的名字和焦点落点。

22. **用「说明」全面替换「陈述」，会和 bot 以及 bot 测试不一致**
    - 证据：`shared/scoring.ts:151` 的 `CASE_STATUS_LABEL.awaiting_statement = '待陈述'` 是共用的（RecordsFeed 在用）。bot 用的是「写陈述」「待写陈述（N）」「陈述快截止了」，这些都被 `tests/pg/bot-commands.test.ts:191,370`、`dm.test.ts`、`p8-edges.test.ts`、`session-cards.test.ts:540` 锁定；后端报错里也有「陈述阶段」。spec 的原则 4/5 说「用词和 Discord 一致」，用词表却写「网页不再用『陈述』」，§4.2 的对齐表里也没有这一行。
    - 改法：在 §11 加一条决定：要么 bot 一起改成「说明」（列出要改的 bot 文案和上面这些测试），要么网页保留「陈述」。改 `CASE_STATUS_LABEL` 会同时影响 bot，要么另做一份网页专用标签，要么写明是有意修改。

---

## 三、隐私方面的回退或遗漏

23. **首页的 WeeklyReportCard 仍会点名「本周鸽王」**
    - 证据：`WeeklyReportCard.tsx:107-109` 渲染 `stats.pigeon` 奖项（「🕊️ 本周鸽王」），叙事文本也可能直接写出名字。spec 默认「首页和分享预览里不点名任何鸽王，战报正文保持现状」，但首页放了 `WeeklyReportCard compact`，而且没说 compact 会隐藏 pigeon。
    - 改法：§3.1 和 §5 #1 写明 compact 只显示数字和叙事的第一句，不显示 Award。`/board/report` 的 pigeon 奖项是否保留，要并进 §11 第 2 条一起拍板（默认隐藏，和「网页上不点名任何鸽王」一致）。

24. **判决前公开「类型 + 区间 + 当事人」，本身就是指控**
    - 证据：B1-1 写的是「保留类型和待定区间」，§3.8 的 eyebrow「案件 #7 · 大迟到 · 待说明」，`VerdictCard.tsx:57` 的标题回退到 `def.label`，`/board/feed` 也会列出判决前的记录。访客照样能读到「老王 · 放鸽子 · −20~−10」。
    - 改法：在 §11 第 3 条里把这一点讲明白，给出两档选择：（a）只隐藏 claim（现在的草案），（b）判决前对外只显示「有一起记录在处理中」，连类型都不显示。推荐选哪一档、对 feed 和本周之星有什么影响，都要写出来。

25. **M18 只补了一半**
    - 证据：§3.10 写了「判决前，立案经过不会公开给其他人」，但没写判决后会公开。
    - 改法：补一句「判决后，立案经过、案由和分数变化会公开；你的说明始终只给上述几类人看」。

---

## 四、覆盖缺口（分析里有，spec 没有落到任何 PR）

26. **没有 M1–M30 的追踪表**
    - §7 只覆盖了 H1–H16。
    - 改法：仿照 §7 加一张 M 表，每行写「处理 / 期 / PR」，下面这些缺口才看得出来。

27. **M9 战报自相矛盾，完全没修**
    - 证据：`report.ts:118-127` 按 `records.created_at` 统计立案数，`:125-138` 的 star 和 pigeon 却按 `score_events.created_at` 统计，所以会出现「立案 0、鸽王 −3」。卡片标题是「上周战报」，奖项标签却写「本周之星 / 本周鸽王」（`WeeklyReportCard.tsx:107-109`）。spec 只在 §11 第 10 条留了口径决定，没有任何 PR 改它。
    - 改法：在 P3-6（或新增一个后端 PR）写明：统一口径（推荐全部按判决时间）；奖项标签改成「上周之星」；旧周报不重算。

28. **「本周之星」两种定义同名，会同时出现在首页**
    - 证据：WeekHighlights 的本周之星是「本周至少 2 次守约加分、没有扣分」，用前端拿到的 feed 推算；WeeklyReportCard 的「本周之星」是「上周净加分最多的人」，由 SQL 计算。
    - 改法：其中一个改名（例如战报里叫「上周之星」）。或者在 P4 之前，WeekHighlights 只在 feed 覆盖了整周数据时才显示（feed 最旧一条早于本周一），否则隐藏，不要在公开页面上根据截断的数据点名。

29. **M17（已撤案的案件仍显示「按缺席裁决」）没有分到 PR**
    - §3.10 提到了，但 P0 到 P4 都没有对应的 PR。
    - 改法：放进 P0-5，测试保持 `verdict-privacy:47,55,94` 的现有断言，并新增 withdrawn 状态的用例。

30. **M21 后半句「先去绑定会丢掉还没保存的选择」没处理**
    - 证据：`DiscordLinkCard.tsx:120-122` 绑定是顶层跳转，OnboardingDialog 里还没保存的身份选择会丢失。spec 只处理了「回来后别再弹一次」。
    - 改法：P4-3（或 P0-5 的草稿机制）把身份选择存进 `edg.draft.onboarding`，绑定回来后恢复；或者在点「绑定」之前先保存选择。

31. **M26 走势图（手机上 6px 字、只能靠悬停）没有 PR**
    - §3.8 写了「字号 ≥12px，点按显示原因」，但「原因」要靠 P4 的 B4-2 才有数据。
    - 改法：字号和点按交互放进 P0-4，原因标签随 P4-5 上线。

32. **M28 后半句「提示里还写着 wrangler」没处理**（`AdminAiPanel.tsx:157-158`）
    - 改法：在 P3 或 P5 里加一条，把提示改成和部署方式无关的说法。

33. **M8「改分不留理由」被有意放弃，但没有说明**
    - 分析 §7 把「history 和改分记录带上 reason」列为需要的接口；spec 选择「只写『管理员调整』」。
    - 改法：在 M 表和 §10 里写明这是有意的取舍，并说明原因（`score_events.reason` 只存机器码，防止战报数字算错）。

34. **低优先级的若干项没有交代去留**
    - **遗留的 Pages Functions**：`functions/api/[[default]].js`、`functions/auth/[[default]].js` 会把 `/api`、`/auth` 反代到 workers.dev。EdgeOne 部署依赖它们；在 Cloudflare Pages 上，从仓库根目录构建时也会被识别成 Pages Functions。要么删掉，要么保留并写明只给 EdgeOne 用。
    - **tablist 只实现了一半**：`/board` 的 4 个子标签和 `/admin?tab=` 要说明是路由链接（`<nav>` 加 `aria-current`），不是 `role=tab`。
    - **骨架屏**：§10 第 4 条提到了，但没有分到 PR。
    - **「有人退出 / 人齐了提醒组织者」**：分析列在「以后再做」，spec 的「不做」和 P5 里都没有。
    - **Header 每分钟刷新**：§2.1 提到了，没有 PR（应该放 P0-3 或 P3-2）。

35. **§6 视觉系统大部分没有分到 PR**
    - 没有归属的有：字号收成 6 档、系统字体栈、14 个 SVG 图标（P5 写的是「第二批图标」，第一批却没有出现在任何 PR）、断点统一成 600/1024、`@media (hover:hover)`、`PageBar`、`ConfirmInline`（§5 #6 标的是 P0，但 P0-1 到 P0-6 都没写）。
    - 改法：把它们分进 P0-1、P0-2、P3-2，并重新估算人日（见第七部分）。

36. **§11 第 7 条（`/yue` 权限向网页看齐）和第 14 条（bot `/score` 改用 selfHint）没有 PR**
    - 改法：放进 P2-4 和 P4-1，并写明受影响的 bot 测试。

37. **邀请整合 C 的「tab 改成『接下来 / 进行中·待点名 / 我的』」被换成了时间线分组，但没有说明**
    - 改法：在 §4 里写一句，说明用分组代替标签页的理由（同时解决了 tablist 只实现一半的问题）。

38. **入群链接应该指向分享页**
    - 证据：discord.nanako.org 是 Node 端的分享页（`compose.yaml:81-87`）。没有配置 `INVITE_CODE` 时，它用的是会轮换的 instant invite。
    - 改法：§11 第 12 条明确 `VITE_DISCORD_INVITE_URL` 填 `https://discord.nanako.org`（分享页），不要直接填 discord.gg 的邀请码。

---

## 五、路由、托管与 CSP

39. **「直接打开深层地址时先垫一条 `/`」在刷新时会重复执行**
    - 问题：§2.2 每次直接打开都会 `replaceState('/')` 再 `pushState`。在 `/sessions/5` 上刷新，或者从书签进入，历史栈每次都会多一条。
    - 改法：只在 `history.state` 里没有路由标记（新开的标签页或外部链接）时才垫；推入的条目带上 `{edg:1}` 标记。另外写明刷新后不恢复 `{sheet}` 状态（浮层不重开）。

40. **P1-0 的托管核验漏了 Worker 单源部署**
    - 证据：`wrangler.toml` 配了 `[assets] not_found_handling = "single-page-application"`、`run_worker_first = true`；`worker/index.ts:38-46` 的 `app.all('*')` 回退到 ASSETS，旧主机会带着 path 302 到 FRONTEND_URL（`worker/http.ts:111-122`）。
    - 改法：P1-0 的核验清单加上 Worker 单源部署和 legacy 302 两种情况（302 会保留 path，新路由不受影响，写一条测试锁住）。

41. **`/players/:id/cases/:caseId` 里两个 id 不一致时怎么办，没有规定**
    - 改法：以 `record.subject.id` 为准，`replaceState` 到正确的选手地址。`/cases/:id` 和 `/sessions/:id` 返回 404 时显示什么也要写：沿用「链接里的案件不存在了。」的写法，另给约局写一句。

42. **index.html 里没有 og 标签**
    - 证据：§3.1 写的是「og 文案改为」，但 `index.html` 现在只有 `description`。
    - 改法：写成「新增静态的 `og:title` 和 `og:description`」。

43. **CSP**：spec 里没有发现违规（.ics 用 Blob 下载、clipboard、share 都不受 CSP 限制；`ScoreGauge` 现有的 `style={{'--tier'}}` 是通过 CSSOM 设置的，不受 `style-src` 限制）。§6.3 说「`pages-headers.test.ts` 没有断言 style-src / font-src」，核对属实。
    - 建议补一句：倒计时、进度这类动态样式只能用 CSSOM 或 SVG 属性设置，不能用 `<style>` 标签，也不能用 HTML 里的 `style` 字符串。

---

## 六、内部矛盾

44. **「最快的邀请闭环」前后不一致**
    - §0 写「约 4 人日」，§9 P2 下面写「约 2.5 人日」。
    - 另外 P2-1 的「最简版再叫几个人」需要候选名单，而 `/api/me/invitable` 在 P2-2；只能先用 `/api/leaderboard`，这样又叫不到不在榜的人（M14）。
    - 改法：统一成一个数字，并写明依赖顺序：P0-2（sheet）→ P0-6 → P2-1 + P2-2。

45. **几个问题的分期和 PR 表对不上**
    - **H4**：「P3（P0 先拼最小版）」，但 P0 的 PR 里没有收件箱。
    - **H15**：「P3（队列）/ P4」，但 `/review` 在 P4-3。
    - **H13**：标的是 P0，却写了「点名改成页面」，而点名页在 P3-5。
    - 改法：以 §9 为准，回头改 §7。或者在 P0-3 里真的加一个最小版收件箱（邀请加待写说明两类，替代 InviteBanner 和 PendingBanner 的合并）。

46. **头像菜单的内容前后不一致**
    - §2.1 说裁判和管理员的入口、「记一笔」入口都包括头像菜单；§3.2 手机头像菜单只有「我的 / 编辑身份 / 退出」；桌面菜单又没有「编辑身份」。
    - 改法：统一成一份菜单清单，并按角色列出。

47. **收件箱排序规则不完整**
    - §3.2 的 10 条排序里没有 `withdraw` 这一类（§3.3 里有）。
    - 「待写说明 <24h / ≥24h」两档在默认 12 小时窗口下（`STATEMENT_WINDOW_HOURS = 12`）没有意义：第 8 条永远进不去。
    - 改法：按 `config.statementWindowHours` 的比例分档，或者改成「<2h 置顶加 `--attn`，其余按截止时间排」。同时补上 withdraw 的位置。

48. **§3.11 写了「改判（原判保留，可展开）」，却没标 P4**
    - `prior_verdict` 要等 B4-1 才有。
    - 改法：标上「P4 起」。

49. **P0–P3 里有几类待办没有数据来源**
    - 「withdraw 卡片」和「我立的案 · 撤销窗口」需要 `mine=filed`，这要到 P4 的 B4-2 ③ 才有。
    - 改法：P4 之前只用立案成功后的本地状态驱动，或者在 P4 之前不显示这两类。

50. **§3.4 历史页显示「准时 4 · 迟到 1」，但 B2-3 ④ 的 `scope=history` 没有这类出勤汇总字段**
    - 改法：在 `SessionItem` 里加 `attendance_summary`（批量查询），或者从历史行里去掉这个显示。

51. **`MyScoreLine` 的「本周 −4」和手机榜单行的「本周变化」需要 `week_delta`，但它在 P4**
    - 问题：这两处都被放进了 P0-4 / P0-5。
    - 改法：P0 先不显示本周变化，P4-5 再加上；或者在 P0 写明本人的本周变化从 `/api/users/me` 的 history 推算。

52. **WelcomeCard（P0）的「30 秒看懂 ›」指向 `/board/rules`**
    - 问题：这个路由到 P1 才有，内容到 P3 才有。
    - 改法：P0 阶段先展开现有的 RulesPanel，并滚动过去。

---

## 七、工作量估算不可信的地方

53. **几个 PR 的估算明显偏低**（按熟悉代码的一个人算）
    - **P0-5 1.5 天 → 约 3 天**：5 类草稿（含测试）、AppealSheet、撤销倒计时、提交前确认、ForgivenessNote、MyScoreLine、隐私文案，还要加上第 3 条的常量迁移和第 29 条的 M17。
    - **P0-4 1 天 → 约 2 天**：榜单手机布局、同分同名次、WeekHighlights 的门槛逻辑和单测、动态流截断、WelcomeCard、index.html。
    - **P1-1 2 天 → 约 3 天**：路由、旧链接翻译、NotFound、两个组件的 page/drawer 形态（含第 20 条的 Modal page 语义）、置顶移动、route 测试，还要改测试 setup。
    - **P2-3 2 天 → 约 3 天**：两套引擎的迁移、4 个子功能、bot 取消私信渲染、4 个测试文件。
    - **P3-2 2.5 天 → 约 3.5 天**：重写 TopBar、BottomTabs、TodoInbox 和 `todo.ts`、BoardMini、MyScoreLine，删除三个旧组件。
    - **P1 实机验收**：§10 第 5 条要求「专门留出实机验收时间」，但 P1 没有为此留人日，建议加 0.5–1 天。
    - **第 35 条没有归属的视觉系统工作**：字号、字体、图标、断点、hover、PageBar、ConfirmInline，合计约 2–3 天。
    - 改法：按上面重新估算后，核心版（P0–P3）大约 35–38 人日，全部做完大约 50 人日。§0、§9、§11 第 11 条要同步更新，或者把一部分内容挪到 P5，让总量保持在 28 / 42 附近。

---

## 八、§9 待决问题在 §11 里的覆盖情况

54. **第 1、5、10 题在正文里已经定了，但 §11 没有列出来**
    - 第 1 题：案件挂在选手页下面，用 `/players/:id/cases/:caseId`。
    - 第 5 题：不在榜的人可以被邀请，点名时只记出勤。
    - 第 10 题：只做深色；段位色只在网页端重映射，bot 不动。
    - 改法：在 §11 里加一节「已按推荐定下、可以推翻」，逐条列出，方便 owner 一次看全。

55. **第 3 题「要不要和 bot 一起改」没有回答**
    - 改法：§11 第 3 条写明 bot 不需要改。依据：bot 只会把立案经过私信给当事人和裁判，判决前不会公开发到频道；判决卡在 `case.decided` 之后才发。

56. **第 8 题「第一批后端只做 ★？」和 spec 的星标不一致**
    - 分析里给 `going_preview` 标了 ★，spec 的 B2-6 没有标。P1 还多出一个没有标 ★ 的 B1-1。
    - 改法：统一星标，并在 §11 第 11 条写明第一批后端的准确范围是 B1-1 加 B2-1 到 B2-6。
