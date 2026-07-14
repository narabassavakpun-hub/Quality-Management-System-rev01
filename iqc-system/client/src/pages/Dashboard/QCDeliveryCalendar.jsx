import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import Modal from '../../components/UI/Modal';
import { CreateModal, DetailModal } from '../Delivery/index';

// ปฏิทินส่งของสำหรับ QCStaffDash โดยเฉพาะ (เพิ่ม Session 127) — ต่างจาก MiniDeliveryCalendar.jsx ต้นฉบับ
// (ที่ PurchasingDash/WarehouseDash/SupervisorDash ใช้ร่วมกัน) ตรงที่มีปุ่มเลือกมุมมอง รายปี/รายเดือน/รายวัน ได้
// (ตามคำขอ user) — แยกไฟล์ต่างหากแทนที่จะแก้ MiniDeliveryCalendar.jsx ตัวต้นฉบับ เพราะ feature นี้ user ขอเฉพาะ
// กล่องปฏิทินในหน้านี้ ไม่ได้ขอให้กระทบหน้า dashboard อื่นที่ใช้ MiniDeliveryCalendar.jsx ร่วมกันอยู่
// ใช้ semantic theme token (bg-surface/text-text ฯลฯ) เหมือนต้นฉบับ — รองรับ light/dark ทันที (ตามคำขอ "เพิ่มโหมด
// สว่าง" รอบนี้ที่ทำให้ทั้งหน้า QCStaffDash เลิกใช้ dark D-token ตายตัวแล้ว)
const DAYS_TH = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const MONTHS_TH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const MONTHS_TH_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

function toDateStr(d) { return d.toISOString().slice(0, 10); }
function pad(n) { return String(n).padStart(2, '0'); }

