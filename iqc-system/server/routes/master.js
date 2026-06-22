const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../db/database');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const uploads = require('../middleware/upload');
const ExcelJS = require('exceljs');
const multer = require('multer');
const excelMemUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const adminOnly = [auth, requireRole(['admin'])];
const adminOrQCManager = [auth, requireRole(['admin', 'qc_manager'])];

const VALID_INSP_LEVELS = new Set(['GEN_I','GEN_II','GEN_III','S1','S2','S3','S4','FULL']);
const VALID_AQL = new Set(['0.65','1.0','1.5','2.5','4.0','6.5']);

// ── Shared Excel helpers ─────────────────────────────────────────────────────
function styleExcelHeader(ws, colCount) {
  const r = ws.getRow(1);
  r.height = 26;
  for (let c = 1; c <= colCount; c++) {
    const cell = r.getCell(c);
    cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3A5C' } };
    cell.font  = { color: { argb: 'FFFFFFFF' }, bold: true };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  }
}

function parseImportFile(buffer) {
  // returns ExcelJS.Workbook promise
  const wb = new ExcelJS.Workbook();
  return wb.xlsx.load(buffer).then(() => wb);
}

function cellStr(row, n) { return String(row.getCell(n).value ?? '').trim(); }

function importResponse(results) {
  return {
    results,
    total:        results.length,
    errorCount:   results.filter(r => r.status === 'error').length,
    warningCount: results.filter(r => r.status === 'warning').length,
  };
}

function makeResult(row, display, errors, warnings) {
  return { row, display, errors, warnings, status: errors.length ? 'error' : warnings.length ? 'warning' : 'ok' };
}

function parseBool(v) {
  return ['ใช่','yes','y','1','true'].includes(String(v ?? '').trim().toLowerCase());
}

// ===== SUPPLIERS =====
router.get('/suppliers/export', ...adminOnly, async (req, res) => {
  const wb = new ExcelJS.Workbook(); wb.creator = 'IQC System';
  const ws = wb.addWorksheet('ผู้ผลิต');
  ws.columns = [
    { header: 'รหัสผู้ผลิต',   key: 'code',  width: 16 },
    { header: 'ชื่อผู้ผลิต *', key: 'name',  width: 32 },
    { header: 'อีเมล',         key: 'email', width: 28 },
    { header: 'เบอร์โทร',      key: 'phone', width: 18 },
    { header: 'หมายเหตุ',      key: 'notes', width: 36 },
  ];
  styleExcelHeader(ws, 5);
  db.prepare('SELECT code, name, email, phone, notes FROM suppliers ORDER BY name').all()
    .forEach(r => ws.addRow([r.code||'', r.name, r.email||'', r.phone||'', r.notes||'']));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''suppliers_template.xlsx");
  await wb.xlsx.write(res); res.end();
});

router.post('/suppliers/import', ...adminOnly, excelMemUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'กรุณาอัปโหลดไฟล์ .xlsx' });
  let wb; try { wb = await parseImportFile(req.file.buffer); } catch { return res.status(400).json({ error: 'ไฟล์ไม่ถูกต้อง' }); }
  const ws = wb.getWorksheet('ผู้ผลิต') || wb.worksheets[0];
  if (!ws) return res.status(400).json({ error: 'ไม่พบ Sheet ในไฟล์' });

  const existingCodes = new Set(db.prepare('SELECT code FROM suppliers WHERE code IS NOT NULL').all().map(r => r.code.toLowerCase()));
  const existingNames = new Set(db.prepare('SELECT LOWER(name) as n FROM suppliers').all().map(r => r.n));
  const seenCodes = new Set(), seenNames = new Set(), results = [];

  ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum === 1) return;
    const code = cellStr(row,1), name = cellStr(row,2), email = cellStr(row,3), phone = cellStr(row,4), notes = cellStr(row,5);
    if (!name && !code) return;
    const errors = [], warnings = [];
    if (!name) errors.push('ชื่อผู้ผลิตห้ามว่าง');
    if (code) {
      if (existingCodes.has(code.toLowerCase()))  errors.push(`รหัส "${code}" มีอยู่แล้ว`);
      else if (seenCodes.has(code.toLowerCase()))  errors.push(`รหัส "${code}" ซ้ำในไฟล์`);
      else seenCodes.add(code.toLowerCase());
    }
    if (name) {
      if (existingNames.has(name.toLowerCase()))   warnings.push(`ชื่อ "${name}" มีอยู่แล้ว`);
      else if (seenNames.has(name.toLowerCase()))  warnings.push(`ชื่อ "${name}" ซ้ำในไฟล์`);
      else seenNames.add(name.toLowerCase());
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) warnings.push(`อีเมลรูปแบบไม่ถูกต้อง`);
    results.push({ ...makeResult(rowNum, { รหัส: code||'-', ชื่อผู้ผลิต: name, อีเมล: email||'-', เบอร์โทร: phone||'-' }, errors, warnings), _data: { code:code||null, name, email:email||null, phone:phone||null, notes:notes||null } });
  });

  if (!results.length) return res.status(400).json({ error: 'ไม่พบข้อมูลในไฟล์' });
  if (req.query.preview === '1') return res.json(importResponse(results));
  if (results.some(r => r.errors.length)) return res.status(400).json({ error: 'มีข้อมูลที่ไม่ถูกต้อง' });

  const ins = db.prepare('INSERT INTO suppliers (code, name, email, phone, notes) VALUES (?, ?, ?, ?, ?)');
  const doImport = db.transaction(rows => {
    let n = 0;
    for (const r of rows) {
      const d = r._data;
      const res2 = ins.run(d.code, d.name, d.email, d.phone, d.notes);
      db.auditLog('suppliers', res2.lastInsertRowid, 'CREATE', null, { name: d.name, source: 'excel_import' }, req.user.id, req.ip);
      n++;
    }
    return n;
  });
  try { res.json({ success: true, imported: doImport(results) }); }
  catch (e) { res.status(e.message?.includes('UNIQUE') ? 400 : 500).json({ error: e.message?.includes('UNIQUE') ? 'รหัสหรือชื่อซ้ำ' : e.message }); }
});

router.get('/suppliers', auth, (req, res) => {
  const { all, page, limit: lim, q = '' } = req.query;
  const includeInactive = all === '1';
  if (page !== undefined) {
    const pg = Math.max(1, +page || 1);
    const perPage = Math.min(100, Math.max(1, +lim || 20));
    const offset = (pg - 1) * perPage;
    const activeCl = includeInactive ? '' : 'AND is_active = 1';
    const searchCl = q ? "AND (name LIKE ? OR COALESCE(code,'') LIKE ?)" : '';
    const sp = q ? [`%${q}%`, `%${q}%`] : [];
    const total = db.prepare(`SELECT COUNT(*) as c FROM suppliers WHERE 1=1 ${activeCl} ${searchCl}`).get(...sp);
    const rows = db.prepare(`SELECT * FROM suppliers WHERE 1=1 ${activeCl} ${searchCl} ORDER BY name LIMIT ? OFFSET ?`).all(...sp, perPage, offset);
    return res.json({ data: rows, total: total.c, page: pg, limit: perPage });
  }
  const rows = includeInactive
    ? db.prepare('SELECT * FROM suppliers ORDER BY name').all()
    : db.prepare('SELECT * FROM suppliers WHERE is_active = 1 ORDER BY name').all();
  res.json(rows);
});

router.post('/suppliers', ...adminOnly, (req, res) => {
  const { code, name, email, phone, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'กรุณากรอกชื่อผู้ผลิต' });
  try {
    const result = db.prepare('INSERT INTO suppliers (code, name, email, phone, notes) VALUES (?, ?, ?, ?, ?)').run(code || null, name, email || null, phone || null, notes || null);
    db.auditLog('suppliers', result.lastInsertRowid, 'CREATE', null, { name }, req.user.id, req.ip);
    res.json(db.prepare('SELECT * FROM suppliers WHERE id = ?').get(result.lastInsertRowid));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'รหัสผู้ผลิตซ้ำ' });
    res.status(500).json({ error: e.message });
  }
});

router.patch('/suppliers/:id', ...adminOnly, (req, res) => {
  const { code, name, email, phone, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'กรุณากรอกชื่อผู้ผลิต' });
  try {
    const old = db.prepare('SELECT * FROM suppliers WHERE id=?').get(req.params.id);
    db.prepare('UPDATE suppliers SET code=?, name=?, email=?, phone=?, notes=? WHERE id=?').run(code || null, name, email || null, phone || null, notes || null, req.params.id);
    db.auditLog('suppliers', req.params.id, 'UPDATE', old, { name }, req.user.id, req.ip);
    res.json(db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'รหัสผู้ผลิตซ้ำ' });
    res.status(500).json({ error: e.message });
  }
});

router.patch('/suppliers/:id/toggle', ...adminOnly, (req, res) => {
  const row = db.prepare('SELECT is_active FROM suppliers WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
  db.prepare('UPDATE suppliers SET is_active = ? WHERE id = ?').run(row.is_active ? 0 : 1, req.params.id);
  res.json(db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id));
});

