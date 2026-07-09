const express = require('express');
const router = express.Router();
const db = require('../db/database');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');

// notify/timeline transaction logic ย้ายไป services/fgFuaiService.js (+ lib/fgNotify.js)
const fgFuaiService = require('../services/fgFuaiService');

// ── GET /api/fg-fuai — list ───────────────────────────────────────────────────
router.get('/', auth, (req, res) => {
  const { q = '', status, line_id, date_from, date_to, page = 1, limit = 20 } = req.query;
  const params = [];
  let where = '1=1';

  if (q)        { where += ' AND (fu.fuai_no LIKE ? OR fn.fncp_no LIKE ? OR pcs.product_no LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (status)   { where += ' AND fu.status=?';               params.push(status); }
  if (line_id)  { where += ' AND fu.production_line_id=?';   params.push(+line_id); }
  if (date_from){ where += ' AND fu.created_at>=?';          params.push(date_from); }
  if (date_to)  { where += ' AND fu.created_at<=?';          params.push(date_to + ' 23:59:59'); }

  const offset = (+page - 1) * +limit;
  const rows = db.prepare(`
    SELECT fu.*,
           fn.fncp_no, fn.severity AS fncp_severity,
           pl.name AS line_name,
           pcs.product_no, pcs.product_desc
    FROM fg_fuai fu
    LEFT JOIN fg_fncp fn             ON fn.id = fu.fncp_id
    LEFT JOIN production_lines pl    ON pl.id = fu.production_line_id
    LEFT JOIN pro_code_sap pcs       ON pcs.id = fu.pro_code_sap_id
    WHERE ${where}
    ORDER BY fu.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, +limit, +offset);

  const total = db.prepare(`
    SELECT COUNT(*) as c FROM fg_fuai fu
    LEFT JOIN fg_fncp fn ON fn.id = fu.fncp_id
    LEFT JOIN pro_code_sap pcs ON pcs.id = fu.pro_code_sap_id
    WHERE ${where}
  `).get(...params);

  res.json({ data: rows, total: total.c, page: +page, limit: +limit });
});

// ── GET /api/fg-fuai/:id — detail + timeline ─────────────────────────────────
router.get('/:id', auth, (req, res) => {
  const row = db.prepare(`
    SELECT fu.*,
           fn.fncp_no, fn.severity AS fncp_severity,
           fn.defect_qty AS fncp_defect_qty, fn.defect_unit AS fncp_defect_unit,
           fn.root_cause, fn.corrective_action, fn.preventive_action,
           pl.name AS line_name,
           pcs.product_no, pcs.product_desc,
           pm.full_name AS prod_manager_name,
           cu.full_name AS cpo_name,
           qm.full_name AS qc_manager_name,
           qs.full_name AS qc_staff_name,
           qsv.full_name AS qc_supervisor_name
    FROM fg_fuai fu
    LEFT JOIN fg_fncp fn                ON fn.id = fu.fncp_id
    LEFT JOIN production_lines pl       ON pl.id = fu.production_line_id
    LEFT JOIN pro_code_sap pcs          ON pcs.id = fu.pro_code_sap_id
    LEFT JOIN users pm  ON pm.id  = fu.prod_manager_approved_by
    LEFT JOIN users cu  ON cu.id  = fu.cpo_approved_by
    LEFT JOIN users qm  ON qm.id  = fu.qc_manager_approved_by
    LEFT JOIN users qs  ON qs.id  = fu.qc_staff_ack_by
    LEFT JOIN users qsv ON qsv.id = fu.qc_supervisor_ack_by
    WHERE fu.id=?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'ไม่พบ FUAI' });

  const timeline = db.prepare(`
    SELECT tl.*, u.full_name AS actor_name
    FROM fg_fuai_timeline tl LEFT JOIN users u ON u.id=tl.created_by
    WHERE tl.fuai_id=? ORDER BY tl.created_at
  `).all(req.params.id);

  res.json({ ...row, timeline });
});

// ── PATCH /:id/prod-manager-approve — pending_prod_manager → pending_cpo ──────
router.patch('/:id/prod-manager-approve', auth, requireRole(['admin', 'production_manager']), (req, res) => {
  const fuai = db.prepare('SELECT * FROM fg_fuai WHERE id=?').get(req.params.id);
  if (!fuai) return res.status(404).json({ error: 'ไม่พบ FUAI' });
  if (fuai.status !== 'pending_prod_manager') return res.status(409).json({ error: 'ไม่สามารถดำเนินการในสถานะนี้' });

  const { comment } = req.body;
  fgFuaiService.prodManagerApprove({ fuai, comment, actorId: req.user.id, actorIp: req.ip });
  res.json({ ok: true });
});

