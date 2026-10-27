import { useEffect, useRef, useState } from 'react';
import { getSession } from '../api';
import type { Config, PublicUser, SessionDetail, SessionItem, User } from '../types';
import { goBack, useLocation } from '../lib/router';
import { parseAgain, type RouteLayout } from '../lib/routes';
import { againPrefill, type AgainPrefill } from '../lib/sessionAgain';
import { useInvitable } from '../lib/useInvitable';
import { LoginLink } from './LoginLink';
import { Modal } from './Modal';
import { PageBar } from './PageBar';
import { SessionFormDialog } from './SessionFormDialog';

interface NewSessionRouteProps {
  me: User | null; config: Config; layout: RouteLayout; participants: PublicUser[];
  mySessions?: readonly SessionItem[] | null; onCreated: (session: SessionDetail) => void;
}
function useAgain(id: number | null, meId: string) {
  const request = useRef<{ id: number; promise: Promise<SessionDetail | null> } | null>(null);
  const [result, setResult] = useState<{ id: number | null; ready: boolean; value?: AgainPrefill }>({ id, ready: id === null });
  useEffect(() => {
    let active = true;
    if (id === null) { setResult({ id, ready: true }); return; }
    if (request.current?.id !== id) request.current = { id, promise: getSession(id).then((r) => r.session).catch(() => null) };
    void request.current.promise.then((session) => {
      if (active) setResult({ id, ready: true, value: session ? againPrefill(session, meId, Date.now()) : undefined });
    });
    return () => { active = false; };
  }, [id, meId]);
  return { ready: result.id === id && result.ready, value: result.value };
}
function LoggedNewSession(props: NewSessionRouteProps & { me: User }): JSX.Element {
  const { search } = useLocation();
  const invitable = useInvitable(true);
  const again = useAgain(parseAgain(search), props.me.id);
  if (!again.ready || ['off', 'loading'].includes(invitable.state.kind)) return <p role="status">加载中…</p>;
  return <SessionFormDialog open routed variant={props.layout === 'page' ? 'page' : 'center'}
    participants={props.participants} selfId={props.me.id} invitable={invitable} again={again.value}
    mySessions={props.mySessions} boardTzOffsetHours={props.config.boardTzOffsetHours} onClose={goBack} onCreated={props.onCreated} />;
}
export function NewSessionRoute(props: NewSessionRouteProps): JSX.Element {
  if (props.me) return <LoggedNewSession {...props} me={props.me} />;
  return <Modal open variant={props.layout === 'page' ? 'page' : 'center'} labelledBy="new-session-title" onClose={goBack}>
    {props.layout === 'page' && <PageBar backLabel="返回" onBack={goBack} />}
    <h2 id="new-session-title" tabIndex={-1}>约一局</h2><p>登录后就能组局。</p>
    <LoginLink className="btn btn--gold">用 Nanako 账号登录</LoginLink>
  </Modal>;
}
