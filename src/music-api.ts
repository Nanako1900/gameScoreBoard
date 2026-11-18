import type {
  MusicMode,
  MusicProxyView,
  MusicQrStatus,
  MusicTrack,
  MusicView,
  MusicAccountView,
} from '@shared/music';
import { communityRequest } from './community-api';

const MUSIC = '/api/community/music';
const ADMIN_PROXY = '/api/admin/community/music/proxy';

export type MusicCommand =
  | { kind: 'enqueue'; tracks: MusicTrack[] }
  | { kind: 'remove' | 'move_next'; key: string }
  | { kind: 'seek'; positionMs: number }
  | { kind: 'volume'; volume: number }
  | { kind: 'mode'; mode: MusicMode }
  | { kind: 'clear' | 'play' | 'pause' | 'skip' | 'leave' };

export interface MusicQrStart {
  key: string;
  url: string;
}

export interface MusicQrCheck {
  status: MusicQrStatus;
  account?: MusicAccountView;
}

export interface MusicPlaylist {
  name: string;
  tracks: MusicTrack[];
}

export interface MusicProxyTest {
  ok: boolean;
  message: string;
}

const requestKey = (): string => crypto.randomUUID();
const post = <T>(path: string, body: Record<string, unknown>): Promise<T> =>
  communityRequest<T>(path, { ...body, requestKey: requestKey() });
const room = (roomRef: string): string => `${MUSIC}/${encodeURIComponent(roomRef)}`;

export const musicApi = {
  view: (roomRef: string, signal?: AbortSignal) => communityRequest<MusicView>(room(roomRef), undefined, signal),
  invite: (roomRef: string, useMyAccount?: boolean) =>
    post<MusicView>(`${room(roomRef)}/invite`, useMyAccount === undefined ? {} : { useMyAccount }),
  command: (roomRef: string, command: MusicCommand) =>
    post<{ accepted: true }>(`${room(roomRef)}/commands`, { ...command }),
  account: (roomRef: string, action: 'use' | 'stop') => post<MusicView>(`${room(roomRef)}/account`, { action }),
  search: (query: string, signal?: AbortSignal) =>
    communityRequest<{ tracks: MusicTrack[] }>(`${MUSIC}/search?q=${encodeURIComponent(query)}`, undefined, signal),
  playlist: (link: string, signal?: AbortSignal) =>
    communityRequest<MusicPlaylist>(`${MUSIC}/playlist?link=${encodeURIComponent(link)}`, undefined, signal),
  startQr: () => post<MusicQrStart>(`${MUSIC}/login/qr`, {}),
  qrStatus: (key: string, signal?: AbortSignal) =>
    communityRequest<MusicQrCheck>(`${MUSIC}/login/qr/${encodeURIComponent(key)}`, undefined, signal),
  logout: () => post<{ ok: true }>(`${MUSIC}/logout`, {}),
  proxy: (signal?: AbortSignal) => communityRequest<MusicProxyView>(ADMIN_PROXY, undefined, signal),
  /** `url` undefined keeps the saved address; null clears it. */
  saveProxy: (url: string | null | undefined, audio: boolean) =>
    post<MusicProxyView>(ADMIN_PROXY, url === undefined ? { audio } : { url, audio }),
  testProxy: () => post<MusicProxyTest>(`${ADMIN_PROXY}/test`, {}),
};
