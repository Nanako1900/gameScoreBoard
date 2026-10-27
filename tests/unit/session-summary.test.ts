import { describe, expect, it } from 'vitest';
import { settledSummary } from '../../src/lib/sessionSummary';

describe('settledSummary', () => {
  it('reports only nonzero attendance, in the shared order', () => {
    expect(settledSummary([{ attendance: 'late' }, { attendance: 'on_time' }, { attendance: 'on_time' },
      { attendance: null }, { attendance: 'excused' }], [])).toBe('已结算 · 准时 2 · 迟到 1 · 请假 1');
  });
  it('has no filing line when no records were created', () => {
    expect(settledSummary([], [])).toBe('已结算');
    expect(settledSummary([{ attendance: 'no_show' }], [])).toBe('已结算 · 没来 1');
  });
  it('counts records and asks for explanations only for awaiting_statement', () => {
    expect(settledSummary([], [{ status: 'awaiting_statement' }])).toBe('已结算 · 立案 1 起，等当事人说明');
    expect(settledSummary([], [{ status: 'decided' }, { status: 'judging' }])).toBe('已结算 · 立案 2 起');
  });
});
