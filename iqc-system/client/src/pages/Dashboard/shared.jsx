import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../utils/api';
import { ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

// เดิม useStats() ดึง 4 endpoint x limit=500 (bills/ncr/uai) แล้วคำนวณ count/filter ฝั่ง client
// ย้ายไป server-side aggregate เดียว /api/dashboard/stats (AUDIT.md §8 P1) — ตัวเลขคำนวณจาก SQL ตรงกับของเดิมทุกตัว
export function useStats() {
  return useQuery({ queryKey: ['dashboard-stats'], queryFn: () => api.get('/dashboard/stats').then(r => r.data) });
}

/* ─── Dark palette for QC Staff / Admin dashboards ─── */
export const D = {
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

export const DarkTip = ({ active, payload, label }) => {
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

/* ─── count-up animation ─── */
export function useCountUp(target, duration = 1100) {
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

export function RadialGauge({ value, total, label, color }) {
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

export function CatLabel({ color, text }) {
  return (
    <div className="flex-none flex items-center gap-2 mb-1">
      <div className="w-1 h-4 rounded-full" style={{ background: color }} />
      <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: D.muted }}>{text}</span>
    </div>
  );
}
