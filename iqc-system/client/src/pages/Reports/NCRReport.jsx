import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api, { downloadFile } from '../../utils/api';
import SummaryCard from '../../components/UI/SummaryCard';
import Badge from '../../components/UI/Badge';
import Button from '../../components/UI/Button';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const COLORS = ['#1A3A5C', '#DC2626', '#D97706', '#16A34A', '#2E6DA4', '#7C3AED'];

export default function NCRReport() {
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
  const [from, setFrom] = useState(thirtyDaysAgo.toISOString().slice(0, 10));
  const [to, setTo] = useState(today);
  const [applied, setApplied] = useState({ from: thirtyDaysAgo.toISOString().slice(0, 10), to: today });

  const { data, isLoading } = useQuery({
    queryKey: ['report-ncr', applied],
    queryFn: () => api.get(`/reports/ncr?from=${applied.from}&to=${applied.to}`).then(r => r.data),
  });

  const defectData = React.useMemo(() => {
    if (!data?.ncrs) return [];
    const counts = {};
    data.ncrs.forEach(n => { const k = n.defect_category_name || 'อื่นๆ'; counts[k] = (counts[k] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [data]);

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap gap-3 items-end">
        <div><label className="label">จากวันที่</label><input type="date" className="input" value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div><label className="label">ถึงวันที่</label><input type="date" className="input" value={to} onChange={e => setTo(e.target.value)} /></div>
        <Button onClick={() => setApplied({ from, to })}>แสดงข้อมูล</Button>
        <div className="ml-auto flex gap-2">
          <button onClick={() => downloadFile('/reports/ncr/excel', { from: applied.from, to: applied.to }, 'ncr_report.xlsx')} className="btn-secondary btn text-small">Export Excel</button>
        </div>
      </div>

      {isLoading && <div className="text-muted text-center py-8">กำลังโหลด...</div>}

      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
            <SummaryCard value={data.summary.total} label="NCR ทั้งหมด" color="primary" />
            <SummaryCard value={data.summary.open} label="เปิดอยู่" color="danger" />
            <SummaryCard value={data.summary.closed} label="ปิดแล้ว" color="success" />
            <SummaryCard value={data.summary.pending_supplier} label="รอ Supplier" color="accent" />
            <SummaryCard value={data.summary.major} label="Major" color="danger" />
            <SummaryCard value={data.summary.minor} label="Minor" color="warning" />
          </div>

          {defectData.length > 0 && (
            <div className="card">
              <h3 className="text-h3 font-semibold text-primary mb-3">สัดส่วน NCR ตามกลุ่มปัญหา</h3>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={defectData} dataKey="value" nameKey="name" outerRadius={80} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {defectData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="card">
            <h3 className="text-h3 font-semibold text-primary mb-3">รายการ NCR</h3>
            <div className="table-container">
              <table className="table">
                <thead><tr><th>รหัส NCR</th><th>รายการ</th><th>Supplier</th><th>ระดับ</th><th>วันที่เปิด</th><th>สถานะ</th></tr></thead>
                <tbody>
                  {data.ncrs?.map(n => (
                    <tr key={n.id} className="cursor-default">
                      <td className="font-mono text-primary">{n.ncr_code}</td>
                      <td>{n.item_count || 1} รายการ</td>
                      <td>{n.supplier_name}</td>
                      <td><span className={`badge ${n.severity === 'major' ? 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200' : 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-200'}`}>{n.severity === 'major' ? 'Major' : 'Minor'}</span></td>
                      <td>{n.created_at?.slice(0, 10)}</td>
                      <td><Badge status={n.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
