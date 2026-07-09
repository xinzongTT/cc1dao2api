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

  it('reports whether first-time admin initialization is needed', async () => {
    const app = await createTestApp();
    const before = await request(app, 'GET', '/admin/api/session');
    expect(before.body).toEqual({ ok: false, needsInit: true });

    await request(app, 'POST', '/admin/api/auth/init', { username: 'admin', password: 'pass123456' });

    const after = await request(app, 'GET', '/admin/api/session');
    expect(after.body).toEqual({ ok: false, needsInit: false });
  });

  it('logs in and returns session state', async () => {
    const app = await createInitializedApp();
    const login = await request(app, 'POST', '/admin/api/auth/login', { username: 'admin', password: 'pass123456' });
    expect(login.status).toBe(200);
    expect(login.headers['set-cookie']).toContain('ccp_session=');
    expect(login.cookie).toMatch(/^ccp_session=[^.]+\.[^.]+$/);
    const session = await request(app, 'GET', '/admin/api/session', null, { Cookie: login.cookie });
    expect(session.body.ok).toBe(true);
    expect(session.body.admin.username).toBe('admin');
  });

  it('rejects session cookies with an invalid signature', async () => {
    const app = await createInitializedApp();
    const login = await request(app, 'POST', '/admin/api/auth/login', { username: 'admin', password: 'pass123456' });
    const [name, value] = login.cookie.split('=');
    const [sessionId] = value.split('.');
    const session = await request(app, 'GET', '/admin/api/session', null, { Cookie: `${name}=${sessionId}.invalid-signature` });
    expect(session.body.ok).toBe(false);
  });

  it('rejects invalid credentials without creating a session', async () => {
    const app = await createInitializedApp();
    const login = await request(app, 'POST', '/admin/api/auth/login', { username: 'admin', password: 'wrong' });
    expect(login.status).toBe(401);
    expect(login.body.error.code).toBe('invalid_credentials');
    expect(login.headers['set-cookie']).toBeUndefined();
  });

  it('rate limits repeated login failures by username and client address', async () => {
    const app = await createInitializedApp();
    for (let i = 0; i < 5; i += 1) {
      const res = await request(app, 'POST', '/admin/api/auth/login', { username: 'admin', password: `wrong-${i}` });
      expect(res.status).toBe(401);
    }

    const limited = await request(app, 'POST', '/admin/api/auth/login', { username: 'admin', password: 'wrong-final' });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('rate_limited');
  });

  it('requires csrf token or a matching origin for mutating admin routes', async () => {
    const app = await createInitializedApp();
    const login = await request(app, 'POST', '/admin/api/auth/login', { username: 'admin', password: 'pass123456' });

    const missingProof = await request(app, 'POST', '/admin/api/auth/logout', null, { Cookie: login.cookie });

    expect(missingProof.status).toBe(403);
    expect(missingProof.body.error.code).toBe('csrf_rejected');

    const sameOrigin = await request(app, 'POST', '/admin/api/auth/logout', null, {
      Cookie: login.cookie,
      Origin: 'http://127.0.0.1',
    });
    expect(sameOrigin.status).toBe(200);
  });

  it('rejects malformed json without crashing the router', async () => {
    const app = await createTestApp();
    const res = await request(app, 'POST', '/admin/api/auth/init', '{"username":');
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe('invalid_json');
  });

  it('rejects oversized admin json bodies without a 500', async () => {
    const app = await createTestApp();
    const res = await request(app, 'POST', '/admin/api/auth/init', {
      username: 'admin',
      password: 'pass123456',
      padding: 'x'.repeat(70 * 1024),
    });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('body_too_large');
  });
});
