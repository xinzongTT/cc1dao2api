import { immediateTransaction } from '../connection.mjs';

export function normalizeKeyId(id) {
  return id ?? 0;
}

function nowIso(now = new Date()) {
  return new Date(now).toISOString();
}

function startOfDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function startOfHour(date) {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
  ));
}

function periodStart(periodType, now = new Date()) {
  const date = new Date(now);
  return (periodType === 'month' ? startOfMonth(date) : startOfDay(date)).toISOString();
}

function nextPeriodStart(periodType, now = new Date()) {
  const date = new Date(now);
  if (periodType === 'month') {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)).toISOString();
  }
  const start = startOfDay(date);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

function getLimitForPeriod(proxyKey, periodType) {
  return periodType === 'month' ? proxyKey.monthly_token_limit : proxyKey.daily_token_limit;
}

function getRawUsage(db, { proxyKeyId, periodType, now = new Date() }) {
  if (periodType === 'month') {
    const row = db.prepare(`
      select coalesce(sum(total_tokens), 0) as total
      from usage_daily
      where proxy_key_id = ? and bucket_start >= ? and bucket_start < ?
    `).get(normalizeKeyId(proxyKeyId), periodStart('month', now), nextPeriodStart('month', now));
    return row.total || 0;
  }
  const row = db.prepare(`
    select coalesce(sum(total_tokens), 0) as total
    from usage_daily
    where proxy_key_id = ? and bucket_start = ?
  `).get(normalizeKeyId(proxyKeyId), periodStart('day', now));
  return row.total || 0;
}

function getAdjustmentTotal(db, { proxyKeyId, periodType, now = new Date() }) {
  const row = db.prepare(`
    select coalesce(sum(offset_tokens), 0) as total
    from usage_adjustments
    where proxy_key_id = ? and period_type = ? and period_start = ?
  `).get(proxyKeyId, periodType, periodStart(periodType, now));
  return row.total || 0;
}

function getActiveReserved(db, { proxyKeyId, periodType, now = new Date() }) {
  const row = db.prepare(`
    select coalesce(sum(reserved_tokens), 0) as total
    from usage_reservations
    where proxy_key_id = ? and status = 'reserved' and created_at >= ?
  `).get(proxyKeyId, periodStart(periodType, now));
  return row.total || 0;
}

export function getAdjustedUsage(db, { proxyKeyId, periodType = 'day', now = new Date() }) {
  return Math.max(0, getRawUsage(db, { proxyKeyId, periodType, now }) + getAdjustmentTotal(db, { proxyKeyId, periodType, now }));
}

export function reserveTokens(db, { requestId, proxyKeyId, requestedTokens, period = 'day', now = new Date() }) {
  return immediateTransaction(db, () => {
    const proxyKey = db.prepare('select * from proxy_keys where id = ?').get(proxyKeyId);
    if (!proxyKey || proxyKey.status !== 'enabled') {
      return { ok: false, errorCode: 'proxy_key_unavailable' };
    }
    const periods = period === 'both' ? ['day', 'month'] : [period];
    for (const periodType of periods) {
      const limit = getLimitForPeriod(proxyKey, periodType);
      if (limit == null) continue;
      const adjustedUsage = getAdjustedUsage(db, { proxyKeyId, periodType, now });
      const activeReserved = getActiveReserved(db, { proxyKeyId, periodType, now });
      if (adjustedUsage + activeReserved + requestedTokens > limit) {
        return { ok: false, errorCode: 'quota_exceeded', periodType, limit, adjustedUsage, activeReserved };
      }
    }
    db.prepare(`
      insert into usage_reservations(request_id, proxy_key_id, reserved_tokens, status, created_at)
      values(?, ?, ?, 'reserved', ?)
    `).run(requestId, proxyKeyId, requestedTokens, nowIso(now));
    return { ok: true, requestId, reservedTokens: requestedTokens };
  });
}

export function settleReservation(db, requestId, settledTokens) {
  db.prepare(`
    update usage_reservations
    set status = 'settled', settled_tokens = ?, settled_at = ?
    where request_id = ?
  `).run(settledTokens, nowIso(), requestId);
}

export function releaseReservation(db, requestId) {
  db.prepare(`
    update usage_reservations
    set status = 'released', settled_at = ?
    where request_id = ? and status = 'reserved'
  `).run(nowIso(), requestId);
}

