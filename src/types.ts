// Frontend data shapes — mirror docs/CONTRACT.md exactly.
// ViolationType, ViolationDef, Tier come from the canonical rules module.
import type {
  CaseStatus,
  Tier,
  VerdictSource,
  ViolationDef,
  ViolationType,
} from '@shared/scoring';

export type { ViolationType, CaseStatus, VerdictSource };

/** Where a case's violation type came from. `derived` = roll-call, no AI. */
export type ClassifiedBy = 'ai' | 'fallback' | 'human' | 'derived';

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

/** A subject/reporter reference embedded in a record. */
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
  /** null only when `pending_hidden`. */
  type: ViolationType | null;
  delta: number; // signed, actually applied (0 until decided)
  note: string | null;
  claim: string | null;
  /** AI's one-line condensation of `claim` — the feed headline. */
  claim_summary: string | null;
  classified_by: ClassifiedBy;
  /** AI pointed at the -25 charge; the filing judge must co-sign it. */
  escalation_suggested: boolean;
  session_id: number | null;
  statement: string | null;
  statement_at: string | null;
  appeal_reason: string | null;
  deadline_at: string | null;
  status: CaseStatus;
  verdict: Verdict | null;
  /** null only when `pending_hidden`. */
  range: SentencingRange | null;
  created_at: string;
  /**
   * The statement, the appeal reason and the verdict's words are only for the
   * subject, the reporter, judges and admins: for anyone else the API blanks
   * them and sets this. (Absent from an older API: nothing was hidden.)
   */
  redacted?: boolean;
  /**
   * B1-1: before the verdict, for anyone but the subject, the reporter, judges
   * and admins, the API also hides the type, the claim, its summary, the note
   * and the range (`type` and `range` are then null) — only that a case is in
   * progress. statement_at stays. (Absent from an older API.)
   */
  pending_hidden?: boolean;
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
  statementWindowHours: number;
  aiEnabled: boolean;
  maxBatchSubjects: number;
  nextResetAt: string;
  /** Board time zone (RESET_TZ_OFFSET), hours. Absent from an older API: fall back to the browser's zone and say 本地时间. */
  boardTzOffsetHours?: number;
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

export interface RoleUpdate {
  is_participant?: boolean;
  is_judge?: boolean;
}

/** v3 default: the judge names people and writes facts; the AI picks the type. */
export interface NewCaseInput {
  subject_ids: string[];
  claim: string;
  /** Per-subject addendum, keyed by user id. */
  extras?: Record<string, string>;
  note?: string;
}

export interface BatchFailure {
  subject_id: string;
  error: string;
}

export interface FileCasesResponse {
  records: RecordItem[];
  failed: BatchFailure[];
}

// --- Admin AI config --------------------------------------------------------

export interface AiConfigResponse {
  enabled: boolean;
  base_url: string;
  model: string;
  temperature: number;
  prompt: string;
  classify_prompt: string;
  report_prompt: string;
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
  classify_prompt?: string;
  report_prompt?: string;
}

// --- Weekly report ----------------------------------------------------------

export interface ReportStats {
  basis?: 'verdict';
  weekStart: string;
  weekEnd: string;
  casesFiled: number;
  totalPenalty: number;
  absentVerdicts: number;
  star: { name: string; delta: number } | null;
  pigeon: { name: string; delta: number } | null;
  bestTalker: { name: string; savedBy: number } | null;
  harshest: { name: string; delta: number } | null;
}

/** Optional figures from reports stored before S1; new reports omit them. */
export interface StoredReportStats extends ReportStats {
  sessionsPlayed?: number;
  sessionsCollapsed?: number;
  attendanceRate?: number | null;
  upcomingNextWeek?: number;
  topOrganizer?: { name: string; count: number } | null;
}

export interface WeeklyReport {
  week_start: string;
  stats: StoredReportStats;
  narrative: string;
  source: 'ai' | 'fallback';
  created_at: string;
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
