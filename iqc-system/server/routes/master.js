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
// Suppliers CRUD (สร้าง/แก้ไข/เปิด-ปิดใช้งาน) เท่านั้น — จัดซื้อจัดการผู้ผลิตของตัวเองได้ (export/import Excel +
// approval-status ยังคง adminOnly เดิม ไม่ได้อยู่ในขอบเขตคำขอ)
const purchasingOrAdmin = [auth, requireRole(['admin', 'purchasing', 'purchasing_manager'])];

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

function importResponse(results, extra = {}) {
  return {
    results,
    total:        results.length,
    errorCount:   results.filter(r => r.status === 'error').length,
    warningCount: results.filter(r => r.status === 'warning').length,
    // S128k — update/skip: เฉพาะ Suppliers import ที่ผลิต status เหล่านี้จริง (route อื่นจะได้ 0 เสมอ ไม่กระทบ)
    updateCount:  results.filter(r => r.status === 'update').length,
    skipCount:    results.filter(r => r.status === 'skip').length,
    ...extra,
  };
}

function makeResult(row, display, errors, warnings) {
  return { row, display, errors, warnings, status: errors.length ? 'error' : warnings.length ? 'warning' : 'ok' };
}

function parseBool(v) {
  return ['ใช่','yes','y','1','true'].includes(String(v ?? '').trim().toLowerCase());
}

// S129 — normalize null/undefined/'' ให้เท่ากันตอนเทียบ field เดิมกับที่ import เข้ามา (diff-aware import ทุก route)
function normVal(v) {
  return (v === null || v === undefined) ? '' : String(v).trim();
}

// S129 — แถบสีสลับ (zebra stripe) ให้ทุก export sheet กันกรอกข้อมูลผิดแถวตอนแก้ไฟล์เอง — ใช้กับทุก Master List export
function applyZebraStripes(ws, firstDataRow, lastDataRow, colCount) {
  for (let r = firstDataRow; r <= lastDataRow; r++) {
    if ((r - firstDataRow) % 2 === 1) continue; // แถวคี่ (นับจากแถวข้อมูลแรก) ปล่อยว่าง/ขาว
    const row = ws.getRow(r);
    for (let c = 1; c <= colCount; c++) {
      row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F6F8' } };
    }
  }
}

// ── Header validation ────────────────────────────────────────────────────────
// ตรวจ row 1 ว่าตรงกับ template ที่กำหนด (strip *, trim, lowercase ก่อนเปรียบเทียบ)
function checkHeaders(ws, expectedHeaders) {
  const norm = s => String(s ?? '').replace(/\*/g, '').trim().toLowerCase();
  const headerRow = ws.getRow(1);
  const mismatches = [];
  expectedHeaders.forEach((exp, i) => {
    const actual = norm(headerRow.getCell(i + 1).value);
    if (actual !== norm(exp)) {
      mismatches.push(`คอลัมน์ ${i + 1}: คาดหวัง "${exp}" แต่พบ "${actual || '(ว่าง)'}" `);
    }
  });
  return mismatches;
}

// ── Purchasing users (active) — ใช้ทั้ง export (สร้างคอลัมน์) และ import (จับคู่ header กับ user)
function getActivePurchasingUsers() {
  return db.prepare("SELECT id, full_name FROM users WHERE role = 'purchasing' AND is_active = 1 ORDER BY full_name").all();
}

// ── Product groups (active) — ใช้ทั้ง export (สร้างคอลัมน์) และ import (จับคู่ header กับกลุ่ม) — S148 เพิ่ม
// คอลัมน์ "กลุ่มสินค้า" ให้ export/import ของ Suppliers สัมพันธ์กับตารางจริง (มี multi-select กลุ่มสินค้าแล้วตั้งแต่ S146)
function getActiveProductGroups() {
  return db.prepare('SELECT id, name FROM product_groups WHERE is_active = 1 ORDER BY name').all();
}

// ===== SUPPLIERS =====
// S128k — เพิ่มคอลัมน์ "ผู้ดูแลจัดซื้อ" แบบ 1 คอลัมน์ต่อ 1 คน (Y/ว่าง) แทน dropdown เดียว — Excel data validation
// รองรับแค่ single-select ต่อเซลล์ (multi-select ต้องพึ่ง VBA macro ซึ่ง exceljs เขียนไม่ได้ ยืนยันกับ user แล้ว)
// S148 เพิ่มคอลัมน์ "กลุ่มสินค้า" แบบ Y/N-matrix ต่อท้ายคอลัมน์ผู้ดูแลจัดซื้อ (เหตุผลตอนนั้น: กลุ่มสินค้ามีจำนวนน้อย) —
// S149 กลับคำ: user feedback ว่าซับคอลัมน์เยอะดูยาก (จำนวนกลุ่มสินค้าจริงมากกว่าที่คาดตอน S148) → เปลี่ยนเป็นคอลัมน์
// เดียวคั่นด้วย comma (เช่น "กลุ่ม A, กลุ่ม B") เหมือน Products.jsx's Supplier field (S129) — คอลัมน์ผู้ดูแลจัดซื้อ
// (จำนวนน้อยจริง ~3 คน) ยังคงเป็น Y/N-matrix แบบเดิม ไม่เปลี่ยน
router.get('/suppliers/export', ...adminOnly, async (req, res) => {
  const wb = new ExcelJS.Workbook(); wb.creator = 'IQC System';
  const ws = wb.addWorksheet('ผู้ผลิต');
  const purchasingUsers = getActivePurchasingUsers();
  ws.columns = [
    { header: 'รหัสผู้ผลิต',   key: 'code',  width: 16 },
    { header: 'ชื่อผู้ผลิต *', key: 'name',  width: 32 },
    { header: 'อีเมล',         key: 'email', width: 28 },
    { header: 'เบอร์โทร',      key: 'phone', width: 18 },
    { header: 'หมายเหตุ',      key: 'notes', width: 36 },
    { header: 'กลุ่มสินค้า (คั่นด้วย , ถ้ามากกว่า 1)', key: 'groups', width: 36 },
    ...purchasingUsers.map(u => ({ header: u.full_name, key: `pu_${u.id}`, width: 14 })),
  ];
  styleExcelHeader(ws, 6 + purchasingUsers.length);
  const suppliers = db.prepare('SELECT id, code, name, email, phone, notes FROM suppliers ORDER BY name').all();
  attachSupplierPurchasingAssignees(suppliers);
  attachSupplierProductGroups(suppliers);
  suppliers.forEach(r => {
    const assignedIds = new Set(r.purchasing_user_ids);
    const groupNames = (r.product_groups || []).map(g => g.name).sort().join(', ');
    ws.addRow([
      r.code||'', r.name, r.email||'', r.phone||'', r.notes||'', groupNames,
      ...purchasingUsers.map(u => assignedIds.has(u.id) ? 'Y' : ''),
    ]);
  });
  applyZebraStripes(ws, 2, suppliers.length + 1, 6 + purchasingUsers.length);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''suppliers_template.xlsx");
  await wb.xlsx.write(res); res.end();
});

