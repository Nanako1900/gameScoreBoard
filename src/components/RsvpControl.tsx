import { RSVP_LABEL, SELF_RSVPS, type Rsvp, type SelfRsvp } from '@shared/attendance';
import { IconCheck } from './icons';
import './rsvp-control.css';

type GroupLabel = { label: string; labelledBy?: never } | { label?: never; labelledBy: string };
type RsvpControlProps = GroupLabel & {
  value: Rsvp | null; onAnswer: (rsvp: SelfRsvp) => void; busy?: boolean;
  goingClosed?: boolean; goingClosedNoteId?: string;
  suggested?: SelfRsvp; suggestedNoteId?: string; contextId?: string;
};
function descriptions(...ids: (string | undefined | false)[]): string | undefined {
  return ids.filter(Boolean).join(' ') || undefined;
}
export function RsvpControl(props: RsvpControlProps): JSX.Element {
  return <div className="rsvp" role="group" aria-label={props.label} aria-labelledby={props.labelledBy}>
    {SELF_RSVPS.map((rsvp) => <button key={rsvp} type="button"
      className={`rsvp__button${props.value === rsvp ? ' rsvp__button--active' : ''}${props.suggested === rsvp ? ' sdt__rsvp-btn--suggested' : ''}`}
      aria-pressed={props.value === rsvp}
      aria-describedby={descriptions(props.contextId, rsvp === 'going' && props.goingClosed && props.goingClosedNoteId,
        props.suggested === rsvp && props.suggestedNoteId)}
      disabled={props.busy || (rsvp === 'going' && props.goingClosed)} onClick={() => props.onAnswer(rsvp)}>
      {props.value === rsvp && <IconCheck />}{RSVP_LABEL[rsvp]}
    </button>)}
  </div>;
}
