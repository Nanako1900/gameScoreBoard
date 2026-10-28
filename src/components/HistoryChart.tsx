import { useState } from 'react';
import type { MouseEvent } from 'react';
import type { HistoryPoint } from '../types';
import { relativeTime } from '../lib/time';
import './history-chart.css';

interface HistoryChartProps {
  history: HistoryPoint[];
  color: string;
}

const W = 640;
const H = 200;
const PAD_X = 28;
const PAD_TOP = 16;
const PAD_BOTTOM = 26;
const INNER_W = W - PAD_X * 2;
const INNER_H = H - PAD_TOP - PAD_BOTTOM;
const GRID_LINES = [100, 75, 50, 25, 0];
/** Dot radii (viewBox units): the picked point stands out from the latest, which stands out from the rest. */
const DOT_R = { active: 5, last: 4, base: 2.5 } as const;

interface PlotPoint {
  px: number;
  py: number;
  point: HistoryPoint;
}

const yOf = (score: number): number => PAD_TOP + INNER_H * (1 - clamp01(score / 100));

function plotPoints(history: readonly HistoryPoint[]): PlotPoint[] {
  const n = history.length;
  const xOf = (i: number): number => (n === 1 ? W / 2 : PAD_X + (INNER_W * i) / (n - 1));
  return history.map((point, i) => ({ px: xOf(i), py: yOf(point.score), point }));
}

/** The point nearest a tap at `offsetX` of a plot `width` px wide (the SVG stretches to fit). */
function nearestIndex(offsetX: number, width: number, n: number): number {
  if (n <= 1 || width <= 0) return n - 1;
  const i = Math.round((((offsetX / width) * W - PAD_X) / INNER_W) * (n - 1));
  return Math.max(0, Math.min(n - 1, i));
}

const readout = (p: HistoryPoint): string => `${p.score} 分 · ${relativeTime(p.at)}`;

interface ChartSvgProps {
  points: readonly PlotPoint[];
  active: number;
  color: string;
}

function ChartSvg({ points, active, color }: ChartSvgProps): JSX.Element {
  const coords = points.map((p) => `${p.px.toFixed(1)},${p.py.toFixed(1)}`).join(' ');
  const floor = (PAD_TOP + INNER_H).toFixed(1);
  const area = `${PAD_X},${floor} ${coords} ${(W - PAD_X).toFixed(1)},${floor}`;
  const first = points[0].point;
  const last = points[points.length - 1].point;
  return (
    <svg
      className="chart__svg"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`分数走势，从 ${first.score} 分到 ${last.score} 分`}
    >
      {GRID_LINES.map((g) => (
        <line key={g} className="chart__grid" x1={PAD_X} x2={W - PAD_X} y1={yOf(g)} y2={yOf(g)} />
      ))}
      <polygon className="chart__area" points={area} fill={color} fillOpacity={0.08} />
      <polyline className="chart__line" points={coords} stroke={color} />
      {points.map((p, i) => (
        <circle
          key={i}
          className={`chart__dot${i === points.length - 1 ? ' chart__dot--last' : ''}${i === active ? ' chart__dot--active' : ''}`}
          cx={p.px}
          cy={p.py}
          r={i === active ? DOT_R.active : i === points.length - 1 ? DOT_R.last : DOT_R.base}
          stroke={color}
          fill={i === active || i === points.length - 1 ? color : 'var(--panel)'}
        >
          <title>{readout(p.point)}</title>
        </circle>
      ))}
    </svg>
  );
}

/** Five fixed HTML ticks keep readable text and follow the visual top-to-bottom order. */
function AxisTicks(): JSX.Element {
  return (
    <div className="chart__ticks" aria-hidden="true">
      {GRID_LINES.map((g) => (
        <span key={g} className={`chart__tick chart__tick--${g} tabular`}>
          {g}
        </span>
      ))}
    </div>
  );
}

/** A pick belongs to the history it was made on: new data (another player, a refresh) starts at the latest point. */
interface Pick {
  of: readonly HistoryPoint[];
  index: number;
}

/**
 * Hand-rolled SVG line chart of score over time. Y axis fixed to 0..100.
 *
 * The axis numbers are HTML beside the plot, not SVG <text>: the SVG
 * stretches to the card (preserveAspectRatio="none"), which shrank 11px labels
 * to ~6px on a phone (M26). Tapping the plot, or the range input under it,
 * picks a point and shows its score — hover-only <title> left touch and
 * keyboard users with nothing.
 */
export function HistoryChart({ history, color }: HistoryChartProps): JSX.Element {
  const [pick, setPick] = useState<Pick | null>(null);

  if (history.length === 0) {
    return <p className="chart__empty">暂无走势数据。</p>;
  }

  const points = plotPoints(history);
  const n = points.length;
  const active = pick !== null && pick.of === history && pick.index < n ? pick.index : n - 1;
  const choose = (index: number): void => setPick({ of: history, index });
  const onTap = (event: MouseEvent<HTMLDivElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    choose(nearestIndex(event.clientX - rect.left, rect.width, n));
  };

  return (
    <figure className="chart">
      <div className="chart__plot">
        <AxisTicks />
        <div className="chart__canvas" onClick={onTap}>
          <ChartSvg points={points} active={active} color={color} />
        </div>
      </div>

      {n > 1 && (
        <input
          type="range"
          className="chart__scrub"
          min={0}
          max={n - 1}
          step={1}
          value={active}
          onChange={(e) => choose(Number(e.target.value))}
          aria-label="查看某次分数"
          aria-valuetext={readout(points[active].point)}
        />
      )}
      <p className="chart__readout tabular">{readout(points[active].point)}</p>

      <figcaption className="chart__caption">
        <span>{relativeTime(history[0].at)}</span>
        <span className="chart__caption-now">现在 {history[n - 1].score} 分</span>
      </figcaption>
    </figure>
  );
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