// S128k — diff-aware import: ถ้ารหัส/ชื่อตรงกับ supplier เดิม เช็คทีละ field แทนที่จะ error ทันที
// เหมือนกัน 100% (รวมผู้ดูแลจัดซื้อ+กลุ่มสินค้าที่คอลัมน์จำได้) → skip เงียบๆ ไม่แตะ DB, มีจุดต่างอย่างน้อย 1 จุด → update จริง
// S149 — คอลัมน์ "กลุ่มสินค้า" เปลี่ยนจาก Y/N-matrix เป็น comma-separated เดียว (parse เหมือน Products.jsx's Supplier
// field, S129) — ชื่อกลุ่มที่ไม่รู้จัก = warning เฉยๆ (ไม่ error ทั้งแถว เพราะกลุ่มสินค้าไม่ใช่ field บังคับของ supplier)
router.post('/suppliers/import', ...adminOnly, excelMemUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'กรุณาอัปโหลดไฟล์ .xlsx' });
  let wb; try { wb = await parseImportFile(req.file.buffer); } catch { return res.status(400).json({ error: 'ไฟล์ไม่ถูกต้อง' }); }
  const ws = wb.getWorksheet('ผู้ผลิต') || wb.worksheets[0];
  if (!ws) return res.status(400).json({ error: 'ไม่พบ Sheet ในไฟล์' });

  const hErr = checkHeaders(ws, ['รหัสผู้ผลิต', 'ชื่อผู้ผลิต *', 'อีเมล', 'เบอร์โทร', 'หมายเหตุ', 'กลุ่มสินค้า (คั่นด้วย , ถ้ามากกว่า 1)']);
  if (hErr.length) return res.status(400).json({ error: 'Header ไม่ตรงกับ template — กรุณาใช้ไฟล์ที่ดาวน์โหลดจากระบบ', headerErrors: hErr });

  // คอลัมน์ 7 เป็นต้นไป = ผู้ดูแลจัดซื้อ (Y/N-matrix) — จับคู่ header กับชื่อจริง ณ ตอนนี้ (อาจต่างจากตอน export ถ้ามี
  // คนเพิ่ม/ปิดใช้งานหลังจากนั้น — header ที่จำไม่ได้ = เตือนแล้วข้าม ไม่ error ทั้งไฟล์) ไม่อิงตำแหน่งคอลัมน์คงที่เลย
  // (จับคู่ด้วยชื่อล้วนๆ) กันปัญหาลำดับคอลัมน์ขยับตอนจำนวนผู้ดูแลจัดซื้อเปลี่ยนระหว่าง export กับ import — คอลัมน์ 6
  // (กลุ่มสินค้า) เป็นคอลัมน์คงที่ ไม่อยู่ใน loop นี้ (parse แยกแบบ comma-separated ด้านล่าง)
  const purchasingUsers = getActivePurchasingUsers();
  const productGroups = getActiveProductGroups();
  const nameToId = new Map(purchasingUsers.map(u => [u.full_name.trim().toLowerCase(), u.id]));
  const groupNameToId = new Map(productGroups.map(g => [g.name.trim().toLowerCase(), g.id]));
  const headerRow = ws.getRow(1);
  const lastCol = Math.max(headerRow.cellCount, ws.columnCount || 0, 6);
  const assigneeColumns = []; // [{ col, userId }]
  const unrecognizedHeaders = [];
  for (let c = 7; c <= lastCol; c++) {
    const headerText = String(headerRow.getCell(c).value ?? '').trim();
    if (!headerText) continue;
    const uid = nameToId.get(headerText.toLowerCase());
    if (uid) { assigneeColumns.push({ col: c, userId: uid }); continue; }
    unrecognizedHeaders.push(headerText);
  }
  const recognizedUserIds = assigneeColumns.map(a => a.userId);

  const existingSuppliers = db.prepare('SELECT id, code, name, email, phone, notes FROM suppliers').all();
  const byCode = new Map(), byName = new Map();
  for (const s of existingSuppliers) {
    if (s.code) byCode.set(s.code.toLowerCase(), s);
    byName.set(s.name.toLowerCase(), s);
  }
  // ผู้ดูแลจัดซื้อปัจจุบันของแต่ละ supplier — จำกัดเฉพาะคอลัมน์ที่ไฟล์นี้จำได้ (กันไม่ให้ import ไปล้างผู้ดูแลที่ถูก
  // เพิ่มเข้าระบบทีหลัง ไม่มีคอลัมน์ในไฟล์เก่าเลย) — กลุ่มสินค้าเป็นคอลัมน์เดียว comma-separated จึงไม่ต้อง scope
  // (คอลัมน์เดียวแทนสมาชิกทั้งหมดเสมอ เหมือน Products.jsx's Supplier field)
  const currentAssigneesBySupplier = new Map(); // supplierId -> Set(userId)
  if (recognizedUserIds.length && existingSuppliers.length) {
    const ph1 = existingSuppliers.map(() => '?').join(',');
    const ph2 = recognizedUserIds.map(() => '?').join(',');
    for (const row of db.prepare(`SELECT supplier_id, user_id FROM supplier_purchasing_assignees WHERE supplier_id IN (${ph1}) AND user_id IN (${ph2})`)
      .all(...existingSuppliers.map(s => s.id), ...recognizedUserIds)) {
      if (!currentAssigneesBySupplier.has(row.supplier_id)) currentAssigneesBySupplier.set(row.supplier_id, new Set());
      currentAssigneesBySupplier.get(row.supplier_id).add(row.user_id);
    }
  }
  const currentGroupsBySupplier = new Map(); // supplierId -> Set(groupId)
  if (existingSuppliers.length) {
    const ph1 = existingSuppliers.map(() => '?').join(',');
    for (const row of db.prepare(`SELECT supplier_id, product_group_id FROM supplier_product_groups WHERE supplier_id IN (${ph1})`)
      .all(...existingSuppliers.map(s => s.id))) {
      if (!currentGroupsBySupplier.has(row.supplier_id)) currentGroupsBySupplier.set(row.supplier_id, new Set());
      currentGroupsBySupplier.get(row.supplier_id).add(row.product_group_id);
    }
  }

  const nameOfUser = id => purchasingUsers.find(u => u.id === id)?.full_name || String(id);
  const nameOfGroup = id => productGroups.find(g => g.id === id)?.name || String(id);
  const seenCodes = new Set(), seenNames = new Set(), results = [];

  ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum === 1) return;
    const code = cellStr(row,1), name = cellStr(row,2), email = cellStr(row,3), phone = cellStr(row,4), notes = cellStr(row,5);
    const groupCell = cellStr(row,6);
    if (!name && !code) return;
    const errors = [], warnings = [];
    if (!name) errors.push('ชื่อผู้ผลิตห้ามว่าง');
    // ซ้ำในไฟล์เดียวกันเท่านั้นที่ยัง error ตรงๆ (2 แถวอ้างรหัส/ชื่อเดียวกันในไฟล์เดียวกันคือข้อมูลกำกวม ไม่ใช่ update ที่ถูกต้อง)
    if (code) {
      if (seenCodes.has(code.toLowerCase())) errors.push(`รหัส "${code}" ซ้ำในไฟล์`);
      else seenCodes.add(code.toLowerCase());
    }
    if (name) {
      if (seenNames.has(name.toLowerCase())) warnings.push(`ชื่อ "${name}" ซ้ำในไฟล์`);
      else seenNames.add(name.toLowerCase());
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) warnings.push(`อีเมลรูปแบบไม่ถูกต้อง`);

    const rowAssigneeIds = new Set(assigneeColumns.filter(a => parseBool(cellStr(row, a.col))).map(a => a.userId));
    // กลุ่มสินค้า — comma-separated, ไม่บังคับ (ไม่มี field นี้ = ไม่มีกลุ่มเลยก็ได้) ชื่อไม่รู้จัก = warning ข้ามไว้
    const rowGroupIds = new Set();
    for (const gName of groupCell.split(',').map(s => s.trim()).filter(Boolean)) {
      const gid = groupNameToId.get(gName.toLowerCase());
      if (gid) rowGroupIds.add(gid);
      else warnings.push(`ไม่พบกลุ่มสินค้า "${gName}" ในระบบ — ข้ามไว้ก่อน`);
    }
    const display = { รหัส: code||'-', ชื่อผู้ผลิต: name, อีเมล: email||'-', เบอร์โทร: phone||'-' };
    const _data = { code:code||null, name, email:email||null, phone:phone||null, notes:notes||null, assigneeIds: [...rowAssigneeIds], groupIds: [...rowGroupIds] };

    if (errors.length) { results.push({ row: rowNum, display, errors, warnings, status: 'error', _data }); return; }

    const existing = (code && byCode.get(code.toLowerCase())) || (name && byName.get(name.toLowerCase())) || null;

    if (existing) {
      _data.id = existing.id;
      const currentIds = currentAssigneesBySupplier.get(existing.id) || new Set();
      const currentGroupIds = currentGroupsBySupplier.get(existing.id) || new Set();
      const changes = [];
      if (normVal(existing.name)  !== normVal(name))  changes.push(`ชื่อ: "${existing.name}" → "${name}"`);
      if (normVal(existing.email) !== normVal(email)) changes.push(`อีเมล: "${existing.email||'-'}" → "${email||'-'}"`);
      if (normVal(existing.phone) !== normVal(phone)) changes.push(`เบอร์โทร: "${existing.phone||'-'}" → "${phone||'-'}"`);
      if (normVal(existing.notes) !== normVal(notes)) changes.push(`หมายเหตุ: "${existing.notes||'-'}" → "${notes||'-'}"`);
      const added   = [...rowAssigneeIds].filter(id => !currentIds.has(id));
      const removed = [...currentIds].filter(id => !rowAssigneeIds.has(id));
      if (added.length || removed.length) {
        const parts = [];
        if (added.length)   parts.push(`+${added.map(nameOfUser).join(', ')}`);
        if (removed.length) parts.push(`-${removed.map(nameOfUser).join(', ')}`);
        changes.push(`ผู้ดูแลจัดซื้อ: ${parts.join(' ')}`);
      }
      const addedG   = [...rowGroupIds].filter(id => !currentGroupIds.has(id));
      const removedG = [...currentGroupIds].filter(id => !rowGroupIds.has(id));
      if (addedG.length || removedG.length) {
        const parts = [];
        if (addedG.length)   parts.push(`+${addedG.map(nameOfGroup).join(', ')}`);
        if (removedG.length) parts.push(`-${removedG.map(nameOfGroup).join(', ')}`);
        changes.push(`กลุ่มสินค้า: ${parts.join(' ')}`);
      }
      if (!changes.length) {
        results.push({ row: rowNum, display, errors: [], warnings, status: 'skip', changes: [], _data });
      } else {
        results.push({ row: rowNum, display, errors: [], warnings, status: 'update', changes, _data });
      }
    } else {
      results.push({ row: rowNum, display, errors: [], warnings, status: warnings.length ? 'warning' : 'ok', _data });
    }
  });

  if (!results.length) return res.status(400).json({ error: 'ไม่พบข้อมูลในไฟล์' });
  const headerWarnings = unrecognizedHeaders.length
    ? [`ไม่รู้จักคอลัมน์: ${unrecognizedHeaders.join(', ')} — ข้ามคอลัมน์นี้ (ต้องตรงกับชื่อผู้ดูแลจัดซื้อที่ยัง active อยู่)`]
    : undefined;
  if (req.query.preview === '1') return res.json(importResponse(results, headerWarnings ? { headerWarnings } : {}));
  if (results.some(r => r.errors.length)) return res.status(400).json({ error: 'มีข้อมูลที่ไม่ถูกต้อง' });

  const insSupplier = db.prepare('INSERT INTO suppliers (code, name, email, phone, notes) VALUES (?, ?, ?, ?, ?)');
  const updSupplier = db.prepare('UPDATE suppliers SET code=?, name=?, email=?, phone=?, notes=? WHERE id=?');
  const insAssignee = db.prepare('INSERT OR IGNORE INTO supplier_purchasing_assignees (supplier_id, user_id) VALUES (?, ?)');
  const delAssigneesScoped = recognizedUserIds.length
    ? db.prepare(`DELETE FROM supplier_purchasing_assignees WHERE supplier_id = ? AND user_id IN (${recognizedUserIds.map(() => '?').join(',')})`)
    : null;
  function syncAssignees(supplierId, assigneeIds) {
    if (delAssigneesScoped) delAssigneesScoped.run(supplierId, ...recognizedUserIds);
    for (const uid of assigneeIds) insAssignee.run(supplierId, uid);
  }
  const insGroup = db.prepare('INSERT OR IGNORE INTO supplier_product_groups (supplier_id, product_group_id) VALUES (?, ?)');
  const delGroups = db.prepare('DELETE FROM supplier_product_groups WHERE supplier_id = ?');
  function syncGroups(supplierId, groupIds) {
    delGroups.run(supplierId);
    for (const gid of groupIds) insGroup.run(supplierId, gid);
  }

  const doImport = db.transaction(rows => {
    let inserted = 0, updated = 0, skipped = 0;
    for (const r of rows) {
      if (r.status === 'skip') { skipped++; continue; }
      const d = r._data;
      if (r.status === 'update') {
        const old = existingSuppliers.find(s => s.id === d.id);
        updSupplier.run(d.code, d.name, d.email, d.phone, d.notes, d.id);
        syncAssignees(d.id, d.assigneeIds);
        syncGroups(d.id, d.groupIds);
        db.auditLog('suppliers', d.id, 'UPDATE', old, { name: d.name, email: d.email, phone: d.phone, notes: d.notes, source: 'excel_import' }, req.user.id, req.ip);
        updated++;
      } else {
        const res2 = insSupplier.run(d.code, d.name, d.email, d.phone, d.notes);
        if (d.assigneeIds.length) syncAssignees(res2.lastInsertRowid, d.assigneeIds);
        if (d.groupIds.length) syncGroups(res2.lastInsertRowid, d.groupIds);
        db.auditLog('suppliers', res2.lastInsertRowid, 'CREATE', null, { name: d.name, source: 'excel_import' }, req.user.id, req.ip);
        inserted++;
      }
    }
    return { inserted, updated, skipped };
  });
  try {
    const { inserted, updated, skipped } = doImport(results);
    res.json({ success: true, imported: inserted, updated, skipped });
  }
  catch (e) { res.status(e.message?.includes('UNIQUE') ? 400 : 500).json({ error: e.message?.includes('UNIQUE') ? 'รหัสหรือชื่อซ้ำ' : e.message }); }
});

