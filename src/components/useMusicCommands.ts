import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api';
import { musicApi, type MusicCommand } from '../music-api';
import type { FailHandler } from './useMusicView';

/** A command is only acknowledged (202); the page waits this long for a new session version. */
export const COMMAND_SETTLE_MS = 5000;
/** How long a failure reported by a poll stays on screen. */
export const COMMAND_ERROR_SHOWN_MS = 8000;
/** Polls answering with an unchanged version after which a command is taken to have changed nothing. */
const UNCHANGED_POLLS_TO_SETTLE = 2;

export interface MusicCommands {
  /** Resolves true when the server accepted the command; the effect is not yet confirmed. */
  send: (controlId: string, command: MusicCommand) => Promise<boolean>;
  isPending: (controlId: string) => boolean;
  /** True while a command is pending, and for good while the bot is offline. */
  busy: boolean;
  error: string | null;
}

/** What the latest polled view tells the commands about their own fate. */
export interface CommandFeed {
  version: number | null;
  /** Counts accepted views, so a poll answering is distinguishable from a re-render. */
  seq: number;
  lastError: { id: string; message: string } | null;
  offline: boolean;
}

interface Pending {
  id: string;
  version: number | null;
  /** The view count when the server accepted the command; null until then. */
  acceptedAtSeq: number | null;
}

export function useMusicCommands(
  roomRef: string,
  feed: CommandFeed,
  fail: FailHandler,
  reload: () => void,
): MusicCommands {
  const { version, seq, lastError, offline } = feed;
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shownErrorId = useRef<string | null>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout>>();
  const latestSeq = useRef(seq);
  latestSeq.current = seq;

  useEffect(() => () => clearTimeout(errorTimer.current), []);

  useEffect(() => {
    if (!pending) return;
    const answered = pending.acceptedAtSeq !== null && seq - pending.acceptedAtSeq >= UNCHANGED_POLLS_TO_SETTLE;
    if (version !== pending.version || answered) setPending(null);
  }, [pending, version, seq]);

  useEffect(() => {
    if (!pending) return undefined;
    const timer = setTimeout(() => setPending(null), COMMAND_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [pending]);

  useEffect(() => {
    if (!lastError || lastError.id === shownErrorId.current) return;
    shownErrorId.current = lastError.id;
    setPending(null);
    setError(lastError.message);
    clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setError(null), COMMAND_ERROR_SHOWN_MS);
  }, [lastError]);

  const send = useCallback(
    async (controlId: string, command: MusicCommand): Promise<boolean> => {
      if (pending || offline) return false;
      setPending({ id: controlId, version, acceptedAtSeq: null });
      clearTimeout(errorTimer.current);
      setError(null);
      try {
        await musicApi.command(roomRef, command);
        setPending((current) => (current ? { ...current, acceptedAtSeq: latestSeq.current } : current));
        reload();
        return true;
      } catch (cause) {
        setPending(null);
        setError(fail(cause));
        if (cause instanceof ApiError && cause.status === 409) reload();
        return false;
      }
    },
    [pending, offline, version, roomRef, fail, reload],
  );

  const isPending = useCallback((controlId: string) => pending?.id === controlId, [pending]);
  return { send, isPending, busy: pending !== null || offline, error };
}
