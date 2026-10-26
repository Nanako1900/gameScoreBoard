// Text for Discord. Everything a user or the AI wrote — display names, session
// titles, claims, the weekly narrative — goes through safeText()/safeLine()
// before it is put into a reply (design doc §4.6). Discord renders markdown,
// masked links, auto-linked URLs and mention syntax inside message content and
// embeds alike, so a display name like "[写陈述](https://evil)" or "@everyone"
// must arrive as inert text.
//
// The reply's own markup (bold labels, <t:…> timestamps, our own links) is
// built by the handlers around already-safe pieces and never passes through
// here, which is what keeps it working.

import type { BotEmbed, BotEmbedField, BotLinkButton, BotReply } from './types';

/** Scoreboard theme (src/theme.css): gold for good news, red for bad. */
export const GOLD = 0xf5c542;
export const RED = 0xe5484d;

/** Discord's hard limits; a reply over any of them is rejected outright. */
export const LIMITS = {
  content: 2000,
  embedTitle: 256,
  embedDescription: 4096,
  embedFields: 25,
  fieldName: 256,
  fieldValue: 1024,
  footer: 2048,
  /** All text of one embed together. */
  embedTotal: 6000,
  embeds: 10,
  buttonLabel: 80,
  buttons: 5,
  url: 512,
} as const;

const ZWSP = '\u200b';

/** C0 controls except \n and \t, DEL, and bidi overrides that can make text read backwards. */
const INVISIBLE = /[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g;

/** Characters Discord's markdown gives a meaning to. [ ] are handled separately. */
const MARKDOWN = /[\\*_~`|>#\-()]/g;

function clean(text: string | null | undefined): string {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(INVISIBLE, '');
}

/**
 * Make untrusted text inert. Order matters: brackets become full-width first,
 * so no masked link can survive; the backslash escapes come before the
 * zero-width breaks so those never get escaped themselves.
 */
function neutralise(text: string): string {
  return (
    text
      // Full-width brackets read the same but can never open a masked link.
      .replace(/\[/g, '［')
      .replace(/]/g, '］')
      .replace(MARKDOWN, (ch) => `\\${ch}`)
      // "1. " at the start of a line would become an ordered list.
      .replace(/^(\s*\d+)\./gm, '$1\\.')
      // Break every scheme separator so nothing auto-links or embeds.
      .replace(/:\/\//g, `:${ZWSP}//`)
      // @everyone / @here would ping in content, <@…> <#…> <t:…> render as
      // mentions anywhere. A zero-width space keeps them as plain text even if
      // a reply is ever sent without allowedMentions.
      .replace(/@(everyone|here)/gi, `@${ZWSP}$1`)
      .replace(/</g, `<${ZWSP}`)
  );
}

/**
 * Cut `text` to `max` UTF-16 units (Discord counts no more than that), ending
 * in '…'. Never leaves half a surrogate pair or a dangling escape backslash.
 * For text that is already safe; it adds no escaping of its own.
 */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return '…'.slice(0, Math.max(0, max));
  let cut = text.slice(0, max - 1);
  if (/[\ud800-\udbff]$/.test(cut)) cut = cut.slice(0, -1);
  const backslashes = /\\+$/.exec(cut)?.[0].length ?? 0;
  if (backslashes % 2 === 1) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/** Untrusted multi-line text (e.g. the weekly narrative), escaped and cut to `max`. */
export function safeText(text: string | null | undefined, max: number = LIMITS.embedDescription): string {
  return truncate(neutralise(clean(text).trim()), max);
}

/** Untrusted single-line text (names, titles): newlines collapse to one space. */
export function safeLine(text: string | null | undefined, max: number = LIMITS.fieldValue): string {
  const line = clean(text).replace(/\s*\n\s*/g, ' ').trim();
  return truncate(neutralise(line), max);
}

/** '+3' / '-5' / '0', like the web's fmtDelta. */
export function formatDelta(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/** SQLite datetime('now') shape: UTC, no 'T', no zone. */
const SQLITE_DATETIME = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/;

/** Epoch ms of a stored timestamp (SQLite shape or ISO); NaN if unparseable. */
export function parseTimestamp(value: string | null | undefined): number {
  if (!value) return NaN;
  const sqlite = SQLITE_DATETIME.exec(value.trim());
  // Date.parse would read the space-separated form as LOCAL time.
  if (sqlite) return Date.parse(`${sqlite[1]}T${sqlite[2]}Z`);
  return Date.parse(value);
}

export type TimestampStyle = 'd' | 'D' | 'f' | 'F' | 't' | 'R';

/**
 * Discord's <t:…> markup: each viewer sees it in their own time zone, so the
 * bot never has to guess one. '—' when the value cannot be parsed.
 */
export function discordTime(value: string | null | undefined, style: TimestampStyle): string {
  const ms = parseTimestamp(value);
  return Number.isNaN(ms) ? '—' : `<t:${Math.floor(ms / 1000)}:${style}>`;
}

/**
 * Join lines into one block of at most `max` characters. Lines that do not fit
 * are dropped whole (never cut mid-markup) and counted in a closing line.
 */
export function fitLines(lines: readonly string[], max: number, more: (n: number) => string = (n) => `…还有 ${n} 项`): string {
  const kept: string[] = [];
  let used = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const rest = lines.length - i - 1;
    const tail = rest > 0 ? more(rest).length + 1 : 0;
    const cost = (kept.length > 0 ? 1 : 0) + lines[i].length;
    if (used + cost + tail > max) {
      return [...kept, more(lines.length - i)].join('\n');
    }
    kept.push(lines[i]);
    used += cost;
  }
  return kept.join('\n');
}

