import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import Button from '../../components/UI/Button';
import Modal from '../../components/UI/Modal';
import ConfirmDialog from '../../components/UI/ConfirmDialog';
import SortTh from '../../components/UI/SortTh';
import ToggleSwitch from '../../components/UI/ToggleSwitch';
import EditButton from '../../components/UI/EditButton';
import { useSortable } from '../../hooks/useSortable';
import { ROLE_LABELS, CREATABLE_ROLES } from '../../utils/rolePermissions';

const QC_STATIONS = [
  { value: 'incoming',    label: 'QC รับเข้า' },
  { value: 'plant1',     label: 'QC โรง1' },
  { value: 'plant2',     label: 'QC โรง2' },
  { value: 'plant4',     label: 'QC โรง4' },
  { value: 'special',    label: 'QC บานพิเศษ' },
  { value: 'calibration',label: 'QC Calibration' },
  { value: 'qc_admin',   label: 'QC Admin' },
  { value: 'supervisor', label: 'QC Supervisor' },
];
const QC_ROLES = ['qc_staff', 'qc_supervisor'];
const roleLabel = (r) => ROLE_LABELS[r] || r;

const ROLE_COLORS = {
  admin:              'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-200',
  qc_staff:          'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200',
  qc_supervisor:     'bg-cyan-100 dark:bg-cyan-900 text-cyan-700 dark:text-cyan-200',
  qc_manager:        'bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-200',
  qmr:               'bg-teal-100 dark:bg-teal-900 text-teal-700 dark:text-teal-200',
  purchasing:        'bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-200',
  cco:               'bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-200',
  cmo:               'bg-rose-100 dark:bg-rose-900 text-rose-700 dark:text-rose-200',
  cpo:               'bg-pink-100 dark:bg-pink-900 text-pink-700 dark:text-pink-200',
  production_manager:'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200',
};

