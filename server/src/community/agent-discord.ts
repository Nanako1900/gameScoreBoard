import { ChannelType, PermissionFlagsBits as P, REST, Routes, type Client, type Message, type RESTOptions } from 'discord.js';

export interface AgentIncoming {
  discordUserId: string;
  channelId: string;
  messageId: string;
  question: string;
}
export interface AgentDiscord {
  authorize(discordUserId: string, channelId: string): Promise<boolean>;
  send(channelId: string, content: string, replyTo?: string): Promise<{ id: string }>;
  edit(channelId: string, messageId: string, content: string): Promise<void>;
  remove(channelId: string, messageId: string): Promise<void>;
  stop?(): void;
}
export class AgentDiscordError extends Error {
  constructor(readonly code: 'unavailable' | 'not_found' | 'discord_error' | 'invalid_response', readonly uncertain = false) {
    super(code); this.name = 'AgentDiscordError';
  }
}
const ID = /^\d{17,20}$/;
const raw = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const isId = (value: unknown): value is string => typeof value === 'string' && ID.test(value);

/** A reply's implicit mention never admits a request: the token must be in the text. */
export function extractAgentQuestion(message: Message, guildId: string, botId: string): AgentIncoming | null {
  if (!isId(botId) || message.guildId !== guildId || message.channel.type !== ChannelType.GuildText ||
      message.author.bot || message.webhookId != null || message.system || typeof message.content !== 'string') return null;
  const mention = new RegExp(`<@!?${botId}>`, 'g');
  if (!mention.test(message.content)) return null;
  const question = message.content.replace(mention, '').replace(/\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>]+/gi, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/<\s*>|\(\s*\)/g, '').trim();
  return { discordUserId: message.author.id, channelId: message.channelId, messageId: message.id, question };
}

interface Member { id: string; bot: boolean; roles: string[] }
function member(value: unknown): Member | null {
  const row = raw(value), user = raw(row?.user);
  return row && user && isId(user.id) && Array.isArray(row.roles) && row.roles.every(isId)
    ? { id: user.id, bot: user.bot === true, roles: row.roles } : null;
}
function permissionBits(value: unknown): bigint | null {
  return typeof value === 'string' && /^\d+$/.test(value) ? BigInt(value) : null;
}
function permissions(who: Member, ownerId: string, guildId: string, roles: Map<string, bigint>, overwrites: Record<string, unknown>[]): bigint | null {
  if (who.id === ownerId) return -1n;
  let value = roles.get(guildId); if (value === undefined) return null;
  for (const id of who.roles) { const role = roles.get(id); if (role === undefined) return null; value |= role; }
  if ((value & P.Administrator) !== 0n) return -1n;
  const apply = (allow: bigint, deny: bigint) => { value = (value! & ~deny) | allow; };
  const everyone = overwrites.find(item => item.type === 0 && item.id === guildId);
  if (everyone) apply(permissionBits(everyone.allow)!, permissionBits(everyone.deny)!);
  let allow = 0n, deny = 0n;
  for (const item of overwrites) if (item.type === 0 && who.roles.includes(String(item.id))) { allow |= permissionBits(item.allow)!; deny |= permissionBits(item.deny)!; }
  apply(allow, deny);
  const own = overwrites.find(item => item.type === 1 && item.id === who.id);
  if (own) apply(permissionBits(own.allow)!, permissionBits(own.deny)!);
  return value;
}
export function clipAgentText(input: string, maxUnits = 1950): string {
  let result = '';
  for (const point of input) { if (result.length + point.length > maxUnits) break; result += point; }
  return result;
}
function messageBody(content: string) {
  const safe = content.replace(/<@(?:!?|&)\d+>|@everyone|@here/gi, '[已隐藏]');
  return { content: clipAgentText(safe) || '暂时无法回答，请稍后再试。', allowed_mentions: { parse: [], replied_user: false } };
}

/** Unknown writes must never be retried by the SDK underneath the queue guard. */
export function createAgentRest(token: string, makeRequest?: RESTOptions['makeRequest']): REST {
  if (!token) throw new AgentDiscordError('unavailable');
  return new REST({ version: '10', retries: 0, timeout: 10_000, rejectOnRateLimit: () => true,
    hashSweepInterval: 0, handlerSweepInterval: 0, ...(makeRequest ? { makeRequest } : {}) }).setToken(token);
}
type AgentRest = Pick<REST, 'get' | 'post' | 'patch' | 'delete'> & Partial<Pick<REST, 'clearHashSweeper' | 'clearHandlerSweeper'>>;

