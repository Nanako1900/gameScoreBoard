// Shared D1/PG contract for private voice evidence and persisted coverage.
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../../worker/index';
import { SESSION_COOKIE, signSession } from '../../worker/session';
import { getVoiceDay, getVoiceHistory } from '../../worker/voice';
import type { VoiceDayResponse, VoiceHistoryResponse } from '../../shared/voiceApi';
import { noAiEnv, seedUser } from './helpers';

const NOW = '2026-10-27 12:00:00';
const SECRET = 'test-voice-secret-0123456789abcdef';
const BASE = 'https://score.example.com';
let sequence = 0;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.parse(NOW.replace(' ', 'T') + 'Z'));
  sequence = 0;
  await seedUser({ id: 'self', username: '本人' });
  await seedUser({ id: 'other', username: '当事人' });
  await seedUser({ id: 'judge', username: '裁判', judge: true });
  await seedUser({ id: 'admin', username: '管理员', admin: true, participant: false });
});
afterEach(() => vi.useRealTimers());
async function call(path: string, actor?: string, offset = '8'): Promise<Response> {
  const headers = actor ? { Cookie: `${SESSION_COOKIE}=${await signSession({ sub: actor }, SECRET)}` } : undefined;
  const context = createExecutionContext();
  const response = await worker.fetch(new Request(BASE + path, { headers }), noAiEnv({ SESSION_SECRET: SECRET, RESET_TZ_OFFSET: offset }), context);
  await waitOnExecutionContext(context); return response;
}
async function add(user: string, joined: string, left: string | null, patch: { start?: string; end?: string; name?: string } = {}) {
  sequence += 1;
  await env.DB.prepare(`INSERT INTO voice_sessions
    (user_id, discord_user_id, channel_id, channel_name, joined_at, left_at, start_reason, end_reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(user, `secret-discord-${sequence}`, `secret-channel-${sequence}`, patch.name ?? '开黑一号', joined, left,
      patch.start ?? 'joined', left === null ? null : patch.end ?? 'left').run();
}
async function cover(from: string, to: string) {
  await env.DB.prepare('INSERT INTO voice_coverage (started_at, last_seen_at) VALUES (?, ?)').bind(from, to).run();
}
// Model a cleanup/checkpoint transaction committed around the segment query,
// using the real D1/PG database for both snapshots and the returned rows.
function aroundSegments(timing: 'before' | 'after', change: () => Promise<void>): D1Database {
  return { prepare(sql: string) {
    let statement = env.DB.prepare(sql);
    if (!/FROM voice_sessions\b/i.test(sql)) return statement;
    const wrapped = {
      bind(...values: unknown[]) { statement = statement.bind(...values); return wrapped; },
      async all<T>() {
        if (timing === 'before') await change();
        const result = await statement.all<T>();
        if (timing === 'after') await change();
        return result;
      },
    };
    return wrapped as unknown as D1PreparedStatement;
  } } as unknown as D1Database;
}

function noPrivateFields(body: unknown): void {
  const text = JSON.stringify(body);
  expect(text).not.toMatch(/secret-discord|secret-channel/);
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, entry] of Object.entries(value)) { expect(key).not.toMatch(/^discord_|^channel_id$|^email$|^oauth_username$|^is_admin$/); visit(entry); }
  };
  visit(body);
}

const HISTORY = '/api/voice?user=self&from=2026-10-27&to=2026-10-27';
describe('voice HTTP privacy and range guards', () => {
  it('lets the current person read history even without a Discord binding', async () => {
    await add('self', '2026-10-27 10:00:00', '2026-10-27 10:15:00');
    const response = await call(HISTORY, 'self');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const body = await response.json() as VoiceHistoryResponse;
    expect(body.user).toEqual({ id: 'self', username: '本人', avatar_url: null });
    expect(body.days[0].total_min).toBe(15); expect(body.retention_days).toBe(90); noPrivateFields(body);
  });
  it.each(['other', 'missing'])('refuses an ordinary caller another target %s before validating dates', async (target) => {
    const response = await call(`/api/voice?user=${target}&from=bad`, 'self');
    expect(response.status).toBe(404); expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });
  it.each(['judge', 'admin'])('allows privileged caller %s to read another person', async (actor) => {
    expect((await call('/api/voice?user=other&from=2026-10-27&to=2026-10-27', actor)).status).toBe(200);
  });
  it.each(['/api/voice?user=self', '/api/voice/day'])('requires login for %s', async (path) => {
    expect((await call(path)).status).toBe(401);
  });
  it('refuses NUL user IDs at the HTTP boundary and in direct shared reads', async () => {
    expect((await call('/api/voice?user=other%00', 'judge')).status).toBe(400);
    await expect(getVoiceHistory(env.DB, 'other\u0000', '2026-10-27', '2026-10-27', 0, NOW))
      .rejects.toMatchObject({ status: 400 });
  });
  it('requires an explicit user and returns 404 for a nonexistent target to a judge', async () => {
    expect((await call('/api/voice', 'self')).status).toBe(400);
    expect((await call('/api/voice?user=missing', 'judge')).status).toBe(404);
  });
  it('hides the day roster from ordinary users, including malformed date requests', async () => {
    expect((await call('/api/voice/day?date=bad', 'self')).status).toBe(404);
  });
  it.each([
    'from=2026-02-30&to=2026-03-01', 'from=2026-10-2&to=2026-10-27',
    'from=2026-10-28&to=2026-10-27', 'from=2026-10-01&to=2026-11-01',
  ])('refuses invalid, reverse or oversized date range %s', async (range) => {
    expect((await call(`/api/voice?user=self&${range}`, 'self')).status).toBe(400);
  });
  it('rejects a day that is even partly older than the rolling retention window with an explicit message', async () => {
    const response = await call('/api/voice?user=self&from=2026-07-29&to=2026-07-30', 'self');
    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toMatch(/90 天.*2026-07-30/);
    const day = await call('/api/voice/day?date=2026-07-29', 'judge');
    expect(day.status).toBe(400); expect((await day.json() as { error: string }).error).toContain('90 天');
    expect((await call('/api/voice/day?date=2026-07-30', 'judge')).status).toBe(200);
  });
  it('accepts a board day exactly at the UTC retention cutoff', async () => {
    vi.setSystemTime(Date.parse('2026-10-27T00:00:00Z'));
    expect((await call('/api/voice/day?date=2026-07-29', 'judge', '0')).status).toBe(200);
    expect((await call('/api/voice/day?date=2026-07-28', 'judge', '0')).status).toBe(400);
  });
  it('defaults to the last seven board dates and reports the entire observed interval as uncovered on D1', async () => {
    const response = await call('/api/voice?user=self', 'self');
    const body = await response.json() as VoiceHistoryResponse;
    expect(response.status).toBe(200);
    expect(body.days.map((day) => day.date)).toEqual(['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27']);
    expect(body.gaps).toEqual([{ from: '2026-10-20 16:00:00', to: NOW }]);
    expect(body.days.every((day) => day.segments.length === 0)).toBe(true);
  });
  it('defaults a missing from date to six dates before an explicit end', async () => {
    const body = await (await call('/api/voice?user=self&to=2026-10-26', 'self')).json() as VoiceHistoryResponse;
    expect(body.days[0].date).toBe('2026-10-20'); expect(body.days.at(-1)?.date).toBe('2026-10-26');
  });
  it('uses the effective name and only public actor fields for the history target', async () => {
    await env.DB.prepare("UPDATE users SET display_name = '显示名字', email = 'secret@example.com', avatar_url = 'https://img.example/a.png' WHERE id = 'self'").run();
    const body = await (await call(HISTORY, 'self')).json() as VoiceHistoryResponse;
    expect(body.user).toEqual({ id: 'self', username: '显示名字', avatar_url: 'https://img.example/a.png' }); noPrivateFields(body);
  });
});

describe('voice history and roster reads', () => {
  it('finds a segment that started before the query day and preserves its uncertainty reasons', async () => {
    await add('other', '2026-10-26 23:30:00', '2026-10-27 00:30:00', { start: 'bot_online', end: 'bot_offline' });
    const history = await getVoiceHistory(env.DB, 'other', '2026-10-27', '2026-10-27', 0, NOW);
    expect(history.days[0]).toMatchObject({ first_join: null, total_min: 30, segments: [{ continued: true, start_reason: 'bot_online', end_reason: 'bot_offline' }] });
    const day = await getVoiceDay(env.DB, '2026-10-27', 0, NOW);
    expect(day.users).toEqual([{ user: { id: 'other', username: '当事人', avatar_url: null }, first_join: null, total_min: 30, in_voice_now: false, has_open_segment: false }]);
    noPrivateFields(history); noPrivateFields(day);
  });
  it('returns today by default with private caching and uncovered time even when nobody is listed', async () => {
    const response = await call('/api/voice/day', 'judge'); const body = await response.json() as VoiceDayResponse;
    expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(body).toEqual({ date: '2026-10-27', users: [], gaps: [{ from: '2026-10-26 16:00:00', to: NOW }], retention_days: 90 });
  });
  it('sorts actual first joins before continued-only people and totals all their daily segments', async () => {
    await add('self', '2026-10-27 01:00:00', '2026-10-27 01:20:00');
    await add('self', '2026-10-27 02:00:00', '2026-10-27 02:10:00');
    await add('judge', '2026-10-27 00:30:00', '2026-10-27 00:35:00');
    await add('other', '2026-10-26 23:30:00', '2026-10-27 00:30:00');
    const body = await getVoiceDay(env.DB, '2026-10-27', 0, NOW);
    expect(body.users.map((row) => [row.user.id, row.first_join, row.total_min])).toEqual([
      ['judge', '2026-10-27 00:30:00', 5], ['self', '2026-10-27 01:00:00', 30], ['other', null, 30],
    ]);
  });
  it('marks an open segment live only when today and persisted coverage actually includes now', async () => {
    await add('self', '2026-10-26 23:30:00', null); await cover('2026-10-26 00:00:00', NOW);
    const today = await getVoiceDay(env.DB, '2026-10-27', 0, NOW);
    expect(today.users[0]).toMatchObject({ has_open_segment: true, in_voice_now: true });
    const yesterday = await getVoiceDay(env.DB, '2026-10-26', 0, NOW);
    expect(yesterday.users[0]).toMatchObject({ has_open_segment: true, in_voice_now: false });
  });
  it.each([null, '2026-10-27 11:59:59'])('never calls an unclosed segment live without current committed coverage: %s', async (lastSeen) => {
    await add('self', '2026-10-27 10:00:00', null);
    if (lastSeen) await cover('2026-10-27 00:00:00', lastSeen);
    const day = await getVoiceDay(env.DB, '2026-10-27', 0, NOW);
    expect(day.users[0]).toMatchObject({ has_open_segment: true, in_voice_now: false });
    expect(day.gaps.at(-1)?.to).toBe(NOW);
  });
  it('recognizes a persisted current point without inferring earlier coverage', async () => {
    const point = '2026-10-27 00:00:01';
    await add('self', '2026-10-26 23:30:00', null); await cover(point, point);
    const day = await getVoiceDay(env.DB, '2026-10-27', 0, point);
    expect(day.users[0]).toMatchObject({ has_open_segment: true, in_voice_now: true });
    expect(day.gaps).toEqual([{ from: '2026-10-27 00:00:00', to: point }]);
  });
  it('does not list a join newer than the fixed snapshot and caps a newly closed row at that snapshot', async () => {
    await add('other', '2026-10-27 12:00:01', null);
    await add('self', '2026-10-27 11:59:00', '2026-10-27 12:02:00');
    const day = await getVoiceDay(env.DB, '2026-10-27', 0, NOW);
    expect(day.users.map((row) => [row.user.id, row.total_min])).toEqual([['self', 1]]);
  });
  it('reads coverage before segments so a later checkpoint cannot prove an earlier incomplete record snapshot', async () => {
    const sql: string[] = [];
    const db = { prepare(text: string) { sql.push(text); return env.DB.prepare(text); } } as unknown as D1Database;
    await getVoiceHistory(db, 'self', '2026-10-27', '2026-10-27', 0, NOW);
    expect(sql.findIndex((text) => /FROM voice_coverage/i.test(text))).toBeLessThan(sql.findIndex((text) => /FROM voice_sessions/i.test(text)));
    sql.length = 0; await getVoiceDay(db, '2026-10-27', 0, NOW);
    expect(sql.findIndex((text) => /FROM voice_coverage/i.test(text))).toBeLessThan(sql.findIndex((text) => /FROM voice_sessions/i.test(text)));
  });
});


describe('voice reads across concurrent retention cleanup', () => {
  it.each(['before', 'after'] as const)('drops revoked history coverage when cleanup commits %s the segment read', async (timing) => {
    await add('self', '2026-07-28 00:00:00', '2026-10-27 11:00:00');
    await cover('2026-10-27 00:00:00', NOW);
    const db = aroundSegments(timing, async () => {
      await env.DB.prepare("DELETE FROM voice_sessions WHERE joined_at < '2026-07-29 12:00:00'").run();
      await env.DB.prepare('DELETE FROM voice_coverage').run();
      await cover(NOW, NOW);
    });
    const result = await getVoiceHistory(db, 'self', '2026-10-27', '2026-10-27', 0, NOW);
    expect(result.days[0].segments).toHaveLength(timing === 'before' ? 0 : 1);
    expect(result.gaps).toEqual([{ from: '2026-10-27 00:00:00', to: NOW }]);
  });
  it.each(['before', 'after'] as const)('drops revoked roster coverage and live claims when cleanup commits %s the segment read', async (timing) => {
    await add('other', '2026-07-28 00:00:00', '2026-10-27 11:00:00');
    await add('self', '2026-10-27 10:00:00', null);
    await cover('2026-10-27 00:00:00', NOW);
    const db = aroundSegments(timing, async () => {
      await env.DB.prepare("DELETE FROM voice_sessions WHERE joined_at < '2026-07-29 12:00:00'").run();
      await env.DB.prepare('DELETE FROM voice_coverage').run();
      await cover('2026-10-27 00:00:00', '2026-10-27 06:00:00');
      await cover('2026-10-27 12:00:01', '2026-10-27 12:00:01');
    });
    const result = await getVoiceDay(db, '2026-10-27', 0, NOW);
    expect(result.users.find((person) => person.user.id === 'self')).toMatchObject({ has_open_segment: true, in_voice_now: false });
    expect(result.users.some((person) => person.user.id === 'other')).toBe(timing === 'after');
    expect(result.gaps).toEqual([{ from: '2026-10-27 06:00:00', to: NOW }]);
  });
  it.each(['history', 'day'] as const)('does not let a new checkpoint certify earlier missing %s segments', async (kind) => {
    await cover('2026-10-27 00:00:00', '2026-10-27 06:00:00');
    const db = aroundSegments('after', async () => {
      await add('self', '2026-10-27 10:00:00', null);
      await cover('2026-10-27 06:00:00', NOW);
    });
    const result = kind === 'history' ? await getVoiceHistory(db, 'self', '2026-10-27', '2026-10-27', 0, NOW)
      : await getVoiceDay(db, '2026-10-27', 0, NOW);
    expect(result.gaps).toEqual([{ from: '2026-10-27 06:00:00', to: NOW }]);
    if ('days' in result) expect(result.days[0].segments).toEqual([]);
    else expect(result.users).toEqual([]);
  });
  it('retains a common current endpoint without treating that point as earlier continuous coverage', async () => {
    await add('self', '2026-10-27 10:00:00', null);
    await cover('2026-10-27 00:00:00', NOW);
    const db = aroundSegments('after', async () => {
      await env.DB.prepare('DELETE FROM voice_coverage').run();
      await cover(NOW, '2026-10-27 12:00:01');
    });
    const result = await getVoiceDay(db, '2026-10-27', 0, NOW);
    expect(result.users[0]).toMatchObject({ has_open_segment: true, in_voice_now: true });
    expect(result.gaps).toEqual([{ from: '2026-10-27 00:00:00', to: NOW }]);
  });
});
