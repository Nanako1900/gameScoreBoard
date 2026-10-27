import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, getRecord } from '../api';
import type { User } from '../types';
import { DEEP_LINK_PARAMS, readDeepLink, withoutParams } from './deepLink';
import { navigate } from './router';
import { HOME_PATH, playerCasePath, sessionPath } from './routes';
import { CASE_GONE, CASE_UNAVAILABLE } from './routeCopy';
import type { PinnedCase } from './useCaseLookup';

// Old links (spec §2.3, kept forever): the bot's DMs say /?case=N and /?session=N.
// They are read once, on '/', and translated into the view's own address.

export type EntryTarget =
  /** /?session=N → '/sessions/N' plus the other parameters. */
  | { readonly kind: 'path'; readonly path: string }
  /** /?case=N → its subject's page, once GET /api/records/N says who that is. */
  | { readonly kind: 'case'; readonly caseId: number; readonly rest: string };

interface EntryTargetInput {
  /** The core data is in. */
  readonly ready: boolean;
  readonly me: User | null;
  /** Read when the target is about to open: the first-run dialog goes first (contract 补充). */
  readonly blocked: () => boolean;
  readonly onPinned: (pinned: PinnedCase) => void;
}

interface EntryTargetResult {
  /** CASE_GONE / CASE_UNAVAILABLE for the lobby's LinkMissingNotice. */
  readonly linkMissing: string | null;
  readonly dismissLinkMissing: () => void;
}

/** Everything a target does not carry along; what is left (utm=…) rides to the new address. */
const ENTRY_PARAMS = ['case', 'session', 'linked', 'onboarding'];
const NOT_FOUND_STATUS = 404;

function readEntryTarget(): EntryTarget | null {
  const { pathname, search } = window.location;
  if (pathname !== HOME_PATH) return null;
  const link = readDeepLink(search);
  if (link === null) return null;
  const rest = withoutParams(search, ENTRY_PARAMS);
  return link.kind === 'session'
    ? { kind: 'path', path: sessionPath(link.id) + rest }
    : { kind: 'case', caseId: link.id, rest };
}

/** case / session always (a bad id too), linked only as the bind's landing; onboarding stays for its own effect. */
function stripEntryParams(): void {
  const { pathname, search } = window.location;
  if (pathname !== HOME_PATH) return;
  const params = new URLSearchParams(search);
  const names = [...DEEP_LINK_PARAMS, ...(params.get('linked') === 'discord' ? ['linked'] : [])];
  if (!names.some((name) => params.has(name))) return;
  navigate(HOME_PATH + withoutParams(search, names), { replace: true });
}

export function useEntryTarget({ ready, blocked, onPinned }: EntryTargetInput): EntryTargetResult {
  const [target] = useState(readEntryTarget);
  const opened = useRef(false);
  const [linkMissing, setLinkMissing] = useState<string | null>(null);
  // Set together with onPinned: navigating from an effect after that commit means the
  // case page already has the record (a store update would otherwise render first).
  const [landing, setLanding] = useState<string | null>(null);

  useEffect(stripEntryParams, []);

  useEffect(() => {
    if (!ready || target === null || opened.current || blocked()) return;
    opened.current = true;
    if (target.kind === 'path') {
      navigate(target.path);
      return;
    }
    getRecord(target.caseId).then(
      ({ record }) => {
        onPinned({ caseId: target.caseId, record });
        setLanding(playerCasePath(record.subject.id, target.caseId) + target.rest);
      },
      (err: unknown) => {
        setLinkMissing(err instanceof ApiError && err.status === NOT_FOUND_STATUS ? CASE_GONE : CASE_UNAVAILABLE);
      },
    );
  }, [ready, target, blocked, onPinned]);

  useEffect(() => {
    if (landing !== null) navigate(landing);
  }, [landing]);

  const dismissLinkMissing = useCallback((): void => setLinkMissing(null), []);
  return { linkMissing, dismissLinkMissing };
}