// ผู้ดูแลจัดซื้อต่อ supplier (many-to-many) — batch-attach เหมือน attachProductSubqueries
function attachSupplierPurchasingAssignees(rows) {
  if (!rows.length) return;
  const ids = rows.map(r => r.id);
  const ph = ids.map(() => '?').join(',');
  const byAssignee = {};
  for (const r of db.prepare(`
    SELECT spa.supplier_id, u.id as user_id, u.full_name
    FROM supplier_purchasing_assignees spa JOIN users u ON u.id = spa.user_id
    WHERE spa.supplier_id IN (${ph}) ORDER BY u.full_name
  `).all(...ids)) {
    (byAssignee[r.supplier_id] = byAssignee[r.supplier_id] || []).push({ user_id: r.user_id, full_name: r.full_name });
  }
  for (const row of rows) {
    row.purchasing_assignees = byAssignee[row.id] || [];
    row.purchasing_user_ids = row.purchasing_assignees.map(a => a.user_id);
  }
}

// กลุ่มสินค้าที่ supplier ผลิต/ส่งได้ต่อราย (many-to-many) — batch-attach เหมือน attachSupplierPurchasingAssignees
// (S146) ใช้กรอง Supplier ตามกลุ่มสินค้าในฟอร์มเพิ่มสินค้าใหม่ (Products.jsx)
function attachSupplierProductGroups(rows) {
  if (!rows.length) return;
  const ids = rows.map(r => r.id);
  const ph = ids.map(() => '?').join(',');
  const byGroup = {};
  for (const r of db.prepare(`
    SELECT spg.supplier_id, pg.id as group_id, pg.name
    FROM supplier_product_groups spg JOIN product_groups pg ON pg.id = spg.product_group_id
    WHERE spg.supplier_id IN (${ph}) ORDER BY pg.name
  `).all(...ids)) {
    (byGroup[r.supplier_id] = byGroup[r.supplier_id] || []).push({ group_id: r.group_id, name: r.name });
  }
  for (const row of rows) {
    row.product_groups = byGroup[row.id] || [];
    row.product_group_ids = row.product_groups.map(g => g.group_id);
  }
}

// รายชื่อจัดซื้อ (id/full_name เท่านั้น) สำหรับ dropdown เลือกผู้ดูแลใน SupplierForm — แยกจาก /api/admin/users
// (adminOnly, คืนข้อมูล user ทั้งหมดรวม telegram_chat_id/auth_provider) เพื่อให้ purchasing/purchasing_manager
// เข้าถึงได้โดยไม่ต้องเปิดสิทธิ์ admin user management ทั้งหมด
router.get('/purchasing-users', ...purchasingOrAdmin, (req, res) => {
  res.json(db.prepare("SELECT id, full_name FROM users WHERE role = 'purchasing' AND is_active = 1 ORDER BY full_name").all());
});

router.get('/suppliers', auth, (req, res) => {
  const { all, page, limit: lim, q = '', assigned_to, unassigned } = req.query;
  const includeInactive = all === '1';
  if (page !== undefined) {
    const pg = Math.max(1, +page || 1);
    const perPage = Math.min(100, Math.max(1, +lim || 20));
    const offset = (pg - 1) * perPage;
    const activeCl = includeInactive ? '' : 'AND is_active = 1';
    const searchCl = q ? "AND (name LIKE ? OR COALESCE(code,'') LIKE ?)" : '';
    const sp = q ? [`%${q}%`, `%${q}%`] : [];
    // Master List Suppliers (Master List filter สำหรับจัดซื้อ) — เจ้าที่ตัวเองดูแล (assigned_to) หรือเจ้าที่ยังไม่มี
    // ผู้ดูแลเลย (unassigned) — ไม่กระทบ default (ไม่ส่ง param ใดๆ = เห็นทั้งหมดเหมือนเดิม, admin/purchasing_manager)
    let assignCl = '';
    const assignParams = [];
    if (assigned_to) {
      assignCl = 'AND EXISTS (SELECT 1 FROM supplier_purchasing_assignees spa WHERE spa.supplier_id = suppliers.id AND spa.user_id = ?)';
      assignParams.push(assigned_to);
    } else if (unassigned === '1') {
      assignCl = 'AND NOT EXISTS (SELECT 1 FROM supplier_purchasing_assignees spa WHERE spa.supplier_id = suppliers.id)';
    }
    const total = db.prepare(`SELECT COUNT(*) as c FROM suppliers WHERE 1=1 ${activeCl} ${searchCl} ${assignCl}`).get(...sp, ...assignParams);
    const rows = db.prepare(`SELECT * FROM suppliers WHERE 1=1 ${activeCl} ${searchCl} ${assignCl} ORDER BY name LIMIT ? OFFSET ?`).all(...sp, ...assignParams, perPage, offset);
    attachSupplierPurchasingAssignees(rows);
    attachSupplierProductGroups(rows);
    return res.json({ data: rows, total: total.c, page: pg, limit: perPage });
  }
  const rows = includeInactive
    ? db.prepare('SELECT * FROM suppliers ORDER BY name').all()
    : db.prepare('SELECT * FROM suppliers WHERE is_active = 1 ORDER BY name').all();
  attachSupplierPurchasingAssignees(rows);
  attachSupplierProductGroups(rows);
  res.json(rows);
});

