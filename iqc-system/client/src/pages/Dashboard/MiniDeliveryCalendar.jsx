import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import Modal from '../../components/UI/Modal';
import { CreateModal, DetailModal } from '../Delivery/index';

// ปฏิทินส่งของแบบย่อ ฝังในหน้า Purchasing Dashboard โดยตรง (ไม่ใช่ tab แยก) — ใช้ CreateModal/DetailModal เดิมจาก
// Delivery/index.jsx (export เพิ่มจากไฟล์นั้น) แทนการเขียน CRUD ปฏิทินใหม่ซ้ำ — queryKey ใช้ 'delivery' ร่วมกับ
// หน้าปฏิทินเต็ม เพื่อให้ CreateModal/DetailModal ที่ invalidateQueries(['delivery']) รีเฟรชวิดเจ็ตนี้ได้อัตโนมัติด้วย
const DAYS_TH = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const MONTHS_TH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

function toDateStr(d) { return d.toISOString().slice(0, 10); }

export default function MiniDeliveryCalendar() {
  const { user } = useAuth();
  const qc = useQueryClient();
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
    <div className="card flex flex-col h-full">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 className="text-h3 font-semibold text-primary">ปฏิทินส่งของ</h2>
        {canCreate && (
          <button
            onClick={() => setCreateOpen(true)}
            className="px-2.5 py-1.5 text-[12px] font-medium rounded-md bg-primary text-white hover:opacity-90 min-h-[36px] flex-shrink-0"
          >
            + เพิ่มแผนส่งของ
          </button>
        )}
      </div>

      <div className="flex items-center justify-between mb-2">
        <button onClick={prevMonth} className="w-7 h-7 flex items-center justify-center rounded hover:bg-bg text-muted">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <span className="text-small font-semibold text-primary">{MONTHS_TH[month]} {year + 543}</span>
        <button onClick={nextMonth} className="w-7 h-7 flex items-center justify-center rounded hover:bg-bg text-muted">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        </button>
      </div>

      <div className="grid grid-cols-7 gap-y-1 text-center">
        {DAYS_TH.map((d, i) => (
          <div key={d} className={`text-[10px] font-medium ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-muted'}`}>{d}</div>
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
              className={`relative mx-auto w-7 h-7 flex flex-col items-center justify-center rounded-full text-[11px] transition-colors ${
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

      {isLoading && <p className="text-center text-muted text-[11px] mt-2">กำลังโหลด...</p>}

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
