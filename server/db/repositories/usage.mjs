export function normalizeKeyId(id) {
  return id ?? 0;
}

export function insertRecentUsageEvent(db, event) {
  db.prepare(`
    insert or replace into usage_events_recent(
      request_id, proxy_key_id, upstream_key_id, endpoint, model, status_code, success,
      input_tokens, output_tokens, cached_tokens, duration_ms, error_type, created_at
    )
    values(
      @requestId, @proxyKeyId, @upstreamKeyId, @endpoint, @model, @statusCode, @success,
      @inputTokens, @outputTokens, @cachedTokens, @durationMs, @errorType, @createdAt
    )
  `).run({
    requestId: event.requestId,
    proxyKeyId: event.proxyKeyId ?? null,
    upstreamKeyId: event.upstreamKeyId ?? null,
    endpoint: event.endpoint,
    model: event.model || '',
    statusCode: event.statusCode ?? null,
    success: event.success ? 1 : 0,
    inputTokens: event.inputTokens || 0,
    outputTokens: event.outputTokens || 0,
    cachedTokens: event.cachedTokens || 0,
    durationMs: event.durationMs || 0,
    errorType: event.errorType || null,
    createdAt: event.createdAt || new Date().toISOString(),
  });
}

export function listRecentUsageEvents(db, { limit = 50 } = {}) {
  return db.prepare(`
    select * from usage_events_recent
    order by created_at desc
    limit ?
  `).all(limit);
}
