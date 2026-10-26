// The Discord slash-command handlers against PostgreSQL: seeded users, cases,
// sessions, bindings and a weekly report in, BotReply out. Besides each
// command's happy and unbound paths, the privacy rules are
// checked directly: what is ephemeral, that /verdicts never shows a word a
// person or the AI wrote, and that public replies cannot ping anyone.

import { describe, expect, it } from 'vitest';
import { TIERS } from '../../shared/scoring';
import { ApiError } from '../../worker/errors';
import { handleCommand } from '../../server/src/discord/commands';
import { linkAccounts, linkByDiscordId } from '../../server/src/discord/links';
import { GOLD, RED } from '../../server/src/discord/render';
import type { BotContext, BotReply, DiscordUserRef } from '../../server/src/discord/types';
import { seedUser } from '../worker/helpers';
import { env } from './cloudflare-test';

const ctx: BotContext = {
  db: env.DB,
  appUrl: 'https://api.example',
  frontendUrl: 'https://score.example',
};

const ALICE_DC: DiscordUserRef = { id: '100000000000000001', username: 'alice_dc' };
const BOB_DC: DiscordUserRef = { id: '100000000000000002', username: 'bob_dc' };
const STRANGER_DC: DiscordUserRef = { id: '100000000000000009', username: 'stranger_dc' };

const EVIL_NAME = '[写陈述](https://evil.example) @everyone <@123456789012345678>';

/** Recognisable strings for every free-text field of a case; none may reach /verdicts. */
const SECRET = {
  claim: 'SECRET-CLAIM 说好八点结果没来',
  claimSummary: 'SECRET-SUMMARY 没来',
  statement: 'SECRET-STATEMENT 家人住院了',
  headline: 'SECRET-HEADLINE 情有可原',
  reason: 'SECRET-REASON 你的家人住院',
  note: 'SECRET-NOTE 裁判备注',
  appeal: 'SECRET-APPEAL 申诉理由',
  factor: 'SECRET-FACTOR 加重因素',
};

function run(commandName: string, caller: DiscordUserRef, targetUser: DiscordUserRef | null = null): Promise<BotReply> {
  return handleCommand({ commandName, caller, targetUser }, ctx);
}

/** Every piece of text a reply would show, joined. */
function textOf(reply: BotReply): string {
  const parts: string[] = [reply.content ?? ''];
  for (const e of reply.embeds ?? []) {
    parts.push(e.title ?? '', e.description ?? '', e.footer?.text ?? '');
    for (const f of e.fields ?? []) parts.push(f.name, f.value);
  }
  for (const b of reply.buttons ?? []) parts.push(b.label, b.url);
  return parts.join('\n');
}

async function bind(userId: string, who: DiscordUserRef): Promise<void> {
  const outcome = await linkAccounts(env.DB, {
    userId,
    discordUserId: who.id,
    discordUsername: who.username,
    replace: false,
    via: 'web',
  });
  expect(outcome.kind).toBe('linked');
}

interface SeedRecord {
  subject: string;
  reporter?: string;
  type?: string;
  delta?: number;
  status?: string;
  createdAt: string;
  statement?: string | null;
  verdictSource?: string | null;
  deadlineAt?: string | null;
  claimSummary?: string | null;
}

async function seedRecord(r: SeedRecord): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO records (subject_id, reporter_id, type, delta, note, claim, claim_summary, statement,
                          appeal_reason, deadline_at, verdict_source, verdict_headline, verdict_reason,
                          verdict_factors, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      r.subject,
      r.reporter ?? 'judge',
      r.type ?? 'late_minor',
      r.delta ?? -3,
      SECRET.note,
      SECRET.claim,
      r.claimSummary === undefined ? SECRET.claimSummary : r.claimSummary,
      r.statement === undefined ? SECRET.statement : r.statement,
      SECRET.appeal,
      r.deadlineAt ?? null,
      r.verdictSource === undefined ? 'ai' : r.verdictSource,
      SECRET.headline,
      SECRET.reason,
      JSON.stringify([{ kind: 'aggravating', text: SECRET.factor }]),
      r.status ?? 'decided',
      r.createdAt,
    )
    .run();
}

async function seedInvite(invitee: string, title: string): Promise<void> {
  const startsAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const session = await env.DB.prepare(
    `INSERT INTO game_sessions (organizer_id, title, starts_at, status) VALUES ('judge', ?, ?, 'open')`,
  )
    .bind(title, startsAt)
    .run();
  await env.DB.prepare(`INSERT INTO session_players (session_id, user_id, rsvp) VALUES (?, ?, 'invited')`)
    .bind(Number(session.meta.last_row_id), invitee)
    .run();
}

