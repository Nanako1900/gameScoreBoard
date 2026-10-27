// S1: use only the local PG fixture; preserve history while retiring producers.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createDispatcher, type ChannelApi } from '../../server/src/outbox/dispatcher';
import { seedUser } from '../worker/helpers';
import { env, pool } from './cloudflare-test';

const CHANNEL = '200000000000000001';
const MESSAGE = '900000000000000001';
const migration = () => readFileSync(new URL('../../server/migrations/0008_sessions_off.sql', import.meta.url), 'utf8');

function discord() {
  const api: ChannelApi = {
    send: vi.fn(async () => ({ id: 'unexpected' })),
    edit: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    openDm: vi.fn(async () => 'unexpected-dm'),
  };
  return api;
}

function dispatcher(api: ChannelApi) {
  return createDispatcher({ pool, db: env.DB, api,
    config: { verdictChannelId: null, frontendUrl: 'https://score.example' },
    log: { log() {}, warn() {}, error() {} },
  });
}

describe('sessions off migration', () => {
  it('is repeatable, drops the old queue, preserves history and removes every posted card', async () => {
    const client = await pool.connect();
    let sessionId: string;
    try {
      await client.query('BEGIN');
      // Recreate the pre-S1 producers so this exercises a real upgrade.
      await client.query(readFileSync(new URL('../../server/migrations/0005_sessions.sql', import.meta.url), 'utf8'));
      await client.query("INSERT INTO users (id, username) VALUES ('organizer', '组织者'), ('player', '选手')");
      const session = await client.query("INSERT INTO game_sessions (organizer_id, title, starts_at) VALUES ('organizer', '历史约局', '2099-01-01T12:00:00.000Z') RETURNING id");
      sessionId = String(session.rows[0].id);
      await client.query("INSERT INTO session_players (session_id, user_id, rsvp) VALUES ($1, 'player', 'invited')", [sessionId]);
      await client.query("INSERT INTO records (subject_id, reporter_id, type, delta, status, session_id) VALUES ('player', 'organizer', 'on_time_bonus', 2, 'decided', $1)", [sessionId]);
      await client.query("INSERT INTO discord_messages (entity, entity_id, purpose, channel_id, message_id) VALUES ('session', $1, 'card', $2, $3)", [sessionId, CHANNEL, MESSAGE]);
      await client.query("SELECT outbox_emit('dm.session.starting', 'user', 'player', 'legacy-starting', '{}', now())");
      // Already processed history is retained, unlike the old pending queue.
      await client.query("INSERT INTO outbox (kind, entity, entity_id, dedupe_key, processed_at, result) VALUES ('dm.session.invited', 'user', 'player', 'old-sent', now(), 'sent')");
      await client.query(migration());
      await client.query(migration());
      const pending = await client.query("SELECT kind, entity, entity_id, payload FROM outbox WHERE processed_at IS NULL AND entity <> 'board' ORDER BY id");
      expect(pending.rows).toEqual([{ kind: 'session.removed', entity: 'session', entity_id: sessionId,
        payload: { channel_id: CHANNEL, message_id: MESSAGE } }]);
      expect((await client.query("SELECT COUNT(*)::int AS n FROM outbox WHERE dedupe_key = 'old-sent'")).rows[0].n).toBe(1);
      expect((await client.query('SELECT COUNT(*)::int AS n FROM game_sessions')).rows[0].n).toBe(1);
      expect((await client.query('SELECT COUNT(*)::int AS n FROM session_players')).rows[0].n).toBe(1);
      expect((await client.query('SELECT type, delta, session_id FROM records')).rows[0]).toMatchObject({ type: 'on_time_bonus', delta: 2 });
      expect((await client.query('SELECT session_id FROM records')).rows[0].session_id.toString()).toBe(sessionId);
      expect((await client.query("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('sessions_outbox', 'session_players_outbox', 'sessions_outbox_removed', 'session_players_knows')")).rows).toEqual([]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const api = discord();
    expect(await dispatcher(api).runOnce()).toBe(1);
    expect(api.remove).toHaveBeenCalledExactlyOnceWith(CHANNEL, MESSAGE);
    expect((await pool.query("SELECT * FROM discord_messages WHERE entity = 'session'")).rows).toEqual([]);
    expect((await pool.query("SELECT result FROM outbox WHERE kind = 'session.removed'")).rows).toEqual([{ result: 'sent' }]);
    await pool.query(migration());
    expect((await pool.query("SELECT * FROM outbox WHERE kind = 'session.removed' AND processed_at IS NULL")).rows).toEqual([]);
  });

  it('writes historical session and player rows without producing retired-session events', async () => {
    await seedUser({ id: 'organizer' });
    await seedUser({ id: 'player' });
    const session = await pool.query("INSERT INTO game_sessions (organizer_id, title, starts_at) VALUES ('organizer', '历史约局', '2099-01-01T12:00:00.000Z') RETURNING id");
    const id = session.rows[0].id;
    await pool.query("INSERT INTO session_players (session_id, user_id, rsvp) VALUES ($1, 'player', 'invited')", [id]);
    await pool.query("UPDATE game_sessions SET title = '保留历史' WHERE id = $1", [id]);
    await pool.query("UPDATE session_players SET rsvp = 'going' WHERE session_id = $1", [id]);
    await pool.query('DELETE FROM session_players WHERE session_id = $1', [id]);
    expect((await pool.query("SELECT * FROM outbox WHERE entity <> 'board'")).rows).toEqual([]);
  });
});

describe('late events from an old bot', () => {
  it.each([
    ['session.card', 'session'], ['session.starting', 'session'], ['session.future', 'session'],
    ['dm.session.invited', 'user'], ['dm.session.starting', 'user'], ['dm.session.future', 'user'],
  ])('skips %s immediately without a Discord call', async (kind, entity) => {
    await pool.query('INSERT INTO outbox (kind, entity, entity_id, dedupe_key) VALUES ($1, $2, $3, $1)', [kind, entity, '1']);
    const api = discord();
    expect(await dispatcher(api).runOnce()).toBe(1);
    expect((await pool.query('SELECT result, last_error, processed_at FROM outbox')).rows[0])
      .toMatchObject({ result: 'skipped', last_error: 'sessions are off', processed_at: expect.any(Date) });
    for (const call of Object.values(api)) expect(call).not.toHaveBeenCalled();
  });
});
