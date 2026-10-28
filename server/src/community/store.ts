import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { checkOut } from '../db/d1';
import { defaultCommunitySettings, isCommunityRef, parseCommunitySettings, type CommunitySettings,
  type CommunityRuntimeView, type CommunityResourceKind, type CommunityResourceView, type CommunityOperationView,
  type CommunityOperationStatus, type CommunityJson, type CommunityAuditView } from '../../../shared/community';

type Row = Record<string, unknown>;
export type CommunityJsonObject = { [key: string]: CommunityJson };
export interface CommunityActor { source: 'web' | 'discord' | 'system'; userId?: string; memberRef?: string }
export interface StoredSettings { settings: CommunitySettings; version: number; runtime: CommunityRuntimeView }
export interface StoredResource extends CommunityResourceView { externalId: string; metadata: CommunityJsonObject; seenAt: string }
export type CommunityRoomStatus = 'creating' | 'active' | 'closing' | 'closed' | 'needs_review';
export interface StoredRoom {
  ref: string; ownerRef: string | null; channelRef: string | null; name: string; status: CommunityRoomStatus;
  visibility: 'open' | 'locked' | 'hidden'; userLimit: number; version: number;
  transferToRef: string | null; transferExpiresAt: string | null; ownerLeftAt: string | null;
  emptySince: string | null; cleanupAt: string | null; metadata: CommunityJsonObject; createdAt: string; updatedAt: string;
}
export type RoomPatch = Partial<Pick<StoredRoom, 'ownerRef' | 'channelRef' | 'name' | 'status' | 'visibility' | 'userLimit' |
  'transferToRef' | 'transferExpiresAt' | 'ownerLeftAt' | 'emptySince' | 'cleanupAt' | 'metadata'>>;
