// P7: game sessions in Discord — the events (0005_sessions.sql), the card in
// the session channel and the session DMs (dispatcher.ts), the RSVP buttons
// and /yue (discord/sessions.ts). Discord is a fake ChannelApi.

import { describe, expect, it } from 'vitest';
import { cancelSession, createSession, rollCall, setRsvp, settleSession, updateSession } from '../../worker/sessions';
import { inviteToSession } from '../../worker/session-invites';
import { INVITES_PER_ORGANIZER as SHARED_INVITES_PER_ORGANIZER } from '../../shared/attendance';
import { adminUpdateUser } from '../../worker/db';
import { noAiEnv } from '../worker/helpers';
import { importD1 } from '../../server/src/import-d1';
import { linkAccounts } from '../../server/src/discord/links';
import { handleCommand } from '../../server/src/discord/commands';
import { handleRsvpButton } from '../../server/src/discord/sessions';
import { createDispatcher, INVITES_PER_ORGANIZER, SESSION_DM_BUDGET, type ChannelApi } from '../../server/src/outbox/dispatcher';
import type { ChannelMessage } from '../../server/src/discord/verdict';
import type { User } from '../../worker/types';
import { OFFSET_HOURS, seedUser } from '../worker/helpers';
import { env, pool } from './cloudflare-test';

const CARDS = '500000000000000001';
const OTHER_CARDS = '500000000000000002';
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

