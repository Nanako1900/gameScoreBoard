import { useState } from 'react';
import type { WeeklyReport } from '../types';
import './weekly-report.css';

interface WeeklyReportCardProps {
  report: WeeklyReport;
  /** Admin only — re-roll the narrative if it landed flat. */
  onRegenerate?: () => void;
  regenerating?: boolean;
  /** Older than last week: last week's is not out yet (Monday 10:30). */
  stale?: boolean;
}

const DISMISS_KEY = 'edg.report.dismissed';

function isDismissed(weekStart: string): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === weekStart;
  } catch {
    // Private mode / storage disabled: showing the card again is the harmless
    // direction to fail in.
    return false;
  }
}

function remember(weekStart: string): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, weekStart);
  } catch {
    /* nothing to do — the card simply reappears next load */
  }
}

function fmtDelta(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}`;
}

/**
 * 上周战报 — one paragraph of personality on top of numbers that came from SQL.
 *
 * The split is load-bearing: the prose is AI-written and allowed to be playful,
 * the figures below it are computed server-side and rendered deadpan. Nothing in
 * the stat strip is ever phrased as a joke, because a number that reads as a
 * punchline is a number nobody trusts.
 */
export function WeeklyReportCard({
  report,
  onRegenerate,
  regenerating = false,
  stale = false,
}: WeeklyReportCardProps): JSX.Element | null {
  const [hidden, setHidden] = useState(() => isDismissed(report.week_start));
  if (hidden) return null;

  const s = report.stats;
  const dismiss = (): void => {
    remember(report.week_start);
    setHidden(true);
  };

  return (
    <section className="wr" aria-labelledby="wr-title">
      <header className="wr__head">
        <h2 id="wr-title" className="wr__title">
          <span aria-hidden="true">📮</span> {stale ? '往期战报' : '上周战报'}
          <span className="wr__range tabular">
            {shortDate(s.weekStart)} – {shortDate(s.weekEnd)}
          </span>
        </h2>
        <div className="wr__head-actions">
          {report.source === 'fallback' && <span className="wr__flag">AI 未参与</span>}
          {onRegenerate && (
            <button
              type="button"
              className="wr__regen"
              onClick={onRegenerate}
              disabled={regenerating}
            >
              {regenerating ? '重写中…' : '换个说法'}
            </button>
          )}
          <button type="button" className="wr__close" onClick={dismiss} aria-label="本周不再显示">
            ✕
          </button>
        </div>
      </header>
      {stale && <p className="wr__note">上周的战报周一 10:30 之后发布。</p>}

      <p className="wr__narrative">{report.narrative}</p>

      <div className="wr__stats">
        <Stat value={String(s.sessionsPlayed)} label="开局" />
        <Stat value={String(s.casesFiled)} label="立案" />
        <Stat value={String(s.totalPenalty)} label="总扣分" tone={s.totalPenalty < 0 ? 'down' : undefined} />
        <Stat
          value={s.attendanceRate === null ? '—' : `${Math.round(s.attendanceRate * 100)}%`}
          label="出勤率"
        />
      </div>

      <ul className="wr__awards">
        {s.star && <Award emoji="🏆" label="本周之星" who={s.star.name} val={fmtDelta(s.star.delta)} tone="up" />}
        {s.pigeon && (
          <Award emoji="🕊️" label="本周鸽王" who={s.pigeon.name} val={fmtDelta(s.pigeon.delta)} tone="down" />
        )}
        {s.bestTalker && (
          <Award
            emoji="🗣️"
            label="最会说话"
            who={s.bestTalker.name}
            val={`少扣 ${s.bestTalker.savedBy}`}
            tone="up"
          />
        )}
        {s.topOrganizer && (
          <Award
            emoji="📣"
            label="组局劳模"
            who={s.topOrganizer.name}
            val={`${s.topOrganizer.count} 局`}
          />
        )}
      </ul>

      {s.upcomingNextWeek > 0 && (
        <p className="wr__foot">
          接下来已经约了 <strong className="tabular">{s.upcomingNextWeek}</strong> 局。
        </p>
      )}
    </section>
  );
}

interface StatProps {
  value: string;
  label: string;
  tone?: 'up' | 'down';
}

function Stat({ value, label, tone }: StatProps): JSX.Element {
  return (
    <div className="wr-stat">
      <span className={`wr-stat__value tabular${tone ? ` wr-stat__value--${tone}` : ''}`}>
        {value}
      </span>
      <span className="wr-stat__label">{label}</span>
    </div>
  );
}

interface AwardProps {
  emoji: string;
  label: string;
  who: string;
  val: string;
  tone?: 'up' | 'down';
}

function Award({ emoji, label, who, val, tone }: AwardProps): JSX.Element {
  return (
    <li className="wr-award">
      <span className="wr-award__emoji" aria-hidden="true">
        {emoji}
      </span>
      <span className="wr-award__label">{label}</span>
      <span className="wr-award__who">{who}</span>
      <span className={`wr-award__val tabular${tone ? ` wr-award__val--${tone}` : ''}`}>{val}</span>
    </li>
  );
}
