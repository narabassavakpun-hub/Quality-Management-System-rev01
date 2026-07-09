import SummaryCard from '../../components/UI/SummaryCard';
import { useStats } from './shared';

export default function PurchasingDash({ navigate }) {
  const { data } = useStats();
  const toSend = data?.ncr_pending_supplier_list || [];

  return (
    <div className="space-y-6">
      <h1 className="page-title">หน้าหลัก จัดซื้อ</h1>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <SummaryCard value={data?.ncr_pending_supplier_count ?? 0} label="NCR รอส่ง Supplier" color="danger" />
        <SummaryCard value={data?.ncr_pending_manager_review_count ?? 0} label="Supplier ยังไม่ตอบ" color="warning" />
        <SummaryCard value={data?.uai_pending_purchasing_count ?? 0} label="UAI รอออกเอกสาร" color="accent" />
      </div>
      <div className="card">
        <h2 className="text-h3 font-semibold text-primary mb-3">NCR ที่ต้องส่ง Supplier</h2>
        <div className="table-container">
          <table className="table">
            <thead><tr><th>รหัส NCR</th><th>รายการ</th><th>Supplier</th><th>วันที่</th></tr></thead>
            <tbody>
              {toSend.map(n => (
                <tr key={n.id} onClick={() => navigate(`/ncr/${n.id}`)}>
                  <td className="font-mono">{n.ncr_code}</td>
                  <td>{n.item_name}</td>
                  <td>{n.supplier_name}</td>
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
