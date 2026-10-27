# P1 共享契约（前端重设计 v5 · 地址化与登录回跳）

本文件是 P1 六个 PR（P1-0、B1-1、P1-1、P1-2、P1-3、P1-4）和 P1-5 实机验收共用的契约。各 `plan-P1-*.md` 只写自己的步骤，凡是跨 PR 的名字、签名、文件归属、storage 格式、测试约定，一律以本文件为准。

> **定稿说明**：本文件已按各计划的「对契约的补充」和跨 PR 合成（六份计划依次套在同一个副本上，typecheck / unit / dom / worker / build 全绿，见 `README.md`「一致性检查记录」）回写过：文件清单、`blocked` 的类型、`PinnedCase` 的位置、P1-2 常量的注释、`saveLoginReturn` 的签名、P1-3 的大厅「登录后报名」、各 PR 之后的用例数都以这里为准。计划正文和本文件仍有出入时，以计划正文为准（它们是在代码上实测过的），并回报领队。

## 0. 依据与通用规则

- 已拍板的方案：`docs/redesign-v5/spec.md`（§11 全部按推荐默认值）。P1 用到：§2 全部（导航、路由表、旧深链映射、首页 DOM 顺序）、§3.5（约局详情 page/drawer、ResumeHint、访客）、§3.8（选手页与案件聚焦）、§6.4（Modal 语义，尤其 page 形态）、§6.5（锁定清单）、§8 B1-1（档位 b，§11 第 3 条）、§9 P1 表、§10 第 5、12 条、§11 第 3、16 条。另有 `docs/redesign-v5/analysis.md` §6「必须保留的约束」、`docs/CONTRACT.md:400-420`（Frontend expectations）。
- P0 计划：`docs/redesign-v5/plan-p0/`（README.md、contract.md）。P0 契约里的规则在 P1 继续有效（CSS 断点四种写法、hover 包进 `@media (hover: hover)`、CSP 不放 `unsafe-inline`、DOM 顺序 = 视觉顺序、§6.5 锁定文案、组件签名只加可选 props、新按钮不叫裸的「取消」「确认」「关闭」、toast 不用 `role="alert"`、被 `tests/unit` 导入的 `src/lib` 模块必须是纯模块）。
- **规划所依据的代码基线**是「六份 P0 计划全部套上之后」的仓库，副本在 `/tmp/claude-redesign/p0/final/compose/repo`（typecheck、unit、dom、build 都通过）。下文的 `路径:行号` 都指这个副本，行号只作参考；P0 执行者可能有细微偏差，**定位一律以引用的锚点文字为准**。
  - 注意：该副本里**没有 `docs/` 目录**。`docs/CONTRACT.md`、`docs/DEPLOY-PAGES.md`、`docs/redesign-v5/*` 以分支上的真实文件为准（P1-0、P1-4 要改它们）。
- spec 和本契约冲突时以 spec 为准，**除了第 8 节明确列出的偏离**（那些是有测试或实现理由的，已写明理由，需机主过目）。spec 没写死、本契约写死了的文件名、导出名、类名、常量名、storage key，一律照用，不另起名字。
- 机主编码规则：不可变更新；文件 200–400 行为宜、最多 800；函数 < 50 行；嵌套 ≤ 4 层；错误给友好的中文提示；在边界校验输入；不写 `console.log`；不写魔法数（时长、门槛、长度上限放 `src/lib/constants.ts` 的 P1 小节）；用户文案用 spec 原文的中文。
- 提交信息 `<type>: <中文描述>`，**不加任何署名行**（没有 `Co-Authored-By`，没有「Generated with」）。
- 本轮**不 rebase 到 `origin/main`、不 push、不开 PR、不合并**。PR 由机主以后按叠放顺序处理。

## 1. 基线（= P0 全部套上之后）

在规划副本上实测（Node v24.22.0，命令前先 `export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH`）：

| 项 | 值 | 出处 |
|---|---|---|
| unit（`vitest.config.ts`） | **26 个文件 / 326 个用例** 全过 | 与 `plan-p0/README.md`「+ P0-5」一行一致，副本实测吻合 |
| dom（`vitest.dom.config.ts`，setup `tests/dom/setup.ts`） | **20 个文件 / 219 个用例** 全过；只有原有的 `onboarding-roles` 3 条 `act(...)` 警告 | 同上 |
| worker（`vitest.workers.config.ts`） | 15 个文件 / 548 过 + 9 todo；其中 `cases.test.ts` 37、`record-privacy.test.ts` 10、`split-deploy.test.ts` 11 | 副本实测 |
| typecheck | `npm run typecheck`（三个 tsconfig）通过 | P0 README |
| build | `npm run build` 通过；`dist/` 里只有 `index.html` 和 `assets/` | 副本 |
| 本地不跑 | `npm run test:pg`、`npm run test:server`（嵌入式 Postgres），交给 CI | — |

每个 P1 计划的 Task 0 都要：确认上游分支存在且 HEAD 干净；用 grep 核对本契约里它消费的上游接口都在；跑 unit + dom（B1-1、P1-0 另跑 worker）把实际数字记下来，和下表的「开工时」对照。对不上就停下，不在本 PR 里补别人的文件。

累计的测试文件数和用例数（「文件 / 用例」；跨 PR 合成副本上逐 PR 实测，Node v24.22.0；dom 的 `act(...)` 警告始终只有 `onboarding-roles` 的 3 条，`Not implemented` 0 条）：

| 合并后 | unit | dom | worker | 新增 / 追加的测试 |
|---|---|---|---|---|
| 基线（P0-5） | 26 / 326 | 20 / 219 | 15 / 548 + 9 todo | — |
| + P1-0 | 26 / 330 | 20 / 219 | 15 / 551 + 9 todo | `tests/unit/pages-headers.test.ts` import 行扩充 + 追加 4 例（dist 不含 404.html 3 例、仓库根没有 `functions/`/`edgeone.json` 1 例）；`tests/unit/source-hygiene.test.ts` 只改 `SOURCE_DIRS` 一行；`tests/worker/split-deploy.test.ts` 追加 2 例、`tests/worker/node-api.test.ts` 追加 1 例（`/sessions/5?x=1` 的 302 Location） |
| + B1-1 | 27 / 345 | 20 / 225 | 15 / 560 + 9 todo | 新 `tests/unit/record-view.test.ts`（7）；追加 `tests/unit/record-privacy.test.ts`（8）、`tests/worker/record-privacy.test.ts`（9）、`tests/dom/verdict-privacy.test.tsx`（6） |
| + P1-1 | 28 / 363 | 22 / 264 | 15 / 560 + 9 todo | 新 `tests/unit/route.test.ts`（16）、`tests/dom/router.test.tsx`（14）、`tests/dom/route-pages.test.tsx`（25）；`tests/dom/deep-link.test.tsx`、`tests/dom/p8-app.test.tsx` 只**追加**断言；`source-hygiene` +1 个 describe（2 例）；测试辅助 `tests/dom/viewport.ts` |
| + P1-2 | 28 / 369 | 23 / 283 | 不跑（不碰后端） | 新 `tests/dom/back-closes-layer.test.tsx`（19）；`route.test.ts` 追加 `readEdgState` 用例（6）；`router.test.tsx`、`route-pages.test.tsx` 里 P1-1 的 4 个用例改前提、不删断言；测试辅助 `tests/dom/history.ts` |
| + P1-3 | 29 / 414 | 24 / 299 | 不跑 | 新 `tests/unit/login-return.test.ts`（45）、`tests/dom/login-return.test.tsx`（16） |
| + P1-4 | 29 / 414 | 24 / 299 | 不跑 | 无（文档检查脚本在仓库外，不提交） |

新测试文件名两两不重名，也不和现有文件重名（已核对 `tests/unit/deep-link.test.ts` 与新 `route.test.ts` 不同名）。

## 2. 分支与叠放顺序

**顺序：P1-0 → B1-1 → P1-1 → P1-2 → P1-3 → P1-4**，每个分支从前一个分支的 HEAD 开：

| 顺序 | id | 分支 | 从哪开 | 人日（spec） | 一句话 |
|---|---|---|---|---|---|
| 1 | P1-0 | `claude/p1-0-hosting` | `claude/p0-5-safety-net` | 0.5 | 托管核验；删除遗留 Pages Functions 和 `edgeone.json`；build 拒绝 404.html |
| 2 | B1-1 | `claude/b1-1-redact` | `claude/p1-0-hosting` | 1 | 后端 `redactRecord` 判决前脱敏（档位 b），前端处理 `type`/`range` 为 null |
| 3 | P1-1 | `claude/p1-1-router` | `claude/b1-1-redact` | 3 | 路由、旧深链映射、NotFound、PageBar、详情页 page/drawer 形态、案件聚焦 |
| 4 | P1-2 | `claude/p1-2-history` | `claude/p1-1-router` | 1 | 浮层入 history、返回键只关栈顶、垫一条 `/`、刷新去 sheet、滚动恢复 |
| 5 | P1-3 | `claude/p1-3-login-return` | `claude/p1-2-history` | 0.5 | `edg.return` 登录回跳、`ResumeHint`、访客报名意图 |
| 6 | P1-4 | `claude/p1-4-docs` | `claude/p1-3-login-return` | 0.5 | `docs/CONTRACT.md`「Frontend expectations」改写、README 路由表、P1-5 验收清单 |
| (7) | P1-5 | 只在需要修东西时开 `claude/p1-5-device-fixes`，从 `claude/p1-4-docs` 开 | — | 0.5–1 | 实机验收（领队执行），见第 9 节 |

开分支：`git switch -c <分支> <上游分支>`（本地分支，不 fetch、不 rebase `origin/main`）。上游分支不存在就停下。B1-1 排在 P1-1 前面，满足 spec「B1-1 要和路由一起或更早上线」。

旧分支 `claude/p1-share-node` 与新分支名不冲突；新名字一个都不要改。

### 各 PR 动到的文件

图例：**新**＝新建，**改**＝修改，**删**＝删除。带 ★ 的是第 3 节列出的共享文件，必须守分区。

**P1-0 `claude/p1-0-hosting`**
- 删：`functions/api/[[default]].js`、`functions/auth/[[default]].js`（整个 `functions/` 目录）、`edgeone.json`。
- 改：`scripts/pages-headers.mjs`（构建产物里任何层级有 `404.html` 就让构建失败；CSP 一个字不改）、`tests/unit/pages-headers.test.ts`（import 行扩充 + 末尾追加）、`tests/unit/source-hygiene.test.ts`（只改 `SOURCE_DIRS` 一行，去掉 `'functions'`：目录删了 `readdirSync` 会 ENOENT）、`tests/worker/split-deploy.test.ts`、`tests/worker/node-api.test.ts`（都只追加）、`README.md`（「## 部署」里锚点「**拆分部署**（前端 → 腾讯 EdgeOne Pages」那一条）、`DEPLOY-EDGEONE.md`（顶部加「已停用」说明，正文不删）、`docs/DEPLOY-PAGES.md`（第 2 步「注意：仓库根目录的 `functions/`」和第 7/8 步「**注意**：EdgeOne 边缘函数反代」两段改成「P1-0 已删除」，并在文末新增「SPA 回退核验（P1-0）」小节记录实测结果）。
- 不碰任何 `src/`、`worker/` 源码。`wrangler.toml` 的 `[assets] not_found_handling`、`run_worker_first` 和 `worker/index.ts` 的 `app.all('*')` 只核验、不改（旧 Worker 部署已被机主下线，代码仍在，Node 端复用同一套路由）。

