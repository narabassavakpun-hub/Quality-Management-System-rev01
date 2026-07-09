const express = require('express');
const router = express.Router();
const db = require('../db/database');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { xlsxUpload } = require('../middleware/upload');
const classifier = require('../services/proCodeClassifier');

const ATTR_FIELDS = classifier.ATTR_FIELDS;

// ---- helpers ----------------------------------------------------------
function cellText(v) {
  if (v == null) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') return String(v.text ?? v.result ?? v.richText?.map(t => t.text).join('') ?? '').trim();
  return String(v).trim();
}

// "DD.MM.YY" (Gregorian short year) or a real Date → 'YYYY-MM-DD'
function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const m = String(v).trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (!m) return null;
  let [, d, mo, y] = m;
  if (y.length === 2) y = '20' + y;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function toInt(v) {
  const n = parseInt(cellText(v), 10);
  return Number.isFinite(n) ? n : 0;
}

// Header aliases → canonical field. Matched case-insensitively after trim.
// 'so'/'so.' → so_no: some sheets carry the order number under an "SO." column
// while "Doc. No." is blank (or omit "Doc. No." entirely). Used as doc_no fallback.
const HEADER_MAP = {
  'doc. no.': 'doc_no', 'doc.no.': 'doc_no', 'doc no.': 'doc_no',
  'so': 'so_no', 'so.': 'so_no', 'so .': 'so_no',
  'product no.': 'product_no', 'product no': 'product_no',
  'product description': 'product_desc',
  'planned': 'plan_qty', 'completed': 'completed_qty', 'open': 'open_qty',
  'งานออกประจำวัน': 'daily_output',
  'so.ประจำวัน': 'so_daily', 'so. ประจำวัน': 'so_daily', 'soประจำวัน': 'so_daily',
  'stock': 'stock_qty',
  'คงเหลือ': 'remaining_qty',
  'หมายเหตุ': 'remarks',
  'รายวัน': 'daily_plan',
  'ot': 'ot_qty',
  'order date': 'order_date', 'start date': 'start_date', 'due date': 'due_date',
};

function findHeaderRow(ws) {
  const limit = Math.min(ws.rowCount, 12);
  for (let i = 1; i <= limit; i++) {
    const row = ws.getRow(i);
    let found = false;
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (cellText(cell.value).toLowerCase() === 'product no.') found = true;
    });
    if (found) return i;
  }
  return null;
}

function buildColumnMap(headerRow) {
  const map = {};
  headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
    const key = cellText(cell.value).toLowerCase().replace(/\s+/g, ' ');
    if (HEADER_MAP[key]) map[HEADER_MAP[key]] = col;
  });
  return map;
}

// sheet name '0115' / '0416 ' → production_line whose pdplan_sheet CSV contains it
function lineForSheet(sheetName, lineCache) {
  const code = String(sheetName).trim();
  return lineCache.find(l =>
    (l.pdplan_sheet || '').split(',').map(s => s.trim()).includes(code)
  )?.id || null;
}

