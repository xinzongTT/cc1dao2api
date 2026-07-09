import { useEffect, useState } from 'react';
import { StatusBadge } from '../components/StatusBadge.jsx';

export function SettingsPage({ api }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get('/admin/api/settings').then(({ payload }) => setData(payload));
  }, []);

  if (!data) return <div className="empty-state">加载设置中</div>;

  return (
    <section className="page-section">
      <div className="section-header"><h1>设置</h1></div>
      <div className="settings-grid">
        <div className="setting-row">
          <span>额度刷新间隔</span>
          <strong className="tabular">{data.settings.quotaRefreshIntervalMs} 毫秒</strong>
        </div>
        <div className="setting-row">
          <span>近期事件保留</span>
          <strong className="tabular">{data.settings.recentEventRetentionDays} 天</strong>
        </div>
        <div className="setting-row">
          <span>加密密钥</span>
          <StatusBadge status={data.environment.encryptionKeyConfigured ? 'enabled' : 'failed'} />
        </div>
        <div className="setting-row">
          <span>数据库路径</span>
          <code>{data.environment.databasePath}</code>
        </div>
      </div>
    </section>
  );
}
