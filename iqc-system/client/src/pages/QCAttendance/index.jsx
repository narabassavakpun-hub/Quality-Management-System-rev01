import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';

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

function fmtCheckIn(dt) {
  if (!dt) return null;
  const d = new Date(dt.includes('Z') || dt.includes('+') ? dt : dt + 'Z');
  return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

function fmtWorkHours(min) {
  if (min == null) return null;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}ชม. ${m}น.` : `${m}น.`;
}

function LiveClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="font-mono text-h2 font-bold text-primary tabular-nums">
      {time.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
    </span>
  );
}

function StatusBadge({ row }) {
  if (!row.check_in_at) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-900 text-gray-500 dark:text-gray-200 text-[11px] font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-700 inline-block" />
        ยังไม่เช็ค
      </span>
    );
  }
  if ((row.late_minutes || 0) > 0) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-200 text-[11px] font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-orange-500 inline-block" />
        สาย {row.late_minutes} น.
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200 text-[11px] font-medium">
      <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block animate-pulse" />
      มาแล้ว
    </span>
  );
}

function SummaryBar({ summary }) {
  const pct = summary.total > 0 ? Math.round((summary.checked_in / summary.total) * 100) : 0;
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-success">{summary.checked_in}</div>
            <div className="text-[11px] text-muted">มาแล้ว</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-warning">{summary.late || 0}</div>
            <div className="text-[11px] text-muted">สาย</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-danger">{summary.absent || 0}</div>
            <div className="text-[11px] text-muted">ขาด</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-muted">{summary.total}</div>
            <div className="text-[11px] text-muted">ทั้งหมด</div>
          </div>
        </div>
        <div className="text-right hidden sm:block">
          <div className="text-3xl font-bold text-primary tabular-nums">{pct}%</div>
          <div className="text-[11px] text-muted">เข้างานแล้ว</div>
        </div>
      </div>
      <div className="h-2 bg-gray-100 dark:bg-gray-900 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${pct}%`,
            background: pct >= 90 ? '#16A34A' : pct >= 70 ? '#D97706' : '#DC2626',
          }}
        />
      </div>
    </div>
  );
}

