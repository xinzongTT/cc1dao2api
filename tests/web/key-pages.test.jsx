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
    post: vi.fn(async () => ({ payload: { ok: true, ...(fixtures.createProxyKey || {}) } })),
    patch: vi.fn(async () => ({ payload: { ok: true } })),
    delete: vi.fn(async () => ({ payload: { ok: true } })),
  };
}

describe('key management pages', () => {
  it('shows upstream quota unknown explicitly', async () => {
    render(<UpstreamKeysPage api={fakeApi({ upstreamKeys: [{ id: 1, name: 'main', maskedKey: 'user_abcd...wxyz', quotaStatus: 'unknown' }] })} />);
    expect(await screen.findByText('Quota unknown')).toBeInTheDocument();
  });

  it('shows relay plaintext key once after creation', async () => {
    const api = fakeApi({
      createProxyKey: { plaintextKey: 'sk-ccp_abc', key: { id: 1, name: 'dev', keyPrefix: 'sk-ccp_ab', status: 'enabled', allowedModels: [] } },
    });
    render(<RelayKeysPage api={api} />);
    await userEvent.click(screen.getByRole('button', { name: 'Create relay key' }));
    expect(await screen.findByText('sk-ccp_abc')).toBeInTheDocument();
  });
});
