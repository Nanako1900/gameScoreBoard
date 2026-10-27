import { useState } from 'react';
import { WELCOME_PATH } from '../lib/routes';
import { Link } from './Link';
import './welcome-card.css';

interface WelcomeCardProps {
  /** AUTH_LOGIN_URL — a top-level navigation, never fetch. */
  loginUrl: string;
  /** null → the 还没进 Discord 群？ row is hidden entirely. */
  discordInviteUrl: string | null;
  /** P0: the App opens RulesPanel and scrolls to it; P3: /board/rules. */
  onShowRules: () => void;
  /** config.weeklyHeal — never a literal 15 (test configs use 5). */
  weeklyHeal: number;
  rulesTo?: string;
}

const DISMISS_KEY = 'edg.welcome.dismissed';

function isDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    // Private mode / storage disabled: showing the card again is harmless.
    return false;
  }
}

function remember(): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, '1');
  } catch {
    /* nothing to do — the card simply reappears next load */
  }
}

/**
 * First thing a signed-out visitor sees (spec §3.1, M23): what this board is,
 * what it costs to flake, and the way back.
 */
export function WelcomeCard({
  loginUrl,
  discordInviteUrl,
  onShowRules,
  weeklyHeal,
  rulesTo,
}: WelcomeCardProps): JSX.Element | null {
  const [hidden, setHidden] = useState(isDismissed);
  if (hidden) return null;

  const dismiss = (): void => {
    remember();
    setHidden(true);
  };

  return (
    <section className="welcome panel" aria-labelledby="welcome-title">
      <div className="welcome__head">
        <h2 id="welcome-title" className="welcome__title">
          开黑小队的守约记分板。
        </h2>
        <button type="button" className="welcome__close" onClick={dismiss} aria-label="不再显示欢迎卡">
          ✕
        </button>
      </div>
      <p className="welcome__line">说了来就来；来不了，提前说一声。</p>
      <p className="welcome__line">
        放鸽子会被记一笔，每周一 0 点自动回血 <span className="tabular">+{weeklyHeal}</span>。
      </p>
      <div className="welcome__actions">
        <Link className="btn btn--gold" to={WELCOME_PATH}>开始</Link>
        {rulesTo ? <Link to={rulesTo} className="welcome__rules">30 秒看懂 <span aria-hidden="true">›</span></Link> : <button type="button" className="welcome__rules" onClick={onShowRules}>
          30 秒看懂 <span aria-hidden="true">›</span>
        </button>}
      </div>
      {discordInviteUrl && (
        <p className="welcome__discord">
          还没进 Discord 群？{' '}
          <a href={discordInviteUrl} target="_blank" rel="noopener noreferrer">
            加入服务器 <span aria-hidden="true">↗</span>
          </a>
        </p>
      )}
    </section>
  );
}
