const express = require('express');
const router = express.Router();
const db = require('../db/database');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const classifier = require('../services/proCodeClassifier');
const { xlsxUpload } = require('../middleware/upload');

const ATTR_FIELDS = classifier.ATTR_FIELDS;
const EDITABLE = [...ATTR_FIELDS, 'product_desc', 'sap_part1', 'sap_part2', 'sap_part3'];

// ===== GET /api/pro-code-sap =====
router.get('/', auth, (req, res) => {
  const { status, q = '', brand, line_type, page = 1, limit = 20 } = req.query;
  const offset = (Math.max(1, +page) - 1) * +limit;
  let where = '1=1';
  const params = [];
  // status=auto → รวม pending ด้วย (ทั้งคู่รอการยืนยันจาก admin เหมือนกัน)
  if (status === 'auto') { where += " AND classify_status IN ('auto','pending')"; }
  else if (status) { where += ' AND classify_status = ?'; params.push(status); }
  if (brand) { where += ' AND brand = ?'; params.push(brand); }
  if (line_type) { where += ' AND line_type = ?'; params.push(line_type); }
  if (q) { where += ' AND (product_no LIKE ? OR product_desc LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }

  const rows = db.prepare(`
    SELECT pcs.*, u.full_name AS classified_by_name
    FROM pro_code_sap pcs
    LEFT JOIN users u ON u.id = pcs.classified_by
    WHERE ${where}
    ORDER BY
      CASE classify_status WHEN 'pending' THEN 0 WHEN 'auto' THEN 1 WHEN 'rejected' THEN 2 ELSE 3 END,
      pcs.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, +limit, offset);

  const total = db.prepare(`SELECT COUNT(*) AS c FROM pro_code_sap pcs WHERE ${where}`).get(...params);
  res.json({ data: rows, total: total.c, page: +page, limit: +limit });
});

// ===== GET /api/pro-code-sap/filter-options =====
router.get('/filter-options', auth, (req, res) => {
  const out = {};
  for (const f of ['line_type', 'brand', 'panel_type', 'panel_color', 'product_series', 'panel_style']) {
    out[f] = db.prepare(
      `SELECT DISTINCT ${f} AS v FROM pro_code_sap WHERE ${f} IS NOT NULL AND ${f} != '' AND classify_status='confirmed' ORDER BY v`
    ).all().map(r => r.v);
  }
  res.json(out);
});

// ===== GET /api/pro-code-sap/field-values =====
router.get('/field-values', auth, requireRole(['admin']), (req, res) => {
  const fields = ATTR_FIELDS.filter(f => f !== 'product_desc');
  const out = {};
  for (const f of fields) {
    out[f] = db.prepare(`
      SELECT ${f} AS v, COUNT(*) AS cnt
      FROM pro_code_sap
      WHERE ${f} IS NOT NULL AND ${f} != ''
        AND classify_status IN ('confirmed', 'auto')
      GROUP BY ${f}
      ORDER BY cnt DESC, v ASC
    `).all().map(r => r.v);
  }
  res.json(out);
});

// ===== GET /api/pro-code-sap/search — confirmed only, for IPQC/FQC product picker =====
router.get('/search', auth, (req, res) => {
  const { q = '', limit = 10 } = req.query;
  if (!q || q.length < 2) return res.json({ data: [] });
  const rows = db.prepare(`
    SELECT id, product_no, product_desc, line_type, brand, panel_type, panel_color, panel_size
    FROM pro_code_sap
    WHERE classify_status = 'confirmed' AND (product_no LIKE ? OR product_desc LIKE ?)
    ORDER BY product_no LIMIT ?
  `).all(`%${q}%`, `%${q}%`, Math.min(+limit, 25));
  res.json({ data: rows });
});

// ===== GET /api/pro-code-sap/cache/stats =====
router.get('/cache/stats', auth, requireRole(['admin']), (req, res) => {
  try {
    const entries = db.prepare('SELECT COUNT(*) AS c FROM sap_prediction_cache').get();
    const groups = db.prepare("SELECT COUNT(DISTINCT sap_part1 || '|' || sap_part2) AS c FROM sap_prediction_cache").get();
    const newest = db.prepare('SELECT MAX(updated_at) AS t FROM sap_prediction_cache').get();
    const confirmed = db.prepare("SELECT COUNT(*) AS c FROM pro_code_sap WHERE classify_status='confirmed'").get();
    res.json({ entries: entries.c, groups: groups.c, confirmedRecords: confirmed.c, updatedAt: newest.t });
  } catch {
    res.json({ entries: 0, groups: 0, confirmedRecords: 0, updatedAt: null });
  }
});

// ===== POST /api/pro-code-sap/reset-all =====
// ===== Custom Keyword Rules (sap_parse_rules — desc_contains only) =====

const RULE_FIELDS = ['panel_style', 'panel_color', 'glass_type', 'iron_pattern'];

// GET /parse-rules?field=panel_style  — list rules (optionally filtered by target_field)
router.get('/parse-rules', auth, requireRole(['admin']), (req, res) => {
  const { field } = req.query;
  let q = 'SELECT * FROM sap_parse_rules WHERE rule_type=\'desc_contains\'';
  const params = [];
  if (field && RULE_FIELDS.includes(field)) { q += ' AND target_field=?'; params.push(field); }
  q += ' ORDER BY target_field, id ASC';
  res.json(db.prepare(q).all(...params));
});

// POST /parse-rules  — create new rule
router.post('/parse-rules', auth, requireRole(['admin']), (req, res) => {
  const { keyword, target_field, set_value } = req.body;
  if (!keyword || !target_field || !set_value)
    return res.status(400).json({ error: 'keyword, target_field, set_value required' });
  if (!RULE_FIELDS.includes(target_field))
    return res.status(400).json({ error: 'target_field ไม่รองรับ' });
  const exists = db.prepare('SELECT id FROM sap_parse_rules WHERE rule_type=? AND match_value=? AND target_field=?')
    .get('desc_contains', keyword.trim().toUpperCase(), target_field);
  if (exists) return res.status(409).json({ error: 'มีเงื่อนไขนี้อยู่แล้ว' });
  const r = db.prepare(`INSERT INTO sap_parse_rules(rule_type,match_value,target_field,set_value,is_active,created_by)
    VALUES('desc_contains',?,?,?,1,?)`)
    .run(keyword.trim().toUpperCase(), target_field, set_value.trim(), req.user.id);
  res.json({ id: r.lastInsertRowid, ok: true });
});

// PATCH /parse-rules/:id  — toggle active
router.patch('/parse-rules/:id', auth, requireRole(['admin']), (req, res) => {
  const { is_active } = req.body;
  db.prepare('UPDATE sap_parse_rules SET is_active=? WHERE id=? AND rule_type=\'desc_contains\'')
    .run(is_active ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

// DELETE /parse-rules/:id
router.delete('/parse-rules/:id', auth, requireRole(['admin']), (req, res) => {
  db.prepare("DELETE FROM sap_parse_rules WHERE id=? AND rule_type='desc_contains'").run(req.params.id);
  res.json({ ok: true });
});

// ===== Hard reset =====

// Hard reset: wipes pd_plans, pro_code_sap, sap_prediction_cache, sap_master_lookup.
// NULLs pro_code_sap_id on ipqc_records to satisfy RESTRICT FK.
// หมายเหตุ (Session 104): เดิม NULL fqc_records ด้วย — table ถูกลบแล้ว (dead feature, ไม่เคยมี route จริง)
// ⚠️ พบระหว่างแก้: fgqc_records ก็มี pro_code_sap_id ON DELETE RESTRICT เหมือนกันแต่ไม่เคยถูก NULL ในนี้เลย —
// เป็น gap เดิมที่มีอยู่ก่อนแล้ว (ไม่ใช่สิ่งที่ session นี้ทำให้แย่ลง) ยังไม่แก้ในรอบนี้ — ต้องดูว่าเป็นความตั้งใจหรือบั๊ก
// Returns counts of deleted rows.
router.post('/reset-all', auth, requireRole(['admin']), (req, res) => {
  const counts = {};
  db.transaction(() => {
    // NULL FK references so RESTRICT does not block pro_code_sap DELETE
    counts.ipqc_nulled = db.prepare("UPDATE ipqc_records SET pro_code_sap_id=NULL WHERE pro_code_sap_id IS NOT NULL").run().changes;
    // Also NULL pd_plan links that will go away
    db.prepare("UPDATE ipqc_records SET pd_plan_id=NULL WHERE pd_plan_id IS NOT NULL").run();

    counts.pd_plans           = db.prepare("DELETE FROM pd_plans").run().changes;
    counts.pro_code_sap       = db.prepare("DELETE FROM pro_code_sap").run().changes;
    counts.sap_prediction_cache = db.prepare("DELETE FROM sap_prediction_cache").run().changes;
    counts.sap_master_lookup  = db.prepare("DELETE FROM sap_master_lookup").run().changes;

    db.auditLog('pro_code_sap', 0, 'DELETE', null, { action: 'reset_all', counts }, req.user.id, req.ip);
  })();
  res.json({ ok: true, counts });
});

// ===== POST /api/pro-code-sap/cache/rebuild-all =====
router.post('/cache/rebuild-all', auth, requireRole(['admin']), (req, res) => {
  const pairs = db.prepare(
    "SELECT DISTINCT sap_part1, sap_part2 FROM pro_code_sap WHERE classify_status='confirmed' AND sap_part1 IS NOT NULL"
  ).all();
  for (const { sap_part1, sap_part2 } of pairs) {
    classifier.rebuildPredictionCache(db, sap_part1, sap_part2 || '');
  }
  res.json({ ok: true, rebuilt: pairs.length });
});

// ===== POST /api/pro-code-sap/rebuild-derived-desc =====
// Backfill derived_desc for all existing confirmed records (one-time admin action)
router.post('/rebuild-derived-desc', auth, requireRole(['admin']), (req, res) => {
  const rows = db.prepare("SELECT * FROM pro_code_sap WHERE classify_status='confirmed'").all();
  let updated = 0;
  db.transaction(() => {
    for (const r of rows) {
      const dd = classifier.generateDerivedDesc(r);
      if (dd) {
        db.prepare('UPDATE pro_code_sap SET derived_desc=? WHERE id=?').run(dd, r.id);
        updated++;
      }
    }
  })();
  res.json({ ok: true, updated });
});

// ===== GET /api/pro-code-sap/export/excel =====
// ?status=confirmed|auto|pending|rejected  (omit for all)
router.get('/export/excel', auth, requireRole(['admin', 'qc_manager']), async (req, res) => {
  const ExcelJS = require('exceljs');
  const { status } = req.query;
  const where = status ? 'WHERE classify_status=?' : '';
  const params = status ? [status] : [];
  const rows = db.prepare(`SELECT * FROM pro_code_sap ${where} ORDER BY product_no`).all(...params);
  const filename = status ? `ProCodeSAP_${status}.xlsx` : 'ProCodeSAP.xlsx';

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('ProCodeSAP');
  const cols = ['product_no', 'product_desc', ...ATTR_FIELDS, 'classify_status', 'auto_confidence'];
  ws.columns = cols.map(c => ({ header: c, key: c, width: 18 }));

  const hdr = ws.getRow(1);
  hdr.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  hdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3A5C' } };

  const hints = ws.addRow(cols.map(c => {
    const map = {
      product_no: 'รหัสสินค้า (ห้ามแก้)',
      product_desc: 'ชื่อสินค้า',
      line_type: 'FA/FU/RU/WO',
      panel_color: 'สีขาว/สีชา/สีดำ/...',
      panel_size: 'กว้างxสูง เช่น 120.5x110',
      width_mm: 'ความกว้าง มม.',
      height_mm: 'ความสูง มม.',
      classify_status: 'pending/auto/confirmed/rejected',
    };
    return map[c] || '';
  }));
  hints.font = { italic: true, color: { argb: 'FF777777' } };
  hints.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF99' } };

  rows.forEach(r => ws.addRow(r));

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
});

// ===== POST /api/pro-code-sap/import?dryRun=1 =====
// Bulk-edit confirmed records from Excel. product_no must match an existing record.
router.post('/import', auth, requireRole(['admin']), xlsxUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'กรุณาแนบไฟล์ Excel' });
  const dryRun = req.query.dryRun === '1';

  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(req.file.buffer);
  const ws = wb.worksheets[0];
  if (!ws) return res.status(400).json({ error: 'ไม่พบ Sheet ในไฟล์' });

  // Find header row (first row with 'product_no')
  let headerRow = null;
  ws.eachRow((row, rn) => {
    if (headerRow) return;
    const vals = row.values.map(v => String(v || '').trim().toLowerCase());
    if (vals.includes('product_no')) headerRow = { row, rn };
  });
  if (!headerRow) {
    return res.status(400).json({ error: 'ไม่พบ header "product_no" ในไฟล์', headerError: true });
  }

  // Build column map
  const colMap = {};
  headerRow.row.eachCell((cell, col) => {
    const n = String(cell.value || '').trim().toLowerCase();
    if (n) colMap[n] = col;
  });
  if (!colMap['product_no']) return res.status(400).json({ error: 'ไม่พบคอลัมน์ product_no', headerError: true });

  const importable = ['product_desc', ...ATTR_FIELDS];
  const editableCols = importable.filter(f => colMap[f]);

  const result = { total: 0, valid: 0, invalid: 0, imported: 0, updated: 0, rows: [], dryRun };

  ws.eachRow((row, rn) => {
    if (rn <= headerRow.rn + 1) return; // skip header + hints rows
    const productNo = String(row.getCell(colMap['product_no'])?.value || '').trim().toUpperCase();
    if (!productNo) return;
    result.total++;

    const errors = [];
    const existing = db.prepare('SELECT id, classify_status FROM pro_code_sap WHERE product_no=?').get(productNo);
    if (!existing) { errors.push(`ไม่พบรหัส ${productNo} ในระบบ`); }

    const data = { product_no: productNo };
    for (const f of editableCols) {
      const raw = row.getCell(colMap[f])?.value;
      const v = raw != null ? String(raw).trim() : null;
      if (v !== null && v !== '') data[f] = v;
    }

    if (errors.length) {
      result.invalid++;
      result.rows.push({ rowNum: rn, data, valid: false, errors });
    } else {
      result.valid++;
      result.rows.push({ rowNum: rn, data, valid: true, existingId: existing.id });
    }
  });

  // ตรวจ duplicate product_no ภายในไฟล์ — ถ้าซ้ำหยุดทันที
  const seenNos = result.rows.map(r => r.data.product_no);
  const dupSet = seenNos.filter((v, i) => seenNos.indexOf(v) !== i);
  if (dupSet.length > 0) {
    return res.status(400).json({
      error: `พบรหัสสินค้าซ้ำในไฟล์ (${[...new Set(dupSet)].join(', ')}) — กรุณาแก้ไขไฟล์และนำเข้าใหม่`,
      duplicates: [...new Set(dupSet)],
    });
  }

  if (!dryRun && result.valid > 0) {
    const validRows = result.rows.filter(r => r.valid);
    const run = db.transaction(() => {
      for (const r of validRows) {
        const updates = [];
        const params = [];
        for (const f of editableCols) {
          if (r.data[f] !== undefined) { updates.push(`${f}=?`); params.push(r.data[f]); }
        }
        if (!updates.length) continue;
        db.prepare(`UPDATE pro_code_sap SET ${updates.join(',')} WHERE id=?`).run(...params, r.existingId);
        db.auditLog('pro_code_sap', r.existingId, 'UPDATE', null, r.data, req.user.id, req.ip);
        result.updated++;
      }
    });
    run();

    // Refresh cache + confidence for all affected groups (not just confirmed)
    const affectedIds = validRows.map(r => r.existingId);
    if (affectedIds.length) {
      const pairs = db.prepare(
        `SELECT DISTINCT sap_part1, sap_part2 FROM pro_code_sap WHERE id IN (${affectedIds.map(() => '?').join(',')})`
      ).all(...affectedIds);
      for (const { sap_part1, sap_part2 } of pairs) {
        classifier.refreshGroupConfidence(db, sap_part1, sap_part2 || '');
      }
    }
  }

  res.json(result);
});

// ===== POST /api/pro-code-sap/auto-classify =====
router.post('/auto-classify', auth, requireRole(['admin']), (req, res) => {
  const rows = db.prepare("SELECT id, product_no, product_desc FROM pro_code_sap WHERE classify_status IN ('pending','auto')").all();
  let updated = 0;
  const run = db.transaction(() => {
    for (const row of rows) {
      const r = classifier.classify(db, row.product_no, row.product_desc || '');
      const sets = ATTR_FIELDS.map(f => `${f} = ?`).join(', ');
      db.prepare(`
        UPDATE pro_code_sap SET sap_part1=?, sap_part2=?, sap_part3=?, ${sets},
          classify_status='auto', auto_confidence=? WHERE id = ?
      `).run(r.sap_part1, r.sap_part2, r.sap_part3, ...ATTR_FIELDS.map(f => r.attrs[f] ?? null), r.confidence, row.id);
      updated++;
    }
  });
  run();
  res.json({ ok: true, updated });
});

// ===== POST /api/pro-code-sap/import-master-training =====
// Reads training XLSX, groups by (part1, part2), stores per-field majority vote.
// Full wipe-and-replace (re-import safe). Panel size fields excluded.
router.post('/import-master-training', auth, requireRole(['admin']), xlsxUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'กรุณาแนบไฟล์ Excel (.xlsx)' });

  const ExcelJS = require('exceljs');
  const t0 = Date.now();

  let wb;
  try {
    wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.file.buffer);
  } catch {
    return res.status(400).json({ error: 'ไม่สามารถอ่านไฟล์ Excel — ตรวจสอบว่าไฟล์ไม่เสียหาย' });
  }

  const ws = wb.worksheets[0];
  if (!ws) return res.status(400).json({ error: 'ไม่พบ Sheet ในไฟล์' });

  // Scan first 10 rows for header with 'product no.' column
  let headerRowNum = null;
  let colMap = {};
  for (let rn = 1; rn <= Math.min(10, ws.rowCount); rn++) {
    const row = ws.getRow(rn);
    const vals = {};
    row.eachCell((cell, col) => {
      const n = String(cell.value || '').trim().toLowerCase().replace(/\s+/g, '_');
      if (n) vals[n] = col;
    });
    if (vals['product_no.'] || vals['product_no']) {
      headerRowNum = rn;
      colMap = vals;
      break;
    }
  }
  if (!headerRowNum) return res.status(400).json({ error: 'ไม่พบ header row (ต้องมีคอลัมน์ "Product No.")' });

  // Map training file columns to our DB field names
  // Supports Thai column names (actual file) and English fallbacks
  const FIELD_ALIASES = {
    line_type:      ['ชนิดเส้น',           'line_type', 'linetype'],
    product_series: ['รุ่นสินค้า',          'product_series', 'series'],
    brand:          ['แบรนด์',             'brand'],
    panel_type:     ['ชนิดบาน',            'panel_type', 'type'],
    panel_style:    ['รูปแบบบาน',          'panel_style', 'style'],
    iron_pattern:   ['ลายเหล็กดัด',        'iron_pattern'],
    iron_color:     ['สีเหล็กดัด',         'iron_color'],
    glass_type:     ['ชนิดกระจก',          'glass_type'],
    mosquito_net:   ['สถานะการใส่มุ้ง',    'mosquito_net'],
    panel_color:    ['สีบาน',              'panel_color', 'color', 'สี'],
    design_version: ['รุ่นออกแบบ',         'design_version', 'version'],
    remarks:        ['อื่นๆ',              'remarks', 'remark'],
  };

  const fieldColMap = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const alias of aliases) {
      // normalize: trim + lowercase (Thai unaffected) + collapse spaces
      const key = alias.trim().toLowerCase().replace(/\s+/g, '_');
      if (colMap[key]) { fieldColMap[field] = colMap[key]; break; }
    }
  }

  // Log for debugging — remove after verified
  console.log('[import-training] header row:', headerRowNum,
    '| mapped fields:', Object.keys(fieldColMap).join(', ') || 'NONE');

  const productNoCol = colMap['product_no.'] || colMap['product_no'];
  const PANEL_SIZE_FIELDS = new Set(['panel_size', 'width_mm', 'height_mm']);

  // Group: { "part1||part2" → { part1, part2, fields: { fieldName → { value → count } } } }
  const groups = {};
  let totalRows = 0;

  ws.eachRow((row, rn) => {
    if (rn <= headerRowNum) return;
    const productNoRaw = row.getCell(productNoCol)?.value;
    if (!productNoRaw) return;
    const productNo = String(productNoRaw).trim().toUpperCase();
    if (!productNo) return;

    const parts = productNo.split('-');
    const part1 = parts[0] || '';
    const part2 = parts[1] || '';
    if (!part1) return;

    totalRows++;
    const key = `${part1}||${part2}`;
    if (!groups[key]) groups[key] = { part1, part2, fields: {} };

    for (const [field, col] of Object.entries(fieldColMap)) {
      const raw = row.getCell(col)?.value;
      const val = raw != null ? String(raw).trim() : '';
      if (!val) continue;
      if (!groups[key].fields[field]) groups[key].fields[field] = {};
      groups[key].fields[field][val] = (groups[key].fields[field][val] || 0) + 1;
    }
  });

  const groupKeys = Object.keys(groups);
  let fieldsInserted = 0;

  db.transaction(() => {
    db.prepare('DELETE FROM sap_master_lookup').run();

    for (const key of groupKeys) {
      const { part1, part2, fields } = groups[key];
      const sampleSize = Math.max(
        ...Object.values(fields).map(vc => Object.values(vc).reduce((a, b) => a + b, 0)),
        0
      );

      for (const [field, valueCounts] of Object.entries(fields)) {
        if (PANEL_SIZE_FIELDS.has(field)) continue;
        const entries = Object.entries(valueCounts).sort((a, b) => b[1] - a[1]);
        if (!entries.length) continue;
        const [topValue, topFreq] = entries[0];
        const totalVotes = Object.values(valueCounts).reduce((a, b) => a + b, 0);
        const confidencePct = Math.round(topFreq / totalVotes * 100);

        db.prepare(`
          INSERT OR REPLACE INTO sap_master_lookup
            (sap_part1, sap_part2, field_name, top_value, frequency, sample_size, confidence_pct, imported_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(part1, part2, field, topValue, topFreq, sampleSize, confidencePct);
        fieldsInserted++;
      }
    }

    db.auditLog('sap_master_lookup', 0, 'IMPORT_TRAINING', null,
      { totalRows, groups: groupKeys.length, fieldsInserted }, req.user.id, req.ip);
  })();

  res.json({ ok: true, totalRows, groups: groupKeys.length, fieldsInserted, durationMs: Date.now() - t0 });
});

