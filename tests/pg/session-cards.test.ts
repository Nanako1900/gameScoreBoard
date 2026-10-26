// P7: game sessions in Discord — the events (0005_sessions.sql), the card in
// the session channel and the session DMs (dispatcher.ts), the RSVP buttons
// and /yue (discord/sessions.ts). Discord is a fake ChannelApi.

import { describe, expect, it } from 'vitest';
import { cancelSession, createSession, rollCall, setRsvp, settleSession, updateSession } from '../../worker/sessions';
import { adminUpdateUser } from '../../worker/db';
import { noAiEnv } from '../worker/helpers';
import { importD1 } from '../../server/src/import-d1';
import { linkAccounts } from '../../server/src/discord/links';
import { handleCommand } from '../../server/src/discord/commands';
import { handleRsvpButton } from '../../server/src/discord/sessions';
import { createDispatcher, SESSION_DM_BUDGET, type ChannelApi } from '../../server/src/outbox/dispatcher';
import type { ChannelMessage } from '../../server/src/discord/verdict';
import type { User } from '../../worker/types';
import { OFFSET_HOURS, seedUser } from '../worker/helpers';
import { env, pool } from './cloudflare-test';

const CARDS = '500000000000000001';
const FRONTEND = 'https://score.example';
const ctx = { db: env.DB, appUrl: 'https://api.example', frontendUrl: FRONTEND, offsetHours: OFFSET_HOURS };
const dc = (n: number) => ({ id: `60000000000000000${n}`, username: `dc${n}` });
const IN_2H = () => new Date(Date.now() + 2 * 3_600_000).toISOString();
const IN_3H = () => new Date(Date.now() + 3 * 3_600_000).toISOString();

interface Event {
  kind: string;
  entity: string;
  entity_id: string;
  result: string | null;
}

async function events(): Promise<Event[]> {
  return (await pool.query<Event>('SELECT kind, entity, entity_id, result FROM outbox ORDER BY id')).rows;
}

function fakeDiscord() {
  const sent: Array<{ channelId: string; message: ChannelMessage }> = [];
  const edits: Array<{ channelId: string; messageId: string; message: ChannelMessage }> = [];
  let next = 0;
  const removed: string[] = [];
  const api: ChannelApi = {
    async send(channelId, message) {
      sent.push({ channelId, message });
      next += 1;
      return { id: `91000000000000${String(next).padStart(4, '0')}` };
    },
    async edit(channelId, messageId, message) {
      edits.push({ channelId, messageId, message });
    },
    async remove(_channelId, messageId) {
      removed.push(messageId);
    },
    async openDm(id) {
      return `dm-${id}`;
    },
  };
  return { api, sent, edits, removed };
}

const quiet = { log: () => undefined, warn: () => undefined, error: () => undefined };

function dispatcher(api: ChannelApi, sessionChannelId: string | null = CARDS) {
  return createDispatcher({
    pool,
    db: env.DB,
    api,
    config: { verdictChannelId: null, sessionChannelId, frontendUrl: FRONTEND },
    log: quiet,
  });
}

const text = (m: ChannelMessage) => JSON.stringify(m);

async function bind(userId: string, n: number): Promise<void> {
  const who = dc(n);
  await linkAccounts(env.DB, { userId, discordUserId: who.id, discordUsername: who.username, replace: false, via: 'web' });
}

async function cast(): Promise<{ org: User; a: User; b: User }> {
  const org = await seedUser({ id: 'org', username: '组织者' });
  const a = await seedUser({ id: 'a', username: '阿一' });
  const b = await seedUser({ id: 'b', username: '阿二' });
  await bind('org', 1);
  await bind('a', 2);
  await bind('b', 3);
  return { org, a, b };
}

