// P5: verdict events (server/migrations/0003_outbox.sql) and their delivery to
// the Discord channel (server/src/outbox/dispatcher.ts), against PostgreSQL.
// Discord itself is a fake ChannelApi that records what would be sent.

import pg from 'pg';
import { describe, expect, inject, it } from 'vitest';
import { appealCase, fileCase, overrideCase, revokeCase, submitStatement, withdrawCase } from '../../worker/cases';
import { createDispatcher, STALE_MS, type ChannelApi } from '../../server/src/outbox/dispatcher';
import { linkAccounts } from '../../server/src/discord/links';
import { handleVerdictButton, type ChannelMessage } from '../../server/src/discord/verdict';
import { noAiEnv, OFFSET_HOURS, seedUser } from '../worker/helpers';
import { env, pool } from './cloudflare-test';

const CHANNEL = '200000000000000001';
const FRONTEND = 'https://score.example';
const OPTS = { offsetHours: OFFSET_HOURS, skipRateLimit: true };
const CLAIM = '说好八点五排，等到八点四十还没上线，微信也不回。';

// Letters only: render.ts escapes markdown characters, and an escaped
// "SECRET\-CLAIM" would make every not.toContain() pass for nothing.
const SECRET = {
  claim: 'SECRETCLAIM 说好八点结果没来也没说一声',
  statement: 'SECRETSTATEMENT 家人住院了',
  headline: 'SECRETHEADLINE 情有可原',
  reason: 'SECRETREASON 你的家人住院',
};

interface Event {
  kind: string;
  entity_id: string;
  result: string | null;
  attempts: number;
}

async function events(): Promise<Event[]> {
  const res = await pool.query<Event>('SELECT kind, entity_id, result, attempts FROM outbox ORDER BY id');
  return res.rows;
}

/** A Discord that records every send and edit; `fail` queues errors for the next calls. */
function fakeDiscord() {
  const sent: Array<{ channelId: string; message: ChannelMessage & { nonce: string } }> = [];
  const edits: Array<{ channelId: string; messageId: string; message: ChannelMessage }> = [];
  const failures: unknown[] = [];
  let next = 900_000_000_000_000_000n;
  const api: ChannelApi = {
    async send(channelId, message) {
      if (failures.length > 0) throw failures.shift();
      sent.push({ channelId, message });
      next += 1n;
      return { id: String(next) };
    },
    async edit(channelId, messageId, message) {
      if (failures.length > 0) throw failures.shift();
      edits.push({ channelId, messageId, message });
    },
  };
  return { api, sent, edits, fail: (...errors: unknown[]) => failures.push(...errors) };
}

function discordError(status: number, code?: number): Error {
  return Object.assign(new Error(`Discord said ${status}`), { status, ...(code !== undefined ? { code } : {}) });
}

const quiet = { log: () => undefined, warn: () => undefined, error: () => undefined };

function dispatcher(api: ChannelApi, channel: string | null = CHANNEL) {
  return createDispatcher({
    pool,
    db: env.DB,
    api,
    config: { verdictChannelId: channel, frontendUrl: FRONTEND },
    log: quiet,
  });
}

/** Every piece of text a channel message would show. */
function textOf(message: ChannelMessage): string {
  return JSON.stringify(message);
}

/** A penalty case in 'judging', with recognisable text in every free-text field. */
async function judgingCase(subject = 'subject', delta = -15): Promise<number> {
  const row = await env.DB.prepare(
    `INSERT INTO records (subject_id, reporter_id, type, delta, claim, statement, verdict_headline, verdict_reason,
                          verdict_source, status, judging_started_at)
     VALUES (?, 'judge', 'no_show', ?, ?, ?, ?, ?, 'ai', 'judging', datetime('now'))`,
  )
    .bind(subject, delta, SECRET.claim, SECRET.statement, SECRET.headline, SECRET.reason)
    .run();
  return Number(row.meta.last_row_id);
}

async function decide(id: number): Promise<void> {
  await env.DB.prepare("UPDATE records SET status = 'decided' WHERE id = ? AND status = 'judging'").bind(id).run();
}

async function people() {
  const judge = await seedUser({ id: 'judge', judge: true });
  const admin = await seedUser({ id: 'admin', admin: true });
  const subject = await seedUser({ id: 'subject', username: '被告', score: 80 });
  return { judge, admin, subject };
}

// --- the events ------------------------------------------------------------------

