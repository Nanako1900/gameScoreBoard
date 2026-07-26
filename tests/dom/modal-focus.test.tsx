import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from '../../src/components/Modal';

// No manual body cleanup: Modal portals into document.body, so wiping innerHTML
// pulls the portal container out from under React's unmount. Testing Library's
// automatic cleanup (enabled by `globals: true`) unmounts properly instead.

/**
 * Reproduces the shipped bug: every field inside every dialog dropped characters.
 *
 * Modal's focus-trap effect listed `onClose` in its dependencies. Callers pass
 * inline arrows, so a parent re-render produced a new function identity — and a
 * parent re-renders on every keystroke in a field it owns. The effect therefore
 * tore down and rebuilt per character, and its setup calls `.focus()` on the
 * `[data-autofocus]` element, yanking the caret out of whatever was being typed.
 *
 * These tests type more than one character on purpose: the bug is invisible with
 * a single keystroke, which is exactly why it reached production.
 */
function Harness({ onClose = (): void => {} }: { onClose?: () => void }) {
  const [text, setText] = useState('');
  const [other, setOther] = useState('');
  return (
    // The inline arrow is the point — this is how every real caller does it.
    <Modal open onClose={() => onClose()} labelledBy="t">
      <h2 id="t">测试弹窗</h2>
      <input aria-label="first" data-autofocus value={text} onChange={(e) => setText(e.target.value)} />
      <textarea aria-label="second" value={other} onChange={(e) => setOther(e.target.value)} />
    </Modal>
  );
}

describe('Modal — typing is not interrupted', () => {
  it('keeps every character typed into the autofocused field', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const first = screen.getByLabelText('first');
    await user.type(first, 'shuohaobadian');

    expect(first).toHaveValue('shuohaobadian');
    expect(document.activeElement).toBe(first);
  });

  it('does not yank focus back to the autofocus target while typing elsewhere', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const second = screen.getByLabelText('second');
    await user.click(second);
    await user.type(second, 'wancheng');

    // The old bug: focus jumped to `first` (the [data-autofocus] element) on the
    // first keystroke, so `second` ended up holding one character at most.
    expect(second).toHaveValue('wancheng');
    expect(document.activeElement).toBe(second);
    expect(screen.getByLabelText('first')).toHaveValue('');
  });

  it('runs the focus-trap setup exactly once across many re-renders', async () => {
    const user = userEvent.setup();
    const addSpy = vi.spyOn(document, 'addEventListener');
    render(<Harness />);

    const before = addSpy.mock.calls.filter(([e]) => e === 'keydown').length;
    await user.type(screen.getByLabelText('first'), 'abcdefgh');
    const after = addSpy.mock.calls.filter(([e]) => e === 'keydown').length;

    // Eight keystrokes must not re-install the trap eight times.
    expect(after).toBe(before);
    addSpy.mockRestore();
  });

  it('still closes on Escape using the latest onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    // Reading onClose from a ref must not mean reading a stale one.
    await user.type(screen.getByLabelText('first'), 'x');
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
