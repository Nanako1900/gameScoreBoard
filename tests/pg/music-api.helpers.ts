// Shared harness for the music API suites: one community app with the music
// routes mounted, three linked members plus an admin, and a fake NetEase client.
import { beforeEach, expect, vi } from 'vitest';
import { buildEnv } from '../../server/src/api';
import { CommunityStore } from '../../server/src/community/store';
import { createCommunityRoutes, type CommunityRouteDeps } from '../../server/src/community/routes';
import { MusicStore } from '../../server/src/music/store';
import type { NeteaseClient } from '../../server/src/music/netease/client';
import type { MusicTrack } from '../../shared/music';
import { signSession } from '../../worker/session';
import { seedUser } from '../worker/helpers';
import { env as pgEnv, pool } from './cloudflare-test';

export const API = 'https://api.example.com';
export const SPA = 'https://score.example.com';
const SECRET = 'music-test-session-secret-0123456789abcdef';
const GUILD = '111111111111111111';
const ALICE = '222222222222222222';
const BOB = '333333333333333333';
const CAROL = '444444444444444444';
export const MUSIC_BOT = '555555555555555555';
const ADMIN_ID = '666666666666666666';
export const MASTER_KEY = Buffer.alloc(32, 7).toString('base64');
export const OTHER_KEY = Buffer.alloc(32, 9).toString('base64');
export const COOKIE = 'MUSIC_U=supersecretcookievalue; __csrf=abc';

export const community = new CommunityStore(pool, GUILD);
export const music = new MusicStore(pool, GUILD);
export const environment = (extra: Record<string, string> = {}) => buildEnv({
  OAUTH_BASE_URL: 'https://idp.example.com', OAUTH_CLIENT_ID: 'client', OAUTH_CLIENT_SECRET: 'secret',
  SESSION_SECRET: SECRET, APP_URL: API, FRONTEND_ORIGIN: SPA, ...extra,
}, pgEnv.DB);

export const track = (id: number): MusicTrack => ({
  id: `netease:${id}`, title: `歌${id}`, artists: ['歌手'], album: '专辑', durationMs: 200_000, coverUrl: null,
});

export function fakeClient(overrides: Partial<NeteaseClient> = {}): NeteaseClient {
  return {
    search: vi.fn(async () => [track(1)]),
    playlist: vi.fn(async () => ({ name: '歌单', tracks: [track(1), track(2)] })),
    songUrl: vi.fn(async () => ({ url: 'https://example.com/a.mp3' })),
    qrKey: vi.fn(async () => ({ key: 'qr-key-1', url: 'https://music.163.com/login?codekey=qr-key-1' })),
    qrCheck: vi.fn(async () => ({ status: 'done' as const, cookie: COOKIE })),
    account: vi.fn(async () => ({ nickname: '小明', vip: true })),
    ...overrides,
  };
}

/** Mutable per-test state, reset by `useMusicApi()`. */
export const t = {
  app: null as unknown as ReturnType<typeof createCommunityRoutes>,
  client: null as unknown as NeteaseClient,
  roomAccessCalls: [] as string[][],
  errors: [] as unknown[],
  alice: '', bob: '', carol: '', adminMember: '',
};

export interface BuildOptions {
  masterKey?: string; env?: Record<string, string>; music?: boolean; now?: () => number;
  requestRoomAccess?: (memberRef: string, roomRef: string, key: string) => Promise<void>;
}

export function build(options: BuildOptions = {}) {
  const musicDeps: CommunityRouteDeps['music'] = {
    store: music, db: pgEnv.DB, masterKey: 'masterKey' in options ? options.masterKey : MASTER_KEY,
    netease: async () => t.client, now: options.now,
    requestRoomAccess: options.requestRoomAccess ?? (async (...args) => { t.roomAccessCalls.push(args); }),
  };
  t.app = createCommunityRoutes({
    store: community, db: pgEnv.DB, env: environment(options.env), onError: (_context, error) => { t.errors.push(error); },
    ...(options.music === false ? {} : { music: musicDeps }),
  });
}

/** A clock that moves a second forward on every read, so per-member limits never trigger. */
export function tickingClock(): () => number {
  let at = Date.now();
  return () => (at += 1_000);
}

export function useMusicApi(): void {
  beforeEach(async () => {
    await pool.query('TRUNCATE music_runtime');
    for (const id of ['alice', 'bob', 'carol']) await seedUser({ id });
    await seedUser({ id: 'admin', admin: true });
    t.alice = (await community.upsertResource('member', ALICE, 'Alice', { available: true, metadata: { bot: false } })).ref;
    t.bob = (await community.upsertResource('member', BOB, 'Bob', { available: true, metadata: { bot: false } })).ref;
    t.carol = (await community.upsertResource('member', CAROL, 'Carol', { available: true, metadata: { bot: false } })).ref;
    t.adminMember = (await community.upsertResource('member', ADMIN_ID, 'Admin', { available: true, metadata: { bot: false } })).ref;
    await pool.query(
      `INSERT INTO discord_links(discord_user_id,user_id,discord_username)
       VALUES($1,'alice','Alice'),($2,'bob','Bob'),($3,'admin','Admin')`,
      [ALICE, BOB, ADMIN_ID],
    );
    await community.setRuntime({ ready: true, syncedAt: new Date().toISOString() });
    await music.heartbeat();
    t.client = fakeClient();
    t.roomAccessCalls = [];
    t.errors = [];
    build();
  });
}

// Response bodies are asserted structurally, so tests read them loosely typed.
export type TestResponse = Omit<Response, 'json'> & { json(): Promise<any> };

export async function req(path: string, user: string | null = 'alice', body?: unknown): Promise<TestResponse> {
  const headers: Record<string, string> = { Origin: SPA };
  if (user) headers.Cookie = 'edg_session=' + await signSession({ sub: user }, SECRET);
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const method = body === undefined ? 'GET' : 'POST';
  return t.app.fetch(new Request(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
}

export async function liveRoom(name = '朋友房', visibility: 'open' | 'hidden' = 'open', owner = t.alice) {
  const created = await community.createRoom(owner, name, { visibility });
  return community.patchRoom(created.ref, { status: 'active' }, created.version);
}

export async function occupiedRoom(name = '朋友房', visibility: 'open' | 'hidden' = 'open') {
  const room = await liveRoom(name, visibility);
  await community.setRoomAccess(room.ref, t.alice, { present: true });
  return room;
}

export const base = (roomRef: string) => `/api/community/music/${roomRef}`;
export const invite = (roomRef: string, user = 'alice', extra: Record<string, unknown> = {}) =>
  req(base(roomRef) + '/invite', user, { requestKey: 'invite-' + user, ...extra });
export const command = (roomRef: string, body: Record<string, unknown>, user = 'alice') =>
  req(base(roomRef) + '/commands', user, { requestKey: 'cmd-' + Math.random(), ...body });

export async function loginAs(user: string) {
  expect((await req('/api/community/music/login/qr', user, { requestKey: 'qr-' + user })).status).toBe(200);
  return req('/api/community/music/login/qr/qr-key-1', user);
}
