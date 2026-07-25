import { useCallback, useEffect, useState } from 'react';
import {
  ATTENDANCE_MAP,
  RSVP_LABEL,
  SESSION_STATUS_LABEL,
} from '@shared/attendance';
import type { Rsvp } from '@shared/attendance';
import type { RecordItem, SessionDetail, User } from '../types';
import { ApiError, cancelSession, getSession, setRsvp } from '../api';
import { formatDateTime, parseTimestamp } from '../lib/time';
import { Modal } from './Modal';
import { Avatar } from './Avatar';
import { VerdictCard } from './VerdictCard';
import { RollCallDialog } from './RollCallDialog';
import './session-detail.css';

interface SessionDetailDialogProps {
  sessionId: number;
  me: User | null;
  onClose: () => void;
  /** Called after any mutation so parent lists and the leaderboard refresh. */
  onChanged: () => void;
}

const RSVP_ORDER: Rsvp[] = ['going', 'maybe', 'out'];

export function SessionDetailDialog({
  sessionId,
  me,
  onClose,
  onChanged,
}: SessionDetailDialogProps): JSX.Element {
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rollCallOpen, setRollCallOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await getSession(sessionId);
      setSession(res.session);
      setRecords(res.records);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '加载失败');
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    try {
      await fn();
      await load();
      onChanged();
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const started = session !== null && parseTimestamp(session.starts_at) <= Date.now();
  const isOrganizer = me !== null && session !== null && session.organizer.id === me.id;
  const canManage = isOrganizer || me?.is_admin === true;
  const canRsvp =
    me !== null && session?.status === 'open' && !started && !isOrganizer;
  const canRollCall = canManage && session?.status === 'open' && started;

  return (
    <>
      <Modal open onClose={onClose} labelledBy="session-detail-title" size="lg">
        {!session ? (
          <p className="sdt__status" aria-live="polite">
            {error ?? '加载中…'}
          </p>
        ) : (
          <div className="sdt">
            <header className="sdt__head">
              <p className="sdt__when tabular">{formatDateTime(session.starts_at)}</p>
              <h2 id="session-detail-title" className="sdt__title">
                {session.title}
              </h2>
              <p className="sdt__meta">
                <Avatar
                  name={session.organizer.username}
                  src={session.organizer.avatar_url}
                  size={20}
                />
                {session.organizer.username} 组局
                {session.game && <span className="sdt__chip">{session.game}</span>}
                {session.duration_min && <span className="sdt__chip">{session.duration_min} 分钟</span>}
                {session.status !== 'open' && (
                  <span className="sdt__chip sdt__chip--status">
                    {SESSION_STATUS_LABEL[session.status]}
                  </span>
                )}
              </p>
              {session.note && <p className="sdt__note">{session.note}</p>}
            </header>

            {error && (
              <p className="sdt__error" role="alert">
                {error}
              </p>
            )}
            {flash && <p className="sdt__flash">{flash}</p>}

            {canRsvp && (
              <div className="sdt__rsvp" role="group" aria-label="我的报名">
                <span className="sdt__rsvp-label">我：</span>
                {RSVP_ORDER.map((r) => (
                  <button
                    key={r}
                    type="button"
                    className={`btn btn--sm${
                      session.my_rsvp === r ? ' btn--gold' : ' btn--ghost'
                    }`}
                    disabled={busy}
                    aria-pressed={session.my_rsvp === r}
                    onClick={() => void mutate(() => setRsvp(session.id, r))}
                  >
                    {RSVP_LABEL[r]}
                  </button>
                ))}
              </div>
            )}

            <section className="sdt__section">
              <h3 className="sdt__section-title">
                报名 <span className="tabular">{session.counts.going}</span>
                {session.capacity !== null && (
                  <span className="tabular"> / {session.capacity}</span>
                )}
              </h3>
              <ul className="sdt__players">
                {session.players.map((p) => {
                  const att = p.attendance ? ATTENDANCE_MAP[p.attendance] : null;
                  return (
                    <li key={p.user.id} className={`sdt-player sdt-player--${p.rsvp}`}>
                      <Avatar name={p.user.username} src={p.user.avatar_url} size={24} />
                      <span className="sdt-player__name">{p.user.username}</span>
                      <span className="sdt-player__rsvp">{RSVP_LABEL[p.rsvp]}</span>
                      {att && (
                        <span className={`sdt-player__att sdt-player__att--${p.attendance}`}>
                          {att.emoji} {att.label}
                          {p.attendance === 'late' && p.late_minutes !== null && (
                            <span className="tabular"> {p.late_minutes}′</span>
                          )}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>

            {records.length > 0 && (
              <section className="sdt__section">
                <h3 className="sdt__section-title">
                  由这一局产生的记录 <span className="tabular">{records.length}</span>
                </h3>
                <div className="sdt__records">
                  {records.map((r) => (
                    <VerdictCard key={r.id} record={r} />
                  ))}
                </div>
              </section>
            )}

            {canManage && session.status === 'open' && (
              <div className="sdt__actions">
                {!started && (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={busy}
                    onClick={() => void mutate(() => cancelSession(session.id))}
                  >
                    取消约局
                  </button>
                )}
                {canRollCall && (
                  <button
                    type="button"
                    className="btn btn--gold"
                    onClick={() => setRollCallOpen(true)}
                  >
                    点名结算
                  </button>
                )}
                {!started && (
                  <p className="sdt__hint">约局开始后可以点名，点名不等于扣分。</p>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>

      {session && rollCallOpen && (
        <RollCallDialog
          open
          session={session}
          onClose={() => setRollCallOpen(false)}
          onSettled={(updated, created) => {
            setRollCallOpen(false);
            setSession(updated);
            setFlash(
              created > 0
                ? `已结算，立案 ${created} 起，等待当事人说明情况。`
                : '已结算，只记录了出勤，没有扣分。',
            );
            void load();
            onChanged();
          }}
        />
      )}
    </>
  );
}
