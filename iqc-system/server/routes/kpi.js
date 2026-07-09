const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const db = require('../db/database');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { getUsersByRole, createNotification, sendTelegram } = require('../lib/notify');
const kpiService = require('../services/kpiService');
const { fixOriginalName } = require('../middleware/upload');

// ===== KPI file upload (separate multer instance) =====
const kpiStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../uploads/kpi');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    file.originalname = fixOriginalName(file.originalname); // แก้ mojibake ชื่อไฟล์ภาษาไทย (multer/busboy decode เป็น latin1)
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});
const kpiUpload = multer({ storage: kpiStorage, limits: { fileSize: 20 * 1024 * 1024 } });

// ===== Predefined database sources =====
const DB_SOURCES = {
  ncr_count:       { label: 'จำนวน NCR ที่เปิดในเดือน', unit: 'ครั้ง' },
  ncr_closed_rate: { label: 'อัตราปิด NCR (%)', unit: '%' },
  bills_count:     { label: 'จำนวนบิลรับเข้าในเดือน', unit: 'บิล' },
  pass_rate:       { label: 'อัตราผ่านตรวจ (%)', unit: '%' },
};

// fetchDbSourceValue ย้ายไป services/kpiService.js (Session 101) — ใช้ภายใน createReport

// ========================================================================
// KPI GROUPS
// ========================================================================

// GET /api/kpi/groups
router.get('/groups', auth, (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const rows = isAdmin
    ? db.prepare('SELECT * FROM kpi_groups ORDER BY display_order, id').all()
    : db.prepare('SELECT * FROM kpi_groups WHERE is_active=1 ORDER BY display_order, id').all();
  res.json(rows);
});

// POST /api/kpi/groups
router.post('/groups', auth, requireRole(['admin']), (req, res) => {
  const { name, display_order = 0 } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'กรุณาระบุชื่อกลุ่ม KPI' });

  try {
    const result = kpiService.createGroup({ name, display_order, actorId: req.user.id, actorIp: req.ip });
    res.json(db.prepare('SELECT * FROM kpi_groups WHERE id=?').get(result));
  } catch (e) {
    console.error('[KPI GROUPS CREATE]', e);
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/kpi/groups/:id
router.patch('/groups/:id', auth, requireRole(['admin']), (req, res) => {
  const group = db.prepare('SELECT * FROM kpi_groups WHERE id=?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'ไม่พบกลุ่ม KPI' });

  const { name, display_order, is_active } = req.body;
  try {
    kpiService.updateGroup({ id: req.params.id, before: group, name, display_order, is_active, actorId: req.user.id, actorIp: req.ip });
    res.json(db.prepare('SELECT * FROM kpi_groups WHERE id=?').get(req.params.id));
  } catch (e) {
    console.error('[KPI GROUPS UPDATE]', e);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/kpi/groups/:id  (soft delete — block if has items)
router.delete('/groups/:id', auth, requireRole(['admin']), (req, res) => {
  const group = db.prepare('SELECT * FROM kpi_groups WHERE id=?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'ไม่พบกลุ่ม KPI' });

  const itemCount = db.prepare('SELECT COUNT(*) as c FROM kpi_items WHERE group_id=?').get(req.params.id).c;
  if (itemCount > 0) {
    return res.status(400).json({ error: `ไม่สามารถลบได้ เนื่องจากมี KPI ${itemCount} รายการอยู่ในกลุ่มนี้` });
  }

  try {
    kpiService.deactivateGroup({ id: req.params.id, before: group, actorId: req.user.id, actorIp: req.ip });
    res.json({ ok: true });
  } catch (e) {
    console.error('[KPI GROUPS DELETE]', e);
    res.status(500).json({ error: e.message });
  }
});

// ========================================================================
// KPI TITLE TEMPLATES
// ========================================================================

const TMPL_SELECT = `
  SELECT t.*, g.name as group_name, u.name as unit_name
  FROM kpi_title_templates t
  LEFT JOIN kpi_groups g ON g.id = t.group_id
  LEFT JOIN kpi_units  u ON u.id = t.unit_id
`;

// GET /api/kpi/title-templates
router.get('/title-templates', auth, (req, res) => {
  const rows = db.prepare(`${TMPL_SELECT} ORDER BY t.display_order, t.name`).all();
  res.json({ data: rows });
});

// POST /api/kpi/title-templates
router.post('/title-templates', auth, requireRole(['admin']), (req, res) => {
  const { name, group_id, unit_id } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'กรุณาระบุชื่อหัวข้อ' });
  try {
    const id = kpiService.createTitleTemplate({ name, group_id, unit_id });
    res.json(db.prepare(`${TMPL_SELECT} WHERE t.id=?`).get(id));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'ชื่อหัวข้อนี้มีอยู่แล้ว' });
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/kpi/title-templates/:id
router.patch('/title-templates/:id', auth, requireRole(['admin']), (req, res) => {
  const { name, is_active, group_id, unit_id } = req.body;
  const tmpl = db.prepare('SELECT * FROM kpi_title_templates WHERE id=?').get(req.params.id);
  if (!tmpl) return res.status(404).json({ error: 'ไม่พบรายการ' });
  try {
    kpiService.updateTitleTemplate({ id: tmpl.id, name, is_active, group_id, unit_id });
    res.json(db.prepare(`${TMPL_SELECT} WHERE t.id=?`).get(tmpl.id));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'ชื่อหัวข้อนี้มีอยู่แล้ว' });
    res.status(500).json({ error: e.message });
  }
});

// ========================================================================
// KPI UNITS
// ========================================================================

router.get('/units', auth, (req, res) => {
  const all = req.query.all === '1';
  const rows = all
    ? db.prepare('SELECT * FROM kpi_units ORDER BY name').all()
    : db.prepare('SELECT * FROM kpi_units WHERE is_active=1 ORDER BY name').all();
  res.json(rows);
});

router.post('/units', auth, requireRole(['admin']), (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'กรุณาระบุชื่อหน่วย' });
  try {
    const id = kpiService.createUnit({ name });
    res.json(db.prepare('SELECT * FROM kpi_units WHERE id=?').get(id));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'ชื่อหน่วยนี้มีอยู่แล้ว' });
    res.status(500).json({ error: e.message });
  }
});

