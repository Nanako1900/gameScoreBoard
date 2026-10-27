// The home page's data: loaded all at once on the first visit, then refreshed
// by key (P0-3). Only account, board, cases and report data are loaded.
import {
  getConfig,
  getLatestReport,
  getLeaderboard,
  getMe,
  getRecords,
} from '../api';
import type {
  Config,
  PendingCounts,
  PublicUser,
  RecordItem,
  User,
  WeeklyReport,
} from '../types';
import { CORE_FEED_LIMIT, PENDING_STATEMENTS_LIMIT } from './constants';
import type { CoreKey } from './coreKeys';

export type { CoreKey } from './coreKeys';
export { ALL_CORE_KEYS, CHANGE_KEYS, VISIBLE_KEYS } from './coreKeys';

export interface CoreData {
  config: Config;
  participants: PublicUser[];
  /** GET /api/records?limit=50 (CORE_FEED_LIMIT). */
  records: RecordItem[];
  me: User | null;
  /** /api/me's counts, kept for the tab title. */
  pending: PendingCounts;
  /** Cases where the signed-in user still owes a statement. */
  myPending: RecordItem[];
  report: WeeklyReport | null;
}

export interface ReloadResult {
  data: CoreData;
  failed: readonly { key: CoreKey; error: unknown }[];
}

type MePart = Pick<CoreData, 'me' | 'pending' | 'myPending'>;

const NO_PENDING: PendingCounts = { statements: 0, appeals: 0 };

/** The current account plus cases where it owes a statement. */
async function loadMe(): Promise<MePart> {
  const { user, pending = NO_PENDING } = await getMe();
  const myPending = user && pending.statements > 0
    ? (await getRecords({ mine: 'pending', limit: PENDING_STATEMENTS_LIMIT })).records
    : [];
  return { me: user, pending, myPending };
}

/** A missing report is normal (first week, or nothing happened) — never fatal. */
function loadReport(fallback: WeeklyReport | null): Promise<WeeklyReport | null> {
  return getLatestReport()
    .then((r) => r.report)
    .catch(() => fallback);
}

const LOADERS: Record<CoreKey, (prev: CoreData) => Promise<Partial<CoreData>>> = {
  config: async () => ({ config: await getConfig() }),
  leaderboard: async () => ({ participants: (await getLeaderboard()).participants }),
  records: async () => ({ records: (await getRecords({ limit: CORE_FEED_LIMIT })).records }),
  me: () => loadMe(),
  report: async (prev) => ({ report: await loadReport(prev.report) }),
};

/** First load: every key, Promise.all — any failure is fatal (the error page), as before. */
export async function loadInitialCore(): Promise<CoreData> {
  const [config, leaderboard, records, me, report] = await Promise.all([
    getConfig(),
    getLeaderboard(),
    getRecords({ limit: CORE_FEED_LIMIT }),
    loadMe(),
    loadReport(null),
  ]);
  return { config, participants: leaderboard.participants, records: records.records, ...me, report };
}

/**
 * Refresh: fetch only `keys` with Promise.allSettled and merge the parts that
 * arrived into a NEW object (untouched parts keep their identity; nothing
 * arrived → `prev` itself). Never throws: failures come back in `failed`.
 */
export async function reloadCore(prev: CoreData, keys: readonly CoreKey[]): Promise<ReloadResult> {
  const unique = [...new Set(keys)];
  const settled = await Promise.allSettled(unique.map((key) => LOADERS[key](prev)));
  const failed = settled.flatMap((result, i) =>
    result.status === 'rejected' ? [{ key: unique[i], error: result.reason as unknown }] : [],
  );
  const patches = settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
  const data =
    patches.length === 0 ? prev : patches.reduce<CoreData>((acc, patch) => ({ ...acc, ...patch }), prev);
  return { data, failed };
}
