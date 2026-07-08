import { describe, expect, it } from 'vitest';
import { createInitializedApp, createTestApp, request } from './testUtils.mjs';

describe('admin authentication api', () => {
  it('initializes first admin exactly once', async () => {
    const app = await createTestApp();
    const first = await request(app, 'POST', '/admin/api/auth/init', { username: 'admin', password: 'pass123456' });
    expect(first.status).toBe(200);
    const second = await request(app, 'POST', '/admin/api/auth/init', { username: 'root', password: 'pass123456' });
    expect(second.status).toBe(409);
  });

  it('logs in and returns session state', async () => {
    const app = await createInitializedApp();
    const login = await request(app, 'POST', '/admin/api/auth/login', { username: 'admin', password: 'pass123456' });
    expect(login.status).toBe(200);
    expect(login.headers['set-cookie']).toContain('ccp_session=');
    const session = await request(app, 'GET', '/admin/api/session', null, { Cookie: login.cookie });
    expect(session.body.ok).toBe(true);
    expect(session.body.admin.username).toBe('admin');
  });

  it('rejects invalid credentials without creating a session', async () => {
    const app = await createInitializedApp();
    const login = await request(app, 'POST', '/admin/api/auth/login', { username: 'admin', password: 'wrong' });
    expect(login.status).toBe(401);
    expect(login.body.error.code).toBe('invalid_credentials');
    expect(login.headers['set-cookie']).toBeUndefined();
  });
});
