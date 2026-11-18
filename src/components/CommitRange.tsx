import { useEffect, useRef, useState } from 'react';

interface CommitRangeProps {
  label: string;
  value: number;
  min: number;
  max: number;
  valueText: (value: number) => string;
  /** Called once when the member lets go (or confirms with the keyboard), never per drag tick. */
  onCommit: (value: number) => void;
  disabled?: boolean;
  /** Keep showing the member's own value while their command is still being processed. */
  holdWhile?: boolean;
  className?: string;
}

/** A range input that shows the drag live but reports only the committed value. */
export function CommitRange(props: CommitRangeProps): JSX.Element {
  const { label, value, min, max, valueText, onCommit, disabled = false, holdWhile = false, className } = props;
  const [draft, setDraft] = useState<number | null>(null);
  const editing = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const commit = useRef(onCommit);
  commit.current = onCommit;

  useEffect(() => {
    if (!holdWhile && !editing.current) setDraft(null);
  }, [holdWhile, value]);

  useEffect(() => {
    const element = input.current;
    if (!element) return undefined;
    const onChange = (): void => {
      editing.current = false;
      commit.current(Number(element.value));
    };
    element.addEventListener('change', onChange);
    return () => element.removeEventListener('change', onChange);
  }, []);

  const shown = draft ?? value;
  return (
    <input
      ref={input}
      className={className}
      type="range"
      aria-label={label}
      aria-valuetext={valueText(shown)}
      min={min}
      max={max}
      step={1}
      value={shown}
      disabled={disabled}
      onPointerDown={() => { editing.current = true; }}
      onKeyDown={() => { editing.current = true; }}
      onBlur={() => { editing.current = false; }}
      onChange={(event) => setDraft(Number(event.target.value))}
    />
  );
}
