import { buildCommandCodeHeaders } from '../commandCodeHeaders.mjs';
import { getSetting } from '../db/repositories/settings.mjs';
import { getUpstreamKey, setUpstreamQuota } from '../db/repositories/upstreamKeys.mjs';
import { decryptEnvelope } from '../security/encryption.mjs';

function readNumber(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function sumNumbers(...values) {
  let total = 0;
  let hasValue = false;
  for (const value of values) {
    if (value !== undefined && value !== null && Number.isFinite(Number(value))) {
      total += Number(value);
      hasValue = true;
    }
  }
  return hasValue ? total : null;
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
    const usedCredits = readNumber(quota.totalCost, quota.totalCredits, quota.totalMonthlyCredits, quota.creditsTotal);
    if (usedTokens == null) return null;
    return {
      isUsageSummary: true,
      totalTokens: null,
      usedTokens,
      remainingTokens: null,
      totalCredits: null,
      usedCredits,
      remainingCredits: null,
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
    isUsageSummary: false,
    totalTokens,
    usedTokens,
    remainingTokens,
    totalCredits: readNumber(quota.total_credits, quota.totalCredits),
    usedCredits: readNumber(quota.used_credits, quota.usedCredits),
    remainingCredits: readNumber(quota.remaining_credits, quota.remainingCredits),
    resetAt: quota.reset_at || quota.resetAt || null,
  };
}

function authHeaders(plaintext, config) {
  return buildCommandCodeHeaders({ config, apiKey: plaintext });
}

async function fetchJson(ctx, endpoint, plaintext) {
  const response = await ctx.fetchImpl(endpoint, { headers: authHeaders(plaintext, ctx.config) });
  if (!response.ok) return null;
  return response.json();
}

function readCreditsSnapshot(payload, usedCredits) {
  const credits = payload?.credits || payload?.data?.credits || payload?.data || payload;
  const remainingMonthlyCredits = readNumber(credits?.monthlyCredits, credits?.monthly_credits);
  const fallbackMonthlyCredits = sumNumbers(credits?.opensourceMonthlyCredits, credits?.premiumMonthlyCredits);
  const monthlyCredits = remainingMonthlyCredits ?? fallbackMonthlyCredits;
  const remainingCredits = sumNumbers(monthlyCredits, credits?.purchasedCredits, credits?.purchased_credits, credits?.freeCredits, credits?.free_credits);
  return {
    remainingCredits,
    totalCredits: usedCredits != null && remainingCredits != null ? usedCredits + remainingCredits : null,
  };
}

function readSubscriptionResetAt(payload) {
  const subscription = payload?.data || payload?.subscription || payload;
  return subscription?.currentPeriodEnd || subscription?.current_period_end || null;
}

async function fetchCommandCodeBillingSnapshot(ctx, plaintext, usedCredits) {
  const [creditsPayload, subscriptionPayload] = await Promise.all([
    fetchJson(ctx, `${ctx.config.apiBase}/alpha/billing/credits`, plaintext).catch(() => null),
    fetchJson(ctx, `${ctx.config.apiBase}/alpha/billing/subscriptions`, plaintext).catch(() => null),
  ]);
  return {
    ...(creditsPayload ? readCreditsSnapshot(creditsPayload, usedCredits) : {}),
    resetAt: subscriptionPayload ? readSubscriptionResetAt(subscriptionPayload) : null,
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
        headers: authHeaders(plaintext, ctx.config),
      });
      if (!response.ok) {
        lastMessage = `Quota endpoint returned ${response.status}`;
        continue;
      }
      const payload = await response.json();
      const parsed = parseQuotaPayload(payload);
      if (!parsed) {
        lastMessage = 'Quota response was not recognized';
        continue;
      }
      const { isUsageSummary, ...quota } = parsed;
      if (isUsageSummary) {
        const billing = await fetchCommandCodeBillingSnapshot(ctx, plaintext, quota.usedCredits);
        quota.totalCredits = billing.totalCredits ?? quota.totalCredits;
        quota.remainingCredits = billing.remainingCredits ?? quota.remainingCredits;
        quota.resetAt = billing.resetAt ?? quota.resetAt;
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
