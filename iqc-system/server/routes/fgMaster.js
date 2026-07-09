const express = require('express');
const router = express.Router();
const db = require('../db/database');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');

const adminOnly = [auth, requireRole(['admin'])];
const QC_WRITE = ['admin', 'qc_manager', 'qc_supervisor'];

// ── Helper: simple CRUD factory ─────────────────────────────────────────────
function makeMasterRoutes(table, writeRoles = ['admin']) {
  const write = [auth, requireRole(writeRoles)];

  // GET list
  router.get(`/${table}`, auth, (req, res) => {
    const { active_only } = req.query;
    const where = active_only === '1' ? 'WHERE is_active=1' : '';
    const rows = db.prepare(`SELECT * FROM ${table} ${where} ORDER BY sort_order, id`).all();
    res.json({ data: rows });
  });

  // POST create
  router.post(`/${table}`, ...write, (req, res) => {
    const { code, name, sort_order = 0, defect_group_id, severity_default } = req.body;
    if (!name) return res.status(400).json({ error: 'กรุณากรอกชื่อ' });
    try {
      let result;
      if (table === 'fg_defect_types') {
        if (!defect_group_id) return res.status(400).json({ error: 'กรุณาเลือกกลุ่มอาการเสีย' });
        result = db.prepare(
          `INSERT INTO fg_defect_types (defect_group_id, code, name, severity_default, sort_order) VALUES (?, ?, ?, ?, ?)`
        ).run(defect_group_id, code || null, name, severity_default || 'minor', +sort_order);
      } else {
        result = db.prepare(
          `INSERT INTO ${table} (code, name, sort_order) VALUES (?, ?, ?)`
        ).run(code || null, name, +sort_order);
      }
      db.auditLog(table, result.lastInsertRowid, 'CREATE', null, req.body, req.user.id, req.ip);
      res.json({ id: result.lastInsertRowid, ok: true });
    } catch (e) {
      if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'รหัสซ้ำ' });
      throw e;
    }
  });

  // PUT update
  router.put(`/${table}/:id`, ...write, (req, res) => {
    const old = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(req.params.id);
    if (!old) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
    const { code, name, sort_order, is_active, defect_group_id, severity_default } = req.body;
    try {
      if (table === 'fg_defect_types') {
        db.prepare(`UPDATE fg_defect_types SET defect_group_id=?, code=?, name=?, severity_default=?, sort_order=?, is_active=? WHERE id=?`)
          .run(defect_group_id ?? old.defect_group_id, code ?? old.code, name ?? old.name,
               severity_default ?? old.severity_default, sort_order ?? old.sort_order,
               is_active ?? old.is_active, req.params.id);
      } else {
        db.prepare(`UPDATE ${table} SET code=?, name=?, sort_order=?, is_active=? WHERE id=?`)
          .run(code ?? old.code, name ?? old.name, sort_order ?? old.sort_order,
               is_active ?? old.is_active, req.params.id);
      }
      db.auditLog(table, req.params.id, 'UPDATE', old, req.body, req.user.id, req.ip);
      res.json({ ok: true });
    } catch (e) {
      if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'รหัสซ้ำ' });
      throw e;
    }
  });

  // PATCH toggle active
  router.patch(`/${table}/:id/toggle`, ...write, (req, res) => {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
    db.prepare(`UPDATE ${table} SET is_active=? WHERE id=?`).run(row.is_active ? 0 : 1, req.params.id);
    res.json({ ok: true });
  });

  // DELETE
  router.delete(`/${table}/:id`, ...adminOnly, (req, res) => {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
    try {
      db.prepare(`DELETE FROM ${table} WHERE id=?`).run(req.params.id);
      db.auditLog(table, req.params.id, 'DELETE', row, null, req.user.id, req.ip);
      res.json({ ok: true });
    } catch (e) {
      if (e.message.includes('FOREIGN KEY')) return res.status(409).json({ error: 'ข้อมูลนี้ถูกอ้างอิงอยู่' });
      throw e;
    }
  });
}

makeMasterRoutes('fg_defect_groups',  QC_WRITE);
makeMasterRoutes('fg_defect_types',   QC_WRITE);
makeMasterRoutes('fg_process_areas',  QC_WRITE);
makeMasterRoutes('fg_fm_categories',  QC_WRITE);

// ── GET /fg-master/options — all dropdowns in one call ──────────────────────
router.get('/options', auth, (req, res) => {
  const groups       = db.prepare('SELECT * FROM fg_defect_groups WHERE is_active=1 ORDER BY sort_order').all();
  const types        = db.prepare('SELECT * FROM fg_defect_types WHERE is_active=1 ORDER BY defect_group_id, sort_order').all();
  const areas        = db.prepare('SELECT * FROM fg_process_areas WHERE is_active=1 ORDER BY sort_order').all();
  const fm_categories = db.prepare('SELECT * FROM fg_fm_categories WHERE is_active=1 ORDER BY sort_order').all();
  const shifts       = db.prepare('SELECT * FROM shifts WHERE is_active=1 ORDER BY id').all();
  const lines        = db.prepare('SELECT * FROM production_lines WHERE is_active=1 ORDER BY code').all();
  const users        = db.prepare("SELECT id, full_name, role, qc_station FROM users WHERE is_active=1 ORDER BY full_name").all();
  res.json({ groups, types, areas, fm_categories, shifts, lines, users });
});

module.exports = router;
