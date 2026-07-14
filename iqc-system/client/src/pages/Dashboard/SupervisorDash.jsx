import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import SummaryCard from '../../components/UI/SummaryCard';
import { useStats } from './shared';
import { DetailModal } from '../Delivery/index';

function toDateStr(d) { return d.toISOString().slice(0, 10); }

export default function SupervisorDash({ navigate }) {
  const { user } = useAuth();
  const { data } = useStats();
  const pendingBills = data?.pending_approval_bills || [];
  const pendingNCR = data?.ncr_pending_supervisor || [];

  // "รายการสินค้าที่รอรับเข้าวันนี้" — เพิ่มตามคำขอ user ให้ qc_staff/qc_supervisor เห็นภาพรวมของที่กำลังจะมาส่ง
  // วันนี้ด้วย (เดิมมีแค่หน้าคลัง) ใช้ DetailModal เดิมจาก Delivery/index.jsx ร่วมกัน — ไม่ต้องเขียนใหม่
  const today = toDateStr(new Date());
  const { data: todayDelivery } = useQuery({
    queryKey: ['delivery', today, today],
    queryFn: () => api.get('/delivery', { params: { from: today, to: today, limit: 100 } }).then(r => r.data),
  });
  const todayAwaiting = (todayDelivery?.data || []).filter(s => ['pending', 'acknowledged'].includes(s.status));

  const [selectedSchedule, setSelectedSchedule] = useState(null);
  async function openDetail(s) {
    const res = await api.get(`/delivery/${s.id}`);
    setSelectedSchedule(res.data);
  }

  return (
    <div className="space-y-6">
      <h1 className="page-title">หน้าหลัก QC Supervisor</h1>
      <div className="grid grid-cols-2 gap-4">
        <SummaryCard value={pendingBills.length} label="รับเข้ารออนุมัติ" color="warning" />
        <SummaryCard value={pendingNCR.length} label="NCR รออนุมัติ" color="danger" />
      </div>
      <div className="card">
        <h2 className="text-h3 font-semibold text-primary mb-3">รายการสินค้าที่รอรับเข้าวันนี้</h2>
        {todayAwaiting.length === 0 ? (
          <p className="text-muted text-small py-4 text-center">ไม่มีรายการรอรับเข้าวันนี้</p>
        ) : (
          <div className="space-y-2">
            {todayAwaiting.map(s => (
              <button
                key={s.id}
                onClick={() => openDetail(s)}
                className="w-full text-left flex items-center justify-between gap-3 px-4 py-3 rounded-lg border border-border hover:bg-bg transition-colors min-h-[56px]"
              >
                <div className="min-w-0">
                  <p className="font-medium text-text truncate">{s.supplier_name}</p>
                  <p className="text-small text-muted">{s.scheduled_date}{s.time_slot ? ` เวลา ${s.time_slot}` : ''}</p>
                </div>
                {s.status === 'pending' ? (
                  <span className="badge bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200 flex-shrink-0">รอรับทราบ</span>
                ) : (
                  <span className="badge bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200 flex-shrink-0">รับทราบแล้ว</span>
                )}
              </button>
            ))}
          </div>
        )}
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

      {selectedSchedule && (
        <DetailModal
          schedule={selectedSchedule}
          onClose={() => setSelectedSchedule(null)}
          suppliers={[]}
          role={user?.role}
          holidays={[]}
        />
      )}
    </div>
  );
}
