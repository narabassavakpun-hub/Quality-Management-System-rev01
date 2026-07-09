import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../utils/api';
import Button from '../../components/UI/Button';
import SearchableSelect from '../../components/UI/SearchableSelect';
import ImageUploadPair from '../../components/UI/ImageUploadPair';

export default function NCRNew() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [billId, setBillId] = useState(searchParams.get('bill_id') || '');
  const [severity, setSeverity] = useState('major');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [extraImages, setExtraImages] = useState([]);
  const [error, setError] = useState('');

  const { data: billsRes } = useQuery({
    queryKey: ['bills-approved'],
    queryFn: () => api.get('/bills?status=approved&limit=500').then(r => r.data),
  });
  const bills = Array.isArray(billsRes) ? billsRes : (billsRes?.data ?? []);

  const { data: billItemsRes } = useQuery({
    queryKey: ['bill-items-for-ncr', billId],
    queryFn: () => api.get(`/bills/${billId}/items`).then(r => r.data),
    enabled: !!billId,
  });
  const billItems = Array.isArray(billItemsRes) ? billItemsRes : (billItemsRes?.data ?? billItemsRes ?? []);

  // เฉพาะรายการที่ไม่ผ่าน และยังไม่มี NCR
  const failedItems = billItems.filter(i => !i.in_ncr && Number(i.qty_failed) > 0);

  function toggleItem(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const create = useMutation({
    mutationFn: async () => {
      if (!billId) throw new Error('กรุณาเลือกบิล');
      if (selectedIds.size === 0) throw new Error('กรุณาเลือกรายการสินค้าอย่างน้อย 1 รายการ');

      // รวบรวมข้อมูลจาก bill items โดยตรง ไม่ต้องกรอกใหม่
      const items = failedItems
        .filter(i => selectedIds.has(i.id))
        .map(i => ({
          bill_item_id: i.id,
          item_name: i.product_name || i.item_name || '',
          qty_received: i.qty_received || 0,
          qty_sampled: i.qty_sampled || 0,
          qty_failed: i.qty_failed || 0,
          defect_category_id: i.defect_category_id || '',
          defect_detail: i.defect_detail || '',
        }));

      const fd = new FormData();
      fd.append('bill_id', billId);
      fd.append('severity', severity);
      fd.append('items', JSON.stringify(items));
      for (const f of extraImages) fd.append('images', f);

      const res = await api.post('/ncr', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      return res.data;
    },
    onSuccess: (data) => navigate(`/ncr/${data.id}`),
    onError: (err) => setError(err.response?.data?.error || err.message || 'เกิดข้อผิดพลาด'),
  });

  const selectedItems = failedItems.filter(i => selectedIds.has(i.id));

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">ออกเอกสาร {severity === 'minor' ? 'NCP' : 'NCR'}</h1>
      </div>

      <form onSubmit={e => { e.preventDefault(); setError(''); create.mutate(); }} className="space-y-4 max-w-4xl">
        {error && <div className="text-danger text-small bg-red-50 dark:bg-red-900 px-3 py-2 rounded">{error}</div>}

        <div className="card space-y-3">
          <div>
            <label className="label">อ้างอิงบิล *</label>
            <SearchableSelect
              options={bills.map(b => ({ value: b.id, label: `${b.invoice_no} — ${b.po_no} (${b.supplier_name})` }))}
              value={billId}
              onChange={v => { setBillId(v); setSelectedIds(new Set()); }}
              placeholder="ค้นหา Invoice / PO / Supplier..."
              required
            />
          </div>

          <div>
            <label className="label">ระดับความรุนแรง *</label>
            <div className="flex gap-4">
              {['major', 'minor'].map(s => (
                <label key={s} className="flex items-center gap-2 cursor-pointer min-h-[44px]">
                  <input type="radio" name="severity" value={s} checked={severity === s} onChange={() => setSeverity(s)} />
                  <span className={`badge ${s === 'major' ? 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200' : 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-200'}`}>
                    {s === 'major' ? 'Major — NCR' : 'Minor — NCP'}
                  </span>
                </label>
              ))}
            </div>
            {severity === 'minor' && (
              <div className="mt-2 bg-yellow-50 dark:bg-yellow-900 border border-yellow-200 dark:border-yellow-700 rounded px-3 py-2 text-small text-yellow-800 dark:text-yellow-200">
                <span className="font-medium">NCP (Non-Conformance Product)</span> — บันทึกภายใน ไม่ส่ง Supplier<br />
                ปัญหาไม่กระทบกระบวนการผลิตโดยตรง QC Supervisor อนุมัติปิดได้ทันที<br />
                รหัสเอกสารจะเป็น NCP-{new Date().getFullYear()}-XXXX
              </div>
            )}
          </div>
        </div>

        {billId && (
          <div className="card">
            <h2 className="text-h3 font-semibold text-primary mb-1">รายการที่ไม่ผ่านการตรวจ</h2>
            <p className="text-small text-muted mb-3">ข้อมูลทั้งหมดดึงจากบิลรับเข้าโดยอัตโนมัติ</p>

            {failedItems.length === 0 && (
              <div className="text-muted text-small py-4 text-center">
                {billItems.length === 0 ? 'กำลังโหลด...' : 'ไม่มีรายการที่ไม่ผ่านการตรวจ หรือทุกรายการมี NCR แล้ว'}
              </div>
            )}

            <div className="space-y-3">
              {failedItems.map(item => {
                const selected = selectedIds.has(item.id);
                return (
                  <div key={item.id}
                    className={`border rounded-lg overflow-hidden transition-colors ${selected ? 'border-primary' : 'border-border'}`}>

                    {/* Header row — checkbox + ชื่อ + qty */}
                    <label className={`flex items-start gap-3 p-3 cursor-pointer ${selected ? 'bg-blue-50 dark:bg-blue-900' : 'bg-surface hover:bg-bg'}`}>
                      <input type="checkbox" className="mt-0.5 min-w-[18px]" checked={selected} onChange={() => toggleItem(item.id)} />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-body">{item.product_name || item.product_code || item.item_name}</div>
                        {item.product_group_name && (
                          <div className="text-small text-muted">{item.product_group_name}</div>
                        )}
                        {/* qty summary */}
                        <div className="flex flex-wrap gap-3 mt-1.5">
                          <span className="text-small text-muted">รับเข้า: <span className="font-mono font-medium text-text">{item.qty_received}</span></span>
                          <span className="text-small text-muted">สุ่มตรวจ: <span className="font-mono font-medium text-text">{item.qty_sampled}</span></span>
                          <span className="text-small text-muted">ไม่ผ่าน: <span className="font-mono font-bold text-danger">{item.qty_failed}</span></span>
                        </div>
                      </div>
                    </label>

                    {/* Detail — แสดงเมื่อเลือก */}
                    {selected && (
                      <div className="border-t border-border bg-red-50 dark:bg-red-900 p-3 space-y-2">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-small">
                          <div>
                            <span className="text-muted">กลุ่มปัญหา: </span>
                            <span className="font-medium">{item.defect_category_name || '—'}</span>
                          </div>
                          <div>
                            <span className="text-muted">รายละเอียด: </span>
                            <span>{item.defect_detail || '—'}</span>
                          </div>
                        </div>

                        {item.images?.length > 0 && (
                          <div>
                            <div className="text-small text-muted mb-1">รูปภาพปัญหา ({item.images.length} รูป)</div>
                            <div className="flex flex-wrap gap-2">
                              {item.images.map(img => (
                                <a key={img.id} href={`/uploads/bill-items/${img.file_path}`} target="_blank" rel="noreferrer">
                                  <img
                                    src={`/uploads/bill-items/${img.file_path}`}
                                    alt=""
                                    className="h-16 w-16 object-cover rounded border border-red-200 dark:border-red-700 hover:opacity-80"
                                  />
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* รูปเพิ่มเติม (ถ้ามี) */}
        <div className="card space-y-2">
          <label className="label">รูปภาพเพิ่มเติม (ถ้ามี)</label>
          <ImageUploadPair onChange={e => setExtraImages(prev => [...prev, ...Array.from(e.target.files)])} />
          {extraImages.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-1">
              {extraImages.map((f, i) => (
                <div key={i} className="relative">
                  <img src={URL.createObjectURL(f)} alt="" className="h-20 w-20 object-cover rounded border border-border" />
                  <button type="button"
                    onClick={() => setExtraImages(prev => prev.filter((_, j) => j !== i))}
                    className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-danger text-white text-[12px] flex items-center justify-center shadow">
                    x
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={() => navigate(-1)}>ยกเลิก</Button>
          <Button
            type="submit"
            loading={create.isPending}
            disabled={selectedIds.size === 0}
          >
            {severity === 'minor' ? 'ออกเอกสาร NCP' : 'ส่งอนุมัติ NCR'} ({selectedIds.size} รายการ)
          </Button>
        </div>
      </form>
    </div>
  );
}