describe('verdict events (records trigger)', () => {
  it('a verdict reached through the API emits exactly one case.decided', async () => {
    const { judge, subject } = await people();
    const filed = await fileCase(env.DB, judge, { subject_id: subject.id, type: 'no_show', claim: CLAIM }, OPTS, noAiEnv());
    expect(await events()).toEqual([]); // filing is not news
    await submitStatement(env.DB, subject, filed.id, '公司临时加班', noAiEnv());
    expect(await events()).toEqual([{ kind: 'case.decided', entity_id: String(filed.id), result: null, attempts: 0 }]);
  });

  it('revoke and override emit their own events; appeal and withdraw emit none', async () => {
    const { judge, admin, subject } = await people();
    const a = await fileCase(env.DB, judge, { subject_id: subject.id, type: 'no_show', claim: CLAIM }, OPTS, noAiEnv());
    await submitStatement(env.DB, subject, a.id, '我错了', noAiEnv());
    await appealCase(env.DB, subject, a.id, '我那天在医院');
    await overrideCase(env.DB, admin, a.id, -8, '情有可原');
    await overrideCase(env.DB, admin, a.id, -10, '再改一次');
    await revokeCase(env.DB, admin, a.id);

    const b = await fileCase(env.DB, judge, { subject_id: subject.id, type: 'afk', claim: CLAIM }, OPTS, noAiEnv());
    await withdrawCase(env.DB, judge, b.id);

    expect((await events()).map((e) => [e.kind, Number(e.entity_id)])).toEqual([
      ['case.decided', a.id],
      ['case.overridden', a.id],
      ['case.overridden', a.id],
      ['case.revoked', a.id],
    ]);
  });

  it('bonuses, which are decided the moment they are filed, are not events', async () => {
    const { judge, subject } = await people();
    await fileCase(env.DB, judge, { subject_id: subject.id, type: 'on_time_bonus' }, OPTS, noAiEnv());
    expect(await events()).toEqual([]);
  });

  it('a verdict whose transaction rolls back leaves no event behind', async () => {
    await people();
    const id = await judgingCase();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("UPDATE records SET status = 'decided' WHERE id = $1", [id]);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    expect(await events()).toEqual([]);
  });

  it('an override that loses a race (409) emits nothing', async () => {
    const { admin } = await people();
    const id = await judgingCase();
    await decide(id);
    await overrideCase(env.DB, admin, id, -8, '改判');
    // A second admin acting on the stale case: refused, and no event.
    await env.DB.prepare("UPDATE records SET status = 'revoked' WHERE id = ?").bind(id).run();
    await expect(overrideCase(env.DB, admin, id, -12, '晚了一步')).rejects.toMatchObject({ status: expect.any(Number) });
    expect((await events()).map((e) => e.kind)).toEqual(['case.decided', 'case.overridden', 'case.revoked']);
  });

  it('wakes LISTEN outbox when — and only when — the verdict commits', async () => {
    await people();
    const id = await judgingCase();
    const listener = new pg.Client({ connectionString: inject('pgUrl') });
    await listener.connect();
    try {
      await listener.query('LISTEN outbox');
      const heard = new Promise<string>((resolve) => listener.once('notification', (n) => resolve(n.channel)));
      await decide(id);
      await expect(heard).resolves.toBe('outbox');
    } finally {
      await listener.end();
    }
  });
});

// --- delivery ----------------------------------------------------------------------