router.patch('/units/:id', auth, requireRole(['admin']), (req, res) => {
  const { name, is_active } = req.body;
  const unit = db.prepare('SELECT * FROM kpi_units WHERE id=?').get(req.params.id);
  if (!unit) return res.status(404).json({ error: 'ไม่พบหน่วย' });
  try {
    kpiService.updateUnit({ id: unit.id, name, is_active });
    res.json(db.prepare('SELECT * FROM kpi_units WHERE id=?').get(unit.id));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'ชื่อหน่วยนี้มีอยู่แล้ว' });
    res.status(500).json({ error: e.message });
  }
});

// ========================================================================
// KPI NO. PATTERNS
// ========================================================================

router.get('/no-patterns', auth, (req, res) => {
  const all = req.query.all === '1';
  const rows = all
    ? db.prepare('SELECT * FROM kpi_no_patterns ORDER BY display_order, prefix').all()
    : db.prepare('SELECT * FROM kpi_no_patterns WHERE is_active=1 ORDER BY display_order, prefix').all();
  res.json(rows);
});

router.post('/no-patterns', auth, requireRole(['admin']), (req, res) => {
  const { prefix, description } = req.body;
  if (!prefix?.trim()) return res.status(400).json({ error: 'กรุณาระบุ prefix' });
  const clean = prefix.trim().replace(/[^A-Za-z0-9\-]/g, '').toUpperCase();
  if (!clean) return res.status(400).json({ error: 'prefix ต้องเป็นตัวอักษร A-Z, 0-9 หรือ -' });
  try {
    const id = kpiService.createNoPattern({ prefix: clean, description });
    res.json(db.prepare('SELECT * FROM kpi_no_patterns WHERE id=?').get(id));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Prefix นี้มีอยู่แล้ว' });
    res.status(500).json({ error: e.message });
  }
});

router.patch('/no-patterns/:id', auth, requireRole(['admin']), (req, res) => {
  const { prefix, description, is_active, display_order } = req.body;
  const pat = db.prepare('SELECT * FROM kpi_no_patterns WHERE id=?').get(req.params.id);
  if (!pat) return res.status(404).json({ error: 'ไม่พบรายการ' });
  const clean = prefix ? prefix.trim().replace(/[^A-Za-z0-9\-]/g, '').toUpperCase() : null;
  try {
    kpiService.updateNoPattern({ id: pat.id, prefix: clean, description, is_active, display_order });
    res.json(db.prepare('SELECT * FROM kpi_no_patterns WHERE id=?').get(pat.id));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Prefix นี้มีอยู่แล้ว' });
    res.status(500).json({ error: e.message });
  }
});

// ========================================================================
// KPI ITEMS
// ========================================================================