/** An error as discord.js reports an HTTP status. */
function httpError(status: number): Error {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

interface FakeHooks {
  /** Throw here to make a send fail. */
  send?: (channelId: string) => void;
  openDm?: (discordUserId: string) => void;
  /** Throw here to make a removal fail. */
  remove?: (channelId: string) => void;
  /** Like Discord: a repeated nonce returns the first message instead of a new one. */
  dedupeNonces?: boolean;
  /** The first send reaches Discord, but its answer is lost (a timeout). */
  loseFirstAnswer?: boolean;
}

function fakeDiscord(hooks: FakeHooks = {}) {
  const sent: Array<{ channelId: string; message: ChannelMessage }> = [];
  const edits: Array<{ channelId: string; messageId: string; message: ChannelMessage }> = [];
  let next = 0;
  const removed: string[] = [];
  const byNonce = new Map<string, string>();
  let lose = hooks.loseFirstAnswer === true;
  const api: ChannelApi = {
    async send(channelId, message) {
      hooks.send?.(channelId);
      const earlier = hooks.dedupeNonces ? byNonce.get(message.nonce) : undefined;
      if (earlier) return { id: earlier };
      sent.push({ channelId, message });
      next += 1;
      const id = `91000000000000${String(next).padStart(4, '0')}`;
      byNonce.set(message.nonce, id);
      if (lose) {
        lose = false;
        throw httpError(504);
      }
      return { id };
    },
    async edit(channelId, messageId, message) {
      edits.push({ channelId, messageId, message });
    },
    async remove(channelId, messageId) {
      hooks.remove?.(channelId);
      removed.push(messageId);
    },
    async openDm(id) {
      hooks.openDm?.(id);
      return `dm-${id}`;
    },
  };
  return { api, sent, edits, removed };
}

const quiet = { log: () => undefined, warn: () => undefined, error: () => undefined };

function rawDispatcher(api: ChannelApi, sessionChannelId: string | null = CARDS) {
  return createDispatcher({
    pool,
    db: env.DB,
    api,
    config: { verdictChannelId: null, sessionChannelId, frontendUrl: FRONTEND },
    log: quiet,
  });
}

/** Coalesced events wait a moment (card refresh 2 s, "the time changed" 3 min): let it pass. */
async function coalescedDue(): Promise<void> {
  await pool.query(
    "UPDATE outbox SET available_at = now() WHERE processed_at IS NULL AND (dedupe_key LIKE 'session:%:card' OR kind = 'dm.session.changed')",
  );
}

/** A dispatcher whose every run comes after the coalescing delays. */
function dispatcher(api: ChannelApi, sessionChannelId: string | null = CARDS) {
  const d = rawDispatcher(api, sessionChannelId);
  return {
    ...d,
    async runOnce() {
      await coalescedDue();
      return d.runOnce();
    },
  };
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
    // Everyone in it, the one who said no included: all of them answer again.
    expect(moved.filter((e) => e.kind === 'dm.session.changed').map((e) => e.entity_id).sort()).toEqual(['a', 'b']);
    const starting = (
      await pool.query(
        "SELECT round(extract(epoch FROM available_at - $1::timestamptz) / 60) AS m FROM outbox WHERE kind = 'session.starting'",
        [later],
      )
    ).rows;
    expect(starting).toEqual([{ m: -15 }]);

    // The move put a and b back to 'invited' (an answer to one time is not an
    // answer to another); told of the new time, a cancel reaches them too.
    expect((await env.DB.prepare("SELECT rsvp FROM session_players WHERE user_id = 'a'").first<{ rsvp: string }>())?.rsvp).toBe('invited');
    await dispatcher(fakeDiscord().api, null).runOnce();
    await cancelSession(env.DB, org, session.id);
    const cancelled = await events();
    expect(cancelled.filter((e) => e.kind === 'dm.session.cancelled').map((e) => e.entity_id).sort()).toEqual(['a', 'b']);
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
    const at = session.starts_at;
    const ok = await handleRsvpButton(session.id, 'going', at, dc(2), ctx);
    expect(ok).toMatchObject({ ephemeral: true, content: expect.stringContaining('2/2') });
    const full = await handleRsvpButton(session.id, 'going', at, dc(3), ctx);
    expect(full.content).toContain('人数已满');
    expect((await handleRsvpButton(session.id, 'going', at, dc(9), ctx)).content).toContain('/link');
    expect((await handleRsvpButton(session.id, 'going', at, dc(2), { ...ctx, readOnly: true })).content).toContain('只读');
  });

  it('a button made for the old time (an invitation DM, after a move) signs nobody up', async () => {
    const { org } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H(), invite: ['a'] }, OFFSET_HOURS);
    await updateSession(env.DB, org, session.id, { starts_at: IN_3H() });
    const reply = await handleRsvpButton(session.id, 'going', session.starts_at, dc(2), ctx);
    expect(reply.content).toContain('改时间了');
    expect(reply.content).toMatch(/<t:\d+:F>/);
    // It points where the new time can be answered: the web — and the card, if there is one.
    expect(reply.content).not.toContain('约局频道');
    expect(reply.buttons?.[0]?.url).toContain(FRONTEND);
    const withCards = await handleRsvpButton(session.id, 'maybe', session.starts_at, dc(2), { ...ctx, sessionCards: true });
    expect(withCards.content).toContain('约局频道');
    expect((await env.DB.prepare("SELECT rsvp FROM session_players WHERE user_id = 'a'").first<{ rsvp: string }>())?.rsvp).toBe(
      'invited',
    );
    // Nor does a no to the old time stand for the new one.
    const no = await handleRsvpButton(session.id, 'out', session.starts_at, dc(2), ctx);
    expect(no.content).toContain('改时间了');
    // With the new time, either answer goes through.
    const moved = await env.DB.prepare('SELECT starts_at FROM game_sessions WHERE id = ?').bind(session.id).first<{ starts_at: string }>();
    expect((await handleRsvpButton(session.id, 'out', moved!.starts_at, dc(2), ctx)).content).toContain('不来');
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

  // P2-4 (spec §11 #7): the bot follows the web, where anyone signed in may organise.
  it('/yue is for anyone bound — on the board or not', async () => {
    await seedUser({ id: 'viewer', participant: false });
    await bind('viewer', 5);
    const reply = await handleCommand({ commandName: 'yue', caller: dc(5), targetUser: null, when: 'dayafter20' }, ctx);
    expect(reply.content).toContain('已发起约局');
    expect(reply.content).not.toContain('上榜选手');
    const rows = await pool.query<{ organizer_id: string }>('SELECT organizer_id FROM game_sessions');
    expect(rows.rows.map((r) => r.organizer_id)).toEqual(['viewer']);
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
           FROM outbox WHERE kind = $1 ORDER BY id DESC`, // the current one first (a sent one stays as history)
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
    // The move asked a to answer again; a says yes again.
    await setRsvp(env.DB, a, session.id, 'going');
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

  it('a new length leaves a start reminder that is already due alone', async () => {
    const { org } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H() }, OFFSET_HOURS);
    // Its reminder is due but not out yet (delivery was paused, say).
    await pool.query("UPDATE outbox SET available_at = now() - interval '1 minute' WHERE kind = 'session.starting'");
    await updateSession(env.DB, org, session.id, { duration_min: 240 });
    expect((await scheduled('session.starting'))[0]).toMatchObject({ processed_at: null, in_minutes: -1 });
  });

  it('an end that has come and been reminded of is not reminded of again', async () => {
    const { org } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H(), duration_min: 60 }, OFFSET_HOURS);
    // It happened: it started three hours ago (set behind the API's back).
    await env.DB.prepare('UPDATE game_sessions SET starts_at = ? WHERE id = ?')
      .bind(new Date(Date.now() - 3 * 3_600_000).toISOString(), session.id)
      .run();
    const discord = fakeDiscord();
    const d = dispatcher(discord.api, null);
    await d.runOnce();
    const rollcalls = () => discord.sent.filter((m) => text(m.message).includes('该点名了')).length;
    expect(rollcalls()).toBe(1);
    await env.DB.prepare('UPDATE game_sessions SET duration_min = 90 WHERE id = ?').bind(session.id).run();
    expect((await scheduled('dm.session.rollcall'))[0]).toMatchObject({ result: 'sent' });
    await d.runOnce();
    expect(rollcalls()).toBe(1);
  });

  it('moved to start within 15 minutes: the stale reminder is dropped, not sent at the wrong time', async () => {
    const { org } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H() }, OFFSET_HOURS);
    await updateSession(env.DB, org, session.id, { starts_at: new Date(Date.now() + 10 * 60_000).toISOString() });
    expect((await scheduled('session.starting'))[0]).toMatchObject({ result: 'skipped' });
  });

  it('the card loses its buttons by itself when the session starts', { timeout: 15_000 }, async () => {
    const { org } = await cast();
    const startsAt = new Date(Date.now() + 2_500).toISOString();
    await createSession(env.DB, org, { starts_at: startsAt }, OFFSET_HOURS);
    const discord = fakeDiscord();
    const d = dispatcher(discord.api);
    await d.runOnce();
    expect(discord.sent).toHaveLength(1);
    expect(discord.sent[0].message.components).not.toEqual([]);
    // Nothing changes; the start time simply comes.
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, Date.parse(startsAt) - Date.now()) + 300));
    await d.runOnce();
    expect(discord.edits).toHaveLength(1);
    const last = discord.edits[0].message;
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
    const before = discord.edits.length;
    await env.DB.prepare('UPDATE game_sessions SET starts_at = ? WHERE id = ?')
      .bind(new Date(Date.now() - 3_600_000).toISOString(), session.id)
      .run();
    await rollCall(env.DB, org, session.id, [{ user_id: 'a', attendance: 'on_time' }, { user_id: 'org', attendance: 'on_time' }], OFFSET_HOURS);
    await settleSession(env.DB, org, session.id, [], true, noAiEnv(), OFFSET_HOURS);
    await d.runOnce();
    // Start, roll call and settlement together: one edit, of the final state.
    expect(discord.edits).toHaveLength(before + 1);
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
    const fannedOut = await pool.query("SELECT entity_id FROM outbox WHERE kind = 'dm.session.starting' ORDER BY entity_id");
    expect(fannedOut.rows.map((r) => r.entity_id)).toEqual(['a', 'org']); // not b, a maybe
    // A second fan-out of the same start time adds nothing.
    await pool.query("UPDATE outbox SET processed_at = NULL, result = NULL, available_at = now() WHERE kind = 'session.starting'");
    for (let i = 0; i < 2; i += 1) await d.runOnce();
    const to = discord.sent.filter((m) => text(m.message).includes('15 分钟后开局')).map((m) => m.channelId).sort();
    expect(to).toEqual([`dm-${dc(1).id}`, `dm-${dc(2).id}`]);
  });

  it(`session DMs have their own daily allowance (${SESSION_DM_BUDGET}) and never use up a case's`, async () => {
    await cast();
    // Organizers can each run 5 sessions at once (and invite one person 3 times
    // a day): enough of them to flood one invitee.
    const organizers = 4;
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
    // The case's DMs — the filing and its deadline reminder — still get through.
    expect(toA.some((t) => t.includes('有人给你立案了'))).toBe(true);
    expect(toA.some((t) => t.includes('陈述快截止了'))).toBe(true);
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

  // P2-4: the bot says 待定 where it said 可能 — the web's word (RSVP_LABEL).
  it('a 待定 button is answered with 待定', async () => {
    const { org } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H() }, OFFSET_HOURS);
    const reply = await handleRsvpButton(session.id, 'maybe', session.starts_at, dc(2), ctx);
    expect(reply.content).toContain('已登记：**待定**');
    expect(reply.content).not.toContain('可能');
  });
});

