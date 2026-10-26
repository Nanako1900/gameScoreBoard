// The glue between discord.js and the slash-command handlers. Handlers
// (commands.ts) only ever see plain data — CommandInput in, BotReply out — so
// they test without Discord; this file turns a real interaction into that
// input, a reply back into discord.js options, and makes sure every
// interaction gets exactly one answer inside Discord's 3 s window.
//
// Also the bot process's start-up checks (config, gateway session budget),
// kept here so they are testable without starting the process.

import {
  Routes,
  ButtonStyle,
  ComponentType,
  MessageFlags,
  type APIActionRowComponent,
  type APIButtonComponentWithURL,
  type APIEmbed,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type InteractionReplyOptions,
  type REST,
  type User,
} from 'discord.js';
import type { ChannelApi } from '../outbox/dispatcher';
import type { BotContext, BotEmbed, BotReply, CommandInput, DiscordUserRef } from './types';

export type CommandHandler = (input: CommandInput, ctx: BotContext) => Promise<BotReply>;

/** What respond() can answer: a slash command or a button press. */
export type Answerable = ChatInputCommandInteraction | ButtonInteraction;

export const ERROR_TEXT = '出错了，请稍后再试';
export const WRONG_GUILD_TEXT = '这个 bot 只在 EDG 服务器里用。';

/** Discord wants an ack within 3 s; past this the reply is deferred and sent as an edit. */
export const DEFER_AFTER_MS = 2_000;

// Discord rejects a whole message (400) when any one limit is exceeded, which
// would turn a long leaderboard into "出错了". Clip instead.
const LIMITS = {
  content: 2000,
  embeds: 10,
  title: 256,
  description: 4096,
  fields: 25,
  fieldName: 256,
  fieldValue: 1024,
  footer: 2048,
  buttonsPerRow: 5,
  buttonLabel: 80,
} as const;

/** Keeps whole code points, so a cut never leaves half a surrogate pair. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = '';
  for (const ch of text) {
    if (out.length + ch.length > max - 1) break;
    out += ch;
  }
  return `${out}…`;
}

/** Discord refuses empty field names/values; a zero-width space keeps the layout. */
const nonEmpty = (text: string): string => (text.trim() ? text : '\u200b');

function toUserRef(user: Pick<User, 'id' | 'username'>): DiscordUserRef {
  return { id: user.id, username: user.username };
}

export function toCommandInput(interaction: ChatInputCommandInteraction): CommandInput {
  // null when the command has no `user` option or it was left out.
  const target = interaction.options.getUser('user');
  return {
    commandName: interaction.commandName,
    caller: toUserRef(interaction.user),
    targetUser: target ? toUserRef(target) : null,
  };
}

export function toEmbed(embed: BotEmbed): APIEmbed {
  const fields = (embed.fields ?? []).slice(0, LIMITS.fields).map((field) => ({
    name: nonEmpty(clip(field.name, LIMITS.fieldName)),
    value: nonEmpty(clip(field.value, LIMITS.fieldValue)),
    ...(field.inline !== undefined ? { inline: field.inline } : {}),
  }));
  return {
    ...(embed.title !== undefined ? { title: clip(embed.title, LIMITS.title) } : {}),
    ...(embed.description !== undefined ? { description: clip(embed.description, LIMITS.description) } : {}),
    ...(embed.url !== undefined ? { url: embed.url } : {}),
    ...(embed.color !== undefined ? { color: embed.color } : {}),
    ...(fields.length > 0 ? { fields } : {}),
    ...(embed.footer ? { footer: { text: clip(embed.footer.text, LIMITS.footer) } } : {}),
  };
}

function toButtonRow(buttons: NonNullable<BotReply['buttons']>): APIActionRowComponent<APIButtonComponentWithURL> {
  return {
    type: ComponentType.ActionRow,
    components: buttons.slice(0, LIMITS.buttonsPerRow).map((button) => ({
      type: ComponentType.Button,
      style: ButtonStyle.Link,
      label: clip(button.label, LIMITS.buttonLabel),
      url: button.url,
    })),
  };
}

export function toReplyOptions(reply: BotReply): InteractionReplyOptions {
  const embeds = reply.embeds ?? [];
  const buttons = reply.buttons ?? [];
  return {
    ...(reply.content ? { content: clip(reply.content, LIMITS.content) } : {}),
    ...(embeds.length > 0 ? { embeds: embeds.slice(0, LIMITS.embeds).map(toEmbed) } : {}),
    ...(buttons.length > 0 ? { components: [toButtonRow(buttons)] } : {}),
    ...(reply.ephemeral ? { flags: MessageFlags.Ephemeral } : {}),
    // The bot never pings anyone, whatever a display name or AI text contains.
    allowedMentions: { parse: [] },
  };
}

