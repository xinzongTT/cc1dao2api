import { openDatabase } from '../db/connection.mjs';
import { migrate } from '../db/migrations.mjs';
import { decodeEncryptionKey, deriveRelayPepper } from '../security/secrets.mjs';

export function createAdminContext(config, deps = {}) {
  const db = deps.db || openDatabase(config.databasePath);
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
    fetchImpl: deps.fetchImpl || deps.fetch || globalThis.fetch,
    now: deps.now || (() => new Date()),
  };
}
