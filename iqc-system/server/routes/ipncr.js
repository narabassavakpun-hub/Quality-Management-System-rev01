// IPNCR routes — Major defect NCR for In-Process QC
// Mounted at /api/ipncr
// Status machine: open → prod_acknowledged → rechecking → prod_manager_approved → qc_reinspecting → qc_supervisor_verified → closed
const express = require('express');
const router = express.Router();
const db = require('../db/database');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { getUsersByRole, createNotification, sendTelegram } = require('../lib/notify');
const ipncrService = require('../services/ipncrService');

const VIEWER_ROLES = ['admin', 'qc_staff', 'qc_supervisor', 'qc_manager', 'cpo', 'production_manager', 'prod_supervisor'];
const PROD_ROLES   = ['admin', 'production_manager', 'prod_supervisor'];
const QC_ROLES     = ['admin', 'qc_staff', 'qc_supervisor'];

// GET / — list
router.get('/', auth, requireRole(VIEWER_ROLES), (req, res) => {
  try {
    const { page = 1, limit = 20, q = '', status, line_id, date_from, date_to } = req.query;
    const offset = (page - 1) * limit;
    const conds = [];
    const params = [];

    if (q) {
      conds.push('(r.record_no LIKE ? OR r.doc_no LIKE ? OR pcs.product_no LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like);
    }
    if (status)    { conds.push('r.status = ?'); params.push(status); }
    if (line_id)   { conds.push('r.production_line_id = ?'); params.push(+line_id); }
    if (date_from) { conds.push('r.created_at >= ?'); params.push(date_from); }
    if (date_to)   { conds.push('r.created_at <= ?'); params.push(date_to + ' 23:59:59'); }

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const base = `
      FROM ipncr_records r
      LEFT JOIN pro_code_sap pcs   ON pcs.id = r.pro_code_sap_id
      LEFT JOIN production_lines pl ON pl.id = r.production_line_id
      LEFT JOIN users u             ON u.id = r.created_by
      ${where}
    `;

    const total = db.prepare(`SELECT COUNT(*) as c ${base}`).get(...params).c;
    const rows  = db.prepare(`
      SELECT r.id, r.record_no, r.doc_no, r.status, r.recheck_attempt,
             r.defect_description, r.total_qty_affected, r.deadline,
             r.created_at,
             pcs.product_no, pcs.product_desc,
             pl.name AS line_name,
             u.full_name AS creator_name
      ${base}
      ORDER BY r.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, +limit, +offset);

    res.json({ data: rows, total, page: +page, limit: +limit });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /:id — detail
router.get('/:id', auth, requireRole(VIEWER_ROLES), (req, res) => {
  try {
    const r = db.prepare(`
      SELECT r.*,
             pcs.product_no, pcs.product_desc, pcs.brand, pcs.panel_size,
             pl.name AS line_name,
             s.name AS station_name,
             u.full_name AS creator_name,
             ack_u.full_name AS prod_acknowledged_name,
             pmgr_u.full_name AS prod_manager_approved_name,
             reinsp_u.full_name AS qc_reinspect_name,
             ver_u.full_name AS qc_supervisor_verified_name,
             cls_u.full_name AS closed_name
      FROM ipncr_records r
      LEFT JOIN pro_code_sap pcs        ON pcs.id = r.pro_code_sap_id
      LEFT JOIN production_lines pl      ON pl.id = r.production_line_id
      LEFT JOIN ipqc_inspections insp    ON insp.id = r.inspection_id
      LEFT JOIN ipqc_stations s          ON s.id = insp.station_id
      LEFT JOIN users u                  ON u.id = r.created_by
      LEFT JOIN users ack_u              ON ack_u.id = r.prod_acknowledged_by
      LEFT JOIN users pmgr_u             ON pmgr_u.id = r.prod_manager_approved_by
      LEFT JOIN users reinsp_u           ON reinsp_u.id = r.qc_reinspect_by
      LEFT JOIN users ver_u              ON ver_u.id = r.verified_by
      LEFT JOIN users cls_u              ON cls_u.id = r.closed_by
      WHERE r.id = ?
    `).get(req.params.id);
    if (!r) return res.status(404).json({ error: 'ไม่พบรายการ' });

    r.recheck_logs = db.prepare(`
      SELECT l.*, u.full_name AS created_by_name
      FROM ipncr_recheck_logs l
      LEFT JOIN users u ON u.id = l.created_by
      WHERE l.ipncr_id = ?
      ORDER BY l.attempt ASC, l.id ASC
    `).all(r.id);

    if (r.inspection_id) {
      r.inspection = db.prepare('SELECT id, record_no, inspect_date, inspect_time, overall_result FROM ipqc_inspections WHERE id = ?').get(r.inspection_id);
    }

    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST / — create IPNCR (usually from inspection fail)
router.post('/', auth, requireRole(QC_ROLES), (req, res) => {
  try {
    const {
      inspection_id, doc_no, pro_code_sap_id, production_line_id,
      defect_description, total_qty_affected, action_required, deadline,
    } = req.body;

    if (!doc_no || !defect_description) {
      return res.status(400).json({ error: 'กรุณากรอก Doc No และรายละเอียดปัญหา' });
    }

    const newId = ipncrService.createIpncr({
      inspection_id, doc_no, pro_code_sap_id, production_line_id,
      defect_description, total_qty_affected, action_required, deadline,
      actorId: req.user.id, actorIp: req.ip,
    });
    res.status(201).json({ id: newId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /:id/acknowledge — prod_supervisor / production_manager รับทราบ
router.patch('/:id/acknowledge', auth, requireRole(PROD_ROLES), (req, res) => {
  try {
    const r = db.prepare('SELECT * FROM ipncr_records WHERE id = ?').get(req.params.id);
    if (!r) return res.status(404).json({ error: 'ไม่พบรายการ' });

    ipncrService.acknowledge({ r, actorId: req.user.id, actorIp: req.ip });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// PATCH /:id/start-recheck — production_manager เริ่ม recheck
router.patch('/:id/start-recheck', auth, requireRole(['admin', 'production_manager']), (req, res) => {
  try {
    const r = db.prepare('SELECT * FROM ipncr_records WHERE id = ?').get(req.params.id);
    if (!r) return res.status(404).json({ error: 'ไม่พบรายการ' });

    ipncrService.startRecheck({ r, actorId: req.user.id, actorIp: req.ip });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// PATCH /:id/submit-for-qc — production_manager ส่งให้ QC ตรวจซ้ำ
router.patch('/:id/submit-for-qc', auth, requireRole(['admin', 'production_manager']), (req, res) => {
  try {
    const r = db.prepare('SELECT * FROM ipncr_records WHERE id = ?').get(req.params.id);
    if (!r) return res.status(404).json({ error: 'ไม่พบรายการ' });

    const { root_cause, corrective_action, qty_rechecked, qty_pass, qty_fail, qty_scrap, remarks } = req.body;
    if (!root_cause || !corrective_action) {
      return res.status(400).json({ error: 'กรุณากรอก Root Cause และ Corrective Action' });
    }

    ipncrService.submitForQc({ r, root_cause, corrective_action, qty_rechecked, qty_pass, qty_fail, qty_scrap, remarks, actorId: req.user.id, actorIp: req.ip });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// PATCH /:id/qc-reinspect-pass — QC ตรวจซ้ำแล้วผ่าน → qc_supervisor_verified
router.patch('/:id/qc-reinspect-pass', auth, requireRole(QC_ROLES), (req, res) => {
  try {
    const r = db.prepare('SELECT * FROM ipncr_records WHERE id = ?').get(req.params.id);
    if (!r) return res.status(404).json({ error: 'ไม่พบรายการ' });

    const { qty_pass, qty_fail, remarks } = req.body;

    ipncrService.qcReinspectPass({ r, qty_pass, qty_fail, remarks, actorId: req.user.id, actorIp: req.ip });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// PATCH /:id/qc-reinspect-fail — QC ตรวจซ้ำแล้วไม่ผ่าน → กลับไป rechecking + attempt += 1
router.patch('/:id/qc-reinspect-fail', auth, requireRole(QC_ROLES), (req, res) => {
  try {
    const r = db.prepare('SELECT * FROM ipncr_records WHERE id = ?').get(req.params.id);
    if (!r) return res.status(404).json({ error: 'ไม่พบรายการ' });

    const { qty_fail, remarks } = req.body;
    if (!remarks) return res.status(400).json({ error: 'กรุณาระบุเหตุผลที่ไม่ผ่าน' });

    const nextAttempt = ipncrService.qcReinspectFail({ r, qty_fail, remarks, actorId: req.user.id, actorIp: req.ip });
    res.json({ ok: true, next_attempt: nextAttempt });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// PATCH /:id/close — qc_manager ปิด
router.patch('/:id/close', auth, requireRole(['admin', 'qc_manager']), (req, res) => {
  try {
    const r = db.prepare('SELECT * FROM ipncr_records WHERE id = ?').get(req.params.id);
    if (!r) return res.status(404).json({ error: 'ไม่พบรายการ' });

    const { remarks } = req.body;

    ipncrService.close({ r, remarks, actorId: req.user.id, actorIp: req.ip });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// PATCH /:id/cancel — ยกเลิก (admin only)
router.patch('/:id/cancel', auth, requireRole(['admin']), (req, res) => {
  try {
    const r = db.prepare('SELECT * FROM ipncr_records WHERE id = ?').get(req.params.id);
    if (!r) return res.status(404).json({ error: 'ไม่พบรายการ' });
    if (r.status === 'closed' || r.status === 'cancelled') return res.status(400).json({ error: 'ไม่สามารถยกเลิกได้' });

    db.prepare("UPDATE ipncr_records SET status='cancelled', closed_by=?, closed_at=datetime('now') WHERE id=?").run(req.user.id, r.id);
    db.auditLog('ipncr_records', r.id, 'CANCEL', { status: r.status }, { status: 'cancelled' }, req.user.id, req.ip);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
