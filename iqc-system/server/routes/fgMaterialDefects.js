const express = require('express');
const router = express.Router();
const db = require('../db/database');
const auth = require('../middleware/auth');

// ── GET /api/fg-material-defects — list ──────────────────────────────────────
router.get('/', auth, (req, res) => {
  const { page = 1, limit = 20, status } = req.query;
  const params = [];
  let where = '1=1';

  if (status) { where += ' AND md.status=?'; params.push(status); }

  const offset = (+page - 1) * +limit;
  const rows = db.prepare(`
    SELECT md.*,
           fn.fncp_no,
           u.full_name AS acknowledge_by_name
    FROM fg_material_defects md
    LEFT JOIN fg_fncp fn ON fn.id = md.fncp_id
    LEFT JOIN users u    ON u.id  = md.acknowledge_by
    WHERE ${where}
    ORDER BY md.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, +limit, +offset);

  const total = db.prepare(`SELECT COUNT(*) as c FROM fg_material_defects md WHERE ${where}`).get(...params);

  res.json({ data: rows, total: total.c, page: +page, limit: +limit });
});

// ── PATCH /api/fg-material-defects/:id/acknowledge ───────────────────────────
router.patch('/:id/acknowledge', auth, (req, res) => {
  const row = db.prepare('SELECT * FROM fg_material_defects WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
  if (row.status === 'acknowledged') return res.status(409).json({ error: 'รับทราบแล้ว' });

  const { remarks } = req.body;
  db.prepare(`UPDATE fg_material_defects SET status='acknowledged', acknowledge_by=?, acknowledge_at=datetime('now'), remarks=COALESCE(?,remarks) WHERE id=?`)
    .run(req.user.id, remarks || null, req.params.id);
  db.auditLog('fg_material_defects', req.params.id, 'ACKNOWLEDGE', { status: row.status }, { status: 'acknowledged' }, req.user.id, req.ip);

  res.json({ ok: true });
});

module.exports = router;
