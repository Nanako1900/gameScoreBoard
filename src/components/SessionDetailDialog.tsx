import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_DURATION_MIN,
  SESSION_STATUS_LABEL,
  isSelfRsvp,
} from '@shared/attendance';
import type { Rsvp, SelfRsvp } from '@shared/attendance';
import type { InviteResponse, RecordItem, SessionDetail, User } from '../types';
import { ApiError, cancelSession, getSession, setRsvp } from '../api';
import { BACK_HOME, PAGE_BACK_LABEL, SEE_HISTORY, SESSION_NOT_FOUND } from '../lib/routeCopy';
import { HOME_PATH, SESSION_HISTORY_PATH } from '../lib/routes';
import { fullNotice, goingClosed, rsvpFeedback } from '../lib/sessionActions';
import { inviteToast } from '../lib/invitePicker';
import { formatBoardDateTime, formatDateTime, formatTimeLeft, formatViewerAside, formatWhen, parseTimestamp } from '../lib/time';
import { COUNTDOWN_TICK_MS } from '../lib/constants';
import { sessionPhase } from '../lib/lobbySessions';
import { onSession } from '../lib/sessionEvents';
import { useNow } from '../lib/useNow';
import { useInlineConfirm } from '../lib/useInlineConfirm';
import { useInvitable } from '../lib/useInvitable';
import { useUndo } from '../lib/useUndo';
import { Modal } from './Modal';
import { Avatar } from './Avatar';
import { RsvpControl } from './RsvpControl';
import { RosterGroups } from './RosterGroups';
import { ConfirmInline } from './ConfirmInline';
import { NotFound } from './NotFound';
import { PageBar } from './PageBar';
import { VerdictCard } from './VerdictCard';
import { RollCallDialog } from './RollCallDialog';
import { RescheduleSheet } from './RescheduleSheet';
import { InviteSheet } from './InviteSheet';
import { RESUME_HINT_TEXT_ID, ResumeHint } from './ResumeHint';
import { VisitorRsvpPrompt } from './VisitorRsvpPrompt';
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
  /** P1-3: the answer clicked before logging in — only pointed at, never submitted. */
  resumeRsvp?: SelfRsvp | null;
  /** P1-3: the question above was answered, dismissed, or does not apply here. */
  onResumeDone?: () => void;
  boardTzOffsetHours?: number;
}

const TITLE_ID = 'session-detail-title';
const NOT_FOUND_STATUS = 404;

