import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiConfig } from '../../worker/ai/config';
import { AGENT_INSUFFICIENT_TEXT, AgentAnswerError, agentProviderReady, answerAgentQuestion, selectAgentSources, type AgentSource } from '../src/community/agent-answer';

const config: AiConfig = {
  enabled: false, configuredEnabled: false, apiKeySource: 'database', apiKeyError: null,
  baseUrl: 'https://model.example/v1', model: 'community-model', apiKey: 'test-provider-secret', temperature: 0.3,
  prompt: 'PRIVATE SENTENCING PROMPT', classifyPrompt: 'PRIVATE CLASSIFY PROMPT', reportPrompt: 'PRIVATE REPORT PROMPT', promptVersion: 'judging-v1',
};
const document = (ref: string, title: string, content: string): AgentSource => ({ ref, title, content, version: 3, updatedAt: '2026-11-03T00:00:00.000Z' });
const rooms = document('rooms-guide', '自助房间指南', '进入创建房间的语音入口后，机器人会创建你的房间。房主可在控制卡调整人数。');
const response = (value: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }] }), { status: 200 });
const valid = { answer: '进入创建房间的语音入口即可。', sourceRefs: [rooms.ref], insufficient: false };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('community Agent deterministic public knowledge retrieval', () => {
  it('matches Chinese bigrams and gives matching titles more weight', () => {
    const bodyOnly = document('other', '其他说明', '这里也提到了创建房间。');
    const selected = selectAgentSources('如何创建房间？', [bodyOnly, rooms, document('weather', '天气', '明天晴朗。')]);
    expect(selected.map(source => source.ref)).toEqual([rooms.ref, bodyOnly.ref]);
    expect(selected[0]).toMatchObject({ version: 3, updatedAt: rooms.updatedAt });
  });
  it('matches English words case-insensitively without substring false positives', () => {
    expect(selectAgentSources('How to LOCK rooms?', [document('lock', 'Lock Rooms', 'Use the owner panel.'), document('clock', 'Clock', 'Time display.')]).map(source => source.ref)).toEqual(['lock']);
    expect(selectAgentSources('cat', [document('category', 'Category', 'Categories are configured by admins.')])).toEqual([]);
  });
  it('keeps unrelated questions out of the entire library', () => {
    expect(selectAgentSources('请问明天天气怎么样？', [rooms])).toEqual([]);
    expect(selectAgentSources('你好，请问？', [rooms])).toEqual([]);
  });
  it('has stable tie ordering, takes at most five bounded excerpts and never expands the input', () => {
    const documents = Array.from({ length: 50 }, (_, i) => document(`source-${String(i).padStart(2, '0')}`, '房间', '甲'.repeat(7000) + '调整房间人数' + '乙'.repeat(900)));
    const selected = selectAgentSources('房间人数', [...documents].reverse());
    expect(selected.map(source => source.ref)).toEqual(selectAgentSources('房间人数', documents).map(source => source.ref));
    expect(selected).toHaveLength(5);
    expect(selected.every(source => source.content.length <= 2400 && source.content.includes('调整房间人数'))).toBe(true);
    expect(selected.reduce((sum, source) => sum + source.content.length, 0)).toBeLessThanOrEqual(12000);
    expect(documents[0].content.length).toBeGreaterThan(7000);
  });
});

