// Keeps the last good Discord snapshot on disk (a Docker volume), so that a
// restart — a deploy, an OOM kill, a host reboot — while Discord is
// unreachable still serves the page, flagged stale by its age. The Worker got
// this for free from the edge cache, which survived deploys.

import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { StoredSnapshot } from './snapshot';

function looksLikeSnapshot(value: unknown, guildId: string): value is StoredSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.id === guildId &&
    typeof v.name === 'string' &&
    typeof v.fetchedAt === 'string' &&
    !Number.isNaN(Date.parse(v.fetchedAt)) &&
    typeof v.sources === 'object' &&
    v.sources !== null
  );
}

/** The stored snapshot for this guild, or null (missing, unreadable, another guild). */
export function readSnapshotFile(file: string, guildId: string): StoredSnapshot | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return looksLikeSnapshot(parsed, guildId) ? parsed : null;
  } catch {
    return null;
  }
}

/** Write via a temp file + rename, so a crash mid-write never leaves half a file. */
export function writeSnapshotFile(file: string, snapshot: StoredSnapshot): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(snapshot));
  renameSync(tmp, file);
}
