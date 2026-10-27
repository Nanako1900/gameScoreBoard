import { useState } from 'react';
import { isSelfRsvp, type SelfRsvp } from '@shared/attendance';
import { ApiError, setRsvp } from '../api';
import type { SessionItem } from '../types';
import { useToast } from '../components/Toast';
import { rsvpFeedback } from './sessionActions';
import { useUndo } from './useUndo';

interface RsvpOptions { reload: () => Promise<void>; onAnswered?: () => void }

export function useRsvpAnswer({ reload, onAnswered }: RsvpOptions) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const offerUndo = useUndo();
  const answer = async (session: SessionItem, next: SelfRsvp): Promise<void> => {
    const { id, starts_at: startsAt, my_rsvp: prev } = session;
    setBusyId(id);
    try {
      await setRsvp(id, next, startsAt);
      setError(null);
      onAnswered?.();
      const feedback = rsvpFeedback(prev, next);
      if (!feedback) return;
      if (feedback.undoable && prev !== null && isSelfRsvp(prev)) {
        offerUndo({ message: feedback.message, undo: () => setRsvp(id, prev, startsAt),
          onUndone: () => { void reload(); onAnswered?.(); } });
      } else toast.show({ message: feedback.message, tone: 'ok' });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) await reload();
      setError(err instanceof ApiError ? err.message : '报名失败');
    } finally { setBusyId(null); }
  };
  return { busyId, error, answer };
}
