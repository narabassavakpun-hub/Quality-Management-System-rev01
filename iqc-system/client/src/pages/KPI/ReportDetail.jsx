// ⚠️ DEPRECATED (Session 104) — ไม่มีที่ไหนใน UI ลิงก์มาหน้านี้ (ไม่มีปุ่มสร้าง/หน้า list ของ kpi_reports)
// ถูกแทนที่ด้วยแท็บ "บันทึก KPI" (kpi_actuals) + "สรุป KPI" (kpi_action_plans) ใน KPI/index.jsx — ดู AUDIT.md §3.7/D3
// คงไฟล์ไว้ (ไม่ลบ) รอมติ product owner — ห้ามใช้เป็น pattern อ้างอิงสำหรับหน้าใหม่
import React, { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../utils/api';
import Button from '../../components/UI/Button';
import Modal from '../../components/UI/Modal';

const MONTH_FULL = [
  'มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
  'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม',
];

const KPI_STATUS_CONFIG = {
  draft:              { label: 'ร่าง',          color: 'bg-gray-100 dark:bg-gray-900 text-gray-700 dark:text-gray-200' },
  pending_qc_manager: { label: 'รอ QC Manager',  color: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200' },
  pending_cpo:        { label: 'รอ CPO',         color: 'bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200' },
  pending_qmr:        { label: 'รอ QMR',         color: 'bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200' },
  approved:           { label: 'อนุมัติแล้ว',    color: 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200' },
  rejected:           { label: 'ถูกปฏิเสธ',      color: 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200' },
};

function KPIStatusBadge({ status }) {
  const cfg = KPI_STATUS_CONFIG[status] || { label: status, color: 'bg-gray-100 dark:bg-gray-900 text-gray-700 dark:text-gray-200' };
  return <span className={`badge ${cfg.color}`}>{cfg.label}</span>;
}

// เจตนาแยกจาก utils/rolePermissions.js ROLE_LABELS — ที่นี่คือ "บทบาทในขั้นตอนอนุมัติ KPI" ไม่ใช่ชื่อ role ระบบ
// (admin แสดงเป็น 'ผู้จัดทำ' ในบริบทนี้ ไม่ใช่ 'ผู้ดูแลระบบ') — ห้ามรวมเข้ากับ ROLE_LABELS กลาง
const ROLE_LABELS = {
  admin:        'ผู้จัดทำ',
  qc_manager:   'QC Manager',
  cpo:          'CPO',
  qmr:          'QMR',
};

function fmtDT(ts) {
  if (!ts) return '-';
  const s = ts.endsWith('Z') ? ts : ts + 'Z';
  return new Date(s).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
}

function fmtDate(ts) {
  if (!ts) return '-';
  const s = ts.endsWith('Z') ? ts : ts + 'Z';
  return new Date(s).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' });
}

// ── Approval Timeline ──────────────────────────────────────────────────────────
function ApprovalTimeline({ approvals }) {
  if (!approvals?.length) return null;

  const ACTION_LABELS = {
    submit:  'ส่งอนุมัติ',
    approve: 'อนุมัติ',
    reject:  'ปฏิเสธ',
    revise:  'แก้ไขและส่งใหม่',
  };

  return (
    <div className="space-y-3">
      {approvals.map((a, i) => {
        const isLast = i === approvals.length - 1;
        const isReject = a.action === 'reject';
        const connector = !isLast && <div className="w-0.5 h-full bg-border mt-1" />;

        return (
          <div key={a.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className={`w-8 h-8 rounded-full text-white flex items-center justify-center text-small font-bold flex-shrink-0 ${
                isReject ? 'bg-danger' : a.action === 'approve' ? 'bg-success' : 'bg-primary'
              }`}>
                {i + 1}
              </div>
              {connector}
            </div>
            <div className="pb-4 flex-1 min-w-0">
              <div className={`text-[12px] font-semibold uppercase tracking-wide mb-0.5 ${
                isReject ? 'text-danger' : a.action === 'approve' ? 'text-success' : 'text-accent'
              }`}>
                {ACTION_LABELS[a.action] ?? a.action}
              </div>
              <div className="text-body font-medium">
                {a.full_name || a.role}
                <span className="text-small text-muted font-normal ml-1">({ROLE_LABELS[a.role] ?? a.role})</span>
              </div>
              <div className="text-small text-muted">{fmtDT(a.created_at)}</div>
              {a.comment && (
                <div className={`text-small mt-1 px-2 py-1 rounded ${
                  isReject ? 'bg-red-50 dark:bg-red-900 text-danger' : 'bg-bg text-text'
                }`}>
                  {a.comment}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Achievement color ──────────────────────────────────────────────────────────
function AchievementCell({ target, actual }) {
  if (target === null || target === undefined || target === '') return <span className="text-muted">-</span>;
  if (actual === null || actual === undefined || actual === '') return <span className="text-muted">-</span>;
  const t = +target;
  if (t === 0) return <span className="text-muted">-</span>;
  const pct = (+actual / t) * 100;
  const color = pct >= 100 ? 'text-success font-semibold' : pct >= 80 ? 'text-warning font-semibold' : 'text-danger font-semibold';
  return <span className={color}>{pct.toFixed(1)}%</span>;
}

// ── File list ──────────────────────────────────────────────────────────────────
function FileList({ files, entryId, reportId, canEdit, onRefresh }) {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef();

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api.post(`/kpi/reports/${reportId}/entries/${entryId}/files`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onRefresh();
    } catch (err) {
      alert(err.response?.data?.error || 'อัปโหลดไม่สำเร็จ');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function handleDelete(fileId) {
    if (!window.confirm('ลบไฟล์นี้?')) return;
    try {
      await api.delete(`/kpi/reports/${reportId}/entries/${entryId}/files/${fileId}`);
      onRefresh();
    } catch (err) {
      alert(err.response?.data?.error || 'ลบไม่สำเร็จ');
    }
  }

  return (
    <div className="space-y-1">
      {(files ?? []).map(f => (
        <div key={f.id} className="flex items-center gap-1">
          <a
            href={`/uploads/${f.file_path}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent text-small hover:underline truncate max-w-[120px]"
            title={f.original_name}
          >
            {f.original_name}
          </a>
          {canEdit && (
            <button
              onClick={() => handleDelete(f.id)}
              className="text-danger text-[11px] hover:underline flex-shrink-0"
            >
              ลบ
            </button>
          )}
        </div>
      ))}
      {canEdit && (
        <>
          <input ref={fileRef} type="file" className="hidden" onChange={handleUpload} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="text-accent text-small hover:underline min-h-[32px]"
          >
            {uploading ? 'กำลังอัปโหลด...' : '+ แนบไฟล์'}
          </button>
        </>
      )}
    </div>
  );
}

// ── MAIN COMPONENT ─────────────────────────────────────────────────────────────
export default function KPIReportDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [editMode, setEditMode]       = useState(false);
  const [entryEdits, setEntryEdits]   = useState({}); // { [entryId]: { actual_value, remark, data_source_note } }

  const [rejectOpen, setRejectOpen]   = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const { data: report, isLoading, isError } = useQuery({
    queryKey: ['kpi-report', id],
    queryFn: () => api.get(`/kpi/reports/${id}`).then(r => r.data),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['kpi-report', id] });
  }

  // ── Mutations ──
  const saveMutation = useMutation({
    mutationFn: () => {
      const entries = Object.entries(entryEdits).map(([entryId, vals]) => ({
        id: +entryId,
        ...vals,
      }));
      return api.patch(`/kpi/reports/${id}/entries`, { entries });
    },
    onSuccess: () => {
      invalidate();
      setEditMode(false);
      setEntryEdits({});
    },
  });

  const submitMutation = useMutation({
    mutationFn: () => api.post(`/kpi/reports/${id}/submit`),
    onSuccess: invalidate,
  });

  const approveMutation = useMutation({
    mutationFn: () => api.post(`/kpi/reports/${id}/approve`),
    onSuccess: invalidate,
  });

  const rejectMutation = useMutation({
    mutationFn: () => api.post(`/kpi/reports/${id}/reject`, { reason: rejectReason }),
    onSuccess: () => {
      invalidate();
      setRejectOpen(false);
      setRejectReason('');
    },
  });

  const reviseMutation = useMutation({
    mutationFn: () => api.post(`/kpi/reports/${id}/revise`),
    onSuccess: invalidate,
  });

  if (isLoading) return <div className="page-header"><div className="text-muted text-small">กำลังโหลด...</div></div>;
  if (isError || !report) return <div className="page-header"><div className="text-danger text-small">ไม่พบข้อมูลรายงาน</div></div>;

  const { status } = report;
  const role = user?.role;
  const isAdmin = role === 'admin';

  const canEdit   = isAdmin && (status === 'draft' || status === 'rejected');
  const canSubmit = isAdmin && (status === 'draft' || status === 'rejected');
  const canApprove =
    (role === 'qc_manager' && status === 'pending_qc_manager') ||
    (role === 'cpo'        && status === 'pending_cpo')         ||
    (role === 'qmr'        && status === 'pending_qmr');
  const canReject = canApprove;

  // Grouped entries
  const groups = report.groups ?? [];

  function getEntryField(entryId, field, fallback) {
    return entryEdits[entryId]?.[field] !== undefined
      ? entryEdits[entryId][field]
      : fallback ?? '';
  }

  function setEntryField(entryId, field, value) {
    setEntryEdits(prev => ({
      ...prev,
      [entryId]: { ...(prev[entryId] ?? {}), [field]: value },
    }));
  }

  function startEdit() {
    // Pre-populate edits from existing data
    const init = {};
    groups.forEach(g => {
      g.entries?.forEach(e => {
        init[e.id] = {
          actual_value:      e.actual_value ?? '',
          remark:            e.remark ?? '',
          data_source_note:  e.data_source_note ?? '',
        };
      });
    });
    setEntryEdits(init);
    setEditMode(true);
  }

  return (
    <div>
      {/* Back button */}
      <div className="mb-4">
        <button
          onClick={() => navigate('/kpi/summary')}
          className="flex items-center gap-1 text-accent text-small hover:underline min-h-[44px]"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          กลับรายการ KPI
        </button>
      </div>

      {/* Header card */}
      <div className="bg-surface border border-border rounded-lg p-4 mb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono font-bold text-primary text-h2">
                {report.report_no || `KPI-${report.id}`}
              </span>
              <KPIStatusBadge status={status} />
            </div>
            <div className="text-body text-text font-medium mb-1">
              {MONTH_FULL[(report.month ?? 1) - 1]} {(report.year ?? 0) + 543}
            </div>
            <div className="text-small text-muted">
              ผู้จัดทำ: {report.created_by_name ?? '-'} | วันที่สร้าง: {fmtDate(report.created_at)}
            </div>
            {status === 'rejected' && report.reject_reason && (
              <div className="mt-2 bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded px-3 py-2">
                <div className="text-small font-semibold text-danger mb-0.5">เหตุผลที่ถูกปฏิเสธ</div>
                <div className="text-small text-danger">{report.reject_reason}</div>
                {report.rejected_by_role && (
                  <div className="text-small text-muted mt-0.5">โดย: {ROLE_LABELS[report.rejected_by_role] ?? report.rejected_by_role}</div>
                )}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            {canEdit && !editMode && (
              <Button variant="secondary" onClick={startEdit}>แก้ไขข้อมูล</Button>
            )}
            {editMode && (
              <>
                <Button variant="secondary" onClick={() => { setEditMode(false); setEntryEdits({}); }}>ยกเลิก</Button>
                <Button loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>บันทึกข้อมูล</Button>
              </>
            )}
            {canSubmit && !editMode && (
              <Button loading={submitMutation.isPending} onClick={() => submitMutation.mutate()}>
                ส่งอนุมัติ
              </Button>
            )}
            {status === 'rejected' && isAdmin && !editMode && (
              <Button variant="secondary" loading={reviseMutation.isPending} onClick={() => reviseMutation.mutate()}>
                รีเซ็ตเป็นร่าง
              </Button>
            )}
            {canApprove && (
              <Button variant="success" loading={approveMutation.isPending} onClick={() => approveMutation.mutate()}>
                {role === 'qmr' ? 'รับทราบ / อนุมัติ' : 'อนุมัติ'}
              </Button>
            )}
            {canReject && (
              <Button variant="danger" onClick={() => setRejectOpen(true)}>
                ไม่อนุมัติ
              </Button>
            )}
          </div>
        </div>

        {saveMutation.error && (
          <div className="mt-2 text-small text-danger">{saveMutation.error?.response?.data?.error || 'บันทึกไม่สำเร็จ'}</div>
        )}
        {submitMutation.error && (
          <div className="mt-2 text-small text-danger">{submitMutation.error?.response?.data?.error || 'ส่งอนุมัติไม่สำเร็จ'}</div>
        )}
      </div>

      {/* KPI Data table */}
      <div className="bg-surface border border-border rounded-lg mb-4">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-h3 font-semibold text-primary">ข้อมูล KPI</h2>
        </div>

        {groups.length === 0 && (
          <div className="text-center py-8 text-muted text-small">ไม่มีรายการ KPI</div>
        )}

        {groups.map(group => (
          <div key={group.id} className="mb-0">
            <div className="bg-bg px-4 py-2 border-b border-border">
              <span className="font-semibold text-body text-primary">{group.name}</span>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-border">
              {group.entries?.map(entry => {
                const target    = entry.target_value;
                const actual    = editMode ? getEntryField(entry.id, 'actual_value', entry.actual_value) : entry.actual_value;
                return (
                  <div key={entry.id} className="p-3 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <span className="font-mono text-small text-muted mr-1">{entry.kpi_no}</span>
                        <span className="font-medium text-body">{entry.item_name}</span>
                        {entry.unit && <span className="text-small text-muted ml-1">({entry.unit})</span>}
                      </div>
                      <AchievementCell target={target} actual={actual} />
                    </div>
                    <div className="text-small text-muted">
                      เป้าหมาย: {target !== null && target !== undefined ? target : '-'}
                    </div>
                    {editMode ? (
                      <div className="space-y-1">
                        <input
                          type="number"
                          className="input py-1 text-small"
                          placeholder="ค่าจริง"
                          value={getEntryField(entry.id, 'actual_value', entry.actual_value)}
                          onChange={e => setEntryField(entry.id, 'actual_value', e.target.value)}
                        />
                        <textarea
                          className="input py-1 text-small"
                          rows={1}
                          placeholder="หมายเหตุ"
                          value={getEntryField(entry.id, 'remark', entry.remark)}
                          onChange={e => setEntryField(entry.id, 'remark', e.target.value)}
                        />
                        <textarea
                          className="input py-1 text-small"
                          rows={1}
                          placeholder="แหล่งที่มา"
                          value={getEntryField(entry.id, 'data_source_note', entry.data_source_note)}
                          onChange={e => setEntryField(entry.id, 'data_source_note', e.target.value)}
                        />
                      </div>
                    ) : (
                      <>
                        <div className="text-small">ค่าจริง: <span className="font-medium">{entry.actual_value !== null && entry.actual_value !== undefined ? entry.actual_value : '-'}</span></div>
                        {entry.remark && <div className="text-small text-muted">หมายเหตุ: {entry.remark}</div>}
                        {entry.data_source_note && <div className="text-small text-muted">แหล่งที่มา: {entry.data_source_note}</div>}
                      </>
                    )}
                    <FileList
                      files={entry.files}
                      entryId={entry.id}
                      reportId={id}
                      canEdit={canEdit && editMode}
                      onRefresh={invalidate}
                    />
                  </div>
                );
              })}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full min-w-[800px]">
                <thead className="bg-bg/50 border-b border-border">
                  <tr>
                    <th className="th text-left px-3 py-2 w-20">KPI No.</th>
                    <th className="th text-left px-3 py-2">ชื่อ KPI</th>
                    <th className="th text-center px-3 py-2 w-16">หน่วย</th>
                    <th className="th text-center px-3 py-2 w-20">เป้าหมาย</th>
                    <th className="th text-center px-3 py-2 w-24">ค่าจริง</th>
                    <th className="th text-center px-3 py-2 w-16">%</th>
                    <th className="th text-left px-3 py-2">หมายเหตุ</th>
                    <th className="th text-left px-3 py-2">แหล่งที่มา</th>
                    <th className="th text-left px-3 py-2 w-28">ไฟล์</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {group.entries?.map(entry => {
                    const target = entry.target_value;
                    const actual = editMode
                      ? getEntryField(entry.id, 'actual_value', entry.actual_value)
                      : entry.actual_value;

                    return (
                      <tr key={entry.id} className="hover:bg-bg">
                        <td className="px-3 py-2 font-mono text-small text-muted">{entry.kpi_no}</td>
                        <td className="px-3 py-2 font-medium text-body">{entry.item_name}</td>
                        <td className="px-3 py-2 text-center text-small text-muted">{entry.unit ?? '-'}</td>
                        <td className="px-3 py-2 text-center text-small">
                          {target !== null && target !== undefined ? target : '-'}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {editMode ? (
                            <input
                              type="number"
                              className="w-20 text-center border border-border rounded px-1 py-1 text-small focus:outline-none focus:ring-1 focus:ring-primary"
                              value={getEntryField(entry.id, 'actual_value', entry.actual_value)}
                              onChange={e => setEntryField(entry.id, 'actual_value', e.target.value)}
                            />
                          ) : (
                            <span className="text-small">
                              {actual !== null && actual !== undefined && actual !== '' ? actual : '-'}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <AchievementCell target={target} actual={actual} />
                        </td>
                        <td className="px-3 py-2">
                          {editMode ? (
                            <textarea
                              className="input py-1 text-small w-full"
                              rows={1}
                              value={getEntryField(entry.id, 'remark', entry.remark)}
                              onChange={e => setEntryField(entry.id, 'remark', e.target.value)}
                              placeholder="หมายเหตุ"
                            />
                          ) : (
                            <span className="text-small">{entry.remark || '-'}</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {editMode ? (
                            <textarea
                              className="input py-1 text-small w-full"
                              rows={1}
                              value={getEntryField(entry.id, 'data_source_note', entry.data_source_note)}
                              onChange={e => setEntryField(entry.id, 'data_source_note', e.target.value)}
                              placeholder="แหล่งที่มา"
                            />
                          ) : (
                            <span className="text-small">{entry.data_source_note || '-'}</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <FileList
                            files={entry.files}
                            entryId={entry.id}
                            reportId={id}
                            canEdit={canEdit && editMode}
                            onRefresh={invalidate}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      {/* Timeline */}
      {report.approvals?.length > 0 && (
        <div className="bg-surface border border-border rounded-lg p-4 mb-4">
          <h2 className="text-h3 font-semibold text-primary mb-4">Timeline การดำเนินการ</h2>
          <ApprovalTimeline approvals={report.approvals} />
        </div>
      )}

      {/* Reject modal */}
      <Modal open={rejectOpen} onClose={() => { setRejectOpen(false); setRejectReason(''); }} title="ไม่อนุมัติรายงาน KPI">
        <div className="space-y-4">
          <div>
            <label className="label">เหตุผลที่ไม่อนุมัติ *</label>
            <textarea
              className="input"
              rows={4}
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="กรุณาระบุเหตุผล..."
              autoFocus
            />
          </div>
          {rejectMutation.error && (
            <p className="text-danger text-small">{rejectMutation.error?.response?.data?.error || 'เกิดข้อผิดพลาด'}</p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => { setRejectOpen(false); setRejectReason(''); }}>ยกเลิก</Button>
            <Button
              variant="danger"
              disabled={!rejectReason.trim()}
              loading={rejectMutation.isPending}
              onClick={() => rejectMutation.mutate()}
            >
              ยืนยันไม่อนุมัติ
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
