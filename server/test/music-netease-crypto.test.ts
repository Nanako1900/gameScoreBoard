import { createDecipheriv } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { weapi } from '../src/music/netease/crypto';

const PRESET_KEY = '0CoJUm6Qyw8W8jud';
const IV = '0102030405060708';
const FIXED_SECRET = 'abcdefghijklmnop';

// Independent vectors: params computed with the openssl CLI (two rounds of
// `openssl enc -aes-128-cbc -base64 -A`), encSecKey with Python
// `format(pow(int(reversed_key.hex(), 16), 65537, n), '0256x')`.
const VECTOR_PAYLOAD = { s: 'hello', csrf_token: '' };
const VECTOR_PARAMS = '/dz94gvgyQU6BdgGAg+d56OwrW+bi9+mPrXOD+vf6/vIZeOsM/8qhw+X8A+nHG7s';
const VECTOR_ENC_SEC_KEY =
  'd15a1683c992095d0c234c19966605c5c5964911268bbeda8cb8d08d834913e5'
  + '9d53b32358903a121b5fca784c1f5ae44951fd02524df58ecc98e52cc7cf8689'
  + 'b42c2e93ddf05b0592512d87f5960467e2f086c018849d76014d323500e30f13'
  + 'ef4cafbb0cf5a66731a3f1776c75ca35d0062dac70a3e33245afabcf47938487';

function aesDecrypt(base64: string, key: string): string {
  const decipher = createDecipheriv('aes-128-cbc', Buffer.from(key, 'utf8'), Buffer.from(IV, 'utf8'));
  return Buffer.concat([decipher.update(base64, 'base64'), decipher.final()]).toString('utf8');
}

describe('weapi encryption', () => {
  it('restores the JSON payload after decrypting params twice with the same keys', () => {
    const payload = { ids: '[123]', level: 'standard', text: '中文 ✓' };
    const { params } = weapi(payload, FIXED_SECRET);
    const firstRound = aesDecrypt(params, FIXED_SECRET);
    expect(JSON.parse(aesDecrypt(firstRound, PRESET_KEY))).toEqual(payload);
  });

  it('matches independently computed vectors for a fixed secret key', () => {
    const result = weapi(VECTOR_PAYLOAD, FIXED_SECRET);
    expect(result.params).toBe(VECTOR_PARAMS);
    expect(result.encSecKey).toBe(VECTOR_ENC_SEC_KEY);
  });

  it('produces a 256-char lowercase hex encSecKey that is stable per secret key', () => {
    const first = weapi({ a: 1 }, FIXED_SECRET);
    const second = weapi({ b: 2 }, FIXED_SECRET);
    expect(first.encSecKey).toMatch(/^[0-9a-f]{256}$/);
    expect(second.encSecKey).toBe(first.encSecKey);
    expect(weapi({ a: 1 }, 'ponmlkjihgfedcba').encSecKey).not.toBe(first.encSecKey);
  });

  it('zero-pads encSecKey to 256 chars', () => {
    // A key of low code points still yields a full-width hex string.
    expect(weapi({}, '0000000000000000').encSecKey).toHaveLength(256);
  });

  it('generates a random 16-char alphanumeric secret key when none is given', () => {
    const first = weapi({ a: 1 });
    const second = weapi({ a: 1 });
    expect(first.encSecKey).toMatch(/^[0-9a-f]{256}$/);
    expect(first.params).not.toBe(second.params);
  });

  it('rejects secret keys that are not 16 alphanumeric chars', () => {
    expect(() => weapi({}, 'short')).toThrow();
    expect(() => weapi({}, 'abcdefghijklmno!')).toThrow();
  });

  it('does not mutate the payload', () => {
    const payload = Object.freeze({ nested: Object.freeze({ value: 1 }) });
    expect(() => weapi(payload, FIXED_SECRET)).not.toThrow();
    expect(payload).toEqual({ nested: { value: 1 } });
  });
});
