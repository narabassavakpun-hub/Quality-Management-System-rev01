import React, { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { downloadExcel } from '../../utils/api';
import Button from '../../components/UI/Button';
import Modal from '../../components/UI/Modal';
import ConfirmDialog from '../../components/UI/ConfirmDialog';
import ImageUploadPair from '../../components/UI/ImageUploadPair';
import SortTh from '../../components/UI/SortTh';
import ToggleSwitch from '../../components/UI/ToggleSwitch';
import EditButton from '../../components/UI/EditButton';
import Pagination from '../../components/UI/Pagination';
import SearchableSelect from '../../components/UI/SearchableSelect';

const PAGE_SIZE = 20;
import { useSortable } from '../../hooks/useSortable';

const IMPORT_STATUS_CLASS = {
  error: 'bg-red-50 dark:bg-red-900', warning: 'bg-amber-50 dark:bg-amber-900', ok: '',
  update: 'bg-blue-50 dark:bg-blue-900', skip: 'bg-gray-50 dark:bg-gray-800',
  deleted: 'bg-green-50 dark:bg-green-900', // S155 — แถวที่กดลบ/ปิดใช้งานจากปุ่มใน import-error preview แล้ว
};

// ─── AQL Inspection Plan Options ───────────────────────────────────────────────
const INSPECTION_LEVELS = [
  { value: 'GEN_I',   label: 'General I' },
  { value: 'GEN_II',  label: 'General II (มาตรฐาน)' },
  { value: 'GEN_III', label: 'General III (เข้มงวด)' },
  { value: 'S1',      label: 'Special S-1 (ตัวอย่างน้อยมาก)' },
  { value: 'S2',      label: 'Special S-2' },
  { value: 'S3',      label: 'Special S-3' },
  { value: 'S4',      label: 'Special S-4 / I-S4' },
  { value: 'FULL',    label: 'ตรวจ 100% (ทุกชิ้น)' },
];

const AQL_VALUES = [
  { value: '0.65', label: 'AQL 0.65 (เข้มงวดมาก)' },
  { value: '1.0',  label: 'AQL 1.0' },
  { value: '1.5',  label: 'AQL 1.5' },
  { value: '2.5',  label: 'AQL 2.5 (มาตรฐาน)' },
  { value: '4.0',  label: 'AQL 4.0' },
  { value: '6.5',  label: 'AQL 6.5 (ผ่อนปรน)' },
];

// ─── Image Preview Strip ────────────────────────────────────────────────────────
function ImageStrip({ images, onRemove, label }) {
  if (!images.length) return null;
  return (
    <div className="mt-2">
      <p className="text-[12px] text-muted mb-1">{label} ({images.length} รูป)</p>
      <div className="flex flex-wrap gap-2">
        {images.map((img, i) => (
          <div key={i} className="relative group w-20 h-20 flex-shrink-0">
            <img
              src={img.preview || img.url}
              alt={img.name || img.original_name}
              className="w-20 h-20 object-cover rounded border border-border"
            />
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="absolute -top-1.5 -right-1.5 w-6 h-6 bg-danger text-white rounded-full text-[12px] font-bold flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow"
              >
                X
              </button>
            )}
            <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[12px] px-1 py-0.5 rounded-b truncate">
              {img.name || img.original_name}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Product Form ───────────────────────────────────────────────────────────────
function Form({ initial = {}, onSave, loading, error, onClose, onDone }) {
  const [form, setForm] = useState({
    code: '', name: '', notes: '',
    inspection_level: 'GEN_II', aql_value: '2.5',
    ...initial,
    supplier_ids:     initial.suppliers?.length
                        ? initial.suppliers.map(s => String(s.supplier_id))
                        : initial.supplier_id ? [String(initial.supplier_id)] : [],
    product_group_id: initial.product_group_id ? String(initial.product_group_id) : '',
    unit_id:          initial.unit_id          ? String(initial.unit_id)          : '',
    color_id: initial.colors?.[0] ? String(initial.colors[0].id) : '',
  });

  // Drawing
  const [drawingFile, setDrawingFile]         = useState(null);
  const [drawingRevision, setDrawingRevision] = useState('Rev.A');

  // Pending images (pre-upload) — stored as { file, preview, name }
  const [pendingProduct, setPendingProduct]   = useState([]);
  const [pendingQuality, setPendingQuality]   = useState([]);

  // Existing images (only when editing)
  const { data: existingImages = [], refetch: refetchImages } = useQuery({
    queryKey: ['product-images', initial.id],
    queryFn: () => api.get(`/master/products/${initial.id}/images`).then(r => r.data),
    enabled: !!initial.id,
  });

  const productImgs = existingImages.filter(i => (i.image_type || 'product') === 'product');
  const qualityImgs = existingImages.filter(i => i.image_type === 'quality_issue');

  const [deletingImg, setDeletingImg]         = useState(null);
  const [uploadError, setUploadError]         = useState('');
  const [uploading, setUploading]             = useState(false);

  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get('/master/suppliers').then(r => r.data) });
  const { data: groups = [] }    = useQuery({ queryKey: ['product-groups'], queryFn: () => api.get('/master/product-groups').then(r => r.data) });
  const { data: units = [] }     = useQuery({ queryKey: ['units'], queryFn: () => api.get('/master/units').then(r => r.data) });
  const { data: colors = [] }    = useQuery({ queryKey: ['colors'], queryFn: () => api.get('/master/colors').then(r => r.data) });

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  // กรอง Supplier ตามกลุ่มสินค้าที่เลือก (คำขอ user) — กรองเข้มงวด: โชว์เฉพาะ Supplier ที่ถูกตั้งกลุ่มนี้ไว้จริง
  // ที่หน้า "ผู้ผลิต" เท่านั้น (S146 รอบแรกเคยมี fallback ให้ Supplier ที่ยังไม่ตั้งกลุ่มโชว์ทุกกลุ่ม แต่ user
  // feedback ว่าเลือกกลุ่มแล้วดูเหมือนไม่กรองเลย เพราะ Supplier ส่วนใหญ่ยังไม่ถูกตั้งกลุ่ม — ตัดออกแล้ว)
  const filteredSuppliers = form.product_group_id
    ? suppliers.filter(s => (s.product_group_ids || []).map(String).includes(String(form.product_group_id)))
    : suppliers;
  const filteredSupplierIds = filteredSuppliers.map(s => String(s.id));
  const allFilteredSuppliersSelected = filteredSupplierIds.length > 0 && filteredSupplierIds.every(id => form.supplier_ids.includes(id));

  function selectColor(cid) {
    const id = String(cid);
    setForm(p => ({ ...p, color_id: p.color_id === id ? '' : id }));
  }

  function addPendingFiles(files, type) {
    const arr = Array.from(files).map(f => ({ file: f, preview: URL.createObjectURL(f), name: f.name }));
    if (type === 'product') setPendingProduct(p => [...p, ...arr]);
    else setPendingQuality(p => [...p, ...arr]);
  }

  function removePending(i, type) {
    if (type === 'product') {
      setPendingProduct(p => { URL.revokeObjectURL(p[i].preview); return p.filter((_, idx) => idx !== i); });
    } else {
      setPendingQuality(p => { URL.revokeObjectURL(p[i].preview); return p.filter((_, idx) => idx !== i); });
    }
  }

  // Cleanup object URLs on unmount
  useEffect(() => () => {
    pendingProduct.forEach(i => URL.revokeObjectURL(i.preview));
    pendingQuality.forEach(i => URL.revokeObjectURL(i.preview));
  }, []);

  async function uploadImages(productId, items, imageType) {
    if (!items.length) return;
    const fd = new FormData();
    items.forEach(i => fd.append('images', i.file));
    await api.post(`/master/products/${productId}/images`, fd, { params: { image_type: imageType } });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setUploadError('');
    setUploading(true);
    try {
      if (!form.supplier_ids?.length) { setUploadError('กรุณาเลือก Supplier อย่างน้อย 1'); setUploading(false); return; }
      const payload = { ...form, color_ids: form.color_id ? [form.color_id] : [] };
      const saved = await onSave(payload);
      if (!saved?.id) return;

      await uploadImages(saved.id, pendingProduct, 'product');
      await uploadImages(saved.id, pendingQuality, 'quality_issue');

      if (drawingFile) {
        const fd = new FormData();
        fd.append('drawing', drawingFile);
        fd.append('revision', drawingRevision || 'Rev.A');
        fd.append('effective_date', new Date().toISOString().slice(0, 10));
        await api.post(`/master/products/${saved.id}/drawing`, fd);
      }

      setPendingProduct([]);
      setPendingQuality([]);
      setDrawingFile(null);
      refetchImages();
      onDone?.();
      onClose();
    } catch (err) {
      setUploadError(err?.response?.data?.error || err.message || 'เกิดข้อผิดพลาด');
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteExistingImg(imgId) {
    try {
      await api.delete(`/master/products/${initial.id}/images/${imgId}`);
      refetchImages();
    } catch {}
    setDeletingImg(null);
  }

  const isFullInspection = form.inspection_level === 'FULL';
  const isBusy = loading || uploading;

  // Current drawing info
  const currentDrawing = initial.current_drawing;

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {(error || uploadError) && (
        <div className="text-danger text-small bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded px-3 py-2">{error || uploadError}</div>
      )}

      {/* ─── Section 1: ข้อมูลพื้นฐาน ─── */}
      <div>
        <h4 className="text-small font-semibold text-muted uppercase tracking-wide mb-2">ข้อมูลสินค้า</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className="label">รหัสสินค้า</label><input className="input" value={form.code} onChange={e => set('code', e.target.value)} /></div>
          <div><label className="label">ชื่อสินค้า *</label><input className="input" value={form.name} onChange={e => set('name', e.target.value)} required /></div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
          <div>
            <label className="label">กลุ่มสินค้า *</label>
            <SearchableSelect
              options={groups.map(g => ({ value: g.id, label: g.name }))}
              value={form.product_group_id}
              onChange={v => { set('product_group_id', v); set('supplier_ids', []); }}
              placeholder="ค้นหากลุ่มสินค้า..."
              required
            />
          </div>
          <div>
            <label className="label">หน่วยนับ *</label>
            <SearchableSelect
              options={units.map(u => ({ value: u.id, label: u.name + (u.abbreviation ? ` (${u.abbreviation})` : '') }))}
              value={form.unit_id}
              onChange={v => set('unit_id', v)}
              placeholder="ค้นหาหน่วยนับ..."
              required
            />
          </div>
        </div>
        <div className="mt-3">
          <div className="flex items-center justify-between flex-wrap gap-1">
            <label className="label mb-0">
              Supplier *
              <span className="ml-1 text-[12px] text-muted font-normal">(เลือกได้มากกว่า 1)</span>
              {form.product_group_id && (
                <span className="ml-1 text-[12px] text-accent font-normal">
                  — กรองตามกลุ่ม "{groups.find(g => String(g.id) === String(form.product_group_id))?.name}"
                </span>
              )}
            </label>
            {filteredSuppliers.length > 0 && (
              <button
                type="button"
                onClick={() => set('supplier_ids', allFilteredSuppliersSelected ? [] : filteredSupplierIds)}
                className="text-[12px] text-accent hover:underline"
              >
                {allFilteredSuppliersSelected ? 'ยกเลิก Supplier ทั้งหมด' : 'เลือก Supplier ทั้งหมด'}
              </button>
            )}
          </div>
          {suppliers.length === 0 ? (
            <p className="text-small text-muted italic">ยังไม่มีข้อมูล Supplier</p>
          ) : filteredSuppliers.length === 0 ? (
            <p className="text-small text-muted italic mt-1">ไม่มี Supplier ในกลุ่มสินค้านี้ — ไปเพิ่มกลุ่มสินค้าให้ Supplier ที่หน้า "ผู้ผลิต" ก่อน</p>
          ) : (
            <SearchableSelect
              multiple
              wrap
              options={filteredSuppliers.map(s => ({ value: String(s.id), label: s.name }))}
              value={form.supplier_ids}
              onChange={ids => set('supplier_ids', ids)}
              placeholder="ค้นหา/เลือก Supplier..."
            />
          )}
          {form.supplier_ids.length === 0 && (
            <p className="text-[12px] text-danger mt-1">กรุณาเลือก Supplier อย่างน้อย 1</p>
          )}
        </div>
        <div className="mt-3">
          <label className="label">หมายเหตุ</label>
          <textarea className="input" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
        </div>

        {/* สีสินค้า */}
        <div className="mt-3">
          <label className="label">สีสินค้า</label>
          {colors.length === 0 ? (
            <p className="text-small text-muted italic">ยังไม่มีข้อมูลสี</p>
          ) : (
            <div className="flex flex-wrap gap-2 mt-1 p-2 border border-border rounded-md bg-bg min-h-[48px]">
              {colors.map(c => {
                const selected = form.color_id === String(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => selectColor(c.id)}
                    title={c.code ? `${c.name} (${c.code})` : c.name}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-small transition-all min-h-[34px] ${
                      selected
                        ? 'border-primary bg-primary/10 text-primary font-semibold shadow-sm'
                        : 'border-border bg-surface text-muted hover:border-accent hover:text-accent'
                    }`}
                  >
                    <span
                      className="w-4 h-4 rounded-full border border-black/10 flex-shrink-0"
                      style={{ backgroundColor: c.hex_code || '#e5e7eb' }}
                    />
                    {c.name}
                    {selected && (
                      <svg className="w-3 h-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ─── Section 2: แผนการสุ่มตรวจ AQL ─── */}
      <div className="border-t border-border pt-4">
        <h4 className="text-small font-semibold text-muted uppercase tracking-wide mb-2">แผนการสุ่มตรวจ (AQL)</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">ระดับการสุ่มตรวจ</label>
            <select className="input" value={form.inspection_level} onChange={e => { set('inspection_level', e.target.value); if (e.target.value === 'FULL') set('aql_value', ''); }}>
              {INSPECTION_LEVELS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">
              ค่า AQL
              {isFullInspection && <span className="ml-2 text-[12px] text-success font-medium">(ไม่ใช้ — ตรวจทุกชิ้น)</span>}
            </label>
            <select
              className="input"
              value={form.aql_value}
              onChange={e => set('aql_value', e.target.value)}
              disabled={isFullInspection}
            >
              {AQL_VALUES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
        {isFullInspection && (
          <p className="text-small text-warning mt-2 bg-amber-50 dark:bg-amber-900 border border-amber-200 dark:border-amber-700 rounded px-3 py-1.5">
            โหมด "ตรวจ 100%" — ระบบจะกำหนดขนาดตัวอย่าง = จำนวนรับเข้าทั้งหมด โดยอัตโนมัติ
          </p>
        )}
      </div>

      {/* ─── Section 3: Drawing PDF ─── */}
      <div className="border-t border-border pt-4">
        <h4 className="text-small font-semibold text-muted uppercase tracking-wide mb-2">Engineering Drawing (PDF)</h4>
        {currentDrawing && (
          <div className="flex items-center gap-3 mb-2 p-2 bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded">
            <svg className="w-5 h-5 text-red-600 dark:text-red-200 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path d="M4 18h12V6l-4-4H4v16zm8-14l2 2h-2V4z"/></svg>
            <div className="flex-1 min-w-0">
              <p className="text-small font-medium text-text truncate">{currentDrawing.original_name}</p>
              <p className="text-[12px] text-muted">Rev: {currentDrawing.revision} — มีผลวันที่ {currentDrawing.effective_date}</p>
            </div>
            <a
              href={`/api/master/products/${initial.id}/drawings/current`}
              target="_blank"
              rel="noreferrer"
              className="text-small text-red-600 dark:text-red-200 hover:underline font-medium whitespace-nowrap"
            >
              ดู PDF
            </a>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">{currentDrawing ? 'อัปโหลด Revision ใหม่' : 'อัปโหลด Drawing'}</label>
            <input
              type="file" accept=".pdf"
              className="block w-full text-small text-muted file:mr-3 file:py-1.5 file:px-3 file:rounded file:border file:border-border file:text-small file:bg-surface hover:file:bg-bg"
              onChange={e => setDrawingFile(e.target.files[0] || null)}
            />
            {drawingFile && <p className="text-[12px] text-success mt-1">{drawingFile.name}</p>}
          </div>
          <div>
            <label className="label">Revision</label>
            <input className="input" value={drawingRevision} onChange={e => setDrawingRevision(e.target.value)} placeholder="เช่น Rev.B" />
          </div>
        </div>
      </div>

      {/* ─── Section 4: รูปภาพสินค้า ─── */}
      <div className="border-t border-border pt-4">
        <h4 className="text-small font-semibold text-muted uppercase tracking-wide mb-2">รูปภาพสินค้า</h4>

        {/* Existing product images */}
        {productImgs.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {productImgs.map(img => (
              <div key={img.id} className="relative group w-20 h-20 flex-shrink-0">
                <img
                  src={`/uploads/general/${img.file_path}`}
                  alt={img.original_name}
                  className="w-20 h-20 object-cover rounded border border-border"
                />
                <button
                  type="button"
                  onClick={() => setDeletingImg(img)}
                  className="absolute -top-1.5 -right-1.5 w-6 h-6 bg-danger text-white rounded-full text-[12px] font-bold flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow"
                >X</button>
                <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[12px] px-1 py-0.5 rounded-b truncate">{img.original_name}</div>
              </div>
            ))}
          </div>
        )}

        {/* Pending product images preview */}
        <ImageStrip images={pendingProduct} onRemove={i => removePending(i, 'product')} label="รูปที่เลือก (ยังไม่บันทึก)" />

        <div className="mt-2">
          <ImageUploadPair onChange={e => addPendingFiles(e.target.files, 'product')} />
        </div>
      </div>

      {/* ─── Section 5: รูปภาพปัญหาคุณภาพ ─── */}
      <div className="border-t border-border pt-4">
        <h4 className="text-small font-semibold text-muted uppercase tracking-wide mb-1">รูปภาพปัญหาคุณภาพ</h4>
        <p className="text-[12px] text-muted mb-2">รูปตัวอย่างปัญหาที่เคยพบ (สำหรับอ้างอิงตรวจรับ)</p>

        {/* Existing quality images */}
        {qualityImgs.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {qualityImgs.map(img => (
              <div key={img.id} className="relative group w-20 h-20 flex-shrink-0">
                <img
                  src={`/uploads/general/${img.file_path}`}
                  alt={img.original_name}
                  className="w-20 h-20 object-cover rounded border border-red-200 dark:border-red-700"
                />
                <button
                  type="button"
                  onClick={() => setDeletingImg(img)}
                  className="absolute -top-1.5 -right-1.5 w-6 h-6 bg-danger text-white rounded-full text-[12px] font-bold flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow"
                >X</button>
                <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[12px] px-1 py-0.5 rounded-b truncate">{img.original_name}</div>
              </div>
            ))}
          </div>
        )}

        <ImageStrip images={pendingQuality} onRemove={i => removePending(i, 'quality_issue')} label="รูปปัญหาที่เลือก (ยังไม่บันทึก)" />

        <div className="mt-2">
          <ImageUploadPair variant="danger" onChange={e => addPendingFiles(e.target.files, 'quality_issue')} />
        </div>
      </div>

      <div className="flex justify-end pt-2 border-t border-border gap-2">
        <button type="button" onClick={onClose} className="btn-secondary min-h-[44px] px-4">ยกเลิก</button>
        <Button type="submit" loading={isBusy}>
          {isBusy ? 'กำลังบันทึก...' : 'บันทึก'}
        </Button>
      </div>

      {/* Confirm delete image */}
      <ConfirmDialog
        open={!!deletingImg}
        onClose={() => setDeletingImg(null)}
        onConfirm={() => handleDeleteExistingImg(deletingImg?.id)}
        message={`ลบรูปภาพ "${deletingImg?.original_name}" ?`}
        confirmLabel="ลบรูป"
        variant="danger"
      />
    </form>
  );
}

// ─── Products List Page ─────────────────────────────────────────────────────────
export default function Products() {
  const qc = useQueryClient();
  const [search, setSearch]           = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage]               = useState(1);
  const [filterSupplier, setFilterSupplier] = useState('');
  const [modalOpen, setModalOpen]     = useState(false);
  const [editing, setEditing]         = useState(null);
  const [confirmToggle, setConfirmToggle] = useState(null);
  const [showAll, setShowAll]         = useState(false);
  const [previewImg, setPreviewImg]   = useState(null); // lightbox
  const [imgViewer, setImgViewer]     = useState(null); // { productId, label, type }

  // Import/Export state
  const [importOpen, setImportOpen]   = useState(false);
  const [importFile, setImportFile]   = useState(null);
  const [importPreview, setImportPreview] = useState(null);
  const [importStep, setImportStep]   = useState('pick'); // pick | previewing | preview | importing | done
  const [importError, setImportError] = useState('');
  const [importCount, setImportCount] = useState(0);
  const [importExtra, setImportExtra] = useState(null); // { updated, skipped }
  const [confirmDeleteRow, setConfirmDeleteRow] = useState(null); // { productId, name } — แถว error ที่กำลังจะลบ
  const importFileRef = useRef();

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => { setPage(1); }, [showAll, filterSupplier]);

  const { data: resp = {} } = useQuery({
    queryKey: ['products', showAll, page, debouncedSearch, filterSupplier],
    queryFn: () => api.get('/master/products', { params: { page, limit: PAGE_SIZE, q: debouncedSearch, ...(showAll ? { all: '1' } : {}), ...(filterSupplier ? { supplier_id: filterSupplier } : {}) } }).then(r => r.data),
  });
  const rows = resp.data || [];
  const totalRows = resp.total || 0;
  const totalPages = Math.ceil(totalRows / PAGE_SIZE);

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api.get('/master/suppliers').then(r => r.data),
  });

  const save = useMutation({
    mutationFn: async (form) => {
      if (editing) return (await api.patch(`/master/products/${editing.id}`, form)).data;
      return (await api.post('/master/products', form)).data;
    },
  });

  const toggle = useMutation({
    mutationFn: (id) => api.patch(`/master/products/${id}/toggle`),
    onSuccess: () => { qc.invalidateQueries(['products']); setConfirmToggle(null); },
  });

  // S155 — ลบสินค้าจากหน้า preview import Excel ที่ error ตรงๆ (ไม่ต้องปิด modal ไปหาที่ตารางหลัก) — server จะลบถาวร
  // ถ้าไม่มีประวัติการใช้งานผูกอยู่ ไม่งั้น fallback เป็นปิดใช้งานให้อัตโนมัติ (ดู DELETE /products/:id)
  const deleteProduct = useMutation({
    mutationFn: (id) => api.delete(`/master/products/${id}`),
    onSuccess: (res, id) => {
      setImportPreview(prev => prev && ({
        ...prev,
        results: prev.results.map(r =>
          r._data?.id === id ? { ...r, status: 'deleted', errors: [], warnings: [], deleteResult: res.data } : r
        ),
      }));
      setConfirmDeleteRow(null);
      qc.invalidateQueries(['products']);
    },
  });

  const { data: viewerImages = [] } = useQuery({
    queryKey: ['product-images-view', imgViewer?.productId, imgViewer?.type],
    queryFn: () => api.get(`/master/products/${imgViewer.productId}/images?image_type=${imgViewer.type}`).then(r => r.data),
    enabled: !!imgViewer,
  });

  const { sorted, onSort, sortKey, sortDir } = useSortable(rows, 'name');

  function openEdit(r) { setEditing(r); setModalOpen(true); }
  function openNew()   { setEditing(null); setModalOpen(true); }
  function closeModal(){ setModalOpen(false); setEditing(null); }

  function openImport() {
    setImportOpen(true); setImportFile(null); setImportPreview(null);
    setImportStep('pick'); setImportError(''); setImportCount(0); setImportExtra(null);
  }
  function closeImport() { setImportOpen(false); }

  async function handleExport() {
    try {
      await downloadExcel('/master/products/export', {}, 'products_template.xlsx');
    } catch { alert('Export ไม่สำเร็จ กรุณาลองอีกครั้ง'); }
  }

  async function handlePreview() {
    if (!importFile) return;
    setImportStep('previewing'); setImportError('');
    try {
      const fd = new FormData(); fd.append('file', importFile);
      const { data } = await api.post('/master/products/import?preview=1', fd);
      setImportPreview(data); setImportStep('preview');
    } catch (e) {
      setImportError(e?.response?.data?.error || 'ตรวจสอบไม่สำเร็จ');
      setImportStep('pick');
    }
  }

  async function handleImport() {
    if (!importFile) return;
    setImportStep('importing'); setImportError('');
    try {
      const fd = new FormData(); fd.append('file', importFile);
      const { data } = await api.post('/master/products/import', fd);
      setImportCount(data.imported);
      setImportExtra((data.updated !== undefined || data.skipped !== undefined) ? { updated: data.updated || 0, skipped: data.skipped || 0 } : null);
      setImportStep('done');
      qc.invalidateQueries(['products']);
    } catch (e) {
      setImportError(e?.response?.data?.error || 'Import ไม่สำเร็จ');
      setImportStep('preview');
    }
  }

  // AQL display helper
  function aqlLabel(row) {
    if (row.inspection_level === 'FULL') return <span className="badge bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-200">ตรวจ 100%</span>;
    const lvl = row.inspection_level?.replace('GEN_', 'GEN-') || '-';
    const aql = row.aql_value ? `AQL ${row.aql_value}` : '';
    return <span className="text-small text-muted font-mono">{lvl} {aql}</span>;
  }

  return (
    <div>
      <h1 className="text-h2 font-bold text-text mb-4">สินค้า</h1>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex gap-2 flex-wrap">
          <input className="input max-w-xs" placeholder="ค้นหา..." value={search} onChange={e => setSearch(e.target.value)} />
          <SearchableSelect
            options={suppliers.map(s => ({ value: s.id, label: s.name }))}
            value={filterSupplier}
            onChange={setFilterSupplier}
            placeholder="ทุก Supplier"
            className="min-w-[160px]"
          />
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-small text-muted cursor-pointer min-h-[44px]">
            <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
            แสดงที่ปิดใช้งาน
          </label>
          <button
            onClick={handleExport}
            className="inline-flex items-center gap-1.5 px-3 py-2 border border-border rounded-md text-small text-muted bg-surface hover:bg-bg min-h-[44px] transition-colors"
          >
            <svg className="w-4 h-4 text-success flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            Export Excel
          </button>
          <button
            onClick={openImport}
            className="inline-flex items-center gap-1.5 px-3 py-2 border border-border rounded-md text-small text-muted bg-surface hover:bg-bg min-h-[44px] transition-colors"
          >
            <svg className="w-4 h-4 text-accent flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l4-4m0 0l4 4m-4-4v12" /></svg>
            Import Excel
          </button>
          <Button onClick={openNew}>+ เพิ่มสินค้า</Button>
        </div>
      </div>

      {/* ── Mobile cards ── */}
      <div className="md:hidden space-y-2 mb-4">
        {rows.length === 0 && <p className="text-center text-muted py-8 text-body">ไม่พบสินค้า</p>}
        {sorted.map(r => (
          <div key={r.id} className="bg-surface border border-border rounded-lg p-3">
            {/* ── Header row: badge สถานะ ── */}
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="min-w-0">
                {r.code && <span className="font-mono text-[12px] text-muted mr-1">{r.code} ·</span>}
              </div>
              <span className={`badge flex-shrink-0 ${r.is_active ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200' : 'bg-gray-100 dark:bg-gray-900 text-gray-500 dark:text-gray-200'}`}>
                {r.is_active ? 'ใช้งาน' : 'ปิด'}
              </span>
            </div>

            {/* ── Body: ข้อมูล (ซ้าย) + รูป (ขวา) ── */}
            <div className="flex gap-3 mb-2">
              {/* ซ้าย: ข้อความ */}
              <div className="flex-1 min-w-0">
                <p className={`font-semibold text-body mb-1 ${r.is_active ? 'text-text' : 'text-muted'}`}>{r.name}</p>
                <p className="text-[12px] text-muted mb-1.5 truncate">
                  {r.suppliers?.length > 0
                    ? r.suppliers.map(s => s.supplier_name).join(', ')
                    : (r.supplier_name || '—')}
                </p>
                <div className="flex flex-wrap items-center gap-1 mb-1.5">
                  {r.product_group_name && (
                    <span className="px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900 text-blue-700 dark:text-blue-200 text-[12px]">{r.product_group_name}</span>
                  )}
                  {aqlLabel(r)}
                </div>
                {r.colors?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {r.colors.map(c => (
                      <span key={c.id} className="flex items-center gap-1">
                        <span className="w-3 h-3 rounded-full border border-border inline-block flex-shrink-0" style={{ backgroundColor: c.hex_code || '#ccc' }} />
                        <span className="text-[12px] text-muted">{c.name}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* ขวา: รูปภาพสินค้า */}
              <div className="flex-shrink-0 w-24">
                {r.thumbnail_path ? (
                  <button
                    onClick={() => setImgViewer({ productId: r.id, label: `รูปสินค้า — ${r.name}`, type: 'product' })}
                    className="block w-full relative rounded-lg overflow-hidden border border-border"
                  >
                    <img
                      src={`/uploads/general/${r.thumbnail_path}`}
                      alt={r.name}
                      className="w-24 h-24 object-cover"
                    />
                    {r.product_img_count > 1 && (
                      <span className="absolute bottom-0 inset-x-0 bg-black/50 text-white text-[11px] text-center py-0.5">
                        +{r.product_img_count - 1} รูป
                      </span>
                    )}
                  </button>
                ) : (
                  <div className="w-24 h-24 rounded-lg border border-dashed border-border bg-bg flex items-center justify-center">
                    <span className="text-[12px] text-muted text-center leading-tight px-1">No image</span>
                  </div>
                )}
              </div>
            </div>

            {/* ── Drawing + quality images ── */}
            {(r.current_drawing || r.quality_img_count > 0) && (
              <div className="flex items-center gap-3 text-[12px] text-muted mb-2">
                {r.current_drawing && (
                  <a href={`/api/master/products/${r.id}/drawings/current`} target="_blank" rel="noreferrer"
                    className="text-red-600 dark:text-red-200 hover:underline flex items-center gap-0.5">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M4 18h12V6l-4-4H4v16zm8-14l2 2h-2V4z"/></svg>
                    Rev.{r.current_drawing?.revision}
                  </a>
                )}
                {r.quality_img_count > 0 && (
                  <button onClick={() => setImgViewer({ productId: r.id, label: `รูปงานเสีย — ${r.name}`, type: 'quality_issue' })}
                    className="text-danger hover:underline">{r.quality_img_count} รูปงานเสีย</button>
                )}
              </div>
            )}

            {/* ── Actions ── */}
            <div className="flex gap-2 pt-2 border-t border-border">
              <button onClick={() => openEdit(r)}
                className="flex-1 min-h-[44px] rounded-lg border border-border text-body text-text flex items-center justify-center hover:bg-bg">
                แก้ไข
              </button>
              <div className="flex items-center justify-center min-w-[48px]">
                <ToggleSwitch active={r.is_active} onClick={() => setConfirmToggle(r)} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Desktop table ── */}
      <div className="hidden md:block table-container">
        <table className="table">
          <thead>
            <tr>
              <SortTh col="code"               sortKey={sortKey} sortDir={sortDir} onSort={onSort}>รหัส</SortTh>
              <SortTh col="name"               sortKey={sortKey} sortDir={sortDir} onSort={onSort}>ชื่อสินค้า</SortTh>
              <SortTh col="supplier_name"      sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Supplier</SortTh>
              <SortTh col="product_group_name" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>กลุ่ม</SortTh>
              <SortTh col="inspection_level"   sortKey={sortKey} sortDir={sortDir} onSort={onSort}>แผน AQL</SortTh>
              <th>สี</th>
              <SortTh col="product_img_count"  sortKey={sortKey} sortDir={sortDir} onSort={onSort}>รูปสินค้า</SortTh>
              <SortTh col="quality_img_count"  sortKey={sortKey} sortDir={sortDir} onSort={onSort}>รูปงานเสีย</SortTh>
              <th>Drawing</th>
              <SortTh col="is_active"          sortKey={sortKey} sortDir={sortDir} onSort={onSort}>สถานะ</SortTh>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(r => (
              <tr key={r.id}>
                <td className="font-mono text-small">{r.code || '-'}</td>
                <td className={r.is_active ? 'font-medium' : 'text-muted'}>{r.name}</td>
                <td className="text-small">
                  {r.suppliers?.length > 0 ? (
                    <div className="flex flex-col gap-0.5">
                      {r.suppliers.map(s => (
                        <span key={s.supplier_id} className="whitespace-nowrap">{s.supplier_name}</span>
                      ))}
                    </div>
                  ) : (r.supplier_name || '-')}
                </td>
                <td className="text-small">{r.product_group_name}</td>
                <td>{aqlLabel(r)}</td>
                <td>
                  {r.colors?.length > 0 ? (
                    <div className="flex flex-col gap-1 items-center">
                      {r.colors.slice(0, 4).map(c => (
                        <div key={c.id} className="flex items-center gap-1.5">
                          <div
                            className="w-3.5 h-3.5 rounded-full border border-border flex-shrink-0"
                            style={{ backgroundColor: c.hex_code || '#ccc' }}
                          />
                          <span className="text-small text-text whitespace-nowrap">{c.name}</span>
                        </div>
                      ))}
                      {r.colors.length > 4 && (
                        <span className="text-[12px] text-muted">+{r.colors.length - 4} สี</span>
                      )}
                    </div>
                  ) : (
                    <span className="text-muted text-small">-</span>
                  )}
                </td>
                <td className="text-center text-small">
                  {r.product_img_count > 0
                    ? <button type="button" onClick={() => setImgViewer({ productId: r.id, label: `รูปสินค้า — ${r.name}`, type: 'product' })} className="text-accent font-medium hover:underline">{r.product_img_count} รูป</button>
                    : <span className="text-muted">-</span>}
                </td>
                <td className="text-center text-small">
                  {r.quality_img_count > 0
                    ? <button type="button" onClick={() => setImgViewer({ productId: r.id, label: `รูปงานเสีย — ${r.name}`, type: 'quality_issue' })} className="text-danger font-medium hover:underline">{r.quality_img_count} รูป</button>
                    : <span className="text-muted">-</span>}
                </td>
                <td>
                  {r.current_drawing ? (
                    <a
                      href={`/api/master/products/${r.id}/drawings/current`}
                      target="_blank" rel="noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="text-red-600 dark:text-red-200 hover:underline text-small flex items-center justify-center gap-1"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M4 18h12V6l-4-4H4v16zm8-14l2 2h-2V4z"/></svg>
                      Rev.{r.current_drawing?.revision}
                    </a>
                  ) : <span className="text-muted text-small">-</span>}
                </td>
                <td>
                  <span className={`badge ${r.is_active ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200' : 'bg-gray-100 dark:bg-gray-900 text-gray-500 dark:text-gray-200'}`}>
                    {r.is_active ? 'ใช้งาน' : 'ปิด'}
                  </span>
                </td>
                <td>
                  <div className="flex gap-2 items-center justify-center">
                    <EditButton onClick={() => openEdit(r)} />
                    <ToggleSwitch active={r.is_active} onClick={() => setConfirmToggle(r)} />
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={11} className="text-center text-muted py-8">ไม่พบสินค้า</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination page={page} totalPages={totalPages} total={totalRows} limit={PAGE_SIZE} onChange={setPage} />

      <Modal open={modalOpen} onClose={closeModal} title={editing ? `แก้ไขสินค้า — ${editing.name}` : 'เพิ่มสินค้าใหม่'} size="xl">
        <Form
          initial={editing || {}}
          onSave={f => save.mutateAsync(f)}
          loading={save.isPending}
          error={save.error?.response?.data?.error}
          onClose={closeModal}
          onDone={() => qc.invalidateQueries(['products'])}
        />
      </Modal>

      <ConfirmDialog
        open={!!confirmToggle}
        onClose={() => setConfirmToggle(null)}
        onConfirm={() => toggle.mutate(confirmToggle.id)}
        message={`ต้องการ${confirmToggle?.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'} "${confirmToggle?.name}"`}
        confirmLabel={confirmToggle?.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
        variant={confirmToggle?.is_active ? 'warning' : 'success'}
        loading={toggle.isPending}
      />

      {/* S155 — ลบสินค้าจาก import-error preview: ลบถาวรถ้าไม่มีประวัติผูก ไม่งั้น server ปิดใช้งานให้อัตโนมัติแทน */}
      <ConfirmDialog
        open={!!confirmDeleteRow}
        onClose={() => setConfirmDeleteRow(null)}
        onConfirm={() => deleteProduct.mutate(confirmDeleteRow.productId)}
        message={`ต้องการลบ "${confirmDeleteRow?.name}" ออกจากระบบ? ถ้าไม่มีประวัติการใช้งาน (บิล/Drawing ฯลฯ) จะถูกลบถาวร ถ้ามีประวัติอยู่ ระบบจะปิดการใช้งานให้แทนโดยอัตโนมัติ`}
        confirmLabel="ลบ"
        variant="danger"
        loading={deleteProduct.isPending}
      />

      {/* Image viewer modal */}
      <Modal open={!!imgViewer} onClose={() => setImgViewer(null)} title={imgViewer?.label || ''}>
        {viewerImages.length === 0 ? (
          <p className="text-muted text-small py-4 text-center">ไม่พบรูปภาพ</p>
        ) : (
          <div className="flex flex-wrap gap-3 p-1">
            {viewerImages.map(img => (
              <a key={img.id} href={`/uploads/general/${img.file_path}`} target="_blank" rel="noreferrer" className="block">
                <img
                  src={`/uploads/general/${img.file_path}`}
                  alt={img.original_name}
                  className="w-32 h-32 object-cover rounded border border-border hover:opacity-80 transition-opacity"
                  title={img.original_name}
                />
              </a>
            ))}
          </div>
        )}
      </Modal>

      {/* Import Excel Modal */}
      <Modal open={importOpen} onClose={importStep === 'importing' ? undefined : closeImport} title="Import สินค้าจาก Excel" size="xl">
        {importStep === 'pick' && (
          <div className="space-y-4">
            <p className="text-small text-muted">
              อัปโหลดไฟล์ .xlsx ที่มีข้อมูลสินค้า — ดาวน์โหลด Template ได้จากปุ่ม <strong>Export Excel</strong>
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => importFileRef.current?.click()}
                className="inline-flex items-center gap-2 px-4 py-2.5 border border-dashed border-border rounded-md text-small text-muted hover:border-accent hover:text-accent transition-colors min-h-[44px]"
              >
                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                {importFile ? importFile.name : 'เลือกไฟล์ .xlsx'}
              </button>
              <input
                ref={importFileRef} type="file" accept=".xlsx"
                className="hidden"
                onChange={e => { setImportFile(e.target.files[0] || null); setImportPreview(null); }}
              />
            </div>
            {importError && (
              <div className="text-danger text-small bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded px-3 py-2">{importError}</div>
            )}
            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <button type="button" onClick={closeImport} className="btn-secondary min-h-[44px] px-4">ยกเลิก</button>
              <Button onClick={handlePreview} loading={false} disabled={!importFile}>ตรวจสอบข้อมูล</Button>
            </div>
          </div>
        )}

        {importStep === 'previewing' && (
          <div className="py-12 text-center text-muted">
            <svg className="w-8 h-8 mx-auto mb-3 animate-spin text-accent" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
            กำลังตรวจสอบข้อมูล...
          </div>
        )}

        {importStep === 'preview' && importPreview && (
          <div className="space-y-4">
            {/* Summary chips */}
            <div className="flex flex-wrap gap-2 items-center">
              <span className="px-2.5 py-1 rounded-full text-small bg-gray-100 dark:bg-gray-900 text-text font-medium">
                ทั้งหมด {importPreview.total} รายการ
              </span>
              {importPreview.errorCount > 0 && (
                <span className="px-2.5 py-1 rounded-full text-small bg-red-100 dark:bg-red-900 text-danger font-medium">
                  ข้อผิดพลาด {importPreview.errorCount} รายการ
                </span>
              )}
              {importPreview.warningCount > 0 && (
                <span className="px-2.5 py-1 rounded-full text-small bg-amber-100 dark:bg-amber-900 text-warning font-medium">
                  คำเตือน {importPreview.warningCount} รายการ
                </span>
              )}
              {importPreview.updateCount > 0 && (
                <span className="px-2.5 py-1 rounded-full text-small bg-blue-100 dark:bg-blue-900 text-accent font-medium">
                  อัปเดต {importPreview.updateCount} รายการ
                </span>
              )}
              {importPreview.skipCount > 0 && (
                <span className="px-2.5 py-1 rounded-full text-small bg-gray-100 dark:bg-gray-800 text-muted font-medium">
                  ข้าม {importPreview.skipCount} รายการ (ไม่มีการเปลี่ยนแปลง)
                </span>
              )}
              {importPreview.errorCount === 0 && (
                <span className="px-2.5 py-1 rounded-full text-small bg-green-100 dark:bg-green-900 text-success font-medium">
                  พร้อม Import
                </span>
              )}
            </div>

            {importPreview.errorCount > 0 && (
              <p className="text-[12px] text-muted">
                แถวที่ error เพราะสินค้านั้นเลิกใช้งานแล้วจริงๆ กด "ลบสินค้านี้ออกจากระบบ" ที่แถวนั้นได้เลย —
                หลังลบครบแล้วให้ปิดหน้าต่างนี้แล้วกด <strong>Export Excel</strong> ใหม่อีกครั้งก่อน Import
                (ไฟล์เดิมที่เปิดค้างไว้จะยัง error แถวเดิมอยู่ เพราะข้อมูลในไฟล์ยังไม่เปลี่ยน)
              </p>
            )}

            {/* Results table */}
            <div className="overflow-auto max-h-[420px] border border-border rounded-md">
              <table className="w-full text-small border-collapse">
                <thead className="sticky top-0 bg-bg z-10">
                  <tr className="border-b border-border">
                    <th className="px-2 py-2 text-left text-muted font-medium w-12">แถว</th>
                    <th className="px-2 py-2 text-left text-muted font-medium">รหัส</th>
                    <th className="px-2 py-2 text-left text-muted font-medium">ชื่อสินค้า</th>
                    <th className="px-2 py-2 text-left text-muted font-medium">Supplier</th>
                    <th className="px-2 py-2 text-left text-muted font-medium">กลุ่ม</th>
                    <th className="px-2 py-2 text-left text-muted font-medium">หน่วย</th>
                    <th className="px-2 py-2 text-left text-muted font-medium">ผลตรวจสอบ</th>
                  </tr>
                </thead>
                <tbody>
                  {importPreview.results.map(r => (
                    <tr key={r.row} className={`border-b border-border ${IMPORT_STATUS_CLASS[r.status]}`}>
                      <td className="px-2 py-1.5 text-muted font-mono">{r.row}</td>
                      <td className="px-2 py-1.5 font-mono">{r.display?.รหัส || '-'}</td>
                      <td className="px-2 py-1.5 font-medium">{r.display?.ชื่อสินค้า || <span className="text-danger italic">ว่าง</span>}</td>
                      <td className="px-2 py-1.5">{r.display?.Supplier || '-'}</td>
                      <td className="px-2 py-1.5">{r.display?.กลุ่ม || '-'}</td>
                      <td className="px-2 py-1.5">{r.display?.หน่วย || '-'}</td>
                      <td className="px-2 py-1.5">
                        {r.status === 'deleted' && (
                          <span className="text-success font-medium text-[12px]">
                            ✓ {r.deleteResult?.deleted ? 'ลบออกจากระบบแล้ว' : 'ปิดการใช้งานแล้ว (มีประวัติการใช้งานอยู่ ลบถาวรไม่ได้)'}
                          </span>
                        )}
                        {r.status === 'skip' && (
                          <span className="text-muted font-medium text-[12px]">ไม่มีการเปลี่ยนแปลง — ข้าม</span>
                        )}
                        {r.status === 'update' && (
                          <span className="text-accent font-medium text-[12px]">อัปเดต</span>
                        )}
                        {r.errors.length === 0 && r.warnings.length === 0 && r.status !== 'skip' && r.status !== 'update' && r.status !== 'deleted' && (
                          <span className="text-success font-medium">OK</span>
                        )}
                        {r.changes?.map((c, i) => (
                          <div key={i} className="text-accent text-[12px] leading-snug">{c}</div>
                        ))}
                        {r.errors.map((e, i) => (
                          <div key={i} className="text-danger text-[12px] leading-snug">{e}</div>
                        ))}
                        {r.warnings.map((w, i) => (
                          <div key={i} className="text-warning text-[12px] leading-snug">{w}</div>
                        ))}
                        {r.status === 'error' && r._data?.id && (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteRow({ productId: r._data.id, name: r.display?.ชื่อสินค้า || r.display?.รหัส })}
                            className="mt-1 text-[12px] text-danger underline hover:no-underline"
                          >
                            ลบสินค้านี้ออกจากระบบ
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {importError && (
              <div className="text-danger text-small bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded px-3 py-2">{importError}</div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-border gap-3">
              <button
                type="button"
                onClick={() => { setImportStep('pick'); setImportFile(null); setImportPreview(null); setImportError(''); }}
                className="btn-secondary min-h-[44px] px-4"
              >
                เลือกไฟล์ใหม่
              </button>
              <div className="flex gap-2">
                <button type="button" onClick={closeImport} className="btn-secondary min-h-[44px] px-4">ยกเลิก</button>
                {importPreview.errorCount > 0 ? (
                  <span className="inline-flex items-center text-small text-danger px-3">
                    แก้ไขข้อผิดพลาด {importPreview.errorCount} รายการก่อน
                  </span>
                ) : (
                  <Button onClick={handleImport}>
                    นำเข้า {importPreview.total} รายการ
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {importStep === 'importing' && (
          <div className="py-12 text-center text-muted">
            <svg className="w-8 h-8 mx-auto mb-3 animate-spin text-accent" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
            กำลังนำเข้าข้อมูล...
          </div>
        )}

        {importStep === 'done' && (
          <div className="py-10 text-center space-y-3">
            <svg className="w-14 h-14 mx-auto text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <p className="text-h3 font-semibold text-text">นำเข้าข้อมูลสำเร็จ</p>
            {importExtra ? (
              <p className="text-muted text-small">
                เพิ่มใหม่ {importCount} รายการ
                {importExtra.updated > 0 && <> · อัปเดต {importExtra.updated} รายการ</>}
                {importExtra.skipped > 0 && <> · ข้าม {importExtra.skipped} รายการ (ไม่มีการเปลี่ยนแปลง)</>}
              </p>
            ) : (
              <p className="text-muted text-small">เพิ่มสินค้า {importCount} รายการเรียบร้อยแล้ว</p>
            )}
            <div className="pt-2">
              <Button onClick={closeImport}>ปิด</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
