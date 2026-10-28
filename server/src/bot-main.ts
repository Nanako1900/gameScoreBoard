// Node entry for the compose service `bot`: one Gateway connection (outbound
// only, Guilds + GuildVoiceStates intents) answering the slash commands in our one guild.
// Handlers read PostgreSQL directly through the same D1 adapter the API uses.
// A separate process from the API on purpose: whatever happens here, the
// website keeps working. See docs/DEPLOY-DISCORD.md.

import { Events, Routes, type Client } from 'discord.js';
import pg from 'pg';
import { asD1, installTypeParsers, PgD1Database } from './db/d1';
import {
  answer,
  describeError,
  fetchSessionBudget,
  MIN_SESSION_STARTS,
  readBotConfig,
  respond,
  restChannelApi,
  type BotConfig,
} from './discord/client';
import { COMMANDS, handleBoardButton, handleCommand, parseBoardButton } from './discord/commands';
import { createClient, readVoicePresence, wireBoardRefresh, wireVoice } from './discord/gateway';
import { createHealthServer, type GatewayState } from './discord/health';
import { createBoardFinder } from './discord/board-recovery';
import { createVoiceRecorder } from './voice/recorder';
import type { BotContext } from './discord/types';
import { handleVerdictButton, parseVerdictButton } from './discord/verdict';
import { handleRetiredSessionButton } from './discord/sessions-off';
import { handleEscalationButton, parseEscalationButton } from './discord/escalation';
import { resetOffsetHours } from '../../worker/time';
import {
  MODAL_FIELD,
  openCaseAction,
  parseCaseButton,
  parseCaseModal,
  submitCaseAction,
  toModal,
} from './discord/case-actions';
import type { Env } from '../../worker/types';
import { envFlag, envInt } from './env';
import { createDispatcher, type Dispatcher } from './outbox/dispatcher';
import { scheduleBoardRefresh } from './outbox/board-delivery';
import { COMMUNITY_COMMANDS } from './community/commands';
import { createCommunityRuntime } from './community/runtime';

const HEALTH_PORT = 8788;
const SHUTDOWN_GRACE_MS = 10_000;
const IN_FLIGHT_GRACE_MS = 5_000;
// When the bot will not (or cannot) log in it waits this long before exiting.
// restart: unless-stopped brings it straight back, so this is the retry pace:
// slow enough that a bad token never piles up failed requests at Discord.
const RETRY_LATER_MS = 5 * 60_000;


async function registerCommands(client: Client<true>, config: BotConfig, community = false): Promise<void> {
  if (client.application.id !== config.appId) {
    console.error(`DISCORD_APP_ID ${config.appId} is not the token's application (${client.application.id})`);
  }
  try {
    // Guild commands update instantly; a PUT of unchanged commands costs nothing.
    const commands = community ? [...COMMANDS, ...COMMUNITY_COMMANDS] : COMMANDS;
    await client.rest.put(Routes.applicationGuildCommands(config.appId, config.guildId), { body: commands });
    console.log(`registered ${commands.length} slash commands in guild ${config.guildId}`);
  } catch (error) {
    console.error('could not register the slash commands', describeError(error));
  }
}

/**
 * No DISCORD_TOKEN yet (the Developer Portal steps in docs/DEPLOY-DISCORD.md
 * are not done): stay up and quiet instead of crash-looping on every deploy.
 */
