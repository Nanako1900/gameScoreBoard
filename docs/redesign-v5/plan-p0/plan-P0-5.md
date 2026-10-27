# P0-5 安全网：草稿、申诉、撤销倒计时、回血预告、文案 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让长文本和多步表单「一碰不丢」（六类本机草稿 + 离开确认），申诉改成可写理由、要确认的底部抽屉，撤销按钮显示剩余时间，回血在本人视图里看得见，并把 P0 范围内的用词、隐私范围、截止时间文案和三处跨端常量对齐到 spec。

**Architecture:** 存储与校验分三层：`src/lib/draftShapes.ts`（纯，六类草稿的形状与校验，单测）→ `src/lib/drafts.ts`（storage 读写，全部 try/catch）→ `src/lib/useDraft.ts` / `useLeaveGuard.ts`（React 状态、防抖写入、卸载时补写、原地离开确认）；五个宿主弹窗只把原来的 `useState` 换成 `useDraft`，并把 `onClose` 换成离开守卫。回血与撤销的数字全部来自纯函数（`forgiveness.ts`、`revoke.ts`，单测），组件（`MyScoreLine`、`ForgivenessNote`、`AppealSheet`）只负责显示；跨端常量收进 `shared/scoring.ts`，worker、bot、前端都从那里读。

**Tech Stack:** React 18 + TypeScript 5.9、Vite 6、Vitest 3（unit = node、dom = jsdom + Testing Library、worker = Miniflare D1）、Hono worker、discord.js bot（`server/`）。

**依赖:** 硬依赖（必须已合进 `origin/main` 才开分支）：**P0-2**（`Modal` 的 `variant="sheet"`/`dismissible`/`title`、Modal 栈、`ConfirmInline`、`useInlineConfirm`、`tests/dom/setup.ts` 的 `afterEach`）、**P0-3**（`src/lib/constants.ts`、`useNow`、`formatTimeLeft`、`useToast`/`ToastProvider`、App 数据层）、**P0-4**（`App.tsx` 渲染区、`src/lib/rank.ts` 的 `competitionRanks`、`RulesPanel` 受控 props）、**P0-6**（只用它在 `src/lib/constants.ts` 里定义的 `CUSTOM_TIME_LEAD_MS`：发起约局与改时间的「其他时间」共用同一个提前量；推荐合并顺序里 P0-6 本来就在 P0-5 之前）；P0-1 经由它们间接依赖（token、断点、hover 约定、`css-conventions.test.ts`）。**消费**（契约 §3.1–§3.4）：`--ok`/`--info`/`--muted`/`--danger-text`/`--border-input`/`--tap-min`/`--fs-*`、`Modal{variant,dismissible,title}`、`ConfirmInline`、`useInlineConfirm`、`useNow`、`formatTimeLeft`、`COUNTDOWN_TICK_MS`、`useToast`、`competitionRanks`。**提供**（契约 §3.5）：`REVOKE_WINDOW_MS`/`APPEAL_MAX`/`FILED_DM_GRACE_MS`、`CASE_STATUS_LABEL.awaiting_statement = '待说明'`、`drafts.ts`/`useDraft`/`useLeaveGuard`/`DraftNote`、`AppealSheet`、`forgiveness.ts`/`ForgivenessNote`/`MyScoreLine`、`revoke.ts`、`DiscordLinkCard.onBeforeBind`、`StatementDialog.score`、`PlayerDetail.config`、`constants.ts` 的 P0-5 小节（`REVOKE_TICK_MS`、`DRAFT_SAVE_DEBOUNCE_MS`）。

**分支:** `claude/p0-5-safety-net`（P0-2、P0-3、P0-4、P0-6 都合进 main 后：`git fetch origin && git switch -c claude/p0-5-safety-net origin/main`）。

---

## 文件结构

记号：**新** = 新建；其余为修改。行号指 2026-10-26 快照（d72e11b）；P0-3/P0-4 改过的文件（`App.tsx`、`RulesPanel.tsx`、各 css）行号会下移，按计划里给的代码片段定位。

| 文件 | 职责 |
|---|---|
| `shared/scoring.ts` | 新增 `REVOKE_WINDOW_MS`、`APPEAL_MAX`、`FILED_DM_GRACE_MS`；`CASE_STATUS_LABEL.awaiting_statement` 改「待说明」 |
| `worker/cases.ts` | 删本地 `REVOKE_WINDOW_MS`，改 import；`appealCase` 截到 `APPEAL_MAX` |
| `server/src/discord/case-actions.ts` | 删本地 `APPEAL_MAX`，改 import（bot 的申诉 modal 上限与网页、后端同源） |
| `tests/worker/cases.test.ts` | 追加：超过 500 字的申诉理由截到 500 |
| `tests/pg/dm.test.ts` | 只加断言：bot 申诉 modal 的 `maxLength` 等于 `APPEAL_MAX`（CI 的 pg 套件运行，本地只过 typecheck） |
| `tests/unit/source-hygiene.test.ts` | 追加：`FILED_DM_GRACE_MS` 与 `0004_dm.sql` 里 dm.filed 的 `interval` 一致 |
| `src/lib/constants.ts` | 追加 P0-5 小节：`REVOKE_TICK_MS`、`DRAFT_SAVE_DEBOUNCE_MS` |
| 新 `src/lib/revoke.ts` | 纯：撤销窗口剩余毫秒、「还剩 N 分钟」 |
| 新 `src/lib/forgiveness.ts` | 纯：`projectedAfterHeal`、`healPreview`、`healPreviewText` |
| 新 `src/lib/draftShapes.ts` | 纯：六类草稿的值类型、校验器、空判断、点名标记合并；表单字段上限常量 |
| 新 `src/lib/drafts.ts` | storage：key、读（校验失败即删）、写（返回是否写成）、删、退出时全清 |
| 新 `src/lib/useDraft.ts` | hook：挂载时恢复、防抖写入、卸载时补写、`clear()` |
| 新 `src/lib/useLeaveGuard.ts` | hook：有草稿时把关闭变成原地确认（建在 `useInlineConfirm` 上） |
| 新 `src/components/DraftNote.tsx` + `draft-note.css` | 「草稿已存在这台设备 · 写了 N 字」+ 可选「清空」 |
| 新 `src/components/ForgivenessNote.tsx` + `forgiveness-note.css` | 判决扣分后的回血预估 + 可选申诉入口 |
| 新 `src/components/MyScoreLine.tsx` + `my-score-line.css` | 首页「82 分 · 第 6 名」+ 回血预告 |
| 新 `src/components/AppealSheet.tsx` + `appeal-sheet.css` | 申诉底部抽屉：可选理由（≤500）、草稿、提交前确认 |
| 新 `src/components/CaseActions.tsx` | 从 `PlayerDetail.tsx` 拆出的案件操作按钮（含改判表单）；撤销倒计时在这里 |
| `src/components/PlayerDetail.tsx` + `player-detail.css` | 申诉改开 AppealSheet；本人视图的回血预告和 ForgivenessNote；新增可选 `config` |
| `src/components/VerdictCard.tsx` | 「裁判陈述」→「立案经过」；withdrawn 不显示缺席；导出 `verdictSourceLabel` |
| `src/components/StatementDialog.tsx` + `statement-dialog.css` | 草稿、提交前确认、隐私三句、截止绝对+相对时间、改名、判决后 ForgivenessNote 与申诉；新增可选 `score` |
| `src/components/CaseDialog.tsx` | 立案草稿 + 离开确认 + `dismissible` |
| `src/components/SessionFormDialog.tsx` | 发起约局草稿 + 离开确认 + `dismissible` |
| `src/components/RollCallDialog.tsx` | 点名第 1 步草稿 + 离开确认 + `dismissible` |
| `src/components/OnboardingDialog.tsx` | 点「绑定 Discord」时存身份草稿，回来时恢复；关闭/保存时清掉 |
| `src/components/DiscordLinkCard.tsx` | 新增可选 `onBeforeBind` |
| `src/components/RulesPanel.tsx` | 只改 `:36`：删「本地时区」 |
| `src/App.tsx` | 退出时清草稿；插 MyScoreLine；给 StatementDialog / PlayerDetail 传新 props |
| `tests/dom/setup.ts` | `afterEach` 里清两个 storage |
| `tests/dom/verdict-privacy.test.tsx` | 只追加 withdrawn 用例 |
| 新 `tests/unit/revoke.test.ts`、新 `tests/unit/forgiveness.test.ts`、新 `tests/unit/draft-shapes.test.ts` | 纯函数单测 |
| 新 `tests/dom/drafts.test.tsx` | storage、useDraft、五个宿主弹窗的恢复/清除/离开确认、首登身份草稿 |
| 新 `tests/dom/appeal-sheet.test.tsx` | AppealSheet；PlayerDetail 的申诉入口、撤销倒计时、本人回血 |
| 新 `tests/dom/my-score-line.test.tsx` | MyScoreLine、ForgivenessNote；App 里的位置 |
| 新 `tests/dom/wording.test.tsx` | 立案经过 / 待说明 / 本地时区 / 截止 / 隐私三句 |

## 对契约的补充

契约里已有的名字一律照用；下面是契约没写、本 PR 需要的部分，以及原因。

1. **`writeDraft` 返回 `boolean`**（契约写的是 `void`）：隐私模式或配额满时写不进去，`useDraft` 据此决定要不要显示「草稿已存在这台设备」，不对用户撒谎；也满足「不悄悄吞错误」。调用方忽略返回值时行为与 `void` 相同。
2. **`useLeaveGuard` 的返回值多一个 `triggerRef: RefObject<HTMLButtonElement>`**：它建在 P0-2 的 `useInlineConfirm` 上，「继续写」之后焦点回到「稍后再说 / 取消」按钮（契约 §3.2 规定「取消后焦点回到触发按钮由调用方负责，用 useInlineConfirm」）。`requestClose/confirmingLeave/stay/confirmLeave` 四个名字和语义不变。
3. **新纯模块 `src/lib/draftShapes.ts`**（+ `tests/unit/draft-shapes.test.ts`）：契约要求「validate 必须校验」，但没给放校验器的文件。放进纯模块才能在 `tests/unit` 里测，五个组件也不用各自写一遍。它还导出三个表单上限常量（`CASE_EXTRA_MAX = 300`、`DISPLAY_NAME_MAX = 24`、`LATE_MINUTES_MAX = 24 * 60`），把 `CaseDialog.tsx:198`、`OnboardingDialog.tsx:134`、`RollCallDialog.tsx:185` 的字面量换掉，校验器和输入框用同一个数。（这三个数在后端都不是 shared 常量：`MAX_LATE_MINUTES` 是 `worker/sessions.ts:49` 的私有常量，另两个后端没有同名常量；移进 `shared/` 要动 worker，不在契约给 P0-5 的文件清单里，留给 P2-4 的常量迁移一并处理。）
4. **`forgiveness.ts` 多导出 `healPreviewText(preview)`**：MyScoreLine 和 PlayerDetail 本人视图显示同一句话，文案只写一处。另外 `nextResetAt` 解析不了时返回 `{ kind: 'heal', …, timeLeft: '' }`（只显示数字、不显示天数），而不是永远「回血中…」。
5. **新组件文件 `src/components/CaseActions.tsx`**：`PlayerDetail.tsx` 现在 427 行，加完本 PR 的功能会到 ~480 行；把 `CaseActions`/`OverrideForm`/`canWithdraw` 和撤销判断原样挪出去（Task 11 纯搬家，Task 12 再加功能）。契约规定 PlayerDetail 只有 P0-5 碰，所以不和别的 PR 冲突。类名仍在 `player-detail.css`，不新增 BEM 块。
6. **`VerdictCard.tsx` 导出 `verdictSourceLabel(source)`**：AppealSheet 头部「大迟到 · -6 · AI 裁决」要用来源标签，不复制 `SOURCE_BADGE`。
7. **新测试文件 `tests/dom/wording.test.tsx`**：本 PR 的文案改动（立案经过、待说明、本地时区、截止时间、隐私三句）分散在五个组件里，契约没给测试文件；集中放一处，便于以后核对用词表。
8. **`tests/dom/appeal-sheet.test.tsx` 同时覆盖 PlayerDetail 的案件操作**（申诉入口、撤销倒计时、本人回血预告与 ForgivenessNote）：契约只列了这三个新 dom 文件，撤销倒计时和申诉入口都在 PlayerDetail 的同一块按钮里，放一起。
9. **依赖 P0-2 的 `ConfirmInline` 两个按钮都是 `type="button"`**（P0-2 计划里已经这样写，契约没写死）：CaseDialog、SessionFormDialog 的离开确认渲染在 `<form>` 里，如果按钮默认是 submit，点「先离开」会提交表单。Task 0 用 grep 核对，Task 14 的测试（点「先离开」后没有任何 POST）兜底。
10. **Esc / ✕ 在「确认提交？」「提交后要等管理员复核」这类提交确认显示时，先退出确认、不关弹窗**（StatementDialog、AppealSheet）；提交中按 Esc 不做任何事。契约规定 ConfirmInline 不处理 Esc、由宿主决定，这里写明宿主的决定。
11. **`useDraft` 的 `id` 在 hook 生命周期内不变**：App 给 StatementDialog 加 `key={statementCase.id}`，PlayerDetail 给 AppealSheet 加 `key={record.id}`。恢复出来的值如果 `isEmpty` 为真，按「没有草稿」处理并删掉 key（例如名单里的人都走了）。
12. **StatementDialog 去掉 `<form>` 元素**：提交前要先原地确认，提交按钮不再是 submit；textarea 里回车本来就不提交，键盘行为不变。提交按钮按 spec §3.10 线框改名「提交说明」（原「提交并接受裁决」，没有测试锁定）。30 秒一次的 `forceTick`（`StatementDialog.tsx:37-44`）换成 `useNow(COUNTDOWN_TICK_MS)`。
13. **ForgivenessNote 在 PlayerDetail 本人视图里不带申诉入口**：同一张卡上已经有「申诉」按钮，再放「觉得不公平？可以申诉」就是一处操作两个入口（spec §1.2 第 3 条）。StatementDialog 判决页带入口，点了在上面叠一层 AppealSheet（两层，符合「手机上最多叠两层」）。
14. **文案事实性提醒（写进 PR 描述，不改文案）**：隐私第二句「判决前，立案经过和案由不会公开给其他人」要等 P1 的 B1-1（后端判决前脱敏）上线才完全成立；今天的 `redactRecord`（`worker/case-reads.ts:73-80`）只隐藏说明、申诉理由和判词。契约要求逐字用 spec §3.10 的三句，本 PR 照用，并在 PR 描述里请机主决定：P0-5 与 B1-1 相邻上线，或在 B1-1 之前临时去掉这句。
15. **「回血中…」引用 P0-3 的 `RESET_PENDING_LABEL`**：P0-3 计划（v2「对契约的补充」第 4 条）在 `src/lib/time.ts` 额外导出 `RESET_PENDING_LABEL = '回血中…'`，Header 的倒计时用它。契约没写这个名字，但 Task 6 的 `healPreviewText` 直接引用它，同一个等待状态全站只有一处文案。Task 0 先 grep 确认它在；万一 P0-3 合并时去掉了，就在 `forgiveness.ts` 里写同一个字面量，并在 PR 描述里说明。
16. **退出登录清草稿没有 dom 测试**：`handleLogout` 最后调 `window.location.reload()`，jsdom 未实现且 `location` 不可 spy；`clearAllDrafts` 本身在 Task 8 有测试，App 里的一行调用靠代码审查和手动检查。
17. **bot 一侧加一条断言（`tests/pg/dm.test.ts`）**：spec §1.2 第 4 条要求「上限两边都是 `APPEAL_MAX` = 500」，可 bot 的申诉 modal 上限现在没有任何测试锁住。Task 1 在 `dm.test.ts:824` 已有的 `openCaseAction('appeal', …)` 断言上补一个 `modal.field.maxLength === APPEAL_MAX`。这个文件不在契约 §2.3 的清单里，只加断言、不改行为；本地只能过 typecheck（`tests/pg` 在 `tsconfig.worker.json` 的 `include` 里），运行结果看 CI 的 pg 套件（契约 §1 本来就要求 P0-5 合并前看到 pg 通过）。
18. **「清空」之后把焦点交给输入框**：`DraftNote` 的「清空」按钮点完就随提示一起卸载，焦点会掉到 `<body>`（弹窗里再按 Tab 才被焦点陷阱拉回）。AppealSheet、StatementDialog、CaseDialog 的 `onClear` 都是「清草稿 + 聚焦那个文本框」。契约 §3.5 只定了 DraftNote 的 props，这是宿主的行为，不改 DraftNote。
19. **点名第 1 步：屏幕上的标记仍是组件内 state，草稿只存能原样恢复的部分**：迟到分钟数要按用户敲的样子留在输入框里（「1500」超出上限时由服务端报错，和今天一样），不能因为草稿校验不通过就被清空。所以 `marks` 仍是 `useState`（初值 = `mergeMarks(服务端标记, 草稿)`），每次标记时另把 `toStoredMark` 的结果写进草稿。
20. **发起约局：打开「其他时间」时草稿的 `chosen` 置 null，收起时写回屏幕上的时段**：契约的草稿形状只有 `{invite, custom, chosen}`，没有「当前用的是哪一种」。约定 `chosen === null && custom !== ''` 表示用的是「其他时间」，恢复时据此决定展开与否；否则用户看过「其他时间」再点回快捷时段，恢复后会被带回自定义时间并按它提交。
21. **函数 < 50 行**：`AppealSheet` 把理由输入区拆成文件内的 `AppealReason`，`StatementDialog` 拆出 `StatementField`，`useDraft` 拆出 `readInitial` 和 `useDraftSaving`，每个函数都在 50 行以内。`PlayerDetail`（今天 208 行的单个函数）、`CaseDialog`、`RollCallDialog`、`SessionFormDialog` 的组件函数本来就超长，本 PR 只在原处加几行，不顺手重构（P1-1 的页面化会重写 PlayerDetail）。
22. **「其他时间」的初始提前量用 P0-6 的 `CUSTOM_TIME_LEAD_MS`**（跨 PR 一致性检查定下的）：`SessionFormDialog.tsx:128` 的 `3_600_000` 和 P0-6 `RescheduleSheet` 的初值是同一个规则（现在起一小时后），所以不在本组件里另写局部常量，而是 `import { CUSTOM_TIME_LEAD_MS } from '../lib/constants'`（P0-6 的小节）。P0-6 万一晚于本 PR，就由本 PR 在 `constants.ts` 里先建 `// --- P0-6 ---` 小节写上这一行（同名同值），P0-6 rebase 时删掉自己那一份重复定义。

---

### Task 0: 开分支、核对依赖接口、记录基线

**Files:** 无改动

- [ ] **Step 1: 确认依赖已合并并开分支**

```bash
cd "$(git rev-parse --show-toplevel)"   # 仓库根目录
git fetch origin
git log --oneline origin/main | head -20   # 必须看到 P0-1、P0-2、P0-3、P0-6、P0-4 的合并提交
git switch -c claude/p0-5-safety-net origin/main
```

- [ ] **Step 2: 核对本 PR 要用的接口都在**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
grep -n "export function useNow" src/lib/useNow.ts
grep -n "export function formatTimeLeft" src/lib/time.ts
grep -n "export const RESET_PENDING_LABEL" src/lib/time.ts
grep -n "export function useToast" src/components/Toast.tsx
grep -n "export function ConfirmInline" src/components/ConfirmInline.tsx
grep -c 'type="button"' src/components/ConfirmInline.tsx
grep -n "export function useInlineConfirm" src/lib/useInlineConfirm.ts
grep -n "variant?: ModalVariant\|dismissible?: boolean\|title?: React.ReactNode" src/components/Modal.tsx
grep -n "export function competitionRanks" src/lib/rank.ts
grep -n "COUNTDOWN_TICK_MS" src/lib/constants.ts
grep -n "export const CUSTOM_TIME_LEAD_MS" src/lib/constants.ts
grep -n "resetModalStackForTests\|P0-5" tests/dom/setup.ts
```

预期：每条都有输出；`grep -c 'type="button"'` 至少为 2。任何一条为空就停下，先找对应 PR 的作者（不在本 PR 里补别人的文件）。

- [ ] **Step 3: 记录基线**

```bash
npm run typecheck
npx vitest run --config vitest.config.ts
npx vitest run --config vitest.dom.config.ts
npx vitest run --config vitest.workers.config.ts tests/worker/cases.test.ts
```

预期：全部 PASS（`cases.test.ts` 36/36；unit/dom 的用例数以 P0-4 合并后的为准，记下来，收尾时对比。按推荐合并顺序应为 **unit 23 个文件 / 294 个用例、dom 16 个文件 / 165 个用例**）。

---

### Task 1: 三个跨端常量收进 `shared/scoring.ts`（不改行为）

**Files:**
- Modify: `shared/scoring.ts:30`（之后插入）
- Modify: `worker/cases.ts:7-20`（import）、`:94-95`（删）
- Modify: `server/src/discord/case-actions.ts:12`（import）、`:40`（删）
- Modify: `src/components/PlayerDetail.tsx:2`（import）、`:44`（删）
- Modify: `tests/pg/dm.test.ts:5`（import）、`:824`（bot 申诉 modal 的上限锁到 `APPEAL_MAX`，见「对契约的补充」第 17 条）
- Test: 现有 `tests/worker/cases.test.ts`、`tests/dom/player-judge.test.tsx`、typecheck（三个 tsconfig）

纯搬家，没有新行为，所以这一步没有新的失败测试：用 typecheck 证明三端都从 `shared` 读到了同一个值，用现有测试证明行为没变。

- [ ] **Step 1: 确认现在的重复定义**

```bash
grep -n "REVOKE_WINDOW_MS = \|APPEAL_MAX = " worker/cases.ts src/components/PlayerDetail.tsx server/src/discord/case-actions.ts
```

预期 3 行：`worker/cases.ts:95`、`src/components/PlayerDetail.tsx:44`、`server/src/discord/case-actions.ts:40`。

- [ ] **Step 2: 在 `shared/scoring.ts:30`（`MIN_CLAIM_LEN` 那行）之后插入**

```ts

/** A reporter may revoke a decided record within this long of filing it (created_at). Admins: any time. */
export const REVOKE_WINDOW_MS = 15 * 60 * 1000;

/** Appeal reason cap — the bot's modal, the web's maxLength and appealCase's truncation. */
export const APPEAL_MAX = 500;

/**
 * The filing DM waits this long, so an instant withdrawal never DMs.
 * MUST equal `interval '3 minutes'` in server/migrations/0004_dm.sql (asserted in source-hygiene).
 */
