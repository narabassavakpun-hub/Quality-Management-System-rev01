import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useNotifications } from '../../hooks/useNotifications';
import api from '../../utils/api';
import SummaryCard from '../../components/UI/SummaryCard';
import Badge from '../../components/UI/Badge';
import Button from '../../components/UI/Button';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area, CartesianGrid } from 'recharts';

function toArr(res) {
  const d = res.data;
  return Array.isArray(d) ? d : (d?.data ?? []);
}

function useStats() {
  return useQuery({ queryKey: ['dashboard-stats'], queryFn: () => Promise.all([
    api.get('/bills?status=pending_approval&limit=500').then(toArr),
    api.get('/ncr?limit=500').then(toArr),
    api.get('/uai?limit=500').then(toArr),
    api.get('/bills?limit=500').then(toArr),
  ]).then(([pendingBills, ncrs, uais, allBills]) => ({ pendingBills, ncrs, uais, allBills })) });
}

/* ─── Dark palette for QC Staff dashboard ─── */
const D = {
  bg:     '#0B1929',
  card:   '#0F2236',
  border: '#1E3A5F',
  text:   '#E2EAF4',
  muted:  '#7B9AB8',
  cyan:   '#38BDF8',
  green:  '#22C55E',
  orange: '#F97316',
  yellow: '#EAB308',
  purple: '#A78BFA',
};

const DarkTip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#1E3A5F', border: '1px solid #2E5080', borderRadius: 8, padding: '8px 12px' }}>
      {label && <p style={{ color: D.muted, fontSize: 10, marginBottom: 4 }}>{label}</p>}
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.stroke || p.fill || D.cyan, fontSize: 12, fontWeight: 600 }}>
          {p.value} {p.name}
        </p>
      ))}
    </div>
  );
};

function RadialGauge({ value, total, label, color }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  const animated = useCountUp(pct);
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: 88, height: 88 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={[{ v: pct }, { v: Math.max(0, 100 - pct) }]}
              dataKey="v" cx="50%" cy="50%"
              innerRadius={28} outerRadius={40}
              startAngle={90} endAngle={-270} stroke="none"
              isAnimationActive animationDuration={1400}
            >
              <Cell fill={color} />
              <Cell fill={D.border} />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-base font-bold tabular-nums" style={{ color }}>{animated}%</span>
        </div>
      </div>
      <p className="text-[10px] text-center leading-tight" style={{ color: D.muted }}>{label}</p>
      <p className="text-[9px]" style={{ color: D.muted }}>{value}/{total}</p>
    </div>
  );
}

function DarkCard({ children, className = '', style = {} }) {
  return (
    <div className={`rounded-xl p-3 ${className}`} style={{ background: D.card, border: `1px solid ${D.border}`, ...style }}>
      {children}
    </div>
  );
}

function CatLabel({ color, text }) {
  return (
    <div className="flex-none flex items-center gap-2 mb-1">
      <div className="w-1 h-4 rounded-full" style={{ background: color }} />
      <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: D.muted }}>{text}</span>
    </div>
  );
}