export function expireOldReservations(db, olderThanIso) {
  return db.prepare(`
    update usage_reservations
    set status = 'expired', settled_at = ?
    where status = 'reserved' and created_at < ?
  `).run(nowIso(), olderThanIso).changes;
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

function upsertAggregate(db, table, bucketStart, event, totalTokens) {
  const successCount = event.success ? 1 : 0;
  const errorCount = event.success ? 0 : 1;
  db.prepare(`
    insert into ${table}(
      bucket_start, upstream_key_id, proxy_key_id, model, endpoint, request_count,
      success_count, error_count, input_tokens, output_tokens, cached_tokens,
      total_tokens, avg_duration_ms
    )
    values(
      @bucketStart, @upstreamKeyId, @proxyKeyId, @model, @endpoint, 1,
      @successCount, @errorCount, @inputTokens, @outputTokens, @cachedTokens,
      @totalTokens, @durationMs
    )
    on conflict(bucket_start, upstream_key_id, proxy_key_id, model, endpoint)
    do update set
      request_count = request_count + 1,
      success_count = success_count + excluded.success_count,
      error_count = error_count + excluded.error_count,
      input_tokens = input_tokens + excluded.input_tokens,
      output_tokens = output_tokens + excluded.output_tokens,
      cached_tokens = cached_tokens + excluded.cached_tokens,
      total_tokens = total_tokens + excluded.total_tokens,
      avg_duration_ms = ((avg_duration_ms * request_count) + excluded.avg_duration_ms) / (request_count + 1)
  `).run({
    bucketStart,
    upstreamKeyId: normalizeKeyId(event.upstreamKeyId),
    proxyKeyId: normalizeKeyId(event.proxyKeyId),
    model: event.model || '',
    endpoint: event.endpoint,
    successCount,
    errorCount,
    inputTokens: event.inputTokens || 0,
    outputTokens: event.outputTokens || 0,
    cachedTokens: event.cachedTokens || 0,
    totalTokens,
    durationMs: event.durationMs || 0,
  });
}

export function recordUsageEvent(db, event) {
  const totalTokens = event.totalTokens ?? ((event.inputTokens || 0) + (event.outputTokens || 0));
  const createdAt = event.createdAt || nowIso();
  insertRecentUsageEvent(db, { ...event, createdAt });
  const date = new Date(createdAt);
  upsertAggregate(db, 'usage_hourly', startOfHour(date).toISOString(), event, totalTokens);
  upsertAggregate(db, 'usage_daily', startOfDay(date).toISOString(), event, totalTokens);
}

export function addUsageAdjustment(db, { proxyKeyId, periodType, periodStart, offsetTokens, reason }) {
  const result = db.prepare(`
    insert into usage_adjustments(proxy_key_id, period_type, period_start, offset_tokens, reason, created_at)
    values(?, ?, ?, ?, ?, ?)
  `).run(proxyKeyId, periodType, periodStart, offsetTokens, reason, nowIso());
  return result.lastInsertRowid;
}

const allowedSortFields = new Set(['created_at', 'bucket_start', 'total_tokens', 'request_count', 'error_count', 'avg_duration_ms']);

export function queryUsage(db, filters = {}) {
  const bucket = filters.bucket === 'hour' ? 'hour' : 'day';
  const table = bucket === 'hour' ? 'usage_hourly' : 'usage_daily';
  const where = [];
  const params = {};
  if (filters.proxyKeyId !== undefined) {
    where.push('proxy_key_id = @proxyKeyId');
    params.proxyKeyId = normalizeKeyId(Number(filters.proxyKeyId));
  }
  if (filters.upstreamKeyId !== undefined) {
    where.push('upstream_key_id = @upstreamKeyId');
    params.upstreamKeyId = normalizeKeyId(Number(filters.upstreamKeyId));
  }
  if (filters.model) {
    where.push('model = @model');
    params.model = filters.model;
  }
  if (filters.endpoint) {
    where.push('endpoint = @endpoint');
    params.endpoint = filters.endpoint;
  }
  if (filters.from) {
    where.push('bucket_start >= @from');
    params.from = filters.from;
  }
  if (filters.to) {
    where.push('bucket_start <= @to');
    params.to = filters.to;
  }
  const whereSql = where.length ? `where ${where.join(' and ')}` : '';
  const sort = allowedSortFields.has(filters.sort) ? filters.sort : 'bucket_start';
  const direction = String(filters.direction || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
  const limit = Math.min(Number(filters.limit || 100), 1000);
  const offset = Math.max(Number(filters.offset || 0), 0);
  const rows = db.prepare(`
    select * from ${table}
    ${whereSql}
    order by ${sort} ${direction}
    limit @limit offset @offset
  `).all({ ...params, limit, offset });
  const total = db.prepare(`select count(*) as count from ${table} ${whereSql}`).get(params).count;
  return { rows, total };
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function exportUsageCsv(db, filters = {}) {
  const { rows } = queryUsage(db, { ...filters, limit: filters.limit || 1000 });
  const headers = [
    'bucket_start',
    'upstream_key_id',
    'proxy_key_id',
    'model',
    'endpoint',
    'request_count',
    'success_count',
    'error_count',
    'input_tokens',
    'output_tokens',
    'cached_tokens',
    'total_tokens',
    'avg_duration_ms',
  ];
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')),
  ].join('\n');
}
