import './page-bar.css';

interface PageBarProps {
  /** The button's visible text, and so its accessible name (P1 passes 返回). */
  backLabel: string;
  /** Callers pass their onClose, which goes back in history. */
  onBack: () => void;
  /** Context once the page's own heading has scrolled away; hidden from assistive tech (not a heading). */
  title?: string;
  /** Right-hand controls (P3's 分享, P4's ⋯); none in P1. */
  actions?: React.ReactNode;
}

/** The sticky top of a page-form view (spec §3.5, §3.8). Drawers use Modal's own ✕ instead. */
export function PageBar({ backLabel, onBack, title, actions }: PageBarProps): JSX.Element {
  return (
    <div className="pagebar">
      <button type="button" className="pagebar__back" onClick={onBack}>
        <span aria-hidden="true">‹</span> {backLabel}
      </button>
      {title && (
        <span className="pagebar__title" aria-hidden="true">
          {title}
        </span>
      )}
      {actions && <div className="pagebar__actions">{actions}</div>}
    </div>
  );
}