describe('bursts, caps and moves', () => {
  it('a burst of answers is one card edit, a moment later', async () => {
    const { org, a } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H(), capacity: 4 }, OFFSET_HOURS);
    const discord = fakeDiscord();
    await dispatcher(discord.api).runOnce();
    const before = discord.edits.length;
    for (let i = 0; i < 20; i += 1) await setRsvp(env.DB, a, session.id, i % 2 === 0 ? 'going' : 'maybe');
    const pending = await pool.query('SELECT available_at > now() AS later FROM outbox WHERE dedupe_key = $1 AND processed_at IS NULL', [
      `session:${session.id}:card`,
    ]);
    expect(pending.rows).toEqual([{ later: true }]);
    // Not yet…
    await rawDispatcher(discord.api).runOnce();
    expect(discord.edits).toHaveLength(before);
    // …then once, showing where things ended up.
    await dispatcher(discord.api).runOnce();
    expect(discord.edits).toHaveLength(before + 1);
    expect(text(discord.edits[before].message)).toContain('1/4 人'); // a ended on maybe
  });

  it('a session moved again and again is one "time changed" DM, a few minutes after the first move', async () => {
    const { org } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H(), invite: ['a'] }, OFFSET_HOURS);
    for (let h = 3; h <= 6; h += 1) {
      await updateSession(env.DB, org, session.id, { starts_at: new Date(Date.now() + h * 3_600_000).toISOString() });
    }
    const rows = await pool.query(
      "SELECT entity_id, round(extract(epoch FROM available_at - now()) / 60) AS in_minutes FROM outbox WHERE kind = 'dm.session.changed'",
    );
    expect(rows.rows).toEqual([{ entity_id: 'a', in_minutes: 3 }]);
    const discord = fakeDiscord();
    await dispatcher(discord.api, null).runOnce();
    expect(discord.sent.filter((m) => text(m.message).includes('约局改时间了'))).toHaveLength(1);
  });

  it(`one organizer reaches one person with at most ${INVITES_PER_ORGANIZER} invitations a day`, async () => {
    const { org } = await cast();
    for (let i = 0; i < 5; i += 1) await createSession(env.DB, org, { starts_at: IN_2H(), invite: ['a'] }, OFFSET_HOURS);
    const discord = fakeDiscord();
    await dispatcher(discord.api, null).runOnce();
    const invites = discord.sent.filter((m) => m.channelId === `dm-${dc(2).id}` && text(m.message).includes('约你'));
    expect(invites).toHaveLength(INVITES_PER_ORGANIZER);
    const held = await pool.query(
      "SELECT COUNT(*)::int AS n FROM outbox WHERE kind = 'dm.session.invited' AND result = 'skipped' AND last_error LIKE 'enough invitations%'",
    );
    expect(held.rows[0].n).toBe(5 - INVITES_PER_ORGANIZER);
  });

  it('a new session channel: the old card comes down and a new one goes up', async () => {
    const { org, a } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H() }, OFFSET_HOURS);
    const discord = fakeDiscord();
    await dispatcher(discord.api).runOnce();
    const old = discord.sent[0];
    await setRsvp(env.DB, a, session.id, 'going');
    await dispatcher(discord.api, OTHER_CARDS).runOnce();
    expect(discord.removed).toEqual(['910000000000000001']);
    expect(discord.sent.filter((s) => s.channelId === OTHER_CARDS)).toHaveLength(1);
    expect(old.channelId).toBe(CARDS);
    const where = await pool.query("SELECT channel_id FROM discord_messages WHERE entity = 'session'");
    expect(where.rows).toEqual([{ channel_id: OTHER_CARDS }]);
  });

  it('a new session channel after a cancel: the old card comes down, and no new one', async () => {
    const { org } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H() }, OFFSET_HOURS);
    const discord = fakeDiscord();
    await dispatcher(discord.api).runOnce();
    await cancelSession(env.DB, org, session.id);
    await dispatcher(discord.api, OTHER_CARDS).runOnce();
    expect(discord.removed).toEqual(['910000000000000001']);
    expect(discord.sent.filter((s) => s.channelId === OTHER_CARDS)).toEqual([]);
    expect((await pool.query("SELECT 1 FROM discord_messages WHERE entity = 'session'")).rowCount).toBe(0);
  });

  it('a start reminder held up past a move is dropped, not sent hours early', async () => {
    const { org } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H() }, OFFSET_HOURS);
    let down = true;
    const discord = fakeDiscord({
      openDm: () => {
        if (down) throw httpError(500);
      },
    });
    const d = dispatcher(discord.api, null);
    await pool.query("UPDATE outbox SET available_at = now() WHERE kind = 'session.starting'");
    await d.runOnce(); // the fan-out; the organizer's reminder fails and waits
    await updateSession(env.DB, org, session.id, { starts_at: IN_3H() });
    down = false;
    await pool.query("UPDATE outbox SET available_at = now() WHERE kind = 'dm.session.starting'");
    await d.runOnce();
    expect(discord.sent.filter((m) => text(m.message).includes('15 分钟后开局'))).toEqual([]);
    const row = await pool.query("SELECT result, last_error FROM outbox WHERE kind = 'dm.session.starting'");
    expect(row.rows).toEqual([{ result: 'skipped', last_error: 'the session moved since' }]);
  });

  it('cancelling a session that already started tells nobody', async () => {
    const { org, a } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H() }, OFFSET_HOURS);
    await setRsvp(env.DB, a, session.id, 'going');
    await env.DB.prepare('UPDATE game_sessions SET starts_at = ? WHERE id = ?')
      .bind(new Date(Date.now() - 10 * 60_000).toISOString(), session.id)
      .run();
    await pool.query('DELETE FROM outbox');
    await cancelSession(env.DB, org, session.id);
    expect((await events()).filter((e) => e.kind === 'dm.session.cancelled')).toEqual([]);
  });

  it('a refused card waits behind fresh events, not in front of them', async () => {
    const { org } = await cast();
    const first = await createSession(env.DB, org, { starts_at: IN_2H() }, OFFSET_HOURS);
    let refuse = true;
    const discord = fakeDiscord({
      send: (channelId) => {
        if (refuse && channelId === CARDS) {
          refuse = false;
          throw httpError(403);
        }
      },
    });
    const d = dispatcher(discord.api);
    await d.runOnce(); // the first card is refused and waits
    expect(discord.sent).toEqual([]);
    const second = await createSession(env.DB, org, { starts_at: IN_3H() }, OFFSET_HOURS);
    await d.runOnce(); // both due now: the fresh one goes first
    const order = discord.sent.map((s) => (text(s.message).includes(`v1:rsvp:${second.id}:`) ? second.id : first.id));
    expect(order).toEqual([second.id, first.id]);
  });

  it('a card stuck in retries does not hold up the start reminders', async () => {
    const { org } = await cast();
    await createSession(env.DB, org, { starts_at: IN_2H() }, OFFSET_HOURS);
    const discord = fakeDiscord({
      send: (channelId) => {
        if (channelId === CARDS) throw httpError(500);
      },
    });
    const d = dispatcher(discord.api);
    await d.runOnce(); // the card fails and waits to retry
    await pool.query("UPDATE outbox SET available_at = now() WHERE kind = 'session.starting'");
    await d.runOnce();
    expect(discord.sent.filter((m) => text(m.message).includes('15 分钟后开局')).map((m) => m.channelId)).toEqual([`dm-${dc(1).id}`]);
  });
});

