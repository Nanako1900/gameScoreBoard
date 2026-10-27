// P2-1: the rules behind 再叫几个人 (InviteSheet). Pure — tests/unit imports it.

import { MAX_INVITES, type Rsvp } from '@shared/attendance';
import type { InvitableUser, SessionPlayer } from '../types';

/** in = already in the session (invited / going / maybe); out = said 不来. Both are left alone (spec §3.5). */
export type InviteRowState = 'free' | 'in' | 'out';

export interface InviteRow {
  user: InvitableUser;
  state: InviteRowState;
}

/** 在榜的 / 其他朋友（未上榜）, each in the server's order (played with first, then by name). */
export interface InviteGroups {
  onBoard: InviteRow[];
  others: InviteRow[];
}

function rowState(rsvp: Rsvp | undefined): InviteRowState {
  if (rsvp === undefined) return 'free';
  return rsvp === 'out' ? 'out' : 'in';
}

export function inviteGroups(users: readonly InvitableUser[], players: readonly SessionPlayer[]): InviteGroups {
  const rsvpById = new Map<string, Rsvp>(players.map((p) => [p.user.id, p.rsvp]));
  const rows = users.map((user): InviteRow => ({ user, state: rowState(rsvpById.get(user.id)) }));
  return {
    onBoard: rows.filter((r) => r.user.is_participant),
    others: rows.filter((r) => !r.user.is_participant),
  };
}

/** Adds or removes `id`; never past `max` (MAX_INVITES); returns a new array. */
export function toggleInvite(selected: readonly string[], id: string, max: number = MAX_INVITES): string[] {
  if (selected.includes(id)) return selected.filter((x) => x !== id);
  return selected.length >= max ? [...selected] : [...selected, id];
}

/** The toast after POST …/invite (P2 contract 4.6; spec §3.5 without the copy-link button, which is P3-3). */
export function inviteToast(added: number): string {
  return added > 0
    ? `已叫 ${added} 人。没绑 Discord 的朋友，记得在群里喊一声。`
    : '没有叫到新的人：选的人已经在局里了。';
}

// --- P3-3 ---
export interface PickerGroups extends InviteGroups { recent: InviteRow[] }
/** Recent partners keep the server order; everyone appears in exactly one group. */
export function pickerGroups(users: readonly InvitableUser[], players: readonly SessionPlayer[], query = ''): PickerGroups {
  const needle = query.trim().toLocaleLowerCase();
  const matches = users.filter((u) => u.username.toLocaleLowerCase().includes(needle));
  const rsvpById = new Map<string, Rsvp>(players.map((p) => [p.user.id, p.rsvp]));
  const recent = matches.filter((u) => u.last_played_with_me_at !== null)
    .map((user) => ({ user, state: rowState(rsvpById.get(user.id)) }));
  return { recent, ...inviteGroups(matches.filter((u) => u.last_played_with_me_at === null), players) };
}
export function lastLineup(users: readonly InvitableUser[]): string[] {
  const latest = users.reduce<string | null>((at, u) => u.last_played_with_me_at !== null
    && (at === null || u.last_played_with_me_at > at) ? u.last_played_with_me_at : at, null);
  return latest === null ? [] : users.filter((u) => u.last_played_with_me_at === latest).slice(0, MAX_INVITES).map((u) => u.id);
}
export function pickLineup(selected: readonly string[], lineup: readonly string[], freeIds: readonly string[], max = MAX_INVITES): string[] {
  const free = new Set(freeIds);
  return [...new Set([...selected, ...lineup.filter((id) => free.has(id))])].slice(0, max);
}
