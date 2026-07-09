import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import api from '../../utils/api';
import Button from '../../components/UI/Button';
import { STATUS_LABELS } from '../../utils/rolePermissions';
import { useAuth } from '../../contexts/AuthContext';

const FNCP_STATUS_ORDER = ['open','in_progress','waiting_verify','verified','closed','reject'];

function StatusBadge({ s }) {
  const lbl = STATUS_LABELS[`fncp_${s}`] || STATUS_LABELS[s] || { label: s, color: 'bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-200' };
  return <span className={`badge text-[11px] ${lbl.color}`}>{lbl.label}</span>;
}
function SevBadge({ v }) {
  const col = { minor: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-200', major: 'bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-200', critical: 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200' };
  return <span className={`badge text-[11px] ${col[v] || 'bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-200'}`}>{v}</span>;
}

export default function FNCPList() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [filters, setFilters] = useState({ q: '', status: '', severity: '', line_id: '', overdue_only: '0', date_from: '', date_to: '' });
  const [deb, setDeb]   = useState(filters);
  const [page, setPage] = useState(1);
  const [delTarget, setDelTarget] = useState(null); // { id, fncp_no }

  const doDelete = useMutation({
    mutationFn: (id) => api.delete(`/fg-fncp/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fncp-list'] });
      qc.invalidateQueries({ queryKey: ['fncp-stats'] });
      setDelTarget(null);
    },
    onError: e => alert(e.response?.data?.error || 'ลบไม่สำเร็จ'),
  });

  useEffect(() => {
    const t = setTimeout(() => { setDeb(filters); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [filters]);

  const setF = (k, v) => setFilters(p => ({ ...p, [k]: v }));

  const { data: statsData } = useQuery({
    queryKey: ['fncp-stats'],
    queryFn: () => api.get('/fg-fncp/stats').then(r => r.data),
    staleTime: 60000,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['fncp-list', deb, page],
    queryFn: () => api.get('/fg-fncp', { params: { ...deb, page, limit: 20 } }).then(r => r.data),
    staleTime: 30000,
  });

  const { data: opts } = useQuery({
    queryKey: ['fg-master-options'],
    queryFn: () => api.get('/fg-master/options').then(r => r.data),
    staleTime: 300000,
  });

  const rows  = data?.data || [];
  const total = data?.total || 0;
  const pages = Math.max(1, Math.ceil(total / 20));
  const statusMap = Object.fromEntries((statsData?.byStatus || []).map(s => [s.status, s.c]));

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">รายการ FNCP</h1>
          <p className="text-muted text-small">Finished Non-Conformance Product</p>
        </div>
        <Link to="/fg-production"><Button variant="secondary" size="sm">← กลับ FG Monitor</Button></Link>
      </div>

      {/* Status summary bar */}
      <div className="flex flex-wrap gap-2 mb-4">
        {[
          { key: '', label: 'ทั้งหมด', cnt: total },
          { key: 'open',           label: 'เปิด',           cnt: statusMap['open'] },
          { key: 'in_progress',    label: 'กำลังดำเนินการ', cnt: statusMap['in_progress'] },
          { key: 'waiting_verify', label: 'รอ QC ตรวจ',    cnt: statusMap['waiting_verify'] },
          { key: 'verified',       label: 'QC ยืนยัน',     cnt: statusMap['verified'] },
          { key: 'reject',         label: 'ปฏิเสธ',         cnt: statusMap['reject'] },
          { key: 'closed',         label: 'ปิดแล้ว',        cnt: statusMap['closed'] },
        ].map(({ key, label, cnt }) => (
          <button
            key={key}
            onClick={() => setF('status', key)}
            className={`px-3 py-1 rounded-full text-small border transition-colors ${deb.status === key ? 'bg-primary text-white border-primary' : 'bg-surface border-border text-muted hover:border-accent'}`}
          >
            {label} {cnt !== undefined ? <span className="ml-1 font-semibold">{cnt}</span> : ''}
          </button>
        ))}
        {statsData?.overdue > 0 && (
          <button
            onClick={() => setF('overdue_only', deb.overdue_only === '1' ? '0' : '1')}
            className={`px-3 py-1 rounded-full text-small border transition-colors ${deb.overdue_only === '1' ? 'bg-danger text-white border-danger' : 'bg-red-50 dark:bg-red-900 border-red-200 dark:border-red-700 text-danger hover:bg-red-100'}`}
          >
            เกินกำหนด {statsData.overdue}
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="card mb-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <input className="input col-span-2 sm:col-span-1" placeholder="ค้นหา FNCP No. / Doc.No. / สินค้า..." value={filters.q} onChange={e => setF('q', e.target.value)} />
          <select className="input" value={filters.severity} onChange={e => setF('severity', e.target.value)}>
            <option value="">— Severity —</option>
            <option value="minor">Minor</option>
            <option value="major">Major</option>
            <option value="critical">Critical</option>
          </select>
          <select className="input" value={filters.line_id} onChange={e => setF('line_id', e.target.value)}>
            <option value="">— สายการผลิต —</option>
            {opts?.lines?.map(l => <option key={l.id} value={l.id}>{l.name || l.code}</option>)}
          </select>
          <input type="date" className="input" value={filters.date_from} onChange={e => setF('date_from', e.target.value)} />
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="w-8">#</th>
                <th>FNCP No.</th>
                <th>Doc. No. / สินค้า</th>
                <th>สายการผลิต</th>
                <th>อาการเสีย</th>
                <th>จำนวน</th>
                <th>Severity</th>
                <th>Due Date</th>
                <th>สถานะ</th>
                <th className="text-right">วัน</th>
                <th>ผู้เปิด</th>
                {user?.role === 'admin' && <th></th>}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={11} className="text-center py-8 text-muted">กำลังโหลด...</td></tr>
              ) : !rows.length ? (
                <tr><td colSpan={11} className="text-center py-8 text-muted">ไม่พบ FNCP</td></tr>
              ) : rows.map((r, i) => {
                const isOverdue = r.due_date && r.due_date < new Date().toISOString().slice(0, 10) && !['closed', 'verified'].includes(r.status);
                return (
                  <tr key={r.id} className="hover:bg-bg cursor-pointer" onClick={() => window.location.href = `/fg-production/fncp/${r.id}`}>
                    <td className="text-muted text-small">{(page - 1) * 20 + i + 1}</td>
                    <td>
                      <Link to={`/fg-production/fncp/${r.id}`} className="font-mono text-small text-accent hover:underline" onClick={e => e.stopPropagation()}>
                        {r.fncp_no}
                      </Link>
                    </td>
                    <td className="min-w-[180px]">
                      <div className="text-small font-medium">{r.doc_no || '—'}</div>
                      <div className="text-[11px] text-muted leading-snug">{r.product_no} {r.product_desc}</div>
                    </td>
                    <td className="text-small">{r.line_name || '—'}</td>
                    <td>
                      <div className="text-small">{r.defect_type_name || r.defect_group_name || '—'}</div>
                    </td>
                    <td className="text-small text-right">{r.defect_qty?.toLocaleString()} {r.defect_unit}</td>
                    <td><SevBadge v={r.severity} /></td>
                    <td className={`text-small ${isOverdue ? 'text-danger font-medium' : 'text-text'}`}>
                      {r.due_date || '—'} {isOverdue && '⚠'}
                    </td>
                    <td><StatusBadge s={r.status} /></td>
                    <td className="text-small text-right">
                      {(() => {
                        if (!r.opened_at) return '—';
                        const isClosed = ['closed'].includes(r.status);
                        const end = isClosed && r.closed_at ? new Date(r.closed_at) : new Date();
                        const days = Math.round((end - new Date(r.opened_at)) / (1000 * 60 * 60 * 24));
                        return (
                          <span title={isClosed ? `ปิดใน ${days} วัน` : `ผ่านมา ${days} วัน`}
                            className={isClosed ? 'text-success font-medium' : days > 7 ? 'text-danger font-medium' : 'text-muted'}>
                            {days}d
                          </span>
                        );
                      })()}
                    </td>
                    <td className="text-small text-muted">{r.opened_by_name}</td>
                    {user?.role === 'admin' && (
                      <td onClick={e => e.stopPropagation()}>
                        {['open','reject'].includes(r.status) && (
                          <button
                            title="ลบ FNCP"
                            onClick={() => setDelTarget({ id: r.id, fncp_no: r.fncp_no })}
                            className="w-7 h-7 flex items-center justify-center rounded text-danger hover:bg-red-50 transition-colors"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="flex justify-center gap-1 p-3 border-t border-border">
            <button className="btn-page" disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹</button>
            {Array.from({ length: Math.min(pages, 7) }, (_, i) => {
              const pg = Math.min(Math.max(page - 3 + i, 1), pages - 6 + i);
              return pg >= 1 && pg <= pages ? (
                <button key={pg} className={`btn-page ${pg === page ? 'active' : ''}`} onClick={() => setPage(pg)}>{pg}</button>
              ) : null;
            })}
            <button className="btn-page" disabled={page === pages} onClick={() => setPage(p => p + 1)}>›</button>
          </div>
        )}
      </div>
      {/* Delete confirmation */}
      {delTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-xl shadow-lg p-5 max-w-xs w-full">
            <div className="font-semibold text-text mb-1">ยืนยันการลบ</div>
            <div className="text-small text-muted mb-4">ลบ <span className="font-mono font-bold text-danger">{delTarget.fncp_no}</span> ออกจากระบบถาวร?</div>
            <div className="flex gap-2 justify-end">
              <Button variant="secondary" size="sm" onClick={() => setDelTarget(null)} disabled={doDelete.isPending}>ยกเลิก</Button>
              <Button variant="danger" size="sm" loading={doDelete.isPending} onClick={() => doDelete.mutate(delTarget.id)}>ลบ</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
