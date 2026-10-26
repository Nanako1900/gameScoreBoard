// Direct messages about a person's own case (P6), rendered from the case's
// current state at delivery time.
//
// A DM goes to the one person the case is about, so unlike the channel post
// it may carry the accusation and the full verdict. Free text still goes
// through render.ts: a claim like "[写陈述](https://evil)" must not become a
// link inside our own message.

import { ButtonStyle, ComponentType, type APIActionRowComponent, type APIButtonComponent } from 'discord.js';
import type { RecordItem } from '../../../worker/types';
import { toEmbed } from './client';
import { violationLabel } from './commands';
import {
  clampEmbed,
  discordTime,
  formatDelta,
  GOLD,
  GREY,
  webUrl,
  LIMITS,
  linkButton,
  parseTimestamp,
  RED,
  safeLine,
  safeText,
} from './render';
import type { BotEmbed } from './types';
import type { ChannelMessage } from './verdict';

const NAME_MAX = 64;
const HEADLINE_MAX = 200;
const CLAIM_MAX = 1500;

export const STATEMENT_BUTTON = 'v1:stmt:';
export const APPEAL_BUTTON = 'v1:appeal:';

export type DmKind = 'dm.filed' | 'dm.deadline' | 'dm.decided' | 'dm.overridden' | 'dm.revoked' | 'dm.withdrawn' | 'dm.appealed';

export const DM_KINDS: readonly DmKind[] = [
  'dm.filed',
  'dm.deadline',
  'dm.decided',
  'dm.overridden',
  'dm.revoked',
  'dm.withdrawn',
  'dm.appealed',
];

export function isDmKind(kind: string): kind is DmKind {
  return (DM_KINDS as readonly string[]).includes(kind);
}

type Button = { label: string; customId: string } | { label: string; url: string };

function message(embed: BotEmbed, buttons: Button[]): ChannelMessage {
  const components: APIActionRowComponent<APIButtonComponent>[] =
    buttons.length === 0
      ? []
      : [
          {
            type: ComponentType.ActionRow,
            components: buttons.map((b) =>
              'url' in b
                ? { type: ComponentType.Button, style: ButtonStyle.Link, label: b.label, url: b.url }
                : { type: ComponentType.Button, style: ButtonStyle.Primary, label: b.label, custom_id: b.customId },
            ),
          },
        ];
  return { embeds: [toEmbed(clampEmbed(embed))], components, allowed_mentions: { parse: [] } };
}

function web(frontendUrl: string, recordId: number): Button {
  return linkButton('在网页查看', webUrl(frontendUrl, { case: recordId }));
}

/** What a DM about a case becomes when the case is deleted (with its user). */
export function removedDm(): ChannelMessage {
  return message({ title: '🗑️ 这条记录已删除', description: '相关的账号和记录已被管理员删除。', color: GREY }, []);
}

/** Whether this DM still says something true about the case right now. */
export function dmStillRelevant(kind: DmKind, record: RecordItem, now = Date.now()): boolean {
  switch (kind) {
    case 'dm.filed':
    case 'dm.deadline': {
      // Asking for a statement only makes sense while one can still be written.
      if (record.status !== 'awaiting_statement') return false;
      const deadline = parseTimestamp(record.deadline_at);
      return Number.isNaN(deadline) ? kind === 'dm.filed' : deadline > now;
    }
    case 'dm.decided':
    case 'dm.overridden':
      return record.status === 'decided' || record.status === 'appealed';
    case 'dm.revoked':
      return record.status === 'revoked';
    case 'dm.withdrawn':
      return record.status === 'withdrawn';
    case 'dm.appealed':
      return record.status === 'appealed';
  }
}

function accusation(record: RecordItem): string {
  return safeText(record.claim_summary ?? record.claim ?? '', CLAIM_MAX) || '（没有写事实描述）';
}

function statementButtons(record: RecordItem, frontendUrl: string): Button[] {
  return [{ label: '写陈述', customId: `${STATEMENT_BUTTON}${record.id}` }, web(frontendUrl, record.id)];
}

function verdictText(record: RecordItem): string {
  if (!record.verdict) return '';
  return [
    `**${safeLine(record.verdict.headline, HEADLINE_MAX)}**`,
    safeText(record.verdict.reasoning, LIMITS.embedDescription - HEADLINE_MAX - 10),
  ].join('\n');
}

/** The DM for one event, or null if this kind has nothing to say to this record. */
export function renderDm(kind: DmKind, record: RecordItem, frontendUrl: string): ChannelMessage | null {
  const type = violationLabel(record.type);
  const points = `${formatDelta(record.delta)} 分`;
  switch (kind) {
    case 'dm.filed':
      return message(
        {
          title: '⚖️ 有人给你立案了',
          description: accusation(record),
          color: RED,
          fields: [
            { name: '类型', value: type, inline: true },
            { name: '立案人', value: safeLine(record.reporter.username, NAME_MAX), inline: true },
            { name: '陈述截止', value: discordTime(record.deadline_at, 'R'), inline: true },
          ],
          footer: { text: '你的陈述会和事实描述一起交给 AI 裁判参考；截止前不写，就按缺席判决。' },
        },
        statementButtons(record, frontendUrl),
      );
    case 'dm.deadline':
      return message(
        {
          title: '⏰ 陈述快截止了',
          description: `${type}的案件还没收到你的陈述，${discordTime(record.deadline_at, 'R')}截止。`,
          color: RED,
          footer: { text: '截止前不写，就按缺席判决。' },
        },
        statementButtons(record, frontendUrl),
      );
    case 'dm.decided':
    case 'dm.overridden': {
      const override = kind === 'dm.overridden';
      const buttons: Button[] = [web(frontendUrl, record.id)];
      // Same rule as the web: a decided case can be appealed.
      if (record.status === 'decided') {
        buttons.unshift({ label: '申诉', customId: `${APPEAL_BUTTON}${record.id}` });
      }
      return message(
        {
          title: override ? `🧑‍⚖️ 管理员改判：${points}` : `⚖️ 判决：${points}`,
          description: verdictText(record),
          color: RED,
          fields: [{ name: '类型', value: type, inline: true }],
          footer: { text: override ? '这是管理员复核后的结果。' : '觉得判得不对可以申诉，由管理员复核。' },
        },
        buttons,
      );
    }
    case 'dm.revoked':
      return message(
        {
          title: '↩️ 判决已撤销',
          description: `${type}的判决撤销了，~~${points}~~ 已退回。`,
          color: GREY,
        },
        [web(frontendUrl, record.id)],
      );
    case 'dm.withdrawn':
      // Replaces the filed DM in place: no buttons left to press.
      return message(
        {
          title: '↩️ 立案已撤回',
          description: `${type}的案件已经撤回，不用再写陈述了。`,
          color: GREY,
        },
        [],
      );
    case 'dm.appealed':
      return message(
        {
          title: '📮 有新的申诉',
          description: `${safeLine(record.subject.username, NAME_MAX)} 对${type}的判决（${points}）提出了申诉。`,
          color: GOLD,
          fields: record.appeal_reason ? [{ name: '理由', value: safeText(record.appeal_reason, LIMITS.fieldValue) }] : [],
          footer: { text: '点「去复核」到网页上这个案件：改判或撤销。' },
        },
        [{ ...web(frontendUrl, record.id), label: '去复核' }],
      );
  }
}
