// Game sessions in Discord (P7): the card in the session channel, the DMs
// about a session, the RSVP buttons on both, and /yue to propose one.
//
// Everything goes through worker/sessions.ts — createSession, setRsvp — the
// same rules as the web (who may RSVP, seat caps, past sessions); this file
// only renders and parses.

import { ButtonStyle, ComponentType, type APIActionRowComponent, type APIButtonComponent } from 'discord.js';
import { RSVP_LABEL, SESSION_CANCEL_REASON_MAX } from '../../../shared/attendance';
import { BOARD_SLOTS, BOARD_SLOT_MIN_LEAD_MS, slotIso } from '../../../shared/quickTime';
import { ApiError } from '../../../worker/errors';
import { createSession, getSessionDetail, setRsvp } from '../../../worker/sessions';
import type { SessionDetail } from '../../../worker/types';
import { toEmbed } from './client';
import { boundUser } from './links';
import {
  clampEmbed,
  discordTime,
  ephemeralReply,
  fitLines,
  GOLD,
  GREY,
  webUrl,
  LIMITS,
  linkButton,
  parseTimestamp,
  safeLine,
} from './render';
import type { BotContext, BotEmbed, BotReply, CommandInput } from './types';
import type { ChannelMessage } from './verdict';

const NAME_MAX = 32;
const TITLE_MAX = 80;
const NOT_LINKED = '你还没有绑定 Nanako 账号，先用 /link 绑定。';
const READ_ONLY_TEXT = '系统维护中（只读），请稍后再试。';

export type RsvpChoice = 'going' | 'maybe' | 'out';
const RSVP_BUTTON = /^v1:rsvp:(\d{1,15}):(going|maybe|out):(\d{1,15})$/;

/**
 * An RSVP button carries the start time it was shown with (ms): an invitation
 * DM is never edited, so after a move its buttons would otherwise answer for
 * people about a time they never saw — setRsvp refuses that (409).
 */
export function rsvpButtonId(session: Pick<SessionDetail, 'id' | 'starts_at'>, choice: RsvpChoice): string {
  return `v1:rsvp:${session.id}:${choice}:${parseTimestamp(session.starts_at)}`;
}

export function parseRsvpButton(customId: string): { sessionId: number; choice: RsvpChoice; startsAt: string } | null {
  const match = RSVP_BUTTON.exec(customId);
  if (!match) return null;
  const shown = new Date(Number(match[3]));
  if (Number.isNaN(shown.getTime())) return null;
  return { sessionId: Number(match[1]), choice: match[2] as RsvpChoice, startsAt: shown.toISOString() };
}

