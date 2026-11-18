// Row mapping for MusicStore: database rows become typed, validated values.
import { defaultMusicState, MUSIC_MODES, MUSIC_COMMAND_KINDS, type MusicCommandKind, type MusicSessionStatus,
  type MusicState } from '../../../shared/music';
import type { StoredMusicAccount, StoredMusicCommand, StoredMusicSession } from './store';

type Row = Record<string, unknown>;

export function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isQueueItem(value: unknown): boolean {
  if (!isRecord(value) || typeof value.key !== 'string' || typeof value.addedBy !== 'string') return false;
  const track = value.track;
  return isRecord(track) && typeof track.id === 'string' && typeof track.title === 'string'
    && Array.isArray(track.artists) && typeof track.durationMs === 'number';
}

/** Accepts only a structurally valid MusicState; anything else is treated as a fresh session. */
function parseState(value: unknown): MusicState {
  if (!isRecord(value)) return defaultMusicState();
  const valid = (value.current === null || isQueueItem(value.current))
    && Array.isArray(value.queue) && value.queue.every(isQueueItem)
    && Array.isArray(value.history) && value.history.every((key) => typeof key === 'string')
    && typeof value.mode === 'string' && (MUSIC_MODES as readonly string[]).includes(value.mode)
    && typeof value.volume === 'number' && typeof value.paused === 'boolean'
    && typeof value.positionMs === 'number'
    && (value.positionAt === null || typeof value.positionAt === 'string')
    && (value.notice === null || typeof value.notice === 'string');
  return valid ? value as unknown as MusicState : defaultMusicState();
}

export function sessionRow(row: Row): StoredMusicSession {
  return {
    ref: String(row.ref),
    roomRef: String(row.room_ref),
    invitedBy: String(row.invited_by),
    status: String(row.status) as MusicSessionStatus,
    endReason: row.end_reason == null ? null : String(row.end_reason),
    state: parseState(row.state),
    version: Number(row.state_version),
    accountOwner: row.account_owner == null ? null : String(row.account_owner),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
    endedAt: iso(row.ended_at),
  };
}

function isCommandKind(value: string): value is MusicCommandKind {
  return (MUSIC_COMMAND_KINDS as readonly string[]).includes(value);
}

/** Null for a kind this build does not know: it must never be guessed into another command. */
export function commandRow(row: Row): StoredMusicCommand | null {
  const kind = String(row.kind);
  if (!isCommandKind(kind)) return null;
  return {
    id: String(row.id),
    sessionRef: String(row.session_ref),
    actor: String(row.actor),
    kind,
    payload: isRecord(row.payload) ? row.payload : {},
    requestKey: String(row.request_key),
    createdAt: iso(row.created_at)!,
  };
}

export function accountRow(row: Row): StoredMusicAccount {
  return {
    memberRef: String(row.member_ref),
    cookieEncrypted: String(row.cookie_encrypted),
    nickname: String(row.nickname),
    vip: row.vip === true,
    expiresAt: iso(row.expires_at)!,
    createdAt: iso(row.created_at)!,
  };
}
