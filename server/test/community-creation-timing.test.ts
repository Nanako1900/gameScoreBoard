import { describe, expect, it, vi } from 'vitest';
import { creationDuration, reportCreationTiming } from '../src/community/creation-timing';

const timing = { trace: 'a03b8e5d0c12', outcome: 'succeeded', queue_ms: 25, create_ms: 401,
  move_ms: 402, to_created_ms: 426, to_moved_ms: 828, finalize_ms: 10, total_ms: 838 };

describe('safe room creation timings', () => {
  it('publishes only fixed fields and no identities, payloads or upstream errors', () => {
    const observer = vi.fn();
    reportCreationTiming(observer, { ...timing, discordUserId: '123456789012345678', channelId: '987654321098765432',
      roomName: 'private room', token: 'provider-secret', error: new Error('upstream body'), payload: { secret: 'hidden' } });
    expect(observer).toHaveBeenCalledWith({ event: 'community_room_creation', ...timing });
    const logged = JSON.stringify(observer.mock.calls);
    for (const secret of ['123456789012345678', '987654321098765432', 'private room', 'provider-secret', 'upstream body', 'hidden']) expect(logged).not.toContain(secret);
  });
  it('does not turn an invalid trace or outcome into arbitrary log text', () => {
    const observer = vi.fn(); reportCreationTiming(observer, { ...timing, trace: '123456789012345678', outcome: 'secret diagnostic' });
    expect(observer.mock.calls[0][0]).toMatchObject({ trace: 'unknown', outcome: 'failed' });
    expect(JSON.stringify(observer.mock.calls)).not.toContain('secret diagnostic');
  });
  it('keeps unknown timings unknown and normalizes numeric durations', () => {
    const observer = vi.fn(); reportCreationTiming(observer, { ...timing, queue_ms: null, create_ms: Infinity,
      move_ms: NaN, to_created_ms: -3, total_ms: 20.6 });
    expect(observer.mock.calls[0][0]).toMatchObject({ queue_ms: null, create_ms: null, move_ms: null, to_created_ms: null, total_ms: 21 });
  });
  it('measures nonnegative monotonic deltas without accepting invalid clocks', () => {
    expect(creationDuration(10.2, 20.7)).toBe(11); expect(creationDuration(20, 10)).toBeNull();
    expect(creationDuration(NaN, 10)).toBeNull(); expect(creationDuration(0, Infinity)).toBeNull();
  });
  it('does not make an observer failure fail the room operation', async () => {
    expect(() => reportCreationTiming(() => { throw new Error('logger unavailable'); }, timing)).not.toThrow();
    expect(() => reportCreationTiming(async () => { throw new Error('async logger unavailable'); }, timing)).not.toThrow();
    await Promise.resolve();
  });
  it('does not await a slow observer or require an observer', () => {
    const observer = vi.fn(() => new Promise<void>(() => {}));
    expect(reportCreationTiming(observer, timing)).toBeUndefined(); expect(observer).toHaveBeenCalledOnce();
    expect(() => reportCreationTiming(undefined, timing)).not.toThrow();
  });
});
