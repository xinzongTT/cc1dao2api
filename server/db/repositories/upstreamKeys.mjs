import { immediateTransaction } from '../connection.mjs';

function nowIso() {
  return new Date().toISOString();
}

export function createUpstreamKey(db, input) {
  const timestamp = nowIso();
  const result = db.prepare(`
    insert into upstream_keys(
      name, encrypted_key_envelope, key_fingerprint, key_preview, admin_enabled,
      health_status, quota_status, notes, created_at, updated_at
    )
    values(
      @name, @encryptedKeyEnvelope, @keyFingerprint, @keyPreview, @adminEnabled,
      @healthStatus, @quotaStatus, @notes, @createdAt, @updatedAt
    )
  `).run({
    name: input.name,
    encryptedKeyEnvelope: input.encryptedKeyEnvelope,
    keyFingerprint: input.keyFingerprint,
    keyPreview: input.keyPreview || '',
    adminEnabled: input.adminEnabled === false ? 0 : 1,
    healthStatus: input.healthStatus || 'unknown',
    quotaStatus: input.quotaStatus || 'unknown',
    notes: input.notes || '',
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return getUpstreamKey(db, result.lastInsertRowid);
}

export function listUpstreamKeys(db) {
  return db.prepare('select * from upstream_keys order by id').all();
}

export function listRouteableUpstreamKeys(db) {
  return db.prepare(`
    select * from upstream_keys
    where admin_enabled = 1 and health_status in ('healthy', 'unknown')
    order by id
  `).all();
}

export function selectRouteableUpstreamRoundRobin(db, cursorName = 'upstream_round_robin') {
  return immediateTransaction(db, () => selectRouteableUpstreamRoundRobinInTransaction(db, cursorName));
}

export function selectRouteableUpstreamRoundRobinInTransaction(db, cursorName = 'upstream_round_robin') {
  const keys = listRouteableUpstreamKeys(db);
  if (keys.length === 0) return null;
  const row = db.prepare('select cursor_value from routing_state where name = ?').get(cursorName);
  const cursor = (row?.cursor_value ?? 0) + 1;
  db.prepare(`
    insert into routing_state(name, cursor_value, updated_at)
    values(?, ?, ?)
    on conflict(name) do update set cursor_value = excluded.cursor_value, updated_at = excluded.updated_at
  `).run(cursorName, cursor, nowIso());
  return keys[(cursor - 1) % keys.length];
}

export function getUpstreamKey(db, id) {
  return db.prepare('select * from upstream_keys where id = ?').get(id) || null;
}

export function findUpstreamByFingerprint(db, keyFingerprint) {
  return db.prepare('select * from upstream_keys where key_fingerprint = ?').get(keyFingerprint) || null;
}

export function updateUpstreamKey(db, id, patch) {
  const current = getUpstreamKey(db, id);
  if (!current) return null;
  db.prepare(`
    update upstream_keys
    set name = @name,
        admin_enabled = @adminEnabled,
        notes = @notes,
        updated_at = @updatedAt
    where id = @id
  `).run({
    id,
    name: patch.name ?? current.name,
    adminEnabled: patch.adminEnabled === undefined ? current.admin_enabled : (patch.adminEnabled ? 1 : 0),
    notes: patch.notes ?? current.notes,
    updatedAt: nowIso(),
  });
  return getUpstreamKey(db, id);
}

export function deleteUpstreamKey(db, id) {
  return db.prepare('delete from upstream_keys where id = ?').run(id).changes > 0;
}

export function setUpstreamHealth(db, id, { healthStatus, errorMessage = null }) {
  const timestamp = nowIso();
  db.prepare(`
    update upstream_keys
    set health_status = @healthStatus,
        last_error_at = case when @errorMessage is null then last_error_at else @timestamp end,
        last_error_message = coalesce(@errorMessage, last_error_message),
        updated_at = @timestamp
    where id = @id
  `).run({ id, healthStatus, errorMessage, timestamp });
  return getUpstreamKey(db, id);
}

export function markUpstreamSuccess(db, id) {
  const timestamp = nowIso();
  db.prepare(`
    update upstream_keys
    set health_status = case when health_status in ('invalid', 'limited', 'degraded') then health_status else 'healthy' end,
        last_success_at = @timestamp,
        updated_at = @timestamp
    where id = @id
  `).run({ id, timestamp });
}

export function setUpstreamQuota(db, id, quota) {
  const timestamp = nowIso();
  db.prepare(`
    update upstream_keys
    set quota_status = @quotaStatus,
        quota_total_tokens = coalesce(@totalTokens, quota_total_tokens),
        quota_used_tokens = coalesce(@usedTokens, quota_used_tokens),
        quota_remaining_tokens = coalesce(@remainingTokens, quota_remaining_tokens),
        quota_total_credits = coalesce(@totalCredits, quota_total_credits),
        quota_used_credits = coalesce(@usedCredits, quota_used_credits),
        quota_remaining_credits = coalesce(@remainingCredits, quota_remaining_credits),
        quota_reset_at = coalesce(@resetAt, quota_reset_at),
        last_quota_checked_at = @timestamp,
        last_error_message = @errorMessage,
        updated_at = @timestamp
    where id = @id
  `).run({
    id,
    quotaStatus: quota.quotaStatus,
    totalTokens: quota.totalTokens ?? null,
    usedTokens: quota.usedTokens ?? null,
    remainingTokens: quota.remainingTokens ?? null,
    totalCredits: quota.totalCredits ?? null,
    usedCredits: quota.usedCredits ?? null,
    remainingCredits: quota.remainingCredits ?? null,
    resetAt: quota.resetAt ?? null,
    errorMessage: quota.errorMessage ?? null,
    timestamp,
  });
  return getUpstreamKey(db, id);
}