// Supplier Approval Status (ISO 9001 ข้อ 8.4 - ASL)
router.patch('/suppliers/:id/approval-status', ...adminOnly, (req, res) => {
  const { approval_status, reason, next_evaluation_date } = req.body;
  if (!approval_status) return res.status(400).json({ error: 'กรุณาระบุสถานะ' });
  if (!reason) return res.status(400).json({ error: 'กรุณากรอกเหตุผล' });

  const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
  if (!supplier) return res.status(404).json({ error: 'ไม่พบ Supplier' });

  const upd = db.transaction(() => {
    db.prepare(`UPDATE suppliers SET approval_status=?, approval_date=CURRENT_DATE, approval_by=?, suspension_reason=?, next_evaluation_date=? WHERE id=?`)
      .run(approval_status, req.user.id, reason, next_evaluation_date || null, req.params.id);

    db.prepare('INSERT INTO supplier_approval_history (supplier_id, old_status, new_status, reason, changed_by) VALUES (?, ?, ?, ?, ?)')
      .run(req.params.id, supplier.approval_status, approval_status, reason, req.user.id);

    db.auditLog('suppliers', req.params.id, 'APPROVAL_STATUS', { approval_status: supplier.approval_status }, { approval_status }, req.user.id, req.ip);
  });

  upd();
  res.json(db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id));
});

router.get('/suppliers/:id/approval-history', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT h.*, u.full_name as changed_by_name
    FROM supplier_approval_history h
    LEFT JOIN users u ON u.id = h.changed_by
    WHERE h.supplier_id = ? ORDER BY h.changed_at DESC
  `).all(req.params.id);
  res.json(rows);
});

// Supplier Evaluations
router.get('/suppliers/:id/evaluations', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT e.*, u.full_name as evaluator_name
    FROM supplier_evaluations e
    LEFT JOIN users u ON u.id = e.evaluator_id
    WHERE e.supplier_id = ? ORDER BY e.eval_date DESC
  `).all(req.params.id);
  res.json(rows);
});

router.post('/suppliers/:id/evaluations', ...adminOrQCManager, (req, res) => {
  const { eval_period, eval_date, score_quality, score_delivery, score_response, recommendation } = req.body;
  if (!eval_period || !eval_date) return res.status(400).json({ error: 'กรุณากรอก period และวันที่' });

  const total = Math.round(((Number(score_quality) || 0) + (Number(score_delivery) || 0) + (Number(score_response) || 0)) / 3);
  let grade = 'D';
  if (total >= 90) grade = 'A';
  else if (total >= 75) grade = 'B';
  else if (total >= 60) grade = 'C';

  const result = db.prepare(`
    INSERT INTO supplier_evaluations (supplier_id, eval_period, eval_date, score_quality, score_delivery, score_response, grade, recommendation, evaluator_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.params.id, eval_period, eval_date, score_quality || null, score_delivery || null, score_response || null, grade, recommendation || null, req.user.id);

  res.json(db.prepare('SELECT * FROM supplier_evaluations WHERE id = ?').get(result.lastInsertRowid));
});

// Supplier Risks
router.get('/suppliers/:id/risks', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT r.*, u.full_name as created_by_name, (r.likelihood * r.impact) as risk_score
    FROM supplier_risks r LEFT JOIN users u ON u.id = r.created_by
    WHERE r.supplier_id = ? ORDER BY (r.likelihood * r.impact) DESC
  `).all(req.params.id);
  res.json(rows);
});

router.post('/suppliers/:id/risks', ...adminOrQCManager, (req, res) => {
  const { risk_type, description, likelihood, impact, mitigation, review_date } = req.body;
  if (!risk_type || !description || !likelihood || !impact) return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบ' });
  const result = db.prepare(`
    INSERT INTO supplier_risks (supplier_id, risk_type, description, likelihood, impact, mitigation, review_date, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.params.id, risk_type, description, likelihood, impact, mitigation || null, review_date || null, req.user.id);
  res.json(db.prepare('SELECT *, (likelihood * impact) as risk_score FROM supplier_risks WHERE id = ?').get(result.lastInsertRowid));
});

router.patch('/suppliers/:id/risks/:riskId', ...adminOrQCManager, (req, res) => {
  const { status, mitigation, review_date, description, likelihood, impact } = req.body;
  const risk = db.prepare('SELECT * FROM supplier_risks WHERE id = ? AND supplier_id = ?').get(req.params.riskId, req.params.id);
  if (!risk) return res.status(404).json({ error: 'ไม่พบ risk' });
  db.prepare(`UPDATE supplier_risks SET status=COALESCE(?,status), mitigation=COALESCE(?,mitigation), review_date=COALESCE(?,review_date), description=COALESCE(?,description), likelihood=COALESCE(?,likelihood), impact=COALESCE(?,impact) WHERE id=?`)
    .run(status || null, mitigation || null, review_date || null, description || null, likelihood || null, impact || null, req.params.riskId);
  res.json(db.prepare('SELECT *, (likelihood * impact) as risk_score FROM supplier_risks WHERE id = ?').get(req.params.riskId));
});

// ===== PRODUCT GROUPS =====
router.get('/product-groups/export', ...adminOnly, async (req, res) => {
  const wb = new ExcelJS.Workbook(); wb.creator = 'IQC System';
  const ws = wb.addWorksheet('กลุ่มสินค้า');
  ws.columns = [
    { header: 'รหัสกลุ่ม',           key: 'code',  width: 16 },
    { header: 'ชื่อกลุ่มสินค้า *',   key: 'name',  width: 30 },
    { header: 'บังคับเอกสารตรวจ',    key: 'doc',   width: 22 },
    { header: 'บังคับ Lot Number',    key: 'lot',   width: 22 },
    { header: 'บังคับวันหมดอายุ',     key: 'exp',   width: 22 },
    { header: 'บังคับ Certificate',   key: 'cert',  width: 22 },
  ];
  styleExcelHeader(ws, 6);

  // Dropdown ใช่/"" สำหรับ boolean columns
  const dvYN = { type: 'list', allowBlank: true, formulae: ['"ใช่,"'] };
  for (let r = 2; r <= 300; r++) {
    [3,4,5,6].forEach(c => { ws.getCell(r, c).dataValidation = dvYN; });
  }

  db.prepare('SELECT code, name, require_inspection_doc, require_lot_number, require_expiry_date, require_certificate FROM product_groups ORDER BY name').all()
    .forEach(r => ws.addRow([
      r.code||'', r.name,
      r.require_inspection_doc ? 'ใช่' : '',
      r.require_lot_number     ? 'ใช่' : '',
      r.require_expiry_date    ? 'ใช่' : '',
      r.require_certificate    ? 'ใช่' : '',
    ]));

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''product_groups_template.xlsx");
  await wb.xlsx.write(res); res.end();
});

router.post('/product-groups/import', ...adminOnly, excelMemUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'กรุณาอัปโหลดไฟล์ .xlsx' });
  let wb; try { wb = await parseImportFile(req.file.buffer); } catch { return res.status(400).json({ error: 'ไฟล์ไม่ถูกต้อง' }); }
  const ws = wb.getWorksheet('กลุ่มสินค้า') || wb.worksheets[0];
  if (!ws) return res.status(400).json({ error: 'ไม่พบ Sheet ในไฟล์' });

  const existingNames = new Set(db.prepare('SELECT LOWER(name) as n FROM product_groups').all().map(r => r.n));
  const existingCodes = new Set(db.prepare('SELECT code FROM product_groups WHERE code IS NOT NULL').all().map(r => r.code.toLowerCase()));
  const seenNames = new Set(), seenCodes = new Set(), results = [];

  ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum === 1) return;
    const code = cellStr(row,1), name = cellStr(row,2);
    const doc  = parseBool(row.getCell(3).value), lot  = parseBool(row.getCell(4).value);
    const exp  = parseBool(row.getCell(5).value), cert = parseBool(row.getCell(6).value);
    if (!name && !code) return;
    const errors = [], warnings = [];
    if (!name) errors.push('ชื่อกลุ่มห้ามว่าง');
    if (code) {
      if (existingCodes.has(code.toLowerCase()))  errors.push(`รหัส "${code}" มีอยู่แล้ว`);
      else if (seenCodes.has(code.toLowerCase()))  errors.push(`รหัส "${code}" ซ้ำในไฟล์`);
      else seenCodes.add(code.toLowerCase());
    }
    if (name) {
      if (existingNames.has(name.toLowerCase()))   warnings.push(`ชื่อ "${name}" มีอยู่แล้ว`);
      else if (seenNames.has(name.toLowerCase()))  warnings.push(`ชื่อ "${name}" ซ้ำในไฟล์`);
      else seenNames.add(name.toLowerCase());
    }
    results.push({ ...makeResult(rowNum, { รหัส: code||'-', ชื่อกลุ่ม: name, 'เอกสารตรวจ': doc?'ใช่':'-', Lot: lot?'ใช่':'-', 'หมดอายุ': exp?'ใช่':'-', Certificate: cert?'ใช่':'-' }, errors, warnings), _data: { code:code||null, name, doc, lot, exp, cert } });
  });

  if (!results.length) return res.status(400).json({ error: 'ไม่พบข้อมูลในไฟล์' });
  if (req.query.preview === '1') return res.json(importResponse(results));
  if (results.some(r => r.errors.length)) return res.status(400).json({ error: 'มีข้อมูลที่ไม่ถูกต้อง' });

  const ins = db.prepare('INSERT INTO product_groups (code, name, require_inspection_doc, require_lot_number, require_expiry_date, require_certificate) VALUES (?, ?, ?, ?, ?, ?)');
  const doImport = db.transaction(rows => {
    let n = 0;
    for (const r of rows) {
      const d = r._data;
      const res2 = ins.run(d.code, d.name, d.doc?1:0, d.lot?1:0, d.exp?1:0, d.cert?1:0);
      db.auditLog('product_groups', res2.lastInsertRowid, 'CREATE', null, { name: d.name, source: 'excel_import' }, req.user.id, req.ip);
      n++;
    }
    return n;
  });
  try { res.json({ success: true, imported: doImport(results) }); }
  catch (e) { res.status(e.message?.includes('UNIQUE') ? 400 : 500).json({ error: e.message?.includes('UNIQUE') ? 'รหัสหรือชื่อซ้ำ' : e.message }); }
});

router.get('/product-groups', auth, (req, res) => {
  const { all, page, limit: lim, q = '' } = req.query;
  const includeInactive = all === '1';
  if (page !== undefined) {
    const pg = Math.max(1, +page || 1);
    const perPage = Math.min(100, Math.max(1, +lim || 20));
    const offset = (pg - 1) * perPage;
    const activeCl = includeInactive ? '' : 'AND is_active = 1';
    const searchCl = q ? "AND (name LIKE ? OR COALESCE(code,'') LIKE ?)" : '';
    const sp = q ? [`%${q}%`, `%${q}%`] : [];
    const total = db.prepare(`SELECT COUNT(*) as c FROM product_groups WHERE 1=1 ${activeCl} ${searchCl}`).get(...sp);
    const rows = db.prepare(`SELECT * FROM product_groups WHERE 1=1 ${activeCl} ${searchCl} ORDER BY name LIMIT ? OFFSET ?`).all(...sp, perPage, offset);
    return res.json({ data: rows, total: total.c, page: pg, limit: perPage });
  }
  const rows = includeInactive
    ? db.prepare('SELECT * FROM product_groups ORDER BY name').all()
    : db.prepare('SELECT * FROM product_groups WHERE is_active = 1 ORDER BY name').all();
  res.json(rows);
});

router.post('/product-groups', ...adminOnly, (req, res) => {
  const { code, name, require_inspection_doc, require_lot_number, require_expiry_date, require_certificate, has_shelf_life, shelf_life_days } = req.body;
  if (!name) return res.status(400).json({ error: 'กรุณากรอกชื่อกลุ่มสินค้า' });
  try {
    const result = db.prepare(`INSERT INTO product_groups (code, name, require_inspection_doc, require_lot_number, require_expiry_date, require_certificate, has_shelf_life, shelf_life_days)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(code || null, name, require_inspection_doc ? 1 : 0, require_lot_number ? 1 : 0, require_expiry_date ? 1 : 0, require_certificate ? 1 : 0, has_shelf_life ? 1 : 0, shelf_life_days || null);
    res.json(db.prepare('SELECT * FROM product_groups WHERE id = ?').get(result.lastInsertRowid));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'รหัสกลุ่มสินค้าซ้ำ' });
    res.status(500).json({ error: e.message });
  }
});

