// Purchasing Dashboard aggregate queries — สรุป/รายการ NCR-NCP ต่อ Supplier ที่จัดซื้อดูแล (scope ผ่าน
// purchasingScope.js) ไม่แตะ GET /api/dashboard/stats เดิม (ใช้ร่วมกันทุก role อื่นอยู่แล้ว)
// อ่านอย่างเดียวทั้งไฟล์ — ไม่มี write operation จึงไม่ต้องมี transaction
const db = require('../db/database');
const { purchasingVisibilitySQL } = require('../lib/purchasingScope');

// bucket mapping อ้างอิง NCR status flow เดิม (CLAUDE.md §4) — ไม่มี status ใหม่ ไม่มี column ใหม่
// severity='minor' (NCP) ปิดผ่าน ncp_closed โดยไม่ผ่าน purchasing เลย จึงไม่ปรากฏใน bucket
// waiting_review/waiting_send_link/waiting_supplier_response/in_progress ตามธรรมชาติของ workflow เดิม
const BUCKET_CASE = `
  CASE
    WHEN n.status IN ('closed','ncp_closed') THEN 'closed'
    WHEN n.status = 'cancelled' THEN 'cancelled'
    WHEN n.status = 'pending_purchasing_review' THEN 'waiting_review'
    WHEN n.status = 'pending_supplier' AND n.link_copied_at IS NULL THEN 'waiting_send_link'
    WHEN n.status = 'pending_supplier' THEN 'waiting_supplier_response'
    WHEN n.status IN ('pending_manager_review','pending_qmr_close','pending_supplier_resubmit','pending_uai','uai_pending_qc_manager') THEN 'in_progress'
    WHEN n.status IN ('pending_supervisor','pending_manager','pending_qmr_open') THEN 'open'
    ELSE 'other'
  END
`;
const IN_PROGRESS_STATUSES = "('pending_manager_review','pending_qmr_close','pending_supplier_resubmit','pending_uai','uai_pending_qc_manager')";
// overdue อ้าง disposition_due_date ที่มีอยู่แล้ว (ncrs) — ไม่ใช่ column ใหม่ (ดู plan §"KPI data sources")
const OVERDUE_EXPR = "(n.disposition_due_date IS NOT NULL AND n.disposition_due_date < date('now') AND n.status NOT IN ('closed','ncp_closed','cancelled'))";

// purchasing → เห็นเฉพาะ supplier ที่ตัวเองดูแล (หรือ supplier ที่ไม่มีใครดูแลเลย, fallback เดิม);
// purchasing_manager/admin → เห็นทั้งหมด ไม่ถูกกรอง
function scopeClause(user, supplierIdExpr) {
  if (user.role === 'purchasing') return { sql: purchasingVisibilitySQL(supplierIdExpr), params: [user.id] };
  return { sql: '1=1', params: [] };
}

function getSummary(user) {
  const scope = scopeClause(user, 's.id');
  const p = scope.params;
  const base = `FROM ncrs n JOIN bills b ON b.id = n.bill_id JOIN suppliers s ON s.id = b.supplier_id WHERE ${scope.sql}`;

  const supplier_count = db.prepare(`SELECT COUNT(*) c FROM suppliers s WHERE ${scope.sql} AND s.is_active = 1`).get(...p).c;
  const ncr_total                       = db.prepare(`SELECT COUNT(*) c ${base} AND n.severity = 'major'`).get(...p).c;
  const ncp_total                       = db.prepare(`SELECT COUNT(*) c ${base} AND n.severity = 'minor'`).get(...p).c;
  const ncr_waiting_review              = db.prepare(`SELECT COUNT(*) c ${base} AND n.status = 'pending_purchasing_review'`).get(...p).c;
  const ncr_waiting_send_link           = db.prepare(`SELECT COUNT(*) c ${base} AND n.status = 'pending_supplier' AND n.link_copied_at IS NULL`).get(...p).c;
  const ncr_waiting_supplier_response   = db.prepare(`SELECT COUNT(*) c ${base} AND n.status = 'pending_supplier' AND n.link_copied_at IS NOT NULL`).get(...p).c;
  const ncr_in_progress                 = db.prepare(`SELECT COUNT(*) c ${base} AND n.status IN ${IN_PROGRESS_STATUSES}`).get(...p).c;
  const ncr_closed                      = db.prepare(`SELECT COUNT(*) c ${base} AND n.severity = 'major' AND n.status = 'closed'`).get(...p).c;
  const ncp_open                        = db.prepare(`SELECT COUNT(*) c ${base} AND n.severity = 'minor' AND n.status NOT IN ('ncp_closed','cancelled')`).get(...p).c;
  const ncp_closed                      = db.prepare(`SELECT COUNT(*) c ${base} AND n.severity = 'minor' AND n.status = 'ncp_closed'`).get(...p).c;
  const overdue                         = db.prepare(`SELECT COUNT(*) c ${base} AND ${OVERDUE_EXPR}`).get(...p).c;

  return {
    supplier_count, ncr_total, ncp_total,
    ncr_waiting_review, ncr_waiting_send_link, ncr_waiting_supplier_response, ncr_in_progress, ncr_closed,
    ncp_open, ncp_closed, overdue,
  };
}

const SUPPLIER_SORT_COLUMNS = {
  name: 's.name', code: 's.code',
  ncr_total: 'ncr_total', ncp_total: 'ncp_total',
  open_count: 'open_count', waiting_review_count: 'waiting_review_count',
  waiting_send_link_count: 'waiting_send_link_count', waiting_supplier_response_count: 'waiting_supplier_response_count',
  in_progress_count: 'in_progress_count', closed_count: 'closed_count', overdue_count: 'overdue_count',
};

