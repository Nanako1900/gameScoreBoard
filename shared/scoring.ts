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

export type ViolationType =
  | 'late_minor'
  | 'late_major'
  | 'late_severe'
  | 'reschedule'
  | 'no_show'
  | 'no_show_group'
  | 'mid_quit'
  | 'afk'
  | 'on_time_bonus'
  | 'organizer_bonus';

export type ViolationKind = 'penalty' | 'bonus';

export interface ViolationDef {
  type: ViolationType;
  label: string; // 中文名
  emoji: string;
  delta: number; // signed points
  desc: string;
  kind: ViolationKind;
}

export const VIOLATIONS: ViolationDef[] = [
  { type: 'late_minor', label: '小迟到', emoji: '⏰', delta: -3, desc: '迟到 < 15 分钟', kind: 'penalty' },
  { type: 'late_major', label: '大迟到', emoji: '⏰', delta: -6, desc: '迟到 15–30 分钟', kind: 'penalty' },
  { type: 'late_severe', label: '严重迟到', emoji: '⏰', delta: -10, desc: '迟到 > 30 分钟', kind: 'penalty' },
  { type: 'reschedule', label: '临时改约', emoji: '🔄', delta: -5, desc: '提前但临时改时间 / 时长', kind: 'penalty' },
  { type: 'no_show', label: '放鸽子', emoji: '🕊️', delta: -15, desc: '答应了没来，也没提前说', kind: 'penalty' },
  { type: 'no_show_group', label: '团灭级放鸽', emoji: '💥', delta: -25, desc: '多人局因你临阵脱逃而解散', kind: 'penalty' },
  { type: 'mid_quit', label: '中途开溜', emoji: '🚪', delta: -12, desc: '打一半跑了', kind: 'penalty' },
  { type: 'afk', label: '摆烂挂机', emoji: '😴', delta: -8, desc: '人在心不在（娱乐向）', kind: 'penalty' },
  { type: 'on_time_bonus', label: '守约守时', emoji: '✅', delta: 2, desc: '准时履约', kind: 'bonus' },
  { type: 'organizer_bonus', label: '组局召集', emoji: '📣', delta: 2, desc: '组织了一场局', kind: 'bonus' },
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
