import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import type { Interaction } from 'discord.js';
import { createClient } from '../src/discord/gateway';
import { COMMUNITY_COMMANDS } from '../src/community/commands';
import { createCommunityRuntime } from '../src/community/runtime';

describe('community runtime retirement routing', () => {
  it('registers only rooms and self-selected roles', () => {
    expect(COMMUNITY_COMMANDS.map(command => command.name)).toEqual(['room', 'roles']);
  });

  it.each(['poll', 'teams', 'draw', 'roll', 'topic', 'room_ai'])('accepts cached /%s solely for its retirement reply without database or Discord work', async name => {
    const client = createClient({ community: true });
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    const runtime = createCommunityRuntime({ client, pool: { query } as unknown as pg.Pool, db: {} as D1Database, guildId: '111111111111111111', frontendUrl: 'https://score.example.com', isReadOnly: () => false, onError: () => undefined });
    try {
      expect(runtime.accepts({ isChatInputCommand: () => true, commandName: name } as unknown as Interaction)).toBe(true);
      expect(runtime.accepts({ isChatInputCommand: () => false, customId: `v1:community:tool:${name}` } as unknown as Interaction)).toBe(true);
      expect(runtime.accepts({ isChatInputCommand: () => true, commandName: 'unrelated' } as unknown as Interaction)).toBe(false);
      expect(query).not.toHaveBeenCalled();
    } finally { await runtime.stop(); await client.destroy(); }
  });
});
