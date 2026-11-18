import { useState } from 'react';
import type { MusicAccountView, MusicView } from '@shared/music';
import { formatExpiry } from '../lib/musicFormat';
import { musicApi } from '../music-api';
import { QrCode } from './QrCode';
import { useQrLogin, type QrLogin } from './useQrLogin';
import type { FailHandler } from './useMusicView';

export const MUSIC_CONSENT_TEXT =
  '这是网易云的非官方接入，账号存在被风控的可能，请自行决定是否登录。登录态加密保存 30 天，可随时在此退出；带入房间后，房内成员可用它播放歌曲，并能看到你的网易云昵称，但看不到其他账号资料。';

interface MusicLoginProps {
  roomRef: string;
  view: MusicView;
  reload: () => void;
  applyView: (view: MusicView) => void;
  fail: FailHandler;
}

function AccountCard({ account }: { account: MusicAccountView }): JSX.Element {
  return (
    <div className="music-account">
      <strong>{account.nickname}</strong>
      {account.vip && <span className="community-pill">会员</span>}
      <span className="community-muted">有效期至 {formatExpiry(account.expiresAt)}</span>
    </div>
  );
}

function QrStatusText({ status }: { status: QrLogin['status'] }): JSX.Element {
  const text = {
    waiting: '请用网易云音乐 App 扫码',
    scanned: '已扫码，请在手机上确认',
    expired: '二维码已过期',
    done: '登录成功',
  }[status];
  return <p role="status">{text}</p>;
}

function ConsentGate({ onStart, starting }: { onStart: () => void; starting: boolean }): JSX.Element {
  const [agreed, setAgreed] = useState(false);
  return (
    <div className="music-consent">
      <p className="community-notice">{MUSIC_CONSENT_TEXT}</p>
      <label className="community-choice">
        <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
        <span>我已了解，继续</span>
      </label>
      <button type="button" className="community-button" disabled={!agreed || starting} onClick={onStart}>
        {starting ? '正在生成…' : '显示二维码'}
      </button>
    </div>
  );
}

function QrPanel({ qr, onRefresh, starting }: { qr: QrLogin; onRefresh: () => void; starting: boolean }): JSX.Element {
  return (
    <div className="music-qr-panel">
      {qr.status !== 'expired' && <QrCode value={qr.url} label="网易云登录二维码" />}
      <QrStatusText status={qr.status} />
      {qr.status === 'expired' && (
        <button type="button" className="community-button" disabled={starting} onClick={onRefresh}>刷新二维码</button>
      )}
    </div>
  );
}

function SessionAccount({ roomRef, view, applyView, fail }: MusicLoginProps): JSX.Element | null {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const account = view.session?.account ?? null;
  if (!view.session) return null;

  const change = async (action: 'use' | 'stop'): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      applyView(await musicApi.account(roomRef, action));
    } catch (cause) {
      setError(fail(cause));
    } finally {
      setBusy(false);
    }
  };

  const mine = view.myAccount !== null;
  const offline = !view.bot.online;
  const button = (action: 'use' | 'stop', label: string): JSX.Element => (
    <button type="button" disabled={busy || offline} onClick={() => void change(action)}>{busy ? '处理中' : label}</button>
  );
  return (
    <div className="music-session-account">
      <p>
        {account === null && '当前未使用网易云账号，仅可播放免登录歌曲'}
        {account !== null && account.mine && '正在使用你的账号'}
        {account !== null && !account.mine && `正在使用 ${account.nickname} 的账号`}
      </p>
      {account === null && mine && button('use', '用我的账号播放')}
      {account !== null && !account.mine && mine && button('use', '换成我的账号')}
      {account?.canStop && button('stop', '停止使用')}
      {error && <p className="community-error" role="alert">{error}</p>}
    </div>
  );
}

export function MusicLogin(props: MusicLoginProps): JSX.Element {
  const { view, reload, fail } = props;
  const login = useQrLogin(fail, reload);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const account = view.myAccount ?? (login.qr?.status === 'done' ? login.qr.account ?? null : null);

  const logout = async (): Promise<void> => {
    setLeaving(true);
    setLeaveError(null);
    try {
      await musicApi.logout();
      login.reset();
      reload();
    } catch (cause) {
      setLeaveError(fail(cause, { notFoundIsGone: false }));
    } finally {
      setLeaving(false);
    }
  };

  return (
    <section className="community-card music-login" aria-labelledby="music-login-title">
      <h2 id="music-login-title">网易云账号</h2>
      <SessionAccount {...props} />
      {!view.loginAvailable && !account && (
        <p className="community-notice" role="status">
          网易云登录暂不可用：服务器还没有完成加密配置。不登录也可以播放免登录的歌曲。
        </p>
      )}
      {account && (
        <>
          <AccountCard account={account} />
          <button type="button" disabled={leaving} onClick={() => void logout()}>退出网易云登录</button>
        </>
      )}
      {!account && view.loginAvailable && !login.qr && <ConsentGate onStart={() => void login.start()} starting={login.starting} />}
      {!account && login.qr && <QrPanel qr={login.qr} onRefresh={() => void login.start()} starting={login.starting} />}
      {(login.error || leaveError) && <p className="community-error" role="alert">{login.error ?? leaveError}</p>}
    </section>
  );
}
