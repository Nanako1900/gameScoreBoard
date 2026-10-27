import { isSynthesizedTitle } from '@shared/quickTime';
import type { SessionItem } from '../types';
import { sessionPath } from './routes';
import { formatWhen } from './time';

export function sessionShareUrl(origin: string, id: number): string {
  return new URL(sessionPath(id), origin).toString();
}

/** Public scheduling facts only: no roster, score, or account-binding metadata. */
export function shareText(session: SessionItem, now: number, offsetHours?: number): string {
  const subject = session.game || (isSynthesizedTitle(session.title) ? '开黑' : session.title);
  const missing = session.capacity === null ? null : Math.max(0, session.capacity - session.counts.going);
  const seats = missing === null ? '已经 ' + session.counts.going + ' 人'
    : missing === 0 ? '人齐了' : '还差 ' + missing + ' 人';
  return formatWhen(session.starts_at, now, offsetHours) + ' ' + subject + '，' + seats + '，来不来？';
}
