import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '../../utils/api';
import Badge from '../../components/UI/Badge';

export default function UAIList() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('');

  const { data: uaiRes, isLoading } = useQuery({
    queryKey: ['uais', status],
    queryFn: () => api.get(`/uai?limit=200${status ? `&status=${status}` : ''}`).then(r => r.data),
    refetchInterval: 30000,
  });

  const uais = Array.isArray(uaiRes) ? uaiRes : (uaiRes?.data ?? []);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">UAI — ยอมรับใช้พิเศษ</h1>
      </div>

      <div className="flex gap-3 mb-4">
        <select className="input w-auto" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">ทุกสถานะ</option>
          <option value="uai_pending_qc_manager">รอ QC Manager</option>
          <option value="uai_pending_purchasing">รอจัดซื้อ</option>
          <option value="uai_pending_cco">รอ CCO</option>
          <option value="uai_pending_cmo">รอ CMO</option>
          <option value="uai_pending_cpo">รอ CPO</option>
          <option value="uai_pending_qc_ack">รอ QC รับทราบ</option>
          <option value="uai_pending_production_ack">รอผลิตรับทราบ</option>
          <option value="uai_pending_qmr_ack">รอ QMR รับทราบ</option>
          <option value="uai_completed">เสร็จสมบูรณ์</option>
          <option value="uai_rejected">ปฏิเสธ (QC Manager)</option>
          <option value="uai_rejected_by_exec">ไม่อนุมัติ (C-Level)</option>
        </select>
      </div>

      {/* Mobile card list */}
      <div className="md:hidden space-y-2">
        {isLoading && <div className="text-center py-8 text-muted text-small">กำลังโหลด...</div>}
        {!isLoading && uais.length === 0 && <div className="text-center py-8 text-muted text-small">ไม่พบข้อมูล</div>}
        {uais.map(u => (
          <div key={u.id} onClick={() => navigate(`/uai/${u.id}`)}
            className="bg-surface border border-border rounded-lg p-3 active:bg-bg cursor-pointer"
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <span className="font-mono font-semibold text-primary text-body">{u.uai_code}</span>
              <Badge status={u.status} />
            </div>
            <div className="text-small text-muted">NCR: <span className="font-mono">{u.ncr_code}</span></div>
            <div className="text-small font-medium text-text mb-0.5">{u.supplier_name}</div>
            <div className="text-small text-muted">{u.created_at?.slice(0, 10)}</div>
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block table-container">
        <table className="table">
          <thead>
            <tr>
              <th>รหัส UAI</th>
              <th>NCR อ้างอิง</th>
              <th>Supplier</th>
              <th>วันที่สร้าง</th>
              <th>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={5} className="text-center py-6 text-muted">กำลังโหลด...</td></tr>}
            {!isLoading && uais.length === 0 && <tr><td colSpan={5} className="text-center py-6 text-muted">ไม่พบข้อมูล</td></tr>}
            {uais.map(u => (
              <tr key={u.id} onClick={() => navigate(`/uai/${u.id}`)}>
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
  );
}
