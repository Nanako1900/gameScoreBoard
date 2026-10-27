# P0 共享契约（P0-1 … P0-6）

> 给六位并行写计划的人用。每个 PR 的计划都必须**按本文件提供或消费接口**；本文件和 spec 冲突时以 spec 为准，但凡是 spec 没写死、本文件写死了的（文件路径、导出名、CSS 名、常量名、key 名），一律以本文件为准，不要各自另起名字。
> 依据：`docs/redesign-v5/spec.md`（已拍板，§11 全部取推荐默认值）、`analysis.md`，以及 2026-10-26 在 worktree `gamescoreboard-progress-1a2d7a` 上读到的代码。下文 `file:line` 均指这个快照。

---

## 1. 基线

| 项 | 值 |
|---|---|
| 代码基线 | `origin/main` = **d72e11b**（Merge PR #17）。worktree 当前分支 `claude/redesign-v5` = d72e11b + **31eb168**（只加了 `docs/redesign-v5/*.md`，不碰代码） |
| ⚠ 本地 `main` 已过期 | 本地 `main` 指向 0798d52（很早的 PR #4），**不要从本地 main 开分支**，一律 `git fetch origin` 后从 `origin/main` 开 |
| 已存在的同名前缀分支 | `claude/p0-bugfixes`、`claude/p0-hardening`（旧项目的 P0，与本轮无关），本轮分支名不得与之重名 |
| Node / npm | v24.22.0 / 11.19.1（命令前缀 `export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH`） |
| TypeScript / Vitest / Vite | 5.9.3 / 3.2.7 / 6.4.3 |
| React / jsdom / RTL / user-event / jest-dom | 18.3.1 / 29.1.1 / 16.3.2 / 14.6.1 / 7.0.0 |
| `npm run typecheck` | **通过**（三个 tsconfig：`tsconfig.json`、`tsconfig.worker.json`、`server/tsconfig.json`） |
| unit（`vitest.config.ts`） | **14 个文件 / 178 个用例全部通过** |
| dom（`vitest.dom.config.ts`） | **8 个文件 / 54 个用例全部通过** |
| worker 抽查（`tests/worker/cases.test.ts`） | 36 / 36 通过（P0-5 会往这个文件加用例） |
| 已有失败 | **无** |
| 已有噪音（不是失败） | `onboarding-roles.test.tsx` 三个用例打印 React `act(...)` 警告（`DiscordLinkCard` 在测试结束后才 setState）。新 PR 不得新增这类警告；不要求顺手修 |
| 没跑的 | `npm run test:pg`、`npm run test:server`（会起嵌入式 Postgres，按要求不跑）。P0-5 改了 `server/src/discord/case-actions.ts` 和 `worker/cases.ts`，**合并前必须由实施者在 CI 里看到这两套通过** |

CI 顺序（`.github/workflows/ci.yml:40-53`）：typecheck → unit → dom → worker → server → pg → build（含 server workspace build）。

---

## 2. 分支、依赖与合并顺序

### 2.1 分支名

| PR | 分支 | 人日 |
|---|---|---|
| P0-1 地基与视觉基础 | `claude/p0-1-foundation` | 1.5 |
| P0-2 Modal 栈、sheet、ConfirmInline | `claude/p0-2-modal-stack` | 2.5 |
| P0-3 数据不崩、Toast、useUndo | `claude/p0-3-data-resilience` | 1.5 |
| P0-4 榜单、本周之星、欢迎卡 | `claude/p0-4-board` | 2 |
| P0-5 安全网（草稿、申诉、回血、常量） | `claude/p0-5-safety-net` | 3 |
| P0-6 详情弹窗里的改时间与取消确认 | `claude/p0-6-organizer-actions` | 1 |

docs 分支 `claude/redesign-v5`（31eb168）建议**最先**合进 main，好让各 PR 描述直接链到 main 上的 spec；P0 代码不依赖它。

### 2.2 依赖图与合并顺序

```
P0-1 ──┬──> P0-2 ──┬──────────────> P0-6
       │           │                 ▲
       └──> P0-3 ──┼─────────────────┘
                   ├──> P0-4 ──┐
                   └───────────┴──> P0-5 (还依赖 P0-2)
```

| PR | 硬依赖（必须已合进 main） | 原因 |
|---|---|---|
| P0-1 | — | |
| P0-2 | P0-1 | modal.css 要用 P0-1 的 token、断点和 hover 约定；P0-1 的 css 约定测试会扫到新 CSS |
| P0-3 | P0-1 | toast.css 同上 |
| P0-6 | P0-2、P0-3 | 嵌套 sheet + ConfirmInline（P0-2）；RSVP toast + useUndo（P0-3） |
| P0-4 | P0-1、P0-3 | 都改 `App.tsx`；P0-4 消费 P0-3 改过的 App 数据形状和 `src/lib/constants.ts` |
| P0-5 | P0-2、P0-3、P0-4 | ConfirmInline / sheet / `dismissible`（P0-2）；`useNow`、`formatTimeLeft`、toast（P0-3）；`App.tsx` 主区域、`rank.ts`、`RulesPanel` 受控 props（P0-4） |

**推荐合并顺序：P0-1 → P0-2 → P0-3 → P0-6 → P0-4 → P0-5。**（P0-2 与 P0-3 可并行开发；P0-6 与 P0-4 可并行开发；P0-6 先合是为了最快的邀请闭环 P0-2 → P0-6 → P2-1/P2-2。）

**规则：每个 PR 在它的全部硬依赖合进 main 之后，才从最新的 `origin/main` 开分支**（`git fetch origin && git switch -c <分支> origin/main`）。不在别人未合并的分支上叠分支；依赖还没合时，只能写计划、不能开工写码。合并前 rebase 到最新 `origin/main`，跑全量 typecheck + unit + dom +（P0-5）worker。

### 2.3 每个 PR 触碰的文件

记号：**新** = 新建，**删** = 删除，其余为修改。

**P0-1**
- `src/main.tsx`（导入顺序）
- `src/theme.css`（token、焦点、forced-colors、hover、按钮）
- `src/app.css` 和 **全部** `src/components/*.css`（断点统一、`:hover` 包进 `@media (hover: hover)`、去掉 `outline:none`/`--focus-ring` 写法、红色文字换 `--danger-text`）
- `tests/unit/source-hygiene.test.ts`（加导入顺序断言）
- 新 `tests/unit/contrast.test.ts`、新 `tests/unit/css-conventions.test.ts`

**P0-2**
- `src/components/Modal.tsx`、`src/components/modal.css`
- 新 `src/lib/modalStack.ts`
- 新 `src/components/ConfirmInline.tsx`、新 `src/components/confirm-inline.css`
- 新 `src/lib/useInlineConfirm.ts`
- `src/theme.css`：**只允许**把 `@media (pointer: coarse)` 里的 `.modal__close` 规则（theme.css:313-316）挪进 modal.css
- `tests/dom/setup.ts`（建立 `afterEach` 块）
- 新 `tests/dom/modal-stack.test.tsx`、新 `tests/dom/confirm-inline.test.tsx`

**P0-3**
- `src/App.tsx`（数据与状态区，见 §2.4）
- 新 `src/lib/coreData.ts`（把 `App.tsx:47-94` 的 `CoreData`/`loadCore` 挪出来并改成按 key 加载）
- 新 `src/lib/useCoreData.ts`
- 新 `src/lib/constants.ts`（前端专用常量，见 §3.0）
- 新 `src/lib/useNow.ts`（取代 `Header.tsx:17-24` 的局部 `useNow`）
- 新 `src/lib/refreshPolicy.ts`（纯函数）、新 `src/lib/useVisibleRefresh.ts`
- 新 `src/lib/tabTitle.ts`（纯函数）、新 `src/lib/useTabTitle.ts`
- `src/lib/time.ts`（**追加** `formatResetCountdown`、`formatTimeLeft`，不改已有函数）
- 新 `src/components/Toast.tsx`、新 `src/components/toast.css`、新 `src/lib/useUndo.ts`
- 新 `src/components/StaleNotice.tsx`、新 `src/components/stale-notice.css`
- `src/components/Header.tsx`（倒计时改分钟级）、`src/components/header.css`（如需）
- 新 `tests/dom/app-refresh.test.tsx`、新 `tests/dom/toast.test.tsx`、新 `tests/unit/refresh-policy.test.ts`、新 `tests/unit/countdown.test.ts`（含 tabTitle）

**P0-4**
- `src/App.tsx`（渲染区，见 §2.4）
- `src/components/Leaderboard.tsx`、`leaderboard.css`
- `src/components/ScoreGauge.tsx`、`score-gauge.css`
- 新 `src/components/WeekHighlights.tsx`、新 `week-highlights.css`；新 `src/lib/weekStars.ts`（纯）；新 `src/lib/rank.ts`（纯）
- **删** `src/components/RedBlackBoard.tsx`、**删** `src/components/red-black-board.css`；`src/theme.css` 只允许删掉 coarse 列表里的 `.hero-card__link`（theme.css:303）
- `src/components/RecordsFeed.tsx`、`records-feed.css`（`previewCount`）
- `src/components/HistoryChart.tsx`、`history-chart.css`
- 新 `src/components/WelcomeCard.tsx`、新 `welcome-card.css`
- `src/components/RulesPanel.tsx`（受控 open + 锚点 id；**不碰** rules-panel 第 36 行文案，那归 P0-5）
- `src/components/WeeklyReportCard.tsx`、`weekly-report.css`（`compact`）
- `src/components/OnboardingDialog.tsx`：**只改** `ROLE_CARDS[0].desc`（OnboardingDialog.tsx:29 的「出现在红黑榜上」，红黑榜删了，改成「出现在信誉榜上」）
- 新 `src/lib/inviteUrl.ts`（纯）、新 `src/lib/env.ts`、`src/vite-env.d.ts`
- `index.html`（description、og:title、og:description）
- 新 `tests/unit/week-stars.test.ts`、新 `tests/unit/rank.test.ts`、新 `tests/unit/invite-url.test.ts`、新 `tests/dom/score-gauge.test.tsx`、新 `tests/dom/board.test.tsx`（Leaderboard + WeekHighlights + WelcomeCard + compact 战报）