describe('dispatcher', () => {
  it('posts a decided case once, fixed fields only, and records the message', async () => {
    await people();
    const id = await judgingCase();
    await decide(id);
    const discord = fakeDiscord();
    const d = dispatcher(discord.api);

    expect(await d.runOnce()).toBe(1);
    expect(await d.runOnce()).toBe(0);
    expect(discord.sent).toHaveLength(1);
    const { channelId, message } = discord.sent[0];
    expect(channelId).toBe(CHANNEL);
    // Retried sends are deduplicated by Discord through the nonce.
    expect(message.nonce).toMatch(/^ob\d+$/);
    expect(message.allowed_mentions).toEqual({ parse: [] });
    const text = textOf(message);
    for (const secret of Object.values(SECRET)) expect(text).not.toContain(secret);
    expect(text).toContain('被告');
    expect(text).toContain('-15 分');
    expect(text).toContain(`v1:verdict:${id}`);

    const saved = await pool.query('SELECT channel_id, message_id FROM discord_messages');
    expect(saved.rows).toEqual([{ channel_id: CHANNEL, message_id: '900000000000000001' }]);
    expect((await events())[0].result).toBe('sent');
  });

  it('edits the original post when the case is overridden, then revoked', async () => {
    const { admin } = await people();
    const id = await judgingCase();
    await decide(id);
    const discord = fakeDiscord();
    const d = dispatcher(discord.api);
    await d.runOnce();

    await overrideCase(env.DB, admin, id, -8, '情有可原');
    expect(await d.runOnce()).toBe(1);
    await revokeCase(env.DB, admin, id);
    expect(await d.runOnce()).toBe(1);

    expect(discord.sent).toHaveLength(1);
    expect(discord.edits.map((e) => e.messageId)).toEqual(['900000000000000001', '900000000000000001']);
    expect(textOf(discord.edits[0].message)).toContain('管理员改判');
    expect(textOf(discord.edits[0].message)).toContain('-8 分');
    expect(textOf(discord.edits[1].message)).toContain('判决已撤销');
  });

  it('renders what the case is now, not what it was when the event fired', async () => {
    const { admin } = await people();
    const id = await judgingCase();
    await decide(id);
    const discord = fakeDiscord();
    const d = dispatcher(discord.api);
    await d.runOnce();
    await overrideCase(env.DB, admin, id, -8, '情有可原');
    await revokeCase(env.DB, admin, id);
    expect(await d.runOnce()).toBe(2);
    expect(discord.edits.map((e) => textOf(e.message).includes('判决已撤销'))).toEqual([true, true]);
  });

  it('delivers one case’s events in order, even when they queue up', async () => {
    const { admin } = await people();
    const id = await judgingCase();
    await decide(id);
    await revokeCase(env.DB, admin, id);
    const discord = fakeDiscord();
    await dispatcher(discord.api).runOnce();
    // The post comes first; the revoke edits it rather than posting again.
    expect(discord.sent).toHaveLength(1);
    expect(discord.edits).toHaveLength(1);
  });

  it('posts again when the original message was deleted in Discord', async () => {
    const { admin } = await people();
    const id = await judgingCase();
    await decide(id);
    const discord = fakeDiscord();
    const d = dispatcher(discord.api);
    await d.runOnce();
    await revokeCase(env.DB, admin, id);
    discord.fail(discordError(404, 10008));
    await d.runOnce();
    expect(discord.sent).toHaveLength(2);
    const saved = await pool.query('SELECT message_id FROM discord_messages');
    expect(saved.rows).toEqual([{ message_id: '900000000000000002' }]);
  });

  it('retries a Discord outage later, and gives up after 8 attempts', async () => {
    await people();
    const id = await judgingCase();
    await decide(id);
    const discord = fakeDiscord();
    const d = dispatcher(discord.api);

    discord.fail(discordError(503));
    await d.runOnce();
    const [first] = (await pool.query('SELECT result, attempts, available_at > now() AS later FROM outbox')).rows;
    expect(first).toEqual({ result: null, attempts: 1, later: true });
    expect(await d.runOnce()).toBe(0); // not due yet

    for (let i = 0; i < 7; i += 1) {
      await pool.query('UPDATE outbox SET available_at = now()');
      discord.fail(discordError(502));
      await d.runOnce();
    }
    const [last] = await events();
    expect(last).toMatchObject({ result: 'dead', attempts: 8 });
    expect(discord.sent).toEqual([]);
    void id;
  });

  it('marks a wrong channel dead at once, and other refusals too', async () => {
    await people();
    await decide(await judgingCase());
    const discord = fakeDiscord();
    discord.fail(discordError(404, 10003));
    await dispatcher(discord.api).runOnce();
    expect((await events())[0].result).toBe('dead');
  });

  it('pauses delivery after repeated 401/403, instead of hammering Discord', async () => {
    await seedUser({ id: 'judge', judge: true });
    for (let i = 0; i < 6; i += 1) {
      await seedUser({ id: `s${i}` });
      await decide(await judgingCase(`s${i}`));
    }
    const discord = fakeDiscord();
    const d = dispatcher(discord.api);
    discord.fail(...Array.from({ length: 6 }, () => discordError(403, 50001)));
    // Each failure backs its event off; after the fifth the whole queue pauses.
    expect(await d.runOnce()).toBe(5);
    await pool.query('UPDATE outbox SET available_at = now()');
    expect(await d.runOnce()).toBe(0);
    const pending = (await events()).filter((e) => e.result === null);
    expect(pending).toHaveLength(6); // retried later, not thrown away
  });

  it('skips everything when no verdict channel is configured', async () => {
    await people();
    await decide(await judgingCase());
    const discord = fakeDiscord();
    await dispatcher(discord.api, null).runOnce();
    expect(discord.sent).toEqual([]);
    expect((await events())[0].result).toBe('skipped');
  });

  it('does not announce a day-old verdict that was never posted, but still edits an existing post', async () => {
    const { admin } = await people();
    const old = await judgingCase();
    await decide(old);
    await pool.query("UPDATE outbox SET created_at = now() - make_interval(secs => $1)", [STALE_MS / 1000 + 60]);
    const discord = fakeDiscord();
    const d = dispatcher(discord.api);
    await d.runOnce();
    expect(discord.sent).toEqual([]);
    expect((await events())[0].result).toBe('skipped');

    const fresh = await judgingCase();
    await decide(fresh);
    await d.runOnce();
    await pool.query("UPDATE outbox SET created_at = now() - interval '2 days'");
    await revokeCase(env.DB, admin, fresh);
    await pool.query("UPDATE outbox SET created_at = now() - interval '2 days' WHERE kind = 'case.revoked'");
    await d.runOnce();
    expect(discord.sent).toHaveLength(1);
    expect(discord.edits).toHaveLength(1);
  });

  it('two dispatchers running at once deliver each event exactly once', async () => {
    await seedUser({ id: 'judge', judge: true });
    for (let i = 0; i < 8; i += 1) {
      await seedUser({ id: `s${i}` });
      await decide(await judgingCase(`s${i}`));
    }
    const discord = fakeDiscord();
    const [a, b] = await Promise.all([dispatcher(discord.api).runOnce(), dispatcher(discord.api).runOnce()]);
    expect(a + b).toBe(8);
    expect(discord.sent).toHaveLength(8);
    expect(new Set(discord.sent.map((s) => s.message.nonce)).size).toBe(8);
  });

  it('skips a record that is no longer a judged penalty', async () => {
    await people();
    const id = await judgingCase();
    await decide(id);
    await env.DB.prepare("UPDATE records SET type = 'on_time_bonus' WHERE id = ?").bind(id).run();
    const discord = fakeDiscord();
    await dispatcher(discord.api).runOnce();
    expect(discord.sent).toEqual([]);
    expect((await events())[0].result).toBe('skipped');
  });
});

