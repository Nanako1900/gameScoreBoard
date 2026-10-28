import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RecordsFeed } from '../../src/components/RecordsFeed';
import type { RecordItem } from '../../src/types';

function record(patch: Partial<RecordItem> = {}): RecordItem {
  return { id: 7, subject: { id: 'p', username: '选手', avatar_url: null },
    reporter: { id: 'j', username: '裁判', avatar_url: null }, type: 'no_show', delta: -12, note: null,
    claim: '约好后没有到场', claim_summary: '公开摘要', classified_by: 'ai', escalation_suggested: false,
    session_id: null, statement: null, statement_at: null, appeal_reason: null, deadline_at: null,
    status: 'decided', verdict: { source: 'ai', headline: '授权可读判词', reasoning: '解释', factors: [] },
    range: { min: -20, max: -8, base: -15 }, created_at: '2026-10-28 09:00:00', ...patch };
}

describe('record feed destinations', () => {
  it('opens the case from one row entry without nesting the former player button', async () => {
    const r = record(); const selectCase = vi.fn(); const selectPlayer = vi.fn();
    render(<RecordsFeed records={[r]} onSelectRecord={selectCase} onSelectUser={selectPlayer} />);
    const entry = screen.getByRole('button', { name: /查看案件 #7/ });
    expect(entry).toHaveTextContent('选手');
    expect(entry).toHaveTextContent('放鸽子');
    expect(entry.querySelector('button, a, input')).toBeNull();
    expect(screen.queryByRole('button', { name: '选手' })).not.toBeInTheDocument();
    await userEvent.setup().click(entry);
    expect(selectCase).toHaveBeenCalledExactlyOnceWith(r);
    expect(selectPlayer).not.toHaveBeenCalled();
  });

  it('retains the old player destination when no record callback is supplied', async () => {
    const selectPlayer = vi.fn();
    render(<RecordsFeed records={[record()]} onSelectUser={selectPlayer} />);
    await userEvent.setup().click(screen.getByRole('button', { name: '选手' }));
    expect(selectPlayer).toHaveBeenCalledExactlyOnceWith('p');
    expect(screen.queryByRole('button', { name: /查看案件/ })).not.toBeInTheDocument();
  });

  it.each(['最近判决', ''])('shows header actions without inventing a title: %j', (title) => {
    render(<RecordsFeed title={title} records={[]} headerActions={<a href="/cases?view=public">全部案件</a>} />);
    const action = screen.getByRole('link', { name: '全部案件' });
    expect(action.closest('header')).not.toBeNull();
    expect(action).toHaveAttribute('href', '/cases?view=public');
    if (title === '') expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    else expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
  });

  it('keeps the show-more focus handoff when rows open cases', async () => {
    render(<RecordsFeed records={[1, 2, 3, 4].map(id => record({ id }))} previewCount={2} onSelectRecord={vi.fn()} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    await userEvent.setup().click(screen.getByRole('button', { name: '看更多' }));
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(rows[2]).toHaveFocus();
    expect(within(rows[2]).getByRole('button', { name: /查看案件 #3/ })).toBeInTheDocument();
  });
});

describe('record feed privacy while entering cases', () => {
  it.each([
    { redacted: true },
    { pending_hidden: true, redacted: false, status: 'awaiting_statement' as const, escalation_suggested: true },
  ])('never renders private summary text left in a protected response: %o', (flags) => {
    const { container } = render(<RecordsFeed records={[record({ ...flags,
      claim_summary: 'PRIVATE_CLAIM_SUMMARY', verdict: { source: 'ai', headline: 'PRIVATE_VERDICT_HEADLINE', reasoning: '', factors: [] } })]}
      onSelectRecord={vi.fn()} />);
    expect(container.textContent).not.toContain('PRIVATE_CLAIM_SUMMARY');
    expect(container.textContent).not.toContain('PRIVATE_VERDICT_HEADLINE');
    if ('pending_hidden' in flags) {
      expect(container.textContent).not.toContain('放鸽子');
      expect(container.textContent).not.toContain('待说明');
      expect(container.textContent).not.toContain('待确认升级');
      expect(screen.getByText('处理中')).toBeInTheDocument();
    }
  });

  it('preserves summary text that the caller is authorized to read', () => {
    render(<RecordsFeed records={[record({ redacted: false })]} onSelectRecord={vi.fn()} />);
    expect(screen.getByText('“授权可读判词”')).toBeInTheDocument();
  });
});
