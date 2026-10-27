# P0 实施计划（前端重设计 v5）

## 目标

落地 v5 重设计的 P0「地基、视觉基础与安全网」（spec §9 P0 表，合计 11.5 人日）：先修好 CSS 层叠、焦点、对比度并立好 token / 断点 / hover 约定（P0-1），再给弹层加栈和 sheet 形态、给页面加「刷新失败不崩」和 toast/撤销原语（P0-2、P0-3），然后把首页去羞辱化（P0-4）、给约局详情补上改时间和取消确认（P0-6），最后补齐草稿、申诉、撤销倒计时、回血预告等安全网（P0-5）。六个 PR 各自能单独上线；现有 8 个弹窗调用方、深链、首屏请求、锁定文案和全部已有测试都保持不变。

方向和 spec §11 的每个拍板项都按推荐默认值执行。

## 依据

- 已拍板的方案：`docs/redesign-v5/spec.md`。P0 用到的章节：§0、§1.2、§2.4、§3.1–3.3、§3.5、§3.10、§5、§6（含 §6.4 Modal 语义、§6.5 锁定清单）、§7、§8、§9 P0 表、§10。
- 背后的分析：`docs/redesign-v5/analysis.md`。
- docs 分支 `claude/redesign-v5`（提交 31eb168，只加了 `docs/redesign-v5/*.md`）建议最先合进 main，好让 PR 描述直接链到 main 上的 spec。P0 的代码不依赖它。
- 共享契约原文：本目录的 [contract.md](contract.md)。下文「共享契约」一节已经把执行时要用的部分都抄了过来，本 README 单独就能用。
- 各 PR 计划：本目录的 `plan-P0-1.md` … `plan-P0-6.md`。审查记录集中在 `review-log.md`。

## 六个 PR

| id | 名称 | 分支 | 依赖（必须已合进 main） | 人日（spec） | 主要文件 | 新增 / 改动的测试 |
|---|---|---|---|---|---|---|
| [P0-1](plan-P0-1.md) | 地基：层叠顺序、焦点、对比度、token 与断点 | `claude/p0-1-foundation` | — | 1.5 | `src/main.tsx`（导入顺序）、`src/theme.css`（两层 token、`:focus-visible`、forced-colors、`.btn--danger-outline`）、`src/app.css` 和 23 个 `src/components/*.css`（断点、hover、红字、输入框边框、两处触控尺寸重申） | 新 `tests/unit/contrast.test.ts`（31 个）、新 `tests/unit/css-conventions.test.ts`（13 个，断言 ①–⑧）；`source-hygiene.test.ts` +1（导入顺序） |
| [P0-2](plan-P0-2.md) | Modal 栈、sheet 形态与 ConfirmInline | `claude/p0-2-modal-stack` | P0-1 | 2.5 | 新 `src/lib/modalStack.ts`；`Modal.tsx` 整文件重写（`variant`/`dismissible`/`title`）、`modal.css`；新 `ConfirmInline.tsx` + `confirm-inline.css`、新 `src/lib/useInlineConfirm.ts`；`theme.css` 只删 `.modal__close` 的 coarse 规则 | 新 `tests/dom/modal-stack.test.tsx`（20 个）、新 `tests/dom/confirm-inline.test.tsx`（12 个）；`tests/dom/setup.ts` 建立 `afterEach`；`modal-focus.test.tsx` 不改、原样通过 |
| [P0-3](plan-P0-3.md) | 数据不崩、Toast 与撤销原语、倒计时 | `claude/p0-3-data-resilience` | P0-1 | 1.5 | `App.tsx`（数据与状态区，外层包 `ToastProvider`）；新 `src/lib/{constants,coreKeys,coreData,useCoreData,refreshPolicy,useVisibleRefresh,useResetWatch,useNow,tabTitle,useTabTitle,useUndo}.ts`；`time.ts` 末尾追加；新 `Toast.tsx`、`StaleNotice.tsx` 及 css；`Header.tsx` | 新 `tests/unit/countdown.test.ts`（13）、`tests/unit/refresh-policy.test.ts`（13）、`tests/dom/toast.test.tsx`（12）、`tests/dom/app-refresh.test.tsx`（11） |
| [P0-6](plan-P0-6.md) | 约局详情里补上改时间、取消确认与 RSVP 反馈 | `claude/p0-6-organizer-actions` | P0-1、P0-2、P0-3 | 1 | `SessionDetailDialog.tsx`、`session-detail.css`（只在末尾追加）；新 `RescheduleSheet.tsx` + `reschedule-sheet.css`；新 `src/lib/sessionActions.ts`；`constants.ts` 追加 P0-6 小节 | 新 `tests/unit/session-actions.test.ts`（21）、新 `tests/dom/organizer-actions.test.tsx`（20）；`session-rsvp-moved` 不改、原样通过 |
| [P0-4](plan-P0-4.md) | 榜单与首页去羞辱化 | `claude/p0-4-board` | P0-1、P0-3 | 2 | `App.tsx`（渲染区）；`Leaderboard`、`ScoreGauge`、`RecordsFeed`、`WeeklyReportCard`、`RulesPanel`、`HistoryChart` 及 css；新 `WeekHighlights`、`WelcomeCard`；新 `src/lib/{rank,feedStats,weekStars,inviteUrl,env,revealSection}.ts`；删除 `RedBlackBoard.tsx`/`red-black-board.css`；`theme.css` 只删 `.hero-card__link,`；`OnboardingDialog.tsx:29` 改一句 desc；`index.html`、`vite-env.d.ts`、`docs/DEPLOY-PAGES.md` | 新 `tests/unit/{rank,feed-stats,week-stars,invite-url}.test.ts`（4+5+11+4）、新 `tests/dom/{score-gauge,board,history-chart}.test.tsx`（3+27+6） |
| [P0-5](plan-P0-5.md) | 安全网：草稿、申诉、撤销倒计时、回血预告、文案 | `claude/p0-5-safety-net` | P0-2、P0-3、P0-4、P0-6¹ | 3 | `shared/scoring.ts`、`worker/cases.ts`、`server/src/discord/case-actions.ts`（常量迁移，申诉截断 1000 → 500）；新 `src/lib/{draftShapes,drafts,useDraft,useLeaveGuard,forgiveness,revoke}.ts`；新 `AppealSheet`、`ForgivenessNote`、`MyScoreLine`、`DraftNote`、`CaseActions`；`PlayerDetail`、`VerdictCard`、`StatementDialog`、`CaseDialog`、`SessionFormDialog`、`RollCallDialog`、`OnboardingDialog`、`DiscordLinkCard`、`RulesPanel:36`、`App.tsx` | 新 `tests/unit/{revoke,forgiveness,draft-shapes}.test.ts`（5+10+16）；`source-hygiene` +1；新 `tests/dom/{drafts,appeal-sheet,my-score-line,wording}.test.tsx`（25+12+10+6）；`verdict-privacy` 只追加 1 个；`tests/worker/cases.test.ts` +1；`tests/pg/dm.test.ts` 加 1 条断言；`tests/dom/setup.ts` 加两行清 storage |

