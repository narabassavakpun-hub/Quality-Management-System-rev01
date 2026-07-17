import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from 'recharts';
import SummaryCard from '../../components/UI/SummaryCard';
import HeroStat, { HeroIcons } from '../../components/UI/HeroStat';
import { useAuth } from '../../contexts/AuthContext';
import { useStats } from './shared';
import api from '../../utils/api';

// Dashboard เฉพาะ COO (แยกจาก ExecutiveDash ที่ cmo/cpo ยังใช้ร่วมกันอยู่ — cco เพิ่งได้ role เข้าถึงข้อมูล
// จัดซื้อภาพรวมจาก /purchasing/dashboard/team (เดิม managerOnly เฉพาะ purchasing_manager/admin จึงต้องเปิดเพิ่ม
// เฉพาะ cco แบบ read-only, ดู routes/purchasingDashboard.js) — เนื้อหาส่วนบน (UAI รอลงนาม) เหมือน ExecutiveDash เดิม
// เพราะ COO ยังเซ็น UAI เหมือน cmo/cpo (CLAUDE.md §11), ส่วนล่างเพิ่มสรุปงานจัดซื้อทั้งบริษัท (เหมือนที่ผู้จัดการ
// จัดซื้อเห็นใน ManagerPurchasingDash.jsx แต่เป็น read-only ไม่มีปุ่มจัดการทีม)

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

export default function COODash({ navigate }) {
  const { data: stats } = useStats();
  const { user } = useAuth();
  const myUAI = stats?.uai_my_sign || [];

  const { data: teamData, isLoading, isError } = useTeamData();
  const summary = teamData?.summary;
  const members = teamData?.members || [];

  const closedTotal = (summary?.ncr_closed || 0) + (summary?.ncp_closed || 0);
  const totalAll = (summary?.ncr_total || 0) + (summary?.ncp_total || 0);
  const activeWork = (summary?.ncr_waiting_review || 0) + (summary?.ncr_waiting_send_link || 0)
    + (summary?.ncr_waiting_supplier_response || 0) + (summary?.ncr_in_progress || 0);
  const rankedMembers = [...members].sort((a, b) => (b.overdue_count - a.overdue_count) || ((b.ncr_total + b.ncp_total) - (a.ncr_total + a.ncp_total)));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">หน้าหลัก {user?.role?.toUpperCase()}</h1>
        <p className="text-muted text-small mt-0.5">วันนี้{thaiTodayLabel()}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard value={myUAI.length} label="UAI รอลงนาม" color="danger" />
        <SummaryCard value={stats?.uai_completed_count ?? 0} label="UAI อนุมัติแล้ว" color="success" />
        <SummaryCard value={stats?.ncr_not_closed_count ?? 0} label="NCR เปิดอยู่" color="warning" />
        <SummaryCard value={stats?.total_bills ?? 0} label="รับเข้าทั้งหมด" color="primary" />
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

      <div>
        <h2 className="text-h2 font-bold text-primary mb-3">สรุปข้อมูลจัดซื้อทั้งหมด</h2>

        {isError ? (
          <div className="card text-danger text-small">โหลดข้อมูลจัดซื้อไม่สำเร็จ</div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <HeroStat icon={HeroIcons.users} value={isLoading ? '-' : summary?.team_member_count} label="ลูกทีมจัดซื้อ" tone="accent" />
              <HeroStat icon={HeroIcons.building} value={isLoading ? '-' : summary?.supplier_count} label="Supplier ทั้งหมด" tone="primary" />
              <HeroStat icon={HeroIcons.tasks} value={isLoading ? '-' : activeWork} label="งานที่ต้องดำเนินการ" tone="warning" />
              <HeroStat icon={HeroIcons.check} value={isLoading ? '-' : closedTotal} label="ปิดแล้ว" tone="success" />
              <HeroStat icon={HeroIcons.alert} value={isLoading ? '-' : summary?.overdue} label="เกินกำหนด" tone="danger" emphasize />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="card lg:col-span-2">
                <h3 className="text-h3 font-semibold text-primary mb-2">สถานะงาน NCR/NCP ทั้งบริษัท</h3>
                {isLoading ? <div className="h-[230px] flex items-center justify-center text-muted">กำลังโหลด...</div> : <BucketBarChart summary={summary} closedTotal={closedTotal} />}
              </div>
              <div className="card flex flex-col items-center justify-center">
                <h3 className="text-h3 font-semibold text-primary mb-2 self-start">อัตราปิดงานรวม</h3>
                {isLoading ? <div className="h-[160px] flex items-center justify-center text-muted">กำลังโหลด...</div> : <ClosingRateDonut closed={closedTotal} total={totalAll} />}
              </div>
            </div>

            <div className="card">
              <h3 className="text-h3 font-semibold text-primary mb-3">ทีมจัดซื้อ</h3>
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
        )}
      </div>
    </div>
  );
}