**B1-1 `claude/b1-1-redact`**
- 改：`worker/case-reads.ts`（`redactRecord`）、`worker/types.ts`（`RecordView` 的类型）、`src/types.ts` ★（`RecordItem` 的 `type`/`range` 可空、加 `pending_hidden`）。
- 新：`src/lib/recordView.ts`（纯）。
- 改（只为 null 做最小处理）：`src/components/VerdictCard.tsx`、`src/components/RecordsFeed.tsx`、`src/components/CaseActions.tsx`、`src/components/StatementDialog.tsx`、`src/components/AppealSheet.tsx`、`src/components/PendingBanner.tsx`、`verdict-card.css`（只在末尾追加 `.vc__delta-hidden`；`records-feed.css` 不用改）。
- 测试：新 `tests/unit/record-view.test.ts`；追加 `tests/unit/record-privacy.test.ts`、`tests/worker/record-privacy.test.ts`、`tests/dom/verdict-privacy.test.tsx`。
- 不碰 `PlayerDetail.tsx`、`App.tsx`、bot（`server/src/discord/*` 用的是 `canReadPrivate`，不经过 `redactRecord`）。

**P1-1 `claude/p1-1-router`**
- 新：`src/lib/routes.ts`（纯）、`src/lib/router.ts`、`src/lib/useRouteLayout.ts`、`src/lib/useEntryTarget.ts`、`src/lib/useCaseLookup.ts`（`PinnedCase` 定义在这里）、`src/lib/routeCopy.ts`（纯）、`src/components/Link.tsx`、`src/components/PageBar.tsx` + `page-bar.css`（含 `.hdr:has(.hdr__dropdown)` 一条）、`src/components/NotFound.tsx` + `not-found.css`、`src/components/RouteView.tsx`。
- 改：`src/lib/deepLink.ts` ★（只导出 `ID_PATTERN`）、`src/App.tsx` ★、`src/app.css`（只在末尾追加 `.app__main[hidden]`、`.app__footer[hidden]`、`.app__page*`）、`src/components/Header.tsx` ★（只改品牌那个 `<a>`）、`src/components/SessionDetailDialog.tsx` ★、`src/components/PlayerDetail.tsx` ★、`player-detail.css`（只在末尾追加；`session-detail.css` P1-1 不碰）、`src/lib/constants.ts`（末尾追加 P1-1 小节）、`tests/dom/setup.ts` ★。
- 测试：新 `tests/unit/route.test.ts`、`tests/dom/router.test.tsx`、`tests/dom/route-pages.test.tsx`、`tests/dom/viewport.ts`（测试辅助，不是测试文件）；追加 `tests/dom/deep-link.test.tsx`、`tests/dom/p8-app.test.tsx`、`tests/unit/source-hygiene.test.ts`。
- 不碰 `Modal.tsx`、`modalStack.ts`。

**P1-2 `claude/p1-2-history`**
- 改：`src/lib/router.ts`（加 history 浮层、静默后退、垫 `/`、去 sheet、滚动恢复）、`src/lib/routes.ts`（`EdgHistoryState` 的 P1-2 字段和 `readEdgState`）、`src/components/Modal.tsx` ★（新可选 prop `historyKey`）、`src/lib/constants.ts`（P1-2 小节）、`tests/dom/setup.ts` ★（改成 async，先排空 history 遍历）。
- 新：`src/lib/useHistoryLayer.ts`、`tests/dom/history.ts`（测试辅助：`drainHistoryTraversals`、`overlayMarks`、`entryIdx`、`preventNavigation`——最后一个给 P1-3 用）。
- 改（每处只给自己的 `<Modal>` 加一个 `historyKey`）：`RescheduleSheet.tsx`、`AppealSheet.tsx`、`RollCallDialog.tsx`、`CaseDialog.tsx`、`StatementDialog.tsx`、`SessionFormDialog.tsx`、`OnboardingDialog.tsx`、`AdminAiPanel.tsx`。
- 测试：新 `tests/dom/back-closes-layer.test.tsx`；追加 `tests/unit/route.test.ts`；`tests/dom/router.test.tsx`、`tests/dom/route-pages.test.tsx` 里 P1-1 的 4 个用例改前提（P1-1 的「只盖章、不垫 `/`」被 P1-2 按 spec 改掉），断言一条不删。
- `src/lib/router.ts` 是整文件替换，但 P1-1 的导出名和签名一个不改。
- 不碰 `App.tsx`、`SessionDetailDialog.tsx`、`PlayerDetail.tsx`、`RouteView.tsx`、`modalStack.ts`、任何 CSS。

**P1-3 `claude/p1-3-login-return`**
- 新：`src/lib/loginReturnShape.ts`（纯）、`src/lib/loginReturn.ts`、`src/lib/useLoginResume.ts`（登录回跳的消费逻辑，`useEntryTarget` 第一行调用它）、`src/components/LoginLink.tsx`、`src/components/ResumeHint.tsx` + `resume-hint.css`、`src/components/VisitorRsvpPrompt.tsx` + `visitor-rsvp.css`。
- 改：`src/lib/useEntryTarget.ts`（解构补 `me`、第一行调 `useLoginResume`、结果多两个字段）、`src/components/RouteView.tsx`（透传 resume）、`src/App.tsx` ★（`handleLogout` 一行、`useEntryTarget` 的解构多取两个字段、给 RouteView 两个 prop）、`src/components/Header.tsx` ★（只改「登录」那个 `<a>` 和它的 import）、`src/components/WelcomeCard.tsx`（只改登录 `<a>`）、`src/components/SessionDetailDialog.tsx` ★（RSVP 区）、`session-detail.css`（末尾追加）、`src/components/SessionsPanel.tsx` + `sessions-panel.css`（访客在大厅约局行上看到「登录后报名」，spec §3.1 线框）、`src/lib/constants.ts`（P1-3 小节）。
- 测试：新 `tests/unit/login-return.test.ts`、`tests/dom/login-return.test.tsx`。`tests/dom/history.ts`、`tests/dom/setup.ts` 不改。

**P1-4 `claude/p1-4-docs`**
- 改：`docs/CONTRACT.md`（`interface RecordItem` 跟上 B1-1 的 API 形状；「Frontend expectations」整节，`docs/CONTRACT.md:400-420`）、`README.md`（在「## 技术栈」前新增「## 路由」一节；「## 角色」表游客一行补判决前的说法）。
- 新：`docs/redesign-v5/p1-acceptance.md`（P1-5 的实机验收清单和记录表）。
- 不碰代码。

## 3. 共享文件与分区归属

后来的 PR 一律**按锚点文字定位**，不按行号。

| 文件 | 谁改、改哪一块 |
|---|---|
| `src/App.tsx` | **P1-1**：import 区；`AppMain` 的 state 区删掉 `selectedUserId`、`sessionId`、`focusCaseId`、`deepLink`、`deepLinkDone`、`linkMissing`（后三个搬进 `useEntryTarget`），新增 `pinned`、`playerRefreshKey`；锚点「One-off parameters: stripped at once」的 mount effect 和锚点「Open what the link points at, once」的 deep-link effect 整段换成 `useEntryTarget`；`?onboarding=1` effect 里的 `window.history.replaceState(null, …)` 换成 `navigate(…, { replace: true })`；渲染区：`<main className="app__main">` 加 `hidden`、footer 加 `hidden`、`</main>` 和 `<footer>` 之间插 `<RouteView>`；`Leaderboard.onSelect`、`WeekHighlights.onSelectUser`、`RecordsFeed.onSelectUser`、`MyScoreLine.onOpen`、`SessionsPanel.onOpenSession`、`InviteBanner.onOpen`、`SessionFormDialog.onCreated` 改成导航；删掉文件末尾的 `{sessionId !== null && <SessionDetailDialog…>}` 和 `{selectedUserId && <PlayerDetail…>}` 两块；`StatementDialog.onDecided` 额外让 `playerRefreshKey` +1。另外 P1-1 用 `const entryBlocked = useCallback(() => onboardingOpen || onboardingAsked.current, [onboardingOpen])` 作为 `blocked`，`useEntryTarget(` 写在两个 onboarding effect 之后。<br>**P1-3**：import 区加 `clearLoginReturn`；`handleLogout` 里 `clearAllDrafts()` 后面加 `clearLoginReturn()`；`const { linkMissing, dismissLinkMissing } = useEntryTarget({` 的解构多取 `resume, clearResume`；给 `<RouteView>` 加 `resume`、`onResumeDone` 两个 prop。<br>**P1-0、B1-1、P1-2、P1-4 不碰**。P1-1 之后 App 只通过 `router.ts` 改地址，源码里不再出现 `window.history.`（P1-1 的 source-hygiene 断言锁住）。P1-1 后行数应在 420–460（合成实测 430），P1-3 后不超过 470（合成实测 434）。 |
| `src/components/Modal.tsx` | **只有 P1-2**：新可选 prop `historyKey`，import 一行，以及在 `usePageFocus(open && isPage, labelledBy, pageRef);` 之后调用 `useHistoryLayer(open && !isPage, historyKey, onCloseRef)`。`variant`、`dismissible`、`title`、`data-autofocus`、legacy center 的逐字节 markup、「每个打开的 Modal 只装一次 document keydown 监听」都不变。P1-1 不改它（page 形态的焦点问题在调用方解决，见 4.6）。 |
| `src/lib/modalStack.ts` | **P1 全程不改**。history 浮层的栈放在 `router.ts`，不复用 `modalStack` 的层栈（两者语义不同：后者管键盘，前者管返回键）。 |
| `src/components/SessionDetailDialog.tsx` | **P1-1**：props 接口（加 `variant`）、顶层 `return` 里的 `<Modal …>` 包装（按 variant 选形态、page 形态插 `<PageBar>`、404 时渲染 `<NotFound>`）、首次加载完成后的标题聚焦。<br>**P1-3**：import 两行（`ResumeHint`、`VisitorRsvpPrompt`）；props 接口和解构再加 `resumeRsvp`/`onResumeDone`（接在 P1-1 的 `variant` 之后）；锚点 `const canRollCall = …` 下面插入派生值和处理函数；锚点 `{canRsvp && (` 那一段（加访客分支和 `ResumeHint`）；锚点 `const FULL_NOTICE_ID = …` 下面加 `describedBy` 小工具；文件内 `RsvpControls` 组件（加可选 `suggested`）。<br>B1-1、P1-2 不碰（P1-2 改的是 `RollCallDialog.tsx`、`RescheduleSheet.tsx` 自己的 `<Modal>`）。 |
| `src/components/PlayerDetail.tsx` | **只有 P1-1**：加 `variant`、`pinnedRecord`、`refreshKey`；page 形态的 `PageBar`；`ScoreGauge` 的 `tone`；404 时 `NotFound`；置顶案件块；焦点规则。B1-1 不碰（`type`/`range` 为 null 由 VerdictCard 和 CaseActions 处理）。P1-2 不碰（`AppealSheet` 在自己的文件里加 `historyKey`）。 |
| `src/lib/deepLink.ts` | **只有 P1-1**：把 `const ID` 改名并导出为 `export const ID_PATTERN = /^[1-9]\d{0,14}$/`，文件内引用同步改名。`readDeepLink`、`withoutParams`、`DEEP_LINK_PARAMS` 的签名和行为不变（`tests/unit/deep-link.test.ts` 原样通过）。 |
| `tests/dom/setup.ts` | **P1-1**：整文件替换成同步版本：把注释 `// P1-1: resetRouterForTests();` 换成真正的调用；文件顶层给 `window.scrollTo` 装一个空函数（jsdom 没实现它，会刷 "Not implemented"）；`afterEach` 里删掉测试装上的 `window.matchMedia`。<br>**P1-2**：整文件替换成最终形态：`afterEach` 改成 `async`，第一步 `await drainHistoryTraversals()`。<br>P1-3 不改（`sessionStorage.clear()` 已经覆盖 `edg.return`）。最终形态见 6.3。 |
| `tests/dom/history.ts` | **只有 P1-2** 建（含 `preventNavigation`）；P1-3 只导入。 |
| `tests/dom/router.test.tsx`、`tests/dom/route-pages.test.tsx` | **P1-1** 建；**P1-2** 只改 P1-1 的 4 个用例的前提（「只盖章、不垫 `/`」→「垫 `/`」），断言不删。P1-3 不改。 |
| `src/components/SessionsPanel.tsx`、`sessions-panel.css` | **只有 P1-3**：`SessionRow` 里加 `canAskLogin` 和一个 `LoginLink`「登录后报名」；css 末尾追加 `.srow__login`。 |
| `src/components/Header.tsx` | **P1-1**：只改锚点 `<a className="hdr__brand" href="/"` 那一个元素，换成 `<Link to="/" className="hdr__brand" aria-label="EDG 信誉分 首页">`，子元素不动。**P1-3**：只改锚点 `href={AUTH_LOGIN_URL}` 那个「登录」`<a>`，换成 `<LoginLink className="btn btn--gold">登录</LoginLink>`。 |
| `src/types.ts` | **只有 B1-1**。 |
| `src/lib/constants.ts` | 每个 PR 在文件末尾追加带标题的小节，顺序 `// --- P1-1 ---`、`// --- P1-2 ---`、`// --- P1-3 ---`（接在 `// --- P0-5 ---` 之后）。 |
| `src/lib/router.ts`、`src/lib/routes.ts` | P1-1 建。P1-2 **整文件替换** `router.ts`（P1-1 的导出名、签名、注释原样保留，只加 4.2 列的 P1-2 导出）；`routes.ts` 只改 `EdgHistoryState`、`readEdgState` 和 constants 那一行 import。P1-3 只消费。 |
| `src/lib/useEntryTarget.ts`、`src/components/RouteView.tsx` | P1-1 建；P1-3 追加登录回跳（`useEntryTarget` 的解构补 `me`，第一行调 `useLoginResume`，`return` 多两个字段）与 resume 透传（`RouteViewProps` 加两个可选 prop，`case 'session'` 的 `<SessionDetailDialog>` 加两个属性）。 |
| `tests/unit/source-hygiene.test.ts` | P1-0 只改 `SOURCE_DIRS` 一行（去掉 `'functions'`）；P1-1 在末尾追加一个 `describe`（见 6.5）。两处不重叠。 |

