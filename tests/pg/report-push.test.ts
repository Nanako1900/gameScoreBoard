// P8: the weekly report in the verdict channel — the events (0006_p8.sql) and
// their delivery (report-delivery.ts). Discord is a fake ChannelApi.

import { describe, expect, it } from 'vitest';
import { ensureWeeklyReport, previousWeekStart, regenerateReport } from '../../worker/report';
import { importD1 } from '../../server/src/import-d1';
import { createDispatcher, type ChannelApi } from '../../server/src/outbox/dispatcher';
import type { ChannelMessage } from '../../server/src/discord/verdict';
import { inThisWeek, noAiEnv, OFFSET_HOURS, seedUser } from '../worker/helpers';
import { env, pool } from './cloudflare-test';

const CHANNEL = '200000000000000009';
const FRONTEND = 'https://score.example';
/** Wednesday noon this week: past the report's Monday 10:30. */
const DUE = inThisWeek(2 * 24 + 12);
const quiet = { log: () => undefined, warn: () => undefined, error: () => undefined };

function fakeDiscord() {
  const sent: Array<{ channelId: string; message: ChannelMessage & { nonce?: string; content?: string } }> = [];
  const edits: Array<{ channelId: string; messageId: string; message: ChannelMessage }> = [];
  const editFailures: unknown[] = [];
  let next = 0;
  const api: ChannelApi = {
    async send(channelId, message) {
      sent.push({ channelId, message });
      next += 1;
      return { id: `93000000000000${String(next).padStart(4, '0')}` };
    },
    async edit(channelId, messageId, message) {
      if (editFailures.length > 0) throw editFailures.shift();
      edits.push({ channelId, messageId, message });
    },
    async remove() {},
    async openDm(id) {
      return `dm-${id}`;
    },
  };
  return { api, sent, edits, failEdit: (e: unknown) => editFailures.push(e) };
}

function dispatcher(api: ChannelApi, verdictChannelId: string | null = CHANNEL) {
  return createDispatcher({
    pool,
    db: env.DB,
    api,
    config: { verdictChannelId, frontendUrl: FRONTEND, offsetHours: OFFSET_HOURS },
    log: quiet,
  });
}

/** A case decided last week, so last week has a report to write. */
async function lastWeekActivity(): Promise<void> {
  await seedUser({ id: 'judge', judge: true });
  await seedUser({ id: 'a', username: '阿强' });
  const week = previousWeekStart(OFFSET_HOURS);
  const at = new Date(Date.parse(`${week}T00:00:00Z`) - OFFSET_HOURS * 3_600_000 + 86_400_000 + 12 * 3_600_000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);
  await env.DB.prepare(
    `INSERT INTO records (subject_id, reporter_id, type, delta, claim, status, verdict_source, created_at)
     VALUES ('a', 'judge', 'no_show', -15, '没来', 'decided', 'ai', ?)`,
  )
    .bind(at)
    .run();
  await env.DB.prepare(
    "INSERT INTO score_events (user_id, delta, reason, resulting_score, created_at) VALUES ('a', -15, 'record:1', 85, ?)",
  )
    .bind(at)
    .run();
}

async function reportEvents() {
  return (
    await pool.query(
      `SELECT kind, entity_id, result, last_error, round(extract(epoch FROM available_at - now())) AS in_seconds
         FROM outbox WHERE entity = 'report' ORDER BY id`,
    )
  ).rows;
}

const due = () => pool.query("UPDATE outbox SET available_at = now() WHERE entity = 'report' AND processed_at IS NULL");
const text = (m: unknown) => JSON.stringify(m);

describe('weekly report events', () => {
  it('a new report: one report.ready a minute out', async () => {
    await lastWeekActivity();
    await ensureWeeklyReport(env.DB, noAiEnv(), OFFSET_HOURS, DUE);
    const rows = await reportEvents();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'report.ready', entity_id: previousWeekStart(OFFSET_HOURS), result: null });
    expect(Number(rows[0].in_seconds)).toBeGreaterThanOrEqual(55);
  });

  it('a burst of first visits still writes one', async () => {
    await lastWeekActivity();
    await Promise.all(Array.from({ length: 5 }, () => ensureWeeklyReport(env.DB, noAiEnv(), OFFSET_HOURS, DUE)));
    expect((await reportEvents()).map((r) => r.kind)).toEqual(['report.ready']);
  });

  it('a rewrite is one coalesced report.updated; a change to nothing shown is none', async () => {
    await lastWeekActivity();
    await ensureWeeklyReport(env.DB, noAiEnv(), OFFSET_HOURS, DUE);
    const week = previousWeekStart(OFFSET_HOURS);
    await env.DB.prepare("UPDATE weekly_reports SET created_at = datetime('now') WHERE week_start = ?").bind(week).run();
    expect((await reportEvents()).map((r) => r.kind)).toEqual(['report.ready']);
    for (let i = 0; i < 3; i += 1) {
      await env.DB.prepare("UPDATE weekly_reports SET narrative = ?, source = 'ai' WHERE week_start = ?").bind(`第${i}版`, week).run();
    }
    expect((await reportEvents()).map((r) => r.kind)).toEqual(['report.ready', 'report.updated']);
  });

  it('the D1 import emits nothing', async () => {
    const T = '2026-10-20 12:00:00';
    await importD1(pool, {
      weekly_reports: [{ week_start: '2026-10-12', stats_json: '{}', narrative: '旧周报', source: 'ai', created_at: T }],
    });
    expect(await reportEvents()).toEqual([]);
  });
});

