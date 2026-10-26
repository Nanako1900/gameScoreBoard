// Discord ↔ Nanako account bindings (server/migrations/0002_discord.sql).
//
// One Discord account binds to one Nanako account and vice versa. The rules a
// bind must pass are checked here and then enforced again by the database
// itself — the primary key on discord_user_id and the UNIQUE on user_id — so
// two racing binds can never both land; the loser is reported as a conflict.
// Every change is written to link_audit in the same batch.

import { getUserById, toUser } from '../../../worker/db';
import type { User } from '../../../worker/types';

export interface DiscordLink {
  discord_user_id: string;
  user_id: string;
  discord_username: string;
  notify_dm: number;
  linked_at: string;
  updated_at: string;
}

export type LinkVia = 'web' | 'discord' | 'admin';

export type LinkOutcome =
  /** Bound (`linked`), moved to a new Discord account (`relinked`) or already so (`unchanged`). */
  | { kind: 'linked' | 'relinked' | 'unchanged'; link: DiscordLink }
  /** That Discord account is bound to a different Nanako account. */
  | { kind: 'taken' }
  /** This Nanako account is bound to another Discord account; pass replace: true to move it. */
  | { kind: 'needs_replace'; current: DiscordLink };

const DISCORD_ID = /^\d{17,20}$/;

export function isDiscordId(value: string): boolean {
  return DISCORD_ID.test(value);
}

export async function linkByDiscordId(db: D1Database, discordUserId: string): Promise<DiscordLink | null> {
  return db
    .prepare('SELECT * FROM discord_links WHERE discord_user_id = ?')
    .bind(discordUserId)
    .first<DiscordLink>();
}

/** The Nanako user bound to this Discord account, or null. */
export async function boundUser(db: D1Database, discordUserId: string): Promise<User | null> {
  const link = await linkByDiscordId(db, discordUserId);
  if (!link) return null;
  const row = await getUserById(db, link.user_id);
  return row ? toUser(row) : null;
}

export async function linkByUserId(db: D1Database, userId: string): Promise<DiscordLink | null> {
  return db.prepare('SELECT * FROM discord_links WHERE user_id = ?').bind(userId).first<DiscordLink>();
}

function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /duplicate key|unique constraint/i.test(message);
}

export interface LinkInput {
  userId: string;
  discordUserId: string;
  discordUsername: string;
  /** Move an existing binding of this Nanako account to the new Discord account. */
  replace: boolean;
  via: LinkVia;
}

export async function linkAccounts(db: D1Database, input: LinkInput): Promise<LinkOutcome> {
  if (!isDiscordId(input.discordUserId)) throw new Error(`not a Discord id: ${input.discordUserId}`);
  const username = input.discordUsername.slice(0, 100);
  const byDiscord = await linkByDiscordId(db, input.discordUserId);
  if (byDiscord && byDiscord.user_id !== input.userId) return { kind: 'taken' };
  if (byDiscord) {
    if (byDiscord.discord_username !== username) {
      await db
        .prepare("UPDATE discord_links SET discord_username = ?, updated_at = datetime('now') WHERE discord_user_id = ?")
        .bind(username, input.discordUserId)
        .run();
    }
    return { kind: 'unchanged', link: (await linkByDiscordId(db, input.discordUserId)) ?? byDiscord };
  }

  const byUser = await linkByUserId(db, input.userId);
  if (byUser && !input.replace) return { kind: 'needs_replace', current: byUser };

  const statements: D1PreparedStatement[] = [];
  if (byUser) {
    statements.push(
      db.prepare('DELETE FROM discord_links WHERE user_id = ? AND discord_user_id = ?').bind(input.userId, byUser.discord_user_id),
      db
        .prepare("INSERT INTO link_audit (action, via, user_id, discord_user_id) VALUES ('unlink', ?, ?, ?)")
        .bind(input.via, input.userId, byUser.discord_user_id),
    );
  }
  statements.push(
    // A move keeps the person's DM choice (/notify): relinking must not quietly turn DMs back on.
    db
      .prepare('INSERT INTO discord_links (discord_user_id, user_id, discord_username, notify_dm) VALUES (?, ?, ?, ?)')
      .bind(input.discordUserId, input.userId, username, byUser ? byUser.notify_dm : 1),
    db
      .prepare('INSERT INTO link_audit (action, via, user_id, discord_user_id) VALUES (?, ?, ?, ?)')
      .bind(byUser ? 'relink' : 'link', input.via, input.userId, input.discordUserId),
  );
  try {
    await db.batch(statements);
  } catch (error) {
    // Someone bound one side of this pair in the meantime.
    if (isUniqueViolation(error)) return { kind: 'taken' };
    throw error;
  }
  const link = await linkByDiscordId(db, input.discordUserId);
  if (!link) throw new Error('binding vanished right after it was written');
  return { kind: byUser ? 'relinked' : 'linked', link };
}

/** Remove the binding of this Nanako user or this Discord user. Returns what was removed. */
export async function unlinkAccounts(
  db: D1Database,
  who: { userId: string } | { discordUserId: string },
  via: LinkVia,
): Promise<DiscordLink | null> {
  const current = 'userId' in who ? await linkByUserId(db, who.userId) : await linkByDiscordId(db, who.discordUserId);
  if (!current) return null;
  const results = await db.batch([
    db
      .prepare('DELETE FROM discord_links WHERE discord_user_id = ? AND user_id = ?')
      .bind(current.discord_user_id, current.user_id),
    db
      .prepare(
        `INSERT INTO link_audit (action, via, user_id, discord_user_id)
         SELECT 'unlink', ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM discord_links WHERE discord_user_id = ?)`,
      )
      .bind(via, current.user_id, current.discord_user_id, current.discord_user_id),
  ]);
  // A concurrent unlink got there first: nothing was removed by this call.
  return (results[0]?.meta?.changes ?? 0) > 0 ? current : null;
}