## 4. 接口

### 4.1 `src/lib/routes.ts`（P1-1 建，纯模块：不碰 `window`/`document`/storage，不导入 React）

```ts
export type Route =
  | { readonly name: 'home' }
  | { readonly name: 'session'; readonly sessionId: number }
  | { readonly name: 'player'; readonly userId: string }
  | { readonly name: 'playerCase'; readonly userId: string; readonly caseId: number }
  | { readonly name: 'case'; readonly caseId: number }          // /cases/:id 别名，查到当事人后 replace
  | { readonly name: 'notFound' };

export type LinkableRoute = Exclude<Route, { name: 'notFound' }>;
export type RouteLayout = 'page' | 'drawer';

export const HOME_PATH = '/';
export const RESERVED_PREFIXES = ['/api', '/auth', '/link'] as const;

export function parseRoute(pathname: string): Route;
export function formatRoute(route: LinkableRoute): string;
export function sessionPath(sessionId: number): string;                 // '/sessions/5'
export function playerPath(userId: string): string;                     // '/players/' + encodeURIComponent(userId)
export function playerCasePath(userId: string, caseId: number): string; // '/players/<enc>/cases/7'
export function casePath(caseId: number): string;                       // '/cases/7'
export function isAppPath(pathname: string): boolean;
export function isUserId(raw: string): boolean;
export function routeCoversHome(route: Route, layout: RouteLayout): boolean;
export function readEdgState(raw: unknown): EdgHistoryState | null;   // 见 4.3
```

`parseRoute` 规则（`route.test.ts` 全部覆盖）：
- 只看 `pathname`，不看 search 和 hash。非根路径末尾**恰好一个** `/` 时先去掉再解析；`formatRoute` 永远不输出末尾 `/`。
- `/` → `home`；`/sessions/:id` → `session`；`/players/:id` → `player`；`/players/:id/cases/:caseId` → `playerCase`；`/cases/:id` → `case`。
- 数字 id 只接受 `ID_PATTERN`（`^[1-9]\d{0,14}$`，从 `deepLink.ts` 导入）。所以 `/sessions/new`、`/sessions/history`、`/sessions/0`、`/sessions/07`、`/cases/1e3` 都是 `notFound`。
- 用户 id：段先 `decodeURIComponent`（抛错 → `notFound`），再用 `isUserId`：非空、长度 ≤ `USER_ID_MAX`（128）、不含 `\u0000`。`/` 编码后（`%2F`）允许。
- `RESERVED_PREFIXES`：等于前缀或以「前缀 + `/`」开头时 `isAppPath` 为 false，`parseRoute` 返回 `notFound`（SPA 只会在托管配错时收到这种路径）。`/apix` 不算保留前缀。
- 其余（包括 P3/P4 才有的 `/board`、`/me`、`/review`、`/admin`、`/join`、`/sessions/:id/rollcall`、`/cases/:id/statement`、`/cases/new`）在 P1 一律 `notFound`。后续阶段往 `Route` 联合里加成员，不改已有成员。
- `routeCoversHome(route, layout)`：`home` → false；`notFound`、`case` → true；`session`、`player`、`playerCase` → `layout === 'page'`。

### 4.2 `src/lib/router.ts`（P1-1 建，P1-2 追加；DOM 模块）

```ts
export interface RouterLocation {
  readonly pathname: string;
  readonly search: string;   // '' 或 '?…'
  readonly route: Route;
}
export interface NavigateOptions {
  readonly replace?: boolean;     // 默认 false：pushState
  readonly keepScroll?: boolean;  // 默认 false：push 之后滚到顶；桌面开抽屉时传 true
}

export function useRoute(): Route;
export function useLocation(): RouterLocation;
export function navigate(path: string, options?: NavigateOptions): void;
export function goBack(fallback?: string): void;      // fallback 默认 HOME_PATH
export function currentPath(): string;                // pathname + search，给 LoginLink 用
export function bootRouter(): void;                    // App 首个 useState 初始化函数里调用，幂等
export function resetRouterForTests(): void;           // 测试专用
// P1-2 追加：
export function simulateReloadForTests(): void;        // 测试专用：只清模块状态，不动 URL 和 history.state
export type LayerEntryId = number;
export function pushLayerEntry(name: string, onPop: () => void): LayerEntryId;
export function dropLayerEntry(id: LayerEntryId): void;
```

实现约定：
- `useRoute`/`useLocation` 用 `useSyncExternalStore`。`getSnapshot` 以 `location.pathname + location.search` 为键缓存；键变了就重新解析（这样测试里直接 `history.replaceState(…)` 改地址、在同一个测试里多次 `render(<App />)` 也能读到新地址）。
- popstate 监听装在 `window` 上，**整个模块只装一个**；有订阅者时装、没有时卸（P1-2 起：有订阅者、有打开的浮层、或有静默后退在途时都装着，三者都没有才卸）。Modal 不装任何新的 document/window 监听（`modal-focus.test.tsx:63-75` 数的是 document 的 keydown 监听）。
- **只改了 hash 的 popstate 一律忽略**（pathname + search 没变就不通知订阅者）。站内链接和导航永远不带 hash。
- `navigate(path, options)`：
  1. `path` 必须以 `/` 开头且不以 `//` 开头，否则 `throw new Error('navigate 只接受站内路径')`（编程错误，不吞）。
  2. `!isAppPath(pathname)` → `window.location.assign(path)`（整页跳转），不进 history 栈。
  3. （P1-2）有未完成的静默后退时，把这次导航排队，等 popstate（或 `SILENT_BACK_TIMEOUT_MS` 超时）后再执行。
  4. 不是 replace、并且 pathname + search 和当前一样 → 什么都不做（不压重复条目）。
  5. （P1-2）当前条目带 `sheet` 时强制 replace（浮层条目被这次导航消耗掉）；push 前先把 `scrollY` 写进当前条目的 `y`。
  6. replace：`replaceState({ edg: 1, idx: 当前 idx }, '', path)`；push：`pushState({ edg: 1, idx: 当前 idx + 1 }, '', path)`。
  7. push 且 `!keepScroll` → `window.scrollTo(0, 0)`。
  8. 通知订阅者。
- `goBack(fallback)`：当前条目 `readEdgState(history.state)?.idx > 0` → `history.back()`；否则 `navigate(fallback, { replace: true })`。所有「返回」「✕」（page 的 PageBar、drawer 的 ✕/Esc/点背景）都调它。
- `bootRouter()`（幂等，靠 `history.state` 判断，不用模块标志，所以 StrictMode 双调和测试里重复 render 都安全）：
  - P1-1：`readEdgState(history.state) === null` → `replaceState({ edg: 1, idx: 0 }, '', 当前 pathname + search)`（盖章，不垫）。
  - P1-2 改为：没有标记且 pathname 不是 `/` → `replaceState({ edg: 1, idx: 0 }, '', '/')` 再 `pushState({ edg: 1, idx: 1 }, '', 原地址)`（**只垫一次**：刷新时 state 还在，不会再垫）；没有标记且是 `/` → 只盖章；有标记但带 `sheet`/`layer`（刷新前开着浮层）→ `replaceState` 去掉这两个字段，浮层不重开；`history.scrollRestoration = 'manual'`。
- `resetRouterForTests()`：清空订阅者、快照缓存、（P1-2）静默后退计数和排队、浮层条目栈、下一个 layer id；最后 `history.replaceState(null, '', '/')`。幂等。
- `simulateReloadForTests()`（P1-2）：同上，但**不动** URL 和 `history.state`，用来模拟「刷新后历史不变长」「刷新后浮层不重开」。
- 源码里只有 `router.ts` 能调用 `history.pushState/replaceState/back/go/forward` 和读写 `history.state`（`source-hygiene` 断言，见 6.5）。

### 4.3 `history.state` 的形状

```ts
export interface EdgHistoryState {
  readonly edg: 1;
  readonly idx: number;        // P1-1：路由盖章 / 垫的那条为 0；push = 当前 idx + 1；replace 保留当前 idx
  readonly sheet?: string;     // P1-2：浮层名（historyKey），≤ HISTORY_SHEET_NAME_MAX 字符
  readonly layer?: number;     // P1-2：浮层条目 id（正整数，模块内递增，不复用）
  readonly y?: number;         // P1-2：离开这条时的 scrollY（有限、≥ 0）
}
```

- `readEdgState(raw)`：`edg !== 1` → null；`idx` 缺省或不合法时按 0 处理（兼容只写了 `{edg: 1}` 的旧条目和测试）；`sheet`/`layer`/`y` 不合法就丢掉该字段。
- spec 写的形状是 `{edg: 1, sheet?}`，`idx`、`layer`、`y` 是本契约的补充（第 8 节第 2 条）。判断「是不是路由压的条目」仍然只看 `edg === 1`。

### 4.4 `src/components/Link.tsx`（P1-1）

```ts
interface LinkProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: string;            // 站内路径（可带 search，不带 hash）
  replace?: boolean;
  keepScroll?: boolean;
}
export function Link(props: LinkProps): JSX.Element;   // 渲染 <a href={to} …>
```

- 点击时：调用方的 `onClick` 先跑；`event.defaultPrevented`、非左键、按着 meta/ctrl/shift/alt、`target` 不是 `_self`/空、或 `!isAppPath(to)` → 交给浏览器；否则 `preventDefault()` 并 `navigate(to, { replace, keepScroll })`。
- `aria-current` 等属性原样透传（P3 的子页导航要用）。
- 不渲染成按钮；可访问角色就是 link。

