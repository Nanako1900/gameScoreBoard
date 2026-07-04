// Typed same-origin fetch client for every /api and /auth endpoint.
// Throws ApiError (with the parsed { error } message) on any non-2xx response.
import type {
  Config,
  LeaderboardResponse,
  MeResponse,
  NewRecordInput,
  RecordItem,
  RecordsResponse,
  RoleUpdate,
  User,
  UserDetailResponse,
} from './types';

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
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
  const res = await fetch(path, {
    credentials: 'same-origin',
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
  status?: 'active' | 'disputed' | 'revoked';
}

export function getRecords(query: RecordsQuery = {}): Promise<RecordsResponse> {
  const params = new URLSearchParams();
  if (query.limit !== undefined) {
    params.set('limit', String(query.limit));
  }
  if (query.subject !== undefined) {
    params.set('subject', query.subject);
  }
  if (query.status !== undefined) {
    params.set('status', query.status);
  }
  const qs = params.toString();
  return request<RecordsResponse>(`/api/records${qs ? `?${qs}` : ''}`);
}

export function getUserDetail(id: string): Promise<UserDetailResponse> {
  return request<UserDetailResponse>(`/api/users/${encodeURIComponent(id)}`);
}

// --- Authenticated ---------------------------------------------------------

export function getMe(): Promise<MeResponse> {
  return request<MeResponse>('/api/me');
}

export function updateRoles(roles: RoleUpdate): Promise<{ user: User }> {
  return request<{ user: User }>('/api/me/roles', {
    method: 'POST',
    body: JSON.stringify(roles),
  });
}

export function createRecord(input: NewRecordInput): Promise<{ record: RecordItem }> {
  return request<{ record: RecordItem }>('/api/records', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function disputeRecord(id: number): Promise<{ record: RecordItem }> {
  return request<{ record: RecordItem }>(`/api/records/${id}/dispute`, {
    method: 'POST',
  });
}

export function revokeRecord(id: number): Promise<{ record: RecordItem }> {
  return request<{ record: RecordItem }>(`/api/records/${id}/revoke`, {
    method: 'POST',
  });
}

// --- Auth ------------------------------------------------------------------

export function logout(): Promise<{ ok: true }> {
  return request<{ ok: true }>('/auth/logout', { method: 'POST' });
}