router.patch('/product-groups/:id', ...adminOnly, (req, res) => {
  const { code, name, require_inspection_doc, require_lot_number, require_expiry_date, require_certificate, has_shelf_life, shelf_life_days } = req.body;
  if (!name) return res.status(400).json({ error: 'กรุณากรอกชื่อกลุ่มสินค้า' });
  try {
    db.prepare(`UPDATE product_groups SET code=?, name=?, require_inspection_doc=?, require_lot_number=?, require_expiry_date=?, require_certificate=?, has_shelf_life=?, shelf_life_days=? WHERE id=?`)
      .run(code || null, name, require_inspection_doc ? 1 : 0, require_lot_number ? 1 : 0, require_expiry_date ? 1 : 0, require_certificate ? 1 : 0, has_shelf_life ? 1 : 0, shelf_life_days || null, req.params.id);
    res.json(db.prepare('SELECT * FROM product_groups WHERE id = ?').get(req.params.id));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'รหัสกลุ่มสินค้าซ้ำ' });
    res.status(500).json({ error: e.message });
  }
});

router.patch('/product-groups/:id/toggle', ...adminOnly, (req, res) => {
  const row = db.prepare('SELECT is_active FROM product_groups WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
  db.prepare('UPDATE product_groups SET is_active = ? WHERE id = ?').run(row.is_active ? 0 : 1, req.params.id);
  res.json(db.prepare('SELECT * FROM product_groups WHERE id = ?').get(req.params.id));
});

// ===== UNITS =====
router.get('/units/export', ...adminOnly, async (req, res) => {
  const wb = new ExcelJS.Workbook(); wb.creator = 'IQC System';
  const ws = wb.addWorksheet('หน่วยนับ');
  ws.columns = [
    { header: 'ชื่อหน่วยนับ *', key: 'name', width: 24 },
    { header: 'ตัวย่อ',          key: 'abbr', width: 14 },
  ];
  styleExcelHeader(ws, 2);
  db.prepare('SELECT name, abbreviation FROM units ORDER BY name').all()
    .forEach(r => ws.addRow([r.name, r.abbreviation||'']));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''units_template.xlsx");
  await wb.xlsx.write(res); res.end();
});

router.post('/units/import', ...adminOnly, excelMemUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'กรุณาอัปโหลดไฟล์ .xlsx' });
  let wb; try { wb = await parseImportFile(req.file.buffer); } catch { return res.status(400).json({ error: 'ไฟล์ไม่ถูกต้อง' }); }
  const ws = wb.getWorksheet('หน่วยนับ') || wb.worksheets[0];
  if (!ws) return res.status(400).json({ error: 'ไม่พบ Sheet ในไฟล์' });

  const existingNames = new Set(db.prepare('SELECT LOWER(name) as n FROM units').all().map(r => r.n));
  const seenNames = new Set(), results = [];

  ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum === 1) return;
    const name = cellStr(row,1), abbr = cellStr(row,2);
    if (!name) return;
    const errors = [], warnings = [];
    if (existingNames.has(name.toLowerCase()))  warnings.push(`"${name}" มีอยู่แล้ว`);
    else if (seenNames.has(name.toLowerCase()))  warnings.push(`"${name}" ซ้ำในไฟล์`);
    else seenNames.add(name.toLowerCase());
    results.push({ ...makeResult(rowNum, { ชื่อหน่วยนับ: name, ตัวย่อ: abbr||'-' }, errors, warnings), _data: { name, abbr:abbr||null } });
  });

  if (!results.length) return res.status(400).json({ error: 'ไม่พบข้อมูลในไฟล์' });
  if (req.query.preview === '1') return res.json(importResponse(results));
  if (results.some(r => r.errors.length)) return res.status(400).json({ error: 'มีข้อมูลที่ไม่ถูกต้อง' });

  const ins = db.prepare('INSERT INTO units (name, abbreviation) VALUES (?, ?)');
  const doImport = db.transaction(rows => {
    let n = 0;
    for (const r of rows) {
      const res2 = ins.run(r._data.name, r._data.abbr);
      db.auditLog('units', res2.lastInsertRowid, 'CREATE', null, { name: r._data.name, source: 'excel_import' }, req.user.id, req.ip);
      n++;
    }
    return n;
  });
  try { res.json({ success: true, imported: doImport(results) }); }
  catch (e) { res.status(e.message?.includes('UNIQUE') ? 400 : 500).json({ error: e.message?.includes('UNIQUE') ? 'ชื่อหน่วยซ้ำ' : e.message }); }
});

router.get('/units', auth, (req, res) => {
  const { all, page, limit: lim, q = '' } = req.query;
  const includeInactive = all === '1';
  if (page !== undefined) {
    const pg = Math.max(1, +page || 1);
    const perPage = Math.min(100, Math.max(1, +lim || 20));
    const offset = (pg - 1) * perPage;
    const activeCl = includeInactive ? '' : 'AND is_active = 1';
    const searchCl = q ? 'AND name LIKE ?' : '';
    const sp = q ? [`%${q}%`] : [];
    const total = db.prepare(`SELECT COUNT(*) as c FROM units WHERE 1=1 ${activeCl} ${searchCl}`).get(...sp);
    const rows = db.prepare(`SELECT * FROM units WHERE 1=1 ${activeCl} ${searchCl} ORDER BY name LIMIT ? OFFSET ?`).all(...sp, perPage, offset);
    return res.json({ data: rows, total: total.c, page: pg, limit: perPage });
  }
  const rows = includeInactive
    ? db.prepare('SELECT * FROM units ORDER BY name').all()
    : db.prepare('SELECT * FROM units WHERE is_active = 1 ORDER BY name').all();
  res.json(rows);
});

router.post('/units', ...adminOnly, (req, res) => {
  const { name, abbreviation } = req.body;
  if (!name) return res.status(400).json({ error: 'กรุณากรอกชื่อหน่วยนับ' });
  const result = db.prepare('INSERT INTO units (name, abbreviation) VALUES (?, ?)').run(name, abbreviation || null);
  res.json(db.prepare('SELECT * FROM units WHERE id = ?').get(result.lastInsertRowid));
});

router.patch('/units/:id', ...adminOnly, (req, res) => {
  const { name, abbreviation } = req.body;
  if (!name) return res.status(400).json({ error: 'กรุณากรอกชื่อหน่วยนับ' });
  db.prepare('UPDATE units SET name=?, abbreviation=? WHERE id=?').run(name, abbreviation || null, req.params.id);
  res.json(db.prepare('SELECT * FROM units WHERE id = ?').get(req.params.id));
});