**P0-5**
- `shared/scoring.ts`（三个常量 + `CASE_STATUS_LABEL.awaiting_statement` 改「待说明」）
- `worker/cases.ts`（删 `:95` 本地常量改 import；`:398` 截断改 `APPEAL_MAX`）
- `server/src/discord/case-actions.ts`（删 `:40` 本地常量改 import）
- `src/components/PlayerDetail.tsx`（删 `:44` 本地常量；撤销倒计时；申诉改开 AppealSheet；ForgivenessNote；新增可选 `config` prop）
- `src/components/VerdictCard.tsx`（`:86`「裁判陈述」→「立案经过」；`:100-104` withdrawn 不显示缺席）
- `src/components/StatementDialog.tsx`（草稿、提交确认、隐私文案、截止绝对+相对时间、`:100` 改名、判决后 ForgivenessNote、新增可选 `score` prop）
- `src/components/CaseDialog.tsx`、`RollCallDialog.tsx`、`SessionFormDialog.tsx`（草稿 + 离开确认 + `dismissible`）
- `src/components/OnboardingDialog.tsx`（身份草稿恢复；**不碰** `ROLE_CARDS` 文案）、`src/components/DiscordLinkCard.tsx`（新增可选 `onBeforeBind`）
- `src/components/RulesPanel.tsx`：**只改** `:36` 删掉「本地时区」
- 新 `src/components/AppealSheet.tsx`、`ForgivenessNote.tsx`、`MyScoreLine.tsx`、`DraftNote.tsx` 及各自 css
- 新 `src/lib/drafts.ts`、`src/lib/useDraft.ts`、`src/lib/useLeaveGuard.ts`、`src/lib/forgiveness.ts`（纯）、`src/lib/revoke.ts`（纯）
- `src/App.tsx`（插入 MyScoreLine、退出时清草稿、给 PlayerDetail / StatementDialog 传新可选 props）
- `tests/unit/source-hygiene.test.ts`（FILED_DM_GRACE_MS 与 SQL 一致）、新 `tests/unit/forgiveness.test.ts`、新 `tests/unit/revoke.test.ts`
- `tests/worker/cases.test.ts`（追加：超过 500 字的申诉理由截到 500）
- `tests/dom/verdict-privacy.test.tsx`（**只追加** withdrawn 用例，不动已有断言）
- 新 `tests/dom/drafts.test.tsx`、新 `tests/dom/appeal-sheet.test.tsx`、新 `tests/dom/my-score-line.test.tsx`
- `tests/dom/setup.ts`（在 P0-2 建的 `afterEach` 里追加清 storage）

**P0-6**
- `src/components/SessionDetailDialog.tsx`、`session-detail.css`
- 新 `src/components/RescheduleSheet.tsx`、新 `reschedule-sheet.css`
- 新 `src/lib/sessionActions.ts`（纯：改期影响人数、RSVP toast 文案、满员判断）
- 新 `tests/dom/organizer-actions.test.tsx`、新 `tests/unit/session-actions.test.ts`

### 2.4 多 PR 共用的文件与区域归属

| 文件 | 谁碰 | 区域归属（别人不动） |
|---|---|---|
| `src/theme.css` | P0-1（主）；P0-2、P0-4 各一处删除/挪动 | P0-1 拥有全文件。P0-2 只挪 `.modal__close` coarse 规则；P0-4 只删 `.hero-card__link`。**其余 PR 不得往 theme.css 加 token**；缺 token 先在本契约 §3.1 里找，找不到就在自己组件的 css 里写局部变量，并在 PR 描述里提出来 |
| 全部 `src/components/*.css` | P0-1 先全量改一遍；之后各 PR 只改自己组件的 css | P0-1 合并后，各 PR 写新 CSS 必须遵守 §3.1 的断点、hover、焦点约定（P0-1 的 `css-conventions.test.ts` 会拦） |
| `src/App.tsx` | P0-3、P0-4、P0-5 | **P0-3**：import 区里 api/数据相关的行、`App.tsx:45-94`（挪去 `src/lib/coreData.ts`）、`:121-160` 的状态与 refresh、`:231-250` 的 `handleMeUpdated`/`handleChanged`、`:258-281` 的 loading/error 分支、`<Header>` 的 props、main 顶部的 StaleNotice 插槽、`ToastProvider` 包裹、标题/可见性/回血跨点三个 effect。**P0-4**：`:96-119`（`computeTrends`/`computeCounts`，可挪去 `src/lib/`）、`:252-256` 的 memo、`:284-285`（top/bottom 删除）、`:327` RedBlackBoard → 删、`:329-348` WeeklyReportCard（加 `compact`）、`:350-369` 整个 grid（Leaderboard / RulesPanel / RecordsFeed）、未登录时 main 第一位插 WelcomeCard、`rulesOpen` 状态。**P0-5**：`:231-238` `handleLogout` 里加 `clearAllDrafts()`（P0-3 不改这几行的逻辑）、PendingBanner（`:315`）与 SessionsPanel（`:320`）之间插 MyScoreLine、`:401-409` StatementDialog 和 `:447-463` PlayerDetail 的新可选 props。**P0-6**：不碰 |
| `src/components/RulesPanel.tsx` | P0-4、P0-5 | P0-4：`RulesPanelProps` 加可选 `open`/`onOpenChange`，section 加 `id="rules"`；P0-5：只改 `:36` 一行文案 |
| `src/components/OnboardingDialog.tsx` | P0-4、P0-5 | P0-4：只改 `:29` desc；P0-5：state 初始化和保存/关闭逻辑（草稿） |
| `src/components/Modal.tsx` | 仅 P0-2 | 之后的 PR 只消费 |
| `src/components/SessionDetailDialog.tsx` | 仅 P0-6 | P1-1 以后才会加 `variant` |
| `src/components/PlayerDetail.tsx` | 仅 P0-5 | **公开选手页的 ScoreGauge `tone="neutral"` 属于 P1-1，不在 P0-4 里做**（spec §6.2：「P0-4 榜单、P1-1 选手页」）。P0-4 不碰此文件 |
| `src/components/DiscordLinkCard.tsx` | 仅 P0-5 | 只加可选 `onBeforeBind`；`取消`/`确认解绑`/`解绑` 按钮名和焦点落点一律不动 |
| `src/lib/time.ts` | P0-3 追加 | P0-5 只消费；P0-5 如需新格式化函数放 `src/lib/revoke.ts`/`forgiveness.ts`，不改 time.ts |
| `src/lib/constants.ts` | P0-3 新建；P0-4、P0-5、P0-6 各自在文件末尾追加一个带注释标题的小节 | 不改别人小节里的值 |
| `tests/dom/setup.ts` | P0-2 建立 `afterEach`；P0-5 往里追加 | 见 §3.2 |
| `tests/unit/source-hygiene.test.ts` | P0-1、P0-5 | 各自新增一个 `it(...)`，不改已有用例 |

---

## 3. 共享接口

### 3.0 常量放哪里

- **领域常量**（worker、bot、前端都会用到的数）→ `shared/*.ts`，纯模块，不许引用 DOM / Node / Cloudflare 全局。前端用 `@shared/...` 导入；worker 用相对路径 `../shared/scoring`（照 `worker/cases.ts:21`）；server 用 `../../../shared/scoring`（照 `server/src/discord/case-actions.ts:12`）。
- **前端专用常量**（toast 时长、刷新间隔、UI 门槛）→ `src/lib/constants.ts`（P0-3 新建）。初始内容与后续追加：

```ts
// src/lib/constants.ts — frontend-only timings and thresholds. Domain numbers live in shared/.

// --- P0-3 ---
/** A toast without an action disappears after this long. */
export const TOAST_DURATION_MS = 5_000;
/** A toast with an action (撤销) stays at least this long (spec §6.4). */
export const TOAST_ACTION_MIN_MS = 8_000;
export const TOAST_MAX_VISIBLE = 3;
/** Coming back to the tab refetches only when the last refresh is older than this. */
export const VISIBLE_REFRESH_MIN_MS = 60_000;
/** Header / MyScoreLine countdowns tick once a minute (spec §2.1). */
export const COUNTDOWN_TICK_MS = 60_000;
/** Feed size the home page loads — must stay 50: tests pin GET /api/records?limit=50. */
export const CORE_FEED_LIMIT = 50;
export const PENDING_STATEMENTS_LIMIT = 20;

// --- P0-4 ---
/** 本周之星: at least this many 守约守时 bonuses this week (spec §5 #1). */
export const WEEK_STAR_MIN_ON_TIME = 2;
/** The home feed shows this many rows before 看更多. */
export const FEED_PREVIEW_COUNT = 10;

// --- P0-5 ---
/** Revoke countdowns refresh this often (spec §5 #6). */
export const REVOKE_TICK_MS = 30_000;
/** Debounce between a keystroke and the draft write. */
export const DRAFT_SAVE_DEBOUNCE_MS = 400;

// --- P0-6 ---
// （如需，追加在这里）
```

- 断点只写在 CSS 里（见 §3.1）。P0 里没有任何 JS 需要判断视口宽度（sheet 贴底、drawer 退化全靠 CSS），所以**不加 JS 断点常量**；P0-2 也不建 `constants.ts`，该文件由 P0-3 新建。

### 3.1 P0-1 提供：token、焦点、断点、hover

**main.tsx 导入顺序**（H8）：`import './theme.css';` 必须在 `import { App } from './App';` 之前。`source-hygiene.test.ts` 新增断言：在 `src/main.tsx` 源码里 `'./theme.css'` 的位置早于 `'./App'`。

**token 全表**（写在 `src/theme.css` 的 `:root`；分两层，注释写明「primitive / semantic」，为将来的浅色主题留口子；`color-scheme: dark` 保留）：

*Primitive 层（已有的名字和值不变，除注明的以外）*

| token | 值 | 备注 |
|---|---|---|
| `--bg` | `#0a0e14` | 不变 |
| `--bg-elevated` | `#0d131c` | 不变 |
| `--panel` | `#141a24` | 不变 |
| `--panel-2` | `#182030` | 不变 |
| `--border` | `#232b3a` | 不变 |
| `--border-strong` | `#2f3a4d` | 不变 |
| `--border-input` | **`#66738a`**（新增） | 输入框、复选框、可点 chip 的边框；对 bg/panel/panel-2 ≈ 4.04/3.64/3.40 |
| `--text` | `#e6edf3` | 不变 |
| `--muted` | `#8b96a5` | 不变 |
| `--faint` | **`#848fa0`**（原 `#5c6675`） | 对 bg/panel/panel-2 ≈ 5.91/5.33/4.98 |
| `--gold` | `#f5c542` | 不变 |
| `--gold-dim` | `#b8912a` | 不变 |
| `--red` | `#e5484d` | 不变，**只用于填充和边框** |
| `--red-dim` | `#a5343a` | 不变 |
| `--danger-text` | **`#ff6b6f`**（新增） | 红色文字一律用它；对 bg/panel/panel-2 ≈ 6.99/6.30/5.89 |
| `--blue` | `#4aa3ff` | 不变 |
| `--green` | `#3ddc84` | 不变 |
| `--amber` | **`#ff8a3d`**（新增） | `--attn` 的底色 |
| `--focus` | **`#8ab4ff`**（新增） | 焦点环 |
| `--up` | `#3ddc84` | 不变 |
| `--down` | **`var(--danger-text)`**（原 `#e5484d`） | 扣分数字是文字，跟着 `--danger-text` |

