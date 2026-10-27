// Exercise the production InteractionCreate route with local spies, never a Discord login or DB.
import { Events, MessageFlags } from 'discord.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseBoardButton } from '../src/discord/commands';
import { WRONG_GUILD_TEXT } from '../src/discord/client';

const fake = vi.hoisted(() => ({
  on: vi.fn(), once: vi.fn(), query: vi.fn(async () => ({ rows: [] })),
  dispatch: vi.fn(), dispatcherStart: vi.fn(),
  board: vi.fn(async () => ({ content: 'board private response', ephemeral: true })),
  caseAction: vi.fn(async () => ({ kind: 'reply', reply: { content: 'existing case response', ephemeral: true } })),
  verdict: vi.fn(async () => ({ content: 'existing verdict response', ephemeral: true })),
}));
vi.mock('pg', async (original) => {
  const actual = await original<typeof import('pg')>();
  return { ...actual, default: { ...actual.default, Pool: class { query = fake.query; on = vi.fn(); } } };
});
vi.mock('../src/discord/gateway', () => ({ createClient: () => ({ on: fake.on, once: fake.once }),
  readVoicePresence: vi.fn(), wireVoice: () => () => {}, wireBoardRefresh: () => () => {} }));
vi.mock('../src/voice/recorder', () => ({ createVoiceRecorder: () => ({ status: vi.fn() }) }));
vi.mock('../src/discord/health', () => ({ createHealthServer: () => ({ listen: vi.fn() }) }));
vi.mock('../src/discord/client', async (original) => ({ ...await original<typeof import('../src/discord/client')>(),
  readBotConfig: () => ({ token: 'local-test-token', guildId: 'edg-guild', appId: 'app', databaseUrl: 'unused',
    appUrl: 'https://api.example', frontendUrl: 'https://score.example', verdictChannelId: null, boardChannelId: 'board-channel' }),
  fetchSessionBudget: () => new Promise(() => {}),
}));
vi.mock('../src/outbox/dispatcher', () => ({ createDispatcher: (deps: unknown) => {
  fake.dispatch(deps); return { start: fake.dispatcherStart, stop: vi.fn(async () => {}) };
} }));
vi.mock('../src/discord/commands', async (original) => ({ ...await original<typeof import('../src/discord/commands')>(), handleBoardButton: fake.board }));
vi.mock('../src/discord/case-actions', async (original) => ({ ...await original<typeof import('../src/discord/case-actions')>(), openCaseAction: fake.caseAction }));
vi.mock('../src/discord/verdict', async (original) => ({ ...await original<typeof import('../src/discord/verdict')>(), handleVerdictButton: fake.verdict }));

const CALLER = { id: 'caller-discord', username: 'Caller' };
let listener: (event: ReturnType<typeof interaction>) => void;
function interaction(customId: string, guildId: string | null = 'edg-guild', channelId = 'board-channel') {
  return { customId, guildId, channelId, user: CALLER, isChatInputCommand: () => false, isButton: () => true,
    isModalSubmit: () => false, reply: vi.fn(async (_options: unknown) => {}), deferReply: vi.fn(), editReply: vi.fn() };
}
beforeAll(async () => {
  vi.stubEnv('DISCORD_TOKEN', 'local-test-token');
  vi.spyOn(process, 'on').mockImplementation(() => process);
  await import('../src/bot-main');
  listener = fake.on.mock.calls.find(([event]) => event === Events.InteractionCreate)![1];
});
beforeEach(() => { fake.board.mockClear(); fake.caseAction.mockClear(); fake.verdict.mockClear(); });
afterAll(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('information board interaction routing', () => {
  it('wires strict board recovery into the production dispatcher after readiness', async () => {
    const ready = { user: { id: '100000000000000009', tag: 'local-board-bot' }, application: { id: 'app' },
      rest: { put: vi.fn(async () => {}) } };
    const onReady = fake.once.mock.calls.find(([event]) => event === Events.ClientReady)![1];
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      onReady(ready);
      expect(fake.dispatch).toHaveBeenCalledWith(expect.objectContaining({
        config: expect.objectContaining({ boardChannelId: 'board-channel' }),
        api: expect.objectContaining({ findBoards: expect.any(Function) }),
      }));
      expect(fake.dispatcherStart).toHaveBeenCalledOnce();
      await Promise.resolve();
    } finally { log.mockRestore(); }
  });
  it('recognizes only the two exact board custom IDs', () => {
    expect(parseBoardButton('v1:board:me')).toBe('me'); expect(parseBoardButton('v1:board:voice')).toBe('voice');
    for (const id of ['v1:board:me:other', 'v1:board:voice:14', 'v1:board:top', 'v2:board:me', 'v1:rsvp:7:going', 'v1:stmt:7']) expect(parseBoardButton(id)).toBeNull();
  });
  it.each(['me', 'voice'])('privately answers %s from the board or another target-guild channel', async (action) => {
    for (const channel of ['board-channel', 'another-channel']) {
      const event = interaction(`v1:board:${action}`, 'edg-guild', channel); listener(event);
      await vi.waitFor(() => expect(event.reply).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        content: 'board private response', flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] },
      })));
      expect(fake.board).toHaveBeenLastCalledWith(action, CALLER, expect.objectContaining({ frontendUrl: 'https://score.example' }));
    }
  });
  it.each(['different-guild', null])('rejects board interactions from %s before reading private data', async (guild) => {
    for (const action of ['me', 'voice']) {
      const event = interaction(`v1:board:${action}`, guild); listener(event);
      await vi.waitFor(() => expect(event.reply).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ content: WRONG_GUILD_TEXT, flags: MessageFlags.Ephemeral })));
      expect(fake.board).not.toHaveBeenCalled();
    }
  });
  it('leaves the existing private statement button route available in DMs', async () => {
    const event = interaction('v1:stmt:7', null); listener(event);
    await vi.waitFor(() => expect(event.reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'existing case response', flags: MessageFlags.Ephemeral })));
    expect(fake.caseAction).toHaveBeenCalledWith('statement', 7, CALLER, expect.any(Object)); expect(fake.board).not.toHaveBeenCalled();
  });
  it('leaves old session buttons available in DMs after retirement', async () => {
    const event = interaction('v1:rsvp:7:going', null); listener(event);
    await vi.waitFor(() => expect(event.reply).toHaveBeenCalledWith(expect.objectContaining({ content: '约局功能已下线，这个按钮不再有效。', flags: MessageFlags.Ephemeral })));
    expect(fake.board).not.toHaveBeenCalled();
  });
  it('leaves existing verdict buttons on their guild-guarded route', async () => {
    const event = interaction('v1:verdict:7'); listener(event);
    await vi.waitFor(() => expect(event.reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'existing verdict response', flags: MessageFlags.Ephemeral })));
    expect(fake.verdict).toHaveBeenCalledWith(7, CALLER, expect.any(Object)); expect(fake.board).not.toHaveBeenCalled();
  });
  it('ignores malformed board IDs instead of dispatching a private command', async () => {
    const event = interaction('v1:board:voice:other'); listener(event); await Promise.resolve();
    expect(event.reply).not.toHaveBeenCalled(); expect(fake.board).not.toHaveBeenCalled();
  });
});
