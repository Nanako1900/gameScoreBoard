import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSnapshotFile, writeSnapshotFile } from '../../src/share/snapshot-file';
import type { StoredSnapshot } from '../../src/share/snapshot';

const GUILD = '1114391825336250432';

function snap(): StoredSnapshot {
  return {
    id: GUILD,
    name: "Nanako's Community",
    createdAt: '2023-06-03T03:15:15.559Z',
    inviteUrl: 'https://discord.com/invite/abc',
    guild: null,
    widget: null,
    sources: { guild: '2026-10-26T00:00:00.000Z', widget: null },
    fetchedAt: '2026-10-26T00:00:00.000Z',
    stale: false,
    rejectedInviteCode: null,
  };
}

const dir = () => mkdtempSync(path.join(tmpdir(), 'share-snap-'));

describe('snapshot file', () => {
  it('round-trips a snapshot through a temp file + rename', () => {
    const file = path.join(dir(), 'snap.json');
    writeSnapshotFile(file, snap());
    expect(readSnapshotFile(file, GUILD)).toEqual(snap());
    expect(() => readFileSync(`${file}.tmp`)).toThrow(); // nothing left behind
  });

  it('returns null for a missing, corrupt, or foreign-guild file — never throws', () => {
    const d = dir();
    expect(readSnapshotFile(path.join(d, 'missing.json'), GUILD)).toBeNull();
    writeFileSync(path.join(d, 'corrupt.json'), '{"id":');
    expect(readSnapshotFile(path.join(d, 'corrupt.json'), GUILD)).toBeNull();
    writeFileSync(path.join(d, 'other.json'), JSON.stringify({ ...snap(), id: '999999999999999999' }));
    expect(readSnapshotFile(path.join(d, 'other.json'), GUILD)).toBeNull();
    writeFileSync(path.join(d, 'shape.json'), JSON.stringify({ id: GUILD, name: 'x', fetchedAt: 'not a date', sources: {} }));
    expect(readSnapshotFile(path.join(d, 'shape.json'), GUILD)).toBeNull();
  });
});
