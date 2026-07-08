import { listUpstreamKeys, listRouteableUpstreamKeys } from '../../db/repositories/upstreamKeys.mjs';
import { listRecentUsageEvents, queryUsage } from '../../db/repositories/usage.mjs';
import { sendJson } from '../../http/router.mjs';
import { requireAdminSession } from './auth.mjs';

function todayBucket(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

export function registerDashboardRoutes(router, ctx) {
  router.add('GET', '/admin/api/dashboard', async (req, res) => {
    if (!requireAdminSession(req, res, ctx)) return undefined;
    const upstreamKeys = listUpstreamKeys(ctx.db);
    const today = todayBucket(ctx.now());
    const todayRows = queryUsage(ctx.db, { bucket: 'day', from: today, to: today, limit: 1000 }).rows;
    const totals = todayRows.reduce((acc, row) => {
      acc.requests += row.request_count;
      acc.successes += row.success_count;
      acc.errors += row.error_count;
      acc.tokens += row.total_tokens;
      return acc;
    }, { requests: 0, successes: 0, errors: 0, tokens: 0 });
    const allUsage = ctx.db.prepare('select coalesce(sum(request_count), 0) as total from usage_daily').get().total || 0;
    const recent = listRecentUsageEvents(ctx.db, { limit: 20 });
    return sendJson(res, 200, {
      ok: true,
      kpis: {
        totalRequests: allUsage,
        todayTokens: totals.tokens,
        successRate: totals.requests ? totals.successes / totals.requests : 0,
        availableUpstreamKeys: listRouteableUpstreamKeys(ctx.db).length,
        unknownQuotaKeys: upstreamKeys.filter((key) => ['unknown', 'stale'].includes(key.quota_status)).length,
        recentErrors: recent.filter((event) => !event.success).length,
      },
      tokenTrend: queryUsage(ctx.db, { bucket: 'hour', limit: 24 }).rows,
      upstreamQuota: upstreamKeys.map((key) => ({
        id: key.id,
        name: key.name,
        quotaStatus: key.quota_status,
        remainingTokens: key.quota_remaining_tokens,
        totalTokens: key.quota_total_tokens,
      })),
      recentErrors: recent.filter((event) => !event.success),
      recentRequests: recent,
    });
  });
}