describe('coalescing that cannot be gamed', () => {
  it('a session moved again and again cannot DM past the daily allowance', async () => {
    const { org } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H(), invite: ['a'] }, OFFSET_HOURS);
    const discord = fakeDiscord();
    const d = dispatcher(discord.api, null);
    await d.runOnce();
    for (let i = 1; i <= SESSION_DM_BUDGET + 3; i += 1) {
      await updateSession(env.DB, org, session.id, { starts_at: new Date(Date.now() + 2 * 3_600_000 + i * 60_000).toISOString() });
      await d.runOnce();
    }
    const toA = discord.sent.filter((m) => m.channelId === `dm-${dc(2).id}`);
    expect(toA).toHaveLength(SESSION_DM_BUDGET); // the invitation and 9 "the time changed"
  });

  it('a steady stream of answers cannot hold the card refresh off', async () => {
    const { org, a } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H() }, OFFSET_HOURS);
    await dispatcher(fakeDiscord().api).runOnce();
    const due = async () =>
      (await pool.query('SELECT available_at FROM outbox WHERE dedupe_key = $1 AND processed_at IS NULL', [`session:${session.id}:card`])).rows[0]
        ?.available_at as Date;
    await setRsvp(env.DB, a, session.id, 'going');
    const first = await due();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await setRsvp(env.DB, a, session.id, 'maybe');
    expect((await due()).getTime()).toBe(first.getTime());
  });

  it('a refused card stays refused when it is refreshed: behind fresh events, not counted again', async () => {
    const { org, a } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H() }, OFFSET_HOURS);
    const discord = fakeDiscord({
      send: (channelId) => {
        if (channelId === CARDS) throw httpError(403);
      },
    });
    await dispatcher(discord.api).runOnce();
    await setRsvp(env.DB, a, session.id, 'going');
    const [row] = (await pool.query(
      "SELECT refused_since IS NOT NULL AS refused, available_at > now() + interval '4 minutes' AS waits FROM outbox WHERE dedupe_key = $1",
      [`session:${session.id}:card`],
    )).rows;
    expect(row).toEqual({ refused: true, waits: true });
  });

  it('a card post whose answer was lost, retried after a change, is still one card', async () => {
    const { org, a } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H() }, OFFSET_HOURS);
    const discord = fakeDiscord({ dedupeNonces: true, loseFirstAnswer: true });
    const d = dispatcher(discord.api);
    await d.runOnce(); // posted, but the bot never heard back
    await setRsvp(env.DB, a, session.id, 'going');
    await pool.query('UPDATE outbox SET available_at = now() WHERE processed_at IS NULL AND dedupe_key = $1', [`session:${session.id}:card`]);
    await d.runOnce();
    await d.runOnce();
    expect(discord.sent.filter((s) => s.channelId === CARDS)).toHaveLength(1);
    const where = await pool.query("SELECT message_id FROM discord_messages WHERE entity = 'session'");
    expect(where.rows).toEqual([{ message_id: '910000000000000001' }]);
  });

  it('an old session channel the bot can no longer see does not keep the new one from its card', async () => {
    const { org, a } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H() }, OFFSET_HOURS);
    const discord = fakeDiscord({
      remove: (channelId) => {
        if (channelId === CARDS) throw Object.assign(httpError(403), { code: 50001 });
      },
    });
    await dispatcher(discord.api).runOnce();
    await setRsvp(env.DB, a, session.id, 'going');
    await dispatcher(discord.api, OTHER_CARDS).runOnce();
    expect(discord.sent.filter((s) => s.channelId === OTHER_CARDS)).toHaveLength(1);
    const where = await pool.query("SELECT channel_id FROM discord_messages WHERE entity = 'session'");
    expect(where.rows).toEqual([{ channel_id: OTHER_CARDS }]);
  });

  it('a cancel is news only to those the bot told about the session', async () => {
    const { org } = await cast();
    // b turned DMs off: their invitation never went out.
    await pool.query("UPDATE discord_links SET notify_dm = 0 WHERE user_id = 'b'");
    const session = await createSession(env.DB, org, { starts_at: IN_2H(), invite: ['a', 'b'] }, OFFSET_HOURS);
    await dispatcher(fakeDiscord().api, null).runOnce();
    await cancelSession(env.DB, org, session.id);
    expect((await events()).filter((e) => e.kind === 'dm.session.cancelled').map((e) => e.entity_id)).toEqual(['a']);
  });

  it('cancelled right after a move: those who had said yes or maybe still hear about it', async () => {
    const { org, a, b } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H() }, OFFSET_HOURS);
    await setRsvp(env.DB, a, session.id, 'going');
    await setRsvp(env.DB, b, session.id, 'maybe');
    await updateSession(env.DB, org, session.id, { starts_at: IN_3H() });
    // Before their "the time changed" DMs went out.
    await cancelSession(env.DB, org, session.id);
    expect((await events()).filter((e) => e.kind === 'dm.session.cancelled').map((e) => e.entity_id).sort()).toEqual(['a', 'b']);
  });

  it('knowing about another session does not count', async () => {
    const { org } = await cast();
    const told = await createSession(env.DB, org, { starts_at: IN_2H(), invite: ['a'] }, OFFSET_HOURS);
    const d = dispatcher(fakeDiscord().api, null);
    await d.runOnce();
    await pool.query("UPDATE discord_links SET notify_dm = 0 WHERE user_id = 'a'");
    const untold = await createSession(env.DB, org, { starts_at: IN_3H(), invite: ['a'] }, OFFSET_HOURS);
    await d.runOnce();
    await cancelSession(env.DB, org, untold.id);
    await cancelSession(env.DB, org, told.id);
    const cancels = (await pool.query("SELECT payload->>'session_id' AS sid FROM outbox WHERE kind = 'dm.session.cancelled'")).rows;
    expect(cancels).toEqual([{ sid: String(told.id) }]);
  });

  it('an invitation from long ago still counts, after the outbox has been cleaned', async () => {
    const { org } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H(), invite: ['a'] }, OFFSET_HOURS);
    await dispatcher(fakeDiscord().api, null).runOnce();
    await pool.query('DELETE FROM outbox WHERE processed_at IS NOT NULL'); // what the 30-day cleanup does
    await cancelSession(env.DB, org, session.id);
    expect((await events()).filter((e) => e.kind === 'dm.session.cancelled').map((e) => e.entity_id)).toEqual(['a']);
  });

  it('cancelled while its invitation was on the way: the cancel follows it', async () => {
    const { org } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H(), invite: ['a'] }, OFFSET_HOURS);
    const discord = fakeDiscord();
    const send = discord.api.send.bind(discord.api);
    let cancelled = false;
    discord.api.send = async (channelId, message) => {
      const out = await send(channelId, message);
      if (!cancelled && text(message).includes('约你')) {
        cancelled = true;
        await cancelSession(env.DB, org, session.id);
      }
      return out;
    };
    const d = dispatcher(discord.api, null);
    await d.runOnce();
    await d.runOnce();
    expect(discord.sent.filter((m) => text(m.message).includes('约局取消了')).map((m) => m.channelId)).toEqual([`dm-${dc(2).id}`]);
  });

  it('a passing failure taking the old card down is retried, not forgotten', async () => {
    const { org, a } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H() }, OFFSET_HOURS);
    let fail = true;
    const discord = fakeDiscord({
      remove: () => {
        if (fail) {
          fail = false;
          throw httpError(500);
        }
      },
    });
    await dispatcher(discord.api).runOnce();
    await setRsvp(env.DB, a, session.id, 'going');
    const moved = dispatcher(discord.api, OTHER_CARDS);
    await moved.runOnce(); // the removal fails: nothing forgotten
    expect(discord.sent.filter((s) => s.channelId === OTHER_CARDS)).toEqual([]);
    await pool.query("UPDATE outbox SET available_at = now() WHERE processed_at IS NULL AND kind = 'session.card' AND attempts > 0");
    await moved.runOnce();
    expect(discord.removed).toEqual(['910000000000000001']);
    expect(discord.sent.filter((s) => s.channelId === OTHER_CARDS)).toHaveLength(1);
  });

  it('"the time changed" keeps the time of the first move of a burst', async () => {
    const { org } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H(), invite: ['a'] }, OFFSET_HOURS);
    const due = async () => (await pool.query("SELECT available_at FROM outbox WHERE kind = 'dm.session.changed'")).rows[0].available_at as Date;
    await updateSession(env.DB, org, session.id, { starts_at: IN_3H() });
    const first = await due();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await updateSession(env.DB, org, session.id, { starts_at: new Date(Date.now() + 4 * 3_600_000).toISOString() });
    expect((await due()).getTime()).toBe(first.getTime());
  });

  it('a session moved to start in a couple of minutes says so before it starts', async () => {
    const { org } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H(), invite: ['a'] }, OFFSET_HOURS);
    const soon = new Date(Date.now() + 2 * 60_000).toISOString();
    await updateSession(env.DB, org, session.id, { starts_at: soon });
    const [row] = (await pool.query("SELECT available_at FROM outbox WHERE kind = 'dm.session.changed'")).rows;
    expect((row.available_at as Date).getTime()).toBeLessThanOrEqual(Date.parse(soon) - 59_000);
  });
});

