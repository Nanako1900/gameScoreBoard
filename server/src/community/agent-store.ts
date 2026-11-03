import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { parseAgentDocumentInput, parseAgentSettings, safeAgentText,
  type AgentAdminData, type AgentDocument, type AgentDocumentInput, type AgentErrorCode, type AgentRequestStatus,
  type AgentRequestView, type AgentSettings } from '../../../shared/community-agent';
import { isCommunityRef } from '../../../shared/community';
import { resetOffsetHours } from '../../../worker/time';
import { checkOut } from '../db/d1';
import { CommunityStoreError } from './store';

type Query = Pick<pg.PoolClient, 'query'>;
type Row = Record<string, unknown>;
export interface AgentSnapshot { settings: AgentSettings; version: number; knowledgeVersion: number }
export interface AgentClaimKey { ref: string; claimToken: string }
export interface AgentClaim extends AgentClaimKey {
  discordUserId: string; channelId: string; messageId: string; userId: string; bindingId: string;
  settingsVersion: number; knowledgeVersion: number; settings: AgentSettings; documents: AgentDocument[];
}
export type AgentReserveResult = { kind: 'accepted'; request: { ref: string } } |
  { kind: 'unbound' | 'disabled' | 'rate_limited' | 'busy' | 'ignored' | 'duplicate' };
export type AgentDeliveryResult<T> = { kind: 'delivered'; value: T } | { kind: 'canceled' | 'failed' | 'isolated' };
export interface AgentFinish {
  status: 'succeeded' | 'failed' | 'canceled' | 'isolated'; errorCode?: AgentErrorCode;
  model?: string; promptVersion?: string; latencyMs?: number;
}
/** A known rejection can be recorded without treating it as an unknown POST.
 * Native errors are always uncertain; their messages are never persisted. */
export class AgentDeliveryError extends Error {
  constructor(readonly uncertain: boolean, readonly code: AgentErrorCode = 'delivery_failed') {
    super('Agent delivery failed'); this.name = 'AgentDeliveryError';
  }
}
const LEASE_MS = 90_000;
const RETENTION_MS = 30 * 86_400_000;
const MAX_QUEUED = 20;
const EXTERNAL_ID = /^\d{17,20}$/;
const ERROR_CODES: readonly AgentErrorCode[] = ['provider_unavailable', 'provider_failed', 'no_sources', 'authorization_changed',
  'configuration_changed', 'knowledge_changed', 'lease_expired', 'delivery_failed', 'delivery_unknown', 'interrupted'];
function fail(status: number, code: string, message: string): never { throw new CommunityStoreError(status, code, message); }
function integer(input: number): void {
  if (!Number.isSafeInteger(input) || input < 0) fail(400, 'invalid_input', '缺少有效的内容版本');
}
function iso(input: unknown): string { return new Date(input instanceof Date ? input : String(input)).toISOString(); }
function document(row: Row): AgentDocument {
  return { ref: String(row.ref), title: safeAgentText(String(row.title)), content: safeAgentText(String(row.content)),
    published: row.published === true, version: Number(row.version), updatedAt: iso(row.updated_at) };
}
function errorCode(input: unknown): AgentErrorCode | null { return ERROR_CODES.includes(input as AgentErrorCode) ? input as AgentErrorCode : null; }

/** PostgreSQL-only, independent of room operations. Every request stores
 * metadata only; its question and generated answer live in the bot's memory. */
