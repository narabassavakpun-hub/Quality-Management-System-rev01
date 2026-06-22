import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../utils/api';
import Badge from '../../components/UI/Badge';
import Button from '../../components/UI/Button';
import SearchableSelect from '../../components/UI/SearchableSelect';

const NCR_STATUS_LABEL = {
  pending_supervisor: 'รอหัวหน้า QC',
  pending_manager: 'รอ QC Manager',
  pending_qmr_open: 'รอ QMR เปิด',
  pending_purchasing_review: 'รอจัดซื้อ Review',
  pending_supplier: 'รอ Supplier',
  pending_manager_review: 'รอ Manager ตรวจ',
  pending_supplier_resubmit: 'ถูกส่งกลับ',
  pending_qmr_close: 'รอ QMR ปิด',
  closed: 'ปิดแล้ว',
  ncp_closed: 'ปิดแล้ว',
};

function parseNcrDocs(raw) {
  if (!raw) return [];
  return raw.split(';;').map(s => {
    const [code, status, severity, creator, closed_at, created_at] = s.split('|');
    return { code, status, severity, creator, closed_at: closed_at || null, created_at: created_at || null };
  });
}

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('th-TH', { dateStyle: 'short' });
}

function fmtDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
}

function daysElapsed(fromIso, toIso = null) {
  if (!fromIso) return null;
  const from = new Date(fromIso).getTime();
  const to = toIso ? new Date(toIso).getTime() : Date.now();
  return Math.floor((to - from) / 86400000);
}

function getOverallStatus(bill, ncrDocs) {
  if (bill.status === 'draft')            return { label: 'ร่าง',                    cls: 'bg-gray-100 text-gray-600' };
  if (bill.status === 'pending_approval') return { label: 'รออนุมัติ',               cls: 'bg-yellow-100 text-yellow-700' };
  if (bill.status === 'cancelled')        return { label: 'ยกเลิก',                  cls: 'bg-red-100 text-red-600' };
  // approved
  if (bill.failed_item_count === 0)       return { label: 'เสร็จสิ้น',               cls: 'bg-green-100 text-green-700' };
  if (ncrDocs.length === 0)               return { label: 'รอเปิดเอกสาร NCR/NCP',   cls: 'bg-amber-100 text-amber-700' };
  const allClosed = bill.uncovered_failed_count === 0 &&
    ncrDocs.every(d => d.status === 'closed' || d.status === 'ncp_closed');
  if (allClosed)                          return { label: 'เสร็จสิ้น',               cls: 'bg-green-100 text-green-700' };
  return                                         { label: 'รอดำเนินการ',             cls: 'bg-blue-100 text-blue-700' };
}

function NextStepCell({ bill }) {
  const ncrDocs = parseNcrDocs(bill.ncr_docs);

  if (bill.status !== 'approved' || bill.failed_item_count === 0) {
    return <span className="text-muted text-xs">-</span>;
  }

  return (
    <div className="flex flex-col gap-1.5 items-center text-center">
      {bill.uncovered_failed_count > 0 && (
        <div className="text-xs text-amber-700 font-medium whitespace-nowrap">
          ออกเอกสาร NCR/NCP ({bill.uncovered_failed_count} รายการ)
        </div>
      )}
      {ncrDocs.map(doc => (
        <div key={doc.code} className="text-xs leading-snug whitespace-nowrap">
          <span className={`font-mono font-semibold ${doc.severity === 'major' ? 'text-danger' : 'text-yellow-700'}`}>
            {doc.code}
          </span>
          <span className="text-muted"> — {NCR_STATUS_LABEL[doc.status] || doc.status}</span>
        </div>
      ))}
    </div>
  );
}

function OverallStatusBadge({ bill }) {
  const ncrDocs = parseNcrDocs(bill.ncr_docs);
  const { label, cls } = getOverallStatus(bill, ncrDocs);
  return <span className={`badge ${cls} whitespace-nowrap !text-[10px]`}>{label}</span>;
}

