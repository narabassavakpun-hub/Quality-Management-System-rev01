const express = require('express');
const router = express.Router();
const db = require('../db/database');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');

const PROD_ROLES        = ['admin', 'production_manager'];
const QC_ROLES          = ['admin', 'qc_staff', 'qc_supervisor', 'qc_manager'];
const QC_SUPERVISOR_ROLES = ['admin', 'qc_supervisor'];
const CLOSE_ROLES  = ['admin', 'qc_manager'];
const ALL_ROLES    = ['admin', 'qc_staff', 'qc_supervisor', 'qc_manager', 'production_manager', 'cpo'];

// ── Notification helpers ย้ายไป lib/fgNotify.js (แชร์กับ services/fgFncpService.js) ──
const { notifyRoles, notifyUser, notifyStation } = require('../lib/fgNotify');
const fgFncpService = require('../services/fgFncpService');

// ── GET /api/fg-fncp — list ───────────────────────────────────────────────────
router.get('/', auth, (req, res) => {
  const { q = '', line_id, status, severity, date_from, date_to, overdue_only, page = 1, limit = 20 } = req.query;
  const params = [];
  let where = '1=1';

  if (q)           { where += ' AND (fn.fncp_no LIKE ? OR fn.doc_no LIKE ? OR pcs.product_no LIKE ? OR pcs.product_desc LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
  if (line_id)     { where += ' AND fn.production_line_id=?'; params.push(+line_id); }
  if (status)      { where += ' AND fn.status=?';              params.push(status); }
  if (severity)    { where += ' AND fn.severity=?';            params.push(severity); }
  if (date_from)   { where += ' AND fn.created_at>=?';         params.push(date_from); }
  if (date_to)     { where += ' AND fn.created_at<=?';         params.push(date_to + ' 23:59:59'); }
  if (overdue_only === '1') { where += " AND fn.due_date < date('now') AND fn.status NOT IN ('closed','verified')"; }

  const offset = (+page - 1) * +limit;
  const rows = db.prepare(`
    SELECT fn.*,
           pl.name AS line_name,
           pcs.product_no, pcs.product_desc,
           dg.name AS defect_group_name,
           dt.name AS defect_type_name,
           ou.full_name AS opened_by_name,
           pu.full_name AS pic_name
    FROM fg_fncp fn
    LEFT JOIN production_lines pl ON pl.id = fn.production_line_id
    LEFT JOIN pro_code_sap pcs    ON pcs.id = fn.pro_code_sap_id
    LEFT JOIN fg_defect_groups dg  ON dg.id = fn.defect_group_id
    LEFT JOIN fg_defect_types dt   ON dt.id = fn.defect_type_id
    LEFT JOIN users ou             ON ou.id = fn.opened_by
    LEFT JOIN users pu             ON pu.id = fn.pic_user_id
    WHERE ${where}
    ORDER BY fn.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, +limit, +offset);

  const total = db.prepare(`
    SELECT COUNT(*) as c FROM fg_fncp fn
    LEFT JOIN pro_code_sap pcs ON pcs.id = fn.pro_code_sap_id
    WHERE ${where}
  `).get(...params);

  res.json({ data: rows, total: total.c, page: +page, limit: +limit });
});

// ── GET /api/fg-fncp/stats — dashboard counts ─────────────────────────────────
router.get('/stats', auth, (req, res) => {
  const open       = db.prepare("SELECT COUNT(*) as c FROM fg_fncp WHERE status NOT IN ('closed','verified')").get().c;
  const overdue    = db.prepare("SELECT COUNT(*) as c FROM fg_fncp WHERE due_date < date('now') AND status NOT IN ('closed','verified')").get().c;
  const closed30   = db.prepare("SELECT COUNT(*) as c FROM fg_fncp WHERE status IN ('closed','verified') AND closed_at >= date('now','-30 days')").get().c;
  const byStatus   = db.prepare("SELECT status, COUNT(*) as c FROM fg_fncp GROUP BY status").all();
  res.json({ open, overdue, closed30, byStatus });
});

// ── GET /api/fg-fncp/:id — detail + timeline ─────────────────────────────────
router.get('/:id', auth, (req, res) => {
  const row = db.prepare(`
    SELECT fn.*,
           pl.name AS line_name,
           pcs.product_no, pcs.product_desc,
           pcs.line_type, pcs.brand, pcs.product_series, pcs.panel_type,
           pcs.panel_style, pcs.mosquito_net, pcs.glass_type, pcs.panel_color, pcs.panel_size,
           dg.name AS defect_group_name,
           dt.name AS defect_type_name,
           ou.full_name AS opened_by_name,
           pu.full_name AS pic_name,
           iu.full_name AS in_progress_by_name,
           sv.full_name AS submit_verify_by_name,
           vu.full_name AS verified_by_name,
           cu.full_name AS closed_by_name,
           ru.full_name AS rejected_by_name,
           dr.initial_cause,
           dr.found_date AS dr_found_date, dr.found_time AS dr_found_time,
           dr.lot_no AS ref_doc_no,
           fmc.name AS fm_category_name,
           fmc.is_material AS fm_is_material
    FROM fg_fncp fn
    LEFT JOIN production_lines pl    ON pl.id = fn.production_line_id
    LEFT JOIN pro_code_sap pcs       ON pcs.id = fn.pro_code_sap_id
    LEFT JOIN fg_defect_groups dg    ON dg.id = fn.defect_group_id
    LEFT JOIN fg_defect_types dt     ON dt.id = fn.defect_type_id
    LEFT JOIN fg_defect_records dr   ON dr.id = fn.defect_record_id
    LEFT JOIN users ou ON ou.id = fn.opened_by
    LEFT JOIN users pu ON pu.id = fn.pic_user_id
    LEFT JOIN users iu ON iu.id = fn.in_progress_by
    LEFT JOIN users sv ON sv.id = fn.submit_verify_by
    LEFT JOIN users vu ON vu.id = fn.verified_by
    LEFT JOIN users cu ON cu.id = fn.closed_by
    LEFT JOIN users ru ON ru.id = fn.rejected_by
    LEFT JOIN fg_fm_categories fmc ON fmc.id = fn.fm_category_id
    WHERE fn.id=?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'ไม่พบ FNCP' });

  const timeline = db.prepare(`
    SELECT tl.*, u.full_name AS actor_name
    FROM fg_fncp_timeline tl LEFT JOIN users u ON u.id=tl.created_by
    WHERE tl.fncp_id=? ORDER BY tl.created_at
  `).all(req.params.id);

  const images = row.defect_record_id
    ? db.prepare('SELECT * FROM fg_defect_images WHERE defect_record_id=? ORDER BY sort_order,id').all(row.defect_record_id)
    : [];

  const fixImages = db.prepare('SELECT * FROM fg_fncp_fix_images WHERE fncp_id=? ORDER BY sort_order,id').all(row.id);

  const fuaiRow = db.prepare('SELECT id, fuai_no, status FROM fg_fuai WHERE fncp_id=? ORDER BY id DESC LIMIT 1').get(row.id);

  res.json({ ...row, timeline, images, fixImages, fuai_id: fuaiRow?.id || null, fuai_no: fuaiRow?.fuai_no || null, fuai_status: fuaiRow?.status || null });
});

