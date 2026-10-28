import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultCommunitySettings } from '../../shared/community';
import { CommunityDiscordError, type CommunityDiscord, type CommunityDiscordMember, type CommunityDiscordResource } from '../../server/src/community/discord';
import { CommunityMembershipService, readCommunityRoles } from '../../server/src/community/membership';
import { CommunityStore, CommunityStoreError, type StoredOperation } from '../../server/src/community/store';
import { CommunityService } from '../../server/src/community/service';
import { pool, env } from './cloudflare-test';

const GUILD = '111111111111111111';
const MEMBER = '222222222222222222';
const CHANNEL = '333333333333333333';
const JOIN = '2026-10-28T08:00:00.000Z';
let store: CommunityStore;
let liveMember: CommunityDiscordMember | null;
let resources: CommunityDiscordResource[];
let discord: CommunityDiscord;
let service: CommunityMembershipService;
afterEach(() => { vi.restoreAllMocks(); });

beforeEach(async () => {
  store = new CommunityStore(pool, GUILD);
  liveMember = { id: MEMBER, name: '成员', bot: false, roleIds: [], protected: false, joinedAt: JOIN };
  resources = [];
  discord = {
    member: vi.fn(async () => liveMember),
    snapshot: vi.fn(async () => ({ ready: true, selfId: '444444444444444444', guildName: '社区', members: liveMember ? [liveMember] : [], resources })),
    channel: vi.fn(async () => ({ id: CHANNEL, name: '欢迎', kind: 'text', parentId: null })),
    addRole: vi.fn(async (_member: string, role: string) => { liveMember!.roleIds.push(role); }),
    removeRole: vi.fn(async (_member: string, role: string) => { liveMember!.roleIds = liveMember!.roleIds.filter(id => id !== role); }),
    sendText: vi.fn(async () => '555555555555555555'),
  } as unknown as CommunityDiscord;
  service = new CommunityMembershipService(store, discord);
  await store.upsertResource('member', MEMBER, '成员');
  const settings = defaultCommunitySettings(); settings.enabled = true; settings.roles.enabled = true;
  await store.saveSettings(settings, 0);
});

async function configure(change: (settings: ReturnType<typeof defaultCommunitySettings>) => void) {
  const value = await store.settings(); change(value.settings); await store.saveSettings(value.settings, value.version);
}
async function memberRef() { return (await store.storedResources('member'))[0].ref; }
async function role(id = '666666666666666666', assigned = false) {
  const row = await store.upsertResource('role', id, '兴趣', { safe: true });
  resources.push({ id, name: '兴趣', kind: 'role', safe: true, available: true });
  await configure(settings => { settings.roles.allowedRefs.push(row.ref); });
  if (assigned) {
    liveMember!.roleIds.push(id);
    await pool.query('INSERT INTO community_role_choices(guild_id,member_ref,role_ref) VALUES($1,$2,$3)', [GUILD, await memberRef(), row.ref]);
  }
  return row;
}
async function welcomeOperation(claim = true) {
  const channel = await store.upsertResource('text', CHANNEL, '欢迎');
  resources.push({ id: CHANNEL, name: '欢迎', kind: 'text', available: true, metadata: { publicView: true } });
  await configure(settings => { settings.welcome.enabled = true; settings.welcome.channelRef = channel.ref; });
  await service.welcome(MEMBER);
  if (!claim) return (await store.getOperation((await store.listOperations())[0].ref))!;
  return (await store.claim())!;
}
async function welcomeSlot() { return (await pool.query('SELECT pending_ref,last_sent_at FROM community_welcomes WHERE guild_id=$1 AND member_ref=$2', [GUILD, await memberRef()])).rows[0]; }

