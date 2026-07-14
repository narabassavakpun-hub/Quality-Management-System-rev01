import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import api from '../../utils/api';
import { T, DarkTip } from './shared';

// แผงกราฟแนวโน้มบิลรับเข้า + จัดอันดับผู้ผลิตที่รับเข้ามากสุด (เพิ่ม Session 127 ตามคำขอ user แทนที่ "บิลรายวัน 7
// วัน"/"รับเข้า / ไม่ผ่าน 7 วัน" เดิมที่ fix ตายตัวเป็น 7 วัน) — แชร์ filter เดียวกัน (granularity + compare) ทั้ง 2
// ครึ่ง เพราะทั้งคู่มองข้อมูล "รับเข้า" ช่วงเวลาเดียวกันเสมอ ไม่ใช้ 2 dropdown แยกกันเพื่อกันสับสนว่าครึ่งบนกับล่างมอง
// คนละช่วงเวลา — ยิง 2 endpoint แยก (/dashboard/bills-trend, /dashboard/bills-by-supplier) เพราะ backend คำนวณ
// period (current/comparison) ด้วย logic เดียวกัน (computePeriod) แต่ query คนละมิติ (time-bucket vs group-by-supplier)
// ranking metric = "จำนวนบิลที่รับเข้า" (นับบิล ไม่ใช่ qty) ตามที่ user ยืนยัน — ตรงกับธีมเดิมของ "บิลรายวัน" อยู่แล้ว
// ใช้ theme token T (light/dark) แทน D ตายตัวเดิม (ดูคอมเมนต์ตัว T ใน shared.jsx)
const GRANULARITY_LABEL = { day: 'รายวัน', month: 'รายเดือน', year: 'รายปี' };

function compareLabels(granularity, compare) {
  if (compare === 'mom') return { current: 'เดือนนี้', comparison: 'เดือนก่อน' };
  if (compare === 'yoy') return granularity === 'month'
    ? { current: 'ปีนี้', comparison: 'ปีก่อน' }
    : { current: 'เดือนนี้', comparison: 'เดือนเดียวกันปีก่อน' };
  return { current: 'จำนวนบิล', comparison: null };
}