*Semantic 层（新增；新写的 CSS 优先用这一层）*

| token | 值 | 只用于（spec §6.2） |
|---|---|---|
| `--action` | `var(--gold)` | 主操作按钮、当前导航项 |
| `--attn` | `var(--amber)` | 需要你处理、截止不到 2 小时、改时间了、dm_ok=0 |
| `--ok` | `var(--green)` | 来、准时、加分、回血、满员 |
| `--neutral` | `var(--muted)` | 待定、没回、不来、已取消（**不来不用红**） |
| `--danger` | `var(--red)` | 危险按钮的填充/描边、扣分；**永远不给人上色** |
| `--info` | `var(--blue)` | Discord、链接、AI 来源 |
| `--score-chip-bg` | `var(--panel-2)` | 公开分数 chip / 公开 ScoreGauge 底 |
| `--score-chip-fg` | `var(--text)` | 公开分数 chip 文字、neutral ScoreGauge 圆环 |

*其他新增（给 P0-2/P0-3 用，P0-1 一并定义，免得后面再改 theme.css）*

| token | 值 |
|---|---|
| `--z-modal` | `100`（现 `.modal` 的 z-index） |
| `--z-toast` | `200` |
| `--safe-bottom` | `env(safe-area-inset-bottom, 0px)` |
| `--sheet-max-h` | `92dvh` |
| `--tap-min` | `44px` |

*字号（6 档 + hero；spec §6.3）* —— 只定义，**旧的 `--text-*` 保留不动**（标注 deprecated），各组件换皮时再改用：

| token | 值 | 对应 |
|---|---|---|
| `--fs-xs` | `0.75rem` | 12px，只用于时间戳等次要信息 |
| `--fs-sm` | `0.875rem` | 14px |
| `--fs-md` | `1rem` | 16px，正文/输入框 |
| `--fs-lg` | `1.125rem` | 18px |
| `--fs-xl` | `1.375rem` | 22px |
| `--fs-2xl` | `1.75rem` | 28px |
| `--fs-hero` | `3rem` | 48px，只给 MyScoreCard 和选手页分数 |

*字体栈*：`--font-display: 'Rajdhani', 'PingFang SC', 'Noto Sans SC', 'Microsoft YaHei', system-ui, sans-serif;` `--font-body` 在 `'PingFang SC'` 后补 `'Noto Sans SC'`。`--font-num` 不变。

*按钮*：theme.css 新增 `.btn--danger-outline`（透明底、`border-color: var(--danger)`、`color: var(--danger-text)`）——ConfirmInline 的危险确认（「确认取消」等）用它。其余按钮类不改名。

**焦点（H9）**
```css
:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
```
- 删掉 `--focus-ring` token 及其 4 处用法（theme.css:141-149、`case-dialog.css:150-151`、`session-form.css:94-95,184-185`；`:has(:focus-visible)` 的 chip 改成 `outline: 2px solid var(--focus); outline-offset: 2px;`），删掉 `onboarding-dialog.css:163-164` 的 `outline: none`。
- 之后任何 PR **不得**写 `outline: none` / `outline: 0`，也不得用 box-shadow 充当焦点环。
- `@media (forced-colors: active)`：`:focus-visible { outline-color: Highlight; }`；`.btn, input, select, textarea { border-color: ButtonText; }`；状态 chip（`.feed-row__status`、`.sdt__chip`、`.tier-badge` 等）加 `border: 1px solid CanvasText`。

**断点（600 / 1024）**——项目没有 PostCSS custom-media 插件，**不能用 `@custom-media`**；也不用 range 语法（`width <= 600px`），一律写字面量，并且只允许下面四种写法：

| 用途 | 写法 |
|---|---|
| 手机（≤600） | `@media (max-width: 600px)` |
| 手机以上 | `@media (min-width: 601px)` |
| 桌面以下（<1024） | `@media (max-width: 1023px)` |
| 桌面（≥1024） | `@media (min-width: 1024px)` |

现有的 480 / 520 / 560 / 720 / 900（共 18 处）由 P0-1 全部归并到上表。`prefers-reduced-motion`、`pointer: coarse`、`hover: hover`、`forced-colors` 不算断点，照常用。

**hover 约定**：所有含 `:hover` 的规则必须写在 `@media (hover: hover) { … }` 里（`:active`、`:focus-visible` 不受限）。只靠 hover 才出现的信息必须同时有点按或焦点的出路。触控尺寸继续用 `@media (pointer: coarse)` 判断（theme.css:287-290 的注释保留）。

**P0-1 新增测试**
- `tests/unit/contrast.test.ts`：读 `src/theme.css`，从 `:root` 抽出 `--name: #hex`，用 WCAG 相对亮度公式断言：`--faint`、`--muted`、`--danger-text` 在 `--bg`/`--bg-elevated`/`--panel`/`--panel-2` 上 ≥ 4.5；`--border-input` 在同四者上 ≥ 3；`--focus` 在 `--bg`/`--panel-2` 上 ≥ 3。（已核算：上表数值全部满足。）对比度函数写在测试文件里，不进 src。
- `tests/unit/css-conventions.test.ts`：扫描 `src/**/*.css`，断言 ① `@media` 里出现的 `max-width`/`min-width` 只有上表四种；② 每条含 `:hover` 的选择器都处在 `@media (hover: hover)` 块内（用花括号深度扫描即可）；③ 没有 `outline: none` / `outline: 0`；④ 没有 `var(--focus-ring)`。后续 PR 的 CSS 自动受它约束。
- `tests/unit/source-hygiene.test.ts`：新增导入顺序用例（见上）。

### 3.2 P0-2 提供：Modal 栈、variant、ConfirmInline

**`src/lib/modalStack.ts`**（模块级状态，用不可变数组替换，不原地 push）
```ts
export type LayerId = number;
/** Register a newly opened layer on top of the stack. */
export function pushLayer(): LayerId;
/** Remove a layer wherever it sits (out-of-order unmounts and StrictMode re-runs are safe). */
export function popLayer(id: LayerId): void;
/** Only the top layer handles Escape and Tab. */
export function isTopLayer(id: LayerId): boolean;
export function layerCount(): number;
/** Ref-counted `inert` + `aria-hidden` on #root (moved here from Modal.tsx:16-38, same semantics). */
export function acquireRootInert(): void;
export function releaseRootInert(): void;
/** Tests only: empty the stack, zero the inert count, strip inert/aria-hidden from #root. Idempotent. */
export function resetModalStackForTests(): void;
```

**`src/components/Modal.tsx`**（签名只加可选 props，`open/onClose/labelledBy/children/size` 一个不改）
```ts
export type ModalVariant = 'center' | 'sheet' | 'drawer' | 'page';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Default 'center' — exactly today's behaviour and markup. */
  variant?: ModalVariant;
  /** Default true. false: a backdrop press does nothing; Escape and ✕ still call onClose (the caller decides, e.g. shows a leave confirm). */
  dismissible?: boolean;
  /** Optional: rendered as <h2 id={labelledBy} className="modal__title"> inside .modal__bar. A caller that passes it must not render its own element with that id. */
  title?: React.ReactNode;
}
```

语义（spec §6.4）：

| variant | portal 到 body | `#root` inert | 焦点陷阱 | 入栈 | Esc | 关闭后还原焦点 | 锁 body 滚动 |
|---|---|---|---|---|---|---|---|
| `center`（默认） | 是 | 是 | 是 | 是 | 栈顶才关 | 是 | 是 |
| `sheet` | 是 | 是 | 是 | 是 | 栈顶才关 | 是 | 是 |
| `drawer` | 是 | 是 | 是 | 是 | 栈顶才关 | 是 | 是 |
| `page` | **否**（原地渲染） | **否** | **否** | **否** | **不关** | 否 | 否 |

- setup effect 仍然**只依赖 `[open]`**，`onCloseRef` 保留（`modal-focus.test.tsx:63-75` 数 keydown 监听次数）。每个打开的 Modal 仍然只装一个 document keydown 监听，处理函数第一行 `if (!isTopLayer(layerId)) return;`。
- `sheet`：`≤600px` 贴底、`max-height: var(--sheet-max-h)`、内部滚动、底部留 `var(--safe-bottom)`；`≥601px` 与 center 一样居中。`drawer`：`≥1024px` 右侧 480px 抽屉；`<1024px` 退化成 sheet（P0 无消费者，P1-1 首用）。
- `page`：渲染 `<section className="modal-page" aria-labelledby={labelledBy} tabIndex={-1}>{children}</section>`；打开时聚焦 `document.getElementById(labelledBy)`（调用方给标题加 `tabIndex={-1}`），找不到就聚焦 section。不渲染 ✕（返回靠 P1-1 的 PageBar）。P0 无消费者，只在测试里验证。
- 「手机上最多叠两层」是给调用方的规则：P0 里的嵌套只有 SessionDetail→RollCall、SessionDetail→RescheduleSheet、PlayerDetail→AppealSheet，都是两层。

**markup**

`center` 且没有 `title`：与现在逐字一致（`.modal > .modal__panel.panel.modal__panel--{size}[role=dialog][aria-modal][aria-labelledby][tabIndex=-1] > button.modal__close[aria-label="关闭"] + children`）。

`sheet` / `drawer`，或任何带 `title` 的非 page：
```html
<div class="modal modal--sheet">                         <!-- modal--drawer / modal--center -->
  <div class="modal__panel panel modal__panel--md modal__panel--sheet"
       role="dialog" aria-modal="true" aria-labelledby="…" tabindex="-1">
    <div class="modal__bar">                              <!-- position: sticky; top: 0 -->
      <span class="modal__grabber" aria-hidden="true"></span>   <!-- 只有 sheet 有 -->
      <h2 id="…" class="modal__title">…</h2>              <!-- 只有传了 title 才有 -->
      <button type="button" class="modal__close" aria-label="关闭">✕</button>  <!-- 恒为 var(--tap-min) 见方 -->
    </div>
    <div class="modal__body">…children…</div>
  </div>
</div>
```
✕ 的可访问名保持「关闭」。类名 `.modal`、`.modal__panel`、`.modal__panel--{sm|md|lg}`、`.modal__close` 不改名。

