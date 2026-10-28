import { useState } from 'react';
import type { Config, RecordItem, User } from '../types';
import { goBack, navigate, useLocation } from '../lib/router';
import { CASES_PATH, casePath, settingsPath, TOOLS_PATH } from '../lib/routes';
import type { TodoItem } from '../lib/todo';
import { isPendingHidden, violationDef } from '../lib/recordView';
import { Link } from './Link';
import { Modal } from './Modal';
import { RecordsFeed } from './RecordsFeed';
import { TodoInbox } from './TodoInbox';
import './cases-page.css';

interface CasesPageProps {
  me: User | null;
  config: Config;
  items: readonly TodoItem[] | null;
  now: number;
  records: RecordItem[];
  onOpenStatement: (record: RecordItem) => void;
  onOpenPlayer: (id: string) => void;
  onDismissOnboarding?: () => void;
  /** The retired board feed keeps its public landing without an extra redirect. */
  initialTab?: 'todo' | 'public';
}

const FILTERS = [
  ['all', '全部记录'], ['processing', '处理中'], ['decided', '已判决'], ['appealed', '申诉中'],
  ['withdrawn', '已撤案'], ['revoked', '已撤销'], ['bonus', '历史加分'],
] as const;
type RecordFilter = (typeof FILTERS)[number][0];

function isFilter(value: string): value is RecordFilter {
  return FILTERS.some(([filter]) => filter === value);
}

function matchesFilter(record: RecordItem, filter: RecordFilter): boolean {
  if (filter === 'all') return true;
  // The hidden flag is authoritative: never reveal a finer stage by filtering
  // a protected row into 待说明 / 裁决中 or some stale copied outcome field.
  if (filter === 'processing') return isPendingHidden(record)
    || record.status === 'awaiting_statement' || record.status === 'judging';
  if (isPendingHidden(record)) return false;
  if (filter === 'bonus') return violationDef(record.type)?.kind === 'bonus';
  return record.status === filter;
}

/** An ordinary full page; it consumes the app's loaded data and makes no new API reads. */
export function CasesPage({ me, config, items, now, records, onOpenStatement, onOpenPlayer,
  onDismissOnboarding, initialTab = 'todo' }: CasesPageProps): JSX.Element {
  const location = useLocation();
  const requestedTab = new URLSearchParams(location.search).get('view');
  const tab = me === null ? 'public' : requestedTab === 'public' || requestedTab === 'todo' ? requestedTab : initialTab;
  const [filter, setFilter] = useState<RecordFilter>('all');
  const caseTodos = items === null ? null : items.filter(item => item.kind !== 'onboarding');
  const visible = records.filter(record => matchesFilter(record, filter));

  return <Modal open variant="page" labelledBy="cases-page-title" onClose={goBack}>
    <div className="cases-page">
      <header className="cases-page__heading"><div><h2 id="cases-page-title" tabIndex={-1}>案件</h2>
        <p>处理自己的待办，查阅公开记录。</p></div>
        {(me?.is_judge || me?.is_admin) && <Link className="btn btn--ghost" to={TOOLS_PATH}>裁判工具</Link>}
      </header>
      <nav className="cases-page__tabs" aria-label="案件分类">
        {me && <Link to={`${CASES_PATH}?view=todo`} aria-current={tab === 'todo' ? 'page' : undefined}>我的待办</Link>}
        <Link to={`${CASES_PATH}?view=public`} aria-current={tab === 'public' ? 'page' : undefined}>公开记录</Link>
      </nav>
      {tab === 'todo' ? <TodoInbox items={caseTodos} now={now} boardTzOffsetHours={config.boardTzOffsetHours}
        onOpenStatement={onOpenStatement} onOpenNotify={() => navigate(settingsPath('discord'))}
        onDismissUnbound={() => {}} onDismissOnboarding={onDismissOnboarding} />
        : <div className="cases-page__records">
          <div className="cases-page__toolbar"><p>本页显示当前已读取的记录。</p>
            <label className="cases-page__filter"><span>案件状态</span><select value={filter}
              onChange={event => setFilter(isFilter(event.currentTarget.value) ? event.currentTarget.value : 'all')}>
              {FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
          </div>
          <RecordsFeed records={visible} title="当前读取的记录" onSelectUser={onOpenPlayer}
            onSelectRecord={record => navigate(casePath(record.id))}
            emptyHint="当前读取的记录中，没有符合条件的案件。" />
        </div>}
    </div>
  </Modal>;
}