describe('session events', () => {
  it('a new session: a card, an invitation per invitee, and the two reminders', async () => {
    const { org } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H(), duration_min: 90, invite: ['a'] }, OFFSET_HOURS);
    const rows = (
      await pool.query(
        `SELECT kind, entity, entity_id,
                round(extract(epoch FROM available_at - ($1::timestamptz)) / 60) AS from_start
           FROM outbox ORDER BY id`,
        [session.starts_at],
      )
    ).rows;
    const byKind = Object.fromEntries(rows.map((r) => [r.kind, r]));
    expect(byKind['session.card']).toMatchObject({ entity: 'session', entity_id: String(session.id) });
    expect(byKind['dm.session.invited']).toMatchObject({ entity: 'user', entity_id: 'a' });
    expect(byKind['session.starting'].from_start).toBe(-15);
    expect(byKind['dm.session.rollcall']).toMatchObject({ entity_id: 'org', from_start: 90 });
  });

  it('an RSVP refreshes the card; the seat lock alone does not', async () => {
    const { org, a } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H() }, OFFSET_HOURS);
    await pool.query('DELETE FROM outbox');
    await env.DB.prepare('UPDATE game_sessions SET status = status WHERE id = ?').bind(session.id).run();
    expect(await events()).toEqual([]);
    await setRsvp(env.DB, a, session.id, 'going');
    expect((await events()).map((e) => e.kind)).toEqual(['session.card']);
  });

  it('a new time tells those who answered and moves the reminders; a cancel tells those coming', async () => {
    const { org, a, b } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H() }, OFFSET_HOURS);
    await setRsvp(env.DB, a, session.id, 'going');
    await setRsvp(env.DB, b, session.id, 'out');
    await pool.query('DELETE FROM outbox');
    const later = IN_3H();
    await updateSession(env.DB, org, session.id, { starts_at: later });
    const moved = await events();
    expect(moved.filter((e) => e.kind === 'dm.session.changed').map((e) => e.entity_id)).toEqual(['a']);
    const starting = (
      await pool.query(
        "SELECT round(extract(epoch FROM available_at - $1::timestamptz) / 60) AS m FROM outbox WHERE kind = 'session.starting'",
        [later],
      )
    ).rows;
    expect(starting).toEqual([{ m: -15 }]);

    await pool.query('DELETE FROM outbox');
    await cancelSession(env.DB, org, session.id);
    const cancelled = await events();
    expect(cancelled.filter((e) => e.kind === 'dm.session.cancelled').map((e) => e.entity_id)).toEqual(['a']);
    expect(cancelled.some((e) => e.kind === 'session.card')).toBe(true);
  });

  it('the D1 import emits nothing for sessions either', async () => {
    const T = '2026-10-20 12:00:00';
    await importD1(pool, {
      users: [{ id: 'o', username: 'o', is_participant: 1, is_judge: 0, is_admin: 0, score: 100, created_at: T, updated_at: T }],
      game_sessions: [{ id: 1, organizer_id: 'o', title: '开黑', starts_at: '2099-01-01T12:00:00.000Z', status: 'open', created_at: T }],
      session_players: [{ session_id: 1, user_id: 'o', rsvp: 'going', rsvp_at: T }],
    });
    expect(await events()).toEqual([]);
  });
});

describe('the session card', () => {
  it('is posted with RSVP buttons, and edited as people answer', async () => {
    const { org, a } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H(), capacity: 4 }, OFFSET_HOURS);
    const discord = fakeDiscord();
    const d = dispatcher(discord.api);
    await d.runOnce();
    expect(discord.sent.filter((s) => s.channelId === CARDS)).toHaveLength(1);
    const card = discord.sent.find((s) => s.channelId === CARDS)!.message;
    expect(text(card)).toContain(`v1:rsvp:${session.id}:going`);
    expect(text(card)).toContain('1/4 人');
    expect(card.allowed_mentions).toEqual({ parse: [] });

    // Creating it was two transactions (session, then its players): one post, then edits.
    const before = discord.edits.length;
    await setRsvp(env.DB, a, session.id, 'going');
    await d.runOnce();
    expect(discord.edits).toHaveLength(before + 1);
    const latest = discord.edits[discord.edits.length - 1].message;
    expect(text(latest)).toContain('2/4 人');
    expect(text(latest)).toContain('阿一');
    expect(discord.sent.filter((s) => s.channelId === CARDS)).toHaveLength(1);
  });

  it('loses its buttons once the session is cancelled', async () => {
    const { org } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H() }, OFFSET_HOURS);
    const discord = fakeDiscord();
    const d = dispatcher(discord.api);
    await d.runOnce();
    await cancelSession(env.DB, org, session.id);
    await d.runOnce();
    const last = discord.edits[discord.edits.length - 1].message;
    expect(last.components).toEqual([]);
    expect(text(last)).toContain('已取消');
  });

  it('is not posted without a session channel', async () => {
    const { org } = await cast();
    await createSession(env.DB, org, { starts_at: IN_2H() }, OFFSET_HOURS);
    const discord = fakeDiscord();
    await dispatcher(discord.api, null).runOnce();
    expect(discord.sent.filter((s) => s.channelId === CARDS)).toEqual([]);
  });
});

