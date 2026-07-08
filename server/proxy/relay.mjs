import { randomUUID } from 'node:crypto';
import { findProxyKeyByHash, touchProxyKeyUsed } from '../db/repositories/proxyKeys.mjs';
import { listRouteableUpstreamKeys, markUpstreamSuccess, setUpstreamHealth } from '../db/repositories/upstreamKeys.mjs';
import { nextRoutingCursor } from '../db/repositories/routingState.mjs';
import { recordUsageEvent, releaseReservation, reserveTokens, settleReservation } from '../db/repositories/usage.mjs';
import { readJsonBody } from '../http/body.mjs';
import { sendJson } from '../http/router.mjs';
import { decryptEnvelope } from '../security/encryption.mjs';
import { hashRelayKey } from '../security/keys.mjs';
import { createLegacyProxyHandlers } from './legacy.mjs';
import { sendModelList } from './models.mjs';

function openAiError(res, status, message, type = 'invalid_request_error') {
  return sendJson(res, status, { error: { message, type } });
}

function extractBearer(req) {
  const auth = req.headers?.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  return auth.slice(7).trim();
}

function parseAllowedModels(row) {
  try {
    return JSON.parse(row.allowed_models_json || '[]');
  } catch {
    return [];
  }
}

function estimateInputTokens(body) {
  if (Array.isArray(body.messages)) {
    return Math.max(1, Math.ceil(JSON.stringify(body.messages).length / 4));
  }
  return null;
}

function reservationBudget(body, config) {
  const outputReserve = Number(body.max_tokens || body.max_completion_tokens || config.defaultReservationTokens);
  const estimatedInput = estimateInputTokens(body);
  const inputReserve = estimatedInput ?? config.defaultInputReservationTokens;
  return Math.min(config.maxReservationTokens, Math.max(0, outputReserve) + Math.max(0, inputReserve));
}

function selectUpstream(db) {
  const keys = listRouteableUpstreamKeys(db);
  if (keys.length === 0) return null;
  const cursor = nextRoutingCursor(db, 'upstream_round_robin');
  return keys[(cursor - 1) % keys.length];
}

function updateHealthFromResult(ctx, upstream, result) {
  if (!upstream || result.proxyGeneratedError) return;
  if (result.upstreamStatus === 401) {
    setUpstreamHealth(ctx.db, upstream.id, { healthStatus: 'invalid', errorMessage: 'Upstream authentication failed' });
  } else if (result.upstreamStatus === 402 || result.upstreamStatus === 429) {
    setUpstreamHealth(ctx.db, upstream.id, { healthStatus: 'limited', errorMessage: `Upstream returned ${result.upstreamStatus}` });
  } else if (result.upstreamStatus >= 500) {
    setUpstreamHealth(ctx.db, upstream.id, { healthStatus: 'degraded', errorMessage: `Upstream returned ${result.upstreamStatus}` });
  } else if (result.status >= 200 && result.status < 300) {
    markUpstreamSuccess(ctx.db, upstream.id);
  }
}

async function relayBody({ req, res, ctx, endpoint, legacyHandler }) {
  const plaintextRelayKey = extractBearer(req);
  if (!plaintextRelayKey || !plaintextRelayKey.startsWith('sk-ccp_') || !ctx.relayPepper) {
    return openAiError(res, 401, 'Missing or invalid relay key', 'auth_error');
  }
  const proxyKey = findProxyKeyByHash(ctx.db, hashRelayKey(plaintextRelayKey, ctx.relayPepper));
  if (!proxyKey || proxyKey.status !== 'enabled') {
    return openAiError(res, 401, 'Unknown or disabled relay key', 'auth_error');
  }

  let body;
  try {
    body = await readJsonBody(req, 20 * 1024 * 1024);
  } catch {
    return openAiError(res, 400, 'Invalid JSON body');
  }

  const allowed = parseAllowedModels(proxyKey);
  if (allowed.length > 0 && !allowed.includes(body.model)) {
    return openAiError(res, 403, 'Model is not allowed for this relay key', 'model_not_allowed');
  }

  const requestId = randomUUID();
  const requestedTokens = reservationBudget(body, ctx.config);
  const reservation = reserveTokens(ctx.db, {
    requestId,
    proxyKeyId: proxyKey.id,
    requestedTokens,
    period: 'both',
    now: ctx.now(),
  });
  if (!reservation.ok) {
    return openAiError(res, 429, 'Relay key token quota exceeded', 'rate_limit_error');
  }

  let upstream = null;
  let result = null;
  try {
    upstream = selectUpstream(ctx.db);
    if (!upstream) {
      releaseReservation(ctx.db, requestId);
      return openAiError(res, 503, 'No routeable upstream keys are available', 'service_unavailable');
    }
    const upstreamKey = decryptEnvelope(upstream.encrypted_key_envelope, ctx.encryptionKey);
    result = await legacyHandler({ req, res, body, upstreamKey });
    const usage = result.usage || {};
    const totalTokens = (usage.inputTokens || 0) + (usage.outputTokens || 0);
    if (totalTokens > 0) {
      settleReservation(ctx.db, requestId, totalTokens);
    } else {
      releaseReservation(ctx.db, requestId);
    }
    recordUsageEvent(ctx.db, {
      requestId,
      proxyKeyId: proxyKey.id,
      upstreamKeyId: upstream.id,
      endpoint,
      model: body.model || '',
      statusCode: result.status,
      success: result.status >= 200 && result.status < 300,
      inputTokens: usage.inputTokens || 0,
      outputTokens: usage.outputTokens || 0,
      cachedTokens: usage.cachedInputTokens || 0,
      durationMs: 0,
    });
    touchProxyKeyUsed(ctx.db, proxyKey.id);
    updateHealthFromResult(ctx, upstream, result);
    return undefined;
  } catch (error) {
    releaseReservation(ctx.db, requestId);
    if (upstream) {
      setUpstreamHealth(ctx.db, upstream.id, { healthStatus: 'degraded', errorMessage: error.message });
    }
    return openAiError(res, 502, 'Proxy upstream request failed', 'upstream_error');
  }
}

export function createRelayProxyHandlers(ctx) {
  const legacy = createLegacyProxyHandlers({ config: ctx.config, fetchImpl: ctx.fetchImpl });
  return {
    handleChatCompletions(req, res) {
      return relayBody({ req, res, ctx, endpoint: '/v1/chat/completions', legacyHandler: legacy.handleChatCompletionsBody });
    },
    handleMessages(req, res) {
      return relayBody({ req, res, ctx, endpoint: '/v1/messages', legacyHandler: legacy.handleMessagesBody });
    },
    handleModels(_req, res) {
      return sendModelList(res);
    },
  };
}
