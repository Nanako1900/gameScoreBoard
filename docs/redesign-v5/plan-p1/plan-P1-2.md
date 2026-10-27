# P1-2 浮层入 history 与返回键 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal：** 落实 spec §2.2 的路由规则和 §9 P1-2：浮层（sheet、居中弹窗、非路由抽屉）打开时压一条 `{edg: 1, sheet, …}` 的历史记录；浏览器返回键只关栈顶那一层；界面上关闭后历史栈回到打开前；直接打开深层地址时只在 `history.state` 没有 `edg` 标记时垫一条 `/`；刷新去掉 sheet 标记、浮层不重开、历史不变长；回到上一个地址时恢复滚动位置。

**Architecture：** 所有 history 读写仍然只在 `src/lib/router.ts`（P1-1 的 source-hygiene 锁着）。router 新增一份模块级的「浮层条目」账本（`openLayers` 打开中的浮层、`stacked` 当前路由条目上面叠着的浮层条目）、「静默后退」计数和一个写操作队列 `held`：界面关闭 → 调用方的 `onClose` 照旧**同步**执行 → 浮层失活时 `dropLayerEntry` 用 `history.go(-n)` 静默退掉自己的条目（它的 popstate 不关任何东西），在它落地之前所有 `navigate`/`goBack`/压新条目都排队。新 hook `src/lib/useHistoryLayer.ts` 把这套接到 `Modal` 的新可选 prop `historyKey` 上（`page` 形态忽略）；返回键关不掉的浮层（离开确认拦下了）靠一次重新渲染重新压条目。`bootRouter` 负责垫 `/`、去 sheet、`scrollRestoration = 'manual'`。`modalStack.ts` 不动（它管键盘，router 管返回键）。

**Tech Stack：** React 18.3（`useSyncExternalStore`）、TypeScript 5（strict）、Vite、Vitest 3（unit：`vitest.config.ts`；dom：`vitest.dom.config.ts` + jsdom + Testing Library 16 + user-event 14）。Node 24：命令前先 `export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH`。

**依赖：** P1-1（`claude/p1-1-router`）已提供：`src/lib/routes.ts`（`EdgHistoryState`、`readEdgState`、`isIndex`、`HOME_PATH`、`isAppPath`、`parseRoute`）、`src/lib/router.ts`（`useLocation`、`useRoute`、`navigate`、`goBack`、`currentPath`、`bootRouter`、`resetRouterForTests`）、`src/lib/constants.ts` 的 `// --- P1-1 ---` 小节、`tests/dom/setup.ts` 里的 `resetRouterForTests()` 与 `window.scrollTo` 桩、`tests/dom/viewport.ts` 的 `useDesktopViewport()`、`tests/unit/route.test.ts`、`tests/dom/router.test.tsx`、`tests/dom/route-pages.test.tsx`、`tests/unit/source-hygiene.test.ts` 的 `describe('history API')`、App 在首个 `useState` 初始化里调 `bootRouter()`、`RouteView` 把 `/sessions/:id` 渲染成 page（手机）/ drawer（桌面）。共享契约：本目录 `contract.md`（§2、§3、§4.2、§4.3、§4.6「Modal」、§6、§7、§8 第 1、2 条）。

**分支：** `claude/p1-2-history`，从 `claude/p1-1-router` 的 HEAD 开（`git switch -c claude/p1-2-history claude/p1-1-router`）。不 fetch、不 rebase `origin/main`、不 push、不开 PR。提交信息 `<type>: <中文描述>`，**不加任何署名行**。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `src/lib/constants.ts` | 改（末尾追加 `// --- P1-2 ---`） | `SILENT_BACK_TIMEOUT_MS = 1_000`（静默后退迟迟不回报时放行排队的写操作）、`HISTORY_SHEET_NAME_MAX = 32`（`sheet` 标记长度上限） |
| `src/lib/routes.ts` ★ | 改（只动 `EdgHistoryState`、`readEdgState`、import 行） | `EdgHistoryState` 加可选 `sheet`/`layer`/`y`；`readEdgState` 校验并保留它们，不合法的字段丢掉 |
| `src/lib/router.ts` ★ | 改（整文件替换，P1-1 的导出签名一个不改） | 浮层条目账本、`pushLayerEntry`/`dropLayerEntry`、静默后退 + `held` 队列、popstate 只关栈顶、`bootRouter` 垫 `/` 与去 sheet、push 前记 `y`（路由 push 和浮层 push 都记）、返回后恢复滚动、`simulateReloadForTests` |
| `src/lib/useHistoryLayer.ts` | 新 | Modal 用的 hook：打开时 `pushLayerEntry`，返回键 → 调用方最新的 `onClose`，没关掉就重压；失活时推迟一个微任务 `dropLayerEntry`（StrictMode 的卸载再挂载沿用同一条） |
| `src/components/Modal.tsx` ★ | 改 | 新可选 prop `historyKey?: string`，`useHistoryLayer(open && !isPage, historyKey, onCloseRef)`；其余逐字节不变 |
| `src/components/RescheduleSheet.tsx`、`AppealSheet.tsx`、`RollCallDialog.tsx`、`CaseDialog.tsx`、`StatementDialog.tsx`、`SessionFormDialog.tsx`、`OnboardingDialog.tsx`、`AdminAiPanel.tsx` | 改（每处只给自己的 `<Modal>` 加一个 `historyKey`） | `'reschedule'`、`'appeal'`、`'rollcall'`、`'case'`、`'statement'`、`'session-form'`、`'onboarding'`、`'admin-ai'` |
| `tests/dom/history.ts` | 新（测试辅助，不是测试文件） | `drainHistoryTraversals()`、`overlayMarks()`、`entryIdx()`、`preventNavigation()`（给 P1-3 用） |
| `tests/dom/setup.ts` ★ | 改 | `afterEach` 改成 `async`，第一步 `await drainHistoryTraversals()` |
| `tests/dom/back-closes-layer.test.tsx` | 新 | 19 个用例：垫 `/`、刷新不变长、刷新不重开、滚动恢复（含浮层里导航之后）、只关栈顶、界面关闭回到原位、StrictMode、导航排队、浮层内导航、只改 hash、离开确认、App 里 sheet 叠在页面/抽屉上 |
| `tests/unit/route.test.ts` | 改（末尾追加一个 `describe`，import 行加一个名字） | `readEdgState` 的 P1-2 字段，6 个用例 |
| `tests/dom/router.test.tsx`、`tests/dom/route-pages.test.tsx` | 改（P1-1 的 4 个用例，改成 P1-2 的行为，见 Task 3 Step 6） | 「不垫 `/`」是 P1-1 的行为，P1-2 按 spec 改掉了它（见「对契约的补充」第 9 条） |

不碰：`src/App.tsx`、`src/components/SessionDetailDialog.tsx`、`src/components/PlayerDetail.tsx`、`src/components/RouteView.tsx`、`src/lib/modalStack.ts`、任何 CSS。路由形态的抽屉/页面（`/sessions/:id`、`/players/:id`）**不设** `historyKey`：它们本身就是一条地址，关闭走 `goBack()`。

---

### Task 0：开工核对

**Files:** 无改动

- [ ] **Step 1：开分支，确认干净**

以下命令都在仓库根目录执行。

```bash
git switch claude/p1-1-router && git status --short   # 期望：无输出
git switch -c claude/p1-2-history claude/p1-1-router
```

上游分支不存在或 `git status --short` 有输出 → 停下，不在本 PR 里补别人的文件。

- [ ] **Step 2：核对 P1-1 交付的接口都在**

```bash
grep -nE '^export function (useLocation|useRoute|navigate|goBack|currentPath|bootRouter|resetRouterForTests)\b' src/lib/router.ts
grep -nE '^export (interface RouterLocation|interface NavigateOptions)' src/lib/router.ts
grep -nE 'export interface EdgHistoryState|export function readEdgState|^const isIndex|export const HOME_PATH|export function isAppPath|export function parseRoute' src/lib/routes.ts
grep -n "import { USER_ID_MAX } from './constants';" src/lib/routes.ts
grep -n -- '// --- P1-1 ---' src/lib/constants.ts
grep -n 'resetRouterForTests();' tests/dom/setup.ts
grep -n 'export function useDesktopViewport' tests/dom/viewport.ts
grep -n "describe('history API'" tests/unit/source-hygiene.test.ts
grep -n 'bootRouter' src/App.tsx
grep -n 'readEdgState,' tests/unit/route.test.ts   # 多行 import 里的那一行（P1-1 的写法是多行花括号）
grep -n "from '../../src/lib/constants';" tests/unit/route.test.ts
```

期望：每条都有输出（`router.ts` 7 个函数 + 2 个接口；`routes.ts` 6 项 + import 行；其余各 ≥ 1 行）。`routes.ts` 里没有 `const isIndex` 的话，Task 1 Step 3 连同 `isIndex` 一起加（那一步写了）。`routes.ts` 的 constants import 行写法不同（比如还导入了别的名字）→ Task 1 Step 3 只往那一行的花括号里加 `HISTORY_SHEET_NAME_MAX`。

再看一眼 P1-1 的 `router.ts` 有没有契约 §4.2 以外的导出：

```bash
grep -nE '^export ' src/lib/router.ts
```

期望正好是：`interface RouterLocation`、`interface NavigateOptions`、`function useLocation`、`function useRoute`、`function currentPath`、`function navigate`、`function goBack`、`function bootRouter`、`function resetRouterForTests`。多出来的导出 → 记下来，Task 3 Step 3 换文件时原样保留（放在 `// ---------------------------------------------------------------- navigation` 那一节末尾）。

- [ ] **Step 3：跑基线，记下数字**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npm run typecheck
npx vitest run --config vitest.config.ts 2>&1 | tail -4
npx vitest run --config vitest.dom.config.ts 2>&1 | tail -4
npx vitest run --config vitest.dom.config.ts 2>&1 | grep -c 'not wrapped in act'
```

期望：typecheck 通过；unit **28 个文件**全过（契约 §1：基线 26 + B1-1 的 `record-view` + P1-1 的 `route`），记用例数为 `U0`；dom **22 个文件**全过，记用例数为 `D0`；`act(...)` 警告条数记为 `A0`（契约基线是 3，都来自 `onboarding-roles`）。跨 PR 合成实测 `U0` = 363、`D0` = 264、`A0` = 3；收尾应是 28 / 369、23 / 283。文件数对不上或有失败 → 停下报告。

---

### Task 1：`history.state` 读出浮层标记与滚动位置

**Files:**
- Modify: `src/lib/constants.ts`（末尾追加）
- Modify: `src/lib/routes.ts`（`EdgHistoryState`、`readEdgState`、constants import 行）
- Test: `tests/unit/route.test.ts`（末尾追加一个 `describe`；constants import 行加一个名字）

- [ ] **Step 1：写失败的测试**

`tests/unit/route.test.ts` 顶部从 `'../../src/lib/constants'` 导入的那一行，花括号里加上 `HISTORY_SHEET_NAME_MAX`（按字母序放）。例如 P1-1 的写法是：

```ts
import { DESKTOP_MEDIA_QUERY, USER_ID_MAX } from '../../src/lib/constants';
```

改成：

```ts
import { DESKTOP_MEDIA_QUERY, HISTORY_SHEET_NAME_MAX, USER_ID_MAX } from '../../src/lib/constants';
```

`readEdgState` 已经在从 `'../../src/lib/routes'` 导入的列表里（Task 0 Step 2 核过）。然后在文件**末尾**追加：

```ts

