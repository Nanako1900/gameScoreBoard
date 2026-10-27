// P8, the edges: paths of the escalation DM, the recharge rewrite, the report
// post, the score DM and the bot's links that the main suites do not reach —
// gathered from the adversarial review (each one fails if its rule is undone).

import { describe, expect, it } from 'vitest';
import { confirmEscalation, dismissEscalation, fileCase, reclassifyCase, submitStatement } from '../../worker/cases';
import { adminUpdateUser } from '../../worker/db';
import { ensureWeeklyReport, previousWeekStart } from '../../worker/report';
import { linkAccounts } from '../../server/src/discord/links';
import { handleVerdictButton } from '../../server/src/discord/verdict';
import { handleCommand } from '../../server/src/discord/commands';
import { createDispatcher, type ChannelApi } from '../../server/src/outbox/dispatcher';
import type { ChannelMessage } from '../../server/src/discord/verdict';
import type { User } from '../../worker/types';
import { expireDeadline, inThisWeek, noAiEnv, OFFSET_HOURS, seedUser } from '../worker/helpers';
import { env, pool } from './cloudflare-test';

const OPTS = { offsetHours: OFFSET_HOURS };
const FRONTEND = 'https://score.example';
const CHANNEL = '200000000000000009';
const ctx = { db: env.DB, appUrl: 'https://api.example', frontendUrl: FRONTEND, offsetHours: OFFSET_HOURS };
const JUDGE_DC = { id: '470000000000000001', username: 'judge_dc' };
const SUBJECT_DC = { id: '470000000000000002', username: 'subject_dc' };
const quiet = { log: () => undefined, warn: () => undefined, error: () => undefined };
const text = (m: unknown) => JSON.stringify(m);

/** Discord, with a hook to fail an edit in one channel. */
function fakeDiscord(failEditIn?: (channelId: string) => unknown) {
  const sent: Array<{ channelId: string; message: ChannelMessage & { nonce?: string; enforce_nonce?: boolean } }> = [];
  const edits: Array<{ channelId: string; messageId: string; message: ChannelMessage }> = [];
  const editFailures: unknown[] = [];
  const api: ChannelApi = {
    async send(channelId, message) {
      sent.push({ channelId, message });
      return { id: `97000000000000${String(sent.length).padStart(4, '0')}` };
    },
    async edit(channelId, messageId, message) {
      const failure = failEditIn?.(channelId) ?? (editFailures.length > 0 ? editFailures.shift() : undefined);
      if (failure) throw failure;
      edits.push({ channelId, messageId, message });
    },
    async remove() {},
    async openDm(id) {
      return `dm-${id}`;
    },
  };
  return { api, sent, edits, failEdit: (e: unknown) => editFailures.push(e) };
}

const dispatcher = (api: ChannelApi, verdictChannelId: string | null = null) =>
  createDispatcher({ pool, db: env.DB, api, config: { verdictChannelId, frontendUrl: FRONTEND, offsetHours: OFFSET_HOURS }, log: quiet });
async function bind(userId: string, who: { id: string; username: string }): Promise<void> {
  await linkAccounts(env.DB, { userId, discordUserId: who.id, discordUsername: who.username, replace: false, via: 'web' });
  // This suite exercises case DMs; automatic welcomes have their own suite.
  await pool.query("DELETE FROM outbox WHERE kind = 'dm.welcome' AND entity_id = $1", [userId]);
}
const dueNow = () => pool.query('UPDATE outbox SET available_at = now() WHERE processed_at IS NULL');

async function cast(): Promise<{ judge: User; subject: User }> {
  const judge = await seedUser({ id: 'judge', judge: true });
  const subject = await seedUser({ id: 'subject', username: '被告' });
  await bind('judge', JUDGE_DC);
  await bind('subject', SUBJECT_DC);
  return { judge, subject };
}

async function flagged(judge: User, subject: User) {
  const filed = await fileCase(env.DB, judge, { subject_id: subject.id, type: 'no_show', claim: '说好八点五排，结果八点全队等他一个，散了' }, OPTS, noAiEnv());
  await env.DB.prepare('UPDATE records SET escalation_suggested = 1 WHERE id = ?').bind(filed.id).run();
  return filed;
}

