// Real local-PG evidence recording, including interrupted writes and live-cache races.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VOICE_HEARTBEAT_MS } from '../../shared/voice';
import { createVoiceRecorder, type VoicePresent, type VoiceRecorder } from '../../server/src/voice/recorder';
import { linkAccounts } from '../../server/src/discord/links';
import { seedUser } from '../worker/helpers';
import { env, pool } from './cloudflare-test';

const USER = 'voice-person';
const DISCORD = '100000000000000001';
const OTHER = '100000000000000002';
const A = '200000000000000001';
const B = '200000000000000002';
const running: VoiceRecorder[] = [];
let present: readonly VoicePresent[] | null = [];
let ready = true;
let clock: number | undefined;
const log = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
function make(getPresent = () => present) {
  const recorder = createVoiceRecorder({ pool, getPresent, isReady: () => ready, now: () => clock ?? Date.now(), log });
  running.push(recorder); return recorder;
}
async function person(userId = USER, discordUserId = DISCORD) {
  await seedUser({ id: userId });
  await linkAccounts(env.DB, { userId, discordUserId, discordUsername: '玩家', replace: false, via: 'web' });
}
function update(discordUserId = DISCORD, prevChannelId: string | null = null, nextChannelId: string | null = A) {
  return { discordUserId, prevChannelId, nextChannelId, nextChannelName: nextChannelId === A ? '开黑一号' : '开黑二号' };
}
async function segments() { return (await pool.query('SELECT * FROM voice_sessions ORDER BY id')).rows; }
async function coverage() { return (await pool.query('SELECT * FROM voice_coverage ORDER BY id')).rows; }
async function oldOpen(joinedAgo = '20 minutes', discordUserId = DISCORD) {
  await pool.query(`INSERT INTO voice_sessions (user_id, discord_user_id, channel_id, channel_name, joined_at, start_reason)
    VALUES ($1, $2, $3, '旧频道', datetime('now', $4), 'joined')`, [USER, discordUserId, A, `-${joinedAgo}`]);
}
async function oldCoverage(ago = '10 minutes') {
  await pool.query("INSERT INTO voice_coverage (started_at, last_seen_at) VALUES (LEAST(datetime('now', '-30 minutes'), datetime('now', $1)), datetime('now', $1))", [`-${ago}`]);
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
async function rejectInsert() {
  await pool.query(`CREATE OR REPLACE FUNCTION test_reject_voice() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'private Discord ${DISCORD} channel ${A}'; END; $$;
    CREATE TRIGGER test_reject_voice BEFORE INSERT ON voice_sessions FOR EACH ROW EXECUTE FUNCTION test_reject_voice()`);
}
async function allowInsert() {
  await pool.query('DROP TRIGGER IF EXISTS test_reject_voice ON voice_sessions; DROP FUNCTION IF EXISTS test_reject_voice()');
}
afterEach(async () => {
  for (const recorder of running.splice(0)) await recorder.stop();
  await allowInsert();
  vi.restoreAllMocks(); vi.useRealTimers();
  present = []; ready = true; clock = undefined;
});

describe('ordered voice events', () => {
  it('records one join and its leave with explicit UTC text and reasons', async () => {
    await person(); const recorder = make();
    await recorder.onVoiceUpdate(update()); await recorder.onVoiceUpdate(update(DISCORD, A, null));
    expect(await segments()).toEqual([expect.objectContaining({ user_id: USER, channel_name: '开黑一号', start_reason: 'joined', end_reason: 'left' })]);
    const [row] = await segments();
    expect(row.joined_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(row.left_at >= row.joined_at).toBe(true);
  });
  it('closes a move before opening the next channel', async () => {
    await person(); const recorder = make();
    await recorder.onVoiceUpdate(update()); await recorder.onVoiceUpdate(update(DISCORD, A, B));
    expect((await segments()).map((row) => [row.channel_id, row.start_reason, row.end_reason])).toEqual([
      [A, 'joined', 'moved'], [B, 'moved', null],
    ]);
  });
  it.each([null, B])('clamps an earlier transaction clock on a leave/move without overlapping the next row: %s', async (next) => {
    await person(); await oldOpen();
    await pool.query("UPDATE voice_sessions SET joined_at = datetime('now', '+1 second')");
    const recorder = make(); await recorder.onVoiceUpdate(update(DISCORD, A, next));
    const rows = await segments(); expect(rows[0].left_at).toBe(rows[0].joined_at);
    if (next !== null) expect(rows[1].joined_at >= rows[0].left_at).toBe(true);
    expect((await recorder.status()).degraded).toBe(false);
  });
  it('serializes the whole binding lookup and write for concurrent same-person events', async () => {
    await person(); const recorder = make();
    await Promise.all([recorder.onVoiceUpdate(update()), recorder.onVoiceUpdate(update(DISCORD, A, B)), recorder.onVoiceUpdate(update(DISCORD, B, null))]);
    expect((await segments()).map((row) => [row.channel_id, row.end_reason])).toEqual([[A, 'moved'], [B, 'left']]);
    await Promise.all(Array.from({ length: 8 }, () => recorder.onVoiceUpdate(update())));
    expect((await segments()).filter((row) => row.left_at === null)).toHaveLength(1);
  });
  it('does not open an unbound person, and ignores non-channel updates', async () => {
    const recorder = make(); await recorder.onVoiceUpdate(update()); expect(await segments()).toEqual([]);
    await person(); await recorder.onVoiceUpdate(update(DISCORD, A, A)); expect(await segments()).toEqual([]);
  });
  it('still closes an open row after its binding disappeared', async () => {
    await person(); await oldOpen(); await pool.query('DELETE FROM discord_links WHERE discord_user_id = $1', [DISCORD]);
    await make().onVoiceUpdate(update(DISCORD, A, null));
    expect((await segments())[0]).toMatchObject({ end_reason: 'left', left_at: expect.any(String) });
  });
  it('never opens from a stale binding lookup while a concurrent unlink holds the row', async () => {
    await person(); const recorder = make(); const client = await pool.connect();
    try {
      await client.query('BEGIN'); await client.query('DELETE FROM discord_links WHERE discord_user_id = $1', [DISCORD]);
      const entered = recorder.onVoiceUpdate(update());
      await client.query('COMMIT'); await entered;
    } finally { await client.query('ROLLBACK'); client.release(); }
    expect(await segments()).toEqual([]);
  });
});

describe('full-snapshot reconciliation', () => {
  it('closes an absent person at the last persisted coverage and starts another coverage interval', async () => {
    await person(); await oldOpen(); await oldCoverage(); const before = (await coverage())[0];
    await make().reconcile();
    expect((await segments())[0]).toMatchObject({ end_reason: 'bot_offline', left_at: before.last_seen_at });
    expect(await coverage()).toHaveLength(2);
  });
  it('never puts an uncertain end before its join, including when no previous coverage exists', async () => {
    await person(); await oldOpen('5 minutes'); await oldCoverage(); await make().reconcile();
    let [row] = await segments(); expect(row.left_at).toBe(row.joined_at);
    await pool.query('DELETE FROM voice_sessions'); await pool.query('DELETE FROM voice_coverage');
    await oldOpen(); await make().reconcile(); [row] = await segments(); expect(row.left_at).toBe(row.joined_at);
  });
  it('opens bound people already present and keeps the others absent from storage', async () => {
    await person(); present = [{ discordUserId: DISCORD, channelId: A, channelName: '开黑一号' }, { discordUserId: OTHER, channelId: B, channelName: '未绑定' }];
    const recorder = make(); await recorder.reconcile(); await recorder.reconcile();
    expect(await segments()).toEqual([expect.objectContaining({ start_reason: 'bot_online', left_at: null, channel_id: A })]);
    expect((await recorder.status()).open_segments).toBe(1);
  });
  it('can reconcile a complete initial guild snapshot before ClientReady, but never an unavailable snapshot', async () => {
    await person(); ready = false; present = [{ discordUserId: DISCORD, channelId: A, channelName: '已在语音' }];
    await make().reconcile(); expect(await segments()).toHaveLength(1); expect(await coverage()).toHaveLength(1);
    present = null; await make().reconcile(); expect(await coverage()).toHaveLength(1);
  });
  it('coalesces concurrent requests into exactly one additional pass', async () => {
    const recorder = make(); const first = recorder.reconcile();
    await Promise.all([first, recorder.reconcile(), recorder.reconcile(), recorder.reconcile()]);
    expect(await coverage()).toHaveLength(2);
  });
  it('rechecks the cache when a queued open finally gets the binding lock', async () => {
    await person(); present = [{ discordUserId: DISCORD, channelId: A, channelName: '开黑一号' }];
    const seen = deferred(); const client = await pool.connect();
    const recorder = make(() => { seen.resolve(); return present; });
    try {
      await client.query('BEGIN'); await client.query('SELECT * FROM discord_links WHERE discord_user_id = $1 FOR UPDATE', [DISCORD]);
      const reconciling = recorder.reconcile(); await seen.promise; present = [];
      await client.query('COMMIT'); await reconciling;
    } finally { await client.query('ROLLBACK'); client.release(); }
    expect(await segments()).toEqual([]);
  });
  it('does not close a newer live move using an older reconciliation snapshot', async () => {
    await person(); await oldOpen(); present = [{ discordUserId: DISCORD, channelId: B, channelName: '开黑二号' }];
    const seen = deferred(); const client = await pool.connect();
    const recorder = make(() => { seen.resolve(); return present; });
    try {
      await client.query('BEGIN'); await client.query('SELECT * FROM discord_links WHERE discord_user_id = $1 FOR UPDATE', [DISCORD]);
      const move = recorder.onVoiceUpdate(update(DISCORD, A, B)); const reconciling = recorder.reconcile();
      await seen.promise; await client.query('COMMIT'); await Promise.all([move, reconciling]);
    } finally { await client.query('ROLLBACK'); client.release(); }
    expect((await segments()).map((row) => [row.channel_id, row.start_reason, row.end_reason])).toEqual([[A, 'joined', 'moved'], [B, 'moved', null]]);
  });
});

describe('persisted coverage and degradation', () => {
  it('only heartbeats while ready with a current healthy interval', async () => {
    const recorder = make(); await recorder.heartbeat(); expect(await coverage()).toEqual([]);
    await recorder.reconcile(); const [original] = await coverage();
    ready = false; clock = Date.now() + VOICE_HEARTBEAT_MS;
    await recorder.heartbeat(); expect((await coverage())[0].last_seen_at).toBe(original.last_seen_at);
    ready = true;
    await pool.query("UPDATE voice_coverage SET started_at = datetime('now', '-2 minutes'), last_seen_at = datetime('now', '-1 minute')");
    const [old] = await coverage(); await recorder.heartbeat();
    expect((await coverage())[0].last_seen_at > old.last_seen_at).toBe(true);
    expect((await recorder.status()).degraded).toBe(false);
  });
  it('does not extend coverage past a queued event that fails and resumes only after successful reconciliation', async () => {
    await person(); const recorder = make(); await recorder.reconcile();
    await pool.query("UPDATE voice_coverage SET started_at = datetime('now', '-2 minutes'), last_seen_at = datetime('now', '-1 minute')");
    const [original] = await coverage(); await rejectInsert();
    const client = await pool.connect();
    try {
      await client.query('BEGIN'); await client.query('SELECT * FROM discord_links WHERE discord_user_id = $1 FOR UPDATE', [DISCORD]);
      present = [{ discordUserId: DISCORD, channelId: A, channelName: '开黑一号' }];
      const enter = recorder.onVoiceUpdate(update()); const beat = recorder.heartbeat();
      await client.query('COMMIT'); await Promise.all([enter, beat]);
    } finally { await client.query('ROLLBACK'); client.release(); }
    expect((await coverage())[0].last_seen_at).toBe(original.last_seen_at);
    const status = await recorder.status();
    expect(status).toMatchObject({ degraded: true, coverage_since: null, open_segments: 0 });
    expect(JSON.stringify(status)).not.toContain(DISCORD); expect(JSON.stringify(status)).not.toContain(A);
    await allowInsert(); await recorder.heartbeat();
    expect((await recorder.status())).toMatchObject({ degraded: false, last_error: null, open_segments: 1 });
    expect(await coverage()).toHaveLength(2);
  });
  it('does not resurrect an old interval if a different write fails while its heartbeat is in flight', async () => {
    await person(); const recorder = make(); await recorder.reconcile(); await rejectInsert();
    const reached = deferred(); const release = deferred();
    const real = pool.query.bind(pool);
    const spy = vi.spyOn(pool, 'query');
    spy.mockImplementation((async (...args: unknown[]) => {
      if (typeof args[0] === 'string' && /UPDATE voice_coverage/i.test(args[0])) { reached.resolve(); await release.promise; }
      return (real as (...input: unknown[]) => unknown)(...args);
    }) as typeof pool.query);
    try {
      const beat = recorder.heartbeat(); await reached.promise;
      await recorder.onVoiceUpdate(update()); release.resolve(); await beat;
      expect((await recorder.status())).toMatchObject({ degraded: true, coverage_since: null });
    } finally { release.resolve(); spy.mockRestore(); }
  });
  it('drops a missing checkpoint instead of keeping a healthy cursor that updates nothing', async () => {
    const recorder = make(); await recorder.reconcile(); await pool.query('DELETE FROM voice_coverage');
    await recorder.heartbeat(); expect((await recorder.status())).toMatchObject({ degraded: true, coverage_since: null });
    await recorder.heartbeat(); expect((await recorder.status())).toMatchObject({ degraded: false, last_error: null });
    expect(await coverage()).toHaveLength(1);
  });
  it('does not open fresh coverage on resume while still degraded', async () => {
    await person(); const recorder = make(); await recorder.reconcile(); await rejectInsert();
    await recorder.onVoiceUpdate(update()); clock = Date.now() + 3 * VOICE_HEARTBEAT_MS;
    await recorder.resume(); expect(await coverage()).toHaveLength(1);
    expect((await recorder.status()).degraded).toBe(true);
  });
  it('does not advance beyond heartbeat admission if the later database clock is ahead', async () => {
    const recorder = make(); await recorder.reconcile();
    await pool.query("UPDATE voice_coverage SET started_at = datetime('now', '-10 minutes'), last_seen_at = datetime('now', '-5 minutes')");
    clock = Date.now(); const expected = new Date(clock).toISOString().slice(0, 19).replace('T', ' ');
    const later = new Date(clock + 5 * 60_000).toISOString().slice(0, 19).replace('T', ' ');
    const real = pool.query.bind(pool); const spy = vi.spyOn(pool, 'query');
    spy.mockImplementation((async (...args: unknown[]) => {
      if (typeof args[0] === 'string' && /^SELECT datetime\('now'\) AS at/.test(args[0])) return { rows: [{ at: later }] };
      return (real as (...input: unknown[]) => unknown)(...args);
    }) as typeof pool.query);
    try { await recorder.heartbeat(); expect((await coverage())[0].last_seen_at).toBe(expected); }
    finally { spy.mockRestore(); }
  });
  it('returns an unknown count and a sanitized degraded state when a status read fails', async () => {
    const recorder = make(); await recorder.reconcile();
    vi.spyOn(pool, 'query').mockRejectedValueOnce(new Error(`private ${DISCORD} ${A}`));
    const status = await recorder.status(); expect(status).toMatchObject({ open_segments: null, degraded: true, coverage_since: null });
    expect(JSON.stringify(status)).not.toContain(DISCORD); expect(JSON.stringify(status)).not.toContain(A);
  });
  it('reports count from the database, including closures made by another process', async () => {
    await person(); const recorder = make(); await recorder.onVoiceUpdate(update());
    expect((await recorder.status()).open_segments).toBe(1);
    await pool.query("UPDATE voice_sessions SET left_at = datetime('now'), end_reason = 'unlinked' WHERE left_at IS NULL");
    expect((await recorder.status()).open_segments).toBe(0);
  });
});

describe('resume, retention and lifecycle', () => {
  it('retains short resumed coverage but starts a new interval after a silence over two heartbeats without reconciling', async () => {
    await person(); const recorder = make(); await recorder.reconcile(); const [first] = await coverage();
    clock = Date.parse(first.last_seen_at.replace(' ', 'T') + 'Z') + 2 * VOICE_HEARTBEAT_MS;
    await recorder.resume(); expect(await coverage()).toHaveLength(1);
    clock += 1; await recorder.resume(); expect(await coverage()).toHaveLength(2);
    // No fake cache reconciliation closes this open row during a resume.
    await recorder.onVoiceUpdate(update()); present = [];
    clock += 3 * VOICE_HEARTBEAT_MS; await recorder.resume();
    expect((await segments())[0].left_at).toBeNull();
  });
  it('does not extend or begin resumed coverage for an unavailable guild', async () => {
    const recorder = make(); await recorder.reconcile(); ready = false; present = null;
    clock = Date.now() + 3 * VOICE_HEARTBEAT_MS; await recorder.resume(); expect(await coverage()).toHaveLength(1);
  });
  it('deletes expired closed/open rows and coverage, retaining recent history', async () => {
    await person(); await oldOpen('91 days');
    await pool.query("UPDATE voice_sessions SET left_at = joined_at, end_reason = 'left'");
    await oldOpen('92 days');
    await pool.query(`INSERT INTO voice_sessions (user_id, discord_user_id, channel_id, channel_name, joined_at, left_at, start_reason, end_reason)
      VALUES ($1, $2, $3, '昨天', datetime('now', '-1 day'), datetime('now', '-23 hours'), 'joined', 'left')`, [USER, DISCORD, A]);
    await oldCoverage('91 days'); await make().cleanup();
    expect((await segments()).map((row) => row.channel_name)).toEqual(['昨天']);
    expect(await coverage()).toEqual([expect.objectContaining({ id: 2 })]);
  });
  it('reopens an expired active person from the current snapshot, without keeping the expired history', async () => {
    await person(); await oldOpen('91 days'); present = [{ discordUserId: DISCORD, channelId: B, channelName: '开黑二号' }];
    const recorder = make(); await recorder.cleanup();
    expect(await segments()).toEqual([expect.objectContaining({ channel_id: B, start_reason: 'bot_online', left_at: null })]);
    expect((await recorder.status()).degraded).toBe(false); expect(await coverage()).toHaveLength(1);
  });
  it('creates and clears only its heartbeat/cleanup timers and stops admitting work', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const recorder = make(); expect(vi.getTimerCount()).toBe(0);
    recorder.start(); recorder.start(); expect(vi.getTimerCount()).toBe(2);
    await recorder.stop(); expect(vi.getTimerCount()).toBe(0);
    await recorder.onVoiceUpdate(update()); expect(await segments()).toEqual([]);
  });
});
