import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CasesPage } from '../../src/components/CasesPage';
import { bootRouter } from '../../src/lib/router';
import type { TodoItem } from '../../src/lib/todo';
import type { Config, RecordItem, User } from '../../src/types';

const NOW = Date.parse('2026-10-28T10:00:00Z');
const ME: User = { id: 'me', username: '我', oauth_username: '我', avatar_url: null, is_participant: true,
  is_judge: false, is_admin: false, score: 98, created_at: '2026-10-01 00:00:00' };
const CONFIG: Config = { violations: [], tiers: [], weeklyHeal: 5, statementWindowHours: 12,
  aiEnabled: false, maxBatchSubjects: 8, nextResetAt: '2026-11-01T16:00:00Z', boardTzOffsetHours: 8 };
function record(patch: Partial<RecordItem> = {}): RecordItem {
  return { id: 1, subject: { id: 'me', username: '已判选手', avatar_url: null },
    reporter: { id: 'j', username: '裁判', avatar_url: null }, type: 'late_minor', delta: -3, note: null,
    claim: null, claim_summary: null, classified_by: 'ai', escalation_suggested: false, session_id: null,
    statement: null, statement_at: null, appeal_reason: null, deadline_at: null, status: 'decided', verdict: null,
    range: { min: -5, max: -1, base: -3 }, created_at: '2026-10-28 09:00:00', ...patch };
}
const PENDING = record({ id: 9, status: 'awaiting_statement', delta: 0,
  deadline_at: new Date(NOW + 3_600_000).toISOString() });