/** The session exactly as the web shows it; null if it is gone. */
export async function loadSession(db: D1Database, id: number): Promise<SessionDetail | null> {
  try {
    return await getSessionDetail(db, id, null);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/** Open and not started yet: RSVPs still mean something. */
export function isUpcoming(session: SessionDetail, now = Date.now()): boolean {
  return session.status === 'open' && parseTimestamp(session.starts_at) > now;
}

function rsvpRow(session: SessionDetail, frontendUrl: string): APIActionRowComponent<APIButtonComponent> {
  const web = linkButton('在网页查看', webUrl(frontendUrl, { session: session.id }));
  const styles: Record<RsvpChoice, ButtonStyle.Success | ButtonStyle.Secondary | ButtonStyle.Danger> = {
    going: ButtonStyle.Success,
    maybe: ButtonStyle.Secondary,
    out: ButtonStyle.Danger,
  };
  return {
    type: ComponentType.ActionRow,
    components: [
      ...(['going', 'maybe', 'out'] as const).map((choice) => ({
        type: ComponentType.Button as const,
        style: styles[choice],
        label: RSVP_LABEL[choice],
        custom_id: rsvpButtonId(session, choice),
      })),
      { type: ComponentType.Button, style: ButtonStyle.Link, label: web.label, url: web.url },
    ],
  };
}

function message(embed: BotEmbed, rows: APIActionRowComponent<APIButtonComponent>[]): ChannelMessage {
  return { embeds: [toEmbed(clampEmbed(embed))], components: rows, allowed_mentions: { parse: [] } };
}

function seats(session: SessionDetail): string {
  const going = session.counts.going;
  return session.capacity === null ? `${going} 人` : `${going}/${session.capacity} 人`;
}

/** The card in the session channel. Buttons only while RSVPs are open. */
export function sessionCard(session: SessionDetail, frontendUrl: string, now = Date.now()): ChannelMessage {
  const upcoming = isUpcoming(session, now);
  const going = session.players.filter((p) => p.rsvp === 'going').map((p) => safeLine(p.user.username, NAME_MAX));
  const state =
    session.status === 'cancelled' ? '已取消' : session.status === 'settled' ? '已结束' : upcoming ? '报名中' : '已开局';
  const title = `📅 ${safeLine(session.title, TITLE_MAX)}`;
  const embed: BotEmbed = {
    title: session.status === 'cancelled' ? `~~${title}~~` : title,
    color: upcoming ? GOLD : GREY,
    description: [
      `${discordTime(session.starts_at, 'F')}（${discordTime(session.starts_at, 'R')}）`,
      session.game ? `🎮 ${safeLine(session.game, TITLE_MAX)}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
    fields: [
      { name: '组织者', value: safeLine(session.organizer.username, NAME_MAX), inline: true },
      { name: RSVP_LABEL.going, value: seats(session), inline: true },
      { name: RSVP_LABEL.maybe, value: `${session.counts.maybe} 人`, inline: true },
      { name: '报名的人', value: going.length > 0 ? fitLines(going, LIMITS.fieldValue) : '—' },
    ],
    footer: { text: state },
  };
  return message(embed, upcoming ? [rsvpRow(session, frontendUrl)] : []);
}

export type SessionDmKind =
  | 'dm.session.invited'
  | 'dm.session.starting'
  | 'dm.session.changed'
  | 'dm.session.cancelled'
  | 'dm.session.rollcall';

export const SESSION_DM_KINDS: readonly SessionDmKind[] = [
  'dm.session.invited',
  'dm.session.starting',
  'dm.session.changed',
  'dm.session.cancelled',
  'dm.session.rollcall',
];

export function isSessionDmKind(kind: string): kind is SessionDmKind {
  return (SESSION_DM_KINDS as readonly string[]).includes(kind);
}

/**
 * Whether this DM is still true for this recipient right now: an invitation
 * only while they have not answered, a reminder only while they are going, a
 * roll call only until it is done.
 */
export function sessionDmRelevant(kind: SessionDmKind, session: SessionDetail, userId: string, now = Date.now()): boolean {
  const rsvp = session.players.find((p) => p.user.id === userId)?.rsvp ?? null;
  switch (kind) {
    case 'dm.session.invited':
      return isUpcoming(session, now) && rsvp === 'invited';
    case 'dm.session.starting':
      return isUpcoming(session, now) && rsvp === 'going';
    case 'dm.session.changed':
      return isUpcoming(session, now) && rsvp !== null && rsvp !== 'out';
    case 'dm.session.cancelled':
      // News while it was still ahead; not for one that already happened.
      return session.status === 'cancelled' && parseTimestamp(session.starts_at) > now;
    case 'dm.session.rollcall':
      return session.status === 'open' && session.organizer.id === userId;
  }
}

export function renderSessionDm(kind: SessionDmKind, session: SessionDetail, frontendUrl: string): ChannelMessage {
  const title = safeLine(session.title, TITLE_MAX);
  const when = `${discordTime(session.starts_at, 'F')}（${discordTime(session.starts_at, 'R')}）`;
  const organizer = safeLine(session.organizer.username, NAME_MAX);
  const web = { type: ComponentType.ActionRow as const, components: [webLink(frontendUrl, session.id)] };
  switch (kind) {
    case 'dm.session.invited':
      return message(
        { title: `📨 ${organizer} 约你：${title}`, description: when, color: GOLD, fields: [{ name: RSVP_LABEL.going, value: seats(session), inline: true }] },
        [rsvpRow(session, frontendUrl)],
      );
    case 'dm.session.starting':
      return message({ title: `⏰ 15 分钟后开局：${title}`, description: when, color: GOLD }, [web]);
    case 'dm.session.changed':
      return message(
        { title: `🔁 约局改时间了：${title}`, description: `新的时间：${when}`, color: GOLD },
        [rsvpRow(session, frontendUrl)],
      );
    case 'dm.session.cancelled': {
      // P2-3: the organizer's reason, when there is one, on a line of its own.
      const said = `原定 ${when}，由 ${organizer} 取消。`;
      const reason = session.cancel_reason ? safeLine(session.cancel_reason, SESSION_CANCEL_REASON_MAX) : '';
      const description = reason ? `${said}\n理由：${reason}` : said;
      return message({ title: `🚫 约局取消了：${title}`, description, color: GREY }, [web]);
    }
    case 'dm.session.rollcall':
      return message(
        {
          title: `📋 该点名了：${title}`,
          description: '局结束了，去网页点名：谁准时、谁迟到、谁没来，结算后才会记分。',
          color: GOLD,
        },
        [web],
      );
  }
}

function webLink(frontendUrl: string, sessionId: number): APIButtonComponent {
  const web = linkButton('去网页', webUrl(frontendUrl, { session: sessionId }));
  return { type: ComponentType.Button, style: ButtonStyle.Link, label: web.label, url: web.url };
}

/** An RSVP button on a card or an invitation. */
/** A button press: `shownStartsAt` is the start time the button was made for. */
export async function handleRsvpButton(
  sessionId: number,
  choice: RsvpChoice,
  shownStartsAt: string,
  caller: { id: string; username: string },
  ctx: BotContext,
): Promise<BotReply> {
  if (ctx.readOnly) return ephemeralReply(READ_ONLY_TEXT);
  const user = await boundUser(ctx.db, caller.id);
  if (!user) return ephemeralReply(NOT_LINKED);
  try {
    const session = await setRsvp(ctx.db, user, sessionId, choice, shownStartsAt);
    return ephemeralReply(`已登记：**${RSVP_LABEL[choice]}**。现在来 ${seats(session)}。`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      // The session moved since this button was made.
      const now = await loadSession(ctx.db, sessionId);
      const when = now ? `现在是 ${discordTime(now.starts_at, 'F')}（${discordTime(now.starts_at, 'R')}）。` : '';
      const where = ctx.sessionCards ? '约局频道里更新后的卡片、或网页' : '网页';
      return ephemeralReply(`🔁 这个约局改时间了，${when}请在${where}上按新时间重新选。`, {
        buttons: [linkButton('去网页', webUrl(ctx.frontendUrl, { session: sessionId }))],
      });
    }
    if (error instanceof ApiError) return ephemeralReply(safeLine(error.message, LIMITS.content));
    throw error;
  }
}

// --- /yue ----------------------------------------------------------------------

/** The `when` choices of /yue, in the board's time zone (RESET_TZ_OFFSET): the web's quick picks too (shared/quickTime). */
export const YUE_SLOTS = BOARD_SLOTS;

/** `dayOffset` days from today at `hour`:00, board-local, as an ISO instant. Lives in shared/quickTime now. */
export { slotIso };

/** /yue: propose a session. The card is posted by the dispatcher, like any new session. */
export async function handleYue(input: CommandInput, ctx: BotContext & { offsetHours: number }): Promise<BotReply> {
  if (ctx.readOnly) return ephemeralReply(READ_ONLY_TEXT);
  const user = await boundUser(ctx.db, input.caller.id);
  if (!user) return ephemeralReply(NOT_LINKED);
  if (!user.is_participant) return ephemeralReply('只有上榜选手可以发起约局（网页上可以改身份）。');
  const slot = YUE_SLOTS.find((s) => s.value === input.when) ?? YUE_SLOTS[0];
  const startsAt = slotIso(slot.dayOffset, slot.hour, ctx.offsetHours);
  if (Date.parse(startsAt) < Date.now() + BOARD_SLOT_MIN_LEAD_MS) {
    return ephemeralReply(`${slot.name} 已经过了（或马上就到），换个时间吧。`);
  }
  try {
    const session = await createSession(
      ctx.db,
      user,
      { starts_at: startsAt, ...(input.capacity ? { capacity: input.capacity } : {}) },
      ctx.offsetHours,
    );
    const where = ctx.sessionCards
      ? '卡片会发到约局频道，大家可以直接点按钮报名。'
      : '在网页上可以看到它、邀请人。';
    return ephemeralReply(
      `已发起约局：**${safeLine(session.title, TITLE_MAX)}**，${discordTime(session.starts_at, 'F')}。${where}`,
    );
  } catch (error) {
    if (error instanceof ApiError) return ephemeralReply(safeLine(error.message, LIMITS.content));
    throw error;
  }
}
