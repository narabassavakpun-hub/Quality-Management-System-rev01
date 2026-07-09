// ===== IPQC/FQC master data routes =====
// Mounted at /api/ipqc/master
const express = require('express');
const router = express.Router();
const db = require('../db/database');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { makeCrudRouter, handleDbError } = require('../lib/crud');
const { xlsxUpload } = require('../middleware/upload');

function httpError(message, status) { const e = new Error(message); e.status = status; return e; }

// atomic running number ต่อ (factory, line_type) — ห้าม SELECT MAX() ตอน generate (กฎ 2.3)
function genLineCode(factory, lineType) {
  return db.transaction(() => {
    db.prepare(`INSERT INTO production_line_seq (factory, line_type, last_seq) VALUES (?, ?, 0)
      ON CONFLICT(factory, line_type) DO NOTHING`).run(factory, lineType);
    const r = db.prepare(`UPDATE production_line_seq SET last_seq = last_seq + 1
      WHERE factory = ? AND line_type = ? RETURNING last_seq`).get(factory, lineType);
    return `${factory}-${lineType.toUpperCase()}-${r.last_seq}`;
  })();
}

// ---- Export/Import factory ----
// Adds GET /{path}/export  and  POST /{path}/import?dryRun=1 to the parent router.
// Must be called BEFORE router.use('/{path}', ...) so these exact routes are matched first.
function addEI(routePath, cfg) {
  // ----- EXPORT -----
  router.get(`/${routePath}/export`, auth, requireRole(['admin']), async (req, res) => {
    try {
      const ExcelJS = require('exceljs');
      const rows = db.prepare(cfg.exportSql).all();
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet(cfg.sheet || routePath);
      ws.columns = cfg.headers.map(h => ({ header: h.header, key: h.key, width: h.width || 20 }));
      rows.forEach(r => ws.addRow(r));
      const hdr = ws.getRow(1);
      hdr.font = { bold: true };
      hdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3F2FD' } };
      if (cfg.hints) {
        const hr = ws.addRow(cfg.hints);
        hr.font = { italic: true, size: 9, color: { argb: 'FF777777' } };
        hr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF9C4' } };
      }
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${cfg.filename || routePath}.xlsx"`);
      await wb.xlsx.write(res); res.end();
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ----- IMPORT (?dryRun=1 → validate only, no write) -----
  router.post(`/${routePath}/import`, auth, requireRole(['admin']), xlsxUpload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'กรุณาแนบไฟล์ Excel' });
    const dryRun = req.query.dryRun === '1';
    try {
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(req.file.buffer);
      const ws = wb.worksheets[0];
      if (!ws) return res.status(400).json({ error: 'ไม่พบ Sheet ในไฟล์ Excel' });

      // header map: lowercase name → column index
      const hdrMap = {};
      ws.getRow(1).eachCell((cell, col) => {
        const k = String(cell.value || '').trim().toLowerCase();
        if (k) hdrMap[k] = col;
      });

      // check required headers
      const importCols = cfg.importCols;
      const missing = importCols.filter(c => c.required && !hdrMap[c.header.toLowerCase()]);
      if (missing.length) {
        return res.status(400).json({
          headerError: true,
          error: `ไม่พบคอลัมน์จำเป็น: ${missing.map(c => c.header).join(', ')}`,
          expectedHeaders: importCols.map(c => c.header),
        });
      }

      // build FK lookup maps
      const refs = {};
      if (cfg.needsLines) {
        refs.lines = {};
        db.prepare('SELECT id, code FROM production_lines WHERE is_active=1').all()
          .forEach(r => { refs.lines[r.code.toLowerCase()] = r; });
      }
      if (cfg.needsFm) {
        refs.fm = {};
        db.prepare('SELECT id, code FROM fm_categories WHERE is_active=1').all()
          .forEach(r => { refs.fm[r.code.toLowerCase()] = r; });
      }
      if (cfg.needsLineTypes) {
        refs.lineTypes = {};
        db.prepare('SELECT code, name FROM line_types WHERE is_active=1').all()
          .forEach(r => { refs.lineTypes[r.code.toLowerCase()] = r; });
      }
      if (cfg.needsFactories) {
        refs.factories = {};
        db.prepare('SELECT name, factory_code FROM factories WHERE is_active=1').all()
          .forEach(r => { refs.factories[r.name.toLowerCase()] = r; });
      }

      const results = { total: 0, valid: 0, invalid: 0, imported: 0, updated: 0, rows: [] };
      const validRows = [];

      ws.eachRow((row, rowNum) => {
        if (rowNum === 1) return;
        const get = (header) => {
          const col = hdrMap[header.toLowerCase()];
          if (!col) return '';
          const v = row.getCell(col).value;
          if (v == null) return '';
          if (typeof v === 'object') return String(v.text || v.result || v.richText?.[0]?.text || '').trim();
          return String(v).trim();
        };

        const raw = {};
        importCols.forEach(c => { raw[c.header] = get(c.header); });

        // skip blank rows
        if (importCols.filter(c => c.required).every(c => !raw[c.header])) return;

        results.total++;
        const errors = [];

        for (const c of importCols) {
          const v = raw[c.header];
          if (c.required && !v) { errors.push(`"${c.header}": จำเป็น`); continue; }
          if (c.enum && v && !c.enum.includes(v))
            errors.push(`"${c.header}": ต้องเป็น ${c.enum.join('/')} (พบ: "${v}")`);
          if (c.type === 'number' && v) {
            if (isNaN(Number(v))) errors.push(`"${c.header}": ต้องเป็นตัวเลข`);
            else if (c.min !== undefined && Number(v) < c.min) errors.push(`"${c.header}": ต้องไม่ต่ำกว่า ${c.min}`);
            else if (c.max !== undefined && Number(v) > c.max) errors.push(`"${c.header}": ต้องไม่เกิน ${c.max}`);
          }
          if (c.isRef && v && refs[c.isRef] && !refs[c.isRef][v.toLowerCase()])
            errors.push(`"${c.header}": ไม่พบ "${v}" ในระบบ`);
        }

        if (errors.length) {
          results.invalid++;
          results.rows.push({ rowNum, data: raw, valid: false, errors });
        } else {
          // resolve FKs
          const data = { ...raw };
          if (raw.line_code !== undefined)
            data.production_line_id = raw.line_code ? (refs.lines?.[raw.line_code.toLowerCase()]?.id ?? null) : null;
          if (raw.fm_code !== undefined)
            data.fm_category_id = raw.fm_code ? (refs.fm?.[raw.fm_code.toLowerCase()]?.id ?? null) : null;
          results.valid++;
          validRows.push(data);
          results.rows.push({ rowNum, data: raw, valid: true });
        }
      });

      if (!dryRun && validRows.length > 0) {
        db.transaction(() => {
          for (const data of validRows) cfg.importRow(db, data, req.user.id, req.ip, results);
        })();
      }

      res.json({ ...results, dryRun });
    } catch (e) {
      console.error('[import]', routePath, e);
      res.status(500).json({ error: e.message });
    }
  });
}

