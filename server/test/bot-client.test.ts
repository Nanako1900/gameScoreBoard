import { format } from 'node:util';
import {
  ButtonStyle,
  ComponentType,
  DiscordAPIError,
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
  describeError,
  ERROR_TEXT,
  fetchSessionBudget,
  GATEWAY_BOT_URL,
  readBotConfig,
  respond,
  toCommandInput,
  toReplyOptions,
  WRONG_GUILD_TEXT,
  type CommandHandler,
} from '../src/discord/client';
import type { BotContext, BotReply, CommandInput } from '../src/discord/types';

const CALLER = { id: '111111111111111111', username: 'nanako' };
const TARGET = { id: '222222222222222222', username: 'rival' };
const GUILD_ID = '1114391825336250432';
const INTERACTION_TOKEN = 'aW50ZXJhY3Rpb246MTIzNDU2Nzg5MDEyMzQ1Njc4OmZha2V0b2tlbg';
const BOT_TOKEN = `${'M'.repeat(26)}.${'G'.repeat(6)}.${'x'.repeat(38)}`;

/** What discord.js throws when an interaction callback fails: its `url` carries the token. */
function apiError(code: number, status: number, message: string): DiscordAPIError {
  return new DiscordAPIError(
    { code, message },
    code,
    status,
    'POST',
    `https://discord.com/api/v10/interactions/123456789012345678/${INTERACTION_TOKEN}/callback`,
    { body: { type: 4 } },
  );
}

interface FakeOptions {
  commandName?: string;
  guildId?: string | null;
  target?: typeof TARGET | null;
  reply?: () => Promise<unknown>;
  deferReply?: () => Promise<unknown>;
}

/** Just the parts of a ChatInputCommandInteraction the glue touches, with spies. */
function fakeInteraction(opts: FakeOptions = {}) {
  const replyImpl = opts.reply ?? (async () => undefined);
  const deferImpl = opts.deferReply ?? (async () => undefined);
  const fake = {
    commandName: opts.commandName ?? 'score',
    guildId: opts.guildId === undefined ? GUILD_ID : opts.guildId,
    user: { ...CALLER, globalName: 'Nanako', discriminator: '0' },
    options: { getUser: vi.fn((name: string) => (name === 'user' ? (opts.target ?? null) : null)) },
    reply: vi.fn(async (_options: unknown) => replyImpl()),
    deferReply: vi.fn(async (_options: unknown) => deferImpl()),
    editReply: vi.fn(async (_options: unknown) => undefined),
  };
  return { fake, interaction: fake as unknown as ChatInputCommandInteraction };
}

const ctx = {
  db: {} as D1Database,
  appUrl: 'https://api.nanako.org',
  frontendUrl: 'https://score.nanako.org',
} satisfies BotContext;

const NO_MENTIONS = { parse: [] };

describe('toCommandInput', () => {
  it('takes the caller from interaction.user and the target from the `user` option', () => {
    const { interaction, fake } = fakeInteraction({ commandName: 'verdicts', target: TARGET });
    expect(toCommandInput(interaction)).toEqual<CommandInput>({
      commandName: 'verdicts',
      caller: CALLER,
      targetUser: TARGET,
    });
    expect(fake.options.getUser).toHaveBeenCalledWith('user');
  });

  it('has no target when the option is absent', () => {
    const { interaction } = fakeInteraction({ commandName: 'top' });
    expect(toCommandInput(interaction).targetUser).toBeNull();
  });
});

