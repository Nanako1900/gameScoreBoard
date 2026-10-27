# P1 实施计划（前端重设计 v5 · 地址化与登录回跳）

## 目标

落地 v5 重设计的 P1「地址化与登录回跳」（spec §9 P1 表，合计 6.5–7 人日）：先核验托管、删掉 EdgeOne 遗留的 Pages Functions，让 `/sessions/1` 这类新地址在每个托管上都回落到 SPA（P1-0）；后端在判决前对无关的人只透露「有一起记录在处理中」（B1-1，档位 b，按 spec 要和路由一起或更早上线）；然后给 SPA 加上手写路由、旧深链映射、NotFound、页面 / 抽屉两种形态和案件置顶（P1-1）；让浮层进 history、返回键只关栈顶、深层地址垫一条 `/`、刷新不重开浮层、返回时恢复滚动（P1-2）；访客在只读页点「登录」「来」时记下回跳地址和意图，登录回来回到原页，只提示、不提交（P1-3）；最后把这些写进 `docs/CONTRACT.md`、README 的路由表，并写好 P1-5 的实机验收清单（P1-4）。P1-5 由领队按清单在真机和浏览器模拟里验收，要改代码时才开修复分支。

方向和 spec §11 的每个拍板项都按推荐默认值执行（§11 第 3 条：B1-1 档位 b；第 16 条：删除遗留 Pages Functions 和 `edgeone.json`）。

## 依据

- 已拍板的方案：`docs/redesign-v5/spec.md`。P1 用到的章节：§2 全部（导航、路由表、旧深链映射、首页 DOM 顺序）、§3.1、§3.5、§3.8、§4.1「登录回跳」、§6.4（Modal 语义）、§6.5（锁定清单）、§8 B1-1、§9 P1 表、§10 第 5、12 条、§11 第 3、16 条。另有 `docs/redesign-v5/analysis.md` §6「必须保留的约束」、`docs/CONTRACT.md:400-420`（Frontend expectations）。
- P0 计划：`docs/redesign-v5/plan-p0/`。P0 契约的规则在 P1 继续有效。
- 规划所依据的代码基线：「六份 P0 计划全部套上之后」的仓库（规划副本 `/tmp/claude-redesign/p0/final/compose/repo`，typecheck、unit、dom、build 都通过）。计划里的 `路径:行号` 指这个副本，只作参考；**定位一律以引用的锚点文字为准**。副本里没有 `docs/`，文档类改动以分支上的真实文件为准。
- 共享契约原文：本目录的 [contract.md](contract.md)（已按各计划的「对契约的补充」和跨 PR 合成的结果回写过）。下文「共享契约」一节摘出了执行时最常用的部分。
- 各 PR 计划：本目录的 `plan-P1-0.md`、`plan-B1-1.md`、`plan-P1-1.md` … `plan-P1-4.md`。各计划的独立审查记录和本轮一致性检查记录集中在 [review-log.md](review-log.md)。

## 六个 PR（外加 P1-5 验收）

