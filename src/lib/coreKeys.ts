// Keys of the home-page data loaded by src/lib/coreData.ts. Kept in their own
// pure module so the refresh policy can be unit-tested without the fetch client
// (src/api.ts reads import.meta.env, which tests/unit cannot type-check).

export type CoreKey = 'config' | 'leaderboard' | 'records' | 'me' | 'report';

/** First load and the error page's 重新加载: everything. */
export const ALL_CORE_KEYS: readonly CoreKey[] = Object.freeze([
  'config',
  'leaderboard',
  'records',
  'me',
  'report',
]);

/** After any write a child reports via onChanged (incl. admin 改分/设裁判/改判/撤销). */
export const CHANGE_KEYS: readonly CoreKey[] = Object.freeze(['leaderboard', 'records', 'me']);

/** Tab became visible again: no config (spec §5 #10) unless the weekly reset has passed. */
export const VISIBLE_KEYS: readonly CoreKey[] = Object.freeze(['leaderboard', 'records', 'me']);