// Core import — parses an already-loaded workbook. Exported for unit tests.
function importWorkbook(wb, fileName, userId) {
  const lineCache = db.prepare('SELECT id, pdplan_sheet FROM production_lines WHERE is_active = 1').all();
  const result = { imported: 0, updated: 0, skipped: 0, sheets: [], new_sap_codes: [], unmapped_sheets: [], errors: [] };

  const findSap = db.prepare('SELECT id FROM pro_code_sap WHERE product_no = ?');
  const insSap = db.prepare(`
    INSERT INTO pro_code_sap (product_no, product_desc, sap_part1, sap_part2, sap_part3,
      ${ATTR_FIELDS.join(',')}, classify_status, auto_confidence)
    VALUES (?, ?, ?, ?, ?, ${ATTR_FIELDS.map(() => '?').join(',')}, 'auto', ?)
  `);
  const upsertPlan = db.prepare(`
    INSERT INTO pd_plans (doc_no, product_no, product_desc, plan_qty, completed_qty, open_qty,
      daily_output, so_daily, stock_qty, remaining_qty, remarks, daily_plan, ot_qty,
      order_date, start_date, due_date, production_line_id, pro_code_sap_id, source_file, source_sheet, imported_by)
    VALUES (@doc_no, @product_no, @product_desc, @plan_qty, @completed_qty, @open_qty,
      @daily_output, @so_daily, @stock_qty, @remaining_qty, @remarks, @daily_plan, @ot_qty,
      @order_date, @start_date, @due_date, @production_line_id, @pro_code_sap_id, @source_file, @source_sheet, @imported_by)
    ON CONFLICT(doc_no, product_no) DO UPDATE SET
      product_desc=excluded.product_desc, plan_qty=excluded.plan_qty, completed_qty=excluded.completed_qty,
      open_qty=excluded.open_qty, daily_output=excluded.daily_output, so_daily=excluded.so_daily,
      stock_qty=excluded.stock_qty, remaining_qty=excluded.remaining_qty, remarks=excluded.remarks,
      daily_plan=excluded.daily_plan, ot_qty=excluded.ot_qty,
      order_date=excluded.order_date, start_date=excluded.start_date, due_date=excluded.due_date,
      production_line_id=excluded.production_line_id,
      pro_code_sap_id=COALESCE(excluded.pro_code_sap_id, pd_plans.pro_code_sap_id),
      source_file=excluded.source_file, source_sheet=excluded.source_sheet, imported_at=datetime('now')
  `);

  const importRow = db.transaction((rec) => {
    let sapId = findSap.get(rec.product_no)?.id || null;
    if (!sapId) {
      const r = classifier.classify(db, rec.product_no, rec.product_desc);
      const info = insSap.run(rec.product_no, rec.product_desc || null, r.sap_part1, r.sap_part2, r.sap_part3,
        ...ATTR_FIELDS.map(f => r.attrs[f] ?? null), r.confidence);
      sapId = info.lastInsertRowid;
      result.new_sap_codes.push(rec.product_no);
    }
    const existing = db.prepare('SELECT id FROM pd_plans WHERE doc_no = ? AND product_no = ?').get(rec.doc_no, rec.product_no);
    upsertPlan.run({ ...rec, pro_code_sap_id: sapId, imported_by: userId });
    if (existing) result.updated++; else result.imported++;
  });

  for (const ws of wb.worksheets) {
    const sheetName = ws.name.trim();
    const headerRowNum = findHeaderRow(ws);
    if (!headerRowNum) { result.sheets.push({ sheet: sheetName, rows: 0, note: 'ไม่พบ header' }); continue; }
    const colMap = buildColumnMap(ws.getRow(headerRowNum));
    // need product_no + at least one doc-number source (Doc. No. or SO.)
    if (!colMap.product_no || (!colMap.doc_no && !colMap.so_no)) {
      result.sheets.push({ sheet: sheetName, rows: 0, note: 'header ไม่ครบ' }); continue;
    }

    const lineId = lineForSheet(sheetName, lineCache);
    if (!lineId) result.unmapped_sheets.push(sheetName);

    let sheetRows = 0;
    for (let i = headerRowNum + 1; i <= ws.rowCount; i++) {
      const row = ws.getRow(i);
      const productNo = cellText(row.getCell(colMap.product_no).value);
      // doc number: prefer "Doc. No." cell, fall back to "SO." cell when blank
      const docNo = (colMap.doc_no ? cellText(row.getCell(colMap.doc_no).value) : '')
        || (colMap.so_no ? cellText(row.getCell(colMap.so_no).value) : '');
      // skip blanks / footers / rows without a real SAP-style code
      if (!productNo || !docNo || !/^[A-Z0-9]+-[A-Z0-9]+-[0-9]+$/i.test(productNo)) { result.skipped++; continue; }

      const rec = {
        doc_no: docNo,
        product_no: productNo.toUpperCase(),
        product_desc: colMap.product_desc ? cellText(row.getCell(colMap.product_desc).value) : null,
        plan_qty:      colMap.plan_qty      ? toInt(row.getCell(colMap.plan_qty).value)      : 0,
        completed_qty: colMap.completed_qty ? toInt(row.getCell(colMap.completed_qty).value) : 0,
        open_qty:      colMap.open_qty      ? toInt(row.getCell(colMap.open_qty).value)      : 0,
        daily_output:  colMap.daily_output  ? toInt(row.getCell(colMap.daily_output).value)  : 0,
        so_daily:      colMap.so_daily      ? cellText(row.getCell(colMap.so_daily).value) || null : null,
        stock_qty:     colMap.stock_qty     ? toInt(row.getCell(colMap.stock_qty).value)     : 0,
        remaining_qty: colMap.remaining_qty ? toInt(row.getCell(colMap.remaining_qty).value) : 0,
        remarks:       colMap.remarks       ? cellText(row.getCell(colMap.remarks).value) || null : null,
        daily_plan:    colMap.daily_plan    ? toInt(row.getCell(colMap.daily_plan).value)    : 0,
        ot_qty:        colMap.ot_qty        ? toInt(row.getCell(colMap.ot_qty).value)        : 0,
        order_date:    colMap.order_date    ? parseDate(row.getCell(colMap.order_date).value)  : null,
        start_date:    colMap.start_date    ? parseDate(row.getCell(colMap.start_date).value)  : null,
        due_date:      colMap.due_date      ? parseDate(row.getCell(colMap.due_date).value)    : null,
        production_line_id: lineId,
        source_file: fileName,
        source_sheet: sheetName,
      };
      try { importRow(rec); sheetRows++; }
      catch (e) { result.errors.push({ sheet: sheetName, product_no: productNo, error: e.message }); }
    }
    result.sheets.push({ sheet: sheetName, rows: sheetRows, line_id: lineId });
  }

  return result;
}

