import { useCallback, useEffect, useState } from 'react';
import { getSessions } from '../api';
import type { SessionItem } from '../types';
import { COUNTDOWN_TICK_MS, RECENT_SESSIONS_SHOWN } from '../lib/constants';
import { useNow } from '../lib/useNow';
import { SessionCard } from './SessionCard';
import './recent-sessions.css';

interface RecentProps { refreshKey: number; boardTzOffsetHours?: number; onOpenSession: (id: number) => void }
export function RecentSessions({ refreshKey, boardTzOffsetHours, onOpenSession }: RecentProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const now = useNow(COUNTDOWN_TICK_MS);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  useEffect(() => {
    if (!expanded) return;
    let active = true;
    setLoading(true);
    void getSessions('past').then(({ sessions: rows }) => {
      if (active) { setSessions(rows); setFailed(false); }
    }, () => { if (active) setFailed(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [expanded, refreshKey, attempt]);
  return <section className="recent panel" aria-labelledby="recent-title">
    <h2 id="recent-title"><button type="button" aria-expanded={expanded} onClick={() => setExpanded((old) => !old)}>最近结束</button></h2>
    {expanded && <div className="recent__body">
      {failed && <p role="status">这块没加载出来，你的操作没丢。<button type="button" className="btn btn--ghost btn--sm" onClick={retry}>重试</button></p>}
      {loading ? <p>加载中…</p> : sessions.length ? <ul>{sessions.slice(0, RECENT_SESSIONS_SHOWN).map((s) =>
        <SessionCard key={s.id} session={s} me={null} now={now} boardTzOffsetHours={boardTzOffsetHours} onOpen={() => onOpenSession(s.id)} />)}</ul>
        : !failed && <p>还没有已结束的约局。</p>}
    </div>}
  </section>;
}