// "My Suppliers" (Req 2) และ "Supplier Health" (Req 2) ใช้ query เดียวกัน — คอลัมน์ที่ทั้งสอง section
// ขอในเอกสารเหมือนกันทุกตัว (Supplier + NCR/NCP + bucket breakdown + overdue) จึงไม่แยก endpoint ซ้ำ
function getSuppliers(user, { page = 1, limit = 20, q = '', sort = 'name', dir = 'asc', all } = {}) {
  const scope = scopeClause(user, 's.id');
  const sortCol = SUPPLIER_SORT_COLUMNS[sort] || 's.name';
  const sortDir = String(dir).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const perPage = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const pg = Math.max(parseInt(page, 10) || 1, 1);
  const offset = (pg - 1) * perPage;

  const conds = [scope.sql];
  const params = [...scope.params];
  if (all !== '1') { conds.push('s.is_active = 1'); }
  if (q) { conds.push('(s.name LIKE ? OR s.code LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  const whereSql = conds.join(' AND ');

  const total = db.prepare(`SELECT COUNT(*) c FROM suppliers s WHERE ${whereSql}`).get(...params).c;

  const rows = db.prepare(`
    SELECT s.id, s.code, s.name, s.is_active,
      COUNT(CASE WHEN n.severity = 'major' THEN 1 END) AS ncr_total,
      COUNT(CASE WHEN n.severity = 'minor' THEN 1 END) AS ncp_total,
      COUNT(CASE WHEN n.status IN ('pending_supervisor','pending_manager','pending_qmr_open') THEN 1 END) AS open_count,
      COUNT(CASE WHEN n.status = 'pending_purchasing_review' THEN 1 END) AS waiting_review_count,
      COUNT(CASE WHEN n.status = 'pending_supplier' AND n.link_copied_at IS NULL THEN 1 END) AS waiting_send_link_count,
      COUNT(CASE WHEN n.status = 'pending_supplier' AND n.link_copied_at IS NOT NULL THEN 1 END) AS waiting_supplier_response_count,
      COUNT(CASE WHEN n.status IN ${IN_PROGRESS_STATUSES} THEN 1 END) AS in_progress_count,
      COUNT(CASE WHEN n.status IN ('closed','ncp_closed') THEN 1 END) AS closed_count,
      COUNT(CASE WHEN ${OVERDUE_EXPR} THEN 1 END) AS overdue_count
    FROM suppliers s
    LEFT JOIN bills b ON b.supplier_id = s.id
    LEFT JOIN ncrs n ON n.bill_id = b.id
    WHERE ${whereSql}
    GROUP BY s.id
    ORDER BY ${sortCol} ${sortDir}
    LIMIT ? OFFSET ?
  `).all(...params, perPage, offset);

  return { data: rows, total, page: pg, limit: perPage };
}

// "My NCR/NCP" (Req 2) — filter: supplier_id, bucket (status bucket), severity (Priority), date_from/date_to, overdue, q
function getNcrList(user, { page = 1, limit = 20, supplier_id, bucket, severity, date_from, date_to, overdue, q = '' } = {}) {
  const scope = scopeClause(user, 's.id');
  const perPage = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const pg = Math.max(parseInt(page, 10) || 1, 1);
  const offset = (pg - 1) * perPage;

  const conds = [scope.sql];
  const params = [...scope.params];
  if (supplier_id) { conds.push('s.id = ?'); params.push(supplier_id); }
  if (severity === 'major' || severity === 'minor') { conds.push('n.severity = ?'); params.push(severity); }
  if (date_from) { conds.push('date(n.created_at) >= date(?)'); params.push(date_from); }
  if (date_to) { conds.push('date(n.created_at) <= date(?)'); params.push(date_to); }
  if (overdue === '1') { conds.push(OVERDUE_EXPR); }
  if (q) { conds.push('(n.ncr_code LIKE ? OR s.name LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  const whereSql = conds.join(' AND ');

  const baseSelect = `
    SELECT n.id, n.ncr_code, n.severity, n.status, n.created_at, n.disposition_due_date, n.link_copied_at,
      s.id as supplier_id, s.name as supplier_name,
      ${BUCKET_CASE} as bucket,
      CASE WHEN ${OVERDUE_EXPR} THEN 1 ELSE 0 END as is_overdue
    FROM ncrs n
    JOIN bills b ON b.id = n.bill_id
    JOIN suppliers s ON s.id = b.supplier_id
    WHERE ${whereSql}
  `;
  // bucket คำนวณจาก CASE ใน SELECT — filter บน alias ต้องครอบ subquery (SQLite ไม่ให้ใช้ alias ใน WHERE ระดับเดียวกัน)
  const bucketFilter = bucket ? 'WHERE x.bucket = ?' : '';
  const bucketParams = bucket ? [bucket] : [];

  const total = db.prepare(`SELECT COUNT(*) c FROM (${baseSelect}) x ${bucketFilter}`).get(...params, ...bucketParams).c;
  const rows = db.prepare(`SELECT * FROM (${baseSelect}) x ${bucketFilter} ORDER BY x.created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, ...bucketParams, perPage, offset);

  return { data: rows, total, page: pg, limit: perPage };
}

module.exports = { getSummary, getSuppliers, getNcrList };
