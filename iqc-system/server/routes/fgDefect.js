const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../db/database');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const uploads = require('../middleware/upload');

const QC_WRITE = ['admin', 'qc_staff', 'qc_supervisor', 'qc_manager'];
const write    = [auth, requireRole(QC_WRITE)];

// ── GET /api/fg-defect — list ───────────────────────────────────────────────
router.get('/', auth, (req, res) => {
  const { q = '', line_id, severity, status, date_from, date_to, page = 1, limit = 20 } = req.query;
  const params = [];
  let where = '1=1';
  if (q)         { where += ' AND (dr.doc_no LIKE ? OR pcs.product_no LIKE ? OR pcs.product_desc LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (line_id)   { where += ' AND dr.production_line_id=?'; params.push(+line_id); }
  if (severity)  { where += ' AND dr.severity=?';           params.push(severity); }
  if (status)    { where += ' AND dr.status=?';             params.push(status); }
  if (date_from) { where += ' AND dr.found_date>=?';        params.push(date_from); }
  if (date_to)   { where += ' AND dr.found_date<=?';        params.push(date_to); }

  const offset = (+page - 1) * +limit;
  const rows = db.prepare(`
    SELECT dr.*,
           pl.name AS line_name,
           sh.name AS shift_name,
           pcs.product_no, pcs.product_desc,
           dg.name AS defect_group_name,
           dt.name AS defect_type_name,
           pa.name AS process_area_name,
           u.full_name AS created_by_name,
           pic.full_name AS pic_name,
           fn.fncp_no,
           fn.status AS fncp_status
    FROM fg_defect_records dr
    LEFT JOIN production_lines pl ON pl.id = dr.production_line_id
    LEFT JOIN shifts sh            ON sh.id = dr.shift_id
    LEFT JOIN pro_code_sap pcs    ON pcs.id = dr.pro_code_sap_id
    LEFT JOIN fg_defect_groups dg  ON dg.id = dr.defect_group_id
    LEFT JOIN fg_defect_types dt   ON dt.id = dr.defect_type_id
    LEFT JOIN fg_process_areas pa  ON pa.id = dr.process_area_id
    LEFT JOIN users u              ON u.id  = dr.created_by
    LEFT JOIN users pic            ON pic.id = dr.pic_user_id
    LEFT JOIN fg_fncp fn           ON fn.defect_record_id = dr.id
    WHERE ${where}
    ORDER BY dr.found_date DESC, dr.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, +limit, +offset);

  const total = db.prepare(`
    SELECT COUNT(*) as c FROM fg_defect_records dr
    LEFT JOIN pro_code_sap pcs ON pcs.id = dr.pro_code_sap_id
    WHERE ${where}
  `).get(...params);

  res.json({ data: rows, total: total.c, page: +page, limit: +limit });
});

// ── GET /api/fg-defect/:id — detail ─────────────────────────────────────────
router.get('/:id', auth, (req, res) => {
  const row = db.prepare(`
    SELECT dr.*,
           pl.name AS line_name,
           sh.name AS shift_name,
           pcs.product_no, pcs.product_desc,
           pcs.line_type, pcs.brand, pcs.product_series, pcs.panel_type,
           pcs.panel_style, pcs.mosquito_net, pcs.glass_type, pcs.panel_color, pcs.panel_size,
           dg.name AS defect_group_name,
           dt.name AS defect_type_name,
           dt.severity_default,
           pa.name AS process_area_name,
           u.full_name AS created_by_name,
           pic.full_name AS pic_name
    FROM fg_defect_records dr
    LEFT JOIN production_lines pl ON pl.id = dr.production_line_id
    LEFT JOIN shifts sh            ON sh.id = dr.shift_id
    LEFT JOIN pro_code_sap pcs    ON pcs.id = dr.pro_code_sap_id
    LEFT JOIN fg_defect_groups dg  ON dg.id = dr.defect_group_id
    LEFT JOIN fg_defect_types dt   ON dt.id = dr.defect_type_id
    LEFT JOIN fg_process_areas pa  ON pa.id = dr.process_area_id
    LEFT JOIN users u              ON u.id  = dr.created_by
    LEFT JOIN users pic            ON pic.id = dr.pic_user_id
    WHERE dr.id=?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'ไม่พบข้อมูล' });

  const images = db.prepare('SELECT * FROM fg_defect_images WHERE defect_record_id=? ORDER BY sort_order').all(req.params.id);
  const fncp   = db.prepare(`
    SELECT fn.*, u.full_name AS opened_by_name
    FROM fg_fncp fn LEFT JOIN users u ON u.id=fn.opened_by
    WHERE fn.defect_record_id=?
  `).get(req.params.id);

  res.json({ ...row, images, fncp: fncp || null });
});

