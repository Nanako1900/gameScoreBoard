// ============================================================================
// EDG 信誉分 — 规则单一真源 (canonical rules)
// Pure module: NO Cloudflare / DOM / Node globals. Imported by BOTH the Worker
// (worker/*) and the React frontend (src/*). Do not add side-effectful imports.
// ============================================================================

export const BASE_SCORE = 100;
export const MIN_SCORE = 0;
export const MAX_SCORE = 100;

/** Points recovered for each participant every week (Monday, local tz). */
export const WEEKLY_HEAL = 15;

/** Max total positive (守约/组局) points a player can gain per week. */
export const WEEKLY_BONUS_CAP = 6;

/** Hours a subject has to file a statement before the case is judged in absentia. */
export const STATEMENT_WINDOW_HOURS = 12;

/** Absolute floor for a single case's penalty — the last guard after clamping. */
export const MAX_SINGLE_PENALTY = 30;

/** Hard timeout for one AI judging call. */
export const AI_TIMEOUT_MS = 20_000;

/** Max characters accepted (and forwarded to the AI) for claim / statement text. */
export const MAX_NARRATIVE_LEN = 1000;

/** Min characters a judge must write when filing a penalty case. */
export const MIN_CLAIM_LEN = 10;

export type ViolationType =
  | 'late_minor'
  | 'late_major'
  | 'late_severe'
  | 'reschedule'
  | 'no_show'
  | 'no_show_group'
  | 'mid_quit'
  | 'afk'
  | 'other'
  | 'on_time_bonus'
  | 'organizer_bonus';

export type ViolationKind = 'penalty' | 'bonus';

export interface ViolationDef {
  type: ViolationType;
  label: string; // 中文名
  emoji: string;
  desc: string;
  kind: ViolationKind;
  /** Anchor sentence. Used verbatim when the AI is unavailable or misbehaves. */
  base: number;
  /** Harshest the AI may go (most negative for penalties). */
  min: number;
  /** Most lenient the AI may go (closest to 0 for penalties). */
  max: number;
}

export const VIOLATIONS: ViolationDef[] = [
  { type: 'late_minor', label: '小迟到', emoji: '⏰', desc: '迟到 < 15 分钟', kind: 'penalty', base: -3, min: -5, max: -1 },
  { type: 'late_major', label: '大迟到', emoji: '⏰', desc: '迟到 15–30 分钟', kind: 'penalty', base: -6, min: -9, max: -3 },
  { type: 'late_severe', label: '严重迟到', emoji: '⏰', desc: '迟到 > 30 分钟', kind: 'penalty', base: -10, min: -14, max: -5 },
  { type: 'reschedule', label: '临时改约', emoji: '🔄', desc: '提前但临时改时间 / 时长', kind: 'penalty', base: -5, min: -8, max: -1 },
  { type: 'no_show', label: '放鸽子', emoji: '🕊️', desc: '答应了没来，也没提前说', kind: 'penalty', base: -15, min: -20, max: -8 },
  { type: 'no_show_group', label: '团灭级放鸽', emoji: '💥', desc: '多人局因你临阵脱逃而解散', kind: 'penalty', base: -25, min: -30, max: -15 },
  { type: 'mid_quit', label: '中途开溜', emoji: '🚪', desc: '打一半跑了', kind: 'penalty', base: -12, min: -16, max: -6 },
  { type: 'afk', label: '摆烂挂机', emoji: '😴', desc: '人在心不在（娱乐向）', kind: 'penalty', base: -8, min: -12, max: -3 },
  { type: 'other', label: '其他', emoji: '📝', desc: '上面都不沾边的情况，由 AI 酌情裁量', kind: 'penalty', base: -5, min: -10, max: 0 },
  { type: 'on_time_bonus', label: '守约守时', emoji: '✅', desc: '准时履约', kind: 'bonus', base: 2, min: 2, max: 2 },
  { type: 'organizer_bonus', label: '组局召集', emoji: '📣', desc: '组织了一场局', kind: 'bonus', base: 2, min: 2, max: 2 },
];

export const VIOLATION_MAP: Record<string, ViolationDef> = Object.fromEntries(
  VIOLATIONS.map((v) => [v.type, v]),
);

