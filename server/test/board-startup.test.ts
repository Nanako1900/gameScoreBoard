import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { Client, Events } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { wireBoardRefresh } from '../src/discord/gateway';

function setup(schedule = vi.fn(async () => {}), stopping = () => false) {
  const emitter = new EventEmitter(); const failure = vi.fn();
  const dispose = wireBoardRefresh(emitter as unknown as Client, schedule, stopping, failure);
  return { emitter, schedule, failure, dispose };
}
describe('board startup refresh', () => {
  it('queues only once after ClientReady and leaves other ready listeners running immediately', async () => {
    const { emitter, schedule } = setup(); const dispatcherStart = vi.fn();
    emitter.on(Events.ClientReady, dispatcherStart);
    expect(schedule).not.toHaveBeenCalled();
    emitter.emit(Events.ClientReady); emitter.emit(Events.ClientReady);
    expect(dispatcherStart).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(schedule).toHaveBeenCalledOnce());
  });
  it('logs a rejected refresh without rejecting the ready event or blocking other services', async () => {
    const error = new Error('local database fixture unavailable');
    const { emitter, failure } = setup(vi.fn(async () => { throw error; }));
    const next = vi.fn(); emitter.on(Events.ClientReady, next);
    expect(() => emitter.emit(Events.ClientReady)).not.toThrow(); expect(next).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(failure).toHaveBeenCalledExactlyOnceWith(error));
  });
  it('also catches a synchronous scheduler failure', async () => {
    const error = new Error('local scheduler fixture');
    const { emitter, failure } = setup(vi.fn(() => { throw error; }));
    expect(() => emitter.emit(Events.ClientReady)).not.toThrow();
    await vi.waitFor(() => expect(failure).toHaveBeenCalledExactlyOnceWith(error));
  });
  it('does not admit a refresh while stopping or after disposal', async () => {
    const stopped = setup(undefined, () => true); stopped.emitter.emit(Events.ClientReady);
    const disposed = setup(); disposed.dispose(); disposed.emitter.emit(Events.ClientReady);
    await Promise.resolve(); expect(stopped.schedule).not.toHaveBeenCalled(); expect(disposed.schedule).not.toHaveBeenCalled();
  });
  it('lists the optional board variable in the compose bot environment', () => {
    const compose = readFileSync(new URL('../../compose.yaml', import.meta.url), 'utf8');
    const bot = compose.split('  bot:')[1] ?? '';
    expect(bot).toContain('DISCORD_BOARD_CHANNEL_ID: ${DISCORD_BOARD_CHANNEL_ID:-}');
  });
});
