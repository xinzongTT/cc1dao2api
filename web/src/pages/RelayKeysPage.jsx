import { useEffect, useState } from 'react';
import { KeyRound, Trash2 } from 'lucide-react';
import { DataTable } from '../components/DataTable.jsx';
import { KeyCreateResult } from '../components/KeyCreateResult.jsx';
import { StatusBadge } from '../components/StatusBadge.jsx';

function numberOrUnlimited(value) {
  return value == null ? 'Unlimited' : Number(value).toLocaleString();
}

export function RelayKeysPage({ api }) {
  const [keys, setKeys] = useState([]);
  const [createdKey, setCreatedKey] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { payload } = await api.get('/admin/api/proxy-keys');
    setKeys(payload.keys || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function createRelayKey() {
    const { payload } = await api.post('/admin/api/proxy-keys', {
      name: `relay-${new Date().toISOString().slice(0, 10)}`,
      dailyTokenLimit: null,
      monthlyTokenLimit: null,
      allowedModels: [],
    });
    if (payload.ok) {
      setCreatedKey(payload.plaintextKey);
      setKeys((current) => [payload.key, ...current.filter((row) => row.id !== payload.key.id)]);
    }
  }

  const columns = [
    { key: 'name', header: 'Name' },
    { key: 'keyPrefix', header: 'Prefix', render: (row) => <code>{row.keyPrefix}</code> },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    { key: 'dailyTokenLimit', header: 'Daily limit', render: (row) => <span className="tabular">{numberOrUnlimited(row.dailyTokenLimit)}</span> },
    { key: 'monthlyTokenLimit', header: 'Monthly limit', render: (row) => <span className="tabular">{numberOrUnlimited(row.monthlyTokenLimit)}</span> },
    { key: 'allowedModels', header: 'Allowed models', render: (row) => row.allowedModels?.length ? row.allowedModels.join(', ') : 'All models' },
    { key: 'lastUsedAt', header: 'Last used', render: (row) => row.lastUsedAt || 'Never' },
    {
      key: 'actions',
      header: 'Actions',
      render: () => (
        <div className="action-row">
          <button type="button" className="icon-button" aria-label="Delete relay key"><Trash2 size={16} /></button>
        </div>
      ),
    },
  ];

  return (
    <section className="page-section">
      <div className="section-header">
        <h1>Relay Keys</h1>
        <button type="button" className="primary-button compact-button" onClick={createRelayKey}>
          <KeyRound size={16} aria-hidden="true" />
          Create relay key
        </button>
      </div>
      <KeyCreateResult plaintextKey={createdKey} />
      {loading ? <div className="empty-state">Loading keys</div> : (
        <DataTable columns={columns} rows={keys} emptyTitle="No relay keys" />
      )}
    </section>
  );
}
