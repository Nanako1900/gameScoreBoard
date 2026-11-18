import { vi } from 'vitest';
import { defaultMusicState, type MusicQueueItem, type MusicSessionView, type MusicState, type MusicTrack, type MusicView } from '../../shared/music';

export const roomRef = 'ab4ce2dd-8bc9-4043-845c-d2aec97b4bfb';
export const viewPath = `/api/community/music/${roomRef}`;

export const track = (n: number, over: Partial<MusicTrack> = {}): MusicTrack => ({
  id: `netease:${n}`, title: `歌曲${n}`, artists: ['歌手甲', '歌手乙'], album: '专辑', durationMs: 200_000, coverUrl: null, ...over,
});

export const queueItem = (n: number, over: Partial<MusicQueueItem> = {}): MusicQueueItem => ({
  key: `k${n}`, track: track(n), addedBy: 'member-ref', ...over,
});

export const musicState = (over: Partial<MusicState> = {}): MusicState => ({ ...defaultMusicState(), ...over });

export const session = (over: Partial<MusicSessionView> = {}): MusicSessionView => ({
  ref: 'session-ref', status: 'active', version: 1, state: musicState(), account: null, ...over,
});

export const musicView = (over: Partial<MusicView> = {}): MusicView => ({
  room: { ref: roomRef, name: '深夜电台' },
  bot: { online: true, busyElsewhere: false },
  session: null,
  myAccount: null,
  loginAvailable: true,
  canInvite: true,
  inviteBlocked: null,
  serverNow: new Date().toISOString(),
  lastEnded: null,
  myLastError: null,
  ...over,
});

export const myAccount = { nickname: '小明的网易云', vip: true, expiresAt: '2026-12-17T00:00:00Z' };

export interface RecordedPost {
  path: string;
  body: Record<string, unknown>;
}

export interface MusicServer {
  view: () => Response;
  extra: (path: string, init?: RequestInit) => Response | Promise<Response> | undefined;
  posts: RecordedPost[];
}

/** Routes every music endpoint to the test's current answer; unknown paths fail loudly. */
export function installMusicServer(server: Partial<MusicServer> & { view: () => Response }): RecordedPost[] {
  const posts: RecordedPost[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (init?.method === 'POST') posts.push({ path, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    const custom = await server.extra?.(path, init);
    if (custom) return custom;
    if (path === viewPath && init?.method !== 'POST') return server.view();
    return Response.json({ error: `unexpected ${path}` }, { status: 500 });
  }));
  return posts;
}

export const json = (body: unknown, status = 200): Response => Response.json(body, { status });
