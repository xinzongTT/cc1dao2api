import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../server/db/connection.mjs';
import { migrate } from '../../server/db/migrations.mjs';
import { createProxyKey } from '../../server/db/repositories/proxyKeys.mjs';
import { adminRequest, createInitializedApp } from './testUtils.mjs';
import {
  addUsageAdjustment,
  exportUsageCsv,
  getAdjustedUsage,
  queryUsage,
  recordUsageEvent,
  reserveTokens,
  settleReservation,
} from '../../server/db/repositories/usage.mjs';

function memoryDb() {
  const db = openDatabase(':memory:');
  migrate(db);
  return db;
}

function todayBucket(now = new Date('2026-07-08T12:00:00.000Z')) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

function insertProxyKeyFixture(db, { dailyTokenLimit = null, monthlyTokenLimit = null } = {}) {
  return createProxyKey(db, {
    name: 'client',
    keyHash: `hash-${Math.random()}`,
    keyPrefix: 'sk-ccp_test',
    dailyTokenLimit,
    monthlyTokenLimit,
    allowedModels: [],
  }).id;
}

function usageFixture(overrides = {}) {
  return {
    requestId: overrides.requestId || `req-${Math.random()}`,
    proxyKeyId: overrides.proxyKeyId,
    upstreamKeyId: overrides.upstreamKeyId ?? null,
    endpoint: '/v1/chat/completions',
    model: overrides.model || 'deepseek/deepseek-v4-flash',
    statusCode: 200,
    success: true,
    inputTokens: overrides.inputTokens ?? overrides.totalTokens ?? 0,
    outputTokens: overrides.outputTokens ?? 0,
    cachedTokens: overrides.cachedTokens ?? 0,
    durationMs: overrides.durationMs ?? 12,
    createdAt: overrides.createdAt || '2026-07-08T12:00:00.000Z',
  };
}

describe('usage accounting', () => {
  it('atomically reserves tokens and rejects over limit', () => {
    const db = memoryDb();
    const proxyKeyId = insertProxyKeyFixture(db, { dailyTokenLimit: 1000 });
    const first = reserveTokens(db, {
      requestId: 'r1',
      proxyKeyId,
      requestedTokens: 800,
      period: 'day',
      now: new Date('2026-07-08T12:00:00.000Z'),
    });
    expect(first.ok).toBe(true);
    const second = reserveTokens(db, {
      requestId: 'r2',
      proxyKeyId,
      requestedTokens: 300,
      period: 'day',
      now: new Date('2026-07-08T12:00:00.000Z'),
    });
    expect(second.ok).toBe(false);
    expect(second.errorCode).toBe('quota_exceeded');
    settleReservation(db, 'r1', 750);
    expect(db.prepare('select settled_tokens from usage_reservations where request_id = ?').get('r1').settled_tokens).toBe(750);
  });

  it('uses adjustments for current quota and raw aggregates for analytics', () => {
    const db = memoryDb();
    const proxyKeyId = insertProxyKeyFixture(db, { dailyTokenLimit: 1000 });
    recordUsageEvent(db, usageFixture({ proxyKeyId, totalTokens: 700 }));
    addUsageAdjustment(db, {
      proxyKeyId,
      periodType: 'day',
      periodStart: todayBucket(),
      offsetTokens: -500,
      reason: 'reset',
    });
    expect(getAdjustedUsage(db, { proxyKeyId, periodType: 'day', now: new Date('2026-07-08T12:00:00.000Z') })).toBe(200);
    expect(queryUsage(db, { bucket: 'day' }).rows[0].total_tokens).toBe(700);
  });

  it('exports quoted usage csv', () => {
    const db = memoryDb();
    const proxyKeyId = insertProxyKeyFixture(db);
    recordUsageEvent(db, usageFixture({ proxyKeyId, model: 'model,with,comma', totalTokens: 20 }));
    const csv = exportUsageCsv(db, { bucket: 'day' });
    expect(csv).toContain('"model,with,comma"');
    expect(csv).toContain('total_tokens');
  });

  it('serves usage rows and csv through admin api', async () => {
    const app = await createInitializedApp();
    const proxyKeyId = insertProxyKeyFixture(app.db);
    recordUsageEvent(app.db, usageFixture({ proxyKeyId, totalTokens: 33 }));
    const usage = await adminRequest(app, 'GET', '/admin/api/usage?bucket=day');
    expect(usage.status).toBe(200);
    expect(usage.body.rows[0].total_tokens).toBe(33);
    const csv = await adminRequest(app, 'GET', '/admin/api/usage/export?bucket=day');
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('total_tokens');
  });
});
