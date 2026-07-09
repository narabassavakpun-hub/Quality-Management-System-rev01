import SummaryCard from '../../components/UI/SummaryCard';
import { useAuth } from '../../contexts/AuthContext';
import { useStats } from './shared';

export default function ExecutiveDash({ navigate }) {
  const { data } = useStats();
  const { user } = useAuth();
  const myUAI = data?.uai_my_sign || [];

  return (
    <div className="space-y-6">
      <h1 className="page-title">หน้าหลัก {user?.role?.toUpperCase()}</h1>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard value={myUAI.length} label="UAI รอลงนาม" color="danger" />
        <SummaryCard value={data?.uai_completed_count ?? 0} label="UAI อนุมัติแล้ว" color="success" />
        <SummaryCard value={data?.ncr_not_closed_count ?? 0} label="NCR เปิดอยู่" color="warning" />
        <SummaryCard value={data?.total_bills ?? 0} label="รับเข้าทั้งหมด" color="primary" />
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
    </div>
  );
}
