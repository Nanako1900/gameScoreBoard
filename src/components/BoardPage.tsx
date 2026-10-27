import type { Config, PublicUser, RecordItem, User, WeeklyReport } from '../types';
import { BOARD_TABS, boardPath, type BoardTab } from '../lib/routes';
import { goBack } from '../lib/router';
import { Leaderboard } from './Leaderboard';
import { RecordsFeed } from './RecordsFeed';
import { Modal } from './Modal';
import { Link } from './Link';
import { RulesGuide } from './RulesGuide';
import { RulesPanel } from './RulesPanel';
import { WeeklyReportCard } from './WeeklyReportCard';
import { WeekHighlights } from './WeekHighlights';
import './board-page.css';

export interface BoardData {
  participants: PublicUser[]; records: RecordItem[]; report: WeeklyReport | null; reportStale: boolean;
  trends: Record<string, number>; counts: Record<string, number>; regenerating: boolean;
  onRegenerate?: () => void; onSelectUser: (id: string) => void;
}
interface BoardPageProps { tab: BoardTab; config: Config; me: User | null; data?: BoardData }
const TAB_LABEL: Readonly<Record<BoardTab, string>> = { list: '榜单', feed: '动态', report: '战报', rules: '规则' };

function BoardBody({ tab, config, me, data }: BoardPageProps & { data: BoardData }): JSX.Element {
  switch (tab) {
    case 'list': return <Leaderboard title="全部选手" participants={data.participants} meId={me?.id} trends={data.trends}
      counts={data.counts} onSelect={data.onSelectUser} highlights={<WeekHighlights records={data.records}
        nextResetAt={config.nextResetAt} onSelectUser={data.onSelectUser} />} />;
    case 'feed': return <RecordsFeed title="最新动态" records={data.records} onSelectUser={data.onSelectUser}
      emptyHint="还没有任何记录，等待第一笔。" />;
    case 'report': return data.report ? <WeeklyReportCard report={data.report} hidePigeon dismissible={false}
      stale={data.reportStale} regenerating={data.regenerating} onRegenerate={data.onRegenerate} />
      : <p className="board__empty">还没有战报。每周一 10:30 之后发布上周的。</p>;
    case 'rules': return <><RulesGuide config={config} /><RulesPanel config={config} alwaysOpen /></>;
  }
}
export function BoardPage(props: BoardPageProps): JSX.Element {
  const data = props.data ?? { participants: [], records: [], report: null, reportStale: false,
    trends: {}, counts: {}, regenerating: false, onSelectUser: () => {} };
  return <Modal open variant="page" labelledBy="board-title" onClose={goBack}>
    <div className="board">
      <h2 id="board-title" tabIndex={-1}>信誉榜</h2>
      <nav className="board__nav" aria-label="信誉榜">{BOARD_TABS.map((tab) =>
        <Link key={tab} to={boardPath(tab)} aria-current={tab === props.tab ? 'page' : undefined}>{TAB_LABEL[tab]}</Link>)}</nav>
      <BoardBody {...props} data={data} />
    </div>
  </Modal>;
}
