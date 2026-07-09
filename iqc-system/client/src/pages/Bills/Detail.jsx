import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import api, { downloadExcel, downloadPdf } from '../../utils/api';
import Badge from '../../components/UI/Badge';
import Button from '../../components/UI/Button';
import ConfirmDialog from '../../components/UI/ConfirmDialog';

export default function BillDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [confirmAction, setConfirmAction] = React.useState(null);

  const { data: bill, isLoading } = useQuery({
    queryKey: ['bill', id],
    queryFn: () => api.get(`/bills/${id}`).then(r => r.data),
  });

  const approve = useMutation({
    mutationFn: () => api.post(`/bills/${id}/approve`),
    onSuccess: () => { qc.invalidateQueries(['bill', id]); setConfirmAction(null); },
  });
  const reject = useMutation({
    mutationFn: () => api.post(`/bills/${id}/reject`),
    onSuccess: () => { qc.invalidateQueries(['bill', id]); setConfirmAction(null); },
  });

  if (isLoading) return <div className="text-muted py-8 text-center">กำลังโหลด...</div>;
  if (!bill) return <div className="text-danger py-8 text-center">ไม่พบข้อมูล</div>;

  return (
    <div className="space-y-4">
      <button onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1.5 text-muted hover:text-text text-small min-h-[44px] -ml-1">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        กลับ
      </button>
      <div className="page-header">
        <div>
          <h1 className="page-title">บิล — {bill.invoice_no}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge status={bill.status} />
            <span className="text-small text-muted">{bill.received_date}</span>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {user?.role === 'qc_staff' && bill.status === 'draft' && (
            <Button variant="secondary" onClick={() => navigate(`/bills/new?edit=${id}`)}>แก้ไข</Button>
          )}
          {user?.role === 'qc_supervisor' && bill.status === 'pending_approval' && (
            <>
              <Button variant="danger" onClick={() => setConfirmAction('reject')}>ส่งกลับ</Button>
              <Button variant="success" onClick={() => setConfirmAction('approve')}>อนุมัติ</Button>
            </>
          )}
          {bill.status === 'approved' && (
            <>
              <button
                onClick={() => downloadPdf(`/bill/${id}/pdf`, {}, `${bill.invoice_no || id}.pdf`)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-surface hover:bg-bg text-small font-medium text-text transition-colors min-h-[40px]"
              >
                <svg className="w-4 h-4 text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Export PDF
              </button>
              <button
                onClick={() => downloadExcel(`/bill/${id}/excel`, {}, `${bill.invoice_no || id}.xlsx`)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-surface hover:bg-bg text-small font-medium text-text transition-colors min-h-[40px]"
              >
                <svg className="w-4 h-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Export Excel
              </button>
            </>
          )}
        </div>
      </div>

      <div className="card">
        <h2 className="text-h3 font-semibold text-primary mb-3">ข้อมูลบิล</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            ['Invoice No.', bill.invoice_no, 'font-mono'],
            ['PO No.', bill.po_no, 'font-mono'],
            ['Supplier', bill.supplier_name, ''],
            ['Container No.', bill.container_no || '-', 'font-mono'],
            ['Tracking No.', bill.tracking_no || '-', 'font-mono'],
            ['วันที่รับเข้า', bill.received_date, ''],
            ['ผู้ออกเอกสาร', bill.created_by_name || '-', ''],
            ['วันที่ออกเอกสาร', bill.created_at ? new Date(bill.created_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '-', ''],
          ].map(([label, value, cls]) => (
            <div key={label}>
              <div className="text-small text-muted">{label}</div>
              <div className={`text-body font-medium ${cls}`}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      {bill.images?.length > 0 && (
        <div className="card">
          <h2 className="text-h3 font-semibold text-primary mb-3">รูปถ่ายบิล</h2>
          <div className="flex flex-wrap gap-2">
            {bill.images.map(img => (
              <a key={img.id} href={`/uploads/bills/${img.file_path}`} target="_blank" rel="noreferrer">
                <img src={`/uploads/bills/${img.file_path}`} alt="" className="h-24 w-24 object-cover rounded border border-border hover:opacity-80" />
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h2 className="text-h3 font-semibold text-primary mb-3">รายการสินค้า</h2>
        {bill.items?.map((item, i) => (
          <div key={item.id} className={`border rounded-lg mb-3 overflow-hidden ${item.qty_failed > 0 ? 'border-danger' : 'border-border'}`}>
            <div className={`p-3 ${item.qty_failed > 0 ? 'bg-red-50 dark:bg-red-900' : 'bg-surface'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="font-medium text-body">{i + 1}. {item.product_name || item.item_name || '-'}</div>
                  <div className="text-small text-muted mt-0.5">{item.product_group_name}</div>
                </div>
                {/* ไม่ใช้ font-mono ตรงนี้โดยตั้งใจ — IBM Plex Mono แสดงเลข 0 แบบมีจุดกลาง ทำให้สับสนกับตัวเลขอื่นเวลาอ่านจำนวนเร็วๆ */}
                <div className="flex gap-4 text-small text-center">
                  <div><div className="text-muted">รับเข้า</div><div className="font-semibold">{(item.qty_received ?? 0).toLocaleString()}</div></div>
                  <div><div className="text-muted">สุ่มตรวจ</div><div className="font-semibold">{(item.qty_sampled ?? 0).toLocaleString()}</div></div>
                  <div><div className="text-muted">ผ่าน</div><div className="font-semibold text-success">{(item.qty_passed ?? 0).toLocaleString()}</div></div>
                  <div><div className="text-muted">ไม่ผ่าน</div><div className={`font-semibold ${item.qty_failed > 0 ? 'text-danger' : ''}`}>{(item.qty_failed ?? 0).toLocaleString()}</div></div>
                </div>
              </div>
            </div>
            {item.qty_failed > 0 && (
              <div className="bg-red-50 dark:bg-red-900 border-t border-red-200 dark:border-red-700 p-3 space-y-2">
                <div className="text-small"><span className="text-muted">กลุ่มปัญหา: </span><span className="font-medium">{item.defect_category_name || '-'}</span></div>
                <div className="text-small"><span className="text-muted">รายละเอียด: </span>{item.defect_detail || '-'}</div>
                {item.images?.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {item.images.map(img => (
                      <a key={img.id} href={`/uploads/bill-items/${img.file_path}`} target="_blank" rel="noreferrer">
                        <img src={`/uploads/bill-items/${img.file_path}`} alt="" className="h-20 w-20 object-cover rounded border border-red-200 dark:border-red-700" />
                      </a>
                    ))}
                  </div>
                )}
                <div className="flex items-center justify-between mt-2">
                  {['qc_staff', 'qc_supervisor'].includes(user?.role) && bill.status === 'approved' && (
                    item.in_ncr ? (
                      <button
                        onClick={() => navigate(`/ncr/${item.in_ncr.id}`)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-accent text-accent bg-blue-50 dark:bg-blue-900 hover:bg-blue-100 text-small font-mono font-semibold transition-colors"
                      >
                        <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        {item.in_ncr.ncr_code}
                      </button>
                    ) : (
                      <Button variant="danger" size="sm" onClick={() => navigate(`/ncr/new?bill_id=${bill.id}&item_id=${item.id}`)}>
                        ออกเอกสาร NCR/NCP
                      </Button>
                    )
                  )}
                </div>
              </div>
            )}
            {item.inspection_docs?.length > 0 && (
              <div className="bg-bg border-t border-border px-3 py-2">
                <span className="text-small text-muted">เอกสารตรวจเส้น: </span>
                {item.inspection_docs.map(doc => (
                  <a key={doc.id} href={`/uploads/inspection-docs/${doc.file_path}`} target="_blank" rel="noreferrer" className="text-small text-accent hover:underline mr-2">{doc.original_name}</a>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={confirmAction === 'approve'}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => approve.mutate()}
        title="ยืนยันการอนุมัติ"
        message={`ต้องการอนุมัติบิล Invoice ${bill.invoice_no} ใช่หรือไม่`}
        confirmLabel="อนุมัติ"
        variant="success"
        loading={approve.isPending}
      />
      <ConfirmDialog
        open={confirmAction === 'reject'}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => reject.mutate()}
        title="ส่งกลับ"
        message={`ต้องการส่งกลับบิล Invoice ${bill.invoice_no} ใช่หรือไม่`}
        confirmLabel="ส่งกลับ"
        variant="warning"
        loading={reject.isPending}
      />
    </div>
  );
}
