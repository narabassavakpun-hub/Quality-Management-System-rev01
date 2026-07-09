import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import { useNotifications } from '../../hooks/useNotifications';
import api from '../../utils/api';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area, CartesianGrid } from 'recharts';
import Sidebar from '../../components/Layout/Sidebar';
import { D, DarkTip, RadialGauge, CatLabel, useCountUp } from './shared';

export default function AdminDash({ navigate }) {
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

  const [sidebarOpen, setSidebarOpen] = useState(false);

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
    <>
    {/* ══ MOBILE (<md) — natural scroll ══ */}
    <div className="md:hidden -m-4 pb-24" style={{ background: D.bg }}>

      {/* Mobile Header */}
      <div className="sticky top-0 z-10 flex items-center gap-2 px-4 py-3"
        style={{ background: D.bg, borderBottom: `1px solid ${D.border}` }}>
        <button onClick={() => setSidebarOpen(p => !p)}
          className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-lg"
          style={{ background: D.border, color: D.muted }}>
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-[16px] font-bold leading-tight" style={{ color: D.text }}>IQC Dashboard</div>
          <div className="text-[12px]" style={{ color: D.muted }}>{todayStr}</div>
        </div>
        <span className="flex-shrink-0 text-[11px] px-2.5 py-1 rounded-full font-semibold"
          style={{ background: D.border, color: D.purple }}>Admin</span>
        <div className="relative flex-shrink-0" ref={bellRef}>
          <button onClick={() => setBellOpen(p => !p)}
            className="relative w-11 h-11 flex items-center justify-center rounded-xl"
            style={{ background: bellOpen ? D.border : 'transparent' }}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: D.muted }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-0.5">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>
          {bellOpen && (
            <div className="absolute right-0 top-full mt-1 w-72 rounded-xl shadow-2xl z-50 overflow-hidden"
              style={{ background: D.card, border: `1px solid ${D.border}` }}>
              <div className="flex items-center justify-between px-3 py-2.5" style={{ borderBottom: `1px solid ${D.border}` }}>
                <span className="text-[13px] font-semibold" style={{ color: D.text }}>การแจ้งเตือน</span>
                {unreadCount > 0 && (
                  <button onClick={() => markAllRead.mutate()} className="text-[11px]" style={{ color: D.cyan }}>อ่านทั้งหมด</button>
                )}
              </div>
              <div className="max-h-64 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                {notifications.length === 0 && (
                  <div className="px-4 py-5 text-center text-[12px]" style={{ color: D.muted }}>ไม่มีการแจ้งเตือน</div>
                )}
                {notifications.slice(0, 20).map(n => (
                  <button key={n.id}
                    onClick={() => { markRead.mutate(n.id); setBellOpen(false); navigate(n.link); }}
                    className="w-full text-left px-3 py-2.5"
                    style={{ background: n.is_read ? 'transparent' : '#38BDF808', borderBottom: `1px solid ${D.border}` }}>
                    <div className="flex items-start gap-2">
                      {!n.is_read && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5" style={{ background: D.cyan }} />}
                      <div className={n.is_read ? 'pl-3.5' : ''}>
                        <div className="text-[13px] font-medium" style={{ color: D.text }}>{n.title}</div>
                        <div className="text-[12px] mt-0.5" style={{ color: D.muted }}>{n.message}</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="p-4 space-y-3">

        {/* KPI 2×2 */}
        <div className="grid grid-cols-2 gap-2.5">
          {[
            { label: 'บิลวันนี้',     n: kpiN0, suffix: '',  color: D.cyan,   sub: 'รับเข้าวันนี้',   path: '/bills' },
            { label: 'บิลเดือนนี้',   n: kpiN1, suffix: '',  color: D.green,  sub: 'เดือนปัจจุบัน',   path: '/bills' },
            { label: 'NCR เปิดอยู่',  n: kpiN2, suffix: '',  color: D.orange, sub: 'ยังไม่ปิด',        path: '/ncr'   },
            { label: 'อัตราผ่านตรวจ', n: kpiN3, suffix: '%', color: passColor,sub: 'ไม่มี NCR',         path: '/bills' },
          ].map(k => (
            <button key={k.label} onClick={() => navigate(k.path)}
              className="rounded-xl px-4 py-3 text-left min-h-[88px]"
              style={{ background: D.card, border: `1px solid ${D.border}` }}>
              <div className="text-[32px] font-bold tabular-nums leading-none" style={{ color: k.color }}>
                {isLoading ? '—' : `${k.n}${k.suffix}`}
              </div>
              <div className="text-[14px] font-semibold mt-2" style={{ color: D.text }}>{k.label}</div>
              <div className="text-[12px]" style={{ color: D.muted }}>{k.sub}</div>
            </button>
          ))}
        </div>
        {/* ผู้ใช้งาน — full width */}
        <button onClick={() => navigate('/admin/users')}
          className="w-full rounded-xl px-4 py-3 text-left flex items-center gap-4 min-h-[64px]"
          style={{ background: D.card, border: `1px solid ${D.border}` }}>
          <div className="text-[32px] font-bold tabular-nums" style={{ color: D.purple }}>
            {isLoading ? '—' : kpiN4}
          </div>
          <div>
            <div className="text-[14px] font-semibold" style={{ color: D.text }}>ผู้ใช้งาน</div>
            <div className="text-[12px]" style={{ color: D.muted }}>Active users</div>
          </div>
        </button>

        {/* Admin Quick Actions */}
        <div className="rounded-xl p-4" style={{ background: D.card, border: `1px solid ${D.border}` }}>
          <div className="text-[14px] font-semibold mb-3" style={{ color: D.text }}>จัดการระบบ</div>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'ผู้ใช้งาน',   sub: 'จัดการ Account',  path: '/admin/users',    color: D.purple },
              { label: 'ตั้งค่าระบบ', sub: 'Telegram, โลโก้', path: '/admin/settings', color: D.cyan   },
              { label: 'วันหยุด',     sub: 'ปฏิทินวันหยุด',   path: '/admin/holidays', color: D.yellow },
              { label: 'Export Excel',sub: 'Power BI',          href: '/api/powerbi',    color: D.green  },
            ].map(item => (
              <button key={item.label}
                onClick={() => item.href ? (window.location.href = item.href) : navigate(item.path)}
                className="rounded-xl p-3 text-left min-h-[72px]"
                style={{ background: D.bg }}>
                <div className="text-[15px] font-semibold" style={{ color: item.color }}>{item.label}</div>
                <div className="text-[12px] mt-0.5" style={{ color: D.muted }}>{item.sub}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Master Data */}
        <div className="rounded-xl p-4" style={{ background: D.card, border: `1px solid ${D.border}` }}>
          <div className="text-[14px] font-semibold mb-3" style={{ color: D.text }}>ข้อมูลหลัก (Master)</div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Supplier', value: stats?.suppliers, path: '/master/suppliers', color: D.cyan   },
              { label: 'สินค้า',   value: stats?.products,  path: '/master/products',  color: D.green  },
              { label: 'ผู้ใช้',   value: stats?.users,     path: '/admin/users',      color: D.purple },
            ].map(m => (
              <button key={m.label} onClick={() => navigate(m.path)}
                className="rounded-xl py-3 flex flex-col items-center justify-center gap-1 min-h-[72px]"
                style={{ background: D.bg }}>
                <span className="text-[24px] font-bold" style={{ color: m.color }}>
                  {isLoading ? '—' : (m.value ?? 0)}
                </span>
                <span className="text-[12px]" style={{ color: D.muted }}>{m.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* NCR Summary */}
        <div className="rounded-xl p-4" style={{ background: D.card, border: `1px solid ${D.border}` }}>
          <div className="flex items-center justify-between mb-3">
            <div className="text-[14px] font-semibold" style={{ color: D.text }}>NCR แยกระดับ</div>
            <button onClick={() => navigate('/ncr')} className="text-[13px]" style={{ color: D.cyan }}>ดูทั้งหมด</button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'NCR Major', count: majorNCR, color: '#EF4444', sub: 'ร้ายแรง' },
              { label: 'NCP Minor', count: minorNCR, color: D.cyan,    sub: 'เล็กน้อย' },
            ].map(item => (
              <div key={item.label} className="rounded-lg p-3" style={{ background: D.bg }}>
                <div className="text-[12px] font-semibold mb-1" style={{ color: item.color }}>{item.label}</div>
                <div className="text-[28px] font-bold" style={{ color: item.color }}>{item.count}</div>
                <div className="text-[12px] mt-0.5" style={{ color: D.muted }}>{item.sub}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Supplier Quality */}
        {(stats?.supplier_quality?.length ?? 0) > 0 && (
          <div className="rounded-xl p-4" style={{ background: D.card, border: `1px solid ${D.border}` }}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-[14px] font-semibold" style={{ color: D.text }}>คุณภาพ Supplier</div>
              <span className="text-[12px]" style={{ color: D.muted }}>เรียงตาม NCR มากสุด</span>
            </div>
            <div className="space-y-2.5">
              {stats.supplier_quality.slice(0, 5).map((s, i) => {
                const pr = s.pass_rate ?? 100;
                const prColor = pr >= 90 ? D.green : pr >= 75 ? D.yellow : D.orange;
                return (
                  <div key={i}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[14px] font-medium truncate mr-2" style={{ color: D.text }}>{s.supplier_name}</span>
                      <span className="flex-shrink-0 text-[13px] font-bold font-mono" style={{ color: prColor }}>{pr.toFixed(1)}%</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full" style={{ background: D.border }}>
                        <div className="h-full rounded-full" style={{ width: `${Math.max(pr, 0)}%`, background: prColor }} />
                      </div>
                      <span className="flex-shrink-0 text-[12px] font-mono" style={{ color: s.ncr_count > 0 ? D.orange : D.muted }}>
                        NCR:{s.ncr_count}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Recent Bills */}
        <div className="rounded-xl p-4" style={{ background: D.card, border: `1px solid ${D.border}` }}>
          <div className="flex items-center justify-between mb-3">
            <div className="text-[14px] font-semibold" style={{ color: D.text }}>บิลล่าสุด</div>
            <button onClick={() => navigate('/bills')} className="text-[13px]" style={{ color: D.cyan }}>ดูทั้งหมด</button>
          </div>
          <div className="space-y-2">
            {(stats?.recent_bills?.length ?? 0) === 0 ? (
              <p className="text-[13px] text-center py-4" style={{ color: D.muted }}>ยังไม่มีบิล</p>
            ) : stats.recent_bills.slice(0, 5).map((b, i) => (
              <button key={i} onClick={() => navigate('/bills')}
                className="w-full text-left rounded-lg px-3 py-3 min-h-[56px]"
                style={{ background: D.bg }}>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[14px] font-semibold" style={{ color: D.cyan }}>{b.invoice_no}</span>
                  <span className="text-[12px] px-2 py-0.5 rounded-full" style={{
                    background: b.status === 'approved' ? '#22C55E18' : '#F9731618',
                    color: b.status === 'approved' ? D.green : D.orange,
                  }}>
                    {b.status === 'approved' ? 'อนุมัติ' : 'รออนุมัติ'}
                  </span>
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-[13px] truncate mr-2" style={{ color: D.muted }}>{b.supplier_name}</span>
                  <span className="text-[12px] flex-shrink-0" style={{ color: D.muted }}>{b.created_at?.slice(0, 10)}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

      </div>
    </div>

    {/* ══ DESKTOP (>=md) — fixed viewport ══ */}
    <div className="hidden md:flex flex-col overflow-hidden" style={{ height: '100vh', background: D.bg }}>

      {/* ══ HEADER ══ */}
      <div className="flex-none flex items-center justify-between px-4 py-2"
        style={{ borderBottom: `1px solid ${D.border}` }}>
        <div className="flex items-center gap-3">
          {/* Hamburger — เปิด Sidebar */}
          <button
            onClick={() => setSidebarOpen(p => !p)}
            className="w-8 h-8 flex items-center justify-center rounded-lg transition-all hover:opacity-80"
            style={{ background: sidebarOpen ? D.purple + '33' : D.border, color: sidebarOpen ? D.purple : D.muted }}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
            </svg>
          </button>
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

    {/* Sidebar overlay — flex layout: sidebar + backdrop(flex-1) */}
    <div
      className={`fixed inset-0 z-50 flex transition-opacity duration-200 ${
        sidebarOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}
    >
      <div className={`flex-shrink-0 h-full transform transition-transform duration-200 ${
        sidebarOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        <Sidebar collapsed={false} onToggle={() => setSidebarOpen(false)} />
      </div>
      {/* คลิกที่นอก sidebar → ปิด */}
      <div className="flex-1 h-full bg-black/50" onClick={() => setSidebarOpen(false)} />
    </div>
    </>
  );
}
