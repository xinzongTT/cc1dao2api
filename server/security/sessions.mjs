import { randomBytes, timingSafeEqual } from 'node:crypto';

export const sessionCookieName = 'ccp_session';
const defaultSessionMs = 24 * 60 * 60 * 1000;

function token() {
  return randomBytes(32).toString('base64url');
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
  if (!origin) return true;
  const host = configuredHost || req.headers?.host || '';
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
