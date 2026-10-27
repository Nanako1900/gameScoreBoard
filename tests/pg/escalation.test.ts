// P8: the AI's escalation hint in Discord — the DM to the filing judge, its
// buttons, its rewrite once settled (0006_p8.sql, escalation-delivery.ts,
// discord/escalation.ts) — and the subject's DMs rewritten when the charge
// changes. Discord is a fake ChannelApi.

import { describe, expect, it } from 'vitest';
import { adminUpdateUser } from '../../worker/db';
import {
  confirmEscalation,
  dismissEscalation,
  fileCase,
  reclassifyCase,
  submitStatement,
  sweepDueCases,
  withdrawCase,
} from '../../worker/cases';
import { importD1 } from '../../server/src/import-d1';
import { linkAccounts } from '../../server/src/discord/links';
import { handleEscalationButton } from '../../server/src/discord/escalation';
import { createDispatcher, ESCALATION_DM_BUDGET, type ChannelApi } from '../../server/src/outbox/dispatcher';
import type { ChannelMessage } from '../../server/src/discord/verdict';
import type { User } from '../../worker/types';
import { expireDeadline, noAiEnv, OFFSET_HOURS, seedUser } from '../worker/helpers';
import { env, pool } from './cloudflare-test';

const OPTS = { offsetHours: OFFSET_HOURS };
const FRONTEND = 'https://score.example';
const ctx = { db: env.DB, appUrl: 'https://api.example', frontendUrl: FRONTEND };
const JUDGE_DC = { id: '410000000000000001', username: 'judge_dc' };
const SUBJECT_DC = { id: '410000000000000002', username: 'subject_dc' };
const OTHER_DC = { id: '410000000000000003', username: 'other_dc' };
const ADMIN_DC = { id: '410000000000000004', username: 'admin_dc' };
const quiet = { log: () => undefined, warn: () => undefined, error: () => undefined };
const text = (m: unknown) => JSON.stringify(m);

function fakeDiscord() {
  const sent: Array<{ channelId: string; message: ChannelMessage }> = [];
  const edits: Array<{ channelId: string; messageId: string; message: ChannelMessage }> = [];
  let next = 0;
  const api: ChannelApi = {
    async send(channelId, message) {
      sent.push({ channelId, message });
      next += 1;
      return { id: `94000000000000${String(next).padStart(4, '0')}` };
    },
    async edit(channelId, messageId, message) {
      edits.push({ channelId, messageId, message });
    },
    async remove() {},
    async openDm(id) {
      return `dm-${id}`;
    },
  };
  return { api, sent, edits };
}

function dispatcher(api: ChannelApi) {
  return createDispatcher({ pool, db: env.DB, api, config: { verdictChannelId: null, frontendUrl: FRONTEND }, log: quiet });
}

async function bind(userId: string, who: { id: string; username: string }): Promise<void> {
  await linkAccounts(env.DB, { userId, discordUserId: who.id, discordUsername: who.username, replace: false, via: 'web' });
}

async function cast(): Promise<{ judge: User; subject: User; other: User; admin: User }> {
  const judge = await seedUser({ id: 'judge', judge: true });
  const subject = await seedUser({ id: 'subject', username: '被告' });
  const other = await seedUser({ id: 'other', judge: true });
  const admin = await seedUser({ id: 'admin', admin: true });
  await bind('judge', JUDGE_DC);
  await bind('subject', SUBJECT_DC);
  await bind('other', OTHER_DC);
  await bind('admin', ADMIN_DC);
  return { judge, subject, other, admin };
}

/** A case the AI flagged for 团灭级 (set by hand: AI is off in tests). */
async function flagged(judge: User, subject: User, claim = '说好八点五排，结果八点全队等他一个，散了') {
  const filed = await fileCase(env.DB, judge, { subject_id: subject.id, type: 'no_show', claim }, OPTS, noAiEnv());
  await env.DB.prepare('UPDATE records SET escalation_suggested = 1 WHERE id = ?').bind(filed.id).run();
  return filed;
}

async function escalationEvents() {
  return (
    await pool.query(
      "SELECT kind, entity_id, result, last_error FROM outbox WHERE kind LIKE 'dm.escalation%' ORDER BY id",
    )
  ).rows;
}

const dueNow = () => pool.query('UPDATE outbox SET available_at = now() WHERE processed_at IS NULL');

