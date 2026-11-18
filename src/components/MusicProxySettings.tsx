import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { MusicProxyView } from '@shared/music';
import { ApiError } from '../api';
import { musicApi, type MusicProxyTest } from '../music-api';

const SOCKS_ADDRESS = /^socks(?:4a?|5h?)?:\/\/\S+$/i;
const NOT_PROVIDED = 404;
const FALLBACK_ERROR = '音乐机器人设置暂不可用，请重试';

const messageOf = (cause: unknown): string => (cause instanceof Error && cause.message ? cause.message : FALLBACK_ERROR);

/** Only trust a response that looks like a proxy view: an older backend may answer anything. */
function isProxyView(value: unknown): value is MusicProxyView {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.configured === 'boolean' && typeof record.available === 'boolean' && typeof record.audio === 'boolean';
}

interface ProxyForm {
  view: MusicProxyView;
  onChange: (view: MusicProxyView) => void;
}

function ProxyEditor({ view, onChange }: ProxyForm): JSX.Element {
  const [address, setAddress] = useState('');
  const [audio, setAudio] = useState(view.audio);
  const [busy, setBusy] = useState<'save' | 'clear' | 'test' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState<MusicProxyTest | null>(null);
  const locked = !view.available || busy !== null;
  const canSave = address.trim() !== '' || (view.configured && audio !== view.audio);

  const run = async (kind: 'save' | 'clear' | 'test', work: () => Promise<void>): Promise<void> => {
    setBusy(kind);
    setError(null);
    setSaved(false);
    setTest(null);
    try {
      await work();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(null);
    }
  };

  const save = (event: FormEvent): void => {
    event.preventDefault();
    const value = address.trim();
    if (value !== '' && !SOCKS_ADDRESS.test(value)) {
      setError('代理地址需要以 socks5:// 开头，例如 socks5://用户:密码@主机:端口');
      return;
    }
    void run('save', async () => {
      const next = await musicApi.saveProxy(value === '' ? undefined : value, audio);
      setAddress('');
      setAudio(next.audio);
      setSaved(true);
      onChange(next);
    });
  };

  const clear = (): void =>
    void run('clear', async () => {
      const next = await musicApi.saveProxy(null, false);
      setAudio(false);
      onChange(next);
    });

  const probe = (): void => void run('test', async () => setTest(await musicApi.testProxy()));

  return (
    <form onSubmit={save} aria-label="音乐机器人代理设置">
      <p>
        {view.configured && view.host ? <>当前代理：<strong>{view.host}</strong>（账号和密码已加密保存，不会再显示）</> : '尚未配置代理，网易云请求将直接连接。'}
      </p>
      <label>
        新的代理地址
        <input
          type="text"
          value={address}
          autoComplete="off"
          spellCheck={false}
          disabled={locked}
          placeholder="socks5://用户:密码@主机:端口"
          onChange={(event) => setAddress(event.target.value)}
        />
      </label>
      <label className="community-choice">
        <input type="checkbox" checked={audio} disabled={locked} onChange={(event) => setAudio(event.target.checked)} />
        <span>音频也走代理</span>
      </label>
      <p className="community-muted">保存新地址会覆盖旧地址；地址留空时只保存「音频也走代理」的改动。</p>
      {error && <p className="community-error" role="alert">{error}</p>}
      {saved && <p role="status">代理设置已保存，可点「测试连接」确认可用。</p>}
      {test && <p role={test.ok ? 'status' : 'alert'}>{test.message}</p>}
      <div className="community-actions">
        <button type="submit" className="community-button" disabled={locked || !canSave}>
          {busy === 'save' ? '保存中…' : '保存代理'}
        </button>
        <button type="button" disabled={locked || !view.configured} onClick={probe}>
          {busy === 'test' ? '测试中…' : '测试连接'}
        </button>
        <button type="button" disabled={locked || !view.configured} onClick={clear}>
          {busy === 'clear' ? '清除中…' : '清除代理'}
        </button>
      </div>
    </form>
  );
}

export function MusicProxySettings(): JSX.Element {
  const [view, setView] = useState<MusicProxyView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [absent, setAbsent] = useState(false);

  const load = useCallback((signal?: AbortSignal) => {
    setError(null);
    musicApi
      .proxy(signal)
      .then((next) => {
        if (signal?.aborted) return;
        if (isProxyView(next)) setView(next);
        else setError(FALLBACK_ERROR);
      })
      .catch((cause: unknown) => {
        if (signal?.aborted) return;
        if (cause instanceof ApiError && cause.status === NOT_PROVIDED) setAbsent(true);
        else setError(messageOf(cause));
      });
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    load(abort.signal);
    return () => abort.abort();
  }, [load]);

  if (absent) return <p className="community-muted" role="status">当前服务暂未提供音乐机器人设置。</p>;
  if (error) {
    return (
      <div>
        <p role="alert">{error}</p>
        <button type="button" onClick={() => load()}>重新加载</button>
      </div>
    );
  }
  if (!view) return <p role="status">音乐机器人设置加载中…</p>;
  return (
    <>
      {!view.available && (
        <p className="community-notice" role="status">服务器未配置主密钥，暂时无法保存代理地址。配置主密钥后即可使用。</p>
      )}
      <ProxyEditor view={view} onChange={setView} />
    </>
  );
}

/** The collapsible group the community admin page shows; it reads nothing until first opened. */
export function MusicBotSettingsGroup(): JSX.Element {
  const [opened, setOpened] = useState(false);
  return (
    <details
      className="community-card community-admin-section community-config-group"
      id="community-music"
      onToggle={(event) => {
        if (event.currentTarget.open) setOpened(true);
      }}
    >
      <summary><h2>音乐机器人</h2></summary>
      <p className="community-muted">为网易云请求设置可选的出口代理。留空则直接连接。</p>
      {opened && <MusicProxySettings />}
    </details>
  );
}
