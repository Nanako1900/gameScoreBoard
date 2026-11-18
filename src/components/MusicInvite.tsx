import { useState } from 'react';
import type { MusicView } from '@shared/music';
import { musicApi } from '../music-api';
import type { FailHandler } from './useMusicView';

interface MusicInviteProps {
  roomRef: string;
  view: MusicView;
  applyView: (view: MusicView) => void;
  fail: FailHandler;
}

/** Why the invite button is off, in the order a member should care about. */
function blockedReason(view: MusicView): string | null {
  if (!view.bot.online) return 'Music 机器人离线';
  if (view.bot.busyElsewhere) return 'Music 正在其他房间使用，稍后再试';
  if (!view.canInvite) return view.inviteBlocked ?? '暂时不能邀请 Music 进房';
  return null;
}

export function MusicConnecting(): JSX.Element {
  return (
    <section className="community-card music-invite" aria-busy="true">
      <h2>等待 Music 进入语音房</h2>
      <p role="status">Music 正在进房…</p>
      <p className="community-muted">通常几秒钟内完成，最长等待 30 秒。</p>
    </section>
  );
}

export function MusicInvite({ roomRef, view, applyView, fail }: MusicInviteProps): JSX.Element {
  const [useMyAccount, setUseMyAccount] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reason = blockedReason(view);
  const hasAccount = view.myAccount !== null;

  const invite = async (): Promise<void> => {
    if (busy || reason) return;
    setBusy(true);
    setError(null);
    try {
      applyView(await musicApi.invite(roomRef, hasAccount ? useMyAccount : undefined));
    } catch (cause) {
      setError(fail(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="community-card music-invite" aria-labelledby="music-invite-title">
      <h2 id="music-invite-title">让 Music 为这间房播放</h2>
      <p>Music 进房后，房里的每个人都能搜歌、排队和控制播放。</p>
      {reason && <p className="community-notice music-notice-block" role="status">{reason}</p>}
      {hasAccount && (
        <label className="community-choice">
          <input type="checkbox" checked={useMyAccount} onChange={(event) => setUseMyAccount(event.target.checked)} />
          <span>同时使用我的网易云账号</span>
        </label>
      )}
      {error && <p className="community-error" role="alert">{error}</p>}
      <button type="button" className="community-button" disabled={busy || reason !== null} onClick={() => void invite()}>
        {busy ? '正在邀请…' : '邀请 Music 进房'}
      </button>
    </section>
  );
}
