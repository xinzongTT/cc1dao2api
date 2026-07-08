/* @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AuthPage } from '../../web/src/pages/AuthPage.jsx';

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