const ERROR_REPLY: InteractionReplyOptions = {
  content: ERROR_TEXT,
  flags: MessageFlags.Ephemeral,
  allowedMentions: { parse: [] },
};

// Interaction and webhook URLs carry the interaction token in their path, and
// a DiscordAPIError keeps that URL; the bot token has a fixed three-part shape.
const TOKEN_IN_PATH = /\/(interactions|webhooks)\/(\d+)\/[^/\s?#'"]+/g;
const BOT_TOKEN = /[\w-]{23,}\.[\w-]{6,}\.[\w-]{27,}/g;

/**
 * A log line for any thrown value, with tokens scrubbed. Logs the message and
 * stack only — never the error object itself, whose url/requestBody fields
 * would be printed by console.error.
 */
export function describeError(error: unknown): string {
  let text: string;
  if (error instanceof Error) {
    text = error.stack ?? `${error.name}: ${error.message}`;
    const { code, status } = error as { code?: unknown; status?: unknown };
    const extra = [code !== undefined && `code ${String(code)}`, status !== undefined && `HTTP ${String(status)}`]
      .filter(Boolean)
      .join(', ');
    if (extra) text += ` (${extra})`;
  } else {
    text = String(error);
  }
  return text.replace(TOKEN_IN_PATH, '/$1/$2/[redacted]').replace(BOT_TOKEN, '[redacted]');
}

// Retrying makes no sense once Discord says the interaction is gone (10062:
// unknown interaction, i.e. past 3 s) or already answered (40060).
const DEAD_INTERACTION = new Set([10062, 40060]);

function isDeadInteraction(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'number' && DEAD_INTERACTION.has(code);
}

async function deliver(
  interaction: Answerable,
  options: InteractionReplyOptions,
  deferred: boolean,
): Promise<void> {
  if (!deferred) {
    await interaction.reply(options);
    return;
  }
  // The defer already fixed the message as ephemeral; an edit cannot change flags.
  await interaction.editReply({
    content: options.content,
    embeds: options.embeds ?? [],
    components: options.components ?? [],
    allowedMentions: options.allowedMentions,
  });
}

type Outcome = { ok: true; reply: BotReply } | { ok: false; error: unknown };

export interface RespondOptions {
  deferAfterMs?: number;
  /** When set, an interaction from anywhere else (another server, a DM) only gets WRONG_GUILD_TEXT. */
  guildId?: string;
}

/**
 * Runs `handler` for one slash command and answers the interaction exactly
 * once. Never rejects: failures are logged (without tokens) and turned into an
 * ephemeral "出错了，请稍后再试".
 *
 * A handler slower than 2 s gets the interaction deferred — as ephemeral,
 * because the reply's visibility is not known yet and a private answer must
 * never end up in the channel. The price: a slow public reply (/top) lands
 * privately for that one call.
 */
export async function respond(
  interaction: ChatInputCommandInteraction,
  ctx: BotContext,
  handler: CommandHandler,
  options: RespondOptions = {},
): Promise<void> {
  await answer(interaction, `/${interaction.commandName}`, () => handler(toCommandInput(interaction), ctx), options);
}

/**
 * The same, for any interaction: `run` produces the reply, `label` names the
 * interaction in the logs (a command, a button).
 */
export async function answer(
  interaction: Answerable,
  label: string,
  run: () => Promise<BotReply>,
  options: RespondOptions = {},
): Promise<void> {
  const command = label;
  if (options.guildId !== undefined && interaction.guildId !== options.guildId) {
    // Commands are only registered in our guild, but a stray global command or
    // a second install must never read scores out to another server.
    try {
      await interaction.reply({ ...ERROR_REPLY, content: WRONG_GUILD_TEXT });
    } catch (error) {
      console.error(`${command}: could not turn away an interaction from another guild`, describeError(error));
    }
    return;
  }
  // Settled as data, so a rejection while we are busy deferring is never unhandled.
  const settled: Promise<Outcome> = Promise.resolve()
    .then(run)
    .then(
      (reply) => ({ ok: true as const, reply }),
      (error: unknown) => ({ ok: false as const, error }),
    );

  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<'slow'>((resolve) => {
    timer = setTimeout(() => resolve('slow'), options.deferAfterMs ?? DEFER_AFTER_MS);
  });
  let outcome = await Promise.race([settled, slow]);
  clearTimeout(timer);

  let deferred = false;
  if (outcome === 'slow') {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      deferred = true;
    } catch (error) {
      console.error(`${command}: could not defer the reply`, describeError(error));
    }
    outcome = await settled;
    // Without an ack nothing can be sent any more; just log what happened.
    if (!deferred) {
      if (!outcome.ok) console.error(`${command} failed`, describeError(outcome.error));
      return;
    }
  }

  if (outcome.ok) {
    try {
      await deliver(interaction, toReplyOptions(outcome.reply), deferred);
      return;
    } catch (error) {
      console.error(`${command}: could not send the reply`, describeError(error));
      if (isDeadInteraction(error)) return;
    }
  } else {
    console.error(`${command} failed`, describeError(outcome.error));
  }

  try {
    await deliver(interaction, ERROR_REPLY, deferred);
  } catch (error) {
    console.error(`${command}: could not send the error reply`, describeError(error));
  }
}