describe('invites after creation', () => {
  /** Invitation DMs that reached bound user `n` (see cast: org 1, a 2, b 3). */
  const invitationsTo = (sent: ReturnType<typeof fakeDiscord>['sent'], n: number) =>
    sent.filter((m) => m.channelId === `dm-${dc(n).id}` && text(m.message).includes('约你'));

  it('someone invited after creation gets one invitation DM; asking again sends nothing', async () => {
    const { org } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H() }, OFFSET_HOURS);
    const discord = fakeDiscord();
    const d = dispatcher(discord.api, null);
    await d.runOnce();
    expect(await inviteToSession(env.DB, org, session.id, ['a', 'b'])).toMatchObject({ added: 2, skipped: 0 });
    await d.runOnce();
    expect(invitationsTo(discord.sent, 2)).toHaveLength(1);
    expect(invitationsTo(discord.sent, 3)).toHaveLength(1);

    expect(await inviteToSession(env.DB, org, session.id, ['a'])).toMatchObject({ added: 0, skipped: 1 });
    await d.runOnce();
    expect(invitationsTo(discord.sent, 2)).toHaveLength(1);
    const queued = await pool.query("SELECT entity_id FROM outbox WHERE kind = 'dm.session.invited' ORDER BY entity_id");
    expect(queued.rows.map((r) => r.entity_id)).toEqual(['a', 'b']);
  });

  it('someone who said no is not asked again', async () => {
    const { org, a } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H(), invite: ['a'] }, OFFSET_HOURS);
    await setRsvp(env.DB, a, session.id, 'out');
    expect(await inviteToSession(env.DB, org, session.id, ['a', 'b'])).toMatchObject({ added: 1, skipped: 1 });
    const queued = await pool.query("SELECT entity_id FROM outbox WHERE kind = 'dm.session.invited' ORDER BY entity_id");
    expect(queued.rows.map((r) => r.entity_id)).toEqual(['a', 'b']); // a's is the one from creation
  });

  it(`shares the organizer's ${INVITES_PER_ORGANIZER} invitations a day with invitations made at creation`, async () => {
    expect(INVITES_PER_ORGANIZER).toBe(SHARED_INVITES_PER_ORGANIZER);
    const { org } = await cast();
    for (let i = 0; i < INVITES_PER_ORGANIZER; i += 1) {
      await createSession(env.DB, org, { starts_at: IN_2H(), invite: ['a'] }, OFFSET_HOURS);
    }
    const later = await createSession(env.DB, org, { starts_at: IN_3H() }, OFFSET_HOURS);
    const discord = fakeDiscord();
    const d = dispatcher(discord.api, null);
    await d.runOnce();
    expect(await inviteToSession(env.DB, org, later.id, ['a'])).toMatchObject({ added: 1 });
    await d.runOnce();
    expect(invitationsTo(discord.sent, 2)).toHaveLength(INVITES_PER_ORGANIZER);
    const held = await pool.query(
      "SELECT entity_id FROM outbox WHERE kind = 'dm.session.invited' AND result = 'skipped' AND last_error LIKE 'enough invitations%'",
    );
    expect(held.rows.map((r) => r.entity_id)).toEqual(['a']);
  });
});

