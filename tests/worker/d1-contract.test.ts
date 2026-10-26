// The D1 API contract the domain code relies on. This file runs twice: against
// real D1 (vitest.workers.config.ts) and against the PostgreSQL adapter
// (vitest.pg.config.ts, server/src/db/d1.ts). Every assertion must hold on
// both — that is what lets worker/*.ts run unchanged on either engine.

import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { seedUser } from './helpers';

const DB = () => env.DB;

describe('D1 contract — shared by D1 and the PostgreSQL adapter', () => {
  it('stores JS booleans as 1 / 0', async () => {
    await seedUser({ id: 'u' });
    await DB().prepare('UPDATE users SET is_judge = ?, is_admin = ? WHERE id = ?').bind(true, false, 'u').run();
    const row = await DB().prepare('SELECT is_judge, is_admin FROM users WHERE id = ?').bind('u').first();
    expect(row).toEqual({ is_judge: 1, is_admin: 0 });
  });

  it('refuses undefined as a bound value, synchronously at bind()', () => {
    expect(() => DB().prepare('SELECT ? AS v').bind(undefined)).toThrow(/undefined/);
  });

  it('returns numbers — not strings — for COUNT, SUM and integer columns', async () => {
    await seedUser({ id: 'a', score: 40 });
    await seedUser({ id: 'b', score: 2 });
    const row = await DB()
      .prepare('SELECT COUNT(*) AS n, SUM(score) AS total, MAX(score) AS top FROM users')
      .first<{ n: unknown; total: unknown; top: unknown }>();
    expect(row).toEqual({ n: 2, total: 42, top: 40 });
  });

  it('reports last_row_id for an INSERT, and changes for writes', async () => {
    await seedUser({ id: 'u' });
    const insert = await DB()
      .prepare('INSERT INTO score_events (user_id, delta, reason, resulting_score) VALUES (?, ?, ?, ?)')
      .bind('u', 5, 'test', 100)
      .run();
    expect(typeof insert.meta.last_row_id).toBe('number');
    expect(insert.meta.changes).toBe(1);
    const stored = await DB()
      .prepare('SELECT id FROM score_events WHERE id = ?')
      .bind(insert.meta.last_row_id)
      .first<{ id: number }>();
    expect(stored?.id).toBe(insert.meta.last_row_id);

    const update = await DB().prepare("UPDATE users SET score = 1 WHERE id IN ('u', 'nobody')").run();
    expect(update.meta.changes).toBe(1);
    const none = await DB().prepare("UPDATE users SET score = 1 WHERE id = 'nobody'").run();
    expect(none.meta.changes).toBe(0);
  });

  it('run() on an INSERT returns no rows of its own', async () => {
    await seedUser({ id: 'u' });
    const res = await DB()
      .prepare('INSERT INTO weekly_heals (week_start, affected) VALUES (?, ?)')
      .bind('2026-10-26', 3)
      .run();
    expect(res.results).toEqual([]);
  });

  it('first() returns null for no row, and a single column when asked', async () => {
    expect(await DB().prepare('SELECT * FROM users WHERE id = ?').bind('missing').first()).toBeNull();
    await seedUser({ id: 'u', score: 77 });
    expect(await DB().prepare('SELECT score FROM users WHERE id = ?').bind('u').first('score')).toBe(77);
  });

  it('all() returns { results } in ORDER BY order', async () => {
    for (const id of ['c', 'a', 'b']) await seedUser({ id });
    const { results } = await DB().prepare('SELECT id FROM users ORDER BY id ASC').all<{ id: string }>();
    expect(results.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('sorts text by code point, like SQLite BINARY', async () => {
    for (const [id, name] of [['1', 'b'], ['2', 'B'], ['3', '阿'], ['4', 'a']]) {
      await seedUser({ id, username: name });
    }
    const { results } = await DB().prepare('SELECT username FROM users ORDER BY username ASC').all<{ username: string }>();
    expect(results.map((r) => r.username)).toEqual(['B', 'a', 'b', '阿']);
  });

  it('does not treat a ? inside a string literal as a placeholder', async () => {
    const row = await DB().prepare("SELECT 'what?' AS q, ? AS v").bind('x').first<{ q: string; v: string }>();
    expect(row).toEqual({ q: 'what?', v: 'x' });
  });

  it('runs a batch all-or-nothing', async () => {
    await seedUser({ id: 'u', score: 50 });
    await expect(
      DB().batch([
        DB().prepare('UPDATE users SET score = 10 WHERE id = ?').bind('u'),
        DB().prepare('INSERT INTO users (id, username) VALUES (?, ?)').bind('u', 'duplicate'),
      ]),
    ).rejects.toThrow();
    const row = await DB().prepare('SELECT score FROM users WHERE id = ?').bind('u').first<{ score: number }>();
    expect(row?.score).toBe(50);
  });

  it("evaluates datetime('now'[, modifier]) in SQLite's text shape, in UTC", async () => {
    const row = await DB()
      .prepare("SELECT datetime('now') AS now, datetime('now', '-7 days') AS week_ago")
      .first<{ now: string; week_ago: string }>();
    const shape = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
    expect(row?.now).toMatch(shape);
    expect(row?.week_ago).toMatch(shape);
    const now = Date.parse(`${row?.now.replace(' ', 'T')}Z`);
    expect(Math.abs(now - Date.now())).toBeLessThan(60_000);
    const gap = now - Date.parse(`${row?.week_ago.replace(' ', 'T')}Z`);
    expect(gap).toBe(7 * 24 * 3_600_000);
  });

  it('accepts ON CONFLICT DO NOTHING — the portable replacement for INSERT OR IGNORE', async () => {
    const first = await DB()
      .prepare('INSERT INTO weekly_heals (week_start, affected) VALUES (?, ?) ON CONFLICT (week_start) DO NOTHING')
      .bind('2026-10-26', 1)
      .run();
    const second = await DB()
      .prepare('INSERT INTO weekly_heals (week_start, affected) VALUES (?, ?) ON CONFLICT (week_start) DO NOTHING')
      .bind('2026-10-26', 2)
      .run();
    expect(first.meta.changes).toBe(1);
    expect(second.meta.changes).toBe(0);
  });
});
