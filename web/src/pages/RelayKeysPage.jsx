import { useEffect, useState } from 'react';
import { KeyRound, Power, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog.jsx';
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
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ name: '', dailyTokenLimit: '', monthlyTokenLimit: '', allowedModels: '' });
  const [error, setError] = useState('');
  const [confirmTarget, setConfirmTarget] = useState(null);

  async function load() {
    setLoading(true);
    const { payload } = await api.get('/admin/api/proxy-keys');
    setKeys(payload.keys || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function parseLimit(value) {
    const trimmed = String(value || '').trim();
    return trimmed ? Number(trimmed) : null;
  }

  function parseAllowedModels(value) {
    return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
  }

  async function createRelayKey(event) {
    event.preventDefault();
    setError('');
    const { payload } = await api.post('/admin/api/proxy-keys', {
      name: form.name.trim(),
      dailyTokenLimit: parseLimit(form.dailyTokenLimit),
      monthlyTokenLimit: parseLimit(form.monthlyTokenLimit),
      allowedModels: parseAllowedModels(form.allowedModels),
    });
    if (payload.ok) {
      setCreatedKey(payload.plaintextKey);
      setKeys((current) => [payload.key, ...current.filter((row) => row.id !== payload.key.id)]);
      setForm({ name: '', dailyTokenLimit: '', monthlyTokenLimit: '', allowedModels: '' });
      setFormOpen(false);
    } else {
      setError(payload.error?.message || 'Request failed');
    }
  }

  async function toggleStatus(row) {
    const nextStatus = row.status === 'enabled' ? 'disabled' : 'enabled';
    const { payload } = await api.patch(`/admin/api/proxy-keys/${row.id}`, { status: nextStatus });
    if (payload.ok) {
      setKeys((current) => current.map((item) => (item.id === payload.key.id ? payload.key : item)));
    }
  }

  async function deleteKey() {
    if (!confirmTarget) return;
    const target = confirmTarget;
    setConfirmTarget(null);
    await api.delete(`/admin/api/proxy-keys/${target.id}`);
    setKeys((current) => current.filter((row) => row.id !== target.id));
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
      render: (row) => (
        <div className="action-row">
          <button type="button" className="icon-button" aria-label={row.status === 'enabled' ? 'Disable relay key' : 'Enable relay key'} onClick={() => toggleStatus(row)}><Power size={16} /></button>
          <button type="button" className="icon-button" aria-label="Delete relay key" onClick={() => setConfirmTarget(row)}><Trash2 size={16} /></button>
        </div>
      ),
    },
  ];

  return (
    <section className="page-section">
      <div className="section-header">
        <h1>Relay Keys</h1>
        <button type="button" className="primary-button compact-button" onClick={() => setFormOpen((value) => !value)}>
          <KeyRound size={16} aria-hidden="true" />
          Create relay key
        </button>
      </div>
      {formOpen ? (
        <form className="inline-form" onSubmit={createRelayKey}>
          <label className="field">
            <span>Name</span>
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          </label>
          <label className="field">
            <span>Daily limit</span>
            <input type="number" min="1" value={form.dailyTokenLimit} onChange={(event) => setForm({ ...form, dailyTokenLimit: event.target.value })} />
          </label>
          <label className="field">
            <span>Monthly limit</span>
            <input type="number" min="1" value={form.monthlyTokenLimit} onChange={(event) => setForm({ ...form, monthlyTokenLimit: event.target.value })} />
          </label>
          <label className="field">
            <span>Allowed models</span>
            <input value={form.allowedModels} onChange={(event) => setForm({ ...form, allowedModels: event.target.value })} />
          </label>
          {error ? <div className="form-error" role="alert">{error}</div> : null}
          <div className="form-actions">
            <button type="button" className="secondary-button" onClick={() => setFormOpen(false)}>Cancel</button>
            <button type="submit" className="primary-button compact-button">Save relay key</button>
          </div>
        </form>
      ) : null}
      <KeyCreateResult plaintextKey={createdKey} />
      {loading ? <div className="empty-state">Loading keys</div> : (
        <DataTable columns={columns} rows={keys} emptyTitle="No relay keys" />
      )}
      {confirmTarget ? (
        <ConfirmDialog
          title="Delete relay key"
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
