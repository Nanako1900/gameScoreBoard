import { describe, expect, it } from 'vitest';
import { REVOKE_WINDOW_MS } from '../../shared/scoring';
import { formatRevokeLeft, revokeMsLeft } from '../../src/lib/revoke';

// The reporter's 15-minute revoke window, counted from created_at — the same
// clock revokeCase uses (worker/cases.ts:423) — and never shown as negative.

const MINUTE = 60_000;
const FILED = '2026-10-26 12:00:00'; // SQLite UTC, as the API sends it
const FILED_MS = Date.parse('2026-10-26T12:00:00Z');

describe('revokeMsLeft', () => {
  it('counts down from created_at, read as UTC', () => {
    expect(revokeMsLeft(FILED, FILED_MS + 3 * MINUTE)).toBe(REVOKE_WINDOW_MS - 3 * MINUTE);
  });

  it('clamps at 0 once the window is over', () => {
    expect(revokeMsLeft(FILED, FILED_MS + REVOKE_WINDOW_MS)).toBe(0);
    expect(revokeMsLeft(FILED, FILED_MS + REVOKE_WINDOW_MS + MINUTE)).toBe(0);
  });

  it('treats an unreadable created_at as closed', () => {
    expect(revokeMsLeft('not a time', FILED_MS)).toBe(0);
  });
});

describe('formatRevokeLeft', () => {
  it('speaks in whole minutes, rounding down', () => {
    expect(formatRevokeLeft(12 * MINUTE + 59_000)).toBe('还剩 12 分钟');
    expect(formatRevokeLeft(MINUTE)).toBe('还剩 1 分钟');
  });

  it('says less than a minute at the very end', () => {
    expect(formatRevokeLeft(59_000)).toBe('还剩不到 1 分钟');
  });
});
