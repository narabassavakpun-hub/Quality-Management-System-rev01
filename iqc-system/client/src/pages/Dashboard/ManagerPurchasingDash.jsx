import { useQuery } from '@tanstack/react-query';
import HeroStat, { HeroIcons } from '../../components/UI/HeroStat';
import SummaryCard from '../../components/UI/SummaryCard';
import api from '../../utils/api';

// Req 3 — Purchasing Manager Dashboard: Team Summary + Team Members (คลิกแถวไปหน้า Member Detail)
// ข้อมูลจาก /api/purchasing/dashboard/team (managerOnly — purchasing_manager/admin เท่านั้น, ดู routes/purchasingDashboard.js)
export default function ManagerPurchasingDash({ navigate }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['purchasing-dashboard-team'],
    queryFn: () => api.get('/purchasing/dashboard/team').then(r => r.data),
  });
  const summary = data?.summary;
  const members = data?.members || [];
  const closedTotal = (summary?.ncr_closed || 0) + (summary?.ncp_closed || 0);

  return (
    <div className="space-y-6">
      <h1 className="page-title">หน้าหลัก ผู้จัดการจัดซื้อ</h1>

      {isError && <div className="card text-danger text-small">โหลดข้อมูลไม่สำเร็จ</div>}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <HeroStat icon={HeroIcons.users} value={isLoading ? '-' : summary?.team_member_count} label="จำนวนลูกทีม" tone="primary" />
        <HeroStat icon={HeroIcons.building} value={isLoading ? '-' : summary?.supplier_count} label="Supplier ทั้งหมด" tone="primary" />
        <HeroStat icon={HeroIcons.check} value={isLoading ? '-' : closedTotal} label="Closed" tone="success" />
        <HeroStat icon={HeroIcons.alert} value={isLoading ? '-' : summary?.overdue} label="Overdue" tone="danger" emphasize />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <SummaryCard value={isLoading ? '-' : summary?.ncr_total} label="NCR ทั้งหมด" color="primary" />
        <SummaryCard value={isLoading ? '-' : summary?.ncp_total} label="NCP ทั้งหมด" color="primary" />
        <SummaryCard value={isLoading ? '-' : summary?.ncr_waiting_review} label="Waiting Review" color="warning" />
        <SummaryCard value={isLoading ? '-' : summary?.ncr_waiting_send_link} label="Waiting Supplier Link" color="warning" />
        <SummaryCard value={isLoading ? '-' : summary?.ncr_waiting_supplier_response} label="Waiting Supplier Response" color="warning" />
        <SummaryCard value={isLoading ? '-' : summary?.ncr_in_progress} label="In Progress" color="accent" />
      </div>

      <div className="card">
        <h2 className="text-h3 font-semibold text-primary mb-3">ลูกทีมจัดซื้อ</h2>
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>ชื่อพนักงาน</th>
                <th>Role</th>
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
              {isLoading && <tr><td colSpan={11} className="text-center py-6 text-muted">กำลังโหลด...</td></tr>}
              {!isLoading && members.length === 0 && <tr><td colSpan={11} className="text-center py-8 text-muted">ไม่พบข้อมูล</td></tr>}
              {members.map(m => (
                <tr key={m.id} className="cursor-pointer" onClick={() => navigate(`/purchasing/team/${m.id}`)}>
                  <td className="font-medium text-text">{m.full_name}</td>
                  <td>จัดซื้อ</td>
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