¹ P0-5 只用到 P0-6 的一个常量 `CUSTOM_TIME_LEAD_MS`，是一致性检查时加上的依赖（见下文第 3 条）。按推荐顺序，P0-6 本来就排在 P0-5 前面。

## 合并顺序与开分支规则

**推荐合并顺序：P0-1 → P0-2 → P0-3 → P0-6 → P0-4 → P0-5。**

```
P0-1 ──┬──> P0-2 ──┬──────────────> P0-6 ──┐
       │           │                 ▲     │
       └──> P0-3 ──┼─────────────────┘     │
                   ├──> P0-4 ──┐           │
                   └───────────┴──> P0-5 <─┘ (还依赖 P0-2)
```

- P0-2 和 P0-3 可以并行开发，P0-6 和 P0-4 也可以。P0-6 排在 P0-4 前面，是为了尽快打通邀请闭环（P0-2 → P0-6 → P2-1/P2-2）。
- **一个 PR 的全部硬依赖都合进 main 之后，才从最新的 `origin/main` 开它的分支**：`git fetch origin && git switch -c <分支> origin/main`。不在别人还没合并的分支上叠分支。依赖没合之前只能读计划，不能写代码。
- **不要从本地 `main` 开分支**。本地 `main` 停在 0798d52（很早的 PR #4），早就过期了。
- 本轮的分支名不能和旧分支 `claude/p0-bugfixes`、`claude/p0-hardening` 重名。
- 合并前 rebase 到最新的 `origin/main`，再跑一遍该 PR「收尾」里的全量验证。
- 预期会出现、也知道怎么解决的 rebase 冲突：
  - `tests/unit/source-hygiene.test.ts`：P0-1 和 P0-5 都在文件末尾追加一个 `describe`，两段都保留。
  - `src/lib/constants.ts`：每个 PR 都在文件末尾追加一个带标题的小节。合并后从上到下是 P0-3、P0-6、P0-4、P0-5，不按契约示例里的编号排。如果 P0-4 和 P0-6 并行开发，后合并的那个 rebase 时两个小节都保留。