// PATCH /api/kpi/items/reorder — drag-and-drop ordering
router.patch('/items/reorder', auth, requireRole(['admin']), (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'กรุณาส่งรายการ items' });
  try {
    kpiService.reorderItems(items);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/kpi/items
router.get('/items', auth, (req, res) => {
  const { group_id, page = 1, limit = 50 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  let where = '1=1';
  const params = [];
  if (group_id) { where += ' AND ki.group_id=?'; params.push(group_id); }

  const rows = db.prepare(`
    SELECT ki.*, kg.name as group_name
    FROM kpi_items ki
    LEFT JOIN kpi_groups kg ON kg.id = ki.group_id
    WHERE ${where}
    ORDER BY kg.display_order, ki.display_order, ki.id
    LIMIT ? OFFSET ?
  `).all(...params, Number(limit), offset);

  const total = db.prepare(`
    SELECT COUNT(*) as c FROM kpi_items ki WHERE ${where}
  `).get(...params);

  // year_targets: { [year]: representative_target } per item (MIN per year as rep)
  const allYearTargets = db.prepare(
    `SELECT kpi_item_id, year, MIN(target_value) as rep_target
     FROM kpi_targets GROUP BY kpi_item_id, year ORDER BY year`
  ).all();
  const ytMap = {};
  for (const t of allYearTargets) {
    if (!ytMap[t.kpi_item_id]) ytMap[t.kpi_item_id] = {};
    ytMap[t.kpi_item_id][t.year] = t.rep_target;
  }
  const enriched = rows.map(r => ({ ...r, year_targets: ytMap[r.id] ?? null }));

  res.json({ data: enriched, total: total.c, page: Number(page), limit: Number(limit) });
});

// POST /api/kpi/items
router.post('/items', auth, requireRole(['admin']), (req, res) => {
  const { group_id, name, unit, description, data_source_type = 'manual', data_source_key, display_order = 0, target_direction = 'gte', summary_type = 'average', kpi_no_prefix } = req.body;
  if (!group_id || !name?.trim()) return res.status(400).json({ error: 'กรุณาระบุ group_id และชื่อ KPI' });
  if (!['manual', 'database'].includes(data_source_type)) {
    return res.status(400).json({ error: 'data_source_type ต้องเป็น manual หรือ database' });
  }
  if (!['gte', 'lte'].includes(target_direction)) {
    return res.status(400).json({ error: 'target_direction ต้องเป็น gte หรือ lte' });
  }
  if (!['average', 'sum'].includes(summary_type)) {
    return res.status(400).json({ error: 'summary_type ต้องเป็น average หรือ sum' });
  }
  if (data_source_type === 'database' && !data_source_key) {
    return res.status(400).json({ error: 'กรุณาระบุ data_source_key สำหรับ database source' });
  }
  if (data_source_type === 'database' && !DB_SOURCES[data_source_key]) {
    return res.status(400).json({ error: `data_source_key '${data_source_key}' ไม่รองรับ` });
  }

  const group = db.prepare('SELECT * FROM kpi_groups WHERE id=?').get(group_id);
  if (!group) return res.status(404).json({ error: 'ไม่พบกลุ่ม KPI' });

  try {
    const id = kpiService.createItem({
      group_id, name, unit, description, data_source_type, data_source_key,
      display_order, target_direction, summary_type, kpi_no_prefix,
      actorId: req.user.id, actorIp: req.ip,
    });
    const item = db.prepare('SELECT ki.*, kg.name as group_name FROM kpi_items ki LEFT JOIN kpi_groups kg ON kg.id=ki.group_id WHERE ki.id=?').get(id);
    res.json(item);
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'รหัส KPI ซ้ำ — ลองใหม่' });
    console.error('[KPI ITEMS CREATE]', e);
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/kpi/items/:id
router.patch('/items/:id', auth, requireRole(['admin']), (req, res) => {
  const item = db.prepare('SELECT * FROM kpi_items WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'ไม่พบ KPI' });

  const { name, unit, group_id, description, data_source_type, data_source_key, display_order, is_active, target_direction, summary_type } = req.body;

  if (data_source_type !== undefined && !['manual', 'database'].includes(data_source_type)) {
    return res.status(400).json({ error: 'data_source_type ต้องเป็น manual หรือ database' });
  }
  if (target_direction !== undefined && !['gte', 'lte'].includes(target_direction)) {
    return res.status(400).json({ error: 'target_direction ต้องเป็น gte หรือ lte' });
  }
  if (summary_type !== undefined && !['average', 'sum'].includes(summary_type)) {
    return res.status(400).json({ error: 'summary_type ต้องเป็น average หรือ sum' });
  }
  if (data_source_type === 'database' && data_source_key && !DB_SOURCES[data_source_key]) {
    return res.status(400).json({ error: `data_source_key '${data_source_key}' ไม่รองรับ` });
  }

  try {
    kpiService.updateItem({
      id: req.params.id, before: item, name, unit, group_id, description,
      data_source_type, data_source_key, display_order, is_active, target_direction, summary_type,
      actorId: req.user.id, actorIp: req.ip,
    });
    const updated = db.prepare('SELECT ki.*, kg.name as group_name FROM kpi_items ki LEFT JOIN kpi_groups kg ON kg.id=ki.group_id WHERE ki.id=?').get(req.params.id);
    res.json(updated);
  } catch (e) {
    console.error('[KPI ITEMS UPDATE]', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/kpi/db-sources  (admin only)
router.get('/db-sources', auth, requireRole(['admin']), (req, res) => {
  const list = Object.entries(DB_SOURCES).map(([key, val]) => ({ key, ...val }));
  res.json(list);
});

// ========================================================================
// KPI TARGETS
// ========================================================================

// GET /api/kpi/targets?year=YYYY
router.get('/targets', auth, (req, res) => {
  const { year = new Date().getFullYear() } = req.query;

  const targets = db.prepare(`
    SELECT kt.*, ki.name as kpi_name, ki.kpi_no, ki.group_id, kg.name as group_name
    FROM kpi_targets kt
    JOIN kpi_items ki ON ki.id = kt.kpi_item_id
    JOIN kpi_groups kg ON kg.id = ki.group_id
    WHERE kt.year = ?
    ORDER BY kg.display_order, ki.display_order, ki.id, kt.month
  `).all(Number(year));

  // Group by item
  const byItem = {};
  for (const t of targets) {
    if (!byItem[t.kpi_item_id]) {
      byItem[t.kpi_item_id] = {
        kpi_item_id: t.kpi_item_id,
        kpi_no: t.kpi_no,
        kpi_name: t.kpi_name,
        group_id: t.group_id,
        group_name: t.group_name,
        months: {},
      };
    }
    byItem[t.kpi_item_id].months[t.month] = t.target_value;
  }

  res.json({ year: Number(year), items: Object.values(byItem) });
});

// POST /api/kpi/targets  (upsert — รับ bulk หรือ single)
// bulk: { year, entries: [{ kpi_item_id, month, target_value }] }
// single: { kpi_item_id, year, month, target_value }
router.post('/targets', auth, requireRole(['admin']), (req, res) => {
  const { year } = req.body;
  if (!year) return res.status(400).json({ error: 'กรุณาระบุ year' });

  // normalize to array
  const entries = req.body.entries
    ? req.body.entries
    : [{ kpi_item_id: req.body.kpi_item_id, month: req.body.month, target_value: req.body.target_value }];

  if (!entries.length) return res.json({ saved: 0 });

  try {
    kpiService.upsertTargets({ year, entries, actorId: req.user.id, actorIp: req.ip });
    res.json({ saved: entries.length });
  } catch (e) {
    console.error('[KPI TARGETS UPSERT]', e);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/kpi/targets/:itemId/year/:year — ลบ targets ทั้งปีของ item
router.delete('/targets/:itemId/year/:year', auth, requireRole(['admin']), (req, res) => {
  const { itemId, year } = req.params;
  const item = db.prepare('SELECT id FROM kpi_items WHERE id=?').get(itemId);
  if (!item) return res.status(404).json({ error: 'ไม่พบ KPI item' });
  try {
    const deleted = kpiService.deleteTargetsYear({ itemId, year, actorId: req.user.id, actorIp: req.ip });
    res.json({ deleted });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========================================================================
// ⚠️ KPI REPORTS — DEPRECATED (Session 104)
// ไม่มี UI entry point ใน client/src (ไม่มีปุ่มสร้าง/หน้า list/ลิงก์ไป /kpi/reports/:id ที่ไหนเลย)
// ถูกแทนที่ด้วย kpi_actuals + kpi_action_plans (ดู endpoint ด้านล่างของไฟล์นี้) — ดู AUDIT.md §3.7/D3, CLAUDE.md §22.3
// คง endpoint ไว้ (ไม่ลบ) เพราะยังไม่มีมติจาก product owner — ห้ามขยาย/ใช้เป็น pattern สำหรับโค้ดใหม่
// ========================================================================

const KPI_REPORT_ROLES = ['admin', 'qc_manager', 'cpo', 'qmr'];

// GET /api/kpi/reports
router.get('/reports', auth, requireRole(KPI_REPORT_ROLES), (req, res) => {
  const { year, status, page = 1, limit = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  let where = '1=1';
  const params = [];
  if (year)   { where += ' AND r.year=?';   params.push(Number(year)); }
  if (status) { where += ' AND r.status=?'; params.push(status); }

  const rows = db.prepare(`
    SELECT r.*, u.full_name as created_by_name
    FROM kpi_reports r
    LEFT JOIN users u ON u.id = r.created_by
    WHERE ${where}
    ORDER BY r.year DESC, r.month DESC, r.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, Number(limit), offset);

  const total = db.prepare(`SELECT COUNT(*) as c FROM kpi_reports r WHERE ${where}`).get(...params).c;

  res.json({ data: rows, total, page: Number(page), limit: Number(limit) });
});

// POST /api/kpi/reports  (admin creates new report for year/month)
router.post('/reports', auth, requireRole(['admin']), (req, res) => {
  const { year, month } = req.body;
  if (!year || !month) return res.status(400).json({ error: 'กรุณาระบุ year และ month' });
  if (month < 1 || month > 12) return res.status(400).json({ error: 'month ต้องอยู่ระหว่าง 1-12' });

  // Check duplicate
  const existing = db.prepare('SELECT id FROM kpi_reports WHERE year=? AND month=? AND status NOT IN (?,?)').get(Number(year), Number(month), 'cancelled', 'rejected');
  if (existing) return res.status(400).json({ error: `มีรายงาน KPI เดือน ${month}/${year} อยู่แล้ว` });

  try {
    const reportId = kpiService.createReport({ year, month, actorId: req.user.id, actorIp: req.ip });
    const report = db.prepare('SELECT * FROM kpi_reports WHERE id=?').get(reportId);
    res.json(report);
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'รหัสรายงานซ้ำ — ลองใหม่' });
    console.error('[KPI REPORTS CREATE]', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/kpi/reports/:id
router.get('/reports/:id', auth, requireRole(KPI_REPORT_ROLES), (req, res) => {
  const report = db.prepare(`
    SELECT r.*,
           u.full_name as created_by_name,
           qm.full_name as qc_manager_by_name,
           cp.full_name as cpo_by_name,
           qr.full_name as qmr_by_name
    FROM kpi_reports r
    LEFT JOIN users u  ON u.id  = r.created_by
    LEFT JOIN users qm ON qm.id = r.qc_manager_by
    LEFT JOIN users cp ON cp.id = r.cpo_by
    LEFT JOIN users qr ON qr.id = r.qmr_by
    WHERE r.id = ?
  `).get(req.params.id);
  if (!report) return res.status(404).json({ error: 'ไม่พบรายงาน KPI' });

  // Entries with item + group info
  const entries = db.prepare(`
    SELECT e.*,
           ki.kpi_no, ki.name as kpi_name, ki.unit, ki.description,
           ki.data_source_type, ki.data_source_key, ki.group_id,
           kg.name as group_name, kg.display_order as group_order,
           ub.full_name as updated_by_name
    FROM kpi_report_entries e
    JOIN kpi_items ki ON ki.id = e.kpi_item_id
    JOIN kpi_groups kg ON kg.id = ki.group_id
    LEFT JOIN users ub ON ub.id = e.updated_by
    WHERE e.report_id = ?
    ORDER BY kg.display_order, ki.display_order, ki.id
  `).all(req.params.id);

  // Attach files per entry
  for (const entry of entries) {
    entry.files = db.prepare('SELECT * FROM kpi_report_files WHERE entry_id=? ORDER BY id').all(entry.id);
  }

  // Approvals
  const approvals = db.prepare(`
    SELECT a.*, u.full_name as created_by_name
    FROM kpi_approvals a
    LEFT JOIN users u ON u.id = a.created_by
    WHERE a.report_id = ?
    ORDER BY a.id
  `).all(req.params.id);

  res.json({ ...report, entries, approvals });
});

// PATCH /api/kpi/reports/:id/entries  (admin only, draft or rejected)
router.patch('/reports/:id/entries', auth, requireRole(['admin']), (req, res) => {
  const report = db.prepare('SELECT * FROM kpi_reports WHERE id=?').get(req.params.id);
  if (!report) return res.status(404).json({ error: 'ไม่พบรายงาน KPI' });
  if (!['draft', 'rejected'].includes(report.status)) {
    return res.status(400).json({ error: 'สามารถแก้ไขได้เฉพาะรายงานที่อยู่ในสถานะ draft หรือ rejected' });
  }

  const updates = req.body;
  if (!Array.isArray(updates)) return res.status(400).json({ error: 'body ต้องเป็น array' });

  try {
    kpiService.updateReportEntries({ reportId: req.params.id, updates, actorId: req.user.id, actorIp: req.ip });
    res.json({ ok: true });
  } catch (e) {
    console.error('[KPI ENTRIES UPDATE]', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/kpi/reports/:id/submit  (admin → pending_qc_manager)
router.post('/reports/:id/submit', auth, requireRole(['admin']), (req, res) => {
  const report = db.prepare('SELECT * FROM kpi_reports WHERE id=?').get(req.params.id);
  if (!report) return res.status(404).json({ error: 'ไม่พบรายงาน KPI' });
  if (!['draft', 'rejected'].includes(report.status)) {
    return res.status(400).json({ error: 'สามารถส่งได้เฉพาะรายงานที่อยู่ในสถานะ draft หรือ rejected' });
  }

  try {
    kpiService.submitReport({ report, actorId: req.user.id, actorIp: req.ip });
    res.json({ ok: true, status: 'pending_qc_manager' });
  } catch (e) {
    console.error('[KPI SUBMIT]', e);
    res.status(e.message.includes('รีเฟรช') ? 409 : 500).json({ error: e.message });
  }
});

// POST /api/kpi/reports/:id/approve
router.post('/reports/:id/approve', auth, (req, res) => {
  const report = db.prepare('SELECT * FROM kpi_reports WHERE id=?').get(req.params.id);
  if (!report) return res.status(404).json({ error: 'ไม่พบรายงาน KPI' });

  const { comment } = req.body;
  const role = req.user.role;

  // Validate role & status transition
  const transitions = {
    qc_manager: { from: 'pending_qc_manager', to: 'pending_cpo' },
    cpo:        { from: 'pending_cpo',         to: 'pending_qmr' },
    qmr:        { from: 'pending_qmr',         to: 'approved'    },
  };

  const t = transitions[role];
  if (!t) return res.status(403).json({ error: 'ไม่มีสิทธิ์อนุมัติรายงาน KPI' });
  if (report.status !== t.from) {
    return res.status(400).json({ error: `รายงานต้องอยู่ในสถานะ ${t.from} จึงจะอนุมัติได้ (ปัจจุบัน: ${report.status})` });
  }

  try {
    kpiService.approveReport({ report, role, t, comment, actorId: req.user.id, actorIp: req.ip });
    res.json({ ok: true, status: t.to });
  } catch (e) {
    console.error('[KPI APPROVE]', e);
    res.status(e.message.includes('รีเฟรช') ? 409 : 500).json({ error: e.message });
  }
});

// POST /api/kpi/reports/:id/reject
router.post('/reports/:id/reject', auth, (req, res) => {
  const report = db.prepare('SELECT * FROM kpi_reports WHERE id=?').get(req.params.id);
  if (!report) return res.status(404).json({ error: 'ไม่พบรายงาน KPI' });

  const { reason } = req.body;
  if (!reason?.trim()) return res.status(400).json({ error: 'กรุณาระบุเหตุผลการปฏิเสธ' });

  const role = req.user.role;
  const allowedFromStatus = {
    qc_manager: 'pending_qc_manager',
    cpo:        'pending_cpo',
    qmr:        'pending_qmr',
  };

  const fromStatus = allowedFromStatus[role];
  if (!fromStatus) return res.status(403).json({ error: 'ไม่มีสิทธิ์ปฏิเสธรายงาน KPI' });
  if (report.status !== fromStatus) {
    return res.status(400).json({ error: `รายงานต้องอยู่ในสถานะ ${fromStatus} จึงจะปฏิเสธได้ (ปัจจุบัน: ${report.status})` });
  }

  try {
    kpiService.rejectReport({ report, role, fromStatus, reason, actorId: req.user.id, actorIp: req.ip });
    res.json({ ok: true, status: 'rejected' });
  } catch (e) {
    console.error('[KPI REJECT]', e);
    res.status(e.message.includes('รีเฟรช') ? 409 : 500).json({ error: e.message });
  }
});

// POST /api/kpi/reports/:id/revise  (admin resets rejected → draft)
router.post('/reports/:id/revise', auth, requireRole(['admin']), (req, res) => {
  const report = db.prepare('SELECT * FROM kpi_reports WHERE id=?').get(req.params.id);
  if (!report) return res.status(404).json({ error: 'ไม่พบรายงาน KPI' });
  if (report.status !== 'rejected') {
    return res.status(400).json({ error: 'สามารถแก้ไขได้เฉพาะรายงานที่ถูกปฏิเสธ (status=rejected)' });
  }

  try {
    kpiService.reviseReport({ report, actorId: req.user.id, actorIp: req.ip });
    res.json({ ok: true, status: 'draft' });
  } catch (e) {
    console.error('[KPI REVISE]', e);
    res.status(e.message.includes('รีเฟรช') ? 409 : 500).json({ error: e.message });
  }
});

// POST /api/kpi/reports/:id/entries/:entryId/files  (file upload, admin only)
router.post('/reports/:id/entries/:entryId/files',
  auth,
  requireRole(['admin']),
  kpiUpload.single('file'),
  (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'ไม่พบไฟล์' });

    const report = db.prepare('SELECT * FROM kpi_reports WHERE id=?').get(req.params.id);
    if (!report) return res.status(404).json({ error: 'ไม่พบรายงาน KPI' });
    if (!['draft', 'rejected'].includes(report.status)) {
      // Clean up uploaded file
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(400).json({ error: 'สามารถอัปโหลดไฟล์ได้เฉพาะรายงาน draft หรือ rejected' });
    }

    const entry = db.prepare('SELECT * FROM kpi_report_entries WHERE id=? AND report_id=?').get(req.params.entryId, req.params.id);
    if (!entry) {
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(404).json({ error: 'ไม่พบ entry ในรายงานนี้' });
    }

    try {
      const fileId = db.transaction(() => {
        const r = db.prepare(`
          INSERT INTO kpi_report_files (entry_id, filename, original_name, created_by)
          VALUES (?, ?, ?, ?)
        `).run(entry.id, req.file.filename, req.file.originalname, req.user.id);
        db.auditLog('kpi_report_files', r.lastInsertRowid, 'UPLOAD',
          null, { entry_id: entry.id, filename: req.file.filename, original_name: req.file.originalname },
          req.user.id, req.ip);
        return r.lastInsertRowid;
      })();

      const file = db.prepare('SELECT * FROM kpi_report_files WHERE id=?').get(fileId);
      res.json(file);
    } catch (e) {
      try { fs.unlinkSync(req.file.path); } catch {}
      console.error('[KPI FILE UPLOAD]', e);
      res.status(500).json({ error: e.message });
    }
  }
);

// DELETE /api/kpi/reports/:id/entries/:entryId/files/:fileId
router.delete('/reports/:id/entries/:entryId/files/:fileId',
  auth,
  requireRole(['admin']),
  (req, res) => {
    const report = db.prepare('SELECT * FROM kpi_reports WHERE id=?').get(req.params.id);
    if (!report) return res.status(404).json({ error: 'ไม่พบรายงาน KPI' });
    if (!['draft', 'rejected'].includes(report.status)) {
      return res.status(400).json({ error: 'สามารถลบไฟล์ได้เฉพาะรายงาน draft หรือ rejected' });
    }

    const file = db.prepare(`
      SELECT f.* FROM kpi_report_files f
      JOIN kpi_report_entries e ON e.id = f.entry_id
      WHERE f.id=? AND e.id=? AND e.report_id=?
    `).get(req.params.fileId, req.params.entryId, req.params.id);
    if (!file) return res.status(404).json({ error: 'ไม่พบไฟล์' });

    try {
      db.transaction(() => {
        db.prepare('DELETE FROM kpi_report_files WHERE id=?').run(req.params.fileId);
        db.auditLog('kpi_report_files', req.params.fileId, 'DELETE',
          { filename: file.filename }, null, req.user.id, req.ip);
      })();

      // Delete physical file
      const filePath = path.join(__dirname, '../../uploads/kpi', file.filename);
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}

      res.json({ ok: true });
    } catch (e) {
      console.error('[KPI FILE DELETE]', e);
      res.status(500).json({ error: e.message });
    }
  }
);

// ========================================================================
// KPI DASHBOARD
// ========================================================================

// GET /api/kpi/dashboard?year=YYYY
router.get('/dashboard', auth, (req, res) => {
  const year = Number(req.query.year || new Date().getFullYear());
  const prevYear = year - 1;

  // Get all active groups + items
  const groups = db.prepare('SELECT * FROM kpi_groups WHERE is_active=1 ORDER BY display_order, id').all();
  const items = db.prepare('SELECT * FROM kpi_items WHERE is_active=1 ORDER BY group_id, display_order, id').all();

  // Get actuals from kpi_actuals table
  const getActuals = (y) => {
    const rows = db.prepare(`SELECT kpi_item_id, month, actual_value FROM kpi_actuals WHERE year=?`).all(y);
    const map = {};
    for (const row of rows) {
      if (!map[row.kpi_item_id]) map[row.kpi_item_id] = {};
      map[row.kpi_item_id][row.month] = row.actual_value;
    }
    return map;
  };

  const getTargets = (y) => {
    const rows = db.prepare('SELECT kpi_item_id, month, target_value FROM kpi_targets WHERE year=?').all(y);
    const map = {};
    for (const row of rows) {
      if (!map[row.kpi_item_id]) map[row.kpi_item_id] = {};
      map[row.kpi_item_id][row.month] = row.target_value;
    }
    return map;
  };

  const currentActuals = getActuals(year);
  const prevActuals    = getActuals(prevYear);
  const currentTargets = getTargets(year);
  const prevTargets    = getTargets(prevYear);

  const buildMonths = (itemId, targetsMap, actualsMap) => {
    const result = [];
    for (let m = 1; m <= 12; m++) {
      result.push({
        month: m,
        target: targetsMap[itemId]?.[m] ?? null,
        actual: actualsMap[itemId]?.[m] ?? null,
      });
    }
    return result;
  };

  // Build grouped structure
  const result = groups.map((group) => {
    const groupItems = items.filter((i) => i.group_id === group.id);
    return {
      group,
      items: groupItems.map((item) => ({
        item: {
          id: item.id,
          kpi_no: item.kpi_no,
          name: item.name,
          unit: item.unit,
          description: item.description,
          data_source_type: item.data_source_type,
          data_source_key: item.data_source_key,
          target_direction: item.target_direction ?? 'gte',
          summary_type: item.summary_type ?? 'average',
          group_name: item.group_name ?? group.name,
        },
        currentYear: buildMonths(item.id, currentTargets, currentActuals),
        prevYear:    buildMonths(item.id, prevTargets,    prevActuals),
      })),
    };
  });

  res.json({ year, prevYear, groups: result });
});

// ========================================================================
// KPI ACTUALS — บันทึกค่าจริงรายเดือน (ไม่ใช้ approval flow)
// ========================================================================

// GET /api/kpi/actuals?year=YYYY&month=MM
router.get('/actuals', auth, (req, res) => {
  const { year = new Date().getFullYear(), month } = req.query;
  const conds = ['a.year = ?'];
  const params = [Number(year)];
  if (month) { conds.push('a.month = ?'); params.push(Number(month)); }

  const rows = db.prepare(`
    SELECT a.*, ki.kpi_no, ki.name as kpi_name, ki.unit, ki.data_source_type, ki.data_source_key,
           kg.name as group_name, kg.id as group_id,
           u.full_name as updated_by_name
    FROM kpi_actuals a
    JOIN kpi_items ki ON ki.id = a.kpi_item_id
    JOIN kpi_groups kg ON kg.id = ki.group_id
    LEFT JOIN users u ON u.id = a.updated_by
    WHERE ${conds.join(' AND ')}
    ORDER BY kg.display_order, ki.display_order, ki.id, a.month
  `).all(...params);

  res.json({ data: rows });
});

// POST /api/kpi/actuals  (upsert per kpi_item + year + month)
router.post('/actuals', auth, (req, res) => {
  const { kpi_item_id, year, month, actual_value, fail_cause, corrective_action, preventive_action, remark } = req.body;
  if (!kpi_item_id || !year || !month) return res.status(400).json({ error: 'กรุณาระบุ kpi_item_id, year, month' });

  const item = db.prepare('SELECT * FROM kpi_items WHERE id=?').get(kpi_item_id);
  if (!item) return res.status(404).json({ error: 'ไม่พบ KPI item' });

  try {
    const row = kpiService.upsertActual({
      kpi_item_id, year, month, actual_value, fail_cause, corrective_action, preventive_action, remark,
      actorId: req.user.id, actorIp: req.ip,
    });
    res.json(row);
  } catch (e) {
    console.error('[KPI ACTUALS UPSERT]', e);
    res.status(500).json({ error: e.message });
  }
});

// ========================================================================
// KPI ACTION PLANS (Online approval: Admin → QC Manager → CPO)
// ========================================================================

const AP_MONTH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];

function apPlanWithJoins(id) {
  return db.prepare(`
    SELECT ap.*,
      ki.kpi_no, ki.name as kpi_name, ki.unit,
      kg.name as group_name,
      u1.full_name as created_by_name,
      u2.full_name as qcm_signed_by_name,
      u3.full_name as cpo_signed_by_name,
      u4.full_name as qmr_signed_by_name,
      u5.full_name as rejected_by_name
    FROM kpi_action_plans ap
    JOIN kpi_items ki ON ki.id = ap.kpi_item_id
    JOIN kpi_groups kg ON kg.id = ki.group_id
    LEFT JOIN users u1 ON u1.id = ap.created_by
    LEFT JOIN users u2 ON u2.id = ap.qcm_signed_by
    LEFT JOIN users u3 ON u3.id = ap.cpo_signed_by
    LEFT JOIN users u4 ON u4.id = ap.qmr_signed_by
    LEFT JOIN users u5 ON u5.id = ap.rejected_by
    WHERE ap.id = ?
  `).get(id);
}

// GET /api/kpi/action-plans?year=Y[&month=M]
router.get('/action-plans', auth, (req, res) => {
  const { year = new Date().getFullYear(), month } = req.query;
  const conds = ['ap.year = ?'];
  const params = [Number(year)];
  if (month) { conds.push('ap.month = ?'); params.push(Number(month)); }

  const rows = db.prepare(`
    SELECT ap.*,
      ki.kpi_no, ki.name as kpi_name, ki.unit,
      kg.name as group_name,
      u1.full_name as created_by_name,
      u2.full_name as qcm_signed_by_name,
      u3.full_name as cpo_signed_by_name,
      u4.full_name as qmr_signed_by_name,
      u5.full_name as rejected_by_name
    FROM kpi_action_plans ap
    JOIN kpi_items ki ON ki.id = ap.kpi_item_id
    JOIN kpi_groups kg ON kg.id = ki.group_id
    LEFT JOIN users u1 ON u1.id = ap.created_by
    LEFT JOIN users u2 ON u2.id = ap.qcm_signed_by
    LEFT JOIN users u3 ON u3.id = ap.cpo_signed_by
    LEFT JOIN users u4 ON u4.id = ap.qmr_signed_by
    LEFT JOIN users u5 ON u5.id = ap.rejected_by
    WHERE ${conds.join(' AND ')}
    ORDER BY kg.display_order, ki.display_order, ki.id
  `).all(...params);

  res.json({ data: rows });
});

// POST /api/kpi/action-plans  (create or update draft — admin only)
router.post('/action-plans', auth, requireRole(['admin']), (req, res) => {
  const { kpi_item_id, year, month, fail_cause, corrective_action, preventive_action, remark } = req.body;
  if (!kpi_item_id || !year || !month) return res.status(400).json({ error: 'กรุณาระบุ kpi_item_id, year, month' });

  const existing = db.prepare('SELECT * FROM kpi_action_plans WHERE kpi_item_id=? AND year=? AND month=?')
    .get(kpi_item_id, Number(year), Number(month));
  if (existing && existing.status !== 'draft') {
    return res.status(409).json({ error: `ไม่สามารถแก้ไขได้ สถานะปัจจุบัน: ${existing.status}` });
  }

  try {
    const row = db.transaction(() => {
      db.prepare(`
        INSERT INTO kpi_action_plans (kpi_item_id, year, month, fail_cause, corrective_action, preventive_action, remark, created_by, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(kpi_item_id, year, month) DO UPDATE SET
          fail_cause=excluded.fail_cause, corrective_action=excluded.corrective_action,
          preventive_action=excluded.preventive_action, remark=excluded.remark,
          updated_at=datetime('now')
      `).run(kpi_item_id, Number(year), Number(month),
        fail_cause ?? null, corrective_action ?? null, preventive_action ?? null, remark ?? null, req.user.id);
      const id = db.prepare('SELECT id FROM kpi_action_plans WHERE kpi_item_id=? AND year=? AND month=?')
        .get(kpi_item_id, Number(year), Number(month)).id;
      db.auditLog('kpi_action_plans', id, 'SAVE_DRAFT', null, { kpi_item_id, year, month }, req.user.id, req.ip);
      return apPlanWithJoins(id);
    })();
    res.json(row);
  } catch (e) {
    console.error('[KPI AP SAVE]', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/kpi/action-plans/:id/submit  (admin → pending_qcm)
router.post('/action-plans/:id/submit', auth, requireRole(['admin']), (req, res) => {
  const plan = db.prepare('SELECT * FROM kpi_action_plans WHERE id=?').get(req.params.id);
  if (!plan) return res.status(404).json({ error: 'ไม่พบเอกสาร' });
  if (plan.status !== 'draft') return res.status(409).json({ error: `สถานะปัจจุบัน: ${plan.status}` });

  try {
    kpiService.submitActionPlan({ plan, actorId: req.user.id, actorIp: req.ip });
    res.json(apPlanWithJoins(plan.id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/kpi/action-plans/:id/approve  (qcm→pending_cpo, cpo→pending_qmr, qmr→approved)
router.post('/action-plans/:id/approve', auth, (req, res) => {
  const plan = db.prepare('SELECT * FROM kpi_action_plans WHERE id=?').get(req.params.id);
  if (!plan) return res.status(404).json({ error: 'ไม่พบเอกสาร' });
  const role = req.user.role;

  let nextStatus, signField, signAtField;
  if (plan.status === 'pending_qcm' && role === 'qc_manager') {
    nextStatus = 'pending_cpo'; signField = 'qcm_signed_by'; signAtField = 'qcm_signed_at';
  } else if (plan.status === 'pending_cpo' && ['cpo','cmo'].includes(role)) {
    nextStatus = 'pending_qmr'; signField = 'cpo_signed_by'; signAtField = 'cpo_signed_at';
  } else if (plan.status === 'pending_qmr' && role === 'qmr') {
    nextStatus = 'approved'; signField = 'qmr_signed_by'; signAtField = 'qmr_signed_at';
  } else {
    return res.status(403).json({ error: 'ไม่มีสิทธิ์อนุมัติขั้นนี้' });
  }

  try {
    kpiService.approveActionPlan({ plan, nextStatus, signField, signAtField, actorId: req.user.id, actorIp: req.ip });
    res.json(apPlanWithJoins(plan.id));
  } catch (e) {
    res.status(e.message.includes('รีเฟรช') ? 409 : 500).json({ error: e.message });
  }
});

// POST /api/kpi/action-plans/:id/reject  (qcm or cpo → draft + notify admin)
router.post('/action-plans/:id/reject', auth, (req, res) => {
  const { reason } = req.body;
  if (!reason?.trim()) return res.status(400).json({ error: 'กรุณาระบุเหตุผล' });
  const plan = db.prepare('SELECT * FROM kpi_action_plans WHERE id=?').get(req.params.id);
  if (!plan) return res.status(404).json({ error: 'ไม่พบเอกสาร' });
  const role = req.user.role;
  const allowed = (plan.status === 'pending_qcm' && role === 'qc_manager') ||
                  (plan.status === 'pending_cpo' && ['cpo','cmo'].includes(role)) ||
                  (plan.status === 'pending_qmr' && role === 'qmr');
  if (!allowed) return res.status(403).json({ error: 'ไม่มีสิทธิ์' });

  try {
    kpiService.rejectActionPlan({ plan, role, reason, actorId: req.user.id, actorIp: req.ip });
    res.json(apPlanWithJoins(plan.id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/kpi/actuals/bulk  (บันทึกทุก KPI ของเดือนนั้นพร้อมกัน)
router.post('/actuals/bulk', auth, (req, res) => {
  const { year, month, entries } = req.body;
  if (!year || !month || !Array.isArray(entries)) return res.status(400).json({ error: 'กรุณาระบุ year, month, entries[]' });

  try {
    kpiService.bulkUpsertActuals({ year, month, entries, actorId: req.user.id, actorIp: req.ip });
    res.json({ saved: entries.length });
  } catch (e) {
    console.error('[KPI ACTUALS BULK]', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