// P1-2: the overlay marks and the scroll position on history.state (contract §4.3).
describe('readEdgState — P1-2 fields', () => {
  it('keeps a valid sheet, layer and y', () => {
    expect(readEdgState({ edg: 1, idx: 2, sheet: 'reschedule', layer: 3, y: 640 })).toEqual({
      edg: 1,
      idx: 2,
      sheet: 'reschedule',
      layer: 3,
      y: 640,
    });
  });

  it('leaves out the fields an entry does not have', () => {
    expect(readEdgState({ edg: 1, idx: 0 })).toEqual({ edg: 1, idx: 0 });
    expect(readEdgState({ edg: 1 })).toEqual({ edg: 1, idx: 0 });
  });

  it('drops a broken sheet: not a string, empty, or longer than HISTORY_SHEET_NAME_MAX', () => {
    expect(readEdgState({ edg: 1, idx: 1, sheet: 7 })).toEqual({ edg: 1, idx: 1 });
    expect(readEdgState({ edg: 1, idx: 1, sheet: '' })).toEqual({ edg: 1, idx: 1 });
    expect(readEdgState({ edg: 1, idx: 1, sheet: 'x'.repeat(HISTORY_SHEET_NAME_MAX + 1) })).toEqual({ edg: 1, idx: 1 });
    expect(readEdgState({ edg: 1, idx: 1, sheet: 'x'.repeat(HISTORY_SHEET_NAME_MAX) })?.sheet).toHaveLength(
      HISTORY_SHEET_NAME_MAX,
    );
  });

  it('drops a layer that is not a positive integer', () => {
    for (const layer of [0, -1, 1.5, '3', Number.NaN, null]) {
      expect(readEdgState({ edg: 1, idx: 1, layer })).toEqual({ edg: 1, idx: 1 });
    }
  });

  it('drops a y that is negative or not finite; 0 is kept', () => {
    for (const y of [-1, Number.POSITIVE_INFINITY, Number.NaN, '640']) {
      expect(readEdgState({ edg: 1, idx: 1, y })).toEqual({ edg: 1, idx: 1 });
    }
    expect(readEdgState({ edg: 1, idx: 1, y: 0 })).toEqual({ edg: 1, idx: 1, y: 0 });
  });

  it('still answers null for an entry the router did not write, whatever else it carries', () => {
    expect(readEdgState({ sheet: 'reschedule', layer: 3 })).toBeNull();
    expect(readEdgState({ edg: 2, idx: 1, sheet: 'reschedule' })).toBeNull();
    expect(readEdgState(null)).toBeNull();
  });
});
```

- [ ] **Step 2：跑测试，确认失败**

```bash
npx vitest run --config vitest.config.ts tests/unit/route.test.ts 2>&1 | tail -15
```

期望：新 describe 里 **3 个失败**（「keeps a valid sheet, layer and y」「drops a broken sheet…」「drops a y…」——P1-1 的 `readEdgState` 把 `sheet`/`layer`/`y` 全丢了；`HISTORY_SHEET_NAME_MAX` 还不存在，导入得到 `undefined`），其余 3 个和 P1-1 原有用例都过。

- [ ] **Step 3：实现**

(a) `src/lib/constants.ts` 末尾（`// --- P1-1 ---` 小节之后）追加：

```ts

// --- P1-2 ---
/** An overlay's silent step back whose popstate never arrives stops holding navigations after this long. */
export const SILENT_BACK_TIMEOUT_MS = 1_000;
/** The `sheet` mark on an overlay's history entry (its historyKey), kept short. */
export const HISTORY_SHEET_NAME_MAX = 32;
```

注释**不要**写成契约 §4.12 里的「A silent history.back() …」「history.state.sheet: …」：P1-1 的 source-hygiene 用正则 `history\.(?:pushState|replaceState|back\(|go\(|forward\(|state\b)` 扫 `src/` 全文（注释也扫），那两句会让 `history API` 用例失败（规划副本上实测过）。

(b) `src/lib/routes.ts` 的 constants import 行：

```ts
import { USER_ID_MAX } from './constants';
```

改成：

```ts
import { HISTORY_SHEET_NAME_MAX, USER_ID_MAX } from './constants';
```

(c) 把 `export interface EdgHistoryState { … }` 整块（从 `export interface EdgHistoryState {` 到它的 `}`）换成：

```ts
export interface EdgHistoryState {
  readonly edg: 1;
  /** 0 for the entry the tab landed on; a push is the current idx + 1; a replace keeps it. */
  readonly idx: number;
  /** P1-2: the open overlay's historyKey (≤ HISTORY_SHEET_NAME_MAX characters). */
  readonly sheet?: string;
  /** P1-2: which overlay owns this entry (a positive integer, never reused while the page lives). */
  readonly layer?: number;
  /** P1-2: scrollY when the user left this entry (finite, ≥ 0). */
  readonly y?: number;
}

```

（`idx` 那行的注释以 P1-1 原文为准，原样保留；只加下面三个字段。）

(d) 把 `readEdgState` 整个函数（含它上面那行 `/** The router's mark … */` 注释）换成下面这段。**保留** P1-1 的 `const isIndex = …`（它在 `readEdgState` 上面）；如果 Task 0 发现文件里没有 `isIndex`，就在这段最前面再加上 `const isIndex = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;`。

```ts
const isLayerId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

const isSheetName = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= HISTORY_SHEET_NAME_MAX;

const isScrollY = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

/**
 * The router's mark on a history entry, or null for an entry it did not write.
 * Only `edg === 1` decides that; a missing or broken idx reads as 0, and a
 * broken sheet / layer / y (P1-2) is left out.
 */
export function readEdgState(raw: unknown): EdgHistoryState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { edg, idx, sheet, layer, y } = raw as Record<string, unknown>;
  if (edg !== 1) return null;
  return {
    edg: 1,
    idx: isIndex(idx) ? idx : 0,
    ...(isSheetName(sheet) ? { sheet } : {}),
    ...(isLayerId(layer) ? { layer } : {}),
    ...(isScrollY(y) ? { y } : {}),
  };
}
```

- [ ] **Step 4：跑测试，确认通过**

```bash
npx vitest run --config vitest.config.ts tests/unit/route.test.ts tests/unit/source-hygiene.test.ts 2>&1 | tail -6
npm run typecheck
```

期望：两个文件全过（route.test.ts 比开工时多 6 个用例）；typecheck 通过。（用 `npm run typecheck` 而不是 `tsc -p tsconfig.json`：`tsconfig.json` 只包含 `src`、`shared`、`tests/dom`，`tests/unit/route.test.ts` 是 `tsconfig.worker.json`（`include: tests`）在检查。）

- [ ] **Step 5：提交**

```bash
git add src/lib/constants.ts src/lib/routes.ts tests/unit/route.test.ts
git commit -m "feat: history.state 读出浮层标记与滚动位置（P1-2）"
```

---

### Task 2：history 测试辅助，setup 先排空 history 遍历

**Files:**
- Create: `tests/dom/history.ts`
- Modify: `tests/dom/setup.ts`

这一步只加测试基础设施，不改行为，所以没有失败测试；验收标准是 dom 全量数字不变。

- [ ] **Step 1：新建 `tests/dom/history.ts`**

```ts
// P1-2 test helpers for the session history. Not a test file (no .test.).

/** Macrotasks jsdom needs before a queued history traversal fires popstate (it takes two; one spare). */
const TRAVERSAL_TICKS = 3;

/** Let every history.back() / go(-n) already asked for land, with its popstate. */
export async function drainHistoryTraversals(): Promise<void> {
  for (let i = 0; i < TRAVERSAL_TICKS; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** The router's marks on the current entry, without idx (tests compare idx values, never assert them). */
export function overlayMarks(): { sheet: unknown; layer: unknown } {
  const state = (window.history.state ?? {}) as { sheet?: unknown; layer?: unknown };
  return { sheet: state.sheet, layer: state.layer };
}

/** history.state.idx, for comparing two moments of one test. */
export function entryIdx(): number {
  const idx = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof idx === 'number' ? idx : -1;
}

/**
 * P1-3: clicks on any <a href> stay on the page — jsdom cannot leave the
 * document. A bubbling listener on document runs after React's root listener,
 * so the link's own onClick (saveLoginReturn) still runs. Returns the undo.
 */
export function preventNavigation(): () => void {
  const stay = (event: MouseEvent): void => {
    if (event.target instanceof Element && event.target.closest('a[href]') !== null) {
      event.preventDefault();
    }
  };
  document.addEventListener('click', stay);
  return () => document.removeEventListener('click', stay);
}
```

**不要**在这个文件里导入 `@testing-library/react`：`setup.ts` 会导入它，RTL 一被导入就注册自己的 `afterEach(cleanup)`，注册顺序一变，`setup.ts` 的 `afterEach` 就会跑在卸载之前（vitest 的 hook 是栈序）。所以带 `act` 的 `pressBack` 写在测试文件里。

- [ ] **Step 2：把 `tests/dom/setup.ts` 改成最终形态**

整文件替换为（契约 §6.3；和 P1-1 的版本相比只多了 `import { drainHistoryTraversals }`、`async`、`await drainHistoryTraversals()` 两行注释和代码、`resetRouterForTests` 那行注释、storage 那行注释）：

```ts
// toHaveValue / toBeVisible etc.
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

P1-1 如果用了 `Object.defineProperty` 写 `window.scrollTo`（契约 §6.3 允许），保留 P1-1 的写法，只改 `afterEach` 那一段。

- [ ] **Step 3：跑 dom 全量**

```bash
npx vitest run --config vitest.dom.config.ts 2>&1 | tail -4
```

期望：22 个文件、`D0` 个用例全过（和 Task 0 一样）。

- [ ] **Step 4：提交**

```bash
git add tests/dom/history.ts tests/dom/setup.ts
git commit -m "test: 新增 history 测试辅助，setup 先排空 history 遍历（P1-2）"
```

---

### Task 3：router —— 垫 `/`、刷新去 sheet、静默后退与排队、滚动恢复

**Files:**
- Modify: `src/lib/router.ts`（整文件替换）
- Create: `tests/dom/back-closes-layer.test.tsx`（本任务只写前两个 describe）
- Modify: `tests/dom/router.test.tsx`、`tests/dom/route-pages.test.tsx`（Step 6，P1-1 的 4 个用例）

- [ ] **Step 1：写失败的测试**

新建 `tests/dom/back-closes-layer.test.tsx`，内容是下面两段直接拼起来（import 区在前）：

```tsx
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootRouter, navigate, simulateReloadForTests, useLocation } from '../../src/lib/router';
import { drainHistoryTraversals } from './history';
```

```tsx

