import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VIOLATION_MAP } from '../../shared/scoring';
import type { AiConfig } from '../../worker/ai/config';
import { judgeCase } from '../../worker/ai/provider';
import type { JudgeRequest } from '../../worker/ai/prompt';

const CFG: AiConfig = {
  enabled: true,
  configuredEnabled: true,
  apiKeySource: 'environment',
  apiKeyError: null,
  baseUrl: 'https://api.example.com/v1',
  model: 'test-model',
  apiKey: 'sk-test',
  temperature: 0.2,
  prompt: 'system prompt',
  classifyPrompt: 'classify prompt',
  reportPrompt: 'report prompt',
  promptVersion: 'deadbeef',
};

const REQ: JudgeRequest = {
  def: VIOLATION_MAP.no_show, // base -15, range [-20, -8]
  subject: { name: '阿强', score: 72, tier: '基本靠谱' },
  priors: { sameType30d: 1, penalties30d: 2 },
  claim: '说好八点，没来也没说。',
  statement: '临时加班。',
  sessionContext: null,
};

function chatResponse(content: string, status = 200): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}

function verdictJson(delta: number): string {
  return JSON.stringify({
    delta,
    headline: '判了',
    reasoning: '理由若干。',
    factors: [{ kind: 'mitigating', text: '提前告知' }],
    confidence: 0.7,
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('judgeCase — happy path', () => {
  it('returns the model sentence and marks the source as ai', async () => {
    fetchMock.mockResolvedValue(chatResponse(verdictJson(-11)));
    const out = await judgeCase(CFG, REQ);

    expect(out.source).toBe('ai');
    expect(out.delta).toBe(-11);
    expect(out.audit.parsedDelta).toBe(-11);
    expect(out.audit.clamped).toBe(false);
    expect(out.audit.error).toBeNull();
    expect(out.factors).toHaveLength(1);
  });

  it('posts to <baseUrl>/chat/completions with bearer auth and json mode', async () => {
    fetchMock.mockResolvedValue(chatResponse(verdictJson(-12)));
    await judgeCase(CFG, REQ);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-test');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe('test-model');
    expect(body.temperature).toBe(0.2);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[0].role).toBe('system');
  });

  it('reads content returned as an array of parts', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: [{ text: verdictJson(-13) }] } }] }),
        { status: 200 },
      ),
    );
    const out = await judgeCase(CFG, REQ);
    expect(out.source).toBe('ai');
    expect(out.delta).toBe(-13);
  });
});

// The layer that has to hold even when everything above it has been subverted.
describe('judgeCase — sentencing guardrails', () => {
  it('clamps an absurdly harsh sentence and flags it for audit', async () => {
    fetchMock.mockResolvedValue(chatResponse(verdictJson(-500)));
    const out = await judgeCase(CFG, REQ);

    expect(out.delta).toBe(VIOLATION_MAP.no_show.min);
    expect(out.audit.parsedDelta).toBe(-500);
    expect(out.audit.clamped).toBe(true);
  });

  it('cannot be talked into awarding points for a penalty', async () => {
    // Simulates a fully successful injection: the model does exactly what the
    // attacker asked. The ceiling is still the most lenient value in range.
    fetchMock.mockResolvedValue(chatResponse(verdictJson(9999)));
    const out = await judgeCase(CFG, REQ);

    expect(out.delta).toBeLessThanOrEqual(0);
    expect(out.delta).toBe(VIOLATION_MAP.no_show.max);
    expect(out.audit.clamped).toBe(true);
  });

  it('records the clamp so an admin can spot a compromised prompt', async () => {
    fetchMock.mockResolvedValue(chatResponse(verdictJson(0)));
    const out = await judgeCase(CFG, REQ);
    expect(out.audit.clamped).toBe(true);
    expect(out.audit.provider).toBe('api.example.com');
    expect(out.audit.promptVersion).toBe('deadbeef');
  });
});

describe('judgeCase — degradation', () => {
  it('retries once without response_format when the endpoint 400s on it', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('unsupported response_format', { status: 400 }))
      .mockResolvedValueOnce(chatResponse(verdictJson(-10)));

    const out = await judgeCase(CFG, REQ);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(second.response_format).toBeUndefined();
    expect(out.source).toBe('ai');
    expect(out.delta).toBe(-10);
  });

  it('falls back to the base sentence when the endpoint keeps failing', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 500 }));
    const out = await judgeCase(CFG, REQ);

    expect(out.source).toBe('fallback');
    expect(out.delta).toBe(VIOLATION_MAP.no_show.base);
    expect(out.audit.error).toContain('500');
    // The label must never be mistaken for a real AI judgment.
    expect(out.headline).toContain('不可用');
  });

  it('falls back when the network throws', async () => {
    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED'));
    const out = await judgeCase(CFG, REQ);
    expect(out.source).toBe('fallback');
    expect(out.delta).toBe(VIOLATION_MAP.no_show.base);
  });

  it('falls back when the model returns unparseable output, keeping the raw text', async () => {
    fetchMock.mockResolvedValue(chatResponse('抱歉，我无法完成这个请求。'));
    const out = await judgeCase(CFG, REQ);

    expect(out.source).toBe('fallback');
    expect(out.delta).toBe(VIOLATION_MAP.no_show.base);
    expect(out.audit.rawResponse).toContain('抱歉');
  });

  it('falls back when the upstream body is not JSON at all', async () => {
    fetchMock.mockResolvedValue(new Response('<html>502 Bad Gateway</html>', { status: 200 }));
    const out = await judgeCase(CFG, REQ);
    expect(out.source).toBe('fallback');
  });

  it('never calls the network when AI is disabled', async () => {
    const out = await judgeCase({ ...CFG, enabled: false }, REQ);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out.source).toBe('fallback');
    expect(out.delta).toBe(VIOLATION_MAP.no_show.base);
  });

  it('never throws, whatever happens upstream', async () => {
    fetchMock.mockImplementation(() => {
      throw new TypeError('exploded');
    });
    await expect(judgeCase(CFG, REQ)).resolves.toMatchObject({ source: 'fallback' });
  });
});
