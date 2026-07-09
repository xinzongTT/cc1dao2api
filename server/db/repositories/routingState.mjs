import { immediateTransaction } from '../connection.mjs';

function nowIso() {
  return new Date().toISOString();
}

export function insertRoutingCursor(db, name, cursorValue = 0) {
  db.prepare(`
    insert into routing_state(name, cursor_value, updated_at)
    values(?, ?, ?)
    on conflict(name) do update set cursor_value = excluded.cursor_value, updated_at = excluded.updated_at
  `).run(name, cursorValue, nowIso());
}

export function nextRoutingCursor(db, name) {
  return immediateTransaction(db, () => {
    return nextRoutingCursorInTransaction(db, name);
  });
}

export function nextRoutingCursorInTransaction(db, name) {
    const row = db.prepare('select cursor_value from routing_state where name = ?').get(name);
    const nextValue = (row?.cursor_value ?? 0) + 1;
    insertRoutingCursor(db, name, nextValue);
    return nextValue;
}