// ---- production-manager user lookup ----
router.get('/manager-users', auth, requireRole(['admin']), (req, res) => {
  const rows = db.prepare(
    "SELECT id, username, full_name FROM users WHERE role = 'production_manager' AND is_active = 1 ORDER BY full_name"
  ).all();
  res.json({ data: rows });
});

// ===== Production lines =====
addEI('production-lines', {
  filename: 'production-lines', sheet: 'สายผลิต',
  exportSql: 'SELECT code, name, line_type, factory, factory_code, pdplan_sheet FROM production_lines ORDER BY id',
  headers: [
    { header: 'code', key: 'code', width: 22 },
    { header: 'name', key: 'name', width: 32 },
    { header: 'line_type', key: 'line_type', width: 14 },
    { header: 'factory', key: 'factory', width: 12 },
    { header: 'factory_code', key: 'factory_code', width: 14 },
    { header: 'pdplan_sheet', key: 'pdplan_sheet', width: 22 },
  ],
  hints: ['F01-ALU-15', 'ชื่อสายผลิต', 'alu / upvc / other', 'F01', '01', '0115,0116'],
  needsLineTypes: true,
  needsFactories: true,
  importCols: [
    { header: 'code', required: true },
    { header: 'name', required: true },
    { header: 'line_type', required: true, isRef: 'lineTypes' },
    { header: 'factory', required: true, isRef: 'factories' },
    { header: 'factory_code' },
    { header: 'pdplan_sheet' },
  ],
  importRow(db, data, userId, ip, results) {
    // factory_code ผูกกับโรงงานเสมอ — ไม่เชื่อค่าที่พิมพ์มาใน Excel ถ้าโรงงานนี้มีอยู่ในระบบแล้ว
    const fac = db.prepare('SELECT factory_code FROM factories WHERE name = ? AND is_active = 1').get(data.factory);
    const factoryCode = fac?.factory_code || data.factory_code;
    const ex = db.prepare('SELECT * FROM production_lines WHERE code=?').get(data.code);
    if (ex) {
      db.prepare('UPDATE production_lines SET name=?,line_type=?,factory=?,factory_code=?,pdplan_sheet=? WHERE id=?')
        .run(data.name, data.line_type, data.factory, factoryCode, data.pdplan_sheet || null, ex.id);
      db.auditLog('production_lines', ex.id, 'UPDATE', ex, data, userId, ip);
      results.updated++;
    } else {
      const r = db.prepare('INSERT INTO production_lines(code,name,line_type,factory,factory_code,pdplan_sheet,is_active) VALUES(?,?,?,?,?,?,1)')
        .run(data.code, data.name, data.line_type, data.factory, factoryCode, data.pdplan_sheet || null);
      db.auditLog('production_lines', r.lastInsertRowid, 'CREATE', null, data, userId, ip);
      results.imported++;
    }
  },
});

