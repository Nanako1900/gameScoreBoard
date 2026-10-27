import './draft-note.css';

interface DraftNoteProps {
  /** When the draft was last kept; null → nothing is stored, nothing is said. */
  savedAt: number | null;
  /** Characters written, for free-text drafts. */
  length?: number;
  onClear?: () => void;
}

const SAVED = '草稿已存在这台设备';

/** 「草稿已存在这台设备 · 写了 42 字」 + optional 清空 (spec §5 #4). */
export function DraftNote({ savedAt, length, onClear }: DraftNoteProps): JSX.Element | null {
  if (savedAt === null) return null;
  return (
    <p className="draft-note">
      <span>{length === undefined ? SAVED : `${SAVED} · 写了 ${length} 字`}</span>
      {onClear && (
        <button type="button" className="draft-note__clear" onClick={onClear}>
          清空
        </button>
      )}
    </p>
  );
}
