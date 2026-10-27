import { useState } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmInline } from '../../src/components/ConfirmInline';
import { useInlineConfirm } from '../../src/lib/useInlineConfirm';

// Generic confirm labels are explicit about their action.
// New confirms never use the bare 「取消」/「确认」: those names are locked to
// DiscordLinkCard / IdentityForm / AdminScoreForm (spec §6.5).
const QUESTION = '删除这条？';
const CONFIRM = '确认删除';
const CANCEL = '保留';

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
    renderConfirm({ children: '删除之后无法恢复。' });
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

/** The trigger and the confirm swap places, as every caller will do it. */
function ConfirmAction({ onDone }: { onDone: () => void }) {
  const confirm = useInlineConfirm();
  if (!confirm.confirming) {
    return (
      <button ref={confirm.triggerRef} type="button" onClick={confirm.ask}>
        删除这条
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
    render(<ConfirmAction onDone={() => {}} />);

    await user.click(screen.getByRole('button', { name: '删除这条' }));
    expect(screen.getByRole('button', { name: CANCEL })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: CANCEL }));
    expect(screen.queryByRole('group', { name: QUESTION })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '删除这条' })).toHaveFocus();
  });

  it('close() after a confirm hides it without moving focus to the trigger', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<ConfirmAction onDone={onDone} />);

    await user.click(screen.getByRole('button', { name: '删除这条' }));
    await user.click(screen.getByRole('button', { name: CONFIRM }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '删除这条' })).not.toHaveFocus();
  });
});
