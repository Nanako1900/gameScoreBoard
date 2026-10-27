// Recovery uses only message ids, author ids and our own two-button marker.
// Ordinary chat bodies and embeds are never inspected, cached or returned.
import { PermissionFlagsBits, Routes, type Client } from 'discord.js';
import type { ChannelApi } from '../outbox/kit';

const SNOWFLAKE = /^\d{17,20}$/;
const REQUIRED = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ReadMessageHistory;
const forbidden = () => Object.assign(new Error('board recovery requires channel view and message history permission'), { status: 403, code: 50013 });
const invalid = () => new Error('board history scan did not complete safely');

function marked(components: unknown): boolean {
  if (!Array.isArray(components)) return false;
  const ids = new Set<string>();
  for (const row of components) {
    if (row?.type !== 1 || !Array.isArray(row.components)) continue;
    for (const button of row.components) {
      if (button?.type === 2 && typeof button.custom_id === 'string') ids.add(button.custom_id);
    }
  }
  return ids.has('v1:board:me') && ids.has('v1:board:voice');
}

/** Fresh permissions are essential: Discord returns [] when history is denied. */
export function createBoardFinder(client: Client<true>, guildId: string): NonNullable<ChannelApi['findBoards']> {
  return async (channelId, afterId) => {
    if (!SNOWFLAKE.test(channelId) || (afterId !== undefined && !SNOWFLAKE.test(afterId))) throw invalid();
    const permissions = async (): Promise<void> => {
      const guild = client.guilds.cache.get(guildId);
      if (!guild?.available) throw Object.assign(new Error('board guild is unavailable'), { status: 503 });
      const [channel, member] = await Promise.all([
        guild.channels.fetch(channelId, { force: true }).catch((error: unknown) => {
          if ((error as { code?: unknown } | null)?.code === 'GuildChannelUnowned') throw forbidden();
          throw error;
        }),
        guild.members.fetchMe({ force: true }),
        guild.roles.fetch(),
      ]);
      if (!channel || channel.guildId !== guildId || !channel.isTextBased()
        || !channel.permissionsFor(member)?.has(REQUIRED)) throw forbidden();
    };
    await permissions();
    const found: string[] = [];
    let before: string | undefined;
    let finished = false;
    while (!finished) {
      const query = new URLSearchParams({ limit: '100' });
      if (before) query.set('before', before);
      const response: unknown = await client.rest.get(Routes.channelMessages(channelId), { query });
      if (!Array.isArray(response) || response.length > 100) throw invalid();
      if (!response.length) break;
      let previous = before;
      for (const message of response) {
        const id: unknown = message?.id;
        if (typeof id !== 'string' || !SNOWFLAKE.test(id)
          || (previous !== undefined && BigInt(id) >= BigInt(previous))) throw invalid();
        previous = id;
        if (afterId !== undefined && BigInt(id) <= BigInt(afterId)) { finished = true; break; }
        // Check the author first: other messages' content/components are irrelevant.
        if (message.author?.id === client.user.id && marked(message.components)) found.push(id);
      }
      if (!previous || previous === before) throw invalid();
      before = previous;
    }
    // A revocation during pagination must not turn an incomplete scan into an
    // empty-channel verdict. No send follows a failed permissions refresh.
    await permissions();
    return found;
  };
}
