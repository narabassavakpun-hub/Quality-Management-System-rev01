import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { downloadExcel } from '../../utils/api';
import Button from '../../components/UI/Button';
import Modal from '../../components/UI/Modal';
import Pagination from '../../components/UI/Pagination';

const STATUS = {
  pending: { label: 'รอจำแนก', color: 'bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-200' },
  auto: { label: 'รอยืนยัน', color: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-200' },
  confirmed: { label: 'ยืนยันแล้ว', color: 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200' },
  rejected: { label: 'ปฏิเสธ', color: 'bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-200' },
};
const ATTR_FIELDS = [
  ['product_desc', 'ชื่อสินค้า'], ['line_type', 'ชนิดเส้น'], ['product_series', 'รุ่นสินค้า'],
  ['brand', 'แบรนด์'], ['panel_type', 'ชนิดบาน'], ['panel_style', 'รูปแบบบาน'],
  ['panel_color', 'สีบาน'], ['panel_size', 'ขนาด'], ['glass_type', 'ชนิดกระจก'],
  ['mosquito_net', 'มุ้ง'], ['iron_pattern', 'ลายเหล็กดัด'], ['iron_color', 'สีเหล็กดัด'],
  ['design_version', 'รุ่นออกแบบ'], ['remarks', 'อื่นๆ'],
];
const PAGE_SIZE = 20;

function Confidence({ value }) {
  const color = value >= 80 ? 'bg-green-500' : value >= 50 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-2 bg-gray-200 dark:bg-gray-800 rounded overflow-hidden"><div className={`h-full ${color}`} style={{ width: `${value}%` }} /></div>
      <span className="text-small text-muted">{value}%</span>
    </div>
  );
}

function FieldConfidenceBadge({ confidence }) {
  if (confidence == null) return null;
  const cls = confidence >= 90
    ? 'text-success border-success'
    : confidence >= 60
      ? 'text-warning border-warning'
      : 'text-danger border-danger';
  return (
    <span className={`ml-1.5 inline-flex items-center border rounded px-1 text-[10px] font-mono ${cls}`}>
      {confidence}%
    </span>
  );
}

const RULE_SUPPORTED = new Set(['panel_style', 'panel_color', 'glass_type', 'iron_pattern']);

function EditForm({ initial, onSave, onSaveAndConfirm, loading, error }) {
  const [form, setForm] = useState(() => { const b = {}; ATTR_FIELDS.forEach(([k]) => b[k] = initial[k] ?? ''); return b; });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const [preview, setPreview] = useState(null);
  const [ruleField, setRuleField] = useState(null);

  useEffect(() => {
    if (!initial.id) return;
    api.get(`/pro-code-sap/${initial.id}/classify-preview`)
      .then(r => setPreview(r.data))
      .catch(() => {});
  }, [initial.id]);

  const { data: fieldValues = {} } = useQuery({
    queryKey: ['sap-field-values'],
    queryFn: () => api.get('/pro-code-sap/field-values').then(r => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const fc = preview?.fieldConfidence || {};
  const sm = preview?.summary;
  const basis = preview?.basis;

  // render helper — ไม่ใช่ component เพื่อป้องกัน unmount/remount
  const field = (k, label) => {
    const opts = fieldValues[k] ?? [];
    const listId = `sap-fv-${k}`;
    return (
      <div key={k}>
        <div className="flex items-center justify-between mb-1">
          <label className="label mb-0">
            {label}
            {opts.length > 0 && <span className="ml-1 text-[10px] text-muted">({opts.length} ค่า)</span>}
          </label>
          {RULE_SUPPORTED.has(k) && (
            <button type="button" onClick={() => setRuleField(k)}
              className="flex-shrink-0 text-accent text-[11px] font-semibold hover:bg-blue-50 px-2 py-0.5 rounded ml-1"
              title={`เงื่อนไข ${label}`}>+เงื่อนไข</button>
          )}
        </div>
        <input className="input" list={opts.length > 0 ? listId : undefined}
          value={form[k] ?? ''} onChange={e => set(k, e.target.value)} autoComplete="off" />
        {opts.length > 0 && <datalist id={listId}>{opts.map(v => <option key={v} value={v} />)}</datalist>}
      </div>
    );
  };

  return (
    <>
    <form onSubmit={e => { e.preventDefault(); onSave(form); }} className="space-y-3">
      {error && <div className="text-danger text-small">{error}</div>}

      {/* Mobile sticky — แสดงรหัสและชื่อสินค้าติดอยู่บนจอเมื่อ scroll */}
      <div className="sticky top-0 z-10 -mx-4 px-4 py-2 bg-surface border-b border-border sm:hidden">
        <div className="font-mono text-[11px] text-muted">{initial.product_no}</div>
        <div className="text-small font-semibold text-text truncate">{form.product_desc || <span className="text-muted italic">ยังไม่ได้ระบุชื่อ</span>}</div>
      </div>


      {/* ชื่อสินค้า — full width */}
      <div>
        <label className="label">ชื่อสินค้า</label>
        <input className="input font-semibold" value={form.product_desc ?? ''} onChange={e => set('product_desc', e.target.value)} />
      </div>

      {/* Desktop: 3-col grid ไม่ต้อง scroll / Mobile: 1-col scroll ได้ */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* รหัสสินค้า readonly */}
        <div>
          <label className="label">รหัสสินค้า (SAP)</label>
          <div className="input bg-gray-50 dark:bg-gray-900 text-primary font-mono font-semibold select-all overflow-hidden text-ellipsis whitespace-nowrap">{initial.product_no}</div>
        </div>
        {field('line_type',      'ชนิดเส้น')}
        {field('product_series', 'รุ่นสินค้า')}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {field('brand',       'แบรนด์')}
        {field('panel_type',  'ชนิดบาน')}
        {field('panel_style', 'รูปแบบบาน')}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {field('panel_color', 'สีบาน')}
        {field('panel_size',  'ขนาด')}
        {field('glass_type',  'ชนิดกระจก')}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {field('mosquito_net', 'มุ้ง')}
        {field('iron_pattern', 'ลายเหล็กดัด')}
        {field('iron_color',   'สีเหล็กดัด')}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {field('design_version', 'รุ่นออกแบบ')}
        {field('remarks',        'อื่นๆ')}
        <div className="hidden sm:block" />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="submit" loading={loading} variant="secondary">บันทึก</Button>
        {onSaveAndConfirm && (
          <Button type="button" loading={loading} onClick={() => onSaveAndConfirm(form)}>
            บันทึกและยืนยัน
          </Button>
        )}
      </div>
    </form>
    {ruleField && <CustomRuleModal fieldKey={ruleField} onClose={() => setRuleField(null)} />}
    </>
  );
}

// ===== Custom Keyword Rule Modal =====
const RULE_FIELD_LABELS = {
  panel_style:  'รูปแบบบาน',
  panel_color:  'สีบาน',
  glass_type:   'ชนิดกระจก',
  iron_pattern: 'ลายเหล็กดัด',
};

function CustomRuleModal({ fieldKey, onClose }) {
  const qc = useQueryClient();
  const label = RULE_FIELD_LABELS[fieldKey] || fieldKey;

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ['parse-rules', fieldKey],
    queryFn: () => api.get(`/pro-code-sap/parse-rules?field=${fieldKey}`).then(r => r.data),
  });

  const [keyword, setKeyword] = useState('');
  const [value, setValue] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['parse-rules', fieldKey] });

  async function handleAdd(e) {
    e.preventDefault();
    if (!keyword.trim() || !value.trim()) return setErr('กรอกทั้งคำค้น และค่าที่ต้องการตั้ง');
    setSaving(true); setErr('');
    try {
      await api.post('/pro-code-sap/parse-rules', { keyword: keyword.trim(), target_field: fieldKey, set_value: value.trim() });
      setKeyword(''); setValue('');
      invalidate();
    } catch (e) { setErr(e.response?.data?.error || 'เพิ่มไม่สำเร็จ'); }
    finally { setSaving(false); }
  }

  async function handleToggle(rule) {
    await api.patch(`/pro-code-sap/parse-rules/${rule.id}`, { is_active: rule.is_active ? 0 : 1 });
    invalidate();
  }

  async function handleDelete(id) {
    if (!window.confirm('ลบเงื่อนไขนี้?')) return;
    await api.delete(`/pro-code-sap/parse-rules/${id}`);
    invalidate();
  }

  return (
    <Modal open onClose={onClose} title={`เงื่อนไขคำค้น — ${label}`}>
      <div className="space-y-4 w-full">

        {/* existing rules */}
        <div>
          <div className="text-small font-medium text-text mb-1">เงื่อนไขที่มีอยู่</div>
          {isLoading ? (
            <div className="text-muted text-small py-2">กำลังโหลด...</div>
          ) : rules.length === 0 ? (
            <div className="text-muted text-small py-2 text-center border border-dashed border-border rounded">ยังไม่มีเงื่อนไข</div>
          ) : (
            <div className="overflow-x-auto rounded border border-border">
              <table className="w-full text-small">
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th className="px-3 py-2 text-left text-muted font-medium whitespace-nowrap">คำค้น</th>
                    <th className="px-3 py-2 text-left text-muted font-medium whitespace-nowrap">ค่าที่ตั้ง</th>
                    <th className="px-2 py-2 text-center text-muted font-medium w-14 whitespace-nowrap">เปิด</th>
                    <th className="px-2 py-2 w-12"></th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map(r => (
                    <tr key={r.id} className={`border-t border-border ${!r.is_active ? 'opacity-40' : ''}`}>
                      <td className="px-3 py-2 font-mono text-[12px] break-all">{r.match_value}</td>
                      <td className="px-3 py-2 text-text break-all">{r.set_value}</td>
                      <td className="px-2 py-2 text-center">
                        <button
                          onClick={() => handleToggle(r)}
                          className={`w-10 h-6 rounded-full transition-colors ${r.is_active ? 'bg-success' : 'bg-border'}`}
                          title={r.is_active ? 'คลิกเพื่อปิด' : 'คลิกเพื่อเปิด'}
                        >
                          <span className={`block w-4 h-4 bg-white rounded-full mx-auto transform transition-transform ${r.is_active ? 'translate-x-2' : '-translate-x-2'}`} />
                        </button>
                      </td>
                      <td className="px-2 py-2 text-center">
                        <button onClick={() => handleDelete(r.id)}
                          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-danger hover:text-red-700 text-[13px] mx-auto">ลบ</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* add new rule */}
        <form onSubmit={handleAdd} className="space-y-2 border-t border-border pt-3">
          <div className="text-small font-medium text-text">เพิ่มเงื่อนไขใหม่</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="label text-[11px]">คำค้นหาในชื่อสินค้า</label>
              <input className="input font-mono" value={keyword}
                onChange={e => { setKeyword(e.target.value); setErr(''); }}
                placeholder="เช่น ลายไม้ หรือ สีขาว..." />
            </div>
            <div>
              <label className="label text-[11px]">ค่าที่ต้องการตั้ง ({label})</label>
              <input className="input" value={value}
                onChange={e => { setValue(e.target.value); setErr(''); }}
                placeholder={`เช่น ค่า ${label}...`} />
            </div>
          </div>
          {err && <div className="text-danger text-small">{err}</div>}
          <div className="flex justify-end">
            <Button type="submit" loading={saving}>+ เพิ่มเงื่อนไข</Button>
          </div>
        </form>

        <p className="text-[11px] text-muted border-t border-border pt-2">
          ระบบจะตรวจหาคำในชื่อสินค้าแบบ case-insensitive · เงื่อนไขจาก Admin จะ override ค่าอัตโนมัติทั้งหมด
        </p>
      </div>
    </Modal>
  );
}

function TrainingImportModal({ onClose, onDone, onGoTraining }) {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleImport() {
    if (!file) return;
    setLoading(true); setError(''); setResult(null);
    const fd = new FormData(); fd.append('file', file);
    try {
      const r = await api.post('/pro-code-sap/import-master-training', fd);
      setResult(r.data);
      onDone();
    } catch (e) {
      setError(e.response?.data?.error || 'นำเข้าไม่สำเร็จ');
    } finally { setLoading(false); }
  }

  return (
    <Modal open onClose={onClose} title="นำเข้า Training Data (ProCodeSAP)">
      <div className="space-y-4">
        <p className="text-small text-muted">
          อัปโหลดไฟล์ Excel ที่มีคอลัมน์ <code className="font-mono bg-gray-100 dark:bg-gray-900 px-1 rounded">Product No.</code> และ attribute — ระบบจะสร้าง Master Lookup สำหรับเพิ่มความแม่นยำ auto-classify
        </p>
        <input type="file" accept=".xlsx" className="block w-full text-small border border-border rounded px-2 py-2"
          onChange={e => { setFile(e.target.files[0] || null); setResult(null); setError(''); }} />
        {error && <div className="p-2 bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded text-danger text-small">{error}</div>}

        {result && (
          <div className="p-3 bg-green-50 dark:bg-green-900 border border-green-200 dark:border-green-700 rounded space-y-2">
            <div className="text-success font-medium text-small">นำเข้าสำเร็จ</div>
            <div className="text-small text-muted">
              {result.totalRows.toLocaleString()} แถว · {result.groups} กลุ่มรหัส · {result.fieldsInserted} ค่า · {result.durationMs}ms
            </div>
            {onGoTraining && (
              <button
                onClick={() => { onClose(); onGoTraining(); }}
                className="text-accent text-small underline"
              >
                ไปหน้าจัดการ Training Data →
              </button>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>ปิด</Button>
          <Button disabled={!file || loading} loading={loading} onClick={handleImport}>นำเข้า Training</Button>
        </div>
      </div>
    </Modal>
  );
}

function ResetAllModal({ onClose, onDone }) {
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  async function handleReset() {
    setLoading(true); setError('');
    try {
      const r = await api.post('/pro-code-sap/reset-all');
      setResult(r.data.counts);
      onDone();
    } catch (e) {
      setError(e.response?.data?.error || 'เกิดข้อผิดพลาด');
    } finally { setLoading(false); }
  }

  return (
    <Modal open onClose={onClose} title="ล้างข้อมูล ProCodeSAP & PDPlan ทั้งหมด">
      <div className="space-y-4">
        {!result ? (
          <>
            <div className="p-3 bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded text-small text-danger space-y-1">
              <div className="font-semibold">คำเตือน: การดำเนินการนี้ไม่สามารถย้อนกลับได้</div>
              <ul className="list-disc list-inside mt-1 space-y-0.5 text-muted">
                <li>ลบข้อมูล ProCodeSAP ทั้งหมด</li>
                <li>ลบแผนการผลิต (PDPlan) ทั้งหมด</li>
                <li>ล้าง Prediction Cache และ Training Data</li>
                <li>IPQC/FQC ที่ผูกกับ ProCodeSAP จะสูญเสียการอ้างอิง (pro_code_sap_id = NULL)</li>
              </ul>
            </div>
            <div>
              <label className="label">พิมพ์ <code className="font-mono bg-gray-100 dark:bg-gray-900 px-1 rounded">RESET</code> เพื่อยืนยัน</label>
              <input className="input" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="RESET" />
            </div>
            {error && <div className="text-danger text-small">{error}</div>}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={onClose}>ยกเลิก</Button>
              <Button
                disabled={confirm !== 'RESET' || loading}
                loading={loading}
                onClick={handleReset}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                ล้างข้อมูลทั้งหมด
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="p-3 bg-green-50 dark:bg-green-900 border border-green-200 dark:border-green-700 rounded space-y-1">
              <div className="text-success font-medium text-small">ล้างข้อมูลสำเร็จ</div>
              <div className="text-small text-muted space-y-0.5">
                <div>ProCodeSAP: {result.pro_code_sap} รายการ</div>
                <div>PDPlan: {result.pd_plans} รายการ</div>
                <div>Prediction Cache: {result.sap_prediction_cache} รายการ</div>
                <div>Training Data: {result.sap_master_lookup} รายการ</div>
                {(result.ipqc_nulled > 0 || result.fqc_nulled > 0) && (
                  <div className="text-warning">IPQC {result.ipqc_nulled} / FQC {result.fqc_nulled} รายการถูก NULL pro_code_sap_id</div>
                )}
              </div>
            </div>
            <div className="flex justify-end">
              <Button variant="secondary" onClick={onClose}>ปิด</Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

const RECHECK_LABEL = {
  line_type: 'ชนิดเส้น', product_series: 'รุ่นสินค้า', brand: 'แบรนด์',
  panel_type: 'ชนิดบาน', panel_style: 'รูปแบบบาน', panel_color: 'สีบาน',
  panel_size: 'ขนาด', glass_type: 'ชนิดกระจก', mosquito_net: 'มุ้ง',
  iron_pattern: 'ลายเหล็กดัด', iron_color: 'สีเหล็กดัด',
  design_version: 'รุ่นออกแบบ', remarks: 'อื่นๆ',
  width_mm: 'กว้าง (มม.)', height_mm: 'สูง (มม.)',
};

function RecheckModal({ item, onClose, onApply }) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [selected, setSelected] = useState(new Set());

  useEffect(() => {
    setLoading(true); setResult(null); setErr(null);
    api.post(`/pro-code-sap/${item.id}/recheck`)
      .then(r => { setResult(r.data); setSelected(new Set(r.data.diffs.map(d => d.field))); })
      .catch(e => setErr(e.response?.data?.error || 'เกิดข้อผิดพลาด'))
      .finally(() => setLoading(false));
  }, [item.id]);

  const applyMut = useMutation({
    mutationFn: () => api.post(`/pro-code-sap/${item.id}/apply-recheck`, { fields: [...selected] }),
    onSuccess: onApply,
  });

  const toggleAll = e => setSelected(e.target.checked ? new Set(result.diffs.map(d => d.field)) : new Set());
  const toggle = (f, checked) => { const s = new Set(selected); checked ? s.add(f) : s.delete(f); setSelected(s); };

  if (loading) return <div className="py-10 text-center text-muted text-small">กำลังวิเคราะห์ข้อมูล…</div>;
  if (err) return <div className="py-4 text-danger text-small">{err}</div>;
  if (!result) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 p-3 bg-gray-50 dark:bg-gray-900 rounded text-small">
        <div className="flex items-center gap-2">
          <span className="text-muted">ความมั่นใจ:</span>
          <Confidence value={result.confidence} />
        </div>
        <span className="text-muted">{result.sampleSize} รายการอ้างอิง</span>
      </div>

      {!result.hasDiffs ? (
        <div className="p-4 bg-green-50 dark:bg-green-900 border border-green-200 dark:border-green-700 rounded text-small text-success font-medium">
          ข้อมูลทั้งหมดตรงกับฐานข้อมูล ไม่พบค่าที่แตกต่าง
        </div>
      ) : (
        <>
          <div className="text-small text-muted">
            พบ <strong>{result.diffs.length}</strong> ฟิลด์ที่ระบบแนะนำค่าต่างออกไป — เลือกฟิลด์ที่ต้องการอัปเดต
          </div>
          <div className="border border-border rounded overflow-hidden">
            <table className="w-full text-small">
              <thead className="bg-gray-50 dark:bg-gray-900 border-b border-border">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">ฟิลด์</th>
                  <th className="text-center px-3 py-2 font-medium text-muted">ค่าปัจจุบัน</th>
                  <th className="text-center px-3 py-2 font-medium text-primary">ค่าที่แนะนำ</th>
                  <th className="px-3 py-2 text-center">
                    <input type="checkbox" checked={selected.size === result.diffs.length && result.diffs.length > 0} onChange={toggleAll} title="เลือกทั้งหมด" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.diffs.map(d => (
                  <tr key={d.field} className="border-t border-border hover:bg-gray-50">
                    <td className="px-3 py-2">{RECHECK_LABEL[d.field] || d.field}</td>
                    <td className="px-3 py-2 text-center text-muted">{d.current ?? <span className="italic">ว่าง</span>}</td>
                    <td className="px-3 py-2 text-center font-semibold text-primary">{d.suggested}</td>
                    <td className="px-3 py-2 text-center">
                      <input type="checkbox" checked={selected.has(d.field)} onChange={e => toggle(d.field, e.target.checked)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={onClose}>ปิด</Button>
            <Button onClick={() => applyMut.mutate()} disabled={selected.size === 0} loading={applyMut.isPending}>
              บันทึกที่เลือก ({selected.size} ฟิลด์)
            </Button>
          </div>
        </>
      )}

      {!result.hasDiffs && (
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>ปิด</Button>
        </div>
      )}
    </div>
  );
}

const SAP_STATUS_BADGE = {
  confirmed:    { label: 'มีข้อมูลแล้ว',    cls: 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200' },
  auto:         { label: 'รอยืนยัน',        cls: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-200' },
  pending:      { label: 'รอจำแนก',         cls: 'bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-200' },
  new:          { label: 'ใหม่ ต้องจำแนก', cls: 'bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-200' },
};
function SapBadge({ status }) {
  const b = SAP_STATUS_BADGE[status] || SAP_STATUS_BADGE.new;
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium ${b.cls}`}>{b.label}</span>;
}

function ImportTab({ onGoQueue, onGoPlan }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);

  const prevMut = useMutation({
    mutationFn: () => { const fd = new FormData(); fd.append('file', file); return api.post('/pd-plan/preview', fd).then(r => r.data); },
    onSuccess: (data) => setPreview(data),
  });
  const impMut = useMutation({
    mutationFn: () => { const fd = new FormData(); fd.append('file', file); return api.post('/pd-plan/import', fd).then(r => r.data); },
    onSuccess: (data) => { setResult(data); setPreview(null); },
  });

  function reset() { setFile(null); setPreview(null); setResult(null); prevMut.reset(); impMut.reset(); }

  /* ── Phase 3: ผลการนำเข้า ─────────────────────────────────── */
  if (result) return (
    <div className="max-w-xl space-y-4">
      <div className="card space-y-2">
        <div className="text-h3 font-semibold">ผลการนำเข้า</div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="p-2 bg-green-50 dark:bg-green-900 rounded"><div className="text-h2 font-bold text-success">{result.imported}</div><div className="text-small text-muted">เพิ่มใหม่</div></div>
          <div className="p-2 bg-blue-50 dark:bg-blue-900 rounded"><div className="text-h2 font-bold text-accent">{result.updated}</div><div className="text-small text-muted">อัปเดต</div></div>
          <div className="p-2 bg-gray-50 dark:bg-gray-900 rounded"><div className="text-h2 font-bold text-muted">{result.skipped}</div><div className="text-small text-muted">ข้าม</div></div>
        </div>
        {result.new_sap_codes?.length > 0 && (
          <div className="p-3 bg-yellow-50 dark:bg-yellow-900 border border-yellow-200 dark:border-yellow-700 rounded">
            <div className="text-small font-medium text-yellow-800 dark:text-yellow-200 mb-1">พบรหัส SAP ใหม่ {result.new_sap_codes.length} รายการ — รอจำแนก</div>
            <Button variant="secondary" onClick={onGoQueue}>ไปหน้าจำแนก ProCodeSAP →</Button>
          </div>
        )}
        {result.unmapped_sheets?.length > 0 && (
          <div className="p-3 bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded text-small text-danger">
            Sheet ที่ยังไม่ได้ผูกสายผลิต: {result.unmapped_sheets.join(', ')}
          </div>
        )}
        <div className="text-small text-muted">{result.sheets?.map(s => `${s.sheet}: ${s.rows} แถว`).join(' · ')}</div>
        <div className="flex gap-2 pt-1">
          <Button variant="secondary" onClick={onGoPlan}>ดูแผนการผลิต →</Button>
          <Button variant="secondary" onClick={reset}>นำเข้าไฟล์ใหม่</Button>
        </div>
      </div>
    </div>
  );

  /* ── Phase 2: Preview ─────────────────────────────────────── */
  if (preview) {
    const totalConfirmed  = preview.sheets.reduce((s, sh) => s + sh.summary.confirmed, 0);
    const totalNeedClass  = preview.sheets.reduce((s, sh) => s + sh.summary.needs_classify, 0);
    const totalNewSap     = preview.sheets.reduce((s, sh) => s + sh.summary.new_sap, 0);
    const totalInsert     = preview.sheets.reduce((s, sh) => s + sh.summary.insert, 0);
    const totalUpdate     = preview.sheets.reduce((s, sh) => s + sh.summary.update, 0);
    return (
      <div className="space-y-4">
        {/* Summary */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <div className="text-h3 font-semibold">ตรวจสอบข้อมูลก่อนนำเข้า</div>
            <span className="text-small text-muted font-mono">{file?.name}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-small mb-3">
            <div className="p-2 bg-gray-50 dark:bg-gray-900 rounded border border-border"><div className="text-h3 font-bold">{preview.total_rows}</div><div className="text-muted">รายการทั้งหมด</div></div>
            <div className="p-2 bg-green-50 dark:bg-green-900 rounded border border-green-200 dark:border-green-700"><div className="text-h3 font-bold text-green-700 dark:text-green-200">{totalConfirmed}</div><div className="text-muted">มีข้อมูลแล้ว</div></div>
            <div className="p-2 bg-yellow-50 dark:bg-yellow-900 rounded border border-yellow-200 dark:border-yellow-700"><div className="text-h3 font-bold text-yellow-700 dark:text-yellow-200">{totalNeedClass}</div><div className="text-muted">รอจำแนก</div></div>
            <div className="p-2 bg-orange-50 dark:bg-orange-900 rounded border border-orange-200 dark:border-orange-700"><div className="text-h3 font-bold text-orange-600 dark:text-orange-200">{totalNewSap}</div><div className="text-muted">ใหม่ ต้องจำแนก</div></div>
            {preview.total_errors > 0 && <div className="p-2 bg-red-50 dark:bg-red-900 rounded border border-red-200 dark:border-red-700"><div className="text-h3 font-bold text-danger">{preview.total_errors}</div><div className="text-muted">มีข้อผิดพลาด</div></div>}
            {preview.total_errors === 0 && <div className="p-2 bg-blue-50 dark:bg-blue-900 rounded border border-blue-200 dark:border-blue-700"><div className="text-h3 font-bold text-accent">{totalInsert}/{totalUpdate}</div><div className="text-muted">เพิ่ม/อัปเดต</div></div>}
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button onClick={() => impMut.mutate()} disabled={impMut.isPending}>
              {impMut.isPending ? 'กำลังนำเข้า...' : 'ยืนยันนำเข้าข้อมูล'}
            </Button>
            <Button variant="secondary" onClick={reset} disabled={impMut.isPending}>เลือกไฟล์ใหม่</Button>
          </div>
          {impMut.error && <div className="text-danger text-small mt-2">{impMut.error.response?.data?.error || 'นำเข้าไม่สำเร็จ'}</div>}
        </div>

        {/* Per-sheet preview */}
        {preview.sheets.map(sh => (
          <div key={sh.sheet} className="card">
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <span className="font-semibold text-h3">Sheet: {sh.sheet}</span>
              {sh.line_name
                ? <span className="text-small text-muted">→ {sh.line_name}</span>
                : <span className="text-small text-warning">⚠ ยังไม่ได้ผูกสายผลิต</span>}
              {sh.header_found && <span className="text-[11px] text-muted">Header: แถวที่ {sh.header_row}</span>}
              <span className="ml-auto text-small text-muted">
                {sh.summary.confirmed > 0 && <span className="text-green-700 dark:text-green-200 mr-2">✓ {sh.summary.confirmed} มีข้อมูล</span>}
                {sh.summary.needs_classify > 0 && <span className="text-yellow-700 dark:text-yellow-200 mr-2">⚠ {sh.summary.needs_classify} รอจำแนก</span>}
                {sh.summary.new_sap > 0 && <span className="text-red-600 dark:text-red-200 mr-2">✦ {sh.summary.new_sap} ใหม่</span>}
              </span>
            </div>

            {/* Sheet-level errors */}
            {sh.errors.map((e, i) => (
              <div key={i} className="mb-2 p-2 bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded text-small text-danger">{e.message}</div>
            ))}

            {sh.rows.length > 0 && (
              <div className="overflow-x-auto -mx-4 sm:mx-0">
                <table className="w-full text-[12px] border-collapse">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-900 border-b border-border">
                      <th className="px-2 py-1.5 text-left text-muted font-medium whitespace-nowrap">แถวที่</th>
                      <th className="px-2 py-1.5 text-left text-muted font-medium whitespace-nowrap">Doc. No.</th>
                      <th className="px-2 py-1.5 text-left text-muted font-medium whitespace-nowrap">รหัสสินค้า</th>
                      <th className="px-2 py-1.5 text-left text-muted font-medium">ชื่อสินค้า</th>
                      <th className="px-2 py-1.5 text-right text-muted font-medium whitespace-nowrap">แผน</th>
                      <th className="px-2 py-1.5 text-right text-muted font-medium whitespace-nowrap">เสร็จ</th>
                      <th className="px-2 py-1.5 text-right text-muted font-medium whitespace-nowrap">คงเหลือ</th>
                      <th className="px-2 py-1.5 text-left text-muted font-medium whitespace-nowrap">วันส่ง</th>
                      <th className="px-2 py-1.5 text-left text-muted font-medium whitespace-nowrap">สถานะ SAP</th>
                      <th className="px-2 py-1.5 text-left text-muted font-medium whitespace-nowrap">การดำเนินการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sh.rows.map(row => (
                      <tr key={row.row_num} className={`border-b border-border ${row.errors.length ? 'bg-red-50 dark:bg-red-900' : 'hover:bg-gray-50'}`}>
                        <td className="px-2 py-1 text-muted">{row.row_num}</td>
                        <td className="px-2 py-1 font-mono text-[11px]">{row.doc_no || <span className="text-danger">—</span>}</td>
                        <td className="px-2 py-1 font-mono text-[11px] text-primary whitespace-nowrap">{row.product_no || <span className="text-danger">—</span>}</td>
                        <td className="px-2 py-1 max-w-[160px] truncate" title={row.product_desc}>{row.product_desc || '—'}</td>
                        <td className="px-2 py-1 text-right">{row.plan_qty ?? '—'}</td>
                        <td className="px-2 py-1 text-right text-success">{row.completed_qty ?? '—'}</td>
                        <td className="px-2 py-1 text-right text-warning">{row.open_qty ?? '—'}</td>
                        <td className="px-2 py-1 whitespace-nowrap">{row.due_date || '—'}</td>
                        <td className="px-2 py-1"><SapBadge status={row.sap_status} /></td>
                        <td className="px-2 py-1">
                          {row.errors.length > 0
                            ? <span className="text-danger text-[11px]">{row.errors.join(', ')}</span>
                            : row.action === 'update'
                              ? <span className="text-[11px] text-muted bg-gray-100 dark:bg-gray-900 px-1.5 py-0.5 rounded">อัปเดต</span>
                              : <span className="text-[11px] text-accent bg-blue-50 dark:bg-blue-900 px-1.5 py-0.5 rounded">เพิ่มใหม่</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}

        <div className="flex gap-2 pb-4">
          <Button onClick={() => impMut.mutate()} disabled={impMut.isPending}>
            {impMut.isPending ? 'กำลังนำเข้า...' : 'ยืนยันนำเข้าข้อมูล'}
          </Button>
          <Button variant="secondary" onClick={reset} disabled={impMut.isPending}>เลือกไฟล์ใหม่</Button>
        </div>
      </div>
    );
  }

  /* ── Phase 1: เลือกไฟล์ ───────────────────────────────────── */
  return (
    <div className="max-w-xl space-y-4">
      <div className="card">
        <label className="label">เลือกไฟล์ Excel จากทีม Planning (.xlsx)</label>
        <input type="file" accept=".xlsx,.xls" className="input"
          onChange={e => { setFile(e.target.files[0] || null); setPreview(null); prevMut.reset(); }} />
        <p className="text-small text-muted mt-2">ระบบจะอ่านทุก Sheet, จับคู่สายผลิตจากรหัส Sheet และตรวจสอบรหัสสินค้าว่าต้องจำแนกใหม่หรือไม่</p>
        <div className="mt-3">
          <Button disabled={!file || prevMut.isPending} onClick={() => prevMut.mutate()}>
            {prevMut.isPending ? 'กำลังตรวจสอบ...' : 'ตรวจสอบไฟล์'}
          </Button>
        </div>
        {prevMut.error && <div className="text-danger text-small mt-2">{prevMut.error.response?.data?.error || 'ตรวจสอบไฟล์ไม่สำเร็จ'}</div>}
      </div>
    </div>
  );
}

function SapImportModal({ onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');

  async function handleFile(f) {
    setFile(f); setPreview(null); setError(''); setScanning(true);
    const fd = new FormData(); fd.append('file', f);
    try {
      const r = await api.post('/pro-code-sap/import?dryRun=1', fd);
      setPreview(r.data);
    } catch (e) {
      setError(e.response?.data?.error || 'อ่านไฟล์ไม่ได้');
    } finally { setScanning(false); }
  }

  async function handleConfirm() {
    if (!file || !preview?.valid) return;
    setImporting(true); setError('');
    const fd = new FormData(); fd.append('file', file);
    try { await api.post('/pro-code-sap/import', fd); onDone(); }
    catch (e) { setError(e.response?.data?.error || 'นำเข้าไม่สำเร็จ'); }
    finally { setImporting(false); }
  }

  return (
    <Modal open onClose={onClose} title="นำเข้า ProCodeSAP ที่ยืนยันแล้ว (Excel)">
      <div className="space-y-3">
        <p className="text-small text-muted">ไฟล์ต้องมีคอลัมน์ <code className="font-mono bg-gray-100 dark:bg-gray-900 px-1 rounded">product_no</code> และคอลัมน์ attribute ที่ต้องการแก้ไข</p>
        <input type="file" accept=".xlsx" className="block w-full text-small border border-border rounded px-2 py-2"
          onChange={e => e.target.files[0] && handleFile(e.target.files[0])} />
        {scanning && <div className="text-small text-muted">กำลังตรวจสอบ…</div>}
        {error && <div className="p-2 bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded text-danger text-small">{error}</div>}
        {preview && !error && (
          <div className="space-y-2">
            <div className="flex gap-4 text-small p-2 bg-gray-50 dark:bg-gray-900 rounded">
              <span className="font-medium">ทั้งหมด {preview.total} แถว</span>
              <span className="text-success">อัปเดตได้ {preview.valid}</span>
              {preview.invalid > 0 && <span className="text-danger">ผิดพลาด {preview.invalid}</span>}
            </div>
            {preview.invalid > 0 && (
              <div className="max-h-40 overflow-y-auto border border-border rounded text-small">
                {preview.rows?.filter(r => !r.valid).map(r => (
                  <div key={r.rowNum} className="px-2 py-1 border-b border-border bg-red-50 dark:bg-red-900">
                    <span className="font-mono mr-2">แถว {r.rowNum}</span>
                    <span className="text-danger">{r.errors?.join(', ')}</span>
                  </div>
                ))}
              </div>
            )}
            {preview.valid > 0 && (
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="secondary" onClick={onClose}>ยกเลิก</Button>
                <Button loading={importing} onClick={handleConfirm}>อัปเดต {preview.valid} รายการ</Button>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function QueueTab() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('auto');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  const [recheckItem, setRecheckItem] = useState(null);

  const { data: resp = {} } = useQuery({
    queryKey: ['procode', status, search, page],
    queryFn: () => api.get('/pro-code-sap', { params: { status: status || undefined, q: search || undefined, page, limit: PAGE_SIZE } }).then(r => r.data),
  });
  const rows = resp.data || [];
  const total = resp.total || 0;

  const inv = () => qc.invalidateQueries({ queryKey: ['procode'] });

  // หลัง confirm → รีเฟรชทันที แล้ว auto-classify ทุก pending/auto ในพื้นหลัง
  const autoClassifyAll = async () => {
    try { await api.post('/pro-code-sap/auto-classify'); inv(); } catch {}
  };

  const confirm = useMutation({
    mutationFn: (id) => api.post(`/pro-code-sap/${id}/confirm`),
    onSuccess: async () => { inv(); await autoClassifyAll(); },
  });
  const reject = useMutation({ mutationFn: (id) => api.post(`/pro-code-sap/${id}/reject`), onSuccess: inv });
  const save = useMutation({
    mutationFn: ({ id, form }) => api.patch(`/pro-code-sap/${id}`, form),
    onSuccess: () => { inv(); setEditing(null); },
  });
  const saveAndConfirm = useMutation({
    mutationFn: async ({ id, form }) => {
      await api.patch(`/pro-code-sap/${id}`, form);
      await api.post(`/pro-code-sap/${id}/confirm`);
    },
    onSuccess: async () => { inv(); setEditing(null); await autoClassifyAll(); },
  });

  const [importOpen, setImportOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  async function exportXlsx() {
    try {
      const params = status ? { status } : {};
      const fname = status ? `ProCodeSAP_${status}.xlsx` : 'ProCodeSAP.xlsx';
      await downloadExcel('/pro-code-sap/export/excel', params, fname);
    } catch { alert('Export ไม่สำเร็จ'); }
  }

  async function importXlsx(file) {
    const fd = new FormData(); fd.append('file', file);
    const dryR = await api.post('/pro-code-sap/import?dryRun=1', fd).then(r => r.data);
    return dryR;
  }
  async function doImport(file) {
    const fd = new FormData(); fd.append('file', file);
    await api.post('/pro-code-sap/import', fd);
    inv();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex gap-1 flex-wrap">
          {[['auto', 'รอยืนยัน'], ['confirmed', 'ยืนยันแล้ว'], ['rejected', 'ปฏิเสธ'], ['', 'ทั้งหมด']].map(([v, l]) => (
            <button key={v} onClick={() => { setStatus(v); setPage(1); }}
              className={`px-3 py-1.5 rounded text-small ${status === v ? 'bg-primary text-white' : 'bg-gray-100 dark:bg-gray-900 text-muted'}`}>{l}</button>
          ))}
        </div>
        <div className="flex gap-2 flex-wrap">
          <input className="input max-w-xs" placeholder="ค้นหารหัส/ชื่อ" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
          <Button variant="secondary" onClick={exportXlsx}>Export{status ? ` (${status})` : ''}</Button>
          {status === 'confirmed' && <Button variant="secondary" onClick={() => setImportOpen(true)}>Import</Button>}
        </div>
      </div>

      <div className="table-container">
        <table className="table">
          <thead><tr><th>รหัสสินค้า</th><th>ชื่อ</th><th>คุณสมบัติ</th><th>ความมั่นใจ</th><th>สถานะ</th><th>Action</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="text-center text-muted py-8">ไม่พบข้อมูล</td></tr>}
            {rows.map(r => (
              <tr key={r.id}>
                <td className="font-mono text-primary">{r.product_no}</td>
                <td className="text-small max-w-[200px] truncate">{r.product_desc}</td>
                <td className="text-small">
                  <div className="flex flex-wrap gap-1">
                    {[r.line_type, r.brand, r.panel_type, r.panel_color, r.panel_size].filter(Boolean).map((c, i) =>
                      <span key={i} className="badge bg-gray-100 dark:bg-gray-900 text-text">{c}</span>)}
                  </div>
                </td>
                <td><Confidence value={r.auto_confidence || 0} /></td>
                <td><span className={`badge ${STATUS[r.classify_status]?.color}`}>{STATUS[r.classify_status]?.label}</span></td>
                <td>
                  <div className="flex gap-2 items-center flex-wrap">
                    {r.classify_status !== 'confirmed' && <button className="text-success text-small" onClick={() => confirm.mutate(r.id)}>ยืนยัน</button>}
                    <button className="text-accent text-small" onClick={() => setEditing(r)}>แก้ไข</button>
                    {r.classify_status !== 'rejected' && r.classify_status !== 'confirmed' && <button className="text-danger text-small" onClick={() => reject.mutate(r.id)}>ปฏิเสธ</button>}
                    {r.classify_status === 'confirmed' && (
                      <button
                        className={`text-small flex items-center gap-1 ${(r.auto_confidence || 0) < 80 ? 'text-warning font-medium' : 'text-muted'}`}
                        onClick={() => setRecheckItem(r)}
                        title="ตรวจสอบอีกครั้งโดยใช้ข้อมูล master ปัจจุบัน"
                      >
                        {(r.auto_confidence || 0) < 80 && <span className="inline-block w-1.5 h-1.5 rounded-full bg-warning" />}
                        ตรวจสอบ
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} totalPages={Math.max(1, Math.ceil(total / PAGE_SIZE))} total={total} limit={PAGE_SIZE} onChange={setPage} />

      <Modal open={!!editing} onClose={() => setEditing(null)} title="แก้ไข ProCodeSAP" size="xl" tall>
        {editing && (
          <EditForm
            initial={editing}
            onSave={form => save.mutate({ id: editing.id, form })}
            onSaveAndConfirm={editing.classify_status !== 'confirmed'
              ? (form => saveAndConfirm.mutate({ id: editing.id, form }))
              : undefined}
            loading={save.isPending || saveAndConfirm.isPending}
            error={save.error?.response?.data?.error || saveAndConfirm.error?.response?.data?.error}
          />
        )}
      </Modal>

      <Modal open={!!recheckItem} onClose={() => setRecheckItem(null)}
        title={recheckItem ? `ตรวจสอบ: ${recheckItem.product_no}` : ''}>
        {recheckItem && (
          <RecheckModal
            item={recheckItem}
            onClose={() => setRecheckItem(null)}
            onApply={() => { inv(); setRecheckItem(null); }}
          />
        )}
      </Modal>

      {importOpen && <SapImportModal onClose={() => setImportOpen(false)} onDone={() => { inv(); setImportOpen(false); }} />}

      {resetOpen && (
        <ResetAllModal
          onClose={() => setResetOpen(false)}
          onDone={() => { inv(); setResetOpen(false); }}
        />
      )}
    </div>
  );
}

// ===== Training Data Management Tab =====

const FIELD_LABELS = {
  line_type: 'ชนิดเส้น', product_series: 'รุ่นสินค้า', brand: 'แบรนด์',
  panel_type: 'ชนิดบาน', panel_style: 'รูปแบบบาน', panel_color: 'สีบาน',
  glass_type: 'ชนิดกระจก', mosquito_net: 'มุ้ง', iron_pattern: 'ลายเหล็กดัด',
  iron_color: 'สีเหล็กดัด', design_version: 'รุ่นออกแบบ', remarks: 'อื่นๆ',
};

function ConfBadge({ v }) {
  const cls = v >= 90 ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200' : v >= 60 ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-200' : 'bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-200';
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-mono ${cls}`}>{v}%</span>;
}

function GroupDetailPanel({ part1, part2, onGroupDeleted }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(null); // { field, top_value, confidence_pct }
  const [editVal, setEditVal] = useState({ top_value: '', confidence_pct: 0 });
  const [deleting, setDeleting] = useState(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['training-detail', part1, part2],
    queryFn: () => api.get('/pro-code-sap/master-training/group-detail', { params: { part1, part2 } }).then(r => r.data),
    staleTime: 0,
  });

  const rows = data?.data || [];

  function startEdit(row) {
    setEditing(row.field_name);
    setEditVal({ top_value: row.top_value, confidence_pct: row.confidence_pct });
  }

  async function saveEdit() {
    await api.patch('/pro-code-sap/master-training/entry', {
      part1, part2, field: editing, ...editVal,
    });
    setEditing(null);
    refetch();
  }

  async function deleteEntry(field) {
    if (!window.confirm(`ลบฟิลด์ "${FIELD_LABELS[field] || field}" ออกจากกลุ่ม ${part1}-${part2}?`)) return;
    await api.delete('/pro-code-sap/master-training/entry', { params: { part1, part2, field } });
    refetch();
  }

  async function deleteGroup() {
    if (!window.confirm(`ลบกลุ่ม ${part1}-${part2} ทั้งหมด ${rows.length} ฟิลด์?`)) return;
    await api.delete('/pro-code-sap/master-training/group', { params: { part1, part2 } });
    onGroupDeleted();
  }

  if (isLoading) return <div className="px-4 py-3 text-small text-muted">กำลังโหลด...</div>;

  return (
    <div className="border-t border-border bg-gray-50 dark:bg-gray-900 px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-small font-medium text-primary">{part1}{part2 ? `-${part2}` : ''} — {rows.length} ฟิลด์</span>
        <button onClick={deleteGroup} className="text-[11px] text-danger hover:underline">ลบกลุ่มนี้ทั้งหมด</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-small">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-2 py-1.5 text-muted font-medium">ฟิลด์</th>
              <th className="text-left px-2 py-1.5 text-muted font-medium">ค่าที่ใช้จำแนก</th>
              <th className="text-center px-2 py-1.5 text-muted font-medium">ความถี่</th>
              <th className="text-center px-2 py-1.5 text-muted font-medium">ตัวอย่าง</th>
              <th className="text-center px-2 py-1.5 text-muted font-medium">ความมั่นใจ</th>
              <th className="px-2 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.field_name} className="border-b border-border last:border-0 hover:bg-surface">
                <td className="px-2 py-1.5 text-muted">{FIELD_LABELS[r.field_name] || r.field_name}</td>
                <td className="px-2 py-1.5">
                  {editing === r.field_name ? (
                    <input
                      className="input py-0.5 text-small h-7"
                      value={editVal.top_value}
                      onChange={e => setEditVal(p => ({ ...p, top_value: e.target.value }))}
                      autoFocus
                    />
                  ) : (
                    <span className="font-medium text-primary">{r.top_value}</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-center text-muted">{r.frequency}</td>
                <td className="px-2 py-1.5 text-center text-muted">{r.sample_size}</td>
                <td className="px-2 py-1.5 text-center">
                  {editing === r.field_name ? (
                    <input
                      type="number" min="0" max="100"
                      className="input py-0.5 text-small h-7 w-16 text-center"
                      value={editVal.confidence_pct}
                      onChange={e => setEditVal(p => ({ ...p, confidence_pct: +e.target.value }))}
                    />
                  ) : (
                    <ConfBadge v={r.confidence_pct} />
                  )}
                </td>
                <td className="px-2 py-1.5 text-right">
                  {editing === r.field_name ? (
                    <div className="flex gap-2 justify-end">
                      <button onClick={saveEdit} className="text-success text-[11px] font-medium">บันทึก</button>
                      <button onClick={() => setEditing(null)} className="text-muted text-[11px]">ยกเลิก</button>
                    </div>
                  ) : (
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => startEdit(r)} className="text-accent text-[11px]">แก้ไข</button>
                      <button onClick={() => deleteEntry(r.field_name)} className="text-danger text-[11px]">ลบ</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const TRAINING_PAGE_SIZE = 30;

function TrainingDataTab() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState(null); // "part1||part2"
  const qc = useQueryClient();

  const { data: stats } = useQuery({
    queryKey: ['training-stats'],
    queryFn: () => api.get('/pro-code-sap/master-training/stats').then(r => r.data),
    staleTime: 30000,
  });

  const { data: resp = {}, isLoading } = useQuery({
    queryKey: ['training-groups', search, page],
    queryFn: () => api.get('/pro-code-sap/master-training/groups', {
      params: { q: search || undefined, page, limit: TRAINING_PAGE_SIZE },
    }).then(r => r.data),
    staleTime: 15000,
  });

  const rows = resp.data || [];
  const total = resp.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / TRAINING_PAGE_SIZE));

  function toggle(key) {
    setExpanded(p => p === key ? null : key);
  }

  function invGroups() {
    qc.invalidateQueries({ queryKey: ['training-groups'] });
    qc.invalidateQueries({ queryKey: ['training-stats'] });
    setExpanded(null);
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      {stats && (
        <div className="flex flex-wrap gap-4 p-3 bg-blue-50 dark:bg-blue-900 border border-blue-100 dark:border-blue-700 rounded text-small">
          <span className="text-primary font-medium">{(stats.groups || 0).toLocaleString()} กลุ่มรหัส</span>
          <span className="text-muted">·</span>
          <span className="text-text">{(stats.entries || 0).toLocaleString()} ค่าทั้งหมด</span>
          {stats.importedAt && (
            <>
              <span className="text-muted">·</span>
              <span className="text-muted">นำเข้าล่าสุด: {stats.importedAt.slice(0, 16).replace('T', ' ')}</span>
            </>
          )}
          {!stats.entries && (
            <span className="text-warning font-medium">ยังไม่มี Training Data — กดปุ่ม "นำเข้า Training" ในแท็บ "จำแนก ProCodeSAP"</span>
          )}
        </div>
      )}

      {/* Search */}
      <div className="flex gap-3">
        <input
          className="input max-w-xs"
          placeholder="ค้นหา Part1 หรือ Part2 เช่น FA00, W0313"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); setExpanded(null); }}
        />
        <span className="text-small text-muted self-center">{total.toLocaleString()} กลุ่ม</span>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-center text-muted text-small py-8">กำลังโหลด...</div>
      ) : rows.length === 0 ? (
        <div className="text-center text-muted text-small py-8">ไม่พบข้อมูล</div>
      ) : (
        <div className="border border-border rounded overflow-hidden">
          <table className="w-full text-small">
            <thead className="bg-gray-50 dark:bg-gray-900 border-b border-border">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Part1</th>
                <th className="text-left px-3 py-2 font-medium">Part2</th>
                <th className="text-center px-3 py-2 font-medium">ตัวอย่าง</th>
                <th className="text-center px-3 py-2 font-medium">ฟิลด์</th>
                <th className="text-center px-3 py-2 font-medium">ความมั่นใจเฉลี่ย</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const key = `${r.sap_part1}||${r.sap_part2}`;
                const isOpen = expanded === key;
                return (
                  <React.Fragment key={key}>
                    <tr
                      className={`border-b border-border cursor-pointer hover:bg-gray-50 ${isOpen ? 'bg-blue-50 dark:bg-blue-900' : ''}`}
                      onClick={() => toggle(key)}
                    >
                      <td className="px-3 py-2 font-mono font-medium text-primary">{r.sap_part1}</td>
                      <td className="px-3 py-2 font-mono text-text">{r.sap_part2 || <span className="text-muted italic">—</span>}</td>
                      <td className="px-3 py-2 text-center text-muted">{r.sample_size}</td>
                      <td className="px-3 py-2 text-center">{r.field_count} ฟิลด์</td>
                      <td className="px-3 py-2 text-center"><ConfBadge v={r.avg_confidence} /></td>
                      <td className="px-3 py-2 text-right">
                        <span className="text-accent text-[11px]">{isOpen ? '▲ ซ่อน' : '▼ จัดการ'}</span>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={6} className="p-0">
                          <GroupDetailPanel
                            part1={r.sap_part1}
                            part2={r.sap_part2 || ''}
                            onGroupDeleted={invGroups}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-small">
          <span className="text-muted">หน้า {page} / {totalPages}</span>
          <div className="flex gap-1">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
              className="px-3 py-1.5 rounded border border-border disabled:opacity-40">ก่อนหน้า</button>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
              className="px-3 py-1.5 rounded border border-border disabled:opacity-40">ถัดไป</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ===== PDPlan View Tab =====
function PDPlanTab() {
  const [lineId, setLineId] = useState('');
  const [dueFrom, setDueFrom] = useState('');
  const [dueTo, setDueTo]   = useState('');
  const [q, setQ]           = useState('');
  const [page, setPage]     = useState(1);
  const PAGE = 30;

  const { data: lines = [] } = useQuery({
    queryKey: ['prod-lines'],
    queryFn: () => api.get('/ipqc/master/production-lines?active=1&limit=200').then(r => {
      const d = r.data?.data;
      return Array.isArray(d) ? d : [];
    }),
    staleTime: 5 * 60 * 1000,
  });

  const { data: resp = {}, isLoading } = useQuery({
    queryKey: ['pd-plans', lineId, dueFrom, dueTo, q, page],
    queryFn: () => api.get('/pd-plan', { params: {
      line_id: lineId || undefined, due_from: dueFrom || undefined, due_to: dueTo || undefined,
      q: q || undefined, page, limit: PAGE,
    }}).then(r => r.data),
    staleTime: 15000,
  });

  const rows  = resp.data  || [];
  const total = resp.total || 0;

  const fmt = (d) => d ? d.slice(0, 10) : '—';
  const num = (v) => (v ?? 0) === 0 ? <span className="text-muted">—</span> : v;

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-end">
        <div>
          <label className="label">สายการผลิต</label>
          <select className="input" value={lineId} onChange={e => { setLineId(e.target.value); setPage(1); }}>
            <option value="">ทั้งหมด</option>
            {lines.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Due Date ตั้งแต่</label>
          <input type="date" className="input" value={dueFrom} onChange={e => { setDueFrom(e.target.value); setPage(1); }} />
        </div>
        <div>
          <label className="label">ถึง</label>
          <input type="date" className="input" value={dueTo} onChange={e => { setDueTo(e.target.value); setPage(1); }} />
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="label">ค้นหา</label>
          <input className="input" placeholder="รหัส / ชื่อสินค้า / Doc. No." value={q}
            onChange={e => { setQ(e.target.value); setPage(1); }} />
        </div>
      </div>

      {/* Summary */}
      <div className="text-small text-muted">ทั้งหมด {total.toLocaleString()} รายการ</div>

      {/* Table */}
      {isLoading ? (
        <div className="py-8 text-center text-muted text-small">กำลังโหลด...</div>
      ) : rows.length === 0 ? (
        <div className="py-8 text-center text-muted text-small border border-dashed border-border rounded">ไม่มีข้อมูล</div>
      ) : (
        <div className="overflow-x-auto rounded border border-border">
          <table className="w-full text-small whitespace-nowrap">
            <thead className="bg-gray-50 dark:bg-gray-900 border-b border-border">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-muted">#</th>
                <th className="px-3 py-2 text-left font-medium text-muted">Doc. No.</th>
                <th className="px-3 py-2 text-left font-medium text-muted">รหัสสินค้า</th>
                <th className="px-3 py-2 text-left font-medium text-muted">ชื่อสินค้า</th>
                <th className="px-3 py-2 text-left font-medium text-muted">สายการผลิต</th>
                <th className="px-3 py-2 text-right font-medium text-muted">Planned</th>
                <th className="px-3 py-2 text-right font-medium text-muted">Completed</th>
                <th className="px-3 py-2 text-right font-medium text-muted">Open</th>
                <th className="px-3 py-2 text-right font-medium text-muted">งานออก/วัน</th>
                <th className="px-3 py-2 text-left font-medium text-muted">SO.ประจำวัน</th>
                <th className="px-3 py-2 text-right font-medium text-muted">STOCK</th>
                <th className="px-3 py-2 text-right font-medium text-muted">คงเหลือ</th>
                <th className="px-3 py-2 text-right font-medium text-muted">รายวัน</th>
                <th className="px-3 py-2 text-right font-medium text-muted">OT</th>
                <th className="px-3 py-2 text-left font-medium text-muted">หมายเหตุ</th>
                <th className="px-3 py-2 text-left font-medium text-muted">Order Date</th>
                <th className="px-3 py-2 text-left font-medium text-muted">Start Date</th>
                <th className="px-3 py-2 text-left font-medium text-muted">Due Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className="border-t border-border hover:bg-gray-50">
                  <td className="px-3 py-2 text-muted">{(page - 1) * PAGE + i + 1}</td>
                  <td className="px-3 py-2 font-mono text-[12px]">{r.doc_no}</td>
                  <td className="px-3 py-2 font-mono text-[12px] text-primary">{r.product_no}</td>
                  <td className="px-3 py-2 max-w-[200px] truncate" title={r.product_desc}>{r.product_desc || '—'}</td>
                  <td className="px-3 py-2">{r.line_name || '—'}</td>
                  <td className="px-3 py-2 text-right font-medium">{num(r.plan_qty)}</td>
                  <td className="px-3 py-2 text-right text-success">{num(r.completed_qty)}</td>
                  <td className="px-3 py-2 text-right text-warning">{num(r.open_qty)}</td>
                  <td className="px-3 py-2 text-right">{num(r.daily_output)}</td>
                  <td className="px-3 py-2">{r.so_daily || '—'}</td>
                  <td className="px-3 py-2 text-right">{num(r.stock_qty)}</td>
                  <td className="px-3 py-2 text-right">{num(r.remaining_qty)}</td>
                  <td className="px-3 py-2 text-right">{num(r.daily_plan)}</td>
                  <td className="px-3 py-2 text-right">{num(r.ot_qty)}</td>
                  <td className="px-3 py-2 max-w-[120px] truncate" title={r.remarks}>{r.remarks || '—'}</td>
                  <td className="px-3 py-2">{fmt(r.order_date)}</td>
                  <td className="px-3 py-2">{fmt(r.start_date)}</td>
                  <td className="px-3 py-2 font-medium">{fmt(r.due_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {total > PAGE && (
        <div className="flex items-center gap-2 justify-end pt-1">
          <button className="px-3 py-1 border border-border rounded text-small disabled:opacity-40"
            disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← ก่อนหน้า</button>
          <span className="text-small text-muted">หน้า {page} / {Math.ceil(total / PAGE)}</span>
          <button className="px-3 py-1 border border-border rounded text-small disabled:opacity-40"
            disabled={page >= Math.ceil(total / PAGE)} onClick={() => setPage(p => p + 1)}>ถัดไป →</button>
        </div>
      )}
    </div>
  );
}

export default function ProCodeSapPage() {
  const [tab, setTab] = useState('import');
  return (
    <div>
      <h1 className="text-h2 font-bold text-text mb-4">ProCodeSAP & PDPlan</h1>
      <div className="flex flex-wrap gap-1 mb-5 border-b border-border">
        {[['import', 'นำเข้า PDPlan'], ['pdplan', 'ดูแผนการผลิต'], ['queue', 'จำแนก ProCodeSAP']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 text-small border-b-2 -mb-px ${tab === k ? 'border-primary text-primary font-semibold' : 'border-transparent text-muted'}`}>{l}</button>
        ))}
      </div>
      {tab === 'import' && <ImportTab onGoQueue={() => setTab('queue')} onGoPlan={() => setTab('pdplan')} />}
      {tab === 'pdplan' && <PDPlanTab />}
      {tab === 'queue'  && <QueueTab />}
    </div>
  );
}
