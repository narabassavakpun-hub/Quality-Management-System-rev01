import React, { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import api from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import Button from '../../components/UI/Button';
import Modal from '../../components/UI/Modal';
import Badge from '../../components/UI/Badge';
import { STATUS_LABELS } from '../../utils/rolePermissions';

const todayStr = () => new Date().toISOString().slice(0, 10);
const FG_WRITE  = ['admin', 'production_manager'];
const DEF_WRITE = ['admin', 'qc_staff', 'qc_supervisor', 'qc_manager'];
const SEV_COLOR = { minor: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-200', major: 'bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-200', critical: 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200' };
const SEV_LABEL = { minor: 'Minor', major: 'Major', critical: 'Critical' };

function SevBadge({ v }) {
  return <span className={`badge text-[11px] ${SEV_COLOR[v] || 'bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-200'}`}>{SEV_LABEL[v] || v}</span>;
}
function StatusBadge({ s }) {
  const lbl = STATUS_LABELS[s] || { label: s, color: 'bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-200' };
  return <span className={`badge text-[11px] ${lbl.color}`}>{lbl.label}</span>;
}

// ── Dashboard Cards ───────────────────────────────────────────────────────────
function DashCards({ stats }) {
  if (!stats) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-4">
      {[
        { label: 'แผนทั้งหมด',    val: stats.totalPlan?.toLocaleString(),     cls: 'text-text' },
        { label: 'ผลิตจริง',      val: stats.totalProduced?.toLocaleString(), cls: 'text-accent' },
        { label: 'ของเสีย (รวม)', val: stats.totalDefect?.toLocaleString(),   cls: 'text-danger' },
        { label: 'Defect %',      val: `${stats.defectPct ?? 0}%`,            cls: stats.defectPct > 3 ? 'text-danger' : 'text-success' },
        { label: 'FNCP เปิด',    val: stats.openFncp,                         cls: stats.openFncp > 0 ? 'text-warning' : 'text-success' },
        { label: 'FNCP เกินกำหนด', val: stats.overdueFncp,                   cls: stats.overdueFncp > 0 ? 'text-danger' : 'text-success' },
        { label: 'Top Defect', val: stats.topDefect?.[0]?.type_name || '-',   cls: 'text-muted', small: true },
      ].map(({ label, val, cls, small }) => (
        <div key={label} className="bg-surface rounded-lg border border-border p-3 text-center">
          <div className={`${small ? 'text-body' : 'text-h2'} font-semibold ${cls} truncate`}>{val}</div>
          <div className="text-[11px] text-muted mt-0.5">{label}</div>
        </div>
      ))}
    </div>
  );
}

