import SummaryCard from '../../components/UI/SummaryCard';
import { useStats } from './shared';

export default function SupervisorDash({ navigate }) {
  const { data } = useStats();
  const pendingBills = data?.pending_approval_bills || [];
  const pendingNCR = data?.ncr_pending_supervisor || [];

  return (
    <div className="space-y-6">
      <h1 className="page-title">หน้าหลัก QC Supervisor</h1>
      <div className="grid grid-cols-2 gap-4">
        <SummaryCard value={pendingBills.length} label="รับเข้ารออนุมัติ" color="warning" />
        <SummaryCard value={pendingNCR.length} label="NCR รออนุมัติ" color="danger" />
      </div>
      <div className="card">
        <h2 className="text-h3 font-semibold text-primary mb-3">รายการรับเข้ารออนุมัติ</h2>
        <div className="table-container">
          <table className="table">
            <thead><tr><th>Invoice No.</th><th>PO No.</th><th>Supplier</th><th>วันที่</th></tr></thead>
            <tbody>
              {pendingBills.map(b => (
                <tr key={b.id} onClick={() => navigate(`/bills/${b.id}`)}>
                  <td className="font-mono">{b.invoice_no}</td>
                  <td className="font-mono">{b.po_no}</td>
                  <td>{b.supplier_name}</td>
                  <td>{b.received_date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <h2 className="text-h3 font-semibold text-primary mb-3">NCR รออนุมัติ</h2>
        <div className="table-container">
          <table className="table">
            <thead><tr><th>รหัส NCR</th><th>รายการ</th><th>Supplier</th><th>วันที่</th></tr></thead>
            <tbody>
              {pendingNCR.map(n => (
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
