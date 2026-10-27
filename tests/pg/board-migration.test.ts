// S4 board producers and repeatable upgrade: local PostgreSQL only.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { pool } from './cloudflare-test';

const migration = () => readFileSync(new URL('../../server/migrations/0011_board.sql', import.meta.url), 'utf8');
async function queued() {
  return (await pool.query("SELECT id, kind, entity, entity_id, dedupe_key, payload, available_at, claim_token, result FROM outbox WHERE entity = 'board' ORDER BY id")).rows;
}
async function people() {
  await pool.query("INSERT INTO users (id, username) VALUES ('a', '甲'), ('j', '裁判')");
  await pool.query("DELETE FROM outbox WHERE entity = 'board'");
}
async function record() {
  return String((await pool.query("INSERT INTO records (subject_id, reporter_id, type, delta, status) VALUES ('a', 'j', 'no_show', -10, 'awaiting_statement') RETURNING id")).rows[0].id);
}

describe('board producers migration', () => {
  it('is repeatable, allows board while preserving legacy entities and historical data', async () => {
    await people();
    await pool.query("INSERT INTO game_sessions (organizer_id, title, starts_at) VALUES ('j', '历史约局', '2099-01-01T12:00:00.000Z')");
    await pool.query("INSERT INTO discord_messages (entity, entity_id, purpose, channel_id, message_id) VALUES ('session', '1', 'card', 'old-channel', 'old-message')");
    await pool.query(migration()); await pool.query(migration());
    for (const entity of ['record', 'session', 'report', 'link', 'user', 'board']) {
      await pool.query('INSERT INTO outbox (kind, entity, entity_id, dedupe_key) VALUES ($1, $2, $2, $2)', ['history', entity]);
    }
    await pool.query("INSERT INTO discord_messages (entity, entity_id, purpose, channel_id, message_id) VALUES ('board', 'main', 'board', 'board-channel', 'board-message')");
    expect((await pool.query('SELECT title FROM game_sessions')).rows).toEqual([{ title: '历史约局' }]);
    expect((await pool.query("SELECT message_id FROM discord_messages WHERE entity='session'")).rows).toEqual([{ message_id: 'old-message' }]);
    const triggers = (await pool.query("SELECT tgname, (tgtype::int & 1) AS per_row FROM pg_trigger WHERE tgname IN ('score_events_board_refresh', 'records_board_refresh', 'users_board_refresh', 'weekly_reports_board_refresh') ORDER BY tgname")).rows;
    expect(triggers).toHaveLength(4); expect(triggers.every(row => row.per_row === 0)).toBe(true);
    const guards = (await pool.query("SELECT tgname, (tgtype::int & 1) AS per_row, (tgtype::int & 2) AS before_statement FROM pg_trigger WHERE tgname IN ('score_events_board_lock', 'records_board_lock', 'users_board_lock', 'weekly_reports_board_lock') ORDER BY tgname")).rows;
    expect(guards).toHaveLength(4);
    expect(guards.every(row => row.per_row === 0 && row.before_statement === 2)).toBe(true);
    const watched = (await pool.query("SELECT b.tgname FROM pg_trigger b JOIN pg_trigger a ON a.tgrelid = b.tgrelid AND a.tgname = replace(b.tgname, '_board_lock', '_board_refresh') WHERE b.tgname IN ('score_events_board_lock', 'records_board_lock', 'users_board_lock', 'weekly_reports_board_lock') AND (b.tgtype::int & ~2) = a.tgtype::int AND b.tgattr = a.tgattr")).rows;
    expect(watched).toHaveLength(4);
  });
  it('queues one score change refresh for about ten seconds later', async () => {
    await people();
    await pool.query("INSERT INTO score_events (user_id, delta, reason, resulting_score) VALUES ('a', -1, 'admin_adjust', 99)");
    expect(await queued()).toEqual([expect.objectContaining({ kind: 'board.refresh', entity: 'board', entity_id: 'main', dedupe_key: 'board:main:refresh', payload: {} })]);
    const { seconds } = (await pool.query("SELECT EXTRACT(EPOCH FROM available_at - now())::float AS seconds FROM outbox WHERE entity='board'")).rows[0];
    expect(seconds).toBeGreaterThan(8); expect(seconds).toBeLessThanOrEqual(10);
  });
  it('coalesces another table change without postponing the first refresh', async () => {
    await people(); const id = await record(); const [first] = await queued();
    await pool.query("UPDATE records SET status='judging' WHERE id=$1", [id]);
    expect(await queued()).toEqual([first]);
    await pool.query("UPDATE outbox SET available_at=now()+interval '5 seconds' WHERE entity='board'");
    const [earlier] = await queued(); await pool.query("UPDATE users SET score=90 WHERE id='a'");
    expect(await queued()).toEqual([earlier]);
  });
  it('suppresses all producers during a history import', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN'); await client.query("SET LOCAL edg.importing='on'");
      await client.query("INSERT INTO users (id, username) VALUES ('a', '甲'), ('j', '裁判')");
      await client.query("INSERT INTO records (subject_id, reporter_id, type, delta, status) VALUES ('a', 'j', 'no_show', -10, 'decided')");
      await client.query("INSERT INTO score_events (user_id, delta, reason, resulting_score) VALUES ('a', -1, 'admin_adjust', 99)");
      await client.query("INSERT INTO weekly_reports (week_start, stats_json, narrative, source) VALUES ('2026-10-26', '{}', '历史战报', 'fallback')");
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    expect(await queued()).toEqual([]);
  });
  it.each(['username', 'display_name', 'is_participant', 'score'])('refreshes watched users.%s changes', async (column) => {
    await people(); const values: Record<string, unknown> = { username: '新账号名', display_name: '新显示名', is_participant: 1, score: 90 };
    await pool.query(`UPDATE users SET ${column}=$1 WHERE id='a'`, [values[column]]); expect(await queued()).toHaveLength(1);
  });
  it.each(['insert', 'delete'])('refreshes user %s', async (action) => {
    await people();
    await pool.query(action === 'insert' ? "INSERT INTO users (id, username) VALUES ('b', '乙')" : "DELETE FROM users WHERE id='a'");
    expect(await queued()).toHaveLength(1);
  });
  it.each(['insert', 'status', 'delete'])('refreshes record %s', async (action) => {
    await people(); const id = await record();
    if (action !== 'insert') {
      await pool.query("DELETE FROM outbox WHERE entity='board'");
      await pool.query(action === 'status' ? "UPDATE records SET status='judging' WHERE id=$1" : 'DELETE FROM records WHERE id=$1', [id]);
    }
    expect(await queued()).toHaveLength(1);
  });
  it.each(['insert', 'update'])('refreshes weekly report %s', async (action) => {
    await people(); await pool.query("INSERT INTO weekly_reports (week_start, stats_json, narrative, source) VALUES ('2026-10-26', '{}', '战报', 'fallback')");
    if (action === 'update') { await pool.query("DELETE FROM outbox WHERE entity='board'"); await pool.query("UPDATE weekly_reports SET narrative='更新'"); }
    expect(await queued()).toHaveLength(1);
  });
  it('ignores unrelated role and narrative-only changes', async () => {
    await people(); await record(); await pool.query("DELETE FROM outbox WHERE entity='board'");
    await pool.query("UPDATE users SET is_judge=1 WHERE id='a'");
    await pool.query("UPDATE records SET claim='只更新非公开经过'"); expect(await queued()).toEqual([]);
  });
  it('rolls the refresh back with its source change', async () => {
    await people(); const client = await pool.connect();
    try { await client.query('BEGIN'); await client.query("UPDATE users SET score=88 WHERE id='a'"); await client.query('ROLLBACK'); }
    finally { client.release(); }
    expect(await queued()).toEqual([]);
  });
  it.each(['processed', 'claimed'])('schedules a new refresh after the old one is %s without changing its claim', async (state) => {
    await people(); await pool.query("UPDATE users SET score=90 WHERE id='a'");
    await pool.query(state === 'processed' ? "UPDATE outbox SET processed_at=now(),result='sent' WHERE entity='board'"
      : "UPDATE outbox SET claim_token='11111111-1111-4111-8111-111111111111', claimed_at=now() WHERE entity='board'");
    const [old] = await queued(); await pool.query("UPDATE users SET score=89 WHERE id='a'");
    const rows = await queued(); expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: old.id, claim_token: old.claim_token, result: old.result, dedupe_key: `board:main:refresh:was:${old.id}` });
    expect(rows[1]).toMatchObject({ dedupe_key: 'board:main:refresh', claim_token: null, result: null });
  });
  it('does not deadlock a case transaction against an admin score update', async () => {
    await people(); const id = await record();
    await pool.query("DELETE FROM outbox WHERE entity='board'");
    const caseTx = await pool.connect(); const adminTx = await pool.connect();
    let adminWork: Promise<{ ok: true } | { ok: false; error: unknown }> | undefined;
    try {
      const { pid } = (await adminTx.query('SELECT pg_backend_pid() AS pid')).rows[0];
      await caseTx.query('BEGIN'); await adminTx.query('BEGIN');
      // The existing case mutators lock records first, then move the user's score.
      await caseTx.query('UPDATE records SET status=status WHERE id=$1', [id]);
      adminWork = (async () => {
        try {
          await adminTx.query("UPDATE users SET score=90 WHERE id='a'");
          await adminTx.query('COMMIT');
          return { ok: true as const };
        } catch (error) {
          await adminTx.query('ROLLBACK');
          return { ok: false as const, error };
        }
      })();
      await vi.waitFor(async () => {
        const { waiting } = (await pool.query("SELECT wait_event_type='Lock' AS waiting FROM pg_stat_activity WHERE pid=$1", [pid])).rows[0];
        expect(waiting).toBe(true);
      }, { timeout: 2_000, interval: 10 });
      let caseError: unknown;
      try {
        await caseTx.query("UPDATE users SET score=89 WHERE id='a'");
        await caseTx.query('COMMIT');
      } catch (error) {
        caseError = error;
        await caseTx.query('ROLLBACK');
      }
      const adminOutcome = await adminWork;
      expect(caseError).toBeUndefined();
      expect(adminOutcome).toEqual({ ok: true });
      expect((await pool.query("SELECT score FROM users WHERE id='a'")).rows).toEqual([{ score: 90 }]);
      expect(await queued()).toHaveLength(1);
    } finally {
      await caseTx.query('ROLLBACK');
      // Releasing the case lock also lets a still-waiting admin finish on assertion failure.
      await adminWork;
      await adminTx.query('ROLLBACK');
      caseTx.release(); adminTx.release();
    }
  }, 15_000);
  it('does not take the board scheduling lock while importing historical source rows', async () => {
    await people(); const client = await pool.connect();
    try {
      await client.query('BEGIN'); await client.query("SET LOCAL edg.importing='on'");
      await client.query("UPDATE users SET score=88 WHERE id='a'");
      expect((await client.query("SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory') AS locked")).rows)
        .toEqual([{ locked: false }]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    expect(await queued()).toEqual([]);
  });
  it('serializes concurrent first refresh producers into one pending event', async () => {
    await people();
    await Promise.all(Array.from({ length: 8 }, (_, index) => pool.query('INSERT INTO users (id,username) VALUES ($1,$1)', [`concurrent-${index}`])));
    expect(await queued()).toHaveLength(1);
  });
});
