import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ATTENDANCE_MAP,
  RSVP_LABEL,
  SELF_RSVPS,
  SESSION_STATUS_LABEL,
  isSelfRsvp,
} from '@shared/attendance';
import type { Rsvp, SelfRsvp } from '@shared/attendance';
import type { RecordItem, SessionDetail, User } from '../types';
import { ApiError, cancelSession, getSession, setRsvp } from '../api';
import { PAGE_BACK_LABEL, SESSION_NOT_FOUND } from '../lib/routeCopy';
import { fullNotice, goingClosed, rsvpFeedback } from '../lib/sessionActions';
import { formatDateTime, formatWhen, parseTimestamp } from '../lib/time';
import { useInlineConfirm } from '../lib/useInlineConfirm';
import { useUndo } from '../lib/useUndo';
import { Modal } from './Modal';
import { Avatar } from './Avatar';
import { ConfirmInline } from './ConfirmInline';
import { NotFound } from './NotFound';
import { PageBar } from './PageBar';
import { VerdictCard } from './VerdictCard';
import { RollCallDialog } from './RollCallDialog';
import { RescheduleSheet } from './RescheduleSheet';
import { useToast } from './Toast';
import './session-detail.css';

interface SessionDetailDialogProps {
  sessionId: number;
  me: User | null;
  onClose: () => void;
  /** Called after any mutation so parent lists and the leaderboard refresh. */
  onChanged: () => void;
  /** Default 'center' — today's dialog, byte for byte. 'page' / 'drawer': the /sessions/:id route (P1-1). */
  variant?: 'center' | 'page' | 'drawer';
}

const RSVP_ORDER = SELF_RSVPS;
const TITLE_ID = 'session-detail-title';
const NOT_FOUND_STATUS = 404;

