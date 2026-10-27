import type { User } from '../types';
import { boardPath, formatRoute, HOME_PATH, type Route } from '../lib/routes';
import { Link } from './Link';
import { LoginLink } from './LoginLink';
import './bottom-tabs.css';

interface BottomTabsProps {
  me: User | null; route: Route; todoCount: number; meDot: boolean; myPath: string;
}

export function BottomTabs({ me, route, todoCount, meDot, myPath }: BottomTabsProps): JSX.Element | null {
  const mine = me !== null && route.name !== 'notFound' && formatRoute(route) === myPath;
  const account = <>我的{meDot && <><span className="btabs__dot" aria-hidden="true" /><span className="visually-hidden">，有待办</span></>}</>;
  return <nav className="btabs" aria-label="主导航">
    <Link to={HOME_PATH} aria-current={route.name === 'home' ? 'page' : undefined}>首页{todoCount > 0
      && <><span aria-hidden="true">·</span><span className="btabs__badge"><span className="visually-hidden">，要你处理 </span>{todoCount}</span></>}</Link>
    <Link to={boardPath('list')} aria-current={route.name === 'board' ? 'page' : undefined}>信誉榜</Link>
    {me ? <Link to={myPath} aria-current={mine ? 'page' : undefined}>{account}</Link> : <LoginLink>我的</LoginLink>}
  </nav>;
}
