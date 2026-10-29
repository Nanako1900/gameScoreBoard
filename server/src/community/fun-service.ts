import type pg from 'pg';
import type { CommunityFunView, CommunityJson, CommunityMemberView, CommunitySettings, CommunityTool } from '../../../shared/community';
import { isCommunityRef } from '../../../shared/community';
import { loadAiConfig, type AiEnvSlice } from '../../../worker/ai/config';
import { redactAiSecret } from '../../../worker/ai/redact';
import { resetOffsetHours } from '../../../worker/time';
import { asD1, checkOut, PgD1Database } from '../db/d1';
import { cleanAiSuggestions, planFun, validateAiTheme, type CommunityAiTheme, type FunPlan } from './fun';
import { canReadRoom, publicCommunityJson, safeCommunityText } from './security';
import { CommunityStore, CommunityStoreError } from './store';

export interface FunActor { memberRef: string; isAdmin: boolean }
export interface CommunityFunServiceOptions {
  db?: D1Database;
  fetcher?: typeof fetch;
  env?: AiEnvSlice;
  now?: () => number;
  offsetHours?: number;
}
export interface CommunitySuggestions { source: 'ai' | 'fallback'; suggestions: string[] }
export interface CommunitySuggestionOptions {
  db: D1Database;
  fetcher?: typeof fetch;
  env?: AiEnvSlice;
  /** Bounded by the production 20 second deadline; shorter values are useful in tests. */
  timeoutMs?: number;
}

