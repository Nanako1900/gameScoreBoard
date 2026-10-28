import { useEffect, useRef, useState } from 'react';
import { ApiError, resendWelcome, setDiscordNotify, type DiscordLinkInfo } from '../api';
import type { DiscordLinkRead, DiscordLinkValue } from '../lib/discordLinkState';
import { useToast } from './Toast';

interface DiscordNotificationSettingsProps {
  ownerId: string;
  discord: DiscordLinkRead;
  onChanged: (value: DiscordLinkValue) => void;
  /** The wizard keeps its existing immediate switch; daily settings save independently. */
  mode?: 'settings' | 'onboarding';
  onDirtyChange?: (dirty: boolean) => void;
  onRetry?: () => void;
}
const RESENT = '已让机器人再发一次，去 Discord 看看；没收到就刷新本页看原因';

/** One implementation of the existing notification and welcome-message contracts. */
export function DiscordNotificationSettings({ ownerId, discord, onChanged, mode = 'settings', onDirtyChange, onRetry }: DiscordNotificationSettingsProps): JSX.Element | null {
  const toast = useToast();
  const [draftNotify, setDraftNotify] = useState<boolean | undefined>();
  const [notifying, setNotifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [notifySupported, setNotifySupported] = useState(true);
  const [resendSupported, setResendSupported] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const lastRead = useRef<{ owner: string; link: DiscordLinkInfo | null }>({ owner: ownerId, link: null });
  if (lastRead.current.owner !== ownerId) lastRead.current = { owner: ownerId, link: null };
  if (!discord.loading && discord.value !== 'error') lastRead.current.link = discord.value ?? null;
  // A refresh cannot erase an ordinary, unsaved checkbox. Cached flags never
  // prove onboarding completion and no write is allowed until the read settles.
  const bound = discord.loading || discord.value === 'error'
    ? mode === 'settings' ? lastRead.current.link : null
    : typeof discord.value === 'object' && discord.value !== null ? discord.value : null;
  const canWrite = !discord.loading && discord.value !== 'error' && discord.value !== undefined;
  const scope = JSON.stringify([ownerId, bound?.linked_at ?? '', bound?.discord_username ?? '', bound !== null]);
  const current = useRef(scope); current.current = scope;
  const active = useRef(false);
  const changed = useRef(onChanged); changed.current = onChanged;
  const dirtyCallback = useRef(onDirtyChange); dirtyCallback.current = onDirtyChange;
  const selected = draftNotify ?? bound?.notify_dm === true;
  const dirty = mode === 'settings' && bound !== null && notifySupported && draftNotify !== undefined && draftNotify !== (bound.notify_dm === true);

  useEffect(() => { active.current = true; return () => { active.current = false; dirtyCallback.current?.(false); }; }, []);
  useEffect(() => { dirtyCallback.current?.(dirty); }, [dirty]);
  useEffect(() => {
    setDraftNotify(undefined); setError(null); setSaved(false); setNotifying(false); setResending(false);
  }, [scope]);
  useEffect(() => { setNotifySupported(true); setResendSupported(true); }, [ownerId]);

  const saveNotify = async (on: boolean): Promise<void> => {
    if (!bound || notifying || !notifySupported || !canWrite) return;
    const mine = scope;
    setNotifying(true); setError(null); setSaved(false);
    try {
      const result = await setDiscordNotify(on);
      if (!active.current || current.current !== mine) return;
      if (result === undefined) { setNotifySupported(false); setDraftNotify(undefined); }
      else { changed.current(result); setDraftNotify(undefined); setSaved(true); dirtyCallback.current?.(false); }
    } catch (err) {
      if (active.current && current.current === mine) setError(err instanceof ApiError ? err.message : '私信通知没改成，请稍后重试');
    } finally {
      if (active.current && current.current === mine) setNotifying(false);
    }
  };
  const resend = async (): Promise<void> => {
    if (!bound || bound.notify_dm !== true || !selected || resending || !resendSupported || !canWrite) return;
    const mine = scope;
    setResending(true); setError(null);
    try {
      await resendWelcome();
      if (active.current && current.current === mine) toast.show({ message: RESENT });
    } catch (err) {
      if (!active.current || current.current !== mine) return;
      if (err instanceof ApiError && err.status === 404) setResendSupported(false);
      else setError(err instanceof ApiError ? err.message : '没能安排重发，请稍后重试');
    } finally {
      if (active.current && current.current === mine) setResending(false);
    }
  };

  if (discord.loading && (mode === 'onboarding' || !bound)) return <p role="status">正在读取 Discord 设置…</p>;
  if (!discord.loading && discord.value === undefined) return mode === 'onboarding' ? <p>当前后端不支持 Discord 设置。</p> : null;
  if (discord.value === 'error' && (mode === 'onboarding' || !bound)) return <div><p role="alert">{discord.error ?? '暂时无法读取 Discord 设置。'}</p>
    {onRetry && <button type="button" className="btn btn--ghost" onClick={onRetry}>重新读取</button>}</div>;
  if (!bound) return <p>{mode === 'onboarding' ? '先完成上一步' : '先绑定 Discord，再修改私信设置。'}</p>;

  return <div className="discord-notify">
    {discord.loading && <p role="status">正在刷新 Discord 设置，未保存的选择已保留。</p>}
    {discord.value === 'error' && <p role="alert">{discord.error ?? '暂时无法读取 Discord 设置。'}未保存的选择已保留。</p>}
    {notifySupported && <>
      <button type="button" role="switch" aria-checked={selected} aria-label={mode === 'onboarding' ? '开启私信通知' : '允许机器人私信'}
        className="btn btn--ghost" disabled={notifying || !canWrite} onClick={() => {
          setError(null); setSaved(false);
          if (mode === 'onboarding') void saveNotify(!selected); else setDraftNotify(!selected);
        }}>私信通知：{selected ? '开' : '关'}</button>
      {mode === 'settings' && <div className="settings-page__actions"><button type="button" className="btn btn--gold"
        disabled={notifying || !dirty || !canWrite} onClick={() => void saveNotify(selected)}>{notifying ? '保存中…' : '保存通知设置'}</button>
        {dirty && <span className="settings-page__hint">有未保存的修改</span>}</div>}
    </>}
    {bound.notify_dm === true && selected && <>
      {bound.dm_ok === true && <p>已开启。没收到欢迎私信？点「再发一次」</p>}
      {bound.dm_ok === false && <p>上次私信没送到。请确认：① 已经加入服务器；② 隐私设置里允许服务器成员私信你。改好后点「再发一次」</p>}
      {resendSupported && <button type="button" className="btn btn--ghost" disabled={resending || !canWrite} onClick={() => void resend()}>
        {resending ? '已在安排…' : mode === 'onboarding' ? '再发一次' : '再发一次欢迎私信'}</button>}
      {mode === 'settings' && <p className="settings-page__hint">每人 24 小时内最多手动重发 3 次。</p>}
    </>}
    {saved && mode === 'settings' && <p className="settings-page__success" role="status">通知设置已保存</p>}
    {error && <p className="settings-page__error" role="alert">{error}</p>}
  </div>;
}
