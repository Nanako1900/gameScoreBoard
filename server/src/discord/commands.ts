// Slash-command handlers for the Discord bot. Pure: a CommandInput and a
// BotContext in, a BotReply out — no discord.js here, so every command is
// tested against PostgreSQL without Discord (tests/pg/bot-commands.test.ts).
//
// Privacy first (design doc §4.6):
//   * anything about one person (tier, to-dos, verdicts) is ephemeral;
//   * only the leaderboard and the weekly report are posted in the channel,
//     with names as plain text — never a mention;
//   * /verdicts shows fixed fields only. Claim, statement, headline and reason
//     can carry private details the AI read in a statement, so they stay on
//     the web, behind its own rules;
//   * every user- or AI-written string goes through render.ts first.

import { tierFor, VIOLATION_MAP } from '../../../shared/scoring';
import { listRecords, pendingCounts } from '../../../worker/case-reads';
import { getLeaderboard, getUserById, toUser } from '../../../worker/db';
import { ApiError } from '../../../worker/errors';
import { getLatestReport } from '../../../worker/report';
import { listMyInvites } from '../../../worker/sessions';
import type { RecordItem, SessionItem, User } from '../../../worker/types';
import { linkByDiscordId, unlinkAccounts } from './links';
import {
  GOLD,
  LIMITS,
  RED,
  discordTime,
  ephemeralReply,
  fitLines,
  formatDelta,
  joinUrl,
  linkButton,
  publicReply,
  safeLine,
  safeText,
} from './render';
import type {
  BotContext,
  BotEmbed,
  BotEmbedField,
  BotLinkButton,
  BotReply,
  CommandInput,
  DiscordUserRef,
} from './types';

// --- Command definitions -----------------------------------------------------

const CHAT_INPUT = 1;
const USER_OPTION = 6;

interface CommandOption {
  type: number;
  name: string;
  description: string;
  required?: boolean;
}

export interface CommandDefinition {
  type: number;
  name: string;
  description: string;
  options?: CommandOption[];
}

function userOption(description: string): CommandOption {
  return { type: USER_OPTION, name: 'user', description, required: false };
}

/** Registered with Discord as-is (PUT /applications/{id}/guilds/{guild}/commands). */
export const COMMANDS: readonly CommandDefinition[] = [
  { type: CHAT_INPUT, name: 'link', description: '绑定你的 Nanako 账号' },
  { type: CHAT_INPUT, name: 'unlink', description: '解除 Discord 与 Nanako 账号的绑定' },
  {
    type: CHAT_INPUT,
    name: 'score',
    description: '查信誉分（只有你自己看得到）',
    options: [userOption('要查谁，不填就是自己')],
  },
  { type: CHAT_INPUT, name: 'top', description: '信誉分排行榜前 10 名' },
  {
    type: CHAT_INPUT,
    name: 'verdicts',
    description: '最近 5 次判决（只有你自己看得到）',
    options: [userOption('要查谁，不填就是自己')],
  },
  { type: CHAT_INPUT, name: 'todo', description: '我的待办：待写陈述和待回应的约局' },
  { type: CHAT_INPUT, name: 'report', description: '最新一期周报' },
];

// --- Shared pieces -----------------------------------------------------------

const NOT_LINKED = '你还没有绑定 Nanako 账号。先用 /link 绑定，再来试试。';
const TOP_COUNT = 10;
const RECENT_VERDICTS = 5;
/** Tiers from 基本靠谱 up count as good news (gold); below that, red. */
const GOOD_TIER_MIN = 70;
const NAME_MAX = 64;
const TITLE_MAX = 80;
const SUMMARY_MAX = 100;

function scoreColor(score: number): number {
  return tierFor(score).min >= GOOD_TIER_MIN ? GOLD : RED;
}

/** The web app has no per-page URLs yet, so every web link opens its front page. */
function webButton(ctx: BotContext, label = '打开网页'): BotLinkButton {
  return linkButton(label, joinUrl(ctx.frontendUrl, '/'));
}

/** The Nanako user bound to this Discord account, or null. */
async function boundUser(db: D1Database, discordUserId: string): Promise<User | null> {
  const link = await linkByDiscordId(db, discordUserId);
  if (!link) return null;
  const row = await getUserById(db, link.user_id);
  return row ? toUser(row) : null;
}

interface Target {
  self: boolean;
  ref: DiscordUserRef;
  user: User | null;
}

/** Whom /score or /verdicts is about: the `user` option, else the caller. */
async function resolveTarget(input: CommandInput, ctx: BotContext): Promise<Target> {
  const ref = input.targetUser ?? input.caller;
  return { self: ref.id === input.caller.id, ref, user: await boundUser(ctx.db, ref.id) };
}

