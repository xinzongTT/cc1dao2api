import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { decodeEncryptionKey, deriveRelayPepper } from '../../server/security/secrets.mjs';
import { encryptEnvelope, decryptEnvelope } from '../../server/security/encryption.mjs';
import { generateRelayKey, hashRelayKey, verifyRelayKey } from '../../server/security/keys.mjs';
import { hashPassword, verifyPassword } from '../../server/security/passwords.mjs';
import { createSession } from '../../server/security/sessions.mjs';
import { openDatabase } from '../../server/db/connection.mjs';
import { migrate } from '../../server/db/migrations.mjs';
import { createAdminUser } from '../../server/db/repositories/adminUsers.mjs';

describe('security primitives', () => {
  it('requires a 32 byte encryption key', () => {
    const raw = randomBytes(32).toString('base64url');
    expect(decodeEncryptionKey(raw)).toHaveLength(32);
    expect(() => decodeEncryptionKey('short')).toThrow(/32 bytes/);
  });

  it('encrypts and decrypts upstream key envelopes', () => {
    const key = randomBytes(32);
    const env = encryptEnvelope('user_secret_key', key);
    expect(env.startsWith('enc:v1:default:')).toBe(true);
    expect(decryptEnvelope(env, key)).toBe('user_secret_key');
    expect(() => decryptEnvelope(env, randomBytes(32))).toThrow();
  });

  it('generates and verifies relay keys', () => {
    const encryptionKey = randomBytes(32);
    const pepper = deriveRelayPepper(encryptionKey);
    const relayKey = generateRelayKey();
    expect(relayKey.startsWith('sk-ccp_')).toBe(true);
    const hash = hashRelayKey(relayKey, pepper);
    expect(verifyRelayKey(relayKey, hash, pepper)).toBe(true);
    expect(verifyRelayKey(`${relayKey}x`, hash, pepper)).toBe(false);
  });

  it('hashes and verifies passwords', async () => {
    const { hash, salt } = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', salt, hash)).toBe(true);
    expect(await verifyPassword('wrong', salt, hash)).toBe(false);
  });

  it('creates persisted admin sessions with csrf tokens', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    const admin = createAdminUser(db, { username: 'admin', passwordHash: 'hash', passwordSalt: 'salt' });
    const session = createSession(db, admin.id, new Date('2026-07-08T00:00:00.000Z'));
    expect(session.sessionId).toHaveLength(43);
    expect(session.csrfToken).toHaveLength(43);
    expect(session.expiresAt).toBe('2026-07-09T00:00:00.000Z');
    const row = db.prepare('select * from admin_sessions where id = ?').get(session.sessionId);
    expect(row.admin_user_id).toBe(admin.id);
    expect(row.csrf_token).toBe(session.csrfToken);
  });
});
