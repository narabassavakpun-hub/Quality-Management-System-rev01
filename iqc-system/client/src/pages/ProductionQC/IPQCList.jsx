import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import { STATUS_LABELS } from '../../utils/rolePermissions';

const RESULT_LABELS = {
  pending: { label: 'รอผล',    color: 'bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-200' },
  pass:    { label: 'ผ่าน',    color: 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200' },
  fail:    { label: 'ไม่ผ่าน', color: 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200' },
};

function ResultBadge({ result }) {
  const r = RESULT_LABELS[result] || { label: result, color: 'bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-200' };
  return <span className={`badge ${r.color}`}>{r.label}</span>;
}

export default function IPQCList() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [filterResult, setFilterResult] = useState('');
  const [filterStation, setFilterStation] = useState('');
  const [filterLine, setFilterLine] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const { data: stationsRes } = useQuery({
    queryKey: ['ipqc-stations-list'],
    queryFn: () => api.get('/ipqc/master/ipqc-stations').then(r => r.data),
  });
  const { data: linesRes } = useQuery({
    queryKey: ['lines-list'],
    queryFn: () => api.get('/ipqc/master/production-lines?active=1&limit=200').then(r => r.data),
  });

  const stations = stationsRes?.data ?? [];
  const lines = linesRes?.data ?? [];

  const { data, isLoading } = useQuery({
    queryKey: ['ipqc-list', page, q, filterResult, filterStation, filterLine, dateFrom, dateTo],
    queryFn: () => api.get('/ipqc-inspection', {
      params: {
        page, limit: 20, q, result: filterResult || undefined,
        station_id: filterStation || undefined, line_id: filterLine || undefined,
        date_from: dateFrom || undefined, date_to: dateTo || undefined,
      }
    }).then(r => r.data),
    keepPreviousData: true,
  });

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  const canWrite = ['admin', 'qc_staff', 'qc_supervisor'].includes(user?.role);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">บันทึก IPQC</h1>
        {canWrite && (
          <button className="btn-primary min-h-[44px] px-4" onClick={() => navigate('/production-qc/ipqc/new')}>
            + บันทึกการตรวจ
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <input
          className="input max-w-xs"
          placeholder="ค้นหา Record No / Doc No / สินค้า"
          value={q}
          onChange={e => { setQ(e.target.value); setPage(1); }}
        />
        <select className="input w-auto" value={filterStation} onChange={e => { setFilterStation(e.target.value); setPage(1); }}>
          <option value="">ทุก Station</option>
          {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className="input w-auto" value={filterLine} onChange={e => { setFilterLine(e.target.value); setPage(1); }}>
          <option value="">ทุกสายผลิต</option>
          {lines.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select className="input w-auto" value={filterResult} onChange={e => { setFilterResult(e.target.value); setPage(1); }}>
          <option value="">ทุกผล</option>
          <option value="pass">ผ่าน</option>
          <option value="fail">ไม่ผ่าน</option>
          <option value="pending">รอผล</option>
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
              <th className="text-left px-4 py-3 text-small text-muted">วันที่-เวลา</th>
              <th className="text-left px-4 py-3 text-small text-muted">Station</th>
              <th className="text-left px-4 py-3 text-small text-muted">Doc No / สินค้า</th>
              <th className="text-center px-4 py-3 text-small text-muted">Sample</th>
              <th className="text-center px-4 py-3 text-small text-muted">ผล</th>
              <th className="text-left px-4 py-3 text-small text-muted">IPNCR</th>
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
              <tr key={r.id} className="border-t border-border hover:bg-bg cursor-pointer" onClick={() => navigate(`/production-qc/ipqc/${r.id}`)}>
                <td className="px-4 py-3 font-mono text-primary text-small font-semibold">{r.record_no}</td>
                <td className="px-4 py-3 text-small">
                  <div>{r.inspect_date}</div>
                  <div className="text-muted">{r.inspect_time}</div>
                </td>
                <td className="px-4 py-3 text-small">{r.station_name}</td>
                <td className="px-4 py-3 text-small">
                  <div className="font-mono text-primary">{r.doc_no}</div>
                  <div className="text-muted text-[11px] leading-snug line-clamp-2">{r.product_desc || r.product_no || '-'}</div>
                </td>
                <td className="px-4 py-3 text-center text-small">{r.sample_qty ?? '-'}</td>
                <td className="px-4 py-3 text-center"><ResultBadge result={r.overall_result} /></td>
                <td className="px-4 py-3 text-small">
                  {(r.ipncr_list || []).length > 0 ? (
                    <span className="badge bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-200">{r.ipncr_list.length} รายการ</span>
                  ) : '—'}
                </td>
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
            onClick={() => navigate(`/production-qc/ipqc/${r.id}`)}>
            <div className="flex items-start justify-between gap-2 mb-1">
              <span className="font-mono font-semibold text-primary text-small">{r.record_no}</span>
              <ResultBadge result={r.overall_result} />
            </div>
            <div className="text-small text-muted">{r.station_name} — {r.inspect_date} {r.inspect_time}</div>
            <div className="text-small font-mono text-text mt-1">{r.doc_no}</div>
            <div className="text-small text-muted truncate">{r.product_desc || r.product_no}</div>
            {(r.ipncr_list || []).length > 0 && (
              <span className="badge bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-200 mt-1">IPNCR {r.ipncr_list.length}</span>
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