function QCStaffDash({ navigate }) {
  const { data, isLoading } = useStats();
  const today = new Date().toISOString().slice(0, 10);

  const allBills = data?.allBills || [];
  const ncrs     = data?.ncrs     || [];

  const todayBills = allBills.filter(b => b.created_at?.slice(0, 10) === today);
  const weekBills  = allBills.filter(b => (Date.now() - new Date(b.created_at)) / 86400000 <= 7);

  const approvedBills = allBills.filter(b => b.status === 'approved');
  const passedBills   = approvedBills.filter(b => (b.failed_item_count ?? 0) === 0);
  const failedBills   = approvedBills.length - passedBills.length;
  const passRate      = approvedBills.length > 0 ? Math.round((passedBills.length / approvedBills.length) * 100) : 0;

  const ncrOnly   = ncrs.filter(n => n.severity === 'major');
  const ncpOnly   = ncrs.filter(n => n.severity === 'minor');
  const openNCR   = ncrOnly.filter(n => !['closed','cancelled'].includes(n.status)).length;
  const closedNCR = ncrOnly.filter(n => n.status === 'closed').length;
  const openNCP   = ncpOnly.filter(n => !['ncp_closed','cancelled'].includes(n.status)).length;
  const closedNCP = ncpOnly.filter(n => n.status === 'ncp_closed').length;

  const billsLast7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const ds = d.toISOString().slice(0, 10);
    const day = allBills.filter(b => b.created_at?.slice(0, 10) === ds);
    return {
      date: `${d.getDate()}/${d.getMonth() + 1}`,
      รับเข้า: day.length,
      ไม่ผ่าน: day.filter(b => (b.failed_item_count ?? 0) > 0).length,
    };
  });

  const passFail = [
    { name: 'ผ่าน',     value: passedBills.length },
    { name: 'ไม่ผ่าน',  value: failedBills },
  ].filter(d => d.value > 0);

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
  ].map(g => ({ ...g, count: ncrs.filter(n => n.status === g.key).length }))
   .filter(g => g.count > 0);

  const maxStage = Math.max(...ncrStages.map(g => g.count), 1);

  const recentBills = [...allBills]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 8);

  const todayStr = new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
  const passColor = passRate >= 80 ? D.green : passRate >= 60 ? D.yellow : D.orange;

  const PASS_COLORS = [D.green, D.orange];

  const kpiN0 = useCountUp(isLoading ? 0 : todayBills.length);
  const kpiN1 = useCountUp(isLoading ? 0 : weekBills.length);
  const kpiN2 = useCountUp(isLoading ? 0 : openNCR);
  const kpiN3 = useCountUp(isLoading ? 0 : openNCP);

  return (
    /* ── ล้าง padding ของ main แล้ว fill เต็ม viewport ── */
    <div className="flex flex-col -m-4 overflow-hidden"
      style={{ height: 'calc(100vh - 64px)', background: D.bg }}>

      {/* ══ HEADER ══ */}
      <div className="flex-none flex items-center justify-between px-4 py-2"
        style={{ borderBottom: `1px solid ${D.border}` }}>
        <div className="flex items-center gap-2.5">
          <span className="text-[15px] font-bold" style={{ color: D.text }}>IQC Dashboard</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: D.border, color: D.muted }}>QC Staff</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] hidden md:block" style={{ color: D.muted }}>{todayStr}</span>
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
                        width: `${approvedBills.length > 0 ? (d.value / approvedBills.length * 100) : 0}%`,
                        background: PASS_COLORS[i], transition: 'width 1s ease-out',
                      }} />
                    </div>
                  </div>
                ))}
                <p className="text-[9px] pt-0.5" style={{ color: D.muted }}>จาก {approvedBills.length} บิล</p>
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
              <RadialGauge value={passedBills.length} total={approvedBills.length || 1}
                label="อัตราผ่าน" color={D.green} />
              <RadialGauge value={closedNCR} total={ncrOnly.length || 1}
                label="NCR ปิดแล้ว" color={D.orange} />
              <RadialGauge value={closedNCP} total={ncpOnly.length || 1}
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
                    width: `${ncrOnly.length > 0 ? (closedNCR / ncrOnly.length) * 100 : 0}%`,
                    background: D.green, transition: 'width 1s ease-out',
                  }} />
                </div>
                <div className="text-[8px] mt-0.5 text-right" style={{ color: D.muted }}>
                  {ncrOnly.length > 0 ? Math.round((closedNCR / ncrOnly.length) * 100) : 0}% ปิด
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
                    width: `${ncpOnly.length > 0 ? (closedNCP / ncpOnly.length) * 100 : 0}%`,
                    background: D.green, transition: 'width 1s ease-out',
                  }} />
                </div>
                <div className="text-[8px] mt-0.5 text-right" style={{ color: D.muted }}>
                  {ncpOnly.length > 0 ? Math.round((closedNCP / ncpOnly.length) * 100) : 0}% ปิด
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
  );
}

