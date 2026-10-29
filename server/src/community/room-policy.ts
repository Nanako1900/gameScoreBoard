import { fixedManagerRefs, isFixedRoom } from './fixed-rooms';
import type { StoredRoom } from './store';

/** Visibility and current membership are checked separately at admission and
 * again before Discord writes. Temporary rooms deliberately have shared controls. */
export function canControlRoom(actor: { memberRef: string | null; isAdmin: boolean }, room: StoredRoom): boolean {
  return actor.isAdmin || !!actor.memberRef && (!isFixedRoom(room) || fixedManagerRefs(room).includes(actor.memberRef));
}
