import type { Config, User } from '../types';
import { COUNTDOWN_TICK_MS } from '../lib/constants';
import { formatResetCountdown } from '../lib/time';
import { boardPath, HOME_PATH, playerPath, type Route, type RouteLayout } from '../lib/routes';
import { useNow } from '../lib/useNow';
import { AccountMenu } from './AccountMenu';
import { LoginLink } from './LoginLink';
import { Link } from './Link';
import './header.css';

interface HeaderProps {
  config: Config | null;
  me: User | null;
  onLogout: () => void;
  onOpenOnboarding: () => void;
  /** Retained for older callers; AI settings now live at /admin/ai. */
  onOpenAiPanel?: () => void;
  pending?: boolean;
  layout?: RouteLayout;
  route?: Route;
  onRecord?: () => void;
  myPath?: string;
  meDot?: boolean;
}

function HeaderBrand(): JSX.Element {
  return <Link to={HOME_PATH} className="hdr__brand" aria-label="EDG 信誉分 首页">
    <span className="hdr__logo" aria-hidden="true"><span className="hdr__logo-mark">EDG</span></span>
    <span className="hdr__wordmark"><span className="hdr__title">信誉分</span>
      <span className="hdr__subtitle">开黑守约计分板</span></span>
  </Link>;
}

function HeaderNavigation({ route }: { route?: Route }): JSX.Element {
  const current = route?.name === 'board' ? route.tab === 'rules' ? 'rules' : 'board' : route?.name === 'home' ? 'home' : null;
  return <nav className="hdr__nav" aria-label="页面">
    <Link to={HOME_PATH} aria-current={current === 'home' ? 'page' : undefined}>首页</Link>
    <Link to={boardPath('list')} aria-current={current === 'board' ? 'page' : undefined}>信誉榜</Link>
    <Link to={boardPath('rules')} aria-current={current === 'rules' ? 'page' : undefined}>规则</Link>
  </nav>;
}

export function Header(props: HeaderProps): JSX.Element {
  const now = useNow(COUNTDOWN_TICK_MS);
  const countdown = props.config ? formatResetCountdown(props.config.nextResetAt, now) : '—';
  const desktop = props.layout === 'drawer' && !props.pending;
  return <header className="hdr"><div className="hdr__inner">
    <HeaderBrand />
    {desktop && <HeaderNavigation route={props.route} />}
    <div className="hdr__reset" aria-label="距离每周恢复">
      <span className="hdr__reset-label eyebrow">每周恢复</span>
      <span className="hdr__reset-time tabular">{countdown}</span>
    </div>
    {!props.pending && <div className="hdr__actions">{props.me
      ? <AccountMenu me={props.me} myPath={props.myPath ?? playerPath(props.me.id)} dot={props.meDot}
        onOpenOnboarding={props.onOpenOnboarding} onRecord={props.onRecord} onLogout={props.onLogout} />
      : <LoginLink className="btn btn--gold">登录</LoginLink>}</div>}
  </div></header>;
}
