import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api, { downloadFile } from '../../utils/api';
import SummaryCard from '../../components/UI/SummaryCard';
import Badge from '../../components/UI/Badge';
import Button from '../../components/UI/Button';
import SortTh from '../../components/UI/SortTh';
import { useSortable } from '../../hooks/useSortable';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

export default function UAIReport() {
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
  const [from, setFrom] = useState(thirtyDaysAgo.toISOString().slice(0, 10));
  const [to, setTo] = useState(today);
  const [applied, setApplied] = useState({ from: thirtyDaysAgo.toISOString().slice(0, 10), to: today });

  const { data, isLoading } = useQuery({
    queryKey: ['report-uai', applied],
    queryFn: () => api.get(`/reports/uai?from=${applied.from}&to=${applied.to}`).then(r => r.data),
  });

  const { sorted: sortedUais, onSort, sortKey, sortDir } = useSortable(data?.uais || [], 'created_at');

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap gap-3 items-end">
        <div><label className="label">จากวันที่</label><input type="date" className="input" value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div><label className="label">ถึงวันที่</label><input type="date" className="input" value={to} onChange={e => setTo(e.target.value)} /></div>
        <Button onClick={() => setApplied({ from, to })}>แสดงข้อมูล</Button>
        <div className="ml-auto flex gap-2">
          <button onClick={() => downloadFile('/reports/uai/excel', { from: applied.from, to: applied.to }, 'uai_report.xlsx')} className="btn-secondary btn text-small">Export Excel</button>
          <button onClick={() => downloadFile('/reports/uai/pdf', { from: applied.from, to: applied.to }, 'uai_report.pdf')} className="btn-primary btn text-small">Export PDF</button>
        </div>
      </div>

      {isLoading && <div className="text-muted text-center py-8">กำลังโหลด...</div>}

      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryCard value={data.summary.total} label="UAI ทั้งหมด" color="primary" />
            <SummaryCard value={data.summary.completed} label="เสร็จสมบูรณ์" color="success" />
            <SummaryCard value={data.summary.pending} label="รอดำเนินการ" color="warning" />
            <SummaryCard value={data.summary.rejected} label="ปฏิเสธ" color="danger" />
          </div>

          <div className="card">
            <h3 className="text-h3 font-semibold text-primary mb-3">Top 5 Supplier มี UAI มากที่สุด</h3>
            {data.top_uai_suppliers?.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.top_uai_suppliers}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="uai_count" fill="#1A3A5C" name="UAI" />
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="text-muted text-small text-center py-4">ไม่มีข้อมูล</div>}
          </div>

          <div className="card">
            <h3 className="text-h3 font-semibold text-primary mb-3">รายการ UAI</h3>
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <SortTh col="uai_code" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>รหัส UAI</SortTh>
                    <SortTh col="ncr_code" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>NCR อ้างอิง</SortTh>
                    <SortTh col="supplier_name" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Supplier</SortTh>
                    <SortTh col="created_at" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>วันที่ขอ</SortTh>
                    <SortTh col="status" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>สถานะ</SortTh>
                  </tr>
                </thead>
                <tbody>
                  {sortedUais.map(u => (
                    <tr key={u.id} className="cursor-default">
                      <td className="font-mono text-primary">{u.uai_code}</td>
                      <td className="font-mono">{u.ncr_code}</td>
                      <td>{u.supplier_name}</td>
                      <td>{u.created_at?.slice(0, 10)}</td>
                      <td><Badge status={u.status} /></td>
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