// ── POST /api/fg-defect — create (auto shift/time + auto FNCP + token) ───────
router.post('/', ...write, (req, res) => {
  const {
    found_date, doc_no, pro_code_sap_id, production_line_id,
    lot_no,                           // แสดงเป็น "Doc. No. อ้างอิง" ใน UI
    defect_group_id, defect_type_id, process_area_id,
    fm_category_id,
    defect_qty, defect_unit = 'pcs', severity = 'minor',
    initial_cause,                    // แสดงเป็น "ปัญหาที่พบ" ใน UI
  } = req.body;

  if (!found_date || !defect_qty || +defect_qty <= 0) {
    return res.status(400).json({ error: 'กรุณากรอกวันที่พบและจำนวนของเสีย' });
  }

  // Auto shift + time จากเวลา server
  const now = new Date();
  const found_time = now.toTimeString().slice(0, 5);
  const ct = found_time;
  const autoShift = db.prepare(`
    SELECT id FROM shifts WHERE is_active=1 AND start_time IS NOT NULL AND end_time IS NOT NULL
    AND ((start_time <= end_time AND time(?) >= time(start_time) AND time(?) < time(end_time))
      OR (start_time > end_time  AND (time(?) >= time(start_time) OR time(?) < time(end_time))))
    ORDER BY id LIMIT 1
  `).get(ct, ct, ct, ct);

  const crypto = require('crypto');

  const saveAll = db.transaction(() => {
    const record_no = db.nextFDRCode();
    const defectR = db.prepare(`
      INSERT INTO fg_defect_records
        (record_no, found_date, found_time, shift_id, doc_no, pro_code_sap_id, production_line_id,
         lot_no, defect_group_id, defect_type_id, process_area_id,
         fm_category_id,
         defect_qty, defect_unit, severity, initial_cause, status, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'fncp_generated',?)
    `).run(
      record_no, found_date, found_time, autoShift?.id || null,
      doc_no || null, pro_code_sap_id || null, production_line_id || null,
      lot_no || null,
      defect_group_id || null, defect_type_id || null, process_area_id || null,
      fm_category_id || null,
      +defect_qty, defect_unit, severity, initial_cause || null, req.user.id
    );
    const defectId = defectR.lastInsertRowid;

    // Auto-create FNCP + production response token
    const fncp_no        = db.nextFNCPCode();
    const prod_token     = crypto.randomBytes(32).toString('hex');
    const tokenExpires   = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const fncpR = db.prepare(`
      INSERT INTO fg_fncp
        (fncp_no, defect_record_id, doc_no, pro_code_sap_id, production_line_id,
         defect_group_id, defect_type_id, defect_qty, defect_unit, severity,
         fm_category_id,
         prod_token, prod_token_expires_at,
         status, opened_by, opened_at, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'open',?,datetime('now'),?)
    `).run(
      fncp_no, defectId, doc_no || null, pro_code_sap_id || null, production_line_id || null,
      defect_group_id || null, defect_type_id || null,
      +defect_qty, defect_unit, severity,
      fm_category_id || null,
      prod_token, tokenExpires,
      req.user.id, req.user.id
    );
    const fncpId = fncpR.lastInsertRowid;

    db.prepare(`INSERT INTO fg_fncp_timeline (fncp_id, action, comment, created_by) VALUES (?,?,?,?)`)
      .run(fncpId, 'create', `สร้าง FNCP จาก ${record_no}`, req.user.id);

    // Notify general (QC manager + production manager)
    const notify = db.prepare("SELECT id FROM users WHERE role IN ('qc_manager','production_manager') AND is_active=1").all();
    const insN   = db.prepare("INSERT INTO notifications (user_id, title, message, link) VALUES (?,?,?,?)");
    for (const u of notify) insN.run(u.id, `FNCP ใหม่: ${fncp_no}`, `ของเสีย ${record_no} — ${defect_qty} ชิ้น (${severity})`, `/fg-production/fncp/${fncpId}`);
    if (db.pushSSE && notify.length) db.pushSSE(notify.map(u => u.id), 'notification', { title: `FNCP ใหม่: ${fncp_no}` });

    // Material defect escalation — notify qc_staff รับเข้า
    if (fm_category_id) {
      const fmCat = db.prepare('SELECT is_material FROM fg_fm_categories WHERE id=?').get(fm_category_id);
      if (fmCat?.is_material === 1) {
        const pcs = pro_code_sap_id ? db.prepare('SELECT product_no, product_desc FROM pro_code_sap WHERE id=?').get(pro_code_sap_id) : null;
        db.prepare(`INSERT INTO fg_material_defects (fncp_id, defect_record_id, product_name, qty_found, defect_type_noted) VALUES (?,?,?,?,?)`)
          .run(fncpId, defectId, pcs ? `${pcs.product_no} ${pcs.product_desc}` : null, +defect_qty, initial_cause || null);
        const inQC = db.prepare("SELECT id FROM users WHERE qc_station='รับเข้า' AND is_active=1").all();
        for (const u of inQC) insN.run(u.id, `ของเสียวัตถุดิบ: ${fncp_no}`, `พบของเสียที่สงสัยเป็นปัญหาวัตถุดิบ — ${defect_qty} ชิ้น`, `/fg-production/material-defects`);
        if (db.pushSSE && inQC.length) db.pushSSE(inQC.map(u => u.id), 'notification', { title: `ของเสียวัตถุดิบ: ${fncp_no}` });
      }
    }

    db.auditLog('fg_defect_records', defectId, 'CREATE', null, req.body, req.user.id, req.ip);
    db.auditLog('fg_fncp', fncpId, 'CREATE', null, { fncp_no }, req.user.id, req.ip);

    return { defectId, record_no, fncpId, fncp_no, prod_token, tokenExpires };
  });

  const result = saveAll();
  res.json({ ...result, ok: true });
});

