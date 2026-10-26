// P8: an admin's direct score change, told to the player by DM (0006_p8.sql,
// score-delivery.ts). Only real admin corrections notify.

import { describe, expect, it } from 'vitest';
import { adminUpdateUser, weeklyHeal } from '../../worker/db';
import { fileCase, submitStatement } from '../../worker/cases';
import { importD1 } from '../../server/src/import-d1';
import { linkAccounts } from '../../server/src/discord/links';
import { createDispatcher, DM_BUDGET, type ChannelApi } from '../../server/src/outbox/dispatcher';
import type { ChannelMessage } from '../../server/src/discord/verdict';
import { noAiEnv, OFFSET_HOURS, seedUser } from '../worker/helpers';
import { env, pool } from './cloudflare-test';

const FRONTEND = 'https://score.example';
const PLAYER_DC = { id: '420000000000000001', username: 'player_dc' };
const quiet = { log: () => undefined, warn: () => undefined, error: () => undefined };
const text = (m: unknown) => JSON.stringify(m);

function fakeDiscord() {
  const sent: Array<{ channelId: string; message: ChannelMessage }> = [];
  const api: ChannelApi = {
    async send(channelId, message) {
      sent.push({ channelId, message });
      return { id: `95000000000000${String(sent.length).padStart(4, '0')}` };
    },
    async edit() {},
    async remove() {},
    async openDm(id) {
      return `dm-${id}`;
    },
  };
  return { api, sent };
}

const dispatcher = (api: ChannelApi) =>
  createDispatcher({ pool, db: env.DB, api, config: { verdictChannelId: null, frontendUrl: FRONTEND }, log: quiet });

async function player(score = 70): Promise<void> {
  await seedUser({ id: 'p', username: '选手', score });
  await linkAccounts(env.DB, { userId: 'p', discordUserId: PLAYER_DC.id, discordUsername: PLAYER_DC.username, replace: false, via: 'web' });
}

async function scoreEvents() {
  return (await pool.query("SELECT kind, entity_id, dedupe_key, result, last_error FROM outbox WHERE kind = 'dm.score.adjusted' ORDER BY id")).rows;
}

describe('a score set by an admin', () => {
  it('tells the player what it was and what it is now', async () => {
    await player(70);
    await adminUpdateUser(env.DB, 'p', { score: 85 });
    const [event] = await scoreEvents();
    expect(event).toMatchObject({ entity_id: 'p', dedupe_key: expect.stringMatching(/^dm:score:\d+$/) });
    const discord = fakeDiscord();
    await dispatcher(discord.api).runOnce();
    expect(discord.sent).toHaveLength(1);
    const dm = discord.sent[0];
    expect(dm.channelId).toBe(`dm-${PLAYER_DC.id}`);
    expect(text(dm.message)).toContain('70 → 85');
    expect(text(dm.message)).toContain('+15');
    expect(dm.message.allowed_mentions).toEqual({ parse: [] });
  });

  it('says what was actually applied when it was clamped', async () => {
    await player(90);
    await adminUpdateUser(env.DB, 'p', { score: 150 });
    const discord = fakeDiscord();
    await dispatcher(discord.api).runOnce();
    expect(text(discord.sent[0].message)).toContain('90 → 100');
  });

  it('is not news when nothing changed, or for anything but an admin’s correction', async () => {
    await player(70);
    await seedUser({ id: 'judge', judge: true });
    await adminUpdateUser(env.DB, 'p', { score: 70 });
    await adminUpdateUser(env.DB, 'p', { is_judge: true });
    await weeklyHeal(env.DB, OFFSET_HOURS);
    const judge = { id: 'judge', username: 'judge', oauth_username: 'judge', avatar_url: null, is_participant: true, is_judge: true, is_admin: false, score: 100, created_at: 'x' };
    const filed = await fileCase(env.DB, judge, { subject_id: 'p', type: 'no_show', claim: '说好八点五排结果没来' }, { offsetHours: OFFSET_HOURS, skipRateLimit: true }, noAiEnv());
    await submitStatement(env.DB, { ...judge, id: 'p', is_judge: false }, filed.id, '临时加班实在走不开', noAiEnv());
    expect(await scoreEvents()).toEqual([]);
  });

  it('is an outcome: sent however many reminders went out today', async () => {
    await player(70);
    await pool.query(
      `INSERT INTO outbox (kind, entity, entity_id, dedupe_key, payload, processed_at, result)
       SELECT 'dm.filed', 'user', 'p', 'filler:' || g, '{}', now(), 'sent' FROM generate_series(1, $1::int) g`,
      [DM_BUDGET],
    );
    await adminUpdateUser(env.DB, 'p', { score: 60 });
    const discord = fakeDiscord();
    await dispatcher(discord.api).runOnce();
    expect(discord.sent).toHaveLength(1);
  });

  it('is not sent to the unbound, to /notify off, a day late, or for a deleted player', async () => {
    const discord = fakeDiscord();
    const d = dispatcher(discord.api);
    await seedUser({ id: 'u', score: 70 });
    await adminUpdateUser(env.DB, 'u', { score: 60 });
    await d.runOnce();
    await player(70);
    await pool.query("UPDATE discord_links SET notify_dm = 0 WHERE user_id = 'p'");
    await adminUpdateUser(env.DB, 'p', { score: 60 });
    await d.runOnce();
    await pool.query("UPDATE discord_links SET notify_dm = 1 WHERE user_id = 'p'");
    await adminUpdateUser(env.DB, 'p', { score: 50 });
    await pool.query("UPDATE outbox SET created_at = now() - interval '25 hours' WHERE kind = 'dm.score.adjusted' AND processed_at IS NULL");
    await d.runOnce();
    await adminUpdateUser(env.DB, 'p', { score: 40 });
    await adminUpdateUser(env.DB, 'p', { delete: true });
    await d.runOnce();
    expect(discord.sent).toEqual([]);
    expect((await scoreEvents()).map((e) => e.last_error)).toEqual([
      'recipient has no Discord binding',
      'recipient turned DMs off (/notify)',
      'stale: older than 24 h',
      'recipient has no Discord binding',
    ]);
  });

  it('the D1 import emits nothing', async () => {
    const T = '2026-10-20 12:00:00';
    await importD1(pool, {
      users: [{ id: 'o', username: 'o', is_participant: 1, is_judge: 0, is_admin: 0, score: 60, created_at: T, updated_at: T }],
      score_events: [{ id: 1, user_id: 'o', delta: -40, reason: 'admin_adjust', resulting_score: 60, created_at: T }],
    });
    expect(await scoreEvents()).toEqual([]);
  });
});
