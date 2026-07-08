import { createProxyKey, deleteProxyKey, listProxyKeys, updateProxyKey } from '../../db/repositories/proxyKeys.mjs';
import { readJsonBody } from '../../http/body.mjs';
import { sendJson } from '../../http/router.mjs';
import { generateRelayKey, hashRelayKey } from '../../security/keys.mjs';
import { requireAdminSession } from './auth.mjs';

function sendAdminError(res, status, code, message) {
  return sendJson(res, status, { ok: false, error: { code, message } });
}

function allowedModels(row) {
  try {
    return JSON.parse(row.allowed_models_json || '[]');
  } catch {
    return [];
  }
}

export function publicProxyKey(row) {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.key_prefix,
    status: row.status,
    dailyTokenLimit: row.daily_token_limit,
    monthlyTokenLimit: row.monthly_token_limit,
    allowedModels: allowedModels(row),
    lastUsedAt: row.last_used_at,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeLimit(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : NaN;
}

function validateAllowedModels(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function registerProxyKeyRoutes(router, ctx) {
  router.add('GET', '/admin/api/proxy-keys', async (req, res) => {
    if (!requireAdminSession(req, res, ctx)) return undefined;
    return sendJson(res, 200, { ok: true, keys: listProxyKeys(ctx.db).map(publicProxyKey) });
  });

  router.add('POST', '/admin/api/proxy-keys', async (req, res) => {
    if (!requireAdminSession(req, res, ctx)) return undefined;
    if (!ctx.relayPepper) return sendAdminError(res, 503, 'relay_pepper_missing', 'Relay key pepper is unavailable');
    const body = await readJsonBody(req, 128 * 1024);
    const name = String(body.name || '').trim();
    const dailyTokenLimit = normalizeLimit(body.dailyTokenLimit);
    const monthlyTokenLimit = normalizeLimit(body.monthlyTokenLimit);
    const allowed = body.allowedModels ?? [];
    if (!name || Number.isNaN(dailyTokenLimit) || Number.isNaN(monthlyTokenLimit) || !validateAllowedModels(allowed)) {
      return sendAdminError(res, 400, 'invalid_proxy_key', 'Valid key name, limits, and model allowlist are required');
    }
    const plaintextKey = generateRelayKey();
    const row = createProxyKey(ctx.db, {
      name,
      keyHash: hashRelayKey(plaintextKey, ctx.relayPepper),
      keyPrefix: plaintextKey.slice(0, 16),
      dailyTokenLimit,
      monthlyTokenLimit,
      allowedModels: allowed,
      notes: String(body.notes || ''),
    });
    return sendJson(res, 201, { ok: true, plaintextKey, key: publicProxyKey(row) });
  });

  router.add('PATCH', '/admin/api/proxy-keys/:id', async (req, res) => {
    if (!requireAdminSession(req, res, ctx)) return undefined;
    const body = await readJsonBody(req, 128 * 1024);
    const dailyTokenLimit = body.dailyTokenLimit === undefined ? undefined : normalizeLimit(body.dailyTokenLimit);
    const monthlyTokenLimit = body.monthlyTokenLimit === undefined ? undefined : normalizeLimit(body.monthlyTokenLimit);
    if (Number.isNaN(dailyTokenLimit) || Number.isNaN(monthlyTokenLimit)) {
      return sendAdminError(res, 400, 'invalid_limit', 'Limits must be positive integers or null');
    }
    if (body.allowedModels !== undefined && !validateAllowedModels(body.allowedModels)) {
      return sendAdminError(res, 400, 'invalid_models', 'Allowed models must be an array of strings');
    }
    const row = updateProxyKey(ctx.db, Number(req.params.id), {
      name: body.name,
      status: body.status,
      dailyTokenLimit,
      monthlyTokenLimit,
      allowedModels: body.allowedModels,
      notes: body.notes,
    });
    if (!row) return sendAdminError(res, 404, 'not_found', 'Relay key not found');
    return sendJson(res, 200, { ok: true, key: publicProxyKey(row) });
  });

  router.add('DELETE', '/admin/api/proxy-keys/:id', async (req, res) => {
    if (!requireAdminSession(req, res, ctx)) return undefined;
    if (!deleteProxyKey(ctx.db, Number(req.params.id))) {
      return sendAdminError(res, 404, 'not_found', 'Relay key not found');
    }
    return sendJson(res, 200, { ok: true });
  });
}