function SupervisorDash({ navigate }) {
  const { data } = useStats();
  const pendingBills = data?.pendingBills || [];
  const pendingNCR = data?.ncrs?.filter(n => n.status === 'pending_supervisor') || [];

  return (
    <div className="space-y-6">
      <h1 className="page-title">หน้าหลัก QC Supervisor</h1>
      <div className="grid grid-cols-2 gap-4">
        <SummaryCard value={pendingBills.length} label="รับเข้ารออนุมัติ" color="warning" />
        <SummaryCard value={pendingNCR.length} label="NCR รออนุมัติ" color="danger" />
      </div>
      <div className="card">
        <h2 className="text-h3 font-semibold text-primary mb-3">รายการรับเข้ารออนุมัติ</h2>
        <div className="table-container">
          <table className="table">
            <thead><tr><th>Invoice No.</th><th>PO No.</th><th>Supplier</th><th>วันที่</th></tr></thead>
            <tbody>
              {pendingBills.map(b => (
                <tr key={b.id} onClick={() => navigate(`/bills/${b.id}`)}>
                  <td className="font-mono">{b.invoice_no}</td>
                  <td className="font-mono">{b.po_no}</td>
                  <td>{b.supplier_name}</td>
                  <td>{b.received_date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <h2 className="text-h3 font-semibold text-primary mb-3">NCR รออนุมัติ</h2>
        <div className="table-container">
          <table className="table">
            <thead><tr><th>รหัส NCR</th><th>รายการ</th><th>Supplier</th><th>วันที่</th></tr></thead>
            <tbody>
              {pendingNCR.map(n => (
                <tr key={n.id} onClick={() => navigate(`/ncr/${n.id}`)}>
                  <td className="font-mono">{n.ncr_code}</td>
                  <td>{n.item_name}</td>
                  <td>{n.supplier_name}</td>
                  <td>{n.created_at?.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ManagerDash({ navigate }) {
  const { data } = useStats();
  const openStatuses = ['pending_supervisor','pending_manager','pending_qmr_open','pending_supplier','pending_manager_review','pending_qmr_close','pending_uai'];
  const openNCR = data?.ncrs?.filter(n => openStatuses.includes(n.status)) || [];
  const pendingUAI = data?.uais?.filter(u => !['uai_completed','uai_rejected','uai_rejected_by_exec'].includes(u.status)) || [];

  return (
    <div className="space-y-6">
      <h1 className="page-title">หน้าหลัก QC Manager</h1>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard value={data?.ncrs?.length ?? 0} label="NCR ทั้งหมด" color="primary" />
        <SummaryCard value={openNCR.length} label="NCR เปิดอยู่" color="danger" />
        <SummaryCard value={pendingUAI.length} label="UAI รอดำเนินการ" color="warning" />
        <SummaryCard value={data?.ncrs?.filter(n => n.status === 'pending_supplier')?.length ?? 0} label="รอตรวจ Supplier" color="accent" />
      </div>
      <div className="card">
        <h2 className="text-h3 font-semibold text-primary mb-3">NCR ตามสถานะ</h2>
        <div className="table-container">
          <table className="table">
            <thead><tr><th>รหัส NCR</th><th>รายการ</th><th>Supplier</th><th>สถานะ</th><th>วันที่</th></tr></thead>
            <tbody>
              {openNCR.slice(0, 15).map(n => (
                <tr key={n.id} onClick={() => navigate(`/ncr/${n.id}`)}>
                  <td className="font-mono">{n.ncr_code}</td>
                  <td>{n.item_name}</td>
                  <td>{n.supplier_name}</td>
                  <td><Badge status={n.status} /></td>
                  <td>{n.created_at?.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function QMRDash({ navigate }) {
  const { data } = useStats();
  const openStatuses = ['pending_supervisor','pending_manager','pending_qmr_open','pending_supplier','pending_manager_review','pending_qmr_close','pending_uai'];

  return (
    <div className="space-y-6">
      <h1 className="page-title">หน้าหลัก QMR</h1>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard value={data?.ncrs?.length ?? 0} label="NCR ทั้งหมด" color="primary" />
        <SummaryCard value={data?.ncrs?.filter(n => openStatuses.includes(n.status))?.length ?? 0} label="NCR เปิดอยู่" color="danger" />
        <SummaryCard value={data?.ncrs?.filter(n => n.status === 'closed')?.length ?? 0} label="NCR ปิดแล้ว" color="success" />
        <SummaryCard value={data?.uais?.length ?? 0} label="UAI ทั้งหมด" color="accent" />
      </div>
      <div className="card">
        <h2 className="text-h3 font-semibold text-primary mb-3">NCR รออนุมัติเปิด/ปิด</h2>
        <div className="table-container">
          <table className="table">
            <thead><tr><th>รหัส NCR</th><th>รายการ</th><th>สถานะ</th><th>วันที่</th></tr></thead>
            <tbody>
              {data?.ncrs?.filter(n => ['pending_qmr_open','pending_qmr_close'].includes(n.status)).map(n => (
                <tr key={n.id} onClick={() => navigate(`/ncr/${n.id}`)}>
                  <td className="font-mono">{n.ncr_code}</td>
                  <td>{n.item_name}</td>
                  <td><Badge status={n.status} /></td>
                  <td>{n.created_at?.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function PurchasingDash({ navigate }) {
  const { data } = useStats();
  const toSend = data?.ncrs?.filter(n => n.status === 'pending_supplier') || [];
  const uaiPending = data?.uais?.filter(u => u.status === 'uai_pending_purchasing') || [];

  return (
    <div className="space-y-6">
      <h1 className="page-title">หน้าหลัก จัดซื้อ</h1>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <SummaryCard value={toSend.length} label="NCR รอส่ง Supplier" color="danger" />
        <SummaryCard value={data?.ncrs?.filter(n => n.status === 'pending_manager_review')?.length ?? 0} label="Supplier ยังไม่ตอบ" color="warning" />
        <SummaryCard value={uaiPending.length} label="UAI รอออกเอกสาร" color="accent" />
      </div>
      <div className="card">
        <h2 className="text-h3 font-semibold text-primary mb-3">NCR ที่ต้องส่ง Supplier</h2>
        <div className="table-container">
          <table className="table">
            <thead><tr><th>รหัส NCR</th><th>รายการ</th><th>Supplier</th><th>วันที่</th></tr></thead>
            <tbody>
              {toSend.map(n => (
                <tr key={n.id} onClick={() => navigate(`/ncr/${n.id}`)}>
                  <td className="font-mono">{n.ncr_code}</td>
                  <td>{n.item_name}</td>
                  <td>{n.supplier_name}</td>
                  <td>{n.created_at?.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ExecutiveDash({ navigate }) {
  const { data } = useStats();
  const { user } = useAuth();
  const roleSignMap = { cco: 'uai_pending_cco', cmo: 'uai_pending_cmo', cpo: 'uai_pending_cpo' };
  const mySignStatus = roleSignMap[user?.role];
  const myUAI = data?.uais?.filter(u => u.status === mySignStatus) || [];

  return (
    <div className="space-y-6">
      <h1 className="page-title">หน้าหลัก {user?.role?.toUpperCase()}</h1>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard value={myUAI.length} label="UAI รอลงนาม" color="danger" />
        <SummaryCard value={data?.uais?.filter(u => u.status === 'uai_completed')?.length ?? 0} label="UAI อนุมัติแล้ว" color="success" />
        <SummaryCard value={data?.ncrs?.filter(n => n.status !== 'closed')?.length ?? 0} label="NCR เปิดอยู่" color="warning" />
        <SummaryCard value={data?.allBills?.length ?? 0} label="รับเข้าทั้งหมด" color="primary" />
      </div>
      {myUAI.length > 0 && (
        <div className="card border-l-4 border-l-danger">
          <h2 className="text-h3 font-semibold text-danger mb-3">UAI รอลงนามของคุณ</h2>
          <div className="table-container">
            <table className="table">
              <thead><tr><th>รหัส UAI</th><th>NCR อ้างอิง</th><th>รายการ</th><th>Supplier</th><th></th></tr></thead>
              <tbody>
                {myUAI.map(u => (
                  <tr key={u.id} onClick={() => navigate(`/uai/${u.id}`)}>
                    <td className="font-mono">{u.uai_code}</td>
                    <td className="font-mono">{u.ncr_code}</td>
                    <td>{u.item_name}</td>
                    <td>{u.supplier_name}</td>
                    <td><span className="badge bg-red-100 text-red-700">รอคุณ</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ProductionDash({ navigate }) {
  const { data } = useStats();
  const myUAI = data?.uais?.filter(u => u.status === 'uai_pending_production_ack') || [];

  return (
    <div className="space-y-6">
      <h1 className="page-title">หน้าหลัก ผู้จัดการผลิต</h1>
      <div className="grid grid-cols-2 gap-4">
        <SummaryCard value={myUAI.length} label="UAI รอรับทราบ" color="danger" />
        <SummaryCard value={data?.ncrs?.length ?? 0} label="NCR ทั้งหมด" color="primary" />
      </div>
      {myUAI.length > 0 && (
        <div className="card border-l-4 border-l-danger">
          <h2 className="text-h3 font-semibold text-danger mb-3">UAI รอรับทราบ</h2>
          <div className="table-container">
            <table className="table">
              <thead><tr><th>รหัส UAI</th><th>รายการ</th><th>Supplier</th></tr></thead>
              <tbody>
                {myUAI.map(u => (
                  <tr key={u.id} onClick={() => navigate(`/uai/${u.id}`)}>
                    <td className="font-mono">{u.uai_code}</td>
                    <td>{u.item_name}</td>
                    <td>{u.supplier_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── count-up animation ─── */
function useCountUp(target, duration = 1100) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const n = Number(target) || 0;
    if (n === 0) { setCount(0); return; }
    let raf;
    const t0 = Date.now();
    const tick = () => {
      const p = Math.min((Date.now() - t0) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      setCount(Math.round(ease * n));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return count;
}

/* ─── custom chart tooltip ─── */
const ChartTip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface border border-border rounded-lg shadow-lg px-3 py-2 text-small">
      <p className="text-muted text-[11px] mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="font-semibold" style={{ color: p.stroke || p.fill || p.color }}>
          {p.value} {p.name}
        </p>
      ))}
    </div>
  );
};

/* ─── KPI card ─── */
function KPICard({ label, value, loading, onClick, iconBg, icon }) {
  const n = useCountUp(loading ? 0 : (value ?? 0));
  return (
    <button onClick={onClick}
      className="bg-surface border border-border rounded-xl p-5 text-left shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 group"
    >
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-4 ${iconBg}`}>
        {icon}
      </div>
      <div className="text-[32px] font-bold leading-none tabular-nums text-text">
        {loading ? <span className="text-border text-2xl">—</span> : n}
      </div>
      <div className="text-small text-muted mt-2">{label}</div>
    </button>
  );
}

/* ─── Admin Dashboard ─── */
function AdminDash({ navigate }) {
  const { user, logout } = useAuth();
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef(null);
  useEffect(() => {
    if (!bellOpen) return;
    function handler(e) { if (!bellRef.current?.contains(e.target)) setBellOpen(false); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [bellOpen]);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  useEffect(() => {
    if (!menuOpen) return;
    function handler(e) { if (!menuRef.current?.contains(e.target)) setMenuOpen(false); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const { data: stats, isLoading } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => api.get('/admin/stats').then(r => r.data),
    refetchInterval: 60000,
  });

  const cardStyle = { background: D.card, border: `1px solid ${D.border}` };
  const closedNCR = (stats?.total_ncr ?? 0) - (stats?.open_ncr ?? 0);
  const passRatePct = (() => {
    const t = stats?.pass_fail_items?.qty_total || 0;
    const p = stats?.pass_fail_items?.qty_passed || 0;
    return t > 0 ? Math.round((p / t) * 100) : null;
  })();
  const majorNCR = stats?.ncr_by_severity?.find(s => s.severity === 'major')?.c ?? 0;
  const minorNCR = stats?.ncr_by_severity?.find(s => s.severity === 'minor')?.c ?? 0;
  const todayStr = new Date().toLocaleDateString('th-TH', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });

  const kpiN0 = useCountUp(isLoading ? 0 : (stats?.today_bills ?? 0));
  const kpiN1 = useCountUp(isLoading ? 0 : (stats?.month_bills ?? 0));
  const kpiN2 = useCountUp(isLoading ? 0 : (stats?.open_ncr ?? 0));
  const kpiN3 = useCountUp(isLoading ? 0 : (passRatePct ?? 0));
  const kpiN4 = useCountUp(isLoading ? 0 : (stats?.users ?? 0));

  const passColor = passRatePct == null ? D.muted : passRatePct >= 90 ? D.green : passRatePct >= 75 ? D.yellow : D.orange;

  return (
    <div className="flex flex-col overflow-hidden" style={{ height: '100vh', background: D.bg }}>

      {/* ══ HEADER ══ */}
      <div className="flex-none flex items-center justify-between px-4 py-2"
        style={{ borderBottom: `1px solid ${D.border}` }}>
        <div className="flex items-center gap-3">
          <span className="text-[16px] font-bold tracking-tight" style={{ color: D.text }}>IQC Dashboard</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide" style={{ background: D.border, color: D.purple }}>Admin</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] hidden md:block" style={{ color: D.muted }}>{todayStr}</span>

          {/* Bell */}
          <div className="relative" ref={bellRef}>
            <button onClick={() => setBellOpen(p => !p)}
              className="relative w-8 h-8 flex items-center justify-center rounded-lg transition-opacity hover:opacity-80"
              style={{ background: bellOpen ? D.border : 'transparent' }}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: D.muted }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>
            {bellOpen && (
              <div className="absolute right-0 top-full mt-1 w-72 rounded-xl shadow-2xl z-50 overflow-hidden"
                style={{ background: D.card, border: `1px solid ${D.border}` }}>
                <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: `1px solid ${D.border}` }}>
                  <span className="text-[12px] font-semibold" style={{ color: D.text }}>การแจ้งเตือน</span>
                  {unreadCount > 0 && (
                    <button onClick={() => markAllRead.mutate()} className="text-[10px] hover:underline" style={{ color: D.cyan }}>อ่านทั้งหมด</button>
                  )}
                </div>
                <div className="max-h-60 overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: `${D.border} transparent` }}>
                  {notifications.length === 0 && (
                    <div className="px-4 py-5 text-center text-[11px]" style={{ color: D.muted }}>ไม่มีการแจ้งเตือน</div>
                  )}
                  {notifications.slice(0, 20).map(n => (
                    <button key={n.id} onClick={() => { markRead.mutate(n.id); setBellOpen(false); navigate(n.link); }}
                      className="w-full text-left px-3 py-2.5 transition-opacity hover:opacity-80"
                      style={{ background: n.is_read ? 'transparent' : '#38BDF808', borderBottom: `1px solid ${D.border}` }}>
                      <div className="flex items-start gap-2">
                        {!n.is_read && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5" style={{ background: D.cyan }} />}
                        <div className={n.is_read ? 'pl-3.5' : ''}>
                          <div className="text-[11px] font-medium" style={{ color: D.text }}>{n.title}</div>
                          <div className="text-[10px] mt-0.5" style={{ color: D.muted }}>{n.message}</div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <span className="text-[11px]" style={{ color: D.muted }}>{user?.full_name}</span>

          {/* Export Excel (Power BI) */}
          <a href="/api/powerbi"
            className="px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-opacity hover:opacity-80 flex items-center gap-1"
            style={{ background: D.border, color: D.green }}>
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export Excel
          </a>

          {/* เปิดเมนู dropdown */}
          <div className="relative" ref={menuRef}>
            <button onClick={() => setMenuOpen(p => !p)}
              className="px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-opacity hover:opacity-80 flex items-center gap-1"
              style={{ background: menuOpen ? D.purple + '22' : D.border, color: D.purple }}>
              เปิดเมนู
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-36 rounded-xl shadow-2xl z-50 overflow-hidden"
                style={{ background: D.card, border: `1px solid ${D.border}` }}>
                {[
                  { label: 'จัดการผู้ใช้', path: '/admin/users' },
                  { label: 'ตั้งค่า', path: '/admin/settings' },
                  { label: 'วันหยุด', path: '/admin/holidays' },
                ].map(item => (
                  <button key={item.path}
                    onClick={() => { setMenuOpen(false); navigate(item.path); }}
                    className="w-full text-left px-3 py-2.5 text-[11px] transition-opacity hover:opacity-70"
                    style={{ color: D.text, borderBottom: `1px solid ${D.border}` }}>
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ══ KPI ROW (5 cards) ══ */}
      <div className="flex-none grid grid-cols-5 gap-2 px-4 pt-2.5">
        {[
          { label: 'บิลวันนี้',      n: kpiN0, suffix: '',  color: D.cyan,   sub: 'รับเข้าวันนี้',         path: '/bills' },
          { label: 'บิลเดือนนี้',    n: kpiN1, suffix: '',  color: D.green,  sub: 'เดือนปัจจุบัน',         path: '/bills' },
          { label: 'NCR เปิดอยู่',   n: kpiN2, suffix: '',  color: D.orange, sub: 'ยังไม่ปิด',             path: '/ncr'   },
          { label: 'อัตราผ่านตรวจ',  n: kpiN3, suffix: '%', color: passColor,sub: 'รายการที่ไม่มี NCR', path: '/bills' },
          { label: 'ผู้ใช้งาน',      n: kpiN4, suffix: '',  color: D.purple, sub: 'Active users',          path: '/admin/users' },
        ].map(k => (
          <button key={k.label} onClick={() => navigate(k.path)}
            className="rounded-xl px-3 py-2.5 text-left transition-all hover:scale-[1.02]"
            style={cardStyle}>
            <div className="text-2xl font-bold tabular-nums leading-none" style={{ color: k.color }}>
              {isLoading ? '—' : `${k.n}${k.suffix}`}
            </div>
            <div className="flex items-center justify-between mt-1.5">
              <span className="text-[11px] font-semibold" style={{ color: D.text }}>{k.label}</span>
              <span className="text-[9px]" style={{ color: D.muted }}>{k.sub}</span>
            </div>
          </button>
        ))}
      </div>

      {/* ══ MAIN 3-COLUMN ══ */}
      <div className="flex-1 min-h-0 grid grid-cols-3 gap-2 px-4 py-2 pb-2.5">

        {/* ──── LEFT: Supplier Quality Ranking ──── */}
        <div className="flex flex-col gap-2 min-h-0">
          <CatLabel color={D.purple} text="คุณภาพ Supplier" />

          <div className="flex-1 min-h-0 rounded-xl p-3 flex flex-col overflow-hidden" style={cardStyle}>
            <div className="flex-none flex items-center justify-between mb-2">
              <p className="text-[11px] font-semibold" style={{ color: D.text }}>อันดับคุณภาพ Supplier</p>
              <span className="text-[9px]" style={{ color: D.muted }}>เรียงตาม NCR มากสุด</span>
            </div>
            {/* Header row */}
            <div className="flex-none grid text-[9px] font-semibold uppercase tracking-wide mb-1.5 px-1"
              style={{ gridTemplateColumns: '1fr 40px 40px 56px', color: D.muted }}>
              <span>Supplier</span>
              <span className="text-right">บิล</span>
              <span className="text-right">NCR</span>
              <span className="text-right">Pass %</span>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto space-y-1"
              style={{ scrollbarWidth: 'thin', scrollbarColor: `${D.border} transparent` }}>
              {isLoading ? (
                <p className="text-[10px] py-4 text-center" style={{ color: D.muted }}>กำลังโหลด...</p>
              ) : (stats?.supplier_quality?.length ?? 0) === 0 ? (
                <p className="text-[10px] py-4 text-center" style={{ color: D.muted }}>ยังไม่มีข้อมูล</p>
              ) : stats.supplier_quality.map((s, i) => {
                const pr = s.pass_rate ?? 100;
                const prColor = pr >= 90 ? D.green : pr >= 75 ? D.yellow : D.orange;
                return (
                  <div key={i} className="rounded-lg px-2.5 py-2" style={{ background: D.bg }}>
                    <div className="grid items-center gap-1 mb-1"
                      style={{ gridTemplateColumns: '1fr 40px 40px 56px' }}>
                      <span className="text-[10px] truncate font-medium" style={{ color: D.text }}>{s.supplier_name}</span>
                      <span className="text-[10px] text-right font-mono" style={{ color: D.muted }}>{s.bill_count}</span>
                      <span className="text-[10px] text-right font-mono font-bold" style={{ color: s.ncr_count > 0 ? D.orange : D.muted }}>
                        {s.ncr_count}
                      </span>
                      <span className="text-[10px] text-right font-mono font-bold" style={{ color: prColor }}>
                        {pr.toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-0.5 rounded-full" style={{ background: D.border }}>
                      <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(pr, 0)}%`, background: prColor }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* NCR Major vs Minor */}
          <div className="flex-none rounded-xl p-3" style={cardStyle}>
            <p className="text-[11px] font-semibold mb-2" style={{ color: D.text }}>NCR แยกระดับ</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Major', count: majorNCR, color: '#EF4444', sub: 'ร้ายแรง' },
                { label: 'Minor (NCP)', count: minorNCR, color: D.cyan, sub: 'เล็กน้อย' },
              ].map(item => (
                <div key={item.label} className="rounded-lg p-2 text-center" style={{ background: D.bg }}>
                  <div className="text-[9px] font-semibold uppercase tracking-wide mb-1" style={{ color: item.color }}>{item.label}</div>
                  <div className="text-2xl font-bold tabular-nums" style={{ color: item.color }}>{item.count}</div>
                  <div className="text-[9px] mt-0.5" style={{ color: D.muted }}>{item.sub}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ──── CENTER: แนวโน้ม ──── */}
        <div className="flex flex-col gap-2 min-h-0">
          <CatLabel color={D.cyan} text="แนวโน้มระบบ" />

          {/* Bills 30 days — flex-[2] */}
          <div className="flex-[2] min-h-0 rounded-xl p-3 flex flex-col" style={cardStyle}>
            <div className="flex-none flex items-center justify-between mb-1">
              <p className="text-[11px] font-semibold" style={{ color: D.text }}>บิลรับเข้า 30 วัน</p>
            </div>
            <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={stats?.bills_last30 ?? []} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
                  <defs>
                    <linearGradient id="aAdminBill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={D.cyan} stopOpacity={0.4} />
                      <stop offset="95%" stopColor={D.cyan} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={D.border} vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 8, fill: D.muted }} axisLine={false} tickLine={false}
                    interval={4} />
                  <YAxis tick={{ fontSize: 9, fill: D.muted }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip content={<DarkTip />} />
                  <Area type="monotone" dataKey="count" name="บิล"
                    stroke={D.cyan} strokeWidth={2} fill="url(#aAdminBill)"
                    dot={false} isAnimationActive animationDuration={1400} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* NCR monthly bar — flex-1 */}
          <div className="flex-1 min-h-0 rounded-xl p-3 flex flex-col" style={cardStyle}>
            <p className="flex-none text-[11px] font-semibold mb-1" style={{ color: D.text }}>NCR รายเดือน (ปีนี้)</p>
            <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats?.ncr_last12months ?? []} margin={{ top: 2, right: 4, left: -28, bottom: 0 }} barSize={12}>
                  <CartesianGrid strokeDasharray="3 3" stroke={D.border} vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 8, fill: D.muted }} axisLine={false} tickLine={false} interval={0} />
                  <YAxis tick={{ fontSize: 9, fill: D.muted }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip content={<DarkTip />} />
                  <Bar dataKey="c" name="NCR" fill={D.orange} radius={[3,3,0,0]} isAnimationActive animationDuration={1200} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* ──── RIGHT: สรุปภาพรวม + กิจกรรม ──── */}
        <div className="flex flex-col gap-2 min-h-0">
          <CatLabel color={D.green} text="ภาพรวมระบบ" />

          {/* 3 Gauges */}
          <div className="flex-none rounded-xl p-3" style={cardStyle}>
            <p className="text-[11px] font-semibold mb-1" style={{ color: D.text }}>ตัวชี้วัดหลัก</p>
            <div className="flex justify-around">
              <RadialGauge value={closedNCR} total={stats?.total_ncr || 1}
                label="NCR ปิดแล้ว" color={D.green} />
              <RadialGauge value={passRatePct ?? 0} total={100}
                label="อัตราผ่าน%" color={passColor} />
              <RadialGauge value={stats?.completed_uai ?? 0} total={stats?.total_uai || 1}
                label="UAI เสร็จ" color={D.cyan} />
            </div>
          </div>

          {/* Master data mini cards */}
          <div className="flex-none rounded-xl p-3" style={cardStyle}>
            <p className="text-[11px] font-semibold mb-2" style={{ color: D.text }}>ข้อมูลหลัก</p>
            <div className="grid grid-cols-3 gap-1.5">
              {[
                { label: 'Supplier', value: stats?.suppliers, path: '/master/suppliers', color: D.cyan },
                { label: 'สินค้า',  value: stats?.products,  path: '/master/products',  color: D.green },
                { label: 'ผู้ใช้',  value: stats?.users,     path: '/admin/users',      color: D.purple },
              ].map(m => (
                <button key={m.label} onClick={() => navigate(m.path)}
                  className="rounded-lg py-2 flex flex-col items-center transition-opacity hover:opacity-80"
                  style={{ background: D.bg }}>
                  <span className="text-lg font-bold tabular-nums" style={{ color: m.color }}>
                    {isLoading ? '—' : (m.value ?? 0)}
                  </span>
                  <span className="text-[9px] mt-0.5" style={{ color: D.muted }}>{m.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Recent bills — flex-1 */}
          <div className="flex-1 min-h-0 rounded-xl p-3 flex flex-col overflow-hidden" style={cardStyle}>
            <div className="flex-none flex justify-between items-center mb-2">
              <p className="text-[11px] font-semibold" style={{ color: D.text }}>บิลล่าสุด</p>
              <button onClick={() => navigate('/bills')} className="text-[9px] hover:underline" style={{ color: D.cyan }}>ดูทั้งหมด</button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto space-y-1"
              style={{ scrollbarWidth: 'thin', scrollbarColor: `${D.border} transparent` }}>
              {(stats?.recent_bills?.length ?? 0) === 0 ? (
                <p className="text-[10px] text-center py-4" style={{ color: D.muted }}>ยังไม่มีบิล</p>
              ) : stats.recent_bills.map((b, i) => (
                <button key={i} onClick={() => navigate('/bills')}
                  className="w-full text-left rounded-lg px-2.5 py-1.5"
                  style={{ background: D.bg }}
                  onMouseEnter={e => e.currentTarget.style.background = D.border}
                  onMouseLeave={e => e.currentTarget.style.background = D.bg}>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] font-semibold" style={{ color: D.cyan }}>{b.invoice_no}</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{
                      background: b.status === 'approved' ? '#22C55E18' : b.status === 'pending_approval' ? '#F9731618' : D.border,
                      color: b.status === 'approved' ? D.green : b.status === 'pending_approval' ? D.orange : D.muted,
                    }}>
                      {b.status === 'approved' ? 'อนุมัติ' : b.status === 'pending_approval' ? 'รออนุมัติ' : b.status}
                    </span>
                  </div>
                  <div className="flex justify-between mt-0.5">
                    <span className="text-[9px] truncate mr-2" style={{ color: D.muted }}>{b.supplier_name}</span>
                    <span className="text-[9px] flex-shrink-0" style={{ color: D.muted }}>{b.created_at?.slice(0, 10)}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const roleMap = {
    qc_staff: <QCStaffDash navigate={navigate} />,
    qc_supervisor: <SupervisorDash navigate={navigate} />,
    qc_manager: <ManagerDash navigate={navigate} />,
    qmr: <QMRDash navigate={navigate} />,
    purchasing: <PurchasingDash navigate={navigate} />,
    cco: <ExecutiveDash navigate={navigate} />,
    cmo: <ExecutiveDash navigate={navigate} />,
    cpo: <ExecutiveDash navigate={navigate} />,
    production_manager: <ProductionDash navigate={navigate} />,
    admin: <AdminDash navigate={navigate} />,
  };

  return roleMap[user?.role] || <div className="page-title">ยินดีต้อนรับ</div>;
}
