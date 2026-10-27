import { PermissionFlagsBits, PermissionsBitField, type Client } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { createBoardFinder } from '../src/discord/board-recovery';

const GUILD = '1114391825336250432';
const CHANNEL = '200000000000000011';
const SELF = '300000000000000001';
const id = (n: number) => String(930000000000000000n + BigInt(n));
const marker = () => [{ type: 1, components: [
  { type: 2, custom_id: 'v1:board:me' }, { type: 2, custom_id: 'v1:board:voice' },
] }];
function message(n: number, author = SELF) {
  return { id: id(n), author: { id: author }, components: marker(),
    get content(): never { throw new Error('must not read chat content'); },
    get embeds(): never { throw new Error('must not read chat embeds'); } };
}
function setup(pages: unknown[] = []) {
  const required = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ReadMessageHistory;
  let permissions = required;
  const member = { id: SELF };
  const channel = { guildId: GUILD, isTextBased: () => true,
    permissionsFor: vi.fn(() => new PermissionsBitField(permissions)) };
  const target = { id: GUILD, available: true,
    channels: { fetch: vi.fn(async () => channel) }, members: { fetchMe: vi.fn(async () => member) },
    roles: { fetch: vi.fn(async () => new Map()) } };
  const rest = { get: vi.fn(async () => pages.length ? pages.shift() : []) };
  const client = { user: { id: SELF }, guilds: { cache: new Map([[GUILD, target]]) }, rest } as unknown as Client<true>;
  return { client, target, channel, rest, setPermissions: (value: bigint) => { permissions = value; }, deny: () => { permissions = 0n; } };
}

describe('board history recovery', () => {
  it('finds only this bot’s two-button board marker without reading any message content or embeds', async () => {
    const ordinary = { id: id(7), author: { id: 'another-user' },
      get components(): never { throw new Error('must not inspect ordinary user components'); },
      get content(): never { throw new Error('must not read chat content'); } };
    const otherBot = message(6, 'another-bot');
    const half = { id: id(5), author: { id: SELF }, components: [{ type: 1, components: [{ type: 2, custom_id: 'v1:board:me' }] }] };
    const s = setup([[ordinary, otherBot, half, message(4)], []]);
    expect(await createBoardFinder(s.client, GUILD)(CHANNEL)).toEqual([id(4)]);
    expect(s.target.channels.fetch).toHaveBeenCalledWith(CHANNEL, { force: true });
    expect(s.target.members.fetchMe).toHaveBeenCalledWith({ force: true });
    expect(s.target.roles.fetch).toHaveBeenCalled();
    expect(s.channel.permissionsFor).toHaveBeenCalledWith({ id: SELF });
  });
  it('continues past one hundred messages and uses a strictly decreasing before cursor', async () => {
    const first = Array.from({ length: 100 }, (_, i) => message(300 - i));
    const second = Array.from({ length: 100 }, (_, i) => message(200 - i));
    const s = setup([first, second, [message(100)], []]);
    expect(await createBoardFinder(s.client, GUILD)(CHANNEL)).toHaveLength(201);
    expect(s.rest.get.mock.calls.map((call) => (call as unknown[])[1])).toEqual([
      { query: new URLSearchParams({ limit: '100' }) },
      { query: new URLSearchParams({ limit: '100', before: id(201) }) },
      { query: new URLSearchParams({ limit: '100', before: id(101) }) },
      { query: new URLSearchParams({ limit: '100', before: id(100) }) },
    ]);
  });
  it('stops at a known canonical message while still finding every newer orphan', async () => {
    const s = setup([[message(8), message(7), message(6), message(5)]]);
    expect(await createBoardFinder(s.client, GUILD)(CHANNEL, id(6))).toEqual([id(8), id(7)]);
    expect(s.rest.get).toHaveBeenCalledTimes(1);
  });
  it.each([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])('fails before listing when one required permission is missing (%s)', async (remaining) => {
    const s = setup([[]]); s.setPermissions(remaining);
    await expect(createBoardFinder(s.client, GUILD)(CHANNEL)).rejects.toMatchObject({ status: 403 });
    expect(s.rest.get).not.toHaveBeenCalled();
  });
  it('rechecks permission after an empty scan so a revoked history grant is not mistaken for no board', async () => {
    const s = setup(); s.rest.get.mockImplementationOnce(async () => { s.deny(); return []; });
    await expect(createBoardFinder(s.client, GUILD)(CHANNEL)).rejects.toMatchObject({ status: 403 });
  });
  it('rejects an unavailable guild and a channel in another guild', async () => {
    const s = setup(); s.target.available = false;
    await expect(createBoardFinder(s.client, GUILD)(CHANNEL)).rejects.toThrow(); expect(s.rest.get).not.toHaveBeenCalled();
    s.target.available = true; s.channel.guildId = 'other-guild';
    await expect(createBoardFinder(s.client, GUILD)(CHANNEL)).rejects.toMatchObject({ status: 403 }); expect(s.rest.get).not.toHaveBeenCalled();
  });
  it.each([[message(5), message(6)], [message(5), message(5)]])('rejects a non-decreasing page rather than reporting a completed scan', async (...page) => {
    const s = setup([page]); await expect(createBoardFinder(s.client, GUILD)(CHANNEL)).rejects.toThrow();
  });
  it('rejects malformed ids and an invalid boundary before reporting absence', async () => {
    const s = setup([[{ id: 'not-a-snowflake', author: { id: SELF }, components: marker() }]]);
    await expect(createBoardFinder(s.client, GUILD)(CHANNEL)).rejects.toThrow();
    s.rest.get.mockClear();
    await expect(createBoardFinder(s.client, GUILD)(CHANNEL, 'invalid')).rejects.toThrow(); expect(s.rest.get).not.toHaveBeenCalled();
  });
  it('rejects a repeated page cursor rather than scanning forever', async () => {
    const s = setup([[message(6), message(5)], [message(5)]]);
    await expect(createBoardFinder(s.client, GUILD)(CHANNEL)).rejects.toThrow();
  });
  it('propagates a failed history page and an invalid response instead of returning an empty result', async () => {
    const s = setup(); s.rest.get.mockRejectedValueOnce(Object.assign(new Error('network down'), { status: 503 }));
    await expect(createBoardFinder(s.client, GUILD)(CHANNEL)).rejects.toMatchObject({ status: 503 });
    s.rest.get.mockResolvedValueOnce({ messages: [] } as never);
    await expect(createBoardFinder(s.client, GUILD)(CHANNEL)).rejects.toThrow();
  });
});
