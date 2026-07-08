import { useEffect, useState } from 'react';
import { AppShell } from './components/AppShell.jsx';
import { AuthPage } from './pages/AuthPage.jsx';
import { api } from './lib/api.js';

function PlaceholderPage({ title }) {
  return (
    <section className="page-section">
      <div className="section-header">
        <h1>{title}</h1>
      </div>
      <div className="empty-state">No data loaded yet.</div>
    </section>
  );
}

const titles = {
  dashboard: 'Dashboard',
  upstream: 'Upstream Keys',
  relay: 'Relay Keys',
  usage: 'Usage Analytics',
  settings: 'Settings',
};

export function App() {
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(true);
  const [page, setPage] = useState('dashboard');

  useEffect(() => {
    api.session().then(({ payload }) => {
      setSession(payload?.ok ? payload.admin : null);
    }).finally(() => setChecking(false));
  }, []);

  async function login(credentials) {
    const { payload } = await api.login(credentials);
    if (payload.ok) setSession(payload.admin);
    return payload;
  }

  async function logout() {
    await api.logout();
    setSession(null);
  }

  if (checking) return <div className="loading-screen">Loading</div>;
  if (!session) return <AuthPage mode="login" onLogin={login} />;

  return (
    <AppShell activePage={page} onNavigate={setPage} onLogout={logout}>
      <PlaceholderPage title={titles[page]} />
    </AppShell>
  );
}
