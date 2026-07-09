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

      <div className="card overflow-hidden p-0">
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
