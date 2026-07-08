export function TrendChart({ rows = [] }) {
  const points = rows.map((row, index) => ({ x: index, y: Number(row.total_tokens || 0) }));
  const max = Math.max(1, ...points.map((point) => point.y));
  const path = points.map((point, index) => {
    const x = points.length <= 1 ? 0 : (point.x / (points.length - 1)) * 100;
    const y = 42 - (point.y / max) * 36;
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ');

  return (
    <div className="chart-panel">
      <div className="chart-header">
        <span>Token trend</span>
        <strong className="tabular">{points.reduce((sum, point) => sum + point.y, 0).toLocaleString()}</strong>
      </div>
      <svg viewBox="0 0 100 48" role="img" aria-label="Token trend">
        <path d={path || 'M 0 42'} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}
