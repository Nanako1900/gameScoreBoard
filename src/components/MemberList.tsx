import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { boardTzLabel } from '@shared/boardTime';
import { ApiError, avatarSrc, getAdminUsers, setJudge, setScore } from '../api';
import type { AdminUserRow, AdminUsersResponse } from '../types';
import { NOT_FOUND_TITLE } from '../lib/routeCopy';
import { parseTimestamp } from '../lib/time';
import { AdminScoreForm } from './AdminScoreForm';
import { Link } from './Link';
import { NotFound } from './NotFound';
import { useToast } from './Toast';
import './member-list.css';

interface MemberListProps {
  ownerId: string;
  offsetHours?: number;
  onChanged?: () => void;
  onUnavailable?: () => void;
  /** A shared tool destination; omitted callers retain the existing inline form. */
  scoreTo?: (id: string) => string;
}
type ReadState = { status: 'loading' | 'missing' } | { status: 'error'; message: string }
  | { status: 'ready'; data: AdminUsersResponse };

function MemberAvatar({ name, src }: { name: string; src: string | null }): JSX.Element {
  const [failed, setFailed] = useState(false);
  const resolved = failed ? null : avatarSrc(src);
  if (resolved) return <img className="member-list__avatar" src={resolved} width={40} height={40}
    alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />;
  return <span className="member-list__avatar member-list__avatar--fallback" aria-hidden="true">
    {Array.from(name.trim())[0]?.toUpperCase() || '?'}
  </span>;
}
function Registration({ at, offsetHours }: { at: string; offsetHours: number }): JSX.Element {
  const instant = parseTimestamp(at);
  const local = new Date(instant + offsetHours * 3_600_000);
  if (!Number.isFinite(instant) || !Number.isFinite(local.getTime())) return <span>注册时间未知</span>;
  return <span>注册于 <time dateTime={new Date(instant).toISOString()}>{local.toISOString().slice(0, 16).replace('T', ' ')}</time></span>;
}
interface MemberRowProps {
  person: AdminUserRow;
  self: boolean;
  busy: boolean;
  expanded: boolean;
  offsetHours: number;
  onExpand: () => void;
  onJudge: () => void;
  onScore: (score: number) => void;
  scoreTo?: string;
}
function MemberRow({ person, self, busy, expanded, offsetHours, onExpand, onJudge, onScore, scoreTo }: MemberRowProps): JSX.Element {
  const formId = useId();
  return <li className="member-list__row" aria-label={`${person.username}的账号`}>
    <div className="member-list__identity">
      <MemberAvatar key={person.avatar_url ?? ''} name={person.username} src={person.avatar_url} />
      <div className="member-list__name"><strong>{person.username}</strong>
        <div className="member-list__roles" aria-label="身份">
          {person.is_participant && <span>上榜</span>}{person.is_judge && <span>裁判</span>}{person.is_admin && <span>管理员</span>}
          {!person.is_participant && !person.is_judge && !person.is_admin && <span>游客</span>}
          {self && <span>这是你</span>}
        </div>
      </div>
    </div>
    <div className="member-list__details"><span>信誉分 <strong className="tabular">{person.score}</strong> 分</span>
      <Registration at={person.created_at} offsetHours={offsetHours} /></div>
    <div className="member-list__actions">
      {!(self && person.is_judge) && <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={onJudge}>
        {person.is_judge ? '取消裁判资格' : '设为裁判'}</button>}
      {scoreTo ? <Link className="btn btn--ghost btn--sm" to={scoreTo}>调整分数</Link> : <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={onExpand}
        aria-expanded={expanded} aria-controls={formId}>调整分数</button>}
    </div>
    {expanded && <div id={formId}><AdminScoreForm key={person.score} username={person.username} score={person.score}
      busy={busy} onSubmit={onScore} /></div>}
  </li>;
}

