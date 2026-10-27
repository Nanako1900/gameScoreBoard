// S4: the single public board, through real PostgreSQL and a fake Discord API.
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { deliverBoard, scheduleBoardRefresh } from '../../server/src/outbox/board-delivery';
import { createDispatcher, type ChannelApi, type DispatcherConfig } from '../../server/src/outbox/dispatcher';
import type { OutboxRow } from '../../server/src/outbox/kit';
import type { ChannelMessage } from '../../server/src/discord/verdict';
import { seedUser } from '../worker/helpers';
import { env, pool } from './cloudflare-test';

const CHANNEL = '200000000000000011';
const OLD_CHANNEL = '200000000000000012';
const quiet = { log: () => undefined, warn: () => undefined, error: () => undefined };
const config: DispatcherConfig = { verdictChannelId: null, boardChannelId: CHANNEL, frontendUrl: 'https://score.example' };
const error = (status: number, code?: number) => Object.assign(new Error(`Discord ${status}`), { status, code });
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};
function fakeDiscord() {
  const calls: Array<{ kind: 'send' | 'edit' | 'remove'; channel: string; id?: string; message?: ChannelMessage & { nonce?: string } }> = [];
  const visible = new Map<string, { id: string; channel: string }>();
  const failures: { send: unknown[]; edit: unknown[]; remove: unknown[]; find: unknown[] } = { send: [], edit: [], remove: [], find: [] };
  const scans: Array<{ channel: string; afterId?: string }> = [];
  let onSend: (() => Promise<void>) | null = null;
  let next = 0;
  const api: ChannelApi = {
    async findBoards(channel, afterId) {
      scans.push({ channel, afterId });
      if (failures.find.length) throw failures.find.shift();
      return [...visible.values()].filter((value) => value.channel === channel && (!afterId || BigInt(value.id) > BigInt(afterId))).map((value) => value.id);
    },
    async send(channel, message) {
      calls.push({ kind: 'send', channel, message });
      if (failures.send.length) throw failures.send.shift();
      const key = `${channel}:${message.nonce}`;
      let sent = visible.get(key);
      if (!sent) { sent = { id: `93000000000000${String(++next).padStart(4, '0')}`, channel }; visible.set(key, sent); }
      if (onSend) { const hold = onSend; onSend = null; await hold(); }
      return { id: sent.id };
    },
    async edit(channel, id, message) {
      calls.push({ kind: 'edit', channel, id, message });
      if (failures.edit.length) throw failures.edit.shift();
    },
    async remove(channel, id) {
      calls.push({ kind: 'remove', channel, id });
      if (failures.remove.length) throw failures.remove.shift();
      for (const [key, value] of visible) if (value.id === id && value.channel === channel) visible.delete(key);
    },
    async openDm() { throw new Error('board must not open DMs'); },
  };
  return { api, calls, visible, scans, orphan: (id: string, channel = CHANNEL) => visible.set(`orphan:${channel}:${id}`, { id, channel }), fail: (kind: keyof typeof failures, problem: unknown) => failures[kind].push(problem), holdSend: (fn: () => Promise<void>) => { onSend = fn; } };
}
function dispatcher(api: ChannelApi, options: { boardChannelId?: string | null; connection?: pg.Pool } = {}) {
  return createDispatcher({ pool: options.connection ?? pool, db: env.DB, api,
    config: { ...config, ...(Object.hasOwn(options, 'boardChannelId') ? { boardChannelId: options.boardChannelId } : {}) }, log: quiet });
}
async function schedule() { await scheduleBoardRefresh(pool); await due(); }
async function due() { await pool.query("UPDATE outbox SET available_at = now() WHERE entity = 'board' AND processed_at IS NULL"); }
async function stored() { return (await pool.query("SELECT channel_id, message_id FROM discord_messages WHERE entity = 'board' AND entity_id = 'main' AND purpose = 'board'")).rows; }
async function events() { return (await pool.query("SELECT result, attempts, last_error, claim_token FROM outbox WHERE entity = 'board' ORDER BY id")).rows; }
async function remember(channel = CHANNEL) {
  await pool.query("INSERT INTO discord_messages(entity,entity_id,purpose,channel_id,message_id) VALUES ('board','main','board',$1,'930000000000009999')", [channel]);
}
async function claimedRow(): Promise<OutboxRow> {
  return (await pool.query<OutboxRow>("UPDATE outbox SET claim_token = gen_random_uuid(), claimed_at = now(), attempts = 1 WHERE entity = 'board' RETURNING *")).rows[0];
}
async function waitForLock() {
  for (let i = 0; i < 300; i += 1) {
    const rows = await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%board:main:delivery%'");
    if (rows.rowCount) return;
    await new Promise((done) => setTimeout(done, 10));
  }
  throw new Error('board delivery did not wait for its advisory lock');
}

