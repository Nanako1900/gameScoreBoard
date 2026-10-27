// Local drafts for long or multi-step forms (spec §5 #4): one key per form,
// 'edg.draft.<kind>[.<id>]'. The first-run choice lives in sessionStorage (it
// only has to survive the Discord round trip); everything else in localStorage.
// Storage may be missing, blocked or full (private mode, quota): every access
// is guarded, and writeDraft tells its caller whether anything was kept, so the
// UI never claims a draft that does not exist.

export type DraftKind = 'statement' | 'case' | 'appeal' | 'onboarding';

export interface StoredDraft<T> {
  v: 1;
  savedAt: number;
  value: T;
}

const DRAFT_KINDS: readonly DraftKind[] = ['statement', 'case', 'appeal', 'onboarding'];
const PREFIX = 'edg.draft.';
const VERSION = 1;
const STORAGE_NAMES = ['localStorage', 'sessionStorage'] as const;
const storageHost = globalThis as typeof globalThis & Record<(typeof STORAGE_NAMES)[number], Storage>;

/** 'edg.draft.<kind>.<id>', or 'edg.draft.<kind>' when there is no id. */
export function draftKey(kind: DraftKind, id?: number | string): string {
  return id === undefined ? `${PREFIX}${kind}` : `${PREFIX}${kind}.${id}`;
}

function storageFor(kind: DraftKind): Storage | null {
  if (!DRAFT_KINDS.includes(kind)) return null;
  try {
    return kind === 'onboarding' ? storageHost.sessionStorage : storageHost.localStorage;
  } catch {
    return null; // merely touching storage throws when the browser blocks it
  }
}

function parseEnvelope(raw: string): { savedAt: number; value: unknown } | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { v, savedAt, value } = parsed as Partial<StoredDraft<unknown>>;
    return v === VERSION && typeof savedAt === 'number' && Number.isFinite(savedAt) ? { savedAt, value } : null;
  } catch {
    return null; // not JSON: treated like any other invalid entry
  }
}

/** Parses and validates; an unparsable or invalid entry is removed and null returned. Never throws. */
export function readDraft<T>(
  kind: DraftKind,
  id: number | string | undefined,
  validate: (raw: unknown) => T | null,
): StoredDraft<T> | null {
  const storage = storageFor(kind);
  if (!storage) return null;
  const key = draftKey(kind, id);
  try {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    const envelope = parseEnvelope(raw);
    const value = envelope ? validate(envelope.value) : null;
    if (envelope && value !== null) return { v: VERSION, savedAt: envelope.savedAt, value };
    storage.removeItem(key);
    return null;
  } catch {
    return null; // storage went away mid-read: behave as if there were no draft
  }
}

/** Returns whether the draft was actually kept (false: no storage, or it is full). */
export function writeDraft<T>(
  kind: DraftKind,
  id: number | string | undefined,
  value: T,
  now: number = Date.now(),
): boolean {
  const storage = storageFor(kind);
  if (!storage) return false;
  const envelope: StoredDraft<T> = { v: VERSION, savedAt: now, value };
  try {
    storage.setItem(draftKey(kind, id), JSON.stringify(envelope));
    return true;
  } catch {
    return false; // QuotaExceededError / private mode — the caller shows no "saved" note
  }
}

export function clearDraft(kind: DraftKind, id?: number | string): void {
  const storage = storageFor(kind);
  try {
    storage?.removeItem(draftKey(kind, id));
  } catch {
    // Nothing could have been stored there either.
  }
}

/** Logout: remove every key starting with 'edg.draft.' from BOTH storages. */
export function clearAllDrafts(): void {
  for (const name of STORAGE_NAMES) {
    try {
      const storage = storageHost[name];
      const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(
        (key): key is string => key !== null && key.startsWith(PREFIX),
      );
      keys.forEach((key) => storage.removeItem(key));
    } catch {
      // This storage is unavailable: no draft was kept in it.
    }
  }
}
