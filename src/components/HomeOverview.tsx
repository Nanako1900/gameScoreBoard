import { MAX_SCORE } from '@shared/scoring';
import { AUTH_LOGIN_URL } from '../api';
import type { Config, RecordItem, User, WeeklyReport } from '../types';
import { DISCORD_INVITE_URL } from '../lib/env';
import { healPreview, healPreviewText } from '../lib/forgiveness';
import { navigate } from '../lib/router';
import { boardPath, CASES_PATH, casePath, WELCOME_PATH } from '../lib/routes';
import { formatRemaining, parseTimestamp } from '../lib/time';
import { todoBadgeCount, type TodoItem } from '../lib/todo';
import { Link } from './Link';
import { RecordsFeed } from './RecordsFeed';
import { Skeleton } from './Skeleton';
import { WelcomeCard } from './WelcomeCard';
import './home-overview.css';

interface HomeOverviewProps {
  me: User | null;
  config: Config;
  rank: number | null;
  items: readonly TodoItem[] | null;
  records: RecordItem[];
  report: WeeklyReport | null;
  onOpenPlayer: (id: string) => void;
  onDismissOnboarding?: () => void;
  now: number;
  reportStale?: boolean;
}

function ScoreOverview({ me, config, rank, now, onOpenPlayer }: Pick<HomeOverviewProps, 'config' | 'rank' | 'now' | 'onOpenPlayer'> & { me: User }): JSX.Element {
  return <section className="home-overview__score panel" aria-label="我的分数">
    <div><h2>我的信誉分</h2>{me.is_participant && rank !== null && <p className="home-overview__rank">第 {rank} 名</p>}</div>
    {me.is_participant ? <>
      <p className="home-overview__score-number tabular">{me.score}<span> / {MAX_SCORE}</span></p>
      <p className="home-overview__heal">{healPreviewText(healPreview(me.score, config, now))}</p>
    </> : <p className="home-overview__unlisted">当前不上榜</p>}
    <button type="button" className="home-overview__score-open" onClick={() => onOpenPlayer(me.id)}>
      {me.is_participant ? '我的分数与记录' : '我的记录'} <span aria-hidden="true">→</span>
    </button>
  </section>;
}

/** Only counts and the first real deadline belong in the home summary, never case bodies. */
function InboxOverview({ items, now }: Pick<HomeOverviewProps, 'items' | 'now'>): JSX.Element {
  if (items === null) return <section className="home-overview__todo panel" aria-label="待办摘要">
    <h2>待办</h2><Skeleton label="正在读取待办…" lines={2} />
  </section>;
  const count = todoBadgeCount(items);
  if (count === 0) return <p className="home-overview__clear">当前没有待办。</p>;
  const statements = items.filter((item) => item.kind === 'statement');
  const escalations = items.filter((item) => item.kind === 'escalation').length;
  const appeals = items.reduce((total, item) => total + (item.kind === 'appeals' ? item.count : 0), 0);
  const description = [statements.length > 0 ? `${statements.length} 起案件待说明` : null,
    escalations > 0 ? `${escalations} 起升级待确认` : null, appeals > 0 ? `${appeals} 起申诉待复核` : null].filter(Boolean).join('；');
  const deadline = statements.map((item) => item.record.deadline_at)
    .filter((value): value is string => value !== null && Number.isFinite(parseTimestamp(value)))
    .sort((a, b) => parseTimestamp(a) - parseTimestamp(b))[0];
  return <section className="home-overview__todo home-overview__todo--attention panel" aria-label="待办摘要">
    <p className="home-overview__todo-label">需要你处理 · {count} 件</p>
    <h2>有 {count} 件事需要处理</h2><p className="home-overview__todo-description">{description}</p>
    {deadline && <p className="home-overview__deadline">最早陈述期限：{formatRemaining(deadline, now)}</p>}
    <Link className="btn btn--gold" to={CASES_PATH}>查看待办 <span aria-hidden="true">→</span></Link>
  </section>;
}

export function HomeOverview({ me, config, rank, items, records, report, onOpenPlayer, onDismissOnboarding, now, reportStale = false }: HomeOverviewProps): JSX.Element {
  const onboarding = me ? items?.find((item) => item.kind === 'onboarding') : undefined;
  const recent = records.filter((record) => !record.pending_hidden && (record.status === 'decided' || record.status === 'appealed')
    && record.type !== 'on_time_bonus' && record.type !== 'organizer_bonus').slice(0, 3);
  return <div className="home-overview">
    <div className="home-overview__heading"><div>
      <h1>{me ? `你好，${me.username}。` : 'EDG 信誉分'}</h1>
      <p>自己的分数、待办，以及最近发生的事。</p>
    </div><Link className="btn btn--ghost" to={boardPath('list')}>查看信誉榜 <span aria-hidden="true">→</span></Link></div>
    {onboarding?.kind === 'onboarding' && <section className="home-overview__onboarding" aria-label="入户提示">
      <div><h2>还差 {onboarding.missing.length} 步完成入户</h2><p>完成身份与通知设置，及时收到与你有关的提醒。</p></div>
      <div className="home-overview__onboarding-actions"><Link className="btn btn--ghost" to={WELCOME_PATH}>继续入户</Link>
        {onDismissOnboarding && <button type="button" className="btn btn--ghost btn--sm" onClick={onDismissOnboarding}>7 天内不再提示</button>}
      </div>
    </section>}
    {me ? <div className="home-overview__summary">
      <ScoreOverview me={me} config={config} rank={rank} now={now} onOpenPlayer={onOpenPlayer} />
      <InboxOverview items={items} now={now} />
    </div> : <WelcomeCard compact loginUrl={AUTH_LOGIN_URL} discordInviteUrl={DISCORD_INVITE_URL}
      onShowRules={() => navigate(boardPath('rules'))} rulesTo={boardPath('rules')} weeklyHeal={config.weeklyHeal} />}
    <RecordsFeed records={recent} title="最近判决" emptyHint="还没有公开判决。" onSelectRecord={(record) => navigate(casePath(record.id))}
      headerActions={<Link to={`${CASES_PATH}?view=public`}>全部案件 <span aria-hidden="true">→</span></Link>} />
    <section className="home-overview__report" aria-label="每周战报">
      {report ? <><p><span>{reportStale ? '往期战报' : '每周战报'}</span><span className="home-overview__report-period">
        {report.stats.weekStart || report.week_start} — {report.stats.weekEnd}</span></p>
        <Link to={boardPath('report')}>阅读战报 <span aria-hidden="true">→</span></Link></>
        : <p><span>每周战报</span><span className="home-overview__report-period">暂无战报</span></p>}
    </section>
  </div>;
}
