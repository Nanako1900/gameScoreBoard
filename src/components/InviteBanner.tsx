import { useState } from 'react';
import type { SessionItem } from '../types';
import { ApiError, setRsvp } from '../api';
import { formatDateTime } from '../lib/time';
import { Avatar } from './Avatar';
import './invite-banner.css';

interface InviteBannerProps {
  invites: SessionItem[];
  onAnswered: () => void;
  onOpen: (id: number) => void;
}

/**
 * 邀请横幅 — the one surface that gives people a reason to open the app.
 *
 * Everything else in this product is something you go and do; an invitation is
 * something that arrives. Answering is deliberately two taps from cold: 来 / 不来
 * right here, no navigation.
 */
export function InviteBanner({
  invites,
  onAnswered,
  onOpen,
}: InviteBannerProps): JSX.Element | null {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (invites.length === 0) return null;
  const next = invites[0];

  const answer = async (rsvp: 'going' | 'out'): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await setRsvp(next.id, rsvp);
      onAnswered();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="invite" role="status" aria-live="polite">
      <span className="invite__icon" aria-hidden="true">
        🎮
      </span>
      <div className="invite__text">
        <p className="invite__title">
          <Avatar name={next.organizer.username} src={next.organizer.avatar_url} size={20} />
          <strong>{next.organizer.username}</strong> 约你
          <span className="invite__when tabular">{formatDateTime(next.starts_at)}</span>
          开黑
        </p>
        <p className="invite__sub">
          已有 <span className="tabular">{next.counts.going}</span> 人确认
          {next.counts.invited > 1 && `，还有 ${next.counts.invited - 1} 人没回`}
          {invites.length > 1 && ` · 另外还有 ${invites.length - 1} 个邀请`}
          <button type="button" className="invite__detail" onClick={() => onOpen(next.id)}>
            看详情
          </button>
        </p>
        {error && <p className="invite__error">{error}</p>}
      </div>
      <div className="invite__actions">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={busy}
          onClick={() => void answer('out')}
        >
          不来
        </button>
        <button
          type="button"
          className="btn btn--gold"
          disabled={busy}
          onClick={() => void answer('going')}
        >
          {busy ? '…' : '来'}
        </button>
      </div>
    </section>
  );
}
