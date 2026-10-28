// Shared app/bot runtime configuration: database > environment > defaults.
// Credentials are encrypted in app_settings with an external shared master key.
// Only an absent credential row permits fallback to the legacy environment key;
// cleared or unreadable ciphertext never revives it. No process-local cache.

import { DEFAULT_SYSTEM_PROMPT } from './prompt';
import { DEFAULT_CLASSIFY_PROMPT } from './classify';
import { DEFAULT_REPORT_PROMPT } from './report';
import { AiSecretError, openAiApiKey } from './secrets';

export interface AiConfig {
  enabled: boolean;
  configuredEnabled: boolean;
  apiKeySource: 'database' | 'environment' | 'none';
  apiKeyError: 'master_key_missing' | 'master_key_invalid' | 'decrypt_failed' | null;
  baseUrl: string;
  model: string;
  apiKey: string;
  temperature: number;
  /** Sentencing prompt — decides how many points, inside a fixed range. */
  prompt: string;
  /** Classification prompt — decides WHICH range, from the judge's text alone. */
  classifyPrompt: string;
  /** Narrative prompt for the weekly report. Never used for arithmetic. */
  reportPrompt: string;
  /** Short hash of the prompts, recorded on every call to track drift. */
  promptVersion: string;
}

export const AI_SETTING_KEYS = {
  enabled: 'ai.enabled',
  apiKeyEncrypted: 'ai.api_key_encrypted',
  baseUrl: 'ai.base_url',
  model: 'ai.model',
  temperature: 'ai.temperature',
  prompt: 'ai.prompt',
  classifyPrompt: 'ai.classify_prompt',
  reportPrompt: 'ai.report_prompt',
} as const;

export const DEFAULT_TEMPERATURE = 0.2;

interface SettingRow {
  key: string;
  value: string;
}

export async function readSettings(db: D1Database): Promise<Map<string, string>> {
  const rows = await db.prepare('SELECT key, value FROM app_settings').all<SettingRow>();
  return new Map(rows.results.map((r) => [r.key, r.value]));
}

