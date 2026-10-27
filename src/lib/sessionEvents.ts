import type { SessionDetail } from '../types';

export const SESSION_EVENT = 'edg:session';

export function emitSession(session: SessionDetail): void {
  window.dispatchEvent(new CustomEvent<SessionDetail>(SESSION_EVENT, { detail: session }));
}

export function onSession(listener: (session: SessionDetail) => void): () => void {
  const receive = (event: Event): void => listener((event as CustomEvent<SessionDetail>).detail);
  window.addEventListener(SESSION_EVENT, receive);
  return () => window.removeEventListener(SESSION_EVENT, receive);
}