| id | 名称 | 分支 | 从哪开（依赖） | 人日（spec） | 主要文件 | 新增 / 改动的测试 |
|---|---|---|---|---|---|---|
| [P1-0](plan-P1-0.md) | 托管核验与遗留清理 | `claude/p1-0-hosting` | `claude/p0-5-safety-net`（P0 全部） | 0.5 | `scripts/pages-headers.mjs`（`assertSpaFallback`：dist 任何层级有 `404.html` 就失败，CSP 不动）；删 `functions/api/[[default]].js`、`functions/auth/[[default]].js`、`edgeone.json`；`README.md`「## 部署」EdgeOne 那一条、`DEPLOY-EDGEONE.md` 顶部「已停用」、`docs/DEPLOY-PAGES.md` 两段 + 新增「SPA 回退核验（P1-0）」 | `tests/unit/pages-headers.test.ts` +4（import 行扩充）；`tests/unit/source-hygiene.test.ts` 只改 `SOURCE_DIRS` 一行；`tests/worker/split-deploy.test.ts` +2、`tests/worker/node-api.test.ts` +1 |
| [B1-1](plan-B1-1.md) | 判决前脱敏（档位 b） | `claude/b1-1-redact` | `claude/p1-0-hosting` | 1 | `worker/case-reads.ts`（`redactRecord`、`isPreVerdict`）、`worker/types.ts`（`OpenRecordView \| PendingHiddenRecordView`）、`src/types.ts`（`type`/`range` 可空、`pending_hidden?`）；新 `src/lib/recordView.ts`（纯）；`VerdictCard`（`PendingHiddenCard`）、`RecordsFeed`、`CaseActions`、`StatementDialog`、`AppealSheet`、`PendingBanner` 类型守卫；`verdict-card.css` 末尾一条 | 新 `tests/unit/record-view.test.ts`（7）；`tests/unit/record-privacy.test.ts` +8、`tests/worker/record-privacy.test.ts` +9（D1 和 PG 两个引擎）、`tests/dom/verdict-privacy.test.tsx` +6 |
| [P1-1](plan-P1-1.md) | 路由与旧深链映射 | `claude/p1-1-router` | `claude/b1-1-redact` | 3 | 新 `src/lib/{routes,routeCopy}.ts`（纯）、`router.ts`、`useRouteLayout.ts`、`useEntryTarget.ts`、`useCaseLookup.ts`；新 `Link`、`PageBar`+css、`NotFound`+css、`RouteView`；`deepLink.ts` 导出 `ID_PATTERN`；`App.tsx`（打开详情一律导航、大厅只加 `hidden`）、`Header.tsx`（品牌）、`SessionDetailDialog`、`PlayerDetail`（page/drawer、置顶、中性 ScoreGauge）；`app.css`、`player-detail.css` 末尾追加；`constants.ts` P1-1 小节 | 新 `tests/unit/route.test.ts`（16）、`tests/dom/router.test.tsx`（14）、`tests/dom/route-pages.test.tsx`（25）、辅助 `tests/dom/viewport.ts`；`deep-link`、`p8-app` 只追加断言；`source-hygiene` +1 个 describe（2）；`tests/dom/setup.ts` 重置路由 |
| [P1-2](plan-P1-2.md) | 浮层入 history 与返回键 | `claude/p1-2-history` | `claude/p1-1-router` | 1 | `router.ts` 整文件替换（P1-1 导出不变，加浮层账本、静默后退、写队列、垫 `/`、去 sheet、滚动恢复）；`routes.ts`（`EdgHistoryState` 的 `sheet`/`layer`/`y`）；新 `src/lib/useHistoryLayer.ts`；`Modal.tsx` 新可选 prop `historyKey`；8 个浮层各加一个 `historyKey`；`constants.ts` P1-2 小节 | 新 `tests/dom/back-closes-layer.test.tsx`（19）、辅助 `tests/dom/history.ts`（含给 P1-3 的 `preventNavigation`）；`route.test.ts` +6；`router.test.tsx`、`route-pages.test.tsx` 里 P1-1 的 4 个用例只改前提；`setup.ts` 改成 async |
| [P1-3](plan-P1-3.md) | 登录回跳与 ResumeHint | `claude/p1-3-login-return` | `claude/p1-2-history` | 0.5 | 新 `src/lib/loginReturnShape.ts`（纯）、`loginReturn.ts`、`useLoginResume.ts`；新 `LoginLink`、`ResumeHint`+css、`VisitorRsvpPrompt`+css；`useEntryTarget.ts`、`RouteView.tsx`、`App.tsx`（logout 清回跳、透传 resume）、`Header.tsx`（「登录」）、`WelcomeCard.tsx`、`SessionDetailDialog.tsx`（访客区、提示、金色圈）、`SessionsPanel.tsx`（大厅行「登录后报名」）；`session-detail.css`、`sessions-panel.css` 末尾追加；`constants.ts` P1-3 小节 | 新 `tests/unit/login-return.test.ts`（45）、`tests/dom/login-return.test.tsx`（16，含「只读页 → 登录 → 回到原页，有提示，没有任何 POST」） |
| [P1-4](plan-P1-4.md) | 契约文档、路由表与实机验收清单 | `claude/p1-4-docs` | `claude/p1-3-login-return` | 0.5 | `docs/CONTRACT.md`（`interface RecordItem` 跟上 B1-1；「Frontend expectations」整节：参数翻译成视图地址、路由表、保留前缀与 404.html、history、登录回跳、`pending_hidden`）；`README.md`（新「## 路由」、角色表一句）；新 `docs/redesign-v5/p1-acceptance.md` | 无（检查脚本 `/tmp/p1-4-doc-checks.mjs` 在仓库外，121 条全过才算完成） |
| (P1-5) | 实机验收 | 只在要修时开 `claude/p1-5-device-fixes` | `claude/p1-4-docs` | 0.5–1 | 按 `docs/redesign-v5/p1-acceptance.md`：M-01～M-30（375×812）、D-01～D-08（1280×800）、H-01～H-02（托管复测）、R-01～R-13（iOS Safari、Android Chrome 真机） | 每个修复一个 commit `fix: …（P1-5）`，每个 commit 前跑 typecheck + unit + dom |

## 叠放顺序与开分支规则

**顺序：P1-0 → B1-1 → P1-1 → P1-2 → P1-3 → P1-4（→ P1-5 修复分支，只在需要时）。** 每个分支从前一个分支的 HEAD 开，PR 叠放，由机主以后按顺序合并：

```
claude/p0-5-safety-net
  └─> claude/p1-0-hosting
        └─> claude/b1-1-redact
              └─> claude/p1-1-router
                    └─> claude/p1-2-history
                          └─> claude/p1-3-login-return
                                └─> claude/p1-4-docs
                                      └─> (claude/p1-5-device-fixes，只在验收发现要改代码时)
```

