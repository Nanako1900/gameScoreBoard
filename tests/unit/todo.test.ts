import { describe, expect, it } from 'vitest';
import { isFilingJudge } from '../../shared/scoring';
import { buildTodo, collectTodo, meNeedsAttention, sortTodo, todoBadgeCount, todoRank,
  type TodoItem, type TodoSources } from '../../src/lib/todo';
import type { RecordItem, User } from '../../src/types';

const MINUTE_MS = 60_000;
const HOUR = 3_600_000;
const NOW = Date.parse('2026-10-28T12:00:00Z');
const iso = (delta: number): string => new Date(NOW + delta).toISOString();
const me: User = { id: 'me', username: '我', oauth_username: 'me', avatar_url: null, is_admin: false,
  is_judge: false, is_participant: true, score: 90, created_at: iso(-HOUR) };
function record(patch: Partial<RecordItem> = {}): RecordItem {
  return { id: 1, subject: { id: 'me', username: '我', avatar_url: null }, reporter: { id: 'judge', username: '裁判', avatar_url: null },
    type: 'no_show', delta: 0, note: null, claim: '原定一起玩', claim_summary: null, classified_by: 'human',
    escalation_suggested: false, session_id: null, statement: null, statement_at: null, appeal_reason: null,
    deadline_at: iso(30 * MINUTE_MS), status: 'awaiting_statement', verdict: null,
    range: { min: -10, max: -5, base: -8 }, created_at: iso(-HOUR), ...patch };
}
function sources(patch: Partial<TodoSources> = {}): TodoSources {
  return { me, now: NOW, pending: { statements: 0, appeals: 0 }, myPending: [], feed: [],
    appealed: [], discord: undefined, onboardingDismissed: null, ...patch };
}

describe('shared filing-judge permission', () => {
  it('allows an admin regardless of who reported, including an admin who is not a judge', () => {
    expect(isFilingJudge({ ...me, is_admin: true }, 'other')).toBe(true);
  });
  it('allows a judge only for the case they filed', () => {
    expect(isFilingJudge({ ...me, is_judge: true }, 'me')).toBe(true);
    expect(isFilingJudge({ ...me, is_judge: true }, 'other')).toBe(false);
  });
  it('does not grant a nonjudge session organizer authority merely for being the reporter', () => {
    expect(isFilingJudge(me, 'me')).toBe(false);
  });
});

