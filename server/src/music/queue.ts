import {
  defaultMusicState, isMusicTrackId, MUSIC_MODES, MUSIC_QUEUE_LIMIT, MUSIC_VOLUME_MAX, musicPosition,
  type MusicCommandKind, type MusicMode, type MusicQueueItem, type MusicState, type MusicTrack,
} from '../../../shared/music';
import { CommunityStoreError } from '../community/store';
import { MUSIC_COVER_URL_MAX, neteaseCoverUrl } from './cover';

export type MusicEffect = 'none' | 'start' | 'restart' | 'stop' | 'pause' | 'resume' | 'leave';
export interface MusicReducerContext { now: number; random: () => number; newKey: () => string }
export interface MusicCommandInput { kind: MusicCommandKind; payload: Record<string, unknown>; actor: string }
export interface MusicReduction { state: MusicState; effect: MusicEffect }
type AdvanceReason = 'ended' | 'skip' | 'failed';

const MAX_ENQUEUE_TRACKS = 200;
const MAX_TITLE = 200;
const MAX_ARTISTS = 10;
const MAX_ARTIST_NAME = 100;
const MAX_ALBUM = 200;
const MAX_DURATION_MS = 86_400_000;
const MAX_KEY = 200;
const MAX_HISTORY = 200;

function invalid(message: string): CommunityStoreError {
  return new CommunityStoreError(400, 'invalid_input', message);
}

/** Lengths count code points, the way the NetEase client clamps them. */
function boundedString(value: unknown, max: number, label: string, allowEmpty = false): string {
  if (typeof value !== 'string') throw invalid(`${label}无效`);
  const length = [...value].length;
  if (length > max || (!allowEmpty && length === 0)) throw invalid(`${label}无效`);
  return value;
}

function integerInRange(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw invalid(`${label}无效`);
  return value;
}

function parseCoverUrl(value: unknown): string | null {
  if (value === null) return null;
  const text = boundedString(value, MUSIC_COVER_URL_MAX, '封面地址');
  const cover = neteaseCoverUrl(text, { upgradeHttp: false });
  if (cover === null) throw invalid('封面地址无效');
  return cover;
}

function parseTrack(value: unknown): MusicTrack {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalid('曲目无效');
  const raw = value as Record<string, unknown>;
  if (!isMusicTrackId(raw.id)) throw invalid('曲目编号无效');
  if (!Array.isArray(raw.artists) || raw.artists.length > MAX_ARTISTS) throw invalid('歌手无效');
  return {
    id: raw.id,
    title: boundedString(raw.title, MAX_TITLE, '曲名'),
    artists: raw.artists.map((artist) => boundedString(artist, MAX_ARTIST_NAME, '歌手', true)),
    album: boundedString(raw.album, MAX_ALBUM, '专辑', true),
    durationMs: integerInRange(raw.durationMs, 1, MAX_DURATION_MS, '时长'),
    coverUrl: parseCoverUrl(raw.coverUrl),
  };
}

function parseTracks(payload: Record<string, unknown>): MusicTrack[] {
  const { tracks } = payload;
  if (!Array.isArray(tracks) || tracks.length < 1 || tracks.length > MAX_ENQUEUE_TRACKS) throw invalid('曲目数量无效');
  return tracks.map(parseTrack);
}

function parseKey(payload: Record<string, unknown>): string {
  return boundedString(payload.key, MAX_KEY, '队列项');
}

function startedAt(ctx: MusicReducerContext): Pick<MusicState, 'positionMs' | 'positionAt' | 'paused'> {
  return { positionMs: 0, positionAt: new Date(ctx.now).toISOString(), paused: false };
}

function startPlaying(state: MusicState, current: MusicQueueItem, queue: MusicQueueItem[], ctx: MusicReducerContext): MusicState {
  return { ...state, current, queue, notice: null, ...startedAt(ctx) };
}

function enqueue(state: MusicState, payload: Record<string, unknown>, actor: string, ctx: MusicReducerContext): MusicReduction {
  const tracks = parseTracks(payload);
  if ((state.current ? 1 : 0) + state.queue.length + tracks.length > MUSIC_QUEUE_LIMIT) {
    throw new CommunityStoreError(409, 'queue_full', '播放队列已满');
  }
  const items = tracks.map((track): MusicQueueItem => ({ key: ctx.newKey(), track, addedBy: actor }));
  if (state.current) return { state: { ...state, queue: [...state.queue, ...items] }, effect: 'none' };
  const [first, ...rest] = items;
  return { state: startPlaying(state, first, [...state.queue, ...rest], ctx), effect: 'start' };
}

function remove(state: MusicState, payload: Record<string, unknown>): MusicReduction {
  const key = parseKey(payload);
  if (!state.queue.some((entry) => entry.key === key)) return { state, effect: 'none' };
  return { state: { ...state, queue: state.queue.filter((entry) => entry.key !== key) }, effect: 'none' };
}

