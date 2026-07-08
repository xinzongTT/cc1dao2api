function nowIso() {
  return new Date().toISOString();
}

export function getSetting(db, key) {
  const row = db.prepare('select value from settings where key = ?').get(key);
  return row?.value ?? null;
}

export function setSetting(db, key, value) {
  db.prepare(`
    insert into settings(key, value, updated_at)
    values(@key, @value, @updatedAt)
    on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at
  `).run({ key, value: String(value), updatedAt: nowIso() });
}

export function listSettings(db) {
  return db.prepare('select key, value, updated_at from settings order by key').all();
}
