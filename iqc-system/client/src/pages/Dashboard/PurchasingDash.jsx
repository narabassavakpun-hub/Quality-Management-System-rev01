import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import SortTh from '../../components/UI/SortTh';
import Pagination from '../../components/UI/Pagination';
import Badge from '../../components/UI/Badge';
import HeroStat, { HeroIcons } from '../../components/UI/HeroStat';
import api from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import DeliveryCalendar from '../Delivery/index';

// Req 2 — Purchasing Dashboard: สรุป + ผู้ผลิตของฉัน (เดียวกับ "Supplier Health", คอลัมน์เหมือนกันทุกตัวตาม
// requirement เดิม จึงใช้ query/ตารางเดียวกัน ไม่แยกซ้ำ) + NCR/NCP ของฉัน + ปฏิทินส่งของ (embed DeliveryCalendar
// เดิมตรงๆ — self-contained, ไม่ต้องมี prop, สร้าง/แก้ไขแผนส่งของได้ในหน้าเดียวกันเลย)
// Style ปรับตาม reference ที่ user ส่งมา (การ์ดสีเด่น + ตัวเลขใหญ่ + bar/donut chart) — คงโทนสี/token เดิมของระบบ
// (primary/warning/success/danger) ไม่ใช้สีนอกระบบ, ตาม CLAUDE.md §15/§25.3
const BUCKET_LABELS = {
  open: 'เปิด (รอ QC)',
  waiting_review: 'รอ Review',
  waiting_send_link: 'รอส่ง Link',
  waiting_supplier_response: 'รอ Supplier ตอบกลับ',
  in_progress: 'กำลังดำเนินการ',
  closed: 'ปิดแล้ว',
  cancelled: 'ยกเลิก',
};

const THAI_DAYS = ['วันอาทิตย์', 'วันจันทร์', 'วันอังคาร', 'วันพุธ', 'วันพฤหัสบดี', 'วันศุกร์', 'วันเสาร์'];
const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
function thaiTodayLabel() {
  const d = new Date();
  return `${THAI_DAYS[d.getDay()]}ที่ ${d.getDate()} ${THAI_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`;
}

function useSummary() {
  return useQuery({
    queryKey: ['purchasing-dashboard-summary'],
    queryFn: () => api.get('/purchasing/dashboard/summary').then(r => r.data),
  });
}

