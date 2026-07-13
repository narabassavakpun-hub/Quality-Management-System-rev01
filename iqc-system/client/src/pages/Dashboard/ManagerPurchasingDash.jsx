import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts';
import api from '../../utils/api';
import { D, DarkTip, RadialGauge, CatLabel, useCountUp } from './shared';

// Redesign (ตามคำขอ user): "รูปแบบเหมือน admin dashboard แต่มีข้อมูลครบ...แยกเป็นสัดส่วนชัดเจน" — ตัดสินใจแล้วว่า
// ปรับแค่เนื้อหาในหน้า ไม่แตะ AppLayout (คง sidebar/header เดิม, ดู AskUserQuestion ตอนเริ่มงาน) — ใช้ dark D-token
// เดียวกับ AdminDash/QCStaffDash ซึ่งเป็น pattern ที่ dashboard อื่นๆ (ยกเว้น PurchasingDash ของ purchasing ธรรมดา)
// ใช้อยู่แล้วขณะฝังอยู่ใน AppLayout ปกติ (มีแค่ role='admin' เท่านั้นที่ AppLayout bypass sidebar/header ให้)
// ข้อมูลทั้งหมดมาจาก endpoint เดิม /api/purchasing/dashboard/team — ไม่มีการแก้ backend เลยในรอบนี้

