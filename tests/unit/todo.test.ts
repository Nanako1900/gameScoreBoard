import { describe, expect, it } from 'vitest';
import { isFilingJudge } from '../../shared/scoring';
import { LOBBY_CANCELLED_KEEP_MS, MINUTE_MS, TODO_SOON_MS } from '../../src/lib/constants';
import { buildTodo, collectTodo, handledSessionIds, meNeedsAttention, sortTodo, todoBadgeCount, todoRank,
  type TodoItem, type TodoSources } from '../../src/lib/todo';
import type { InvitedSessionItem, RecordItem, User } from '../../src/types';

const NOW = Date.parse('2026-10-28T12:00:00Z');
const iso = (delta: number): string => new Date(NOW + delta).toISOString();
const me: User = { id: 'me', username: '我', oauth_username: 'me', avatar_url: null, is_admin: false,
  is_judge: false, is_participant: true, score: 90, created_at: iso(-TODO_SOON_MS) };
function record(patch: Partial<RecordItem> = {}): RecordItem {
  return { id: 1, subject: { id: 'me', username: '我', avatar_url: null }, reporter: { id: 'judge', username: '裁判', avatar_url: null },
    type: 'no_show', delta: 0, note: null, claim: '原定一起玩', claim_summary: null, classified_by: 'human',
    escalation_suggested: false, session_id: null, statement: null, statement_at: null, appeal_reason: null,
    deadline_at: iso(30 * MINUTE_MS), status: 'awaiting_statement', verdict: null,
    range: { min: -10, max: -5, base: -8 }, created_at: iso(-TODO_SOON_MS), ...patch };
}
function session(patch: Partial<InvitedSessionItem> = {}): InvitedSessionItem {
  return { id: 5, organizer: { id: 'org', username: '组织者', avatar_url: null }, title: '五排', game: '无畏契约',
    starts_at: iso(TODO_SOON_MS), duration_min: 120, capacity: 5, note: null, status: 'open', settled_at: null,
    created_at: iso(-TODO_SOON_MS), counts: { going: 3, invited: 1, maybe: 1, out: 0 }, my_rsvp: 'invited', ...patch };
}
function sources(patch: Partial<TodoSources> = {}): TodoSources {
  return { me, now: NOW, pending: { statements: 0, appeals: 0 }, myPending: [], invites: [], feed: [], mine: [],
    appealed: [], discord: undefined, seenCancelled: [], unboundDismissed: false, ...patch };
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
    expect(collectTodo(sources({ me: null, discord: { dm_ok: false }, myPending: [record()], invites: [session()] }))).toEqual([]);
  });
  it('turns only awaiting-statement records into individually urgent or ordinary cards', () => {
    const items = collectTodo(sources({ myPending: [record(), record({ id: 2, deadline_at: iso(3 * TODO_SOON_MS) }),
      record({ id: 3, deadline_at: null }), record({ id: 4, status: 'judging' })] }));
    expect(items.map((i) => [i.kind, i.key, i.kind === 'statement' && i.urgent])).toEqual([
      ['statement', 'statement:1', true], ['statement', 'statement:2', false], ['statement', 'statement:3', false],
    ]);
  });
  it('keeps an overdue explanation urgent', () => {
    expect(collectTodo(sources({ myPending: [record({ deadline_at: iso(-MINUTE_MS) })] }))[0]).toMatchObject({ kind: 'statement', urgent: true });
  });
  it('asks only the organizer to roll call an open session past its expected end', () => {
    const due = session({ organizer: me, starts_at: iso(-3 * TODO_SOON_MS) });
    const items = collectTodo(sources({ mine: [due, session({ id: 6, starts_at: due.starts_at }),
      session({ ...due, id: 7, status: 'settled' }), session({ ...due, id: 8, starts_at: iso(-MINUTE_MS) })] }));
    expect(items.map((i) => i.key)).toEqual(['rollcall:5']);
  });
  it('distinguishes a moved invitation with context from a fresh or old-backend invitation', () => {
    const items = collectTodo(sources({ invites: [session({ invite_reason: 'moved', prev_starts_at: iso(TODO_SOON_MS * 2) }),
      session({ id: 6 }), session({ id: 7, invite_reason: 'moved' })] }));
    expect(items.map((i) => i.key)).toEqual(['moved:5', 'invite:6', 'invite:7']);
  });
  it('does not list answered, started or cancelled invitations', () => {
    const invites = [session({ my_rsvp: 'going' }), session({ id: 6, starts_at: iso(0) }), session({ id: 7, status: 'cancelled' })];
    expect(collectTodo(sources({ invites }))).toEqual([]);
  });
  it('reminds a going guest up to and including the two-hour boundary', () => {
    const mine = [session({ my_rsvp: 'going' }), session({ id: 6, my_rsvp: 'going', starts_at: iso(1) })];
    expect(collectTodo(sources({ mine })).map((i) => i.key)).toEqual(['soon:5', 'soon:6']);
  });
  it('does not remind an organizer, a maybe, a closed session, or one outside the future window', () => {
    const mine = [session({ organizer: me, my_rsvp: 'going' }), session({ id: 6, my_rsvp: 'maybe' }),
      session({ id: 7, my_rsvp: 'going', status: 'settled' }), session({ id: 8, my_rsvp: 'going', starts_at: iso(0) }),
      session({ id: 9, my_rsvp: 'going', starts_at: iso(TODO_SOON_MS + 1) })];
    expect(collectTodo(sources({ mine }))).toEqual([]);
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
    const a = record({ id: 8, status: 'appealed', created_at: iso(-TODO_SOON_MS) });
    const b = record({ id: 9, status: 'appealed', created_at: iso(-2 * TODO_SOON_MS) });
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
  it('shows cancellations only to involved guests until the original start plus one day', () => {
    const cancelled = session({ status: 'cancelled', starts_at: iso(-LOBBY_CANCELLED_KEEP_MS + 1) });
    const mine = ['going', 'maybe', 'invited'].map((rsvp, id) => ({ ...cancelled, id: id + 10, my_rsvp: rsvp as InvitedSessionItem['my_rsvp'] }));
    expect(collectTodo(sources({ mine })).map((i) => i.key)).toEqual(['cancelled:10', 'cancelled:11', 'cancelled:12']);
  });
  it('omits seen, expired, out, uninvolved and self-organized cancellation notifications', () => {
    const cancelled = session({ status: 'cancelled' });
    const mine = [cancelled, { ...cancelled, id: 6, starts_at: iso(-LOBBY_CANCELLED_KEEP_MS) },
      { ...cancelled, id: 7, my_rsvp: 'out' as const }, { ...cancelled, id: 8, my_rsvp: null },
      { ...cancelled, id: 9, organizer: me }];
    expect(collectTodo(sources({ mine, seenCancelled: [5] }))).toEqual([]);
  });
  it('uses only the caller own explicit DM failure flag', () => {
    expect(collectTodo(sources({ discord: { dm_ok: false } }))).toEqual([{ kind: 'dm-broken', key: 'dm-broken' }]);
    for (const discord of [{ dm_ok: true }, {}, undefined, 'error' as const]) expect(collectTodo(sources({ discord }))).toEqual([]);
  });
  it('offers binding only for explicit unbound and remembers dismissal', () => {
    expect(collectTodo(sources({ discord: null }))).toEqual([{ kind: 'unbound', key: 'unbound' }]);
    expect(collectTodo(sources({ discord: null, unboundDismissed: true }))).toEqual([]);
  });
  it('degrades each optional source to no items when still unavailable', () => {
    expect(buildTodo(sources({ pending: null, myPending: null, invites: null, feed: null, mine: null, appealed: null }))).toEqual([]);
  });
});