router.patch('/units/:id/toggle', ...adminOnly, (req, res) => {
  const row = db.prepare('SELECT is_active FROM units WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
  db.prepare('UPDATE units SET is_active = ? WHERE id = ?').run(row.is_active ? 0 : 1, req.params.id);
  res.json(db.prepare('SELECT * FROM units WHERE id = ?').get(req.params.id));
});

// ===== DEFECT CATEGORIES =====
router.get('/defect-categories/export', ...adminOnly, async (req, res) => {
  const wb = new ExcelJS.Workbook(); wb.creator = 'IQC System';
  const ws = wb.addWorksheet('กลุ่มปัญหา');
  ws.columns = [
    { header: 'รหัส',              key: 'code',  width: 14 },
    { header: 'ชื่อกลุ่มปัญหา *', key: 'name',  width: 30 },
    { header: 'หมายเหตุ',          key: 'notes', width: 36 },
  ];
  styleExcelHeader(ws, 3);
  db.prepare('SELECT code, name, notes FROM defect_categories ORDER BY name').all()
    .forEach(r => ws.addRow([r.code||'', r.name, r.notes||'']));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''defect_categories_template.xlsx");
  await wb.xlsx.write(res); res.end();
});

router.post('/defect-categories/import', ...adminOnly, excelMemUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'กรุณาอัปโหลดไฟล์ .xlsx' });
  let wb; try { wb = await parseImportFile(req.file.buffer); } catch { return res.status(400).json({ error: 'ไฟล์ไม่ถูกต้อง' }); }
  const ws = wb.getWorksheet('กลุ่มปัญหา') || wb.worksheets[0];
  if (!ws) return res.status(400).json({ error: 'ไม่พบ Sheet ในไฟล์' });

  const existingNames = new Set(db.prepare('SELECT LOWER(name) as n FROM defect_categories').all().map(r => r.n));
  const existingCodes = new Set(db.prepare('SELECT code FROM defect_categories WHERE code IS NOT NULL').all().map(r => r.code.toLowerCase()));
  const seenNames = new Set(), seenCodes = new Set(), results = [];

  ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum === 1) return;
    const code = cellStr(row,1), name = cellStr(row,2), notes = cellStr(row,3);
    if (!name && !code) return;
    const errors = [], warnings = [];
    if (!name) errors.push('ชื่อกลุ่มปัญหาห้ามว่าง');
    if (code) {
      if (existingCodes.has(code.toLowerCase()))  errors.push(`รหัส "${code}" มีอยู่แล้ว`);
      else if (seenCodes.has(code.toLowerCase()))  errors.push(`รหัส "${code}" ซ้ำในไฟล์`);
      else seenCodes.add(code.toLowerCase());
    }
    if (name) {
      if (existingNames.has(name.toLowerCase()))   warnings.push(`ชื่อ "${name}" มีอยู่แล้ว`);
      else if (seenNames.has(name.toLowerCase()))  warnings.push(`ชื่อ "${name}" ซ้ำในไฟล์`);
      else seenNames.add(name.toLowerCase());
    }
    results.push({ ...makeResult(rowNum, { รหัส: code||'-', ชื่อกลุ่มปัญหา: name, หมายเหตุ: notes||'-' }, errors, warnings), _data: { code:code||null, name, notes:notes||null } });
  });

  if (!results.length) return res.status(400).json({ error: 'ไม่พบข้อมูลในไฟล์' });
  if (req.query.preview === '1') return res.json(importResponse(results));
  if (results.some(r => r.errors.length)) return res.status(400).json({ error: 'มีข้อมูลที่ไม่ถูกต้อง' });

  const ins = db.prepare('INSERT INTO defect_categories (code, name, notes) VALUES (?, ?, ?)');
  const doImport = db.transaction(rows => {
    let n = 0;
    for (const r of rows) {
      const res2 = ins.run(r._data.code, r._data.name, r._data.notes);
      db.auditLog('defect_categories', res2.lastInsertRowid, 'CREATE', null, { name: r._data.name, source: 'excel_import' }, req.user.id, req.ip);
      n++;
    }
    return n;
  });
  try { res.json({ success: true, imported: doImport(results) }); }
  catch (e) { res.status(e.message?.includes('UNIQUE') ? 400 : 500).json({ error: e.message?.includes('UNIQUE') ? 'รหัสหรือชื่อซ้ำ' : e.message }); }
});

router.get('/defect-categories', auth, (req, res) => {
  const { all, page, limit: lim, q = '' } = req.query;
  const includeInactive = all === '1';
  if (page !== undefined) {
    const pg = Math.max(1, +page || 1);
    const perPage = Math.min(100, Math.max(1, +lim || 20));
    const offset = (pg - 1) * perPage;
    const activeCl = includeInactive ? '' : 'AND is_active = 1';
    const searchCl = q ? "AND (name LIKE ? OR COALESCE(code,'') LIKE ?)" : '';
    const sp = q ? [`%${q}%`, `%${q}%`] : [];
    const total = db.prepare(`SELECT COUNT(*) as c FROM defect_categories WHERE 1=1 ${activeCl} ${searchCl}`).get(...sp);
    const rows = db.prepare(`SELECT * FROM defect_categories WHERE 1=1 ${activeCl} ${searchCl} ORDER BY name LIMIT ? OFFSET ?`).all(...sp, perPage, offset);
    return res.json({ data: rows, total: total.c, page: pg, limit: perPage });
  }
  const rows = includeInactive
    ? db.prepare('SELECT * FROM defect_categories ORDER BY name').all()
    : db.prepare('SELECT * FROM defect_categories WHERE is_active = 1 ORDER BY name').all();
  res.json(rows);
});

router.post('/defect-categories', ...adminOnly, (req, res) => {
  const { code, name, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'กรุณากรอกชื่อกลุ่มปัญหา' });
  try {
    const result = db.prepare('INSERT INTO defect_categories (code, name, notes) VALUES (?, ?, ?)').run(code || null, name, notes || null);
    res.json(db.prepare('SELECT * FROM defect_categories WHERE id = ?').get(result.lastInsertRowid));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'รหัสกลุ่มปัญหาซ้ำ' });
    res.status(500).json({ error: e.message });
  }
});

router.patch('/defect-categories/:id', ...adminOnly, (req, res) => {
  const { code, name, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'กรุณากรอกชื่อกลุ่มปัญหา' });
  try {
    db.prepare('UPDATE defect_categories SET code=?, name=?, notes=? WHERE id=?').run(code || null, name, notes || null, req.params.id);
    res.json(db.prepare('SELECT * FROM defect_categories WHERE id = ?').get(req.params.id));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'รหัสกลุ่มปัญหาซ้ำ' });
    res.status(500).json({ error: e.message });
  }
});

router.patch('/defect-categories/:id/toggle', ...adminOnly, (req, res) => {
  const row = db.prepare('SELECT is_active FROM defect_categories WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
  db.prepare('UPDATE defect_categories SET is_active = ? WHERE id = ?').run(row.is_active ? 0 : 1, req.params.id);
  res.json(db.prepare('SELECT * FROM defect_categories WHERE id = ?').get(req.params.id));
});

// ===== COLORS =====
router.get('/colors/export', ...adminOnly, async (req, res) => {
  const wb = new ExcelJS.Workbook(); wb.creator = 'IQC System';
  const ws = wb.addWorksheet('สีสินค้า');
  ws.columns = [
    { header: 'รหัสสี',   key: 'code',    width: 14 },
    { header: 'ชื่อสี *', key: 'name',    width: 24 },
    { header: 'Hex Code', key: 'hex',     width: 14 },
  ];
  styleExcelHeader(ws, 3);
  db.prepare('SELECT code, name, hex_code FROM colors ORDER BY name').all()
    .forEach(r => ws.addRow([r.code||'', r.name, r.hex_code||'']));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''colors_template.xlsx");
  await wb.xlsx.write(res); res.end();
});

router.post('/colors/import', ...adminOnly, excelMemUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'กรุณาอัปโหลดไฟล์ .xlsx' });
  let wb; try { wb = await parseImportFile(req.file.buffer); } catch { return res.status(400).json({ error: 'ไฟล์ไม่ถูกต้อง' }); }
  const ws = wb.getWorksheet('สีสินค้า') || wb.worksheets[0];
  if (!ws) return res.status(400).json({ error: 'ไม่พบ Sheet ในไฟล์' });

  const existingNames = new Set(db.prepare('SELECT LOWER(name) as n FROM colors').all().map(r => r.n));
  const existingCodes = new Set(db.prepare('SELECT code FROM colors WHERE code IS NOT NULL').all().map(r => r.code.toLowerCase()));
  const seenNames = new Set(), seenCodes = new Set(), results = [];
  const hexRE = /^#[0-9A-Fa-f]{6}$/;

  ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum === 1) return;
    const code = cellStr(row,1), name = cellStr(row,2), hex = cellStr(row,3);
    if (!name && !code) return;
    const errors = [], warnings = [];
    if (!name) errors.push('ชื่อสีห้ามว่าง');
    if (hex && !hexRE.test(hex)) errors.push(`Hex Code "${hex}" ต้องอยู่ในรูปแบบ #RRGGBB`);
    if (code) {
      if (existingCodes.has(code.toLowerCase()))  errors.push(`รหัส "${code}" มีอยู่แล้ว`);
      else if (seenCodes.has(code.toLowerCase()))  errors.push(`รหัส "${code}" ซ้ำในไฟล์`);
      else seenCodes.add(code.toLowerCase());
    }
    if (name) {
      if (existingNames.has(name.toLowerCase()))   warnings.push(`ชื่อสี "${name}" มีอยู่แล้ว`);
      else if (seenNames.has(name.toLowerCase()))  warnings.push(`ชื่อสี "${name}" ซ้ำในไฟล์`);
      else seenNames.add(name.toLowerCase());
    }
    results.push({ ...makeResult(rowNum, { รหัสสี: code||'-', ชื่อสี: name, 'Hex Code': hex||'-' }, errors, warnings), _data: { code:code||null, name, hex:hex||null } });
  });

  if (!results.length) return res.status(400).json({ error: 'ไม่พบข้อมูลในไฟล์' });
  if (req.query.preview === '1') return res.json(importResponse(results));
  if (results.some(r => r.errors.length)) return res.status(400).json({ error: 'มีข้อมูลที่ไม่ถูกต้อง' });

  const ins = db.prepare('INSERT INTO colors (code, name, hex_code) VALUES (?, ?, ?)');
  const doImport = db.transaction(rows => {
    let n = 0;
    for (const r of rows) {
      const res2 = ins.run(r._data.code, r._data.name, r._data.hex);
      db.auditLog('colors', res2.lastInsertRowid, 'CREATE', null, { name: r._data.name, source: 'excel_import' }, req.user.id, req.ip);
      n++;
    }
    return n;
  });
  try { res.json({ success: true, imported: doImport(results) }); }
  catch (e) { res.status(e.message?.includes('UNIQUE') ? 400 : 500).json({ error: e.message?.includes('UNIQUE') ? 'รหัสหรือชื่อซ้ำ' : e.message }); }
});

