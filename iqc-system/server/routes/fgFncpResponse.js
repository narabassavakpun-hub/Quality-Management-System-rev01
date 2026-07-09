const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const db      = require('../db/database');
const uploads = require('../middleware/upload');
const { verifyMagic, compressImages } = require('../middleware/upload');

const RATE = new Map(); // simple in-memory rate limit for public route
function publicLimit(req, res, next) {
  const ip  = req.ip;
  const now = Date.now();
  const rec = RATE.get(ip) || { count: 0, reset: now + 60000 };
  if (now > rec.reset) { rec.count = 0; rec.reset = now + 60000; }
  rec.count += 1;
  RATE.set(ip, rec);
  if (rec.count > 30) return res.status(429).json({ error: 'ลองใหม่ใน 1 นาที' });
  next();
}

function getFncp(token) {
  return db.prepare(`
    SELECT fn.*,
           pcs.product_no, pcs.product_desc,
           pl.name  AS line_name,
           dg.name  AS defect_group_name,
           dt.name  AS defect_type_name,
           pa.name  AS process_area_name,
           dr.found_date, dr.found_time, dr.initial_cause, dr.record_no AS fdr_no,
           dr.lot_no AS ref_doc_no,
           u.full_name AS created_by_name,
           sh.name AS shift_name,
           fmc.is_material AS fm_is_material
    FROM fg_fncp fn
    LEFT JOIN pro_code_sap pcs      ON pcs.id = fn.pro_code_sap_id
    LEFT JOIN production_lines pl   ON pl.id  = fn.production_line_id
    LEFT JOIN fg_defect_groups dg   ON dg.id  = fn.defect_group_id
    LEFT JOIN fg_defect_types  dt   ON dt.id  = fn.defect_type_id
    LEFT JOIN fg_defect_records dr  ON dr.id  = fn.defect_record_id
    LEFT JOIN fg_process_areas pa   ON pa.id  = dr.process_area_id
    LEFT JOIN users u               ON u.id   = fn.created_by
    LEFT JOIN shifts sh             ON sh.id  = dr.shift_id
    LEFT JOIN fg_fm_categories fmc  ON fmc.id = fn.fm_category_id
    WHERE fn.prod_token = ?
  `).get(token);
}

function isExpired(fncp) {
  if (!fncp.prod_token_expires_at) return false;
  return fncp.prod_token_expires_at < new Date().toISOString().slice(0, 10);
}

// ── GET /api/fncp-response/:token ────────────────────────────────────────────
router.get('/:token', publicLimit, (req, res) => {
  const fncp = getFncp(req.params.token);
  if (!fncp) return res.status(404).json({ error: 'ไม่พบข้อมูล หรือลิงก์ไม่ถูกต้อง' });
  if (isExpired(fncp)) return res.status(410).json({ error: 'ลิงก์หมดอายุแล้ว', expires_at: fncp.prod_token_expires_at });

  const images   = fncp.defect_record_id
    ? db.prepare('SELECT * FROM fg_defect_images WHERE defect_record_id=? ORDER BY sort_order,id').all(fncp.defect_record_id)
    : [];
  const fixImages = db.prepare('SELECT * FROM fg_fncp_fix_images WHERE fncp_id=? ORDER BY sort_order,id').all(fncp.id);

  res.json({ ...fncp, images, fixImages });
});