**`src/components/ConfirmInline.tsx`**（+ `confirm-inline.css`，块前缀 `.ci`）——原地确认，替换触发按钮所在的位置，不是弹层：
```ts
export interface ConfirmInlineProps {
  /** 「取消这局？」 Also the group's aria-label. */
  question: string;
  /** Detail text or extra fields (e.g. P2's cancel reason), between the question and the buttons. */
  children?: React.ReactNode;
  confirmLabel: string;   // 「确认取消」
  cancelLabel: string;    // 「不取消了」
  onConfirm: () => void;
  onCancel: () => void;
  /** Which button takes focus on mount. Default 'cancel' (DiscordLinkCard's way); 'confirm' is AdminScoreForm's way. */
  focus?: 'cancel' | 'confirm';
  /** 'danger' → .btn--danger-outline (default); 'primary' → .btn--gold. */
  tone?: 'danger' | 'primary';
  busy?: boolean;         // disables both buttons; the confirm shows busyLabel
  busyLabel?: string;
}
```
- DOM：`<div class="ci" role="group" aria-label={question}><p class="ci__q">…</p><div class="ci__detail">children</div><div class="ci__actions"><button cancel/><button confirm/></div></div>`。**DOM 顺序 = 先取消后确认**（视觉同序）。
- 焦点：挂载时（`useEffect([])`）聚焦 `focus` 指定的按钮，只聚焦一次。**取消后焦点回到触发按钮由调用方负责**，用下面的 hook。
- 不处理 Esc（Esc 归 Modal 栈）；不 `preventDefault` 任何东西。
- **新的 ConfirmInline 一律不用裸的「取消」「确认」作按钮名**（这两个名字被 `discord-link:113`、`onboarding-roles:75`、`player-judge:192` 锁定，且要求在各自范围内唯一）。
- `DiscordLinkCard`、`AdminScoreForm` 在 P0 不迁移。

**`src/lib/useInlineConfirm.ts`**
```ts
export function useInlineConfirm<T extends HTMLElement = HTMLButtonElement>(): {
  confirming: boolean;
  /** Show the confirm (the trigger unmounts). */
  ask: () => void;
  /** Back out: hide the confirm, then focus the trigger again after the re-render. */
  dismiss: () => void;
  /** Done (after a successful confirm): hide without moving focus. */
  close: () => void;
  triggerRef: React.RefObject<T>;
};
```

**`tests/dom/setup.ts`**（P0-2 建立，后续 PR 往同一块里追加）
```ts
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { resetModalStackForTests } from '../../src/lib/modalStack';

afterEach(() => {
  // Runs after Testing Library's own cleanup has unmounted everything (hooks run in stack order).
  resetModalStackForTests();
  // P0-5: window.localStorage.clear(); window.sessionStorage.clear();
  // P1-1: resetRouterForTests();
});
```

**P0-2 测试**：`modal-focus.test.tsx` 原样通过；新增 `tests/dom/modal-stack.test.tsx`（嵌套时 Esc 只关上层、Tab 只在上层循环、关上层后焦点回到下层里的触发元素、`dismissible={false}` 时点背景不关但 Esc 仍调 onClose、page 形态不加 inert / 不困焦点 / Esc 不关 / 聚焦标题、reset 后 `#root` 没有 inert）；`tests/dom/confirm-inline.test.tsx`（两种焦点落点、DOM 顺序、busy、useInlineConfirm 取消后焦点回触发按钮）。

### 3.3 P0-3 提供：数据层、Toast、useUndo、刷新、标题、倒计时

**`src/lib/coreData.ts`**（从 `App.tsx:47-94` 挪出；首屏请求的 URL 一个不改）
```ts
export type CoreKey = 'config' | 'leaderboard' | 'records' | 'me' | 'report';

export interface CoreData {
  config: Config;
  participants: PublicUser[];
  records: RecordItem[];          // GET /api/records?limit=50 (CORE_FEED_LIMIT)
  me: User | null;
  /** New: /api/me's counts, kept for the tab title. */
  pending: PendingCounts;
  myPending: RecordItem[];        // follow-up of 'me' (mine=pending, PENDING_STATEMENTS_LIMIT)
  invites: SessionItem[];         // follow-up of 'me' (/api/me/invites, failure → [])
  report: WeeklyReport | null;    // failure → null, never fatal (as today)
}

export const ALL_CORE_KEYS: readonly CoreKey[];          // 首次加载、错误页「重新加载」
/** After any write a child reports via onChanged (incl. admin 改分/设裁判/改判/撤销). */
export const CHANGE_KEYS: readonly CoreKey[];            // ['leaderboard', 'records', 'me']
/** Tab became visible again: no config (spec §5 #10). */
export const VISIBLE_KEYS: readonly CoreKey[];           // ['leaderboard', 'records', 'me']

/** First load: all keys, Promise.all — any failure is fatal (today's behaviour). */
export function loadInitialCore(): Promise<CoreData>;
/**
 * Refresh: fetch only `keys` with Promise.allSettled and merge fulfilled parts into a NEW object
 * (untouched parts keep their identity). Never throws: failures come back in `failed`.
 */
export function reloadCore(
  prev: CoreData,
  keys: readonly CoreKey[],
): Promise<{ data: CoreData; failed: readonly { key: CoreKey; error: unknown }[] }>;
```
`'me'` 键同时负责它的两个后续请求（myPending、invites），条件与今天一致（`App.tsx:75-84`）。

**`src/lib/useCoreData.ts`**
```ts
export type CoreState =
  | { status: 'loading' }
  | { status: 'error'; message: string }                       // only when nothing was ever loaded
  | {
      status: 'ready';
      data: CoreData;
      loadedAt: number;                 // last fully successful refresh (ms)
      stale: { since: number; message: string } | null;  // a refresh failed: old data stays on screen
    };

export function useCoreData(): {
  state: CoreState;
  /** No keys = ALL_CORE_KEYS. With data on screen a failure only sets `stale`. */
  refresh: (keys?: readonly CoreKey[]) => Promise<void>;
  /** Optimistic local update after OnboardingDialog saves (today's handleMeUpdated). */
  setMe: (user: User) => void;
};
```
- App 里：`handleChanged = () => { void refresh(CHANGE_KEYS); setSessionsKey(n => n + 1); }`（签名仍是 `() => void`）；周报重写成功后 `refresh(['report'])`；`handleMeUpdated` = `setMe(user)` + `refresh(CHANGE_KEYS)`。
- `p8-app.test.tsx:128`（改分后 `/api/records?limit=50` ≥ 2 次）靠 `CHANGE_KEYS` 含 `'records'` 保证。
- stale 提示：`<StaleNotice message onRetry />`（`src/components/StaleNotice.tsx`，`role="status"`，**不用 alert**），放在 main 最顶（各 notice 之前）。文案：`没刷新出来，显示的是 ${n} 分钟前的数据。`（n<1 时写「刚才的数据」）+ 按钮「重试」；503 时：`系统维护中，暂时只能看，显示的是 ${n} 分钟前的数据。` 重试 = `refresh(VISIBLE_KEYS)`。

**App 外层**：`export function App(): JSX.Element { return <ToastProvider><AppMain /></ToastProvider>; }`，`AppMain` 是今天的函数体（不导出）。App 签名不变。

**可见性刷新**
```ts
// src/lib/refreshPolicy.ts (pure, unit-tested)
export function shouldRefreshOnVisible(lastRefreshAt: number, now: number, minIntervalMs: number): boolean;
/** VISIBLE_KEYS, plus 'config' once now has passed config.nextResetAt (the weekly heal is due). */
export function visibleRefreshKeys(nextResetAt: string, now: number): readonly CoreKey[];
/** True once per nextResetAt value that `now` has passed (caller remembers the last value it acted on). */
export function resetCrossed(nextResetAt: string, now: number, lastHandled: string | null): boolean;

// src/lib/useVisibleRefresh.ts
export function useVisibleRefresh(onVisible: () => void, minIntervalMs?: number /* = VISIBLE_REFRESH_MIN_MS */): void;
```
可见性刷新还要 `setSessionsKey(n => n + 1)`（约局列表也刷新）。跨过 `nextResetAt` 时（由分钟 tick 检测）`refresh(['config', 'leaderboard', 'me'])`，每个 `nextResetAt` 值只触发一次；等待期间倒计时显示「回血中…」，任何地方都不显示负数。

**倒计时**
```ts
// src/lib/useNow.ts
/** Re-renders every `intervalMs`, first tick aligned to the next multiple of intervalMs (all minute clocks flip together). */
export function useNow(intervalMs: number): number;

// src/lib/time.ts — appended, pure; existing functions unchanged
/** Header: '2天 06:14' | '06:14' | '回血中…' (done). Minute precision. */
export function formatResetCountdown(targetIso: string, now?: number): string;
/** Prose: '还有 2 天' | '还有 5 小时' | '还有 12 分钟' | '还有不到 1 分钟' | '' (done). */
export function formatTimeLeft(targetIso: string, now?: number): string;
```
Header 用 `useNow(COUNTDOWN_TICK_MS)` + `formatResetCountdown`；Header 的 props 签名不变，`aria-label="距离每周恢复"` 与「每周恢复」标签不变。`formatCountdown`（秒级）保留不删。

**标签页标题**
```ts
// src/lib/tabTitle.ts (pure)
export const BASE_TITLE = 'EDG 信誉分';
export function tabTitle(count: number): string;          // 0 → 'EDG 信誉分'；4 → '(4) EDG 信誉分'
export function todoCount(data: Pick<CoreData, 'me' | 'invites' | 'pending'>): number;
// = invites.length + pending.statements + (me?.is_admin ? pending.appeals : 0)；未登录 0
// src/lib/useTabTitle.ts
export function useTabTitle(count: number): void;         // sets document.title; restores BASE_TITLE on unmount
```

