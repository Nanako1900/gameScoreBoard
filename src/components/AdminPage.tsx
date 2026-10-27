import type { Config, User } from '../types';
import { goBack, useLocation } from '../lib/router';
import { adminVoicePath, isUserId } from '../lib/routes';
import { NOT_FOUND_TITLE } from '../lib/routeCopy';
import { Link } from './Link';
import { Modal } from './Modal';
import { NotFound } from './NotFound';
import { PageBar } from './PageBar';
import { VoiceLog } from './VoiceLog';
import './admin-page.css';

interface AdminPageProps { me: User | null; config: Config }

function VoiceAdmin({ me, config }: { me: User; config: Config }): JSX.Element {
  const location = useLocation();
  const userId = new URLSearchParams(location.search).get('user');
  if (userId !== null && !isUserId(userId)) return <NotFound title={NOT_FOUND_TITLE} />;
  return <Modal open variant="page" labelledBy="admin-page-title" onClose={goBack}>
    <PageBar backLabel="返回" onBack={goBack} title="管理" />
    <div className="admin-page">
      <h2 id="admin-page-title" tabIndex={-1}>管理</h2>
      <nav aria-label="管理"><Link to={adminVoicePath()} aria-current="page">语音记录</Link></nav>
      <VoiceLog key={userId ?? 'day'} ownerId={me.id} userId={userId} offsetHours={config.boardTzOffsetHours ?? 8} />
    </div>
  </Modal>;
}

/** Private evidence is not fetched or rendered until the current role allows it. */
export function AdminPage({ me, config }: AdminPageProps): JSX.Element {
  if (!me || (!me.is_judge && !me.is_admin)) return <NotFound title={NOT_FOUND_TITLE} />;
  return <VoiceAdmin key={me.id} me={me} config={config} />;
}
