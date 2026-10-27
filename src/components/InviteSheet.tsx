import { useState } from 'react';
import { INVITES_PER_ORGANIZER, MAX_INVITES } from '@shared/attendance';
import type { InviteResponse, SessionDetail } from '../types';
import { ApiError, inviteToSession } from '../api';
import { pickerGroups, lastLineup, pickLineup, toggleInvite } from '../lib/invitePicker';
import type { Invitable, InvitableState } from '../lib/useInvitable';
import { PeoplePicker } from './PeoplePicker';
import { Modal } from './Modal';
import './invite-sheet.css';

interface InviteSheetProps {
  session: SessionDetail;
  invitable: Invitable;
  onClose: () => void;
  onInvited: (result: InviteResponse) => void;
}

const TITLE_ID = 'invite-sheet-title';
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
 * 再叫几个人 — the full picker over session detail (spec §3.5).
 * Search and last-lineup selection share PeoplePicker. Rows already in the session
 * are greyed out: POST …/invite never changes them anyway. No scores, no
 * Discord status: only what the rules are (spec §4.3).
 */
export function InviteSheet({ session, invitable, onClose, onInvited }: InviteSheetProps): JSX.Element {
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [query, setQuery] = useState('');
  const { error, busy, send } = useSendInvites(session.id, onInvited);
  const { state, reload } = invitable;
  const count = selected.length;

  return (
    <Modal open onClose={onClose} labelledBy={TITLE_ID} variant="sheet" title="再叫几个人" historyKey="invite">
      <div className="ivs">
        <ListStatus state={state} onRetry={reload} />
        {state.kind === 'ready' && (
          <PeoplePicker
            groups={pickerGroups(state.users, session.players, query)}
            selected={selected}
            max={MAX_INVITES}
            busy={busy}
            onToggle={(id) => setSelected((prev) => toggleInvite(prev, id))}
            search={state.users.length ? { value: query, onChange: setQuery } : undefined}
            lineup={{ ids: lastLineup(state.users), onPick: () => setSelected((prev) => pickLineup(prev, lastLineup(state.users),
              Object.values(pickerGroups(state.users, session.players)).flat().filter((r) => r.state === 'free').map((r) => r.user.id))) }}
          />
        )}
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
