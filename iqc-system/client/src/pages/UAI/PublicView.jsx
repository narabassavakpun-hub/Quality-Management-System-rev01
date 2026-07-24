// ===== S169 — ดูรายละเอียด UAI แบบไม่ต้อง login (magic link จาก Telegram DM ส่วนตัว, token อายุ 24 ชม.) =====
// อ่านอย่างเดียว ไม่มีปุ่มอนุมัติ/เซ็นใดๆ ที่นี่ (ต้อง login เข้าเว็บปกติหรือกดผ่านปุ่ม Telegram ถึงจะอนุมัติได้)
// pattern เดียวกับ client/src/pages/Supplier/NCRResponse.jsx (public page, ไม่มี AppLayout/sidebar)
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import api from '../../utils/api';
import Badge from '../../components/UI/Badge';
import { ROLE_LABELS } from '../../utils/rolePermissions';

const DISPOSITION_LABELS = {
  return: 'ส่งคืน Supplier (Return)',
  rework: 'แก้ไข (Rework)',
  uai: 'ยอมรับใช้พิเศษ (UAI)',
  scrap: 'ทำลาย (Scrap)',
  re_inspect: 'ตรวจซ้ำ (Re-inspect)',
};

function fmtDt(s) {
  if (!s) return '-';
  return new Date(s.replace(' ', 'T') + 'Z').toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' });
}

