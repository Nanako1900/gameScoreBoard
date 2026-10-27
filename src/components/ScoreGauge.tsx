import type { CSSProperties } from 'react';
import { clampScore, tierFor } from '@shared/scoring';
import './score-gauge.css';

interface ScoreGaugeProps {
  score: number;
  size?: number; // px diameter
  strokeWidth?: number;
  label?: string;
  /**
   * Default 'tier' — today's colour and aria-label. 'neutral': ring uses
   * --score-chip-fg, no --tier is set, aria-label is `${label} ${value} 分`
   * (no 段位). Everyone but the viewer themself gets 'neutral' (spec §6.2).
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
    </svg>
  );
}

/**
 * Hand-rolled SVG circular gauge (0..100). Arc color follows tierFor(score),
 * unless tone="neutral": on public views the score is public, but the 段位 is
 * a label the board does not pin on anyone but the viewer. Big tabular numeral
 * in the center. Animates via stroke-dashoffset (respects reduced motion
 * through the CSS transition).
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
  const fontSize = size * VALUE_FONT_RATIO;
  // React applies this through CSSOM, which the CSP allows without 'unsafe-inline'.
  const style: CSSProperties = neutral
    ? { width: size, height: size }
    : { width: size, height: size, ['--tier' as string]: tier.color };

  return (
    <div
      className={neutral ? 'gauge gauge--neutral' : 'gauge'}
      style={style}
      role="img"
      aria-label={neutral ? `${label} ${value} 分` : `${label} ${value} 分，段位 ${tier.name}`}
    >
      <GaugeRing size={size} strokeWidth={strokeWidth} value={value} />
      <div className="gauge__center">
        <span className="gauge__value tabular" style={{ fontSize }}>
          {value}
        </span>
        <span className="gauge__unit">分</span>
      </div>
    </div>
  );
}