- 开分支：`git switch -c <分支> <上游分支>`（本地分支）。上游分支不存在或工作区不干净就停下，不在本 PR 里补别人的文件。
- **本轮不 fetch、不 rebase 到 `origin/main`、不 push、不开 PR、不合并**。计划里所有命令都在本地分支链上。
- B1-1 排在 P1-1 前面：spec 要求「B1-1 要和路由一起或更早上线」——`/players/:id/cases/:caseId` 让案件可以被直接分享，判决前的指控必须先在后端藏好。
- 新分支名和旧分支 `claude/p1-share-node` 不冲突，一个都不要改。
- 共享文件的追加位置是固定的，后来的 PR 按锚点文字定位，不按行号：
  - `src/lib/constants.ts`：`// --- P0-5 ---` 之后依次是 `// --- P1-1 ---`、`// --- P1-2 ---`、`// --- P1-3 ---`。
  - `tests/unit/source-hygiene.test.ts`：P1-0 只改 `SOURCE_DIRS` 一行，P1-1 在文件末尾追加 `describe('history API')`，两处不重叠。
  - `tests/dom/setup.ts`：P1-1 整文件替换成同步版本，P1-2 再整文件替换成 async 最终形态（契约 6.3），P1-3 不改。
  - `src/components/SessionDetailDialog.tsx`：P1-1 改 props、`<Modal>` 包装和标题聚焦；P1-3 接在 P1-1 的 `variant` 之后加 props，再改 RSVP 区和 `RsvpControls`。
  - `src/components/Header.tsx`：P1-1 只改品牌 `<a>`，P1-3 只改「登录」`<a>`。
  - `src/lib/router.ts`：P1-1 建，P1-2 整文件替换（P1-1 的导出名、签名、注释原样保留）。

## 共享契约（执行时以此为准）

### 规则

- spec 和契约冲突时以 spec 为准，**除了契约第 8 节列出的偏离**（有测试或实现理由，需机主过目，写进对应 PR 描述）。spec 没写死、契约写死了的文件名、导出名、类名、常量名、storage key，一律照用。计划正文和契约还有出入时，以计划正文为准（它们在代码上实测过），并回报领队。
- P0 契约的规则继续有效：CSS 断点只用四种写法、hover 包进 `@media (hover: hover)`、不写 `outline: none`、红字 `var(--danger-text)`、表单边框 `var(--border-input)`；CSP 不放 `unsafe-inline`；DOM 顺序 = 视觉顺序；§6.5 锁定文案；组件签名只加可选 props；新按钮不叫裸的「取消」「确认」「关闭」；toast 不用 `role="alert"`；被 `tests/unit` 导入的 `src/lib` 模块必须是纯模块。
- **只有 `src/lib/router.ts` 能碰 `history`**：`source-hygiene` 扫 `src/**/*.{ts,tsx}` 的纯文本，**注释也算**，出现 `history.pushState`、`history.replaceState`、`history.back(`、`history.go(`、`history.forward(`、`history.state` 就失败。所以契约 4.12 里 P1-2 常量的注释用的是定稿措辞。
- `src/App.tsx` 分区：**P1-1** 改 import 区、state 区、两段深链 effect 换成 `useEntryTarget`、渲染区（`main`/`footer` 加 `hidden`、插 `<RouteView>`、详情改成导航、删掉两个弹窗块）；**P1-3** 只加 `clearLoginReturn` 一行、解构多取两个字段、给 `<RouteView>` 两个 prop。P1-1 后 420–460 行，P1-3 后 ≤ 470 行（合成实测 430 / 434）。
- `Modal.tsx` 只有 P1-2 改（新可选 prop `historyKey`）；`modalStack.ts` P1 全程不改；`src/types.ts` 只有 B1-1 改；`PlayerDetail.tsx` 只有 P1-1 改；`SessionsPanel.tsx` 只有 P1-3 改。
- 新 CSS 都要过 `tests/unit/css-conventions.test.ts`；不往 `theme.css` 加 token。
- 机主编码规则：不可变更新；文件最多 800 行；函数 < 50 行；嵌套 ≤ 4 层；错误给友好的中文提示；在边界校验输入；不写 `console.log`；不写魔法数（时长、门槛、长度上限放 `constants.ts` 的 P1 小节）；用户文案用 spec 原文的中文。
- 提交信息 `<type>: <中文描述>`，**不加任何署名行**。

### 接口表（谁提供、名字、签名要点）

