/**
 * Competition ranking ("1224"): equal scores share a rank and the next rank
 * skips, so [100, 100, 96] → [1, 1, 3]. A rank is 1 + the number of strictly
 * higher scores, so it never depends on the list's order — the API orders ties
 * by name only to keep the list stable, and the board must not turn that into
 * "阿杰 beats 小红".
 */
export function competitionRanks(scores: readonly number[]): number[] {
  return scores.map((score) => 1 + scores.filter((other) => other > score).length);
}