describe('toReplyOptions', () => {
  it('marks ephemeral replies with MessageFlags.Ephemeral and public ones with no flags', () => {
    expect(toReplyOptions({ content: 'hi', ephemeral: true }).flags).toBe(MessageFlags.Ephemeral);
    expect(toReplyOptions({ content: 'hi', ephemeral: false })).not.toHaveProperty('flags');
  });

  it('always disables mentions', () => {
    const replies: BotReply[] = [
      { content: '@everyone <@111111111111111111>', ephemeral: false },
      { embeds: [{ title: 'x' }], ephemeral: true },
      { ephemeral: false, buttons: [{ label: '去绑定', url: 'https://api.nanako.org/link/discord' }] },
    ];
    for (const reply of replies) expect(toReplyOptions(reply).allowedMentions).toEqual(NO_MENTIONS);
  });

  it('turns buttons into one row of Link buttons', () => {
    const options = toReplyOptions({
      content: '点下面的按钮',
      ephemeral: true,
      buttons: [
        { label: '去绑定', url: 'https://api.nanako.org/link/discord' },
        { label: '打开网页', url: 'https://score.nanako.org/' },
      ],
    });
    expect(options.components).toEqual([
      {
        type: ComponentType.ActionRow,
        components: [
          { type: ComponentType.Button, style: ButtonStyle.Link, label: '去绑定', url: 'https://api.nanako.org/link/discord' },
          { type: ComponentType.Button, style: ButtonStyle.Link, label: '打开网页', url: 'https://score.nanako.org/' },
        ],
      },
    ]);
  });

  it('caps a row at the five buttons Discord allows', () => {
    const buttons = Array.from({ length: 7 }, (_, i) => ({ label: `b${i}`, url: `https://x.example/${i}` }));
    const row = toReplyOptions({ ephemeral: false, buttons }).components?.[0] as { components: unknown[] };
    expect(row.components).toHaveLength(5);
  });

  it('maps embeds to plain objects, leaving out what was not set', () => {
    const options = toReplyOptions({
      ephemeral: false,
      embeds: [
        {
          title: '信誉分排行榜',
          url: 'https://score.nanako.org/',
          color: 0xf5c542,
          fields: [
            { name: '1. nanako', value: '100 分', inline: true },
            { name: '2. rival', value: '' },
          ],
          footer: { text: 'EDG 信誉分' },
        },
        { description: '只有描述' },
      ],
    });
    expect(options.embeds).toEqual([
      {
        title: '信誉分排行榜',
        url: 'https://score.nanako.org/',
        color: 0xf5c542,
        fields: [
          { name: '1. nanako', value: '100 分', inline: true },
          // Discord refuses an empty value.
          { name: '2. rival', value: '\u200b' },
        ],
        footer: { text: 'EDG 信誉分' },
      },
      { description: '只有描述' },
    ]);
    expect(options).not.toHaveProperty('content');
    expect(options).not.toHaveProperty('components');
  });

  it('clips text to the Discord limits instead of failing the whole reply', () => {
    const options = toReplyOptions({
      content: '😀'.repeat(1500),
      ephemeral: false,
      embeds: [{ title: 'x'.repeat(300), fields: Array.from({ length: 30 }, (_, i) => ({ name: `${i}`, value: 'v' })) }],
    });
    expect(options.content!.length).toBeLessThanOrEqual(2000);
    // Cut on a code point boundary: no lone surrogate before the ellipsis.
    expect(options.content!.endsWith('😀…')).toBe(true);
    const embed = options.embeds![0] as { title: string; fields: unknown[] };
    expect(embed.title).toHaveLength(256);
    expect(embed.fields).toHaveLength(25);
  });
});

