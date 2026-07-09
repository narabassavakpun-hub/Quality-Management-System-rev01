import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../../utils/api';
import { STATUS_LABELS } from '../../utils/rolePermissions';

const FUAI_STATUS_ORDER = [
  'pending_prod_manager','pending_cpo','pending_qc_manager',
  'pending_qc_staff_ack','pending_qc_supervisor_ack','closed','rejected',
];

function StatusBadge({ s }) {
  const lbl = STATUS_LABELS[s] || { label: s, color: 'bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-200' };
  return <span className={`badge text-[11px] ${lbl.color}`}>{lbl.label}</span>;
}

const SEV_COLOR = { minor: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-200', major: 'bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-200', critical: 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200' };

export default function FUAIList() {
  const [filters, setFilters] = useState({ q: '', status: '', line_id: '', date_from: '', date_to: '' });
  const [deb, setDeb] = useState(filters);
  const [page, setPage] = useState(1);
  const LIMIT = 20;

  useEffect(() => {
    const t = setTimeout(() => { setDeb(filters); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [filters]);

  const setF = (k, v) => setFilters(p => ({ ...p, [k]: v }));

  const { data: opts } = useQuery({
    queryKey: ['fg-master-options'],
    queryFn: () => api.get('/fg-master/options').then(r => r.data),
    staleTime: 300000,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['fuai-list', deb, page],
    queryFn: () => api.get('/fg-fuai', { params: { ...deb, page, limit: LIMIT } }).then(r => r.data),
    staleTime: 15000,
  });

  const rows  = data?.data  || [];
  const total = data?.total || 0;
  const pages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">รายการ FUAI — ขออนุมัติใช้พิเศษ</h1>
        <Link to="/fg-production/fncp"><button className="btn btn-secondary text-small">← รายการ FNCP</button></Link>
      </div>

      {/* Filters */}
      <div className="card mb-4">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <input className="input col-span-2 sm:col-span-1" placeholder="ค้นหา FUAI No. / FNCP / สินค้า..." value={filters.q} onChange={e => setF('q', e.target.value)} />
          <select className="input" value={filters.status} onChange={e => setF('status', e.target.value)}>
            <option value="">— สถานะทั้งหมด —</option>
            {FUAI_STATUS_ORDER.map(s => {
              const lbl = STATUS_LABELS[s];
              return <option key={s} value={s}>{lbl?.label || s}</option>;
            })}
          </select>
          <select className="input" value={filters.line_id} onChange={e => setF('line_id', e.target.value)}>
            <option value="">— สายการผลิต —</option>
            {opts?.lines?.map(l => <option key={l.id} value={l.id}>{l.name || l.code}</option>)}
          </select>
          <input type="date" className="input" value={filters.date_from} onChange={e => setF('date_from', e.target.value)} />
          <input type="date" className="input" value={filters.date_to} onChange={e => setF('date_to', e.target.value)} />
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="w-8">#</th>
                <th>FUAI No.</th>
                <th>FNCP อ้างอิง</th>
                <th>สินค้า</th>
                <th>สายการผลิต</th>
                <th>Severity</th>
                <th>สถานะ</th>
                <th>ผู้ขอ</th>
                <th>วันที่สร้าง</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={9} className="text-center py-8 text-muted">กำลังโหลด...</td></tr>
              ) : !rows.length ? (
                <tr><td colSpan={9} className="text-center py-8 text-muted">ไม่พบข้อมูล</td></tr>
              ) : rows.map((row, i) => (
                <tr key={row.id} className="hover:bg-bg transition-colors">
                  <td className="text-muted text-small">{(page - 1) * LIMIT + i + 1}</td>
                  <td>
                    <Link to={`/fg-production/fuai/${row.id}`} className="font-mono text-small text-accent hover:underline">
                      {row.fuai_no}
                    </Link>
                  </td>
                  <td className="font-mono text-small text-muted">{row.fncp_no || '—'}</td>
                  <td className="text-small min-w-[160px]">
                    <div className="font-medium truncate max-w-[180px]">{row.product_no}</div>
                    <div className="text-muted text-[11px] truncate max-w-[180px]">{row.product_desc}</div>
                  </td>
                  <td className="text-small">{row.line_name || '—'}</td>
                  <td>
                    {row.fncp_severity && (
                      <span className={`badge text-[11px] ${SEV_COLOR[row.fncp_severity]}`}>{row.fncp_severity}</span>
                    )}
                  </td>
                  <td><StatusBadge s={row.status} /></td>
                  <td className="text-small text-muted">{row.opened_by || '—'}</td>
                  <td className="text-small text-muted whitespace-nowrap">{row.created_at?.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="flex justify-center gap-1 p-3 border-t border-border">
            <button className="btn-page" disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹</button>
            {Array.from({ length: Math.min(pages, 5) }, (_, i) => {
              const pg = page <= 3 ? i + 1 : page >= pages - 2 ? pages - 4 + i : page - 2 + i;
              return pg >= 1 && pg <= pages ? (
                <button key={pg} className={`btn-page ${pg === page ? 'active' : ''}`} onClick={() => setPage(pg)}>{pg}</button>
              ) : null;
            })}
            <button className="btn-page" disabled={page === pages} onClick={() => setPage(p => p + 1)}>›</button>
          </div>
        )}
      </div>
    </div>
  );
}