/** Reply for a target without a binding; points the caller to /link for themselves. */
function unboundTarget(target: Target): BotReply {
  if (target.self) return ephemeralReply(NOT_LINKED);
  return ephemeralReply(`${safeLine(target.ref.username, NAME_MAX)} 还没有绑定 Nanako 账号。`);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A stored YYYY-MM-DD as-is; anything else is not shown. */
function dateOnly(value: string | null | undefined): string {
  return value && DATE.test(value) ? value : '—';
}

function violationLabel(type: string): string {
  // Own keys only: a stray type like 'constructor' must not hit Object.prototype.
  const def = Object.prototype.hasOwnProperty.call(VIOLATION_MAP, type) ? VIOLATION_MAP[type] : undefined;
  return def ? `${def.emoji} **${def.label}**` : '❔ **未知类型**';
}

/** Decided with no statement by the AI or the fallback: the subject never answered. */
function judgedInAbsence(record: RecordItem): boolean {
  return record.statement === null && (record.verdict?.source === 'ai' || record.verdict?.source === 'fallback');
}

// --- Handlers ----------------------------------------------------------------

async function handleLink(input: CommandInput, ctx: BotContext): Promise<BotReply> {
  // The URL carries no token: the binding page proves both identities itself
  // (Nanako session + Discord OAuth), so a leaked link is worthless.
  const button = linkButton('绑定 Nanako 账号', joinUrl(ctx.appUrl, '/link/discord'));
  const current = await boundUser(ctx.db, input.caller.id);
  // A bound Discord account cannot be moved onto another Nanako account
  // directly — the binding page answers that with "已经绑定了别的账号" — so
  // the way to switch is /unlink first.
  const content = current
    ? `你已经绑定了 Nanako 账号 **${safeLine(current.username, NAME_MAX)}**。要换成别的账号，先用 /unlink 解绑，再点下面的按钮重新绑定。`
    : '点下面的按钮，在网页上登录 Nanako 账号并确认绑定。';
  return ephemeralReply(content, { buttons: [button] });
}

async function handleUnlink(input: CommandInput, ctx: BotContext): Promise<BotReply> {
  const removed = await unlinkAccounts(ctx.db, { discordUserId: input.caller.id }, 'discord');
  return ephemeralReply(removed ? '已解绑。想重新绑定随时用 /link。' : '你还没有绑定 Nanako 账号。');
}

async function handleScore(input: CommandInput, ctx: BotContext): Promise<BotReply> {
  const target = await resolveTarget(input, ctx);
  if (!target.user) return unboundTarget(target);
  const user = target.user;
  const name = safeLine(user.username, NAME_MAX);

  if (!target.self) {
    // Someone else: name and score only. The tier is for its owner alone.
    return ephemeralReply(undefined, {
      embeds: [{ title: name, description: `信誉分 **${user.score}**` }],
      buttons: [webButton(ctx)],
    });
  }

  const tier = tierFor(user.score);
  const [counts, invites] = await Promise.all([pendingCounts(ctx.db, user), listMyInvites(ctx.db, user.id)]);
  const lines = [`**${user.score}** 分 · ${tier.emoji} ${tier.name}`, tier.blurb];
  if (!user.is_participant) lines.push('你目前不是上榜选手。');
  const embed: BotEmbed = {
    title: `${name} 的信誉分`,
    description: lines.join('\n'),
    color: scoreColor(user.score),
    fields: [
      { name: '待写陈述', value: `${counts.statements} 件`, inline: true },
      { name: '待回应的约局', value: `${invites.length} 个`, inline: true },
    ],
    ...(counts.statements + invites.length > 0 ? { footer: { text: '用 /todo 查看待办' } } : {}),
  };
  return ephemeralReply(undefined, { embeds: [embed], buttons: [webButton(ctx)] });
}

async function handleTop(_input: CommandInput, ctx: BotContext): Promise<BotReply> {
  const top = (await getLeaderboard(ctx.db)).slice(0, TOP_COUNT);
  if (top.length === 0) return ephemeralReply('榜上还没有选手。');
  const medals = ['🥇', '🥈', '🥉'];
  const lines = top.map((p, i) => {
    // "4. " at a line start would turn into a markdown list, hence the escape.
    const rank = medals[i] ?? `${i + 1}\\.`;
    return `${rank} ${safeLine(p.username, NAME_MAX)} — **${p.score}**`;
  });
  return publicReply(undefined, {
    embeds: [
      {
        title: `🏆 信誉分排行榜 · 前 ${TOP_COUNT}`,
        description: fitLines(lines, LIMITS.embedDescription),
        color: GOLD,
      },
    ],
    buttons: [webButton(ctx, '完整榜单')],
  });
}

async function handleVerdicts(input: CommandInput, ctx: BotContext): Promise<BotReply> {
  const target = await resolveTarget(input, ctx);
  if (!target.user) return unboundTarget(target);
  const who = target.self ? '你' : safeLine(target.user.username, NAME_MAX);
  const records = await listRecords(ctx.db, { subject: target.user.id, status: 'decided', limit: RECENT_VERDICTS });
  if (records.length === 0) return ephemeralReply(`${who}最近没有已判决的记录。`);

  // Fixed fields only — see the header. Nothing a person or the AI wrote.
  const lines = records.map((r) => {
    const parts = [violationLabel(r.type), `${formatDelta(r.delta)} 分`, discordTime(r.created_at, 'd')];
    if (judgedInAbsence(r)) parts.push('缺席判决');
    return parts.join(' · ');
  });
  return ephemeralReply(undefined, {
    embeds: [
      {
        title: `${who}最近的判决`,
        description: fitLines(lines, LIMITS.embedDescription),
        footer: { text: '判词和陈述请到网页查看' },
      },
    ],
    buttons: [webButton(ctx, '在网页查看')],
  });
}

function statementLine(r: RecordItem): string {
  const deadline = r.deadline_at ? ` · 截止 ${discordTime(r.deadline_at, 'R')}` : '';
  const head = `${violationLabel(r.type)}${deadline}`;
  // The case is about the caller and only they see this, so the short
  // description of what they are accused of is shown — it is what they must answer.
  const about = r.claim_summary ?? r.claim;
  return about ? `${head}\n${safeLine(about, SUMMARY_MAX)}` : head;
}

function inviteLine(s: SessionItem): string {
  return [
    `📅 **${safeLine(s.title, TITLE_MAX)}**`,
    discordTime(s.starts_at, 'f'),
    `${safeLine(s.organizer.username, NAME_MAX)} 组织`,
  ].join(' · ');
}

async function handleTodo(input: CommandInput, ctx: BotContext): Promise<BotReply> {
  const user = await boundUser(ctx.db, input.caller.id);
  if (!user) return ephemeralReply(NOT_LINKED);
  const [pending, invites] = await Promise.all([
    listRecords(ctx.db, { pendingFor: user.id }),
    listMyInvites(ctx.db, user.id),
  ]);
  if (pending.length === 0 && invites.length === 0) return ephemeralReply('没有待办，清清爽爽 ✨');

  const fields: BotEmbedField[] = [
    ...(pending.length > 0
      ? [{ name: `待写陈述（${pending.length}）`, value: fitLines(pending.map(statementLine), LIMITS.fieldValue) }]
      : []),
    ...(invites.length > 0
      ? [{ name: `待回应的约局（${invites.length}）`, value: fitLines(invites.map(inviteLine), LIMITS.fieldValue) }]
      : []),
  ];
  const embed: BotEmbed = {
    title: '你的待办',
    color: pending.length > 0 ? RED : GOLD,
    ...(pending.length > 0 ? { description: '陈述要在截止前写，过期会按缺席裁决。' } : {}),
    fields,
  };
  return ephemeralReply(undefined, { embeds: [embed], buttons: [webButton(ctx, '去网页处理')] });
}

async function handleReport(_input: CommandInput, ctx: BotContext): Promise<BotReply> {
  const report = await getLatestReport(ctx.db);
  if (!report) return ephemeralReply('还没有战报。');
  const s = report.stats;
  const fields: BotEmbedField[] = [
    { name: '开局', value: `${s.sessionsPlayed} 局`, inline: true },
    { name: '立案', value: `${s.casesFiled} 起`, inline: true },
    { name: '合计扣分', value: String(s.totalPenalty), inline: true },
    {
      name: '出勤率',
      value: s.attendanceRate === null ? '—' : `${Math.round(s.attendanceRate * 100)}%`,
      inline: true,
    },
  ];
  if (s.star) {
    fields.push({ name: '🏆 本周之星', value: `${safeLine(s.star.name, NAME_MAX)}（${formatDelta(s.star.delta)}）`, inline: true });
  }
  if (s.pigeon) {
    fields.push({ name: '🕊️ 本周鸽王', value: `${safeLine(s.pigeon.name, NAME_MAX)}（${formatDelta(s.pigeon.delta)}）`, inline: true });
  }
  return publicReply(undefined, {
    embeds: [
      {
        title: `📰 周报 · ${dateOnly(report.week_start)} – ${dateOnly(s.weekEnd)}`,
        description: safeText(report.narrative, LIMITS.embedDescription),
        color: GOLD,
        fields,
        footer: { text: report.source === 'ai' ? '数字由系统统计，文字由 AI 撰写' : '数字由系统统计' },
      },
    ],
    buttons: [webButton(ctx, '在网页查看')],
  });
}

type Handler = (input: CommandInput, ctx: BotContext) => Promise<BotReply>;

const HANDLERS: Readonly<Record<string, Handler>> = {
  link: handleLink,
  unlink: handleUnlink,
  score: handleScore,
  top: handleTop,
  verdicts: handleVerdicts,
  todo: handleTodo,
  report: handleReport,
};

/**
 * Answer one slash command. An ApiError's Chinese message is shown to the
 * caller alone; any other error is thrown on for the bot process to log.
 */
export async function handleCommand(input: CommandInput, ctx: BotContext): Promise<BotReply> {
  const handler = Object.prototype.hasOwnProperty.call(HANDLERS, input.commandName)
    ? HANDLERS[input.commandName]
    : undefined;
  if (!handler) return ephemeralReply('未知命令。');
  try {
    return await handler(input, ctx);
  } catch (error) {
    if (error instanceof ApiError) return ephemeralReply(safeLine(error.message, LIMITS.content));
    throw error;
  }
}
