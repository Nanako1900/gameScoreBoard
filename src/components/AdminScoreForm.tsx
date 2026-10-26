import { useEffect, useRef, useState } from 'react';
import { MAX_SCORE, MIN_SCORE } from '@shared/scoring';

interface AdminScoreFormProps {
  username: string;
  score: number;
  busy: boolean;
  onSubmit: (score: number) => void;
}

/**
 * An admin sets a player's score by hand — a correction, not a verdict. Two
 * steps (type the number, then confirm), since it moves the board at once and
 * DMs the player.
 */
export function AdminScoreForm({ username, score, busy, onSubmit }: AdminScoreFormProps): JSX.Element {
  const [value, setValue] = useState(String(score));
  const [confirming, setConfirming] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const stepped = useRef(false);
  // Keyboard users stay where they were: on 确认改分 when asked, back on the
  // number when they cancel (the element they pressed is gone either way).
  useEffect(() => {
    if (confirming) {
      stepped.current = true;
      confirmButton.current?.focus();
    } else if (stepped.current) {
      input.current?.focus();
    }
  }, [confirming]);
  const next = Number(value);
  const valid = value.trim() !== '' && Number.isInteger(next) && next >= MIN_SCORE && next <= MAX_SCORE;
  const changed = valid && next !== score;

  if (confirming && changed) {
    return (
      <div className="pd__score-form" role="group" aria-label="确认调整分数">
        <p className="pd__score-confirm" aria-live="polite">
          把 {username} 的信誉分从 <strong className="tabular">{score}</strong> 改成{' '}
          <strong className="tabular">{next}</strong>？已绑定 Discord 的话会私信通知本人。
        </p>
        <button
          ref={confirmButton}
          type="button"
          className="btn btn--danger btn--sm"
          disabled={busy}
          onClick={() => {
            setConfirming(false);
            onSubmit(next);
          }}
        >
          确认改分
        </button>
        <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => setConfirming(false)}>
          取消
        </button>
      </div>
    );
  }

  return (
    <form
      className="pd__score-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (changed) setConfirming(true);
      }}
    >
      <label className="pd__score-label">
        调整分数
        <input
          ref={input}
          className="pd__score-input tabular"
          type="number"
          inputMode="numeric"
          min={MIN_SCORE}
          max={MAX_SCORE}
          step={1}
          value={value}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      <button type="submit" className="btn btn--ghost btn--sm" disabled={busy || !changed}>
        改分
      </button>
    </form>
  );
}
