import { BarChart3, KeyRound, LayoutDashboard, LogOut, Server, Settings } from 'lucide-react';

const nav = [
  { id: 'dashboard', label: '仪表盘', icon: LayoutDashboard },
  { id: 'upstream', label: '上游密钥', icon: Server },
  { id: 'relay', label: '中转密钥', icon: KeyRound },
  { id: 'usage', label: '用量', icon: BarChart3 },
  { id: 'settings', label: '设置', icon: Settings },
];

export function AppShell({ activePage, onNavigate, onLogout, children }) {
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="主导航">
        <div className="brand-lockup">
          <div className="brand-mark">码</div>
          <div>
            <div className="brand-title">命令码中转</div>
            <div className="brand-subtitle">中转管理</div>
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
          <span>退出登录</span>
        </button>
      </aside>
      <header className="mobile-topbar">
        <div className="brand-title">命令码中转</div>
        <select aria-label="页面" value={activePage} onChange={(event) => onNavigate(event.target.value)}>
          {nav.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </header>
      <main className="main-surface" tabIndex="-1">
        {children}
      </main>
    </div>
  );
}
