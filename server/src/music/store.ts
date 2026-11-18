import type pg from 'pg';
import { defaultMusicState, MUSIC_COMMAND_KINDS, type MusicCommandKind, type MusicSessionStatus,
  type MusicState } from '../../../shared/music';
import { CommunityStoreError } from '../community/store';
import { accountRow, commandRow, iso, sessionRow } from './store-rows';

type Queryable = Pick<pg.Pool, 'query'>;

export interface StoredMusicSession {
  ref: string;
  roomRef: string;
  invitedBy: string;
  status: MusicSessionStatus;
  endReason: string | null;
  state: MusicState;
  version: number;
  accountOwner: string | null;
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
}

export interface StoredMusicCommand {
  id: string;
  sessionRef: string;
  actor: string;
  kind: MusicCommandKind;
  payload: Record<string, unknown>;
  requestKey: string;
  createdAt: string;
}

export interface StoredMusicAccount {
  memberRef: string;
  cookieEncrypted: string;
  nickname: string;
  vip: boolean;
  expiresAt: string;
  createdAt: string;
}

export interface MusicAccountInput {
  cookieEncrypted: string;
  nickname: string;
  vip: boolean;
  expiresAt: Date;
}

const SESSION_COLUMNS = `ref, room_ref, invited_by, status, end_reason, state, state_version, account_owner,
  created_at, updated_at, ended_at`;
const ENDED_RETENTION_DAYS = 7;
const UNIQUE_VIOLATION = '23505';
const SESSION_ENDED_ERROR = '会话已结束';
const UNKNOWN_COMMAND_ERROR = '不支持此播放指令';
const QUEUE_FULL_MESSAGE = '操作太频繁，请稍后再试';
/** Most commands one session may have waiting for the music process. */
export const MUSIC_MAX_QUEUED_COMMANDS = 50;
const STATUS_RANK: Record<MusicSessionStatus, number> = { requested: 0, connecting: 1, active: 2, ended: 3 };

function ended(): CommunityStoreError {
  return new CommunityStoreError(409, 'session_ended', SESSION_ENDED_ERROR);
}

export class MusicStore {
  constructor(readonly pool: pg.Pool, readonly guildId: string) {}

  async createSession(roomRef: string, invitedBy: string, accountOwner: string | null): Promise<StoredMusicSession> {
    try {
      const result = await this.pool.query(
        `INSERT INTO music_sessions(guild_id, room_ref, invited_by, account_owner, state)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         RETURNING ${SESSION_COLUMNS}`,
        [this.guildId, roomRef, invitedBy, accountOwner, JSON.stringify(defaultMusicState())],
      );
      return sessionRow(result.rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new CommunityStoreError(409, 'music_busy', 'Music 正在使用中');
      }
      throw error;
    }
  }

  async activeSession(): Promise<StoredMusicSession | null> {
    return this.selectSession(`guild_id = $1 AND status <> 'ended'`, [this.guildId]);
  }

  async session(ref: string): Promise<StoredMusicSession | null> {
    return this.selectSession(`guild_id = $1 AND ref = $2`, [this.guildId, ref]);
  }

  async sessionForRoom(roomRef: string): Promise<StoredMusicSession | null> {
    return this.selectSession(`guild_id = $1 AND room_ref = $2 AND status <> 'ended'`, [this.guildId, roomRef]);
  }

  /** Moves a session forward only; returns the unchanged row for a no-op and null once it has ended. */
  async setStatus(ref: string, status: 'connecting' | 'active'): Promise<StoredMusicSession | null> {
    const allowedFrom = (Object.keys(STATUS_RANK) as MusicSessionStatus[])
      .filter((candidate) => STATUS_RANK[candidate] < STATUS_RANK[status]);
    const result = await this.pool.query(
      `UPDATE music_sessions SET status = $3, updated_at = now()
       WHERE guild_id = $1 AND ref = $2 AND status = ANY($4::text[])
       RETURNING ${SESSION_COLUMNS}`,
      [this.guildId, ref, status, allowedFrom],
    );
    if (result.rows[0]) return sessionRow(result.rows[0]);
    const current = await this.session(ref);
    return current && current.status !== 'ended' ? current : null;
  }

  async saveState(ref: string, state: MusicState, expectedVersion: number): Promise<StoredMusicSession> {
    const result = await this.pool.query(
      `UPDATE music_sessions
       SET state = $4::jsonb, state_version = state_version + 1, updated_at = now()
       WHERE guild_id = $1 AND ref = $2 AND state_version = $3 AND status <> 'ended'
       RETURNING ${SESSION_COLUMNS}`,
      [this.guildId, ref, expectedVersion, JSON.stringify(state)],
    );
    if (!result.rows[0]) throw new CommunityStoreError(409, 'version_conflict', '播放状态已变化，请刷新后重试');
    return sessionRow(result.rows[0]);
  }

