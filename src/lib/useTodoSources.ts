import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, getDiscordLink, getRecords } from '../api';
import type { RecordItem, User } from '../types';
import { INBOX_APPEALS_LIMIT } from './constants';
import type { DiscordLinkRead, DiscordLinkValue } from './discordLinkState';

interface Supplemental {
  appealed: RecordItem[] | null;
  discord: DiscordLinkValue;
  settled: boolean;
  discordRead: DiscordLinkRead;
  setDiscord: (value: DiscordLinkValue) => void;
}
interface SourceState {
  ownerId: string | null;
  appealed: RecordItem[] | null;
  discord: DiscordLinkValue;
  settled: boolean;
  discordPending: boolean;
  discordError?: string;
}
const EMPTY: SourceState = { ownerId: null, appealed: null, discord: undefined, settled: true, discordPending: false };

export function useTodoSources({ me, pendingAppeals, refreshKey }: { me: User | null; pendingAppeals: number; refreshKey: number }): Supplemental {
  const [state, setState] = useState<SourceState>(EMPTY);
  const serial = useRef(0);
  const discordVersion = useRef(0);
  const id = me?.id ?? null;
  const currentOwner = useRef(id); currentOwner.current = id;
  const appeals = !!me?.is_admin && pendingAppeals > 0;

  const setDiscord = useCallback((value: DiscordLinkValue): void => {
    if (id === null || currentOwner.current !== id) return;
    discordVersion.current += 1;
    setState((old) => old.ownerId === id
      ? { ...old, discord: value, discordPending: false, discordError: undefined }
      : { ...EMPTY, ownerId: id, discord: value, settled: false });
  }, [id]);

  useEffect(() => {
    const turn = ++serial.current;
    const version = discordVersion.current;
    if (id === null) { setState(EMPTY); return; }
    setState({ ...EMPTY, ownerId: id, settled: false, discordPending: true });
    void Promise.allSettled([
      appeals ? getRecords({ status: 'appealed', limit: INBOX_APPEALS_LIMIT }).then((result) => result.records) : null,
      getDiscordLink(),
    ]).then(([records, discord]) => {
      if (serial.current !== turn) return;
      setState((old) => {
        const newer = discordVersion.current !== version;
        return { ownerId: id,
          appealed: records.status === 'fulfilled' ? records.value : null,
          discord: newer ? old.discord : discord.status === 'fulfilled' ? discord.value : 'error',
          discordError: newer ? old.discordError : discord.status === 'rejected'
            ? discord.reason instanceof ApiError ? discord.reason.message : '读取 Discord 绑定失败'
            : undefined,
          discordPending: false, settled: true };
      });
    });
    return () => { serial.current += 1; };
  }, [id, refreshKey, appeals]);

  const visible = id === null ? EMPTY : state.ownerId === id ? state : { ...EMPTY, settled: false, discordPending: true };
  return { appealed: visible.appealed, discord: visible.discord, settled: visible.settled,
    discordRead: { value: visible.discord, loading: visible.discordPending, error: visible.discordError }, setDiscord };
}
