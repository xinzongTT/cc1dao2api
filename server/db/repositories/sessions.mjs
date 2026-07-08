export function getAdminSession(db, sessionId) {
  return db.prepare('select * from admin_sessions where id = ?').get(sessionId) || null;
}

export function deleteAdminSession(db, sessionId) {
  db.prepare('delete from admin_sessions where id = ?').run(sessionId);
}

export function deleteExpiredAdminSessions(db, now = new Date()) {
  return db.prepare('delete from admin_sessions where expires_at <= ?').run(now.toISOString()).changes;
}
