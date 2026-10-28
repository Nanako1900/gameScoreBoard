import { describe, expect, it } from 'vitest';
import { openAiApiKey, sealAiApiKey } from '../../worker/ai/secrets';

const MASTER = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
// Independent Node createCipheriv fixture: AES-256-GCM, 12-byte IV, 128-bit tag,
// AAD edg-credit:ai.api_key:v1. Guards against matching encoder/decoder mistakes.
const FIXTURE = { v: 1, state: 'set', iv: 'AAECAwQFBgcICQoL', ciphertext: 'NGn7faydtm7/JFj49a681/KQavTUcSvOpAU=' };

describe('AI API key envelopes', () => {
  it.each(['sk-test-凭据', '\uFEFFsk-test'])('round-trips a UTF-8 credential without storing plaintext (%#)', async (apiKey) => {
    const envelope = await sealAiApiKey(apiKey, MASTER);
    expect(envelope).not.toContain(apiKey);
    expect(JSON.parse(envelope)).toMatchObject({ v: 1, state: 'set' });
    expect(await openAiApiKey(envelope, MASTER)).toBe(apiKey);
  });

  it('uses a fresh 12-byte IV for each encryption', async () => {
    const a = JSON.parse(await sealAiApiKey('same-key', MASTER));
    const b = JSON.parse(await sealAiApiKey('same-key', MASTER));
    expect(atob(a.iv)).toHaveLength(12);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('opens independently generated ciphertext with the fixed authenticated context', async () => {
    expect(await openAiApiKey(JSON.stringify(FIXTURE), MASTER)).toBe('sk-fixture');
  });

  it('rejects a different valid master key without exposing key material', async () => {
    const envelope = await sealAiApiKey('private-provider-key', MASTER);
    await expect(openAiApiKey(envelope, '//////////////////////////////////////////8=')).rejects.toThrow('AI credential decryption failed');
  });

  it.each(['', 'not-base64-secret', 'YQ==', `${MASTER}\n`, MASTER.replace(/=$/, '')])(
    'rejects malformed or non-256-bit master keys without reflecting their input (%#)', async (master) => {
      await expect(sealAiApiKey('private-provider-key', master)).rejects.toThrow('Invalid AI configuration master key');
      await expect(openAiApiKey(JSON.stringify(FIXTURE), master)).rejects.toThrow('Invalid AI configuration master key');
    },
  );

  it.each(['iv', 'ciphertext'] as const)('rejects authenticated %s tampering', async (field) => {
    const tampered = { ...FIXTURE, [field]: `A${FIXTURE[field].slice(1)}` };
    // IV fixture already starts with A, so force a different first byte.
    tampered[field] = `B${tampered[field].slice(1)}`;
    await expect(openAiApiKey(JSON.stringify(tampered), MASTER)).rejects.toThrow('AI credential decryption failed');
  });

  it.each([
    'secret-invalid-json', 'null', '[]', '{}',
    JSON.stringify({ ...FIXTURE, v: 2 }),
    JSON.stringify({ ...FIXTURE, state: 'cleared' }),
    JSON.stringify({ v: 1, state: 'cleared' }),
    JSON.stringify({ ...FIXTURE, iv: 'YQ==' }),
    JSON.stringify({ ...FIXTURE, ciphertext: 'YQ==' }),
    JSON.stringify({ ...FIXTURE, ciphertext: 'bad-base64!' }),
    JSON.stringify({ ...FIXTURE, extra: 'secret-extra-field' }),
  ])('rejects malformed envelopes with a fixed error (%#)', async (envelope) => {
    await expect(openAiApiKey(envelope, MASTER)).rejects.toThrow('AI credential decryption failed');
  });
});