describe('respond', () => {
  let errors: MockInstance<typeof console.error>;
  beforeEach(() => {
    errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    errors.mockRestore();
  });

  // Formatted the way console.error prints its arguments, so logging a raw
  // error object (whose url field holds the token) would show up here.
  const loggedText = (): string => errors.mock.calls.map((args) => format(...args)).join('\n');

  it('replies directly when the handler is quick', async () => {
    const { interaction, fake } = fakeInteraction({ target: TARGET });
    const handler = vi.fn<CommandHandler>(async () => ({ content: '你的信誉分：100', ephemeral: true }));
    await respond(interaction, ctx, handler);

    expect(handler).toHaveBeenCalledWith({ commandName: 'score', caller: CALLER, targetUser: TARGET }, ctx);
    expect(fake.deferReply).not.toHaveBeenCalled();
    expect(fake.reply).toHaveBeenCalledTimes(1);
    expect(fake.reply).toHaveBeenCalledWith({
      content: '你的信誉分：100',
      flags: MessageFlags.Ephemeral,
      allowedMentions: NO_MENTIONS,
    });
  });

  it('defers (ephemeral) when the handler is slow, then edits the deferred reply', async () => {
    const { interaction, fake } = fakeInteraction({ commandName: 'top' });
    let finish!: (reply: BotReply) => void;
    const handler: CommandHandler = () => new Promise((resolve) => (finish = resolve));

    const done = respond(interaction, ctx, handler, { deferAfterMs: 5 });
    await vi.waitFor(() => expect(fake.deferReply).toHaveBeenCalled());
    expect(fake.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    finish({ embeds: [{ title: '榜' }], buttons: [{ label: '网页', url: 'https://score.nanako.org/' }], ephemeral: false });
    await done;

    expect(fake.reply).not.toHaveBeenCalled();
    expect(fake.editReply).toHaveBeenCalledTimes(1);
    const edit = fake.editReply.mock.calls[0][0] as Record<string, unknown>;
    // An edit cannot carry the Ephemeral flag; the defer already decided it.
    expect(edit).not.toHaveProperty('flags');
    expect(edit.embeds).toEqual([{ title: '榜' }]);
    expect(edit.components).toHaveLength(1);
    expect(edit.allowedMentions).toEqual(NO_MENTIONS);
  });

  it('turns a thrown error into an ephemeral apology and logs it without the token', async () => {
    const { interaction, fake } = fakeInteraction();
    const handler: CommandHandler = async () => {
      const error = new Error(`boom at https://discord.com/api/v10/interactions/123456789012345678/${INTERACTION_TOKEN}/callback`);
      throw error;
    };
    await respond(interaction, ctx, handler);

    expect(fake.reply).toHaveBeenCalledWith({
      content: ERROR_TEXT,
      flags: MessageFlags.Ephemeral,
      allowedMentions: NO_MENTIONS,
    });
    expect(loggedText()).toContain('/score failed');
    expect(loggedText()).toContain('boom');
    expect(loggedText()).not.toContain(INTERACTION_TOKEN);
  });

  it('handles a handler that throws synchronously', async () => {
    const { interaction, fake } = fakeInteraction();
    const handler = (() => {
      throw new TypeError('sync');
    }) as unknown as CommandHandler;
    await expect(respond(interaction, ctx, handler)).resolves.toBeUndefined();
    expect(fake.reply).toHaveBeenCalledWith(expect.objectContaining({ content: ERROR_TEXT }));
  });

  it('edits the deferred reply into the apology when a slow handler throws', async () => {
    const { interaction, fake } = fakeInteraction();
    const handler: CommandHandler = () =>
      new Promise((_, reject) => setTimeout(() => reject(new Error('db down')), 30));
    await respond(interaction, ctx, handler, { deferAfterMs: 5 });

    expect(fake.deferReply).toHaveBeenCalledTimes(1);
    expect(fake.reply).not.toHaveBeenCalled();
    expect(fake.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: ERROR_TEXT, allowedMentions: NO_MENTIONS }),
    );
  });

  it('falls back to the apology when Discord rejects the reply itself', async () => {
    let calls = 0;
    const { interaction, fake } = fakeInteraction({
      reply: async () => {
        calls += 1;
        if (calls === 1) throw Object.assign(new Error('Invalid Form Body'), { code: 50035, status: 400 });
      },
    });
    await respond(interaction, ctx, async () => ({ content: 'x', ephemeral: false }));
    expect(fake.reply).toHaveBeenCalledTimes(2);
    expect(fake.reply.mock.calls[1][0]).toEqual(expect.objectContaining({ content: ERROR_TEXT }));
    expect(loggedText()).toContain('code 50035');
  });

  it('gives up quietly once the interaction is gone, without logging its token', async () => {
    const { interaction, fake } = fakeInteraction({
      reply: async () => {
        throw apiError(10062, 404, 'Unknown interaction');
      },
    });
    await expect(respond(interaction, ctx, async () => ({ content: 'x', ephemeral: true }))).resolves.toBeUndefined();
    expect(fake.reply).toHaveBeenCalledTimes(1);
    expect(loggedText()).toContain('code 10062');
    // DiscordAPIError#url is the interaction callback URL, token included.
    expect(loggedText()).not.toContain(INTERACTION_TOKEN);
  });

  it('sends nothing more when the defer itself fails, and still waits for the handler', async () => {
    const { interaction, fake } = fakeInteraction({
      deferReply: async () => {
        throw apiError(10062, 404, 'Unknown interaction');
      },
    });
    let finished = false;
    const handler: CommandHandler = () =>
      new Promise((resolve) =>
        setTimeout(() => {
          finished = true;
          resolve({ content: 'late', ephemeral: true });
        }, 20),
      );
    await expect(respond(interaction, ctx, handler, { deferAfterMs: 5 })).resolves.toBeUndefined();

    expect(finished).toBe(true);
    expect(fake.deferReply).toHaveBeenCalledTimes(1);
    expect(fake.reply).not.toHaveBeenCalled();
    expect(fake.editReply).not.toHaveBeenCalled();
    expect(loggedText()).toContain('could not defer');
    expect(loggedText()).not.toContain(INTERACTION_TOKEN);
  });

  it('turns away interactions from another guild or a DM without running the handler', async () => {
    for (const guildId of ['999999999999999999', null]) {
      const { interaction, fake } = fakeInteraction({ commandName: 'top', guildId });
      const handler = vi.fn<CommandHandler>(async () => ({ content: '榜', ephemeral: false }));
      await respond(interaction, ctx, handler, { guildId: GUILD_ID });

      expect(handler).not.toHaveBeenCalled();
      expect(fake.reply).toHaveBeenCalledWith({
        content: WRONG_GUILD_TEXT,
        flags: MessageFlags.Ephemeral,
        allowedMentions: NO_MENTIONS,
      });
    }
  });

  it('runs the handler for our own guild', async () => {
    const { interaction, fake } = fakeInteraction({ commandName: 'top' });
    const handler = vi.fn<CommandHandler>(async () => ({ content: '榜', ephemeral: false }));
    await respond(interaction, ctx, handler, { guildId: GUILD_ID });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(fake.reply).toHaveBeenCalledWith({ content: '榜', allowedMentions: NO_MENTIONS });
  });
});

