import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { Config, PublicUser, User, UserDetailResponse, AdminUsersResponse } from '../types';
import { ApiError, getAdminUsers, getUserDetail, setScore } from '../api';
import { goBack, useLocation } from '../lib/router';
import { isUserId, toolsPath, type ToolsTab } from '../lib/routes';
import { usePageLeaveGuard } from '../lib/usePageLeaveGuard';
import { NOT_FOUND_TITLE } from '../lib/routeCopy';
import { AdminScoreForm } from './AdminScoreForm';
import { ConfirmInline } from './ConfirmInline';
import { Link } from './Link';
import { Modal } from './Modal';
import { NotFound } from './NotFound';
import { PageBar } from './PageBar';
import { VoiceLog } from './VoiceLog';
import { useToast } from './Toast';
import './tools-page.css';

interface ToolsPageProps {
  me: User | null;
  config: Config;
  tab: ToolsTab;
  /** The app's persistent filing controller owns this list and its draft. */
  participants?: PublicUser[];
  onChanged?: () => void;
}
const back = (): void => goBack(toolsPath());
const voicePersonPath = (id: string): string => toolsPath('voice', id);

function ToolsShell({ title, children, headerAction }: { title: string; children: React.ReactNode; headerAction?: React.ReactNode }): JSX.Element {
  return <Modal open variant="page" labelledBy="tools-page-title" onClose={back}>
    <PageBar backLabel="返回" onBack={back} title={title} />
    <div className="tools-page"><header className="tools-page__heading"><h2 id="tools-page-title" tabIndex={-1}>{title}</h2>
      {headerAction ?? (title !== '裁判工具' && <Link to={toolsPath()} className="tools-page__back">返回裁判工具</Link>)}</header>{children}</div>
  </Modal>;
}

function ToolsHome({ admin }: { admin: boolean }): JSX.Element {
  return <ToolsShell title="裁判工具"><p className="tools-page__intro">记录事实、查阅证据，并处理案件。</p>
    <ul className="tools-page__destinations">
      <li><Link to={toolsPath('filing')}><strong>记一笔</strong><span>选择当事人，写清事实；可分别补充情况。</span></Link></li>
      <li><Link to={toolsPath('voice')}><strong>语音记录</strong><span>按日汇总与按成员查询，覆盖缺口单独说明。</span></Link></li>
      {admin && <><li><Link to="/cases"><strong>申诉复核</strong><span>前往案件待办，处理等待复核的申诉。</span></Link></li>
        <li><Link to={toolsPath('score')}><strong>人工调分</strong><span>选择账号并核对新分数，确认后提交。</span></Link></li></>}
    </ul></ToolsShell>;
}

type AccountsRead = { status: 'loading' | 'missing' } | { status: 'error'; message: string }
  | { status: 'ready'; data: AdminUsersResponse };
function ScorePicker(): JSX.Element {
  const [read, setRead] = useState<AccountsRead>({ status: 'loading' });
  const [query, setQuery] = useState('');const [retry, setRetry] = useState(0);const searchId = useId();
  useEffect(() => {
    let active = true;setRead({ status: 'loading' });
    void getAdminUsers().then(data => { if (active) setRead({ status: 'ready', data }); }, error => {
      if (!active) return;
      if (error instanceof ApiError && (error.status === 403 || error.status === 404)) setRead({ status: 'missing' });
      else setRead({ status: 'error', message: error instanceof ApiError ? error.message : '读取账号列表失败，请稍后重试' });
    });
    return () => { active = false; };
  }, [retry]);
  if (read.status === 'missing') return <NotFound title={NOT_FOUND_TITLE} />;
  const people = read.status === 'ready' ? read.data.users.filter(person => person.username.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) : [];
  return <ToolsShell title="人工调分"><p className="tools-page__intro">选择要调整的账号，包括当前没有上榜的账号。</p>
    {read.status === 'loading' && <p role="status">正在读取账号列表…</p>}
    {read.status === 'error' && <div><p role="alert">{read.message}</p><button className="btn btn--ghost" onClick={() => setRetry(value => value + 1)}>重新读取</button></div>}
    {read.status === 'ready' && <section className="tools-page__card panel"><label className="tools-page__search" htmlFor={searchId}>按名字搜索</label>
      <input id={searchId} type="search" value={query} onChange={event => setQuery(event.target.value)} />
      {read.data.truncated && <p className="tools-page__hint">仅显示最新 500 个账号；搜索仅限当前列表。已有成员链接仍可直接打开。</p>}
      {people.length === 0 ? <p className="tools-page__hint">{read.data.users.length ? '没有匹配的账号' : '还没有账号'}</p>
        : <ul className="tools-page__accounts">{people.map(person => <li key={person.id}><Link to={toolsPath('score', person.id)}>
          <strong>{person.username}</strong><span>{person.is_participant ? '上榜成员' : '当前不上榜'} · {person.score} 分</span></Link></li>)}</ul>}
    </section>}
  </ToolsShell>;
}

type SubjectRead = { status: 'loading' | 'missing' } | { status: 'error'; message: string }
  | { status: 'ready'; data: UserDetailResponse };
