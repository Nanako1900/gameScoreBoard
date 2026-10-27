// The contract between the slash-command handlers (commands.ts, pure and
// testable without Discord) and the bot process (bot-main.ts, which talks to
// Discord through discord.js and turns these into real interaction replies).

/** A Discord user as an interaction shows it. */
export interface DiscordUserRef {
  id: string;
  username: string;
}

/** What a handler needs to know about the slash command that was used. */
export interface CommandInput {
  commandName: string;
  /** Who used the command. */
  caller: DiscordUserRef;
  /** The `user` option, for commands that take one (/score, /verdicts, /voice). */
  targetUser: DiscordUserRef | null;
  /** The `state` option of /notify ('on' | 'off'); null for every other command. */
  state?: string | null;
  /** Optional integer days for /voice; omitted uses the command default. */
  days?: number;
}

/** Everything handlers may touch. */
export interface BotContext {
  /** PostgreSQL through the D1-compatible adapter — the same DB the API uses. */
  db: D1Database;
  /** Public API origin, e.g. https://capi.nanako.org (binding pages live there). */
  appUrl: string;
  /** Public SPA origin, e.g. https://community.nanako.org (links into the web app). */
  frontendUrl: string;
  /** READ_ONLY maintenance: commands that write answer with a notice instead. */
  readOnly?: boolean;
  /** The board's time zone (RESET_TZ_OFFSET). */
  offsetHours?: number;
}

export interface BotEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface BotEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: BotEmbedField[];
  footer?: { text: string };
}

export interface BotLinkButton {
  label: string;
  url: string;
}

/**
 * A reply, in plain data. bot-main.ts maps it onto discord.js: `ephemeral`
 * becomes MessageFlags.Ephemeral, `buttons` become one row of Link buttons,
 * and every reply is sent with allowedMentions: { parse: [] } — the bot never
 * pings anyone.
 */
export interface BotReply {
  content?: string;
  embeds?: BotEmbed[];
  buttons?: BotLinkButton[];
  ephemeral: boolean;
}
