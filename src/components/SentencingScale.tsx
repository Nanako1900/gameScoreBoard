import type { SentencingRange } from '../types';
import './sentencing-scale.css';

interface SentencingScaleProps {
  range: SentencingRange;
  /** The delta actually handed down; omit to show the range only. */
  delta?: number;
  /** Compact variant for dense lists. */
  compact?: boolean;
}

/** Position of `value` along [min, max] as a 0–100 percentage. */
function positionOf(range: SentencingRange, value: number): number {
  const span = range.max - range.min;
  if (span === 0) return 50;
  const clamped = Math.max(range.min, Math.min(range.max, value));
  return ((clamped - range.min) / span) * 100;
}

function label(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/**
 * The sentencing ruler: a bar spanning [harshest … most lenient] with the
 * anchor (base) tick and, once judged, the delivered sentence. Makes "判轻了
 * 还是判重了" readable at a glance — which is the whole point of letting an AI
 * pick the number instead of a constant.
 */
export function SentencingScale({
  range,
  delta,
  compact = false,
}: SentencingScaleProps): JSX.Element {
  const basePos = positionOf(range, range.base);
  const hasVerdict = delta !== undefined;
  const deltaPos = hasVerdict ? positionOf(range, delta) : 0;
  const lighter = hasVerdict && delta > range.base;
  const harsher = hasVerdict && delta < range.base;

  return (
    <div className={`scale${compact ? ' scale--compact' : ''}`}>
      <div className="scale__ends">
        <span className="scale__end tabular">{label(range.min)}</span>
        <span className="scale__caption">
          {hasVerdict ? (
            <>
              基准 <span className="tabular">{label(range.base)}</span>
              {lighter && <span className="scale__verb scale__verb--light">从轻</span>}
              {harsher && <span className="scale__verb scale__verb--heavy">从重</span>}
            </>
          ) : (
            <>
              量刑区间 · 基准 <span className="tabular">{label(range.base)}</span>
            </>
          )}
        </span>
        <span className="scale__end tabular">{label(range.max)}</span>
      </div>

      <div
        className="scale__track"
        role="img"
        aria-label={
          hasVerdict
            ? `量刑区间 ${range.min} 到 ${range.max}，基准 ${range.base}，本次判 ${delta}`
            : `量刑区间 ${range.min} 到 ${range.max}，基准 ${range.base}`
        }
      >
        <span className="scale__base" style={{ left: `${basePos}%` }} aria-hidden="true" />
        {hasVerdict && (
          <span
            className={`scale__pin${lighter ? ' scale__pin--light' : ''}${
              harsher ? ' scale__pin--heavy' : ''
            }`}
            style={{ left: `${deltaPos}%` }}
            aria-hidden="true"
          >
            <span className="scale__pin-value tabular">{label(delta)}</span>
          </span>
        )}
      </div>
    </div>
  );
}
