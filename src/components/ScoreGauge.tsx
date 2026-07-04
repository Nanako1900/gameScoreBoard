import { clampScore, tierFor } from '@shared/scoring';
import './score-gauge.css';

interface ScoreGaugeProps {
  score: number;
  size?: number; // px diameter
  strokeWidth?: number;
  label?: string;
}

/**
 * Hand-rolled SVG circular gauge (0..100). Arc color follows tierFor(score).
 * Big tabular numeral in the center. Animates via stroke-dashoffset (transform-
 * friendly enough; respects reduced motion through the CSS transition).
 */
export function ScoreGauge({
  score,
  size = 132,
  strokeWidth = 10,
  label = '信誉分',
}: ScoreGaugeProps): JSX.Element {
  const value = clampScore(score);
  const tier = tierFor(value);
  const radius = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - value / 100);
  const fontSize = size * 0.34;

  return (
    <div
      className="gauge"
      style={{ width: size, height: size, ['--tier' as string]: tier.color }}
      role="img"
      aria-label={`${label} ${value} 分，段位 ${tier.name}`}
    >
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
      <div className="gauge__center">
        <span className="gauge__value tabular" style={{ fontSize }}>
          {value}
        </span>
        <span className="gauge__unit">分</span>
      </div>
    </div>
  );
}
