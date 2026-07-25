import { describe, expect, it } from 'vitest';
import {
  CASE_STATUSES,
  MAX_SINGLE_PENALTY,
  VIOLATIONS,
  VIOLATION_MAP,
  affectsScore,
  clampScore,
  clampVerdictDelta,
  isCaseStatus,
  isClamped,
  isValidViolationType,
  needsTrial,
  tierFor,
} from '../../shared/scoring';

describe('violation catalogue', () => {
  it('keeps every base sentence inside its own range', () => {
    for (const v of VIOLATIONS) {
      expect(v.min, `${v.type}.min <= base`).toBeLessThanOrEqual(v.base);
      expect(v.base, `${v.type}.base <= max`).toBeLessThanOrEqual(v.max);
    }
  });

  it('gives penalties negative bases and bonuses positive ones', () => {
    for (const v of VIOLATIONS) {
      if (v.kind === 'penalty') expect(v.base).toBeLessThan(0);
      else expect(v.base).toBeGreaterThan(0);
    }
  });

  it('never allows a single case to exceed the absolute cap', () => {
    for (const v of VIOLATIONS) {
      expect(Math.abs(v.min)).toBeLessThanOrEqual(MAX_SINGLE_PENALTY);
      expect(Math.abs(v.max)).toBeLessThanOrEqual(MAX_SINGLE_PENALTY);
    }
  });

  it('routes only penalties through the trial flow', () => {
    expect(needsTrial(VIOLATION_MAP.no_show)).toBe(true);
    expect(needsTrial(VIOLATION_MAP.on_time_bonus)).toBe(false);
  });

  it('validates violation types', () => {
    expect(isValidViolationType('no_show')).toBe(true);
    expect(isValidViolationType('nope')).toBe(false);
  });
});

// The single most security-relevant function in the codebase: it is the layer
// that survives a fully successful prompt injection.
describe('clampVerdictDelta', () => {
  const noShow = VIOLATION_MAP.no_show; // base -15, range [-20, -8]

  it('passes through an in-range sentence untouched', () => {
    expect(clampVerdictDelta(noShow, -12)).toBe(-12);
    expect(isClamped(noShow, -12)).toBe(false);
  });

  it('clamps a too-harsh sentence up to the range floor', () => {
    expect(clampVerdictDelta(noShow, -999)).toBe(-20);
    expect(isClamped(noShow, -999)).toBe(true);
  });

  it('clamps a too-lenient sentence down to the range ceiling', () => {
    expect(clampVerdictDelta(noShow, -1)).toBe(-8);
    expect(isClamped(noShow, -1)).toBe(true);
  });

  it('refuses to turn a penalty into a bonus, however hard it is pushed', () => {
    for (const attempt of [50, 100, 9999, 0.5]) {
      const out = clampVerdictDelta(noShow, attempt);
      expect(out, `attempt ${attempt}`).toBeLessThanOrEqual(0);
    }
  });

  it('refuses to turn a bonus into a penalty', () => {
    expect(clampVerdictDelta(VIOLATION_MAP.on_time_bonus, -50)).toBeGreaterThanOrEqual(0);
  });

  it('falls back to base for NaN / Infinity', () => {
    expect(clampVerdictDelta(noShow, Number.NaN)).toBe(noShow.base);
    expect(clampVerdictDelta(noShow, Number.POSITIVE_INFINITY)).toBe(noShow.base);
    expect(clampVerdictDelta(noShow, Number.NEGATIVE_INFINITY)).toBe(noShow.base);
  });

  it('rounds fractional sentences to whole points', () => {
    expect(clampVerdictDelta(noShow, -12.4)).toBe(-12);
    expect(clampVerdictDelta(noShow, -12.6)).toBe(-13);
  });

  it('keeps every violation type bounded for arbitrary model output', () => {
    const wild = [-1e9, -31, -0.1, 0, 0.1, 31, 1e9];
    for (const def of VIOLATIONS) {
      for (const raw of wild) {
        const out = clampVerdictDelta(def, raw);
        expect(out, `${def.type} @ ${raw}`).toBeGreaterThanOrEqual(def.min);
        expect(out, `${def.type} @ ${raw}`).toBeLessThanOrEqual(def.max);
      }
    }
  });

  it('lets `other` reach 0 — the AI may decline to punish', () => {
    expect(clampVerdictDelta(VIOLATION_MAP.other, 0)).toBe(0);
    expect(clampVerdictDelta(VIOLATION_MAP.other, 5)).toBe(0);
  });
});

describe('clampScore', () => {
  it('holds the score inside 0..100', () => {
    expect(clampScore(-40)).toBe(0);
    expect(clampScore(140)).toBe(100);
    expect(clampScore(72.6)).toBe(73);
  });
});

describe('case statuses', () => {
  it('recognises exactly the documented statuses', () => {
    for (const s of CASE_STATUSES) expect(isCaseStatus(s)).toBe(true);
    expect(isCaseStatus('active')).toBe(false); // v1 status, migrated away
    expect(isCaseStatus('')).toBe(false);
  });

  it('counts a delta as applied only after a verdict', () => {
    expect(affectsScore('decided')).toBe(true);
    expect(affectsScore('appealed')).toBe(true); // appealing does not refund
    expect(affectsScore('awaiting_statement')).toBe(false);
    expect(affectsScore('judging')).toBe(false);
    expect(affectsScore('revoked')).toBe(false);
    expect(affectsScore('withdrawn')).toBe(false);
  });
});

describe('tierFor', () => {
  it('maps boundary scores to the right tier', () => {
    expect(tierFor(100).name).toBe('誓约之光');
    expect(tierFor(95).name).toBe('誓约之光');
    expect(tierFor(94).name).toBe('守时楷模');
    expect(tierFor(70).name).toBe('基本靠谱');
    expect(tierFor(0).name).toBe('资深鸽王');
  });
});
