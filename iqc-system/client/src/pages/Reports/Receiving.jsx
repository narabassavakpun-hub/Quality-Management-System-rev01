import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../utils/api';
import SummaryCard from '../../components/UI/SummaryCard';
import Badge from '../../components/UI/Badge';
import Button from '../../components/UI/Button';

export default function ReceivingReport() {
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
  const [from, setFrom] = useState(thirtyDaysAgo.toISOString().slice(0, 10));
  const [to, setTo] = useState(today);
  const [applied, setApplied] = useState({ from: thirtyDaysAgo.toISOString().slice(0, 10), to: today });

  const { data, isLoading } = useQuery({
    queryKey: ['report-receiving', applied],
    queryFn: () => api.get(`/reports/receiving?from=${applied.from}&to=${applied.to}`).then(r => r.data),
  });

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap gap-3 items-end">
        <div><label className="label">จากวันที่</label><input type="date" className="input" value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div><label className="label">ถึงวันที่</label><input type="date" className="input" value={to} onChange={e => setTo(e.target.value)} /></div>
        <Button onClick={() => setApplied({ from, to })}>แสดงข้อมูล</Button>
        <div className="ml-auto flex gap-2">
          <a href={`/api/reports/receiving/excel?from=${applied.from}&to=${applied.to}`} download className="btn-secondary btn text-small">Export Excel</a>
        </div>
      </div>

      {isLoading && <div className="text-muted text-center py-8">กำลังโหลด...</div>}

      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <SummaryCard value={data.summary.total_bills} label="บิลทั้งหมด" color="primary" />
            <SummaryCard value={data.summary.total_items} label="รายการทั้งหมด" color="accent" />
            <SummaryCard value={data.summary.total_passed} label="ผ่าน" color="success" />
            <SummaryCard value={data.summary.total_failed} label="ไม่ผ่าน" color="danger" />
            <SummaryCard value={`${data.summary.pass_rate}%`} label="อัตราผ่าน" color="success" />
          </div>
          <div className="card">
            <h3 className="text-h3 font-semibold text-primary mb-3">รายการบิล</h3>
            <div className="table-container">
              <table className="table">
                <thead><tr><th>Invoice No.</th><th>PO No.</th><th>Supplier</th><th>วันที่</th><th>รายการ</th><th>ผ่าน</th><th>ไม่ผ่าน</th><th>สถานะ</th></tr></thead>
                <tbody>
                  {data.bills?.map(b => (
                    <tr key={b.id} className="cursor-default">
                      <td className="font-mono">{b.invoice_no}</td>
                      <td className="font-mono">{b.po_no}</td>
                      <td>{b.supplier_name}</td>
                      <td>{b.received_date}</td>
                      <td className="font-mono">{b.item_count || 0}</td>
                      <td className="font-mono text-success">{b.total_passed || 0}</td>
                      <td className="font-mono text-danger">{b.total_failed || 0}</td>
                      <td><Badge status={b.status} /></td>
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
