import type { Config, PublicUser, RecordItem, User, WeeklyReport } from '../types';
import { boardPath, type BoardTab } from '../lib/routes';
import { COUNTDOWN_TICK_MS } from '../lib/constants';
import { formatResetCountdown } from '../lib/time';
import { useNow } from '../lib/useNow';
import { goBack } from '../lib/router';
import { Leaderboard } from './Leaderboard';
import { RecordsFeed } from './RecordsFeed';
import { Modal } from './Modal';
import { Link } from './Link';
import { RulesGuide } from './RulesGuide';
import { RulesPanel } from './RulesPanel';
import { WeeklyReportCard } from './WeeklyReportCard';
import './board-page.css';

export interface BoardData {
  participants: PublicUser[]; records: RecordItem[]; report: WeeklyReport | null; reportStale: boolean;
  trends: Record<string, number>; counts: Record<string, number>; regenerating: boolean;
  onRegenerate?: () => void; onSelectUser: (id: string) => void;
}
interface BoardPageProps { tab: BoardTab; config: Config; me: User | null; data?: BoardData }
const PAGE_TITLE: Readonly<Record<BoardTab, string>> = { list: '信誉榜', feed: '案件', report: '每周战报', rules: '规则与指南' };

function BoardBody({ tab, config, me, data }: BoardPageProps & { data: BoardData }): JSX.Element {
  switch (tab) {
    case 'list': return <Leaderboard title="全部上榜成员" participants={data.participants} meId={me?.id} trends={data.trends}
      counts={data.counts} onSelect={data.onSelectUser} />;
    case 'feed': return <RecordsFeed title="最新动态" records={data.records} onSelectUser={data.onSelectUser}
      emptyHint="还没有任何记录，等待第一笔。" />;
    case 'report': return data.report ? <WeeklyReportCard report={data.report} hidePigeon dismissible={false}
      stale={data.reportStale} regenerating={data.regenerating} onRegenerate={data.onRegenerate} />
      : <p className="board__empty">还没有战报。每周一 10:30 之后发布上周的。</p>;
    case 'rules': return <><RulesGuide config={config} /><RulesPanel config={config} alwaysOpen /></>;
  }
}
export function BoardPage(props: BoardPageProps): JSX.Element {
  const now = useNow(COUNTDOWN_TICK_MS);
  const data = props.data ?? { participants: [], records: [], report: null, reportStale: false,
    trends: {}, counts: {}, regenerating: false, onSelectUser: () => {} };
  return <Modal open variant="page" labelledBy="board-title" onClose={goBack}>
    <div className="board">
      <header className="board__heading"><div><h2 id="board-title" tabIndex={-1}>{PAGE_TITLE[props.tab]}</h2>
        {props.tab === 'list' && <p>上榜成员的当前信誉分与本周变化。</p>}</div>
        {props.tab === 'list' && <Link to={boardPath('rules')}>计分规则</Link>}</header>
      <BoardBody {...props} data={data} />
      {props.tab === 'list' && <p className="board__reset" aria-label="距离每周恢复">每周恢复 +{props.config.weeklyHeal} · 距离下次恢复 <span className="board__reset-time tabular">{formatResetCountdown(props.config.nextResetAt, now)}</span></p>}
    </div>
  </Modal>;
}
