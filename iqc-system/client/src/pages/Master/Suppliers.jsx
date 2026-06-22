import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../utils/api';
import Button from '../../components/UI/Button';
import Modal from '../../components/UI/Modal';
import ConfirmDialog from '../../components/UI/ConfirmDialog';
import SortTh from '../../components/UI/SortTh';
import ToggleSwitch from '../../components/UI/ToggleSwitch';
import EditButton from '../../components/UI/EditButton';
import { useSortable } from '../../hooks/useSortable';
import ExcelImportModal from '../../components/UI/ExcelImportModal';
import Pagination from '../../components/UI/Pagination';

function SupplierForm({ initial = {}, onSave, loading }) {
  const [form, setForm] = useState({ code: '', name: '', email: '', phone: '', notes: '', ...initial });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  function handleSubmit(e) {
    e.preventDefault();
    onSave(form);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">รหัสผู้ผลิต</label>
          <input className="input" value={form.code} onChange={e => set('code', e.target.value)} placeholder="SUP001" />
        </div>
        <div>
          <label className="label">ชื่อผู้ผลิต *</label>
          <input className="input" value={form.name} onChange={e => set('name', e.target.value)} required />
        </div>
      </div>
      <div>
        <label className="label">อีเมล</label>
        <input type="email" className="input" value={form.email} onChange={e => set('email', e.target.value)} />
      </div>
      <div>
        <label className="label">เบอร์โทร</label>
        <input className="input" value={form.phone} onChange={e => set('phone', e.target.value)} />
      </div>
      <div>
        <label className="label">หมายเหตุ</label>
        <textarea className="input" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="submit" loading={loading}>บันทึก</Button>
      </div>
    </form>
  );
}

const PAGE_SIZE = 20;

export default function Suppliers() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmToggle, setConfirmToggle] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => { setPage(1); }, [showAll]);

  async function handleExport() {
    try {
      const res = await api.get('/master/suppliers/export', { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a'); a.href = url; a.download = 'suppliers_template.xlsx'; a.click();
      URL.revokeObjectURL(url);
    } catch { alert('Export ไม่สำเร็จ'); }
  }

  const { data: resp = {}, isLoading } = useQuery({
    queryKey: ['suppliers', showAll, page, debouncedSearch],
    queryFn: () => api.get('/master/suppliers', { params: { page, limit: PAGE_SIZE, q: debouncedSearch, ...(showAll ? { all: '1' } : {}) } }).then(r => r.data),
  });
  const rows = resp.data || [];
  const totalRows = resp.total || 0;
  const totalPages = Math.ceil(totalRows / PAGE_SIZE);

  const save = useMutation({
    mutationFn: (form) => editing
      ? api.patch(`/master/suppliers/${editing.id}`, form)
      : api.post('/master/suppliers', form),
    onSuccess: () => { qc.invalidateQueries(['suppliers']); setModalOpen(false); setEditing(null); },
  });

  const toggle = useMutation({
    mutationFn: (id) => api.patch(`/master/suppliers/${id}/toggle`),
    onSuccess: () => { qc.invalidateQueries(['suppliers']); setConfirmToggle(null); },
  });

  const { sorted, onSort, sortKey, sortDir } = useSortable(rows, 'name');

  return (
    <div>
      <h1 className="text-h2 font-bold text-text mb-4">ผู้ผลิต</h1>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <input className="input max-w-xs" placeholder="ค้นหา..." value={search} onChange={e => setSearch(e.target.value)} />
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
          <Button onClick={() => { setEditing(null); setModalOpen(true); }}>+ เพิ่ม</Button>
        </div>
      </div>

      <div className="table-container">
        <table className="table">
          <thead><tr>
            <SortTh col="code"  sortKey={sortKey} sortDir={sortDir} onSort={onSort}>รหัส</SortTh>
            <SortTh col="name"  sortKey={sortKey} sortDir={sortDir} onSort={onSort}>ชื่อผู้ผลิต</SortTh>
            <SortTh col="email" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>อีเมล</SortTh>
            <SortTh col="phone" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>เบอร์โทร</SortTh>
            <SortTh col="is_active" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>สถานะ</SortTh>
            <th>Action</th>
          </tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} className="text-center py-4 text-muted">กำลังโหลด...</td></tr>}
            {sorted.map(r => (
              <tr key={r.id} className="cursor-default">
                <td className="font-mono">{r.code || '-'}</td>
                <td className={r.is_active ? '' : 'text-muted'}>{r.name} {!r.is_active && <span className="badge bg-gray-100 text-gray-500 ml-1">ปิดใช้งาน</span>}</td>
                <td>{r.email || '-'}</td>
                <td>{r.phone || '-'}</td>
                <td><span className={`badge ${r.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{r.is_active ? 'ใช้งาน' : 'ปิดใช้งาน'}</span></td>
                <td>
                  <div className="flex gap-2 items-center justify-center">
                    <EditButton onClick={() => { setEditing(r); setModalOpen(true); }} />
                    <ToggleSwitch active={r.is_active} onClick={() => setConfirmToggle(r)} />
                  </div>
                </td>
              </tr>
            ))}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={6} className="text-center text-muted py-8">ไม่พบข้อมูล</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination page={page} totalPages={totalPages} total={totalRows} limit={PAGE_SIZE} onChange={setPage} />

      <Modal open={modalOpen} onClose={() => { setModalOpen(false); setEditing(null); }} title={editing ? 'แก้ไขผู้ผลิต' : 'เพิ่มผู้ผลิต'}>
        {save.error && <div className="text-danger text-small mb-2">{save.error.response?.data?.error}</div>}
        <SupplierForm initial={editing || {}} onSave={f => save.mutate(f)} loading={save.isPending} />
      </Modal>

      <ConfirmDialog
        open={!!confirmToggle}
        onClose={() => setConfirmToggle(null)}
        onConfirm={() => toggle.mutate(confirmToggle.id)}
        title="ยืนยัน"
        message={`ต้องการ${confirmToggle?.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'} "${confirmToggle?.name}" ใช่หรือไม่`}
        confirmLabel={confirmToggle?.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
        variant={confirmToggle?.is_active ? 'warning' : 'success'}
        loading={toggle.isPending}
      />
      <ExcelImportModal
        open={importOpen} onClose={() => setImportOpen(false)}
        title="Import ผู้ผลิต" apiPath="/master/suppliers"
        onDone={() => qc.invalidateQueries(['suppliers'])}
      />
    </div>
  );
}