### 4.5 `src/lib/useRouteLayout.ts`（P1-1）

```ts
export function useRouteLayout(): RouteLayout;   // matchMedia(DESKTOP_MEDIA_QUERY) 命中 → 'drawer'，否则 'page'
```

- `DESKTOP_MEDIA_QUERY = '(min-width: 1024px)'`（constants.ts P1-1 小节），必须和 CSS 断点一致（`route.test.ts` 断言它在 `css-conventions` 允许的四种写法里）。这是 JS 里唯一一处断点，理由见第 8 节第 9 条。
- 监听 `change`，跨过 1024px 时切换形态（组件会重挂载，可以接受）。
- `window.matchMedia` 不存在（jsdom 默认）→ `'page'`。所以 dom 测试默认是手机形态。

### 4.6 页面 / 抽屉形态的 props

**`SessionDetailDialog`**（P1-1 加；现有 `{ sessionId, me, onClose, onChanged }` 不变）

```ts
variant?: 'center' | 'page' | 'drawer';   // 默认 'center'：和今天逐字节一致（organizer-actions、session-rsvp-moved 都用默认值）
// P1-3 再加：
resumeRsvp?: SelfRsvp | null;             // 登录前点过的报名，只用来提示，绝不自动提交
onResumeDone?: () => void;                // 用户回答了或点了「不用了」之后调用
```

- `page`：`<Modal variant="page" labelledBy="session-detail-title">`，第一个子元素是 `<PageBar backLabel="返回" title={session?.title} onBack={onClose} />`；首次加载成功后把焦点移到 `h2#session-detail-title`（已有 `tabIndex={-1}` 和 `titleRef`），只做一次。
- `drawer`：`<Modal variant="drawer" labelledBy="session-detail-title" size="lg">`，**不传** `title`（内容里已有同 id 的 h2）；✕ 来自 Modal 自己的 `.modal__bar`。
- `page`/`drawer` 里 `getSession` 返回 `ApiError` 404 → 渲染 `<NotFound title={SESSION_NOT_FOUND} headingId="session-detail-title" />`；其他错误沿用今天的错误文案。`center` 完全不变。
- 被取消的局不会 404，照常灰色显示（后端本来如此）。

**`PlayerDetail`**（P1-1 加；现有 props 全保留，含 `onOpenStatement`、`onChanged`、`focusRecordId`、`config`）

```ts
variant?: 'center' | 'page' | 'drawer';   // 默认 'center'
pinnedRecord?: RecordItem | null;         // 案件聚焦时从解析处拿到的那一起（避免再请求一次）
refreshKey?: number;                      // 变化时重新 load（StatementDialog 判完后让列表跟上）
```

- `page`：`<Modal variant="page" labelledBy="player-detail-title" size="lg">`，第一个子元素 `<PageBar backLabel="返回" onBack={onClose} />`。`drawer`：`<Modal variant="drawer" …>`，不传 `title`。
- `getUserDetail` 返回 404（page/drawer）→ `<NotFound title={PLAYER_NOT_FOUND} headingId="player-detail-title" />`。
- **ScoreGauge**：`tone={isSelf ? 'tier' : 'neutral'}`，所有形态都这样（spec P1-1「公开选手页的 ScoreGauge 用 neutral」）。TierBadge、blurb、头像环色本期不动（第 8 节第 7 条）。
- **案件聚焦（移动，不是复制）**：`focusRecordId !== null` 时，被聚焦的记录取 `data.records.find(r => r.id === focusRecordId)`，找不到再用 `pinnedRecord`（id 必须等于 `focusRecordId`）；它渲染在头部之后、「分数走势」之前的 `<section className="pd__section pd__pinned" aria-label="你点开的这一起">` 里，上面一行 eyebrow `<p className="pd__pinned-eyebrow">`：能看私密部分的人（`record.pending_hidden !== true`）是「案件 #N · {violationLabel(type)} · {CASE_STATUS_LABEL[status]}」（`decided` 的标签是空串，此时省掉最后一段和它前面的「 · 」），其他人是「案件 #N · 处理中」；下面是 `VerdictCard focused`（保留 `id="case-N"`、`vc--focus`、`tabIndex=-1`）。下方「案件 N」列表**跳过**这一条，全页只有一个 `id="case-N"`；列表标题和计数（`data.records.length`）不变。三种形态都这么做（`p8-app.test.tsx:146-157` 用的 center 形态也受益）。
- **焦点**：有 `focusRecordId` 并且置顶卡已渲染 → `scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })` + `focus({ preventScroll: true })`，只做一次（沿用现有 `focused` ref，但要等置顶卡真正出现再置位）；两处都找不到 → 不滚动、不报错（CONTRACT「else the page opens unscrolled」）。没有 `focusRecordId` 的 page 形态 → 首次加载完把焦点移到 `h2#player-detail-title`（给它加 `tabIndex={-1}`）。
- **PlayerDetail 内部不新增任何请求**（`player-judge.test.tsx:183-193` 锁「PlayerDetail 不新增 GET」）。`GET /api/records/:id` 只发生在 `RouteView`/`useEntryTarget` 里。
- `StatementDialog` 在 P1 仍是叠在选手页上的 center 弹窗（`App.tsx` 原来「先关 PlayerDetail 再开说明框」的替换改成：只 `setStatementCase(record)`，不关选手页）；判完 `onDecided` 时 App 让 `playerRefreshKey` +1。跳到 `/cases/:id/statement` 是 P4-2 的事。

**`Modal`**（P1-2 加，只有这一个新 prop）

```ts
historyKey?: string;   // 设了就进 history：打开时压一条 {edg, idx+1, sheet: historyKey, layer}，同一地址
```

- 只对 `center`/`sheet`/`drawer` 生效；`page` 忽略它。没设 `historyKey` 时行为与今天完全一致（`modal-focus`、`modal-stack` 原样通过）。
- **打开**：`pushLayerEntry(historyKey, onPop)`。
- **用户按返回键（popstate 离开这条）**：路由只对浮层栈的**栈顶**调用 `onPop`，`onPop` 调 `onCloseRef.current()`（也就是调用方的 `onClose`，有离开确认的调用方会在这里弹确认）。如果调用方没有真的关闭（比如 `useLeaveGuard` 拦下了），就**重新压一条**，保证下一次返回键仍然先作用在这个浮层上。实现上不靠微任务探测：`useHistoryLayer` 的 `onPop` 先 `setPops(n + 1)` 再调 `onClose`，两次更新同批提交——关了就不再压，没关就因 `pops` 变化重新压（`plan-P1-2.md`「对契约的补充」第 1 条）。一次返回跳过多条时（长按返回菜单），`layer` 大于新条目 `layer` 的浮层从上到下依次 `onPop`。
- **界面关闭（✕、Esc、点背景、调用方自己的按钮）**：`onClose` **照旧同步调用**；浮层随 `open=false` 或卸载失活时，如果当前条目还是它的 `layer`，调 `dropLayerEntry(id)` 做一次**静默后退**（`history.go(-n)`，一次退掉栈顶所有已关闭浮层的条目；它引发的 popstate 不关任何浮层）。静默后退在途时，所有 history 写操作（`navigate`、`goBack`、压新浮层条目、再一次静默后退）都排进同一个队列，落地（或 `SILENT_BACK_TIMEOUT_MS` 超时）后按顺序执行。这和 spec「关闭按钮调用 history.back()」最终的历史栈完全一样，但关闭是同步的（第 8 节第 1 条）。
- StrictMode 的 mount → unmount → mount 只能留下一条 history 记录：失活时的 `dropLayerEntry` 推迟到微任务，同一实例马上重新激活就取消它、沿用原条目。
- 路由形态的抽屉（`/sessions/:id`、`/players/:id` 的 drawer）**不设** `historyKey`：它们本身就是一条地址，关闭走 `goBack()`。
- P1-2 给这些调用方加 `historyKey`：`RescheduleSheet` → `'reschedule'`、`AppealSheet` → `'appeal'`、`RollCallDialog` → `'rollcall'`、`CaseDialog` → `'case'`、`StatementDialog` → `'statement'`、`SessionFormDialog` → `'session-form'`、`OnboardingDialog` → `'onboarding'`、`AdminAiPanel` → `'admin-ai'`。

### 4.7 `PageBar`（P1-1，`src/components/PageBar.tsx` + `page-bar.css`，BEM `.pagebar`）

```ts
interface PageBarProps {
  backLabel: string;            // 按钮可见文字（P1 统一传「返回」）；可访问名就是它
  onBack: () => void;           // 调用方传 onClose，onClose 再调 goBack()
  title?: string;               // 只在页面滚走标题后提供上下文；渲染成 aria-hidden 的 <span>，不是标题
  actions?: React.ReactNode;    // 右侧操作（P3 的「分享」、P4 的「⋯」）；P1 不传
}
```

- DOM：`<div className="pagebar"><button type="button" className="pagebar__back" onClick={onBack}><span aria-hidden="true">‹</span> {backLabel}</button>{title && <span className="pagebar__title" aria-hidden="true">{title}</span>}{actions && <div className="pagebar__actions">{actions}</div>}</div>`。
- sticky（`position: sticky; top: 0`），按钮触控尺寸 ≥ `var(--tap-min)`；不放 heading，所以不增加 /约局/ 之类的标题匹配。
- 只在 page 形态出现；drawer 用 Modal 自带的 ✕。

### 4.8 `NotFound` 与文案（P1-1）

`src/components/NotFound.tsx` + `not-found.css`，BEM `.notfound`：

```ts
export interface NotFoundAction { readonly label: string; readonly to: string }
interface NotFoundProps {
  title: string;                              // 渲染成 <h2 id={headingId} className="notfound__title" tabIndex={-1}>
  headingId?: string;                         // 默认 'notfound-title'；在详情组件里传它们自己的 labelledBy
  actions?: readonly NotFoundAction[];        // 默认 [{ label: BACK_HOME, to: HOME_PATH }]，渲染成 <Link>
  autoFocus?: boolean;                        // 默认 true：挂载时把焦点移到标题
}
```

`src/lib/routeCopy.ts`（纯，所有文案逐字照抄）：

| 常量 | 文案 | 用在 |
|---|---|---|
| `NOT_FOUND_TITLE` | 这页不存在 | 未知路径 |
| `SESSION_NOT_FOUND` | 找不到这局，链接可能写错了。 | `/sessions/:id` 404 |
| `PLAYER_NOT_FOUND` | 找不到这位选手。 | `/players/:id` 404 |
| `CASE_GONE` | 链接里的案件不存在了。 | `/?case=N` 404（大厅上的 LinkMissingNotice，锁定 `deep-link:125`）、`/cases/:id` 和 `/players/:id/cases/:caseId` 404（NotFound） |
| `CASE_UNAVAILABLE` | 打不开链接里的案件，稍后再试。 | 同上的非 404 错误（锁定 `p8-app:115`） |
| `BACK_HOME` | 回大厅 | NotFound 默认操作 |
| `CASE_OPENING` | 正在打开案件… | `/cases/:id`、`/players/:id/cases/:caseId` 解析中（`role="status"`） |

App 原来写在 deep-link effect 里的两句字面量改为引用 `CASE_GONE`/`CASE_UNAVAILABLE`。「看约局历史」「看信誉榜」两个次要操作 P1 不放（第 8 节第 3 条）。

### 4.9 `RouteView`、入口目标与 App 接线（P1-1，P1-3 追加）

`src/components/RouteView.tsx`（`PinnedCase` 定义在 `src/lib/useCaseLookup.ts`，`RouteView.tsx` 用 `export type { PinnedCase }` 再导出——`src/lib` 里的 `useEntryTarget`、`useCaseLookup` 不反向依赖组件文件）：