// P1-2 (spec §2.2): overlays live in the session history. The back button
// closes only the top layer; a UI close walks back over the entry; a fresh tab
// on a deep address gets one `/` underneath, once; a reload never reopens an
// overlay and never grows the history.

/** The browser's back button. The popstate's re-render happens inside act. */
async function pressBack(): Promise<void> {
  await act(async () => {
    window.history.back();
    await drainHistoryTraversals();
  });
}

/** Let a UI close's silent back land (no React work comes of it, but keep it in act). */
async function settleHistory(): Promise<void> {
  await act(async () => {
    await drainHistoryTraversals();
  });
}

/** Subscribes to the router like App does, and shows where it is. */
function Where(): JSX.Element {
  const { pathname } = useLocation();
  return <p data-testid="where">{pathname}</p>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('entering and reloading', () => {
  it('a fresh tab on a deep address gets one `/` underneath, and a reload adds nothing', async () => {
    // Arriving from an outside link: an entry the router did not write, last in the list.
    window.history.pushState(null, '', '/sessions/5');
    const length = window.history.length;
    bootRouter();
    expect(window.history.length).toBe(length + 1);
    expect(window.location.pathname).toBe('/sessions/5');

    simulateReloadForTests();
    bootRouter();
    simulateReloadForTests();
    bootRouter();
    expect(window.history.length).toBe(length + 1);
    expect(window.location.pathname).toBe('/sessions/5');

    render(<Where />);
    await pressBack();
    expect(window.location.pathname).toBe('/');
    expect(screen.getByTestId('where')).toHaveTextContent('/');
  });

  it('`/` itself is only stamped, never padded', () => {
    window.history.pushState(null, '', '/?utm=dc');
    const length = window.history.length;
    bootRouter();
    expect(window.history.length).toBe(length);
    expect(window.location.search).toBe('?utm=dc');
    expect(window.history.state).toMatchObject({ edg: 1 });
  });

  it('a reload with a sheet open drops its marks and keeps the rest', () => {
    window.history.pushState({ edg: 1, idx: 2, sheet: 'reschedule', layer: 4, y: 120 }, '', '/sessions/5');
    const length = window.history.length;
    bootRouter();
    expect(window.history.length).toBe(length);
    expect(window.location.pathname).toBe('/sessions/5');
    expect(window.history.state).toEqual({ edg: 1, idx: 2, y: 120 });
  });
});

describe('scroll restoration', () => {
  it('going back to an address scrolls to where the user left it', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo');
    window.history.replaceState(null, '', '/');
    bootRouter();
    render(<Where />);
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(640);
    act(() => navigate('/sessions/5'));
    expect(scrollTo).toHaveBeenLastCalledWith(0, 0);
    await pressBack();
    expect(screen.getByTestId('where')).toHaveTextContent('/');
    await waitFor(() => expect(scrollTo).toHaveBeenLastCalledWith(0, 640));
  });
});
```

- [ ] **Step 2：跑测试，确认失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/back-closes-layer.test.tsx 2>&1 | grep -E '✓|×|Tests '
```

期望：**3 个失败、1 个通过**——「a fresh tab on a deep address gets one `/` underneath…」失败（P1-1 只盖章不垫，且还没有 `simulateReloadForTests`）；「a reload with a sheet open drops its marks…」失败（`sheet`/`layer` 还在）；「going back to an address scrolls…」失败（没有记 `y`，`scrollTo` 最后一次是 `(0, 0)`）；「`/` itself is only stamped, never padded」已经通过（P1-1 的行为，P1-2 保持）。

- [ ] **Step 3：实现——整文件替换 `src/lib/router.ts`**

先看一眼 P1-1 的版本（`git show HEAD:src/lib/router.ts`）。下面的文件 = P1-1 规划版的全部内容 + P1-2 的追加；P1-1 的导出名、签名、注释原样保留。P1-2 相对 P1-1 只改了这些地方（P1-1 执行者若有细微偏差，按这张清单合并，不要丢 P1-1 多出来的东西）：

1. import 多了 `HISTORY_SHEET_NAME_MAX`、`SILENT_BACK_TIMEOUT_MS` 和 `type EdgHistoryState`；
2. 模块状态多了 `listening`、`lastKey`、`openLayers`、`stacked`、`nextLayerEntryId`、`silentBacks`、`silentTimer`、`held`；
3. 「地址变没变」从比较 `snapshot` 改成比较 `lastKey`（`notify()` 时更新），这样没有订阅者时也判断得对；
4. popstate 监听由 `syncListener()` 统一装卸：有订阅者、有打开的浮层、或有静默后退在途时才装，全模块仍然只有一个；
5. `onPopState` 重写：静默后退的 popstate 只记账；只改 hash（`state === null` 且地址没变）一律忽略；其余先关掉落点之上的浮层（从上往下 `onPop`），地址变了才通知订阅者并恢复滚动；
6. `navigate` 校验不变，写入改为 `whenSettled(() => applyNavigate(target, options))`；`applyNavigate` 在当前条目带浮层标记时强制 replace（浮层条目被这次导航用掉），push 前把 `scrollY` 写进当前条目的 `y`（`rememberScroll`；`pushLayerEntry` 压浮层条目之前也调它，所以「浮层里导航」用掉浮层条目之后，下面那条路由条目仍记着离开时的位置）；
7. `goBack` 包进 `whenSettled`；
8. `bootRouter` 改为垫 `/`、去掉过期的浮层标记、`scrollRestoration = 'manual'`；
9. `resetRouterForTests` 改为调用 `clearModuleState()`；新增 `simulateReloadForTests`、`pushLayerEntry`、`dropLayerEntry`、`type LayerEntryId`。

`src/lib/router.ts` 全文：

