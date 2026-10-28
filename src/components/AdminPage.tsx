import type { Config, User } from '../types';
import { NOT_FOUND_TITLE } from '../lib/routeCopy';
import { NotFound } from './NotFound';
import { SettingsPage } from './SettingsPage';
import { ToolsPage } from './ToolsPage';

interface AdminPageProps { me: User | null; config: Config; tab?: 'voice' | 'ai' | 'members'; onChanged?: () => void }

/** Legacy callers share the current page, after the original role check. */
export function AdminPage({ me, config, tab = 'voice', onChanged = () => {} }: AdminPageProps): JSX.Element {
  if (!me || (!me.is_judge && !me.is_admin) || (tab !== 'voice' && !me.is_admin)) return <NotFound title={NOT_FOUND_TITLE} />;
  if (tab === 'voice') return <ToolsPage me={me} config={config} tab="voice" onChanged={onChanged} />;
  return <SettingsPage me={me} config={config} tab={tab}
    discord={{ value: undefined, loading: true }} onDiscordChanged={() => {}}
    onSaved={() => onChanged()} onChanged={onChanged} />;
}