router.get('/colors', auth, (req, res) => {
  const { all, page, limit: lim, q = '' } = req.query;
  const includeInactive = all === '1';
  if (page !== undefined) {
    const pg = Math.max(1, +page || 1);
    const perPage = Math.min(100, Math.max(1, +lim || 20));
    const offset = (pg - 1) * perPage;
    const activeCl = includeInactive ? '' : 'AND is_active = 1';
    const searchCl = q ? "AND (name LIKE ? OR COALESCE(code,'') LIKE ?)" : '';
    const sp = q ? [`%${q}%`, `%${q}%`] : [];
    const total = db.prepare(`SELECT COUNT(*) as c FROM colors WHERE 1=1 ${activeCl} ${searchCl}`).get(...sp);
    const rows = db.prepare(`SELECT * FROM colors WHERE 1=1 ${activeCl} ${searchCl} ORDER BY name LIMIT ? OFFSET ?`).all(...sp, perPage, offset);
    return res.json({ data: rows, total: total.c, page: pg, limit: perPage });
  }
  const rows = includeInactive
    ? db.prepare('SELECT * FROM colors ORDER BY name').all()
    : db.prepare('SELECT * FROM colors WHERE is_active = 1 ORDER BY name').all();
  res.json(rows);
});

router.post('/colors', ...adminOnly, (req, res) => {
  const { code, name, hex_code } = req.body;
  if (!name) return res.status(400).json({ error: 'กรุณากรอกชื่อสี' });
  try {
    const result = db.prepare('INSERT INTO colors (code, name, hex_code) VALUES (?, ?, ?)').run(code || null, name, hex_code || null);
    res.json(db.prepare('SELECT * FROM colors WHERE id = ?').get(result.lastInsertRowid));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'รหัสสีซ้ำ' });
    res.status(500).json({ error: e.message });
  }
});

