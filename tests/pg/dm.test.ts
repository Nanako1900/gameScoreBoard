// P6: DMs about one's own cases — the events (0004_dm.sql), their delivery
// (dispatcher.ts, entity 'user') and the 写陈述 / 申诉 buttons and modals
// (case-actions.ts). Discord is a fake ChannelApi.

import { describe, expect, it } from 'vitest';
import { adminUpdateUser } from '../../worker/db';
import { appealCase, fileCase, overrideCase, revokeCase, submitStatement, withdrawCase } from '../../worker/cases';
import { importD1 } from '../../server/src/import-d1';
import { linkAccounts } from '../../server/src/discord/links';
import { handleCommand } from '../../server/src/discord/commands';
import { openCaseAction, submitCaseAction } from '../../server/src/discord/case-actions';
import { createDispatcher, DM_BUDGET, type ChannelApi } from '../../server/src/outbox/dispatcher';
import type { ChannelMessage } from '../../server/src/discord/verdict';
import type { Env, User } from '../../worker/types';
import { noAiEnv, OFFSET_HOURS, seedUser } from '../worker/helpers';
import { env, pool } from './cloudflare-test';

const OPTS = { offsetHours: OFFSET_HOURS, skipRateLimit: true };
const CLAIM = 'SECRETCLAIM 说好八点五排，等到八点四十还没上线';
const FRONTEND = 'https://score.example';
const ctx = { db: env.DB, appUrl: 'https://api.example', frontendUrl: FRONTEND };
const actionCtx = { ...ctx, env: noAiEnv() as Env };

const SUBJECT_DC = { id: '400000000000000001', username: 'subject_dc' };
const ADMIN_DC = { id: '400000000000000002', username: 'admin_dc' };
const OTHER_DC = { id: '400000000000000003', username: 'other_dc' };

interface Event {
  kind: string;
  entity: string;
  entity_id: string;
  result: string | null;
}

async function events(): Promise<Event[]> {
  return (await pool.query<Event>('SELECT kind, entity, entity_id, result FROM outbox ORDER BY id')).rows;
}

async function dmEvents(): Promise<Event[]> {
  return (await events()).filter((e) => e.entity === 'user');
}

/** Make every queued event due now (the filing DM waits 3 minutes, reminders hours). */
async function dueNow(): Promise<void> {
  await pool.query('UPDATE outbox SET available_at = now() WHERE processed_at IS NULL');
}

interface FakeHooks {
  /** Runs before a send is recorded (and may throw to fail it). */
  onSend?: (channelId: string, message: ChannelMessage) => Promise<void> | void;
  /** Throw here to fail a removal. */
  onRemove?: (channelId: string, messageId: string) => void;
}

function fakeDiscord(hooks: FakeHooks = {}) {
  const sent: Array<{ channelId: string; message: ChannelMessage & { nonce?: string } }> = [];
  const edits: Array<{ channelId: string; messageId: string; message: ChannelMessage }> = [];
  const failures: unknown[] = [];
  const editFailures: unknown[] = [];
  let next = 0;
  const api: ChannelApi = {
    async send(channelId, message) {
      if (failures.length > 0) throw failures.shift();
      await hooks.onSend?.(channelId, message);
      sent.push({ channelId, message });
      next += 1;
      return { id: `90000000000000${String(next).padStart(4, '0')}` };
    },
    async edit(channelId, messageId, message) {
      if (failures.length > 0) throw failures.shift();
      if (editFailures.length > 0) throw editFailures.shift();
      edits.push({ channelId, messageId, message });
    },
    async remove(channelId, messageId) {
      hooks.onRemove?.(channelId, messageId);
    },
    async openDm(discordUserId) {
      return `dm-${discordUserId}`;
    },
  };
  return {
    api,
    sent,
    edits,
    /** The next call (send or edit) fails. */
    fail: (e: unknown) => failures.push(e),
    /** The next edit fails. */
    failEdit: (e: unknown) => editFailures.push(e),
  };
}

/** An error as discord.js reports it. */
function discordError(status: number, code: number, message = `HTTP ${status}`): Error {
  return Object.assign(new Error(message), { status, code });
}

const quiet = { log: () => undefined, warn: () => undefined, error: () => undefined };

function dispatcher(api: ChannelApi) {
  return createDispatcher({ pool, db: env.DB, api, config: { verdictChannelId: null, frontendUrl: FRONTEND }, log: quiet });
}

async function bind(userId: string, who: { id: string; username: string }): Promise<void> {
  await linkAccounts(env.DB, { userId, discordUserId: who.id, discordUsername: who.username, replace: false, via: 'web' });
}

async function people(): Promise<{ judge: User; admin: User; subject: User }> {
  const judge = await seedUser({ id: 'judge', judge: true });
  const admin = await seedUser({ id: 'admin', admin: true });
  const subject = await seedUser({ id: 'subject', username: '被告', score: 80 });
  await bind('subject', SUBJECT_DC);
  await bind('admin', ADMIN_DC);
  return { judge, admin, subject };
}

async function file(judge: User, subject: User, type = 'no_show') {
  return fileCase(env.DB, judge, { subject_id: subject.id, type, claim: CLAIM }, OPTS, noAiEnv());
}

const text = (m: ChannelMessage) => JSON.stringify(m);