router.post('/suppliers', ...purchasingOrAdmin, (req, res) => {
  const { code, name, email, phone, notes, purchasing_user_ids, product_group_ids } = req.body;
  if (!name) return res.status(400).json({ error: 'กรุณากรอกชื่อผู้ผลิต' });
  try {
    const create = db.transaction(() => {
      const result = db.prepare('INSERT INTO suppliers (code, name, email, phone, notes) VALUES (?, ?, ?, ?, ?)').run(code || null, name, email || null, phone || null, notes || null);
      if (Array.isArray(purchasing_user_ids) && purchasing_user_ids.length) {
        const insAssignee = db.prepare('INSERT OR IGNORE INTO supplier_purchasing_assignees (supplier_id, user_id) VALUES (?, ?)');
        for (const uid of purchasing_user_ids) insAssignee.run(result.lastInsertRowid, uid);
      }
      if (Array.isArray(product_group_ids) && product_group_ids.length) {
        const insGroup = db.prepare('INSERT OR IGNORE INTO supplier_product_groups (supplier_id, product_group_id) VALUES (?, ?)');
        for (const gid of product_group_ids) insGroup.run(result.lastInsertRowid, gid);
      }
      db.auditLog('suppliers', result.lastInsertRowid, 'CREATE', null, { name, purchasing_user_ids, product_group_ids }, req.user.id, req.ip);
      return result.lastInsertRowid;
    });
    const id = create();
    const row = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
    attachSupplierPurchasingAssignees([row]);
    attachSupplierProductGroups([row]);
    res.json(row);
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'รหัสผู้ผลิตซ้ำ' });
    res.status(500).json({ error: e.message });
  }
});

router.patch('/suppliers/:id', ...purchasingOrAdmin, (req, res) => {
  const { code, name, email, phone, notes, purchasing_user_ids, product_group_ids } = req.body;
  if (!name) return res.status(400).json({ error: 'กรุณากรอกชื่อผู้ผลิต' });
  try {
    const old = db.prepare('SELECT * FROM suppliers WHERE id=?').get(req.params.id);
    const upd = db.transaction(() => {
      db.prepare('UPDATE suppliers SET code=?, name=?, email=?, phone=?, notes=? WHERE id=?').run(code || null, name, email || null, phone || null, notes || null, req.params.id);
      if (Array.isArray(purchasing_user_ids)) {
        db.prepare('DELETE FROM supplier_purchasing_assignees WHERE supplier_id = ?').run(req.params.id);
        const insAssignee = db.prepare('INSERT OR IGNORE INTO supplier_purchasing_assignees (supplier_id, user_id) VALUES (?, ?)');
        for (const uid of purchasing_user_ids) insAssignee.run(req.params.id, uid);
      }
      if (Array.isArray(product_group_ids)) {
        db.prepare('DELETE FROM supplier_product_groups WHERE supplier_id = ?').run(req.params.id);
        const insGroup = db.prepare('INSERT OR IGNORE INTO supplier_product_groups (supplier_id, product_group_id) VALUES (?, ?)');
        for (const gid of product_group_ids) insGroup.run(req.params.id, gid);
      }
      db.auditLog('suppliers', req.params.id, 'UPDATE', old, { name, purchasing_user_ids, product_group_ids }, req.user.id, req.ip);
    });
    upd();
    const row = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
    attachSupplierPurchasingAssignees([row]);
    attachSupplierProductGroups([row]);
    res.json(row);
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'รหัสผู้ผลิตซ้ำ' });
    res.status(500).json({ error: e.message });
  }
});

router.patch('/suppliers/:id/toggle', ...purchasingOrAdmin, (req, res) => {
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
// S129 — เพิ่ม has_shelf_life/shelf_life_days (มีอยู่ในตารางจริง+ใช้ใน POST/PATCH JSON API อยู่แล้ว แต่ export/import
// Excel เดิมไม่เคยมี 2 คอลัมน์นี้เลย)
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
    { header: 'มีอายุการเก็บ',        key: 'shelf', width: 18 },
    { header: 'อายุการเก็บ (วัน)',    key: 'shelf_days', width: 18 },
  ];
  styleExcelHeader(ws, 8);

  // Dropdown ใช่/"" สำหรับ boolean columns
  const dvYN = { type: 'list', allowBlank: true, formulae: ['"ใช่,"'] };
  for (let r = 2; r <= 300; r++) {
    [3,4,5,6,7].forEach(c => { ws.getCell(r, c).dataValidation = dvYN; });
  }

  const rows = db.prepare('SELECT code, name, require_inspection_doc, require_lot_number, require_expiry_date, require_certificate, has_shelf_life, shelf_life_days FROM product_groups ORDER BY name').all();
  rows.forEach(r => ws.addRow([
    r.code||'', r.name,
    r.require_inspection_doc ? 'ใช่' : '',
    r.require_lot_number     ? 'ใช่' : '',
    r.require_expiry_date    ? 'ใช่' : '',
    r.require_certificate    ? 'ใช่' : '',
    r.has_shelf_life          ? 'ใช่' : '',
    r.shelf_life_days ?? '',
  ]));
  applyZebraStripes(ws, 2, rows.length + 1, 8);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''product_groups_template.xlsx");
  await wb.xlsx.write(res); res.end();
});

// S129 — diff-aware: เหมือนกัน 100% (รวม has_shelf_life/shelf_life_days) → skip, ต่างจุดใดจุดหนึ่ง → update จริง
router.post('/product-groups/import', ...adminOnly, excelMemUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'กรุณาอัปโหลดไฟล์ .xlsx' });
  let wb; try { wb = await parseImportFile(req.file.buffer); } catch { return res.status(400).json({ error: 'ไฟล์ไม่ถูกต้อง' }); }
  const ws = wb.getWorksheet('กลุ่มสินค้า') || wb.worksheets[0];
  if (!ws) return res.status(400).json({ error: 'ไม่พบ Sheet ในไฟล์' });

  const hErr = checkHeaders(ws, ['รหัสกลุ่ม', 'ชื่อกลุ่มสินค้า *', 'บังคับเอกสารตรวจ', 'บังคับ Lot Number', 'บังคับวันหมดอายุ', 'บังคับ Certificate', 'มีอายุการเก็บ', 'อายุการเก็บ (วัน)']);
  if (hErr.length) return res.status(400).json({ error: 'Header ไม่ตรงกับ template — กรุณาใช้ไฟล์ที่ดาวน์โหลดจากระบบ', headerErrors: hErr });

  const existingGroups = db.prepare('SELECT * FROM product_groups').all();
  const byCode = new Map(), byName = new Map();
  for (const g of existingGroups) {
    if (g.code) byCode.set(g.code.toLowerCase(), g);
    byName.set(g.name.toLowerCase(), g);
  }

  const seenNames = new Set(), seenCodes = new Set(), results = [];

  ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum === 1) return;
    const code = cellStr(row,1), name = cellStr(row,2);
    const doc  = parseBool(row.getCell(3).value), lot  = parseBool(row.getCell(4).value);
    const exp  = parseBool(row.getCell(5).value), cert = parseBool(row.getCell(6).value);
    const shelf = parseBool(row.getCell(7).value);
    const shelfDaysStr = cellStr(row,8);
    const shelfDays = shelfDaysStr ? Number(shelfDaysStr) : null;
    if (!name && !code) return;
    const errors = [], warnings = [];
    if (!name) errors.push('ชื่อกลุ่มห้ามว่าง');
    if (shelfDaysStr && !Number.isFinite(shelfDays)) errors.push('อายุการเก็บ (วัน) ต้องเป็นตัวเลข');
    if (code) {
      if (seenCodes.has(code.toLowerCase())) errors.push(`รหัส "${code}" ซ้ำในไฟล์`);
      else seenCodes.add(code.toLowerCase());
    }
    if (name) {
      if (seenNames.has(name.toLowerCase())) warnings.push(`ชื่อ "${name}" ซ้ำในไฟล์`);
      else seenNames.add(name.toLowerCase());
    }

    const display = { รหัส: code||'-', ชื่อกลุ่ม: name, 'เอกสารตรวจ': doc?'ใช่':'-', Lot: lot?'ใช่':'-', 'หมดอายุ': exp?'ใช่':'-', Certificate: cert?'ใช่':'-', 'อายุการเก็บ': shelf?'ใช่':'-' };
    const _data = { code:code||null, name, doc, lot, exp, cert, shelf, shelfDays };

    if (errors.length) { results.push({ row: rowNum, display, errors, warnings, status: 'error', _data }); return; }

    const existing = (code && byCode.get(code.toLowerCase())) || (name && byName.get(name.toLowerCase())) || null;
    if (existing) {
      _data.id = existing.id;
      const changes = [];
      if (normVal(existing.name) !== normVal(name)) changes.push(`ชื่อ: "${existing.name}" → "${name}"`);
      if (!!existing.require_inspection_doc !== doc) changes.push(`บังคับเอกสารตรวจ: ${existing.require_inspection_doc?'ใช่':'-'} → ${doc?'ใช่':'-'}`);
      if (!!existing.require_lot_number     !== lot) changes.push(`บังคับ Lot Number: ${existing.require_lot_number?'ใช่':'-'} → ${lot?'ใช่':'-'}`);
      if (!!existing.require_expiry_date    !== exp) changes.push(`บังคับวันหมดอายุ: ${existing.require_expiry_date?'ใช่':'-'} → ${exp?'ใช่':'-'}`);
      if (!!existing.require_certificate    !== cert) changes.push(`บังคับ Certificate: ${existing.require_certificate?'ใช่':'-'} → ${cert?'ใช่':'-'}`);
      if (!!existing.has_shelf_life         !== shelf) changes.push(`มีอายุการเก็บ: ${existing.has_shelf_life?'ใช่':'-'} → ${shelf?'ใช่':'-'}`);
      if (normVal(existing.shelf_life_days) !== normVal(shelfDays)) changes.push(`อายุการเก็บ (วัน): "${existing.shelf_life_days??'-'}" → "${shelfDays??'-'}"`);
      if (!changes.length) results.push({ row: rowNum, display, errors: [], warnings, status: 'skip', changes: [], _data });
      else results.push({ row: rowNum, display, errors: [], warnings, status: 'update', changes, _data });
    } else {
      results.push({ row: rowNum, display, errors: [], warnings, status: warnings.length ? 'warning' : 'ok', _data });
    }
  });

  if (!results.length) return res.status(400).json({ error: 'ไม่พบข้อมูลในไฟล์' });
  if (req.query.preview === '1') return res.json(importResponse(results));
  if (results.some(r => r.errors.length)) return res.status(400).json({ error: 'มีข้อมูลที่ไม่ถูกต้อง' });

  const ins = db.prepare('INSERT INTO product_groups (code, name, require_inspection_doc, require_lot_number, require_expiry_date, require_certificate, has_shelf_life, shelf_life_days) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const upd = db.prepare('UPDATE product_groups SET code=?, name=?, require_inspection_doc=?, require_lot_number=?, require_expiry_date=?, require_certificate=?, has_shelf_life=?, shelf_life_days=? WHERE id=?');
  const doImport = db.transaction(rows => {
    let inserted = 0, updated = 0, skipped = 0;
    for (const r of rows) {
      if (r.status === 'skip') { skipped++; continue; }
      const d = r._data;
      if (r.status === 'update') {
        const old = existingGroups.find(g => g.id === d.id);
        upd.run(d.code, d.name, d.doc?1:0, d.lot?1:0, d.exp?1:0, d.cert?1:0, d.shelf?1:0, d.shelfDays, d.id);
        db.auditLog('product_groups', d.id, 'UPDATE', old, { name: d.name, source: 'excel_import' }, req.user.id, req.ip);
        updated++;
      } else {
        const res2 = ins.run(d.code, d.name, d.doc?1:0, d.lot?1:0, d.exp?1:0, d.cert?1:0, d.shelf?1:0, d.shelfDays);
        db.auditLog('product_groups', res2.lastInsertRowid, 'CREATE', null, { name: d.name, source: 'excel_import' }, req.user.id, req.ip);
        inserted++;
      }
    }
    return { inserted, updated, skipped };
  });
  try {
    const { inserted, updated, skipped } = doImport(results);
    res.json({ success: true, imported: inserted, updated, skipped });
  }
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
  const rows = db.prepare('SELECT name, abbreviation FROM units ORDER BY name').all();
  rows.forEach(r => ws.addRow([r.name, r.abbreviation||'']));
  applyZebraStripes(ws, 2, rows.length + 1, 2);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''units_template.xlsx");
  await wb.xlsx.write(res); res.end();
});

