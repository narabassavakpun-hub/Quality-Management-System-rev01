// GET /api/dashboard/stats — aggregate เดียวแทน 4 endpoint x limit=500 (Bills/NCR/UAI) ที่หน้า Dashboard เดิมดึงมาแล้วคำนวณฝั่ง client
// AUDIT.md §8 P1 + §12 P2 (Dashboard split) — ตัวเลข/รายการต้องตรงกับที่ client เคยคำนวณเป๊ะ (ดู client/src/pages/Dashboard/*.jsx เดิม)
const express = require('express');
const router = express.Router();
const db = require('../db/database');
const auth = require('../middleware/auth');

const NCR_OPEN_STATUSES = ['pending_supervisor','pending_manager','pending_qmr_open','pending_supplier','pending_manager_review','pending_qmr_close','pending_uai'];
const UAI_FINAL_STATUSES = ['uai_completed','uai_rejected','uai_rejected_by_exec'];
const EXEC_SIGN_STATUS = { cco: 'uai_pending_cco', cmo: 'uai_pending_cmo', cpo: 'uai_pending_cpo' };

const BILL_FIELDS = `b.id, b.invoice_no, b.po_no, b.status, b.received_date, b.created_at, s.name as supplier_name,
  (SELECT COUNT(*) FROM bill_items bi2 WHERE bi2.bill_id = b.id AND bi2.qty_failed > 0) as failed_item_count`;
// หมายเหตุ: ncrs ไม่มีคอลัมน์ item_name จริง (อยู่ที่ ncr_items) — /api/ncr LIST endpoint เดิมก็ไม่ join คอลัมน์นี้
// (n.item_name จะ undefined เสมอในตาราง dashboard เช่นเดียวกับพฤติกรรมเดิมก่อน refactor — คงไว้ตามเดิม ไม่ join เพิ่ม)
const NCR_FIELDS = `n.id, n.ncr_code, n.status, n.severity, n.created_at, s.name as supplier_name`;
const UAI_FIELDS = `u.id, u.uai_code, u.status, u.created_at, n.ncr_code, s.name as supplier_name`;

