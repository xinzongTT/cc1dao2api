const labels = {
  healthy: 'Healthy',
  enabled: 'Enabled',
  success: 'Success',
  unknown: 'Unknown',
  stale: 'Stale',
  failed: 'Failed',
  invalid: 'Invalid',
  limited: 'Limited',
  degraded: 'Degraded',
  disabled: 'Disabled',
};

export function StatusBadge({ status }) {
  const normalized = String(status || 'unknown').toLowerCase();
  return <span className={`status-badge status-${normalized}`}>{labels[normalized] || status}</span>;
}
