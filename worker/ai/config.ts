// Runtime AI configuration.
//
// Resolution order: app_settings row > env var > built-in default.
// The API KEY is the one exception — it is read ONLY from the Worker secret and
// is never written to, or read from, the database. Storing it in D1 would mean
// any SQL read path (or a future admin export) leaks it.

import { DEFAULT_SYSTEM_PROMPT } from './prompt';

export interface AiConfig {
  enabled: boolean;
  baseUrl: string;
  model: string;
  apiKey: string;
  temperature: number;
  prompt: string;
  /** Short hash of the prompt, recorded on every verdict to track drift. */
  promptVersion: string;
}

export const AI_SETTING_KEYS = {
  enabled: 'ai.enabled',
  baseUrl: 'ai.base_url',
  model: 'ai.model',
  temperature: 'ai.temperature',
  prompt: 'ai.prompt',
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
  await db
    .prepare(
      `INSERT INTO app_settings (key, value, updated_by, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    )
    .bind(key, value, updatedBy)
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
  AI_SYSTEM_PROMPT?: string;
  AI_TEMPERATURE?: string;
}

export function resolveAiConfig(settings: Map<string, string>, env: AiEnvSlice): AiConfig {
  const prompt = pick(
    settings,
    AI_SETTING_KEYS.prompt,
    env.AI_SYSTEM_PROMPT,
    DEFAULT_SYSTEM_PROMPT,
  );
  const baseUrl = normalizeBaseUrl(pick(settings, AI_SETTING_KEYS.baseUrl, env.AI_BASE_URL, ''));
  const model = pick(settings, AI_SETTING_KEYS.model, env.AI_MODEL, '');
  const apiKey = env.AI_API_KEY ?? '';
  const enabled =
    parseBool(pick(settings, AI_SETTING_KEYS.enabled, env.AI_ENABLED, 'true'), true) &&
    baseUrl.length > 0 &&
    model.length > 0 &&
    apiKey.length > 0;

  return {
    enabled,
    baseUrl,
    model,
    apiKey,
    temperature: parseTemperature(
      pick(settings, AI_SETTING_KEYS.temperature, env.AI_TEMPERATURE, String(DEFAULT_TEMPERATURE)),
    ),
    prompt,
    promptVersion: shortHash(prompt),
  };
}

export async function loadAiConfig(db: D1Database, env: AiEnvSlice): Promise<AiConfig> {
  const settings = await readSettings(db);
  return resolveAiConfig(settings, env);
}

/** Why AI judging is unavailable — surfaced in the admin panel, not to players. */
export function aiDisabledReason(cfg: AiConfig, env: AiEnvSlice): string | null {
  if (cfg.baseUrl.length === 0) return '未配置 AI_BASE_URL';
  if (cfg.model.length === 0) return '未配置 AI_MODEL';
  if ((env.AI_API_KEY ?? '').length === 0) {
    return '未配置 AI_API_KEY（需以 Worker 机密设置：wrangler secret put AI_API_KEY）';
  }
  if (!cfg.enabled) return 'AI 裁决已被手动关闭';
  return null;
}
