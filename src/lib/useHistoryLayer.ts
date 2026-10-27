import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { dropLayerEntry, pushLayerEntry, type LayerEntryId } from './router';

/** The entry this overlay owns; `releasing` while a drop waits one microtask (StrictMode may take it back). */
interface HeldEntry {
  readonly id: LayerEntryId;
  readonly releasing: boolean;
}

/**
 * P1-2 (spec §2.2): while `active` and `name` is set, the overlay owns one
 * history entry, so the back button closes it.
 *
 * - Back button: the router calls onPop → the caller's latest onClose (a leave
 *   confirm may stop it). `pops` re-runs the effect: still open → a new entry,
 *   so the next back press lands on this overlay again; closed → nothing.
 * - UI close (✕, Esc, backdrop, the caller's buttons): onClose already ran;
 *   when `active` drops, the entry is released one microtask later and the
 *   router walks back over it silently. A StrictMode unmount → remount in
 *   between takes the same entry back, so one open leaves one entry.
 */
export function useHistoryLayer(
  active: boolean,
  name: string | undefined,
  onCloseRef: MutableRefObject<() => void>,
): void {
  const [pops, setPops] = useState(0);
  const heldRef = useRef<HeldEntry | null>(null);
  const enabled = active && name !== undefined;

  useEffect(() => {
    if (!enabled || name === undefined) return undefined;
    const current = heldRef.current;
    if (current !== null) {
      heldRef.current = { id: current.id, releasing: false };
    } else {
      const id = pushLayerEntry(name, () => {
        heldRef.current = null;
        setPops((n) => n + 1);
        onCloseRef.current();
      });
      heldRef.current = { id, releasing: false };
    }
    return () => releaseLater(heldRef);
    // `enabled` and `pops` only: like useLayer, a re-render must not push again; `name` is fixed per caller.
  }, [enabled, pops]);
}

function releaseLater(heldRef: MutableRefObject<HeldEntry | null>): void {
  const mine = heldRef.current;
  if (mine === null) return;
  heldRef.current = { id: mine.id, releasing: true };
  queueMicrotask(() => {
    const now = heldRef.current;
    if (now !== null && now.id === mine.id && now.releasing) {
      heldRef.current = null;
      dropLayerEntry(mine.id);
    }
  });
}