router.patch('/colors/:id', ...adminOnly, (req, res) => {
  const { code, name, hex_code } = req.body;
  if (!name) return res.status(400).json({ error: 'กรุณากรอกชื่อสี' });
  try {
    db.prepare('UPDATE colors SET code=?, name=?, hex_code=? WHERE id=?').run(code || null, name, hex_code || null, req.params.id);
    res.json(db.prepare('SELECT * FROM colors WHERE id = ?').get(req.params.id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/colors/:id/toggle', ...adminOnly, (req, res) => {
  const row = db.prepare('SELECT is_active FROM colors WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
  db.prepare('UPDATE colors SET is_active = ? WHERE id = ?').run(row.is_active ? 0 : 1, req.params.id);
  res.json(db.prepare('SELECT * FROM colors WHERE id = ?').get(req.params.id));
});

// ===== MODELS =====
router.get('/models', auth, (req, res) => {
  const includeInactive = req.query.all === '1';
  const rows = includeInactive
    ? db.prepare('SELECT * FROM models ORDER BY name').all()
    : db.prepare('SELECT * FROM models WHERE is_active = 1 ORDER BY name').all();
  res.json(rows);
});

router.post('/models', ...adminOnly, (req, res) => {
  const { code, name } = req.body;
  if (!name) return res.status(400).json({ error: 'กรุณากรอกชื่อรุ่น' });
  try {
    const result = db.prepare('INSERT INTO models (code, name) VALUES (?, ?)').run(code || null, name);
    res.json(db.prepare('SELECT * FROM models WHERE id = ?').get(result.lastInsertRowid));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'รหัสรุ่นซ้ำ' });
    res.status(500).json({ error: e.message });
  }
});

router.patch('/models/:id', ...adminOnly, (req, res) => {
  const { code, name } = req.body;
  if (!name) return res.status(400).json({ error: 'กรุณากรอกชื่อรุ่น' });
  try {
    db.prepare('UPDATE models SET code=?, name=? WHERE id=?').run(code || null, name, req.params.id);
    res.json(db.prepare('SELECT * FROM models WHERE id = ?').get(req.params.id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/models/:id/toggle', ...adminOnly, (req, res) => {
  const row = db.prepare('SELECT is_active FROM models WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
  db.prepare('UPDATE models SET is_active = ? WHERE id = ?').run(row.is_active ? 0 : 1, req.params.id);
  res.json(db.prepare('SELECT * FROM models WHERE id = ?').get(req.params.id));
});

// ===== AQL TABLES =====
router.get('/aql', auth, (req, res) => {
  const includeInactive = req.query.all === '1';
  const rows = includeInactive
    ? db.prepare('SELECT * FROM aql_tables ORDER BY inspection_level, aql_value, batch_from').all()
    : db.prepare('SELECT * FROM aql_tables WHERE is_active = 1 ORDER BY inspection_level, aql_value, batch_from').all();
  res.json(rows);
});

router.post('/aql', ...adminOnly, (req, res) => {
  const { inspection_level, aql_value, batch_from, batch_to, sample_size, accept_number, reject_number } = req.body;
  if (!inspection_level || batch_from === undefined) return res.status(400).json({ error: 'กรุณากรอก inspection_level และ batch_from' });
  const result = db.prepare(`INSERT INTO aql_tables (inspection_level, aql_value, batch_from, batch_to, sample_size, accept_number, reject_number)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(inspection_level, aql_value || null, batch_from, batch_to || null, sample_size || null, accept_number || null, reject_number || null);
  res.json(db.prepare('SELECT * FROM aql_tables WHERE id = ?').get(result.lastInsertRowid));
});

router.patch('/aql/:id', ...adminOnly, (req, res) => {
  const { inspection_level, aql_value, batch_from, batch_to, sample_size, accept_number, reject_number } = req.body;
  db.prepare(`UPDATE aql_tables SET inspection_level=?, aql_value=?, batch_from=?, batch_to=?, sample_size=?, accept_number=?, reject_number=? WHERE id=?`)
    .run(inspection_level, aql_value || null, batch_from, batch_to || null, sample_size || null, accept_number || null, reject_number || null, req.params.id);
  res.json(db.prepare('SELECT * FROM aql_tables WHERE id = ?').get(req.params.id));
});

router.patch('/aql/:id/toggle', ...adminOnly, (req, res) => {
  const row = db.prepare('SELECT is_active FROM aql_tables WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
  db.prepare('UPDATE aql_tables SET is_active = ? WHERE id = ?').run(row.is_active ? 0 : 1, req.params.id);
  res.json(db.prepare('SELECT * FROM aql_tables WHERE id = ?').get(req.params.id));
});

// AQL Lookup — auto-detect sample size by qty + product
router.get('/aql/lookup', auth, (req, res) => {
  const { qty, product_id } = req.query;
  if (!qty) return res.status(400).json({ error: 'กรุณาระบุ qty' });

  let inspection_level = 'GEN_II';
  let aql_value = '2.5';

  if (product_id) {
    const product = db.prepare('SELECT inspection_level, aql_value FROM products WHERE id = ?').get(product_id);
    if (product) {
      inspection_level = product.inspection_level || 'GEN_II';
      aql_value = product.aql_value || '2.5';
    }
  }

  // FULL inspection
  if (inspection_level === 'FULL') {
    return res.json({ sample_size: Number(qty), accept_number: 0, reject_number: 1, is_full_inspection: true });
  }

  const row = db.prepare(`
    SELECT * FROM aql_tables
    WHERE inspection_level = ? AND (aql_value = ? OR aql_value IS NULL)
      AND batch_from <= ?
      AND (batch_to IS NULL OR batch_to >= ?)
      AND is_active = 1
    ORDER BY batch_from DESC LIMIT 1
  `).get(inspection_level, aql_value, qty, qty);

  if (!row) return res.json({ sample_size: null, accept_number: null, reject_number: null, is_full_inspection: false });
  res.json({ sample_size: row.sample_size, accept_number: row.accept_number, reject_number: row.reject_number, is_full_inspection: false });
});

// ===== PRODUCTS =====
const suppliersOfProduct = db.prepare(`
  SELECT ps.supplier_id, s.name as supplier_name
  FROM product_suppliers ps JOIN suppliers s ON s.id = ps.supplier_id
  WHERE ps.product_id = ? ORDER BY s.name
`);

router.get('/products/export', ...adminOnly, async (req, res) => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'IQC System';

  // ── โหลด reference data ก่อน เพื่อรู้จำนวน row สำหรับ dropdown range ──
  const suppliers = db.prepare('SELECT name FROM suppliers WHERE is_active=1 ORDER BY name').all();
  const groups    = db.prepare('SELECT name FROM product_groups ORDER BY name').all();
  const units     = db.prepare('SELECT name, abbreviation FROM units WHERE is_active=1 ORDER BY name').all();

  // ── Sheet 2: Reference (columnar — แต่ละ column = 1 ประเภท dropdown) ──
  // Supplier=A, กลุ่ม=B, หน่วย=C, InspLevel=D, AQL=E
  const wsRef = wb.addWorksheet('Reference');
  wsRef.columns = [
    { header: 'ชื่อ Supplier',   key: 'sup',  width: 30 },
    { header: 'กลุ่มสินค้า',     key: 'grp',  width: 25 },
    { header: 'หน่วยนับ',        key: 'unt',  width: 18 },
    { header: 'ตัวย่อหน่วย',     key: 'abbr', width: 12 },
    { header: 'Inspection Level', key: 'insp', width: 18 },
    { header: 'คำอธิบาย Insp',   key: 'idesc',width: 30 },
    { header: 'AQL Value',       key: 'aql',  width: 12 },
    { header: 'คำอธิบาย AQL',    key: 'adesc',width: 25 },
  ];
  wsRef.getRow(1).eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E6DA4' } };
    cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
    cell.alignment = { horizontal: 'center' };
  });
  wsRef.getRow(1).height = 24;

  const INSP = [
    ['GEN_I',   'General I'],
    ['GEN_II',  'General II (มาตรฐาน)'],
    ['GEN_III', 'General III (เข้มงวด)'],
    ['S1',      'Special S-1'],
    ['S2',      'Special S-2'],
    ['S3',      'Special S-3'],
    ['S4',      'Special S-4'],
    ['FULL',    'ตรวจ 100%'],
  ];
  const AQL_REF = [
    ['0.65', 'เข้มงวดมาก'],
    ['1.0',  ''],
    ['1.5',  ''],
    ['2.5',  'มาตรฐาน'],
    ['4.0',  ''],
    ['6.5',  'ผ่อนปรน'],
  ];

  const maxRef = Math.max(suppliers.length, groups.length, units.length, INSP.length, AQL_REF.length);
  for (let i = 0; i < maxRef; i++) {
    wsRef.addRow([
      suppliers[i]?.name  ?? '',
      groups[i]?.name     ?? '',
      units[i]?.name      ?? '',
      units[i]?.abbreviation ?? '',
      INSP[i]?.[0]        ?? '',
      INSP[i]?.[1]        ?? '',
      AQL_REF[i]?.[0]     ?? '',
      AQL_REF[i]?.[1]     ?? '',
    ]);
  }

  // ── Sheet 1: สินค้า ───────────────────────────────────────────────────────
  const ws = wb.addWorksheet('สินค้า');
  ws.columns = [
    { header: 'รหัสสินค้า',       key: 'code',  width: 16 },
    { header: 'ชื่อสินค้า *',     key: 'name',  width: 32 },
    { header: 'ชื่อ Supplier *',  key: 'sup',   width: 26 },
    { header: 'กลุ่มสินค้า *',    key: 'grp',   width: 22 },
    { header: 'หน่วยนับ *',       key: 'unt',   width: 16 },
    { header: 'Inspection Level', key: 'insp',  width: 20 },
    { header: 'AQL Value',        key: 'aql',   width: 12 },
    { header: 'หมายเหตุ',         key: 'notes', width: 32 },
  ];
  const hRow = ws.getRow(1);
  hRow.height = 28;
  hRow.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3A5C' } };
    cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 11 };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  // เติมข้อมูลสินค้าที่มีอยู่
  const products = db.prepare(`
    SELECT p.code, p.name, p.inspection_level, p.aql_value, p.notes,
           s.name as supplier_name, pg.name as product_group_name, u.name as unit_name
    FROM products p
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    LEFT JOIN product_groups pg ON pg.id = p.product_group_id
    LEFT JOIN units u ON u.id = p.unit_id
    ORDER BY p.name
  `).all();
  for (const p of products) {
    ws.addRow([
      p.code||'', p.name,
      p.supplier_name||'', p.product_group_name||'', p.unit_name||'',
      p.inspection_level||'GEN_II', p.aql_value||'2.5', p.notes||'',
    ]);
  }

  // ── Dropdown validation (rows 2–500) ─────────────────────────────────────
  const MAX_ROWS = 500;
  const supEnd  = suppliers.length + 1;  // row 1 = header ใน Reference
  const grpEnd  = groups.length + 1;
  const untEnd  = units.length + 1;
  const inspEnd = INSP.length + 1;
  const aqlEnd  = AQL_REF.length + 1;

  // formula สำหรับ cross-sheet reference (ไม่ใส่ quote รอบ range)
  const dvSup  = { type: 'list', allowBlank: true, showErrorMessage: true, errorStyle: 'warning',
                   errorTitle: 'ชื่อ Supplier', error: 'กรุณาเลือกจากรายการใน Reference',
                   formulae: [`Reference!$A$2:$A$${supEnd}`] };
  const dvGrp  = { type: 'list', allowBlank: true, showErrorMessage: true, errorStyle: 'warning',
                   errorTitle: 'กลุ่มสินค้า',  error: 'กรุณาเลือกจากรายการใน Reference',
                   formulae: [`Reference!$B$2:$B$${grpEnd}`] };
  const dvUnt  = { type: 'list', allowBlank: true, showErrorMessage: true, errorStyle: 'warning',
                   errorTitle: 'หน่วยนับ',      error: 'กรุณาเลือกจากรายการใน Reference',
                   formulae: [`Reference!$C$2:$C$${untEnd}`] };
  const dvInsp = { type: 'list', allowBlank: true, showErrorMessage: true, errorStyle: 'warning',
                   errorTitle: 'Inspection Level', error: 'กรุณาเลือกจากรายการใน Reference',
                   formulae: [`Reference!$E$2:$E$${inspEnd}`] };
  const dvAql  = { type: 'list', allowBlank: true, showErrorMessage: true, errorStyle: 'warning',
                   errorTitle: 'AQL Value',    error: 'กรุณาเลือกจากรายการใน Reference',
                   formulae: [`Reference!$G$2:$G$${aqlEnd}`] };

  for (let r = 2; r <= MAX_ROWS; r++) {
    ws.getCell(r, 3).dataValidation = dvSup;
    ws.getCell(r, 4).dataValidation = dvGrp;
    ws.getCell(r, 5).dataValidation = dvUnt;
    ws.getCell(r, 6).dataValidation = dvInsp;
    ws.getCell(r, 7).dataValidation = dvAql;
  }

  // เปิด sheet สินค้าเป็น default (ย้ายมาก่อน Reference)
  wb.views = [{ firstSheet: 0, activeTab: 0 }];

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''products_template.xlsx");
  await wb.xlsx.write(res);
  res.end();
});

router.post('/products/import', ...adminOnly, excelMemUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'กรุณาอัปโหลดไฟล์ .xlsx' });

  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(req.file.buffer); }
  catch { return res.status(400).json({ error: 'ไฟล์ Excel ไม่ถูกต้อง หรือไม่ใช่ไฟล์ .xlsx' }); }

  const ws = wb.getWorksheet('สินค้า') || wb.worksheets[0];
  if (!ws) return res.status(400).json({ error: 'ไม่พบ Sheet ในไฟล์' });

  // Build lookup maps (case-insensitive)
  const supplierMap = Object.fromEntries(
    db.prepare('SELECT name, id FROM suppliers WHERE is_active=1').all()
      .map(s => [s.name.trim().toLowerCase(), s.id])
  );
  const groupMap = Object.fromEntries(
    db.prepare('SELECT name, id FROM product_groups').all()
      .map(g => [g.name.trim().toLowerCase(), g.id])
  );
  const unitMap = Object.fromEntries(
    db.prepare('SELECT name, id FROM units WHERE is_active=1').all()
      .map(u => [u.name.trim().toLowerCase(), u.id])
  );
  const existingCodes = new Set(
    db.prepare('SELECT code FROM products WHERE code IS NOT NULL').all()
      .map(p => p.code.trim().toLowerCase())
  );
  const existingNames = new Set(
    db.prepare('SELECT LOWER(name) as n FROM products').all().map(p => p.n)
  );

  const results = [];
  const seenCodes = new Set();
  const seenNames = new Set();

  ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum === 1) return; // skip header
    const cellStr = n => String(row.getCell(n).value ?? '').trim();
    const code        = cellStr(1);
    const name        = cellStr(2);
    const supplierName = cellStr(3);
    const groupName   = cellStr(4);
    const unitName    = cellStr(5);
    let   inspLevel   = cellStr(6) || 'GEN_II';
    let   aqlValue    = cellStr(7) || '2.5';
    const notes       = cellStr(8);

    if (!name && !supplierName && !groupName && !code) return; // blank row

    const errors = [], warnings = [];

    if (!name) errors.push('ชื่อสินค้าห้ามว่าง');

    let supplierId = null;
    if (!supplierName) errors.push('ชื่อ Supplier ห้ามว่าง');
    else {
      supplierId = supplierMap[supplierName.toLowerCase()];
      if (!supplierId) errors.push(`ไม่พบ Supplier "${supplierName}" ในระบบ`);
    }

    let groupId = null;
    if (!groupName) errors.push('กลุ่มสินค้าห้ามว่าง');
    else {
      groupId = groupMap[groupName.toLowerCase()];
      if (!groupId) errors.push(`ไม่พบกลุ่มสินค้า "${groupName}" ในระบบ`);
    }

    let unitId = null;
    if (!unitName) errors.push('หน่วยนับห้ามว่าง');
    else {
      unitId = unitMap[unitName.toLowerCase()];
      if (!unitId) errors.push(`ไม่พบหน่วยนับ "${unitName}" ในระบบ`);
    }

    if (!VALID_INSP_LEVELS.has(inspLevel)) {
      warnings.push(`Inspection Level "${inspLevel}" ไม่ถูกต้อง → ใช้ GEN_II แทน`);
      inspLevel = 'GEN_II';
    }
    if (inspLevel !== 'FULL' && !VALID_AQL.has(aqlValue)) {
      warnings.push(`AQL Value "${aqlValue}" ไม่ถูกต้อง → ใช้ 2.5 แทน`);
      aqlValue = '2.5';
    }

    if (code) {
      if (existingCodes.has(code.toLowerCase()))    errors.push(`รหัส "${code}" มีอยู่ในระบบแล้ว`);
      else if (seenCodes.has(code.toLowerCase()))   errors.push(`รหัส "${code}" ซ้ำกันในไฟล์`);
      else seenCodes.add(code.toLowerCase());
    }
    if (name) {
      if (existingNames.has(name.toLowerCase()))    warnings.push(`ชื่อ "${name}" มีอยู่ในระบบแล้ว (อาจซ้ำ)`);
      else if (seenNames.has(name.toLowerCase()))   warnings.push(`ชื่อ "${name}" ซ้ำกันในไฟล์`);
      else seenNames.add(name.toLowerCase());
    }

    results.push({
      row: rowNum, code: code||null, name, supplierName, groupName, unitName,
      inspLevel, aqlValue, notes: notes||null,
      supplierId, groupId, unitId, errors, warnings,
      status: errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'ok',
    });
  });

  if (results.length === 0) {
    return res.status(400).json({ error: 'ไม่พบข้อมูลในไฟล์ — ตรวจสอบว่า Sheet ชื่อ "สินค้า" และมีข้อมูลแถวที่ 2 เป็นต้นไป' });
  }

  // Preview mode — return validation results without importing
  if (req.query.preview === '1') {
    return res.json({
      results,
      total:        results.length,
      errorCount:   results.filter(r => r.status === 'error').length,
      warningCount: results.filter(r => r.status === 'warning').length,
    });
  }

  const hasErrors = results.some(r => r.errors.length > 0);
  if (hasErrors) return res.status(400).json({ error: 'มีข้อมูลที่ไม่ถูกต้อง กรุณาแก้ไขก่อน Import' });

  const insertProduct = db.prepare(`
    INSERT INTO products (code, name, supplier_id, product_group_id, unit_id, inspection_level, aql_value, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertPS = db.prepare('INSERT OR IGNORE INTO product_suppliers (product_id, supplier_id) VALUES (?, ?)');

  const doImport = db.transaction((rows) => {
    let count = 0;
    for (const r of rows) {
      const ins = insertProduct.run(r.code, r.name, r.supplierId, r.groupId, r.unitId, r.inspLevel, r.aqlValue, r.notes);
      insertPS.run(ins.lastInsertRowid, r.supplierId);
      db.auditLog('products', ins.lastInsertRowid, 'CREATE', null, { code: r.code, name: r.name, source: 'excel_import' }, req.user.id, req.ip);
      count++;
    }
    return count;
  });

  try {
    const imported = doImport(results);
    res.json({ success: true, imported });
  } catch (e) {
    if (e.message?.includes('UNIQUE')) return res.status(400).json({ error: 'รหัสสินค้าซ้ำ — กรุณาตรวจสอบอีกครั้ง' });
    res.status(500).json({ error: e.message });
  }
});

function attachProductSubqueries(rows) {
  if (!rows.length) return;
  const ids = rows.map(r => r.id);
  const ph = ids.map(() => '?').join(',');
  const bySuppliers = {}, byColors = {}, byDrawing = {}, byImg = {};
  for (const r of db.prepare(`SELECT ps.product_id, ps.supplier_id, s.name as supplier_name FROM product_suppliers ps JOIN suppliers s ON s.id = ps.supplier_id WHERE ps.product_id IN (${ph}) ORDER BY s.name`).all(...ids)) {
    (bySuppliers[r.product_id] = bySuppliers[r.product_id] || []).push({ supplier_id: r.supplier_id, supplier_name: r.supplier_name });
  }
  for (const r of db.prepare(`SELECT pc.product_id, c.* FROM colors c JOIN product_colors pc ON pc.color_id = c.id WHERE pc.product_id IN (${ph})`).all(...ids)) {
    const pid = r.product_id; delete r.product_id;
    (byColors[pid] = byColors[pid] || []).push(r);
  }
  for (const r of db.prepare(`SELECT * FROM product_drawings WHERE is_current = 1 AND product_id IN (${ph})`).all(...ids)) {
    byDrawing[r.product_id] = r;
  }
  for (const r of db.prepare(`SELECT product_id, image_type, COUNT(*) as c FROM product_images WHERE product_id IN (${ph}) GROUP BY product_id, image_type`).all(...ids)) {
    (byImg[r.product_id] = byImg[r.product_id] || {})[r.image_type] = r.c;
  }
  for (const row of rows) {
    row.suppliers = bySuppliers[row.id] || [];
    row.supplier_ids = row.suppliers.map(s => s.supplier_id);
    row.colors = byColors[row.id] || [];
    row.current_drawing = byDrawing[row.id] || undefined;
    row.product_img_count = byImg[row.id]?.product || 0;
    row.quality_img_count = byImg[row.id]?.quality_issue || 0;
  }
}

router.get('/products', auth, (req, res) => {
  const { supplier_id, all, page, limit: lim, q = '' } = req.query;

  const conditions = ['1=1'];
  const params = [];
  if (all !== '1') conditions.push('p.is_active = 1');
  if (supplier_id) {
    conditions.push('p.id IN (SELECT product_id FROM product_suppliers WHERE supplier_id = ?)');
    params.push(supplier_id);
  }
  if (q) {
    conditions.push("(p.name LIKE ? OR COALESCE(p.code,'') LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }
  const whereClause = 'WHERE ' + conditions.join(' AND ');

  const selectFrom = `
    SELECT p.*, s.name as supplier_name, pg.name as product_group_name,
           pg.require_inspection_doc, pg.require_lot_number, pg.require_expiry_date, pg.require_certificate,
           u.name as unit_name, u.abbreviation as unit_abbreviation, m.name as model_name
    FROM products p
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    LEFT JOIN product_groups pg ON pg.id = p.product_group_id
    LEFT JOIN units u ON u.id = p.unit_id
    LEFT JOIN models m ON m.id = p.model_id
    ${whereClause} ORDER BY p.name
  `;

  if (page !== undefined) {
    const pg = Math.max(1, +page || 1);
    const perPage = Math.min(100, Math.max(1, +lim || 20));
    const offset = (pg - 1) * perPage;
    const total = db.prepare(`SELECT COUNT(*) as c FROM products p ${whereClause}`).get(...params);
    const rows = db.prepare(selectFrom + ' LIMIT ? OFFSET ?').all(...params, perPage, offset);
    attachProductSubqueries(rows);
    return res.json({ data: rows, total: total.c, page: pg, limit: perPage });
  }

  const rows = db.prepare(selectFrom).all(...params);
  attachProductSubqueries(rows);
  res.json(rows);
});

router.post('/products', ...adminOnly, (req, res) => {
  const { code, name, supplier_ids, product_group_id, unit_id, model_id, inspection_level, aql_value, notes, color_ids } = req.body;
  const primarySupplierId = Array.isArray(supplier_ids) && supplier_ids.length > 0 ? supplier_ids[0] : null;
  if (!name || !primarySupplierId || !product_group_id || !unit_id) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลที่จำเป็น (ชื่อสินค้า, Supplier อย่างน้อย 1, กลุ่มสินค้า, หน่วยนับ)' });
  }
  try {
    const create = db.transaction(() => {
      const result = db.prepare(`INSERT INTO products (code, name, supplier_id, product_group_id, unit_id, model_id, inspection_level, aql_value, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(code || null, name, primarySupplierId, product_group_id, unit_id, model_id || null, inspection_level || 'GEN_II', aql_value || '2.5', notes || null);

      const insSupplier = db.prepare('INSERT OR IGNORE INTO product_suppliers (product_id, supplier_id) VALUES (?, ?)');
      for (const sid of supplier_ids) insSupplier.run(result.lastInsertRowid, sid);

      if (Array.isArray(color_ids)) {
        const insColor = db.prepare('INSERT OR IGNORE INTO product_colors (product_id, color_id) VALUES (?, ?)');
        for (const cid of color_ids) insColor.run(result.lastInsertRowid, cid);
      }
      return result.lastInsertRowid;
    });

    const id = create();
    res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'รหัสสินค้าซ้ำ' });
    res.status(500).json({ error: e.message });
  }
});

router.patch('/products/:id', ...adminOnly, (req, res) => {
  const { code, name, supplier_ids, product_group_id, unit_id, model_id, inspection_level, aql_value, notes, color_ids } = req.body;
  const primarySupplierId = Array.isArray(supplier_ids) && supplier_ids.length > 0 ? supplier_ids[0] : null;
  if (!name || !primarySupplierId || !product_group_id || !unit_id) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลที่จำเป็น' });
  }
  try {
    const upd = db.transaction(() => {
      db.prepare(`UPDATE products SET code=?, name=?, supplier_id=?, product_group_id=?, unit_id=?, model_id=?, inspection_level=?, aql_value=?, notes=? WHERE id=?`)
        .run(code || null, name, primarySupplierId, product_group_id, unit_id, model_id || null, inspection_level || 'GEN_II', aql_value || '2.5', notes || null, req.params.id);

      db.prepare('DELETE FROM product_suppliers WHERE product_id = ?').run(req.params.id);
      const insSupplier = db.prepare('INSERT OR IGNORE INTO product_suppliers (product_id, supplier_id) VALUES (?, ?)');
      for (const sid of supplier_ids) insSupplier.run(req.params.id, sid);

      if (Array.isArray(color_ids)) {
        db.prepare('DELETE FROM product_colors WHERE product_id = ?').run(req.params.id);
        const insColor = db.prepare('INSERT OR IGNORE INTO product_colors (product_id, color_id) VALUES (?, ?)');
        for (const cid of color_ids) insColor.run(req.params.id, cid);
      }
    });
    upd();
    res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'รหัสสินค้าซ้ำ' });
    res.status(500).json({ error: e.message });
  }
});

router.patch('/products/:id/toggle', ...adminOnly, (req, res) => {
  const row = db.prepare('SELECT is_active FROM products WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
  db.prepare('UPDATE products SET is_active = ? WHERE id = ?').run(row.is_active ? 0 : 1, req.params.id);
  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id));
});

// Product Images
router.post('/products/:id/images', ...adminOnly, uploads.general.array('images', 10), uploads.verifyMagic, (req, res) => {
  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'ไม่พบสินค้า' });
  const rawType = req.query.image_type || req.body.image_type;
  const imageType = ['product', 'quality_issue'].includes(rawType) ? rawType : 'product';
  const ins = db.prepare('INSERT INTO product_images (product_id, file_path, original_name, image_type) VALUES (?, ?, ?, ?)');
  for (const file of req.files || []) {
    ins.run(req.params.id, file.filename, file.originalname, imageType);
  }
  res.json(db.prepare('SELECT * FROM product_images WHERE product_id = ? ORDER BY image_type, sort_order, uploaded_at').all(req.params.id));
});

router.get('/products/:id/images', auth, (req, res) => {
  const { image_type } = req.query;
  let sql = 'SELECT * FROM product_images WHERE product_id = ?';
  const params = [req.params.id];
  if (image_type) { sql += ' AND image_type = ?'; params.push(image_type); }
  sql += ' ORDER BY sort_order, uploaded_at';
  res.json(db.prepare(sql).all(...params));
});

router.delete('/products/:id/images/:imageId', ...adminOnly, (req, res) => {
  const img = db.prepare('SELECT * FROM product_images WHERE id = ? AND product_id = ?').get(req.params.imageId, req.params.id);
  if (!img) return res.status(404).json({ error: 'ไม่พบรูปภาพ' });
  const filePath = path.join(__dirname, '../../uploads/general', img.file_path);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  db.prepare('DELETE FROM product_images WHERE id = ?').run(req.params.imageId);
  res.json({ ok: true });
});

// Product Drawings (Revision Control)
router.get('/products/:id/drawings', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM product_drawings WHERE product_id = ? ORDER BY created_at DESC').all(req.params.id));
});

router.post('/products/:id/drawings', ...adminOnly, uploads.drawings.single('drawing'), uploads.verifyMagic, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'กรุณาอัปโหลดไฟล์ PDF' });
  const { revision, effective_date, change_description } = req.body;
  if (!revision || !effective_date) return res.status(400).json({ error: 'กรุณากรอก revision และ effective_date' });

  const create = db.transaction(() => {
    // Obsolete old current revision
    db.prepare(`UPDATE product_drawings SET is_current=0, obsoleted_at=CURRENT_TIMESTAMP WHERE product_id=? AND is_current=1`).run(req.params.id);
    // Create new
    const result = db.prepare(`INSERT INTO product_drawings (product_id, revision, file_path, original_name, effective_date, change_description, is_current, created_by)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)`).run(req.params.id, revision, req.file.filename, req.file.originalname, effective_date, change_description || null, req.user.id);
    return result.lastInsertRowid;
  });

  const id = create();
  res.json(db.prepare('SELECT * FROM product_drawings WHERE id = ?').get(id));
});

router.get('/products/:id/drawings/current', auth, (req, res) => {
  const row = db.prepare('SELECT * FROM product_drawings WHERE product_id = ? AND is_current = 1').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'ไม่มี Drawing ปัจจุบัน' });

  const filePath = path.join(__dirname, '../../uploads/drawings', row.file_path);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'ไม่พบไฟล์' });
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(row.original_name)}"`);
  res.setHeader('Content-Type', 'application/pdf');
  res.sendFile(filePath);
});

router.get('/products/:id/drawings/:drawingId', auth, (req, res) => {
  const row = db.prepare('SELECT * FROM product_drawings WHERE id = ? AND product_id = ?').get(req.params.drawingId, req.params.id);
  if (!row) return res.status(404).json({ error: 'ไม่พบ Drawing' });
  const filePath = path.join(__dirname, '../../uploads/drawings', row.file_path);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'ไม่พบไฟล์' });
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(row.original_name)}"`);
  res.setHeader('Content-Type', 'application/pdf');
  res.sendFile(filePath);
});

// Legacy drawing endpoints (backward compat)
router.post('/products/:id/drawing', ...adminOnly, uploads.drawings.single('drawing'), uploads.verifyMagic, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'กรุณาอัปโหลดไฟล์ PDF เท่านั้น' });
  const { revision, effective_date } = req.body;

  const create = db.transaction(() => {
    db.prepare(`UPDATE product_drawings SET is_current=0, obsoleted_at=CURRENT_TIMESTAMP WHERE product_id=? AND is_current=1`).run(req.params.id);
    const result = db.prepare(`INSERT INTO product_drawings (product_id, revision, file_path, original_name, effective_date, is_current, created_by)
      VALUES (?, ?, ?, ?, ?, 1, ?)`).run(req.params.id, revision || 'Rev.A', req.file.filename, req.file.originalname, effective_date || new Date().toISOString().slice(0, 10), req.user.id);
    return result.lastInsertRowid;
  });

  create();
  res.json({ ok: true, filename: req.file.filename, original_name: req.file.originalname });
});

router.get('/products/:id/drawing', auth, (req, res) => {
  const row = db.prepare('SELECT * FROM product_drawings WHERE product_id = ? AND is_current = 1').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'ไม่มีไฟล์ Drawing' });
  const filePath = path.join(__dirname, '../../uploads/drawings', row.file_path);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'ไม่พบไฟล์' });
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(row.original_name)}"`);
  res.setHeader('Content-Type', 'application/pdf');
  res.sendFile(filePath);
});