## 共享契约（执行时以此为准）

### 规则

- spec 和契约冲突时以 spec 为准。spec 没写死、契约（或下表）写死了的文件路径、导出名、CSS 类名、常量名、storage key，一律照用，不另起名字。
- `src/theme.css` 归 P0-1。P0-2 只删 `.modal__close` 的 coarse 规则，P0-4 只删 `.hero-card__link,` 一行。其余 PR 不往 theme.css 里加 token；缺的局部变量写在自己组件的 css 里。
- `App.tsx` 的分区归属：
  - **P0-3**：数据与状态区、`<Header>` 的 props、StaleNotice、`ToastProvider`、可见性 / 跨重置点 / 标题三个 hook、周报重写 `handleRegenerate`。
  - **P0-4**：`computeTrends`/`computeCounts` 挪去 `feedStats.ts`；删 RedBlackBoard；Leaderboard 加 `meId`/`highlights`；RecordsFeed 加 `previewCount`；WeeklyReportCard 加 `compact`；`rulesOpen` 状态；未登录时显示的 WelcomeCard。
  - **P0-5**：`handleLogout` 里调 `clearAllDrafts()`；PendingBanner 和 SessionsPanel 之间插 MyScoreLine；StatementDialog / PlayerDetail 的新可选 props。
  - **P0-6** 不碰 App。
  - 后来的 PR 一律按片段内容定位，不按行号。
- `RulesPanel.tsx`：P0-4 加受控 props 和 `id="rules"`，P0-5 只改「本地时区」那一行。`OnboardingDialog.tsx`：P0-4 只改 `ROLE_CARDS[0].desc`，P0-5 管 state 和草稿。`Modal.tsx` 只有 P0-2 改。`SessionDetailDialog.tsx` 只有 P0-6 改。`PlayerDetail.tsx`、`DiscordLinkCard.tsx` 只有 P0-5 改。
- 被 `tests/unit` 导入的 `src/lib` 模块必须是纯模块：不碰 `window`/`document`/storage/`import.meta.env`，不导入 React 或 `src/api.ts`。原因是 `tests/unit` 由 `tsconfig.worker.json` 做类型检查，那里没有 DOM 类型。
- 领域常量放 `shared/`。前端专用的时长和门槛放 `src/lib/constants.ts`。断点只写在 CSS 里。
- CSS 断点只允许四种写法：`(max-width: 600px)`、`(min-width: 601px)`、`(max-width: 1023px)`、`(min-width: 1024px)`。所有 `:hover` 都写在 `@media (hover: hover)` 里。不写 `outline: none`/`0`，不用 box-shadow 当焦点环。红字一律 `var(--danger-text)`；表单控件的边框用 `var(--border-input)`。组件规则压掉了 theme.css 的 coarse 触控尺寸时，要在组件自己的 coarse 块里重申。这些都由 P0-1 的 `css-conventions.test.ts` 自动检查。
- CSP 是 `style-src 'self' https://fonts.googleapis.com`、`script-src 'self'`，没有 `unsafe-inline`。只能用类名、React `style={{…}}`（走 CSSOM）、`element.style.setProperty`、SVG 表现属性；不插 `<style>`，不写 `style="…"` 字符串，不用 `dangerouslySetInnerHTML`。P0 不改 CSP。
- DOM 顺序 = 视觉顺序：不用 CSS `order`、`*-reverse`，也不用 grid 位置打乱阅读顺序。
- 深链 `?case`、`?session`、`?linked=discord`、`?onboarding=1` 的语义一律不改。首屏请求的 URL 集合不变，P0 不新增首屏请求。
- 组件签名只能加可选 props；新组件不受这条限制。§6.5 锁定的文案和类名一律不改。新按钮不叫裸的「取消」「确认」「关闭」「关闭提示」。toast 不用 `role="alert"`。
- 机主编码规则：不可变更新；文件 200–400 行为宜、最多 800；函数 < 50 行；嵌套 ≤ 4 层；错误给友好的中文提示；在边界校验输入；不写 `console.log`；不写魔法数。
- 提交信息格式 `<type>: <中文描述>`。commit 和 PR 描述都**不加** `Co-Authored-By`、「Generated with」之类的署名。

### 接口表（谁提供、名字、签名要点）

