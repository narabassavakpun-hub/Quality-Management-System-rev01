import SummaryCard from '../../components/UI/SummaryCard';
import Badge from '../../components/UI/Badge';
import { useStats } from './shared';

export default function QMRDash({ navigate }) {
  const { data } = useStats();

  return (
    <div className="space-y-6">
      <h1 className="page-title">หน้าหลัก QMR</h1>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard value={data?.ncr_total ?? 0} label="NCR ทั้งหมด" color="primary" />
        <SummaryCard value={data?.ncr_open_statuses_count ?? 0} label="NCR เปิดอยู่" color="danger" />
        <SummaryCard value={data?.ncr_closed_count ?? 0} label="NCR ปิดแล้ว" color="success" />
        <SummaryCard value={data?.uai_total ?? 0} label="UAI ทั้งหมด" color="accent" />
      </div>
      <div className="card">
        <h2 className="text-h3 font-semibold text-primary mb-3">NCR รออนุมัติเปิด/ปิด</h2>
        <div className="table-container">
          <table className="table">
            <thead><tr><th>รหัส NCR</th><th>รายการ</th><th>สถานะ</th><th>วันที่</th></tr></thead>
            <tbody>
              {(data?.ncr_pending_qmr || []).map(n => (
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