function StationCard({ station, members, navigate, canViewHistory }) {
  const checked = members.filter(m => m.check_in_at).length;
  const late    = members.filter(m => (m.late_minutes || 0) > 0).length;
  const absent  = members.filter(m => !m.check_in_at).length;

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-2.5 bg-bg border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-primary text-body">{station.label}</span>
          {late > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-200 font-medium">
              สาย {late}
            </span>
          )}
        </div>
        <span className="text-small text-muted">
          <span className={`font-semibold ${checked === members.length ? 'text-success' : 'text-warning'}`}>
            {checked}
          </span>/{members.length} คน
        </span>
      </div>
      <table className="w-full text-small">
        <tbody>
          {members.map(m => (
            <tr key={m.id} className="border-b border-border last:border-0 hover:bg-bg/60 transition-colors">
              <td className="px-4 py-2.5">
                <button
                  onClick={() => canViewHistory && navigate(`/qc-attendance/employee/${m.id}`)}
                  className={`font-medium text-text ${canViewHistory ? 'hover:text-accent hover:underline' : ''} text-left`}
                >
                  {m.full_name}
                </button>
              </td>
              <td className="px-3 py-2.5">
                <StatusBadge row={m} />
              </td>
              <td className="px-3 py-2.5 text-muted font-mono text-[11px] text-right">
                {m.check_in_at ? fmtCheckIn(m.check_in_at) : '—'}
              </td>
              <td className="px-3 py-2.5 text-muted text-[11px] text-right">
                {m.check_out_at ? (
                  <span className="text-accent">ออก {fmtCheckIn(m.check_out_at)}</span>
                ) : m.check_in_at ? (
                  <span className="text-success/70">กำลังทำงาน</span>
                ) : null}
              </td>
              <td className="px-3 py-2.5 text-[11px] text-right text-muted">
                {m.work_minutes != null ? fmtWorkHours(m.work_minutes) : ''}
              </td>
              <td className="px-3 py-2.5 text-center">
                {m.check_in_at && m.geofence_ok ? (
                  <svg className="w-3.5 h-3.5 text-success mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" title="ยืนยัน Geofence">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  </svg>
                ) : null}
              </td>
              {m.admin_note ? (
                <td className="px-3 py-2.5 text-[10px] text-muted italic max-w-[120px] truncate" title={m.admin_note}>
                  {m.admin_note}
                </td>
              ) : <td />}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function QCAttendanceOverview() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [date, setDate] = useState(new Date().toLocaleDateString('sv-SE'));
  const isToday = date === new Date().toLocaleDateString('sv-SE');

  const canViewHistory = ['qc_supervisor', 'qc_manager', 'admin'].includes(user?.role);
  const canCheckIn = ['qc_staff', 'qc_supervisor'].includes(user?.role);
  const isStaffOnly = user?.role === 'qc_staff';

  const { data, isLoading } = useQuery({
    queryKey: ['qc-attendance-today', date],
    queryFn: () => api.get('/attendance/today', { params: { date } }).then(r => r.data),
    refetchInterval: isToday ? false : 60000, // SSE handles real-time for today
    enabled: canViewHistory,
  });

  const { data: myStatus } = useQuery({
    queryKey: ['attendance-my-status'],
    queryFn: () => api.get('/attendance/my-status').then(r => r.data),
    enabled: canCheckIn,
    staleTime: 0,
  });

  const groups  = data?.groups  || {};
  const summary = data?.summary || { total: 0, checked_in: 0, late: 0, absent: 0, checked_out: 0 };
  const shift   = data?.shift   || {};

  const thaiDate = (d) => {
    if (!d) return '';
    const [y, m, day] = d.split('-');
    const months = ['','ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    return `${parseInt(day)} ${months[parseInt(m)]} ${parseInt(y) + 543}`;
  };

  return (
    <div className="max-w-4xl mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-h2 font-bold text-primary">เช็คชื่อพนักงาน QC</h1>
          <div className="flex items-center gap-3 mt-0.5">
            {isToday && <LiveClock />}
            <span className="text-small text-muted">{thaiDate(date)}</span>
            {shift.start && (
              <span className="text-[11px] text-muted">
                เวลางาน {shift.start} – {shift.end} น.
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="date"
            className="input text-small"
            value={date}
            onChange={e => setDate(e.target.value)}
          />
          {canCheckIn && (
            <button
              onClick={() => navigate('/qc-attendance/checkin')}
              className="btn-primary flex items-center gap-2 min-h-[44px] px-4"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              {myStatus?.checked_in && !myStatus?.checked_out ? 'เช็คออก / ดูสถานะ' : myStatus?.checked_in ? 'เช็คชื่อแล้ว' : 'เช็คชื่อเข้างาน'}
            </button>
          )}
          {canViewHistory && (
            <button
              onClick={() => navigate(`/qc-attendance/employee/${user.id}`)}
              className="btn-secondary flex items-center gap-1.5 min-h-[44px] px-3 text-small"
            >
              ประวัติของฉัน
            </button>
          )}
        </div>
      </div>

      {/* Own status card (for qc_staff) */}
      {canCheckIn && myStatus && (
        <div className={`card p-3 mb-4 flex items-center gap-4 border-l-4 ${
          myStatus.checked_in
            ? (myStatus.late_minutes > 0 ? 'border-warning' : 'border-success')
            : 'border-border'
        }`}>
          <div className="flex-1 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
              myStatus.checked_in ? 'bg-green-100 dark:bg-green-900' : 'bg-gray-100 dark:bg-gray-900'
            }`}>
              {myStatus.checked_in ? (
                <svg className="w-5 h-5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
            </div>
            <div>
              <div className="font-semibold text-text text-small">
                {myStatus.checked_in
                  ? `เช็คชื่อแล้ว ${fmtCheckIn(myStatus.check_in_at)} น.`
                  : `ยังไม่เช็คชื่อ (เปิดงาน ${myStatus.shift_start} น.)`}
              </div>
              <div className="text-[11px] text-muted flex items-center gap-2 mt-0.5">
                {myStatus.late_minutes > 0 && <span className="text-warning">สาย {myStatus.late_minutes} นาที</span>}
                {myStatus.checked_out && myStatus.work_minutes != null && (
                  <span>ทำงาน {fmtWorkHours(myStatus.work_minutes)}</span>
                )}
                {myStatus.checked_in && !myStatus.checked_out && <span className="text-success">กำลังทำงาน</span>}
              </div>
            </div>
          </div>
          <button
            onClick={() => navigate('/qc-attendance/checkin')}
            className="btn-secondary text-small min-h-[36px] px-3 flex-shrink-0"
          >
            {myStatus.checked_in && !myStatus.checked_out ? 'เช็คออก' : myStatus.checked_in ? 'ดูรายละเอียด' : 'เช็คชื่อ'}
          </button>
        </div>
      )}

      {/* Summary bar (supervisor/admin) */}
      {canViewHistory && !isLoading && (
        <div className="mb-4">
          <SummaryBar summary={summary} />
        </div>
      )}

      {/* Staff grid (supervisor/admin only) */}
      {canViewHistory && (
        <>
          {isLoading ? (
            <div className="text-center text-muted py-10">กำลังโหลด...</div>
          ) : (
            <div className="space-y-3">
              {QC_STATIONS.map(station => {
                const members = groups[station.value] || [];
                if (members.length === 0) return null;
                return (
                  <StationCard
                    key={station.value}
                    station={station}
                    members={members}
                    navigate={navigate}
                    canViewHistory={canViewHistory}
                  />
                );
              })}

              {(groups['unassigned'] || []).length > 0 && (
                <StationCard
                  station={{ value: 'unassigned', label: 'ยังไม่ระบุสถานี' }}
                  members={groups['unassigned']}
                  navigate={navigate}
                  canViewHistory={canViewHistory}
                />
              )}

              {summary.total === 0 && (
                <div className="text-center text-muted py-10">ไม่พบข้อมูลพนักงาน QC</div>
              )}
            </div>
          )}
        </>
      )}

      {/* Staff-only view: just own status + shortcut to history */}
      {isStaffOnly && (
        <div className="mt-4">
          <button
            onClick={() => navigate(`/qc-attendance/employee/${user.id}`)}
            className="w-full card p-4 text-left hover:bg-bg/60 transition-colors flex items-center justify-between"
          >
            <div>
              <div className="font-semibold text-text">ประวัติการเข้างานของฉัน</div>
              <div className="text-small text-muted mt-0.5">ดูสถิติและประวัติรายเดือน</div>
            </div>
            <svg className="w-5 h-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
