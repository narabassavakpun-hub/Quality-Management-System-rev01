import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../utils/api';
import Button from '../../components/UI/Button';
import Modal from '../../components/UI/Modal';

function toThaiTime(utcStr) {
  if (!utcStr) return '';
  const iso = utcStr.replace(' ', 'T') + (utcStr.includes('Z') || utcStr.includes('+') ? '' : 'Z');
  const d = new Date(iso);
  if (isNaN(d.getTime())) return utcStr.slice(0, 10);
  const th = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  const p = n => String(n).padStart(2, '0');
  return `${th.getUTCFullYear()}-${p(th.getUTCMonth() + 1)}-${p(th.getUTCDate())}`;
}

export default function MaterialDefects() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [ackModal, setAckModal] = useState(null); // row to acknowledge
  const [ackForm, setAckForm] = useState({ remarks: '' });
  const [ackErr, setAckErr] = useState('');
  const LIMIT = 20;

  const { data, isLoading } = useQuery({
    queryKey: ['material-defects', page, statusFilter],
    queryFn: () => api.get('/fg-material-defects', { params: { page, limit: LIMIT, status: statusFilter || undefined } }).then(r => r.data),
    staleTime: 15000,
  });

  const acknowledge = useMutation({
    mutationFn: ({ id, body }) => api.patch(`/fg-material-defects/${id}/acknowledge`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['material-defects'] });
      setAckModal(null); setAckForm({ remarks: '' }); setAckErr('');
    },
    onError: e => setAckErr(e.response?.data?.error || 'เกิดข้อผิดพลาด'),
  });

  const rows  = data?.data  || [];
  const total = data?.total || 0;
  const pages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">ของเสียวัตถุดิบ (Material Defect)</h1>
        <div className="flex gap-2">
          <select className="input text-small w-40" value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}>
            <option value="">— สถานะทั้งหมด —</option>
            <option value="pending">รอรับทราบ</option>
            <option value="acknowledged">รับทราบแล้ว</option>
          </select>
        </div>
      </div>

      {/* ── Mobile cards ── */}
      <div className="md:hidden space-y-2">
        {isLoading && <p className="text-center text-muted py-4 text-body">กำลังโหลด...</p>}
        {!isLoading && rows.length === 0 && <p className="text-center text-muted py-8 text-body">ไม่พบข้อมูล</p>}
        {rows.map(row => (
          <div key={row.id} className={`bg-surface border border-border rounded-lg p-3 space-y-2 ${row.status === 'pending' ? 'border-l-4 border-l-warning' : ''}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold text-body text-text truncate">{row.defect_type_noted || row.product_name || '—'}</div>
                {row.product_name && row.defect_type_noted && <div className="text-muted text-[12px] truncate">{row.product_name}</div>}
              </div>
              {row.status === 'pending'
                ? <span className="badge flex-shrink-0 bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-200">รอรับทราบ</span>
                : <span className="badge flex-shrink-0 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200">รับทราบแล้ว</span>
              }
            </div>
            {row.fncp_id && (
              <div className="text-[12px]">
                FNCP: <Link to={`/fg-production/fncp/${row.fncp_id}`} className="font-mono text-accent hover:underline">{row.fncp_no || `#${row.fncp_id}`}</Link>
              </div>
            )}
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px] text-muted">
              <div>Lot: <span className="font-mono text-text">{row.lot_number || '—'}</span></div>
              <div>ผู้ผลิต: <span className="text-text">{row.supplier_name || '—'}</span></div>
              <div>จำนวน: <span className="font-semibold text-danger">{row.qty_found ? row.qty_found.toLocaleString() : '—'}</span></div>
              <div>วันที่: <span className="text-text">{toThaiTime(row.created_at)}</span></div>
            </div>
            <div className="pt-2 border-t border-border">
              {row.status === 'pending' ? (
                <button
                  onClick={() => { setAckModal(row); setAckForm({ remarks: '' }); setAckErr(''); }}
                  className="w-full min-h-[44px] rounded-lg bg-primary text-white font-medium hover:opacity-90"
                >
                  รับทราบ
                </button>
              ) : row.acknowledge_at && (
                <p className="text-[12px] text-muted text-center">รับทราบเมื่อ {toThaiTime(row.acknowledge_at)}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ── Desktop table ── */}
      <div className="hidden md:block card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="w-8">#</th>
                <th>สถานะ</th>
                <th>FNCP อ้างอิง</th>
                <th>ชื่อของเสีย</th>
                <th>Lot/Batch</th>
                <th>ผู้ผลิต</th>
                <th className="text-right">จำนวน</th>
                <th>วันที่</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={9} className="text-center py-8 text-muted">กำลังโหลด...</td></tr>
              ) : !rows.length ? (
                <tr><td colSpan={9} className="text-center py-8 text-muted">ไม่พบข้อมูล</td></tr>
              ) : rows.map((row, i) => (
                <tr key={row.id} className={`hover:bg-bg transition-colors ${row.status === 'pending' ? 'bg-yellow-50/30 dark:bg-yellow-900' : ''}`}>
                  <td className="text-muted text-small">{(page - 1) * LIMIT + i + 1}</td>
                  <td>
                    {row.status === 'pending'
                      ? <span className="badge text-[11px] bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-200">รอรับทราบ</span>
                      : <span className="badge text-[11px] bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200">รับทราบแล้ว</span>
                    }
                  </td>
                  <td>
                    {row.fncp_id ? (
                      <Link to={`/fg-production/fncp/${row.fncp_id}`} className="font-mono text-small text-accent hover:underline">{row.fncp_no || `#${row.fncp_id}`}</Link>
                    ) : <span className="text-muted text-small">—</span>}
                  </td>
                  <td className="text-small">
                    <div className="font-medium">{row.defect_type_noted || row.product_name || '—'}</div>
                    {row.product_name && row.defect_type_noted && <div className="text-muted text-[11px]">{row.product_name}</div>}
                  </td>
                  <td className="font-mono text-small">{row.lot_number || '—'}</td>
                  <td className="text-small">{row.supplier_name || '—'}</td>
                  <td className="text-right text-small font-medium text-danger">{row.qty_found ? row.qty_found.toLocaleString() : '—'}</td>
                  <td className="text-small text-muted whitespace-nowrap">{toThaiTime(row.created_at)}</td>
                  <td>
                    {row.status === 'pending' && (
                      <Button variant="primary" size="sm" onClick={() => { setAckModal(row); setAckForm({ remarks: '' }); setAckErr(''); }}>
                        รับทราบ
                      </Button>
                    )}
                    {row.status === 'acknowledged' && row.acknowledge_at && (
                      <span className="text-[11px] text-muted">{toThaiTime(row.acknowledge_at)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {pages > 1 && (
        <div className="card flex justify-center gap-1 p-3 mt-2">
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

      {/* Acknowledge Modal */}
      {ackModal && (
        <Modal open onClose={() => setAckModal(null)} title="รับทราบของเสียวัตถุดิบ" size="sm">
          <div className="space-y-3">
            <div className="bg-yellow-50 dark:bg-yellow-900 border border-yellow-200 dark:border-yellow-700 rounded-lg p-3 text-small">
              <div className="font-medium text-warning">{ackModal.defect_type_noted || ackModal.product_name || '—'}</div>
              {ackModal.lot_number && <div className="text-muted text-[11px] mt-0.5">Lot: {ackModal.lot_number}</div>}
              {ackModal.supplier_name && <div className="text-muted text-[11px]">ผู้ผลิต: {ackModal.supplier_name}</div>}
            </div>
            <div>
              <label className="label">หมายเหตุ / การดำเนินการ</label>
              <textarea rows={3} className="input" value={ackForm.remarks} onChange={e => setAckForm(p => ({ ...p, remarks: e.target.value }))} placeholder="บันทึกการดำเนินการหลังรับทราบ..." />
            </div>
            {ackErr && <p className="text-danger text-small">{ackErr}</p>}
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="secondary" onClick={() => setAckModal(null)}>ยกเลิก</Button>
              <Button variant="primary" loading={acknowledge.isPending} onClick={() => acknowledge.mutate({ id: ackModal.id, body: ackForm })}>ยืนยันรับทราบ</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
