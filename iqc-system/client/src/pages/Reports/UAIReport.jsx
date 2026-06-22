import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../utils/api';
import SummaryCard from '../../components/UI/SummaryCard';
import Badge from '../../components/UI/Badge';
import Button from '../../components/UI/Button';

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

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap gap-3 items-end">
        <div><label className="label">จากวันที่</label><input type="date" className="input" value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div><label className="label">ถึงวันที่</label><input type="date" className="input" value={to} onChange={e => setTo(e.target.value)} /></div>
        <Button onClick={() => setApplied({ from, to })}>แสดงข้อมูล</Button>
        <div className="ml-auto flex gap-2">
          <a href={`/api/reports/uai/excel?from=${applied.from}&to=${applied.to}`} download className="btn-secondary btn text-small">Export Excel</a>
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
            <h3 className="text-h3 font-semibold text-primary mb-3">รายการ UAI</h3>
            <div className="table-container">
              <table className="table">
                <thead><tr><th>รหัส UAI</th><th>NCR อ้างอิง</th><th>Supplier</th><th>วันที่ขอ</th><th>สถานะ</th></tr></thead>
                <tbody>
                  {data.uais?.map(u => (
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
