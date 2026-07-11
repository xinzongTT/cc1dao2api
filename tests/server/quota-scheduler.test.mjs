import { describe, expect, it } from 'vitest';
import { getUpstreamKey, markUpstreamSuccess, setUpstreamHealth, setUpstreamQuota } from '../../server/db/repositories/upstreamKeys.mjs';
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

  it('restores upstream health after successful quota refresh', async () => {
    const app = await createInitializedApp({
      fetch: async () => jsonResponse(200, { total_tokens: 1000, used_tokens: 200, remaining_tokens: 800 }),
    });
    const upstreamId = await addEncryptedUpstreamKey(app, 'user_quota_recovers_health');
    setUpstreamHealth(app.db, upstreamId, { healthStatus: 'degraded', errorMessage: 'Upstream returned 500' });

    const result = await refreshUpstreamQuota(app.ctx, upstreamId);

    expect(result.ok).toBe(true);
    const row = getUpstreamKey(app.db, upstreamId);
    expect(row.health_status).toBe('healthy');
    expect(row.last_success_at).toBeTruthy();
    expect(row.last_error_message).toBe(null);
  });

  it('marks upstream success as a healthy recovery signal', async () => {
    const app = await createInitializedApp();
    const upstreamId = await addEncryptedUpstreamKey(app, 'user_health_recovers');
    setUpstreamHealth(app.db, upstreamId, { healthStatus: 'degraded', errorMessage: 'Upstream returned 500' });

    markUpstreamSuccess(app.db, upstreamId);

    const row = getUpstreamKey(app.db, upstreamId);
    expect(row.health_status).toBe('healthy');
    expect(row.last_success_at).toBeTruthy();
    expect(row.last_error_message).toBe(null);
  });

  it('uses the CommandCode API-key usage summary endpoint for quota refresh', async () => {
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
    expect(requestedUrls[0]).toBe('https://api.commandcode.ai/alpha/usage/summary');
    const row = getUpstreamKey(app.db, upstreamId);
    expect(row.quota_status).toBe('success');
    expect(row.quota_used_tokens).toBe(260400000);
    expect(row.last_error_message).toBe(null);
  });

  it('stores CommandCode credit usage and billing reset snapshots', async () => {
    const upstreamCalls = [];
    const app = await createInitializedApp({
      fetch: async (url, init) => {
        upstreamCalls.push({ url, init });
        if (url === 'https://api.commandcode.ai/alpha/usage/summary') {
          return jsonResponse(200, {
            totalTokens: 260859401,
            totalCost: 2.3478,
            totalCredits: 2.3478,
            totalMonthlyCredits: 2.3478,
            totalPurchasedCredits: 0,
            totalFreeCredits: 0,
          });
        }
        if (url === 'https://api.commandcode.ai/alpha/billing/credits') {
          return jsonResponse(200, {
            credits: {
              monthlyCredits: 7.6489,
              purchasedCredits: 0,
              freeCredits: 0,
            },
          });
        }
        if (url === 'https://api.commandcode.ai/alpha/billing/subscriptions') {
          return jsonResponse(200, {
            success: true,
            data: { currentPeriodEnd: '2026-08-04T11:28:34.000Z' },
          });
        }
        return jsonResponse(404, { error: 'not found' });
      },
    });
    const upstreamId = await addEncryptedUpstreamKey(app, 'user_credit_summary');

    const result = await refreshUpstreamQuota(app.ctx, upstreamId);

    expect(result.ok).toBe(true);
    expect(upstreamCalls.map((call) => call.url)).toEqual([
      'https://api.commandcode.ai/alpha/usage/summary',
      'https://api.commandcode.ai/alpha/billing/credits',
      'https://api.commandcode.ai/alpha/billing/subscriptions',
    ]);
    for (const call of upstreamCalls) {
      expect(call.init.headers.Authorization).toBe('Bearer user_credit_summary');
      expect(call.init.headers['x-cli-environment']).toBe('production');
      expect(call.init.headers['x-command-code-version']).toBe('0.43.1');
      expect(call.init.headers['User-Agent']).toBe('cli');
    }
    const row = getUpstreamKey(app.db, upstreamId);
    expect(row.quota_used_tokens).toBe(260859401);
    expect(row.quota_used_credits).toBeCloseTo(2.3478, 4);
    expect(row.quota_remaining_credits).toBeCloseTo(7.6489, 4);
    expect(row.quota_total_credits).toBeCloseTo(9.9967, 4);
    expect(row.quota_reset_at).toBe('2026-08-04T11:28:34.000Z');
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
