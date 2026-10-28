import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HomeOverview } from '../../src/components/HomeOverview';
import type { TodoItem } from '../../src/lib/todo';
import type { Config, RecordItem, User, WeeklyReport } from '../../src/types';

const NOW = Date.parse('2026-10-28T12:00:00Z');
const ME: User = { id: 'me', username: '南栀', oauth_username: '南栀', avatar_url: null,
  is_participant: true, is_judge: false, is_admin: true, score: 98, created_at: '2026-10-01 00:00:00' };
const CONFIG: Config = { violations: [], tiers: [], weeklyHeal: 5, statementWindowHours: 12,
  aiEnabled: false, maxBatchSubjects: 5, nextResetAt: '2026-11-01T16:00:00Z', boardTzOffsetHours: 8 };
function record(id: number, patch: Partial<RecordItem> = {}): RecordItem {
  return { id, subject: { id: `p${id}`, username: `成员${id}`, avatar_url: null },
    reporter: { id: 'judge', username: '裁判', avatar_url: null }, type: 'no_show', delta: -10,
    note: null, claim: null, claim_summary: null, classified_by: 'human', escalation_suggested: false,
    session_id: null, statement: null, statement_at: null, appeal_reason: null, deadline_at: null,
    status: 'decided', verdict: null, range: { min: -20, max: -8, base: -15 }, created_at: '2026-10-27 12:00:00', ...patch };
}
const STATEMENT = record(128, { status: 'awaiting_statement', deadline_at: '2026-10-28 16:00:00',
  claim: '不能出现在首页的私密事实', statement: '不能出现在首页的私密说明' });
const REPORT: WeeklyReport = { week_start: '2026-10-19', source: 'ai', created_at: '2026-10-26 02:30:00',
  narrative: '这是一整篇战报正文，不应搬到首页。', stats: { weekStart: '2026-10-19', weekEnd: '2026-10-25', casesFiled: 3,
    totalPenalty: -10, absentVerdicts: 0, star: null, pigeon: null, bestTalker: null, harshest: null } };
const props = { me: ME, config: CONFIG, rank: 4, items: [] as readonly TodoItem[], records: [] as RecordItem[],
  report: null, onOpenPlayer: vi.fn(), now: NOW };

describe('HomeOverview information order', () => {
  it('shows a visible greeting and places the score before the inbox and recent verdicts', () => {
    render(<HomeOverview {...props} items={[{ kind: 'statement', key: 'statement:128', record: STATEMENT, urgent: false }]} />);
    expect(screen.getByRole('heading', { level: 1, name: '你好，南栀。' })).toBeVisible();
    expect(screen.getByRole('link', { name: /查看信誉榜/ })).toHaveAttribute('href', '/board');
    const score = screen.getByRole('region', { name: '我的分数' });
    const inbox = screen.getByRole('region', { name: '待办摘要' });
    const recent = screen.getByRole('region', { name: '最近判决' });
    expect(score.compareDocumentPosition(inbox) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(inbox.compareDocumentPosition(recent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '信誉榜' })).not.toBeInTheDocument();
  });

  it('shows score, rank and the configured capped recovery without a tier', async () => {
    const open = vi.fn(); render(<HomeOverview {...props} onOpenPlayer={open} />);
    const score = screen.getByRole('region', { name: '我的分数' });
    expect(score).toHaveClass('msl--overview');
    expect(score).toHaveTextContent('98'); expect(score).toHaveTextContent('第 4 名');
    expect(score).toHaveTextContent('回血 +5 → 预计 100');
    expect(score.textContent).not.toMatch(/段位|誓约之光/);
    await userEvent.setup().click(within(score).getByRole('button', { name: /我的分数与记录/ }));
    expect(open).toHaveBeenCalledExactlyOnceWith('me');
  });

  it('keeps the no-task state to one quiet line without a task card or zero badge', () => {
    const { container } = render(<HomeOverview {...props} />);
    expect(screen.getByText('当前没有待办。')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '待办摘要' })).not.toBeInTheDocument();
    expect(container.querySelector('.home-overview__todo.panel')).toBeNull();
    expect(screen.queryByText(/0 件事/)).not.toBeInTheDocument();
  });

  it('keeps unknown inbox data busy instead of announcing no tasks', () => {
    const { container } = render(<HomeOverview {...props} items={null} />);
    expect(screen.getByText('正在读取待办…')).toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText('当前没有待办。')).not.toBeInTheDocument();
    expect(screen.queryByText(/0 件事/)).not.toBeInTheDocument();
  });

  it('shows an unlisted state without a made-up score, rank or recovery', async () => {
    const open = vi.fn(); render(<HomeOverview {...props} me={{ ...ME, is_participant: false }} rank={null} onOpenPlayer={open} />);
    const score = screen.getByRole('region', { name: '我的分数' });
    expect(score).toHaveTextContent('当前不上榜');
    expect(score.textContent).not.toMatch(/98|100|回血|第.*名/);
    await userEvent.setup().click(within(score).getByRole('button', { name: /我的记录/ }));
    expect(open).toHaveBeenCalledWith('me');
  });
});