// ── POST /api/fncp-response/:token — production submits RCA/CA/PA ─────────
router.post('/:token', publicLimit, express.json(), (req, res) => {
  const fncp = getFncp(req.params.token);
  if (!fncp) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
  if (isExpired(fncp)) return res.status(410).json({ error: 'ลิงก์หมดอายุแล้ว' });

  // ปฏิเสธถ้าตอบไปแล้ว (ตรวจก่อน transaction เพื่อ early return)
  if (['waiting_verify', 'verified', 'closed'].includes(fncp.status)) {
    return res.status(409).json({ error: 'มีผู้ตอบเอกสารนี้แล้ว กรุณาติดต่อเจ้าหน้าที่ QC', already_submitted: true });
  }

  const { respondent_name, root_cause, corrective_action, preventive_action } = req.body;
  if (!respondent_name?.trim()) return res.status(400).json({ error: 'กรุณาระบุชื่อผู้ตอบ' });

  let saved = false;
  db.transaction(() => {
    // Optimistic lock — UPDATE จะมี changes=0 ถ้ามีคนอื่น submit ไปก่อนใน ms เดียวกัน
    const result = db.prepare(`
      UPDATE fg_fncp SET
        respondent_name    = ?,
        root_cause         = ?,
        corrective_action  = ?,
        preventive_action  = ?,
        status             = 'waiting_verify',
        in_progress_at     = datetime('now'),
        submit_verify_at   = datetime('now')
      WHERE id = ? AND status NOT IN ('waiting_verify','verified','closed')
    `).run(respondent_name.trim(), root_cause || null, corrective_action || null, preventive_action || null, fncp.id);

    if (result.changes === 0) return; // มีคนส่งก่อนใน concurrent request เดียวกัน

    saved = true;
    const responder = fncp.fm_is_material === 1 ? 'QC รับเข้า' : 'ฝ่ายผลิต';
    db.prepare(`INSERT INTO fg_fncp_timeline (fncp_id, action, comment, created_by) VALUES (?,?,?,NULL)`)
      .run(fncp.id, 'submit_verify', `${responder}ตอบกลับ โดย ${respondent_name.trim()}`);

    const qcUsers = db.prepare("SELECT id FROM users WHERE role IN ('qc_staff','qc_supervisor','qc_manager') AND is_active=1").all();
    const insN    = db.prepare("INSERT INTO notifications (user_id,title,message,link) VALUES (?,?,?,?)");
    for (const u of qcUsers) insN.run(u.id, `FNCP รอตรวจสอบ: ${fncp.fncp_no}`, `${responder}ตอบกลับแล้ว โดย ${respondent_name.trim()}`, `/fg-production/fncp/${fncp.id}`);
    if (db.pushSSE) db.pushSSE(qcUsers.map(u => u.id), 'notification', { title: `FNCP รอตรวจสอบ: ${fncp.fncp_no}` });
  })();

  if (!saved) {
    return res.status(409).json({ error: 'มีผู้ตอบเอกสารนี้แล้ว กรุณาติดต่อเจ้าหน้าที่ QC', already_submitted: true });
  }

  res.json({ ok: true });
});

