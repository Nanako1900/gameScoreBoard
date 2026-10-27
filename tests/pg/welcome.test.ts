// S2 automatic welcomes: real local PG triggers and the normal DM dispatcher.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { handleCommand } from '../../server/src/discord/commands';
import { linkAccounts, unlinkAccounts } from '../../server/src/discord/links';
import { createDispatcher, DM_BUDGET, type ChannelApi } from '../../server/src/outbox/dispatcher';
import { seedUser } from '../worker/helpers';
import { env, pool } from './cloudflare-test';

const USER = 'welcome-user';
const DISCORD = '100000000000000001';
const OTHER_DISCORD = '100000000000000002';
const FRONTEND = 'https://score.example';
const migration = () => readFileSync(new URL('../../server/migrations/0009_welcome.sql', import.meta.url), 'utf8');

async function bind(discordUserId = DISCORD) {
  return linkAccounts(env.DB, { userId: USER, discordUserId, discordUsername: '玩家', replace: true, via: 'web' });
}
async function events() {
  return (await pool.query("SELECT kind, entity, entity_id, dedupe_key, payload, result, last_error FROM outbox WHERE kind = 'dm.welcome' ORDER BY id")).rows;
}
function discord() {
  const api: ChannelApi = {
    openDm: vi.fn(async () => 'private-channel'),
    send: vi.fn(async () => ({ id: 'private-message' })),
    edit: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
  };
  return api;
}
function dispatcher(api: ChannelApi) {
  return createDispatcher({ pool, db: env.DB, api, config: { verdictChannelId: null, frontendUrl: FRONTEND },
    log: { log() {}, warn() {}, error() {} } });
}

async function person() { await seedUser({ id: USER }); }

describe('automatic welcome events', () => {
  it('queues one immediate welcome for a new binding', async () => {
    await person();
    await bind();
    expect(await events()).toEqual([expect.objectContaining({ kind: 'dm.welcome', entity: 'user', entity_id: USER,
      dedupe_key: expect.stringMatching(/^dm:welcome:/), payload: {}, result: null })]);
    expect((await pool.query("SELECT available_at <= now() AS due FROM outbox WHERE kind = 'dm.welcome'")).rows[0].due).toBe(true);
  });

  it('queues another for a replacement while retaining the DM choice', async () => {
    await person(); await bind();
    await pool.query('UPDATE discord_links SET notify_dm = 0 WHERE user_id = $1', [USER]);
    expect((await bind(OTHER_DISCORD)).kind).toBe('relinked');
    expect(await events()).toHaveLength(2);
    expect((await pool.query('SELECT notify_dm FROM discord_links WHERE user_id = $1', [USER])).rows[0].notify_dm).toBe(0);
  });

  it('does not welcome an unchanged binding or username update again', async () => {
    await person(); await bind();
    await linkAccounts(env.DB, { userId: USER, discordUserId: DISCORD, discordUsername: '新名字', replace: false, via: 'web' });
    expect(await events()).toHaveLength(1);
  });

  it('does not collide when the same Discord account is genuinely rebound in the same second', async () => {
    await person();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO discord_links (discord_user_id, user_id, discord_username, linked_at) VALUES (?, ?, '玩家', '2026-10-27 12:00:00')").bind(DISCORD, USER),
      env.DB.prepare('DELETE FROM discord_links WHERE user_id = ?').bind(USER),
      env.DB.prepare("INSERT INTO discord_links (discord_user_id, user_id, discord_username, linked_at) VALUES (?, ?, '玩家', '2026-10-27 12:00:00')").bind(DISCORD, USER),
    ]);
    const queued = await events();
    expect(queued).toHaveLength(2);
    expect(new Set(queued.map((event) => event.dedupe_key)).size).toBe(2);
  });

  it('is silent during an import and rolls an event back with its binding', async () => {
    await person();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL edg.importing = 'on'");
      await client.query("INSERT INTO discord_links (discord_user_id, user_id, discord_username) VALUES ($1, $2, '导入')", [DISCORD, USER]);
      expect((await client.query("SELECT * FROM outbox WHERE kind = 'dm.welcome'")).rows).toEqual([]);
      await client.query('ROLLBACK');
      await client.query('BEGIN');
      await client.query("INSERT INTO discord_links (discord_user_id, user_id, discord_username) VALUES ($1, $2, '正常')", [DISCORD, USER]);
      expect((await client.query("SELECT * FROM outbox WHERE kind = 'dm.welcome'")).rows).toHaveLength(1);
      await client.query('ROLLBACK');
    } finally { await client.query('ROLLBACK'); client.release(); }
    expect(await events()).toEqual([]);
  });

  it('can rerun the migration without welcoming existing members', async () => {
    await person(); await bind();
    await pool.query("DELETE FROM outbox WHERE kind = 'dm.welcome'");
    await pool.query(migration());
    await pool.query(migration());
    expect(await events()).toEqual([]);
  });
});