// ===== ตัวเลือก dropdown: "ประเภทสาย" / "โรงงาน" (จัดการผ่านปุ่ม + ในฟอร์มสายผลิต) =====
const lineTypesRouter = makeCrudRouter({
  table: 'line_types',
  schema: {
    code: { required: true, type: 'string', maxLength: 20, label: 'รหัสประเภทสาย' },
    name: { required: true, type: 'string', maxLength: 50, label: 'ชื่อประเภทสาย' },
  },
  searchable: ['code', 'name'],
  orderBy: 'name ASC',
});
router.use('/line-types', lineTypesRouter);

const factoriesRouter = makeCrudRouter({
  table: 'factories',
  schema: {
    name:         { required: true, type: 'string', maxLength: 10, label: 'ชื่อโรงงาน' },
    factory_code: { required: true, type: 'string', maxLength: 5, label: 'รหัสโรงงาน' },
  },
  searchable: ['name', 'factory_code'],
  orderBy: 'name ASC',
});
router.use('/factories', factoriesRouter);

const linesRouter = makeCrudRouter({
  table: 'production_lines',
  schema: {
    code:         { type: 'string', maxLength: 30, label: 'รหัสสาย' },
    name:         { required: true, type: 'string', maxLength: 100, label: 'ชื่อสาย' },
    line_type:    { required: true, type: 'string', maxLength: 20, label: 'ประเภทสาย' },
    factory:      { required: true, type: 'string', maxLength: 10, label: 'โรงงาน' },
    factory_code: { type: 'string', maxLength: 5, label: 'รหัสโรงงาน' },
    pdplan_sheet: { type: 'string', maxLength: 200, label: 'รหัส Sheet PDPlan' },
  },
  searchable: ['code', 'name', 'factory'],
  orderBy: 'factory ASC, code ASC',
  hooks: {
    // code/factory_code สร้าง+ผูกอัตโนมัติเสมอ — ห้ามรับค่าจาก client โดยตรง (กัน tamper + กันไม่ตรงกับ seq จริง)
    // factory/line_type ห้ามแก้หลังสร้าง เพราะ code ผูกกับค่านี้ไปแล้ว (เหมือน record_no/defect_code ที่อื่นในระบบ)
    beforeWrite: (data, req) => {
      if (req.method === 'POST') {
        const factoryRow = db.prepare('SELECT * FROM factories WHERE name = ? AND is_active = 1').get(data.factory);
        if (!factoryRow) throw httpError('ไม่พบโรงงานนี้ในระบบ กรุณาเพิ่มโรงงานก่อน (ปุ่ม + ข้างช่องโรงงาน)', 400);
        const lineTypeRow = db.prepare('SELECT * FROM line_types WHERE code = ? AND is_active = 1').get(data.line_type);
        if (!lineTypeRow) throw httpError('ไม่พบประเภทสายนี้ในระบบ กรุณาเพิ่มประเภทสายก่อน (ปุ่ม + ข้างช่องประเภทสาย)', 400);
        data.factory_code = factoryRow.factory_code;
        data.code = genLineCode(data.factory, data.line_type);
      } else {
        delete data.code;
        delete data.factory_code;
        delete data.factory;
        delete data.line_type;
      }
    },
    mapRow: (database, row) => {
      row.managers = database.prepare(`
        SELECT plm.user_id, u.full_name
        FROM production_line_managers plm JOIN users u ON u.id = plm.user_id
        WHERE plm.production_line_id = ?
      `).all(row.id);
      return row;
    },
  },
});

