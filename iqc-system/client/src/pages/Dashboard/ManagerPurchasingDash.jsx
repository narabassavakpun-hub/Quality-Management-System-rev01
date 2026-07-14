import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from 'recharts';
import HeroStat, { HeroIcons } from '../../components/UI/HeroStat';
import api from '../../utils/api';

// Redesign รอบ 2 (ตามคำขอ user): "ปรับ layout ใหม่, ปรับขนาดตัวอักษรให้อ่านง่ายเห็นชัด, มีโหมดกลางวัน/กลางคืน" —
// รอบแรกใช้ dark `D` token (hardcode สีตายตัว) เหมือน AdminDash ซึ่งไม่มีโหมดกลางวันและตัวอักษรเล็ก (9-11px)
// ตามสไตล์ operational dashboard หนาแน่น รอบนี้เปลี่ยนมาใช้ semantic theme token ของระบบ (bg-surface/text-text/
// text-muted/.card/.table ฯลฯ) แบบเดียวกับ PurchasingDash.jsx (ของ purchasing ธรรมดา) แทน — token เหล่านี้ผูกกับ
// ThemeContext อยู่แล้วโดยอัตโนมัติ (CLAUDE.md §25) ได้ทั้งโหมดกลางวัน/กลางคืน/auto โดยไม่ต้องเขียน logic เพิ่ม
// และใช้ font size มาตรฐานของระบบ (text-h1/h2/h3/body/small) แทนตัวเลข px เล็กๆ เดิม — เลย์เอาต์เปลี่ยนจาก fixed
// 100vh หนาแน่นแบบ AdminDash เป็นหน้าปกติ scroll ได้ตามธรรมชาติเหมือนหน้าอื่นในระบบ
// ข้อมูลยังมาจาก endpoint เดิม /api/purchasing/dashboard/team — ไม่มีการแก้ backend เลย

const THAI_DAYS = ['วันอาทิตย์', 'วันจันทร์', 'วันอังคาร', 'วันพุธ', 'วันพฤหัสบดี', 'วันศุกร์', 'วันเสาร์'];
const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
function thaiTodayLabel() {
  const d = new Date();
  return `${THAI_DAYS[d.getDay()]}ที่ ${d.getDate()} ${THAI_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`;
}

function useTeamData() {
  return useQuery({
    queryKey: ['purchasing-dashboard-team'],
    queryFn: () => api.get('/purchasing/dashboard/team').then(r => r.data),
  });
}

// ใช้ rgb(var(--color-x)) แทน hex ตายตัว — ค่าจริงจะสลับเองตาม .dark class บน <html> (เหมือน ClosingRateDonut
// ของ PurchasingDash.jsx ที่ทำไว้อยู่แล้ว) ไม่ต้องเขียน logic สลับสีเอง
const BUCKET_COLORS = [
  'rgb(var(--color-warning))',
  'rgb(var(--color-warning))',
  'rgb(var(--color-warning))',
  'rgb(var(--color-accent))',
  'rgb(var(--color-success))',
];
const BUCKET_OPACITY = [1, 0.75, 0.55, 1, 1];

