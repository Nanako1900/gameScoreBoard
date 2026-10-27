import { projectedAfterHeal } from '../lib/forgiveness';
import './forgiveness-note.css';

interface ForgivenessNoteProps {
  /** The verdict's delta; renders nothing when delta >= 0. */
  delta: number;
  /** The subject's score with this delta applied. */
  scoreAfter: number;
  weeklyHeal: number;
  /** Shows 「觉得不公平？可以申诉 ›」. */
  onAppeal?: () => void;
}

/**
 * The way back after a penalty (spec §3.10 判决, §5 语气: 数字照实写，紧跟出路).
 * The delta keeps VerdictCard's ASCII minus, so both read the same number.
 */
export function ForgivenessNote({ delta, scoreAfter, weeklyHeal, onAppeal }: ForgivenessNoteProps): JSX.Element | null {
  if (delta >= 0) return null;
  const projected = projectedAfterHeal(scoreAfter, weeklyHeal);
  return (
    <div className="fgn">
      <p className="fgn__text">{`这次 ${delta}。每周一 0 点回血 +${weeklyHeal}，预计下周一后回到 ${projected}。`}</p>
      {onAppeal && (
        <button type="button" className="fgn__appeal" onClick={onAppeal}>
          觉得不公平？可以申诉<span aria-hidden="true"> ›</span>
        </button>
      )}
    </div>
  );
}
