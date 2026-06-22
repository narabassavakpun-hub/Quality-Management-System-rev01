import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../../utils/api';

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
const STATION_LABEL = Object.fromEntries(QC_STATIONS.map(s => [s.value, s.label]));

function thaiMonthYear(ym) {
  const [y, m] = ym.split('-').map(Number);
  const months = ['','มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  return `${months[m]} ${y + 543}`;
}

function fmtWorkHours(min) {
  if (min == null) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}ชม.${m}น.` : `${m}น.`;
}

function PctBar({ pct }) {
  if (pct == null) return <span className="text-muted text-[11px]">—</span>;
  const color = pct >= 90 ? '#16A34A' : pct >= 75 ? '#D97706' : '#DC2626';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden min-w-[40px]">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[11px] font-mono font-bold flex-shrink-0" style={{ color }}>{pct}%</span>
    </div>
  );
}

function GradeChip({ pct }) {
  if (pct == null) return null;
  const { label, bg, text } = pct >= 95
    ? { label: 'ดีเยี่ยม', bg: 'bg-green-100', text: 'text-green-700' }
    : pct >= 85
    ? { label: 'ดี',       bg: 'bg-blue-100',  text: 'text-blue-700' }
    : pct >= 75
    ? { label: 'พอใช้',   bg: 'bg-yellow-100', text: 'text-yellow-700' }
    : { label: 'ต้องปรับปรุง', bg: 'bg-red-100', text: 'text-red-700' };
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-semibold ${bg} ${text}`}>
      {label}
    </span>
  );
}