/** alice (92, bound), bob (40, bound), judge (unbound), evil (unbound, hostile name). */
async function seedPeople(): Promise<void> {
  await seedUser({ id: 'alice', username: '爱丽丝', score: 92 });
  await seedUser({ id: 'bob', username: '鲍勃', score: 40 });
  await seedUser({ id: 'judge', username: '裁判', judge: true, score: 100 });
  await seedUser({ id: 'evil', username: EVIL_NAME, score: 99 });
  await bind('alice', ALICE_DC);
  await bind('bob', BOB_DC);
}

describe('/link', () => {
  it('answers anyone with an ephemeral Link button to the fixed binding page', async () => {
    await seedPeople();
    const reply = await run('link', STRANGER_DC);
    expect(reply.ephemeral).toBe(true);
    // No token, no query: the page proves both identities itself.
    expect(reply.buttons).toEqual([{ label: '绑定 Nanako 账号', url: 'https://api.example/link/discord' }]);
  });

  it('tells a bound caller which account they are on, and to /unlink before switching', async () => {
    await seedPeople();
    const reply = await run('link', ALICE_DC);
    expect(reply.ephemeral).toBe(true);
    expect(reply.content).toContain('爱丽丝');
    // The binding page refuses to move a bound Discord account; /unlink is the way.
    expect(reply.content).toContain('/unlink');
    expect(reply.buttons?.[0].url).toBe('https://api.example/link/discord');
  });
});

describe('/unlink', () => {
  it('refuses during READ_ONLY maintenance, like the web unlink', async () => {
    await seedPeople();
    const reply = await handleCommand({ commandName: 'unlink', caller: ALICE_DC, targetUser: null }, { ...ctx, readOnly: true });
    expect(reply).toMatchObject({ ephemeral: true, content: expect.stringContaining('只读') });
    expect(await linkByDiscordId(env.DB, ALICE_DC.id)).not.toBeNull();
  });

  it('removes the binding and audits it as done from Discord', async () => {
    await seedPeople();
    const reply = await run('unlink', ALICE_DC);
    expect(reply.ephemeral).toBe(true);
    expect(reply.content).toContain('已解绑');
    expect(await linkByDiscordId(env.DB, ALICE_DC.id)).toBeNull();
    const audit = await env.DB.prepare(
      "SELECT via, user_id FROM link_audit WHERE action = 'unlink' AND discord_user_id = ?",
    )
      .bind(ALICE_DC.id)
      .all<{ via: string; user_id: string }>();
    expect(audit.results).toEqual([{ via: 'discord', user_id: 'alice' }]);
  });

  it('says so when there is nothing to unbind', async () => {
    await seedPeople();
    const reply = await run('unlink', STRANGER_DC);
    expect(reply.ephemeral).toBe(true);
    expect(reply.content).toContain('你还没有绑定');
  });
});

describe('/score', () => {
  it('shows the caller their score, tier and pending counts — ephemerally', async () => {
    await seedPeople();
    await seedRecord({ subject: 'alice', status: 'awaiting_statement', createdAt: '2026-10-20 12:00:00', statement: null, verdictSource: null });
    await seedInvite('alice', '周五开黑');
    const reply = await run('score', ALICE_DC);
    expect(reply.ephemeral).toBe(true);
    const text = textOf(reply);
    expect(text).toContain('92');
    expect(text).toContain('守时楷模');
    const fields = reply.embeds?.[0].fields ?? [];
    expect(fields.find((f) => f.name === '待写陈述')?.value).toBe('1 件');
    expect(fields.find((f) => f.name === '待回应的约局')?.value).toBe('1 个');
    expect(reply.embeds?.[0].color).toBe(GOLD);
    expect(reply.buttons?.[0].url).toBe('https://score.example/');
  });

  it('colours a low score red for its owner', async () => {
    await seedPeople();
    const reply = await run('score', BOB_DC);
    expect(reply.ephemeral).toBe(true);
    expect(reply.embeds?.[0].color).toBe(RED);
  });

  it('treats naming yourself like no option at all', async () => {
    await seedPeople();
    const reply = await run('score', ALICE_DC, ALICE_DC);
    expect(textOf(reply)).toContain('守时楷模');
  });

  it("shows someone else's name and score only — no tier, no history", async () => {
    await seedPeople();
    await seedRecord({ subject: 'bob', type: 'no_show', delta: -15, createdAt: '2026-10-19 12:00:00' });
    const reply = await run('score', ALICE_DC, BOB_DC);
    expect(reply.ephemeral).toBe(true);
    const text = textOf(reply);
    expect(text).toContain('鲍勃');
    expect(text).toContain('40');
    for (const tier of TIERS) expect(text).not.toContain(tier.name);
    expect(text).not.toContain('放鸽子');
    expect(reply.embeds?.[0].fields).toBeUndefined();
    // Gold vs red would give the tier away.
    expect(reply.embeds?.[0].color).toBeUndefined();
  });

  it('works for an unbound caller looking at a bound player', async () => {
    await seedPeople();
    const reply = await run('score', STRANGER_DC, BOB_DC);
    expect(reply.ephemeral).toBe(true);
    expect(textOf(reply)).toContain('40');
  });

  it('points an unbound caller asking about themselves to /link', async () => {
    await seedPeople();
    const reply = await run('score', STRANGER_DC);
    expect(reply.ephemeral).toBe(true);
    expect(reply.content).toContain('/link');
    expect(reply.embeds).toBeUndefined();
  });

  it('says an unbound target is not bound, without mentioning them', async () => {
    await seedPeople();
    const reply = await run('score', ALICE_DC, STRANGER_DC);
    expect(reply.ephemeral).toBe(true);
    expect(reply.content).toContain('还没有绑定');
    expect(reply.content).toContain('stranger\\_dc');
    expect(reply.content).not.toContain('<@');
  });
});

