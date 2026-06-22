import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../utils/api';
import SummaryCard from '../../components/UI/SummaryCard';
import Button from '../../components/UI/Button';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

function useDateRange() {
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(today.getDate() - 29);
  return {
    defaultFrom: thirtyDaysAgo.toISOString().slice(0, 10),
    defaultTo: today.toISOString().slice(0, 10),
  };
}

export default function SummaryReport() {
  const { defaultFrom, defaultTo } = useDateRange();
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [applied, setApplied] = useState({ from: defaultFrom, to: defaultTo });

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['report-summary', applied],
    queryFn: () => api.get(`/reports/summary?from=${applied.from}&to=${applied.to}`).then(r => r.data),
  });

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap gap-3 items-end sticky top-0 z-10">
        <div><label className="label">จากวันที่</label><input type="date" className="input" value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div><label className="label">ถึงวันที่</label><input type="date" className="input" value={to} onChange={e => setTo(e.target.value)} /></div>
        <Button onClick={() => setApplied({ from, to })}>แสดงข้อมูล</Button>
        <div className="ml-auto flex gap-2">
          <a href={`/api/reports/summary/excel?from=${applied.from}&to=${applied.to}`} download className="btn-secondary btn text-small">Export Excel</a>
          <a href={`/api/reports/summary/pdf?from=${applied.from}&to=${applied.to}`} download className="btn-primary btn text-small">Export PDF</a>
        </div>
      </div>

      {isLoading && <div className="text-muted text-center py-8">กำลังโหลด...</div>}

      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <SummaryCard value={data.summary.total_bills} label="บิลทั้งหมด" color="primary" />
            <SummaryCard value={data.summary.total_received} label="รายการรับเข้า" color="accent" />
            <SummaryCard value={`${data.summary.pass_rate}%`} label="อัตราผ่าน" color="success" />
            <SummaryCard value={data.summary.total_ncr} label="NCR ทั้งหมด" color="warning" />
            <SummaryCard value={data.summary.open_ncr} label="NCR เปิดอยู่" color="danger" />
            <SummaryCard value={data.summary.total_uai} label="UAI ทั้งหมด" color="primary" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card">
              <h3 className="text-h3 font-semibold text-primary mb-3">Top 5 Supplier มี NCR มากที่สุด</h3>
              {data.top_ncr_suppliers?.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={data.top_ncr_suppliers}>
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="ncr_count" fill="#1A3A5C" name="NCR" />
                  </BarChart>
                </ResponsiveContainer>
              ) : <div className="text-muted text-small text-center py-4">ไม่มีข้อมูล</div>}
            </div>
            <div className="card">
              <h3 className="text-h3 font-semibold text-primary mb-3">Top 5 กลุ่มปัญหา</h3>
              {data.top_defects?.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={data.top_defects} layout="vertical">
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={100} />
                    <Tooltip />
                    <Bar dataKey="ncr_count" fill="#DC2626" name="NCR" />
                  </BarChart>
                </ResponsiveContainer>
              ) : <div className="text-muted text-small text-center py-4">ไม่มีข้อมูล</div>}
            </div>
          </div>

          <div className="card">
            <h3 className="text-h3 font-semibold text-primary mb-3">Supplier Scorecard</h3>
            <div className="table-container">
              <table className="table">
                <thead><tr><th>Supplier</th><th>บิลทั้งหมด</th><th>NCR ทั้งหมด</th><th>อัตรา NCR (%)</th><th>UAI ทั้งหมด</th></tr></thead>
                <tbody>
                  {data.supplier_scorecard?.map((s, i) => (
                    <tr key={i} className="cursor-default">
                      <td>{s.supplier_name}</td>
                      <td className="font-mono">{s.total_bills}</td>
                      <td className="font-mono">{s.total_ncr}</td>
                      <td className="font-mono">{s.total_bills > 0 ? ((s.total_ncr / s.total_bills) * 100).toFixed(1) : '0.0'}%</td>
                      <td className="font-mono">{s.total_uai}</td>
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
