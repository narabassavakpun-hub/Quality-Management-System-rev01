import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../../utils/api';

// Req 3 — Member Detail: Supplier List + NCR/NCP Summary ต่อผู้ผลิต (ตารางเดียวกับ "ผู้ผลิตของฉัน" ใน
// PurchasingDash.jsx — คอลัมน์ที่ขอครอบคลุมทั้ง Supplier List/NCR Summary/NCP Summary อยู่แล้วในตารางเดียว)
// + KPI (avg closing time / supplier response time / closing rate)
export default function PurchasingMemberDetail() {
  const { memberId } = useParams();
  const navigate = useNavigate();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['purchasing-dashboard-member', memberId],
    queryFn: () => api.get(`/purchasing/dashboard/team/${memberId}`, { params: { limit: 100 } }).then(r => r.data),
  });
  const member = data?.member;
  const kpi = data?.kpi;
  const suppliers = data?.suppliers?.data || [];

  return (
    <div>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <button onClick={() => navigate('/')} className="text-accent hover:underline flex items-center gap-1 text-small min-h-[44px]">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          กลับ
        </button>
        <div className="flex-1">
          <h1 className="text-h2 font-bold text-primary leading-tight">รายละเอียดพนักงานจัดซื้อ</h1>
          {member?.full_name && <p className="text-small text-muted">{member.full_name}</p>}
        </div>
      </div>

      {isError && <div className="card text-danger text-small mb-4">โหลดข้อมูลไม่สำเร็จ (อาจไม่พบพนักงานคนนี้)</div>}

      {kpi && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
          <div className="card"><div className="font-mono text-3xl font-bold text-primary">{kpi.total}</div><div className="text-small text-muted mt-1">งานทั้งหมด</div></div>
          <div className="card"><div className="font-mono text-3xl font-bold text-primary">{kpi.waiting_review}</div><div className="text-small text-muted mt-1">รอ Review</div></div>
          <div className="card"><div className="font-mono text-3xl font-bold text-primary">{kpi.waiting_send_link}</div><div className="text-small text-muted mt-1">รอส่ง Link</div></div>
          <div className="card"><div className="font-mono text-3xl font-bold text-primary">{kpi.waiting_supplier_response}</div><div className="text-small text-muted mt-1">รอ Supplier</div></div>
          <div className="card"><div className="font-mono text-3xl font-bold text-primary">{kpi.in_progress}</div><div className="text-small text-muted mt-1">กำลังดำเนินการ</div></div>
          <div className="card"><div className="font-mono text-3xl font-bold text-success">{kpi.closed}</div><div className="text-small text-muted mt-1">ปิดแล้ว</div></div>
          <div className="card border-l-4 border-l-danger"><div className="font-mono text-3xl font-bold text-danger">{kpi.overdue}</div><div className="text-small text-muted mt-1">เกินกำหนด</div></div>
          <div className="card"><div className="font-mono text-3xl font-bold text-accent">{kpi.closing_rate}%</div><div className="text-small text-muted mt-1">Closing Rate</div></div>
          <div className="card"><div className="font-mono text-3xl font-bold text-accent">{kpi.avg_closing_days ?? '-'}</div><div className="text-small text-muted mt-1">Avg Closing Time (วัน)</div></div>
          <div className="card"><div className="font-mono text-3xl font-bold text-accent">{kpi.avg_supplier_response_days ?? '-'}</div><div className="text-small text-muted mt-1">Avg Supplier Response (วัน)</div></div>
        </div>
      )}

      <div className="card">
        <h2 className="text-h3 font-semibold text-primary mb-3">ผู้ผลิตที่ดูแล</h2>
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>รหัส</th>
                <th>ผู้ผลิต</th>
                <th>สถานะ</th>
                <th>NCR</th>
                <th>NCP</th>
                <th>เปิด</th>
                <th>รอ Review</th>
                <th>รอส่ง Link</th>
                <th>รอ Supplier ตอบกลับ</th>
                <th>กำลังดำเนินการ</th>
                <th>ปิดแล้ว</th>
                <th>เกินกำหนด</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={12} className="text-center py-6 text-muted">กำลังโหลด...</td></tr>}
              {!isLoading && suppliers.length === 0 && <tr><td colSpan={12} className="text-center py-8 text-muted">ยังไม่มีผู้ผลิตที่ดูแล</td></tr>}
              {suppliers.map(s => (
                <tr key={s.id}>
                  <td className="font-mono">{s.code || '-'}</td>
                  <td>{s.name}</td>
                  <td>
                    <span className={`badge ${s.is_active ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200' : 'bg-gray-100 dark:bg-gray-900 text-gray-500 dark:text-gray-200'}`}>
                      {s.is_active ? 'ใช้งาน' : 'ปิดใช้งาน'}
                    </span>
                  </td>
                  <td>{s.ncr_total}</td>
                  <td>{s.ncp_total}</td>
                  <td>{s.open_count}</td>
                  <td>{s.waiting_review_count}</td>
                  <td>{s.waiting_send_link_count}</td>
                  <td>{s.waiting_supplier_response_count}</td>
                  <td>{s.in_progress_count}</td>
                  <td>{s.closed_count}</td>
                  <td className={s.overdue_count > 0 ? 'text-danger font-semibold' : ''}>{s.overdue_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
