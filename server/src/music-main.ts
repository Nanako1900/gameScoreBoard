// Node entry for the compose service `music`: a second Discord application that
// joins one voice room at a time and plays what members queue on the web player.
// It talks to the app process only through PostgreSQL (music_sessions,
// music_commands and NOTIFY music_commands). See docs/superpowers/specs/2026-11-17-music-bot-design.md.

import { randomUUID } from 'node:crypto';
import { Events } from 'discord.js';
import pg from 'pg';
import { CommunityStore } from './community/store';
import { asD1, installTypeParsers, PgD1Database } from './db/d1';
import { describeError, fetchSessionBudget, MIN_SESSION_STARTS } from './discord/client';
import { createHealthServer, type GatewayState } from './discord/health';
import { envInt } from './env';
import { musicPlayerUrl, musicWanted, readMusicConfig, type MusicConfig } from './music/config';
import { holdMusicLock } from './music/consumer-lock';
import { communityRooms, createMusicIo } from './music/main-deps';
import { createDiscordVoice, createMusicClient } from './music/player';
import { createMusicRuntime } from './music/runtime';
import type { MusicRuntime } from './music/types';
import { MusicStore } from './music/store';

const HEALTH_PORT = 8788;
const TICK_INTERVAL_MS = 2_000;
const LISTEN_RECONNECT_MS = 5_000;
const SHUTDOWN_GRACE_MS = 10_000;
const STOP_GRACE_MS = 5_000;
// Same retry pace as the main bot: restart: unless-stopped brings it back.
const RETRY_LATER_MS = 5 * 60_000;
const PG_CLIENT_OPTIONS = '-c TimeZone=UTC';

/** No token or MUSIC_ENABLED off: stay up and quiet instead of crash-looping. */
function idle(): void {
  console.log('MUSIC_DISCORD_TOKEN is not set or MUSIC_ENABLED is off: the music bot is disabled');
  const health = createHealthServer(() => 'disabled');
  health.listen(HEALTH_PORT, '0.0.0.0');
  const stop = (): void => {
    health.close(() => process.exit(0));
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

function createPool(config: MusicConfig): pg.Pool {
  installTypeParsers();
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: envInt(process.env.PG_POOL_MAX, 3, { name: 'PG_POOL_MAX', min: 1 }),
    connectionTimeoutMillis: 10_000,
    options: '-c TimeZone=UTC -c statement_timeout=30000',
  });
  pool.on('error', (error) => console.error('idle PostgreSQL client error', describeError(error)));
  return pool;
}

/** LISTEN music_commands on a dedicated client; the interval tick covers any gap. */
function listenForCommands(config: MusicConfig, kick: () => void, isStopping: () => boolean): () => Promise<void> {
  let listener: pg.Client | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const retry = (client: pg.Client): void => {
    if (listener === client) listener = null;
    void client.end().catch(() => undefined);
    if (!isStopping() && !timer) timer = setTimeout(() => { timer = null; void listen(); }, LISTEN_RECONNECT_MS);
  };
  const listen = async (): Promise<void> => {
    if (isStopping()) return;
    const client = new pg.Client({ connectionString: config.databaseUrl, options: PG_CLIENT_OPTIONS });
    listener = client;
    client.on('error', (error) => {
      console.warn('music LISTEN connection error', describeError(error));
      retry(client);
    });
    client.on('end', () => {
      if (listener !== client) return;
      console.warn('music LISTEN connection closed');
      retry(client);
    });
    client.on('notification', kick);
    try {
      await client.connect();
      await client.query('LISTEN music_commands');
      kick();
    } catch (error) {
      console.warn('music LISTEN failed', describeError(error));
      retry(client);
    }
  };
  void listen();
  return async () => {
    if (timer) clearTimeout(timer);
    await listener?.end().catch(() => undefined);
  };
}

async function loginWithinBudget(client: ReturnType<typeof createMusicClient>, token: string): Promise<void> {
  const exitLater = (): void => { setTimeout(() => process.exit(1), RETRY_LATER_MS); };
  try {
    const budget = await fetchSessionBudget(token);
    if (budget.remaining < MIN_SESSION_STARTS) {
      console.error(`!!! NOT LOGGING IN: only ${budget.remaining}/${budget.total} gateway session starts left today`);
      exitLater();
      return;
    }
  } catch (error) {
    console.error('could not check the gateway session budget; not logging in', describeError(error));
    exitLater();
    return;
  }
  try {
    await client.login(token);
  } catch (error) {
    console.error('music Discord login failed', describeError(error));
    exitLater();
  }
}

