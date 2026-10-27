import { useCallback, useEffect, useRef, useState } from 'react';
import { getSessions } from '../api';
import type { SessionItem, User } from '../types';
import { patchSession } from './lobbySessions';
import { onSession } from './sessionEvents';

interface LobbyOptions { enabled: boolean; me: User | null; refreshKey: number }
interface LobbyState { upcoming: SessionItem[]; mine: SessionItem[] | null; loading: boolean; failed: boolean }
export interface LobbySessions extends LobbyState { reload: () => Promise<void> }

export function useLobbySessions({ enabled, me, refreshKey }: LobbyOptions): LobbySessions {
  const [state, setState] = useState<LobbyState>({ upcoming: [], mine: null, loading: enabled, failed: false });
  const mounted = useRef(false);
  const request = useRef(0);
  const meId = me?.id;
  const reload = useCallback(async (): Promise<void> => {
    if (!enabled) return;
    const serial = ++request.current;
    setState((old) => ({ ...old, loading: true }));
    const [upcoming, mine] = await Promise.allSettled([getSessions('upcoming'), meId ? getSessions('mine') : null]);
    if (!mounted.current || serial !== request.current) return;
    setState((old) => ({
      upcoming: upcoming.status === 'fulfilled' ? upcoming.value.sessions : old.upcoming,
      mine: !meId ? null : mine.status === 'fulfilled' ? mine.value?.sessions ?? null : old.mine,
      loading: false,
      failed: upcoming.status === 'rejected',
    }));
  }, [enabled, meId]);
  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => { mounted.current = false; request.current += 1; };
  }, [reload, refreshKey]);
  useEffect(() => { setState((old) => ({ ...old, mine: null })); }, [meId]);
  useEffect(() => onSession((session) => {
    if (!enabled) return;
    setState((old) => ({ ...old, upcoming: patchSession(old.upcoming, session),
      mine: old.mine === null ? null : patchSession(old.mine, session) }));
  }), [enabled]);
  return { ...state, reload };
}