describe('collectTodo sources', () => {
  it('shows nothing to a visitor even if stale signed-in sources remain', () => {
    expect(collectTodo(sources({ me: null, discord: { dm_ok: false }, myPending: [record()] }))).toEqual([]);
  });
  it('turns only awaiting-statement records into individually urgent or ordinary cards', () => {
    const items = collectTodo(sources({ myPending: [record(), record({ id: 2, deadline_at: iso(3 * HOUR) }),
      record({ id: 3, deadline_at: null }), record({ id: 4, status: 'judging' })] }));
    expect(items.map((i) => [i.kind, i.key, i.kind === 'statement' && i.urgent])).toEqual([
      ['statement', 'statement:1', true], ['statement', 'statement:2', false], ['statement', 'statement:3', false],
    ]);
  });
  it('keeps an overdue explanation urgent', () => {
    expect(collectTodo(sources({ myPending: [record({ deadline_at: iso(-MINUTE_MS) })] }))[0]).toMatchObject({ kind: 'statement', urgent: true });
  });
  it('shows escalation to the filing judge or an admin only while a verdict is pending', () => {
    const feed = ['awaiting_statement', 'judging', 'decided', 'appealed', 'withdrawn'].map((status, id) =>
      record({ id: id + 20, status: status as RecordItem['status'], escalation_suggested: true, reporter: me }));
    expect(collectTodo(sources({ me: { ...me, is_judge: true }, feed })).map((i) => i.key)).toEqual(['escalation:20', 'escalation:21']);
    expect(collectTodo(sources({ feed }))).toEqual([]);
    expect(collectTodo(sources({ me: { ...me, id: 'other', is_judge: true }, feed }))).toEqual([]);
    expect(collectTodo(sources({ me: { ...me, id: 'other', is_admin: true }, feed })).map((i) => i.kind)).toEqual(['escalation', 'escalation']);
  });
  it('does not show an escalation without the AI suggestion', () => {
    expect(collectTodo(sources({ me: { ...me, is_admin: true }, feed: [record()] }))).toEqual([]);
  });
  it('uses the admin appeal count and earliest filing from the optional appeal list', () => {
    const a = record({ id: 8, status: 'appealed', created_at: iso(-HOUR) });
    const b = record({ id: 9, status: 'appealed', created_at: iso(-2 * HOUR) });
    expect(collectTodo(sources({ me: { ...me, is_admin: true }, pending: { statements: 0, appeals: 3 }, appealed: [a, b] })))
      .toEqual([{ kind: 'appeals', key: 'appeals', count: 3, earliest: b }]);
  });
  it('keeps an appeal card without a target when the list failed', () => {
    expect(collectTodo(sources({ me: { ...me, is_admin: true }, pending: { statements: 0, appeals: 2 }, appealed: null })))
      .toEqual([{ kind: 'appeals', key: 'appeals', count: 2, earliest: null }]);
  });
  it('has no appeal card for a nonadmin or a zero count', () => {
    expect(collectTodo(sources({ pending: { statements: 0, appeals: 2 } }))).toEqual([]);
    expect(collectTodo(sources({ me: { ...me, is_admin: true } }))).toEqual([]);
  });
  it('combines incomplete binding and DM permission into one onboarding card', () => {
    expect(collectTodo(sources({ discord: null }))).toEqual([{ kind: 'onboarding', key: 'onboarding', missing: [2, 3] }]);
    expect(collectTodo(sources({ discord: { notify_dm: true, dm_ok: false } }))).toEqual([{ kind: 'onboarding', key: 'onboarding', missing: [3] }]);
    expect(collectTodo(sources({ me: { ...me, is_participant: false }, discord: null })))
      .toEqual([{ kind: 'onboarding', key: 'onboarding', missing: [2, 3, 4] }]);
  });
  it('shows no reminder after server completion and invents no Discord facts for unknown reads', () => {
    for (const discord of [{ notify_dm: true, dm_ok: true }, undefined, 'error' as const]) expect(collectTodo(sources({ discord }))).toEqual([]);
    expect(collectTodo(sources({ me: { ...me, is_participant: false }, discord: undefined })))
      .toEqual([{ kind: 'onboarding', key: 'onboarding', missing: [4] }]);
  });
  it('hides only a current-account dismissal for known missing steps within seven days', () => {
    const mark = { userId: me.id, dismissedAt: NOW, missing: [2, 3] as const };
    expect(collectTodo(sources({ discord: null, onboardingDismissed: mark }))).toEqual([]);
    expect(collectTodo(sources({ me: { ...me, is_participant: false }, discord: null, onboardingDismissed: mark })))
      .toEqual([{ kind: 'onboarding', key: 'onboarding', missing: [2, 3, 4] }]);
    expect(collectTodo(sources({ me: { ...me, id: 'someone-else' }, discord: null, onboardingDismissed: mark }))).toHaveLength(1);
    expect(collectTodo(sources({ discord: null, now: NOW + 7 * 86_400_000, onboardingDismissed: mark }))).toHaveLength(1);
  });
  it('degrades each optional source to no items when still unavailable', () => {
    expect(buildTodo(sources({ pending: null, myPending: null, feed: null, appealed: null }))).toEqual([]);
  });
});

describe('todo ordering and navigation counts', () => {
  function allItems(): TodoItem[] {
    return [...collectTodo(sources({ me: { ...me, is_admin: true }, discord: { notify_dm: true, dm_ok: false },
      myPending: [record(), record({ id: 2, deadline_at: null })],
      feed: [record({ id: 7, escalation_suggested: true })], pending: { statements: 0, appeals: 3 } }))];
  }
  it('sorts every priority without mutating its input and leaves the P4 priority gap', () => {
    const items = allItems().reverse(); const before = [...items];
    const sorted = sortTodo(items);
    expect(sorted.map(todoRank)).toEqual([0, 2, 5, 8, 9]);
    expect(items).toEqual(before);
  });
  it('sorts explanation deadlines before missing ones, then by key on ties', () => {
    const records = [record({ id: 3, deadline_at: null }), record({ id: 2, deadline_at: iso(5 * HOUR) }),
      record({ id: 1, deadline_at: iso(3 * HOUR) }), record({ id: 4, deadline_at: iso(3 * HOUR) })];
    expect(buildTodo(sources({ myPending: records })).map((i) => i.key)).toEqual(['statement:1', 'statement:4', 'statement:2', 'statement:3']);
  });
  it('sorts escalation groups by filing time', () => {
    const feed = [record({ id: 1, escalation_suggested: true }), record({ id: 2, escalation_suggested: true, created_at: iso(-3 * HOUR) })];
    expect(buildTodo(sources({ me: { ...me, is_admin: true }, feed })).map((i) => i.key)).toEqual(['escalation:2', 'escalation:1']);
  });
  it('does not count the onboarding notice; counts each appeal rather than the single card', () => {
    expect(todoBadgeCount(allItems())).toBe(6);
    expect(todoBadgeCount([])).toBe(0);
  });
  it('marks my account only for actionable appeals and escalation', () => {
    const items = allItems();
    expect(meNeedsAttention(items)).toBe(true);
    expect(meNeedsAttention(items.filter((i) => !['appeals', 'escalation'].includes(i.kind)))).toBe(false);
    for (const kind of ['appeals', 'escalation']) expect(meNeedsAttention(items.filter((i) => i.kind === kind))).toBe(true);
  });
});