function todayLabel() {
  return new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function ManagerPurchasingDash({ navigate }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['purchasing-dashboard-team'],
    queryFn: () => api.get('/purchasing/dashboard/team').then(r => r.data),
  });
  const summary = data?.summary;
  const members = data?.members || [];

  const closedTotal = (summary?.ncr_closed || 0) + (summary?.ncp_closed || 0);
  const totalAll = (summary?.ncr_total || 0) + (summary?.ncp_total || 0);
  const activeWork = (summary?.ncr_waiting_review || 0) + (summary?.ncr_waiting_send_link || 0)
    + (summary?.ncr_waiting_supplier_response || 0) + (summary?.ncr_in_progress || 0);
  const closingRatePct = totalAll > 0 ? Math.round((closedTotal / totalAll) * 100) : 0;
  const ncrClosingPct = (summary?.ncr_total || 0) > 0 ? Math.round(((summary?.ncr_closed || 0) / summary.ncr_total) * 100) : 0;
  const ncpClosingPct = (summary?.ncp_total || 0) > 0 ? Math.round(((summary?.ncp_closed || 0) / summary.ncp_total) * 100) : 0;
  const passColor = closingRatePct >= 80 ? D.green : closingRatePct >= 50 ? D.yellow : D.orange;

  const bucketData = [
    { name: 'รอ Review', value: summary?.ncr_waiting_review || 0 },
    { name: 'รอส่ง Link', value: summary?.ncr_waiting_send_link || 0 },
    { name: 'รอ Supplier ตอบ', value: summary?.ncr_waiting_supplier_response || 0 },
    { name: 'กำลังดำเนินการ', value: summary?.ncr_in_progress || 0 },
    { name: 'ปิดแล้ว', value: closedTotal },
  ];
  const BUCKET_COLORS = [D.orange, D.yellow, '#FB923C', D.cyan, D.green];

  const rankedMembers = [...members].sort((a, b) => (b.overdue_count - a.overdue_count) || ((b.ncr_total + b.ncp_total) - (a.ncr_total + a.ncp_total)));
  const overdueMembers = members.filter(m => m.overdue_count > 0).sort((a, b) => b.overdue_count - a.overdue_count);

  const kpiN0 = useCountUp(isLoading ? 0 : (summary?.team_member_count || 0));
  const kpiN1 = useCountUp(isLoading ? 0 : (summary?.supplier_count || 0));
  const kpiN2 = useCountUp(isLoading ? 0 : activeWork);
  const kpiN3 = useCountUp(isLoading ? 0 : closedTotal);
  const kpiN4 = useCountUp(isLoading ? 0 : (summary?.overdue || 0));

  const KPI_CARDS = [
    { label: 'ลูกทีมจัดซื้อ', n: kpiN0, color: D.purple, sub: 'Active users' },
    { label: 'Supplier ทั้งหมด', n: kpiN1, color: D.cyan, sub: 'ที่ดูแลอยู่' },
    { label: 'งานที่ต้องดำเนินการ', n: kpiN2, color: D.orange, sub: 'รอ Review/ส่ง/ตอบกลับ' },
    { label: 'ปิดแล้ว', n: kpiN3, color: D.green, sub: 'NCR + NCP' },
    { label: 'เกินกำหนด', n: kpiN4, color: '#EF4444', sub: 'ต้องติดตามด่วน' },
  ];

  function memberRow(m) {
    const total = m.ncr_total + m.ncp_total;
    const pr = total > 0 ? Math.round((m.closed_count / total) * 100) : 0;
    const prColor = pr >= 80 ? D.green : pr >= 50 ? D.yellow : D.orange;
    return { ...m, total, pr, prColor };
  }

  if (isError) {
    return <div className="card text-danger text-small">โหลดข้อมูลไม่สำเร็จ</div>;
  }

  return (
    <>
      {/* ══ MOBILE (<md) — natural scroll ══ */}
      <div className="md:hidden -m-4" style={{ background: D.bg }}>
        <div className="sticky top-0 z-10 px-4 py-3" style={{ background: D.bg, borderBottom: `1px solid ${D.border}` }}>
          <div className="text-[16px] font-bold" style={{ color: D.text }}>หน้าหลัก ผู้จัดการจัดซื้อ</div>
          <div className="text-[12px]" style={{ color: D.muted }}>{todayLabel()}</div>
        </div>

        <div className="p-4 space-y-3 pb-24">
          {/* KPI 2x2 + 1 full width */}
          <div className="grid grid-cols-2 gap-2.5">
            {KPI_CARDS.slice(0, 4).map(k => (
              <div key={k.label} className="rounded-xl px-4 py-3 min-h-[88px]" style={{ background: D.card, border: `1px solid ${D.border}` }}>
                <div className="text-[32px] font-bold tabular-nums leading-none" style={{ color: k.color }}>{isLoading ? '—' : k.n}</div>
                <div className="text-[14px] font-semibold mt-2" style={{ color: D.text }}>{k.label}</div>
                <div className="text-[12px]" style={{ color: D.muted }}>{k.sub}</div>
              </div>
            ))}
          </div>
          <div className="rounded-xl px-4 py-3 flex items-center gap-4 min-h-[64px]" style={{ background: D.card, border: `1px solid ${D.border}` }}>
            <div className="text-[32px] font-bold tabular-nums" style={{ color: '#EF4444' }}>{isLoading ? '—' : kpiN4}</div>
            <div>
              <div className="text-[14px] font-semibold" style={{ color: D.text }}>เกินกำหนด</div>
              <div className="text-[12px]" style={{ color: D.muted }}>ต้องติดตามด่วน</div>
            </div>
          </div>

          {/* Gauges */}
          <div className="rounded-xl p-4" style={{ background: D.card, border: `1px solid ${D.border}` }}>
            <div className="text-[14px] font-semibold mb-2" style={{ color: D.text }}>อัตราปิดงาน</div>
            <div className="flex justify-around">
              <RadialGauge value={closedTotal} total={totalAll || 1} label="ปิดแล้วรวม" color={passColor} />
              <RadialGauge value={summary?.ncr_closed || 0} total={summary?.ncr_total || 1} label="NCR ปิดแล้ว" color={D.orange} />
              <RadialGauge value={summary?.ncp_closed || 0} total={summary?.ncp_total || 1} label="NCP ปิดแล้ว" color={D.cyan} />
            </div>
          </div>

          {/* Bucket breakdown */}
          <div className="rounded-xl p-4" style={{ background: D.card, border: `1px solid ${D.border}` }}>
            <div className="text-[14px] font-semibold mb-2" style={{ color: D.text }}>สถานะงาน NCR/NCP</div>
            <div style={{ height: 170 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={bucketData} layout="vertical" margin={{ left: 4, right: 16, top: 2, bottom: 2 }}>
                  <XAxis type="number" tick={{ fontSize: 10, fill: D.muted }} allowDecimals={false} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: D.muted }} width={92} axisLine={false} tickLine={false} />
                  <Tooltip content={<DarkTip />} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive animationDuration={1200}>
                    {bucketData.map((_, i) => <Cell key={i} fill={BUCKET_COLORS[i]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Overdue quick list */}
          {overdueMembers.length > 0 && (
            <div className="rounded-xl p-4" style={{ background: D.card, border: `1px solid #EF444455` }}>
              <div className="text-[14px] font-semibold mb-2" style={{ color: '#EF4444' }}>สมาชิกที่มีงานเกินกำหนด</div>
              <div className="space-y-2">
                {overdueMembers.map(m => (
                  <button key={m.id} onClick={() => navigate(`/purchasing/team/${m.id}`)}
                    className="w-full text-left rounded-lg px-3 py-2.5 flex items-center justify-between min-h-[48px]" style={{ background: D.bg }}>
                    <span className="text-[13px] font-medium" style={{ color: D.text }}>{m.full_name}</span>
                    <span className="text-[12px] px-2 py-0.5 rounded-full font-bold" style={{ background: '#EF444422', color: '#EF4444' }}>{m.overdue_count} เกินกำหนด</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Team ranking */}
          <div className="rounded-xl p-4" style={{ background: D.card, border: `1px solid ${D.border}` }}>
            <div className="text-[14px] font-semibold mb-3" style={{ color: D.text }}>ทีมจัดซื้อ</div>
            <div className="space-y-2.5">
              {isLoading ? (
                <p className="text-[13px] text-center py-4" style={{ color: D.muted }}>กำลังโหลด...</p>
              ) : members.length === 0 ? (
                <p className="text-[13px] text-center py-4" style={{ color: D.muted }}>ไม่พบข้อมูล</p>
              ) : rankedMembers.map(memberRow).map(m => (
                <button key={m.id} onClick={() => navigate(`/purchasing/team/${m.id}`)}
                  className="w-full text-left rounded-lg px-3 py-2.5 min-h-[64px]" style={{ background: D.bg }}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[13px] font-medium truncate mr-2" style={{ color: D.text }}>{m.full_name}</span>
                    <span className="text-[12px] font-mono font-bold flex-shrink-0" style={{ color: m.prColor }}>{m.pr}%</span>
                  </div>
                  <div className="h-1.5 rounded-full mb-1.5" style={{ background: D.border }}>
                    <div className="h-full rounded-full" style={{ width: `${m.pr}%`, background: m.prColor }} />
                  </div>
                  <div className="flex items-center justify-between text-[11px]" style={{ color: D.muted }}>
                    <span>Supplier {m.supplier_count} · NCR/NCP {m.total}</span>
                    {m.overdue_count > 0 && <span style={{ color: '#EF4444' }} className="font-semibold">เกินกำหนด {m.overdue_count}</span>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ══ DESKTOP (>=md) — fixed viewport, 3-column ══ */}
      <div className="hidden md:flex md:flex-col -m-4 overflow-hidden" style={{ height: 'calc(100vh - 64px)', background: D.bg }}>

        {/* ══ HEADER ══ */}
        <div className="flex-none flex items-center justify-between px-4 py-2" style={{ borderBottom: `1px solid ${D.border}` }}>
          <span className="text-[15px] font-bold" style={{ color: D.text }}>หน้าหลัก ผู้จัดการจัดซื้อ</span>
          <span className="text-[11px]" style={{ color: D.muted }}>{todayLabel()}</span>
        </div>

        {/* ══ KPI ROW (5 cards) ══ */}
        <div className="flex-none grid grid-cols-5 gap-2 px-4 pt-2.5">
          {KPI_CARDS.map(k => (
            <div key={k.label} className="rounded-xl px-3 py-2.5" style={{ background: D.card, border: `1px solid ${D.border}` }}>
              <div className="text-2xl font-bold tabular-nums leading-none" style={{ color: k.color }}>{isLoading ? '—' : k.n}</div>
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-[11px] font-semibold" style={{ color: D.text }}>{k.label}</span>
                <span className="text-[9px]" style={{ color: D.muted }}>{k.sub}</span>
              </div>
            </div>
          ))}
        </div>

        {/* ══ MAIN 3-COLUMN ══ */}
        <div className="flex-1 min-h-0 grid grid-cols-3 gap-2 px-4 py-2 pb-2.5">

          {/* ──── LEFT: ทีมจัดซื้อ ──── */}
          <div className="flex flex-col gap-2 min-h-0">
            <CatLabel color={D.purple} text="ทีมจัดซื้อ" />

            <div className="flex-1 min-h-0 rounded-xl p-3 flex flex-col overflow-hidden" style={{ background: D.card, border: `1px solid ${D.border}` }}>
              <div className="flex-none flex items-center justify-between mb-2">
                <p className="text-[11px] font-semibold" style={{ color: D.text }}>อันดับภาระงาน</p>
                <span className="text-[9px]" style={{ color: D.muted }}>เรียงตามเกินกำหนดมากสุด</span>
              </div>
              <div className="flex-none grid text-[9px] font-semibold uppercase tracking-wide mb-1.5 px-1"
                style={{ gridTemplateColumns: '1fr 40px 40px 56px', color: D.muted }}>
                <span>ชื่อ</span>
                <span className="text-right">Sup.</span>
                <span className="text-right">เกิน</span>
                <span className="text-right">ปิดแล้ว</span>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto space-y-1" style={{ scrollbarWidth: 'thin', scrollbarColor: `${D.border} transparent` }}>
                {isLoading ? (
                  <p className="text-[10px] py-4 text-center" style={{ color: D.muted }}>กำลังโหลด...</p>
                ) : members.length === 0 ? (
                  <p className="text-[10px] py-4 text-center" style={{ color: D.muted }}>ยังไม่มีข้อมูล</p>
                ) : rankedMembers.map(memberRow).map(m => (
                  <button key={m.id} onClick={() => navigate(`/purchasing/team/${m.id}`)}
                    className="w-full text-left rounded-lg px-2.5 py-2 transition-opacity hover:opacity-80" style={{ background: D.bg }}>
                    <div className="grid items-center gap-1 mb-1" style={{ gridTemplateColumns: '1fr 40px 40px 56px' }}>
                      <span className="text-[10px] truncate font-medium" style={{ color: D.text }}>{m.full_name}</span>
                      <span className="text-[10px] text-right font-mono" style={{ color: D.muted }}>{m.supplier_count}</span>
                      <span className="text-[10px] text-right font-mono font-bold" style={{ color: m.overdue_count > 0 ? '#EF4444' : D.muted }}>{m.overdue_count}</span>
                      <span className="text-[10px] text-right font-mono font-bold" style={{ color: m.prColor }}>{m.pr}%</span>
                    </div>
                    <div className="h-0.5 rounded-full" style={{ background: D.border }}>
                      <div className="h-full rounded-full" style={{ width: `${m.pr}%`, background: m.prColor }} />
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* NCR vs NCP total */}
            <div className="flex-none rounded-xl p-3" style={{ background: D.card, border: `1px solid ${D.border}` }}>
              <p className="text-[11px] font-semibold mb-2" style={{ color: D.text }}>NCR / NCP รวมทั้งทีม</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg p-2 text-center" style={{ background: D.bg }}>
                  <div className="text-[9px] font-semibold uppercase tracking-wide mb-1" style={{ color: D.orange }}>NCR (Major)</div>
                  <div className="text-2xl font-bold tabular-nums" style={{ color: D.orange }}>{summary?.ncr_total || 0}</div>
                  <div className="text-[9px] mt-0.5" style={{ color: D.muted }}>ปิดแล้ว {summary?.ncr_closed || 0}</div>
                </div>
                <div className="rounded-lg p-2 text-center" style={{ background: D.bg }}>
                  <div className="text-[9px] font-semibold uppercase tracking-wide mb-1" style={{ color: D.cyan }}>NCP (Minor)</div>
                  <div className="text-2xl font-bold tabular-nums" style={{ color: D.cyan }}>{summary?.ncp_total || 0}</div>
                  <div className="text-[9px] mt-0.5" style={{ color: D.muted }}>ปิดแล้ว {summary?.ncp_closed || 0}</div>
                </div>
              </div>
            </div>
          </div>

          {/* ──── CENTER: สถานะงาน ──── */}
          <div className="flex flex-col gap-2 min-h-0">
            <CatLabel color={D.cyan} text="สถานะงาน NCR/NCP" />

            <div className="flex-[2] min-h-0 rounded-xl p-3 flex flex-col" style={{ background: D.card, border: `1px solid ${D.border}` }}>
              <p className="flex-none text-[11px] font-semibold mb-1" style={{ color: D.text }}>Pipeline ทั้งทีม</p>
              <div className="flex-1 min-h-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={bucketData} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={D.border} horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10, fill: D.muted }} allowDecimals={false} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: D.muted }} width={100} axisLine={false} tickLine={false} />
                    <Tooltip content={<DarkTip />} />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive animationDuration={1200}>
                      {bucketData.map((_, i) => <Cell key={i} fill={BUCKET_COLORS[i]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Overdue alert */}
            <div className="flex-1 min-h-0 rounded-xl p-3 flex flex-col" style={{ background: D.card, border: `1px solid #EF444455` }}>
              <p className="flex-none text-[11px] font-semibold mb-1" style={{ color: '#EF4444' }}>งานเกินกำหนด — ต้องติดตามด่วน</p>
              <div className="flex-1 min-h-0 flex items-center gap-4">
                <div className="text-4xl font-bold tabular-nums flex-shrink-0" style={{ color: '#EF4444' }}>{isLoading ? '—' : kpiN4}</div>
                <div className="flex-1 min-h-0 overflow-y-auto space-y-1" style={{ scrollbarWidth: 'thin', scrollbarColor: `${D.border} transparent` }}>
                  {overdueMembers.length === 0 ? (
                    <p className="text-[10px]" style={{ color: D.muted }}>ไม่มีงานเกินกำหนด</p>
                  ) : overdueMembers.map(m => (
                    <button key={m.id} onClick={() => navigate(`/purchasing/team/${m.id}`)}
                      className="w-full text-left flex items-center justify-between rounded px-1.5 py-1 transition-opacity hover:opacity-80">
                      <span className="text-[10px] truncate" style={{ color: D.text }}>{m.full_name}</span>
                      <span className="text-[10px] font-bold flex-shrink-0" style={{ color: '#EF4444' }}>{m.overdue_count}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ──── RIGHT: ภาพรวมระบบ ──── */}
          <div className="flex flex-col gap-2 min-h-0">
            <CatLabel color={D.green} text="ภาพรวมระบบ" />

            <div className="flex-none rounded-xl p-3" style={{ background: D.card, border: `1px solid ${D.border}` }}>
              <p className="text-[11px] font-semibold mb-1" style={{ color: D.text }}>อัตราปิดงาน</p>
              <div className="flex justify-around">
                <RadialGauge value={closedTotal} total={totalAll || 1} label="ปิดแล้วรวม" color={passColor} />
                <RadialGauge value={summary?.ncr_closed || 0} total={summary?.ncr_total || 1} label="NCR ปิดแล้ว" color={D.orange} />
                <RadialGauge value={summary?.ncp_closed || 0} total={summary?.ncp_total || 1} label="NCP ปิดแล้ว" color={D.cyan} />
              </div>
            </div>

            <div className="flex-none rounded-xl p-3" style={{ background: D.card, border: `1px solid ${D.border}` }}>
              <p className="text-[11px] font-semibold mb-2" style={{ color: D.text }}>ข้อมูลสรุป</p>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { label: 'ลูกทีม', value: summary?.team_member_count, color: D.purple },
                  { label: 'Supplier', value: summary?.supplier_count, color: D.cyan },
                  { label: 'NCP เปิด', value: summary?.ncp_open, color: D.yellow },
                ].map(m => (
                  <div key={m.label} className="rounded-lg py-2 flex flex-col items-center" style={{ background: D.bg }}>
                    <span className="text-lg font-bold tabular-nums" style={{ color: m.color }}>{isLoading ? '—' : (m.value ?? 0)}</span>
                    <span className="text-[9px] mt-0.5" style={{ color: D.muted }}>{m.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Team quick list */}
            <div className="flex-1 min-h-0 rounded-xl p-3 flex flex-col overflow-hidden" style={{ background: D.card, border: `1px solid ${D.border}` }}>
              <div className="flex-none flex justify-between items-center mb-2">
                <p className="text-[11px] font-semibold" style={{ color: D.text }}>ทีมจัดซื้อ</p>
                <span className="text-[9px]" style={{ color: D.muted }}>{members.length} คน</span>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto space-y-1" style={{ scrollbarWidth: 'thin', scrollbarColor: `${D.border} transparent` }}>
                {members.length === 0 ? (
                  <p className="text-[10px] text-center py-4" style={{ color: D.muted }}>ยังไม่มีข้อมูล</p>
                ) : members.map(m => (
                  <button key={m.id} onClick={() => navigate(`/purchasing/team/${m.id}`)}
                    className="w-full text-left rounded-lg px-2.5 py-1.5 flex items-center justify-between" style={{ background: D.bg }}
                    onMouseEnter={e => e.currentTarget.style.background = D.border}
                    onMouseLeave={e => e.currentTarget.style.background = D.bg}>
                    <span className="text-[10px] truncate mr-2" style={{ color: D.text }}>{m.full_name}</span>
                    <span className="text-[9px] flex-shrink-0" style={{ color: D.muted }}>{m.supplier_count} Supplier</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