| 提供方 | 名字 / 位置 | 要点 |
|---|---|---|
| P1-0 | `scripts/pages-headers.mjs` | 写 `_headers` 之前 `assertSpaFallback(outDir)`：递归找 `404.html`，有就抛错，报错含「404.html」和它在 dist 里的路径；`buildHeaders` 一字不改 |
| B1-1 | `redactRecord(record, viewer)`（`worker/case-reads.ts`） | `!canReadPrivate` 且 `isPreVerdict(status)`（`awaiting_statement`/`judging`）时，在原脱敏之上置 `type`/`range`/`claim`/`claim_summary`/`note` 为 null、`escalation_suggested: false`、加 `pending_hidden: true`；保留 `statement_at` 等；其他情况输出不变、**没有** `pending_hidden` 键 |
| B1-1 | `src/lib/recordView.ts`（纯） | `PENDING_HIDDEN_LABEL = '处理中'`、`PENDING_HIDDEN_DELTA = '分数变化：判决后公开'`、`isPendingHidden`、`pendingHiddenSentence(username)`（「X有一起记录在处理中，判决后公开。」）、`violationDef(type)`、`violationLabel(type)` |
| P1-1 | `src/lib/routes.ts`（纯） | `Route`（home / session / player / playerCase / case / notFound）、`parseRoute`、`formatRoute`、`sessionPath`、`playerPath`（`encodeURIComponent`）、`playerCasePath`、`casePath`、`isAppPath`（不接管 `/api`、`/auth`、`/link`）、`isUserId`、`routeCoversHome`、`EdgHistoryState`、`readEdgState`、`HOME_PATH`、`RESERVED_PREFIXES` |
| P1-1 | `src/lib/router.ts` | `useLocation()`、`useRoute()`、`navigate(path, { replace?, keepScroll? })`（只收站内路径，否则 throw；保留前缀整页跳转）、`goBack(fallback = '/')`（idx 0 时 replace 到 fallback）、`currentPath()`、`bootRouter()`（幂等）、`resetRouterForTests()` |
| P1-1 | 组件与 hook | `Link { to, replace?, keepScroll?, …a 属性 }`；`useRouteLayout(): 'page' \| 'drawer'`（`DESKTOP_MEDIA_QUERY`）；`PageBar { backLabel, onBack, title?, actions? }`；`NotFound { title, headingId?, actions?, autoFocus? }`；`RouteView`；`useEntryTarget({ ready, me, blocked: () => boolean, onPinned })`；`useCaseLookup(caseId, seed)`；`PinnedCase`（定义在 `useCaseLookup.ts`，`RouteView` 再导出） |
| P1-1 | 详情组件新可选 props | `SessionDetailDialog.variant?`；`PlayerDetail.variant?`、`pinnedRecord?`、`refreshKey?`；默认 `'center'` 与今天逐字节一致 |
| P1-1 | `src/lib/routeCopy.ts`（纯） | `NOT_FOUND_TITLE` 这页不存在、`SESSION_NOT_FOUND` 找不到这局，链接可能写错了。、`PLAYER_NOT_FOUND` 找不到这位选手。、`CASE_GONE` 链接里的案件不存在了。、`CASE_UNAVAILABLE` 打不开链接里的案件，稍后再试。、`BACK_HOME` 回大厅、`CASE_OPENING` 正在打开案件…、`PAGE_BACK_LABEL` 返回、`PINNED_CASE_LABEL` 你点开的这一起、`pinnedCaseEyebrow(record)` |
| P1-1 | 测试辅助 | `tests/dom/viewport.ts` 的 `useDesktopViewport()`（只对 `DESKTOP_MEDIA_QUERY` 返回 matches）；`setup.ts` 的 `afterEach` 负责删掉它 |
| P1-2 | `router.ts` 追加 | `pushLayerEntry(name, onPop): LayerEntryId`、`dropLayerEntry(id)`、`simulateReloadForTests()`、`type LayerEntryId`；`bootRouter` 垫 `/`（只在 state 没有 `edg` 且不是 `/` 时）、去掉过期的 `sheet`/`layer`、`scrollRestoration = 'manual'` |
| P1-2 | `Modal.historyKey?: string` + `useHistoryLayer` | `center`/`sheet`/`drawer` 生效、`page` 忽略；8 个调用方的 key：`reschedule`、`appeal`、`rollcall`、`case`、`statement`、`session-form`、`onboarding`、`admin-ai`；路由形态的抽屉不设 |
| P1-2 | `tests/dom/history.ts` | `drainHistoryTraversals()`、`overlayMarks()`、`entryIdx()`、`preventNavigation()`（不导入 Testing Library） |
| P1-3 | `src/lib/loginReturnShape.ts`（纯） | `LOGIN_RETURN_KEY = 'edg.return'`、`LoginIntent`、`LoginReturn`、`serializeLoginReturn`、`parseLoginReturn`（路由白名单、≤ 512、30 分钟、坏 intent 只丢 intent）、`hasLegacyTarget`、`resumeRsvpFor` |
| P1-3 | `loginReturn.ts` / `useLoginResume.ts` | `saveLoginReturn(intent?, returnTo?)`、`takeLoginReturn(now?)`（读一次就删）、`clearLoginReturn()`；`useLoginResume({ ready, me, isBlocked })` → `{ resume, clearResume }` |
| P1-3 | 组件 | `LoginLink { className?, href?, intent?, returnTo?, ariaLabel?, children }`（不 `preventDefault`）；`ResumeHint { rsvp, onDismiss }` + `RESUME_HINT_TEXT_ID`；`VisitorRsvpPrompt { sessionId }`；`SessionDetailDialog.resumeRsvp?`、`onResumeDone?`；`RsvpControls.suggested?`；`RouteView.resume?`、`onResumeDone?` |
| 各 PR | `constants.ts` | P1-1：`DESKTOP_MEDIA_QUERY = '(min-width: 1024px)'`、`USER_ID_MAX = 128`；P1-2：`SILENT_BACK_TIMEOUT_MS = 1_000`、`HISTORY_SHEET_NAME_MAX = 32`；P1-3：`LOGIN_RETURN_TTL_MS = 30 * 60 * 1000`、`RETURN_PATH_MAX = 512` |

新分配的 BEM 前缀与类名：`.pagebar`、`.notfound`、`.app__page`（含 `-status`）、`.pd__pinned`（含 `-eyebrow`）、`.vc__delta-hidden`、`.vrp`、`.resume-hint`、`.sdt__rsvp-btn--suggested`、`.srow__login`。

