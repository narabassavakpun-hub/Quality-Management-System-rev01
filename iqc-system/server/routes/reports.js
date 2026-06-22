const express = require('express');
const router = express.Router();
const db = require('../db/database');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');

const REPORT_ROLES = ['qc_manager', 'cco', 'cmo', 'cpo'];
const MAX_REPORT_ROWS = 2000; // DEVMORE M13 — กัน result set ไม่จำกัด (summary คำนวณจาก SQL เต็มชุด)

function buildDateFilter(from, to, col) {
  const parts = [];
  const params = [];
  if (from) { parts.push(`DATE(${col}) >= ?`); params.push(from); }
  if (to) { parts.push(`DATE(${col}) <= ?`); params.push(to); }
  return { sql: parts.length ? ' AND ' + parts.join(' AND ') : '', params };
}

// GET /api/reports/receiving
router.get('/receiving', auth, requireRole(REPORT_ROLES), (req, res) => {
  const { from, to, supplier_id, product_group_id } = req.query;
  const dateFilter = buildDateFilter(from, to, 'b.received_date');
  const params = [...dateFilter.params];
  let extra = dateFilter.sql;
  if (supplier_id) { extra += ' AND b.supplier_id = ?'; params.push(supplier_id); }

  const bills = db.prepare(`
    SELECT b.*, s.name as supplier_name,
           COUNT(bi.id) as item_count,
           SUM(bi.qty_passed) as total_passed,
           SUM(bi.qty_failed) as total_failed,
           SUM(bi.qty_received) as total_received
    FROM bills b
    LEFT JOIN suppliers s ON s.id = b.supplier_id
    LEFT JOIN bill_items bi ON bi.bill_id = b.id
    WHERE 1=1 ${extra}
    GROUP BY b.id ORDER BY b.received_date DESC
    LIMIT ${MAX_REPORT_ROWS}
  `).all(...params);

  // DEVMORE M13 — summary จาก SQL aggregate (ครบทั้งชุด ไม่ใช่เฉพาะ list ที่ cap)
  const agg = db.prepare(`
    SELECT COUNT(DISTINCT b.id) as total_bills, COUNT(bi.id) as total_items,
           SUM(bi.qty_received) as total_received, SUM(bi.qty_passed) as total_passed, SUM(bi.qty_failed) as total_failed
    FROM bills b LEFT JOIN suppliers s ON s.id = b.supplier_id
    LEFT JOIN bill_items bi ON bi.bill_id = b.id WHERE 1=1 ${extra}
  `).get(...params);
  const summary = {
    total_bills: agg.total_bills || 0,
    total_items: agg.total_items || 0,
    total_passed: agg.total_passed || 0,
    total_failed: agg.total_failed || 0,
    total_received: agg.total_received || 0,
  };
  summary.pass_rate = summary.total_received > 0 ? ((summary.total_passed / summary.total_received) * 100).toFixed(1) : '0.0';

  res.json({ summary, bills, truncated: bills.length >= MAX_REPORT_ROWS });
});

// GET /api/reports/ncr
router.get('/ncr', auth, requireRole(REPORT_ROLES), (req, res) => {
  const { from, to, supplier_id, product_group_id } = req.query;
  const dateFilter = buildDateFilter(from, to, 'n.created_at');
  const params = [...dateFilter.params];
  let extra = dateFilter.sql;
  if (supplier_id) { extra += ' AND b.supplier_id = ?'; params.push(supplier_id); }

  const ncrs = db.prepare(`
    SELECT n.*, s.name as supplier_name,
           b.invoice_no, b.po_no as bill_po,
           COUNT(ni.id) as item_count
    FROM ncrs n
    LEFT JOIN bills b ON b.id = n.bill_id
    LEFT JOIN suppliers s ON s.id = b.supplier_id
    LEFT JOIN ncr_items ni ON ni.ncr_id = n.id
    WHERE 1=1 ${extra}
    GROUP BY n.id
    ORDER BY n.created_at DESC
    LIMIT ${MAX_REPORT_ROWS}
  `).all(...params);

  // DEVMORE M13 — summary จาก SQL aggregate (ครบทั้งชุด)
  const openStatuses = ['pending_supervisor', 'pending_manager', 'pending_qmr_open', 'pending_supplier', 'pending_manager_review', 'pending_qmr_close', 'pending_uai'];
  const openIn = openStatuses.map(() => '?').join(',');
  const agg = db.prepare(`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN n.status IN (${openIn}) THEN 1 ELSE 0 END) as open,
           SUM(CASE WHEN n.status = 'closed' THEN 1 ELSE 0 END) as closed,
           SUM(CASE WHEN n.status = 'pending_supplier' THEN 1 ELSE 0 END) as pending_supplier,
           SUM(CASE WHEN n.severity = 'major' THEN 1 ELSE 0 END) as major,
           SUM(CASE WHEN n.severity = 'minor' THEN 1 ELSE 0 END) as minor
    FROM ncrs n LEFT JOIN bills b ON b.id = n.bill_id WHERE 1=1 ${extra}
  `).get(...openStatuses, ...params);
  const summary = {
    total: agg.total || 0, open: agg.open || 0, closed: agg.closed || 0,
    pending_supplier: agg.pending_supplier || 0, major: agg.major || 0, minor: agg.minor || 0,
  };

  res.json({ summary, ncrs, truncated: ncrs.length >= MAX_REPORT_ROWS });
});