router.post('/units/import', ...adminOnly, excelMemUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'กรุณาอัปโหลดไฟล์ .xlsx' });
  let wb; try { wb = await parseImportFile(req.file.buffer); } catch { return res.status(400).json({ error: 'ไฟล์ไม่ถูกต้อง' }); }
  const ws = wb.getWorksheet('หน่วยนับ') || wb.worksheets[0];
  if (!ws) return res.status(400).json({ error: 'ไม่พบ Sheet ในไฟล์' });

  const hErr = checkHeaders(ws, ['ชื่อหน่วยนับ *', 'ตัวย่อ']);
  if (hErr.length) return res.status(400).json({ error: 'Header ไม่ตรงกับ template — กรุณาใช้ไฟล์ที่ดาวน์โหลดจากระบบ', headerErrors: hErr });

  // S129 — diff-aware: ไม่มี code column ให้ Units จึง match ด้วยชื่อ (case-insensitive) เท่านั้น
  const existingUnits = db.prepare('SELECT * FROM units').all();
  const byName = new Map(existingUnits.map(u => [u.name.toLowerCase(), u]));
  const seenNames = new Set(), results = [];

  ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum === 1) return;
    const name = cellStr(row,1), abbr = cellStr(row,2);
    if (!name) return;
    const errors = [], warnings = [];
    if (seenNames.has(name.toLowerCase())) errors.push(`"${name}" ซ้ำในไฟล์`);
    else seenNames.add(name.toLowerCase());

    const display = { ชื่อหน่วยนับ: name, ตัวย่อ: abbr||'-' };
    const _data = { name, abbr: abbr||null };
    if (errors.length) { results.push({ row: rowNum, display, errors, warnings, status: 'error', _data }); return; }

    const existing = byName.get(name.toLowerCase());
    if (existing) {
      _data.id = existing.id;
      const changes = [];
      if (normVal(existing.abbreviation) !== normVal(abbr)) changes.push(`ตัวย่อ: "${existing.abbreviation||'-'}" → "${abbr||'-'}"`);
      if (!changes.length) results.push({ row: rowNum, display, errors: [], warnings, status: 'skip', changes: [], _data });
      else results.push({ row: rowNum, display, errors: [], warnings, status: 'update', changes, _data });
    } else {
      results.push({ row: rowNum, display, errors: [], warnings, status: warnings.length ? 'warning' : 'ok', _data });
    }
  });

  if (!results.length) return res.status(400).json({ error: 'ไม่พบข้อมูลในไฟล์' });
  if (req.query.preview === '1') return res.json(importResponse(results));
  if (results.some(r => r.errors.length)) return res.status(400).json({ error: 'มีข้อมูลที่ไม่ถูกต้อง' });

  const ins = db.prepare('INSERT INTO units (name, abbreviation) VALUES (?, ?)');
  const upd = db.prepare('UPDATE units SET name=?, abbreviation=? WHERE id=?');
  const doImport = db.transaction(rows => {
    let inserted = 0, updated = 0, skipped = 0;
    for (const r of rows) {
      if (r.status === 'skip') { skipped++; continue; }
      const d = r._data;
      if (r.status === 'update') {
        const old = existingUnits.find(u => u.id === d.id);
        upd.run(d.name, d.abbr, d.id);
        db.auditLog('units', d.id, 'UPDATE', old, { name: d.name, source: 'excel_import' }, req.user.id, req.ip);
        updated++;
        continue;
      }
      const res2 = ins.run(d.name, d.abbr);
      db.auditLog('units', res2.lastInsertRowid, 'CREATE', null, { name: d.name, source: 'excel_import' }, req.user.id, req.ip);
      inserted++;
    }
    return { inserted, updated, skipped };
  });
  try {
    const { inserted, updated, skipped } = doImport(results);
    res.json({ success: true, imported: inserted, updated, skipped });
  }
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
  const rows = db.prepare('SELECT code, name, notes FROM defect_categories ORDER BY name').all();
  rows.forEach(r => ws.addRow([r.code||'', r.name, r.notes||'']));
  applyZebraStripes(ws, 2, rows.length + 1, 3);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''defect_categories_template.xlsx");
  await wb.xlsx.write(res); res.end();
});

// S129 — diff-aware: เหมือนกัน 100% → skip, ต่าง → update จริง
router.post('/defect-categories/import', ...adminOnly, excelMemUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'กรุณาอัปโหลดไฟล์ .xlsx' });
  let wb; try { wb = await parseImportFile(req.file.buffer); } catch { return res.status(400).json({ error: 'ไฟล์ไม่ถูกต้อง' }); }
  const ws = wb.getWorksheet('กลุ่มปัญหา') || wb.worksheets[0];
  if (!ws) return res.status(400).json({ error: 'ไม่พบ Sheet ในไฟล์' });

  const hErr = checkHeaders(ws, ['รหัส', 'ชื่อกลุ่มปัญหา *', 'หมายเหตุ']);
  if (hErr.length) return res.status(400).json({ error: 'Header ไม่ตรงกับ template — กรุณาใช้ไฟล์ที่ดาวน์โหลดจากระบบ', headerErrors: hErr });

  const existingCats = db.prepare('SELECT * FROM defect_categories').all();
  const byCode = new Map(), byName = new Map();
  for (const c of existingCats) {
    if (c.code) byCode.set(c.code.toLowerCase(), c);
    byName.set(c.name.toLowerCase(), c);
  }
  const seenNames = new Set(), seenCodes = new Set(), results = [];

  ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum === 1) return;
    const code = cellStr(row,1), name = cellStr(row,2), notes = cellStr(row,3);
    if (!name && !code) return;
    const errors = [], warnings = [];
    if (!name) errors.push('ชื่อกลุ่มปัญหาห้ามว่าง');
    if (code) {
      if (seenCodes.has(code.toLowerCase())) errors.push(`รหัส "${code}" ซ้ำในไฟล์`);
      else seenCodes.add(code.toLowerCase());
    }
    if (name) {
      if (seenNames.has(name.toLowerCase())) warnings.push(`ชื่อ "${name}" ซ้ำในไฟล์`);
      else seenNames.add(name.toLowerCase());
    }

    const display = { รหัส: code||'-', ชื่อกลุ่มปัญหา: name, หมายเหตุ: notes||'-' };
    const _data = { code:code||null, name, notes:notes||null };
    if (errors.length) { results.push({ row: rowNum, display, errors, warnings, status: 'error', _data }); return; }

    const existing = (code && byCode.get(code.toLowerCase())) || (name && byName.get(name.toLowerCase())) || null;
    if (existing) {
      _data.id = existing.id;
      const changes = [];
      if (normVal(existing.name)  !== normVal(name))  changes.push(`ชื่อ: "${existing.name}" → "${name}"`);
      if (normVal(existing.notes) !== normVal(notes)) changes.push(`หมายเหตุ: "${existing.notes||'-'}" → "${notes||'-'}"`);
      if (!changes.length) results.push({ row: rowNum, display, errors: [], warnings, status: 'skip', changes: [], _data });
      else results.push({ row: rowNum, display, errors: [], warnings, status: 'update', changes, _data });
    } else {
      results.push({ row: rowNum, display, errors: [], warnings, status: warnings.length ? 'warning' : 'ok', _data });
    }
  });

  if (!results.length) return res.status(400).json({ error: 'ไม่พบข้อมูลในไฟล์' });
  if (req.query.preview === '1') return res.json(importResponse(results));
  if (results.some(r => r.errors.length)) return res.status(400).json({ error: 'มีข้อมูลที่ไม่ถูกต้อง' });

  const ins = db.prepare('INSERT INTO defect_categories (code, name, notes) VALUES (?, ?, ?)');
  const upd = db.prepare('UPDATE defect_categories SET code=?, name=?, notes=? WHERE id=?');
  const doImport = db.transaction(rows => {
    let inserted = 0, updated = 0, skipped = 0;
    for (const r of rows) {
      if (r.status === 'skip') { skipped++; continue; }
      const d = r._data;
      if (r.status === 'update') {
        const old = existingCats.find(c => c.id === d.id);
        upd.run(d.code, d.name, d.notes, d.id);
        db.auditLog('defect_categories', d.id, 'UPDATE', old, { name: d.name, source: 'excel_import' }, req.user.id, req.ip);
        updated++;
        continue;
      }
      const res2 = ins.run(d.code, d.name, d.notes);
      db.auditLog('defect_categories', res2.lastInsertRowid, 'CREATE', null, { name: d.name, source: 'excel_import' }, req.user.id, req.ip);
      inserted++;
    }
    return { inserted, updated, skipped };
  });
  try {
    const { inserted, updated, skipped } = doImport(results);
    res.json({ success: true, imported: inserted, updated, skipped });
  }
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
  const rows = db.prepare('SELECT code, name, hex_code FROM colors ORDER BY name').all();
  rows.forEach(r => ws.addRow([r.code||'', r.name, r.hex_code||'']));
  applyZebraStripes(ws, 2, rows.length + 1, 3);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''colors_template.xlsx");
  await wb.xlsx.write(res); res.end();
});

