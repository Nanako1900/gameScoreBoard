import { useState } from 'react';
import { INVITES_PER_ORGANIZER, MAX_INVITES } from '@shared/attendance';
import type { InviteResponse, SessionDetail } from '../types';
import { ApiError, inviteToSession } from '../api';
import { inviteGroups, toggleInvite, type InviteRow } from '../lib/invitePicker';
import type { Invitable, InvitableState } from '../lib/useInvitable';
import { Avatar } from './Avatar';
import { Modal } from './Modal';
import './invite-sheet.css';

interface InviteSheetProps {
  session: SessionDetail;
  invitable: Invitable;
  onClose: () => void;
  onInvited: (result: InviteResponse) => void;
}

const TITLE_ID = 'invite-sheet-title';
const ROW_TAG: Record<Exclude<InviteRow['state'], 'free'>, string> = {
  in: '已在局里',
  out: '说了不来',
};

interface SendInvites {
  error: string | null;
  busy: boolean;
  send: (userIds: readonly string[]) => Promise<void>;
}

/** One POST …/invite; on failure the sheet stays open with the server's reason. */
function useSendInvites(sessionId: number, onInvited: (result: InviteResponse) => void): SendInvites {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async (userIds: readonly string[]): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      onInvited(await inviteToSession(sessionId, [...userIds]));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '操作失败');
      setBusy(false);
    }
  };
  return { error, busy, send };
}

/**
 * 再叫几个人 — the minimal P2-1 sheet over the session detail (spec §3.5; the
 * full one, with search and 和上次一样, is P3-3). Rows already in the session
 * are greyed out: POST …/invite never changes them anyway. No scores, no
 * Discord status: only what the rules are (spec §4.3).
 */
export function InviteSheet({ session, invitable, onClose, onInvited }: InviteSheetProps): JSX.Element {
  const [selected, setSelected] = useState<readonly string[]>([]);
  const { error, busy, send } = useSendInvites(session.id, onInvited);
  const { state, reload } = invitable;
  const full = selected.length >= MAX_INVITES;
  const count = selected.length;

  return (
    <Modal open onClose={onClose} labelledBy={TITLE_ID} variant="sheet" title="再叫几个人" historyKey="invite">
      <div className="ivs">
        <ListStatus state={state} onRetry={reload} />
        {state.kind === 'ready' && (
          <PeoplePicker
            groups={inviteGroups(state.users, session.players)}
            selected={selected}
            full={full}
            busy={busy}
            onToggle={(id) => setSelected((prev) => toggleInvite(prev, id))}
          />
        )}
        {full && <p className="ivs__cap">一次最多叫 {MAX_INVITES} 人</p>}
        <p className="ivs__note">
          绑了 Discord 且开着私信的人会收到 Bot 私信；同一个人一天最多收到你 {INVITES_PER_ORGANIZER} 条邀请私信。
        </p>
        <p className="ivs__note">没绑的人要自己上网页看，把链接发到群里最稳。</p>
        {error && (
          <p className="ivs__error" role="alert">
            {error}
          </p>
        )}
        <div className="ivs__bar">
          <span className="ivs__count tabular">已选 {count} 人</span>
          <button
            type="button"
            className="btn btn--gold"
            disabled={busy || count === 0}
            onClick={() => void send(selected)}
          >
            {busy ? '叫人中…' : count > 0 ? `叫 ${count} 人` : '叫人'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Loading, a failed list (with 重试), or nobody to ask. Never an alert: the dialog behind has none either. */
function ListStatus({ state, onRetry }: { state: InvitableState; onRetry: () => void }): JSX.Element | null {
  if (state.kind === 'loading') {
    return (
      <p className="ivs__status" role="status">
        加载中…
      </p>
    );
  }
  if (state.kind === 'error') {
    return (
      <div className="ivs__status">
        <p role="status">名单没加载出来，稍后再试。</p>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onRetry}>
          重试
        </button>
      </div>
    );
  }
  if (state.kind === 'ready' && state.users.length === 0) {
    return <p className="ivs__status">还没有别的朋友登录过。把链接发到群里，他们登录后就能在这里叫到。</p>;
  }
  return null;
}

interface PeoplePickerProps {
  groups: ReturnType<typeof inviteGroups>;
  selected: readonly string[];
  full: boolean;
  busy: boolean;
  onToggle: (id: string) => void;
}

function PeoplePicker({ groups, selected, full, busy, onToggle }: PeoplePickerProps): JSX.Element {
  const group = (legend: string, rows: InviteRow[]): JSX.Element | null =>
    rows.length === 0 ? null : (
      <fieldset className="ivs__group">
        <legend className="ivs__legend">{legend}</legend>
        {rows.map((row) => (
          <PersonRow
            key={row.user.id}
            row={row}
            checked={selected.includes(row.user.id)}
            locked={busy || (full && !selected.includes(row.user.id))}
            onToggle={onToggle}
          />
        ))}
      </fieldset>
    );
  return (
    <>
      {group('在榜的', groups.onBoard)}
      {group('其他朋友（未上榜，不参与计分）', groups.others)}
    </>
  );
}

interface PersonRowProps {
  row: InviteRow;
  checked: boolean;
  /** Busy, or the list is full and this one is not in it. */
  locked: boolean;
  onToggle: (id: string) => void;
}

/** A checkbox per person: avatar and name only. Already in / said no: disabled, with why. */
function PersonRow({ row, checked, locked, onToggle }: PersonRowProps): JSX.Element {
  const { user, state } = row;
  const off = state !== 'free';
  return (
    <label className={`ivs__row${off ? ' ivs__row--off' : ''}`}>
      <input
        type="checkbox"
        checked={!off && checked}
        disabled={off || locked}
        onChange={() => onToggle(user.id)}
      />
      <Avatar name={user.username} src={user.avatar_url} size={24} />
      <span>{user.username}</span>
      {off && ' '}
      {off && <span className="ivs__tag">· {ROW_TAG[state]}</span>}
    </label>
  );
}