```ts
export interface PinnedCase { readonly caseId: number; readonly record: RecordItem }   // 在 useCaseLookup.ts

interface RouteViewProps {
  location: RouterLocation;
  layout: RouteLayout;
  me: User | null;
  config: Config;
  pinned: PinnedCase | null;
  playerRefreshKey: number;
  onPinned: (pinned: PinnedCase) => void;     // /cases/:id 或 playerCase 直接打开时查到的记录交给 App 缓存
  onChanged: () => void;
  onOpenStatement: (record: RecordItem) => void;
  // P1-3：
  resume?: LoginIntent | null;
  onResumeDone?: () => void;
}
```

| 路由 | 手机（page） | 桌面（drawer） |
|---|---|---|
| `home` | 不渲染（大厅可见） | 同左 |
| `session` | `<SessionDetailDialog variant="page" onClose={() => goBack()} …>` | `variant="drawer"`，大厅留在底下 |
| `player` | `<PlayerDetail variant="page" onClose={() => goBack()} refreshKey …>` | `variant="drawer"` |
| `playerCase` | 先拿记录：`pinned?.caseId === caseId` 就直接用，否则 `useCaseLookup(caseId)` 发**一次** `GET /api/records/:caseId`；加载中 page 形态显示 `CASE_OPENING`，drawer 形态什么都不渲染；`record.subject.id !== userId` → `navigate(playerCasePath(record.subject.id, caseId) + search, { replace: true })`，不报错；404 → `NotFound(CASE_GONE)`，其他错误 → `NotFound(CASE_UNAVAILABLE)`；拿到后 `<PlayerDetail focusRecordId={caseId} pinnedRecord={record} …>` | 同左，形态 drawer |
| `case` | 同上查记录，查到后 `onPinned` + `navigate(playerCasePath(subject, caseId) + search, { replace: true })` | 同左（解析中用 page 容器显示 `CASE_OPENING`） |
| `notFound` | `<NotFound title={NOT_FOUND_TITLE} />` | 同左 |

- page 形态的输出包在 `<div className="app__page">` 里；drawer 由 Modal portal 出去。
- `useCaseLookup(caseId: number | null, seed: PinnedCase | null)`：返回 `{ status: 'idle' | 'loading' | 'ready' | 'missing' | 'error'; record: RecordItem | null }`；同一个 `caseId` 在一次挂载里只请求一次；`onChanged` 触发的刷新**不**重新请求（`p8-app.test.tsx:118-131` 锁定 `/api/records/7` 正好一次）。置顶卡的新鲜度由 PlayerDetail 优先取自己列表里的副本保证（4.6）。

**App 接线**：

```ts
const location = useLocation();                 // 以及首个 useState 初始化里 bootRouter()
const layout = useRouteLayout();
const covered = routeCoversHome(location.route, layout);
// <main className="app__main" hidden={covered}> … </main>
// <RouteView location={location} layout={layout} … />
// <footer className="app__footer" hidden={covered}> … </footer>
```

- 大厅在被页面盖住时**保持挂载、只加 `hidden`**（返回时不重拉、滚动位置能恢复）。`app.css` 末尾必须有 `.app__main[hidden], .app__footer[hidden] { display: none; }`，否则组件 CSS 的 `display` 会压过 UA 的 `[hidden]`。FAB「记一笔」不变（P3-2 删）。
- 打开详情一律导航：`openRoute(path) = navigate(path, { keepScroll: layout === 'drawer' })`。会话：`sessionPath(id)`；选手：`playerPath(id)`。
- `src/lib/useEntryTarget.ts`：

```ts
export type EntryTarget =
  | { readonly kind: 'path'; readonly path: string }                         // /?session=N → '/sessions/N' + 其余参数
  | { readonly kind: 'case'; readonly caseId: number; readonly rest: string }; // /?case=N

interface EntryTargetInput {
  readonly ready: boolean;            // 核心数据已就绪
  readonly me: User | null;
  readonly blocked: () => boolean;    // 在 effect 里现读：App 传 useCallback(() => onboardingOpen || onboardingAsked.current, [onboardingOpen])（首登引导优先）
  readonly onPinned: (pinned: PinnedCase) => void;
}
interface EntryTargetResult {
  readonly linkMissing: string | null;   // CASE_GONE / CASE_UNAVAILABLE，大厅顶部 LinkMissingNotice 用
  readonly dismissLinkMissing: () => void;
  // P1-3 追加（来自 useLoginResume）：
  readonly resume: LoginIntent | null;
  readonly clearResume: () => void;
}
export function useEntryTarget({ ready, blocked, onPinned }: EntryTargetInput): EntryTargetResult;   // P1-3 起解构里也取 me
```

  - `blocked` 必须是函数：首登对话框由 App 的 onboarding effect 在「数据就绪」那次提交里打开，同一次提交里渲染时算好的布尔值读不到刚置上的 `onboardingAsked.current`，深链会抢在首登之前打开（`p8-app.test.tsx`「waits for the first-run dialog」）。所以 `useEntryTarget(` 也必须写在两个 onboarding effect 之后。
  - 旧 `?case=` 的落地放在「`onPinned` 提交之后」的 effect 里 `navigate`（内部 `landing` state）：在 promise 回调里直接 `onPinned(); navigate()` 会让路由先以 `pinned === null` 渲染，`RouteView` 再请求一次 `/api/records/7`。

  - 挂载时（只在 `pathname === '/'`）：`readDeepLink(search)` 得到目标；把 `case`、`session`、以及值为 `discord` 的 `linked` 从地址里剥掉：`navigate('/' + withoutParams(search, 这些名字), { replace: true })`。**`onboarding` 留在地址里**（`discord-link.test.tsx:228-238` 断言剥完是 `?onboarding=1`），由原来的 onboarding effect 消费（改用 `navigate(…, { replace: true })`）。
  - 目标里的「其余参数」= `withoutParams(search, ['case', 'session', 'linked', 'onboarding'])`，比如 `?utm=dc`。
  - `ready && !blocked` 之后执行一次：`path` → `navigate(path)`（push）；`case` → `getRecord(caseId)`，成功 `onPinned({ caseId, record })` 再 `navigate(playerCasePath(record.subject.id, caseId) + rest)`（push）；404 → `linkMissing = CASE_GONE`，其他 → `CASE_UNAVAILABLE`，停在 `/`。非法 id 不发请求，参数照样剥掉。
  - 深链之前不发任何非 GET 请求（`deep-link.test.tsx:104`）。

### 4.10 B1-1：判决前脱敏的输出与前端处理

**后端 `redactRecord(record, viewer)`**（`worker/case-reads.ts`）：
- 条件：`!canReadPrivate(record, viewer)` **并且** `status` 是 `awaiting_statement` 或 `judging`。
- 满足时返回新对象：在今天的脱敏（`statement: null`、`appeal_reason: null`、判词置空）基础上，再置 `type: null`、`range: null`、`claim: null`、`claim_summary: null`、`note: null`、`escalation_suggested: false`，并加 `redacted: true`、`pending_hidden: true`。
- 保留：`id`、`subject`、`reporter`、`delta`（判决前本来就是 0，前端不显示它）、`classified_by`、`session_id`、**`statement_at`**、`deadline_at`、`status`、`verdict`（判决前是 null）、`created_at`。
- 其他所有情况：输出和今天**完全一样**，**不出现 `pending_hidden` 这个键**（`tests/unit/record-privacy.test.ts:78-80` 用 `toEqual({ ...record, redacted: false })`）。
- 输入对象不被修改（`:51-65` 冻结断言）。
- `worker/types.ts`：`RecordView` 改为两种形态的联合 `OpenRecordView | PendingHiddenRecordView`（前者带 `pending_hidden?: never`；后者 `type`、`range` 等为 `null`，字段名集合导出为 `PendingHiddenField`）；`worker/case-reads.ts` 另导出 `isPreVerdict(status)`。所有返回 `redactRecord(…)` 的路由照常通过 typecheck。bot 不受影响（`server/src/discord/verdict.ts` 只用 `canReadPrivate`；判决卡在 `case.decided` 之后才发）。
- 档位 (b) 的依据：spec §11 第 3 条；`note`（立案时写的短评）和 `range`（能反推案由）也一起隐藏是本契约的补充（第 8 节第 4 条）。

**前端类型**（`src/types.ts` 的 `RecordItem`）：

```ts
type: ViolationType | null;        // null 只出现在 pending_hidden 形态
range: SentencingRange | null;     // 同上
/** 判决前、无关的人看到的形态（B1-1）：类型、立案经过、短评、区间都被 API 隐藏。旧 API 没有这个字段。 */
pending_hidden?: boolean;
```

`claim`、`claim_summary`、`note` 本来就可空。

**`src/lib/recordView.ts`**（纯）：

```ts
export const PENDING_HIDDEN_LABEL = '处理中';
export const PENDING_HIDDEN_DELTA = '分数变化：判决后公开';
export function isPendingHidden(record: Pick<RecordItem, 'pending_hidden'>): boolean;
export function pendingHiddenSentence(username: string): string;   // `${username}有一起记录在处理中，判决后公开。`
export function violationDef(type: ViolationType | null): ViolationDef | undefined; // null 或未知类型 → undefined（VerdictCard 要 emoji 和 kind）
export function violationLabel(type: ViolationType | null): string; // null → '处理中'；否则 VIOLATION_MAP[type]?.label ?? type
```

**各组件怎么渲染**：

| 组件 | `pending_hidden` 时 |
|---|---|
| `VerdictCard` | `article` 的 `id="case-N"`、`tabIndex`、`vc vc--{status}`、`vc--focus` 都不变；emoji 用 `📝`；`h4.vc__type` 是「处理中」；meta 去掉案由和「AI 归类」，保留「裁判 X · 时间」；正文 `<p className="vc__hidden">{pendingHiddenSentence(subject)}</p>` 加 `<p className="vc__delta-hidden">分数变化：判决后公开</p>`；**`statement_at` 有值时照样显示「写了说明 · 只有当事人、立案人、裁判和管理员能看」**（今天的条件 `hidden && trial && statement_at` 改成 `hidden && (trial || pending_hidden) && statement_at`）；「等待 X 说明情况 · 还剩…」和「AI 正在裁决…」照常；不渲染立案经过、量刑尺、团灭提示；任何地方都不出现 `0`。 |
| `RecordsFeed` | 这一行只剩名字和「处理中」：emoji `•`，标签「处理中」，不显示 `claim_summary`，不显示状态 chip 和「待确认升级」chip。非脱敏行（含 `wording.test.tsx:66-71` 的「待说明」）不变。 |
| `CaseActions` | `range === null` 时不渲染改判表单（只有管理员能改判，管理员永远拿到完整记录，所以只是类型守卫）。 |
| `StatementDialog`、`AppealSheet`、`PendingBanner` | 只给当事人用，永远拿到完整记录；只做类型守卫（`violationLabel(type)`、`range && <SentencingScale …>`），文案不变。 |
| `PlayerDetail` 置顶卡 eyebrow（P1-1） | 「案件 #N · 处理中」，见 4.6。 |
| `WeekHighlights`/`weekStars`/`feedStats` | 不改（只统计已判决的记录；`type === 'on_time_bonus'` 对 null 天然为假）。`record-view.test.ts` 加一条断言锁住。 |

B1-1 不改 CONTRACT.md；P1-4 把「A pre-verdict case must never render its `delta` as `0` — show the pending range」补成「… show the pending range, or 判决后公开 when the API hid it (`pending_hidden`)」。

### 4.11 P1-3：`edg.return`、`LoginLink`、`ResumeHint`、访客报名

**storage**：`sessionStorage['edg.return']`（同一个标签页走完 OAuth 往返仍在；不跨标签页；`tests/dom/setup.ts` 每个测试后清掉 sessionStorage）。值是 JSON：