describe('HomeOverview inbox summary', () => {
  it('counts appeals as cases, leaves onboarding outside the count, and uses the real deadline', () => {
    const items: TodoItem[] = [
      { kind: 'onboarding', key: 'onboarding', missing: [2, 3] },
      { kind: 'statement', key: 'statement:128', record: STATEMENT, urgent: false },
      { kind: 'appeals', key: 'appeals', count: 4, earliest: null },
      { kind: 'escalation', key: 'escalation:129', record: record(129) },
    ];
    render(<HomeOverview {...props} items={items} />);
    const inbox = screen.getByRole('region', { name: '待办摘要' });
    expect(inbox).toHaveTextContent('有 6 件事需要处理');
    expect(inbox).toHaveTextContent('4 起申诉待复核');
    expect(inbox).toHaveTextContent('还剩 4 小时 0 分');
    expect(within(inbox).getByRole('link', { name: /查看待办/ })).toHaveAttribute('href', '/cases');
    expect(inbox).not.toHaveTextContent('私密事实'); expect(inbox).not.toHaveTextContent('私密说明');
    const onboarding = screen.getByRole('region', { name: '入户提示' });
    expect(onboarding).toHaveTextContent('还差 2 步完成入户');
    expect(within(onboarding).getByRole('link', { name: /继续入户/ })).toHaveAttribute('href', '/welcome');
  });

  it('retains the seven-day dismissal without inventing a case task', async () => {
    const dismiss = vi.fn(); render(<HomeOverview {...props} items={[{ kind: 'onboarding', key: 'onboarding', missing: [3] }]}
      onDismissOnboarding={dismiss} />);
    await userEvent.setup().click(screen.getByRole('button', { name: '7 天内不再提示' }));
    expect(dismiss).toHaveBeenCalledOnce();
    expect(screen.getByText('当前没有待办。')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '待办摘要' })).not.toBeInTheDocument();
  });

  it('does not turn a malformed deadline into an expired warning', () => {
    render(<HomeOverview {...props} items={[{ kind: 'statement', key: 'statement:128', record: { ...STATEMENT, deadline_at: 'bad-date' }, urgent: false }]} />);
    expect(screen.getByRole('region', { name: '待办摘要' })).not.toHaveTextContent('已截止');
  });
});

