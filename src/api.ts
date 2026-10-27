// Typed same-origin fetch client for every /api and /auth endpoint.
// Throws ApiError (with the parsed { error } message) on any non-2xx response.
import { emitSession } from './lib/sessionEvents';
import type {
  AiConfigPatch,
  AiConfigResponse,
  AiTestResponse,
  CaseStatus,
  Config,
  FileCasesResponse,
  HistorySessionItem,
  InvitableResponse,
  InvitableUser,
  InviteResponse,
  InvitesResponse,
  LeaderboardResponse,
  MeResponse,
  NewCaseInput,
  NewSessionInput,
  RecordItem,
  RecordsResponse,
  RoleUpdate,
  RollCallEntry,
  RollCallResponse,
  SessionDetail,
  SessionDetailResponse,
  SessionItem,
  SessionsResponse,
  SettleEntry,
  SettleResponse,
  User,
  UserDetailResponse,
  ViolationType,
  WeeklyReport,
} from './types';
import type { SelfRsvp } from '@shared/attendance';

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
  session?: number;
  mine?: 'pending';
}

export function getRecords(query: RecordsQuery = {}): Promise<RecordsResponse> {
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.subject !== undefined) params.set('subject', query.subject);
  if (query.status !== undefined) params.set('status', query.status);
  if (query.session !== undefined) params.set('session', String(query.session));
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

// --- Sessions --------------------------------------------------------------

export function getSessions(
  scope: 'upcoming' | 'past' | 'mine' = 'upcoming',
): Promise<SessionsResponse> {
  return request<SessionsResponse>(`/api/sessions?scope=${scope}`);
}

export function getSession(id: number): Promise<SessionDetailResponse> {
  return request<SessionDetailResponse>(`/api/sessions/${id}`);
}

export function createSession(input: NewSessionInput): Promise<{ session: SessionDetail }> {
  return post<{ session: SessionDetail }>('/api/sessions', input);
}

export async function updateSession(
  id: number,
  patch: Partial<NewSessionInput>,
): Promise<{ session: SessionDetail }> {
  const res = await request<{ session: SessionDetail }>(`/api/sessions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  emitSession(res.session);
  return res;
}

/** `reason` omitted: no body at all, exactly as before P2-3. */
export async function cancelSession(id: number, reason?: string): Promise<{ session: SessionDetail }> {
  const path = `/api/sessions/${id}/cancel`;
  const res = await (reason === undefined
    ? post<{ session: SessionDetail }>(path)
    : post<{ session: SessionDetail }>(path, { reason }));
  emitSession(res.session);
  return res;
}

/** `startsAt`: the start time the player is looking at — a move since is a 409. */
export async function setRsvp(
  id: number,
  rsvp: SelfRsvp,
  startsAt: string,
): Promise<{ session: SessionDetail }> {
  const res = await post<{ session: SessionDetail }>(`/api/sessions/${id}/rsvp`, { rsvp, starts_at: startsAt });
  emitSession(res.session);
  return res;
}

/** Record attendance. Produces drafts; changes nobody's score. */
export function rollCall(id: number, entries: RollCallEntry[]): Promise<RollCallResponse> {
  return post<RollCallResponse>(`/api/sessions/${id}/rollcall`, { entries });
}

/** Close the session. `file` may be empty — that settles it with zero impact. */
export function settleSession(
  id: number,
  file: SettleEntry[],
  skipAll = false,
): Promise<SettleResponse> {
  return post<SettleResponse>(`/api/sessions/${id}/settle`, { file, skip_all: skipAll });
}

/** Sessions the caller was invited to and has not answered. Drives the banner. */
export function getMyInvites(): Promise<InvitesResponse> {
  return request<InvitesResponse>('/api/me/invites');
}

type MaybeHistoryItem = SessionItem & { attendance_summary?: HistorySessionItem['attendance_summary'] };

function isHistoryItem(item: MaybeHistoryItem): item is HistorySessionItem {
  return typeof item.attendance_summary === 'object' && item.attendance_summary !== null;
}

/**
 * P2-3: sessions that started, cancelled ones too, newest first; `before` = the
 * last id of the previous page (fewer than a full page = no more). undefined
 * from an API without scope=history: it reads an unknown scope as 'upcoming'
 * and answers 200, so the sign is items without attendance_summary.
 */
export async function getSessionHistory(before?: number): Promise<HistorySessionItem[] | undefined> {
  const cursor = before === undefined ? '' : `&before=${before}`;
  const { sessions } = await request<{ sessions: MaybeHistoryItem[] }>(`/api/sessions?scope=history${cursor}`);
  return sessions.every(isHistoryItem) ? sessions : undefined;
}

/**
 * Everyone the caller could invite (P2-2). Resolves `undefined` when the API
 * has no such endpoint — an older backend answers 404 — so the invite entry
 * can hide itself, like getDiscordLink. Any other failure throws ApiError.
 */
export async function getInvitable(): Promise<InvitableUser[] | undefined> {
  try {
    const { users } = await request<InvitableResponse>('/api/me/invitable');
    return users;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return undefined;
    throw err;
  }
}

/** P2-1: invite more people after creation. Organizer or admin; rows already there are never changed. */
export async function inviteToSession(id: number, userIds: string[]): Promise<InviteResponse> {
  const res = await post<InviteResponse>(`/api/sessions/${id}/invite`, { user_ids: userIds });
  emitSession(res.session);
  return res;
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
