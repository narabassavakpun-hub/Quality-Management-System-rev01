import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../utils/api';

// ─── helpers ────────────────────────────────────────────────────────────────
const ACTION_COLORS = {
  CREATE:          'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200',
  APPROVE:         'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200',
  SIGN:            'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200',
  CLOSE:           'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200',
  ACTIVATE:        'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200',
  NCP_CLOSE:       'bg-teal-100 dark:bg-teal-900 text-teal-800 dark:text-teal-200',
  LOGIN:           'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200',
  EXPORT:          'bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-200',
  UPDATE:          'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200',
  RESUBMIT:        'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200',
  PASSWORD_RESET:  'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200',
  DELETE:          'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200',
  CANCEL:          'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200',
  DEACTIVATE:      'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200',
  LOGIN_FAILED:    'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200',
  REJECT:          'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200',
};

const ACTION_LABELS = {
  CREATE:         'สร้าง',
  APPROVE:        'อนุมัติ',
  SIGN:           'ลงนาม',
  CLOSE:          'ปิด',
  NCP_CLOSE:      'ปิด NCP',
  ACTIVATE:       'เปิดใช้',
  DEACTIVATE:     'ปิดใช้',
  DELETE:         'ลบ',
  CANCEL:         'ยกเลิก',
  UPDATE:         'แก้ไข',
  RESUBMIT:       'ส่งใหม่',
  REJECT:         'ปฏิเสธ',
  EXPORT:         'Export',
  LOGIN:          'เข้าสู่ระบบ',
  LOGIN_FAILED:   'Login ล้มเหลว',
  PASSWORD_RESET: 'Reset PW',
};

const TABLE_LABELS = {
  bills:                'บิลรับเข้า',
  ncrs:                 'NCR/NCP',
  uai_documents:        'UAI',
  users:                'ผู้ใช้งาน',
  products:             'สินค้า',
  suppliers:            'ผู้ผลิต',
  product_groups:       'กลุ่มสินค้า',
  defect_categories:    'กลุ่มปัญหา',
  units:                'หน่วยนับ',
  colors:               'สีสินค้า',
  settings:             'ตั้งค่าระบบ',
  delivery_schedules:   'ปฏิทินส่งของ',
  measuring_equipment:  'เครื่องมือวัด',
  issue_talk_rooms:     'Issue Talk',
  product_drawings:     'Drawing',
  auth:                 'ระบบ',
};

function tryParse(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return s; }
}

function fmtDt(s) {
  if (!s) return '-';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return d.toLocaleString('th-TH', {
    day: '2-digit', month: 'short', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Bangkok',
  });
}
function fmtDate(s) {
  if (!s) return '-';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return d.toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'Asia/Bangkok' });
}
function fmtTime(s) {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
}

