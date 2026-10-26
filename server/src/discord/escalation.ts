// The AI's escalation hint in Discord (P8): when the classifier thinks a case
// is a 团灭级放鸽 but filed the lesser charge, the judge who filed it gets a DM
// to confirm or dismiss — the same confirmEscalation / dismissEscalation the
// web calls, with the same rules. When the hint is settled any way at all (here,
// on the web, by a withdrawal or the case going to judgment) the DM is
// rewritten without its buttons.
//
// The DM goes to the reporter, who wrote the accusation: showing it to them is
// fine. It never carries a statement or a verdict.

import { VIOLATION_MAP } from '../../../shared/scoring';
import { ESCALATION_ONLY } from '../../../worker/ai/classify';
import { getRecordItemById } from '../../../worker/case-reads';
import { confirmEscalation, dismissEscalation } from '../../../worker/cases';
import { ApiError } from '../../../worker/errors';
import type { RecordItem } from '../../../worker/types';
import { violationLabel } from './commands';
import { dmMessage, web } from './dm';
import { boundUser } from './links';
import { discordTime, ephemeralReply, GOLD, GREY, LIMITS, safeLine, safeText } from './render';
import type { BotContext, BotReply, DiscordUserRef } from './types';
import type { ChannelMessage } from './verdict';

const NAME_MAX = 64;
const CLAIM_MAX = 1500;
const BUTTON = /^v1:esc:(\d{1,15}):(ok|no)$/;
const NOT_LINKED = '你还没有绑定 Nanako 账号，先用 /link 绑定。';
const READ_ONLY_TEXT = '系统维护中（只读），请稍后再试。';

export type EscalationChoice = 'ok' | 'no';

export function escalationButtonId(recordId: number, choice: EscalationChoice): string {
  return `v1:esc:${recordId}:${choice}`;
}

export function parseEscalationButton(customId: string): { recordId: number; choice: EscalationChoice } | null {
  const match = BUTTON.exec(customId);
  return match ? { recordId: Number(match[1]), choice: match[2] as EscalationChoice } : null;
}

/** Is the hint still waiting for the judge? */
export function escalationOpen(record: RecordItem): boolean {
  return record.status === 'awaiting_statement' && record.escalation_suggested;
}

function range(type: string): string {
  const def = VIOLATION_MAP[type];
  return def ? `${def.min} ~ ${def.max}` : '—';
}

/** The ask, to the judge who filed the case. */
export function renderEscalationDm(record: RecordItem, frontendUrl: string): ChannelMessage {
  const claim = safeText(record.claim_summary ?? record.claim ?? '', CLAIM_MAX) || '（没有写事实描述）';
  const deadline = record.deadline_at ? `\n\n⏳ 被告陈述截止 ${discordTime(record.deadline_at, 'R')}` : '';
  return dmMessage(
    {
      title: '🧨 AI 建议升级为「团灭级放鸽」',
      description: `${claim}${deadline}`,
      color: GOLD,
      fields: [
        { name: '被告', value: safeLine(record.subject.username, NAME_MAX), inline: true },
        { name: '现在的案由', value: `${violationLabel(record.type)}（${range(record.type)}）`, inline: true },
        { name: '建议', value: `${violationLabel(ESCALATION_ONLY)}（${range(ESCALATION_ONLY)}）`, inline: true },
      ],
      footer: { text: '只能在被告陈述前处理；确认后按新案由审理。' },
    },
    [
      { label: '确认升级', customId: escalationButtonId(record.id, 'ok'), style: 'danger' },
      { label: '维持原案由', customId: escalationButtonId(record.id, 'no'), style: 'secondary' },
      web(frontendUrl, record.id),
    ],
  );
}

/** The same DM once the hint is settled: what became of it, no buttons. */
export function renderEscalationClosed(record: RecordItem): ChannelMessage {
  const outcome =
    record.status === 'withdrawn'
      ? '案件已撤回。'
      : record.status !== 'awaiting_statement'
        ? '已进入裁决，升级建议不再适用；要改判请找管理员。'
        : record.type === ESCALATION_ONLY
          ? `已升级为 ${violationLabel(ESCALATION_ONLY)}。`
          : `维持原案由：${violationLabel(record.type)}。`;
  return dmMessage(
    {
      title: '🧨 升级建议已处理',
      description: `${safeLine(record.subject.username, NAME_MAX)} 的案件：${outcome}`,
      color: GREY,
    },
    [],
  );
}

/** [确认升级] / [维持原案由] pressed in the DM. */
export async function handleEscalationButton(
  recordId: number,
  choice: EscalationChoice,
  caller: DiscordUserRef,
  ctx: BotContext,
): Promise<BotReply> {
  if (ctx.readOnly) return ephemeralReply(READ_ONLY_TEXT);
  const user = await boundUser(ctx.db, caller.id);
  if (!user) return ephemeralReply(NOT_LINKED);
  const record = await getRecordItemById(ctx.db, recordId);
  if (!record) return ephemeralReply('这个案件不存在了。');
  // An admin's powers stay behind the web login: here only the filing judge acts.
  if (record.reporter.id !== user.id) {
    return ephemeralReply('只有立案的裁判可以在这里处理；管理员请到网页上操作。');
  }
  try {
    if (choice === 'ok') {
      await confirmEscalation(ctx.db, user, recordId);
      return ephemeralReply(`已确认：按 ${violationLabel(ESCALATION_ONLY)} 审理。`);
    }
    await dismissEscalation(ctx.db, user, recordId);
    return ephemeralReply(`已维持原案由：${violationLabel(record.type)}。`);
  } catch (error) {
    if (error instanceof ApiError) return ephemeralReply(safeLine(error.message, LIMITS.content));
    throw error;
  }
}
