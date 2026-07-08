import { describe, expect, it } from 'vitest';
import { adminRequest, createInitializedApp } from './testUtils.mjs';

describe('key management api', () => {
  it('creates upstream keys encrypted and lists only masked key', async () => {
    const app = await createInitializedApp();
    const created = await adminRequest(app, 'POST', '/admin/api/upstream-keys', {
      name: 'cc-main',
      key: 'user_abcdefghijklmnopqrstuvwxyz',
      notes: 'main account',
    });
    expect(created.status).toBe(201);
    expect(created.body.key.maskedKey).toMatch(/^user_/);
    expect(JSON.stringify(created.body)).not.toContain('abcdefghijklmnopqrstuvwxyz');

    const stored = app.db.prepare('select * from upstream_keys').get();
    expect(stored.encrypted_key_envelope).toMatch(/^enc:v1:/);
    expect(stored.encrypted_key_envelope).not.toContain('abcdefghijklmnopqrstuvwxyz');

    const list = await adminRequest(app, 'GET', '/admin/api/upstream-keys');
    expect(JSON.stringify(list.body)).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(list.body.keys[0].maskedKey).toBe(created.body.key.maskedKey);
  });

  it('creates relay key and only stores hash', async () => {
    const app = await createInitializedApp();
    const created = await adminRequest(app, 'POST', '/admin/api/proxy-keys', {
      name: 'dev-client',
      dailyTokenLimit: 100000,
      monthlyTokenLimit: 1000000,
      allowedModels: ['deepseek/deepseek-v4-flash'],
    });
    expect(created.status).toBe(201);
    expect(created.body.plaintextKey.startsWith('sk-ccp_')).toBe(true);

    const stored = app.db.prepare('select * from proxy_keys').get();
    expect(stored.key_hash).not.toContain(created.body.plaintextKey);

    const list = await adminRequest(app, 'GET', '/admin/api/proxy-keys');
    expect(JSON.stringify(list.body)).not.toContain(created.body.plaintextKey);
    expect(list.body.keys[0].keyPrefix).toBe(created.body.key.keyPrefix);
  });
});