linesRouter.post('/:id/managers', auth, requireRole(['admin']), (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'กรุณาเลือกผู้ใช้' });
  const line = db.prepare('SELECT id FROM production_lines WHERE id = ?').get(req.params.id);
  if (!line) return res.status(404).json({ error: 'ไม่พบสายผลิต' });
  const user = db.prepare('SELECT id, role FROM users WHERE id = ? AND is_active = 1').get(user_id);
  if (!user) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
  if (user.role !== 'production_manager') return res.status(400).json({ error: 'ผู้ใช้ต้องมีบทบาท production_manager' });
  try {
    const r = db.prepare('INSERT OR IGNORE INTO production_line_managers (production_line_id, user_id) VALUES (?, ?)').run(req.params.id, user_id);
    if (r.changes) db.auditLog('production_line_managers', req.params.id, 'CREATE', null, { user_id }, req.user.id, req.ip);
    res.status(201).json({ ok: true });
  } catch (e) { handleDbError(e, res); }
});

linesRouter.delete('/:id/managers/:userId', auth, requireRole(['admin']), (req, res) => {
  const r = db.prepare('DELETE FROM production_line_managers WHERE production_line_id = ? AND user_id = ?').run(req.params.id, req.params.userId);
  if (r.changes) db.auditLog('production_line_managers', req.params.id, 'DELETE', { user_id: req.params.userId }, null, req.user.id, req.ip);
  res.json({ ok: true });
});

router.use('/production-lines', linesRouter);

// ===== FM categories =====
addEI('fm-categories', {
  filename: 'fm-categories', sheet: 'FM Category',
  exportSql: 'SELECT name, code FROM fm_categories ORDER BY id',
  headers: [
    { header: 'name', key: 'name', width: 30 },
    { header: 'code', key: 'code', width: 14 },
  ],
  hints: ['Machine', 'Mc'],
  importCols: [
    { header: 'name', required: true },
    { header: 'code', required: true },
  ],
  importRow(db, data, userId, ip, results) {
    const ex = db.prepare('SELECT * FROM fm_categories WHERE code=?').get(data.code);
    if (ex) {
      db.prepare('UPDATE fm_categories SET name=? WHERE id=?').run(data.name, ex.id);
      db.auditLog('fm_categories', ex.id, 'UPDATE', ex, data, userId, ip);
      results.updated++;
    } else {
      const r = db.prepare('INSERT INTO fm_categories(name,code,is_active) VALUES(?,?,1)').run(data.name, data.code);
      db.auditLog('fm_categories', r.lastInsertRowid, 'CREATE', null, data, userId, ip);
      results.imported++;
    }
  },
});

router.use('/fm-categories', makeCrudRouter({
  table: 'fm_categories',
  schema: {
    name: { required: true, type: 'string', maxLength: 50, label: 'ชื่อ FM' },
    code: { required: true, type: 'string', maxLength: 10, label: 'รหัส FM' },
  },
  searchable: ['name', 'code'],
  orderBy: 'id ASC',
}));

// ===== Shifts =====
addEI('shifts', {
  filename: 'shifts', sheet: 'กะการผลิต',
  exportSql: 'SELECT name, start_time, end_time FROM shifts ORDER BY id',
  headers: [
    { header: 'name', key: 'name', width: 20 },
    { header: 'start_time', key: 'start_time', width: 12 },
    { header: 'end_time', key: 'end_time', width: 12 },
  ],
  hints: ['กะเช้า', '08:00', '17:00'],
  importCols: [
    { header: 'name', required: true },
    { header: 'start_time' },
    { header: 'end_time' },
  ],
  importRow(db, data, userId, ip, results) {
    const ex = db.prepare('SELECT * FROM shifts WHERE name=?').get(data.name);
    if (ex) {
      db.prepare('UPDATE shifts SET start_time=?,end_time=? WHERE id=?').run(data.start_time || null, data.end_time || null, ex.id);
      db.auditLog('shifts', ex.id, 'UPDATE', ex, data, userId, ip);
      results.updated++;
    } else {
      const r = db.prepare('INSERT INTO shifts(name,start_time,end_time,is_active) VALUES(?,?,?,1)').run(data.name, data.start_time || null, data.end_time || null);
      db.auditLog('shifts', r.lastInsertRowid, 'CREATE', null, data, userId, ip);
      results.imported++;
    }
  },
});

router.use('/shifts', makeCrudRouter({
  table: 'shifts',
  schema: {
    name:       { required: true, type: 'string', maxLength: 50, label: 'ชื่อกะ' },
    start_time: { type: 'string', maxLength: 5, label: 'เวลาเริ่ม' },
    end_time:   { type: 'string', maxLength: 5, label: 'เวลาสิ้นสุด' },
  },
  searchable: ['name'],
  orderBy: 'id ASC',
}));

