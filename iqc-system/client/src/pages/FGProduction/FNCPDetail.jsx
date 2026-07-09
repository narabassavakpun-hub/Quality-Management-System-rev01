import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { downloadPdf } from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import Button from '../../components/UI/Button';
import Modal from '../../components/UI/Modal';

const SEV_COLOR = { minor: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-200', major: 'bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-200', critical: 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200' };
const STATUS_INFO = {
  open:                 { label: 'เปิด',                    color: 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200' },
  in_progress:          { label: 'กำลังดำเนินการ',          color: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-200' },
  waiting_verify:       { label: 'รอ QC ตรวจสอบ',           color: 'bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-200' },
  supervisor_approved:  { label: 'Supervisor อนุมัติแล้ว',  color: 'bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-200' },
  verified:             { label: 'QC ยืนยันแล้ว',           color: 'bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-200' },
  closed:               { label: 'ปิดแล้ว',                  color: 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200' },
  reject:               { label: 'QC ปฏิเสธ',               color: 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200' },
  fuai_opened:          { label: 'เปิด FUAI แล้ว',           color: 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-200' },
};
const TL_ICON = {
  create:              '📄', start:              '▶', submit_verify:    '📤',
  verify:              '✅', close:              '🔒', reject:           '❌',
  comment:             '💬', copy_link:          '🔗',
  supervisor_approve:  '✅', manager_approve:    '✅',
  fuai_opened:         '🛡', fuai_rejected:      '❌',
};

function toThaiTime(utcStr) {
  if (!utcStr) return '';
  const iso = utcStr.replace(' ', 'T') + (utcStr.includes('Z') || utcStr.includes('+') ? '' : 'Z');
  const d = new Date(iso);
  if (isNaN(d.getTime())) return utcStr.slice(0, 16).replace('T', ' ');
  const th = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  const p = n => String(n).padStart(2, '0');
  return `${th.getUTCFullYear()}-${p(th.getUTCMonth() + 1)}-${p(th.getUTCDate())} ${p(th.getUTCHours())}:${p(th.getUTCMinutes())}`;
}

function SBadge({ v }) {
  const s = STATUS_INFO[v] || { label: v, color: 'bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-200' };
  return <span className={`badge ${s.color}`}>{s.label}</span>;
}

function ActionModal({ title, children, onClose, onConfirm, loading, confirmLabel = 'ยืนยัน', variant = 'primary' }) {
  return (
    <Modal open onClose={onClose} title={title} size="sm">
      <div className="space-y-3">
        {children}
        <div className="flex gap-2 justify-end pt-2">
          <Button variant="secondary" onClick={onClose} disabled={loading}>ยกเลิก</Button>
          <Button variant={variant} loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </Modal>
  );
}

export default function FNCPDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [actionModal, setActionModal] = useState(null);
  const [comment, setComment]   = useState('');
  const [extra, setExtra]       = useState({});
  const [actionErr, setActionErr] = useState('');
  const [linkCopied, setLinkCopied] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['fncp-detail', id],
    queryFn: () => api.get(`/fg-fncp/${id}`).then(r => r.data),
    staleTime: 15000,
  });

  const doAction = useMutation({
    mutationFn: ({ action, body }) => api.patch(`/fg-fncp/${id}/${action}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fncp-detail', id] });
      qc.invalidateQueries({ queryKey: ['fncp-list'] });
      qc.invalidateQueries({ queryKey: ['fncp-stats'] });
      setActionModal(null); setComment(''); setExtra({}); setActionErr('');
    },
    onError: e => setActionErr(e.response?.data?.error || 'เกิดข้อผิดพลาด'),
  });

  const doEdit = useMutation({
    mutationFn: body => api.put(`/fg-fncp/${id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fncp-detail', id] }); setActionModal(null); },
  });

  if (isLoading) return <div className="page-container"><div className="text-muted py-8 text-center">กำลังโหลด...</div></div>;
  if (!data)     return <div className="page-container"><div className="text-danger py-8 text-center">ไม่พบ FNCP</div></div>;

  const { timeline = [], images = [], fixImages = [] } = data;
  const role   = user?.role;
  const status = data.status;

  // Action permissions
  const canStart           = ['admin','production_manager'].includes(role) && ['open','reject'].includes(status);
  const canSubmitVerify    = ['admin','production_manager'].includes(role) && status === 'in_progress';
  const canSupervisorApprove = ['admin','qc_supervisor','qc_manager'].includes(role) && status === 'waiting_verify';
  const canReject          = ['admin','qc_supervisor'].includes(role) && status === 'waiting_verify';
  const canManagerApprove  = ['admin','qc_manager'].includes(role) && status === 'supervisor_approved';
  const canClose           = ['admin','qc_manager'].includes(role) && status === 'verified';
  const canEdit            = ['admin','qc_staff','qc_supervisor','qc_manager','production_manager'].includes(role) && ['open','in_progress','reject'].includes(status);

  const trigger = (action, body = {}) => {
    setActionErr('');
    doAction.mutate({ action, body: { comment, ...extra, ...body } });
  };

  const copyResponseLink = () => {
    const url = `${window.location.origin}/fncp-response/${data.prod_token}`;
    const logToTimeline = () => {
      api.post(`/fg-fncp/${id}/copy-link`).then(() => {
        qc.invalidateQueries({ queryKey: ['fncp-detail', id] });
      }).catch(() => {});
    };
    const doFallback = () => {
      const el = document.createElement('textarea');
      el.value = url;
      el.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
      document.body.appendChild(el);
      el.focus(); el.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(el);
      return ok;
    };
    const finish = (ok) => {
      if (ok) { setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2500); logToTimeline(); }
      else alert(url);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(url).then(() => finish(true)).catch(() => finish(doFallback()));
    } else {
      finish(doFallback());
    }
  };

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="page-title">{data.fncp_no}</h1>
            <SBadge v={status} />
            {data.severity && <span className={`badge ${SEV_COLOR[data.severity]}`}>{data.severity}</span>}
          </div>
          <p className="text-muted text-small mt-1">{data.doc_no} | {data.product_no} — {data.product_desc}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {data.prod_token && (status === 'reject' || (['open','in_progress'].includes(status) && !data.respondent_name)) && (
            <button
              onClick={copyResponseLink}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-small font-medium transition-colors ${linkCopied ? 'bg-success text-white' : 'bg-cyan-50 dark:bg-cyan-900 text-cyan-700 dark:text-cyan-200 border border-cyan-300 dark:border-cyan-600 hover:bg-cyan-100'}`}
            >
              {linkCopied ? (
                <><svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>คัดลอกแล้ว!</>
              ) : (
                <><svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>{data.fm_is_material === 1 ? 'คัดลอกลิงก์ส่ง QC รับเข้า' : 'คัดลอกลิงก์ส่งฝ่ายผลิต'}</>
              )}
            </button>
          )}
          {status === 'closed' && (
            <Button variant="secondary" size="sm"
              onClick={() => downloadPdf(`/fg-fncp/${id}/pdf`, {}, `FNCP-${data.fncp_no}.pdf`)}>
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 mr-1 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Export PDF
            </Button>
          )}
          <Link to="/fg-production/fncp"><Button variant="secondary" size="sm">← รายการ FNCP</Button></Link>
        </div>
      </div>

      <div className="space-y-4">

        {/* helper: image panel reused in both cards */}
        {/* ── Grid หลัก: mobile=1col, lg=3col (Timeline row-span-2) ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* ── Card: ข้อมูลของเสีย ── order-1, lg:col-span-2 row-1 */}
          <div className="order-1 lg:col-span-2 card p-0 overflow-hidden">
            <div className="p-4 pb-0">
              <h3 className="text-h3 font-semibold mb-2">ข้อมูลของเสีย</h3>
            </div>
            {/* Info grid + รูปขวา */}
            <div className="flex gap-0 px-4">
              <div className="flex-1 min-w-0 pb-3">
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-small">
                  {[
                    ['สายการผลิต',        data.line_name || '—'],
                    ['กลุ่มอาการเสีย',   data.defect_group_name || '—'],
                    ['อาการเสีย',         data.defect_type_name || '—'],
                    ['FM Category',       data.fm_category_name || '—'],
                    ['จำนวนเสีย',        `${data.defect_qty || 0} ${data.defect_unit || ''}`],
                    ['หน่วยงานรับผิดชอบ', data.department_responsible || '—'],
                    ['PIC',              data.pic_name || '—'],
                    ['Due Date',         data.due_date || '—'],
                    ['ผู้เปิด FNCP',     data.opened_by_name || '—'],
                    ['วันที่เปิด',       data.opened_at ? data.opened_at.slice(0, 10) : '—'],
                  ].map(([label, val]) => (
                    <div key={label} className="py-0.5">
                      <div className="text-muted text-[10px] leading-tight">{label}</div>
                      <div className="font-medium text-small leading-snug">{val}</div>
                    </div>
                  ))}
                </div>
              </div>
              {/* รูปงานเสีย */}
              <div className="shrink-0 w-28 sm:w-36 lg:w-44 ml-3 flex flex-col">
                <div className="text-[10px] text-muted mb-1">รูปงานเสีย ({images.length})</div>
                <div className="flex-1 rounded-lg overflow-hidden bg-bg border border-border relative min-h-[110px] sm:min-h-[130px]">
                  {images.length > 0 ? (
                    <>
                      <a href={`/uploads/fg-defect/${images[0].filename}`} target="_blank" rel="noreferrer" className="block absolute inset-0">
                        <img src={`/uploads/fg-defect/${images[0].filename}`} alt={images[0].original_name}
                          className="w-full h-full object-cover hover:opacity-90 transition-opacity" />
                      </a>
                      {images.length > 1 && (
                        <div className="absolute bottom-1.5 right-1.5 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded">
                          +{images.length - 1} รูป
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-muted">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-7 h-7 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <span className="text-[11px]">No Picture</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
            {/* ปัญหาที่พบ — ล่างสุด เต็มความกว้าง */}
            <div className="px-4 pb-4 pt-2 border-t border-border mt-2">
              <div className="text-muted text-[10px] mb-0.5">ปัญหาที่พบ</div>
              <div className="text-small bg-bg rounded p-2 leading-snug min-h-[36px]">
                {data.initial_cause || <span className="italic text-muted">—</span>}
              </div>
            </div>
          </div>

          {/* ── Card: Root Cause Analysis — order-2, lg:col-span-2 row-2 ── */}
          <div className="order-2 lg:col-span-2 lg:col-start-1 lg:row-start-2 card p-0 overflow-hidden">
            <div className="p-4 pb-0">
              <h3 className="text-h3 font-semibold mb-2">Root Cause Analysis</h3>
              {data.respondent_name && (
                <div className="mb-3 p-2.5 bg-blue-50 dark:bg-blue-900 border border-blue-200 dark:border-blue-700 rounded-lg">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-[10px] text-blue-600 dark:text-blue-200 mb-0.5">ผู้ตอบกลับ (ฝ่ายผลิต)</div>
                      <div className="text-small font-semibold text-blue-800 dark:text-blue-200">{data.respondent_name}</div>
                    </div>
                    {data.submit_verify_at && (
                      <div className="text-right">
                        <div className="text-[10px] text-blue-600 dark:text-blue-200 mb-0.5">วันเวลาที่ตอบ</div>
                        <div className="text-small font-medium text-blue-800 dark:text-blue-200">{toThaiTime(data.submit_verify_at)}</div>
                        {data.opened_at && (() => {
                          const days = Math.round((new Date(data.submit_verify_at) - new Date(data.opened_at)) / (1000 * 60 * 60 * 24));
                          return <div className="text-[10px] text-blue-600 dark:text-blue-200 mt-0.5">ใช้เวลา {days} วัน</div>;
                        })()}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            {/* RCA fields + รูปแก้ไขขวา (เฉพาะ 0-1 รูป) */}
            <div className="flex gap-0 px-4 pb-4">
              <div className="flex-1 min-w-0 space-y-2">
                {[
                  ['การแก้ไขเฉพาะหน้า (Correction)', data.correction],
                  ['Root Cause',                      data.root_cause],
                  ['Corrective Action',               data.corrective_action],
                  ['Preventive Action',               data.preventive_action],
                  ['ผลการตรวจสอบ (Verification)',     data.verification_result],
                ].map(([label, val]) => (
                  <div key={label}>
                    <div className="text-muted text-[10px] mb-0.5">{label}</div>
                    <div className="text-small bg-bg rounded p-2 min-h-[30px]">{val || <span className="italic text-muted">—</span>}</div>
                  </div>
                ))}
                {/* รูปการแก้ไข >1 รูป — แสดงด้านล่าง */}
                {fixImages.length > 1 && (
                  <div className="pt-2 border-t border-border">
                    <div className="text-[10px] text-muted mb-1.5">รูปการแก้ไข ({fixImages.length})</div>
                    <div className="flex flex-wrap gap-2">
                      {fixImages.map(img => (
                        <a key={img.id} href={`/uploads/fg-fix/${img.filename}`} target="_blank" rel="noreferrer">
                          <img src={`/uploads/fg-fix/${img.filename}`} alt={img.original_name}
                            className="w-16 h-16 object-cover rounded-lg border border-border hover:opacity-80 transition-opacity" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {/* รูปการแก้ไข — กรอบขวา เฉพาะ 0-1 รูป */}
              {fixImages.length <= 1 && (
                <div className="shrink-0 w-28 sm:w-36 lg:w-44 ml-3 flex flex-col">
                  <div className="text-[10px] text-muted mb-1">รูปการแก้ไข ({fixImages.length})</div>
                  <div className="flex-1 rounded-lg overflow-hidden bg-bg border border-border relative min-h-[110px] sm:min-h-[130px]">
                    {fixImages.length === 1 ? (
                      <a href={`/uploads/fg-fix/${fixImages[0].filename}`} target="_blank" rel="noreferrer" className="block absolute inset-0">
                        <img src={`/uploads/fg-fix/${fixImages[0].filename}`} alt={fixImages[0].original_name}
                          className="w-full h-full object-cover hover:opacity-90 transition-opacity" />
                      </a>
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-muted">
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-7 h-7 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <span className="text-[11px]">No Picture</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Timeline — order-3 mobile (ล่างสุด), lg:col-3 row-span-2 ── */}
          <div className="order-3 lg:col-start-3 lg:row-start-1 lg:row-span-2 card flex flex-col">
            <h3 className="text-h3 font-semibold mb-3">Timeline ({timeline.length})</h3>
            <div className="flex-1 overflow-y-auto space-y-3 pr-0.5 max-h-64 lg:max-h-none">
              {timeline.map(t => (
                <div key={t.id} className="flex gap-2">
                  <div className="text-sm leading-none shrink-0 mt-0.5">{TL_ICON[t.action] || '•'}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium leading-snug text-[12px] text-text">{t.comment || t.action.replace(/_/g, ' ')}</div>
                    <div className="text-muted text-[10px] mt-0.5">{toThaiTime(t.created_at)}</div>
                    <div className="text-muted text-[10px]">{t.actor_name || 'ระบบ'}</div>
                  </div>
                </div>
              ))}
              {!timeline.length && <div className="text-muted italic text-small">ยังไม่มี events</div>}
            </div>
          </div>

        </div>

        {/* ── ปุ่มดำเนินการ + เหตุผลปฏิเสธ — ล่างสุด ── */}
        {status === 'reject' && data.reject_reason && (
          <div className="card bg-red-50 dark:bg-red-900 border-red-200 dark:border-red-700 py-3">
            <h3 className="text-small font-semibold text-danger mb-1">เหตุผลที่ปฏิเสธ</h3>
            <p className="text-small">{data.reject_reason}</p>
          </div>
        )}
        {(canStart || canSubmitVerify || canSupervisorApprove || canReject || canManagerApprove || canClose || canEdit) && (
          <div className="card py-3">
            <div className="flex flex-wrap gap-2">
              {canEdit && <Button variant="secondary" size="sm" onClick={() => setActionModal('edit')}>แก้ไขข้อมูล</Button>}
              {canStart && <Button variant="primary" size="sm" onClick={() => setActionModal('start')}>เริ่มดำเนินการ</Button>}
              {canSubmitVerify && <Button variant="accent" size="sm" onClick={() => setActionModal('submit-verify')}>ส่ง QC ตรวจสอบ</Button>}
              {canSupervisorApprove && (
                <Button variant="success" size="sm" onClick={() => setActionModal('supervisor-approve')}>
                  QC Supervisor อนุมัติ {data.severity === 'minor' && '(ปิดทันที)'}
                </Button>
              )}
              {canReject && <Button variant="danger" size="sm" onClick={() => setActionModal('reject')}>QC ปฏิเสธ</Button>}
              {canManagerApprove && <Button variant="primary" size="sm" onClick={() => setActionModal('manager-approve')}>QC Manager อนุมัติ (ปิด)</Button>}
              {canClose && <Button variant="primary" size="sm" onClick={() => setActionModal('close')}>ปิด FNCP</Button>}
              {status === 'fuai_opened' && data.fuai_id && (
                <a href={`/fg-production/fuai/${data.fuai_id}`} className="btn btn-secondary text-small text-sm px-3 py-1.5">ดู FUAI</a>
              )}
            </div>
          </div>
        )}

      </div>

      {/* ── Action Modals ── */}
      {actionModal === 'start' && (
        <ActionModal title="เริ่มดำเนินการแก้ไข" onClose={() => { setActionModal(null); setActionErr(''); }} confirmLabel="เริ่มดำเนินการ"
          loading={doAction.isPending} onConfirm={() => trigger('start')}>
          <div>
            <label className="label">หน่วยงานรับผิดชอบ</label>
            <input className="input" placeholder="ชื่อหน่วยงาน/แผนก..." value={extra.department_responsible || ''} onChange={e => setExtra(p => ({ ...p, department_responsible: e.target.value }))} />
          </div>
          <div>
            <label className="label">การแก้ไขเฉพาะหน้า</label>
            <textarea rows={2} className="input" value={extra.correction || ''} onChange={e => setExtra(p => ({ ...p, correction: e.target.value }))} />
          </div>
          <div>
            <label className="label">หมายเหตุ</label>
            <textarea rows={2} className="input" value={comment} onChange={e => setComment(e.target.value)} />
          </div>
          {actionErr && <p className="text-danger text-small">{actionErr}</p>}
        </ActionModal>
      )}

      {actionModal === 'submit-verify' && (
        <ActionModal title="ส่ง QC ตรวจสอบ" onClose={() => { setActionModal(null); setActionErr(''); }} confirmLabel="ส่งตรวจสอบ" variant="accent"
          loading={doAction.isPending} onConfirm={() => trigger('submit-verify')}>
          <div>
            <label className="label">Root Cause</label>
            <textarea rows={2} className="input" value={extra.root_cause || ''} onChange={e => setExtra(p => ({ ...p, root_cause: e.target.value }))} />
          </div>
          <div>
            <label className="label">Corrective Action</label>
            <textarea rows={2} className="input" value={extra.corrective_action || ''} onChange={e => setExtra(p => ({ ...p, corrective_action: e.target.value }))} />
          </div>
          <div>
            <label className="label">หมายเหตุ</label>
            <textarea rows={1} className="input" value={comment} onChange={e => setComment(e.target.value)} />
          </div>
          {actionErr && <p className="text-danger text-small">{actionErr}</p>}
        </ActionModal>
      )}

      {actionModal === 'reject' && (
        <ActionModal title="QC ปฏิเสธ — ส่งกลับแก้ไข" onClose={() => { setActionModal(null); setActionErr(''); }} confirmLabel="ปฏิเสธ" variant="danger"
          loading={doAction.isPending} onConfirm={() => { if (!extra.reject_reason) { setActionErr('กรุณาระบุเหตุผล'); return; } trigger('reject', { reject_reason: extra.reject_reason }); }}>
          <div>
            <label className="label">เหตุผลที่ปฏิเสธ *</label>
            <textarea rows={3} className="input" placeholder="ระบุเหตุผล..." value={extra.reject_reason || ''} onChange={e => setExtra(p => ({ ...p, reject_reason: e.target.value }))} />
          </div>
          {actionErr && <p className="text-danger text-small">{actionErr}</p>}
        </ActionModal>
      )}

      {actionModal === 'close' && (
        <ActionModal title="ปิด FNCP" onClose={() => { setActionModal(null); setActionErr(''); }} confirmLabel="ปิด FNCP"
          loading={doAction.isPending} onConfirm={() => trigger('close')}>
          <p className="text-small text-text">ยืนยันการปิด FNCP <strong>{data.fncp_no}</strong>?</p>
          <div>
            <label className="label">หมายเหตุ</label>
            <textarea rows={2} className="input" value={comment} onChange={e => setComment(e.target.value)} />
          </div>
          {actionErr && <p className="text-danger text-small">{actionErr}</p>}
        </ActionModal>
      )}

      {actionModal === 'supervisor-approve' && (
        <ActionModal title="QC Supervisor อนุมัติ" onClose={() => { setActionModal(null); setActionErr(''); }} confirmLabel="อนุมัติ" variant="success"
          loading={doAction.isPending} onConfirm={() => trigger('supervisor-approve')}>
          {data.severity === 'minor'
            ? <p className="text-small text-text">Severity: <strong>Minor</strong> — อนุมัติแล้วระบบจะปิด FNCP <strong>{data.fncp_no}</strong> ทันที</p>
            : <p className="text-small text-text">Severity: <strong className="text-orange-700 dark:text-orange-200">{data.severity}</strong> — อนุมัติแล้วรอ QC Manager อนุมัติต่ออีกครั้ง</p>
          }
          <div>
            <label className="label">หมายเหตุ</label>
            <textarea rows={2} className="input" value={comment} onChange={e => setComment(e.target.value)} />
          </div>
          {actionErr && <p className="text-danger text-small">{actionErr}</p>}
        </ActionModal>
      )}

      {actionModal === 'manager-approve' && (
        <ActionModal title="QC Manager อนุมัติ (ปิด FNCP)" onClose={() => { setActionModal(null); setActionErr(''); }} confirmLabel="อนุมัติและปิด"
          loading={doAction.isPending} onConfirm={() => trigger('manager-approve')}>
          <p className="text-small text-text">ยืนยันการอนุมัติและปิด FNCP <strong>{data.fncp_no}</strong>?</p>
          <div>
            <label className="label">หมายเหตุ</label>
            <textarea rows={2} className="input" value={comment} onChange={e => setComment(e.target.value)} />
          </div>
          {actionErr && <p className="text-danger text-small">{actionErr}</p>}
        </ActionModal>
      )}

      {actionModal === 'edit' && (
        <Modal open onClose={() => setActionModal(null)} title="แก้ไขข้อมูล FNCP" size="lg">
          <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
            {[
              ['department_responsible', 'หน่วยงานรับผิดชอบ', 'input'],
              ['root_cause',            'Root Cause',          'textarea'],
              ['correction',            'Correction (แก้ไขเฉพาะหน้า)', 'textarea'],
              ['corrective_action',     'Corrective Action',   'textarea'],
              ['preventive_action',     'Preventive Action',   'textarea'],
            ].map(([key, label, type]) => (
              <div key={key}>
                <label className="label">{label}</label>
                {type === 'textarea'
                  ? <textarea rows={2} className="input" defaultValue={data[key] || ''} onChange={e => setExtra(p => ({ ...p, [key]: e.target.value }))} />
                  : <input className="input" defaultValue={data[key] || ''} onChange={e => setExtra(p => ({ ...p, [key]: e.target.value }))} />
                }
              </div>
            ))}
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="secondary" onClick={() => setActionModal(null)}>ยกเลิก</Button>
              <Button variant="primary" loading={doEdit.isPending} onClick={() => doEdit.mutate(extra)}>บันทึก</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
