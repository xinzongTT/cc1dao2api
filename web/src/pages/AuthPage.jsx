import { useState } from 'react';
import { Eye, EyeOff, ShieldCheck } from 'lucide-react';

export function AuthPage({ mode = 'login', onLogin, onInit }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const isInit = mode === 'init';

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const action = isInit ? onInit : onLogin;
      const result = await action({ username, password });
      if (result?.ok === false) {
        setError(result.error?.message || 'Request failed');
      }
    } catch (err) {
      setError(err.message || 'Request failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-screen">
      <form className="auth-panel" onSubmit={handleSubmit}>
        <div className="auth-icon" aria-hidden="true">
          <ShieldCheck size={24} strokeWidth={1.8} />
        </div>
        <h1>{isInit ? 'Initialize admin' : 'Admin sign in'}</h1>
        <label className="field">
          <span>Username</span>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label className="field">
          <span>Password</span>
          <div className="password-row">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={isInit ? 'new-password' : 'current-password'}
              minLength={8}
              required
            />
            <button
              type="button"
              className="icon-button"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              onClick={() => setShowPassword((value) => !value)}
            >
              {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
            </button>
          </div>
        </label>
        {error ? <div className="form-error" role="alert">{error}</div> : null}
        <button type="submit" className="primary-button" disabled={loading}>
          {loading ? 'Signing in' : isInit ? 'Create admin' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