```ts
export interface LoginReturn {
  readonly v: 1;
  readonly path: string;          // pathname + search，不含 hash
  readonly savedAt: number;       // Date.now()
  readonly intent?: LoginIntent;
}
export type LoginIntent = { readonly kind: 'rsvp'; readonly sessionId: number; readonly rsvp: SelfRsvp };
// 例：{"v":1,"path":"/sessions/5","savedAt":1761500000000,"intent":{"kind":"rsvp","sessionId":5,"rsvp":"going"}}
```

`src/lib/loginReturnShape.ts`（纯，`login-return.test.ts` 测它）：

```ts
export const LOGIN_RETURN_KEY = 'edg.return';
export function serializeLoginReturn(path: string, intent: LoginIntent | undefined, now: number): string;
export function parseLoginReturn(raw: string | null, now: number): LoginReturn | null;
export function hasLegacyTarget(pathname: string, search: string): boolean;               // 这次启动是不是 /?case= /?session= 进来的
export function resumeRsvpFor(intent: LoginIntent | null | undefined, sessionId: number): SelfRsvp | null;
```

`parseLoginReturn` 规则：JSON 解析失败 → null；`v !== 1` → null；`path` 必须是字符串、长度 ≤ `RETURN_PATH_MAX`（512）、以 `/` 开头、不以 `//` 开头、不含 `\`、不含 `#`、`isAppPath(pathname)` 为真、`parseRoute(pathname)` 不是 `home` 也不是 `notFound`；`savedAt` 必须是有限数并且 `0 ≤ now − savedAt ≤ LOGIN_RETURN_TTL_MS`（30 分钟）；`intent` 不合法（`kind` 不对、`rsvp` 不在 `SELF_RSVPS`、`sessionId` 和 `path` 解析出的 `session` 路由对不上）时**只丢 intent**，保留 path。

`src/lib/loginReturn.ts`（DOM）：

```ts
export function saveLoginReturn(intent?: LoginIntent, returnTo?: string): boolean;  // returnTo 默认 router 的 currentPath()；过不了 parseLoginReturn 的（'/'、未知路径）就删掉旧值、返回 true；storage 不可用返回 false
export function takeLoginReturn(now?: number): LoginReturn | null;  // 读、校验、并且总是删掉
export function clearLoginReturn(): void;
```

**消费**（新 hook `src/lib/useLoginResume.ts`，`useEntryTarget` 第一行调用 `useLoginResume({ ready, me, isBlocked: blocked })`）：`ready && me !== null && !isBlocked()` 并且地址里已经没有 `?onboarding=1`，并且这次启动没有旧深链目标时，`takeLoginReturn()`；有值且 `path` 和当前地址不同 → `navigate(path)`（push）；`intent` 存进 `resume`，经 `RouteView` 传给 `SessionDetailDialog.resumeRsvp`（只在当前路由是同一个 `sessionId` 时）。访客（`me === null`）不读不删，靠 TTL 过期。旧深链（`?case`/`?session`）优先于登录回跳，有旧深链时登录回跳的值直接丢掉（`hasLegacyTarget` 在首次渲染时判断）。到过那一局又离开之后 `resume` 清空，不再重复提示。退出登录时 `clearLoginReturn()`。

**`LoginLink`**（`src/components/LoginLink.tsx`）：

```ts
interface LoginLinkProps {
  className?: string;
  href?: string;              // 默认 AUTH_LOGIN_URL
  intent?: LoginIntent;
  returnTo?: string;          // 默认当前页；大厅约局行的「登录后报名」传 sessionPath(id)
  ariaLabel?: string;         // 列表里每行一个时让名字不重复：「登录后报名 周五五排」
  children: React.ReactNode;
}
```

渲染 `<a className href aria-label onClick={() => saveLoginReturn(intent, returnTo)}>`，**不**调用 `preventDefault`（登录仍是顶层整页跳转，`analysis §6` 约束）。Header 的「登录」、WelcomeCard 的「用 Nanako 账号登录」（`href` 仍是 `loginUrl`，`board.test.tsx:286` 断言 `href="/auth/login"`）、访客报名区、大厅约局行（`SessionsPanel` 的 `.srow__login`「登录后报名」，只给访客、只在没开始的 open 局上）都用它。

**`ResumeHint`**（`src/components/ResumeHint.tsx` + `resume-hint.css`，BEM `.resume-hint`）：

```ts
interface ResumeHintProps {
  rsvp: SelfRsvp;
  onDismiss: () => void;      // 按钮文字「不用了」
}
```

- DOM：`<div className="resume-hint" role="status"><p id={RESUME_HINT_TEXT_ID} className="resume-hint__text">你登录前点的是「{RSVP_LABEL[rsvp]}」，确认一下？</p><button type="button" className="btn btn--ghost btn--sm" onClick={onDismiss}>不用了</button></div>`，紧挨在 `RsvpControls` 上方。
- `RsvpControls` 加可选 `suggested?: SelfRsvp`：对应按钮多一个类 `sdt__rsvp-btn--suggested`（金色描边；选中态仍只靠 `aria-pressed`），可访问名不变（还是「来」「待定」「不来」），被圈的按钮 `aria-describedby` 指向提问（`ResumeHint.tsx` 导出 `RESUME_HINT_TEXT_ID = 'resume-hint-text'`，和满员说明的 id 可以并存）。点「不用了」后焦点移到局标题。**再点一次才提交**，提交走原来的 `answer`，成功或失败后都调 `onResumeDone`。
- 只在 `canRsvp` 为真、并且 `session.my_rsvp !== resumeRsvp` 时显示；否则直接 `onResumeDone()`。**绝不自动发 POST**（`login-return.test.tsx` 断言全程没有非 GET 请求）。

**`VisitorRsvpPrompt`**（`src/components/VisitorRsvpPrompt.tsx` + `visitor-rsvp.css`，BEM `.vrp`）：

```ts
interface VisitorRsvpPromptProps { sessionId: number }
```

- 在 `SessionDetailDialog` 里，`me === null && session.status === 'open' && !started` 时替代 `RsvpControls`。
- DOM：`<div className="vrp" role="group" aria-label="登录后报名">`，一句「登录后就能回『来 / 待定 / 不来』，没绑 Discord 也行。」，可见标签「登录后报名：」（`aria-hidden`，group 已有名字），三个 `LoginLink`（文字「来」「待定」「不来」，各带 `intent: { kind: 'rsvp', sessionId, rsvp }`），以及一个 `LoginLink`「用 Nanako 账号登录」（不带 intent）。
- 每个面板仍然只有一个「来」（角色是 link）；登录用户看不到这块，`session-rsvp-moved` 不受影响。

### 4.12 `src/lib/constants.ts` 的 P1 小节

```ts
// --- P1-1 ---
/** The one breakpoint JS needs: page vs drawer for /sessions/:id and /players/:id. Same as the CSS (min-width: 1024px). */
export const DESKTOP_MEDIA_QUERY = '(min-width: 1024px)';
/** /players/:id — OAuth subjects are free-form; anything longer is not one of ours. */
export const USER_ID_MAX = 128;

// --- P1-2 ---
/** An overlay's silent step back whose popstate never arrives stops holding navigations after this long. */
export const SILENT_BACK_TIMEOUT_MS = 1_000;
/** The `sheet` mark on an overlay's history entry (its historyKey), kept short. */
export const HISTORY_SHEET_NAME_MAX = 32;
// （注释措辞是定稿：source-hygiene 的 history API 扫描连注释也扫，旧稿里的 `history.back()`、`history.state.sheet` 字样会让它失败。）

// --- P1-3 ---
/** edg.return older than this is ignored: a login that took longer is not the same visit. */
export const LOGIN_RETURN_TTL_MS = 30 * 60 * 1000;
/** edg.return.path upper bound. */
export const RETURN_PATH_MAX = 512;
```

### 4.13 新分配的 BEM 前缀与类名

`.pagebar`（含 `__back`、`__title`、`__actions`）、`.notfound`（含 `__title`、`__actions`）、`.app__page`（含 `.app__page-status`）、`.pd__pinned`（含 `.pd__pinned-eyebrow`）、`.vc__delta-hidden`、`.vrp`（含 `__line`、`__choices`、`__label`、`__choice`、`__login`）、`.resume-hint`（含 `__text`）、`.sdt__rsvp-btn--suggested`、`.srow__login`（P1-3）。`page-bar.css` 另有一条跨块规则 `.hdr:has(.hdr__dropdown) { z-index: 42; }`（账号菜单盖住 PageBar，`plan-P1-1.md` 补充第 9 条）。全部新 CSS 都要过 `tests/unit/css-conventions.test.ts`（四种断点写法、hover 包在 `@media (hover: hover)`、不写 `outline: none`、红字用 `var(--danger-text)`、表单边框用 `var(--border-input)`、coarse 触控尺寸重申）。不往 `theme.css` 加 token。

## 5. 各 PR 的验收要点（摘要，细节在各计划）

- **P1-0**：`npm run build:pages` 在 `dist/404.html` 存在时失败、不存在时通过（`pages-headers.test.ts` 追加：在临时目录放一个 `404.html` 跑脚本，断言非零退出，且错误信息含「404.html」）；CSP 断言一个字不改。`split-deploy.test.ts` 追加「`/sessions/5?x=1` 的 302 Location 是 `${SPA}/sessions/5?x=1`」（另加编码过的选手 id 一例），`node-api.test.ts` 追加同一条走 Node 包装的生产路径。实测并写进 `docs/DEPLOY-PAGES.md`「SPA 回退核验（P1-0）」：`curl -sI https://community.nanako.org/sessions/1`（期望 200、`text/html`）、`curl -sI https://community.nanako.org/players/x/cases/1`（200）、`curl -s https://capi.nanako.org/api/config`（200 JSON）、`curl -sI https://capi.nanako.org/sessions/1`（Node 端配了 `FRONTEND_URL` 时期望 302 到 `community.nanako.org/sessions/1`，否则 404 JSON，如实记录）。只发 GET。删除 `functions/` 要等机主合并并重新部署 Pages 才生效，记录里写明「部署后复测 `/api/config` 在 community 域名上应返回 SPA 的 index.html 而不是反代」。
- **B1-1**：worker 全量（15 个文件）、unit、dom 都过；新增：判决前（`awaiting_statement`、`judging`）对访客和无关登录用户在每条路由（`/api/records`、`/api/records/:id`、`/api/users/:id`、`/api/sessions/:id`）都隐藏 `type`/`range`/`claim`/`claim_summary`/`note` 且 `escalation_suggested: false`、`pending_hidden: true`；`statement_at` 保留；当事人、立案人、裁判、管理员原样；判决后（`decided`/`appealed`/`revoked`/`withdrawn`）不受影响；VerdictCard 的「有一起记录在处理中」「分数变化：判决后公开」「写了说明」、不出现 0；RecordsFeed 行只剩名字和「处理中」。PG 套件交给 CI。
- **P1-1**：`route.test.ts` 覆盖非法 id、未知路径、`/api`、`/auth`、`/link` 前缀不被接管、末尾斜杠、用户 id 编码与上限、`routeCoversHome`、`DESKTOP_MEDIA_QUERY` 合法；`router.test.tsx` 覆盖 `Link` 点击（修饰键放行）、`navigate` push/replace/重复不压、只改 hash 的 popstate 被忽略、`goBack` 在 idx 0 时退回 fallback；`route-pages.test.tsx` 覆盖未知路径的 NotFound、session/player 404 文案、桌面抽屉 vs 手机页面、两个 id 对不上时 `replaceState` 纠正、`/cases/:id` 别名、置顶是移动（全页一个 `#case-7`）、公开选手页 ScoreGauge 不念段位。`deep-link`/`p8-app` 原断言全过，追加 `pathname` 断言。
- **P1-2**：`back-closes-layer.test.tsx` 覆盖：返回键关 sheet（只关栈顶）；sheet 叠在抽屉/页面上时第一次返回只关 sheet、第二次才离开路由；有离开确认的浮层被返回键触发确认、选「继续写」后再按返回仍作用在浮层上；界面关闭后历史栈长度回到打开前；直接打开 `/sessions/5`（state 为 null）只垫一次 `/`，`simulateReloadForTests()` 再挂载后 `history.length` 不变；带 `sheet` 的 state 刷新后浮层不重开且 `sheet` 被去掉；StrictMode 下打开一次只多一条记录；返回 `/` 后滚动位置恢复（`window.scrollTo` 被以保存的 `y` 调用）。`organizer-actions:212-220`、`appeal-sheet:140-167`、`drafts` 的 Esc 用例、`modal-focus`、`modal-stack` 原样通过。
- **P1-3**：`login-return.test.ts` 覆盖 `parseLoginReturn` 的每条拒绝规则和 intent 只丢不连坐；`login-return.test.tsx`：访客在 `/sessions/5` 点「来」（阻止 jsdom 真跳转）→ storage 里有正确的 JSON → 模拟回调落在 `/` 且已登录 → 地址回到 `/sessions/5`、出现「你登录前点的是「来」，确认一下？」、「来」带 `sdt__rsvp-btn--suggested`、**全程没有任何非 GET 请求**；过期或被篡改的值不跳转；退出登录清掉它；有 `?case=` 时旧深链优先；访客在大厅约局行点「登录后报名」写下 `/sessions/N`（不带 intent）。
- **P1-4**：CONTRACT.md 410-417 的措辞改成「参数被翻译成该视图自己的地址」，并原样保留「Only a positive integer id is read」「A link never writes」两句；补 `pending_hidden` 那条；新增路由表、`edg.return`、浮层与返回键的说明。README 新增「路由」一节（spec §2.2 的表，标明 P1 已有的五条和后续阶段的）。`docs/CONTRACT.md` 的 `interface RecordItem` 同步 B1-1（`type`/`range` 可空、`pending_hidden?: true`）。写好 `docs/redesign-v5/p1-acceptance.md`（M-01～M-30、D-01～D-08、H-01～H-02、R-01～R-13）。