describe('escalation events', () => {
  it('a flagged case asks the filing judge at once; an unflagged one asks nobody', async () => {
    const { judge, subject } = await cast();
    await fileCase(env.DB, judge, { subject_id: subject.id, type: 'late_minor', claim: '迟到了十分钟没打招呼' }, OPTS, noAiEnv());
    expect(await escalationEvents()).toEqual([]);
    await flagged(judge, subject);
    const rows = (await pool.query("SELECT kind, entity_id, available_at <= now() AS due FROM outbox WHERE kind = 'dm.escalation'")).rows;
    expect(rows).toEqual([{ kind: 'dm.escalation', entity_id: 'judge', due: true }]);
  });

  it.each(['confirm', 'dismiss', 'reclassify', 'withdraw', 'statement', 'deadline'] as const)
  ('settling by %s closes escalation exactly once', async (action) => {
    const { judge, subject, admin } = await cast();
    // Each transition gets an isolated case, within the ordinary filing caps.
    const settle: Record<typeof action, (id: number) => Promise<unknown>> = {
      confirm: (id) => confirmEscalation(env.DB, judge, id),
      dismiss: (id) => dismissEscalation(env.DB, judge, id),
      reclassify: (id) => reclassifyCase(env.DB, judge, id, 'late_major'),
      withdraw: (id) => withdrawCase(env.DB, judge, id),
      statement: (id) => submitStatement(env.DB, subject, id, '临时加班实在走不开', noAiEnv()),
      deadline: async (id) => {
        await expireDeadline(id);
        await sweepDueCases(env.DB, noAiEnv());
      },
    };
    const filed = await flagged(judge, subject);
    await settle[action](filed.id);
    // A second settling (an admin's override after a verdict, say) adds nothing.
    await dismissEscalation(env.DB, admin, filed.id).catch(() => undefined);
    expect((await escalationEvents()).map((event) => event.kind)).toEqual(['dm.escalation', 'dm.escalation.closed']);
  });

  it('the D1 import asks nobody', async () => {
    const T = '2026-10-20 12:00:00';
    await importD1(pool, {
      users: [
        { id: 'j', username: 'j', is_participant: 1, is_judge: 1, is_admin: 0, score: 100, created_at: T, updated_at: T },
        { id: 's', username: 's', is_participant: 1, is_judge: 0, is_admin: 0, score: 100, created_at: T, updated_at: T },
      ],
      records: [
        {
          id: 1, subject_id: 's', reporter_id: 'j', type: 'no_show', delta: 0, claim: '没来', status: 'awaiting_statement',
          escalation_suggested: 1, deadline_at: '2099-01-01 00:00:00', created_at: T,
        },
      ],
    });
    expect(await escalationEvents()).toEqual([]);
  });
});

describe('the escalation DM', () => {
  it('asks the judge, with the two choices and the case’s page — the accusation made harmless', async () => {
    const { judge, subject } = await cast();
    const filed = await flagged(judge, subject, '八点没来 [点我](https://evil.example) @everyone');
    const discord = fakeDiscord();
    await dispatcher(discord.api).runOnce();
    const toJudge = discord.sent.filter((s) => s.channelId === `dm-${JUDGE_DC.id}`);
    expect(toJudge).toHaveLength(1);
    const dm = toJudge[0].message;
    expect(dm.allowed_mentions).toEqual({ parse: [] });
    expect(text(dm.components)).toContain(`v1:esc:${filed.id}:ok`);
    expect(text(dm.components)).toContain(`v1:esc:${filed.id}:no`);
    expect(text(dm.components)).toContain(`https://score.example/?case=${filed.id}`);
    expect(text(dm.embeds)).not.toContain('](https://evil');
    expect(text(dm.embeds)).not.toMatch(/@everyone/);
    expect(discord.sent.filter((s) => s.channelId === `dm-${SUBJECT_DC.id}` && text(s.message).includes('升级'))).toEqual([]);
    expect((await pool.query("SELECT 1 FROM discord_messages WHERE purpose = 'dm:esc'")).rowCount).toBe(1);
  });

  it('is not sent once it no longer applies: settled first, judge stepped down', async () => {
    const { judge, subject } = await cast();
    const d = dispatcher(fakeDiscord().api);
    const first = await flagged(judge, subject);
    await dismissEscalation(env.DB, judge, first.id);
    await d.runOnce();
    await flagged(judge, subject);
    await env.DB.prepare("UPDATE users SET is_judge = 0 WHERE id = 'judge'").run();
    await d.runOnce();
    expect((await escalationEvents()).filter((e) => e.kind === 'dm.escalation').map((e) => e.last_error)).toEqual([
      'no longer true',
      'no longer a judge',
    ]);
  });

  it(`has its own daily allowance (${ESCALATION_DM_BUDGET}), apart from the judge’s statement reminders`, async () => {
    const { judge, subject } = await cast();
    // Test the dispatcher's allowance without bypassing the API's filing cap.
    for (let i = 0; i < ESCALATION_DM_BUDGET + 1; i += 1) {
      await env.DB.prepare(
        `INSERT INTO records (subject_id, reporter_id, type, claim, escalation_suggested, deadline_at, status)
         VALUES (?, ?, 'no_show', '说好八点五排，结果全队等他一个', 1, datetime('now', '+1 day'), 'awaiting_statement')`,
      ).bind(subject.id, judge.id).run();
    }
    // The judge is also accused of something today.
    await fileCase(env.DB, await seedUser({ id: 'j2', judge: true }), { subject_id: 'judge', type: 'late_minor', claim: '开会迟到了一刻钟也没说一声' }, OPTS, noAiEnv());
    await dueNow();
    const discord = fakeDiscord();
    await dispatcher(discord.api).runOnce();
    const toJudge = discord.sent.filter((s) => s.channelId === `dm-${JUDGE_DC.id}`).map((s) => text(s.message));
    expect(toJudge.filter((t) => t.includes('建议升级'))).toHaveLength(ESCALATION_DM_BUDGET);
    expect(toJudge.some((t) => t.includes('有人给你立案了'))).toBe(true);
  });

  it('loses its buttons once settled — an edit, never a new DM, even with DMs off', async () => {
    const { judge, subject } = await cast();
    const filed = await flagged(judge, subject);
    const discord = fakeDiscord();
    const d = dispatcher(discord.api);
    await d.runOnce();
    const before = discord.sent.length;
    await pool.query("UPDATE discord_links SET notify_dm = 0 WHERE user_id = 'judge'");
    await confirmEscalation(env.DB, judge, filed.id);
    await d.runOnce();
    expect(discord.sent.filter((s) => s.channelId === `dm-${JUDGE_DC.id}`)).toHaveLength(1);
    expect(discord.sent).toHaveLength(before);
    const edit = discord.edits.find((e) => e.channelId === `dm-${JUDGE_DC.id}`);
    expect(edit?.message.components).toEqual([]);
    expect(text(edit?.message)).toContain('已升级');
  });

  it('is rewritten when the case is deleted — for the judge it went to', async () => {
    const { judge, subject } = await cast();
    await flagged(judge, subject);
    const discord = fakeDiscord();
    const d = dispatcher(discord.api);
    await d.runOnce();
    await adminUpdateUser(env.DB, 'subject', { delete: true });
    const removed = (await pool.query("SELECT entity_id, payload->>'purpose' AS purpose FROM outbox WHERE kind = 'dm.removed'")).rows;
    expect(removed).toContainEqual({ entity_id: 'judge', purpose: 'dm:esc' });
    await d.runOnce();
    expect(discord.edits.some((e) => e.channelId === `dm-${JUDGE_DC.id}` && text(e.message).includes('已删除'))).toBe(true);
  });
});