router.delete('/products/:id/drawing', ...adminOnly, (req, res) => {
  const row = db.prepare('SELECT * FROM product_drawings WHERE product_id = ? AND is_current = 1').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'ไม่มีไฟล์ Drawing' });
  const filePath = path.join(__dirname, '../../uploads/drawings', row.file_path);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  db.prepare('UPDATE product_drawings SET is_current=0, obsoleted_at=CURRENT_TIMESTAMP WHERE id=?').run(row.id);
  res.json({ ok: true });
});

// ===== MEASURING EQUIPMENT (ISO 9001 ข้อ 7.1.5) =====
router.get('/equipment', auth, (req, res) => {
  const includeInactive = req.query.all === '1';
  const today = new Date().toISOString().slice(0, 10);
  let query = `
    SELECT e.*,
      date(e.last_calibrated_date, '+' || e.calibration_interval_days || ' days') as next_calibration_date,
      CASE
        WHEN e.last_calibrated_date IS NULL THEN 'overdue'
        WHEN date(e.last_calibrated_date, '+' || e.calibration_interval_days || ' days') < '${today}' THEN 'overdue'
        WHEN date(e.last_calibrated_date, '+' || e.calibration_interval_days || ' days') <= date('${today}', '+30 days') THEN 'due_soon'
        ELSE 'ok'
      END as calibration_status
    FROM measuring_equipment e
    WHERE 1=1
  `;
  if (!includeInactive) query += ' AND e.is_active = 1';
  query += ' ORDER BY e.equipment_code';
  res.json(db.prepare(query).all());
});

