import { getSetting, setSetting } from '../../db/repositories/settings.mjs';
import { readJsonBody } from '../../http/body.mjs';
import { sendJson } from '../../http/router.mjs';
import { requireAdminSession } from './auth.mjs';

const settingMap = {
  quotaRefreshIntervalMs: ['quota_refresh_interval_ms', '300000'],
  recentEventRetentionDays: ['recent_event_retention_days', '7'],
  autoQuotaRefreshEnabled: ['auto_quota_refresh_enabled', 'true'],
  modelRefreshIntervalMs: ['model_refresh_interval_ms', '300000'],
};

function settingsPayload(ctx) {
  const settings = {};
  for (const [publicName, [key, fallback]] of Object.entries(settingMap)) {
    settings[publicName] = getSetting(ctx.db, key) ?? fallback;
  }
  return {
    ok: true,
    settings,
    environment: {
      encryptionKeyConfigured: Boolean(ctx.encryptionKey),
      databasePath: ctx.config.databasePath,
      appVersion: ctx.config.version || '1.0.0',
    },
  };
}

export function registerSettingsRoutes(router, ctx) {
  router.add('GET', '/admin/api/settings', async (req, res) => {
    if (!requireAdminSession(req, res, ctx)) return undefined;
    return sendJson(res, 200, settingsPayload(ctx));
  });

  router.add('PATCH', '/admin/api/settings', async (req, res) => {
    if (!requireAdminSession(req, res, ctx)) return undefined;
    const body = await readJsonBody(req, 64 * 1024);
    for (const [publicName, [key]] of Object.entries(settingMap)) {
      if (body[publicName] !== undefined) setSetting(ctx.db, key, String(body[publicName]));
    }
    return sendJson(res, 200, settingsPayload(ctx));
  });
}