## 6. 测试约定

### 6.1 地址与 history

- dom 测试在 `render` **之前**用 `window.history.replaceState(state, '', url)` 设地址，和现有测试一致。
  - `state` 传 `null` = 「新开的标签页 / 外部链接进来」：P1-1 起路由会盖章，P1-2 起非 `/` 的地址会垫一条 `/`。
  - 要模拟「站内跳转后的条目」或「刷新」，传 `{ edg: 1, idx: 1 }`（P1-2 起可带 `sheet`、`layer`、`y`）。
- 测试里不调用 `window.location.assign` 或给 `location.href` 赋值（jsdom 不支持跨文档导航）。要点 `LoginLink` 时，在 `document` 上挂一个冒泡阶段的 `click` 监听，对 `a[href]` 调 `preventDefault()`（React 的处理器在根节点上先跑，`saveLoginReturn` 照常执行）。辅助函数放在 `tests/dom/history.ts` 的 `preventNavigation(): () => void`（返回卸载函数）。
- jsdom 的 `history.back()` 要过**两个宏任务**才触发 popstate。等它用 `await waitFor(…)` 或 `await drainHistoryTraversals()`（`tests/dom/history.ts`，循环 3 次 `await new Promise(r => setTimeout(r, 0))`）。用 fake timers 的测试要在等 history 之前切回真定时器。
- 模拟刷新：`unmount()` → `simulateReloadForTests()` → 再 `render(<App />)`。模拟 OAuth 回来：`unmount()` → `resetRouterForTests()`（地址回到 `/`、state 为 null）→ 按需 `replaceState(null, '', '/?onboarding=1')` → 改 fetch 桩让 `/api/me` 返回已登录 → `render(<App />)`。注意 `resetRouterForTests` 不清 sessionStorage。
- 断言地址用 `window.location.pathname` / `window.location.search`，断言状态用 `history.state`（只看 `edg`、`sheet`、`layer`，不要断言具体的 `idx` 数值，除了专门测 idx 的用例）。

### 6.2 视口

- 默认没有 `window.matchMedia` → 手机形态（page）。要测桌面抽屉，调 `tests/dom/viewport.ts` 的 `useDesktopViewport()`：用 `Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value })` 装一个桩，**只对 `DESKTOP_MEDIA_QUERY` 返回 `matches: true`**，其他查询（比如 `prefers-reduced-motion`）返回 false；提供 `addEventListener`/`removeEventListener`/`addListener`/`removeListener` 空实现。
- `tests/dom/setup.ts` 的 `afterEach` 负责删掉它（`delete (window as { matchMedia?: unknown }).matchMedia`），测试文件不用自己清。

### 6.3 `tests/dom/setup.ts` 的最终形态（P1-2 之后）

```ts
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { resetModalStackForTests } from '../../src/lib/modalStack';
import { resetRouterForTests } from '../../src/lib/router';
import { drainHistoryTraversals } from './history';

// P1-1: jsdom does not implement scrolling; the router scrolls to the top on push.
window.scrollTo = () => {};

afterEach(async () => {
  // Runs after Testing Library's own cleanup has unmounted everything (hooks run in stack order).
  // P1-2: an overlay that closed on unmount went back one entry; let jsdom finish that first.
  await drainHistoryTraversals();
  resetModalStackForTests();
  // P1-1: subscribers, snapshot, overlay entries, queued navigations; then history.replaceState(null, '', '/').
  resetRouterForTests();
  // P0-5: drafts live in storage — one test's draft must never restore in the next. (Also clears edg.return, P1-3.)
  window.localStorage.clear();
  window.sessionStorage.clear();
  // P1-1: a test that stubbed a desktop viewport must not leave it behind.
  delete (window as { matchMedia?: unknown }).matchMedia;
});
```

P1-1 写的是同步版本（没有 drain 那两行）；P1-2 加上 `async` 和 drain。`window.scrollTo` 这一行若与 `tsconfig.json` 的 DOM 类型冲突，用 `Object.defineProperty`。

### 6.4 请求与噪音

- 大厅（`/`）的首屏请求 URL 集合一个不改（`app-refresh.test.tsx:145`、`:391`）。路由、页面形态、登录回跳都不新增首屏请求。`GET /api/records/:id` 只在旧 `?case=`、`/cases/:id`、`/players/:id/cases/:caseId` 时发，每次导航最多一次。
- 不得新增 React `act(...)` 警告（基线只有 `onboarding-roles` 的 3 条）。history 的异步 popstate 引起的重渲染要落在测试的 `await waitFor`/`findBy` 里；收尾时跑一遍完整 dom 套件，对照警告条数。
- 不写 `console.log`；jsdom 的 "Not implemented" 也算噪音（`scrollTo` 已在 setup 里处理）。

### 6.5 source-hygiene 追加（P1-1）

`tests/unit/source-hygiene.test.ts` 末尾追加一个 `describe('history API')`：扫描 `src/**/*.{ts,tsx}`，除 `src/lib/router.ts` 外，不得出现 `history.pushState`、`history.replaceState`、`history.back(`、`history.go(`、`history.forward(`、`history.state`。扫描是纯文本，**注释也算**（所以 `routes.ts`、`constants.ts` P1-2 小节、`Modal.tsx`、`useHistoryLayer.ts` 的注释都避开这些字样）。（测试文件不扫。）

## 7. 风险：现有测试锁住、P1 会碰到的东西

行号指规划副本。原有断言一律不改，只允许在原用例里**追加**断言。

| 位置 | 锁住了什么 | 谁要小心、怎么保持 |
|---|---|---|
| `tests/dom/deep-link.test.tsx:88-91` | `afterEach` 里 `replaceState(null, '', '/')` | 路由快照按地址键重算（4.2），不缓存旧地址 |
| `tests/dom/deep-link.test.tsx:94-105` | `/?case=7&utm=dc`：heading「选手」；`document.activeElement` 是 `#case-7`；它有 `vc--focus`，`#case-6` 没有；`search === '?utm=dc'`；没有非 GET 请求 | P1-1：落到 `/players/p/cases/7?utm=dc`（page 形态），置顶移动不复制；追加 `pathname` 和「全页一个 `#case-7`」断言 |
| `tests/dom/deep-link.test.tsx:107-119` | 非法 id（同一个测试里循环 6 次 render/unmount，中间不跑 afterEach）：有唯一的 /约局/ heading；不请求 `/api/records/`；没有「选手」；`search === ''` | P1-1：每次 render 都重新 `bootRouter`、重新读地址；大厅在 `/` 不能被 `hidden` |
| `tests/dom/deep-link.test.tsx:121-127` | 404 → 大厅上出现「链接里的案件不存在了。」，没有「选手」 | 旧深链失败停在 `/`，用 LinkMissingNotice，不用 NotFound |
| `tests/dom/deep-link.test.tsx:129-135` | `/?session=3` → 请求 `/api/sessions/3`；`search === ''` | 追加 `pathname === '/sessions/3'` |
| `tests/dom/p8-app.test.tsx:105-108`、`:111-116` | afterEach；500 → 「打不开链接里的案件，稍后再试。」 | 同上 |
| `tests/dom/p8-app.test.tsx:118-131` | 管理员改分后 `/api/records?limit=50` 请求 > 1 次，`/api/records/7` **正好 1 次** | 置顶卡用解析时的记录；`onChanged` 不触发重新查找；PlayerDetail 优先用自己列表的副本 |
| `tests/dom/p8-app.test.tsx:133-144` | `/?onboarding=1&case=7`：先首登对话框，Esc 之后才出现「选手」 | P1-1：`blocked` 门控；P1-2：OnboardingDialog 有 `historyKey`，Esc 的静默后退期间导航要排队（4.2 第 3 步） |
| `tests/dom/p8-app.test.tsx:146-157` | 单独渲染 `PlayerDetail`（center）+ `focusRecordId` → 焦点 `#case-7`、`block: 'center'` | 默认 `variant` 仍是 center；置顶逻辑在 center 也成立 |
| `tests/dom/discord-link.test.tsx:223-225`、`:228-238` | 访客 `/?linked=discord&onboarding=1` → 剥完是 `?onboarding=1`；「关闭提示」 | `useEntryTarget` 只剥 `linked`/`case`/`session`，留下 `onboarding` |
| `tests/dom/discord-link.test.tsx:240-246`、`:266-280` | 无参数时有 /约局/ heading；`?linked=discord` 再问首登；已选身份不再问 | onboarding effect 只把 `replaceState(null…)` 换成 `navigate(…, {replace:true})` |
| `tests/dom/app-refresh.test.tsx:121-123`、`:145`、`:245`、`:391` | 首屏 URL 集合；可见性刷新包括 sessions、不含 config | 路由不加请求；大厅被盖住时保持挂载 |
| `tests/dom/board.test.tsx:73-75`、`:393-401`、`:422-430` | 唯一的 /约局/ heading；访客页上没有 `.tier-badge`、没有「鸽王」 | PageBar/NotFound 不加匹配 /约局/ 的标题；大厅在 `/` 不加东西 |
| `tests/dom/board.test.tsx:278-287` | `WelcomeCard` 的登录链接 `href="/auth/login"`、名字「用 Nanako 账号登录」 | P1-3 换成 `LoginLink` 时 `href={loginUrl}`、文字、类名不变 |
| `tests/dom/my-score-line.test.tsx:118-121`、`:123-145` | DOM 顺序：MyScoreLine 在 /约局/ 之前 | `RouteView` 插在 `</main>` 之后，不动 main 内部顺序 |
| `tests/dom/organizer-actions.test.tsx:212-220` | 改时间 sheet 上按 Esc **同步**关掉 sheet，详情弹窗还在 | P1-2：`onClose` 同步调用，history 只在失活时静默后退（第 8 节第 1 条） |
| `tests/dom/organizer-actions.test.tsx:244-247`、`:318` | 改完 `waitFor` sheet 消失；取消后焦点在标题「周五五排」 | 默认 center 不变 |
| `tests/dom/appeal-sheet.test.tsx:140-154`、`:157-167` | Esc 先弹离开确认、焦点在「继续写」、`onClose` 未调用；确认层上 Esc 只退出确认 | P1-2：返回键走同一个 `onClose`，被拦下时重新压条目 |
| `tests/dom/appeal-sheet.test.tsx:226-231`、`:248`、`:254`、`:278` | 申诉成功后 sheet 关闭；单独渲染 PlayerDetail 的 heading「选手」 | 同上；PlayerDetail 默认 center |
| `tests/dom/drafts.test.tsx:215-226`、`:367-370`、`:451` | StatementDialog、SessionFormDialog、RollCallDialog 的 Esc + 离开确认 | 同 appeal-sheet |
| `tests/dom/player-judge.test.tsx:183-193` | 「取消」在 PlayerDetail 里唯一；PlayerDetail 不新增 GET | PageBar 的按钮叫「返回」；置顶记录的请求不在 PlayerDetail 里 |
| `tests/dom/session-rsvp-moved.test.tsx:72-81`、`:83-90` | 详情面板、列表面板各只有一个「来」；409 的 alert 原文 | P1-3：登录用户看不到访客区；ResumeHint 不加按钮「来」 |
| `tests/dom/modal-focus.test.tsx:63-75`、`:77-86` | 每个打开的 Modal 只装一次 document keydown 监听；Esc 同步调用最新的 onClose | P1-2 不加 document/window 监听，`historyKey` 缺省时行为不变 |
| `tests/dom/modal-stack.test.tsx:235`、`:401-437`、`:439` | StrictMode 一次打开一层；page 形态不 portal、不 inert、不困焦点、Esc 不关；page 上的 center 仍 inert | P1-1 不改 Modal；P1-2 的 StrictMode 处理见 4.6 |
| `tests/dom/verdict-privacy.test.tsx:43-64` | 「写了说明」、不写「缺席」、不显示申诉理由、「该选手已申诉」 | B1-1 只追加；`pending_hidden` 形态同样显示「写了说明」 |
| `tests/dom/wording.test.tsx:66-71`、`:91-98` | feed 里的「待说明」；说明框的隐私文案 | B1-1 只在 `pending_hidden` 行去掉状态 chip |
| `tests/unit/record-privacy.test.ts:50-80` | 冻结输入；`toMatchObject` 的公开字段；`toEqual({ ...record, redacted: false })` | 非脱敏输出不出现 `pending_hidden` 键 |
| `tests/worker/record-privacy.test.ts:60-84`、`:86-95`、`:103-118` | `appealed` 记录对访客公开 `type`/`claim`/`delta`；有权的人看全；一个列表里逐条判断 | 只对 `awaiting_statement`/`judging` 生效 |
| `tests/worker/split-deploy.test.ts:89-112` | 旧主机 302 保留 path 和 query、`no-store`；API/OAuth 不受影响 | P1-0 只追加 |
| `tests/unit/pages-headers.test.ts:32-55` | CSP 逐字 | P1-0 的 404 检查不改 `buildHeaders` 的输出 |
| `tests/unit/deep-link.test.ts` | `readDeepLink`、`withoutParams` | P1-1 只导出 `ID_PATTERN`，不改行为 |
| `tests/unit/css-conventions.test.ts`、`tests/unit/source-hygiene.test.ts` | 全部 CSS 的约定；源码卫生 | 新 CSS 照规则写；P1-1 追加 history API 断言 |
| `tests/pg/*`（本地不跑） | bot 文案、DM、导入 | B1-1 不碰 bot；合并前看 CI |

