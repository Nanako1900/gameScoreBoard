import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancelSession, getMyInvites, getSessionHistory } from '../../src/api';
import type { HistorySessionItem, SessionItem } from '../../src/types';

// P2-3: the client side of a cancel reason, scope=history and the invite context.

interface Call {
  method: string;
  path: string;
  body: unknown;
}

function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, text: () => Promise.resolve(JSON.stringify(body)) } as Response;
}

/** Every request answers `reply`; returns what was asked. */
function mockFetch(reply: (call: Call) => Response): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const call: Call = {
        method: init?.method ?? 'GET',
        path: url.replace(/^https?:\/\/[^/]+/, ''),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      };
      calls.push(call);
      return Promise.resolve(reply(call));
    }),
  );
  return calls;
}

const ITEM: SessionItem = {
  id: 7,
  organizer: { id: 'org', username: '阿杰', avatar_url: null },
  title: '周二 20:00 开黑',
  game: '云顶',
  starts_at: '2026-10-27T12:00:00.000Z',
  duration_min: null,
  capacity: null,
  note: null,
  status: 'cancelled',
  settled_at: null,
  created_at: '2026-10-26 01:00:00',
  counts: { invited: 0, going: 1, maybe: 0, out: 0 },
  my_rsvp: null,
  cancel_reason: '临时加班，改天',
  cancelled_at: '2026-10-27 08:00:00',
};
const HISTORY: HistorySessionItem = {
  ...ITEM,
  attendance_summary: { on_time: 0, late: 0, no_show: 0, left_early: 0, excused: 0 },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cancelSession', () => {
  it('sends no body without a reason (as today), and { reason } with one', async () => {
    const calls = mockFetch(() => json(200, { session: { ...ITEM, players: [] } }));
    await cancelSession(7);
    await cancelSession(7, '临时加班，改天');
    expect(calls).toEqual([
      { method: 'POST', path: '/api/sessions/7/cancel', body: null },
      { method: 'POST', path: '/api/sessions/7/cancel', body: { reason: '临时加班，改天' } },
    ]);
  });
});

describe('getSessionHistory', () => {
  it('asks for scope=history, with before=<id> for the next page', async () => {
    const calls = mockFetch(() => json(200, { sessions: [HISTORY] }));
    expect(await getSessionHistory()).toEqual([HISTORY]);
    expect(await getSessionHistory(7)).toEqual([HISTORY]);
    expect(calls.map((c) => c.path)).toEqual(['/api/sessions?scope=history', '/api/sessions?scope=history&before=7']);
  });

  it('is undefined from an API without scope=history (it answers as if upcoming)', async () => {
    mockFetch(() => json(200, { sessions: [ITEM] }));
    expect(await getSessionHistory()).toBeUndefined();
  });

  it('is an empty page when there is nothing more', async () => {
    mockFetch(() => json(200, { sessions: [] }));
    expect(await getSessionHistory(3)).toEqual([]);
  });
});

describe('getMyInvites', () => {
  it('passes the invite context through, and still reads an older API without it', async () => {
    const moved = { ...ITEM, status: 'open', invite_reason: 'moved', prev_rsvp: 'going', prev_starts_at: '2026-10-27T11:00:00.000Z' };
    mockFetch(() => json(200, { sessions: [moved, ITEM] }));
    const { sessions } = await getMyInvites();
    expect(sessions[0]).toMatchObject({ invite_reason: 'moved', prev_rsvp: 'going' });
    expect(sessions[1].invite_reason ?? 'new').toBe('new');
  });
});