function ElapsedTag({ days, closed }) {
  const cls = closed
    ? 'text-muted'
    : days >= 30 ? 'text-danger' : days >= 14 ? 'text-warning' : 'text-muted';
  const label = closed ? `ใช้เวลา ${days} วัน` : `ผ่านมา ${days} วัน`;
  return <div className={`text-xs ${cls}`}>({label})</div>;
}

function CloseDateCell({ bill }) {
  const ncrDocs = parseNcrDocs(bill.ncr_docs);

  // มี NCR/NCP — แสดงรายเอกสาร
  if (ncrDocs.length > 0) {
    return (
      <div className="flex flex-col gap-2 items-center text-center">
        {ncrDocs.map(doc => {
          const isClosed = doc.status === 'closed' || doc.status === 'ncp_closed';
          const days = isClosed
            ? daysElapsed(doc.created_at, doc.closed_at)
            : daysElapsed(doc.created_at);
          return (
            <div key={doc.code} className="text-xs">
              <div className="font-mono text-muted text-[11px]">{doc.code.split('-')[0]}</div>
              {isClosed && (
                <div className="whitespace-nowrap">{fmtDateTime(doc.closed_at)}</div>
              )}
              {days !== null && <ElapsedTag days={days} closed={isClosed} />}
            </div>
          );
        })}
      </div>
    );
  }

  // ร่าง → -
  if (bill.status === 'draft') {
    return <span className="text-muted text-xs">-</span>;
  }

  // เสร็จสิ้น (อนุมัติแล้ว ไม่มีรายการ fail) → ใช้เวลา x วัน
  if (bill.status === 'approved' && bill.failed_item_count === 0) {
    const days = daysElapsed(bill.created_at);
    return <ElapsedTag days={days} closed={true} />;
  }

  // รออนุมัติ หรือ approved แต่ยังรอออกเอกสาร → ผ่านมา x วัน
  const days = daysElapsed(bill.created_at);
  return <ElapsedTag days={days} closed={false} />;
}

// computed status values ที่ต้อง filter client-side (backend ส่ง approved มาก่อน)
const COMPUTED_STATUS = ['pending_ncr', 'in_progress', 'completed'];
const COMPUTED_LABEL = {
  pending_ncr: 'รอเปิดเอกสาร NCR/NCP',
  in_progress: 'รอดำเนินการ',
  completed: 'เสร็จสิ้น',
};

function todayTH() {
  return new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
}