export default function UaiPublicView() {
  const { token } = useParams();

  const { data: uai, isLoading, error } = useQuery({
    queryKey: ['uai-public-view', token],
    queryFn: () => api.get(`/uai/view/${token}`).then(r => r.data),
    retry: false,
  });

  if (isLoading) {
    return <div className="theme-light-only min-h-screen flex items-center justify-center text-muted">กำลังโหลด...</div>;
  }

  if (error || !uai) {
    const expired = error?.response?.status === 410;
    return (
      <div className="theme-light-only min-h-screen flex items-center justify-center p-4">
        <div className="card max-w-md text-center">
          <div className="text-danger font-bold text-h3 mb-2">{expired ? 'ลิงก์หมดอายุแล้ว' : 'ไม่พบเอกสาร'}</div>
          <div className="text-muted text-small mb-4">
            {error?.response?.data?.error || 'ลิงก์นี้ใช้ได้ 24 ชม. หลังได้รับแจ้งเตือน — กรุณาเข้าสู่ระบบเพื่อดูเอกสารฉบับเต็ม'}
          </div>
          <Link to="/login" className="btn-primary btn inline-flex">เข้าสู่ระบบ</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="theme-light-only min-h-screen bg-bg py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="text-center mb-2">
          <div className="text-primary font-bold text-h2">เอกสาร UAI (ยอมรับใช้พิเศษ)</div>
          <div className="font-mono text-h3 text-accent mt-1">{uai.uai_code}</div>
          <div className="mt-2"><Badge status={uai.status} /></div>
          <div className="text-[11px] text-muted mt-2">
            ลิงก์นี้ใช้ดูได้ชั่วคราว (ไม่ต้อง login) — <Link to="/login" className="text-accent hover:underline">เข้าสู่ระบบ</Link> เพื่อดำเนินการ/ดูรายละเอียดฉบับเต็ม
          </div>
        </div>

        <div className="card">
          <h2 className="text-h3 font-semibold text-primary mb-3">ข้อมูล UAI</h2>
          <div className="grid grid-cols-2 gap-3">
            <div><div className="text-small text-muted">NCR อ้างอิง</div><div className="font-mono font-medium">{uai.ncr_code || '-'}</div></div>
            <div><div className="text-small text-muted">Supplier</div><div className="font-medium">{uai.supplier_name || '-'}</div></div>
            <div><div className="text-small text-muted">Invoice / PO</div><div className="font-mono font-medium">{uai.invoice_no} / {uai.po_no}</div></div>
            <div><div className="text-small text-muted">ผู้ออกเอกสาร</div><div className="font-medium">{uai.created_by_name || '-'}</div></div>
            {uai.disposition && (
              <div className="col-span-2"><div className="text-small text-muted">Disposition</div><div className="font-medium">{DISPOSITION_LABELS[uai.disposition] || uai.disposition}</div></div>
            )}
            {uai.reason && (
              <div className="col-span-2"><div className="text-small text-muted">เหตุผลขอยอมรับใช้พิเศษ</div><div className="font-medium whitespace-pre-wrap">{uai.reason}</div></div>
            )}
            {uai.conditions && (
              <div className="col-span-2"><div className="text-small text-muted">เงื่อนไข</div><div className="font-medium whitespace-pre-wrap">{uai.conditions}</div></div>
            )}
          </div>
        </div>

        {uai.ncr_items?.length > 0 && (
          <div className="card">
            <h2 className="text-h3 font-semibold text-primary mb-3">รายการสินค้า</h2>
            <div className="space-y-2">
              {uai.ncr_items.map((item, i) => (
                <div key={i} className="border border-border rounded-lg p-3">
                  <div className="font-medium">{item.item_name}</div>
                  <div className="text-small text-muted mt-1">
                    รับเข้า {item.qty_received} · สุ่มตรวจ {item.qty_sampled} · ไม่ผ่าน {item.qty_failed}
                  </div>
                  {item.defect_category_name && <div className="text-small mt-1">กลุ่มปัญหา: {item.defect_category_name}</div>}
                  {item.defect_detail && <div className="text-small text-muted">{item.defect_detail}</div>}
                  {item.bill_item_images?.length > 0 && (
                    <div className="mt-2">
                      <div className="text-[12px] text-muted mb-1">รูปภาพงานเสีย ({item.bill_item_images.length} รูป)</div>
                      <div className="flex flex-wrap gap-2">
                        {item.bill_item_images.map((img, j) => (
                          <a key={j} href={`/uploads/bill-items/${img.file_path}`} target="_blank" rel="noreferrer">
                            <img src={`/uploads/bill-items/${img.file_path}`} alt="" className="h-20 w-20 object-cover rounded border border-border hover:opacity-80" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {uai.ncr_images?.length > 0 && (
          <div className="card">
            <h2 className="text-h3 font-semibold text-primary mb-3">รูปภาพจาก NCR</h2>
            <div className="flex flex-wrap gap-2">
              {uai.ncr_images.map((img, i) => (
                <a key={i} href={`/uploads/ncr/${img.file_path}`} target="_blank" rel="noreferrer">
                  <img src={`/uploads/ncr/${img.file_path}`} alt="" className="h-24 w-24 object-cover rounded border border-border hover:opacity-80" />
                </a>
              ))}
            </div>
          </div>
        )}

        {uai.images?.length > 0 && (
          <div className="card">
            <h2 className="text-h3 font-semibold text-primary mb-3">รูปภาพแนบ</h2>
            <div className="flex flex-wrap gap-2">
              {uai.images.map((img, i) => (
                <a key={i} href={`/uploads/uai/${img.file_path}`} target="_blank" rel="noreferrer">
                  <img src={`/uploads/uai/${img.file_path}`} alt="" className="h-24 w-24 object-cover rounded border border-border hover:opacity-80" />
                </a>
              ))}
            </div>
          </div>
        )}

        {uai.signatures?.length > 0 && (
          <div className="card">
            <h2 className="text-h3 font-semibold text-primary mb-3">ประวัติการลงนาม/อนุมัติ</h2>
            <div className="space-y-3">
              {uai.signatures.map((s, i) => (
                <div key={i} className="flex gap-3 border-b border-border last:border-0 pb-3 last:pb-0">
                  {s.signature_image && (
                    <img src={s.signature_image} alt="" className="h-14 w-24 object-contain border border-border rounded bg-white shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="font-medium text-small">{s.full_name || '-'} <span className="text-muted">({ROLE_LABELS[s.role] || s.role})</span></div>
                    <div className="text-[11px] text-muted">{fmtDt(s.signed_at)}</div>
                    {s.comment && <div className="text-small mt-1">{s.comment}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
