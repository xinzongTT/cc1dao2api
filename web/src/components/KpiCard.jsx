export function KpiCard({ label, value, tone = 'neutral' }) {
  return (
    <div className={`kpi-card tone-${tone}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value tabular">{value}</div>
    </div>
  );
}
