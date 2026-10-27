import { RSVP_LABEL } from '@shared/attendance';
import type { SelfRsvp } from '@shared/attendance';
import './resume-hint.css';

/** The question's id: the ringed button points at it (aria-describedby), so focusing it reads the question. */
export const RESUME_HINT_TEXT_ID = 'resume-hint-text';

interface ResumeHintProps {
  /** The answer the visitor clicked before logging in. */
  rsvp: SelfRsvp;
  /** 不用了: forget the earlier click. */
  onDismiss: () => void;
}

/**
 * Back from the login page: ask, never write (spec §3.5, "A link never writes").
 * The button it points at is ringed in RsvpControls; only clicking it again answers.
 */
export function ResumeHint({ rsvp, onDismiss }: ResumeHintProps): JSX.Element {
  return (
    <div className="resume-hint" role="status">
      <p id={RESUME_HINT_TEXT_ID} className="resume-hint__text">
        {`你登录前点的是「${RSVP_LABEL[rsvp]}」，确认一下？`}
      </p>
      <button type="button" className="btn btn--ghost btn--sm" onClick={onDismiss}>
        不用了
      </button>
    </div>
  );
}
