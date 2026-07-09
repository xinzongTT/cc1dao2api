/* @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AuthPage } from '../../web/src/pages/AuthPage.jsx';

vi.mock('../../web/src/lib/api.js', () => ({
  api: {
    session: vi.fn(),
    init: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    get: vi.fn().mockResolvedValue({
      payload: {
        ok: true,
        kpis: {
          totalRequests: 0,
          todayTokens: 0,
          successRate: 0,
          availableUpstreamKeys: 0,
          unknownQuotaKeys: 0,
          recentErrors: 0,
        },
        tokenTrend: [],
        upstreamQuota: [],
        recentErrors: [],
        recentRequests: [],
      },
    }),
  },
}));

describe('AuthPage', () => {
  it('submits login with visible labels and loading state', async () => {
    const login = vi.fn().mockResolvedValue({ ok: true });
    render(<AuthPage mode="login" onLogin={login} />);
    await userEvent.type(screen.getByLabelText('Username'), 'admin');
    await userEvent.type(screen.getByLabelText('Password'), 'pass123456');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(login).toHaveBeenCalledWith({ username: 'admin', password: 'pass123456' });
  });
});

describe('App auth flow', () => {
  it('shows initialization flow when no admin exists', async () => {
    const { api } = await import('../../web/src/lib/api.js');
    const { App } = await import('../../web/src/App.jsx');
    api.session.mockResolvedValueOnce({ payload: { ok: false, needsInit: true } });
    api.init.mockResolvedValueOnce({ payload: { ok: true, admin: { id: 1, username: 'admin' } } });
    api.login.mockResolvedValueOnce({ payload: { ok: true, admin: { id: 1, username: 'admin' }, csrfToken: 'csrf' } });

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Initialize admin' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Username'), 'admin');
    await userEvent.type(screen.getByLabelText('Password'), 'pass123456');
    await userEvent.click(screen.getByRole('button', { name: 'Create admin' }));

    expect(api.init).toHaveBeenCalledWith({ username: 'admin', password: 'pass123456' });
    expect(api.login).toHaveBeenCalledWith({ username: 'admin', password: 'pass123456' });
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  });
});
