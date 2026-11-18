// Music credentials (NetEase cookie, proxy address) sealed with the shared
// infrastructure master key. Same envelope as worker/ai/secrets.ts, but the AAD
// binds each envelope to its purpose so one cannot be replayed as the other.
import { AiSecretError } from '../../../worker/ai/secrets';

export type MusicSecretPurpose = 'cookie' | 'proxy';

const ENVELOPE_VERSION = 1;
const ENVELOPE_STATE = 'set';
const ENVELOPE_FIELD_COUNT = 4;
const MASTER_KEY_BYTES = 32;
const IV_BYTES = 12;
const GCM_TAG_BITS = 128;
const GCM_TAG_BYTES = GCM_TAG_BITS / 8;

function aadFor(purpose: MusicSecretPurpose): BufferSource {
  return new TextEncoder().encode(`edg-credit:music.${purpose}:v1`);
}

function toBase64(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
}

function fromBase64(value: unknown): Uint8Array<ArrayBuffer> {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  ) {
    throw new Error('Invalid base64');
  }
  const decoded = atob(value);
  if (btoa(decoded) !== value) throw new Error('Invalid base64');
  return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
}

async function importMasterKey(masterKey: string): Promise<CryptoKey> {
  try {
    const bytes = fromBase64(masterKey);
    if (bytes.length !== MASTER_KEY_BYTES) throw new Error('Invalid key length');
    return await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
  } catch {
    throw new AiSecretError('master_key_invalid');
  }
}

export async function sealMusicSecret(
  plain: string,
  masterKey: string,
  purpose: MusicSecretPurpose,
): Promise<string> {
  const key = await importMasterKey(masterKey);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aadFor(purpose), tagLength: GCM_TAG_BITS },
    key,
    new TextEncoder().encode(plain),
  );
  return JSON.stringify({
    v: ENVELOPE_VERSION,
    state: ENVELOPE_STATE,
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  });
}

function parseEnvelope(envelope: string): { iv: Uint8Array<ArrayBuffer>; ciphertext: Uint8Array<ArrayBuffer> } {
  const parsed: unknown = JSON.parse(envelope);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid envelope');
  const value = parsed as Record<string, unknown>;
  if (
    Object.keys(value).length !== ENVELOPE_FIELD_COUNT ||
    value.v !== ENVELOPE_VERSION ||
    value.state !== ENVELOPE_STATE
  ) {
    throw new Error('Invalid envelope');
  }
  const iv = fromBase64(value.iv);
  const ciphertext = fromBase64(value.ciphertext);
  if (iv.length !== IV_BYTES || ciphertext.length < GCM_TAG_BYTES) throw new Error('Invalid envelope');
  return { iv, ciphertext };
}

export async function openMusicSecret(
  envelope: string,
  masterKey: string,
  purpose: MusicSecretPurpose,
): Promise<string> {
  const key = await importMasterKey(masterKey);
  try {
    const { iv, ciphertext } = parseEnvelope(envelope);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: aadFor(purpose), tagLength: GCM_TAG_BITS },
      key,
      ciphertext,
    );
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(plaintext);
  } catch {
    // Never propagate native crypto/parse errors, which may include input data.
    throw new AiSecretError('decrypt_failed');
  }
}