  async setAccountOwner(ref: string, memberRef: string | null): Promise<StoredMusicSession> {
    const result = await this.pool.query(
      `UPDATE music_sessions
       SET account_owner = $3, state_version = state_version + 1, updated_at = now()
       WHERE guild_id = $1 AND ref = $2 AND status <> 'ended'
       RETURNING ${SESSION_COLUMNS}`,
      [this.guildId, ref, memberRef],
    );
    if (!result.rows[0]) throw ended();
    return sessionRow(result.rows[0]);
  }

  /** Returns false when the session was already ended (or is not in this guild). */
  async endSession(ref: string, reason: string): Promise<boolean> {
    return this.endWhere(ref, reason, 'TRUE', []);
  }

  /** Ends a live session with reason `offline`, but only while the music
   * process heartbeat is still older than `maxAgeMs` (checked in the same statement). */
  async endStaleSession(ref: string, maxAgeMs: number): Promise<boolean> {
    return this.endWhere(ref, 'offline', `NOT EXISTS (
      SELECT 1 FROM music_runtime r
      WHERE r.guild_id = $1 AND r.heartbeat_at >= now() - ($4::double precision * interval '1 millisecond'))`, [maxAgeMs]);
  }

  private async endWhere(ref: string, reason: string, condition: string, extra: unknown[]): Promise<boolean> {
    return this.transaction(async (client) => {
      const result = await client.query(
        `UPDATE music_sessions
         SET status = 'ended', ended_at = now(), end_reason = $3, account_owner = NULL,
             state_version = state_version + 1, updated_at = now()
         WHERE guild_id = $1 AND ref = $2 AND status <> 'ended' AND ${condition}`,
        [this.guildId, ref, reason, ...extra],
      );
      if (result.rowCount === 0) return false;
      await client.query(
        `UPDATE music_commands SET status = 'failed', error = $2, finished_at = now()
         WHERE session_ref = $1 AND status = 'queued'`,
        [ref, SESSION_ENDED_ERROR],
      );
      return true;
    });
  }

  async addCommand(
    sessionRef: string,
    actor: string,
    kind: MusicCommandKind,
    payload: Record<string, unknown>,
    requestKey: string,
    maxQueued = MUSIC_MAX_QUEUED_COMMANDS,
  ): Promise<{ id: string; created: boolean }> {
    const inserted = await this.pool.query(
      `INSERT INTO music_commands(session_ref, actor, kind, payload, request_key)
       SELECT s.ref, $3, $4, $5::jsonb, $6 FROM music_sessions s
       WHERE s.guild_id = $1 AND s.ref = $2 AND s.status <> 'ended'
         AND (SELECT count(*) FROM music_commands q WHERE q.session_ref = s.ref AND q.status = 'queued') < $7
       ON CONFLICT (session_ref, actor, request_key) DO NOTHING
       RETURNING id`,
      [this.guildId, sessionRef, actor, kind, JSON.stringify(payload), requestKey, maxQueued],
    );
    if (inserted.rows[0]) {
      await this.pool.query(`SELECT pg_notify('music_commands', '')`);
      return { id: String(inserted.rows[0].id), created: true };
    }
    const existing = await this.pool.query(
      `SELECT c.id FROM music_commands c JOIN music_sessions s ON s.ref = c.session_ref
       WHERE s.guild_id = $1 AND c.session_ref = $2 AND c.actor = $3 AND c.request_key = $4`,
      [this.guildId, sessionRef, actor, requestKey],
    );
    if (existing.rows[0]) return { id: String(existing.rows[0].id), created: false };
    if (await this.session(sessionRef).then((session) => session !== null && session.status !== 'ended')) {
      throw new CommunityStoreError(429, 'rate_limited', QUEUE_FULL_MESSAGE);
    }
    throw ended();
  }

  /** The single music process is the only consumer, so queued rows need no lease.
   * Rows of an unknown kind are failed here and never handed out. */
  async claimCommands(sessionRef: string, limit: number): Promise<StoredMusicCommand[]> {
    await this.pool.query(
      `UPDATE music_commands c SET status = 'failed', error = $4, finished_at = now()
       FROM music_sessions s
       WHERE s.ref = c.session_ref AND s.guild_id = $1 AND c.session_ref = $2 AND c.status = 'queued'
         AND NOT (c.kind = ANY($3::text[]))`,
      [this.guildId, sessionRef, MUSIC_COMMAND_KINDS, UNKNOWN_COMMAND_ERROR],
    );
    const result = await this.pool.query(
      `SELECT c.id, c.session_ref, c.actor, c.kind, c.payload, c.request_key, c.created_at
       FROM music_commands c JOIN music_sessions s ON s.ref = c.session_ref
       WHERE s.guild_id = $1 AND c.session_ref = $2 AND c.status = 'queued' AND c.kind = ANY($4::text[])
       ORDER BY c.id LIMIT $3`,
      [this.guildId, sessionRef, limit, MUSIC_COMMAND_KINDS],
    );
    return result.rows.map(commandRow).filter((command): command is StoredMusicCommand => command !== null);
  }