| 提供方 | 名字 / 位置 | 要点 |
|---|---|---|
| P0-1 | `src/theme.css` token | primitive：`--border-input #66738a`、`--faint #848fa0`、`--danger-text #ff6b6f`、`--amber`、`--focus #8ab4ff`、`--down → var(--danger-text)`；semantic：`--action/--attn/--ok/--neutral/--danger/--info/--score-chip-bg/--score-chip-fg`；`--z-modal 100`、`--z-toast 200`、`--safe-bottom`、`--sheet-max-h 92dvh`、`--tap-min 44px`；`--fs-xs…--fs-2xl`、`--fs-hero`；旧 `--text-*` 保留并标 deprecated |
| P0-1 | 全局焦点 / 按钮 | `:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px }`（不再设 border-radius）；`@media (forced-colors: active)` 兜底；`.btn--danger-outline` |
| P0-2 | `src/lib/modalStack.ts` | `pushLayer(): LayerId`、`popLayer(id)`、`isTopLayer(id)`、`layerCount()`、`acquireRootInert()`/`releaseRootInert()`、`lockBodyScroll()`/`unlockBodyScroll()`（计划补充）、`resetModalStackForTests()` |
| P0-2 | `Modal` 新可选 props | `variant?: 'center' \| 'sheet' \| 'drawer' \| 'page'`（默认 center，markup 与今天逐字节一致）、`dismissible?: boolean`（false 时点背景不关，Esc 和 ✕ 仍调 onClose）、`title?: ReactNode`（渲染成 `h2#labelledBy.modal__title`）；sticky `.modal__bar` 里依次是抓手、标题、✕（`aria-label="关闭"`）；保留 `[data-autofocus]` |
| P0-2 | `ConfirmInline` | `{ question, children?, confirmLabel, cancelLabel, onConfirm, onCancel, focus?: 'cancel'\|'confirm' = 'cancel', tone?: 'danger'\|'primary' = 'danger', busy?, busyLabel? }`；DOM 是 `.ci[role=group] > .ci__q + [.ci__detail] + .ci__actions(取消, 确认)`，两个按钮都是 `type="button"`；不处理 Esc，不装 keydown 监听 |
| P0-2 | `useInlineConfirm<T>()` | `{ confirming, ask, dismiss, close, triggerRef }`：`dismiss` 后焦点回到触发按钮，`close` 不移动焦点 |
| P0-2 | `tests/dom/setup.ts` | `afterEach(() => { resetModalStackForTests(); /* P0-5 在这里加清 storage */ })` |
| P0-3 | `src/lib/constants.ts` P0-3 小节 | `TOAST_DURATION_MS 5000`、`TOAST_ACTION_MIN_MS 8000`、`TOAST_MAX_VISIBLE 3`、`VISIBLE_REFRESH_MIN_MS 60000`、`COUNTDOWN_TICK_MS 60000`、`CORE_FEED_LIMIT 50`、`PENDING_STATEMENTS_LIMIT 20` |
| P0-3 | `coreKeys.ts`（纯）/ `coreData.ts` | `CoreKey`、`ALL_CORE_KEYS`、`CHANGE_KEYS`=`VISIBLE_KEYS`=`['leaderboard','records','me']`（`coreData.ts` 也 re-export 这几个）；`CoreData`（含 `pending`）、`loadInitialCore()`、`reloadCore(prev, keys): Promise<ReloadResult>` |
| P0-3 | `useCoreData()` | `{ state: CoreState, refresh(keys?), setMe(user) }`；`ready` 状态带 `stale: StaleInfo \| null`（`{ since, message, keys }`）；刷新串行执行 |
| P0-3 | 刷新 / 标题 / 时钟 | `refreshPolicy.ts`：`shouldRefreshOnVisible`、`visibleRefreshKeys`、`resetCrossed`、`staleMessage`；`useVisibleRefresh`、`useResetWatch`；`tabTitle.ts`：`BASE_TITLE`、`tabTitle(n)`、`todoCount(TodoSource)`；`useTabTitle`；`useNow(intervalMs)` |
| P0-3 | `time.ts` 追加 | `RESET_PENDING_LABEL = '回血中…'`、`formatResetCountdown(iso, now?)`（返回「2天 06:14」\|「06:14」\|「回血中…」）、`formatTimeLeft(iso, now?)`（返回「还有 2 天」…或 `''`） |
| P0-3 | `Toast` | `ToastProvider`、`useToast(): { show(options) => id, dismiss(id) }`（没有 Provider 时是 no-op，`show` 返回 -1）；options 为 `{ message, tone?: 'info'\|'ok'\|'error', action?: { label, onAction }, durationMs? }`；portal 到 body，`role=status`，关闭按钮叫「关闭通知」 |
| P0-3 | `useUndo()` | 返回 `(req: { message, undo: () => Promise<unknown>, undoLabel? = '撤销', undoneMessage? = '已撤销', onUndone? }) => void`；失败时提示 `撤销没成功：${ApiError.message}`，否则「撤销没成功，请稍后重试」 |
| P0-3 | `StaleNotice` | `{ message, onRetry }`，`role="status"`；文案「没刷新出来，显示的是 N 分钟前的数据。」，503 时「系统维护中，暂时只能看，…」 |
| P0-6 | `src/lib/sessionActions.ts`（纯） | `rescheduleImpact(session)`、`isFull(session)`、`goingClosed(session)`、`fullNotice(session)`、`rescheduleConsequences(session)`、`rescheduleSlots(slots, startsAt)`、`parseCustomTime(value)`、`rsvpFeedback(prev, next) → { message, undoable } \| null` |
| P0-6 | `RescheduleSheet` | `{ session: SessionDetail, onClose, onRescheduled(session) }`；`<Modal variant="sheet" title="改到什么时候？">` |
| P0-6 | `constants.ts` P0-6 小节 | `RESCHEDULE_DM_DELAY_MIN = 3`（和 `0005_sessions.sql` 一致，有单测断言）、**`CUSTOM_TIME_LEAD_MS = 60 * 60 * 1000`**（「其他时间」的初值，P0-5 的发起约局也用） |
| P0-4 | `rank.ts` / `feedStats.ts` / `weekStars.ts`（纯） | `competitionRanks(scores)`，[100,100,96] → [1,1,3]；`WEEK_MS`、`weekStartOf`、`inWeek`、`computeTrends`、`computeCounts`；`computeWeekHighlights(records, nextResetAt) → hidden \| stars \| all-clean \| none` |
| P0-4 | 组件新可选 props | `ScoreGauge.tone?: 'tier'\|'neutral'`；`Leaderboard.meId?`、`highlights?`；`RecordsFeed.previewCount?`；`WeeklyReportCard.compact?`；`RulesPanel.open?`/`onOpenChange?`，外加 `<section id="rules">` |
| P0-4 | 新组件 | `WeekHighlights { records, nextResetAt, onSelectUser? }`（不渲染 heading）；`WelcomeCard { loginUrl, discordInviteUrl, onShowRules, weeklyHeal }`（`weeklyHeal` 是计划补充的必填项），用 localStorage `edg.welcome.dismissed` 记住已关闭 |
| P0-4 | 入群链接 | `VITE_DISCORD_INVITE_URL?`；`parseInviteUrl(raw)`（纯）；`env.ts` 的 `DISCORD_INVITE_URL`；`revealSection(id)`；`constants.ts` P0-4 小节：`WEEK_STAR_MIN_ON_TIME 2`、`FEED_PREVIEW_COUNT 10` |
| P0-5 | `shared/scoring.ts` | `REVOKE_WINDOW_MS = 15 min`、`APPEAL_MAX = 500`、`FILED_DM_GRACE_MS = 3 min`（和 `0004_dm.sql` 一致，有断言）；`CASE_STATUS_LABEL.awaiting_statement = '待说明'` |
| P0-5 | 草稿 | `draftShapes.ts`（纯，六类草稿的校验器，以及 `CASE_EXTRA_MAX`/`DISPLAY_NAME_MAX`/`LATE_MINUTES_MAX`）；`drafts.ts`：`draftKey`、`readDraft`、`writeDraft(): boolean`、`clearDraft`、`clearAllDrafts`；`useDraft(kind, id, initial, { validate, isEmpty })`；`useLeaveGuard(dirty, leave) → { requestClose, confirmingLeave, stay, confirmLeave, triggerRef }`；`DraftNote { savedAt, length?, onClear? }`；onboarding 草稿存 sessionStorage，其余存 localStorage，key 都是 `edg.draft.<kind>[.<id>]` |
| P0-5 | 回血 / 撤销 | `forgiveness.ts`：`projectedAfterHeal`、`healPreview`、`healPreviewText`；`revoke.ts`：`revokeMsLeft`、`formatRevokeLeft`；`constants.ts` P0-5 小节：`REVOKE_TICK_MS 30000`、`DRAFT_SAVE_DEBOUNCE_MS 400` |
| P0-5 | 组件 | `AppealSheet { record, onClose, onAppealed }`；`ForgivenessNote { delta, scoreAfter, weeklyHeal, onAppeal? }`；`MyScoreLine { me, rank, config, onOpen? }`；`CaseActions`（从 PlayerDetail 拆出来）；`VerdictCard` 导出 `verdictSourceLabel`；`StatementDialog.score?`、`PlayerDetail.config?`、`DiscordLinkCard.onBeforeBind?` |