## 8. 对 spec 的偏离与补充（请机主过目，写进对应 PR 描述）

1. **界面关闭浮层是「同步 onClose + 失活时静默后退」，不是「先 history.back()，popstate 再关」**（P1-2）。最终的历史栈一样，但 `organizer-actions:218-219`、`appeal-sheet:146-153`、`modal-focus:77-86` 都要求关闭是同步的。
2. **`history.state` 多了 `idx`、`layer`、`y`**（P1-1、P1-2）。`idx` 让「返回」知道身后有没有站内条目（没有就 replace 到 `/`）；`layer` 让返回键能对上具体浮层；`y` 用于滚动恢复。判断标记仍只看 `edg === 1`。
3. **404 页的次要操作「看约局历史」「看信誉榜」推迟到 P3-6**：`/sessions/history`、`/board` 在 P1 还不存在。P1 只放「回大厅」。
4. **B1-1 额外隐藏 `note` 和 `range`**：`note` 是立案时写的短评，本身就是指控的一部分；`range` 由案由决定，能反推类型（spec §3.8 也写了「区间」由 redactRecord 隐藏）。`type` 和 `range` 因此在前端可空。
5. **旧深链参数只在 `pathname === '/'` 时消费**：bot、OAuth 回调、绑定回跳都落在 `/`；深层地址上的同名参数不再有特殊含义。`?onboarding=1` 仍在任何路径上生效。
6. **页面形态时大厅保持挂载、只加 `hidden`**：返回大厅不重拉、滚动能恢复。代价是被盖住时大厅的定时刷新照常跑。
7. **选手页的 TierBadge、blurb、头像环色本期不改**：P1-1 只按 spec 把公开 ScoreGauge 改成 neutral；「段位只给本人看」在选手页的完整落地（selfHint 等）是 P4-1。
8. **说明框在 P1 仍叠在选手页上**，不跳 `/cases/:id/statement`（P4-2 才有那个页面）。
9. **JS 里出现一处断点 `DESKTOP_MEDIA_QUERY`**：P0 契约说「断点只写在 CSS 里」，但 page 和 drawer 的语义不同（inert、焦点陷阱），只能在 JS 里分支。值和 CSS 一致并有断言。
10. **访客的报名区是三个「先登录」链接**（P1-3）：spec 的 ResumeHint 要求「你登录前点的是『来』」，所以访客必须有地方点「来」；点了记下意图再去登录，回来只提示、不提交。
11. **PageBar 的返回按钮统一叫「返回」**：spec 线框里约局页写的是「‹ 大厅」，但返回走真实 history，不一定回大厅。
12. **`edg.return` 用 sessionStorage，30 分钟有效**（spec §4.1 写的是 15 分钟）：只服务同一个标签页的登录往返，不跨标签页、不长期留存。要回到 15 分钟只改 `LOGIN_RETURN_TTL_MS` 一个常量。
13. **`EntryTargetInput.blocked` 是 `() => boolean`**（P1-1）：布尔值在同一次提交里读不到 onboarding effect 刚置上的标记，见 4.9。
14. **大厅约局行也有「登录后报名」**（P1-3 改 `SessionsPanel.tsx`、`sessions-panel.css`）：spec §3.1 线框在约局卡片上画了「[登录后报名] ← 点击后记下回跳意图」。它回跳到 `/sessions/:id`、不带 intent（回来不提示）；登录用户看不到。P3 换成 SessionCard 时跟着迁过去。为此 `saveLoginReturn`/`LoginLink` 多了可选的 `returnTo`（和 `ariaLabel`）。
15. **`?linked=discord` 那条「去设置私信 ›」链接推迟到 P4**（P1-1）：它指向 P4 才有的 `/me/notify`，P1 里那是 NotFound；`DiscordLinkedNotice` 原样不动。
16. **P1-2 的 popstate 监听、静默后退和写队列比 4.2 原稿更宽**：有打开的浮层或静默后退在途时也装监听；静默后退用 `history.go(-n)`；队列覆盖所有 history 写操作（见 4.2、4.6 和 `plan-P1-2.md`「对契约的补充」）。
17. **验收清单比第 9 节多出的步骤**（P1-4）：P1-1、P1-2、P1-3 计划里的手动检查项收进清单（M-24 的「返回后再进不再提示」、M-26～M-30、D-08），领队只按清单做一遍。

## 9. P1-5 实机验收（领队执行）

代理没法拿真机，所以 P1-5 是**一份书面清单 + 浏览器模拟步骤**，由领队（机主或主会话）执行。清单由 P1-4 写进 `docs/redesign-v5/p1-acceptance.md`，结构固定为：

1. **环境**：预览或生产地址、设备与浏览器版本、日期、执行人。
2. **浏览器模拟（先做）**：Chrome DevTools 设备模式（或内置浏览器的 mobile 预设）375×812、DPR 3、触控；以及 1280×800 桌面。每一步写「操作 → 期望」：
   - 大厅点一局 → 地址变 `/sessions/N`，页面形态，PageBar「‹ 返回」；返回键 → 回到大厅且滚动位置还在。
   - 详情里打开「改时间」sheet → 返回键只关 sheet；再按一次 → 回大厅。
   - 填了一半的申诉 → 返回键 → 出现离开确认；「继续写」后再按返回 → 仍是离开确认，不会离开页面。
   - 新标签页直接打开 `/sessions/N` → 返回键回到大厅（垫了一条 `/`），再按一次才离开站点；在 `/sessions/N` 刷新 3 次后，返回键仍然只需要一次就到大厅。
   - 开着 sheet 刷新 → sheet 不重开；按一次返回页面看起来没变（已知代价）。
   - `/?case=N`（bot 私信里的旧链接）→ `/players/<id>/cases/N`，那一起在最上方并居中；`/?session=N` → `/sessions/N`。
   - `/players/A/cases/N` 里 A 写错 → 地址被纠正，不报错；`/sessions/999999` → 「找不到这局，链接可能写错了。」；`/xyz` → 「这页不存在」。
   - 未登录在 `/sessions/N` 点「来」→ 登录 → 回到 `/sessions/N`，看到「你登录前点的是「来」，确认一下？」，不点就不会报名。
   - 桌面：`/sessions/N`、`/players/x` 是右侧抽屉，大厅留在底下；✕ 和 Esc 回到大厅。
   - 未登录在大厅约局行点「登录后报名」→ 登录 → 落在那一局，不提示；`edg.return` 被篡改（比如 `//evil.example`）时已登录刷新 → 不跳转、值被删掉。
   - Chrome 新标签页打开 `/sessions/N` 后**不点页面**直接按返回：Chrome 的 history manipulation intervention 可能跳过垫的 `/`、直接离开站点（浏览器策略，记录并「接受」）。
   - （可选，会写数据）大厅滚一半 → 「组一局」建好 → 返回 → 回到离开时的滚动位置。
   - 页面形态下打开账号菜单：菜单盖在「‹ 返回」条上面。
3. **真机（iOS Safari、Android Chrome 各一台）**：重复第 2 步里带「返回键」「刷新」「sheet」的项，另加：Android 系统返回键和手势返回；iOS 左缘右滑返回；sheet 底部的 `safe-area-inset-bottom`（有 Home 指示条的机型）；sheet 内长列表滚动不带动背景；横竖屏切换跨过 1024px 时形态切换不丢内容；地址栏收起/展开时 sticky PageBar 不抖。
4. **发现与修复**表：`编号 | 设备/浏览器 | 步骤 | 实际 | 严重度 | 处理（commit 或「接受」）`。
5. **结论**：全部通过 / 有遗留（列编号）。

需要改代码时，从 `claude/p1-4-docs` 开 `claude/p1-5-device-fixes`，每个修复一个 commit（`fix: …（P1-5）`），同时把 commit 填回上表；不需要改代码就不开这个分支。真机项只能由领队勾选，执行代理只负责写清单和做第 2 步的浏览器模拟（若能访问预览地址）。
