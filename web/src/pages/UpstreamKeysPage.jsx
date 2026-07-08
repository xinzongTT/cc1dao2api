import { useEffect, useState } from 'react';
import { Plus, RefreshCcw, Trash2 } from 'lucide-react';
import { DataTable } from '../components/DataTable.jsx';
import { StatusBadge } from '../components/StatusBadge.jsx';

function quotaText(key) {
  if (key.quotaStatus === 'unknown') return 'Quota unknown';
  if (key.quotaRemainingTokens == null) return key.quotaStatus || 'Unknown';
  return `${key.quotaRemainingTokens.toLocaleString()} remaining`;
}

export function UpstreamKeysPage({ api }) {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { payload } = await api.get('/admin/api/upstream-keys');
    setKeys(payload.keys || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const columns = [
    { key: 'name', header: 'Name' },
    { key: 'maskedKey', header: 'Masked key', render: (row) => <code>{row.maskedKey}</code> },
    { key: 'healthStatus', header: 'Health', render: (row) => <StatusBadge status={row.healthStatus} /> },
    { key: 'quotaStatus', header: 'Quota', render: (row) => <span>{quotaText(row)}</span> },
    { key: 'lastQuotaCheckedAt', header: 'Last refresh', render: (row) => row.lastQuotaCheckedAt || 'Never' },
    { key: 'lastSuccessAt', header: 'Last success', render: (row) => row.lastSuccessAt || 'Never' },
    { key: 'lastErrorMessage', header: 'Last error', render: (row) => row.lastErrorMessage || 'None' },
    {
      key: 'actions',
      header: 'Actions',
      render: () => (
        <div className="action-row">
          <button type="button" className="icon-button" aria-label="Refresh quota"><RefreshCcw size={16} /></button>
          <button type="button" className="icon-button" aria-label="Delete upstream key"><Trash2 size={16} /></button>
        </div>
      ),
    },
  ];

  return (
    <section className="page-section">
      <div className="section-header">
        <h1>Upstream Keys</h1>
        <button type="button" className="primary-button compact-button">
          <Plus size={16} aria-hidden="true" />
          Add key
        </button>
      </div>
      {loading ? <div className="empty-state">Loading keys</div> : (
        <DataTable columns={columns} rows={keys} emptyTitle="No upstream keys" />
      )}
    </section>
  );
}