  /** This room's latest session, when it ended within `withinMs`. */
  async lastEnded(roomRef: string, withinMs: number): Promise<{ reason: string | null; endedAt: string } | null> {
    const result = await this.pool.query(
      `SELECT end_reason, ended_at FROM music_sessions
       WHERE guild_id = $1 AND room_ref = $2 AND status = 'ended'
         AND ended_at >= now() - ($3::double precision * interval '1 millisecond')
       ORDER BY ended_at DESC LIMIT 1`,
      [this.guildId, roomRef, withinMs],
    );
    const row = result.rows[0];
    return row ? { reason: row.end_reason == null ? null : String(row.end_reason), endedAt: iso(row.ended_at)! } : null;
  }

  /** The actor's latest command in a session that failed within `withinMs`. */
  async lastFailedCommand(sessionRef: string, actor: string, withinMs: number): Promise<{ id: string; error: string | null } | null> {
    const result = await this.pool.query(
      `SELECT c.id, c.error FROM music_commands c JOIN music_sessions s ON s.ref = c.session_ref
       WHERE s.guild_id = $1 AND c.session_ref = $2 AND c.actor = $3 AND c.status = 'failed'
         AND c.finished_at >= now() - ($4::double precision * interval '1 millisecond')
       ORDER BY c.finished_at DESC, c.id DESC LIMIT 1`,
      [this.guildId, sessionRef, actor, withinMs],
    );
    const row = result.rows[0];
    return row ? { id: String(row.id), error: row.error == null ? null : String(row.error) } : null;
  }

  async finishCommand(id: string, error: string | null): Promise<void> {
    await this.pool.query(
      `UPDATE music_commands c SET status = $3, error = $4, finished_at = now()
       FROM music_sessions s
       WHERE s.ref = c.session_ref AND s.guild_id = $1 AND c.id = $2 AND c.status = 'queued'`,
      [this.guildId, id, error === null ? 'done' : 'failed', error],
    );
  }

  async heartbeat(): Promise<void> {
    await this.pool.query(
      `INSERT INTO music_runtime(guild_id, heartbeat_at) VALUES ($1, now())
       ON CONFLICT (guild_id) DO UPDATE SET heartbeat_at = now()`,
      [this.guildId],
    );
  }

  async online(maxAgeMs: number): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM music_runtime
       WHERE guild_id = $1 AND heartbeat_at >= now() - ($2::double precision * interval '1 millisecond')`,
      [this.guildId, maxAgeMs],
    );
    return result.rows.length > 0;
  }

  async saveAccount(memberRef: string, input: MusicAccountInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO music_accounts(guild_id, member_ref, cookie_encrypted, nickname, vip, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (guild_id, member_ref) DO UPDATE
       SET cookie_encrypted = EXCLUDED.cookie_encrypted, nickname = EXCLUDED.nickname,
           vip = EXCLUDED.vip, expires_at = EXCLUDED.expires_at, created_at = now()`,
      [this.guildId, memberRef, input.cookieEncrypted, input.nickname, input.vip, input.expiresAt],
    );
  }

  async account(memberRef: string): Promise<StoredMusicAccount | null> {
    const result = await this.pool.query(
      `SELECT member_ref, cookie_encrypted, nickname, vip, expires_at, created_at
       FROM music_accounts WHERE guild_id = $1 AND member_ref = $2 AND expires_at > now()`,
      [this.guildId, memberRef],
    );
    return result.rows[0] ? accountRow(result.rows[0]) : null;
  }

  async deleteAccount(memberRef: string): Promise<void> {
    await this.transaction(async (client) => {
      await client.query(`DELETE FROM music_accounts WHERE guild_id = $1 AND member_ref = $2`, [this.guildId, memberRef]);
      await this.detachOwner(client, `account_owner = $2`, [this.guildId, memberRef]);
    });
  }

  async purgeExpired(now: Date = new Date()): Promise<void> {
    await this.transaction(async (client) => {
      await this.detachOwner(
        client,
        `account_owner IN (SELECT member_ref FROM music_accounts WHERE guild_id = $1 AND expires_at <= $2)`,
        [this.guildId, now],
      );
      await client.query(`DELETE FROM music_accounts WHERE guild_id = $1 AND expires_at <= $2`, [this.guildId, now]);
      await client.query(
        `DELETE FROM music_sessions
         WHERE guild_id = $1 AND status = 'ended' AND ended_at < $2::timestamptz - make_interval(days => $3)`,
        [this.guildId, now, ENDED_RETENTION_DAYS],
      );
    });
  }

  /** Clears the lent account from live sessions and bumps their version so pollers notice. */
  private async detachOwner(client: Queryable, condition: string, params: unknown[]): Promise<void> {
    await client.query(
      `UPDATE music_sessions
       SET account_owner = NULL, state_version = state_version + 1, updated_at = now()
       WHERE guild_id = $1 AND status <> 'ended' AND ${condition}`,
      params,
    );
  }

  private async selectSession(where: string, params: unknown[]): Promise<StoredMusicSession | null> {
    const result = await this.pool.query(`SELECT ${SESSION_COLUMNS} FROM music_sessions WHERE ${where}`, params);
    return result.rows[0] ? sessionRow(result.rows[0]) : null;
  }

  private async transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const value = await work(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
