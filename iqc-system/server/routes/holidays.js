const express = require('express');
const router = express.Router();
const db = require('../db/database');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');

const adminOnly = [auth, requireRole(['admin'])];

// GET /api/holidays?year=2026
router.get('/', auth, (req, res) => {
  const { year } = req.query;
  const rows = year
    ? db.prepare("SELECT * FROM company_holidays WHERE strftime('%Y', holiday_date) = ? ORDER BY holiday_date").all(String(year))
    : db.prepare('SELECT * FROM company_holidays ORDER BY holiday_date').all();
  res.json(rows);
});

// POST /api/holidays
router.post('/', ...adminOnly, (req, res) => {
  const { holiday_date, name } = req.body;
  if (!holiday_date || !name) return res.status(400).json({ error: 'กรุณากรอกวันที่และชื่อวันหยุด' });
  try {
    const result = db.prepare('INSERT INTO company_holidays (holiday_date, name, created_by) VALUES (?, ?, ?)')
      .run(holiday_date, name.trim(), req.user.id);
    db.auditLog('company_holidays', result.lastInsertRowid, 'CREATE', null, { holiday_date, name }, req.user.id, req.ip);
    res.json(db.prepare('SELECT * FROM company_holidays WHERE id = ?').get(result.lastInsertRowid));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'วันที่นี้มีในรายการวันหยุดแล้ว' });
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/holidays/:id
router.delete('/:id', ...adminOnly, (req, res) => {
  const row = db.prepare('SELECT * FROM company_holidays WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'ไม่พบรายการ' });
  db.prepare('DELETE FROM company_holidays WHERE id = ?').run(req.params.id);
  db.auditLog('company_holidays', req.params.id, 'DELETE', row, null, req.user.id, req.ip);
  res.json({ ok: true });
});

module.exports = router;
