// Frontend data shapes — mirror docs/CONTRACT.md exactly.
// ViolationType, ViolationDef, Tier come from the canonical rules module.
import type { ViolationDef, Tier, ViolationType } from '@shared/scoring';

export type { ViolationType };

/** Full user — only returned for the authenticated caller via /api/me. */
export interface User {
  id: string;
  username: string;
  avatar_url: string | null;
  is_participant: boolean;
  is_judge: boolean;
  is_admin: boolean;
  score: number; // 0..100
  created_at: string;
}

/** Public user — leaderboard, records, profiles. No email. */
export interface PublicUser {
  id: string;
  username: string;
  avatar_url: string | null;
  is_participant: boolean;
  is_judge: boolean;
  score: number;
  created_at: string;
}

/** A subject/reporter reference embedded in a record. */
export interface UserRef {
  id: string;
  username: string;
  avatar_url: string | null;
}

export type RecordStatus = 'active' | 'disputed' | 'revoked';

export interface RecordItem {
  id: number;
  subject: UserRef;
  reporter: UserRef;
  type: ViolationType;
  delta: number; // signed, actually applied
  note: string | null;
  status: RecordStatus;
  created_at: string;
}

export interface HistoryPoint {
  at: string;
  score: number;
}

/** GET /api/config response. */
export interface Config {
  violations: ViolationDef[];
  tiers: Tier[];
  weeklyHeal: number;
  weeklyBonusCap: number;
  nextResetAt: string;
}

// --- Endpoint response envelopes ------------------------------------------

export interface LeaderboardResponse {
  participants: PublicUser[];
}

export interface RecordsResponse {
  records: RecordItem[];
}

export interface MeResponse {
  user: User | null;
}

export interface UserDetailResponse {
  user: PublicUser;
  records: RecordItem[];
  history: HistoryPoint[];
}

export interface RoleUpdate {
  is_participant?: boolean;
  is_judge?: boolean;
}

export interface NewRecordInput {
  subject_id: string;
  type: ViolationType;
  note?: string;
}
