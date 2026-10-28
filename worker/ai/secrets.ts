// Versioned credentials stored in app_settings. The infrastructure master key
// remains outside the database and is shared by app and bot deployments.
const AAD = new TextEncoder().encode('edg-credit:ai.api_key:v1');

export class AiSecretError extends Error {
  constructor(readonly code: 'master_key_invalid' | 'decrypt_failed') {
    super(code === 'master_key_invalid'
      ? 'Invalid AI configuration master key'
      : 'AI credential decryption failed');
    this.name = 'AiSecretError';
  }
}

function toBase64(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
}

function fromBase64(value: unknown): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('Invalid base64');
  const decoded = atob(value);
  if (btoa(decoded) !== value) throw new Error('Invalid base64');
  return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
}

async function importMasterKey(masterKey: string): Promise<CryptoKey> {
  try {
    const bytes = fromBase64(masterKey);
    if (bytes.length !== 32) throw new Error('Invalid key length');
    return await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
  } catch {
    throw new AiSecretError('master_key_invalid');
  }
}

export async function sealAiApiKey(apiKey: string, masterKey: string): Promise<string> {
  const key = await importMasterKey(masterKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: AAD, tagLength: 128 },
    key,
    new TextEncoder().encode(apiKey),
  );
  return JSON.stringify({ v: 1, state: 'set', iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) });
}

export async function openAiApiKey(envelope: string, masterKey: string): Promise<string> {
  const key = await importMasterKey(masterKey);
  try {
    const parsed: unknown = JSON.parse(envelope);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid envelope');
    const value = parsed as Record<string, unknown>;
    if (Object.keys(value).length !== 4 || value.v !== 1 || value.state !== 'set') throw new Error('Invalid envelope');
    const iv = fromBase64(value.iv);
    const ciphertext = fromBase64(value.ciphertext);
    if (iv.length !== 12 || ciphertext.length < 16) throw new Error('Invalid envelope');
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: AAD, tagLength: 128 }, key, ciphertext,
    );
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(plaintext);
  } catch {
    // Never propagate native crypto/parse errors, which may include input data.
    throw new AiSecretError('decrypt_failed');
  }
}
