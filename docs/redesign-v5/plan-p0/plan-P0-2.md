# P0-2 Modal 栈、sheet 形态与 ConfirmInline 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Modal 改成模块级层栈（嵌套时 Esc / Tab 只归最上层），新增 `variant`（center / sheet / drawer / page）、sticky `.modal__bar`、可选 `dismissible` 和 `title`，并提供 `ConfirmInline` + `useInlineConfirm` 两个原地确认原语。现有 8 个调用方一行不改，看到的行为和 markup 与今天逐字节一致。

**Architecture:** 新模块 `src/lib/modalStack.ts` 持有三份模块级状态：层栈、`#root` inert 引用计数、body 滚动锁引用计数。状态一律整体替换，不原地修改。`Modal.tsx` 的 setup effect 仍然每次打开只跑一次：每个打开的层只装一个 document keydown 监听，处理函数第一行就判断 `isTopLayer`。`variant="page"` 不入栈，不 portal，不加 inert，也不困焦点，只在打开时把焦点移到标题。sheet、drawer 的贴底、抽屉和退化规则全部写在 `modal.css` 的媒体查询里，不用 JS 判断视口。`ConfirmInline` 不是弹层，只是原地替换触发按钮的一组按钮；焦点落点在挂载时设置一次，之后不再改。焦点回到触发按钮的时机由 `useInlineConfirm` 管理。

**Tech Stack:** React 18.3、TypeScript 5.9、plain CSS（P0-1 的 token 与断点约定）、Vitest 3.2 + jsdom 29 + Testing Library 16 + user-event 14。

**依赖:** 硬依赖 **P0-1**，必须先合进 main。本 PR 消费 P0-1 的以下内容：token `--z-modal`、`--tap-min`、`--sheet-max-h`、`--safe-bottom`、`--fs-sm`、`--fs-md`、`--fs-lg`；按钮类 `.btn--danger-outline`；断点写法 `(max-width: 600px)` / `(min-width: 1024px)`；hover 约定；`tests/unit/css-conventions.test.ts`。本 PR 提供契约 §3.2 的全部接口：`src/lib/modalStack.ts`、`Modal` 的 `variant` / `dismissible` / `title`、`ConfirmInline`、`useInlineConfirm`，以及 `tests/dom/setup.ts` 的 `afterEach` 块。P0-5 和 P0-6 会消费这些接口。P0-3 和本 PR 互不依赖，可以并行开发。

**分支:** `claude/p0-2-modal-stack`。等 P0-1 合并后，从最新的 `origin/main` 开分支，不要从本地 `main` 开（本地 `main` 已过期）。

---

## 对契约的补充

以下各条是契约 §3.2 没写到、实施时需要定下来的细节。契约里已有的名字一律沿用。

1. **`modalStack.ts` 增加 body 滚动锁引用计数：`lockBodyScroll(): void`、`unlockBodyScroll(): void`。`resetModalStackForTests()` 同时清零这份计数，并恢复 body 的 overflow。**
   原因：今天每个 Modal 各自保存、恢复 `body.style.overflow`。两层在同一次 commit 里一起卸载时，React 先跑外层的 cleanup（恢复成 `''`），再跑内层的 cleanup（恢复成它打开时看到的 `'hidden'`）。结果页面再也滚不动。今天按 Esc 时两层会一起关（M10），所以这个问题线上就存在。改成引用计数以后，第一次加锁时记下原值，最后一次解锁时还原，和 inert 计数的做法一样。在原来的 `Modal.tsx` 上跑 Task 2 的用例「unlocks body scroll when both layers unmount in the same commit」，结果是 `expected 'hidden' to be ''`，问题已复现。单层弹窗的行为与今天完全相同。
2. **`ConfirmInline` 的 `.ci__detail` 只在 `children` 不为 `null` / `undefined` / 布尔值时渲染**（调用方常写 `{cond && <Field />}`，得到的 `false` 也算没有），免得留下一个空 div。其余 DOM 与契约一致：`.ci > .ci__q + [.ci__detail] + .ci__actions`，按钮顺序是先取消、后确认。
3. **带 bar 的布局，类名统一加 `--{variant}` 后缀**：带 `title` 的 center 渲染成 `.modal.modal--center > .modal__panel.modal__panel--center`，drawer 渲染成 `.modal--drawer` / `.modal__panel--drawer`。契约示例只写了 sheet，这里把规则补全。只有「center 且没传 `title`」走旧 markup，不加任何新类名。
4. **抓手（`.modal__grabber`）只在 ≤600px 时显示**：sheet 在 ≥601px 时和 center 一样居中，这时露出抓手会误导人去拖。抓手只是装饰（`aria-hidden`），P0 里不能拖动。
5. **`modal.css` 用两个组件内局部变量**：`--modal-top`（背景层的上内边距）和 `--modal-pad`（面板内边距）。数值与今天的字面量相同，不进 `theme.css`，符合契约 §2.4。sticky bar 的 `top` 取 `calc(-1 * var(--modal-top))`，原因是 sticky 的偏移量是在滚动容器的 padding 内侧量的；不抵消这段距离，内容会从 bar 上方露出来。这一点已在 375px 和 1280px 下实测。
6. **`.modal-page` 在 P0 不写任何样式**，只作为类名钩子，留给 P1-1 的 PageBar 和页面布局用。
7. **`ModalVariant` 在本 PR 内分两步扩充**：Task 4 是 `'center' | 'sheet' | 'drawer'`，Task 5 加上 `'page'`。合并时的最终导出与契约一致。这样拆分是为了保证每个 commit 都能单独通过 typecheck。
8. **测试里的 `#root`**：`index.html:17` 有 `<div id="root">`，但 jsdom 测试里没有。凡是要断言 inert 的用例，都自己建一个 `#root`，并用 `render(ui, { container: root })` 渲染进去。测试文件里另加一个 `afterEach`，删掉残留的 `#root`，免得一次失败牵连下一条用例。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `src/lib/modalStack.ts` | 新建 | 模块级层栈（`pushLayer` / `popLayer` / `isTopLayer` / `layerCount`）、`#root` inert 引用计数、body 滚动锁引用计数、测试重置 |
| `src/components/Modal.tsx` | 修改（整文件重写，`:1-158`） | 层栈接入，`variant` / `dismissible` / `title`，sticky bar，page 形态；旧 markup 原样保留 |
| `src/components/modal.css` | 修改（整文件重写，`:1-71`，以 P0-1 合并后的版本为底） | `z-index` 改用 token，加上 bar、sheet、drawer、抓手的样式；`.modal__close` 的 coarse 规则从 theme.css 挪进来 |
| `src/theme.css` | 修改（只删一条规则，快照中位于 `:313-316`） | 把 `@media (pointer: coarse)` 里的 `.modal__close` 规则挪走 |
| `src/components/ConfirmInline.tsx` | 新建 | 原地确认原语 |
| `src/components/confirm-inline.css` | 新建 | `.ci` 块样式 |
| `src/lib/useInlineConfirm.ts` | 新建 | 管理确认的开合；退出确认后把焦点还给触发按钮 |
| `tests/dom/setup.ts` | 修改（`:1-2`） | 建立 `afterEach`，调用 `resetModalStackForTests()` |
| `tests/dom/modal-stack.test.tsx` | 新建 | 层栈单元、嵌套 Esc/Tab/焦点还原/inert/滚动锁、dismissible、各形态 markup、page 语义 |
| `tests/dom/confirm-inline.test.tsx` | 新建 | ConfirmInline 的 DOM 顺序、两种焦点落点、tone、busy、只聚焦一次、不装 keydown；useInlineConfirm 的焦点还原 |
| `tests/dom/modal-focus.test.tsx` | 不改 | 必须原样通过 |

不碰：任何调用方组件（CaseDialog、StatementDialog、OnboardingDialog、PlayerDetail、SessionFormDialog、SessionDetailDialog、RollCallDialog、AdminAiPanel）、`DiscordLinkCard`、`AdminScoreForm`、`src/api.ts`、worker/、server/、shared/。

---

### Task 0: 开分支并确认 P0-1 已就位

**Files:** 无改动

- [ ] **Step 1: 从最新的 origin/main 开分支**

在仓库根目录执行：

```bash
git fetch origin
git switch -c claude/p0-2-modal-stack origin/main
```

- [ ] **Step 2: 确认 P0-1 提供的 token 和测试都在**

```bash
grep -n -e '--z-modal' -e '--tap-min' -e '--sheet-max-h' -e '--safe-bottom' -e '--fs-lg' -e 'btn--danger-outline' src/theme.css
ls tests/unit/css-conventions.test.ts tests/unit/contrast.test.ts
grep -n "modal__close" src/theme.css src/components/modal.css
```

预期：前两条命令每一项都有输出。第三条应输出 `src/theme.css` 里 `@media (pointer: coarse)` 块内的 `.modal__close {`（快照中在 `:313`，P0-1 改过 theme.css 之后行号会变，以实际输出为准），以及 `modal.css` 里的 `.modal__close` 和 `.modal__close:hover`；后者应该已经被 P0-1 包进 `@media (hover: hover)`。只要缺任何一项，就说明 P0-1 还没合并，**停下，不要开工**。

- [ ] **Step 3: 跑基线**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npm run typecheck
npx vitest run --config vitest.config.ts
npx vitest run --config vitest.dom.config.ts
```

预期：全部 PASS。dom 应为 8 个文件 / 54 个用例（P0-1 不加 dom 用例）；unit 的数量以 P0-1 合并后的为准（P0-1 计划的收尾预期是 16 个文件 / 223 个用例；按推荐合并顺序，本 PR 开工时 main 上只有 P0-1），本 PR 不改变它。把这两个数字记下来，收尾时用来对照。

---

### Task 1: `modalStack` 模块与测试重置

**Files:**
- Create: `src/lib/modalStack.ts`
- Create: `tests/dom/modal-stack.test.tsx`（本任务写文件头和 `modalStack` 这一组）
- Modify: `tests/dom/setup.ts:1-2`

- [ ] **Step 1: 写失败的测试**

新建 `tests/dom/modal-stack.test.tsx`，内容如下。import 一次写全：后面几个任务只往文件末尾追加 `describe`，不再改文件头。`noUnusedLocals` 是 false，暂时没用到的 import 不会报错。

```tsx
import { StrictMode, useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Modal } from '../../src/components/Modal';
import {
  acquireRootInert,
  isTopLayer,
  layerCount,
  lockBodyScroll,
  popLayer,
  pushLayer,
  releaseRootInert,
  resetModalStackForTests,
  unlockBodyScroll,
} from '../../src/lib/modalStack';

// Modal portals into document.body; Testing Library's automatic cleanup unmounts
// it, and tests/dom/setup.ts resets the module-level stack after every test.

/** index.html's mount point. Tests that look at inert need a real #root. */
function makeRoot(): HTMLElement {
  const root = document.createElement('div');
  root.id = 'root';
  document.body.appendChild(root);
  return root;
}

// A #root left behind by a failed assertion must not make the next test's body inert.
afterEach(() => {
  document.getElementById('root')?.remove();
});

