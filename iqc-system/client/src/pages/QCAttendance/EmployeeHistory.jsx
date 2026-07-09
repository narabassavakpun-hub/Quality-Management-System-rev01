import React, { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';

const QC_STATION_LABELS = {
  incoming: 'QC รับเข้า', plant1: 'QC โรง1', plant2: 'QC โรง2',
  plant4: 'QC โรง4', special: 'QC บานพิเศษ', calibration: 'QC Calibration',
  qc_admin: 'QC Admin', supervisor: 'QC Supervisor',
};

function fmtTime(dt) {
  if (!dt) return '—';
  const d = new Date(dt.includes('Z') || dt.includes('+') ? dt : dt + 'Z');
  return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

function fmtWorkHours(min) {
  if (min == null) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}ชม. ${m}น.` : `${m}น.`;
}

function thaiShortDate(d) {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  const months = ['','ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  return `${parseInt(day)} ${months[parseInt(m)]}`;
}

function thaiMonthYear(ym) {
  const [y, m] = ym.split('-').map(Number);
  const months = ['','มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  return `${months[m]} ${y + 543}`;
}

// Admin Override Modal
function OverrideModal({ entry, userId, date, onClose }) {
  const qc = useQueryClient();
  const isNew = !entry;
  const [form, setForm] = useState({
    check_in_at:  entry?.check_in_at  ? entry.check_in_at.slice(0,16).replace(' ','T').slice(11,16) : '',
    check_out_at: entry?.check_out_at ? entry.check_out_at.slice(0,16).replace(' ','T').slice(11,16) : '',
    admin_note:   entry?.admin_note   || '',
  });

  const save = useMutation({
    mutationFn: (body) => api.post('/attendance/admin/override', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attendance-employee'] });
      qc.invalidateQueries({ queryKey: ['qc-attendance-today'] });
      onClose();
    },
  });

  function handleSave() {
    save.mutate({
      user_id: userId,
      date,
      check_in_at:  form.check_in_at  ? `${date} ${form.check_in_at}` : null,
      check_out_at: form.check_out_at ? `${date} ${form.check_out_at}` : null,
      admin_note: form.admin_note || null,
    });
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4">
      <div className="bg-surface rounded-xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="font-bold text-text text-body">
            {isNew ? 'เพิ่มข้อมูลการเข้างาน' : 'แก้ไขข้อมูลการเข้างาน'}
          </h3>
          <button onClick={onClose} className="text-muted hover:text-text min-h-[32px] min-w-[32px] flex items-center justify-center">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-4 space-y-4">
          <div className="text-small text-muted bg-bg rounded-lg px-3 py-2">
            วันที่: <span className="font-semibold text-text">{thaiShortDate(date)} {date?.slice(0,4)}</span>
          </div>

          <div>
            <label className="label">เวลาเข้างาน</label>
            <input
              type="time"
              className="input font-mono"
              value={form.check_in_at}
              onChange={e => setForm(p => ({ ...p, check_in_at: e.target.value }))}
            />
          </div>
          <div>
            <label className="label">เวลาออกงาน</label>
            <input
              type="time"
              className="input font-mono"
              value={form.check_out_at}
              onChange={e => setForm(p => ({ ...p, check_out_at: e.target.value }))}
            />
          </div>
          <div>
            <label className="label">หมายเหตุ (Admin)</label>
            <input
              type="text"
              className="input"
              value={form.admin_note}
              onChange={e => setForm(p => ({ ...p, admin_note: e.target.value }))}
              placeholder="เช่น แก้ไขโดยหัวหน้า, ลาป่วย"
            />
          </div>

          {save.isError && (
            <div className="text-danger text-small bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded px-3 py-2">
              {save.error?.response?.data?.error || 'บันทึกไม่สำเร็จ'}
            </div>
          )}
        </div>
        <div className="flex gap-2 px-4 pb-4">
          <button onClick={onClose} className="btn-secondary flex-1 min-h-[44px]">ยกเลิก</button>
          <button onClick={handleSave} disabled={save.isPending} className="btn-primary flex-1 min-h-[44px] disabled:opacity-60">
            {save.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Calendar cell
function CalCell({ date, record, isToday, isFuture, isWeekend, onEdit, canEdit }) {
  const day = date ? parseInt(date.split('-')[2]) : null;
  let bg = '';
  let dot = null;

  if (!date) return <div />;

  if (isWeekend) {
    bg = 'bg-gray-50 dark:bg-gray-900';
    dot = <span className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-800 mx-auto mt-1 block" />;
  } else if (isFuture) {
    bg = '';
    dot = null;
  } else if (record?.check_in_at) {
    if ((record.late_minutes || 0) > 0) {
      bg = 'bg-orange-50 dark:bg-orange-900 border-orange-200 dark:border-orange-700';
      dot = <span className="w-1.5 h-1.5 rounded-full bg-orange-400 dark:bg-orange-700 mx-auto mt-1 block" />;
    } else {
      bg = 'bg-green-50 dark:bg-green-900 border-green-200 dark:border-green-700';
      dot = <span className="w-1.5 h-1.5 rounded-full bg-green-400 dark:bg-green-700 mx-auto mt-1 block" />;
    }
  } else {
    // Past workday with no check-in = absent
    bg = 'bg-red-50 dark:bg-red-900 border-red-200 dark:border-red-700';
    dot = <span className="w-1.5 h-1.5 rounded-full bg-red-300 dark:bg-red-800 mx-auto mt-1 block" />;
  }

  return (
    <button
      onClick={() => !isFuture && !isWeekend && canEdit && onEdit(date, record)}
      className={`rounded-lg border p-1.5 text-center transition-all min-h-[48px] flex flex-col items-center justify-center
        ${bg || 'border-transparent'}
        ${!isFuture && !isWeekend && canEdit ? 'hover:opacity-80 cursor-pointer' : 'cursor-default'}
        ${isToday ? 'ring-2 ring-primary ring-offset-1' : ''}`}
    >
      <span className={`text-small font-semibold ${isToday ? 'text-primary' : isWeekend ? 'text-muted' : 'text-text'}`}>
        {day}
      </span>
      {dot}
      {record?.check_in_at && (
        <span className="text-[9px] text-muted font-mono leading-none mt-0.5 hidden sm:block">
          {fmtTime(record.check_in_at)}
        </span>
      )}
    </button>
  );
}

export default function EmployeeHistory() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();

  const isOwnPage = String(user?.id) === String(userId);
  const canEdit        = ['admin', 'qc_manager'].includes(user?.role);
  const canViewHistory = ['qc_supervisor', 'qc_manager', 'admin'].includes(user?.role);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [overrideModal, setOverrideModal] = useState(null);

  const targetUserId = isOwnPage ? user.id : userId;

  // Fetch all QC employees for supervisor/manager/admin selector
  const { data: empList = [] } = useQuery({
    queryKey: ['attendance-employees'],
    queryFn: () => api.get('/attendance/employees').then(r => r.data),
    enabled: canViewHistory,
    staleTime: 5 * 60 * 1000,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['attendance-employee', targetUserId, month],
    queryFn: () => {
      if (isOwnPage) {
        return api.get('/attendance/my-history', { params: { month } }).then(r => ({
          user: { id: user.id, full_name: user.full_name, role: user.role, qc_station: user.qc_station },
          records: r.data.records,
          stats: (() => {
            const recs = r.data.records;
            return {
              total_present: recs.filter(x => x.check_in_at).length,
              total_late: recs.filter(x => (x.late_minutes || 0) > 0).length,
              avg_late_minutes: recs.length ? Math.round(recs.reduce((s, x) => s + (x.late_minutes || 0), 0) / Math.max(recs.filter(x => x.late_minutes > 0).length, 1)) : 0,
              avg_work_minutes: (() => {
                const worked = recs.filter(x => x.work_minutes != null);
                return worked.length ? Math.round(worked.reduce((s, x) => s + x.work_minutes, 0) / worked.length) : null;
              })(),
            };
          })(),
          shift: r.data.shift,
        }));
      }
      return api.get(`/attendance/employee/${targetUserId}/monthly`, { params: { month } }).then(r => r.data);
    },
    enabled: !!targetUserId,
  });

  const empUser  = data?.user   || {};
  const records  = data?.records || [];
  const stats    = data?.stats   || {};
  const shift    = data?.shift   || {};

  // Build a map from date → record
  const recMap = useMemo(() => {
    const m = {};
    records.forEach(r => { m[r.date] = r; });
    return m;
  }, [records]);

  // Calendar grid for the month
  const calGrid = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const firstDay = new Date(y, m - 1, 1);
    const lastDate = new Date(y, m, 0).getDate();
    const startDow = firstDay.getDay(); // 0=Sun
    // Start from Monday: offset = (startDow + 6) % 7
    const offset = (startDow + 6) % 7;
    const cells = [];
    for (let i = 0; i < offset; i++) cells.push(null);
    for (let d = 1; d <= lastDate; d++) {
      cells.push(`${month}-${String(d).padStart(2, '0')}`);
    }
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [month]);

  const todayStr = new Date().toLocaleDateString('sv-SE');

  // Working days in the month (Mon–Fri, not future)
  const workingDays = useMemo(() => {
    return calGrid.filter(d => {
      if (!d) return false;
      if (d > todayStr) return false;
      const dow = new Date(d).getDay();
      return dow !== 0 && dow !== 6;
    }).length;
  }, [calGrid, todayStr]);

  const presentPct = workingDays > 0
    ? Math.round(((stats.total_present || 0) / workingDays) * 100)
    : null;

  function prevMonth() {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  function nextMonth() {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m, 1);
    const now = new Date();
    if (d > new Date(now.getFullYear(), now.getMonth(), 1)) return;
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  const isCurrentMonth = month === new Date().toISOString().slice(0, 7);

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <button onClick={() => navigate('/qc-attendance')} className="text-accent hover:underline flex items-center gap-1 text-small min-h-[44px]">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          กลับ
        </button>
        <div className="flex-1">
          <h1 className="text-h2 font-bold text-primary leading-tight">ประวัติการเข้างาน</h1>
          {empUser.full_name && (
            <p className="text-small text-muted">
              {empUser.full_name}
              {empUser.qc_station && ` · ${QC_STATION_LABELS[empUser.qc_station] || empUser.qc_station}`}
            </p>
          )}
        </div>
        {/* Stats button for supervisor/manager/admin */}
        {canViewHistory && (
          <button
            onClick={() => navigate('/qc-attendance/stats')}
            className="btn-secondary flex items-center gap-1.5 min-h-[40px] px-3 text-small flex-shrink-0"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            สรุปสถิติ QC
          </button>
        )}
      </div>

      {/* Employee selector (supervisor/manager/admin) */}
      {canViewHistory && empList.length > 0 && (
        <div className="card p-3 mb-4 flex items-center gap-3 flex-wrap">
          <span className="text-small text-muted flex-shrink-0">เลือกพนักงาน:</span>
          <select
            className="input text-small flex-1 min-w-[200px]"
            value={String(targetUserId)}
            onChange={e => navigate(`/qc-attendance/employee/${e.target.value}`)}
          >
            <option value={String(user.id)}>— ของฉัน ({user.full_name}) —</option>
            <optgroup label="พนักงาน QC ทั้งหมด">
              {empList.map(e => (
                <option key={e.id} value={String(e.id)}>
                  {e.full_name}{e.qc_station ? ` (${QC_STATION_LABELS[e.qc_station] || e.qc_station})` : ''}
                </option>
              ))}
            </optgroup>
          </select>
          <span className="text-[11px] text-muted flex-shrink-0">{empList.length} คน</span>
        </div>
      )}


      {isLoading ? (
        <div className="text-center text-muted py-12">กำลังโหลด...</div>
      ) : (
        <>
          {/* Month navigator */}
          <div className="flex items-center justify-between mb-4">
            <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-bg min-h-[40px] min-w-[40px] flex items-center justify-center">
              <svg className="w-5 h-5 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h2 className="font-bold text-primary text-h3">{thaiMonthYear(month)}</h2>
            <button onClick={nextMonth} disabled={isCurrentMonth} className="p-2 rounded-lg hover:bg-bg min-h-[40px] min-w-[40px] flex items-center justify-center disabled:opacity-30">
              <svg className="w-5 h-5 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-4 gap-2 mb-4">
            {[
              { label: 'มาแล้ว', value: stats.total_present ?? 0, color: 'text-success', sub: `จาก ${workingDays} วันทำงาน` },
              { label: 'เข้างาน%', value: presentPct != null ? `${presentPct}%` : '—', color: presentPct >= 90 ? 'text-success' : presentPct >= 75 ? 'text-warning' : 'text-danger', sub: 'อัตราการมา' },
              { label: 'มาสาย', value: stats.total_late ?? 0, color: (stats.total_late || 0) > 0 ? 'text-warning' : 'text-muted', sub: 'ครั้ง' },
              { label: 'เฉลี่ยงาน', value: stats.avg_work_minutes ? fmtWorkHours(stats.avg_work_minutes) : '—', color: 'text-primary', sub: 'ต่อวัน' },
            ].map(s => (
              <div key={s.label} className="card p-3 text-center">
                <div className={`text-xl font-bold tabular-nums ${s.color}`}>{s.value}</div>
                <div className="text-[10px] font-semibold text-text mt-0.5">{s.label}</div>
                <div className="text-[9px] text-muted">{s.sub}</div>
              </div>
            ))}
          </div>

          {/* Calendar */}
          <div className="card p-3 mb-4">
            {/* Day headers */}
            <div className="grid grid-cols-7 mb-1">
              {['จ','อ','พ','พฤ','ศ','ส','อา'].map((d, i) => (
                <div key={i} className={`text-center text-[11px] font-semibold py-1 ${i >= 5 ? 'text-muted' : 'text-primary'}`}>
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {calGrid.map((date, i) => {
                if (!date) return <div key={i} />;
                const dow = new Date(date).getDay();
                const isWeekend = dow === 0 || dow === 6;
                const isFuture = date > todayStr;
                return (
                  <CalCell
                    key={i}
                    date={date}
                    record={recMap[date]}
                    isToday={date === todayStr}
                    isFuture={isFuture}
                    isWeekend={isWeekend}
                    canEdit={canEdit}
                    onEdit={(d, rec) => setOverrideModal({ date: d, record: rec })}
                  />
                );
              })}
            </div>
            {/* Legend */}
            <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border flex-wrap">
              {[
                { color: 'bg-green-400 dark:bg-green-700', label: 'ตรงเวลา' },
                { color: 'bg-orange-400 dark:bg-orange-700', label: 'สาย' },
                { color: 'bg-red-300 dark:bg-red-800',   label: 'ขาด' },
                { color: 'bg-gray-300 dark:bg-gray-800',  label: 'หยุด' },
              ].map(l => (
                <div key={l.label} className="flex items-center gap-1">
                  <span className={`w-2.5 h-2.5 rounded-full ${l.color} inline-block flex-shrink-0`} />
                  <span className="text-[10px] text-muted">{l.label}</span>
                </div>
              ))}
              {canEdit && (
                <span className="text-[10px] text-accent ml-auto">คลิกวันที่เพื่อแก้ไข</span>
              )}
            </div>
          </div>

          {/* History table */}
          <div className="card overflow-hidden mb-4">
            <div className="px-4 py-2.5 bg-bg border-b border-border flex items-center justify-between">
              <span className="font-semibold text-primary text-small">รายการ</span>
              {shift.start && (
                <span className="text-[11px] text-muted">เวลางาน {shift.start} – {shift.end} น.</span>
              )}
            </div>
            {records.length === 0 ? (
              <div className="text-center text-muted text-small py-6">ไม่มีข้อมูลเดือนนี้</div>
            ) : (
              <table className="w-full text-small">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-2 text-left text-[11px] text-muted font-semibold">วันที่</th>
                    <th className="px-3 py-2 text-center text-[11px] text-muted font-semibold">เข้า</th>
                    <th className="px-3 py-2 text-center text-[11px] text-muted font-semibold">ออก</th>
                    <th className="px-3 py-2 text-center text-[11px] text-muted font-semibold">สาย</th>
                    <th className="px-3 py-2 text-center text-[11px] text-muted font-semibold">ชั่วโมงงาน</th>
                    {canEdit && <th className="px-3 py-2 w-8" />}
                  </tr>
                </thead>
                <tbody>
                  {records.map(r => (
                    <tr key={r.date} className="border-b border-border last:border-0 hover:bg-bg/50 transition-colors">
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-text">{thaiShortDate(r.date)}</div>
                        {r.admin_note && (
                          <div className="text-[10px] text-accent italic truncate max-w-[100px]" title={r.admin_note}>
                            {r.admin_note}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center font-mono">
                        {r.check_in_at ? fmtTime(r.check_in_at) : <span className="text-muted">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-center font-mono">
                        {r.check_out_at ? fmtTime(r.check_out_at) : <span className="text-muted">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {(r.late_minutes || 0) > 0 ? (
                          <span className="text-[11px] text-warning font-medium">{r.late_minutes} น.</span>
                        ) : r.check_in_at ? (
                          <span className="text-[11px] text-success">ตรงเวลา</span>
                        ) : (
                          <span className="text-[11px] text-danger">ขาด</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center text-muted">
                        {fmtWorkHours(r.work_minutes)}
                      </td>
                      {canEdit && (
                        <td className="px-3 py-2.5 text-center">
                          <button
                            onClick={() => setOverrideModal({ date: r.date, record: r })}
                            className="text-muted hover:text-accent transition-colors p-1"
                            title="แก้ไข"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Add absent day (admin) */}
          {canEdit && (
            <button
              onClick={() => setOverrideModal({ date: todayStr, record: null })}
              className="w-full btn-secondary min-h-[44px] text-small flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              เพิ่ม / แก้ไขข้อมูลการเข้างาน
            </button>
          )}
        </>
      )}

      {/* Override modal */}
      {overrideModal && (
        <OverrideModal
          entry={overrideModal.record}
          userId={targetUserId}
          date={overrideModal.date}
          onClose={() => setOverrideModal(null)}
        />
      )}
    </div>
  );
}
