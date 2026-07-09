import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../utils/api';
import Button from '../../components/UI/Button';

// ===== Product Tags — แสดง attributes จาก ProCodeSAP เป็น badge =====
function ProductTags({ row, className = '' }) {
  if (!row) return null;
  const tags = [
    { val: row.line_type,      color: 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200' },
    { val: row.brand,          color: 'bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-200' },
    { val: row.product_series, color: 'bg-violet-100 dark:bg-violet-900 text-violet-700 dark:text-violet-200' },
    { val: row.panel_type,     color: 'bg-cyan-100 dark:bg-cyan-900 text-cyan-700 dark:text-cyan-200' },
    { val: row.panel_style,    color: 'bg-teal-100 dark:bg-teal-900 text-teal-700 dark:text-teal-200' },
    { val: row.mosquito_net && row.mosquito_net !== 'none' ? row.mosquito_net : null, color: 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200' },
    { val: row.glass_type && row.glass_type !== 'none' ? row.glass_type : null, color: 'bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-200' },
    { val: row.panel_color,    color: 'bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-200' },
    { val: row.panel_size,     color: 'bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-200' },
  ].filter(t => t.val && String(t.val).trim());
  if (!tags.length) return null;
  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {tags.map((t, i) => (
        <span key={i} className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${t.color}`}>
          {t.val}
        </span>
      ))}
    </div>
  );
}

// ===== Step 1: เลือก Station + ค้นหา PO =====
function Step1({ onNext }) {
  const today = new Date().toISOString().slice(0, 10);
  const nowTime = new Date().toTimeString().slice(0, 5);

  const [form, setForm] = useState({
    inspect_date: today,
    inspect_time: nowTime,
    station_id: '',
    shift_id: '',
  });
  const [docQ, setDocQ] = useState('');
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const debRef = useRef(null);

  const { data: stationsRes } = useQuery({
    queryKey: ['ipqc-stations-all'],
    queryFn: () => api.get('/ipqc/master/ipqc-stations').then(r => r.data),
  });
  const { data: shiftsRes } = useQuery({
    queryKey: ['shifts-all'],
    queryFn: () => api.get('/ipqc/master/shifts').then(r => r.data),
  });

  // ตั้ง default กะเช้า เมื่อ shifts โหลดเสร็จ
  useEffect(() => {
    const shifts = shiftsRes?.data ?? [];
    if (!shifts.length || form.shift_id) return;
    const morning = shifts.find(s => s.name.includes('เช้า')) || shifts[0];
    if (morning) setF('shift_id', morning.id);
  }, [shiftsRes]);

  const [debouncedQ, setDebouncedQ] = useState('');
  useEffect(() => {
    clearTimeout(debRef.current);
    debRef.current = setTimeout(() => setDebouncedQ(docQ), 350);
    return () => clearTimeout(debRef.current);
  }, [docQ]);

  const { data: searchRes } = useQuery({
    queryKey: ['pd-plan-search', debouncedQ],
    queryFn: () => api.get('/pd-plan/search', { params: { q: debouncedQ } }).then(r => r.data),
    enabled: debouncedQ.length >= 2 && !selected,
  });

  const { data: aqlRes } = useQuery({
    queryKey: ['aql-calc', selected?.plan_qty],
    queryFn: () => api.get('/ipqc-inspection/aql-calc', { params: { lot_qty: selected?.plan_qty ?? 0 } }).then(r => r.data),
    enabled: !!selected,
  });

  // ตรวจสอบว่า doc_no ที่กำลังพิมพ์/เลือกอยู่เคยมีการตรวจแล้วไหม (30 วันย้อนหลัง)
  // fire ทันทีที่ debouncedQ พิมพ์ (ไม่ต้องรอ select)
  const checkQ     = selected ? null : (debouncedQ.length >= 2 ? debouncedQ : null);
  const checkDocNo = selected?.doc_no ?? null;
  const checkKey   = checkDocNo ?? checkQ;
  const { data: prevInspections = [] } = useQuery({
    queryKey: ['ipqc-check', checkKey],
    queryFn: () => api.get('/ipqc-inspection/check', {
      params: checkDocNo ? { doc_no: checkDocNo } : { q: checkQ }
    }).then(r => r.data),
    enabled: !!checkKey,
  });
  // จัดกลุ่มตาม doc_no สำหรับแสดงใน dropdown
  const prevByDocNo = prevInspections.reduce((acc, r) => {
    (acc[r.doc_no] = acc[r.doc_no] || []).push(r);
    return acc;
  }, {});

  const stations = stationsRes?.data ?? [];
  const shifts = shiftsRes?.data ?? [];
  const results = searchRes?.data ?? [];

  const setF = (k, v) => setForm(p => ({ ...p, [k]: v }));

  function handleSelect(row) {
    setSelected(row);
    setDocQ(row.doc_no);
  }

  function handleNext() {
    if (!form.station_id) return setError('กรุณาเลือก Station');
    if (!selected) return setError('กรุณาเลือก PO / Doc No');
    setError('');
    onNext({
      ...form,
      doc_no: selected.doc_no,
      pro_code_sap_id: selected.pro_code_sap_id,
      pd_plan_id: selected.id,
      production_line_id: selected.production_line_id,
      lot_qty: selected.plan_qty,
      aql: aqlRes,
      selectedPO: selected,
    });
  }

  return (
    <div className="space-y-4">
      <h2 className="text-h3 font-semibold text-text">ขั้นตอนที่ 1 — เลือก Station และ PO</h2>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">วันที่ตรวจ *</label>
          <input className="input" type="date" value={form.inspect_date} onChange={e => setF('inspect_date', e.target.value)} />
        </div>
        <div>
          <label className="label">เวลา *</label>
          <input className="input" type="time" value={form.inspect_time} onChange={e => setF('inspect_time', e.target.value)} />
        </div>
        <div>
          <label className="label">Station *</label>
          <select className="input" value={form.station_id} onChange={e => setF('station_id', e.target.value)}>
            <option value="">— เลือก Station —</option>
            {stations.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">กะ</label>
          <select className="input" value={form.shift_id} onChange={e => setF('shift_id', e.target.value)}>
            <option value="">— เลือกกะ —</option>
            {shifts.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>

      {/* PO Search */}
      <div className="space-y-2">
        <label className="label">ค้นหา Doc No / PO *</label>
        <input
          className="input"
          placeholder="พิมพ์อย่างน้อย 2 ตัวอักษร"
          value={docQ}
          onChange={e => { setDocQ(e.target.value); setSelected(null); }}
        />

        {debouncedQ.length >= 2 && !selected && results.length > 0 && (
          <div className="border border-border rounded max-h-72 overflow-auto divide-y">
            {results.map(row => {
              const rowPrev = prevByDocNo[row.doc_no] || [];
              return (
                <div key={row.id} onClick={() => handleSelect(row)} className="p-3 cursor-pointer hover:bg-bg">
                  <div className="flex justify-between items-start gap-2">
                    <div className="min-w-0">
                      <div className="font-mono font-semibold text-primary text-small">{row.doc_no}</div>
                      <div className="text-small text-text">{row.product_desc}</div>
                      <div className="font-mono text-[11px] text-muted">{row.product_no}</div>
                      <ProductTags row={row} className="mt-1" />
                    </div>
                    <div className="text-right text-[11px] text-muted shrink-0">
                      <div>แผน: {row.plan_qty ?? 0}</div>
                      {row.line_name && <div>{row.line_name}</div>}
                    </div>
                  </div>
                  {rowPrev.length > 0 && (
                    <div className="mt-2 rounded bg-amber-50 dark:bg-amber-900 border border-amber-200 dark:border-amber-700 px-2 py-1.5" onClick={e => e.stopPropagation()}>
                      <div className="text-[10px] font-semibold text-amber-700 dark:text-amber-200 mb-1">
                        ⚠ ตรวจแล้ววันนี้ {rowPrev.length} ครั้ง — {[...new Set(rowPrev.map(r => r.station_name))].join(', ')}
                      </div>
                      <div className="space-y-0.5">
                        {rowPrev.map(r => (
                          <div key={r.id} className="flex items-center justify-between text-[10px] text-amber-800 dark:text-amber-200">
                            <span className="font-mono">{r.record_no}</span>
                            <span>{r.station_name}{r.shift_name ? ` (${r.shift_name})` : ''}</span>
                            <span className={r.overall_result === 'pass' ? 'text-green-700 dark:text-green-200 font-semibold' : r.overall_result === 'fail' ? 'text-red-700 dark:text-red-200 font-semibold' : 'text-gray-500 dark:text-gray-200'}>
                              {r.overall_result === 'pass' ? 'ผ่าน' : r.overall_result === 'fail' ? 'ไม่ผ่าน' : 'รอผล'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {selected && (
          <div className="p-3 bg-blue-50 dark:bg-blue-900 border border-blue-200 dark:border-blue-700 rounded">
            <div className="flex justify-between items-start gap-2">
              <div className="min-w-0">
                <div className="font-mono font-semibold text-primary text-small">{selected.product_no}</div>
                <div className="text-small text-text">{selected.product_desc}</div>
                <div className="text-[11px] text-muted">Doc: <span className="font-mono">{selected.doc_no}</span></div>
                {selected.line_name && <div className="text-[11px] text-muted">สาย: {selected.line_name}</div>}
                <ProductTags row={selected} className="mt-1.5" />
              </div>
              <button type="button" onClick={() => { setSelected(null); setDocQ(''); }} className="text-[11px] text-muted hover:text-danger shrink-0">ล้าง ×</button>
            </div>

            {/* AQL info */}
            {aqlRes && (
              <div className="mt-2 grid grid-cols-4 gap-2 text-center text-[11px]">
                {[
                  { label: 'Lot', val: selected.plan_qty ?? 0 },
                  { label: 'Sample (n)', val: aqlRes.n },
                  { label: 'Ac', val: aqlRes.ac },
                  { label: 'Re', val: aqlRes.re },
                ].map(({ label, val }) => (
                  <div key={label} className="p-2 bg-bg rounded border border-border">
                    <div className="font-semibold text-accent text-body">{val}</div>
                    <div className="text-muted">{label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* แจ้งเตือน — หลังเลือก PO แล้ว มีการตรวจวันนี้แล้ว */}
        {selected && prevInspections.length > 0 && (
          <div className="border border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-900 rounded-lg p-3">
            <div className="text-small font-semibold text-amber-700 dark:text-amber-200 mb-2">
              ⚠ Doc No นี้มีการตรวจแล้ววันนี้ {prevInspections.length} ครั้ง
              <span className="font-normal ml-1 text-[11px]">
                ({[...new Set(prevInspections.map(r => r.station_name))].join(', ')})
              </span>
            </div>
            <div className="space-y-1">
              {prevInspections.map(r => (
                <div key={r.id} className="flex items-center justify-between bg-surface rounded px-2 py-1.5 border border-amber-200 dark:border-amber-700 text-[11px]">
                  <span className="font-mono font-semibold text-primary">{r.record_no}</span>
                  <span className="text-muted">{r.station_name}{r.shift_name ? ` (${r.shift_name})` : ''}</span>
                  <span className="text-muted">{r.inspect_time}</span>
                  <span className={`font-semibold ${r.overall_result === 'pass' ? 'text-green-700 dark:text-green-200' : r.overall_result === 'fail' ? 'text-red-700 dark:text-red-200' : 'text-gray-500 dark:text-gray-200'}`}>
                    {r.overall_result === 'pass' ? 'ผ่าน' : r.overall_result === 'fail' ? 'ไม่ผ่าน' : 'รอผล'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {error && <div className="text-danger text-small bg-red-50 dark:bg-red-900 px-3 py-2 rounded">{error}</div>}

      <div className="flex justify-end">
        <Button onClick={handleNext}>ถัดไป →</Button>
      </div>
    </div>
  );
}

// ===== Step 2: กรอก Check Sheet =====
function CheckItemRow({ item, onChange }) {
  const stdMin = (item.std_value ?? 0) - (item.tol_minus ?? 0);
  const stdMax = (item.std_value ?? 0) + (item.tol_plus ?? 0);

  if (item.input_type === 'pass_fail') {
    return (
      <div className="flex items-center justify-between py-2 border-b border-border last:border-0">
        <div className="flex-1">
          <div className="text-small font-medium text-text">{item.item_no}. {item.item_name}</div>
          {item.check_type && <div className="text-[11px] text-muted">{item.check_type}</div>}
        </div>
        <div className="flex gap-2 ml-4">
          <button
            type="button"
            onClick={() => onChange({ pass_fail_value: 1, result: 'pass' })}
            className={`px-4 py-2 rounded text-small font-medium border min-h-[44px] ${item.pass_fail_value === 1 ? 'bg-green-600 text-white border-green-600' : 'border-border text-muted'}`}
          >ผ่าน</button>
          <button
            type="button"
            onClick={() => onChange({ pass_fail_value: 0, result: 'fail' })}
            className={`px-4 py-2 rounded text-small font-medium border min-h-[44px] ${item.pass_fail_value === 0 ? 'bg-danger text-white border-danger' : 'border-border text-muted'}`}
          >ไม่ผ่าน</button>
        </div>
      </div>
    );
  }

  if (item.input_type === 'text') {
    return (
      <div className="py-2 border-b border-border last:border-0 space-y-1">
        <div className="text-small font-medium text-text">{item.item_no}. {item.item_name}</div>
        <textarea
          className="input text-small" rows={2}
          value={item.text_value || ''}
          onChange={e => onChange({ text_value: e.target.value, result: e.target.value ? 'pass' : 'pending' })}
          placeholder="บันทึกผลตรวจ..."
        />
      </div>
    );
  }

  // number type — possibly multi-sample
  const sampleCount = item.sample_count || 1;
  const measured = Array.isArray(item.measured_values) ? item.measured_values : new Array(sampleCount).fill('');

  function handleValueChange(idx, val) {
    const next = [...measured];
    next[idx] = val;
    const nums = next.map(Number).filter(n => !isNaN(n) && n !== 0);
    let result = 'pending';
    let failCount = 0;
    if (nums.length > 0) {
      failCount = nums.filter(n => n < stdMin || n > stdMax).length;
      result = failCount > 0 ? 'fail' : 'pass';
    }
    onChange({ measured_values: next, measured_value: nums.length === 1 ? nums[0] : null, result, fail_count: failCount });
  }

  const resultColor = item.result === 'pass' ? 'text-success' : item.result === 'fail' ? 'text-danger' : 'text-muted';

  return (
    <div className="py-2 border-b border-border last:border-0">
      <div className="flex items-start justify-between mb-1">
        <div>
          <div className="text-small font-medium text-text">{item.item_no}. {item.item_name}</div>
          {item.std_value != null && (
            <div className="text-[11px] text-muted">Std: {item.std_value} {item.unit} (+{item.tol_plus}/-{item.tol_minus})</div>
          )}
        </div>
        <span className={`text-small font-semibold ${resultColor}`}>
          {item.result === 'pass' ? '✓ ผ่าน' : item.result === 'fail' ? '✗ ไม่ผ่าน' : '—'}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: sampleCount }, (_, idx) => {
          const val = measured[idx] ?? '';
          const num = Number(val);
          const inRange = !isNaN(num) && num !== 0 ? (num >= stdMin && num <= stdMax) : null;
          return (
            <div key={idx} className="flex flex-col items-center gap-0.5">
              <input
                className={`input w-20 text-center text-small ${inRange === false ? 'border-danger bg-red-50 dark:bg-red-900' : inRange === true ? 'border-success' : ''}`}
                type="number" step="0.01"
                value={val}
                onChange={e => handleValueChange(idx, e.target.value)}
                placeholder={`#${idx + 1}`}
              />
              {inRange !== null && (
                <span className={`text-[10px] ${inRange ? 'text-success' : 'text-danger'}`}>
                  {inRange ? '✓' : '✗'}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Spec tag strip — แสดง spec สินค้าที่กำลังตรวจ ──────────────────────────────
function SpecTags({ sel, className = '' }) {
  if (!sel) return null;
  const tags = [
    { val: sel.product_series, color: 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200' },
    { val: sel.brand,          color: 'bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-200' },
    { val: sel.panel_type,     color: 'bg-cyan-100 dark:bg-cyan-900 text-cyan-700 dark:text-cyan-200' },
    { val: sel.panel_style,    color: 'bg-teal-100 dark:bg-teal-900 text-teal-700 dark:text-teal-200' },
    { val: sel.panel_color,    color: 'bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-200' },
    { val: sel.panel_size,     color: 'bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-200' },
    { val: sel.glass_type && sel.glass_type !== 'none' ? sel.glass_type : null, color: 'bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-200' },
    { val: sel.mosquito_net && sel.mosquito_net !== 'none' ? sel.mosquito_net : null, color: 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200' },
  ].filter(t => t.val && String(t.val).trim());
  if (!tags.length) return null;
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {tags.map((t, i) => (
        <span key={i} className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border ${t.color}`}>{t.val}</span>
      ))}
    </div>
  );
}

function Step2({ formData, onNext, onBack }) {
  const [items, setItems] = useState([]);
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState('');
  const [templateId, setTemplateId] = useState(null);

  const sel = formData.selected;

  // spec-based template matching — ส่ง product spec ให้ backend หา template ที่ตรงที่สุด
  // NULL spec field ใน template = wildcard (ตรงกับทุกค่า)
  const { data: matchRes, isLoading: matchLoading } = useQuery({
    queryKey: [
      'ipqc-template-match',
      formData.station_id,
      sel?.product_series, sel?.brand, sel?.panel_type,
      sel?.panel_style, sel?.panel_color, sel?.panel_size,
    ],
    queryFn: () => api.get('/ipqc/master/template-match', {
      params: {
        station_id:   formData.station_id,
        series:       sel?.product_series || '',
        brand:        sel?.brand          || '',
        product_type: sel?.panel_type     || '',
        window_type:  sel?.panel_style    || '',
        color:        sel?.panel_color    || '',
        size:         sel?.panel_size     || '',
      }
    }).then(r => r.data),
    enabled: !!formData.station_id,
  });

  const resolvedTemplate = matchRes?.template ?? null;
  const matchedItems     = matchRes?.items    ?? [];
  const specificity      = matchRes?.specificity ?? 0;
  const maxSpecificity   = 6; // 6 spec fields total

  // Initialize form items เมื่อ matchRes เปลี่ยน
  // sample_count = AQL n สำหรับ number type (override template default)
  useEffect(() => {
    if (!matchedItems.length && matchRes !== undefined) {
      setItems([]);
      setTemplateId(resolvedTemplate?.id ?? null);
      return;
    }
    if (!matchedItems.length) return;
    const aqlN = formData.aql?.n || 1;
    const tItems = matchedItems.map(ci => ({
      ...ci,
      sample_count: ci.input_type === 'number' ? aqlN : 1,
      inspection_item_id: null,
      measured_values: ci.input_type === 'number' ? new Array(aqlN).fill('') : [],
      measured_value: null,
      pass_fail_value: null,
      text_value: '',
      result: 'pending',
      fail_count: 0,
      remarks: '',
    }));
    setItems(tItems);
    setTemplateId(resolvedTemplate?.id ?? null);
  }, [matchRes, formData.aql?.n]);

  function updateItem(idx, patch) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it));
  }

  const passCount    = items.filter(it => it.result === 'pass').length;
  const failCount    = items.filter(it => it.result === 'fail').length;
  const pendingCount = items.filter(it => it.result === 'pending').length;

  function handleNext() {
    const required = items.filter(it => it.is_required && it.result === 'pending');
    if (required.length > 0) {
      return setError(`กรุณากรอกข้อมูลหัวข้อบังคับ: ${required.map(it => it.item_name).join(', ')}`);
    }
    setError('');
    onNext({ items, remarks, template_id: templateId });
  }

  if (matchLoading) {
    return (
      <div className="space-y-4">
        <div className="text-center py-12 text-muted">กำลังค้นหา Check Template ที่เหมาะสม...</div>
        <Button variant="secondary" onClick={onBack}>← ย้อนกลับ</Button>
      </div>
    );
  }

  if (!resolvedTemplate) {
    return (
      <div className="space-y-4">
        <h2 className="text-h3 font-semibold text-text">ขั้นตอนที่ 2 — กรอก Check Sheet</h2>
        {sel && (
          <div className="card p-3">
            <p className="text-[11px] text-muted mb-1.5">สินค้าที่เลือก</p>
            <SpecTags sel={sel} />
          </div>
        )}
        <div className="card text-center py-10">
          <p className="text-h3 text-text font-medium">ไม่พบ Check Template ที่เหมาะสม</p>
          <p className="text-small text-muted mt-2">ให้ Admin สร้าง Template สำหรับ Station นี้ก่อน</p>
          <p className="text-small text-muted mt-1">ไปที่ จัดการระบบ → Master หน้างาน → Check Templates</p>
          <p className="text-small text-warning mt-2">Station: {formData.station_name || formData.station_id}</p>
        </div>
        <Button variant="secondary" onClick={onBack}>← ย้อนกลับ</Button>
      </div>
    );
  }

  // Match quality indicator
  const matchLabel = specificity === 0
    ? 'Generic (ใช้ได้กับทุกสินค้า)'
    : specificity === maxSpecificity
      ? 'ตรงสเปคทุกเงื่อนไข'
      : `ตรงสเปค ${specificity}/${maxSpecificity} เงื่อนไข`;
  const matchColor = specificity === 0
    ? 'bg-gray-100 dark:bg-gray-900 text-gray-500 dark:text-gray-200'
    : specificity >= 4
      ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200'
      : 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-200';

  return (
    <div className="space-y-4">
      <h2 className="text-h3 font-semibold text-text">ขั้นตอนที่ 2 — กรอก Check Sheet</h2>

      {/* Product spec + matched template info */}
      {sel && (
        <div className="card p-3 space-y-2">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <p className="text-[11px] text-muted mb-1.5">สินค้าที่กำลังตรวจ</p>
              <SpecTags sel={sel} />
            </div>
            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap mt-1 ${matchColor}`}>{matchLabel}</span>
          </div>
          <div className="flex items-center gap-2 pt-1 border-t border-border">
            <span className="text-[11px] text-muted">Template:</span>
            <span className="text-[11px] font-medium text-text">{resolvedTemplate.name}</span>
            <span className="text-[11px] text-muted ml-auto">{items.length} หัวข้อ | AQL n={formData.aql?.n ?? 1}</span>
          </div>
        </div>
      )}

      {/* Progress summary */}
      {items.length > 0 && (
        <div className="flex gap-2 text-small flex-wrap">
          <span className="bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200 px-2 py-1 rounded">✓ {passCount} ผ่าน</span>
          {failCount > 0 && <span className="bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200 px-2 py-1 rounded">✗ {failCount} ไม่ผ่าน</span>}
          {pendingCount > 0 && <span className="bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-200 px-2 py-1 rounded">— {pendingCount} รอกรอก</span>}
        </div>
      )}

      <div className="card">
        {items.length === 0 && <div className="text-muted text-small py-4 text-center">ไม่มีหัวข้อตรวจใน Template</div>}
        {items.map((item, idx) => (
          <CheckItemRow key={item.id} item={item} onChange={patch => updateItem(idx, patch)} />
        ))}
      </div>

      <div>
        <label className="label">หมายเหตุ</label>
        <textarea className="input text-small" rows={2} value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="บันทึกเพิ่มเติม..." />
      </div>

      {error && <div className="text-danger text-small bg-red-50 dark:bg-red-900 px-3 py-2 rounded">{error}</div>}

      <div className="flex gap-3 justify-between">
        <Button variant="secondary" onClick={onBack}>← ย้อนกลับ</Button>
        <Button onClick={handleNext}>สรุปผล →</Button>
      </div>
    </div>
  );
}

// ===== Step 3: สรุป + Submit + IPNCR form =====
function Step3({ formData, step2Data, onBack }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [ipncrForm, setIpncrForm] = useState({
    defect_description: '',
    total_qty_affected: '',
    action_required: 'recheck_100pct',
    deadline: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const failItems = step2Data.items.filter(it => it.result === 'fail');
  const passItems = step2Data.items.filter(it => it.result === 'pass');
  const overallFail = failItems.length > 0;

  async function handleSubmit() {
    setError('');
    setSubmitting(true);
    try {
      // สร้าง inspection
      const createRes = await api.post('/ipqc-inspection', {
        ...formData,
        template_id: step2Data.template_id,
        remarks: step2Data.remarks,
      });
      const inspId = createRes.data.id;

      // อัปเดต items
      await api.put(`/ipqc-inspection/${inspId}`, { items: step2Data.items.map(it => ({
        id: it.inspection_item_id,
        measured_values: it.measured_values,
        measured_value: it.measured_value,
        pass_fail_value: it.pass_fail_value,
        text_value: it.text_value,
        result: it.result,
        fail_count: it.fail_count,
        remarks: it.remarks || null,
      })) });

      // fetch back to get actual inspection_item ids
      const detailRes = await api.get(`/ipqc-inspection/${inspId}`);
      const dbItems = detailRes.data.items || [];
      await api.put(`/ipqc-inspection/${inspId}`, {
        items: step2Data.items.map((it, idx) => ({
          id: dbItems[idx]?.id,
          measured_values: it.measured_values,
          measured_value: it.measured_value,
          pass_fail_value: it.pass_fail_value,
          text_value: it.text_value,
          result: it.result,
          fail_count: it.fail_count,
          remarks: it.remarks || null,
        }))
      });

      // submit
      await api.post(`/ipqc-inspection/${inspId}/submit`, { remarks: step2Data.remarks });

      // ถ้า fail → สร้าง IPNCR
      if (overallFail && ipncrForm.defect_description) {
        await api.post('/ipncr', {
          inspection_id: inspId,
          doc_no: formData.doc_no,
          pro_code_sap_id: formData.pro_code_sap_id,
          production_line_id: formData.production_line_id,
          defect_description: ipncrForm.defect_description,
          total_qty_affected: ipncrForm.total_qty_affected ? +ipncrForm.total_qty_affected : 0,
          action_required: ipncrForm.action_required,
          deadline: ipncrForm.deadline || null,
        });
      }

      // invalidate list cache ให้โหลดใหม่เมื่อกลับไปหน้า list
      qc.invalidateQueries({ queryKey: ['ipqc-list'] });
      navigate(`/production-qc/ipqc/${inspId}`);
    } catch (e) {
      setError(e.response?.data?.error || 'เกิดข้อผิดพลาด');
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-h3 font-semibold text-text">ขั้นตอนที่ 3 — สรุปผลและบันทึก</h2>

      {/* Overall result */}
      <div className={`p-4 rounded-lg border-2 text-center ${overallFail ? 'border-danger bg-red-50 dark:bg-red-900' : 'border-success bg-green-50 dark:bg-green-900'}`}>
        <div className={`text-h2 font-bold ${overallFail ? 'text-danger' : 'text-success'}`}>
          {overallFail ? '✗ ไม่ผ่าน' : '✓ ผ่าน'}
        </div>
        <div className="text-small text-muted mt-1">
          ผ่าน {passItems.length} / ไม่ผ่าน {failItems.length} จาก {step2Data.items.length} หัวข้อ
        </div>
      </div>

      {/* Failed items list */}
      {failItems.length > 0 && (
        <div className="card">
          <h3 className="text-small font-semibold text-danger mb-2">หัวข้อที่ไม่ผ่าน</h3>
          {failItems.map(it => (
            <div key={it.id} className="py-1 border-b border-border last:border-0 text-small">
              <span className="font-medium">{it.item_no}. {it.item_name}</span>
              {it.std_value != null && (
                <span className="text-muted ml-2">Std: {it.std_value} ±({it.tol_plus}/{it.tol_minus}) {it.unit}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* IPNCR form — แสดงเมื่อ fail */}
      {overallFail && (
        <div className="card border-orange-200 dark:border-orange-700 bg-orange-50 dark:bg-orange-900">
          <h3 className="text-small font-semibold text-warning mb-3">ออกเอกสาร IPNCR</h3>
          <div className="space-y-2">
            <div>
              <label className="label">รายละเอียดปัญหาที่พบ *</label>
              <textarea
                className="input text-small" rows={3}
                value={ipncrForm.defect_description}
                onChange={e => setIpncrForm(p => ({ ...p, defect_description: e.target.value }))}
                placeholder="อธิบายปัญหาที่พบ..."
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">จำนวนที่กระทบ</label>
                <input className="input text-small" type="number"
                  value={ipncrForm.total_qty_affected}
                  onChange={e => setIpncrForm(p => ({ ...p, total_qty_affected: e.target.value }))}
                  placeholder="ชิ้น"
                />
              </div>
              <div>
                <label className="label">วันกำหนดแก้ไข</label>
                <input className="input text-small" type="date"
                  value={ipncrForm.deadline}
                  onChange={e => setIpncrForm(p => ({ ...p, deadline: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <label className="label">การดำเนินการ</label>
              <select className="input text-small" value={ipncrForm.action_required} onChange={e => setIpncrForm(p => ({ ...p, action_required: e.target.value }))}>
                <option value="recheck_100pct">Recheck 100%</option>
                <option value="rework">Rework</option>
                <option value="scrap">Scrap</option>
              </select>
            </div>
          </div>
          {!ipncrForm.defect_description && (
            <p className="text-[11px] text-muted mt-2">* ไม่กรอกรายละเอียดจะบันทึกผลตรวจโดยไม่ออก IPNCR</p>
          )}
        </div>
      )}

      {error && <div className="text-danger text-small bg-red-50 dark:bg-red-900 px-3 py-2 rounded">{error}</div>}

      <div className="flex gap-3 justify-between">
        <Button variant="secondary" onClick={onBack} disabled={submitting}>← ย้อนกลับ</Button>
        <Button onClick={handleSubmit} loading={submitting}>
          {overallFail && ipncrForm.defect_description ? 'บันทึก + ออก IPNCR' : 'บันทึกผลตรวจ'}
        </Button>
      </div>
    </div>
  );
}

// ===== Main =====
export default function IPQCNew() {
  const [step, setStep] = useState(1);
  const [step1Data, setStep1Data] = useState(null);
  const [step2Data, setStep2Data] = useState(null);

  return (
    <div className="max-w-2xl mx-auto">
      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6">
        {[1, 2, 3].map(n => (
          <React.Fragment key={n}>
            <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-small font-semibold border-2 ${step === n ? 'border-primary bg-primary text-white' : step > n ? 'border-success bg-success text-white' : 'border-border text-muted'}`}>
              {n}
            </span>
            {n < 3 && <div className={`flex-1 h-0.5 ${step > n ? 'bg-success' : 'bg-border'}`} />}
          </React.Fragment>
        ))}
      </div>

      <div className="card">
        {step === 1 && (
          <Step1 onNext={data => { setStep1Data(data); setStep(2); }} />
        )}
        {step === 2 && step1Data && (
          <Step2
            formData={step1Data}
            onNext={data => { setStep2Data(data); setStep(3); }}
            onBack={() => setStep(1)}
          />
        )}
        {step === 3 && step1Data && step2Data && (
          <Step3 formData={step1Data} step2Data={step2Data} onBack={() => setStep(2)} />
        )}
      </div>
    </div>
  );
}
