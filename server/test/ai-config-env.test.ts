import { describe, expect, it } from 'vitest';
import { buildEnv } from '../src/api';
import { resolveAiConfig } from '../../worker/ai/config';
import { sealAiApiKey } from '../../worker/ai/secrets';

const MASTER = Buffer.alloc(32, 19).toString('base64');
const PROCESS_ENV = {
  OAUTH_BASE_URL: 'https://idp.example',
  OAUTH_CLIENT_ID: 'test-client',
  OAUTH_CLIENT_SECRET: 'test-oauth-secret',
  SESSION_SECRET: 'test-session-secret',
  APP_URL: 'https://api.example',
  AI_BASE_URL: 'https://legacy-provider.example/v1',
  AI_MODEL: 'legacy-model',
  AI_API_KEY: 'sk-legacy-test-only',
};

// resolveAiConfig consumes settings already read from the database. This suite
// tests the Node environment boundary; real DB reads live in tests/pg/ai-config.
const UNUSED_DB = {} as D1Database;

async function savedSettings() {
  return new Map([
    ['ai.enabled', 'true'],
    ['ai.base_url', 'https://saved-provider.example/v1'],
    ['ai.model', 'saved-model'],
    ['ai.api_key_encrypted', await sealAiApiKey('sk-saved-test-only', MASTER)],
  ]);
}

describe('Node AI configuration consumers', () => {
  it('decrypts the saved credential with the master key supplied to buildEnv', async () => {
    const env = buildEnv({ ...PROCESS_ENV, AI_CONFIG_MASTER_KEY: MASTER }, UNUSED_DB);
    const cfg = await resolveAiConfig(await savedSettings(), env);
    expect(cfg).toMatchObject({
      enabled: true,
      configuredEnabled: true,
      apiKey: 'sk-saved-test-only',
      apiKeySource: 'database',
      apiKeyError: null,
      baseUrl: 'https://saved-provider.example/v1',
      model: 'saved-model',
    });
  });

  it.each([
    ['missing', undefined, 'master_key_missing'],
    ['mismatched', Buffer.alloc(32, 23).toString('base64'), 'decrypt_failed'],
  ])('disables encrypted credentials with a %s master instead of reviving the legacy key', async (_label, master, error) => {
    const env = buildEnv({ ...PROCESS_ENV, AI_CONFIG_MASTER_KEY: master }, UNUSED_DB);
    const cfg = await resolveAiConfig(await savedSettings(), env);
    expect(cfg).toMatchObject({
      enabled: false,
      configuredEnabled: true,
      apiKey: '',
      apiKeySource: 'database',
      apiKeyError: error,
    });
  });

  it('keeps pre-migration environment credentials usable without a master key', async () => {
    const cfg = await resolveAiConfig(new Map(), buildEnv(PROCESS_ENV, UNUSED_DB));
    expect(cfg).toMatchObject({
      enabled: true,
      apiKey: 'sk-legacy-test-only',
      apiKeySource: 'environment',
      apiKeyError: null,
    });
  });

  it('honours a cleared credential even while the container still has its legacy key', async () => {
    const cfg = await resolveAiConfig(
      new Map([['ai.api_key_encrypted', '{"v":1,"state":"cleared"}']]),
      buildEnv(PROCESS_ENV, UNUSED_DB),
    );
    expect(cfg).toMatchObject({ enabled: false, apiKey: '', apiKeySource: 'none', apiKeyError: null });
  });
});
