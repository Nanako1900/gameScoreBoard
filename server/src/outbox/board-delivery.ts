// The public board always renders the latest state. The database's delivery
// lock serializes recovery even if a slow Discord request outlives its claim.
import type pg from 'pg';
import { asD1, checkOut, PgD1Database, type PoolLike } from '../db/d1';
import { boardMessage, loadBoardData } from '../discord/board';
import { UNKNOWN_CHANNEL, UNKNOWN_MESSAGE, errorCode, errorStatus, nonceFor,
  type ChannelApi, type DispatcherConfig, type OutboxRow, type Outcome } from './kit';

export const BOARD_KINDS: ReadonlySet<string> = new Set(['board.refresh']);
export interface BoardDeliveryDeps {
  pool: pg.Pool;
  db: D1Database;
  api: ChannelApi;
  config: DispatcherConfig;
}

/** Shared with the source triggers: the same ten-second, coalescing schedule. */
export async function scheduleBoardRefresh(pool: pg.Pool): Promise<void> {
  await pool.query('SELECT schedule_board_refresh()');
}

export async function deliverBoard(row: OutboxRow, deps: BoardDeliveryDeps): Promise<Outcome> {
  const { pool, api, config } = deps;
  const channelId = config.boardChannelId;
  if (!channelId) return { result: 'skipped', note: 'no board channel configured' };
  if (row.entity_id !== 'main') return { result: 'skipped', note: 'not the main board' };
  const tx = await checkOut(pool);
  const { client } = tx;
  try {
    await client.query('BEGIN');
    // Do not lock the outbox row across REST calls: source transactions must
    // still be able to coalesce or queue the next refresh while Discord waits.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('board:main:delivery', 0))");
    const owned = await client.query<{ fresh: boolean }>(
      `SELECT claimed_at >= clock_timestamp() - interval '2 minutes' AS fresh
         FROM outbox WHERE id = $1 AND claim_token = $2 AND processed_at IS NULL`, [row.id, row.claim_token]);
    if (!owned.rowCount) {
      await client.query('COMMIT');
      return { result: 'skipped', note: 'board claim is no longer current' };
    }
    if (!owned.rows[0].fresh) {
      await client.query('COMMIT');
      return { result: 'retry', note: 'board claim expired while waiting for delivery' };
    }
    // Reuse this checked-out connection even with PG_POOL_MAX=1. Board reads
    // never batch; refusing another checkout makes that boundary explicit.
    let readTail = Promise.resolve();
    const reads: PoolLike = {
      query(sql, values) {
        const result = readTail.then(() => client.query(sql, values));
        readTail = result.then(() => undefined, () => undefined);
        return result;
      },
      async connect() { throw new Error('board reads must use the delivery connection'); },
    };
    let data;
    try { data = await loadBoardData(asD1(new PgD1Database(reads))); }
    finally { await readTail; }
    const post = boardMessage(data, config.frontendUrl);
    const findBoards = api.findBoards?.bind(api);
    if (!findBoards) throw new Error('board history recovery is unavailable');
    const posted = (await client.query<{ channel_id: string; message_id: string }>(
      "SELECT channel_id, message_id FROM discord_messages WHERE entity = 'board' AND entity_id = 'main' AND purpose = 'board'",
    )).rows[0];
    const removeDuplicate = async (id: string): Promise<void> => {
      try { await api.remove(channelId, id); }
      catch (error) {
        const code = errorCode(error);
        if (code !== UNKNOWN_MESSAGE && code !== UNKNOWN_CHANNEL) throw error;
      }
    };
    const remember = (id: string) => client.query(
      `INSERT INTO discord_messages(entity, entity_id, purpose, channel_id, message_id)
       VALUES ('board', 'main', 'board', $1, $2)
       ON CONFLICT (entity, entity_id, purpose) DO UPDATE
       SET channel_id = excluded.channel_id, message_id = excluded.message_id, updated_at = now()`, [channelId, id]);
    if (posted && posted.channel_id === channelId) {
      let exists = true;
      try { await api.edit(channelId, posted.message_id, post); }
      catch (error) {
        const code = errorCode(error);
        if (code !== UNKNOWN_MESSAGE && code !== UNKNOWN_CHANNEL) throw error;
        exists = false;
      }
      if (exists) {
        // The saved message is canonical. Scan only newer history to remove
        // sends whose acknowledgement was lost, without rescanning old years.
        for (const id of new Set(await findBoards(channelId, posted.message_id))) {
          if (id !== posted.message_id) await removeDuplicate(id);
        }
        await remember(posted.message_id);
        await client.query('COMMIT');
        return { result: 'sent', note: null };
      }
    }
    // Complete recovery before deciding the channel is empty. A nonce alone
    // cannot find a successful send after a crash lasting several hours.
    const candidates = [...new Set(await findBoards(channelId))];
    candidates.sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
    if (posted && posted.channel_id !== channelId) {
      try { await api.remove(posted.channel_id, posted.message_id); }
      catch (error) {
        const code = errorCode(error);
        if (code !== UNKNOWN_MESSAGE && code !== UNKNOWN_CHANNEL && errorStatus(error) !== 403) throw error;
      }
    }
    if (posted) await client.query("DELETE FROM discord_messages WHERE entity = 'board' AND entity_id = 'main' AND purpose = 'board'");
    const canonical = candidates[0];
    if (canonical) {
      for (const id of candidates.slice(1)) await removeDuplicate(id);
      await remember(canonical);
      try { await api.edit(channelId, canonical, post); }
      catch (error) {
        const code = errorCode(error);
        if (code === UNKNOWN_MESSAGE || code === UNKNOWN_CHANNEL) throw new Error('board disappeared during recovery; retrying');
        throw error;
      }
    } else {
      const sent = await api.send(channelId, { ...post, nonce: nonceFor(row), enforce_nonce: true });
      // A newer claim may now be waiting for our delivery lock. Preserve the
      // successful physical send as fact so it can edit this message; only the
      // dispatcher's guarded finish may acknowledge its own claim.
      await remember(sent.id);
    }
    await client.query('COMMIT');
    return { result: 'sent', note: null };
  } catch (error) {
    if (!tx.broken) await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { tx.release(); }
}
