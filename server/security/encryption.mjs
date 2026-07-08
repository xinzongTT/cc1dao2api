import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function toBase64Url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function requireKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error('Encryption key must be 32 bytes');
  }
}

export function encryptEnvelope(plaintext, key, keyId = 'default') {
  requireKey(key);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    'enc',
    'v1',
    keyId,
    toBase64Url(iv),
    toBase64Url(tag),
    toBase64Url(ciphertext),
  ].join(':');
}

export function decryptEnvelope(envelope, key) {
  requireKey(key);
  const parts = String(envelope).split(':');
  if (parts.length !== 6 || parts[0] !== 'enc' || parts[1] !== 'v1') {
    throw new Error('Invalid encrypted envelope');
  }

  const [, , , ivB64, tagB64, ciphertextB64] = parts;
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
