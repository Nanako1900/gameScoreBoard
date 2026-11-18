import { describe, expect, it } from 'vitest';
import { AiSecretError } from '../../worker/ai/secrets';
import { openMusicSecret, sealMusicSecret } from '../src/music/secrets';

const MASTER = Buffer.alloc(32, 7).toString('base64');
const OTHER_MASTER = Buffer.alloc(32, 9).toString('base64');

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    expect(error).toBeInstanceOf(AiSecretError);
    return (error as AiSecretError).code;
  }
}

describe('music secrets', () => {
  it('round-trips a secret', async () => {
    const envelope = await sealMusicSecret('MUSIC_U=abc', MASTER, 'cookie');
    expect(envelope).not.toContain('MUSIC_U');
    expect(await openMusicSecret(envelope, MASTER, 'cookie')).toBe('MUSIC_U=abc');
  });

  it('uses a fresh IV for every seal', async () => {
    const first = await sealMusicSecret('same', MASTER, 'proxy');
    const second = await sealMusicSecret('same', MASTER, 'proxy');
    expect(first).not.toBe(second);
  });

  it('does not open a cookie envelope as a proxy envelope', async () => {
    const envelope = await sealMusicSecret('secret', MASTER, 'cookie');
    expect(await codeOf(openMusicSecret(envelope, MASTER, 'proxy'))).toBe('decrypt_failed');
  });

  it('rejects an invalid master key', async () => {
    expect(await codeOf(sealMusicSecret('x', 'not-a-key', 'cookie'))).toBe('master_key_invalid');
    const envelope = await sealMusicSecret('x', MASTER, 'cookie');
    expect(await codeOf(openMusicSecret(envelope, 'short', 'cookie'))).toBe('master_key_invalid');
  });

  it('fails with decrypt_failed for a different master key', async () => {
    const envelope = await sealMusicSecret('x', MASTER, 'cookie');
    expect(await codeOf(openMusicSecret(envelope, OTHER_MASTER, 'cookie'))).toBe('decrypt_failed');
  });

  it('fails with decrypt_failed for tampered or malformed envelopes', async () => {
    const envelope = JSON.parse(await sealMusicSecret('x', MASTER, 'cookie')) as { ciphertext: string };
    const bytes = Buffer.from(envelope.ciphertext, 'base64');
    bytes[0] = bytes[0] ^ 0xff;
    const tampered = JSON.stringify({ ...envelope, ciphertext: bytes.toString('base64') });
    expect(await codeOf(openMusicSecret(tampered, MASTER, 'cookie'))).toBe('decrypt_failed');
    expect(await codeOf(openMusicSecret('not json', MASTER, 'cookie'))).toBe('decrypt_failed');
  });
});