export function SessionDetailDialog({
  sessionId,
  me,
  onClose,
  onChanged,
  variant = 'center',
  resumeRsvp = null,
  onResumeDone,
  boardTzOffsetHours,
}: SessionDetailDialogProps): JSX.Element {
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rollCallOpen, setRollCallOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  // A 404 on the page / drawer forms: NotFound instead of the bare error line (spec §2.2).
  const [missing, setMissing] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleFocused = useRef(false);
  const toast = useToast();
  const offerUndo = useUndo();
  const now = useNow(COUNTDOWN_TICK_MS);

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

  useEffect(() => onSession((updated) => {
    if (updated.id === sessionId) setSession(updated);
  }), [sessionId]);

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

  const handleInvited = (result: InviteResponse): void => {
    setInviteOpen(false);
    setSession(result.session);
    setError(null);
    toast.show({ message: inviteToast(result.added), tone: 'ok' });
    onChanged();
  };

  const started = session !== null && parseTimestamp(session.starts_at) <= now;
  const isOrganizer = me !== null && session !== null && session.organizer.id === me.id;
  const canManage = isOrganizer || me?.is_admin === true;
  const canRsvp =
    me !== null && session?.status === 'open' && !started && !isOrganizer;
  const canRollCall = canManage && session?.status === 'open' && started;
  // P2-1: 再叫几个人 — same gate as the server (requireOrganizer, open, not started).
  const canInvite = canManage && session?.status === 'open' && !started;
  const invitable = useInvitable(canInvite);
  // 404 (an API without the list) hides the entry; a failed list keeps it — the sheet offers 重试.
  const showInviteEntry = invitable.state.kind === 'ready' || invitable.state.kind === 'error';

  // P1-3: a visitor answers through the login page; back here, the click is asked about.
  const canVisitorRsvp = me === null && session?.status === 'open' && !started;
  const resumeAsk: SelfRsvp | null =
    resumeRsvp !== null && canRsvp && session?.my_rsvp !== resumeRsvp ? resumeRsvp : null;

  // Nothing to ask (already that answer, the organizer, started…): forget the click.
  useEffect(() => {
    if (resumeRsvp !== null && session !== null && resumeAsk === null) onResumeDone?.();
  }, [resumeRsvp, session, resumeAsk, onResumeDone]);

  /** An answer clicked here, with or without the hint: the hint is done either way. */
  const answerHere = async (next: SelfRsvp): Promise<void> => {
    await answer(next);
    if (resumeRsvp !== null) onResumeDone?.();
  };

  const dismissResume = (): void => {
    onResumeDone?.();
    // The hint (and its focused button) leaves: focus the title, not <body>.
    titleRef.current?.focus();
  };

  return (
    <>
      <Modal open onClose={onClose} labelledBy={TITLE_ID} size="lg" variant={variant}>
        {variant === 'page' && <PageBar backLabel={PAGE_BACK_LABEL} title={session?.title} onBack={onClose} />}
        {missing ? (
          <NotFound title={SESSION_NOT_FOUND} headingId={TITLE_ID} actions={[{ label: BACK_HOME, to: HOME_PATH }, { label: SEE_HISTORY, to: SESSION_HISTORY_PATH }]} />
        ) : !session ? (
          <p className="sdt__status" aria-live="polite">
            {error ?? '加载中…'}
          </p>
        ) : (
          <div className="sdt">
            <header className="sdt__head">
              <SessionTime session={session} now={now} offset={boardTzOffsetHours} />
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
                {session.status !== 'open' && session.status !== 'cancelled' && (
                  <span className="sdt__chip sdt__chip--status">
                    {SESSION_STATUS_LABEL[session.status]}
                  </span>
                )}
              </p>
              {session.note && <p className="sdt__note">{session.note}</p>}
            </header>

            {session.status === 'cancelled' && <div className="sdt__cancelled"><p>已取消</p>
              {session.cancel_reason && <p>{session.organizer.username}：{session.cancel_reason}</p>}</div>}

            {error && (
              <p className="sdt__error" role="alert">
                {error}
              </p>
            )}
            {flash && <p className="sdt__flash">{flash}</p>}

            {resumeAsk && <ResumeHint rsvp={resumeAsk} onDismiss={dismissResume} />}
            {canRsvp && (
              <DetailRsvp
                session={session}
                busy={busy}
                suggested={resumeAsk ?? undefined}
                onAnswer={(r) => void answerHere(r)}
              />
            )}
            {canVisitorRsvp && <VisitorRsvpPrompt sessionId={session.id} />}
            {!canManage && ['live', 'due'].includes(sessionPhase(session, now)) && <p className="sdt__rsvp-note">开局后不能改报名</p>}

            <RosterGroups session={session} />

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
                onInvite={showInviteEntry ? () => setInviteOpen(true) : undefined}
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

      {session && inviteOpen && (
        <InviteSheet
          session={session}
          invitable={invitable}
          onClose={() => setInviteOpen(false)}
          onInvited={handleInvited}
        />
      )}
    </>
  );
}

interface SessionTimeProps { session: SessionDetail; now: number; offset?: number }
function SessionTime({ session, now, offset }: SessionTimeProps): JSX.Element {
  if (offset === undefined) return <p className="sdt__when tabular">{formatDateTime(session.starts_at)}</p>;
  const details = [formatTimeLeft(session.starts_at, now), `约 ${(session.duration_min ?? DEFAULT_DURATION_MIN) / 60} 小时`,
    formatViewerAside(session.starts_at, offset)].filter(Boolean).join(' · ');
  return <><p className="sdt__when tabular">{formatBoardDateTime(session.starts_at, offset)}</p>
    <p className="sdt__time-detail">{details}</p></>;
}
interface DetailRsvpProps { session: SessionDetail; busy: boolean; suggested?: SelfRsvp; onAnswer: (rsvp: SelfRsvp) => void }
function DetailRsvp({ session, busy, suggested, onAnswer }: DetailRsvpProps): JSX.Element {
  const notice = fullNotice(session);
  return <div className="sdt__rsvp-block">
    <p id="session-rsvp-q">你去吗？</p>
    <RsvpControl labelledBy="session-rsvp-q" value={session.my_rsvp} busy={busy} suggested={suggested}
      onAnswer={onAnswer} goingClosed={goingClosed(session)} goingClosedNoteId="session-detail-full"
      suggestedNoteId={RESUME_HINT_TEXT_ID} />
    <p className="sdt__rsvp-note">来 = 承诺，没来会被记一笔；待定不算承诺。</p>
    <p className="sdt__rsvp-note">开局前说不来，点名结算不会记你。</p>
    {notice && <p id="session-detail-full" className="sdt__rsvp-full">{notice}</p>}
  </div>;
}

interface OrganizerActionsProps {
  started: boolean;
  canRollCall: boolean;
  busy: boolean;
  /** P2-1: set only when the invitable list answered (ready or failed); absent → no 再叫几个人. */
  onInvite?: () => void;
  onReschedule: () => void;
  onRollCall: () => void;
  onCancel: () => Promise<boolean>;
}

/** The organizer's (or an admin's) controls on an open session; 取消这局 comes last. */
function OrganizerActions({
  started,
  canRollCall,
  busy,
  onInvite,
  onReschedule,
  onRollCall,
  onCancel,
}: OrganizerActionsProps): JSX.Element {
  return (
    <div className="sdt__actions">
      {!started && onInvite && (
        <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={onInvite}>
          <span aria-hidden="true">＋ </span>再叫几个人
        </button>
      )}
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
