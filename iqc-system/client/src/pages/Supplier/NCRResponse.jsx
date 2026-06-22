import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import api from '../../utils/api';
import Button from '../../components/UI/Button';

export default function NCRResponse() {
  const { token } = useParams();
  const [form, setForm] = useState({ respondent_name: '', root_cause: '', corrective_action: '', preventive_action: '', completion_date: '' });
  const [attachments, setAttachments] = useState([]);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const { data: ncr, isLoading } = useQuery({
    queryKey: ['supplier-ncr', token],
    queryFn: () => api.get(`/supplier/ncr/${token}`).then(r => r.data),
  });

  const respond = useMutation({
    mutationFn: async () => {
      if (!form.respondent_name.trim()) {
        throw new Error('Please enter respondent name / กรุณากรอกชื่อผู้ตอบ');
      }
      if (!form.root_cause.trim() || !form.corrective_action.trim() || !form.preventive_action.trim()) {
        throw new Error('Please fill in all required fields / กรุณากรอกข้อมูลที่จำเป็นให้ครบ');
      }
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => { if (v) fd.append(k, v); });
      for (const f of attachments) fd.append('attachments', f);
      await api.post(`/supplier/ncr/${token}/respond`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    },
    onSuccess: () => setSubmitted(true),
    onError: (err) => setError(err.response?.data?.error || err.message || 'An error occurred'),
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted">
        Loading... / กำลังโหลด...
      </div>
    );
  }

  if (!ncr) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="card max-w-md text-center">
          <div className="text-danger font-bold text-h3 mb-2">Document Not Found / ไม่พบเอกสาร</div>
          <div className="text-muted text-small">The link may have expired. Please contact Purchasing. / ลิ้งค์อาจหมดอายุแล้ว กรุณาติดต่อฝ่ายจัดซื้อ</div>
        </div>
      </div>
    );
  }

  if (submitted || ncr.already_responded) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center p-4">
        <div className="card max-w-md text-center">
          <div className="text-success text-h2 font-bold mb-2">Response Submitted / ส่งคำตอบเรียบร้อยแล้ว</div>
          <div className="text-body text-muted">Thank you for your response. The QC team will follow up. / ขอบคุณสำหรับการตอบกลับ ทีม QC จะดำเนินการต่อไป</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-4">

        {/* Header */}
        <div className="text-center mb-6">
          <div className="text-primary font-bold text-h2">NCR Supplier Response / ตอบกลับ NCR</div>
          <div className="font-mono text-h3 text-accent mt-1">{ncr.ncr_code}</div>
          <div className="text-small text-muted mt-1">
            {ncr.severity === 'major'
              ? 'Major Non-Conformance / ข้อบกพร่องระดับ Major'
              : 'Minor Non-Conformance / ข้อบกพร่องระดับ Minor'}
          </div>
        </div>

        {/* NCR Info */}
        <div className="card">
          <h2 className="text-h3 font-semibold text-primary mb-3">
            NCR Information / ข้อมูล NCR
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-small text-muted">Invoice No.</div>
              <div className="font-mono font-medium">{ncr.invoice_no}</div>
            </div>
            <div>
              <div className="text-small text-muted">PO No.</div>
              <div className="font-mono font-medium">{ncr.po_no}</div>
            </div>
            <div>
              <div className="text-small text-muted">Supplier</div>
              <div className="font-medium">{ncr.supplier_name || '-'}</div>
            </div>
            <div>
              <div className="text-small text-muted">Received Date / วันที่รับเข้า</div>
              <div className="font-medium">{ncr.received_date || '-'}</div>
            </div>
          </div>
        </div>

        {/* Problem Details per item */}
        <div className="card">
          <h2 className="text-h3 font-semibold text-primary mb-3">
            Non-Conforming Items / รายการสินค้าที่ไม่ผ่าน
          </h2>

          <div className="space-y-3">
            {ncr.items?.map((item, i) => (
              <div key={i} className="border border-red-200 rounded-lg overflow-hidden">
                {/* Item header */}
                <div className="bg-red-50 px-4 py-3">
                  <div className="font-semibold text-body text-primary">
                    {item.item_name_en || item.item_name}
                  </div>
                  {item.item_name_en && item.item_name !== item.item_name_en && (
                    <div className="text-small text-muted">{item.item_name}</div>
                  )}

                  {/* Quantities */}
                  <div className="grid grid-cols-3 gap-2 mt-3">
                    <div className="bg-surface rounded px-2 py-1.5 text-center">
                      <div className="text-small text-muted leading-tight">Qty Received<br /><span className="text-xs">จำนวนรับเข้า</span></div>
                      <div className="font-mono font-bold text-h3 mt-0.5">{item.qty_received}</div>
                    </div>
                    <div className="bg-surface rounded px-2 py-1.5 text-center">
                      <div className="text-small text-muted leading-tight">Qty Sampled<br /><span className="text-xs">จำนวนสุ่มตรวจ</span></div>
                      <div className="font-mono font-bold text-h3 mt-0.5">{item.qty_sampled}</div>
                    </div>
                    <div className="bg-red-100 rounded px-2 py-1.5 text-center">
                      <div className="text-small text-red-600 leading-tight">Qty Failed<br /><span className="text-xs">จำนวนของเสีย</span></div>
                      <div className="font-mono font-bold text-h3 text-danger mt-0.5">{item.qty_failed}</div>
                    </div>
                  </div>

                  {/* Defect detail */}
                  {(item.defect_detail_en || item.defect_detail) && (
                    <div className="mt-3 space-y-1">
                      <div className="text-small text-muted font-medium">Defect Description / รายละเอียดปัญหา</div>
                      {item.defect_detail_en && (
                        <div className="bg-surface rounded px-3 py-2 text-small">{item.defect_detail_en}</div>
                      )}
                      {item.defect_detail && item.defect_detail !== item.defect_detail_en && (
                        <div className="bg-surface rounded px-3 py-2 text-small text-muted">{item.defect_detail}</div>
                      )}
                    </div>
                  )}
                </div>

                {/* Problem images */}
                {item.bill_item_images?.length > 0 && (
                  <div className="px-4 py-3 bg-surface border-t border-red-200">
                    <div className="text-small text-muted mb-2 font-medium">
                      Problem Photos / รูปภาพปัญหา ({item.bill_item_images.length})
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {item.bill_item_images.map(img => (
                        <a key={img.id} href={`/uploads/bill-items/${img.file_path}`} target="_blank" rel="noreferrer">
                          <img
                            src={`/uploads/bill-items/${img.file_path}`}
                            alt=""
                            className="h-28 w-28 object-cover rounded border border-red-200 hover:opacity-80"
                          />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* NCR-level extra images */}
          {ncr.images?.length > 0 && (
            <div className="mt-4">
              <div className="text-small text-muted font-medium mb-2">Additional Photos / รูปภาพเพิ่มเติม</div>
              <div className="flex flex-wrap gap-2">
                {ncr.images.map(img => (
                  <a key={img.id} href={`/uploads/ncr/${img.file_path}`} target="_blank" rel="noreferrer">
                    <img src={`/uploads/ncr/${img.file_path}`} alt="" className="h-24 w-24 object-cover rounded border border-border hover:opacity-80" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Response Form */}
        <div className="card">
          <h2 className="text-h3 font-semibold text-primary mb-1">Supplier Response / คำตอบกลับ</h2>
          <div className="text-small text-muted mb-4">Please respond in English or Thai / กรุณาตอบเป็นภาษาอังกฤษหรือภาษาไทย</div>

          <div className="space-y-4">
            {error && <div className="text-danger text-small bg-red-50 px-3 py-2 rounded">{error}</div>}

            <div>
              <label className="label">
                Respondent Name / ชื่อผู้ตอบ <span className="text-danger">*</span>
              </label>
              <div className="text-xs text-muted mb-1">Full name of the person completing this form / ชื่อ-นามสกุลของผู้กรอกแบบฟอร์มนี้</div>
              <input
                type="text"
                className="input"
                value={form.respondent_name}
                onChange={e => set('respondent_name', e.target.value)}
                placeholder="e.g. John Smith / เช่น สมชาย ใจดี"
              />
            </div>

            <div>
              <label className="label">
                Root Cause / สาเหตุต้นตอ <span className="text-danger">*</span>
              </label>
              <div className="text-xs text-muted mb-1">What caused this non-conformance? / อะไรเป็นสาเหตุทำให้เกิดปัญหานี้?</div>
              <textarea
                className="input"
                rows={4}
                value={form.root_cause}
                onChange={e => set('root_cause', e.target.value)}
                placeholder="Describe the root cause... / อธิบายสาเหตุต้นตอ..."
              />
            </div>

            <div>
              <label className="label">
                Corrective Action / การแก้ไข <span className="text-danger">*</span>
              </label>
              <div className="text-xs text-muted mb-1">What action has been taken to fix this issue? / ดำเนินการแก้ไขอย่างไร?</div>
              <textarea
                className="input"
                rows={4}
                value={form.corrective_action}
                onChange={e => set('corrective_action', e.target.value)}
                placeholder="Describe corrective action taken... / อธิบายการแก้ไขที่ดำเนินการ..."
              />
            </div>

            <div>
              <label className="label">
                Preventive Action / การป้องกัน <span className="text-danger">*</span>
              </label>
              <div className="text-xs text-muted mb-1">How will you prevent this from recurring? / จะป้องกันไม่ให้เกิดซ้ำได้อย่างไร?</div>
              <textarea
                className="input"
                rows={4}
                value={form.preventive_action}
                onChange={e => set('preventive_action', e.target.value)}
                placeholder="Describe preventive action... / อธิบายมาตรการป้องกัน..."
              />
            </div>

            <div>
              <label className="label">Completion Date / วันที่แก้ไขแล้วเสร็จ</label>
              <input
                type="date"
                className="input"
                value={form.completion_date}
                onChange={e => set('completion_date', e.target.value)}
              />
            </div>

            <div>
              <label className="label">Attachments / แนบเอกสาร</label>
              <div className="text-xs text-muted mb-1">Photos, reports, or other supporting documents / รูปภาพ รายงาน หรือเอกสารประกอบ</div>
              <input
                type="file"
                multiple
                accept=".pdf,image/*"
                onChange={e => setAttachments(Array.from(e.target.files))}
                className="block w-full text-small text-muted file:mr-3 file:py-2 file:px-3 file:rounded file:border file:border-border file:bg-surface"
              />
              {attachments.length > 0 && (
                <div className="text-xs text-muted mt-1">{attachments.length} file(s) selected</div>
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-border">
              <Button onClick={() => respond.mutate()} loading={respond.isPending}>
                Submit Response / ส่งคำตอบกลับ
              </Button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