export const FILED_DM_GRACE_MS = 3 * 60 * 1000;
```

- [ ] **Step 3: `worker/cases.ts` 改 import、删本地常量**

`:7-20` 之前：

```ts
import {
  MAX_NARRATIVE_LEN,
  MIN_CLAIM_LEN,
  STATEMENT_WINDOW_HOURS,
```

之后：

```ts
import {
  MAX_NARRATIVE_LEN,
  MIN_CLAIM_LEN,
  REVOKE_WINDOW_MS,
  STATEMENT_WINDOW_HOURS,
```

删除 `:94-95` 两行：

```ts
/** Reporter self-revoke window for instantly-settled (bonus) records. */
const REVOKE_WINDOW_MS = 15 * 60 * 1000;
```

（`:423` 的 `Date.now() - parseSqlUtc(rec.created_at) <= REVOKE_WINDOW_MS` 不动，现在读的是 shared 的同一个值。）

- [ ] **Step 4: bot 改 import、删本地常量**

`server/src/discord/case-actions.ts:12` 之前：

```ts
import { MAX_NARRATIVE_LEN } from '../../../shared/scoring';
```

之后：

```ts
import { APPEAL_MAX, MAX_NARRATIVE_LEN } from '../../../shared/scoring';
```

删除 `:40`：

```ts
const APPEAL_MAX = 500;
```

（`:123` 的 `maxLength: APPEAL_MAX` 不动。）

- [ ] **Step 5: 前端改 import、删本地常量**

`src/components/PlayerDetail.tsx:2` 之前：

```ts
import { tierFor } from '@shared/scoring';
```

之后：

```ts
import { REVOKE_WINDOW_MS, tierFor } from '@shared/scoring';
```

删除 `:44`：

```ts
const REVOKE_WINDOW_MS = 15 * 60 * 1000;
```

- [ ] **Step 6: bot 的申诉 modal 上限锁到 shared 常量**

`tests/pg/dm.test.ts:5` 之后加一行：

```ts
import { APPEAL_MAX } from '../../shared/scoring';
```

`:824` 之前：

```ts
    expect(await openCaseAction('appeal', filed.id, SUBJECT_DC, ctx)).toMatchObject({ kind: 'modal' });
```

之后：

```ts
    // Same cap as the web's maxLength and appealCase's cut (shared APPEAL_MAX, spec §3.10).
    expect(await openCaseAction('appeal', filed.id, SUBJECT_DC, ctx)).toMatchObject({
      kind: 'modal',
      modal: { field: { required: false, maxLength: APPEAL_MAX } },
    });
```

（`openCaseAction` 返回的 `ModalSpec` 形状见 `server/src/discord/case-actions.ts:25-29,115-125`。pg 套件本地不跑；这条断言由 `npm run typecheck` 检查类型，运行结果看 CI。）

- [ ] **Step 7: 验证**

```bash
grep -rn "REVOKE_WINDOW_MS = \|APPEAL_MAX = \|FILED_DM_GRACE_MS = " worker server/src src shared
npm run typecheck
npx vitest run --config vitest.workers.config.ts tests/worker/cases.test.ts
npx vitest run --config vitest.dom.config.ts tests/dom/player-judge.test.tsx
```

预期：grep 只剩 `shared/scoring.ts` 的 3 行；typecheck 通过（三个 tsconfig 都过，说明 bot 的 import 和 `dm.test.ts` 的断言类型正确）；两个测试文件 PASS（36/36、player-judge 全过）。

- [ ] **Step 8: Commit**

```bash
git add shared/scoring.ts worker/cases.ts server/src/discord/case-actions.ts src/components/PlayerDetail.tsx tests/pg/dm.test.ts
git commit -m "refactor: REVOKE_WINDOW_MS、APPEAL_MAX、FILED_DM_GRACE_MS 统一定义在 shared/scoring"
```

---

### Task 2: 后端申诉理由截到 `APPEAL_MAX`（1000 → 500）

**Files:**
- Modify: `worker/cases.ts:398`
- Test: `tests/worker/cases.test.ts:3`（import）、`:472` 之后（新用例）

- [ ] **Step 1: 写失败测试**

`tests/worker/cases.test.ts:3` 之前：

```ts
import { VIOLATION_MAP, WEEKLY_BONUS_CAP } from '../../shared/scoring';
```

之后：

```ts
import { APPEAL_MAX, VIOLATION_MAP, WEEKLY_BONUS_CAP } from '../../shared/scoring';
```

在 `:468-472`（`it('stores no appeal reason when none was given', …)`）之后插入：

```ts

  it('cuts an appeal reason to APPEAL_MAX, the same cap as the bot (spec §3.10)', async () => {
    const { subject, record } = await decidedCase();
    const out = await appealCase(env.DB, subject, record.id, `  ${'长'.repeat(APPEAL_MAX + 20)}  `);
    expect(out.appeal_reason?.length).toBe(APPEAL_MAX);
    expect(out.appeal_reason).toBe('长'.repeat(APPEAL_MAX));
  });
```

- [ ] **Step 2: 运行，确认失败**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npx vitest run --config vitest.workers.config.ts tests/worker/cases.test.ts -t "APPEAL_MAX"
```

预期：FAIL 1 个（其余 36 个 skipped）—— `AssertionError: expected 520 to be 500`（现在截的是 `MAX_NARRATIVE_LEN = 1000`，前后空白先被 trim 掉）。

- [ ] **Step 3: 实现**

`worker/cases.ts:7-20` 的 import 里加 `APPEAL_MAX`（放在第一位）：

```ts
import {
  APPEAL_MAX,
  MAX_NARRATIVE_LEN,
```

`:398` 之前：

```ts
  const text = reason?.trim().slice(0, MAX_NARRATIVE_LEN) ?? '';
```

之后：

```ts
  // Same cap as the bot's modal and the web's maxLength (shared APPEAL_MAX).
  const text = reason?.trim().slice(0, APPEAL_MAX) ?? '';
```

（`:486` 改判理由的 `MAX_NARRATIVE_LEN` 不动。）

- [ ] **Step 4: 运行，确认通过**

```bash
npx vitest run --config vitest.workers.config.ts tests/worker/cases.test.ts
npm run typecheck
```

预期：PASS（37/37，`:449-472` 的三个申诉用例照常通过）；typecheck 通过。

- [ ] **Step 5: Commit**

```bash
git add worker/cases.ts tests/worker/cases.test.ts
git commit -m "fix: 申诉理由截到 APPEAL_MAX（500），和 bot 的上限一致"
```

---

### Task 3: 断言 `FILED_DM_GRACE_MS` 与 SQL 一致

**Files:**
- Modify: `tests/unit/source-hygiene.test.ts`（顶部 import、文件末尾新增一个 `describe`）

- [ ] **Step 1: 写测试**

在 `tests/unit/source-hygiene.test.ts` 的 import 区（`import { describe, expect, it } from 'vitest';` 之后）加：

```ts
import { FILED_DM_GRACE_MS } from '../../shared/scoring';
```

在 `const SOURCE_EXT = …` 之后加：

```ts
const MINUTE_MS = 60_000;
```

在文件末尾（已有的 `describe('source files', …)` 以及 P0-1 新增的用例之后）追加：

```ts

describe('shared constants that SQL repeats', () => {
  it('FILED_DM_GRACE_MS equals the filing DM delay in 0004_dm.sql', () => {
    const sql = readFileSync(path.join(ROOT, 'server/migrations/0004_dm.sql'), 'utf8');
    // The interval on the dm.filed outbox_emit call (0004_dm.sql:103-104). Not
    // 0005_sessions.sql's 3-minute reschedule merge: that is a different rule.
    const filed = /outbox_emit\('dm\.filed'[^;]*?interval '(\d+) minutes'/.exec(sql);
    expect(filed, "dm.filed's interval not found in 0004_dm.sql").not.toBeNull();
    expect(Number(filed?.[1]) * MINUTE_MS).toBe(FILED_DM_GRACE_MS);
  });
});
```

- [ ] **Step 2: 运行，确认通过；再确认它真的能拦住不一致**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npx vitest run --config vitest.config.ts tests/unit/source-hygiene.test.ts
```

预期：PASS。然后临时把 `shared/scoring.ts` 的 `FILED_DM_GRACE_MS` 改成 `4 * 60 * 1000`，再跑一次，预期 FAIL（`expected 180000 to be 240000`）；改回 `3 * 60 * 1000`，再跑一次 PASS。

- [ ] **Step 3: typecheck（tests/unit 由 tsconfig.worker.json 检查）**

```bash
npm run typecheck
```

预期：通过。

- [ ] **Step 4: Commit**

```bash
git add tests/unit/source-hygiene.test.ts
git commit -m "test: 断言 FILED_DM_GRACE_MS 与 0004_dm.sql 的立案私信延迟一致"
```

---

### Task 4: 用词与 M17：立案经过、待说明、撤案不显示缺席、删「本地时区」

**Files:**
- Modify: `shared/scoring.ts:151`（Task 1 插入 12 行之后是 `:163`）
- Modify: `src/components/VerdictCard.tsx:86`、`:100-104`
- Modify: `src/components/StatementDialog.tsx:100`
- Modify: `src/components/RulesPanel.tsx:36`（P0-4 合并后行号会下移几行，按片段定位）
- Test: `tests/dom/verdict-privacy.test.tsx`（`:96` 之后追加）、新 `tests/dom/wording.test.tsx`

- [ ] **Step 1: 写失败测试 —— withdrawn 用例（只追加，不动已有断言）**

在 `tests/dom/verdict-privacy.test.tsx` 末尾追加：

```tsx

describe('VerdictCard, a withdrawn case', () => {
  it('never says it was judged in absence — nobody was judged (M17)', () => {
    const withdrawn = record({
      status: 'withdrawn',
      delta: 0,
      statement: null,
      statement_at: null,
      verdict: null,
      redacted: false,
    });
    render(<VerdictCard record={withdrawn} />);
    expect(screen.queryByText(/按缺席裁决/)).not.toBeInTheDocument();
    expect(screen.getByText(/裁判已撤案/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 写失败测试 —— 新建 `tests/dom/wording.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { RecordsFeed } from '../../src/components/RecordsFeed';
import { RulesPanel } from '../../src/components/RulesPanel';
import { StatementDialog } from '../../src/components/StatementDialog';
import { VerdictCard } from '../../src/components/VerdictCard';
import type { Config, RecordItem } from '../../src/types';

// 用词表（spec §5）：立案人写的叫「立案经过」，当事人写的叫「说明」，所以
// 待写的状态叫「待说明」；规则里不再写死「本地时区」（M19 前半）。

const HOUR = 3_600_000;
const sqlTime = (ms: number): string => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

const CONFIG: Config = {
  violations: [],
  tiers: [],
  weeklyHeal: 5,
  weeklyBonusCap: 6,
  statementWindowHours: 12,
  aiEnabled: false,
  maxBatchSubjects: 5,
  nextResetAt: '2030-01-06T16:00:00.000Z',
};

function awaiting(over: Partial<RecordItem> = {}): RecordItem {
  return {
    id: 12,
    subject: { id: 'me', username: '我', avatar_url: null },
    reporter: { id: 'j', username: '阿飞', avatar_url: null },
    type: 'late_major',
    delta: 0,
    note: null,
    claim: '迟到 25 分钟，没打招呼',
    claim_summary: null,
    classified_by: 'ai',
    escalation_suggested: false,
    session_id: null,
    statement: null,
    statement_at: null,
    appeal_reason: null,
    deadline_at: sqlTime(Date.now() + 5 * HOUR),
    status: 'awaiting_statement',
    verdict: null,
    range: { min: -9, max: -3, base: -6 },
    created_at: sqlTime(Date.now() - HOUR),
    redacted: false,
    ...over,
  };
}

describe('立案经过', () => {
  it('is what the case card calls the reporter’s account', () => {
    render(<VerdictCard record={awaiting()} />);
    expect(screen.getByText('立案经过')).toBeInTheDocument();
    expect(screen.queryByText('裁判陈述')).not.toBeInTheDocument();
  });

  it('and what the statement dialog calls it', () => {
    render(<StatementDialog open record={awaiting()} config={CONFIG} onClose={() => {}} onDecided={() => {}} />);
    expect(screen.getByText('立案经过')).toBeInTheDocument();
    expect(screen.queryByText('裁判陈述')).not.toBeInTheDocument();
  });
});

describe('待说明', () => {
  it('labels an open case in the feed', () => {
    render(<RecordsFeed records={[awaiting()]} />);
    expect(screen.getByText('待说明')).toBeInTheDocument();
    expect(screen.queryByText('待陈述')).not.toBeInTheDocument();
  });
});

describe('RulesPanel', () => {
  it('says Monday 0:00 without claiming a local timezone', async () => {
    const user = userEvent.setup();
    render(<RulesPanel config={CONFIG} />);
    await user.click(screen.getByRole('button', { name: /计分规则/ }));
    expect(screen.getByText(/每位选手每周一 0 点自动恢复/)).toBeInTheDocument();
    expect(screen.queryByText(/本地时区/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: 运行，确认失败**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npx vitest run --config vitest.dom.config.ts tests/dom/verdict-privacy.test.tsx tests/dom/wording.test.tsx
```

预期：FAIL 5 个 —— withdrawn 用例找到「按缺席裁决」；两处「立案经过」找不到（还是「裁判陈述」）；「待说明」找不到（还是「待陈述」）；规则里还有「本地时区」。verdict-privacy 原有的 6 个用例仍 PASS。

- [ ] **Step 4: 实现**

`shared/scoring.ts:163`（快照 `:151`）之前：

```ts
  awaiting_statement: '待陈述',
```

之后：

```ts
  awaiting_statement: '待说明',
```

`src/components/VerdictCard.tsx:86` 之前：

```tsx
          <span className="vc__quote-who">裁判陈述</span>
```

之后：

```tsx
          <span className="vc__quote-who">立案经过</span>
```

`src/components/VerdictCard.tsx:100-104` 之前：

```tsx
      ) : (
        !pending && trial && (
          <p className="vc__absent">该选手没有在期限内说明情况，按缺席裁决。</p>
        )
      )}
```

之后：

```tsx
      ) : (
        // A withdrawn case was never judged at all (M17): no "absent" either.
        !pending && status !== 'withdrawn' && trial && (
          <p className="vc__absent">该选手没有在期限内说明情况，按缺席裁决。</p>
        )
      )}
```

`src/components/StatementDialog.tsx:100` 之前：

```tsx
            <span className="sd__claim-who">裁判陈述</span>
```

之后：

```tsx
            <span className="sd__claim-who">立案经过</span>
```

`src/components/RulesPanel.tsx:36` 之前：

```tsx
            每位选手每周一（{config ? '本地时区' : ''}）自动恢复
```

之后：

```tsx
            每位选手每周一 0 点自动恢复
```

- [ ] **Step 5: 运行，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/verdict-privacy.test.tsx tests/dom/wording.test.tsx tests/dom/p8-app.test.tsx tests/dom/deep-link.test.tsx
npm run typecheck
```

预期：全部 PASS（verdict-privacy 7 个，`:47,55,62,94` 的断言原样通过；p8-app `:196-199` 的 escalate 类名不受影响）。

- [ ] **Step 6: Commit**

```bash
git add shared/scoring.ts src/components/VerdictCard.tsx src/components/StatementDialog.tsx src/components/RulesPanel.tsx tests/dom/verdict-privacy.test.tsx tests/dom/wording.test.tsx
git commit -m "fix: 统一用词（立案经过、待说明），已撤案不再显示按缺席裁决，规则去掉本地时区"
```

---

### Task 5: 撤销倒计时的纯函数 + 前端常量

**Files:**
- Modify: `src/lib/constants.ts`（文件末尾追加 P0-5 小节）
- Create: `src/lib/revoke.ts`
- Test: 新 `tests/unit/revoke.test.ts`

- [ ] **Step 1: 写失败测试 `tests/unit/revoke.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { REVOKE_WINDOW_MS } from '../../shared/scoring';
import { formatRevokeLeft, revokeMsLeft } from '../../src/lib/revoke';

// The reporter's 15-minute revoke window, counted from created_at — the same
// clock revokeCase uses (worker/cases.ts:423) — and never shown as negative.

const MINUTE = 60_000;
const FILED = '2026-10-26 12:00:00'; // SQLite UTC, as the API sends it
const FILED_MS = Date.parse('2026-10-26T12:00:00Z');

describe('revokeMsLeft', () => {
  it('counts down from created_at, read as UTC', () => {
    expect(revokeMsLeft(FILED, FILED_MS + 3 * MINUTE)).toBe(REVOKE_WINDOW_MS - 3 * MINUTE);
  });

  it('clamps at 0 once the window is over', () => {
    expect(revokeMsLeft(FILED, FILED_MS + REVOKE_WINDOW_MS)).toBe(0);
    expect(revokeMsLeft(FILED, FILED_MS + REVOKE_WINDOW_MS + MINUTE)).toBe(0);
  });

  it('treats an unreadable created_at as closed', () => {
    expect(revokeMsLeft('not a time', FILED_MS)).toBe(0);
  });
});

describe('formatRevokeLeft', () => {
  it('speaks in whole minutes, rounding down', () => {
    expect(formatRevokeLeft(12 * MINUTE + 59_000)).toBe('还剩 12 分钟');
    expect(formatRevokeLeft(MINUTE)).toBe('还剩 1 分钟');
  });

  it('says less than a minute at the very end', () => {
    expect(formatRevokeLeft(59_000)).toBe('还剩不到 1 分钟');
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npx vitest run --config vitest.config.ts tests/unit/revoke.test.ts
```

预期：FAIL —— `Error: Cannot find module '../../src/lib/revoke' imported from …/tests/unit/revoke.test.ts`，`Tests  no tests`（unit 工程走 Node 解析，报的是 Cannot find module；dom 工程才报 Vite 的 Failed to resolve import）。

- [ ] **Step 3: 实现**

在 `src/lib/constants.ts` 末尾追加（P0-3、P0-4、P0-6 的小节都不动）：

```ts

// --- P0-5 ---
/** Revoke countdowns refresh this often (spec §5 #6). */
export const REVOKE_TICK_MS = 30_000;
/** Debounce between a keystroke and the draft write. */
export const DRAFT_SAVE_DEBOUNCE_MS = 400;
```

新建 `src/lib/revoke.ts`：

```ts
// The reporter's revoke window as a countdown (spec §5 #6, §3.8). Pure.
// The server decides with `Date.now() - created_at <= REVOKE_WINDOW_MS`
// (worker/cases.ts revokeCase); this only says how much of it is left, so the
// button can show it and disappear once it is gone — never a negative number.

import { REVOKE_WINDOW_MS } from '@shared/scoring';
import { parseTimestamp } from './time';

const MINUTE_MS = 60_000;

/** ms left in the reporter's revoke window, clamped at 0 (an unreadable created_at counts as closed). */
export function revokeMsLeft(createdAt: string, now: number): number {
  const created = parseTimestamp(createdAt);
  if (Number.isNaN(created)) return 0;
  return Math.max(0, created + REVOKE_WINDOW_MS - now);
}

/**
 * '还剩 12 分钟' | '还剩不到 1 分钟'. Whole minutes, rounded down: the button
 * refreshes every 30 s, and an mm:ss clock would visibly skip seconds.
 */
export function formatRevokeLeft(msLeft: number): string {
  const minutes = Math.floor(msLeft / MINUTE_MS);
  return minutes >= 1 ? `还剩 ${minutes} 分钟` : '还剩不到 1 分钟';
}
```

- [ ] **Step 4: 运行，确认通过**

```bash
npx vitest run --config vitest.config.ts tests/unit/revoke.test.ts
npm run typecheck
```

预期：PASS（5 个）；typecheck 通过（`revoke.ts` 只依赖 `@shared/scoring` 和 `./time`，在 tsconfig.worker.json 的无 DOM 环境下也能检查）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/constants.ts src/lib/revoke.ts tests/unit/revoke.test.ts
git commit -m "feat: 撤销窗口剩余时间的纯函数和 P0-5 前端常量"
```

---

### Task 6: 回血计算的纯函数

**Files:**
- Create: `src/lib/forgiveness.ts`
- Test: 新 `tests/unit/forgiveness.test.ts`

- [ ] **Step 1: 写失败测试 `tests/unit/forgiveness.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { healPreview, healPreviewText, projectedAfterHeal } from '../../src/lib/forgiveness';
import { formatTimeLeft } from '../../src/lib/time';

// The heal is +config.weeklyHeal, capped at MAX_SCORE (worker/db.ts weeklyHeal).
// Every config here says 5 — the test stub's value — so a literal 15 anywhere
// in the code would make these fail.

const HEAL = 5;
const DAY = 86_400_000;
const NOW = Date.parse('2026-10-28T04:00:00Z');
const NEXT = new Date(NOW + 2 * DAY + 3_600_000).toISOString();

function config(over: Partial<{ weeklyHeal: number; nextResetAt: string }> = {}) {
  return { weeklyHeal: HEAL, nextResetAt: NEXT, ...over };
}

describe('projectedAfterHeal', () => {
  it('adds the configured heal', () => {
    expect(projectedAfterHeal(82, HEAL)).toBe(87);
  });

  it('stops at MAX_SCORE, and a full score stays', () => {
    expect(projectedAfterHeal(98, HEAL)).toBe(100);
    expect(projectedAfterHeal(100, HEAL)).toBe(100);
  });

  it('treats a broken or negative heal as none', () => {
    expect(projectedAfterHeal(82, Number.NaN)).toBe(82);
    expect(projectedAfterHeal(82, -3)).toBe(82);
  });
});

describe('healPreview', () => {
  it('previews Monday from config', () => {
    expect(healPreview(82, config(), NOW)).toEqual({
      kind: 'heal',
      heal: 5,
      projected: 87,
      timeLeft: formatTimeLeft(NEXT, NOW),
    });
  });

  it('has nothing to wait for at full score', () => {
    expect(healPreview(100, config(), NOW)).toEqual({ kind: 'full' });
  });

  it('says healing once nextResetAt has passed — never a negative time', () => {
    expect(healPreview(82, config(), Date.parse(NEXT))).toEqual({ kind: 'healing' });
    expect(healPreview(82, config(), Date.parse(NEXT) + DAY)).toEqual({ kind: 'healing' });
  });

  it('still gives the numbers when nextResetAt cannot be read', () => {
    expect(healPreview(82, config({ nextResetAt: 'soon' }), NOW)).toEqual({
      kind: 'heal',
      heal: 5,
      projected: 87,
      timeLeft: '',
    });
  });
});

describe('healPreviewText', () => {
  it('reads like spec §3.2', () => {
    const timeLeft = formatTimeLeft(NEXT, NOW);
    expect(timeLeft).toMatch(/^还有 /);
    expect(healPreviewText(healPreview(82, config(), NOW))).toBe(`周一 0 点回血 +5 → 预计 87 · ${timeLeft}`);
  });

  it('drops the time part when there is none', () => {
    expect(healPreviewText({ kind: 'heal', heal: 5, projected: 87, timeLeft: '' })).toBe('周一 0 点回血 +5 → 预计 87');
  });

  it('has fixed lines for full and healing', () => {
    expect(healPreviewText({ kind: 'full' })).toBe('已经是满分，回血不用等。');
    expect(healPreviewText({ kind: 'healing' })).toBe('回血中…');
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npx vitest run --config vitest.config.ts tests/unit/forgiveness.test.ts
```

预期：FAIL —— `Error: Cannot find module '../../src/lib/forgiveness' imported from …/tests/unit/forgiveness.test.ts`，`Tests  no tests`。

- [ ] **Step 3: 实现 `src/lib/forgiveness.ts`**

```ts
// What the weekly heal will do for a score (spec §5 #3, M7). At the board's
// Monday 00:00 every participant below MAX_SCORE gets +config.weeklyHeal,
// capped at MAX_SCORE (worker/db.ts weeklyHeal). Pure: the numbers always come
// from config and shared — never a literal 15 (tests run with weeklyHeal = 5).

import { MAX_SCORE } from '@shared/scoring';
import type { Config } from '../types';
import { RESET_PENDING_LABEL, formatTimeLeft, parseTimestamp } from './time';

export type HealPreview =
  | { kind: 'full' } // 已经是满分
  | { kind: 'healing' } // now ≥ nextResetAt: waiting for config to be fetched again
  | { kind: 'heal'; heal: number; projected: number; timeLeft: string }; // timeLeft = formatTimeLeft(nextResetAt, now), '' when unknown

/** A heal that is not a finite positive number heals nothing. */
function healAmount(weeklyHeal: number): number {
  return Number.isFinite(weeklyHeal) ? Math.max(0, weeklyHeal) : 0;
}

/** min(MAX_SCORE, score + weeklyHeal); a score already at MAX_SCORE stays. */
export function projectedAfterHeal(score: number, weeklyHeal: number): number {
  return Math.min(MAX_SCORE, score + healAmount(weeklyHeal));
}

export function healPreview(
  score: number,
  config: Pick<Config, 'weeklyHeal' | 'nextResetAt'>,
  now: number,
): HealPreview {
  if (score >= MAX_SCORE) return { kind: 'full' };
  const resetAt = parseTimestamp(config.nextResetAt);
  if (!Number.isNaN(resetAt) && now >= resetAt) return { kind: 'healing' };
  const heal = healAmount(config.weeklyHeal);
  return {
    kind: 'heal',
    heal,
    projected: projectedAfterHeal(score, heal),
    timeLeft: Number.isNaN(resetAt) ? '' : formatTimeLeft(config.nextResetAt, now),
  };
}

/** The one line MyScoreLine and the player's own page show. */
export function healPreviewText(preview: HealPreview): string {
  switch (preview.kind) {
    case 'full':
      return '已经是满分，回血不用等。';
    case 'healing':
      return RESET_PENDING_LABEL; // the Header's own word for the same wait (P0-3)
    case 'heal': {
      const base = `周一 0 点回血 +${preview.heal} → 预计 ${preview.projected}`;
      return preview.timeLeft ? `${base} · ${preview.timeLeft}` : base;
    }
  }
}
```

- [ ] **Step 4: 运行，确认通过**

```bash
npx vitest run --config vitest.config.ts tests/unit/forgiveness.test.ts
npm run typecheck
```

预期：PASS（10 个）；typecheck 通过。

- [ ] **Step 5: Commit**

```bash
git add src/lib/forgiveness.ts tests/unit/forgiveness.test.ts
git commit -m "feat: 回血预告的纯函数，数字读 config.weeklyHeal 和 MAX_SCORE"
```

---

### Task 7: 六类草稿的形状与校验（纯）

**Files:**
- Create: `src/lib/draftShapes.ts`
- Test: 新 `tests/unit/draft-shapes.test.ts`

- [ ] **Step 1: 写失败测试 `tests/unit/draft-shapes.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { APPEAL_MAX, MAX_NARRATIVE_LEN } from '../../shared/scoring';
import {
  isCaseDraftEmpty,
  isRollCallDraftEmpty,
  isSessionDraftEmpty,
  mergeMarks,
  toStoredMark,
  validateAppealDraft,
  validateCaseDraft,
  validateOnboardingDraft,
  validateRollCallDraft,
  validateSessionDraft,
  validateStatementDraft,
} from '../../src/lib/draftShapes';

// Whatever comes back out of storage is outside data: it is checked, and
// anything the form could no longer show (a person who left, a slot that
// passed, a judge role the user does not hold) is dropped, not trusted.

describe('text drafts', () => {
  it('accept a string within the field cap, nothing else', () => {
    expect(validateStatementDraft('家里临时有事')).toBe('家里临时有事');
    expect(validateStatementDraft('长'.repeat(MAX_NARRATIVE_LEN + 1))).toBeNull();
    expect(validateAppealDraft('长'.repeat(APPEAL_MAX))).toBe('长'.repeat(APPEAL_MAX));
    expect(validateAppealDraft('长'.repeat(APPEAL_MAX + 1))).toBeNull();
    expect(validateAppealDraft(42)).toBeNull();
  });
});

describe('validateCaseDraft', () => {
  it('keeps only people who can still be picked, within the batch limit', () => {
    const raw = { picked: ['a', 'gone', 'b', 'c'], claim: '说好八点', extras: { a: '补一句', gone: 'x', c: 7 } };
    expect(validateCaseDraft(raw, ['a', 'b', 'c'], 2)).toEqual({
      picked: ['a', 'b'],
      claim: '说好八点',
      extras: { a: '补一句' },
    });
  });

  it('refuses a wrong shape', () => {
    expect(validateCaseDraft({ picked: 'a', claim: '', extras: {} }, ['a'], 5)).toBeNull();
    expect(validateCaseDraft({ picked: [], claim: 1, extras: {} }, ['a'], 5)).toBeNull();
    expect(validateCaseDraft({ picked: [], claim: '', extras: [] }, ['a'], 5)).toBeNull();
    expect(validateCaseDraft(null, ['a'], 5)).toBeNull();
  });

  it('is empty only with nobody, no claim and no notes', () => {
    expect(isCaseDraftEmpty({ picked: [], claim: '  ', extras: { a: ' ' } })).toBe(true);
    expect(isCaseDraftEmpty({ picked: ['a'], claim: '', extras: {} })).toBe(false);
    expect(isCaseDraftEmpty({ picked: [], claim: '有事', extras: {} })).toBe(false);
  });
});

describe('roll call drafts', () => {
  const roster = [
    { user: { id: 'a', username: '甲', avatar_url: null }, attendance: null, late_minutes: null },
    { user: { id: 'b', username: '乙', avatar_url: null }, attendance: 'late' as const, late_minutes: 5 },
  ];

  it('keeps marks for people still on the roster', () => {
    const raw = { a: { attendance: 'late', late_minutes: 12 }, gone: { attendance: 'on_time' }, b: { attendance: 'nope' } };
    expect(validateRollCallDraft(raw, ['a', 'b'])).toEqual({ a: { attendance: 'late', late_minutes: 12 } });
  });

  it('drops minutes that are not a whole number in range', () => {
    expect(validateRollCallDraft({ a: { attendance: 'late', late_minutes: -1 } }, ['a'])).toEqual({ a: { attendance: 'late' } });
    expect(validateRollCallDraft({ a: { attendance: 'late', late_minutes: 2000 } }, ['a'])).toEqual({ a: { attendance: 'late' } });
  });

  it('shows the server’s marks under this device’s', () => {
    expect(mergeMarks(roster, { a: { attendance: 'on_time' } })).toEqual({
      a: { attendance: 'on_time', lateMinutes: '' },
      b: { attendance: 'late', lateMinutes: '5' },
    });
    expect(mergeMarks(roster, { b: { attendance: 'late' } }).b).toEqual({ attendance: 'late', lateMinutes: '' });
  });

  it('stores a mark only once an attendance is picked', () => {
    expect(toStoredMark({ attendance: null, lateMinutes: '3' })).toBeNull();
    expect(toStoredMark({ attendance: 'late', lateMinutes: '12' })).toEqual({ attendance: 'late', late_minutes: 12 });
    expect(toStoredMark({ attendance: 'late', lateMinutes: '' })).toEqual({ attendance: 'late' });
    expect(toStoredMark({ attendance: 'on_time', lateMinutes: '1.5' })).toEqual({ attendance: 'on_time' });
  });

  it('is empty with no marks', () => {
    expect(isRollCallDraftEmpty({})).toBe(true);
    expect(isRollCallDraftEmpty({ a: { attendance: 'excused' } })).toBe(false);
  });
});

describe('validateSessionDraft', () => {
  it('drops people who left and a slot that passed', () => {
    const raw = { invite: ['b', 'gone'], custom: '', chosen: '2020-01-01T12:00:00.000Z' };
    expect(validateSessionDraft(raw, ['b'], ['2030-01-04T12:00:00.000Z'])).toEqual({ invite: ['b'], custom: '', chosen: null });
  });

  it('keeps a slot that is still offered and a datetime-local value', () => {
    const raw = { invite: [], custom: '2030-01-04T20:00', chosen: '2030-01-04T12:00:00.000Z' };
    expect(validateSessionDraft(raw, [], ['2030-01-04T12:00:00.000Z'])).toEqual(raw);
  });

  it('refuses a custom time that is not a datetime-local value', () => {
    expect(validateSessionDraft({ invite: [], custom: 'tomorrow', chosen: null }, [], [])).toBeNull();
  });

  it('counts as a draft only once someone is picked', () => {
    expect(isSessionDraftEmpty({ invite: [], custom: '2030-01-04T20:00', chosen: null })).toBe(true);
    expect(isSessionDraftEmpty({ invite: ['b'], custom: '', chosen: null })).toBe(false);
  });
});

describe('validateOnboardingDraft', () => {
  it('keeps a choice the user may make', () => {
    const raw = { choice: 'both', useNanako: false, customName: '小七' };
    expect(validateOnboardingDraft(raw, true)).toEqual(raw);
  });

  it('never pre-picks a judge role for someone who is not one', () => {
    expect(validateOnboardingDraft({ choice: 'judge', useNanako: true, customName: '' }, false)).toBeNull();
    expect(validateOnboardingDraft({ choice: 'participant', useNanako: true, customName: '' }, false)).toEqual({
      choice: 'participant',
      useNanako: true,
      customName: '',
    });
  });

  it('refuses an unknown choice or a too-long name', () => {
    expect(validateOnboardingDraft({ choice: 'admin', useNanako: true, customName: '' }, true)).toBeNull();
    expect(validateOnboardingDraft({ choice: 'participant', useNanako: false, customName: '名'.repeat(25) }, true)).toBeNull();
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npx vitest run --config vitest.config.ts tests/unit/draft-shapes.test.ts
```

预期：FAIL —— `Error: Cannot find module '../../src/lib/draftShapes' imported from …/tests/unit/draft-shapes.test.ts`，`Tests  no tests`。

- [ ] **Step 3: 实现 `src/lib/draftShapes.ts`**

```ts
// The six local drafts (spec §5 #4): their shapes, and validators for what
// comes back out of storage. Storage is outside data — a draft from an older
// build, another tab or a hand edit must not crash a form or smuggle in a value
// the form could not produce. Anything that no longer fits (a person who left
// the roster, a slot that passed, a judge role the user lacks) is dropped.
// Pure: unit-tested in tests/unit/draft-shapes.test.ts.

import { isAttendance, type Attendance } from '@shared/attendance';
import { APPEAL_MAX, MAX_NARRATIVE_LEN } from '@shared/scoring';
import type { SessionPlayer } from '../types';

/** CaseDialog's per-person note (单独补一句). */
export const CASE_EXTRA_MAX = 300;
/** OnboardingDialog's custom display name. */
export const DISPLAY_NAME_MAX = 24;
/** RollCallDialog's minutes-late field — the API's MAX_LATE_MINUTES (worker/sessions.ts:49). */
export const LATE_MINUTES_MAX = 24 * 60;

export interface CaseDraftValue {
  picked: string[];
  claim: string;
  extras: Record<string, string>;
}
export interface StoredMark {
  attendance: Attendance;
  late_minutes?: number;
}
/** Only the marks made on this device, by user id; the server's show through underneath. */
export type RollCallDraftValue = Record<string, StoredMark>;
export interface SessionDraftValue {
  invite: string[];
  custom: string;
  chosen: string | null;
}
export type OnboardingChoice = 'participant' | 'judge' | 'both';
export interface OnboardingDraftValue {
  choice: OnboardingChoice;
  useNanako: boolean;
  customName: string;
}
/** What step 1 of the roll call edits: the minutes stay a string while being typed. */
export interface MarkInput {
  attendance: Attendance | null;
  lateMinutes: string;
}

const ONBOARDING_CHOICES: readonly string[] = ['participant', 'judge', 'both'];
/** A `datetime-local` value: YYYY-MM-DDTHH:MM. */
const DATETIME_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

function stringList(raw: unknown): string[] | null {
  return Array.isArray(raw) && raw.every((item) => typeof item === 'string') ? (raw as string[]) : null;
}

export function isBlankText(text: string): boolean {
  return text.trim().length === 0;
}

/** A free-text draft (说明、申诉理由): a string within the field's cap. */
function textDraft(max: number): (raw: unknown) => string | null {
  return (raw) => (typeof raw === 'string' && raw.length <= max ? raw : null);
}

export const validateStatementDraft = textDraft(MAX_NARRATIVE_LEN);
export const validateAppealDraft = textDraft(APPEAL_MAX);

export function validateCaseDraft(
  raw: unknown,
  candidateIds: readonly string[],
  maxSubjects: number,
): CaseDraftValue | null {
  if (!isRecord(raw)) return null;
  const { picked: rawPicked, claim, extras: rawExtras } = raw;
  const picked = stringList(rawPicked);
  if (picked === null || typeof claim !== 'string' || claim.length > MAX_NARRATIVE_LEN || !isRecord(rawExtras)) {
    return null;
  }
  const kept = picked.filter((id) => candidateIds.includes(id)).slice(0, Math.max(0, maxSubjects));
  const extras = Object.fromEntries(
    Object.entries(rawExtras).filter(
      (entry): entry is [string, string] =>
        kept.includes(entry[0]) && typeof entry[1] === 'string' && entry[1].length <= CASE_EXTRA_MAX,
    ),
  );
  return { picked: kept, claim, extras };
}

export function isCaseDraftEmpty(value: CaseDraftValue): boolean {
  return value.picked.length === 0 && isBlankText(value.claim) && Object.values(value.extras).every(isBlankText);
}

export function isLateMinutes(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= LATE_MINUTES_MAX;
}

function parseMark(raw: unknown): StoredMark | null {
  if (!isRecord(raw)) return null;
  const { attendance, late_minutes: late } = raw;
  if (typeof attendance !== 'string' || !isAttendance(attendance)) return null;
  return isLateMinutes(late) ? { attendance, late_minutes: late } : { attendance };
}

export function validateRollCallDraft(raw: unknown, rosterIds: readonly string[]): RollCallDraftValue | null {
  if (!isRecord(raw)) return null;
  const marks = Object.entries(raw).flatMap(([id, value]): [string, StoredMark][] => {
    const mark = rosterIds.includes(id) ? parseMark(value) : null;
    return mark ? [[id, mark]] : [];
  });
  return Object.fromEntries(marks);
}

export function isRollCallDraftEmpty(value: RollCallDraftValue): boolean {
  return Object.keys(value).length === 0;
}

/** The server's marks with this device's on top — what step 1 shows. */
export function mergeMarks(
  roster: readonly Pick<SessionPlayer, 'user' | 'attendance' | 'late_minutes'>[],
  draft: RollCallDraftValue,
): Record<string, MarkInput> {
  return Object.fromEntries(
    roster.map((p) => {
      const mine = draft[p.user.id];
      const late = mine ? mine.late_minutes : p.late_minutes ?? undefined;
      const input: MarkInput = {
        attendance: mine?.attendance ?? p.attendance,
        lateMinutes: late === undefined ? '' : String(late),
      };
      return [p.user.id, input];
    }),
  );
}

/** One person's step-1 input as the draft keeps it; null until an attendance is picked. */
export function toStoredMark(input: MarkInput): StoredMark | null {
  if (input.attendance === null) return null;
  const minutes = input.lateMinutes.trim() === '' ? Number.NaN : Number(input.lateMinutes);
  return isLateMinutes(minutes)
    ? { attendance: input.attendance, late_minutes: minutes }
    : { attendance: input.attendance };
}

export function validateSessionDraft(
  raw: unknown,
  invitableIds: readonly string[],
  slotIsos: readonly string[],
): SessionDraftValue | null {
  if (!isRecord(raw)) return null;
  const invite = stringList(raw.invite);
  const { custom, chosen } = raw;
  if (invite === null || typeof custom !== 'string') return null;
  if (custom !== '' && !DATETIME_LOCAL.test(custom)) return null;
  if (chosen !== null && typeof chosen !== 'string') return null;
  return {
    invite: invite.filter((id) => invitableIds.includes(id)),
    custom,
    chosen: typeof chosen === 'string' && slotIsos.includes(chosen) ? chosen : null,
  };
}

/** Only people make a session form worth guarding (spec §3.6 离开保护). */
export function isSessionDraftEmpty(value: SessionDraftValue): boolean {
  return value.invite.length === 0;
}

export function validateOnboardingDraft(raw: unknown, canJudge: boolean): OnboardingDraftValue | null {
  if (!isRecord(raw)) return null;
  const { choice, useNanako, customName } = raw;
  if (typeof choice !== 'string' || !ONBOARDING_CHOICES.includes(choice)) return null;
  // The API refuses a self-granted judge role (worker/routes.ts /api/me/roles): never pre-pick one.
  if (!canJudge && choice !== 'participant') return null;
  if (typeof useNanako !== 'boolean' || typeof customName !== 'string' || customName.length > DISPLAY_NAME_MAX) {
    return null;
  }
  return { choice: choice as OnboardingChoice, useNanako, customName };
}
```

- [ ] **Step 4: 运行，确认通过**

```bash
npx vitest run --config vitest.config.ts tests/unit/draft-shapes.test.ts
npm run typecheck
```

预期：PASS（16 个）；typecheck 通过。

- [ ] **Step 5: Commit**

```bash
git add src/lib/draftShapes.ts tests/unit/draft-shapes.test.ts
git commit -m "feat: 六类本机草稿的形状与读回校验"
```

---

### Task 8: 草稿存储、`useDraft`、`useLeaveGuard`、`DraftNote`

**Files:**
- Create: `src/lib/drafts.ts`、`src/lib/useDraft.ts`、`src/lib/useLeaveGuard.ts`
- Create: `src/components/DraftNote.tsx`、`src/components/draft-note.css`
- Modify: `tests/dom/setup.ts`（P0-2 建的 `afterEach` 里）
- Test: 新 `tests/dom/drafts.test.tsx`

- [ ] **Step 1: 写失败测试 —— 新建 `tests/dom/drafts.test.tsx`**

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DraftNote } from '../../src/components/DraftNote';
import { clearAllDrafts, draftKey, readDraft, writeDraft } from '../../src/lib/drafts';
import { isBlankText, validateStatementDraft } from '../../src/lib/draftShapes';
import { useDraft } from '../../src/lib/useDraft';

// Six local drafts (spec §5 #4): what is typed survives a closed dialog, a
// reload and the Discord round trip, and is gone after a successful submit or
// a logout. tests/dom/setup.ts empties both storages after every test.

interface Call {
  method: string;
  path: string;
  body: unknown;
}

function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, text: () => Promise.resolve(JSON.stringify(body)) } as Response;
}

/** Route fetch by "METHOD /path?query"; anything unrouted answers 500 so it shows up. */
function mockFetch(routes: Record<string, () => Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = url.replace(/^https?:\/\/[^/]+/, '');
      const method = init?.method ?? 'GET';
      calls.push({ method, path, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) });
      const route = routes[`${method} ${path}`];
      return Promise.resolve(route ? route() : json(500, { error: `unrouted ${method} ${path}` }));
    }),
  );
  return calls;
}

/** The value a draft holds in storage, or null. */
function stored(storage: Storage, key: string): unknown {
  const raw = storage.getItem(key);
  return raw === null ? null : (JSON.parse(raw) as { value: unknown }).value;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('draft storage', () => {
  it('keys drafts edg.draft.<kind>[.<id>]', () => {
    expect(draftKey('statement', 12)).toBe('edg.draft.statement.12');
    expect(draftKey('case')).toBe('edg.draft.case');
  });

  it('keeps the first-run choice in sessionStorage and the rest in localStorage', () => {
    expect(writeDraft('onboarding', undefined, { choice: 'participant' })).toBe(true);
    expect(writeDraft('appeal', 3, '我在医院')).toBe(true);
    expect(sessionStorage.getItem('edg.draft.onboarding')).not.toBeNull();
    expect(localStorage.getItem('edg.draft.onboarding')).toBeNull();
    expect(stored(localStorage, 'edg.draft.appeal.3')).toBe('我在医院');
  });

  it('drops an entry that does not parse or no longer fits, instead of trusting it', () => {
    localStorage.setItem('edg.draft.statement.1', '{not json');
    localStorage.setItem('edg.draft.statement.2', JSON.stringify({ v: 1, savedAt: 1, value: 42 }));
    expect(readDraft('statement', 1, validateStatementDraft)).toBeNull();
    expect(readDraft('statement', 2, validateStatementDraft)).toBeNull();
    expect(localStorage.getItem('edg.draft.statement.1')).toBeNull();
    expect(localStorage.getItem('edg.draft.statement.2')).toBeNull();
  });

  it('clears every draft from both storages, and nothing else', () => {
    writeDraft('statement', 1, '说明');
    writeDraft('onboarding', undefined, { choice: 'judge' });
    localStorage.setItem('edg.welcome.dismissed', '1');
    clearAllDrafts();
    expect(localStorage.getItem('edg.draft.statement.1')).toBeNull();
    expect(sessionStorage.getItem('edg.draft.onboarding')).toBeNull();
    expect(localStorage.getItem('edg.welcome.dismissed')).toBe('1');
  });

  it('reports a write that storage refused', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    try {
      expect(writeDraft('statement', 1, '说明')).toBe(false);
    } finally {
      setItem.mockRestore();
    }
  });
});

function Harness({ id }: { id: number }): JSX.Element {
  const draft = useDraft<string>('statement', id, '', { validate: validateStatementDraft, isEmpty: isBlankText });
  return (
    <>
      <textarea aria-label="说明" value={draft.value} onChange={(e) => draft.setValue(e.target.value)} />
      <DraftNote savedAt={draft.savedAt} length={draft.value.trim().length} onClear={draft.clear} />
      <span data-testid="flags">{`${draft.restored ? 'restored' : 'fresh'} ${draft.dirty ? 'dirty' : 'clean'}`}</span>
    </>
  );
}

describe('useDraft', () => {
  it('saves after a pause and brings it back next time', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness id={1} />);
    await user.type(screen.getByRole('textbox', { name: '说明' }), '家里有事');
    await waitFor(() => expect(stored(localStorage, 'edg.draft.statement.1')).toBe('家里有事'));
    expect(screen.getByText('草稿已存在这台设备 · 写了 4 字')).toBeInTheDocument();
    unmount();

    render(<Harness id={1} />);
    expect(screen.getByRole('textbox', { name: '说明' })).toHaveValue('家里有事');
    expect(screen.getByTestId('flags')).toHaveTextContent('restored dirty');
  });

  it('keeps the last keystrokes when the form goes away before the pause is over', () => {
    // Frozen clock and a synchronous change event: the debounce can never fire
    // here, so only the unmount flush can have written the draft. (Not
    // user-event: under plain fake timers RTL's asyncWrapper waits on a
    // setTimeout(0) nobody advances — it only knows Jest's fake timers.)
    vi.useFakeTimers();
    try {
      const { unmount } = render(<Harness id={2} />);
      fireEvent.change(screen.getByRole('textbox', { name: '说明' }), { target: { value: '网络断了' } });
      expect(localStorage.getItem('edg.draft.statement.2')).toBeNull(); // still inside the debounce
      unmount();
      expect(stored(localStorage, 'edg.draft.statement.2')).toBe('网络断了');
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops the key when the text is emptied, and 清空 resets the field', async () => {
    const user = userEvent.setup();
    render(<Harness id={3} />);
    const box = screen.getByRole('textbox', { name: '说明' });
    await user.type(box, '有');
    await waitFor(() => expect(localStorage.getItem('edg.draft.statement.3')).not.toBeNull());
    await user.clear(box);
    await waitFor(() => expect(localStorage.getItem('edg.draft.statement.3')).toBeNull());

    await user.type(box, '再写');
    await waitFor(() => expect(localStorage.getItem('edg.draft.statement.3')).not.toBeNull());
    await user.click(screen.getByRole('button', { name: '清空' }));
    expect(box).toHaveValue('');
    expect(localStorage.getItem('edg.draft.statement.3')).toBeNull();
    expect(screen.queryByText(/草稿已存在这台设备/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npx vitest run --config vitest.dom.config.ts tests/dom/drafts.test.tsx
```

预期：FAIL —— `Failed to resolve import "../../src/components/DraftNote"`（以及 `drafts`、`useDraft`）。

- [ ] **Step 3: 实现 `src/lib/drafts.ts`**

```ts
// Local drafts for long or multi-step forms (spec §5 #4): one key per form,
// 'edg.draft.<kind>[.<id>]'. The first-run choice lives in sessionStorage (it
// only has to survive the Discord round trip); everything else in localStorage.
// Storage may be missing, blocked or full (private mode, quota): every access
// is guarded, and writeDraft tells its caller whether anything was kept, so the
// UI never claims a draft that does not exist.

export type DraftKind = 'statement' | 'case' | 'appeal' | 'rollcall' | 'session' | 'onboarding';

export interface StoredDraft<T> {
  v: 1;
  savedAt: number;
  value: T;
}

const PREFIX = 'edg.draft.';
const VERSION = 1;
const STORAGE_NAMES = ['localStorage', 'sessionStorage'] as const;

/** 'edg.draft.<kind>.<id>', or 'edg.draft.<kind>' when there is no id. */
export function draftKey(kind: DraftKind, id?: number | string): string {
  return id === undefined ? `${PREFIX}${kind}` : `${PREFIX}${kind}.${id}`;
}

function storageFor(kind: DraftKind): Storage | null {
  try {
    return kind === 'onboarding' ? window.sessionStorage : window.localStorage;
  } catch {
    return null; // merely touching storage throws when the browser blocks it
  }
}

function parseEnvelope(raw: string): { savedAt: number; value: unknown } | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { v, savedAt, value } = parsed as Partial<StoredDraft<unknown>>;
    return v === VERSION && typeof savedAt === 'number' && Number.isFinite(savedAt) ? { savedAt, value } : null;
  } catch {
    return null; // not JSON: treated like any other invalid entry
  }
}

/** Parses and validates; an unparsable or invalid entry is removed and null returned. Never throws. */
export function readDraft<T>(
  kind: DraftKind,
  id: number | string | undefined,
  validate: (raw: unknown) => T | null,
): StoredDraft<T> | null {
  const storage = storageFor(kind);
  if (!storage) return null;
  const key = draftKey(kind, id);
  try {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    const envelope = parseEnvelope(raw);
    const value = envelope ? validate(envelope.value) : null;
    if (envelope && value !== null) return { v: VERSION, savedAt: envelope.savedAt, value };
    storage.removeItem(key);
    return null;
  } catch {
    return null; // storage went away mid-read: behave as if there were no draft
  }
}

/** Returns whether the draft was actually kept (false: no storage, or it is full). */
export function writeDraft<T>(
  kind: DraftKind,
  id: number | string | undefined,
  value: T,
  now: number = Date.now(),
): boolean {
  const storage = storageFor(kind);
  if (!storage) return false;
  const envelope: StoredDraft<T> = { v: VERSION, savedAt: now, value };
  try {
    storage.setItem(draftKey(kind, id), JSON.stringify(envelope));
    return true;
  } catch {
    return false; // QuotaExceededError / private mode — the caller shows no "saved" note
  }
}

export function clearDraft(kind: DraftKind, id?: number | string): void {
  const storage = storageFor(kind);
  try {
    storage?.removeItem(draftKey(kind, id));
  } catch {
    // Nothing could have been stored there either.
  }
}

/** Logout: remove every key starting with 'edg.draft.' from BOTH storages. */
export function clearAllDrafts(): void {
  for (const name of STORAGE_NAMES) {
    try {
      const storage = window[name];
      const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(
        (key): key is string => key !== null && key.startsWith(PREFIX),
      );
      keys.forEach((key) => storage.removeItem(key));
    } catch {
      // This storage is unavailable: no draft was kept in it.
    }
  }
}
```

- [ ] **Step 4: 实现 `src/lib/useDraft.ts`**

```ts
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { DRAFT_SAVE_DEBOUNCE_MS } from './constants';
import { clearDraft, readDraft, writeDraft, type DraftKind, type StoredDraft } from './drafts';

export interface DraftOptions<T> {
  validate: (raw: unknown) => T | null;
  isEmpty: (value: T) => boolean;
}

export interface DraftState<T> {
  value: T;
  setValue: (next: T | ((prev: T) => T)) => void;
  /** value came from storage on mount */
  restored: boolean;
  savedAt: number | null;
  /** !isEmpty(value) */
  dirty: boolean;
  /** remove storage + reset to initial (after a successful submit) */
  clear: () => void;
}

/** Write a non-empty value (returns when it was kept), or drop the key for an empty one. */
function persist<T>(kind: DraftKind, id: number | string | undefined, value: T, isEmpty: (v: T) => boolean): number | null {
  if (isEmpty(value)) {
    clearDraft(kind, id);
    return null;
  }
  const now = Date.now();
  return writeDraft(kind, id, value, now) ? now : null;
}

/** Read once on mount; a draft the validator emptied out counts as none and is dropped. */
function readInitial<T>(kind: DraftKind, id: number | string | undefined, options: DraftOptions<T>): StoredDraft<T> | null {
  const draft = readDraft(kind, id, options.validate);
  if (draft && options.isEmpty(draft.value)) {
    clearDraft(kind, id); // e.g. everyone in it has left the roster
    return null;
  }
  return draft;
}

/**
 * Writes `value` DRAFT_SAVE_DEBOUNCE_MS after the last edit, and at once on
 * unmount so a dialog closed mid-debounce keeps its last keystrokes. Returns
 * the "an edit is waiting" flag: setValue raises it, clear lowers it.
 */
function useDraftSaving<T>(
  kind: DraftKind,
  id: number | string | undefined,
  value: T,
  isEmpty: (value: T) => boolean,
  onSaved: (savedAt: number | null) => void,
): MutableRefObject<boolean> {
  const pendingRef = useRef(false);
  const isEmptyRef = useRef(isEmpty);
  const latestRef = useRef(value);

  useEffect(() => {
    isEmptyRef.current = isEmpty;
    latestRef.current = value;
  });

  useEffect(() => {
    if (!pendingRef.current) return undefined;
    const timer = window.setTimeout(() => {
      pendingRef.current = false;
      onSaved(persist(kind, id, value, isEmptyRef.current));
    }, DRAFT_SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [kind, id, value, onSaved]);

  // Unmount: flush an edit still waiting for its debounce (no state update — the component is gone).
  useEffect(
    () => () => {
      if (pendingRef.current) persist(kind, id, latestRef.current, isEmptyRef.current);
    },
    [kind, id],
  );

  return pendingRef;
}

/**
 * A form value mirrored into a local draft (spec §5 #4). `id` must stay the same
 * for the hook's lifetime — callers key the component by it.
 */
export function useDraft<T>(
  kind: DraftKind,
  id: number | string | undefined,
  initial: T,
  options: DraftOptions<T>,
): DraftState<T> {
  const [restoredDraft] = useState(() => readInitial(kind, id, options));
  const [value, setRawValue] = useState<T>(() => (restoredDraft ? restoredDraft.value : initial));
  const [savedAt, setSavedAt] = useState<number | null>(restoredDraft?.savedAt ?? null);
  const [restored, setRestored] = useState(restoredDraft !== null);
  const initialRef = useRef(initial);
  const pendingRef = useDraftSaving(kind, id, value, options.isEmpty, setSavedAt);

  const setValue = useCallback((next: T | ((prev: T) => T)): void => {
    pendingRef.current = true;
    setRawValue((prev) => (typeof next === 'function' ? (next as (p: T) => T)(prev) : (next as T)));
  }, [pendingRef]);

  const clear = useCallback((): void => {
    pendingRef.current = false;
    clearDraft(kind, id);
    setRawValue(initialRef.current);
    setSavedAt(null);
    setRestored(false);
  }, [kind, id, pendingRef]);

  return { value, setValue, restored, savedAt, dirty: !options.isEmpty(value), clear };
}
```

- [ ] **Step 5: 实现 `src/lib/useLeaveGuard.ts`**

```ts
import type { RefObject } from 'react';
import { useInlineConfirm } from './useInlineConfirm';

export interface LeaveGuard {
  /** Pass as the Modal's onClose and to every 稍后再说/取消 button. dirty → shows the confirm; clean → leave(). While confirming, a second call is a no-op. */
  requestClose: () => void;
  confirmingLeave: boolean;
  /** 「继续写」: hide the confirm, focus back on the button that asked. */
  stay: () => void;
  /** 「先离开」: the draft stays on the device. */
  confirmLeave: () => void;
  /** Attach to the 稍后再说 / 取消 button, so stay() can put focus back on it. */
  triggerRef: RefObject<HTMLButtonElement>;
}

/**
 * Closing a form that holds a draft asks first, in place (ConfirmInline, not
 * window.confirm — spec §5 #4). Built on useInlineConfirm so the keyboard ends
 * up where it was when the user backs out.
 */
export function useLeaveGuard(dirty: boolean, leave: () => void): LeaveGuard {
  const { confirming, ask, dismiss, close, triggerRef } = useInlineConfirm<HTMLButtonElement>();

  const requestClose = (): void => {
    if (confirming) return;
    if (dirty) ask();
    else leave();
  };

  const confirmLeave = (): void => {
    close();
    leave();
  };

  return { requestClose, confirmingLeave: confirming, stay: dismiss, confirmLeave, triggerRef };
}
```

- [ ] **Step 6: 实现 `src/components/DraftNote.tsx` 和 `draft-note.css`**

`src/components/DraftNote.tsx`：

```tsx
import './draft-note.css';

interface DraftNoteProps {
  /** When the draft was last kept; null → nothing is stored, nothing is said. */
  savedAt: number | null;
  /** Characters written, for free-text drafts. */
  length?: number;
  onClear?: () => void;
}

const SAVED = '草稿已存在这台设备';

/** 「草稿已存在这台设备 · 写了 42 字」 + optional 清空 (spec §5 #4). */
export function DraftNote({ savedAt, length, onClear }: DraftNoteProps): JSX.Element | null {
  if (savedAt === null) return null;
  return (
    <p className="draft-note">
      <span>{length === undefined ? SAVED : `${SAVED} · 写了 ${length} 字`}</span>
      {onClear && (
        <button type="button" className="draft-note__clear" onClick={onClear}>
          清空
        </button>
      )}
    </p>
  );
}
```

`src/components/draft-note.css`：

```css
/* 草稿提示 — tells the writer their text is kept on this device (spec §5 #4). */

.draft-note {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  font-size: var(--fs-xs);
  color: var(--muted);
}

.draft-note__clear {
  padding: 0.15rem 0.55rem;
  border: 1px solid var(--border-input);
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--muted);
  font: inherit;
  cursor: pointer;
}

@media (hover: hover) {
  .draft-note__clear:hover {
    color: var(--text);
    border-color: var(--text);
  }
}

@media (pointer: coarse) {
  .draft-note__clear {
    min-height: var(--tap-min);
  }
}
```

- [ ] **Step 7: `tests/dom/setup.ts` —— 在 P0-2 建的 `afterEach` 里清 storage**

之前（P0-2 留的注释行）：

```ts
  // P0-5: window.localStorage.clear(); window.sessionStorage.clear();
```

之后：

```ts
  // P0-5: drafts live in storage — one test's draft must never restore in the next.
  window.localStorage.clear();
  window.sessionStorage.clear();
```

- [ ] **Step 8: 运行，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/drafts.test.tsx
npx vitest run --config vitest.config.ts tests/unit/css-conventions.test.ts
npm run typecheck
```

预期：drafts.test.tsx PASS（8 个）；css-conventions PASS（新 css 只用了 hover/coarse 两种 media）；typecheck 通过。另做一次反证：临时把 `useDraft.ts` 里卸载补写那行（`if (pendingRef.current) persist(…)`）注释掉，「keeps the last keystrokes…」应当 FAIL，恢复后 PASS。

- [ ] **Step 9: Commit**

```bash
git add src/lib/drafts.ts src/lib/useDraft.ts src/lib/useLeaveGuard.ts src/components/DraftNote.tsx src/components/draft-note.css tests/dom/setup.ts tests/dom/drafts.test.tsx
git commit -m "feat: 本机草稿的存储、useDraft、离开确认和草稿提示"
```

---

### Task 9: `ForgivenessNote` 与 `MyScoreLine`

**Files:**
- Create: `src/components/ForgivenessNote.tsx`、`src/components/forgiveness-note.css`
- Create: `src/components/MyScoreLine.tsx`、`src/components/my-score-line.css`
- Test: 新 `tests/dom/my-score-line.test.tsx`

- [ ] **Step 1: 写失败测试 `tests/dom/my-score-line.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ForgivenessNote } from '../../src/components/ForgivenessNote';
import { MyScoreLine } from '../../src/components/MyScoreLine';
import type { Config, User } from '../../src/types';

// 宽恕看得见（spec §5 #3, M7）. weeklyHeal is 5 in every config here, as in the
// app tests' stub: a literal 15 anywhere would show up as a failure.

const DAY = 86_400_000;
const HOUR = 3_600_000;
const fromNow = (ms: number): string => new Date(Date.now() + ms).toISOString();

const CONFIG: Config = {
  violations: [],
  tiers: [],
  weeklyHeal: 5,
  weeklyBonusCap: 6,
  statementWindowHours: 12,
  aiEnabled: false,
  maxBatchSubjects: 5,
  nextResetAt: fromNow(2 * DAY + HOUR),
};

const ME: User = {
  id: 'me',
  username: '我',
  oauth_username: '我',
  avatar_url: null,
  is_participant: true,
  is_judge: false,
  is_admin: false,
  score: 82,
  created_at: '2026-10-01 00:00:00',
};

describe('MyScoreLine', () => {
  it('shows score, rank and what Monday does, from config', () => {
    render(<MyScoreLine me={ME} rank={6} config={CONFIG} />);
    expect(screen.getByText('82 分 · 第 6 名')).toBeInTheDocument();
    expect(screen.getByText('周一 0 点回血 +5 → 预计 87 · 还有 2 天')).toBeInTheDocument();
    // 本周变化 waits for P4-5.
    expect(screen.queryByText(/本周/)).not.toBeInTheDocument();
  });

  it('has nothing to wait for at full score', () => {
    render(<MyScoreLine me={{ ...ME, score: 100 }} rank={1} config={CONFIG} />);
    expect(screen.getByText('已经是满分，回血不用等。')).toBeInTheDocument();
  });

  it('says 回血中… once the reset time has passed — never a negative time', () => {
    render(<MyScoreLine me={ME} rank={6} config={{ ...CONFIG, nextResetAt: fromNow(-HOUR) }} />);
    expect(screen.getByText('回血中…')).toBeInTheDocument();
    expect(screen.queryByText(/-\d/)).not.toBeInTheDocument();
  });

  it('leaves out the rank off the board, and is not there for a non-participant', () => {
    const { unmount } = render(<MyScoreLine me={ME} rank={null} config={CONFIG} />);
    expect(screen.getByText('82 分')).toBeInTheDocument();
    unmount();
    const { container } = render(<MyScoreLine me={{ ...ME, is_participant: false }} rank={null} config={CONFIG} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('opens the details when it can', async () => {
    const onOpen = vi.fn();
    render(<MyScoreLine me={ME} rank={6} config={CONFIG} onOpen={onOpen} />);
    await userEvent.setup().click(screen.getByRole('button', { name: '82 分 · 第 6 名' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe('ForgivenessNote', () => {
  it('gives the way back after a penalty, from weeklyHeal', () => {
    render(<ForgivenessNote delta={-6} scoreAfter={82} weeklyHeal={5} />);
    expect(screen.getByText('这次 -6。每周一 0 点回血 +5，预计下周一后回到 87。')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers the appeal only when asked to', async () => {
    const onAppeal = vi.fn();
    render(<ForgivenessNote delta={-6} scoreAfter={82} weeklyHeal={5} onAppeal={onAppeal} />);
    await userEvent.setup().click(screen.getByRole('button', { name: '觉得不公平？可以申诉' }));
    expect(onAppeal).toHaveBeenCalledTimes(1);
  });

  it('says nothing for points gained or none', () => {
    const { container } = render(<ForgivenessNote delta={2} scoreAfter={100} weeklyHeal={5} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npx vitest run --config vitest.dom.config.ts tests/dom/my-score-line.test.tsx
```

预期：FAIL —— 两个组件文件不存在。

- [ ] **Step 3: 实现 `ForgivenessNote`**

`src/components/ForgivenessNote.tsx`：

```tsx
import { projectedAfterHeal } from '../lib/forgiveness';
import './forgiveness-note.css';

interface ForgivenessNoteProps {
  /** The verdict's delta; renders nothing when delta >= 0. */
  delta: number;
  /** The subject's score with this delta applied. */
  scoreAfter: number;
  weeklyHeal: number;
  /** Shows 「觉得不公平？可以申诉 ›」. */
  onAppeal?: () => void;
}

/**
 * The way back after a penalty (spec §3.10 判决, §5 语气: 数字照实写，紧跟出路).
 * The delta keeps VerdictCard's ASCII minus, so both read the same number.
 */
export function ForgivenessNote({ delta, scoreAfter, weeklyHeal, onAppeal }: ForgivenessNoteProps): JSX.Element | null {
  if (delta >= 0) return null;
  const projected = projectedAfterHeal(scoreAfter, weeklyHeal);
  return (
    <div className="fgn">
      <p className="fgn__text">{`这次 ${delta}。每周一 0 点回血 +${weeklyHeal}，预计下周一后回到 ${projected}。`}</p>
      {onAppeal && (
        <button type="button" className="fgn__appeal" onClick={onAppeal}>
          觉得不公平？可以申诉<span aria-hidden="true"> ›</span>
        </button>
      )}
    </div>
  );
}
```

`src/components/forgiveness-note.css`：

```css
/* 宽恕看得见 — the way back after a penalty (spec §5 #3). Full width inside
 * .vc__actions (a wrapping flex row), so it sits above the buttons. */

.fgn {
  flex-basis: 100%;
  display: grid;
  gap: 0.35rem;
  padding: 0.6rem 0.75rem;
  border-left: 2px solid var(--ok);
  border-radius: var(--r-sm);
  background: color-mix(in oklab, var(--ok) 8%, transparent);
}

.fgn__text {
  font-size: var(--fs-sm);
  line-height: 1.6;
  color: var(--text);
}

.fgn__appeal {
  justify-self: start;
  padding: 0;
  border: 0;
  background: none;
  color: var(--info);
  font: inherit;
  font-size: var(--fs-sm);
  cursor: pointer;
}

@media (hover: hover) {
  .fgn__appeal:hover {
    text-decoration: underline;
  }
}

@media (pointer: coarse) {
  .fgn__appeal {
    min-height: var(--tap-min);
  }
}

/* Forced colours drop the link colour: keep the appeal recognisable as a link. */
@media (forced-colors: active) {
  .fgn__appeal {
    text-decoration: underline;
  }
}
```

- [ ] **Step 4: 实现 `MyScoreLine`**

`src/components/MyScoreLine.tsx`：

```tsx
import type { Config, User } from '../types';
import { COUNTDOWN_TICK_MS } from '../lib/constants';
import { healPreview, healPreviewText } from '../lib/forgiveness';
import { useNow } from '../lib/useNow';
import './my-score-line.css';

interface MyScoreLineProps {
  /** Rendered only when me.is_participant. */
  me: User;
  /** competitionRanks over participants; null = not on the board. */
  rank: number | null;
  config: Config;
  /** P0: open PlayerDetail for me; P4: /me. */
  onOpen?: () => void;
}

/**
 * 「82 分 · 第 6 名」 and what Monday's heal does (spec §3.2, M7). Days come from
 * config.nextResetAt, the numbers from config.weeklyHeal and MAX_SCORE.
 * 本周变化 is P4-5's.
 */
export function MyScoreLine({ me, rank, config, onOpen }: MyScoreLineProps): JSX.Element | null {
  const now = useNow(COUNTDOWN_TICK_MS);
  // Only people on the board are healed (worker/db.ts weeklyHeal: is_participant = 1).
  if (!me.is_participant) return null;
  const standing = rank === null ? `${me.score} 分` : `${me.score} 分 · 第 ${rank} 名`;
  const preview = healPreview(me.score, config, now);
  return (
    <section className="msl panel" aria-label="我的分数">
      {onOpen ? (
        <button type="button" className="msl__standing" onClick={onOpen}>
          {standing}
          <span className="msl__chev" aria-hidden="true">
            ›
          </span>
        </button>
      ) : (
        <p className="msl__standing">{standing}</p>
      )}
      <p className={`msl__heal msl__heal--${preview.kind}`}>{healPreviewText(preview)}</p>
    </section>
  );
}
```

`src/components/my-score-line.css`：

```css
/* 我的分数一行 — score, rank, and what Monday's heal does (spec §3.2). */

.msl {
  display: grid;
  gap: 0.25rem;
  padding: 0.75rem 1rem;
}

.msl__standing {
  justify-self: start;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0;
  border: 0;
  background: none;
  color: var(--text);
  font-family: var(--font-display);
  font-size: var(--fs-lg);
  font-weight: 700;
  text-align: left;
}

button.msl__standing {
  cursor: pointer;
}

.msl__chev {
  color: var(--muted);
}

.msl__heal {
  font-size: var(--fs-sm);
  color: var(--muted);
}

.msl__heal--heal {
  color: var(--ok);
}

@media (hover: hover) {
  button.msl__standing:hover .msl__chev {
    color: var(--text);
  }
}

@media (pointer: coarse) {
  button.msl__standing {
    min-height: var(--tap-min);
  }
}
```

- [ ] **Step 5: 运行，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/my-score-line.test.tsx
npx vitest run --config vitest.config.ts tests/unit/css-conventions.test.ts
npm run typecheck
```

预期：PASS（8 个）；css-conventions PASS；typecheck 通过。

- [ ] **Step 6: Commit**

```bash
git add src/components/ForgivenessNote.tsx src/components/forgiveness-note.css src/components/MyScoreLine.tsx src/components/my-score-line.css tests/dom/my-score-line.test.tsx
git commit -m "feat: ForgivenessNote 和 MyScoreLine，回血看得见"
```

---

### Task 10: `AppealSheet`（理由可选、≤500、草稿、提交前确认）

**Files:**
- Modify: `src/components/VerdictCard.tsx:17-22`（之后加导出函数）
- Create: `src/components/AppealSheet.tsx`、`src/components/appeal-sheet.css`
- Test: 新 `tests/dom/appeal-sheet.test.tsx`

- [ ] **Step 1: 写失败测试 `tests/dom/appeal-sheet.test.tsx`**

```tsx
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppealSheet } from '../../src/components/AppealSheet';
import type { RecordItem } from '../../src/types';

// 申诉（spec §3.10, H14）: the reason may be left out, is capped at
// APPEAL_MAX = 500 like the bot's, is kept as a draft, and nothing is posted
// until 确认申诉. Never promises "only once" (§11 #6: the limit is P4's).

interface Call {
  method: string;
  path: string;
  body: unknown;
}

function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, text: () => Promise.resolve(JSON.stringify(body)) } as Response;
}

/** Route fetch by "METHOD /path?query"; anything unrouted answers 500 so it shows up. */
function mockFetch(routes: Record<string, () => Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = url.replace(/^https?:\/\/[^/]+/, '');
      const method = init?.method ?? 'GET';
      calls.push({ method, path, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) });
      const route = routes[`${method} ${path}`];
      return Promise.resolve(route ? route() : json(500, { error: `unrouted ${method} ${path}` }));
    }),
  );
  return calls;
}

const MINUTE = 60_000;
const DAY = 86_400_000;
const sqlTime = (ms: number): string => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

function penalty(over: Partial<RecordItem> = {}): RecordItem {
  return {
    id: 9,
    subject: { id: 'p', username: '选手', avatar_url: null },
    reporter: { id: 'j', username: '裁判', avatar_url: null },
    type: 'late_major',
    delta: -6,
    note: null,
    claim: '迟到 25 分钟，没打招呼',
    claim_summary: null,
    classified_by: 'ai',
    escalation_suggested: false,
    session_id: null,
    statement: '家里临时有事',
    statement_at: sqlTime(Date.now() - 2 * DAY),
    appeal_reason: null,
    deadline_at: null,
    status: 'decided',
    verdict: { source: 'ai', headline: '情有可原', reasoning: '', factors: [] },
    range: { min: -9, max: -3, base: -6 },
    created_at: sqlTime(Date.now() - 2 * DAY),
    redacted: false,
    ...over,
  };
}

/** The value a draft holds in localStorage, or null. */
function storedValue(key: string): unknown {
  const raw = localStorage.getItem(key);
  return raw === null ? null : (JSON.parse(raw) as { value: unknown }).value;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AppealSheet', () => {
  it('appeals with no reason at all, after a confirm', async () => {
    const calls = mockFetch({ 'POST /api/records/9/appeal': () => json(200, { record: penalty({ status: 'appealed' }) }) });
    const onAppealed = vi.fn();
    const user = userEvent.setup();
    render(<AppealSheet record={penalty()} onClose={() => {}} onAppealed={onAppealed} />);

    expect(screen.getByRole('dialog', { name: '申诉这一起' })).toBeInTheDocument();
    expect(screen.getByText('大迟到 · -6 · AI 裁决')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /为什么觉得判得不对/ })).toHaveAttribute('maxlength', '500');
    expect(screen.getByText('申诉后分数先不动，管理员复核后可能维持，也可能改判。')).toBeInTheDocument();
    expect(screen.queryByText(/只能申诉一次/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '提交申诉' }));
    const confirm = screen.getByRole('group', { name: '提交后要等管理员复核，确定吗？' });
    expect(within(confirm).getByRole('button', { name: '再想想' })).toHaveFocus();
    expect(calls).toEqual([]);

    await user.click(within(confirm).getByRole('button', { name: '确认申诉' }));
    await waitFor(() => expect(onAppealed).toHaveBeenCalledTimes(1));
    expect(calls).toEqual([{ method: 'POST', path: '/api/records/9/appeal', body: {} }]);
  });

  it('sends the reason trimmed, and forgets the draft once it is in', async () => {
    const calls = mockFetch({ 'POST /api/records/9/appeal': () => json(200, { record: penalty({ status: 'appealed' }) }) });
    const onAppealed = vi.fn();
    const user = userEvent.setup();
    render(<AppealSheet record={penalty()} onClose={() => {}} onAppealed={onAppealed} />);

    await user.type(screen.getByRole('textbox', { name: /为什么觉得判得不对/ }), '  我提前两小时在群里说了  ');
    await waitFor(() => expect(localStorage.getItem('edg.draft.appeal.9')).not.toBeNull());
    await user.click(screen.getByRole('button', { name: '提交申诉' }));
    await user.click(screen.getByRole('button', { name: '确认申诉' }));

    await waitFor(() => expect(onAppealed).toHaveBeenCalledTimes(1));
    expect(calls[0]?.body).toEqual({ reason: '我提前两小时在群里说了' });
    expect(localStorage.getItem('edg.draft.appeal.9')).toBeNull();
  });

  it('清空 empties the reason and puts the caret back in it', async () => {
    const user = userEvent.setup();
    render(<AppealSheet record={penalty()} onClose={() => {}} onAppealed={() => {}} />);
    const box = screen.getByRole('textbox', { name: /为什么觉得判得不对/ });
    await user.type(box, '判重了');
    await user.click(await screen.findByRole('button', { name: '清空' }));
    expect(box).toHaveValue('');
    expect(box).toHaveFocus();
    expect(localStorage.getItem('edg.draft.appeal.9')).toBeNull();
  });

  it('keeps a written reason when closed, and asks first', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    // Like PlayerDetail: closing unmounts the sheet, which is what writes a
    // reason still inside the save debounce.
    function Host(): JSX.Element | null {
      const [open, setOpen] = useState(true);
      const close = (): void => {
        onClose();
        setOpen(false);
      };
      return open ? <AppealSheet record={penalty()} onClose={close} onAppealed={() => {}} /> : null;
    }
    render(<Host />);

    await user.type(screen.getByRole('textbox', { name: /为什么觉得判得不对/ }), '判重了');
    await user.keyboard('{Escape}');
    const leave = screen.getByRole('group', { name: '申诉理由会留在这台设备上，下次回来接着写。' });
    expect(within(leave).getByRole('button', { name: '继续写' })).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(within(leave).getByRole('button', { name: '先离开' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: '申诉这一起' })).not.toBeInTheDocument();
    expect(storedValue('edg.draft.appeal.9')).toBe('判重了');
  });

  it('backs out of the confirm on Escape instead of closing', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<AppealSheet record={penalty()} onClose={onClose} onAppealed={() => {}} />);

    await user.click(screen.getByRole('button', { name: '提交申诉' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: '提交后要等管理员复核，确定吗？' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '提交申诉' })).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows the server’s refusal and stays open', async () => {
    mockFetch({ 'POST /api/records/9/appeal': () => json(400, { error: '只有已判决的案件可以申诉' }) });
    const onAppealed = vi.fn();
    const user = userEvent.setup();
    render(<AppealSheet record={penalty()} onClose={() => {}} onAppealed={onAppealed} />);

    await user.click(screen.getByRole('button', { name: '提交申诉' }));
    await user.click(screen.getByRole('button', { name: '确认申诉' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('只有已判决的案件可以申诉');
    expect(screen.getByRole('button', { name: '提交申诉' })).toHaveFocus();
    expect(onAppealed).not.toHaveBeenCalled();
  });
});
```

（`MINUTE` 在 Task 12 追加的用例里用到；本 Task 先定义，避免下一步再改 import 区。）

- [ ] **Step 2: 运行，确认失败**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npx vitest run --config vitest.dom.config.ts tests/dom/appeal-sheet.test.tsx
```