/** REST facts are deliberately uncached. No messages, attachments or channel history are read. */
export function createAgentDiscord(client: Client, guildId: string, options: { rest?: AgentRest; createRest?: (token: string) => AgentRest } = {}): AgentDiscord {
  let rest = options.rest, stopped = false;
  const calls = new Set<AbortController>();
  const transport = () => rest ??= (options.createRest ?? createAgentRest)(client.token ?? '');
  const ready = () => !stopped && client.isReady() && client.user !== null && client.guilds.cache.get(guildId)?.available === true;
  async function request(method: 'get' | 'post' | 'patch' | 'delete', path: `/${string}`, options?: object): Promise<unknown> {
    if (stopped && method !== 'delete') throw new AgentDiscordError('unavailable');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), method === 'delete' ? 3000 : 10_000);
    calls.add(controller);
    try { return await transport()[method](path, { ...options, signal: controller.signal }); }
    catch (error) {
      const status = raw(error)?.status;
      throw new AgentDiscordError(status === 404 ? 'not_found' : 'discord_error', method !== 'get' && !(typeof status === 'number' && status >= 400 && status < 500));
    }
    finally { clearTimeout(timer); calls.delete(controller); }
  }
  return {
    async authorize(discordUserId, channelId) {
      if (!ready() || !isId(discordUserId) || !isId(channelId)) return false;
      try {
        const selfId = client.user!.id;
        const [guildValue, memberValue, selfValue, channelValue] = await Promise.all([
          request('get', Routes.guild(guildId)), request('get', Routes.guildMember(guildId, discordUserId)),
          request('get', Routes.guildMember(guildId, selfId)), request('get', Routes.channel(channelId)),
        ]);
        // Resolve permissions after the member reads, rather than trusting Gateway caches.
        const rolesValue = await request('get', Routes.guildRoles(guildId));
        const guild = raw(guildValue), caller = member(memberValue), self = member(selfValue), channel = raw(channelValue);
        if (!ready() || !guild || guild.id !== guildId || !isId(guild.owner_id) || !caller || caller.id !== discordUserId || caller.bot ||
            !self || self.id !== selfId || !channel || channel.id !== channelId || channel.guild_id !== guildId || channel.type !== ChannelType.GuildText ||
            !Array.isArray(channel.permission_overwrites) || !Array.isArray(rolesValue)) return false;
        const roles = new Map<string, bigint>();
        for (const item of rolesValue) { const role = raw(item), bits = permissionBits(role?.permissions); if (!role || !isId(role.id) || bits === null || roles.has(role.id)) return false; roles.set(role.id, bits); }
        const overwrites: Record<string, unknown>[] = [], seen = new Set<string>();
        for (const value of channel.permission_overwrites) {
          const item = raw(value);
          if (!item || !isId(item.id) || (item.type !== 0 && item.type !== 1) || permissionBits(item.allow) === null || permissionBits(item.deny) === null) return false;
          const key = `${item.type}:${item.id}`; if (seen.has(key)) return false; seen.add(key); overwrites.push(item);
        }
        const callerBits = permissions(caller, guild.owner_id, guildId, roles, overwrites), selfBits = permissions(self, guild.owner_id, guildId, roles, overwrites);
        const memberRequired = P.ViewChannel | P.SendMessages, botRequired = memberRequired | P.ReadMessageHistory;
        return callerBits !== null && selfBits !== null && (callerBits & memberRequired) === memberRequired && (selfBits & botRequired) === botRequired;
      } catch (error) { if (error instanceof AgentDiscordError && error.code === 'not_found') return false; throw error; }
    },
    async send(channelId, content, replyTo) {
      const body = { ...messageBody(content), ...(replyTo ? { message_reference: { message_id: replyTo, fail_if_not_exists: true }, nonce: `qa:${replyTo}`, enforce_nonce: true } : {}) };
      const sent = raw(await request('post', Routes.channelMessages(channelId), { body }));
      if (!sent || !isId(sent.id)) throw new AgentDiscordError('invalid_response', true);
      return { id: sent.id };
    },
    async edit(channelId, messageId, content) { await request('patch', Routes.channelMessage(channelId, messageId), { body: messageBody(content) }); },
    async remove(channelId, messageId) { try { await request('delete', Routes.channelMessage(channelId, messageId)); } catch (error) { if (!(error instanceof AgentDiscordError) || error.code !== 'not_found') throw error; } },
    stop() { stopped = true; for (const controller of calls) controller.abort(); rest?.clearHashSweeper?.(); rest?.clearHandlerSweeper?.(); },
  };
}
