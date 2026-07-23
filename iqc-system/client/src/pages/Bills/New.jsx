import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../utils/api';
import Button from '../../components/UI/Button';
import SearchableSelect from '../../components/UI/SearchableSelect';
import ImageUploadPair from '../../components/UI/ImageUploadPair';

// ย่อขนาดรูปก่อน upload — รองรับรูปจากกล้องมือถือที่ใหญ่กว่า 10MB
async function compressImage(file, maxPx = 2000, quality = 0.85) {
  if (!file.type.startsWith('image/') || file.size < 500 * 1024) return file; // ข้ามถ้าเล็กกว่า 500KB
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxPx || height > maxPx) {
          const ratio = Math.min(maxPx / width, maxPx / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          const name = file.name.replace(/\.[^.]+$/, '.jpg');
          resolve(new File([blob], name, { type: 'image/jpeg' }));
        }, 'image/jpeg', quality);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function Step1({ form, setForm, onNext, billId, setBillId, existingImages, editId }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [images, setImages] = useState([]);
  const [existingImgs, setExistingImgs] = useState(existingImages || []);
  const queryClient = useQueryClient();
  const { data: suppliersRes } = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get('/master/suppliers').then(r => r.data) });
  const suppliers = Array.isArray(suppliersRes) ? suppliersRes : (suppliersRes?.data ?? []);

  const invoiceRef = useRef(null);
  const poRef = useRef(null);
  const containerRef = useRef(null);
  const trackingRef = useRef(null);
  const dateRef = useRef(null);

  function focusNext(e, nextRef) {
    if (e.key === 'Enter') {
      e.preventDefault();
      nextRef?.current?.focus();
    }
  }

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  async function handleDeleteExistingImg(imgId) {
    try {
      await api.delete(`/bills/${billId}/images/${imgId}`);
      setExistingImgs(prev => prev.filter(img => img.id !== imgId));
      if (editId) queryClient.invalidateQueries({ queryKey: ['bill-edit', editId] });
    } catch (e) {
      setError(e.response?.data?.error || 'ลบรูปไม่สำเร็จ');
    }
  }

  async function handleNext(e) {
    e.preventDefault();
    setError('');
    if (!images.length && !existingImgs.length) {
      setError('กรุณาถ่ายรูปหรืออัปโหลดรูปถ่ายบิลอย่างน้อย 1 รูป');
      return;
    }
    setLoading(true);
    try {
      let id = billId;
      if (!id) {
        const res = await api.post('/bills', form);
        id = res.data.id;
        setBillId(id);
      } else {
        await api.patch(`/bills/${id}`, form);
      }
      if (images.length) {
        const compressed = await Promise.all(images.map(f => compressImage(f)));
        const fd = new FormData();
        for (const f of compressed) fd.append('images', f);
        await api.post(`/bills/${id}/images`, fd);
      }
      onNext(id);
    } catch (err) {
      setError(err.response?.data?.error || 'เกิดข้อผิดพลาด');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleNext} className="space-y-4 max-w-xl">
      {error && <div className="text-danger text-small bg-red-50 dark:bg-red-900 px-3 py-2 rounded">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label">Invoice No. *</label><input ref={invoiceRef} className="input font-mono" value={form.invoice_no} onChange={e => set('invoice_no', e.target.value)} required enterKeyHint="next" onKeyDown={e => focusNext(e, poRef)} /></div>
        <div><label className="label">PO No. *</label><input ref={poRef} className="input font-mono" value={form.po_no} onChange={e => set('po_no', e.target.value)} required enterKeyHint="next" onKeyDown={e => focusNext(e, containerRef)} /></div>
        <div><label className="label">Container No.</label><input ref={containerRef} className="input" value={form.container_no} onChange={e => set('container_no', e.target.value)} enterKeyHint="next" onKeyDown={e => focusNext(e, trackingRef)} /></div>
        <div><label className="label">Tracking No.</label><input ref={trackingRef} className="input" value={form.tracking_no} onChange={e => set('tracking_no', e.target.value)} enterKeyHint="next" onKeyDown={e => focusNext(e, dateRef)} /></div>
      </div>
      <div><label className="label">วันที่รับเข้า *</label><input ref={dateRef} type="date" className="input" value={form.received_date} onChange={e => set('received_date', e.target.value)} required enterKeyHint="done" /></div>
      <div>
        <label className="label">Supplier *</label>
        <SearchableSelect
          options={suppliers.map(s => ({ value: s.id, label: s.name }))}
          value={form.supplier_id}
          onChange={v => set('supplier_id', v)}
          placeholder="ค้นหา Supplier..."
          required
        />
      </div>

      {/* รูปภาพที่อัปโหลดแล้ว (edit mode / กลับมาจาก step 2) */}
      {existingImgs.length > 0 && (
        <div>
          <label className="label">รูปถ่ายบิลเดิม</label>
          <div className="flex flex-wrap gap-2">
            {existingImgs.map(img => (
              <div key={img.id} className="relative">
                <a href={`/uploads/bills/${img.file_path}`} target="_blank" rel="noreferrer">
                  <img src={`/uploads/bills/${img.file_path}`} alt="" className="h-20 w-20 object-cover rounded border border-border hover:opacity-80" />
                </a>
                <button
                  type="button"
                  onClick={() => handleDeleteExistingImg(img.id)}
                  className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-danger text-white text-[12px] flex items-center justify-center shadow"
                >×</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className="label">
          {existingImgs.length > 0
            ? 'เพิ่มรูปถ่ายบิล'
            : <><span className="text-danger">*</span> รูปถ่ายบิล <span className="text-muted font-normal text-[12px]">(ถ่ายรูปหรือเลือกไฟล์)</span></>}
        </label>
        <div className="flex gap-2">
          <label className="flex-1 flex items-center justify-center gap-2 border border-border rounded-lg min-h-[44px] cursor-pointer bg-surface hover:bg-bg text-small text-text">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            ถ่ายรูป
            <input type="file" multiple accept="image/*" capture="environment" className="hidden"
              onChange={e => setImages(prev => [...prev, ...Array.from(e.target.files)])} />
          </label>
          <label className="flex-1 flex items-center justify-center gap-2 border border-border rounded-lg min-h-[44px] cursor-pointer bg-surface hover:bg-bg text-small text-text">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            คลังภาพ
            <input type="file" multiple accept="image/*" className="hidden"
              onChange={e => setImages(prev => [...prev, ...Array.from(e.target.files)])} />
          </label>
        </div>
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {images.map((f, i) => (
              <div key={i} className="relative">
                <img src={URL.createObjectURL(f)} alt={f.name}
                  className="h-20 w-20 object-cover rounded border border-border" />
                <button
                  type="button"
                  onClick={() => setImages(prev => prev.filter((_, j) => j !== i))}
                  className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-danger text-white text-[12px] flex items-center justify-center shadow"
                >×</button>
                <div className="text-[12px] text-muted mt-0.5 w-20 truncate">{f.name}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex justify-end">
        <Button type="submit" loading={loading}>ถัดไป &rarr;</Button>
      </div>
    </form>
  );
}

function ItemRow({ item, index, products, defectCategories, onChange, onDelete, onUploadImages, onUploadDocs, onDeleteExistingDoc, onDeleteExistingImage, usedProductIds }) {
  const [qualityImgs, setQualityImgs] = useState([]);
  const [showQuality, setShowQuality] = useState(false);

  const expanded = Number(item.qty_failed) > 0;
  const product = products.find(p => p.id === parseInt(item.product_id));
  const requireDoc = product?.require_inspection_doc;

  // Exclude products already selected in other rows (keep own selection visible)
  const availableProducts = products.filter(p =>
    !usedProductIds?.includes(p.id) || String(p.id) === String(item.product_id)
  );

  async function autoFillSampled(productId, qty) {
    if (!productId || !qty || Number(qty) <= 0) return;
    try {
      const { data } = await api.get('/master/aql/lookup', { params: { product_id: productId, qty } });
      if (data.sample_size != null) {
        onChange('qty_sampled', data.sample_size);
        const passed = parseInt(item.qty_passed || 0);
        if (passed > 0) onChange('qty_failed', Math.max(0, data.sample_size - passed));
      }
    } catch {}
  }

  function handleProductChange(val) {
    const p = products.find(pr => pr.id === parseInt(val));
    onChange('product_id', val);
    if (p) onChange('item_name', p.name);
    autoFillSampled(val, item.qty_received);
  }

  function handleQtyReceivedChange(val) {
    onChange('qty_received', val);
    autoFillSampled(item.product_id, val);
  }

  function handleQtyPassedChange(val) {
    const passed = parseInt(val || 0);
    const sampled = parseInt(item.qty_sampled || 0);
    onChange('qty_passed', val);
    onChange('qty_failed', Math.max(0, sampled - passed));
  }

  async function viewQualityImages() {
    if (!item.product_id) return;
    try {
      const { data } = await api.get(`/master/products/${item.product_id}/images`, { params: { image_type: 'quality_issue' } });
      setQualityImgs(data);
      setShowQuality(true);
    } catch {}
  }

  // Inspection docs JSX (shared between mobile/desktop)
  const docsSection = requireDoc ? (() => {
    const newDocs = item.docs_files ?? [];
    const existingDocs = (item.inspection_docs ?? []).filter(d => typeof d === 'object' && d.file_path);
    const totalCount = newDocs.length + existingDocs.length;
    const hasAny = totalCount > 0;
    return (
      <div className="space-y-1">
        <label className={`w-full text-center text-[12px] py-1 rounded cursor-pointer border min-h-[44px] flex items-center justify-center gap-1 ${hasAny ? 'bg-green-50 dark:bg-green-900 border-success text-success' : 'bg-orange-50 dark:bg-orange-900 border-warning text-warning'}`}>
          {hasAny ? `แนบแล้ว (${totalCount})` : 'แนบเอกสารตรวจ'}
          <input type="file" className="hidden" multiple accept=".pdf,image/*" onChange={e => onUploadDocs(index, Array.from(e.target.files))} />
        </label>
        {newDocs.map((f, fi) => (
          <div key={`new-${fi}`} className="flex items-center gap-1 bg-green-50 dark:bg-green-900 border border-success rounded px-1.5 py-1">
            <svg className="w-3 h-3 text-success shrink-0" fill="currentColor" viewBox="0 0 20 20"><path d="M4 18h12V6l-4-4H4v16zm8-14 2 2h-2V4z"/></svg>
            <span className="text-[12px] text-success truncate">{f.name}</span>
          </div>
        ))}
        {existingDocs.map((doc, di) => (
          <div key={`ex-${di}`} className="flex items-center gap-1 bg-green-50 dark:bg-green-900 border border-success rounded px-1.5 py-1">
            <a href={`/uploads/inspection-docs/${doc.file_path}`} target="_blank" rel="noreferrer"
              className="flex items-center gap-1 flex-1 min-w-0">
              <svg className="w-3 h-3 text-success shrink-0" fill="currentColor" viewBox="0 0 20 20"><path d="M4 18h12V6l-4-4H4v16zm8-14 2 2h-2V4z"/></svg>
              <span className="text-[12px] text-success truncate">{doc.original_name || doc.file_path}</span>
            </a>
            {onDeleteExistingDoc && (
              <button type="button" onClick={() => onDeleteExistingDoc(index, doc.id)}
                className="w-5 h-5 rounded-full bg-danger text-white text-[11px] flex items-center justify-center shrink-0 hover:bg-red-700">
                ×
              </button>
            )}
          </div>
        ))}
      </div>
    );
  })() : null;

  // Drawing + quality images links (shared)
  const productLinks = (product?.current_drawing || product?.quality_img_count > 0) && (
    <div className="flex flex-wrap gap-2 mt-1">
      {product?.current_drawing && (
        <a href={`/api/master/products/${product.id}/drawing`} target="_blank" rel="noreferrer"
          className="text-red-600 dark:text-red-200 text-[12px] hover:underline flex items-center gap-0.5">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M4 18h12V6l-4-4H4v16zm8-14l2 2h-2V4z" /></svg>
          Drawing
        </a>
      )}
      {product?.quality_img_count > 0 && (
        <button type="button" onClick={viewQualityImages}
          className="text-warning text-[12px] hover:underline flex items-center gap-0.5">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          รูปงานเสีย
        </button>
      )}
    </div>
  );

  // Defect detail section (shared between mobile/desktop)
  const defectSection = expanded && (
    <div className="bg-red-50 dark:bg-red-900 border-t border-red-200 dark:border-red-700 p-3 space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label text-danger">กลุ่มปัญหา *</label>
          <select className="input border-danger" value={item.defect_category_id || ''} onChange={e => onChange('defect_category_id', e.target.value)}>
            <option value="">เลือกกลุ่มปัญหา</option>
            {defectCategories.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">รูปภาพปัญหา *</label>
          <ImageUploadPair variant="danger" onChange={e => onUploadImages(index, Array.from(e.target.files))} />
          {item.images_files?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {item.images_files.map((f, fi) => (
                <div key={fi} className="relative group">
                  <img src={URL.createObjectURL(f)} alt={f.name} className="h-14 w-14 object-cover rounded border border-red-200 dark:border-red-700" />
                  <div className="text-[12px] text-muted w-14 truncate leading-tight">{f.name}</div>
                </div>
              ))}
            </div>
          )}
          {item.images?.length > 0 && typeof item.images[0] === 'object' && item.images[0].file_path && (
            <div className="flex flex-wrap gap-1 mt-1">
              {item.images.map(img => (
                <div key={img.id} className="relative group">
                  <a href={`/uploads/bill-items/${img.file_path}`} target="_blank" rel="noreferrer">
                    <img src={`/uploads/bill-items/${img.file_path}`} alt="" className="h-14 w-14 object-cover rounded border border-red-200 dark:border-red-700 hover:opacity-80" />
                  </a>
                  {onDeleteExistingImage && (
                    <button type="button" onClick={() => onDeleteExistingImage(index, img.id)}
                      className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-danger text-white text-[12px] items-center justify-center hidden group-hover:flex shadow">
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div>
        <label className="label text-danger">รายละเอียดปัญหา *</label>
        <textarea className="input border-danger" rows={2} value={item.defect_detail || ''} onChange={e => onChange('defect_detail', e.target.value)} />
      </div>
    </div>
  );

  return (
    <div className={`border rounded-lg overflow-hidden mb-2 ${expanded ? 'border-danger' : 'border-border'}`}>

      {/* ── MOBILE LAYOUT (< 640px) ── */}
      <div className={`sm:hidden p-3 space-y-3 ${expanded ? 'bg-red-50 dark:bg-red-900' : 'bg-surface'}`}>
        <div className="flex items-center justify-between">
          <span className="text-small font-semibold text-primary">รายการที่ {index + 1}</span>
          <button type="button" onClick={() => onDelete(index)}
            className="w-9 h-9 flex items-center justify-center text-muted hover:text-danger rounded">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div>
          <label className="label">สินค้า *</label>
          <SearchableSelect
            wrap
            options={availableProducts.map(p => ({ value: p.id, label: p.code ? `[${p.code}] ${p.name}` : p.name }))}
            value={item.product_id || ''}
            onChange={handleProductChange}
            placeholder="เลือกสินค้า"
          />
          {productLinks}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">รับเข้า</label>
            <input type="number" inputMode="numeric" min="0" className="input"
              value={Number(item.qty_received) === 0 ? '' : item.qty_received}
              onChange={e => handleQtyReceivedChange(e.target.value)}
              onFocus={e => e.target.select()} />
          </div>
          <div>
            <label className="label">สุ่มตรวจ (AQL)</label>
            <input type="number" inputMode="numeric" min="0" className="input bg-blue-50 dark:bg-blue-900"
              value={item.qty_sampled}
              onChange={e => onChange('qty_sampled', e.target.value)}
              onFocus={e => e.target.select()} />
          </div>
          <div>
            <label className="label">ผ่าน</label>
            <input type="number" inputMode="numeric" min="0" className="input border-success"
              value={Number(item.qty_passed) === 0 ? '' : item.qty_passed}
              onChange={e => handleQtyPassedChange(e.target.value)}
              onFocus={e => e.target.select()} />
          </div>
          <div>
            <label className="label">ไม่ผ่าน</label>
            <input type="number" inputMode="numeric" min="0"
              className={`input ${expanded ? 'border-danger bg-red-100 dark:bg-red-900 text-danger font-bold' : ''}`}
              value={item.qty_failed} readOnly />
          </div>
        </div>
        {requireDoc && docsSection}
      </div>

      {/* ── DESKTOP LAYOUT (≥ 640px) ── */}
      <div className={`hidden sm:grid grid-cols-12 gap-2 p-3 items-start ${expanded ? 'bg-red-50 dark:bg-red-900' : 'bg-surface'}`}>
        <div className="col-span-1 text-muted text-small pt-2">{index + 1}</div>
        <div className="col-span-3">
          <SearchableSelect
            wrap
            options={availableProducts.map(p => ({ value: p.id, label: p.code ? `[${p.code}] ${p.name}` : p.name }))}
            value={item.product_id || ''}
            onChange={handleProductChange}
            placeholder="เลือกสินค้า"
          />
          {productLinks}
        </div>
        <div className="col-span-2">
          <input placeholder="รับเข้า" type="number" min="0" className="input py-1 min-h-[40px]"
            value={Number(item.qty_received) === 0 ? '' : item.qty_received}
            onChange={e => handleQtyReceivedChange(e.target.value)}
            onFocus={e => e.target.select()} />
        </div>
        <div className="col-span-1">
          <input placeholder="สุ่ม" type="number" min="0" className="input py-1 min-h-[40px] bg-blue-50 dark:bg-blue-900"
            value={item.qty_sampled}
            onChange={e => onChange('qty_sampled', e.target.value)}
            onFocus={e => e.target.select()} />
        </div>
        <div className="col-span-1">
          <input placeholder="ผ่าน" type="number" min="0" className="input py-1 min-h-[40px] border-success"
            value={Number(item.qty_passed) === 0 ? '' : item.qty_passed}
            onChange={e => handleQtyPassedChange(e.target.value)}
            onFocus={e => e.target.select()} />
        </div>
        <div className="col-span-1">
          <input placeholder="ไม่ผ่าน" type="number" min="0"
            className={`input py-1 min-h-[40px] ${expanded ? 'border-danger bg-red-50 dark:bg-red-900 text-danger' : ''}`}
            value={item.qty_failed} readOnly />
        </div>
        <div className="col-span-2">{docsSection}</div>
        <div className="col-span-1 flex justify-end pt-1">
          <button type="button" onClick={() => onDelete(index)} className="text-muted hover:text-danger min-h-[44px] min-w-[44px] flex items-center justify-center">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      </div>

      {defectSection}

      {/* Quality Images Modal */}
      {showQuality && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setShowQuality(false)}>
          <div className="bg-surface rounded-xl shadow-xl max-w-lg w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border sticky top-0 bg-surface">
              <h3 className="font-semibold text-text text-small">รูปงานเสีย — {product?.name}</h3>
              <button type="button" onClick={() => setShowQuality(false)} className="w-8 h-8 flex items-center justify-center text-muted hover:text-text rounded">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="p-4">
              {qualityImgs.length === 0
                ? <p className="text-muted text-small text-center py-4">ไม่พบรูปงานเสีย</p>
                : (
                  <div className="grid grid-cols-2 gap-3">
                    {qualityImgs.map(img => (
                      <a key={img.id} href={`/uploads/general/${img.file_path}`} target="_blank" rel="noreferrer">
                        <img src={`/uploads/general/${img.file_path}`} alt={img.original_name}
                          className="w-full aspect-square object-cover rounded border border-border hover:opacity-80" />
                      </a>
                    ))}
                  </div>
                )
              }
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BillInfoBar({ form, supplierName, billId }) {
  const [lightbox, setLightbox] = useState(null); // url ของรูปที่เปิด

  const { data: billData } = useQuery({
    queryKey: ['bill-step2-preview', billId],
    queryFn: () => api.get(`/bills/${billId}`).then(r => r.data),
    enabled: !!billId,
  });
  const billImages = billData?.images ?? [];

  if (!form) return null;
  const fields = [
    { label: 'Supplier',      value: supplierName,       mono: false },
    { label: 'Invoice No.',   value: form.invoice_no,    mono: true  },
    { label: 'PO No.',        value: form.po_no,         mono: true  },
    { label: 'วันที่รับเข้า', value: form.received_date, mono: false },
    { label: 'Container No.', value: form.container_no,  mono: true  },
    { label: 'Tracking No.',  value: form.tracking_no,   mono: true  },
  ].filter(f => f.value);

  return (
    <>
      <div className="bg-[#F0F5FA] dark:bg-blue-900 border border-[#B8D0E8] dark:border-blue-700 rounded-lg px-4 py-3 mb-5">
        <p className="text-[12px] font-semibold text-primary uppercase tracking-wide mb-2">ข้อมูลบิล (หน้าที่ 1)</p>
        <div className="flex flex-wrap gap-x-6 gap-y-1.5">
          {fields.map(f => (
            <div key={f.label} className="flex items-center gap-1.5 text-small">
              <span className="text-muted">{f.label}:</span>
              <span className={`font-medium text-text ${f.mono ? 'font-mono' : ''}`}>{f.value}</span>
            </div>
          ))}
        </div>

        {/* รูปถ่ายบิล */}
        {billImages.length > 0 && (
          <div className="mt-3 pt-3 border-t border-[#B8D0E8] dark:border-blue-700">
            <p className="text-[12px] text-primary font-medium mb-2">รูปถ่ายบิล ({billImages.length} รูป)</p>
            <div className="flex flex-wrap gap-2">
              {billImages.map(img => {
                const url = `/uploads/bills/${img.file_path}`;
                return (
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => setLightbox(url)}
                    className="relative group flex-shrink-0"
                    title="คลิกเพื่อดูรูปขนาดใหญ่"
                  >
                    <img
                      src={url}
                      alt=""
                      className="h-16 w-16 object-cover rounded border border-[#B8D0E8] dark:border-blue-700 group-hover:opacity-80 transition-opacity"
                    />
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <svg className="w-5 h-5 text-white drop-shadow" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                      </svg>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox}
            alt=""
            className="max-h-[90vh] max-w-[90vw] object-contain rounded shadow-xl"
            onClick={e => e.stopPropagation()}
          />
          <button
            type="button"
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 w-9 h-9 bg-white/20 hover:bg-white/40 rounded-full flex items-center justify-center text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </>
  );
}

function Step2({ billId, navigate, initialItems, form, supplierName, onBack }) {
  const [items, setItems] = useState([]);
  const [deletedItemIds, setDeletedItemIds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [initialized, setInitialized] = useState(false);

  const supplierId = form?.supplier_id;
  const { data: productsRes } = useQuery({
    queryKey: ['products', supplierId],
    queryFn: () => api.get('/master/products', { params: { supplier_id: supplierId } }).then(r => r.data),
    enabled: !!supplierId,
  });
  const { data: defectCatsRes } = useQuery({ queryKey: ['defect-categories'], queryFn: () => api.get('/master/defect-categories').then(r => r.data) });
  const products = Array.isArray(productsRes) ? productsRes : (productsRes?.data ?? []);
  const defectCategories = Array.isArray(defectCatsRes) ? defectCatsRes : (defectCatsRes?.data ?? []);

  // โหลดรายการเดิม (edit mode)
  useEffect(() => {
    if (!initialized && initialItems?.length > 0) {
      setItems(initialItems.map(item => ({
        _id: item.id,
        product_id: item.product_id,
        item_name: item.product_name || item.item_name,
        qty_received: item.qty_received,
        qty_sampled: item.qty_sampled,
        qty_passed: item.qty_passed,
        qty_failed: item.qty_failed,
        defect_category_id: item.defect_category_id ?? '',
        defect_detail: item.defect_detail ?? '',
        images: item.images ?? [],
        inspection_docs: item.inspection_docs ?? [],
        images_files: [],
        docs_files: [],
      })));
      setInitialized(true);
    }
  }, [initialItems, initialized]);

  function addItem() {
    setItems(p => [...p, {
      product_id: '', item_name: '', qty_received: 0, qty_sampled: 0,
      qty_passed: 0, qty_failed: 0, defect_category_id: '', defect_detail: '',
      images: [], inspection_docs: [], images_files: [], docs_files: [],
    }]);
  }

  function updateItem(idx, key, val) {
    setItems(p => p.map((item, i) => i === idx ? { ...item, [key]: val } : item));
  }

  function deleteItem(idx) {
    const item = items[idx];
    if (item._id) setDeletedItemIds(prev => [...prev, item._id]);
    setItems(p => p.filter((_, i) => i !== idx));
  }

  async function handleDeleteExistingDoc(idx, docId) {
    const item = items[idx];
    if (!item._id) return;
    try {
      await api.delete(`/bills/${billId}/items/${item._id}/inspection-docs/${docId}`);
      setItems(p => p.map((it, i) => i === idx
        ? { ...it, inspection_docs: it.inspection_docs.filter(d => d.id !== docId) }
        : it
      ));
    } catch (e) {
      setError(e.response?.data?.error || 'ลบเอกสารไม่สำเร็จ');
    }
  }

  async function handleDeleteExistingImage(idx, imageId) {
    const item = items[idx];
    if (!item._id) return;
    try {
      await api.delete(`/bills/${billId}/items/${item._id}/images/${imageId}`);
      setItems(p => p.map((it, i) => i === idx
        ? { ...it, images: it.images.filter(img => img.id !== imageId) }
        : it
      ));
    } catch (e) {
      setError(e.response?.data?.error || 'ลบรูปภาพไม่สำเร็จ');
    }
  }

  async function handleItemImageStage(idx, files) {
    const compressed = await Promise.all(files.map(f => compressImage(f)));
    setItems(p => p.map((item, i) => i === idx ? { ...item, images_files: compressed } : item));
  }

  function handleItemDocStage(idx, files) {
    setItems(p => p.map((item, i) => i === idx ? { ...item, docs_files: files } : item));
  }

  async function handleSave() {
    setError('');

    // Client-side validation ก่อน API call
    for (const [i, item] of items.entries()) {
      const label = `แถวที่ ${i + 1} (${item.item_name || 'ยังไม่เลือกสินค้า'})`;
      if (!item.item_name) { setError(`${label}: กรุณาเลือกสินค้า`); return; }
      if (Number(item.qty_failed) > 0) {
        if (!item.defect_category_id) { setError(`${label}: ยังไม่เลือกกลุ่มปัญหา`); return; }
        if (!item.defect_detail?.trim()) { setError(`${label}: ยังไม่กรอกรายละเอียดปัญหา`); return; }
        const hasExistingImages = item.images?.length > 0 && typeof item.images[0] === 'object';
        if (!item.images_files?.length && !hasExistingImages) { setError(`${label}: ยังไม่มีรูปภาพปัญหา`); return; }
      }
    }

    setLoading(true);
    try {
      // ลบแถวที่ user ลบออกจาก server ก่อน
      for (const deletedId of deletedItemIds) {
        await api.delete(`/bills/${billId}/items/${deletedId}`);
      }
      setDeletedItemIds([]);

      const savedIds = [];
      for (const item of items) {
        const { images_files, docs_files, images, inspection_docs, _id, ...itemData } = item;
        let itemId = _id;

        if (!itemId) {
          const res = await api.post(`/bills/${billId}/items`, itemData);
          itemId = res.data.id;
        } else {
          await api.patch(`/bills/${billId}/items/${itemId}`, itemData);
        }

        savedIds.push(itemId);

        if (images_files?.length) {
          const fd = new FormData();
          for (const f of images_files) fd.append('images', f);
          await api.post(`/bills/${billId}/items/${itemId}/images`, fd);
        }
        if (docs_files?.length) {
          const fd = new FormData();
          for (const f of docs_files) fd.append('docs', f);
          await api.post(`/bills/${billId}/items/${itemId}/inspection-docs`, fd);
        }
      }

      setItems(prev => prev.map((item, i) => ({ ...item, _id: savedIds[i] })));

      await api.post(`/bills/${billId}/submit`);
      navigate(`/bills/${billId}`);
    } catch (err) {
      setError(err.response?.data?.error || 'เกิดข้อผิดพลาด');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <BillInfoBar form={form} supplierName={supplierName} billId={billId} />
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-h3 font-semibold text-primary">รายการสินค้า</h2>
        <Button variant="secondary" onClick={addItem}>+ เพิ่มรายการ</Button>
      </div>

      <div className="hidden sm:grid grid-cols-12 gap-2 px-3 py-2 text-small font-medium text-muted bg-bg rounded-t mb-1">
        <div className="col-span-1">#</div>
        <div className="col-span-3">สินค้า</div>
        <div className="col-span-2">รับเข้า</div>
        <div className="col-span-1">สุ่มตรวจ</div>
        <div className="col-span-1">ผ่าน</div>
        <div className="col-span-1">ไม่ผ่าน</div>
        <div className="col-span-2">เอกสาร</div>
        <div className="col-span-1"></div>
      </div>

      {items.length === 0 && <div className="text-center py-8 text-muted border border-dashed border-border rounded-lg">กด "+ เพิ่มรายการ" เพื่อเพิ่มสินค้า</div>}

      {items.map((item, idx) => {
        const usedProductIds = items
          .filter((_, i) => i !== idx)
          .map(it => parseInt(it.product_id))
          .filter(Boolean);
        return (
          <ItemRow
            key={idx}
            item={item}
            index={idx}
            products={products}
            defectCategories={defectCategories}
            onChange={(k, v) => updateItem(idx, k, v)}
            onDelete={() => deleteItem(idx)}
            onUploadImages={(i, files) => handleItemImageStage(i, files)}
            onUploadDocs={(i, files) => handleItemDocStage(i, files)}
            onDeleteExistingDoc={item._id ? handleDeleteExistingDoc : null}
            onDeleteExistingImage={item._id ? handleDeleteExistingImage : null}
            usedProductIds={usedProductIds}
          />
        );
      })}

      {error && <div className="text-danger text-small bg-red-50 dark:bg-red-900 px-3 py-2 rounded mt-3">{error}</div>}

      <div className="flex items-center justify-between mt-4">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 px-4 py-2 text-small text-muted border border-border rounded-lg hover:text-text hover:border-primary hover:bg-bg transition-colors min-h-[44px]"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          กลับแก้ไขข้อมูลบิล
        </button>
        <Button onClick={handleSave} loading={loading} disabled={items.length === 0}>บันทึกบิล</Button>
      </div>
    </div>
  );
}

export default function BillNew() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('edit');

  const [step, setStep] = useState(1);
  const [billId, setBillId] = useState(editId ? parseInt(editId) : null);

  // ดึง suppliers เพื่อแสดงชื่อใน Step2 summary
  const { data: suppliersRes } = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get('/master/suppliers').then(r => r.data) });
  const suppliers = Array.isArray(suppliersRes) ? suppliersRes : (suppliersRes?.data ?? []);
  const [form, setForm] = useState({
    invoice_no: '', po_no: '', container_no: '', tracking_no: '',
    received_date: new Date().toISOString().slice(0, 10), supplier_id: '',
  });
  const [formLoaded, setFormLoaded] = useState(!editId); // ถ้าไม่ใช่ edit mode ถือว่า loaded แล้ว

  // DEVMORE M8 / CLAUDE.md 6 — Auto-draft (เฉพาะโหมดสร้างใหม่)
  const DRAFT_KEY = 'bill_draft';
  const [draftFound, setDraftFound] = useState(null);

  // ตรวจ draft ที่ยังไม่ได้บันทึก ตอนเข้าหน้า
  useEffect(() => {
    if (editId) return;
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && (d.invoice_no || d.po_no || d.supplier_id)) setDraftFound(d);
      }
    } catch {}
  }, [editId]);

  // Auto-save ทุก 30 วินาที + ก่อนปิดหน้า (หยุดเมื่อสร้างบิลแล้ว/โหมด edit)
  useEffect(() => {
    if (editId || billId) return;
    const save = () => { try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(form)); } catch {} };
    const timer = setInterval(save, 30000);
    window.addEventListener('beforeunload', save);
    return () => { clearInterval(timer); window.removeEventListener('beforeunload', save); };
  }, [form, editId, billId]);

  // โหลดข้อมูลบิลเดิม (edit mode)
  const { data: existingBill, isLoading: loadingBill } = useQuery({
    queryKey: ['bill-edit', editId],
    queryFn: () => api.get(`/bills/${editId}`).then(r => r.data),
    enabled: !!editId,
  });

  // โหลดรายการสินค้าเดิม (edit mode)
  const { data: existingItems } = useQuery({
    queryKey: ['bill-items-edit', editId],
    queryFn: () => api.get(`/bills/${editId}/items`).then(r => r.data),
    enabled: !!editId,
  });

  // เมื่อโหลดข้อมูลบิลมาแล้ว ให้ pre-fill form
  useEffect(() => {
    if (existingBill && !formLoaded) {
      setForm({
        invoice_no: existingBill.invoice_no ?? '',
        po_no: existingBill.po_no ?? '',
        container_no: existingBill.container_no ?? '',
        tracking_no: existingBill.tracking_no ?? '',
        received_date: existingBill.received_date ?? new Date().toISOString().slice(0, 10),
        supplier_id: existingBill.supplier_id ? String(existingBill.supplier_id) : '',
      });
      setFormLoaded(true);
    }
  }, [existingBill, formLoaded]);

  if (editId && loadingBill) {
    return <div className="text-muted py-12 text-center">กำลังโหลดข้อมูล...</div>;
  }

  const isEdit = !!editId;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">{isEdit ? 'แก้ไขบิล' : 'สร้างบิลใหม่'}</h1>
        <div className="flex gap-2">
          <span className={`badge ${step === 1 ? 'bg-primary text-white' : 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200'}`}>1. ข้อมูลบิล</span>
          <span className={`badge ${step === 2 ? 'bg-primary text-white' : 'bg-gray-100 dark:bg-gray-900 text-muted'}`}>2. รายการสินค้า</span>
        </div>
      </div>

      {/* S159 — หมายเหตุ QC Supervisor ตอนส่งกลับ (โชว์ค้างตอนแก้ไข จนกว่าจะกด "ส่งอนุมัติ" ใหม่) */}
      {isEdit && existingBill?.reject_comment && (
        <div className="card mb-3 bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700">
          <div className="text-small font-semibold text-danger mb-1">หัวหน้า QC ส่งกลับบิลนี้ — กรุณาแก้ไขตามหมายเหตุก่อนส่งอนุมัติใหม่</div>
          <div className="text-small text-text mt-1 bg-surface border border-red-200 dark:border-red-700 rounded px-2 py-1.5">{existingBill.reject_comment}</div>
        </div>
      )}

      {/* DEVMORE M8 — แจ้งเตือน draft ที่ยังไม่ได้บันทึก */}
      {draftFound && !isEdit && (
        <div className="card mb-3 border-l-4 border-warning bg-yellow-50 dark:bg-yellow-900 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-small text-text">พบข้อมูลบิลที่ยังกรอกค้างไว้ ต้องการกู้คืนหรือไม่?</div>
          <div className="flex gap-2">
            <button
              onClick={() => { setForm(draftFound); setDraftFound(null); }}
              className="px-3 py-2 bg-primary text-white rounded-md text-small font-medium min-h-[40px]"
            >กู้คืน</button>
            <button
              onClick={() => { sessionStorage.removeItem(DRAFT_KEY); setDraftFound(null); }}
              className="px-3 py-2 border border-border rounded-md text-small text-muted min-h-[40px]"
            >ละทิ้ง</button>
          </div>
        </div>
      )}

      <div className="card">
        {step === 1 && (
          <Step1
            form={form}
            setForm={setForm}
            billId={billId}
            setBillId={setBillId}
            existingImages={existingBill?.images}
            editId={editId}
            onNext={(id) => { setBillId(id); setStep(2); sessionStorage.removeItem(DRAFT_KEY); }}
          />
        )}
        {step === 2 && (
          <Step2
            billId={billId}
            navigate={navigate}
            initialItems={Array.isArray(existingItems) ? existingItems : (existingItems?.data ?? existingItems ?? [])}
            form={form}
            supplierName={suppliers.find(s => String(s.id) === String(form.supplier_id))?.name || ''}
            onBack={() => setStep(1)}
          />
        )}
      </div>
    </div>
  );
}
