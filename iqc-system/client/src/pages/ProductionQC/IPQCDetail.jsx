import React, { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';

const RESULT_LABELS = {
  pending:   { label: 'รอผล',    color: 'bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-200' },
  pass:      { label: 'ผ่าน',    color: 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200' },
  fail:      { label: 'ไม่ผ่าน', color: 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200' },
  has_ipncr: { label: 'มี IPNCR', color: 'bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-200' },
};

function Badge({ val, map }) {
  const r = map[val] || { label: val, color: 'bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-200' };
  return <span className={`badge ${r.color}`}>{r.label}</span>;
}

function CheckItemRow({ item }) {
  let measured = null;
  if (item.measured_values) {
    try { measured = JSON.parse(item.measured_values); } catch { measured = [item.measured_value]; }
  } else if (item.measured_value != null) {
    measured = [item.measured_value];
  }

  const stdMin = (item.std_value ?? 0) - (item.tol_minus ?? 0);
  const stdMax = (item.std_value ?? 0) + (item.tol_plus ?? 0);

  const resultColor = item.result === 'pass' ? 'text-success' : item.result === 'fail' ? 'text-danger' : 'text-muted';

  return (
    <tr className="border-t border-border">
      <td className="px-3 py-2 text-small text-muted">{item.item_no}</td>
      <td className="px-3 py-2 text-small">
        <div>{item.item_name}</div>
        {item.check_type && <div className="text-[11px] text-muted">{item.check_type}</div>}
      </td>
      <td className="px-3 py-2 text-small text-center">
        {item.std_value != null
          ? `${item.std_value} ±(${item.tol_plus}/${item.tol_minus}) ${item.unit || ''}`
          : item.input_type === 'pass_fail' ? 'ผ่าน/ไม่ผ่าน' : '—'}
      </td>
      <td className="px-3 py-2 text-small text-center">
        {item.input_type === 'pass_fail' ? (
          <span>{item.pass_fail_value === 1 ? 'ผ่าน' : item.pass_fail_value === 0 ? 'ไม่ผ่าน' : '—'}</span>
        ) : item.input_type === 'text' ? (
          <span className="text-muted">{item.text_value || '—'}</span>
        ) : measured ? (
          <div className="flex flex-wrap justify-center gap-1">
            {(Array.isArray(measured) ? measured : [measured]).map((v, i) => {
              const num = Number(v);
              const inRange = !isNaN(num) ? (num >= stdMin && num <= stdMax) : null;
              return (
                <span key={i} className={`font-mono text-[11px] px-1 rounded ${inRange === false ? 'bg-red-100 dark:bg-red-900 text-danger' : inRange === true ? 'bg-green-50 dark:bg-green-900 text-success' : ''}`}>
                  {v}
                </span>
              );
            })}
          </div>
        ) : '—'}
      </td>
      <td className="px-3 py-2 text-center">
        <span className={`text-small font-semibold ${resultColor}`}>
          {item.result === 'pass' ? '✓' : item.result === 'fail' ? '✗' : '—'}
        </span>
      </td>
      <td className="px-3 py-2 text-small text-muted">{item.remarks || '—'}</td>
    </tr>
  );
}

export default function IPQCDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: insp, isLoading } = useQuery({
    queryKey: ['ipqc-detail', id],
    queryFn: () => api.get(`/ipqc-inspection/${id}`).then(r => r.data),
  });

  const [uploading, setUploading] = useState(false);

  async function handleUpload(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setUploading(true);
    const fd = new FormData();
    files.forEach(f => fd.append('images', f));
    try {
      await api.post(`/ipqc-inspection/${id}/images`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      qc.invalidateQueries(['ipqc-detail', id]);
    } catch (err) {
      alert(err.response?.data?.error || 'อัปโหลดไม่สำเร็จ');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function handleDeleteImage(imgId) {
    if (!confirm('ลบรูปภาพนี้?')) return;
    try {
      await api.delete(`/ipqc-inspection/${id}/images/${imgId}`);
      qc.invalidateQueries(['ipqc-detail', id]);
    } catch (err) {
      alert(err.response?.data?.error || 'ลบไม่สำเร็จ');
    }
  }

  if (isLoading) return <div className="text-center py-12 text-muted">กำลังโหลด...</div>;
  if (!insp) return <div className="text-center py-12 text-danger">ไม่พบรายการ</div>;

  const canEdit = ['admin', 'qc_staff', 'qc_supervisor'].includes(user?.role);
  const isDraft = insp.status === 'draft';

  const passCount = (insp.items || []).filter(it => it.result === 'pass').length;
  const failCount = (insp.items || []).filter(it => it.result === 'fail').length;
  const overallResult = insp.overall_result;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap gap-3 items-start justify-between">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="font-mono font-bold text-h2 text-primary">{insp.record_no}</h1>
            <Badge val={overallResult} map={RESULT_LABELS} />
            {isDraft && <span className="badge bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-200">Draft</span>}
          </div>
          <p className="text-muted text-small mt-1">
            {insp.station_name} — {insp.inspect_date} {insp.inspect_time}
            {insp.line_name && ` | ${insp.line_name}`}
          </p>
        </div>
        {isDraft && canEdit && (
          <button
            className="btn-primary min-h-[44px] px-4"
            onClick={() => navigate(`/production-qc/ipqc/new`)}
          >
            แก้ไข
          </button>
        )}
      </div>

      {/* Info grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Doc No', val: insp.doc_no, mono: true },
          { label: 'สินค้า', val: insp.product_no || '—', mono: true },
          { label: 'Lot Qty', val: insp.lot_qty ?? '—' },
          { label: 'Sample (n)', val: insp.sample_qty ?? '—' },
          { label: 'Ac / Re', val: `${insp.accept_criteria ?? 0} / ${insp.reject_criteria ?? 1}` },
          { label: 'ผ่าน / ไม่ผ่าน', val: `${passCount} / ${failCount}` },
          { label: 'ผู้บันทึก', val: insp.creator_name || '—' },
          { label: 'บันทึกเมื่อ', val: insp.created_at ? insp.created_at.slice(0, 16) : '—' },
        ].map(({ label, val, mono }) => (
          <div key={label} className="card py-2 px-3">
            <div className="text-[11px] text-muted">{label}</div>
            <div className={`text-small font-semibold text-text mt-0.5 ${mono ? 'font-mono' : ''}`}>{val}</div>
          </div>
        ))}
      </div>

      {insp.product_desc && (
        <div className="text-small text-muted px-1">{insp.product_desc}</div>
      )}
      {insp.remarks && (
        <div className="text-small text-muted px-1 italic">หมายเหตุ: {insp.remarks}</div>
      )}

      {/* Overall banner */}
      {overallResult !== 'pending' && (
        <div className={`p-3 rounded-lg border-l-4 text-small font-semibold ${overallResult === 'pass' ? 'border-success bg-green-50 dark:bg-green-900 text-success' : 'border-danger bg-red-50 dark:bg-red-900 text-danger'}`}>
          ผลการตรวจ: {overallResult === 'pass' ? '✓ ผ่านทุกหัวข้อ' : `✗ ไม่ผ่าน ${failCount} หัวข้อ`}
        </div>
      )}

      {/* Check items table */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-small font-semibold text-text">ผลการตรวจ Check Sheet</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="table w-full">
            <thead>
              <tr>
                <th className="px-3 py-2 text-left text-[11px] text-muted">#</th>
                <th className="px-3 py-2 text-left text-[11px] text-muted">หัวข้อ</th>
                <th className="px-3 py-2 text-center text-[11px] text-muted">Std (Tol)</th>
                <th className="px-3 py-2 text-center text-[11px] text-muted">ผลวัด</th>
                <th className="px-3 py-2 text-center text-[11px] text-muted">ผล</th>
                <th className="px-3 py-2 text-left text-[11px] text-muted">หมายเหตุ</th>
              </tr>
            </thead>
            <tbody>
              {(insp.items || []).length === 0 ? (
                <tr><td colSpan={6} className="text-center py-4 text-muted text-small">ไม่มีข้อมูล</td></tr>
              ) : (
                (insp.items || []).map(it => <CheckItemRow key={it.id} item={it} />)
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* IPNCR linked */}
      {(insp.ipncr_list || []).length > 0 && (
        <div className="card">
          <h2 className="text-small font-semibold text-text mb-3">เอกสาร IPNCR ที่เกี่ยวข้อง</h2>
          <div className="space-y-2">
            {insp.ipncr_list.map(ncr => (
              <Link
                key={ncr.id}
                to={`/production-qc/ipncr/${ncr.id}`}
                className="flex items-center justify-between p-3 rounded border border-border hover:bg-bg"
              >
                <div>
                  <div className="font-mono text-primary text-small font-semibold">{ncr.record_no}</div>
                  <div className="text-[11px] text-muted">{ncr.defect_description}</div>
                </div>
                <span className="badge bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-200 text-[11px]">ครั้งที่ {ncr.recheck_attempt}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Images */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-small font-semibold text-text">รูปภาพ</h2>
          {canEdit && (
            <label className="btn-secondary text-small cursor-pointer min-h-[40px] px-3 flex items-center gap-1">
              {uploading ? 'กำลังอัปโหลด...' : '+ เพิ่มรูป'}
              <input type="file" className="hidden" multiple accept="image/*" onChange={handleUpload} disabled={uploading} />
            </label>
          )}
        </div>
        {(insp.images || []).length === 0 ? (
          <div className="text-muted text-small text-center py-4">ยังไม่มีรูปภาพ</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {insp.images.map(img => (
              <div key={img.id} className="relative group">
                <img
                  src={`/uploads/ipqc/${encodeURIComponent(img.filename)}`}
                  alt={img.original_name || 'ภาพ'}
                  className="w-full h-28 object-cover rounded border border-border"
                />
                {canEdit && isDraft && (
                  <button
                    onClick={() => handleDeleteImage(img.id)}
                    className="absolute top-1 right-1 w-6 h-6 flex items-center justify-center bg-danger text-white rounded text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                  >×</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-start">
        <button className="btn-secondary min-h-[44px] px-4" onClick={() => navigate(-1)}>← กลับ</button>
      </div>
    </div>
  );
}