describe('HomeOverview recent verdicts and report', () => {
  it('takes three eligible records in existing feed order, with no expand control or mini board', () => {
    const records = [record(1, { status: 'awaiting_statement' }), record(2, { type: 'on_time_bonus' }),
      record(3), record(4, { status: 'appealed' }), record(5, { status: 'withdrawn' }),
      record(6, { type: 'organizer_bonus' }), record(7), record(8)];
    const { container } = render(<HomeOverview {...props} records={records} />);
    const recent = screen.getByRole('region', { name: '最近判决' });
    const rows = within(recent).getAllByRole('listitem'); expect(rows).toHaveLength(3);
    expect(rows.map(row => row.textContent)).toEqual([expect.stringContaining('成员3'), expect.stringContaining('成员4'), expect.stringContaining('成员7')]);
    expect(within(recent).queryByRole('button', { name: '看更多' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '全部案件' })).toHaveAttribute('href', '/cases?view=public');
    expect(container.querySelector('.lb')).toBeNull();
    expect(screen.queryByText('成员1')).not.toBeInTheDocument(); expect(screen.queryByText('成员2')).not.toBeInTheDocument();
  });

  it('opens the selected case rather than its member profile', async () => {
    const open = vi.fn(); render(<HomeOverview {...props} records={[record(3)]} onOpenPlayer={open} />);
    const row = within(screen.getByRole('region', { name: '最近判决' })).getByRole('listitem');
    await userEvent.setup().click(within(row).getByRole('button'));
    expect(window.location.pathname).toBe('/cases/3'); expect(open).not.toHaveBeenCalled();
  });

  it('does not disclose redacted bodies or pending identities in the home feed', () => {
    render(<HomeOverview {...props} records={[record(3, { redacted: true, claim: '秘密事实', claim_summary: '秘密概括', statement: '秘密陈述',
      appeal_reason: '秘密申诉', verdict: { source: 'ai', headline: '秘密判词', reasoning: '秘密推理', factors: [] } }),
    record(4, { status: 'judging', pending_hidden: true, subject: { id: 'private', username: '未决当事人', avatar_url: null } })]} />);
    for (const text of ['秘密事实', '秘密概括', '秘密陈述', '秘密申诉', '秘密判词', '秘密推理', '未决当事人']) expect(screen.queryByText(new RegExp(text))).not.toBeInTheDocument();
  });

  it('keeps report prose and awards off home while linking to the complete report', () => {
    render(<HomeOverview {...props} report={REPORT} />);
    const report = screen.getByRole('region', { name: '每周战报' });
    expect(report).toHaveTextContent('2026-10-19'); expect(report).toHaveTextContent('2026-10-25');
    expect(within(report).getByRole('link', { name: /阅读战报/ })).toHaveAttribute('href', '/board/report');
    expect(screen.queryByText(REPORT.narrative)).not.toBeInTheDocument();
    expect(screen.queryByText('本周之星')).not.toBeInTheDocument();
  });

  it('labels an old report and a missing report without promising a fresh one', () => {
    const view = render(<HomeOverview {...props} report={REPORT} reportStale />);
    expect(screen.getByRole('region', { name: '每周战报' })).toHaveTextContent('往期战报');
    view.rerender(<HomeOverview {...props} report={null} />);
    expect(screen.getByText('暂无战报')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /阅读战报/ })).not.toBeInTheDocument();
  });
});

describe('HomeOverview signed-out entry', () => {
  it('shows a compact start entry and no former user score or task data', () => {
    render(<HomeOverview {...props} me={null} items={[{ kind: 'statement', key: 'statement:128', record: STATEMENT, urgent: false }]} />);
    expect(screen.getByRole('heading', { level: 1, name: 'EDG 信誉分' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '开始' })).toHaveAttribute('href', '/welcome');
    expect(screen.queryByRole('region', { name: '我的分数' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '待办摘要' })).not.toBeInTheDocument();
    expect(screen.queryByText(/私密事实|私密说明/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '不再显示欢迎卡' })).not.toBeInTheDocument();
  });

  it('keeps the compact start entry reachable even after the older long welcome card was dismissed', () => {
    localStorage.setItem('edg.welcome.dismissed', '1');
    render(<HomeOverview {...props} me={null} />);
    expect(screen.getByRole('link', { name: '开始' })).toHaveAttribute('href', '/welcome');
  });
});

describe('pending privacy flags in the overview', () => {
  it('keeps a hidden pending record out of recent verdicts even if a cached status disagrees', () => {
    render(<HomeOverview {...props} records={[record(71, { pending_hidden: true, status: 'decided' }), record(72)]} />);
    const recent = screen.getByRole('region', { name: '最近判决' });
    expect(within(recent).queryByRole('button', { name: /#71/ })).not.toBeInTheDocument();
    expect(within(recent).getByRole('button', { name: /#72/ })).toBeInTheDocument();
  });
});