```ts
// src/lib/router.ts — the one module that drives window.history (spec §2.2;
// source-hygiene keeps it that way). Hand-written on purpose: five routes do not
// need a dependency.
//
// The address is the state: useLocation() reads window.location, cached by
// pathname + search, so a test that sets the address with replaceState before
// render() is read correctly. Every entry the router writes carries
// { edg: 1, idx }; idx > 0 means there is an entry of ours behind this one.
//
// P1-2 — overlays in history. A sheet / dialog / drawer given a historyKey owns
// one entry at the same address ({ edg, idx, sheet, layer }), so the back
// button closes it instead of leaving the page; popstate closes only what sits
// above the entry the browser landed on — normally just the top layer. Closing
// from the UI (✕, Esc, backdrop, the caller's buttons) still calls onClose
// synchronously; when the overlay goes away the router walks back over its
// entry with a silent history.go(-n) whose popstate closes nothing. Until that
// lands every other history write waits in `held`, so it never undoes one.
// A fresh tab on a deep address gets one `/` underneath; a reload pads nothing
// and never reopens an overlay. Leaving an entry remembers scrollY in `y`.

import { useSyncExternalStore } from 'react';
import { HISTORY_SHEET_NAME_MAX, SILENT_BACK_TIMEOUT_MS } from './constants';
import { HOME_PATH, isAppPath, parseRoute, readEdgState, type EdgHistoryState, type Route } from './routes';

export interface RouterLocation {
  readonly pathname: string;
  /** '' or '?…' */
  readonly search: string;
  readonly route: Route;
}

export interface NavigateOptions {
  /** Default false: pushState. */
  readonly replace?: boolean;
  /** Default false: a push scrolls to the top. Desktop drawers pass true — the lobby stays put. */
  readonly keepScroll?: boolean;
}

/** P1-2: one overlay's claim on a history entry. Positive, never reused while the page lives. */
export type LayerEntryId = number;

type Listener = () => void;

interface OpenLayer {
  readonly id: LayerEntryId;
  readonly onPop: () => void;
}

const listeners = new Set<Listener>();
let snapshot: RouterLocation | null = null;
let listening = false;
/** pathname + search the subscribers were last told about (P1-2: tracked even with no subscriber). */
let lastKey = '';

/** P1-2: overlays that asked for an entry and have not closed yet, bottom → top. */
let openLayers: readonly OpenLayer[] = [];
/** P1-2: overlay entries sitting directly on top of the current route entry, bottom → top. */
let stacked: readonly LayerEntryId[] = [];
let nextLayerEntryId: LayerEntryId = 1;
/** P1-2: popstates still owed by our own silent history.go(-n). */
let silentBacks = 0;
let silentTimer: ReturnType<typeof setTimeout> | null = null;
/** P1-2: history writes waiting for the silent back to land, oldest first. */
let held: readonly (() => void)[] = [];

const keyOf = (pathname: string, search: string): string => pathname + search;
const currentKey = (): string => keyOf(window.location.pathname, window.location.search);
const currentState = (): EdgHistoryState | null => readEdgState(window.history.state);
const currentIndex = (): number => currentState()?.idx ?? 0;

function readLocation(): RouterLocation {
  const { pathname, search } = window.location;
  if (snapshot === null || keyOf(snapshot.pathname, snapshot.search) !== keyOf(pathname, search)) {
    snapshot = { pathname, search, route: parseRoute(pathname) };
  }
  return snapshot;
}

function notify(): void {
  lastKey = currentKey();
  listeners.forEach((listener) => listener());
}

/** Did pathname + search change since the last notify? A hash-only move does not count. */
function moved(): boolean {
  return currentKey() !== lastKey;
}

// ---------------------------------------------------------------- the popstate listener

/** One window listener for the whole module, only while someone needs it (P1-2: open overlays and silent backs too). */
function syncListener(): void {
  const needed = listeners.size > 0 || openLayers.length > 0 || silentBacks > 0;
  if (needed && !listening) {
    lastKey = currentKey();
    window.addEventListener('popstate', onPopState);
    listening = true;
  } else if (!needed && listening) {
    window.removeEventListener('popstate', onPopState);
    listening = false;
  }
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  syncListener();
  return () => {
    listeners.delete(listener);
    syncListener();
  };
}

// ---------------------------------------------------------------- silent back and the queue

/** Run now, or after the silent back in flight has landed. */
function whenSettled(write: () => void): void {
  if (silentBacks === 0) {
    write();
    return;
  }
  held = [...held, write];
}

function flushHeld(): void {
  while (silentBacks === 0 && held.length > 0) {
    const [next, ...rest] = held;
    held = rest;
    next();
  }
}

function clearSilentTimer(): void {
  if (silentTimer !== null) {
    clearTimeout(silentTimer);
    silentTimer = null;
  }
}

/** A traversal that never reported back must not hold navigations forever. */
function onSilentTimeout(): void {
  silentTimer = null;
  silentBacks = 0;
  flushHeld();
  syncListener();
}

function silentBack(steps: number): void {
  silentBacks += 1;
  clearSilentTimer();
  silentTimer = setTimeout(onSilentTimeout, SILENT_BACK_TIMEOUT_MS);
  syncListener();
  window.history.go(-steps);
}

function onSilentPop(): void {
  silentBacks -= 1;
  if (silentBacks === 0) {
    clearSilentTimer();
    flushHeld();
  }
  syncListener();
  if (moved()) notify();
}

// ---------------------------------------------------------------- overlays

function isOpenLayer(id: LayerEntryId): boolean {
  return openLayers.some((layer) => layer.id === id);
}

function withoutOverlay(state: EdgHistoryState): EdgHistoryState {
  return { edg: 1, idx: state.idx, ...(state.y !== undefined ? { y: state.y } : {}) };
}

/** How many entries on top of `stacked` belong to overlays that are already closed. */
function closedOnTop(): number {
  let count = 0;
  while (count < stacked.length && !isOpenLayer(stacked[stacked.length - 1 - count])) {
    count += 1;
  }
  return count;
}

function trimClosedEntries(): void {
  const steps = closedOnTop();
  if (steps === 0) return;
  stacked = stacked.slice(0, stacked.length - steps);
  silentBack(steps);
}

/** The browser landed on `state`: every overlay above its entry closes, top first. */
function popLayersAbove(state: EdgHistoryState | null): void {
  const floor = state?.layer ?? 0;
  const popped = openLayers.filter((layer) => layer.id > floor);
  openLayers = openLayers.filter((layer) => layer.id <= floor);
  if (state !== null && state.layer !== undefined && !isOpenLayer(state.layer)) {
    // Forward onto an overlay that is gone: keep the entry, drop its overlay marks.
    window.history.replaceState(withoutOverlay(state), '', currentKey());
    stacked = [];
  } else {
    const at = stacked.indexOf(floor);
    stacked = floor === 0 ? [] : at >= 0 ? stacked.slice(0, at + 1) : [floor];
  }
  [...popped].reverse().forEach((layer) => layer.onPop());
}

/** Before any push (a route or an overlay): remember where the user was on the entry they are leaving (P1-2). */
function rememberScroll(state: EdgHistoryState | null): void {
  const y = window.scrollY;
  if (!Number.isFinite(y) || y < 0) return;
  window.history.replaceState({ ...(state ?? { edg: 1, idx: 0 }), y }, '', currentKey());
}

/** Runs after React has rendered the address the browser went back to (useSyncExternalStore renders synchronously). */
function restoreScroll(state: EdgHistoryState | null): void {
  const y = state?.y ?? 0;
  setTimeout(() => window.scrollTo(0, y), 0);
}

function onPopState(): void {
  if (silentBacks > 0) {
    onSilentPop();
    return;
  }
  const state = currentState();
  // A popstate that only moved the hash changes nothing here (spec §2.2: no hash routing).
  if (state === null && !moved()) return;
  popLayersAbove(state);
  syncListener();
  if (!moved()) return;
  notify();
  restoreScroll(state);
}

/**
 * P1-2: an overlay opened — push { edg, idx + 1, sheet, layer } at the same
 * address. `onPop` runs when the back button leaves that entry; the overlay is
 * then off the router's books, and if it stays open (a leave confirm stopped
 * it) it asks for a new entry (useHistoryLayer does).
 */
export function pushLayerEntry(name: string, onPop: () => void): LayerEntryId {
  const id = nextLayerEntryId;
  nextLayerEntryId += 1;
  openLayers = [...openLayers, { id, onPop }];
  syncListener();
  const sheet = name.slice(0, HISTORY_SHEET_NAME_MAX);
  whenSettled(() => {
    if (!isOpenLayer(id)) return;
    // A navigation from inside the overlay replaces this entry, so the page under it keeps its y here.
    rememberScroll(currentState());
    window.history.pushState({ edg: 1, idx: currentIndex() + 1, sheet, layer: id }, '', currentKey());
    stacked = [...stacked, id];
  });
  return id;
}

/** P1-2: an overlay closed from the UI — if its entry is still on top, walk back over it silently. */
export function dropLayerEntry(id: LayerEntryId): void {
  if (!isOpenLayer(id)) return;
  openLayers = openLayers.filter((layer) => layer.id !== id);
  whenSettled(trimClosedEntries);
  syncListener();
}

// ---------------------------------------------------------------- navigation

export function useLocation(): RouterLocation {
  return useSyncExternalStore(subscribe, readLocation, readLocation);
}

export function useRoute(): Route {
  return useLocation().route;
}

/** pathname + search of the current entry (LoginLink saves it, P1-3). */
export function currentPath(): string {
  return currentKey();
}

function applyNavigate(target: string, options: NavigateOptions): void {
  const replace = options.replace === true;
  if (!replace && target === currentKey()) return; // no duplicate entries
  const state = currentState();
  const idx = state?.idx ?? 0;
  const onOverlay = state?.layer !== undefined || state?.sheet !== undefined;
  // An overlay's entry is used up by the navigation; any below it are buried under the new one.
  stacked = [];
  if (replace || onOverlay) {
    window.history.replaceState({ edg: 1, idx }, '', target);
  } else {
    rememberScroll(state);
    window.history.pushState({ edg: 1, idx: idx + 1 }, '', target);
  }
  if (!replace && options.keepScroll !== true) window.scrollTo(0, 0);
  notify();
}

/** In-app paths only; /api, /auth and /link leave the SPA with a full page load. */
export function navigate(path: string, options: NavigateOptions = {}): void {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new Error('navigate 只接受站内路径');
  }
  const url = new URL(path, window.location.origin);
  if (!isAppPath(url.pathname)) {
    window.location.assign(path);
    return;
  }
  const target = keyOf(url.pathname, url.search);
  whenSettled(() => applyNavigate(target, options));
}

/** Back through our own entries; from the first one, replace with `fallback` instead of leaving the site. */
export function goBack(fallback: string = HOME_PATH): void {
  whenSettled(() => {
    if (currentIndex() > 0) {
      window.history.back();
      return;
    }
    const url = new URL(fallback, window.location.origin);
    applyNavigate(keyOf(url.pathname, url.search), { replace: true });
  });
}

/**
 * Called from App's first useState initializer; idempotent (it reads
 * history.state, not a module flag, so StrictMode and repeated renders are
 * safe). P1-2: a fresh tab on a deep address gets one `/` underneath — a
 * reload finds the mark and pads nothing; an overlay that was open before the
 * reload is not reopened, its marks are dropped.
 */
export function bootRouter(): void {
  if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
  const here = currentKey();
  const state = currentState();
  if (state === null) {
    if (window.location.pathname === HOME_PATH) {
      window.history.replaceState({ edg: 1, idx: 0 }, '', here);
    } else {
      window.history.replaceState({ edg: 1, idx: 0 }, '', HOME_PATH);
      window.history.pushState({ edg: 1, idx: 1 }, '', here);
    }
    return;
  }
  const staleLayer = state.layer !== undefined && !isOpenLayer(state.layer);
  if (staleLayer || (state.sheet !== undefined && state.layer === undefined)) {
    window.history.replaceState(withoutOverlay(state), '', here);
  }
}

// ---------------------------------------------------------------- tests only

function clearModuleState(): void {
  listeners.clear();
  window.removeEventListener('popstate', onPopState);
  listening = false;
  snapshot = null;
  lastKey = '';
  openLayers = [];
  stacked = [];
  nextLayerEntryId = 1;
  silentBacks = 0;
  clearSilentTimer();
  held = [];
}

/** Tests only (tests/dom/setup.ts): forget everything, back to '/' with no state. */
export function resetRouterForTests(): void {
  clearModuleState();
  window.history.replaceState(null, '', HOME_PATH);
}

/** Tests only: what a reload leaves behind — the module forgets everything; the URL and history.state stay. */
export function simulateReloadForTests(): void {
  clearModuleState();
}
```

- [ ] **Step 4：跑新测试，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/back-closes-layer.test.tsx 2>&1 | grep -E '✓|×|Tests '
```

期望：4 个全过。

- [ ] **Step 5：跑 P1-1 的路由测试，确认只有已知的 4 个失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/router.test.tsx tests/dom/route-pages.test.tsx 2>&1 | grep -E '×|→|Tests '
```

期望（规划副本上对着 P1-1 的规划版实测）：正好下面 4 个失败，原因都是「P1-1 不垫 `/`」这一前提被 P1-2 按 spec 改掉了：

- `router.test.tsx` › `bootRouter` › 「marks the entry the tab landed on, once」：`{ edg: 1, idx: 1 }` ≠ `{ edg: 1, idx: 0 }`；
- `router.test.tsx` › `goBack` › 「from the entry the tab landed on, replaces with the fallback…」：地址还是 `/sessions/5`（垫了 `/` 之后 idx 是 1，`goBack` 走的是异步的 `history.back()`）；
- `route-pages.test.tsx` › 「when the two ids disagree, the case's subject wins…」：`history.length` 多 1；
- `route-pages.test.tsx` › 「/cases/:id is an alias…」：`history.length` 多 1。

出现清单以外的失败 → 用 `git diff HEAD -- src/lib/router.ts` 对照 Step 3 的 9 条找差异（多半是 P1-1 执行者的版本和规划版有出入），修 router，不改测试。

- [ ] **Step 6：把这 4 个 P1-1 用例改成 P1-2 的行为**

只改前提，不删断言。

(a) `tests/dom/router.test.tsx`，`describe('bootRouter')` 里：

```ts
    window.history.replaceState(null, '', '/sessions/5?x=1');
    const before = window.history.length;
    bootRouter();
    expect(window.history.state).toEqual({ edg: 1, idx: 0 });
    expect(window.location.pathname + window.location.search).toBe('/sessions/5?x=1');
```

改成：

```ts
    // P1-2: `/` is only stamped; a deep address also gets `/` padded under it (back-closes-layer.test.tsx).
    window.history.replaceState(null, '', '/?x=1');
    const before = window.history.length;
    bootRouter();
    expect(window.history.state).toEqual({ edg: 1, idx: 0 });
    expect(window.location.pathname + window.location.search).toBe('/?x=1');
```

(b) `tests/dom/router.test.tsx`，`describe('goBack')` › 「from the entry the tab landed on…」里：

```ts
    window.history.replaceState(null, '', '/sessions/5');
    bootRouter();
    const before = window.history.length;
```

改成：

```ts
    // P1-2: bootRouter pads `/` under a fresh deep entry, so idx 0 on a deep address is set by hand here.
    window.history.replaceState({ edg: 1, idx: 0 }, '', '/sessions/5');
    const before = window.history.length;
```