// ===== Process steps =====
addEI('process-steps', {
  filename: 'process-steps', sheet: 'กระบวนการ',
  needsLines: true,
  exportSql: `SELECT ps.name, ps.code, pl.code AS line_code, ps.sort_order
    FROM process_steps ps LEFT JOIN production_lines pl ON pl.id = ps.production_line_id ORDER BY ps.id`,
  headers: [
    { header: 'name', key: 'name', width: 32 },
    { header: 'code', key: 'code', width: 14 },
    { header: 'line_code', key: 'line_code', width: 18 },
    { header: 'sort_order', key: 'sort_order', width: 12 },
  ],
  hints: ['ชื่อกระบวนการ', 'TC', 'F01-ALU-15 (ว่าง=ทุกสาย)', '1'],
  importCols: [
    { header: 'name', required: true },
    { header: 'code', required: true },
    { header: 'line_code', isRef: 'lines' },
    { header: 'sort_order', type: 'number', min: 0 },
  ],
  importRow(db, data, userId, ip, results) {
    const ex = db.prepare('SELECT * FROM process_steps WHERE code=? AND (production_line_id IS ? OR production_line_id=?)')
      .get(data.code, data.production_line_id, data.production_line_id);
    const lineId = data.production_line_id ?? null;
    const sortOrd = data.sort_order ? Number(data.sort_order) : null;
    if (ex) {
      db.prepare('UPDATE process_steps SET name=?,sort_order=? WHERE id=?').run(data.name, sortOrd, ex.id);
      db.auditLog('process_steps', ex.id, 'UPDATE', ex, data, userId, ip);
      results.updated++;
    } else {
      const r = db.prepare('INSERT INTO process_steps(production_line_id,name,code,sort_order,is_active) VALUES(?,?,?,?,1)')
        .run(lineId, data.name, data.code, sortOrd);
      db.auditLog('process_steps', r.lastInsertRowid, 'CREATE', null, data, userId, ip);
      results.imported++;
    }
  },
});

router.use('/process-steps', makeCrudRouter({
  table: 'process_steps',
  schema: {
    production_line_id: { type: 'int', label: 'สายผลิต' },
    name:               { required: true, type: 'string', maxLength: 100, label: 'ชื่อกระบวนการ' },
    code:               { required: true, type: 'string', maxLength: 10, label: 'รหัสกระบวนการ' },
    sort_order:         { type: 'int', min: 0, label: 'ลำดับ' },
  },
  searchable: ['name', 'code'],
  filters: [{ param: 'line_id', column: 'production_line_id', mode: 'eq_or_null' }],
  orderBy: 'sort_order ASC, id ASC',
  select: 't.*, pl.name AS line_name',
  joins: 'LEFT JOIN production_lines pl ON pl.id = t.production_line_id',
}));

// ===== Defect types =====
addEI('defect-types', {
  filename: 'defect-types', sheet: 'ประเภทของเสีย',
  needsLines: true, needsFm: true,
  exportSql: `SELECT dt.name, dt.code, pl.code AS line_code, fm.code AS fm_code
    FROM defect_types dt
    LEFT JOIN production_lines pl ON pl.id = dt.production_line_id
    LEFT JOIN fm_categories fm ON fm.id = dt.fm_category_id ORDER BY dt.id`,
  headers: [
    { header: 'name', key: 'name', width: 32 },
    { header: 'code', key: 'code', width: 14 },
    { header: 'line_code', key: 'line_code', width: 18 },
    { header: 'fm_code', key: 'fm_code', width: 14 },
  ],
  hints: ['ชื่อของเสีย', '001', 'F01-ALU-15 (ว่าง=ทุกสาย)', 'Mc (ว่าง=ไม่ระบุ)'],
  importCols: [
    { header: 'name', required: true },
    { header: 'code', required: true },
    { header: 'line_code', isRef: 'lines' },
    { header: 'fm_code', isRef: 'fm' },
  ],
  importRow(db, data, userId, ip, results) {
    const ex = db.prepare('SELECT * FROM defect_types WHERE code=? AND (production_line_id IS ? OR production_line_id=?)')
      .get(data.code, data.production_line_id, data.production_line_id);
    const lineId = data.production_line_id ?? null;
    const fmId   = data.fm_category_id ?? null;
    if (ex) {
      db.prepare('UPDATE defect_types SET name=?,fm_category_id=? WHERE id=?').run(data.name, fmId, ex.id);
      db.auditLog('defect_types', ex.id, 'UPDATE', ex, data, userId, ip);
      results.updated++;
    } else {
      const r = db.prepare('INSERT INTO defect_types(production_line_id,fm_category_id,name,code,is_active) VALUES(?,?,?,?,1)')
        .run(lineId, fmId, data.name, data.code);
      db.auditLog('defect_types', r.lastInsertRowid, 'CREATE', null, data, userId, ip);
      results.imported++;
    }
  },
});