function UserForm({ initial = {}, onSave, loading, error }) {
  const isEdit = !!initial.id;
  const [form, setForm] = useState({
    username: '',
    full_name: '',
    role: 'qc_staff',
    qc_station: '',
    ...initial,
    telegram_chat_id: initial.telegram_chat_id || '',
    password: '',
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const isQcRole = QC_ROLES.includes(form.role);

  return (
    <form onSubmit={e => { e.preventDefault(); onSave(form); }} className="space-y-3">
      {error && <div className="text-danger text-small">{error}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">ชื่อผู้ใช้ (Username) *</label>
          <input
            className="input font-mono"
            value={form.username}
            onChange={e => set('username', e.target.value)}
            required
            placeholder="เช่น qc_staff1"
          />
        </div>
        <div>
          <label className="label">ชื่อ-นามสกุล *</label>
          <input
            className="input"
            value={form.full_name}
            onChange={e => set('full_name', e.target.value)}
            required
            placeholder="เช่น สมชาย ใจดี"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">บทบาท *</label>
          <select className="input" value={form.role} onChange={e => { set('role', e.target.value); if (!QC_ROLES.includes(e.target.value)) set('qc_station', ''); }} required>
            {CREATABLE_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        {!isEdit && (
          <div>
            <label className="label">รหัสผ่าน * (อย่างน้อย 8 ตัว)</label>
            <input
              type="password"
              className="input"
              value={form.password}
              onChange={e => set('password', e.target.value)}
              required
              minLength={8}
              placeholder="รหัสผ่านเริ่มต้น"
            />
          </div>
        )}
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
        <div className="pr-3">
          <label className="label mb-0">เข้าสู่ระบบด้วย Active Directory</label>
          <p className="text-[12px] text-muted mt-0.5">
            รหัสผ่านของระบบใช้ได้อยู่แล้วเสมอ — เปิดสวิตช์นี้เพิ่มถ้า user คนนี้มีบัญชี AD และต้องการให้ login ด้วย AD ได้ด้วย
            (ต้องตั้งค่า AD ให้เรียบร้อยที่ จัดการระบบ &gt; ตั้งค่าระบบ &gt; Authentication ก่อน)
          </p>
        </div>
        <ToggleSwitch
          active={form.auth_provider === 'ad'}
          onClick={() => set('auth_provider', form.auth_provider === 'ad' ? 'local' : 'ad')}
        />
      </div>

      {isQcRole && (
        <div>
          <label className="label">สถานีปฏิบัติงาน QC</label>
          <select className="input" value={form.qc_station || ''} onChange={e => set('qc_station', e.target.value)}>
            <option value="">— ยังไม่ระบุ —</option>
            {QC_STATIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <p className="text-[12px] text-muted mt-0.5">ใช้สำหรับระบบเช็คชื่อ QC</p>
        </div>
      )}

      <div>
        <label className="label">Telegram Chat ID</label>
        <input
          className="input font-mono"
          value={form.telegram_chat_id || ''}
          onChange={e => set('telegram_chat_id', e.target.value)}
          placeholder="เช่น 123456789"
          inputMode="numeric"
        />
        <p className="text-[12px] text-muted mt-0.5">
          แจ้งเตือนกระดิ่งของผู้ใช้คนนี้จะถูกส่งเข้า Telegram ส่วนตัวตาม Chat ID นี้ทันที —
          วิธีหา Chat ID: ให้ผู้ใช้ทักแชทบอทก่อน แล้วเปิด <span className="font-mono">@userinfobot</span> เพื่อดูเลข ID (เว้นว่าง = ไม่ส่งเข้า Telegram ส่วนตัว)
        </p>
      </div>

      <div className="flex justify-end pt-2">
        <Button type="submit" loading={loading}>บันทึก</Button>
      </div>
    </form>
  );
}

const DEFAULT_PASSWORD = 'P@ssw0rd';

export default function AdminUsers() {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const [search, setSearch]             = useState('');
  const [modalOpen, setModalOpen]       = useState(false);
  const [editing, setEditing]           = useState(null);
  const [resetTarget, setResetTarget]   = useState(null);
  const [confirmToggle, setConfirmToggle] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [tgToast, setTgToast]           = useState(null);

  const { data: rows = [] } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api.get('/admin/users').then(r => r.data),
  });

  const filtered = rows.filter(r =>
    r.username.toLowerCase().includes(search.toLowerCase()) ||
    r.full_name.toLowerCase().includes(search.toLowerCase()) ||
    roleLabel(r.role).toLowerCase().includes(search.toLowerCase())
  );
  const { sorted, onSort, sortKey, sortDir } = useSortable(filtered, 'full_name');

  const save = useMutation({
    mutationFn: (form) => editing
      ? api.patch(`/admin/users/${editing.id}`, form)
      : api.post('/admin/users', form),
    onSuccess: () => { qc.invalidateQueries(['admin-users']); setModalOpen(false); setEditing(null); },
  });

  const resetPw = useMutation({
    mutationFn: (userId) => api.post(`/admin/users/${userId}/reset-password`, { new_password: DEFAULT_PASSWORD }),
    onSuccess: () => { setResetTarget(null); },
  });

  const toggleActive = useMutation({
    mutationFn: (id) => api.patch(`/admin/users/${id}/toggle`),
    onSuccess: () => { qc.invalidateQueries(['admin-users']); setConfirmToggle(null); },
  });

  const deleteUser = useMutation({
    mutationFn: (id) => api.delete(`/admin/users/${id}`),
    onSuccess: () => { qc.invalidateQueries(['admin-users']); setConfirmDelete(null); },
  });

  const telegramTest = useMutation({
    mutationFn: (id) => api.post(`/admin/users/${id}/telegram-test`).then(r => r.data),
    onSuccess: (data) => setTgToast({ ok: true, msg: data?.message || 'ส่งข้อความทดสอบสำเร็จ' }),
    onError: (err) => setTgToast({ ok: false, msg: err.response?.data?.error || 'ส่งไม่สำเร็จ' }),
    onSettled: () => setTimeout(() => setTgToast(null), 4000),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3">
        <h1 className="text-h2 font-bold text-text">จัดการผู้ใช้งาน</h1>
        <Button onClick={() => { setEditing(null); setModalOpen(true); }}>
          <span className="hidden sm:inline">+ เพิ่มผู้ใช้งาน</span>
          <span className="sm:hidden text-lg leading-none">+</span>
        </Button>
      </div>

      {tgToast && (
        <div className={`fixed bottom-20 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-small font-medium ${tgToast.ok ? 'bg-green-600 text-white' : 'bg-danger text-white'}`}>
          {tgToast.msg}
        </div>
      )}

      <input
        className="input mb-4"
        placeholder="ค้นหา username, ชื่อ, บทบาท..."
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      {/* ── Mobile card list ── */}
      <div className="md:hidden space-y-2 mb-4">
        {sorted.length === 0 && (
          <p className="text-center text-muted py-8 text-body">ไม่พบผู้ใช้งาน</p>
        )}
        {sorted.map(r => {
          const isSelf = r.id === me?.id;
          return (
            <div key={r.id}
              className={`bg-surface border rounded-lg p-3 ${isSelf ? 'border-accent' : 'border-border'}`}>
              {/* ชื่อ + สถานะ */}
              <div className="flex items-start justify-between gap-2 mb-1">
                <div>
                  <span className="font-mono font-semibold text-primary text-body">{r.username}</span>
                  {isSelf && <span className="ml-1.5 text-[12px] text-accent">(คุณ)</span>}
                </div>
                <span className={`badge flex-shrink-0 ${r.is_active ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200' : 'bg-gray-100 dark:bg-gray-900 text-gray-500 dark:text-gray-200'}`}>
                  {r.is_active ? 'ใช้งาน' : 'ปิดใช้งาน'}
                </span>
              </div>

              {/* ชื่อ-นามสกุล */}
              <div className={`text-body font-medium mb-2 ${r.is_active ? 'text-text' : 'text-muted'}`}>
                {r.full_name}
              </div>

              {/* Role + QC Station */}
              <div className="flex flex-wrap items-center gap-1.5 mb-2">
                <span className={`badge ${ROLE_COLORS[r.role] || 'bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-200'}`}>
                  {roleLabel(r.role)}
                </span>
                {r.qc_station && (
                  <span className="inline-block px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-900 text-blue-700 dark:text-blue-200 text-[12px] font-medium">
                    {QC_STATIONS.find(s => s.value === r.qc_station)?.label || r.qc_station}
                  </span>
                )}
                {r.auth_provider === 'ad' && (
                  <span className="inline-block px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-200 text-[12px] font-medium">
                    Active Directory
                  </span>
                )}
              </div>

              {/* Telegram + วันที่ */}
              <div className="flex items-center justify-between text-[12px] text-muted mb-3">
                {r.telegram_chat_id
                  ? <span className="font-mono">TG: {r.telegram_chat_id}</span>
                  : <span>ไม่มี Telegram</span>}
                <span>{r.created_at ? new Date(r.created_at).toLocaleDateString('th-TH') : '—'}</span>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-2 border-t border-border">
                <button
                  onClick={() => { setEditing(r); setModalOpen(true); }}
                  className="flex-1 min-h-[44px] rounded-lg border border-border text-body text-text bg-surface flex items-center justify-center hover:bg-bg">
                  แก้ไข
                </button>
                {r.telegram_chat_id && (
                  <button
                    onClick={() => telegramTest.mutate(r.id)}
                    disabled={telegramTest.isPending}
                    className="flex-1 min-h-[44px] rounded-lg border border-sky-200 dark:border-sky-700 text-sky-700 dark:text-sky-200 bg-sky-50 dark:bg-sky-900 text-body flex items-center justify-center disabled:opacity-50">
                    ทดสอบ TG
                  </button>
                )}
                <button
                  onClick={() => setResetTarget(r)}
                  className="flex-1 min-h-[44px] rounded-lg border border-amber-200 dark:border-amber-700 text-warning bg-amber-50 dark:bg-amber-900 text-body flex items-center justify-center">
                  Reset PW
                </button>
                <div className="flex items-center justify-center min-w-[48px]">
                  <ToggleSwitch
                    active={r.is_active}
                    onClick={() => !isSelf && setConfirmToggle(r)}
                    title={isSelf ? 'ไม่สามารถปิดใช้งานตัวเองได้' : (r.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน')}
                  />
                </div>
                {!isSelf && (
                  <button
                    onClick={() => setConfirmDelete(r)}
                    className="flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg border border-red-200 dark:border-red-700 text-danger bg-red-50 dark:bg-red-900 hover:bg-red-100"
                    title="ลบผู้ใช้">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd"/>
                    </svg>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Desktop table ── */}
      <div className="hidden md:block table-container">
        <table className="table">
          <thead>
            <tr>
              <SortTh col="username"   sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Username</SortTh>
              <SortTh col="full_name"  sortKey={sortKey} sortDir={sortDir} onSort={onSort}>ชื่อ-นามสกุล</SortTh>
              <SortTh col="role"       sortKey={sortKey} sortDir={sortDir} onSort={onSort}>บทบาท</SortTh>
              <th>สถานี QC</th>
              <th>Telegram</th>
              <SortTh col="is_active"  sortKey={sortKey} sortDir={sortDir} onSort={onSort}>สถานะ</SortTh>
              <SortTh col="created_at" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>วันที่สร้าง</SortTh>
              <th className="text-left">Action</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(r => {
              const isSelf = r.id === me?.id;
              return (
                <tr key={r.id} className={isSelf ? 'bg-blue-50 dark:bg-blue-900' : ''}>
                  <td className="font-mono text-small">
                    {r.username}{isSelf && <span className="ml-1 text-[12px] text-accent">(คุณ)</span>}
                    {r.auth_provider === 'ad' && (
                      <span className="ml-1.5 inline-block px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-200 text-[11px] font-medium align-middle">AD</span>
                    )}
                  </td>
                  <td className={r.is_active ? 'font-medium' : 'text-muted'}>{r.full_name}</td>
                  <td>
                    <span className={`badge ${ROLE_COLORS[r.role] || 'bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-200'}`}>
                      {roleLabel(r.role)}
                    </span>
                  </td>
                  <td className="text-small">
                    {r.qc_station ? (
                      <span className="inline-block px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-900 text-blue-700 dark:text-blue-200 font-medium">
                        {QC_STATIONS.find(s => s.value === r.qc_station)?.label || r.qc_station}
                      </span>
                    ) : <span className="text-muted">—</span>}
                  </td>
                  <td className="text-small">
                    {r.telegram_chat_id ? (
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[12px] px-2 py-0.5 rounded bg-sky-50 dark:bg-sky-900 text-sky-700 dark:text-sky-200">{r.telegram_chat_id}</span>
                        <button
                          onClick={() => telegramTest.mutate(r.id)}
                          disabled={telegramTest.isPending}
                          className="text-accent hover:underline text-[12px] disabled:opacity-50"
                          title="ส่งข้อความทดสอบเข้า Telegram ของผู้ใช้นี้"
                        >ทดสอบ</button>
                      </div>
                    ) : <span className="text-muted">—</span>}
                  </td>
                  <td>
                    <span className={`badge ${r.is_active ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200' : 'bg-gray-100 dark:bg-gray-900 text-gray-500 dark:text-gray-200'}`}>
                      {r.is_active ? 'ใช้งาน' : 'ปิดใช้งาน'}
                    </span>
                  </td>
                  <td className="text-small text-muted">
                    {r.created_at ? new Date(r.created_at).toLocaleDateString('th-TH') : '-'}
                  </td>
                  <td>
                    <div className="flex gap-2 items-center justify-start flex-wrap">
                      <EditButton onClick={() => { setEditing(r); setModalOpen(true); }} />
                      <button
                        onClick={() => setResetTarget(r)}
                        className="text-warning hover:underline text-small min-h-[44px] px-2"
                      >Reset รหัสผ่าน</button>
                      <ToggleSwitch
                        active={r.is_active}
                        onClick={() => !isSelf && setConfirmToggle(r)}
                        title={isSelf ? 'ไม่สามารถปิดใช้งานตัวเองได้' : (r.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน')}
                      />
                      {!isSelf && (
                        <button
                          onClick={() => setConfirmDelete(r)}
                          className="flex items-center justify-center w-9 h-9 rounded border border-red-200 dark:border-red-700 text-danger bg-red-50 dark:bg-red-900 hover:bg-red-100"
                          title="ลบผู้ใช้">
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd"/>
                          </svg>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr><td colSpan={8} className="text-center text-muted py-8">ไม่พบผู้ใช้งาน</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Create / Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditing(null); save.reset?.(); }}
        title={editing ? `แก้ไขผู้ใช้ — ${editing.username}` : 'เพิ่มผู้ใช้งานใหม่'}
      >
        <UserForm
          initial={editing || {}}
          onSave={f => save.mutate(f)}
          loading={save.isPending}
          error={save.error?.response?.data?.error}
        />
      </Modal>

      {/* Reset Password Confirm */}
      <ConfirmDialog
        open={!!resetTarget}
        onClose={() => { setResetTarget(null); resetPw.reset?.(); }}
        onConfirm={() => resetPw.mutate(resetTarget.id)}
        message={
          <span>
            ต้องการ Reset รหัสผ่านของ{' '}
            <span className="font-semibold">{resetTarget?.full_name}</span>
            {' '}(<span className="font-mono">{resetTarget?.username}</span>){' '}
            เป็น <span className="font-mono font-semibold">{DEFAULT_PASSWORD}</span> ?
          </span>
        }
        confirmLabel="Reset รหัสผ่าน"
        variant="warning"
        loading={resetPw.isPending}
      />

      {/* Toggle Active Confirm */}
      <ConfirmDialog
        open={!!confirmToggle}
        onClose={() => setConfirmToggle(null)}
        onConfirm={() => toggleActive.mutate(confirmToggle.id)}
        message={`ต้องการ${confirmToggle?.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'} "${confirmToggle?.full_name}" (${confirmToggle?.username})?`}
        confirmLabel={confirmToggle?.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
        variant={confirmToggle?.is_active ? 'warning' : 'success'}
        loading={toggleActive.isPending}
      />

      {/* Delete User Confirm */}
      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => { setConfirmDelete(null); deleteUser.reset?.(); }}
        onConfirm={() => deleteUser.mutate(confirmDelete.id)}
        message={
          <span>
            ต้องการลบผู้ใช้{' '}
            <span className="font-semibold">{confirmDelete?.full_name}</span>
            {' '}(<span className="font-mono">{confirmDelete?.username}</span>){' '}
            ออกจากระบบ?
            <br />
            <span className="text-[12px] text-muted">หากผู้ใช้มีข้อมูลในระบบ จะไม่สามารถลบได้ (ใช้ปิดใช้งานแทน)</span>
            {deleteUser.error && (
              <span className="block mt-2 text-danger text-small">
                {deleteUser.error.response?.data?.error || 'ลบไม่สำเร็จ'}
              </span>
            )}
          </span>
        }
        confirmLabel="ลบผู้ใช้"
        variant="danger"
        loading={deleteUser.isPending}
      />
    </div>
  );
}
