import { getSetting } from '../db/repositories/settings.mjs';
import { getUpstreamKey, setUpstreamQuota } from '../db/repositories/upstreamKeys.mjs';
import { decryptEnvelope } from '../security/encryption.mjs';

function readNumber(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function parseQuotaPayload(payload) {
  const quota = payload?.quota || payload?.data?.quota || payload?.data || payload?.usage || payload;
  const isUsageSummary = quota && (
    Object.hasOwn(quota, 'totalCredits')
    || Object.hasOwn(quota, 'totalMonthlyCredits')
    || Object.hasOwn(quota, 'totalPurchasedCredits')
    || Object.hasOwn(quota, 'totalCount')
  );
  if (isUsageSummary) {
    const usedTokens = readNumber(quota.total_tokens, quota.totalTokens, quota.total);
    if (usedTokens == null) return null;
    return {
      totalTokens: null,
      usedTokens,
      remainingTokens: null,
      resetAt: quota.reset_at || quota.resetAt || null,
    };
  }
  const totalTokens = readNumber(quota.total_tokens, quota.totalTokens, quota.total);
  const usedTokens = readNumber(quota.used_tokens, quota.usedTokens, quota.used);
  let remainingTokens = readNumber(quota.remaining_tokens, quota.remainingTokens, quota.remaining);
  if (remainingTokens == null && totalTokens != null && usedTokens != null) {
    remainingTokens = Math.max(0, totalTokens - usedTokens);
  }
  if (totalTokens == null && usedTokens == null && remainingTokens == null) return null;
  return {
    totalTokens,
    usedTokens,
    remainingTokens,
    resetAt: quota.reset_at || quota.resetAt || null,
  };
}

function endpointCandidates(ctx) {
  const configured = getSetting(ctx.db, 'quota_provider_endpoint');
  return [
    configured,
    `${ctx.config.apiBase}/alpha/usage/summary`,
  ].filter(Boolean);
}

export async function refreshUpstreamQuota(ctx, upstreamKeyId) {
  const upstream = getUpstreamKey(ctx.db, upstreamKeyId);
  if (!upstream) return { ok: false, status: 'failed', message: 'Upstream key not found' };
  if (!ctx.encryptionKey) {
    setUpstreamQuota(ctx.db, upstreamKeyId, { quotaStatus: 'failed', errorMessage: 'ENCRYPTION_KEY is missing or invalid' });
    return { ok: false, status: 'failed', message: 'ENCRYPTION_KEY is missing or invalid' };
  }

  let plaintext;
  try {
    plaintext = decryptEnvelope(upstream.encrypted_key_envelope, ctx.encryptionKey);
  } catch (error) {
    setUpstreamQuota(ctx.db, upstreamKeyId, { quotaStatus: 'failed', errorMessage: error.message });
    return { ok: false, status: 'failed', message: error.message };
  }

  let lastMessage = 'Quota response was not recognized';
  for (const endpoint of endpointCandidates(ctx)) {
    try {
      const response = await ctx.fetchImpl(endpoint, {
        headers: { Authorization: `Bearer ${plaintext}`, 'x-cli-environment': 'production' },
      });
      if (!response.ok) {
        lastMessage = `Quota endpoint returned ${response.status}`;
        continue;
      }
      const payload = await response.json();
      const quota = parseQuotaPayload(payload);
      if (!quota) {
        lastMessage = 'Quota response was not recognized';
        continue;
      }
      setUpstreamQuota(ctx.db, upstreamKeyId, { quotaStatus: 'success', ...quota, errorMessage: null });
      return { ok: true, status: 'success', quota };
    } catch (error) {
      lastMessage = error.message;
    }
  }

  setUpstreamQuota(ctx.db, upstreamKeyId, { quotaStatus: 'failed', errorMessage: lastMessage });
  return { ok: false, status: 'failed', message: lastMessage };
}
