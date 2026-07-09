import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import { STATUS_LABELS } from '../../utils/rolePermissions';

const IPNCR_STATUS_LABELS = {
  open:                   { label: 'เปิด',              color: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-200' },
  prod_acknowledged:      { label: 'รับทราบแล้ว',       color: 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200' },
  rechecking:             { label: 'อยู่ระหว่าง Recheck', color: 'bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-200' },
  prod_manager_approved:  { label: 'ส่งให้ QC ตรวจ',    color: 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-200' },
  qc_supervisor_verified: { label: 'QC ยืนยันผ่าน',     color: 'bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-200' },
  closed:                 { label: 'ปิดแล้ว',            color: 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200' },
  cancelled:              { label: 'ยกเลิก',             color: 'bg-gray-100 dark:bg-gray-900 text-gray-500 dark:text-gray-200' },
};

function StatusBadge({ status }) {
  const r = IPNCR_STATUS_LABELS[status] || { label: status, color: 'bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-200' };
  return <span className={`badge ${r.color}`}>{r.label}</span>;
}

export default function IPNCRList() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterLine, setFilterLine] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const { data: linesRes } = useQuery({
    queryKey: ['lines-list-ipncr'],
    queryFn: () => api.get('/ipqc/master/production-lines?active=1&limit=200').then(r => r.data),
  });
  const lines = linesRes?.data ?? [];

  const { data, isLoading } = useQuery({
    queryKey: ['ipncr-list', page, q, filterStatus, filterLine, dateFrom, dateTo],
    queryFn: () => api.get('/ipncr', {
      params: {
        page, limit: 20, q,
        status: filterStatus || undefined,
        line_id: filterLine || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      }
    }).then(r => r.data),
    keepPreviousData: true,
  });

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">IPNCR — In-Process NCR</h1>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <input
          className="input max-w-xs"
          placeholder="ค้นหา Record No / Doc No / สินค้า"
          value={q}
          onChange={e => { setQ(e.target.value); setPage(1); }}
        />
        <select className="input w-auto" value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1); }}>
          <option value="">ทุกสถานะ</option>
          {Object.entries(IPNCR_STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <select className="input w-auto" value={filterLine} onChange={e => { setFilterLine(e.target.value); setPage(1); }}>
          <option value="">ทุกสายผลิต</option>
          {lines.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <input className="input w-36" type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} />
        <span className="text-muted text-small">–</span>
        <input className="input w-36" type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }} />
      </div>

      {/* Desktop table */}
      <div className="card hidden md:block p-0 overflow-hidden">
        <table className="table w-full">
          <thead>
            <tr>
              <th className="text-left px-4 py-3 text-small text-muted">Record No</th>
              <th className="text-left px-4 py-3 text-small text-muted">Doc No / สินค้า</th>
              <th className="text-left px-4 py-3 text-small text-muted">สายผลิต</th>
              <th className="text-left px-4 py-3 text-small text-muted">ปัญหา</th>
              <th className="text-center px-4 py-3 text-small text-muted">ครั้งที่</th>
              <th className="text-left px-4 py-3 text-small text-muted">สถานะ</th>
              <th className="text-left px-4 py-3 text-small text-muted">วันที่</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={7} className="text-center py-6 text-muted">กำลังโหลด...</td></tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={7} className="text-center py-6 text-muted">ไม่พบรายการ</td></tr>
            )}
            {rows.map(r => (
              <tr key={r.id} className="border-t border-border hover:bg-bg cursor-pointer" onClick={() => navigate(`/production-qc/ipncr/${r.id}`)}>
                <td className="px-4 py-3 font-mono text-primary text-small font-semibold">{r.record_no}</td>
                <td className="px-4 py-3 text-small">
                  <div className="font-mono text-primary">{r.doc_no}</div>
                  <div className="text-muted truncate max-w-[160px]">{r.product_desc || r.product_no || '—'}</div>
                </td>
                <td className="px-4 py-3 text-small">{r.line_name || '—'}</td>
                <td className="px-4 py-3 text-small max-w-[200px]">
                  <div className="truncate">{r.defect_description}</div>
                  {r.total_qty_affected > 0 && <div className="text-[11px] text-muted">กระทบ: {r.total_qty_affected} ชิ้น</div>}
                </td>
                <td className="px-4 py-3 text-center text-small">
                  {r.recheck_attempt > 0 ? `${r.recheck_attempt}` : '—'}
                </td>
                <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                <td className="px-4 py-3 text-small text-muted">{r.created_at ? r.created_at.slice(0, 10) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="space-y-2 md:hidden">
        {isLoading && <div className="text-center py-6 text-muted">กำลังโหลด...</div>}
        {rows.map(r => (
          <div key={r.id} className="bg-surface border border-border rounded-lg p-3 cursor-pointer active:bg-bg"
            onClick={() => navigate(`/production-qc/ipncr/${r.id}`)}>
            <div className="flex items-start justify-between gap-2 mb-1">
              <span className="font-mono font-semibold text-primary text-small">{r.record_no}</span>
              <StatusBadge status={r.status} />
            </div>
            <div className="text-small font-mono text-text">{r.doc_no}</div>
            <div className="text-small text-muted truncate">{r.product_desc || r.product_no}</div>
            <div className="text-small text-text mt-1 truncate">{r.defect_description}</div>
            {r.recheck_attempt > 1 && (
              <span className="badge bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-200 mt-1">ครั้งที่ {r.recheck_attempt}</span>
            )}
          </div>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1 mt-4">
          <button
            className="px-3 min-h-[44px] rounded border border-border text-small disabled:opacity-40"
            disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}
          >ก่อนหน้า</button>
          {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
            const n = i + 1;
            return (
              <button key={n} onClick={() => setPage(n)}
                className={`px-3 min-h-[44px] rounded border text-small ${page === n ? 'bg-primary text-white border-primary' : 'border-border'}`}>
                {n}
              </button>
            );
          })}
          <button
            className="px-3 min-h-[44px] rounded border border-border text-small disabled:opacity-40"
            disabled={page >= totalPages}
            onClick={() => setPage(p => p + 1)}
          >ถัดไป</button>
        </div>
      )}
    </div>
  );
}