router.use('/defect-types', makeCrudRouter({
  table: 'defect_types',
  schema: {
    production_line_id: { type: 'int', label: 'สายผลิต' },
    fm_category_id:     { type: 'int', label: 'FM Category' },
    name:               { required: true, type: 'string', maxLength: 100, label: 'ชื่อของเสีย' },
    code:               { required: true, type: 'string', maxLength: 10, label: 'รหัสของเสีย' },
  },
  searchable: ['name', 'code'],
  filters: [
    { param: 'line_id', column: 'production_line_id', mode: 'eq_or_null' },
    { param: 'fm_category_id', column: 'fm_category_id' },
  ],
  orderBy: 'id ASC',
  select: 't.*, pl.name AS line_name, fm.name AS fm_name',
  joins: 'LEFT JOIN production_lines pl ON pl.id = t.production_line_id LEFT JOIN fm_categories fm ON fm.id = t.fm_category_id',
}));

// ===== Defect-rate thresholds =====
addEI('thresholds', {
  filename: 'thresholds', sheet: 'เกณฑ์ของเสีย',
  needsLines: true,
  exportSql: `SELECT drt.threshold_pct, pl.code AS line_code, pcs.product_no, drt.effective_date, drt.notes
    FROM defect_rate_thresholds drt
    LEFT JOIN production_lines pl ON pl.id = drt.production_line_id
    LEFT JOIN pro_code_sap pcs ON pcs.id = drt.pro_code_sap_id ORDER BY drt.id`,
  headers: [
    { header: 'threshold_pct', key: 'threshold_pct', width: 16 },
    { header: 'line_code',     key: 'line_code',     width: 18 },
    { header: 'product_no',   key: 'product_no',    width: 22 },
    { header: 'effective_date', key: 'effective_date', width: 16 },
    { header: 'notes',          key: 'notes',          width: 30 },
  ],
  hints: ['3.0', 'F01-ALU-15 (ว่าง=ทุกสาย)', 'รหัส SAP (ว่าง=ทุกสินค้า)', 'YYYY-MM-DD', 'หมายเหตุ'],
  importCols: [
    { header: 'threshold_pct', required: true, type: 'number', min: 0, max: 100 },
    { header: 'line_code', isRef: 'lines' },
    { header: 'product_no' },
    { header: 'effective_date' },
    { header: 'notes' },
  ],
  importRow(db, data, userId, ip, results) {
    const lineId = data.production_line_id ?? null;
    let sapId = null;
    if (data.product_no) {
      const sap = db.prepare('SELECT id FROM pro_code_sap WHERE product_no=?').get(data.product_no);
      sapId = sap?.id ?? null;
    }
    const r = db.prepare('INSERT INTO defect_rate_thresholds(production_line_id,pro_code_sap_id,threshold_pct,effective_date,notes,created_by) VALUES(?,?,?,?,?,?)')
      .run(lineId, sapId, Number(data.threshold_pct), data.effective_date || null, data.notes || null, userId);
    db.auditLog('defect_rate_thresholds', r.lastInsertRowid, 'CREATE', null, data, userId, ip);
    results.imported++;
  },
});

router.use('/thresholds', makeCrudRouter({
  table: 'defect_rate_thresholds',
  schema: {
    production_line_id: { type: 'int', label: 'สายผลิต' },
    pro_code_sap_id:    { type: 'int', label: 'สินค้า' },
    threshold_pct:      { required: true, type: 'number', min: 0, max: 100, label: 'เกณฑ์ %' },
    effective_date:     { type: 'date', label: 'วันที่มีผล' },
  },
  filters: [{ param: 'line_id', column: 'production_line_id' }],
  orderBy: 'effective_date DESC, id DESC',
  writeRoles: ['admin', 'qc_manager'],
  softDelete: false,
  select: 't.*, pl.name AS line_name, pcs.product_no',
  joins: 'LEFT JOIN production_lines pl ON pl.id = t.production_line_id LEFT JOIN pro_code_sap pcs ON pcs.id = t.pro_code_sap_id',
  hooks: { beforeWrite: (data, req) => { data.created_by = req.user.id; } },
}));