(c) `tests/dom/route-pages.test.tsx` 的「when the two ids disagree…」和「/cases/:id is an alias…」两个用例里，各有一段：

```ts
    window.history.replaceState(null, '', '<地址>');
    const before = window.history.length;
    render(<App />);
```

（`<地址>` 分别是 `/players/wrong/cases/7?utm=dc` 和 `/cases/7`）都改成：

```ts
    window.history.replaceState(null, '', '<地址>');
    render(<App />);
    // P1-2: after bootRouter (which pads `/` under a fresh deep entry); the correction itself must not add one.
    const before = window.history.length;
```

`render` 里的 `bootRouter()` 是同步的（首个 `useState` 初始化函数），纠正地址的 `replace` 是之后异步发生的，所以把 `before` 挪到 `render` 之后，断言的意思（「纠正不加条目」）不变。

P1-1 执行者的用例写法若和上面不同：规则是——凡是「`state` 为 null 打开深层地址，然后断言 `history.length` 不变 / `state.idx === 0` / 点「返回」「关闭」后**同步**断言地址是 `/`」的地方，`before` 挪到 `render`/`bootRouter` 之后，同步断言地址的改成 `await waitFor(() => expect(window.location.pathname).toBe('/'))`。（P1-1 规划版的 `route-pages` 里「on a phone is a page…」「on a desktop is a drawer…」两个用例在规划副本上原样通过，不用改；P1-1 最终版新增的「on a desktop, a case that is gone says so in a drawer over the lobby; ✕ goes home」在跨 PR 合成副本上也原样通过。执行时若失败，按这条规则改。）

- [ ] **Step 7：跑 dom 全量和 unit 全量**

```bash
npx vitest run --config vitest.dom.config.ts 2>&1 | tail -4
npx vitest run --config vitest.config.ts 2>&1 | tail -4
npm run typecheck
```

期望：dom 23 个文件、`D0 + 4` 个用例全过；unit 28 个文件、`U0 + 6` 全过（含 source-hygiene 的 `history API`）；typecheck 通过。

- [ ] **Step 8：提交**

```bash
git add src/lib/router.ts tests/dom/back-closes-layer.test.tsx tests/dom/router.test.tsx tests/dom/route-pages.test.tsx
git commit -m "feat: 直接打开深层地址时垫一条 /，刷新去掉浮层标记，返回时恢复滚动（P1-2）"
```

---

### Task 4：`Modal` 的 `historyKey` 与 `useHistoryLayer`

**Files:**
- Create: `src/lib/useHistoryLayer.ts`
- Modify: `src/components/Modal.tsx`
- Test: `tests/dom/back-closes-layer.test.tsx`（换 import 区，末尾追加）

- [ ] **Step 1：写失败的测试**

把 `tests/dom/back-closes-layer.test.tsx` 顶部的 import 区（Task 3 写的那 4 行）整体换成：

```tsx
import { StrictMode, useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Modal } from '../../src/components/Modal';
import { bootRouter, navigate, simulateReloadForTests, useLocation } from '../../src/lib/router';
import { drainHistoryTraversals, entryIdx, overlayMarks } from './history';
```

然后在文件**末尾**追加：

```tsx

// ---------------------------------------------------------------- overlays (P1-2 Modal historyKey)

/** A dialog with a sheet on top of it, both in history. */
function TwoLayers(): JSX.Element {
  const [outer, setOuter] = useState(false);
  const [inner, setInner] = useState(false);
  return (
    <>
      <Where />
      <button type="button" onClick={() => setOuter(true)}>
        打开外层
      </button>
      <Modal open={outer} onClose={() => setOuter(false)} labelledBy="outer-title" historyKey="outer">
        <h2 id="outer-title">外层</h2>
        <button type="button" onClick={() => setInner(true)}>
          打开内层
        </button>
        <Modal
          open={inner}
          onClose={() => setInner(false)}
          labelledBy="inner-title"
          variant="sheet"
          title="内层"
          historyKey="inner"
        >
          <p>内层内容</p>
        </Modal>
      </Modal>
    </>
  );
}

/** `/` as a fresh tab: stamped, nothing behind it. Returns its idx to compare with later. */
function stampHome(): number {
  window.history.replaceState(null, '', '/');
  bootRouter();
  return entryIdx();
}

describe('the back button and overlays', () => {
  it('closes only the top layer, then the next one', async () => {
    const user = userEvent.setup();
    const before = stampHome();
    render(<TwoLayers />);
    await user.click(screen.getByRole('button', { name: '打开外层' }));
    await user.click(screen.getByRole('button', { name: '打开内层' }));
    expect(overlayMarks().sheet).toBe('inner');

    await pressBack();
    expect(screen.queryByRole('dialog', { name: '内层' })).toBeNull();
    expect(screen.getByRole('dialog', { name: '外层' })).toBeInTheDocument();
    expect(overlayMarks().sheet).toBe('outer');

    await pressBack();
    expect(screen.queryByRole('dialog', { name: '外层' })).toBeNull();
    expect(overlayMarks()).toEqual({ sheet: undefined, layer: undefined });
    expect(entryIdx()).toBe(before);
    expect(window.location.pathname).toBe('/');
  });

  it('a UI close is synchronous and leaves the history where it was before the open', async () => {
    const user = userEvent.setup();
    const before = stampHome();
    render(<TwoLayers />);
    await user.click(screen.getByRole('button', { name: '打开外层' }));
    expect(entryIdx()).toBe(before + 1);

    await user.keyboard('{Escape}');
    // Closed at once — not after a popstate (organizer-actions, appeal-sheet, modal-focus rely on it).
    expect(screen.queryByRole('dialog', { name: '外层' })).toBeNull();
    await settleHistory();
    expect(entryIdx()).toBe(before);
    expect(overlayMarks()).toEqual({ sheet: undefined, layer: undefined });

    // ✕ works the same way, and nothing is left behind for a later back press.
    await user.click(screen.getByRole('button', { name: '打开外层' }));
    await user.click(screen.getByRole('button', { name: '关闭' }));
    await settleHistory();
    expect(entryIdx()).toBe(before);
  });

  it('closing both layers from the UI walks back over both entries', async () => {
    const user = userEvent.setup();
    const before = stampHome();
    render(<TwoLayers />);
    await user.click(screen.getByRole('button', { name: '打开外层' }));
    await user.click(screen.getByRole('button', { name: '打开内层' }));
    expect(entryIdx()).toBe(before + 2);
    await user.keyboard('{Escape}');
    await settleHistory();
    expect(entryIdx()).toBe(before + 1);
    expect(overlayMarks().sheet).toBe('outer');
    await user.keyboard('{Escape}');
    await settleHistory();
    expect(entryIdx()).toBe(before);
  });

  it('StrictMode: one open is one entry', async () => {
    const user = userEvent.setup();
    const before = stampHome();
    render(
      <StrictMode>
        <TwoLayers />
      </StrictMode>,
    );
    await user.click(screen.getByRole('button', { name: '打开外层' }));
    await settleHistory();
    expect(entryIdx()).toBe(before + 1);
    expect(overlayMarks().sheet).toBe('outer');
    await pressBack();
    expect(screen.queryByRole('dialog', { name: '外层' })).toBeNull();
    expect(entryIdx()).toBe(before);
  });

  it('a navigation right after a UI close waits for the silent back, so the overlay entry is gone', async () => {
    const user = userEvent.setup();
    const before = stampHome();
    render(<TwoLayers />);
    await user.click(screen.getByRole('button', { name: '打开外层' }));
    await user.keyboard('{Escape}');
    act(() => navigate('/sessions/5'));
    await settleHistory();
    expect(window.location.pathname).toBe('/sessions/5');
    expect(entryIdx()).toBe(before + 1);
    await pressBack();
    expect(window.location.pathname).toBe('/');
    expect(screen.getByTestId('where')).toHaveTextContent('/');
  });

  it('a navigation from inside an overlay uses its entry up instead of stacking on it', async () => {
    const user = userEvent.setup();
    const before = stampHome();
    render(<TwoLayers />);
    await user.click(screen.getByRole('button', { name: '打开外层' }));
    act(() => navigate('/sessions/5'));
    expect(entryIdx()).toBe(before + 1);
    expect(overlayMarks()).toEqual({ sheet: undefined, layer: undefined });
    await user.keyboard('{Escape}');
    await settleHistory();
    // No silent back: it would have undone the navigation.
    expect(window.location.pathname).toBe('/sessions/5');
    await pressBack();
    expect(window.location.pathname).toBe('/');
  });

  it('the scroll under an overlay survives a navigation from inside it', async () => {
    const user = userEvent.setup();
    const scrollTo = vi.spyOn(window, 'scrollTo');
    stampHome();
    render(<TwoLayers />);
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(640);
    await user.click(screen.getByRole('button', { name: '打开外层' }));
    act(() => navigate('/sessions/5'));
    expect(scrollTo).toHaveBeenLastCalledWith(0, 0);
    await user.keyboard('{Escape}');
    await pressBack();
    expect(screen.getByTestId('where')).toHaveTextContent('/');
    await waitFor(() => expect(scrollTo).toHaveBeenLastCalledWith(0, 640));
  });

  it('a hash-only change closes nothing', async () => {
    const user = userEvent.setup();
    stampHome();
    render(<TwoLayers />);
    await user.click(screen.getByRole('button', { name: '打开外层' }));
    await act(async () => {
      window.location.hash = '#x';
      await drainHistoryTraversals();
    });
    expect(screen.getByRole('dialog', { name: '外层' })).toBeInTheDocument();
  });

  it('a reload with an overlay open does not reopen it', () => {
    window.history.pushState({ edg: 1, idx: 1, sheet: 'outer', layer: 1 }, '', '/');
    bootRouter();
    render(<TwoLayers />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(overlayMarks()).toEqual({ sheet: undefined, layer: undefined });
  });
});
```

- [ ] **Step 2：跑测试，确认失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/back-closes-layer.test.tsx 2>&1 | grep -E '✓|×|Tests '
```

期望：**4 个失败、9 个通过**（规划副本实测）。失败的是「closes only the top layer, then the next one」「a UI close is synchronous…」「closing both layers from the UI…」「StrictMode: one open is one entry」——`historyKey` 还不是 Modal 的 prop，被忽略：没有浮层条目，`overlayMarks().sheet` 是 `undefined`、`entryIdx()` 不变、返回键不关浮层。另外 5 个新用例（两个导航用例、「the scroll under an overlay survives…」、hash、刷新不重开）在没有浮层条目时也成立，和 Task 3 的 4 个一起通过；它们锁的是「加了条目之后不能变坏」，Step 4 里会再跑一遍。

- [ ] **Step 3：实现**

(a) 新建 `src/lib/useHistoryLayer.ts`：

```ts
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { dropLayerEntry, pushLayerEntry, type LayerEntryId } from './router';

