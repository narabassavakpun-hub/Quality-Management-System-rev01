// IPQC Inspection routes — บันทึกการตรวจสอบระหว่างผลิต
// Mounted at /api/ipqc-inspection
const express = require('express');
const router = express.Router();
const db = require('../db/database');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const uploads = require('../middleware/upload');
const { verifyMagic, compressImages } = require('../middleware/upload');
const { getUsersByRole, createNotification, sendTelegram } = require('../lib/notify');
const { calcAQL } = require('../utils/aqlCalc');
const path = require('path');
const fs = require('fs');

const WRITER_ROLES = ['admin', 'qc_staff', 'qc_supervisor'];
const VIEWER_ROLES = ['admin', 'qc_staff', 'qc_supervisor', 'qc_manager', 'cpo', 'production_manager', 'prod_supervisor'];

// GET /aql-calc?lot_qty=N  — คำนวณ AQL 0.65 S-1 (no auth required in context, but we auth anyway)
router.get('/aql-calc', auth, (req, res) => {
  const lotQty = parseInt(req.query.lot_qty) || 0;
  res.json(calcAQL(lotQty));
});

// GET / — list inspections
router.get('/', auth, requireRole(VIEWER_ROLES), (req, res) => {
  try {
    const {
      page = 1, limit = 20, q = '',
      station_id, line_id, result, status,
      date_from, date_to,
    } = req.query;
    const offset = (page - 1) * limit;
    const conds = [];
    const params = [];

    if (q) {
      conds.push('(i.record_no LIKE ? OR i.doc_no LIKE ? OR pcs.product_no LIKE ? OR pcs.product_desc LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like, like);
    }
    if (station_id) { conds.push('i.station_id = ?'); params.push(+station_id); }
    if (line_id)    { conds.push('i.production_line_id = ?'); params.push(+line_id); }
    if (result)     { conds.push('i.overall_result = ?'); params.push(result); }
    if (status)     { conds.push('i.status = ?'); params.push(status); }
    if (date_from)  { conds.push('i.inspect_date >= ?'); params.push(date_from); }
    if (date_to)    { conds.push('i.inspect_date <= ?'); params.push(date_to); }

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const base = `
      FROM ipqc_inspections i
      LEFT JOIN ipqc_stations s    ON s.id = i.station_id
      LEFT JOIN production_lines pl ON pl.id = i.production_line_id
      LEFT JOIN pro_code_sap pcs   ON pcs.id = i.pro_code_sap_id
      LEFT JOIN users u            ON u.id = i.created_by
      ${where}
    `;

    const total = db.prepare(`SELECT COUNT(*) as c ${base}`).get(...params).c;
    const rows  = db.prepare(`
      SELECT i.id, i.record_no, i.inspect_date, i.inspect_time,
             i.doc_no, i.lot_qty, i.sample_qty, i.accept_criteria, i.reject_criteria,
             i.overall_result, i.status, i.remarks, i.created_at,
             s.name AS station_name, s.code AS station_code,
             pl.name AS line_name,
             pcs.product_no, pcs.product_desc,
             u.full_name AS creator_name
      ${base}
      ORDER BY i.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, +limit, +offset);

    // ดึง linked IPNCR สำหรับ rows
    if (rows.length) {
      const ids = rows.map(r => r.id);
      const ncrs = db.prepare(`SELECT inspection_id, id, record_no, status FROM ipncr_records WHERE inspection_id IN (${ids.map(() => '?').join(',')})`).all(...ids);
      const ncrMap = {};
      for (const n of ncrs) {
        if (!ncrMap[n.inspection_id]) ncrMap[n.inspection_id] = [];
        ncrMap[n.inspection_id].push({ id: n.id, record_no: n.record_no, status: n.status });
      }
      for (const r of rows) r.ipncr_list = ncrMap[r.id] || [];
    }

    res.json({ data: rows, total, page: +page, limit: +limit });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /check?q=xxx — ตรวจว่า doc_no (LIKE) เคยมีการตรวจไปแล้วไหม (30 วันย้อนหลัง)
// รองรับ q (LIKE) สำหรับ search ระหว่างพิมพ์ และ doc_no (exact) หลังเลือกแล้ว
router.get('/check', auth, (req, res) => {
  try {
    const { doc_no, q } = req.query;
    if (!doc_no && !q) return res.json([]);

    const docFilter = doc_no ? 'i.doc_no = ?' : 'i.doc_no LIKE ?';
    const docParam  = doc_no ? doc_no : `%${q}%`;

    const rows = db.prepare(`
      SELECT i.id, i.record_no, i.doc_no, i.inspect_date, i.inspect_time,
             i.overall_result, i.status, i.sample_qty, i.lot_qty,
             s.name AS station_name, s.code AS station_code,
             sh.name AS shift_name,
             pl.name AS line_name,
             u.full_name AS creator_name
      FROM ipqc_inspections i
      LEFT JOIN ipqc_stations s    ON s.id = i.station_id
      LEFT JOIN shifts sh          ON sh.id = i.shift_id
      LEFT JOIN production_lines pl ON pl.id = i.production_line_id
      LEFT JOIN users u            ON u.id = i.created_by
      WHERE ${docFilter}
        AND i.status NOT IN ('cancelled','draft')
        AND i.inspect_date >= date('now','-30 days')
      ORDER BY i.inspect_date DESC, i.inspect_time DESC
      LIMIT 20
    `).all(docParam);

    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /:id — detail
router.get('/:id', auth, requireRole(VIEWER_ROLES), (req, res) => {
  try {
    const insp = db.prepare(`
      SELECT i.*, s.name AS station_name, s.code AS station_code,
             pl.name AS line_name,
             sh.name AS shift_name,
             pcs.product_no, pcs.product_desc, pcs.brand, pcs.panel_size, pcs.line_type,
             u.full_name AS creator_name
      FROM ipqc_inspections i
      LEFT JOIN ipqc_stations s    ON s.id = i.station_id
      LEFT JOIN production_lines pl ON pl.id = i.production_line_id
      LEFT JOIN shifts sh          ON sh.id = i.shift_id
      LEFT JOIN pro_code_sap pcs   ON pcs.id = i.pro_code_sap_id
      LEFT JOIN users u            ON u.id = i.created_by
      WHERE i.id = ?
    `).get(req.params.id);
    if (!insp) return res.status(404).json({ error: 'ไม่พบรายการ' });

    insp.items = db.prepare(`
      SELECT ii.*, ci.item_name, ci.check_type, ci.std_value, ci.tol_plus, ci.tol_minus,
             ci.unit, ci.input_type, ci.sample_count, ci.item_no, ci.sort_order
      FROM ipqc_inspection_items ii
      LEFT JOIN ipqc_check_items ci ON ci.id = ii.check_item_id
      WHERE ii.inspection_id = ?
      ORDER BY ci.sort_order ASC, ci.item_no ASC
    `).all(req.params.id);

    insp.images = db.prepare('SELECT * FROM ipqc_inspection_images WHERE inspection_id = ? ORDER BY sort_order ASC, id ASC').all(req.params.id);

    insp.ipncr_list = db.prepare('SELECT id, record_no, status, defect_description, recheck_attempt FROM ipncr_records WHERE inspection_id = ? ORDER BY id DESC').all(req.params.id);

    res.json(insp);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST / — create inspection (draft) + stub items from template
router.post('/', auth, requireRole(WRITER_ROLES), (req, res) => {
  try {
    const {
      inspect_date, inspect_time, station_id, production_line_id, shift_id,
      doc_no, pro_code_sap_id, pd_plan_id, template_id, lot_qty, remarks,
    } = req.body;

    if (!inspect_date || !inspect_time || !station_id || !doc_no) {
      return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบ (วันที่, เวลา, Station, Doc No)' });
    }

    // คำนวณ AQL
    const aql = calcAQL(lot_qty ? +lot_qty : 0);

    // หา template: เฉพาะสาย → fallback ทั่วไปของ station
    let resolvedTemplate = template_id ? +template_id : null;
    if (!resolvedTemplate && station_id) {
      const tmpl = db.prepare(`
        SELECT id FROM ipqc_check_templates
        WHERE station_id = ? AND is_active = 1
        AND (production_line_id = ? OR production_line_id IS NULL)
        ORDER BY production_line_id DESC NULLS LAST
        LIMIT 1
      `).get(+station_id, production_line_id ? +production_line_id : null);
      resolvedTemplate = tmpl?.id || null;
    }

    const create = db.transaction(() => {
      const record_no = db.nextIPQCCode();
      const r = db.prepare(`
        INSERT INTO ipqc_inspections
          (record_no, inspect_date, inspect_time, station_id, production_line_id, shift_id,
           doc_no, pro_code_sap_id, pd_plan_id, template_id,
           lot_qty, sample_qty, accept_criteria, reject_criteria,
           overall_result, status, remarks, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'draft', ?, ?)
      `).run(
        record_no, inspect_date, inspect_time,
        +station_id, production_line_id ? +production_line_id : null,
        shift_id ? +shift_id : null,
        doc_no, pro_code_sap_id ? +pro_code_sap_id : null,
        pd_plan_id ? +pd_plan_id : null, resolvedTemplate,
        lot_qty ? +lot_qty : null, aql.n, aql.ac, aql.re,
        remarks || null, req.user.id
      );
      const inspId = r.lastInsertRowid;

      // สร้าง stub items จาก template
      if (resolvedTemplate) {
        const items = db.prepare('SELECT * FROM ipqc_check_items WHERE template_id = ? AND is_active = 1 ORDER BY sort_order ASC, item_no ASC').all(resolvedTemplate);
        const insItem = db.prepare('INSERT INTO ipqc_inspection_items (inspection_id, check_item_id, result) VALUES (?, ?, \'pending\')');
        for (const item of items) insItem.run(inspId, item.id);
      }

      db.auditLog('ipqc_inspections', inspId, 'CREATE', null, { record_no, doc_no, station_id }, req.user.id, req.ip);
      return inspId;
    });

    const newId = create();
    res.status(201).json({ id: newId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /:id — update items (draft only)
router.put('/:id', auth, requireRole(WRITER_ROLES), (req, res) => {
  try {
    const insp = db.prepare('SELECT * FROM ipqc_inspections WHERE id = ?').get(req.params.id);
    if (!insp) return res.status(404).json({ error: 'ไม่พบรายการ' });
    if (insp.status !== 'draft') return res.status(400).json({ error: 'แก้ไขได้เฉพาะรายการ draft เท่านั้น' });

    const { items, remarks } = req.body;

    const update = db.transaction(() => {
      if (remarks !== undefined) {
        db.prepare('UPDATE ipqc_inspections SET remarks = ? WHERE id = ?').run(remarks || null, insp.id);
      }

      if (Array.isArray(items)) {
        const upd = db.prepare(`
          UPDATE ipqc_inspection_items
          SET measured_values = ?, measured_value = ?, pass_fail_value = ?,
              text_value = ?, result = ?, fail_count = ?, remarks = ?
          WHERE id = ? AND inspection_id = ?
        `);
        for (const item of items) {
          upd.run(
            item.measured_values != null ? JSON.stringify(item.measured_values) : null,
            item.measured_value ?? null,
            item.pass_fail_value ?? null,
            item.text_value ?? null,
            item.result || 'pending',
            item.fail_count || 0,
            item.remarks || null,
            item.id, insp.id
          );
        }
      }
    });

    update();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /:id/submit — submit inspection → compute result → notify if fail
router.post('/:id/submit', auth, requireRole(WRITER_ROLES), (req, res) => {
  try {
    const insp = db.prepare('SELECT * FROM ipqc_inspections WHERE id = ?').get(req.params.id);
    if (!insp) return res.status(404).json({ error: 'ไม่พบรายการ' });
    if (insp.status !== 'draft') return res.status(400).json({ error: 'รายการนี้ submit แล้ว' });

    // อัปเดต items ถ้าส่งมาพร้อมกัน
    if (Array.isArray(req.body.items)) {
      const upd = db.prepare(`
        UPDATE ipqc_inspection_items
        SET measured_values = ?, measured_value = ?, pass_fail_value = ?,
            text_value = ?, result = ?, fail_count = ?, remarks = ?
        WHERE id = ? AND inspection_id = ?
      `);
      for (const item of req.body.items) {
        upd.run(
          item.measured_values != null ? JSON.stringify(item.measured_values) : null,
          item.measured_value ?? null,
          item.pass_fail_value ?? null,
          item.text_value ?? null,
          item.result || 'pending',
          item.fail_count || 0,
          item.remarks || null,
          item.id, insp.id
        );
      }
    }
    if (req.body.remarks !== undefined) {
      db.prepare('UPDATE ipqc_inspections SET remarks = ? WHERE id = ?').run(req.body.remarks || null, insp.id);
    }

    const submit = db.transaction(() => {
      const items = db.prepare('SELECT * FROM ipqc_inspection_items WHERE inspection_id = ?').all(insp.id);
      const overallResult = items.some(it => it.result === 'fail') ? 'fail' : 'pass';

      const changed = db.prepare(
        "UPDATE ipqc_inspections SET overall_result = ?, status = 'completed' WHERE id = ? AND status = 'draft'"
      ).run(overallResult, insp.id);
      if (changed.changes === 0) throw new Error('รายการนี้ถูก submit แล้ว');

      db.auditLog('ipqc_inspections', insp.id, 'SUBMIT', { status: 'draft' }, { status: 'completed', overall_result: overallResult }, req.user.id, req.ip);

      if (overallResult === 'fail') {
        for (const u of getUsersByRole('qc_supervisor', 'qc_manager')) {
          createNotification(u.id, 'IPQC ไม่ผ่าน', `${insp.record_no} — ${insp.doc_no} ผล: ไม่ผ่าน`, `/production-qc/ipqc/${insp.id}`);
        }
        for (const u of getUsersByRole('production_manager', 'prod_supervisor')) {
          createNotification(u.id, 'IPQC ไม่ผ่าน', `${insp.record_no} — ${insp.doc_no} มีปัญหาระหว่างผลิต`, `/production-qc/ipqc/${insp.id}`);
        }
        if (db.pushSSE) db.pushSSE(
          [...getUsersByRole('qc_supervisor', 'qc_manager', 'production_manager', 'prod_supervisor').map(u => u.id)],
          'ipqc_fail', { id: insp.id, record_no: insp.record_no }
        );
        const tgMsg = `[IPQC] ${insp.record_no} — ${insp.doc_no} ผลตรวจ: ❌ ไม่ผ่าน`;
        sendTelegram(db.getSetting('telegram_group_qc'), tgMsg);
      }

      return overallResult;
    });

    const overallResult = submit();
    res.json({ ok: true, overall_result: overallResult });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// POST /:id/images — อัปโหลดรูปภาพ
router.post('/:id/images', auth, requireRole(WRITER_ROLES),
  uploads.ipqc.array('images', 10), verifyMagic, compressImages,
  (req, res) => {
    try {
      const insp = db.prepare('SELECT id FROM ipqc_inspections WHERE id = ?').get(req.params.id);
      if (!insp) return res.status(404).json({ error: 'ไม่พบรายการ' });

      const checkItemId = req.body.check_item_id ? +req.body.check_item_id : null;
      const ins = db.prepare('INSERT INTO ipqc_inspection_images (inspection_id, check_item_id, filename, original_name, sort_order) VALUES (?, ?, ?, ?, ?)');
      let sort = db.prepare('SELECT COUNT(*) as c FROM ipqc_inspection_images WHERE inspection_id = ?').get(insp.id).c;

      const files = [];
      for (const f of (req.files || [])) {
        ins.run(insp.id, checkItemId, f.filename, f.originalname, ++sort);
        files.push({ filename: f.filename, original_name: f.originalname });
      }
      res.json({ ok: true, files });
    } catch (e) {
      for (const f of (req.files || [])) { try { fs.unlinkSync(f.path); } catch {} }
      res.status(500).json({ error: e.message });
    }
  }
);

// DELETE /:id/images/:imgId
router.delete('/:id/images/:imgId', auth, requireRole(WRITER_ROLES), (req, res) => {
  try {
    const img = db.prepare('SELECT * FROM ipqc_inspection_images WHERE id = ? AND inspection_id = ?').get(req.params.imgId, req.params.id);
    if (!img) return res.status(404).json({ error: 'ไม่พบรูปภาพ' });

    db.prepare('DELETE FROM ipqc_inspection_images WHERE id = ?').run(img.id);
    const uploadsBase = path.join(__dirname, '../../uploads/ipqc');
    try { fs.unlinkSync(path.join(uploadsBase, img.filename)); } catch {}
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
