import { exportUsageCsv, queryUsage } from '../../db/repositories/usage.mjs';
import { sendJson } from '../../http/router.mjs';
import { requireAdminSession } from './auth.mjs';

function filtersFromUrl(url) {
  return {
    bucket: url.searchParams.get('bucket') || 'day',
    proxyKeyId: url.searchParams.get('proxy_key_id') ?? undefined,
    upstreamKeyId: url.searchParams.get('upstream_key_id') ?? undefined,
    model: url.searchParams.get('model') || undefined,
    endpoint: url.searchParams.get('endpoint') || undefined,
    from: url.searchParams.get('from') || undefined,
    to: url.searchParams.get('to') || undefined,
    limit: url.searchParams.get('limit') || undefined,
    offset: url.searchParams.get('offset') || undefined,
    sort: url.searchParams.get('sort') || undefined,
    direction: url.searchParams.get('direction') || undefined,
  };
}

export function registerUsageRoutes(router, ctx) {
  router.add('GET', '/admin/api/usage', async (req, res, url) => {
    if (!requireAdminSession(req, res, ctx)) return undefined;
    return sendJson(res, 200, { ok: true, ...queryUsage(ctx.db, filtersFromUrl(url)) });
  });

  router.add('GET', '/admin/api/usage/export', async (req, res, url) => {
    if (!requireAdminSession(req, res, ctx)) return undefined;
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="usage.csv"',
    });
    res.end(exportUsageCsv(ctx.db, filtersFromUrl(url)));
  });
}
