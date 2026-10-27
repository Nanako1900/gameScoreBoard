// Typed same-origin fetch client for every /api and /auth endpoint.
// Throws ApiError (with the parsed { error } message) on any non-2xx response.
import type {
  AiConfigPatch,
  AiConfigResponse,
  AiTestResponse,
  CaseStatus,
  Config,
  FileCasesResponse,
  LeaderboardResponse,
  MeResponse,
  NewCaseInput,
  RecordItem,
  RecordsResponse,
  RoleUpdate,
  User,
  UserDetailResponse,
  ViolationType,
  WeeklyReport,
} from './types';

import type { VoiceDayResponse, VoiceHistoryResponse } from '@shared/voiceApi';

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * API base URL. Empty = same-origin — used when the Worker serves the SPA, or
 * when EdgeOne edge-functions reverse-proxy /api and /auth (Option A). Set
 * VITE_API_BASE to the Worker origin for a direct cross-origin split (Option B/C).
 */
const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

/** URL that starts OAuth login. A top-level navigation (not a fetch). */
export const AUTH_LOGIN_URL = `${API_BASE}/auth/login`;

/**
 * Route external (e.g. Nanako) avatar URLs through the same-origin Worker proxy
 * so they aren't blocked by the upstream's Cross-Origin-Resource-Policy. Relative
 * paths and data: URLs pass through untouched.
 */
export function avatarSrc(url: string | null): string | null {
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) return url;
  return `${API_BASE}/api/avatar?u=${encodeURIComponent(url)}`;
}

interface ErrorBody {
  error: string;
}

function isErrorBody(value: unknown): value is ErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as { error: unknown }).error === 'string'
  );
}

async function parseJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text.length === 0) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(`响应解析失败 (HTTP ${res.status})`, res.status);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    // 'include' is required for cross-origin cookies and is a harmless superset
    // of 'same-origin' when the API is same-origin (unified Worker / EdgeOne proxy).
    credentials: 'include',
    headers:
      init?.body !== undefined
        ? { 'Content-Type': 'application/json', Accept: 'application/json' }
        : { Accept: 'application/json' },
    ...init,
  });

  const body = await parseJson(res);

  if (!res.ok) {
    const message = isErrorBody(body) ? body.error : `请求失败 (HTTP ${res.status})`;
    throw new ApiError(message, res.status);
  }

  return body as T;
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

// --- Public reads ----------------------------------------------------------

export function getConfig(): Promise<Config> {
  return request<Config>('/api/config');
}

export function getLeaderboard(): Promise<LeaderboardResponse> {
  return request<LeaderboardResponse>('/api/leaderboard');
}

export interface RecordsQuery {
  limit?: number;
  subject?: string;
  status?: CaseStatus;
  mine?: 'pending';
}

export function getRecords(query: RecordsQuery = {}): Promise<RecordsResponse> {
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.subject !== undefined) params.set('subject', query.subject);
  if (query.status !== undefined) params.set('status', query.status);
  if (query.mine !== undefined) params.set('mine', query.mine);
  const qs = params.toString();
  return request<RecordsResponse>(`/api/records${qs ? `?${qs}` : ''}`);
}

export function getRecord(id: number): Promise<{ record: RecordItem }> {
  return request<{ record: RecordItem }>(`/api/records/${id}`);
}

export function getUserDetail(id: string): Promise<UserDetailResponse> {
  return request<UserDetailResponse>(`/api/users/${encodeURIComponent(id)}`);
}

// --- Authenticated ---------------------------------------------------------

export function getMe(): Promise<MeResponse> {
  return request<MeResponse>('/api/me');
}

export function updateRoles(roles: RoleUpdate): Promise<{ user: User }> {
  return post<{ user: User }>('/api/me/roles', roles);
}

/** Set the caller's display name; pass null to use the OAuth (Nanako) name. */
export function updateDisplayName(display_name: string | null): Promise<{ user: User }> {
  return post<{ user: User }>('/api/me/display-name', { display_name });
}

// --- Cases -----------------------------------------------------------------

/**
 * File one case per named player from a single narrative. The AI reads the facts
 * and picks each violation type — there is no type to choose in the UI.
 * Partial failures come back in `failed` rather than losing the whole batch.
 */
export function createCases(input: NewCaseInput): Promise<FileCasesResponse> {
  return post<FileCasesResponse>('/api/records', input);
}

/** Judge co-signs the group-wipe charge the AI only hinted at. */
export function confirmEscalation(id: number): Promise<{ record: RecordItem }> {
  return post<{ record: RecordItem }>(`/api/records/${id}/escalate`);
}

export function dismissEscalation(id: number): Promise<{ record: RecordItem }> {
  return post<{ record: RecordItem }>(`/api/records/${id}/escalate/dismiss`);
}

/** Judge overrides the AI's category, pre-verdict only. */
export function reclassifyCase(
  id: number,
  type: ViolationType,
): Promise<{ record: RecordItem }> {
  return post<{ record: RecordItem }>(`/api/records/${id}/reclassify`, { type });
}

/** Submit the subject's one statement. Resolves once the verdict is in. */
export function submitStatement(
  id: number,
  statement: string,
): Promise<{ record: RecordItem }> {
  return post<{ record: RecordItem }>(`/api/records/${id}/statement`, { statement });
}