// ===== Preview workbook (ไม่เขียน DB) =====
function previewWorkbook(wb) {
  const lineCache = db.prepare('SELECT id, name, pdplan_sheet FROM production_lines WHERE is_active=1').all();

  const result = { sheets: [], total_rows: 0, total_errors: 0 };

  for (const ws of wb.worksheets) {
    const sheetName = ws.name.trim();
    const sheet = {
      sheet: sheetName, line_id: null, line_name: null, is_unmapped: false,
      header_found: false, header_row: null, columns_found: [],
      rows: [], errors: [],
      summary: { total: 0, confirmed: 0, needs_classify: 0, new_sap: 0, insert: 0, update: 0 },
    };

    // ผูกสายผลิต
    const line = lineCache.find(l => (l.pdplan_sheet || '').split(',').map(s => s.trim()).includes(sheetName));
    if (line) { sheet.line_id = line.id; sheet.line_name = line.name; }
    else { sheet.is_unmapped = true; }

    // หา header row
    const headerRowNum = findHeaderRow(ws);
    if (!headerRowNum) {
      sheet.errors.push({ type: 'no_header', message: `ไม่พบ header row ที่มีคอลัมน์ "Product No." (สแกน 12 แถวแรก)` });
      result.sheets.push(sheet); continue;
    }
    sheet.header_found = true;
    sheet.header_row = headerRowNum;

    const colMap = buildColumnMap(ws.getRow(headerRowNum));
    sheet.columns_found = Object.keys(colMap);

    if (!colMap.product_no) {
      sheet.errors.push({ type: 'missing_col', message: `แถวที่ ${headerRowNum}: ไม่พบคอลัมน์ "Product No."` });
      result.sheets.push(sheet); continue;
    }
    if (!colMap.doc_no && !colMap.so_no) {
      sheet.errors.push({ type: 'missing_col', message: `แถวที่ ${headerRowNum}: ไม่พบคอลัมน์ "Doc. No." หรือ "SO."` });
      result.sheets.push(sheet); continue;
    }

    // รวม product_no และ (doc_no,product_no) ทั้งหมดก่อน → batch query
    const rawRows = [];
    for (let i = headerRowNum + 1; i <= ws.rowCount; i++) {
      const row = ws.getRow(i);
      const productNo = cellText(row.getCell(colMap.product_no).value);
      const docNo = (colMap.doc_no ? cellText(row.getCell(colMap.doc_no).value) : '') ||
                    (colMap.so_no  ? cellText(row.getCell(colMap.so_no).value)  : '');
      if (!productNo && !docNo) continue;
      rawRows.push({
        row_num: i, productNo, docNo,
        product_desc: colMap.product_desc  ? cellText(row.getCell(colMap.product_desc).value)  || null : null,
        plan_qty:      colMap.plan_qty      ? toInt(row.getCell(colMap.plan_qty).value)      : 0,
        completed_qty: colMap.completed_qty ? toInt(row.getCell(colMap.completed_qty).value) : 0,
        open_qty:      colMap.open_qty      ? toInt(row.getCell(colMap.open_qty).value)      : 0,
        daily_output:  colMap.daily_output  ? toInt(row.getCell(colMap.daily_output).value)  : 0,
        so_daily:      colMap.so_daily      ? cellText(row.getCell(colMap.so_daily).value) || null : null,
        stock_qty:     colMap.stock_qty     ? toInt(row.getCell(colMap.stock_qty).value)     : 0,
        remaining_qty: colMap.remaining_qty ? toInt(row.getCell(colMap.remaining_qty).value) : 0,
        remarks:       colMap.remarks       ? cellText(row.getCell(colMap.remarks).value) || null : null,
        daily_plan:    colMap.daily_plan    ? toInt(row.getCell(colMap.daily_plan).value)    : 0,
        ot_qty:        colMap.ot_qty        ? toInt(row.getCell(colMap.ot_qty).value)        : 0,
        order_date:    colMap.order_date    ? parseDate(row.getCell(colMap.order_date).value) : null,
        start_date:    colMap.start_date    ? parseDate(row.getCell(colMap.start_date).value) : null,
        due_date:      colMap.due_date      ? parseDate(row.getCell(colMap.due_date).value)   : null,
      });
    }

    // Batch: SAP status
    const sapMap = {};
    const uniqueNos = [...new Set(rawRows.map(r => r.productNo).filter(Boolean))];
    if (uniqueNos.length) {
      const ph = uniqueNos.map(() => '?').join(',');
      db.prepare(`SELECT product_no, classify_status FROM pro_code_sap WHERE product_no IN (${ph})`).all(...uniqueNos)
        .forEach(r => { sapMap[r.product_no] = r.classify_status; });
    }

    // Batch: existing pd_plans
    const existSet = new Set();
    const pairs = rawRows.filter(r => r.productNo && r.docNo);
    if (pairs.length) {
      const phPairs = pairs.map(() => '(?,?)').join(',');
      const pairParams = pairs.flatMap(r => [r.docNo, r.productNo]);
      db.prepare(`SELECT doc_no, product_no FROM pd_plans WHERE (doc_no, product_no) IN (VALUES ${phPairs})`).all(...pairParams)
        .forEach(r => existSet.add(`${r.doc_no}||${r.product_no}`));
    }

    // สร้าง row entries
    for (const raw of rawRows) {
      const rowErrors = [];
      if (!raw.productNo) rowErrors.push(`ไม่มีรหัสสินค้า`);
      else if (!/^[A-Z0-9]+-[A-Z0-9]+-[0-9]+$/i.test(raw.productNo)) rowErrors.push(`รหัสสินค้าไม่ถูกรูปแบบ (ต้องเป็น XX-XX-XX)`);
      if (!raw.docNo) rowErrors.push(`ไม่มีเลข Doc. No.`);

      const sapStatus = raw.productNo ? (sapMap[raw.productNo] || 'new') : 'new';
      const inPlan = raw.docNo && raw.productNo ? existSet.has(`${raw.docNo}||${raw.productNo}`) : false;

      sheet.rows.push({
        row_num: raw.row_num,
        doc_no: raw.docNo || null,
        product_no: raw.productNo || null,
        product_desc: raw.product_desc,
        plan_qty: raw.plan_qty, completed_qty: raw.completed_qty, open_qty: raw.open_qty,
        daily_output: raw.daily_output, so_daily: raw.so_daily,
        stock_qty: raw.stock_qty, remaining_qty: raw.remaining_qty,
        remarks: raw.remarks, daily_plan: raw.daily_plan, ot_qty: raw.ot_qty,
        order_date: raw.order_date, start_date: raw.start_date, due_date: raw.due_date,
        sap_status: sapStatus,
        action: inPlan ? 'update' : 'insert',
        errors: rowErrors,
      });

      sheet.summary.total++;
      if (rowErrors.length) result.total_errors++;
      if (sapStatus === 'confirmed') sheet.summary.confirmed++;
      else if (sapStatus !== 'new')  sheet.summary.needs_classify++;
      else                           sheet.summary.new_sap++;
      if (inPlan) sheet.summary.update++; else sheet.summary.insert++;
    }

    result.total_rows += sheet.summary.total;
    result.sheets.push(sheet);
  }
  return result;
}

