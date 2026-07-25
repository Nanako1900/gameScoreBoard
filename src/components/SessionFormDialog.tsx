import { useState } from 'react';
import { SESSION_GAME_MAX, SESSION_NOTE_MAX, SESSION_TITLE_MAX } from '@shared/attendance';
import type { SessionDetail } from '../types';
import { ApiError, createSession } from '../api';
import { toDateTimeLocalValue } from '../lib/time';
import { Modal } from './Modal';
import './session-form.css';

interface SessionFormDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (session: SessionDetail) => void;
}

/** Default proposal: tonight at 20:00, or tomorrow if it's already past. */
function defaultStart(): string {
  const d = new Date();
  d.setHours(20, 0, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return toDateTimeLocalValue(d.getTime());
}

export function SessionFormDialog({
  open,
  onClose,
  onCreated,
}: SessionFormDialogProps): JSX.Element {
  const [title, setTitle] = useState('');
  const [game, setGame] = useState('');
  const [startsAt, setStartsAt] = useState(defaultStart);
  const [duration, setDuration] = useState('120');
  const [capacity, setCapacity] = useState('5');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const close = (): void => {
    setTitle('');
    setGame('');
    setStartsAt(defaultStart());
    setDuration('120');
    setCapacity('5');
    setNote('');
    setError(null);
    setSubmitting(false);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (title.trim().length === 0) {
      setError('给这一局起个名字');
      return;
    }
    const ms = Date.parse(startsAt);
    if (!Number.isFinite(ms)) {
      setError('开始时间格式不对');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const { session } = await createSession({
        title: title.trim(),
        game: game.trim() || undefined,
        // datetime-local has no zone; Date.parse reads it as local, which is
        // what the organizer meant. Send UTC so the server stores one truth.
        starts_at: new Date(ms).toISOString(),
        duration_min: duration ? Number(duration) : undefined,
        capacity: capacity ? Number(capacity) : undefined,
        note: note.trim() || undefined,
      });
      onCreated(session);
      close();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '创建失败，请稍后重试');
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={close} labelledBy="session-form-title" size="md">
      <h2 id="session-form-title" className="sf__title">
        组一局
      </h2>
      <p className="sf__subtitle">开局后可以点名记录出勤，扣不扣分由你决定。</p>

      <form className="sf__form" onSubmit={handleSubmit}>
        <label className="sf__field">
          <span className="sf__label">标题</span>
          <input
            className="sf__input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={SESSION_TITLE_MAX}
            placeholder="周五晚五排"
            data-autofocus
            required
          />
        </label>

        <div className="sf__row">
          <label className="sf__field">
            <span className="sf__label">游戏（可选）</span>
            <input
              className="sf__input"
              value={game}
              onChange={(e) => setGame(e.target.value)}
              maxLength={SESSION_GAME_MAX}
              placeholder="王者荣耀"
            />
          </label>

          <label className="sf__field">
            <span className="sf__label">开始时间</span>
            <input
              className="sf__input"
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              required
            />
          </label>
        </div>

        <div className="sf__row">
          <label className="sf__field">
            <span className="sf__label">时长（分钟）</span>
            <input
              className="sf__input tabular"
              type="number"
              min={15}
              max={1440}
              step={15}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </label>

          <label className="sf__field">
            <span className="sf__label">人数上限</span>
            <input
              className="sf__input tabular"
              type="number"
              min={2}
              max={50}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
          </label>
        </div>

        <label className="sf__field">
          <span className="sf__label">备注（可选）</span>
          <textarea
            className="sf__textarea"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={SESSION_NOTE_MAX}
            placeholder="上分局，认真打；迟到超过 15 分钟自己看着办"
          />
        </label>

        {error && (
          <p className="sf__error" role="alert">
            {error}
          </p>
        )}

        <div className="sf__actions">
          <button type="button" className="btn btn--ghost" onClick={close}>
            取消
          </button>
          <button type="submit" className="btn btn--gold" disabled={submitting}>
            {submitting ? '创建中…' : '发起约局'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