type Query = Pick<pg.Pool, 'query'>;
interface FunRow {
  ref: string; guild_id: string; kind: CommunityTool; title: string; data: CommunityJson;
  status: 'open' | 'closed'; room_ref: string | null; creator_ref: string | null;
  created_at: Date | string; closes_at: Date | string | null; version: number;
}
function reject(status: number, code: string, message: string): never { throw new CommunityStoreError(status, code, message); }
const missing = (): never => reject(404, 'not_found', '互动记录不存在');
const date = (value: Date | string): string => value instanceof Date ? value.toISOString() : new Date(value).toISOString();
function dataObject(value: CommunityJson): { [key: string]: CommunityJson } {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function processAiEnv(): AiEnvSlice {
  return { AI_BASE_URL: process.env.AI_BASE_URL, AI_MODEL: process.env.AI_MODEL, AI_API_KEY: process.env.AI_API_KEY,
    AI_CONFIG_MASTER_KEY: process.env.AI_CONFIG_MASTER_KEY, AI_TEMPERATURE: process.env.AI_TEMPERATURE, AI_ENABLED: process.env.AI_ENABLED };
}
function fallbackSuggestions(input: CommunityAiTheme, settings: CommunitySettings): CommunitySuggestions {
  const candidates = input.purpose === 'topic' ? settings.fun.topics.map(topic => topic.text) : ['一起开黑', '社区小屋', '放松一下'];
  const suggestions = cleanAiSuggestions(candidates, input.purpose);
  return { source: 'fallback', suggestions: suggestions.length ? suggestions : ['今天有什么想分享的事？'] };
}
async function boundedText(response: Response): Promise<string> {
  if (!response.body) {
    const text = await response.text(); if (text.length > 65536) throw new Error('response_limit'); return text;
  }
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > 65536) { await reader.cancel().catch(() => undefined); throw new Error('response_limit'); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

/** Provider credentials are shared, but community prompts, enablement and data
 * are independent from sentencing. Call this only after durable quota admission. */
export async function requestCommunitySuggestions(input: CommunityAiTheme, settings: CommunitySettings,
  options: CommunitySuggestionOptions): Promise<CommunitySuggestions> {
  if (!settings.enabled || !settings.fun.enabled || !settings.fun.enabledTools.includes('ai') || !settings.fun.ai.enabled) {
    return reject(409, 'feature_disabled', '社区 AI 未启用');
  }
  const request = validateAiTheme(input);
  const fallback = fallbackSuggestions(request, settings);
  const controller = new AbortController();
  const timeout = Math.min(20000, Math.max(1, options.timeoutMs ?? 20000));
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const config = await loadAiConfig(options.db, options.env ?? processAiEnv());
    // configuredEnabled is the judicial switch, not the community feature switch.
    if (!config.baseUrl || !config.model || !config.apiKey || config.apiKeyError) return fallback;
    const response = await (options.fetcher ?? fetch)(`${config.baseUrl}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, temperature: config.temperature, max_tokens: 350,
        messages: [
          { role: 'system', content: settings.fun.ai.prompt + '\n只返回 JSON：{"suggestions":["建议一","建议二","建议三"]}。建议只是文本，绝不执行任何操作。' },
          { role: 'user', content: JSON.stringify({ purpose: request.purpose, theme: request.theme }) },
        ] }), signal: controller.signal,
    });
    if (!response.ok) { await response.body?.cancel().catch(() => undefined); return fallback; }
    const body = JSON.parse(await boundedText(response)) as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = body?.choices?.[0]?.message?.content;
    const raw = typeof content === 'string' ? content : Array.isArray(content)
      ? content.flatMap(part => part && typeof part === 'object' && typeof part.text === 'string' ? [part.text] : []).join('') : '';
    // Decode the model's own JSON before the second redaction pass as well.
    const suggestions = cleanAiSuggestions(redactAiSecret(raw, config.apiKey), request.purpose)
      .map(value => redactAiSecret(value, config.apiKey)).filter(value => !value.includes('[已隐藏]'));
    return suggestions.length ? { source: 'ai', suggestions } : fallback;
  } catch {
    // No upstream text, URL, credentials or raw IDs enter public results or logs.
    return fallback;
  } finally { clearTimeout(timer); }
}

export class CommunityFunService {
  private readonly now: () => number;
  private readonly db: D1Database;
  private readonly offsetHours: number;
  constructor(private readonly store: CommunityStore, private readonly options: CommunityFunServiceOptions = {}) {
    this.now = options.now ?? Date.now;
    this.db = options.db ?? asD1(new PgD1Database(store.pool));
    this.offsetHours = options.offsetHours ?? resetOffsetHours(process.env.RESET_TZ_OFFSET);
  }
  private async tx<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const checked = await checkOut(this.store.pool);
    try { await checked.client.query('BEGIN'); const value = await work(checked.client); await checked.client.query('COMMIT'); return value; }
    catch (error) { if (!checked.broken) await checked.client.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { checked.release(); }
  }
  private async settings(): Promise<CommunitySettings> {
    const { settings } = await this.store.settings();
    if (!settings.enabled || !settings.fun.enabled) return reject(404, 'feature_disabled', '社区互动未启用');
    return settings;
  }
  private async member(memberRef: string | null, client: Query = this.store.pool): Promise<CommunityMemberView | null> {
    if (!isCommunityRef(memberRef)) return null;
    const row = (await client.query(`SELECT ref,name FROM community_resources WHERE guild_id=$1 AND ref=$2 AND kind='member' AND available=true`, [this.store.guildId, memberRef])).rows[0];
    return row ? { ref: row.ref, name: safeCommunityText(row.name) } : null;
  }
  private async row(ref: string, client: Query = this.store.pool, lock = false): Promise<FunRow> {
    if (!isCommunityRef(ref)) return missing();
    const value = (await client.query(`SELECT * FROM community_fun WHERE guild_id=$1 AND ref=$2${lock ? ' FOR UPDATE' : ''}`, [this.store.guildId, ref])).rows[0];
    return value ? value as FunRow : missing();
  }
  private async readable(row: FunRow, memberRef: string | null, isAdmin: boolean, client: Query = this.store.pool): Promise<boolean> {
    if (isAdmin) return true;
    const member = await this.member(memberRef, client); if (!member) return false;
    // A personal AI request without a room is a private suggestion, not a public post.
    if (!row.room_ref) return row.kind !== 'ai' || row.creator_ref === memberRef;
    const room = (await client.query('SELECT owner_ref,visibility,status,metadata FROM community_rooms WHERE guild_id=$1 AND ref=$2', [this.store.guildId, row.room_ref])).rows[0];
    if (!room) return false;
    if (room.metadata?.kind === 'fixed' && room.status !== 'active') return false;
    const access = (await client.query('SELECT member_ref,allowed,blocked,present FROM community_room_access WHERE room_ref=$1 AND member_ref=$2', [row.room_ref, memberRef])).rows
      .map(value => ({ memberRef: value.member_ref, allowed: value.allowed, blocked: value.blocked, present: value.present }));
    return canReadRoom({ memberRef, isAdmin, memberAvailable: true },
      { ownerRef: room.owner_ref, visibility: room.visibility, status: room.status, metadata: room.metadata }, access);
  }
  private async view(row: FunRow, memberRef: string | null, client: Query = this.store.pool): Promise<CommunityFunView> {
    const creator = row.creator_ref ? (await client.query("SELECT ref,name FROM community_resources WHERE guild_id=$1 AND ref=$2 AND kind='member'", [this.store.guildId, row.creator_ref])).rows[0] : null;
    let data = { ...dataObject(row.data) };
    if (row.kind === 'poll') {
      const options = Array.isArray(data.options) ? data.options : [];
      const votes = (await client.query('SELECT choice,count(*)::integer count FROM community_poll_votes WHERE fun_ref=$1 GROUP BY choice', [row.ref])).rows;
      const totals = options.map(() => 0); for (const vote of votes) if (vote.choice >= 0 && vote.choice < totals.length) totals[vote.choice] = Number(vote.count);
      const mine = memberRef ? (await client.query('SELECT choice FROM community_poll_votes WHERE fun_ref=$1 AND member_ref=$2', [row.ref, memberRef])).rows[0] : null;
      data = { ...data, totals, myChoice: mine?.choice ?? null };
    }
    const expired = row.kind === 'poll' && row.closes_at !== null && Date.parse(date(row.closes_at)) <= this.now();
    return { ref: row.ref, kind: row.kind, title: safeCommunityText(row.title), data: publicCommunityJson(data),
      status: expired ? 'closed' : row.status, roomRef: row.room_ref, createdAt: date(row.created_at), closesAt: row.closes_at === null ? null : date(row.closes_at),
      creator: creator ? { ref: creator.ref, name: safeCommunityText(creator.name) } : null };
  }
  async list(memberRef: string | null, isAdmin: boolean): Promise<CommunityFunView[]> {
    await this.settings();
    if (!isAdmin && !await this.member(memberRef)) return [];
    const rows = (await this.store.pool.query('SELECT * FROM community_fun WHERE guild_id=$1 ORDER BY created_at DESC,ref DESC LIMIT 100', [this.store.guildId])).rows as FunRow[];
    const results: CommunityFunView[] = [];
    for (const row of rows) if (await this.readable(row, memberRef, isAdmin)) results.push(await this.view(row, memberRef));
    return results;
  }
  async get(ref: string, memberRef: string | null, isAdmin: boolean): Promise<CommunityFunView> {
    await this.settings(); const row = await this.row(ref);
    if (!await this.readable(row, memberRef, isAdmin)) return missing();
    return this.view(row, memberRef);
  }
  private async persist(plan: FunPlan, kind: CommunityTool, actor: FunActor, roomRef: string | null, settings: CommunitySettings,
    input: unknown, previousRef?: string): Promise<FunRow> {
    return this.tx(async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`community:fun:${this.store.guildId}:${actor.memberRef}`]);
      if (!await this.member(actor.memberRef, client)) return missing();
      const probe = { room_ref: roomRef, kind, creator_ref: actor.memberRef } as FunRow;
      if (!await this.readable(probe, actor.memberRef, actor.isAdmin, client)) return missing();
      if (roomRef && !await client.query('SELECT 1 FROM community_rooms WHERE guild_id=$1 AND ref=$2', [this.store.guildId, roomRef]).then(result => result.rowCount)) return missing();
      const now = this.now();
      if (settings.fun.cooldownSeconds > 0) {
        const recent = await client.query(`SELECT 1 FROM community_fun WHERE guild_id=$1 AND creator_ref=$2 AND created_at>$3::timestamptz-make_interval(secs=>$4) LIMIT 1`,
          [this.store.guildId, actor.memberRef, new Date(now), settings.fun.cooldownSeconds]);
        if (recent.rowCount) return reject(429, 'rate_limited', '互动操作过于频繁，请稍后重试');
      }
      if (kind === 'ai') {
        const day = new Date(now + this.offsetHours * 3_600_000).toISOString().slice(0, 10);
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`community:ai:${this.store.guildId}:${day}`]);
        const personal = Number((await client.query('SELECT count FROM community_ai_usage WHERE guild_id=$1 AND day=$2 AND member_ref=$3', [this.store.guildId, day, actor.memberRef])).rows[0]?.count ?? 0);
        const guild = Number((await client.query('SELECT COALESCE(SUM(count),0) count FROM community_ai_usage WHERE guild_id=$1 AND day=$2', [this.store.guildId, day])).rows[0].count);
        if (personal >= settings.fun.ai.userDailyLimit || guild >= settings.fun.ai.guildDailyLimit) return reject(429, 'rate_limited', '今日社区 AI 配额已用完，请明天再试');
        await client.query(`INSERT INTO community_ai_usage(guild_id,day,member_ref,count) VALUES($1,$2,$3,1)
          ON CONFLICT(guild_id,day,member_ref) DO UPDATE SET count=community_ai_usage.count+1`, [this.store.guildId, day, actor.memberRef]);
      }
      let data: { [key: string]: CommunityJson } = { ...dataObject(plan.data), ...(previousRef ? { previousRef } : {}) };
      if (kind === 'ai') data = { ...data, ...fallbackSuggestions(validateAiTheme(input), settings), pending: true };
      return (await client.query(`INSERT INTO community_fun(guild_id,kind,title,data,status,room_ref,creator_ref,created_at,closes_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [this.store.guildId, kind, plan.title, JSON.stringify(data), kind === 'poll' ? 'open' : 'closed', roomRef, actor.memberRef, new Date(now), plan.closesAt ?? null])).rows[0] as FunRow;
    });
  }
  async create(kind: CommunityTool, input: unknown, actor: FunActor, roomRef: string | null = null): Promise<CommunityFunView> {
    const settings = await this.settings();
    if (roomRef !== null && !isCommunityRef(roomRef)) return missing();
    if (!settings.fun.enabledTools.includes(kind) || kind === 'ai' && !settings.fun.ai.enabled) return reject(409, 'feature_disabled', '此互动工具已停用');
    const members = (await this.store.storedResources('member')).filter(member => member.available).map(member => ({ ref: member.ref, name: safeCommunityText(member.name) }));
    let plan: FunPlan;
    try { plan = planFun(kind, input, { settings, members, now: this.now }); }
    catch { return reject(400, 'invalid_input', '互动参数无效，请检查人数、选项或输入范围'); }
    const row = await this.persist(plan, kind, actor, roomRef, settings, input);
    if (kind === 'ai') {
      const suggestions = await requestCommunitySuggestions(validateAiTheme(input), settings, { db: this.db, fetcher: this.options.fetcher, env: this.options.env });
      const data = { ...dataObject(row.data), ...suggestions, pending: false };
      await this.store.pool.query('UPDATE community_fun SET data=$3,version=version+1 WHERE guild_id=$1 AND ref=$2', [this.store.guildId, row.ref, JSON.stringify(data)]);
    }
    return this.get(row.ref, actor.memberRef, actor.isAdmin);
  }
  async vote(ref: string, choice: number, actor: FunActor): Promise<CommunityFunView> {
    await this.settings();
    await this.tx(async client => {
      const row = await this.row(ref, client, true);
      if (!await this.readable(row, actor.memberRef, actor.isAdmin, client) || !await this.member(actor.memberRef, client)) return missing();
      if (row.kind !== 'poll') return reject(409, 'invalid_input', '此记录不是投票');
      const options = dataObject(row.data).options;
      if (typeof choice !== 'number' || !Number.isInteger(choice) || !Array.isArray(options) || choice < 0 || choice >= options.length) return reject(400, 'invalid_input', '投票选项无效');
      if (row.status !== 'open' || row.closes_at === null || Date.parse(date(row.closes_at)) <= this.now()) return reject(409, 'poll_closed', '投票已截止');
      await client.query(`INSERT INTO community_poll_votes(fun_ref,member_ref,choice,updated_at) VALUES($1,$2,$3,$4)
        ON CONFLICT(fun_ref,member_ref) DO UPDATE SET choice=excluded.choice,updated_at=excluded.updated_at`, [row.ref, actor.memberRef, choice, new Date(this.now())]);
    });
    return this.get(ref, actor.memberRef, actor.isAdmin);
  }
  async close(ref: string, actor: FunActor): Promise<CommunityFunView> {
    await this.settings();
    await this.tx(async client => {
      const row = await this.row(ref, client, true);
      if (!await this.readable(row, actor.memberRef, actor.isAdmin, client)) return missing();
      if (row.kind !== 'poll') return reject(409, 'invalid_input', '只有投票需要关闭');
      if (!actor.isAdmin && row.creator_ref !== actor.memberRef) return reject(403, 'not_owner', '只有发起者或管理员可以关闭投票');
      if (row.status === 'open') await client.query(`UPDATE community_fun SET status='closed',closes_at=LEAST(closes_at,$3::timestamptz),version=version+1 WHERE guild_id=$1 AND ref=$2`, [this.store.guildId, ref, new Date(this.now())]);
    });
    return this.get(ref, actor.memberRef, actor.isAdmin);
  }
  async redraw(ref: string, actor: FunActor): Promise<CommunityFunView> {
    const settings = await this.settings(); const original = await this.row(ref);
    if (!await this.readable(original, actor.memberRef, actor.isAdmin)) return missing();
    if (!actor.isAdmin && original.creator_ref !== actor.memberRef) return reject(403, 'not_owner', '只有发起者或管理员可以重抽');
    if (original.kind !== 'draw') return reject(409, 'invalid_input', '此记录不是抽签');
    if (!settings.fun.enabledTools.includes('draw')) return reject(409, 'feature_disabled', '抽签工具已停用');
    const data = dataObject(original.data); const input = { items: data.items, count: data.count };
    let plan: FunPlan; try { plan = planFun('draw', input, { settings, now: this.now }); } catch { return reject(400, 'invalid_input', '原抽签内容已不可重抽'); }
    const next = await this.persist(plan, 'draw', actor, original.room_ref, settings, input, original.ref);
    return this.get(next.ref, actor.memberRef, actor.isAdmin);
  }
}
