import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import api, { downloadFile } from '../../utils/api';
import Badge from '../../components/UI/Badge';
import Button from '../../components/UI/Button';
import Modal from '../../components/UI/Modal';
import SignatureCanvas from '../../components/Signature/SignatureCanvas';
import ImageUploadPair from '../../components/UI/ImageUploadPair';
import { ROLE_LABELS } from '../../utils/rolePermissions';

const SIGN_STEPS = [
  { status: 'uai_pending_purchasing', role: 'purchasing', label: ROLE_LABELS.purchasing, type: 'ผู้ออกเอกสาร' },
  { status: 'uai_pending_cco', role: 'cco', label: ROLE_LABELS.cco, type: 'อนุมัติ' },
  { status: 'uai_pending_cmo', role: 'cmo', label: ROLE_LABELS.cmo, type: 'อนุมัติ' },
  { status: 'uai_pending_cpo', role: 'cpo', label: ROLE_LABELS.cpo, type: 'อนุมัติ' },
  { status: 'uai_pending_qc_ack', role: 'qc_manager', label: ROLE_LABELS.qc_manager, type: 'รับทราบ' },
  { status: 'uai_pending_production_ack', role: 'production_manager', label: ROLE_LABELS.production_manager, type: 'รับทราบ' },
  { status: 'uai_pending_qmr_ack', role: 'qmr', label: ROLE_LABELS.qmr, type: 'รับทราบ' },
];

const STATUS_ORDER = [
  'uai_pending_qc_manager', 'uai_pending_purchasing', 'uai_pending_cco', 'uai_pending_cmo',
  'uai_pending_cpo', 'uai_pending_qc_ack', 'uai_pending_production_ack', 'uai_pending_qmr_ack',
  'uai_completed', 'uai_rejected_by_exec',
];

const ACTION_LABELS = {
  review_approved: 'QC Manager อนุมัติคำขอ UAI',
  review_rejected: 'QC Manager ไม่อนุมัติคำขอ',
  approved: 'อนุมัติ',
  acknowledged: 'รับทราบ',
  rejected: 'ไม่อนุมัติ (C-Level)',
};

function isStepDone(step, uaiStatus) {
  if (uaiStatus === 'uai_rejected_by_exec') return false; // handled separately per-step
  const currentIdx = STATUS_ORDER.indexOf(uaiStatus);
  const stepIdx = STATUS_ORDER.indexOf(step.status);
  return currentIdx > stepIdx;
}

function isStepActive(step, uaiStatus) {
  return step.status === uaiStatus;
}