预期：FAIL —— `Failed to resolve import "../../src/components/AppealSheet"`。

- [ ] **Step 3: `VerdictCard.tsx` 导出来源标签**

在 `src/components/VerdictCard.tsx:22`（`SOURCE_BADGE` 定义结束的 `};`）之后插入：

```tsx

/** 'AI 裁决' / '管理员改判' …, for places that name a verdict's source outside the card. */
export function verdictSourceLabel(source: VerdictSource): string {
  return SOURCE_BADGE[source].label;
}
```

- [ ] **Step 4: 实现 `src/components/AppealSheet.tsx`**

```tsx
import { useRef, useState } from 'react';
import { APPEAL_MAX, VIOLATION_MAP } from '@shared/scoring';
import type { RecordItem } from '../types';
import { ApiError, appealCase } from '../api';
import { isBlankText, validateAppealDraft } from '../lib/draftShapes';
import { useDraft, type DraftState } from '../lib/useDraft';
import { useInlineConfirm } from '../lib/useInlineConfirm';
import { useLeaveGuard, type LeaveGuard } from '../lib/useLeaveGuard';
import { ConfirmInline } from './ConfirmInline';
import { DraftNote } from './DraftNote';
import { Modal } from './Modal';
import { useToast } from './Toast';
import { verdictSourceLabel } from './VerdictCard';
import './appeal-sheet.css';

interface AppealSheetProps {
  /** A decided case of the viewer's own. */
  record: RecordItem;
  onClose: () => void;
  onAppealed: (record: RecordItem) => void;
}

const TITLE_ID = 'appeal-sheet-title';
const DRAFT_OPTIONS = { validate: validateAppealDraft, isEmpty: isBlankText };

type InlineConfirm = ReturnType<typeof useInlineConfirm<HTMLButtonElement>>;

interface AppealSubmit {
  confirm: InlineConfirm;
  submitting: boolean;
  error: string | null;
  /** 确认申诉: post it (an empty reason is sent as none). */
  submit: () => void;
}

function useAppealSubmit(recordId: number, text: string, onAppealed: (record: RecordItem) => void): AppealSubmit {
  const confirm = useInlineConfirm<HTMLButtonElement>();
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (): void => {
    const reason = text.trim();
    setSubmitting(true);
    setError(null);
    appealCase(recordId, reason.length > 0 ? reason : undefined)
      .then(({ record }) => {
        confirm.close();
        setSubmitting(false);
        toast.show({ message: '申诉已提交，等管理员复核。', tone: 'ok' });
        onAppealed(record);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : '提交失败，请稍后重试');
        setSubmitting(false);
        confirm.dismiss();
      });
  };

  return { confirm, submitting, error, submit };
}

/** 「大迟到 · -6 · AI 裁决」 — the same ASCII minus as VerdictCard. */
function caseLine(record: RecordItem): string {
  const label = VIOLATION_MAP[record.type]?.label ?? record.type;
  const source = record.verdict ? ` · ${verdictSourceLabel(record.verdict.source)}` : '';
  return `${label} · ${record.delta}${source}`;
}

/**
 * 申诉这一起 (spec §3.10, H14): a bottom sheet over the player page (or over the
 * verdict, from StatementDialog). The reason is optional like the bot's
 * 「申诉理由（可不填）」, capped at the same APPEAL_MAX, and kept as a draft.
 */
export function AppealSheet({ record, onClose, onAppealed }: AppealSheetProps): JSX.Element {
  const draft = useDraft<string>('appeal', record.id, '', DRAFT_OPTIONS);
  const guard = useLeaveGuard(draft.dirty, onClose);
  const submission = useAppealSubmit(record.id, draft.value, (appealed) => {
    draft.clear();
    onAppealed(appealed);
  });

  // Esc / ✕: back out of the confirm first; never mid-submit.
  const requestClose = (): void => {
    if (submission.submitting) return;
    if (submission.confirm.confirming) submission.confirm.dismiss();
    else guard.requestClose();
  };

  return (
    <Modal open onClose={requestClose} labelledBy={TITLE_ID} title="申诉这一起" variant="sheet" size="md" dismissible={!draft.dirty}>
      <div className="aps">
        <p className="aps__case">{caseLine(record)}</p>
        <AppealReason draft={draft} disabled={submission.submitting} />
        <p className="aps__hint">申诉后分数先不动，管理员复核后可能维持，也可能改判。</p>
        {submission.error && (
          <p className="aps__error" role="alert">
            {submission.error}
          </p>
        )}
        <AppealActions guard={guard} submission={submission} onRequestClose={requestClose} />
      </div>
    </Modal>
  );
}

interface AppealReasonProps {
  draft: DraftState<string>;
  disabled: boolean;
}

/** The optional reason, its counter and the draft note. */
function AppealReason({ draft, disabled }: AppealReasonProps): JSX.Element {
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const length = draft.value.trim().length;
  // 清空 takes itself away with the note: hand the keyboard to the empty field.
  const clearReason = (): void => {
    draft.clear();
    fieldRef.current?.focus();
  };
  return (
    <>
      <label className="aps__field">
        <span className="aps__label">为什么觉得判得不对？（可以不写，但写一句管理员更好判断）</span>
        <textarea
          ref={fieldRef}
          className="aps__textarea"
          rows={4}
          maxLength={APPEAL_MAX}
          value={draft.value}
          onChange={(e) => draft.setValue(e.target.value)}
          disabled={disabled}
          data-autofocus
        />
        <span className="aps__counter tabular">
          {length} / {APPEAL_MAX}
        </span>
      </label>
      <DraftNote savedAt={draft.savedAt} length={length} onClear={disabled ? undefined : clearReason} />
    </>
  );
}

interface AppealActionsProps {
  guard: LeaveGuard;
  submission: AppealSubmit;
  onRequestClose: () => void;
}

function AppealActions({ guard, submission, onRequestClose }: AppealActionsProps): JSX.Element {
  if (guard.confirmingLeave) {
    return (
      <ConfirmInline
        question="申诉理由会留在这台设备上，下次回来接着写。"
        cancelLabel="继续写"
        confirmLabel="先离开"
        onCancel={guard.stay}
        onConfirm={guard.confirmLeave}
        tone="primary"
        focus="cancel"
      />
    );
  }
  if (submission.confirm.confirming) {
    return (
      <ConfirmInline
        question="提交后要等管理员复核，确定吗？"
        cancelLabel="再想想"
        confirmLabel="确认申诉"
        onCancel={submission.confirm.dismiss}
        onConfirm={submission.submit}
        tone="primary"
        focus="cancel"
        busy={submission.submitting}
        busyLabel="提交中…"
      />
    );
  }
  return (
    <div className="aps__actions">
      <button ref={guard.triggerRef} type="button" className="btn btn--ghost" onClick={onRequestClose}>
        先不申诉
      </button>
      <button ref={submission.confirm.triggerRef} type="button" className="btn btn--gold" onClick={submission.confirm.ask}>
        提交申诉
      </button>
    </div>
  );
}
```

