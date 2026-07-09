import React, { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';

const STATUS_MAP = {
  open:                   { label: 'เปิด',              color: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-200' },
  prod_acknowledged:      { label: 'รับทราบแล้ว',       color: 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200' },
  rechecking:             { label: 'อยู่ระหว่าง Recheck', color: 'bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-200' },
  prod_manager_approved:  { label: 'ส่งให้ QC ตรวจ',    color: 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-200' },
  qc_supervisor_verified: { label: 'QC ยืนยันผ่าน',     color: 'bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-200' },
  closed:                 { label: 'ปิดแล้ว',            color: 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200' },
  cancelled:              { label: 'ยกเลิก',             color: 'bg-gray-100 dark:bg-gray-900 text-gray-500 dark:text-gray-200' },
};

function StatusBadge({ status }) {
  const r = STATUS_MAP[status] || { label: status, color: 'bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-200' };
  return <span className={`badge ${r.color}`}>{r.label}</span>;
}

// --- Timeline ---
function TimelineItem({ icon, title, by, at, detail, color = 'bg-gray-400 dark:bg-gray-700' }) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs ${color}`}>
          {icon}
        </div>
        <div className="w-0.5 bg-border flex-1 mt-1" />
      </div>
      <div className="pb-4 min-w-0">
        <div className="text-small font-semibold text-text">{title}</div>
        {by && <div className="text-[11px] text-muted">{by} {at ? `• ${at.slice(0, 16)}` : ''}</div>}
        {detail && <div className="text-[11px] text-muted mt-1">{detail}</div>}
      </div>
    </div>
  );
}

// --- Action Panel ---
function ActionPanel({ r, role, onAction }) {
  const [form, setForm] = useState({
    root_cause: '', corrective_action: '',
    qty_rechecked: '', qty_pass: '', qty_fail: '', qty_scrap: '',
    remarks: '',
  });
  const setF = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const [loading, setLoading] = useState(false);

  async function act(endpoint, body = {}) {
    setLoading(true);
    try {
      await api.patch(`/ipncr/${r.id}/${endpoint}`, body);
      onAction();
    } catch (e) {
      alert(e.response?.data?.error || 'เกิดข้อผิดพลาด');
    } finally { setLoading(false); }
  }

  const PROD = ['admin', 'production_manager', 'prod_supervisor'];
  const QC   = ['admin', 'qc_staff', 'qc_supervisor'];
  const MGR  = ['admin', 'qc_manager'];

  if (r.status === 'open' && PROD.includes(role)) {
    return (
      <div className="card border-yellow-200 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900">
        <h3 className="text-small font-semibold text-warning mb-2">รับทราบ IPNCR</h3>
        <p className="text-small text-muted mb-3">กด "รับทราบ" เพื่อยืนยันว่าฝ่ายผลิตรับทราบปัญหาแล้ว</p>
        <button className="btn-primary min-h-[44px] px-4" onClick={() => act('acknowledge')} disabled={loading}>
          รับทราบ
        </button>
      </div>
    );
  }

  if (r.status === 'prod_acknowledged' && ['admin', 'production_manager'].includes(role)) {
    return (
      <div className="card border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900">
        <h3 className="text-small font-semibold text-accent mb-2">เริ่มดำเนินการ Recheck</h3>
        <button className="btn-primary min-h-[44px] px-4" onClick={() => act('start-recheck')} disabled={loading}>
          เริ่ม Recheck
        </button>
      </div>
    );
  }

  if (r.status === 'rechecking' && ['admin', 'production_manager'].includes(role)) {
    return (
      <div className="card">
        <h3 className="text-small font-semibold text-text mb-3">
          ส่งผลให้ QC ตรวจซ้ำ (ครั้งที่ {r.recheck_attempt || 1})
        </h3>
        <div className="space-y-2">
          <div>
            <label className="label">Root Cause *</label>
            <textarea className="input text-small" rows={2} placeholder="สาเหตุของปัญหา"
              value={form.root_cause} onChange={e => setF('root_cause', e.target.value)} />
          </div>
          <div>
            <label className="label">Corrective Action *</label>
            <textarea className="input text-small" rows={2} placeholder="การแก้ไข/ป้องกัน"
              value={form.corrective_action} onChange={e => setF('corrective_action', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[
              { k: 'qty_rechecked', label: 'ตรวจซ้ำ (ชิ้น)' },
              { k: 'qty_pass',      label: 'ผ่าน (ชิ้น)' },
              { k: 'qty_fail',      label: 'ไม่ผ่าน (ชิ้น)' },
              { k: 'qty_scrap',     label: 'Scrap (ชิ้น)' },
            ].map(({ k, label }) => (
              <div key={k}>
                <label className="label">{label}</label>
                <input className="input text-small" type="number" min="0"
                  value={form[k]} onChange={e => setF(k, e.target.value)} placeholder="0" />
              </div>
            ))}
          </div>
          <div>
            <label className="label">หมายเหตุ</label>
            <input className="input text-small" value={form.remarks} onChange={e => setF('remarks', e.target.value)} />
          </div>
          <button
            className="btn-primary min-h-[44px] px-4 mt-2"
            onClick={() => act('submit-for-qc', form)}
            disabled={loading || !form.root_cause || !form.corrective_action}
          >
            ส่งให้ QC ตรวจซ้ำ
          </button>
        </div>
      </div>
    );
  }

  if (r.status === 'prod_manager_approved' && QC.includes(role)) {
    return (
      <div className="card">
        <h3 className="text-small font-semibold text-text mb-3">
          QC ตรวจซ้ำ (ครั้งที่ {r.recheck_attempt || 1})
        </h3>
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">ผ่าน (ชิ้น)</label>
              <input className="input text-small" type="number" min="0"
                value={form.qty_pass} onChange={e => setF('qty_pass', e.target.value)} placeholder="0" />
            </div>
            <div>
              <label className="label">ไม่ผ่าน (ชิ้น)</label>
              <input className="input text-small" type="number" min="0"
                value={form.qty_fail} onChange={e => setF('qty_fail', e.target.value)} placeholder="0" />
            </div>
          </div>
          <div>
            <label className="label">หมายเหตุ</label>
            <textarea className="input text-small" rows={2}
              value={form.remarks} onChange={e => setF('remarks', e.target.value)} />
          </div>
          <div className="flex gap-2 mt-2">
            <button
              className="flex-1 min-h-[44px] rounded bg-success text-white font-semibold text-small disabled:opacity-50"
              onClick={() => act('qc-reinspect-pass', { qty_pass: form.qty_pass, remarks: form.remarks })}
              disabled={loading}
            >
              ✓ ผ่าน
            </button>
            <button
              className="flex-1 min-h-[44px] rounded bg-danger text-white font-semibold text-small disabled:opacity-50"
              onClick={() => act('qc-reinspect-fail', { qty_fail: form.qty_fail, remarks: form.remarks || undefined })}
              disabled={loading || !form.remarks}
            >
              ✗ ไม่ผ่าน
            </button>
          </div>
          {!form.remarks && r.status === 'prod_manager_approved' && (
            <p className="text-[11px] text-muted">* กรณีไม่ผ่าน กรุณากรอกหมายเหตุ</p>
          )}
        </div>
      </div>
    );
  }

  if (r.status === 'qc_supervisor_verified' && MGR.includes(role)) {
    return (
      <div className="card border-green-200 dark:border-green-700 bg-green-50 dark:bg-green-900">
        <h3 className="text-small font-semibold text-success mb-2">ปิดเอกสาร IPNCR</h3>
        <div className="space-y-2">
          <div>
            <label className="label">หมายเหตุสรุป</label>
            <textarea className="input text-small" rows={2}
              value={form.remarks} onChange={e => setF('remarks', e.target.value)} placeholder="สรุปการดำเนินการ (ไม่บังคับ)" />
          </div>
          <button
            className="btn-primary min-h-[44px] px-4"
            onClick={() => act('close', { remarks: form.remarks })}
            disabled={loading}
          >
            ปิดเอกสาร
          </button>
        </div>
      </div>
    );
  }

  return null;
}

// --- Main ---
export default function IPNCRDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: r, isLoading, refetch } = useQuery({
    queryKey: ['ipncr-detail', id],
    queryFn: () => api.get(`/ipncr/${id}`).then(res => res.data),
  });

  if (isLoading) return <div className="text-center py-12 text-muted">กำลังโหลด...</div>;
  if (!r) return <div className="text-center py-12 text-danger">ไม่พบรายการ</div>;

  // Build timeline events
  const events = [
    { icon: '✎', title: `สร้าง IPNCR`, by: r.creator_name, at: r.created_at, color: 'bg-gray-500' },
  ];
  if (r.prod_acknowledged_by) {
    events.push({ icon: '✓', title: 'รับทราบ (ฝ่ายผลิต)', by: r.prod_acknowledged_name, at: r.prod_acknowledged_at, color: 'bg-blue-500' });
  }
  (r.recheck_logs || []).forEach(log => {
    const labels = { recheck_submitted: `ส่งผล Recheck (ครั้งที่ ${log.attempt})`, qc_pass: `QC ผ่าน (ครั้งที่ ${log.attempt})`, qc_fail: `QC ไม่ผ่าน (ครั้งที่ ${log.attempt})` };
    const colors = { recheck_submitted: 'bg-orange-500', qc_pass: 'bg-green-600', qc_fail: 'bg-red-600' };
    const icons = { recheck_submitted: '↑', qc_pass: '✓', qc_fail: '✗' };
    events.push({
      icon: icons[log.action] || '•',
      title: labels[log.action] || log.action,
      by: log.created_by_name,
      at: log.created_at,
      detail: log.remarks,
      color: colors[log.action] || 'bg-gray-400 dark:bg-gray-700',
    });
  });
  if (r.verified_by) {
    events.push({ icon: '✓', title: 'QC Supervisor ยืนยัน', by: r.qc_supervisor_verified_name, at: r.verified_at, color: 'bg-indigo-600' });
  }
  if (r.closed_by) {
    events.push({ icon: '★', title: 'ปิดเอกสาร', by: r.closed_name, at: r.closed_at, detail: r.recheck_remarks, color: 'bg-green-700' });
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap gap-3 items-start justify-between">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="font-mono font-bold text-h2 text-primary">{r.record_no}</h1>
            <StatusBadge status={r.status} />
            {r.recheck_attempt > 1 && (
              <span className="badge bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-200">ครั้งที่ {r.recheck_attempt}</span>
            )}
          </div>
          <p className="text-muted text-small mt-1">
            {r.station_name || 'IPQC'} — {r.line_name || '—'}
          </p>
        </div>
      </div>

      {/* Info grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Doc No', val: r.doc_no, mono: true },
          { label: 'สินค้า', val: r.product_no || '—', mono: true },
          { label: 'จำนวนกระทบ', val: r.total_qty_affected || '—' },
          { label: 'กำหนดแก้ไข', val: r.deadline || '—' },
          { label: 'การดำเนินการ', val: r.action_required || '—' },
          { label: 'ผู้สร้าง', val: r.creator_name || '—' },
          { label: 'วันที่สร้าง', val: r.created_at ? r.created_at.slice(0, 16) : '—' },
          { label: 'Recheck ครั้งที่', val: r.recheck_attempt || 1 },
        ].map(({ label, val, mono }) => (
          <div key={label} className="card py-2 px-3">
            <div className="text-[11px] text-muted">{label}</div>
            <div className={`text-small font-semibold text-text mt-0.5 ${mono ? 'font-mono' : ''}`}>{val}</div>
          </div>
        ))}
      </div>

      {/* Defect description */}
      <div className="card">
        <div className="text-[11px] text-muted mb-1">รายละเอียดปัญหา</div>
        <div className="text-small text-text">{r.defect_description}</div>
        {r.root_cause && (
          <div className="mt-2">
            <div className="text-[11px] text-muted">Root Cause</div>
            <div className="text-small text-text">{r.root_cause}</div>
          </div>
        )}
        {r.corrective_action && (
          <div className="mt-2">
            <div className="text-[11px] text-muted">Corrective Action</div>
            <div className="text-small text-text">{r.corrective_action}</div>
          </div>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Timeline */}
        <div className="card">
          <h2 className="text-small font-semibold text-text mb-4">Timeline การดำเนินการ</h2>
          <div>
            {events.map((ev, idx) => (
              <TimelineItem key={idx} {...ev} />
            ))}
          </div>
        </div>

        {/* Recheck logs table */}
        {(r.recheck_logs || []).length > 0 && (
          <div className="card">
            <h2 className="text-small font-semibold text-text mb-3">ประวัติ Recheck</h2>
            <div className="overflow-x-auto">
              <table className="table w-full">
                <thead>
                  <tr>
                    <th className="px-2 py-2 text-left text-[11px] text-muted">ครั้งที่</th>
                    <th className="px-2 py-2 text-left text-[11px] text-muted">Action</th>
                    <th className="px-2 py-2 text-center text-[11px] text-muted">Pass</th>
                    <th className="px-2 py-2 text-center text-[11px] text-muted">Fail</th>
                    <th className="px-2 py-2 text-center text-[11px] text-muted">Scrap</th>
                    <th className="px-2 py-2 text-left text-[11px] text-muted">หมายเหตุ</th>
                  </tr>
                </thead>
                <tbody>
                  {r.recheck_logs.map(log => {
                    const actionLabel = { recheck_submitted: 'ผลิตส่ง', qc_pass: 'QC ผ่าน', qc_fail: 'QC ไม่ผ่าน' }[log.action] || log.action;
                    const resultColor = log.action === 'qc_pass' ? 'text-success' : log.action === 'qc_fail' ? 'text-danger' : '';
                    return (
                      <tr key={log.id} className="border-t border-border">
                        <td className="px-2 py-2 text-center text-small">{log.attempt}</td>
                        <td className={`px-2 py-2 text-small font-medium ${resultColor}`}>{actionLabel}</td>
                        <td className="px-2 py-2 text-center text-small">{log.qty_pass ?? '—'}</td>
                        <td className="px-2 py-2 text-center text-small">{log.qty_fail ?? '—'}</td>
                        <td className="px-2 py-2 text-center text-small">{log.qty_scrap ?? '—'}</td>
                        <td className="px-2 py-2 text-[11px] text-muted max-w-[140px] truncate">{log.remarks || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Linked inspection */}
      {r.inspection && (
        <div className="card">
          <h2 className="text-small font-semibold text-text mb-2">บันทึก IPQC ต้นเหตุ</h2>
          <Link to={`/production-qc/ipqc/${r.inspection.id}`}
            className="flex items-center justify-between p-3 rounded border border-border hover:bg-bg">
            <div>
              <div className="font-mono text-primary text-small font-semibold">{r.inspection.record_no}</div>
              <div className="text-[11px] text-muted">{r.inspection.inspect_date} {r.inspection.inspect_time}</div>
            </div>
            <span className={`badge ${r.inspection.overall_result === 'fail' ? 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200' : 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200'}`}>
              {r.inspection.overall_result === 'fail' ? 'ไม่ผ่าน' : r.inspection.overall_result}
            </span>
          </Link>
        </div>
      )}

      {/* Action panel */}
      {!['closed', 'cancelled'].includes(r.status) && (
        <ActionPanel r={r} role={user?.role} onAction={() => refetch()} />
      )}

      <div className="flex justify-start">
        <button className="btn-secondary min-h-[44px] px-4" onClick={() => navigate(-1)}>← กลับ</button>
      </div>
    </div>
  );
}