export class CommunityAgentStore {
  private readonly now: () => number;
  private readonly offsetHours: number;
  constructor(readonly pool: pg.Pool, readonly guildId: string, options: { now?: () => number; offsetHours?: number } = {}) {
    this.now = options.now ?? Date.now;
    this.offsetHours = options.offsetHours ?? resetOffsetHours(process.env.RESET_TZ_OFFSET);
  }
  private async tx<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const checked = await checkOut(this.pool);
    try {
      await checked.client.query('BEGIN');
      const result = await work(checked.client);
      await checked.client.query('COMMIT');
      return result;
    } catch (error) {
      if (!checked.broken) await checked.client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { checked.release(); }
  }
  private time(): string { return new Date(this.now()).toISOString(); }
  private day(timestamp = this.now()): string { return new Date(timestamp + this.offsetHours * 3_600_000).toISOString().slice(0, 10); }
  private async settingsRow(client: Query, lock: 'share' | 'update' | null = null): Promise<Row> {
    await client.query('INSERT INTO community_agent_settings(guild_id) VALUES($1) ON CONFLICT(guild_id) DO NOTHING', [this.guildId]);
    return (await client.query(`SELECT * FROM community_agent_settings WHERE guild_id=$1${lock ? ` FOR ${lock.toUpperCase()}` : ''}`, [this.guildId])).rows[0] as Row;
  }
  private snapshot(row: Row): AgentSnapshot {
    return { settings: parseAgentSettings(row.settings), version: Number(row.version), knowledgeVersion: Number(row.knowledge_version) };
  }
  async settings(): Promise<AgentSnapshot> { return this.snapshot(await this.settingsRow(this.pool)); }
  private async requireAdmin(client: Query, actorId: string): Promise<Row> {
    const row = (await client.query('SELECT id,is_admin,COALESCE(display_name,username) AS name FROM users WHERE id=$1 FOR SHARE', [actorId])).rows[0];
    if (!row || Number(row.is_admin) !== 1) return fail(403, 'forbidden', '需要管理员权限');
    return row as Row;
  }
  private async audit(client: Query, actor: Row, action: string, target: string | null): Promise<void> {
    await client.query(`INSERT INTO community_audit(guild_id,actor_source,actor_user_id,actor_label,action,target_ref,outcome)
      VALUES($1,'web',$2,$3,$4,$5,'succeeded')`, [this.guildId, actor.id, safeAgentText(String(actor.name ?? '管理员')), action, target]);
  }
  async saveSettings(input: AgentSettings, expectedVersion: number, actorId: string): Promise<AgentSnapshot> {
    integer(expectedVersion);
    const settings = parseAgentSettings(input);
    return this.tx(async client => {
      const current = await this.settingsRow(client, 'update');
      const actor = await this.requireAdmin(client, actorId);
      if (Number(current.version) !== expectedVersion) return fail(409, 'version_conflict', '问答设置已变化，请刷新后重试');
      if (settings.channelRefs.length) {
        const resources = await client.query(`SELECT ref FROM community_resources WHERE guild_id=$1 AND kind='text'
          AND available=true AND ref=ANY($2::uuid[]) FOR SHARE`, [this.guildId, settings.channelRefs]);
        if (resources.rowCount !== settings.channelRefs.length) return fail(400, 'invalid_resource', '所选文字频道已不可用');
      }
      const updated = (await client.query(`UPDATE community_agent_settings SET settings=$2,version=version+1,updated_by=$3,updated_at=$4
        WHERE guild_id=$1 RETURNING *`, [this.guildId, JSON.stringify(settings), actorId, this.time()])).rows[0] as Row;
      await this.audit(client, actor, 'agent.settings', null);
      return this.snapshot(updated);
    });
  }
  async documents(): Promise<AgentDocument[]> { return this.readDocuments(this.pool, false); }
  async publishedDocuments(): Promise<AgentDocument[]> { return this.readDocuments(this.pool, true); }
  private async readDocuments(client: Query, published: boolean): Promise<AgentDocument[]> {
    return (await client.query(`SELECT * FROM community_agent_documents WHERE guild_id=$1 AND deleted_at IS NULL
      ${published ? 'AND published=true' : ''} ORDER BY updated_at DESC,ref LIMIT 50`, [this.guildId])).rows.map(row => document(row as Row));
  }
  async saveDocument(input: AgentDocumentInput, actorId: string): Promise<AgentDocument> {
    const value = parseAgentDocumentInput(input);
    return this.tx(async client => {
      await this.settingsRow(client, 'update');
      const actor = await this.requireAdmin(client, actorId);
      const existing = value.ref ? (await client.query('SELECT * FROM community_agent_documents WHERE ref=$1 FOR UPDATE', [value.ref])).rows[0] as Row | undefined : undefined;
      if (existing) {
        if (existing.guild_id !== this.guildId || existing.deleted_at !== null) return fail(409, 'version_conflict', '资料已变化，请刷新后重试');
        // A stable client-generated reference makes a retried creation harmless
        // after a lost HTTP response, without treating later edits as a retry.
        if (value.expectedVersion === 0 && Number(existing.version) === 1 && existing.created_by === actorId &&
            existing.title === value.title && existing.content === value.content && existing.published === value.published) return document(existing);
        if (Number(existing.version) !== value.expectedVersion) return fail(409, 'version_conflict', '资料已变化，请刷新后重试');
      } else {
        if (value.expectedVersion !== 0) return fail(409, 'version_conflict', '资料已变化，请刷新后重试');
        const count = Number((await client.query('SELECT count(*)::int AS total FROM community_agent_documents WHERE guild_id=$1 AND deleted_at IS NULL', [this.guildId])).rows[0].total);
        if (count >= 50) return fail(409, 'document_limit', '最多保存 50 篇资料，请先删除不再使用的资料');
      }
      const row = existing ? (await client.query(`UPDATE community_agent_documents SET title=$3,content=$4,published=$5,
        version=version+1,updated_by=$6,updated_at=$7 WHERE guild_id=$1 AND ref=$2 RETURNING *`,
      [this.guildId, existing.ref, value.title, value.content, value.published, actorId, this.time()])).rows[0] :
        (await client.query(`INSERT INTO community_agent_documents(ref,guild_id,title,content,published,created_by,updated_by,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$6,$7) ON CONFLICT(ref) DO NOTHING RETURNING *`, [value.ref ?? randomUUID(), this.guildId, value.title, value.content, value.published, actorId, this.time()])).rows[0];
      if (!row) return fail(409, 'version_conflict', '资料已变化，请刷新后重试');
      await client.query('UPDATE community_agent_settings SET knowledge_version=knowledge_version+1 WHERE guild_id=$1', [this.guildId]);
      await this.audit(client, actor, 'agent.document.save', String(row.ref));
      return document(row as Row);
    });
  }
  async deleteDocument(documentRef: string, expectedVersion: number, actorId: string): Promise<void> {
    if (!isCommunityRef(documentRef)) return fail(400, 'invalid_input', '资料引用无效');
    integer(expectedVersion);
    await this.tx(async client => {
      await this.settingsRow(client, 'update');
      const actor = await this.requireAdmin(client, actorId);
      const updated = await client.query(`UPDATE community_agent_documents SET deleted_at=$4,published=false,version=version+1,updated_by=$5,updated_at=$4
        WHERE guild_id=$1 AND ref=$2 AND version=$3 AND deleted_at IS NULL`, [this.guildId, documentRef, expectedVersion, this.time(), actorId]);
      if (!updated.rowCount) return fail(409, 'version_conflict', '资料已变化，请刷新后重试');
      await client.query('UPDATE community_agent_settings SET knowledge_version=knowledge_version+1 WHERE guild_id=$1', [this.guildId]);
      await this.audit(client, actor, 'agent.document.delete', documentRef);
    });
  }
  private async channelAllowed(client: Query, snapshot: AgentSnapshot, channelId: string, lock = false): Promise<boolean> {
    if (!snapshot.settings.enabled || !EXTERNAL_ID.test(channelId) || !snapshot.settings.channelRefs.length) return false;
    return !!(await client.query(`SELECT ref FROM community_resources WHERE guild_id=$1 AND kind='text' AND external_id=$2
      AND available=true AND ref=ANY($3::uuid[])${lock ? ' FOR SHARE' : ''}`, [this.guildId, channelId, snapshot.settings.channelRefs])).rowCount;
  }
  async allowsChannel(channelId: string): Promise<boolean> { return this.channelAllowed(this.pool, await this.settings(), channelId); }
  async recoverExpired(): Promise<void> {
    const time = this.time(), cutoff = new Date(this.now() - RETENTION_MS).toISOString();
    await this.pool.query(`UPDATE community_agent_requests SET status=CASE WHEN status='sending' THEN 'isolated' ELSE 'canceled' END,
      error_code=CASE WHEN status='sending' THEN 'delivery_unknown' ELSE 'lease_expired' END,finished_at=$2
      WHERE guild_id=$1 AND status IN ('queued','running','sending') AND lease_until<=$2`, [this.guildId, time]);
    await this.pool.query('DELETE FROM community_agent_requests WHERE guild_id=$1 AND created_at<$2', [this.guildId, cutoff]);
    await this.pool.query('DELETE FROM community_agent_usage WHERE guild_id=$1 AND last_requested_at<$2', [this.guildId, cutoff]);
  }
  async reserve(input: { discordUserId: string; channelId: string; messageId: string }): Promise<AgentReserveResult> {
    if (![input.discordUserId, input.channelId, input.messageId].every(value => EXTERNAL_ID.test(value))) return { kind: 'ignored' };
    await this.recoverExpired();
    return this.tx(async client => {
      const snapshot = this.snapshot(await this.settingsRow(client, 'update'));
      if (!snapshot.settings.enabled) return { kind: 'disabled' };
      if (!await this.channelAllowed(client, snapshot, input.channelId, true)) return { kind: 'ignored' };
      const duplicate = await client.query('SELECT 1 FROM community_agent_requests WHERE guild_id=$1 AND source_message_id=$2', [this.guildId, input.messageId]);
      if (duplicate.rowCount) return { kind: 'duplicate' };
      const link = (await client.query(`SELECT l.user_id,l.binding_id FROM discord_links l JOIN users u ON u.id=l.user_id
        WHERE l.discord_user_id=$1 FOR UPDATE OF l FOR SHARE OF u`, [input.discordUserId])).rows[0];
      const member = (await client.query(`SELECT ref FROM community_resources WHERE guild_id=$1 AND kind='member' AND external_id=$2
        AND available=true AND COALESCE(metadata->>'bot','false')<>'true' FOR SHARE`, [this.guildId, input.discordUserId])).rows[0];
      if (!link || !member) return { kind: 'unbound' };
      const pending = Number((await client.query("SELECT count(*)::int AS total FROM community_agent_requests WHERE guild_id=$1 AND status IN ('queued','running','sending')", [this.guildId])).rows[0].total);
      if (pending >= MAX_QUEUED) return { kind: 'busy' };
      const day = this.day(), now = this.now();
      const usage = (await client.query('SELECT count,last_requested_at FROM community_agent_usage WHERE guild_id=$1 AND day=$2 AND user_id=$3', [this.guildId, day, link.user_id])).rows[0];
      const total = Number((await client.query('SELECT COALESCE(sum(count),0)::int AS total FROM community_agent_usage WHERE guild_id=$1 AND day=$2', [this.guildId, day])).rows[0].total);
      const last = (await client.query('SELECT max(last_requested_at) AS last FROM community_agent_usage WHERE guild_id=$1 AND user_id=$2', [this.guildId, link.user_id])).rows[0].last;
      if (Number(usage?.count ?? 0) >= snapshot.settings.userDailyLimit || total >= snapshot.settings.guildDailyLimit ||
          last && now - +new Date(last) < snapshot.settings.cooldownSeconds * 1000) return { kind: 'rate_limited' };
      const request = (await client.query(`INSERT INTO community_agent_requests(guild_id,source_message_id,discord_user_id,channel_id,user_id,binding_id,
        settings_version,knowledge_version,lease_until,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ref`,
      [this.guildId, input.messageId, input.discordUserId, input.channelId, link.user_id, link.binding_id, snapshot.version, snapshot.knowledgeVersion,
        new Date(now + LEASE_MS).toISOString(), this.time()])).rows[0];
      await client.query(`INSERT INTO community_agent_usage(guild_id,day,user_id,count,last_requested_at) VALUES($1,$2,$3,1,$4)
        ON CONFLICT(guild_id,day,user_id) DO UPDATE SET count=community_agent_usage.count+1,last_requested_at=excluded.last_requested_at`, [this.guildId, day, link.user_id, this.time()]);
      return { kind: 'accepted', request: { ref: String(request.ref) } };
    });
  }
  private async guarded(client: Query, key: { ref: string; claimToken?: string }, queued = false): Promise<{ row: Row; snapshot: AgentSnapshot } | null> {
    if (!isCommunityRef(key.ref) || key.claimToken !== undefined && !isCommunityRef(key.claimToken)) return null;
    const snapshot = this.snapshot(await this.settingsRow(client, 'share'));
    const request = (await client.query('SELECT * FROM community_agent_requests WHERE guild_id=$1 AND ref=$2', [this.guildId, key.ref])).rows[0] as Row | undefined;
    if (!request) return null;
    const link = (await client.query(`SELECT l.user_id,l.binding_id FROM discord_links l JOIN users u ON u.id=l.user_id
      WHERE l.discord_user_id=$1 FOR UPDATE OF l FOR SHARE OF u`, [request.discord_user_id])).rows[0];
    const row = (await client.query('SELECT * FROM community_agent_requests WHERE guild_id=$1 AND ref=$2 FOR UPDATE', [this.guildId, key.ref])).rows[0] as Row;
    const active = queued ? row.status === 'queued' : row.status === 'running' && row.claim_token === key.claimToken;
    if (!active) return null;
    let reason: AgentErrorCode | null = null;
    if (+new Date(String(row.lease_until)) <= this.now()) reason = 'lease_expired';
    else if (!link || link.user_id !== row.user_id || link.binding_id !== row.binding_id) reason = 'authorization_changed';
    else if (!snapshot.settings.enabled || snapshot.version !== Number(row.settings_version)) reason = 'configuration_changed';
    else if (snapshot.knowledgeVersion !== Number(row.knowledge_version)) reason = 'knowledge_changed';
    else if (!await this.channelAllowed(client, snapshot, String(row.channel_id), true)) reason = 'authorization_changed';
    else {
      const member = await client.query(`SELECT ref FROM community_resources WHERE guild_id=$1 AND kind='member' AND external_id=$2
        AND available=true AND COALESCE(metadata->>'bot','false')<>'true' FOR SHARE`, [this.guildId, row.discord_user_id]);
      if (!member.rowCount) reason = 'authorization_changed';
    }
    if (reason) {
      await client.query("UPDATE community_agent_requests SET status='canceled',error_code=$3,finished_at=$4 WHERE guild_id=$1 AND ref=$2", [this.guildId, key.ref, reason, this.time()]);
      return null;
    }
    return { row, snapshot };
  }
  async claim(requestRef: string): Promise<AgentClaim | null> {
    return this.tx(async client => {
      const guarded = await this.guarded(client, { ref: requestRef }, true);
      if (!guarded) return null;
      const claimToken = randomUUID();
      await client.query("UPDATE community_agent_requests SET status='running',claim_token=$3,lease_until=$4 WHERE guild_id=$1 AND ref=$2",
        [this.guildId, requestRef, claimToken, new Date(this.now() + LEASE_MS).toISOString()]);
      const { row, snapshot } = guarded;
      return { ref: requestRef, claimToken, discordUserId: String(row.discord_user_id), channelId: String(row.channel_id), messageId: String(row.source_message_id),
        userId: String(row.user_id), bindingId: String(row.binding_id), settingsVersion: snapshot.version, knowledgeVersion: snapshot.knowledgeVersion,
        settings: snapshot.settings, documents: await this.readDocuments(client, true) };
    });
  }
  async check(claim: AgentClaimKey): Promise<boolean> { return this.tx(async client => !!await this.guarded(client, claim)); }
  async withDeliveryGuard<T>(claim: AgentClaimKey, work: (beforeWrite: () => Promise<void>) => Promise<T>): Promise<AgentDeliveryResult<T>> {
    try {
      return await this.tx(async client => {
        if (!await this.guarded(client, claim)) return { kind: 'canceled' };
        await client.query("UPDATE community_agent_requests SET status='sending' WHERE guild_id=$1 AND ref=$2", [this.guildId, claim.ref]);
        try {
          const value = await work(async () => {
            const current = (await client.query('SELECT lease_until,status,claim_token FROM community_agent_requests WHERE guild_id=$1 AND ref=$2', [this.guildId, claim.ref])).rows[0];
            if (!current || current.status !== 'sending' || current.claim_token !== claim.claimToken || +new Date(current.lease_until) <= this.now())
              throw new AgentDeliveryError(false, 'lease_expired');
          });
          await client.query("UPDATE community_agent_requests SET status='running' WHERE guild_id=$1 AND ref=$2", [this.guildId, claim.ref]);
          return { kind: 'delivered', value };
        } catch (error) {
          const uncertain = !(error instanceof AgentDeliveryError) || error.uncertain;
          const code = uncertain ? 'delivery_unknown' : error.code;
          const status = uncertain ? 'isolated' : ['authorization_changed', 'configuration_changed', 'knowledge_changed', 'lease_expired', 'interrupted'].includes(code) ? 'canceled' : 'failed';
          await client.query('UPDATE community_agent_requests SET status=$3,error_code=$4,finished_at=$5 WHERE guild_id=$1 AND ref=$2', [this.guildId, claim.ref, status, code, this.time()]);
          return { kind: status };
        }
      });
    } catch {
      // A COMMIT or connection failure after Discord accepted a POST must not
      // lead to a retry. Persist isolation if the database is still reachable.
      await this.finish(claim.ref, claim.claimToken, { status: 'isolated', errorCode: 'delivery_unknown' }).catch(() => undefined);
      return { kind: 'isolated' };
    }
  }
  async withChannelGuard<T>(channelId: string, work: (beforeWrite: () => Promise<void>) => Promise<T>): Promise<AgentDeliveryResult<T>> {
    try {
      return await this.tx(async client => {
        const snapshot = this.snapshot(await this.settingsRow(client, 'share'));
        if (!await this.channelAllowed(client, snapshot, channelId, true)) return { kind: 'canceled' };
        try { return { kind: 'delivered', value: await work(async () => {
          if (!await this.channelAllowed(client, snapshot, channelId, true)) throw new AgentDeliveryError(false, 'authorization_changed');
        }) }; }
        catch (error) { return { kind: error instanceof AgentDeliveryError && !error.uncertain ? 'failed' : 'isolated' }; }
      });
    } catch { return { kind: 'isolated' }; }
  }
  async finish(requestRef: string, claimToken: string, input: AgentFinish): Promise<void> {
    if (!isCommunityRef(requestRef) || !isCommunityRef(claimToken)) return;
    const status = input.status;
    if (!['succeeded', 'failed', 'canceled', 'isolated'].includes(status)) return;
    const latency = input.latencyMs !== undefined && Number.isSafeInteger(input.latencyMs) && input.latencyMs >= 0 ? Math.min(input.latencyMs, 2_147_483_647) : null;
    await this.pool.query(`UPDATE community_agent_requests SET status=$4,error_code=$5,finished_at=$6,model=$7,prompt_version=$8,latency_ms=$9
      WHERE guild_id=$1 AND ref=$2 AND claim_token=$3 AND status IN ('running','sending')`,
    [this.guildId, requestRef, claimToken, status, errorCode(input.errorCode), this.time(), input.model ? safeAgentText(input.model).slice(0, 100) : null,
      input.promptVersion ? safeAgentText(input.promptVersion).slice(0, 100) : null, latency]);
  }
  async diagnostics(): Promise<Omit<AgentAdminData, 'provider'>> {
    await this.recoverExpired();
    return this.tx(async client => {
      const snapshot = this.snapshot(await this.settingsRow(client, 'share'));
      const day = this.day();
      const usage = Number((await client.query('SELECT COALESCE(sum(count),0)::int AS total FROM community_agent_usage WHERE guild_id=$1 AND day=$2', [this.guildId, day])).rows[0].total);
      const requests: AgentRequestView[] = (await client.query(`SELECT status,created_at,finished_at,error_code FROM community_agent_requests
        WHERE guild_id=$1 ORDER BY created_at DESC,ref DESC LIMIT 20`, [this.guildId])).rows.map(row => ({ status: row.status as AgentRequestStatus,
        createdAt: iso(row.created_at), finishedAt: row.finished_at === null ? null : iso(row.finished_at), errorCode: errorCode(row.error_code) }));
      return { ...snapshot, documents: await this.readDocuments(client, false), usage: { day, total: usage }, requests };
    });
  }
}