// S129 — diff-aware: เหมือนกัน 100% → skip, ต่าง → update จริง
router.post('/colors/import', ...adminOnly, excelMemUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'กรุณาอัปโหลดไฟล์ .xlsx' });
  let wb; try { wb = await parseImportFile(req.file.buffer); } catch { return res.status(400).json({ error: 'ไฟล์ไม่ถูกต้อง' }); }
  const ws = wb.getWorksheet('สีสินค้า') || wb.worksheets[0];
  if (!ws) return res.status(400).json({ error: 'ไม่พบ Sheet ในไฟล์' });

  const hErr = checkHeaders(ws, ['รหัสสี', 'ชื่อสี *', 'Hex Code']);
  if (hErr.length) return res.status(400).json({ error: 'Header ไม่ตรงกับ template — กรุณาใช้ไฟล์ที่ดาวน์โหลดจากระบบ', headerErrors: hErr });

  const existingColors = db.prepare('SELECT * FROM colors').all();
  const byCode = new Map(), byName = new Map();
  for (const c of existingColors) {
    if (c.code) byCode.set(c.code.toLowerCase(), c);
    byName.set(c.name.toLowerCase(), c);
  }
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
      if (seenCodes.has(code.toLowerCase())) errors.push(`รหัส "${code}" ซ้ำในไฟล์`);
      else seenCodes.add(code.toLowerCase());
    }
    if (name) {
      if (seenNames.has(name.toLowerCase())) warnings.push(`ชื่อสี "${name}" ซ้ำในไฟล์`);
      else seenNames.add(name.toLowerCase());
    }

    const display = { รหัสสี: code||'-', ชื่อสี: name, 'Hex Code': hex||'-' };
    const _data = { code:code||null, name, hex:hex||null };
    if (errors.length) { results.push({ row: rowNum, display, errors, warnings, status: 'error', _data }); return; }

    const existing = (code && byCode.get(code.toLowerCase())) || (name && byName.get(name.toLowerCase())) || null;
    if (existing) {
      _data.id = existing.id;
      const changes = [];
      if (normVal(existing.name)     !== normVal(name)) changes.push(`ชื่อสี: "${existing.name}" → "${name}"`);
      if (normVal(existing.hex_code) !== normVal(hex))  changes.push(`Hex Code: "${existing.hex_code||'-'}" → "${hex||'-'}"`);
      if (!changes.length) results.push({ row: rowNum, display, errors: [], warnings, status: 'skip', changes: [], _data });
      else results.push({ row: rowNum, display, errors: [], warnings, status: 'update', changes, _data });
    } else {
      results.push({ row: rowNum, display, errors: [], warnings, status: warnings.length ? 'warning' : 'ok', _data });
    }
  });

  if (!results.length) return res.status(400).json({ error: 'ไม่พบข้อมูลในไฟล์' });
  if (req.query.preview === '1') return res.json(importResponse(results));
  if (results.some(r => r.errors.length)) return res.status(400).json({ error: 'มีข้อมูลที่ไม่ถูกต้อง' });

  const ins = db.prepare('INSERT INTO colors (code, name, hex_code) VALUES (?, ?, ?)');
  const upd = db.prepare('UPDATE colors SET code=?, name=?, hex_code=? WHERE id=?');
  const doImport = db.transaction(rows => {
    let inserted = 0, updated = 0, skipped = 0;
    for (const r of rows) {
      if (r.status === 'skip') { skipped++; continue; }
      const d = r._data;
      if (r.status === 'update') {
        const old = existingColors.find(c => c.id === d.id);
        upd.run(d.code, d.name, d.hex, d.id);
        db.auditLog('colors', d.id, 'UPDATE', old, { name: d.name, source: 'excel_import' }, req.user.id, req.ip);
        updated++;
        continue;
      }
      const res2 = ins.run(d.code, d.name, d.hex);
      db.auditLog('colors', res2.lastInsertRowid, 'CREATE', null, { name: d.name, source: 'excel_import' }, req.user.id, req.ip);
      inserted++;
    }
    return { inserted, updated, skipped };
  });
  try {
    const { inserted, updated, skipped } = doImport(results);
    res.json({ success: true, imported: inserted, updated, skipped });
  }
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

