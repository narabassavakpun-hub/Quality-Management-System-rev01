import React, { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { downloadExcel } from '../../utils/api';
import Button from './Button';
import Modal from './Modal';
import ConfirmDialog from './ConfirmDialog';
import Pagination from './Pagination';

const PAGE_SIZE = 20;

// ปุ่ม "+" ข้างช่อง select — เปิด popover เล็กๆ ให้เพิ่มตัวเลือกใหม่โดยไม่ต้องออกจากฟอร์ม
// creatable: { title, inputs: [{label, placeholder}], onAdd: async (vals) => valueToSelect|null }
function QuickAddOption({ creatable, onCreated }) {
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState(() => creatable.inputs.map(() => ''));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    setBusy(true); setErr('');
    try {
      const v = await creatable.onAdd(vals);
      if (v == null) { setErr('กรุณากรอกข้อมูลให้ครบ'); return; }
      onCreated(v);
      setOpen(false);
      setVals(creatable.inputs.map(() => ''));
    } catch (e) {
      setErr(e.response?.data?.error || 'เพิ่มไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative shrink-0">
      <button type="button" title={creatable.title}
        className="btn-secondary px-3 min-h-[44px]" onClick={() => setOpen(o => !o)}>+</button>
      {open && (
        <div className="absolute z-20 right-0 mt-1 w-64 bg-surface border border-border rounded-lg shadow-lg p-3 space-y-2">
          <div className="text-small font-semibold text-text">{creatable.title}</div>
          {creatable.inputs.map((inp, i) => (
            <input key={i} className="input" placeholder={inp.placeholder || inp.label} value={vals[i]}
              onChange={e => setVals(v => v.map((x, idx) => idx === i ? e.target.value : x))} />
          ))}
          {err && <div className="text-danger text-small">{err}</div>}
          <div className="flex justify-end gap-2">
            <button type="button" className="text-muted text-small" onClick={() => setOpen(false)}>ยกเลิก</button>
            <button type="button" className="text-accent text-small font-semibold" disabled={busy} onClick={submit}>{busy ? '...' : 'เพิ่ม'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function FormBody({ fields, initial, onSave, loading, error }) {
  const [form, setForm] = useState(() => {
    const base = {};
    fields.forEach(f => {
      const stored = initial?.[f.key];
      base[f.key] = (stored !== undefined && stored !== null) ? stored : (f.default !== undefined ? f.default : '');
    });
    return base;
  });

  // เมื่อ field ที่มี dependsOn เปลี่ยน ให้ reset cascade — รองรับหลายชั้น
  const set = (k, v) => setForm(p => {
    const next = { ...p, [k]: v };
    const changed = new Set([k]);
    let stable = false;
    while (!stable) {
      stable = true;
      fields.forEach(f => {
        if (f.dependsOn && changed.has(f.dependsOn) && next[f.key] !== '') {
          next[f.key] = '';
          changed.add(f.key);
          stable = false;
        }
      });
    }
    return next;
  });

  return (
    <form onSubmit={e => { e.preventDefault(); onSave(form); }} className="space-y-3">
      {error && <div className="text-danger text-small">{error}</div>}
      {fields.map(f => {
        // optionsFn(form) รองรับ cascading dropdown
        const opts = f.optionsFn ? f.optionsFn(form) : (f.options || []);
        const isDisabled = typeof f.disabled === 'function' ? f.disabled(initial) : !!f.disabled;
        const helpText = typeof f.help === 'function' ? f.help(form, initial) : f.help;
        return (
          <div key={f.key}>
            <label className="label">{f.label}{f.required && ' *'}</label>
            {f.computed ? (
              <input className="input bg-bg text-muted cursor-not-allowed" disabled
                value={f.computed(form, initial)} readOnly />
            ) : f.type === 'select' ? (
              <div className="flex gap-2 items-start">
                <select className="input" value={form[f.key] ?? ''} required={f.required} disabled={isDisabled}
                  onChange={e => set(f.key, e.target.value)}>
                  <option value="">{f.placeholder || '— เลือก —'}</option>
                  {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {f.creatable && !isDisabled && (
                  <QuickAddOption creatable={f.creatable} onCreated={v => set(f.key, v)} />
                )}
              </div>
            ) : (
              <input className="input" type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                value={form[f.key] ?? ''} required={f.required} placeholder={f.placeholder || ''} disabled={isDisabled}
                onChange={e => set(f.key, e.target.value)} />
            )}
            {helpText && <p className="text-small text-muted mt-1">{helpText}</p>}
          </div>
        );
      })}
      <div className="flex justify-end pt-2"><Button type="submit" loading={loading}>บันทึก</Button></div>
    </form>
  );
}

function ImportModal({ endpoint, queryKey, title, onClose }) {
  const qc = useQueryClient();
  const fileRef = useRef();
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');

  async function handleFile(f) {
    setFile(f);
    setPreview(null);
    setError('');
    setScanning(true);
    const fd = new FormData();
    fd.append('file', f);
    try {
      const r = await api.post(`${endpoint}/import?dryRun=1`, fd);
      setPreview(r.data);
    } catch (e) {
      setError(e.response?.data?.error || 'ไม่สามารถอ่านไฟล์ได้');
    } finally {
      setScanning(false);
    }
  }

  async function handleConfirm() {
    if (!file || !preview?.valid) return;
    setImporting(true);
    setError('');
    const fd = new FormData();
    fd.append('file', file);
    try {
      await api.post(`${endpoint}/import`, fd);
      qc.invalidateQueries({ queryKey: [queryKey] });
      onClose();
    } catch (e) {
      setError(e.response?.data?.error || 'นำเข้าไม่สำเร็จ');
    } finally {
      setImporting(false);
    }
  }

  const showRows = preview?.rows?.slice(0, 25) || [];

  return (
    <Modal open onClose={onClose} title={`นำเข้า ${title} (Excel)`}>
      <div className="space-y-3">
        <div>
          <label className="label">เลือกไฟล์ Excel (.xlsx)</label>
          <input ref={fileRef} type="file" accept=".xlsx"
            className="block w-full text-small border border-border rounded px-2 py-2"
            onChange={e => e.target.files[0] && handleFile(e.target.files[0])} />
        </div>

        {scanning && <div className="text-small text-muted">กำลังตรวจสอบไฟล์…</div>}
        {error && <div className="p-2 bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded text-danger text-small">{error}</div>}

        {preview && (
          <div className="space-y-2">
            <div className="flex gap-4 text-small p-2 bg-gray-50 dark:bg-gray-900 rounded">
              <span className="text-text font-medium">ทั้งหมด {preview.total} แถว</span>
              <span className="text-success">ถูกต้อง {preview.valid}</span>
              {preview.invalid > 0 && <span className="text-danger">ผิดพลาด {preview.invalid}</span>}
            </div>
            {preview.invalid > 0 && (
              <div className="max-h-44 overflow-y-auto border border-border rounded">
                <table className="w-full text-small">
                  <thead className="bg-gray-50 dark:bg-gray-900 sticky top-0">
                    <tr><th className="text-left px-2 py-1">แถว</th><th className="text-left px-2 py-1">ปัญหา</th></tr>
                  </thead>
                  <tbody>
                    {showRows.filter(r => !r.valid).map(r => (
                      <tr key={r.rowNum} className="border-t border-border bg-red-50 dark:bg-red-900">
                        <td className="px-2 py-1 font-mono">{r.rowNum}</td>
                        <td className="px-2 py-1 text-danger">{r.errors?.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {preview.valid > 0 && (
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="secondary" onClick={onClose}>ยกเลิก</Button>
                <Button loading={importing} onClick={handleConfirm}>
                  นำเข้า {preview.valid} รายการ
                </Button>
              </div>
            )}
            {preview.valid === 0 && (
              <div className="text-warning text-small">ไม่มีแถวที่สามารถนำเข้าได้ กรุณาตรวจสอบไฟล์</div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

// props:
//  title, endpoint, queryKey
//  columns: [{ key, label, render?(row), mono? }]
//  fields:  [{ key, label, type, required, options, placeholder, help }]
//  softDelete (default true)
//  exportable (default false) — adds Export Excel button
//  importable (default false) — adds Import Excel button + modal
//  extraActions: [{ label, onClick }]
export default function CrudPanel({
  title, endpoint, queryKey, columns, fields,
  softDelete = true, searchable = true,
  exportable = false, importable = false,
  extraActions = [],
}) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [showInactive, setShowInactive] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [confirmError, setConfirmError] = useState('');
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => { const t = setTimeout(() => { setDebounced(search); setPage(1); }, 300); return () => clearTimeout(t); }, [search]);
  useEffect(() => { setPage(1); }, [showInactive]);

  const { data: resp = {} } = useQuery({
    queryKey: [queryKey, page, debounced, showInactive],
    queryFn: () => api.get(endpoint, { params: { page, limit: PAGE_SIZE, q: debounced, ...(softDelete && !showInactive ? { active: '1' } : {}) } }).then(r => r.data),
  });
  const rows = resp.data || [];
  const total = resp.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const save = useMutation({
    mutationFn: (form) => editing ? api.patch(`${endpoint}/${editing.id}`, form) : api.post(endpoint, form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [queryKey] }); setModalOpen(false); setEditing(null); },
  });
  const toggle = useMutation({
    mutationFn: (id) => api.patch(`${endpoint}/${id}/toggle`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [queryKey] }); setConfirm(null); setConfirmError(''); },
    onError:   (e) => setConfirmError(e.response?.data?.error || 'เกิดข้อผิดพลาด'),
  });
  const remove = useMutation({
    mutationFn: (id) => api.delete(`${endpoint}/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [queryKey] }); setConfirm(null); setConfirmError(''); },
    onError:   (e) => setConfirmError(e.response?.data?.error || 'เกิดข้อผิดพลาด'),
  });

  async function handleExport() {
    try {
      await downloadExcel(`${endpoint}/export`, {}, `${title}.xlsx`);
    } catch {
      alert('Export ไม่สำเร็จ กรุณาลองใหม่');
    }
  }

  const cols = softDelete ? [...columns, { key: '__status', label: 'สถานะ', render: r => (
    <span className={`badge ${r.is_active ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200' : 'bg-gray-100 dark:bg-gray-900 text-gray-500 dark:text-gray-200'}`}>{r.is_active ? 'ใช้งาน' : 'ปิด'}</span>
  ) }] : columns;

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h2 className="text-h3 font-semibold text-text">{title}</h2>
        <div className="flex gap-2 flex-wrap items-center">
          {searchable && <input className="input max-w-xs" placeholder="ค้นหา..." value={search} onChange={e => setSearch(e.target.value)} />}
          {softDelete && (
            <label className="flex items-center gap-2 text-small text-muted cursor-pointer min-h-[44px]">
              <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />แสดงที่ปิด
            </label>
          )}
          {exportable && (
            <button className="px-3 py-2 text-small border border-border rounded text-muted hover:text-accent min-h-[44px]" onClick={handleExport}>
              Export Excel
            </button>
          )}
          {importable && (
            <button className="px-3 py-2 text-small border border-border rounded text-muted hover:text-accent min-h-[44px]" onClick={() => setImportOpen(true)}>
              Import Excel
            </button>
          )}
          <Button onClick={() => { setEditing(null); setModalOpen(true); }}>+ เพิ่ม</Button>
        </div>
      </div>

      <div className="table-container">
        <table className="table">
          <thead><tr>{cols.map(c => <th key={c.key}>{c.label}</th>)}<th>Action</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={cols.length + 1} className="text-center text-muted py-8">ไม่พบข้อมูล</td></tr>}
            {rows.map(r => (
              <tr key={r.id}>
                {cols.map(c => (
                  <td key={c.key} className={c.mono ? 'font-mono' : ''}>
                    {c.render ? c.render(r) : (r[c.key] ?? '-')}
                  </td>
                ))}
                <td>
                  <div className="flex gap-2 items-center">
                    <button className="text-accent text-small" onClick={() => { setEditing(r); setModalOpen(true); }}>แก้ไข</button>
                    {extraActions.map((a, i) => (
                      <button key={i} className="text-primary text-small" onClick={() => a.onClick(r)}>{a.label}</button>
                    ))}
                    {softDelete
                      ? <button className={`text-small ${r.is_active ? 'text-warning' : 'text-success'}`} onClick={() => setConfirm({ row: r, action: 'toggle' })}>{r.is_active ? 'ปิด' : 'เปิด'}</button>
                      : <button className="text-danger text-small" onClick={() => setConfirm({ row: r, action: 'delete' })}>ลบ</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} totalPages={totalPages} total={total} limit={PAGE_SIZE} onChange={setPage} />

      <Modal open={modalOpen} onClose={() => { setModalOpen(false); setEditing(null); }} title={editing ? `แก้ไข ${title}` : `เพิ่ม ${title}`}>
        <FormBody fields={fields} initial={editing} onSave={f => save.mutate(f)} loading={save.isPending} error={save.error?.response?.data?.error} />
      </Modal>

      <ConfirmDialog
        open={!!confirm}
        onClose={() => { setConfirm(null); setConfirmError(''); }}
        onConfirm={() => {
          setConfirmError('');
          confirm.action === 'toggle' ? toggle.mutate(confirm.row.id) : remove.mutate(confirm.row.id);
        }}
        message={confirm?.action === 'delete' ? `ต้องการลบรายการนี้?` : `ต้องการ${confirm?.row?.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}รายการนี้?`}
        confirmLabel={confirm?.action === 'delete' ? 'ลบ' : (confirm?.row?.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน')}
        variant={confirm?.action === 'delete' || confirm?.row?.is_active ? 'warning' : 'success'}
        loading={toggle.isPending || remove.isPending}
        error={confirmError}
      />

      {importOpen && (
        <ImportModal endpoint={endpoint} queryKey={queryKey} title={title} onClose={() => setImportOpen(false)} />
      )}
    </div>
  );
}
