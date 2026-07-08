import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../server/db/connection.mjs';
import { migrate } from '../../server/db/migrations.mjs';
import { createAdminUser, countAdminUsers } from '../../server/db/repositories/adminUsers.mjs';
import { getSetting, setSetting } from '../../server/db/repositories/settings.mjs';
import { insertRoutingCursor, nextRoutingCursor } from '../../server/db/repositories/routingState.mjs';

function memoryDb() {
  const db = openDatabase(':memory:');
  migrate(db);
  return db;
}

describe('database migrations', () => {
  it('creates required tables and migration version', () => {
    const db = memoryDb();
    const tables = db.prepare("select name from sqlite_master where type='table'").all().map((row) => row.name);
    expect(tables).toContain('schema_migrations');
    expect(tables).toContain('admin_users');
    expect(tables).toContain('upstream_keys');
    expect(tables).toContain('proxy_keys');
    expect(tables).toContain('usage_reservations');
    expect(tables).toContain('routing_state');
  });

  it('stores admin users and settings', () => {
    const db = memoryDb();
    expect(countAdminUsers(db)).toBe(0);
    createAdminUser(db, { username: 'admin', passwordHash: 'hash', passwordSalt: 'salt' });
    expect(countAdminUsers(db)).toBe(1);
    setSetting(db, 'quota_refresh_interval_ms', '300000');
    expect(getSetting(db, 'quota_refresh_interval_ms')).toBe('300000');
  });

  it('increments routing cursor transactionally', () => {
    const db = memoryDb();
    insertRoutingCursor(db, 'upstream_round_robin', 0);
    expect(nextRoutingCursor(db, 'upstream_round_robin')).toBe(1);
    expect(nextRoutingCursor(db, 'upstream_round_robin')).toBe(2);
  });
});