// ── Production Form Modal ─────────────────────────────────────────────────────
function ProdModal({ row, shifts, lines = [], onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    qty_produced: '', produce_date: todayStr(),
    source_doc: '', remarks: '',
    production_line_id: row.production_line_id || '',
  });
  const [err, setErr] = useState('');
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  // แสดงกะปัจจุบันจาก options (แค่ hint ให้ user เห็น — ระบบ detect จริงฝั่ง server)
  const [nowTime] = useState(() => new Date().toTimeString().slice(0, 5));

  // ดึงประวัติการผลิตล่าสุดของ doc นี้ (staleTime=0 → fresh ทุกครั้งที่เปิด modal)
  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['fg-row-detail-modal', row.doc_no, row.pro_code_sap_id],
    queryFn: () => api.get(`/fg-production/row-detail?doc_no=${encodeURIComponent(row.doc_no)}&sap_id=${row.pro_code_sap_id}`).then(r => r.data),
    staleTime: 0,
  });

  const productions  = detail?.productions || [];
  const producedTotal = productions.reduce((s, p) => s + (p.qty_produced || 0), 0);
  const planQty      = row.plan_qty || 0;
  const remaining    = Math.max(0, planQty - producedTotal);

  const handleQtyChange = (e) => {
    const raw = e.target.value;
    if (raw === '') { set('qty_produced', ''); return; }
    const v = Math.max(1, Math.min(+raw, remaining));
    set('qty_produced', v);
  };

  const save = useMutation({
    mutationFn: () => api.post('/fg-production', {
      doc_no: row.doc_no, pro_code_sap_id: row.pro_code_sap_id,
      production_line_id: form.production_line_id || null,
      produce_date: form.produce_date,
      qty_produced: +form.qty_produced,
      source_doc: form.source_doc,
      remarks: form.remarks,
      // shift_id ไม่ส่ง — server auto-detect จากเวลาปัจจุบัน
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fg-monitor'] });
      qc.invalidateQueries({ queryKey: ['fg-dash'] });
      qc.invalidateQueries({ queryKey: ['fg-row-detail', row.doc_no, row.pro_code_sap_id] });
      onClose();
    },
    onError: e => setErr(e.response?.data?.error || 'เกิดข้อผิดพลาด'),
  });

  const handleSave = () => {
    if (!form.production_line_id) { setErr('กรุณาเลือกสายการผลิต'); return; }
    if (!form.qty_produced) { setErr('กรุณากรอกจำนวน'); return; }
    if (+form.qty_produced > remaining) { setErr(`จำนวนเกินคงเหลือ (สูงสุด ${remaining.toLocaleString()} ชิ้น)`); return; }
    save.mutate();
  };

  return (
    <Modal open onClose={onClose} title="บันทึกยอดผลิต" size="md">
      <div className="space-y-4">
        {/* Product info */}
        <div className="bg-bg rounded p-2 text-small">
          <div className="font-medium">{row.doc_no}</div>
          <div className="text-muted">{row.product_no} — {row.product_desc}</div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-bg rounded-lg p-3 border border-border">
            <div className="text-h3 font-semibold text-text">{planQty.toLocaleString()}</div>
            <div className="text-[11px] text-muted mt-0.5">ตามแผน (ชิ้น)</div>
          </div>
          <div className="bg-blue-50 dark:bg-blue-900 rounded-lg p-3 border border-blue-200 dark:border-blue-700">
            <div className="text-h3 font-semibold text-accent">{detailLoading ? '…' : producedTotal.toLocaleString()}</div>
            <div className="text-[11px] text-muted mt-0.5">ผลิตแล้ว (ชิ้น)</div>
          </div>
          <div className={`rounded-lg p-3 border ${remaining === 0 ? 'bg-green-50 dark:bg-green-900 border-green-200 dark:border-green-700' : 'bg-orange-50 dark:bg-orange-900 border-orange-200 dark:border-orange-700'}`}>
            <div className={`text-h3 font-semibold ${remaining === 0 ? 'text-success' : 'text-warning'}`}>
              {detailLoading ? '…' : remaining.toLocaleString()}
            </div>
            <div className="text-[11px] text-muted mt-0.5">คงเหลือ (ชิ้น)</div>
          </div>
        </div>

        {/* Production history */}
        {!detailLoading && productions.length > 0 && (
          <div>
            <div className="text-small font-medium text-muted mb-1.5">ประวัติการบันทึก ({productions.length} ครั้ง)</div>
            <div className="border border-border rounded overflow-hidden">
              <table className="w-full text-[11px]">
                <thead className="bg-bg">
                  <tr>
                    <th className="text-left px-2 py-1.5 text-muted font-medium">วันที่ผลิต</th>
                    <th className="text-left px-2 py-1.5 text-muted font-medium">กะ</th>
                    <th className="text-right px-2 py-1.5 text-muted font-medium">จำนวน</th>
                    <th className="text-left px-2 py-1.5 text-muted font-medium">ผู้บันทึก</th>
                    <th className="text-left px-2 py-1.5 text-muted font-medium">บันทึกเมื่อ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {productions.map(p => (
                    <tr key={p.id} className="bg-surface hover:bg-bg">
                      <td className="px-2 py-1.5">{p.produce_date}</td>
                      <td className="px-2 py-1.5 text-muted">{p.shift_name || '—'}</td>
                      <td className="px-2 py-1.5 text-right font-medium text-accent">{p.qty_produced.toLocaleString()}</td>
                      <td className="px-2 py-1.5 text-muted">{p.created_by_name}</td>
                      <td className="px-2 py-1.5 text-muted">{p.created_at?.slice(0, 16).replace('T', ' ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Form — ซ่อนเมื่อผลิตครบแล้ว */}
        {remaining === 0 && !detailLoading ? (
          <div className="text-center py-3 rounded-lg bg-green-50 dark:bg-green-900 border border-green-200 dark:border-green-700">
            <div className="text-success font-semibold">ผลิตครบตามแผนแล้ว</div>
            <div className="text-[11px] text-muted mt-0.5">{planQty.toLocaleString()} / {planQty.toLocaleString()} ชิ้น</div>
          </div>
        ) : (
          <>
            {/* สายการผลิต — บังคับเลือกถ้ายังไม่ได้ระบุใน PDPlan */}
            <div>
              <label className="label">
                สายการผลิต *
                {!row.production_line_id && <span className="ml-1 text-[10px] text-warning font-normal">(ไม่ได้ระบุใน PDPlan)</span>}
              </label>
              <select
                className="input"
                value={form.production_line_id}
                onChange={e => set('production_line_id', e.target.value)}
              >
                <option value="">— เลือกสายการผลิต —</option>
                {lines.map(l => <option key={l.id} value={l.id}>{l.name || l.code}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">วันที่ผลิต</label>
                <input type="date" className="input" value={form.produce_date} onChange={e => set('produce_date', e.target.value)} />
              </div>
              <div className="flex flex-col justify-end">
                <label className="label">กะปัจจุบัน</label>
                <div className="input bg-bg text-muted flex items-center gap-1.5 cursor-default select-none">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-small">
                    {(() => {
                      if (!shifts?.length) return nowTime;
                      const found = shifts.find(s => {
                        if (!s.start_time || !s.end_time) return false;
                        if (s.start_time <= s.end_time) return nowTime >= s.start_time && nowTime < s.end_time;
                        return nowTime >= s.start_time || nowTime < s.end_time;
                      });
                      return found ? `${found.name} (${nowTime})` : `ไม่อยู่ในกะ (${nowTime})`;
                    })()}
                  </span>
                </div>
              </div>
            </div>
            <div>
              <label className="label">จำนวนที่ผลิต (ชิ้น) *</label>
              <input
                type="number" min="1" max={remaining} className="input"
                value={form.qty_produced}
                onChange={handleQtyChange}
                disabled={detailLoading}
              />
              {!detailLoading && remaining > 0 && (
                <p className="text-[11px] text-muted mt-1">บันทึกได้สูงสุด <span className="font-semibold text-warning">{remaining.toLocaleString()}</span> ชิ้น</p>
              )}
            </div>
            <div>
              <label className="label">เอกสารอ้างอิง</label>
              <input className="input" value={form.source_doc} onChange={e => set('source_doc', e.target.value)} placeholder="เลขที่เอกสาร..." />
            </div>
            <div>
              <label className="label">หมายเหตุ</label>
              <input className="input" value={form.remarks} onChange={e => set('remarks', e.target.value)} />
            </div>
            {err && <p className="text-danger text-small">{err}</p>}
            <div className="flex gap-2 justify-end pt-1">
              <Button variant="secondary" onClick={onClose}>ยกเลิก</Button>
              <Button variant="primary" loading={save.isPending} disabled={detailLoading} onClick={handleSave}>บันทึก</Button>
            </div>
          </>
        )}

        {/* close button when full */}
        {remaining === 0 && !detailLoading && (
          <div className="flex justify-end">
            <Button variant="secondary" onClick={onClose}>ปิด</Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── Defect Form Modal ─────────────────────────────────────────────────────────
function DefectModal({ row, options, onClose }) {
  const qc = useQueryClient();
  const [phase, setPhase]   = useState('form');   // 'form' | 'success'
  const [result, setResult] = useState(null);      // { record_no, fncp_no, prod_token, fncpId }
  const [form, setForm]     = useState({
    found_date: todayStr(), lot_no: row.doc_no || '',
    defect_group_id: '', defect_type_id: '', process_area_id: '',
    fm_category_id: '',
    defect_qty: '', defect_unit: 'pcs', severity: 'minor', initial_cause: '',
  });
  const [files, setFiles]   = useState([]);        // File objects for upload
  const [previews, setPreviews] = useState([]);    // preview URLs
  const [err, setErr]       = useState('');
  const [copying, setCopying] = useState(false);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const filteredTypes = options?.types?.filter(t => !form.defect_group_id || t.defect_group_id === +form.defect_group_id) || [];

  useEffect(() => {
    if (form.defect_type_id) {
      const t = options?.types?.find(x => x.id === +form.defect_type_id);
      if (t) set('severity', t.severity_default || 'minor');
    }
  }, [form.defect_type_id]);

  // Image preview
  const handleFileChange = (e) => {
    const selected = Array.from(e.target.files || []);
    setFiles(prev => [...prev, ...selected]);
    selected.forEach(f => {
      const url = URL.createObjectURL(f);
      setPreviews(prev => [...prev, { url, name: f.name }]);
    });
    e.target.value = '';
  };
  const removeFile = (i) => {
    URL.revokeObjectURL(previews[i]?.url);
    setFiles(p => p.filter((_, idx) => idx !== i));
    setPreviews(p => p.filter((_, idx) => idx !== i));
  };

  const save = useMutation({
    mutationFn: async () => {
      // Step 1: create defect + auto FNCP
      const r = await api.post('/fg-defect', {
        ...form,
        doc_no: row.doc_no,
        pro_code_sap_id: row.pro_code_sap_id,
        production_line_id: row.production_line_id,
        defect_qty: +form.defect_qty,
        defect_group_id:  form.defect_group_id  || null,
        defect_type_id:   form.defect_type_id   || null,
        process_area_id:  form.process_area_id   || null,
        fm_category_id:   form.fm_category_id    || null,
      });
      const { defectId, record_no, fncpId, fncp_no, prod_token } = r.data;

      // Step 2: upload images (if any)
      if (files.length > 0) {
        const fd = new FormData();
        files.forEach(f => fd.append('images', f));
        await api.post(`/fg-defect/${defectId}/images`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      }

      return { record_no, fncp_no, fncpId, prod_token };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['fg-monitor'] });
      qc.invalidateQueries({ queryKey: ['fg-dash'] });
      setResult(data);
      setPhase('success');
    },
    onError: e => setErr(e.response?.data?.error || 'เกิดข้อผิดพลาด'),
  });

  const responseUrl = result ? `${window.location.origin}/fncp-response/${result.prod_token}` : '';

  const copyLink = () => {
    const doFallback = () => {
      const el = document.createElement('textarea');
      el.value = responseUrl;
      el.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
      document.body.appendChild(el);
      el.focus();
      el.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(el);
      return ok;
    };
    const finish = (ok) => {
      if (ok) { setCopying(true); setTimeout(() => setCopying(false), 2000); }
      else alert(responseUrl);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(responseUrl).then(() => finish(true)).catch(() => finish(doFallback()));
    } else {
      finish(doFallback());
    }
  };

  if (phase === 'success') {
    return (
      <Modal open onClose={onClose} title="บันทึกสำเร็จ" size="sm">
        <div className="space-y-4">
          <div className="text-center py-2">
            <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900 text-success flex items-center justify-center mx-auto mb-3">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="font-semibold text-text">บันทึกของเสียเรียบร้อย</div>
            <div className="text-muted text-small mt-1">{result?.record_no}</div>
          </div>

          <div className="bg-purple-50 dark:bg-purple-900 border border-purple-200 dark:border-purple-700 rounded-lg p-3">
            <div className="text-small font-semibold text-purple-700 dark:text-purple-200 mb-1">FNCP ที่สร้างอัตโนมัติ</div>
            <div className="font-mono text-h3 font-bold text-primary">{result?.fncp_no}</div>
          </div>

          <div className="bg-bg border border-border rounded-lg p-3 space-y-2">
            <div className="text-small font-medium text-muted">
              {options?.fm_categories?.find(c => c.id === +form.fm_category_id)?.is_material === 1
                ? 'ลิงก์สำหรับฝ่าย QC ตอบกลับ'
                : 'ลิงก์สำหรับฝ่ายผลิตตอบกลับ'}
            </div>
            <div className="text-[11px] break-all text-muted font-mono bg-surface border border-border rounded p-2">{responseUrl}</div>
            <div className="text-[11px] text-warning">ลิงก์มีอายุ 7 วัน</div>
            <button
              onClick={copyLink}
              className={`w-full py-2 rounded text-small font-medium transition-colors flex items-center justify-center gap-2 ${copying ? 'bg-success text-white' : 'bg-primary text-white hover:bg-accent'}`}
            >
              {copying ? (
                <><svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>คัดลอกแล้ว!</>
              ) : (
                <><svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>คัดลอกลิงก์</>
              )}
            </button>
          </div>

          <div className="flex gap-2 justify-end">
            <a href={`/fg-production/fncp/${result?.fncpId}`} className="btn btn-secondary text-small">ดู FNCP</a>
            <Button variant="primary" onClick={onClose}>ปิด</Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title="บันทึกของเสีย FG" size="lg">
      <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
        {/* Product info */}
        <div className="bg-bg rounded p-2 text-small">
          <div className="font-medium">{row.doc_no} — {row.product_no}</div>
          <div className="text-muted">{row.product_desc} | {row.line_name}</div>
        </div>

        {/* วันที่ + กะ/เวลา auto */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">วันที่พบ *</label>
            <input type="date" className="input" value={form.found_date} onChange={e => set('found_date', e.target.value)} />
          </div>
          <div>
            <label className="label">กะ / เวลา</label>
            <div className="input bg-bg text-muted flex items-center gap-1.5 cursor-default select-none text-small">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              ระบบตรวจจากเวลาบันทึก
            </div>
          </div>
        </div>

        {/* Doc. No. อ้างอิง */}
        <div>
          <label className="label">Doc. No. (อ้างอิง)</label>
          <input className="input bg-bg text-muted cursor-not-allowed" value={form.lot_no} readOnly />
        </div>

        {/* Defect Classification */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div>
            <label className="label">กลุ่มอาการเสีย</label>
            <select className="input" value={form.defect_group_id} onChange={e => { set('defect_group_id', e.target.value); set('defect_type_id', ''); }}>
              <option value="">— เลือก —</option>
              {options?.groups?.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">อาการเสีย</label>
            <select className="input" value={form.defect_type_id} onChange={e => set('defect_type_id', e.target.value)}>
              <option value="">— เลือก —</option>
              {filteredTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">ส่วนงานที่พบ</label>
            <select className="input" value={form.process_area_id} onChange={e => set('process_area_id', e.target.value)}>
              <option value="">— เลือก —</option>
              {options?.areas?.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        </div>

        {/* FM Category */}
        <div>
          <label className="label">FM Category (5M+E)</label>
          <select className="input" value={form.fm_category_id} onChange={e => set('fm_category_id', e.target.value)}>
            <option value="">— เลือก FM Category —</option>
            {options?.fm_categories?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {form.fm_category_id && options?.fm_categories?.find(c => c.id === +form.fm_category_id)?.is_material === 1 && (
            <p className="text-[11px] text-warning mt-1">Material defect — ระบบจะแจ้งเตือน QC รับเข้าอัตโนมัติ</p>
          )}
        </div>

        {/* Qty + Severity */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">จำนวนของเสีย *</label>
            <div className="flex gap-2">
              <input type="number" min="1" className="input flex-1" value={form.defect_qty} onChange={e => set('defect_qty', e.target.value)} />
              <select className="input w-24" value={form.defect_unit} onChange={e => set('defect_unit', e.target.value)}>
                {['pcs','set','unit','frame','sash'].map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Severity</label>
            <div className="flex gap-2">
              {[
                { v: 'minor',    label: 'Minor',    border: 'border-yellow-500 bg-yellow-50 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-200', idle: 'border-border hover:border-yellow-400 text-muted' },
                { v: 'major',    label: 'Major',    border: 'border-orange-500 bg-orange-50 dark:bg-orange-900 text-orange-700 dark:text-orange-200', idle: 'border-border hover:border-orange-400 text-muted' },
                { v: 'critical', label: 'Critical', border: 'border-red-500 bg-red-50 dark:bg-red-900 text-red-700 dark:text-red-200',         idle: 'border-border hover:border-red-400 text-muted' },
              ].map(({ v, label, border, idle }) => (
                <button
                  key={v} type="button"
                  onClick={() => set('severity', v)}
                  className={`flex-1 py-2 px-1 rounded border-2 text-small font-semibold transition-colors ${form.severity === v ? border : idle}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ปัญหาที่พบ */}
        <div>
          <label className="label">ปัญหาที่พบ</label>
          <textarea rows={3} className="input" value={form.initial_cause} onChange={e => set('initial_cause', e.target.value)} placeholder="อธิบายปัญหาที่พบ..." />
        </div>

        {/* รูปภาพปัญหา */}
        <div>
          <label className="label">รูปภาพปัญหา</label>
          <label className="flex items-center gap-2 cursor-pointer border-2 border-dashed border-border rounded-lg p-3 hover:border-accent transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
            </svg>
            <span className="text-small text-muted">เลือกรูปภาพ (สูงสุด 10 รูป)</span>
            <input type="file" accept="image/*" multiple className="hidden" onChange={handleFileChange} />
          </label>
          {previews.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {previews.map((p, i) => (
                <div key={i} className="relative w-16 h-16 rounded overflow-hidden border border-border group">
                  <img src={p.url} alt={p.name} className="w-full h-full object-cover" />
                  <button
                    onClick={() => removeFile(i)}
                    className="absolute inset-0 bg-black/50 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center text-[11px] transition-opacity"
                  >ลบ</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-blue-50 dark:bg-blue-900 border border-blue-200 dark:border-blue-700 rounded-lg p-2 text-[11px] text-blue-700 dark:text-blue-200">
          ระบบจะสร้าง FNCP อัตโนมัติ พร้อมลิงก์สำหรับส่งให้ฝ่ายผลิตตอบกลับ
        </div>

        {err && <p className="text-danger text-small">{err}</p>}
        <div className="flex gap-2 justify-end pt-1">
          <Button variant="secondary" onClick={onClose}>ยกเลิก</Button>
          <Button variant="primary" loading={save.isPending}
            onClick={() => { if (!form.found_date || !form.defect_qty) { setErr('กรุณากรอกวันที่และจำนวนของเสีย'); return; } save.mutate(); }}>
            บันทึก + สร้าง FNCP
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Expand Row ────────────────────────────────────────────────────────────────
function ExpandRow({ row }) {
  const { data, isLoading } = useQuery({
    queryKey: ['fg-row-detail', row.doc_no, row.pro_code_sap_id],
    queryFn: () => api.get(`/fg-production/row-detail?doc_no=${row.doc_no}&sap_id=${row.pro_code_sap_id}`).then(r => r.data),
    staleTime: 30000,
  });

  if (isLoading) return <div className="p-4 text-muted text-small">กำลังโหลด...</div>;

  return (
    <div className="p-4 bg-bg border-t border-border grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Production Timeline */}
      <div>
        <div className="text-small font-medium text-text mb-2">Production Timeline ({data?.productions?.length || 0} รายการ)</div>
        {!data?.productions?.length ? (
          <div className="text-muted text-small italic">ยังไม่มีบันทึกยอดผลิต</div>
        ) : (
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {data.productions.map(p => (
              <div key={p.id} className="flex justify-between items-center text-small bg-surface border border-border rounded px-2 py-1">
                <span className="text-muted">{p.produce_date} {p.shift_name && `| ${p.shift_name}`}</span>
                <span className="font-medium text-accent">{p.qty_produced.toLocaleString()} ชิ้น</span>
                <span className="text-muted text-[11px]">{p.created_by_name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {/* Defect Timeline */}
      <div>
        <div className="text-small font-medium text-text mb-2">Defect Timeline ({data?.defects?.length || 0} รายการ)</div>
        {!data?.defects?.length ? (
          <div className="text-muted text-small italic">ยังไม่มีบันทึกของเสีย</div>
        ) : (
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {data.defects.map(d => (
              <div key={d.id} className="text-small bg-surface border border-border rounded px-2 py-1">
                <div className="flex justify-between items-center">
                  <span className="text-muted">{d.found_date}</span>
                  <SevBadge v={d.severity} />
                  <span className="font-medium text-danger">{d.defect_qty} {d.defect_unit}</span>
                </div>
                <div className="text-[11px] text-muted mt-0.5 truncate">{d.type_name || d.group_name || '—'} {d.area_name && `| ${d.area_name}`}</div>
                {d.fncp_no && (
                  <Link to={`/fg-production/fncp/${d.fncp_id}`} className="text-[11px] text-accent hover:underline">
                    {d.fncp_no} <StatusBadge s={d.fncp_status} />
                  </Link>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function FGProductionPage() {
  const { user } = useAuth();
  const [filters, setFilters] = useState({ q: '', line_id: '', date_from: '', date_to: '' });
  const [deb, setDeb]         = useState(filters);
  const [page, setPage]       = useState(1);
  const [expandedId, setExpandedId] = useState(null);
  const [prodModal, setProdModal]   = useState(null);
  const [defectModal, setDefectModal] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => { setDeb(filters); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [filters]);

  const setF = (k, v) => setFilters(p => ({ ...p, [k]: v }));

  const { data: dash } = useQuery({
    queryKey: ['fg-dash'],
    queryFn: () => api.get('/fg-production/dashboard-stats').then(r => r.data),
    staleTime: 60000,
  });

  const { data: monitor, isLoading } = useQuery({
    queryKey: ['fg-monitor', deb, page],
    queryFn: () => api.get('/fg-production/monitor', { params: { ...deb, page, limit: 15 } }).then(r => r.data),
    staleTime: 30000,
  });

  const { data: opts } = useQuery({
    queryKey: ['fg-master-options'],
    queryFn: () => api.get('/fg-master/options').then(r => r.data),
    staleTime: 300000,
  });

  const canWriteProd   = FG_WRITE.includes(user?.role);
  const canWriteDefect = DEF_WRITE.includes(user?.role);
  const rows  = monitor?.data || [];
  const total = monitor?.total || 0;
  const pages = Math.max(1, Math.ceil(total / 15));

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">บันทึกยอดผลิต/ของเสีย (FG)</h1>
        <div className="flex gap-2">
          <Link to="/fg-production/fncp"><Button variant="secondary" size="sm">รายการ FNCP</Button></Link>
        </div>
      </div>

      <DashCards stats={dash} />

      {/* Filters */}
      <div className="card mb-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <input className="input col-span-2 sm:col-span-1" placeholder="ค้นหา Doc.No. / รหัส / ชื่อสินค้า..." value={filters.q} onChange={e => setF('q', e.target.value)} />
          <select className="input" value={filters.line_id} onChange={e => setF('line_id', e.target.value)}>
            <option value="">— สายการผลิต —</option>
            {opts?.lines?.map(l => <option key={l.id} value={l.id}>{l.name || l.code}</option>)}
          </select>
          <input type="date" className="input" value={filters.date_from} onChange={e => setF('date_from', e.target.value)} placeholder="วันเริ่ม" title="วันที่ผลิต/พบของเสีย ตั้งแต่" />
          <input type="date" className="input" value={filters.date_to} onChange={e => setF('date_to', e.target.value)} placeholder="วันสิ้นสุด" title="ถึงวันที่" />
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="w-8">#</th>
                <th>Doc. No.</th>
                <th>รหัสสินค้า / ชื่อสินค้า</th>
                <th>สายการผลิต</th>
                <th className="text-right">แผน</th>
                <th className="text-right">ผลิตจริง</th>
                <th className="text-right">ของเสีย</th>
                <th className="text-right">Defect %</th>
                <th>FNCP</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={10} className="text-center py-8 text-muted">กำลังโหลด...</td></tr>
              ) : !rows.length ? (
                <tr><td colSpan={10} className="text-center py-8 text-muted">ไม่พบข้อมูล</td></tr>
              ) : rows.map((row, i) => (
                <React.Fragment key={`${row.doc_no}-${row.pro_code_sap_id}`}>
                  <tr
                    className={`cursor-pointer hover:bg-bg transition-colors ${expandedId === row.id ? 'bg-blue-50 dark:bg-blue-900' : ''}`}
                    onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
                  >
                    <td className="text-muted text-small">{(page - 1) * 15 + i + 1}</td>
                    <td className="font-mono text-small whitespace-nowrap">{row.doc_no}</td>
                    <td className="min-w-[200px]">
                      <div className="font-medium text-small">{row.product_no}</div>
                      <div className="text-muted text-[11px] leading-snug">{row.product_desc}</div>
                    </td>
                    <td className="text-small">{row.line_name || '—'}</td>
                    <td className="text-right text-small">{(row.plan_qty || 0).toLocaleString()}</td>
                    <td className="text-right text-small font-medium text-accent">{(row.produced_qty || 0).toLocaleString()}</td>
                    <td className="text-right text-small font-medium text-danger">{(row.defect_qty || 0).toLocaleString()}</td>
                    <td className="text-right">
                      <span className={`text-small font-medium ${row.defect_pct > 3 ? 'text-danger' : row.defect_pct > 1 ? 'text-warning' : 'text-success'}`}>
                        {row.defect_pct ?? 0}%
                      </span>
                    </td>
                    <td>
                      {row.fncp_count > 0 ? (
                        <div className="flex items-center gap-1">
                          <span className="badge text-[11px] bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-200">{row.fncp_count} รายการ</span>
                          {row.open_fncp_count > 0 && <span className="badge text-[11px] bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200">เปิด {row.open_fncp_count}</span>}
                        </div>
                      ) : <span className="text-muted text-small">—</span>}
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <div className="flex gap-1.5 items-center">
                        {canWriteProd && (
                          <button
                            title="บันทึกยอดผลิต"
                            onClick={() => setProdModal(row)}
                            className="w-8 h-8 flex items-center justify-center rounded-full bg-accent/10 text-accent hover:bg-accent hover:text-white transition-colors"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2M12 11v4M10 13h4" />
                            </svg>
                          </button>
                        )}
                        {canWriteDefect && (
                          <button
                            title="บันทึกของเสีย FG"
                            onClick={() => setDefectModal(row)}
                            className="w-8 h-8 flex items-center justify-center rounded-full bg-danger/10 text-danger hover:bg-danger hover:text-white transition-colors"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {expandedId === row.id && (
                    <tr>
                      <td colSpan={10} className="p-0">
                        <ExpandRow row={row} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {/* Pagination */}
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

      {/* Modals */}
      {prodModal && <ProdModal row={prodModal} shifts={opts?.shifts} lines={opts?.lines || []} onClose={() => setProdModal(null)} />}
      {defectModal && <DefectModal row={defectModal} options={opts} onClose={() => setDefectModal(null)} />}
    </div>
  );
}
