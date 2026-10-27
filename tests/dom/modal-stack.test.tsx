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

/**
 * Two nested modal layers in miniature: the inner dialog is a sibling
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
