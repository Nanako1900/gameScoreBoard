// Strict per-kind validation of player commands submitted from the browser.
// The music process applies commands; the API only rejects malformed ones and
// stores a normalized payload built from known fields.
import { MUSIC_COMMAND_KINDS, type MusicCommandKind, type MusicState, type MusicTrack } from '../../../shared/music';
import { applyMusicCommand } from './queue';
import { invalidInput, type MusicBody } from './http';

const META_FIELDS = ['requestKey', 'kind'] as const;
const TRACK_FIELDS = ['id', 'title', 'artists', 'album', 'durationMs', 'coverUrl'] as const;
const PAYLOAD_FIELDS: Readonly<Record<MusicCommandKind, readonly string[]>> = {
  enqueue: ['tracks'],
  remove: ['key'],
  move_next: ['key'],
  clear: [],
  play: [],
  pause: [],
  skip: [],
  seek: ['positionMs'],
  volume: ['volume'],
  mode: ['mode'],
  leave: [],
};
const VALIDATION_KEY = 'validation';

export interface ParsedMusicCommand {
  kind: MusicCommandKind;
  payload: Record<string, unknown>;
}

function parseKind(value: unknown): MusicCommandKind {
  if (typeof value !== 'string' || !(MUSIC_COMMAND_KINDS as readonly string[]).includes(value)) {
    return invalidInput('不支持此播放指令');
  }
  return value as MusicCommandKind;
}

function normalizeTrack(value: unknown): MusicTrack {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalidInput('曲目无效');
  const raw = value as Record<string, unknown>;
  const keys = Object.keys(raw);
  if (keys.some((field) => !(TRACK_FIELDS as readonly string[]).includes(field))) return invalidInput('曲目无效');
  return {
    id: raw.id as string,
    title: raw.title as string,
    artists: raw.artists as string[],
    album: raw.album as string,
    durationMs: raw.durationMs as number,
    coverUrl: raw.coverUrl as string | null,
  };
}

function payloadFor(kind: MusicCommandKind, body: MusicBody): Record<string, unknown> {
  const allowed = PAYLOAD_FIELDS[kind];
  if (Object.keys(body).some((field) => !allowed.includes(field) && !(META_FIELDS as readonly string[]).includes(field))) {
    return invalidInput();
  }
  const picked = Object.fromEntries(allowed.filter((field) => field in body).map((field) => [field, body[field]]));
  if (kind !== 'enqueue') return picked;
  if (!Array.isArray(picked.tracks)) return invalidInput('曲目数量无效');
  return { tracks: picked.tracks.map(normalizeTrack) };
}

/**
 * Parses `{kind, ...payload}` and checks it against the session's current
 * state with the same reducer the music process runs, so range, shape and
 * queue-capacity errors surface immediately instead of failing silently later.
 */
export function parseMusicCommand(body: MusicBody, state: MusicState, actor: string): ParsedMusicCommand {
  const kind = parseKind(body.kind);
  const payload = payloadFor(kind, body);
  applyMusicCommand(state, { kind, payload, actor }, {
    now: Date.now(),
    random: () => 0,
    newKey: () => VALIDATION_KEY,
  });
  return { kind, payload };
}
