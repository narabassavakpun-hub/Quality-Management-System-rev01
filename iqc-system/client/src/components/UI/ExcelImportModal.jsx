import React, { useState, useRef } from 'react';
import api from '../../utils/api';
import Modal from './Modal';
import Button from './Button';

const STATUS_BG = { error: 'bg-red-50', warning: 'bg-amber-50', ok: '' };

const Spinner = () => (
  <svg className="w-8 h-8 mx-auto mb-3 animate-spin text-accent" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

// apiPath เช่น "/master/suppliers" → จะเรียก POST ${apiPath}/import?preview=1 และ POST ${apiPath}/import
export default function ExcelImportModal({ open, onClose, title = 'Import Excel', apiPath, onDone }) {
  const [file, setFile]       = useState(null);
  const [preview, setPreview] = useState(null);
  const [step, setStep]       = useState('pick'); // pick | previewing | preview | importing | done
  const [error, setError]     = useState('');
  const [count, setCount]     = useState(0);
  const fileRef = useRef();

  function handleClose() {
    if (step === 'importing') return;
    setFile(null); setPreview(null); setStep('pick'); setError(''); setCount(0);
    onClose();
  }

  async function handlePreview() {
    if (!file) return;
    setStep('previewing'); setError('');
    try {
      const fd = new FormData(); fd.append('file', file);
      const { data } = await api.post(`${apiPath}/import?preview=1`, fd);
      setPreview(data); setStep('preview');
    } catch (e) {
      setError(e?.response?.data?.error || 'ตรวจสอบไม่สำเร็จ');
      setStep('pick');
    }
  }

  async function handleImport() {
    if (!file) return;
    setStep('importing'); setError('');
    try {
      const fd = new FormData(); fd.append('file', file);
      const { data } = await api.post(`${apiPath}/import`, fd);
      setCount(data.imported); setStep('done');
      onDone?.();
    } catch (e) {
      setError(e?.response?.data?.error || 'Import ไม่สำเร็จ');
      setStep('preview');
    }
  }

  // ดึง column keys จาก display object ของ row แรก
  const displayKeys = preview?.results?.[0] ? Object.keys(preview.results[0].display ?? {}) : [];

  return (
    <Modal open={open} onClose={handleClose} title={title} size="xl">

      {/* ── Step: pick ── */}
      {step === 'pick' && (
        <div className="space-y-4">
          <p className="text-small text-muted">
            อัปโหลดไฟล์ .xlsx — ดาวน์โหลด Template ได้จากปุ่ม <strong>Export Excel</strong>
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-2 px-4 py-2.5 border border-dashed border-border rounded-md text-small text-muted hover:border-accent hover:text-accent transition-colors min-h-[44px]"
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              {file ? file.name : 'เลือกไฟล์ .xlsx'}
            </button>
            <input
              ref={fileRef} type="file" accept=".xlsx" className="hidden"
              onChange={e => { setFile(e.target.files[0] || null); setPreview(null); setError(''); }}
            />
          </div>
          {error && <div className="text-danger text-small bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button type="button" onClick={handleClose} className="btn-secondary min-h-[44px] px-4">ยกเลิก</button>
            <Button onClick={handlePreview} disabled={!file}>ตรวจสอบข้อมูล</Button>
          </div>
        </div>
      )}

      {/* ── Step: previewing ── */}
      {step === 'previewing' && (
        <div className="py-12 text-center text-muted"><Spinner />กำลังตรวจสอบ...</div>
      )}

      {/* ── Step: preview ── */}
      {step === 'preview' && preview && (
        <div className="space-y-4">
          {/* summary chips */}
          <div className="flex flex-wrap gap-2">
            <span className="px-2.5 py-1 rounded-full text-small bg-gray-100 text-text font-medium">
              ทั้งหมด {preview.total} รายการ
            </span>
            {preview.errorCount > 0 && (
              <span className="px-2.5 py-1 rounded-full text-small bg-red-100 text-danger font-medium">
                ข้อผิดพลาด {preview.errorCount} รายการ
              </span>
            )}
            {preview.warningCount > 0 && (
              <span className="px-2.5 py-1 rounded-full text-small bg-amber-100 text-warning font-medium">
                คำเตือน {preview.warningCount} รายการ
              </span>
            )}
            {preview.errorCount === 0 && (
              <span className="px-2.5 py-1 rounded-full text-small bg-green-100 text-success font-medium">
                พร้อม Import
              </span>
            )}
          </div>

          {/* results table */}
          <div className="overflow-auto max-h-[420px] border border-border rounded-md">
            <table className="w-full text-small border-collapse">
              <thead className="sticky top-0 bg-bg z-10">
                <tr className="border-b border-border">
                  <th className="px-2 py-2 text-left text-muted font-medium w-10">แถว</th>
                  {displayKeys.map(k => (
                    <th key={k} className="px-2 py-2 text-left text-muted font-medium whitespace-nowrap">{k}</th>
                  ))}
                  <th className="px-2 py-2 text-left text-muted font-medium">ผลตรวจสอบ</th>
                </tr>
              </thead>
              <tbody>
                {preview.results.map(r => (
                  <tr key={r.row} className={`border-b border-border ${STATUS_BG[r.status]}`}>
                    <td className="px-2 py-1.5 text-muted font-mono text-[11px]">{r.row}</td>
                    {displayKeys.map(k => (
                      <td key={k} className="px-2 py-1.5">{r.display?.[k] ?? '-'}</td>
                    ))}
                    <td className="px-2 py-1.5">
                      {r.errors.length === 0 && r.warnings.length === 0 && (
                        <span className="text-success font-medium text-[11px]">OK</span>
                      )}
                      {r.errors.map((e, i) => (
                        <div key={i} className="text-danger text-[11px] leading-snug">{e}</div>
                      ))}
                      {r.warnings.map((w, i) => (
                        <div key={i} className="text-warning text-[11px] leading-snug">{w}</div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {error && <div className="text-danger text-small bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}

          <div className="flex items-center justify-between pt-2 border-t border-border gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => { setStep('pick'); setFile(null); setPreview(null); setError(''); }}
              className="btn-secondary min-h-[44px] px-4"
            >
              เลือกไฟล์ใหม่
            </button>
            <div className="flex items-center gap-2 flex-wrap">
              <button type="button" onClick={handleClose} className="btn-secondary min-h-[44px] px-4">ยกเลิก</button>
              {preview.errorCount > 0 ? (
                <span className="text-small text-danger px-2">แก้ไขข้อผิดพลาด {preview.errorCount} รายการก่อน</span>
              ) : (
                <Button onClick={handleImport}>นำเข้า {preview.total} รายการ</Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Step: importing ── */}
      {step === 'importing' && (
        <div className="py-12 text-center text-muted"><Spinner />กำลังนำเข้าข้อมูล...</div>
      )}

      {/* ── Step: done ── */}
      {step === 'done' && (
        <div className="py-10 text-center space-y-3">
          <svg className="w-14 h-14 mx-auto text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-h3 font-semibold text-text">นำเข้าข้อมูลสำเร็จ</p>
          <p className="text-muted text-small">เพิ่ม {count} รายการเรียบร้อยแล้ว</p>
          <div className="pt-2"><Button onClick={handleClose}>ปิด</Button></div>
        </div>
      )}
    </Modal>
  );
}
