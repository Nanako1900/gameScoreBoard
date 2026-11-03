import { describe, expect, it, vi } from 'vitest';
import { PermissionFlagsBits as P } from 'discord.js';
import type { CreationTiming } from '../src/community/creation-timing';
import { creationFixture, creationIds } from './community-creation-latency.fixture';

function observedFixture(observer = vi.fn<(record: CreationTiming) => void>()) {
  let fixture!: ReturnType<typeof creationFixture>;
  const engineOptions = { intervalMs: 5000, onCreationTiming: observer, timingNow: () => fixture.clock.now };
  fixture = creationFixture({ engineOptions });
  return { fixture, observer };
}

describe('actual room creation observation', () => {
  it('reports one safe summary with separate create, move and finalization durations', async () => {
    const { fixture, observer } = observedFixture();
    await fixture.clock.run(fixture.enter);
    expect(observer).toHaveBeenCalledOnce();
    const report = observer.mock.calls[0][0];
    expect(report).toMatchObject({ event: 'community_room_creation', outcome: 'succeeded', queue_ms: 0 });
    expect(report.to_created_ms).toBe(fixture.summary().createMs);
    expect(report.to_moved_ms).toBe(fixture.summary().moveMs);
    expect(report.total_ms).toBe(fixture.summary().totalMs);
    expect(report.create_ms).toBeGreaterThan(0); expect(report.move_ms).toBeGreaterThan(0);
    const output = JSON.stringify(report);
    for (const id of Object.values(creationIds)) expect(output).not.toContain(id);
    expect(output).not.toContain('本地测试成员'); expect(output).not.toContain('本地测试频道');
  });
  it('includes waiting behind another serial operation instead of hiding the queue delay', async () => {
    const { fixture, observer } = observedFixture();
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const claimed = new Promise<void>(resolve => { entered = resolve; });
    const original = fixture.store.claim.bind(fixture.store);
    vi.spyOn(fixture.store, 'claim').mockImplementationOnce(async (...args) => { entered(); await held; return original(...args); });
    const background = fixture.engine.runOne(); await claimed;
    const entrance = fixture.enter(); fixture.clock.now += 250; release();
    await fixture.clock.run(async () => { await background; await entrance; });
    expect(observer).toHaveBeenCalledOnce();
    expect(observer.mock.calls[0][0].queue_ms).toBe(250);
    expect(observer.mock.calls[0][0].to_moved_ms).toBe(fixture.summary().moveMs);
  });
  it('reports an uncertain move without falsely reporting a completed move', async () => {
    const { fixture, observer } = observedFixture();
    fixture.hooks.afterCreate = () => fixture.setBotPermissions(P.ViewChannel | P.Connect | P.ManageChannels | P.ManageRoles | P.ViewAuditLog);
    await fixture.clock.run(fixture.enter);
    expect(observer).toHaveBeenCalledOnce();
    expect(observer.mock.calls[0][0]).toMatchObject({ outcome: 'needs_review', to_moved_ms: null });
    expect(observer.mock.calls[0][0].to_created_ms).not.toBeNull();
  });
  it('does not make diagnostic failures change the completed room operation', async () => {
    const { fixture, observer } = observedFixture(vi.fn(() => { throw new Error('diagnostics failed'); }));
    await fixture.clock.run(fixture.enter);
    expect(fixture.summary()).toMatchObject({ outcome: 'succeeded', creates: 1, moves: 1 });
    expect(observer).toHaveBeenCalledOnce();
  });
  it('does not await an observer promise that never settles', async () => {
    const observer = vi.fn<(record: CreationTiming) => void>(() => new Promise<void>(() => {}));
    const { fixture } = observedFixture(observer);
    await fixture.clock.run(fixture.enter);
    expect(fixture.summary()).toMatchObject({ outcome: 'succeeded', creates: 1, moves: 1 });
    expect(observer).toHaveBeenCalledOnce();
  });
  it('keeps entrance timings unknown when a durable job has no process-local entry timestamp', async () => {
    const { fixture, observer } = observedFixture();
    await fixture.store.enqueue('room.create', null, { source: 'discord', memberRef: fixture.owner.ref }, { creatorOnly: true }, 'queued-before-observation');
    await fixture.clock.run(() => fixture.engine.runOne());
    expect(fixture.summary()).toMatchObject({ outcome: 'succeeded', creates: 1, moves: 1 });
    expect(observer.mock.calls[0][0]).toMatchObject({ queue_ms: null, to_created_ms: null, to_moved_ms: null });
    expect(observer.mock.calls[0][0].total_ms).toBeGreaterThan(0);
  });
});
