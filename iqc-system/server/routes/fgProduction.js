const express = require('express');
const router = express.Router();
const db = require('../db/database');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');

const FG_WRITE = ['admin', 'production_manager'];

// ── GET /api/fg-production/dashboard-stats ────────────────────────────────────
router.get('/dashboard-stats', auth, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const m = new Date(); m.setDate(1);
  const monthStart = m.toISOString().slice(0, 10);

  const totalPlan     = db.prepare('SELECT COALESCE(SUM(plan_qty),0) AS v FROM pd_plans').get().v;
  const totalProduced = db.prepare('SELECT COALESCE(SUM(qty_produced),0) AS v FROM fg_productions').get().v;
  const totalDefect   = db.prepare('SELECT COALESCE(SUM(defect_qty),0) AS v FROM fg_defect_records').get().v;
  const defectPct     = totalProduced > 0 ? Math.round((totalDefect / totalProduced) * 10000) / 100 : 0;
  const openFncp      = db.prepare("SELECT COUNT(*) AS c FROM fg_fncp WHERE status NOT IN ('closed','verified')").get().c;
  const overdueFncp   = db.prepare("SELECT COUNT(*) AS c FROM fg_fncp WHERE due_date < ? AND status NOT IN ('closed','verified')").get(today).c;
  const topDefect     = db.prepare(`
    SELECT dt.name AS type_name, dg.name AS group_name, SUM(dr.defect_qty) AS total
    FROM fg_defect_records dr
    LEFT JOIN fg_defect_types dt ON dt.id = dr.defect_type_id
    LEFT JOIN fg_defect_groups dg ON dg.id = dr.defect_group_id
    WHERE dr.found_date >= ?
    GROUP BY dr.defect_type_id ORDER BY total DESC LIMIT 5
  `).all(monthStart);

  res.json({ totalPlan, totalProduced, totalDefect, defectPct, openFncp, overdueFncp, topDefect });
});

