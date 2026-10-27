import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WeeklyReportCard } from '../../src/components/WeeklyReportCard';
import type { WeeklyReport } from '../../src/types';

function report(basis?: 'verdict'): WeeklyReport {
  return { week_start: '2026-10-19', narrative: '大家好好约局。', source: 'ai', created_at: '2026-10-26 02:30:00',
    stats: { weekStart: '2026-10-19', weekEnd: '2026-10-25', sessionsPlayed: 3, sessionsCollapsed: 0,
      casesFiled: 2, totalPenalty: -6, absentVerdicts: 0, attendanceRate: 0.8, upcomingNextWeek: 1,
      star: { name: '守约之星', delta: 4 }, pigeon: { name: '慢慢恢复', delta: -6 },
      bestTalker: { name: '好好解释', savedBy: 3 }, harshest: null, topOrganizer: null,
      ...(basis ? { basis } : {}) } };
}

describe('P3-7 weekly report labels and compatibility', () => {
  it('labels last-week awards distinctly from this week highlights', () => {
    render(<WeeklyReportCard report={report()} />);
    expect(screen.getByText('上周之星')).toBeInTheDocument();
    expect(screen.getByText('上周鸽王')).toBeInTheDocument();
    expect(screen.queryByText('本周之星')).not.toBeInTheDocument();
  });
  it.each([false, true])('uses 判决 for new verdict stats, compact=%s', (compact) => {
    const { container } = render(<WeeklyReportCard report={report('verdict')} compact={compact} />);
    expect(container.querySelector(compact ? '.wr__compact-stats' : '.wr__stats')).toHaveTextContent('判决');
    expect(container.querySelector(compact ? '.wr__compact-stats' : '.wr__stats')).not.toHaveTextContent('立案');
  });
  it.each([false, true])('keeps 立案 for old stored stats, compact=%s', (compact) => {
    const { container } = render(<WeeklyReportCard report={report()} compact={compact} />);
    expect(container.querySelector(compact ? '.wr__compact-stats' : '.wr__stats')).toHaveTextContent('立案');
    expect(container.querySelector(compact ? '.wr__compact-stats' : '.wr__stats')).not.toHaveTextContent('判决');
  });
  it('hides only the pigeon award when requested', () => {
    const { container } = render(<WeeklyReportCard report={report('verdict')} hidePigeon />);
    expect(container.querySelectorAll('.wr-award')).toHaveLength(2);
    expect(screen.getByText('上周之星')).toBeInTheDocument();
    expect(screen.getByText('最会说话')).toBeInTheDocument();
    expect(screen.queryByText('上周鸽王')).not.toBeInTheDocument();
    expect(screen.queryByText('慢慢恢复')).not.toBeInTheDocument();
  });
  it('retains the default full award list and compact has no awards', () => {
    const { container, rerender } = render(<WeeklyReportCard report={report()} />);
    expect(container.querySelectorAll('.wr-award')).toHaveLength(3);
    rerender(<WeeklyReportCard report={report('verdict')} compact />);
    expect(container.querySelector('.wr-award')).toBeNull();
  });
});


describe('S1 stored report compatibility', () => {
  it.each([false, true])('keeps nonzero legacy session figures, compact=%s', (compact) => {
    const { container } = render(<WeeklyReportCard report={report()} compact={compact} />);
    expect(container.querySelector(compact ? '.wr__compact-stats' : '.wr__stats')).toHaveTextContent('开局');
    expect(container.querySelector(compact ? '.wr__compact-stats' : '.wr__stats')).toHaveTextContent('3');
    expect(container).toHaveTextContent('80%');
  });
  it.each([false, true])('hides missing session figures from new reports, compact=%s', (compact) => {
    const old = report('verdict');
    const { sessionsPlayed, sessionsCollapsed, attendanceRate, upcomingNextWeek, topOrganizer, ...stats } = old.stats;
    const current = { ...old, stats } as WeeklyReport;
    const { container } = render(<WeeklyReportCard report={current} compact={compact} />);
    expect(container).not.toHaveTextContent(/开局|出勤率|组局劳模|接下来|NaN|undefined/);
    expect(container).toHaveTextContent('判决');
  });
  it.each([false, true])('hides zero legacy session figures, compact=%s', (compact) => {
    const old = report();
    const { container } = render(<WeeklyReportCard report={{ ...old, stats: { ...old.stats,
      sessionsPlayed: 0, attendanceRate: 0, upcomingNextWeek: 0, topOrganizer: { name: '零次', count: 0 } } }} compact={compact} />);
    expect(container).not.toHaveTextContent(/开局|出勤率|组局劳模|接下来|零次/);
  });
});