已分配的 BEM 块前缀：`.ci`、`.toast(s)`、`.stale`、`.rss`、`.wh`、`.welcome`、`.msl`、`.fgn`、`.aps`、`.draft-note`、`.modal-page`（`.modal-page` 在 P0 只是类名钩子，不写样式）。

### 被测试锁住、P0 会碰到的东西（摘要；完整表在 contract.md §5）

- `modal-focus.test.tsx`：每个打开的 Modal 只装一次 keydown 监听；setup effect 只依赖 `[open]`；Esc 调用的是最新的 onClose。
- `session-rsvp-moved`：两个面板单独渲染，都没有 ToastProvider；「来」在各自面板里唯一；409 时只有一个 alert。
- `deep-link`：首页只有一个 heading 匹配 /约局/；深链之前不发任何非 GET 请求。
- `p8-app:118-130`：改分之后 `/api/records?limit=50` 被请求不止一次，`/api/records/7` 正好一次。`p8-app:132-142`：首登对话框用 Esc 关闭，不加离开确认。
- `player-judge:187-193`：「取消」在 PlayerDetail 里唯一；PlayerDetail 不新增 GET。
- `verdict-privacy`：已有断言不动，只追加。
- `onboarding-roles`：「裁判资格由管理员授予」正好出现 2 次；请求体不变。
- `discord-link`：后端没有 Discord 时请求数正好 1；href 不变；「解绑」后焦点落在「取消」。
- `pages-headers`：CSP 逐字一致。