function BucketBarChart({ summary, closedTotal }) {
  const data = [
    { name: 'รอ Review', value: summary?.ncr_waiting_review || 0 },
    { name: 'รอส่ง Link', value: summary?.ncr_waiting_send_link || 0 },
    { name: 'รอ Supplier ตอบ', value: summary?.ncr_waiting_supplier_response || 0 },
    { name: 'กำลังดำเนินการ', value: summary?.ncr_in_progress || 0 },
    { name: 'ปิดแล้ว', value: closedTotal },
  ];
  return (
    <ResponsiveContainer width="100%" height={230}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
        <XAxis type="number" tick={{ fontSize: 13 }} allowDecimals={false} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 13 }} width={120} />
        <Tooltip />
        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
          {data.map((d, i) => <Cell key={i} fill={BUCKET_COLORS[i]} fillOpacity={BUCKET_OPACITY[i]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function ClosingRateDonut({ closed, total }) {
  const pct = total > 0 ? Math.round((closed / total) * 100) : 0;
  const data = [{ name: 'ปิดแล้ว', value: closed }, { name: 'ค้าง', value: Math.max(total - closed, 0) }];
  return (
    <div className="relative w-[160px] h-[160px]">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" cx="50%" cy="50%" innerRadius={50} outerRadius={72} startAngle={90} endAngle={-270} stroke="none" isAnimationActive>
            <Cell fill="rgb(var(--color-success))" />
            <Cell fill="rgb(var(--color-border))" />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-h1 font-bold text-success">{pct}%</span>
        <span className="text-[11px] text-muted">ปิดแล้ว ({closed}/{total})</span>
      </div>
    </div>
  );
}

export default function ManagerPurchasingDash({ navigate }) {
  const { data, isLoading, isError } = useTeamData();
  const summary = data?.summary;
  const members = data?.members || [];

  const closedTotal = (summary?.ncr_closed || 0) + (summary?.ncp_closed || 0);
  const totalAll = (summary?.ncr_total || 0) + (summary?.ncp_total || 0);
  const activeWork = (summary?.ncr_waiting_review || 0) + (summary?.ncr_waiting_send_link || 0)
    + (summary?.ncr_waiting_supplier_response || 0) + (summary?.ncr_in_progress || 0);

  const rankedMembers = [...members].sort((a, b) => (b.overdue_count - a.overdue_count) || ((b.ncr_total + b.ncp_total) - (a.ncr_total + a.ncp_total)));
  const overdueMembers = members.filter(m => m.overdue_count > 0).sort((a, b) => b.overdue_count - a.overdue_count);

  if (isError) {
    return <div className="card text-danger text-small">โหลดข้อมูลไม่สำเร็จ</div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">หน้าหลัก ผู้จัดการจัดซื้อ</h1>
        <p className="text-muted text-small mt-0.5">วันนี้{thaiTodayLabel()}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <HeroStat icon={HeroIcons.users} value={isLoading ? '-' : summary?.team_member_count} label="ลูกทีมจัดซื้อ" tone="accent" />
        <HeroStat icon={HeroIcons.building} value={isLoading ? '-' : summary?.supplier_count} label="Supplier ทั้งหมด" tone="primary" />
        <HeroStat icon={HeroIcons.tasks} value={isLoading ? '-' : activeWork} label="งานที่ต้องดำเนินการ" tone="warning" />
        <HeroStat icon={HeroIcons.check} value={isLoading ? '-' : closedTotal} label="ปิดแล้ว" tone="success" />
        <HeroStat icon={HeroIcons.alert} value={isLoading ? '-' : summary?.overdue} label="เกินกำหนด" tone="danger" emphasize />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card lg:col-span-2">
          <h2 className="text-h3 font-semibold text-primary mb-2">สถานะงาน NCR/NCP ทั้งทีม</h2>
          {isLoading ? <div className="h-[230px] flex items-center justify-center text-muted">กำลังโหลด...</div> : <BucketBarChart summary={summary} closedTotal={closedTotal} />}
        </div>
        <div className="card flex flex-col items-center justify-center">
          <h2 className="text-h3 font-semibold text-primary mb-2 self-start">อัตราปิดงานรวม</h2>
          {isLoading ? <div className="h-[160px] flex items-center justify-center text-muted">กำลังโหลด...</div> : <ClosingRateDonut closed={closedTotal} total={totalAll} />}
        </div>
      </div>

      {overdueMembers.length > 0 && (
        <div className="card ring-2 ring-danger/30">
          <h2 className="text-h3 font-semibold text-danger mb-3">งานเกินกำหนด — ต้องติดตามด่วน</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {overdueMembers.map(m => (
              <button key={m.id} onClick={() => navigate(`/purchasing/team/${m.id}`)}
                className="flex items-center justify-between gap-2 px-4 py-3 rounded-lg bg-red-50 dark:bg-red-900 hover:opacity-90 transition-opacity min-h-[52px] text-left">
                <span className="text-body font-medium text-text truncate">{m.full_name}</span>
                <span className="badge bg-red-100 dark:bg-red-800 text-red-700 dark:text-red-200 font-semibold flex-shrink-0">{m.overdue_count} เกินกำหนด</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h2 className="text-h3 font-semibold text-primary mb-3">ทีมจัดซื้อ</h2>
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>ชื่อพนักงาน</th>
                <th>Supplier</th>
                <th>NCR</th>
                <th>NCP</th>
                <th>รอ Review</th>
                <th>รอส่ง Link</th>
                <th>รอ Supplier ตอบกลับ</th>
                <th>กำลังดำเนินการ</th>
                <th>ปิดแล้ว</th>
                <th>เกินกำหนด</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={10} className="text-center py-6 text-muted">กำลังโหลด...</td></tr>}
              {!isLoading && members.length === 0 && <tr><td colSpan={10} className="text-center py-8 text-muted">ไม่พบข้อมูล</td></tr>}
              {rankedMembers.map(m => (
                <tr key={m.id} className="cursor-pointer" onClick={() => navigate(`/purchasing/team/${m.id}`)}>
                  <td className="font-medium text-text">{m.full_name}</td>
                  <td>{m.supplier_count}</td>
                  <td>{m.ncr_total}</td>
                  <td>{m.ncp_total}</td>
                  <td>{m.waiting_review_count}</td>
                  <td>{m.waiting_send_link_count}</td>
                  <td>{m.waiting_supplier_response_count}</td>
                  <td>{m.in_progress_count}</td>
                  <td>{m.closed_count}</td>
                  <td className={m.overdue_count > 0 ? 'text-danger font-semibold' : ''}>{m.overdue_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