// ── PUT /api/fg-defect/:id — update (only if no FNCP and status=open) ───────
router.put('/:id', ...write, (req, res) => {
  const old = db.prepare('SELECT * FROM fg_defect_records WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
  if (old.status !== 'open') return res.status(409).json({ error: 'ไม่สามารถแก้ไขรายการที่มี FNCP แล้ว' });

  const {
    found_date, found_time, shift_id, lot_no, machine_no, line_leader,
    defect_group_id, defect_type_id, process_area_id,
    defect_qty, defect_unit, severity,
    initial_cause, root_cause, corrective_action, preventive_action,
    pic_user_id, due_date,
  } = req.body;

  db.prepare(`
    UPDATE fg_defect_records SET
      found_date=?, found_time=?, shift_id=?, lot_no=?, machine_no=?, line_leader=?,
      defect_group_id=?, defect_type_id=?, process_area_id=?,
      defect_qty=?, defect_unit=?, severity=?,
      initial_cause=?, root_cause=?, corrective_action=?, preventive_action=?,
      pic_user_id=?, due_date=?, updated_at=datetime('now')
    WHERE id=?
  `).run(
    found_date ?? old.found_date, found_time ?? old.found_time, shift_id ?? old.shift_id,
    lot_no ?? old.lot_no, machine_no ?? old.machine_no, line_leader ?? old.line_leader,
    defect_group_id ?? old.defect_group_id, defect_type_id ?? old.defect_type_id, process_area_id ?? old.process_area_id,
    defect_qty ?? old.defect_qty, defect_unit ?? old.defect_unit, severity ?? old.severity,
    initial_cause ?? old.initial_cause, root_cause ?? old.root_cause,
    corrective_action ?? old.corrective_action, preventive_action ?? old.preventive_action,
    pic_user_id ?? old.pic_user_id, due_date ?? old.due_date,
    req.params.id
  );

  db.auditLog('fg_defect_records', req.params.id, 'UPDATE', old, req.body, req.user.id, req.ip);
  res.json({ ok: true });
});

// ── POST /api/fg-defect/:id/images — upload images ──────────────────────────
router.post('/:id/images', ...write, uploads.fgDefect.array('images', 10), (req, res) => {
  const rec = db.prepare('SELECT id FROM fg_defect_records WHERE id=?').get(req.params.id);
  if (!rec) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
  if (!req.files?.length) return res.status(400).json({ error: 'ไม่พบไฟล์' });

  const ins = db.prepare('INSERT INTO fg_defect_images (defect_record_id, filename, original_name, sort_order) VALUES (?, ?, ?, ?)');
  const maxSort = db.prepare('SELECT COALESCE(MAX(sort_order),0) as m FROM fg_defect_images WHERE defect_record_id=?').get(req.params.id).m;

  const saved = db.transaction(() =>
    req.files.map((f, i) => {
      const r = ins.run(rec.id, f.filename, f.originalname, maxSort + i + 1);
      return { id: r.lastInsertRowid, filename: f.filename, original_name: f.originalname };
    })
  )();

  res.json({ data: saved, ok: true });
});

// ── DELETE /api/fg-defect/:id/images/:imgId ──────────────────────────────────
router.delete('/:id/images/:imgId', ...write, (req, res) => {
  const img = db.prepare('SELECT * FROM fg_defect_images WHERE id=? AND defect_record_id=?').get(req.params.imgId, req.params.id);
  if (!img) return res.status(404).json({ error: 'ไม่พบรูปภาพ' });

  db.prepare('DELETE FROM fg_defect_images WHERE id=?').run(img.id);
  const filePath = path.join(__dirname, '../../uploads/fg-defect', img.filename);
  try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
  res.json({ ok: true });
});

// ── POST /api/fg-defect/:id/generate-fncp — สร้าง FNCP จากรายการเสีย ────────
router.post('/:id/generate-fncp', ...write, (req, res) => {
  const rec = db.prepare(`
    SELECT dr.*, pcs.product_no, pcs.product_desc
    FROM fg_defect_records dr
    LEFT JOIN pro_code_sap pcs ON pcs.id=dr.pro_code_sap_id
    WHERE dr.id=?
  `).get(req.params.id);
  if (!rec) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
  if (rec.status === 'fncp_generated') return res.status(409).json({ error: 'มี FNCP อยู่แล้ว' });

  const { department_responsible } = req.body;
  const fncp_no = db.nextFNCPCode();

  const saveAll = db.transaction(() => {
    const fncp = db.prepare(`
      INSERT INTO fg_fncp
        (fncp_no, defect_record_id, doc_no, pro_code_sap_id, production_line_id,
         defect_group_id, defect_type_id, defect_qty, defect_unit, severity,
         department_responsible, root_cause, corrective_action, preventive_action,
         pic_user_id, due_date, status, opened_by, opened_at, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),?)
    `).run(
      fncp_no, rec.id, rec.doc_no, rec.pro_code_sap_id, rec.production_line_id,
      rec.defect_group_id, rec.defect_type_id, rec.defect_qty, rec.defect_unit, rec.severity,
      department_responsible || null,
      rec.root_cause, rec.corrective_action, rec.preventive_action,
      rec.pic_user_id, rec.due_date,
      'open', req.user.id, req.user.id
    );

    db.prepare("UPDATE fg_defect_records SET status='fncp_generated', updated_at=datetime('now') WHERE id=?").run(rec.id);
    db.prepare("INSERT INTO fg_fncp_timeline (fncp_id, action, comment, created_by) VALUES (?,?,?,?)").run(fncp.lastInsertRowid, 'create', `สร้าง FNCP จาก ${rec.record_no}`, req.user.id);
    db.auditLog('fg_fncp', fncp.lastInsertRowid, 'CREATE', null, { fncp_no, defect_record_id: rec.id }, req.user.id, req.ip);

    // Notify qc_manager + production_manager
    const notifyRoles = db.prepare("SELECT id FROM users WHERE role IN ('qc_manager','production_manager') AND is_active=1").all();
    const insN = db.prepare("INSERT INTO notifications (user_id, title, message, link) VALUES (?,?,?,?)");
    for (const u of notifyRoles) {
      insN.run(u.id, `FNCP ใหม่: ${fncp_no}`, `บันทึกของเสีย ${rec.record_no} — ${rec.defect_qty} ชิ้น`, `/fg-production/fncp/${fncp.lastInsertRowid}`);
    }
    if (db.pushSSE) {
      db.pushSSE(notifyRoles.map(u => u.id), 'notification', { title: `FNCP ใหม่: ${fncp_no}` });
    }

    return fncp.lastInsertRowid;
  });

  const fncpId = saveAll();
  res.json({ id: fncpId, fncp_no, ok: true });
});

module.exports = router;
