import { useEffect, useState } from 'react';
import { KpiCard } from '../components/KpiCard.jsx';
import { TrendChart } from '../components/TrendChart.jsx';
import { DataTable } from '../components/DataTable.jsx';
import { statusText } from '../components/StatusBadge.jsx';

export function DashboardPage({ api }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get('/admin/api/dashboard').then(({ payload }) => setData(payload));
  }, []);

  if (!data) return <div className="empty-state">加载仪表盘中</div>;

  return (
    <section className="page-section">
      <div className="section-header"><h1>仪表盘</h1></div>
      <div className="kpi-grid">
        <KpiCard label="总请求数" value={data.kpis.totalRequests.toLocaleString()} />
        <KpiCard label="今日令牌" value={data.kpis.todayTokens.toLocaleString()} tone="success" />
        <KpiCard label="成功率" value={`${Math.round(data.kpis.successRate * 100)}%`} />
        <KpiCard label="可用上游密钥" value={data.kpis.availableUpstreamKeys} />
        <KpiCard label="额度未知密钥" value={data.kpis.unknownQuotaKeys} tone="warning" />
        <KpiCard label="最近错误" value={data.kpis.recentErrors} tone="danger" />
      </div>
      <TrendChart rows={data.tokenTrend} />
      <DataTable
        columns={[
          { key: 'name', header: '上游' },
          { key: 'quotaStatus', header: '额度', render: (row) => statusText(row.quotaStatus) },
          { key: 'remainingTokens', header: '剩余令牌', render: (row) => row.remainingTokens?.toLocaleString?.() || '未知' },
        ]}
        rows={data.upstreamQuota || []}
        emptyTitle="暂无上游额度数据"
      />
    </section>
  );
}
