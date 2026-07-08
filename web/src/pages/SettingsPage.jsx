import { useEffect, useState } from 'react';
import { StatusBadge } from '../components/StatusBadge.jsx';

export function SettingsPage({ api }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get('/admin/api/settings').then(({ payload }) => setData(payload));
  }, []);

  if (!data) return <div className="empty-state">Loading settings</div>;

  return (
    <section className="page-section">
      <div className="section-header"><h1>Settings</h1></div>
      <div className="settings-grid">
        <div className="setting-row">
          <span>Quota refresh interval</span>
          <strong className="tabular">{data.settings.quotaRefreshIntervalMs} ms</strong>
        </div>
        <div className="setting-row">
          <span>Recent event retention</span>
          <strong className="tabular">{data.settings.recentEventRetentionDays} days</strong>
        </div>
        <div className="setting-row">
          <span>Encryption key</span>
          <StatusBadge status={data.environment.encryptionKeyConfigured ? 'enabled' : 'failed'} />
        </div>
        <div className="setting-row">
          <span>Database path</span>
          <code>{data.environment.databasePath}</code>
        </div>
      </div>
    </section>
  );
}