## 基线测试数字

在 worktree `gamescoreboard-progress-1a2d7a`、`origin/main` = d72e11b（+ 只含文档的 31eb168）上，2026-10-26 实测：

| 项 | 值 |
|---|---|
| Node / npm / TypeScript / Vitest | v24.22.0 / 11.19.1 / 5.9.3 / 3.2.7（命令前先 `export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH`） |
| `npm run typecheck` | 通过（`tsconfig.json`、`tsconfig.worker.json`、`server/tsconfig.json`） |
| unit（`vitest.config.ts`） | 14 个文件 / 178 个用例，全过 |
| dom（`vitest.dom.config.ts`） | 8 个文件 / 54 个用例，全过 |
| worker 抽查 `tests/worker/cases.test.ts` | 36 / 36 |
| 已有噪音 | `onboarding-roles` 有 3 条 React `act(...)` 警告；新 PR 不得新增这类警告 |
| 本地不跑 | `npm run test:pg`、`npm run test:server`（会起嵌入式 Postgres），交给 CI。P0-5 合并前必须在 CI 看到这两套通过 |

按推荐顺序，每个 PR 合并后 main 上的用例数（unit 和 dom 都是「文件数 / 用例数」）。最后一行在一致性检查的合并副本里实测过：

| 合并后 | unit | dom | worker `cases` |
|---|---|---|---|
| 基线 d72e11b | 14 / 178 | 8 / 54 | 36 |
| + P0-1 | 16 / 223 | 8 / 54 | 36 |
| + P0-2 | 16 / 223 | 10 / 86 | 36 |
| + P0-3 | 18 / 249 | 12 / 109 | 36 |
| + P0-6 | 19 / 270 | 13 / 129 | 36 |
| + P0-4 | 23 / 294 | 16 / 165 | 36 |
| + P0-5 | **26 / 326** | **20 / 219** | **37** |

## 怎么执行

1. **一次只做一个 PR，按推荐合并顺序来。** 每个 PR 用 `superpowers:subagent-driven-development` 按它的计划逐个 Task 执行：每个 Task 先写失败的测试，确认它按写明的原因失败，再实现，确认通过，最后 commit。如果不在当前会话里执行，就用 `superpowers:executing-plans`。
2. **开工前**先跑计划的 Task 0：确认依赖已经合进 `origin/main`，从最新的 `origin/main` 开分支，用 grep 核对上游接口都在，把基线用例数记下来，和上表对照。任何一项缺了就停下，不在本 PR 里补别人的文件。
3. **提 PR 前**，rebase 到最新的 `origin/main`，跑完计划「收尾」里的全部步骤：全量验证（typecheck + unit + dom + build；P0-5 另跑 `tests/worker/cases.test.ts`）、手动检查清单、375px 和 1280px 截图（P0-1、P0-4 必须附）。结果和预期对不上就继续修，不开 PR。
4. **PR**：标题用 `feat: <中文描述>（P0-N）`（例：`feat: Modal 层栈、sheet 形态与 ConfirmInline（P0-2）`）。描述写对应的 spec 章节和 PR 编号、锁定测试以外的行为变化、新增测试清单、截图，以及计划里列出的「请机主过目」事项。描述里不加任何署名行。
5. **PR 不能自己合并自己**：执行者只负责开 PR，不运行 `gh pr merge`，不开 auto-merge，不直接 push 到 main。由机主审查后合并；合并之后，下一个 PR 才能从新的 `origin/main` 开分支。
6. 需要机主拍板、已写进各计划 PR 描述要求里的事项：
   - P0-5 隐私第二句要等后端 B1-1 上线才完全成立（P0-5 补充第 14 条）。
   - P0-6 改期后标题不会跟着重新合成（P0-6 补充第 7 条），以及 P0-6 新写的几句文案（补充第 4 条）。
   - P0-3 周报重写失败时的 toast 文案（补充第 12 条）。
   - P0-4 两处只用于 aria-label 的名字（补充第 8 条）。