describe('describeError', () => {
  it('scrubs interaction/webhook tokens and bot tokens', () => {
    const text = describeError(
      new Error(`PATCH /webhooks/123456789012345678/${INTERACTION_TOKEN}/messages/@original with ${BOT_TOKEN}`),
    );
    expect(text).toContain('/webhooks/123456789012345678/[redacted]/messages/@original');
    expect(text).not.toContain(INTERACTION_TOKEN);
    expect(text).not.toContain(BOT_TOKEN);
  });

  it('describes a DiscordAPIError by code and status, never by its url', () => {
    const text = describeError(apiError(50035, 400, 'Invalid Form Body'));
    expect(text).toContain('Invalid Form Body');
    expect(text).toContain('code 50035, HTTP 400');
    expect(text).not.toContain(INTERACTION_TOKEN);
  });

  it('describes non-Error values', () => {
    expect(describeError('plain')).toBe('plain');
  });
});

describe('readBotConfig', () => {
  const valid = {
    DISCORD_TOKEN: 'token.part.value',
    DISCORD_APP_ID: '1234567890123456789',
    GUILD_ID: '1114391825336250432',
    DATABASE_URL: 'postgres://edg:pw@postgres:5432/edg',
    APP_URL: 'https://api.nanako.org/',
    FRONTEND_URL: 'https://score.nanako.org',
  };

  it('reads a valid environment and trims trailing slashes', () => {
    expect(readBotConfig(valid)).toEqual({
      token: 'token.part.value',
      appId: '1234567890123456789',
      guildId: '1114391825336250432',
      databaseUrl: 'postgres://edg:pw@postgres:5432/edg',
      appUrl: 'https://api.nanako.org',
      frontendUrl: 'https://score.nanako.org',
      verdictChannelId: null,
    });
  });

  it('takes an optional verdict channel, which must be an id', () => {
    expect(readBotConfig({ ...valid, DISCORD_VERDICT_CHANNEL_ID: ' 1234567890123456780 ' }).verdictChannelId).toBe(
      '1234567890123456780',
    );
    expect(() => readBotConfig({ ...valid, DISCORD_VERDICT_CHANNEL_ID: '#edg' })).toThrow(/DISCORD_VERDICT_CHANNEL_ID/);
  });

  it('names every problem at once and never echoes the token', () => {
    const run = () =>
      readBotConfig({ ...valid, DISCORD_TOKEN: 'Bot secret-value', GUILD_ID: 'abc', APP_URL: 'ftp://x', DATABASE_URL: '' });
    expect(run).toThrow(/DISCORD_TOKEN.*GUILD_ID.*DATABASE_URL.*APP_URL/);
    expect(run).not.toThrow(/secret-value/);
  });

  it('requires the token', () => {
    expect(() => readBotConfig({ ...valid, DISCORD_TOKEN: undefined })).toThrow(/DISCORD_TOKEN is missing/);
  });

  it('does not echo a token pasted into the wrong variable', () => {
    // The same token in two places: redacted by value.
    const twice = () => readBotConfig({ ...valid, DISCORD_TOKEN: 'abc.def.ghi', GUILD_ID: 'abc.def.ghi' });
    expect(twice).toThrow(/GUILD_ID/);
    expect(twice).not.toThrow(/abc\.def\.ghi/);
    // Swapped with the app id: redacted by its shape.
    const swapped = () => readBotConfig({ ...valid, DISCORD_TOKEN: valid.DISCORD_APP_ID, DISCORD_APP_ID: BOT_TOKEN });
    expect(swapped).toThrow(/DISCORD_APP_ID/);
    expect(swapped).not.toThrow(BOT_TOKEN);
  });
});

describe('fetchSessionBudget', () => {
  it('reads session_start_limit with the bot token', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        url: 'wss://gateway.discord.gg',
        shards: 1,
        session_start_limit: { total: 1000, remaining: 987, reset_after: 3_600_000, max_concurrency: 1 },
      }),
    );
    await expect(fetchSessionBudget('tok', fetchImpl)).resolves.toEqual({
      total: 1000,
      remaining: 987,
      resetAfterMs: 3_600_000,
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(GATEWAY_BOT_URL);
    expect(init.headers).toEqual({ Authorization: 'Bot tok' });
  });

  it('fails on an HTTP error, hinting at a bad token on 401', async () => {
    const fetchImpl = async () => new Response('{"message":"401: Unauthorized"}', { status: 401 });
    await expect(fetchSessionBudget('tok', fetchImpl)).rejects.toThrow(/HTTP 401.*DISCORD_TOKEN/);
  });

  it('fails when the response has no budget', async () => {
    await expect(fetchSessionBudget('tok', async () => Response.json({ url: 'wss://x' }))).rejects.toThrow(
      /session_start_limit/,
    );
  });
});
