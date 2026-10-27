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