it('exports an API-only role reader which includes removable old selections without exposing Discord identifiers', async () => {
  const selected = await role(undefined, true);
  await store.upsertResource('role', selected.externalId, '<@222222222222222222> 666666666666666666', { safe: true });
  await configure(settings => { settings.roles.allowedRefs = []; settings.roles.enabled = false; });
  const result = await readCommunityRoles(store, await memberRef());
  expect(result).toMatchObject({ enabled: false, maxChoices: 5, selectedRefs: [selected.ref], choices: [{ ref: selected.ref, available: false }] });
  const text = JSON.stringify(result); expect(text).not.toMatch(/externalId|metadata|discord|222222222222222222|666666666666666666/);
});

it.each(['module', 'roles', 'allowlist'])('allows a member to remove a module-assigned identity after %s is disabled or revoked', async mode => {
  const selected = await role(undefined, true);
  await configure(settings => {
    if (mode === 'module') settings.enabled = false;
    if (mode === 'roles') settings.roles.enabled = false;
    if (mode === 'allowlist') settings.roles.allowedRefs = [];
  });
  expect(await service.setRoles(await memberRef(), [])).toEqual({ selectedRefs: [] });
  expect(discord.removeRole).toHaveBeenCalledWith(MEMBER, selected.externalId);
  expect((await pool.query('SELECT * FROM community_role_choices')).rows).toHaveLength(0);
});

it('permits keeping a revoked selection while removing another, but rejects new selections after disabling', async () => {
  const keep = await role(undefined, true); const remove = await role('777777777777777777', true);
  await configure(settings => { settings.roles.allowedRefs = []; });
  expect(await service.setRoles(await memberRef(), [keep.ref])).toEqual({ selectedRefs: [keep.ref] });
  expect(discord.removeRole).toHaveBeenCalledWith(MEMBER, remove.externalId);
  await configure(settings => { settings.roles.enabled = false; });
  await expect(service.setRoles(await memberRef(), [keep.ref, remove.ref])).rejects.toMatchObject({ code: 'feature_disabled' });
});

it('does not take ownership of a pre-existing moderator role or remove it on a later empty selection', async () => {
  const selected = await role(); liveMember!.roleIds = [selected.externalId];
  expect(await service.setRoles(await memberRef(), [selected.ref])).toEqual({ selectedRefs: [] });
  await service.setRoles(await memberRef(), []);
  expect(discord.addRole).not.toHaveBeenCalled(); expect(discord.removeRole).not.toHaveBeenCalled();
  expect((await pool.query('SELECT * FROM community_role_choices')).rows).toHaveLength(0);
});

it('refuses to remove an assigned role that has become privileged or managed, before performing any writes', async () => {
  const selected = await role(undefined, true); resources[0].safe = false;
  await expect(service.setRoles(await memberRef(), [])).rejects.toMatchObject({ status: 409 });
  expect(discord.removeRole).not.toHaveBeenCalled();
  expect((await pool.query('SELECT role_ref FROM community_role_choices')).rows).toEqual([{ role_ref: selected.ref }]);
});

it('removes tracking for an already absent role without touching other moderator roles', async () => {
  const selected = await role(undefined, true); liveMember!.roleIds = ['777777777777777777']; resources = [];
  expect(await service.setRoles(await memberRef(), [])).toEqual({ selectedRefs: [] });
  expect(discord.removeRole).not.toHaveBeenCalled(); expect(liveMember!.roleIds).toEqual(['777777777777777777']);
  expect((await pool.query('SELECT role_ref FROM community_role_choices')).rows).not.toContainEqual({ role_ref: selected.ref });
});

it('marks a partially applied role change uncertain when a later Discord write fails', async () => {
  await role(undefined, true); const addition = await role('777777777777777777');
  vi.mocked(discord.addRole).mockRejectedValueOnce(new CommunityDiscordError(403, '权限已变化'));
  await expect(service.setRoles(await memberRef(), [addition.ref])).rejects.toMatchObject({ uncertain: true });
  expect(discord.removeRole).toHaveBeenCalledTimes(1);
});

