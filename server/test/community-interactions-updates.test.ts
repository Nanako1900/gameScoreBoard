import { randomUUID } from 'node:crypto';
import { MessageFlags } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { RETIRED_COMMUNITY_COMMAND_NAMES } from '../src/community/commands';
import { handleCommunityInteraction } from '../src/community/interactions';
import { CommunityStoreError, type StoredOperation } from '../src/community/store';
import { setup, memberRef, roomRef, roleRef, funRef } from './community-interactions.fixture';

type State = ReturnType<typeof setup>;
const output = (s: State) => JSON.stringify([s.input.reply.mock.calls, s.input.update.mock.calls, s.input.editReply.mock.calls, s.input.followUp.mock.calls]);
function onlySourceUpdate(s: State) {
  expect(s.input.deferUpdate).toHaveBeenCalledOnce(); expect(s.input.editReply).toHaveBeenCalledOnce();
  expect(s.input.deferReply).not.toHaveBeenCalled(); expect(s.input.reply).not.toHaveBeenCalled(); expect(s.input.followUp).not.toHaveBeenCalled();
}
describe('community source-message updates', () => {
  it.each(['shared', 'private'] as const)('chooses %s center-button behavior from actual flags', async source => {
    const s = setup('button', 'v1:community:roles', source); s.input.ephemeral = source === 'shared'; await handleCommunityInteraction(s.interaction, s.deps);
    if (source === 'private') onlySourceUpdate(s); else { expect(s.input.deferReply).toHaveBeenCalledOnce(); expect(s.input.deferUpdate).not.toHaveBeenCalled(); }
  });
  it('keeps private navigation, member selection, confirmation and refresh on their source card', async () => {
    for (const id of [`visibility:${roomRef}:2`, `target:grant:${roomRef}:2`, `confirm:admin_delete:${roomRef}:2`, `op:${randomUUID()}`, `room:${roomRef}`]) {
      const s = setup('button', `v1:community:${id}`, 'private'); await handleCommunityInteraction(s.interaction, s.deps); onlySourceUpdate(s);
    }
  });
  it.each([`visibility:${roomRef}:2`, `target:grant:${roomRef}:2`, `confirm:dissolve:${roomRef}:2`])('can leave the private %s page without executing its action', async id => {
    const s = setup('button', `v1:community:${id}`, 'private'); await handleCommunityInteraction(s.interaction, s.deps);
    expect(output(s)).toContain(`v1:community:room:${roomRef}`); expect(s.deps.service.enqueueForActor).not.toHaveBeenCalled(); onlySourceUpdate(s);
    if (id.startsWith('confirm')) expect(output(s)).toContain('取消');
  });
  it('uses the private modal version and repaints the latest successful room', async () => {
    const s = setup('modal', `v1:community:submit:rename:${roomRef}:2`, 'private'); s.op.status = 'succeeded';
    s.store.getRoom.mockResolvedValueOnce(s.room).mockResolvedValue({ ...s.room, name: '新的名字', version: 3 }); await handleCommunityInteraction(s.interaction, s.deps);
    expect(s.deps.service.enqueueForActor).toHaveBeenCalledWith({ source: 'discord', memberRef }, 'room.rename', roomRef, { name: '新的名字' }, expect.any(String), 2);
    onlySourceUpdate(s); expect(output(s)).toContain('新的名字'); expect(output(s)).toContain(`v1:community:edit:rename:${roomRef}:3`);
  });
  it('requires modal.isFromMessage even if message-like data is present', async () => {
    const s = setup('modal', `v1:community:submit:rename:${roomRef}:2`, 'none'); s.input.message = { id: 'bogus', flags: { has: () => true } };
    await handleCommunityInteraction(s.interaction, s.deps); expect(s.input.deferReply).toHaveBeenCalledOnce(); expect(s.input.deferUpdate).not.toHaveBeenCalled();
  });
  it('stays quiet when a shared-room modal succeeds', async () => {
    const s = setup('modal', `v1:community:panelsubmit:rename:${roomRef}`, 'shared'); s.op.status = 'succeeded'; await handleCommunityInteraction(s.interaction, s.deps);
    expect(s.input.deferUpdate).toHaveBeenCalledOnce(); expect(s.input.deferReply).not.toHaveBeenCalled(); expect(s.input.editReply).not.toHaveBeenCalled(); expect(s.input.followUp).not.toHaveBeenCalled();
  });
  it('reports a shared modal execution failure privately', async () => {
    const s = setup('modal', `v1:community:panelsubmit:rename:${roomRef}`, 'shared'); s.op.status = 'failed'; s.op.error = '房间状态已变化';
    await handleCommunityInteraction(s.interaction, s.deps); expect(s.input.editReply).not.toHaveBeenCalled(); expect(s.input.followUp).toHaveBeenCalledOnce(); expect(output(s)).toContain('操作失败');
    expect(s.input.followUp).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral }));
  });
  it('propagates a lost private follow-up without sending a second receipt or touching the shared card', async () => {
    const s = setup('modal', `v1:community:panelsubmit:rename:${roomRef}`, 'shared'); s.input.followUp.mockRejectedValue(new Error('private receipt response lost'));
    await expect(handleCommunityInteraction(s.interaction, s.deps)).rejects.toThrow('private receipt response lost');
    expect(s.input.followUp).toHaveBeenCalledOnce(); expect(s.input.editReply).not.toHaveBeenCalled(); expect(s.input.reply).not.toHaveBeenCalled();
  });
  it('gives queued shared modals one private card after bounded polling', async () => {
    const s = setup('modal', `v1:community:panelsubmit:rename:${roomRef}`, 'shared'); await handleCommunityInteraction(s.interaction, s.deps);
    expect(s.wait).toHaveBeenCalledTimes(3); expect(s.store.getOperation).toHaveBeenCalledTimes(4); expect(s.input.followUp).toHaveBeenCalledOnce(); expect(s.input.editReply).not.toHaveBeenCalled();
    expect(output(s)).toContain('已排队'); expect(output(s)).toContain(`v1:community:op:${s.op.ref}`); expect(output(s)).not.toContain('操作已完成');
  });
  it('waits briefly and stays quiet if a queued operation succeeds', async () => {
    const s = setup('modal', `v1:community:panelsubmit:rename:${roomRef}`, 'shared'); s.store.getOperation.mockResolvedValueOnce(s.op).mockResolvedValue({ ...s.op, status: 'succeeded' });
    await handleCommunityInteraction(s.interaction, s.deps); expect(s.wait).toHaveBeenCalledOnce(); expect(s.input.followUp).not.toHaveBeenCalled(); expect(s.input.editReply).not.toHaveBeenCalled();
  });
  it('does not let a slow engine wake defeat the polling deadline', async () => {
    const s = setup('select', `v1:community:setvisibility:${roomRef}:2`, 'private'); s.input.values = ['locked']; vi.mocked(s.deps.wake!).mockImplementation(() => new Promise<void>(() => {}));
    await handleCommunityInteraction(s.interaction, s.deps); expect(s.wait).toHaveBeenCalledTimes(3); onlySourceUpdate(s); expect(output(s)).toContain('已排队');
  });
  it('does not call durable work failed merely because wake rejects', async () => {
    const s = setup('select', `v1:community:setvisibility:${roomRef}:2`, 'private'); s.input.values = ['locked']; s.op.status = 'succeeded'; vi.mocked(s.deps.wake!).mockRejectedValue(new Error('wake unavailable'));
    await handleCommunityInteraction(s.interaction, s.deps); onlySourceUpdate(s); expect(output(s)).toContain('操作已完成'); expect(output(s)).not.toContain('暂不可用');
  });
  it.each(['null', 'read-error', 'unknown-status'])('never claims completion for %s', async condition => {
    const s = setup('select', `v1:community:setvisibility:${roomRef}:2`, 'private'); s.input.values = ['locked'];
    if (condition === 'null') s.store.getOperation.mockResolvedValue(null);
    else if (condition === 'read-error') s.store.getOperation.mockRejectedValue(new Error('read unavailable'));
    else s.op.status = 'unrecognized' as typeof s.op.status;
    await handleCommunityInteraction(s.interaction, s.deps); expect(output(s)).not.toContain('操作已完成'); expect(output(s)).toContain(`v1:community:op:${s.op.ref}`); onlySourceUpdate(s);
  });
  it('does not expose a successful operation after current room access is lost', async () => {
    const s = setup('button', `v1:community:op:${randomUUID()}`, 'private'); s.op.status = 'succeeded'; vi.mocked(s.deps.discord.canView).mockResolvedValue(false);
    await handleCommunityInteraction(s.interaction, s.deps); expect(output(s)).toContain('不存在或已不可见'); expect(output(s)).not.toContain('操作已完成'); expect(output(s)).not.toContain('小屋'); onlySourceUpdate(s);
  });
  it.each(['queued', 'failed', 'needs_review', 'succeeded', 'closed'])('hides %s operation state and room references after room access is lost', async state => {
    const s = setup('button', `v1:community:op:${randomUUID()}`, 'private'); s.op.status = state === 'closed' ? 'succeeded' : state as StoredOperation['status'];
    s.store.getRoom.mockResolvedValue({ ...s.room, ownerRef: randomUUID(), visibility: 'hidden', status: state === 'closed' ? 'closed' : 'active' });
    vi.mocked(s.deps.discord.canView).mockResolvedValue(false); await handleCommunityInteraction(s.interaction, s.deps);
    expect(output(s)).toContain('不存在或已不可见'); expect(output(s)).not.toContain(roomRef); expect(output(s)).not.toMatch(/已排队|操作失败|操作已完成|需要管理员核对|房间已关闭/); onlySourceUpdate(s);
  });
  it('rechecks an administrator revoked during the bounded wait before rendering state', async () => {
    const s = setup('select', `v1:community:setvisibility:${roomRef}:2`, 'private'); s.input.values = ['locked'];
    vi.mocked(s.deps.service.actorFromDiscord).mockResolvedValueOnce({ memberRef, isAdmin: true, memberAvailable: true, linked: false, userId: null }).mockResolvedValue({ memberRef, isAdmin: false, memberAvailable: true, linked: false, userId: null });
    s.store.getOperation.mockResolvedValueOnce(s.op).mockResolvedValue({ ...s.op, status: 'succeeded' }); vi.mocked(s.deps.discord.canView).mockResolvedValue(false);
    await handleCommunityInteraction(s.interaction, s.deps); expect(s.wait).toHaveBeenCalledOnce(); expect(s.deps.service.actorFromDiscord).toHaveBeenCalledTimes(2);
    expect(output(s)).toContain('不存在或已不可见'); expect(output(s)).not.toContain('操作已完成'); expect(output(s)).not.toContain(roomRef); onlySourceUpdate(s);
  });
  it.each(['removed', 'changed'])('stops a stale operation when member identity is %s after polling', async change => {
    const s = setup('select', `v1:community:setvisibility:${roomRef}:2`, 'private'); s.input.values = ['locked'];
    vi.mocked(s.deps.service.actorFromDiscord).mockResolvedValueOnce({ memberRef, isAdmin: false, memberAvailable: true, linked: false, userId: null }).mockResolvedValue({ memberRef: change === 'changed' ? randomUUID() : memberRef, isAdmin: false, memberAvailable: change !== 'removed', linked: false, userId: null });
    s.op.status = 'succeeded'; await handleCommunityInteraction(s.interaction, s.deps); expect(output(s)).not.toContain('操作已完成'); expect(output(s)).not.toContain(roomRef); onlySourceUpdate(s);
  });
  it('keeps safe recovery navigation when a stale version is rejected before an operation exists', async () => {
    const s = setup('select', `v1:community:setvisibility:${roomRef}:2`, 'private'); s.input.values = ['locked'];
    vi.mocked(s.deps.service.enqueueForActor).mockRejectedValue(new CommunityStoreError(409, 'version_conflict', '房间已变化，请刷新后重试'));
    await handleCommunityInteraction(s.interaction, s.deps); expect(output(s)).toContain('请刷新后重试'); expect(output(s)).toContain('v1:community:room'); expect(output(s)).toContain('v1:community:roles'); onlySourceUpdate(s);
  });
  it('reads successful role defaults again and preserves the selected page', async () => {
    const s = setup('select', 'v1:community:roles:set:1', 'private'); const refs = Array.from({ length: 30 }, () => randomUUID());
    const roles = { choices: refs.map((ref, i) => ({ ref, name: `兴趣${i}`, kind: 'role' as const, available: true, safe: true })), selectedRefs: [refs[1], refs[26]], maxChoices: 5, enabled: true };
    vi.mocked(s.deps.membership.readRoles).mockResolvedValueOnce(roles).mockResolvedValue({ ...roles, selectedRefs: [refs[1], refs[27]] });
    s.input.values = [refs[27]]; s.op.kind = 'roles.set'; s.op.roomRef = null; s.op.status = 'succeeded'; await handleCommunityInteraction(s.interaction, s.deps);
    onlySourceUpdate(s); expect(output(s)).toContain('v1:community:roles:set:1');
    const out = s.input.editReply.mock.calls[0][0] as { components: { components: { options?: { value: string; default: boolean }[] }[] }[] };
    const options = out.components.flatMap(r => r.components).flatMap(c => c.options ?? []);
    expect(options.find(o => o.value === refs[27])?.default).toBe(true); expect(options.find(o => o.value === refs[26])?.default).toBe(false);
  });
  it('preserves the roles page in a pending status refresh', async () => {
    const s = setup('select', 'v1:community:roles:set:1', 'private'); s.op.kind = 'roles.set'; s.op.roomRef = null;
    await handleCommunityInteraction(s.interaction, s.deps); expect(output(s)).toContain(`v1:community:op:${s.op.ref}:roles:1`); onlySourceUpdate(s);
  });
  it('returns to the saved roles page after refreshing a completed operation', async () => {
    const s = setup('button', `v1:community:op:${randomUUID()}:roles:1`, 'private'); s.op.kind = 'roles.set'; s.op.roomRef = null; s.op.status = 'succeeded';
    vi.mocked(s.deps.membership.readRoles).mockResolvedValue({ choices: Array.from({ length: 30 }, () => ({ ref: randomUUID(), name: '兴趣', kind: 'role', available: true, safe: true })), selectedRefs: [], maxChoices: 5, enabled: true });
    await handleCommunityInteraction(s.interaction, s.deps); expect(output(s)).toContain('v1:community:roles:set:1'); onlySourceUpdate(s);
  });
  it('bounds a stalled operation database read and returns an unknown private receipt', async () => {
    vi.useFakeTimers();
    try {
      const s = setup('modal', `v1:community:panelsubmit:rename:${roomRef}`, 'shared'); s.store.getOperation.mockImplementation(() => new Promise(() => {}));
      const handling = handleCommunityInteraction(s.interaction, s.deps); await vi.advanceTimersByTimeAsync(1500); await handling;
      expect(s.store.getOperation).toHaveBeenCalledOnce(); expect(output(s)).toContain('状态暂不可用'); expect(output(s)).not.toContain('操作已完成');
      expect(s.input.followUp).toHaveBeenCalledOnce(); expect(s.input.editReply).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it('queues a selected member from a private user menu', async () => {
    const s = setup('user-select', `v1:community:settarget:grant:${roomRef}:2`, 'private'); s.input.values = ['selected-user']; await handleCommunityInteraction(s.interaction, s.deps);
    expect(s.deps.service.enqueueForActor).toHaveBeenCalledWith({ source: 'discord', memberRef }, 'room.grant', roomRef, { memberRef }, expect.any(String), 2); onlySourceUpdate(s);
  });
  it('does not retry an acknowledgement whose request failed', async () => {
    const s = setup('button', 'v1:community:room', 'private'); s.input.deferUpdate.mockRejectedValue(new Error('ack response lost'));
    await expect(handleCommunityInteraction(s.interaction, s.deps)).rejects.toThrow('ack response lost'); expect(s.input.reply).not.toHaveBeenCalled(); expect(s.input.followUp).not.toHaveBeenCalled(); expect(s.deps.service.actorFromDiscord).not.toHaveBeenCalled();
  });
  it('does not issue another acknowledgement after showModal fails', async () => {
    const s = setup('button', `v1:community:panel:rename:${roomRef}`, 'shared'); s.input.showModal.mockRejectedValue(new Error('modal response lost'));
    await expect(handleCommunityInteraction(s.interaction, s.deps)).rejects.toThrow('modal response lost'); expect(s.input.reply).not.toHaveBeenCalled(); expect(s.input.deferReply).not.toHaveBeenCalled(); expect(s.input.followUp).not.toHaveBeenCalled();
  });
});

describe('retired community fun entry points', () => {
  it('retains only the names needed for cached slash responses', () => { expect(RETIRED_COMMUNITY_COMMAND_NAMES).toEqual(['poll', 'teams', 'draw', 'roll', 'topic', 'room_ai']); });
  it.each(['poll', 'teams', 'draw', 'roll', 'topic', 'room_ai'])('retires cached /%s before business work', async name => {
    const s = setup('command', name); await handleCommunityInteraction(s.interaction, s.deps); expect(output(s)).toContain('下线'); expect(s.deps.service.actorFromDiscord).not.toHaveBeenCalled(); expect(s.deps.service.enqueueForActor).not.toHaveBeenCalled();
    expect(s.legacyFun.get).not.toHaveBeenCalled(); expect(s.legacyFun.list).not.toHaveBeenCalled();
  });
  const retired: [Parameters<typeof setup>[0], string][] = [['button', 'play'], ['button', 'tool:poll'], ['button', 'tool:draw'], ['button', 'tool:ai'], ['button', 'tool:roll'], ['button', 'tool:topic'], ['button', 'tool:teams'], ['button', `fun:${funRef}`], ['select', 'funselect'], ['button', `vote:${funRef}:0`], ['button', `close:${funRef}`], ['button', `redraw:${funRef}`], ['button', `aiapply:${funRef}:0`], ['user-select', 'teams:2'], ['modal', 'toolsubmit:poll'], ['modal', 'toolsubmit:draw'], ['modal', 'toolsubmit:ai']];
  it.each(retired)('retires private %s %s before modal, permission or fun reads', async (kind, id) => {
    const s = setup(kind, `v1:community:${id}`, 'private'); s.input.values = [funRef]; await handleCommunityInteraction(s.interaction, s.deps);
    expect(output(s)).toContain('下线'); expect(s.input.update).toHaveBeenCalledWith(expect.objectContaining({ components: [] }));
    expect(s.input.showModal).not.toHaveBeenCalled(); expect(s.deps.service.actorFromDiscord).not.toHaveBeenCalled(); expect(s.deps.service.enqueueForActor).not.toHaveBeenCalled();
    expect(s.legacyFun.get).not.toHaveBeenCalled(); expect(s.legacyFun.list).not.toHaveBeenCalled();
  });
  it('answers a retired shared button privately', async () => { const s = setup('button', 'v1:community:play', 'shared'); await handleCommunityInteraction(s.interaction, s.deps); expect(s.input.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral })); expect(s.input.update).not.toHaveBeenCalled(); expect(s.input.editReply).not.toHaveBeenCalled(); expect(s.input.deferUpdate).not.toHaveBeenCalled(); });
  it('answers a source-less retired modal privately', async () => { const s = setup('modal', 'v1:community:toolsubmit:ai', 'none'); await handleCommunityInteraction(s.interaction, s.deps); expect(output(s)).toContain('下线'); expect(s.input.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral })); expect(s.input.update).not.toHaveBeenCalled(); });
  it('does not reopen embedded fun results from old operation cards', async () => {
    const s = setup('button', `v1:community:op:${randomUUID()}`, 'private'); s.op.kind = 'fun.create'; s.op.status = 'succeeded'; s.op.result = { item: { ref: funRef, title: 'private AI suggestion' } };
    await handleCommunityInteraction(s.interaction, s.deps); expect(output(s)).toContain('下线'); expect(output(s)).not.toContain('private AI suggestion'); expect(s.store.getRoom).not.toHaveBeenCalled(); expect(s.legacyFun.get).not.toHaveBeenCalled(); onlySourceUpdate(s);
  });
  it('still validates ownership before retiring an operation', async () => { const s = setup('button', `v1:community:op:${randomUUID()}`, 'private'); s.op.kind = 'fun.create'; s.op.actor.memberRef = randomUUID(); await handleCommunityInteraction(s.interaction, s.deps); expect(output(s)).toContain('不存在'); expect(output(s)).not.toContain('下线'); });
});
