import { DEFAULT_DURATION_MIN, SESSION_START_REMINDER_MIN } from '@shared/attendance';
import type { SessionItem } from '../types';
import { COUNTDOWN_TICK_MS } from '../lib/constants';
import { copyText, downloadText } from '../lib/download';
import { buildIcs, icsFileName } from '../lib/ics';
import { sessionPhase } from '../lib/lobbySessions';
import { sessionShareUrl, shareText } from '../lib/share';
import { useNow } from '../lib/useNow';
import { useToast } from './Toast';
import './share-actions.css';

export function useCopySessionLink(session: SessionItem): () => Promise<void> {
  const toast = useToast();
  return async () => {
    const url = sessionShareUrl(window.location.origin, session.id);
    const copied = await copyText(url);
    toast.show({ message: copied ? '链接已复制。朋友打开后登录就能报名。' : `没复制成功，请手动复制：${url}`,
      tone: copied ? 'ok' : 'error' });
  };
}
function saveCalendar(session: SessionItem, now: number): void {
  const url = sessionShareUrl(window.location.origin, session.id);
  const title = session.title + (session.game ? `（${session.game}）` : '');
  const text = buildIcs({ uid: `edg-session-${session.id}@${window.location.host}`, title, startsAt: session.starts_at,
    durationMin: session.duration_min ?? DEFAULT_DURATION_MIN, url, description: session.note ?? undefined,
    alarmMin: SESSION_START_REMINDER_MIN, now });
  downloadText(icsFileName(session.id), text, 'text/calendar;charset=utf-8');
}
export function ShareActions({ session, boardTzOffsetHours }: { session: SessionItem; boardTzOffsetHours?: number }): JSX.Element | null {
  const now = useNow(COUNTDOWN_TICK_MS);
  const copy = useCopySessionLink(session);
  const share = async (): Promise<void> => {
    try { await navigator.share({ title: session.title, text: shareText(session, now, boardTzOffsetHours),
      url: sessionShareUrl(window.location.origin, session.id) }); }
    catch (err) {
      if (err !== null && typeof err === 'object' && 'name' in err && err.name === 'AbortError') return;
      await copy();
    }
  };
  if (sessionPhase(session, now) !== 'upcoming') return null;
  return <div className="share">
    {typeof navigator.share === 'function' && <button type="button" className="btn btn--ghost" onClick={() => void share()}>分享邀请</button>}
    <button type="button" className="btn btn--ghost" onClick={() => void copy()}>复制链接</button>
    <button type="button" className="btn btn--ghost" onClick={() => saveCalendar(session, now)}>加到日历</button>
  </div>;
}
