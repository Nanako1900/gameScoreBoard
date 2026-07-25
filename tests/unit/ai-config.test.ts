import { describe, expect, it } from 'vitest';
import {
  AI_SETTING_KEYS,
  DEFAULT_TEMPERATURE,
  aiDisabledReason,
  normalizeBaseUrl,
  resolveAiConfig,
  shortHash,
} from '../../worker/ai/config';
import { DEFAULT_SYSTEM_PROMPT } from '../../worker/ai/prompt';

const FULL_ENV = {
  AI_BASE_URL: 'https://env.example.com/v1',
  AI_MODEL: 'env-model',
  AI_API_KEY: 'sk-env',
};

describe('normalizeBaseUrl', () => {
  it('drops trailing slashes and surrounding whitespace', () => {
    expect(normalizeBaseUrl('  https://a.com/v1///  ')).toBe('https://a.com/v1');
    expect(normalizeBaseUrl('https://a.com/v1')).toBe('https://a.com/v1');
  });
});

describe('shortHash', () => {
  it('is stable and differs when the prompt changes', () => {
    expect(shortHash('abc')).toBe(shortHash('abc'));
    expect(shortHash('abc')).not.toBe(shortHash('abd'));
    expect(shortHash('')).toHaveLength(8);
  });
});

describe('resolveAiConfig', () => {
  it('falls back to env when no setting row exists', () => {
    const cfg = resolveAiConfig(new Map(), FULL_ENV);
    expect(cfg.baseUrl).toBe('https://env.example.com/v1');
    expect(cfg.model).toBe('env-model');
    expect(cfg.prompt).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(cfg.temperature).toBe(DEFAULT_TEMPERATURE);
    expect(cfg.enabled).toBe(true);
  });

  it('lets a database setting override env — that is the point of the panel', () => {
    const settings = new Map([
      [AI_SETTING_KEYS.baseUrl, 'https://db.example.com/v1'],
      [AI_SETTING_KEYS.model, 'db-model'],
      [AI_SETTING_KEYS.prompt, '自定义提示词'],
      [AI_SETTING_KEYS.temperature, '0.9'],
    ]);
    const cfg = resolveAiConfig(settings, FULL_ENV);
    expect(cfg.baseUrl).toBe('https://db.example.com/v1');
    expect(cfg.model).toBe('db-model');
    expect(cfg.prompt).toBe('自定义提示词');
    expect(cfg.temperature).toBe(0.9);
  });

  it('ignores empty setting rows rather than blanking the config', () => {
    const cfg = resolveAiConfig(new Map([[AI_SETTING_KEYS.model, '']]), FULL_ENV);
    expect(cfg.model).toBe('env-model');
  });

  it('reads the API key only from env — never from the database', () => {
    // A tampered/leaky settings row must not become a usable credential.
    const settings = new Map([['ai.api_key', 'sk-from-db']]);
    const cfg = resolveAiConfig(settings, { ...FULL_ENV, AI_API_KEY: 'sk-env' });
    expect(cfg.apiKey).toBe('sk-env');
    expect(cfg.enabled).toBe(true);

    const noKey = resolveAiConfig(settings, { AI_BASE_URL: 'https://a/v1', AI_MODEL: 'm' });
    expect(noKey.apiKey).toBe('');
    expect(noKey.enabled).toBe(false);
  });

  it('stays disabled unless base url, model and key are all present', () => {
    expect(resolveAiConfig(new Map(), {}).enabled).toBe(false);
    expect(resolveAiConfig(new Map(), { AI_BASE_URL: 'https://a/v1' }).enabled).toBe(false);
    expect(
      resolveAiConfig(new Map(), { AI_BASE_URL: 'https://a/v1', AI_MODEL: 'm' }).enabled,
    ).toBe(false);
  });

  it('honours an explicit off switch even when fully configured', () => {
    expect(resolveAiConfig(new Map(), { ...FULL_ENV, AI_ENABLED: 'false' }).enabled).toBe(false);
    expect(
      resolveAiConfig(new Map([[AI_SETTING_KEYS.enabled, 'false']]), FULL_ENV).enabled,
    ).toBe(false);
    expect(resolveAiConfig(new Map(), { ...FULL_ENV, AI_ENABLED: '0' }).enabled).toBe(false);
  });

  it('bounds temperature and tolerates junk', () => {
    expect(resolveAiConfig(new Map(), { ...FULL_ENV, AI_TEMPERATURE: '99' }).temperature).toBe(2);
    expect(resolveAiConfig(new Map(), { ...FULL_ENV, AI_TEMPERATURE: '-5' }).temperature).toBe(0);
    expect(resolveAiConfig(new Map(), { ...FULL_ENV, AI_TEMPERATURE: 'hot' }).temperature).toBe(
      DEFAULT_TEMPERATURE,
    );
  });

  it('derives a prompt version that tracks prompt edits', () => {
    const a = resolveAiConfig(new Map(), FULL_ENV);
    const b = resolveAiConfig(new Map([[AI_SETTING_KEYS.prompt, 'changed']]), FULL_ENV);
    expect(a.promptVersion).not.toBe(b.promptVersion);
  });
});

describe('aiDisabledReason', () => {
  it('names the missing piece', () => {
    expect(aiDisabledReason(resolveAiConfig(new Map(), {}), {})).toMatch(/AI_BASE_URL/);
    expect(
      aiDisabledReason(
        resolveAiConfig(new Map(), { AI_BASE_URL: 'https://a/v1' }),
        { AI_BASE_URL: 'https://a/v1' },
      ),
    ).toMatch(/AI_MODEL/);
    const noKeyEnv = { AI_BASE_URL: 'https://a/v1', AI_MODEL: 'm' };
    expect(aiDisabledReason(resolveAiConfig(new Map(), noKeyEnv), noKeyEnv)).toMatch(/AI_API_KEY/);
  });

  it('is null when everything is in place', () => {
    expect(aiDisabledReason(resolveAiConfig(new Map(), FULL_ENV), FULL_ENV)).toBeNull();
  });
});
