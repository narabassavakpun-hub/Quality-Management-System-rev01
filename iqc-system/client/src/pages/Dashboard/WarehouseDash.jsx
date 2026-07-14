import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import HeroStat, { HeroIcons } from '../../components/UI/HeroStat';
import MiniDeliveryCalendar from './MiniDeliveryCalendar';
import { DetailModal } from '../Delivery/index';

// Dashboard สำหรับ warehouse_supervisor/warehouse_manager (เพิ่มใหม่ตามคำขอ user คู่กับ role นี้) — ขอบเขตงาน
// ของคลังแคบมาก (ดู sidebar ที่จำกัดไว้แค่ /delivery ตาม AskUserQuestion ตอนเพิ่ม role): ดูปฏิทินรับเข้า +
// รับแจ้งเตือน + กดรับทราบเท่านั้น หน้านี้เลยเน้น "รายการสินค้าที่รอรับเข้าวันนี้" เป็นหลัก ไม่ใช่ KPI/รายงานแบบ dashboard อื่น
// ใช้ theme token (bg-surface/text-text/.card/HeroStat) เหมือน PurchasingDash.jsx — อ่านง่าย รองรับ light/dark
// ทันที ไม่ใช้ dark D-token ตายตัวแบบ AdminDash (ตาม feedback เรื่องอ่านยาก/ไม่มีโหมดกลางวันในรอบก่อนหน้า)
// ใช้ MiniDeliveryCalendar/DetailModal ที่มีอยู่แล้วจาก Delivery/index.jsx — ไม่เขียน calendar/modal ใหม่ซ้ำ

const THAI_DAYS = ['วันอาทิตย์', 'วันจันทร์', 'วันอังคาร', 'วันพุธ', 'วันพฤหัสบดี', 'วันศุกร์', 'วันเสาร์'];
const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
function thaiTodayLabel() {
  const d = new Date();
  return `${THAI_DAYS[d.getDay()]}ที่ ${d.getDate()} ${THAI_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`;
}
function toDateStr(d) { return d.toISOString().slice(0, 10); }

export default function WarehouseDash() {
  const { user } = useAuth();
  const today = toDateStr(new Date());
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const from = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const to = `${year}-${String(month + 1).padStart(2, '0')}-${new Date(year, month + 1, 0).getDate()}`;

  // queryKey เดียวกับ MiniDeliveryCalendar/Delivery/index.jsx โดยตั้งใจ — แชร์ cache กัน ไม่ต้องยิงซ้ำ และ
  // invalidateQueries(['delivery']) จากที่อื่น (เช่น กด "รับทราบ" ใน MiniDeliveryCalendar) รีเฟรชรายการนี้ให้ด้วย
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
  const pending = schedules
    .filter(s => s.status === 'pending')
    .sort((a, b) => `${a.scheduled_date}${a.time_slot || ''}`.localeCompare(`${b.scheduled_date}${b.time_slot || ''}`));
  const pendingToday = pending.filter(s => s.scheduled_date === today).length;
  const acknowledgedCount = schedules.filter(s => s.status === 'acknowledged').length;
  const completedToday = schedules.filter(s => ['on_time', 'late'].includes(s.status) && s.scheduled_date === today).length;

  // "รอรับเข้า" = ยังไม่ถูกบันทึกว่าของมาส่งจริง (pending หรือ acknowledged) — กว้างกว่า pendingToday ข้างบน
  // ที่นับเฉพาะ status='pending' (ยังไม่รับทราบ) เพราะรายการนี้ต้องการโชว์ "ของที่ต้องเฝ้าดูวันนี้" ทั้งหมด
  // ไม่ว่าจะรับทราบแล้วหรือยัง
  const todayAwaiting = schedules
    .filter(s => s.scheduled_date === today && ['pending', 'acknowledged'].includes(s.status))
    .sort((a, b) => (a.time_slot || '').localeCompare(b.time_slot || ''));

  const [selectedSchedule, setSelectedSchedule] = useState(null);
  async function openDetail(s) {
    const res = await api.get(`/delivery/${s.id}`);
    setSelectedSchedule(res.data);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">สวัสดี, {user?.full_name}</h1>
        <p className="text-muted text-small mt-0.5">วันนี้{thaiTodayLabel()}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <HeroStat icon={HeroIcons.alert} value={isLoading ? '-' : pendingToday} label="รอรับทราบวันนี้" tone="danger" emphasize />
        <HeroStat icon={HeroIcons.tasks} value={isLoading ? '-' : pending.length} label="รอรับทราบทั้งหมด (เดือนนี้)" tone="warning" />
        <HeroStat icon={HeroIcons.building} value={isLoading ? '-' : acknowledgedCount} label="รับทราบแล้ว รอของเข้า" tone="primary" />
        <HeroStat icon={HeroIcons.check} value={isLoading ? '-' : completedToday} label="รับของเสร็จวันนี้" tone="success" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 items-start">
        <div className="card">
          <h2 className="text-h3 font-semibold text-primary mb-3">รายการสินค้าที่รอรับเข้าวันนี้</h2>
          {isLoading ? (
            <p className="text-muted text-small py-6 text-center">กำลังโหลด...</p>
          ) : todayAwaiting.length === 0 ? (
            <p className="text-muted text-small py-6 text-center">ไม่มีรายการรอรับเข้าวันนี้</p>
          ) : (
            <div className="space-y-2">
              {todayAwaiting.map(s => (
                <button
                  key={s.id}
                  onClick={() => openDetail(s)}
                  className="w-full text-left flex items-center justify-between gap-3 px-4 py-3 rounded-lg border border-border hover:bg-bg transition-colors min-h-[56px]"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-text truncate">{s.supplier_name}</p>
                    <p className="text-small text-muted">{s.scheduled_date}{s.time_slot ? ` เวลา ${s.time_slot}` : ''}</p>
                  </div>
                  {s.status === 'pending' ? (
                    <span className="badge bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200 flex-shrink-0">รอรับทราบ</span>
                  ) : (
                    <span className="badge bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200 flex-shrink-0">รับทราบแล้ว</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <MiniDeliveryCalendar />
      </div>

      {selectedSchedule && (
        <DetailModal
          schedule={selectedSchedule}
          onClose={() => setSelectedSchedule(null)}
          suppliers={suppliers}
          role={user?.role}
          holidays={holidays}
        />
      )}
    </div>
  );
}