**Toast**（`src/components/Toast.tsx` + `toast.css`，块前缀 `.toast`）
```ts
export type ToastTone = 'info' | 'ok' | 'error';
export interface ToastAction { label: string; onAction: () => void; }
export interface ToastOptions {
  message: string;
  tone?: ToastTone;                // default 'info'
  action?: ToastAction;            // e.g. { label: '撤销', … }
  durationMs?: number;             // default TOAST_DURATION_MS; with an action at least TOAST_ACTION_MIN_MS
}
export interface ToastApi {
  show: (options: ToastOptions) => number;   // returns the toast id
  dismiss: (id: number) => void;
}
export function ToastProvider({ children }: { children: React.ReactNode }): JSX.Element;
/** Outside a provider (components rendered alone in tests) returns a no-op api: show() returns -1. */
export function useToast(): ToastApi;
```
- 视口用 `createPortal` 挂到 `document.body`（**不在 `#root` 里**：Modal 会给 `#root` 加 inert/aria-hidden）。一个始终存在的容器 `<div class="toasts" role="status" aria-live="polite">`，`z-index: var(--z-toast)`，底部留 `var(--safe-bottom)`。
- **任何 tone 都不用 `role="alert"`**（多个测试 `findByRole('alert')` 要求唯一）。错误仍然由各组件内联的 `role="alert"` 表达，toast 只是补充反馈。
- 鼠标悬停或焦点进入时暂停计时，离开后继续；toast 内按钮可聚焦；每条有关闭按钮，可访问名「关闭通知」（**不是**「关闭」，避免和 Modal 的 ✕ 重名）。最多同时显示 `TOAST_MAX_VISIBLE` 条，新的在下。
- 已知限制（写进组件注释）：center/sheet 打开时焦点陷阱不包括 toast，键盘用户够不到 toast 里的按钮——所以 toast 里的每个操作都必须在界面上另有入口（spec §6.4、WCAG 2.2.1）。

**useUndo**（`src/lib/useUndo.ts`）
```ts
export interface UndoRequest {
  message: string;                   // 「已改成：不来」
  undo: () => Promise<unknown>;      // the reverse write
  undoLabel?: string;                // default '撤销'
  undoneMessage?: string;            // default '已撤销'
  onUndone?: () => void;             // e.g. reload + onChanged
}
/** Shows a toast with an undo action; on failure shows `撤销没成功：${ApiError.message}` (else '撤销没成功，请稍后重试'). */
export function useUndo(): (request: UndoRequest) => void;
```

**P0-3 测试**：首屏请求 URL 集合不变；`p8-app` 全部原样通过；新增 `tests/dom/app-refresh.test.tsx`（第二次加载 500 时榜单还在且出现 role=status 提示；跨过 nextResetAt 后重拉 `/api/config`，倒计时不出现负数；隐藏→可见不足 60 秒不刷新、超过才刷新且不请求 config）；`tests/dom/toast.test.tsx`（无 provider 时 no-op、带操作至少 8 秒、悬停暂停、portal 在 #root 外）；`tests/unit/refresh-policy.test.ts`；`tests/unit/countdown.test.ts`（`formatResetCountdown`、`formatTimeLeft`、`tabTitle`、`todoCount`）。

### 3.4 P0-4 提供：榜单、本周之星、ScoreGauge tone、WelcomeCard

**ScoreGauge**（只加可选 prop）
```ts
interface ScoreGaugeProps {
  score: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
  /** Default 'tier' — today's colour and aria-label. 'neutral': ring uses --score-chip-fg, no --tier is set,
   *  aria-label is `${label} ${value} 分` (no 段位). Everyone but the viewer themself gets 'neutral'. */
  tone?: 'tier' | 'neutral';
}
```
neutral 时根元素加类 `gauge--neutral`。P0 里只有 Leaderboard 传 `neutral`（公开选手页是 P1-1）。

**排名**（`src/lib/rank.ts`，纯）
```ts
/** Competition ranking on a list already sorted by score desc: [100,100,96] → [1,1,3]. */
export function competitionRanks(scores: readonly number[]): number[];
```
P0-5 的 MyScoreLine 复用它。

**Leaderboard**（只加可选 props）
```ts
interface LeaderboardProps {
  participants: PublicUser[];
  trends: Record<string, number>;
  counts: Record<string, number>;
  onSelect: (id: string) => void;
  /** The viewer: their row is highlighted and is the only one with a TierBadge. */
  meId?: string | null;
  /** Rendered between .lb__head and the list (WeekHighlights in P0; BoardMini's head from P3). */
  highlights?: React.ReactNode;
}
```
行按钮的 aria-label 规则 `第 ${rank} 名 ${username}，${score} 分` 保留（rank 改为同分同名次）；不发奖牌；分数数字在任何宽度都显示；62px 圆环 `tone="neutral"`，只在 `min-width: 1024px` 显示。

**本周之星**（`src/lib/weekStars.ts`，纯，单测 `tests/unit/week-stars.test.ts`）
```ts
export interface WeekStar { user: UserRef; onTime: number; }
export type WeekHighlightsResult =
  | { kind: 'hidden' }                                    // feed 不覆盖整周 → 整行不渲染
  | { kind: 'stars'; stars: readonly WeekStar[] }         // 「⭐ 本周之星：阿杰（准时 3 次）、小红（准时 2 次）」
  | { kind: 'all-clean' }                                 // 没人达标、本周也没有已判决扣分 → 「本周全员守约 🎉」
  | { kind: 'none' };                                     // 「本周还没人摘星，今晚去约一局？」
export function computeWeekHighlights(
  records: readonly RecordItem[],
  nextResetAt: string,
): WeekHighlightsResult;
```
规则（spec §5 第 1 条）：周起点 = `parseTimestamp(nextResetAt) − 7 天`（与 `App.tsx:97-98` 的 `computeTrends` 同口径）。**门槛**：feed 里最旧一条的 `created_at` 早于周起点才计算，否则 `hidden`（空 feed 也是 `hidden`）。**之星**：本周 `type === 'on_time_bonus'` 且 `affectsScore(status)` 的记录 ≥ `WEEK_STAR_MIN_ON_TIME` 次，并且本周没有 `affectsScore` 且 `delta < 0` 的记录；并列全部列出，按次数降序、同次数按在 feed 里首次出现的顺序（**不按名字排**）；分数高低不参与。任何结果里都不出现「鸽王」。

**WeekHighlights**（`src/components/WeekHighlights.tsx` + `week-highlights.css`，块前缀 `.wh`）
```ts
interface WeekHighlightsProps {
  records: readonly RecordItem[];
  nextResetAt: string;
  onSelectUser?: (id: string) => void;
}
```
`hidden` 时返回 `null`。**不渲染任何 heading**（避免和 `/约局/`、`信誉榜` 标题冲突）。P0 里经 `Leaderboard.highlights` 放进榜单头部。

**RecordsFeed**（只加可选 prop）：`previewCount?: number` —— 先显示前 N 条，后面一个按钮「看更多」展开已加载的全部。App 传 `FEED_PREVIEW_COUNT`。`.feed-row__status--escalate` 类名不变。

**WeeklyReportCard**（只加可选 prop）：`compact?: boolean` —— 只显示标题、日期、两三个数字和叙事第一句；**compact 时不渲染任何 `.wr-award`**（含「本周鸽王」）。h2 文案规则（/上周战报/、/往期战报/）、`stale` 提示「上周的战报周一 10:30 之后发布。」不变。App 首页传 `compact`。

**RulesPanel**（只加可选 props）：`open?: boolean; onOpenChange?: (open: boolean) => void;`（不传时保持今天的内部状态），`<section>` 加 `id="rules"`。

**WelcomeCard**（`src/components/WelcomeCard.tsx` + `welcome-card.css`，块前缀 `.welcome`）
```ts
interface WelcomeCardProps {
  loginUrl: string;                 // AUTH_LOGIN_URL
  discordInviteUrl: string | null;  // null → 「还没进 Discord 群？加入服务器 ↗」整行隐藏
  onShowRules: () => void;          // P0: App sets rulesOpen = true and scrolls #rules into view
}
```
只在未登录时渲染，位置是 main 的第一块（各 notice 之后）。可关闭，localStorage `edg.welcome.dismissed = '1'`（读写都 try/catch，照 `WeeklyReportCard.tsx:16-32`）。文案取 spec §3.1；按钮「用 Nanako 账号登录」是 `<a href={loginUrl}>`；「30 秒看懂 ›」是按钮。**标题不得包含「约局」二字**。

**Discord 入群链接**
```ts
// src/vite-env.d.ts — ImportMetaEnv 新增
/** Public page that hands out a Discord invite (recommended https://discord.nanako.org). Unset → entry hidden. */
readonly VITE_DISCORD_INVITE_URL?: string;

// src/lib/inviteUrl.ts (pure, unit-tested): only an absolute https: URL is accepted, else null
export function parseInviteUrl(raw: string | undefined): string | null;
// src/lib/env.ts (reads import.meta.env; DOM project only)
export const DISCORD_INVITE_URL: string | null; // = parseInviteUrl(import.meta.env.VITE_DISCORD_INVITE_URL)
```

**index.html**：description 改「EDG 开黑大厅：约局、报名、守约记录。」；新增 `<meta property="og:title" content="EDG 信誉分" />`、`<meta property="og:description" content="EDG 开黑大厅：约局、报名、守约记录。" />`。

### 3.5 P0-5 提供：常量迁移、草稿、申诉、回血、撤销倒计时

**`shared/scoring.ts` 新增**（行为不变，只换定义位置；申诉截断是唯一的行为变化 1000 → 500）
```ts
/** A reporter may revoke a decided record within this long of filing it (created_at). Admins: any time. */
export const REVOKE_WINDOW_MS = 15 * 60 * 1000;
/** Appeal reason cap — the bot's modal, the web's maxLength and appealCase's truncation. */
export const APPEAL_MAX = 500;
/** The filing DM waits this long, so an instant withdrawal never DMs.
 *  MUST equal `interval '3 minutes'` in server/migrations/0004_dm.sql (asserted in source-hygiene). */
export const FILED_DM_GRACE_MS = 3 * 60 * 1000;
```
现状与迁移：

| 常量 | 现在 | 改成 |
|---|---|---|
| `REVOKE_WINDOW_MS` | `worker/cases.ts:95`、`src/components/PlayerDetail.tsx:44` 各一份 | 两处删掉，分别 `import … from '../shared/scoring'` / `'@shared/scoring'` |
| `APPEAL_MAX` | 只有 `server/src/discord/case-actions.ts:40`（用于 `:123` 的 maxLength） | 删掉本地定义，`import { APPEAL_MAX, MAX_NARRATIVE_LEN } from '../../../shared/scoring'`；`worker/cases.ts:398` 的 `.slice(0, MAX_NARRATIVE_LEN)` 改 `.slice(0, APPEAL_MAX)`（`:486` 的改判理由仍用 `MAX_NARRATIVE_LEN`，不动） |
| `FILED_DM_GRACE_MS` | 只在 SQL：`0004_dm.sql:104`（dm.filed 的 `interval '3 minutes'`），同文件 `:106`、`:145` 也依赖它 | 新常量；`source-hygiene.test.ts` 新增用例：读 `server/migrations/0004_dm.sql`，在 `dm.filed` 那条 `outbox_emit` 里取 `interval 'N minutes'`，断言 `N * 60_000 === FILED_DM_GRACE_MS`。（`0005_sessions.sql:151` 的 3 分钟是改期私信合并，**不是**这个常量，别断言它） |
| `CASE_STATUS_LABEL.awaiting_statement` | `'待陈述'`（`shared/scoring.ts:151`，只有 `RecordsFeed.tsx:62` 读） | `'待说明'`。bot 不读它（已 grep：server/ 无引用） |

