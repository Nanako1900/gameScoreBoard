import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { RecordsFeed } from '../../src/components/RecordsFeed';
import { RulesPanel } from '../../src/components/RulesPanel';
import { StatementDialog } from '../../src/components/StatementDialog';
import { VerdictCard } from '../../src/components/VerdictCard';
import type { Config, RecordItem } from '../../src/types';

// 用词表（spec §5）：立案人写的叫「立案经过」，当事人写的叫「说明」，所以
// 待写的状态叫「待说明」；规则里不再写死「本地时区」（M19 前半）。

const HOUR = 3_600_000;
const sqlTime = (ms: number): string => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

const CONFIG: Config = {
  violations: [],
  tiers: [],
  weeklyHeal: 5,
  weeklyBonusCap: 6,
  statementWindowHours: 12,
  aiEnabled: false,
  maxBatchSubjects: 5,
  nextResetAt: '2030-01-06T16:00:00.000Z',
};

function awaiting(over: Partial<RecordItem> = {}): RecordItem {
  return {
    id: 12,
    subject: { id: 'me', username: '我', avatar_url: null },
    reporter: { id: 'j', username: '阿飞', avatar_url: null },
    type: 'late_major',
    delta: 0,
    note: null,
    claim: '迟到 25 分钟，没打招呼',
    claim_summary: null,
    classified_by: 'ai',
    escalation_suggested: false,
    session_id: null,
    statement: null,
    statement_at: null,
    appeal_reason: null,
    deadline_at: sqlTime(Date.now() + 5 * HOUR),
    status: 'awaiting_statement',
    verdict: null,
    range: { min: -9, max: -3, base: -6 },
    created_at: sqlTime(Date.now() - HOUR),
    redacted: false,
    ...over,
  };
}

describe('立案经过', () => {
  it('is what the case card calls the reporter’s account', () => {
    render(<VerdictCard record={awaiting()} />);
    expect(screen.getByText('立案经过')).toBeInTheDocument();
    expect(screen.queryByText('裁判陈述')).not.toBeInTheDocument();
  });

  it('and what the statement dialog calls it', () => {
    render(<StatementDialog open record={awaiting()} config={CONFIG} onClose={() => {}} onDecided={() => {}} />);
    expect(screen.getByText('立案经过')).toBeInTheDocument();
    expect(screen.queryByText('裁判陈述')).not.toBeInTheDocument();
  });
});

describe('待说明', () => {
  it('labels an open case in the feed', () => {
    render(<RecordsFeed records={[awaiting()]} />);
    expect(screen.getByText('待说明')).toBeInTheDocument();
    expect(screen.queryByText('待陈述')).not.toBeInTheDocument();
  });
});

describe('RulesPanel', () => {
  it('says Monday 0:00 without claiming a local timezone', async () => {
    const user = userEvent.setup();
    render(<RulesPanel config={CONFIG} />);
    await user.click(screen.getByRole('button', { name: /计分规则/ }));
    expect(screen.getByText(/每位选手每周一 0 点自动恢复/)).toBeInTheDocument();
    expect(screen.queryByText(/本地时区/)).not.toBeInTheDocument();
  });
});