- [ ] **Step 5: 实现 `src/components/appeal-sheet.css`**

```css
/* 申诉 — a bottom sheet on phones (Modal variant="sheet"), centred above. */

.aps {
  display: grid;
  gap: 0.85rem;
}

.aps__case {
  font-size: var(--fs-sm);
  color: var(--muted);
}

.aps__field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.aps__label {
  font-size: var(--fs-sm);
  line-height: 1.5;
  color: var(--text);
}

/* ≥16px: iOS zooms the whole page into a smaller field on focus. */
.aps__textarea {
  padding: 0.7rem 0.8rem;
  border: 1px solid var(--border-input);
  border-radius: var(--r-md);
  background: var(--bg);
  color: var(--text);
  font: inherit;
  font-size: var(--fs-md);
  line-height: 1.6;
  resize: vertical;
}

.aps__textarea:disabled {
  opacity: 0.6;
}

.aps__counter {
  align-self: flex-end;
  font-size: var(--fs-xs);
  color: var(--muted);
}

.aps__hint {
  font-size: var(--fs-sm);
  line-height: 1.6;
  color: var(--muted);
}

.aps__error {
  font-size: var(--fs-sm);
  color: var(--danger-text);
}

.aps__actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
}

@media (max-width: 600px) {
  /* Stacked in DOM order: the main action ends up last, nearest the thumb. */
  .aps__actions {
    flex-direction: column;
  }

  .aps__actions .btn {
    width: 100%;
  }
}
```

