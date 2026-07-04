import { useId } from 'react';
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

/** Hand-rolled SVG line chart of score over time. Y axis fixed to 0..100. */
export function HistoryChart({ history, color }: HistoryChartProps): JSX.Element {
  const gradientId = useId();

  if (history.length === 0) {
    return <p className="chart__empty">暂无走势数据。</p>;
  }

  const innerW = W - PAD_X * 2;
  const innerH = H - PAD_TOP - PAD_BOTTOM;
  const n = history.length;

  const x = (i: number): number => (n === 1 ? W / 2 : PAD_X + (innerW * i) / (n - 1));
  const y = (score: number): number => PAD_TOP + innerH * (1 - clamp01(score / 100));

  const points = history.map((p, i) => ({ px: x(i), py: y(p.score), point: p }));
  const line = points.map((p) => `${p.px.toFixed(1)},${p.py.toFixed(1)}`).join(' ');
  const area =
    `${PAD_X},${(PAD_TOP + innerH).toFixed(1)} ` +
    points.map((p) => `${p.px.toFixed(1)},${p.py.toFixed(1)}`).join(' ') +
    ` ${(W - PAD_X).toFixed(1)},${(PAD_TOP + innerH).toFixed(1)}`;

  const gridLines = [0, 25, 50, 75, 100];
  const first = history[0];
  const last = history[n - 1];

  return (
    <figure className="chart" style={{ ['--accent' as string]: color }}>
      <svg
        className="chart__svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`分数走势，从 ${first.score} 分到 ${last.score} 分`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {gridLines.map((g) => {
          const gy = y(g);
          return (
            <g key={g}>
              <line
                className="chart__grid"
                x1={PAD_X}
                x2={W - PAD_X}
                y1={gy}
                y2={gy}
              />
              <text className="chart__axis" x={4} y={gy + 3.5}>
                {g}
              </text>
            </g>
          );
        })}

        <polygon className="chart__area" points={area} fill={`url(#${gradientId})`} />
        <polyline className="chart__line" points={line} />

        {points.map((p, i) => (
          <circle
            key={i}
            className={`chart__dot${i === n - 1 ? ' chart__dot--last' : ''}`}
            cx={p.px}
            cy={p.py}
            r={i === n - 1 ? 4 : 2.5}
          >
            <title>
              {p.point.score} 分 · {relativeTime(p.point.at)}
            </title>
          </circle>
        ))}
      </svg>

      <figcaption className="chart__caption">
        <span>{relativeTime(first.at)}</span>
        <span className="chart__caption-now">现在 {last.score} 分</span>
      </figcaption>
    </figure>
  );
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
