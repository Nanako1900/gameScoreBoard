import { describe, expect, it } from 'vitest';
import { healPreview, healPreviewText, projectedAfterHeal } from '../../src/lib/forgiveness';
import { formatTimeLeft } from '../../src/lib/time';

// The heal is +config.weeklyHeal, capped at MAX_SCORE (worker/db.ts weeklyHeal).
// Every config here says 5 — the test stub's value — so a literal 15 anywhere
// in the code would make these fail.

const HEAL = 5;
const DAY = 86_400_000;
const NOW = Date.parse('2026-10-28T04:00:00Z');
const NEXT = new Date(NOW + 2 * DAY + 3_600_000).toISOString();

function config(over: Partial<{ weeklyHeal: number; nextResetAt: string }> = {}) {
  return { weeklyHeal: HEAL, nextResetAt: NEXT, ...over };
}

describe('projectedAfterHeal', () => {
  it('adds the configured heal', () => {
    expect(projectedAfterHeal(82, HEAL)).toBe(87);
  });

  it('stops at MAX_SCORE, and a full score stays', () => {
    expect(projectedAfterHeal(98, HEAL)).toBe(100);
    expect(projectedAfterHeal(100, HEAL)).toBe(100);
  });

  it('treats a broken or negative heal as none', () => {
    expect(projectedAfterHeal(82, Number.NaN)).toBe(82);
    expect(projectedAfterHeal(82, -3)).toBe(82);
  });
});

describe('healPreview', () => {
  it('previews Monday from config', () => {
    expect(healPreview(82, config(), NOW)).toEqual({
      kind: 'heal',
      heal: 5,
      projected: 87,
      timeLeft: formatTimeLeft(NEXT, NOW),
    });
  });

  it('has nothing to wait for at full score', () => {
    expect(healPreview(100, config(), NOW)).toEqual({ kind: 'full' });
  });

  it('says healing once nextResetAt has passed — never a negative time', () => {
    expect(healPreview(82, config(), Date.parse(NEXT))).toEqual({ kind: 'healing' });
    expect(healPreview(82, config(), Date.parse(NEXT) + DAY)).toEqual({ kind: 'healing' });
  });

  it('still gives the numbers when nextResetAt cannot be read', () => {
    expect(healPreview(82, config({ nextResetAt: 'soon' }), NOW)).toEqual({
      kind: 'heal',
      heal: 5,
      projected: 87,
      timeLeft: '',
    });
  });
});

describe('healPreviewText', () => {
  it('reads like spec §3.2', () => {
    const timeLeft = formatTimeLeft(NEXT, NOW);
    expect(timeLeft).toMatch(/^还有 /);
    expect(healPreviewText(healPreview(82, config(), NOW))).toBe(`周一 0 点回血 +5 → 预计 87 · ${timeLeft}`);
  });

  it('drops the time part when there is none', () => {
    expect(healPreviewText({ kind: 'heal', heal: 5, projected: 87, timeLeft: '' })).toBe('周一 0 点回血 +5 → 预计 87');
  });

  it('has fixed lines for full and healing', () => {
    expect(healPreviewText({ kind: 'full' })).toBe('已经是满分，回血不用等。');
    expect(healPreviewText({ kind: 'healing' })).toBe('回血中…');
  });
});