// ── GET /api/fg-production/monitor — monitoring table (pd_plans + aggregated data) ─
router.get('/monitor', auth, (req, res) => {
  const { q = '', line_id, date_from, date_to, page = 1, limit = 20 } = req.query;
  const params = [];
  let where = '1=1';

  if (q)       { where += ' AND (pp.doc_no LIKE ? OR pcs.product_no LIKE ? OR pcs.product_desc LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (line_id) { where += ' AND pp.production_line_id=?'; params.push(+line_id); }

  // date filter applies to production records (not pd_plans themselves)
  const dateCond = date_from && date_to
    ? `AND fp.produce_date BETWEEN '${date_from}' AND '${date_to}'`
    : date_from ? `AND fp.produce_date >= '${date_from}'`
    : date_to   ? `AND fp.produce_date <= '${date_to}'`
    : '';
  const defectDateCond = date_from && date_to
    ? `AND dr.found_date BETWEEN '${date_from}' AND '${date_to}'`
    : date_from ? `AND dr.found_date >= '${date_from}'`
    : date_to   ? `AND dr.found_date <= '${date_to}'`
    : '';

  const offset = (+page - 1) * +limit;
  const rows = db.prepare(`
    SELECT pp.id, pp.doc_no, pp.product_no, pp.product_desc, pp.plan_qty, pp.due_date,
           pp.production_line_id, pp.pro_code_sap_id,
           pl.name AS line_name,
           pcs.line_type, pcs.brand, pcs.product_series, pcs.panel_type,
           pcs.panel_style, pcs.panel_color, pcs.panel_size, pcs.mosquito_net,
           COALESCE(fp.produced, 0) AS produced_qty,
           COALESCE(dr.defect, 0) AS defect_qty,
           CASE WHEN COALESCE(fp.produced,0)>0 THEN ROUND(CAST(COALESCE(dr.defect,0) AS REAL)/fp.produced*100,2) ELSE 0 END AS defect_pct,
           COALESCE(fn.fncp_cnt, 0) AS fncp_count,
           COALESCE(fn.open_cnt, 0) AS open_fncp_count
    FROM pd_plans pp
    LEFT JOIN production_lines pl ON pl.id = pp.production_line_id
    LEFT JOIN pro_code_sap pcs    ON pcs.id = pp.pro_code_sap_id
    LEFT JOIN (
      SELECT doc_no, pro_code_sap_id, SUM(qty_produced) AS produced
      FROM fg_productions WHERE 1=1 ${dateCond}
      GROUP BY doc_no, pro_code_sap_id
    ) fp ON fp.doc_no = pp.doc_no AND fp.pro_code_sap_id = pp.pro_code_sap_id
    LEFT JOIN (
      SELECT doc_no, pro_code_sap_id, SUM(defect_qty) AS defect
      FROM fg_defect_records WHERE 1=1 ${defectDateCond}
      GROUP BY doc_no, pro_code_sap_id
    ) dr ON dr.doc_no = pp.doc_no AND dr.pro_code_sap_id = pp.pro_code_sap_id
    LEFT JOIN (
      SELECT drx.doc_no, drx.pro_code_sap_id,
             COUNT(fn.id) AS fncp_cnt,
             SUM(CASE WHEN fn.status NOT IN ('closed','verified') THEN 1 ELSE 0 END) AS open_cnt
      FROM fg_fncp fn
      JOIN fg_defect_records drx ON drx.id = fn.defect_record_id
      GROUP BY drx.doc_no, drx.pro_code_sap_id
    ) fn ON fn.doc_no = pp.doc_no AND fn.pro_code_sap_id = pp.pro_code_sap_id
    WHERE ${where}
    ORDER BY pp.due_date DESC, pp.doc_no
    LIMIT ? OFFSET ?
  `).all(...params, +limit, +offset);

  const total = db.prepare(`
    SELECT COUNT(*) AS c FROM pd_plans pp
    LEFT JOIN pro_code_sap pcs ON pcs.id = pp.pro_code_sap_id
    WHERE ${where}
  `).get(...params);

  res.json({ data: rows, total: total.c, page: +page, limit: +limit });
});

// ── GET /api/fg-production/row-detail?doc_no=&sap_id= — expand row detail ───
router.get('/row-detail', auth, (req, res) => {
  const { doc_no, sap_id } = req.query;
  if (!doc_no) return res.json({ productions: [], defects: [] });

  const productions = db.prepare(`
    SELECT fp.*, sh.name AS shift_name, u.full_name AS created_by_name
    FROM fg_productions fp
    LEFT JOIN shifts sh ON sh.id = fp.shift_id
    LEFT JOIN users u ON u.id = fp.created_by
    WHERE fp.doc_no=? ${sap_id ? 'AND fp.pro_code_sap_id=?' : ''}
    ORDER BY fp.produce_date DESC, fp.created_at DESC
    LIMIT 30
  `).all(...(sap_id ? [doc_no, +sap_id] : [doc_no]));

  const defects = db.prepare(`
    SELECT dr.*, dg.name AS group_name, dt.name AS type_name, pa.name AS area_name,
           sh.name AS shift_name, u.full_name AS created_by_name,
           fn.fncp_no, fn.status AS fncp_status, fn.id AS fncp_id
    FROM fg_defect_records dr
    LEFT JOIN fg_defect_groups dg ON dg.id = dr.defect_group_id
    LEFT JOIN fg_defect_types dt ON dt.id = dr.defect_type_id
    LEFT JOIN fg_process_areas pa ON pa.id = dr.process_area_id
    LEFT JOIN shifts sh ON sh.id = dr.shift_id
    LEFT JOIN users u ON u.id = dr.created_by
    LEFT JOIN fg_fncp fn ON fn.defect_record_id = dr.id
    WHERE dr.doc_no=? ${sap_id ? 'AND dr.pro_code_sap_id=?' : ''}
    ORDER BY dr.found_date DESC, dr.created_at DESC
    LIMIT 30
  `).all(...(sap_id ? [doc_no, +sap_id] : [doc_no]));

  res.json({ productions, defects });
});

// ── GET /api/fg-production/po-summary?doc_no=&date= ──────────────────────────
// ยอด planned / produced / defect / remaining ต่อ PO (ใช้ใน Step 1 FQC/IPQC)
router.get('/po-summary', auth, (req, res) => {
  const { doc_no, date } = req.query;
  if (!doc_no) return res.json({ data: [] });

  const plans = db.prepare(`
    SELECT pp.id, pp.doc_no, pp.product_no, pp.product_desc,
           pp.plan_qty, pp.due_date, pp.production_line_id,
           pl.name AS line_name,
           pcs.id AS pro_code_sap_id, pcs.classify_status AS sap_status,
           pcs.line_type, pcs.brand, pcs.product_series,
           pcs.panel_type, pcs.panel_style, pcs.mosquito_net,
           pcs.glass_type, pcs.panel_color, pcs.panel_size
    FROM pd_plans pp
    LEFT JOIN production_lines pl  ON pl.id  = pp.production_line_id
    LEFT JOIN pro_code_sap   pcs ON pcs.id = pp.pro_code_sap_id
    WHERE pp.doc_no = ?
    ORDER BY pp.product_no
  `).all(doc_no);

  if (!plans.length) return res.json({ data: [] });

  // ยอดผลิตสะสมต่อ PO
  const producedRows = db.prepare(
    `SELECT pro_code_sap_id, SUM(qty_produced) as total FROM fg_productions WHERE doc_no=? GROUP BY pro_code_sap_id`
  ).all(doc_no);
  const producedMap = Object.fromEntries(producedRows.map(r => [r.pro_code_sap_id, r.total]));

  // ยอดผลิตวันนั้นๆ (สำหรับคำนวณ AQL)
  const targetDate = date || new Date().toISOString().slice(0, 10);
  const todayRows = db.prepare(
    `SELECT pro_code_sap_id, SUM(qty_produced) as total FROM fg_productions WHERE doc_no=? AND produce_date=? GROUP BY pro_code_sap_id`
  ).all(doc_no, targetDate);
  const todayMap = Object.fromEntries(todayRows.map(r => [r.pro_code_sap_id, r.total]));

  // ของเสียสะสม
  const defectRows = db.prepare(`
    SELECT fgqc_id, SUM(qty) as total
    FROM fgqc_defect_items di
    JOIN fgqc_records fr ON fr.id = di.fgqc_id
    WHERE fr.doc_no = ?
    GROUP BY di.fgqc_id
  `).all(doc_no);
  const defectByFgqc = Object.fromEntries(defectRows.map(r => [r.fgqc_id, r.total]));

  const defectSap = db.prepare(`
    SELECT fr.pro_code_sap_id, SUM(di.qty) as total
    FROM fgqc_defect_items di
    JOIN fgqc_records fr ON fr.id = di.fgqc_id
    WHERE fr.doc_no = ?
    GROUP BY fr.pro_code_sap_id
  `).all(doc_no);
  const defectMap = Object.fromEntries(defectSap.map(r => [r.pro_code_sap_id, r.total]));

  const data = plans.map(p => {
    const produced = producedMap[p.pro_code_sap_id] || 0;
    const defect   = defectMap[p.pro_code_sap_id]   || 0;
    const todayQty = todayMap[p.pro_code_sap_id]    || 0;
    return {
      ...p,
      produced_qty:   produced,
      defect_qty:     defect,
      pass_qty:       Math.max(0, produced - defect),
      remaining_qty:  Math.max(0, p.plan_qty - produced),
      today_qty:      todayQty,
    };
  });

  res.json({ data });
});

// ── GET /api/fg-production — list ────────────────────────────────────────────
router.get('/', auth, (req, res) => {
  const { doc_no, date_from, date_to, line_id, page = 1, limit = 20 } = req.query;
  let where = '1=1'; const params = [];
  if (doc_no)    { where += ' AND fp.doc_no LIKE ?';        params.push(`%${doc_no}%`); }
  if (date_from) { where += ' AND fp.produce_date >= ?';    params.push(date_from); }
  if (date_to)   { where += ' AND fp.produce_date <= ?';    params.push(date_to); }
  if (line_id)   { where += ' AND fp.production_line_id=?'; params.push(line_id); }

  const offset = (page - 1) * limit;
  const rows = db.prepare(`
    SELECT fp.*, pl.name AS line_name, sh.name AS shift_name,
           pcs.product_no, pcs.product_desc,
           u.full_name AS created_by_name
    FROM fg_productions fp
    LEFT JOIN production_lines pl ON pl.id = fp.production_line_id
    LEFT JOIN shifts sh            ON sh.id = fp.shift_id
    LEFT JOIN pro_code_sap pcs    ON pcs.id = fp.pro_code_sap_id
    LEFT JOIN users u              ON u.id  = fp.created_by
    WHERE ${where}
    ORDER BY fp.produce_date DESC, fp.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, +limit, +offset);

  const total = db.prepare(`SELECT COUNT(*) as c FROM fg_productions fp WHERE ${where}`).get(...params);
  res.json({ data: rows, total: total.c, page: +page, limit: +limit });
});

// ── POST /api/fg-production — บันทึกยอดผลิต ─────────────────────────────────
router.post('/', auth, requireRole(FG_WRITE), (req, res) => {
  const { doc_no, pro_code_sap_id, production_line_id, produce_date, qty_produced, source_doc, remarks } = req.body;
  const missing = [];
  if (!doc_no)              missing.push('เลข Doc. No.');
  if (!pro_code_sap_id)     missing.push('รหัสสินค้า SAP');
  if (!production_line_id)  missing.push('สายการผลิต');
  if (!produce_date)        missing.push('วันที่ผลิต');
  if (!qty_produced)        missing.push('จำนวนที่ผลิต');
  if (missing.length > 0) {
    return res.status(400).json({ error: `กรุณากรอกข้อมูลให้ครบ: ${missing.join(', ')}` });
  }

  // Auto-detect shift จากเวลาปัจจุบัน (รองรับกะข้ามคืน start_time > end_time)
  const now = new Date();
  const currentTime = now.toTimeString().slice(0, 5); // "HH:MM"
  const autoShift = db.prepare(`
    SELECT id, name FROM shifts
    WHERE is_active = 1 AND start_time IS NOT NULL AND end_time IS NOT NULL
      AND (
        (start_time <= end_time AND time(?) >= time(start_time) AND time(?) < time(end_time))
        OR
        (start_time > end_time AND (time(?) >= time(start_time) OR time(?) < time(end_time)))
      )
    ORDER BY id LIMIT 1
  `).get(currentTime, currentTime, currentTime, currentTime);
  const shift_id = autoShift?.id || null;

  const result = db.prepare(`
    INSERT INTO fg_productions (doc_no, pro_code_sap_id, production_line_id, shift_id, produce_date, qty_produced, source_doc, remarks, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(doc_no, pro_code_sap_id, production_line_id, shift_id, produce_date, qty_produced, source_doc || null, remarks || null, req.user.id);

  db.auditLog('fg_productions', result.lastInsertRowid, 'CREATE', null, { ...req.body, shift_id, shift_name: autoShift?.name }, req.user.id, req.ip);
  res.json({ id: result.lastInsertRowid, shift_name: autoShift?.name || null, ok: true });
});

// ── PUT /api/fg-production/:id ────────────────────────────────────────────────
router.put('/:id', auth, requireRole(FG_WRITE), (req, res) => {
  const { qty_produced, shift_id, produce_date, source_doc, remarks } = req.body;
  const old = db.prepare('SELECT * FROM fg_productions WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
  db.prepare(`UPDATE fg_productions SET qty_produced=?, shift_id=?, produce_date=?, source_doc=?, remarks=? WHERE id=?`)
    .run(qty_produced, shift_id || null, produce_date, source_doc || null, remarks || null, req.params.id);
  db.auditLog('fg_productions', req.params.id, 'UPDATE', old, req.body, req.user.id, req.ip);
  res.json({ ok: true });
});

// ── DELETE /api/fg-production/:id ────────────────────────────────────────────
router.delete('/:id', auth, requireRole(FG_WRITE), (req, res) => {
  const old = db.prepare('SELECT * FROM fg_productions WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
  db.prepare('DELETE FROM fg_productions WHERE id=?').run(req.params.id);
  db.auditLog('fg_productions', req.params.id, 'DELETE', old, null, req.user.id, req.ip);
  res.json({ ok: true });
});

module.exports = router;