export function isValidViolationType(t: string): t is ViolationType {
  return t in VIOLATION_MAP;
}

export function clampScore(n: number): number {
  return Math.max(MIN_SCORE, Math.min(MAX_SCORE, Math.round(n)));
}

/**
 * Final guard on a judged delta — the decisive defence against a prompt-injected
 * or malfunctioning AI. Applied server-side to EVERY verdict, no exceptions:
 *   1. must be a finite integer (else fall back to `base`);
 *   2. clamped into the violation's own [min, max] sentencing range;
 *   3. clamped by the absolute per-case cap;
 *   4. a penalty can never come out positive.
 * The worst a successful injection can achieve is the most lenient value in range.
 */
export function clampVerdictDelta(def: ViolationDef, raw: number): number {
  if (!Number.isFinite(raw)) return def.base;
  let delta = Math.round(raw);
  delta = Math.max(def.min, Math.min(def.max, delta));
  delta = Math.max(-MAX_SINGLE_PENALTY, Math.min(MAX_SINGLE_PENALTY, delta));
  if (def.kind === 'penalty' && delta > 0) delta = 0;
  if (def.kind === 'bonus' && delta < 0) delta = 0;
  return delta;
}

/** True when the AI produced something outside the allowed range (worth auditing). */
export function isClamped(def: ViolationDef, raw: number): boolean {
  return !Number.isFinite(raw) || clampVerdictDelta(def, raw) !== Math.round(raw);
}

/** Penalties go through the statement → AI verdict flow; bonuses settle instantly. */
export function needsTrial(def: ViolationDef): boolean {
  return def.kind === 'penalty';
}

// --- Case lifecycle -----------------------------------------------------------

/**
 * awaiting_statement → subject may file a statement; no score change yet.
 * judging            → claimed for AI judging (guards against double-judging).
 * decided            → delta applied, verdict visible.
 * appealed           → subject contests a decided case; score unchanged, awaits admin.
 * revoked            → delta reversed.
 * withdrawn          → reporter pulled the case before any score moved.
 */
export type CaseStatus =
  | 'awaiting_statement'
  | 'judging'
  | 'decided'
  | 'appealed'
  | 'revoked'
  | 'withdrawn';

export const CASE_STATUSES: CaseStatus[] = [
  'awaiting_statement',
  'judging',
  'decided',
  'appealed',
  'revoked',
  'withdrawn',
];

export function isCaseStatus(v: string): v is CaseStatus {
  return (CASE_STATUSES as string[]).includes(v);
}

/** Where a verdict's delta came from. */
export type VerdictSource = 'ai' | 'fallback' | 'manual' | 'admin_override';

export const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  awaiting_statement: '待陈述',
  judging: '裁决中',
  decided: '',
  appealed: '申诉中',
  revoked: '已撤销',
  withdrawn: '已撤案',
};

/** A case's delta is reflected in the subject's score only in these states. */
export function affectsScore(status: CaseStatus): boolean {
  return status === 'decided' || status === 'appealed';
}

// --- Credit tiers (信誉段位) --------------------------------------------------

export interface Tier {
  min: number;
  name: string;
  emoji: string;
  color: string; // hex, used across UI
  blurb: string;
}

export const TIERS: Tier[] = [
  { min: 95, name: '誓约之光', emoji: '🏆', color: '#f5c542', blurb: '完全信赖，优先组局' },
  { min: 85, name: '守时楷模', emoji: '💎', color: '#4aa3ff', blurb: '靠谱' },
  { min: 70, name: '基本靠谱', emoji: '✅', color: '#3ddc84', blurb: '正常' },
  { min: 55, name: '需要盯一下', emoji: '⚠️', color: '#f0b429', blurb: '组局前先确认一遍' },
  { min: 40, name: '鸽王预备役', emoji: '🚧', color: '#f9703e', blurb: '谨慎组局' },
  { min: 0, name: '资深鸽王', emoji: '🕊️', color: '#e5484d', blurb: '建议收押金 / AA 先付' },
];

export function tierFor(score: number): Tier {
  return TIERS.find((t) => score >= t.min) ?? TIERS[TIERS.length - 1];
}