## 跨 PR 一致性检查记录

### 检查方式

六份 v2 计划都通读了，并对照契约。重点看下面这些：同一文件的同一区域被两个 PR 改；一方消费的名字或签名和提供方的定义不一致；先合并的 PR 用到了后合并的 PR 才提供的东西；重复劳动；不同 PR 之间文案不一致；测试文件重名；行号会因为前一个 PR 而移动。

除了读文本，还做了一次实际合并验证。按推荐顺序把六份计划叠进同一个临时副本（未入库）：

- 底是 P0-5 审查时重放出来的 P0-2/P0-3/P0-5 v2 代码。
- 再以 d72e11b 快照为基，用 `git merge-file` 叠入 P0-1（含 v2 的 Task 9）、P0-4 和 P0-6 的文件。
- `App.tsx` 用脚本把 P0-3 → P0-4 → P0-5 三份计划的「改前 → 改后」片段逐条套上。

修正后的结果：

- typecheck 三个 tsconfig 全过。
- unit 26 / 326 全过，其中 `css-conventions` 13/13，扫到了 P0-2…P0-6 的全部新 CSS。
- dom 20 / 219 全过，只有原有的 3 条 `act(...)` 警告。
- `cases.test.ts` 37/37，`vite build` 成功。

### 发现的问题与处理

1. **P0-1 的 unit 用例数前后不一致。** P0-1 v2 增加了 Task 9（css-conventions 断言 ⑧），收尾是 16 / **223**；P0-2 Task 0 和 P0-4 Task 0 还写着 v1 的 222。→ 两处都改成 223。
2. **绝对用例数是按不同底数写的。** P0-3 的 Task 7 Step 6 和收尾写「基线 54 + … = 71 / 77」，默认 P0-2 还没合；按推荐顺序，P0-3 开工时 P0-2 已经在 main 上了。P0-4、P0-5、P0-6 只写了相对增量。→ P0-3 改成「开工基线 + 增量」，并给出按推荐顺序的数（dom 103 / 109，unit 249），同时注明 P0-2 未合时的数。P0-4、P0-5、P0-6 的 Task 0 和收尾补上按推荐顺序的绝对数。新增上面那张累计表，最后一行实测吻合。
3. **同一个常量写了两遍，其中一处还违反契约 §3.0。** P0-6 在 `constants.ts` 定义 `RESCHEDULE_CUSTOM_LEAD_MS = 1 小时`（改时间的「其他时间」初值），P0-5 又在 `SessionFormDialog.tsx` 里写了局部常量 `CUSTOM_DEFAULT_LEAD_MS = 1 小时`（发起约局的「其他时间」初值）。两者是同一条规则，而契约要求前端时长统一放 `constants.ts`。→ P0-6 先合并，常量改名为通用的 **`CUSTOM_TIME_LEAD_MS`**，注释写明两处共用。P0-5 删掉局部常量，改为 `import { CUSTOM_TIME_LEAD_MS } from '../lib/constants'`。P0-5 的依赖里加上 P0-6，Task 0 多一条 grep，补充里新增第 22 条，写了 P0-6 万一晚合时的退路。改名后在合并副本里实测 typecheck、drafts、organizer-actions 都通过。
4. **P0-6 `RescheduleSheet` 主函数 60 行，违反「函数 < 50 行」。** v2 只说明了原因，没有修。→ 把 PATCH 和 `error`/`busy` 状态抽成文件内的 hook `useMoveSession`（16 行），函数签名收成一行，主函数降到 47 行。DOM、类名、`data-autofocus`、`role="alert"` 都不变。计划里的整文件代码块已换成新版本，「要点」同步更新。合并副本里 organizer-actions 20/20、session-rsvp-moved 2/2、modal-focus 4/4。
5. **`App.tsx` 三个 PR 的片段从来没有按顺序叠在一起验证过。** P0-4 的沙盒以基线 App 为底，不是 P0-3 的 App；P0-5 的 Task 18 只在 P0-3 的 App 上验证过，没有叠上 P0-4。→ 用脚本按顺序套用：P0-4 的 20 处片段和 P0-5 的 7 处片段在前一个 PR 的结果上**全部恰好命中一次**，不需要改片段。行数是 442（P0-3）→ 440（P0-4）→ 454（P0-5），仍在契约「约 450」之内，已写进 P0-5 Task 18。App 级测试在合并副本里全过：board 里的 App 首页用例、my-score-line 里的 App 用例、deep-link、p8-app、discord-link、app-refresh。
6. **P0-5 删 `.sd__notice` 的定位描述会对不上。** P0-1 把这条规则的颜色从 `--faint` 改成了 `--muted`，P0-5 写的是快照行号。→ P0-5 Task 13 Step 5 注明按选择器定位、内容不同也照删。合并时这里是唯一的 CSS 冲突，按删除处理。
7. **`theme.css` 的 coarse 块有两个 PR 改。** P0-2 删 `.modal__close`，P0-4 删 `.hero-card__link,`，P0-1 Task 9 特意不动这个块。→ 核对后，两处的「改前」片段互不重叠，合并后都能命中。P0-1 新增的断言 ⑧ 在 RedBlackBoard 整文件删除之后照常通过。不需要改。
8. **P0-5、P0-6 的新 CSS 从没跑过 `css-conventions`**（它们的沙盒里都没有 P0-1）。P0-6 和 P0-4 的沙盒用的还是旧的 P0-2/P0-3（或 P0-1 v1）实现。→ 在合并副本里，用 P0-1 v2 的测试扫描最终的全部 CSS，13/13 通过；P0-6 的测试在 P0-2/P0-3 的 v2 实现上通过，「已撤销」「撤销没成功：…」等文案也对得上。不需要改。
9. **PR 标题格式不统一。** P0-5 的 `gh pr create` 标题是「P0-5 安全网：…」，其他计划用的是 `feat: …（P0-N）`。→ P0-5 统一为 `feat: 安全网：草稿、申诉、撤销倒计时、回血预告与文案（P0-5）`，本 README「怎么执行」第 4 条定为全部 PR 的规则。

