import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import Button from '../../components/UI/Button';
import Modal from '../../components/UI/Modal';
import { STATUS_LABELS } from '../../utils/rolePermissions';

const SEV_COLOR = { minor: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-200', major: 'bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-200', critical: 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200' };

function StatusBadge({ s }) {
  const lbl = STATUS_LABELS[s] || { label: s, color: 'bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-200' };
  return <span className={`badge ${lbl.color}`}>{lbl.label}</span>;
}

function toThaiTime(utcStr) {
  if (!utcStr) return '';
  const iso = utcStr.replace(' ', 'T') + (utcStr.includes('Z') || utcStr.includes('+') ? '' : 'Z');
  const d = new Date(iso);
  if (isNaN(d.getTime())) return utcStr.slice(0, 16).replace('T', ' ');
  const th = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  const p = n => String(n).padStart(2, '0');
  return `${th.getUTCFullYear()}-${p(th.getUTCMonth() + 1)}-${p(th.getUTCDate())} ${p(th.getUTCHours())}:${p(th.getUTCMinutes())}`;
}

const TL_ICON = {
  create: '📄', prod_manager_approve: '✅', cpo_approve: '✅', cpo_reject: '❌',
  qc_manager_approve: '✅', qc_manager_reject: '❌', qc_staff_ack: '👁', qc_supervisor_ack: '🔒',
};

const APPROVAL_STEPS = [
  { key: 'prod_manager', label: 'ผู้จัดการฝ่ายผลิต', name_field: 'prod_manager_name', at_field: 'prod_manager_approved_at', status: 'pending_prod_manager' },
  { key: 'cpo',         label: 'CPO',               name_field: 'cpo_name',          at_field: 'cpo_approved_at',          status: 'pending_cpo' },
  { key: 'qc_manager',  label: 'QC Manager',        name_field: 'qc_manager_name',   at_field: 'qc_manager_approved_at',   status: 'pending_qc_manager' },
  { key: 'qc_staff',    label: 'QC Staff รับทราบ',  name_field: 'qc_staff_name',     at_field: 'qc_staff_ack_at',          status: 'pending_qc_staff_ack' },
  { key: 'qc_supervisor',label: 'QC Supervisor รับทราบ', name_field: 'qc_supervisor_name', at_field: 'qc_supervisor_ack_at', status: 'pending_qc_supervisor_ack' },
];