describe('welcome delivery', () => {
  it('opens a private DM and sends the shared guide with a stable nonce', async () => {
    await person(); await bind();
    const api = discord();
    expect(await dispatcher(api).runOnce()).toBe(1);
    expect(api.openDm).toHaveBeenCalledExactlyOnceWith(DISCORD);
    expect(api.send).toHaveBeenCalledExactlyOnceWith('private-channel', expect.objectContaining({
      nonce: expect.stringMatching(/^ob/), enforce_nonce: true, allowed_mentions: { parse: [] },
    }));
    const message = vi.mocked(api.send).mock.calls[0][1];
    expect(JSON.stringify(message)).toContain('/score');
    expect(JSON.stringify(message)).toContain(FRONTEND);
    expect((await events())[0].result).toBe('sent');
  });

  it.each(['notify_dm', 'dm_ok'])('skips a recipient whose %s is off', async (column) => {
    await person(); await bind();
    await pool.query(`UPDATE discord_links SET ${column} = 0 WHERE user_id = $1`, [USER]);
    const api = discord();
    await dispatcher(api).runOnce();
    expect((await events())[0].result).toBe('skipped');
    expect(api.openDm).not.toHaveBeenCalled(); expect(api.send).not.toHaveBeenCalled();
  });

  it('skips a binding that was removed before delivery', async () => {
    await person(); await bind();
    await unlinkAccounts(env.DB, { userId: USER }, 'web');
    const api = discord(); await dispatcher(api).runOnce();
    expect((await events())[0].result).toBe('skipped'); expect(api.openDm).not.toHaveBeenCalled();
  });

  it('does not consume or obey the case-reminder budget', async () => {
    await person(); await bind();
    for (let i = 0; i < DM_BUDGET; i += 1) {
      await pool.query("INSERT INTO outbox (kind, entity, entity_id, dedupe_key, processed_at, result) VALUES ('dm.filed', 'user', $1, $2, now(), 'sent')", [USER, `used:${i}`]);
    }
    const api = discord(); await dispatcher(api).runOnce();
    expect(api.send).toHaveBeenCalledOnce(); expect((await events())[0].result).toBe('sent');
  });

  it('marks DMs closed on Discord 50007', async () => {
    await person(); await bind();
    const api = discord(); vi.mocked(api.openDm).mockRejectedValueOnce(Object.assign(new Error('DM closed'), { status: 403, code: 50007 }));
    await dispatcher(api).runOnce();
    expect((await pool.query('SELECT dm_ok FROM discord_links WHERE user_id = $1', [USER])).rows[0].dm_ok).toBe(0);
    expect((await events())[0]).toMatchObject({ result: 'skipped', last_error: 'DMs closed (50007)' });
  });
});

describe('/help', () => {
  it('needs no binding and keeps the guide private', async () => {
    const reply = await handleCommand({ commandName: 'help', caller: { id: DISCORD, username: '未绑定' }, targetUser: null },
      { db: env.DB, appUrl: 'https://api.example', frontendUrl: FRONTEND });
    expect(reply.ephemeral).toBe(true); expect(JSON.stringify(reply)).toContain('/score');
    expect(reply.buttons).toEqual([{ label: '打开网页', url: `${FRONTEND}/` }]);
  });
});
