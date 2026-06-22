import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../utils/api';
import ExcelImportModal from '../../components/UI/ExcelImportModal';
import Button from '../../components/UI/Button';
import Modal from '../../components/UI/Modal';
import ConfirmDialog from '../../components/UI/ConfirmDialog';
import SortTh from '../../components/UI/SortTh';
import ToggleSwitch from '../../components/UI/ToggleSwitch';
import EditButton from '../../components/UI/EditButton';
import { useSortable } from '../../hooks/useSortable';
import Pagination from '../../components/UI/Pagination';

const PAGE_SIZE = 20;

function Form({ initial = {}, onSave, loading, error }) {
  const [form, setForm] = useState({ code: '', name: '', hex_code: '#000000', ...initial });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  return (
    <form onSubmit={e => { e.preventDefault(); onSave(form); }} className="space-y-3">
      {error && <div className="text-danger text-small">{error}</div>}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">รหัสสี</label>
          <input className="input" value={form.code} onChange={e => set('code', e.target.value)} placeholder="เช่น RED, BLU-01" />
        </div>
        <div>
          <label className="label">ชื่อสี *</label>
          <input className="input" value={form.name} onChange={e => set('name', e.target.value)} required placeholder="เช่น แดง, น้ำเงิน" />
        </div>
      </div>

      <div>
        <label className="label">รหัสสี Hex</label>
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={form.hex_code || '#000000'}
            onChange={e => set('hex_code', e.target.value)}
            className="w-12 h-10 rounded border border-border cursor-pointer p-0.5 bg-white"
          />
          <input
            className="input flex-1 font-mono uppercase"
            value={form.hex_code || ''}
            onChange={e => set('hex_code', e.target.value)}
            placeholder="#000000"
            maxLength={7}
          />
          {form.hex_code && (
            <div
              className="w-10 h-10 rounded border border-border flex-shrink-0"
              style={{ backgroundColor: form.hex_code }}
            />
          )}
        </div>
        <p className="text-[11px] text-muted mt-1">รูปแบบ: #RRGGBB เช่น #FF0000 = สีแดง</p>
      </div>

      <div className="flex justify-end pt-2">
        <Button type="submit" loading={loading}>บันทึก</Button>
      </div>
    </form>
  );
}