function ScoreEditor({ userId, onChanged }: { userId: string; onChanged?: () => void }): JSX.Element {
  const [read, setRead] = useState<SubjectRead>({ status: 'loading' });
  const [busy, setBusy] = useState(false);const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);const [departing, setDeparting] = useState(false);
  const active = useRef(false);const version = useRef(0);const writing = useRef(false);
  const callback = useRef(onChanged);callback.current = onChanged;const toast = useToast();
  const guard = usePageLeaveGuard(dirty && !departing && read.status !== 'missing', {
    onLeave: () => { active.current = false;setDeparting(true); },
  });
  useLayoutEffect(() => {
    active.current = true;
    return () => { active.current = false;version.current += 1; };
  }, []);
  const load = useCallback(async (afterSave = false): Promise<void> => {
    const mine = ++version.current;setRead({ status: 'loading' });setError(null);
    try {
      const data = await getUserDetail(userId);
      if (active.current && mine === version.current) setRead({ status: 'ready', data });
    } catch (reason) {
      if (!active.current || mine !== version.current) return;
      if (reason instanceof ApiError && (reason.status === 403 || reason.status === 404)) setRead({ status: 'missing' });
      else {
        const message = reason instanceof ApiError ? reason.message : '读取成员信息失败，请稍后重试';
        setRead({ status: 'error', message: afterSave ? `修改已保存，成员信息刷新失败。${message}` : message });
      }
    }
  }, [userId]);
  useEffect(() => { void load(); }, [load]);
  const save = async (score: number): Promise<void> => {
    if (!active.current || writing.current || read.status !== 'ready') return;
    writing.current = true;setBusy(true);setError(null);
    try {
      await setScore(userId, score);
      if (!active.current) return;
      setDirty(false);callback.current?.();toast.show({ message: '已调整分数', tone: 'ok' });
      await load(true);
    } catch (reason) {
      if (!active.current) return;
      if (reason instanceof ApiError && (reason.status === 403 || reason.status === 404)) setRead({ status: 'missing' });
      else setError(reason instanceof ApiError ? reason.message : '操作失败，请重试');
    } finally {
      if (active.current) { writing.current = false;setBusy(false); }
    }
  };
  if (departing) return <p className="tools-page__status" role="status">正在离开…</p>;
  if (read.status === 'missing') return <NotFound title={NOT_FOUND_TITLE} />;
  return <ToolsShell title="人工调分">
    {guard.confirming && <ConfirmInline question="还有未保存的修改" confirmLabel="放弃修改并离开" cancelLabel="继续编辑"
      onConfirm={guard.leave} onCancel={guard.stay}>尚未提交的调整不会保存；已经开始的保存请求仍可能完成。</ConfirmInline>}
    {read.status === 'loading' && <p role="status">正在读取成员信息…</p>}
    {read.status === 'error' && <div><p role="alert">{read.message}</p><button className="btn btn--ghost" onClick={() => void load()}>重新读取</button></div>}
    {read.status === 'ready' && <section className="tools-page__card panel"><h3>{read.data.user.username}</h3>
      <p className="tools-page__hint">{read.data.user.is_participant ? '上榜成员' : '当前不上榜'} · 当前 {read.data.user.score} 分</p>
      {error && <p role="alert">{error}</p>}
      <AdminScoreForm key={`${userId}:${read.data.user.score}`} username={read.data.user.username} score={read.data.user.score} busy={busy}
        onDirtyChange={setDirty} onSubmit={score => void save(score)} />
      <Link to={toolsPath('score')} className="tools-page__other">选择其他账号</Link>
    </section>}
  </ToolsShell>;
}

function ToolsContent({ me, config, tab, onChanged }: ToolsPageProps & { me: User }): JSX.Element | null {
  const location = useLocation();const userId = new URLSearchParams(location.search).get('user');
  if ((tab === 'voice' || tab === 'score') && userId !== null && !isUserId(userId)) return <NotFound title={NOT_FOUND_TITLE} />;
  if (tab === 'filing') return null;
  if (tab === 'home') return <ToolsHome admin={me.is_admin} />;
  if (tab === 'score') return userId === null ? <ScorePicker /> : <ScoreEditor key={`${me.id}:${userId}`} userId={userId} onChanged={onChanged} />;
  return <ToolsShell title="语音记录" headerAction={userId !== null
    ? <Link to={toolsPath('voice')} className="tools-page__back">按日汇总</Link> : undefined}>
    <section className="tools-page__card panel"><VoiceLog key={userId ?? 'day'} ownerId={me.id} userId={userId}
      offsetHours={config.boardTzOffsetHours ?? 8} personPath={voicePersonPath} /></section>
  </ToolsShell>;
}

/** No private account or evidence request starts before this role gate. */
export function ToolsPage(props: ToolsPageProps): JSX.Element | null {
  const { me, tab } = props;
  if (!me || (!me.is_judge && !me.is_admin) || (tab === 'score' && !me.is_admin)) return <NotFound title={NOT_FOUND_TITLE} />;
  return <ToolsContent key={`${me.id}:${tab}`} {...props} me={me} />;
}
