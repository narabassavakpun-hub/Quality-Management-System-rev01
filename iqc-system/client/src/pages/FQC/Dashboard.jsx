import React from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../utils/api';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

function Card({ label, value, sub, tone }) {
  const color = tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warning' : 'text-primary';
  return (
    <div className="card">
      <div className="text-small text-muted">{label}</div>
      <div className={`text-h1 font-bold ${color}`}>{value}</div>
      {sub && <div className="text-small text-muted">{sub}</div>}
    </div>
  );
}

export default function ProductionQCDashboard() {
  const { data: ipqc } = useQuery({ queryKey: ['ipqc-summary'], queryFn: () => api.get('/ipqc/summary').then(r => r.data), refetchInterval: 60000 });
  const { data: fqc } = useQuery({ queryKey: ['fqc-summary'], queryFn: () => api.get('/fqc/summary').then(r => r.data), refetchInterval: 60000 });

  const trendFqc = (fqc?.trend ?? []).map(t => ({ ...t, date: t.date?.slice(5) }));
  const trendIpqc = (ipqc?.trend ?? []).map(t => ({ ...t, date: t.date?.slice(5) }));
  const pareto = (fqc?.pareto ?? []).length ? fqc.pareto : (ipqc?.pareto ?? []);

  return (
    <div>
      <div className="page-header"><h1 className="page-title">Dashboard — QC หน้างาน</h1></div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card label="IPQC วันนี้" value={ipqc?.today_count ?? 0} sub={`ของเสีย ${ipqc?.today_defect_qty ?? 0} ชิ้น`} tone="warn" />
        <Card label="IPQC ค้างดำเนินการ" value={ipqc?.open_count ?? 0} sub="เปิด/กำลังแก้ไข" />
        <Card label="FQC วันนี้" value={fqc?.today_lots ?? 0} sub={`ผลิต ${fqc?.today_produced ?? 0} ชิ้น`} />
        <Card label="อัตราของเสีย FQC วันนี้" value={`${fqc?.today_defect_rate ?? 0}%`} tone={(fqc?.today_defect_rate ?? 0) > 3 ? 'danger' : undefined} />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="card">
          <div className="text-h3 font-semibold mb-3">อัตราของเสีย FQC (7 วัน)</div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={trendFqc}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="date" fontSize={12} /><YAxis fontSize={12} unit="%" />
              <Tooltip /><Line type="monotone" dataKey="rate" stroke="#DC2626" name="อัตรา %" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <div className="text-h3 font-semibold mb-3">ของเสีย IPQC รายวัน (7 วัน)</div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={trendIpqc}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="date" fontSize={12} /><YAxis fontSize={12} />
              <Tooltip /><Bar dataKey="defect_qty" fill="#2E6DA4" name="ของเสีย" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card mt-6">
        <div className="text-h3 font-semibold mb-3">Pareto — ประเภทของเสียสูงสุด (30 วัน)</div>
        {pareto.length === 0 ? <div className="text-muted text-small py-8 text-center">ยังไม่มีข้อมูล</div> : (
          <ResponsiveContainer width="100%" height={Math.max(200, pareto.length * 36)}>
            <BarChart data={pareto} layout="vertical" margin={{ left: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis type="number" fontSize={12} /><YAxis type="category" dataKey="name" width={120} fontSize={12} />
              <Tooltip /><Bar dataKey="qty" fill="#1A3A5C" name="จำนวน" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