// --- P2-3 ---
describe('a cancel with a reason', () => {
  async function cancelled(reason?: string): Promise<{ to: string[]; texts: string[] }> {
    const { org, a, b } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H() }, OFFSET_HOURS);
    await setRsvp(env.DB, a, session.id, 'going');
    await setRsvp(env.DB, b, session.id, 'maybe');
    await cancelSession(env.DB, org, session.id, reason);
    const to = (await events()).filter((e) => e.kind === 'dm.session.cancelled').map((e) => e.entity_id).sort();
    const discord = fakeDiscord();
    await dispatcher(discord.api, null).runOnce();
    const texts = discord.sent.filter((s) => text(s.message).includes('约局取消了')).map((s) => text(s.message));
    return { to, texts };
  }

  it('reaches the same people, and the DM carries the reason', async () => {
    const { to, texts } = await cancelled('  临时加班，改天  ');
    expect(to).toEqual(['a', 'b']);
    expect(texts).toHaveLength(2);
    for (const t of texts) expect(t).toContain('理由：临时加班，改天');
  });

  it('without one, the same people and no reason line', async () => {
    const { to, texts } = await cancelled();
    expect(to).toEqual(['a', 'b']);
    expect(texts).toHaveLength(2);
    for (const t of texts) expect(t).not.toContain('理由');
  });
});