export interface RoomAccess { memberRef: string; allowed: boolean; blocked: boolean; present: boolean; joinedAt: string | null; updatedAt: string }
export interface StoredOperation extends CommunityOperationView {
  actor: CommunityActor; payload: CommunityJson; requestKey: string; expectedVersion: number | null;
  claimToken: string | null; attempts: number; expiresAt: string | null; availableAt: string; errorCode: string | null;
}
export interface OperationOutcome {
  status: Exclude<CommunityOperationStatus, 'queued' | 'running'>; result?: CommunityJson; error?: string; retryAfterSeconds?: number;
}
export class CommunityStoreError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); this.name = 'CommunityStoreError'; }
}
const ERRORS: Record<string, string> = {
  operation_expired: '操作已过期，请重新检查当前状态', execution_uncertain: '操作结果需要对账，请稍后查看',
  bot_offline: '机器人暂未就绪', permissions_missing: '机器人缺少所需权限', resource_missing: '目标资源已不可用',
  membership_required: '需要当前服务器成员身份', not_owner: '当前账号没有房间管理权限', version_conflict: '内容已变化，请刷新后重试',
  feature_disabled: '此功能已停用', rate_limited: '操作过于频繁，请稍后重试', read_only: '系统维护中，请稍后重试',
  discord_error: 'Discord 操作暂未成功，请稍后重试', invalid_input: '请求内容无效', unknown: '社区操作暂未成功，请稍后重试',
};
function safeCode(value: string | undefined): string | null { return value === undefined ? null : Object.hasOwn(ERRORS, value) ? value : 'unknown'; }
function problem(value: string | null): string | null { return value === null ? null : ERRORS[value] ?? ERRORS.unknown; }
function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(+date) ? date.toISOString() : null;
}
const str = (row: Row, key: string): string => String(row[key] ?? '');
const nullable = (row: Row, key: string): string | null => row[key] == null ? null : String(row[key]);
function object(value: unknown): CommunityJsonObject { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as CommunityJsonObject : {}; }
function reject(code: string, message: string, status = 400): never { throw new CommunityStoreError(status, code, message); }
function ref(value: unknown): asserts value is string { if (!isCommunityRef(value)) reject('invalid_resource', '资源引用无效'); }
function count(value: number, min = 0, max = Number.MAX_SAFE_INTEGER): void { if (!Number.isSafeInteger(value) || value < min || value > max) reject('invalid_input', '数值超出允许范围'); }
function label(value: string, max = 100): string { if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\u0000')) reject('invalid_input', '名称或内容格式无效'); return value.trim(); }
function cleanJson(value: CommunityJson, depth = 0): CommunityJson {
  if (depth > 20) reject('invalid_input', '请求结构过于复杂');
  if (typeof value === 'string') { if (value.includes('\u0000')) reject('invalid_input', '请求包含非法字符'); return value; }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') { if (!Number.isFinite(value)) reject('invalid_input', '请求包含无效数值'); return value; }
  if (Array.isArray(value)) return value.map(item => cleanJson(item, depth + 1));
  if (typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [label(key, 100), cleanJson(value[key], depth + 1)]));
  return reject('invalid_input', '请求包含无效内容');
}
function json(value: CommunityJson): CommunityJson { const clean = cleanJson(value); if (Buffer.byteLength(JSON.stringify(clean)) > 65_536) reject('invalid_input', '请求内容过长'); return clean; }
/** Public result content is application data; never pass upstream diagnostic IDs through it. */
function publicJson(value: CommunityJson): CommunityJson {
  if (typeof value === 'string') return value.replace(/\b\d{17,20}\b/g, '[隐藏]');
  if (Array.isArray(value)) return value.map(publicJson);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(?:discord|external|channel|guild|role|message)[_-]?(?:user[_-]?)?id$/i.test(key))
    .map(([key, item]) => [key, publicJson(item)]));
  return value;
}
function resourceRow(row: Row): StoredResource {
  return { ref: str(row, 'ref'), name: str(row, 'name'), kind: str(row, 'kind') as CommunityResourceKind,
    available: row.available === true, safe: row.safe === true, externalId: str(row, 'external_id'),
    metadata: object(row.metadata), seenAt: iso(row.seen_at)! };
}
function roomRow(row: Row): StoredRoom {
  return { ref: str(row, 'ref'), ownerRef: nullable(row, 'owner_ref'), channelRef: nullable(row, 'channel_ref'), name: str(row, 'name'),
    status: str(row, 'status') as CommunityRoomStatus, visibility: str(row, 'visibility') as StoredRoom['visibility'], userLimit: Number(row.user_limit),
    version: Number(row.version), transferToRef: nullable(row, 'transfer_to_ref'), transferExpiresAt: iso(row.transfer_expires_at),
    ownerLeftAt: iso(row.owner_left_at), emptySince: iso(row.empty_since), cleanupAt: iso(row.cleanup_at), metadata: object(row.metadata),
    createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at)! };
}
function operationRow(row: Row): StoredOperation {
  const errorCode = nullable(row, 'error_code');
  return { ref: str(row, 'ref'), kind: str(row, 'kind'), roomRef: nullable(row, 'room_ref'), status: str(row, 'status') as CommunityOperationStatus,
    createdAt: iso(row.created_at)!, finishedAt: iso(row.finished_at), error: problem(errorCode), result: publicJson(row.result as CommunityJson),
    actor: { source: str(row, 'actor_source') as CommunityActor['source'], ...(row.actor_user_id ? { userId: str(row, 'actor_user_id') } : {}),
      ...(row.actor_member_ref ? { memberRef: str(row, 'actor_member_ref') } : {}) }, payload: row.payload as CommunityJson,
    requestKey: str(row, 'request_key'), expectedVersion: row.expected_version === null ? null : Number(row.expected_version),
    claimToken: nullable(row, 'claim_token'), attempts: Number(row.attempts), expiresAt: iso(row.expires_at), availableAt: iso(row.available_at)!, errorCode };
}
export function operationView(op: StoredOperation): CommunityOperationView {
  return { ref: op.ref, kind: op.kind, roomRef: op.roomRef, status: op.status, createdAt: op.createdAt,
    finishedAt: op.finishedAt, error: op.error, result: publicJson(op.result) };
}
function translate(error: unknown): never {
  if (error instanceof CommunityStoreError) throw error;
  const pgError = error as { code?: string; constraint?: string };
  if (pgError.code === '23505' && pgError.constraint === 'community_rooms_live_owner') reject('room_exists', '这位成员已经有一个有效房间', 409);
  if (pgError.code === '23505') reject('conflict', '资源状态冲突，请刷新后重试', 409);
  if (pgError.code === '23503' || pgError.code === '23514' || pgError.code === '22P02') reject('invalid_resource', '资源或状态无效');
  throw error;
}