describe('board refresh delivery', () => {
  it('schedules the shared startup refresh ten seconds out and coalesces the pending row', async () => {
    await scheduleBoardRefresh(pool);
    const before = (await pool.query("SELECT id, available_at, extract(epoch FROM available_at - now()) AS seconds FROM outbox WHERE entity = 'board'")).rows;
    expect(before).toHaveLength(1); expect(Number(before[0].seconds)).toBeGreaterThan(8); expect(Number(before[0].seconds)).toBeLessThanOrEqual(10);
    await scheduleBoardRefresh(pool);
    expect((await pool.query("SELECT id, available_at FROM outbox WHERE entity = 'board'")).rows).toEqual([{ id: before[0].id, available_at: before[0].available_at }]);
  });
  it('sends the first board with a stable nonce and remembers the message', async () => {
    await schedule(); const discord = fakeDiscord();
    expect(await dispatcher(discord.api).runOnce()).toBe(1);
    expect(discord.calls.map((call) => call.kind)).toEqual(['send']);
    expect(discord.calls[0].message).toMatchObject({ allowed_mentions: { parse: [] }, enforce_nonce: true, nonce: expect.stringMatching(/^ob\d+\.[a-z0-9]+$/) });
    expect(await stored()).toEqual([{ channel_id: CHANNEL, message_id: '930000000000000001' }]);
    expect((await events())[0].result).toBe('sent');
  });
  it('edits the existing message in the same channel', async () => {
    await remember(); await schedule(); const discord = fakeDiscord(); await dispatcher(discord.api).runOnce();
    expect(discord.calls.map((call) => call.kind)).toEqual(['edit']);
    expect(discord.calls[0]).toMatchObject({ channel: CHANNEL, id: '930000000000009999' });
  });
  it.each([10008, 10003])('recovers an existing message rejected with %i', async (code) => {
    await remember(); await schedule(); const discord = fakeDiscord(); discord.fail('edit', error(404, code));
    await dispatcher(discord.api).runOnce();
    expect(discord.calls.map((call) => call.kind)).toEqual(['edit', 'send']);
    expect(await stored()).toEqual([{ channel_id: CHANNEL, message_id: '930000000000000001' }]);
  });
  it('removes the old channel message before posting to the configured channel', async () => {
    await remember(OLD_CHANNEL); await schedule(); const discord = fakeDiscord(); await dispatcher(discord.api).runOnce();
    expect(discord.calls.map((call) => [call.kind, call.channel])).toEqual([['remove', OLD_CHANNEL], ['send', CHANNEL]]);
    expect((await stored())[0].channel_id).toBe(CHANNEL);
  });
  it.each([[404, 10008], [404, 10003], [403, 50001]])('ignores an inaccessible old message (%i/%i) when moving', async (status, code) => {
    await remember(OLD_CHANNEL); await schedule(); const discord = fakeDiscord(); discord.fail('remove', error(status, code));
    await dispatcher(discord.api).runOnce();
    expect(discord.calls.map((call) => call.kind)).toEqual(['remove', 'send']); expect((await events())[0].result).toBe('sent');
  });
  it('keeps the old mapping and retries a temporary removal error', async () => {
    await remember(OLD_CHANNEL); await schedule(); const discord = fakeDiscord(); discord.fail('remove', error(503));
    await dispatcher(discord.api).runOnce();
    expect(discord.calls.map((call) => call.kind)).toEqual(['remove']); expect((await stored())[0].channel_id).toBe(OLD_CHANNEL);
    expect((await events())[0]).toMatchObject({ result: null, attempts: 1 });
  });
  it('retries a current-channel edit refusal without forgetting the message or sending again', async () => {
    await remember(); await schedule(); const discord = fakeDiscord(); discord.fail('edit', error(403, 50013));
    await dispatcher(discord.api).runOnce();
    expect(discord.calls.map((call) => call.kind)).toEqual(['edit']); expect((await stored())[0].channel_id).toBe(CHANNEL);
    expect((await events())[0]).toMatchObject({ result: null, attempts: 0 });
  });
  it('names the board configuration when a new target channel does not exist', async () => {
    await schedule(); const discord = fakeDiscord(); discord.fail('send', error(404, 10003)); await dispatcher(discord.api).runOnce();
    expect((await events())[0]).toMatchObject({ result: 'dead', last_error: expect.stringContaining('DISCORD_BOARD_CHANNEL_ID') });
  });
  it('skips when the board channel is unconfigured', async () => {
    await schedule(); const discord = fakeDiscord(); await dispatcher(discord.api, { boardChannelId: null }).runOnce();
    expect(discord.calls).toEqual([]); expect(await stored()).toEqual([]);
    expect((await events())[0]).toMatchObject({ result: 'skipped', last_error: 'no board channel configured' });
  });
  it('reloads the latest public state and ignores event payload contents', async () => {
    await seedUser({ id: 'player', username: '最新名字', score: 73 }); await due();
    await pool.query("UPDATE outbox SET payload = '{\"top\":[{\"name\":\"SECRET_PAYLOAD\"}]}' WHERE entity = 'board'");
    const discord = fakeDiscord(); await dispatcher(discord.api).runOnce(); const text = JSON.stringify(discord.calls[0].message);
    expect(text).toContain('最新名字'); expect(text).toContain('73 分'); expect(text).not.toContain('SECRET_PAYLOAD');
  });
  it('backs off an API failure and renders the changed data on retry', async () => {
    await seedUser({ id: 'player', username: '旧名' }); await due(); const discord = fakeDiscord(); discord.fail('send', error(503));
    const d = dispatcher(discord.api); await d.runOnce();
    await env.DB.prepare("UPDATE users SET display_name = '新的名字' WHERE id = 'player'").run(); await due(); await d.runOnce();
    expect(discord.calls.map((call) => call.kind)).toEqual(['send', 'send']);
    expect(discord.calls[0].message?.nonce).toBe(discord.calls[1].message?.nonce); expect(JSON.stringify(discord.calls[1].message)).toContain('新的名字');
  });
  it('retains the nonce after a successful send whose mapping write failed', async () => {
    await schedule();
    await pool.query("CREATE OR REPLACE FUNCTION test_board_mapping_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'mapping unavailable'; END $$");
    await pool.query("CREATE TRIGGER test_board_mapping_fail BEFORE INSERT ON discord_messages FOR EACH STATEMENT EXECUTE FUNCTION test_board_mapping_fail()");
    const discord = fakeDiscord(); const d = dispatcher(discord.api);
    try { await d.runOnce(); expect(await stored()).toEqual([]); expect((await events())[0]).toMatchObject({ result: null, attempts: 1 }); }
    finally { await pool.query('DROP TRIGGER test_board_mapping_fail ON discord_messages'); await pool.query('DROP FUNCTION test_board_mapping_fail()'); }
    await pool.query("UPDATE outbox SET created_at = now() - interval '6 hours' WHERE entity = 'board'");
    await due(); await d.runOnce();
    expect(discord.calls.map((call) => call.kind)).toEqual(['send', 'edit']);
    expect(discord.visible.size).toBe(1); expect(await stored()).toHaveLength(1);
  });
  it('recovers a send whose mapping rolled back hours ago without another send after nonce expiry', async () => {
    await schedule(); const discord = fakeDiscord(); discord.orphan('930000000000000041');
    await pool.query("UPDATE outbox SET created_at = now() - interval '6 hours' WHERE entity = 'board'");
    await dispatcher(discord.api).runOnce();
    expect(discord.calls.map((call) => call.kind)).toEqual(['edit']); expect(discord.calls[0].id).toBe('930000000000000041');
    expect(await stored()).toEqual([{ channel_id: CHANNEL, message_id: '930000000000000041' }]);
  });
  it('keeps the oldest recovered board and deletes every newer orphan before editing', async () => {
    await schedule(); const discord = fakeDiscord();
    for (const n of ['43', '41', '42']) discord.orphan(`9300000000000000${n}`);
    await dispatcher(discord.api).runOnce();
    expect(discord.calls.filter((call) => call.kind === 'send')).toEqual([]);
    expect(discord.calls.filter((call) => call.kind === 'remove').map((call) => call.id).sort()).toEqual(['930000000000000042', '930000000000000043']);
    expect(discord.calls.at(-1)).toMatchObject({ kind: 'edit', id: '930000000000000041' }); expect(discord.visible.size).toBe(1);
  });
  it('keeps a valid mapped board canonical while clearing newer orphans with a bounded scan', async () => {
    await remember(); await schedule(); const discord = fakeDiscord(); discord.orphan('930000000000010000');
    await dispatcher(discord.api).runOnce();
    expect(discord.scans).toEqual([{ channel: CHANNEL, afterId: '930000000000009999' }]);
    expect(discord.calls.map((call) => call.kind)).toEqual(['edit', 'remove']); expect((await stored())[0].message_id).toBe('930000000000009999');
  });
  it('falls back to a full recovery scan when the mapped message was deleted', async () => {
    await remember(); await schedule(); const discord = fakeDiscord(); discord.orphan('930000000000000041'); discord.fail('edit', error(404, 10008));
    await dispatcher(discord.api).runOnce();
    expect(discord.scans).toEqual([{ channel: CHANNEL, afterId: undefined }]);
    expect(discord.calls.map((call) => call.kind)).toEqual(['edit', 'edit']); expect((await stored())[0].message_id).toBe('930000000000000041');
  });
  it.each([error(403, 50013), error(503)])('does not send or forget a mapping after a history scan failure', async (failure) => {
    await remember(OLD_CHANNEL); await schedule(); const discord = fakeDiscord(); discord.fail('find', failure); await dispatcher(discord.api).runOnce();
    expect(discord.calls.filter((call) => call.kind === 'send')).toEqual([]); expect((await stored())[0].channel_id).toBe(OLD_CHANNEL);
    expect((await events())[0].result).toBeNull();
  });
  it('retries rather than sending when a recovered candidate disappears before its edit', async () => {
    await schedule(); const discord = fakeDiscord(); discord.orphan('930000000000000041'); discord.fail('edit', error(404, 10008));
    await dispatcher(discord.api).runOnce();
    expect(discord.calls.map((call) => call.kind)).toEqual(['edit']); expect((await events())[0]).toMatchObject({ result: null, attempts: 1 }); expect(await stored()).toEqual([]);
  });
  it('does not send when no history recovery capability was supplied', async () => {
    await schedule(); const discord = fakeDiscord(); delete discord.api.findBoards; await dispatcher(discord.api).runOnce();
    expect(discord.calls).toEqual([]); expect((await events())[0].result).toBeNull(); expect(await stored()).toEqual([]);
  });
  it('does not send when cleanup of a duplicate is refused in the target channel', async () => {
    await schedule(); const discord = fakeDiscord(); discord.orphan('930000000000000041'); discord.orphan('930000000000000042'); discord.fail('remove', error(403, 50013));
    await dispatcher(discord.api).runOnce(); expect(discord.calls.map((call) => call.kind)).toEqual(['remove']); expect((await events())[0].result).toBeNull();
  });
  it('does not send or change mappings after its claim was replaced while waiting for the delivery lock', async () => {
    await remember(); await schedule(); const row = await claimedRow(); const holder = await pool.connect(); const discord = fakeDiscord();
    let work: Promise<unknown> | undefined;
    try {
      await holder.query('BEGIN'); await holder.query("SELECT pg_advisory_xact_lock(hashtextextended('board:main:delivery', 0))");
      work = deliverBoard(row, { pool, db: env.DB, api: discord.api, config }); work.catch(() => undefined); await waitForLock();
      await pool.query('UPDATE outbox SET claim_token = gen_random_uuid() WHERE id = $1', [row.id]); await holder.query('COMMIT');
      expect(await work).toMatchObject({ result: 'skipped' }); expect(discord.calls).toEqual([]);
      expect((await stored())[0].message_id).toBe('930000000000009999');
    } finally { await holder.query('ROLLBACK').catch(() => undefined); holder.release(); await work?.catch(() => undefined); }
  });
  it.each(['expired', 'processed'])('does not start an %s claim after it acquires the delivery lock', async (state) => {
    await schedule(); const row = await claimedRow(); const holder = await pool.connect(); const discord = fakeDiscord();
    let work: Promise<unknown> | undefined;
    try {
      await holder.query('BEGIN'); await holder.query("SELECT pg_advisory_xact_lock(hashtextextended('board:main:delivery', 0))");
      work = deliverBoard(row, { pool, db: env.DB, api: discord.api, config }); work.catch(() => undefined); await waitForLock();
      if (state === 'expired') await pool.query("UPDATE outbox SET claimed_at = now() - interval '3 minutes' WHERE id = $1", [row.id]);
      else await pool.query("UPDATE outbox SET processed_at = now(), result = 'sent' WHERE id = $1", [row.id]);
      await holder.query('COMMIT'); expect(await work).toMatchObject({ result: state === 'expired' ? 'retry' : 'skipped' }); expect(discord.calls).toEqual([]); expect(await stored()).toEqual([]);
    } finally { await holder.query('ROLLBACK').catch(() => undefined); holder.release(); await work?.catch(() => undefined); }
  });
  it('serializes two deliveries after the first claim passes the two minute lease', async () => {
    await schedule(); const discord = fakeDiscord(); const entered = deferred(); const release = deferred();
    discord.holdSend(async () => { entered.resolve(); await release.promise; });
    const first = dispatcher(discord.api).runOnce(); await entered.promise;
    await pool.query("UPDATE outbox SET claimed_at = now() - interval '3 minutes' WHERE entity = 'board'");
    const second = dispatcher(discord.api).runOnce(); second.catch(() => undefined);
    try { await waitForLock(); expect(discord.calls).toHaveLength(1); }
    finally { release.resolve(); }
    await Promise.all([first, second]);
    expect(discord.calls.map((call) => call.kind)).toEqual(['send', 'edit']);
    expect(discord.visible.size).toBe(1); expect(await stored()).toHaveLength(1); expect((await events())[0].result).toBe('sent');
  });
  it('keeps a change during delivery as a later refresh and edits the same message', async () => {
    await seedUser({ id: 'player', username: '之前' }); await due(); const discord = fakeDiscord(); const entered = deferred(); const release = deferred();
    discord.holdSend(async () => { entered.resolve(); await release.promise; }); const d = dispatcher(discord.api); const work = d.runOnce(); await entered.promise;
    try {
      await env.DB.prepare("UPDATE users SET display_name = '之后' WHERE id = 'player'").run();
      expect(await events()).toHaveLength(2);
    } finally { release.resolve(); }
    await work; await due(); await d.runOnce();
    expect(discord.calls.map((call) => call.kind)).toEqual(['send', 'edit']); expect(JSON.stringify(discord.calls[1].message)).toContain('之后');
  });
  it('loads and delivers without borrowing a second connection when the pool maximum is one', async () => {
    await schedule(); const single = new pg.Pool({ connectionString: pool.options.connectionString, max: 1 }); const discord = fakeDiscord();
    try { await dispatcher(discord.api, { connection: single }).runOnce(); expect(discord.calls.map((call) => call.kind)).toEqual(['send']); }
    finally { await single.end(); }
  }, 10_000);
});
