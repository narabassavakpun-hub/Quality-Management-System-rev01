import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import SearchableSelect from '../../components/UI/SearchableSelect';

export const STATUS_CFG = {
  open:             { label: 'เปิดอยู่',           cls: 'bg-green-100 text-green-800' },
  waiting_info:     { label: 'รอข้อมูล',           cls: 'bg-blue-100 text-blue-800' },
  waiting_action:   { label: 'รอดำเนินการ',        cls: 'bg-orange-100 text-orange-800' },
  waiting_decision: { label: 'รอการตัดสินใจ',      cls: 'bg-purple-100 text-purple-800' },
  resolved:         { label: 'แก้ไขแล้ว',          cls: 'bg-teal-100 text-teal-700' },
  closed:           { label: 'ปิดแล้ว',            cls: 'bg-gray-100 text-gray-600' },
};

export function StatusBadge({ status }) {
  const cfg = STATUS_CFG[status] || { label: status, cls: 'bg-gray-100 text-gray-600' };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-small font-medium ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

export function fmtTime(dt) {
  if (!dt) return '';
  // SQLite CURRENT_TIMESTAMP = UTC without 'Z' — must append to parse correctly
  const d = new Date(dt.includes('Z') || dt.includes('+') ? dt : dt + 'Z');
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'เมื่อกี้';
  if (diff < 3600) return `${Math.floor(diff / 60)} นาทีที่แล้ว`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ชั่วโมงที่แล้ว`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} วันที่แล้ว`;
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
}

const ROLE_LABEL = {
  admin: 'Admin', qc_staff: 'QC Staff', qc_supervisor: 'หัวหน้า QC',
  qc_manager: 'QC Manager', qmr: 'QMR', purchasing: 'จัดซื้อ',
  cco: 'CCO', cmo: 'CMO', cpo: 'CPO', production_manager: 'ผจก.ผลิต',
};

function CreateModal({ onClose }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [supplierId, setSupplierId] = useState('');
  const [files, setFiles] = useState([]);
  const qc = useQueryClient();

  const { data: users = [] } = useQuery({
    queryKey: ['issue-talk-users'],
    queryFn: () => api.get('/issue-talk/users').then(r => r.data),
    staleTime: 60000,
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['issue-talk-suppliers'],
    queryFn: () => api.get('/issue-talk/suppliers').then(r => r.data),
    staleTime: 60000,
  });

  const create = useMutation({
    mutationFn: (fd) => api.post('/issue-talk', fd, { headers: { 'Content-Type': 'multipart/form-data' } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issue-talks'] });
      onClose();
    },
  });

  function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    const fd = new FormData();
    fd.append('title', title.trim());
    fd.append('body', body.trim());
    fd.append('participant_ids', JSON.stringify(selectedUsers));
    if (supplierId) fd.append('supplier_id', supplierId);
    for (const f of files) fd.append('files', f);
    create.mutate(fd);
  }

  function toggleUser(uid) {
    setSelectedUsers(p => p.includes(uid) ? p.filter(id => id !== uid) : [...p, uid]);
  }

  function handleFileChange(e) {
    const selected = Array.from(e.target.files || []);
    if (selected.length > 0) setFiles(prev => [...prev, ...selected]);
    e.target.value = '';
  }

  function removeFile(i) {
    setFiles(p => p.filter((_, j) => j !== i));
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50">
      <div className="bg-surface rounded-t-2xl sm:rounded-xl w-full sm:max-w-lg max-h-[92vh] flex flex-col shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <h2 className="font-semibold text-h3 text-primary">สร้าง Issue Talk ใหม่</h2>
          <button onClick={onClose} className="text-muted hover:text-text w-8 h-8 flex items-center justify-center text-xl rounded hover:bg-bg">
            ×
          </button>
        </div>

        {/* Form body */}
        <form id="create-issue-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <label className="label">หัวเรื่อง *</label>
            <input
              className="input w-full"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="ระบุหัวเรื่องปัญหา / สิ่งที่ต้องการสอบถาม..."
              required
            />
          </div>

          <div>
            <label className="label">รายละเอียด</label>
            <textarea
              className="input w-full resize-none"
              rows={4}
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="อธิบายปัญหา, แนบสเป็ค หรือบริบทที่เกี่ยวข้อง..."
            />
          </div>

          {/* Supplier dropdown */}
          <div>
            <label className="label">Supplier (ถ้าเกี่ยวข้อง)</label>
            <SearchableSelect
              options={suppliers.map(s => ({ value: s.id, label: s.code ? `[${s.code}] ${s.name}` : s.name }))}
              value={supplierId}
              onChange={setSupplierId}
              placeholder="— ไม่ระบุ Supplier —"
            />
          </div>

          <div>
            <label className="label">Tag ผู้ที่เกี่ยวข้อง</label>
            <div className="border border-border rounded-lg max-h-44 overflow-y-auto bg-bg">
              {users.length === 0 ? (
                <div className="p-3 text-small text-muted text-center">กำลังโหลด...</div>
              ) : users.map(u => (
                <label key={u.id} className="flex items-center gap-2 cursor-pointer hover:bg-surface px-3 py-2 border-b border-border last:border-0">
                  <input
                    type="checkbox"
                    checked={selectedUsers.includes(u.id)}
                    onChange={() => toggleUser(u.id)}
                    className="w-4 h-4 accent-primary flex-shrink-0"
                  />
                  <span className="text-body text-text flex-1">{u.full_name}</span>
                  <span className="text-small text-muted">{ROLE_LABEL[u.role] || u.role}</span>
                </label>
              ))}
            </div>
            {selectedUsers.length > 0 && (
              <p className="text-small text-accent mt-1">Tag {selectedUsers.length} คน</p>
            )}
          </div>

          <div>
            <label className="label">แนบไฟล์ (รูปภาพ, วีดีโอ, PDF)</label>
            <label
              htmlFor="create-file-input"
              className="btn-secondary text-small px-3 min-h-[36px] cursor-pointer inline-flex items-center"
            >
              + เลือกไฟล์
            </label>
            <input
              type="file"
              id="create-file-input"
              multiple
              className="sr-only"
              accept="image/*,video/mp4,video/quicktime,video/webm,.pdf"
              onChange={handleFileChange}
            />
            {files.length > 0 && (
              <div className="mt-2 space-y-1">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 text-small bg-bg rounded px-2 py-1">
                    <svg className="w-4 h-4 text-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                    </svg>
                    <span className="truncate flex-1 text-text">{f.name}</span>
                    <button type="button" onClick={() => removeFile(i)} className="text-danger hover:underline flex-shrink-0">ลบ</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </form>

        {/* Footer */}
        <div className="flex gap-2 px-4 py-3 border-t border-border flex-shrink-0">
          <button type="button" onClick={onClose} className="btn-secondary flex-1 min-h-[44px]">
            ยกเลิก
          </button>
          <button
            type="submit"
            form="create-issue-form"
            disabled={!title.trim() || create.isPending}
            className="btn-primary flex-1 min-h-[44px] disabled:opacity-50"
          >
            {create.isPending ? 'กำลังสร้าง...' : 'สร้างห้องสนทนา'}
          </button>
        </div>

        {create.isError && (
          <p className="px-4 pb-3 text-small text-danger">
            {create.error?.response?.data?.error || 'เกิดข้อผิดพลาด'}
          </p>
        )}
      </div>
    </div>
  );
}

function IssueCard({ issue, onClick }) {
  return (
    <div
      onClick={onClick}
      className="card px-4 py-3 cursor-pointer hover:shadow-md transition-shadow active:bg-bg"
    >
      <div className="flex items-start gap-2 mb-1">
        <StatusBadge status={issue.status} />
        {issue.unread_count > 0 && (
          <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-danger text-white font-bold leading-none" style={{ fontSize: '11px' }}>
            {issue.unread_count > 99 ? '99+' : issue.unread_count}
          </span>
        )}
        <span className="text-small text-muted ml-auto flex-shrink-0">{fmtTime(issue.updated_at)}</span>
      </div>

      <div className="font-semibold text-body text-text leading-snug mb-1 line-clamp-2">
        {issue.title}
      </div>

      {issue.last_message_body ? (
        <div className="text-small text-muted truncate">
          <span className="font-medium">{issue.last_message_by}:</span> {issue.last_message_body}
        </div>
      ) : issue.body ? (
        <div className="text-small text-muted truncate">{issue.body}</div>
      ) : null}

      {issue.supplier_name && (
        <div className="mt-1">
          <span className="inline-flex items-center gap-1 bg-cyan-50 border border-cyan-200 text-cyan-800 text-small px-2 py-0.5 rounded-full">
            {issue.supplier_code ? `[${issue.supplier_code}] ` : ''}{issue.supplier_name}
          </span>
        </div>
      )}

      <div className="flex items-center gap-3 mt-2 text-small text-muted">
        <span>{issue.creator_name}</span>
        {issue.participant_count > 0 && (
          <span className="flex items-center gap-1">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {issue.participant_count}
          </span>
        )}
        {issue.message_count > 0 && (
          <span className="flex items-center gap-1">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            {issue.message_count}
          </span>
        )}
        {issue.opening_attachment_count > 0 && (
          <span className="flex items-center gap-1">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
            {issue.opening_attachment_count}
          </span>
        )}
      </div>
    </div>
  );
}

export default function IssueTalkList() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [taggedUserId, setTaggedUserId] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const { data: facets } = useQuery({
    queryKey: ['issue-talk-facets', filter],
    queryFn: () => api.get('/issue-talk/facets', { params: { filter } }).then(r => r.data),
    staleTime: 30000,
  });
  const facetStatuses = facets?.statuses || [];
  const facetUsers = facets?.tagged_users || [];
  const facetSuppliers = facets?.suppliers || [];

  const { data, isLoading } = useQuery({
    queryKey: ['issue-talks', filter, q, statusFilter, taggedUserId, supplierFilter],
    queryFn: () => api.get('/issue-talk', {
      params: { filter, q, limit: 50, status: statusFilter, tagged_user_id: taggedUserId, supplier_id: supplierFilter },
    }).then(r => r.data),
  });

  // Clear sub-filters that no longer exist in current facets (e.g. after switching tab)
  useEffect(() => {
    if (facets) {
      if (statusFilter && !facetStatuses.includes(statusFilter)) setStatusFilter('');
      if (taggedUserId && !facetUsers.some(u => String(u.id) === taggedUserId)) setTaggedUserId('');
      if (supplierFilter && !facetSuppliers.some(s => String(s.id) === supplierFilter)) setSupplierFilter('');
    }
  }, [facets]);

  const issues = data?.data || [];
  const hasFilter = filter !== 'all' || q !== '' || statusFilter !== '' || taggedUserId !== '' || supplierFilter !== '';

  function resetFilters() {
    setFilter('all');
    setQ('');
    setStatusFilter('');
    setTaggedUserId('');
    setSupplierFilter('');
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Page header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-h2 font-bold text-primary">Issue Talk</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="btn-primary hidden sm:flex items-center gap-2 min-h-[40px] px-4"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          สร้างใหม่
        </button>
      </div>

      {/* Search + filter panel */}
      <div className="bg-surface border border-border rounded-lg p-3 mb-3 space-y-2">
        {/* Search row */}
        <div className="flex gap-2 items-center">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              className="input w-full pl-9"
              placeholder="ค้นหาหัวเรื่อง..."
              value={q}
              onChange={e => setQ(e.target.value)}
            />
          </div>
          {hasFilter && (
            <button
              onClick={resetFilters}
              className="flex items-center gap-1.5 px-3 py-2 text-small text-danger border border-danger rounded-lg hover:bg-red-50 min-h-[44px] whitespace-nowrap"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              รีเซ็ต
            </button>
          )}
        </div>

        {/* Dropdowns row */}
        <div className="grid grid-cols-3 gap-2">
          {/* Status dropdown — only statuses that exist in accessible issues */}
          <select
            className="input text-small"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
          >
            <option value="">ทุกสถานะ</option>
            {facetStatuses.map(val => (
              <option key={val} value={val}>{STATUS_CFG[val]?.label || val}</option>
            ))}
          </select>

          {/* Tagged user dropdown — only users tagged in accessible issues */}
          <SearchableSelect
            options={facetUsers.map(u => ({ value: u.id, label: u.full_name }))}
            value={taggedUserId}
            onChange={setTaggedUserId}
            placeholder="ทุกผู้ Tag"
          />

          {/* Supplier dropdown — only suppliers that appear in accessible issues */}
          <SearchableSelect
            options={facetSuppliers.map(s => ({ value: s.id, label: s.code ? `[${s.code}] ${s.name}` : s.name }))}
            value={supplierFilter}
            onChange={setSupplierFilter}
            placeholder="ทุก Supplier"
          />
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4 bg-bg rounded-lg p-1">
        {[['all', 'ทั้งหมด'], ['mine', 'ของฉัน'], ['tagged', 'ถูก Tag']].map(([val, label]) => (
          <button
            key={val}
            onClick={() => setFilter(val)}
            className={`flex-1 py-1.5 text-small font-medium rounded-md transition-colors min-h-[36px]
              ${filter === val ? 'bg-surface text-primary shadow-sm' : 'text-muted hover:text-text'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="text-center text-muted py-10">กำลังโหลด...</div>
      ) : issues.length === 0 ? (
        <div className="text-center text-muted py-10">
          <svg className="w-10 h-10 mx-auto mb-2 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          {hasFilter ? (
            <div>
              <div>ไม่พบรายการที่ตรงกับเงื่อนไข</div>
              <button onClick={resetFilters} className="mt-3 text-accent text-small hover:underline">
                ล้างตัวกรอง
              </button>
            </div>
          ) : (
            <div>
              <div>ไม่มีรายการ</div>
              <button onClick={() => setShowCreate(true)} className="mt-3 text-accent text-small hover:underline">
                สร้างห้องสนทนาแรก
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {issues.map(issue => (
            <IssueCard
              key={issue.id}
              issue={issue}
              onClick={() => navigate(`/issue-talk/${issue.id}`)}
            />
          ))}
        </div>
      )}

      {/* Mobile FAB */}
      <button
        onClick={() => setShowCreate(true)}
        className="sm:hidden fixed bottom-20 right-4 w-14 h-14 rounded-full bg-primary text-white shadow-lg flex items-center justify-center z-20"
        aria-label="สร้างใหม่"
      >
        <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      </button>

      {showCreate && <CreateModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