- [ ] **Step 6: 运行，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/appeal-sheet.test.tsx tests/dom/verdict-privacy.test.tsx
npx vitest run --config vitest.config.ts tests/unit/css-conventions.test.ts
npm run typecheck
```

预期：PASS（appeal-sheet 6 个、verdict-privacy 7 个）；css-conventions PASS；typecheck 通过。

- [ ] **Step 7: Commit**

```bash
git add src/components/AppealSheet.tsx src/components/appeal-sheet.css src/components/VerdictCard.tsx tests/dom/appeal-sheet.test.tsx
git commit -m "feat: AppealSheet，申诉理由可选、上限 500、提交前确认"
```

---

### Task 11: 把 PlayerDetail 的案件操作拆到 `CaseActions.tsx`（纯搬家）

**Files:**
- Create: `src/components/CaseActions.tsx`
- Modify: `src/components/PlayerDetail.tsx:2`、`:16`、`:50-65`（Task 1 后是 `:49-64`；`:45-48` 的 `JUDGE_BUSY`/`SCORE_BUSY` 留在原处）、`:277-425`（Task 1 后是 `:276-424`）
- Test: 现有 `tests/dom/player-judge.test.tsx`、`tests/dom/p8-app.test.tsx`、`tests/dom/deep-link.test.tsx`

纯重构：行为、按钮名、类名一个不改，现有测试就是安全网。

- [ ] **Step 1: 跑一遍现有测试作基线**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npx vitest run --config vitest.dom.config.ts tests/dom/player-judge.test.tsx tests/dom/p8-app.test.tsx tests/dom/deep-link.test.tsx
```

预期：PASS。

- [ ] **Step 2: 新建 `src/components/CaseActions.tsx`（从 PlayerDetail 原样搬来）**

```tsx
// The buttons under a case on a player's page: 说明情况 / 申诉 / 撤案 / 撤销 /
// 改判, each shown only to whoever the API would let do it (worker/cases.ts).
// Moved out of PlayerDetail.tsx; class names stay in player-detail.css.

import { useState } from 'react';
import { REVOKE_WINDOW_MS } from '@shared/scoring';
import type { RecordItem, User } from '../types';
import { parseTimestamp } from '../lib/time';

/** Post-verdict reversal: any admin, or the reporter within 15 minutes. */
function canRevoke(record: RecordItem, me: User | null): boolean {
  if (!me) return false;
  if (record.status !== 'decided' && record.status !== 'appealed') return false;
  if (me.is_admin) return true;
  if (record.reporter.id !== me.id) return false;
  const created = parseTimestamp(record.created_at);
  return !Number.isNaN(created) && Date.now() - created <= REVOKE_WINDOW_MS;
}

/** Pre-verdict withdrawal: no score has moved, so the reporter may just drop it. */
function canWithdraw(record: RecordItem, me: User | null): boolean {
  if (!me) return false;
  if (record.status !== 'awaiting_statement') return false;
  return me.is_admin || record.reporter.id === me.id;
}

interface CaseActionsProps {
  record: RecordItem;
  me: User | null;
  isSelf: boolean;
  busy: boolean;
  overriding: boolean;
  onStartOverride: () => void;
  onCancelOverride: () => void;
  onStatement: () => void;
  onAppeal: () => void;
  onWithdraw: () => void;
  onRevoke: () => void;
  onOverride: (delta: number, reason: string) => void;
}

export function CaseActions({
  record,
  me,
  isSelf,
  busy,
  overriding,
  onStartOverride,
  onCancelOverride,
  onStatement,
  onAppeal,
  onWithdraw,
  onRevoke,
  onOverride,
}: CaseActionsProps): JSX.Element | null {
  const showStatement = isSelf && record.status === 'awaiting_statement';
  const showAppeal = isSelf && record.status === 'decided';
  const showWithdraw = canWithdraw(record, me);
  const showRevoke = canRevoke(record, me);
  const showOverride =
    me?.is_admin === true && (record.status === 'appealed' || record.status === 'decided');

  if (overriding) {
    return <OverrideForm record={record} onCancel={onCancelOverride} onSubmit={onOverride} />;
  }

  if (!showStatement && !showAppeal && !showWithdraw && !showRevoke && !showOverride) {
    return null;
  }

  return (
    <>
      {showStatement && (
        <button type="button" className="btn btn--gold btn--sm" onClick={onStatement}>
          说明情况
        </button>
      )}
      {showAppeal && (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={onAppeal}
          disabled={busy}
        >
          {busy ? '提交中…' : '申诉'}
        </button>
      )}
      {showWithdraw && (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={onWithdraw}
          disabled={busy}
        >
          {busy ? '撤案中…' : '撤案'}
        </button>
      )}
      {showRevoke && (
        <button
          type="button"
          className="btn btn--ghost btn--sm pd__revoke-btn"
          onClick={onRevoke}
          disabled={busy}
        >
          {busy ? '撤销中…' : '撤销'}
        </button>
      )}
      {showOverride && (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={onStartOverride}
          disabled={busy}
        >
          改判
        </button>
      )}
    </>
  );
}

interface OverrideFormProps {
  record: RecordItem;
  onCancel: () => void;
  onSubmit: (delta: number, reason: string) => void;
}

/** Admin re-sentencing. The delta is bounded server-side by the same clamp. */
function OverrideForm({ record, onCancel, onSubmit }: OverrideFormProps): JSX.Element {
  const [delta, setDelta] = useState(String(record.delta));
  const [reason, setReason] = useState('');
  const value = Number(delta);
  const valid = Number.isFinite(value) && reason.trim().length > 0;

  return (
    <form
      className="pd__override"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSubmit(Math.round(value), reason.trim());
      }}
    >
      <label className="pd__override-field">
        <span className="pd__override-label">
          改判为（{record.range.min} ~ {record.range.max}）
        </span>
        <input
          className="pd__override-input tabular"
          type="number"
          min={record.range.min}
          max={record.range.max}
          value={delta}
          onChange={(e) => setDelta(e.target.value)}
        />
      </label>
      <label className="pd__override-field pd__override-field--grow">
        <span className="pd__override-label">理由（必填）</span>
        <input
          className="pd__override-input"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="申诉属实，当事人确有不可抗力"
        />
      </label>
      <span className="pd__override-btns">
        <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel}>
          取消
        </button>
        <button type="submit" className="btn btn--gold btn--sm" disabled={!valid}>
          确认改判
        </button>
      </span>
    </form>
  );
}
```

- [ ] **Step 3: 从 `PlayerDetail.tsx` 删掉搬走的代码**

`:2` 之前（Task 1 之后的样子）：

```ts
import { REVOKE_WINDOW_MS, tierFor } from '@shared/scoring';
```

之后：

```ts
import { tierFor } from '@shared/scoring';
```

删除 `:16`：

```ts
import { parseTimestamp } from '../lib/time';
```

在 `import { AdminScoreForm } from './AdminScoreForm';` 之后加：

```ts
import { CaseActions } from './CaseActions';
```

删除 `canRevoke` 和 `canWithdraw` 两个函数（原 `:50-65`，Task 1 后 `:49-64`，从 `/** Post-verdict reversal: any admin, or the reporter within 15 minutes. */` 到 `canWithdraw` 的结尾 `}`，以及它们前后各一个空行中的一个）。

删除从 `interface CaseActionsProps {`（原 `:277`）到 `OverrideForm` 结尾的 `}`（原 `:425`）的整段，文件末尾只留：

```ts
export type { HistoryPoint };
```

- [ ] **Step 4: 运行，确认行为没变**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/player-judge.test.tsx tests/dom/p8-app.test.tsx tests/dom/deep-link.test.tsx tests/dom/appeal-sheet.test.tsx
npm run typecheck
wc -l src/components/PlayerDetail.tsx src/components/CaseActions.tsx
```

预期：全部 PASS（这一步 appeal-sheet 只有 Task 10 的 6 个用例）；typecheck 通过；PlayerDetail 约 259 行、CaseActions 约 175 行。

- [ ] **Step 5: Commit**

```bash
git add src/components/CaseActions.tsx src/components/PlayerDetail.tsx
git commit -m "refactor: 把选手页的案件操作按钮拆到 CaseActions.tsx"
```

---

### Task 12: PlayerDetail —— 申诉开 AppealSheet、撤销倒计时、本人回血预告

**Files:**
- Modify: `src/components/CaseActions.tsx`（整文件替换为下面的版本）
- Modify: `src/components/PlayerDetail.tsx`（imports、props、state、header、CaseActions 调用、return 外层）
- Modify: `src/components/player-detail.css`（文件末尾追加）
- Test: `tests/dom/appeal-sheet.test.tsx`（追加两个 `describe`）

- [ ] **Step 1: 写失败测试 —— 在 `tests/dom/appeal-sheet.test.tsx` 追加**

import 区改为：

```tsx
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppealSheet } from '../../src/components/AppealSheet';
import { PlayerDetail } from '../../src/components/PlayerDetail';
import type { Config, RecordItem, User } from '../../src/types';
```

文件末尾追加：

```tsx

const CONFIG: Config = {
  violations: [],
  tiers: [],
  weeklyHeal: 5,
  weeklyBonusCap: 6,
  statementWindowHours: 12,
  aiEnabled: false,
  maxBatchSubjects: 5,
  nextResetAt: new Date(Date.now() + 2 * DAY + 3_600_000).toISOString(),
};

const SUBJECT: User = {
  id: 'p',
  username: '选手',
  oauth_username: '选手',
  avatar_url: null,
  is_participant: true,
  is_judge: false,
  is_admin: false,
  score: 82,
  created_at: '2026-10-01 00:00:00',
};
const REPORTER: User = { ...SUBJECT, id: 'j', username: '裁判', is_judge: true };

function stubPlayer(records: RecordItem[]): Call[] {
  return mockFetch({
    'GET /api/users/p': () =>
      json(200, {
        user: { id: 'p', username: '选手', avatar_url: null, is_participant: true, is_judge: false, score: 82, created_at: 'x' },
        records,
        history: [],
      }),
    'POST /api/records/9/appeal': () => json(200, { record: penalty({ status: 'appealed' }) }),
  });
}

describe('PlayerDetail — the subject’s own page', () => {
  it('opens the appeal sheet instead of appealing at once', async () => {
    const calls = stubPlayer([penalty()]);
    const user = userEvent.setup();
    render(<PlayerDetail userId="p" me={SUBJECT} onClose={() => {}} config={CONFIG} />);

    await user.click(await screen.findByRole('button', { name: '申诉' }));
    expect(screen.getByRole('dialog', { name: '申诉这一起' })).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);

    await user.click(screen.getByRole('button', { name: '提交申诉' }));
    await user.click(screen.getByRole('button', { name: '确认申诉' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '申诉这一起' })).not.toBeInTheDocument());
    // The page reloads the player after the appeal.
    await waitFor(() => expect(calls.filter((c) => c.path === '/api/users/p')).toHaveLength(2));
  });

  it('shows how far Monday’s heal takes you, from config', async () => {
    stubPlayer([penalty()]);
    render(<PlayerDetail userId="p" me={SUBJECT} onClose={() => {}} config={CONFIG} />);
    expect(await screen.findByText('周一 0 点回血 +5 → 预计 87 · 还有 2 天')).toBeInTheDocument();
    expect(screen.getByText('这次 -6。每周一 0 点回血 +5，预计下周一后回到 87。')).toBeInTheDocument();
    // One way to appeal per card: here the note brings no second button.
    expect(screen.queryByRole('button', { name: '觉得不公平？可以申诉' })).not.toBeInTheDocument();
  });

  it('shows none of it to anyone else, or without config', async () => {
    stubPlayer([penalty()]);
    const { unmount } = render(<PlayerDetail userId="p" me={REPORTER} onClose={() => {}} config={CONFIG} />);
    await screen.findByRole('heading', { name: '选手' });
    expect(screen.queryByText(/周一 0 点回血/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^这次 /)).not.toBeInTheDocument();
    unmount();

    render(<PlayerDetail userId="p" me={SUBJECT} onClose={() => {}} />);
    await screen.findByRole('heading', { name: '选手' });
    expect(screen.queryByText(/周一 0 点回血/)).not.toBeInTheDocument();
  });
});

describe('PlayerDetail — 撤销 for the reporter', () => {
  it('counts the 15 minutes down from filing, and hides the button after', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      stubPlayer([penalty({ created_at: sqlTime(Date.now() - 2.5 * MINUTE) })]);
      render(<PlayerDetail userId="p" me={REPORTER} onClose={() => {}} />);
      expect(await screen.findByRole('button', { name: '撤销 · 还剩 12 分钟' })).toBeInTheDocument();
      await act(async () => {
        vi.advanceTimersByTime(13 * MINUTE);
      });
      expect(screen.queryByRole('button', { name: /^撤销/ })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows no button once the window is long gone', async () => {
    stubPlayer([penalty({ created_at: sqlTime(Date.now() - 20 * MINUTE) })]);
    render(<PlayerDetail userId="p" me={REPORTER} onClose={() => {}} />);
    await screen.findByRole('heading', { name: '选手' });
    expect(screen.queryByRole('button', { name: /^撤销/ })).not.toBeInTheDocument();
  });

  it('gives an admin a plain 撤销, with no clock', async () => {
    stubPlayer([penalty()]);
    render(<PlayerDetail userId="p" me={{ ...REPORTER, id: 'admin', is_admin: true }} onClose={() => {}} />);
    expect(await screen.findByRole('button', { name: '撤销' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npx vitest run --config vitest.dom.config.ts tests/dom/appeal-sheet.test.tsx
```

预期：FAIL 3 个（共 12 个）—— 点「申诉」直接 POST、没有 sheet；没有回血预告和「这次 -6」；撤销按钮名是「撤销」不带倒计时。「shows none of it」「long gone」「admin」三个用例此时已经 PASS（现状就是这样，vitest 不做类型检查，多传的 `config` 在运行时被忽略），保留作回归；Task 10 的 6 个照常 PASS。

- [ ] **Step 3: 替换 `src/components/CaseActions.tsx` 为最终版**

```tsx
// The buttons under a case on a player's page: 说明情况 / 申诉 / 撤案 / 撤销 /
// 改判, each shown only to whoever the API would let do it (worker/cases.ts).
// Moved out of PlayerDetail.tsx; class names stay in player-detail.css.

import { useState } from 'react';
import type { RecordItem, User } from '../types';
import { formatRevokeLeft, revokeMsLeft } from '../lib/revoke';

interface RevokeState {
  allowed: boolean;
  /** Time left for the reporter; null for an admin, who has no clock. */
  msLeft: number | null;
}

/** Post-verdict reversal: any admin at any time, or the reporter while REVOKE_WINDOW_MS lasts. */
function revokeState(record: RecordItem, me: User | null, now: number): RevokeState {
  if (!me || (record.status !== 'decided' && record.status !== 'appealed')) return { allowed: false, msLeft: null };
  if (me.is_admin) return { allowed: true, msLeft: null };
  if (record.reporter.id !== me.id) return { allowed: false, msLeft: null };
  const msLeft = revokeMsLeft(record.created_at, now);
  return { allowed: msLeft > 0, msLeft };
}

/** 「撤销 · 还剩 12 分钟」 for the reporter (spec §5 #6); a plain 「撤销」 for an admin. */
function revokeLabel(msLeft: number | null): string {
  return msLeft === null ? '撤销' : `撤销 · ${formatRevokeLeft(msLeft)}`;
}

/** Pre-verdict withdrawal: no score has moved, so the reporter may just drop it. */
function canWithdraw(record: RecordItem, me: User | null): boolean {
  if (!me) return false;
  if (record.status !== 'awaiting_statement') return false;
  return me.is_admin || record.reporter.id === me.id;
}

interface CaseActionsProps {
  record: RecordItem;
  me: User | null;
  isSelf: boolean;
  busy: boolean;
  overriding: boolean;
  /** The page's clock (useNow(REVOKE_TICK_MS)): the revoke countdown reads it. */
  now: number;
  /** Rendered first, full width: the self view's ForgivenessNote. */
  note?: React.ReactNode;
  onStartOverride: () => void;
  onCancelOverride: () => void;
  onStatement: () => void;
  onAppeal: () => void;
  onWithdraw: () => void;
  onRevoke: () => void;
  onOverride: (delta: number, reason: string) => void;
}

export function CaseActions(props: CaseActionsProps): JSX.Element | null {
  const { record, me, isSelf, busy, overriding, now, note } = props;
  if (overriding) {
    return <OverrideForm record={record} onCancel={props.onCancelOverride} onSubmit={props.onOverride} />;
  }
  const revoke = revokeState(record, me, now);
  const shown = {
    statement: isSelf && record.status === 'awaiting_statement',
    appeal: isSelf && record.status === 'decided',
    withdraw: canWithdraw(record, me),
    revoke: revoke.allowed,
    override: me?.is_admin === true && (record.status === 'appealed' || record.status === 'decided'),
  };
  if (!note && !Object.values(shown).some(Boolean)) return null;

  return (
    <>
      {note}
      {shown.statement && (
        <button type="button" className="btn btn--gold btn--sm" onClick={props.onStatement}>
          说明情况
        </button>
      )}
      {shown.appeal && (
        <button type="button" className="btn btn--ghost btn--sm" onClick={props.onAppeal} disabled={busy}>
          申诉
        </button>
      )}
      {shown.withdraw && (
        <button type="button" className="btn btn--ghost btn--sm" onClick={props.onWithdraw} disabled={busy}>
          {busy ? '撤案中…' : '撤案'}
        </button>
      )}
      {shown.revoke && (
        <button type="button" className="btn btn--ghost btn--sm pd__revoke-btn" onClick={props.onRevoke} disabled={busy}>
          {busy ? '撤销中…' : revokeLabel(revoke.msLeft)}
        </button>
      )}
      {shown.override && (
        <button type="button" className="btn btn--ghost btn--sm" onClick={props.onStartOverride} disabled={busy}>
          改判
        </button>
      )}
    </>
  );
}

interface OverrideFormProps {
  record: RecordItem;
  onCancel: () => void;
  onSubmit: (delta: number, reason: string) => void;
}

/** Admin re-sentencing. The delta is bounded server-side by the same clamp. */
function OverrideForm({ record, onCancel, onSubmit }: OverrideFormProps): JSX.Element {
  const [delta, setDelta] = useState(String(record.delta));
  const [reason, setReason] = useState('');
  const value = Number(delta);
  const valid = Number.isFinite(value) && reason.trim().length > 0;

  return (
    <form
      className="pd__override"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSubmit(Math.round(value), reason.trim());
      }}
    >
      <label className="pd__override-field">
        <span className="pd__override-label">
          改判为（{record.range.min} ~ {record.range.max}）
        </span>
        <input
          className="pd__override-input tabular"
          type="number"
          min={record.range.min}
          max={record.range.max}
          value={delta}
          onChange={(e) => setDelta(e.target.value)}
        />
      </label>
      <label className="pd__override-field pd__override-field--grow">
        <span className="pd__override-label">理由（必填）</span>
        <input
          className="pd__override-input"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="申诉属实，当事人确有不可抗力"
        />
      </label>
      <span className="pd__override-btns">
        <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel}>
          取消
        </button>
        <button type="submit" className="btn btn--gold btn--sm" disabled={!valid}>
          确认改判
        </button>
      </span>
    </form>
  );
}
```

（`React.ReactNode` 这个全局命名空间写法与 `VerdictCard.tsx:10` 一致。「申诉」按钮不再显示「提交中…」：申诉现在在 sheet 里提交，忙碌状态在 sheet 里。）

- [ ] **Step 4: 修改 `src/components/PlayerDetail.tsx`**

import 区：`:3` 之前：

```ts
import type { HistoryPoint, RecordItem, User, UserDetailResponse } from '../types';
```

之后：

```ts
import type { Config, HistoryPoint, RecordItem, User, UserDetailResponse } from '../types';
```

`:4-15` 的 `../api` import 删掉 `appealCase,` 一行（申诉改由 AppealSheet 提交）。

`} from '../api';` 之后（Task 11 删掉的 `../lib/time` 原来的位置，lib 在组件之前，照文件原来的顺序）加：

```ts
import { REVOKE_TICK_MS } from '../lib/constants';
import { healPreview, healPreviewText } from '../lib/forgiveness';
import { useNow } from '../lib/useNow';
```

在 `import { CaseActions } from './CaseActions';` 之后加：

```ts
import { AppealSheet } from './AppealSheet';
import { ForgivenessNote } from './ForgivenessNote';
```

`PlayerDetailProps`（`:26-36`）里 `focusRecordId` 之后加：

```ts
  /** The board's config: with it, the player's own page previews the weekly heal (P0-5). */
  config?: Config;
```

函数签名的解构（`focusRecordId = null,` 之后）加一行：

```ts
  config,
```

state 区（`const focused = useRef(false);` 之后）加：

```ts
  const [appealing, setAppealing] = useState<RecordItem | null>(null);
  // One clock for the page: the reporter's revoke countdown and the heal line.
  const now = useNow(REVOKE_TICK_MS);
```

`return (` 之后的 `<Modal open onClose={onClose} labelledBy="player-detail-title" size="lg">` 之前：

```tsx
  return (
    <Modal open onClose={onClose} labelledBy="player-detail-title" size="lg">
```

之后：

```tsx
  return (
    <>
    <Modal open onClose={onClose} labelledBy="player-detail-title" size="lg">
```

`<p className="pd__blurb">{tier.blurb}</p>` 之后插入：

```tsx
              {isSelf && config && data.user.is_participant && (
                <p className="pd__heal">{healPreviewText(healPreview(data.user.score, config, now))}</p>
              )}
```

`<CaseActions … />` 调用：之前：

```tsx
                        onStatement={() => onOpenStatement?.(r)}
                        onAppeal={() => void run(r.id, () => appealCase(r.id))}
```

之后：

```tsx
                        now={now}
                        note={
                          isSelf && config && r.status === 'decided' && r.delta < 0 ? (
                            <ForgivenessNote delta={r.delta} scoreAfter={data.user.score} weeklyHeal={config.weeklyHeal} />
                          ) : undefined
                        }
                        onStatement={() => onOpenStatement?.(r)}
                        onAppeal={() => setAppealing(r)}
```

函数结尾：之前：

```tsx
      )}
    </Modal>
  );
}
```

之后：

```tsx
      )}
    </Modal>

      {/* A sibling, like SessionDetailDialog's RollCallDialog: its own layer in the modal stack. */}
      {appealing && (
        <AppealSheet
          key={appealing.id}
          record={appealing}
          onClose={() => setAppealing(null)}
          onAppealed={() => {
            setAppealing(null);
            void load();
            onChanged?.();
          }}
        />
      )}
    </>
  );
}
```

（仓库没有 prettier / eslint：手动把 `<Modal …>` 到 `</Modal>` 整块多缩进 2 格，内容一字不改；审查时用 `git diff -w` 只看实质改动。）

- [ ] **Step 5: `src/components/player-detail.css` 末尾追加**

```css

/* Only on your own page: what Monday's heal does for you (P0-5, M7). */
.pd__heal {
  font-size: var(--fs-sm);
  color: var(--ok);
}
```

- [ ] **Step 6: 运行，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/appeal-sheet.test.tsx tests/dom/player-judge.test.tsx tests/dom/p8-app.test.tsx tests/dom/deep-link.test.tsx
npm run typecheck
```

预期：全部 PASS（appeal-sheet 12 个；player-judge 里 `getByRole('button', { name: '取消' })` 仍唯一 —— 新按钮叫「申诉」「撤销 · 还剩 N 分钟」「提交申诉」等，没有「取消」；p8-app `:144-155` 的焦点与 `scrollIntoView` 不变）；typecheck 通过。

- [ ] **Step 7: Commit**

