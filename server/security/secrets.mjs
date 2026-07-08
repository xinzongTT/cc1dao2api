import { createHash, hkdfSync } from 'node:crypto';

function decodeBase64ish(raw, encoding) {
  try {
    return Buffer.from(raw, encoding);
  } catch {
    return Buffer.alloc(0);
  }
}

export function decodeEncryptionKey(raw) {
  if (!raw) throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes');
  const urlDecoded = decodeBase64ish(raw, 'base64url');
  const decoded = urlDecoded.length === 32 ? urlDecoded : decodeBase64ish(raw, 'base64');
  if (decoded.length !== 32) {
    throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes');
  }
  return decoded;
}

export function deriveRelayPepper(encryptionKey, rawPepper = '') {
  if (rawPepper) {
    const urlDecoded = decodeBase64ish(rawPepper, 'base64url');
    if (urlDecoded.length >= 32) return urlDecoded;
    const base64Decoded = decodeBase64ish(rawPepper, 'base64');
    if (base64Decoded.length >= 32) return base64Decoded;
    return createHash('sha256').update(rawPepper).digest();
  }

  return Buffer.from(hkdfSync(
    'sha256',
    encryptionKey,
    Buffer.from('cc-proxy'),
    Buffer.from('relay-key-pepper'),
    32,
  ));
}