describe('DM events', () => {
  it('a filing queues a DM in 3 minutes and a reminder 2 hours before the deadline', async () => {
    const { judge, subject } = await people();
    const filed = await file(judge, subject);
    const rows = (
      await pool.query(
        `SELECT kind, entity_id, payload,
                round(extract(epoch FROM available_at - now()) / 60) AS in_minutes,
                available_at = ($1::timestamp AT TIME ZONE 'UTC') - interval '2 hours' AS before_deadline
           FROM outbox ORDER BY id`,
        [filed.deadline_at],
      )
    ).rows;
    expect(rows.map((r) => [r.kind, r.entity_id, r.payload])).toEqual([
      ['dm.filed', 'subject', { record_id: filed.id }],
      ['dm.deadline', 'subject', { record_id: filed.id }],
    ]);
    expect(rows[0].in_minutes).toBe(3);
    expect(rows[1].before_deadline).toBe(true);
  });

  it('a moved deadline moves the reminder too', async () => {
    const { judge, subject } = await people();
    const filed = await file(judge, subject);
    await env.DB.prepare("UPDATE records SET deadline_at = datetime(deadline_at, '+1 hour') WHERE id = ?").bind(filed.id).run();
    const row = (
      await pool.query(
        `SELECT available_at = (deadline_at::timestamp AT TIME ZONE 'UTC') - interval '2 hours' AS ok
           FROM outbox o JOIN records r ON r.id = (o.payload->>'record_id')::bigint WHERE o.kind = 'dm.deadline'`,
      )
    ).rows[0];
    expect(row.ok).toBe(true);
  });

  it('verdict, override, revoke, withdrawal and appeal each notify the right person', async () => {
    const { judge, admin, subject } = await people();
    const a = await file(judge, subject);
    await submitStatement(env.DB, subject, a.id, '临时加班', noAiEnv());
    await appealCase(env.DB, subject, a.id, '我那天在医院');
    await overrideCase(env.DB, admin, a.id, -8, '情有可原');
    await revokeCase(env.DB, admin, a.id);
    const b = await file(judge, subject, 'afk');
    await withdrawCase(env.DB, judge, b.id);
    const kinds = (await dmEvents()).map((e) => [e.kind, e.entity_id]);
    expect(kinds).toEqual([
      ['dm.filed', 'subject'],
      ['dm.deadline', 'subject'],
      ['dm.decided', 'subject'],
      ['dm.appealed', 'admin'],
      ['dm.overridden', 'subject'],
      ['dm.revoked', 'subject'],
      ['dm.filed', 'subject'],
      ['dm.deadline', 'subject'],
      ['dm.withdrawn', 'subject'],
    ]);
  });

  it('the D1 import is history, not news: no events at all', async () => {
    const T = '2026-10-20 12:00:00';
    await importD1(pool, {
      users: [
        { id: 'j', username: 'j', is_participant: 1, is_judge: 1, is_admin: 0, score: 100, created_at: T, updated_at: T },
        { id: 's', username: 's', is_participant: 1, is_judge: 0, is_admin: 0, score: 90, created_at: T, updated_at: T },
      ],
      records: [
        { id: 1, subject_id: 's', reporter_id: 'j', type: 'no_show', delta: 0, claim: 'x', deadline_at: '2099-01-01 00:00:00', status: 'awaiting_statement', created_at: T },
      ],
    });
    expect(await events()).toEqual([]);
  });
});