describe('the escalation buttons', () => {
  it('confirm or keep, by the judge who filed it, through the same rules as the web', async () => {
    const { judge, subject } = await cast();
    const yes = await flagged(judge, subject);
    expect((await handleEscalationButton(yes.id, 'ok', JUDGE_DC, ctx)).content).toContain('已确认');
    const row = await env.DB.prepare('SELECT type, escalation_suggested FROM records WHERE id = ?').bind(yes.id).first();
    expect(row).toEqual({ type: 'no_show_group', escalation_suggested: 0 });
    // Pressed again: the domain's own answer, no throw.
    expect((await handleEscalationButton(yes.id, 'ok', JUDGE_DC, ctx)).content).toContain('没有待确认的升级');
    const no = await flagged(judge, subject);
    expect((await handleEscalationButton(no.id, 'no', JUDGE_DC, ctx)).content).toContain('维持原案由');
    expect((await env.DB.prepare('SELECT type FROM records WHERE id = ?').bind(no.id).first())?.type).toBe('no_show');
  });

  it('are refused to anyone else, and when they no longer apply', async () => {
    const { judge, subject } = await cast();
    const filed = await flagged(judge, subject);
    for (const who of [OTHER_DC, SUBJECT_DC, ADMIN_DC]) {
      expect((await handleEscalationButton(filed.id, 'ok', who, ctx)).content).toContain('只有立案的裁判');
    }
    expect((await handleEscalationButton(filed.id, 'ok', { id: '499999999999999999', username: 'x' }, ctx)).content).toContain('/link');
    expect((await handleEscalationButton(filed.id, 'ok', JUDGE_DC, { ...ctx, readOnly: true })).content).toContain('只读');
    await env.DB.prepare("UPDATE users SET is_judge = 0 WHERE id = 'judge'").run();
    expect((await handleEscalationButton(filed.id, 'ok', JUDGE_DC, ctx)).content).toContain('立案的裁判或管理员');
    await env.DB.prepare("UPDATE users SET is_judge = 1 WHERE id = 'judge'").run();
    await submitStatement(env.DB, subject, filed.id, '临时加班实在走不开', noAiEnv());
    expect((await handleEscalationButton(filed.id, 'no', JUDGE_DC, ctx)).content).toContain('已进入裁决');
  });
});

describe('a new charge before the verdict', () => {
  it('rewrites the subject’s filing DM in place — still with 写陈述, no new DM', async () => {
    const { judge, subject } = await cast();
    const filed = await flagged(judge, subject);
    await dueNow();
    const discord = fakeDiscord();
    const d = dispatcher(discord.api);
    await d.runOnce();
    const sentBefore = discord.sent.filter((s) => s.channelId === `dm-${SUBJECT_DC.id}`).length;
    await confirmEscalation(env.DB, judge, filed.id);
    await dueNow();
    await d.runOnce();
    expect(discord.sent.filter((s) => s.channelId === `dm-${SUBJECT_DC.id}`)).toHaveLength(sentBefore);
    const rewritten = discord.edits.filter((e) => e.channelId === `dm-${SUBJECT_DC.id}`);
    expect(rewritten.length).toBeGreaterThan(0);
    expect(text(rewritten[0].message)).toContain('团灭级');
    expect(text(rewritten[0].message.components)).toContain(`v1:stmt:${filed.id}`);
  });
});
