// What the outbox's deliverers share: the row, the outcome, the Discord API they
// talk to, and how its errors read. Split out of dispatcher.ts for size.

import type { ChannelMessage } from '../discord/verdict';

/** Never posted and older than this: not worth announcing any more (bot was down for a day). */
export const STALE_MS = 24 * 3_600_000;

// Discord JSON error codes.
export const UNKNOWN_CHANNEL = 10003;
export const UNKNOWN_MESSAGE = 10008;
/** "Cannot send messages to this user": DMs closed, or no server in common. */
export const CANNOT_DM = 50007;

export interface ChannelApi {
  send(channelId: string, message: ChannelMessage & { nonce: string; enforce_nonce: true }): Promise<{ id: string }>;
  edit(channelId: string, messageId: string, message: ChannelMessage): Promise<void>;
  remove(channelId: string, messageId: string): Promise<void>;
  /** The DM channel with this Discord user (opened if need be). */
  openDm(discordUserId: string): Promise<string>;
}

export interface DispatcherConfig {
  /** null: verdict events are marked skipped, nothing is posted. */
  verdictChannelId: string | null;
  /** null or absent: public board refreshes are skipped. */
  boardChannelId?: string | null;
  frontendUrl: string;
  /** The board's time zone (RESET_TZ_OFFSET): when a week is over. Default UTC+8. */
  offsetHours?: number;
}

/** Where a DM goes: the recipient's Discord account. */
export interface Recipient {
  discord_user_id: string;
}

export interface OutboxRow {
  id: number;
  kind: string;
  entity: string;
  entity_id: string;
  payload: Record<string, unknown>;
  claim_token: string;
  attempts: number;
  created_at: Date;
  refused_since: Date | null;
}

export type Outcome =
  | { result: 'sent' | 'skipped' | 'dead'; note: string | null }
  /**
   * `refused`: Discord said 401/403 — retried every few minutes without counting
   * the attempt; `unhandled`: this version has no handler — left for a newer one.
   */
  | { result: 'retry'; note: string; refused?: boolean; unhandled?: boolean };

export function errorStatus(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : null;
}

export function errorCode(error: unknown): number | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'number' ? code : null;
}

/**
 * Discord returns the first message instead of a second one for a repeated
 * nonce (a send retried after a crash between sending and recording it). An
 * event re-armed after it was sent is a new row (outbox_schedule), so a new
 * nonce; one moved while still waiting keeps its created_at, and its nonce.
 * At most 25 chars.
 */
export function nonceFor(row: OutboxRow): string {
  return `ob${row.id}.${row.created_at.getTime().toString(36)}`;
}