**草稿**（spec §5 第 4 条）

```ts
// src/lib/drafts.ts — storage + keys (DOM; tested in tests/dom)
export type DraftKind = 'statement' | 'case' | 'appeal' | 'rollcall' | 'session' | 'onboarding';
/** 'edg.draft.<kind>.<id>', or 'edg.draft.<kind>' when there is no id. */
export function draftKey(kind: DraftKind, id?: number | string): string;
export interface StoredDraft<T> { v: 1; savedAt: number; value: T; }
/** Parses and validates; an unparsable or invalid entry is removed and null returned. Never throws. */
export function readDraft<T>(kind: DraftKind, id: number | string | undefined, validate: (raw: unknown) => T | null): StoredDraft<T> | null;
export function writeDraft<T>(kind: DraftKind, id: number | string | undefined, value: T, now?: number): void;
export function clearDraft(kind: DraftKind, id?: number | string): void;
/** Logout: remove every key starting with 'edg.draft.' from BOTH storages. */
export function clearAllDrafts(): void;

// src/lib/useDraft.ts
export function useDraft<T>(
  kind: DraftKind,
  id: number | string | undefined,
  initial: T,
  options: { validate: (raw: unknown) => T | null; isEmpty: (value: T) => boolean },
): {
  value: T;
  setValue: (next: T | ((prev: T) => T)) => void;
  restored: boolean;          // value came from storage on mount
  savedAt: number | null;
  dirty: boolean;             // !isEmpty(value)
  clear: () => void;          // remove storage + reset to initial (after a successful submit)
};
```
- 存储：`onboarding` 用 **sessionStorage**，其余五类用 **localStorage**。所有 storage 访问 try/catch（隐私模式下静默退化成不存草稿）。写入防抖 `DRAFT_SAVE_DEBOUNCE_MS`；值为空时删 key 而不是写空串。
- 六类草稿：

| kind | key | value 形状（validate 必须校验） | 写入时机 | 清除时机 |
|---|---|---|---|---|
| statement | `edg.draft.statement.<recordId>` | `string`，≤ `MAX_NARRATIVE_LEN` | 输入 | `submitStatement` 成功；退出登录 |
| case | `edg.draft.case` | `{ picked: string[]; claim: string; extras: Record<string, string> }`，picked ≤ `config.maxBatchSubjects`，恢复时丢掉不在候选里的 id | 输入/勾选 | `createCases` 全部成功（`failed.length === 0`）；部分失败时只保留失败的人；退出登录 |
| appeal | `edg.draft.appeal.<recordId>` | `string`，≤ `APPEAL_MAX` | 输入 | `appealCase` 成功；退出登录 |
| rollcall | `edg.draft.rollcall.<sessionId>` | `Record<userId, { attendance: Attendance; late_minutes?: number }>`（只存第 1 步的标记），恢复时丢掉不在名单里的人 | 每次标记 | `settleSession` 成功；退出登录 |
| session | `edg.draft.session` | `{ invite: string[]; custom: string; chosen: string \| null }`，恢复时 `chosen` 不在当前 `quickSlots` 里就置 null | 勾选/输入 | `createSession` 成功；退出登录 |
| onboarding | `edg.draft.onboarding`（sessionStorage） | `{ choice: 'participant' \| 'judge' \| 'both'; useNanako: boolean; customName: string }`，没有裁判资格时 `judge`/`both` 视为无效 | **只在**点「绑定 Discord」那一下（`onBeforeBind`，不拦截跳转） | 保存成功；「稍后再说」/ Esc 关闭；退出登录 |

  > spec 冲突提示：§3.7 写点名草稿用 `sessionStorage`，§5 第 4 条写「首登用 sessionStorage，其余 localStorage」。P0 按 §5 第 4 条（localStorage），P3-5 页面化时沿用同一个 key。
- 有草稿（`dirty`）时，宿主 Modal 传 `dismissible={false}`；Esc / ✕ / 「稍后再说」走离开确认（onboarding 例外：不加离开确认，`p8-app:139-141` 用 Esc 关它）。

```ts
// src/lib/useLeaveGuard.ts
export function useLeaveGuard(dirty: boolean, leave: () => void): {
  /** Pass as the Modal's onClose and to every 稍后再说/✕ button. dirty → shows the confirm; clean → leave(). While confirming, a second call is a no-op. */
  requestClose: () => void;
  confirmingLeave: boolean;
  stay: () => void;      // 「继续写」
  confirmLeave: () => void; // 「先离开」 — draft stays on the device
};
```
离开确认用 ConfirmInline（`tone="primary"`, `focus="cancel"`，此处 cancel = 「继续写」），文案：

| kind | question | 按钮（cancel / confirm） |
|---|---|---|
| statement | 还没提交的说明会留在这台设备上，下次回来接着写。 | 继续写 / 先离开 |
| appeal | 申诉理由会留在这台设备上，下次回来接着写。 | 继续写 / 先离开 |
| case | 这笔还没提交，写的内容会留在这台设备上。 | 继续写 / 先离开 |
| rollcall | 点名还没提交，标记会留在这台设备上。 | 继续点名 / 先离开 |
| session | 这局还没约，已选的 N 个人会留在这台设备上。 | 继续编辑 / 先离开 |

**DraftNote**（`src/components/DraftNote.tsx`）：`{ savedAt: number | null; length?: number; onClear?: () => void }` → 「草稿已存在这台设备 · 写了 42 字」+ 可选按钮「清空」。

**DiscordLinkCard**（只加可选 prop）：`onBeforeBind?: () => void` —— 在「绑定 Discord」`<a>` 的 `onClick` 里调用，**不 `preventDefault`**，不增加任何请求（`discord-link:82,194` 请求数为 1）。不传时行为不变。

**AppealSheet**（`src/components/AppealSheet.tsx` + `appeal-sheet.css`，块前缀 `.aps`）
```ts
interface AppealSheetProps {
  record: RecordItem;                    // a decided case of the viewer's own
  onClose: () => void;
  onAppealed: (record: RecordItem) => void;
}
```
- `<Modal variant="sheet" title="申诉这一起" labelledBy=…>`；textarea `maxLength={APPEAL_MAX}`、字号 ≥ 16px、可以不填；提示「为什么觉得判得不对？（可以不写，但写一句管理员更好判断）」「申诉后分数先不动，管理员复核后可能维持，也可能改判。」
- 按钮「先不申诉」/「提交申诉」→ ConfirmInline「提交后要等管理员复核，确定吗？」 cancel「再想想」/ confirm「确认申诉」（`focus="cancel"`）→ `appealCase(record.id, reason.trim() || undefined)`。
- 草稿 `appeal`；成功后清草稿、`onAppealed`、toast「申诉已提交，等管理员复核。」。**不写「只能申诉一次」**。
- 入口：PlayerDetail 的「申诉」按钮（`PlayerDetail.tsx:328-336`）改为打开它，不再直接 POST。

**回血计算**（`src/lib/forgiveness.ts`，纯，单测必须用非 15 的 `weeklyHeal`，测试 mock 里是 5）
```ts
/** min(MAX_SCORE, score + weeklyHeal); a score already at MAX_SCORE stays. */
export function projectedAfterHeal(score: number, weeklyHeal: number): number;
export type HealPreview =
  | { kind: 'full' }                                              // 已经是满分
  | { kind: 'healing' }                                           // now ≥ nextResetAt，等 config 重拉
  | { kind: 'heal'; heal: number; projected: number; timeLeft: string }; // timeLeft = formatTimeLeft(nextResetAt, now)
export function healPreview(score: number, config: Pick<Config, 'weeklyHeal' | 'nextResetAt'>, now: number): HealPreview;
```
文案：heal → `周一 0 点回血 +${heal} → 预计 ${projected} · ${timeLeft}`；full → 「已经是满分，回血不用等。」；healing → 「回血中…」。只给 `is_participant` 的人显示（不在榜的人不回血）。

**MyScoreLine**（`src/components/MyScoreLine.tsx` + css，块前缀 `.msl`）
```ts
interface MyScoreLineProps {
  me: User;                       // rendered only when me.is_participant
  rank: number | null;            // competitionRanks over participants; null = not on the board
  config: Config;
  onOpen?: () => void;            // P0: open PlayerDetail for me; P4: /me
}
```
「82 分 · 第 6 名」+ healPreview 文案；用 `useNow(COUNTDOWN_TICK_MS)`。不含「本周变化」（P4-5）。位置：App 里 PendingBanner 之后、SessionsPanel 之前。

**ForgivenessNote**（`src/components/ForgivenessNote.tsx`，块前缀 `.fgn`）
```ts
interface ForgivenessNoteProps {
  delta: number;                  // the verdict's delta; renders nothing when delta >= 0
  scoreAfter: number;             // the subject's score with this delta applied
  weeklyHeal: number;
  onAppeal?: () => void;          // shows 「觉得不公平？可以申诉 ›」
}
```
文案：`这次 ${delta}。每周一 0 点回血 +${weeklyHeal}，预计下周一后回到 ${projectedAfterHeal(scoreAfter, weeklyHeal)}。`（delta 用 ASCII 减号，和 VerdictCard 一致）。用于 StatementDialog 的判决结果页，以及 PlayerDetail 本人视图里已判决的扣分卡。

**组件新可选 props（P0-5）**
- `StatementDialog`：`score?: number`（当事人提交前的分数，App 传 `me.score`；不传就不渲染 ForgivenessNote）。
- `PlayerDetail`：`config?: Config`（不传就不显示回血预告/ForgivenessNote；现有测试都不传）。

**撤销倒计时**（`src/lib/revoke.ts`，纯）
```ts
/** ms left in the reporter's revoke window, clamped at 0. */
export function revokeMsLeft(createdAt: string, now: number): number;
/** '还剩 12 分钟' | '还剩不到 1 分钟' */
export function formatRevokeLeft(msLeft: number): string;
```
立案人的「撤销」按钮显示「撤销 · 还剩 12 分钟」，用 `useNow(REVOKE_TICK_MS)` 刷新，`msLeft === 0` 时隐藏；管理员的「撤销」不带倒计时。（spec 示例写「12:34」，但 30 秒一刷的 mm:ss 会跳秒，P0 统一用分钟粒度。）