it('does not make Discord role writes from an expired or stale operation claim', async () => {
  const selected = await role(); const actor = { source: 'discord' as const, memberRef: await memberRef() };
  await store.enqueue('roles.set', null, actor, { refs: [selected.ref] }, 'roles-expired');
  const op = (await store.claim())!;
  await pool.query("UPDATE community_operations SET lease_until=now()-interval '1 second' WHERE ref=$1", [op.ref]);
  await expect(service.setRoles(actor.memberRef, [selected.ref], op)).rejects.toMatchObject({ uncertain: true });
  expect(discord.addRole).not.toHaveBeenCalled();
});

it('atomically queues only one welcome under duplicate fresh join events and persists a 24 hour cooldown', async () => {
  const op = await welcomeOperation();
  await Promise.all([service.welcome(MEMBER), service.welcome(MEMBER)]);
  expect(await store.listOperations()).toHaveLength(1);
  expect(await service.sendWelcome(op)).toEqual({ sent: true });
  await service.welcome(MEMBER); expect(await store.listOperations()).toHaveLength(1);
  await pool.query("UPDATE community_welcomes SET last_sent_at=now()-interval '25 hours'");
  await store.finish(op.ref, op.claimToken!, { status: 'succeeded' });
  await service.welcome(MEMBER); expect(await store.listOperations()).toHaveLength(2);
});

it('honors the administrator configured rejoin cooldown while keeping the default at 24 hours', async () => {
  const op = await welcomeOperation(); await service.sendWelcome(op); await store.finish(op.ref, op.claimToken!, { status: 'succeeded' });
  expect((await store.settings()).settings.welcome.rejoinCooldownHours).toBe(24);
  await configure(settings => { settings.welcome.rejoinCooldownHours = 1; });
  await pool.query("UPDATE community_welcomes SET last_sent_at=now()-interval '2 hours'");
  await service.welcome(MEMBER); expect(await store.listOperations()).toHaveLength(2);
});

it.each(['unknown', 'changed', 'rejoined'])('does not welcome a member with %s join evidence', async mode => {
  const op = await welcomeOperation();
  liveMember!.joinedAt = mode === 'unknown' ? null : '2026-10-28T09:00:00.000Z';
  if (mode === 'rejoined') await service.welcome(MEMBER);
  expect(await service.sendWelcome(op)).toEqual({ sent: false });
  expect(discord.sendText).not.toHaveBeenCalled();
});

it('does not queue a welcome without a reliable fresh join timestamp', async () => {
  await welcomeOperation(); await pool.query('TRUNCATE community_welcomes,community_operations CASCADE');
  liveMember!.joinedAt = null; await service.welcome(MEMBER);
  expect(await store.listOperations()).toHaveLength(0);
});

it.each(['private', 'wrong-kind', 'missing'])('requires a fresh public text welcome target: %s', async mode => {
  const op = await welcomeOperation();
  if (mode === 'private') resources[0].metadata = { publicView: false };
  if (mode === 'wrong-kind') vi.mocked(discord.channel).mockResolvedValue({ id: CHANNEL, name: '语音', kind: 'voice', parentId: null });
  if (mode === 'missing') resources = [];
  await expect(service.sendWelcome(op)).rejects.toMatchObject({ status: 409 });
  expect(discord.sendText).not.toHaveBeenCalled();
});

it.each(['lease', 'expiry', 'finished'])('retains the pending welcome and refuses a %s operation', async mode => {
  const op = await welcomeOperation();
  if (mode === 'lease') await pool.query("UPDATE community_operations SET lease_until=now()-interval '1 second' WHERE ref=$1", [op.ref]);
  if (mode === 'expiry') await pool.query("UPDATE community_operations SET expires_at=now()-interval '1 second' WHERE ref=$1", [op.ref]);
  if (mode === 'finished') await store.finish(op.ref, op.claimToken!, { status: 'needs_review', error: 'execution_uncertain' });
  await expect(service.sendWelcome(op)).rejects.toMatchObject({ uncertain: true });
  expect(discord.sendText).not.toHaveBeenCalled(); expect((await welcomeSlot()).pending_ref).toBe(op.ref);
});