// ── PUT /api/fg-fncp/:id — update fields (open or in_progress only) ──────────
router.put('/:id', auth, requireRole([...PROD_ROLES, ...QC_ROLES]), (req, res) => {
  const old = db.prepare('SELECT * FROM fg_fncp WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'ไม่พบ FNCP' });
  if (!['open','in_progress','reject'].includes(old.status)) return res.status(409).json({ error: 'ไม่สามารถแก้ไขในสถานะนี้' });

  const {
    department_responsible, root_cause, correction, corrective_action, preventive_action,
    pic_user_id, due_date, verification_result,
  } = req.body;

  db.prepare(`
    UPDATE fg_fncp SET
      department_responsible=?, root_cause=?, correction=?,
      corrective_action=?, preventive_action=?,
      pic_user_id=?, due_date=?, verification_result=?
    WHERE id=?
  `).run(
    department_responsible ?? old.department_responsible,
    root_cause ?? old.root_cause,
    correction ?? old.correction,
    corrective_action ?? old.corrective_action,
    preventive_action ?? old.preventive_action,
    pic_user_id ?? old.pic_user_id,
    due_date ?? old.due_date,
    verification_result ?? old.verification_result,
    req.params.id
  );

  db.prepare("INSERT INTO fg_fncp_timeline (fncp_id, action, comment, created_by) VALUES (?,?,?,?)").run(req.params.id, 'comment', 'แก้ไขข้อมูล FNCP', req.user.id);
  res.json({ ok: true });
});

// ── Status transition factory ──────────────────────────────────────────────────
function makeTransition(action, fromStatuses, toStatus, roles, updateFields) {
  router.patch(`/:id/${action}`, auth, requireRole(roles), (req, res) => {
    const old = db.prepare('SELECT * FROM fg_fncp WHERE id=?').get(req.params.id);
    if (!old) return res.status(404).json({ error: 'ไม่พบ FNCP' });
    if (!fromStatuses.includes(old.status)) return res.status(409).json({ error: `ไม่สามารถดำเนินการในสถานะ "${old.status}"` });

    const { comment, ...extra } = req.body;
    const fields = { status: toStatus, ...updateFields(req.user.id, extra) };

    const setClause = Object.keys(fields).map(k => `${k}=?`).join(',');
    db.prepare(`UPDATE fg_fncp SET ${setClause} WHERE id=?`).run(...Object.values(fields), req.params.id);
    db.prepare("INSERT INTO fg_fncp_timeline (fncp_id, action, comment, created_by) VALUES (?,?,?,?)").run(req.params.id, action, comment || null, req.user.id);
    db.auditLog('fg_fncp', req.params.id, action.toUpperCase(), { status: old.status }, { status: toStatus }, req.user.id, req.ip);

    return { old, fncp_no: old.fncp_no };
  });
}

// PATCH /api/fg-fncp/:id/start — open → in_progress (production team)
router.patch('/:id/start', auth, requireRole(PROD_ROLES), (req, res) => {
  const old = db.prepare('SELECT * FROM fg_fncp WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'ไม่พบ FNCP' });
  if (!['open','reject'].includes(old.status)) return res.status(409).json({ error: 'ไม่สามารถเริ่มในสถานะนี้' });

  const { comment, department_responsible, root_cause, correction, corrective_action, preventive_action, due_date } = req.body;
  fgFncpService.start({ old, comment, department_responsible, root_cause, correction, corrective_action, preventive_action, due_date, actorId: req.user.id, actorIp: req.ip });
  res.json({ ok: true });
});

// PATCH /api/fg-fncp/:id/submit-verify — in_progress → waiting_verify
router.patch('/:id/submit-verify', auth, requireRole(PROD_ROLES), (req, res) => {
  const old = db.prepare('SELECT * FROM fg_fncp WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'ไม่พบ FNCP' });
  if (old.status !== 'in_progress') return res.status(409).json({ error: 'ต้องอยู่ในสถานะ "กำลังดำเนินการ"' });

  const { comment } = req.body;
  fgFncpService.submitVerify({ old, comment, actorId: req.user.id, actorIp: req.ip });
  res.json({ ok: true });
});

// PATCH /api/fg-fncp/:id/verify — waiting_verify → verified
router.patch('/:id/verify', auth, requireRole(QC_SUPERVISOR_ROLES), (req, res) => {
  const old = db.prepare('SELECT * FROM fg_fncp WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'ไม่พบ FNCP' });
  if (old.status !== 'waiting_verify') return res.status(409).json({ error: 'ต้องอยู่ในสถานะ "รอตรวจสอบ"' });

  const { comment, verification_result } = req.body;
  fgFncpService.verify({ old, comment, verification_result, actorId: req.user.id, actorIp: req.ip });
  res.json({ ok: true });
});

// PATCH /api/fg-fncp/:id/reject — waiting_verify → reject
router.patch('/:id/reject', auth, requireRole(QC_SUPERVISOR_ROLES), (req, res) => {
  const old = db.prepare('SELECT * FROM fg_fncp WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'ไม่พบ FNCP' });
  if (old.status !== 'waiting_verify') return res.status(409).json({ error: 'ต้องอยู่ในสถานะ "รอตรวจสอบ"' });

  const { comment, reject_reason } = req.body;
  if (!reject_reason) return res.status(400).json({ error: 'กรุณาระบุเหตุผลที่ปฏิเสธ' });

  fgFncpService.reject({ old, comment, reject_reason, actorId: req.user.id, actorIp: req.ip });
  res.json({ ok: true });
});

// PATCH /api/fg-fncp/:id/close — verified → closed
router.patch('/:id/close', auth, requireRole(CLOSE_ROLES), (req, res) => {
  const old = db.prepare('SELECT * FROM fg_fncp WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'ไม่พบ FNCP' });
  if (old.status !== 'verified') return res.status(409).json({ error: 'ต้องอยู่ในสถานะ "QC ยืนยันแล้ว"' });

  const { comment } = req.body;
  fgFncpService.close({ old, comment, actorId: req.user.id, actorIp: req.ip });
  res.json({ ok: true });
});

// PATCH /api/fg-fncp/:id/supervisor-approve — waiting_verify → closed (minor) or supervisor_approved (major/critical)
router.patch('/:id/supervisor-approve', auth, requireRole(['admin', 'qc_supervisor', 'qc_manager']), (req, res) => {
  const old = db.prepare('SELECT * FROM fg_fncp WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'ไม่พบ FNCP' });
  if (old.status !== 'waiting_verify') return res.status(409).json({ error: 'ต้องอยู่ในสถานะ "รอตรวจสอบ"' });

  const { comment } = req.body;
  const newStatus = fgFncpService.supervisorApprove({ old, comment, actorId: req.user.id, actorIp: req.ip });
  res.json({ ok: true, new_status: newStatus });
});

// PATCH /api/fg-fncp/:id/manager-approve — supervisor_approved → closed
router.patch('/:id/manager-approve', auth, requireRole(['admin', 'qc_manager']), (req, res) => {
  const old = db.prepare('SELECT * FROM fg_fncp WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'ไม่พบ FNCP' });
  if (old.status !== 'supervisor_approved') return res.status(409).json({ error: 'ต้องอยู่ในสถานะ "Supervisor อนุมัติแล้ว"' });

  const { comment } = req.body;
  fgFncpService.managerApprove({ old, comment, actorId: req.user.id, actorIp: req.ip });
  res.json({ ok: true, new_status: 'closed' });
});

// ── DELETE /api/fg-fncp/:id — admin only, hard delete (open status only) ─────
router.delete('/:id', auth, requireRole(['admin']), (req, res) => {
  const old = db.prepare('SELECT * FROM fg_fncp WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'ไม่พบ FNCP' });
  if (!['open', 'reject'].includes(old.status)) return res.status(409).json({ error: 'ลบได้เฉพาะ FNCP ที่ยังไม่ดำเนินการ (สถานะ: เปิด / ปฏิเสธ)' });

  db.transaction(() => {
    db.prepare('DELETE FROM fg_fncp_timeline WHERE fncp_id=?').run(old.id);
    db.prepare('DELETE FROM fg_fncp_fix_images WHERE fncp_id=?').run(old.id);
    db.prepare('DELETE FROM fg_fncp WHERE id=?').run(old.id);
    db.auditLog('fg_fncp', old.id, 'DELETE', old, null, req.user.id, req.ip);
  })();

  res.json({ ok: true });
});

// ── POST /api/fg-fncp/:id/copy-link — log timeline every time link is copied ──
router.post('/:id/copy-link', auth, (req, res) => {
  const fn = db.prepare(`
    SELECT fn.id, fn.fncp_no, fn.status, fmc.is_material AS fm_is_material
    FROM fg_fncp fn
    LEFT JOIN fg_fm_categories fmc ON fmc.id = fn.fm_category_id
    WHERE fn.id=?
  `).get(req.params.id);
  if (!fn) return res.status(404).json({ error: 'ไม่พบ FNCP' });

  const isMaterial = fn.fm_is_material === 1;
  const linkLabel  = isMaterial ? 'QC รับเข้า' : 'ฝ่ายผลิต';

  // วันหมดอายุแสดงในฟอร์แมต DD/MM/YYYY เขตเวลา UTC+7
  const expiryUTC = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const expiryTH  = new Date(expiryUTC.getTime() + 7 * 60 * 60 * 1000);
  const p = n => String(n).padStart(2, '0');
  const expiryStr = `${expiryTH.getUTCDate()}/${p(expiryTH.getUTCMonth() + 1)}/${expiryTH.getUTCFullYear()}`;

  const totalCopy = db.prepare("SELECT COUNT(*) as c FROM fg_fncp_timeline WHERE fncp_id=? AND action='copy_link'").get(fn.id).c;

  let comment;
  if (fn.status === 'reject') {
    const rejectRound = db.prepare("SELECT COUNT(*) as c FROM fg_fncp_timeline WHERE fncp_id=? AND action='reject'").get(fn.id).c;
    const lastReject  = db.prepare("SELECT created_at FROM fg_fncp_timeline WHERE fncp_id=? AND action='reject' ORDER BY id DESC LIMIT 1").get(fn.id);
    const copyAfterReject = lastReject
      ? db.prepare("SELECT COUNT(*) as c FROM fg_fncp_timeline WHERE fncp_id=? AND action='copy_link' AND created_at > ?").get(fn.id, lastReject.created_at).c
      : 0;
    comment = `คัดลอกลิงก์${linkLabel}ตอบใหม่(${rejectRound}) (ครั้งที่ ${copyAfterReject + 1}) — ตอบได้ถึงวันที่ ${expiryStr}`;
  } else {
    comment = `คัดลอกลิงก์ ${linkLabel} (ครั้งที่ ${totalCopy + 1}) — ตอบได้ถึงวันที่ ${expiryStr}`;
  }

  db.transaction(() => {
    db.prepare("UPDATE fg_fncp SET prod_token_expires_at=datetime('now','+7 days') WHERE id=?").run(fn.id);
    db.prepare("INSERT INTO fg_fncp_timeline (fncp_id, action, comment, created_by) VALUES (?,?,?,?)")
      .run(fn.id, 'copy_link', comment, req.user.id);
  })();

  res.json({ ok: true, count: totalCopy + 1 });
});

module.exports = router;