export default function UAIDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const focusedRef = useRef(false);
  const [sigOpen, setSigOpen] = useState(false);
  const [sigComment, setSigComment] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewApproved, setReviewApproved] = useState(true);
  const [reviewReason, setReviewReason] = useState('');
  const [rejectExecOpen, setRejectExecOpen] = useState(false);
  const [rejectExecReason, setRejectExecReason] = useState('');
  const [detailsForm, setDetailsForm] = useState(null);
  const [savingDetails, setSavingDetails] = useState(false);
  const [uploadingImg, setUploadingImg] = useState(false);

  const { data: uai, isLoading } = useQuery({
    queryKey: ['uai', id],
    queryFn: () => api.get(`/uai/${id}`).then(r => r.data),
  });

  // Auto-open details form for purchasing when details are empty
  useEffect(() => {
    if (
      uai && user?.role === 'purchasing' &&
      ['uai_pending_qc_manager', 'uai_pending_purchasing'].includes(uai.status) &&
      !uai.reason && detailsForm === null
    ) {
      setDetailsForm({
        reason: '', conditions: uai.conditions || '', department: uai.department || '', issued_date: uai.issued_date || '',
        product_type: uai.product_type || '', work_type: uai.work_type || '',
        defect_description: uai.defect_description || '', root_cause_purchasing: uai.root_cause_purchasing || '',
        corrective_action_purchasing: uai.corrective_action_purchasing || '', preventive_action_purchasing: uai.preventive_action_purchasing || '',
      });
    }
  }, [uai?.id, uai?.status, user?.role]);

  // มาจากคลิกกระดิ่งแจ้งเตือน — เลื่อนไปช่องลงนามของ user คนนี้แล้ว focus ปุ่มอนุมัติ/ไม่อนุมัติทันที
  useEffect(() => {
    if (!uai || focusedRef.current || !location.state?.focusSign || !user?.role) return;
    focusedRef.current = true;
    const el = document.getElementById(`sig-step-${user.role}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      (el.querySelector('[data-approve-btn]') || el.querySelector('button'))?.focus();
    }
  }, [uai, location.state, user?.role]);

  const sign = useMutation({
    mutationFn: ({ signature_image, comment }) => api.post(`/uai/${id}/sign`, { signature_image, comment }),
    onSuccess: () => { qc.invalidateQueries(['uai', id]); setSigOpen(false); setSigComment(''); },
  });

  const review = useMutation({
    mutationFn: () => api.post(`/uai/${id}/qc-manager-review`, {
      decision: reviewApproved ? 'approve' : 'reject',
      comment: reviewReason || null,
    }),
    onSuccess: () => { qc.invalidateQueries(['uai', id]); setReviewOpen(false); setReviewReason(''); },
  });

  const rejectExec = useMutation({
    mutationFn: () => api.post(`/uai/${id}/reject-exec`, { reason: rejectExecReason }),
    onSuccess: () => { qc.invalidateQueries(['uai', id]); setRejectExecOpen(false); setRejectExecReason(''); },
  });

  const saveDetails = async () => {
    setSavingDetails(true);
    try { await api.patch(`/uai/${id}/details`, detailsForm); qc.invalidateQueries(['uai', id]); setDetailsForm(null); }
    catch (e) { alert(e.response?.data?.error || 'บันทึกไม่สำเร็จ'); }
    finally { setSavingDetails(false); }
  };

  const handleUploadImages = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setUploadingImg(true);
    try {
      const fd = new FormData();
      files.forEach(f => fd.append('images', f));
      await api.post(`/uai/${id}/images`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      qc.invalidateQueries(['uai', id]);
    } catch (e) { alert(e.response?.data?.error || 'อัปโหลดไม่สำเร็จ'); }
    finally { setUploadingImg(false); e.target.value = ''; }
  };

  const deleteImage = async (imgId) => {
    if (!window.confirm('ลบรูปภาพนี้?')) return;
    try { await api.delete(`/uai/${id}/images/${imgId}`); qc.invalidateQueries(['uai', id]); }
    catch (e) { alert(e.response?.data?.error || 'ลบไม่สำเร็จ'); }
  };

  if (isLoading) return <div className="text-muted py-8 text-center">กำลังโหลด...</div>;
  if (!uai) return <div className="text-danger py-8 text-center">ไม่พบข้อมูล</div>;

  const myStep = SIGN_STEPS.find(s => s.role === user?.role);
  const isMyTurn = myStep && isStepActive(myStep, uai.status);
  const purchasingMissingDetails = user?.role === 'purchasing' && isMyTurn && !uai.reason;
  const canSign = isMyTurn && !purchasingMissingDetails;
  const canReview = user?.role === 'qc_manager' && uai.status === 'uai_pending_qc_manager';
  const canRejectExec = ['cco', 'cmo', 'cpo'].includes(user?.role) && isMyTurn;
  const canEditDetails = user?.role === 'purchasing' &&
    ['uai_pending_qc_manager', 'uai_pending_purchasing', 'uai_pending_cco', 'uai_pending_cmo', 'uai_pending_cpo'].includes(uai.status);

  const df = detailsForm || {
    reason: uai.reason || '', conditions: uai.conditions || '', department: uai.department || '', issued_date: uai.issued_date || '',
    product_type: uai.product_type || '', work_type: uai.work_type || '',
    defect_description: uai.defect_description || '', root_cause_purchasing: uai.root_cause_purchasing || '',
    corrective_action_purchasing: uai.corrective_action_purchasing || '', preventive_action_purchasing: uai.preventive_action_purchasing || '',
  };

  // Sort signatures by time for Timeline
  const timelineEntries = [...(uai.signatures || [])].sort((a, b) => new Date(a.signed_at) - new Date(b.signed_at));

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
          <h1 className="page-title">{uai.uai_code}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge status={uai.status} />
            <span className="text-small text-muted">อ้างอิง {uai.ncr_code}</span>
          </div>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          {canReview && <Button variant="primary" onClick={() => setReviewOpen(true)}>ตรวจสอบ UAI</Button>}
          {uai.status === 'uai_completed' && (
            <>
              <button onClick={() => downloadFile(`/uai/${id}/excel`, {}, `${uai.uai_code || id}.xlsx`)} className="btn-secondary btn text-small">Export Excel</button>
              <button onClick={() => downloadFile(`/uai/${id}/pdf`, {}, `${uai.uai_code || id}.pdf`)} className="btn-primary btn text-small">Export PDF</button>
            </>
          )}
        </div>
      </div>

      {/* Section 1 — NCR Data (read-only) */}
      <div className="card">
        <h2 className="text-h3 font-semibold text-primary mb-3">ข้อมูลจาก NCR (อ่านอย่างเดียว)</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
          {[
            ['Invoice No.', uai.invoice_no, 'font-mono'],
            ['PO No.', uai.po_no, 'font-mono'],
            ['Supplier', uai.supplier_name || '-', ''],
            ['ระดับ', uai.severity === 'major' ? 'Major' : 'Minor', ''],
          ].map(([label, value, cls]) => (
            <div key={label}><div className="text-small text-muted">{label}</div><div className={`text-body font-medium ${cls}`}>{value}</div></div>
          ))}
        </div>

        {/* NCR items as cards with images */}
        {uai.ncr_items?.length > 0 && (
          <div className="space-y-3">
            <div className="text-small font-medium text-muted border-t border-border pt-3">รายการสินค้า ({uai.ncr_items.length} รายการ)</div>
            {uai.ncr_items.map((item, i) => (
              <div key={i} className="border border-border rounded-lg p-3 bg-bg">
                <div className="font-medium text-body text-primary mb-2">{i + 1}. {item.item_name}</div>
                {item.defect_category_name && (
                  <div className="text-small text-muted mb-0.5">
                    หมวดข้อบกพร่อง: <span className="text-text">{item.defect_category_name}</span>
                  </div>
                )}
                {item.defect_detail && (
                  <div className="text-small text-muted mb-2">
                    รายละเอียด: <span className="text-text">{item.defect_detail}</span>
                  </div>
                )}
                <div className="grid grid-cols-4 gap-2 text-center text-small mb-2">
                  <div className="bg-surface border border-border rounded p-1.5">
                    <div className="text-muted text-[12px]">รับเข้า</div>
                    <div className="font-mono font-bold text-text">{item.qty_received}</div>
                  </div>
                  <div className="bg-surface border border-border rounded p-1.5">
                    <div className="text-muted text-[12px]">ตรวจสอบ</div>
                    <div className="font-mono font-bold text-text">{item.qty_sampled}</div>
                  </div>
                  <div className="bg-green-50 dark:bg-green-900 border border-green-200 dark:border-green-700 rounded p-1.5">
                    <div className="text-muted text-[12px]">ผ่าน</div>
                    <div className="font-mono font-bold text-success">
                      {item.qty_passed != null ? item.qty_passed : item.qty_received - item.qty_failed}
                    </div>
                  </div>
                  <div className="bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded p-1.5">
                    <div className="text-muted text-[12px]">ไม่ผ่าน</div>
                    <div className="font-mono font-bold text-danger">{item.qty_failed}</div>
                  </div>
                </div>
                {item.inspector_name && (
                  <div className="text-small text-muted">
                    ผู้ตรวจ: <span className="text-text font-medium">{item.inspector_name}</span>
                  </div>
                )}
                {item.bill_item_images?.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-border">
                    <div className="text-[12px] text-muted mb-1">รูปภาพงานเสีย ({item.bill_item_images.length} รูป)</div>
                    <div className="flex flex-wrap gap-1">
                      {item.bill_item_images.map((img, j) => (
                        <a key={j} href={`/uploads/bill-items/${img.file_path}`} target="_blank" rel="noreferrer">
                          <img src={`/uploads/bill-items/${img.file_path}`} alt="" className="h-20 w-20 object-cover rounded border border-border hover:opacity-80" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* NCR images */}
        {uai.ncr_images?.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border">
            <div className="text-small font-medium text-muted mb-2">รูปภาพจาก NCR ({uai.ncr_images.length} รูป)</div>
            <div className="flex flex-wrap gap-2">
              {uai.ncr_images.map((img, j) => (
                <a key={j} href={`/uploads/ncr/${img.file_path}`} target="_blank" rel="noreferrer">
                  <img src={`/uploads/ncr/${img.file_path}`} alt="" className="h-24 w-24 object-cover rounded border border-border hover:opacity-80" />
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Section 2 — Details */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-h3 font-semibold text-primary">ข้อมูลการขอยอมรับใช้</h2>
          {canEditDetails && !detailsForm && <Button variant="secondary" onClick={() => setDetailsForm(df)} className="text-small py-1">แก้ไข</Button>}
        </div>
        {detailsForm ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">ประเภทของผลิตภัณฑ์ *</label>
                <select className="input" value={detailsForm.product_type} onChange={e => setDetailsForm(p => ({ ...p, product_type: e.target.value }))}>
                  <option value="">— เลือกประเภท —</option>
                  <option value="วัตถุดิบ">วัตถุดิบ</option>
                  <option value="ชิ้นส่วน Hardware">ชิ้นส่วน Hardware</option>
                  <option value="ผลิตภัณฑ์ FG PRODUCT">ผลิตภัณฑ์ FG PRODUCT</option>
                </select>
              </div>
              <div>
                <label className="label">ประเภทของงาน *</label>
                <select className="input" value={detailsForm.work_type} onChange={e => setDetailsForm(p => ({ ...p, work_type: e.target.value }))}>
                  <option value="">— เลือกประเภท —</option>
                  <option value="DIY">DIY</option>
                  <option value="Custom made">Custom made</option>
                </select>
              </div>
            </div>
            <div><label className="label">เหตุผลที่ขอยอมรับใช้ *</label><textarea className="input" rows={3} value={detailsForm.reason} onChange={e => setDetailsForm(p => ({ ...p, reason: e.target.value }))} /></div>
            <div><label className="label">เงื่อนไขการใช้งาน</label><textarea className="input" rows={2} value={detailsForm.conditions} onChange={e => setDetailsForm(p => ({ ...p, conditions: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">แผนกที่นำไปใช้</label><input className="input" value={detailsForm.department} onChange={e => setDetailsForm(p => ({ ...p, department: e.target.value }))} /></div>
              <div><label className="label">วันที่ออกเอกสาร</label><input type="date" className="input" value={detailsForm.issued_date} onChange={e => setDetailsForm(p => ({ ...p, issued_date: e.target.value }))} /></div>
            </div>
            <div className="pt-2 border-t border-border">
              <p className="text-small font-semibold text-primary mb-2">ข้อมูลที่ได้รับจากผู้ผลิต</p>
              <div className="space-y-3">
                <div><label className="label">1. ข้อบกพร่องที่เกิดขึ้นกับผลิต / ชิ้นงาน *</label><textarea className="input" rows={2} value={detailsForm.defect_description} onChange={e => setDetailsForm(p => ({ ...p, defect_description: e.target.value }))} /></div>
                <div><label className="label">2. สาเหตุของปัญหาที่เกิดขึ้น *</label><textarea className="input" rows={2} value={detailsForm.root_cause_purchasing} onChange={e => setDetailsForm(p => ({ ...p, root_cause_purchasing: e.target.value }))} /></div>
                <div><label className="label">3. การดำเนินการแก้ไขปัญหา *</label><textarea className="input" rows={2} value={detailsForm.corrective_action_purchasing} onChange={e => setDetailsForm(p => ({ ...p, corrective_action_purchasing: e.target.value }))} /></div>
                <div><label className="label">4. วิธีการป้องกันการเกิดปัญหาซ้ำ *</label><textarea className="input" rows={2} value={detailsForm.preventive_action_purchasing} onChange={e => setDetailsForm(p => ({ ...p, preventive_action_purchasing: e.target.value }))} /></div>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="secondary" onClick={() => setDetailsForm(null)}>ยกเลิก</Button>
              <Button onClick={saveDetails} loading={savingDetails} disabled={!detailsForm.reason}>บันทึก</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {[
                ['ประเภทผลิตภัณฑ์', uai.product_type || '-'],
                ['ประเภทงาน', uai.work_type || '-'],
                ['เหตุผล', uai.reason || '-'],
                ['เงื่อนไข', uai.conditions || '-'],
                ['แผนก', uai.department || '-'],
                ['วันที่ออกเอกสาร', uai.issued_date || '-'],
              ].map(([label, value]) => (
                <div key={label}><div className="text-small text-muted">{label}</div><div className="text-body">{value}</div></div>
              ))}
            </div>
            {(uai.defect_description || uai.root_cause_purchasing || uai.corrective_action_purchasing || uai.preventive_action_purchasing) && (
              <div className="pt-3 border-t border-border">
                <p className="text-small font-semibold text-primary mb-2">ข้อมูลที่ได้รับจากผู้ผลิต</p>
                <div className="space-y-2">
                  {[
                    ['1. ข้อบกพร่องที่เกิดขึ้น', uai.defect_description],
                    ['2. สาเหตุของปัญหา', uai.root_cause_purchasing],
                    ['3. การดำเนินการแก้ไข', uai.corrective_action_purchasing],
                    ['4. วิธีการป้องกัน', uai.preventive_action_purchasing],
                  ].filter(([, v]) => v).map(([label, value]) => (
                    <div key={label}><div className="text-small text-muted">{label}</div><div className="text-body whitespace-pre-wrap">{value}</div></div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {/* รูปภาพประกอบจากผู้ผลิต */}
        {!detailsForm && (
          <div className="mt-3 pt-3 border-t border-border">
            <div className="flex items-center justify-between mb-2">
              <p className="text-small font-semibold text-primary">รูปภาพประกอบจากผู้ผลิต</p>
              {canEditDetails && (
                <ImageUploadPair disabled={uploadingImg} onChange={handleUploadImages} />
              )}
            </div>
            {uai.images?.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {uai.images.map(img => (
                  <div key={img.id} className="relative group">
                    <a href={`/uploads/uai/${img.file_path}`} target="_blank" rel="noreferrer">
                      <img src={`/uploads/uai/${img.file_path}`} alt={img.original_name || ''}
                        className="h-20 w-20 object-cover rounded border border-border hover:opacity-80 transition-opacity" />
                    </a>
                    {canEditDetails && (
                      <button onClick={() => deleteImage(img.id)}
                        className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-danger text-white text-[12px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow">
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-small text-muted">ยังไม่มีรูปภาพ</p>
            )}
          </div>
        )}

        {uai.created_by_name && (
          <div className="mt-3 pt-3 border-t border-border text-small text-muted">
            ผู้ขอยอมรับใช้: <span className="text-text font-medium">{uai.created_by_name}</span>
          </div>
        )}
      </div>

      {/* Section 3 — Signatures */}
      <div className="card">
        <h2 className="text-h3 font-semibold text-primary mb-4">ลายเซ็น</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {SIGN_STEPS.map((step, i) => {
            const isRejectedDoc = uai.status === 'uai_rejected_by_exec';
            const done = isStepDone(step, uai.status) || uai.status === 'uai_completed';
            const active = isStepActive(step, uai.status);
            const isMine = active && step.role === user?.role;
            const sig = uai.signatures?.find(s => s.role === step.role && s.signature_image);
            const rejSig = isRejectedDoc && uai.signatures?.find(s => s.role === step.role && s.action === 'rejected');

            let cardClass = 'border-dashed border-border bg-bg';
            if (rejSig) cardClass = 'border-danger bg-red-50 dark:bg-red-900';
            else if (isMine) cardClass = 'border-success bg-green-50 dark:bg-green-900';
            else if (done || sig) cardClass = 'border-border';

            return (
              <div key={step.role} id={`sig-step-${step.role}`} className={`border rounded-lg p-3 text-center flex flex-col justify-center min-h-[150px] ${cardClass}`}>
                <div className="text-small font-medium text-primary">{i + 1}. {step.label}</div>
                <div className="text-[12px] text-muted mb-2">{step.type}</div>
                {rejSig ? (
                  <div>
                    <div className="text-[12px] font-semibold text-danger mb-1">ไม่อนุมัติ</div>
                    <div className="text-[12px] text-muted">{rejSig.full_name}</div>
                    <div className="text-[12px] text-muted">{new Date(rejSig.signed_at + 'Z').toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' })}</div>
                    {rejSig.comment && <div className="text-[12px] text-danger mt-1 italic break-words whitespace-pre-wrap">"{rejSig.comment}"</div>}
                  </div>
                ) : sig ? (
                  <div>
                    <img src={sig.signature_image} alt="sig" className="max-w-full max-h-16 mx-auto object-contain border border-border rounded" />
                    <div className="text-[12px] text-muted mt-1">{sig.full_name}</div>
                    <div className="text-[12px] text-muted">{new Date(sig.signed_at + 'Z').toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' })}</div>
                    {sig.comment && <div className="text-[12px] text-accent mt-1 italic break-words whitespace-pre-wrap">"{sig.comment}"</div>}
                  </div>
                ) : (
                  <div className={`min-h-16 flex flex-col items-center justify-center gap-1.5 text-[12px] ${active ? 'text-success' : 'text-muted'}`}>
                    {isMine ? (
                      (canSign || canRejectExec) ? (
                        <div className="flex flex-col gap-1.5 w-full">
                          {canRejectExec && (
                            <Button variant="danger" onClick={() => setRejectExecOpen(true)} className="text-small py-1 w-full">ไม่อนุมัติ</Button>
                          )}
                          {canSign && (
                            <Button variant="success" data-approve-btn="true" onClick={() => setSigOpen(true)} className="text-small py-1 w-full">
                              {step.type === 'รับทราบ' ? 'รับทราบ (ลงนาม)' : 'อนุมัติ (ลงนาม)'}
                            </Button>
                          )}
                        </div>
                      ) : purchasingMissingDetails ? (
                        <span className="text-warning font-medium">กรุณากรอกข้อมูลด้านล่างก่อนลงนาม</span>
                      ) : 'รอลงนามของคุณ'
                    ) : active ? 'รอลงนาม' : 'รอขั้นก่อนหน้า'}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Section 4 — Timeline (always at bottom) */}
      {timelineEntries.length > 0 && (
        <div className="card">
          <h2 className="text-h3 font-semibold text-primary mb-4">Timeline การอนุมัติ</h2>
          <div className="space-y-4">
            {timelineEntries.map((sig, i) => {
              const isNeg = sig.action === 'rejected' || sig.action === 'review_rejected';
              const actionLabel = ACTION_LABELS[sig.action] || sig.action;
              const roleLabel = ROLE_LABELS[sig.role] || sig.role;
              return (
                <div key={i} className={`flex gap-3 pl-3 border-l-2 ${isNeg ? 'border-danger' : 'border-success'}`}>
                  <div className="flex-1 min-w-0">
                    <div className={`text-small font-semibold ${isNeg ? 'text-danger' : 'text-success'}`}>{actionLabel}</div>
                    <div className="text-small text-muted mt-0.5">{roleLabel} — {sig.full_name}</div>
                    {sig.comment && (
                      <div className="text-small text-muted mt-1 italic bg-bg rounded px-2 py-1 break-words whitespace-pre-wrap">"{sig.comment}"</div>
                    )}
                    <div className="text-[12px] text-muted mt-1">
                      {new Date(sig.signed_at + 'Z').toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' })}
                    </div>
                  </div>
                  {sig.signature_image && (
                    <img src={sig.signature_image} alt="sig" className="h-12 object-contain border border-border rounded flex-shrink-0" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Sign Modal */}
      <Modal open={sigOpen} onClose={() => { setSigOpen(false); setSigComment(''); }} title="ลงนาม" size="sm">
        <div className="space-y-3">
          <div>
            <label className="label">เหตุผล / ข้อเสนอแนะ (ไม่บังคับ)</label>
            <textarea
              className="input"
              rows={2}
              value={sigComment}
              onChange={e => setSigComment(e.target.value)}
              placeholder="ระบุเหตุผลหรือข้อเสนอแนะเพิ่มเติม..."
            />
          </div>
          {/* S168 — เลือกได้ระหว่างวาดลายเซ็นจริง หรือกดอนุมัติเฉยๆ (ระบบสร้างตราประทับชื่อ+เวลาแทนให้อัตโนมัติ) */}
          <Button
            variant="success"
            className="w-full"
            onClick={() => sign.mutate({ signature_image: null, comment: sigComment })}
            loading={sign.isPending}
          >
            กดอนุมัติ (ไม่ต้องวาดลายเซ็น)
          </Button>
          <div className="flex items-center gap-2 text-muted text-[12px]">
            <div className="flex-1 border-t border-border" /> หรือ <div className="flex-1 border-t border-border" />
          </div>
          <div className="text-small text-muted">วาดลายเซ็นในกล่องด้านล่าง</div>
          <SignatureCanvas
            onConfirm={(dataURL) => sign.mutate({ signature_image: dataURL, comment: sigComment })}
            disabled={sign.isPending}
          />
          {sign.error && <div className="text-danger text-small">{sign.error.response?.data?.error}</div>}
          {sign.isPending && <div className="text-muted text-small text-center">กำลังบันทึก...</div>}
        </div>
      </Modal>

      {/* Reject by Exec Modal */}
      <Modal open={rejectExecOpen} onClose={() => { setRejectExecOpen(false); setRejectExecReason(''); }} title="ไม่อนุมัติ UAI" size="sm">
        <div className="space-y-3">
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 text-small text-danger">
            การไม่อนุมัติจะปิดเอกสาร UAI นี้ทันที และ NCR ที่อ้างอิงจะกลับสู่สถานะ "รอผู้ผลิตตอบกลับ" พร้อมแจ้งเตือนผู้ที่เกี่ยวข้องทุกฝ่าย
          </div>
          <div>
            <label className="label">เหตุผลที่ไม่อนุมัติ *</label>
            <textarea
              className="input"
              rows={3}
              value={rejectExecReason}
              onChange={e => setRejectExecReason(e.target.value)}
              placeholder="กรุณากรอกเหตุผล..."
            />
          </div>
          {rejectExec.error && <div className="text-danger text-small">{rejectExec.error.response?.data?.error}</div>}
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => { setRejectExecOpen(false); setRejectExecReason(''); }}>ยกเลิก</Button>
            <Button
              variant="danger"
              onClick={() => rejectExec.mutate()}
              loading={rejectExec.isPending}
              disabled={!rejectExecReason.trim()}
            >
              ยืนยันไม่อนุมัติ
            </Button>
          </div>
        </div>
      </Modal>

      {/* Review Modal */}
      <Modal open={reviewOpen} onClose={() => { setReviewOpen(false); setReviewReason(''); }} title="ตรวจสอบคำขอ UAI" size="sm">
        <div className="space-y-3">
          <div className="flex gap-4">
            {[true, false].map(v => (
              <label key={String(v)} className="flex items-center gap-2 cursor-pointer min-h-[44px]">
                <input type="radio" checked={reviewApproved === v} onChange={() => setReviewApproved(v)} />
                <span className={v ? 'text-success font-medium' : 'text-danger font-medium'}>{v ? 'อนุมัติ' : 'ไม่อนุมัติ'}</span>
              </label>
            ))}
          </div>
          <div>
            <label className="label">{reviewApproved ? 'ข้อเสนอแนะ (ไม่บังคับ)' : 'เหตุผล *'}</label>
            <textarea
              className="input"
              rows={3}
              value={reviewReason}
              onChange={e => setReviewReason(e.target.value)}
              placeholder={reviewApproved ? 'ระบุข้อเสนอแนะเพิ่มเติม...' : 'กรุณากรอกเหตุผล...'}
            />
          </div>
          {review.error && <div className="text-danger text-small">{review.error.response?.data?.error}</div>}
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => { setReviewOpen(false); setReviewReason(''); }}>ยกเลิก</Button>
            <Button
              variant={reviewApproved ? 'success' : 'danger'}
              onClick={() => review.mutate()}
              loading={review.isPending}
              disabled={!reviewApproved && !reviewReason}
            >
              {reviewApproved ? 'อนุมัติ UAI' : 'ไม่อนุมัติ'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
