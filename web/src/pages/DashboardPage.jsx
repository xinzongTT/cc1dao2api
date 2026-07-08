import { useEffect, useState } from 'react';
import { KpiCard } from '../components/KpiCard.jsx';
import { TrendChart } from '../components/TrendChart.jsx';
import { DataTable } from '../components/DataTable.jsx';

export function DashboardPage({ api }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get('/admin/api/dashboard').then(({ payload }) => setData(payload));
  }, []);

  if (!data) return <div className="empty-state">Loading dashboard</div>;

  return (
    <section className="page-section">
      <div className="section-header"><h1>Dashboard</h1></div>
      <div className="kpi-grid">
        <KpiCard label="Total requests" value={data.kpis.totalRequests.toLocaleString()} />
        <KpiCard label="Today tokens" value={data.kpis.todayTokens.toLocaleString()} tone="success" />
        <KpiCard label="Success rate" value={`${Math.round(data.kpis.successRate * 100)}%`} />
        <KpiCard label="Available upstream keys" value={data.kpis.availableUpstreamKeys} />
        <KpiCard label="Unknown quota keys" value={data.kpis.unknownQuotaKeys} tone="warning" />
        <KpiCard label="Recent errors" value={data.kpis.recentErrors} tone="danger" />
      </div>
      <TrendChart rows={data.tokenTrend} />
      <DataTable
        columns={[
          { key: 'name', header: 'Upstream' },
          { key: 'quotaStatus', header: 'Quota' },
          { key: 'remainingTokens', header: 'Remaining', render: (row) => row.remainingTokens?.toLocaleString?.() || 'Unknown' },
        ]}
        rows={data.upstreamQuota || []}
        emptyTitle="No upstream quota data"
      />
    </section>
  );
}
