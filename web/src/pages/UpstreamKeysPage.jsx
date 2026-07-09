import { useEffect, useState } from 'react';
import { Plus, Power, RefreshCcw, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog.jsx';
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
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ name: '', key: '', notes: '' });
  const [error, setError] = useState('');
  const [confirmTarget, setConfirmTarget] = useState(null);

  async function load() {
    setLoading(true);
    const { payload } = await api.get('/admin/api/upstream-keys');
    setKeys(payload.keys || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function refreshQuota(row) {
    await api.post(`/admin/api/upstream-keys/${row.id}/refresh-quota`);
    await load();
  }

  async function createKey(event) {
    event.preventDefault();
    setError('');
    const { payload } = await api.post('/admin/api/upstream-keys', {
      name: form.name.trim(),
      key: form.key.trim(),
      notes: form.notes.trim(),
    });
    if (!payload.ok) {
      setError(payload.error?.message || 'Request failed');
      return;
    }
    setKeys((current) => [payload.key, ...current.filter((row) => row.id !== payload.key.id)]);
    setForm({ name: '', key: '', notes: '' });
    setFormOpen(false);
  }

  async function toggleRouting(row) {
    const { payload } = await api.patch(`/admin/api/upstream-keys/${row.id}`, { adminEnabled: !row.adminEnabled });
    if (payload.ok) {
      setKeys((current) => current.map((item) => (item.id === payload.key.id ? payload.key : item)));
    }
  }

  async function deleteKey() {
    if (!confirmTarget) return;
    const target = confirmTarget;
    setConfirmTarget(null);
    await api.delete(`/admin/api/upstream-keys/${target.id}`);
    setKeys((current) => current.filter((row) => row.id !== target.id));
  }

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
      render: (row) => (
        <div className="action-row">
          <button type="button" className="icon-button" aria-label="Refresh quota" onClick={() => refreshQuota(row)}><RefreshCcw size={16} /></button>
          <button type="button" className="icon-button" aria-label={row.adminEnabled ? 'Disable upstream key' : 'Enable upstream key'} onClick={() => toggleRouting(row)}><Power size={16} /></button>
          <button type="button" className="icon-button" aria-label="Delete upstream key" onClick={() => setConfirmTarget(row)}><Trash2 size={16} /></button>
        </div>
      ),
    },
  ];

  return (
    <section className="page-section">
      <div className="section-header">
        <h1>Upstream Keys</h1>
        <button type="button" className="primary-button compact-button" onClick={() => setFormOpen((value) => !value)}>
          <Plus size={16} aria-hidden="true" />
          Add key
        </button>
      </div>
      {formOpen ? (
        <form className="inline-form" onSubmit={createKey}>
          <label className="field">
            <span>Name</span>
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          </label>
          <label className="field">
            <span>User key</span>
            <input value={form.key} onChange={(event) => setForm({ ...form, key: event.target.value })} required />
          </label>
          <label className="field">
            <span>Notes</span>
            <input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </label>
          {error ? <div className="form-error" role="alert">{error}</div> : null}
          <div className="form-actions">
            <button type="button" className="secondary-button" onClick={() => setFormOpen(false)}>Cancel</button>
            <button type="submit" className="primary-button compact-button">Save upstream key</button>
          </div>
        </form>
      ) : null}
      {loading ? <div className="empty-state">Loading keys</div> : (
        <DataTable columns={columns} rows={keys} emptyTitle="No upstream keys" />
      )}
      {confirmTarget ? (
        <ConfirmDialog
          title="Delete upstream key"
          confirmLabel="Delete"
          onCancel={() => setConfirmTarget(null)}
          onConfirm={deleteKey}
        >
          Delete {confirmTarget.name}?
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
