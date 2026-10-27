import { useMemo, useState } from 'react';
import { quickSlots } from '@shared/quickTime';
import type { PublicUser, SessionDetail } from '../types';
import { ApiError, createSession } from '../api';
import { CUSTOM_TIME_LEAD_MS } from '../lib/constants';
import { isSessionDraftEmpty, validateSessionDraft, type SessionDraftValue } from '../lib/draftShapes';
import { toDateTimeLocalValue } from '../lib/time';
import { useDraft } from '../lib/useDraft';
import { useLeaveGuard } from '../lib/useLeaveGuard';
import { ConfirmInline } from './ConfirmInline';
import { DraftNote } from './DraftNote';
import { Modal } from './Modal';
import { Avatar } from './Avatar';
import './session-form.css';

interface SessionFormDialogProps {
  open: boolean;
  participants: PublicUser[];
  selfId: string | null;
  onClose: () => void;
  onCreated: (session: SessionDetail) => void;
}

const EMPTY_SESSION: SessionDraftValue = { invite: [], custom: '', chosen: null };

/**
 * 约一局 — v3: two decisions, time and people.
 *
 * Title, game, duration and capacity are gone from the form. The title is
 * synthesised server-side from the start time, and the rest stay as optional
 * columns editable later via PATCH. Every field removed here is a field nobody
 * has to think about at the moment they just want to play tonight.
 */
export function SessionFormDialog({
  open,
  participants,
  selfId,
  onClose,
  onCreated,
}: SessionFormDialogProps): JSX.Element {
  // Computed once per open: the chips must not shift under the user's finger.
  const slots = useMemo(() => quickSlots(), [open]);
  const invitable = useMemo(
    () => participants.filter((p) => p.id !== selfId),
    [participants, selfId],
  );

  // Who to call (and the time picked) is a local draft until the session exists (spec §5 #4).
  const draft = useDraft<SessionDraftValue>('session', undefined, EMPTY_SESSION, {
    validate: (raw) => validateSessionDraft(raw, invitable.map((p) => p.id), slots.map((s) => s.iso)),
    isEmpty: isSessionDraftEmpty,
  });
  const { invite, custom } = draft.value;
  // A restored slot that has since passed was dropped by the validator: fall back to the first one.
  const chosen = draft.value.chosen ?? slots[0]?.iso ?? '';
  // `chosen: null` with a custom time means 其他时间 was the one in use (toggleCustom keeps it so).
  const [customOpen, setCustomOpen] = useState(() => draft.value.chosen === null && custom !== '');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const guard = useLeaveGuard(draft.dirty, onClose);

  const setChosen = (iso: string): void => draft.setValue((prev) => ({ ...prev, chosen: iso }));
  const setCustom = (value: string): void => draft.setValue((prev) => ({ ...prev, custom: value }));
  // Opening 其他时间 drops the slot, closing it goes back to the slot on screen:
  // the draft then always says which of the two the user was on.
  const toggleCustom = (): void => {
    const opening = !customOpen;
    setCustomOpen(opening);
    draft.setValue((prev) => ({
      ...prev,
      chosen: opening ? null : chosen || null,
      custom: opening && prev.custom === '' ? toDateTimeLocalValue(Date.now() + CUSTOM_TIME_LEAD_MS) : prev.custom,
    }));
  };
  const toggleInvite = (id: string): void => {
    draft.setValue((prev) => ({
      ...prev,
      invite: prev.invite.includes(id) ? prev.invite.filter((p) => p !== id) : [...prev.invite, id],
    }));
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);

    let startsAt: string;
    if (customOpen && custom) {
      const ms = Date.parse(custom);
      if (!Number.isFinite(ms)) {
        setError('时间格式不对');
        return;
      }
      // `datetime-local` carries no zone; Date.parse reads it as local, which is
      // what the organizer meant. Send UTC so the server stores one truth.
      startsAt = new Date(ms).toISOString();
    } else if (chosen) {
      startsAt = chosen;
    } else {
      setError('选一个时间');
      return;
    }

    setSubmitting(true);
    try {
      const { session } = await createSession({ starts_at: startsAt, invite });
      draft.clear();
      onCreated(session);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '创建失败，请稍后重试');
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={guard.requestClose} labelledBy="session-form-title" size="md" dismissible={!draft.dirty}>
      <h2 id="session-form-title" className="sf__title">
        约一局
      </h2>
      <p className="sf__subtitle">选个时间、勾几个人，就完事了。</p>

      <form className="sf__form" onSubmit={handleSubmit}>
        <fieldset className="sf__field">
          <legend className="sf__label">什么时候？</legend>
          <div className="sf__slots">
            {slots.map((s) => (
              <label
                key={s.iso}
                className={`sf-slot${!customOpen && chosen === s.iso ? ' sf-slot--on' : ''}`}
              >
                <input
                  type="radio"
                  name="quick-slot"
                  className="visually-hidden"
                  checked={!customOpen && chosen === s.iso}
                  onChange={() => {
                    setChosen(s.iso);
                    setCustomOpen(false);
                  }}
                />
                {s.label}
              </label>
            ))}
            <button
              type="button"
              className={`sf-slot sf-slot--custom${customOpen ? ' sf-slot--on' : ''}`}
              aria-expanded={customOpen}
              onClick={toggleCustom}
            >
              其他时间 {customOpen ? '▾' : '▸'}
            </button>
          </div>
          {customOpen && (
            <input
              className="sf__input sf__input--custom"
              type="datetime-local"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              aria-label="自定义开始时间"
            />
          )}
        </fieldset>

        <fieldset className="sf__field">
          <legend className="sf__label">
            叫谁？
            {invite.length > 0 && <span className="sf__count tabular">已选 {invite.length}</span>}
          </legend>
          {invitable.length === 0 ? (
            <span className="sf__hint">还没有其他选手可以邀请。</span>
          ) : (
            <div className="sf__people">
              {invitable.map((p) => {
                const on = invite.includes(p.id);
                return (
                  <label key={p.id} className={`sf-person${on ? ' sf-person--on' : ''}`}>
                    <input
                      type="checkbox"
                      className="visually-hidden"
                      checked={on}
                      onChange={() => toggleInvite(p.id)}
                    />
                    <Avatar name={p.username} src={p.avatar_url} size={24} />
                    <span className="sf-person__name">{p.username}</span>
                  </label>
                );
              })}
            </div>
          )}
          <span className="sf__hint">
            被叫的人会在首页看到邀请，一键回「来 / 不来」。不勾也行，别人自己也能报名。
          </span>
        </fieldset>

        <DraftNote savedAt={draft.savedAt} />

        {error && (
          <p className="sf__error" role="alert">
            {error}
          </p>
        )}

        {guard.confirmingLeave ? (
          <ConfirmInline
            question={`这局还没约，已选的 ${invite.length} 个人会留在这台设备上。`}
            cancelLabel="继续编辑"
            confirmLabel="先离开"
            onCancel={guard.stay}
            onConfirm={guard.confirmLeave}
            tone="primary"
            focus="cancel"
          />
        ) : (
          <div className="sf__actions">
            <button ref={guard.triggerRef} type="button" className="btn btn--ghost" onClick={guard.requestClose}>
              取消
            </button>
            <button type="submit" className="btn btn--gold" disabled={submitting}>
              {submitting ? '创建中…' : invite.length > 0 ? `约！（叫 ${invite.length} 人）` : '约！'}
            </button>
          </div>
        )}
      </form>
    </Modal>
  );
}