export function withdrawCase(id: number): Promise<{ record: RecordItem }> {
  return post<{ record: RecordItem }>(`/api/records/${id}/withdraw`);
}

export function appealCase(id: number, reason?: string): Promise<{ record: RecordItem }> {
  return post<{ record: RecordItem }>(`/api/records/${id}/appeal`, { reason });
}

export function revokeRecord(id: number): Promise<{ record: RecordItem }> {
  return post<{ record: RecordItem }>(`/api/records/${id}/revoke`);
}

// --- Weekly report ---------------------------------------------------------

export function getLatestReport(): Promise<{ report: WeeklyReport | null }> {
  return request<{ report: WeeklyReport | null }>('/api/report/latest');
}

export function regenerateReport(week: string): Promise<{ report: WeeklyReport }> {
  return post<{ report: WeeklyReport }>(`/api/admin/report/${week}/regenerate`);
}

// --- Admin -----------------------------------------------------------------

export function overrideCase(
  id: number,
  delta: number,
  reason: string,
): Promise<{ record: RecordItem }> {
  return post<{ record: RecordItem }>(`/api/admin/records/${id}/override`, { delta, reason });
}

/**
 * Admin: appoint or dismiss a judge. Since P6 this is the only way to become
 * one — the self-service role switch refuses is_judge for non-judges.
 */
export function setJudge(userId: string, isJudge: boolean): Promise<{ ok: boolean }> {
  return post<{ ok: boolean }>(`/api/admin/users/${encodeURIComponent(userId)}`, { is_judge: isJudge });
}

/** Admin: set a player's score by hand (they get a DM if bound). */
export function setScore(userId: string, score: number): Promise<{ ok: boolean }> {
  return post<{ ok: boolean }>(`/api/admin/users/${encodeURIComponent(userId)}`, { score });
}

export function getAiConfig(): Promise<AiConfigResponse> {
  return request<AiConfigResponse>('/api/admin/ai-config');
}

export function updateAiConfig(
  patch: AiConfigPatch,
): Promise<{ ok: true; enabled: boolean; prompt_version: string }> {
  return post<{ ok: true; enabled: boolean; prompt_version: string }>(
    '/api/admin/ai-config',
    patch,
  );
}

export function testAiConfig(input: {
  claim?: string;
  statement?: string;
}): Promise<AiTestResponse> {
  return post<AiTestResponse>('/api/admin/ai-config/test', input);
}

// --- Auth ------------------------------------------------------------------

export function logout(): Promise<{ ok: true }> {
  return post<{ ok: true }>('/auth/logout');
}

// --- Discord binding (Node backend only) -----------------------------------

/** What the SPA may know about the caller's own binding — never the Discord id. */
export interface DiscordLinkInfo {
  discord_username: string;
  linked_at: string;
  /** DMs on or off (the bot's /notify, or setDiscordNotify). Absent from an API older than P2-5. */
  notify_dm?: boolean;
  /** false once Discord refused a DM (DMs closed); turning DMs on or off clears it. */
  dm_ok?: boolean;
}

/**
 * URL that starts binding. A top-level navigation (not a fetch): the API sends
 * the browser through Discord's consent page and back to `/?linked=discord`.
 */
export const DISCORD_LINK_URL = `${API_BASE}/link/discord`;

/**
 * The caller's Discord binding, or null when unbound. Resolves `undefined` when
 * the backend has no Discord support at all — the old Worker answers 404 here —
 * so the UI can hide itself instead of offering a button that leads nowhere.
 */
export async function getDiscordLink(): Promise<DiscordLinkInfo | null | undefined> {
  try {
    const { link } = await request<{ link: DiscordLinkInfo | null }>('/api/me/discord');
    // `undefined` is reserved for "unsupported"; an answer always means bound or not.
    return link ?? null;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return undefined;
    throw err;
  }
}

/** Remove the caller's binding. The response body carries nothing the UI needs. */
export async function unlinkDiscord(): Promise<void> {
  await post<unknown>('/api/me/discord/unlink');
}

/**
 * Turn the caller's Discord DMs on or off; resolves the binding as it now
 * stands. `undefined` on 404 — a backend without the switch, like
 * getDiscordLink — so the UI can hide it. Not bound is 409, thrown as usual.
 */
export async function setDiscordNotify(on: boolean): Promise<DiscordLinkInfo | undefined> {
  try {
    const { link } = await post<{ link: DiscordLinkInfo }>('/api/me/discord/notify', { on });
    return link;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return undefined;
    throw err;
  }
}

/** Queue another private welcome guide; the server limits manual retries. */
export async function resendWelcome(): Promise<{ ok: true }> {
  return post<{ ok: true }>('/api/me/discord/welcome');
}


// --- Private voice evidence -----------------------------------------------

export function getVoiceDay(date?: string): Promise<VoiceDayResponse> {
  const params = new URLSearchParams();
  if (date !== undefined) params.set('date', date);
  const search = params.toString();
  return request<VoiceDayResponse>(`/api/voice/day${search ? `?${search}` : ''}`);
}

export function getVoiceHistory(userId: string, from?: string, to?: string): Promise<VoiceHistoryResponse> {
  const params = new URLSearchParams({ user: userId });
  if (from !== undefined) params.set('from', from);
  if (to !== undefined) params.set('to', to);
  return request<VoiceHistoryResponse>(`/api/voice?${params.toString()}`);
}
