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
  /**
   * Home page: title, dates, a few numbers and the narrative's first sentence.
   * Renders no .wr-award at all — the home page names no 鸽王 (spec §2.4).
   */
  compact?: boolean;
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

/** Up to and including the first 。！？!?… (and any closing quote after it); the whole text if none. */
function firstSentence(text: string): string {
  const trimmed = text.trim();
  const match = /^[\s\S]*?[。！？!?…]+[」』”"）)]*/.exec(trimmed);
  return match ? match[0] : trimmed;
}

function attendance(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}

interface ReportHeadProps {
  report: WeeklyReport;
  stale: boolean;
  regenerating: boolean;
  onRegenerate?: () => void;
  onDismiss: () => void;
}

/** Shared by the full and the compact card: the h2 wording (/上周战报/, /往期战报/) is locked by tests. */
function ReportHead({ report, stale, regenerating, onRegenerate, onDismiss }: ReportHeadProps): JSX.Element {
  const s = report.stats;
  return (
    <>
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
          <button type="button" className="wr__close" onClick={onDismiss} aria-label="本周不再显示">
            ✕
          </button>
        </div>
      </header>
      {stale && <p className="wr__note">上周的战报周一 10:30 之后发布。</p>}
    </>
  );
}

/** The home page's version: no awards, and only the narrative's first sentence. */
function CompactBody({ report }: { report: WeeklyReport }): JSX.Element {
  const s = report.stats;
  return (
    <>
      <p className="wr__narrative wr__narrative--compact">{firstSentence(report.narrative)}</p>
      <p className="wr__compact-stats">
        <span>开局 <strong className="tabular">{s.sessionsPlayed}</strong></span>
        <span aria-hidden="true">·</span>
        <span>立案 <strong className="tabular">{s.casesFiled}</strong></span>
        {s.attendanceRate !== null && (
          <>
            <span aria-hidden="true">·</span>
            <span>出勤率 <strong className="tabular">{attendance(s.attendanceRate)}</strong></span>
          </>
        )}
      </p>
    </>
  );
}

function FullBody({ report }: { report: WeeklyReport }): JSX.Element {
  const s = report.stats;
  return (
    <>
      <p className="wr__narrative">{report.narrative}</p>

      <div className="wr__stats">
        <Stat value={String(s.sessionsPlayed)} label="开局" />
        <Stat value={String(s.casesFiled)} label="立案" />
        <Stat value={String(s.totalPenalty)} label="总扣分" tone={s.totalPenalty < 0 ? 'down' : undefined} />
        <Stat value={attendance(s.attendanceRate)} label="出勤率" />
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
    </>
  );
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
  compact = false,
}: WeeklyReportCardProps): JSX.Element | null {
  const [hidden, setHidden] = useState(() => isDismissed(report.week_start));
  if (hidden) return null;

  const dismiss = (): void => {
    remember(report.week_start);
    setHidden(true);
  };

  return (
    <section className={`wr${compact ? ' wr--compact' : ''}`} aria-labelledby="wr-title">
      <ReportHead
        report={report}
        stale={stale}
        regenerating={regenerating}
        onRegenerate={onRegenerate}
        onDismiss={dismiss}
      />
      {compact ? <CompactBody report={report} /> : <FullBody report={report} />}
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
