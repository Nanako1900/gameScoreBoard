import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RecordsFeed } from '../../src/components/RecordsFeed';
import { VerdictCard } from '../../src/components/VerdictCard';
import type { RecordItem } from '../../src/types';

// A case whose private parts the API blanked for this viewer (P8): the card
// says they exist without showing them, and never claims a statement was missing.

function record(over: Partial<RecordItem> = {}): RecordItem {
  return {
    id: 7,
    subject: { id: 'p', username: '选手', avatar_url: null },
    reporter: { id: 'j', username: '裁判', avatar_url: null },
    type: 'no_show',
    delta: -12,
    note: null,
    claim: '说好八点五排结果没来',
    claim_summary: '八点没来',
    classified_by: 'ai',
    escalation_suggested: false,
    session_id: null,
    statement: '家里有事',
    statement_at: '2026-10-26 10:00:00',
    appeal_reason: null,
    deadline_at: null,
    status: 'decided',
    verdict: { source: 'ai', headline: '情有可原，从轻', reasoning: '提前打了招呼', factors: [{ kind: 'mitigating', text: '提前告知' }] },
    range: { min: -20, max: -10, base: -15 },
    created_at: '2026-10-26 09:00:00',
    ...over,
  };
}

const hidden = (over: Partial<RecordItem> = {}) =>
  record({
    statement: null,
    appeal_reason: null,
    verdict: { source: 'ai', headline: '', reasoning: '', factors: [] },
    redacted: true,
    ...over,
  });

describe('VerdictCard, for a viewer who may not read the private parts', () => {
  it('says a statement was written, without calling it a verdict in absence', () => {
    render(<VerdictCard record={hidden()} />);
    expect(screen.getByText(/选手 写了说明/)).toBeInTheDocument();
    expect(screen.queryByText(/按缺席裁决/)).not.toBeInTheDocument();
    expect(screen.getByText(/判词只有当事人、立案人、裁判和管理员能看/)).toBeInTheDocument();
    // The outcome is still there.
    expect(screen.getAllByText('-12').length).toBeGreaterThan(0);
  });

  it('still says so when nobody wrote anything', () => {
    render(<VerdictCard record={hidden({ statement_at: null })} />);
    expect(screen.getByText(/按缺席裁决/)).toBeInTheDocument();
  });

  it('shows no appeal reason (even one that slipped through), but still that it was appealed', () => {
    render(<VerdictCard record={hidden({ status: 'appealed', appeal_reason: 'LEAKEDREASON' })} />);
    expect(screen.queryByText('LEAKEDREASON')).not.toBeInTheDocument();
    expect(screen.queryByText('申诉理由')).not.toBeInTheDocument();
    expect(screen.getByText(/该选手已申诉/)).toBeInTheDocument();
  });
});

describe('VerdictCard, for those who may read it', () => {
  it('shows the statement and the verdict', () => {
    render(<VerdictCard record={record({ redacted: false, status: 'appealed', appeal_reason: '不服' })} />);
    expect(screen.getByText('家里有事')).toBeInTheDocument();
    expect(screen.getByText('情有可原，从轻')).toBeInTheDocument();
    expect(screen.getByText('不服')).toBeInTheDocument();
  });

  it('treats a record from an older API (no flag) as not hidden', () => {
    render(<VerdictCard record={record()} />);
    expect(screen.getByText('家里有事')).toBeInTheDocument();
    expect(screen.getByText('情有可原，从轻')).toBeInTheDocument();
    expect(screen.getByText('提前打了招呼')).toBeInTheDocument();
    expect(screen.queryByText(/写了说明/)).not.toBeInTheDocument();
  });
});

describe('VerdictCard, a bonus', () => {
  it('has no words to hide and no statement to miss', () => {
    const bonus = hidden({
      type: 'on_time_bonus',
      delta: 2,
      statement_at: null,
      verdict: { source: 'manual', headline: '守约', reasoning: '', factors: [] },
    });
    render(<VerdictCard record={bonus} />);
    expect(screen.getByText('守约')).toBeInTheDocument();
    expect(screen.queryByText(/判词只有/)).not.toBeInTheDocument();
    expect(screen.queryByText(/按缺席裁决/)).not.toBeInTheDocument();
  });
});

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

