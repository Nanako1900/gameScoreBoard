import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  holdMusicLock, MUSIC_LOCK_CLASS, MUSIC_LOCK_RETRY_MS, type MusicLockClient,
} from '../src/music/consumer-lock';

class FakeLockClient extends EventEmitter implements MusicLockClient {
  queries: Array<{ sql: string; params: unknown[] }> = [];
  ended = false;
  constructor(private readonly granted: boolean, private readonly connectError: Error | null = null) {
    super();
  }
  async connect() {
    if (this.connectError) throw this.connectError;
  }
  async query(sql: string, params: unknown[]) {
    this.queries = [...this.queries, { sql, params }];
    return { rows: [{ granted: this.granted }] };
  }
  async end() { this.ended = true; }
}

function harness(clients: FakeLockClient[]) {
  const queue = [...clients];
  const scheduled: Array<{ ms: number; fn: () => void }> = [];
  const events: string[] = [];
  const lock = holdMusicLock({
    guildId: '123456789012345678',
    connect: () => queue.shift()!,
    schedule: (fn, ms) => {
      const entry = { ms, fn };
      scheduled.push(entry);
      return () => { scheduled.splice(scheduled.indexOf(entry), 1); };
    },
    onAcquired: () => { events.push('acquired'); },
    onLost: () => { events.push('lost'); },
    onWaiting: () => { events.push('waiting'); },
    onError: () => { events.push('error'); },
  });
  const runScheduled = async () => {
    const next = scheduled.shift();
    next?.fn();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { lock, scheduled, events, runScheduled };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('holdMusicLock', () => {
  it('takes a per-guild advisory lock and reports it acquired', async () => {
    const client = new FakeLockClient(true);
    const h = harness([client]);
    await flush();
    expect(h.events).toEqual(['acquired']);
    expect(client.queries).toEqual([{
      sql: 'SELECT pg_try_advisory_lock($1::int4, hashtext($2)) AS granted',
      params: [MUSIC_LOCK_CLASS, 'music:123456789012345678'],
    }]);
    expect(client.ended).toBe(false);
  });

  it('stays idle and retries every 30 s while another process holds the lock', async () => {
    const busy = new FakeLockClient(false);
    const free = new FakeLockClient(true);
    const h = harness([busy, free]);
    await flush();
    expect(h.events).toEqual(['waiting']);
    expect(busy.ended).toBe(true);
    expect(h.scheduled.map((s) => s.ms)).toEqual([MUSIC_LOCK_RETRY_MS]);
    await h.runScheduled();
    expect(h.events).toEqual(['waiting', 'acquired']);
  });

  it('retries after a connection failure', async () => {
    const broken = new FakeLockClient(true, new Error('ECONNREFUSED'));
    const h = harness([broken, new FakeLockClient(true)]);
    await flush();
    expect(h.events).toEqual(['error']);
    await h.runScheduled();
    expect(h.events).toEqual(['error', 'acquired']);
  });

  it('reports a lost lock when the holding connection errors or ends', async () => {
    const client = new FakeLockClient(true);
    const h = harness([client]);
    await flush();
    client.emit('error', new Error('terminated'));
    client.emit('end');
    expect(h.events).toEqual(['acquired', 'lost']);
  });

  it('stop() releases the connection without reporting a loss', async () => {
    const client = new FakeLockClient(true);
    const h = harness([client]);
    await flush();
    await h.lock.stop();
    client.emit('end');
    expect(client.ended).toBe(true);
    expect(h.events).toEqual(['acquired']);
  });
});