// ── Return Stations (สถานีแก้ไขงาน — สำหรับ IPNCP) ──────────────────────────
router.use('/return-stations', makeCrudRouter({
  table: 'return_stations',
  schema: {
    name:       { required: true, label: 'ชื่อสถานี' },
    factory:    { label: 'โรง/อาคาร' },
    sort_order: { type: 'int', label: 'ลำดับ' },
    is_active:  { type: 'int', label: 'ใช้งาน' },
  },
  filters: [{ param: 'active', column: 'is_active', transform: v => v === '1' ? 1 : undefined }],
  orderBy: 'sort_order ASC, id ASC',
  writeRoles: ['admin'],
  softDelete: false,
}));

// ── IPQC Stations (5 สถานีตรวจ: cutting|frame|door|screen|final_test) ─────────
router.use('/ipqc-stations', makeCrudRouter({
  table: 'ipqc_stations',
  schema: {
    name:       { required: true, label: 'ชื่อ Station' },
    code:       { required: true, label: 'Code (เอกลักษณ์)' },
    sort_order: { type: 'int', label: 'ลำดับ' },
    is_active:  { type: 'int', label: 'ใช้งาน' },
  },
  filters: [{ param: 'active', column: 'is_active', transform: v => v === '1' ? 1 : undefined }],
  orderBy: 'sort_order ASC, id ASC',
  writeRoles: ['admin'],
  softDelete: false,
}));