it('retains an uncertain welcome send for administrator reconciliation instead of repeating on another join event', async () => {
  const op = await welcomeOperation();
  vi.mocked(discord.sendText).mockRejectedValueOnce(new CommunityDiscordError(503, '结果未知', true));
  await expect(service.sendWelcome(op)).rejects.toMatchObject({ uncertain: true });
  expect((await welcomeSlot()).pending_ref).toBe(op.ref);
  await service.welcome(MEMBER); expect(await store.listOperations()).toHaveLength(1); expect(discord.sendText).toHaveBeenCalledTimes(1);
});

it('sanitizes welcome placeholders so names cannot insert Discord identifiers or mentions', async () => {
  const op = await welcomeOperation(); liveMember!.name = '<@222222222222222222> 777777777777777777';
  expect(await service.sendWelcome(op)).toEqual({ sent: true });
  expect(vi.mocked(discord.sendText).mock.calls[0][1]).not.toMatch(/<@|222222222222222222|777777777777777777/);
});

it('does not dispatch a queued welcome operation before it has a valid running claim', async () => {
  const op = await welcomeOperation(); await store.finish(op.ref, op.claimToken!, { status: 'retry_wait' });
  const queued = (await store.getOperation(op.ref)) as StoredOperation;
  await expect(service.sendWelcome(queued)).rejects.toMatchObject({ uncertain: true });
  expect(discord.sendText).not.toHaveBeenCalled();
});

it('checks membership again immediately before the welcome send if it changes during the snapshot', async () => {
  const op = await welcomeOperation();
  vi.mocked(discord.snapshot).mockImplementationOnce(async () => {
    liveMember = null;
    return { ready: true, selfId: '444444444444444444', guildName: '社区', resources, members: [] };
  });
  expect(await service.sendWelcome(op)).toEqual({ sent: false });
  expect(discord.sendText).not.toHaveBeenCalled();
});

it('honors a welcome switch changed during the fresh Discord snapshot', async () => {
  const op = await welcomeOperation();
  vi.mocked(discord.snapshot).mockImplementationOnce(async () => {
    await configure(settings => { settings.welcome.enabled = false; });
    return { ready: true, selfId: '444444444444444444', guildName: '社区', resources, members: liveMember ? [liveMember] : [] };
  });
  expect(await service.sendWelcome(op)).toEqual({ sent: false });
  expect(discord.sendText).not.toHaveBeenCalled();
});

it('does not repeat a successful welcome send whose result could not be saved', async () => {
  const op = await welcomeOperation();
  const query = pool.query.bind(pool);
  vi.spyOn(pool, 'query').mockImplementation(((...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('SET last_sent_at=now()')) throw new Error('database unavailable');
    return (query as (...params: unknown[]) => unknown)(...args);
  }) as typeof pool.query);
  await expect(service.sendWelcome(op)).rejects.toMatchObject({ uncertain: true });
  expect(discord.sendText).toHaveBeenCalledTimes(1);
  expect((await welcomeSlot()).pending_ref).toBe(op.ref);
  await service.welcome(MEMBER); expect(await store.listOperations()).toHaveLength(1);
});

it('marks role persistence failure after the external write uncertain without adopting ownership', async () => {
  const selected = await role();
  const query = pool.query.bind(pool);
  vi.spyOn(pool, 'query').mockImplementation(((...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('INSERT INTO community_role_choices')) throw new Error('database unavailable');
    return (query as (...params: unknown[]) => unknown)(...args);
  }) as typeof pool.query);
  await expect(service.setRoles(await memberRef(), [selected.ref])).rejects.toMatchObject({ uncertain: true });
  expect(discord.addRole).toHaveBeenCalledTimes(1);
  expect((await pool.query('SELECT * FROM community_role_choices')).rows).toHaveLength(0);
});

it('rechecks the allowlist after fetching the fresh role snapshot', async () => {
  const selected = await role();
  vi.mocked(discord.snapshot).mockImplementationOnce(async () => {
    await configure(settings => { settings.roles.allowedRefs = []; });
    return { ready: true, selfId: '444444444444444444', guildName: '社区', resources, members: liveMember ? [liveMember] : [] };
  });
  await expect(service.setRoles(await memberRef(), [selected.ref])).rejects.toMatchObject({ status: 409 });
  expect(discord.addRole).not.toHaveBeenCalled();
});