describe('/top', () => {
  it('posts the top 10 publicly, in order, with names as inert text', async () => {
    await seedPeople();
    for (let i = 0; i < 10; i += 1) await seedUser({ id: `p${i}`, username: `选手${i}`, score: 50 + i });
    const reply = await run('top', STRANGER_DC);
    expect(reply.ephemeral).toBe(false);
    const lines = (reply.embeds?.[0].description ?? '').split('\n');
    expect(lines).toHaveLength(10);
    expect(lines[0]).toMatch(/^🥇 裁判 — \*\*100\*\*$/);
    expect(lines[1]).toContain('**99**');
    expect(lines[2]).toMatch(/^🥉 爱丽丝/);
    expect(lines[3]).toMatch(/^4\\\. 选手9/);
    // bob (40) is last of 14.
    expect(lines.join('\n')).not.toContain('鲍勃');

    const text = textOf(reply);
    expect(text).not.toContain('<@');
    expect(text).not.toContain('@everyone');
    expect(text).not.toContain('](');
    expect(text).not.toMatch(/https?:\/\/evil/);
  });

  it('replies ephemerally when nobody is on the board yet', async () => {
    const reply = await run('top', STRANGER_DC);
    expect(reply.ephemeral).toBe(true);
    expect(reply.content).toContain('还没有');
  });
});

describe('/verdicts', () => {
  async function seedHistory(subject: string): Promise<void> {
    // Six decided cases (only the latest five are shown), plus cases in other
    // states that must not be listed at all.
    await seedRecord({ subject, type: 'late_minor', delta: -3, createdAt: '2026-10-01 12:00:00' });
    await seedRecord({ subject, type: 'late_major', delta: -6, createdAt: '2026-10-02 12:00:00' });
    await seedRecord({ subject, type: 'reschedule', delta: -5, createdAt: '2026-10-03 12:00:00' });
    await seedRecord({ subject, type: 'no_show', delta: -15, createdAt: '2026-10-04 12:00:00', statement: null, verdictSource: 'fallback' });
    await seedRecord({ subject, type: 'late_severe', delta: -10, createdAt: '2026-10-05 12:00:00', verdictSource: 'manual', statement: null });
    await seedRecord({ subject, type: 'late_minor', delta: -2, createdAt: '2026-10-06 12:00:00' });
    await seedRecord({ subject, status: 'appealed', createdAt: '2026-10-07 12:00:00' });
    await seedRecord({ subject, status: 'awaiting_statement', createdAt: '2026-10-08 12:00:00', statement: null, verdictSource: null });
  }

  function assertNoFreeText(reply: BotReply): void {
    const text = textOf(reply);
    for (const secret of Object.values(SECRET)) expect(text).not.toContain(secret);
    expect(text).not.toContain('SECRET');
  }

  it('lists the latest five decided cases with fixed fields only', async () => {
    await seedPeople();
    await seedHistory('alice');
    const reply = await run('verdicts', ALICE_DC);
    expect(reply.ephemeral).toBe(true);
    const lines = (reply.embeds?.[0].description ?? '').split('\n');
    expect(lines).toHaveLength(5);
    // Newest first; the 10-01 case is the sixth and drops off.
    expect(lines[0]).toContain('小迟到');
    expect(lines[0]).toContain('-2 分');
    expect(lines[0]).toContain(`<t:${Date.UTC(2026, 9, 6, 12) / 1000}:d>`);
    expect(lines[2]).toContain('放鸽子');
    expect(lines[2]).toContain('-15 分');
    expect(lines[4]).toContain('大迟到');
    // Absent = no statement and judged by the AI or the fallback; a judge's
    // manual verdict without a statement is not "in absence".
    expect(lines.filter((l) => l.includes('缺席判决'))).toEqual([lines[2]]);
    expect(reply.buttons?.[0].url).toBe('https://score.example/');
    assertNoFreeText(reply);
  });

  it("shows someone else's verdicts the same way, still without any free text", async () => {
    await seedPeople();
    await seedHistory('bob');
    const reply = await run('verdicts', ALICE_DC, BOB_DC);
    expect(reply.ephemeral).toBe(true);
    expect(reply.embeds?.[0].title).toContain('鲍勃');
    expect((reply.embeds?.[0].description ?? '').split('\n')).toHaveLength(5);
    assertNoFreeText(reply);
  });

  it('says so when there is nothing decided yet', async () => {
    await seedPeople();
    const reply = await run('verdicts', ALICE_DC);
    expect(reply.ephemeral).toBe(true);
    expect(reply.content).toContain('最近没有');
  });

  it('points an unbound caller to /link and reports an unbound target', async () => {
    await seedPeople();
    const self = await run('verdicts', STRANGER_DC);
    expect(self.ephemeral).toBe(true);
    expect(self.content).toContain('/link');
    const other = await run('verdicts', ALICE_DC, STRANGER_DC);
    expect(other.ephemeral).toBe(true);
    expect(other.content).toContain('还没有绑定');
  });
});

