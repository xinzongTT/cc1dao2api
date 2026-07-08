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
        <h1>Usage Analytics</h1>
        <a className="secondary-link" href="/admin/api/usage/export?bucket=day">Export CSV</a>
      </div>
      <DataTable
        columns={[
          { key: 'bucket_start', header: 'Bucket' },
          { key: 'model', header: 'Model' },
          { key: 'request_count', header: 'Requests', render: (row) => <span className="tabular">{row.request_count}</span> },
          { key: 'total_tokens', header: 'Tokens', render: (row) => <span className="tabular">{row.total_tokens}</span> },
        ]}
        rows={rows.map((row, index) => ({ id: `${row.bucket_start}-${row.model}-${index}`, ...row }))}
        emptyTitle="No usage rows"
      />
    </section>
  );
}
