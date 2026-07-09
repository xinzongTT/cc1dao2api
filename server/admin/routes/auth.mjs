import { immediateTransaction } from '../../db/connection.mjs';
import { countAdminUsers, createAdminUser, findAdminById, findAdminByUsername, touchAdminLogin } from '../../db/repositories/adminUsers.mjs';
import { deleteAdminSession } from '../../db/repositories/sessions.mjs';
import { readJsonBody } from '../../http/body.mjs';
import { parseCookies, serializeCookie } from '../../http/cookies.mjs';
import { sendJson } from '../../http/router.mjs';
import { hashPassword, verifyPassword } from '../../security/passwords.mjs';
import { createSession, findSession, isSafeOrigin, sessionCookieName, signSessionId, verifyCsrfToken, verifySignedSessionId } from '../../security/sessions.mjs';

function publicAdmin(admin) {
  return { id: admin.id, username: admin.username };
}

function sendAdminError(res, status, code, message) {
  return sendJson(res, status, { ok: false, error: { code, message } });
}

function sessionCookie(value, ctx, extra = {}) {
  return serializeCookie(sessionCookieName, value, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    secure: Boolean(ctx.config.secureCookies),
    ...extra,
  });
}

export function getAdminSessionFromRequest(req, ctx) {
  const cookies = parseCookies(req.headers?.cookie || '');
  const sessionId = verifySignedSessionId(cookies[sessionCookieName], ctx.sessionSecret);
  if (!sessionId) return null;
  const session = findSession(ctx.db, sessionId, ctx.now());
  if (!session) return null;
  const admin = findAdminById(ctx.db, session.admin_user_id);
  if (!admin) return null;
  return { session, admin };
}

export function requireAdminSession(req, res, ctx) {
  const current = getAdminSessionFromRequest(req, ctx);
  if (!current) {
    sendAdminError(res, 401, 'unauthorized', 'Authentication required');
    return null;
  }

  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method || 'GET')) {
    const csrfHeader = req.headers?.['x-csrf-token'];
    const csrfOk = csrfHeader && verifyCsrfToken(csrfHeader, current.session.csrf_token);
    if (!csrfOk && !isSafeOrigin(req)) {
      sendAdminError(res, 403, 'csrf_rejected', 'CSRF validation failed');
      return null;
    }
  }

  return current;
}

export function registerAuthRoutes(router, ctx) {
  router.add('POST', '/admin/api/auth/init', async (req, res) => {
    const body = await readJsonBody(req, 64 * 1024);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!username || password.length < 8) {
      return sendAdminError(res, 400, 'invalid_input', 'Username and an 8 character password are required');
    }

    const credentials = await hashPassword(password);
    const created = immediateTransaction(ctx.db, () => {
      if (countAdminUsers(ctx.db) !== 0) return null;
      return createAdminUser(ctx.db, {
        username,
        passwordHash: credentials.hash,
        passwordSalt: credentials.salt,
      });
    });

    if (!created) return sendAdminError(res, 409, 'already_initialized', 'Admin user already exists');
    return sendJson(res, 200, { ok: true, admin: publicAdmin(created) });
  });

  router.add('POST', '/admin/api/auth/login', async (req, res) => {
    const body = await readJsonBody(req, 64 * 1024);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const rateLimit = ctx.loginRateLimiter.check(username, req);
    if (!rateLimit.ok) {
      res.setHeader('Retry-After', String(rateLimit.retryAfterSeconds));
      return sendAdminError(res, 429, 'rate_limited', 'Too many failed login attempts');
    }

    const admin = username ? findAdminByUsername(ctx.db, username) : null;
    const valid = admin ? await verifyPassword(password, admin.password_salt, admin.password_hash) : false;
    if (!valid) {
      ctx.loginRateLimiter.recordFailure(username, req);
      return sendAdminError(res, 401, 'invalid_credentials', 'Invalid username or password');
    }

    const session = createSession(ctx.db, admin.id, ctx.now());
    ctx.loginRateLimiter.recordSuccess(username, req);
    touchAdminLogin(ctx.db, admin.id);
    res.setHeader('Set-Cookie', sessionCookie(signSessionId(session.sessionId, ctx.sessionSecret), ctx, { maxAge: 24 * 60 * 60 }));
    return sendJson(res, 200, {
      ok: true,
      admin: publicAdmin(admin),
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
    });
  });

  router.add('POST', '/admin/api/auth/logout', async (req, res) => {
    const current = requireAdminSession(req, res, ctx);
    if (!current) return undefined;
    deleteAdminSession(ctx.db, current.session.id);
    res.setHeader('Set-Cookie', sessionCookie('', ctx, { maxAge: 0 }));
    return sendJson(res, 200, { ok: true });
  });

  router.add('GET', '/admin/api/session', async (req, res) => {
    const current = getAdminSessionFromRequest(req, ctx);
    if (!current) return sendJson(res, 200, { ok: false, needsInit: countAdminUsers(ctx.db) === 0 });
    return sendJson(res, 200, {
      ok: true,
      admin: publicAdmin(current.admin),
      csrfToken: current.session.csrf_token,
      expiresAt: current.session.expires_at,
    });
  });
}