describe('session DMs', () => {
  it('invites with RSVP buttons, reminds those going 15 minutes before, and asks the organizer to roll-call', async () => {
    const { org, a, b } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H(), invite: ['a', 'b'] }, OFFSET_HOURS);
    const discord = fakeDiscord();
    const d = dispatcher(discord.api, null);
    await d.runOnce();
    const invites = discord.sent.filter((s) => text(s.message).includes('约你'));
    expect(invites.map((s) => s.channelId).sort()).toEqual([`dm-${dc(2).id}`, `dm-${dc(3).id}`]);
    expect(text(invites[0].message)).toContain(`v1:rsvp:${session.id}:going`);

    await setRsvp(env.DB, a, session.id, 'going');
    await setRsvp(env.DB, b, session.id, 'out');
    // It is 15 minutes before the start.
    await pool.query("UPDATE outbox SET available_at = now() WHERE kind IN ('session.starting', 'dm.session.rollcall')");
    await d.runOnce(); // the fan-out
    await d.runOnce(); // its DMs
    // Those going — the organizer included — but not b, who said no.
    const starting = discord.sent.filter((s) => text(s.message).includes('15 分钟后开局'));
    expect(starting.map((s) => s.channelId).sort()).toEqual([`dm-${dc(1).id}`, `dm-${dc(2).id}`]);
    const rollcall = discord.sent.filter((s) => text(s.message).includes('该点名了'));
    expect(rollcall.map((s) => s.channelId)).toEqual([`dm-${dc(1).id}`]);
  });

  it('an answered invitation is not sent any more', async () => {
    const { org, a } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H(), invite: ['a'] }, OFFSET_HOURS);
    await setRsvp(env.DB, a, session.id, 'maybe');
    const discord = fakeDiscord();
    await dispatcher(discord.api, null).runOnce();
    expect(discord.sent.filter((s) => text(s.message).includes('约你'))).toEqual([]);
  });

  it('tells whoever was coming that it is off', async () => {
    const { org, a } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H() }, OFFSET_HOURS);
    await setRsvp(env.DB, a, session.id, 'going');
    await cancelSession(env.DB, org, session.id);
    const discord = fakeDiscord();
    await dispatcher(discord.api, null).runOnce();
    const off = discord.sent.filter((s) => text(s.message).includes('约局取消了'));
    expect(off.map((s) => s.channelId)).toEqual([`dm-${dc(2).id}`]);
  });
});

describe('RSVP buttons and /yue', () => {
  it('answers the session through the same rules as the web', async () => {
    const { org } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H(), capacity: 2 }, OFFSET_HOURS);
    const ok = await handleRsvpButton(session.id, 'going', dc(2), ctx);
    expect(ok).toMatchObject({ ephemeral: true, content: expect.stringContaining('2/2') });
    const full = await handleRsvpButton(session.id, 'going', dc(3), ctx);
    expect(full.content).toContain('人数已满');
    expect((await handleRsvpButton(session.id, 'going', dc(9), ctx)).content).toContain('/link');
    expect((await handleRsvpButton(session.id, 'going', dc(2), { ...ctx, readOnly: true })).content).toContain('只读');
  });

  it('/yue proposes a session at the chosen board-local time', async () => {
    await cast();
    const reply = await handleCommand({ commandName: 'yue', caller: dc(1), targetUser: null, when: 'dayafter20', capacity: 5 }, ctx);
    expect(reply.ephemeral).toBe(true);
    const row = await env.DB.prepare("SELECT organizer_id, starts_at, capacity FROM game_sessions WHERE organizer_id = 'org'").first<{
      organizer_id: string;
      starts_at: string;
      capacity: number;
    }>();
    expect(row?.capacity).toBe(5);
    // 20:00 at UTC+8 is 12:00 UTC.
    expect(row?.starts_at).toMatch(/T12:00:00\.000Z$/);
    expect(Date.parse(row!.starts_at) - Date.now()).toBeGreaterThan(24 * 3_600_000);
  });

  it('/yue is for bound players only', async () => {
    await seedUser({ id: 'viewer', participant: false });
    await bind('viewer', 5);
    expect((await handleCommand({ commandName: 'yue', caller: dc(5), targetUser: null, when: 'dayafter20' }, ctx)).content).toContain(
      '上榜选手',
    );
    expect((await handleCommand({ commandName: 'yue', caller: dc(8), targetUser: null, when: 'dayafter20' }, ctx)).content).toContain(
      '/link',
    );
  });
});