export default function AttendanceStats() {
  const navigate = useNavigate();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [sortBy, setSortBy] = useState('station'); // 'station' | 'pct' | 'late' | 'absent'
  const [filterStation, setFilterStation] = useState('all');

  const { data, isLoading } = useQuery({
    queryKey: ['attendance-monthly-summary', month],
    queryFn: () => api.get('/attendance/monthly-summary', { params: { month } }).then(r => r.data),
  });

  const employees = data?.employees || [];
  const workingDays = data?.working_days || 0;
  const shift = data?.shift || {};

  // Aggregate totals
  const totals = useMemo(() => {
    if (!employees.length) return null;
    const n = employees.length;
    return {
      avg_pct:     Math.round(employees.reduce((s, e) => s + (e.attendance_pct ?? 0), 0) / n),
      total_late:  employees.reduce((s, e) => s + e.total_late, 0),
      avg_absent:  (employees.reduce((s, e) => s + e.total_absent, 0) / n).toFixed(1),
      perfect:     employees.filter(e => e.total_absent === 0 && e.total_late === 0).length,
    };
  }, [employees]);

  // Filter + sort
  const displayed = useMemo(() => {
    let list = [...employees];
    if (filterStation !== 'all') list = list.filter(e => e.qc_station === filterStation);
    if (sortBy === 'pct')     list.sort((a, b) => (b.attendance_pct ?? 0) - (a.attendance_pct ?? 0));
    if (sortBy === 'late')    list.sort((a, b) => b.total_late - a.total_late);
    if (sortBy === 'absent')  list.sort((a, b) => b.total_absent - a.total_absent);
    if (sortBy === 'station') list.sort((a, b) => (a.qc_station || '').localeCompare(b.qc_station || '') || a.full_name.localeCompare(b.full_name));
    return list;
  }, [employees, sortBy, filterStation]);

  // Group by station (for station view)
  const byStation = useMemo(() => {
    const map = {};
    for (const s of QC_STATIONS) map[s.value] = { label: s.label, emps: [] };
    map['unassigned'] = { label: 'ยังไม่ระบุสถานี', emps: [] };
    for (const e of employees) {
      const key = map[e.qc_station] ? e.qc_station : 'unassigned';
      map[key].emps.push(e);
    }
    return map;
  }, [employees]);

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

  const SortBtn = ({ field, label }) => (
    <button
      onClick={() => setSortBy(field)}
      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
        sortBy === field ? 'bg-primary text-white' : 'bg-bg text-muted hover:text-text'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button onClick={() => navigate('/qc-attendance')} className="text-accent hover:underline flex items-center gap-1 text-small min-h-[44px]">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          กลับ
        </button>
        <div className="flex-1">
          <h1 className="text-h2 font-bold text-primary leading-tight">สรุปสถิติการมาทำงาน QC</h1>
          <p className="text-small text-muted">
            {thaiMonthYear(month)} · วันทำงาน {workingDays} วัน
            {shift.start && ` · เวลางาน ${shift.start}–${shift.end} น.`}
          </p>
        </div>
      </div>

      {/* Month navigator */}
      <div className="flex items-center justify-center gap-4 mb-4">
        <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-bg min-h-[40px] min-w-[40px] flex items-center justify-center">
          <svg className="w-5 h-5 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="font-bold text-primary text-h3 min-w-[180px] text-center">{thaiMonthYear(month)}</span>
        <button onClick={nextMonth} disabled={isCurrentMonth} className="p-2 rounded-lg hover:bg-bg min-h-[40px] min-w-[40px] flex items-center justify-center disabled:opacity-30">
          <svg className="w-5 h-5 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {isLoading ? (
        <div className="text-center text-muted py-12">กำลังโหลด...</div>
      ) : (
        <>
          {/* Summary KPI cards */}
          {totals && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              {[
                { label: 'พนักงาน QC', value: employees.length, sub: 'คนทั้งหมด', color: 'text-primary' },
                { label: 'เฉลี่ยการมา', value: `${totals.avg_pct}%`, sub: 'อัตราเฉลี่ย', color: totals.avg_pct >= 90 ? 'text-success' : totals.avg_pct >= 75 ? 'text-warning' : 'text-danger' },
                { label: 'มาสายรวม', value: totals.total_late, sub: 'ครั้ง (ทั้งแผนก)', color: totals.total_late > 0 ? 'text-warning' : 'text-muted' },
                { label: 'ไม่เคยขาด/สาย', value: totals.perfect, sub: `จาก ${employees.length} คน`, color: 'text-success' },
              ].map(k => (
                <div key={k.label} className="card p-4 text-center">
                  <div className={`text-2xl font-bold tabular-nums ${k.color}`}>{k.value}</div>
                  <div className="text-[11px] font-semibold text-text mt-1">{k.label}</div>
                  <div className="text-[10px] text-muted">{k.sub}</div>
                </div>
              ))}
            </div>
          )}

          {/* Filters + Sort */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <div className="flex items-center gap-1 bg-bg rounded-lg p-1">
              <SortBtn field="station" label="สถานี" />
              <SortBtn field="pct"     label="เปอร์เซ็นต์" />
              <SortBtn field="late"    label="สาย" />
              <SortBtn field="absent"  label="ขาด" />
            </div>
            <select
              className="input text-small py-1 ml-auto"
              value={filterStation}
              onChange={e => setFilterStation(e.target.value)}
            >
              <option value="all">ทุกสถานี ({employees.length} คน)</option>
              {QC_STATIONS.filter(s => byStation[s.value]?.emps.length > 0).map(s => (
                <option key={s.value} value={s.value}>
                  {s.label} ({byStation[s.value]?.emps.length || 0} คน)
                </option>
              ))}
            </select>
          </div>

          {/* Main table */}
          <div className="card overflow-hidden mb-4">
            <table className="w-full text-small">
              <thead>
                <tr className="bg-bg border-b border-border">
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-muted">#</th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-muted">ชื่อ</th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-muted hidden sm:table-cell">สถานี</th>
                  <th className="px-3 py-2.5 text-center text-[11px] font-semibold text-muted">มา</th>
                  <th className="px-3 py-2.5 text-center text-[11px] font-semibold text-muted">ขาด</th>
                  <th className="px-3 py-2.5 text-center text-[11px] font-semibold text-muted">สาย</th>
                  <th className="px-3 py-2.5 text-[11px] font-semibold text-muted min-w-[100px]">อัตราการมา</th>
                  <th className="px-3 py-2.5 text-center text-[11px] font-semibold text-muted hidden md:table-cell">เฉลี่ยงาน</th>
                  <th className="px-3 py-2.5 w-8" />
                </tr>
              </thead>
              <tbody>
                {displayed.length === 0 && (
                  <tr>
                    <td colSpan={9} className="text-center text-muted py-8">ไม่พบข้อมูล</td>
                  </tr>
                )}
                {displayed.map((e, i) => (
                  <tr
                    key={e.id}
                    className="border-b border-border last:border-0 hover:bg-bg/60 transition-colors cursor-pointer"
                    onClick={() => navigate(`/qc-attendance/employee/${e.id}`)}
                  >
                    <td className="px-4 py-2.5 text-muted text-[11px]">{i + 1}</td>
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-text">{e.full_name}</div>
                      <div className="sm:hidden text-[10px] text-muted">
                        {e.qc_station ? STATION_LABEL[e.qc_station] || e.qc_station : '—'}
                      </div>
                      <GradeChip pct={e.attendance_pct} />
                    </td>
                    <td className="px-3 py-2.5 text-muted text-[11px] hidden sm:table-cell">
                      {e.qc_station ? STATION_LABEL[e.qc_station] || e.qc_station : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className="font-mono font-bold text-success">{e.total_present}</span>
                      <span className="text-[10px] text-muted">/{workingDays}</span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`font-mono font-bold ${e.total_absent > 0 ? 'text-danger' : 'text-muted'}`}>
                        {e.total_absent}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {e.total_late > 0 ? (
                        <span className="font-mono font-bold text-warning">{e.total_late}</span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <PctBar pct={e.attendance_pct} />
                    </td>
                    <td className="px-3 py-2.5 text-center text-muted hidden md:table-cell">
                      {fmtWorkHours(e.avg_work_minutes)}
                    </td>
                    <td className="px-3 py-2.5">
                      <svg className="w-4 h-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Station summary cards */}
          {sortBy === 'station' && filterStation === 'all' && (
            <div className="space-y-2">
              <h3 className="text-small font-semibold text-muted uppercase tracking-wide">สรุปตามสถานี</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {QC_STATIONS.filter(s => byStation[s.value]?.emps.length > 0).map(s => {
                  const emps = byStation[s.value].emps;
                  const avgPct = emps.length
                    ? Math.round(emps.reduce((sum, e) => sum + (e.attendance_pct ?? 0), 0) / emps.length)
                    : null;
                  const lateCount = emps.reduce((sum, e) => sum + e.total_late, 0);
                  const pctColor = avgPct >= 90 ? 'text-success' : avgPct >= 75 ? 'text-warning' : 'text-danger';
                  return (
                    <div key={s.value} className="card p-3">
                      <div className="text-[11px] font-semibold text-primary mb-1.5">{s.label}</div>
                      <div className="flex items-end justify-between">
                        <div>
                          <div className={`text-xl font-bold tabular-nums ${pctColor}`}>{avgPct ?? '—'}%</div>
                          <div className="text-[10px] text-muted">{emps.length} คน</div>
                        </div>
                        {lateCount > 0 && (
                          <div className="text-right">
                            <div className="text-sm font-bold text-warning">{lateCount}</div>
                            <div className="text-[10px] text-muted">สาย</div>
                          </div>
                        )}
                      </div>
                      <div className="mt-2 h-1 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${avgPct || 0}%`,
                            background: avgPct >= 90 ? '#16A34A' : avgPct >= 75 ? '#D97706' : '#DC2626',
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Legend */}
          <div className="flex items-center gap-4 mt-4 pt-3 border-t border-border flex-wrap text-[11px] text-muted">
            <span>เกรด:</span>
            {[
              { label: 'ดีเยี่ยม ≥95%', color: 'text-green-700 bg-green-100' },
              { label: 'ดี 85–94%',     color: 'text-blue-700 bg-blue-100' },
              { label: 'พอใช้ 75–84%',  color: 'text-yellow-700 bg-yellow-100' },
              { label: 'ต้องปรับ <75%', color: 'text-red-700 bg-red-100' },
            ].map(l => (
              <span key={l.label} className={`px-2 py-0.5 rounded text-[10px] font-semibold ${l.color}`}>{l.label}</span>
            ))}
            <span className="ml-auto">คลิกแถวเพื่อดูประวัติ</span>
          </div>
        </>
      )}
    </div>
  );
}
