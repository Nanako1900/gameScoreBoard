// In-memory fakes for the music runtime tests: store, rooms, voice and clock.
import { Readable } from 'node:stream';
import { defaultMusicState, type MusicCommandKind, type MusicState, type MusicTrack } from '../../shared/music';
import { CommunityStoreError } from '../src/community/store';
import { createMusicRuntime } from '../src/music/runtime';
import type { ResolveResult } from '../src/music/source';
import type { StoredMusicCommand, StoredMusicSession } from '../src/music/store';
import type { MusicRuntimeDeps, MusicRuntimeStore, MusicTimers, MusicVoice } from '../src/music/types';

export const START = Date.parse('2026-11-17T10:00:00.000Z');
export const ROOM = 'room-1';
export const CHANNEL = '111111111111111111';

export function track(n: number, durationMs = 180_000): MusicTrack {
  return { id: `netease:${n}`, title: `Song ${n}`, artists: ['A'], album: 'Al', durationMs, coverUrl: null };
}

export class FakeStore implements MusicRuntimeStore {
  sessions: StoredMusicSession[] = [];
  commands: Array<StoredMusicCommand & { status: 'queued' | 'done' | 'failed'; error: string | null }> = [];
  ended: Array<{ ref: string; reason: string }> = [];
  heartbeats = 0;
  purges = 0;
  ownerChanges: Array<{ ref: string; owner: string | null }> = [];
  saves = 0;
  /** Bumps the stored version right before the next N saves, simulating a concurrent writer. */
  conflictsBeforeSave = 0;
  private nextId = 1;

  constructor(private readonly clock: () => number) {}

  addSession(overrides: Partial<StoredMusicSession> = {}): StoredMusicSession {
    const at = new Date(this.clock()).toISOString();
    const session: StoredMusicSession = {
      ref: `s${this.nextId++}`, roomRef: ROOM, invitedBy: 'm1', status: 'requested', endReason: null,
      state: defaultMusicState(), version: 1, accountOwner: null, createdAt: at, updatedAt: at, endedAt: null,
      ...overrides,
    };
    this.sessions = [...this.sessions, session];
    return session;
  }

  command(kind: MusicCommandKind, payload: Record<string, unknown> = {}, sessionRef?: string): string {
    const ref = sessionRef ?? this.live()!.ref;
    const id = String(this.nextId++);
    this.commands = [...this.commands, { id, sessionRef: ref, actor: 'm1', kind, payload, requestKey: `r${id}`,
      createdAt: new Date(this.clock()).toISOString(), status: 'queued', error: null }];
    return id;
  }

  enqueue(...ns: number[]): string {
    return this.command('enqueue', { tracks: ns.map((n) => track(n)) });
  }

  live(): StoredMusicSession | null {
    return this.sessions.find((s) => s.status !== 'ended') ?? null;
  }

  state(): MusicState {
    return this.live()!.state;
  }

  result(id: string): { status: string; error: string | null } {
    const found = this.commands.find((c) => c.id === id)!;
    return { status: found.status, error: found.error };
  }

  private replace(ref: string, patch: Partial<StoredMusicSession>): StoredMusicSession {
    this.sessions = this.sessions.map((s) => (s.ref === ref ? { ...s, ...patch } : s));
    return this.sessions.find((s) => s.ref === ref)!;
  }

  async activeSession() { return this.live(); }
  async session(ref: string) { return this.sessions.find((s) => s.ref === ref) ?? null; }

  async setStatus(ref: string, status: 'connecting' | 'active') {
    const found = this.sessions.find((s) => s.ref === ref);
    if (!found || found.status === 'ended') return null;
    return this.replace(ref, { status });
  }

  async saveState(ref: string, state: MusicState, expectedVersion: number) {
    this.saves += 1;
    const found = this.sessions.find((s) => s.ref === ref);
    if (found && this.conflictsBeforeSave > 0) {
      this.conflictsBeforeSave -= 1;
      this.replace(ref, { version: found.version + 1 });
    }
    const fresh = this.sessions.find((s) => s.ref === ref);
    if (!fresh || fresh.status === 'ended' || fresh.version !== expectedVersion) {
      throw new CommunityStoreError(409, 'version_conflict', '播放状态已变化，请刷新后重试');
    }
    return this.replace(ref, { state, version: fresh.version + 1 });
  }

  async setAccountOwner(ref: string, owner: string | null) {
    const found = this.sessions.find((s) => s.ref === ref);
    if (!found || found.status === 'ended') throw new CommunityStoreError(409, 'session_ended', '会话已结束');
    this.ownerChanges = [...this.ownerChanges, { ref, owner }];
    return this.replace(ref, { accountOwner: owner, version: found.version + 1 });
  }

  async endSession(ref: string, reason: string) {
    const found = this.sessions.find((s) => s.ref === ref);
    if (!found || found.status === 'ended') return false;
    this.replace(ref, { status: 'ended', endReason: reason, accountOwner: null });
    this.ended = [...this.ended, { ref, reason }];
    this.commands = this.commands.map((c) => (c.sessionRef === ref && c.status === 'queued'
      ? { ...c, status: 'failed', error: '会话已结束' } : c));
    return true;
  }