/** The entry this overlay owns; `releasing` while a drop waits one microtask (StrictMode may take it back). */
interface HeldEntry {
  readonly id: LayerEntryId;
  readonly releasing: boolean;
}

/**
 * P1-2 (spec §2.2): while `active` and `name` is set, the overlay owns one
 * history entry, so the back button closes it.
 *
 * - Back button: the router calls onPop → the caller's latest onClose (a leave
 *   confirm may stop it). `pops` re-runs the effect: still open → a new entry,
 *   so the next back press lands on this overlay again; closed → nothing.
 * - UI close (✕, Esc, backdrop, the caller's buttons): onClose already ran;
 *   when `active` drops, the entry is released one microtask later and the
 *   router walks back over it silently. A StrictMode unmount → remount in
 *   between takes the same entry back, so one open leaves one entry.
 */
export function useHistoryLayer(
  active: boolean,
  name: string | undefined,
  onCloseRef: MutableRefObject<() => void>,
): void {
  const [pops, setPops] = useState(0);
  const heldRef = useRef<HeldEntry | null>(null);
  const enabled = active && name !== undefined;

  useEffect(() => {
    if (!enabled || name === undefined) return undefined;
    const current = heldRef.current;
    if (current !== null) {
      heldRef.current = { id: current.id, releasing: false };
    } else {
      const id = pushLayerEntry(name, () => {
        heldRef.current = null;
        setPops((n) => n + 1);
        onCloseRef.current();
      });
      heldRef.current = { id, releasing: false };
    }
    return () => releaseLater(heldRef);
    // `enabled` and `pops` only: like useLayer, a re-render must not push again; `name` is fixed per caller.
  }, [enabled, pops]);
}

function releaseLater(heldRef: MutableRefObject<HeldEntry | null>): void {
  const mine = heldRef.current;
  if (mine === null) return;
  heldRef.current = { id: mine.id, releasing: true };
  queueMicrotask(() => {
    const now = heldRef.current;
    if (now !== null && now.id === mine.id && now.releasing) {
      heldRef.current = null;
      dropLayerEntry(mine.id);
    }
  });
}
```

(b) `src/components/Modal.tsx`，四处：

import 区，在

```ts
} from '../lib/modalStack';
import './modal.css';
```

中间插一行，变成：

```ts
} from '../lib/modalStack';
import { useHistoryLayer } from '../lib/useHistoryLayer';
import './modal.css';
```

`interface ModalProps` 里，在 `title?: React.ReactNode;` 之后、`}` 之前加：

```ts
  /** P1-2: set → while open, the layer owns a history entry and the back button calls onClose. Ignored by variant="page". */
  historyKey?: string;
