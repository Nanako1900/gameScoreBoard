// Frontend data shapes — mirror docs/CONTRACT.md exactly.
// ViolationType, ViolationDef, Tier come from the canonical rules module.
import type {
  CaseStatus,
  Tier,
  VerdictSource,
  ViolationDef,
  ViolationType,
} from '@shared/scoring';
import type { Attendance, Rsvp, SelfRsvp, SessionStatus } from '@shared/attendance';

export type { ViolationType, CaseStatus, VerdictSource, Attendance, Rsvp, SessionStatus };

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

// --- Invitable people (P2-2) -------------------------------------------------

/** One row of GET /api/me/invitable: names and avatars only — never a score, never Discord. */
export interface InvitableUser {
  id: string;
  username: string;
  avatar_url: string | null;
  is_participant: boolean;
  /** When the caller last really played with them (ISO starts_at); null if never. */
  last_played_with_me_at: string | null;
}

export interface InvitableResponse {
  users: InvitableUser[];
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
  counts: { invited: number; going: number; maybe: number; out: number };
  my_rsvp: Rsvp | null;
  /** P2-6: up to 5 who said 来, earliest answer first — names and avatars, never a score. Absent from an older API: show no avatars. */
  going_preview?: UserRef[];
  /** P2-3: the organizer's cancel reason (plain text). Absent from an older API: no reason. */
  cancel_reason?: string | null;
  /** P2-3: when it was cancelled (sqlite datetime shape). */
  cancelled_at?: string | null;
}

export interface SessionDetail extends SessionItem {
  players: SessionPlayer[];
}

// P2-3
export type AttendanceSummary = Record<Attendance, number>;

/** One row of GET /api/sessions?scope=history. */
export interface HistorySessionItem extends SessionItem {
  attendance_summary: AttendanceSummary;
}

export type InviteReason = 'new' | 'moved';

/** One row of GET /api/me/invites. Missing fields (an older API) read as a new invitation. */
export interface InvitedSessionItem extends SessionItem {
  invite_reason?: InviteReason;
  prev_rsvp?: SelfRsvp | null;
  prev_starts_at?: string | null;
}

export interface InvitesResponse {
  sessions: InvitedSessionItem[];
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

/** POST /api/sessions/:id/invite (P2-1). */
export interface InviteResponse {
  session: SessionDetail;
  /** People this request actually invited. */
  added: number;
  /** The other ids asked for: already in it, or unknown. */
  skipped: number;
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

/** v3: only `starts_at` is required; the title is synthesised server-side. */
export interface NewSessionInput {
  starts_at: string;
  invite?: string[];
  title?: string;
  game?: string;
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
  sessionsPlayed: number;
  sessionsCollapsed: number;
  casesFiled: number;
  totalPenalty: number;
  absentVerdicts: number;
  attendanceRate: number | null;
  upcomingNextWeek: number;
  star: { name: string; delta: number } | null;
  pigeon: { name: string; delta: number } | null;
  bestTalker: { name: string; savedBy: number } | null;
  harshest: { name: string; delta: number } | null;
  topOrganizer: { name: string; count: number } | null;
}

export interface WeeklyReport {
  week_start: string;
  stats: ReportStats;
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