// ===== GET /api/pro-code-sap/master-training/stats =====
router.get('/master-training/stats', auth, requireRole(['admin']), (req, res) => {
  try {
    const entries = db.prepare('SELECT COUNT(*) AS c FROM sap_master_lookup').get();
    const groups = db.prepare("SELECT COUNT(DISTINCT sap_part1 || '|' || sap_part2) AS c FROM sap_master_lookup").get();
    const newest = db.prepare('SELECT MAX(imported_at) AS t FROM sap_master_lookup').get();
    res.json({ entries: entries.c, groups: groups.c, importedAt: newest.t });
  } catch {
    res.json({ entries: 0, groups: 0, importedAt: null });
  }
});

// ===== GET /api/pro-code-sap/master-training/groups =====
router.get('/master-training/groups', auth, requireRole(['admin']), (req, res) => {
  const { q = '', page = 1, limit = 30 } = req.query;
  const offset = (Math.max(1, +page) - 1) * +limit;
  let where = '1=1';
  const params = [];
  if (q) { where += ' AND (sap_part1 LIKE ? OR sap_part2 LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }

  const rows = db.prepare(`
    SELECT sap_part1, sap_part2,
      MAX(sample_size) AS sample_size,
      COUNT(*) AS field_count,
      ROUND(AVG(confidence_pct)) AS avg_confidence,
      MAX(imported_at) AS imported_at
    FROM sap_master_lookup WHERE ${where}
    GROUP BY sap_part1, sap_part2
    ORDER BY sap_part1, sap_part2
    LIMIT ? OFFSET ?
  `).all(...params, +limit, offset);

  const total = db.prepare(`
    SELECT COUNT(DISTINCT sap_part1 || '||' || sap_part2) AS c
    FROM sap_master_lookup WHERE ${where}
  `).get(...params);

  res.json({ data: rows, total: total.c, page: +page, limit: +limit });
});

// ===== GET /api/pro-code-sap/master-training/group-detail?part1=&part2= =====
router.get('/master-training/group-detail', auth, requireRole(['admin']), (req, res) => {
  const { part1, part2 = '' } = req.query;
  if (!part1) return res.status(400).json({ error: 'ต้องระบุ part1' });
  const rows = db.prepare(`
    SELECT field_name, top_value, frequency, sample_size, confidence_pct
    FROM sap_master_lookup WHERE sap_part1=? AND sap_part2=?
    ORDER BY field_name
  `).all(part1, part2);
  res.json({ data: rows });
});

// ===== PATCH /api/pro-code-sap/master-training/entry =====
// Body: { part1, part2, field, top_value?, confidence_pct? }
router.patch('/master-training/entry', auth, requireRole(['admin']), (req, res) => {
  const { part1, part2 = '', field, top_value, confidence_pct } = req.body;
  if (!part1 || !field) return res.status(400).json({ error: 'ต้องระบุ part1 และ field' });
  const row = db.prepare('SELECT * FROM sap_master_lookup WHERE sap_part1=? AND sap_part2=? AND field_name=?').get(part1, part2, field);
  if (!row) return res.status(404).json({ error: 'ไม่พบข้อมูล' });

  const sets = [];
  const vals = [];
  if (top_value !== undefined) { sets.push('top_value=?'); vals.push(String(top_value)); }
  if (confidence_pct !== undefined) { sets.push('confidence_pct=?'); vals.push(Math.min(100, Math.max(0, +confidence_pct))); }
  if (!sets.length) return res.status(400).json({ error: 'ไม่มีข้อมูลที่แก้ไข' });

  db.transaction(() => {
    db.prepare(`UPDATE sap_master_lookup SET ${sets.join(',')} WHERE sap_part1=? AND sap_part2=? AND field_name=?`)
      .run(...vals, part1, part2, field);
    db.auditLog('sap_master_lookup', 0, 'UPDATE', row, req.body, req.user.id, req.ip);
  })();
  res.json({ ok: true });
});

// ===== DELETE /api/pro-code-sap/master-training/group?part1=&part2= =====
router.delete('/master-training/group', auth, requireRole(['admin']), (req, res) => {
  const { part1, part2 = '' } = req.query;
  if (!part1) return res.status(400).json({ error: 'ต้องระบุ part1' });
  db.transaction(() => {
    db.prepare('DELETE FROM sap_master_lookup WHERE sap_part1=? AND sap_part2=?').run(part1, part2);
    db.auditLog('sap_master_lookup', 0, 'DELETE', { part1, part2 }, null, req.user.id, req.ip);
  })();
  res.json({ ok: true });
});

// ===== DELETE /api/pro-code-sap/master-training/entry?part1=&part2=&field= =====
router.delete('/master-training/entry', auth, requireRole(['admin']), (req, res) => {
  const { part1, part2 = '', field } = req.query;
  if (!part1 || !field) return res.status(400).json({ error: 'ต้องระบุ part1 และ field' });
  db.transaction(() => {
    db.prepare('DELETE FROM sap_master_lookup WHERE sap_part1=? AND sap_part2=? AND field_name=?').run(part1, part2, field);
    db.auditLog('sap_master_lookup', 0, 'DELETE', { part1, part2, field }, null, req.user.id, req.ip);
  })();
  res.json({ ok: true });
});

// ===== GET /api/pro-code-sap/:id/classify-preview =====
// No DB writes — calls classify() and returns full result with fieldConfidence
router.get('/:id/classify-preview', auth, (req, res) => {
  const row = db.prepare('SELECT product_no, product_desc FROM pro_code_sap WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'ไม่พบรหัส SAP นี้' });
  const result = classifier.classify(db, row.product_no, row.product_desc || '');
  res.json(result);
});

// ===== GET /api/pro-code-sap/:id =====
router.get('/:id', auth, (req, res) => {
  const row = db.prepare('SELECT * FROM pro_code_sap WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'ไม่พบรหัส SAP นี้' });
  res.json(row);
});

// ===== POST /api/pro-code-sap — manual add (admin) =====
router.post('/', auth, requireRole(['admin']), (req, res) => {
  const { product_no, product_desc } = req.body;
  if (!product_no) return res.status(400).json({ error: 'กรุณากรอกรหัสสินค้า (Product No.)' });
  const exists = db.prepare('SELECT id FROM pro_code_sap WHERE product_no = ?').get(product_no);
  if (exists) return res.status(409).json({ error: `รหัส ${product_no} มีอยู่แล้ว` });

  const r = classifier.classify(db, product_no, product_desc || '');
  const create = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO pro_code_sap (product_no, product_desc, sap_part1, sap_part2, sap_part3,
        ${ATTR_FIELDS.join(',')}, classify_status, auto_confidence)
      VALUES (?, ?, ?, ?, ?, ${ATTR_FIELDS.map(() => '?').join(',')}, 'auto', ?)
    `).run(product_no, product_desc || null, r.sap_part1, r.sap_part2, r.sap_part3,
      ...ATTR_FIELDS.map(f => r.attrs[f] ?? null), r.confidence);
    db.auditLog('pro_code_sap', info.lastInsertRowid, 'CREATE', null, { product_no }, req.user.id, req.ip);
    return info.lastInsertRowid;
  });
  res.status(201).json({ id: create(), suggested: r.attrs, confidence: r.confidence });
});

// ===== PATCH /api/pro-code-sap/:id =====
router.patch('/:id', auth, requireRole(['admin']), (req, res) => {
  const row = db.prepare('SELECT * FROM pro_code_sap WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'ไม่พบรหัส SAP นี้' });

  const updates = [];
  const params = [];
  for (const f of EDITABLE) {
    if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); }
  }
  if (!updates.length) return res.status(400).json({ error: 'ไม่มีข้อมูลที่ต้องแก้ไข' });

  db.transaction(() => {
    db.prepare(`UPDATE pro_code_sap SET ${updates.join(', ')} WHERE id = ?`).run(...params, row.id);
    db.auditLog('pro_code_sap', row.id, 'UPDATE', row, req.body, req.user.id, req.ip);
  })();

  // ถ้า record เป็น confirmed → regenerate derived_desc ทันที (ค่าสาขาเปลี่ยน)
  if (row.classify_status === 'confirmed') {
    const fresh = db.prepare('SELECT * FROM pro_code_sap WHERE id=?').get(row.id);
    if (fresh) {
      const dd = classifier.generateDerivedDesc(fresh);
      db.prepare('UPDATE pro_code_sap SET derived_desc=? WHERE id=?').run(dd || null, fresh.id);
    }
  }

  // rebuild cache + update confidence ทั้งกลุ่มทันที (ไม่ว่า status ใด)
  const updated = db.prepare('SELECT sap_part1, sap_part2 FROM pro_code_sap WHERE id=?').get(row.id);
  classifier.refreshGroupConfidence(db, updated?.sap_part1, updated?.sap_part2);

  res.json({ ok: true });
});

// ===== POST /api/pro-code-sap/:id/confirm =====
router.post('/:id/confirm', auth, requireRole(['admin']), (req, res) => {
  const row = db.prepare('SELECT * FROM pro_code_sap WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'ไม่พบรหัส SAP นี้' });

  const confirm = db.transaction(() => {
    const result = db.prepare(`
      UPDATE pro_code_sap
        SET classify_status='confirmed', classified_by=?, classified_at=datetime('now'), auto_confidence=100
      WHERE id = ? AND classify_status != 'confirmed'
    `).run(req.user.id, row.id);
    if (result.changes === 0) throw new Error('รหัสนี้ถูกยืนยันแล้ว กรุณารีเฟรชหน้า');
    db.prepare('UPDATE pd_plans SET pro_code_sap_id = ? WHERE product_no = ? AND pro_code_sap_id IS NULL')
      .run(row.id, row.product_no);
    db.auditLog('pro_code_sap', row.id, 'APPROVE', { classify_status: row.classify_status }, { classify_status: 'confirmed' }, req.user.id, req.ip);
  });

  try {
    confirm();
    // Generate derived_desc จากค่าที่ยืนยันแล้ว — ใช้เป็น template สำหรับ Tier-0 matching
    const confirmed = db.prepare('SELECT * FROM pro_code_sap WHERE id=?').get(row.id);
    if (confirmed) {
      const dd = classifier.generateDerivedDesc(confirmed);
      db.prepare('UPDATE pro_code_sap SET derived_desc=? WHERE id=?').run(dd || null, confirmed.id);
    }
    // refresh cache + consistency scores + re-classify auto records in same group
    classifier.refreshGroupConfidence(db, row.sap_part1, row.sap_part2);
    res.json({ ok: true });
  } catch (e) {
    res.status(409).json({ error: e.message });
  }
});

// ===== POST /api/pro-code-sap/:id/reject =====
router.post('/:id/reject', auth, requireRole(['admin']), (req, res) => {
  const row = db.prepare('SELECT * FROM pro_code_sap WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'ไม่พบรหัส SAP นี้' });
  db.transaction(() => {
    db.prepare("UPDATE pro_code_sap SET classify_status='rejected' WHERE id = ?").run(row.id);
    db.auditLog('pro_code_sap', row.id, 'UPDATE', { classify_status: row.classify_status }, { classify_status: 'rejected' }, req.user.id, req.ip);
  })();
  res.json({ ok: true });
});

// ===== POST /api/pro-code-sap/:id/recheck =====
router.post('/:id/recheck', auth, requireRole(['admin']), (req, res) => {
  const row = db.prepare('SELECT * FROM pro_code_sap WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'ไม่พบรหัส SAP นี้' });

  const r = classifier.classify(db, row.product_no, row.product_desc || '');
  const diffs = [];
  for (const f of ATTR_FIELDS) {
    const suggested = r.attrs[f] ?? null;
    const current = row[f] ?? null;
    if (suggested !== null && suggested !== current) {
      diffs.push({ field: f, current, suggested });
    }
  }
  res.json({ confidence: r.confidence, sampleSize: r.sampleSize || 0, attrs: r.attrs, diffs, hasDiffs: diffs.length > 0 });
});

// ===== POST /api/pro-code-sap/:id/apply-recheck =====
router.post('/:id/apply-recheck', auth, requireRole(['admin']), (req, res) => {
  const { fields } = req.body;
  if (!Array.isArray(fields) || fields.length === 0) return res.status(400).json({ error: 'ระบุ fields ที่ต้องการอัปเดต' });

  const row = db.prepare('SELECT * FROM pro_code_sap WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'ไม่พบรหัส SAP นี้' });

  const r = classifier.classify(db, row.product_no, row.product_desc || '');
  const updates = [];
  const params = [];
  for (const f of fields) {
    if (!EDITABLE.includes(f)) continue;
    if (r.attrs[f] !== undefined) { updates.push(`${f} = ?`); params.push(r.attrs[f]); }
  }
  if (!updates.length) return res.status(400).json({ error: 'ไม่มีฟิลด์ที่อัปเดตได้' });

  db.transaction(() => {
    db.prepare(`UPDATE pro_code_sap SET ${updates.join(', ')} WHERE id = ?`).run(...params, row.id);
    db.auditLog('pro_code_sap', row.id, 'UPDATE', row,
      Object.fromEntries(fields.map(f => [f, r.attrs[f]])), req.user.id, req.ip);
  })();

  classifier.refreshGroupConfidence(db, row.sap_part1, row.sap_part2);
  res.json({ ok: true, updated: updates.length });
});

module.exports = router;
