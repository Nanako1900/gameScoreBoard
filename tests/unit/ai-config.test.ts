import { describe, expect, it } from 'vitest';
import {
  AI_SETTING_KEYS,
  DEFAULT_TEMPERATURE,
  aiDisabledReason,
  normalizeBaseUrl,
  resolveAiConfig,
  shortHash,
} from '../../worker/ai/config';
import { sealAiApiKey } from '../../worker/ai/secrets';
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
  it('falls back to env when no setting row exists', async () => {
    const cfg = await resolveAiConfig(new Map(), FULL_ENV);
    expect(cfg.baseUrl).toBe('https://env.example.com/v1');
    expect(cfg.model).toBe('env-model');
    expect(cfg.prompt).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(cfg.temperature).toBe(DEFAULT_TEMPERATURE);
    expect(cfg.enabled).toBe(true);
  });

  it('lets a database setting override env — that is the point of the panel', async () => {
    const settings = new Map([
      [AI_SETTING_KEYS.baseUrl, 'https://db.example.com/v1'],
      [AI_SETTING_KEYS.model, 'db-model'],
      [AI_SETTING_KEYS.prompt, '自定义提示词'],
      [AI_SETTING_KEYS.temperature, '0.9'],
    ]);
    const cfg = await resolveAiConfig(settings, FULL_ENV);
    expect(cfg.baseUrl).toBe('https://db.example.com/v1');
    expect(cfg.model).toBe('db-model');
    expect(cfg.prompt).toBe('自定义提示词');
    expect(cfg.temperature).toBe(0.9);
  });

  it('ignores empty setting rows rather than blanking the config', async () => {
    const cfg = await resolveAiConfig(new Map([[AI_SETTING_KEYS.model, '']]), FULL_ENV);
    expect(cfg.model).toBe('env-model');
  });

  it('ignores legacy plaintext database keys', async () => {
    // A tampered/leaky settings row must not become a usable credential.
    const settings = new Map([['ai.api_key', 'sk-from-db']]);
    const cfg = await resolveAiConfig(settings, { ...FULL_ENV, AI_API_KEY: 'sk-env' });
    expect(cfg.apiKey).toBe('sk-env');
    expect(cfg.enabled).toBe(true);

    const noKey = await resolveAiConfig(settings, { AI_BASE_URL: 'https://a/v1', AI_MODEL: 'm' });
    expect(noKey.apiKey).toBe('');
    expect(noKey.enabled).toBe(false);
  });

  it('stays disabled unless base url, model and key are all present', async () => {
    expect((await resolveAiConfig(new Map(), {})).enabled).toBe(false);
    expect((await resolveAiConfig(new Map(), { AI_BASE_URL: 'https://a/v1' })).enabled).toBe(false);
    expect(
      (await resolveAiConfig(new Map(), { AI_BASE_URL: 'https://a/v1', AI_MODEL: 'm' })).enabled,
    ).toBe(false);
  });

  it('honours an explicit off switch even when fully configured', async () => {
    expect((await resolveAiConfig(new Map(), { ...FULL_ENV, AI_ENABLED: 'false' })).enabled).toBe(false);
    expect(
      (await resolveAiConfig(new Map([[AI_SETTING_KEYS.enabled, 'false']]), FULL_ENV)).enabled,
    ).toBe(false);
    expect((await resolveAiConfig(new Map(), { ...FULL_ENV, AI_ENABLED: '0' })).enabled).toBe(false);
  });

  it('bounds temperature and tolerates junk', async () => {
    expect((await resolveAiConfig(new Map(), { ...FULL_ENV, AI_TEMPERATURE: '99' })).temperature).toBe(2);
    expect((await resolveAiConfig(new Map(), { ...FULL_ENV, AI_TEMPERATURE: '-5' })).temperature).toBe(0);
    expect((await resolveAiConfig(new Map(), { ...FULL_ENV, AI_TEMPERATURE: 'hot' })).temperature).toBe(
      DEFAULT_TEMPERATURE,
    );
  });

  it('derives a prompt version that tracks prompt edits', async () => {
    const a = await resolveAiConfig(new Map(), FULL_ENV);
    const b = await resolveAiConfig(new Map([[AI_SETTING_KEYS.prompt, 'changed']]), FULL_ENV);
    expect(a.promptVersion).not.toBe(b.promptVersion);
  });
});

