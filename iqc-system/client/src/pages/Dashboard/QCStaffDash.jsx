import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, CartesianGrid } from 'recharts';
import api from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import { DetailModal } from '../Delivery/index';
import { T, useStats, DarkTip, RadialGauge, CatLabel, useCountUp } from './shared';
import BillsTrendPanel from './BillsTrendPanel';
import QCDeliveryCalendar from './QCDeliveryCalendar';

function toDateStr(d) { return d.toISOString().slice(0, 10); }

export default function QCStaffDash({ navigate }) {
  const { user } = useAuth();
  const { data, isLoading } = useStats();

  // "รายการสินค้าที่รอรับเข้าวันนี้" — เพิ่มตามคำขอ user (เดิมมีแค่หน้าคลัง) ใช้ DetailModal เดิมจาก
  // Delivery/index.jsx ร่วมกัน — ใช้ theme token T (light/dark) แทน D ตายตัวเดิม (ดูคอมเมนต์ตัว T ใน shared.jsx)
  const today = toDateStr(new Date());
  const { data: todayDelivery } = useQuery({
    queryKey: ['delivery', today, today],
    queryFn: () => api.get('/delivery', { params: { from: today, to: today, limit: 100 } }).then(r => r.data),
  });
  const todayAwaiting = (todayDelivery?.data || []).filter(s => ['pending', 'acknowledged'].includes(s.status));

  const [selectedSchedule, setSelectedSchedule] = useState(null);
  async function openDetail(s) {
    const res = await api.get(`/delivery/${s.id}`);
    setSelectedSchedule(res.data);
  }

  const todayBillsCount = data?.today_bills ?? 0;
  const weekBillsCount  = data?.week_bills ?? 0;

  const approvedCount = data?.approved_bills ?? 0;
  const passedCount   = data?.passed_bills ?? 0;
  const failedBills   = data?.failed_bills ?? 0;
  const passRate      = data?.pass_rate ?? 0;

  const openNCR   = data?.ncr_major_open ?? 0;
  const closedNCR = data?.ncr_major_closed ?? 0;
  const ncrOnlyLength = data?.ncr_major_total ?? 0;
  const openNCP   = data?.ncr_minor_open ?? 0;
  const closedNCP = data?.ncr_minor_closed ?? 0;
  const ncpOnlyLength = data?.ncr_minor_total ?? 0;

  // สรุปภาพรวม UAI — เพิ่มตามคำขอ user (การ์ดใหม่ในคอลัมน์ NCR/NCP Monitor) ไม่มีปุ่ม "ดูทั้งหมด" เหมือนการ์ด
  // "NCR / NCP" split ข้างบน เพราะ qc_staff ไม่มีสิทธิ์เข้า /uai (ดู rolePermissions.js's NAV_ITEMS) — โชว์แค่ตัวเลข
  const uaiOpen = data?.uai_not_final_count ?? 0;
  const uaiCompleted = data?.uai_completed_count ?? 0;
  const uaiTotal = data?.uai_total ?? 0;
  const uaiCompletedPct = uaiTotal > 0 ? Math.round((uaiCompleted / uaiTotal) * 100) : 0;

  const billsLast7 = data?.bills_last7 ?? [];

  const passFail = [
    { name: 'ผ่าน',     value: passedCount },
    { name: 'ไม่ผ่าน',  value: failedBills },
  ].filter(d => d.value > 0);

  const ncrByStatus = data?.ncr_by_status ?? {};
  const ncrStages = [
    { label: 'รอหัวหน้า QC',       key: 'pending_supervisor',       color: T.orange },
    { label: 'รอ QC Manager',       key: 'pending_manager',          color: T.yellow },
    { label: 'รอ QMR เปิด',        key: 'pending_qmr_open',         color: '#F472B6' },
    { label: 'รอ Purchasing',       key: 'pending_purchasing_review', color: '#FB923C' },
    { label: 'รอ Supplier ตอบ',    key: 'pending_supplier',         color: T.accent },
    { label: 'รอ QC ตรวจสอบ',     key: 'pending_manager_review',   color: T.yellow },
    { label: 'รอ Supplier ส่งใหม่', key: 'pending_supplier_resubmit', color: '#F87171' },
    { label: 'รอ QMR ปิด',         key: 'pending_qmr_close',        color: T.purple },
    { label: 'รอดำเนินการ UAI',      key: 'pending_uai',              color: '#A78BFA' },
    { label: 'NCR ปิดแล้ว',        key: 'closed',                   color: T.success },
    { label: 'NCP ปิดแล้ว',        key: 'ncp_closed',               color: '#22D3EE' },
  ].map(g => ({ ...g, count: ncrByStatus[g.key] ?? 0 }))
   .filter(g => g.count > 0);

  const maxStage = Math.max(...ncrStages.map(g => g.count), 1);

  const recentBills = data?.recent_bills ?? [];

  const todayStr = new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
  const passColor = passRate >= 80 ? T.success : passRate >= 60 ? T.yellow : T.orange;

  const PASS_COLORS = [T.success, T.orange];

  const kpiN0 = useCountUp(isLoading ? 0 : todayBillsCount);
  const kpiN1 = useCountUp(isLoading ? 0 : weekBillsCount);
  const kpiN2 = useCountUp(isLoading ? 0 : openNCR);
  const kpiN3 = useCountUp(isLoading ? 0 : openNCP);

  return (
    <>
    {/* ══ MOBILE layout (<md) — scrollable single column ══ */}
    <div className="md:hidden -m-4 overflow-y-auto" style={{ background: T.bg }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 sticky top-0 z-10"
        style={{ background: T.bg, borderBottom: `1px solid ${T.border}` }}>
        <div>
          <span className="text-[16px] font-bold" style={{ color: T.text }}>IQC Dashboard</span>
          <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full" style={{ background: T.border, color: T.muted }}>QC Staff</span>
        </div>
        <button onClick={() => navigate('/bills/new')}
          className="px-4 py-2.5 rounded-lg text-[13px] font-semibold min-h-[44px]"
          style={{ background: T.accent, color: '#fff' }}>
          + สร้างบิลใหม่
        </button>
      </div>

      <div className="p-4 space-y-3 pb-24">
        {/* KPI 2x2 */}
        <div className="grid grid-cols-2 gap-2.5">
          {[
            { label: 'บิลวันนี้',    n: kpiN0, color: T.accent,   sub: 'รับเข้า',        path: '/bills' },
            { label: 'สัปดาห์นี้',   n: kpiN1, color: T.success,  sub: '7 วันล่าสุด',   path: '/bills' },
            { label: 'NCR เปิดอยู่', n: kpiN2, color: T.orange, sub: 'Major',           path: '/ncr' },
            { label: 'NCP เปิดอยู่', n: kpiN3, color: T.yellow, sub: 'Minor',           path: '/ncr' },
          ].map(k => (
            <button key={k.label} onClick={() => navigate(k.path)}
              className="rounded-xl px-4 py-3 text-left min-h-[88px]"
              style={{ background: T.surface, border: `1px solid ${T.border}` }}>
              <div className="text-[32px] font-bold tabular-nums leading-none" style={{ color: k.color }}>
                {isLoading ? '—' : k.n}
              </div>
              <div className="text-[14px] font-semibold mt-2" style={{ color: T.text }}>{k.label}</div>
              <div className="text-[12px]" style={{ color: T.muted }}>{k.sub}</div>
            </button>
          ))}
        </div>

        {/* Quality Card */}
        <div className="rounded-xl p-4" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
          <div className="text-[14px] font-semibold mb-3" style={{ color: T.text }}>อัตราผ่านการตรวจ</div>
          <div className="flex items-center gap-4">
            <div className="relative flex-shrink-0" style={{ width: 88, height: 88 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={passFail.length ? passFail : [{ name: '-', value: 1 }]}
                    dataKey="value" cx="50%" cy="50%"
                    innerRadius={26} outerRadius={40} stroke="none" isAnimationActive animationDuration={1200}>
                    {passFail.length
                      ? passFail.map((_, i) => <Cell key={i} fill={PASS_COLORS[i]} />)
                      : <Cell fill={T.border} />}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-[18px] font-bold" style={{ color: passColor }}>{passRate}%</div>
              </div>
            </div>
            <div className="flex-1 space-y-2.5">
              {[
                { label: 'ผ่าน',    value: passedCount, color: T.success },
                { label: 'ไม่ผ่าน', value: failedBills,        color: T.orange },
              ].map(d => (
                <div key={d.label}>
                  <div className="flex justify-between mb-1">
                    <span className="text-[13px]" style={{ color: T.muted }}>{d.label}</span>
                    <span className="text-[13px] font-bold font-mono" style={{ color: d.color }}>{d.value}</span>
                  </div>
                  <div className="h-1.5 rounded-full" style={{ background: T.border }}>
                    <div className="h-full rounded-full transition-all" style={{
                      width: `${approvedCount > 0 ? (d.value / approvedCount * 100) : 0}%`,
                      background: d.color,
                    }} />
                  </div>
                </div>
              ))}
              <div className="text-[12px]" style={{ color: T.muted }}>จาก {approvedCount} บิลที่อนุมัติ</div>
            </div>
          </div>
        </div>

        {/* 7-day Bar Chart */}
        <div className="rounded-xl p-4" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
          <div className="flex items-center justify-between mb-3">
            <div className="text-[14px] font-semibold" style={{ color: T.text }}>บิลรายวัน 7 วัน</div>
            <div className="flex gap-3">
              {[['รับเข้า', T.accent], ['ไม่ผ่าน', T.orange]].map(([l, c]) => (
                <div key={l} className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm" style={{ background: c }} />
                  <span className="text-[12px]" style={{ color: T.muted }}>{l}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ height: 160 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={billsLast7} margin={{ top: 2, right: 4, left: -24, bottom: 0 }} barSize={10} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke={T.border} vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: T.muted }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: T.muted }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<DarkTip />} />
                <Bar dataKey="รับเข้า" fill={T.accent}   radius={[2,2,0,0]} isAnimationActive />
                <Bar dataKey="ไม่ผ่าน" fill={T.orange} radius={[2,2,0,0]} isAnimationActive />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* NCR / NCP */}
        <div className="rounded-xl p-4" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
          <div className="flex justify-between items-center mb-3">
            <div className="text-[14px] font-semibold" style={{ color: T.text }}>NCR / NCP</div>
            <button onClick={() => navigate('/ncr')} className="text-[13px]" style={{ color: T.accent }}>ดูทั้งหมด</button>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="rounded-lg p-3" style={{ background: T.bg }}>
              <div className="text-[12px] mb-1" style={{ color: T.muted }}>NCR Major เปิดอยู่</div>
              <div className="text-[28px] font-bold" style={{ color: T.orange }}>{openNCR}</div>
              <div className="text-[12px] mt-1" style={{ color: T.muted }}>
                ปิดแล้ว <span style={{ color: T.success }}>{closedNCR}</span>
              </div>
            </div>
            <div className="rounded-lg p-3" style={{ background: T.bg }}>
              <div className="text-[12px] mb-1" style={{ color: T.muted }}>NCP Minor เปิดอยู่</div>
              <div className="text-[28px] font-bold" style={{ color: T.yellow }}>{openNCP}</div>
              <div className="text-[12px] mt-1" style={{ color: T.muted }}>
                ปิดแล้ว <span style={{ color: T.success }}>{closedNCP}</span>
              </div>
            </div>
          </div>
          {ncrStages.length > 0 && (
            <div className="space-y-2.5">
              {ncrStages.map(g => (
                <div key={g.key} className="flex items-center gap-3">
                  <span className="text-[13px] flex-1" style={{ color: T.muted }}>{g.label}</span>
                  <div className="w-20 h-1.5 rounded-full flex-shrink-0" style={{ background: T.border }}>
                    <div className="h-full rounded-full" style={{ width: `${(g.count / maxStage) * 100}%`, background: g.color }} />
                  </div>
                  <span className="text-[13px] font-bold font-mono w-6 text-right" style={{ color: g.color }}>{g.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* รายการสินค้าที่รอรับเข้าวันนี้ */}
        <div className="rounded-xl p-4" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
          <div className="flex justify-between items-center mb-3">
            <div className="text-[14px] font-semibold" style={{ color: T.text }}>รายการสินค้าที่รอรับเข้าวันนี้</div>
            <button onClick={() => navigate('/delivery')} className="text-[13px]" style={{ color: T.accent }}>ดูทั้งหมด</button>
          </div>
          <div className="space-y-2">
            {todayAwaiting.length === 0 ? (
              <p className="text-[13px] text-center py-4" style={{ color: T.muted }}>ไม่มีรายการรอรับเข้าวันนี้</p>
            ) : todayAwaiting.map(s => (
              <button key={s.id} onClick={() => openDetail(s)}
                className="w-full text-left rounded-lg px-3 py-3 min-h-[56px] flex items-center justify-between gap-2"
                style={{ background: T.bg }}>
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold truncate" style={{ color: T.text }}>{s.supplier_name}</p>
                  <p className="text-[12px]" style={{ color: T.muted }}>{s.scheduled_date}{s.time_slot ? ` เวลา ${s.time_slot}` : ''}</p>
                </div>
                <span className="text-[11px] px-2 py-0.5 rounded-full flex-shrink-0" style={{
                  background: s.status === 'pending' ? '#EF444418' : '#38BDF818',
                  color: s.status === 'pending' ? '#F87171' : T.accent,
                }}>
                  {s.status === 'pending' ? 'รอรับทราบ' : 'รับทราบแล้ว'}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Recent Bills */}
        <div className="rounded-xl p-4" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
          <div className="flex justify-between items-center mb-3">
            <div className="text-[14px] font-semibold" style={{ color: T.text }}>บิลล่าสุด</div>
            <button onClick={() => navigate('/bills')} className="text-[13px]" style={{ color: T.accent }}>ดูทั้งหมด</button>
          </div>
          <div className="space-y-2">
            {recentBills.length === 0 ? (
              <p className="text-[13px] text-center py-4" style={{ color: T.muted }}>ยังไม่มีบิล</p>
            ) : recentBills.slice(0, 6).map(b => {
              const hasFail = (b.failed_item_count ?? 0) > 0;
              return (
                <button key={b.id} onClick={() => navigate(`/bills/${b.id}`)}
                  className="w-full text-left rounded-lg px-3 py-3 min-h-[56px]"
                  style={{ background: T.bg }}>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[14px] font-semibold" style={{ color: T.accent }}>{b.invoice_no}</span>
                    <span className="text-[12px] px-2 py-0.5 rounded-full" style={{
                      background: hasFail ? '#F9731618' : '#22C55E18',
                      color: hasFail ? T.orange : T.success,
                    }}>
                      {hasFail ? `ไม่ผ่าน ${b.failed_item_count}` : 'ผ่าน'}
                    </span>
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-[13px] truncate mr-2" style={{ color: T.muted }}>{b.supplier_name}</span>
                    <span className="text-[12px] flex-shrink-0" style={{ color: T.muted }}>{b.received_date}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>

    {/* ══ DESKTOP layout (>=md) — ล็อกพอดี viewport ไม่ต้อง scroll ทั้งหน้า (user ยืนยันขอแบบนี้ — ก่อนหน้านี้เคย
        ลองเอา fixed-height ออกให้ scroll ธรรมชาติตอนเพิ่มฟอนต์ใหญ่ขึ้น แต่ user ขอกลับมาให้พอดีจอเหมือนเดิม) —
        แก้ด้วยการคง fixed viewport ไว้ แต่ให้แต่ละคอลัมน์ scroll ภายในตัวเองได้ (overflow-y-auto + min-h-0) แทน
        ถ้าเนื้อหาในคอลัมน์ไหนเกินพื้นที่ที่จัดสรร (เช่น NCR ตามขั้นตอนมีหลายแถว) — กัน "ทั้งหน้า" ต้อง scroll โดยไม่
        บังคับให้ทุกการ์ดพอดีเป๊ะเสมอ (ข้อมูลจริงมีจำนวนแถวไม่แน่นอน) ══ */}
    <div className="hidden md:flex md:flex-col -m-4 overflow-hidden"
      style={{ height: 'calc(100vh - 64px)', background: T.bg }}>

      {/* ══ HEADER ══ */}
      <div className="flex-none flex items-center justify-between px-4 py-2.5"
        style={{ borderBottom: `1px solid ${T.border}` }}>
        <div className="flex items-center gap-2.5">
          <span className="text-h3 font-bold" style={{ color: T.text }}>IQC Dashboard</span>
          <span className="text-small px-2 py-0.5 rounded-full" style={{ background: T.border, color: T.muted }}>QC Staff</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-small" style={{ color: T.muted }}>{todayStr}</span>
          <button onClick={() => navigate('/bills/new')}
            className="px-3.5 py-1.5 rounded-lg text-small font-semibold transition-opacity hover:opacity-80"
            style={{ background: T.accent, color: '#fff' }}>
            + สร้างบิลใหม่
          </button>
        </div>
      </div>

      {/* ══ KPI ROW ══ */}
      <div className="flex-none grid grid-cols-4 gap-3 px-4 pt-3">
        {[
          { label: 'บิลวันนี้',    n: kpiN0, color: T.accent,   sub: 'รับเข้า',       path: '/bills' },
          { label: 'สัปดาห์นี้',   n: kpiN1, color: T.success,  sub: '7 วันล่าสุด',  path: '/bills' },
          { label: 'NCR เปิดอยู่', n: kpiN2, color: T.orange, sub: 'Major / ยังไม่ปิด', path: '/ncr' },
          { label: 'NCP เปิดอยู่', n: kpiN3, color: T.yellow, sub: 'Minor / ยังไม่ปิด', path: '/ncr' },
        ].map(k => (
          <button key={k.label} onClick={() => navigate(k.path)}
            className="rounded-xl px-4 py-2.5 text-left transition-opacity hover:opacity-80"
            style={{ background: T.surface, border: `1px solid ${T.border}` }}>
            <div className="text-h2 font-bold tabular-nums leading-none" style={{ color: k.color }}>
              {isLoading ? '—' : k.n}
            </div>
            <div className="flex items-center justify-between mt-1.5">
              <span className="text-small font-semibold" style={{ color: T.text }}>{k.label}</span>
              <span className="text-small" style={{ color: T.muted }}>{k.sub}</span>
            </div>
          </button>
        ))}
      </div>

      {/* ══ MAIN 3-COLUMN AREA (flex-1 เติมพื้นที่ที่เหลือพอดี) ══ */}
      <div className="flex-1 min-h-0 grid grid-cols-3 gap-4 px-4 py-3">

        {/* ──── LEFT: คุณภาพการรับเข้า ──── */}
        <div className="flex flex-col gap-3 min-h-0">
          <CatLabel color={T.success} text="คุณภาพการรับเข้า" />

          {/* ปฏิทินส่งของ — flex-1 (แทนที่ "อัตราผ่านการตรวจ" เดิม, สูงเท่ากล่อง "บิลรับเข้า" ของคอลัมน์กลาง
              เพราะทั้งคู่เป็น flex-1 ตัวแรกจาก 2 ตัวของคอลัมน์ตัวเองเหมือนกัน) */}
          <div className="flex-1 min-h-0">
            <QCDeliveryCalendar />
          </div>

          {/* กล่องล่าง — flex-1 (สูงเท่ากล่อง "ผู้ผลิตที่รับเข้ามากสุด" ของคอลัมน์กลาง) แบ่งครึ่งเป็น
              "รอรับเข้าวันนี้"/"บิลล่าสุด" คนละ flex-1 ข้างในตามคำขอ user */}
          <div className="flex-1 min-h-0 flex flex-col gap-3">
            {/* รอรับเข้าวันนี้ — flex-1 (ครึ่งบนของกล่องล่าง) */}
            <div className="flex-1 min-h-0 rounded-xl p-4 flex flex-col overflow-hidden"
              style={{ background: T.surface, border: `1px solid ${T.border}` }}>
              <div className="flex-none flex justify-between items-center mb-3">
                <p className="text-h3 font-semibold" style={{ color: T.text }}>รอรับเข้าวันนี้</p>
                <button onClick={() => navigate('/delivery')} className="text-small hover:underline" style={{ color: T.accent }}>ดูทั้งหมด</button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto space-y-2"
                style={{ scrollbarWidth: 'thin', scrollbarColor: `${T.border} transparent` }}>
                {todayAwaiting.length === 0 ? (
                  <p className="text-small py-1" style={{ color: T.muted }}>ไม่มีรายการวันนี้</p>
                ) : todayAwaiting.map(s => (
                  <button key={s.id} onClick={() => openDetail(s)}
                    className="w-full text-left rounded-lg px-3 py-2 flex items-center justify-between gap-2 transition-colors"
                    style={{ background: T.bg }}>
                    <div className="min-w-0">
                      <p className="text-body font-semibold truncate" style={{ color: T.text }}>{s.supplier_name}</p>
                      <p className="text-small" style={{ color: T.muted }}>{s.scheduled_date.slice(5)}{s.time_slot ? ` ${s.time_slot}` : ''}</p>
                    </div>
                    <span className="text-small px-2 py-0.5 rounded-full flex-shrink-0" style={{
                      background: s.status === 'pending' ? '#EF444418' : '#38BDF818',
                      color: s.status === 'pending' ? '#F87171' : T.accent,
                    }}>
                      {s.status === 'pending' ? 'รอรับทราบ' : 'รับทราบแล้ว'}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* บิลล่าสุด — flex-1 (ครึ่งล่างของกล่องล่าง) */}
            <div className="flex-1 min-h-0 rounded-xl p-4 flex flex-col overflow-hidden"
              style={{ background: T.surface, border: `1px solid ${T.border}` }}>
              <div className="flex-none flex justify-between items-center mb-3">
                <p className="text-h3 font-semibold" style={{ color: T.text }}>บิลล่าสุด</p>
                <button onClick={() => navigate('/bills')} className="text-small hover:underline" style={{ color: T.accent }}>ดูทั้งหมด</button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5"
                style={{ scrollbarWidth: 'thin', scrollbarColor: `${T.border} transparent` }}>
                {recentBills.length === 0 ? (
                  <p className="text-small text-center py-4" style={{ color: T.muted }}>ยังไม่มีบิล</p>
                ) : recentBills.map(b => {
                  const hasFail = (b.failed_item_count ?? 0) > 0;
                  return (
                    <button key={b.id} onClick={() => navigate(`/bills/${b.id}`)}
                      className="w-full text-left rounded-lg px-3 py-2 transition-colors"
                      style={{ background: T.bg }}
                      onMouseEnter={e => e.currentTarget.style.background = T.border}
                      onMouseLeave={e => e.currentTarget.style.background = T.bg}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-body font-semibold" style={{ color: T.accent }}>{b.invoice_no}</span>
                        <span className="text-small px-2 py-0.5 rounded-full" style={{
                          background: hasFail ? '#F9731618' : '#22C55E18',
                          color: hasFail ? T.orange : T.success,
                        }}>
                          {hasFail ? `ไม่ผ่าน ${b.failed_item_count}` : 'ผ่าน'}
                        </span>
                      </div>
                      <div className="flex justify-between mt-1">
                        <span className="text-small truncate mr-2" style={{ color: T.muted }}>{b.supplier_name}</span>
                        <span className="text-small flex-shrink-0" style={{ color: T.muted }}>{b.received_date}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

        </div>

        {/* ──── CENTER: แนวโน้มรับเข้า ──── */}
        <div className="flex flex-col gap-3 min-h-0">
          <CatLabel color={T.accent} text="แนวโน้มรับเข้า" />
          <BillsTrendPanel navigate={navigate} />
        </div>

        {/* ──── RIGHT: NCR/NCP Monitor ──── */}
        <div className="flex flex-col gap-3 min-h-0">
          <CatLabel color={T.orange} text="NCR/NCP Monitor" />

          {/* การ์ดกลุ่มนี้ทั้งหมดเป็น flex-none (สูงตามเนื้อหาจริง) ยกเว้นการ์ดสุดท้าย (gauges) ที่เป็น flex-1 —
              คอลัมน์นี้เดียวที่ min-h-0 overflow-y-auto (ต่างจาก LEFT/CENTER ที่แบ่ง flex-1:flex-1 พอดีเป๊ะ) เพราะ
              จำนวนการ์ด/แถวใน "NCR ตามขั้นตอน" ผันแปรตามข้อมูลจริง ไม่คงที่ — ถ้ารวมกันสูงเกินพื้นที่ที่จัดสรรไว้
              ให้ scroll ภายในคอลัมน์นี้เอง แทนที่จะดันทั้งหน้าให้ต้อง scroll (ตามคำขอ user ข้อ 3) */}
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 pr-1"
            style={{ scrollbarWidth: 'thin', scrollbarColor: `${T.border} transparent` }}>

          {/* NCR vs NCP split card — flex-none */}
          <div className="flex-none rounded-xl p-4"
            style={{ background: T.surface, border: `1px solid ${T.border}` }}>
            <p className="text-h3 font-semibold mb-3" style={{ color: T.text }}>NCR / NCP</p>
            <div className="grid grid-cols-2 gap-3">
              {/* NCR (Major) */}
              <div className="rounded-lg p-3" style={{ background: T.bg }}>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="w-2 h-2 rounded-full" style={{ background: '#EF4444' }} />
                  <span className="text-small font-semibold uppercase tracking-wide" style={{ color: T.text }}>NCR Major</span>
                </div>
                <div className="flex justify-between items-end">
                  <div>
                    <div className="text-small mb-0.5" style={{ color: T.muted }}>เปิดอยู่</div>
                    <div className="text-h1 font-bold tabular-nums" style={{ color: T.orange }}>{openNCR}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-small mb-0.5" style={{ color: T.muted }}>ปิดแล้ว</div>
                    <div className="text-h2 font-bold tabular-nums" style={{ color: T.success }}>{closedNCR}</div>
                  </div>
                </div>
                <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: T.border }}>
                  <div className="h-full rounded-full" style={{
                    width: `${ncrOnlyLength > 0 ? (closedNCR / ncrOnlyLength) * 100 : 0}%`,
                    background: T.success, transition: 'width 1s ease-out',
                  }} />
                </div>
                <div className="text-small mt-1 text-right" style={{ color: T.muted }}>
                  {ncrOnlyLength > 0 ? Math.round((closedNCR / ncrOnlyLength) * 100) : 0}% ปิด
                </div>
              </div>
              {/* NCP (Minor) */}
              <div className="rounded-lg p-3" style={{ background: T.bg }}>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="w-2 h-2 rounded-full" style={{ background: T.accent }} />
                  <span className="text-small font-semibold uppercase tracking-wide" style={{ color: T.text }}>NCP Minor</span>
                </div>
                <div className="flex justify-between items-end">
                  <div>
                    <div className="text-small mb-0.5" style={{ color: T.muted }}>เปิดอยู่</div>
                    <div className="text-h1 font-bold tabular-nums" style={{ color: T.yellow }}>{openNCP}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-small mb-0.5" style={{ color: T.muted }}>ปิดแล้ว</div>
                    <div className="text-h2 font-bold tabular-nums" style={{ color: T.success }}>{closedNCP}</div>
                  </div>
                </div>
                <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: T.border }}>
                  <div className="h-full rounded-full" style={{
                    width: `${ncpOnlyLength > 0 ? (closedNCP / ncpOnlyLength) * 100 : 0}%`,
                    background: T.success, transition: 'width 1s ease-out',
                  }} />
                </div>
                <div className="text-small mt-1 text-right" style={{ color: T.muted }}>
                  {ncpOnlyLength > 0 ? Math.round((closedNCP / ncpOnlyLength) * 100) : 0}% ปิด
                </div>
              </div>
            </div>
          </div>

          {/* UAI summary — flex-none */}
          <div className="flex-none rounded-xl p-4"
            style={{ background: T.surface, border: `1px solid ${T.border}` }}>
            <p className="text-h3 font-semibold mb-3" style={{ color: T.text }}>UAI</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg p-3" style={{ background: T.bg }}>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="w-2 h-2 rounded-full" style={{ background: T.purple }} />
                  <span className="text-small font-semibold uppercase tracking-wide" style={{ color: T.text }}>เปิดอยู่</span>
                </div>
                <div className="text-h1 font-bold tabular-nums" style={{ color: T.purple }}>{uaiOpen}</div>
              </div>
              <div className="rounded-lg p-3" style={{ background: T.bg }}>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="w-2 h-2 rounded-full" style={{ background: T.success }} />
                  <span className="text-small font-semibold uppercase tracking-wide" style={{ color: T.text }}>เสร็จแล้ว</span>
                </div>
                <div className="text-h1 font-bold tabular-nums" style={{ color: T.success }}>{uaiCompleted}</div>
              </div>
            </div>
            <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: T.border }}>
              <div className="h-full rounded-full" style={{ width: `${uaiCompletedPct}%`, background: T.success, transition: 'width 1s ease-out' }} />
            </div>
            <div className="text-small mt-1 text-right" style={{ color: T.muted }}>
              {uaiCompletedPct}% เสร็จแล้ว จาก {uaiTotal} ใบ
            </div>
          </div>

          {/* NCR stages ranking — flex-none */}
          <div className="flex-none rounded-xl p-4"
            style={{ background: T.surface, border: `1px solid ${T.border}` }}>
            <div className="flex justify-between items-center mb-3">
              <p className="text-h3 font-semibold" style={{ color: T.text }}>NCR ตามขั้นตอน</p>
              <button onClick={() => navigate('/ncr')} className="text-small hover:underline" style={{ color: T.accent }}>ดูทั้งหมด</button>
            </div>
            {ncrStages.length === 0 ? (
              <p className="text-small py-1" style={{ color: T.muted }}>ยังไม่มี NCR</p>
            ) : (
              <div className="space-y-2">
                {ncrStages.map(g => (
                  <div key={g.key}>
                    <div className="flex justify-between mb-1">
                      <span className="text-small" style={{ color: T.muted }}>{g.label}</span>
                      <span className="text-small font-mono font-bold" style={{ color: g.color }}>{g.count}</span>
                    </div>
                    <div className="h-1.5 rounded-full" style={{ background: T.border }}>
                      <div className="h-full rounded-full"
                        style={{ width: `${(g.count / maxStage) * 100}%`, background: g.color, transition: 'width 1s ease-out' }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 3 Radial gauges — flex-none (คอลัมน์นี้ scroll ได้เองแล้ว ไม่ต้อง flex-grow แย่งพื้นที่) */}
          <div className="flex-none min-h-[160px] rounded-xl p-4 flex flex-col"
            style={{ background: T.surface, border: `1px solid ${T.border}` }}>
            <p className="flex-none text-h3 font-semibold mb-1" style={{ color: T.text }}>สรุปภาพรวม NCR/NCP</p>
            <div className="flex-1 flex items-center justify-around">
              <RadialGauge value={passedCount} total={approvedCount || 1}
                label="อัตราผ่าน" color={T.success} />
              <RadialGauge value={closedNCR} total={ncrOnlyLength || 1}
                label="NCR ปิดแล้ว" color={T.orange} />
              <RadialGauge value={closedNCP} total={ncpOnlyLength || 1}
                label="NCP ปิดแล้ว" color={T.yellow} />
            </div>
          </div>

          </div>
        </div>
      </div>
    </div>

    {selectedSchedule && (
      <DetailModal
        schedule={selectedSchedule}
        onClose={() => setSelectedSchedule(null)}
        suppliers={[]}
        role={user?.role}
        holidays={[]}
      />
    )}
    </>
  );
}
