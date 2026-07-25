// OpenAI-compatible chat-completions client for AI sentencing.
//
// Deliberately dependency-free (`fetch` only): keeps the Worker bundle small and
// works against ANY compatible endpoint — OpenAI, DeepSeek, 硅基流动, OpenRouter,
// vLLM, Ollama, a self-hosted gateway. We also avoid `tools` / `json_schema`
// because compatible endpoints support them inconsistently; `response_format:
// json_object` plus a schema spelled out in the prompt plus strict server-side
// validation covers far more providers.

import { AI_TIMEOUT_MS, clampVerdictDelta, isClamped } from '../../shared/scoring';
import type { AiConfig } from './config';
import {
  type JudgeRequest,
  type ParsedVerdict,
  buildUserMessage,
  parseVerdict,
} from './prompt';

export interface JudgeOutcome {
  delta: number;
  headline: string;
  reasoning: string;
  factors: { kind: 'mitigating' | 'aggravating'; text: string }[];
  source: 'ai' | 'fallback';
  audit: {
    provider: string;
    model: string;
    promptVersion: string;
    rawResponse: string | null;
    parsedDelta: number | null;
    appliedDelta: number;
    clamped: boolean;
    confidence: number | null;
    latencyMs: number;
    error: string | null;
  };
}

const RAW_RESPONSE_MAX = 4000;
const MAX_TOKENS = 700;

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return 'invalid';
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

/** The sentence handed down when the AI cannot be consulted or cannot be trusted. */
export function fallbackOutcome(
  req: JudgeRequest,
  cfg: Pick<AiConfig, 'baseUrl' | 'model' | 'promptVersion'>,
  error: string,
  latencyMs = 0,
  rawResponse: string | null = null,
): JudgeOutcome {
  return {
    delta: req.def.base,
    headline: 'AI 裁判暂时不可用',
    reasoning: '本次按基准分量刑。如有异议请点申诉，管理员会人工复核。',
    factors: [],
    source: 'fallback',
    audit: {
      provider: hostOf(cfg.baseUrl),
      model: cfg.model || '(none)',
      promptVersion: cfg.promptVersion,
      rawResponse,
      parsedDelta: null,
      appliedDelta: req.def.base,
      clamped: false,
      confidence: null,
      latencyMs,
      error,
    },
  };
}

interface ChatChoice {
  message?: { content?: unknown };
}
interface ChatResponse {
  choices?: ChatChoice[];
}

function readContent(body: unknown): string {
  if (typeof body !== 'object' || body === null) return '';
  const choices = (body as ChatResponse).choices;
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const content = choices[0]?.message?.content;
  if (typeof content === 'string') return content;
  // Some gateways return the content as an array of parts.
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p === 'object' && p !== null ? String((p as { text?: unknown }).text ?? '') : ''))
      .join('');
  }
  return '';
}

interface CallResult {
  text: string;
  latencyMs: number;
}

async function callOnce(
  cfg: AiConfig,
  userMessage: string,
  useJsonMode: boolean,
): Promise<CallResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  const started = Date.now();
  try {
    const payload: Record<string, unknown> = {
      model: cfg.model,
      temperature: cfg.temperature,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: 'system', content: cfg.prompt },
        { role: 'user', content: userMessage },
      ],
    };
    if (useJsonMode) payload.response_format = { type: 'json_object' };

    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const latencyMs = Date.now() - started;
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
      err.name = res.status === 400 ? 'BadRequestError' : 'UpstreamError';
      throw err;
    }
    let body: unknown;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      throw new Error('上游返回的不是 JSON');
    }
    const content = readContent(body);
    if (content.length === 0) throw new Error('上游返回了空内容');
    return { text: content, latencyMs };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask the configured model to sentence one case.
 *
 * Never throws: every failure path resolves to a `fallback` outcome carrying the
 * base sentence, so a case can always reach `decided`. Leaving cases stuck in
 * `judging` would strand players' scores indefinitely.
 */
export async function judgeCase(cfg: AiConfig, req: JudgeRequest): Promise<JudgeOutcome> {
  if (!cfg.enabled) {
    return fallbackOutcome(req, cfg, 'AI 未启用或未完成配置');
  }

  const userMessage = buildUserMessage(req);
  let result: CallResult;
  try {
    result = await callOnce(cfg, userMessage, true);
  } catch (err) {
    // A 400 commonly means the endpoint rejects `response_format`. Retry once
    // without it before giving up — this is what makes "any compatible endpoint"
    // actually true in practice.
    if (err instanceof Error && err.name === 'BadRequestError') {
      try {
        result = await callOnce(cfg, userMessage, false);
      } catch (retryErr) {
        return fallbackOutcome(req, cfg, errorMessage(retryErr));
      }
    } else {
      return fallbackOutcome(req, cfg, errorMessage(err));
    }
  }

  let parsed: ParsedVerdict;
  try {
    parsed = parseVerdict(result.text);
  } catch (err) {
    return fallbackOutcome(
      req,
      cfg,
      errorMessage(err),
      result.latencyMs,
      result.text.slice(0, RAW_RESPONSE_MAX),
    );
  }

  // The decisive guard. Whatever the model said — including a fully successful
  // prompt injection — the delta lands inside this violation's sentencing range.
  const applied = clampVerdictDelta(req.def, parsed.delta);
  const clamped = isClamped(req.def, parsed.delta);

  return {
    delta: applied,
    headline: parsed.headline,
    reasoning: parsed.reasoning,
    factors: parsed.factors,
    source: 'ai',
    audit: {
      provider: hostOf(cfg.baseUrl),
      model: cfg.model,
      promptVersion: cfg.promptVersion,
      rawResponse: result.text.slice(0, RAW_RESPONSE_MAX),
      parsedDelta: Math.round(parsed.delta),
      appliedDelta: applied,
      clamped,
      confidence: parsed.confidence,
      latencyMs: result.latencyMs,
      error: null,
    },
  };
}