// S129 — เพิ่มคอลัมน์ รุ่น/Model + สี (มีอยู่ในตารางจริง/ใช้ใน POST-PATCH JSON API แล้ว แต่ export/import Excel เดิม
// ไม่เคยมีเลย) + เปลี่ยนช่อง Supplier จากชื่อเดียว (legacy products.supplier_id) เป็นชื่อทั้งหมดคั่นด้วย comma
// (จาก product_suppliers m:n — หน้าฟอร์มจริงรองรับเลือกได้มากกว่า 1 คนอยู่แล้ว "Supplier * (เลือกได้มากกว่า 1)")
// — ไม่ใช้ตาราง Y/N ต่อ 1 supplier แบบผู้ดูแลจัดซื้อ เพราะระบบมี supplier active ถึง 131 ราย (ยืนยันกับ user แล้ว
// ว่าคอลัมน์เดียวคั่นด้วย comma + dropdown ช่วยอ้างอิงชื่อเหมาะกว่า)
router.get('/products/export', ...adminOnly, async (req, res) => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'IQC System';

  // ── โหลด reference data ก่อน เพื่อรู้จำนวน row สำหรับ dropdown range ──
  const suppliers = db.prepare('SELECT name FROM suppliers WHERE is_active=1 ORDER BY name').all();
  const groups    = db.prepare('SELECT name FROM product_groups ORDER BY name').all();
  const units     = db.prepare('SELECT name, abbreviation FROM units WHERE is_active=1 ORDER BY name').all();
  const models    = db.prepare('SELECT name FROM models WHERE is_active=1 ORDER BY name').all();
  const colorsRef = db.prepare('SELECT name FROM colors WHERE is_active=1 ORDER BY name').all();

  // ── Sheet 2: Reference (columnar — แต่ละ column = 1 ประเภท dropdown) ──
  // Supplier=A, กลุ่ม=B, หน่วย=C, InspLevel=D→E, AQL=G, Model=I, สี=J
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
    { header: 'รุ่น/Model',      key: 'model',width: 20 },
    { header: 'สี',              key: 'color',width: 18 },
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

  const maxRef = Math.max(suppliers.length, groups.length, units.length, INSP.length, AQL_REF.length, models.length, colorsRef.length);
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
      models[i]?.name     ?? '',
      colorsRef[i]?.name  ?? '',
    ]);
  }
  applyZebraStripes(wsRef, 2, maxRef + 1, 10);

  // ── Sheet 1: สินค้า ───────────────────────────────────────────────────────
  const ws = wb.addWorksheet('สินค้า');
  ws.columns = [
    { header: 'รหัสสินค้า',       key: 'code',  width: 16 },
    { header: 'ชื่อสินค้า *',     key: 'name',  width: 32 },
    { header: 'ชื่อ Supplier * (คั่นด้วย , ถ้ามากกว่า 1)', key: 'sup', width: 40 },
    { header: 'กลุ่มสินค้า *',    key: 'grp',   width: 22 },
    { header: 'หน่วยนับ *',       key: 'unt',   width: 16 },
    { header: 'Inspection Level', key: 'insp',  width: 20 },
    { header: 'AQL Value',        key: 'aql',   width: 12 },
    { header: 'หมายเหตุ',         key: 'notes', width: 32 },
    { header: 'รุ่น/Model',       key: 'model', width: 20 },
    { header: 'สี',               key: 'color', width: 18 },
  ];
  const hRow = ws.getRow(1);
  hRow.height = 28;
  hRow.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3A5C' } };
    cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 11 };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  // เติมข้อมูลสินค้าที่มีอยู่ — Supplier ดึงจาก product_suppliers ทั้งหมด (ไม่ใช่แค่ legacy supplier_id ตัวเดียว)
  const products = db.prepare(`
    SELECT p.id, p.code, p.name, p.inspection_level, p.aql_value, p.notes,
           pg.name as product_group_name, u.name as unit_name, m.name as model_name
    FROM products p
    LEFT JOIN product_groups pg ON pg.id = p.product_group_id
    LEFT JOIN units u ON u.id = p.unit_id
    LEFT JOIN models m ON m.id = p.model_id
    ORDER BY p.name
  `).all();
  const supplierNamesByProduct = db.prepare('SELECT product_id, supplier_id FROM product_suppliers').all()
    .reduce((acc, r) => { (acc[r.product_id] = acc[r.product_id] || []).push(r.supplier_id); return acc; }, {});
  const supplierNameById = new Map(db.prepare('SELECT id, name FROM suppliers').all().map(s => [s.id, s.name]));
  const colorNameByProduct = new Map(
    db.prepare('SELECT pc.product_id, c.name FROM product_colors pc JOIN colors c ON c.id = pc.color_id').all()
      .map(r => [r.product_id, r.name])
  );
  for (const p of products) {
    const supplierNames = (supplierNamesByProduct[p.id] || []).map(id => supplierNameById.get(id)).filter(Boolean).sort().join(', ');
    ws.addRow([
      p.code||'', p.name,
      supplierNames, p.product_group_name||'', p.unit_name||'',
      p.inspection_level||'GEN_II', p.aql_value||'2.5', p.notes||'',
      p.model_name||'', colorNameByProduct.get(p.id) || '',
    ]);
  }
  applyZebraStripes(ws, 2, products.length + 1, 10);

  // ── Dropdown validation (rows 2–500) ─────────────────────────────────────
  const MAX_ROWS = 500;
  const supEnd   = suppliers.length + 1;  // row 1 = header ใน Reference
  const grpEnd   = groups.length + 1;
  const untEnd   = units.length + 1;
  const inspEnd  = INSP.length + 1;
  const aqlEnd   = AQL_REF.length + 1;
  const modelEnd = models.length + 1;
  const colorEnd = colorsRef.length + 1;

  // formula สำหรับ cross-sheet reference (ไม่ใส่ quote รอบ range) — errorStyle:'warning' เสมอ (ไม่ block) เพราะ
  // ช่อง Supplier ต้องแก้เป็นหลายชื่อคั่น comma เอง dropdown ช่วยแค่เลือกชื่อ "ล่าสุด" มาต่อท้ายเท่านั้น
  const dvSup  = { type: 'list', allowBlank: true, showErrorMessage: true, errorStyle: 'warning',
                   errorTitle: 'ชื่อ Supplier', error: 'กรุณาเลือกจากรายการใน Reference (คั่นด้วย , ถ้าเลือกหลายคน)',
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
  const dvModel = { type: 'list', allowBlank: true, showErrorMessage: true, errorStyle: 'warning',
                   errorTitle: 'รุ่น/Model', error: 'กรุณาเลือกจากรายการใน Reference',
                   formulae: [`Reference!$I$2:$I$${modelEnd}`] };
  const dvColor = { type: 'list', allowBlank: true, showErrorMessage: true, errorStyle: 'warning',
                   errorTitle: 'สี', error: 'กรุณาเลือกจากรายการใน Reference',
                   formulae: [`Reference!$J$2:$J$${colorEnd}`] };

  for (let r = 2; r <= MAX_ROWS; r++) {
    ws.getCell(r, 3).dataValidation = dvSup;
    ws.getCell(r, 4).dataValidation = dvGrp;
    ws.getCell(r, 5).dataValidation = dvUnt;
    ws.getCell(r, 6).dataValidation = dvInsp;
    ws.getCell(r, 7).dataValidation = dvAql;
    ws.getCell(r, 9).dataValidation = dvModel;
    ws.getCell(r, 10).dataValidation = dvColor;
  }

  // เปิด sheet สินค้าเป็น default (ย้ายมาก่อน Reference)
  wb.views = [{ firstSheet: 0, activeTab: 0 }];

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''products_template.xlsx");
  await wb.xlsx.write(res);
  res.end();
});

