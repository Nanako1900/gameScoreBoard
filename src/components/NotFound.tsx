import { useEffect, useRef } from 'react';
import { HOME_PATH } from '../lib/routes';
import { BACK_HOME } from '../lib/routeCopy';
import { Link } from './Link';
import './not-found.css';

export interface NotFoundAction {
  readonly label: string;
  readonly to: string;
}

interface NotFoundProps {
  title: string;
  description?: string;
  /** Default 'notfound-title'; the detail views pass their own labelledBy id. */
  headingId?: string;
  /** Default: 回大厅. Detail views may provide their own actions. */
  actions?: readonly NotFoundAction[];
  /** Default true: focus moves to the heading on mount. */
  autoFocus?: boolean;
}

const DEFAULT_ACTIONS: readonly NotFoundAction[] = [{ label: BACK_HOME, to: HOME_PATH }];

/** Rendered by the SPA itself: the hosting never serves a 404.html (spec §2.2). */
export function NotFound({
  title,
  description,
  headingId = 'notfound-title',
  actions = DEFAULT_ACTIONS,
  autoFocus = true,
}: NotFoundProps): JSX.Element {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (autoFocus) headingRef.current?.focus();
  }, [autoFocus]);

  return (
    <div className="notfound">
      <h2 id={headingId} ref={headingRef} className="notfound__title" tabIndex={-1} data-autofocus>
        {title}
      </h2>
      {description && <p className="notfound__description">{description}</p>}
      <div className="notfound__actions">
        {actions.map((action) => (
          <Link key={action.to} to={action.to} className="btn btn--gold">
            {action.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
