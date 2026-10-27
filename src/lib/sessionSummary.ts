import { ATTENDANCES, ATTENDANCE_MAP } from '@shared/attendance';
import type { RecordItem, SessionPlayer } from '../types';

/** A settlement describes attendance and filings, never an inferred score. */
export function settledSummary(
  players: readonly Pick<SessionPlayer, 'attendance'>[],
  records: readonly Pick<RecordItem, 'status'>[],
): string {
  const attendance = ATTENDANCES.flatMap((kind) => {
    const count = players.filter((p) => p.attendance === kind).length;
    return count > 0 ? [`${ATTENDANCE_MAP[kind].label} ${count}`] : [];
  });
  const filed = records.length ? [`立案 ${records.length} 起`] : [];
  const waiting = records.some((r) => r.status === 'awaiting_statement') ? '，等当事人说明' : '';
  return ['已结算', ...attendance, ...filed].join(' · ') + waiting;
}
