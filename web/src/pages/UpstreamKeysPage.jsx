import { useEffect, useState } from 'react';
import { Plus, Power, RefreshCcw, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog.jsx';
import { DataTable } from '../components/DataTable.jsx';
import { StatusBadge, statusText } from '../components/StatusBadge.jsx';
import { adminErrorMessage, adminRuntimeErrorMessage } from '../lib/errors.js';

function quotaText(key) {
  if (key.quotaStatus === 'unknown') return '额度未知';
  if (key.quotaRemainingTokens != null) return `剩余 ${key.quotaRemainingTokens.toLocaleString()} 令牌`;
  if (key.quotaUsedTokens != null) return `已用 ${key.quotaUsedTokens.toLocaleString()} 令牌`;
  if (key.quotaTotalTokens != null) return `总量 ${key.quotaTotalTokens.toLocaleString()} 令牌`;
  return statusText(key.quotaStatus);
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
      setError(adminErrorMessage(payload.error));
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
    { key: 'name', header: '名称' },
    { key: 'maskedKey', header: '掩码密钥', render: (row) => <code>{row.maskedKey}</code> },
    { key: 'healthStatus', header: '健康状态', render: (row) => <StatusBadge status={row.healthStatus} /> },
    { key: 'quotaStatus', header: '额度', render: (row) => <span>{quotaText(row)}</span> },
    { key: 'lastQuotaCheckedAt', header: '最近刷新', render: (row) => row.lastQuotaCheckedAt || '从未' },
    { key: 'lastSuccessAt', header: '最近成功', render: (row) => row.lastSuccessAt || '从未' },
    { key: 'lastErrorMessage', header: '最近错误', render: (row) => adminRuntimeErrorMessage(row.lastErrorMessage) },
    {
      key: 'actions',
      header: '操作',
      render: (row) => (
        <div className="action-row">
          <button type="button" className="icon-button" aria-label="刷新额度" onClick={() => refreshQuota(row)}><RefreshCcw size={16} /></button>
          <button type="button" className="icon-button" aria-label={row.adminEnabled ? '禁用上游密钥' : '启用上游密钥'} onClick={() => toggleRouting(row)}><Power size={16} /></button>
          <button type="button" className="icon-button" aria-label="删除上游密钥" onClick={() => setConfirmTarget(row)}><Trash2 size={16} /></button>
        </div>
      ),
    },
  ];

  return (
    <section className="page-section">
      <div className="section-header">
        <h1>上游密钥</h1>
        <button type="button" className="primary-button compact-button" onClick={() => setFormOpen((value) => !value)}>
          <Plus size={16} aria-hidden="true" />
          添加密钥
        </button>
      </div>
      {formOpen ? (
        <form className="inline-form" onSubmit={createKey}>
          <label className="field">
            <span>名称</span>
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          </label>
          <label className="field">
            <span>上游密钥</span>
            <input value={form.key} onChange={(event) => setForm({ ...form, key: event.target.value })} required />
          </label>
          <label className="field">
            <span>备注</span>
            <input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </label>
          {error ? <div className="form-error" role="alert">{error}</div> : null}
          <div className="form-actions">
            <button type="button" className="secondary-button" onClick={() => setFormOpen(false)}>取消</button>
            <button type="submit" className="primary-button compact-button">保存上游密钥</button>
          </div>
        </form>
      ) : null}
      {loading ? <div className="empty-state">加载密钥中</div> : (
        <DataTable columns={columns} rows={keys} emptyTitle="暂无上游密钥" />
      )}
      {confirmTarget ? (
        <ConfirmDialog
          title="删除上游密钥"
          confirmLabel="删除"
          onCancel={() => setConfirmTarget(null)}
          onConfirm={deleteKey}
        >
          删除 {confirmTarget.name}？
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