router.post('/equipment', ...adminOrQCManager, (req, res) => {
  const { equipment_code, name, serial_number, location, calibration_interval_days, last_calibrated_date, calibrated_by } = req.body;
  if (!equipment_code || !name || !calibration_interval_days) return res.status(400).json({ error: 'กรุณากรอกรหัส, ชื่อ และความถี่ calibrate' });
  try {
    const result = db.prepare(`INSERT INTO measuring_equipment (equipment_code, name, serial_number, location, calibration_interval_days, last_calibrated_date, calibrated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(equipment_code, name, serial_number || null, location || null, calibration_interval_days, last_calibrated_date || null, calibrated_by || null);
    res.json(db.prepare('SELECT * FROM measuring_equipment WHERE id = ?').get(result.lastInsertRowid));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'รหัสเครื่องมือซ้ำ' });
    res.status(500).json({ error: e.message });
  }
});

router.patch('/equipment/:id', ...adminOrQCManager, (req, res) => {
  const { name, serial_number, location, calibration_interval_days, status } = req.body;
  const eq = db.prepare('SELECT * FROM measuring_equipment WHERE id = ?').get(req.params.id);
  if (!eq) return res.status(404).json({ error: 'ไม่พบเครื่องมือ' });
  db.prepare(`UPDATE measuring_equipment SET name=COALESCE(?,name), serial_number=COALESCE(?,serial_number), location=COALESCE(?,location), calibration_interval_days=COALESCE(?,calibration_interval_days), status=COALESCE(?,status) WHERE id=?`)
    .run(name || null, serial_number || null, location || null, calibration_interval_days || null, status || null, req.params.id);
  res.json(db.prepare('SELECT * FROM measuring_equipment WHERE id = ?').get(req.params.id));
});

router.get('/equipment/overdue', auth, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const rows = db.prepare(`
    SELECT *,
      date(last_calibrated_date, '+' || calibration_interval_days || ' days') as next_calibration_date
    FROM measuring_equipment
    WHERE is_active = 1
      AND (last_calibrated_date IS NULL OR date(last_calibrated_date, '+' || calibration_interval_days || ' days') < ?)
  `).all(today);
  res.json(rows);
});

router.post('/equipment/:id/calibrate', ...adminOrQCManager, (req, res) => {
  const { last_calibrated_date, calibrated_by, certificate_file } = req.body;
  if (!last_calibrated_date) return res.status(400).json({ error: 'กรุณากรอกวันที่ calibrate' });
  db.prepare('UPDATE measuring_equipment SET last_calibrated_date=?, calibrated_by=? WHERE id=?')
    .run(last_calibrated_date, calibrated_by || null, req.params.id);
  res.json(db.prepare('SELECT * FROM measuring_equipment WHERE id = ?').get(req.params.id));
});

module.exports = router;