describe('DM delivery', () => {
  it('sends the filing DM with a 写陈述 button, and remembers it', async () => {
    const { judge, subject } = await people();
    const filed = await file(judge, subject);
    await dueNow();
    const discord = fakeDiscord();
    await dispatcher(discord.api).runOnce();
    // Filing and reminder: the reminder is just as relevant right now.
    const [first] = discord.sent;
    expect(first.channelId).toBe(`dm-${SUBJECT_DC.id}`);
    expect(text(first.message)).toContain('有人给你立案了');
    expect(text(first.message)).toContain('SECRETCLAIM');
    expect(text(first.message)).toContain(`v1:stmt:${filed.id}`);
    expect(first.message.allowed_mentions).toEqual({ parse: [] });
    const saved = await pool.query("SELECT channel_id FROM discord_messages WHERE purpose = 'dm:filed'");
    expect(saved.rows).toEqual([{ channel_id: `dm-${SUBJECT_DC.id}` }]);
  });

  it('says nothing about a filing already answered or withdrawn by the time it is due', async () => {
    const { judge, subject } = await people();
    const filed = await file(judge, subject);
    await submitStatement(env.DB, subject, filed.id, '临时加班', noAiEnv());
    await dueNow();
    const discord = fakeDiscord();
    await dispatcher(discord.api).runOnce();
    // Only the verdict goes out.
    expect(discord.sent.map((s) => text(s.message).includes('判决'))).toEqual([true]);
    const results = Object.fromEntries((await dmEvents()).map((e) => [e.kind, e.result]));
    expect(results).toMatchObject({ 'dm.filed': 'skipped', 'dm.deadline': 'skipped', 'dm.decided': 'sent' });
  });

  it('the verdict DM carries the full verdict and an 申诉 button', async () => {
    const { judge, subject } = await people();
    const filed = await file(judge, subject);
    await submitStatement(env.DB, subject, filed.id, '临时加班', noAiEnv());
    await dueNow();
    const discord = fakeDiscord();
    await dispatcher(discord.api).runOnce();
    const verdict = discord.sent.find((s) => text(s.message).includes('判决：'));
    expect(verdict).toBeDefined();
    expect(text(verdict!.message)).toContain(`v1:appeal:${filed.id}`);
  });

  it('a withdrawal rewrites the reminder too, not just the filing DM', async () => {
    const { judge, subject } = await people();
    const filed = await file(judge, subject);
    await dueNow();
    const discord = fakeDiscord();
    const d = dispatcher(discord.api);
    await d.runOnce();
    expect(discord.sent).toHaveLength(2); // filing + reminder
    await withdrawCase(env.DB, judge, filed.id);
    await d.runOnce();
    expect(discord.edits.map((e) => e.messageId).sort()).toEqual(discord.sent.map((_, i) => `90000000000000${String(i + 1).padStart(4, '0')}`).sort());
    for (const e of discord.edits) expect(e.message.components).toEqual([]);
  });

  it('a withdrawal while the filing DM is still 3 minutes away: nothing at all, in the real order', async () => {
    const { judge, subject } = await people();
    const filed = await file(judge, subject);
    await withdrawCase(env.DB, judge, filed.id);
    // Only the withdrawal is due; the filing DM still waits its 3 minutes.
    const discord = fakeDiscord();
    const d = dispatcher(discord.api);
    await d.runOnce();
    await pool.query("UPDATE outbox SET available_at = now() WHERE kind = 'dm.filed'");
    await d.runOnce();
    expect(discord.sent).toEqual([]);
    expect(discord.edits).toEqual([]);
  });

  it('a deadline cut to under 2 hours away gets its reminder at once', async () => {
    const { judge, subject } = await people();
    const filed = await file(judge, subject);
    await env.DB.prepare("UPDATE records SET created_at = datetime('now', '-1 hour') WHERE id = ?").bind(filed.id).run();
    await env.DB.prepare("UPDATE records SET deadline_at = datetime('now', '+90 minutes') WHERE id = ?").bind(filed.id).run();
    const [row] = (await pool.query("SELECT available_at <= now() + interval '1 minute' AS soon FROM outbox WHERE kind = 'dm.deadline'")).rows;
    expect(row.soon).toBe(true);
  });

  it('a deadline cut right after filing reminds no earlier than the filing DM goes', async () => {
    const { judge, subject } = await people();
    const filed = await file(judge, subject);
    await env.DB.prepare("UPDATE records SET deadline_at = datetime('now', '+90 minutes') WHERE id = ?").bind(filed.id).run();
    const rows = (await pool.query("SELECT kind, available_at FROM outbox WHERE kind IN ('dm.filed', 'dm.deadline')")).rows;
    const at = Object.fromEntries(rows.map((r) => [r.kind, (r.available_at as Date).getTime()]));
    // records.created_at has whole seconds.
    expect(at['dm.deadline']).toBeGreaterThanOrEqual(at['dm.filed'] - 1_000);
  });

  it('a re-sent reminder takes the button off the earlier one', async () => {
    const { judge, subject } = await people();
    const filed = await file(judge, subject);
    await dueNow();
    const discord = fakeDiscord();
    const d = dispatcher(discord.api);
    await d.runOnce();
    const first = discord.sent.findIndex((m) => text(m.message).includes('陈述快截止了'));
    await env.DB.prepare("UPDATE records SET deadline_at = datetime(deadline_at, '+3 hours') WHERE id = ?").bind(filed.id).run();
    await dueNow();
    await d.runOnce();
    const firstId = `90000000000000${String(first + 1).padStart(4, '0')}`;
    const stripped = discord.edits.find((e) => e.messageId === firstId);
    expect(stripped?.message.components).toEqual([]);
  });

  it('a reminder re-armed for a new deadline is a new send: a new nonce', async () => {
    const { judge, subject } = await people();
    const filed = await file(judge, subject);
    await dueNow();
    const discord = fakeDiscord();
    const d = dispatcher(discord.api);
    await d.runOnce();
    await env.DB.prepare("UPDATE records SET deadline_at = datetime(deadline_at, '+3 hours') WHERE id = ?").bind(filed.id).run();
    await dueNow();
    await d.runOnce();
    const reminders = discord.sent.filter((m) => text(m.message).includes('陈述快截止了'));
    expect(reminders).toHaveLength(2);
    expect(reminders[0].message.nonce).not.toBe(reminders[1].message.nonce);
  });

  it('a re-sent reminder that cannot go out leaves the earlier one its button', async () => {
    const { judge, subject } = await people();
    const filed = await file(judge, subject);
    await dueNow();
    const discord = fakeDiscord();
    const d = dispatcher(discord.api);
    await d.runOnce();
    // The day's allowance is used up by then.
    await pool.query(
      `INSERT INTO outbox (kind, entity, entity_id, dedupe_key, payload, processed_at, result)
       SELECT 'dm.filed', 'user', 'subject', 'filler:' || g, '{}', now(), 'sent' FROM generate_series(1, $1::int) g`,
      [DM_BUDGET],
    );
    await env.DB.prepare("UPDATE records SET deadline_at = datetime(deadline_at, '+3 hours') WHERE id = ?").bind(filed.id).run();
    await dueNow();
    await d.runOnce();
    expect(discord.edits).toEqual([]);
  });

  it('taking the button off the earlier reminder is best effort: the new one counts as sent either way', async () => {
    const { judge, subject } = await people();
    const filed = await file(judge, subject);
    await dueNow();
    const discord = fakeDiscord();
    const d = dispatcher(discord.api);
    await d.runOnce();
    // Discord will not edit the old one — once with a 400, once as "DMs closed".
    for (const failure of [discordError(400, 50035), discordError(403, 50007)]) {
      await env.DB.prepare("UPDATE records SET deadline_at = datetime(deadline_at, '+3 hours') WHERE id = ?").bind(filed.id).run();
      await dueNow();
      discord.failEdit(failure);
      await d.runOnce();
      const [row] = (await pool.query("SELECT result FROM outbox WHERE kind = 'dm.deadline'")).rows;
      expect(row.result).toBe('sent');
    }
    // The newest reminder is the one remembered (a withdrawal rewrites it), and
    // DMs to the subject still work.
    const latest = discord.sent.filter((m) => text(m.message).includes('陈述快截止了')).length;
    expect(latest).toBe(3);
    const stored = (await pool.query("SELECT message_id FROM discord_messages WHERE purpose = 'dm:deadline'")).rows;
    expect(stored).toEqual([{ message_id: `90000000000000${String(discord.sent.length).padStart(4, '0')}` }]);
    const [link] = (await pool.query("SELECT dm_ok FROM discord_links WHERE user_id = 'subject'")).rows;
    expect(link.dm_ok).toBe(1);
  });

  it('a record deleted while its DM was on the way: the DM says so at once', async () => {
    const { judge, subject } = await people();
    await file(judge, subject);
    await pool.query("DELETE FROM outbox WHERE kind = 'dm.deadline'");
    await dueNow();
    const discord = fakeDiscord({
      onSend: async (_channel, message) => {
        if (text(message).includes('有人给你立案了')) await adminUpdateUser(env.DB, 'judge', { delete: true });
      },
    });
    await dispatcher(discord.api).runOnce();
    expect(discord.edits.map((e) => text(e.message))).toEqual([expect.stringContaining('这条记录已删除')]);
    expect((await pool.query("SELECT 1 FROM discord_messages WHERE entity = 'record'")).rowCount).toBe(0);
  });

  it('rewrites the statement DMs on withdrawal even after the subject unbound', async () => {
    const { judge, subject } = await people();
    const filed = await file(judge, subject);
    await dueNow();
    const discord = fakeDiscord();
    const d = dispatcher(discord.api);
    await d.runOnce();
    await env.DB.prepare("DELETE FROM discord_links WHERE user_id = 'subject'").run();
    await withdrawCase(env.DB, judge, filed.id);
    await d.runOnce();
    expect(discord.edits).toHaveLength(2);
  });

  it('rewrites the statement DMs on withdrawal even if the subject has since turned DMs off', async () => {
    const { judge, subject } = await people();
    const filed = await file(judge, subject);
    await dueNow();
    const discord = fakeDiscord();
    const d = dispatcher(discord.api);
    await d.runOnce();
    await handleCommand({ commandName: 'notify', caller: SUBJECT_DC, targetUser: null, state: 'off' }, ctx);
    await withdrawCase(env.DB, judge, filed.id);
    await d.runOnce();
    expect(discord.edits).toHaveLength(2);
  });

  it('a deleted user’s DMs about a case are rewritten to say it is gone', async () => {
    const { judge, subject } = await people();
    await file(judge, subject);
    await dueNow();
    const discord = fakeDiscord();
    const d = dispatcher(discord.api);
    await d.runOnce();
    await adminUpdateUser(env.DB, 'subject', { delete: true });
    await d.runOnce();
    expect(discord.edits).toHaveLength(2);
    for (const e of discord.edits) {
      expect(text(e.message)).toContain('已删除');
      expect(text(e.message)).not.toContain('SECRETCLAIM');
    }
    expect((await pool.query("SELECT 1 FROM discord_messages WHERE purpose LIKE 'dm:%'")).rowCount).toBe(0);
  });

  it('re-arms a reminder that already went out when the deadline is extended', async () => {
    const { judge, subject } = await people();
    const filed = await file(judge, subject);
    await dueNow();
    const discord = fakeDiscord();
    const d = dispatcher(discord.api);
    await d.runOnce();
    const reminders = () => discord.sent.filter((m) => text(m.message).includes('陈述快截止了')).length;
    expect(reminders()).toBe(1);
    await env.DB.prepare("UPDATE records SET deadline_at = datetime(deadline_at, '+3 hours') WHERE id = ?").bind(filed.id).run();
    const [row] = (await pool.query("SELECT processed_at, available_at > now() AS later FROM outbox WHERE kind = 'dm.deadline'")).rows;
    expect(row).toEqual({ processed_at: null, later: true });
    await dueNow();
    await d.runOnce();
    expect(reminders()).toBe(2);
  });

  it('DMs and channel posts of the same changes do not hold each other up', async () => {
    const { judge, subject } = await people();
    const filed = await file(judge, subject);
    await submitStatement(env.DB, subject, filed.id, '临时加班', noAiEnv());
    const discord = fakeDiscord();
    const d = createDispatcher({
      pool,
      db: env.DB,
      api: discord.api,
      config: { verdictChannelId: '200000000000000009', frontendUrl: FRONTEND },
      log: quiet,
    });
    // The filing DM and reminder are still scheduled; the verdict (post + DM) is due.
    await d.runOnce();
    expect(discord.sent.map((m) => m.channelId).sort()).toEqual(['200000000000000009', `dm-${SUBJECT_DC.id}`]);
  });

  it('rewrites the filing DM on withdrawal instead of sending another', async () => {
    const { judge, subject } = await people();
    const filed = await file(judge, subject);
    await dueNow();
    const discord = fakeDiscord();
    const d = dispatcher(discord.api);
    await d.runOnce();
    const before = discord.sent.length;
    await withdrawCase(env.DB, judge, filed.id);
    await d.runOnce();
    expect(discord.sent).toHaveLength(before);
    expect(discord.edits).toHaveLength(2); // the filing DM and the reminder
    expect(text(discord.edits[0].message)).toContain('立案已撤回');
    expect(discord.edits[0].message.components).toEqual([]);
  });

  it('a withdrawal before the filing DM went out stays silent', async () => {
    const { judge, subject } = await people();
    const filed = await file(judge, subject);
    await withdrawCase(env.DB, judge, filed.id);
    await dueNow();
    const discord = fakeDiscord();
    await dispatcher(discord.api).runOnce();
    expect(discord.sent).toEqual([]);
    expect(discord.edits).toEqual([]);
  });

  it('does not DM the unbound, those who turned DMs off, or those whose DMs are shut', async () => {
    const { judge, subject } = await people();
    const loner = await seedUser({ id: 'loner' });
    await file(judge, loner);
    await file(judge, subject);
    await handleCommand({ commandName: 'notify', caller: SUBJECT_DC, targetUser: null, state: 'off' }, ctx);
    await dueNow();
    const discord = fakeDiscord();
    await dispatcher(discord.api).runOnce();
    expect(discord.sent).toEqual([]);
    expect(new Set((await dmEvents()).map((e) => e.result))).toEqual(new Set(['skipped']));
  });

  it('marks DMs shut on 50007 and stops trying, until /notify turns them back on', async () => {
    const { judge, subject } = await people();
    await file(judge, subject);
    await dueNow();
    const discord = fakeDiscord();
    discord.fail(Object.assign(new Error('Cannot send messages to this user'), { status: 403, code: 50007 }));
    await dispatcher(discord.api).runOnce();
    const link = await env.DB.prepare('SELECT dm_ok FROM discord_links WHERE user_id = ?').bind('subject').first();
    expect(link).toEqual({ dm_ok: 0 });
    // The reminder after it was skipped, not sent.
    expect(discord.sent).toEqual([]);
    await handleCommand({ commandName: 'notify', caller: SUBJECT_DC, targetUser: null, state: 'on' }, ctx);
    expect(await env.DB.prepare('SELECT dm_ok, notify_dm FROM discord_links WHERE user_id = ?').bind('subject').first()).toEqual({
      dm_ok: 1,
      notify_dm: 1,
    });
  });

  it(`caps reminders at ${DM_BUDGET} per person per day — but never a verdict`, async () => {
    const { judge, subject } = await people();
    const cases: number[] = [];
    // Each case is two reminders (filing + deadline): this is past the cap.
    const n = DM_BUDGET / 2 + 2;
    for (let i = 0; i < n; i += 1) {
      await seedUser({ id: `j${i}`, judge: true });
      const filed = await fileCase(env.DB, { ...judge, id: `j${i}` }, { subject_id: subject.id, type: 'afk', claim: CLAIM }, OPTS, noAiEnv());
      cases.push(filed.id);
    }
    await dueNow();
    const discord = fakeDiscord();
    const d = dispatcher(discord.api);
    await d.runOnce();
    expect(discord.sent).toHaveLength(DM_BUDGET);
    // The verdicts that follow still all arrive.
    for (const id of cases) await submitStatement(env.DB, subject, id, '临时加班', noAiEnv());
    await d.runOnce();
    const verdicts = discord.sent.filter((m) => text(m.message).includes('判决：'));
    expect(verdicts).toHaveLength(n);
  });

  it('a second appeal answered at the same points still reaches the subject', async () => {
    const { judge, admin, subject } = await people();
    const filed = await file(judge, subject);
    await submitStatement(env.DB, subject, filed.id, '临时加班', noAiEnv());
    await appealCase(env.DB, subject, filed.id, '我那天在医院');
    await overrideCase(env.DB, admin, filed.id, -8, '情有可原');
    await appealCase(env.DB, subject, filed.id, '还是觉得重');
    await overrideCase(env.DB, admin, filed.id, -8, '维持');
    const overrides = (await dmEvents()).filter((e) => e.kind === 'dm.overridden');
    expect(overrides).toHaveLength(2);
    const channel = (await events()).filter((e) => e.kind === 'case.overridden');
    expect(channel).toHaveLength(2);
  });

  it('does not show an appeal to someone who is no longer an admin', async () => {
    const { judge, subject } = await people();
    const filed = await file(judge, subject);
    await submitStatement(env.DB, subject, filed.id, '临时加班', noAiEnv());
    await appealCase(env.DB, subject, filed.id, '我在医院');
    await adminUpdateUser(env.DB, 'admin', { is_admin: false });
    await dueNow();
    const discord = fakeDiscord();
    await dispatcher(discord.api).runOnce();
    expect(discord.sent.filter((m) => m.channelId === `dm-${ADMIN_DC.id}`)).toEqual([]);
  });

  it('a relink keeps the DM choice', async () => {
    await people();
    await handleCommand({ commandName: 'notify', caller: SUBJECT_DC, targetUser: null, state: 'off' }, ctx);
    const outcome = await linkAccounts(env.DB, {
      userId: 'subject',
      discordUserId: OTHER_DC.id,
      discordUsername: OTHER_DC.username,
      replace: true,
      via: 'web',
    });
    expect(outcome.kind).toBe('relinked');
    expect(await env.DB.prepare('SELECT notify_dm FROM discord_links WHERE user_id = ?').bind('subject').first()).toEqual({ notify_dm: 0 });
  });

  it('a refused DM is retried for a day, then given up', async () => {
    const { judge, subject } = await people();
    await file(judge, subject);
    await pool.query("DELETE FROM outbox WHERE kind = 'dm.deadline'");
    await dueNow();
    const discord = fakeDiscord();
    const d = dispatcher(discord.api);
    discord.fail(Object.assign(new Error('Missing Access'), { status: 403, code: 50001 }));
    await d.runOnce();
    expect((await dmEvents())[0].result).toBeNull();
    // A day of refusals later (counted from the first one, not from creation):
    await pool.query("UPDATE outbox SET available_at = now(), refused_since = now() - interval '25 hours'");
    discord.fail(Object.assign(new Error('Missing Access'), { status: 403, code: 50001 }));
    await d.runOnce();
    expect((await dmEvents())[0].result).toBe('dead');
  });

  it('an event already old when first refused still gets its day of retries', async () => {
    const { judge, subject } = await people();
    await file(judge, subject);
    await pool.query("DELETE FROM outbox WHERE kind = 'dm.deadline'");
    await pool.query("UPDATE outbox SET available_at = now(), created_at = now() - interval '3 days'");
    const discord = fakeDiscord();
    discord.fail(Object.assign(new Error('Missing Access'), { status: 403, code: 50001 }));
    await dispatcher(discord.api).runOnce();
    const [row] = (await pool.query('SELECT result, refused_since IS NOT NULL AS refused FROM outbox')).rows;
    expect(row).toEqual({ result: null, refused: true });
  });

  it('a corrected verdict in the channel is never given up on, however long Discord refuses', async () => {
    const { judge, admin, subject } = await people();
    const filed = await file(judge, subject);
    await submitStatement(env.DB, subject, filed.id, '临时加班', noAiEnv());
    const discord = fakeDiscord();
    const channel = createDispatcher({
      pool,
      db: env.DB,
      api: discord.api,
      config: { verdictChannelId: '200000000000000009', frontendUrl: FRONTEND },
      log: quiet,
    });
    await channel.runOnce();
    await revokeCase(env.DB, admin, filed.id);
    await pool.query("DELETE FROM outbox WHERE entity = 'user'"); // only the channel correction here
    await pool.query("UPDATE outbox SET refused_since = now() - interval '3 days' WHERE kind = 'case.revoked'");
    discord.fail(Object.assign(new Error('Missing Permissions'), { status: 403, code: 50013 }));
    await channel.runOnce();
    const [row] = (await pool.query(
      "SELECT result, round(extract(epoch FROM available_at - now()) / 60) AS in_minutes FROM outbox WHERE kind = 'case.revoked'",
    )).rows;
    // Still waiting for the permission, not dead — asked hourly now.
    expect(row).toEqual({ result: null, in_minutes: 60 });
  });

  it('a refused event keeps its place: what came after it waits', async () => {
    const { judge, admin, subject } = await people();
    const filed = await file(judge, subject);
    await submitStatement(env.DB, subject, filed.id, '临时加班', noAiEnv());
    await pool.query("DELETE FROM outbox WHERE kind IN ('dm.filed', 'dm.deadline')");
    const discord = fakeDiscord();
    const d = dispatcher(discord.api);
    discord.fail(Object.assign(new Error('Missing Access'), { status: 403, code: 50001 }));
    await d.runOnce(); // dm.decided refused
    await overrideCase(env.DB, admin, filed.id, -8, '情有可原');
    await d.runOnce();
    // The override does not overtake the verdict it corrects.
    expect(discord.sent).toEqual([]);
    await pool.query('UPDATE outbox SET available_at = now() WHERE processed_at IS NULL');
    await d.runOnce();
    // Told by their titles (both render the case as it is now).
    expect(discord.sent.map((m) => (m.message.embeds[0].title?.startsWith('⚖️ 判决') ? 'verdict' : 'override'))).toEqual([
      'verdict',
      'override',
    ]);
  });

  it('leaves a record event it cannot handle for a newer bot', async () => {
    await people();
    await pool.query(
      `INSERT INTO outbox (kind, entity, entity_id, dedupe_key) VALUES ('case.from.the.future', 'record', '1', 'future:r1')`,
    );
    await dispatcher(fakeDiscord().api).runOnce();
    const [row] = (await pool.query("SELECT result FROM outbox WHERE dedupe_key = 'future:r1'")).rows;
    expect(row.result).toBeNull();
  });

  it('leaves an event it cannot handle for a newer bot instead of dropping it', async () => {
    await people();
    await pool.query(
      `INSERT INTO outbox (kind, entity, entity_id, dedupe_key) VALUES ('dm.from.the.future', 'user', 'subject', 'future:1')`,
    );
    await dispatcher(fakeDiscord().api).runOnce();
    const [row] = (await pool.query("SELECT result, attempts, available_at > now() AS later FROM outbox WHERE dedupe_key = 'future:1'")).rows;
    expect(row).toEqual({ result: null, attempts: 0, later: true });
  });

  it('a reminder scheduled for later does not hold up the DMs behind it', async () => {
    const { judge, subject } = await people();
    const a = await file(judge, subject);
    // Make only the filing due: the reminder stays hours away.
    await pool.query("UPDATE outbox SET available_at = now() WHERE kind = 'dm.filed'");
    await submitStatement(env.DB, subject, a.id, '临时加班', noAiEnv());
    const discord = fakeDiscord();
    await dispatcher(discord.api).runOnce();
    expect(discord.sent.some((s) => text(s.message).includes('判决：'))).toBe(true);
  });

  it('tells the admins about an appeal', async () => {
    const { judge, subject } = await people();
    const filed = await file(judge, subject);
    await submitStatement(env.DB, subject, filed.id, '临时加班', noAiEnv());
    await appealCase(env.DB, subject, filed.id, '我在医院');
    await dueNow();
    const discord = fakeDiscord();
    await dispatcher(discord.api).runOnce();
    const toAdmin = discord.sent.filter((s) => s.channelId === `dm-${ADMIN_DC.id}`);
    expect(toAdmin).toHaveLength(1);
    expect(text(toAdmin[0].message)).toContain('有新的申诉');
  });

  it('a deleted user’s queued DMs are dropped quietly', async () => {
    const { judge, subject } = await people();
    await file(judge, subject);
    await adminUpdateUser(env.DB, 'subject', { delete: true });
    await dueNow();
    const discord = fakeDiscord();
    await dispatcher(discord.api).runOnce();
    expect(discord.sent).toEqual([]);
  });
});

