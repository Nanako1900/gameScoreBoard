import { useEffect, useId, useRef, useState } from 'react';
import {
  ApiError,
  DISCORD_LINK_URL,
  getDiscordLink,
  unlinkDiscord,
  type DiscordLinkInfo,
} from '../api';
import './discord-link.css';

type CardState =
  | { status: 'loading' }
  /** The backend predates Discord (old Worker): offer nothing rather than a dead button. */
  | { status: 'unsupported' }
  | { status: 'failed'; message: string }
  | { status: 'unbound' }
  | { status: 'bound'; link: DiscordLinkInfo };

/** Which control should take focus after the one the user was on disappears. */
type FocusTarget = 'unlink' | 'cancel' | 'bind';

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

/**
 * 绑定 / 解绑 Discord. Binding itself happens on the API's own pages (Discord
 * OAuth + a confirm page), so here it is only a link; unbinding is a POST
 * behind an inline confirm.
 */
interface DiscordLinkCardProps {
  /**
   * Called as the 绑定 Discord link is followed (spec §4.4 #2): the host keeps
   * its unsaved choice. It must not block the navigation, nor fetch anything.
   */
  onBeforeBind?: () => void;
}

export function DiscordLinkCard({ onBeforeBind }: DiscordLinkCardProps): JSX.Element | null {
  const titleId = useId();
  const [state, setState] = useState<CardState>({ status: 'loading' });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Swapping 解绑 ⇄ confirm ⇄ 绑定 unmounts the focused control; without this a
  // keyboard user is dropped back at the top of the dialog.
  const focusNext = useRef<FocusTarget | null>(null);
  const unlinkRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const bindRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    let alive = true;
    getDiscordLink()
      .then((link) => {
        if (!alive) return;
        if (link === undefined) setState({ status: 'unsupported' });
        else if (link === null) setState({ status: 'unbound' });
        else setState({ status: 'bound', link });
      })
      .catch((err: unknown) => {
        if (alive) {
          setState({ status: 'failed', message: errorMessage(err, '读取 Discord 绑定失败') });
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const target = focusNext.current;
    if (target === null) return;
    focusNext.current = null;
    const refs = { unlink: unlinkRef, cancel: cancelRef, bind: bindRef };
    refs[target].current?.focus();
  });

  const askConfirm = (): void => {
    setError(null);
    // Land on 取消, not 确认: a stray Enter should not unbind.
    focusNext.current = 'cancel';
    setConfirming(true);
  };

  const cancelConfirm = (): void => {
    focusNext.current = 'unlink';
    setConfirming(false);
  };

  const handleUnlink = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await unlinkDiscord();
      focusNext.current = 'bind';
      setState({ status: 'unbound' });
    } catch (err) {
      focusNext.current = 'unlink';
      setError(errorMessage(err, '解绑失败，请稍后重试'));
    } finally {
      setConfirming(false);
      setBusy(false);
    }
  };

  if (state.status === 'loading' || state.status === 'unsupported') {
    return null;
  }

  return (
    <section className="dlink" aria-labelledby={titleId}>
      <h3 id={titleId} className="dlink__label">
        Discord 账号
      </h3>

      {state.status === 'failed' && (
        <p className="dlink__error" role="alert">
          {state.message}
        </p>
      )}

      {state.status === 'unbound' && (
        <div className="dlink__row">
          <p className="dlink__text">
            绑定后可以在 Discord 里查分、看榜、看自己的待办。
            {/* The link is a full navigation: nothing unsaved reaches the server.
                A host may keep its choice locally through onBeforeBind (the
                first-run dialog does), but it is still unconfirmed on return.
                The sentence is locked copy (spec §6.5, discord-link). */}
            <span className="dlink__hint">会跳转到 Discord 授权页，上面还没「确认」的修改不会保存。</span>
          </p>
          <a ref={bindRef} className="btn btn--sm dlink__bind" href={DISCORD_LINK_URL} onClick={onBeforeBind}>
            绑定 Discord
          </a>
        </div>
      )}

      {state.status === 'bound' && (
        <div className="dlink__row">
          <p className="dlink__text">
            <span className="dlink__check" aria-hidden="true">
              ✓
            </span>
            Discord：<strong className="dlink__name">@{state.link.discord_username}</strong>
            {' · '}已绑定
          </p>
          {confirming ? (
            <div className="dlink__confirm" role="group" aria-label="确认解绑 Discord">
              <span className="dlink__confirm-q">确定解绑？之后可以随时重新绑定。</span>
              <button
                type="button"
                className="btn btn--danger btn--sm"
                onClick={() => void handleUnlink()}
                disabled={busy}
              >
                {busy ? '解绑中…' : '确认解绑'}
              </button>
              <button
                ref={cancelRef}
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={cancelConfirm}
                disabled={busy}
              >
                取消
              </button>
            </div>
          ) : (
            <button
              ref={unlinkRef}
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={askConfirm}
            >
              解绑
            </button>
          )}
        </div>
      )}

      {error && (
        <p className="dlink__error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

interface DiscordLinkedNoticeProps {
  onDismiss: () => void;
}

/** One-time confirmation after the API redirects back with `?linked=discord`. */
export function DiscordLinkedNotice({ onDismiss }: DiscordLinkedNoticeProps): JSX.Element {
  return (
    <section className="dlink-notice" role="status" aria-live="polite">
      <span className="dlink-notice__icon" aria-hidden="true">
        ✓
      </span>
      <p className="dlink-notice__text">
        <strong className="dlink-notice__title">Discord 绑定成功</strong>
        现在可以在 Discord 里查分、看待办了。
      </p>
      <button
        type="button"
        className="dlink-notice__close"
        onClick={onDismiss}
        aria-label="关闭提示"
      >
        ✕
      </button>
    </section>
  );
}
