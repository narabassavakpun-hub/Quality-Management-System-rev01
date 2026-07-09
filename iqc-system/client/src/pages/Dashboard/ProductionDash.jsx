import SummaryCard from '../../components/UI/SummaryCard';
import { useStats } from './shared';

export default function ProductionDash({ navigate }) {
  const { data } = useStats();
  const myUAI = data?.uai_pending_production_ack || [];

  return (
    <div className="space-y-6">
      <h1 className="page-title">หน้าหลัก ผู้จัดการผลิต</h1>
      <div className="grid grid-cols-2 gap-4">
        <SummaryCard value={myUAI.length} label="UAI รอรับทราบ" color="danger" />
        <SummaryCard value={data?.ncr_total ?? 0} label="NCR ทั้งหมด" color="primary" />
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