const ITEMS: TodoItem[] = [
  { kind: 'onboarding', key: 'onboarding', missing: [2, 3] },
  { kind: 'statement', key: 'statement:9', record: PENDING, urgent: true },
];
const RECORDS = [record(),
  record({ id: 2, status: 'appealed', subject: { id: 'a', username: '申诉选手', avatar_url: null } }),
  record({ id: 3, status: 'withdrawn', subject: { id: 'w', username: '撤案选手', avatar_url: null }, delta: 0 }),
  record({ id: 4, status: 'revoked', subject: { id: 'r', username: '撤销选手', avatar_url: null }, delta: 0 }),
  record({ id: 5, type: 'on_time_bonus', subject: { id: 'b', username: '历史选手', avatar_url: null }, delta: 2 }),
  record({ id: 6, status: 'awaiting_statement', subject: { id: 'p', username: '处理中甲', avatar_url: null }, type: null,
    delta: 0, range: null, pending_hidden: true, redacted: true }),
  record({ id: 7, status: 'judging', subject: { id: 'q', username: '处理中乙', avatar_url: null }, type: null,
    delta: 0, range: null, pending_hidden: true, redacted: true }),
];
function mount(over: Partial<React.ComponentProps<typeof CasesPage>> = {}, path = '/cases') {
  window.history.replaceState(null, '', path); bootRouter();
  const callbacks = { onOpenStatement: vi.fn(), onOpenPlayer: vi.fn() };
  const view = render(<CasesPage me={ME} config={CONFIG} now={NOW} items={ITEMS} records={RECORDS} {...callbacks} {...over} />);
  return { ...callbacks, ...view };
}
function feedRows(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('.feed__list > li'));
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('the cases destination', () => {
  it('starts signed-in members at the complete case inbox and omits the home-only onboarding hint', async () => {
    const { onOpenStatement } = mount();
    expect(screen.getByRole('heading', { name: '案件', level: 2 })).toHaveFocus();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '我的待办' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { name: '要你处理 · 1' })).toBeInTheDocument();
    expect(screen.queryByText(/完成入户/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '裁判工具' })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: '写说明 ›' }));
    expect(onOpenStatement).toHaveBeenCalledExactlyOnceWith(PENDING);
  });

  it('keeps an unknown inbox loading instead of claiming that there are no tasks', () => {
    mount({ items: null });
    expect(screen.getByText('要你处理加载中').closest('[aria-busy]')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('没有待办，清清爽爽 ✨')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /要你处理 · 0/ })).not.toBeInTheDocument();
  });

  it('does not turn an onboarding hint into a case task', () => {
    mount({ items: ITEMS.filter(item => item.kind === 'onboarding') });
    expect(screen.getByText('没有待办，清清爽爽 ✨')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '要你处理' })).toBeInTheDocument();
    expect(screen.queryByText(/完成入户/)).not.toBeInTheDocument();
  });

  it('lets visitors read public records without mounting the private inbox or making a new request', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    mount({ me: null });
    expect(screen.getByRole('link', { name: '公开记录' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('link', { name: '我的待办' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /要你处理/ })).not.toBeInTheDocument();
    expect(screen.getByText('已判选手')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('honors the public view query for a signed-in member', () => {
    mount({}, '/cases?view=public');
    expect(screen.getByRole('link', { name: '公开记录' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('combobox', { name: '案件状态' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '写说明 ›' })).not.toBeInTheDocument();
  });

  it('supports the old feed host and makes tab navigation addressable', async () => {
    mount({ initialTab: 'public' }, '/board/feed');
    expect(screen.getByRole('link', { name: '公开记录' })).toHaveAttribute('aria-current', 'page');
    await userEvent.setup().click(screen.getByRole('link', { name: '我的待办' }));
    expect(window.location.pathname).toBe('/cases');
    expect(screen.getByRole('link', { name: '我的待办' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: '写说明 ›' })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('link', { name: '公开记录' }));
    expect(window.location.search).toBe('?view=public');
    act(() => window.history.back());
    await waitFor(() => expect(screen.getByRole('link', { name: '我的待办' })).toHaveAttribute('aria-current', 'page'));
  });

  it.each([
    { ...ME, is_judge: true }, { ...ME, is_admin: true },
  ])('shows the same real tools destination to judges and administrators: %o', (me) => {
    mount({ me });
    expect(screen.getByRole('link', { name: '裁判工具' })).toHaveAttribute('href', '/tools');
  });

  it('keeps all states and historical bonus records reachable through client-side filters', async () => {
    const { container } = mount({}, '/cases?view=public');
    expect(feedRows(container)).toHaveLength(RECORDS.length);
    const select = screen.getByRole('combobox', { name: '案件状态' }); const user = userEvent.setup();
    for (const [value, names] of [
      ['decided', ['已判选手', '历史选手']], ['appealed', ['申诉选手']], ['withdrawn', ['撤案选手']],
      ['revoked', ['撤销选手']], ['bonus', ['历史选手']], ['processing', ['处理中甲', '处理中乙']],
    ] as const) {
      await user.selectOptions(select, value);
      const rows = feedRows(container); expect(rows).toHaveLength(names.length);
      names.forEach(name => expect(rows.some(row => row.textContent?.includes(name))).toBe(true));
    }
    expect(within(container.querySelector('.feed')!).queryByText('待说明')).not.toBeInTheDocument();
    expect(within(container.querySelector('.feed')!).queryByText('裁决中')).not.toBeInTheDocument();
  });

  it('falls back to the loaded records for an unrecognized filter rather than inventing an empty result', () => {
    const { container } = mount({}, '/cases?view=public');
    const select = screen.getByRole('combobox', { name: '案件状态' });
    fireEvent.change(select, { target: { value: 'future-filter' } });
    expect(select).toHaveValue('all');
    expect(feedRows(container)).toHaveLength(RECORDS.length);
  });

  it('opens the exact case alias instead of selecting its player', async () => {
    const { onOpenPlayer } = mount({}, '/cases?view=public');
    await userEvent.setup().click(screen.getByRole('button', { name: /查看案件 #2/ }));
    expect(window.location.pathname).toBe('/cases/2');
    expect(onOpenPlayer).not.toHaveBeenCalled();
  });

  it('describes an empty loaded feed without claiming to contain the complete database', () => {
    mount({ records: [] }, '/cases?view=public');
    expect(screen.getByText('当前读取的记录中，没有符合条件的案件。')).toBeInTheDocument();
    expect(screen.getByText('本页显示当前已读取的记录。')).toBeInTheDocument();
  });
});