describe('写陈述 and 申诉 from a DM', () => {
  it('opens the statement modal for the subject while the window is open', async () => {
    const { judge, subject } = await people();
    const filed = await file(judge, subject);
    const result = await openCaseAction('statement', filed.id, SUBJECT_DC, ctx);
    expect(result).toMatchObject({ kind: 'modal', modal: { customId: `v1:stmtm:${filed.id}`, field: { required: true } } });
  });

  it('turns away anyone else, the unbound, and a closed window', async () => {
    const { judge, subject } = await people();
    await seedUser({ id: 'other' });
    await bind('other', OTHER_DC);
    const filed = await file(judge, subject);
    expect(await openCaseAction('statement', filed.id, OTHER_DC, ctx)).toMatchObject({
      kind: 'reply',
      reply: { content: expect.stringContaining('只能为自己') },
    });
    expect(await openCaseAction('statement', filed.id, { id: '400000000000000099', username: 'x' }, ctx)).toMatchObject({
      kind: 'reply',
      reply: { content: expect.stringContaining('/link') },
    });
    await submitStatement(env.DB, subject, filed.id, '临时加班', noAiEnv());
    expect(await openCaseAction('statement', filed.id, SUBJECT_DC, ctx)).toMatchObject({
      kind: 'reply',
      reply: { content: expect.stringContaining('结束') },
    });
  });

  it('a statement sent from the modal is judged at once, like on the web', async () => {
    const { judge, subject } = await people();
    const filed = await file(judge, subject);
    const reply = await submitCaseAction('statement', filed.id, '公司临时加班，手机没电', SUBJECT_DC, actionCtx);
    expect(reply.ephemeral).toBe(true);
    expect(reply.content).toMatch(/判决：\*\*-\d+ 分\*\*/);
    const rec = await env.DB.prepare('SELECT status, statement FROM records WHERE id = ?').bind(filed.id).first();
    expect(rec).toEqual({ status: 'decided', statement: '公司临时加班，手机没电' });
    // A second one is refused by the domain code itself.
    const again = await submitCaseAction('statement', filed.id, '我改主意了', SUBJECT_DC, actionCtx);
    expect(again.content).toContain('陈述阶段');
  });

  it('an appeal from the modal freezes the case for review', async () => {
    const { judge, subject } = await people();
    const filed = await file(judge, subject);
    await submitStatement(env.DB, subject, filed.id, '临时加班', noAiEnv());
    expect(await openCaseAction('appeal', filed.id, SUBJECT_DC, ctx)).toMatchObject({ kind: 'modal' });
    const reply = await submitCaseAction('appeal', filed.id, '我那天在医院', SUBJECT_DC, actionCtx);
    expect(reply.content).toContain('已提交申诉');
    const rec = await env.DB.prepare('SELECT status, appeal_reason FROM records WHERE id = ?').bind(filed.id).first();
    expect(rec).toEqual({ status: 'appealed', appeal_reason: '我那天在医院' });
  });

  it('refuses both during READ_ONLY maintenance', async () => {
    const { judge, subject } = await people();
    const filed = await file(judge, subject);
    const ro = { ...actionCtx, readOnly: true };
    expect(await openCaseAction('statement', filed.id, SUBJECT_DC, ro)).toMatchObject({ kind: 'reply' });
    expect((await submitCaseAction('statement', filed.id, 'x', SUBJECT_DC, ro)).content).toContain('只读');
  });
});

