import { openDatabase } from '../db/connection.mjs';
import { migrate } from '../db/migrations.mjs';

export function createAdminContext(config, deps = {}) {
  const db = deps.db || openDatabase(config.databasePath);
  migrate(db);
  return {
    config,
    db,
    fetchImpl: deps.fetchImpl || deps.fetch || globalThis.fetch,
    now: deps.now || (() => new Date()),
  };
}
