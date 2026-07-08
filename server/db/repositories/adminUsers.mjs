function nowIso() {
  return new Date().toISOString();
}

export function countAdminUsers(db) {
  return db.prepare('select count(*) as count from admin_users').get().count;
}

export function createAdminUser(db, { username, passwordHash, passwordSalt }) {
  const createdAt = nowIso();
  const result = db.prepare(`
    insert into admin_users(username, password_hash, password_salt, created_at)
    values(@username, @passwordHash, @passwordSalt, @createdAt)
  `).run({ username, passwordHash, passwordSalt, createdAt });
  return db.prepare('select * from admin_users where id = ?').get(result.lastInsertRowid);
}

export function findAdminByUsername(db, username) {
  return db.prepare('select * from admin_users where username = ?').get(username) || null;
}

export function findAdminById(db, id) {
  return db.prepare('select * from admin_users where id = ?').get(id) || null;
}

export function touchAdminLogin(db, id) {
  db.prepare('update admin_users set last_login_at = ? where id = ?').run(nowIso(), id);
}