  async claimCommands(sessionRef: string, limit: number) {
    return this.commands.filter((c) => c.sessionRef === sessionRef && c.status === 'queued').slice(0, limit);
  }

  async finishCommand(id: string, error: string | null) {
    this.commands = this.commands.map((c) => (c.id === id && c.status === 'queued'
      ? { ...c, status: error === null ? 'done' : 'failed', error } : c));
  }

  async heartbeat() { this.heartbeats += 1; }
  async purgeExpired() { this.purges += 1; }
}

export interface PlayCall { seekMs: number; volume: number; stream: Readable }

export class FakeVoice implements MusicVoice {
  joinError: Error | null = null;
  joins: string[] = [];
  plays: PlayCall[] = [];
  calls: string[] = [];
  announced: Array<{ channelId: string; url: string }> = [];
  announceError: Error | null = null;
  /** When set, announce() never settles. */
  announceHangs = false;
  humanCount: number | null = 1;
  private nextPlayId = 0;
  private endCb: (playId: number, error: Error | null) => void = () => undefined;
  private disconnectCb: () => void = () => undefined;

  async join(channelId: string) {
    this.joins = [...this.joins, channelId];
    if (this.joinError) throw this.joinError;
  }
  play(input: PlayCall) {
    this.plays = [...this.plays, input];
    this.calls = [...this.calls, 'play'];
    this.nextPlayId += 1;
    return this.nextPlayId;
  }
  pause() { this.calls = [...this.calls, 'pause']; }
  resume() { this.calls = [...this.calls, 'resume']; }
  stop() { this.calls = [...this.calls, 'stop']; }
  leave() { this.calls = [...this.calls, 'leave']; }
  onEnd(cb: (playId: number, error: Error | null) => void) { this.endCb = cb; }
  onDisconnect(cb: () => void) { this.disconnectCb = cb; }
  humans() { return this.humanCount; }
  async announce(channelId: string, url: string) {
    if (this.announceHangs) return new Promise<void>(() => undefined);
    if (this.announceError) throw this.announceError;
    this.announced = [...this.announced, { channelId, url }];
  }
  /** Ends the stream with the given play id (default: the latest one). */
  end(error: Error | null = null, playId = this.nextPlayId) { this.endCb(playId, error); }
  lastPlayId() { return this.nextPlayId; }
  disconnect() { this.disconnectCb(); }
}

/** Manual interval: tests fire it explicitly. */
export class FakeTimers implements MusicTimers {
  private callbacks: Array<{ ms: number; fn: () => void }> = [];
  every(ms: number, fn: () => void) {
    const entry = { ms, fn };
    this.callbacks = [...this.callbacks, entry];
    return () => { this.callbacks = this.callbacks.filter((c) => c !== entry); };
  }
  intervals() { return this.callbacks.map((c) => c.ms); }
  fire() { this.callbacks.forEach((c) => c.fn()); }
}

export function makeHarness(overrides: Partial<MusicRuntimeDeps> = {}) {
  let now = START;
  let key = 0;
  const clock = { now: () => now, advance: (ms: number) => { now += ms; } };
  const store = new FakeStore(clock.now);
  const voice = new FakeVoice();
  const timers = new FakeTimers();
  const errors: unknown[] = [];
  const resolved: Array<{ trackId: string; cookie: string | null }> = [];
  const audio: string[] = [];
  const control = {
    channel: CHANNEL as string | null,
    readOnly: false,
    unplayable: new Set<string>(),
    throwing: new Set<string>(),
    cookie: null as string | null,
  };
  const deps: MusicRuntimeDeps = {
    store,
    rooms: { channelFor: async () => control.channel },
    voice,
    resolveTrack: async (trackId, cookie): Promise<ResolveResult> => {
      resolved.push({ trackId, cookie });
      if (control.throwing.has(trackId)) throw new Error('network down');
      if (control.unplayable.has(trackId)) return { unplayable: '需要会员' };
      return { url: `https://m701.music.126.net/${trackId}.mp3` };
    },
    openAudio: async (url) => { audio.push(url); return Readable.from([Buffer.from('x')]); },
    cookieFor: async () => control.cookie,
    now: clock.now,
    random: () => 0,
    newKey: () => `k${++key}`,
    playerUrl: (roomRef) => `https://example.test/community/music/${roomRef}`,
    isReadOnly: () => control.readOnly,
    onError: (error) => { errors.push(error); },
    timers,
    ...overrides,
  };
  const runtime = createMusicRuntime(deps);
  return { runtime, store, voice, timers, clock, errors, resolved, audio, control, deps };
}

/** Starts the runtime past the leftover check and brings one session to `active`. */
export async function activeHarness(overrides: Partial<MusicRuntimeDeps> = {}) {
  const harness = makeHarness(overrides);
  await harness.runtime.tick();
  harness.store.addSession();
  await harness.runtime.tick();
  return harness;
}
