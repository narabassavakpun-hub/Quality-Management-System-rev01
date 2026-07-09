import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

const SEV_COLOR = { minor: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-200', major: 'bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-200', critical: 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200' };
const SEV_LABEL = { minor: 'Minor', major: 'Major', critical: 'Critical' };

function InfoRow({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex flex-col sm:flex-row gap-1">
      <span className="text-muted text-small min-w-[140px] shrink-0">{label}</span>
      <span className="text-small font-medium text-text">{value}</span>
    </div>
  );
}

export default function FNCPResponse() {
  const { token } = useParams();
  const [phase, setPhase]   = useState('form'); // 'form' | 'success'
  const [form, setForm]     = useState({ respondent_name: '', root_cause: '', corrective_action: '', preventive_action: '' });
  const [files, setFiles]   = useState([]);
  const [previews, setPreviews] = useState([]);
  const [uploadedImgs, setUploadedImgs] = useState([]);
  const [err, setErr]       = useState('');
  const [showFUAI, setShowFUAI] = useState(false);
  const [fuaiForm, setFuaiForm] = useState({ respondent_name: '', reason: '', defect_qty: '', defect_unit: 'pcs' });
  const [fuaiResult, setFuaiResult] = useState(null);
  const [fuaiErr, setFuaiErr]   = useState('');
  const [fuaiLoading, setFuaiLoading] = useState(false);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['fncp-response', token],
    queryFn: () => api.get(`/fncp-response/${token}`).then(r => r.data),
    retry: false,
    staleTime: 30000,
  });

  const handleFileChange = (e) => {
    const selected = Array.from(e.target.files || []);
    setFiles(prev => [...prev, ...selected]);
    selected.forEach(f => setPreviews(prev => [...prev, { url: URL.createObjectURL(f), name: f.name }]));
    e.target.value = '';
  };
  const removeFile = (i) => {
    URL.revokeObjectURL(previews[i]?.url);
    setFiles(p => p.filter((_, x) => x !== i));
    setPreviews(p => p.filter((_, x) => x !== i));
  };

  const submit = useMutation({
    mutationFn: async () => {
      // Upload fix images first (if any)
      if (files.length > 0) {
        const fd = new FormData();
        files.forEach(f => fd.append('images', f));
        const imgRes = await api.post(`/fncp-response/${token}/images`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        setUploadedImgs(imgRes.data.files || []);
      }
      // Submit response
      await api.post(`/fncp-response/${token}`, form);
    },
    onSuccess: () => setPhase('success'),
    onError: e => {
      if (e.response?.data?.already_submitted) {
        refetch(); // Reload ให้แสดง "ส่งแล้ว" แทนฟอร์ม
      } else {
        setErr(e.response?.data?.error || 'เกิดข้อผิดพลาด กรุณาลองใหม่');
      }
    },
  });

  // ── Loading / Error states ────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="text-muted">กำลังโหลด...</div>
      </div>
    );
  }

  if (error || !data) {
    const msg = error?.response?.data?.error || 'ไม่พบข้อมูล หรือลิงก์ไม่ถูกต้อง';
    const isExpired = error?.response?.status === 410;
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center p-4">
        <div className="bg-surface rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8 max-w-sm w-full text-center">
          <div className="w-14 h-14 rounded-full bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-200 flex items-center justify-center mx-auto mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div className="font-semibold text-text mb-1">{isExpired ? 'ลิงก์หมดอายุ' : 'ไม่พบข้อมูล'}</div>
          <div className="text-sm text-muted">{msg}</div>
        </div>
      </div>
    );
  }

  const alreadyAnswered = ['waiting_verify','supervisor_approved','verified','closed'].includes(data.status);
  const fuaiAlreadyOpened = data.status === 'fuai_opened';

  const submitFUAI = async () => {
    if (!fuaiForm.respondent_name.trim()) { setFuaiErr('กรุณาระบุชื่อผู้ขออนุมัติ'); return; }
    if (!fuaiForm.reason.trim()) { setFuaiErr('กรุณาระบุเหตุผลการขออนุมัติ'); return; }
    setFuaiLoading(true); setFuaiErr('');
    try {
      const res = await api.post(`/fncp-response/${token}/request-fuai`, fuaiForm);
      setFuaiResult(res.data);
    } catch (e) {
      setFuaiErr(e.response?.data?.error || 'เกิดข้อผิดพลาด');
    } finally {
      setFuaiLoading(false);
    }
  };

  // ── Success ───────────────────────────────────────────────────────────────
  if (phase === 'success') {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center p-4">
        <div className="bg-surface rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8 max-w-sm w-full text-center">
          <div className="w-14 h-14 rounded-full bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-200 flex items-center justify-center mx-auto mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div className="font-bold text-text text-lg mb-1">ส่งข้อมูลสำเร็จ</div>
          <div className="text-sm text-muted mb-3">ทีม QC จะตรวจสอบการแก้ไขและแจ้งผลกลับมา</div>
          <div className="text-xs text-muted">FNCP: <span className="font-mono font-semibold text-primary">{data.fncp_no}</span></div>
        </div>
      </div>
    );
  }

  // ── Form ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-bg py-6 px-4">
      <div className="max-w-2xl mx-auto space-y-4">
        {/* Header */}
        <div className="bg-primary text-white rounded-xl p-4">
          <div className="text-xs opacity-70 mb-1">แบบฟอร์มตอบกลับ — Finished Non-Conformance Product</div>
          <div className="font-bold text-lg">{data.fncp_no}</div>
          <div className="text-sm opacity-80 mt-0.5">{data.product_no} — {data.product_desc}</div>
        </div>

        {/* ข้อมูลของเสียที่พบ */}
        <div className="bg-surface rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="px-4 pt-4 pb-0">
            <div className="font-semibold text-text mb-3">ข้อมูลของเสียที่พบ</div>
          </div>
          {/* Info fields + รูปขวา */}
          <div className="flex gap-0 px-4">
            {/* Left: fields */}
            <div className="flex-1 min-w-0 pb-3 space-y-1.5">
              <InfoRow label="วันที่พบ"         value={data.found_date} />
              <InfoRow label="เวลา"             value={data.found_time ? `${data.found_time} น.` : null} />
              <InfoRow label="กะ"               value={data.shift_name} />
              <InfoRow label="สายการผลิต"       value={data.line_name} />
              <InfoRow label="Doc. No. อ้างอิง" value={data.ref_doc_no} />
              <InfoRow label="กลุ่มอาการเสีย"  value={data.defect_group_name} />
              <InfoRow label="อาการเสีย"        value={data.defect_type_name} />
              <InfoRow label="ส่วนงานที่พบ"    value={data.process_area_name} />
              <div className="flex flex-col sm:flex-row gap-1">
                <span className="text-muted text-sm min-w-[130px] shrink-0">จำนวนของเสีย</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-danger">{data.defect_qty?.toLocaleString()} {data.defect_unit}</span>
                  {data.severity && <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-medium ${SEV_COLOR[data.severity]}`}>{SEV_LABEL[data.severity]}</span>}
                </div>
              </div>
            </div>
            {/* Right: รูปภาพปัญหา */}
            <div className="shrink-0 w-32 sm:w-40 ml-3 flex flex-col">
              <div className="text-xs text-muted mb-1">รูปภาพปัญหา ({data.images?.length || 0})</div>
              <div className="flex-1 rounded-lg overflow-hidden bg-bg border border-gray-200 dark:border-gray-700 relative min-h-[120px]">
                {data.images?.length > 0 ? (
                  <>
                    <a href={`/uploads/fg-defect/${data.images[0].filename}`} target="_blank" rel="noreferrer" className="block absolute inset-0">
                      <img src={`/uploads/fg-defect/${data.images[0].filename}`} alt={data.images[0].original_name}
                        className="w-full h-full object-cover hover:opacity-90 transition-opacity" />
                    </a>
                    {data.images.length > 1 && (
                      <div className="absolute bottom-1.5 right-1.5 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded">
                        +{data.images.length - 1} รูป
                      </div>
                    )}
                  </>
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-muted">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-7 h-7 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span className="text-xs">No Picture</span>
                  </div>
                )}
              </div>
            </div>
          </div>
          {/* ปัญหาที่พบ — ล่างสุด เต็มความกว้าง */}
          {data.initial_cause && (
            <div className="px-4 pt-2 pb-3 border-t border-gray-100 dark:border-gray-700 mt-1">
              <div className="text-muted text-xs mb-1">ปัญหาที่พบ</div>
              <div className="text-sm text-text bg-bg rounded p-2 leading-relaxed">{data.initial_cause}</div>
            </div>
          )}
          {/* ผู้ออกเอกสาร + วันที่ */}
          <div className="px-4 pb-4 space-y-1.5">
            <InfoRow label="ผู้ออกเอกสาร"    value={data.created_by_name} />
            <InfoRow label="วันที่ออกเอกสาร" value={data.opened_at?.slice(0, 10)} />
          </div>
        </div>

        {/* FUAI already opened notice */}
        {fuaiAlreadyOpened && (
          <div className="bg-purple-50 dark:bg-purple-900 border border-purple-300 dark:border-purple-600 rounded-xl p-4 text-center">
            <div className="font-semibold text-purple-700 dark:text-purple-200 mb-1">เปิดคำขออนุมัติใช้พิเศษ (FUAI) แล้ว</div>
            <div className="text-sm text-purple-600 dark:text-purple-200">FNCP นี้อยู่ระหว่างรอการอนุมัติ FUAI จากผู้บริหาร</div>
          </div>
        )}

        {/* Already answered notice */}
        {alreadyAnswered ? (
          <div className="bg-green-50 dark:bg-green-900 border border-green-200 dark:border-green-700 rounded-xl p-4 text-center">
            <div className="font-semibold text-green-700 dark:text-green-200 mb-1">ส่งข้อมูลแล้ว</div>
            <div className="text-sm text-green-600 dark:text-green-200">
              {data.fm_is_material === 1 ? 'QC รับเข้าได้ส่งข้อมูลการแก้ไขแล้ว' : 'ฝ่ายผลิตได้ส่งข้อมูลการแก้ไขแล้ว'} อยู่ระหว่างรอ QC ตรวจสอบ
            </div>
            {data.respondent_name && <div className="text-xs text-muted mt-1">ผู้ตอบ: {data.respondent_name}</div>}
            {/* Critical: FUAI button */}
            {data.severity === 'critical' && !fuaiAlreadyOpened && (
              <div className="mt-3 pt-3 border-t border-green-200 dark:border-green-700">
                <div className="text-xs text-orange-700 dark:text-orange-200 mb-2 font-medium">Severity: Critical — สามารถขออนุมัติใช้พิเศษ (FUAI) ได้</div>
                <button onClick={() => setShowFUAI(true)}
                  className="px-4 py-2 rounded-lg bg-purple-700 text-white text-sm font-semibold hover:bg-purple-800 transition-colors">
                  ขออนุมัติใช้พิเศษ (FUAI)
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* ── แจ้งเตือน QC ปฏิเสธ ── */}
            {data.status === 'reject' && (
              <div className="bg-red-50 dark:bg-red-900 border border-red-300 dark:border-red-600 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <div className="shrink-0 w-8 h-8 rounded-full bg-red-100 dark:bg-red-900 flex items-center justify-center mt-0.5">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-red-600 dark:text-red-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold text-red-700 dark:text-red-200">QC ไม่อนุมัติ — รบกวนตอบเอกสารใหม่</div>
                    {data.reject_reason && (
                      <div className="mt-1.5 text-sm text-red-600 dark:text-red-200 bg-red-100 dark:bg-red-900 rounded-lg px-3 py-2">
                        <span className="font-medium">เหตุผล:</span> {data.reject_reason}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ── คำตอบเดิม (อ้างอิงเท่านั้น) — แสดงเมื่อ status=reject และมีคำตอบเดิม ── */}
            {data.status === 'reject' && data.respondent_name && (
              <div className="bg-amber-50 dark:bg-amber-900 border border-amber-200 dark:border-amber-700 rounded-xl p-4">
                <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200 font-semibold text-sm mb-3">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-amber-600 dark:text-amber-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  คำตอบเดิม (อ้างอิงเท่านั้น — ดูได้อย่างเดียว)
                </div>
                <div className="space-y-2.5 text-sm">
                  {[
                    ['ผู้ตอบเดิม',              data.respondent_name],
                    ['Root Cause เดิม',          data.root_cause],
                    ['Corrective Action เดิม',   data.corrective_action],
                    ['Preventive Action เดิม',   data.preventive_action],
                  ].map(([label, val]) => val ? (
                    <div key={label}>
                      <div className="text-xs text-amber-700 dark:text-amber-200 mb-0.5">{label}</div>
                      <div className="bg-surface border border-amber-200 dark:border-amber-700 rounded-lg px-3 py-2 text-text leading-relaxed select-text cursor-default">{val}</div>
                    </div>
                  ) : null)}
                  {data.fixImages?.length > 0 && (
                    <div>
                      <div className="text-xs text-amber-700 dark:text-amber-200 mb-1">รูปภาพที่แนบเดิม ({data.fixImages.length})</div>
                      <div className="flex flex-wrap gap-2">
                        {data.fixImages.map(img => (
                          <a key={img.id} href={`/uploads/fg-fix/${img.filename}`} target="_blank" rel="noreferrer">
                            <img src={`/uploads/fg-fix/${img.filename}`} alt={img.original_name}
                              className="w-16 h-16 object-cover rounded-lg border border-amber-300 dark:border-amber-600 hover:opacity-80 transition-opacity" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── ฟอร์มตอบกลับ ── */}
            <div className="bg-surface rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-4">
              <div className="font-semibold text-text">
                {data.status === 'reject'
                  ? 'ส่งข้อมูลการแก้ไขใหม่'
                  : data.fm_is_material === 1
                    ? 'ข้อมูลการแก้ไข (พนักงาน QC รับเข้า)'
                    : 'ข้อมูลการแก้ไข (ฝ่ายผลิต)'}
              </div>

              <div>
                <label className="block text-sm font-medium text-muted mb-1">ชื่อผู้ตอบ *</label>
                <input className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  placeholder="ชื่อ-นามสกุล..." value={form.respondent_name} onChange={e => set('respondent_name', e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Root Cause Analysis *</label>
                <textarea rows={3} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  placeholder="วิเคราะห์สาเหตุที่แท้จริง..." value={form.root_cause} onChange={e => set('root_cause', e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Corrective Action</label>
                <textarea rows={3} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  placeholder="การแก้ไข..." value={form.corrective_action} onChange={e => set('corrective_action', e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Preventive Action</label>
                <textarea rows={3} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  placeholder="การป้องกันไม่ให้เกิดซ้ำ..." value={form.preventive_action} onChange={e => set('preventive_action', e.target.value)} />
              </div>

              {/* รูปภาพการแก้ไข */}
              <div>
                <label className="block text-sm font-medium text-muted mb-1">รูปภาพการแก้ไขปัญหา</label>
                <label className="flex items-center gap-2 cursor-pointer border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-3 hover:border-blue-400 transition-colors">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
                  </svg>
                  <span className="text-sm text-gray-500 dark:text-gray-200">เลือกรูปภาพ (สูงสุด 10 รูป)</span>
                  <input type="file" accept="image/*" multiple className="hidden" onChange={handleFileChange} />
                </label>
                {previews.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {previews.map((p, i) => (
                      <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 group">
                        <img src={p.url} alt={p.name} className="w-full h-full object-cover" />
                        <button onClick={() => removeFile(i)} className="absolute inset-0 bg-black/50 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center text-xs transition-opacity">ลบ</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {err && <div className="text-red-600 dark:text-red-200 text-sm bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded-lg p-2">{err}</div>}

              <button
                onClick={() => {
                  if (!form.respondent_name.trim()) { setErr('กรุณาระบุชื่อผู้ตอบ'); return; }
                  if (!form.root_cause.trim()) { setErr('กรุณากรอก Root Cause Analysis'); return; }
                  setErr('');
                  submit.mutate();
                }}
                disabled={submit.isPending}
                className="w-full py-3 bg-primary text-white rounded-lg font-semibold text-sm hover:bg-accent disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {submit.isPending ? 'กำลังส่ง...' : (data.status === 'reject' ? 'ส่งข้อมูลการแก้ไขใหม่' : 'ส่งข้อมูลการแก้ไข')}
              </button>
            </div>
          </>
        )}

        {/* รูปภาพการแก้ไขที่ส่งแล้ว */}
        {data.fixImages?.length > 0 && (
          <div className="bg-surface rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <div className="font-semibold text-text mb-3">รูปภาพการแก้ไข ({data.fixImages.length})</div>
            <div className="flex flex-wrap gap-2">
              {data.fixImages.map(img => (
                <a key={img.id} href={`/uploads/fg-fix/${img.filename}`} target="_blank" rel="noreferrer">
                  <img src={`/uploads/fg-fix/${img.filename}`} alt={img.original_name} className="w-20 h-20 object-cover rounded-lg border border-gray-200 dark:border-gray-700 hover:opacity-80 transition-opacity" />
                </a>
              ))}
            </div>
          </div>
        )}

        <div className="text-center text-xs text-muted pb-4">
          ลิงก์มีอายุถึง {data.prod_token_expires_at} · ระบบ Quality Management System
        </div>
      </div>

      {/* ── FUAI Modal ── */}
      {showFUAI && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-surface rounded-2xl w-full max-w-md shadow-xl">
            {fuaiResult ? (
              <div className="p-6 text-center space-y-4">
                <div className="w-14 h-14 rounded-full bg-purple-100 dark:bg-purple-900 text-purple-600 dark:text-purple-200 flex items-center justify-center mx-auto">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div className="font-bold text-text text-lg">ส่งคำขออนุมัติสำเร็จ</div>
                <div className="bg-purple-50 dark:bg-purple-900 border border-purple-200 dark:border-purple-700 rounded-lg p-3">
                  <div className="text-xs text-purple-700 dark:text-purple-200 mb-1">เลขที่ FUAI</div>
                  <div className="font-mono font-bold text-primary text-xl">{fuaiResult.fuai_no}</div>
                </div>
                <div className="text-sm text-muted">คำขออยู่ระหว่างรอผู้จัดการฝ่ายผลิตอนุมัติ</div>
                <button onClick={() => setShowFUAI(false)}
                  className="w-full py-3 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-accent transition-colors">ปิด</button>
              </div>
            ) : (
              <div className="p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-bold text-text text-lg">ขออนุมัติใช้พิเศษ (FUAI)</h2>
                  <button onClick={() => setShowFUAI(false)} className="text-gray-400 hover:text-gray-600">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="bg-orange-50 dark:bg-orange-900 border border-orange-200 dark:border-orange-700 rounded-lg p-3 text-sm text-orange-700 dark:text-orange-200">
                  FNCP: <strong>{data.fncp_no}</strong> | Severity: <strong>Critical</strong> — ขออนุมัติใช้สินค้าที่มีข้อบกพร่อง
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-1">ชื่อผู้ขออนุมัติ *</label>
                  <input className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                    value={fuaiForm.respondent_name} onChange={e => setFuaiForm(p => ({ ...p, respondent_name: e.target.value }))}
                    placeholder="ชื่อ-นามสกุล..." />
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-1">เหตุผลที่ขออนุมัติใช้พิเศษ *</label>
                  <textarea rows={3} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                    value={fuaiForm.reason} onChange={e => setFuaiForm(p => ({ ...p, reason: e.target.value }))}
                    placeholder="ระบุเหตุผลที่ต้องการใช้สินค้าที่มีข้อบกพร่องนี้..." />
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-muted mb-1">จำนวน</label>
                    <input type="number" min="1" className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                      value={fuaiForm.defect_qty} onChange={e => setFuaiForm(p => ({ ...p, defect_qty: e.target.value }))}
                      placeholder={`${data.defect_qty || ''}`} />
                  </div>
                  <div className="w-24">
                    <label className="block text-sm font-medium text-muted mb-1">หน่วย</label>
                    <select className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                      value={fuaiForm.defect_unit} onChange={e => setFuaiForm(p => ({ ...p, defect_unit: e.target.value }))}>
                      {['pcs','set','unit','frame','sash'].map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                </div>
                {fuaiErr && <div className="text-red-600 dark:text-red-200 text-sm bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded-lg p-2">{fuaiErr}</div>}
                <div className="flex gap-2 pt-1">
                  <button onClick={() => setShowFUAI(false)}
                    className="flex-1 py-3 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-200 text-sm font-medium hover:bg-gray-50 transition-colors">ยกเลิก</button>
                  <button onClick={submitFUAI} disabled={fuaiLoading}
                    className="flex-1 py-3 rounded-lg bg-purple-700 text-white text-sm font-semibold hover:bg-purple-800 disabled:opacity-60 transition-colors">
                    {fuaiLoading ? 'กำลังส่ง...' : 'ส่งคำขออนุมัติ'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