// S129 — diff-aware (match by code||name, เทียบทุก field รวม supplier id set) + parse Supplier แบบ comma-separated
// (หลายคน) + Model/Color เป็น field เสริม (ไม่บังคับ, ชื่อไม่รู้จัก = warning ไม่ error)
router.post('/products/import', ...adminOnly, excelMemUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'กรุณาอัปโหลดไฟล์ .xlsx' });

  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(req.file.buffer); }
  catch { return res.status(400).json({ error: 'ไฟล์ Excel ไม่ถูกต้อง หรือไม่ใช่ไฟล์ .xlsx' }); }

  const ws = wb.getWorksheet('สินค้า') || wb.worksheets[0];
  if (!ws) return res.status(400).json({ error: 'ไม่พบ Sheet ในไฟล์' });

  const hErr = checkHeaders(ws, ['รหัสสินค้า', 'ชื่อสินค้า *', 'ชื่อ Supplier * (คั่นด้วย , ถ้ามากกว่า 1)', 'กลุ่มสินค้า *', 'หน่วยนับ *', 'Inspection Level', 'AQL Value', 'หมายเหตุ', 'รุ่น/Model', 'สี']);
  if (hErr.length) return res.status(400).json({ error: 'Header ไม่ตรงกับ template — กรุณาใช้ไฟล์ที่ดาวน์โหลดจากระบบ', headerErrors: hErr });

  // Build lookup maps (case-insensitive)
  const supplierMap = Object.fromEntries(db.prepare('SELECT name, id FROM suppliers WHERE is_active=1').all().map(s => [s.name.trim().toLowerCase(), s.id]));
  const groupMap    = Object.fromEntries(db.prepare('SELECT name, id FROM product_groups').all().map(g => [g.name.trim().toLowerCase(), g.id]));
  const unitMap     = Object.fromEntries(db.prepare('SELECT name, id FROM units WHERE is_active=1').all().map(u => [u.name.trim().toLowerCase(), u.id]));
  const modelMap    = Object.fromEntries(db.prepare('SELECT name, id FROM models WHERE is_active=1').all().map(m => [m.name.trim().toLowerCase(), m.id]));
  const colorMap    = Object.fromEntries(db.prepare('SELECT name, id FROM colors WHERE is_active=1').all().map(c => [c.name.trim().toLowerCase(), c.id]));

  const existingProducts = db.prepare('SELECT * FROM products').all();
  const byCode = new Map(), byName = new Map();
  for (const p of existingProducts) {
    if (p.code) byCode.set(p.code.toLowerCase(), p);
    byName.set(p.name.toLowerCase(), p);
  }
  const existingProductIds = existingProducts.map(p => p.id);
  const currentSuppliersByProduct = new Map(); // productId -> Set(supplierId)
  if (existingProductIds.length) {
    const ph = existingProductIds.map(() => '?').join(',');
    for (const row of db.prepare(`SELECT product_id, supplier_id FROM product_suppliers WHERE product_id IN (${ph})`).all(...existingProductIds)) {
      if (!currentSuppliersByProduct.has(row.product_id)) currentSuppliersByProduct.set(row.product_id, new Set());
      currentSuppliersByProduct.get(row.product_id).add(row.supplier_id);
    }
  }
  const currentColorByProduct = new Map(
    db.prepare('SELECT product_id, color_id FROM product_colors').all().map(r => [r.product_id, r.color_id])
  );
  const supplierNameById = new Map(db.prepare('SELECT id, name FROM suppliers').all().map(s => [s.id, s.name]));

  const results = [];
  const seenCodes = new Set();
  const seenNames = new Set();

  ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum === 1) return; // skip header
    const localCellStr = n => String(row.getCell(n).value ?? '').trim();
    const code          = localCellStr(1);
    const name          = localCellStr(2);
    const supplierCell  = localCellStr(3);
    const groupName     = localCellStr(4);
    const unitName      = localCellStr(5);
    let   inspLevel     = localCellStr(6) || 'GEN_II';
    let   aqlValue      = localCellStr(7) || '2.5';
    const notes         = localCellStr(8);
    const modelName     = localCellStr(9);
    const colorName     = localCellStr(10);

    if (!name && !supplierCell && !groupName && !code) return; // blank row

    const errors = [], warnings = [];

    if (!name) errors.push('ชื่อสินค้าห้ามว่าง');

    // Supplier — คั่นด้วย comma รองรับหลายคน (หน้าฟอร์มจริงเลือกได้มากกว่า 1)
    const supplierNames = supplierCell.split(',').map(s => s.trim()).filter(Boolean);
    const supplierIds = [];
    if (!supplierNames.length) errors.push('ชื่อ Supplier ห้ามว่าง');
    else {
      for (const sName of supplierNames) {
        const sid = supplierMap[sName.toLowerCase()];
        if (!sid) errors.push(`ไม่พบ Supplier "${sName}" ในระบบ`);
        else supplierIds.push(sid);
      }
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

    // Model/Color — ไม่บังคับ ชื่อไม่รู้จัก = warning เฉยๆ ปล่อยว่าง ไม่ error/block
    let modelId = null;
    if (modelName) {
      modelId = modelMap[modelName.toLowerCase()];
      if (!modelId) warnings.push(`ไม่พบรุ่น/Model "${modelName}" ในระบบ — ข้ามไว้ก่อน`);
    }
    let colorId = null;
    if (colorName) {
      colorId = colorMap[colorName.toLowerCase()];
      if (!colorId) warnings.push(`ไม่พบสี "${colorName}" ในระบบ — ข้ามไว้ก่อน`);
    }

    if (code) {
      if (seenCodes.has(code.toLowerCase()))  errors.push(`รหัส "${code}" ซ้ำกันในไฟล์`);
      else seenCodes.add(code.toLowerCase());
    }
    if (name) {
      if (seenNames.has(name.toLowerCase())) warnings.push(`ชื่อ "${name}" ซ้ำกันในไฟล์`);
      else seenNames.add(name.toLowerCase());
    }

    const display = { รหัส: code||'-', ชื่อสินค้า: name, Supplier: supplierNames.join(', ')||'-', กลุ่ม: groupName||'-', หน่วย: unitName||'-' };
    const _data = { code: code||null, name, supplierIds, groupId, unitId, inspLevel, aqlValue, notes: notes||null, modelId, colorId };

    if (errors.length) { results.push({ row: rowNum, display, errors, warnings, status: 'error', _data }); return; }

    const existing = (code && byCode.get(code.toLowerCase())) || (name && byName.get(name.toLowerCase())) || null;
    if (existing) {
      _data.id = existing.id;
      const changes = [];
      if (normVal(existing.name) !== normVal(name)) changes.push(`ชื่อ: "${existing.name}" → "${name}"`);
      if ((existing.product_group_id || null) !== groupId) changes.push(`กลุ่มสินค้า: → "${groupName}"`);
      if ((existing.unit_id || null) !== unitId) changes.push(`หน่วยนับ: → "${unitName}"`);
      if (normVal(existing.inspection_level || 'GEN_II') !== normVal(inspLevel)) changes.push(`Inspection Level: "${existing.inspection_level||'GEN_II'}" → "${inspLevel}"`);
      if (normVal(existing.aql_value || '2.5') !== normVal(aqlValue)) changes.push(`AQL Value: "${existing.aql_value||'2.5'}" → "${aqlValue}"`);
      if (normVal(existing.notes) !== normVal(notes)) changes.push(`หมายเหตุ: "${existing.notes||'-'}" → "${notes||'-'}"`);
      if ((existing.model_id || null) !== modelId) changes.push(`รุ่น/Model: → "${modelName||'-'}"`);
      if ((currentColorByProduct.get(existing.id) || null) !== colorId) changes.push(`สี: → "${colorName||'-'}"`);
      const currentSupplierIds = currentSuppliersByProduct.get(existing.id) || new Set();
      const newSupplierIds = new Set(supplierIds);
      const added   = supplierIds.filter(id => !currentSupplierIds.has(id));
      const removed = [...currentSupplierIds].filter(id => !newSupplierIds.has(id));
      if (added.length || removed.length) {
        const parts = [];
        if (added.length)   parts.push(`+${added.map(id => supplierNameById.get(id)).join(', ')}`);
        if (removed.length) parts.push(`-${removed.map(id => supplierNameById.get(id)).join(', ')}`);
        changes.push(`Supplier: ${parts.join(' ')}`);
      }
      if (!changes.length) results.push({ row: rowNum, display, errors: [], warnings, status: 'skip', changes: [], _data });
      else results.push({ row: rowNum, display, errors: [], warnings, status: 'update', changes, _data });
    } else {
      results.push({ row: rowNum, display, errors: [], warnings, status: warnings.length ? 'warning' : 'ok', _data });
    }
  });

  if (results.length === 0) {
    return res.status(400).json({ error: 'ไม่พบข้อมูลในไฟล์ — ตรวจสอบว่า Sheet ชื่อ "สินค้า" และมีข้อมูลแถวที่ 2 เป็นต้นไป' });
  }

  if (req.query.preview === '1') return res.json(importResponse(results));

  const hasErrors = results.some(r => r.errors.length > 0);
  if (hasErrors) return res.status(400).json({ error: 'มีข้อมูลที่ไม่ถูกต้อง กรุณาแก้ไขก่อน Import' });

  const insertProduct = db.prepare(`
    INSERT INTO products (code, name, supplier_id, product_group_id, unit_id, model_id, inspection_level, aql_value, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateProduct = db.prepare(`
    UPDATE products SET code=?, name=?, supplier_id=?, product_group_id=?, unit_id=?, model_id=?, inspection_level=?, aql_value=?, notes=? WHERE id=?
  `);
  const insertPS = db.prepare('INSERT OR IGNORE INTO product_suppliers (product_id, supplier_id) VALUES (?, ?)');
  const delPS    = db.prepare('DELETE FROM product_suppliers WHERE product_id = ?');
  const insertPC = db.prepare('INSERT OR IGNORE INTO product_colors (product_id, color_id) VALUES (?, ?)');
  const delPC    = db.prepare('DELETE FROM product_colors WHERE product_id = ?');

  function syncRelations(productId, supplierIds, colorId) {
    delPS.run(productId);
    for (const sid of supplierIds) insertPS.run(productId, sid);
    delPC.run(productId);
    if (colorId) insertPC.run(productId, colorId);
  }

  const doImport = db.transaction((rows) => {
    let inserted = 0, updated = 0, skipped = 0;
    for (const r of rows) {
      if (r.status === 'skip') { skipped++; continue; }
      const d = r._data;
      const primarySupplierId = d.supplierIds[0] || null;
      if (r.status === 'update') {
        const old = existingProducts.find(p => p.id === d.id);
        updateProduct.run(d.code, d.name, primarySupplierId, d.groupId, d.unitId, d.modelId, d.inspLevel, d.aqlValue, d.notes, d.id);
        syncRelations(d.id, d.supplierIds, d.colorId);
        db.auditLog('products', d.id, 'UPDATE', old, { code: d.code, name: d.name, source: 'excel_import' }, req.user.id, req.ip);
        updated++;
      } else {
        const ins = insertProduct.run(d.code, d.name, primarySupplierId, d.groupId, d.unitId, d.modelId, d.inspLevel, d.aqlValue, d.notes);
        syncRelations(ins.lastInsertRowid, d.supplierIds, d.colorId);
        db.auditLog('products', ins.lastInsertRowid, 'CREATE', null, { code: d.code, name: d.name, source: 'excel_import' }, req.user.id, req.ip);
        inserted++;
      }
    }
    return { inserted, updated, skipped };
  });

  try {
    const { inserted, updated, skipped } = doImport(results);
    res.json({ success: true, imported: inserted, updated, skipped });
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
  const byThumb = {};
  for (const r of db.prepare(`SELECT product_id, file_path FROM product_images WHERE product_id IN (${ph}) AND image_type = 'product' ORDER BY product_id, id ASC`).all(...ids)) {
    if (!byThumb[r.product_id]) byThumb[r.product_id] = r.file_path;
  }
  for (const row of rows) {
    row.suppliers = bySuppliers[row.id] || [];
    row.supplier_ids = row.suppliers.map(s => s.supplier_id);
    row.colors = byColors[row.id] || [];
    row.current_drawing = byDrawing[row.id] || undefined;
    row.product_img_count = byImg[row.id]?.product || 0;
    row.quality_img_count = byImg[row.id]?.quality_issue || 0;
    row.thumbnail_path = byThumb[row.id] || null;
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
router.post('/products/:id/images', ...adminOnly, uploads.general.array('images', 10), uploads.verifyMagic, uploads.compressImages, (req, res) => {
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

router.post('/products/:id/drawings', ...adminOnly, uploads.drawings.single('drawing'), uploads.verifyMagic, uploads.compressImages, (req, res) => {
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
router.post('/products/:id/drawing', ...adminOnly, uploads.drawings.single('drawing'), uploads.verifyMagic, uploads.compressImages, (req, res) => {
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

// ISO 9001: Drawing ห้ามลบไฟล์จริง — ใช้ soft-delete (obsoleted_at) เท่านั้น
router.delete('/products/:id/drawing', ...adminOnly, (req, res) => {
  const row = db.prepare('SELECT * FROM product_drawings WHERE product_id = ? AND is_current = 1').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'ไม่มีไฟล์ Drawing' });
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
