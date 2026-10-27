import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleCommand } from '../../server/src/discord/commands';
import { linkAccounts } from '../../server/src/discord/links';
import type { BotReply } from '../../server/src/discord/types';
import { seedUser } from '../worker/helpers';
import { env, pool } from './cloudflare-test';
const CALLER = '400000000000000001'; const TARGET = '400000000000000002';
const CONTEXT = { db: env.DB, appUrl: 'https://api.example.com', frontendUrl: 'https://score.example.com', offsetHours: 8 };
const command = (days?: number, target = false, readOnly = false) => handleCommand({ commandName: 'voice', caller: { id: CALLER, username: 'Discord自己' },
  targetUser: target ? { id: TARGET, username: 'Discord别人' } : null, ...(days === undefined ? {} : { days }) }, { ...CONTEXT, readOnly });
async function bind(id: string, discord: string, roles: { judge?: boolean; admin?: boolean } = {}) {
  await seedUser({ id, username: id === 'self' ? '自己' : '别人', ...roles });
  await linkAccounts(env.DB, { userId: id, discordUserId: discord, discordUsername: 'private-binding-nickname', replace: false, via: 'web' });
}
const text = (reply: BotReply) => [reply.content, ...(reply.embeds ?? []).flatMap((embed) => [embed.title, embed.description,
  ...(embed.fields ?? []).flatMap((field) => [field.name, field.value]), embed.footer?.text])].join('\n').replaceAll('\\', '');
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.parse('2026-10-27T12:00:00Z')); });
afterEach(() => vi.useRealTimers());
describe('/voice private evidence command', () => {
  it('asks an unbound caller to link first', async () => {
    const reply = await command(); expect(reply.ephemeral).toBe(true); expect(reply.content).toContain('/link');
  });
  it('shows seven board dates by default for the caller and never exposes binding identifiers', async () => {
    await bind('self', CALLER);
    await pool.query(`INSERT INTO voice_sessions (user_id, discord_user_id, channel_id, channel_name, joined_at, left_at, start_reason, end_reason)
      VALUES ('self', $1, 'secret-channel', '开黑一号', '2026-10-27 10:00:00', '2026-10-27 10:12:00', 'joined', 'left')`, [CALLER]);
    const reply = await command(); const body = text(reply);
    expect(reply.ephemeral).toBe(true); expect(reply.embeds).toHaveLength(1);
    expect(body.match(/周[一二三四五六日]/g)).toHaveLength(7); expect(body).toContain('12 分');
    expect(body).toContain('开黑一号'); expect(body).toContain('这段时间机器人不在线，没有记录不代表没来。');
    expect(JSON.stringify(reply)).not.toMatch(/private-binding-nickname|secret-channel|discord_user_id|channel_id|40000000000000000[12]/);
  });
  it('refuses an explicit person option for an ordinary caller', async () => {
    await bind('self', CALLER); await bind('other', TARGET);
    const reply = await command(undefined, true);
    expect(reply.ephemeral).toBe(true); expect(reply.content).toBe('只有裁判和管理员能查别人的语音记录');
  });
  it.each(['judge', 'admin'] as const)('allows %s to read a bound target privately', async (role) => {
    await bind('self', CALLER, { [role]: true }); await bind('other', TARGET);
    const reply = await command(undefined, true); expect(reply.ephemeral).toBe(true); expect(text(reply)).toContain('别人');
  });
  it('explains a target without a binding', async () => {
    await bind('self', CALLER, { judge: true });
    const reply = await command(undefined, true); expect(reply.ephemeral).toBe(true); expect(reply.content).toBe('TA 还没绑定 Nanako 账号');
  });
  it('accepts fourteen days at the command limit', async () => {
    await bind('self', CALLER); expect(text(await command(14)).match(/周[一二三四五六日]/g)).toHaveLength(14);
  });
  it.each([0, 15, 1.5, NaN])('refuses invalid integer day count %s', async (days) => {
    await bind('self', CALLER); const reply = await command(days);
    expect(reply.ephemeral).toBe(true); expect(reply.content).toMatch(/1.*14/); expect(reply.embeds).toBeUndefined();
  });
  it('remains readable in business read-only maintenance mode', async () => {
    await bind('self', CALLER); expect((await command(7, false, true)).embeds).toHaveLength(1);
  });
});