describe('todo ordering and navigation counts', () => {
  function allItems(): TodoItem[] {
    return [...collectTodo(sources({ me: { ...me, is_admin: true }, discord: { dm_ok: false },
      myPending: [record(), record({ id: 2, deadline_at: null })],
      mine: [session({ id: 3, organizer: me, starts_at: iso(-3 * TODO_SOON_MS) }), session({ id: 6, my_rsvp: 'going' }),
        session({ id: 9, status: 'cancelled' })],
      invites: [session({ id: 4, invite_reason: 'moved', prev_starts_at: iso(TODO_SOON_MS * 2) }), session()],
      feed: [record({ id: 7, escalation_suggested: true })], pending: { statements: 0, appeals: 3 } })),
    { kind: 'unbound', key: 'unbound' }];
  }
  it('sorts every priority without mutating its input and leaves the P4 priority gap', () => {
    const items = allItems().reverse(); const before = [...items];
    const sorted = sortTodo(items);
    expect(sorted.map(todoRank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12]);
    expect(items).toEqual(before);
  });
  it('sorts explanation deadlines before missing ones, then by key on ties', () => {
    const records = [record({ id: 3, deadline_at: null }), record({ id: 2, deadline_at: iso(5 * TODO_SOON_MS) }),
      record({ id: 1, deadline_at: iso(3 * TODO_SOON_MS) }), record({ id: 4, deadline_at: iso(3 * TODO_SOON_MS) })];
    expect(buildTodo(sources({ myPending: records })).map((i) => i.key)).toEqual(['statement:1', 'statement:4', 'statement:2', 'statement:3']);
  });
  it('sorts session groups by start and escalation groups by filing time', () => {
    const invites = [session({ id: 6 }), session({ starts_at: iso(MINUTE_MS) })];
    expect(buildTodo(sources({ invites })).map((i) => i.key)).toEqual(['invite:5', 'invite:6']);
    const feed = [record({ id: 1, escalation_suggested: true }), record({ id: 2, escalation_suggested: true, created_at: iso(-3 * TODO_SOON_MS) })];
    expect(buildTodo(sources({ me: { ...me, is_admin: true }, feed })).map((i) => i.key)).toEqual(['escalation:2', 'escalation:1']);
  });
  it('does not count notices or unbound; counts each appeal rather than the single card', () => {
    expect(todoBadgeCount(allItems())).toBe(11);
    expect(todoBadgeCount([])).toBe(0);
  });
  it('deduplicates only invite, moved and soon session ids for the lobby', () => {
    expect([...handledSessionIds(allItems())].sort()).toEqual([4, 5, 6]);
    expect(handledSessionIds([]).size).toBe(0);
  });
  it('marks my account only for appeals, escalation and broken DMs', () => {
    const items = allItems();
    expect(meNeedsAttention(items)).toBe(true);
    expect(meNeedsAttention(items.filter((i) => !['appeals', 'escalation', 'dm-broken'].includes(i.kind)))).toBe(false);
    for (const kind of ['appeals', 'escalation', 'dm-broken']) expect(meNeedsAttention(items.filter((i) => i.kind === kind))).toBe(true);
  });
});