describe('/todo', () => {
  it('lists pending statements and unanswered invites with a web link', async () => {
    await seedPeople();
    const deadline = new Date(Date.now() + 6 * 3_600_000).toISOString();
    await seedRecord({
      subject: 'alice',
      type: 'no_show',
      status: 'awaiting_statement',
      createdAt: '2026-10-20 12:00:00',
      statement: null,
      verdictSource: null,
      deadlineAt: deadline,
      claimSummary: '没来 [点我](https://evil.example)',
    });
    await seedInvite('alice', '周五 @everyone 开黑');
    // Someone else's case and invite are not alice's to-dos.
    await seedRecord({ subject: 'bob', status: 'awaiting_statement', createdAt: '2026-10-20 12:00:00', statement: null, verdictSource: null });
    await seedInvite('bob', '鲍勃的局');

    const reply = await run('todo', ALICE_DC);
    expect(reply.ephemeral).toBe(true);
    const fields = reply.embeds?.[0].fields ?? [];
    expect(fields.map((f) => f.name)).toEqual(['待写陈述（1）', '待回应的约局（1）']);
    expect(fields[0].value).toContain('放鸽子');
    expect(fields[0].value).toContain(`<t:${Math.floor(Date.parse(deadline) / 1000)}:R>`);
    expect(fields[1].value).toContain('周五');
    expect(fields[1].value).toContain('裁判 组织');
    expect(reply.buttons?.[0].url).toBe('https://score.example/');

    const text = textOf(reply);
    expect(text).not.toContain('鲍勃的局');
    expect(text).not.toContain('@everyone');
    expect(text).not.toMatch(/https?:\/\/evil/);
    // The only links are the bot's own: straight to the case and to the invite.
    const links = [...text.matchAll(/\]\(([^)]*)\)/g)].map((m) => m[1]);
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toMatch(/^https:\/\/score\.example\/\?(case|session)=\d+$/);
    expect(fields[0].value).toMatch(/\[去处理\]\(https:\/\/score\.example\/\?case=\d+\)/);
    expect(fields[1].value).toMatch(/\[查看\]\(https:\/\/score\.example\/\?session=\d+\)/);
  });

  it('shows an admin the appeals to review — who and what, not the reason — with a way there', async () => {
    await seedPeople();
    await env.DB.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').bind('bob').run();
    await seedRecord({ subject: 'alice', status: 'appealed', createdAt: '2026-10-20 12:00:00' });
    const reply = await run('todo', BOB_DC);
    const field = (reply.embeds?.[0].fields ?? []).find((f) => f.name.startsWith('待复核的申诉'));
    expect(field?.name).toBe('待复核的申诉（1）');
    expect(field?.value).toContain('爱丽丝');
    expect(field?.value).toMatch(/\[去复核\]\(https:\/\/score\.example\/\?case=\d+\)/);
    expect(textOf(reply)).not.toContain(SECRET.appeal);
    // Not for anyone else.
    const alice = await run('todo', ALICE_DC);
    expect(textOf(alice)).not.toContain('待复核的申诉');
  });

  it('says there is nothing to do', async () => {
    await seedPeople();
    const reply = await run('todo', ALICE_DC);
    expect(reply.ephemeral).toBe(true);
    expect(reply.content).toContain('没有待办');
  });

  it('needs a binding', async () => {
    await seedPeople();
    const reply = await run('todo', STRANGER_DC);
    expect(reply.ephemeral).toBe(true);
    expect(reply.content).toContain('/link');
  });
});

