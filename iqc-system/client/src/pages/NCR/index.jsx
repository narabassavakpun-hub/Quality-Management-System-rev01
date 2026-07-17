import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../utils/api';
import Badge from '../../components/UI/Badge';
import Button from '../../components/UI/Button';
import { ncrDisplayStatusKey } from '../../utils/rolePermissions';

export default function NCRList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [docType, setDocType] = useState('');

  const { data: ncrRes, isLoading } = useQuery({
    queryKey: ['ncrs', status, search],
    queryFn: () => api.get(`/ncr?limit=200${status ? `&status=${status}` : ''}${search ? `&search=${encodeURIComponent(search)}` : ''}`).then(r => r.data),
    refetchInterval: 30000,
  });

  const ncrs = Array.isArray(ncrRes) ? ncrRes : (ncrRes?.data ?? []);
  const filtered = ncrs.filter(n => {
    if (search) {
      const q = search.toLowerCase();
      const match =
        (n.ncr_code || '').toLowerCase().includes(q) ||
        (n.supplier_name || '').toLowerCase().includes(q) ||
        (n.invoice_no || '').toLowerCase().includes(q) ||
        (n.items || []).some(i => (i.item_name || '').toLowerCase().includes(q));
      if (!match) return false;
    }
    if (docType === 'ncr' && n.severity !== 'major') return false;
    if (docType === 'ncp' && n.severity !== 'minor') return false;
    return true;
  });

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">NCR / NCP</h1>
      </div>

      <div className="flex gap-3 mb-4 flex-wrap">
        <input className="input max-w-xs" placeholder="ค้นหา รหัส / รายการ / Supplier" value={search} onChange={e => setSearch(e.target.value)} />
        <select className="input w-auto" value={docType} onChange={e => setDocType(e.target.value)}>
          <option value="">NCR + NCP</option>
          <option value="ncr">NCR เท่านั้น (Major)</option>
          <option value="ncp">NCP เท่านั้น (Minor)</option>
        </select>
        <select className="input w-auto" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">ทุกสถานะ</option>
          <option value="pending_supervisor">รอหัวหน้า QC</option>
          <option value="pending_manager">รอ QC Manager</option>
          <option value="pending_qmr_open">รอ QMR เปิด</option>
          <option value="pending_supplier">รอ Supplier</option>
          <option value="pending_manager_review">รอ Manager ตรวจ</option>
          <option value="pending_qmr_close">รอ QMR ปิด</option>
          <option value="pending_uai">รอดำเนินการ UAI</option>
          <option value="closed">NCR ปิดแล้ว</option>
          <option value="ncp_closed">NCP ปิดแล้ว</option>
        </select>
      </div>

      {/* Mobile card list */}
      <div className="md:hidden space-y-2">
        {isLoading && <div className="text-center py-8 text-muted text-small">กำลังโหลด...</div>}
        {!isLoading && filtered.length === 0 && <div className="text-center py-8 text-muted text-small">ไม่พบข้อมูล</div>}
        {filtered.map(n => (
          <div key={n.id} onClick={() => navigate(`/ncr/${n.id}`)}
            className="bg-surface border border-border rounded-lg p-3 active:bg-bg cursor-pointer"
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <span className="font-mono font-semibold text-primary text-body">{n.ncr_code}</span>
              <Badge status={ncrDisplayStatusKey(n)} />
            </div>
            <div className="text-small font-medium text-text mb-0.5">{n.supplier_name}</div>
            <div className="text-small text-muted mb-1">
              {n.items?.length > 1 ? `${n.items.length} รายการ` : (n.items?.[0]?.item_name || '-')}
            </div>
            <div className="flex items-center justify-between">
              <span className={`badge ${n.severity === 'major' ? 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200' : 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-200'}`}>
                {n.severity === 'major' ? 'NCR Major' : 'NCP Minor'}
              </span>
              <span className="text-small text-muted">{n.created_at?.slice(0, 10)}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block table-container">
        <table className="table">
          <thead>
            <tr>
              <th>รหัสเอกสาร</th>
              <th>Invoice No.</th>
              <th>รายการ</th>
              <th>Supplier</th>
              <th>ประเภท</th>
              <th>วันที่เปิด</th>
              <th>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} className="text-center py-6 text-muted">กำลังโหลด...</td></tr>}
            {!isLoading && filtered.length === 0 && <tr><td colSpan={7} className="text-center py-6 text-muted">ไม่พบข้อมูล</td></tr>}
            {filtered.map(n => (
              <tr key={n.id} onClick={() => navigate(`/ncr/${n.id}`)}>
                <td className="font-mono text-primary">{n.ncr_code}</td>
                <td className="font-mono">{n.invoice_no}</td>
                <td>{n.items?.length > 1 ? `${n.items.length} รายการ` : (n.items?.[0]?.item_name || '-')}</td>
                <td>{n.supplier_name}</td>
                <td>
                  <span className={`badge ${n.severity === 'major' ? 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200' : 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-200'}`}>
                    {n.severity === 'major' ? 'NCR Major' : 'NCP Minor'}
                  </span>
                </td>
                <td>{n.created_at?.slice(0, 10)}</td>
                <td><Badge status={ncrDisplayStatusKey(n)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
