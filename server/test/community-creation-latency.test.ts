import { describe, expect, it } from 'vitest';
import { PermissionFlagsBits as P } from 'discord.js';
import { creationFixture, creationIds } from './community-creation-latency.fixture';

describe('automatic room creation critical path', () => {
  it.each([false, true].flatMap(administrator => [0, 100, 400].map(delayMs => ({ administrator, delayMs }))))(
    'finishes the actual move within six REST waves ($delayMs ms, admin: $administrator)', async ({ administrator, delayMs }) => {
    const fixture = creationFixture({ delayMs, administrator });
    await fixture.clock.run(fixture.enter);
    const result = fixture.summary();
    expect(result.outcome).toBe('succeeded');
    expect(result.creates).toBe(1); expect(result.moves).toBe(1);
    expect(fixture.voices.get(creationIds.owner)?.channelId).toBe(creationIds.created);
    expect(result.moveWaves).toBeLessThanOrEqual(6);
    expect(result.moveRequests).toBeLessThanOrEqual(20);
  });

  it('persists the creation intention before POST and the confirmed room before the move', async () => {
    const fixture = creationFixture();
    fixture.hooks.request = kind => {
      if (kind === 'create') expect(fixture.rooms[0]).toMatchObject({ status: 'creating', channelRef: null });
    };
    fixture.hooks.beforeMove = () => {
      expect(fixture.rooms[0]).toMatchObject({ status: 'active' });
      expect(fixture.resources.get(fixture.rooms[0].channelRef!)?.externalId).toBe(creationIds.created);
    };
    await fixture.clock.run(fixture.enter);
    expect(fixture.events).toEqual(['store.intention', 'discord.created', 'store.active', 'discord.moved', 'store.finished']);
  });

  it('coalesces overlapping entrance work into one creation and one move', async () => {
    const fixture = creationFixture();
    await fixture.clock.run(() => Promise.all([fixture.enter(), fixture.enter()]));
    expect(fixture.summary()).toMatchObject({ creates: 1, moves: 1, outcome: 'succeeded' });
    expect(fixture.rooms).toHaveLength(1); expect(fixture.operations).toHaveLength(1);
  });

  it('does not add unrelated room REST work to the entrance-to-move critical path', async () => {
    const empty = creationFixture(), populated = creationFixture();
    await populated.seedUnrelatedRooms(20);
    await empty.clock.run(empty.enter); await populated.clock.run(populated.enter);
    expect(populated.summary()).toMatchObject({ outcome: 'succeeded', creates: 1, moves: 1,
      moveRequests: empty.summary().moveRequests, moveWaves: empty.summary().moveWaves });
  });

  it('keeps the confirmed room but never pulls back a member who disconnects while creation is in flight', async () => {
    const fixture = creationFixture();
    fixture.hooks.afterCreate = () => fixture.voices.set(creationIds.owner, { id: creationIds.owner, channelId: null });
    await fixture.clock.run(fixture.enter);
    expect(fixture.rooms[0].status).toBe('active');
    expect(fixture.summary()).toMatchObject({ creates: 1, moves: 0, outcome: 'succeeded' });
    expect(fixture.voices.get(creationIds.owner)?.channelId).toBeNull();
  });

  it('cancels before POST when the member leaves during asynchronous creation permission reads', async () => {
    const fixture = creationFixture();
    fixture.hooks.response = kind => {
      if (kind === 'category') fixture.voices.set(creationIds.owner, { id: creationIds.owner, channelId: creationIds.waiting });
    };
    await fixture.clock.run(fixture.enter);
    expect(fixture.summary()).toMatchObject({ creates: 0, moves: 0 });
    expect(fixture.operations[0].status).not.toBe('succeeded');
    expect(fixture.voices.get(creationIds.owner)?.channelId).toBe(creationIds.waiting);
  });

  it('reads fresh move permissions after creating instead of reusing the creation context', async () => {
    const fixture = creationFixture();
    fixture.hooks.afterCreate = () => fixture.setBotPermissions(P.ViewChannel | P.Connect | P.ManageChannels | P.ManageRoles | P.ViewAuditLog);
    await fixture.clock.run(fixture.enter);
    expect(fixture.summary()).toMatchObject({ creates: 1, moves: 0, outcome: 'needs_review' });
    expect(fixture.voices.get(creationIds.owner)?.channelId).toBe(creationIds.creator);
  });

  it.each(['departed', 'bot', 'permission_revoked'] as const)('does not let a complete warm mapping authorize a write after %s', async change => {
    const fixture = creationFixture();
    expect(fixture.owner.metadata).toMatchObject({ bot: false, protected: false, roleIds: [], joinedAt: null });
    if (change === 'departed') fixture.setMemberAvailable(false);
    if (change === 'bot') fixture.setMemberBot(true);
    if (change === 'permission_revoked') fixture.setBotPermissions(P.ViewChannel | P.Connect);
    await fixture.clock.run(fixture.enter);
    expect(fixture.summary()).toMatchObject({ creates: 0, moves: 0 });
    expect(fixture.channels.has(creationIds.created)).toBe(false);
  });

  it('completes creation and moving while the independent panel queue is blocked', async () => {
    let release!: () => void, panelStarted = false, panelFinished = false;
    const panel = new Promise<void>(resolve => { release = resolve; });
    const fixture = creationFixture({ engineOptions: { syncPanels: async () => { panelStarted = true; await panel; panelFinished = true; } } });
    try {
      await fixture.clock.run(fixture.enter);
      expect(panelStarted).toBe(true); expect(panelFinished).toBe(false);
      expect(fixture.summary()).toMatchObject({ creates: 1, moves: 1, outcome: 'succeeded' });
    } finally { release(); await fixture.engine.stop(); }
  });

  it('does not issue a replacement POST when the first creation response is uncertain', async () => {
    const fixture = creationFixture();
    fixture.hooks.afterCreate = () => { throw { status: 503 }; };
    await fixture.clock.run(fixture.enter);
    await fixture.clock.run(fixture.enter);
    expect(fixture.summary()).toMatchObject({ creates: 1, moves: 0, outcome: 'needs_review' });
    expect(fixture.rooms).toHaveLength(1); expect(fixture.rooms[0].status).toBe('needs_review');
  });

  it('keeps benchmark output limited to aggregate timings and fixed request categories', async () => {
    const fixture = creationFixture(); await fixture.clock.run(fixture.enter);
    const output = JSON.stringify({ summary: fixture.summary(), trace: fixture.clock.trace });
    for (const value of Object.values(creationIds)) expect(output).not.toContain(value);
    expect(output).not.toContain('本地测试成员'); expect(output).not.toContain('本地测试频道');
    expect(output).not.toContain('permission_overwrites'); expect(output).not.toContain('channel_id');
  });
});
