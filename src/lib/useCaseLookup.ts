import { useEffect, useRef, useState } from 'react';
import { ApiError, getRecord } from '../api';
import type { RecordItem, User } from '../types';

/** A cached private read belongs to the actor and the roles used to authorize it. */
export function caseViewerScope(me: User | null): string {
  return JSON.stringify(me ? [me.id, me.is_admin, me.is_judge] : [null]);
}

/** A case already read on the way in (old ?case= link, /cases/:id): the page needs no second GET. */
export interface PinnedCase {
  readonly caseId: number;
  readonly record: RecordItem;
}

export type CaseLookupStatus = 'idle' | 'loading' | 'ready' | 'missing' | 'error';

export interface CaseLookup {
  readonly status: CaseLookupStatus;
  readonly record: RecordItem | null;
}

interface Fetched extends CaseLookup {
  readonly caseId: number;
}

const IDLE: CaseLookup = { status: 'idle', record: null };
const LOADING: CaseLookup = { status: 'loading', record: null };
const NOT_FOUND_STATUS = 404;

/**
 * GET /api/records/:caseId once per case id per mount — never again on a
 * re-render or on the app's refreshes (p8-app pins exactly one request).
 * A seed for the same id is used as is.
 */
export function useCaseLookup(caseId: number | null, seed: PinnedCase | null): CaseLookup {
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const requested = useRef<number | null>(null);
  const seeded = caseId !== null && seed !== null && seed.caseId === caseId;

  useEffect(() => {
    if (caseId === null || seeded || requested.current === caseId) return;
    requested.current = caseId;
    // No "live" flag: StrictMode re-runs this effect, and the first request is the one that counts.
    getRecord(caseId).then(
      ({ record }) => setFetched({ caseId, status: 'ready', record }),
      (err: unknown) => {
        const gone = err instanceof ApiError && err.status === NOT_FOUND_STATUS;
        setFetched({ caseId, status: gone ? 'missing' : 'error', record: null });
      },
    );
  }, [caseId, seeded]);

  if (caseId === null) return IDLE;
  if (seeded) return { status: 'ready', record: seed.record };
  if (fetched !== null && fetched.caseId === caseId) return { status: fetched.status, record: fetched.record };
  return LOADING;
}
