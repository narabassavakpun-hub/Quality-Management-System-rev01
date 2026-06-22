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

const ROLES = [
  { value: 'admin',              label: 'ผู้ดูแลระบบ' },
  { value: 'qc_staff',          label: 'QC Staff' },
  { value: 'qc_supervisor',     label: 'QC Supervisor' },
  { value: 'qc_manager',        label: 'QC Manager' },
  { value: 'qmr',               label: 'QMR' },
  { value: 'purchasing',        label: 'จัดซื้อ' },
  { value: 'cco',               label: 'CCO' },
  { value: 'cmo',               label: 'CMO' },
  { value: 'cpo',               label: 'CPO' },
  { value: 'production_manager',label: 'ผู้จัดการฝ่ายผลิต' },
];

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
const roleLabel = (r) => ROLES.find(x => x.value === r)?.label || r;

const ROLE_COLORS = {
  admin:              'bg-purple-100 text-purple-700',
  qc_staff:          'bg-blue-100 text-blue-700',
  qc_supervisor:     'bg-cyan-100 text-cyan-700',
  qc_manager:        'bg-indigo-100 text-indigo-700',
  qmr:               'bg-teal-100 text-teal-700',
  purchasing:        'bg-amber-100 text-amber-700',
  cco:               'bg-orange-100 text-orange-700',
  cmo:               'bg-rose-100 text-rose-700',
  cpo:               'bg-pink-100 text-pink-700',
  production_manager:'bg-green-100 text-green-700',
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

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">ชื่อผู้ใช้ (Username) *</label>
          <input
            className="input"
            value={form.username}
            onChange={e => set('username', e.target.value)}
            required
            disabled={isEdit}
            placeholder="เช่น qc_staff1"
          />
          {isEdit && <p className="text-[11px] text-muted mt-0.5">ไม่สามารถเปลี่ยน username ได้</p>}
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

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">บทบาท *</label>
          <select className="input" value={form.role} onChange={e => { set('role', e.target.value); if (!QC_ROLES.includes(e.target.value)) set('qc_station', ''); }} required>
            {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
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

      {isQcRole && (
        <div>
          <label className="label">สถานีปฏิบัติงาน QC</label>
          <select className="input" value={form.qc_station || ''} onChange={e => set('qc_station', e.target.value)}>
            <option value="">— ยังไม่ระบุ —</option>
            {QC_STATIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <p className="text-[11px] text-muted mt-0.5">ใช้สำหรับระบบเช็คชื่อ QC</p>
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
        <p className="text-[11px] text-muted mt-0.5">
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

  const telegramTest = useMutation({
    mutationFn: (id) => api.post(`/admin/users/${id}/telegram-test`).then(r => r.data),
    onSuccess: (data) => setTgToast({ ok: true, msg: data?.message || 'ส่งข้อความทดสอบสำเร็จ' }),
    onError: (err) => setTgToast({ ok: false, msg: err.response?.data?.error || 'ส่งไม่สำเร็จ' }),
    onSettled: () => setTimeout(() => setTgToast(null), 4000),
  });

  return (
    <div>
      <h1 className="text-h2 font-bold text-text mb-4">จัดการผู้ใช้งาน</h1>

      {tgToast && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg shadow-lg text-small font-medium ${tgToast.ok ? 'bg-green-600 text-white' : 'bg-danger text-white'}`}>
          {tgToast.msg}
        </div>
      )}

      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <input
          className="input max-w-xs"
          placeholder="ค้นหา username, ชื่อ, บทบาท..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <Button onClick={() => { setEditing(null); setModalOpen(true); }}>+ เพิ่มผู้ใช้งาน</Button>
      </div>

      <div className="table-container">
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
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(r => {
              const isSelf = r.id === me?.id;
              return (
                <tr key={r.id} className={isSelf ? 'bg-blue-50' : ''}>
                  <td className="font-mono text-small">{r.username}{isSelf && <span className="ml-1 text-[10px] text-accent">(คุณ)</span>}</td>
                  <td className={r.is_active ? 'font-medium' : 'text-muted'}>{r.full_name}</td>
                  <td>
                    <span className={`badge ${ROLE_COLORS[r.role] || 'bg-gray-100 text-gray-600'}`}>
                      {roleLabel(r.role)}
                    </span>
                  </td>
                  <td className="text-small">
                    {r.qc_station ? (
                      <span className="inline-block px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-medium">
                        {QC_STATIONS.find(s => s.value === r.qc_station)?.label || r.qc_station}
                      </span>
                    ) : <span className="text-muted">—</span>}
                  </td>
                  <td className="text-small">
                    {r.telegram_chat_id ? (
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-sky-50 text-sky-700">{r.telegram_chat_id}</span>
                        <button
                          onClick={() => telegramTest.mutate(r.id)}
                          disabled={telegramTest.isPending}
                          className="text-accent hover:underline text-[11px] disabled:opacity-50"
                          title="ส่งข้อความทดสอบเข้า Telegram ของผู้ใช้นี้"
                        >ทดสอบ</button>
                      </div>
                    ) : <span className="text-muted">—</span>}
                  </td>
                  <td>
                    <span className={`badge ${r.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {r.is_active ? 'ใช้งาน' : 'ปิดใช้งาน'}
                    </span>
                  </td>
                  <td className="text-small text-muted">
                    {r.created_at ? new Date(r.created_at).toLocaleDateString('th-TH') : '-'}
                  </td>
                  <td>
                    <div className="flex gap-2 items-center justify-center flex-wrap">
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
    </div>
  );
}