router.get('/stats', auth, (req, res) => {
  // ── Bills ──
  const today_bills = db.prepare("SELECT COUNT(*) c FROM bills WHERE DATE(created_at)=DATE('now')").get().c;
  const week_bills = db.prepare("SELECT COUNT(*) c FROM bills WHERE (julianday('now') - julianday(created_at)) <= 7").get().c;
  const total_bills = db.prepare('SELECT COUNT(*) c FROM bills').get().c;

  const approvedAgg = db.prepare(`
    SELECT COUNT(*) as approved,
      SUM(CASE WHEN (SELECT COUNT(*) FROM bill_items bi WHERE bi.bill_id=b.id AND bi.qty_failed>0) = 0 THEN 1 ELSE 0 END) as passed
    FROM bills b WHERE b.status='approved'
  `).get();
  const approved_bills = approvedAgg.approved || 0;
  const passed_bills = approvedAgg.passed || 0;
  const failed_bills = approved_bills - passed_bills;
  const pass_rate = approved_bills > 0 ? Math.round((passed_bills / approved_bills) * 100) : 0;

  const last7Raw = db.prepare(`
    SELECT DATE(created_at) as d, COUNT(*) as total,
      SUM(CASE WHEN (SELECT COUNT(*) FROM bill_items bi WHERE bi.bill_id=b.id AND bi.qty_failed>0) > 0 THEN 1 ELSE 0 END) as failed
    FROM bills b
    WHERE DATE(created_at) >= DATE('now', '-6 days')
    GROUP BY DATE(created_at)
  `).all();
  const last7Map = {};
  last7Raw.forEach(r => { last7Map[r.d] = r; });
  const bills_last7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const ds = d.toISOString().slice(0, 10);
    const row = last7Map[ds];
    return { date: `${d.getDate()}/${d.getMonth() + 1}`, รับเข้า: row?.total || 0, ไม่ผ่าน: row?.failed || 0 };
  });

  const recent_bills = db.prepare(`
    SELECT ${BILL_FIELDS} FROM bills b LEFT JOIN suppliers s ON s.id = b.supplier_id
    ORDER BY b.created_at DESC LIMIT 8
  `).all();

  const pending_approval_bills = db.prepare(`
    SELECT ${BILL_FIELDS} FROM bills b LEFT JOIN suppliers s ON s.id = b.supplier_id
    WHERE b.status = 'pending_approval' ORDER BY b.created_at DESC
  `).all();

  // ── NCR ──
  const ncr_total = db.prepare('SELECT COUNT(*) c FROM ncrs').get().c;
  const ncr_major_total  = db.prepare("SELECT COUNT(*) c FROM ncrs WHERE severity='major'").get().c;
  const ncr_major_open   = db.prepare("SELECT COUNT(*) c FROM ncrs WHERE severity='major' AND status NOT IN ('closed','cancelled')").get().c;
  const ncr_major_closed = db.prepare("SELECT COUNT(*) c FROM ncrs WHERE severity='major' AND status='closed'").get().c;
  const ncr_minor_total  = db.prepare("SELECT COUNT(*) c FROM ncrs WHERE severity='minor'").get().c;
  const ncr_minor_open   = db.prepare("SELECT COUNT(*) c FROM ncrs WHERE severity='minor' AND status NOT IN ('ncp_closed','cancelled')").get().c;
  const ncr_minor_closed = db.prepare("SELECT COUNT(*) c FROM ncrs WHERE severity='minor' AND status='ncp_closed'").get().c;
  const ncr_closed_count     = db.prepare("SELECT COUNT(*) c FROM ncrs WHERE status='closed'").get().c;
  const ncr_not_closed_count = db.prepare("SELECT COUNT(*) c FROM ncrs WHERE status!='closed'").get().c;
  const ncr_open_statuses_count = db.prepare(
    `SELECT COUNT(*) c FROM ncrs WHERE status IN (${NCR_OPEN_STATUSES.map(() => '?').join(',')})`
  ).get(...NCR_OPEN_STATUSES).c;
  const ncr_pending_supplier_count = db.prepare("SELECT COUNT(*) c FROM ncrs WHERE status='pending_supplier'").get().c;
  const ncr_pending_manager_review_count = db.prepare("SELECT COUNT(*) c FROM ncrs WHERE status='pending_manager_review'").get().c;

  const ncrByStatusRows = db.prepare('SELECT status, COUNT(*) as c FROM ncrs GROUP BY status').all();
  const ncr_by_status = {};
  ncrByStatusRows.forEach(r => { ncr_by_status[r.status] = r.c; });

  const ncr_pending_supervisor = db.prepare(`
    SELECT ${NCR_FIELDS} FROM ncrs n LEFT JOIN bills b ON b.id=n.bill_id LEFT JOIN suppliers s ON s.id=b.supplier_id
    WHERE n.status='pending_supervisor' ORDER BY n.created_at DESC
  `).all();

  const ncr_open_recent = db.prepare(`
    SELECT ${NCR_FIELDS} FROM ncrs n LEFT JOIN bills b ON b.id=n.bill_id LEFT JOIN suppliers s ON s.id=b.supplier_id
    WHERE n.status IN (${NCR_OPEN_STATUSES.map(() => '?').join(',')})
    ORDER BY n.created_at DESC LIMIT 15
  `).all(...NCR_OPEN_STATUSES);

  const ncr_pending_qmr = db.prepare(`
    SELECT ${NCR_FIELDS} FROM ncrs n LEFT JOIN bills b ON b.id=n.bill_id LEFT JOIN suppliers s ON s.id=b.supplier_id
    WHERE n.status IN ('pending_qmr_open','pending_qmr_close') ORDER BY n.created_at DESC
  `).all();

  const ncr_pending_supplier_list = db.prepare(`
    SELECT ${NCR_FIELDS} FROM ncrs n LEFT JOIN bills b ON b.id=n.bill_id LEFT JOIN suppliers s ON s.id=b.supplier_id
    WHERE n.status='pending_supplier' ORDER BY n.created_at DESC
  `).all();

  // ── UAI ──
  const uai_total = db.prepare('SELECT COUNT(*) c FROM uai_documents').get().c;
  const uai_completed_count = db.prepare("SELECT COUNT(*) c FROM uai_documents WHERE status='uai_completed'").get().c;
  const uai_not_final_count = db.prepare(
    `SELECT COUNT(*) c FROM uai_documents WHERE status NOT IN (${UAI_FINAL_STATUSES.map(() => '?').join(',')})`
  ).get(...UAI_FINAL_STATUSES).c;
  const uai_pending_purchasing_count = db.prepare("SELECT COUNT(*) c FROM uai_documents WHERE status='uai_pending_purchasing'").get().c;

  const uai_pending_production_ack = db.prepare(`
    SELECT ${UAI_FIELDS} FROM uai_documents u LEFT JOIN ncrs n ON n.id=u.ncr_id
    LEFT JOIN bills b ON b.id=n.bill_id LEFT JOIN suppliers s ON s.id=b.supplier_id
    WHERE u.status='uai_pending_production_ack' ORDER BY u.created_at DESC
  `).all();

  const mySignStatus = EXEC_SIGN_STATUS[req.user.role];
  const uai_my_sign = mySignStatus ? db.prepare(`
    SELECT ${UAI_FIELDS} FROM uai_documents u LEFT JOIN ncrs n ON n.id=u.ncr_id
    LEFT JOIN bills b ON b.id=n.bill_id LEFT JOIN suppliers s ON s.id=b.supplier_id
    WHERE u.status=? ORDER BY u.created_at DESC
  `).all(mySignStatus) : [];

  res.json({
    today_bills, week_bills, total_bills, approved_bills, passed_bills, failed_bills, pass_rate,
    bills_last7, recent_bills, pending_approval_bills,
    ncr_total, ncr_major_total, ncr_major_open, ncr_major_closed,
    ncr_minor_total, ncr_minor_open, ncr_minor_closed,
    ncr_closed_count, ncr_not_closed_count, ncr_open_statuses_count,
    ncr_pending_supplier_count, ncr_pending_manager_review_count, ncr_by_status,
    ncr_pending_supervisor, ncr_open_recent, ncr_pending_qmr, ncr_pending_supplier_list,
    uai_total, uai_completed_count, uai_not_final_count, uai_pending_purchasing_count,
    uai_pending_production_ack, uai_my_sign,
  });
});

module.exports = router;
