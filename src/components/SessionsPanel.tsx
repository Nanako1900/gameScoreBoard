import { useCallback, useEffect, useState } from 'react';
import { RSVP_LABEL, SELF_RSVPS, SESSION_STATUS_LABEL } from '@shared/attendance';
import { isSynthesizedTitle } from '@shared/quickTime';
import type { SessionItem, User } from '../types';
import type { SelfRsvp } from '@shared/attendance';
import { ApiError, getSessions, setRsvp } from '../api';
import { formatWhen, parseTimestamp } from '../lib/time';
import { Avatar } from './Avatar';
import './sessions-panel.css';

interface SessionsPanelProps {
  me: User | null;
  onOpenSession: (id: number) => void;
  onCreate: () => void;
  /** Bumped by the parent to force a reload after a mutation elsewhere. */
  refreshKey: number;
}

type Scope = 'upcoming' | 'past';

const SCOPES: { value: Scope; label: string }[] = [
  { value: 'upcoming', label: '即将开始' },
  { value: 'past', label: '已结束' },
];

const RSVP_ORDER = SELF_RSVPS;

/** 约局 — the scheduling half of v2. Fully usable without ever touching scores. */
export function SessionsPanel({
  me,
  onOpenSession,
  onCreate,
  refreshKey,
}: SessionsPanelProps): JSX.Element {
  const [scope, setScope] = useState<Scope>('upcoming');
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const res = await getSessions(scope);
      setSessions(res.sessions);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '加载约局失败');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const handleRsvp = async (id: number, rsvp: SelfRsvp): Promise<void> => {
    setBusyId(id);
    try {
      const res = await setRsvp(id, rsvp);
      setSessions((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, my_rsvp: res.session.my_rsvp, counts: res.session.counts } : s,
        ),
      );
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '报名失败');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="sessions panel" aria-labelledby="sessions-title">
      <header className="sessions__head">
        <h2 id="sessions-title" className="sessions__title">
          <span aria-hidden="true">📅</span> 约局
        </h2>
        <div className="sessions__tabs" role="tablist" aria-label="约局范围">
          {SCOPES.map((s) => (
            <button
              key={s.value}
              type="button"
              role="tab"
              aria-selected={scope === s.value}
              className={`sessions__tab${scope === s.value ? ' sessions__tab--active' : ''}`}
              onClick={() => setScope(s.value)}
            >
              {s.label}
            </button>
          ))}
        </div>
        {me && (
          <button type="button" className="btn btn--gold btn--sm" onClick={onCreate}>
            组一局
          </button>
        )}
      </header>

      {error && (
        <p className="sessions__error" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="sessions__empty">加载中…</p>
      ) : sessions.length === 0 ? (
        <p className="sessions__empty">
          {scope === 'upcoming' ? '还没有人组局。第一个开黑的永远是英雄。' : '还没有已结束的约局。'}
        </p>
      ) : (
        <ul className="sessions__list">
          {sessions.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              me={me}
              busy={busyId === s.id}
              onOpen={() => onOpenSession(s.id)}
              onRsvp={(rsvp) => void handleRsvp(s.id, rsvp)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

interface SessionRowProps {
  session: SessionItem;
  me: User | null;
  busy: boolean;
  onOpen: () => void;
  onRsvp: (rsvp: SelfRsvp) => void;
}

function SessionRow({ session, me, busy, onOpen, onRsvp }: SessionRowProps): JSX.Element {
  const started = parseTimestamp(session.starts_at) <= Date.now();
  const canRsvp =
    me !== null && session.status === 'open' && !started && session.organizer.id !== me.id;
  const full =
    session.capacity !== null &&
    session.counts.going >= session.capacity &&
    session.my_rsvp !== 'going';

  return (
    <li className={`srow srow--${session.status}`}>
      <button type="button" className="srow__main" onClick={onOpen}>
        <span className="srow__when tabular">{formatWhen(session.starts_at)}</span>
        {/* v3 derives the title from the start time, so for an auto-titled session
            the line below would just repeat the line above. Only show a title
            somebody actually chose. */}
        {!isSynthesizedTitle(session.title) && (
          <span className="srow__title">{session.title}</span>
        )}
        <span className="srow__meta">
          <Avatar name={session.organizer.username} src={session.organizer.avatar_url} size={18} />
          {session.organizer.username}
          {session.game && <span className="srow__game">{session.game}</span>}
          <span className="srow__count tabular">
            {session.counts.going}
            {session.capacity !== null && `/${session.capacity}`} 人
          </span>
          {session.status !== 'open' && (
            <span className="srow__status">{SESSION_STATUS_LABEL[session.status]}</span>
          )}
          {session.status === 'open' && started && <span className="srow__status">待结算</span>}
        </span>
      </button>

      {canRsvp && (
        <div className="srow__rsvp" role="group" aria-label={`报名 ${session.title}`}>
          {RSVP_ORDER.map((r) => (
            <button
              key={r}
              type="button"
              className={`srow__rsvp-btn${
                session.my_rsvp === r ? ' srow__rsvp-btn--active' : ''
              }`}
              onClick={() => onRsvp(r)}
              disabled={busy || (r === 'going' && full)}
              aria-pressed={session.my_rsvp === r}
            >
              {RSVP_LABEL[r]}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}
