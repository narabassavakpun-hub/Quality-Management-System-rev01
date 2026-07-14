import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area, CartesianGrid } from 'recharts';
import api from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import { DetailModal } from '../Delivery/index';
import { D, useStats, DarkTip, RadialGauge, CatLabel, useCountUp } from './shared';

function toDateStr(d) { return d.toISOString().slice(0, 10); }

export default function QCStaffDash({ navigate }) {
  const { user } = useAuth();
  const { data, isLoading } = useStats();

  // "รายการสินค้าที่รอรับเข้าวันนี้" — เพิ่มตามคำขอ user (เดิมมีแค่หน้าคลัง) ใช้ DetailModal เดิมจาก
  // Delivery/index.jsx ร่วมกัน — สไตล์การ์ดใช้ D token (dark ตายตัว) แทน semantic token ตามที่หน้านี้ทั้งหน้าใช้
  // dark palette แบบ inline style เสมอ (ไม่ผูก .dark class) — ถ้าใช้ bg-surface/text-text ธรรมดาจะขัดกันเวลา
  // ผู้ใช้ตั้งค่า light mode เพราะพื้นหลังหน้านี้ยังมืดอยู่เสมอ (ดู CLAUDE.md §25.2)
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

  const billsLast7 = data?.bills_last7 ?? [];

  const passFail = [
    { name: 'ผ่าน',     value: passedCount },
    { name: 'ไม่ผ่าน',  value: failedBills },
  ].filter(d => d.value > 0);

  const ncrByStatus = data?.ncr_by_status ?? {};
  const ncrStages = [
    { label: 'รอหัวหน้า QC',       key: 'pending_supervisor',       color: D.orange },
    { label: 'รอ QC Manager',       key: 'pending_manager',          color: D.yellow },
    { label: 'รอ QMR เปิด',        key: 'pending_qmr_open',         color: '#F472B6' },
    { label: 'รอ Purchasing',       key: 'pending_purchasing_review', color: '#FB923C' },
    { label: 'รอ Supplier ตอบ',    key: 'pending_supplier',         color: D.cyan },
    { label: 'รอ QC ตรวจสอบ',     key: 'pending_manager_review',   color: D.yellow },
    { label: 'รอ Supplier ส่งใหม่', key: 'pending_supplier_resubmit', color: '#F87171' },
    { label: 'รอ QMR ปิด',         key: 'pending_qmr_close',        color: D.purple },
    { label: 'รอดำเนินการ UAI',      key: 'pending_uai',              color: '#A78BFA' },
    { label: 'NCR ปิดแล้ว',        key: 'closed',                   color: D.green },
    { label: 'NCP ปิดแล้ว',        key: 'ncp_closed',               color: '#22D3EE' },
  ].map(g => ({ ...g, count: ncrByStatus[g.key] ?? 0 }))
   .filter(g => g.count > 0);

  const maxStage = Math.max(...ncrStages.map(g => g.count), 1);

  const recentBills = data?.recent_bills ?? [];

  const todayStr = new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
  const passColor = passRate >= 80 ? D.green : passRate >= 60 ? D.yellow : D.orange;

  const PASS_COLORS = [D.green, D.orange];

  const kpiN0 = useCountUp(isLoading ? 0 : todayBillsCount);
  const kpiN1 = useCountUp(isLoading ? 0 : weekBillsCount);
  const kpiN2 = useCountUp(isLoading ? 0 : openNCR);
  const kpiN3 = useCountUp(isLoading ? 0 : openNCP);

  return (
    <>
    {/* ══ MOBILE layout (<md) — scrollable single column ══ */}
    <div className="md:hidden -m-4 overflow-y-auto" style={{ background: D.bg }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 sticky top-0 z-10"
        style={{ background: D.bg, borderBottom: `1px solid ${D.border}` }}>
        <div>
          <span className="text-[16px] font-bold" style={{ color: D.text }}>IQC Dashboard</span>
          <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full" style={{ background: D.border, color: D.muted }}>QC Staff</span>
        </div>
        <button onClick={() => navigate('/bills/new')}
          className="px-4 py-2.5 rounded-lg text-[13px] font-semibold min-h-[44px]"
          style={{ background: D.cyan, color: D.bg }}>
          + สร้างบิลใหม่
        </button>
      </div>

      <div className="p-4 space-y-3 pb-24">
        {/* KPI 2x2 */}
        <div className="grid grid-cols-2 gap-2.5">
          {[
            { label: 'บิลวันนี้',    n: kpiN0, color: D.cyan,   sub: 'รับเข้า',        path: '/bills' },
            { label: 'สัปดาห์นี้',   n: kpiN1, color: D.green,  sub: '7 วันล่าสุด',   path: '/bills' },
            { label: 'NCR เปิดอยู่', n: kpiN2, color: D.orange, sub: 'Major',           path: '/ncr' },
            { label: 'NCP เปิดอยู่', n: kpiN3, color: D.yellow, sub: 'Minor',           path: '/ncr' },
          ].map(k => (
            <button key={k.label} onClick={() => navigate(k.path)}
              className="rounded-xl px-4 py-3 text-left min-h-[88px]"
              style={{ background: D.card, border: `1px solid ${D.border}` }}>
              <div className="text-[32px] font-bold tabular-nums leading-none" style={{ color: k.color }}>
                {isLoading ? '—' : k.n}
              </div>
              <div className="text-[14px] font-semibold mt-2" style={{ color: D.text }}>{k.label}</div>
              <div className="text-[12px]" style={{ color: D.muted }}>{k.sub}</div>
            </button>
          ))}
        </div>

        {/* Quality Card */}
        <div className="rounded-xl p-4" style={{ background: D.card, border: `1px solid ${D.border}` }}>
          <div className="text-[14px] font-semibold mb-3" style={{ color: D.text }}>อัตราผ่านการตรวจ</div>
          <div className="flex items-center gap-4">
            <div className="relative flex-shrink-0" style={{ width: 88, height: 88 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={passFail.length ? passFail : [{ name: '-', value: 1 }]}
                    dataKey="value" cx="50%" cy="50%"
                    innerRadius={26} outerRadius={40} stroke="none" isAnimationActive animationDuration={1200}>
                    {passFail.length
                      ? passFail.map((_, i) => <Cell key={i} fill={PASS_COLORS[i]} />)
                      : <Cell fill={D.border} />}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-[18px] font-bold" style={{ color: passColor }}>{passRate}%</div>
              </div>
            </div>
            <div className="flex-1 space-y-2.5">
              {[
                { label: 'ผ่าน',    value: passedCount, color: D.green },
                { label: 'ไม่ผ่าน', value: failedBills,        color: D.orange },
              ].map(d => (
                <div key={d.label}>
                  <div className="flex justify-between mb-1">
                    <span className="text-[13px]" style={{ color: D.muted }}>{d.label}</span>
                    <span className="text-[13px] font-bold font-mono" style={{ color: d.color }}>{d.value}</span>
                  </div>
                  <div className="h-1.5 rounded-full" style={{ background: D.border }}>
                    <div className="h-full rounded-full transition-all" style={{
                      width: `${approvedCount > 0 ? (d.value / approvedCount * 100) : 0}%`,
                      background: d.color,
                    }} />
                  </div>
                </div>
              ))}
              <div className="text-[12px]" style={{ color: D.muted }}>จาก {approvedCount} บิลที่อนุมัติ</div>
            </div>
          </div>
        </div>

        {/* 7-day Bar Chart */}
        <div className="rounded-xl p-4" style={{ background: D.card, border: `1px solid ${D.border}` }}>
          <div className="flex items-center justify-between mb-3">
            <div className="text-[14px] font-semibold" style={{ color: D.text }}>บิลรายวัน 7 วัน</div>
            <div className="flex gap-3">
              {[['รับเข้า', D.cyan], ['ไม่ผ่าน', D.orange]].map(([l, c]) => (
                <div key={l} className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm" style={{ background: c }} />
                  <span className="text-[12px]" style={{ color: D.muted }}>{l}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ height: 160 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={billsLast7} margin={{ top: 2, right: 4, left: -24, bottom: 0 }} barSize={10} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke={D.border} vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: D.muted }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: D.muted }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<DarkTip />} />
                <Bar dataKey="รับเข้า" fill={D.cyan}   radius={[2,2,0,0]} isAnimationActive />
                <Bar dataKey="ไม่ผ่าน" fill={D.orange} radius={[2,2,0,0]} isAnimationActive />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* NCR / NCP */}
        <div className="rounded-xl p-4" style={{ background: D.card, border: `1px solid ${D.border}` }}>
          <div className="flex justify-between items-center mb-3">
            <div className="text-[14px] font-semibold" style={{ color: D.text }}>NCR / NCP</div>
            <button onClick={() => navigate('/ncr')} className="text-[13px]" style={{ color: D.cyan }}>ดูทั้งหมด</button>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="rounded-lg p-3" style={{ background: D.bg }}>
              <div className="text-[12px] mb-1" style={{ color: D.muted }}>NCR Major เปิดอยู่</div>
              <div className="text-[28px] font-bold" style={{ color: D.orange }}>{openNCR}</div>
              <div className="text-[12px] mt-1" style={{ color: D.muted }}>
                ปิดแล้ว <span style={{ color: D.green }}>{closedNCR}</span>
              </div>
            </div>
            <div className="rounded-lg p-3" style={{ background: D.bg }}>
              <div className="text-[12px] mb-1" style={{ color: D.muted }}>NCP Minor เปิดอยู่</div>
              <div className="text-[28px] font-bold" style={{ color: D.yellow }}>{openNCP}</div>
              <div className="text-[12px] mt-1" style={{ color: D.muted }}>
                ปิดแล้ว <span style={{ color: D.green }}>{closedNCP}</span>
              </div>
            </div>
          </div>
          {ncrStages.length > 0 && (
            <div className="space-y-2.5">
              {ncrStages.map(g => (
                <div key={g.key} className="flex items-center gap-3">
                  <span className="text-[13px] flex-1" style={{ color: D.muted }}>{g.label}</span>
                  <div className="w-20 h-1.5 rounded-full flex-shrink-0" style={{ background: D.border }}>
                    <div className="h-full rounded-full" style={{ width: `${(g.count / maxStage) * 100}%`, background: g.color }} />
                  </div>
                  <span className="text-[13px] font-bold font-mono w-6 text-right" style={{ color: g.color }}>{g.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* รายการสินค้าที่รอรับเข้าวันนี้ */}
        <div className="rounded-xl p-4" style={{ background: D.card, border: `1px solid ${D.border}` }}>
          <div className="flex justify-between items-center mb-3">
            <div className="text-[14px] font-semibold" style={{ color: D.text }}>รายการสินค้าที่รอรับเข้าวันนี้</div>
            <button onClick={() => navigate('/delivery')} className="text-[13px]" style={{ color: D.cyan }}>ดูทั้งหมด</button>
          </div>
          <div className="space-y-2">
            {todayAwaiting.length === 0 ? (
              <p className="text-[13px] text-center py-4" style={{ color: D.muted }}>ไม่มีรายการรอรับเข้าวันนี้</p>
            ) : todayAwaiting.map(s => (
              <button key={s.id} onClick={() => openDetail(s)}
                className="w-full text-left rounded-lg px-3 py-3 min-h-[56px] flex items-center justify-between gap-2"
                style={{ background: D.bg }}>
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold truncate" style={{ color: D.text }}>{s.supplier_name}</p>
                  <p className="text-[12px]" style={{ color: D.muted }}>{s.scheduled_date}{s.time_slot ? ` เวลา ${s.time_slot}` : ''}</p>
                </div>
                <span className="text-[11px] px-2 py-0.5 rounded-full flex-shrink-0" style={{
                  background: s.status === 'pending' ? '#EF444418' : '#38BDF818',
                  color: s.status === 'pending' ? '#F87171' : D.cyan,
                }}>
                  {s.status === 'pending' ? 'รอรับทราบ' : 'รับทราบแล้ว'}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Recent Bills */}
        <div className="rounded-xl p-4" style={{ background: D.card, border: `1px solid ${D.border}` }}>
          <div className="flex justify-between items-center mb-3">
            <div className="text-[14px] font-semibold" style={{ color: D.text }}>บิลล่าสุด</div>
            <button onClick={() => navigate('/bills')} className="text-[13px]" style={{ color: D.cyan }}>ดูทั้งหมด</button>
          </div>
          <div className="space-y-2">
            {recentBills.length === 0 ? (
              <p className="text-[13px] text-center py-4" style={{ color: D.muted }}>ยังไม่มีบิล</p>
            ) : recentBills.slice(0, 6).map(b => {
              const hasFail = (b.failed_item_count ?? 0) > 0;
              return (
                <button key={b.id} onClick={() => navigate(`/bills/${b.id}`)}
                  className="w-full text-left rounded-lg px-3 py-3 min-h-[56px]"
                  style={{ background: D.bg }}>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[14px] font-semibold" style={{ color: D.cyan }}>{b.invoice_no}</span>
                    <span className="text-[12px] px-2 py-0.5 rounded-full" style={{
                      background: hasFail ? '#F9731618' : '#22C55E18',
                      color: hasFail ? D.orange : D.green,
                    }}>
                      {hasFail ? `ไม่ผ่าน ${b.failed_item_count}` : 'ผ่าน'}
                    </span>
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-[13px] truncate mr-2" style={{ color: D.muted }}>{b.supplier_name}</span>
                    <span className="text-[12px] flex-shrink-0" style={{ color: D.muted }}>{b.received_date}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>

    {/* ══ DESKTOP layout (>=md) — fixed viewport, 3-column ══ */}
    <div className="hidden md:flex md:flex-col -m-4 overflow-hidden"
      style={{ height: 'calc(100vh - 64px)', background: D.bg }}>

      {/* ══ HEADER ══ */}
      <div className="flex-none flex items-center justify-between px-4 py-2"
        style={{ borderBottom: `1px solid ${D.border}` }}>
        <div className="flex items-center gap-2.5">
          <span className="text-[15px] font-bold" style={{ color: D.text }}>IQC Dashboard</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: D.border, color: D.muted }}>QC Staff</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px]" style={{ color: D.muted }}>{todayStr}</span>
          <button onClick={() => navigate('/bills/new')}
            className="px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-opacity hover:opacity-80"
            style={{ background: D.cyan, color: D.bg }}>
            + สร้างบิลใหม่
          </button>
        </div>
      </div>

      {/* ══ KPI ROW ══ */}
      <div className="flex-none grid grid-cols-4 gap-2.5 px-4 pt-2.5">
        {[
          { label: 'บิลวันนี้',    n: kpiN0, color: D.cyan,   sub: 'รับเข้า',       path: '/bills' },
          { label: 'สัปดาห์นี้',   n: kpiN1, color: D.green,  sub: '7 วันล่าสุด',  path: '/bills' },
          { label: 'NCR เปิดอยู่', n: kpiN2, color: D.orange, sub: 'Major / ยังไม่ปิด', path: '/ncr' },
          { label: 'NCP เปิดอยู่', n: kpiN3, color: D.yellow, sub: 'Minor / ยังไม่ปิด', path: '/ncr' },
        ].map(k => (
          <button key={k.label} onClick={() => navigate(k.path)}
            className="rounded-xl px-3 py-2 text-left transition-opacity hover:opacity-80"
            style={{ background: D.card, border: `1px solid ${D.border}` }}>
            <div className="text-2xl font-bold tabular-nums leading-none" style={{ color: k.color }}>
              {isLoading ? '—' : k.n}
            </div>
            <div className="flex items-center justify-between mt-1.5">
              <span className="text-[11px] font-semibold" style={{ color: D.text }}>{k.label}</span>
              <span className="text-[9px]" style={{ color: D.muted }}>{k.sub}</span>
            </div>
          </button>
        ))}
      </div>

      {/* ══ MAIN 3-COLUMN AREA (flex-1 fills remaining height) ══ */}
      <div className="flex-1 min-h-0 grid grid-cols-3 gap-2.5 px-4 py-2.5">

        {/* ──── LEFT: คุณภาพการรับเข้า ──── */}
        <div className="flex flex-col gap-2 min-h-0">
          <CatLabel color={D.green} text="คุณภาพการรับเข้า" />

          {/* Pass/Fail donut — flex-1 */}
          <div className="flex-1 min-h-0 rounded-xl p-3 flex flex-col"
            style={{ background: D.card, border: `1px solid ${D.border}` }}>
            <p className="flex-none text-[11px] font-semibold mb-2" style={{ color: D.text }}>อัตราผ่านการตรวจ</p>
            <div className="flex-1 min-h-0 flex items-center gap-3">
              <div className="relative flex-shrink-0" style={{ width: 96, height: 96 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={passFail.length ? passFail : [{ name: '-', value: 1 }]}
                      dataKey="value" cx="50%" cy="50%"
                      innerRadius={28} outerRadius={44}
                      paddingAngle={passFail.length > 1 ? 3 : 0} stroke="none"
                      isAnimationActive animationDuration={1400}>
                      {passFail.length
                        ? passFail.map((_, i) => <Cell key={i} fill={PASS_COLORS[i]} />)
                        : <Cell fill={D.border} />}
                    </Pie>
                    <Tooltip content={<DarkTip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="text-center">
                    <div className="text-lg font-bold tabular-nums" style={{ color: passColor }}>{passRate}%</div>
                    <div className="text-[8px]" style={{ color: D.muted }}>ผ่าน</div>
                  </div>
                </div>
              </div>
              <div className="flex-1 space-y-2">
                {passFail.map((d, i) => (
                  <div key={d.name}>
                    <div className="flex justify-between mb-0.5">
                      <span className="text-[10px]" style={{ color: D.muted }}>{d.name}</span>
                      <span className="text-[10px] font-mono font-bold" style={{ color: PASS_COLORS[i] }}>{d.value}</span>
                    </div>
                    <div className="h-1 rounded-full" style={{ background: D.border }}>
                      <div className="h-full rounded-full" style={{
                        width: `${approvedCount > 0 ? (d.value / approvedCount * 100) : 0}%`,
                        background: PASS_COLORS[i], transition: 'width 1s ease-out',
                      }} />
                    </div>
                  </div>
                ))}
                <p className="text-[9px] pt-0.5" style={{ color: D.muted }}>จาก {approvedCount} บิล</p>
              </div>
            </div>
          </div>

          {/* Bar chart — flex-1 */}
          <div className="flex-1 min-h-0 rounded-xl p-3 flex flex-col"
            style={{ background: D.card, border: `1px solid ${D.border}` }}>
            <div className="flex-none flex items-center justify-between mb-1.5">
              <p className="text-[11px] font-semibold" style={{ color: D.text }}>บิลรายวัน 7 วัน</p>
              <div className="flex gap-2.5">
                {[['รับเข้า', D.cyan], ['ไม่ผ่าน', D.orange]].map(([l, c]) => (
                  <div key={l} className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-sm" style={{ background: c }} />
                    <span className="text-[9px]" style={{ color: D.muted }}>{l}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={billsLast7} margin={{ top: 2, right: 4, left: -28, bottom: 0 }} barSize={8} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke={D.border} vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: D.muted }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: D.muted }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip content={<DarkTip />} />
                  <Bar dataKey="รับเข้า" fill={D.cyan}   radius={[2,2,0,0]} isAnimationActive />
                  <Bar dataKey="ไม่ผ่าน" fill={D.orange} radius={[2,2,0,0]} isAnimationActive />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

        </div>

        {/* ──── CENTER: แนวโน้ม 7 วัน ──── */}
        <div className="flex flex-col gap-2 min-h-0">
          <CatLabel color={D.cyan} text="แนวโน้มรับเข้า" />

          {/* รายการสินค้าที่รอรับเข้าวันนี้ — flex-none */}
          <div className="flex-none rounded-xl p-3 flex flex-col"
            style={{ background: D.card, border: `1px solid ${D.border}` }}>
            <div className="flex-none flex justify-between items-center mb-2">
              <p className="text-[11px] font-semibold" style={{ color: D.text }}>รอรับเข้าวันนี้</p>
              <button onClick={() => navigate('/delivery')} className="text-[9px] hover:underline" style={{ color: D.cyan }}>ดูทั้งหมด</button>
            </div>
            {todayAwaiting.length === 0 ? (
              <p className="text-[10px] py-1" style={{ color: D.muted }}>ไม่มีรายการวันนี้</p>
            ) : (
              <div className="space-y-1.5 max-h-[110px] overflow-y-auto"
                style={{ scrollbarWidth: 'thin', scrollbarColor: `${D.border} transparent` }}>
                {todayAwaiting.map(s => (
                  <button key={s.id} onClick={() => openDetail(s)}
                    className="w-full text-left rounded-lg px-2 py-1.5 flex items-center justify-between gap-2 transition-colors"
                    style={{ background: D.bg }}>
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold truncate" style={{ color: D.text }}>{s.supplier_name}</p>
                      <p className="text-[9px]" style={{ color: D.muted }}>{s.scheduled_date.slice(5)}{s.time_slot ? ` ${s.time_slot}` : ''}</p>
                    </div>
                    <span className="text-[8px] px-1.5 py-0.5 rounded-full flex-shrink-0" style={{
                      background: s.status === 'pending' ? '#EF444418' : '#38BDF818',
                      color: s.status === 'pending' ? '#F87171' : D.cyan,
                    }}>
                      {s.status === 'pending' ? 'รอรับทราบ' : 'รับทราบแล้ว'}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Area chart — flex-[2] (2 ส่วน) */}
          <div className="flex-[2] min-h-0 rounded-xl p-3 flex flex-col"
            style={{ background: D.card, border: `1px solid ${D.border}` }}>
            <p className="flex-none text-[11px] font-semibold mb-2" style={{ color: D.text }}>รับเข้า / ไม่ผ่าน 7 วัน</p>
            <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={billsLast7} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gCyan" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={D.cyan}   stopOpacity={0.35} />
                      <stop offset="95%" stopColor={D.cyan}   stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="gOrange" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={D.orange} stopOpacity={0.35} />
                      <stop offset="95%" stopColor={D.orange} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={D.border} vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: D.muted }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: D.muted }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip content={<DarkTip />} />
                  <Area type="monotone" dataKey="รับเข้า"  stroke={D.cyan}   strokeWidth={2}
                    fill="url(#gCyan)"   dot={{ r: 2.5, fill: D.cyan,   stroke: D.card, strokeWidth: 1.5 }} isAnimationActive />
                  <Area type="monotone" dataKey="ไม่ผ่าน"  stroke={D.orange} strokeWidth={2}
                    fill="url(#gOrange)" dot={{ r: 2.5, fill: D.orange, stroke: D.card, strokeWidth: 1.5 }} isAnimationActive />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* 3 Radial gauges — flex-1 (1 ส่วน) จัดกึ่งกลางแนวตั้ง */}
          <div className="flex-1 min-h-0 rounded-xl p-3 flex flex-col"
            style={{ background: D.card, border: `1px solid ${D.border}` }}>
            <p className="flex-none text-[11px] font-semibold mb-1" style={{ color: D.text }}>ภาพรวมคุณภาพ</p>
            <div className="flex-1 flex items-center justify-around">
              <RadialGauge value={passedCount} total={approvedCount || 1}
                label="อัตราผ่าน" color={D.green} />
              <RadialGauge value={closedNCR} total={ncrOnlyLength || 1}
                label="NCR ปิดแล้ว" color={D.orange} />
              <RadialGauge value={closedNCP} total={ncpOnlyLength || 1}
                label="NCP ปิดแล้ว" color={D.yellow} />
            </div>
          </div>

        </div>

        {/* ──── RIGHT: NCR Monitor ──── */}
        <div className="flex flex-col gap-2 min-h-0">
          <CatLabel color={D.orange} text="NCR Monitor" />

          {/* NCR vs NCP split card — flex-none */}
          <div className="flex-none rounded-xl p-3"
            style={{ background: D.card, border: `1px solid ${D.border}` }}>
            <p className="text-[11px] font-semibold mb-2" style={{ color: D.text }}>NCR / NCP</p>
            <div className="grid grid-cols-2 gap-2">
              {/* NCR (Major) */}
              <div className="rounded-lg p-2" style={{ background: D.bg }}>
                <div className="flex items-center gap-1 mb-1.5">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#EF4444' }} />
                  <span className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: D.text }}>NCR Major</span>
                </div>
                <div className="flex justify-between items-end">
                  <div>
                    <div className="text-[8px] mb-0.5" style={{ color: D.muted }}>เปิดอยู่</div>
                    <div className="text-xl font-bold tabular-nums" style={{ color: D.orange }}>{openNCR}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[8px] mb-0.5" style={{ color: D.muted }}>ปิดแล้ว</div>
                    <div className="text-xl font-bold tabular-nums" style={{ color: D.green }}>{closedNCR}</div>
                  </div>
                </div>
                <div className="mt-1.5 h-1 rounded-full overflow-hidden" style={{ background: D.border }}>
                  <div className="h-full rounded-full" style={{
                    width: `${ncrOnlyLength > 0 ? (closedNCR / ncrOnlyLength) * 100 : 0}%`,
                    background: D.green, transition: 'width 1s ease-out',
                  }} />
                </div>
                <div className="text-[8px] mt-0.5 text-right" style={{ color: D.muted }}>
                  {ncrOnlyLength > 0 ? Math.round((closedNCR / ncrOnlyLength) * 100) : 0}% ปิด
                </div>
              </div>
              {/* NCP (Minor) */}
              <div className="rounded-lg p-2" style={{ background: D.bg }}>
                <div className="flex items-center gap-1 mb-1.5">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: D.cyan }} />
                  <span className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: D.text }}>NCP Minor</span>
                </div>
                <div className="flex justify-between items-end">
                  <div>
                    <div className="text-[8px] mb-0.5" style={{ color: D.muted }}>เปิดอยู่</div>
                    <div className="text-xl font-bold tabular-nums" style={{ color: D.yellow }}>{openNCP}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[8px] mb-0.5" style={{ color: D.muted }}>ปิดแล้ว</div>
                    <div className="text-xl font-bold tabular-nums" style={{ color: D.green }}>{closedNCP}</div>
                  </div>
                </div>
                <div className="mt-1.5 h-1 rounded-full overflow-hidden" style={{ background: D.border }}>
                  <div className="h-full rounded-full" style={{
                    width: `${ncpOnlyLength > 0 ? (closedNCP / ncpOnlyLength) * 100 : 0}%`,
                    background: D.green, transition: 'width 1s ease-out',
                  }} />
                </div>
                <div className="text-[8px] mt-0.5 text-right" style={{ color: D.muted }}>
                  {ncpOnlyLength > 0 ? Math.round((closedNCP / ncpOnlyLength) * 100) : 0}% ปิด
                </div>
              </div>
            </div>
          </div>

          {/* NCR stages ranking — flex-none */}
          <div className="flex-none rounded-xl p-3"
            style={{ background: D.card, border: `1px solid ${D.border}` }}>
            <div className="flex justify-between items-center mb-2">
              <p className="text-[11px] font-semibold" style={{ color: D.text }}>NCR ตามขั้นตอน</p>
              <button onClick={() => navigate('/ncr')} className="text-[9px] hover:underline" style={{ color: D.cyan }}>ดูทั้งหมด</button>
            </div>
            {ncrStages.length === 0 ? (
              <p className="text-[10px] py-1" style={{ color: D.muted }}>ยังไม่มี NCR</p>
            ) : (
              <div className="space-y-1.5">
                {ncrStages.map(g => (
                  <div key={g.key}>
                    <div className="flex justify-between mb-0.5">
                      <span className="text-[10px]" style={{ color: D.muted }}>{g.label}</span>
                      <span className="text-[10px] font-mono font-bold" style={{ color: g.color }}>{g.count}</span>
                    </div>
                    <div className="h-1 rounded-full" style={{ background: D.border }}>
                      <div className="h-full rounded-full"
                        style={{ width: `${(g.count / maxStage) * 100}%`, background: g.color, transition: 'width 1s ease-out' }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent bills — flex-1 พร้อม scroll ภายใน */}
          <div className="flex-1 min-h-0 rounded-xl p-3 flex flex-col overflow-hidden"
            style={{ background: D.card, border: `1px solid ${D.border}` }}>
            <div className="flex-none flex justify-between items-center mb-2">
              <p className="text-[11px] font-semibold" style={{ color: D.text }}>บิลล่าสุด</p>
              <button onClick={() => navigate('/bills')} className="text-[9px] hover:underline" style={{ color: D.cyan }}>ดูทั้งหมด</button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto space-y-1"
              style={{ scrollbarWidth: 'thin', scrollbarColor: `${D.border} transparent` }}>
              {recentBills.length === 0 ? (
                <p className="text-[10px] text-center py-4" style={{ color: D.muted }}>ยังไม่มีบิล</p>
              ) : recentBills.map(b => {
                const hasFail = (b.failed_item_count ?? 0) > 0;
                return (
                  <button key={b.id} onClick={() => navigate(`/bills/${b.id}`)}
                    className="w-full text-left rounded-lg px-2.5 py-1.5 transition-colors"
                    style={{ background: D.bg }}
                    onMouseEnter={e => e.currentTarget.style.background = D.border}
                    onMouseLeave={e => e.currentTarget.style.background = D.bg}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] font-semibold" style={{ color: D.cyan }}>{b.invoice_no}</span>
                      <span className="text-[8px] px-1.5 py-0.5 rounded-full" style={{
                        background: hasFail ? '#F9731618' : '#22C55E18',
                        color: hasFail ? D.orange : D.green,
                      }}>
                        {hasFail ? `ไม่ผ่าน ${b.failed_item_count}` : 'ผ่าน'}
                      </span>
                    </div>
                    <div className="flex justify-between mt-0.5">
                      <span className="text-[9px] truncate mr-2" style={{ color: D.muted }}>{b.supplier_name}</span>
                      <span className="text-[9px] flex-shrink-0" style={{ color: D.muted }}>{b.received_date}</span>
                    </div>
                  </button>
                );
              })}
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
