import { EventEmitter } from 'node:events';
import { Events, type Client, type Message } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { wireAgentMessages } from '../src/community/agent-gateway';

describe('independent Agent gateway messages', () => {
  it('does not hold voice events while the Agent is still answering', async () => {
    const events = new EventEmitter(), client = events as unknown as Client;
    let finish!: () => void;
    const model = new Promise<void>(resolve => { finish = resolve; });
    const handle = vi.fn(() => model), voice = vi.fn();
    const unwire = wireAgentMessages(client, { handle }); events.on(Events.VoiceStateUpdate, voice);
    try {
      events.emit(Events.MessageCreate, { id: 'question' } as Message);
      events.emit(Events.VoiceStateUpdate, {}, {});
      expect(voice).toHaveBeenCalledOnce(); await Promise.resolve(); expect(handle).toHaveBeenCalledOnce();
    } finally { finish(); unwire(); }
  });
  it('ignores new and already-scheduled admissions after unwiring or stopping', async () => {
    const events = new EventEmitter(), handle = vi.fn(async () => {});
    let stopping = false;
    const unwire = wireAgentMessages(events as unknown as Client, { handle }, () => stopping);
    events.emit(Events.MessageCreate, {}); unwire(); await Promise.resolve();
    events.emit(Events.MessageCreate, {}); expect(handle).not.toHaveBeenCalled();
    const second = wireAgentMessages(events as unknown as Client, { handle }, () => stopping);
    stopping = true; events.emit(Events.MessageCreate, {}); await Promise.resolve();
    expect(handle).not.toHaveBeenCalled(); second();
  });
  it('contains synchronous or asynchronous handler errors without exposing their contents', async () => {
    const events = new EventEmitter(), report = vi.fn();
    const handle = vi.fn(async () => { throw new Error('raw question or secret'); });
    const unwire = wireAgentMessages(events as unknown as Client, { handle }, undefined, report);
    events.emit(Events.MessageCreate, {});
    await vi.waitFor(() => expect(report).toHaveBeenCalledOnce());
    expect(report).toHaveBeenCalledWith(); unwire();
  });
});
