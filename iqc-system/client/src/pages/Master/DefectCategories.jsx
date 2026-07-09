import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { downloadExcel } from '../../utils/api';
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
  const [form, setForm] = useState({ code: '', name: '', notes: '', ...initial });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  return (
    <form onSubmit={e => { e.preventDefault(); onSave(form); }} className="space-y-3">
      {error && <div className="text-danger text-small">{error}</div>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><label className="label">รหัส</label><input className="input" value={form.code} onChange={e => set('code', e.target.value)} /></div>
        <div><label className="label">ชื่อกลุ่มปัญหา *</label><input className="input" value={form.name} onChange={e => set('name', e.target.value)} required /></div>
      </div>
      <div><label className="label">หมายเหตุ</label><textarea className="input" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} /></div>
      <div className="flex justify-end pt-2"><Button type="submit" loading={loading}>บันทึก</Button></div>
    </form>
  );
}

export default function DefectCategories() {
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
      await downloadExcel('/master/defect-categories/export', {}, 'defect_categories_template.xlsx');
    } catch { alert('Export ไม่สำเร็จ'); }
  }

  const { data: resp = {} } = useQuery({
    queryKey: ['defect-categories', showAll, page, debouncedSearch],
    queryFn: () => api.get('/master/defect-categories', { params: { page, limit: PAGE_SIZE, q: debouncedSearch, ...(showAll ? { all: '1' } : {}) } }).then(r => r.data),
  });
  const rows = resp.data || [];
  const totalRows = resp.total || 0;
  const totalPages = Math.ceil(totalRows / PAGE_SIZE);

  const save = useMutation({
    mutationFn: (form) => editing ? api.patch(`/master/defect-categories/${editing.id}`, form) : api.post('/master/defect-categories', form),
    onSuccess: () => { qc.invalidateQueries(['defect-categories']); setModalOpen(false); setEditing(null); },
  });
  const toggle = useMutation({
    mutationFn: (id) => api.patch(`/master/defect-categories/${id}/toggle`),
    onSuccess: () => { qc.invalidateQueries(['defect-categories']); setConfirmToggle(null); },
  });

  const { sorted, onSort, sortKey, sortDir } = useSortable(rows, 'name');

  return (
    <div>
      <h1 className="text-h2 font-bold text-text mb-4">กลุ่มปัญหา</h1>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <input className="input max-w-xs" placeholder="ค้นหา..." value={search} onChange={e => setSearch(e.target.value)} />
        <div className="flex gap-2 flex-wrap items-center">
          <label className="flex items-center gap-2 text-small text-muted cursor-pointer min-h-[44px]">
            <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />แสดงที่ปิดใช้งาน
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
      {/* ── Mobile cards ── */}
      <div className="md:hidden space-y-2 mb-4">
        {rows.length === 0 && <p className="text-center text-muted py-8 text-body">ไม่พบข้อมูล</p>}
        {sorted.map(r => (
          <div key={r.id} className="bg-surface border border-border rounded-lg p-3">
            <div className="flex items-start justify-between gap-2 mb-1">
              <div>
                {r.code && <span className="font-mono text-[12px] text-muted mr-1">{r.code} ·</span>}
                <span className={`font-semibold text-body ${r.is_active ? 'text-text' : 'text-muted'}`}>{r.name}</span>
              </div>
              <span className={`badge flex-shrink-0 ${r.is_active ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200' : 'bg-gray-100 dark:bg-gray-900 text-gray-500 dark:text-gray-200'}`}>
                {r.is_active ? 'ใช้งาน' : 'ปิด'}
              </span>
            </div>
            {r.notes && <p className="text-[12px] text-muted mb-2">{r.notes}</p>}
            <div className="flex gap-2 pt-2 border-t border-border">
              <button onClick={() => { setEditing(r); setModalOpen(true); }}
                className="flex-1 min-h-[44px] rounded-lg border border-border text-body text-text flex items-center justify-center hover:bg-bg">
                แก้ไข
              </button>
              <div className="flex items-center justify-center min-w-[48px]">
                <ToggleSwitch active={r.is_active} onClick={() => setConfirmToggle(r)} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Desktop table ── */}
      <div className="hidden md:block table-container">
        <table className="table">
          <thead><tr>
            <SortTh col="code"      sortKey={sortKey} sortDir={sortDir} onSort={onSort}>รหัส</SortTh>
            <SortTh col="name"      sortKey={sortKey} sortDir={sortDir} onSort={onSort}>ชื่อกลุ่มปัญหา</SortTh>
            <th>หมายเหตุ</th>
            <SortTh col="is_active" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>สถานะ</SortTh>
            <th>Action</th>
          </tr></thead>
          <tbody>
            {sorted.map(r => (
              <tr key={r.id} className="cursor-default">
                <td className="font-mono">{r.code || '-'}</td>
                <td className={r.is_active ? '' : 'text-muted'}>{r.name}</td>
                <td>{r.notes || '-'}</td>
                <td><span className={`badge ${r.is_active ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200' : 'bg-gray-100 dark:bg-gray-900 text-gray-500 dark:text-gray-200'}`}>{r.is_active ? 'ใช้งาน' : 'ปิดใช้งาน'}</span></td>
                <td>
                  <div className="flex gap-2 items-center justify-center">
                    <EditButton onClick={() => { setEditing(r); setModalOpen(true); }} />
                    <ToggleSwitch active={r.is_active} onClick={() => setConfirmToggle(r)} />
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="text-center text-muted py-8">ไม่พบข้อมูล</td></tr>}
          </tbody>
        </table>
      </div>
      <Pagination page={page} totalPages={totalPages} total={totalRows} limit={PAGE_SIZE} onChange={setPage} />
      <Modal open={modalOpen} onClose={() => { setModalOpen(false); setEditing(null); }} title={editing ? 'แก้ไขกลุ่มปัญหา' : 'เพิ่มกลุ่มปัญหา'}>
        <Form initial={editing || {}} onSave={f => save.mutate(f)} loading={save.isPending} error={save.error?.response?.data?.error} />
      </Modal>
      <ConfirmDialog open={!!confirmToggle} onClose={() => setConfirmToggle(null)} onConfirm={() => toggle.mutate(confirmToggle.id)} message={`ต้องการ${confirmToggle?.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'} "${confirmToggle?.name}"`} confirmLabel={confirmToggle?.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'} variant={confirmToggle?.is_active ? 'warning' : 'success'} loading={toggle.isPending} />
      <ExcelImportModal
        open={importOpen} onClose={() => setImportOpen(false)}
        title="Import กลุ่มปัญหา" apiPath="/master/defect-categories"
        onDone={() => qc.invalidateQueries(['defect-categories'])}
      />
    </div>
  );
}
