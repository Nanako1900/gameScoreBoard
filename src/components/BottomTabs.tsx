import type { User } from '../types';
import { boardPath, formatRoute, HOME_PATH, SESSION_NEW_PATH, type Route } from '../lib/routes';
import { IconPlus } from './icons';
import { Link } from './Link';
import { LoginLink } from './LoginLink';
import './bottom-tabs.css';

interface BottomTabsProps {
  me: User | null; route: Route; todoCount: number; meDot: boolean; myPath: string;
}

export function showsBottomTabs(route: Route): boolean {
  return route.name !== 'sessionNew' && route.name !== 'rollcall';
}

export function BottomTabs({ me, route, todoCount, meDot, myPath }: BottomTabsProps): JSX.Element | null {
  if (!showsBottomTabs(route)) return null;
  const mine = me !== null && route.name !== 'notFound' && formatRoute(route) === myPath;
  const create = <><IconPlus /><span>组一局</span></>;
  const account = <>我的{meDot && <><span className="btabs__dot" aria-hidden="true" /><span className="visually-hidden">，有待办</span></>}</>;
  return <nav className="btabs" aria-label="主导航">
    <Link to={HOME_PATH} aria-current={route.name === 'home' ? 'page' : undefined}>大厅{todoCount > 0
      && <span className="btabs__badge"><span className="visually-hidden">，要你处理 </span>{todoCount}</span>}</Link>
    <Link to={boardPath('list')} aria-current={route.name === 'board' ? 'page' : undefined}>信誉榜</Link>
    {me ? <Link className="btabs__create" to={SESSION_NEW_PATH} aria-label="组一局">{create}</Link>
      : <LoginLink className="btabs__create" returnTo={SESSION_NEW_PATH} ariaLabel="组一局">{create}</LoginLink>}
    {me ? <Link to={myPath} aria-current={mine ? 'page' : undefined}>{account}</Link> : <LoginLink>我的</LoginLink>}
  </nav>;
}