// B1-1 (spec §11 #3 tier b): before the verdict, what the API sends anyone
// unrelated to the case — type, accusation, note and range are gone.
const pendingHidden = (over: Partial<RecordItem> = {}) =>
  record({
    type: null,
    range: null,
    delta: 0,
    note: null,
    claim: null,
    claim_summary: null,
    escalation_suggested: false,
    statement: null,
    statement_at: null,
    // 3.5 h ahead: the countdown reads 「还剩 3 小时 29 分」 (or 30 分 within the same millisecond) — never a bare 0.
    deadline_at: new Date(Date.now() + 3.5 * 3_600_000).toISOString(),
    status: 'awaiting_statement',
    verdict: null,
    redacted: true,
    pending_hidden: true,
    ...over,
  });

describe('VerdictCard, a case the API hid before its verdict', () => {
  it('only says a case is in progress, and that the score waits for the verdict — never a 0', () => {
    const { container } = render(<VerdictCard record={pendingHidden()} focused />);
    const card = container.querySelector('article')!;
    expect(card).toHaveAttribute('id', 'case-7');
    expect(card).toHaveClass('vc', 'vc--awaiting_statement', 'vc--focus');
    expect(screen.getByRole('heading', { name: '处理中' })).toBeInTheDocument();
    expect(screen.getByText('选手有一起记录在处理中，判决后公开。')).toBeInTheDocument();
    expect(screen.getByText('分数变化：判决后公开')).toBeInTheDocument();
    expect(screen.getByText(/裁判 裁判/)).toBeInTheDocument();
    expect(screen.getByText(/等待 选手 说明情况/)).toBeInTheDocument();
    expect(card.textContent).not.toMatch(/\b0\b/);
    expect(screen.queryByText('立案经过')).not.toBeInTheDocument();
    expect(screen.queryByText('AI 归类')).not.toBeInTheDocument();
    expect(screen.queryByText(/放鸽子/)).not.toBeInTheDocument();
    expect(screen.queryByText(/团灭级/)).not.toBeInTheDocument();
    expect(card.querySelector('.vc__delta')).toBeNull();
    expect(card.querySelector('.scale')).toBeNull();
  });

  it('still says a statement was written (statement_at stays), never “in absence”', () => {
    render(<VerdictCard record={pendingHidden({ statement_at: '2026-10-26 10:00:00' })} />);
    expect(screen.getByText(/选手 写了说明 · 只有当事人、立案人、裁判和管理员能看/)).toBeInTheDocument();
    expect(screen.queryByText(/按缺席裁决/)).not.toBeInTheDocument();
  });

  it('says nothing about a statement when none was written yet', () => {
    render(<VerdictCard record={pendingHidden()} />);
    expect(screen.queryByText(/写了说明/)).not.toBeInTheDocument();
    expect(screen.queryByText(/按缺席裁决/)).not.toBeInTheDocument();
  });

  it('while the AI judges, says so', () => {
    render(<VerdictCard record={pendingHidden({ status: 'judging', deadline_at: null, statement_at: '2026-10-26 10:00:00' })} />);
    expect(screen.getByText(/AI 正在裁决/)).toBeInTheDocument();
    expect(screen.getByText('分数变化：判决后公开')).toBeInTheDocument();
    expect(screen.getByText(/选手 写了说明/)).toBeInTheDocument();
  });
});

describe('RecordsFeed, a case the API hid before its verdict', () => {
  it('is only a name and 处理中: no type, no summary, no status chip, no escalation chip', () => {
    const { container } = render(
      <RecordsFeed records={[pendingHidden({ claim_summary: 'LEAKEDSUMMARY', escalation_suggested: true })]} />,
    );
    const row = container.querySelector('.feed-row')!;
    expect(within(row as HTMLElement).getByText('选手')).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText('处理中')).toBeInTheDocument();
    expect(row.querySelector('.feed-row__status')).toBeNull();
    expect(row.textContent).not.toContain('待说明');
    expect(row.textContent).not.toContain('待确认升级');
    expect(row.textContent).not.toContain('放鸽子');
    expect(row.textContent).not.toContain('LEAKEDSUMMARY');
    expect(row.querySelector('.feed-row__delta')?.textContent).toBe('?');
  });

  it('leaves every other row as it was', () => {
    render(<RecordsFeed records={[record({ status: 'awaiting_statement', delta: 0, verdict: null })]} />);
    expect(screen.getByText('放鸽子')).toBeInTheDocument();
    expect(screen.getByText('待说明')).toBeInTheDocument();
  });
});