### `history.state` 与 storage

- 路由写的每一条历史都是 `{ edg: 1, idx }`；P1-2 起浮层条目另带 `sheet`、`layer`，离开时记 `y`。判断「是不是路由写的」只看 `edg === 1`。测试只断言 `edg`/`sheet`/`layer`，不断言具体 `idx`（专测 idx 的除外）。
- `sessionStorage['edg.return']` = `{"v":1,"path":"/sessions/5","savedAt":…,"intent":{"kind":"rsvp","sessionId":5,"rsvp":"going"}}`；`setup.ts` 的 `sessionStorage.clear()` 每个测试后清掉它。

### 被测试锁住、P1 会碰到的东西（摘要；完整表在 contract.md 第 7 节）

- `deep-link`：`/?case=7&utm=dc` 落到 `/players/p/cases/7?utm=dc`，焦点在 `#case-7`、全页只有一个 `#case-7`；非法 id 不请求、停在 `/`；404 用大厅上的「链接里的案件不存在了。」。
- `p8-app`：`/api/records/7` 正好请求一次；`/?onboarding=1&case=7` 先首登对话框，Esc 之后才出现「选手」（`blocked` 必须是函数，P1-2 的静默后退期间导航排队）。
- `discord-link`：剥完参数是 `?onboarding=1`。`app-refresh`：首屏请求集合不变。`board`、`my-score-line`：唯一的 /约局/ 标题、DOM 顺序。
- `organizer-actions:212-220`、`appeal-sheet:140-167`、`drafts`：Esc 和界面关闭是**同步**的（P1-2 用「同步 onClose + 失活时静默后退」，契约第 8 节第 1 条）。
- `modal-focus`、`modal-stack`：Modal 不加 document/window 监听，StrictMode 一次打开一层。
- `record-privacy`（unit、worker）：非脱敏输出不出现 `pending_hidden` 键；`appealed` 记录对访客照样公开。`verdict-privacy`、`wording`：只追加。
- `pages-headers`：CSP 逐字一致。`split-deploy`：旧主机 302 保留 path 和 query。

## 每个 PR 之后的测试数字

跨 PR 合成副本（六份计划依次套在规划副本的同一份拷贝上）逐 PR 实测，Node v24.22.0。「文件 / 用例」；dom 的 `act(...)` 警告始终是 `onboarding-roles` 原有的 3 条，`Not implemented` 0 条；typecheck（三个 tsconfig）每一步都通过。

| 合并后 | unit | dom | worker | 其他 |
|---|---|---|---|---|
| 基线（P0-5） | 26 / 326 | 20 / 219 | 15 / 548 + 9 todo | — |
| + P1-0 | 26 / 330 | 20 / 219 | 15 / 551 + 9 todo | `build:pages` 遇到 `public/404.html` 失败、去掉后通过 |
| + B1-1 | 27 / 345 | 20 / 225 | 15 / 560 + 9 todo | PG 套件（同一批 `tests/worker/**`）交给 CI |
| + P1-1 | 28 / 363 | 22 / 264 | 15 / 560 + 9 todo | App 430 行 |
| + P1-2 | 28 / 369 | 23 / 283 | 不变（不碰后端） | `back-closes-layer` 19 个 |
| + P1-3 | 29 / 414 | 24 / 299 | 不变 | App 434 行 |
| + P1-4 | 29 / 414 | 24 / 299 | 不变 | 文档检查 121 / 121；`npm run build`、`build:pages` 通过，`dist/` 只有 `_headers`、`assets/`、`index.html` |

本地不跑 `npm run test:pg`、`npm run test:server`（嵌入式 Postgres），交给 CI；B1-1 新增的 9 个路由级用例会在 CI 的 PG 轮里原样再跑一次，P1-0 新增的 `node-api` 用例也是。

## 怎么执行