// ── IPQC Spec Options — distinct values from confirmed pro_code_sap ───────────
// Returns { series, brand, product_type, window_type, color, size, combinations }
// combinations ใช้สำหรับ cascading dropdown บน frontend
router.get('/spec-options', auth, (req, res) => {
  try {
    const pick = (col) =>
      db.prepare(
        `SELECT DISTINCT ${col} AS value FROM pro_code_sap
         WHERE classify_status = 'confirmed' AND ${col} IS NOT NULL AND TRIM(${col}) != ''
         ORDER BY ${col} ASC`
      ).all().map(r => r.value);

    // ชุดข้อมูล spec ที่เป็นไปได้ทั้งหมด — frontend ใช้ filter cascading
    const combinations = db.prepare(`
      SELECT DISTINCT
        product_series AS series,
        brand,
        panel_type     AS product_type,
        panel_style    AS window_type,
        panel_color    AS color,
        panel_size     AS size
      FROM pro_code_sap
      WHERE classify_status = 'confirmed'
      ORDER BY panel_type, panel_style, panel_color, panel_size
    `).all();

    res.json({
      series:       pick('product_series'),
      brand:        pick('brand'),
      product_type: pick('panel_type'),
      window_type:  pick('panel_style'),
      color:        pick('panel_color'),
      size:         pick('panel_size'),
      combinations,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── IPQC Template Match — spec-based priority matching ─────────────────────────
// Returns most-specific matching template + items for given product spec.
// NULL spec field = wildcard (matches any). Specificity = count of non-NULL fields.
router.get('/template-match', auth, (req, res) => {
  try {
    const { station_id, series, brand, product_type, window_type, color, size } = req.query;
    if (!station_id) return res.status(400).json({ error: 'station_id required' });

    const tmpl = db.prepare(`
      SELECT t.*,
        s.name AS station_name, s.code AS station_code,
        pl.name AS line_name,
        (CASE WHEN t.spec_series       IS NOT NULL THEN 1 ELSE 0 END +
         CASE WHEN t.spec_brand        IS NOT NULL THEN 1 ELSE 0 END +
         CASE WHEN t.spec_product_type IS NOT NULL THEN 1 ELSE 0 END +
         CASE WHEN t.spec_window_type  IS NOT NULL THEN 1 ELSE 0 END +
         CASE WHEN t.spec_color        IS NOT NULL THEN 1 ELSE 0 END +
         CASE WHEN t.spec_size         IS NOT NULL THEN 1 ELSE 0 END) AS specificity
      FROM ipqc_check_templates t
      LEFT JOIN ipqc_stations s     ON s.id = t.station_id
      LEFT JOIN production_lines pl ON pl.id = t.production_line_id
      WHERE t.station_id = ?
        AND t.is_active = 1
        AND (t.spec_series       IS NULL OR t.spec_series       = ?)
        AND (t.spec_brand        IS NULL OR t.spec_brand        = ?)
        AND (t.spec_product_type IS NULL OR t.spec_product_type = ?)
        AND (t.spec_window_type  IS NULL OR t.spec_window_type  = ?)
        AND (t.spec_color        IS NULL OR t.spec_color        = ?)
        AND (t.spec_size         IS NULL OR t.spec_size         = ?)
      ORDER BY specificity DESC, t.id ASC
      LIMIT 1
    `).get(
      +station_id,
      series       || null,
      brand        || null,
      product_type || null,
      window_type  || null,
      color        || null,
      size         || null
    );

    if (!tmpl) return res.json({ template: null, items: [], specificity: 0 });

    const items = db.prepare(`
      SELECT * FROM ipqc_check_items
      WHERE template_id = ? AND is_active = 1
      ORDER BY sort_order ASC, item_no ASC
    `).all(tmpl.id);

    res.json({ template: tmpl, items, specificity: tmpl.specificity });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── IPQC Check Templates (template check sheet ต่อ station) ────────────────────
router.use('/check-templates', makeCrudRouter({
  table: 'ipqc_check_templates',
  schema: {
    station_id:         { required: true, type: 'int', label: 'Station' },
    production_line_id: { type: 'int', label: 'สายผลิต (ว่าง=ทุกสาย)' },
    name:               { required: true, label: 'ชื่อ Template' },
    spec_series:        { label: 'Series (FA / uPVC / ...)' },
    spec_brand:         { label: 'Brand' },
    spec_product_type:  { label: 'ประเภทสินค้า (หน้าต่าง / ประตู / ...)' },
    spec_window_type:   { label: 'สไตล์ (บานเปิดเดี่ยว / บานเลื่อน / ...)' },
    spec_color:         { label: 'สี (สีขาว / สีดำ / ...)' },
    spec_size:          { label: 'ขนาด (60x150 / ...)' },
    is_active:          { type: 'int', label: 'ใช้งาน' },
  },
  filters: [
    { param: 'station_id', column: 'station_id' },
    { param: 'line_id',    column: 'production_line_id' },
    { param: 'active',     column: 'is_active', transform: v => v === '1' ? 1 : undefined },
  ],
  orderBy: 'station_id ASC, id ASC',
  select: 't.*, s.name AS station_name, s.code AS station_code, pl.name AS line_name',
  joins: 'LEFT JOIN ipqc_stations s ON s.id = t.station_id LEFT JOIN production_lines pl ON pl.id = t.production_line_id',
  writeRoles: ['admin'],
  softDelete: false,
  hooks: { beforeWrite: (data, req) => { if (req.method === 'POST') data.created_by = req.user.id; } },
}));

// ── IPQC Check Items (หัวข้อตรวจใน template) ──────────────────────────────────
router.use('/check-items', makeCrudRouter({
  table: 'ipqc_check_items',
  schema: {
    template_id:        { required: true, type: 'int', label: 'Template' },
    item_no:            { required: true, type: 'int', label: 'ลำดับที่' },
    item_name:          { required: true, label: 'ชื่อหัวข้อตรวจ' },
    check_type:         { enum: ['dimension', 'visual', 'functional'], label: 'ประเภท' },
    std_value:          { type: 'number', label: 'ค่า Std' },
    tol_plus:           { type: 'number', label: 'Tol +' },
    tol_minus:          { type: 'number', label: 'Tol -' },
    unit:               { label: 'หน่วย' },
    input_type:         { enum: ['number', 'pass_fail', 'text'], label: 'รูปแบบกรอก' },
    sample_count:       { type: 'int', min: 1, label: 'จำนวนตัวอย่าง (override AQL ถ้ากำหนด)' },
    target_dimension:   { label: 'จุดวัด / อ้างอิง (เช่น ความยาว ด้านบน)' },
    position_reference: { label: 'ตำแหน่งตรวจ (เช่น วัดจากขอบซ้าย 10mm)' },
    tags:               { label: 'Tags เพิ่มเติม (JSON array)' },
    is_required:        { type: 'int', label: 'บังคับ' },
    sort_order:         { type: 'int', label: 'ลำดับแสดง' },
    is_active:          { type: 'int', label: 'ใช้งาน' },
  },
  filters: [
    { param: 'template_id', column: 'template_id' },
    { param: 'active',      column: 'is_active', transform: v => v === '1' ? 1 : undefined },
  ],
  orderBy: 'sort_order ASC, item_no ASC',
  select: 't.*, tmpl.name AS template_name, tmpl.station_id, tmpl.spec_series, tmpl.spec_product_type',
  joins: 'LEFT JOIN ipqc_check_templates tmpl ON tmpl.id = t.template_id',
  writeRoles: ['admin'],
  softDelete: false,
}));

module.exports = router;
