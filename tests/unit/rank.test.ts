import { describe, expect, it } from 'vitest';
import { competitionRanks } from '../../src/lib/rank';

// The board ranks ties together (spec §9 P0-4): two players on 100 are both
// 第 1 名, and the next one is 第 3 名 — never "1, 2" by name.

describe('competitionRanks', () => {
  it('gives equal scores the same rank and skips after a tie', () => {
    expect(competitionRanks([100, 100, 96])).toEqual([1, 1, 3]);
    expect(competitionRanks([90, 80, 80, 80, 70])).toEqual([1, 2, 2, 2, 5]);
  });

  it('ranks everyone first when everyone is tied', () => {
    expect(competitionRanks([100, 100, 100])).toEqual([1, 1, 1]);
  });

  it('does not depend on the input order', () => {
    expect(competitionRanks([96, 100, 96])).toEqual([2, 1, 2]);
  });

  it('handles an empty board', () => {
    expect(competitionRanks([])).toEqual([]);
  });
});
