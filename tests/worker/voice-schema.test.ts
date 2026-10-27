import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { seedUser } from './helpers';
const JOINED = '2026-10-27 10:00:00';
const add = (discord = 'voice-account', left: string | null = null, end: string | null = null) => env.DB.prepare(
  `INSERT INTO voice_sessions (user_id, discord_user_id, channel_id, channel_name, joined_at, left_at, start_reason, end_reason)
   VALUES ('voice-owner', ?, 'private-channel', '开黑一号', ?, ?, 'joined', ?)`,
).bind(discord, JOINED, left, end).run();

describe('voice schema parity', () => {
  it('stores UTC text and permits only one open segment per Discord account', async () => {
    await seedUser({ id: 'voice-owner' }); await add();
    await expect(add()).rejects.toThrow();
    await env.DB.prepare("UPDATE voice_sessions SET left_at = ?, end_reason = 'left'").bind(JOINED).run();
    await add();
    expect((await env.DB.prepare('SELECT joined_at, left_at, start_reason, end_reason FROM voice_sessions ORDER BY id').all()).results)
      .toEqual([{ joined_at: JOINED, left_at: JOINED, start_reason: 'joined', end_reason: 'left' },
        { joined_at: JOINED, left_at: null, start_reason: 'joined', end_reason: null }]);
  });
  it.each([[null, 'left'], [JOINED, null], ['2026-10-27 09:59:59', 'left']])('rejects inconsistent or negative end: %s / %s', async (left, end) => {
    await seedUser({ id: 'voice-owner' }); await expect(add('voice-account', left, end)).rejects.toThrow();
  });
  it('requires explicit times and valid reason values', async () => {
    await seedUser({ id: 'voice-owner' });
    await expect(env.DB.prepare("INSERT INTO voice_sessions (user_id, discord_user_id, channel_id, channel_name, start_reason) VALUES ('voice-owner', 'd', 'c', '频道', 'joined')").run()).rejects.toThrow();
    await expect(env.DB.prepare("INSERT INTO voice_coverage (started_at) VALUES (?)").bind(JOINED).run()).rejects.toThrow();
    await expect(env.DB.prepare("INSERT INTO voice_sessions (user_id, discord_user_id, channel_id, channel_name, joined_at, start_reason) VALUES ('voice-owner', 'd', 'c', '频道', ?, 'invalid')").bind(JOINED).run()).rejects.toThrow();
    await expect(env.DB.prepare('INSERT INTO voice_coverage (started_at, last_seen_at) VALUES (?, ?)').bind(JOINED, '2026-10-27 09:59:59').run()).rejects.toThrow();
  });
  it('cascades deleted users without deleting independent coverage', async () => {
    await seedUser({ id: 'voice-owner' }); await add();
    await env.DB.prepare('INSERT INTO voice_coverage (started_at, last_seen_at) VALUES (?, ?)').bind(JOINED, JOINED).run();
    await env.DB.prepare("DELETE FROM users WHERE id = 'voice-owner'").run();
    expect((await env.DB.prepare('SELECT * FROM voice_sessions').all()).results).toEqual([]);
    expect((await env.DB.prepare('SELECT started_at, last_seen_at FROM voice_coverage').all()).results).toEqual([{ started_at: JOINED, last_seen_at: JOINED }]);
  });
});
