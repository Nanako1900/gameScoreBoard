// A case's verdict in Discord (P5): the post in the verdict channel, and the
// private "看判词" answer behind its button.
//
// The channel post carries fixed fields only: name (never a mention), type,
// points, whether the subject was judged in absence, a link to the web. No AI
// headline and no reasoning — both are written after reading the statement and
// can carry what the subject told the judge in confidence ("家人住院"). The
// full verdict is shown, privately, to the people the case is about: the
// subject, the reporter, judges and admins.

import {
  ButtonStyle,
  ComponentType,
  type APIActionRowComponent,
  type APIButtonComponent,
  type APIEmbed,
} from 'discord.js';
import { VIOLATION_MAP } from '../../../shared/scoring';
import { getRecordItemById } from '../../../worker/case-reads';
import type { RecordItem } from '../../../worker/types';
import { toEmbed } from './client';
import { boundUser, judgedInAbsence, violationLabel, webButton } from './commands';
import {
  clampEmbed,
  ephemeralReply,
  formatDelta,
  joinUrl,
  LIMITS,
  linkButton,
  RED,
  safeLine,
  safeText,
} from './render';
import type { BotContext, BotEmbed, BotReply, DiscordUserRef } from './types';

/** A revoked verdict: no longer bad news. */
export const GREY = 0x8b8579;

const NAME_MAX = 64;
const HEADLINE_MAX = 200;
const BUTTON_PREFIX = 'v1:verdict:';
const BUTTON_ID = /^v1:verdict:(\d{1,15})$/;

/** Statuses a verdict exists in. An appeal is the subject's business: shown as decided. */
const JUDGED = new Set(['decided', 'appealed', 'revoked']);

export function verdictButtonId(recordId: number): string {
  return `${BUTTON_PREFIX}${recordId}`;
}

/** The record id of a "看判词" button, or null for any other custom_id. */
export function parseVerdictButton(customId: string): number | null {
  const match = BUTTON_ID.exec(customId);
  return match ? Number(match[1]) : null;
}

export function isPenalty(type: string): boolean {
  const def = Object.prototype.hasOwnProperty.call(VIOLATION_MAP, type) ? VIOLATION_MAP[type] : undefined;
  return def?.kind === 'penalty';
}

/** Is this record something the channel shows: a judged penalty? */
export function isPostable(record: RecordItem): boolean {
  return isPenalty(record.type) && JUDGED.has(record.status);
}

function howDecided(record: RecordItem): string {
  if (record.verdict?.source === 'admin_override') return '管理员改判';
  if (judgedInAbsence(record)) return '缺席判决';
  return '当庭判决';
}

/** The fixed-field embed every viewer may see. */
export function verdictEmbed(record: RecordItem): BotEmbed {
  const revoked = record.status === 'revoked';
  const points = `${formatDelta(record.delta)} 分`;
  return {
    title: `⚖️ ${revoked ? '判决已撤销' : '判决'} · ${safeLine(record.subject.username, NAME_MAX)}`,
    color: revoked ? GREY : RED,
    fields: [
      { name: '类型', value: violationLabel(record.type), inline: true },
      { name: '分数', value: revoked ? `~~${points}~~ 已退回` : points, inline: true },
      { name: '方式', value: revoked ? '已撤销' : howDecided(record), inline: true },
    ],
    footer: { text: '判词只给当事人、立案人和裁判看' },
  };
}

export interface ChannelMessage {
  embeds: APIEmbed[];
  components: APIActionRowComponent<APIButtonComponent>[];
  /** The bot never pings anyone, whatever a name contains. */
  allowed_mentions: { parse: [] };
}

/** The channel post for a case, as Discord's REST API takes it. */
export function verdictPost(record: RecordItem, frontendUrl: string): ChannelMessage {
  // The web app has no per-case URL yet: its front page.
  const web = linkButton('在网页查看', joinUrl(frontendUrl, '/'));
  return {
    embeds: [toEmbed(clampEmbed(verdictEmbed(record)))],
    components: [
      {
        type: ComponentType.ActionRow,
        components: [
          { type: ComponentType.Button, style: ButtonStyle.Secondary, label: '看判词', custom_id: verdictButtonId(record.id) },
          { type: ComponentType.Button, style: ButtonStyle.Link, label: web.label, url: web.url },
        ],
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

/**
 * The "看判词" button: the full verdict for the subject, the reporter, judges
 * and admins; the same fixed fields as the post for everyone else.
 */
export async function handleVerdictButton(recordId: number, caller: DiscordUserRef, ctx: BotContext): Promise<BotReply> {
  const record = await getRecordItemById(ctx.db, recordId);
  if (!record || !isPostable(record)) return ephemeralReply('这条判决不存在了。');
  const viewer = await boundUser(ctx.db, caller.id);
  const involved =
    viewer !== null &&
    (viewer.id === record.subject.id || viewer.id === record.reporter.id || viewer.is_judge || viewer.is_admin);

  const embed = verdictEmbed(record);
  if (involved && record.verdict) {
    embed.description = [
      `**${safeLine(record.verdict.headline, HEADLINE_MAX)}**`,
      safeText(record.verdict.reasoning, LIMITS.embedDescription - HEADLINE_MAX - 10),
    ].join('\n');
    embed.footer = { text: '只有你看得到' };
  } else {
    embed.footer = {
      text: viewer
        ? '判词只有当事人、立案人、裁判和管理员能看。'
        : '先用 /link 绑定 Nanako 账号；当事人、立案人和裁判可以在这里看判词。',
    };
  }
  return ephemeralReply(undefined, { embeds: [embed], buttons: [webButton(ctx, '在网页查看')] });
}