// GET /api/reports/uai
router.get('/uai', auth, requireRole(REPORT_ROLES), (req, res) => {
  const { from, to, supplier_id } = req.query;
  const dateFilter = buildDateFilter(from, to, 'u.created_at');
  const params = [...dateFilter.params];
  let extra = dateFilter.sql;
  if (supplier_id) { extra += ' AND b.supplier_id = ?'; params.push(supplier_id); }

  const uais = db.prepare(`
    SELECT u.*, n.ncr_code, s.name as supplier_name
    FROM uai_documents u
    LEFT JOIN ncrs n ON n.id = u.ncr_id
    LEFT JOIN bills b ON b.id = n.bill_id
    LEFT JOIN suppliers s ON s.id = b.supplier_id
    WHERE 1=1 ${extra}
    ORDER BY u.created_at DESC
    LIMIT ${MAX_REPORT_ROWS}
  `).all(...params);

  // DEVMORE M13 — summary จาก SQL aggregate (ครบทั้งชุด)
  const agg = db.prepare(`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN u.status = 'uai_completed' THEN 1 ELSE 0 END) as completed,
           SUM(CASE WHEN u.status NOT IN ('uai_completed','uai_rejected') THEN 1 ELSE 0 END) as pending,
           SUM(CASE WHEN u.status = 'uai_rejected' THEN 1 ELSE 0 END) as rejected
    FROM uai_documents u
    LEFT JOIN ncrs n ON n.id = u.ncr_id
    LEFT JOIN bills b ON b.id = n.bill_id WHERE 1=1 ${extra}
  `).get(...params);
  const summary = {
    total: agg.total || 0, completed: agg.completed || 0,
    pending: agg.pending || 0, rejected: agg.rejected || 0,
  };

  res.json({ summary, uais, truncated: uais.length >= MAX_REPORT_ROWS });
});

// GET /api/reports/summary
router.get('/summary', auth, requireRole(REPORT_ROLES), (req, res) => {
  const { from, to, supplier_id } = req.query;
  const dateFilter = buildDateFilter(from, to, 'b.received_date');
  const params = [...dateFilter.params];
  let extra = dateFilter.sql;
  if (supplier_id) { extra += ' AND b.supplier_id = ?'; params.push(supplier_id); }

  const billStats = db.prepare(`
    SELECT COUNT(DISTINCT b.id) as total_bills,
           SUM(bi.qty_received) as total_received,
           SUM(bi.qty_passed) as total_passed,
           SUM(bi.qty_failed) as total_failed
    FROM bills b LEFT JOIN bill_items bi ON bi.bill_id = b.id WHERE 1=1 ${extra}
  `).get(...params);

  const ncrDateFilter = buildDateFilter(from, to, 'n.created_at');
  const ncrParams = [...ncrDateFilter.params];
  let ncrExtra = ncrDateFilter.sql;
  if (supplier_id) { ncrExtra += ' AND b2.supplier_id = ?'; ncrParams.push(supplier_id); }

  const ncrStats = db.prepare(`
    SELECT COUNT(*) as total_ncr,
           SUM(CASE WHEN n.status NOT IN ('closed') THEN 1 ELSE 0 END) as open_ncr
    FROM ncrs n LEFT JOIN bills b2 ON b2.id = n.bill_id WHERE 1=1 ${ncrExtra}
  `).get(...ncrParams);

  const uaiStats = db.prepare(`
    SELECT COUNT(*) as total_uai FROM uai_documents u
    LEFT JOIN ncrs n ON n.id = u.ncr_id
    LEFT JOIN bills b3 ON b3.id = n.bill_id
    WHERE 1=1 ${ncrDateFilter.sql.replace(/b2\./g, 'b3.')}
  `).get(...ncrDateFilter.params, ...(supplier_id ? [supplier_id] : []));

  const topNcrSuppliers = db.prepare(`
    SELECT s.name, COUNT(n.id) as ncr_count
    FROM ncrs n
    LEFT JOIN bills b ON b.id = n.bill_id
    LEFT JOIN suppliers s ON s.id = b.supplier_id
    WHERE 1=1 ${ncrExtra}
    GROUP BY s.id ORDER BY ncr_count DESC LIMIT 5
  `).all(...ncrParams);

  const topDefects = db.prepare(`
    SELECT dc.name, COUNT(DISTINCT n.id) as ncr_count
    FROM ncrs n
    LEFT JOIN ncr_items ni ON ni.ncr_id = n.id
    LEFT JOIN defect_categories dc ON dc.id = ni.defect_category_id
    LEFT JOIN bills b ON b.id = n.bill_id
    WHERE 1=1 ${ncrExtra}
    GROUP BY dc.id ORDER BY ncr_count DESC LIMIT 5
  `).all(...ncrParams);

  const supplierScorecard = db.prepare(`
    SELECT s.name as supplier_name,
           COUNT(DISTINCT b.id) as total_bills,
           COUNT(n.id) as total_ncr,
           COUNT(u.id) as total_uai
    FROM suppliers s
    LEFT JOIN bills b ON b.supplier_id = s.id ${extra ? 'AND 1=1 ' + extra : ''}
    LEFT JOIN ncrs n ON n.bill_id = b.id
    LEFT JOIN uai_documents u ON u.ncr_id = n.id
    GROUP BY s.id ORDER BY total_ncr DESC
  `).all(...params);

  const passRate = billStats.total_received > 0
    ? ((billStats.total_passed / billStats.total_received) * 100).toFixed(1)
    : '0.0';

  res.json({
    summary: {
      total_bills: billStats.total_bills || 0,
      total_received: billStats.total_received || 0,
      pass_rate: passRate,
      total_ncr: ncrStats.total_ncr || 0,
      open_ncr: ncrStats.open_ncr || 0,
      total_uai: uaiStats.total_uai || 0,
    },
    top_ncr_suppliers: topNcrSuppliers,
    top_defects: topDefects,
    supplier_scorecard: supplierScorecard,
  });
});

module.exports = router;