describe('/report', () => {
  const stats = (weekStart: string, weekEnd: string) => ({
    weekStart,
    weekEnd,
    sessionsPlayed: 4,
    sessionsCollapsed: 1,
    casesFiled: 3,
    totalPenalty: -21,
    absentVerdicts: 1,
    attendanceRate: 0.875,
    upcomingNextWeek: 2,
    star: { name: '爱丽丝', delta: 6 },
    pigeon: { name: EVIL_NAME, delta: -15 },
    bestTalker: null,
    harshest: null,
    topOrganizer: null,
  });

  async function seedReport(weekStart: string, weekEnd: string, narrative: string): Promise<void> {
    await env.DB.prepare(`INSERT INTO weekly_reports (week_start, stats_json, narrative, source) VALUES (?, ?, ?, 'ai')`)
      .bind(weekStart, JSON.stringify(stats(weekStart, weekEnd)), narrative)
      .run();
  }

  it('posts the latest report publicly, narrative and names made inert', async () => {
    await seedReport('2026-10-05', '2026-10-11', '上上周的旧战报');
    await seedReport('2026-10-12', '2026-10-18', '这周 @everyone 都很靠谱，[点这里领奖](https://evil.example) <@123456789012345678>');
    const reply = await run('report', STRANGER_DC);
    expect(reply.ephemeral).toBe(false);
    const embed = reply.embeds?.[0];
    expect(embed?.title).toContain('2026-10-12');
    expect(embed?.title).toContain('2026-10-18');
    expect(embed?.description).toContain('都很靠谱');
    const fields = embed?.fields ?? [];
    expect(fields.find((f) => f.name === '开局')?.value).toBe('4 局');
    expect(fields.find((f) => f.name === '出勤率')?.value).toBe('88%');
    expect(fields.find((f) => f.name.includes('本周之星'))?.value).toBe('爱丽丝（+6）');

    const text = textOf(reply);
    expect(text).not.toContain('旧战报');
    expect(text).not.toContain('@everyone');
    expect(text).not.toContain('<@');
    expect(text).not.toContain('](');
    expect(text).not.toMatch(/https?:\/\/evil/);
  });

  it('answers ephemerally when there is no report yet', async () => {
    const reply = await run('report', STRANGER_DC);
    expect(reply.ephemeral).toBe(true);
    expect(reply.content).toContain('还没有战报');
    expect(reply.embeds).toBeUndefined();
  });
});

describe('unknown commands', () => {
  it('get an ephemeral error', async () => {
    const reply = await run('nope', ALICE_DC);
    expect(reply.ephemeral).toBe(true);
    expect(reply.content).toContain('未知命令');
  });

  it('are not looked up on the prototype', async () => {
    const reply = await run('constructor', ALICE_DC);
    expect(reply.ephemeral).toBe(true);
    expect(reply.content).toContain('未知命令');
  });
});

describe('errors', () => {
  /** A database that fails every query with `error`. */
  function failingCtx(error: Error): BotContext {
    const db = {
      prepare() {
        throw error;
      },
    } as unknown as D1Database;
    return { ...ctx, db };
  }

  it("shows an ApiError's message to the caller alone, even for a public command", async () => {
    const reply = await handleCommand(
      { commandName: 'top', caller: ALICE_DC, targetUser: null },
      failingCtx(new ApiError(503, '系统维护中 @everyone')),
    );
    expect(reply.ephemeral).toBe(true);
    expect(reply.content).toContain('系统维护中');
    expect(reply.content).not.toContain('@everyone');
  });

  it('throws anything else on for the bot process to log', async () => {
    const boom = new Error('connection refused');
    await expect(
      handleCommand({ commandName: 'score', caller: ALICE_DC, targetUser: null }, failingCtx(boom)),
    ).rejects.toBe(boom);
  });
});
