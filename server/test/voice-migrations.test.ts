import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
const schema = () => readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');
const migration = () => readFileSync(new URL('../../migrations/005_voice.sql', import.meta.url), 'utf8');
const tables = ['voice_sessions', 'voice_coverage'];
function shape(db: DatabaseSync, table: string) {
  return { columns: db.prepare(`PRAGMA table_info(${table})`).all(),
    foreignKeys: db.prepare(`PRAGMA foreign_key_list(${table})`).all(),
    indexes: db.prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? ORDER BY name`).all(table) };
}
describe('D1 voice migration', () => {
  it('can run twice and yields the same tables/indexes as a fresh schema', () => {
    const fresh = new DatabaseSync(':memory:'); const upgrade = new DatabaseSync(':memory:');
    try {
      fresh.exec(schema()); upgrade.exec('CREATE TABLE users (id TEXT PRIMARY KEY)');
      upgrade.exec(migration()); upgrade.exec(migration());
      for (const table of tables) expect(shape(upgrade, table)).toEqual(shape(fresh, table));
    } finally { fresh.close(); upgrade.close(); }
  });
  it('does not rewrite existing evidence when reapplied', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(schema()); db.exec("INSERT INTO users (id, username) VALUES ('owner', '玩家')"); db.exec(migration());
      db.exec("INSERT INTO voice_sessions (user_id, discord_user_id, channel_id, channel_name, joined_at, start_reason) VALUES ('owner', 'd', 'c', '频道', '2026-10-27 10:00:00', 'joined')");
      db.exec("INSERT INTO voice_coverage (started_at, last_seen_at) VALUES ('2026-10-27 10:00:00', '2026-10-27 10:01:00')");
      db.exec(migration());
      expect(db.prepare('SELECT COUNT(*) AS n FROM voice_sessions').get()).toMatchObject({ n: 1 });
      expect(db.prepare('SELECT COUNT(*) AS n FROM voice_coverage').get()).toMatchObject({ n: 1 });
    } finally { db.close(); }
  });
});