export function SessionDetailDialog({
  sessionId,
  me,
  onClose,
  onChanged,
  variant = 'center',
}: SessionDetailDialogProps): JSX.Element {
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rollCallOpen, setRollCallOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  // A 404 on the page / drawer forms: NotFound instead of the bare error line (spec §2.2).
  const [missing, setMissing] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleFocused = useRef(false);
  const toast = useToast();
  const offerUndo = useUndo();

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await getSession(sessionId);
      setSession(res.session);
      setRecords(res.records);
      setError(null);
    } catch (err) {
      if (variant !== 'center' && err instanceof ApiError && err.status === NOT_FOUND_STATUS) {
        setMissing(true);
        return;
      }
      setError(err instanceof ApiError ? err.message : '加载失败');
    }
  }, [sessionId, variant]);

  useEffect(() => {
    void load();
  }, [load]);

  // The page form: once the session is in, focus its title (spec §6.4) — only the first time.
  useEffect(() => {
    if (variant !== 'page' || session === null || titleFocused.current) return;
    titleFocused.current = true;
    titleRef.current?.focus();
  }, [variant, session]);

  /** Runs a write, then reloads. Resolves false — with the reason on screen — when it failed. */
  const mutate = async (fn: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    try {
      await fn();
      await load();
      onChanged();
      setError(null);
      return true;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : '操作失败';
      // Moved since it loaded: show the new time to answer to (and tell the
      // lists behind), then say why — a successful reload clears the error.
      if (err instanceof ApiError && err.status === 409) {
        await load();
        onChanged();
      }
      setError(message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  /** Toast after an answer; a change between two own answers can be undone. */
  const announceRsvp = (id: number, startsAt: string, prev: Rsvp | null, next: SelfRsvp): void => {
    const feedback = rsvpFeedback(prev, next);
    if (!feedback) return;
    if (!feedback.undoable || prev === null || !isSelfRsvp(prev)) {
      toast.show({ message: feedback.message, tone: 'ok' });
      return;
    }
    const restore: SelfRsvp = prev;
    offerUndo({
      message: feedback.message,
      // The time this answer was given to, not whatever is on screen later: if
      // the session has moved since, the server says 409 and the toast says so —
      // an answer to the old time must not land on the new one.
      undo: () => setRsvp(id, restore, startsAt),
      onUndone: () => {
        void load();
        onChanged();
      },
    });
  };

  const answer = async (next: SelfRsvp): Promise<void> => {
    if (!session) return;
    const { id, starts_at: startsAt, my_rsvp: prev } = session;
    if (await mutate(() => setRsvp(id, next, startsAt))) {
      announceRsvp(id, startsAt, prev, next);
    }
  };

  const handleCancel = async (): Promise<boolean> => {
    if (!session) return false;
    const ok = await mutate(() => cancelSession(session.id));
    if (ok) {
      toast.show({ message: '这局已取消。', tone: 'ok' });
      // The confirm and the button that opened it leave with the open state.
      titleRef.current?.focus();
    }
    return ok;
  };

  const handleRescheduled = (updated: SessionDetail): void => {
    setRescheduleOpen(false);
    setSession(updated);
    setError(null);
    toast.show({ message: `已改到 ${formatWhen(updated.starts_at)}。`, tone: 'ok' });
    onChanged();
  };

  const started = session !== null && parseTimestamp(session.starts_at) <= Date.now();
  const isOrganizer = me !== null && session !== null && session.organizer.id === me.id;
  const canManage = isOrganizer || me?.is_admin === true;
  const canRsvp =
    me !== null && session?.status === 'open' && !started && !isOrganizer;
  const canRollCall = canManage && session?.status === 'open' && started;

  return (
    <>
      <Modal open onClose={onClose} labelledBy={TITLE_ID} size="lg" variant={variant}>
        {variant === 'page' && <PageBar backLabel={PAGE_BACK_LABEL} title={session?.title} onBack={onClose} />}
        {missing ? (
          <NotFound title={SESSION_NOT_FOUND} headingId={TITLE_ID} />
        ) : !session ? (
          <p className="sdt__status" aria-live="polite">
            {error ?? '加载中…'}
          </p>
        ) : (
          <div className="sdt">
            <header className="sdt__head">
              <p className="sdt__when tabular">{formatDateTime(session.starts_at)}</p>
              <h2 id={TITLE_ID} className="sdt__title" ref={titleRef} tabIndex={-1}>
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
              <RsvpControls session={session} busy={busy} onAnswer={(r) => void answer(r)} />
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
              <OrganizerActions
                started={started}
                canRollCall={canRollCall}
                busy={busy}
                onReschedule={() => setRescheduleOpen(true)}
                onRollCall={() => setRollCallOpen(true)}
                onCancel={handleCancel}
              />
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

      {session && rescheduleOpen && (
        <RescheduleSheet
          session={session}
          onClose={() => setRescheduleOpen(false)}
          onRescheduled={handleRescheduled}
        />
      )}
    </>
  );
}

const FULL_NOTICE_ID = 'session-detail-full';

interface RsvpControlsProps {
  session: SessionDetail;
  busy: boolean;
  onAnswer: (rsvp: SelfRsvp) => void;
}

/**
 * The panel's one set of 来 / 待定 / 不来 (session-rsvp-moved pins a single 来)
 * and what an answer commits to. 来 closes once the seats are taken — the
 * server refuses it anyway — and the notice says what to do instead.
 */
function RsvpControls({ session, busy, onAnswer }: RsvpControlsProps): JSX.Element {
  const closed = goingClosed(session);
  const notice = fullNotice(session);
  return (
    <div className="sdt__rsvp-block">
      <div className="sdt__rsvp" role="group" aria-label="我的报名">
        <span className="sdt__rsvp-label">我：</span>
        {RSVP_ORDER.map((r) => {
          const shut = r === 'going' && closed;
          return (
            <button
              key={r}
              type="button"
              className={`btn btn--sm${session.my_rsvp === r ? ' btn--gold' : ' btn--ghost'}`}
              disabled={busy || shut}
              aria-pressed={session.my_rsvp === r}
              aria-describedby={shut && notice ? FULL_NOTICE_ID : undefined}
              onClick={() => onAnswer(r)}
            >
              {RSVP_LABEL[r]}
            </button>
          );
        })}
      </div>
      <p className="sdt__rsvp-note">来 = 承诺，没来会被记一笔；待定不算承诺。</p>
      <p className="sdt__rsvp-note">开局前说不来，点名结算不会记你。</p>
      {notice && (
        <p id={FULL_NOTICE_ID} className="sdt__rsvp-full">
          {notice}
        </p>
      )}
    </div>
  );
}

interface OrganizerActionsProps {
  started: boolean;
  canRollCall: boolean;
  busy: boolean;
  onReschedule: () => void;
  onRollCall: () => void;
  onCancel: () => Promise<boolean>;
}

/** The organizer's (or an admin's) controls on an open session; 取消这局 comes last. */
function OrganizerActions({
  started,
  canRollCall,
  busy,
  onReschedule,
  onRollCall,
  onCancel,
}: OrganizerActionsProps): JSX.Element {
  return (
    <div className="sdt__actions">
      {!started && (
        <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={onReschedule}>
          改时间
        </button>
      )}
      {canRollCall && (
        <button type="button" className="btn btn--gold" onClick={onRollCall}>
          点名结算
        </button>
      )}
      {!started && <p className="sdt__hint">约局开始后可以点名，点名不等于扣分。</p>}
      {!started && <CancelSessionControl busy={busy} onConfirm={onCancel} />}
    </div>
  );
}

interface CancelSessionControlProps {
  busy: boolean;
  onConfirm: () => Promise<boolean>;
}

/**
 * 取消这局 → an in-place confirm with focus on 不取消了 (DiscordLinkCard's way).
 * Confirming submits at once: nothing reopens a cancelled session, so a delayed
 * submit lost to a closed tab would look done and not be (spec §3.5).
 */
function CancelSessionControl({ busy, onConfirm }: CancelSessionControlProps): JSX.Element {
  const { confirming, ask, dismiss, close, triggerRef } = useInlineConfirm();
  const confirm = async (): Promise<void> => {
    if (await onConfirm()) close();
  };
  if (!confirming) {
    return (
      <button ref={triggerRef} type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={ask}>
        取消这局
      </button>
    );
  }
  return (
    <div className="sdt__cancel-confirm">
      <ConfirmInline
        question="取消这局？"
        confirmLabel="确认取消"
        cancelLabel="不取消了"
        tone="danger"
        focus="cancel"
        busy={busy}
        busyLabel="取消中…"
        onCancel={dismiss}
        onConfirm={() => void confirm()}
      >
        <p className="sdt__cancel-detail">
          会私信通知说了来、待定的人，以及收到过邀请还没回的人；说了不来的人不会收到。
        </p>
      </ConfirmInline>
    </div>
  );
}
