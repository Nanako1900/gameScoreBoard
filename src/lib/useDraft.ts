import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { DRAFT_SAVE_DEBOUNCE_MS } from './constants';
import { clearDraft, readDraft, writeDraft, type DraftKind, type StoredDraft } from './drafts';

export interface DraftOptions<T> {
  validate: (raw: unknown) => T | null;
  isEmpty: (value: T) => boolean;
  /** A private editor may revoke its actor lease before timers/unmount flushes. */
  canPersist?: () => boolean;
}

export interface DraftState<T> {
  value: T;
  setValue: (next: T | ((prev: T) => T)) => void;
  /** value came from storage on mount */
  restored: boolean;
  savedAt: number | null;
  /** !isEmpty(value) */
  dirty: boolean;
  /** remove storage + reset to initial (after a successful submit) */
  clear: () => void;
}

/** Write a non-empty value (returns when it was kept), or drop the key for an empty one. */
function persist<T>(kind: DraftKind, id: number | string | undefined, value: T, isEmpty: (v: T) => boolean): number | null {
  if (isEmpty(value)) {
    clearDraft(kind, id);
    return null;
  }
  const now = Date.now();
  return writeDraft(kind, id, value, now) ? now : null;
}

/** Read once on mount; a draft the validator emptied out counts as none and is dropped. */
function readInitial<T>(kind: DraftKind, id: number | string | undefined, options: DraftOptions<T>): StoredDraft<T> | null {
  const draft = readDraft(kind, id, options.validate);
  if (draft && options.isEmpty(draft.value)) {
    clearDraft(kind, id); // e.g. everyone in it has left the roster
    return null;
  }
  return draft;
}

/**
 * Writes `value` DRAFT_SAVE_DEBOUNCE_MS after the last edit, and at once on
 * unmount so a dialog closed mid-debounce keeps its last keystrokes. Returns
 * the "an edit is waiting" flag: setValue raises it, clear lowers it.
 */
function useDraftSaving<T>(
  kind: DraftKind,
  id: number | string | undefined,
  value: T,
  isEmpty: (value: T) => boolean,
  onSaved: (savedAt: number | null) => void,
  canPersist: (() => boolean) | undefined,
): MutableRefObject<boolean> {
  const pendingRef = useRef(false);
  const isEmptyRef = useRef(isEmpty);
  const latestRef = useRef(value);
  const canPersistRef = useRef(canPersist); canPersistRef.current = canPersist;

  useEffect(() => {
    isEmptyRef.current = isEmpty;
    latestRef.current = value;
  });

  useEffect(() => {
    if (!pendingRef.current) return undefined;
    const timer = window.setTimeout(() => {
      pendingRef.current = false;
      if (canPersistRef.current?.() === false) return;
      onSaved(persist(kind, id, value, isEmptyRef.current));
    }, DRAFT_SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [kind, id, value, onSaved]);

  // Unmount: flush an edit still waiting for its debounce (no state update — the component is gone).
  useEffect(
    () => () => {
      if (pendingRef.current && canPersistRef.current?.() !== false) persist(kind, id, latestRef.current, isEmptyRef.current);
    },
    [kind, id],
  );

  return pendingRef;
}

/**
 * A form value mirrored into a local draft (spec §5 #4). `id` must stay the same
 * for the hook's lifetime — callers key the component by it.
 */
export function useDraft<T>(
  kind: DraftKind,
  id: number | string | undefined,
  initial: T,
  options: DraftOptions<T>,
): DraftState<T> {
  const [restoredDraft] = useState(() => readInitial(kind, id, options));
  const [value, setRawValue] = useState<T>(() => (restoredDraft ? restoredDraft.value : initial));
  const [savedAt, setSavedAt] = useState<number | null>(restoredDraft?.savedAt ?? null);
  const [restored, setRestored] = useState(restoredDraft !== null);
  const initialRef = useRef(initial);
  const pendingRef = useDraftSaving(kind, id, value, options.isEmpty, setSavedAt, options.canPersist);

  const setValue = useCallback((next: T | ((prev: T) => T)): void => {
    pendingRef.current = true;
    setRawValue((prev) => (typeof next === 'function' ? (next as (p: T) => T)(prev) : (next as T)));
  }, [pendingRef]);

  const clear = useCallback((): void => {
    pendingRef.current = false;
    clearDraft(kind, id);
    setRawValue(initialRef.current);
    setSavedAt(null);
    setRestored(false);
  }, [kind, id, pendingRef]);

  return { value, setValue, restored, savedAt, dirty: !options.isEmpty(value), clear };
}