describe('modalStack', () => {
  it('only the newest layer is on top, and pops are out-of-order safe', () => {
    const lower = pushLayer();
    const upper = pushLayer();
    expect(layerCount()).toBe(2);
    expect(isTopLayer(upper)).toBe(true);
    expect(isTopLayer(lower)).toBe(false);

    popLayer(lower);
    expect(isTopLayer(upper)).toBe(true);
    popLayer(lower); // a StrictMode re-run popping twice is harmless
    expect(layerCount()).toBe(1);

    popLayer(upper);
    expect(layerCount()).toBe(0);
    expect(isTopLayer(upper)).toBe(false);
  });

  it('ref-counts inert on #root: first acquire marks it, last release clears it', () => {
    const root = makeRoot();
    acquireRootInert();
    acquireRootInert();
    expect(root).toHaveAttribute('inert');
    expect(root).toHaveAttribute('aria-hidden', 'true');

    releaseRootInert();
    expect(root).toHaveAttribute('inert');
    releaseRootInert();
    expect(root).not.toHaveAttribute('inert');
    expect(root).not.toHaveAttribute('aria-hidden');
  });

  it('ref-counts the body scroll lock and restores the value it found', () => {
    document.body.style.overflow = 'clip';
    lockBodyScroll();
    lockBodyScroll();
    expect(document.body.style.overflow).toBe('hidden');
    unlockBodyScroll();
    expect(document.body.style.overflow).toBe('hidden');
    unlockBodyScroll();
    unlockBodyScroll(); // an extra unlock is ignored
    expect(document.body.style.overflow).toBe('clip');
    document.body.style.overflow = '';
  });

  it('reset empties the stack, zeroes the inert count and strips #root', () => {
    const root = makeRoot();
    pushLayer();
    acquireRootInert();
    acquireRootInert();
    lockBodyScroll();

    resetModalStackForTests();
    resetModalStackForTests(); // idempotent
    expect(layerCount()).toBe(0);
    expect(root).not.toHaveAttribute('inert');
    expect(root).not.toHaveAttribute('aria-hidden');
    expect(document.body.style.overflow).toBe('');

    // The count really is zero: one acquire + one release round-trips cleanly.
    acquireRootInert();
    expect(root).toHaveAttribute('inert');
    releaseRootInert();
    expect(root).not.toHaveAttribute('inert');
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/modal-stack.test.tsx
```

预期：FAIL，报 `Failed to resolve import "../../src/lib/modalStack"`。

- [ ] **Step 3: 实现 `src/lib/modalStack.ts`**

```ts
// Module-level bookkeeping shared by every open <Modal>, in three independent pieces:
//
// - The layer stack decides which dialog owns the keyboard. Every open layer keeps
//   its own document keydown listener (one per open, see Modal.tsx), and each
//   listener bails out unless its layer is on top — so Escape closes only the
//   upper dialog and Tab cycles only inside it (M10).
// - The inert count keeps `#root` inert while at least one portaled layer is open:
//   only the first acquire marks it, only the last release clears it.
// - The scroll-lock count does the same for `overflow: hidden` on <body>. Each
//   Modal used to save and restore the overflow itself, which breaks when two
//   layers unmount in one commit: React runs the outer cleanup first, the inner
//   one then "restores" the outer's `hidden`, and the page never scrolls again.
//
// State is replaced, never mutated in place, so a reader never sees a half-updated
// stack. Ids are never reused, which keeps a StrictMode mount → unmount → mount
// (push, pop, push) from confusing an old layer with a new one.

export type LayerId = number;

let layers: readonly LayerId[] = [];
let nextLayerId: LayerId = 1;
let inertDepth = 0;
let scrollLocks = 0;
let savedOverflow = '';

/** Register a newly opened layer on top of the stack. */
export function pushLayer(): LayerId {
  const id = nextLayerId;
  nextLayerId += 1;
  layers = [...layers, id];
  return id;
}

/** Remove a layer wherever it sits (out-of-order unmounts and StrictMode re-runs are safe). */
export function popLayer(id: LayerId): void {
  layers = layers.filter((layer) => layer !== id);
}

/** Only the top layer handles Escape and Tab. */
export function isTopLayer(id: LayerId): boolean {
  return layers.length > 0 && layers[layers.length - 1] === id;
}

export function layerCount(): number {
  return layers.length;
}

function appRoot(): HTMLElement | null {
  return document.getElementById('root');
}

/** Ref-counted `inert` + `aria-hidden` on #root (moved here from Modal.tsx:16-38, same semantics). */
export function acquireRootInert(): void {
  const root = appRoot();
  if (!root) {
    return;
  }
  inertDepth += 1;
  if (inertDepth === 1) {
    root.setAttribute('inert', '');
    root.setAttribute('aria-hidden', 'true');
  }
}

export function releaseRootInert(): void {
  const root = appRoot();
  if (!root) {
    return;
  }
  inertDepth = Math.max(0, inertDepth - 1);
  if (inertDepth === 0) {
    root.removeAttribute('inert');
    root.removeAttribute('aria-hidden');
  }
}

/** Ref-counted `overflow: hidden` on <body>; the first lock saves the old value, the last unlock restores it. */
export function lockBodyScroll(): void {
  scrollLocks += 1;
  if (scrollLocks === 1) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
}

export function unlockBodyScroll(): void {
  if (scrollLocks === 0) {
    return;
  }
  scrollLocks -= 1;
  if (scrollLocks === 0) {
    document.body.style.overflow = savedOverflow;
  }
}

/** Tests only: empty the stack, zero the inert and scroll-lock counts, strip inert/aria-hidden from #root, restore body overflow. Idempotent. */
export function resetModalStackForTests(): void {
  layers = [];
  inertDepth = 0;
  if (scrollLocks > 0) {
    document.body.style.overflow = savedOverflow;
  }
  scrollLocks = 0;
  savedOverflow = '';
  const root = appRoot();
  root?.removeAttribute('inert');
  root?.removeAttribute('aria-hidden');
}
```

- [ ] **Step 4: 在 `tests/dom/setup.ts` 里建立 `afterEach`**

改前（`tests/dom/setup.ts:1-2`）：

```ts
// toHaveValue / toBeVisible etc.
import '@testing-library/jest-dom/vitest';
```

改后（整文件）：

```ts
// toHaveValue / toBeVisible etc.
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

说明：Vitest 3 的 `sequence.hooks` 默认是 `'stack'`，after 钩子按注册的逆序执行。setup 文件里的 `afterEach` 最先注册，所以最后执行，这时 Testing Library 的自动 cleanup 已经把所有组件卸载了。

- [ ] **Step 5: 运行，确认通过，并且全量 dom 没有回归**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/modal-stack.test.tsx
npx vitest run --config vitest.dom.config.ts
npm run typecheck
```

预期：`modal-stack.test.tsx` 4 个用例 PASS；dom 全量 9 个文件 / 58 个用例 PASS；typecheck PASS。

- [ ] **Step 6: 提交**

```bash
git add src/lib/modalStack.ts tests/dom/modal-stack.test.tsx tests/dom/setup.ts
git commit -m "feat: 新增 Modal 层栈模块（层栈、inert 与滚动锁引用计数、测试重置）"
```

---

### Task 2: Modal 接入层栈，嵌套时 Esc 和 Tab 只归最上层（M10）

**Files:**
- Modify: `src/components/Modal.tsx:1-158`（整文件重写；inert 代码 `:16-38` 挪进 modalStack；setup effect `:71-128` 拆成 `useLayer`；props 和 markup 不变）
- Test: `tests/dom/modal-stack.test.tsx`（追加，含一条 `<StrictMode>` 用例）、`tests/dom/modal-focus.test.tsx`（不改，必须原样通过）

- [ ] **Step 1: 写失败的测试**

把下面这段追加到 `tests/dom/modal-stack.test.tsx` 末尾：

```tsx
/**
 * SessionDetailDialog → RollCallDialog in miniature: the inner dialog is a sibling
 * of the outer one, both open at once. Before the stack, both document listeners
 * acted on every key: Escape closed both (the roll-call result was lost) and the
 * outer trap yanked Tab focus back into the outer panel.
 */
function Nested({
  onOuterClose = (): void => {},
  onInnerClose = (): void => {},
}: {
  onOuterClose?: () => void;
  onInnerClose?: () => void;
}) {
  const [outer, setOuter] = useState(true);
  const [inner, setInner] = useState(false);
  return (
    <>
      <Modal
        open={outer}
        onClose={() => {
          onOuterClose();
          setOuter(false);
        }}
        labelledBy="outer-title"
      >
        <h2 id="outer-title">外层</h2>
        <button type="button" onClick={() => setInner(true)}>
          打开内层
        </button>
        <button type="button">外层按钮</button>
      </Modal>
      <Modal
        open={inner}
        onClose={() => {
          onInnerClose();
          setInner(false);
        }}
        labelledBy="inner-title"
      >
        <h2 id="inner-title">内层</h2>
        <button type="button">内层一</button>
        <button type="button">内层二</button>
      </Modal>
    </>
  );
}

describe('Modal — nested layers', () => {
  it('Escape closes only the top layer, then the next one', async () => {
    const user = userEvent.setup();
    const onOuterClose = vi.fn();
    const onInnerClose = vi.fn();
    render(<Nested onOuterClose={onOuterClose} onInnerClose={onInnerClose} />);

    await user.click(screen.getByRole('button', { name: '打开内层' }));
    expect(screen.getByRole('dialog', { name: '内层' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(onInnerClose).toHaveBeenCalledTimes(1);
    expect(onOuterClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: '内层' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '外层' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(onOuterClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Tab and Shift+Tab cycle only inside the top layer', async () => {
    const user = userEvent.setup();
    render(<Nested />);
    await user.click(screen.getByRole('button', { name: '打开内层' }));
    const inner = screen.getByRole('dialog', { name: '内层' });
    const focusedName = (): string | null => {
      expect(inner.contains(document.activeElement)).toBe(true);
      return document.activeElement?.textContent ?? null;
    };

    // Focus starts on the inner ✕. Before the stack, the outer trap grabbed every
    // Tab and the inner trap grabbed it back, so focus never left the ✕.
    const forward: (string | null)[] = [];
    for (let i = 0; i < 4; i += 1) {
      await user.tab();
      forward.push(focusedName());
    }
    expect(forward).toEqual(['内层一', '内层二', '✕', '内层一']);

    const backward: (string | null)[] = [];
    for (let i = 0; i < 3; i += 1) {
      await user.tab({ shift: true });
      backward.push(focusedName());
    }
    expect(backward).toEqual(['✕', '内层二', '内层一']);
  });

  it('closing the top layer returns focus to its trigger in the layer below', async () => {
    const user = userEvent.setup();
    render(<Nested />);
    const trigger = screen.getByRole('button', { name: '打开内层' });
    await user.click(trigger);
    expect(within(screen.getByRole('dialog', { name: '内层' })).getByRole('button', { name: '关闭' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
    expect(layerCount()).toBe(1);
  });

  it('unlocks body scroll when both layers unmount in the same commit', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Nested />);
    await user.click(screen.getByRole('button', { name: '打开内层' }));
    expect(document.body.style.overflow).toBe('hidden');

    // React runs the outer cleanup first; per-Modal save/restore left 'hidden' behind.
    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('keeps #root inert until the last layer closes', async () => {
    const root = makeRoot();
    const user = userEvent.setup();
    render(<Nested />, { container: root });
    // Everything Nested renders is portaled to <body>, so role queries still see it.
    expect(root).toHaveAttribute('inert');

    await user.click(screen.getByRole('button', { name: '打开内层' }));
    await user.keyboard('{Escape}');
    expect(root).toHaveAttribute('inert');

    await user.keyboard('{Escape}');
    expect(root).not.toHaveAttribute('inert');
    expect(root).not.toHaveAttribute('aria-hidden');
  });

  it('StrictMode’s mount → unmount → mount leaves one layer per open dialog', async () => {
    const root = makeRoot();
    const user = userEvent.setup();
    const onOuterClose = vi.fn();
    render(
      <StrictMode>
        <Nested onOuterClose={onOuterClose} />
      </StrictMode>,
      { container: root },
    );
    // Dev-mode effects ran twice; ids are never reused, so the re-run did not stack a ghost layer.
    expect(layerCount()).toBe(1);
    expect(root).toHaveAttribute('inert');

    await user.click(screen.getByRole('button', { name: '打开内层' }));
    expect(layerCount()).toBe(2);
    await user.keyboard('{Escape}');
    expect(onOuterClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '打开内层' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(onOuterClose).toHaveBeenCalledTimes(1);
    expect(layerCount()).toBe(0);
    expect(root).not.toHaveAttribute('inert');
    expect(document.body.style.overflow).toBe('');
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/modal-stack.test.tsx
```

预期：FAIL，6 个用例失败（已在当前 `Modal.tsx` 上实测，这就是 M10 的复现）：
- `Escape closes only the top layer…`：`expected "spy" to not be called at all, but actually been called 1 times`（外层也被关掉了）
- `Tab and Shift+Tab cycle only inside the top layer`：`expected [ '✕', '✕', '✕', '✕' ] to deeply equal [ '内层一', '内层二', '✕', '内层一' ]`（两层的陷阱互相抢焦点，焦点一直停在 ✕ 上）
- `closing the top layer returns focus…`：`toHaveFocus()` 失败
- `unlocks body scroll when both layers unmount in the same commit`：`expected 'hidden' to be ''`
- `keeps #root inert until the last layer closes`：`toHaveAttribute("inert")` 失败
- `StrictMode’s mount → unmount → mount leaves one layer per open dialog`：`expected +0 to be 1`（旧 Modal 不登记层栈）

- [ ] **Step 3: 重写 `src/components/Modal.tsx`**

整文件替换为：

```tsx
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  acquireRootInert,
  isTopLayer,
  type LayerId,
  lockBodyScroll,
  popLayer,
  pushLayer,
  releaseRootInert,
  unlockBodyScroll,
} from '../lib/modalStack';
import './modal.css';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusablesIn(panel: HTMLElement | null): HTMLElement[] {
  return panel ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)) : [];
}

/** Keeps Tab / Shift+Tab cycling inside `panel`. */
function trapTab(e: KeyboardEvent, panel: HTMLElement): void {
  const items = focusablesIn(panel);
  if (items.length === 0) {
    e.preventDefault();
    panel.focus();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (e.shiftKey) {
    if (active === first || !panel.contains(active)) {
      e.preventDefault();
      last.focus();
    }
  } else if (active === last || !panel.contains(active)) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * One listener per open layer; only the top one acts. Without the guard a
 * nested dialog's Escape closed its parent as well, and the parent's trap
 * pulled Tab focus back out of the child (M10).
 */
function layerKeyHandler(
  layerId: LayerId,
  panel: HTMLElement | null,
  onCloseRef: React.MutableRefObject<() => void>,
): (e: KeyboardEvent) => void {
  return (e) => {
    if (!isTopLayer(layerId)) {
      return;
    }
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCloseRef.current();
      return;
    }
    if (e.key === 'Tab' && panel) {
      trapTab(e, panel);
    }
  };
}

/** An explicit [data-autofocus] target, else the first focusable, else the panel (tabIndex={-1}). */
function focusInto(panel: HTMLElement | null): void {
  const preferred = panel?.querySelector<HTMLElement>('[data-autofocus]');
  const target = preferred ?? focusablesIn(panel)[0] ?? panel;
  target?.focus();
}

/**
 * Portaled layers (center / sheet / drawer): lock body scroll, make #root inert,
 * join the layer stack, trap Tab, close on Escape, restore focus on close.
 *
 * This effect MUST run exactly once per open. It moves focus into the dialog, and
 * re-running it mid-session yanks the caret out of whatever the user is typing in.
 *
 * `onClose` cannot be a dependency: callers pass inline arrows, so it is a new
 * function on every parent render — and a parent re-renders on every keystroke
 * in any field it owns. Depending on it meant the focus trap tore down and
 * rebuilt itself per character, stealing focus each time. It is read from a ref
 * at call time instead.
 */
function useLayer(
  active: boolean,
  panelRef: React.RefObject<HTMLDivElement>,
  onCloseRef: React.MutableRefObject<() => void>,
): void {
  useEffect(() => {
    if (!active) {
      return;
    }
    const restore = document.activeElement as HTMLElement | null;
    lockBodyScroll();
    acquireRootInert();
    const layerId = pushLayer();
    const onKey = layerKeyHandler(layerId, panelRef.current, onCloseRef);
    document.addEventListener('keydown', onKey);
    focusInto(panelRef.current);

    return () => {
      document.removeEventListener('keydown', onKey);
      popLayer(layerId);
      unlockBodyScroll();
      releaseRootInert();
      restore?.focus?.();
    };
    // `active` only (it flips exactly when `open` does) — see the comment above.
  }, [active]);
}

/**
 * Accessible modal dialog: Escape to close, backdrop click to close, focus is
 * trapped inside the panel while open and restored on close, background scroll
 * is locked and the app root is made `inert` + `aria-hidden`. The dialog is
 * portaled to <body> so the app root can be inert without disabling the dialog.
 * Motion is transform/opacity only and disabled under prefers-reduced-motion.
 *
 * Open dialogs form a stack (src/lib/modalStack.ts): only the top one answers
 * Escape and Tab.
 */
export function Modal({
  open,
  onClose,
  labelledBy,
  children,
  size = 'md',
}: ModalProps): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useLayer(open, panelRef, onCloseRef);

  if (!open) {
    return null;
  }

  return createPortal(
    <div className="modal" onMouseDown={onClose}>
      <div
        ref={panelRef}
        className={`modal__panel panel modal__panel--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="modal__close"
          onClick={onClose}
          aria-label="关闭"
        >
          ✕
        </button>
        {children}
      </div>
    </div>,
    document.body,
  );
}
```

和旧文件逐项对照，确认等价：
- `onCloseRef` 保留，setup effect 依然只依赖一个布尔值。这里传的 `active` 就是 `open`，所以 `modal-focus.test.tsx:63-75` 统计的 keydown 监听次数不会变。
- 焦点落点仍是 `[data-autofocus]`，没有就取第一个可聚焦元素，再没有就取 panel，规则与旧 `:115-119` 相同。
- 关闭时依次是：移除监听、出栈、解除滚动锁、解除 inert、还原焦点。解除 inert 必须在还原焦点之前，否则焦点落不到 `#root` 里的触发按钮上。
- 旧的 `restoreRef` 改成 effect 里的局部常量，效果一样。

- [ ] **Step 4: 运行，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/modal-stack.test.tsx tests/dom/modal-focus.test.tsx
npx vitest run --config vitest.dom.config.ts
npm run typecheck
```

预期：`modal-stack` 10 个 PASS，`modal-focus` 4 个 PASS（原文件不改）；dom 全量 9 个文件 / 64 个用例 PASS；typecheck PASS。

- [ ] **Step 5: 提交**

```bash
git add src/components/Modal.tsx tests/dom/modal-stack.test.tsx
git commit -m "fix: Modal 改用层栈，嵌套时 Esc 和 Tab 只由最上层处理"
```

---

### Task 3: 可选的 `dismissible`

**Files:**
- Modify: `src/components/Modal.tsx`（Task 2 产出的文件：`ModalProps`、`Modal` 的参数解构、背景层的 `onMouseDown` 三处）
- Test: `tests/dom/modal-stack.test.tsx`（追加）

- [ ] **Step 1: 写失败的测试**

追加到 `tests/dom/modal-stack.test.tsx` 末尾：

```tsx
describe('Modal — dismissible', () => {
  function Draft({ onClose }: { onClose: () => void }) {
    return (
      <Modal open onClose={onClose} labelledBy="draft-title" dismissible={false}>
        <h2 id="draft-title">写说明</h2>
        <textarea aria-label="说明" />
      </Modal>
    );
  }

  it('dismissible={false}: a backdrop press does nothing, Escape and ✕ still call onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Draft onClose={onClose} />);
    const backdrop = screen.getByRole('dialog').parentElement as HTMLElement;

    await user.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: '关闭' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('by default a backdrop press still closes (today’s behaviour)', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} labelledBy="plain-title">
        <h2 id="plain-title">普通弹窗</h2>
      </Modal>,
    );
    await user.click(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/modal-stack.test.tsx
```

预期：FAIL，1 个失败。`dismissible={false}: …` 报 `expected "spy" to not be called at all, but actually been called 1 times`：未知 prop 被忽略，点背景照样关闭。默认行为那一条 PASS。

- [ ] **Step 3: 实现**

`ModalProps` 改前：

```tsx
  size?: 'sm' | 'md' | 'lg';
}
```

改后：

```tsx
  size?: 'sm' | 'md' | 'lg';
  /** Default true. false: a backdrop press does nothing; Escape and ✕ still call onClose (the caller decides, e.g. shows a leave confirm). */
  dismissible?: boolean;
}
```

参数解构改前：

```tsx
  size = 'md',
}: ModalProps): JSX.Element | null {
```

改后：

```tsx
  size = 'md',
  dismissible = true,
}: ModalProps): JSX.Element | null {
```

背景层改前：

```tsx
    <div className="modal" onMouseDown={onClose}>
```

改后：

```tsx
    <div className="modal" onMouseDown={dismissible ? onClose : undefined}>
```

- [ ] **Step 4: 运行，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/modal-stack.test.tsx tests/dom/modal-focus.test.tsx
npm run typecheck
```

预期：`modal-stack` 12 个 PASS，`modal-focus` 4 个 PASS；dom 全量 9 个文件 / 66 个用例 PASS；typecheck PASS。

- [ ] **Step 5: 提交**

```bash
git add src/components/Modal.tsx tests/dom/modal-stack.test.tsx
git commit -m "feat: Modal 新增可选 dismissible，有草稿时可禁止点背景关闭"
```

---

### Task 4: `variant`（center / sheet / drawer）、`title` 和 sticky `.modal__bar`

**Files:**
- Modify: `src/components/Modal.tsx`（Task 3 产出的文件，整文件替换）
- Test: `tests/dom/modal-stack.test.tsx`（追加）

- [ ] **Step 1: 写失败的测试**

追加到 `tests/dom/modal-stack.test.tsx` 末尾：

```tsx
describe('Modal — variants and markup', () => {
  it('center without title keeps today’s markup exactly', () => {
    render(
      <Modal open onClose={() => {}} labelledBy="legacy-title" size="lg">
        <h2 id="legacy-title">旧弹窗</h2>
      </Modal>,
    );
    const panel = screen.getByRole('dialog', { name: '旧弹窗' });
    expect(panel.parentElement?.className).toBe('modal');
    expect(panel.className).toBe('modal__panel panel modal__panel--lg');
    expect(panel).toHaveAttribute('aria-modal', 'true');
    expect(panel).toHaveAttribute('tabindex', '-1');
    const first = panel.firstElementChild as HTMLElement;
    expect(first.className).toBe('modal__close');
    expect(first).toHaveAccessibleName('关闭');
    expect(panel.querySelector('.modal__bar')).toBeNull();
    expect(panel.querySelector('.modal__body')).toBeNull();
  });

  it('sheet renders the sticky bar with grabber, title and ✕, children in .modal__body', () => {
    render(
      <Modal open onClose={() => {}} labelledBy="sheet-title" variant="sheet" title="改到什么时候？">
        <p>内容</p>
      </Modal>,
    );
    const panel = screen.getByRole('dialog', { name: '改到什么时候？' });
    expect(panel.parentElement?.className).toBe('modal modal--sheet');
    expect(panel.className).toBe('modal__panel panel modal__panel--md modal__panel--sheet');

    const bar = panel.firstElementChild as HTMLElement;
    expect(bar.className).toBe('modal__bar');
    expect(Array.from(bar.children).map((el) => el.className)).toEqual([
      'modal__grabber',
      'modal__title',
      'modal__close',
    ]);
    expect(bar.querySelector('.modal__grabber')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('heading', { name: '改到什么时候？' })).toHaveAttribute('id', 'sheet-title');
    expect(panel.querySelector('.modal__body')).toHaveTextContent('内容');
  });

  it('drawer and titled center use the bar without a grabber', () => {
    render(
      <>
        <Modal open onClose={() => {}} labelledBy="drawer-title" variant="drawer" title="抽屉">
          <p>抽屉内容</p>
        </Modal>
        <Modal open onClose={() => {}} labelledBy="titled-title" title="有标题">
          <p>居中内容</p>
        </Modal>
      </>,
    );
    const drawer = screen.getByRole('dialog', { name: '抽屉' });
    expect(drawer.parentElement?.className).toBe('modal modal--drawer');
    expect(drawer.querySelector('.modal__grabber')).toBeNull();

    const titled = screen.getByRole('dialog', { name: '有标题' });
    expect(titled.parentElement?.className).toBe('modal modal--center');
    expect(titled.querySelector('.modal__bar .modal__close')).not.toBeNull();
  });

  it('a sheet on top of a center dialog follows the same stack rules', async () => {
    const user = userEvent.setup();
    const onSheetClose = vi.fn();
    const onDialogClose = vi.fn();
    render(
      <>
        <Modal open onClose={onDialogClose} labelledBy="base-title">
          <h2 id="base-title">约局详情</h2>
        </Modal>
        <Modal open onClose={onSheetClose} labelledBy="top-title" variant="sheet" title="改到什么时候？">
          <button type="button" data-autofocus>
            先不改
          </button>
        </Modal>
      </>,
    );
    expect(screen.getByRole('button', { name: '先不改' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onSheetClose).toHaveBeenCalledTimes(1);
    expect(onDialogClose).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/modal-stack.test.tsx
```

预期：FAIL，2 个失败：
- `sheet renders the sticky bar…`：`Unable to find an accessible element with the role "dialog" and name "改到什么时候？"`（`title` 还没被渲染）
- `drawer and titled center use the bar…`：`Unable to find an accessible element with the role "dialog" and name "抽屉"`

`center without title keeps today's markup exactly` 和 `a sheet on top of a center dialog…` 两条现在就能 PASS。它们是回归护栏，不是这个任务要实现的东西。

- [ ] **Step 3: 实现**

整文件替换 `src/components/Modal.tsx`：

```tsx
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  acquireRootInert,
  isTopLayer,
  type LayerId,
  lockBodyScroll,
  popLayer,
  pushLayer,
  releaseRootInert,
  unlockBodyScroll,
} from '../lib/modalStack';
import './modal.css';

export type ModalVariant = 'center' | 'sheet' | 'drawer';

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

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusablesIn(panel: HTMLElement | null): HTMLElement[] {
  return panel ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)) : [];
}

/** Keeps Tab / Shift+Tab cycling inside `panel`. */
function trapTab(e: KeyboardEvent, panel: HTMLElement): void {
  const items = focusablesIn(panel);
  if (items.length === 0) {
    e.preventDefault();
    panel.focus();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (e.shiftKey) {
    if (active === first || !panel.contains(active)) {
      e.preventDefault();
      last.focus();
    }
  } else if (active === last || !panel.contains(active)) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * One listener per open layer; only the top one acts. Without the guard a
 * nested dialog's Escape closed its parent as well, and the parent's trap
 * pulled Tab focus back out of the child (M10).
 */
function layerKeyHandler(
  layerId: LayerId,
  panel: HTMLElement | null,
  onCloseRef: React.MutableRefObject<() => void>,
): (e: KeyboardEvent) => void {
  return (e) => {
    if (!isTopLayer(layerId)) {
      return;
    }
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCloseRef.current();
      return;
    }
    if (e.key === 'Tab' && panel) {
      trapTab(e, panel);
    }
  };
}

/** An explicit [data-autofocus] target, else the first focusable, else the panel (tabIndex={-1}). */
function focusInto(panel: HTMLElement | null): void {
  const preferred = panel?.querySelector<HTMLElement>('[data-autofocus]');
  const target = preferred ?? focusablesIn(panel)[0] ?? panel;
  target?.focus();
}

/**
 * Portaled layers (center / sheet / drawer): lock body scroll, make #root inert,
 * join the layer stack, trap Tab, close on Escape, restore focus on close.
 *
 * This effect MUST run exactly once per open. It moves focus into the dialog, and
 * re-running it mid-session yanks the caret out of whatever the user is typing in.
 *
 * `onClose` cannot be a dependency: callers pass inline arrows, so it is a new
 * function on every parent render — and a parent re-renders on every keystroke
 * in any field it owns. Depending on it meant the focus trap tore down and
 * rebuilt itself per character, stealing focus each time. It is read from a ref
 * at call time instead.
 */
function useLayer(
  active: boolean,
  panelRef: React.RefObject<HTMLDivElement>,
  onCloseRef: React.MutableRefObject<() => void>,
): void {
  useEffect(() => {
    if (!active) {
      return;
    }
    const restore = document.activeElement as HTMLElement | null;
    lockBodyScroll();
    acquireRootInert();
    const layerId = pushLayer();
    const onKey = layerKeyHandler(layerId, panelRef.current, onCloseRef);
    document.addEventListener('keydown', onKey);
    focusInto(panelRef.current);

    return () => {
      document.removeEventListener('keydown', onKey);
      popLayer(layerId);
      unlockBodyScroll();
      releaseRootInert();
      restore?.focus?.();
    };
    // `active` only (it flips exactly when `open` does) — see the comment above.
  }, [active]);
}

interface ModalBarProps {
  variant: ModalVariant;
  labelledBy: string;
  title: React.ReactNode | undefined;
  onClose: () => void;
}

/** Sticky top of the sheet / drawer / titled layouts: grabber, title and ✕ stay on screen. */
function ModalBar({ variant, labelledBy, title, onClose }: ModalBarProps): JSX.Element {
  return (
    <div className="modal__bar">
      {variant === 'sheet' && <span className="modal__grabber" aria-hidden="true" />}
      {title !== undefined && (
        <h2 id={labelledBy} className="modal__title">
          {title}
        </h2>
      )}
      <button type="button" className="modal__close" onClick={onClose} aria-label="关闭">
        ✕
      </button>
    </div>
  );
}

interface LayerBodyProps {
  variant: ModalVariant;
  labelledBy: string;
  title: React.ReactNode | undefined;
  onClose: () => void;
  children: React.ReactNode;
}

/** Every existing caller lands here: a center dialog that brings its own heading. */
function isLegacyLayout(variant: ModalVariant, title: React.ReactNode | undefined): boolean {
  return variant === 'center' && title === undefined;
}

/**
 * What goes inside the panel. A plain center dialog without `title` — every
 * existing caller — keeps today's markup byte for byte: an absolutely placed ✕,
 * then the children. Everything else gets the sticky bar and a body wrapper.
 */
function LayerBody({ variant, labelledBy, title, onClose, children }: LayerBodyProps): JSX.Element {
  if (isLegacyLayout(variant, title)) {
    return (
      <>
        <button type="button" className="modal__close" onClick={onClose} aria-label="关闭">
          ✕
        </button>
        {children}
      </>
    );
  }
  return (
    <>
      <ModalBar variant={variant} labelledBy={labelledBy} title={title} onClose={onClose} />
      <div className="modal__body">{children}</div>
    </>
  );
}

/** Backdrop and panel classes; the legacy center layout adds no modifier classes. */
function layerClasses(
  variant: ModalVariant,
  size: NonNullable<ModalProps['size']>,
  title: React.ReactNode | undefined,
): { backdrop: string; panel: string } {
  const panel = `modal__panel panel modal__panel--${size}`;
  if (isLegacyLayout(variant, title)) {
    return { backdrop: 'modal', panel };
  }
  return { backdrop: `modal modal--${variant}`, panel: `${panel} modal__panel--${variant}` };
}

interface LayerProps {
  panelRef: React.RefObject<HTMLDivElement>;
  variant: ModalVariant;
  size: NonNullable<ModalProps['size']>;
  labelledBy: string;
  title: React.ReactNode | undefined;
  dismissible: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

/** The portaled backdrop and dialog panel shared by center / sheet / drawer. */
function Layer({
  panelRef,
  variant,
  size,
  labelledBy,
  title,
  dismissible,
  onClose,
  children,
}: LayerProps): JSX.Element {
  const classes = layerClasses(variant, size, title);
  return createPortal(
    <div className={classes.backdrop} onMouseDown={dismissible ? onClose : undefined}>
      <div
        ref={panelRef}
        className={classes.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <LayerBody variant={variant} labelledBy={labelledBy} title={title} onClose={onClose}>
          {children}
        </LayerBody>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Accessible modal dialog: Escape to close, backdrop click to close, focus is
 * trapped inside the panel while open and restored on close, background scroll
 * is locked and the app root is made `inert` + `aria-hidden`. The dialog is
 * portaled to <body> so the app root can be inert without disabling the dialog.
 * Motion is transform/opacity only and disabled under prefers-reduced-motion.
 *
 * Open dialogs form a stack (src/lib/modalStack.ts): only the top one answers
 * Escape and Tab.
 */
export function Modal({
  open,
  onClose,
  labelledBy,
  children,
  size = 'md',
  variant = 'center',
  dismissible = true,
  title,
}: ModalProps): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useLayer(open, panelRef, onCloseRef);

  if (!open) {
    return null;
  }
  return (
    <Layer
      panelRef={panelRef}
      variant={variant}
      size={size}
      labelledBy={labelledBy}
      title={title}
      dismissible={dismissible}
      onClose={onClose}
    >
      {children}
    </Layer>
  );
}
```

要点：
- 旧 markup 只在 `isLegacyLayout`（center 且没传 `title`）时出现，与今天逐字节一致：背景层只有 `modal` 一个类，panel 的类是 `modal__panel panel modal__panel--{size}`，第一个子元素是 `.modal__close`，后面紧跟 children，没有 bar，也没有 body 包裹。8 个现有调用方都走这条路径。
- 其余布局的结构是 `.modal__bar`（sheet 才有抓手，传了 `title` 才有 `h2#labelledBy.modal__title`，✕ 一直都在）加上 `.modal__body`。✕ 的可访问名仍然是「关闭」。
- portal 和 panel 的 JSX 放进不导出的 `Layer` 组件，`layerClasses`、`LayerBody`、`ModalBar` 也都是小函数；`Modal` 本体只管 ref、`useLayer` 和分支，Task 5 加上 page 分支后也在 50 行以内（机主规则：函数 < 50 行）。拆出 `Layer` 不改 DOM：组件边界不产生节点，`panelRef` 在 commit 阶段挂上，早于 `useLayer` 的 effect。

- [ ] **Step 4: 运行，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/modal-stack.test.tsx tests/dom/modal-focus.test.tsx
npx vitest run --config vitest.dom.config.ts
npm run typecheck
```

预期：`modal-stack` 16 个 PASS；dom 全量 9 个文件 / 70 个用例 PASS（现有 8 个调用方的测试，包括 `discord-link:183,197` 的 `getByRole('dialog')`，都不受影响）；typecheck PASS。

- [ ] **Step 5: 提交**

```bash
git add src/components/Modal.tsx tests/dom/modal-stack.test.tsx
git commit -m "feat: Modal 新增 sheet / drawer 形态、可选标题和 sticky 标题栏"
```

---

### Task 5: `variant="page"`：原地渲染，不入栈、不加 inert、不困焦点

**Files:**
- Modify: `src/components/Modal.tsx`（Task 4 产出的文件，按 Step 3 的 ①–⑧ 改）
- Test: `tests/dom/modal-stack.test.tsx`（追加）

- [ ] **Step 1: 写失败的测试**

追加到 `tests/dom/modal-stack.test.tsx` 末尾：

```tsx
describe('Modal — page variant', () => {
  function PageHarness({ onClose = (): void => {}, headingFocusable = true }: { onClose?: () => void; headingFocusable?: boolean }) {
    return (
      <>
        <Modal open onClose={onClose} labelledBy="page-title" variant="page">
          <h2 id="page-title" tabIndex={headingFocusable ? -1 : undefined}>
            选手
          </h2>
          <button type="button">页面里的按钮</button>
        </Modal>
        <button type="button">页面外的按钮</button>
      </>
    );
  }

  it('renders in place: no portal, no dialog role, no inert, not a layer', () => {
    const root = makeRoot();
    render(<PageHarness />, { container: root });

    const section = root.querySelector('section.modal-page');
    expect(section).not.toBeNull();
    expect(section).toHaveAttribute('aria-labelledby', 'page-title');
    expect(section).toHaveAttribute('tabindex', '-1');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '关闭' })).not.toBeInTheDocument();
    expect(root).not.toHaveAttribute('inert');
    expect(root).not.toHaveAttribute('aria-hidden');
    expect(layerCount()).toBe(0);
    expect(document.body.style.overflow).toBe('');
  });

  it('focuses the heading on open, falling back to the section', () => {
    const { unmount } = render(<PageHarness />);
    expect(screen.getByRole('heading', { name: '选手' })).toHaveFocus();
    unmount();

    const { container } = render(<PageHarness headingFocusable={false} />);
    expect(container.querySelector('section.modal-page')).toHaveFocus();
  });

  it('does not trap Tab and does not close on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<PageHarness onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: '页面里的按钮' }));
    await user.tab();
    expect(screen.getByRole('button', { name: '页面外的按钮' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a center dialog over a page still makes #root inert and owns Escape', async () => {
    const root = makeRoot();
    const user = userEvent.setup();
    const onPageClose = vi.fn();
    const onDialogClose = vi.fn();
    render(
      <>
        <Modal open onClose={onPageClose} labelledBy="page-title-2" variant="page">
          <h2 id="page-title-2" tabIndex={-1}>
            约局
          </h2>
        </Modal>
        <Modal open onClose={onDialogClose} labelledBy="over-title">
          <h2 id="over-title">点名</h2>
        </Modal>
      </>,
      { container: root },
    );
    expect(root).toHaveAttribute('inert');
    await user.keyboard('{Escape}');
    expect(onDialogClose).toHaveBeenCalledTimes(1);
    expect(onPageClose).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/modal-stack.test.tsx
```

预期：FAIL，3 个失败。原因是现在 `page` 还被当成普通层，会 portal 出去：
- `renders in place…`：`expected null not to be null`（`#root` 里找不到 `section.modal-page`）
- `focuses the heading on open…`：`toHaveFocus()` 失败（焦点落在 ✕ 上）
- `does not trap Tab and does not close on Escape`：`toHaveFocus()` 失败（Tab 被困住了）

`a center dialog over a page still makes #root inert and owns Escape` 现在就能 PASS（回归护栏）。

- [ ] **Step 3: 实现（在 Task 4 产出的文件上改）**

① 类型。改前：

```tsx
export type ModalVariant = 'center' | 'sheet' | 'drawer';
```

改后：

```tsx
export type ModalVariant = 'center' | 'sheet' | 'drawer' | 'page';
```

② 在 `interface ModalProps { … }` 结束的 `}` 之后、`const FOCUSABLE_SELECTOR` 之前插入：

```tsx

type LayerVariant = Exclude<ModalVariant, 'page'>;
```

③ 下面五处的参数类型从 `ModalVariant` 改成 `LayerVariant`：`interface ModalBarProps` 的 `variant: ModalVariant;`，`interface LayerBodyProps` 的 `variant: ModalVariant;`，`interface LayerProps` 的 `variant: ModalVariant;`，`function isLegacyLayout(variant: ModalVariant, …)`，`function layerClasses(` 的第一个参数 `variant: ModalVariant,`。

④ 在 `useLayer` 函数结束的 `}` 之后、`interface ModalBarProps` 之前插入：

```tsx
/**
 * The in-place page variant joins nothing: no portal, no inert, no trap, no
 * stack, no Escape. It only moves focus to the caller's heading (id={labelledBy},
 * tabIndex={-1}) on open, falling back to the section itself.
 */
function usePageFocus(
  active: boolean,
  labelledBy: string,
  sectionRef: React.RefObject<HTMLElement>,
): void {
  useEffect(() => {
    if (!active) {
      return;
    }
    const heading = document.getElementById(labelledBy);
    heading?.focus();
    if (document.activeElement !== heading) {
      sectionRef.current?.focus();
    }
    // `active` only, like useLayer: a re-render must not move focus again.
  }, [active]);
}

```

⑤ `Modal` 的文档注释最后一行。改前：

```tsx
 * Escape and Tab.
 */
```

改后：

```tsx
 * Escape and Tab. `variant="page"` is not a layer at all — see usePageFocus.
 */
```

⑥ 在 `const panelRef = useRef<HTMLDivElement>(null);` 下一行插入：

```tsx
  const pageRef = useRef<HTMLElement>(null);
```

⑦ 改前：

```tsx
  useLayer(open, panelRef, onCloseRef);
```

改后：

```tsx
  const isPage = variant === 'page';
  useLayer(open && !isPage, panelRef, onCloseRef);
  usePageFocus(open && isPage, labelledBy, pageRef);
```

⑧ 在 `Modal` 里的 `if (!open) { return null; }` 之后、`return ( <Layer` 之前插入：

```tsx
  if (variant === 'page') {
    return (
      <section ref={pageRef} className="modal-page" aria-labelledby={labelledBy} tabIndex={-1}>
        {children}
      </section>
    );
  }
```

（`variant === 'page'` 的分支返回之后，TypeScript 会把后面的 `variant` 收窄成 `LayerVariant`，所以 `<Layer variant={variant}>` 不用做类型转换。）

改完以后，`src/components/Modal.tsx` 应与下面的全文一致（可以用来核对）：

```tsx
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  acquireRootInert,
  isTopLayer,
  type LayerId,
  lockBodyScroll,
  popLayer,
  pushLayer,
  releaseRootInert,
  unlockBodyScroll,
} from '../lib/modalStack';
import './modal.css';

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

type LayerVariant = Exclude<ModalVariant, 'page'>;

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusablesIn(panel: HTMLElement | null): HTMLElement[] {
  return panel ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)) : [];
}

/** Keeps Tab / Shift+Tab cycling inside `panel`. */
function trapTab(e: KeyboardEvent, panel: HTMLElement): void {
  const items = focusablesIn(panel);
  if (items.length === 0) {
    e.preventDefault();
    panel.focus();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (e.shiftKey) {
    if (active === first || !panel.contains(active)) {
      e.preventDefault();
      last.focus();
    }
  } else if (active === last || !panel.contains(active)) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * One listener per open layer; only the top one acts. Without the guard a
 * nested dialog's Escape closed its parent as well, and the parent's trap
 * pulled Tab focus back out of the child (M10).
 */
function layerKeyHandler(
  layerId: LayerId,
  panel: HTMLElement | null,
  onCloseRef: React.MutableRefObject<() => void>,
): (e: KeyboardEvent) => void {
  return (e) => {
    if (!isTopLayer(layerId)) {
      return;
    }
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCloseRef.current();
      return;
    }
    if (e.key === 'Tab' && panel) {
      trapTab(e, panel);
    }
  };
}

/** An explicit [data-autofocus] target, else the first focusable, else the panel (tabIndex={-1}). */
function focusInto(panel: HTMLElement | null): void {
  const preferred = panel?.querySelector<HTMLElement>('[data-autofocus]');
  const target = preferred ?? focusablesIn(panel)[0] ?? panel;
  target?.focus();
}

/**
 * Portaled layers (center / sheet / drawer): lock body scroll, make #root inert,
 * join the layer stack, trap Tab, close on Escape, restore focus on close.
 *
 * This effect MUST run exactly once per open. It moves focus into the dialog, and
 * re-running it mid-session yanks the caret out of whatever the user is typing in.
 *
 * `onClose` cannot be a dependency: callers pass inline arrows, so it is a new
 * function on every parent render — and a parent re-renders on every keystroke
 * in any field it owns. Depending on it meant the focus trap tore down and
 * rebuilt itself per character, stealing focus each time. It is read from a ref
 * at call time instead.
 */
function useLayer(
  active: boolean,
  panelRef: React.RefObject<HTMLDivElement>,
  onCloseRef: React.MutableRefObject<() => void>,
): void {
  useEffect(() => {
    if (!active) {
      return;
    }
    const restore = document.activeElement as HTMLElement | null;
    lockBodyScroll();
    acquireRootInert();
    const layerId = pushLayer();
    const onKey = layerKeyHandler(layerId, panelRef.current, onCloseRef);
    document.addEventListener('keydown', onKey);
    focusInto(panelRef.current);

    return () => {
      document.removeEventListener('keydown', onKey);
      popLayer(layerId);
      unlockBodyScroll();
      releaseRootInert();
      restore?.focus?.();
    };
    // `active` only (it flips exactly when `open` does) — see the comment above.
  }, [active]);
}

/**
 * The in-place page variant joins nothing: no portal, no inert, no trap, no
 * stack, no Escape. It only moves focus to the caller's heading (id={labelledBy},
 * tabIndex={-1}) on open, falling back to the section itself.
 */
function usePageFocus(
  active: boolean,
  labelledBy: string,
  sectionRef: React.RefObject<HTMLElement>,
): void {
  useEffect(() => {
    if (!active) {
      return;
    }
    const heading = document.getElementById(labelledBy);
    heading?.focus();
    if (document.activeElement !== heading) {
      sectionRef.current?.focus();
    }
    // `active` only, like useLayer: a re-render must not move focus again.
  }, [active]);
}

interface ModalBarProps {
  variant: LayerVariant;
  labelledBy: string;
  title: React.ReactNode | undefined;
  onClose: () => void;
}

/** Sticky top of the sheet / drawer / titled layouts: grabber, title and ✕ stay on screen. */
function ModalBar({ variant, labelledBy, title, onClose }: ModalBarProps): JSX.Element {
  return (
    <div className="modal__bar">
      {variant === 'sheet' && <span className="modal__grabber" aria-hidden="true" />}
      {title !== undefined && (
        <h2 id={labelledBy} className="modal__title">
          {title}
        </h2>
      )}
      <button type="button" className="modal__close" onClick={onClose} aria-label="关闭">
        ✕
      </button>
    </div>
  );
}

interface LayerBodyProps {
  variant: LayerVariant;
  labelledBy: string;
  title: React.ReactNode | undefined;
  onClose: () => void;
  children: React.ReactNode;
}

/** Every existing caller lands here: a center dialog that brings its own heading. */
function isLegacyLayout(variant: LayerVariant, title: React.ReactNode | undefined): boolean {
  return variant === 'center' && title === undefined;
}

/**
 * What goes inside the panel. A plain center dialog without `title` — every
 * existing caller — keeps today's markup byte for byte: an absolutely placed ✕,
 * then the children. Everything else gets the sticky bar and a body wrapper.
 */
function LayerBody({ variant, labelledBy, title, onClose, children }: LayerBodyProps): JSX.Element {
  if (isLegacyLayout(variant, title)) {
    return (
      <>
        <button type="button" className="modal__close" onClick={onClose} aria-label="关闭">
          ✕
        </button>
        {children}
      </>
    );
  }
  return (
    <>
      <ModalBar variant={variant} labelledBy={labelledBy} title={title} onClose={onClose} />
      <div className="modal__body">{children}</div>
    </>
  );
}

/** Backdrop and panel classes; the legacy center layout adds no modifier classes. */
function layerClasses(
  variant: LayerVariant,
  size: NonNullable<ModalProps['size']>,
  title: React.ReactNode | undefined,
): { backdrop: string; panel: string } {
  const panel = `modal__panel panel modal__panel--${size}`;
  if (isLegacyLayout(variant, title)) {
    return { backdrop: 'modal', panel };
  }
  return { backdrop: `modal modal--${variant}`, panel: `${panel} modal__panel--${variant}` };
}

interface LayerProps {
  panelRef: React.RefObject<HTMLDivElement>;
  variant: LayerVariant;
  size: NonNullable<ModalProps['size']>;
  labelledBy: string;
  title: React.ReactNode | undefined;
  dismissible: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

/** The portaled backdrop and dialog panel shared by center / sheet / drawer. */
function Layer({
  panelRef,
  variant,
  size,
  labelledBy,
  title,
  dismissible,
  onClose,
  children,
}: LayerProps): JSX.Element {
  const classes = layerClasses(variant, size, title);
  return createPortal(
    <div className={classes.backdrop} onMouseDown={dismissible ? onClose : undefined}>
      <div
        ref={panelRef}
        className={classes.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <LayerBody variant={variant} labelledBy={labelledBy} title={title} onClose={onClose}>
          {children}
        </LayerBody>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Accessible modal dialog: Escape to close, backdrop click to close, focus is
 * trapped inside the panel while open and restored on close, background scroll
 * is locked and the app root is made `inert` + `aria-hidden`. The dialog is
 * portaled to <body> so the app root can be inert without disabling the dialog.
 * Motion is transform/opacity only and disabled under prefers-reduced-motion.
 *
 * Open dialogs form a stack (src/lib/modalStack.ts): only the top one answers
 * Escape and Tab. `variant="page"` is not a layer at all — see usePageFocus.
 */
export function Modal({
  open,
  onClose,
  labelledBy,
  children,
  size = 'md',
  variant = 'center',
  dismissible = true,
  title,
}: ModalProps): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const isPage = variant === 'page';
  useLayer(open && !isPage, panelRef, onCloseRef);
  usePageFocus(open && isPage, labelledBy, pageRef);

  if (!open) {
    return null;
  }
  if (variant === 'page') {
    return (
      <section ref={pageRef} className="modal-page" aria-labelledby={labelledBy} tabIndex={-1}>
        {children}
      </section>
    );
  }
  return (
    <Layer
      panelRef={panelRef}
      variant={variant}
      size={size}
      labelledBy={labelledBy}
      title={title}
      dismissible={dismissible}
      onClose={onClose}
    >
      {children}
    </Layer>
  );
}
```

- [ ] **Step 4: 运行，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/modal-stack.test.tsx tests/dom/modal-focus.test.tsx
npx vitest run --config vitest.dom.config.ts
npm run typecheck
```

预期：`modal-stack` 20 个 PASS，`modal-focus` 4 个 PASS；dom 全量 9 个文件 / 74 个用例 PASS；typecheck PASS。

- [ ] **Step 5: 提交**

```bash
git add src/components/Modal.tsx tests/dom/modal-stack.test.tsx
git commit -m "feat: Modal 新增 page 形态（原地渲染，不加 inert、不困焦点）"
```

---

### Task 6: sheet / drawer / bar 的样式，挪走 theme.css 里的 coarse 规则

**Files:**
- Modify: `src/components/modal.css`（整文件替换。快照 d72e11b 中是 `:1-71`；P0-1 只会把 `:47-51` 的 `.modal__close:hover` 包进 `@media (hover: hover)`）
- Modify: `src/theme.css`（快照中 `:313-316`，即 `@media (pointer: coarse)` 块里的最后一条规则）
- Test: `tests/unit/css-conventions.test.ts`（P0-1 提供，不改，用来约束新 CSS）

CSS 没法用 jsdom 测，这个任务的护栏是 P0-1 的约定测试、构建，以及后面的手动检查。

- [ ] **Step 1: 先跑约定测试，确认基线是绿的**

```bash
npx vitest run --config vitest.config.ts tests/unit/css-conventions.test.ts
```

预期：PASS。

- [ ] **Step 2: 整文件替换 `src/components/modal.css`**

```css
.modal {
  /* Shared by the backdrop padding and the sticky bar's offset below. */
  --modal-top: clamp(1rem, 4vh, 4rem);
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: grid;
  place-items: start center;
  padding: var(--modal-top) 1rem 3rem;
  overflow-y: auto;
  background: rgba(4, 7, 12, 0.72);
  backdrop-filter: blur(6px);
  animation: modal-fade var(--dur) var(--ease);
}

.modal__panel {
  /* Shared by the panel padding and the bar that bleeds over it. */
  --modal-pad: clamp(1.25rem, 1rem + 2vw, 2rem);
  position: relative;
  width: 100%;
  padding: var(--modal-pad);
  animation: modal-rise var(--dur) var(--ease);
  box-shadow: var(--shadow-pop), var(--inner-glow);
}

.modal__panel--sm {
  max-width: 420px;
}
.modal__panel--md {
  max-width: 560px;
}
.modal__panel--lg {
  max-width: 760px;
}

.modal__close {
  position: absolute;
  top: 0.85rem;
  right: 0.85rem;
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: var(--r-sm);
  color: var(--muted);
  border: 1px solid transparent;
  transition: color var(--dur-fast), background var(--dur-fast),
    border-color var(--dur-fast);
}

@media (hover: hover) {
  .modal__close:hover {
    color: var(--text);
    background: var(--panel-2);
    border-color: var(--border);
  }
}

/* Moved from theme.css's coarse-pointer block: the ✕ is Modal's own business. */
@media (pointer: coarse) {
  .modal__close {
    min-width: var(--tap-min);
    min-height: var(--tap-min);
  }
}

/* --- Bar layout (sheet / drawer / any titled dialog) ------------------------
 * The bar sticks to the top of whatever scrolls — the backdrop for a centred
 * dialog, the panel itself for a bottom sheet — so the title and ✕ never scroll
 * off screen (H2: the ✕ of a 3729px-tall panel sat at top=-17). It bleeds over
 * the panel padding so content scrolls underneath an opaque strip. Sticky
 * offsets are measured inside the scroller's padding, hence the negative top:
 * without it content shows through the backdrop's top padding above the bar. */
.modal__bar {
  position: sticky;
  top: calc(-1 * var(--modal-top));
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin: calc(-1 * var(--modal-pad)) calc(-1 * var(--modal-pad)) 0;
  padding: 0.5rem 0.5rem 0.5rem var(--modal-pad);
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  border-radius: var(--r-lg) var(--r-lg) 0 0;
}

.modal__title {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-lg);
  line-height: 1.3;
}

.modal__bar .modal__close {
  position: static;
  flex: none;
  margin-left: auto;
  width: var(--tap-min);
  height: var(--tap-min);
}

.modal__body {
  padding-top: var(--modal-pad);
}

/* Only the sheet renders a grabber, and it only shows while the sheet is pinned
 * to the bottom (≤600px). Decoration (aria-hidden), not a drag handle. */
.modal__grabber {
  display: none;
  position: absolute;
  top: 0.35rem;
  left: 50%;
  width: 36px;
  height: 4px;
  border-radius: var(--r-pill);
  background: var(--border-strong);
  transform: translateX(-50%);
}

/* --- Sheet: pinned to the bottom on phones, centred like a dialog above 600px.
 * Drawer falls back to the same sheet below 1024px. */
@media (max-width: 600px) {
  .modal--sheet,
  .modal--drawer {
    place-items: end stretch;
    padding: 0;
    overflow: hidden;
  }

  .modal__panel--sheet,
  .modal__panel--drawer {
    max-width: none;
    max-height: var(--sheet-max-h);
    overflow-y: auto;
    overscroll-behavior: contain;
    padding-top: 0;
    padding-bottom: calc(var(--modal-pad) + var(--safe-bottom));
    border-bottom: 0;
    border-radius: var(--r-lg) var(--r-lg) 0 0;
    animation-name: modal-sheet-up;
  }

  .modal__grabber {
    display: block;
  }

  /* The panel is the scroller here and has no top padding to cancel. */
  .modal__panel--sheet .modal__bar,
  .modal__panel--drawer .modal__bar {
    top: 0;
    margin-top: 0;
    padding-top: 1rem;
  }
}

/* --- Drawer: a 480px panel on the right on desktop (first used in P1-1). */
@media (min-width: 1024px) {
  .modal--drawer {
    place-items: stretch end;
    padding: 0;
    overflow: hidden;
  }

  .modal__panel--drawer {
    max-width: 480px;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding-top: 0;
    border-radius: var(--r-lg) 0 0 var(--r-lg);
    animation-name: modal-drawer-in;
  }

  .modal__panel--drawer .modal__bar {
    top: 0;
    margin-top: 0;
    border-radius: var(--r-lg) 0 0 0;
  }
}

@keyframes modal-fade {
  from {
    opacity: 0;
  }
}

@keyframes modal-rise {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.985);
  }
}

@keyframes modal-sheet-up {
  from {
    transform: translateY(100%);
  }
}

@keyframes modal-drawer-in {
  from {
    transform: translateX(100%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .modal,
  .modal__panel {
    animation: none;
  }
}
```

和旧文件对照：
- `.modal` 的 `z-index: 100` 换成 `var(--z-modal)`（P0-1 定义的值也是 100）。上内边距的字面量 `clamp(1rem, 4vh, 4rem)` 挪进局部变量 `--modal-top`，面板内边距 `clamp(1.25rem, 1rem + 2vw, 2rem)` 挪进 `--modal-pad`，数值都没变。
- 旧路径（center 且没有 title）用到的规则只有 `.modal`、`.modal__panel(--sm|md|lg)`、`.modal__close`，渲染效果和今天一样。
- 媒体查询只用了 `(hover: hover)`、`(pointer: coarse)`、`(max-width: 600px)`、`(min-width: 1024px)`、`(prefers-reduced-motion: reduce)`，没有 `outline: none`，也没有 `--focus-ring`。

- [ ] **Step 3: 删掉 `src/theme.css` 里 coarse 块中的 `.modal__close` 规则**

改前（快照中是 `src/theme.css:309-317`，P0-1 合并后行号会变，按内容定位）：

```css
  .sessions__tab {
    min-height: 40px;
  }

  .modal__close {
    min-width: 44px;
    min-height: 44px;
  }
}
```

改后：

```css
  .sessions__tab {
    min-height: 40px;
  }
}
```

（P0-4 会删同一块里的 `.hero-card__link`，两处改动互不重叠。）

- [ ] **Step 4: 验证**

```bash
grep -n "modal__close" src/theme.css
npx vitest run --config vitest.config.ts tests/unit/css-conventions.test.ts
npx vitest run --config vitest.config.ts
npx vitest run --config vitest.dom.config.ts
npm run build
```

预期：`grep` 没有输出（退出码 1）；`css-conventions` PASS；unit 全量 PASS；dom 全量 9 个文件 / 74 个用例 PASS；`npm run build` 成功（CSS 能解析，`vite build` 不报错）。

- [ ] **Step 5: 提交**

```bash
git add src/components/modal.css src/theme.css
git commit -m "feat: sheet 贴底、drawer 右侧抽屉与 sticky 标题栏样式，关闭按钮触控尺寸挪进 modal.css"
```

---

### Task 7: `ConfirmInline` 原语

**Files:**
- Create: `src/components/ConfirmInline.tsx`
- Create: `src/components/confirm-inline.css`
- Create: `tests/dom/confirm-inline.test.tsx`（本任务写文件头和 `ConfirmInline` 这一组）

- [ ] **Step 1: 写失败的测试**

新建 `tests/dom/confirm-inline.test.tsx`：

```tsx
import { useState } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmInline } from '../../src/components/ConfirmInline';

// Labels are spec §3.5's cancel-session confirm (P0-6 is the first real caller).
// New confirms never use the bare 「取消」/「确认」: those names are locked to
// DiscordLinkCard / OnboardingDialog / AdminScoreForm (spec §6.5).
const QUESTION = '取消这局？';
const CONFIRM = '确认取消';
const CANCEL = '不取消了';

function renderConfirm(props: Partial<React.ComponentProps<typeof ConfirmInline>> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConfirmInline
      question={QUESTION}
      confirmLabel={CONFIRM}
      cancelLabel={CANCEL}
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { onConfirm, onCancel };
}

describe('ConfirmInline', () => {
  it('is a labelled group: question, optional detail, then cancel before confirm', () => {
    renderConfirm({ children: '说了不来的人不会收到。' });
    const group = screen.getByRole('group', { name: QUESTION });
    expect(Array.from(group.children).map((el) => el.className)).toEqual([
      'ci__q',
      'ci__detail',
      'ci__actions',
    ]);
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual([CANCEL, CONFIRM]);
  });

  it('renders no detail block without children, or for a falsy `{cond && …}`', () => {
    renderConfirm();
    expect(screen.getByRole('group', { name: QUESTION }).querySelector('.ci__detail')).toBeNull();
    cleanup();
    renderConfirm({ children: false });
    expect(screen.getByRole('group', { name: QUESTION }).querySelector('.ci__detail')).toBeNull();
  });

  it('focuses the cancel button by default (DiscordLinkCard’s way)', () => {
    renderConfirm();
    expect(screen.getByRole('button', { name: CANCEL })).toHaveFocus();
  });

  it('focus="confirm" focuses the confirm button (AdminScoreForm’s way)', () => {
    renderConfirm({ focus: 'confirm' });
    expect(screen.getByRole('button', { name: CONFIRM })).toHaveFocus();
  });

  it('the confirm is a danger outline button by default', () => {
    renderConfirm();
    expect(screen.getByRole('button', { name: CONFIRM })).toHaveClass('btn', 'btn--danger-outline');
  });

  it('tone="primary" uses the gold button', () => {
    renderConfirm({ tone: 'primary' });
    expect(screen.getByRole('button', { name: CONFIRM })).toHaveClass('btn', 'btn--gold');
  });

  it('calls onCancel / onConfirm', async () => {
    const user = userEvent.setup();
    const { onConfirm, onCancel } = renderConfirm();
    await user.click(screen.getByRole('button', { name: CANCEL }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: CONFIRM }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('busy disables both buttons and shows busyLabel on the confirm', () => {
    renderConfirm({ busy: true, busyLabel: '处理中…' });
    expect(screen.getByRole('button', { name: CANCEL })).toBeDisabled();
    expect(screen.getByRole('button', { name: '处理中…' })).toBeDisabled();
  });

  it('focuses once: typing into a field in children is not interrupted', async () => {
    const user = userEvent.setup();
    function WithField() {
      const [reason, setReason] = useState('');
      return (
        <ConfirmInline question={QUESTION} confirmLabel={CONFIRM} cancelLabel={CANCEL} onConfirm={() => {}} onCancel={() => {}}>
          <input aria-label="理由" value={reason} onChange={(e) => setReason(e.target.value)} />
        </ConfirmInline>
      );
    }
    render(<WithField />);
    const field = screen.getByLabelText('理由');
    await user.click(field);
    await user.type(field, 'jiaban');
    expect(field).toHaveValue('jiaban');
    expect(field).toHaveFocus();
  });

  it('never installs a document keydown listener (Escape belongs to the Modal stack)', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    renderConfirm();
    expect(addSpy.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(0);
    addSpy.mockRestore();
  });
});
```

（`处理中…` 只是测试里的占位值。真实调用方的 busyLabel 文案由各自 PR 按 spec 定。）

- [ ] **Step 2: 运行，确认失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/confirm-inline.test.tsx
```

预期：FAIL，报 `Failed to resolve import "../../src/components/ConfirmInline"`。

- [ ] **Step 3: 实现 `src/components/ConfirmInline.tsx`**

```tsx
import { useEffect, useRef } from 'react';
import './confirm-inline.css';

export interface ConfirmInlineProps {
  /** 「取消这局？」 Also the group's aria-label. */
  question: string;
  /** Detail text or extra fields (e.g. P2's cancel reason), between the question and the buttons. */
  children?: React.ReactNode;
  confirmLabel: string; // 「确认取消」
  cancelLabel: string; // 「不取消了」
  onConfirm: () => void;
  onCancel: () => void;
  /** Which button takes focus on mount. Default 'cancel' (DiscordLinkCard's way); 'confirm' is AdminScoreForm's way. */
  focus?: 'cancel' | 'confirm';
  /** 'danger' → .btn--danger-outline (default); 'primary' → .btn--gold. */
  tone?: 'danger' | 'primary';
  busy?: boolean; // disables both buttons; the confirm shows busyLabel
  busyLabel?: string;
}

/** `{cond && <Field />}` yields false: that is no detail either, not an empty box. */
function hasContent(node: React.ReactNode): boolean {
  return node !== undefined && node !== null && typeof node !== 'boolean';
}

const CONFIRM_CLASS: Record<NonNullable<ConfirmInlineProps['tone']>, string> = {
  danger: 'btn btn--danger-outline',
  primary: 'btn btn--gold',
};

/**
 * An in-place confirm that takes the trigger button's spot — not a layer, so it
 * never touches the Modal stack and never listens for Escape (the surrounding
 * Modal owns that). DOM order is cancel → confirm, the same as the visual order.
 * Pair it with useInlineConfirm so backing out puts focus on the trigger again.
 */
export function ConfirmInline({
  question,
  children,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  focus = 'cancel',
  tone = 'danger',
  busy = false,
  busyLabel,
}: ConfirmInlineProps): JSX.Element {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Mount only: `children` may hold a field (P2's cancel reason), and re-focusing
  // on a later render would yank the caret out of it — the bug modal-focus.test.tsx pins.
  useEffect(() => {
    const target = focus === 'confirm' ? confirmRef.current : cancelRef.current;
    target?.focus();
  }, []);

  return (
    <div className="ci" role="group" aria-label={question}>
      <p className="ci__q">{question}</p>
      {hasContent(children) && <div className="ci__detail">{children}</div>}
      <div className="ci__actions">
        <button ref={cancelRef} type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </button>
        <button ref={confirmRef} type="button" className={CONFIRM_CLASS[tone]} onClick={onConfirm} disabled={busy}>
          {busy && busyLabel !== undefined ? busyLabel : confirmLabel}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 实现 `src/components/confirm-inline.css`**

```css
/* ConfirmInline: takes the trigger's place inside the card/dialog, so it reads
 * as part of the flow rather than a layer. Cancel comes first in the DOM and on
 * screen; the row is right-aligned without reversing anything. */
.ci {
  display: grid;
  gap: 0.6rem;
  padding: 0.85rem 1rem;
  border: 1px solid var(--border-strong);
  border-radius: var(--r-md);
  background: var(--panel-2);
}

.ci__q {
  font-weight: 600;
  font-size: var(--fs-md);
  color: var(--text);
}

.ci__detail {
  font-size: var(--fs-sm);
  color: var(--muted);
}

.ci__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
}

@media (max-width: 600px) {
  .ci__actions > .btn {
    flex: 1 1 0;
    min-height: var(--tap-min);
  }
}
```

（危险确认用的 `.btn--danger-outline` 由 P0-1 在 theme.css 里提供；`.btn--ghost` 和 `.btn--gold` 已经存在，快照中分别在 `src/theme.css:246` 和 `:223`。）

- [ ] **Step 5: 运行，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/confirm-inline.test.tsx
npx vitest run --config vitest.config.ts tests/unit/css-conventions.test.ts
npm run typecheck
```

预期：`confirm-inline` 10 个 PASS；dom 全量 10 个文件 / 84 个用例 PASS；`css-conventions` PASS；typecheck PASS。

- [ ] **Step 6: 提交**

```bash
git add src/components/ConfirmInline.tsx src/components/confirm-inline.css tests/dom/confirm-inline.test.tsx
git commit -m "feat: 新增 ConfirmInline 原地确认原语"
```

---

### Task 8: `useInlineConfirm`，退出确认后焦点回到触发按钮

**Files:**
- Create: `src/lib/useInlineConfirm.ts`
- Modify: `tests/dom/confirm-inline.test.tsx`（加一行 import，并在末尾追加）

- [ ] **Step 1: 写失败的测试**

在 `tests/dom/confirm-inline.test.tsx` 的 import 区，紧跟在 `import { ConfirmInline } from '../../src/components/ConfirmInline';` 下一行插入：

```tsx
import { useInlineConfirm } from '../../src/lib/useInlineConfirm';
```

再把下面这段追加到文件末尾：

```tsx
/** The trigger and the confirm swap places, as every caller will do it. */
function CancelSession({ onDone }: { onDone: () => void }) {
  const confirm = useInlineConfirm();
  if (!confirm.confirming) {
    return (
      <button ref={confirm.triggerRef} type="button" onClick={confirm.ask}>
        取消这局
      </button>
    );
  }
  return (
    <ConfirmInline
      question={QUESTION}
      confirmLabel={CONFIRM}
      cancelLabel={CANCEL}
      onCancel={confirm.dismiss}
      onConfirm={() => {
        onDone();
        confirm.close();
      }}
    />
  );
}

describe('useInlineConfirm', () => {
  it('backing out puts focus back on the trigger', async () => {
    const user = userEvent.setup();
    render(<CancelSession onDone={() => {}} />);

    await user.click(screen.getByRole('button', { name: '取消这局' }));
    expect(screen.getByRole('button', { name: CANCEL })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: CANCEL }));
    expect(screen.queryByRole('group', { name: QUESTION })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消这局' })).toHaveFocus();
  });

  it('close() after a confirm hides it without moving focus to the trigger', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<CancelSession onDone={onDone} />);

    await user.click(screen.getByRole('button', { name: '取消这局' }));
    await user.click(screen.getByRole('button', { name: CONFIRM }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '取消这局' })).not.toHaveFocus();
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/confirm-inline.test.tsx
```

预期：FAIL，报 `Failed to resolve import "../../src/lib/useInlineConfirm"`。

- [ ] **Step 3: 实现 `src/lib/useInlineConfirm.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * State for a ConfirmInline that replaces its trigger button. The trigger
 * unmounts while the confirm shows, so "focus back on the trigger" has to wait
 * for the re-render that brings it back — the effect below does exactly that,
 * and only after `dismiss` (backing out), never after `close` (done).
 */
export function useInlineConfirm<T extends HTMLElement = HTMLButtonElement>(): {
  confirming: boolean;
  /** Show the confirm (the trigger unmounts). */
  ask: () => void;
  /** Back out: hide the confirm, then focus the trigger again after the re-render. */
  dismiss: () => void;
  /** Done (after a successful confirm): hide without moving focus. */
  close: () => void;
  triggerRef: React.RefObject<T>;
} {
  const [confirming, setConfirming] = useState(false);
  const triggerRef = useRef<T>(null);
  const refocusRef = useRef(false);

  useEffect(() => {
    if (confirming || !refocusRef.current) {
      return;
    }
    refocusRef.current = false;
    triggerRef.current?.focus();
  }, [confirming]);

  const ask = useCallback(() => {
    refocusRef.current = false;
    setConfirming(true);
  }, []);
  const dismiss = useCallback(() => {
    refocusRef.current = true;
    setConfirming(false);
  }, []);
  const close = useCallback(() => {
    refocusRef.current = false;
    setConfirming(false);
  }, []);

  return { confirming, ask, dismiss, close, triggerRef };
}
```

- [ ] **Step 4: 运行，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/confirm-inline.test.tsx
npx vitest run --config vitest.dom.config.ts
npm run typecheck
```

预期：`confirm-inline` 12 个 PASS；dom 全量 **10 个文件 / 86 个用例** PASS；typecheck PASS。

- [ ] **Step 5: 提交**

```bash
git add src/lib/useInlineConfirm.ts tests/dom/confirm-inline.test.tsx
git commit -m "feat: 新增 useInlineConfirm，取消确认后焦点回到触发按钮"
```

---

## 收尾

### 全量验证（提 PR 前、rebase 到最新 origin/main 之后各跑一次）

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
git fetch origin && git rebase origin/main
npm run typecheck
npx vitest run --config vitest.config.ts
npx vitest run --config vitest.dom.config.ts
npx vitest run --config vitest.dom.config.ts tests/dom/modal-focus.test.tsx tests/dom/modal-stack.test.tsx tests/dom/confirm-inline.test.tsx
npm run build
git diff origin/main --stat -- src/components tests/dom/modal-focus.test.tsx
```

预期：
- typecheck PASS（三个 tsconfig）。
- unit：与 Task 0 记下的数量一致，全部 PASS（本 PR 不加 unit 用例，P0-1 的 `css-conventions`、`contrast` 都绿）。
- dom：10 个文件 / 86 个用例全部 PASS，即基线 54 加上 `modal-stack` 20 和 `confirm-inline` 12；`modal-focus.test.tsx` 4/4，文件本身没改过。
- 不能新增 React `act(...)` 警告（已有的只有 `onboarding-roles` 那 3 条）。
- `npm run build` 成功。
- 最后一条 `git diff --stat` 里，`src/components` 下只应出现 `Modal.tsx`、`modal.css`、`ConfirmInline.tsx`、`confirm-inline.css`；`modal-focus.test.tsx` 不应出现。

本 PR 不碰 worker/、server/、shared/，所以不用跑 `vitest.workers.config.ts`；`test:server`、`test:pg` 交给 CI。

### 手动检查（`npm run dev` + `npm run dev:web`，打开 http://localhost:5173，用 DevTools 设备模拟 375×812 和 1280×800）

**A. 现有弹窗不变（不改任何代码，两种宽度都看）**
- [ ] 打开「约一局」（SessionFormDialog）、选手详情（PlayerDetail）、首登身份（OnboardingDialog），外观与改动前一致：✕ 在右上角，位置、大小、hover 效果都一样；在 DevTools 里开 coarse pointer 模拟时，✕ 至少 44×44。
- [ ] 在弹窗里连续打字不丢字；按 Tab 不会跑出弹窗；按 Esc 关闭后焦点回到打开它的按钮；点背景能关。
- [ ] 打开弹窗时背景页不能滚动；关闭后能滚动。
- [ ] 嵌套场景（组织者或管理员身份、约局状态 open 且已开始 → 约局详情 →「点名结算」打开 RollCallDialog，见 `SessionDetailDialog.tsx:82,197-204`）：按一次 Esc 只关点名层，详情还在，焦点回到「点名结算」按钮；再按一次 Esc，详情才关；关完后页面能正常滚动。

**B. sheet / drawer 外观（本地临时改动，看完用 `git restore` 撤销，不要提交）**

临时把 `src/components/PlayerDetail.tsx:136` 改成：

```tsx
    <Modal open onClose={onClose} labelledBy="player-detail-title" size="lg" variant="sheet">
```

再把 `src/components/SessionFormDialog.tsx:94` 改成：

```tsx
    <Modal open={open} onClose={close} labelledBy="session-form-title" size="md" variant="sheet" dismissible={false}>
```

- [ ] **375px**：两个弹窗都贴在底部，顶部有圆角，最高约占屏幕 92%，能看到抓手。内容在面板里面滚动，背景页不跟着动。往下滚到底，✕ 一直在 bar 上看得见，bar 和面板顶边之间没有露出内容。在 iPhone 模拟器或真机上，底部留出了安全区。
- [ ] **375px**：SessionFormDialog（`dismissible={false}`）点上方的灰色背景不会关闭，按 Esc 或 ✕ 会关闭。
- [ ] **1280px**：两个 sheet 和 center 一样居中显示，没有抓手，bar 吸顶，✕ 是 44×44。
- [ ] 把 `variant="sheet"` 换成 `variant="drawer"` 再看一次：1280px 时贴在右侧，宽 480px，整高，面板内部滚动；800px 时居中；375px 时贴底。
- [ ] 打开 DevTools → Rendering → `prefers-reduced-motion: reduce`，sheet 没有滑入动画。打开 `forced-colors: active`，✕ 和 bar 的分隔线仍然看得见。
- [ ] 看完执行 `git restore src/components/PlayerDetail.tsx src/components/SessionFormDialog.tsx`，再用 `git status` 确认工作区是干净的。

**C. CSP**
- [ ] `npm run build:pages` 成功。本 PR 的样式只通过类名和 CSSOM（`body.style.overflow`，今天就是这么做的）生效，没有 `style="…"` 字符串，没有 `<style>` 注入，也没有 `dangerouslySetInnerHTML`。浏览器控制台不应出现 CSP 报错。

### PR 描述要点
- 标题：`feat: Modal 层栈、sheet 形态与 ConfirmInline（P0-2）`
- 对应 spec §6.4、§9 P0-2；修复 M10（嵌套弹层 Esc 连关、Tab 被抢），解决 H2 的一部分（sheet 和 sticky bar 已就位，调用方从 P0-5 和 P0-6 起开始用）。
- 锁定测试以外的行为变化，只有两条：嵌套时 Esc 只关最上层；两层同时卸载后 body 能恢复滚动（见「对契约的补充」第 1 条）。
- 新增测试：`tests/dom/modal-stack.test.tsx`（20 个）、`tests/dom/confirm-inline.test.tsx`（12 个）；`tests/dom/setup.ts` 加了 `afterEach` 重置。
- 附上手动检查 B 项在 375px 和 1280px 下的截图，并注明是临时改动、没有提交。
- 不加 `Co-Authored-By`，也不加「Generated with」之类的署名。

---

## 自查

| spec / 契约要求 | 覆盖的任务 |
|---|---|
| Modal 改为模块级的栈，Esc 和 Tab 只由栈顶处理（§6.4、M10） | Task 1（`modalStack.ts`）、Task 2（`layerKeyHandler` 第一行判断 `isTopLayer`；嵌套 Esc / Tab / 焦点还原用例） |
| 焦点陷阱、`#root` inert 引用计数、关闭后还原焦点、`onCloseRef` 全部保留；`modal-focus.test.tsx` 原样通过 | Task 2（inert 计数原样挪进 modalStack；setup effect 只依赖 `active`）、每个任务的 Step 4 都跑 `modal-focus` |
| `variant` 默认 center，行为与 markup 不变 | Task 4（`isLegacyLayout`；`center without title keeps today's markup exactly`） |
| sheet：≤600px 贴底，最高 92dvh，内部滚动，sticky `.modal__bar` 里放抓手、标题和 44px 关闭按钮，底部留安全区 | Task 4（markup 和用例）、Task 6（CSS）、收尾手动检查 B |
| drawer：≥1024px 右侧 480px，<1024px 退化（契约 §3.2） | Task 4、Task 6、收尾手动检查 B |
| page：不 portal、不加 inert、不困焦点、不入栈、Esc 不关、聚焦标题（没有标题时聚焦 section）、不渲染 ✕ | Task 5（4 个用例） |
| 可选的 `dismissible`：点背景不关，Esc 和 ✕ 仍然调 onClose | Task 3 |
| 可选的 `title`：渲染成 `h2#labelledBy.modal__title` | Task 4 |
| `ConfirmInline` 原语：`role=group` 加 aria-label，DOM 顺序先取消后确认，两种焦点落点，tone，busy，不处理 Esc，不装 keydown | Task 7 |
| `useInlineConfirm`：`dismiss` 后焦点回到触发按钮，`close` 后不移动焦点 | Task 8 |
| 测试用的栈重置函数；`tests/dom/setup.ts` 的 `afterEach` 重置栈和 inert 计数 | Task 1 |
| 新增 `modal-stack.test.tsx`：嵌套 Esc 只关上层、Tab 只在上层循环、page 不加 inert / 不困焦点、reset 后 `#root` 没有 inert | Task 1、2、5 |
| 机主规则：函数 < 50 行、不可变更新、无 console.log | `Modal` 拆出 `Layer`（Task 4）；`modalStack` 一律整体替换数组（Task 1）；全文无 console |
| `.modal__close` 的 coarse 规则从 theme.css 挪进 modal.css（契约 §2.3） | Task 6 |
| 新 CSS 遵守 P0-1 的断点、hover、焦点约定（契约 §3.1） | Task 6、Task 7（跑 `css-conventions`） |
| 组件签名只加可选 props；8 个调用方不改 | Task 3/4/5 只加可选 props；收尾的 `git diff --stat` 检查 |
| DOM 顺序 = 视觉顺序；不用 CSS `order`、`*-reverse` | Task 7（`.ci__actions` 用 `justify-content: flex-end`，不反转）、Task 4（bar 里依次是抓手、标题、✕） |
| CSP：不注入 inline style 字符串 | 全程只用类名和 CSSOM；收尾 C |
| 新 ConfirmInline 不用裸的「取消」「确认」按钮名（§6.5） | Task 7、8 的用例统一用「不取消了」「确认取消」（spec §3.5 原文） |
| 每个打开的 Modal 只装一个 document keydown 监听；ConfirmInline 不在渲染时装监听（契约 §5） | Task 2（`modal-focus:63-75`）、Task 7（`never installs a document keydown listener`） |
| StrictMode 下 push / pop 按 id 幂等（契约 §5 第 5 条） | Task 1（id 不复用、`popLayer` 重复调用无害的用例）、Task 2（`StrictMode’s mount → unmount → mount…`：真实 `<StrictMode>` 下层数、inert、Esc、焦点还原、滚动锁） |