// ── PATCH /:id/cpo-approve — pending_cpo → pending_qc_manager ────────────────
router.patch('/:id/cpo-approve', auth, requireRole(['admin', 'cpo']), (req, res) => {
  const fuai = db.prepare('SELECT * FROM fg_fuai WHERE id=?').get(req.params.id);
  if (!fuai) return res.status(404).json({ error: 'ไม่พบ FUAI' });
  if (fuai.status !== 'pending_cpo') return res.status(409).json({ error: 'ไม่สามารถดำเนินการในสถานะนี้' });

  const { comment } = req.body;
  fgFuaiService.cpoApprove({ fuai, comment, actorId: req.user.id, actorIp: req.ip });
  res.json({ ok: true });
});

// ── PATCH /:id/cpo-reject — pending_cpo → rejected + reopen FNCP ─────────────
router.patch('/:id/cpo-reject', auth, requireRole(['admin', 'cpo']), (req, res) => {
  const fuai = db.prepare('SELECT * FROM fg_fuai WHERE id=?').get(req.params.id);
  if (!fuai) return res.status(404).json({ error: 'ไม่พบ FUAI' });
  if (fuai.status !== 'pending_cpo') return res.status(409).json({ error: 'ไม่สามารถดำเนินการในสถานะนี้' });

  const { reason } = req.body;
  if (!reason?.trim()) return res.status(400).json({ error: 'กรุณาระบุเหตุผลการปฏิเสธ' });

  fgFuaiService.cpoReject({ fuai, reason, actorId: req.user.id, actorIp: req.ip });
  res.json({ ok: true });
});

// ── PATCH /:id/qc-manager-approve — pending_qc_manager → pending_qc_staff_ack ─
router.patch('/:id/qc-manager-approve', auth, requireRole(['admin', 'qc_manager']), (req, res) => {
  const fuai = db.prepare('SELECT * FROM fg_fuai WHERE id=?').get(req.params.id);
  if (!fuai) return res.status(404).json({ error: 'ไม่พบ FUAI' });
  if (fuai.status !== 'pending_qc_manager') return res.status(409).json({ error: 'ไม่สามารถดำเนินการในสถานะนี้' });

  const { comment } = req.body;
  fgFuaiService.qcManagerApprove({ fuai, comment, actorId: req.user.id, actorIp: req.ip });
  res.json({ ok: true });
});

// ── PATCH /:id/qc-manager-reject — pending_qc_manager → rejected + reopen FNCP ─
router.patch('/:id/qc-manager-reject', auth, requireRole(['admin', 'qc_manager']), (req, res) => {
  const fuai = db.prepare('SELECT * FROM fg_fuai WHERE id=?').get(req.params.id);
  if (!fuai) return res.status(404).json({ error: 'ไม่พบ FUAI' });
  if (fuai.status !== 'pending_qc_manager') return res.status(409).json({ error: 'ไม่สามารถดำเนินการในสถานะนี้' });

  const { reason } = req.body;
  if (!reason?.trim()) return res.status(400).json({ error: 'กรุณาระบุเหตุผลการปฏิเสธ' });

  fgFuaiService.qcManagerReject({ fuai, reason, actorId: req.user.id, actorIp: req.ip });
  res.json({ ok: true });
});

// ── PATCH /:id/qc-staff-ack — pending_qc_staff_ack → pending_qc_supervisor_ack ─
router.patch('/:id/qc-staff-ack', auth, requireRole(['admin', 'qc_staff']), (req, res) => {
  const fuai = db.prepare('SELECT * FROM fg_fuai WHERE id=?').get(req.params.id);
  if (!fuai) return res.status(404).json({ error: 'ไม่พบ FUAI' });
  if (fuai.status !== 'pending_qc_staff_ack') return res.status(409).json({ error: 'ไม่สามารถดำเนินการในสถานะนี้' });

  const { comment } = req.body;
  fgFuaiService.qcStaffAck({ fuai, comment, actorId: req.user.id, actorIp: req.ip });
  res.json({ ok: true });
});

// ── PATCH /:id/qc-supervisor-ack — pending_qc_supervisor_ack → closed ─────────
router.patch('/:id/qc-supervisor-ack', auth, requireRole(['admin', 'qc_supervisor', 'qc_manager']), (req, res) => {
  const fuai = db.prepare('SELECT * FROM fg_fuai WHERE id=?').get(req.params.id);
  if (!fuai) return res.status(404).json({ error: 'ไม่พบ FUAI' });
  if (fuai.status !== 'pending_qc_supervisor_ack') return res.status(409).json({ error: 'ไม่สามารถดำเนินการในสถานะนี้' });

  const { comment } = req.body;
  fgFuaiService.qcSupervisorAck({ fuai, comment, actorId: req.user.id, actorIp: req.ip });
  res.json({ ok: true });
});

module.exports = router;
