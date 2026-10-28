import { clampScore, tierFor } from '@shared/scoring';
import './score-gauge.css';

interface ScoreGaugeProps {
  score: number;
  size?: number; // px diameter
  strokeWidth?: number;
  label?: string;
  /**
   * Default 'tier' keeps the self-only tier in the aria-label. 'neutral' uses
   * `${label} ${value} 分` (no 段位). Both have the same neutral visual colour.
   * Everyone but the viewer themself gets 'neutral' (spec §6.2).
   */
  tone?: 'tier' | 'neutral';
}

/** The numeral is this fraction of the gauge's diameter. */
const VALUE_FONT_RATIO = 0.34;
/** Gauge scale: 0..100. */
const FULL_SCALE = 100;

interface GaugeRingProps {
  size: number;
  strokeWidth: number;
  value: number;
}

/** Track plus the arc for `value`, starting at 12 o'clock. Decorative: the root carries the label. */
function GaugeRing({ size, strokeWidth, value }: GaugeRingProps): JSX.Element {
  const radius = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - value / FULL_SCALE);
  return (
    <svg
      className="gauge__svg"
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      aria-hidden="true"
    >
      <circle
        className="gauge__track"
        cx={cx}
        cy={cy}
        r={radius}
        fill="none"
        strokeWidth={strokeWidth}
      />
      <circle
        className="gauge__arc"
        cx={cx}
        cy={cy}
        r={radius}
        fill="none"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        transform={`rotate(-90 ${cx} ${cy})`}
      />
      <text className="gauge__center" x={cx} y={cy} textAnchor="middle" dominantBaseline="central">
        <tspan className="gauge__value tabular" fontSize={size * VALUE_FONT_RATIO}>{value}</tspan>
        <tspan className="gauge__unit" fontSize={Math.min(16, size * 0.13)} dx={size * 0.025}>分</tspan>
      </text>
    </svg>
  );
}

/**
 * SVG circular gauge (0..100), with one neutral colour for every score.
 * The tier label is only available on the viewer's own gauge. Native SVG
 * dimensions preserve arbitrary sizes without inline CSS.
 */
export function ScoreGauge({
  score,
  size = 132,
  strokeWidth = 10,
  label = '信誉分',
  tone = 'tier',
}: ScoreGaugeProps): JSX.Element {
  const value = clampScore(score);
  const tier = tierFor(value);
  const neutral = tone === 'neutral';
  return (
    <div
      className={neutral ? 'gauge gauge--neutral' : 'gauge'}
      role="img"
      aria-label={neutral ? `${label} ${value} 分` : `${label} ${value} 分，段位 ${tier.name}`}
    >
      <GaugeRing size={size} strokeWidth={strokeWidth} value={value} />
    </div>
  );
}