// ===== POST /api/pd-plan/preview — ดูตัวอย่างก่อนนำเข้า =====
router.post('/preview', auth, requireRole(['admin']), xlsxUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'กรุณาแนบไฟล์ Excel (.xlsx)' });
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(req.file.buffer); }
  catch { return res.status(400).json({ error: 'อ่านไฟล์ Excel ไม่ได้ — ไฟล์อาจเสียหาย' }); }
  try {
    const result = previewWorkbook(wb);
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('[pd-plan/preview]', e.message);
    res.status(500).json({ error: 'ตรวจสอบไฟล์ไม่สำเร็จ: ' + e.message });
  }
});

// ===== POST /api/pd-plan/import =====
router.post('/import', auth, requireRole(['admin']), xlsxUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'กรุณาแนบไฟล์ Excel (.xlsx)' });

  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(req.file.buffer); }
  catch { return res.status(400).json({ error: 'อ่านไฟล์ Excel ไม่ได้ — ไฟล์อาจเสียหาย' }); }

  try {
    const result = importWorkbook(wb, req.file.originalname, req.user.id);
    res.json(result);
  } catch (e) {
    console.error('[pd-plan/import]', e.message);
    res.status(500).json({ error: 'นำเข้าข้อมูลไม่สำเร็จ: ' + e.message });
  }
});