// ─── sub-components ──────────────────────────────────────────────────────────
function ActionBadge({ act }) {
  const color = ACTION_COLORS[act] || 'bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-200';
  const label = ACTION_LABELS[act] || act;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold tracking-wide ${color}`}>
      {label}
    </span>
  );
}

function TableLabel({ name }) {
  return <span>{TABLE_LABELS[name] || name}</span>;
}

function JsonDetail({ label, value }) {
  const parsed = tryParse(value);
  if (!parsed) return null;
  const text = typeof parsed === 'object' ? JSON.stringify(parsed, null, 2) : String(parsed);
  return (
    <div>
      <p className="text-[11px] font-semibold text-muted mb-1">{label}</p>
      <pre className="bg-bg border border-border rounded-lg p-2 text-[10px] overflow-auto max-h-36 leading-relaxed">{text}</pre>
    </div>
  );
}

function Avatar({ username }) {
  return (
    <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
      <span className="text-[10px] font-bold text-primary">
        {(username || 'S')[0].toUpperCase()}
      </span>
    </div>
  );
}

// ─── filter bar ──────────────────────────────────────────────────────────────
function FilterBar({ filters, setFilter, resetAll, allActions, allTables, allUsers }) {
  const { q, action, table, user, from, to } = filters;
  return (
    <div className="bg-surface border border-border rounded-2xl shadow-sm p-4 mb-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3">
        {/* search */}
        <div className="relative min-w-0 sm:col-span-2 lg:col-span-2">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
          </svg>
          <input
            type="text" placeholder="ค้นหา username / ชื่อ..."
            value={q} onChange={e => setFilter('q', e.target.value)}
            className="input-field pl-9 rounded-xl w-full min-w-0"
          />
        </div>

        {/* user — filter แยกดูตาม user แต่ละคน (กด dropdown เลือกได้ตรงๆ ไม่ต้องพิมพ์ค้นหา) */}
        <div className="min-w-0">
          <label className="block text-[11px] font-medium text-muted mb-1 ml-1">ผู้ใช้</label>
          <select value={user} onChange={e => setFilter('user', e.target.value)} className="input-field rounded-xl w-full min-w-0 truncate">
            <option value="">ทั้งหมด</option>
            {allUsers.map(u => (
              <option key={u.username} value={u.username}>{u.full_name ? `${u.full_name} (${u.username})` : u.username}</option>
            ))}
          </select>
        </div>

        {/* action */}
        <div className="min-w-0">
          <label className="block text-[11px] font-medium text-muted mb-1 ml-1">ประเภท Action</label>
          <select value={action} onChange={e => setFilter('action', e.target.value)} className="input-field rounded-xl w-full min-w-0">
            <option value="">ทั้งหมด</option>
            {allActions.map(a => (
              <option key={a} value={a}>{ACTION_LABELS[a] ? `${ACTION_LABELS[a]} (${a})` : a}</option>
            ))}
          </select>
        </div>

        {/* table */}
        <div className="min-w-0">
          <label className="block text-[11px] font-medium text-muted mb-1 ml-1">หมวดหมู่</label>
          <select value={table} onChange={e => setFilter('table', e.target.value)} className="input-field rounded-xl w-full min-w-0">
            <option value="">ทั้งหมด</option>
            {allTables.map(t => (
              <option key={t} value={t}>{TABLE_LABELS[t] || t}</option>
            ))}
          </select>
        </div>

        {/* from */}
        <div className="min-w-0">
          <label className="block text-[11px] font-medium text-muted mb-1 ml-1">จากวันที่</label>
          <input
            type="date" value={from}
            onChange={e => setFilter('from', e.target.value)}
            className="input-field rounded-xl w-full min-w-0"
          />
        </div>

        {/* to */}
        <div className="min-w-0">
          <label className="block text-[11px] font-medium text-muted mb-1 ml-1">ถึงวันที่</label>
          <input
            type="date" value={to}
            onChange={e => setFilter('to', e.target.value)}
            className="input-field rounded-xl w-full min-w-0"
          />
        </div>
      </div>

      {(q || action || table || user || from || to) && (
        <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
          <span className="text-[11px] text-muted">กรองข้อมูลอยู่</span>
          <button onClick={resetAll} className="inline-flex items-center gap-1.5 text-small text-danger hover:underline">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            ล้างตัวกรองทั้งหมด
          </button>
        </div>
      )}
    </div>
  );
}

// ─── main page ───────────────────────────────────────────────────────────────
const LIMIT = 30;

export default function AuditLogs() {
  const [q, setQ]           = useState('');
  const [action, setAction] = useState('');
  const [table, setTable]   = useState('');
  const [user, setUser]     = useState('');
  const [from, setFrom]     = useState('');
  const [to, setTo]         = useState('');
  const [page, setPage]     = useState(1);
  const [showFilter, setShowFilter] = useState(false);
  const [expanded, setExpanded]     = useState(null);

  const hasFilter = q || action || table || user || from || to;

  function setFilter(key, val) {
    const setters = { q: setQ, action: setAction, table: setTable, user: setUser, from: setFrom, to: setTo };
    setters[key](val);
    setPage(1);
  }
  function resetAll() {
    setQ(''); setAction(''); setTable(''); setUser(''); setFrom(''); setTo('');
    setPage(1);
  }

  const { data, isLoading } = useQuery({
    queryKey: ['audit-logs', q, action, table, user, from, to, page],
    queryFn: () =>
      api.get('/admin/audit-logs', {
        params: { q, action, table_name: table, user, from, to, page, limit: LIMIT },
      }).then(r => r.data),
    staleTime: 15000,
  });

  const rows       = data?.data    || [];
  const total      = data?.total   || 0;
  const totalPages = Math.ceil(total / LIMIT);
  const allActions = data?.actions || [];
  const allTables  = data?.tables  || [];
  const allUsers   = data?.users   || [];

  function toggleExpand(id) {
    setExpanded(prev => (prev === id ? null : id));
  }

  return (
    <div>
      {/* Header */}
      <div className="page-header flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <h1 className="page-title">Log การใช้งาน</h1>
          {!isLoading && (
            <p className="text-small text-muted mt-0.5">
              {total.toLocaleString()} รายการ
              {hasFilter && <span className="ml-1 text-accent">(กรองแล้ว)</span>}
            </p>
          )}
        </div>
        {/* mobile filter toggle */}
        <button
          className="md:hidden inline-flex items-center gap-2 px-3 min-h-[44px] rounded-lg border border-border text-small text-muted active:bg-bg"
          onClick={() => setShowFilter(p => !p)}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          ตัวกรอง
          {hasFilter && <span className="w-2 h-2 rounded-full bg-primary" />}
        </button>
      </div>

      {/* Filter (always visible on md+, toggleable on mobile) */}
      <div className={showFilter ? 'block' : 'hidden md:block'}>
        <FilterBar
          filters={{ q, action, table, user, from, to }}
          setFilter={setFilter}
          resetAll={resetAll}
          allActions={allActions}
          allTables={allTables}
          allUsers={allUsers}
        />
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="card text-center text-muted py-12">กำลังโหลด...</div>
      )}

      {/* Empty */}
      {!isLoading && rows.length === 0 && (
        <div className="card text-center py-12">
          <svg className="w-10 h-10 text-border mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-muted">ไม่พบรายการ log</p>
        </div>
      )}

      {!isLoading && rows.length > 0 && (
        <>
          {/* ── Desktop: log stream (กลุ่มตามวัน, บรรทัดเดียวต่อรายการ สแกนไวเหมือน log viewer) ── */}
          <div className="hidden md:block bg-surface border border-border rounded-xl overflow-hidden">
            {rows.map((row, i) => {
              const dateLabel = fmtDate(row.created_at);
              const showDateHeader = i === 0 || fmtDate(rows[i - 1].created_at) !== dateLabel;
              const isOpen = expanded === row.id;
              const hasDetail = row.old_value || row.new_value;
              return (
                <React.Fragment key={row.id}>
                  {showDateHeader && (
                    <div className="px-4 pt-3 pb-1.5 bg-bg text-[11px] font-semibold text-muted">
                      {dateLabel}
                    </div>
                  )}
                  <div
                    className={`flex items-center gap-3 px-4 py-2 border-t border-border text-small ${
                      isOpen ? 'bg-blue-50/60 dark:bg-blue-900' : 'hover:bg-accent/5 dark:hover:bg-white/5'
                    } ${hasDetail ? 'cursor-pointer' : ''}`}
                    onClick={() => hasDetail && toggleExpand(row.id)}
                  >
                    <span className="font-mono text-[11px] text-muted w-[52px] shrink-0">{fmtTime(row.created_at)}</span>
                    <span className="w-[100px] shrink-0"><ActionBadge act={row.action} /></span>
                    <span className="w-[170px] shrink-0 truncate">
                      <span className="text-text font-medium">{row.username || <span className="text-muted italic">ระบบ</span>}</span>
                      {row.full_name && <span className="text-muted text-[11px] ml-1">({row.full_name})</span>}
                    </span>
                    <span className="flex-1 min-w-0 truncate text-text">
                      <TableLabel name={row.table_name} />
                      {row.record_id > 0 && <span className="font-mono text-[11px] text-muted ml-1.5">#{row.record_id}</span>}
                    </span>
                    <span className="font-mono text-[11px] text-muted w-[110px] shrink-0 text-right">{row.ip_address || '-'}</span>
                    {hasDetail && (
                      <svg className={`w-3.5 h-3.5 text-muted shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    )}
                  </div>
                  {isOpen && (
                    <div className="px-4 pb-3 pt-1 bg-blue-50/60 dark:bg-blue-900 border-t border-border/50">
                      <div className={`grid gap-3 ${row.old_value && row.new_value ? 'grid-cols-2' : 'grid-cols-1 max-w-xl'}`}>
                        <JsonDetail label="ก่อนหน้า" value={row.old_value} />
                        <JsonDetail label="หลังแก้ไข" value={row.new_value} />
                      </div>
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>

          {/* ── Mobile Cards ── */}
          <div className="md:hidden space-y-2">
            {rows.map(row => {
              const isOpen = expanded === row.id;
              const hasDetail = row.old_value || row.new_value;
              return (
                <div
                  key={row.id}
                  className={`card transition-colors ${isOpen ? 'border-primary/30 bg-blue-50/40 dark:bg-blue-900' : ''}`}
                >
                  {/* Row 1: action badge + เวลา */}
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <ActionBadge act={row.action} />
                    <span className="text-[11px] text-muted font-mono shrink-0">
                      {fmtDt(row.created_at)}
                    </span>
                  </div>

                  {/* Row 2: ผู้ใช้ */}
                  <div className="flex items-center gap-2 mb-2">
                    <Avatar username={row.username} />
                    <div className="min-w-0">
                      <span className="text-small font-medium text-text">
                        {row.username || <span className="text-muted italic">ระบบ</span>}
                      </span>
                      {row.full_name && (
                        <span className="text-[11px] text-muted ml-1 truncate">({row.full_name})</span>
                      )}
                    </div>
                  </div>

                  {/* Row 3: หมวด + IP */}
                  <div className="flex items-center justify-between text-[11px] text-muted border-t border-border pt-2">
                    <span>
                      <TableLabel name={row.table_name} />
                      {row.record_id > 0 && (
                        <span className="font-mono ml-1 text-text">#{row.record_id}</span>
                      )}
                    </span>
                    {row.ip_address && (
                      <span className="font-mono">{row.ip_address}</span>
                    )}
                  </div>

                  {/* รายละเอียด toggle */}
                  {hasDetail && (
                    <>
                      <button
                        onClick={() => toggleExpand(row.id)}
                        className="mt-2 flex items-center gap-1 text-[12px] text-accent min-h-[36px]"
                      >
                        <svg
                          className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                          fill="none" viewBox="0 0 24 24" stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                        {isOpen ? 'ซ่อนรายละเอียด' : 'ดูรายละเอียด'}
                      </button>
                      {isOpen && (
                        <div className="mt-2 space-y-2">
                          <JsonDetail label="ก่อนหน้า" value={row.old_value} />
                          <JsonDetail label="หลังแก้ไข" value={row.new_value} />
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 gap-4 flex-wrap">
              <p className="text-small text-muted">
                หน้า {page} / {totalPages}
                <span className="ml-2 text-muted">({total.toLocaleString()} รายการ)</span>
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(1)}
                  disabled={page === 1}
                  className="px-2 min-h-[44px] text-small border border-border rounded-lg disabled:opacity-30 hover:bg-bg"
                  title="หน้าแรก"
                >«</button>
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 min-h-[44px] text-small border border-border rounded-lg disabled:opacity-30 hover:bg-bg"
                >ก่อนหน้า</button>
                <span className="text-small text-muted px-1">{page} / {totalPages}</span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 min-h-[44px] text-small border border-border rounded-lg disabled:opacity-30 hover:bg-bg"
                >ถัดไป</button>
                <button
                  onClick={() => setPage(totalPages)}
                  disabled={page === totalPages}
                  className="px-2 min-h-[44px] text-small border border-border rounded-lg disabled:opacity-30 hover:bg-bg"
                  title="หน้าสุดท้าย"
                >»</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
