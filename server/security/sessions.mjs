import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getSetting, setSetting } from '../db/repositories/settings.mjs';

export const sessionCookieName = 'ccp_session';
const defaultSessionMs = 24 * 60 * 60 * 1000;
const storedSessionSecretKey = 'session_secret';
const defaultLoginWindowMs = 15 * 60 * 1000;

function token() {
  return randomBytes(32).toString('base64url');
}

export function resolveSessionSecret(db, configuredSecret = '') {
  const explicit = String(configuredSecret || '').trim();
  if (explicit) return explicit;
  const existing = getSetting(db, storedSessionSecretKey);
  if (existing) return existing;
  const generated = token();
  setSetting(db, storedSessionSecretKey, generated);
  return generated;
}

function sessionSignature(sessionId, sessionSecret) {
  return createHmac('sha256', String(sessionSecret)).update(sessionId).digest('base64url');
}

export function signSessionId(sessionId, sessionSecret) {
  return `${sessionId}.${sessionSignature(sessionId, sessionSecret)}`;
}

export function verifySignedSessionId(signedValue, sessionSecret) {
  const value = String(signedValue || '');
  const separator = value.lastIndexOf('.');
  if (separator <= 0 || separator === value.length - 1) return null;
  const sessionId = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  const expected = sessionSignature(sessionId, sessionSecret);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return null;
  return timingSafeEqual(actualBuffer, expectedBuffer) ? sessionId : null;
}

export function createSession(db, adminUserId, now = new Date(), ttlMs = defaultSessionMs) {
  const createdAt = new Date(now);
  const expiresAt = new Date(createdAt.getTime() + ttlMs);
  const session = {
    sessionId: token(),
    csrfToken: token(),
    expiresAt: expiresAt.toISOString(),
  };
  db.prepare(`
    insert into admin_sessions(id, admin_user_id, csrf_token, created_at, expires_at)
    values(@sessionId, @adminUserId, @csrfToken, @createdAt, @expiresAt)
  `).run({
    sessionId: session.sessionId,
    adminUserId,
    csrfToken: session.csrfToken,
    createdAt: createdAt.toISOString(),
    expiresAt: session.expiresAt,
  });
  return session;
}

export function deleteSession(db, sessionId) {
  db.prepare('delete from admin_sessions where id = ?').run(sessionId);
}

export function findSession(db, sessionId, now = new Date()) {
  const row = db.prepare('select * from admin_sessions where id = ?').get(sessionId);
  if (!row) return null;
  if (Date.parse(row.expires_at) <= now.getTime()) {
    deleteSession(db, sessionId);
    return null;
  }
  return row;
}

export function verifyCsrfToken(actual, expected) {
  const actualBuffer = Buffer.from(String(actual || ''));
  const expectedBuffer = Buffer.from(String(expected || ''));
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function isSafeOrigin(req, configuredHost = '') {
  const origin = req.headers?.origin;
  if (!origin) return false;
  const host = configuredHost || req.headers?.host || '';
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function clientAddress(req) {
  return req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown';
}

function loginFailureKey(username, req) {
  return `${String(username || '').trim().toLowerCase()}|${clientAddress(req)}`;
}

export function createLoginRateLimiter({ maxAttempts = 5, windowMs = defaultLoginWindowMs, now = () => new Date() } = {}) {
  const failures = new Map();

  function currentMs() {
    return new Date(now()).getTime();
  }

  function activeRecord(key) {
    const record = failures.get(key);
    if (!record) return { attempts: 0, firstFailureAt: currentMs() };
    if (currentMs() - record.firstFailureAt >= windowMs) {
      failures.delete(key);
      return { attempts: 0, firstFailureAt: currentMs() };
    }
    return record;
  }

  return {
    check(username, req) {
      const record = activeRecord(loginFailureKey(username, req));
      if (record.attempts < maxAttempts) return { ok: true };
      return {
        ok: false,
        retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (currentMs() - record.firstFailureAt)) / 1000)),
      };
    },
    recordFailure(username, req) {
      const key = loginFailureKey(username, req);
      const record = activeRecord(key);
      failures.set(key, {
        attempts: record.attempts + 1,
        firstFailureAt: record.attempts === 0 ? currentMs() : record.firstFailureAt,
      });
    },
    recordSuccess(username, req) {
      failures.delete(loginFailureKey(username, req));
    },
  };
}
