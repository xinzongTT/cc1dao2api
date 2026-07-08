import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function generateRelayKey() {
  return `sk-ccp_${randomBytes(32).toString('base64url')}`;
}

export function hashRelayKey(plaintext, pepper) {
  return createHmac('sha256', pepper).update(String(plaintext)).digest('hex');
}

export function verifyRelayKey(plaintext, expectedHash, pepper) {
  const actual = Buffer.from(hashRelayKey(plaintext, pepper), 'hex');
  const expected = Buffer.from(String(expectedHash), 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function fingerprintSecret(secret) {
  return createHash('sha256').update(String(secret)).digest('hex');
}

export function maskSecret(secret, prefixLength = 9, suffixLength = 4) {
  const value = String(secret);
  if (value.length <= prefixLength + suffixLength) return value;
  return `${value.slice(0, prefixLength)}...${value.slice(-suffixLength)}`;
}
