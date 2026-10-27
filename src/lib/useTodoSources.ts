import { useEffect, useRef, useState } from 'react';
import { getDiscordLink, getRecords } from '../api';
import type { RecordItem, User } from '../types';
import { INBOX_APPEALS_LIMIT } from './constants';
import type { TodoSources } from './todo';
interface Supplemental { appealed: RecordItem[] | null; discord: TodoSources['discord']; settled: boolean }
const EMPTY: Supplemental = { appealed: null, discord: undefined, settled: true };
export function useTodoSources({ me, pendingAppeals, refreshKey }: { me: User | null; pendingAppeals: number; refreshKey: number }): Supplemental {
  const [state, setState] = useState<Supplemental & { ownerId: string | null }>({ ...EMPTY, ownerId: null });
  const serial = useRef(0);
  const id = me?.id ?? null;
  const appeals = !!me?.is_admin && pendingAppeals > 0;
  useEffect(() => {
    const turn = ++serial.current;
    if (id === null) { setState({ ...EMPTY, ownerId: null }); return; }
    setState({ ...EMPTY, ownerId: id, settled: false });
    void Promise.allSettled([appeals ? getRecords({ status: 'appealed', limit: INBOX_APPEALS_LIMIT }).then((r) => r.records) : null, getDiscordLink()])
      .then(([records, discord]) => {
        if (serial.current !== turn) return;
        setState({ ownerId: id, appealed: records.status === 'fulfilled' ? records.value : null,
          discord: discord.status === 'fulfilled' ? discord.value : 'error', settled: true });
      });
    return () => { serial.current += 1; };
  }, [id, refreshKey, appeals]);
  return id === null ? EMPTY : state.ownerId === id ? state : { ...EMPTY, settled: false };
}