function ApprovalChain({ data }) {
  const STATUS_ORDER = ['pending_prod_manager','pending_cpo','pending_qc_manager','pending_qc_staff_ack','pending_qc_supervisor_ack','closed','rejected'];
  const currentIdx = STATUS_ORDER.indexOf(data.status);

  return (
    <div className="space-y-2">
      {APPROVAL_STEPS.map((step, idx) => {
        const stepIdx = STATUS_ORDER.indexOf(step.status);
        const isDone = data[step.at_field];
        const isCurrent = STATUS_ORDER.indexOf(data.status) === stepIdx;
        const isRejected = data.status === 'rejected' && stepIdx > (currentIdx === -1 ? 99 : currentIdx);

        return (
          <div key={step.key} className={`flex items-start gap-3 p-2 rounded-lg border ${isDone ? 'bg-green-50 dark:bg-green-900 border-green-200 dark:border-green-700' : isCurrent ? 'bg-yellow-50 dark:bg-yellow-900 border-yellow-300 dark:border-yellow-600' : 'bg-bg border-border'}`}>
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5 ${isDone ? 'bg-success text-white' : isCurrent ? 'bg-warning text-white' : 'bg-border text-muted'}`}>
              {isDone ? '✓' : idx + 1}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-small font-medium">{step.label}</div>
              {isDone && (
                <div className="text-[11px] text-muted mt-0.5">{data[step.name_field] || '—'} · {toThaiTime(data[step.at_field])}</div>
              )}
              {isCurrent && !isDone && <div className="text-[11px] text-warning mt-0.5">รออนุมัติ</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
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

export default function FUAIDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [actionModal, setActionModal] = useState(null);
  const [comment, setComment] = useState('');
  const [reason, setReason] = useState('');
  const [actionErr, setActionErr] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['fuai-detail', id],
    queryFn: () => api.get(`/fg-fuai/${id}`).then(r => r.data),
    staleTime: 15000,
  });

  const doAction = useMutation({
    mutationFn: ({ action, body }) => api.patch(`/fg-fuai/${id}/${action}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fuai-detail', id] });
      qc.invalidateQueries({ queryKey: ['fuai-list'] });
      setActionModal(null); setComment(''); setReason(''); setActionErr('');
    },
    onError: e => setActionErr(e.response?.data?.error || 'เกิดข้อผิดพลาด'),
  });

  if (isLoading) return <div className="page-container"><div className="text-muted py-8 text-center">กำลังโหลด...</div></div>;
  if (!data) return <div className="page-container"><div className="text-danger py-8 text-center">ไม่พบ FUAI</div></div>;

  const { timeline = [] } = data;
  const role = user?.role;
  const status = data.status;

  const canProdManagerApprove = ['admin','production_manager'].includes(role) && status === 'pending_prod_manager';
  const canCPOApprove   = ['admin','cpo'].includes(role) && status === 'pending_cpo';
  const canCPOReject    = ['admin','cpo'].includes(role) && status === 'pending_cpo';
  const canQCMgrApprove = ['admin','qc_manager'].includes(role) && status === 'pending_qc_manager';
  const canQCMgrReject  = ['admin','qc_manager'].includes(role) && status === 'pending_qc_manager';
  const canQCStaffAck   = ['admin','qc_staff'].includes(role) && status === 'pending_qc_staff_ack';
  const canQCSuperAck   = ['admin','qc_supervisor','qc_manager'].includes(role) && status === 'pending_qc_supervisor_ack';

  const hasActions = canProdManagerApprove || canCPOApprove || canCPOReject || canQCMgrApprove || canQCMgrReject || canQCStaffAck || canQCSuperAck;

  const trigger = (action, body = {}) => {
    setActionErr('');
    doAction.mutate({ action, body: { comment, reason, ...body } });
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="page-title">{data.fuai_no}</h1>
            <StatusBadge s={status} />
            {data.fncp_severity && <span className={`badge ${SEV_COLOR[data.fncp_severity]}`}>{data.fncp_severity}</span>}
          </div>
          <p className="text-muted text-small mt-1">
            FNCP: <Link to={`/fg-production/fncp/${data.fncp_id}`} className="text-accent hover:underline">{data.fncp_no}</Link>
            {data.product_no && ` | ${data.product_no} — ${data.product_desc}`}
          </p>
        </div>
        <Link to="/fg-production/fuai"><Button variant="secondary" size="sm">← รายการ FUAI</Button></Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* ── Card: ข้อมูล FUAI ── */}
        <div className="order-1 lg:col-span-2 card">
          <h3 className="text-h3 font-semibold mb-3">ข้อมูล FUAI</h3>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-small">
            {[
              ['สายการผลิต',   data.line_name || '—'],
              ['สินค้า',       `${data.product_no || ''} ${data.product_desc || ''}`.trim() || '—'],
              ['จำนวนของเสีย', `${data.defect_qty || 0} ${data.defect_unit || ''}`],
              ['ผู้ขออนุมัติ', data.opened_by || '—'],
              ['วันที่ขอ',     data.opened_at ? toThaiTime(data.opened_at) : '—'],
            ].map(([label, val]) => (
              <div key={label} className="py-0.5">
                <div className="text-muted text-[10px]">{label}</div>
                <div className="font-medium">{val}</div>
              </div>
            ))}
          </div>
          {data.reason && (
            <div className="mt-3 pt-3 border-t border-border">
              <div className="text-muted text-[10px] mb-1">เหตุผลการขออนุมัติ</div>
              <div className="text-small bg-bg rounded p-2 leading-snug">{data.reason}</div>
            </div>
          )}

          {/* Rejection info */}
          {status === 'rejected' && (data.cpo_reject_reason || data.qc_manager_reject_reason) && (
            <div className="mt-3 pt-3 border-t border-border">
              <div className="text-danger text-[10px] font-medium mb-1">เหตุผลที่ถูกปฏิเสธ</div>
              <div className="text-small bg-red-50 dark:bg-red-900 rounded p-2 text-danger">
                {data.cpo_reject_reason || data.qc_manager_reject_reason}
              </div>
            </div>
          )}

          {/* RCA from FNCP */}
          <div className="mt-4 pt-3 border-t border-border">
            <h4 className="text-small font-semibold text-muted mb-2">ข้อมูล RCA จาก FNCP อ้างอิง</h4>
            <div className="space-y-2">
              {[
                ['Root Cause', data.root_cause],
                ['Corrective Action', data.corrective_action],
                ['Preventive Action', data.preventive_action],
              ].map(([label, val]) => (
                <div key={label}>
                  <div className="text-[10px] text-muted mb-0.5">{label}</div>
                  <div className="text-small bg-bg rounded p-2 min-h-[28px]">{val || <span className="italic text-muted">—</span>}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Timeline ── */}
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

        {/* ── Approval Chain ── */}
        <div className="order-2 lg:col-span-2 lg:col-start-1 lg:row-start-2 card">
          <h3 className="text-h3 font-semibold mb-3">ขั้นตอนการอนุมัติ</h3>
          <ApprovalChain data={data} />
        </div>

      </div>

      {/* Action Panel */}
      {hasActions && (
        <div className="card py-3 mt-4">
          <div className="flex flex-wrap gap-2">
            {canProdManagerApprove && <Button variant="success" size="sm" onClick={() => setActionModal('prod-manager-approve')}>ผู้จัดการฝ่ายผลิต อนุมัติ</Button>}
            {canCPOApprove && <Button variant="success" size="sm" onClick={() => setActionModal('cpo-approve')}>CPO อนุมัติ</Button>}
            {canCPOReject && <Button variant="danger" size="sm" onClick={() => setActionModal('cpo-reject')}>CPO ปฏิเสธ</Button>}
            {canQCMgrApprove && <Button variant="success" size="sm" onClick={() => setActionModal('qc-manager-approve')}>QC Manager อนุมัติ</Button>}
            {canQCMgrReject && <Button variant="danger" size="sm" onClick={() => setActionModal('qc-manager-reject')}>QC Manager ปฏิเสธ</Button>}
            {canQCStaffAck && <Button variant="primary" size="sm" onClick={() => setActionModal('qc-staff-ack')}>QC Staff รับทราบ</Button>}
            {canQCSuperAck && <Button variant="primary" size="sm" onClick={() => setActionModal('qc-supervisor-ack')}>QC Supervisor รับทราบ (ปิด FUAI)</Button>}
          </div>
        </div>
      )}

      {/* Action Modals */}
      {['prod-manager-approve','cpo-approve','qc-manager-approve','qc-staff-ack','qc-supervisor-ack'].includes(actionModal) && (
        <ActionModal
          title={{ 'prod-manager-approve':'ผู้จัดการฝ่ายผลิตอนุมัติ', 'cpo-approve':'CPO อนุมัติ', 'qc-manager-approve':'QC Manager อนุมัติ', 'qc-staff-ack':'QC Staff รับทราบ', 'qc-supervisor-ack':'QC Supervisor รับทราบ — ปิด FUAI' }[actionModal]}
          onClose={() => { setActionModal(null); setActionErr(''); }}
          confirmLabel="ยืนยัน" variant="success"
          loading={doAction.isPending}
          onConfirm={() => trigger(actionModal, { comment })}
        >
          <div>
            <label className="label">หมายเหตุ</label>
            <textarea rows={2} className="input" value={comment} onChange={e => setComment(e.target.value)} placeholder="หมายเหตุเพิ่มเติม (ไม่บังคับ)..." />
          </div>
          {actionErr && <p className="text-danger text-small">{actionErr}</p>}
        </ActionModal>
      )}

      {['cpo-reject','qc-manager-reject'].includes(actionModal) && (
        <ActionModal
          title={actionModal === 'cpo-reject' ? 'CPO ปฏิเสธ' : 'QC Manager ปฏิเสธ'}
          onClose={() => { setActionModal(null); setActionErr(''); }}
          confirmLabel="ปฏิเสธ" variant="danger"
          loading={doAction.isPending}
          onConfirm={() => {
            if (!reason.trim()) { setActionErr('กรุณาระบุเหตุผลการปฏิเสธ'); return; }
            trigger(actionModal, { reason });
          }}
        >
          <p className="text-small text-text">ปฏิเสธ FUAI <strong>{data.fuai_no}</strong> — FNCP จะถูกส่งกลับให้ฝ่ายผลิตตอบใหม่</p>
          <div>
            <label className="label">เหตุผลการปฏิเสธ *</label>
            <textarea rows={3} className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="ระบุเหตุผล..." />
          </div>
          {actionErr && <p className="text-danger text-small">{actionErr}</p>}
        </ActionModal>
      )}
    </div>
  );
}
