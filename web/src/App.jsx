import { useEffect, useState } from 'react';
import { AppShell } from './components/AppShell.jsx';
import { AuthPage } from './pages/AuthPage.jsx';
import { api } from './lib/api.js';
import { UpstreamKeysPage } from './pages/UpstreamKeysPage.jsx';
import { RelayKeysPage } from './pages/RelayKeysPage.jsx';
import { DashboardPage } from './pages/DashboardPage.jsx';
import { UsagePage } from './pages/UsagePage.jsx';
import { SettingsPage } from './pages/SettingsPage.jsx';

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
};

function renderPage(page) {
  if (page === 'dashboard') return <DashboardPage api={api} />;
  if (page === 'upstream') return <UpstreamKeysPage api={api} />;
  if (page === 'relay') return <RelayKeysPage api={api} />;
  if (page === 'usage') return <UsagePage api={api} />;
  if (page === 'settings') return <SettingsPage api={api} />;
  return <PlaceholderPage title={titles[page]} />;
}

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
      {renderPage(page)}
    </AppShell>
  );
}