```

`export function Modal({` 的解构参数里，`title,` 之后加一行 `historyKey,`：

```ts
  title,
  historyKey,
}: ModalProps): JSX.Element | null {
```

函数体里，锚点 `usePageFocus(open && isPage, labelledBy, pageRef);` 之后加一行：

```ts
  usePageFocus(open && isPage, labelledBy, pageRef);
  useHistoryLayer(open && !isPage, historyKey, onCloseRef);
```

其余（legacy center 的 markup、`useLayer`、每个打开的 Modal 只装一次 document keydown 监听）一个字不改。`useHistoryLayer` 不装任何 document/window 监听（popstate 由 router 统一装在 window 上）。

- [ ] **Step 4：跑测试，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/back-closes-layer.test.tsx tests/dom/modal-focus.test.tsx tests/dom/modal-stack.test.tsx 2>&1 | grep -E '×|Tests '
```

期望：全过；`back-closes-layer` 13 个用例。（「the scroll under an overlay survives…」此时才真正锁住 Task 3 里 `pushLayerEntry` 的 `rememberScroll`：去掉那一行，它会以 `scrollTo` 最后一次是 `(0, 0)` 失败——规划副本实测。）

- [ ] **Step 5：提交**

```bash
git add src/lib/useHistoryLayer.ts src/components/Modal.tsx tests/dom/back-closes-layer.test.tsx
git commit -m "feat: Modal 新增 historyKey，浮层入 history，返回键只关栈顶（P1-2）"
```

---

### Task 5：八个浮层接上返回键

**Files:**
- Modify: `src/components/RescheduleSheet.tsx`、`src/components/AppealSheet.tsx`、`src/components/RollCallDialog.tsx`、`src/components/CaseDialog.tsx`、`src/components/StatementDialog.tsx`、`src/components/SessionFormDialog.tsx`、`src/components/OnboardingDialog.tsx`、`src/components/AdminAiPanel.tsx`
- Test: `tests/dom/back-closes-layer.test.tsx`（换 import 区，末尾追加）

- [ ] **Step 1：写失败的测试**

把 `tests/dom/back-closes-layer.test.tsx` 顶部的 import 区（Task 4 写的那 7 行）整体换成：

```tsx
import { StrictMode, useState } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { AppealSheet } from '../../src/components/AppealSheet';
import { Modal } from '../../src/components/Modal';
import { bootRouter, navigate, simulateReloadForTests, useLocation } from '../../src/lib/router';
import type { RecordItem, SessionDetail, User } from '../../src/types';
import { drainHistoryTraversals, entryIdx, overlayMarks } from './history';
import { useDesktopViewport } from './viewport';
```

然后在文件**末尾**追加：

```tsx

// ---------------------------------------------------------------- a leave confirm (AppealSheet, historyKey 'appeal')

describe('a leave confirm and the back button', () => {
  const RECORD: RecordItem = {
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
    statement: null,
    statement_at: null,
    appeal_reason: null,
    deadline_at: null,
    status: 'decided',
    verdict: { source: 'ai', headline: '情有可原', reasoning: '', factors: [] },
    range: { min: -9, max: -3, base: -6 },
    created_at: '2026-10-26 09:00:00',
    redacted: false,
  };
  const LEAVE = '申诉理由会留在这台设备上，下次回来接着写。';

  it('back asks first; after 继续写 the next back asks again instead of leaving', async () => {
    const user = userEvent.setup();
    const before = stampHome();
    const onClose = vi.fn();
    render(<AppealSheet record={RECORD} onClose={onClose} onAppealed={() => {}} />);
    await user.type(screen.getByRole('textbox', { name: /为什么觉得判得不对/ }), '判重了');
    expect(entryIdx()).toBe(before + 1);

    await pressBack();
    const leave = screen.getByRole('group', { name: LEAVE });
    expect(within(leave).getByRole('button', { name: '继续写' })).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();
    // Stopped by the confirm: the sheet owns the top entry again.
    expect(overlayMarks().sheet).toBe('appeal');
    expect(entryIdx()).toBe(before + 1);

    await user.click(within(leave).getByRole('button', { name: '继续写' }));
    await pressBack();
    expect(screen.getByRole('group', { name: LEAVE })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '申诉这一起' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '先离开' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------- the app (P1-1 routes + P1-2 history)

interface Call {
  method: string;
  path: string;
}

function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, text: () => Promise.resolve(JSON.stringify(body)) } as Response;
}

/** Unrouted requests answer 500, so an unexpected one shows up. */
function mockFetch(routes: Record<string, () => Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = url.replace(/^https?:\/\/[^/]+/, '');
      const method = init?.method ?? 'GET';
      calls.push({ method, path });
      const route = routes[`${method} ${path}`];
      return Promise.resolve(route ? route() : json(500, { error: `unrouted ${method} ${path}` }));
    }),
  );
  return calls;
}

const DAY_MS = 86_400_000;
const ORGANIZER: User = {
  id: 'org',
  username: '组织者',
  oauth_username: 'org',
  avatar_url: null,
  is_participant: true,
  is_judge: false,
  is_admin: false,
  score: 100,
  created_at: '2026-10-01 00:00:00',
};

function session(): SessionDetail {
  return {
    id: 1,
    organizer: { id: 'org', username: '组织者', avatar_url: null },
    title: '周五五排',
    game: null,
    // Tomorrow, so 改时间 is offered whatever the machine's clock says.
    starts_at: new Date(Date.now() + DAY_MS).toISOString(),
    duration_min: null,
    capacity: null,
    note: null,
    status: 'open',
    settled_at: null,
    created_at: '2026-10-27 00:00:00',
    counts: { invited: 0, going: 1, maybe: 0, out: 0 },
    my_rsvp: 'going',
    players: [],
  };
}

function appRoutes(): Record<string, () => Response> {
  return {
    'GET /api/config': () =>
      json(200, {
        violations: [],
        tiers: [],
        weeklyHeal: 5,
        weeklyBonusCap: 5,
        statementWindowHours: 24,
        aiEnabled: false,
        maxBatchSubjects: 5,
        nextResetAt: '2026-11-02T00:00:00.000Z',
      }),
    'GET /api/leaderboard': () => json(200, { participants: [] }),
    'GET /api/records?limit=50': () => json(200, { records: [] }),
    'GET /api/me': () => json(200, { user: ORGANIZER, pending: { statements: 0, appeals: 0 } }),
    'GET /api/me/invites': () => json(200, { sessions: [] }),
    'GET /api/report/latest': () => json(200, { report: null }),
    'GET /api/sessions?scope=upcoming': () => json(200, { sessions: [] }),
    'GET /api/sessions/1': () => json(200, { session: session(), records: [] }),
  };
}

const writes = (calls: Call[]): Call[] => calls.filter((c) => c.method !== 'GET');

/** /sessions/1 opened straight from an outside link (state null), as the organizer. */
async function openSessionFromOutside(): Promise<{ calls: Call[]; unmount: () => void }> {
  const calls = mockFetch(appRoutes());
  window.history.pushState(null, '', '/sessions/1');
  const { unmount } = render(<App />);
  expect(await screen.findByRole('heading', { name: '周五五排' })).toBeInTheDocument();
  return { calls, unmount };
}

async function backToLobbyAndCheck(): Promise<void> {
  await pressBack();
  expect(window.location.pathname).toBe('/');
  expect(await screen.findByRole('heading', { name: /约局/ })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: '周五五排' })).toBeNull();
}

describe('App — overlays over a routed page', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('phone: back closes 改时间 only, the next back leaves /sessions/1 for the padded `/`', async () => {
    const user = userEvent.setup();
    const { calls } = await openSessionFromOutside();
    await user.click(await screen.findByRole('button', { name: '改时间' }));
    expect(screen.getByRole('dialog', { name: '改到什么时候？' })).toBeInTheDocument();
    expect(overlayMarks().sheet).toBe('reschedule');

    await pressBack();
    expect(screen.queryByRole('dialog', { name: '改到什么时候？' })).toBeNull();
    expect(screen.getByRole('heading', { name: '周五五排' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/sessions/1');

    await backToLobbyAndCheck();
    expect(writes(calls)).toEqual([]);
  });

  it('desktop: the same over the drawer', async () => {
    useDesktopViewport();
    const user = userEvent.setup();
    await openSessionFromOutside();
    await user.click(await screen.findByRole('button', { name: '改时间' }));
    await pressBack();
    expect(screen.queryByRole('dialog', { name: '改到什么时候？' })).toBeNull();
    expect(screen.getByRole('heading', { name: '周五五排' })).toBeInTheDocument();
    await backToLobbyAndCheck();
  });

  it('closing 改时间 with 先不改 leaves one back press to the lobby', async () => {
    const user = userEvent.setup();
    await openSessionFromOutside();
    await user.click(await screen.findByRole('button', { name: '改时间' }));
    await user.click(screen.getByRole('button', { name: '先不改' }));
    expect(screen.queryByRole('dialog', { name: '改到什么时候？' })).toBeNull();
    await settleHistory();
    expect(overlayMarks()).toEqual({ sheet: undefined, layer: undefined });
    await backToLobbyAndCheck();
  });

  it('a reload does not grow the history: still one back press to the lobby', async () => {
    let { unmount } = await openSessionFromOutside();
    const length = window.history.length;
    for (let reload = 0; reload < 3; reload += 1) {
      unmount();
      simulateReloadForTests();
      ({ unmount } = render(<App />));
      expect(await screen.findByRole('heading', { name: '周五五排' })).toBeInTheDocument();
    }
    expect(window.history.length).toBe(length);
    expect(window.location.pathname).toBe('/sessions/1');
    await backToLobbyAndCheck();
  });

  it('a reload with 改时间 open does not reopen it', async () => {
    mockFetch(appRoutes());
    window.history.pushState({ edg: 1, idx: 1, sheet: 'reschedule', layer: 3 }, '', '/sessions/1');
    render(<App />);
    expect(await screen.findByRole('heading', { name: '周五五排' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '改时间' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '改到什么时候？' })).toBeNull();
    expect(overlayMarks()).toEqual({ sheet: undefined, layer: undefined });
    expect(window.location.pathname).toBe('/sessions/1');
  });
});
```

App 那一组依赖 P1-1 的接线：`/sessions/1` 在手机上是 page、桌面上是 drawer，标题是 `h2`「周五五排」，组织者能看到「改时间」，回到 `/` 后大厅的 /约局/ 标题可见。P1-1 执行者的选择器若和这里不同（比如登录后首屏多一个请求），只改 `appRoutes()` 和选择器，history 的断言一条都不改。

- [ ] **Step 2：跑测试，确认失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/back-closes-layer.test.tsx 2>&1 | grep -E '✓|×|Tests '
```

期望：正好这 3 个失败（规划副本实测，16 个通过）——「back asks first; after 继续写…」（AppealSheet 还没有 `historyKey`，返回键不弹确认）、「phone: back closes 改时间 only…」（`overlayMarks().sheet` 不是 `'reschedule'`）、「desktop: the same over the drawer」（返回键直接离开了 `/sessions/1`）；Task 3、4 的 13 个照常通过。

- [ ] **Step 3：实现——每个文件只给自己的 `<Modal>` 加一个 `historyKey`**

`src/components/RescheduleSheet.tsx`：

```tsx
    <Modal open onClose={onClose} labelledBy="reschedule-title" variant="sheet" title="改到什么时候？">
```

→

```tsx
    <Modal open onClose={onClose} labelledBy="reschedule-title" variant="sheet" title="改到什么时候？" historyKey="reschedule">
```

`src/components/AppealSheet.tsx`（锚点是这一行的结尾 `variant="sheet" size="md" dismissible={!draft.dirty}>`，B1-1 若改了这一行的其他部分，保留 B1-1 的）：

```tsx
    <Modal open onClose={requestClose} labelledBy={TITLE_ID} title="申诉这一起" variant="sheet" size="md" dismissible={!draft.dirty}>
```

→

```tsx
    <Modal open onClose={requestClose} labelledBy={TITLE_ID} title="申诉这一起" variant="sheet" size="md" dismissible={!draft.dirty} historyKey="appeal">
```

`src/components/RollCallDialog.tsx`：

```tsx
    <Modal open={open} onClose={requestClose} labelledBy="rollcall-title" size="lg" dismissible={!draft.dirty}>
```

→

```tsx
    <Modal open={open} onClose={requestClose} labelledBy="rollcall-title" size="lg" dismissible={!draft.dirty} historyKey="rollcall">
```

`src/components/CaseDialog.tsx`：

```tsx
    <Modal open={open} onClose={guard.requestClose} labelledBy="case-dialog-title" size="md" dismissible={!draft.dirty}>
```

→

```tsx
    <Modal open={open} onClose={guard.requestClose} labelledBy="case-dialog-title" size="md" dismissible={!draft.dirty} historyKey="case">
```

`src/components/StatementDialog.tsx`（多行写法，锚点 `dismissible={outcome !== null || !draft.dirty}`）：

```tsx
        dismissible={outcome !== null || !draft.dirty}
      >
```

→

```tsx
        dismissible={outcome !== null || !draft.dirty}
        historyKey="statement"
      >
```

`src/components/SessionFormDialog.tsx`：

```tsx
    <Modal open={open} onClose={guard.requestClose} labelledBy="session-form-title" size="md" dismissible={!draft.dirty}>
```

→

```tsx
    <Modal open={open} onClose={guard.requestClose} labelledBy="session-form-title" size="md" dismissible={!draft.dirty} historyKey="session-form">
```

`src/components/OnboardingDialog.tsx`：

```tsx
    <Modal open={open} onClose={dismiss} labelledBy="onboarding-title" size="md">
```

→

```tsx
    <Modal open={open} onClose={dismiss} labelledBy="onboarding-title" size="md" historyKey="onboarding">
```

`src/components/AdminAiPanel.tsx`：

```tsx
    <Modal open={open} onClose={onClose} labelledBy="admin-ai-title" size="lg">
```

→

```tsx
    <Modal open={open} onClose={onClose} labelledBy="admin-ai-title" size="lg" historyKey="admin-ai">
```

改完核对正好 8 处：

```bash
grep -rn 'historyKey="' src/components | wc -l   # 期望 8
grep -rn 'historyKey' src/components/SessionDetailDialog.tsx src/components/PlayerDetail.tsx src/components/RouteView.tsx   # 期望无输出
```

- [ ] **Step 4：跑测试，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/back-closes-layer.test.tsx 2>&1 | grep -E '×|Tests '
npx vitest run --config vitest.dom.config.ts tests/dom/organizer-actions.test.tsx tests/dom/appeal-sheet.test.tsx tests/dom/drafts.test.tsx tests/dom/p8-app.test.tsx tests/dom/deep-link.test.tsx tests/dom/onboarding-roles.test.tsx tests/dom/player-judge.test.tsx tests/dom/discord-link.test.tsx 2>&1 | grep -E '×|Tests '
```

期望：`back-closes-layer` 19 个全过；其余 8 个文件原样全过（契约 §7 锁住的 `organizer-actions:212-220` 的 Esc 同步关闭、`appeal-sheet:140-167` 的离开确认、`drafts` 的 Esc、`p8-app:133-144` 的「首登对话框 Esc 之后才出现选手」都在里面——后者的跳转发生在 OnboardingDialog 的静默后退落地之后（规划副本上加临时打印实测：先 `go(-1)`，再 push `/players/p/cases/7`）；若别的调用方让跳转先于静默后退执行，走的是「浮层条目被导航用掉」，两种顺序最后的历史都是 `[/, 目标]`）。

- [ ] **Step 5：提交**

```bash
git add src/components/RescheduleSheet.tsx src/components/AppealSheet.tsx src/components/RollCallDialog.tsx src/components/CaseDialog.tsx src/components/StatementDialog.tsx src/components/SessionFormDialog.tsx src/components/OnboardingDialog.tsx src/components/AdminAiPanel.tsx tests/dom/back-closes-layer.test.tsx
git commit -m "feat: 八个浮层接上返回键，返回只关栈顶（P1-2）"
```

---

## 收尾

- [ ] **全量验证**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npm run typecheck
npx vitest run --config vitest.config.ts 2>&1 | tail -4
npx vitest run --config vitest.dom.config.ts 2>&1 | tail -4
npx vitest run --config vitest.dom.config.ts 2>&1 | grep -c 'not wrapped in act'
npm run build:pages
ls dist
```

期望：

| 项 | 开工时（Task 0） | 收尾 |
|---|---|---|
| unit | 28 个文件 / `U0` | 28 个文件 / `U0 + 6` |
| dom | 22 个文件 / `D0` | **23** 个文件 / `D0 + 19` |
| `act(...)` 警告 | `A0`（3） | `A0`，不增加 |
| typecheck、build:pages | 通过 | 通过；`dist/` 只有 `index.html`、`assets/` 和 headers 脚本生成的 `_headers`，没有 `404.html` |

（worker 套件 P1-2 不碰后端，不必跑；PG/server 套件本地不跑。）

- [ ] **卫生检查**

```bash
grep -rnE 'history\.(pushState|replaceState|back\(|go\(|forward\(|state\b)' src | grep -v '^src/lib/router.ts'   # 期望无输出
grep -rn 'console\.log' src/lib/router.ts src/lib/useHistoryLayer.ts src/components/Modal.tsx   # 期望无输出
wc -l src/lib/router.ts src/lib/useHistoryLayer.ts src/components/Modal.tsx tests/dom/back-closes-layer.test.tsx   # 都 < 800（规划副本：约 375 / 60 / 335 / 505）
git log --oneline claude/p1-1-router..HEAD   # 期望 5 个提交，信息里没有署名行
```

- [ ] **手动检查（有浏览器时做；做不到就在提交说明里写「未手动验证，留给 P1-5」）**

`npm run dev`，Chrome DevTools 设备模式 375×812：

1. 新标签页直接打开 `http://localhost:5173/sessions/<一个存在的 id>` → 返回键回到大厅；再按一次才离开站点。在 `/sessions/<id>` 上刷新 3 次 → 返回键仍然一次就到大厅。
2. 以组织者身份在详情页点「改时间」→ 返回键只关 sheet，地址不变；再按一次回到大厅，滚动位置是离开时的位置。
3. 「改时间」开着时刷新 → sheet 不重开；按一次返回，页面看起来没变（spec 接受的代价），再按一次回到大厅。
4. 在一局里写一半申诉（选手页 → 申诉）→ 返回键 → 出现离开确认；点「继续写」再按返回 → 仍是离开确认。
5. 1280×800：`/sessions/<id>` 是右侧抽屉；抽屉上开「改时间」→ 返回键只关 sheet；✕ 关抽屉回到大厅。
6. 大厅滚到一半 → 点「组一局」（打开发起约局的对话框）→ 建好一局（落到 `/sessions/<新 id>`）→ 返回键 → 大厅回到离开时的位置。
7. Chrome（桌面或 Android）新标签页打开 `/sessions/<id>`，**不点页面任何地方**直接按返回：Chrome 的「history manipulation intervention」可能把没有用户激活时垫的 `/` 当成可跳过的条目，直接离开站点。先点一下页面再按返回 → 应回到大厅。两种结果都如实记进 P1-5 的「发现与修复」表（前者是浏览器策略，预期「接受」）。

真机项（iOS Safari、Android Chrome 的系统返回、手势返回）属于 P1-5，由领队按 `docs/redesign-v5/p1-acceptance.md` 做，本 PR 不做。上面第 6、7 条已收进 P1-4 的验收清单（第 7 条是 M-28，第 6 条是可选的 M-29），这里做不到的留给 P1-5。

---

## 对契约的补充

以下是契约 §4.2 / §4.6 没写死、或写法在实现上需要调整的地方，已在规划副本（P1-1 规划版 + 本计划）上实测通过。写进 PR 描述，请机主过目。

1. **返回键被离开确认拦下时的「重新压一条」不靠微任务探测，靠一次重新渲染。** 契约 §4.6 写的是「下一个微任务里仍 open 就重新压」。React 18 里 popstate 引起的更新什么时候提交取决于事件优先级，用微任务判断「关没关」不可靠。改为：router 在 popstate 时把该浮层从账本上移除并调用它的 `onPop`；`useHistoryLayer` 的 `onPop` 先 `setPops(n + 1)` 再调调用方的 `onClose`。两次 setState 在同一批里提交：浮层关了 → effect 不再运行；没关（确认层、`RollCallDialog` 忙时 `requestClose` 不响应）→ effect 因 `pops` 变化重新运行，压一条新条目。不依赖时序，结果与契约要求一致（`back-closes-layer` 的「back asks first; after 继续写…」锁住）。
2. **排队（`held`）覆盖所有 history 写操作，不只是 `navigate`。** 静默后退在途时，`pushLayerEntry` 的 `pushState`、`dropLayerEntry` 的 `go(-n)`、`goBack` 的 `back()` 也一起排队，按顺序在 popstate（或 `SILENT_BACK_TIMEOUT_MS` 超时）之后执行。否则「关一个浮层马上开另一个」时，浏览器会先压新条目、再执行旧的后退，把新条目退掉。浮层的登记（`openLayers`）是同步的，只有写 history 那一步排队；排队期间浮层又关了，它的 `pushState` 直接跳过。
3. **静默后退用 `history.go(-n)`，一次退掉栈顶所有已关闭浮层的条目。** 两层一起卸载时（比如 `StatementDialog` 带着它的 `AppealSheet` 一起关，React 先跑外层的清理），只退一条会留下一条孤儿。router 记着「当前路由条目上面叠着哪些浮层条目」（`stacked`），每次关闭后数栈顶连续几条已经关掉，一次退那么多步；下层先关、上层还开着时先不退，等上层关时一起退。
4. **popstate 监听在「有订阅者、有打开的浮层、或有静默后退在途」时都装着**（契约只说「有订阅者时装」）。不然单独渲染的浮层（`organizer-actions`、`appeal-sheet` 测试，以及将来不经过 App 的用法）收不到返回键，静默后退也没人记账。全模块仍然只有一个 window 监听，Modal 不装任何新监听（`modal-focus:63-75` 照样通过）。
5. **「地址变没变」改为和 `lastKey`（上次通知订阅者时的 pathname + search）比较**，不再和 `snapshot` 比较：没有订阅者时 `snapshot` 可能是旧的或 null。只改了 hash 的 popstate（`history.state` 不是我们的、地址没变）**整个忽略**，连浮层也不关（「a hash-only change closes nothing」锁住）。
6. **浮层里发生导航时，浮层条目被这次导航用掉**（契约 §4.2 第 5 步「当前条目带 `sheet` 时强制 replace」），并且 `stacked` 清空：更下面的浮层条目被新地址压在下面，只能靠真实的返回键走回去，不再静默后退跨过路由条目。典型场景：`SessionFormDialog` 建局成功 → `onCreated` 里 `navigate(sessionPath(id))` → 再 `onClose()`，最终历史是 `[/, /sessions/N]`，没有多余条目。
7. **`bootRouter` 只去掉「过期」的浮层标记**：`layer` 不在打开中的浮层里，或只有 `sheet` 没有 `layer`。同一个页面生命周期里 App 重新挂载（测试里常见）时，正在打开的浮层的条目不会被误删。刷新后模块状态是空的，所以真实刷新一定会去掉。另外：落到一个过期浮层条目上（比如前进键）时，popstate 也会就地去掉标记。
8. **滚动恢复**：push 前把 `window.scrollY` 写进当前条目的 `y`（契约第 5 步）；**浮层压条目前也写**（契约没写）：「浮层里导航」会用掉浮层条目（第 6 条），不写的话下面那条路由条目没有 `y`，比如在大厅滚到一半开「发起约局」、建局成功跳到 `/sessions/N`，返回大厅就回到了顶部（「the scroll under an overlay survives…」锁住）；返回落到另一个地址时，`setTimeout(…, 0)` 之后 `window.scrollTo(0, y ?? 0)`——`useSyncExternalStore` 的更新是同步优先级，在这个宏任务之前就已经渲染完，大厅已经取消 `hidden`、高度恢复。jsdom 没有 `history.scrollRestoration`，所以那一行先判断 `'scrollRestoration' in window.history`。
9. **P1-1 的 4 个用例按 P1-2 的行为改前提**（`router.test.tsx` 2 个、`route-pages.test.tsx` 2 个，见 Task 3 Step 6）。契约 §2 的「P1-2 动到的文件」没列这两个文件；它们锁的是 P1-1 的「只盖章、不垫 `/`」，而 spec §2.2 要求 P1-2 垫 `/`，冲突时以 spec 为准。断言本身一条没删，只挪了 `before` 的位置或换了起始状态。
10. **`constants.ts` 两条注释的措辞和契约 §4.12 不同**：契约原文含 `history.back()`、`history.state.sheet`，会被 P1-1 的 source-hygiene 正则（扫注释）判为违规。常量名和值不变。
11. **`tests/dom/history.ts` 多导出 `overlayMarks()`、`entryIdx()`、`preventNavigation()`。** 契约 §6.1 把 `preventNavigation(): () => void` 放在这个文件里，但 P1-3 的文件清单没有它，所以在 P1-2 一并建好；带 `act` 的 `pressBack` 写在测试文件里，因为 `history.ts` 被 `setup.ts` 导入，不能导入 Testing Library（见 Task 2 Step 1 的说明）。
12. **`resetRouterForTests`/`simulateReloadForTests` 也把下一个 layer id 归 1**（契约 §4.2 写了「下一个 layer id」）。「id 不复用」只在一个页面生命周期里成立，这两个函数本来就模拟新的生命周期。

## 自查

| spec / 契约条目 | 落在哪 | 锁它的测试 |
|---|---|---|
| §2.2 路由自己推入的每一条历史都带 `{edg: 1, …}` | Task 3（`applyNavigate`、`pushLayerEntry`、`bootRouter`） | `route.test.ts` 的 readEdgState、`router.test.tsx` |
| §2.2 浮层打开时 `pushState({edg:1, sheet})` | Task 3 `pushLayerEntry` + Task 4 `useHistoryLayer`/`Modal.historyKey` + Task 5 八个调用方 | 「closes only the top layer…」「phone: back closes 改时间 only…」 |
| §2.2 界面上的关闭按钮调 `history.back()` | Task 3 `dropLayerEntry`/`silentBack`（同步 `onClose` + 失活时静默后退，契约 §8 第 1 条） | 「a UI close is synchronous…」「closing both layers from the UI…」「closing 改时间 with 先不改…」、`organizer-actions:212-220` |
| §2.2 popstate 只关栈顶 | Task 3 `popLayersAbove` | 「closes only the top layer, then the next one」「desktop: the same over the drawer」 |
| §2.2 只在没有 `edg` 标记且不是 `/` 时垫一条 `/`，只垫一次 | Task 3 `bootRouter` | 「a fresh tab on a deep address gets one `/`…」「`/` itself is only stamped…」 |
| §9 P1-2「刷新后历史不变长」 | Task 3 `bootRouter`（有标记就不垫）+ `simulateReloadForTests` | 「…and a reload adds nothing」「a reload does not grow the history…」（App） |
| §2.2「刷新后不恢复浮层」、§9「刷新后浮层不重开」 | Task 3 `bootRouter` 去掉 `sheet`/`layer` | 「a reload with a sheet open drops its marks…」「a reload with an overlay open does not reopen it」「a reload with 改时间 open does not reopen it」（App） |
| §2.2 不用 hash 做路由：只改 hash 的 popstate 忽略 | Task 3 `onPopState` | `router.test.tsx` 的 hash 用例、「a hash-only change closes nothing」 |
| §9 P1-5 预备：滚动恢复 | Task 3 `rememberScroll`（路由 push 与浮层 push）/`restoreScroll`、`scrollRestoration = 'manual'` | 「going back to an address scrolls…」「the scroll under an overlay survives a navigation from inside it」 |
| §6.4 Modal：原签名不变、page 形态 Esc 不关、焦点规则不变 | Task 4 只加可选 prop；`page` 忽略 `historyKey` | `modal-focus`、`modal-stack` 原样通过 |
| 契约 §4.6：离开确认拦下返回键后重新压条目 | Task 4 `useHistoryLayer` 的 `pops` | 「back asks first; after 继续写 the next back asks again…」、`appeal-sheet:140-167`、`drafts` |
| 契约 §4.6：StrictMode 打开一次只多一条 | Task 4 `releaseLater` 推迟一个微任务 | 「StrictMode: one open is one entry」、`modal-stack:235` |
| 契约 §4.2 第 3 步：静默后退期间导航排队 | Task 3 `whenSettled`/`held` | 「a navigation right after a UI close waits…」、`p8-app:133-144` |
| 契约 §4.2 第 5 步：当前条目带 `sheet` 时强制 replace | Task 3 `applyNavigate` | 「a navigation from inside an overlay uses its entry up…」 |
| 契约 §4.3：`sheet`/`layer`/`y` 的校验 | Task 1 `readEdgState` | `route.test.ts` › `readEdgState — P1-2 fields` |
| 契约 §4.12 P1-2 常量 | Task 1 | 同上（`HISTORY_SHEET_NAME_MAX`） |
| 契约 §6.3 setup 最终形态 | Task 2 | dom 全量 |
| 契约 §6.4 不新增 `act(...)` 警告 | 测试里的 `pressBack`/`settleHistory` 都包在 `act` 里 | 收尾的警告计数 |
| 契约 §6.5 只有 router.ts 碰 history | 全部任务；`useHistoryLayer` 只调 `pushLayerEntry`/`dropLayerEntry` | `source-hygiene` › `history API` |
| 路由形态的抽屉/页面不设 `historyKey` | Task 5 Step 3 的核对命令 | 「desktop: the same over the drawer」（第二次返回才离开路由） |