/** Hold a row lock, queue each contender behind it, then let go (as in concurrency.test.ts). */
async function queuedBehind<T>(lockSql: string, params: unknown[], contenders: Array<() => Promise<T>>) {
  const holder = await pool.connect();
  try {
    await holder.query('BEGIN');
    await holder.query(lockSql, params);
    const started: Promise<T>[] = [];
    for (const run of contenders) {
      const p = run();
      p.catch(() => undefined);
      started.push(p);
      const until = Date.now() + 5_000;
      for (;;) {
        const waiting = await pool.query(
          "SELECT COUNT(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
        );
        if (waiting.rows[0].n >= started.length) break;
        if (Date.now() > until) throw new Error('no lock waiter');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    await holder.query('COMMIT');
    return await Promise.allSettled(started);
  } finally {
    holder.release();
  }
}

describe('the escalation DM, at its edges', () => {
  it('a case the classifier flagged when it was filed (the INSERT itself) asks the judge', async () => {
    await cast();
    await env.DB.prepare(
      `INSERT INTO records (subject_id, reporter_id, type, delta, claim, classified_by, escalation_suggested, deadline_at, status)
       VALUES ('subject', 'judge', 'no_show', 0, '说好八点五排结果全队等他', 'ai', 1, datetime('now', '+12 hours'), 'awaiting_statement')`,
    ).run();
    expect((await pool.query("SELECT entity_id FROM outbox WHERE kind = 'dm.escalation'")).rows).toEqual([{ entity_id: 'judge' }]);
  });

  it('is not sent once the statement window has closed', async () => {
    const { judge, subject } = await cast();
    const filed = await flagged(judge, subject);
    await expireDeadline(filed.id);
    await dispatcher(fakeDiscord().api).runOnce();
    const [row] = (await pool.query("SELECT last_error FROM outbox WHERE kind = 'dm.escalation'")).rows;
    expect(row.last_error).toBe('the statement window has closed');
  });

  it('is not sent to someone it is no longer for (the case changed hands)', async () => {
    const { judge, subject } = await cast();
    const filed = await flagged(judge, subject);
    await seedUser({ id: 'j2', judge: true });
    await env.DB.prepare("UPDATE records SET reporter_id = 'j2' WHERE id = ?").bind(filed.id).run();
    await dispatcher(fakeDiscord().api).runOnce();
    const [row] = (await pool.query("SELECT last_error FROM outbox WHERE kind = 'dm.escalation'")).rows;
    expect(row.last_error).toBe('not for this recipient any more');
  });

  it('once settled says what was actually done, as of then', async () => {
    const { judge, subject } = await cast();
    const discord = fakeDiscord();
    const d = dispatcher(discord.api);
    // Re-typed to something else: not "kept".
    const retyped = await flagged(judge, subject);
    await d.runOnce();
    await reclassifyCase(env.DB, judge, retyped.id, 'late_major');
    await d.runOnce();
    // Dismissed, and then the statement lands before the rewrite goes out.
    const kept = await flagged(judge, subject);
    await d.runOnce();
    await dismissEscalation(env.DB, judge, kept.id);
    await submitStatement(env.DB, subject, kept.id, '临时加班实在走不开', noAiEnv());
    await d.runOnce();
    const closed = discord.edits.filter((e) => e.channelId === `dm-${JUDGE_DC.id}`).map((e) => text(e.message));
    expect(closed[0]).toContain('案由改成了');
    expect(closed[0]).toContain('大迟到');
    expect(closed[1]).toContain('维持原案由');
  });

  it('a closing rewrite of a DM deleted in Discord is skipped, not "sent"', async () => {
    const { judge, subject } = await cast();
    const filed = await flagged(judge, subject);
    const discord = fakeDiscord();
    const d = dispatcher(discord.api);
    await d.runOnce();
    discord.failEdit(Object.assign(new Error('Unknown Message'), { status: 404, code: 10008 }));
    await dismissEscalation(env.DB, judge, filed.id);
    await d.runOnce();
    const [row] = (await pool.query("SELECT result, last_error FROM outbox WHERE kind = 'dm.escalation.closed'")).rows;
    expect(row).toEqual({ result: 'skipped', last_error: 'the escalation DM is gone' });
  });

  it('a closing rewrite for a case deleted meanwhile is skipped quietly', async () => {
    const { judge, subject } = await cast();
    const filed = await flagged(judge, subject);
    await dispatcher(fakeDiscord().api).runOnce();
    await dismissEscalation(env.DB, judge, filed.id);
    await env.DB.prepare('DELETE FROM records WHERE id = ?').bind(filed.id).run();
    await dispatcher(fakeDiscord().api).runOnce();
    const [row] = (await pool.query("SELECT result, last_error FROM outbox WHERE kind = 'dm.escalation.closed'")).rows;
    expect(row).toEqual({ result: 'skipped', last_error: 'record is gone' });
  });
});

describe('dismissing an escalation, raced', () => {
  it('two at once: one wins, the other gets 409', async () => {
    const { judge, subject } = await cast();
    const filed = await flagged(judge, subject);
    const settled = await queuedBehind('UPDATE records SET status = status WHERE id = $1', [filed.id], [
      () => dismissEscalation(env.DB, judge, filed.id),
      () => dismissEscalation(env.DB, judge, filed.id),
    ]);
    expect(settled[0].status).toBe('fulfilled');
    expect(settled[1]).toMatchObject({ status: 'rejected', reason: { status: 409 } });
  });

  it('against the case going to judgment: 409, and the case is left as it is', async () => {
    const { judge, subject } = await cast();
    const filed = await flagged(judge, subject);
    const settled = await queuedBehind<unknown>('UPDATE records SET status = status WHERE id = $1', [filed.id], [
      () => env.DB.prepare("UPDATE records SET status = 'judging' WHERE id = ?").bind(filed.id).run(),
      () => dismissEscalation(env.DB, judge, filed.id),
    ]);
    expect(settled[1]).toMatchObject({ status: 'rejected', reason: { status: 409 } });
    expect(await env.DB.prepare('SELECT escalation_suggested FROM records WHERE id = ?').bind(filed.id).first()).toEqual({
      escalation_suggested: 1,
    });
  });
});

describe('the recharge rewrite, at its edges', () => {
  it('rewrites the deadline reminder as well as the filing DM', async () => {
    const { judge, subject } = await cast();
    const filed = await flagged(judge, subject);
    await dueNow();
    const discord = fakeDiscord();
    const d = dispatcher(discord.api);
    await d.runOnce();
    await confirmEscalation(env.DB, judge, filed.id);
    await dueNow();
    await d.runOnce();
    const rewritten = discord.edits.filter((e) => e.channelId === `dm-${SUBJECT_DC.id}`).map((e) => text(e.message));
    expect(rewritten.filter((t) => t.includes('团灭级'))).toHaveLength(2);
    expect(rewritten.some((t) => t.includes('陈述快截止了'))).toBe(true);
    expect(rewritten.some((t) => t.includes('有人给你立案了'))).toBe(true);
  });

  it('does not put a 写陈述 button back on a case that went to judgment meanwhile', async () => {
    const { judge, subject } = await cast();
    const filed = await flagged(judge, subject);
    await dueNow();
    const d = dispatcher(fakeDiscord().api);
    await d.runOnce();
    await confirmEscalation(env.DB, judge, filed.id);
    await submitStatement(env.DB, subject, filed.id, '临时加班实在走不开', noAiEnv());
    await dueNow();
    await d.runOnce();
    const [row] = (await pool.query("SELECT result, last_error FROM outbox WHERE kind = 'dm.recharged'")).rows;
    expect(row).toEqual({ result: 'skipped', last_error: 'no longer true' });
  });

  it('a subject whose DMs are now closed is marked, nobody else', async () => {
    const { judge, subject } = await cast();
    const filed = await flagged(judge, subject);
    await dueNow();
    const closed = Object.assign(new Error('Cannot send messages to this user'), { status: 403, code: 50007 });
    const discord = fakeDiscord((channelId) => (channelId === `dm-${SUBJECT_DC.id}` ? closed : undefined));
    const d = dispatcher(discord.api);
    await d.runOnce();
    await confirmEscalation(env.DB, judge, filed.id);
    await dueNow();
    await d.runOnce();
    const links = (await pool.query('SELECT user_id, dm_ok FROM discord_links ORDER BY user_id')).rows;
    expect(links).toEqual([
      { user_id: 'judge', dm_ok: 1 },
      { user_id: 'subject', dm_ok: 0 },
    ]);
  });
});

describe('links in the bot’s replies', () => {
  it('看判词 links to the case', async () => {
    await cast();
    await env.DB.prepare(
      `INSERT INTO records (subject_id, reporter_id, type, delta, claim, status, verdict_source, verdict_headline, verdict_reason)
       VALUES ('subject', 'judge', 'no_show', -15, '没来', 'decided', 'ai', '判了', '理由')`,
    ).run();
    const id = Number((await env.DB.prepare('SELECT id FROM records').first<{ id: number }>())?.id);
    expect((await handleVerdictButton(id, JUDGE_DC, ctx)).buttons?.[0].url).toBe(`${FRONTEND}/?case=${id}`);
  });

  it('/todo counts every appeal and lists the ten that have waited longest', async () => {
    await seedUser({ id: 'admin', admin: true });
    await bind('admin', JUDGE_DC);
    await seedUser({ id: 's', username: '被告' });
    await seedUser({ id: 'j', judge: true });
    for (let i = 0; i < 12; i += 1) {
      await env.DB.prepare(
        `INSERT INTO records (subject_id, reporter_id, type, delta, claim, status, appeal_reason, created_at)
         VALUES ('s', 'j', 'no_show', -15, '没来', 'appealed', '不服', datetime('now', ?))`,
      )
        .bind(`-${12 - i} hours`)
        .run();
    }
    const ids = (await env.DB.prepare('SELECT id FROM records ORDER BY created_at ASC').all<{ id: number }>()).results.map((r) => r.id);
    const reply = await handleCommand({ commandName: 'todo', caller: JUDGE_DC, targetUser: null }, ctx);
    const field = (reply.embeds?.[0].fields ?? []).find((f) => f.name.startsWith('待复核的申诉'));
    expect(field?.name).toBe('待复核的申诉（12）');
    const listed = [...(field?.value ?? '').matchAll(/\?case=(\d+)/g)].map((m) => Number(m[1]));
    expect(listed).toEqual(ids.slice(0, 10));
  });
});

describe('the report post, at its edges', () => {
  async function lastWeek(): Promise<string> {
    await seedUser({ id: 'judge', judge: true });
    await seedUser({ id: 'a', username: '阿强' });
    const week = previousWeekStart(OFFSET_HOURS);
    const at = new Date(Date.parse(`${week}T00:00:00Z`) - OFFSET_HOURS * 3_600_000 + 36 * 3_600_000).toISOString().replace('T', ' ').slice(0, 19);
    await env.DB.prepare(
      `INSERT INTO records (subject_id, reporter_id, type, delta, claim, status, verdict_source, created_at)
       VALUES ('a', 'judge', 'no_show', -15, '没来', 'decided', 'ai', ?)`,
    )
      .bind(at)
      .run();
    await env.DB.prepare("INSERT INTO score_events (user_id, delta, reason, resulting_score, created_at) VALUES ('a', -15, 'record:1', 85, ?)")
      .bind(at)
      .run();
    await ensureWeeklyReport(env.DB, noAiEnv(), OFFSET_HOURS, inThisWeek(2 * 24 + 12));
    return week;
  }

  it('is sent with its row’s own nonce', async () => {
    await lastWeek();
    await dueNow();
    const discord = fakeDiscord();
    await dispatcher(discord.api, CHANNEL).runOnce();
    const [row] = (await pool.query("SELECT id FROM outbox WHERE kind = 'report.ready'")).rows;
    expect(discord.sent[0].message.nonce).toMatch(new RegExp(`^ob${row.id}\\.`));
    expect(discord.sent[0].message.enforce_nonce).toBe(true);
  });

  it('an edit that fails for another reason is retried, and the post kept', async () => {
    const week = await lastWeek();
    await dueNow();
    const discord = fakeDiscord();
    const d = dispatcher(discord.api, CHANNEL);
    await d.runOnce();
    discord.failEdit(Object.assign(new Error('Internal Server Error'), { status: 500 }));
    await env.DB.prepare("UPDATE weekly_reports SET narrative = '改了' WHERE week_start = ?").bind(week).run();
    await dueNow();
    await d.runOnce();
    const [row] = (await pool.query("SELECT processed_at IS NULL AS pending FROM outbox WHERE kind = 'report.updated'")).rows;
    expect(row.pending).toBe(true);
    expect((await pool.query("SELECT 1 FROM discord_messages WHERE entity = 'report'")).rowCount).toBe(1);
  });

  it('a post lost before it was recorded (the bot died) is posted when its event comes round again', async () => {
    await lastWeek();
    await dueNow();
    const discord = fakeDiscord();
    await dispatcher(discord.api, CHANNEL).runOnce();
    await pool.query("DELETE FROM discord_messages WHERE entity = 'report'");
    await pool.query(
      "UPDATE outbox SET processed_at = NULL, result = NULL, available_at = now(), claimed_at = now() - interval '10 minutes' WHERE kind = 'report.ready'",
    );
    await dispatcher(discord.api, CHANNEL).runOnce();
    expect(discord.sent).toHaveLength(2);
    expect(discord.sent[1].message.nonce).toBe(discord.sent[0].message.nonce);
  });
});

describe('the score DM, at its edges', () => {
  it('a payload without its numbers is skipped, never sent as NaN', async () => {
    await seedUser({ id: 'p', score: 70 });
    await bind('p', SUBJECT_DC);
    await adminUpdateUser(env.DB, 'p', { score: 60 });
    await pool.query("UPDATE outbox SET payload = payload - 'delta' WHERE kind = 'dm.score.adjusted'");
    const discord = fakeDiscord();
    await dispatcher(discord.api).runOnce();
    expect(discord.sent).toEqual([]);
    const [row] = (await pool.query("SELECT last_error FROM outbox WHERE kind = 'dm.score.adjusted'")).rows;
    expect(row.last_error).toBe('no score change in the payload');
  });
});