// ===== GET /api/pd-plan/search?q= — ค้นหาด้วย Doc. No. / product_no / ชื่อ =====
router.get('/search', auth, (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ data: [] });
  const like = `%${q}%`;
  const rows = db.prepare(`
    SELECT pp.id, pp.doc_no, pp.product_no, pp.product_desc,
           pp.plan_qty, pp.completed_qty, pp.open_qty,
           pp.due_date, pp.production_line_id,
           pl.name AS line_name,
           pcs.id   AS pro_code_sap_id,
           pcs.classify_status AS sap_status,
           pcs.line_type, pcs.brand, pcs.product_series, pcs.panel_type, pcs.panel_style, pcs.mosquito_net, pcs.glass_type, pcs.panel_color, pcs.panel_size
    FROM pd_plans pp
    LEFT JOIN production_lines pl  ON pl.id  = pp.production_line_id
    LEFT JOIN pro_code_sap   pcs ON pcs.id = pp.pro_code_sap_id
    WHERE pp.doc_no LIKE ? OR pp.product_no LIKE ? OR pp.product_desc LIKE ?
    ORDER BY pp.due_date DESC, pp.doc_no
    LIMIT 30
  `).all(like, like, like);
  res.json({ data: rows });
});

// ===== GET /api/pd-plan — list =====
router.get('/', auth, (req, res) => {
  const { line_id, product_no, due_from, due_to, q = '', page = 1, limit = 20 } = req.query;
  const offset = (Math.max(1, +page) - 1) * +limit;
  let where = '1=1';
  const params = [];
  if (line_id) { where += ' AND pp.production_line_id = ?'; params.push(line_id); }
  if (product_no) { where += ' AND pp.product_no = ?'; params.push(product_no); }
  if (due_from) { where += ' AND pp.due_date >= ?'; params.push(due_from); }
  if (due_to) { where += ' AND pp.due_date <= ?'; params.push(due_to); }
  if (q) { where += ' AND (pp.product_no LIKE ? OR pp.doc_no LIKE ? OR pp.product_desc LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }

  const rows = db.prepare(`
    SELECT pp.*, pl.name AS line_name, pcs.classify_status AS sap_status
    FROM pd_plans pp
    LEFT JOIN production_lines pl ON pl.id = pp.production_line_id
    LEFT JOIN pro_code_sap pcs ON pcs.id = pp.pro_code_sap_id
    WHERE ${where}
    ORDER BY pp.due_date DESC, pp.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, +limit, offset);
  const total = db.prepare(`SELECT COUNT(*) AS c FROM pd_plans pp WHERE ${where}`).get(...params);
  res.json({ data: rows, total: total.c, page: +page, limit: +limit });
});

module.exports = router;
module.exports.importWorkbook = importWorkbook; // for tests