export default function BillList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [todayOnly, setTodayOnly] = useState(false);
  const [creatorId, setCreatorId] = useState('');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;
  const [reportMenuOpen, setReportMenuOpen] = useState(false);
  const reportBtnRef = useRef(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportForm, setExportForm] = useState({
    supplier_id: '', from: '', to: '', invoice: '', po: '', container: '', doc_filter: 'all',
  });

  const deleteBill = useMutation({
    mutationFn: (id) => api.delete(`/bills/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bills'] });
      setDeleteConfirmId(null);
    },
  });
  useEffect(() => {
    if (!reportMenuOpen) return;
    function handleOutside(e) { if (!reportBtnRef.current?.contains(e.target)) setReportMenuOpen(false); }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [reportMenuOpen]);
  // computed status → ส่ง approved ไป backend แล้ว filter client-side
  const apiStatus = COMPUTED_STATUS.includes(statusFilter) ? 'approved' : statusFilter;

  const { data: billsRes, isLoading } = useQuery({
    queryKey: ['bills', apiStatus, search],
    queryFn: () => api.get(`/bills?limit=200${apiStatus ? `&status=${apiStatus}` : ''}${search ? `&q=${encodeURIComponent(search)}` : ''}`).then(r => r.data),
    refetchInterval: 30000,
  });

  const { data: creators = [] } = useQuery({
    queryKey: ['bill-creators'],
    queryFn: () => api.get('/bills/creators').then(r => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers-all'],
    queryFn: () => api.get('/master/suppliers').then(r => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const setExp = (k, v) => setExportForm(p => ({ ...p, [k]: v }));
  const runExport = () => {
    const qs = new URLSearchParams();
    Object.entries(exportForm).forEach(([k, v]) => { if (v) qs.set(k, v); });
    window.open(`/api/reports/bills/excel?${qs.toString()}`, '_blank');
    setExportOpen(false);
  };

  const bills = Array.isArray(billsRes) ? billsRes : (billsRes?.data ?? []);

  const today = todayTH();
  const filtered = bills.filter(b => {
    if (search && !(
      (b.invoice_no || '').toLowerCase().includes(search.toLowerCase()) ||
      (b.po_no || '').toLowerCase().includes(search.toLowerCase()) ||
      (b.container_no || '').toLowerCase().includes(search.toLowerCase()) ||
      (b.supplier_name || '').toLowerCase().includes(search.toLowerCase())
    )) return false;
    if (todayOnly && b.received_date !== today) return false;
    if (creatorId && String(b.created_by) !== String(creatorId)) return false;
    if (COMPUTED_STATUS.includes(statusFilter)) {
      const ncrDocs = parseNcrDocs(b.ncr_docs);
      const { label } = getOverallStatus(b, ncrDocs);
      if (label !== COMPUTED_LABEL[statusFilter]) return false;
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // reset หน้าเมื่อ filter เปลี่ยน
  useEffect(() => { setPage(1); }, [search, statusFilter, todayOnly, creatorId]);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">บิลรับเข้า</h1>
        <div className="flex items-center gap-2">
          {/* Report dropdown */}
          <div className="relative" ref={reportBtnRef}>
            <button
              onClick={() => setReportMenuOpen(o => !o)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-surface hover:bg-bg text-small font-medium text-text transition-colors min-h-[44px]"
            >
              <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              สรุปรับเข้าวันนี้
              <svg className={`w-3 h-3 transition-transform ${reportMenuOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {reportMenuOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 bg-surface border border-border rounded-lg shadow-lg overflow-hidden min-w-[150px]">
                <a
                  href="/api/reports/receiving/today/jpg"
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setReportMenuOpen(false)}
                  className="flex items-center gap-2 px-4 py-2.5 text-small text-text hover:bg-bg transition-colors"
                >
                  <svg className="w-4 h-4 flex-shrink-0 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Export JPG
                </a>
                <a
                  href="/api/reports/receiving/today/pdf"
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setReportMenuOpen(false)}
                  className="flex items-center gap-2 px-4 py-2.5 text-small text-text hover:bg-bg transition-colors border-t border-border"
                >
                  <svg className="w-4 h-4 flex-shrink-0 text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  Export PDF
                </a>
                <a
                  href="/api/reports/receiving/today/excel"
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setReportMenuOpen(false)}
                  className="flex items-center gap-2 px-4 py-2.5 text-small text-text hover:bg-bg transition-colors border-t border-border"
                >
                  <svg className="w-4 h-4 flex-shrink-0 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Export Excel
                </a>
              </div>
            )}
          </div>
          <button
            onClick={() => setExportOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-surface hover:bg-bg text-small font-medium text-text transition-colors min-h-[44px]"
          >
            <svg className="w-4 h-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export ข้อมูลบิล
          </button>
          {user?.role === 'qc_staff' && <Button onClick={() => navigate('/bills/new')}>+ สร้างบิลใหม่</Button>}
        </div>
      </div>

      <div className="flex gap-3 mb-4 flex-wrap items-center">
        <input className="input max-w-xs" placeholder="ค้นหา Invoice / PO / Container / Supplier" value={search} onChange={e => setSearch(e.target.value)} />
        <select className="input w-auto" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">ทุกสถานะ</option>
          <option value="draft">ร่าง</option>
          <option value="pending_approval">รออนุมัติ</option>
          <option value="pending_ncr">รอเปิดเอกสาร NCR/NCP</option>
          <option value="in_progress">รอดำเนินการ</option>
          <option value="completed">เสร็จสิ้น</option>
          <option value="cancelled">ยกเลิก</option>
        </select>
        <SearchableSelect
          options={creators.map(c => ({ value: c.id, label: c.full_name }))}
          value={creatorId}
          onChange={setCreatorId}
          placeholder="ผู้ออกเอกสาร (ทั้งหมด)"
        />
        <label className="flex items-center gap-2 text-body text-text cursor-pointer select-none whitespace-nowrap">
          <input type="checkbox" checked={todayOnly} onChange={e => setTodayOnly(e.target.checked)} className="w-4 h-4 accent-primary" />
          วันนี้รับเข้า
        </label>
      </div>

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th className="w-10 text-center">No.</th>
              <th>Invoice No.</th>
              <th>PO No.</th>
              <th>Container No.</th>
              <th>Supplier</th>
              <th>วันที่รับ</th>
              <th>รายการ</th>
              <th>ผู้ออกเอกสาร</th>
              <th>วันที่ออกเอกสาร</th>
              <th>ขั้นตอนถัดไป</th>
              <th>วันที่ปิดเอกสาร</th>
              <th>สถานะ</th>
              {user?.role === 'qc_staff' && <th className="w-10"></th>}
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={user?.role === 'qc_staff' ? 13 : 12} className="text-center py-6 text-muted">กำลังโหลด...</td></tr>}
            {!isLoading && filtered.length === 0 && <tr><td colSpan={user?.role === 'qc_staff' ? 13 : 12} className="text-center py-6 text-muted">ไม่พบข้อมูล</td></tr>}
            {pageRows.map((b, i) => (
              <tr key={b.id} onClick={() => navigate(`/bills/${b.id}`)}>
                <td className="text-center text-muted text-small">{(safePage - 1) * PAGE_SIZE + i + 1}</td>
                <td className="font-mono text-small">{b.invoice_no}</td>
                <td className="font-mono text-small">{b.po_no}</td>
                <td className="font-mono text-small">{b.container_no || '-'}</td>
                <td className="text-small">{b.supplier_name}</td>
                <td className="text-small whitespace-nowrap">{b.received_date}</td>
                <td className="text-small">{b.item_count || 0}</td>
                <td className="text-small">{b.created_by_name || '-'}</td>
                <td className="text-small whitespace-nowrap">{b.created_at ? new Date(b.created_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '-'}</td>
                <td><NextStepCell bill={b} /></td>
                <td><CloseDateCell bill={b} /></td>
                <td><OverallStatusBadge bill={b} /></td>
                {user?.role === 'qc_staff' && (
                  <td className="text-center" onClick={e => e.stopPropagation()}>
                    {b.status === 'draft' && (
                      <button
                        onClick={() => setDeleteConfirmId(b.id)}
                        className="p-1.5 rounded text-danger hover:bg-red-50 transition-colors"
                        title="ลบบิล"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {!isLoading && Array.from({ length: PAGE_SIZE - pageRows.length }, (_, i) => (
              <tr key={`pad-${i}`} aria-hidden="true" className="pointer-events-none">
                <td colSpan={user?.role === 'qc_staff' ? 13 : 12} className="h-[41px] p-0 border-b border-border" />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!isLoading && filtered.length > 0 && (
        <div className="flex items-center justify-between mt-4 flex-wrap gap-2">
          <div className="text-small text-muted">
            แสดง {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} จาก {filtered.length} รายการ
          </div>
          <div className="flex items-center gap-1">
            <button
              className="px-3 py-1.5 rounded border border-border text-small text-text bg-surface disabled:opacity-40 disabled:cursor-not-allowed hover:bg-bg"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={safePage === 1}
            >
              ก่อนหน้า
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(n => n === 1 || n === totalPages || Math.abs(n - safePage) <= 2)
              .reduce((acc, n, i, arr) => {
                if (i > 0 && n - arr[i - 1] > 1) acc.push('…');
                acc.push(n);
                return acc;
              }, [])
              .map((n, i) =>
                n === '…'
                  ? <span key={`ellipsis-${i}`} className="px-2 text-muted text-small">…</span>
                  : <button
                      key={n}
                      className={`px-3 py-1.5 rounded border text-small ${safePage === n ? 'bg-primary text-white border-primary font-semibold' : 'border-border text-text bg-surface hover:bg-bg'}`}
                      onClick={() => setPage(n)}
                    >
                      {n}
                    </button>
              )
            }
            <button
              className="px-3 py-1.5 rounded border border-border text-small text-text bg-surface disabled:opacity-40 disabled:cursor-not-allowed hover:bg-bg"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={safePage === totalPages}
            >
              ถัดไป
            </button>
          </div>
        </div>
      )}

      {exportOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setExportOpen(false)}>
          <div className="bg-surface rounded-xl w-full max-w-lg shadow-xl p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-h3 text-text mb-1">Export ข้อมูลบิลรับเข้า</h3>
            <p className="text-small text-muted mb-4">เลือกเงื่อนไขที่ต้องการ (เว้นว่าง = ไม่กรอง) แล้วดาวน์โหลดเป็น Excel</p>
            <div className="space-y-3">
              <div>
                <label className="label">ผู้ผลิต</label>
                <SearchableSelect
                  options={suppliers.map(s => ({ value: s.id, label: s.name }))}
                  value={exportForm.supplier_id}
                  onChange={v => setExp('supplier_id', v)}
                  placeholder="ผู้ผลิตทั้งหมด"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">รับเข้าตั้งแต่วันที่</label>
                  <input type="date" className="input" value={exportForm.from} onChange={e => setExp('from', e.target.value)} />
                </div>
                <div>
                  <label className="label">ถึงวันที่</label>
                  <input type="date" className="input" value={exportForm.to} onChange={e => setExp('to', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="label">Invoice No.</label>
                  <input className="input" value={exportForm.invoice} onChange={e => setExp('invoice', e.target.value)} placeholder="บางส่วนได้" />
                </div>
                <div>
                  <label className="label">PO No.</label>
                  <input className="input" value={exportForm.po} onChange={e => setExp('po', e.target.value)} placeholder="บางส่วนได้" />
                </div>
                <div>
                  <label className="label">Container No.</label>
                  <input className="input" value={exportForm.container} onChange={e => setExp('container', e.target.value)} placeholder="บางส่วนได้" />
                </div>
              </div>
              <div>
                <label className="label">เอกสาร NCR / NCP</label>
                <select className="input" value={exportForm.doc_filter} onChange={e => setExp('doc_filter', e.target.value)}>
                  <option value="all">ทั้งหมด (ไม่กรอง)</option>
                  <option value="ncr">เฉพาะบิลที่มี NCR (Major)</option>
                  <option value="ncp">เฉพาะบิลที่มี NCP (Minor)</option>
                  <option value="both">มีทั้ง NCR และ NCP</option>
                  <option value="any">มี NCR หรือ NCP</option>
                  <option value="none">ไม่มีเอกสาร NCR/NCP</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-5">
              <button onClick={() => setExportOpen(false)} className="btn-secondary min-h-[44px] px-4">ยกเลิก</button>
              <button onClick={runExport} className="min-h-[44px] px-4 bg-success text-white rounded-lg font-medium hover:bg-green-700 transition-colors">
                Export Excel
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteConfirmId && (() => {
        const bill = bills.find(b => b.id === deleteConfirmId);
        return (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-surface rounded-xl w-full max-w-sm shadow-xl p-5">
              <h3 className="font-semibold text-h3 text-text mb-2">ลบบิลร่าง</h3>
              <p className="text-body text-muted mb-1">
                ยืนยันลบ Invoice <span className="font-mono font-semibold text-text">{bill?.invoice_no}</span>?
              </p>
              <p className="text-small text-danger mb-4">ข้อมูลบิลและรายการสินค้าจะถูกลบถาวร</p>
              <div className="flex gap-2">
                <button
                  onClick={() => { setDeleteConfirmId(null); deleteBill.reset(); }}
                  disabled={deleteBill.isPending}
                  className="btn-secondary flex-1 min-h-[44px]"
                >
                  ยกเลิก
                </button>
                <button
                  onClick={() => deleteBill.mutate(deleteConfirmId)}
                  disabled={deleteBill.isPending}
                  className="flex-1 min-h-[44px] bg-danger text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  {deleteBill.isPending ? 'กำลังลบ...' : 'ลบบิล'}
                </button>
              </div>
              {deleteBill.isError && (
                <p className="text-small text-danger mt-2 text-center">
                  {deleteBill.error?.response?.data?.error || 'เกิดข้อผิดพลาด'}
                </p>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