describe('the report post', () => {
  it('is posted once, pinging nobody, with the AI’s words made harmless', async () => {
    await lastWeekActivity();
    await ensureWeeklyReport(env.DB, noAiEnv(), OFFSET_HOURS, DUE);
    const week = previousWeekStart(OFFSET_HOURS);
    await env.DB.prepare("UPDATE weekly_reports SET narrative = ?, source = 'ai' WHERE week_start = ?")
      .bind('@everyone 本周 [点我](https://evil.example) <@123456789012345678>', week)
      .run();
    const discord = fakeDiscord();
    const d = dispatcher(discord.api);
    // The AI's text lands 2 s after the template; the post is due a minute after.
    await pool.query("UPDATE outbox SET available_at = now() WHERE kind = 'report.updated'");
    await d.runOnce();
    expect(discord.sent).toEqual([]);
    await due();
    await d.runOnce();
    expect(discord.sent).toHaveLength(1);
    expect(discord.edits).toEqual([]);
    const { channelId, message } = discord.sent[0];
    expect(channelId).toBe(CHANNEL);
    expect(message.allowed_mentions).toEqual({ parse: [] });
    expect(message.content).toBeUndefined();
    expect(text(message)).toContain('周报');
    expect(text(message)).not.toContain('@everyone');
    expect(text(message)).not.toContain('](https://evil');
    expect(text(message)).not.toContain('<@123456789012345678>');
    // The rewrite before the post was skipped; the post carries the AI's text.
    expect((await reportEvents()).map((r) => [r.kind, r.result])).toEqual([
      ['report.ready', 'sent'],
      ['report.updated', 'skipped'],
    ]);
    expect(text(message)).toContain('本周');
    const stored = await pool.query("SELECT channel_id, message_id FROM discord_messages WHERE entity = 'report'");
    expect(stored.rows).toEqual([{ channel_id: CHANNEL, message_id: '930000000000000001' }]);
  });

  it('is edited, not posted again, when the report is rewritten', async () => {
    await lastWeekActivity();
    await ensureWeeklyReport(env.DB, noAiEnv(), OFFSET_HOURS, DUE);
    await due();
    const discord = fakeDiscord();
    const d = dispatcher(discord.api);
    await d.runOnce();
    await regenerateReport(env.DB, noAiEnv(), previousWeekStart(OFFSET_HOURS), OFFSET_HOURS);
    await env.DB.prepare("UPDATE weekly_reports SET narrative = '重写过的周报' WHERE week_start = ?")
      .bind(previousWeekStart(OFFSET_HOURS))
      .run();
    await due();
    await d.runOnce();
    expect(discord.sent).toHaveLength(1);
    expect(discord.edits).toHaveLength(1);
    expect(discord.edits[0].messageId).toBe('930000000000000001');
    expect(text(discord.edits[0].message)).toContain('重写过的周报');
  });

  it('a post deleted in Discord is not put back for an old week', async () => {
    await lastWeekActivity();
    await ensureWeeklyReport(env.DB, noAiEnv(), OFFSET_HOURS, DUE);
    await due();
    const discord = fakeDiscord();
    const d = dispatcher(discord.api);
    await d.runOnce();
    discord.failEdit(Object.assign(new Error('Unknown Message'), { status: 404, code: 10008 }));
    await env.DB.prepare("UPDATE weekly_reports SET narrative = '又改了' WHERE week_start = ?").bind(previousWeekStart(OFFSET_HOURS)).run();
    await due();
    await d.runOnce();
    expect(discord.sent).toHaveLength(1);
    expect((await pool.query("SELECT 1 FROM discord_messages WHERE entity = 'report'")).rowCount).toBe(0);
  });

  it('is not posted without a verdict channel', async () => {
    await lastWeekActivity();
    await ensureWeeklyReport(env.DB, noAiEnv(), OFFSET_HOURS, DUE);
    await due();
    const discord = fakeDiscord();
    await dispatcher(discord.api, null).runOnce();
    expect(discord.sent).toEqual([]);
    expect((await reportEvents())[0]).toMatchObject({ result: 'skipped', last_error: 'no verdict channel configured' });
  });

  it('is not posted a day late (the bot was down)', async () => {
    await lastWeekActivity();
    await ensureWeeklyReport(env.DB, noAiEnv(), OFFSET_HOURS, DUE);
    await pool.query("UPDATE outbox SET available_at = now(), created_at = now() - interval '25 hours' WHERE entity = 'report'");
    const discord = fakeDiscord();
    await dispatcher(discord.api).runOnce();
    expect(discord.sent).toEqual([]);
  });

  it('only for the latest week: an old week re-rolled is not posted', async () => {
    await lastWeekActivity();
    await ensureWeeklyReport(env.DB, noAiEnv(), OFFSET_HOURS, DUE);
    const last = previousWeekStart(OFFSET_HOURS);
    const lastMs = Date.parse(`${last}T00:00:00Z`);
    const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    await env.DB.prepare('DELETE FROM outbox').run();
    await regenerateReport(env.DB, noAiEnv(), day(lastMs - 21 * 86_400_000), OFFSET_HOURS);
    await due();
    const discord = fakeDiscord();
    await dispatcher(discord.api).runOnce();
    expect(discord.sent).toEqual([]);
    expect((await reportEvents()).map((r) => r.last_error)).toEqual(['not the latest week']);
    // A week still running cannot be written at all (it would stand in for the real one).
    await expect(regenerateReport(env.DB, noAiEnv(), day(lastMs + 7 * 86_400_000), OFFSET_HOURS)).rejects.toMatchObject({ status: 400 });
  });
});
