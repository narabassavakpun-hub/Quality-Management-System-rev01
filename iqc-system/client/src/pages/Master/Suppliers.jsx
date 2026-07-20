import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { downloadExcel } from '../../utils/api';
import Button from '../../components/UI/Button';
import Modal from '../../components/UI/Modal';
import ConfirmDialog from '../../components/UI/ConfirmDialog';
import SortTh from '../../components/UI/SortTh';
import ToggleSwitch from '../../components/UI/ToggleSwitch';
import EditButton from '../../components/UI/EditButton';
import { useSortable } from '../../hooks/useSortable';
import ExcelImportModal from '../../components/UI/ExcelImportModal';
import Pagination from '../../components/UI/Pagination';
import { useAuth } from '../../contexts/AuthContext';

function SupplierForm({ initial = {}, onSave, loading, purchasingUsers = [], productGroups = [] }) {
  const [form, setForm] = useState({
    code: '', name: '', email: '', phone: '', notes: '',
    ...initial,
    purchasing_user_ids: (initial.purchasing_user_ids || []).map(String),
    product_group_ids: (initial.product_group_ids || []).map(String),
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  function handleSubmit(e) {
    e.preventDefault();
    onSave(form);
  }

  const allPurchasingIds = purchasingUsers.map(u => String(u.id));
  const allSelected = allPurchasingIds.length > 0 && allPurchasingIds.every(id => form.purchasing_user_ids.includes(id));

  const allGroupIds = productGroups.map(g => String(g.id));
  const allGroupsSelected = allGroupIds.length > 0 && allGroupIds.every(id => form.product_group_ids.includes(id));

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
      <div>
        <div className="flex items-center justify-between">
          <label className="label mb-0">
            กลุ่มสินค้าที่ผลิต/ส่งได้
            <span className="ml-1 text-[12px] text-muted font-normal">(เลือกได้มากกว่า 1)</span>
          </label>
          {productGroups.length > 0 && (
            <button
              type="button"
              onClick={() => set('product_group_ids', allGroupsSelected ? [] : allGroupIds)}
              className="text-[12px] text-accent hover:underline"
            >
              {allGroupsSelected ? 'ยกเลิกทั้งหมด' : 'เลือกทั้งหมด'}
            </button>
          )}
        </div>
        {productGroups.length === 0 ? (
          <p className="text-small text-muted italic mt-1">ยังไม่มีกลุ่มสินค้าในระบบ</p>
        ) : (
          <div className="flex flex-wrap gap-2 mt-1 p-2 border border-border rounded-md bg-bg min-h-[48px]">
            {productGroups.map(g => {
              const gid = String(g.id);
              const selected = form.product_group_ids.includes(gid);
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => {
                    const ids = selected
                      ? form.product_group_ids.filter(id => id !== gid)
                      : [...form.product_group_ids, gid];
                    set('product_group_ids', ids);
                  }}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-small transition-all min-h-[34px] ${
                    selected
                      ? 'border-primary bg-primary/10 text-primary font-semibold shadow-sm'
                      : 'border-border bg-surface text-muted hover:border-accent hover:text-accent'
                  }`}
                >
                  {selected && (
                    <svg className="w-3 h-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                    </svg>
                  )}
                  {g.name}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div>
        <div className="flex items-center justify-between">
          <label className="label mb-0">
            ผู้ดูแลจัดซื้อ
            <span className="ml-1 text-[12px] text-muted font-normal">(เลือกได้มากกว่า 1)</span>
          </label>
          {purchasingUsers.length > 0 && (
            <button
              type="button"
              onClick={() => set('purchasing_user_ids', allSelected ? [] : allPurchasingIds)}
              className="text-[12px] text-accent hover:underline"
            >
              {allSelected ? 'ยกเลิกจัดซื้อทั้งหมด' : 'เลือกจัดซื้อทั้งหมด'}
            </button>
          )}
        </div>
        {purchasingUsers.length === 0 ? (
          <p className="text-small text-muted italic mt-1">ยังไม่มี user บทบาทจัดซื้อในระบบ</p>
        ) : (
          <div className="flex flex-wrap gap-2 mt-1 p-2 border border-border rounded-md bg-bg min-h-[48px]">
            {purchasingUsers.map(u => {
              const uid = String(u.id);
              const selected = form.purchasing_user_ids.includes(uid);
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => {
                    const ids = selected
                      ? form.purchasing_user_ids.filter(id => id !== uid)
                      : [...form.purchasing_user_ids, uid];
                    set('purchasing_user_ids', ids);
                  }}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-small transition-all min-h-[34px] ${
                    selected
                      ? 'border-primary bg-primary/10 text-primary font-semibold shadow-sm'
                      : 'border-border bg-surface text-muted hover:border-accent hover:text-accent'
                  }`}
                >
                  {selected && (
                    <svg className="w-3 h-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                    </svg>
                  )}
                  {u.full_name}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="submit" loading={loading}>บันทึก</Button>
      </div>
    </form>
  );
}

const PAGE_SIZE = 20;

export default function Suppliers() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmToggle, setConfirmToggle] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // Master List filter สำหรับจัดซื้อ (ไม่ใช่ admin/purchasing_manager) — กรองเฉพาะเจ้าที่ตัวเองดูแล หรือเจ้าที่ยัง
  // ไม่มีใคร @ เลย — admin/purchasing_manager เห็นทั้งหมดเหมือนเดิม (ไม่แสดง filter นี้ให้)
  const isPlainPurchasing = user?.role === 'purchasing';
  const [assignFilter, setAssignFilter] = useState('all'); // all | mine | unassigned
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => { setPage(1); }, [showAll, assignFilter]);

  async function handleExport() {
    try {
      await downloadExcel('/master/suppliers/export', {}, 'suppliers_template.xlsx');
    } catch { alert('Export ไม่สำเร็จ'); }
  }

  const { data: resp = {}, isLoading } = useQuery({
    queryKey: ['suppliers', showAll, page, debouncedSearch, isPlainPurchasing ? assignFilter : 'all'],
    queryFn: () => api.get('/master/suppliers', {
      params: {
        page, limit: PAGE_SIZE, q: debouncedSearch,
        ...(showAll ? { all: '1' } : {}),
        ...(isPlainPurchasing && assignFilter === 'mine' ? { assigned_to: user.id } : {}),
        ...(isPlainPurchasing && assignFilter === 'unassigned' ? { unassigned: '1' } : {}),
      },
    }).then(r => r.data),
  });
  const rows = resp.data || [];
  const totalRows = resp.total || 0;
  const totalPages = Math.ceil(totalRows / PAGE_SIZE);

  const { data: purchasingUsers = [] } = useQuery({
    queryKey: ['master-purchasing-users'],
    queryFn: () => api.get('/master/purchasing-users').then(r => r.data),
  });

  const { data: productGroups = [] } = useQuery({
    queryKey: ['product-groups'],
    queryFn: () => api.get('/master/product-groups').then(r => r.data),
  });

  const save = useMutation({
    mutationFn: (form) => {
      const payload = {
        ...form,
        purchasing_user_ids: (form.purchasing_user_ids || []).map(Number),
        product_group_ids: (form.product_group_ids || []).map(Number),
      };
      return editing
        ? api.patch(`/master/suppliers/${editing.id}`, payload)
        : api.post('/master/suppliers', payload);
    },
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
        <div className="flex gap-2 flex-wrap items-center">
          <input className="input max-w-xs" placeholder="ค้นหา..." value={search} onChange={e => setSearch(e.target.value)} />
          {isPlainPurchasing && (
            <select className="input w-auto" value={assignFilter} onChange={e => setAssignFilter(e.target.value)}>
              <option value="all">ผู้ผลิตทั้งหมด</option>
              <option value="mine">ที่ฉันดูแล</option>
              <option value="unassigned">ยังไม่มีผู้ดูแล</option>
            </select>
          )}
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <label className="flex items-center gap-2 text-small text-muted cursor-pointer min-h-[44px]">
            <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
            แสดงที่ปิดใช้งาน
          </label>
          {isAdmin && (
            <>
              <button onClick={handleExport} className="inline-flex items-center gap-1.5 px-3 py-2 border border-border rounded-md text-small text-muted bg-surface hover:bg-bg min-h-[44px] transition-colors">
                <svg className="w-4 h-4 text-success flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                Export
              </button>
              <button onClick={() => setImportOpen(true)} className="inline-flex items-center gap-1.5 px-3 py-2 border border-border rounded-md text-small text-muted bg-surface hover:bg-bg min-h-[44px] transition-colors">
                <svg className="w-4 h-4 text-accent flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l4-4m0 0l4 4m-4-4v12" /></svg>
                Import
              </button>
            </>
          )}
          <Button onClick={() => { setEditing(null); setModalOpen(true); }}>+ เพิ่ม</Button>
        </div>
      </div>

      {/* ── Mobile cards ── */}
      <div className="md:hidden space-y-2 mb-4">
        {isLoading && <p className="text-center text-muted py-4 text-body">กำลังโหลด...</p>}
        {!isLoading && rows.length === 0 && <p className="text-center text-muted py-8 text-body">ไม่พบข้อมูล</p>}
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
            {(r.email || r.phone) && (
              <div className="text-[12px] text-muted mb-2 space-x-3">
                {r.email && <span>{r.email}</span>}
                {r.phone && <span>{r.phone}</span>}
              </div>
            )}
            {r.purchasing_assignees?.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {r.purchasing_assignees.map(a => (
                  <span key={a.user_id} className="badge bg-blue-50 dark:bg-blue-900 text-blue-700 dark:text-blue-200">{a.full_name}</span>
                ))}
              </div>
            )}
            {r.product_groups?.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {r.product_groups.map(g => (
                  <span key={g.group_id} className="badge bg-purple-50 dark:bg-purple-900 text-purple-700 dark:text-purple-200">{g.name}</span>
                ))}
              </div>
            )}
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
            <SortTh col="code"  sortKey={sortKey} sortDir={sortDir} onSort={onSort}>รหัส</SortTh>
            <SortTh col="name"  sortKey={sortKey} sortDir={sortDir} onSort={onSort}>ชื่อผู้ผลิต</SortTh>
            <SortTh col="email" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>อีเมล</SortTh>
            <SortTh col="phone" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>เบอร์โทร</SortTh>
            <th>ผู้ดูแลจัดซื้อ</th>
            <th>กลุ่มสินค้า</th>
            <SortTh col="is_active" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>สถานะ</SortTh>
            <th>Action</th>
          </tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={8} className="text-center py-4 text-muted">กำลังโหลด...</td></tr>}
            {sorted.map(r => (
              <tr key={r.id} className="cursor-default">
                <td className="font-mono">{r.code || '-'}</td>
                <td className={r.is_active ? '' : 'text-muted'}>{r.name} {!r.is_active && <span className="badge bg-gray-100 dark:bg-gray-900 text-gray-500 dark:text-gray-200 ml-1">ปิดใช้งาน</span>}</td>
                <td>{r.email || '-'}</td>
                <td>{r.phone || '-'}</td>
                <td>
                  {r.purchasing_assignees?.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {r.purchasing_assignees.map(a => (
                        <span key={a.user_id} className="badge bg-blue-50 dark:bg-blue-900 text-blue-700 dark:text-blue-200">{a.full_name}</span>
                      ))}
                    </div>
                  ) : '-'}
                </td>
                <td>
                  {r.product_groups?.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {r.product_groups.map(g => (
                        <span key={g.group_id} className="badge bg-purple-50 dark:bg-purple-900 text-purple-700 dark:text-purple-200">{g.name}</span>
                      ))}
                    </div>
                  ) : '-'}
                </td>
                <td><span className={`badge ${r.is_active ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200' : 'bg-gray-100 dark:bg-gray-900 text-gray-500 dark:text-gray-200'}`}>{r.is_active ? 'ใช้งาน' : 'ปิดใช้งาน'}</span></td>
                <td>
                  <div className="flex gap-2 items-center justify-center">
                    <EditButton onClick={() => { setEditing(r); setModalOpen(true); }} />
                    <ToggleSwitch active={r.is_active} onClick={() => setConfirmToggle(r)} />
                  </div>
                </td>
              </tr>
            ))}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={8} className="text-center text-muted py-8">ไม่พบข้อมูล</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination page={page} totalPages={totalPages} total={totalRows} limit={PAGE_SIZE} onChange={setPage} />

      <Modal open={modalOpen} onClose={() => { setModalOpen(false); setEditing(null); }} title={editing ? 'แก้ไขผู้ผลิต' : 'เพิ่มผู้ผลิต'}>
        {save.error && <div className="text-danger text-small mb-2">{save.error.response?.data?.error}</div>}
        <SupplierForm initial={editing || {}} onSave={f => save.mutate(f)} loading={save.isPending} purchasingUsers={purchasingUsers} productGroups={productGroups} />
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