// ── Bar chart: สถานะ NCR/NCP (bucket distribution) ──
const BUCKET_CHART_COLORS = ['#D97706', '#D97706', '#2E6DA4', '#2E6DA4', '#16A34A', '#DC2626'];
function BucketBarChart({ summary }) {
  const data = [
    { name: 'รอ Review', value: summary?.ncr_waiting_review || 0 },
    { name: 'รอส่ง Link', value: summary?.ncr_waiting_send_link || 0 },
    { name: 'รอ Supplier ตอบ', value: summary?.ncr_waiting_supplier_response || 0 },
    { name: 'กำลังดำเนินการ', value: summary?.ncr_in_progress || 0 },
    { name: 'ปิดแล้ว', value: (summary?.ncr_closed || 0) + (summary?.ncp_closed || 0) },
    { name: 'เกินกำหนด', value: summary?.overdue || 0 },
  ];
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
        <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={110} />
        <Tooltip />
        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
          {data.map((d, i) => <Cell key={i} fill={BUCKET_CHART_COLORS[i]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Donut: อัตราปิดงาน ──
function ClosingRateDonut({ closed, total }) {
  const pct = total > 0 ? Math.round((closed / total) * 100) : 0;
  const data = [{ name: 'ปิดแล้ว', value: closed }, { name: 'ค้าง', value: Math.max(total - closed, 0) }];
  return (
    <div className="relative w-[160px] h-[160px]">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" cx="50%" cy="50%" innerRadius={50} outerRadius={72} startAngle={90} endAngle={-270} stroke="none" isAnimationActive>
            <Cell fill="#16A34A" />
            <Cell fill="rgb(var(--color-border))" />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-h1 font-bold text-success">{pct}%</span>
        <span className="text-[11px] text-muted">ปิดแล้ว ({closed}/{total})</span>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      className={`px-4 py-2 rounded-lg text-body font-medium min-h-[44px] transition-colors ${active ? 'bg-primary text-white' : 'bg-surface border border-border text-text hover:bg-bg'}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function SuppliersSection({ onPickSupplier }) {
  const [q, setQ] = useState('');
  const [sortKey, setSortKey] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [page, setPage] = useState(1);
  const limit = 10;

  const { data, isLoading, isError } = useQuery({
    queryKey: ['purchasing-dashboard-suppliers', q, sortKey, sortDir, page],
    queryFn: () => api.get('/purchasing/dashboard/suppliers', { params: { q, sort: sortKey, dir: sortDir, page, limit } }).then(r => r.data),
  });
  const rows = data?.data || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / limit);

  function onSort(col) {
    setSortDir(d => (sortKey === col ? (d === 'asc' ? 'desc' : 'asc') : 'asc'));
    setSortKey(col);
    setPage(1);
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div>
          <h2 className="text-h3 font-semibold text-primary">ผู้ผลิตของฉัน</h2>
          <p className="text-small text-muted">รวมข้อมูล Supplier Health ต่อผู้ผลิต — คลิกแถวเพื่อดู NCR/NCP ของผู้ผลิตนั้น</p>
        </div>
        <input className="input max-w-xs" placeholder="ค้นหาผู้ผลิต..." value={q} onChange={e => { setQ(e.target.value); setPage(1); }} />
      </div>
      {isError && <div className="text-danger text-small mb-2">โหลดข้อมูลไม่สำเร็จ</div>}
      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <SortTh col="code" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>รหัส</SortTh>
              <SortTh col="name" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>ผู้ผลิต</SortTh>
              <th>สถานะ</th>
              <SortTh col="ncr_total" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>NCR</SortTh>
              <SortTh col="ncp_total" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>NCP</SortTh>
              <SortTh col="open_count" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>เปิด</SortTh>
              <SortTh col="waiting_review_count" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>รอ Review</SortTh>
              <SortTh col="waiting_send_link_count" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>รอส่ง Link</SortTh>
              <SortTh col="waiting_supplier_response_count" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>รอ Supplier ตอบกลับ</SortTh>
              <SortTh col="in_progress_count" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>กำลังดำเนินการ</SortTh>
              <SortTh col="closed_count" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>ปิดแล้ว</SortTh>
              <SortTh col="overdue_count" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>เกินกำหนด</SortTh>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={12} className="text-center py-6 text-muted">กำลังโหลด...</td></tr>}
            {!isLoading && rows.length === 0 && <tr><td colSpan={12} className="text-center py-8 text-muted">ไม่พบข้อมูล</td></tr>}
            {rows.map(s => (
              <tr key={s.id} className="cursor-pointer" onClick={() => onPickSupplier(s.id)}>
                <td className="font-mono">{s.code || '-'}</td>
                <td>{s.name}</td>
                <td>
                  <span className={`badge ${s.is_active ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200' : 'bg-gray-100 dark:bg-gray-900 text-gray-500 dark:text-gray-200'}`}>
                    {s.is_active ? 'ใช้งาน' : 'ปิดใช้งาน'}
                  </span>
                </td>
                <td>{s.ncr_total}</td>
                <td>{s.ncp_total}</td>
                <td>{s.open_count}</td>
                <td>{s.waiting_review_count}</td>
                <td>{s.waiting_send_link_count}</td>
                <td>{s.waiting_supplier_response_count}</td>
                <td>{s.in_progress_count}</td>
                <td>{s.closed_count}</td>
                <td className={s.overdue_count > 0 ? 'text-danger font-semibold' : ''}>{s.overdue_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} totalPages={totalPages} total={total} limit={limit} onChange={setPage} />
    </div>
  );
}

function NcrSection({ navigate, presetSupplierId }) {
  const [supplierId, setSupplierId] = useState('');
  const [bucket, setBucket] = useState('');
  const [severity, setSeverity] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [overdue, setOverdue] = useState(false);
  const [page, setPage] = useState(1);
  const limit = 15;

  useEffect(() => {
    if (presetSupplierId) { setSupplierId(String(presetSupplierId)); setPage(1); }
  }, [presetSupplierId]);

  const { data: supplierOptions } = useQuery({
    queryKey: ['purchasing-dashboard-suppliers-all'],
    queryFn: () => api.get('/purchasing/dashboard/suppliers', { params: { limit: 200 } }).then(r => r.data.data),
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: ['purchasing-dashboard-ncrs', supplierId, bucket, severity, dateFrom, dateTo, overdue, page],
    queryFn: () => api.get('/purchasing/dashboard/ncrs', {
      params: {
        supplier_id: supplierId || undefined,
        bucket: bucket || undefined,
        severity: severity || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        overdue: overdue ? '1' : undefined,
        page, limit,
      },
    }).then(r => r.data),
  });
  const rows = data?.data || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / limit);

  function resetPage(setter) {
    return (e) => { setter(e.target.value); setPage(1); };
  }

  return (
    <div className="card">
      <h2 className="text-h3 font-semibold text-primary mb-3">NCR/NCP ของฉัน</h2>

      <div className="flex gap-3 mb-4 flex-wrap items-end">
        <div>
          <label className="label">Supplier</label>
          <select className="input w-auto" value={supplierId} onChange={resetPage(setSupplierId)}>
            <option value="">ทุก Supplier</option>
            {(supplierOptions || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">สถานะ</label>
          <select className="input w-auto" value={bucket} onChange={resetPage(setBucket)}>
            <option value="">ทุกสถานะ</option>
            {Object.entries(BUCKET_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </div>
        <div>
          <label className="label">ประเภท</label>
          <select className="input w-auto" value={severity} onChange={resetPage(setSeverity)}>
            <option value="">NCR + NCP</option>
            <option value="major">NCR (Major)</option>
            <option value="minor">NCP (Minor)</option>
          </select>
        </div>
        <div>
          <label className="label">วันที่เปิด (จาก)</label>
          <input type="date" className="input w-auto" value={dateFrom} onChange={resetPage(setDateFrom)} />
        </div>
        <div>
          <label className="label">วันที่เปิด (ถึง)</label>
          <input type="date" className="input w-auto" value={dateTo} onChange={resetPage(setDateTo)} />
        </div>
        <label className="flex items-center gap-2 text-body text-text min-h-[44px] cursor-pointer">
          <input
            type="checkbox"
            checked={overdue}
            onChange={e => { setOverdue(e.target.checked); setPage(1); }}
          />
          แสดงเฉพาะเกินกำหนด
        </label>
      </div>

      {isError && <div className="text-danger text-small mb-2">โหลดข้อมูลไม่สำเร็จ</div>}
      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>รหัส NCR/NCP</th>
              <th>Supplier</th>
              <th>ประเภท</th>
              <th>สถานะ</th>
              <th>วันที่เปิด</th>
              <th>กำหนดเสร็จ</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} className="text-center py-6 text-muted">กำลังโหลด...</td></tr>}
            {!isLoading && rows.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-muted">ไม่พบข้อมูล</td></tr>}
            {rows.map(n => (
              <tr key={n.id} className="cursor-pointer" onClick={() => navigate(`/ncr/${n.id}`)}>
                <td className="font-mono text-primary">{n.ncr_code}</td>
                <td>{n.supplier_name}</td>
                <td>
                  <span className={`badge ${n.severity === 'major' ? 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200' : 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-200'}`}>
                    {n.severity === 'major' ? 'NCR' : 'NCP'}
                  </span>
                </td>
                <td><Badge status={n.status} /></td>
                <td>{n.created_at?.slice(0, 10)}</td>
                <td className={n.is_overdue ? 'text-danger font-semibold' : ''}>{n.disposition_due_date || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} totalPages={totalPages} total={total} limit={limit} onChange={setPage} />
    </div>
  );
}

export default function PurchasingDash({ navigate }) {
  const { user } = useAuth();
  const { data: summary, isLoading: summaryLoading, isError: summaryError } = useSummary();
  const [tab, setTab] = useState('suppliers');
  const [presetSupplierId, setPresetSupplierId] = useState(null);

  function pickSupplier(id) {
    setPresetSupplierId(id);
    setTab('ncrs');
  }

  const activeWork = (summary?.ncr_waiting_review || 0) + (summary?.ncr_waiting_send_link || 0)
    + (summary?.ncr_waiting_supplier_response || 0) + (summary?.ncr_in_progress || 0);
  const closedAll = (summary?.ncr_closed || 0) + (summary?.ncp_closed || 0);
  const totalAll = (summary?.ncr_total || 0) + (summary?.ncp_total || 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">สวัสดี, {user?.full_name}</h1>
        <p className="text-muted text-small mt-0.5">วันนี้{thaiTodayLabel()}</p>
      </div>

      {summaryError && <div className="card text-danger text-small">โหลดสรุปข้อมูลไม่สำเร็จ</div>}

      {/* Hero stats — เน้นสี+ตัวเลขใหญ่ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <HeroStat icon={HeroIcons.building} value={summaryLoading ? '-' : summary?.supplier_count} label="Supplier ที่ดูแล" tone="primary" />
        <HeroStat icon={HeroIcons.tasks} value={summaryLoading ? '-' : activeWork} label="งานที่ต้องดำเนินการ" tone="warning" />
        <HeroStat icon={HeroIcons.check} value={summaryLoading ? '-' : closedAll} label="ปิดแล้ว" tone="success" />
        <HeroStat icon={HeroIcons.alert} value={summaryLoading ? '-' : summary?.overdue} label="เกินกำหนด" tone="danger" emphasize />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card lg:col-span-2">
          <h2 className="text-h3 font-semibold text-primary mb-2">สถานะ NCR/NCP</h2>
          {summaryLoading ? <div className="h-[220px] flex items-center justify-center text-muted">กำลังโหลด...</div> : <BucketBarChart summary={summary} />}
        </div>
        <div className="card flex flex-col items-center justify-center">
          <h2 className="text-h3 font-semibold text-primary mb-2 self-start">อัตราปิดงาน</h2>
          {summaryLoading ? <div className="h-[160px] flex items-center justify-center text-muted">กำลังโหลด...</div> : <ClosingRateDonut closed={closedAll} total={totalAll} />}
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <TabButton active={tab === 'suppliers'} onClick={() => setTab('suppliers')}>ผู้ผลิตของฉัน</TabButton>
        <TabButton active={tab === 'ncrs'} onClick={() => setTab('ncrs')}>NCR/NCP ของฉัน</TabButton>
        <TabButton active={tab === 'delivery'} onClick={() => setTab('delivery')}>ปฏิทินส่งของ</TabButton>
      </div>

      {tab === 'suppliers' && <SuppliersSection onPickSupplier={pickSupplier} />}
      {tab === 'ncrs' && <NcrSection navigate={navigate} presetSupplierId={presetSupplierId} />}
      {tab === 'delivery' && (
        <div className="card p-0 overflow-hidden">
          <DeliveryCalendar />
        </div>
      )}
    </div>
  );
}