export default function BillsTrendPanel({ navigate }) {
  const [granularity, setGranularity] = useState('day');
  const [compare, setCompare] = useState('none');

  function handleGranularityChange(g) {
    setGranularity(g);
    if (g === 'year') setCompare('none');
    else if (g === 'month' && compare === 'mom') setCompare('none');
  }

  const { data: trend, isLoading: trendLoading } = useQuery({
    queryKey: ['dashboard-bills-trend', granularity, compare],
    queryFn: () => api.get('/dashboard/bills-trend', { params: { granularity, compare } }).then(r => r.data),
  });
  const { data: bySupplier, isLoading: rankLoading } = useQuery({
    queryKey: ['dashboard-bills-by-supplier', granularity, compare],
    queryFn: () => api.get('/dashboard/bills-by-supplier', { params: { granularity, compare, limit: 8 } }).then(r => r.data),
  });

  const hasCompare = trend?.compare && trend.compare !== 'none';
  const labels = compareLabels(granularity, trend?.compare || 'none');
  const chartData = (trend?.current || []).map((c, i) => ({
    label: c.label,
    current: c.value,
    comparison: hasCompare ? (trend.comparison?.[i]?.value ?? 0) : undefined,
  }));

  const ranking = bySupplier?.ranking || [];
  const rankHasCompare = bySupplier?.compare && bySupplier.compare !== 'none';
  const maxRank = Math.max(1, ...ranking.flatMap(r => [r.current, rankHasCompare ? (r.comparison || 0) : 0]));

  return (
    <>
      {/* Filter bar — ใช้ร่วมกันทั้งกราฟแนวโน้มและหลอดจัดอันดับด้านล่าง */}
      <div className="flex-none flex items-center gap-2 mb-1">
        <select
          value={granularity}
          onChange={e => handleGranularityChange(e.target.value)}
          className="text-small rounded-md px-2.5 py-1.5 min-h-[32px]"
          style={{ background: T.surface, border: `1px solid ${T.border}`, color: T.text }}
        >
          {Object.entries(GRANULARITY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select
          value={compare}
          onChange={e => setCompare(e.target.value)}
          disabled={granularity === 'year'}
          className="text-small rounded-md px-2.5 py-1.5 min-h-[32px] disabled:opacity-40"
          style={{ background: T.surface, border: `1px solid ${T.border}`, color: T.text }}
        >
          <option value="none">ไม่เปรียบเทียบ</option>
          {granularity === 'day' && <option value="mom">เทียบเดือนก่อน (MoM)</option>}
          {granularity !== 'year' && <option value="yoy">เทียบปีก่อน (YoY)</option>}
        </select>
      </div>

      {/* ครึ่งบน: กราฟแนวโน้ม — flex-1 */}
      <div className="flex-1 min-h-[280px] rounded-xl p-4 flex flex-col"
        style={{ background: T.surface, border: `1px solid ${T.border}` }}>
        <div className="flex-none flex items-center justify-between mb-2">
          <p className="text-h3 font-semibold" style={{ color: T.text }}>บิลรับเข้า ({GRANULARITY_LABEL[granularity]})</p>
          {hasCompare && (
            <div className="flex gap-3">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-sm" style={{ background: T.accent }} />
                <span className="text-small" style={{ color: T.muted }}>{labels.current}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-sm" style={{ background: T.orange }} />
                <span className="text-small" style={{ color: T.muted }}>{labels.comparison}</span>
              </div>
            </div>
          )}
        </div>
        <div className="flex-1 min-h-0">
          {trendLoading ? (
            <p className="text-small text-center py-4" style={{ color: T.muted }}>กำลังโหลด...</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 2, right: 4, left: -20, bottom: 0 }} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke={T.border} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: T.muted }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11, fill: T.muted }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<DarkTip />} />
                <Bar dataKey="current" name={labels.current} fill={T.accent} radius={[2, 2, 0, 0]} isAnimationActive />
                {hasCompare && <Bar dataKey="comparison" name={labels.comparison} fill={T.orange} radius={[2, 2, 0, 0]} isAnimationActive />}
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ครึ่งล่าง: จัดอันดับผู้ผลิตที่รับเข้ามากสุด — flex-1 */}
      <div className="flex-1 min-h-[280px] rounded-xl p-4 flex flex-col overflow-hidden"
        style={{ background: T.surface, border: `1px solid ${T.border}` }}>
        <div className="flex-none flex items-center justify-between mb-3">
          <p className="text-h3 font-semibold" style={{ color: T.text }}>ผู้ผลิตที่รับเข้ามากสุด</p>
          <button onClick={() => navigate?.('/bills')} className="text-small hover:underline" style={{ color: T.accent }}>ดูทั้งหมด</button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto space-y-3"
          style={{ scrollbarWidth: 'thin', scrollbarColor: `${T.border} transparent` }}>
          {rankLoading ? (
            <p className="text-small text-center py-4" style={{ color: T.muted }}>กำลังโหลด...</p>
          ) : ranking.length === 0 ? (
            <p className="text-small text-center py-4" style={{ color: T.muted }}>ยังไม่มีข้อมูล</p>
          ) : ranking.map(r => (
            <div key={r.supplier_name}>
              <div className="flex justify-between mb-1">
                <span className="text-body truncate mr-2" style={{ color: T.text }}>{r.supplier_name}</span>
                <span className="text-body font-mono font-bold flex-shrink-0" style={{ color: T.accent }}>
                  {r.current}{rankHasCompare ? ` / ${r.comparison}` : ''}
                </span>
              </div>
              <div className="h-2 rounded-full" style={{ background: T.border }}>
                <div className="h-full rounded-full" style={{ width: `${(r.current / maxRank) * 100}%`, background: T.accent, transition: 'width 1s ease-out' }} />
              </div>
              {rankHasCompare && (
                <div className="h-2 rounded-full mt-1" style={{ background: T.border }}>
                  <div className="h-full rounded-full" style={{ width: `${(r.comparison / maxRank) * 100}%`, background: T.orange, transition: 'width 1s ease-out' }} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