**其余 P0-5 文案改动**：VerdictCard「裁判陈述」→「立案经过」；StatementDialog 同上；StatementDialog 截止写「截止：{formatWhen(deadline)}（{formatRemaining(deadline)}）· 过期会按缺席裁决」；隐私说明按 spec §3.10 三句；提交前 ConfirmInline「确认提交？交了就不能改。」 cancel「再看看」/ confirm「确认提交」；RulesPanel `:36` 改为「每位选手每周一 0 点自动恢复 …」（删「本地时区」）；VerdictCard `:100-104` 缺席文案加条件 `status !== 'withdrawn'`。

### 3.6 P0-6 消费与提供

**消费**：`Modal variant="sheet"` + 嵌套栈（P0-2）、`ConfirmInline` + `useInlineConfirm`（P0-2）、`useToast` + `useUndo`（P0-3）、`.btn--danger-outline`（P0-1）。
**调用的 api.ts 函数（全部已存在，签名不改）**：`getSession(id)`、`setRsvp(id, rsvp, startsAt)`（`api.ts:246-252`，必须带 `session.starts_at`）、`updateSession(id, { starts_at })`（`api.ts:231-239`，PATCH）、`cancelSession(id)`（`api.ts:241-243`，P0 不带理由）。**P0 全程不改 `src/api.ts`**。时段用 `shared/quickTime.ts:59` 的 `quickSlots(now)`（浏览器时区，标签写「本地时间」），「其他时间」用 `datetime-local` + `toDateTimeLocalValue`（`src/lib/time.ts:133`）。

**提供**
```ts
// src/lib/sessionActions.ts (pure)
/** People who must answer again after a move: rsvp going/maybe/out, organizer excluded (worker/sessions.ts:463-467). */
export function rescheduleImpact(session: SessionDetail): number;
/** going disabled for someone not already going once capacity is reached. */
export function isFull(session: SessionItem): boolean;
/** Toast copy after an RSVP. undoable only when prev was a self RSVP (going/maybe/out) — invited cannot be restored (tests/worker/invites.test.ts:206). */
export function rsvpFeedback(prev: Rsvp | null, next: SelfRsvp): { message: string; undoable: boolean } | null; // null: unchanged

// src/components/RescheduleSheet.tsx
interface RescheduleSheetProps {
  session: SessionDetail;
  onClose: () => void;
  onRescheduled: (session: SessionDetail) => void;
}
```
- `rsvpFeedback` 文案：首次回复 →「已回复：{RSVP_LABEL[next]}。开局前想改随时改。」；改成不来（任意来源）→「收到，提前说了点名就不会记你 👍」；其余改动 →「已改成：{RSVP_LABEL[next]}」。可撤销时 toast 带「撤销」，撤销 = 再调一次 `setRsvp(id, prev, 最新 starts_at)`。
- RescheduleSheet：`<Modal variant="sheet" title="改到什么时候？">`；「现在：…（本地时间）」；影响面三条（spec §3.5，人数用 `rescheduleImpact`）；按钮「先不改」(`data-autofocus`) /「改到 {label}」。
- 取消：触发按钮「取消这局」放在操作区最后（次要样式）；ConfirmInline question「取消这局？」，children「会私信通知说了来、待定的人，以及收到过邀请还没回的人；说了不来的人不会收到。」，cancel「不取消了」/ confirm「确认取消」，`tone="danger"`、`focus="cancel"`；确认后立即提交，成功 toast「这局已取消。」。
- RSVP 区固定两句：「来 = 承诺，没来会被记一笔；待定不算承诺。」「开局前说不来，点名结算不会记你。」；满员时「来」`disabled`（按钮名仍是「来」）并显示「来 {going}/{capacity} 满了，可以先报待定。」。
- `canManage` 判断（`SessionDetailDialog.tsx:79`）不改。409 仍由组件内联 `role="alert"` 显示服务端原文，**不进 toast**。

---

## 4. 统一约定

**文件与命名**
- 组件：`src/components/PascalCase.tsx`，样式 `src/components/kebab-case.css`，组件文件顶部 `import './kebab-case.css';`（照现有每个组件）。每个新组件一个短的 BEM 块前缀，不得和现有前缀重复（已占用：`app`、`hdr`、`lb`、`lb-row`、`rbb`、`hero-card`、`feed`、`feed-row`、`chart`、`pd`、`vc`、`sd`、`sdt`、`sdt-player`、`cd`、`cd-chip`、`sf`、`ob`、`ob-card`、`dlink`、`wr`、`wr-stat`、`wr-award`、`rules`、`gauge`、`modal`、`invite`、`tier-badge` 等）。本契约已分配：`.ci`、`.toast(s)`、`.stale`、`.wh`、`.welcome`、`.msl`、`.fgn`、`.aps`、`.rss`（RescheduleSheet）、`.draft-note`、`.modal-page`。
- hooks：`src/lib/useXxx.ts`（一个文件一个 hook）；纯函数：`src/lib/camelCase.ts`。
- **会被 `tests/unit` 导入的 `src/lib` 模块必须是纯模块**：不碰 `window`/`document`/`localStorage`/`import.meta.env`，不导入 React、`src/api.ts`（它读 `import.meta.env`）。原因：`tests/unit` 由 `tsconfig.worker.json` 做类型检查（`lib: ["ES2022"]` + workers 类型，没有 DOM，见 `tsconfig.worker.json:3-7,18-19`）。DOM 相关的放进 hook/组件文件，用 `tests/dom` 测。
- `shared/` 只放 worker、bot、前端共用的领域规则，纯模块（`shared/scoring.ts:1-5` 的注释）。
- 每个文件 200–400 行为宜、最多 800；函数 < 50 行；嵌套 ≤ 4 层。`App.tsx` 现在 466 行，P0-3 抽走数据层后应明显变短，P0-4/P0-5 加完后不得超过约 450 行（超了就把 render 片段抽成小组件）。
- 不可变更新：state、props、模块级状态（modal 栈、toast 队列）一律返回新对象/新数组；`reloadCore` 合并时未刷新的部分保留原引用。
- 不写 `console.log`；错误给用户友好的中文提示，`ApiError` 用它自带的 `message`（照 `App.tsx:153`、`PlayerDetail.tsx:104`）。外部数据（storage 里的草稿、`import.meta.env`）在边界校验。
- 注释：英文为主、讲「为什么」，密度跟周围代码一致（见 `Modal.tsx:57-65`、`App.tsx:298-307`）；用户可见文案只写中文。

**CSP（`scripts/pages-headers.mjs:24-38`，`pages-headers.test.ts:33-38` 锁定 `script-src 'self'`）**
- `style-src 'self' https://fonts.googleapis.com`，**没有 `'unsafe-inline'`**：不能插 `<style>`，不能 `setAttribute('style', …)`，不能在 HTML 字符串/SVG 字符串里写 `style="…"`，不能 `dangerouslySetInnerHTML`。
- 可以：React 的 `style={{…}}`（走 CSSOM，现有 `ScoreGauge.tsx:34`、`RulesPanel.tsx:115` 就这么做）、`element.style.setProperty(...)`、SVG 表现属性（`fill`、`stroke`）、CSS 自定义属性。
- `script-src 'self'`：不内联脚本、不用字符串事件处理器。P0 不改 CSP。

**DOM 顺序 = 视觉顺序**：不用 CSS `order`、不用 `flex-direction: *-reverse` / `grid` 位置把阅读顺序打乱（`App.tsx:298-307`）。

**深链**：`?case`、`?session`、`?linked=discord`、`?onboarding=1` 的处理（`App.tsx:162-229`）P0 一律不改语义；新加的 effect 不得在深链被消费之前发 POST，不得请求 `/api/records/<id>`。

**测试**
- 文件名：`tests/unit/kebab-case.test.ts`、`tests/dom/kebab-case.test.tsx`、`tests/worker/kebab-case.test.ts`。
- dom 测试的 fetch 桩：**照抄现有写法，不新建共享 helper**（避免跨 PR 依赖）——
  - `json()` + `mockFetch(routes)` + `Call[]` 记录：`tests/dom/p8-app.test.tsx:13-36`（未命中路由回 404）或 `tests/dom/deep-link.test.tsx:8-31`、`tests/dom/discord-link.test.tsx:30-45`（未命中回 **500**，App 级新测试优先用这种，能暴露多余请求）；
  - 路由 key 是 `"METHOD /path?query"`，`path` 由 `url.replace(/^https?:\/\/[^/]+/, '')` 得到；
  - `settle()`：`p8-app.test.tsx:38-41`；
  - `afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); })`：`p8-app.test.tsx:104-107`；
  - config 桩的 `weeklyHeal` 是 **5**（`p8-app.test.tsx:84`、`deep-link.test.tsx:67`），任何回血断言都要从 config 读，不能写死 15。
- 假时钟：`vi.useFakeTimers({ shouldAdvanceTime: true })` 时，`userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`；测试结束 `vi.useRealTimers()`。
- 单独渲染的组件（不包 `ToastProvider`）必须照常工作（`useToast` 默认 no-op）——现有的 `session-rsvp-moved`、`player-judge` 都是单独渲染。
- 每个 PR 至少跑：`npm run typecheck`、`npx vitest run --config vitest.config.ts`、`npx vitest run --config vitest.dom.config.ts`；P0-5 再跑 `npx vitest run --config vitest.workers.config.ts tests/worker/cases.test.ts`，并在 CI 看 server/pg。

**文案真源**：用户可见中文以 spec 为准——锁定清单 spec §6.5（一律不改）；用词表 spec §5 末（「立案经过」「说明」「撤案」「撤销」，不用「撤回」，报名 toast 的「撤销」除外）；语气表 spec §5；各处原文 spec §3.1（欢迎卡）、§3.2（MyScoreLine）、§3.5（改时间 / 取消 / RSVP）、§3.10（说明页、判决、申诉）、§4.1 ④（RSVP toast）。本契约 §3 里给出的文案是这些原文的落地版，计划里照用。

**提交与 PR**
- commit：`<type>: <中文描述>`，type ∈ feat/fix/refactor/docs/test/chore/perf/ci；**不加** `Co-Authored-By`，PR 描述也**不加** 「Generated with」之类署名（机主规则）。
- 一个 PR 可以有多个 commit，但每个 commit 自己能过 typecheck 和测试。PR 描述写：对应 spec 的 §/PR 编号、改了哪些锁定测试以外的行为、新增测试清单、视觉验收截图（P0-1、P0-4 必须附手机 375px 与桌面 1280px 截图）。

---

## 5. 风险提示：被测试锁住、P0 会碰到的东西

