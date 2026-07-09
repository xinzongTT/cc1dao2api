import { createUpstreamKey, deleteUpstreamKey, getUpstreamKey, listUpstreamKeys, setUpstreamHealth, updateUpstreamKey } from '../../db/repositories/upstreamKeys.mjs';
import { readJsonBody } from '../../http/body.mjs';
import { sendJson } from '../../http/router.mjs';
import { refreshUpstreamQuota } from '../../quota/provider.mjs';
import { encryptEnvelope } from '../../security/encryption.mjs';
import { fingerprintSecret, maskSecret } from '../../security/keys.mjs';
import { requireAdminSession } from './auth.mjs';

function sendAdminError(res, status, code, message) {
  return sendJson(res, status, { ok: false, error: { code, message } });
}

function publicUpstreamKey(row) {
  return {
    id: row.id,
    name: row.name,
    maskedKey: row.key_preview || row.key_fingerprint,
    keyFingerprint: row.key_fingerprint,
    adminEnabled: Boolean(row.admin_enabled),
    healthStatus: row.health_status,
    quotaStatus: row.quota_status,
    quotaTotalTokens: row.quota_total_tokens,
    quotaUsedTokens: row.quota_used_tokens,
    quotaRemainingTokens: row.quota_remaining_tokens,
    quotaTotalCredits: row.quota_total_credits,
    quotaUsedCredits: row.quota_used_credits,
    quotaRemainingCredits: row.quota_remaining_credits,
    quotaResetAt: row.quota_reset_at,
    lastQuotaCheckedAt: row.last_quota_checked_at,
    lastSuccessAt: row.last_success_at,
    lastErrorAt: row.last_error_at,
    lastErrorMessage: row.last_error_message,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateUserKey(key) {
  return /^user_[a-zA-Z0-9_-]+$/.test(key);
}

export function registerUpstreamKeyRoutes(router, ctx) {
  router.add('GET', '/admin/api/upstream-keys', async (req, res) => {
    if (!requireAdminSession(req, res, ctx)) return undefined;
    return sendJson(res, 200, { ok: true, keys: listUpstreamKeys(ctx.db).map(publicUpstreamKey) });
  });

  router.add('POST', '/admin/api/upstream-keys', async (req, res) => {
    if (!requireAdminSession(req, res, ctx)) return undefined;
    if (!ctx.encryptionKey) {
      return sendAdminError(res, 503, 'encryption_key_missing', 'ENCRYPTION_KEY is missing or invalid');
    }
    const body = await readJsonBody(req, 128 * 1024);
    const name = String(body.name || '').trim();
    const key = String(body.key || '').trim();
    if (!name || !validateUserKey(key)) {
      return sendAdminError(res, 400, 'invalid_upstream_key', 'A name and user_ key are required');
    }
    const row = createUpstreamKey(ctx.db, {
      name,
      encryptedKeyEnvelope: encryptEnvelope(key, ctx.encryptionKey),
      keyFingerprint: fingerprintSecret(key).slice(0, 32),
      keyPreview: maskSecret(key),
      notes: String(body.notes || ''),
    });
    return sendJson(res, 201, { ok: true, key: publicUpstreamKey(row) });
  });

  router.add('PATCH', '/admin/api/upstream-keys/:id', async (req, res) => {
    if (!requireAdminSession(req, res, ctx)) return undefined;
    const body = await readJsonBody(req, 128 * 1024);
    const row = updateUpstreamKey(ctx.db, Number(req.params.id), {
      name: body.name,
      notes: body.notes,
      adminEnabled: body.adminEnabled,
    });
    if (!row) return sendAdminError(res, 404, 'not_found', 'Upstream key not found');
    return sendJson(res, 200, { ok: true, key: publicUpstreamKey(row) });
  });

  router.add('DELETE', '/admin/api/upstream-keys/:id', async (req, res) => {
    if (!requireAdminSession(req, res, ctx)) return undefined;
    if (!deleteUpstreamKey(ctx.db, Number(req.params.id))) {
      return sendAdminError(res, 404, 'not_found', 'Upstream key not found');
    }
    return sendJson(res, 200, { ok: true });
  });

  router.add('POST', '/admin/api/upstream-keys/:id/test', async (req, res) => {
    if (!requireAdminSession(req, res, ctx)) return undefined;
    const row = getUpstreamKey(ctx.db, Number(req.params.id));
    if (!row) return sendAdminError(res, 404, 'not_found', 'Upstream key not found');
    const updated = setUpstreamHealth(ctx.db, row.id, { healthStatus: 'healthy', errorMessage: null });
    return sendJson(res, 200, { ok: true, key: publicUpstreamKey(updated) });
  });

  router.add('POST', '/admin/api/upstream-keys/:id/refresh-quota', async (req, res) => {
    if (!requireAdminSession(req, res, ctx)) return undefined;
    const upstreamId = Number(req.params.id);
    const result = await refreshUpstreamQuota(ctx, upstreamId);
    const row = getUpstreamKey(ctx.db, upstreamId);
    if (!row) return sendAdminError(res, 404, 'not_found', 'Upstream key not found');
    return sendJson(res, result.ok ? 200 : 502, {
      ok: result.ok,
      key: publicUpstreamKey(row),
      error: result.ok ? undefined : { code: 'quota_refresh_failed', message: result.message || 'Quota refresh failed' },
    });
  });
}
