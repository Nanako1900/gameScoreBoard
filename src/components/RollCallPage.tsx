import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, getSession } from '../api';
import type { SessionDetail, SessionDetailResponse, User } from '../types';
import { goBack } from '../lib/router';
import { sessionPath } from '../lib/routes';
import { SESSION_NOT_FOUND } from '../lib/routeCopy';
import { parseTimestamp } from '../lib/time';
import { settledSummary } from '../lib/sessionSummary';
import { Link } from './Link';
import { Modal } from './Modal';
import { NotFound } from './NotFound';
import { PageBar } from './PageBar';
import { RollCallFlow, type RollCallFlowState } from './RollCallFlow';
import './rollcall-page.css';

interface RollCallPageProps {
  sessionId: number; me: User | null; boardTzOffsetHours?: number; onChanged: () => void;
}
function entryError(session: SessionDetail, me: User | null): string | null {
  if (session.organizer.id !== me?.id && !me?.is_admin) return '只有组织者和管理员能点名。';
  if (session.status === 'settled') return '这局已经结算了。';
  if (session.status === 'cancelled') return '这局已取消。';
  if (parseTimestamp(session.starts_at) > Date.now()) return '这局还没开始，开局后才能点名。';
  return null;
}
function useRollCallSession(id: number, onChanged: () => void) {
  const [data, setData] = useState<SessionDetailResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [completed, setCompleted] = useState(false);
  const mounted = useRef(false);
  const notified = useRef(false);
  const changed = useRef(onChanged); changed.current = onChanged;
  const load = useCallback(async (): Promise<void> => {
    setStatus('loading');
    try {
      const response = await getSession(id);
      if (!mounted.current) return;
      setData(response); setStatus('ready');
    } catch (err) {
      if (mounted.current) setStatus(err instanceof ApiError && err.status === 404 ? 'missing' : 'error');
    }
  }, [id]);
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; }; }, [load]);
  const settled = (): void => {
    if (!notified.current) { notified.current = true; changed.current(); }
    setCompleted(true); void load();
  };
  return { data, status, completed, settled, retry: load };
}
function SessionReturn({ id, replace = false }: { id: number; replace?: boolean }): JSX.Element {
  return <Link to={sessionPath(id)} replace={replace} className="btn btn--ghost">回到这局</Link>;
}
function RollCallBody({ resource, me, setFlow }: {
  resource: ReturnType<typeof useRollCallSession>; me: User | null;
  setFlow: (flow: RollCallFlowState) => void;
}): JSX.Element | null {
  const { data, status, completed } = resource;
  if (status === 'loading') return <p role="status">加载中…</p>;
  if (status === 'error') return <p role="status">这块没加载出来，你的操作没丢。
    <button type="button" className="btn btn--ghost" onClick={() => void resource.retry()}>重试</button></p>;
  if (!data) return null;
  if (completed) return <div className="rcp__done"><p className="rcp__success">已结算 ✓</p>
    <p>{settledSummary(data.session.players, data.records)}</p><SessionReturn id={data.session.id} replace /></div>;
  const error = entryError(data.session, me);
  if (error) return <><p>{error}</p><SessionReturn id={data.session.id} /></>;
  return <RollCallFlow session={data.session} titleId="rollcall-page-title" onClose={goBack}
    onSettled={resource.settled} variant="page" onStateChange={setFlow} />;
}
export function RollCallPage({ sessionId, me, onChanged }: RollCallPageProps): JSX.Element {
  const resource = useRollCallSession(sessionId, onChanged);
  const [flow, setFlow] = useState<RollCallFlowState | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const loaded = resource.data !== null;
  useEffect(() => { if (loaded) heading.current?.focus(); }, [loaded]);
  const back = (): void => { if (flow && !resource.completed) flow.requestClose(); else goBack(); };
  return <Modal open variant="page" labelledBy="rollcall-page-title" onClose={back}>
    <PageBar backLabel="返回" title={resource.data?.session.title} onBack={back} />
    {resource.status === 'missing' ? <NotFound title={SESSION_NOT_FOUND} headingId="rollcall-page-title" />
      : <section className="rcp"><div className="rcp__heading">
        <h2 id="rollcall-page-title" ref={heading} tabIndex={-1}>点名{resource.data && ` · ${resource.data.session.title}`}</h2>
        {flow && !resource.completed && <span className="rcp__step" aria-label={`第 ${flow.step} 步，共 2 步`}>{flow.step}/2</span>}
      </div><RollCallBody resource={resource} me={me} setFlow={setFlow} /></section>}
  </Modal>;
}