describe('refusals, kept and counted right', () => {
  it('a second refusal keeps the time of the first', async () => {
    const { judge, subject } = await people();
    await file(judge, subject);
    await pool.query("DELETE FROM outbox WHERE kind = 'dm.deadline'");
    await dueNow();
    const discord = fakeDiscord();
    const d = dispatcher(discord.api);
    discord.fail(discordError(403, 50001, 'Missing Access'));
    await d.runOnce();
    await pool.query("UPDATE outbox SET refused_since = now() - interval '23 hours', available_at = now() WHERE kind = 'dm.filed'");
    discord.fail(discordError(403, 50001, 'Missing Access'));
    await d.runOnce();
    const [row] = (await pool.query("SELECT now() - refused_since > interval '22 hours' AS old, result FROM outbox WHERE kind = 'dm.filed'")).rows;
    expect(row).toEqual({ old: true, result: null });
  });

  it('a reminder re-armed after a refusal starts afresh, and holds nothing up', async () => {
    const { judge, subject } = await people();
    const filed = await file(judge, subject);
    // Once refused, later sent.
    await pool.query("UPDATE outbox SET processed_at = now(), result = 'sent', refused_since = now() - interval '1 hour' WHERE kind = 'dm.deadline'");
    await env.DB.prepare("UPDATE records SET deadline_at = datetime(deadline_at, '+3 hours') WHERE id = ?").bind(filed.id).run();
    const [row] = (await pool.query("SELECT refused_since, processed_at FROM outbox WHERE kind = 'dm.deadline'")).rows;
    expect(row).toEqual({ refused_since: null, processed_at: null });
    await file(judge, subject, 'late_major');
    await pool.query("UPDATE outbox SET available_at = now() WHERE kind = 'dm.filed'");
    const discord = fakeDiscord();
    await dispatcher(discord.api).runOnce();
    expect(discord.sent.filter((m) => text(m.message).includes('有人给你立案了'))).toHaveLength(2);
  });

  it('a DM this version cannot handle does not hold up the ones it can', async () => {
    const { judge, subject } = await people();
    await pool.query(
      "INSERT INTO outbox (kind, entity, entity_id, dedupe_key, payload) VALUES ('dm.from.the.future', 'user', 'subject', 'future:1', '{}')",
    );
    const discord = fakeDiscord();
    const d = dispatcher(discord.api);
    await d.runOnce();
    await file(judge, subject);
    await pool.query("UPDATE outbox SET available_at = now() WHERE kind = 'dm.filed'");
    await d.runOnce();
    expect(discord.sent.some((m) => text(m.message).includes('有人给你立案了'))).toBe(true);
  });

  it('a DM nobody can handle is given up a day after it was written', async () => {
    await people();
    await pool.query(
      `INSERT INTO outbox (kind, entity, entity_id, dedupe_key, payload, created_at)
       VALUES ('dm.from.the.future', 'user', 'subject', 'future:1', '{}', now() - interval '25 hours')`,
    );
    await dispatcher(fakeDiscord().api).runOnce();
    const [row] = (await pool.query("SELECT result FROM outbox WHERE kind = 'dm.from.the.future'")).rows;
    expect(row.result).toBe('dead');
  });

  it('corrections stuck on a refused channel neither pause delivery nor hold up what is new', async () => {
    const { judge, subject } = await people();
    // Five verdict posts that keep being refused (the bot lost the old channel).
    await pool.query(
      `INSERT INTO outbox (kind, entity, entity_id, dedupe_key, payload, refused_since)
       SELECT 'case.removed', 'record', g::text, 'stuck:' || g,
              jsonb_build_object('channel_id', '200000000000000009', 'message_id', (300000000000000000 + g)::text),
              now() - interval '2 hours'
         FROM generate_series(1, 5) g`,
    );
    const paused: string[] = [];
    const log = { log: () => undefined, warn: () => undefined, error: (m: string) => void paused.push(m) };
    const discord = fakeDiscord({
      onRemove: () => {
        throw discordError(403, 50001, 'Missing Access');
      },
    });
    const d = createDispatcher({ pool, db: env.DB, api: discord.api, config: { verdictChannelId: null, frontendUrl: FRONTEND }, log });
    await file(judge, subject);
    await pool.query("UPDATE outbox SET available_at = now() WHERE kind = 'dm.filed'");
    await d.runOnce();
    // Their retries again — and a second case, filed after.
    await pool.query("UPDATE outbox SET available_at = now() WHERE kind = 'case.removed'");
    await file(judge, subject, 'late_major');
    await pool.query("UPDATE outbox SET available_at = now() WHERE kind = 'dm.filed' AND processed_at IS NULL");
    await d.runOnce();
    expect(discord.sent.filter((m) => text(m.message).includes('有人给你立案了'))).toHaveLength(2);
    expect(paused.filter((m) => m.includes('paused'))).toEqual([]);
    const stuck = (await pool.query("SELECT COUNT(*)::int AS n FROM outbox WHERE kind = 'case.removed' AND processed_at IS NULL")).rows[0].n;
    expect(stuck).toBe(5);
  });
});

