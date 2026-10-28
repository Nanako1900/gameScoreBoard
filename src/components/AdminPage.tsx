import { useState } from 'react';
import type { Config, User } from '../types';
import { goBack, useLocation } from '../lib/router';
import { adminVoicePath, isUserId } from '../lib/routes';
import { NOT_FOUND_TITLE } from '../lib/routeCopy';
import { Link } from './Link';
import { Modal } from './Modal';
import { NotFound } from './NotFound';
import { PageBar } from './PageBar';
import { VoiceLog } from './VoiceLog';
import { AiSettings } from './AiSettings';
import { MemberList } from './MemberList';
import './admin-page.css';

interface AdminPageProps { me: User | null; config: Config; tab?: 'voice' | 'ai' | 'members'; onChanged?: () => void }

function AdminContent({ me, config, tab, onChanged }: { me: User; config: Config; tab: 'voice' | 'ai' | 'members'; onChanged?: () => void }): JSX.Element {
  const [unavailable, setUnavailable] = useState(false);
  const location = useLocation();
  const userId = new URLSearchParams(location.search).get('user');
  if (unavailable || (tab === 'voice' && userId !== null && !isUserId(userId))) return <NotFound title={NOT_FOUND_TITLE} />;
  return <Modal open variant="page" labelledBy="admin-page-title" onClose={goBack}>
    <PageBar backLabel="返回" onBack={goBack} title="管理" />
    <div className="admin-page">
      <h2 id="admin-page-title" tabIndex={-1}>管理</h2>
      <nav aria-label="管理">
        <Link to={adminVoicePath()} aria-current={tab === 'voice' ? 'page' : undefined}>语音记录</Link>
        {me.is_admin && <>
          <Link to="/admin/ai" aria-current={tab === 'ai' ? 'page' : undefined}>AI 设置</Link>
          <Link to="/admin/members" aria-current={tab === 'members' ? 'page' : undefined}>成员</Link>
        </>}
      </nav>
      {tab === 'members' ? <MemberList ownerId={me.id} offsetHours={config.boardTzOffsetHours ?? 8}
        onChanged={onChanged} onUnavailable={() => setUnavailable(true)} />
        : tab === 'ai' ? <AiSettings onUnavailable={() => setUnavailable(true)} />
        : <VoiceLog key={userId ?? 'day'} ownerId={me.id} userId={userId} offsetHours={config.boardTzOffsetHours ?? 8} />}
    </div>
  </Modal>;
}

/** Private evidence is not fetched or rendered until the current role allows it. */
export function AdminPage({ me, config, tab = 'voice', onChanged }: AdminPageProps): JSX.Element {
  if (!me || (!me.is_judge && !me.is_admin) || (tab !== 'voice' && !me.is_admin)) return <NotFound title={NOT_FOUND_TITLE} />;
  return <AdminContent key={`${me.id}:${tab}`} me={me} config={config} tab={tab} onChanged={onChanged} />;
}
