// S4 board buttons reuse private commands against the local PostgreSQL adapter.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tierFor } from '../../shared/scoring';
import { handleBoardButton, handleCommand } from '../../server/src/discord/commands';
import { linkAccounts } from '../../server/src/discord/links';
import type { BotReply } from '../../server/src/discord/types';
import { seedUser } from '../worker/helpers';
import { env, pool } from './cloudflare-test';

const CALLER = { id: '480000000000000001', username: 'private-discord-caller' };
const OTHER = { id: '480000000000000002', username: 'private-discord-other' };
const ctx = { db: env.DB, appUrl: 'https://api.example', frontendUrl: 'https://score.example', offsetHours: 8 };
const command = (commandName: string) => handleCommand({ commandName, caller: CALLER, targetUser: null }, ctx);
const body = (reply: BotReply) => JSON.stringify(reply);
async function bind(id: string, caller = CALLER, admin = false) {
  await seedUser({ id, username: id === 'self' ? '本人' : '别人', score: id === 'self' ? 73 : 10, admin });
  await linkAccounts(env.DB, { userId: id, discordUserId: caller.id, discordUsername: caller.username, replace: false, via: 'web' });
}
async function pending(subject: string, status = 'awaiting_statement', suffix = '') {
  await pool.query(`INSERT INTO records (subject_id,reporter_id,type,delta,status,claim,claim_summary,deadline_at,appeal_reason)
    VALUES ($1,'judge','no_show',-15,$2,$3,$3,'2026-10-28 12:00:00',$4)`,
    [subject, status, `只属于${subject}的经过${suffix}`, `不公开的申诉${suffix}`]);
}
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.parse('2026-10-27T12:00:00Z')); });
afterEach(() => vi.useRealTimers());

describe('private information board buttons', () => {
  it('combines the bound caller’s score and to-dos in one private reply', async () => {
    await bind('self'); await bind('other', OTHER); await seedUser({ id: 'judge', judge: true });
    await pending('self'); await pending('other');
    const score = await command('score'); const todo = await command('todo');
    const reply = await handleBoardButton('me', CALLER, ctx);
    expect(reply.ephemeral).toBe(true);
    expect(reply.embeds).toEqual([...(score.embeds ?? []), ...(todo.embeds ?? [])]);
    expect(body(reply)).toContain(tierFor(73).name);
    expect(body(reply)).toContain('只属于self的经过');
    expect(body(reply)).not.toContain('只属于other的经过');
    expect(body(reply)).not.toContain(tierFor(10).name);
    expect(body(reply)).not.toMatch(/48000000000000000[12]|private-discord|discord_user_id|channel_id/);
    expect(reply.buttons).toEqual([{ label: '打开网页', url: `${ctx.frontendUrl}/` }]);
  });
  it('returns exactly the score binding prompt when the caller is unbound', async () => {
    expect(await handleBoardButton('me', CALLER, ctx)).toEqual(await command('score'));
    expect((await handleBoardButton('me', CALLER, ctx)).ephemeral).toBe(true);
  });
  it('shows exactly the default seven-day voice response for the bound caller', async () => {
    await bind('self'); await bind('other', OTHER);
    await pool.query(`INSERT INTO voice_sessions (user_id,discord_user_id,channel_id,channel_name,joined_at,left_at,start_reason,end_reason)
      VALUES ('other',$1,'private-other-channel','不该看到的语音','2026-10-27 11:00:00','2026-10-27 11:15:00','joined','left')`, [OTHER.id]);
    const reply = await handleBoardButton('voice', CALLER, ctx);
    expect(reply).toEqual(await command('voice'));
    expect(reply.ephemeral).toBe(true);
    expect(body(reply).match(/周[一二三四五六日]/g)).toHaveLength(7);
    expect(body(reply)).not.toMatch(/不该看到的语音|private-other-channel|480000000000000002/);
  });
  it('returns exactly the voice binding prompt when the caller is unbound', async () => {
    const reply = await handleBoardButton('voice', CALLER, ctx);
    expect(reply).toEqual(await command('voice')); expect(reply.ephemeral).toBe(true);
  });
  it('keeps the empty to-do message alongside the caller’s score', async () => {
    await bind('self'); const reply = await handleBoardButton('me', CALLER, ctx);
    expect(reply.ephemeral).toBe(true); expect(reply.embeds).toEqual((await command('score')).embeds);
    expect(reply.content).toBe((await command('todo')).content);
  });
  it('keeps admin appeals and all combined text within Discord’s one-message limits', async () => {
    await bind('self', CALLER, true); await bind('other', OTHER); await seedUser({ id: 'judge', judge: true });
    for (let i = 0; i < 12; i += 1) { await pending('self', 'awaiting_statement', '长'.repeat(1000)); await pending('other', 'appealed', String(i)); }
    const score = await command('score'); const todo = await command('todo');
    const reply = await handleBoardButton('me', CALLER, ctx);
    expect(reply.ephemeral).toBe(true); expect(reply.embeds).toEqual([...(score.embeds ?? []), ...(todo.embeds ?? [])]);
    const text = (reply.embeds ?? []).flatMap(e => [e.title ?? '', e.description ?? '', e.footer?.text ?? '', ...(e.fields ?? []).flatMap(f => [f.name, f.value])]).join('');
    expect(text.length).toBeLessThanOrEqual(6000); expect(reply.embeds?.length).toBeLessThanOrEqual(10);
    expect(body(reply)).toContain('待复核的申诉'); expect(body(reply)).not.toContain('不公开的申诉');
    expect(reply.buttons).toHaveLength(1);
  });
});
