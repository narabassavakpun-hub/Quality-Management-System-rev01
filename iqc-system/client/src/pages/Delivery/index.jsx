import React, { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import api, { downloadExcel } from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import Modal from '../../components/UI/Modal';
import Button from '../../components/UI/Button';
import SearchableSelect from '../../components/UI/SearchableSelect';
import ImageUploadPair from '../../components/UI/ImageUploadPair';

// ─── helpers ─────────────────────────────────────────────────────────────────

const HOURS   = Array.from({ length: 12 }, (_, i) => String(i + 7).padStart(2, '0')); // 07–18
const MINUTES = ['00', '15', '30', '45'];

function timeOfDay(h) {
  if (!h) return null;
  const n = parseInt(h, 10);
  if (n === 7)            return { label: 'ก่อนเข้างาน', cls: 'bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-200', warning: 'ช่วงเวลาก่อนเข้างาน', warnCls: 'text-orange-600 dark:text-orange-200' };
  if (n >= 8  && n <= 11) return { label: 'เช้า',   cls: 'bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-200', warning: null };
  if (n === 12)           return { label: 'เที่ยง', cls: 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200 font-bold', warning: 'ช่วงเวลาพักเที่ยง', warnCls: 'text-red-600 dark:text-red-200 font-semibold' };
  if (n >= 13 && n <= 17) return { label: 'บ่าย',   cls: 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200', warning: null };
  if (n === 18)           return { label: 'หลังเลิกงาน', cls: 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200', warning: 'ช่วงเวลาหลังเลิกงาน', warnCls: 'text-blue-600 dark:text-blue-200' };
  return null;
}

function TimePicker({ value, onChange, minHour }) {
  const [curH, curM] = value && value.includes(':') ? value.split(':') : ['', '00'];
  const tod = timeOfDay(curH);
  const availableHours = minHour !== undefined
    ? HOURS.filter(h => parseInt(h, 10) > minHour)
    : HOURS;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        {/* Badge ช่วงเวลา — อยู่หน้า dropdown */}
        <span className={`inline-flex items-center justify-center px-2 py-1 rounded text-small font-medium min-w-[48px] min-h-[44px] ${tod ? tod.cls : 'bg-gray-100 dark:bg-gray-900 text-gray-400'}`}>
          {tod ? tod.label : '—'}
        </span>
        <select
          className="input flex-1"
          value={curH}
          onChange={e => onChange(e.target.value ? `${e.target.value}:${curM || '00'}` : '')}
        >
          <option value="">-- ชั่วโมง --</option>
          {availableHours.map(h => <option key={h} value={h}>{h}</option>)}
        </select>
        <select
          className="input flex-1"
          value={curM || '00'}
          disabled={!curH}
          onChange={e => { if (curH) onChange(`${curH}:${e.target.value}`); }}
        >
          {MINUTES.map(m => <option key={m} value={m}>{m} นาที</option>)}
        </select>
      </div>
      {tod?.warning && (
        <p className={`text-small flex items-center gap-1 ${tod.warnCls}`}>
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          {tod.warning}
        </p>
      )}
    </div>
  );
}

const DAYS_TH = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const MONTHS_TH = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
                   'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];

function toDateStr(d) { return d.toISOString().slice(0,10); }

function isPastDelivery(scheduledDate, timeSlot) {
  const now = new Date();
  const parts = (timeSlot || '23:59').match(/^(\d{2}):(\d{2})/);
  const dt = new Date(scheduledDate);
  if (parts) dt.setHours(+parts[1], +parts[2], 0, 0);
  else dt.setHours(23, 59);
  return dt < now;
}

const STATUS_CFG = {
  pending:      { label: 'รอดำเนินการ',            cls: 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200' },
  acknowledged: { label: 'รับทราบแล้ว',            cls: 'bg-teal-100 dark:bg-teal-900 text-teal-800 dark:text-teal-200' },
  on_time:      { label: 'ส่งตามแผน',                cls: 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200' },
  late:         { label: 'ส่งนอกแผน',                cls: 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200' },
  cancelled:    { label: 'ยกเลิก',                  cls: 'bg-gray-100 dark:bg-gray-900 text-gray-500 dark:text-gray-200' },
  rescheduled:  { label: 'เลื่อนวันส่ง',            cls: 'bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200' },
};

function StatusBadge({ status, isUnplanned }) {
  // ไม่มีแผนส่ง (is_unplanned) เก็บ status='on_time' ในฐานข้อมูลเสมอ (ไม่มีการ "วางแผน" มาก่อนจริงๆ) — โชว์
  // เฉพาะป้าย "ไม่มีแผนส่ง" ป้ายเดียว ไม่โชว์ "ส่งตามแผน" คู่กัน (ขัดแย้งในตัวเอง ทำให้ user สับสน)
  if (isUnplanned) {
    return (
      <span className="flex flex-wrap gap-1">
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[12px] font-medium bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200">ไม่มีแผนส่ง</span>
      </span>
    );
  }
  const cfg = STATUS_CFG[status] || { label: status, cls: 'bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-200' };
  return (
    <span className="flex flex-wrap gap-1">
      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[12px] font-medium ${cfg.cls}`}>{cfg.label}</span>
    </span>
  );
}

// ─── Detail/Edit Modal ────────────────────────────────────────────────────────

export function DetailModal({ schedule, onClose, suppliers, role, holidays = [] }) {
  const qc = useQueryClient();
  const todayStr = toDateStr(new Date());
  const nowHour  = new Date().getHours();

  // detail = query ที่ refresh ได้ (ต่างจาก schedule prop ซึ่งเป็น snapshot ตอนเปิด modal ครั้งแรก และไม่เปลี่ยนอีก)
  // ต้องประกาศก่อนคำนวณ canEdit/canAck/canUpdateStatus ด้านล่าง — เดิมคำนวณจาก schedule ตรงๆ ทำให้ปุ่ม/สถานะที่
  // แสดงค้างเป็นข้อมูลเก่าจนกว่าจะปิด-เปิด modal ใหม่ แม้ mutation จะสำเร็จแล้วก็ตาม
  const { data: detail = schedule } = useQuery({
    queryKey: ['delivery-detail', schedule.id],
    queryFn: () => api.get(`/delivery/${schedule.id}`).then(r => r.data),
    initialData: schedule,
    staleTime: 0,
  });

  const past = isPastDelivery(detail.scheduled_date, detail.time_slot);
  const isQC = ['qc_staff', 'qc_supervisor'].includes(role);
  // คลัง (หัวหน้าคลัง/ผู้จัดการคลัง) เป็นผู้กด "รับทราบ" แทน qc_staff/qc_supervisor เดิม — qc_staff/qc_supervisor
  // เหลือแค่บันทึกวันเวลามาส่งจริงผ่าน canUpdateStatus (ดู routes/delivery.js's acknowledge endpoint)
  const isWarehouse = ['warehouse_supervisor', 'warehouse_manager'].includes(role);
  const canEdit = role === 'purchasing' && ['pending', 'acknowledged'].includes(detail.status) && !detail.is_unplanned && !past;
  const canAck  = isWarehouse && detail.status === 'pending';
  const canUpdateStatus = isQC && detail.status === 'acknowledged';

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    supplier_id: schedule.supplier_id,
    scheduled_date: schedule.scheduled_date,
    time_slot: schedule.time_slot || '',
    notes: schedule.notes || '',
  });
  const [editHolidayConfirm, setEditHolidayConfirm] = useState(false);
  const [statusForm, setStatusForm] = useState({ status: '', late_reason: '', rescheduled_date: '', actual_date: '', actual_time: '' });
  const [statusHolidayConfirm, setStatusHolidayConfirm] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const fileRef = useRef();

  const editHoliday = holidayReason(form.scheduled_date, holidays);
  const statusHoliday = statusForm.status === 'rescheduled' ? holidayReason(statusForm.rescheduled_date, holidays) : null;

  function handlePatchSave() {
    if (editHoliday && !editHolidayConfirm) { setEditHolidayConfirm(true); return; }
    patch.mutate();
  }
  function handleStatusSave() {
    // popup แจ้งเตือนฟิลด์ที่ยังไม่ได้กรอกก่อนบันทึก — ก่อนหน้านี้ปุ่ม disabled เช็คแค่ statusForm.status
    // ทำให้กดบันทึกทั้งที่ยังไม่กรอกวันที่/เวลาที่มาส่งได้เงียบๆ (บั๊กที่ user รายงาน)
    const missing = [];
    if (['on_time', 'late'].includes(statusForm.status)) {
      if (!statusForm.actual_date) missing.push('วันที่ส่งจริง');
      if (!statusForm.actual_time) missing.push('เวลาที่มาส่ง');
    }
    if (statusForm.status === 'rescheduled' && !statusForm.rescheduled_date) missing.push('วันที่ใหม่');
    // เหตุผลบังคับเฉพาะ cancelled/rescheduled — ส่งนอกแผน (late) ไม่บังคับตอบแล้วตามที่ user ขอ
    if (['cancelled', 'rescheduled'].includes(statusForm.status) && !statusForm.late_reason) missing.push('เหตุผล');
    if (missing.length) {
      alert(`กรุณากรอกข้อมูลให้ครบก่อนบันทึก:\n- ${missing.join('\n- ')}`);
      return;
    }
    if (statusHoliday && !statusHolidayConfirm) { setStatusHolidayConfirm(true); return; }
    updateStatus.mutate();
  }

  const { data: history = [] } = useQuery({
    queryKey: ['delivery-history', schedule.id],
    queryFn: () => api.get(`/delivery/${schedule.id}/history`).then(r => r.data),
    enabled: historyOpen,
    staleTime: 0,
  });

  const invalidateDetail = () => qc.invalidateQueries({ queryKey: ['delivery-detail', schedule.id] });

  const patch = useMutation({
    mutationFn: () => api.patch(`/delivery/${schedule.id}`, form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['delivery'] }); onClose(); },
  });
  const ack = useMutation({
    mutationFn: () => api.post(`/delivery/${schedule.id}/acknowledge`),
    onSuccess: () => { qc.invalidateQueries(['delivery']); onClose(); },
  });
  const updateStatus = useMutation({
    mutationFn: () => api.patch(`/delivery/${schedule.id}/status`, statusForm),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['delivery'] });
      qc.invalidateQueries({ queryKey: ['delivery-history', schedule.id] });
      qc.invalidateQueries({ queryKey: ['delivery-detail', schedule.id] }); // ให้ detail (สถานะ+ปุ่ม) รีเฟรชทันที ไม่ต้องปิด-เปิด modal ใหม่
      setStatusOpen(false);
    },
  });
  const delSchedule = useMutation({
    mutationFn: () => api.delete(`/delivery/${schedule.id}`),
    onSuccess: () => { qc.invalidateQueries(['delivery']); onClose(); },
  });
  const uploadFile = useMutation({
    mutationFn: (files) => {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      return api.post(`/delivery/${schedule.id}/attachments`, fd);
    },
    onSuccess: () => {
      invalidateDetail();
      qc.invalidateQueries({ queryKey: ['delivery'] });
      setUploadSuccess(true);
      setTimeout(() => setUploadSuccess(false), 3000);
    },
  });
  const delAttach = useMutation({
    mutationFn: (aid) => api.delete(`/delivery/${schedule.id}/attachments/${aid}`),
    onSuccess: () => {
      invalidateDetail();
      qc.invalidateQueries({ queryKey: ['delivery'] });
    },
  });

  const supName = suppliers.find(s => s.id === schedule.supplier_id)?.name || schedule.supplier_name;

  return (
    <Modal open onClose={onClose} title="รายละเอียดการส่งของ" size="lg">
      <div className="space-y-4">
        {/* Header info */}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-semibold text-h3 text-primary">{supName}</p>
            <p className="text-muted text-small mt-0.5">
              {detail.scheduled_date} {detail.time_slot ? `เวลา ${detail.time_slot}` : ''}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <StatusBadge status={detail.status} isUnplanned={detail.is_unplanned} />
            {!!detail.has_sample && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[12px] font-medium bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200">ส่งงานตัวอย่าง</span>
            )}
          </div>
        </div>

        {detail.notes && <p className="text-body text-text bg-bg rounded p-2">{detail.notes}</p>}

        {/* Edit form */}
        {editing ? (
          <div className="border border-border rounded-lg p-3 space-y-3 bg-bg">
            <p className="text-small font-medium text-muted">แก้ไขได้เฉพาะวันที่ เวลา และหมายเหตุ</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="label">ผู้ผลิต</label>
                <p className="text-body text-text font-medium">{supName}</p>
              </div>
              <div>
                <label className="label">วันที่ *</label>
                <input
                  type="date"
                  className="input"
                  min={todayStr}
                  value={form.scheduled_date}
                  onChange={e => {
                    const d = e.target.value;
                    setForm(p => ({
                      ...p,
                      scheduled_date: d,
                      time_slot: (d === todayStr && p.time_slot && parseInt(p.time_slot.split(':')[0], 10) <= nowHour) ? '' : p.time_slot,
                    }));
                  }}
                />
              </div>
              <div>
                <label className="label">เวลา *</label>
                <TimePicker
                  value={form.time_slot}
                  onChange={v => setForm(p => ({ ...p, time_slot: v }))}
                  minHour={form.scheduled_date === todayStr ? nowHour : undefined}
                />
              </div>
              <div className="col-span-2">
                <label className="label">หมายเหตุ</label>
                <input className="input" value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
              </div>
            </div>
            {editHolidayConfirm && editHoliday && (
              <div className="border-2 border-orange-300 dark:border-orange-600 bg-orange-50 dark:bg-orange-900 rounded-lg p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <svg className="w-4 h-4 text-orange-500 dark:text-orange-200 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  </svg>
                  <div>
                    <p className="text-small font-semibold text-orange-800 dark:text-orange-200">วันที่เลือกเป็นวันหยุด: {editHoliday}</p>
                    <p className="text-small text-orange-700 dark:text-orange-200">ระบบจะแจ้งเตือนไปยัง QC Staff, QC Supervisor, QC Manager และจัดซื้อ</p>
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" onClick={() => setEditHolidayConfirm(false)}>ย้อนกลับ</Button>
                  <Button variant="warning" onClick={() => patch.mutate()} loading={patch.isPending}>ยืนยัน — บันทึกและแจ้งเตือน</Button>
                </div>
              </div>
            )}
            {!editHolidayConfirm && editHoliday && (
              <p className="text-small text-orange-600 dark:text-orange-200 flex items-center gap-1">
                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                วันหยุด: {editHoliday}
              </p>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => { setEditing(false); setEditHolidayConfirm(false); }}>ยกเลิก</Button>
              {!editHolidayConfirm && (
                <Button onClick={handlePatchSave} loading={patch.isPending} disabled={!form.scheduled_date || !form.time_slot}>
                  {editHoliday ? 'บันทึก (วันหยุด)' : 'บันทึก'}
                </Button>
              )}
            </div>
          </div>
        ) : null}

        {/* Update status form */}
        {statusOpen && (
          <div className="border border-border rounded-lg p-3 space-y-3 bg-bg">
            <p className="font-semibold text-body">อัปเดตสถานะการส่งของ</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">สถานะ *</label>
                <select className="input" value={statusForm.status} onChange={e => setStatusForm(p => ({ ...p, status: e.target.value }))}>
                  <option value="">-- เลือก --</option>
                  <option value="on_time">ส่งตามแผน</option>
                  <option value="late">ส่งนอกแผน</option>
                  {!isQC && <option value="rescheduled">เลื่อนวันส่ง</option>}
                  {!isQC && <option value="cancelled">ยกเลิก</option>}
                </select>
              </div>
              {statusForm.status === 'rescheduled' && (
                <div>
                  <label className="label">วันที่ใหม่ *</label>
                  <input type="date" className="input" value={statusForm.rescheduled_date}
                    onChange={e => { setStatusForm(p => ({ ...p, rescheduled_date: e.target.value })); setStatusHolidayConfirm(false); }} />
                  {statusHoliday && (
                    <p className="mt-1 text-small text-orange-600 dark:text-orange-200 flex items-center gap-1">
                      <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                      </svg>
                      วันหยุด: {statusHoliday}
                    </p>
                  )}
                </div>
              )}
              {['on_time','late'].includes(statusForm.status) && (
                <div>
                  <label className="label">วันที่ส่งจริง *</label>
                  <input type="date" className="input" value={statusForm.actual_date} onChange={e => setStatusForm(p => ({ ...p, actual_date: e.target.value }))} />
                </div>
              )}
              {['on_time','late'].includes(statusForm.status) && (
                <div>
                  <label className="label">เวลาที่มาส่ง *</label>
                  {/* ใช้ TimePicker (select ธรรมดา) แทน input type=time — lang="en-GB" เคยลองแล้วแก้ไม่ได้จริง
                      เพราะ picker widget ของ native input ผูกกับ regional format ของ Windows/browser ที่เครื่อง
                      ผู้ใช้เอง ไม่ใช่ lang attribute ของ HTML (ยืนยันจาก screenshot จริงที่ user ส่งมา ยังมี AM/PM
                      โผล่อยู่ดี) — select เป็น 24 ชม. เสมอ ไม่มีทางโผล่ AM/PM เพราะไม่ได้พึ่ง native widget เลย */}
                  <TimePicker value={statusForm.actual_time} onChange={v => setStatusForm(p => ({ ...p, actual_time: v }))} />
                </div>
              )}
            </div>
            {['late','cancelled','rescheduled'].includes(statusForm.status) && (
              <div>
                <label className="label">เหตุผล{['cancelled','rescheduled'].includes(statusForm.status) ? ' *' : ' (ไม่บังคับ)'}</label>
                <input className="input" value={statusForm.late_reason} placeholder="ระบุเหตุผล..." onChange={e => setStatusForm(p => ({ ...p, late_reason: e.target.value }))} />
              </div>
            )}
            {statusHolidayConfirm && statusHoliday && (
              <div className="border-2 border-orange-300 dark:border-orange-600 bg-orange-50 dark:bg-orange-900 rounded-lg p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <svg className="w-4 h-4 text-orange-500 dark:text-orange-200 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  </svg>
                  <div>
                    <p className="text-small font-semibold text-orange-800 dark:text-orange-200">วันใหม่ที่เลือกเป็นวันหยุด: {statusHoliday}</p>
                    <p className="text-small text-orange-700 dark:text-orange-200">ระบบจะแจ้งเตือนไปยัง QC Staff, QC Supervisor, QC Manager และจัดซื้อ</p>
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" onClick={() => setStatusHolidayConfirm(false)}>ย้อนกลับ</Button>
                  <Button variant="warning" onClick={() => updateStatus.mutate()} loading={updateStatus.isPending}>ยืนยัน — บันทึกและแจ้งเตือน</Button>
                </div>
              </div>
            )}
            {!statusHolidayConfirm && (
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" onClick={() => { setStatusOpen(false); setStatusHolidayConfirm(false); }}>ยกเลิก</Button>
                <Button onClick={handleStatusSave} loading={updateStatus.isPending} disabled={!statusForm.status}>
                  {statusHoliday ? 'บันทึก (วันหยุด)' : 'บันทึก'}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Items */}
        {detail.items?.length > 0 && (
          <div>
            <p className="label mb-1 text-danger">รายการสินค้า (ระบุรายการด่วนห้ามขาดส่ง)</p>
            <div className="border border-border rounded overflow-hidden">
              <table className="w-full text-small">
                <thead className="bg-bg">
                  <tr>
                    <th className="px-3 py-2 text-left text-muted font-medium">รายการ</th>
                    <th className="px-3 py-2 text-right text-muted font-medium w-24">จำนวน</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.map(item => (
                    <tr key={item.id} className={`border-t border-border ${item.is_urgent ? 'bg-red-50 dark:bg-red-900' : ''}`}>
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-2">
                          {item.item_name || '—'}
                          {!!item.is_urgent && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[12px] font-bold bg-danger text-white">ด่วน! ห้ามขาดส่ง</span>
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">{item.qty_expected ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Attachments */}
        <div className="space-y-3">
          {/* Regular docs */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="label">เอกสารแนบ (Packing List ฯลฯ)</p>
              {role === 'purchasing' && (
                <label className={`text-accent text-small cursor-pointer hover:underline flex items-center gap-1 ${uploadFile.isPending ? 'opacity-50 pointer-events-none' : ''}`}>
                  {uploadFile.isPending ? 'กำลังอัปโหลด...' : '+ แนบไฟล์'}
                  <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png" className="hidden" ref={fileRef}
                    onChange={e => { if (e.target.files?.length) uploadFile.mutate(Array.from(e.target.files)); e.target.value = ''; }} />
                </label>
              )}
            </div>
            {uploadSuccess && (
              <div className="flex items-center gap-2 px-3 py-2 bg-green-50 dark:bg-green-900 border border-green-200 dark:border-green-700 rounded text-small text-green-700 dark:text-green-200 mb-1">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                เพิ่มไฟล์เสร็จสิ้น
              </div>
            )}
            {(() => {
              const docs = (detail.attachments || []).filter(a => a.file_type !== 'sample_image');
              return docs.length > 0 ? (
                <ul className="space-y-1">
                  {docs.map(a => (
                    <li key={a.id} className="flex items-center gap-2 text-small">
                      <a href={`/uploads/general/${a.file_path}`} target="_blank" rel="noreferrer" className="text-accent hover:underline flex-1 truncate">{a.original_name}</a>
                      {role === 'purchasing' && (
                        <button
                          onClick={() => { if (window.confirm(`ลบไฟล์ "${a.original_name}" ออกจากระบบ?`)) delAttach.mutate(a.id); }}
                          disabled={delAttach.isPending}
                          className="text-muted hover:text-danger text-[12px] disabled:opacity-50"
                        >ลบ</button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : <p className="text-muted text-small">ยังไม่มีเอกสารแนบ</p>;
            })()}
          </div>

          {/* Sample images */}
          {(() => {
            const samples = (detail.attachments || []).filter(a => a.file_type === 'sample_image');
            if (!detail.has_sample && samples.length === 0) return null;
            return (
              <div className="border border-accent/30 bg-blue-50 dark:bg-blue-900 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-small font-medium text-accent">รูปงานตัวอย่าง</p>
                  {role === 'purchasing' && (
                    <ImageUploadPair onChange={e => {
                      if (e.target.files?.length) {
                        const fd = new FormData();
                        Array.from(e.target.files).forEach(f => fd.append('files', f));
                        api.post(`/delivery/${schedule.id}/attachments?type=sample`, fd)
                          .then(() => qc.invalidateQueries(['delivery']));
                      }
                      e.target.value = '';
                    }} />
                  )}
                </div>
                {samples.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {samples.map(a => (
                      <div key={a.id} className="relative group">
                        <a href={`/uploads/general/${a.file_path}`} target="_blank" rel="noreferrer">
                          <img src={`/uploads/general/${a.file_path}`} alt={a.original_name} className="w-20 h-20 object-cover rounded border border-border" />
                        </a>
                        {role === 'purchasing' && (
                          <button
                            onClick={() => delAttach.mutate(a.id)}
                            className="absolute -top-1.5 -right-1.5 bg-danger text-white rounded-full w-6 h-6 text-[12px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow"
                          >×</button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : <p className="text-small text-muted">ยังไม่มีรูปงานตัวอย่าง</p>}
              </div>
            );
          })()}
        </div>

        {/* History */}
        <div>
          <button
            type="button"
            onClick={() => setHistoryOpen(p => !p)}
            className="flex items-center gap-1.5 text-small text-muted hover:text-accent"
          >
            <svg className={`w-3.5 h-3.5 transition-transform ${historyOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            ประวัติการดำเนินการ
          </button>
          {historyOpen && (
            <div className="mt-2 border border-border rounded-lg overflow-hidden">
              {history.length === 0 ? (
                <p className="text-muted text-small px-3 py-2">ไม่มีประวัติ</p>
              ) : (
                <ul className="divide-y divide-border">
                  {history.map((h, idx) => {
                    const nv = h.new_values || {};
                    const ov = h.old_values || {};
                    let desc = '';
                    if (h.action === 'CREATE') desc = 'สร้างแผนส่งของ';
                    else if (h.action === 'UPDATE') {
                      const parts = [];
                      if (ov.scheduled_date !== nv.scheduled_date) parts.push(`วันที่ ${ov.scheduled_date} → ${nv.scheduled_date}`);
                      if (ov.time_slot !== nv.time_slot) parts.push(`เวลา ${ov.time_slot} → ${nv.time_slot}`);
                      if (ov.notes !== nv.notes) parts.push('แก้ไขหมายเหตุ');
                      desc = `แก้ไขวันเวลาส่งสินค้า${parts.length ? ': ' + parts.join(', ') : ''}`;
                    } else if (h.action === 'STATUS_UPDATE') {
                      const statusLabel = { pending:'รอดำเนินการ', acknowledged:'รับทราบ', on_time:'ส่งตามแผน', late:'ส่งนอกแผน', cancelled:'ยกเลิก', rescheduled:'เลื่อนวันส่ง' };
                      desc = `เปลี่ยนสถานะ: ${statusLabel[ov.status] || ov.status} → ${statusLabel[nv.status] || nv.status}`;
                      if (nv.status === 'rescheduled' && nv.scheduled_date) desc += ` (วันใหม่: ${nv.scheduled_date})`;
                      if (nv.late_reason) desc += ` — ${nv.late_reason}`;
                    } else if (h.action === 'ACKNOWLEDGE') {
                      desc = 'คลังรับทราบแผนส่งของ';
                    } else {
                      desc = h.action;
                    }
                    return (
                      <li key={idx} className="px-3 py-2 text-small flex items-start gap-2">
                        {/* audit_logs.created_at เป็น SQLite CURRENT_TIMESTAMP (UTC, ไม่มี timezone marker) —
                            ต้องต่อ 'Z' ก่อนแปลงแล้วระบุ timeZone Asia/Bangkok เสมอ (เหมือน NCR/UAI Detail
                            เดิม) ไม่งั้นจะโชว์เวลา UTC ดิบๆ ช้ากว่าเวลาไทยจริง 7 ชั่วโมง */}
                        <span className="text-muted w-32 flex-shrink-0">
                          {h.created_at ? new Date(h.created_at + 'Z').toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Bangkok' }) : '-'}
                        </span>
                        <span className="flex-1">{desc}</span>
                        <span className="text-muted flex-shrink-0">{h.actor_name || '-'}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
          {canAck && <Button variant="primary" onClick={() => ack.mutate()} loading={ack.isPending}>รับทราบ</Button>}
          {canEdit && !editing && <Button variant="warning" onClick={() => setEditing(true)}>แก้ไขวันเวลาส่งสินค้า</Button>}
          {canUpdateStatus && !statusOpen && !editing && <Button variant="warning" onClick={() => setStatusOpen(true)}>อัปเดตสถานะ</Button>}
          {canEdit && !editing && (
            <Button variant="danger" onClick={() => { if (confirm('ยืนยันลบแผนนี้?')) delSchedule.mutate(); }} loading={delSchedule.isPending}>ลบ</Button>
          )}
          <Button variant="ghost" onClick={onClose} className="ml-auto">ปิด</Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Create Modal (Purchasing) ────────────────────────────────────────────────

function offHoursReason(timeSlot) {
  if (!timeSlot) return null;
  const h = parseInt(timeSlot.split(':')[0], 10);
  if (h === 7)  return 'เวลา 07:xx เป็นช่วงก่อนเข้างาน (เวลาทำงานปกติ 08:00–17:00)';
  if (h === 18) return 'เวลา 18:xx เป็นช่วงหลังเลิกงาน (เวลาทำงานปกติ 08:00–17:00)';
  return null;
}

function weekendReason(dateStr) {
  if (!dateStr) return null;
  const dow = new Date(dateStr).getDay();
  if (dow === 6) return 'วันเสาร์ — เป็นวันหยุด';
  return null;
}

function holidayReason(dateStr, holidays = []) {
  if (!dateStr) return null;
  const dow = new Date(dateStr).getDay();
  if (dow === 0) return 'วันอาทิตย์ — วันหยุดประจำ';
  const match = holidays.find(h => h.holiday_date === dateStr);
  if (match) return `วันหยุดบริษัท: ${match.name}`;
  return null;
}

export function CreateModal({ onClose, suppliers, defaultDate, holidays = [] }) {
  const qc = useQueryClient();
  const todayStr = toDateStr(new Date());
  const nowHour = new Date().getHours();
  const [form, setForm] = useState({ supplier_id: '', scheduled_date: defaultDate && defaultDate >= todayStr ? defaultDate : '', time_slot: '', notes: '', has_sample: false });
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const fileRef = useRef();
  const sampleFileRef = useRef();
  const [pendingFiles, setPendingFiles] = useState([]);
  const [pendingSampleFiles, setPendingSampleFiles] = useState([]);
  const [offHoursConfirm, setOffHoursConfirm] = useState(false);

  const { data: supplierProducts = [] } = useQuery({
    queryKey: ['products-by-supplier', form.supplier_id],
    queryFn: () => form.supplier_id
      ? api.get('/master/products', { params: { supplier_id: form.supplier_id, limit: 500 } }).then(r => r.data?.data || r.data || [])
      : Promise.resolve([]),
    enabled: !!form.supplier_id,
    staleTime: 60000,
  });

  const create = useMutation({
    mutationFn: async () => {
      const res = await api.post('/delivery', { ...form, supplier_id: +form.supplier_id, has_sample: form.has_sample ? 1 : 0, items });
      if (pendingFiles.length) {
        const fd = new FormData();
        for (const f of pendingFiles) fd.append('files', f);
        await api.post(`/delivery/${res.data.id}/attachments`, fd);
      }
      if (pendingSampleFiles.length) {
        const fd = new FormData();
        for (const f of pendingSampleFiles) fd.append('files', f);
        await api.post(`/delivery/${res.data.id}/attachments?type=sample`, fd);
      }
      return res;
    },
    onSuccess: () => { qc.invalidateQueries(['delivery']); onClose(); },
    onError: (e) => { setError(e.response?.data?.error || 'เกิดข้อผิดพลาด'); setOffHoursConfirm(false); },
  });

  function handleSave() {
    if ((offHoursReason(form.time_slot) || weekendReason(form.scheduled_date) || holidayReason(form.scheduled_date, holidays)) && !offHoursConfirm) {
      setOffHoursConfirm(true);
    } else {
      create.mutate();
    }
  }

  function addItem() { setItems(p => [...p, { product_id: '', item_name: '', qty_expected: '', is_urgent: false }]); }
  function updateItem(i, k, v) { setItems(p => p.map((x, idx) => idx === i ? { ...x, [k]: v } : x)); }
  function removeItem(i) { setItems(p => p.filter((_, idx) => idx !== i)); }

  function handleProductChange(i, productId) {
    const prod = supplierProducts.find(p => String(p.id) === String(productId));
    setItems(prev => prev.map((x, idx) => idx !== i ? x : {
      ...x,
      product_id: productId,
      item_name: prod ? (prod.name || prod.code || '') : x.item_name,
    }));
  }

  const offHours = offHoursReason(form.time_slot);
  const weekend  = weekendReason(form.scheduled_date);
  const holiday  = holidayReason(form.scheduled_date, holidays);

  return (
    <Modal open onClose={onClose} title="เพิ่มแผนส่งของ" size="lg">
      <div className="space-y-4">
        {error && <div className="text-danger text-small bg-red-50 dark:bg-red-900 px-3 py-2 rounded">{error}</div>}

        {/* Weekend / Off-hours confirmation step */}
        {offHoursConfirm && (offHours || weekend || holiday) && (
          <div className="border-2 border-orange-300 dark:border-orange-600 bg-orange-50 dark:bg-orange-900 rounded-lg p-4 space-y-3">
            <div className="flex items-start gap-2">
              <svg className="w-5 h-5 text-orange-500 dark:text-orange-200 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
              <div className="space-y-1.5">
                <p className="font-semibold text-orange-800 dark:text-orange-200">แจ้งเตือน: การนัดส่งสินค้าพิเศษ</p>
                {holiday && (
                  <p className="text-small text-orange-700 dark:text-orange-200">
                    <span className="font-semibold">วันหยุด:</span> {holiday} — กรุณายืนยันว่ามีเจ้าหน้าที่รับของ
                  </p>
                )}
                {weekend && !holiday && (
                  <p className="text-small text-orange-700 dark:text-orange-200">
                    <span className="font-semibold">วันหยุด:</span> {weekend} — กรุณายืนยันว่ามีเจ้าหน้าที่รับของ
                  </p>
                )}
                {offHours && (
                  <p className="text-small text-orange-700 dark:text-orange-200">
                    <span className="font-semibold">นอกเวลาทำงาน:</span> {offHours}
                  </p>
                )}
                <p className="text-small text-orange-700 dark:text-orange-200">ระบบจะส่งแจ้งเตือนไปยัง <strong>QC Staff, QC Supervisor, QC Manager และจัดซื้อ</strong> ทันที</p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setOffHoursConfirm(false)}>ย้อนกลับแก้ไข</Button>
              <Button variant="warning" onClick={() => create.mutate()} loading={create.isPending}>
                ยืนยัน — บันทึกและแจ้งเตือน
              </Button>
            </div>
          </div>
        )}

        {!offHoursConfirm && (
          <>
            <div className="space-y-3">
              <div>
                <label className="label">ผู้ผลิต (Supplier) *</label>
                <SearchableSelect
                  options={suppliers.map(s => ({ value: s.id, label: s.name }))}
                  value={form.supplier_id}
                  onChange={v => { setForm(p => ({ ...p, supplier_id: v })); setItems([]); }}
                  placeholder="ค้นหา Supplier..."
                  required
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label">วันที่ส่งของ *</label>
                  <input
                    type="date"
                    className="input"
                    min={todayStr}
                    value={form.scheduled_date}
                    onChange={e => {
                      const d = e.target.value;
                      setForm(p => ({
                        ...p,
                        scheduled_date: d,
                        time_slot: (d === todayStr && p.time_slot && parseInt(p.time_slot.split(':')[0], 10) <= nowHour) ? '' : p.time_slot,
                      }));
                    }}
                  />
                </div>
                <div>
                  <label className="label">เวลาที่นัด *</label>
                  <TimePicker
                    value={form.time_slot}
                    onChange={v => setForm(p => ({ ...p, time_slot: v }))}
                    minHour={form.scheduled_date === todayStr ? nowHour : undefined}
                  />
                </div>
              </div>
              <div>
                <label className="label">หมายเหตุ</label>
                <input className="input" placeholder="เช่น จำนวน lot, ข้อมูลเพิ่มเติม" value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
              </div>
            </div>

            {/* Items */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="label mb-0 text-danger">รายการสินค้า (ระบุรายการด่วนห้ามขาดส่ง)</label>
                <button
                  type="button"
                  onClick={addItem}
                  disabled={!form.supplier_id}
                  className="text-accent text-small hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  + เพิ่มรายการ
                </button>
              </div>
              {!form.supplier_id && items.length === 0 && (
                <p className="text-muted text-small">กรุณาเลือกผู้ผลิตก่อนเพิ่มรายการสินค้า</p>
              )}
              {items.map((item, i) => {
                const selectedElsewhere = new Set(items.filter((_, idx) => idx !== i).map(x => String(x.product_id)).filter(Boolean));
                return (
                <div key={i} className="p-2 bg-bg rounded border border-border space-y-2 mb-2">
                  <div className="flex gap-2 items-center">
                    <SearchableSelect
                      className="flex-1"
                      options={supplierProducts.filter(p => !selectedElsewhere.has(String(p.id))).map(p => ({ value: p.id, label: p.name + (p.code ? ` (${p.code})` : '') }))}
                      value={item.product_id}
                      onChange={v => handleProductChange(i, v)}
                      placeholder="-- เลือกสินค้า --"
                    />
                    <button type="button" onClick={() => removeItem(i)} className="text-muted hover:text-danger text-lg leading-none px-1 flex-shrink-0">×</button>
                  </div>
                  <div className="flex gap-2 items-center">
                    <input
                      className="input w-28"
                      placeholder="จำนวน"
                      type="number"
                      min="0"
                      value={item.qty_expected}
                      onChange={e => updateItem(i, 'qty_expected', e.target.value)}
                    />
                    <label className="flex items-center gap-1.5 text-small text-danger font-medium cursor-pointer flex-1">
                      <input
                        type="checkbox"
                        checked={item.is_urgent}
                        onChange={e => updateItem(i, 'is_urgent', e.target.checked)}
                        className="w-4 h-4 flex-shrink-0"
                      />
                      ด่วน! ห้ามขาดส่ง
                    </label>
                  </div>
                </div>
                );
              })}
            </div>

            {/* Attachments */}
            <div className="space-y-3">
              <div>
                <label className="label">แนบ Packing List / เอกสาร (ไม่บังคับ)</label>
                <div className="flex items-center gap-3">
                  <label className="inline-flex items-center gap-2 px-3 py-2 border border-border rounded cursor-pointer hover:bg-bg text-small">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                    เลือกไฟล์
                    <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png" className="hidden" ref={fileRef} onChange={e => setPendingFiles(Array.from(e.target.files))} />
                  </label>
                  {pendingFiles.length > 0 && <span className="text-small text-muted">{pendingFiles.length} ไฟล์</span>}
                </div>
              </div>

              {/* Sample toggle */}
              <label className="flex items-center gap-2.5 cursor-pointer w-fit">
                <input
                  type="checkbox"
                  checked={form.has_sample}
                  onChange={e => { setForm(p => ({ ...p, has_sample: e.target.checked })); if (!e.target.checked) setPendingSampleFiles([]); }}
                  className="w-4 h-4"
                />
                <span className="text-body font-medium text-text">ส่งงานตัวอย่าง</span>
              </label>

              {form.has_sample && (
                <div className="border border-accent/30 bg-blue-50 dark:bg-blue-900 rounded-lg p-3 space-y-2">
                  <p className="text-small font-medium text-accent">แนบรูปงานตัวอย่าง</p>
                  <div className="flex items-center gap-3">
                    <label className="inline-flex items-center gap-2 px-3 py-2 border border-accent/40 bg-surface rounded cursor-pointer hover:bg-blue-50 text-small text-accent">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      เลือกรูปภาพ
                      <input
                        type="file"
                        multiple
                        accept="image/*"
                        className="hidden"
                        ref={sampleFileRef}
                        onChange={e => setPendingSampleFiles(Array.from(e.target.files))}
                      />
                    </label>
                    {pendingSampleFiles.length > 0 && (
                      <span className="text-small text-muted">{pendingSampleFiles.length} รูป</span>
                    )}
                  </div>
                  {pendingSampleFiles.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-1">
                      {pendingSampleFiles.map((f, idx) => (
                        <div key={idx} className="relative w-16 h-16 rounded overflow-hidden border border-border bg-surface">
                          <img src={URL.createObjectURL(f)} alt="" className="w-full h-full object-cover" />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex gap-2 justify-end pt-2 border-t border-border">
              <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
              <Button onClick={handleSave} loading={create.isPending} disabled={!form.supplier_id || !form.scheduled_date || !form.time_slot}>
                {(holiday || weekend) ? 'บันทึกแผน (วันหยุด)' : offHours ? 'บันทึกแผน (นอกเวลา)' : 'บันทึกแผน'}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// ─── Unplanned Modal (QC Staff/Supervisor) ────────────────────────────────────

function UnplannedModal({ onClose, suppliers, defaultDate }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ supplier_id: '', scheduled_date: defaultDate || toDateStr(new Date()), time_slot: '', notes: '' });
  const [error, setError] = useState('');

  const create = useMutation({
    mutationFn: () => api.post('/delivery/unplanned', { ...form, supplier_id: +form.supplier_id }),
    onSuccess: () => { qc.invalidateQueries(['delivery']); onClose(); },
    onError: (e) => setError(e.response?.data?.error || 'เกิดข้อผิดพลาด'),
  });

  return (
    <Modal open onClose={onClose} title="บันทึกการส่งของไม่มีในแผน">
      <div className="space-y-4">
        <div className="bg-yellow-50 dark:bg-yellow-900 border border-yellow-200 dark:border-yellow-700 rounded px-3 py-2 text-small text-yellow-800 dark:text-yellow-200">
          ใช้สำหรับบันทึกเมื่อ Supplier มาส่งของโดยไม่มีการแจ้งล่วงหน้า หรือไม่มีในแผนจัดส่ง
        </div>
        {error && <div className="text-danger text-small bg-red-50 dark:bg-red-900 px-3 py-2 rounded">{error}</div>}
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="label">ผู้ผลิต (Supplier) *</label>
            <SearchableSelect
              options={suppliers.map(s => ({ value: s.id, label: s.name }))}
              value={form.supplier_id}
              onChange={v => setForm(p => ({ ...p, supplier_id: v }))}
              placeholder="ค้นหา Supplier..."
              required
            />
          </div>
          <div>
            <label className="label">วันที่ส่งของ *</label>
            <input type="date" className="input" value={form.scheduled_date} onChange={e => setForm(p => ({ ...p, scheduled_date: e.target.value }))} />
          </div>
          <div>
            <label className="label">เวลาที่มาส่ง</label>
            <TimePicker value={form.time_slot} onChange={v => setForm(p => ({ ...p, time_slot: v }))} />
          </div>
          <div className="col-span-2">
            <label className="label">หมายเหตุ</label>
            <input className="input" placeholder="รายละเอียดเพิ่มเติม..." value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
          </div>
        </div>
        <div className="flex gap-2 justify-end pt-2 border-t border-border">
          <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
          <Button variant="warning" onClick={() => create.mutate()} loading={create.isPending} disabled={!form.supplier_id || !form.scheduled_date}>
            บันทึกไม่มีแผนส่ง
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Calendar Cell Entry ──────────────────────────────────────────────────────

function EntryChip({ s, onClick }) {
  const past = isPastDelivery(s.scheduled_date, s.time_slot);
  const hasUrgent = Array.isArray(s.items) && s.items.some(it => it.is_urgent);
  const colors = {
    pending:      past ? 'bg-gray-200 dark:bg-gray-800 text-gray-500 dark:text-gray-200' : 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 hover:bg-blue-200',
    acknowledged: 'bg-teal-100 dark:bg-teal-900 text-teal-800 dark:text-teal-200 hover:bg-teal-200',
    on_time:      'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 hover:bg-green-200',
    late:         'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 hover:bg-red-200',
    cancelled:    'bg-gray-100 dark:bg-gray-900 text-gray-400',
    rescheduled:  'bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200 hover:bg-orange-200',
  };
  const strikeStatuses = new Set(['on_time', 'late', 'cancelled']);
  const pastPending = s.status === 'pending' && past;
  const shouldStrike = strikeStatuses.has(s.status) || pastPending;
  const unplannedCls = s.is_unplanned ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 hover:bg-yellow-200' : '';
  const baseCls = s.is_unplanned ? unplannedCls : (colors[s.status] || 'bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-200');
  const cls = hasUrgent ? 'bg-red-500 text-white hover:bg-red-600' : baseCls;
  const isDone = ['on_time', 'late'].includes(s.status);
  return (
    <button onClick={onClick}
      className={`w-full text-left rounded px-1.5 py-0.5 text-[12px] leading-snug font-medium truncate ${cls}`}
      title={`${s.supplier_name} ${s.time_slot || ''}${hasUrgent ? ' — มีรายการด่วน!' : ''}${isDone ? ' (ส่งของแล้ว)' : ''}`}>
      {s.time_slot && <span className="mr-1 opacity-70">{timeOfDay(s.time_slot.split(':')[0])?.label ?? s.time_slot}</span>}
      {hasUrgent && <span className="mr-1">(ด่วน!)</span>}
      <span>{s.supplier_name}</span>
      {isDone && <span className="ml-1 opacity-80">(ส่งของแล้ว)</span>}
    </button>
  );
}

// ─── Tag Summary Modal (คลิก tag สรุป — ดูรายการ + export Excel) ──────────────

// สถานะจริงต่อแถว — ไม่มีแผนส่ง (is_unplanned) แสดงป้าย "ไม่มีแผนส่ง" เฉพาะ แทนสถานะดิบ (เก็บเป็น on_time เสมอ)
function rowStatusBadge(s) {
  if (s.is_unplanned) return { label: 'ไม่มีแผนส่ง', cls: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200' };
  return STATUS_CFG[s.status] || { label: s.status, cls: 'bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-200' };
}
// ไม่มีแผนส่ง = วันที่/เวลาที่กรอกตอนบันทึกคือเวลาที่มาส่งจริง ไม่ใช่แผน ("แผนส่ง" จึงไม่มีความหมาย) —
// ย้ายไปแสดงในช่อง "ส่งจริง" แทน ให้ตรงกับความจริง (ตาม export/excel logic ฝั่ง server)
function planCell(s) { return s.is_unplanned ? '-' : `${s.scheduled_date} ${s.time_slot || ''}`; }
function actualCell(s) {
  if (s.is_unplanned) return `${s.scheduled_date} ${s.time_slot || ''}`;
  if (!s.actual_date) return '-';
  return `${s.actual_date}${s.actual_time ? ' ' + s.actual_time : ''}`;
}

function TagSummaryModal({ label, bucket, rows, from, to, onClose, onOpenDetail }) {
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      await downloadExcel('/delivery/export/excel', { from, to, bucket }, `delivery-${bucket}-${from}-${to}.xlsx`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`รายการ: ${label}`} size="xl">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-muted text-small">{rows.length} รายการ</p>
          <Button variant="secondary" onClick={handleExport} loading={exporting}>Export Excel</Button>
        </div>
        <div className="border border-border rounded-lg overflow-x-auto max-h-[60vh] overflow-y-auto">
          <table className="w-full text-small">
            <thead className="bg-bg sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left text-muted font-medium whitespace-nowrap">ผู้ผลิต</th>
                <th className="px-3 py-2 text-left text-muted font-medium whitespace-nowrap">สถานะ</th>
                <th className="px-3 py-2 text-left text-muted font-medium whitespace-nowrap">แผนส่ง</th>
                <th className="px-3 py-2 text-left text-muted font-medium whitespace-nowrap">ส่งจริง</th>
                <th className="px-3 py-2 text-left text-muted font-medium whitespace-nowrap">QC ผู้รับ</th>
                <th className="px-3 py-2 text-left text-muted font-medium">หมายเหตุ</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-muted">ไม่มีรายการ</td></tr>
              ) : rows.map(s => {
                const badge = rowStatusBadge(s);
                return (
                  <tr key={s.id} className="border-t border-border hover:bg-bg cursor-pointer" onClick={() => onOpenDetail(s)}>
                    <td className="px-3 py-2 whitespace-nowrap">{s.supplier_name}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[12px] font-medium ${badge.cls}`}>{badge.label}</span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{planCell(s)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{actualCell(s)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{s.received_by_name || '-'}</td>
                    <td className="px-3 py-2 max-w-[240px] truncate" title={s.notes || s.late_reason || ''}>{s.notes || s.late_reason || '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end pt-2 border-t border-border">
          <Button variant="ghost" onClick={onClose}>ปิด</Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DeliveryCalendar() {
  const { user } = useAuth();
  const role = user?.role;
  const today = toDateStr(new Date());
  const [searchParams, setSearchParams] = useSearchParams();

  const [viewMode, setViewMode] = useState('month');   // 'month' | 'day'
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(today);
  const [createOpen, setCreateOpen] = useState(false);
  const [unplannedOpen, setUnplannedOpen] = useState(false);
  const [selectedSchedule, setSelectedSchedule] = useState(null);
  const [tagModal, setTagModal] = useState(null); // { status, full } — คลิก summary tag เปิดดูรายการ

  // Deep-link จากลิงก์ในกระดิ่งแจ้งเตือน (เช่น "คลังรับทราบ Delivery" — /delivery?schedule=123) — เปิด
  // DetailModal ให้อัตโนมัติ แล้วล้าง query param ออกกันเปิดซ้ำตอน re-render/กด back
  // ต้อง dep บนค่า param จริง (ไม่ใช่ [] เฉยๆ) — ถ้าผู้ใช้อยู่หน้า /delivery อยู่แล้วแล้วกดลิงก์แจ้งเตือนใหม่
  // React Router ไม่ remount component (path เดิม แค่ query string เปลี่ยน) effect ที่ dep [] จะไม่ทำงานซ้ำ
  // ทำให้ modal ไม่เปิดจนกว่าจะรีเฟรชหน้าเอง (บั๊กที่ user รายงาน)
  const scheduleParam = searchParams.get('schedule');
  useEffect(() => {
    if (!scheduleParam) return;
    api.get(`/delivery/${scheduleParam}`).then(res => setSelectedSchedule(res.data)).catch(() => {});
    setSearchParams(prev => { prev.delete('schedule'); return prev; }, { replace: true });
  }, [scheduleParam, setSearchParams]);

  const year  = currentDate.getFullYear();
  const month = currentDate.getMonth(); // 0-based
  const from  = `${year}-${String(month+1).padStart(2,'0')}-01`;
  const to    = `${year}-${String(month+1).padStart(2,'0')}-${new Date(year, month+1, 0).getDate()}`;

  const { data: deliveryData, isLoading } = useQuery({
    queryKey: ['delivery', from, to],
    queryFn: () => api.get('/delivery', { params: { from, to, limit: 300 } }).then(r => r.data),
    staleTime: 0,
  });

  // รายปี — โหลดเฉพาะตอนสลับมาดู viewMode 'year' (ทั้งปีอาจมีหลายร้อยรายการ ไม่ต้องโหลดทุกครั้ง)
  const yearFrom = `${year}-01-01`;
  const yearTo   = `${year}-12-31`;
  const { data: yearData, isLoading: yearLoading } = useQuery({
    queryKey: ['delivery-year', year],
    queryFn: () => api.get('/delivery', { params: { from: yearFrom, to: yearTo, limit: 3000 } }).then(r => r.data),
    enabled: viewMode === 'year',
    staleTime: 0,
  });
  const yearSchedules = yearData?.data || [];
  const yearByDate = yearSchedules.reduce((acc, s) => {
    if (!acc[s.scheduled_date]) acc[s.scheduled_date] = [];
    acc[s.scheduled_date].push(s);
    return acc;
  }, {});

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api.get('/master/suppliers').then(r => r.data),
    staleTime: 300000,
  });

  const { data: holidays = [] } = useQuery({
    queryKey: ['holidays', year],
    queryFn: () => api.get(`/holidays?year=${year}`).then(r => r.data),
    staleTime: 3600000,
  });

  const schedules = deliveryData?.data || [];
  const holidaySet = new Set(holidays.map(h => h.holiday_date));

  // Summary tag ด้านบนปฏิทิน — ใช้ config ชุดเดียวกันทั้ง desktop (full label) และ mobile (short label) กัน
  // logic การนับซ้ำกัน 2 ที่ — _all_waiting/_completed เป็น status พิเศษ (ไม่ใช่ค่าจริงใน DB) รวมหลายสถานะเข้าด้วยกัน
  // bucketMatches ใช้ร่วมกันทั้ง count และ filter รายการตอนคลิก tag เปิด TagSummaryModal (ต้อง logic ตรงกันเป๊ะ)
  function bucketMatches(s, status) {
    if (status === '_unplanned') return !!s.is_unplanned;
    if (status === '_all_waiting') return ['pending', 'acknowledged'].includes(s.status) && !s.is_unplanned;
    // ส่งเสร็จสิ้น = รับเข้าแล้วจริง ไม่ว่าจะตามแผนหรือนอกแผน (นอกแผนบันทึกเป็น on_time เสมอ — CLAUDE.md §20)
    if (status === '_completed') return ['on_time', 'late'].includes(s.status);
    return s.status === status && !s.is_unplanned;
  }
  // Tag สรุปต้องนับตามช่วงที่กำลังดูอยู่จริง (รายปี/รายเดือน/รายวัน) — ไม่ใช่ยึดเดือนปัจจุบันเสมอ
  // (บั๊กที่ user รายงาน: สลับเป็นรายปีแล้วตัวเลขไม่รวมทั้งปี ยังโชว์แค่เดือนเดียว)
  const badgeSchedules = viewMode === 'year' ? yearSchedules
    : viewMode === 'day' ? schedules.filter(s => s.scheduled_date === selectedDate)
    : schedules;
  const badgeFrom = viewMode === 'year' ? yearFrom : viewMode === 'day' ? selectedDate : from;
  const badgeTo   = viewMode === 'year' ? yearTo   : viewMode === 'day' ? selectedDate : to;
  function summaryBadgeCount(status) { return badgeSchedules.filter(s => bucketMatches(s, status)).length; }
  const SUMMARY_BADGES = [
    // รอดำเนินการ: เอาออกจากหน้าจัดซื้อ (แสดงเฉพาะ role อื่น เช่น QC รับเข้า) ตามที่ user ระบุ
    { status: 'pending',      full: 'รอดำเนินการ',     short: 'รอ',         cls: 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200', hideFor: ['purchasing'] },
    { status: '_all_waiting', full: 'แผนรอส่งทั้งหมด', short: 'รอส่งทั้งหมด', cls: 'bg-indigo-100 dark:bg-indigo-900 text-indigo-800 dark:text-indigo-200' },
    { status: 'on_time',      full: 'ส่งตามแผน',       short: 'ตามแผน',     cls: 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200' },
    { status: 'late',         full: 'ส่งนอกแผน',       short: 'ส่งนอกแผน', cls: 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200' },
    { status: '_unplanned',   full: 'ไม่มีแผนส่ง',     short: 'ไม่มีแผนส่ง', cls: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200' },
    { status: '_completed',   full: 'ส่งเสร็จสิ้น',    short: 'เสร็จสิ้น',  cls: 'bg-teal-100 dark:bg-teal-900 text-teal-800 dark:text-teal-200' },
  ];

  // Group schedules by date, sorted by time_slot ascending
  const byDate = schedules.reduce((acc, s) => {
    const d = s.scheduled_date;
    if (!acc[d]) acc[d] = [];
    acc[d].push(s);
    acc[d].sort((a, b) => (a.time_slot || '').localeCompare(b.time_slot || ''));
    return acc;
  }, {});

  // Build calendar grid
  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  function prevMonth() { setCurrentDate(d => new Date(d.getFullYear(), d.getMonth()-1, 1)); }
  function nextMonth() { setCurrentDate(d => new Date(d.getFullYear(), d.getMonth()+1, 1)); }
  function prevYear()  { setCurrentDate(d => new Date(d.getFullYear()-1, d.getMonth(), 1)); }
  function nextYear()  { setCurrentDate(d => new Date(d.getFullYear()+1, d.getMonth(), 1)); }
  const navPrev = viewMode === 'year' ? prevYear : prevMonth;
  const navNext = viewMode === 'year' ? nextYear : nextMonth;
  function goToday()   { setCurrentDate(new Date()); setSelectedDate(today); setViewMode('day'); }

  // ต้อง sync currentDate (เดือน) ตามวันที่คลิกด้วยเสมอ — ไม่งั้นถ้าคลิกวันจากมุมมองรายปี (เดือนอื่นที่ไม่ใช่
  // เดือนที่ currentDate ชี้อยู่) query เดือนที่โหลดไว้ (schedules/byDate) จะไม่มีข้อมูลของวันนั้นเลย
  function openDay(dateStr) {
    const d = new Date(dateStr);
    setCurrentDate(new Date(d.getFullYear(), d.getMonth(), 1));
    setSelectedDate(dateStr);
    setViewMode('day');
  }

  const daySchedules = (byDate[selectedDate] || []).slice().sort((a,b) => (a.time_slot||'').localeCompare(b.time_slot||''));

  const canCreate     = role === 'purchasing';
  const canUnplanned  = ['qc_staff','qc_supervisor'].includes(role);

  // re-fetch single schedule for detail
  async function openDetail(s) {
    const res = await api.get(`/delivery/${s.id}`);
    setSelectedSchedule(res.data);
  }

  return (
    <div className="p-3 sm:p-4 md:p-6 max-w-6xl mx-auto lg:h-full lg:flex lg:flex-col lg:overflow-hidden">
      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3 lg:flex-shrink-0">
        <h1 className="text-[18px] sm:text-h2 font-bold text-primary">ปฏิทินแผนส่งของ</h1>
        <div className="flex gap-2">
          {canUnplanned && (
            <Button variant="warning" onClick={() => setUnplannedOpen(true)}>
              + ไม่มีแผนส่ง
            </Button>
          )}
          {canCreate && (
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              <span className="hidden sm:inline">+ เพิ่มแผนส่งของ</span>
              <span className="sm:hidden">+ เพิ่มแผน</span>
            </Button>
          )}
        </div>
      </div>

      {/* View toggle + month nav */}
      <div className="card mb-2 px-3 py-1.5 sm:p-3 space-y-1 sm:space-y-2 lg:flex-shrink-0">
        {/* ── Mobile: 2 แถว ── */}
        {/* แถว 1: ← ชื่อเดือนเต็ม → */}
        <div className="flex items-center sm:hidden">
          <button onClick={navPrev} className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded hover:bg-bg flex-shrink-0">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
          </button>
          <span className="flex-1 text-center font-semibold text-[13px] text-primary">
            {viewMode === 'year' ? `ปี ${year + 543}` : `${MONTHS_TH[month]} ${year + 543}`}
          </span>
          <button onClick={navNext} className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded hover:bg-bg flex-shrink-0">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
          </button>
        </div>
        {/* แถว 2: view toggle + วันนี้ */}
        <div className="flex items-center gap-2 sm:hidden">
          <div className="flex rounded overflow-hidden border border-border flex-1">
            <button onClick={() => setViewMode('year')}
              className={`flex-1 py-1 text-[12px] font-medium min-h-[36px] ${viewMode==='year' ? 'bg-primary text-white' : 'bg-surface text-text'}`}>
              ปี
            </button>
            <button onClick={() => setViewMode('month')}
              className={`flex-1 py-1 text-[12px] font-medium min-h-[36px] ${viewMode==='month' ? 'bg-primary text-white' : 'bg-surface text-text'}`}>
              เดือน
            </button>
            <button onClick={() => setViewMode('day')}
              className={`flex-1 py-1 text-[12px] font-medium min-h-[36px] ${viewMode==='day' ? 'bg-primary text-white' : 'bg-surface text-text'}`}>
              วัน
            </button>
          </div>
          <button onClick={goToday} className="px-3 py-1 text-[12px] border border-border rounded hover:bg-bg min-h-[36px] flex-shrink-0">
            วันนี้
          </button>
        </div>

        {/* ── Desktop: แถวเดียว ── */}
        <div className="hidden sm:flex sm:flex-wrap sm:items-center sm:gap-3">
          <div className="flex rounded-lg overflow-hidden border border-border">
            <button onClick={() => setViewMode('year')}
              className={`px-4 py-2 text-small font-medium min-h-[44px] ${viewMode==='year' ? 'bg-primary text-white' : 'bg-surface text-text hover:bg-bg'}`}>
              รายปี
            </button>
            <button onClick={() => setViewMode('month')}
              className={`px-4 py-2 text-small font-medium min-h-[44px] ${viewMode==='month' ? 'bg-primary text-white' : 'bg-surface text-text hover:bg-bg'}`}>
              รายเดือน
            </button>
            <button onClick={() => setViewMode('day')}
              className={`px-4 py-2 text-small font-medium min-h-[44px] ${viewMode==='day' ? 'bg-primary text-white' : 'bg-surface text-text hover:bg-bg'}`}>
              รายวัน
            </button>
          </div>
          <div className="flex items-center gap-2 ml-2">
            <button onClick={navPrev} className="p-2 rounded hover:bg-bg min-h-[44px] min-w-[44px] flex items-center justify-center">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
            </button>
            <span className="font-semibold text-body text-primary min-w-[140px] text-center">
              {viewMode === 'year' ? `ปี ${year + 543}` : `${MONTHS_TH[month]} ${year + 543}`}
            </span>
            <button onClick={navNext} className="p-2 rounded hover:bg-bg min-h-[44px] min-w-[44px] flex items-center justify-center">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
            </button>
            <button onClick={goToday} className="px-3 py-1.5 text-small border border-border rounded hover:bg-bg min-h-[44px]">วันนี้</button>
          </div>
          <div className="flex gap-2 flex-wrap ml-auto">
            {SUMMARY_BADGES.filter(b => !b.hideFor?.includes(role)).map(b => {
              const count = summaryBadgeCount(b.status);
              if (!count) return null;
              return (
                <button key={b.status} onClick={() => setTagModal(b)}
                  className={`px-2 py-0.5 rounded text-[12px] font-medium hover:opacity-80 transition-opacity ${b.cls}`}>
                  {b.full} {count}
                </button>
              );
            })}
          </div>
        </div>

        {/* Summary badges บน mobile */}
        <div className="flex gap-1.5 flex-wrap sm:hidden">
          {SUMMARY_BADGES.filter(b => !b.hideFor?.includes(role)).map(b => {
            const count = summaryBadgeCount(b.status);
            if (!count) return null;
            return (
              <button key={b.status} onClick={() => setTagModal(b)}
                className={`px-2 py-0.5 rounded text-[12px] font-medium ${b.cls}`}>
                {b.short} {count}
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── Yearly View ─── */}
      {viewMode === 'year' && (
        <div className="card p-3 lg:flex-1 lg:overflow-y-auto lg:min-h-0">
          {yearLoading ? (
            <div className="py-16 text-center text-muted">กำลังโหลด...</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {Array.from({ length: 12 }, (_, m) => {
                const mFirstDay = new Date(year, m, 1).getDay();
                const mDaysInMonth = new Date(year, m + 1, 0).getDate();
                const mCells = [];
                for (let i = 0; i < mFirstDay; i++) mCells.push(null);
                for (let d = 1; d <= mDaysInMonth; d++) mCells.push(d);
                return (
                  <div key={m} className="border border-border rounded-lg overflow-hidden">
                    <button
                      onClick={() => { setCurrentDate(new Date(year, m, 1)); setViewMode('month'); }}
                      className="w-full text-center py-1.5 bg-bg font-semibold text-small text-primary hover:bg-blue-50 dark:hover:bg-blue-900">
                      {MONTHS_TH[m]}
                    </button>
                    <div className="grid grid-cols-7 text-center pb-1">
                      {DAYS_TH.map((d, i) => (
                        <div key={d} className={`text-[10px] pt-1 ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-muted'}`}>{d[0]}</div>
                      ))}
                      {mCells.map((day, idx) => {
                        if (!day) return <div key={`e-${m}-${idx}`} className="py-1" />;
                        const dateStr = `${year}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                        const entries = yearByDate[dateStr] || [];
                        const isToday = dateStr === today;
                        const dow = (mFirstDay + day - 1) % 7;
                        const isHoliday = dow === 0 || holidaySet.has(dateStr);
                        const hasUrgent = entries.some(e => e.items?.some(it => it.is_urgent));
                        return (
                          <button key={dateStr} onClick={() => openDay(dateStr)}
                            className={`relative py-1 text-[11px] hover:bg-blue-50 dark:hover:bg-blue-900 ${isToday ? 'font-bold' : ''}`}>
                            <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full ${isToday ? 'bg-primary text-white' : isHoliday ? 'text-red-500 dark:text-red-200' : 'text-text'}`}>
                              {day}
                            </span>
                            {entries.length > 0 && (
                              <span className={`absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full ${hasUrgent ? 'bg-red-500' : 'bg-accent'}`} />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── Monthly View ─── */}
      {viewMode === 'month' && (
        <div className="card overflow-hidden lg:flex-1 lg:flex lg:flex-col lg:min-h-0">
          {/* Day headers */}
          <div className="grid grid-cols-7 border-b border-border lg:flex-shrink-0">
            {DAYS_TH.map((d, i) => (
              <div key={d} className={`py-1.5 text-center text-[12px] sm:text-small font-semibold ${i===0?'text-red-500 dark:text-red-200':i===6?'text-blue-500 dark:text-blue-200':'text-muted'}`}>{d}</div>
            ))}
          </div>
          {/* Calendar cells */}
          {isLoading ? (
            <div className="py-16 text-center text-muted">กำลังโหลด...</div>
          ) : (
            <div className="grid grid-cols-7 lg:flex-1 lg:auto-rows-fr lg:overflow-hidden">
              {cells.map((day, idx) => {
                if (!day) return <div key={`e-${idx}`} className="border-b border-r border-border bg-bg min-h-[52px] sm:min-h-[100px] lg:min-h-0" />;
                const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
                const entries = byDate[dateStr] || [];
                const isToday = dateStr === today;
                const isSelected = dateStr === selectedDate;
                const dow = (firstDay + day - 1) % 7;
                const isSunday = dow === 0;
                const isCompanyHoliday = holidaySet.has(dateStr);
                const isHoliday = isSunday || isCompanyHoliday;
                const holidayLabel = isSunday ? 'วันอาทิตย์' : (holidays.find(h => h.holiday_date === dateStr)?.name || '');
                return (
                  <div key={dateStr}
                    className={`border-b border-r border-border min-h-[52px] sm:min-h-[100px] lg:min-h-0 p-1 cursor-pointer transition-colors overflow-hidden
                      ${isToday ? 'bg-blue-50 dark:bg-blue-900' : isHoliday ? 'bg-red-50 dark:bg-red-900' : 'hover:bg-blue-50'} ${isSelected ? 'ring-1 ring-inset ring-accent' : ''}`}
                    onClick={() => openDay(dateStr)}>
                    <div className="flex items-start justify-between mb-0.5">
                      <div className={`text-[12px] sm:text-[12px] font-semibold w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center rounded-full flex-shrink-0
                        ${isToday ? 'bg-primary text-white' : dow===0?'text-red-500 dark:text-red-200':dow===6?'text-blue-500 dark:text-blue-200':'text-text'}`}>
                        {day}
                      </div>
                      {isHoliday && (
                        <span className="hidden sm:block text-[12px] font-medium text-red-500 dark:text-red-200 leading-tight text-right max-w-[48px] truncate" title={holidayLabel}>
                          {isCompanyHoliday && !isSunday ? holidayLabel : 'หยุด'}
                        </span>
                      )}
                    </div>
                    {/* Mobile: colored dots */}
                    {entries.length > 0 && (
                      <div className="flex flex-wrap gap-0.5 mt-0.5 sm:hidden">
                        {entries.slice(0, 5).map(s => {
                          const hasUrgent = s.items?.some(it => it.is_urgent);
                          const dotCls = hasUrgent ? 'bg-red-500' :
                            s.is_unplanned ? 'bg-yellow-500' :
                            s.status === 'on_time' ? 'bg-green-500' :
                            s.status === 'late' ? 'bg-red-400 dark:bg-red-700' :
                            s.status === 'acknowledged' ? 'bg-teal-500' :
                            s.status === 'rescheduled' ? 'bg-orange-500' :
                            s.status === 'cancelled' ? 'bg-gray-400 dark:bg-gray-700' : 'bg-blue-500';
                          return <span key={s.id} className={`w-2 h-2 rounded-full flex-shrink-0 ${dotCls}`} title={s.supplier_name} />;
                        })}
                        {entries.length > 5 && <span className="text-[12px] text-muted leading-tight">+{entries.length-5}</span>}
                      </div>
                    )}
                    {/* Desktop: text chips */}
                    <div className="hidden sm:block space-y-0.5">
                      {entries.slice(0,3).map(s => (
                        <EntryChip key={s.id} s={s} onClick={e => { e.stopPropagation(); openDetail(s); }} />
                      ))}
                      {entries.length > 3 && (
                        <p className="text-[12px] text-muted pl-1">+{entries.length-3} เพิ่มเติม</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── Daily View ─── */}
      {viewMode === 'day' && (
        <div className="space-y-3 lg:flex-1 lg:flex lg:flex-col lg:min-h-0">
          {/* Date selector row */}
          <div className="card p-3 flex items-center gap-2 flex-wrap lg:flex-shrink-0">
            <button onClick={() => setViewMode('month')} className="flex items-center gap-1 text-accent text-small hover:underline min-h-[44px] sm:hidden pr-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
              ปฏิทิน
            </button>
            <div className="flex items-center gap-2 flex-1">
              <label className="label mb-0 whitespace-nowrap hidden sm:block">เลือกวัน</label>
              <input type="date" className="input flex-1 sm:max-w-[180px]" value={selectedDate}
                onChange={e => {
                  setSelectedDate(e.target.value);
                  const d = new Date(e.target.value);
                  setCurrentDate(new Date(d.getFullYear(), d.getMonth(), 1));
                }} />
              <span className="text-muted text-small whitespace-nowrap">{daySchedules.length} รายการ</span>
            </div>
          </div>

          {daySchedules.length === 0 ? (
            <div className="card py-10 text-center text-muted lg:flex-1">ไม่มีแผนส่งของในวันนี้</div>
          ) : (
            <div className="space-y-2 lg:flex-1 lg:overflow-y-auto lg:min-h-0">
              {daySchedules.map(s => {
                const past = isPastDelivery(s.scheduled_date, s.time_slot);
                return (
                  <div key={s.id} className="card p-3 flex items-start gap-3 cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => openDetail(s)}>
                    {/* Time column */}
                    <div className="text-center min-w-[48px] flex-shrink-0">
                      <p className="text-[15px] sm:text-h3 font-bold text-primary font-mono">{s.time_slot || '—'}</p>
                      {past && <p className="text-[12px] text-muted mt-0.5">ผ่านแล้ว</p>}
                    </div>
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-small sm:text-body text-primary truncate">{s.supplier_name}</p>
                      <div className="mt-0.5">
                        <StatusBadge status={s.status} isUnplanned={s.is_unplanned} />
                      </div>
                      {s.notes && <p className="text-small text-muted truncate mt-0.5">{s.notes}</p>}
                      {s.items?.length > 0 && (
                        <p className="text-small text-muted mt-0.5">{s.items.length} รายการสินค้า</p>
                      )}
                    </div>
                    {/* Attachment indicator */}
                    {s.attachments?.length > 0 && (
                      <div className="flex-shrink-0 text-muted" title={`${s.attachments.length} ไฟล์แนบ`}>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                        </svg>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {createOpen && (
        <CreateModal
          onClose={() => setCreateOpen(false)}
          suppliers={suppliers}
          defaultDate={viewMode==='day' ? selectedDate : today}
          holidays={holidays}
        />
      )}
      {unplannedOpen && (
        <UnplannedModal
          onClose={() => setUnplannedOpen(false)}
          suppliers={suppliers}
          defaultDate={viewMode==='day' ? selectedDate : today}
        />
      )}
      {selectedSchedule && (
        <DetailModal
          schedule={selectedSchedule}
          onClose={() => setSelectedSchedule(null)}
          suppliers={suppliers}
          role={role}
          holidays={holidays}
        />
      )}
      {tagModal && (
        <TagSummaryModal
          label={tagModal.full}
          bucket={tagModal.status}
          rows={badgeSchedules.filter(s => bucketMatches(s, tagModal.status))}
          from={badgeFrom}
          to={badgeTo}
          onClose={() => setTagModal(null)}
          onOpenDetail={(s) => { setTagModal(null); openDetail(s); }}
        />
      )}
    </div>
  );
}
