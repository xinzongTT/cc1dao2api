import { openDatabase } from '../db/connection.mjs';
import { migrate } from '../db/migrations.mjs';
import { decodeEncryptionKey, deriveRelayPepper } from '../security/secrets.mjs';
import { createLoginRateLimiter, resolveSessionSecret } from '../security/sessions.mjs';

export function createAdminContext(config, deps = {}) {
  const db = deps.db || openDatabase(config.databasePath);
  const now = deps.now || (() => new Date());
  migrate(db);
  let encryptionKey = null;
  let encryptionError = null;
  try {
    encryptionKey = decodeEncryptionKey(config.encryptionKey || '');
  } catch (error) {
    encryptionError = error;
  }
  return {
    config,
    db,
    encryptionKey,
    encryptionError,
    relayPepper: encryptionKey ? deriveRelayPepper(encryptionKey, config.relayKeyPepper) : null,
    sessionSecret: resolveSessionSecret(db, config.sessionSecret),
    loginRateLimiter: deps.loginRateLimiter || createLoginRateLimiter({ now }),
    fetchImpl: deps.fetchImpl || deps.fetch || globalThis.fetch,
    now,
  };
}