function idle(): void {
  console.log('DISCORD_TOKEN is not set: the bot is disabled (see docs/DEPLOY-DISCORD.md)');
  const health = createHealthServer(() => 'disabled');
  health.listen(HEALTH_PORT, '0.0.0.0');
  const stop = (): void => {
    health.close(() => process.exit(0));
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

function main(): void {
  if (!(process.env.DISCORD_TOKEN ?? '').trim()) {
    idle();
    return;
  }
  let config: BotConfig;
  try {
    config = readBotConfig(process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  installTypeParsers();
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: envInt(process.env.PG_POOL_MAX, 5, { name: 'PG_POOL_MAX', min: 1 }),
    connectionTimeoutMillis: 10_000,
    // The Worker's SQL binds zone-less 'YYYY-MM-DD HH:MM:SS' strings meant as UTC.
    options: '-c TimeZone=UTC -c statement_timeout=30000',
  });
  pool.on('error', (error) => console.error('idle PostgreSQL client error', describeError(error)));
  const ctx: BotContext = {
    db: asD1(new PgD1Database(pool)),
    appUrl: config.appUrl,
    frontendUrl: config.frontendUrl,
    readOnly: envFlag(process.env.READ_ONLY, false, 'READ_ONLY'),
    offsetHours: resetOffsetHours(process.env.RESET_TZ_OFFSET),
  };
  // The Worker's Env for the domain calls that need one: a statement sent from
  // Discord is judged right away, with the same AI settings as the web.
  const strings = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
  const actionCtx = { ...ctx, env: { ...strings, DB: ctx.db } as unknown as Env };

  let gateway: GatewayState = 'connecting';
  let stopping = false;
  const inFlight = new Set<Promise<void>>();

  const communityEnabled = envFlag(process.env.COMMUNITY_ENABLED, false, 'COMMUNITY_ENABLED');
  const client = createClient({ community: communityEnabled });
  const community = communityEnabled ? createCommunityRuntime({ pool, db: ctx.db, client, guildId: config.guildId,
    frontendUrl: config.frontendUrl, env: actionCtx.env, isReadOnly: () => ctx.readOnly || stopping,
    onError: error => console.error('community processing failed', describeError(error)) }) : null;
  const recorder = createVoiceRecorder({
    pool,
    // The getter is invoked when each queued job executes, not at event admission.
    getPresent: () => readVoicePresence(client, config.guildId),
    isReady: () => !stopping && gateway === 'ready' && client.isReady()
      && client.guilds.cache.get(config.guildId)?.available === true,
  });
  const unwireVoice = wireVoice(client, recorder, config.guildId);
  const unwireBoard = wireBoardRefresh(client, () => scheduleBoardRefresh(pool), () => stopping,
    (error) => console.error('could not schedule information board refresh', describeError(error)));
  const health = createHealthServer(() => gateway, () => recorder.status());
  health.listen(HEALTH_PORT, '0.0.0.0', () => console.log(`health on :${HEALTH_PORT}`));
  // Verdict, report and board posts. Started once the client is logged in, since it sends
  // through the client's REST; events committed meanwhile wait in the outbox.
  let dispatcher: Dispatcher | null = null;
  client.once(Events.ClientReady, (ready) => {
    gateway = 'ready';
    console.log(`gateway ready as ${ready.user.tag}`);
    void registerCommands(ready, config, communityEnabled);
    if (stopping) return;
    dispatcher = createDispatcher({
      pool,
      db: ctx.db,
      api: { ...restChannelApi(ready.rest), findBoards: createBoardFinder(ready, config.guildId) },
      config: {
        verdictChannelId: config.verdictChannelId,
        boardChannelId: config.boardChannelId,
        frontendUrl: config.frontendUrl,
        offsetHours: ctx.offsetHours,
      },
      createListener: () => new pg.Client({ connectionString: config.databaseUrl, options: '-c TimeZone=UTC' }),
      describeError,
    });
    dispatcher.start();
    console.log(
      config.verdictChannelId
        ? `posting verdicts and weekly reports to channel ${config.verdictChannelId}`
        : 'DISCORD_VERDICT_CHANNEL_ID is not set: verdicts and weekly reports are not posted',
    );
  });
  client.on(Events.ShardReady, () => (gateway = 'ready'));
  client.on(Events.ShardResume, () => (gateway = 'ready'));
  client.on(Events.ShardReconnecting, () => (gateway = 'connecting'));
  client.on(Events.ShardDisconnect, (event) => {
    // discord.js emits this only for close codes it will not reconnect after
    // (4004: the token was reset; 4013/4014: intents). Staying up without
    // retrying is right — a dead token only burns requests — so say it loudly.
    gateway = 'connecting';
    console.error(
      `!!! gateway closed for good (code ${event.code}), not reconnecting. ` +
        'Check DISCORD_TOKEN (4004) and the intents (4013/4014), then redeploy.',
    );
  });
  client.on(Events.ShardError, (error) => console.error('gateway error', describeError(error)));
  client.on(Events.Error, (error) => console.error('discord client error', describeError(error)));
  client.on(Events.Warn, (message) => console.warn('discord client warning', message));
  client.on(Events.InteractionCreate, (interaction) => {
    if (stopping) return;
    // Whoever uses the bot has shown they can be reached: DMs get another try.
    void pool
      .query('UPDATE discord_links SET dm_ok = 1 WHERE discord_user_id = $1 AND dm_ok = 0', [interaction.user.id])
      .catch((error: unknown) => console.error('could not reset dm_ok', describeError(error)));
    const caller = { id: interaction.user.id, username: interaction.user.username };
    let work: Promise<void>;
    if (community?.accepts(interaction)) {
      work = community.handle(interaction);
    } else if (interaction.isChatInputCommand()) {
      work = respond(interaction, ctx, handleCommand, { guildId: config.guildId });
    } else if (interaction.isButton()) {
      const verdictId = parseVerdictButton(interaction.customId);
      const caseButton = parseCaseButton(interaction.customId);
      const retiredSession = handleRetiredSessionButton(interaction.customId);
      const escalation = parseEscalationButton(interaction.customId);
      const boardAction = parseBoardButton(interaction.customId);
      if (boardAction) {
        // The board works in any target-guild channel, while private data stays guild-bound.
        work = answer(interaction, `board ${boardAction} button`, () => handleBoardButton(boardAction, caller, ctx), {
          guildId: config.guildId,
        });
      } else if (escalation) {
        // Pressed in the filing judge's DM: no guild check.
        work = answer(interaction, 'escalation button', () =>
          handleEscalationButton(escalation.recordId, escalation.choice, caller, ctx),
        );
      } else if (retiredSession) {
        // Old channel cards and invitation DMs both receive a private notice.
        work = answer(interaction, 'retired session button', async () => retiredSession);
      } else if (verdictId !== null) {
        work = answer(interaction, 'verdict button', () => handleVerdictButton(verdictId, caller, ctx), {
          guildId: config.guildId,
        });
      } else if (caseButton) {
        // Pressed in a DM: no guild. A modal must be the first answer, so
        // the checks before it are quick reads.
        work = (async () => {
          const result = await openCaseAction(caseButton.action, caseButton.recordId, caller, ctx);
          if (result.kind === 'modal') await interaction.showModal(toModal(result.modal));
          else await answer(interaction, `${caseButton.action} button`, async () => result.reply);
        })();
      } else {
        return;
      }
    } else if (interaction.isModalSubmit()) {
      const submitted = parseCaseModal(interaction.customId);
      if (!submitted) return;
      const text = interaction.fields.getTextInputValue(MODAL_FIELD);
      // Slow on purpose: a statement is judged on the spot (AI, up to ~40 s);
      // answer() defers after 2 s, and the interaction stays valid for 15 min.
      work = answer(interaction, `${submitted.action} modal`, () =>
        submitCaseAction(submitted.action, submitted.recordId, text, caller, actionCtx),
      );
    } else {
      return;
    }
    const task: Promise<void> = work
      .catch((error: unknown) => console.error('respond failed', describeError(error)))
      .finally(() => inFlight.delete(task));
    inFlight.add(task);
  });

  // Logged, never fatal: one bad interaction must not take the bot offline.
  process.on('unhandledRejection', (reason) => console.error('unhandled rejection', describeError(reason)));

  const exitLater = (): void => {
    setTimeout(() => process.exit(1), RETRY_LATER_MS);
  };

  const start = async (): Promise<void> => {
    // Each login is one IDENTIFY out of a daily budget (normally 1000). When it
    // runs out Discord resets the bot token, so a crash loop must stop well before.
    try {
      const budget = await fetchSessionBudget(config.token);
      if (budget.remaining < MIN_SESSION_STARTS) {
        const hours = (budget.resetAfterMs / 3_600_000).toFixed(1);
        console.error(
          `!!! NOT LOGGING IN: only ${budget.remaining}/${budget.total} gateway session starts left today ` +
            `(refills in ${hours} h). Something keeps restarting the bot — fix that first, ` +
            'or Discord will reset the bot token.',
        );
        exitLater();
        return;
      }
      console.log(`gateway session starts left today: ${budget.remaining}/${budget.total}`);
    } catch (error) {
      console.error('could not check the gateway session budget; not logging in', describeError(error));
      exitLater();
      return;
    }
    if (stopping) return;
    try {
      await client.login(config.token);
    } catch (error) {
      console.error('Discord login failed', describeError(error));
      exitLater();
    }
  };

  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal}: shutting down`);
    setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS).unref();
    gateway = 'connecting';
    unwireVoice();
    unwireBoard();
    // The dispatcher first: it sends through the client's REST, which
    // destroy() takes the token from, so an event in flight would fail.
    await Promise.race([
      Promise.allSettled([dispatcher?.stop(), recorder.stop(), community?.stop()]),
      new Promise((resolve) => setTimeout(resolve, IN_FLIGHT_GRACE_MS).unref()),
    ]);
    await client.destroy().catch((error: unknown) => console.error('client.destroy failed', describeError(error)));
    // Let commands already running finish their reply before the pool goes away.
    await Promise.race([
      Promise.allSettled([...inFlight]),
      new Promise((resolve) => setTimeout(resolve, IN_FLIGHT_GRACE_MS).unref()),
    ]);
    await new Promise<void>((resolve) => health.close(() => resolve()));
    await pool.end().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  void start();
}

main();