/** `base` + `path` without doubled or missing slashes. */
export function joinUrl(base: string, path = ''): string {
  const root = base.replace(/\/+$/, '');
  if (!path) return root || '/';
  return `${root}/${path.replace(/^\/+/, '')}`;
}

/** A Link button. Only http(s) URLs are accepted — Discord rejects anything else. */
export function linkButton(label: string, url: string): BotLinkButton {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`link buttons need an http(s) URL, got ${parsed.protocol}`);
  }
  return { label: truncate(label, LIMITS.buttonLabel), url: truncate(url, LIMITS.url) };
}

function clampField(field: BotEmbedField): BotEmbedField {
  return {
    ...field,
    // Discord rejects empty names and values.
    name: truncate(field.name || '—', LIMITS.fieldName),
    value: truncate(field.value || '—', LIMITS.fieldValue),
  };
}

/** Every text of an embed cut to Discord's limits; empty parts dropped. */
export function clampEmbed(embed: BotEmbed): BotEmbed {
  const out: BotEmbed = { ...embed };
  if (embed.title !== undefined) out.title = truncate(embed.title, LIMITS.embedTitle);
  if (embed.description !== undefined) out.description = truncate(embed.description, LIMITS.embedDescription);
  if (embed.fields !== undefined) out.fields = embed.fields.slice(0, LIMITS.embedFields).map(clampField);
  if (embed.footer !== undefined) out.footer = { text: truncate(embed.footer.text, LIMITS.footer) };
  if (!out.title) delete out.title;
  if (!out.description) delete out.description;
  if (out.fields?.length === 0) delete out.fields;
  // Discord rejects a footer without text.
  if (!out.footer?.text) delete out.footer;
  return out;
}

/** The characters Discord counts toward the total all embeds of a message share. */
function embedLength(e: BotEmbed): number {
  const fields = (e.fields ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0);
  return (e.title?.length ?? 0) + (e.description?.length ?? 0) + (e.footer?.text.length ?? 0) + fields;
}

/** `text` cut by at least `over` characters (or emptied); also returns how many went. */
function shrink(text: string, over: number): [string, number] {
  const cut = truncate(text, Math.max(0, text.length - over));
  return [cut, text.length - cut.length];
}

/**
 * Keep all embeds of one message within LIMITS.embedTotal. Starting from the
 * last embed, the description gives way first (it is the long free text), then
 * trailing fields, then the footer and the title.
 */
function fitEmbedTotal(embeds: readonly BotEmbed[]): BotEmbed[] {
  let over = embeds.reduce((n, e) => n + embedLength(e), 0) - LIMITS.embedTotal;
  const fitted = [...embeds];
  for (let i = fitted.length - 1; i >= 0 && over > 0; i -= 1) {
    let e = fitted[i];
    if (e.description) {
      const [description, saved] = shrink(e.description, over);
      e = { ...e, description };
      over -= saved;
    }
    while (over > 0 && e.fields && e.fields.length > 0) {
      const last = e.fields[e.fields.length - 1];
      e = { ...e, fields: e.fields.slice(0, -1) };
      over -= last.name.length + last.value.length;
    }
    if (over > 0 && e.footer) {
      const [text, saved] = shrink(e.footer.text, over);
      e = { ...e, footer: { text } };
      over -= saved;
    }
    if (over > 0 && e.title) {
      const [title, saved] = shrink(e.title, over);
      e = { ...e, title };
      over -= saved;
    }
    fitted[i] = e;
  }
  return fitted;
}

/** Final pass over a reply: every limit Discord enforces, enforced here first. */
export function clampReply(reply: BotReply): BotReply {
  const out: BotReply = { ...reply };
  if (reply.content !== undefined) out.content = truncate(reply.content, LIMITS.content);
  if (reply.embeds !== undefined) {
    // clampEmbed again afterwards drops whatever the total pass emptied; an
    // embed with no text left at all would be rejected, so it goes too.
    out.embeds = fitEmbedTotal(reply.embeds.slice(0, LIMITS.embeds).map(clampEmbed))
      .map(clampEmbed)
      .filter((e) => embedLength(e) > 0);
  }
  if (reply.buttons !== undefined) out.buttons = reply.buttons.slice(0, LIMITS.buttons);
  if (!out.content) delete out.content;
  if (out.embeds?.length === 0) delete out.embeds;
  if (out.buttons?.length === 0) delete out.buttons;
  // A reply with nothing in it is a Discord error; say something instead.
  if (!out.content && !out.embeds) out.content = '（没有内容）';
  return out;
}

export interface ReplyParts {
  embeds?: BotEmbed[];
  buttons?: BotLinkButton[];
}

/** Only the caller sees it. */
export function ephemeralReply(content: string | undefined, parts: ReplyParts = {}): BotReply {
  return clampReply({ content, ...parts, ephemeral: true });
}

/** Posted in the channel for everyone. Still never pings: see BotReply. */
export function publicReply(content: string | undefined, parts: ReplyParts = {}): BotReply {
  return clampReply({ content, ...parts, ephemeral: false });
}
