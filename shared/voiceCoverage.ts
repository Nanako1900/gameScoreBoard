import type { CoverageRow } from './voiceDays';

function checkedTime(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) throw new RangeError('覆盖时间应为 UTC 文本');
  const at = Date.parse(value.replace(' ', 'T') + 'Z');
  if (!Number.isFinite(at) || new Date(at).toISOString().slice(0, 19).replace('T', ' ') !== value) {
    throw new RangeError('覆盖时间不存在');
  }
}

/** Persisted UTC text sorts chronologically; copy only the two public fields. */
function union(rows: readonly CoverageRow[]): CoverageRow[] {
  const sorted = rows.map(({ started_at, last_seen_at }) => {
    checkedTime(started_at); checkedTime(last_seen_at);
    if (last_seen_at < started_at) throw new RangeError('覆盖时段结束早于开始');
    return { started_at, last_seen_at };
  }).sort((a, b) => a.started_at < b.started_at ? -1 : a.started_at > b.started_at ? 1
    : a.last_seen_at < b.last_seen_at ? -1 : a.last_seen_at > b.last_seen_at ? 1 : 0);
  const result: CoverageRow[] = [];
  for (const row of sorted) {
    const previous = result.at(-1);
    if (!previous || row.started_at > previous.last_seen_at) result.push(row);
    else if (row.last_seen_at > previous.last_seen_at) previous.last_seen_at = row.last_seen_at;
  }
  return result;
}

/** Keep only observations present before AND after a segment read. A new
 * checkpoint cannot certify an older segment snapshot; revoked coverage must
 * disappear too. Closed endpoints retain a single observed point for live
 * status, while gap arithmetic continues to ignore its zero duration. */
export function intersectVoiceCoverage(before: readonly CoverageRow[], after: readonly CoverageRow[]): CoverageRow[] {
  const left = union(before); const right = union(after);
  const result: CoverageRow[] = [];
  let i = 0; let j = 0;
  while (i < left.length && j < right.length) {
    const a = left[i]; const b = right[j];
    const started_at = a.started_at > b.started_at ? a.started_at : b.started_at;
    const last_seen_at = a.last_seen_at < b.last_seen_at ? a.last_seen_at : b.last_seen_at;
    if (started_at <= last_seen_at) result.push({ started_at, last_seen_at });
    if (a.last_seen_at <= b.last_seen_at) i += 1;
    if (b.last_seen_at <= a.last_seen_at) j += 1;
  }
  return result;
}