export default function Colors() {
  const qc = useQueryClient();
  const [search, setSearch]           = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage]               = useState(1);
  const [modalOpen, setModalOpen]     = useState(false);
  const [editing, setEditing]         = useState(null);
  const [confirmToggle, setConfirmToggle] = useState(null);
  const [showAll, setShowAll]         = useState(false);
  const [importOpen, setImportOpen]   = useState(false);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => { setPage(1); }, [showAll]);

  async function handleExport() {
    try {
      const res = await api.get('/master/colors/export', { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a'); a.href = url; a.download = 'colors_template.xlsx'; a.click();
      URL.revokeObjectURL(url);
    } catch { alert('Export ไม่สำเร็จ'); }
  }

  const { data: resp = {} } = useQuery({
    queryKey: ['colors', showAll, page, debouncedSearch],
    queryFn: () => api.get('/master/colors', { params: { page, limit: PAGE_SIZE, q: debouncedSearch, ...(showAll ? { all: '1' } : {}) } }).then(r => r.data),
  });
  const rows = resp.data || [];
  const totalRows = resp.total || 0;
  const totalPages = Math.ceil(totalRows / PAGE_SIZE);

  const save = useMutation({
    mutationFn: (form) => editing
      ? api.patch(`/master/colors/${editing.id}`, form)
      : api.post('/master/colors', form),
    onSuccess: () => {
      qc.invalidateQueries(['colors']);
      setModalOpen(false);
      setEditing(null);
    },
  });

  const toggle = useMutation({
    mutationFn: (id) => api.patch(`/master/colors/${id}/toggle`),
    onSuccess: () => { qc.invalidateQueries(['colors']); setConfirmToggle(null); },
  });

  const { sorted, onSort, sortKey, sortDir } = useSortable(rows, 'name');

  return (
    <div>
      <h1 className="text-h2 font-bold text-text mb-4">สีสินค้า</h1>

      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <input
          className="input max-w-xs"
          placeholder="ค้นหาสี..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="flex gap-2 flex-wrap items-center">
          <label className="flex items-center gap-2 text-small text-muted cursor-pointer min-h-[44px]">
            <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
            แสดงที่ปิดใช้งาน
          </label>
          <button onClick={handleExport} className="inline-flex items-center gap-1.5 px-3 py-2 border border-border rounded-md text-small text-muted bg-surface hover:bg-bg min-h-[44px] transition-colors">
            <svg className="w-4 h-4 text-success flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            Export
          </button>
          <button onClick={() => setImportOpen(true)} className="inline-flex items-center gap-1.5 px-3 py-2 border border-border rounded-md text-small text-muted bg-surface hover:bg-bg min-h-[44px] transition-colors">
            <svg className="w-4 h-4 text-accent flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l4-4m0 0l4 4m-4-4v12" /></svg>
            Import
          </button>
          <Button onClick={() => { setEditing(null); setModalOpen(true); }}>+ เพิ่มสี</Button>
        </div>
      </div>

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>ตัวอย่าง</th>
              <SortTh col="code"      sortKey={sortKey} sortDir={sortDir} onSort={onSort}>รหัส</SortTh>
              <SortTh col="name"      sortKey={sortKey} sortDir={sortDir} onSort={onSort}>ชื่อสี</SortTh>
              <SortTh col="hex_code"  sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Hex Code</SortTh>
              <SortTh col="is_active" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>สถานะ</SortTh>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(r => (
              <tr key={r.id} className="cursor-default">
                <td>
                  <div
                    className="w-8 h-8 rounded-full border border-border shadow-inner mx-auto"
                    style={{ backgroundColor: r.hex_code || '#e5e7eb' }}
                    title={r.hex_code}
                  />
                </td>
                <td className="font-mono text-small">{r.code || '-'}</td>
                <td className={r.is_active ? 'font-medium' : 'text-muted'}>{r.name}</td>
                <td className="font-mono text-small">
                  {r.hex_code ? (
                    <span className="flex items-center justify-center gap-1.5">
                      <span className="inline-block w-3 h-3 rounded border border-border" style={{ backgroundColor: r.hex_code }} />
                      {r.hex_code.toUpperCase()}
                    </span>
                  ) : '-'}
                </td>
                <td>
                  <span className={`badge ${r.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {r.is_active ? 'ใช้งาน' : 'ปิดใช้งาน'}
                  </span>
                </td>
                <td>
                  <div className="flex gap-2 items-center justify-center">
                    <EditButton onClick={() => { setEditing(r); setModalOpen(true); }} />
                    <ToggleSwitch active={r.is_active} onClick={() => setConfirmToggle(r)} />
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="text-center text-muted py-8">ไม่พบข้อมูลสี</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination page={page} totalPages={totalPages} total={totalRows} limit={PAGE_SIZE} onChange={setPage} />

      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditing(null); }}
        title={editing ? `แก้ไขสี — ${editing.name}` : 'เพิ่มสีใหม่'}
      >
        <Form
          initial={editing || {}}
          onSave={f => save.mutate(f)}
          loading={save.isPending}
          error={save.error?.response?.data?.error}
        />
      </Modal>

      <ConfirmDialog
        open={!!confirmToggle}
        onClose={() => setConfirmToggle(null)}
        onConfirm={() => toggle.mutate(confirmToggle.id)}
        message={`ต้องการ${confirmToggle?.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'} สี "${confirmToggle?.name}"`}
        confirmLabel={confirmToggle?.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
        variant={confirmToggle?.is_active ? 'warning' : 'success'}
        loading={toggle.isPending}
      />
      <ExcelImportModal
        open={importOpen} onClose={() => setImportOpen(false)}
        title="Import สีสินค้า" apiPath="/master/colors"
        onDone={() => qc.invalidateQueries(['colors'])}
      />
    </div>
  );
}
