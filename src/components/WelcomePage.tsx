import { useEffect, useRef, useState } from 'react';
import type { User } from '../types';
import type { DiscordLinkRead, DiscordLinkValue } from '../lib/discordLinkState';
import { missingOnboardingSteps } from '../lib/onboardingSteps';
import { DISCORD_INVITE_URL } from '../lib/env';
import { goBack } from '../lib/router';
import { WELCOME_PATH } from '../lib/routes';
import { DiscordLinkCard } from './DiscordLinkCard';
import { GuideContent } from './GuideContent';
import { IdentityForm, type IdentityFormHandle } from './IdentityForm';
import { LoginLink } from './LoginLink';
import { Modal } from './Modal';
import { PageBar } from './PageBar';
import { DiscordNotificationSettings } from './DiscordNotificationSettings';
import './welcome-page.css';

interface WelcomePageProps {
  me: User | null;
  discord: DiscordLinkRead;
  onDiscordChanged: (value: DiscordLinkValue) => void;
  onSaved: (user: User) => void;
  onComplete: () => void;
  notice?: React.ReactNode;
  onBeforeBind?: () => void;
}
const TITLES = ['登录', '加入服务器并绑定 Discord', '开启私信通知', '名字与身份', '机器人怎么用'] as const;

export function WelcomePage({ me, discord, onDiscordChanged, onSaved, onComplete, notice, onBeforeBind }: WelcomePageProps): JSX.Element {
  const identityRef = useRef<IdentityFormHandle>(null);
  const headings = useRef<Array<HTMLButtonElement | null>>([]);
  const cards = useRef<Array<HTMLElement | null>>([]);
  const bound = !discord.loading && typeof discord.value === 'object' && discord.value !== null ? discord.value : null;
  const supported = !discord.loading && discord.value !== undefined && discord.value !== 'error';
  const identityReady = !!me && (me.is_participant || me.is_judge);
  const missing = missingOnboardingSteps(me, discord.loading ? undefined : discord.value);
  const first = !me ? 1 : discord.loading || discord.value === undefined || discord.value === null || discord.value === 'error' ? 2 : missing[0] ?? 5;
  const [expanded, setExpanded] = useState<number>(first);
  const previousFirst = useRef(first);


  useEffect(() => {
    if (previousFirst.current === first) return;
    const focusWasInside = expanded !== first && (cards.current[expanded]?.contains(document.activeElement) ?? false);
    previousFirst.current = first;
    setExpanded(first);
    if (focusWasInside) headings.current[first]?.focus();
  }, [first, expanded]);

  const savedIdentity = (user: User): void => {
    onSaved(user);
    const next = missingOnboardingSteps(user, discord.loading ? undefined : discord.value)[0] ?? 5;
    setExpanded(next);
    headings.current[next]?.focus();
  };
  // Unknown reads never prove completion; the unsupported-backend policy is kept distinct.
  const canFinish = !!me && identityReady && !!bound && bound.notify_dm === true && bound.dm_ok === true;
  const complete = [false, !!me, !!bound, !!bound && bound.notify_dm === true && bound.dm_ok === true, identityReady, false];
  const stateLabel = (step: number): string => {
    if (!me && step !== 1) return '○ 先登录';
    if (step === 2 || step === 3) {
      if (discord.loading) return '○ 读取中';
      if (discord.value === undefined) return '○ 当前后端不支持';
      if (discord.value === 'error') return '○ 暂时无法读取';
    }
    return complete[step] ? '✓ 已完成' : step === 5 ? '→ 待查看' : '○ 待完成';
  };

  const body = (step: number): JSX.Element => {
    if (step === 1) return me ? <p>已登录：{me.username}</p>
      : <LoginLink className="btn btn--gold" returnTo={WELCOME_PATH}>用 Nanako 账号登录</LoginLink>;
    if (!me) return <p>先登录后继续。</p>;
    switch (step) {
      case 2: return <>
        {supported && DISCORD_INVITE_URL && <a className="btn btn--ghost" href={DISCORD_INVITE_URL} target="_blank" rel="noopener noreferrer">加入服务器</a>}
        {discord.loading && <p role="status">正在读取 Discord 绑定…</p>}
        <DiscordLinkCard ownerId={me.id} linkState={discord} onChanged={onDiscordChanged} onBeforeBind={() => { identityRef.current?.saveBeforeBind(); onBeforeBind?.(); }} />
      </>;
      case 3: return <DiscordNotificationSettings ownerId={me.id} discord={discord} onChanged={onDiscordChanged} mode="onboarding" />;
      case 4: return <IdentityForm ref={identityRef} me={me} onSaved={savedIdentity} />;
      default: return <><GuideContent /><button type="button" className="btn btn--gold" disabled={!canFinish} onClick={onComplete}>完成，去首页</button></>;
    }
  };

  return <Modal open variant="page" labelledBy="welcome-page-title" onClose={goBack}>
    <PageBar backLabel="返回" onBack={goBack} title="入户" />
    <div className="welcome-page">
      <h2 id="welcome-page-title" tabIndex={-1}>入户</h2>
      {notice}
      <ol className="welcome-page__steps">{TITLES.map((title, index) => {
        const step = index + 1; const disabled = !me && step > 1;
        return <li key={step}><section data-testid={`welcome-step-${step}`} ref={(node) => { cards.current[step] = node; }}
          className={`welcome-step${disabled ? ' welcome-step--disabled' : ''}`} aria-labelledby={`welcome-step-title-${step}`}>
          <h3><button ref={(node) => { headings.current[step] = node; }} id={`welcome-step-title-${step}`} type="button"
            className="welcome-step__heading" disabled={disabled} aria-expanded={expanded === step} aria-controls={`welcome-step-body-${step}`}
            onClick={() => setExpanded((old) => old === step ? 0 : step)}>
            <span className="welcome-step__state">{stateLabel(step)}</span><span>{step}. {title}</span>
          </button></h3>
          <div id={`welcome-step-body-${step}`} className="welcome-step__body" hidden={expanded !== step}>{body(step)}</div>
        </section></li>;
      })}</ol>
    </div>
  </Modal>;
}
