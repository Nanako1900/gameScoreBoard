import { randomUUID } from 'node:crypto';
import { ChannelType, PermissionFlagsBits as P, Routes, type Client } from 'discord.js';
import { defaultCommunitySettings, type CommunityJson } from '../../shared/community';
import { CommunityEngine, type CommunityEngineOptions } from '../src/community/engine';
import { createCommunityDiscord } from '../src/community/discord';
import { CommunityStoreError, type CommunityStore, type StoredOperation, type StoredResource, type StoredRoom } from '../src/community/store';

export const creationIds = {
  guild: '111111111111111111', bot: '222222222222222222', owner: '333333333333333333',
  category: '444444444444444444', creator: '555555555555555555', waiting: '666666666666666666',
  created: '777777777777777777', botRole: '888888888888888888', guildOwner: '999999999999999999',
} as const;
export type RestKind = 'guild' | 'roles' | 'bot_member' | 'member' | 'category' | 'source' | 'room' | 'create' | 'move';
export interface RestTrace {
  method: 'get' | 'post' | 'patch'; kind: RestKind; startedMs: number; finishedMs: number | null;
  startedWave: number; finishedWave: number | null;
}
interface Scheduled { due: number; wave: number; complete: () => void }

/** A discrete event clock: every REST call costs the same injected delay.
 * Promise continuations run between batches, so parallel reads share a wave.
 * Logical waves remain observable even when the injected delay is zero. */
export class VirtualRestClock {
  now = 0;
  wave = 0;
  readonly trace: RestTrace[] = [];
  private scheduled: Scheduled[] = [];
  constructor(readonly restDelayMs: number) {
    if (!Number.isFinite(restDelayMs) || restDelayMs < 0) throw new Error('REST delay must be nonnegative');
  }
  request<T>(method: RestTrace['method'], kind: RestKind, response: () => T): Promise<T> {
    const row: RestTrace = { method, kind, startedMs: this.now, finishedMs: null, startedWave: this.wave, finishedWave: null };
    this.trace.push(row);
    return new Promise<T>((resolve, reject) => this.scheduled.push({ due: this.now + this.restDelayMs, wave: this.wave + 1, complete: () => {
      row.finishedMs = this.now; row.finishedWave = this.wave;
      try { resolve(response()); } catch (error) { reject(error); }
    } }));
  }
  async run<T>(work: () => Promise<T>): Promise<T> {
    let done = false, value: T | undefined, failure: unknown, failed = false;
    void work().then(result => { value = result; done = true; }, error => { failure = error; failed = true; done = true; });
    for (let steps = 0; steps < 1000; steps += 1) {
      // Let all native promise continuations schedule their next REST reads.
      await new Promise<void>(resolve => setImmediate(resolve));
      if (done) { if (failed) throw failure; return value as T; }
      if (!this.scheduled.length) throw new Error('Local benchmark stalled outside its REST clock');
      const next = Math.min(...this.scheduled.map(event => event.due));
      const batch = this.scheduled.filter(event => event.due === next);
      this.scheduled = this.scheduled.filter(event => event.due !== next);
      this.now = next; this.wave = Math.max(this.wave, ...batch.map(event => event.wave));
      for (const event of batch) event.complete();
    }
    throw new Error('Local benchmark exceeded its finite request budget');
  }
}