1. **一次只做一个 PR，按叠放顺序来。** 每个 PR 用 `superpowers:subagent-driven-development` 按它的计划逐个 Task 执行：先写失败的测试，确认它按写明的原因失败，再实现，确认通过，最后 commit（提交信息照抄计划，不加署名行）。不在当前会话里执行就用 `superpowers:executing-plans`。
2. **开工前**跑计划的 Task 0：确认上游分支存在、工作区干净，`git switch -c <分支> <上游分支>`；用 grep 核对上游接口和锚点都在（每份计划都写了期望输出，已在合成副本的对应阶段逐条跑过）；跑基线并对照上表。任何一项对不上就停下回报领队，不在本 PR 里补别人的文件。
3. **收尾**跑计划「收尾」里的全部步骤：全量验证（typecheck + unit + dom；P1-0、B1-1 另跑 worker；P1-0 另做 `wrangler pages dev` / `wrangler dev` 本地核验和只发 GET 的生产实测）、卫生 grep、手动检查（做不到的写「未手动验证，留给 P1-5」）。数字和上表对不上就继续修。
4. **不 rebase、不 push、不开 PR、不合并。** 每个计划里「写进 PR 描述」的要点（尤其「对契约的补充」各条和契约第 8 节的偏离）由机主以后开 PR 时使用。
5. **P1-5**：领队按 `docs/redesign-v5/p1-acceptance.md` 执行。第 2 节（375×812、DPR 3、触控；1280×800；托管复测）可以在桌面 Chrome 或内置浏览器的 mobile 预设里模拟，第 3 节只能在真机（iOS Safari、Android Chrome）上做，执行代理不勾第 3 节。发现要改代码的项才从 `claude/p1-4-docs` 开 `claude/p1-5-device-fixes`，每个修复一个 `fix: …（P1-5）` commit，并把短 hash 填回清单第 4 节。
6. 需要机主拍板、已写进各计划 PR 描述要求里的事项：
   - 契约第 8 节的 17 条偏离，尤其：界面关闭是「同步 onClose + 静默后退」（第 1 条）；B1-1 额外隐藏 `note`、`range`（第 4 条）；`edg.return` 有效期 30 分钟而 spec 写 15 分钟（第 12 条）；大厅约局行的「登录后报名」（第 14 条）；`?linked=discord` 的「去设置私信 ›」推迟到 P4（第 15 条）。
   - B1-1「对契约的补充」第 6 条：`GET /api/sessions/:id` 的点名数据（`attendance`、`late_minutes`）对访客公开，点名推导的案件仍能被猜出类型——超出本轮范围，要不要另开后端条目。
   - P1-0：「PR 预览」「合并部署后」两列实测要在 push 和重新部署 Pages 之后由领队填；`community.nanako.org/api/*`、`/auth/*` 的 404 要等重新部署后才变成 SPA 外壳。

## 跨 PR 一致性检查记录

### 检查方式

六份 v2 计划和契约都通读了，重点看：同一文件的同一区域被两个 PR 改；消费方用的名字或签名和提供方的定义不一致；先做的 PR 用到了后做的 PR 才提供的东西；重复劳动；文案不一致；测试文件重名；会因为前一个 PR 而漂移的行号。

除了读文本，还做了一次**完整的实际合成**（`/tmp/claude-redesign/p1/compose/repo`，git 里每个 PR 一个 commit；`node_modules` 是指向 worktree 各包的符号链接目录，去掉了自引用链接，`@edg/server` 指回副本自己的 `server/`，所以没有往 worktree 写任何东西）：

- 底：P0 规划副本 + 分支上真实的 `docs/`（只读拷贝）。
- P1-0：从计划正文里抽代码块和「把 A 换成 B」逐条套上，结果与 P1-0 审查副本逐字节相同。
- B1-1：套上审查副本（按 v2 从头套过），再用脚本核对计划里每个「新内容」代码块都在结果里。
- P1-1：套上审查时按 v2 正文机械回放的副本（`apply_plan.py` 逐 Task 先红后绿），同样核对。
- P1-2：它的审查副本是叠在 **P1-1 的早期草稿**上的。把它相对草稿的补丁打到合成副本（P1-1 最终版）上，全部命中，只有两处偏移；再核对计划正文的代码块。
- P1-3：它的审查副本叠在 **P1-2 规划者的上游草稿**上，所以没有复用，而是用脚本按 v2 正文的代码块和锚点直接套在合成副本上（Task 0 里「两种都接受」的分支按 P1-1、P1-2 的真实写法选），没有一处锚点落空。
- P1-4：按最终计划套文档，跑它自带的检查脚本。

每一步都跑了 typecheck、unit、dom（P1-0、B1-1 另跑 worker），数字就是上面那张表；最后在合成结果上跑了 typecheck、unit 29 / 414、dom 24 / 299（连跑 3 次）、worker 15 / 560 + 9 todo、`npm run build`、`npm run build:pages`，全部通过。各计划 Task 0 的 grep 也在合成副本的对应阶段跑过（B1-1 的 VerdictCard 哈希、P1-4 的 CONTRACT 哈希都对得上）。

### 发现的问题与处理

