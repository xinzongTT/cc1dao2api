/* @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RelayKeysPage } from '../../web/src/pages/RelayKeysPage.jsx';
import { UpstreamKeysPage } from '../../web/src/pages/UpstreamKeysPage.jsx';

function fakeApi(fixtures = {}) {
  return {
    get: vi.fn(async (path) => {
      if (path === '/admin/api/upstream-keys') return { payload: { ok: true, keys: fixtures.upstreamKeys || [] } };
      if (path === '/admin/api/proxy-keys') return { payload: { ok: true, keys: fixtures.proxyKeys || [] } };
      return { payload: { ok: true } };
    }),
    post: vi.fn(async (path, body) => {
      if (path === '/admin/api/upstream-keys') {
        return { payload: { ok: true, key: fixtures.createUpstreamKey || { id: 2, name: body.name, maskedKey: 'user_new...key', quotaStatus: 'unknown' } } };
      }
      if (path === '/admin/api/proxy-keys') {
        return { payload: { ok: true, ...(fixtures.createProxyKey || {}) } };
      }
      return { payload: { ok: true } };
    }),
    patch: vi.fn(async () => ({ payload: { ok: true } })),
    delete: vi.fn(async () => ({ payload: { ok: true } })),
  };
}

describe('key management pages', () => {
  it('shows upstream quota unknown explicitly', async () => {
    render(<UpstreamKeysPage api={fakeApi({ upstreamKeys: [{ id: 1, name: 'main', maskedKey: 'user_abcd...wxyz', quotaStatus: 'unknown' }] })} />);
    expect(await screen.findByText('额度未知')).toBeInTheDocument();
  });

  it('localizes upstream quota status values', async () => {
    render(<UpstreamKeysPage api={fakeApi({ upstreamKeys: [{ id: 2, name: 'main', maskedKey: 'user_abcd...wxyz', quotaStatus: 'success' }] })} />);
    expect(await screen.findByText('成功')).toBeInTheDocument();
  });

  it('shows used token snapshots when remaining quota is unavailable', async () => {
    render(<UpstreamKeysPage api={fakeApi({ upstreamKeys: [{ id: 3, name: 'main', maskedKey: 'user_abcd...wxyz', quotaStatus: 'success', quotaUsedTokens: 260859401 }] })} />);
    expect(await screen.findByText('已用 260,859,401 令牌')).toBeInTheDocument();
  });

  it('shows compact monthly credit usage snapshots', async () => {
    render(<UpstreamKeysPage api={fakeApi({
      upstreamKeys: [{
        id: 4,
        name: 'main',
        maskedKey: 'user_abcd...wxyz',
        quotaStatus: 'success',
        quotaUsedTokens: 260859401,
        quotaUsedCredits: 2.3478,
        quotaRemainingCredits: 7.6489,
        quotaTotalCredits: 9.9967,
        quotaResetAt: '2026-08-04T11:28:34.000Z',
      }],
    })} />);
    expect(await screen.findByText('$2.35 / $10.00 · 23%')).toBeInTheDocument();
    expect(screen.getByText('8月4日重置 · 已用 260,859,401 令牌')).toBeInTheDocument();
  });

  it('localizes upstream error messages from persisted quota checks', async () => {
    render(<UpstreamKeysPage api={fakeApi({
      upstreamKeys: [{
        id: 3,
        name: 'main',
        maskedKey: 'user_abcd...wxyz',
        quotaStatus: 'failed',
        lastErrorMessage: 'Quota endpoint returned 404',
      }],
    })} />);

    expect(await screen.findByText('额度接口返回 404')).toBeInTheDocument();
    expect(screen.queryByText('Quota endpoint returned 404')).not.toBeInTheDocument();
  });

  it('creates an upstream key from the page form', async () => {
    const api = fakeApi();
    render(<UpstreamKeysPage api={api} />);

    await userEvent.click(await screen.findByRole('button', { name: '添加密钥' }));
    await userEvent.type(screen.getByLabelText('名称'), 'main');
    await userEvent.type(screen.getByLabelText('上游密钥'), 'user_abcdefghijklmnopqrstuvwxyz');
    await userEvent.click(screen.getByRole('button', { name: '保存上游密钥' }));

    expect(api.post).toHaveBeenCalledWith('/admin/api/upstream-keys', {
      name: 'main',
      key: 'user_abcdefghijklmnopqrstuvwxyz',
      notes: '',
    });
    expect(await screen.findByText('main')).toBeInTheDocument();
  });

  it('refreshes upstream quota from the row action', async () => {
    const api = fakeApi({ upstreamKeys: [{ id: 7, name: 'main', maskedKey: 'user_abcd...wxyz', quotaStatus: 'unknown' }] });
    render(<UpstreamKeysPage api={api} />);
    await screen.findByText('main');

    await userEvent.click(screen.getByRole('button', { name: '刷新额度' }));

    expect(api.post).toHaveBeenCalledWith('/admin/api/upstream-keys/7/refresh-quota');
  });

  it('shows relay plaintext key once after creation', async () => {
    const api = fakeApi({
      createProxyKey: { plaintextKey: 'sk-ccp_abc', key: { id: 1, name: 'dev', keyPrefix: 'sk-ccp_ab', status: 'enabled', allowedModels: [] } },
    });
    render(<RelayKeysPage api={api} />);
    await userEvent.click(await screen.findByRole('button', { name: '创建中转密钥' }));
    await userEvent.type(screen.getByLabelText('名称'), 'dev');
    await userEvent.clear(screen.getByLabelText('日额度'));
    await userEvent.type(screen.getByLabelText('日额度'), '1000');
    await userEvent.clear(screen.getByLabelText('月额度'));
    await userEvent.type(screen.getByLabelText('月额度'), '5000');
    await userEvent.type(screen.getByLabelText('允许模型'), 'deepseek/deepseek-v4-flash,claude-4');
    await userEvent.click(screen.getByRole('button', { name: '保存中转密钥' }));
    expect(api.post).toHaveBeenCalledWith('/admin/api/proxy-keys', {
      name: 'dev',
      dailyTokenLimit: 1000,
      monthlyTokenLimit: 5000,
      allowedModels: ['deepseek/deepseek-v4-flash', 'claude-4'],
    });
    expect(await screen.findByText('sk-ccp_abc')).toBeInTheDocument();
  });
});
