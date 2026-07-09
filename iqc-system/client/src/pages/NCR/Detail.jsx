import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import api, { downloadFile } from '../../utils/api';
import Badge from '../../components/UI/Badge';
import Button from '../../components/UI/Button';
import Modal from '../../components/UI/Modal';
import ConfirmDialog from '../../components/UI/ConfirmDialog';
import ImageUploadPair from '../../components/UI/ImageUploadPair';

const DISPOSITION_LABELS = {
  return: 'ส่งคืน Supplier (Return)',
  rework: 'แก้ไข (Rework)',
  uai: 'ยอมรับใช้พิเศษ (UAI)',
  scrap: 'ทำลาย (Scrap)',
  re_inspect: 'ตรวจซ้ำ (Re-inspect)',
};

function getProcessLabel(a, approvals, i, ncr) {
  if (a.action === 'rejected_response') return 'QC Manager ไม่อนุมัติคำตอบ Supplier';
  if (a.action === 'resubmit') return 'จัดซื้อส่ง Supplier ตอบใหม่';
  if (a.role === 'qc_supervisor') {
    return ncr?.severity === 'minor' ? 'หัวหน้า QC อนุมัติปิด NCP' : 'หัวหน้า QC ตรวจสอบ NCR';
  }
  if (a.role === 'qc_manager') return 'QC Manager พิจารณาอนุมัติ';
  if (a.role === 'qmr') {
    const qmrsBefore = approvals.slice(0, i).filter(x => x.role === 'qmr').length;
    return qmrsBefore === 0 ? 'QMR อนุมัติเปิด NCR' : 'QMR อนุมัติปิด NCR';
  }
  if (a.role === 'purchasing') return 'จัดซื้อ ส่ง Link Supplier';
  return a.role;
}

