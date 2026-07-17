const express = require('express');
const router = express.Router();
const db = require('../db/database');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');

const REPORT_ROLES = ['qc_supervisor', 'qc_manager', 'purchasing_manager', 'cco', 'cmo', 'cpo'];
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

  // รายการ = จำนวนแถว bill_items (ไม่ใช่ผลรวมจำนวนชิ้น qty_received) — ผ่าน/ไม่ผ่านนับจาก "รายการที่มีการออก NCR"
  // (ni.bill_item_id) เทียบกับรายการทั้งหมด ไม่ใช่ qty_passed/qty_failed (คำขอ user — ดู DEVLOG)
  const bills = db.prepare(`
    SELECT b.*, s.name as supplier_name,
           COUNT(DISTINCT bi.id) as item_count,
           COUNT(DISTINCT ni.bill_item_id) as ncr_item_count
    FROM bills b
    LEFT JOIN suppliers s ON s.id = b.supplier_id
    LEFT JOIN bill_items bi ON bi.bill_id = b.id
    LEFT JOIN ncr_items ni ON ni.bill_item_id = bi.id
    WHERE 1=1 ${extra}
    GROUP BY b.id ORDER BY b.received_date DESC
    LIMIT ${MAX_REPORT_ROWS}
  `).all(...params);
  for (const b of bills) b.passed_item_count = b.item_count - b.ncr_item_count;

  // DEVMORE M13 — summary จาก SQL aggregate (ครบทั้งชุด ไม่ใช่เฉพาะ list ที่ cap)
  const agg = db.prepare(`
    SELECT COUNT(DISTINCT b.id) as total_bills, COUNT(DISTINCT bi.id) as total_items,
           COUNT(DISTINCT ni.bill_item_id) as ncr_item_count
    FROM bills b LEFT JOIN suppliers s ON s.id = b.supplier_id
    LEFT JOIN bill_items bi ON bi.bill_id = b.id
    LEFT JOIN ncr_items ni ON ni.bill_item_id = bi.id WHERE 1=1 ${extra}
  `).get(...params);
  const summary = {
    total_bills: agg.total_bills || 0,
    total_items: agg.total_items || 0,
    ncr_item_count: agg.ncr_item_count || 0,
  };
  summary.passed_item_count = summary.total_items - summary.ncr_item_count;
  summary.pass_rate = summary.total_items > 0 ? ((summary.passed_item_count / summary.total_items) * 100).toFixed(1) : '0.0';

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

  // สัดส่วน NCR ตามกลุ่มปัญหา — เดิมไม่มี query นี้เลย ฝั่ง frontend เลยพยายามอ่าน n.defect_category_name จากแถว
  // ข้างบน (query นั้นไม่เคย join defect_categories เลย → undefined ทุกแถว → กลายเป็น "อื่นๆ" ทั้งหมด, ดู DEVLOG)
  // นับ NCR ต่อกลุ่มปัญหาแบบเดียวกับ topDefects ใน GET /summary (COUNT DISTINCT n.id ต่อ dc.id — 1 NCR ที่มีหลาย
  // รายการคนละกลุ่มปัญหาจะถูกนับในทุกกลุ่มที่เกี่ยวข้อง ไม่ mutually exclusive แต่สอดคล้องกับที่มีอยู่แล้วในระบบ)
  const defectBreakdown = db.prepare(`
    SELECT COALESCE(dc.name, 'อื่นๆ') as name, COUNT(DISTINCT n.id) as value
    FROM ncrs n
    LEFT JOIN bills b ON b.id = n.bill_id
    LEFT JOIN ncr_items ni ON ni.ncr_id = n.id
    LEFT JOIN defect_categories dc ON dc.id = ni.defect_category_id
    WHERE 1=1 ${extra}
    GROUP BY dc.id
    ORDER BY value DESC
  `).all(...params);

  res.json({ summary, ncrs, defect_breakdown: defectBreakdown, truncated: ncrs.length >= MAX_REPORT_ROWS });
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

  // Top 5 Supplier มี UAI มากที่สุด (คำขอ user — เดิมหน้านี้ไม่มีกราฟ/ตารางนี้เลย)
  const topUaiSuppliers = db.prepare(`
    SELECT s.name, COUNT(u.id) as uai_count
    FROM uai_documents u
    LEFT JOIN ncrs n ON n.id = u.ncr_id
    LEFT JOIN bills b ON b.id = n.bill_id
    LEFT JOIN suppliers s ON s.id = b.supplier_id
    WHERE 1=1 ${extra}
    GROUP BY s.id ORDER BY uai_count DESC LIMIT 5
  `).all(...params);

  res.json({ summary, uais, top_uai_suppliers: topUaiSuppliers, truncated: uais.length >= MAX_REPORT_ROWS });
});

// GET /api/reports/summary
router.get('/summary', auth, requireRole(REPORT_ROLES), (req, res) => {
  const { from, to, supplier_id } = req.query;
  const dateFilter = buildDateFilter(from, to, 'b.received_date');
  const params = [...dateFilter.params];
  let extra = dateFilter.sql;
  if (supplier_id) { extra += ' AND b.supplier_id = ?'; params.push(supplier_id); }

  // รายการรับเข้า = จำนวนแถว bill_items (ไม่ใช่ผลรวมจำนวนชิ้น qty_received) — อัตราผ่านนับจาก "รายการที่มีการออก
  // NCR" (ni.bill_item_id) เทียบกับรายการทั้งหมด (คำขอ user — ดู DEVLOG, เหมือน /receiving endpoint ด้านบน)
  const billStats = db.prepare(`
    SELECT COUNT(DISTINCT b.id) as total_bills,
           COUNT(DISTINCT bi.id) as total_items,
           COUNT(DISTINCT ni.bill_item_id) as ncr_item_count
    FROM bills b LEFT JOIN bill_items bi ON bi.bill_id = b.id
    LEFT JOIN ncr_items ni ON ni.bill_item_id = bi.id WHERE 1=1 ${extra}
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

  const totalItems = billStats.total_items || 0;
  const ncrItemCount = billStats.ncr_item_count || 0;
  const passRate = totalItems > 0
    ? (((totalItems - ncrItemCount) / totalItems) * 100).toFixed(1)
    : '0.0';

  res.json({
    summary: {
      total_bills: billStats.total_bills || 0,
      total_items: totalItems,
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