// --- Bot process start-up ---------------------------------------------------

export interface BotConfig {
  token: string;
  appId: string;
  guildId: string;
  databaseUrl: string;
  /** Origin without a trailing slash, e.g. https://api.nanako.org. */
  appUrl: string;
  frontendUrl: string;
  /** Where verdicts are posted (P5); null leaves the broadcast off. */
  verdictChannelId: string | null;
}

const SNOWFLAKE = /^\d{17,20}$/;

function httpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return value.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/** Reads and validates the bot's environment; throws one error naming every problem. */
export function readBotConfig(env: Record<string, string | undefined>): BotConfig {
  const get = (name: string): string => (env[name] ?? '').trim();
  const problems: string[] = [];

  const token = get('DISCORD_TOKEN');
  // Never echo the value: it is the one secret that controls the bot.
  if (!token) problems.push('DISCORD_TOKEN is missing');
  else if (/\s/.test(token)) problems.push("DISCORD_TOKEN must be the bare token (no 'Bot ' prefix, no spaces)");

  const snowflake = (name: string): string => {
    const value = get(name);
    if (!SNOWFLAKE.test(value)) problems.push(`${name} must be a Discord id (17–20 digits), got "${value}"`);
    return value;
  };
  const appId = snowflake('DISCORD_APP_ID');
  const guildId = snowflake('GUILD_ID');

  const databaseUrl = get('DATABASE_URL');
  if (!/^postgres(ql)?:\/\//.test(databaseUrl)) problems.push('DATABASE_URL must be a postgres:// URL');

  const url = (name: string): string => {
    const value = httpUrl(get(name));
    if (!value) problems.push(`${name} must be an http(s) URL, got "${get(name)}"`);
    return value ?? '';
  };
  const appUrl = url('APP_URL');
  const frontendUrl = url('FRONTEND_URL');

  const channel = get('DISCORD_VERDICT_CHANNEL_ID');
  if (channel && !SNOWFLAKE.test(channel)) {
    problems.push(`DISCORD_VERDICT_CHANNEL_ID must be a channel id (17–20 digits) or empty, got "${channel}"`);
  }
  const verdictChannelId = channel || null;

  if (problems.length > 0) {
    // Bad values are echoed to help fixing them, so a token pasted into the
    // wrong variable (GUILD_ID, say) would be too — scrub it.
    const message = `invalid bot configuration: ${problems.join('; ')}`;
    throw new Error((token ? message.split(token).join('[redacted]') : message).replace(BOT_TOKEN, '[redacted]'));
  }
  return { token, appId, guildId, databaseUrl, appUrl, frontendUrl, verdictChannelId };
}

export const GATEWAY_BOT_URL = 'https://discord.com/api/v10/gateway/bot';

/**
 * Below this many IDENTIFYs left for the day the bot refuses to log in: when
 * the daily budget (normally 1000) runs out, Discord resets the bot token, and
 * a crash loop burns through it in hours.
 */
export const MIN_SESSION_STARTS = 50;

export interface SessionBudget {
  total: number;
  remaining: number;
  /** Until the budget refills. */
  resetAfterMs: number;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export async function fetchSessionBudget(token: string, fetchImpl: FetchLike = fetch): Promise<SessionBudget> {
  const res = await fetchImpl(GATEWAY_BOT_URL, {
    headers: { Authorization: `Bot ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const hint = res.status === 401 ? ' (DISCORD_TOKEN is wrong or was reset)' : '';
    throw new Error(`GET /gateway/bot answered HTTP ${res.status}${hint}`);
  }
  const body = (await res.json()) as { session_start_limit?: Record<string, unknown> };
  const limit = body.session_start_limit ?? {};
  const { total, remaining, reset_after: resetAfter } = limit;
  if (typeof total !== 'number' || typeof remaining !== 'number' || typeof resetAfter !== 'number') {
    throw new Error('GET /gateway/bot: no session_start_limit in the response');
  }
  return { total, remaining, resetAfterMs: resetAfter };
}

// --- Channel messages (the outbox dispatcher) ---------------------------------

/** Posting and editing channel messages through the logged-in client's REST. */
export function restChannelApi(rest: REST): ChannelApi {
  return {
    async send(channelId, message) {
      const sent = (await rest.post(Routes.channelMessages(channelId), { body: message })) as { id: string };
      return { id: sent.id };
    },
    async edit(channelId, messageId, message) {
      await rest.patch(Routes.channelMessage(channelId, messageId), { body: message });
    },
  };
}
