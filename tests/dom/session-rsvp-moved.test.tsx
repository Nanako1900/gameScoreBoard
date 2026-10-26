import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionDetailDialog } from '../../src/components/SessionDetailDialog';
import { SessionsPanel } from '../../src/components/SessionsPanel';
import type { SessionDetail, User } from '../../src/types';

// A player answers a session that the organizer has moved since the page
// loaded: the server says 409, the page shows the new time — and says why.

const ME: User = {
  id: 'p',
  username: '选手',
  oauth_username: '选手',
  avatar_url: null,
  is_participant: true,
  is_judge: false,
  is_admin: false,
  score: 100,
  created_at: '2026-10-01 00:00:00',
};
const MOVED = '约局时间已经改了，请按新的时间重新确认';
const HOUR = 3_600_000;

function session(startsAt: string): SessionDetail {
  return {
    id: 1,
    organizer: { id: 'org', username: '组织者', avatar_url: null },
    title: '周五五排',
    game: null,
    starts_at: startsAt,
    duration_min: null,
    capacity: null,
    note: null,
    status: 'open',
    settled_at: null,
    created_at: '2026-10-01 00:00:00',
    counts: { invited: 1, going: 1, maybe: 0, out: 0 },
    my_rsvp: 'invited',
    players: [],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Reads return the session at its new time; every RSVP is refused as stale. */
function stubMoved(): { posts: unknown[]; newStart: string } {
  const newStart = new Date(Date.now() + 5 * HOUR).toISOString();
  let reads = 0;
  const posts: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (init?.method === 'POST') {
        posts.push(JSON.parse(String(init.body)));
        return { ok: false, status: 409, text: async () => JSON.stringify({ error: MOVED }) };
      }
      reads += 1;
      // The first read is the stale page; later reads see the move.
      const s = session(reads === 1 ? new Date(Date.now() + 2 * HOUR).toISOString() : newStart);
      const body = url.includes('/api/sessions/1') ? { session: s, records: [] } : { sessions: [s] };
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    }),
  );
  return { posts, newStart };
}

describe('answering a session that has moved', () => {
  it('the detail dialog reloads, tells the lists, and says why', async () => {
    const { posts } = stubMoved();
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<SessionDetailDialog sessionId={1} me={ME} onClose={() => {}} onChanged={onChanged} />);
    await user.click(await screen.findByRole('button', { name: '来' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(MOVED);
    expect(onChanged).toHaveBeenCalled();
    expect(posts).toEqual([expect.objectContaining({ rsvp: 'going', starts_at: expect.any(String) })]);
  });

  it('the list reloads and says why', async () => {
    stubMoved();
    const user = userEvent.setup();
    render(<SessionsPanel me={ME} onOpenSession={() => {}} onCreate={() => {}} refreshKey={0} />);
    await user.click(await screen.findByRole('button', { name: '来' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(MOVED));
  });
});