1. **P1-3 是对着草稿写的，Task 0 和 Task 5 有一串「两种写法都接受」的分支。** 它的审查副本用的是 P1-2 规划者的上游草稿，所以 `blocked` 是布尔还是函数、`useEntryTarget` 的解构里有没有 `me`、`RouteView` 是 `props.xxx` 还是解构、有几处 `<SessionDetailDialog`，都留成了执行时再判断。→ 按 P1-1 最终版写死：`blocked: () => boolean`（App 的 `entryBlocked`）、解构 `({ ready, blocked, onPinned })` 里补上 `me`、`RouteView` 用 `props.xxx`、只有 `case 'session'` 一处、App 是 `const { linkMissing, dismissLinkMissing } = useEntryTarget({`。Task 0 的 grep 改成逐条的期望输出，Task 5 Step 4–6 改成「改前 → 改后」，原来的四行写法表删掉（只留一条参数写法不同时的备选）。合成副本上 16 个 dom 用例、45 个 unit 用例全过。
2. **P1-3 的条件步骤「P1-2 没导出 `preventNavigation` 就自己补」是重复劳动，也违反「不补别人的文件」。** P1-2 最终版已经在 `tests/dom/history.ts` 里导出它。→ P1-3 Task 2 Step 1 改成「核对已由 P1-2 提供，没有就停下」，文件表和 `git add` 里去掉 `history.ts`，补充第 9 条同步改写。
3. **P1-3 Task 4 往 `SessionsPanel` 插 JSX 的位置只用文字描述，没有可匹配的锚点。** → 给出唯一命中的四行锚点（`))}` / `</div>` / `)}` / `</li>`）和插入位置。
4. **契约落后于计划。** 契约原稿里 `blocked` 是 `boolean`、`PinnedCase` 在 `RouteView.tsx`、`saveLoginReturn(intent?)` 只有一个参数、P1-3 不碰 `SessionsPanel`、没有 `useLoginResume.ts`、P1-0 不碰 `source-hygiene`/`node-api`、P1-2 不碰 `router.test.tsx`/`route-pages.test.tsx`、P1-1 会追加 `session-detail.css`（实际不碰）、`recordView` 没有 `violationDef`。→ 契约第 1、2、3、4、5、8、9 节按计划回写（定稿说明写在契约开头），第 1 节换成逐 PR 实测的「文件 / 用例」表；第 8 节新增第 13～17 条。
5. **契约 4.12 里 P1-2 常量的注释会让 source-hygiene 失败。** 原稿是「A silent history.back() …」「history.state.sheet: …」，而 P1-1 的 `history API` 扫描连注释也扫。P1-2 计划已经自己换了措辞。→ 契约 4.12 改成 P1-2 的定稿措辞，6.5 写明「注释也算」，P1-1 补充第 10 条从「P1-2 也要避开（或调整扫描范围）」改成「P1-2 已避开，扫描范围不改」。
6. **契约 4.6 对返回键被离开确认拦下后的「重新压一条」写的是「下一个微任务里仍 open 就重压」，静默后退写的是 `history.back()`。** P1-2 实际是 `pops` 重渲染重压、`history.go(-n)` 一次退掉多层、写操作统一排队，popstate 监听在有浮层或静默后退在途时也装着。→ 契约 4.2、4.6 按 P1-2 改写，第 8 节第 16 条记一笔。
7. **B1-1 的 dom 用例有偶发失败，P1-1 只是「遇到就重跑」。** `verdict-privacy`「… never a 0」用 `deadline_at = now + 3h`，`formatRemaining` 向下取整，造数据和渲染落在同一毫秒时显示「还剩 3 小时 0 分」，`/\b0\b/` 失败（P1-1 审查 7 次全量碰到 2 次）。→ B1-1 改成 `now + 3.5h`（显示 3 小时 29 分或 30 分，都没有单独的 0），加了注释和说明；P1-1 Task 0、收尾的说明改成「已在 B1-1 修掉，仍然出现就回报」。合成副本上改完连跑 3 次 dom 全过。
8. **P1-1、P1-2、P1-3 的「手动检查」里有几项验收清单没有收。** P1-2 明确要求 P1-4 补上「Chrome 的 history manipulation intervention」和「浮层里导航后的滚动」；P1-3 的「大厅行登录后报名」「被篡改的 `edg.return`」「桌面的登录回跳」、P1-1 的「账号菜单盖住 PageBar」都不在清单里，领队要在三份计划和清单之间来回对。→ P1-4 的验收清单新增 M-26～M-30、D-08，M-08 加「先在页面点一下」、M-24 加「返回后再进不再提示」，第 0 节「不写数据」和第 7 节「已知风险」同步；检查脚本的步骤编号断言改成 M-30、D-08，并多查两条（`登录后报名`、`history manipulation intervention`），期望数字随之更新（acceptance 空跑 2 / 46、写完 48；`all` 121）；P1-1、P1-2、P1-3 的手动检查改为指向清单编号。
9. **P1-4 写进 CONTRACT 的登录回跳说法和 P1-3 的实现对不上。** 原文是「在 `/` 上没有 intent 时不存并删掉旧值」，而 P1-3 把它推广成「任何不值得回来的页面都不存」，并且大厅约局行在 `/` 上也会存 `/sessions/N`（`returnTo`）。→ CONTRACT 新文本、README「路由」一节、计划里的「要点」都改成和 P1-3 一致；P1-4 Task 0 的上游核对多查 `登录后报名`、`LoginLink` 的 `returnTo`、`SessionsPanel` 的 `LoginLink`。
10. **P1-0 的 `docs/DEPLOY-PAGES.md` 行号已经漂了。** 计划和契约写的是「第 46–48、80–83 行」「grep 期望 46、48、80、83」，分支上的真实文件在第 2 步多了 `VITE_DISCORD_INVITE_URL` 两行，实际是 48、50、82、85。→ 全部改成锚点文字（行号只作参考）；「把 X 换成 Y」的原文在分支文件上逐字命中，已在合成副本上验证。
11. **P1-2 手动检查写的按钮名「发起约局」不存在**，大厅上的按钮叫「组一局」。→ 改成「组一局」（打开发起约局的对话框），验收清单 M-29 也用「组一局」。
12. **跨计划引用指向了临时路径和 v2 文件名**（`/tmp/claude-redesign/p1/contract.md`、`plan-P1-0.v2.md`、「见文末审查记录」）。→ 统一改成本目录的 `contract.md`、`plan-<id>.md`、`review-log.md`。

### 核对过、没有冲突的

