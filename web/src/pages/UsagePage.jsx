import { useEffect, useState } from 'react';
import { DataTable } from '../components/DataTable.jsx';

export function UsagePage({ api }) {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    api.get('/admin/api/usage?bucket=day').then(({ payload }) => setRows(payload.rows || []));
  }, []);

  return (
    <section className="page-section">
      <div className="section-header">
        <h1>用量分析</h1>
        <a className="secondary-link" href="/admin/api/usage/export?bucket=day">导出 CSV</a>
      </div>
      <DataTable
        columns={[
          { key: 'bucket_start', header: '时间桶' },
          { key: 'model', header: '模型' },
          { key: 'request_count', header: '请求数', render: (row) => <span className="tabular">{row.request_count}</span> },
          { key: 'total_tokens', header: 'Token 数', render: (row) => <span className="tabular">{row.total_tokens}</span> },
        ]}
        rows={rows.map((row, index) => ({ id: `${row.bucket_start}-${row.model}-${index}`, ...row }))}
        emptyTitle="暂无用量记录"
      />
    </section>
  );
}
