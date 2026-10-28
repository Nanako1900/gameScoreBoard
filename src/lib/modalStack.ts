// Module-level bookkeeping shared by every open <Modal>, in three independent pieces:
//
// - The layer stack decides which dialog owns the keyboard. Every open layer keeps
//   its own document keydown listener (one per open, see Modal.tsx), and each
//   listener bails out unless its layer is on top — so Escape closes only the
//   upper dialog and Tab cycles only inside it (M10).
// - The inert count keeps `#root` inert while at least one portaled layer is open:
//   only the first acquire marks it, only the last release clears it.
// - The scroll-lock count does the same for a CSS class on <body>. Each
//   Modal used to save and restore the overflow itself, which breaks when two
//   layers unmount in one commit: React runs the outer cleanup first, the inner
//   one then "restores" the outer's `hidden`, and the page never scrolls again.
//
// State is replaced, never mutated in place, so a reader never sees a half-updated
// stack. Ids are never reused, which keeps a StrictMode mount → unmount → mount
// (push, pop, push) from confusing an old layer with a new one.

export type LayerId = number;

let layers: readonly LayerId[] = [];
let nextLayerId: LayerId = 1;
let inertDepth = 0;
let scrollLocks = 0;
const SCROLL_LOCK_CLASS = 'modal-scroll-lock';

/** Register a newly opened layer on top of the stack. */
export function pushLayer(): LayerId {
  const id = nextLayerId;
  nextLayerId += 1;
  layers = [...layers, id];
  return id;
}

/** Remove a layer wherever it sits (out-of-order unmounts and StrictMode re-runs are safe). */
export function popLayer(id: LayerId): void {
  layers = layers.filter((layer) => layer !== id);
}

/** Only the top layer handles Escape and Tab. */
export function isTopLayer(id: LayerId): boolean {
  return layers.length > 0 && layers[layers.length - 1] === id;
}

export function layerCount(): number {
  return layers.length;
}

function appRoot(): HTMLElement | null {
  return document.getElementById('root');
}

/** Ref-counted `inert` + `aria-hidden` on #root (moved here from Modal.tsx:16-38, same semantics). */
export function acquireRootInert(): void {
  const root = appRoot();
  if (!root) {
    return;
  }
  inertDepth += 1;
  if (inertDepth === 1) {
    root.setAttribute('inert', '');
    root.setAttribute('aria-hidden', 'true');
  }
}

export function releaseRootInert(): void {
  const root = appRoot();
  if (!root) {
    return;
  }
  inertDepth = Math.max(0, inertDepth - 1);
  if (inertDepth === 0) {
    root.removeAttribute('inert');
    root.removeAttribute('aria-hidden');
  }
}

/** Ref-counted body class: inline styles belong to their original owner and are never touched. */
export function lockBodyScroll(): void {
  scrollLocks += 1;
  if (scrollLocks === 1) {
    document.body.classList.add(SCROLL_LOCK_CLASS);
  }
}

export function unlockBodyScroll(): void {
  if (scrollLocks === 0) {
    return;
  }
  scrollLocks -= 1;
  if (scrollLocks === 0) {
    document.body.classList.remove(SCROLL_LOCK_CLASS);
  }
}

/** Tests only: empty the stack and counts, strip root inert attributes and our body class. Idempotent. */
export function resetModalStackForTests(): void {
  layers = [];
  inertDepth = 0;
  document.body.classList.remove(SCROLL_LOCK_CLASS);
  scrollLocks = 0;
  const root = appRoot();
  root?.removeAttribute('inert');
  root?.removeAttribute('aria-hidden');
}