function readConfigOrExit(): MusicConfig {
  try {
    return readMusicConfig(process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function buildRuntime(
  config: MusicConfig,
  pool: pg.Pool,
  client: ReturnType<typeof createMusicClient>,
  isStopping: () => boolean,
): MusicRuntime {
  const db = asD1(new PgD1Database(pool));
  const store = new MusicStore(pool, config.guildId);
  const community = new CommunityStore(pool, config.guildId);
  const onError = (error: unknown): void => console.error('music processing failed', describeError(error));
  return createMusicRuntime({
    store,
    rooms: communityRooms(community),
    voice: createDiscordVoice(client, config.guildId, { onError }),
    ...createMusicIo({ db, masterKey: config.masterKey, store, community, now: Date.now }),
    now: Date.now,
    random: Math.random,
    newKey: randomUUID,
    playerUrl: (roomRef) => musicPlayerUrl(config.frontendUrl, roomRef),
    isReadOnly: () => config.readOnly || isStopping(),
    onError,
  });
}

/** Waits (idle, retrying) until this process is the guild's only music consumer. */
function standBy(config: MusicConfig, onAcquired: () => void): { stop(): Promise<void> } {
  let waitingLogged = false;
  return holdMusicLock({
    guildId: config.guildId,
    connect: () => new pg.Client({ connectionString: config.databaseUrl, options: PG_CLIENT_OPTIONS }),
    onAcquired: () => {
      console.log('music consumer lock acquired');
      onAcquired();
    },
    onWaiting: () => {
      if (!waitingLogged) console.log('another music process holds the consumer lock; standing by');
      waitingLogged = true;
    },
    onLost: (error) => {
      // Another instance may take over now: stop consuming at once; the restart policy brings us back.
      console.error('!!! lost the music consumer lock; exiting', error ? describeError(error) : '');
      process.exit(1);
    },
    onError: (error) => console.warn('music consumer lock unavailable; retrying', describeError(error)),
  });
}

function wireGateway(client: ReturnType<typeof createMusicClient>, setGateway: (state: GatewayState) => void): void {
  client.on(Events.ShardReady, () => setGateway('ready'));
  client.on(Events.ShardResume, () => setGateway('ready'));
  client.on(Events.ShardReconnecting, () => setGateway('connecting'));
  client.on(Events.ShardDisconnect, (event) => {
    setGateway('connecting');
    console.error(`!!! music gateway closed for good (code ${event.code}), not reconnecting. Check MUSIC_DISCORD_TOKEN.`);
  });
  client.on(Events.Error, (error) => console.error('music discord client error', describeError(error)));
}

function main(): void {
  if (!musicWanted(process.env)) {
    idle();
    return;
  }
  const config = readConfigOrExit();
  const pool = createPool(config);
  const client = createMusicClient();
  // 'disabled' until this process holds the consumer lock: healthy, but not serving.
  let gateway: GatewayState = 'disabled';
  let stopping = false;
  const runtime = buildRuntime(config, pool, client, () => stopping);
  const kick = (): void => { if (gateway === 'ready' && !stopping) void runtime.tick(); };
  let interval: ReturnType<typeof setInterval> | null = null;
  let stopListening: (() => Promise<void>) | null = null;

  const health = createHealthServer(() => gateway);
  health.listen(HEALTH_PORT, '0.0.0.0', () => console.log(`health on :${HEALTH_PORT}`));
  client.once(Events.ClientReady, (ready) => {
    gateway = 'ready';
    console.log(`music gateway ready as ${ready.user.tag}`);
    if (stopping) return;
    runtime.start();
    interval = setInterval(kick, TICK_INTERVAL_MS);
    stopListening = listenForCommands(config, kick, () => stopping);
    kick();
  });
  wireGateway(client, (state) => { gateway = state; });
  process.on('unhandledRejection', (reason) => console.error('unhandled rejection', describeError(reason)));

  const lock = standBy(config, () => {
    if (stopping) return;
    gateway = 'connecting';
    void loginWithinBudget(client, config.token);
  });

  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal}: shutting down`);
    setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS).unref();
    if (interval) clearInterval(interval);
    await Promise.race([
      Promise.allSettled([runtime.stop(), stopListening?.()]),
      new Promise((resolve) => setTimeout(resolve, STOP_GRACE_MS).unref()),
    ]);
    gateway = 'connecting';
    await client.destroy().catch((error: unknown) => console.error('client.destroy failed', describeError(error)));
    await lock.stop();
    await new Promise<void>((resolve) => health.close(() => resolve()));
    await pool.end().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main();