describe('timed session events, moved and re-armed', () => {
  async function scheduled(kind: string) {
    return (
      await pool.query(
        `SELECT processed_at, result, round(extract(epoch FROM available_at - now()) / 60) AS in_minutes
           FROM outbox WHERE kind = $1 ORDER BY id`,
        [kind],
      )
    ).rows;
  }

  it('moving a session re-arms the reminder already sent, and the roll call moves with it', async () => {
    const { org, a } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H(), duration_min: 60 }, OFFSET_HOURS);
    await setRsvp(env.DB, a, session.id, 'going');
    const discord = fakeDiscord();
    const d = dispatcher(discord.api, null);
    await pool.query("UPDATE outbox SET available_at = now() WHERE kind = 'session.starting'");
    await d.runOnce();
    await d.runOnce();
    const reminders = () => discord.sent.filter((m) => text(m.message).includes('15 分钟后开局')).length;
    expect(reminders()).toBe(2); // org + a

    await updateSession(env.DB, org, session.id, { starts_at: IN_3H() });
    const [starting] = await scheduled('session.starting');
    expect(starting).toMatchObject({ processed_at: null, in_minutes: 165 });
    expect((await scheduled('dm.session.rollcall'))[0]).toMatchObject({ processed_at: null, in_minutes: 240 });
    // When it comes round again, everyone going hears about it again — once.
    await pool.query("UPDATE outbox SET available_at = now() WHERE kind = 'session.starting'");
    await d.runOnce();
    await d.runOnce();
    await d.runOnce();
    expect(reminders()).toBe(4);
  });

  it('a new length moves the roll-call reminder', async () => {
    const { org } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H(), duration_min: 60 }, OFFSET_HOURS);
    await updateSession(env.DB, org, session.id, { duration_min: 240 });
    expect((await scheduled('dm.session.rollcall'))[0]).toMatchObject({ in_minutes: 360 });
  });

  it('moved to start within 15 minutes: the stale reminder is dropped, not sent at the wrong time', async () => {
    const { org } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H() }, OFFSET_HOURS);
    await updateSession(env.DB, org, session.id, { starts_at: new Date(Date.now() + 10 * 60_000).toISOString() });
    expect((await scheduled('session.starting'))[0]).toMatchObject({ result: 'skipped' });
  });

  it('the card loses its buttons by itself when the session starts', async () => {
    const { org } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H() }, OFFSET_HOURS);
    const discord = fakeDiscord();
    const d = dispatcher(discord.api);
    await d.runOnce();
    expect(discord.sent[0].message.components).not.toEqual([]);
    // It is now the start time.
    await env.DB.prepare('UPDATE game_sessions SET starts_at = ? WHERE id = ?')
      .bind(new Date(Date.now() - 60_000).toISOString(), session.id)
      .run();
    await pool.query("UPDATE outbox SET available_at = now() WHERE dedupe_key LIKE '%:card:start'");
    await d.runOnce();
    const last = discord.edits[discord.edits.length - 1].message;
    expect(last.components).toEqual([]);
    expect(text(last)).toContain('已开局');
  });

  it('a settled session shows as over, without buttons', async () => {
    const { org, a } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H() }, OFFSET_HOURS);
    await setRsvp(env.DB, a, session.id, 'going');
    const discord = fakeDiscord();
    const d = dispatcher(discord.api);
    await d.runOnce();
    await env.DB.prepare('UPDATE game_sessions SET starts_at = ? WHERE id = ?')
      .bind(new Date(Date.now() - 3_600_000).toISOString(), session.id)
      .run();
    await rollCall(env.DB, org, session.id, [{ user_id: 'a', attendance: 'on_time' }, { user_id: 'org', attendance: 'on_time' }], OFFSET_HOURS);
    await settleSession(env.DB, org, session.id, [], true, noAiEnv(), OFFSET_HOURS);
    await d.runOnce();
    const last = discord.edits[discord.edits.length - 1].message;
    expect(text(last)).toContain('已结束');
    expect(last.components).toEqual([]);
  });

  it('a changed answer (maybe → going) refreshes the card once', async () => {
    const { org, a } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H() }, OFFSET_HOURS);
    await setRsvp(env.DB, a, session.id, 'maybe');
    await pool.query('DELETE FROM outbox');
    await setRsvp(env.DB, a, session.id, 'going');
    expect((await events()).map((e) => e.kind)).toEqual(['session.card']);
  });

  it('deleting the organizer takes the card down', async () => {
    const { org } = await cast();
    await createSession(env.DB, org, { starts_at: IN_2H() }, OFFSET_HOURS);
    const discord = fakeDiscord();
    const d = dispatcher(discord.api);
    await d.runOnce();
    await adminUpdateUser(env.DB, 'org', { delete: true });
    await d.runOnce();
    expect(discord.removed).toEqual(['910000000000000001']);
    expect((await pool.query("SELECT 1 FROM discord_messages WHERE entity = 'session'")).rowCount).toBe(0);
  });

  it('nobody gets the 15-minute DM twice, and a maybe gets none', async () => {
    const { org, a, b } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H() }, OFFSET_HOURS);
    await setRsvp(env.DB, a, session.id, 'going');
    await setRsvp(env.DB, b, session.id, 'maybe');
    const discord = fakeDiscord();
    const d = dispatcher(discord.api, null);
    await pool.query("UPDATE outbox SET available_at = now() WHERE kind = 'session.starting'");
    for (let i = 0; i < 3; i += 1) await d.runOnce();
    // A second fan-out of the same start time adds nothing.
    await pool.query("UPDATE outbox SET processed_at = NULL, result = NULL, available_at = now() WHERE kind = 'session.starting'");
    for (let i = 0; i < 2; i += 1) await d.runOnce();
    const to = discord.sent.filter((m) => text(m.message).includes('15 分钟后开局')).map((m) => m.channelId).sort();
    expect(to).toEqual([`dm-${dc(1).id}`, `dm-${dc(2).id}`]);
  });

  it(`session DMs have their own daily allowance (${SESSION_DM_BUDGET}) and never use up a case's`, async () => {
    await cast();
    // Organizers can each run 5 sessions at once: enough of them to flood one invitee.
    const organizers = 3;
    for (let o = 0; o < organizers; o += 1) {
      const organizer = await seedUser({ id: `o${o}` });
      for (let i = 0; i < 5; i += 1) {
        await createSession(env.DB, organizer, { starts_at: IN_2H(), invite: ['a'] }, OFFSET_HOURS);
      }
    }
    const judge = await seedUser({ id: 'judge', judge: true });
    const { fileCase } = await import('../../worker/cases');
    await fileCase(env.DB, judge, { subject_id: 'a', type: 'afk', claim: '说好八点开黑结果没来也没说一声' }, { offsetHours: OFFSET_HOURS, skipRateLimit: true }, noAiEnv());
    await pool.query("UPDATE outbox SET available_at = now() WHERE kind IN ('dm.filed', 'dm.deadline')");
    const discord = fakeDiscord();
    await dispatcher(discord.api, null).runOnce();
    const toA = discord.sent.filter((m) => m.channelId === `dm-${dc(2).id}`).map((m) => text(m.message));
    expect(toA.filter((t) => t.includes('约你'))).toHaveLength(SESSION_DM_BUDGET);
    expect(toA.some((t) => t.includes('有人给你立案了'))).toBe(true);
  });
});

describe('/yue, more', () => {
  it('refuses a slot that has already passed today', async () => {
    await cast();
    // Pick the board offset at which it is now 23:xx locally: tonight 20:00 is gone.
    const utcHour = new Date().getUTCHours();
    const offsetHours = (23 - utcHour + 24) % 24;
    const reply = await handleCommand(
      { commandName: 'yue', caller: dc(1), targetUser: null, when: 'tonight20' },
      { ...ctx, offsetHours },
    );
    expect(reply.content).toContain('已经过了');
    expect((await pool.query('SELECT 1 FROM game_sessions')).rowCount).toBe(0);
  });

  it('says where the card goes only when there is a session channel', async () => {
    await cast();
    const without = await handleCommand({ commandName: 'yue', caller: dc(1), targetUser: null, when: 'dayafter20' }, ctx);
    expect(without.content).toContain('网页');
    const withCards = await handleCommand(
      { commandName: 'yue', caller: dc(1), targetUser: null, when: 'tomorrow20' },
      { ...ctx, sessionCards: true },
    );
    expect(withCards.content).toContain('约局频道');
  });
});