it('allows pure removals toward a lowered choice limit without using that exemption to add another role', async () => {
  const first = await role(undefined, true); const second = await role('777777777777777777', true);
  await role('888888888888888888', true); const addition = await role('999999999999999999');
  await configure(settings => { settings.roles.maxChoices = 1; });
  expect((await service.setRoles(await memberRef(), [first.ref, second.ref])).selectedRefs.sort()).toEqual([first.ref, second.ref].sort());
  await expect(service.setRoles(await memberRef(), [first.ref, addition.ref])).rejects.toMatchObject({ status: 400 });
  expect(discord.addRole).not.toHaveBeenCalled();
});

it('reads only this guild member and role resources through the exported API helper', async () => {
  const other = new CommunityStore(pool, '999999999999999999');
  const stranger = await other.upsertResource('member', '888888888888888888', '其他服务器');
  await expect(readCommunityRoles(store, stranger.ref)).rejects.toMatchObject({ status: 404 });
  expect(discord.snapshot).not.toHaveBeenCalled(); expect(discord.member).not.toHaveBeenCalled();
});

it('enqueues only pure removal subsets when the configured limit was lowered below the previous selection count', async () => {
  const first = await role(undefined, true); const second = await role('777777777777777777', true);
  await role('888888888888888888', true); const addition = await role('999999999999999999');
  await configure(settings => { settings.roles.maxChoices = 1; });
  await store.setRuntime({ ready: true, syncedAt: new Date().toISOString() });
  const api = new CommunityService(store, env.DB); const actor = { source: 'discord' as const, memberRef: await memberRef() };
  await expect(api.enqueueForActor(actor, 'roles.set', null, { roleRefs: [first.ref, addition.ref] }, 'mixed-change')).rejects.toMatchObject({ status: 400 });
  expect((await api.enqueueForActor(actor, 'roles.set', null, { roleRefs: [first.ref, second.ref] }, 'pure-removal')).status).toBe('queued');
});

it('rechecks caller authority before each role mutation and quarantines a partially applied change when it is revoked', async () => {
  await role(undefined, true); const addition = await role('777777777777777777');
  const guard = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new CommunityStoreError(409, 'version_conflict', '绑定已变化'));
  await expect(service.setRoles(await memberRef(), [addition.ref], undefined, guard)).rejects.toMatchObject({ uncertain: true });
  expect(guard).toHaveBeenCalledTimes(2); expect(discord.removeRole).toHaveBeenCalledTimes(1); expect(discord.addRole).not.toHaveBeenCalled();
});

it.each(['expired', 'certain-failure'])('allows a fresh join event to replace a welcome pending slot after %s proves it was not sent', async mode => {
  const op = await welcomeOperation(mode !== 'expired');
  if (mode === 'expired') {
    await pool.query("UPDATE community_operations SET expires_at=now()-interval '1 second' WHERE ref=$1", [op.ref]);
    await store.recoverExpired(); expect((await store.getOperation(op.ref))!.status).toBe('canceled');
  } else await store.finish(op.ref, op.claimToken!, { status: 'failed', error: 'permissions_missing' });
  expect(discord.sendText).not.toHaveBeenCalled(); await service.welcome(MEMBER);
  expect(await store.listOperations()).toHaveLength(2); expect((await welcomeSlot()).pending_ref).not.toBe(op.ref);
});

it.each(['queued', 'running', 'needs_review'])('retains a %s welcome slot under a new join event', async mode => {
  const op = await welcomeOperation(mode !== 'queued');
  if (mode === 'needs_review') await store.finish(op.ref, op.claimToken!, { status: 'needs_review', error: 'execution_uncertain' });
  await service.welcome(MEMBER); expect(await store.listOperations()).toHaveLength(1); expect((await welcomeSlot()).pending_ref).toBe(op.ref);
});