interface RawChannel {
  id: string; guild_id: string; type: number; name: string; parent_id: string | null; user_limit: number;
  permission_overwrites: Array<{ id: string; type: number; allow: string; deny: string }>;
}
export interface CreationFixtureOptions {
  delayMs?: number;
  engine?: typeof CommunityEngine;
  adapter?: typeof createCommunityDiscord;
  engineOptions?: Partial<CommunityEngineOptions>;
  administrator?: boolean;
}
export function creationFixture(options: CreationFixtureOptions = {}) {
  const clock = new VirtualRestClock(options.delayMs ?? 100);
  const epoch = Date.parse('2026-10-28T12:00:00Z');
  const instant = () => new Date(epoch + clock.now).toISOString();
  const settings = defaultCommunitySettings(); settings.enabled = true; settings.rooms.enabled = true;
  const resources = new Map<string, StoredResource>();
  const add = (kind: StoredResource['kind'], externalId: string, name = kind === 'member' ? '本地测试成员' : '本地测试频道') => {
    const resource: StoredResource = { ref: randomUUID(), kind, externalId, name, available: true, safe: true, metadata: {}, seenAt: instant() };
    resources.set(resource.ref, resource); return resource;
  };
  const owner = add('member', creationIds.owner), category = add('category', creationIds.category);
  // The normal scenario starts after a complete ready snapshot. The REST
  // member remains independent so stale mappings cannot prove write authority.
  owner.metadata = { bot: false, protected: false, roleIds: [], joinedAt: null };
  const creator = add('voice', creationIds.creator), waiting = add('voice', creationIds.waiting);
  Object.assign(settings.rooms, { categoryRef: category.ref, creatorRef: creator.ref, waitingRef: waiting.ref, cooldownSeconds: 0 });
  const rooms: StoredRoom[] = [], operations: StoredOperation[] = [];
  const access = new Map<string, Array<{ memberRef: string; allowed: boolean; blocked: boolean; present: boolean }>>();
  const errors: unknown[] = [];
  const events: string[] = [];
  let ready = true, memberAvailable = true, memberBot = false;
  let botPermissions = P.ViewChannel | P.Connect | P.MoveMembers | P.ManageChannels | P.ManageRoles | P.ViewAuditLog;
  const runtime = { ready: true, appliedVersion: 1, syncedAt: instant(), problem: null };
  const hooks: { afterCreate?: () => void; beforeMove?: () => void; beforeFinish?: () => void;
    request?: (kind: RestKind) => void; response?: (kind: RestKind) => void } = {};
  const voices = new Map<string, { id: string; channelId: string | null }>([[creationIds.owner, { id: creationIds.owner, channelId: creationIds.creator }]]);
  const rawChannel = (id: string, type = ChannelType.GuildVoice): RawChannel => ({ id, guild_id: creationIds.guild,
    type, name: '本地测试频道', parent_id: type === ChannelType.GuildCategory ? null : creationIds.category, user_limit: 0, permission_overwrites: [] });
  const channels = new Map<string, RawChannel>([
    [creationIds.category, rawChannel(creationIds.category, ChannelType.GuildCategory)],
    [creationIds.creator, rawChannel(creationIds.creator)], [creationIds.waiting, rawChannel(creationIds.waiting)],
  ]);
  const member = (id: string) => ({ user: { id, username: id === creationIds.bot ? '本地Bot' : '本地测试成员',
    bot: id === creationIds.bot || id === creationIds.owner && memberBot },
    roles: id === creationIds.bot ? [creationIds.botRole] : [], joined_at: null });
  const classify = (path: string): RestKind => {
    if (path === Routes.guild(creationIds.guild)) return 'guild';
    if (path === Routes.guildRoles(creationIds.guild)) return 'roles';
    if (path === Routes.guildMember(creationIds.guild, creationIds.bot)) return 'bot_member';
    if (path === Routes.guildMember(creationIds.guild, creationIds.owner)) return 'member';
    if (path === Routes.channel(creationIds.category)) return 'category';
    if (path === Routes.channel(creationIds.creator) || path === Routes.channel(creationIds.waiting)) return 'source';
    if (path.startsWith('/channels/')) return 'room';
    throw new Error('Unexpected local REST read');
  };
  const read = (path: string): unknown => {
    if (path === Routes.guild(creationIds.guild)) return { id: creationIds.guild, owner_id: creationIds.guildOwner, name: '本地社区' };
    if (path === Routes.guildRoles(creationIds.guild)) return [
      { id: creationIds.guild, name: '@everyone', position: 0, permissions: (P.ViewChannel | P.Connect).toString(), managed: false },
      { id: creationIds.botRole, name: '本地Bot', position: 1, permissions: botPermissions.toString(), managed: true },
    ];
    if (path === Routes.guildMember(creationIds.guild, creationIds.owner)) {
      if (!memberAvailable) throw { status: 404 };
      return member(creationIds.owner);
    }
    if (path === Routes.guildMember(creationIds.guild, creationIds.bot)) return member(creationIds.bot);
    if (path.startsWith('/channels/')) {
      const channel = channels.get(path.split('/')[2]); if (!channel) throw { status: 404 };
      return structuredClone(channel);
    }
    throw new Error('Unexpected local REST response');
  };
  const client = { user: { id: creationIds.bot }, isReady: () => ready,
    guilds: { cache: new Map([[creationIds.guild, { id: creationIds.guild, available: true, voiceStates: { cache: voices } }]]) },
    rest: {
      get: (path: string) => { const kind = classify(path); hooks.request?.(kind); return clock.request('get', kind, () => {
        const value = read(path); hooks.response?.(kind); return value;
      }); },
      post: (path: string, input: { body: Partial<RawChannel> }) => {
        if (path !== Routes.guildChannels(creationIds.guild)) throw new Error('Unexpected local POST');
        hooks.request?.('create'); return clock.request('post', 'create', () => {
          const created = { ...rawChannel(creationIds.created), ...input.body, id: creationIds.created };
          channels.set(creationIds.created, created); events.push('discord.created'); hooks.afterCreate?.(); return structuredClone(created);
        });
      },
      patch: (path: string, input: { body: { channel_id: string | null } }) => {
        if (path !== Routes.guildMember(creationIds.guild, creationIds.owner)) throw new Error('Unexpected local PATCH');
        hooks.request?.('move'); return clock.request('patch', 'move', () => {
          hooks.beforeMove?.(); voices.set(creationIds.owner, { id: creationIds.owner, channelId: input.body.channel_id });
          events.push('discord.moved'); return {};
        });
      },
    },
  } as unknown as Client;
  const store = {
    guildId: creationIds.guild,
    pool: { query: async () => ({ rows: [], rowCount: 0 }) },
    settings: async () => ({ settings, version: 1, runtime: { ...runtime } }),
    runtime: async () => ({ ...runtime }),
    setRuntime: async (patch: object) => { Object.assign(runtime, patch); },
    resource: async (ref: string, kind?: string) => { const row = resources.get(ref); return row && (!kind || kind === row.kind) ? row : null; },
    resourceByExternal: async (kind: string, id: string) => [...resources.values()].find(row => row.kind === kind && row.externalId === id) ?? null,
    storedResources: async (kind?: string) => [...resources.values()].filter(row => !kind || row.kind === kind),
    upsertResource: async (kind: StoredResource['kind'], id: string, name: string, patch: object = {}) => {
      const row = [...resources.values()].find(row => row.kind === kind && row.externalId === id) ?? add(kind, id, name);
      Object.assign(row, { name }, patch); return row;
    },
    listRooms: async (input?: { includeClosed?: boolean }) => rooms.filter(room => input?.includeClosed || room.status !== 'closed'),
    getRoom: async (ref: string) => rooms.find(room => room.ref === ref) ?? null,
    createRoom: async (ownerRef: string, name: string, input: Partial<StoredRoom>) => {
      if (rooms.some(room => room.ownerRef === ownerRef && room.status !== 'closed')) throw new CommunityStoreError(409, 'room_exists', '本地房间已存在');
      const room: StoredRoom = { ref: randomUUID(), ownerRef, channelRef: null, name, status: 'creating', visibility: 'open', userLimit: 0,
        version: 1, transferToRef: null, transferExpiresAt: null, ownerLeftAt: null, emptySince: null, cleanupAt: null,
        metadata: {}, createdAt: instant(), updatedAt: instant(), ...input };
      rooms.push(room); events.push('store.intention'); return room;
    },
    patchRoom: async (ref: string, patch: Partial<StoredRoom>, version: number) => {
      const room = rooms.find(room => room.ref === ref);
      if (!room || room.version !== version) throw new CommunityStoreError(409, 'version_conflict', '本地房间已变化');
      Object.assign(room, patch, { version: version + 1, updatedAt: instant() });
      if (patch.status === 'active') events.push('store.active'); return room;
    },
    roomAccess: async (ref: string) => access.get(ref) ?? [],
    setRoomAccess: async (ref: string, memberRef: string, patch: object) => {
      const list = access.get(ref) ?? [];
      let row = list.find(row => row.memberRef === memberRef);
      if (!row) { row = { memberRef, allowed: false, blocked: false, present: false }; list.push(row); }
      Object.assign(row, patch); access.set(ref, list); return row;
    },
    enqueue: async (kind: string, roomRef: string | null, actor: StoredOperation['actor'], payload: CommunityJson, requestKey: string, expectedVersion?: number) => {
      const duplicate = operations.find(operation => operation.requestKey === requestKey); if (duplicate) return duplicate;
      const operation: StoredOperation = { ref: randomUUID(), kind, roomRef, actor, payload, requestKey, expectedVersion: expectedVersion ?? null,
        status: 'queued', claimToken: null, attempts: 0, createdAt: instant(), finishedAt: null, error: null, result: null,
        expiresAt: new Date(epoch + 300_000).toISOString(), availableAt: instant(), errorCode: null };
      operations.push(operation); return operation;
    },
    recoverExpired: async () => {},
    claim: async () => { const operation = operations.find(operation => operation.status === 'queued');
      if (!operation) return null; operation.status = 'running'; operation.claimToken = randomUUID(); operation.attempts += 1; return operation; },
    renew: async () => true,
    finish: async (ref: string, _token: string, outcome: object) => {
      hooks.beforeFinish?.(); Object.assign(operations.find(operation => operation.ref === ref)!, outcome); events.push('store.finished'); return true;
    },
    getOperation: async (ref: string) => operations.find(operation => operation.ref === ref) ?? null,
    addAudit: async () => {},
  } as unknown as CommunityStore;
  const discord = (options.adapter ?? createCommunityDiscord)(client, creationIds.guild);
  const engine = new (options.engine ?? CommunityEngine)(store, discord, {
    authorize: async actor => ({ memberRef: actor.memberRef ?? null, isAdmin: options.administrator ?? false }),
    now: () => epoch + clock.now, onError: error => errors.push(error), ...options.engineOptions,
  });
  const enter = () => engine.onVoice(creationIds.owner, creationIds.creator, creationIds.waiting);
  const seedUnrelatedRooms = async (count: number) => {
    for (let index = 0; index < count; index += 1) {
      const memberId = String(1000000000000000000n + BigInt(index)), channelId = String(2000000000000000000n + BigInt(index));
      const person = add('member', memberId), channel = add('voice', channelId);
      channels.set(channelId, rawChannel(channelId));
      const room = await store.createRoom(person.ref, '本地无关房间', { channelRef: channel.ref });
      await store.patchRoom(room.ref, { status: 'active' }, room.version);
    }
  };
  const summary = () => {
    const completed = (kind: RestKind) => clock.trace.find(row => row.kind === kind && row.finishedMs !== null);
    const moved = completed('move'), created = completed('create');
    const before = (end: RestTrace | undefined) => end ? clock.trace.filter(row => row.finishedMs !== null &&
      (row.finishedWave! < end.finishedWave! || row.finishedWave === end.finishedWave)).length : null;
    return {
      restDelayMs: clock.restDelayMs, createRequests: before(created), createWaves: created?.finishedWave ?? null,
      createMs: created?.finishedMs ?? null, moveRequests: before(moved), moveWaves: moved?.finishedWave ?? null,
      moveMs: moved?.finishedMs ?? null, totalRequests: clock.trace.length, totalWaves: clock.wave, totalMs: clock.now,
      creates: clock.trace.filter(row => row.kind === 'create').length, moves: clock.trace.filter(row => row.kind === 'move').length,
      outcome: operations[0]?.status ?? 'not_queued',
      requests: Object.fromEntries([...new Set(clock.trace.map(row => row.kind))].map(kind => [kind, clock.trace.filter(row => row.kind === kind).length])),
    };
  };
  return { clock, engine, discord, store, resources, rooms, operations, owner, category, creator, settings, channels, voices,
    errors, events, hooks, enter, summary, seedUnrelatedRooms, setReady: (value: boolean) => { ready = value; },
    setMemberAvailable: (value: boolean) => { memberAvailable = value; }, setMemberBot: (value: boolean) => { memberBot = value; },
    setBotPermissions: (value: bigint) => { botPermissions = value; } };
}