export class CommunityStore {
  constructor(public readonly pool: pg.Pool, public readonly guildId: string) {}
  private async tx<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const checked = await checkOut(this.pool);
    try { await checked.client.query('BEGIN'); const value = await work(checked.client); await checked.client.query('COMMIT'); return value; }
    catch (error) { if (!checked.broken) await checked.client.query('ROLLBACK').catch(() => undefined); return translate(error); }
    finally { checked.release(); }
  }
  private async settingsRow(client: Pick<pg.PoolClient, 'query'> = this.pool): Promise<Row> {
    await client.query('INSERT INTO community_settings(guild_id,settings) VALUES($1,$2) ON CONFLICT(guild_id) DO NOTHING', [this.guildId, JSON.stringify(defaultCommunitySettings())]);
    return (await client.query('SELECT * FROM community_settings WHERE guild_id=$1', [this.guildId])).rows[0] as Row;
  }
  private settingsValue(row: Row): StoredSettings {
    const updatedAt = iso(row.runtime_updated_at);
    const fresh = updatedAt !== null && Date.now() - Date.parse(updatedAt) < 120_000;
    return { settings: parseCommunitySettings(row.settings), version: Number(row.version), runtime: {
      ready: row.runtime_ready === true && fresh, syncedAt: iso(row.runtime_synced_at), appliedVersion: Number(row.runtime_applied_version),
      problem: problem(nullable(row, 'runtime_problem')) } };
  }
  async settings(): Promise<StoredSettings> { return this.settingsValue(await this.settingsRow()); }
  async saveSettings(settings: CommunitySettings, expectedVersion: number): Promise<StoredSettings> {
    count(expectedVersion); let normalized: CommunitySettings;
    try { normalized = parseCommunitySettings(settings); } catch { return reject('invalid_input', '社区设置格式或范围无效'); }
    return this.tx(async client => {
      await this.settingsRow(client);
      const updated = await client.query(`UPDATE community_settings SET settings=$3,version=version+1,updated_at=now()
        WHERE guild_id=$1 AND version=$2 RETURNING *`, [this.guildId, expectedVersion, JSON.stringify(normalized)]);
      if (!updated.rowCount) reject('version_conflict', ERRORS.version_conflict, 409);
      return this.settingsValue(updated.rows[0] as Row);
    });
  }
  async saveSettingsAndEnqueue(settings: CommunitySettings, expectedVersion: number, actor: CommunityActor,
    requestKey: string): Promise<StoredSettings & { operation: StoredOperation }> {
    count(expectedVersion); let normalized: CommunitySettings;
    try { normalized = parseCommunitySettings(settings); } catch { return reject('invalid_input', '社区设置格式或范围无效'); }
    return this.tx(async client => {
      await this.settingsRow(client);
      const queued = await this.enqueueInTransaction(client, 'settings.apply', null, actor,
        { version: expectedVersion + 1, settings: normalized as unknown as CommunityJson }, requestKey, expectedVersion, 300);
      if (!queued.created) return { ...this.settingsValue(await this.settingsRow(client)), operation: queued.operation };
      const updated = await client.query(`UPDATE community_settings SET settings=$3,version=version+1,updated_at=now()
        WHERE guild_id=$1 AND version=$2 RETURNING *`, [this.guildId, expectedVersion, JSON.stringify(normalized)]);
      if (!updated.rowCount) reject('version_conflict', ERRORS.version_conflict, 409);
      return { ...this.settingsValue(updated.rows[0] as Row), operation: queued.operation };
    });
  }
  async runtime(): Promise<CommunityRuntimeView> { return (await this.settings()).runtime; }
  async setRuntime(patch: Partial<CommunityRuntimeView>): Promise<void> {
    await this.settingsRow();
    if (patch.appliedVersion !== undefined) count(patch.appliedVersion);
    if (patch.syncedAt !== undefined && patch.syncedAt !== null && !iso(patch.syncedAt)) reject('invalid_input', '同步时间无效');
    await this.pool.query(`UPDATE community_settings SET runtime_ready=COALESCE($2,runtime_ready),
      runtime_synced_at=CASE WHEN $3 THEN $4::timestamptz ELSE runtime_synced_at END,
      runtime_applied_version=COALESCE($5,runtime_applied_version),
      runtime_problem=CASE WHEN $6 THEN $7 ELSE runtime_problem END,runtime_updated_at=now() WHERE guild_id=$1`,
    [this.guildId, patch.ready ?? null, Object.hasOwn(patch, 'syncedAt'), patch.syncedAt ?? null, patch.appliedVersion ?? null,
      Object.hasOwn(patch, 'problem'), patch.problem == null ? null : safeCode(patch.problem)]);
  }
  async upsertResource(kind: CommunityResourceKind, externalId: string, name: string,
    options: { available?: boolean; safe?: boolean; metadata?: CommunityJsonObject } = {}): Promise<StoredResource> {
    label(externalId, 100); label(name); const metadata = options.metadata === undefined ? null : json(options.metadata);
    const row = await this.pool.query(`INSERT INTO community_resources(guild_id,kind,external_id,name,available,safe,metadata)
      VALUES($1,$2,$3,$4,$5,COALESCE($6,false),COALESCE($7::jsonb,'{}'::jsonb))
      ON CONFLICT(guild_id,kind,external_id) DO UPDATE SET name=excluded.name,available=excluded.available,
      safe=COALESCE($6,community_resources.safe),metadata=COALESCE($7::jsonb,community_resources.metadata),seen_at=now() RETURNING *`,
    [this.guildId, kind, externalId, name.trim(), options.available ?? true, options.safe ?? null, metadata === null ? null : JSON.stringify(metadata)]);
    return resourceRow(row.rows[0] as Row);
  }
  async resource(resourceRef: string, kind?: CommunityResourceKind): Promise<StoredResource | null> {
    if (!isCommunityRef(resourceRef)) return null;
    const row = (await this.pool.query('SELECT * FROM community_resources WHERE guild_id=$1 AND ref=$2 AND ($3::text IS NULL OR kind=$3)', [this.guildId, resourceRef, kind ?? null])).rows[0];
    return row ? resourceRow(row as Row) : null;
  }
  async resourceByExternal(kind: CommunityResourceKind, externalId: string): Promise<StoredResource | null> {
    const row = (await this.pool.query('SELECT * FROM community_resources WHERE guild_id=$1 AND kind=$2 AND external_id=$3', [this.guildId, kind, externalId])).rows[0];
    return row ? resourceRow(row as Row) : null;
  }
  async storedResources(kind?: CommunityResourceKind): Promise<StoredResource[]> {
    return (await this.pool.query('SELECT * FROM community_resources WHERE guild_id=$1 AND ($2::text IS NULL OR kind=$2) ORDER BY kind,name,ref LIMIT 1000', [this.guildId, kind ?? null])).rows.map(row => resourceRow(row as Row));
  }
  async resources(kind?: CommunityResourceKind): Promise<CommunityResourceView[]> {
    return (await this.storedResources(kind)).map(({ ref, name, kind, available, safe }) => ({ ref, name, kind, available, safe }));
  }
  private async requireResource(resourceRef: string | null, kind: CommunityResourceKind, client: Pick<pg.PoolClient, 'query'> = this.pool): Promise<void> {
    if (resourceRef === null) return; ref(resourceRef);
    const row = await client.query('SELECT 1 FROM community_resources WHERE guild_id=$1 AND ref=$2 AND kind=$3', [this.guildId, resourceRef, kind]);
    if (!row.rowCount) reject('invalid_resource', '资源不存在或类型不匹配');
  }
  async createRoom(ownerRef: string, name: string, options: { channelRef?: string | null; visibility?: StoredRoom['visibility']; userLimit?: number; metadata?: CommunityJsonObject; maxRooms?: number } = {}): Promise<StoredRoom> {
    label(name); count(options.userLimit ?? 0, 0, 99); if (options.maxRooms !== undefined) count(options.maxRooms, 1, 100);
    return this.tx(async client => {
      await this.requireResource(ownerRef, 'member', client); await this.requireResource(options.channelRef ?? null, 'voice', client);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['community:rooms:' + this.guildId]);
      if (options.maxRooms !== undefined) {
        const live = await client.query("SELECT count(*)::int AS count FROM community_rooms WHERE guild_id=$1 AND status IN ('creating','active','closing','needs_review')", [this.guildId]);
        if (Number(live.rows[0].count) >= options.maxRooms) reject('room_limit', '服务器当前房间数已达到上限', 409);
      }
      const row = await client.query(`INSERT INTO community_rooms(guild_id,owner_ref,channel_ref,name,visibility,user_limit,metadata)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [this.guildId, ownerRef, options.channelRef ?? null, name.trim(), options.visibility ?? 'open', options.userLimit ?? 0, JSON.stringify(json(options.metadata ?? {}))]);
      return roomRow(row.rows[0] as Row);
    });
  }
  async getRoom(roomRef: string): Promise<StoredRoom | null> {
    if (!isCommunityRef(roomRef)) return null;
    const row = (await this.pool.query('SELECT * FROM community_rooms WHERE guild_id=$1 AND ref=$2', [this.guildId, roomRef])).rows[0];
    return row ? roomRow(row as Row) : null;
  }
  async listRooms(options: { includeClosed?: boolean } = {}): Promise<StoredRoom[]> {
    return (await this.pool.query(`SELECT * FROM community_rooms WHERE guild_id=$1 AND ($2 OR status<>'closed') ORDER BY created_at,ref LIMIT 1000`, [this.guildId, options.includeClosed ?? false])).rows.map(row => roomRow(row as Row));
  }
  async patchRoom(roomRef: string, patch: RoomPatch, expectedVersion: number): Promise<StoredRoom> {
    ref(roomRef); count(expectedVersion, 1);
    const columns: Record<keyof RoomPatch, string> = { ownerRef: 'owner_ref', channelRef: 'channel_ref', name: 'name', status: 'status', visibility: 'visibility', userLimit: 'user_limit', transferToRef: 'transfer_to_ref', transferExpiresAt: 'transfer_expires_at', ownerLeftAt: 'owner_left_at', emptySince: 'empty_since', cleanupAt: 'cleanup_at', metadata: 'metadata' };
    return this.tx(async client => {
      for (const key of ['ownerRef', 'transferToRef'] as const) if (patch[key] !== undefined) await this.requireResource(patch[key]!, 'member', client);
      if (patch.channelRef !== undefined) await this.requireResource(patch.channelRef, 'voice', client);
      if (patch.name !== undefined) label(patch.name); if (patch.userLimit !== undefined) count(patch.userLimit, 0, 99);
      const values: unknown[] = [this.guildId, roomRef, expectedVersion];
      const sets: string[] = [];
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue; if (!Object.hasOwn(columns, key)) reject('invalid_input', '不支持此房间字段');
        values.push(key === 'metadata' ? JSON.stringify(json(value as CommunityJson)) : value);
        sets.push(`${columns[key as keyof RoomPatch]}=$${values.length}`);
      }
      const result = await client.query(`UPDATE community_rooms SET ${sets.length ? sets.join(',') + ',' : ''}version=version+1,updated_at=now() WHERE guild_id=$1 AND ref=$2 AND version=$3 RETURNING *`, values);
      if (!result.rowCount) {
        if (!(await client.query('SELECT 1 FROM community_rooms WHERE guild_id=$1 AND ref=$2', [this.guildId, roomRef])).rowCount) reject('not_found', '房间不存在', 404);
        reject('version_conflict', ERRORS.version_conflict, 409);
      }
      return roomRow(result.rows[0] as Row);
    });
  }
  async roomAccess(roomRef: string): Promise<RoomAccess[]> {
    if (!await this.getRoom(roomRef)) reject('not_found', '房间不存在', 404);
    return (await this.pool.query('SELECT * FROM community_room_access WHERE room_ref=$1 ORDER BY joined_at NULLS LAST,member_ref', [roomRef])).rows.map(row => ({ memberRef: String(row.member_ref), allowed: row.allowed === true, blocked: row.blocked === true, present: row.present === true, joinedAt: iso(row.joined_at), updatedAt: iso(row.updated_at)! }));
  }
  async setRoomAccess(roomRef: string, memberRef: string, patch: Partial<Pick<RoomAccess, 'allowed' | 'blocked' | 'present'>>): Promise<RoomAccess> {
    ref(roomRef); ref(memberRef);
    return this.tx(async client => {
      if (!(await client.query('SELECT 1 FROM community_rooms WHERE guild_id=$1 AND ref=$2', [this.guildId, roomRef])).rowCount) reject('not_found', '房间不存在', 404);
      await this.requireResource(memberRef, 'member', client);
      await client.query('INSERT INTO community_room_access(room_ref,member_ref) VALUES($1,$2) ON CONFLICT DO NOTHING', [roomRef, memberRef]);
      const row = (await client.query(`UPDATE community_room_access SET
        allowed=COALESCE($3,CASE WHEN $4 THEN false ELSE allowed END),blocked=COALESCE($4,CASE WHEN $3 THEN false ELSE blocked END),
        joined_at=CASE WHEN $5=true AND present=false THEN now() WHEN $5=false THEN NULL ELSE joined_at END,
        present=COALESCE($5,present),updated_at=now() WHERE room_ref=$1 AND member_ref=$2 RETURNING *`,
      [roomRef, memberRef, patch.allowed ?? null, patch.blocked ?? null, patch.present ?? null])).rows[0];
      return { memberRef, allowed: row.allowed === true, blocked: row.blocked === true, present: row.present === true, joinedAt: iso(row.joined_at), updatedAt: iso(row.updated_at)! };
    });
  }
  private actorKey(actor: CommunityActor): string {
    if (!['web', 'discord', 'system'].includes(actor.source)) reject('invalid_input', '操作来源无效');
    if (actor.source === 'web' && !actor.userId) reject('invalid_input', '缺少请求账号');
    if (actor.memberRef !== undefined) ref(actor.memberRef);
    if (actor.source === 'discord' && !actor.memberRef) reject('invalid_input', '缺少成员引用');
    return actor.source + ':' + (actor.userId ?? actor.memberRef ?? 'system');
  }
  async enqueue(kind: string, roomRef: string | null, actor: CommunityActor, payload: CommunityJson, requestKey: string, expectedVersion?: number, ttlSeconds = 300): Promise<StoredOperation> {
    return this.tx(async client => (await this.enqueueInTransaction(client, kind, roomRef, actor, payload, requestKey, expectedVersion, ttlSeconds)).operation);
  }
  async enqueueWelcome(memberRef: string, joinedAt: string | null, cooldownHours: number): Promise<StoredOperation | null> {
    ref(memberRef); count(cooldownHours, 1, 720);
    if (joinedAt !== null && !iso(joinedAt)) reject('invalid_input', '加入时间无效');
    return this.tx(async client => {
      await this.requireResource(memberRef, 'member', client);
      await client.query('INSERT INTO community_welcomes(guild_id,member_ref) VALUES($1,$2) ON CONFLICT DO NOTHING', [this.guildId, memberRef]);
      const row = (await client.query(`SELECT pending_ref,last_sent_at FROM community_welcomes
        WHERE guild_id=$1 AND member_ref=$2 FOR UPDATE`, [this.guildId, memberRef])).rows[0];
      await client.query('UPDATE community_welcomes SET joined_at=$3 WHERE guild_id=$1 AND member_ref=$2', [this.guildId, memberRef, joinedAt === null ? null : iso(joinedAt)]);
      if (row.pending_ref !== null || (row.last_sent_at !== null && Date.now() - Date.parse(iso(row.last_sent_at)!) < cooldownHours * 3_600_000)) return null;
      const queued = await this.enqueueInTransaction(client, 'welcome.send', null, { source: 'system', memberRef },
        { joinedAt: joinedAt === null ? null : iso(joinedAt) }, randomUUID(), undefined, 120);
      await client.query('UPDATE community_welcomes SET pending_ref=$3 WHERE guild_id=$1 AND member_ref=$2', [this.guildId, memberRef, queued.operation.ref]);
      return queued.operation;
    });
  }
  private async enqueueInTransaction(client: pg.PoolClient, kind: string, roomRef: string | null, actor: CommunityActor,
    payload: CommunityJson, requestKey: string, expectedVersion: number | undefined, ttlSeconds: number): Promise<{ operation: StoredOperation; created: boolean }> {
    label(kind, 100); label(requestKey, 200); count(ttlSeconds, 1, 86400); if (expectedVersion !== undefined) count(expectedVersion);
    const actorKey = this.actorKey(actor); const clean = json(payload);
    const hash = createHash('sha256').update(JSON.stringify(cleanJson({ kind, roomRef, actor: actor as unknown as CommunityJson, payload: clean, expectedVersion: expectedVersion ?? null, ttlSeconds }))).digest('hex');
    const scopeKey = roomRef ?? (kind === 'settings.apply' ? 'settings' : actorKey);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['community:enqueue:' + this.guildId + ':' + actorKey + ':' + requestKey]);
      const existing = (await client.query('SELECT * FROM community_operations WHERE guild_id=$1 AND actor_key=$2 AND request_key=$3', [this.guildId, actorKey, requestKey])).rows[0];
      if (existing) { if (existing.request_hash !== hash) reject('idempotency_conflict', '同一个请求标识不能用于不同操作', 409); return { operation: operationRow(existing as Row), created: false }; }
      if (actor.memberRef) await this.requireResource(actor.memberRef, 'member', client);
      if (roomRef !== null) {
        ref(roomRef); const room = (await client.query('SELECT version FROM community_rooms WHERE guild_id=$1 AND ref=$2', [this.guildId, roomRef])).rows[0];
        if (!room) reject('not_found', '房间不存在', 404);
        if (expectedVersion !== undefined && Number(room.version) !== expectedVersion) reject('version_conflict', ERRORS.version_conflict, 409);
      }
      const row = await client.query(`INSERT INTO community_operations(guild_id,kind,room_ref,actor_source,actor_user_id,actor_member_ref,actor_key,request_key,request_hash,scope_key,payload,expected_version,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now()+make_interval(secs=>$13)) RETURNING *`,
      [this.guildId, kind, roomRef, actor.source, actor.userId ?? null, actor.memberRef ?? null, actorKey, requestKey, hash, scopeKey, JSON.stringify(clean), expectedVersion ?? null, ttlSeconds]);
      await client.query("SELECT pg_notify('community_operations','')");return { operation: operationRow(row.rows[0] as Row), created: true };
  }
  async getOperation(operationRef: string): Promise<StoredOperation | null> {
    if (!isCommunityRef(operationRef)) return null;
    const row = (await this.pool.query('SELECT * FROM community_operations WHERE guild_id=$1 AND ref=$2', [this.guildId, operationRef])).rows[0];
    return row ? operationRow(row as Row) : null;
  }
  async listOperations(options: { roomRef?: string; limit?: number } = {}): Promise<CommunityOperationView[]> {
    count(options.limit ?? 100, 1, 500); if (options.roomRef !== undefined) ref(options.roomRef);
    return (await this.pool.query('SELECT * FROM community_operations WHERE guild_id=$1 AND ($2::uuid IS NULL OR room_ref=$2) ORDER BY created_at DESC,ref DESC LIMIT $3', [this.guildId, options.roomRef ?? null, options.limit ?? 100])).rows.map(row => operationView(operationRow(row as Row)));
  }
  async recoverExpired(): Promise<void> {
    await this.pool.query(`UPDATE community_operations SET status='needs_review',claim_token=NULL,lease_until=NULL,error_code='execution_uncertain'
      WHERE guild_id=$1 AND status='running' AND lease_until<now()`, [this.guildId]);
    await this.pool.query(`UPDATE community_operations SET status='canceled',finished_at=now(),error_code='operation_expired'
      WHERE guild_id=$1 AND status IN ('queued','retry_wait') AND expires_at<now()`, [this.guildId]);
  }
  async claim(leaseSeconds = 30): Promise<StoredOperation | null> {
    count(leaseSeconds, 1, 300);await this.recoverExpired();
    return this.tx(async client => {
      // A short guild claim lock closes the two-concurrent-claimer window for one scope.
      // Released before any Discord request; evidence writes never wait on that request.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['community:claim:' + this.guildId]);
      const row = await client.query(`UPDATE community_operations SET status='running',claim_token=gen_random_uuid(),claimed_at=now(),lease_until=now()+make_interval(secs=>$2),attempts=attempts+1
        WHERE ref=(SELECT o.ref FROM community_operations o WHERE o.guild_id=$1 AND o.status IN ('queued','retry_wait')
          AND o.available_at<=now() AND (o.expires_at IS NULL OR o.expires_at>now())
          AND NOT EXISTS(SELECT 1 FROM community_operations e WHERE e.guild_id=o.guild_id AND e.scope_key=o.scope_key
            AND ((e.status IN ('running','needs_review')) OR (e.status IN ('queued','retry_wait') AND (e.created_at,e.ref)<(o.created_at,o.ref))))
          ORDER BY o.created_at,o.ref FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`, [this.guildId, leaseSeconds]);
      return row.rows[0] ? operationRow(row.rows[0] as Row) : null;
    });
  }
  async finish(operationRef: string, claimToken: string, outcome: OperationOutcome): Promise<boolean> {
    if (!isCommunityRef(operationRef) || !isCommunityRef(claimToken)) return false;
    const statuses = ['retry_wait', 'succeeded', 'failed', 'conflict', 'canceled', 'needs_review'];
    if (!statuses.includes(outcome.status)) reject('invalid_input', '操作结果状态无效');count(outcome.retryAfterSeconds ?? 5, 0, 3600);
    const result = await this.pool.query(`UPDATE community_operations SET status=$4,result=$5,error_code=$6,claim_token=NULL,lease_until=NULL,
      available_at=CASE WHEN $4='retry_wait' THEN now()+make_interval(secs=>$7) ELSE available_at END,
      finished_at=CASE WHEN $4 IN ('retry_wait','needs_review') THEN NULL ELSE now() END
      WHERE guild_id=$1 AND ref=$2 AND claim_token=$3 AND status='running' RETURNING ref`,
    [this.guildId, operationRef, claimToken, outcome.status, JSON.stringify(json(outcome.result ?? null)), safeCode(outcome.error), outcome.retryAfterSeconds ?? 5]);
    return (result.rowCount ?? 0) > 0;
  }
  async renew(operationRef: string, claimToken: string, leaseSeconds = 300): Promise<boolean> {
    if (!isCommunityRef(operationRef) || !isCommunityRef(claimToken)) return false;
    count(leaseSeconds, 1, 300);
    const changed = await this.pool.query(`UPDATE community_operations SET lease_until=now()+make_interval(secs=>$4)
      WHERE guild_id=$1 AND ref=$2 AND claim_token=$3 AND status='running' AND lease_until>now() RETURNING ref`,
    [this.guildId, operationRef, claimToken, leaseSeconds]);
    return (changed.rowCount ?? 0) > 0;
  }
  async resolveRecoveredOperation(operationRef: string, result: CommunityJson): Promise<boolean> {
    if (!isCommunityRef(operationRef)) return false;
    const changed = await this.pool.query(`UPDATE community_operations SET status='succeeded',result=$3,error_code=NULL,finished_at=now(),claim_token=NULL,lease_until=NULL
      WHERE guild_id=$1 AND ref=$2 AND status='needs_review' RETURNING ref`, [this.guildId, operationRef, JSON.stringify(json(result))]);
    return (changed.rowCount ?? 0) > 0;
  }
  async addAudit(actor: CommunityActor, action: string, target: string | null, outcome: string): Promise<void> {
    this.actorKey(actor);label(action, 100);label(outcome, 100);if (target !== null) ref(target);
    let actorLabel = actor.source === 'system' ? '系统' : '成员';
    if (actor.memberRef) actorLabel = (await this.resource(actor.memberRef, 'member'))?.name ?? '成员';
    if (actor.source === 'web') {
      const user = (await this.pool.query('SELECT COALESCE(display_name,username) AS name FROM users WHERE id=$1', [actor.userId])).rows[0];
      actorLabel = user?.name ? String(user.name) : actor.userId!;
    }
    actorLabel = actorLabel.replace(/\b\d{17,20}\b/g, '[隐藏]');
    await this.pool.query('INSERT INTO community_audit(guild_id,actor_source,actor_user_id,actor_member_ref,actor_label,action,target_ref,outcome) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [this.guildId, actor.source, actor.userId ?? null, actor.memberRef ?? null, actorLabel, action, target, outcome]);
  }
  async audit(limit = 100): Promise<CommunityAuditView[]> {
    count(limit, 1, 500);
    return (await this.pool.query('SELECT ref,actor_label,action,target_ref,outcome,created_at FROM community_audit WHERE guild_id=$1 ORDER BY created_at DESC,ref DESC LIMIT $2', [this.guildId, limit])).rows.map(row => ({ ref: String(row.ref), actor: String(row.actor_label), action: String(row.action), target: row.target_ref === null ? null : String(row.target_ref), outcome: String(row.outcome), createdAt: iso(row.created_at)! }));
  }
}
