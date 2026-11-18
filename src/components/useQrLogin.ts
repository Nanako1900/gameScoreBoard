import { useCallback, useEffect, useRef, useState } from 'react';
import type { MusicAccountView, MusicQrStatus } from '@shared/music';
import { musicApi } from '../music-api';
import type { FailHandler } from './useMusicView';

export const QR_POLL_MS = 2000;

export interface QrLogin {
  key: string;
  url: string;
  status: MusicQrStatus;
  account?: MusicAccountView;
}

export interface QrLoginHandle {
  qr: QrLogin | null;
  starting: boolean;
  error: string | null;
  start: () => Promise<void>;
  reset: () => void;
}

const isLive = (qr: QrLogin | null): boolean => qr !== null && (qr.status === 'waiting' || qr.status === 'scanned');

/** Fetches a login QR and follows it every 2 s until it is done, expired or the page unmounts. */
export function useQrLogin(fail: FailHandler, onDone: () => void): QrLoginHandle {
  const [qr, setQr] = useState<QrLogin | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = useRef(onDone);
  done.current = onDone;
  const failure = useRef(fail);
  failure.current = fail;

  const start = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      const created = await musicApi.startQr();
      setQr({ key: created.key, url: created.url, status: 'waiting' });
    } catch (cause) {
      setError(failure.current(cause, { notFoundIsGone: false }));
    } finally {
      setStarting(false);
    }
  }, []);

  const key = qr?.key;
  const live = isLive(qr);
  useEffect(() => {
    if (!key || !live) return undefined;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async (): Promise<void> => {
      try {
        const result = await musicApi.qrStatus(key, abort.signal);
        if (abort.signal.aborted) return;
        setQr((prev) => {
          if (!prev || prev.key !== key) return prev;
          if (prev.status === result.status && !result.account) return prev;
          return { ...prev, status: result.status, account: result.account };
        });
        if (result.status === 'done') done.current();
        if (result.status === 'done' || result.status === 'expired') return;
      } catch (cause) {
        if (abort.signal.aborted) return;
        setError(failure.current(cause, { notFoundIsGone: false }));
      }
      timer = setTimeout(() => void check(), QR_POLL_MS);
    };
    timer = setTimeout(() => void check(), QR_POLL_MS);
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [key, live]);

  const reset = useCallback(() => {
    setQr(null);
    setError(null);
  }, []);

  return { qr, starting, error, start, reset };
}
