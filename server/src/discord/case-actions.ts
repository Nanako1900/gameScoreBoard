// The buttons on a case DM (P6): 写陈述 and 申诉, each opening a modal, and
// the modal submissions that call the same domain functions as the web —
// submitStatement() (which judges at once) and appealCase().
//
// Pure like commands.ts: a parsed custom_id, the caller and a BotContext in,
// an Action (show this modal / send this reply) out. bot-main.ts does the
// discord.js part. Every check the web makes is made again by the domain
// function itself; the early ones here just give a friendlier answer before
// a modal is opened for nothing.

import { ComponentType, TextInputStyle, type APIModalInteractionResponseCallbackData } from 'discord.js';
import { MAX_NARRATIVE_LEN } from '../../../shared/scoring';
import { getRecordItemById } from '../../../worker/case-reads';
import { appealCase, submitStatement } from '../../../worker/cases';
import { ApiError } from '../../../worker/errors';
import type { Env, RecordItem } from '../../../worker/types';
import { violationLabel } from './commands';
import { boundUser } from './links';
import { APPEAL_BUTTON, STATEMENT_BUTTON } from './dm';
import { ephemeralReply, formatDelta, LIMITS, safeLine } from './render';
import type { BotContext, BotReply, DiscordUserRef } from './types';

export type CaseAction = 'statement' | 'appeal';

export interface ModalSpec {
  customId: string;
  title: string;
  field: { label: string; placeholder: string; required: boolean; maxLength: number };
}

export type ActionResult = { kind: 'modal'; modal: ModalSpec } | { kind: 'reply'; reply: BotReply };

/** The custom_id of the text field inside both modals. */
export const MODAL_FIELD = 'text';

const STATEMENT_MODAL = 'v1:stmtm:';
const APPEAL_MODAL = 'v1:appealm:';
const NOT_LINKED = '你还没有绑定 Nanako 账号，先用 /link 绑定。';
const READ_ONLY_TEXT = '系统维护中（只读），请稍后再试。';
const APPEAL_MAX = 500;
const GONE = '这个案件不存在了。';

const ID = '(\\d{1,15})';
const PATTERNS: ReadonlyArray<[RegExp, CaseAction]> = [
  [new RegExp(`^${STATEMENT_BUTTON}${ID}$`), 'statement'],
  [new RegExp(`^${APPEAL_BUTTON}${ID}$`), 'appeal'],
];
const MODAL_PATTERNS: ReadonlyArray<[RegExp, CaseAction]> = [
  [new RegExp(`^${STATEMENT_MODAL}${ID}$`), 'statement'],
  [new RegExp(`^${APPEAL_MODAL}${ID}$`), 'appeal'],
];

function parse(table: typeof PATTERNS, customId: string): { action: CaseAction; recordId: number } | null {
  for (const [pattern, action] of table) {
    const match = pattern.exec(customId);
    if (match) return { action, recordId: Number(match[1]) };
  }
  return null;
}

/** A 写陈述 / 申诉 button's custom_id, or null. */
export function parseCaseButton(customId: string): { action: CaseAction; recordId: number } | null {
  return parse(PATTERNS, customId);
}

/** The modal those buttons open, once submitted; or null. */
export function parseCaseModal(customId: string): { action: CaseAction; recordId: number } | null {
  return parse(MODAL_PATTERNS, customId);
}

function reply(text: string): ActionResult {
  return { kind: 'reply', reply: ephemeralReply(text) };
}

function refusal(action: CaseAction, record: RecordItem, userId: string): string | null {
  if (record.subject.id !== userId) {
    return action === 'statement' ? '只能为自己的案件写陈述。' : '只能对针对自己的判决申诉。';
  }
  if (action === 'statement' && record.status !== 'awaiting_statement') return '这个案件的陈述阶段已经结束了。';
  if (action === 'appeal' && record.status !== 'decided') return '只有已判决、还没申诉过的案件可以申诉。';
  return null;
}

/** A button was pressed: open the modal, or say why not. */
export async function openCaseAction(
  action: CaseAction,
  recordId: number,
  caller: DiscordUserRef,
  ctx: BotContext,
): Promise<ActionResult> {
  if (ctx.readOnly) return reply(READ_ONLY_TEXT);
  const user = await boundUser(ctx.db, caller.id);
  if (!user) return reply(NOT_LINKED);
  const record = await getRecordItemById(ctx.db, recordId);
  if (!record) return reply(GONE);
  const why = refusal(action, record, user.id);
  if (why) return reply(why);

  const type = violationLabel(record.type).replace(/\*\*/g, '');
  return action === 'statement'
    ? {
        kind: 'modal',
        modal: {
          customId: `${STATEMENT_MODAL}${recordId}`,
          title: `陈述：${type}`.slice(0, 45),
          field: {
            label: '你的陈述（提交后立即裁决，不能修改）',
            placeholder: '发生了什么？有什么原因？会和事实描述一起交给 AI 裁判。',
            required: true,
            maxLength: MAX_NARRATIVE_LEN,
          },
        },
      }
    : {
        kind: 'modal',
        modal: {
          customId: `${APPEAL_MODAL}${recordId}`,
          title: `申诉：${type}`.slice(0, 45),
          field: {
            label: '申诉理由（可不填）',
            placeholder: '为什么觉得判得不对？管理员复核时会看到。',
            required: false,
            maxLength: APPEAL_MAX,
          },
        },
      };
}

/** A modal was submitted: do it, through the same domain code as the web. */
export async function submitCaseAction(
  action: CaseAction,
  recordId: number,
  text: string,
  caller: DiscordUserRef,
  ctx: BotContext & { env: Env },
): Promise<BotReply> {
  if (ctx.readOnly) return ephemeralReply(READ_ONLY_TEXT);
  const user = await boundUser(ctx.db, caller.id);
  if (!user) return ephemeralReply(NOT_LINKED);
  try {
    if (action === 'appeal') {
      await appealCase(ctx.db, user, recordId, text);
      return ephemeralReply('已提交申诉，管理员会复核。结果在网页上能看到（开着私信提醒的话也会私信你）。');
    }
    const record = await submitStatement(ctx.db, user, recordId, text, ctx.env);
    if (record.status === 'decided') {
      return ephemeralReply(
        `已收到你的陈述。判决：**${formatDelta(record.delta)} 分**（${safeLine(record.verdict?.headline ?? '', 120)}）。完整判词在网页上，开着私信提醒的话也会私信你。`,
      );
    }
    return ephemeralReply('已收到你的陈述，正在裁决。结果在网页上能看到（开着私信提醒的话也会私信你）。');
  } catch (error) {
    if (error instanceof ApiError) return ephemeralReply(safeLine(error.message, LIMITS.content));
    throw error;
  }
}

export { GONE as CASE_GONE_TEXT };

/** A one-field modal (写陈述 / 申诉), as Discord's API takes it. */
export function toModal(spec: ModalSpec): APIModalInteractionResponseCallbackData {
  return {
    custom_id: spec.customId,
    title: spec.title.slice(0, 45),
    components: [
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.TextInput,
            custom_id: MODAL_FIELD,
            style: TextInputStyle.Paragraph,
            label: spec.field.label.slice(0, 45),
            placeholder: spec.field.placeholder.slice(0, 100),
            required: spec.field.required,
            min_length: spec.field.required ? 1 : 0,
            max_length: spec.field.maxLength,
          },
        ],
      },
    ],
  };
}