export async function writeSetting(
  db: D1Database,
  key: string,
  value: string,
  updatedBy: string,
): Promise<void> {
  // PostgreSQL text cannot hold U+0000. Dropping it here, on every engine,
  // keeps the stored prompt identical whether the board runs on D1 or PG.
  const stored = value.replace(/\u0000/g, '');
  await db
    .prepare(
      `INSERT INTO app_settings (key, value, updated_by, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    )
    .bind(key, stored, updatedBy)
    .run();
}

function pick(
  settings: Map<string, string>,
  key: string,
  envValue: string | undefined,
  fallback: string,
): string {
  const fromDb = settings.get(key);
  if (fromDb !== undefined && fromDb.length > 0) return fromDb;
  if (envValue !== undefined && envValue.length > 0) return envValue;
  return fallback;
}

function parseBool(raw: string, fallback: boolean): boolean {
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  return fallback;
}

function parseTemperature(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_TEMPERATURE;
  return Math.max(0, Math.min(2, n));
}

/** Normalize a base URL to `<origin><path>` with no trailing slash. */
export function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

/** FNV-1a 32-bit, hex — a stable, dependency-free version tag for the prompt. */
export function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export interface AiEnvSlice {
  AI_ENABLED?: string;
  AI_BASE_URL?: string;
  AI_MODEL?: string;
  AI_API_KEY?: string;
  AI_CONFIG_MASTER_KEY?: string;
  AI_SYSTEM_PROMPT?: string;
  AI_TEMPERATURE?: string;
}

async function resolveApiKey(
  settings: Map<string, string>, env: AiEnvSlice,
): Promise<Pick<AiConfig, 'apiKey' | 'apiKeySource' | 'apiKeyError'>> {
  const envelope = settings.get(AI_SETTING_KEYS.apiKeyEncrypted);
  if (envelope === undefined) {
    const apiKey = env.AI_API_KEY ?? '';
    return { apiKey, apiKeySource: apiKey ? 'environment' : 'none', apiKeyError: null };
  }
  try {
    const value: unknown = JSON.parse(envelope);
    if (value && typeof value === 'object' && !Array.isArray(value) &&
        Object.keys(value).length === 2 &&
        'v' in value && value.v === 1 && 'state' in value && value.state === 'cleared') {
      return { apiKey: '', apiKeySource: 'none', apiKeyError: null };
    }
  } catch {
    // The credential opener below turns malformed rows into a fixed state.
  }
  if (!env.AI_CONFIG_MASTER_KEY) {
    return { apiKey: '', apiKeySource: 'database', apiKeyError: 'master_key_missing' };
  }
  try {
    const apiKey = await openAiApiKey(envelope, env.AI_CONFIG_MASTER_KEY);
    return { apiKey, apiKeySource: 'database', apiKeyError: null };
  } catch (error) {
    return {
      apiKey: '', apiKeySource: 'database',
      apiKeyError: error instanceof AiSecretError ? error.code : 'decrypt_failed',
    };
  }
}

export async function resolveAiConfig(settings: Map<string, string>, env: AiEnvSlice): Promise<AiConfig> {
  const prompt = pick(
    settings,
    AI_SETTING_KEYS.prompt,
    env.AI_SYSTEM_PROMPT,
    DEFAULT_SYSTEM_PROMPT,
  );
  const classifyPrompt = pick(
    settings,
    AI_SETTING_KEYS.classifyPrompt,
    undefined,
    DEFAULT_CLASSIFY_PROMPT,
  );
  const reportPrompt = pick(
    settings,
    AI_SETTING_KEYS.reportPrompt,
    undefined,
    DEFAULT_REPORT_PROMPT,
  );
  const baseUrl = normalizeBaseUrl(pick(settings, AI_SETTING_KEYS.baseUrl, env.AI_BASE_URL, ''));
  const model = pick(settings, AI_SETTING_KEYS.model, env.AI_MODEL, '');
  const { apiKey, apiKeySource, apiKeyError } = await resolveApiKey(settings, env);
  const configuredEnabled = parseBool(pick(settings, AI_SETTING_KEYS.enabled, env.AI_ENABLED, 'true'), true);
  const enabled =
    configuredEnabled &&
    baseUrl.length > 0 &&
    model.length > 0 &&
    apiKey.length > 0;

  return {
    enabled,
    configuredEnabled,
    apiKeySource,
    apiKeyError,
    baseUrl,
    model,
    apiKey,
    temperature: parseTemperature(
      pick(settings, AI_SETTING_KEYS.temperature, env.AI_TEMPERATURE, String(DEFAULT_TEMPERATURE)),
    ),
    prompt,
    classifyPrompt,
    reportPrompt,
    // Hash all three together: a drift in any prompt should show up as a new
    // version on the calls that follow it.
    promptVersion: shortHash(`${prompt}\u0000${classifyPrompt}\u0000${reportPrompt}`),
  };
}

export async function loadAiConfig(db: D1Database, env: AiEnvSlice): Promise<AiConfig> {
  const settings = await readSettings(db);
  return resolveAiConfig(settings, env);
}

/** Why AI judging is unavailable — surfaced in the admin panel, not to players. */
export function aiDisabledReason(cfg: AiConfig): string | null {
  if (cfg.baseUrl.length === 0) return '未配置 AI 端点，请在管理页设置';
  if (cfg.model.length === 0) return '未配置 AI 模型，请在管理页设置';
  if (cfg.apiKeyError === 'master_key_missing') return '缺少 AI_CONFIG_MASTER_KEY，请在服务端配置主密钥后重新部署';
  if (cfg.apiKeyError === 'master_key_invalid') return 'AI_CONFIG_MASTER_KEY 格式无效，请配置 Base64 编码的 32 字节主密钥后重新部署';
  if (cfg.apiKeyError === 'decrypt_failed') return 'AI API Key 解密失败，请检查服务端主密钥或在管理页重新设置 API Key';
  if (cfg.apiKey.length === 0) return '未配置 AI API Key，请在管理页设置';
  if (!cfg.configuredEnabled) return 'AI 裁决已被手动关闭';
  return null;
}