function MemberContent({ ownerId, offsetHours = 8, onChanged, onUnavailable, scoreTo }: MemberListProps): JSX.Element {
  const titleId = useId(); const searchId = useId(); const toast = useToast();
  const [read, setRead] = useState<ReadState>({ status: 'loading' });
  const [query, setQuery] = useState(''); const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [writeError, setWriteError] = useState<string | null>(null);
  const active = useRef(false); const readVersion = useRef(0); const writing = useRef(false);
  const callbacks = useRef({ onChanged, onUnavailable }); callbacks.current = { onChanged, onUnavailable };
  // Deactivate synchronously when the authorized scope unmounts, before an old
  // write can raise a toast or refresh another account's page.
  useLayoutEffect(() => {
    active.current = true;
    return () => { active.current = false; readVersion.current += 1; };
  }, []);
  const unavailable = useCallback(() => {
    if (!active.current) return;
    readVersion.current += 1; setRead({ status: 'missing' }); callbacks.current.onUnavailable?.();
  }, []);
  const load = useCallback(async (afterSave = false): Promise<void> => {
    const version = ++readVersion.current;
    setRead({ status: 'loading' }); setWriteError(null);
    try {
      const data = await getAdminUsers();
      if (active.current && readVersion.current === version) setRead({ status: 'ready', data });
    } catch (error) {
      if (!active.current || readVersion.current !== version) return;
      if (error instanceof ApiError && (error.status === 403 || error.status === 404)) { unavailable(); return; }
      const message = error instanceof ApiError ? error.message : '读取成员列表失败，请稍后重试';
      setRead({ status: 'error', message: afterSave ? `修改已保存，成员列表刷新失败。${message}` : message });
    }
  }, [unavailable]);
  useEffect(() => { void load(); }, [load]);
  const run = async (write: () => Promise<unknown>, message: string): Promise<void> => {
    if (!active.current || writing.current || read.status !== 'ready') return;
    writing.current = true; setBusy(true); setWriteError(null);
    try {
      await write();
      if (!active.current) return;
      setExpanded(null); toast.show({ message, tone: 'ok' }); callbacks.current.onChanged?.();
      // load handles its own failure: the write is already saved and must not
      // be presented as a failed operation if only this refresh is unavailable.
      await load(true);
    } catch (error) {
      if (!active.current) return;
      if (error instanceof ApiError && (error.status === 403 || error.status === 404)) { unavailable(); return; }
      setWriteError(error instanceof ApiError ? error.message : '操作失败，请重试');
    } finally {
      if (active.current) { writing.current = false; setBusy(false); }
    }
  };
  if (read.status === 'missing') return <NotFound title={NOT_FOUND_TITLE} />;
  const needle = query.trim().toLocaleLowerCase();
  const people = read.status === 'ready' ? read.data.users.filter(person => person.username.toLocaleLowerCase().includes(needle)) : [];
  return <section className="member-list" aria-labelledby={titleId}>
    <h3 id={titleId}>成员</h3>
    {read.status === 'loading' && <p role="status">正在读取成员列表…</p>}
    {read.status === 'error' && <div><p role="alert">{read.message}</p>
      <button type="button" className="btn btn--ghost" onClick={() => void load()}>重试</button></div>}
    {read.status === 'ready' && <>
      <div className="member-list__search"><label htmlFor={searchId}>按名字搜索</label>
        <input id={searchId} type="search" value={query} onChange={event => setQuery(event.target.value)} /></div>
      {read.data.truncated && <p className="member-list__hint">仅显示最新 500 个账号；搜索仅限当前列表。</p>}
      <p className="member-list__hint">注册时间按{boardTzLabel(offsetHours)}显示</p>
      {writeError && <p className="member-list__error" role="alert">{writeError}</p>}
      {people.length === 0 ? <p className="member-list__hint">{read.data.users.length ? '没有匹配的账号' : '还没有账号'}</p>
        : <ul className="member-list__people">{people.map(person => <MemberRow key={person.id} person={person} self={person.id === ownerId}
          busy={busy} expanded={expanded === person.id} offsetHours={offsetHours} scoreTo={scoreTo?.(person.id)}
          onExpand={() => setExpanded(value => value === person.id ? null : person.id)}
          onJudge={() => void run(() => setJudge(person.id, !person.is_judge), person.is_judge ? '已取消裁判资格' : '已设为裁判')}
          onScore={score => void run(() => setScore(person.id, score), '已调整分数')} />)}</ul>}
    </>}
  </section>;
}

/** A new owner gets a new private scope before its first render. */
export function MemberList(props: MemberListProps): JSX.Element {
  return <MemberContent key={props.ownerId} {...props} />;
}