```bash
git add src/components/CaseActions.tsx src/components/PlayerDetail.tsx src/components/player-detail.css tests/dom/appeal-sheet.test.tsx
git commit -m "feat: 选手页申诉改开 AppealSheet，撤销显示剩余时间，本人视图显示回血预告"
```

---

### Task 13: StatementDialog —— 草稿、提交前确认、隐私三句、截止时间、判决后回血与申诉

**Files:**
- Modify: `src/components/StatementDialog.tsx`（整文件替换）
- Modify: `src/components/statement-dialog.css`（删 `.sd__notice` 规则块，末尾追加 `.sd__privacy`）
- Test: `tests/dom/drafts.test.tsx`（追加）、`tests/dom/wording.test.tsx`（追加）

- [ ] **Step 1: 写失败测试 —— `tests/dom/drafts.test.tsx` 追加**

import 区追加：

```tsx
import { within } from '@testing-library/react';
import { StatementDialog } from '../../src/components/StatementDialog';
import type { Config, RecordItem } from '../../src/types';
```

（把 `within` 合进第一行的 `import { fireEvent, render, screen, waitFor } from '@testing-library/react';` 里，不要重复 import 同一模块。）

文件末尾追加：

```tsx

const HOUR = 3_600_000;
const sqlTime = (ms: number): string => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

const CONFIG: Config = {
  violations: [],
  tiers: [],
  weeklyHeal: 5,
  weeklyBonusCap: 6,
  statementWindowHours: 12,
  aiEnabled: false,
  maxBatchSubjects: 5,
  nextResetAt: '2030-01-06T16:00:00.000Z',
};

function openCase(over: Partial<RecordItem> = {}): RecordItem {
  return {
    id: 12,
    subject: { id: 'me', username: '我', avatar_url: null },
    reporter: { id: 'j', username: '阿飞', avatar_url: null },
    type: 'late_major',
    delta: 0,
    note: null,
    claim: '迟到 25 分钟，没打招呼',
    claim_summary: null,
    classified_by: 'ai',
    escalation_suggested: false,
    session_id: null,
    statement: null,
    statement_at: null,
    appeal_reason: null,
    deadline_at: sqlTime(Date.now() + 5 * HOUR),
    status: 'awaiting_statement',
    verdict: null,
    range: { min: -9, max: -3, base: -6 },
    created_at: sqlTime(Date.now() - HOUR),
    redacted: false,
    ...over,
  };
}

const decided = (over: Partial<RecordItem> = {}): RecordItem =>
  openCase({
    status: 'decided',
    delta: -6,
    statement: '家里临时有事',
    statement_at: sqlTime(Date.now()),
    deadline_at: null,
    verdict: { source: 'ai', headline: '情有可原', reasoning: '', factors: [] },
    ...over,
  });

describe('StatementDialog — draft, confirm, verdict', () => {
  function renderStatement(onClose = vi.fn(), onDecided = vi.fn()) {
    render(<StatementDialog open record={openCase()} config={CONFIG} onClose={onClose} onDecided={onDecided} score={88} />);
    return { onClose, onDecided };
  }

  it('restores a draft and asks before leaving with it', async () => {
    writeDraft('statement', 12, '家里临时有事');
    const user = userEvent.setup();
    const { onClose } = renderStatement();
    expect(screen.getByRole('textbox', { name: /你的说明/ })).toHaveValue('家里临时有事');
    expect(screen.getByText('草稿已存在这台设备 · 写了 6 字')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    const leave = screen.getByRole('group', { name: '还没提交的说明会留在这台设备上，下次回来接着写。' });
    expect(within(leave).getByRole('button', { name: '继续写' })).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(within(leave).getByRole('button', { name: '继续写' }));
    expect(screen.getByRole('button', { name: '稍后再说' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: '稍后再说' }));
    await user.click(screen.getByRole('button', { name: '先离开' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(stored(localStorage, 'edg.draft.statement.12')).toBe('家里临时有事');
  });

  it('refuses an empty statement without asking anything', async () => {
    const user = userEvent.setup();
    renderStatement();
    await user.click(screen.getByRole('button', { name: '提交说明' }));
    expect(screen.getByRole('alert')).toHaveTextContent('说点什么吧，哪怕一句');
    expect(screen.queryByRole('group', { name: '确认提交？交了就不能改。' })).not.toBeInTheDocument();
  });

  it('confirms before submitting, then shows the verdict with the way back', async () => {
    const calls = mockFetch({ 'POST /api/records/12/statement': () => json(200, { record: decided() }) });
    writeDraft('statement', 12, '家里临时有事');
    const user = userEvent.setup();
    const { onDecided } = renderStatement();

    await user.click(screen.getByRole('button', { name: '提交说明' }));
    const confirm = screen.getByRole('group', { name: '确认提交？交了就不能改。' });
    expect(within(confirm).getByRole('button', { name: '再看看' })).toHaveFocus();
    expect(calls).toEqual([]);

    await user.click(within(confirm).getByRole('button', { name: '确认提交' }));
    expect(await screen.findByRole('heading', { name: '裁决结果' })).toBeInTheDocument();
    expect(calls).toEqual([{ method: 'POST', path: '/api/records/12/statement', body: { statement: '家里临时有事' } }]);
    // 88 − 6 = 82, then + weeklyHeal (5 in this config, not 15) = 87.
    expect(screen.getByText('这次 -6。每周一 0 点回血 +5，预计下周一后回到 87。')).toBeInTheDocument();
    expect(localStorage.getItem('edg.draft.statement.12')).toBeNull();
    expect(onDecided).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: '觉得不公平？可以申诉' }));
    expect(await screen.findByRole('dialog', { name: '申诉这一起' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 写失败测试 —— `tests/dom/wording.test.tsx` 追加**

```tsx