// --- the "看判词" button --------------------------------------------------------------

describe('看判词', () => {
  const ctx = { db: env.DB, appUrl: 'https://api.example', frontendUrl: FRONTEND };
  const dc = (n: number) => ({ id: `30000000000000000${n}`, username: `dc${n}` });

  async function bound(userId: string, n: number): Promise<{ id: string; username: string }> {
    const who = dc(n);
    await linkAccounts(env.DB, { userId, discordUserId: who.id, discordUsername: who.username, replace: false, via: 'web' });
    return who;
  }

  function shown(reply: Awaited<ReturnType<typeof handleVerdictButton>>): string {
    return JSON.stringify(reply);
  }

  it('shows the full verdict, privately, to the subject, the reporter, judges and admins', async () => {
    await people();
    await seedUser({ id: 'other-judge', judge: true });
    const id = await judgingCase();
    await decide(id);
    for (const [userId, n] of [['subject', 1], ['judge', 2], ['admin', 3], ['other-judge', 4]] as const) {
      const reply = await handleVerdictButton(id, await bound(userId, n), ctx);
      expect(reply.ephemeral).toBe(true);
      expect(shown(reply)).toContain(SECRET.headline);
      expect(shown(reply)).toContain(SECRET.reason);
      // The statement and the claim are never shown here, to anyone.
      expect(shown(reply)).not.toContain(SECRET.statement);
      expect(shown(reply)).not.toContain(SECRET.claim);
    }
  });

  it('shows anyone else the fixed fields only', async () => {
    await people();
    await seedUser({ id: 'bystander' });
    const id = await judgingCase();
    await decide(id);
    const asBystander = await handleVerdictButton(id, await bound('bystander', 5), ctx);
    const asStranger = await handleVerdictButton(id, dc(9), ctx);
    for (const reply of [asBystander, asStranger]) {
      expect(reply.ephemeral).toBe(true);
      for (const secret of Object.values(SECRET)) expect(shown(reply)).not.toContain(secret);
      expect(shown(reply)).toContain('-15 分');
    }
    expect(shown(asStranger)).toContain('/link');
  });

  it('answers a case that is not (or no longer) a judged penalty with a plain notice', async () => {
    await people();
    const id = await judgingCase();
    const reply = await handleVerdictButton(id, dc(1), ctx);
    expect(reply).toEqual({ content: '这条判决不存在了。', ephemeral: true });
    expect(await handleVerdictButton(999_999, dc(1), ctx)).toEqual({ content: '这条判决不存在了。', ephemeral: true });
  });
});