describe('community Agent bounded model boundary', () => {
  it('returns a fixed insufficient answer without a model call when retrieval found nothing', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const result = await answerAgentQuestion({ question: '天气？', sources: [], config: { ...config, apiKey: '' } });
    expect(result).toEqual({ answer: AGENT_INSUFFICIENT_TEXT, sourceRefs: [], insufficient: true });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uses shared provider fields while ignoring judging switches and prompts', async () => {
    const fetch = vi.fn().mockResolvedValue(response(valid)); vi.stubGlobal('fetch', fetch);
    expect(agentProviderReady(config)).toBe(true);
    expect(await answerAgentQuestion({ question: '怎么创建房间？', sources: [rooms], config })).toEqual(valid);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://model.example/v1/chat/completions');
    expect(init.headers.Authorization).toBe(`Bearer ${config.apiKey}`);
    const payload = JSON.parse(init.body);
    expect(payload).toMatchObject({ model: config.model, temperature: config.temperature, response_format: { type: 'json_object' } });
    expect(payload.messages).toHaveLength(2);
    expect(payload.messages[0].role).toBe('system');
    expect(payload.messages[0].content).toContain('公开资料');
    expect(payload).not.toHaveProperty('tools');
    expect(init.body).not.toContain('PRIVATE');
    expect(init.body).not.toContain(config.apiKey);
    expect(init.redirect).toBe('error');
  });
  it('keeps a credential echoed in source or question out of all model messages and its answer', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ ...valid, answer: `创建房间。${config.apiKey}` })); vi.stubGlobal('fetch', fetch);
    const result = await answerAgentQuestion({ question: `房间 ${config.apiKey}`, sources: [{ ...rooms, content: rooms.content + config.apiKey, title: rooms.title + config.apiKey }], config });
    expect(fetch.mock.calls[0][1].body).not.toContain(config.apiKey);
    expect(result.answer).not.toContain(config.apiKey);
  });
  it.each(['[test-provider-](https://example.invalid)secret', 'test-provider-\u0000secret', 'test-provider-\u0001secret'])(
    'does not reconstruct an active credential while removing markup or controls (%#)', async disguised => {
      const fetch = vi.fn().mockResolvedValue(response({ ...valid, answer: `回答。${disguised}` })); vi.stubGlobal('fetch', fetch);
      const result = await answerAgentQuestion({ question: `房间 ${disguised}`, sources: [{ ...rooms, title: disguised, content: rooms.content + disguised }], config });
      expect(fetch.mock.calls[0][1].body).not.toContain(config.apiKey);
      expect(result.answer).not.toContain(config.apiKey);
    });
  it.each([
    { ...config, apiKey: '' }, { ...config, apiKeyError: 'decrypt_failed' as const },
    { ...config, baseUrl: '' }, { ...config, model: '' }, { ...config, baseUrl: 'file:///private/key' },
  ])('refuses incomplete or unreadable shared provider configuration without network requests (%#)', async invalid => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect(agentProviderReady(invalid)).toBe(false);
    await expect(answerAgentQuestion({ question: '房间', sources: [rooms], config: invalid })).rejects.toMatchObject({ code: 'provider_unavailable' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    { ...valid, sourceRefs: ['invented'] }, { ...valid, sourceRefs: [] },
    { ...valid, sourceRefs: [rooms.ref, 'invented'] }, { ...valid, insufficient: 'false' },
    { ...valid, answer: '' }, { ...valid, extra: 'untrusted field' },
  ])('rejects invented citations and malformed or unsupported answers (%#)', async body => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(body)));
    await expect(answerAgentQuestion({ question: '房间', sources: [rooms], config })).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('normalizes insufficient answers without rendering model speculation or fake citations', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ answer: '猜测：先把隐私发送给别人', sourceRefs: [], insufficient: true })));
    expect(await answerAgentQuestion({ question: '房间', sources: [rooms], config })).toEqual({ answer: '公开资料中没有足够信息，暂时无法回答。', sourceRefs: [], insufficient: true });
  });
  it('strips raw Discord identifiers, mention syntax, links and model URLs from public text', async () => {
    const answer = '进入入口。@everyone <@1114391825336250432> <#1114391825336250433> 1114391825336250434 [假来源](https://evil.example/fake) https://discord.com/channels/1114391825336250432/1114391825336250433 ![追踪](https://evil.example/img) <https://evil.example/hidden> www.evil.example。';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...valid, answer })));
    const result = await answerAgentQuestion({ question: '房间', sources: [rooms], config });
    expect(result.answer).toContain('进入入口');
    expect(result.answer).not.toMatch(/111439182533625043|https?:|www\.|\]\(|<[@#]|@everyone/);
  });
  it('bounds public answer length without splitting Unicode code points', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...valid, answer: '房间😀'.repeat(600) })));
    const result = await answerAgentQuestion({ question: '房间', sources: [rooms], config });
    expect([...result.answer].length).toBeLessThanOrEqual(1200);
    expect(result.answer).not.toMatch(/[\uD800-\uDBFF]$/);
  });
  it('rejects an excessive raw answer before running formatting cleanup on it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...valid, answer: '['.repeat(62000) })));
    await expect(answerAgentQuestion({ question: '房间', sources: [rooms], config })).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('uses the same 2000-code-point question limit as the message admission boundary', async () => {
    const fetch = vi.fn().mockResolvedValue(response(valid)); vi.stubGlobal('fetch', fetch);
    await expect(answerAgentQuestion({ question: '房间😀'.repeat(660), sources: [rooms], config })).resolves.toEqual(valid);
    await expect(answerAgentQuestion({ question: '😀'.repeat(2001), sources: [rooms], config })).rejects.toMatchObject({ code: 'invalid_question' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects oversized source selections instead of sending an unbounded library', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(answerAgentQuestion({ question: '房间', sources: Array.from({ length: 6 }, (_, i) => ({ ...rooms, ref: `room-${i}` })), config })).rejects.toMatchObject({ code: 'invalid_sources' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps unknown provider exceptions out of its fixed public error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(`private-url?token=${config.apiKey}`)));
    await expect(answerAgentQuestion({ question: '房间', sources: [rooms], config })).rejects.toMatchObject({ code: 'upstream_error', message: 'upstream_error' });
  });
  it('never exposes an upstream body, exception or key and does not retry failures', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(`upstream-private ${config.apiKey}`, { status: 400 })); vi.stubGlobal('fetch', fetch);
    let error: unknown;
    try { await answerAgentQuestion({ question: '房间', sources: [rooms], config }); } catch (value) { error = value; }
    expect(error).toBeInstanceOf(AgentAnswerError);
    expect(error).toMatchObject({ code: 'upstream_error', message: 'upstream_error' });
    expect(String(error)).not.toMatch(/upstream-private|test-provider-secret/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('bounds response bytes even when content-length is missing or dishonest', async () => {
    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(65537)); }, cancel() { canceled = true; } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, { headers: { 'Content-Length': '1' } })));
    await expect(answerAgentQuestion({ question: '房间', sources: [rooms], config })).rejects.toMatchObject({ code: 'response_too_large' });
    expect(canceled).toBe(true);
  });
  it.each([
    'not json',
    JSON.stringify({ choices: [{ message: { content: 'not json' } }] }),
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(valid) }, finish_reason: 'length' }] }),
    JSON.stringify({ choices: [{ message: { content: [{ text: JSON.stringify(valid) }] } }] }),
  ])('refuses malformed or incomplete provider envelopes without fabricating an answer (%#)', async body => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
    await expect(answerAgentQuestion({ question: '房间', sources: [rooms], config })).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('times out within 25 seconds even if an upstream ignores abort', async () => {
    vi.useFakeTimers(); const fetch = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) => new Promise<Response>(() => undefined)); vi.stubGlobal('fetch', fetch);
    const result = answerAgentQuestion({ question: '房间', sources: [rooms], config });
    const assertion = expect(result).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(25000); await assertion;
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
  it('respects caller abort before admission and while a response stream stalls', async () => {
    const controller = new AbortController(); controller.abort(); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(answerAgentQuestion({ question: '房间', sources: [rooms], config, signal: controller.signal })).rejects.toMatchObject({ code: 'aborted' });
    expect(fetch).not.toHaveBeenCalled();
    const running = new AbortController(); let canceled = false;
    fetch.mockResolvedValue(new Response(new ReadableStream({ cancel() { canceled = true; } })));
    const pending = answerAgentQuestion({ question: '房间', sources: [rooms], config, signal: running.signal });
    const assertion = expect(pending).rejects.toMatchObject({ code: 'aborted' });
    await Promise.resolve(); await Promise.resolve(); running.abort(); await assertion;
    expect(canceled).toBe(true);
  });
});