| 测试 file:line | 锁住的东西 | 会碰到它的 PR / 注意 |
|---|---|---|
| `tests/dom/modal-focus.test.tsx:37-46,48-61` | 在弹窗里连续输入不丢字、焦点不被抢回 `[data-autofocus]` | P0-2：setup effect 只依赖 `[open]` |
| `tests/dom/modal-focus.test.tsx:63-75` | 多次重渲染期间 `document.addEventListener('keydown')` 次数不变 | P0-2：每个 Modal 打开时只装一次 keydown 监听；ConfirmInline、Toast 不得在渲染期间往 document 装 keydown |
| `tests/dom/modal-focus.test.tsx:77-86` | Esc 调用**最新的** onClose 且只调一次 | P0-2：栈判断不能吞掉单层时的 Esc |
| `tests/dom/session-rsvp-moved.test.tsx:76-80` | 单独渲染 `SessionDetailDialog`（无 ToastProvider）；按钮名正好是「来」且唯一；409 后 `findByRole('alert')` **唯一**且含「约局时间已经改了，请按新的时间重新确认」；`onChanged` 被调用；POST 体只有一次 `{rsvp:'going', starts_at}` | P0-6：不加第二个 alert；toast 不用 alert；满员提示、固定说明不能是 alert；撤销不能自动发 POST |
| `tests/dom/session-rsvp-moved.test.tsx:84-89` | SessionsPanel 里「来」唯一、409 alert | P0 不改 SessionsPanel |
| `tests/dom/deep-link.test.tsx:98-104` | heading「选手」；`#case-7` 获焦且含 `vc--focus`，`#case-6` 不含；`search === '?utm=dc'`；**没有任何非 GET 请求** | P0-3（刷新逻辑不能在深链前触发写）、P0-5（PlayerDetail 改动不能改 heading/id/类名） |
| `tests/dom/deep-link.test.tsx:112-116` | 未登录首页 `findByRole('heading', {name: /约局/})` **唯一**；非法 id 不请求 `/api/records/`；search 清空 | **P0-4**：WelcomeCard、WeekHighlights、compact 战报、「看更多」都不能出现含「约局」的 heading；未命中路由回 500，新请求失败不能拖垮页面 |
| `tests/dom/deep-link.test.tsx:125`、`p8-app.test.tsx:116` | 「链接里的案件不存在了。」「打不开链接里的案件，稍后再试。」 | P0-3：LinkMissingNotice 插槽位置可以挪，文案和触发条件不动 |
| `tests/dom/deep-link.test.tsx:133-134` | `?session=3` 请求 `/api/sessions/3`，search 清空 | P0-3 |
| `tests/dom/p8-app.test.tsx:118-130` | 管理员改分：spinbutton「调整分数」、按钮「改分」「确认改分」；之后 `/api/records?limit=50` 请求 > 1 次；`/api/records/7` **正好 1 次** | P0-3：`CHANGE_KEYS` 必须含 `records`；刷新不得重跑深链 |
| `tests/dom/p8-app.test.tsx:132-142` | `?onboarding=1&case=7`：先出 radiogroup「选择身份」，深链等着；**Esc** 关掉引导后才出 heading「选手」 | P0-5：OnboardingDialog 不加离开确认、不设 `dismissible={false}`；草稿只在点绑定时写 |
| `tests/dom/p8-app.test.tsx:144-155` | `PlayerDetail focusRecordId=7`：`activeElement.id === 'case-7'`，`scrollIntoView` 带 `block: 'center'` | P0-5：别动 `PlayerDetail.tsx:84-93` |
| `tests/dom/p8-app.test.tsx:183-188` | WeeklyReportCard（非 compact）heading /往期战报/、文案 /周一 10:30 之后发布/、heading /上周战报/ | P0-4：compact 是可选 prop，默认渲染不变 |
| `tests/dom/p8-app.test.tsx:196-199` | 已判决记录上不出现 `.feed-row__status--escalate` | P0-4（RecordsFeed 加 previewCount）、P0-5（`待陈述`→`待说明` 只改文案） |
| `tests/dom/player-judge.test.tsx:50-60` | 按钮「设为裁判」「取消裁判资格」；heading「选手」 | P0-5 |
| `tests/dom/player-judge.test.tsx:102,115-124` | 「确认是团灭级」只给立案裁判/管理员；文案 /够得上「团灭级放鸽」/ | P0-5（AppealSheet 等新增内容不得含这些字样） |
| `tests/dom/player-judge.test.tsx:133-140` | 「调整分数」「改分」（未改时 disabled）、/私信通知本人/、「确认改分」 | P0-5 |
| `tests/dom/player-judge.test.tsx:187-193` | 点「改分」后焦点在「确认改分」；`getByRole('button', {name: '取消'})` **在整个 PlayerDetail 里唯一**，点后焦点回 spinbutton | **P0-5**：PlayerDetail 里任何新按钮（AppealSheet、撤销倒计时、ForgivenessNote、ConfirmInline）都不能叫「取消」 |
| `tests/dom/player-judge.test.tsx:24-43` | 桩对**所有 GET** 都回同一个用户详情 | P0-5：PlayerDetail 不要新增 GET（回血预告从 `config` prop 来） |
| `tests/dom/verdict-privacy.test.tsx:44-51` | 脱敏时 /选手 写了说明/、无 /按缺席裁决/、/判词只有当事人、立案人、裁判和管理员能看/、`'-12'` 至少一处 | P0-5：「立案经过」改名不影响；隐私句子 `VerdictCard.tsx:24` 不动 |
| `tests/dom/verdict-privacy.test.tsx:53-56` | `statement_at: null` + `decided` 时**有** /按缺席裁决/ | P0-5：M17 只在 `withdrawn` 时隐藏 |
| `tests/dom/verdict-privacy.test.tsx:58-63` | 脱敏 appealed：不出现申诉理由和「申诉理由」，有 /该选手已申诉/ | P0-5 |
| `tests/dom/verdict-privacy.test.tsx:83-95` | 加分记录无「判词只有」、无「按缺席裁决」 | P0-5 |
| `tests/dom/onboarding-roles.test.tsx:29-31` | radio 名 /上榜选手/、/^裁判/、/两者都要/ | P0-4（只改 desc）、P0-5 |
| `tests/dom/onboarding-roles.test.tsx:41` | 「裁判资格由管理员授予」**正好 2 次** | P0-4、P0-5：OnboardingDialog 里不新增这句 |
| `tests/dom/onboarding-roles.test.tsx:71-77` | 点「确认」后 `/api/me/roles` 的 body 正好是 `{is_participant: true, is_judge: false}` | P0-5：无草稿时 `initialChoice` 照旧；草稿不改请求体形状 |
| `tests/dom/onboarding-roles.test.tsx:80-87` | /需要管理员重新授予/ 只在裁判选「上榜选手」后出现 | P0-5 |
| `tests/dom/discord-link.test.tsx:78-83,190-199` | 后端无 Discord 时**请求数正好 1**，卡片不渲染，对话框里仍有「确认」 | P0-5：`onBeforeBind` 不加请求 |
| `tests/dom/discord-link.test.tsx:88-97,179-188` | 链接名「绑定 Discord」、`href === DISCORD_LINK_URL`、/还没「确认」的修改不会保存/ | P0-5：onClick 不 `preventDefault`、不改 href |
| `tests/dom/discord-link.test.tsx:99-135` | 「解绑」→ 焦点到「取消」→「确认解绑」；取消后焦点回「解绑」；不发 POST | P0-5：DiscordLinkCard 不迁 ConfirmInline |
| `tests/dom/discord-link.test.tsx:148,157` | role=alert「操作冲突，请重试」「请先登录」 | — |
| `tests/dom/discord-link.test.tsx:227-246` | 「Discord 绑定成功」、只剥掉 `linked`（search 剩 `?onboarding=1`）、「关闭提示」；无参数时 heading /约局/ 唯一 | P0-3、P0-4 |
| `tests/dom/discord-link.test.tsx:267-281` | 没身份的人绑定回来再弹 heading「设置你的显示名字与身份」；有身份的不弹 | P0-5：草稿恢复不改这条触发逻辑（`App.tsx:199-208`） |
| `tests/unit/pages-headers.test.ts:33-38` | CSP `script-src 'self'`、`connect-src`、`img-src`、`frame-ancestors` 逐字 | 全部 PR：不改 CSP，不写需要 `unsafe-inline` 的东西 |
| `tests/unit/source-hygiene.test.ts:23-33` | `worker/shared/src/tests/migrations/functions` + `schema.sql/index.html/wrangler.toml` 里没有 NUL 字节 | 全部 PR（P0-4 改 index.html） |
| `tests/unit/client-time.test.ts:54` | `formatRemaining` →「还剩 12 小时 0 分」 | P0-3 只追加新函数，不改 `formatRemaining` |
| `tests/worker/cases.test.ts:449-470` | 申诉冻结分数；理由原样可读（含「提前两小时」「截图」）；空白理由存 null | P0-5：截断改 500 后这些照常成立；新增 >500 截断用例 |
| `tests/worker/invites.test.ts:206` | 用户不能把自己设回 invited | P0-6：首次回复不给撤销 |
| `tests/worker/sessions.test.ts:182` | 组织者不能报「不来」，报错含 /取消约局/（后端文案） | P0-6 只改前端按钮名，后端报错文案不动 |

额外提醒：
1. **首屏请求 URL 集合不变**（spec §6.5「请求」一行）：未登录 = `/api/config`、`/api/leaderboard`、`/api/records?limit=50`、`/api/me`、`/api/report/latest`、`/api/sessions?scope=upcoming`；登录后另有 `/api/me/invites`，有待说明时另有 `/api/records?limit=20&mine=pending`（参数顺序由 `api.ts:135-139` 决定）。P0 不新增首屏请求。
2. **Modal 改动影响面最大**：`Modal` 被 CaseDialog、StatementDialog、OnboardingDialog、PlayerDetail、SessionFormDialog、SessionDetailDialog、RollCallDialog、AdminAiPanel 共 8 处使用，全都不传新 props；P0-2 的默认路径必须与今天逐字节等价（markup、类名、焦点行为）。
3. P0-1 修好导入顺序后，`.dlink__bind` 的蓝色、`.pd__revoke-btn` 的红色、弹窗阴影、胶囊圆角会重新生效——是预期，要在 PR 里附截图验收。
4. 删除 RedBlackBoard（P0-4）前确认：没有测试引用它（已 grep：`tests/` 无「红黑榜」「头号鸽王」「RedBlackBoard」）。
5. StrictMode（`main.tsx`）下 effect 会在开发环境跑两遍：modal 栈 `pushLayer/popLayer` 必须按 id 幂等；toast、草稿的 effect 同理。
