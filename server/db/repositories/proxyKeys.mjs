function nowIso() {
  return new Date().toISOString();
}

export function createProxyKey(db, input) {
  const timestamp = nowIso();
  const result = db.prepare(`
    insert into proxy_keys(
      name, key_hash, key_prefix, status, daily_token_limit, monthly_token_limit,
      allowed_models_json, notes, created_at, updated_at
    )
    values(
      @name, @keyHash, @keyPrefix, @status, @dailyTokenLimit, @monthlyTokenLimit,
      @allowedModelsJson, @notes, @createdAt, @updatedAt
    )
  `).run({
    name: input.name,
    keyHash: input.keyHash,
    keyPrefix: input.keyPrefix,
    status: input.status || 'enabled',
    dailyTokenLimit: input.dailyTokenLimit ?? null,
    monthlyTokenLimit: input.monthlyTokenLimit ?? null,
    allowedModelsJson: JSON.stringify(input.allowedModels || []),
    notes: input.notes || '',
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return getProxyKey(db, result.lastInsertRowid);
}

export function listProxyKeys(db) {
  return db.prepare('select * from proxy_keys order by id').all();
}

export function getProxyKey(db, id) {
  return db.prepare('select * from proxy_keys where id = ?').get(id) || null;
}

export function findProxyKeyByHash(db, keyHash) {
  return db.prepare('select * from proxy_keys where key_hash = ?').get(keyHash) || null;
}

export function updateProxyKey(db, id, patch) {
  const current = getProxyKey(db, id);
  if (!current) return null;
  db.prepare(`
    update proxy_keys
    set name = @name,
        status = @status,
        daily_token_limit = @dailyTokenLimit,
        monthly_token_limit = @monthlyTokenLimit,
        allowed_models_json = @allowedModelsJson,
        notes = @notes,
        updated_at = @updatedAt
    where id = @id
  `).run({
    id,
    name: patch.name ?? current.name,
    status: patch.status ?? current.status,
    dailyTokenLimit: patch.dailyTokenLimit === undefined ? current.daily_token_limit : patch.dailyTokenLimit,
    monthlyTokenLimit: patch.monthlyTokenLimit === undefined ? current.monthly_token_limit : patch.monthlyTokenLimit,
    allowedModelsJson: patch.allowedModels === undefined ? current.allowed_models_json : JSON.stringify(patch.allowedModels),
    notes: patch.notes ?? current.notes,
    updatedAt: nowIso(),
  });
  return getProxyKey(db, id);
}

export function deleteProxyKey(db, id) {
  return db.prepare('delete from proxy_keys where id = ?').run(id).changes > 0;
}

export function touchProxyKeyUsed(db, id) {
  db.prepare('update proxy_keys set last_used_at = ? where id = ?').run(nowIso(), id);
}
