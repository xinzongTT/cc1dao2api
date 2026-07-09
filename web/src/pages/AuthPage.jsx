import { useState } from 'react';
import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { adminErrorMessage } from '../lib/errors.js';

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
        setError(adminErrorMessage(result.error));
      }
    } catch (err) {
      setError('请求失败');
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
        <h1>{isInit ? '初始化管理员' : '管理员登录'}</h1>
        <label className="field">
          <span>用户名</span>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label className="field">
          <span>密码</span>
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
              aria-label={showPassword ? '隐藏密码' : '显示密码'}
              onClick={() => setShowPassword((value) => !value)}
            >
              {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
            </button>
          </div>
        </label>
        {error ? <div className="form-error" role="alert">{error}</div> : null}
        <button type="submit" className="primary-button" disabled={loading}>
          {loading ? (isInit ? '创建中' : '登录中') : isInit ? '创建管理员' : '登录'}
        </button>
      </form>
    </main>
  );
}
