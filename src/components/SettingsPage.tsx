import { useRef, useState } from 'react';
import type { Config, User } from '../types';
import type { DiscordLinkRead, DiscordLinkValue } from '../lib/discordLinkState';
import { settingsPath, toolsPath, type SettingsTab } from '../lib/routes';
import { NOT_FOUND_TITLE } from '../lib/routeCopy';
import { goBack } from '../lib/router';
import { usePageLeaveGuard } from '../lib/usePageLeaveGuard';
import { VOICE_RETENTION_DAYS } from '@shared/voice';
import { DISCORD_INVITE_URL } from '../lib/env';
import { AiSettings } from './AiSettings';
import { ConfirmInline } from './ConfirmInline';
import { DiscordLinkCard } from './DiscordLinkCard';
import { DiscordNotificationSettings } from './DiscordNotificationSettings';
import { IdentityForm, type IdentityFormHandle } from './IdentityForm';
import { Link } from './Link';
import { LoginLink } from './LoginLink';
import { MemberList } from './MemberList';
import { Modal } from './Modal';
import { NotFound } from './NotFound';
import './settings-page.css';

interface SettingsPageProps {
  me: User | null;
  config: Config;
  tab: SettingsTab;
  discord: DiscordLinkRead;
  onDiscordChanged: (value: DiscordLinkValue) => void;
  onSaved: (user: User) => void;
  onChanged: () => void;
  onBeforeBind?: () => void;
  onRetryDiscord?: () => void;
}
const LABELS: Record<SettingsTab, string> = { profile: '个人资料', discord: 'Discord 与通知', members: '成员与权限', ai: 'AI 模型与密钥' };

function SettingsContent(props: SettingsPageProps & { me: User }): JSX.Element {
  const { me, tab, discord } = props;
  const [unavailable, setUnavailable] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [departing, setDeparting] = useState(false);
  const identity = useRef<IdentityFormHandle>(null);
  const discordSupported = discord.loading || discord.value !== undefined;
  const guard = usePageLeaveGuard(dirty && !departing && !unavailable && (tab !== 'discord' || discordSupported), { onLeave: () => {
    identity.current?.discardChanges?.();
    // Logout can await the server before reloading: detach credentials now,
    // rather than leaving an already-discarded password in the old editor.
    setDeparting(true);
  } });
  if (departing) return <div className="settings-page" role="status">正在离开…</div>;
  if (unavailable || (tab === 'discord' && !discordSupported)) return <NotFound title={NOT_FOUND_TITLE} />;
  const personal: SettingsTab[] = discordSupported ? ['profile', 'discord'] : ['profile'];
  return <Modal open variant="page" labelledBy="settings-page-title" onClose={goBack}>
    <div className="settings-page">
      <header className="settings-page__heading"><div><h2 id="settings-page-title" tabIndex={-1}>设置</h2>
        <p>资料、通知与管理配置，集中在这里。</p></div></header>
      {guard.confirming && <ConfirmInline question="还有未保存的修改" confirmLabel="放弃修改并离开" cancelLabel="继续编辑"
        onConfirm={guard.leave} onCancel={guard.stay}>尚未提交的修改不会保存；已经开始的保存仍可能完成。</ConfirmInline>}
      <div className="settings-page__layout">
        <nav className="settings-page__nav" aria-label="设置分类">
          <span>个人设置</span>{personal.map(value => <Link key={value} to={settingsPath(value)} aria-current={tab === value ? 'page' : undefined}>{LABELS[value]}</Link>)}
          {me.is_admin && <><span>管理员设置</span>{(['members', 'ai'] as const).map(value => <Link key={value} to={settingsPath(value)}
            aria-current={tab === value ? 'page' : undefined}>{LABELS[value]}</Link>)}</>}
        </nav>
        <div className="settings-page__content">
          {tab === 'profile' && <section className="settings-page__card panel"><IdentityForm ref={identity} me={me} mode="settings"
            onSaved={props.onSaved} onDirtyChange={setDirty} /></section>}
          {tab === 'discord' && <>
            <section className="settings-page__card panel">
              {DISCORD_INVITE_URL && <a className="btn btn--ghost" href={DISCORD_INVITE_URL} target="_blank" rel="noopener noreferrer">加入服务器</a>}
              {discord.loading && <p role="status">正在读取 Discord 绑定…</p>}
              <DiscordLinkCard ownerId={me.id} linkState={discord} onChanged={props.onDiscordChanged} onBeforeBind={props.onBeforeBind} />
              {discord.value === 'error' && props.onRetryDiscord && <button type="button" className="btn btn--ghost" onClick={props.onRetryDiscord}>重新读取</button>}
              <p className="settings-page__notice">绑定后，你在本服务器语音频道的进出时间会被记录，保存 {VOICE_RETENTION_DAYS} 天，供裁判处理迟到、缺席时参考。只有裁判、管理员和你自己能看到。</p>
            </section>
            <section className="settings-page__card panel" aria-labelledby="settings-notify-title"><h3 id="settings-notify-title">私信通知</h3>
              <DiscordNotificationSettings ownerId={me.id} discord={discord} onChanged={props.onDiscordChanged} onDirtyChange={setDirty} />
            </section>
          </>}
          {tab === 'members' && <section className="settings-page__card panel"><MemberList ownerId={me.id}
            scoreTo={id => toolsPath('score', id)} offsetHours={props.config.boardTzOffsetHours ?? 8} onChanged={props.onChanged} onUnavailable={() => setUnavailable(true)} /></section>}
          {tab === 'ai' && <section className="settings-page__card panel"><AiSettings collapsedAdvanced onDirtyChange={setDirty} onUnavailable={() => setUnavailable(true)} /></section>}
        </div>
      </div>
    </div>
  </Modal>;
}

/** Private groups are checked before mounting a form or reading administrator data. */
export function SettingsPage(props: SettingsPageProps): JSX.Element {
  const { me, tab } = props;
  if ((tab === 'ai' || tab === 'members') && !me?.is_admin) return <NotFound title={NOT_FOUND_TITLE} />;
  if (!me) return <section className="settings-page settings-page--guest panel"><h2>登录后修改设置</h2>
    <p>登录后继续回到当前设置页。</p><LoginLink className="btn btn--gold">用 Nanako 账号登录</LoginLink></section>;
  return <SettingsContent key={`${me.id}:${tab}`} {...props} me={me} />;
}
