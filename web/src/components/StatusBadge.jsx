const labels = {
  healthy: '正常',
  enabled: '已启用',
  success: '成功',
  unknown: '未知',
  stale: '需刷新',
  failed: '失败',
  invalid: '无效',
  limited: '受限',
  degraded: '异常',
  disabled: '已禁用',
};

export function statusText(status) {
  const normalized = String(status || 'unknown').toLowerCase();
  return labels[normalized] || '未知';
}

export function StatusBadge({ status }) {
  const normalized = String(status || 'unknown').toLowerCase();
  return <span className={`status-badge status-${normalized}`}>{statusText(status)}</span>;
}
