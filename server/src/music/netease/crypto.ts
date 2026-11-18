// NetEase Cloud Music web client ("weapi") request encryption.
// Constants match the public values embedded in music.163.com's core.js, as
// published by open-source clients (e.g. listen1, netease-cloud-music-dl).
import { createCipheriv, randomInt } from 'node:crypto';

const PRESET_KEY = '0CoJUm6Qyw8W8jud';
const IV = '0102030405060708';
const CIPHER = 'aes-128-cbc';
const SECRET_KEY_LENGTH = 16;
const SECRET_KEY_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const SECRET_KEY_PATTERN = /^[A-Za-z0-9]{16}$/;
const RSA_EXPONENT = 0x010001n;
const RSA_MODULUS = BigInt(
  '0x00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7',
);
const ENC_SEC_KEY_HEX_LENGTH = 256;

export interface WeapiForm {
  params: string;
  encSecKey: string;
}

function aesEncrypt(text: string, key: string): string {
  const cipher = createCipheriv(CIPHER, Buffer.from(key, 'utf8'), Buffer.from(IV, 'utf8'));
  return Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]).toString('base64');
}

function randomSecretKey(): string {
  return Array.from(
    { length: SECRET_KEY_LENGTH },
    () => SECRET_KEY_ALPHABET[randomInt(SECRET_KEY_ALPHABET.length)],
  ).join('');
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let factor = base % modulus;
  let remaining = exponent;
  while (remaining > 0n) {
    if (remaining & 1n) result = (result * factor) % modulus;
    factor = (factor * factor) % modulus;
    remaining >>= 1n;
  }
  return result;
}

/** Textbook RSA (no padding) of the reversed key, as fixed-width lowercase hex. */
function rsaEncrypt(secretKey: string): string {
  const reversed = [...secretKey].reverse().join('');
  const message = BigInt(`0x${Buffer.from(reversed, 'utf8').toString('hex')}`);
  return modPow(message, RSA_EXPONENT, RSA_MODULUS).toString(16).padStart(ENC_SEC_KEY_HEX_LENGTH, '0');
}

export function weapi(payload: object, secretKey: string = randomSecretKey()): WeapiForm {
  if (!SECRET_KEY_PATTERN.test(secretKey)) {
    throw new Error('weapi secret key must be 16 alphanumeric characters');
  }
  const text = JSON.stringify(payload);
  return {
    params: aesEncrypt(aesEncrypt(text, PRESET_KEY), secretKey),
    encSecKey: rsaEncrypt(secretKey),
  };
}