- **测试文件名**：新测试 `tests/unit/{record-view,route,login-return}.test.ts`、`tests/dom/{router,route-pages,back-closes-layer,login-return}.test.tsx` 两两不重名，也不和现有文件重名（`tests/unit/deep-link.test.ts` ≠ `route.test.ts`；unit 和 dom 各有一个 `login-return`，在不同目录、不同 vitest 配置下，不冲突）。测试辅助 `tests/dom/viewport.ts`、`tests/dom/history.ts` 不带 `.test.`，不会被当成测试文件收集。
- **共享文件的分区**：`constants.ts` 三个小节按 P1-1 → P1-2 → P1-3 接在 P0-5 之后；`source-hygiene` 的 P1-0 那一行和 P1-1 的 describe 不重叠；`Header.tsx` 两个 PR 各改一个 `<a>`；`SessionDetailDialog.tsx` 的 P1-1、P1-3 锚点在合成副本上全部唯一命中；`App.tsx` P1-3 的四处锚点都在 P1-1 的结果里；`README.md` 的 P1-0（「## 部署」）和 P1-4（「## 路由」、角色表）不重叠；`docs/CONTRACT.md` 只有 P1-4 改，`docs/DEPLOY-PAGES.md` 只有 P1-0 改。
- **名字和签名**：`ID_PATTERN`、`readEdgState`、`isIndex`、`HOME_PATH`、`isAppPath`、`parseRoute`、`sessionPath`、`currentPath`、`navigate`、`useLocation`、`resetRouterForTests`、`violationLabel`、`isPendingHidden`、`PENDING_HIDDEN_LABEL`、`preventNavigation`、`drainHistoryTraversals` 在提供方和消费方写法一致（合成副本 typecheck 三个 tsconfig 都过）。
- **文案在各 PR 之间一致**：「返回」（PageBar，不写「‹ 大厅」，契约第 8 节第 11 条）、「回大厅」、四句 404 文案、「处理中」「分数变化：判决后公开」「X有一起记录在处理中，判决后公开。」、「你登录前点的是「来」，确认一下？」「不用了」、「登录后就能回『来 / 待定 / 不来』，没绑 Discord 也行。」「登录后报名」——计划代码、CONTRACT 新文本、README 路由表、验收清单四处逐字相同（P1-4 的检查脚本也查了）。没有新的裸「取消」「确认」「关闭」按钮。
- **P1-2 改的 P1-1 用例**：只挪前提、不删断言；P1-1 最终版新增的「桌面抽屉里的案件 404，✕ 回大厅」在 P1-2 之后原样通过。
- **有意偏离契约的地方**都保留，理由在各计划的「对契约的补充」和契约第 8 节，后面的 PR 也都按偏离后的版本消费（`blocked` 函数、`PinnedCase` 位置、`landing` 延迟导航、`useLoginResume`、`returnTo`、TTL 30 分钟、`violationDef`）。
- **看过但不改**：P1-3 的 `.srow__login` 写 `min-height: 40px`，和同一行里已有的 `.srow__rsvp-btn` 一致、过 `css-conventions`，不改成 `--tap-min`（44px）免得同一行两种高度；`NOT_FOUND_STATUS = 404` 在几个文件里各有一份具名常量（P1-1 审查已说明）。
- **范围**：没有一个计划要求 rebase 到 `origin/main`、push、开 PR 或合并；全部 commit 信息是 `<type>: <中文>`，没有署名行。

### 计划文件的改动范围

最终计划 = 各计划的 v2 正文去掉「## 审查记录」（原样搬进 `review-log.md`）后，做了上面 1～12 条的修改：

| 文件 | 改了什么 |
|---|---|
| `plan-P1-0.md` | `docs/DEPLOY-PAGES.md`、`README.md` 的行号改成锚点（第 10 条） |
| `plan-B1-1.md` | `verdict-privacy` 的截止时间 3.5 小时并加说明（第 7 条）；引用路径（第 12 条）；收尾的实测说明改成合成结果 |
| `plan-P1-1.md` | 偶发失败的说明（第 7 条）；补充第 10 条（第 5 条）；手动检查第 8 条指向 M-30；引用路径 |
| `plan-P1-2.md` | Task 0 写上合成实测的 `U0`/`D0`；手动检查「组一局」、第 6、7 条已收进清单（第 8、11 条）；P1-1 新用例兼容的说明；引用路径 |
| `plan-P1-3.md` | Task 0、Task 2 Step 1、Task 4 Step 3、Task 5 Step 3–6、文件表、自查、补充第 6、9 条（第 1～3 条）；手动检查指向清单编号；引用路径 |
| `plan-P1-4.md` | 验收清单 M-08、M-24、M-26～M-30、D-08、第 0 / 1 / 7 节；检查脚本的编号断言和两条新 mention、期望数字；CONTRACT「Login return」和 README「登录回跳」的说法；Task 0 多三条上游核对；补充第 5 条、自查（第 8、9 条）；去掉「v2」页眉 |
| `contract.md` | 定稿说明；第 1 节逐 PR 实测表；第 2、3 节文件清单与分区；4.2、4.6、4.9、4.10、4.11、4.12、4.13、5、6.5、8（新增 13～17）、9 节（第 4～6 条） |
