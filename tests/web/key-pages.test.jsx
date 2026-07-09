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
    expect(await screen.findByText('Quota unknown')).toBeInTheDocument();
  });

  it('creates an upstream key from the page form', async () => {
    const api = fakeApi();
    render(<UpstreamKeysPage api={api} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Add key' }));
    await userEvent.type(screen.getByLabelText('Name'), 'main');
    await userEvent.type(screen.getByLabelText('User key'), 'user_abcdefghijklmnopqrstuvwxyz');
    await userEvent.click(screen.getByRole('button', { name: 'Save upstream key' }));

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

    await userEvent.click(screen.getByRole('button', { name: 'Refresh quota' }));

    expect(api.post).toHaveBeenCalledWith('/admin/api/upstream-keys/7/refresh-quota');
  });

  it('shows relay plaintext key once after creation', async () => {
    const api = fakeApi({
      createProxyKey: { plaintextKey: 'sk-ccp_abc', key: { id: 1, name: 'dev', keyPrefix: 'sk-ccp_ab', status: 'enabled', allowedModels: [] } },
    });
    render(<RelayKeysPage api={api} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Create relay key' }));
    await userEvent.type(screen.getByLabelText('Name'), 'dev');
    await userEvent.clear(screen.getByLabelText('Daily limit'));
    await userEvent.type(screen.getByLabelText('Daily limit'), '1000');
    await userEvent.clear(screen.getByLabelText('Monthly limit'));
    await userEvent.type(screen.getByLabelText('Monthly limit'), '5000');
    await userEvent.type(screen.getByLabelText('Allowed models'), 'deepseek/deepseek-v4-flash,claude-4');
    await userEvent.click(screen.getByRole('button', { name: 'Save relay key' }));
    expect(api.post).toHaveBeenCalledWith('/admin/api/proxy-keys', {
      name: 'dev',
      dailyTokenLimit: 1000,
      monthlyTokenLimit: 5000,
      allowedModels: ['deepseek/deepseek-v4-flash', 'claude-4'],
    });
    expect(await screen.findByText('sk-ccp_abc')).toBeInTheDocument();
  });
});
