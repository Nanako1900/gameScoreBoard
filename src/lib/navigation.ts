import { boardPath, CASES_PATH, HOME_PATH, settingsPath, type Route } from './routes';

export type PrimaryNavigationKey = 'home' | 'board' | 'cases' | 'settings';

/** One ordered set of destinations for desktop and phone navigation. */
export const PRIMARY_NAVIGATION = [
  { key: 'home', label: '首页', to: HOME_PATH },
  { key: 'board', label: '信誉榜', to: boardPath('list') },
  { key: 'cases', label: '案件', to: CASES_PATH },
  { key: 'settings', label: '设置', to: settingsPath('profile') },
] as const satisfies readonly { key: PrimaryNavigationKey; label: string; to: string }[];

/** Older addresses retain their content while marking the matching new destination. */
export function primaryNavigationKey(route: Route): PrimaryNavigationKey | null {
  switch (route.name) {
    case 'community':
    case 'home':
      return 'home';
    case 'player':
      return 'board';
    case 'cases':
    case 'case':
    case 'playerCase':
    case 'tools':
      return 'cases';
    case 'communityAdmin':
    case 'settings':
      return 'settings';
    case 'board':
      return route.tab === 'list' ? 'board' : route.tab === 'feed' ? 'cases' : null;
    case 'admin':
      return route.tab === 'voice' ? 'cases' : 'settings';
    default:
      return null;
  }
}
