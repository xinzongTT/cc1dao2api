import { describe, expect, it } from 'vitest';
import { getUpstreamKey, setUpstreamQuota } from '../../server/db/repositories/upstreamKeys.mjs';
import { expireOldReservations, reserveTokens } from '../../server/db/repositories/usage.mjs';
import { refreshUpstreamQuota } from '../../server/quota/provider.mjs';
import { createScheduler } from '../../server/scheduler/index.mjs';
import { addEncryptedUpstreamKey, adminRequest, createInitializedApp } from './testUtils.mjs';

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function addUpstreamWithQuota(app, { remaining }) {
  const upstreamId = await addEncryptedUpstreamKey(app, 'user_quota_existing');
  setUpstreamQuota(app.db, upstreamId, {
    quotaStatus: 'success',
    totalTokens: 1000,
    usedTokens: 1000 - remaining,
    remainingTokens: remaining,
  });
  return upstreamId;
}

describe('quota refresh and scheduler', () => {
  it('stores successful quota refresh', async () => {
    const app = await createInitializedApp({
      fetch: async () => jsonResponse(200, { total_tokens: 1000, used_tokens: 200, remaining_tokens: 800 }),
    });
    const upstreamId = await addEncryptedUpstreamKey(app, 'user_quota');
    const result = await refreshUpstreamQuota(app.ctx, upstreamId);
    expect(result.ok).toBe(true);
    const row = getUpstreamKey(app.db, upstreamId);
    expect(row.quota_status).toBe('success');
    expect(row.quota_remaining_tokens).toBe(800);
  });

  it('uses the real CommandCode usage summary endpoint for quota refresh', async () => {
    const requestedUrls = [];
    const app = await createInitializedApp({
      fetch: async (url) => {
        requestedUrls.push(url);
        return jsonResponse(200, {
          success: true,
          totalTokens: 260400000,
          totalCredits: 2.3,
          totalMonthlyCredits: 2.3,
          totalPurchasedCredits: 0,
        });
      },
    });
    const upstreamId = await addEncryptedUpstreamKey(app, 'user_usage_summary');

    const result = await refreshUpstreamQuota(app.ctx, upstreamId);

    expect(result.ok).toBe(true);
    expect(requestedUrls).toEqual(['https://api.commandcode.ai/alpha/usage/summary']);
    const row = getUpstreamKey(app.db, upstreamId);
    expect(row.quota_status).toBe('success');
    expect(row.quota_used_tokens).toBe(260400000);
    expect(row.last_error_message).toBe(null);
  });

  it('parses wrapped CommandCode usage summary responses', async () => {
    const app = await createInitializedApp({
      fetch: async () => jsonResponse(200, {
        success: true,
        data: {
          totalTokens: 1320,
          totalCredits: 2.3,
        },
      }),
    });
    const upstreamId = await addEncryptedUpstreamKey(app, 'user_wrapped_usage_summary');

    const result = await refreshUpstreamQuota(app.ctx, upstreamId);

    expect(result.ok).toBe(true);
    const row = getUpstreamKey(app.db, upstreamId);
    expect(row.quota_status).toBe('success');
    expect(row.quota_used_tokens).toBe(1320);
  });

  it('keeps last quota snapshot on failure', async () => {
    const app = await createInitializedApp({ fetch: async () => jsonResponse(500, { error: 'fail' }) });
    const upstreamId = await addUpstreamWithQuota(app, { remaining: 800 });
    const result = await refreshUpstreamQuota(app.ctx, upstreamId);
    expect(result.ok).toBe(false);
    const row = getUpstreamKey(app.db, upstreamId);
    expect(row.quota_status).toBe('failed');
    expect(row.quota_remaining_tokens).toBe(800);
  });

  it('refreshes upstream quota through the admin api', async () => {
    const app = await createInitializedApp({
      fetch: async () => jsonResponse(200, { quota: { totalTokens: 2000, usedTokens: 500, remainingTokens: 1500 } }),
    });
    const upstreamId = await addEncryptedUpstreamKey(app, 'user_quota_route');

    const res = await adminRequest(app, 'POST', `/admin/api/upstream-keys/${upstreamId}/refresh-quota`);

    expect(res.status).toBe(200);
    expect(res.body.key.quotaStatus).toBe('success');
    expect(res.body.key.quotaRemainingTokens).toBe(1500);
    expect(getUpstreamKey(app.db, upstreamId).quota_remaining_tokens).toBe(1500);
  });

  it('runs scheduler cleanup jobs on demand', async () => {
    const app = await createInitializedApp();
    const relay = await adminRequest(app, 'POST', '/admin/api/proxy-keys', { name: 'client', dailyTokenLimit: 1000, monthlyTokenLimit: 10000, allowedModels: [] });
    reserveTokens(app.db, {
      requestId: 'old-reservation',
      proxyKeyId: relay.body.key.id,
      requestedTokens: 100,
      now: new Date('2026-07-08T00:00:00.000Z'),
    });
    const scheduler = createScheduler(app.ctx);
    expect(await scheduler.runOnce('reservation-cleanup')).toBeGreaterThanOrEqual(1);
    expect(expireOldReservations(app.db, '2026-07-09T00:00:00.000Z')).toBe(0);
  });

  it('serves dashboard and settings without secrets', async () => {
    const app = await createInitializedApp();
    const dashboard = await adminRequest(app, 'GET', '/admin/api/dashboard');
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.kpis).toHaveProperty('availableUpstreamKeys');
    const settings = await adminRequest(app, 'GET', '/admin/api/settings');
    expect(settings.status).toBe(200);
    expect(settings.body.environment.databasePath).toBe(':memory:');
    expect(JSON.stringify(settings.body)).not.toContain(app.config.encryptionKey);
  });
});