// ── POST /api/fncp-response/:token/request-fuai — ขออนุมัติใช้พิเศษ (Critical only) ──
router.post('/:token/request-fuai', publicLimit, express.json(), (req, res) => {
  const fncp = getFncp(req.params.token);
  if (!fncp) return res.status(404).json({ error: 'ไม่พบข้อมูล หรือลิงก์ไม่ถูกต้อง' });
  if (isExpired(fncp)) return res.status(410).json({ error: 'ลิงก์หมดอายุแล้ว' });
  if (['fuai_opened', 'closed'].includes(fncp.status)) {
    return res.status(409).json({ error: 'ไม่สามารถสร้าง FUAI ได้ในสถานะนี้', status: fncp.status });
  }

  const { reason, respondent_name, defect_qty, defect_unit } = req.body;
  if (!respondent_name?.trim()) return res.status(400).json({ error: 'กรุณาระบุชื่อผู้ขออนุมัติ' });
  if (!reason?.trim()) return res.status(400).json({ error: 'กรุณาระบุเหตุผลการขออนุมัติใช้พิเศษ' });

  let result = {};
  db.transaction(() => {
    const fuai_no = db.nextFUAICode();
    const ins = db.prepare(`
      INSERT INTO fg_fuai (fuai_no, fncp_id, production_line_id, pro_code_sap_id,
        defect_qty, defect_unit, severity, reason, opened_by)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(fuai_no, fncp.id, fncp.production_line_id || null, fncp.pro_code_sap_id || null,
           +defect_qty || fncp.defect_qty || 0, defect_unit || fncp.defect_unit || 'pcs',
           fncp.severity || 'critical', reason.trim(), respondent_name.trim());

    const fuai_id = ins.lastInsertRowid;

    db.prepare("INSERT INTO fg_fuai_timeline (fuai_id, action, comment) VALUES (?,?,?)")
      .run(fuai_id, 'create', `ขออนุมัติใช้พิเศษ โดย ${respondent_name.trim()}`);

    db.prepare(`UPDATE fg_fncp SET status='fuai_opened' WHERE id=?`).run(fncp.id);
    db.prepare("INSERT INTO fg_fncp_timeline (fncp_id, action, comment, created_by) VALUES (?,?,?,NULL)")
      .run(fncp.id, 'fuai_opened', `เปิด FUAI: ${fuai_no} — ขออนุมัติใช้พิเศษ`);

    // Notify: production_manager, cpo, qc_manager, qc_supervisor
    const notifRoles = ['production_manager', 'cpo', 'qc_manager', 'qc_supervisor'];
    const notifUsers = db.prepare(`SELECT id FROM users WHERE role IN (${notifRoles.map(() => '?').join(',')}) AND is_active=1`).all(...notifRoles);
    const insN = db.prepare("INSERT INTO notifications (user_id, title, message, link) VALUES (?,?,?,?)");
    const link = `/fg-production/fuai/${fuai_id}`;
    for (const u of notifUsers) insN.run(u.id, `FUAI ใหม่: ${fuai_no}`, `ขออนุมัติใช้พิเศษ — ${fncp.fncp_no} โดย ${respondent_name.trim()}`, link);
    if (db.pushSSE && notifUsers.length) db.pushSSE(notifUsers.map(u => u.id), 'notification', { title: `FUAI ใหม่: ${fuai_no}` });

    result = { fuai_id, fuai_no };
  })();

  res.json({ ok: true, ...result });
});

// ── POST /api/fncp-response/:token/images — production uploads fix photos ──
router.post('/:token/images', publicLimit, uploads.fgFix.array('images', 10), verifyMagic, compressImages, (req, res) => {
  const fncp = db.prepare('SELECT id, prod_token_expires_at, status FROM fg_fncp WHERE prod_token=?').get(req.params.token);
  if (!fncp) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
  if (isExpired(fncp)) return res.status(410).json({ error: 'ลิงก์หมดอายุแล้ว' });
  if (!req.files?.length) return res.status(400).json({ error: 'ไม่พบไฟล์' });

  const maxSort = db.prepare('SELECT COALESCE(MAX(sort_order),0) AS m FROM fg_fncp_fix_images WHERE fncp_id=?').get(fncp.id).m;
  const ins     = db.prepare('INSERT INTO fg_fncp_fix_images (fncp_id, filename, original_name, sort_order) VALUES (?,?,?,?)');

  const saved = db.transaction(() =>
    req.files.map((f, i) => {
      const r = ins.run(fncp.id, f.filename, f.originalname, maxSort + i + 1);
      return { id: r.lastInsertRowid, filename: f.filename, original_name: f.originalname };
    })
  )();

  res.json({ files: saved, ok: true });
});

// ── DELETE /api/fncp-response/:token/images/:imgId ───────────────────────────
router.delete('/:token/images/:imgId', publicLimit, (req, res) => {
  const fncp = db.prepare('SELECT id, prod_token_expires_at FROM fg_fncp WHERE prod_token=?').get(req.params.token);
  if (!fncp || isExpired(fncp)) return res.status(410).json({ error: 'ลิงก์ไม่ถูกต้องหรือหมดอายุ' });

  const img = db.prepare('SELECT * FROM fg_fncp_fix_images WHERE id=? AND fncp_id=?').get(req.params.imgId, fncp.id);
  if (!img) return res.status(404).json({ error: 'ไม่พบรูปภาพ' });

  db.prepare('DELETE FROM fg_fncp_fix_images WHERE id=?').run(img.id);
  try {
    const fp = path.join(__dirname, '../../uploads/fg-fix', img.filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  } catch (_) {}
  res.json({ ok: true });
});

module.exports = router;
