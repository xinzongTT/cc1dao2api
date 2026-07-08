import { BarChart3, KeyRound, LayoutDashboard, LogOut, Server, Settings } from 'lucide-react';

const nav = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'upstream', label: 'Upstream Keys', icon: Server },
  { id: 'relay', label: 'Relay Keys', icon: KeyRound },
  { id: 'usage', label: 'Usage', icon: BarChart3 },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function AppShell({ activePage, onNavigate, onLogout, children }) {
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary">
        <div className="brand-lockup">
          <div className="brand-mark">CC</div>
          <div>
            <div className="brand-title">CommandCode Proxy</div>
            <div className="brand-subtitle">Relay admin</div>
          </div>
        </div>
        <nav className="nav-list">
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={`nav-item ${activePage === item.id ? 'is-active' : ''}`}
                onClick={() => onNavigate(item.id)}
              >
                <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <button type="button" className="nav-item logout-button" onClick={onLogout}>
          <LogOut size={18} strokeWidth={1.8} aria-hidden="true" />
          <span>Sign out</span>
        </button>
      </aside>
      <header className="mobile-topbar">
        <div className="brand-title">CommandCode Proxy</div>
        <select aria-label="Page" value={activePage} onChange={(event) => onNavigate(event.target.value)}>
          {nav.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </header>
      <main className="main-surface" tabIndex="-1">
        {children}
      </main>
    </div>
  );
}
