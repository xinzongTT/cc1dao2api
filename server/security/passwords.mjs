import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const keyLength = 64;

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('base64url');
  const derived = await scryptAsync(String(password), salt, keyLength);
  return { hash: Buffer.from(derived).toString('base64url'), salt };
}

export async function verifyPassword(password, salt, hash) {
  const derived = Buffer.from(await scryptAsync(String(password), salt, keyLength));
  const expected = Buffer.from(String(hash), 'base64url');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
