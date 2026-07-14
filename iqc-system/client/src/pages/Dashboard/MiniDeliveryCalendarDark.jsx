import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import Modal from '../../components/UI/Modal';
import { CreateModal, DetailModal } from '../Delivery/index';
import { D } from './shared';

// เวอร์ชัน dark-token ของ MiniDeliveryCalendar.jsx (เพิ่ม Session 127 สำหรับ QCStaffDash โดยเฉพาะ แทนที่กล่อง
// "อัตราผ่านการตรวจ" เดิม) — คัดลอก logic ปฏิทิน/วันหยุด/click-to-detail มาจากตัวต้นฉบับ แต่เปลี่ยนจาก semantic
// theme token (bg-surface/.card ฯลฯ) เป็น D token (dark ตายตัว) เพราะทั้งหน้า QCStaffDash ใช้ inline dark palette
// ถาวรเสมอ (CLAUDE.md §25.2) — ถ้าใช้ .card เดิมตรงๆ จะเป็นกล่องขาวลอยอยู่บนพื้นมืดตอน user ตั้ง light mode
// (ปัญหาเดียวกับที่แก้ไปแล้วตอนเพิ่ม "รอรับเข้าวันนี้"/"บิลล่าสุด" ในไฟล์นี้ก่อนหน้านี้) — CreateModal/DetailModal
// เป็น overlay แยกชั้นจากพื้นหลังหน้า จึงใช้ของเดิม (semantic token) ต่อได้ปกติ ไม่มีปัญหาเดียวกัน
const DAYS_TH = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const MONTHS_TH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

function toDateStr(d) { return d.toISOString().slice(0, 10); }

export default function MiniDeliveryCalendarDark() {
  const { user } = useAuth();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedSchedule, setSelectedSchedule] = useState(null);
  const [dayPopover, setDayPopover] = useState(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const from = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const to = `${year}-${String(month + 1).padStart(2, '0')}-${new Date(year, month + 1, 0).getDate()}`;

  const { data: deliveryData, isLoading } = useQuery({
    queryKey: ['delivery', from, to],
    queryFn: () => api.get('/delivery', { params: { from, to, limit: 300 } }).then(r => r.data),
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
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const canCreate = user?.role === 'purchasing';
  const today = toDateStr(new Date());

  function prevMonth() { setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1)); }
  function nextMonth() { setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1)); }

  async function openDetail(s) {
    const res = await api.get(`/delivery/${s.id}`);
    setSelectedSchedule(res.data);
  }

  function handleDayClick(dateStr, entries) {
    if (!entries.length) return;
    if (entries.length === 1) openDetail(entries[0]);
    else setDayPopover(dateStr);
  }

  return (
    <div className="rounded-xl p-3 flex flex-col h-full"
      style={{ background: D.card, border: `1px solid ${D.border}` }}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-[11px] font-semibold" style={{ color: D.text }}>ปฏิทินส่งของ</p>
        {canCreate && (
          <button
            onClick={() => setCreateOpen(true)}
            className="px-2 py-1 text-[9px] font-medium rounded-md flex-shrink-0"
            style={{ background: D.cyan, color: D.bg }}
          >
            + เพิ่มแผนส่งของ
          </button>
        )}
      </div>

      <div className="flex items-center justify-between mb-1.5">
        <button onClick={prevMonth} className="w-5 h-5 flex items-center justify-center rounded" style={{ color: D.muted }}>
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <span className="text-[10px] font-semibold" style={{ color: D.text }}>{MONTHS_TH[month]} {year + 543}</span>
        <button onClick={nextMonth} className="w-5 h-5 flex items-center justify-center rounded" style={{ color: D.muted }}>
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        </button>
      </div>

      <div className="grid grid-cols-7 gap-y-0.5 text-center">
        {DAYS_TH.map((d, i) => (
          <div key={d} className="text-[8px] font-medium" style={{ color: i === 0 ? '#F87171' : i === 6 ? D.cyan : D.muted }}>{d}</div>
        ))}
        {cells.map((day, idx) => {
          if (!day) return <div key={`e${idx}`} />;
          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const entries = byDate[dateStr] || [];
          const isToday = dateStr === today;
          const hasUrgent = entries.some(s => Array.isArray(s.items) && s.items.some(it => it.is_urgent));
          return (
            <button
              key={dateStr}
              onClick={() => handleDayClick(dateStr, entries)}
              disabled={entries.length === 0}
              className="relative mx-auto w-5 h-5 flex flex-col items-center justify-center rounded-full text-[9px] transition-colors"
              style={{
                background: isToday ? D.cyan : 'transparent',
                color: isToday ? D.bg : entries.length ? D.text : D.muted,
                fontWeight: isToday ? 700 : 400,
                cursor: entries.length ? 'pointer' : 'default',
              }}
            >
              {day}
              {entries.length > 0 && (
                <span className="absolute bottom-0 w-1 h-1 rounded-full" style={{ background: hasUrgent ? '#F87171' : isToday ? D.bg : D.cyan }} />
              )}
            </button>
          );
        })}
      </div>

      {isLoading && <p className="text-center text-[9px] mt-2" style={{ color: D.muted }}>กำลังโหลด...</p>}

      {createOpen && (
        <CreateModal
          onClose={() => setCreateOpen(false)}
          suppliers={suppliers}
          defaultDate={today}
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
