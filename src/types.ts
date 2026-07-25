// Frontend data shapes — mirror docs/CONTRACT.md exactly.
// ViolationType, ViolationDef, Tier come from the canonical rules module.
import type {
  CaseStatus,
  Tier,
  VerdictSource,
  ViolationDef,
  ViolationType,
} from '@shared/scoring';
import type { Attendance, Rsvp, SessionStatus } from '@shared/attendance';

export type { ViolationType, CaseStatus, VerdictSource, Attendance, Rsvp, SessionStatus };

/** Full user — only returned for the authenticated caller via /api/me. */
export interface User {
  id: string;
  username: string; // effective display name (custom, else the OAuth/Nanako name)
  oauth_username: string; // raw OAuth (Nanako) username
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

/** A subject/reporter/organizer reference embedded in a record or session. */
export interface UserRef {
  id: string;
  username: string;
  avatar_url: string | null;
}

export interface VerdictFactor {
  kind: 'mitigating' | 'aggravating';
  text: string;
}

export interface Verdict {
  source: VerdictSource;
  headline: string;
  reasoning: string;
  factors: VerdictFactor[];
}

export interface SentencingRange {
  min: number;
  max: number;
  base: number;
}

export interface RecordItem {
  id: number;
  subject: UserRef;
  reporter: UserRef;
  type: ViolationType;
  delta: number; // signed, actually applied (0 until decided)
  note: string | null;
  claim: string | null;
  session_id: number | null;
  statement: string | null;
  statement_at: string | null;
  appeal_reason: string | null;
  deadline_at: string | null;
  status: CaseStatus;
  verdict: Verdict | null;
  range: SentencingRange;
  created_at: string;
}

export interface HistoryPoint {
  at: string;
  score: number;
}

// --- Sessions ---------------------------------------------------------------

export interface SessionPlayer {
  user: UserRef;
  rsvp: Rsvp;
  rsvp_at: string;
  attendance: Attendance | null;
  late_minutes: number | null;
  attendance_note: string | null;
  record_id: number | null;
  is_participant: boolean;
}

export interface SessionItem {
  id: number;
  organizer: UserRef;
  title: string;
  game: string | null;
  starts_at: string;
  duration_min: number | null;
  capacity: number | null;
  note: string | null;
  status: SessionStatus;
  settled_at: string | null;
  created_at: string;
  counts: { going: number; maybe: number; out: number };
  my_rsvp: Rsvp | null;
}

export interface SessionDetail extends SessionItem {
  players: SessionPlayer[];
}

export interface CaseDraft {
  user_id: string;
  username: string;
  type: ViolationType;
  kind: 'penalty' | 'bonus';
  range: SentencingRange;
  suggested_claim: string;
  already_filed: boolean;
}

/** GET /api/config response. */
export interface Config {
  violations: ViolationDef[];
  tiers: Tier[];
  weeklyHeal: number;
  weeklyBonusCap: number;
  statementWindowHours: number;
  aiEnabled: boolean;
  nextResetAt: string;
}

// --- Endpoint response envelopes ------------------------------------------

export interface LeaderboardResponse {
  participants: PublicUser[];
}

export interface RecordsResponse {
  records: RecordItem[];
}

export interface PendingCounts {
  statements: number;
  appeals: number;
}

export interface MeResponse {
  user: User | null;
  pending: PendingCounts;
}

export interface UserDetailResponse {
  user: PublicUser;
  records: RecordItem[];
  history: HistoryPoint[];
}

export interface SessionsResponse {
  sessions: SessionItem[];
}

export interface SessionDetailResponse {
  session: SessionDetail;
  records: RecordItem[];
}

export interface RollCallResponse {
  session: SessionDetail;
  drafts: CaseDraft[];
}

export interface SettleResponse {
  session: SessionDetail;
  created: number;
  skipped: number;
}

export interface RoleUpdate {
  is_participant?: boolean;
  is_judge?: boolean;
}

export interface NewCaseInput {
  subject_id: string;
  type: ViolationType;
  claim?: string;
  note?: string;
}

export interface NewSessionInput {
  title: string;
  game?: string;
  starts_at: string;
  duration_min?: number;
  capacity?: number;
  note?: string;
}

export interface RollCallEntry {
  user_id: string;
  attendance: Attendance;
  late_minutes?: number;
  note?: string;
}

export interface SettleEntry {
  user_id: string;
  type?: ViolationType;
  claim?: string;
}

// --- Admin AI config --------------------------------------------------------

export interface AiConfigResponse {
  enabled: boolean;
  base_url: string;
  model: string;
  temperature: number;
  prompt: string;
  prompt_version: string;
  has_api_key: boolean;
  disabled_reason: string | null;
  recent: {
    total: number;
    fallbackRate: number;
    clampRate: number;
    avgLatencyMs: number;
  };
}

export interface AiConfigPatch {
  enabled?: boolean;
  base_url?: string;
  model?: string;
  temperature?: number;
  prompt?: string;
}

export interface AiTestResponse {
  ok: boolean;
  source: 'ai' | 'fallback';
  verdict: {
    delta: number;
    headline: string;
    reasoning: string;
    factors: VerdictFactor[];
  };
  error: string | null;
  clamped: boolean;
  parsed_delta: number | null;
  latency_ms: number;
  raw: string | null;
}
