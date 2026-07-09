/* @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DashboardPage } from '../../web/src/pages/DashboardPage.jsx';
import { SettingsPage } from '../../web/src/pages/SettingsPage.jsx';
import { UsagePage } from '../../web/src/pages/UsagePage.jsx';

function fakeDashboardApi() {
  return {
    get: vi.fn(async () => ({
      payload: {
        ok: true,
        kpis: { totalRequests: 10, todayTokens: 33, successRate: 0.9, availableUpstreamKeys: 2, unknownQuotaKeys: 1, recentErrors: 1 },
        tokenTrend: [{ bucket_start: '2026-07-08T00:00:00.000Z', total_tokens: 33 }],
        upstreamQuota: [{ id: 1, name: 'main', quotaStatus: 'success', remainingTokens: null }],
        recentErrors: [],
        recentRequests: [],
      },
    })),
  };
}

function fakeSettingsApi(environment) {
  return {
    get: vi.fn(async () => ({
      payload: {
        ok: true,
        settings: { quotaRefreshIntervalMs: '300000', recentEventRetentionDays: '7', autoQuotaRefreshEnabled: 'true' },
        environment,
      },
    })),
  };
}

describe('dashboard usage and settings pages', () => {
  it('renders dashboard kpis and token trend', async () => {
    render(<DashboardPage api={fakeDashboardApi()} />);
    expect(await screen.findByText('今日令牌')).toBeInTheDocument();
    expect(screen.getByText('可用上游密钥')).toBeInTheDocument();
    expect(screen.getByText('成功')).toBeInTheDocument();
  });

  it('renders settings environment state without secret values', async () => {
    render(<SettingsPage api={fakeSettingsApi({ encryptionKeyConfigured: true, databasePath: '/app/data/cc-proxy.sqlite' })} />);
    expect(await screen.findByText('/app/data/cc-proxy.sqlite')).toBeInTheDocument();
    expect(screen.queryByText(/user_/)).not.toBeInTheDocument();
  });

  it('renders usage table rows', async () => {
    const api = {
      get: vi.fn(async () => ({
        payload: { ok: true, rows: [{ id: 1, bucket_start: '2026-07-08T00:00:00.000Z', model: 'deepseek/deepseek-v4-flash', total_tokens: 44, request_count: 2 }] },
      })),
    };
    render(<UsagePage api={api} />);
    expect(await screen.findByText('deepseek/deepseek-v4-flash')).toBeInTheDocument();
  });
});