function moveNext(state: MusicState, payload: Record<string, unknown>): MusicReduction {
  const key = parseKey(payload);
  const target = state.queue.find((entry) => entry.key === key);
  if (!target) return { state, effect: 'none' };
  return { state: { ...state, queue: [target, ...state.queue.filter((entry) => entry.key !== key)] }, effect: 'none' };
}

function pause(state: MusicState, ctx: MusicReducerContext): MusicReduction {
  if (!state.current || state.paused) return { state, effect: 'none' };
  return { state: { ...state, paused: true, positionMs: musicPosition(state, ctx.now), positionAt: null }, effect: 'pause' };
}

function play(state: MusicState, ctx: MusicReducerContext): MusicReduction {
  if (!state.current) return state.queue.length > 0 ? advance(state, ctx, 'skip') : { state, effect: 'none' };
  if (!state.paused) return { state, effect: 'none' };
  return { state: { ...state, paused: false, positionAt: new Date(ctx.now).toISOString() }, effect: 'resume' };
}

function seek(state: MusicState, payload: Record<string, unknown>, ctx: MusicReducerContext): MusicReduction {
  const requested = integerInRange(payload.positionMs, 0, Number.MAX_SAFE_INTEGER, '播放位置');
  if (!state.current) return { state, effect: 'none' };
  const positionMs = Math.min(requested, state.current.track.durationMs);
  const positionAt = state.paused ? null : new Date(ctx.now).toISOString();
  return { state: { ...state, positionMs, positionAt }, effect: 'restart' };
}

function setVolume(state: MusicState, payload: Record<string, unknown>, ctx: MusicReducerContext): MusicReduction {
  const volume = integerInRange(payload.volume, 0, MUSIC_VOLUME_MAX, '音量');
  if (volume === state.volume) return { state, effect: 'none' };
  if (!state.current || state.paused) return { state: { ...state, volume }, effect: 'none' };
  const settled = { positionMs: musicPosition(state, ctx.now), positionAt: new Date(ctx.now).toISOString() };
  return { state: { ...state, volume, ...settled }, effect: 'restart' };
}

function setMode(state: MusicState, payload: Record<string, unknown>): MusicReduction {
  const mode = payload.mode;
  if (typeof mode !== 'string' || !MUSIC_MODES.includes(mode as MusicMode)) throw invalid('播放模式无效');
  return { state: { ...state, mode: mode as MusicMode, history: [] }, effect: 'none' };
}

function leave(state: MusicState): MusicReduction {
  return { state: { ...defaultMusicState(), volume: state.volume, mode: state.mode }, effect: 'leave' };
}

function pickIndex(length: number, mode: MusicMode, random: () => number): number {
  if (mode !== 'shuffle') return 0;
  return Math.min(length - 1, Math.max(0, Math.floor(random() * length)));
}

function failureNotice(state: MusicState, reason: AdvanceReason, failure: string | undefined): string | null {
  if (reason === 'skip') return null;
  if (reason === 'ended') return state.notice;
  const title = state.current?.track.title;
  const text = failure ?? '无法播放';
  return title ? `${title}：${text}` : text;
}

export function advance(
  state: MusicState,
  ctx: MusicReducerContext,
  reason: AdvanceReason,
  failure?: string,
): MusicReduction {
  const notice = failureNotice(state, reason, failure);
  if (state.current && reason === 'ended' && state.mode === 'single') {
    return { state: { ...state, ...startedAt(ctx) }, effect: 'start' };
  }
  const requeue = state.current !== null && state.mode === 'loop' && reason !== 'failed';
  const pool = requeue && state.current ? [...state.queue, state.current] : state.queue;
  if (pool.length === 0) {
    const stopped = { ...state, current: null, queue: [], history: [], notice, positionMs: 0, positionAt: null, paused: false };
    return { state: stopped, effect: 'stop' };
  }
  const index = pickIndex(pool.length, state.mode, ctx.random);
  const played = state.current && state.mode === 'shuffle' ? [...state.history, state.current.key].slice(-MAX_HISTORY) : state.history;
  const next = startPlaying(state, pool[index], pool.filter((_, i) => i !== index), ctx);
  return { state: { ...next, history: played, notice }, effect: 'start' };
}

export function applyMusicCommand(
  state: MusicState,
  command: MusicCommandInput,
  ctx: MusicReducerContext,
): MusicReduction {
  const { payload, actor } = command;
  switch (command.kind) {
    case 'enqueue': return enqueue(state, payload, actor, ctx);
    case 'remove': return remove(state, payload);
    case 'move_next': return moveNext(state, payload);
    case 'clear': return { state: { ...state, queue: [] }, effect: 'none' };
    case 'play': return play(state, ctx);
    case 'pause': return pause(state, ctx);
    case 'skip': return advance(state, ctx, 'skip');
    case 'seek': return seek(state, payload, ctx);
    case 'volume': return setVolume(state, payload, ctx);
    case 'mode': return setMode(state, payload);
    case 'leave': return leave(state);
    default: throw invalid('指令无效');
  }
}