describe('写说明页：截止与隐私', () => {
  it('gives the deadline as a time and as time left (M19)', () => {
    render(<StatementDialog open record={awaiting()} config={CONFIG} onClose={() => {}} onDecided={() => {}} />);
    expect(screen.getByText(/^截止：.+（还剩 .+）· 过期会按缺席裁决$/)).toBeInTheDocument();
  });

  it('says who sees what, before and after the verdict (M18)', () => {
    render(<StatementDialog open record={awaiting()} config={CONFIG} onClose={() => {}} onDecided={() => {}} />);
    expect(screen.getByText('谁能看到：你的说明只给你、立案人、裁判和管理员看。')).toBeInTheDocument();
    expect(
      screen.getByText('判决前，立案经过和案由不会公开给其他人；判决后，案由、立案经过和分数变化会公开，你的说明始终只给上面这几类人看。'),
    ).toBeInTheDocument();
    expect(screen.getByText('说明只能交一次，交了马上进入 AI 裁决。')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: 运行，确认失败**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npx vitest run --config vitest.dom.config.ts tests/dom/drafts.test.tsx tests/dom/wording.test.tsx
```

预期：FAIL 5 个（drafts 3 个：没有草稿恢复、没有「提交说明」按钮；wording 2 个：截止和隐私文案不对）。其余已有用例 PASS。

- [ ] **Step 4: 整文件替换 `src/components/StatementDialog.tsx`**

```tsx
import { useRef, useState } from 'react';
import { MAX_NARRATIVE_LEN, VIOLATION_MAP, affectsScore, clampScore } from '@shared/scoring';
import type { Config, RecordItem } from '../types';
import { ApiError, submitStatement } from '../api';
import { COUNTDOWN_TICK_MS } from '../lib/constants';
import { isBlankText, validateStatementDraft } from '../lib/draftShapes';
import { formatRemaining, formatWhen, isUrgent } from '../lib/time';
import { useDraft, type DraftState } from '../lib/useDraft';
import { useInlineConfirm } from '../lib/useInlineConfirm';
import { useLeaveGuard, type LeaveGuard } from '../lib/useLeaveGuard';
import { useNow } from '../lib/useNow';
import { AppealSheet } from './AppealSheet';
import { ConfirmInline } from './ConfirmInline';
import { DraftNote } from './DraftNote';
import { ForgivenessNote } from './ForgivenessNote';
import { Modal } from './Modal';
import { SentencingScale } from './SentencingScale';
import { VerdictCard } from './VerdictCard';
import './statement-dialog.css';

interface StatementDialogProps {
  open: boolean;
  record: RecordItem;
  config: Config;
  onClose: () => void;
  onDecided: (record: RecordItem) => void;
  /** The subject's score before this verdict (App passes me.score). Without it, no ForgivenessNote. */
  score?: number;
}

interface Outcome {
  record: RecordItem;
  /** `score` as it was when the statement went in: App refreshes `me` right after, delta included. */
  scoreBefore: number | undefined;
}

const TITLE_ID = 'statement-dialog-title';
const DRAFT_OPTIONS = { validate: validateStatementDraft, isEmpty: isBlankText };

type InlineConfirm = ReturnType<typeof useInlineConfirm<HTMLButtonElement>>;

interface StatementSubmit {
  confirm: InlineConfirm;
  submitting: boolean;
  error: string | null;
  /** 提交说明: refuse an empty statement, else show 「确认提交？」. */
  ask: () => void;
  /** 确认提交: post it; the verdict comes back with the response. */
  submit: () => void;
}

function useStatementSubmit(recordId: number, text: string, onSubmitted: (record: RecordItem) => void): StatementSubmit {
  const confirm = useInlineConfirm<HTMLButtonElement>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = (): void => {
    if (isBlankText(text)) {
      setError('说点什么吧，哪怕一句');
      return;
    }
    setError(null);
    confirm.ask();
  };

  const submit = (): void => {
    setSubmitting(true);
    submitStatement(recordId, text.trim())
      .then(({ record }) => {
        confirm.close();
        setSubmitting(false);
        onSubmitted(record);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : '提交失败，请稍后重试');
        setSubmitting(false);
        confirm.dismiss();
      });
  };

  return { confirm, submitting, error, ask, submit };
}

/**
 * 情况说明 — the accused's single, un-editable statement.
 *
 * Submitting runs the verdict inline: the few seconds of waiting end in the
 * judgment, which is the moment the whole feature exists for. What is typed is
 * a local draft until then (spec §5 #4), and the one-way step asks first.
 */
export function StatementDialog({ open, record, config, onClose, onDecided, score }: StatementDialogProps): JSX.Element {
  const draft = useDraft<string>('statement', record.id, '', DRAFT_OPTIONS);
  const guard = useLeaveGuard(draft.dirty, onClose);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [appealing, setAppealing] = useState(false);
  const submission = useStatementSubmit(record.id, draft.value, (decided) => {
    draft.clear();
    setOutcome({ record: decided, scoreBefore: score });
    onDecided(decided);
  });

  // Esc / ✕: back out of an open confirm first; never mid-submit.
  const requestClose = (): void => {
    if (submission.submitting) return;
    if (submission.confirm.confirming) submission.confirm.dismiss();
    else guard.requestClose();
  };

  const appealed = (next: RecordItem): void => {
    setAppealing(false);
    setOutcome((prev) => (prev ? { ...prev, record: next } : prev));
    onDecided(next);
  };

  return (
    <>
      <Modal
        open={open}
        onClose={outcome ? onClose : requestClose}
        labelledBy={TITLE_ID}
        size="md"
        dismissible={outcome !== null || !draft.dirty}
      >
        {outcome ? (
          <StatementOutcome outcome={outcome} weeklyHeal={config.weeklyHeal} onClose={onClose} onAppeal={() => setAppealing(true)} />
        ) : (
          <StatementForm record={record} config={config} draft={draft} guard={guard} submission={submission} onRequestClose={requestClose} />
        )}
      </Modal>
      {outcome && appealing && (
        <AppealSheet record={outcome.record} onClose={() => setAppealing(false)} onAppealed={appealed} />
      )}
    </>
  );
}

interface StatementFormProps {
  record: RecordItem;
  config: Config;
  draft: DraftState<string>;
  guard: LeaveGuard;
  submission: StatementSubmit;
  onRequestClose: () => void;
}

function StatementForm({ record, config, draft, guard, submission, onRequestClose }: StatementFormProps): JSX.Element {
  const def = VIOLATION_MAP[record.type];
  const now = useNow(COUNTDOWN_TICK_MS);
  return (
    <div className="sd">
      <h2 id={TITLE_ID} className="sd__title">
        说明情况
      </h2>
      <p className="sd__subtitle">
        {record.reporter.username} 给你记了一笔「{def?.label ?? record.type}」。
        扣多少分由 AI 裁判在下面这个区间里决定 —— 你说的话会直接影响结果。
      </p>
      {record.deadline_at && <StatementDeadline deadline={record.deadline_at} now={now} />}
      <blockquote className="sd__claim">
        <span className="sd__claim-who">立案经过</span>
        <p>{record.claim ?? '（未填写）'}</p>
      </blockquote>
      <SentencingScale range={record.range} />
      <div className="sd__form">
        <StatementField draft={draft} disabled={submission.submitting} />
        <StatementPrivacy aiEnabled={config.aiEnabled} />
        {submission.error && (
          <p className="sd__error" role="alert">
            {submission.error}
          </p>
        )}
        <StatementActions guard={guard} submission={submission} onRequestClose={onRequestClose} />
      </div>
    </div>
  );
}

interface StatementFieldProps {
  draft: DraftState<string>;
  disabled: boolean;
}

/** The statement itself, its counter and the draft note. */
function StatementField({ draft, disabled }: StatementFieldProps): JSX.Element {
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const length = draft.value.trim().length;
  // 清空 takes itself away with the note: hand the keyboard to the empty field.
  const clearText = (): void => {
    draft.clear();
    fieldRef.current?.focus();
  };
  return (
    <>
      <label className="sd__field">
        <span className="sd__label">你的说明</span>
        <textarea
          ref={fieldRef}
          className="sd__textarea"
          value={draft.value}
          onChange={(e) => draft.setValue(e.target.value)}
          rows={5}
          maxLength={MAX_NARRATIVE_LEN}
          data-autofocus
          placeholder="发生了什么？有没有提前说？有没有补偿？照实说，AI 会考虑减轻情节。"
          disabled={disabled}
        />
        <span className="sd__counter tabular">
          {length} / {MAX_NARRATIVE_LEN}
        </span>
      </label>
      <DraftNote savedAt={draft.savedAt} length={length} onClear={disabled ? undefined : clearText} />
    </>
  );
}

/** 「截止：今天 23:40（还剩 5 小时 0 分）· 过期会按缺席裁决」 — absolute and relative (M19). */
function StatementDeadline({ deadline, now }: { deadline: string; now: number }): JSX.Element {
  const urgent = isUrgent(deadline, now);
  return (
    <p className={`sd__deadline${urgent ? ' sd__deadline--urgent' : ''}`}>
      <span aria-hidden="true">⏳</span> 截止：{formatWhen(deadline, now)}（{formatRemaining(deadline, now)}）· 过期会按缺席裁决
    </p>
  );
}

/** Who sees what, before and after the verdict (spec §3.10, M18). */
function StatementPrivacy({ aiEnabled }: { aiEnabled: boolean }): JSX.Element {
  return (
    <div className="sd__privacy">
      <p>谁能看到：你的说明只给你、立案人、裁判和管理员看。</p>
      <p>判决前，立案经过和案由不会公开给其他人；判决后，案由、立案经过和分数变化会公开，你的说明始终只给上面这几类人看。</p>
      <p>
        说明只能交一次，交了马上进入 AI 裁决。
        {aiEnabled && '你的说明会发送给已配置的 AI 服务用于本次判罚。'}
      </p>
    </div>
  );
}

interface StatementActionsProps {
  guard: LeaveGuard;
  submission: StatementSubmit;
  onRequestClose: () => void;
}

function StatementActions({ guard, submission, onRequestClose }: StatementActionsProps): JSX.Element {
  if (guard.confirmingLeave) {
    return (
      <ConfirmInline
        question="还没提交的说明会留在这台设备上，下次回来接着写。"
        cancelLabel="继续写"
        confirmLabel="先离开"
        onCancel={guard.stay}
        onConfirm={guard.confirmLeave}
        tone="primary"
        focus="cancel"
      />
    );
  }
  if (submission.confirm.confirming) {
    return (
      <ConfirmInline
        question="确认提交？交了就不能改。"
        cancelLabel="再看看"
        confirmLabel="确认提交"
        onCancel={submission.confirm.dismiss}
        onConfirm={submission.submit}
        tone="primary"
        focus="cancel"
        busy={submission.submitting}
        busyLabel="AI 裁决中…"
      />
    );
  }
  return (
    <div className="sd__actions">
      <button ref={guard.triggerRef} type="button" className="btn btn--ghost" onClick={onRequestClose}>
        稍后再说
      </button>
      <button ref={submission.confirm.triggerRef} type="button" className="btn btn--gold" onClick={submission.ask}>
        提交说明
      </button>
    </div>
  );
}

interface StatementOutcomeProps {
  outcome: Outcome;
  weeklyHeal: number;
  onClose: () => void;
  onAppeal: () => void;
}

/** 裁决结果, and right under it the way back (spec §3.10 判决). */
function StatementOutcome({ outcome, weeklyHeal, onClose, onAppeal }: StatementOutcomeProps): JSX.Element {
  const { record, scoreBefore } = outcome;
  return (
    <div className="sd">
      <h2 id={TITLE_ID} className="sd__title">
        裁决结果
      </h2>
      <VerdictCard record={record} />
      {scoreBefore !== undefined && affectsScore(record.status) && (
        <ForgivenessNote
          delta={record.delta}
          scoreAfter={clampScore(scoreBefore + record.delta)}
          weeklyHeal={weeklyHeal}
          onAppeal={record.status === 'decided' ? onAppeal : undefined}
        />
      )}
      <div className="sd__actions">
        <button type="button" className="btn btn--gold" onClick={onClose}>
          知道了
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: 改 `src/components/statement-dialog.css`**

删除不再使用的 `.sd__notice { … }` 规则块（快照 `:104-108`，连同它后面的空行；P0-1 合并后这块里的颜色已是 `color: var(--muted)`（原 `--faint`），内容不同也照样整块删，按选择器 `.sd__notice {` 定位）。`.sd__form`（快照 `:59-62`）原样保留：它现在套在 `<div>` 上，规则不变。文件末尾追加：

```css

/* 谁能看到 (spec §3.10, M18): three plain sentences — readable, not fine print. */
.sd__privacy {
  display: grid;
  gap: 0.3rem;
  font-size: var(--fs-sm);
  line-height: 1.6;
  color: var(--muted);
}
```

- [ ] **Step 6: 运行，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/drafts.test.tsx tests/dom/wording.test.tsx tests/dom/modal-focus.test.tsx
npx vitest run --config vitest.config.ts tests/unit/css-conventions.test.ts
npm run typecheck
```

预期：PASS（drafts 11 个、wording 6 个、modal-focus 原样）；css-conventions PASS；typecheck 通过。

- [ ] **Step 7: Commit**

```bash
git add src/components/StatementDialog.tsx src/components/statement-dialog.css tests/dom/drafts.test.tsx tests/dom/wording.test.tsx
git commit -m "feat: 写说明页存草稿、提交前确认，写清隐私范围和截止时间，判决后给回血预估和申诉入口"
```

---

### Task 14: CaseDialog —— 立案草稿与离开确认

**Files:**
- Modify: `src/components/CaseDialog.tsx:1-7`、`:39-41`、`:49-62`、`:64-70`、`:96-106`、`:114`、`:162`、`:160-174`、`:195-205`、`:238-253`
- Test: `tests/dom/drafts.test.tsx`（追加）

- [ ] **Step 1: 写失败测试 —— `tests/dom/drafts.test.tsx` 追加**

import 区追加：

```tsx
import { CaseDialog } from '../../src/components/CaseDialog';
```

并把 types import 改为 `import type { Config, PublicUser, RecordItem } from '../../src/types';`。文件末尾追加：

```tsx

const JUDGE: PublicUser = { id: 'j', username: '裁判', avatar_url: null, is_participant: true, is_judge: true, score: 100, created_at: 'x' };
const PEOPLE: PublicUser[] = [
  JUDGE,
  { ...JUDGE, id: 'a', username: '甲', is_judge: false, score: 90 },
  { ...JUDGE, id: 'b', username: '乙', is_judge: false, score: 80 },
];
const CLAIM = '说好八点五排，等到八点四十还没上线，最后四缺一散了。';

describe('CaseDialog — draft', () => {
  function renderCase(onClose = vi.fn(), onCreated = vi.fn()) {
    render(<CaseDialog open onClose={onClose} participants={PEOPLE} selfId="j" config={CONFIG} onCreated={onCreated} />);
    return { onClose, onCreated };
  }

  it('restores only people who can still be picked', () => {
    writeDraft('case', undefined, { picked: ['a', 'gone'], claim: CLAIM, extras: { gone: '早走了' } });
    renderCase();
    expect(screen.getByRole('checkbox', { name: /甲/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /乙/ })).not.toBeChecked();
    expect(screen.getByRole('textbox', { name: /发生了什么/ })).toHaveValue(CLAIM);
    expect(screen.getByText('草稿已存在这台设备')).toBeInTheDocument();
  });

  it('asks before leaving, and leaving submits nothing', async () => {
    const calls = mockFetch({});
    writeDraft('case', undefined, { picked: ['a'], claim: CLAIM, extras: {} });
    const user = userEvent.setup();
    const { onClose } = renderCase();

    await user.click(screen.getByRole('button', { name: '取消' }));
    const leave = screen.getByRole('group', { name: '这笔还没提交，写的内容会留在这台设备上。' });
    await user.click(within(leave).getByRole('button', { name: '先离开' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([]);
    expect(stored(localStorage, 'edg.draft.case')).toMatchObject({ picked: ['a'] });
  });

  it('keeps only the people who were not filed after a partial success', async () => {
    mockFetch({
      'POST /api/records': () =>
        json(200, {
          records: [decided({ id: 30, subject: { id: 'a', username: '甲', avatar_url: null } })],
          failed: [{ subject_id: 'b', error: '今天已经记过了' }],
        }),
    });
    writeDraft('case', undefined, { picked: ['a', 'b'], claim: CLAIM, extras: { a: '甲的补充', b: '乙的补充' } });
    const user = userEvent.setup();
    renderCase();

    await user.click(screen.getByRole('button', { name: '记下（2 人）' }));
    expect(await screen.findByText(/其中 1 人没记上/)).toBeInTheDocument();
    await waitFor(() =>
      expect(stored(localStorage, 'edg.draft.case')).toEqual({ picked: ['b'], claim: CLAIM, extras: { b: '乙的补充' } }),
    );
  });

  it('forgets the draft once every case is filed', async () => {
    mockFetch({ 'POST /api/records': () => json(200, { records: [decided({ id: 30 })], failed: [] }) });
    writeDraft('case', undefined, { picked: ['a'], claim: CLAIM, extras: {} });
    const user = userEvent.setup();
    const { onClose, onCreated } = renderCase();

    await user.click(screen.getByRole('button', { name: '记下' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('edg.draft.case')).toBeNull();
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npx vitest run --config vitest.dom.config.ts tests/dom/drafts.test.tsx -t "CaseDialog"
```

预期：FAIL 4 个（没有恢复；点「取消」直接调了 onClose；部分失败后 storage 里没有草稿；成功后同理）。

- [ ] **Step 3: 实现**

`:1-7` import 区之后：

```tsx
import { useMemo, useRef, useState } from 'react';
import { MAX_NARRATIVE_LEN, MIN_CLAIM_LEN } from '@shared/scoring';
import type { BatchFailure, Config, PublicUser, RecordItem } from '../types';
import { ApiError, createCases } from '../api';
import { CASE_EXTRA_MAX, isCaseDraftEmpty, validateCaseDraft, type CaseDraftValue } from '../lib/draftShapes';
import { useDraft } from '../lib/useDraft';
import { useLeaveGuard } from '../lib/useLeaveGuard';
import { ConfirmInline } from './ConfirmInline';
import { DraftNote } from './DraftNote';
import { Modal } from './Modal';
import { Avatar } from './Avatar';
import './case-dialog.css';
```

在 `interface CaseDialogProps { … }` 之后加：

```tsx

const EMPTY_CASE: CaseDraftValue = { picked: [], claim: '', extras: {} };
```

`:39-41` 之前：

```tsx
  const [picked, setPicked] = useState<string[]>([]);
  const [claim, setClaim] = useState('');
  const [extras, setExtras] = useState<Record<string, string>>({});
```

之后：

```tsx
  const candidateIds = useMemo(() => candidates.map((c) => c.id), [candidates]);
  // Who and what is a local draft (spec §5 #4) until every case is filed.
  const draft = useDraft<CaseDraftValue>('case', undefined, EMPTY_CASE, {
    validate: (raw) => validateCaseDraft(raw, candidateIds, config.maxBatchSubjects),
    isEmpty: isCaseDraftEmpty,
  });
  const { picked, claim, extras } = draft.value;
```

`:49-62`（`reset` 和 `close`）之前：

```tsx
  const reset = (): void => {
    setPicked([]);
    setClaim('');
    setExtras({});
    setExpanded(null);
    setError(null);
    setFailed([]);
    setSubmitting(false);
  };

  const close = (): void => {
    reset();
    onClose();
  };
```

之后：

```tsx
  // Only the transient bits: what was typed is the draft and stays until a submit succeeds.
  const close = (): void => {
    setExpanded(null);
    setError(null);
    setFailed([]);
    setSubmitting(false);
    onClose();
  };
  const guard = useLeaveGuard(draft.dirty, close);

  const claimRef = useRef<HTMLTextAreaElement>(null);
  // 清空 takes itself away with the note: hand the keyboard to the empty field.
  const clearAll = (): void => {
    draft.clear();
    claimRef.current?.focus();
  };
  const setClaim = (next: string): void => draft.setValue((prev) => ({ ...prev, claim: next }));
  const setExtra = (id: string, text: string): void =>
    draft.setValue((prev) => ({ ...prev, extras: { ...prev.extras, [id]: text } }));
```

`:64-70`（`toggle`）之后：

```tsx
  const toggle = (id: string): void => {
    draft.setValue((prev) => {
      if (prev.picked.includes(id)) return { ...prev, picked: prev.picked.filter((p) => p !== id) };
      if (prev.picked.length >= config.maxBatchSubjects) return prev;
      return { ...prev, picked: [...prev.picked, id] };
    });
  };
```

`:96-106` 之前：

```tsx
      if (res.failed.length > 0) {
        // Partial success is the designed behaviour, not an error state: keep the
        // dialog open so the judge can see exactly who was skipped.
        setFailed(res.failed);
        setPicked(res.failed.map((f) => f.subject_id));
        setSubmitting(false);
        if (res.records.length > 0) onCreated(res.records);
        return;
      }
      onCreated(res.records);
      close();
```

之后：

```tsx
      if (res.failed.length > 0) {
        // Partial success is the designed behaviour, not an error state: keep the
        // dialog open so the judge can see exactly who was skipped — and keep
        // only them in the draft.
        const failedIds = res.failed.map((f) => f.subject_id);
        setFailed(res.failed);
        draft.setValue((prev) => ({
          ...prev,
          picked: failedIds,
          extras: Object.fromEntries(Object.entries(prev.extras).filter(([id]) => failedIds.includes(id))),
        }));
        setSubmitting(false);
        if (res.records.length > 0) onCreated(res.records);
        return;
      }
      draft.clear();
      onCreated(res.records);
      close();
```

`:114` 之前：

```tsx
    <Modal open={open} onClose={close} labelledBy="case-dialog-title" size="md">
```

之后：

```tsx
    <Modal open={open} onClose={guard.requestClose} labelledBy="case-dialog-title" size="md" dismissible={!draft.dirty}>
```

`:162-163` 「发生了什么？」的 `<textarea` 下一行加 `ref={claimRef}`（放在 `className="cd__textarea"` 之前）。

`:171-174`（计数器）之后、`</label>` 之后插入：

```tsx

        <DraftNote savedAt={draft.savedAt} onClear={submitting ? undefined : clearAll} />
```

`:195-205` 的单独补一句 textarea：`maxLength={300}` → `maxLength={CASE_EXTRA_MAX}`；`onChange` 之前：

```tsx
                      onChange={(e) =>
                        setExtras((prev) => ({ ...prev, [id]: e.target.value }))
                      }
```

之后：

```tsx
                      onChange={(e) => setExtra(id, e.target.value)}
```

`:238-253` 整块（`<div className="cd__actions">` 到它的 `</div>`）之前：

```tsx
        <div className="cd__actions">
          <button type="button" className="btn btn--ghost" onClick={close}>
            取消
          </button>
          <button
            type="submit"
            className="btn btn--gold"
            disabled={submitting || candidates.length === 0}
          >
            {submitting
              ? 'AI 归类中…'
              : picked.length > 1
                ? `记下（${picked.length} 人）`
                : '记下'}
          </button>
        </div>
```

之后（提交按钮内容不变，只多缩进 2 格）：

```tsx
        {guard.confirmingLeave ? (
          <ConfirmInline
            question="这笔还没提交，写的内容会留在这台设备上。"
            cancelLabel="继续写"
            confirmLabel="先离开"
            onCancel={guard.stay}
            onConfirm={guard.confirmLeave}
            tone="primary"
            focus="cancel"
          />
        ) : (
          <div className="cd__actions">
            <button ref={guard.triggerRef} type="button" className="btn btn--ghost" onClick={guard.requestClose}>
              取消
            </button>
            <button
              type="submit"
              className="btn btn--gold"
              disabled={submitting || candidates.length === 0}
            >
              {submitting
                ? 'AI 归类中…'
                : picked.length > 1
                  ? `记下（${picked.length} 人）`
                  : '记下'}
            </button>
          </div>
        )}
```

（`setPicked` 已不存在：部分失败那段已改为 `draft.setValue`；`textarea` 的 `onChange={(e) => setClaim(e.target.value)}` 用的是新的 `setClaim`，不用改。）

- [ ] **Step 4: 运行，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/drafts.test.tsx
npm run typecheck
```

预期：PASS（drafts 15 个，含「先离开不提交任何东西」：证明 ConfirmInline 的按钮不会提交外层 `<form>`）；typecheck 通过。

- [ ] **Step 5: Commit**

```bash
git add src/components/CaseDialog.tsx tests/dom/drafts.test.tsx
git commit -m "feat: 记一笔存本机草稿，有草稿时关闭先原地确认"
```

---

### Task 15: SessionFormDialog —— 发起约局草稿与离开确认

**Files:**
- Modify: `src/components/SessionFormDialog.tsx:1-8`、`:16`（之后）、`:40-59`、`:84-86`、`:94`、`:145-174`（`叫谁？` fieldset 之后）、`:182-189`
- Test: `tests/dom/drafts.test.tsx`（追加）

- [ ] **Step 1: 写失败测试 —— `tests/dom/drafts.test.tsx` 追加**

import 区追加：

```tsx
import { quickSlots } from '@shared/quickTime';
import { SessionFormDialog } from '../../src/components/SessionFormDialog';
```

（`quickSlots` 那行放在 `vitest` 的 import 之后、`../../src/…` 之前。）types import 改为 `import type { Config, PublicUser, RecordItem, SessionDetail } from '../../src/types';`。文件末尾追加：

```tsx

function aSession(over: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id: 1,
    organizer: { id: 'me', username: '我', avatar_url: null },
    title: '周五五排',
    game: null,
    starts_at: '2030-01-04T12:00:00.000Z',
    duration_min: null,
    capacity: null,
    note: null,
    status: 'open',
    settled_at: null,
    created_at: '2026-10-01 00:00:00',
    counts: { invited: 1, going: 1, maybe: 0, out: 0 },
    my_rsvp: 'going',
    players: [],
    ...over,
  };
}

describe('SessionFormDialog — draft', () => {
  const FRIENDS: PublicUser[] = [{ ...JUDGE, id: 'me', username: '我' }, { ...JUDGE, id: 'b', username: '乙' }];

  it('restores the people picked, and says how many stay when leaving', async () => {
    writeDraft('session', undefined, { invite: ['b', 'gone'], custom: '', chosen: null });
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<SessionFormDialog open participants={FRIENDS} selfId="me" onClose={onClose} onCreated={() => {}} />);
    expect(screen.getByRole('checkbox', { name: /乙/ })).toBeChecked();

    await user.keyboard('{Escape}');
    const leave = screen.getByRole('group', { name: '这局还没约，已选的 1 个人会留在这台设备上。' });
    expect(within(leave).getByRole('button', { name: '继续编辑' })).toHaveFocus();
    await user.click(within(leave).getByRole('button', { name: '先离开' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('edg.draft.session')).not.toBeNull();
  });

  it('comes back on the quick slot that was picked, not on 其他时间 looked at before', () => {
    // A Monday noon (local): several quick slots are on offer, so the second one is not the default.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2030, 0, 7, 12, 0));
    try {
      const slot = quickSlots()[1];
      writeDraft('session', undefined, { invite: ['b'], custom: '2030-01-09T20:00', chosen: slot.iso });
      render(<SessionFormDialog open participants={FRIENDS} selfId="me" onClose={() => {}} onCreated={() => {}} />);
      expect(screen.getByRole('radio', { name: slot.label })).toBeChecked();
      expect(screen.queryByLabelText('自定义开始时间')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('forgets the draft once the session exists', async () => {
    const calls = mockFetch({ 'POST /api/sessions': () => json(200, { session: aSession() }) });
    writeDraft('session', undefined, { invite: ['b'], custom: '2030-01-04T20:00', chosen: null });
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(<SessionFormDialog open participants={FRIENDS} selfId="me" onClose={() => {}} onCreated={onCreated} />);

    await user.click(screen.getByRole('button', { name: '约！（叫 1 人）' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/sessions', body: { invite: ['b'] } });
    expect(localStorage.getItem('edg.draft.session')).toBeNull();
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npx vitest run --config vitest.dom.config.ts tests/dom/drafts.test.tsx -t "SessionFormDialog"
```

预期：FAIL 3 个（没有恢复，「乙」没勾上、没有离开确认；停在默认的第一个时段，第二个时段没被选中；没恢复出人，按钮是「约！」不是「约！（叫 1 人）」）。第二个用例只假造 `Date`（`toFake: ['Date']`），定时器照常走，所以不会卡住 Testing Library 的异步等待。

- [ ] **Step 3: 实现**

`:1-8` import 区之后：

```tsx
import { useMemo, useState } from 'react';
import { quickSlots } from '@shared/quickTime';
import type { PublicUser, SessionDetail } from '../types';
import { ApiError, createSession } from '../api';
import { CUSTOM_TIME_LEAD_MS } from '../lib/constants';
import { isSessionDraftEmpty, validateSessionDraft, type SessionDraftValue } from '../lib/draftShapes';
import { toDateTimeLocalValue } from '../lib/time';
import { useDraft } from '../lib/useDraft';
import { useLeaveGuard } from '../lib/useLeaveGuard';
import { ConfirmInline } from './ConfirmInline';
import { DraftNote } from './DraftNote';
import { Modal } from './Modal';
import { Avatar } from './Avatar';
import './session-form.css';
```

`interface SessionFormDialogProps { … }`（`:10-16`）之后加：

```tsx

const EMPTY_SESSION: SessionDraftValue = { invite: [], custom: '', chosen: null };
```

`:40-59`（从 `const [chosen, setChosen]` 到 `toggleInvite` 结束）整段替换为：

```tsx
  // Who to call (and the time picked) is a local draft until the session exists (spec §5 #4).
  const draft = useDraft<SessionDraftValue>('session', undefined, EMPTY_SESSION, {
    validate: (raw) => validateSessionDraft(raw, invitable.map((p) => p.id), slots.map((s) => s.iso)),
    isEmpty: isSessionDraftEmpty,
  });
  const { invite, custom } = draft.value;
  // A restored slot that has since passed was dropped by the validator: fall back to the first one.
  const chosen = draft.value.chosen ?? slots[0]?.iso ?? '';
  // `chosen: null` with a custom time means 其他时间 was the one in use (toggleCustom keeps it so).
  const [customOpen, setCustomOpen] = useState(() => draft.value.chosen === null && custom !== '');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const guard = useLeaveGuard(draft.dirty, onClose);

  const setChosen = (iso: string): void => draft.setValue((prev) => ({ ...prev, chosen: iso }));
  const setCustom = (value: string): void => draft.setValue((prev) => ({ ...prev, custom: value }));
  // Opening 其他时间 drops the slot, closing it goes back to the slot on screen:
  // the draft then always says which of the two the user was on.
  const toggleCustom = (): void => {
    const opening = !customOpen;
    setCustomOpen(opening);
    draft.setValue((prev) => ({
      ...prev,
      chosen: opening ? null : chosen || null,
      custom: opening && prev.custom === '' ? toDateTimeLocalValue(Date.now() + CUSTOM_TIME_LEAD_MS) : prev.custom,
    }));
  };
  const toggleInvite = (id: string): void => {
    draft.setValue((prev) => ({
      ...prev,
      invite: prev.invite.includes(id) ? prev.invite.filter((p) => p !== id) : [...prev.invite, id],
    }));
  };
```

（原来的 `close()` 只是把 state 清回初始值再 `onClose()`；这个组件关掉就卸载（`App.tsx:423`），清 state 没有意义，而清掉草稿正是要避免的，所以删掉，改用 `onClose`/`guard`。）

`:84-86` 之前：

```tsx
      const { session } = await createSession({ starts_at: startsAt, invite });
      onCreated(session);
      close();
```

之后：

```tsx
      const { session } = await createSession({ starts_at: startsAt, invite });
      draft.clear();
      onCreated(session);
      onClose();
```

`:94` 之前：

```tsx
    <Modal open={open} onClose={close} labelledBy="session-form-title" size="md">
```

之后：

```tsx
    <Modal open={open} onClose={guard.requestClose} labelledBy="session-form-title" size="md" dismissible={!draft.dirty}>
```

在「叫谁？」那个 `</fieldset>`（`:174`）之后插入：

```tsx

        <DraftNote savedAt={draft.savedAt} />
```

`:182-189` 之前：

```tsx
        <div className="sf__actions">
          <button type="button" className="btn btn--ghost" onClick={close}>
            取消
          </button>
          <button type="submit" className="btn btn--gold" disabled={submitting}>
            {submitting ? '创建中…' : invite.length > 0 ? `约！（叫 ${invite.length} 人）` : '约！'}
          </button>
        </div>
```

之后：

```tsx
        {guard.confirmingLeave ? (
          <ConfirmInline
            question={`这局还没约，已选的 ${invite.length} 个人会留在这台设备上。`}
            cancelLabel="继续编辑"
            confirmLabel="先离开"
            onCancel={guard.stay}
            onConfirm={guard.confirmLeave}
            tone="primary"
            focus="cancel"
          />
        ) : (
          <div className="sf__actions">
            <button ref={guard.triggerRef} type="button" className="btn btn--ghost" onClick={guard.requestClose}>
              取消
            </button>
            <button type="submit" className="btn btn--gold" disabled={submitting}>
              {submitting ? '创建中…' : invite.length > 0 ? `约！（叫 ${invite.length} 人）` : '约！'}
            </button>
          </div>
        )}
```

「其他时间」按钮（快照 `:122-132`）的 `onClick` 之前：

```tsx
              onClick={() => {
                setCustomOpen((v) => !v);
                if (!custom) setCustom(toDateTimeLocalValue(Date.now() + 3_600_000));
              }}
```

之后：

```tsx
              onClick={toggleCustom}
```

（时段 radio 的 `onChange={() => { setChosen(s.iso); setCustomOpen(false); }}`、`datetime-local` 的 `onChange={(e) => setCustom(e.target.value)}` 调用的是新的同名函数，不用改。）

- [ ] **Step 4: 运行，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/drafts.test.tsx tests/dom/p8-app.test.tsx
npm run typecheck
```

预期：PASS（drafts 18 个）；typecheck 通过。

- [ ] **Step 5: Commit**

```bash
git add src/components/SessionFormDialog.tsx tests/dom/drafts.test.tsx
git commit -m "feat: 约一局存本机草稿，选了人再关闭时先原地确认"
```

---

### Task 16: RollCallDialog —— 点名第 1 步草稿与离开确认

**Files:**
- Modify: `src/components/RollCallDialog.tsx:1-10`、`:12`（之前）、`:19-22`、`:43-50`、`:55`（之后）、`:59-67`、`:114-115`、`:132`、`:185`、`:196-210`、`:274-291`
- Test: `tests/dom/drafts.test.tsx`（追加）

- [ ] **Step 1: 写失败测试 —— `tests/dom/drafts.test.tsx` 追加**

import 区追加：

```tsx
import { RollCallDialog } from '../../src/components/RollCallDialog';
```

文件末尾追加：

```tsx

function rollCallSession(): SessionDetail {
  const player = (id: string, username: string) => ({
    user: { id, username, avatar_url: null },
    rsvp: 'going' as const,
    rsvp_at: '2026-10-01 00:00:00',
    attendance: null,
    late_minutes: null,
    attendance_note: null,
    record_id: null,
    is_participant: true,
  });
  return aSession({ players: [player('a', '甲'), player('b', '乙')] });
}

describe('RollCallDialog — draft', () => {
  it('keeps each mark on this device and brings it back', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<RollCallDialog open session={rollCallSession()} onClose={() => {}} onSettled={() => {}} />);
    await user.click(within(screen.getByRole('group', { name: '甲 出勤' })).getByRole('button', { name: '准时' }));
    await waitFor(() => expect(stored(localStorage, 'edg.draft.rollcall.1')).toEqual({ a: { attendance: 'on_time' } }));
    unmount();

    render(<RollCallDialog open session={rollCallSession()} onClose={() => {}} onSettled={() => {}} />);
    expect(within(screen.getByRole('group', { name: '甲 出勤' })).getByRole('button', { name: '准时' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('never rewrites what is being typed into the minutes field', async () => {
    const user = userEvent.setup();
    render(<RollCallDialog open session={rollCallSession()} onClose={() => {}} onSettled={() => {}} />);
    await user.click(within(screen.getByRole('group', { name: '甲 出勤' })).getByRole('button', { name: '迟到' }));
    const minutes = screen.getByRole('spinbutton', { name: /甲 迟到分钟数/ });
    await user.type(minutes, '1500'); // over LATE_MINUTES_MAX: the server says so, the field keeps it
    expect(minutes).toHaveValue(1500);
    // Only a whole number in range is kept for next time.
    await waitFor(() => expect(stored(localStorage, 'edg.draft.rollcall.1')).toEqual({ a: { attendance: 'late' } }));
  });

  it('asks before leaving a half-done roll call', async () => {
    writeDraft('rollcall', 1, { a: { attendance: 'late', late_minutes: 12 } });
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<RollCallDialog open session={rollCallSession()} onClose={onClose} onSettled={() => {}} />);
    expect(screen.getByRole('spinbutton', { name: /甲 迟到分钟数/ })).toHaveValue(12);

    await user.click(screen.getByRole('button', { name: '取消' }));
    const leave = screen.getByRole('group', { name: '点名还没提交，标记会留在这台设备上。' });
    expect(within(leave).getByRole('button', { name: '继续点名' })).toHaveFocus();
    await user.click(within(leave).getByRole('button', { name: '继续点名' }));
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('forgets the marks once the session is settled', async () => {
    const session = rollCallSession();
    mockFetch({
      'POST /api/sessions/1/rollcall': () => json(200, { session, drafts: [] }),
      'POST /api/sessions/1/settle': () => json(200, { session, created: 0, skipped: 0 }),
    });
    writeDraft('rollcall', 1, { a: { attendance: 'on_time' } });
    const onSettled = vi.fn();
    const user = userEvent.setup();
    render(<RollCallDialog open session={session} onClose={() => {}} onSettled={onSettled} />);

    await user.click(screen.getByRole('button', { name: '保存点名（1 人）' }));
    await user.click(await screen.findByRole('button', { name: '跳过全部，仅记录出勤' }));
    await waitFor(() => expect(onSettled).toHaveBeenCalledWith(session, 0));
    expect(localStorage.getItem('edg.draft.rollcall.1')).toBeNull();
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npx vitest run --config vitest.dom.config.ts tests/dom/drafts.test.tsx -t "RollCallDialog"
```

预期：FAIL 4 个（「keeps each mark…」：点了「准时」storage 里没有草稿；「never rewrites…」：输入框是 1500，但 storage 里没有草稿；「asks before leaving…」：没恢复出 12 分钟，「取消」直接调了 onClose；「forgets the marks…」：草稿没恢复，按钮是「保存点名（0 人）」，找不到「保存点名（1 人）」）。

- [ ] **Step 3: 实现**

`:1-10` import 区之后：

```tsx
import { useMemo, useState } from 'react';
import { ATTENDANCE_DEFS } from '@shared/attendance';
import { VIOLATION_MAP } from '@shared/scoring';
import type { CaseDraft, RollCallEntry, SessionDetail, SettleEntry } from '../types';
import { ApiError, rollCall, settleSession } from '../api';
import {
  LATE_MINUTES_MAX,
  isRollCallDraftEmpty,
  mergeMarks,
  toStoredMark,
  validateRollCallDraft,
  type MarkInput,
  type RollCallDraftValue,
} from '../lib/draftShapes';
import { useDraft } from '../lib/useDraft';
import { useLeaveGuard } from '../lib/useLeaveGuard';
import { ConfirmInline } from './ConfirmInline';
import { DraftNote } from './DraftNote';
import { Modal } from './Modal';
import { Avatar } from './Avatar';
import { SentencingScale } from './SentencingScale';
import './roll-call.css';
```

（`import type { Attendance } from '@shared/attendance';` 删掉：只有被删的 `Draftable` 用它。）

`interface RollCallDialogProps {`（`:12`）之前加：

```tsx
/** A person nobody has marked yet. */
const NO_MARK: MarkInput = { attendance: null, lateMinutes: '' };

```

删除 `:19-22`：

```tsx
interface Draftable {
  attendance: Attendance | null;
  lateMinutes: string;
}
```

`:43-50` 之前：

```tsx
  const [marks, setMarks] = useState<Record<string, Draftable>>(() =>
    Object.fromEntries(
      roster.map((p) => [
        p.user.id,
        { attendance: p.attendance, lateMinutes: p.late_minutes?.toString() ?? '' },
      ]),
    ),
  );
```

之后：

```tsx
  const rosterIds = useMemo(() => roster.map((p) => p.user.id), [roster]);
  // Step 1's marks are a local draft (spec §3.7, §5 #4): only what was marked
  // on this device is stored; the server's own attendance shows underneath.
  const draft = useDraft<RollCallDraftValue>('rollcall', session.id, {}, {
    validate: (raw) => validateRollCallDraft(raw, rosterIds),
    isEmpty: isRollCallDraftEmpty,
  });
  // What step 1 shows and edits, minutes as typed; starts as the server's marks
  // with this device's draft on top.
  const [marks, setMarks] = useState<Record<string, MarkInput>>(() => mergeMarks(roster, draft.value));
```

在 `const [error, setError] = useState<string | null>(null);`（`:55`）之后加：

```tsx
  const leave = useLeaveGuard(draft.dirty, onClose);
  const requestClose = (): void => {
    if (!busy) leave.requestClose();
  };
```

`:59-67`（`setMark`）之后：

```tsx
  const setMark = (userId: string, patch: Partial<MarkInput>): void => {
    // The fallback matters: without it, marking someone who is not yet in the
    // map would leave lateMinutes undefined and flip the minutes field from
    // controlled to uncontrolled.
    const next: MarkInput = { ...(marks[userId] ?? NO_MARK), ...patch };
    setMarks((prev) => ({ ...prev, [userId]: { ...(prev[userId] ?? NO_MARK), ...patch } }));
    // The draft keeps what can be restored as is: the attendance, and the
    // minutes only once they are a whole number in range (the field keeps the typing).
    const stored = toStoredMark(next);
    if (stored) draft.setValue((prev) => ({ ...prev, [userId]: stored }));
  };
```

`:114-115` 之前：

```tsx
      const res = await settleSession(session.id, file, skipAll);
      onSettled(res.session, res.created);
```

之后：

```tsx
      const res = await settleSession(session.id, file, skipAll);
      draft.clear();
      onSettled(res.session, res.created);
```

在 `return (` 之前加：

```tsx
  const leaveConfirm = (
    <ConfirmInline
      question="点名还没提交，标记会留在这台设备上。"
      cancelLabel="继续点名"
      confirmLabel="先离开"
      onCancel={leave.stay}
      onConfirm={leave.confirmLeave}
      tone="primary"
      focus="cancel"
    />
  );
```

`:132` 之前：

```tsx
    <Modal open={open} onClose={onClose} labelledBy="rollcall-title" size="lg">
```

之后：

```tsx
    <Modal open={open} onClose={requestClose} labelledBy="rollcall-title" size="lg" dismissible={!draft.dirty}>
```

`:185` 的 `max={1440}` → `max={LATE_MINUTES_MAX}`。

`:196-210` 之前：

```tsx
          </ul>

          <div className="rc__actions">
            <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
              取消
            </button>
            <button
              type="button"
              className="btn btn--gold"
              onClick={() => void handleRollCall()}
              disabled={busy || markedCount === 0}
            >
              {busy ? '保存中…' : `保存点名（${markedCount} 人）`}
            </button>
          </div>
```

之后（「保存点名」按钮内容不变，只多缩进 2 格）：

```tsx
          </ul>

          <DraftNote savedAt={draft.savedAt} />

          {leave.confirmingLeave ? (
            leaveConfirm
          ) : (
            <div className="rc__actions">
              <button ref={leave.triggerRef} type="button" className="btn btn--ghost" onClick={requestClose} disabled={busy}>
                取消
              </button>
              <button
                type="button"
                className="btn btn--gold"
                onClick={() => void handleRollCall()}
                disabled={busy || markedCount === 0}
              >
                {busy ? '保存中…' : `保存点名（${markedCount} 人）`}
              </button>
            </div>
          )}
```

`:274-291`（结算那一步）之前：

```tsx
          <div className="rc__actions rc__actions--settle">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => void handleSettle(true)}
              disabled={busy}
            >
              跳过全部，仅记录出勤
            </button>
            <button
              type="button"
              className="btn btn--gold"
              onClick={() => void handleSettle(false)}
              disabled={busy || picked.size === 0}
            >
              {busy ? '结算中…' : `确认立案（${picked.size}）`}
            </button>
          </div>
```

之后（两个按钮内容不变，只多缩进 2 格）：

```tsx
          {leave.confirmingLeave ? (
            leaveConfirm
          ) : (
            <div className="rc__actions rc__actions--settle">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => void handleSettle(true)}
                disabled={busy}
              >
                跳过全部，仅记录出勤
              </button>
              <button
                type="button"
                className="btn btn--gold"
                onClick={() => void handleSettle(false)}
                disabled={busy || picked.size === 0}
              >
                {busy ? '结算中…' : `确认立案（${picked.size}）`}
              </button>
            </div>
          )}
```

- [ ] **Step 4: 运行，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/drafts.test.tsx tests/dom/session-rsvp-moved.test.tsx
npm run typecheck
```

预期：PASS（drafts 22 个；session-rsvp-moved 原样通过）；typecheck 通过。

- [ ] **Step 5: Commit**

```bash
git add src/components/RollCallDialog.tsx tests/dom/drafts.test.tsx
git commit -m "feat: 点名标记存本机草稿，没结算就关闭时先原地确认"
```

---

### Task 17: 首登身份草稿（M21 后半）与 `DiscordLinkCard.onBeforeBind`

**Files:**
- Modify: `src/components/DiscordLinkCard.tsx:31`、`:124`
- Modify: `src/components/OnboardingDialog.tsx:1-6`、`:15`、`:61-70`、`:84-88`、`:96`、`:134`、`:174`、`:183`
- Test: `tests/dom/drafts.test.tsx`（追加）

- [ ] **Step 1: 写失败测试 —— `tests/dom/drafts.test.tsx` 追加**

import 区追加：

```tsx
import { OnboardingDialog } from '../../src/components/OnboardingDialog';
```

types import 改为 `import type { Config, PublicUser, RecordItem, SessionDetail, User } from '../../src/types';`。文件末尾追加：

```tsx

describe('OnboardingDialog — the choice survives binding Discord (M21)', () => {
  const NEWCOMER: User = {
    id: 'u1',
    username: 'Nanako',
    oauth_username: 'Nanako',
    avatar_url: null,
    is_participant: false,
    is_judge: false,
    is_admin: true,
    score: 100,
    created_at: '2026-10-01 00:00:00',
  };

  async function followBindLink(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    const link = await screen.findByRole('link', { name: '绑定 Discord' });
    // jsdom cannot navigate; stop the default after React's handler has run.
    const block = (e: Event): void => e.preventDefault();
    document.addEventListener('click', block);
    try {
      await user.click(link);
    } finally {
      document.removeEventListener('click', block);
    }
  }

  it('keeps the unsaved choice across the round trip, with no extra request', async () => {
    const calls = mockFetch({ 'GET /api/me/discord': () => json(200, { link: null }) });
    const user = userEvent.setup();
    const { unmount } = render(<OnboardingDialog open onClose={() => {}} me={NEWCOMER} onSaved={() => {}} />);

    await user.click(screen.getByRole('radio', { name: /^裁判/ }));
    await followBindLink(user);
    expect(calls).toHaveLength(1);
    expect(stored(sessionStorage, 'edg.draft.onboarding')).toEqual({ choice: 'judge', useNanako: true, customName: '' });
    expect(localStorage.getItem('edg.draft.onboarding')).toBeNull();
    unmount();

    // Back from Discord: a full page load mounts the dialog afresh.
    mockFetch({ 'GET /api/me/discord': () => json(200, { link: null }) });
    render(<OnboardingDialog open onClose={() => {}} me={NEWCOMER} onSaved={() => {}} />);
    expect(screen.getByRole('radio', { name: /^裁判/ })).toHaveAttribute('aria-checked', 'true');
    await screen.findByRole('link', { name: '绑定 Discord' }); // the card has settled: no stray act() warning
  });

  it('drops the draft on 稍后再说', async () => {
    mockFetch({ 'GET /api/me/discord': () => json(200, { link: null }) });
    writeDraft('onboarding', undefined, { choice: 'judge', useNanako: true, customName: '' });
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<OnboardingDialog open onClose={onClose} me={NEWCOMER} onSaved={() => {}} />);
    await screen.findByRole('link', { name: '绑定 Discord' });

    await user.click(screen.getByRole('button', { name: '稍后再说' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('edg.draft.onboarding')).toBeNull();
  });

  it('never pre-picks a judge role for someone who is not one', async () => {
    mockFetch({ 'GET /api/me/discord': () => json(200, { link: null }) });
    writeDraft('onboarding', undefined, { choice: 'both', useNanako: true, customName: '' });
    render(<OnboardingDialog open onClose={() => {}} me={{ ...NEWCOMER, is_admin: false }} onSaved={() => {}} />);
    expect(screen.getByRole('radio', { name: /上榜选手/ })).toHaveAttribute('aria-checked', 'true');
    expect(sessionStorage.getItem('edg.draft.onboarding')).toBeNull();
    await screen.findByRole('link', { name: '绑定 Discord' });
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npx vitest run --config vitest.dom.config.ts tests/dom/drafts.test.tsx -t "OnboardingDialog"
```

预期：FAIL 3 个（点绑定不写草稿；不恢复；「稍后再说」不清草稿 / 非裁判的无效草稿没被删掉）。

- [ ] **Step 3: `DiscordLinkCard.tsx` 加可选 `onBeforeBind`**

`:31` 之前：

```tsx
export function DiscordLinkCard(): JSX.Element | null {
```

之后：

```tsx
interface DiscordLinkCardProps {
  /**
   * Called as the 绑定 Discord link is followed (spec §4.4 #2): the host keeps
   * its unsaved choice. It must not block the navigation, nor fetch anything.
   */
  onBeforeBind?: () => void;
}

export function DiscordLinkCard({ onBeforeBind }: DiscordLinkCardProps): JSX.Element | null {
```

`:124` 之前：

```tsx
          <a ref={bindRef} className="btn btn--sm dlink__bind" href={DISCORD_LINK_URL}>
```

之后：

```tsx
          <a ref={bindRef} className="btn btn--sm dlink__bind" href={DISCORD_LINK_URL} onClick={onBeforeBind}>
```

- [ ] **Step 4: `OnboardingDialog.tsx` 恢复 / 保存 / 清除身份草稿**

`:1-6` import 区之后：

```tsx
import { useState } from 'react';
import type { User } from '../types';
import { ApiError, updateDisplayName, updateRoles } from '../api';
import { clearDraft, readDraft, writeDraft } from '../lib/drafts';
import {
  DISPLAY_NAME_MAX,
  validateOnboardingDraft,
  type OnboardingChoice,
  type OnboardingDraftValue,
} from '../lib/draftShapes';
import { DiscordLinkCard } from './DiscordLinkCard';
import { Modal } from './Modal';
import './onboarding-dialog.css';
```

`:15` 之前：

```tsx
type Choice = 'participant' | 'judge' | 'both';
```

之后：

```tsx
type Choice = OnboardingChoice;
```

`:61-70` 之前：

```tsx
  // The effective name equals the OAuth name until the user picks a custom one.
  const usingOauthName = me.username === me.oauth_username;
  const [useNanako, setUseNanako] = useState(usingOauthName);
  const [customName, setCustomName] = useState(usingOauthName ? '' : me.username);
  const [choice, setChoice] = useState<Choice>(() => initialChoice(me));
  // Judges are appointed by an admin (the API refuses a self-grant); someone
  // who already is one, or an admin, may keep or pick the judge cards.
  const canJudge = me.is_judge || me.is_admin;
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
```

之后：

```tsx
  // The effective name equals the OAuth name until the user picks a custom one.
  const usingOauthName = me.username === me.oauth_username;
  // Judges are appointed by an admin (the API refuses a self-grant); someone
  // who already is one, or an admin, may keep or pick the judge cards.
  const canJudge = me.is_judge || me.is_admin;
  // Back from binding Discord (a full page load): what was picked before the
  // jump, if anything. Still unsaved — the user confirms it as usual.
  const [restored] = useState(() =>
    readDraft('onboarding', undefined, (raw) => validateOnboardingDraft(raw, canJudge)),
  );
  const [useNanako, setUseNanako] = useState(restored?.value.useNanako ?? usingOauthName);
  const [customName, setCustomName] = useState(
    restored?.value.customName ?? (usingOauthName ? '' : me.username),
  );
  const [choice, setChoice] = useState<Choice>(() => restored?.value.choice ?? initialChoice(me));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Only at the moment of leaving for Discord (spec §4.4 #2) — no request, the
  // jump is not held up. If storage refuses, the choice is lost as it was before.
  const saveBeforeBind = (): void => {
    const value: OnboardingDraftValue = { choice, useNanako, customName };
    writeDraft('onboarding', undefined, value);
  };

  // 稍后再说 / Esc / ✕: no leave confirm here (p8-app closes it with Esc), the draft just goes.
  const dismiss = (): void => {
    clearDraft('onboarding');
    onClose();
  };
```

`:84-88` 之前：

```tsx
    try {
      await updateDisplayName(displayName);
      const { user } = await updateRoles(roles);
      onSaved(user);
      onClose();
```

之后：

```tsx
    try {
      await updateDisplayName(displayName);
      const { user } = await updateRoles(roles);
      clearDraft('onboarding');
      onSaved(user);
      onClose();
```

`:96` 之前：

```tsx
    <Modal open={open} onClose={onClose} labelledBy="onboarding-title" size="md">
```

之后：

```tsx
    <Modal open={open} onClose={dismiss} labelledBy="onboarding-title" size="md">
```

`:134` 的 `maxLength={24}` → `maxLength={DISPLAY_NAME_MAX}`。

`:174` 之前：

```tsx
      <DiscordLinkCard />
```

之后：

```tsx
      <DiscordLinkCard onBeforeBind={saveBeforeBind} />
```

`:183` 之前：

```tsx
        <button type="button" className="btn btn--ghost" onClick={onClose}>
```

之后：

```tsx
        <button type="button" className="btn btn--ghost" onClick={dismiss}>
```

（`ROLE_CARDS` 一个字不碰 —— `:29` 归 P0-4。）

- [ ] **Step 5: 运行，确认通过，且锁定的两个测试原样通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/drafts.test.tsx tests/dom/onboarding-roles.test.tsx tests/dom/discord-link.test.tsx tests/dom/p8-app.test.tsx
npm run typecheck
```

预期：全部 PASS（drafts 25 个；stderr 里的 `act(...)` 警告仍只有 onboarding-roles 原有的三条——三个新用例都等「绑定 Discord」链接出现后才结束，DiscordLinkCard 的请求不会在用例结束后才落地；onboarding-roles `:41` 仍正好 2 次「裁判资格由管理员授予」、`:77` 请求体不变；discord-link `:82,194` 请求数仍为 1、`:94` href 不变；p8-app `:132-142` Esc 关引导照常）；typecheck 通过。

- [ ] **Step 6: Commit**

```bash
git add src/components/DiscordLinkCard.tsx src/components/OnboardingDialog.tsx tests/dom/drafts.test.tsx
git commit -m "feat: 首登时先去绑定 Discord 不再丢掉没保存的身份选择"
```

---

### Task 18: App 接线 —— MyScoreLine、退出清草稿、新 props

**Files:**
- Modify: `src/App.tsx`（快照行号：import 区 `:23-42`、`handleLogout` `:231-238`、render 区 `:283-286`、`:315-320`、`:401-409`、`:447-463`；P0-3/P0-4 之后按片段定位）
- Test: `tests/dom/my-score-line.test.tsx`（追加）

- [ ] **Step 1: 写失败测试 —— `tests/dom/my-score-line.test.tsx` 追加**

import 区改为：

```tsx
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { ForgivenessNote } from '../../src/components/ForgivenessNote';
import { MyScoreLine } from '../../src/components/MyScoreLine';
import type { Config, PublicUser, User } from '../../src/types';
```

文件末尾追加：

```tsx

function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, text: () => Promise.resolve(JSON.stringify(body)) } as Response;
}

/** Route fetch by "METHOD /path?query"; anything unrouted answers 500 so it shows up. */
function mockFetch(routes: Record<string, () => Response>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = url.replace(/^https?:\/\/[^/]+/, '');
      const route = routes[`${init?.method ?? 'GET'} ${path}`];
      return Promise.resolve(route ? route() : json(500, { error: `unrouted ${path}` }));
    }),
  );
}

/** Let the last fetches of the page land inside act() (p8-app.test.tsx:38-41). */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('MyScoreLine in the app', () => {
  it('sits after the to-dos and before 约局, with the numbers from config', async () => {
    const board: PublicUser[] = [
      { id: 'x', username: '阿杰', avatar_url: null, is_participant: true, is_judge: false, score: 90, created_at: 'x' },
      { id: 'me', username: '我', avatar_url: null, is_participant: true, is_judge: false, score: 82, created_at: 'x' },
    ];
    mockFetch({
      'GET /api/config': () => json(200, CONFIG),
      'GET /api/leaderboard': () => json(200, { participants: board }),
      'GET /api/records?limit=50': () => json(200, { records: [] }),
      'GET /api/me': () => json(200, { user: ME, pending: { statements: 0, appeals: 0 } }),
      'GET /api/me/invites': () => json(200, { sessions: [] }),
      'GET /api/report/latest': () => json(200, { report: null }),
      'GET /api/sessions?scope=upcoming': () => json(200, { sessions: [] }),
    });
    render(<App />);

    const standing = await screen.findByRole('button', { name: '82 分 · 第 2 名' });
    expect(screen.getByText('周一 0 点回血 +5 → 预计 87 · 还有 2 天')).toBeInTheDocument();
    const sessions = await screen.findByRole('heading', { name: /约局/ });
    // DOM order = visual order (spec §2.4): MyScoreLine, then SessionsPanel.
    expect(standing.compareDocumentPosition(sessions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await settle();
  });

  it('is not on the page for a visitor', async () => {
    mockFetch({
      'GET /api/config': () => json(200, CONFIG),
      'GET /api/leaderboard': () => json(200, { participants: [] }),
      'GET /api/records?limit=50': () => json(200, { records: [] }),
      'GET /api/me': () => json(200, { user: null, pending: { statements: 0, appeals: 0 } }),
      'GET /api/report/latest': () => json(200, { report: null }),
      'GET /api/sessions?scope=upcoming': () => json(200, { sessions: [] }),
    });
    render(<App />);
    await screen.findByRole('heading', { name: /约局/ });
    await settle();
    expect(screen.queryByText(/周一 0 点回血/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npx vitest run --config vitest.dom.config.ts tests/dom/my-score-line.test.tsx
```

预期：FAIL 1 个（App 里还没有 MyScoreLine：找不到「82 分 · 第 2 名」）；访客用例已经 PASS（留作回归）。

- [ ] **Step 3: 实现**

import 区（组件 import 一组里、`PendingBanner` 之后）加：

```ts
import { MyScoreLine } from './components/MyScoreLine';
```

lib import 一组里加（若 P0-4 已经在 App 里 import 了 `competitionRanks`，只加 `clearAllDrafts`）：

```ts
import { clearAllDrafts } from './lib/drafts';
import { competitionRanks } from './lib/rank';
```

`handleLogout`（快照 `:231-238`）之前：

```ts
  const handleLogout = useCallback(async (): Promise<void> => {
    try {
      await apiLogout();
    } catch {
      // Even if the request fails, reloading clears client state.
    }
    window.location.reload();
  }, []);
```

之后：

```ts
  const handleLogout = useCallback(async (): Promise<void> => {
    try {
      await apiLogout();
    } catch {
      // Even if the request fails, reloading clears client state.
    }
    // Drafts are this person's: whoever signs in next on this device must not find them.
    clearAllDrafts();
    window.location.reload();
  }, []);
```

在 render 区解构 `state.data`（快照 `:283` 的 `const { config, participants, records, me, myPending, invites, report } = …;`）之后、`return (` 之前加：

```ts
  // MyScoreLine's 第 N 名: the board's own competition ranking (P0-4's rank.ts).
  const myIndex = me ? participants.findIndex((p) => p.id === me.id) : -1;
  const myRank = myIndex >= 0 ? competitionRanks(participants.map((p) => p.score))[myIndex] : null;
```

`<PendingBanner …/>` 与 `<SessionsPanel` 之间（快照 `:315-320`）：之前：

```tsx
        <PendingBanner cases={myPending} onOpen={setStatementCase} />

```

之后：

```tsx
        <PendingBanner cases={myPending} onOpen={setStatementCase} />

        {/* Your score and Monday's heal, right after what you have to do (spec §2.4). */}
        {me && <MyScoreLine me={me} rank={myRank} config={config} onOpen={() => setSelectedUserId(me.id)} />}

```

（main 上方那段「Stack order = …」的注释如果还在，把「待办 → 约局」改成「待办 → 我的分数 → 约局」。）

StatementDialog（快照 `:401-409`）之前：

```tsx
        <StatementDialog
          open
          record={statementCase}
          config={config}
```

之后：

```tsx
        <StatementDialog
          key={statementCase.id}
          open
          record={statementCase}
          config={config}
          score={me?.score}
```

PlayerDetail（快照 `:447-463`）之前：

```tsx
        <PlayerDetail
          userId={selectedUserId}
          me={me}
          focusRecordId={focusCaseId}
```

之后：

```tsx
        <PlayerDetail
          userId={selectedUserId}
          me={me}
          config={config}
          focusRecordId={focusCaseId}
```

- [ ] **Step 4: 运行，确认通过，且 App 级锁定测试原样通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/my-score-line.test.tsx tests/dom/p8-app.test.tsx tests/dom/deep-link.test.tsx tests/dom/discord-link.test.tsx
npm run typecheck
wc -l src/App.tsx
```

预期：全部 PASS（deep-link `:112-116` 唯一的 /约局/ 标题不受影响：MyScoreLine 没有 heading；首屏请求 URL 集合不变：MyScoreLine 不发请求）；typecheck 通过；记下 `App.tsx` 行数（本 Task 只加约 14 行；跨 PR 一致性检查把 P0-3 → P0-4 → P0-5 三份计划的 App 片段按顺序套在一起实测：442 → 440 → **454 行**，仍在「约 450」之内；契约 §4 要求 P0-4/P0-5 之后不超过约 450 行，超了在 PR 描述里标出，由 review 决定是否另开小 PR 把一段 render 片段抽成组件，本 PR 不顺手重构 P0-3/P0-4 的区域）。

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx tests/dom/my-score-line.test.tsx
git commit -m "feat: 首页加 MyScoreLine，退出登录清掉本机草稿"
```

---

## 收尾

- [ ] **全量验证**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npm run typecheck
npx vitest run --config vitest.config.ts
npx vitest run --config vitest.dom.config.ts
npx vitest run --config vitest.workers.config.ts tests/worker/cases.test.ts
npm run build
```

预期：typecheck 三个 tsconfig 都过；unit 比 Task 0 基线多 3 个文件、32 个用例（`revoke` 5、`forgiveness` 10、`draft-shapes` 16，`source-hygiene` +1），全部通过（按推荐顺序为 **26 个文件 / 326 个用例**）；dom 比基线多 4 个文件、54 个用例（`drafts` 25、`appeal-sheet` 12、`my-score-line` 10、`wording` 6，`verdict-privacy` +1），全部通过（按推荐顺序为 **20 个文件 / 219 个用例**），且没有新增 React `act(...)` 警告（只允许基线里 `onboarding-roles` 的三条），也没有 jsdom 的 `Not implemented: navigation`；`cases.test.ts` 37/37；build 成功。

`npm run test:server`、`npm run test:pg` 本地不跑（会起嵌入式 Postgres）。本 PR 改了 `server/src/discord/case-actions.ts` 和 `worker/cases.ts`：**合并前必须在 CI 上看到 server 和 pg 两套通过**（尤其 `tests/pg/dm.test.ts:820-829`「an appeal from the modal」——本 PR 在它的 `openCaseAction` 断言里加了 `maxLength: APPEAL_MAX`——以及 `:608-626` 两个申诉用例）。

```bash
grep -rn "15 \* 60 \* 1000\|APPEAL_MAX = 500\|'待陈述'\|裁判陈述\|本地时区" src worker server/src shared
grep -rnE "WEEKLY_HEAL|回血 \+15|\+ ?15\b" src/components src/lib src/App.tsx
```

预期：第一条只剩 `shared/scoring.ts` 里 `REVOKE_WINDOW_MS`、`APPEAL_MAX` 的定义；第二条无输出（前端的回血数字只来自 `config.weeklyHeal`，没有写死 15，也没有误用 shared 的 `WEEKLY_HEAL`）。

- [ ] **手动检查**（`npm run dev:web` + 本地 worker，用测试账号；375px 用浏览器设备模拟 iPhone 尺寸，1280px 用桌面窗口）

375px：
1. 首页登录后：MyScoreLine 在待办横幅之后、「约局」之前；「82 分 · 第 N 名」一行不折断；回血那行颜色是绿色；点分数打开自己的选手页。满分账号显示「已经是满分，回血不用等。」。
2. 写说明：截止行写「截止：今天 HH:MM（还剩 N 小时 M 分）· 过期会按缺席裁决」；「立案经过」；隐私三句是 14px 正文、不是小字；输入框聚焦不放大页面（≥16px）。打几个字、等半秒，出现「草稿已存在这台设备 · 写了 N 字」；点背景不关；按 ✕ 出现原地确认，「继续写」获焦；「先离开」后刷新页面再打开同一案件，文字还在。提交说明→「确认提交？交了就不能改。」→ 确认后看到判决卡和「这次 -N。每周一 0 点回血 +X，预计下周一后回到 Y。」，点「觉得不公平？可以申诉」叠出底部抽屉。
3. 申诉抽屉：贴底、最高 92dvh、内部滚动、抓手和 ✕ 在顶部 sticky；理由框输满 500 字后不能再输；「先不申诉 / 提交申诉」两个按钮纵向排列、同宽；确认态的「再想想」获焦；提交后 toast「申诉已提交，等管理员复核。」，选手页刷新出「申诉中」。
4. 选手页（本人、已判决扣分）：卡片里 ForgivenessNote 在按钮上方占满一行，只有一个「申诉」入口；头部有回血预告。
5. 立案人刚记的加分（点名结算产生的）：按钮写「撤销 · 还剩 N 分钟」，等 30 秒数字会变；15 分钟后按钮消失，不出现 0 或负数。管理员看到的是「撤销」。
6. 记一笔 / 约一局 / 点名：勾人、写字后关闭都先原地确认（文案分别是「这笔还没提交…」「这局还没约，已选的 N 个人…」「点名还没提交…」），「先离开」后再打开内容都在；提交成功后再打开是空的。
7. 首登：选了身份、点「绑定 Discord」，回来后引导重新弹出且预选的是刚才的选项；点「稍后再说」后再打开不再预选。
8. 退出登录再用另一账号登录：上面任何草稿都不在了。

1280px：
9. AppealSheet 居中显示（不贴底），按钮横排右对齐；Esc 只关抽屉，选手页还在；关掉后焦点回到「申诉」按钮。
10. 键盘走一遍：Tab 在抽屉里循环、不跑到背后的选手页；离开确认里 Enter 落在「继续写」上，不会误离开。
11. 规则面板展开后写「每位选手每周一 0 点自动恢复 +X 分」，没有「本地时区」；动态流里待写说明的案件标签是「待说明」。
12. 有 `forced-colors`（Windows 高对比度）时 DraftNote 的「清空」、ForgivenessNote 的申诉链接仍有可见边界或下划线。

- [ ] **PR**

```bash
git push -u origin claude/p0-5-safety-net
gh pr create --base main --title "feat: 安全网：草稿、申诉、撤销倒计时、回血预告与文案（P0-5）" --body-file /tmp/p0-5-pr.md
```

PR 描述（`/tmp/p0-5-pr.md`）写：对应 spec §9 P0-5；解决 H13（大部分）、H14、M7、M15（撤销倒计时）、M16（文案）、M17、M18、M19（截止、本地时区）、M21（后半）；有意的行为变化：后端申诉理由上限 1000 → 500、「待陈述」→「待说明」、「裁判陈述」→「立案经过」、写说明提交按钮改名「提交说明」并先确认、选手页「申诉」改为打开抽屉；新增测试清单（3 个 unit 文件 / 1 个 source-hygiene 用例 / 1 个 worker 用例 / 1 条 pg 断言 / 4 个 dom 文件 / 1 个 verdict-privacy 用例）；「对契约的补充」第 14 条的文案事实性提醒，请机主拍板；375px 与 1280px 截图（写说明页、申诉抽屉、MyScoreLine、撤销倒计时）。不加任何署名行。

---

## 自查

| spec 项（§9 P0-5 及指向的条目） | 覆盖的 Task |
|---|---|
| 常量迁移 `REVOKE_WINDOW_MS`（worker、前端各一份 → shared） | Task 1 |
| 常量迁移 `APPEAL_MAX`（bot → shared，bot/网页/后端都引用） | Task 1（bot、定义）、Task 2（后端截断）、Task 10（网页 maxLength） |
| 新常量 `FILED_DM_GRACE_MS` + source-hygiene 与 SQL 一致的断言 | Task 1、Task 3 |
| 后端申诉理由截到 500 + worker 单测 | Task 2 |
| 「待陈述」→「待说明」（`CASE_STATUS_LABEL`，M16） | Task 4 |
| 「裁判陈述」→「立案经过」（VerdictCard、StatementDialog，§10 第 13 条） | Task 4 |
| M17 已撤案不显示「按缺席裁决」；verdict-privacy `:47,55,62,94` 不变 + withdrawn 用例 | Task 4 |
| 删掉 RulesPanel 的「本地时区」（M19 前半） | Task 4 |
| 撤销倒计时：从 created_at 起算、每 30 秒刷新、过期隐藏、不显示负数 | Task 5（纯函数）、Task 12（按钮） |
| 回血计算单测读 `config.weeklyHeal`（mock 为 5，不写死 15） | Task 6、Task 9、Task 12、Task 13、Task 18 |
| `MyScoreLine`「周一 0 点回血 +X → 预计 Y · 还有 N 天」，暂不显示本周变化，只给在榜的人 | Task 6、Task 9、Task 18 |
| `ForgivenessNote`（判决结果页、本人视图扣分卡） | Task 9、Task 12、Task 13 |
| 六类草稿：说明、立案、申诉、点名、发起约局、首登身份 | Task 7–8（基础）、Task 13、14、10、16、15、17 |
| 首登用 sessionStorage，其余 localStorage；提交成功或退出登录时清掉 | Task 8、Task 13–17、Task 18 |
| 有草稿时 Modal 不能点背景关闭（`dismissible`）；关闭时原地确认，不用 `window.confirm` | Task 8（useLeaveGuard）、Task 10、13、14、15、16 |
| 首登草稿只在点「绑定 Discord」时写、不增加请求（`discord-link`、`onboarding-roles` 不变）；首登不加离开确认（p8-app Esc） | Task 17 |
| AppealSheet：理由可选、上限 500、提示两句、提交前确认、toast、不写「只能申诉一次」；入口改为打开它 | Task 10、Task 12 |
| 说明提交前确认「确认提交？交了就不能改。」 | Task 13 |
| 隐私范围文案三句（M18） | Task 13 |
| 截止同时给绝对和相对时间（M19） | Task 13 |
| `StatementDialog.score`、`PlayerDetail.config` 可选 props；组件签名其余不变 | Task 12、Task 13、Task 18 |
| `DiscordLinkCard.onBeforeBind`（不 preventDefault、不改 href、不加请求） | Task 17 |
| `player-judge` 锁定文案不变、PlayerDetail 里「取消」仍唯一、不新增 GET | Task 11、Task 12（验证命令） |
| deep-link / p8-app 的深链、heading「选手」、`vc--focus`、首屏请求 URL 集合不变 | Task 4、Task 11、Task 12、Task 18（验证命令） |
| CSP：没有内联 `<style>`、没有 `style="…"` 字符串、没有 `dangerouslySetInnerHTML` | 全部新组件（只用 className 和 CSS 文件） |
| 新 CSS 遵守断点 / hover / 焦点约定（`css-conventions.test.ts`） | Task 8、9、10、12、13 |
| `tests/dom/setup.ts` 的 `afterEach` 清两个 storage | Task 8 |
| bot 的申诉上限也是 `APPEAL_MAX`（spec §1.2 第 4 条「两边都是 500」），有断言锁住 | Task 1（`case-actions.ts` 改 import、`dm.test.ts:824` 断言） |
| 不新增 `act(...)` 警告（契约 §1） | Task 8、17、18（用例都等异步请求落地后才结束） |
| 「清空」后焦点不丢；离开确认「继续写」后焦点回触发按钮 | Task 8（`useLeaveGuard`）、Task 10、13、14 |
| 机主规则：函数 < 50 行、不可变更新、无 `console.log`、无写死的魔法数 | 全部新函数 ≤ 50 行（`AppealReason`、`StatementField`、`useDraftSaving` 拆出）；状态更新一律返回新对象；`CUSTOM_TIME_LEAD_MS`（P0-6 定义、两处共用）、`CASE_EXTRA_MAX` 等具名常量 |