const MASTER = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';

describe('database credentials', () => {
  it('uses the database key before the legacy environment key', async () => {
    const envelope = await sealAiApiKey('sk-database', MASTER);
    const cfg = await resolveAiConfig(new Map([['ai.api_key_encrypted', envelope]]), { ...FULL_ENV, AI_CONFIG_MASTER_KEY: MASTER });
    expect(cfg).toMatchObject({ apiKey: 'sk-database', apiKeySource: 'database', apiKeyError: null, enabled: true, configuredEnabled: true });
    expect(aiDisabledReason(cfg)).toBeNull();
  });

  it('keeps environment compatibility without requiring a master key', async () => {
    expect(await resolveAiConfig(new Map(), { ...FULL_ENV, AI_CONFIG_MASTER_KEY: 'broken' })).toMatchObject({ apiKey: 'sk-env', apiKeySource: 'environment', apiKeyError: null, enabled: true, configuredEnabled: true });
  });

  it('does not resurrect an environment key after an explicit clear, even without a master key', async () => {
    expect(await resolveAiConfig(new Map([['ai.api_key_encrypted', '{"v":1,"state":"cleared"}']]), FULL_ENV)).toMatchObject({ apiKey: '', apiKeySource: 'none', apiKeyError: null, enabled: false, configuredEnabled: true });
  });

  it.each([
    [undefined, 'master_key_missing'],
    ['invalid-private-master', 'master_key_invalid'],
    ['//////////////////////////////////////////8=', 'decrypt_failed'],
  ])('disables rather than falling back when the database credential cannot open (%#)', async (master, error) => {
    const envelope = await sealAiApiKey('sk-database', MASTER);
    const cfg = await resolveAiConfig(new Map([['ai.api_key_encrypted', envelope]]), { ...FULL_ENV, AI_CONFIG_MASTER_KEY: master });
    expect(cfg).toMatchObject({ apiKey: '', apiKeySource: 'database', apiKeyError: error, enabled: false, configuredEnabled: true });
    expect(aiDisabledReason(cfg)).toBeTruthy();
    expect(aiDisabledReason(cfg)).not.toContain('invalid-private-master');
    expect(aiDisabledReason(cfg)).not.toContain(envelope);
  });

  it.each(['', 'not-json', '{"v":2,"state":"cleared"}', '{"v":1,"state":"cleared","extra":true}'])('never falls back for a malformed credential row (%#)', async (envelope) => {
    expect(await resolveAiConfig(new Map([['ai.api_key_encrypted', envelope]]), { ...FULL_ENV, AI_CONFIG_MASTER_KEY: MASTER })).toMatchObject({ apiKey: '', apiKeyError: 'decrypt_failed', enabled: false, configuredEnabled: true });
  });

  it('preserves an explicit off switch independently of credential availability', async () => {
    expect(await resolveAiConfig(new Map([['ai.enabled', 'false']]), FULL_ENV)).toMatchObject({ enabled: false, configuredEnabled: false, apiKey: 'sk-env' });
  });
});

describe('aiDisabledReason', () => {
  it('names the missing piece using only resolved configuration', async () => {
    expect(aiDisabledReason(await resolveAiConfig(new Map(), {}))).toMatch(/端点/);
    expect(aiDisabledReason(await resolveAiConfig(new Map(), { AI_BASE_URL: 'https://a/v1' }))).toMatch(/模型/);
    expect(aiDisabledReason(await resolveAiConfig(new Map(), { AI_BASE_URL: 'https://a/v1', AI_MODEL: 'm' }))).toMatch(/API Key/);
  });

  it('is null when everything is in place', async () => {
    expect(aiDisabledReason(await resolveAiConfig(new Map(), FULL_ENV))).toBeNull();
  });
});
