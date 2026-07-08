import { getSetting } from '../db/repositories/settings.mjs';
import { listUpstreamKeys } from '../db/repositories/upstreamKeys.mjs';
import { expireOldReservations } from '../db/repositories/usage.mjs';
import { refreshUpstreamQuota } from '../quota/provider.mjs';

function settingBool(db, key, fallback) {
  const value = getSetting(db, key);
  if (value == null) return fallback;
  return value !== 'false' && value !== '0';
}

function settingNumber(db, key, fallback) {
  const value = Number(getSetting(db, key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function createScheduler(ctx) {
  const timers = new Set();

  async function runOnce(name) {
    if (name === 'quota-refresh') {
      if (!settingBool(ctx.db, 'auto_quota_refresh_enabled', true)) return 0;
      const keys = listUpstreamKeys(ctx.db).filter((key) => key.admin_enabled);
      let count = 0;
      for (const key of keys) {
        await refreshUpstreamQuota(ctx, key.id);
        count += 1;
      }
      return count;
    }
    if (name === 'reservation-cleanup') {
      const olderThan = new Date(ctx.now().getTime() - 60 * 60 * 1000).toISOString();
      return expireOldReservations(ctx.db, olderThan);
    }
    if (name === 'recent-event-cleanup') {
      const days = settingNumber(ctx.db, 'recent_event_retention_days', 7);
      const olderThan = new Date(ctx.now().getTime() - days * 24 * 60 * 60 * 1000).toISOString();
      return ctx.db.prepare('delete from usage_events_recent where created_at < ?').run(olderThan).changes;
    }
    throw new Error(`Unknown scheduler job: ${name}`);
  }

  function start() {
    const quotaMs = settingNumber(ctx.db, 'quota_refresh_interval_ms', 300000);
    timers.add(setInterval(() => runOnce('quota-refresh').catch(() => {}), quotaMs));
    timers.add(setInterval(() => runOnce('reservation-cleanup').catch(() => {}), 60000));
    timers.add(setInterval(() => runOnce('recent-event-cleanup').catch(() => {}), 3600000));
  }

  function stop() {
    for (const timer of timers) clearInterval(timer);
    timers.clear();
  }

  return { start, stop, runOnce };
}