### 核对过、没有冲突的

- **测试文件名**：24 个新测试文件两两不重名，也不和现有的 `tests/unit/*`、`tests/dom/*` 重名。`source-hygiene`（P0-1、P0-5 各追加一个 describe）、`setup.ts`（P0-2 建、P0-5 追加）、`verdict-privacy`、`cases.test.ts` 的共用方式和契约一致。
- **BEM 前缀**都按契约分配，没有和现有前缀撞名。
- **文案在各 PR 之间一致**：「撤销 / 已撤销 / 撤销没成功」、「回血中…」（P0-5 引用 P0-3 的 `RESET_PENDING_LABEL`）、「关闭通知」、「不取消了 / 确认取消」、「继续写 / 先离开」、「立案经过」「待说明」。除了「不做延迟撤回」这类说明文字，计划里没有出现「撤回」。没有新的裸「取消」「确认」按钮。
- **接口名和签名**：`Modal` 的 `variant`/`dismissible`/`title`/`data-autofocus`，`ConfirmInline` 的 props，`useInlineConfirm`，`useToast`/`useUndo`，`useNow`/`formatTimeLeft`，`competitionRanks`，`RulesPanel` 的受控 props，在提供方和消费方的写法一致。合并副本的 typecheck 和测试也证明了这一点。
- **计划里有意偏离契约的地方都保留了**，理由写在各计划的「对契约的补充」里，后面的 PR 也都按偏离后的版本消费：P0-3 的 `coreKeys.ts`、`StaleInfo.keys`、跨重置点拆成两次刷新；P0-4 的 `WelcomeCard.weeklyHeal`、`feedStats.ts`；P0-5 的 `writeDraft` 返回 boolean、`useLeaveGuard.triggerRef`；P0-6 撤销时用「这次回复时的 starts_at」、拆出 `goingClosed`。
- **全部 commit 信息**都是 `<type>: <中文>` 格式，没有署名行。
- **各 PR 都没有越界**改别人的文件：P0-6 不碰 App、theme.css 和 api.ts；P0-4 不碰 PlayerDetail 和 RulesPanel 的文案行；P0-5 不碰 `ROLE_CARDS`、ScoreGauge 和 `time.ts`。

### 计划文件的改动范围

`plan-P0-1.md` 只去掉了审查记录，其余与 v2 相同。其余五份都去掉了审查记录，并做了上面第 1–6、9 条对应的修改。各计划原来的审查记录集中放在 `review-log.md`。