export default function QCDeliveryCalendar() {
  const { user } = useAuth();
  const [viewMode, setViewMode] = useState('month'); // 'year' | 'month' | 'day'
  const [currentDate, setCurrentDate] = useState(new Date());
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedSchedule, setSelectedSchedule] = useState(null);
  const [dayPopover, setDayPopover] = useState(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const today = toDateStr(new Date());

  const isYearView = viewMode === 'year';
  const from = isYearView ? `${year}-01-01` : `${year}-${pad(month + 1)}-01`;
  const to = isYearView ? `${year}-12-31` : `${year}-${pad(month + 1)}-${new Date(year, month + 1, 0).getDate()}`;

  const { data: deliveryData, isLoading } = useQuery({
    queryKey: ['delivery', from, to],
    queryFn: () => api.get('/delivery', { params: { from, to, limit: 500 } }).then(r => r.data),
  });
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
  const byDate = schedules.reduce((acc, s) => { (acc[s.scheduled_date] = acc[s.scheduled_date] || []).push(s); return acc; }, {});

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthCells = [];
  for (let i = 0; i < firstDay; i++) monthCells.push(null);
  for (let d = 1; d <= daysInMonth; d++) monthCells.push(d);

  const canCreate = user?.role === 'purchasing';

  function goPrev() {
    setCurrentDate(d => {
      if (viewMode === 'day') return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
      if (viewMode === 'year') return new Date(d.getFullYear() - 1, d.getMonth(), 1);
      return new Date(d.getFullYear(), d.getMonth() - 1, 1);
    });
  }
  function goNext() {
    setCurrentDate(d => {
      if (viewMode === 'day') return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
      if (viewMode === 'year') return new Date(d.getFullYear() + 1, d.getMonth(), 1);
      return new Date(d.getFullYear(), d.getMonth() + 1, 1);
    });
  }

  async function openDetail(s) {
    const res = await api.get(`/delivery/${s.id}`);
    setSelectedSchedule(res.data);
  }
  function handleDayClick(dateStr, entries) {
    if (!entries.length) return;
    if (entries.length === 1) openDetail(entries[0]);
    else setDayPopover(dateStr);
  }

  const headerLabel = viewMode === 'day'
    ? `${currentDate.getDate()} ${MONTHS_TH[month]} ${year + 543}`
    : viewMode === 'year'
      ? `${year + 543}`
      : `${MONTHS_TH[month]} ${year + 543}`;

  const dayViewDateStr = `${year}-${pad(month + 1)}-${pad(currentDate.getDate())}`;
  const dayViewEntries = (byDate[dayViewDateStr] || []).sort((a, b) => (a.time_slot || '').localeCompare(b.time_slot || ''));

  const monthCounts = Array.from({ length: 12 }, (_, i) => {
    const mStr = `${year}-${pad(i + 1)}`;
    return schedules.filter(s => s.scheduled_date.startsWith(mStr)).length;
  });

  return (
    <div className="card flex flex-col h-full">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 className="text-h3 font-semibold text-primary">ปฏิทินส่งของ</h2>
        {canCreate && (
          <button
            onClick={() => setCreateOpen(true)}
            className="px-3 py-1.5 text-small font-medium rounded-md bg-primary text-white hover:opacity-90 min-h-[36px] flex-shrink-0"
          >
            + เพิ่มแผนส่งของ
          </button>
        )}
      </div>

      {/* ปุ่มเลือกมุมมอง — รายปี/รายเดือน/รายวัน */}
      <div className="flex items-center gap-1.5 mb-3">
        {[['year', 'รายปี'], ['month', 'รายเดือน'], ['day', 'รายวัน']].map(([v, l]) => (
          <button
            key={v}
            onClick={() => setViewMode(v)}
            className={`px-3 py-1.5 text-small font-medium rounded-md transition-colors ${
              viewMode === v ? 'bg-primary text-white' : 'bg-bg text-muted hover:text-text'
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between mb-3">
        <button onClick={goPrev} className="w-8 h-8 flex items-center justify-center rounded hover:bg-bg text-muted">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <span className="text-body font-semibold text-primary">{headerLabel}</span>
        <button onClick={goNext} className="w-8 h-8 flex items-center justify-center rounded hover:bg-bg text-muted">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        </button>
      </div>

      {isLoading ? (
        <p className="text-center text-muted text-small flex-1 flex items-center justify-center">กำลังโหลด...</p>
      ) : viewMode === 'month' ? (
        <div className="grid grid-cols-7 gap-y-1.5 text-center">
          {DAYS_TH.map((d, i) => (
            <div key={d} className={`text-small font-medium ${i === 0 ? 'text-red-500 dark:text-red-400' : i === 6 ? 'text-blue-500 dark:text-blue-400' : 'text-muted'}`}>{d}</div>
          ))}
          {monthCells.map((day, idx) => {
            if (!day) return <div key={`e${idx}`} />;
            const dateStr = `${year}-${pad(month + 1)}-${pad(day)}`;
            const entries = byDate[dateStr] || [];
            const isToday = dateStr === today;
            const hasUrgent = entries.some(s => Array.isArray(s.items) && s.items.some(it => it.is_urgent));
            return (
              <button
                key={dateStr}
                onClick={() => handleDayClick(dateStr, entries)}
                disabled={entries.length === 0}
                className={`relative mx-auto w-9 h-9 flex flex-col items-center justify-center rounded-full text-body transition-colors ${
                  isToday ? 'bg-primary text-white font-bold' : entries.length ? 'hover:bg-bg text-text cursor-pointer' : 'text-muted cursor-default'
                }`}
              >
                {day}
                {entries.length > 0 && (
                  <span className={`absolute bottom-0.5 w-1.5 h-1.5 rounded-full ${hasUrgent ? 'bg-danger' : isToday ? 'bg-white' : 'bg-accent'}`} />
                )}
              </button>
            );
          })}
        </div>
      ) : viewMode === 'day' ? (
        <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
          {dayViewEntries.length === 0 ? (
            <p className="text-center text-muted text-small py-6">ไม่มีแผนส่งของวันนี้</p>
          ) : dayViewEntries.map(s => (
            <button
              key={s.id}
              onClick={() => openDetail(s)}
              className="w-full text-left px-3 py-2.5 rounded-md hover:bg-bg text-body min-h-[44px] flex items-center gap-2"
            >
              <span className="font-mono text-muted flex-shrink-0">{s.time_slot || '-'}</span>
              <span className="text-text truncate">{s.supplier_name}</span>
            </button>
          ))}
        </div>
      ) : (
        // year view — 12 เดือนย่อ พร้อมจำนวนแผนส่งของ กดแล้วสลับไปมุมมองรายเดือนของเดือนนั้น
        <div className="grid grid-cols-3 gap-2">
          {MONTHS_TH_SHORT.map((m, i) => (
            <button
              key={m}
              onClick={() => { setCurrentDate(new Date(year, i, 1)); setViewMode('month'); }}
              className="rounded-md p-2.5 text-center hover:bg-bg transition-colors border border-border"
            >
              <p className="text-small font-medium text-text">{m}</p>
              <p className={`text-h3 font-bold ${monthCounts[i] > 0 ? 'text-primary' : 'text-muted'}`}>{monthCounts[i]}</p>
            </button>
          ))}
        </div>
      )}

      {createOpen && (
        <CreateModal
          onClose={() => setCreateOpen(false)}
          suppliers={suppliers}
          defaultDate={viewMode === 'day' ? dayViewDateStr : today}
          holidays={holidays}
        />
      )}
      {selectedSchedule && (
        <DetailModal
          schedule={selectedSchedule}
          onClose={() => setSelectedSchedule(null)}
          suppliers={suppliers}
          role={user?.role}
          holidays={holidays}
        />
      )}
      {dayPopover && (
        <Modal open onClose={() => setDayPopover(null)} title={`รายการวันที่ ${dayPopover}`} size="sm">
          <div className="space-y-1">
            {(byDate[dayPopover] || []).map(s => (
              <button
                key={s.id}
                onClick={() => { setDayPopover(null); openDetail(s); }}
                className="w-full text-left px-2.5 py-2 rounded-md hover:bg-bg text-small min-h-[44px] flex items-center gap-2"
              >
                <span className="font-mono text-muted">{s.time_slot || '-'}</span>
                <span className="text-text">{s.supplier_name}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