function ApprovalTimeline({ approvals, ncr }) {
  const supplierResponse = ncr?.supplier_response;

  // รวมทุก event เรียงตาม timestamp
  const events = [
    ...(approvals || []).map(a => ({ type: 'approval', ts: a.created_at, data: a })),
    ...(supplierResponse ? [{ type: 'supplier', ts: supplierResponse.submitted_at, data: supplierResponse }] : []),
    ...(ncr?.purchasing_received_at ? [{ type: 'purchasing_received', ts: ncr.purchasing_received_at, data: { name: ncr.purchasing_received_by_name } }] : []),
    ...(ncr?.link_copied_at ? [{ type: 'link_copied', ts: ncr.link_copied_at, data: { name: ncr.link_copied_by_name, count: ncr.link_copied_count } }] : []),
  ].sort((a, b) => new Date(a.ts) - new Date(b.ts));

  if (!events.length) return null;

  // index ของ approval entries เท่านั้น (สำหรับ getProcessLabel และ disposition)
  const approvalEvents = events.filter(e => e.type === 'approval');
  const firstQcManagerIdx = approvalEvents.findIndex(a => a.data.role === 'qc_manager');

  return (
    <div className="space-y-3">
      {events.map((ev, i) => {
        const isLast = i === events.length - 1;
        const connector = !isLast && <div className="w-0.5 h-full bg-border mt-1" />;

        if (ev.type === 'purchasing_received') {
          return (
            <div key={`pr-${ev.ts}`} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className="w-8 h-8 rounded-full bg-teal-600 text-white flex items-center justify-center text-small font-bold">{i + 1}</div>
                {connector}
              </div>
              <div className="pb-4 flex-1">
                <div className="text-[12px] font-semibold text-teal-700 dark:text-teal-200 uppercase tracking-wide mb-0.5">จัดซื้อได้รับเอกสาร NCR</div>
                <div className="text-body font-medium">{ev.data.name || 'จัดซื้อ'} <span className="text-small text-muted">(purchasing)</span></div>
                <div className="text-small text-muted">{new Date(ev.ts + 'Z').toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}</div>
              </div>
            </div>
          );
        }

        if (ev.type === 'link_copied') {
          return (
            <div key={`lc-${ev.ts}`} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className="w-8 h-8 rounded-full bg-amber-500 text-white flex items-center justify-center text-small font-bold">{i + 1}</div>
                {connector}
              </div>
              <div className="pb-4 flex-1">
                <div className="text-[12px] font-semibold text-amber-600 dark:text-amber-200 uppercase tracking-wide mb-0.5">จัดซื้อ Copy Link ให้ Supplier</div>
                <div className="text-body font-medium">{ev.data.name || 'จัดซื้อ'} <span className="text-small text-muted">(purchasing)</span></div>
                <div className="text-small text-muted">{new Date(ev.ts + 'Z').toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}</div>
                {ev.data.count > 1 && <div className="text-small text-muted mt-0.5">คัดลอกทั้งหมด {ev.data.count} ครั้ง</div>}
              </div>
            </div>
          );
        }

        if (ev.type === 'supplier') {
          const sr = ev.data;
          return (
            <div key={`sr-${sr.id}`} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className="w-8 h-8 rounded-full bg-orange-500 text-white flex items-center justify-center text-small font-bold">{i + 1}</div>
                {connector}
              </div>
              <div className="pb-4 flex-1">
                <div className="text-[12px] font-semibold text-orange-600 dark:text-orange-200 uppercase tracking-wide mb-0.5">Supplier ตอบกลับ</div>
                <div className="text-body font-medium">{sr.respondent_name || ncr.supplier_name || 'Supplier'}{sr.respondent_name && ncr.supplier_name ? <span className="text-small text-muted font-normal"> ({ncr.supplier_name})</span> : null}</div>
                <div className="text-small text-muted">{new Date(sr.submitted_at + 'Z').toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}</div>
                <div className="mt-2 bg-orange-50 dark:bg-orange-900 border border-orange-200 dark:border-orange-700 rounded px-3 py-2 space-y-1">
                  {sr.root_cause && <div className="text-small"><span className="text-muted">สาเหตุหลัก: </span>{sr.root_cause}</div>}
                  {sr.corrective_action && <div className="text-small"><span className="text-muted">การแก้ไข: </span>{sr.corrective_action}</div>}
                  {sr.preventive_action && <div className="text-small"><span className="text-muted">การป้องกัน: </span>{sr.preventive_action}</div>}
                  {sr.completion_date && <div className="text-small"><span className="text-muted">วันที่แก้ไขแล้วเสร็จ: </span>{sr.completion_date}</div>}
                </div>
              </div>
            </div>
          );
        }

        // approval entry
        const a = ev.data;
        const approvalIdx = approvalEvents.findIndex(ae => ae.data.id === a.id);
        const processLabel = getProcessLabel(a, approvalEvents.map(ae => ae.data), approvalIdx, ncr);
        const showDisposition = approvalIdx === firstQcManagerIdx && ncr?.disposition;
        const isRejection = a.action === 'rejected_response';
        const isResubmit = a.action === 'resubmit';

        return (
          <div key={a.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className={`w-8 h-8 rounded-full text-white flex items-center justify-center text-small font-bold ${isRejection ? 'bg-danger' : isResubmit ? 'bg-amber-500' : 'bg-primary'}`}>{i + 1}</div>
              {connector}
            </div>
            <div className="pb-4 flex-1">
              <div className={`text-[12px] font-semibold uppercase tracking-wide mb-0.5 ${isRejection ? 'text-danger' : isResubmit ? 'text-amber-600 dark:text-amber-200' : 'text-accent'}`}>{processLabel}</div>
              <div className="text-body font-medium">{a.full_name || a.role} <span className="text-small text-muted">({a.role})</span></div>
              <div className="text-small text-muted">{new Date(a.created_at + 'Z').toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}</div>
              {a.comment && <div className={`text-small mt-1 px-2 py-1 rounded ${isRejection ? 'bg-red-50 dark:bg-red-900 text-danger' : 'text-text bg-bg'}`}>{a.comment}</div>}
              {showDisposition && (
                <div className="mt-2 bg-blue-50 dark:bg-blue-900 border border-blue-200 dark:border-blue-700 rounded px-3 py-2 space-y-0.5">
                  <div className="text-small font-medium text-primary mb-1">ผลการวินิจฉัย (Disposition)</div>
                  <div className="text-small"><span className="text-muted">การจัดการ: </span><span className="font-medium">{DISPOSITION_LABELS[ncr.disposition] || ncr.disposition}</span></div>
                  {ncr.disposition_note && <div className="text-small"><span className="text-muted">หมายเหตุ: </span>{ncr.disposition_note}</div>}
                  {ncr.disposition_due_date && <div className="text-small"><span className="text-muted">วันกำหนดดำเนินการ: </span>{ncr.disposition_due_date}</div>}
                  {ncr.effectiveness_check_date && <div className="text-small"><span className="text-muted">วันตรวจสอบการแก้ไข: </span>{ncr.effectiveness_check_date}</div>}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function NCRDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [comment, setComment] = useState('');
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [uaiOpen, setUaiOpen] = useState(false);
  const [uaiForm, setUaiForm] = useState({
    reason: '', conditions: '', department: '',
    product_type: '', work_type: '',
    defect_description: '', root_cause_purchasing: '',
    corrective_action_purchasing: '', preventive_action_purchasing: '',
  });
  const [uaiImages, setUaiImages] = useState([]);
  const [uaiError, setUaiError] = useState('');
  const [billImagesOpen, setBillImagesOpen] = useState(false);
  const [disposition, setDisposition] = useState('');
  const [dispositionNote, setDispositionNote] = useState('');
  const [dispositionDueDate, setDispositionDueDate] = useState('');
  const [effectivenessCheckDate, setEffectivenessCheckDate] = useState('');
  const [approveError, setApproveError] = useState('');
  const [copyToast, setCopyToast] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectComment, setRejectComment] = useState('');
  const [rejectError, setRejectError] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewItems, setReviewItems] = useState([]);
  const [reviewError, setReviewError] = useState('');

  const { data: ncr, isLoading } = useQuery({
    queryKey: ['ncr', id],
    queryFn: () => api.get(`/ncr/${id}`).then(r => r.data),
  });

  const approve = useMutation({
    mutationFn: () => {
      // client-side validation สำหรับ QC Manager
      if (ncr?.status === 'pending_manager') {
        if (!disposition) { setApproveError('กรุณาเลือก Disposition'); return Promise.reject(new Error('กรุณาเลือก Disposition')); }
        if (!effectivenessCheckDate) { setApproveError('กรุณาระบุวันตรวจสอบการแก้ไข'); return Promise.reject(new Error('กรุณาระบุวันตรวจสอบการแก้ไข')); }
      }
      setApproveError('');
      return api.post(`/ncr/${id}/approve`, {
        comment,
        ...(ncr?.status === 'pending_manager' && {
          disposition,
          disposition_note: dispositionNote || undefined,
          disposition_due_date: dispositionDueDate || undefined,
          effectiveness_check_date: effectivenessCheckDate,
        }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries(['ncr', id]);
      setConfirmApprove(false);
      setDisposition('');
      setDispositionNote('');
      setDispositionDueDate('');
      setEffectivenessCheckDate('');
      setApproveError('');
    },
    onError: (err) => setApproveError(err.response?.data?.error || err.message || 'เกิดข้อผิดพลาด'),
  });

  const requestUAI = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/ncr/${id}/request-uai`, uaiForm);
      if (uaiImages.length > 0) {
        const fd = new FormData();
        uaiImages.forEach(f => fd.append('images', f));
        await api.post(`/uai/${data.uai_id}/images`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
      return data;
    },
    onSuccess: (data) => { navigate(`/uai/${data.uai_id}`); },
    onError: (err) => setUaiError(err.response?.data?.error || err.message || 'เกิดข้อผิดพลาด'),
  });

  const regenerateToken = useMutation({
    mutationFn: () => api.post(`/ncr/${id}/regenerate-token`).then(r => r.data),
    onSuccess: (data) => {
      qc.invalidateQueries(['ncr', id]);
      copyToClipboard(data.link);
    },
  });

  const acknowledge = useMutation({
    mutationFn: () => api.post(`/ncr/${id}/purchasing-acknowledge`),
    onSuccess: () => qc.invalidateQueries(['ncr', id]),
  });

  const recordLinkCopy = useMutation({
    mutationFn: () => api.post(`/ncr/${id}/record-link-copy`),
    onSuccess: () => qc.invalidateQueries(['ncr', id]),
  });

  const copyToClipboard = (text) => {
    const onDone = () => {
      setCopyToast(true);
      setTimeout(() => setCopyToast(false), 2500);
      recordLinkCopy.mutate();
    };
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try { document.execCommand('copy'); } catch {}
      document.body.removeChild(ta);
      onDone();
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(onDone).catch(fallback);
    } else {
      fallback();
    }
  };

  const rejectResponse = useMutation({
    mutationFn: () => api.post(`/ncr/${id}/reject-supplier-response`, { comment: rejectComment }),
    onSuccess: () => { qc.invalidateQueries(['ncr', id]); setRejectOpen(false); setRejectComment(''); setRejectError(''); },
    onError: (err) => setRejectError(err.response?.data?.error || err.message || 'เกิดข้อผิดพลาด'),
  });

  const resubmitToSupplier = useMutation({
    mutationFn: () => api.post(`/ncr/${id}/resubmit-to-supplier`),
    onSuccess: () => qc.invalidateQueries(['ncr', id]),
  });

  const purchasingReview = useMutation({
    mutationFn: () => api.patch(`/ncr/${id}/purchasing-review`, { items: reviewItems }),
    onSuccess: () => {
      qc.invalidateQueries(['ncr', id]);
      setReviewOpen(false);
      setReviewError('');
    },
    onError: (err) => setReviewError(err.response?.data?.error || err.message || 'เกิดข้อผิดพลาด'),
  });

  const openReview = () => {
    setReviewItems((ncr?.items || []).map(item => ({
      id: item.id,
      item_name: item.item_name,
      defect_detail: item.defect_detail || '',
      item_name_en: item.item_name_en || '',
      defect_detail_en: item.defect_detail_en || '',
    })));
    setReviewError('');
    setReviewOpen(true);
  };

  const updateReviewItem = (idx, field, value) =>
    setReviewItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it));

  const handleCopyLink = () => {
    const isExpired = ncr?.token_expires_at && new Date(ncr.token_expires_at) < new Date();
    if (isExpired) {
      regenerateToken.mutate();
    } else {
      copyToClipboard(ncr.supplier_link || `${window.location.origin}/supplier/ncr/${ncr.supplier_token}`);
    }
  };

  if (isLoading) return <div className="text-muted py-8 text-center">กำลังโหลด...</div>;
  if (!ncr) return <div className="text-danger py-8 text-center">ไม่พบข้อมูล</div>;

  const isNCP = ncr.severity === 'minor';

  const canApprove = isNCP
    ? (user?.role === 'qc_supervisor' && ncr.status === 'pending_supervisor')
    : {
        qc_supervisor: ncr.status === 'pending_supervisor',
        qc_manager: ncr.status === 'pending_manager' || ncr.status === 'pending_manager_review',
        qmr: ncr.status === 'pending_qmr_open' || ncr.status === 'pending_qmr_close',
      }[user?.role];

  const canRejectResponse = !isNCP && user?.role === 'qc_manager' && ncr.status === 'pending_manager_review';
  const canResubmit = !isNCP && user?.role === 'purchasing' && ncr.status === 'pending_supplier_resubmit';
  const canRequestUAI = !isNCP && user?.role === 'purchasing' && ncr.status === 'pending_supplier';
  const canCopyLink = !isNCP && user?.role === 'purchasing' && ['pending_purchasing_review', 'pending_supplier', 'uai_pending_qc_manager'].includes(ncr.status);
  const canAcknowledge = !isNCP && user?.role === 'purchasing' && ncr.status === 'pending_supplier' && !ncr.purchasing_received_at;
  const canReview = !isNCP && user?.role === 'purchasing' && ncr.status === 'pending_purchasing_review';
  const tokenExpired = ncr.token_expires_at && new Date(ncr.token_expires_at) < new Date();

  const approveLabel = isNCP
    ? { pending_supervisor: 'อนุมัติปิดเอกสาร NCP' }[ncr.status]
    : {
        pending_supervisor: 'อนุมัติ (ส่ง QC Manager)',
        pending_manager: 'อนุมัติเปิด NCR (ส่ง QMR)',
        pending_qmr_open: 'อนุมัติเปิดเอกสาร NCR',
        pending_manager_review: 'ลงชื่อ (ส่ง QMR ปิด)',
        pending_qmr_close: 'ปิดเอกสาร NCR',
      }[ncr.status];

  return (
    <div className="space-y-4">
      <button onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1.5 text-muted hover:text-text text-small min-h-[44px] -ml-1">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        กลับ
      </button>
      <div className="page-header flex-wrap gap-3">
        <div>
          <h1 className="page-title">{ncr.ncr_code}</h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge status={ncr.status} />
            <span className={`badge ${isNCP ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-200' : 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200'}`}>
              {isNCP ? 'NCP Minor — บันทึกภายใน' : 'NCR Major'}
            </span>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {canResubmit && (
            <Button variant="warning" onClick={() => resubmitToSupplier.mutate()} loading={resubmitToSupplier.isPending}>
              ทุกอย่างกลับมาเหมือนเดิม — ส่ง Supplier ตอบใหม่
            </Button>
          )}
          {canAcknowledge && (
            <Button variant="secondary" onClick={() => acknowledge.mutate()} loading={acknowledge.isPending}>
              รับทราบเอกสาร NCR
            </Button>
          )}
          {canReview && (
            <Button variant="primary" onClick={openReview}>
              Review + เพิ่มคำแปลภาษาอังกฤษ
            </Button>
          )}
          {canCopyLink && (
            <Button
              variant="secondary"
              onClick={handleCopyLink}
              loading={regenerateToken.isPending}
              title={tokenExpired ? 'Token หมดอายุ — จะสร้าง Token ใหม่อัตโนมัติ' : 'คัดลอก Link สำหรับ Supplier'}
            >
              {tokenExpired ? 'สร้าง Token ใหม่ + คัดลอก Link' : 'คัดลอก Link Supplier'}
            </Button>
          )}
          {canRequestUAI && <Button variant="warning" onClick={() => { setUaiError(''); setUaiOpen(true); }}>ขอยอมรับใช้พิเศษ (UAI)</Button>}
          {canRejectResponse && (
            <Button variant="danger" onClick={() => { setRejectComment(''); setRejectError(''); setRejectOpen(true); }}>
              ไม่อนุมัติ
            </Button>
          )}
          {canApprove && <Button variant="success" onClick={() => setConfirmApprove(true)}>{approveLabel}</Button>}
          <button onClick={() => downloadFile(`/ncr/${id}/excel`, {}, `${ncr.ncr_code || id}.xlsx`)} className="btn-secondary btn text-small">Export Excel</button>
          <button onClick={() => downloadFile(`/ncr/${id}/pdf`, {}, `${ncr.ncr_code || id}.pdf`)} className="btn-primary btn text-small">Export PDF</button>
        </div>
      </div>

      <div className="card">
        <h2 className="text-h3 font-semibold text-primary mb-3">ข้อมูล NCR</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div>
            <div className="text-small text-muted">Invoice No.</div>
            <button
              type="button"
              onClick={() => setBillImagesOpen(true)}
              className="text-body font-medium font-mono text-accent hover:underline text-left"
              title="คลิกเพื่อดูรูปถ่ายบิล"
            >
              {ncr.invoice_no}
            </button>
          </div>
          {[
            ['PO No.', ncr.po_no, 'font-mono'],
            ['Supplier', ncr.supplier_name || '-', ''],
            ['รับเข้าโดย', ncr.bill_received_by_name || '-', ''],
            ['รับเข้าเมื่อ', ncr.bill_received_date || '-', ''],
            ['วันที่ออกเอกสาร', ncr.created_at?.slice(0, 10), ''],
          ].map(([label, value, cls]) => (
            <div key={label}><div className="text-small text-muted">{label}</div><div className={`text-body font-medium ${cls}`}>{value}</div></div>
          ))}
        </div>

        {ncr.items?.length > 0 && (
          <div className="mt-4 space-y-3">
            <div className="text-small text-muted font-medium">รายการสินค้าในใบ NCR</div>
            {ncr.items.map((item, i) => (
              <div key={i} className="border border-border rounded-lg overflow-hidden">
                {/* ข้อมูลรายการ */}
                <div className="bg-red-50 dark:bg-red-900 px-3 py-2 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1">
                  <div className="col-span-2 sm:col-span-3">
                    <span className="font-medium text-body">{item.item_name}</span>
                  </div>
                  <div className="text-small">
                    <span className="text-muted">รับเข้า: </span>
                    <span className="font-mono font-medium">{item.qty_received}</span>
                  </div>
                  <div className="text-small">
                    <span className="text-muted">สุ่มตรวจ: </span>
                    <span className="font-mono font-medium">{item.qty_sampled}</span>
                  </div>
                  <div className="text-small">
                    <span className="text-muted">ไม่ผ่าน: </span>
                    <span className="font-mono font-bold text-danger">{item.qty_failed}</span>
                  </div>
                  {item.defect_category_name && (
                    <div className="text-small col-span-2 sm:col-span-1">
                      <span className="text-muted">กลุ่มปัญหา: </span>
                      <span className="font-medium">{item.defect_category_name}</span>
                    </div>
                  )}
                  {item.defect_detail && (
                    <div className="text-small col-span-2 sm:col-span-3">
                      <span className="text-muted">รายละเอียด: </span>
                      {item.defect_detail}
                    </div>
                  )}
                </div>
                {/* รูปภาพปัญหาจากบิล */}
                {item.bill_item_images?.length > 0 && (
                  <div className="px-3 py-2 bg-surface border-t border-border">
                    <div className="text-small text-muted mb-1.5">รูปภาพปัญหา ({item.bill_item_images.length} รูป)</div>
                    <div className="flex flex-wrap gap-2">
                      {item.bill_item_images.map(img => (
                        <a key={img.id} href={`/uploads/bill-items/${img.file_path}`} target="_blank" rel="noreferrer">
                          <img
                            src={`/uploads/bill-items/${img.file_path}`}
                            alt=""
                            className="h-24 w-24 object-cover rounded border border-red-200 dark:border-red-700 hover:opacity-80"
                          />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* รูปเพิ่มเติมที่แนบตอนออก NCR (ถ้ามี) */}
      {ncr.images?.length > 0 && (
        <div className="card">
          <h2 className="text-h3 font-semibold text-primary mb-3">รูปภาพเพิ่มเติม</h2>
          <div className="flex flex-wrap gap-2">
            {ncr.images.map(img => (
              <a key={img.id} href={`/uploads/ncr/${img.file_path}`} target="_blank" rel="noreferrer">
                <img src={`/uploads/ncr/${img.file_path}`} alt="" className="h-28 w-28 object-cover rounded border border-border hover:opacity-80" />
              </a>
            ))}
          </div>
        </div>
      )}

      {ncr.status === 'pending_supplier_resubmit' && (() => {
        const rejection = [...(ncr.approvals || [])].reverse().find(a => a.action === 'rejected_response');
        return (
          <div className="card bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700">
            <div className="text-small font-semibold text-danger mb-1">QC Manager ไม่อนุมัติคำตอบ Supplier</div>
            {rejection && (
              <>
                <div className="text-small text-muted">โดย: {rejection.full_name} — {new Date(rejection.created_at + 'Z').toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}</div>
                {rejection.comment && <div className="text-small text-text mt-1 bg-surface border border-red-200 dark:border-red-700 rounded px-2 py-1">{rejection.comment}</div>}
              </>
            )}
            {user?.role === 'purchasing' && (
              <div className="mt-2 text-small text-muted">กรุณากดปุ่ม "ทุกอย่างกลับมาเหมือนเดิม" เพื่อรีเซ็ตและส่งให้ Supplier ตอบใหม่</div>
            )}
          </div>
        );
      })()}

      {isNCP && ncr.status === 'ncp_closed' && (
        <div className="card bg-teal-50 dark:bg-teal-900 border border-teal-200 dark:border-teal-700">
          <div className="text-small font-medium text-teal-700 dark:text-teal-200">เอกสาร NCP ปิดแล้ว — บันทึกไว้เพื่อวิเคราะห์จุดบกพร่องสะสมของ Supplier</div>
        </div>
      )}

      {!isNCP && ncr.supplier_response && (
        <div className="card">
          <h2 className="text-h3 font-semibold text-primary mb-3">คำตอบ Supplier</h2>
          <div className="space-y-2">
            {[
              ['ผู้ตอบ / Respondent', ncr.supplier_response.respondent_name || '-'],
              ['Root Cause', ncr.supplier_response.root_cause],
              ['Corrective Action', ncr.supplier_response.corrective_action],
              ['Preventive Action', ncr.supplier_response.preventive_action],
              ['วันที่แก้ไขแล้วเสร็จ', ncr.supplier_response.completion_date || '-'],
            ].map(([label, value]) => (
              <div key={label}><div className="text-small text-muted">{label}</div><div className="text-body mt-0.5">{value}</div></div>
            ))}
          </div>
          {ncr.supplier_response.attachments?.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border">
              <div className="text-small text-muted mb-2">หลักฐานการแก้ไข ({ncr.supplier_response.attachments.length} ไฟล์)</div>
              <div className="flex flex-wrap gap-2">
                {ncr.supplier_response.attachments.map(att => (
                  <a key={att.id} href={`/uploads/ncr/${att.file_path}`} target="_blank" rel="noreferrer">
                    <img
                      src={`/uploads/ncr/${att.file_path}`}
                      alt=""
                      className="h-24 w-24 object-cover rounded border border-border hover:opacity-80"
                    />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="card">
        <h2 className="text-h3 font-semibold text-primary mb-3">Timeline การดำเนินการ</h2>
        <ApprovalTimeline approvals={ncr.approvals} ncr={ncr} />
        {!ncr.approvals?.length && !ncr.supplier_response && <div className="text-muted text-small">ยังไม่มีการอนุมัติ</div>}
      </div>

      {/* Modal รูปถ่ายบิล */}
      <Modal open={billImagesOpen} onClose={() => setBillImagesOpen(false)} title={`รูปถ่ายบิล — ${ncr.invoice_no}`}>
        {ncr.bill_images?.length > 0 ? (
          <div className="flex flex-wrap gap-3">
            {ncr.bill_images.map(img => (
              <a key={img.id} href={`/uploads/bills/${img.file_path}`} target="_blank" rel="noreferrer">
                <img
                  src={`/uploads/bills/${img.file_path}`}
                  alt=""
                  className="h-48 w-48 object-cover rounded border border-border hover:opacity-80"
                />
              </a>
            ))}
          </div>
        ) : (
          <div className="text-muted text-small py-6 text-center">ไม่มีรูปถ่ายบิล</div>
        )}
      </Modal>

      <Modal open={confirmApprove} onClose={() => { setConfirmApprove(false); setApproveError(''); }} title={approveLabel || 'อนุมัติ'} size="sm">
        <div className="space-y-3">

          {/* Fields เพิ่มเติมสำหรับ QC Manager (pending_manager) — เฉพาะ NCR Major เท่านั้น */}
          {!isNCP && ncr.status === 'pending_manager' && (
            <>
              <div>
                <label className="label">การจัดการ (Disposition) *</label>
                <select className="input" value={disposition} onChange={e => setDisposition(e.target.value)}>
                  <option value="">-- เลือก Disposition --</option>
                  <option value="return">ส่งคืน Supplier (Return)</option>
                  <option value="rework">แก้ไข (Rework)</option>
                  <option value="uai">ยอมรับใช้พิเศษ (UAI)</option>
                  <option value="scrap">ทำลาย (Scrap)</option>
                  <option value="re_inspect">ตรวจซ้ำ (Re-inspect)</option>
                </select>
              </div>
              <div>
                <label className="label">หมายเหตุ Disposition</label>
                <textarea className="input" rows={2} value={dispositionNote} onChange={e => setDispositionNote(e.target.value)} placeholder="ระบุเงื่อนไขหรือรายละเอียดเพิ่มเติม" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label">วันกำหนดดำเนินการ</label>
                  <input type="date" className="input" value={dispositionDueDate} onChange={e => setDispositionDueDate(e.target.value)} />
                </div>
                <div>
                  <label className="label">วันตรวจสอบการแก้ไข *</label>
                  <input type="date" className="input" value={effectivenessCheckDate} onChange={e => setEffectivenessCheckDate(e.target.value)} />
                </div>
              </div>
            </>
          )}

          <div>
            <label className="label">หมายเหตุ (ไม่บังคับ)</label>
            <textarea className="input" rows={2} value={comment} onChange={e => setComment(e.target.value)} />
          </div>

          {approveError && <div className="text-danger text-small bg-red-50 dark:bg-red-900 px-2 py-1 rounded">{approveError}</div>}

          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => { setConfirmApprove(false); setApproveError(''); }}>ยกเลิก</Button>
            <Button variant="success" onClick={() => approve.mutate()} loading={approve.isPending}>{approveLabel || 'อนุมัติ'}</Button>
          </div>
        </div>
      </Modal>

      {/* Modal: Purchasing Review + คำแปลภาษาอังกฤษ */}
      <Modal open={reviewOpen} onClose={() => setReviewOpen(false)} title="Review NCR + เพิ่มคำแปลภาษาอังกฤษสำหรับ Supplier" size="lg">
        <div className="space-y-4">
          <div className="bg-blue-50 dark:bg-blue-900 border border-blue-200 dark:border-blue-700 rounded px-3 py-2 text-small text-blue-800 dark:text-blue-200">
            กรุณาตรวจสอบข้อมูลและเพิ่มคำแปลภาษาอังกฤษให้ครบถ้วน ก่อนส่ง Link ให้ Supplier ตอบกลับ
          </div>

          {reviewItems.map((item, idx) => (
            <div key={item.id} className="border border-border rounded-lg overflow-hidden">
              <div className="bg-red-50 dark:bg-red-900 px-4 py-2 text-small font-medium text-primary border-b border-border">
                รายการ {idx + 1}: {item.item_name}
              </div>
              <div className="px-4 py-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <div className="text-small text-muted mb-1">ชื่อสินค้า (ไทย)</div>
                  <div className="bg-bg px-3 py-2 rounded text-small">{item.item_name}</div>
                </div>
                <div>
                  <label className="text-small text-muted mb-1 block">Product Name (English)</label>
                  <input
                    type="text"
                    className="input text-small"
                    value={item.item_name_en}
                    onChange={e => updateReviewItem(idx, 'item_name_en', e.target.value)}
                    placeholder="Enter product name in English"
                  />
                </div>
                <div>
                  <div className="text-small text-muted mb-1">รายละเอียดปัญหา (ไทย)</div>
                  <div className="bg-bg px-3 py-2 rounded text-small min-h-[48px]">{item.defect_detail || '-'}</div>
                </div>
                <div>
                  <label className="text-small text-muted mb-1 block">Defect Detail (English)</label>
                  <textarea
                    className="input text-small"
                    rows={2}
                    value={item.defect_detail_en}
                    onChange={e => updateReviewItem(idx, 'defect_detail_en', e.target.value)}
                    placeholder="Describe the defect in English"
                  />
                </div>
              </div>
            </div>
          ))}

          {reviewError && <div className="text-danger text-small bg-red-50 dark:bg-red-900 px-3 py-2 rounded">{reviewError}</div>}

          <div className="flex gap-2 justify-end pt-1">
            <Button variant="secondary" onClick={() => setReviewOpen(false)}>ยกเลิก</Button>
            <Button variant="primary" onClick={() => purchasingReview.mutate()} loading={purchasingReview.isPending}>
              ยืนยัน — ส่งให้ Supplier ตอบกลับได้แล้ว
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal: ขอ UAI — purchasing กรอกข้อมูลครบก่อนส่ง */}
      <Modal open={uaiOpen} onClose={() => setUaiOpen(false)} title="ขอยอมรับใช้พิเศษ (UAI)" size="lg">
        <div className="space-y-4">
          <div className="bg-yellow-50 dark:bg-yellow-900 border border-yellow-200 dark:border-yellow-700 rounded px-3 py-2 text-small text-yellow-800 dark:text-yellow-200">
            กรอกข้อมูลให้ครบทุกช่องที่มีเครื่องหมาย * ก่อนส่งให้ QC Manager ตรวจสอบ
          </div>

          {/* Section 1 — ข้อมูลคำขอ */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">ประเภทของผลิตภัณฑ์ *</label>
              <select className="input" value={uaiForm.product_type}
                onChange={e => setUaiForm(p => ({ ...p, product_type: e.target.value }))}>
                <option value="">— เลือกประเภท —</option>
                <option value="วัตถุดิบ">วัตถุดิบ</option>
                <option value="ชิ้นส่วน Hardware">ชิ้นส่วน Hardware</option>
                <option value="ผลิตภัณฑ์ FG PRODUCT">ผลิตภัณฑ์ FG PRODUCT</option>
              </select>
            </div>
            <div>
              <label className="label">ประเภทของงาน *</label>
              <select className="input" value={uaiForm.work_type}
                onChange={e => setUaiForm(p => ({ ...p, work_type: e.target.value }))}>
                <option value="">— เลือกประเภท —</option>
                <option value="DIY">DIY</option>
                <option value="Custom made">Custom made</option>
              </select>
            </div>
          </div>

          <div>
            <label className="label">เหตุผลที่ขอยอมรับใช้ *</label>
            <textarea className="input" rows={3} value={uaiForm.reason}
              onChange={e => setUaiForm(p => ({ ...p, reason: e.target.value }))}
              placeholder="ระบุเหตุผลที่ขอ UAI..." />
          </div>

          <div>
            <label className="label">เงื่อนไขการใช้งาน</label>
            <textarea className="input" rows={2} value={uaiForm.conditions}
              onChange={e => setUaiForm(p => ({ ...p, conditions: e.target.value }))}
              placeholder="เงื่อนไขพิเศษในการใช้งาน (ถ้ามี)" />
          </div>

          <div>
            <label className="label">แผนก / ผู้รับผิดชอบ</label>
            <input className="input" value={uaiForm.department}
              onChange={e => setUaiForm(p => ({ ...p, department: e.target.value }))}
              placeholder="ระบุแผนกที่รับผิดชอบ" />
          </div>

          {/* Section 2 — ข้อมูลจากผู้ผลิต */}
          <div className="pt-2" style={{ borderTop: '1px solid var(--color-border, #D1D5DB)' }}>
            <p className="text-small font-semibold text-primary mb-3">ข้อมูลที่ได้รับจากผู้ผลิต</p>
            <div className="space-y-3">
              <div>
                <label className="label">1. ข้อบกพร่องที่เกิดขึ้นกับผลิต / ชิ้นงาน *</label>
                <textarea className="input" rows={2} value={uaiForm.defect_description}
                  onChange={e => setUaiForm(p => ({ ...p, defect_description: e.target.value }))}
                  placeholder="อธิบายข้อบกพร่องที่พบ..." />
              </div>
              <div>
                <label className="label">2. สาเหตุของปัญหาที่เกิดขึ้น *</label>
                <textarea className="input" rows={2} value={uaiForm.root_cause_purchasing}
                  onChange={e => setUaiForm(p => ({ ...p, root_cause_purchasing: e.target.value }))}
                  placeholder="วิเคราะห์สาเหตุหลักของปัญหา..." />
              </div>
              <div>
                <label className="label">3. การดำเนินการแก้ไขปัญหา *</label>
                <textarea className="input" rows={2} value={uaiForm.corrective_action_purchasing}
                  onChange={e => setUaiForm(p => ({ ...p, corrective_action_purchasing: e.target.value }))}
                  placeholder="มาตรการแก้ไขที่ผู้ผลิตดำเนินการ..." />
              </div>
              <div>
                <label className="label">4. วิธีการป้องกันการเกิดปัญหาซ้ำ *</label>
                <textarea className="input" rows={2} value={uaiForm.preventive_action_purchasing}
                  onChange={e => setUaiForm(p => ({ ...p, preventive_action_purchasing: e.target.value }))}
                  placeholder="มาตรการป้องกันไม่ให้เกิดซ้ำ..." />
              </div>
            </div>
          </div>

          {/* รูปภาพประกอบจากผู้ผลิต */}
          <div className="pt-2 border-t border-border">
            <p className="text-small font-semibold text-primary mb-2">รูปภาพประกอบจากผู้ผลิต (ถ้ามี)</p>
            <ImageUploadPair onChange={e => setUaiImages(prev => [...prev, ...Array.from(e.target.files)])} />
            {uaiImages.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {uaiImages.map((f, i) => (
                  <div key={i} className="relative group">
                    <img src={URL.createObjectURL(f)} alt="" className="h-16 w-16 object-cover rounded border border-border" />
                    <button onClick={() => setUaiImages(prev => prev.filter((_, j) => j !== i))}
                      className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-danger text-white text-[12px] flex items-center justify-center opacity-0 group-hover:opacity-100 shadow">
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {uaiError && <p className="text-danger text-small">{uaiError}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setUaiOpen(false)}>ยกเลิก</Button>
            <Button variant="warning" onClick={() => requestUAI.mutate()} loading={requestUAI.isPending}>
              ส่งขอ UAI ให้ QC Manager
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal: QC Manager ไม่อนุมัติคำตอบ Supplier */}
      <Modal open={rejectOpen} onClose={() => setRejectOpen(false)} title="ไม่อนุมัติคำตอบ Supplier" size="sm">
        <div className="space-y-3">
          <div className="bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded px-3 py-2 text-small text-danger">
            เมื่อไม่อนุมัติ เอกสารจะถูกส่งกลับไปยังจัดซื้อ เพื่อให้ส่ง Supplier ตอบใหม่
          </div>
          <div>
            <label className="label">เหตุผลที่ไม่อนุมัติ *</label>
            <textarea
              className="input"
              rows={3}
              value={rejectComment}
              onChange={e => setRejectComment(e.target.value)}
              placeholder="ระบุเหตุผลหรือสิ่งที่ต้องแก้ไข"
            />
          </div>
          {rejectError && <div className="text-danger text-small bg-red-50 dark:bg-red-900 px-2 py-1 rounded">{rejectError}</div>}
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => setRejectOpen(false)}>ยกเลิก</Button>
            <Button variant="danger" onClick={() => rejectResponse.mutate()} loading={rejectResponse.isPending}>ยืนยัน — ไม่อนุมัติ</Button>
          </div>
        </div>
      </Modal>

      {/* Toast คัดลอก Link */}
      {copyToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-success text-white px-5 py-2.5 rounded-lg shadow-lg text-small z-50 pointer-events-none">
          คัดลอก Link แล้ว
        </div>
      )}
    </div>
  );
}
