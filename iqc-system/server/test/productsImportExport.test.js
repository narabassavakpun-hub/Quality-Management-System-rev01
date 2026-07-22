// Integration tests — Products Excel export/import: multi-supplier (semicolon-separated — S155, เดิม comma
// จนกว่าพบว่า Supplier บางรายมี comma อยู่ในชื่อจริงทำให้ split ผิด), Model/Color
// (S129 generalization round — Products is the biggest of the 6 Master List pages) via HTTP (node --test)
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.IQC_DB_PATH = path.join(os.tmpdir(), `iqc-products-import-export-${process.pid}-${Date.now()}.db`);
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-products-import-export';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const ExcelJS = require('exceljs');
const db = require('../db/database');

const uid = (un) => db.prepare('SELECT id FROM users WHERE username = ?').get(un).id;
const setSess = (un, s) => db.prepare('UPDATE users SET session_token=? WHERE username=?').run(s, un);
setSess('admin', 'admin');
const cookie = 'token=' + jwt.sign({ id: uid('admin'), sessionToken: 'admin' }, process.env.JWT_SECRET);

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/master', require('../routes/master'));
let server, base;
test.before(async () => { server = app.listen(0); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => {
  try { server.close(); } catch {}
  try { db.close(); } catch {}
  for (const f of [process.env.IQC_DB_PATH, process.env.IQC_DB_PATH + '-wal', process.env.IQC_DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch {} }
});

async function apiJson(method, p, body) {
  const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
  let json; try { json = await res.json(); } catch { json = null; }
  return { status: res.status, body: json };
}
async function apiGetBuffer(p) {
  const res = await fetch(base + p, { headers: { cookie } });
  return Buffer.from(await res.arrayBuffer());
}
async function apiUpload(p, buffer) {
  const fd = new FormData();
  fd.append('file', new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'import.xlsx');
  const res = await fetch(base + p, { method: 'POST', headers: { cookie }, body: fd });
  let json; try { json = await res.json(); } catch { json = null; }
  return { status: res.status, body: json };
}
async function apiDelete(p) {
  const res = await fetch(base + p, { method: 'DELETE', headers: { cookie } });
  let json; try { json = await res.json(); } catch { json = null; }
  return { status: res.status, body: json };
}
// จำลองไฟล์ที่ผู้ใช้แก้ไขเองก่อน import กลับเข้าระบบ (ไม่ต้องผ่าน export จริงเสมอไป)
async function buildProductsXlsx(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('สินค้า');
  ws.addRow(['รหัสสินค้า', 'ชื่อสินค้า *', 'ชื่อ Supplier * (คั่นด้วย ; ถ้ามากกว่า 1)', 'กลุ่มสินค้า *', 'หน่วยนับ *', 'Inspection Level', 'AQL Value', 'หมายเหตุ', 'รุ่น/Model', 'สี']);
  for (const r of rows) ws.addRow(r);
  return wb.xlsx.writeBuffer();
}

let supAId, supBId, grpId, unitId, modelId, colorId;

test('PR-01 setup: สร้าง supplier x2, กลุ่มสินค้า, หน่วยนับ, รุ่น, สี', async () => {
  supAId = (await apiJson('POST', '/api/master/suppliers', { code: 'SUP-PA', name: 'Supplier PA' })).body.id;
  supBId = (await apiJson('POST', '/api/master/suppliers', { code: 'SUP-PB', name: 'Supplier PB' })).body.id;
  grpId  = (await apiJson('POST', '/api/master/product-groups', { code: 'PG-P', name: 'กลุ่ม P' })).body.id;
  unitId = (await apiJson('POST', '/api/master/units', { name: 'ชิ้น', abbreviation: 'PC' })).body.id;
  modelId = (await apiJson('POST', '/api/master/models', { code: 'MD-P', name: 'รุ่น P' })).body.id;
  colorId = (await apiJson('POST', '/api/master/colors', { code: 'CL-P', name: 'สีทอง' })).body.id;
  assert.ok(supAId && supBId && grpId && unitId && modelId && colorId);
});

test('PR-02 export: Reference sheet มีคอลัมน์ รุ่น/Model และ สี ครบ', async () => {
  const buf = await apiGetBuffer('/api/master/products/export');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const wsRef = wb.getWorksheet('Reference');
  const headers = [];
  wsRef.getRow(1).eachCell(c => headers.push(String(c.value)));
  assert.ok(headers.includes('รุ่น/Model'));
  assert.ok(headers.includes('สี'));
  const names = [];
  wsRef.eachRow((row, n) => { if (n > 1) names.push(row.getCell(headers.indexOf('รุ่น/Model') + 1).value); });
  assert.ok(names.includes('รุ่น P'));
});

test('PR-03 import: สร้างสินค้าใหม่พร้อม 2 suppliers + model + color', async () => {
  const buf = await buildProductsXlsx([
    ['PRD-01', 'สินค้า 1', 'Supplier PA; Supplier PB', 'กลุ่ม P', 'ชิ้น', 'GEN_II', '2.5', 'หมายเหตุ 1', 'รุ่น P', 'สีทอง'],
  ]);
  const preview = await apiUpload('/api/master/products/import?preview=1', buf);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.results[0].status, 'ok');
  assert.equal(preview.body.results[0].display.Supplier, 'Supplier PA, Supplier PB');

  const r = await apiUpload('/api/master/products/import', buf);
  assert.equal(r.status, 200);
  assert.equal(r.body.imported, 1);

  const prod = db.prepare("SELECT * FROM products WHERE code='PRD-01'").get();
  assert.ok(prod);
  assert.equal(prod.model_id, modelId);
  const supIds = db.prepare('SELECT supplier_id FROM product_suppliers WHERE product_id=?').all(prod.id).map(r => r.supplier_id).sort();
  assert.deepEqual(supIds, [supAId, supBId].sort());
  const colIds = db.prepare('SELECT color_id FROM product_colors WHERE product_id=?').all(prod.id).map(r => r.color_id);
  assert.deepEqual(colIds, [colorId]);
});

test('PR-04 export: สินค้าที่มี 2 suppliers แสดงคั่นด้วย semicolon ในคอลัมน์ Supplier (S155 — ไม่ใช่ comma อีกต่อไป)', async () => {
  const buf = await apiGetBuffer('/api/master/products/export');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet('สินค้า');
  const headers = [];
  ws.getRow(1).eachCell(c => headers.push(String(c.value)));
  assert.ok(headers.includes('ชื่อ Supplier * (คั่นด้วย ; ถ้ามากกว่า 1)'), 'หัวคอลัมน์ต้องระบุ semicolon ไม่ใช่ comma');
  let found = null;
  ws.eachRow((row, n) => { if (n > 1 && row.getCell(1).value === 'PRD-01') found = row; });
  assert.ok(found);
  const supCell = String(found.getCell(3).value);
  assert.equal(supCell, 'Supplier PA; Supplier PB', 'ต้องคั่นด้วย ";" ไม่ใช่ ","');
  assert.equal(String(found.getCell(9).value), 'รุ่น P');
  assert.equal(String(found.getCell(10).value), 'สีทอง');
});

test('PR-04b import: Supplier ที่มี comma อยู่ในชื่อจริง (เช่น "...CO.,LTD") round-trip ได้ถูกต้อง — regression test ของบั๊กที่ user รายงาน (S155)', async () => {
  const supCommaId = (await apiJson('POST', '/api/master/suppliers', { code: 'SUP-COMMA', name: 'JINAN FENSTEK INTERNATIONAL TRADE CO.,LTD' })).body.id;
  assert.ok(supCommaId);

  const buf = await buildProductsXlsx([
    ['PRD-COMMA', 'สินค้าทดสอบ comma', 'JINAN FENSTEK INTERNATIONAL TRADE CO.,LTD; Supplier PA', 'กลุ่ม P', 'ชิ้น', 'GEN_II', '2.5', '', '', ''],
  ]);
  const preview = await apiUpload('/api/master/products/import?preview=1', buf);
  assert.equal(preview.body.results[0].status, 'ok', `ไม่ควร error — ได้: ${JSON.stringify(preview.body.results[0].errors)}`);

  const r = await apiUpload('/api/master/products/import', buf);
  assert.equal(r.body.imported, 1);
  const prod = db.prepare("SELECT * FROM products WHERE code='PRD-COMMA'").get();
  const supIds = db.prepare('SELECT supplier_id FROM product_suppliers WHERE product_id=?').all(prod.id).map(r => r.supplier_id).sort();
  assert.deepEqual(supIds, [supAId, supCommaId].sort());

  // export กลับมาต้องได้ชื่อเดิมเป๊ะๆ (มี comma อยู่ในชื่อ) ไม่ถูกตัด/แยกผิด
  const expBuf = await apiGetBuffer('/api/master/products/export');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(expBuf);
  const ws = wb.getWorksheet('สินค้า');
  let found = null;
  ws.eachRow((row, n) => { if (n > 1 && row.getCell(1).value === 'PRD-COMMA') found = row; });
  assert.ok(found);
  const supCell = String(found.getCell(3).value);
  assert.ok(supCell.includes('JINAN FENSTEK INTERNATIONAL TRADE CO.,LTD'), `ชื่อ Supplier ที่มี comma ต้อง export ออกมาครบไม่ถูกตัด: ${supCell}`);
});

test('PR-05 import: re-import ไฟล์เดิมทุก field เหมือนกัน → skip ไม่เขียน DB', async () => {
  const prod = db.prepare("SELECT id FROM products WHERE code='PRD-01'").get();
  const before = db.prepare("SELECT COUNT(*) as c FROM audit_logs WHERE table_name='products' AND record_id=?").get(prod.id).c;
  const buf = await buildProductsXlsx([
    ['PRD-01', 'สินค้า 1', 'Supplier PA; Supplier PB', 'กลุ่ม P', 'ชิ้น', 'GEN_II', '2.5', 'หมายเหตุ 1', 'รุ่น P', 'สีทอง'],
  ]);
  const preview = await apiUpload('/api/master/products/import?preview=1', buf);
  assert.equal(preview.body.results[0].status, 'skip');
  const r = await apiUpload('/api/master/products/import', buf);
  assert.equal(r.body.skipped, 1);
  assert.equal(r.body.updated, 0);
  const after = db.prepare("SELECT COUNT(*) as c FROM audit_logs WHERE table_name='products' AND record_id=?").get(prod.id).c;
  assert.equal(after, before);
});

test('PR-06 import: เอา Supplier PB ออก (เหลือแค่ PA) → update, product_suppliers sync ถูกต้อง', async () => {
  const buf = await buildProductsXlsx([
    ['PRD-01', 'สินค้า 1', 'Supplier PA', 'กลุ่ม P', 'ชิ้น', 'GEN_II', '2.5', 'หมายเหตุ 1', 'รุ่น P', 'สีทอง'],
  ]);
  const preview = await apiUpload('/api/master/products/import?preview=1', buf);
  assert.equal(preview.body.results[0].status, 'update');
  assert.ok(preview.body.results[0].changes.some(c => c.includes('Supplier') && c.includes('-Supplier PB')));

  const r = await apiUpload('/api/master/products/import', buf);
  assert.equal(r.body.updated, 1);
  const prod = db.prepare("SELECT * FROM products WHERE code='PRD-01'").get();
  const supIds = db.prepare('SELECT supplier_id FROM product_suppliers WHERE product_id=?').all(prod.id).map(r => r.supplier_id);
  assert.deepEqual(supIds, [supAId]);
  const auditRow = db.prepare("SELECT * FROM audit_logs WHERE table_name='products' AND record_id=? ORDER BY id DESC LIMIT 1").get(prod.id);
  assert.equal(auditRow.action, 'UPDATE');
});

test('PR-07 import: ชื่อ Supplier ไม่รู้จัก → error (บังคับ ไม่ใช่ optional)', async () => {
  const buf = await buildProductsXlsx([
    ['PRD-02', 'สินค้า 2', 'Supplier ไม่มีจริง', 'กลุ่ม P', 'ชิ้น', 'GEN_II', '2.5', '', '', ''],
  ]);
  const r = await apiUpload('/api/master/products/import?preview=1', buf);
  assert.equal(r.body.results[0].status, 'error');
  assert.ok(r.body.results[0].errors.some(e => e.includes('Supplier ไม่มีจริง')));
});

test('PR-08 import: ชื่อ Model/สี ไม่รู้จัก → warning เฉยๆ ไม่ block, field ปล่อยว่าง', async () => {
  const buf = await buildProductsXlsx([
    ['PRD-03', 'สินค้า 3', 'Supplier PA', 'กลุ่ม P', 'ชิ้น', 'GEN_II', '2.5', '', 'รุ่นไม่มีจริง', 'สีไม่มีจริง'],
  ]);
  const preview = await apiUpload('/api/master/products/import?preview=1', buf);
  assert.equal(preview.body.results[0].status, 'warning');
  assert.ok(preview.body.results[0].warnings.some(w => w.includes('รุ่นไม่มีจริง')));
  assert.ok(preview.body.results[0].warnings.some(w => w.includes('สีไม่มีจริง')));

  const r = await apiUpload('/api/master/products/import', buf);
  assert.equal(r.body.imported, 1);
  const prod = db.prepare("SELECT * FROM products WHERE code='PRD-03'").get();
  assert.equal(prod.model_id, null);
  const colIds = db.prepare('SELECT color_id FROM product_colors WHERE product_id=?').all(prod.id);
  assert.equal(colIds.length, 0);
});

test('PR-09 import: รหัสซ้ำกันเองในไฟล์ → error (ไม่ใช่ update)', async () => {
  const buf = await buildProductsXlsx([
    ['PRD-04', 'สินค้า 4a', 'Supplier PA', 'กลุ่ม P', 'ชิ้น', 'GEN_II', '2.5', '', '', ''],
    ['PRD-04', 'สินค้า 4b', 'Supplier PA', 'กลุ่ม P', 'ชิ้น', 'GEN_II', '2.5', '', '', ''],
  ]);
  const r = await apiUpload('/api/master/products/import?preview=1', buf);
  assert.equal(r.body.results[1].status, 'error');
  assert.ok(r.body.results[1].errors.some(e => e.includes('ซ้ำ')));
});

test('PR-10 import: ไฟล์เก่าที่ยังใช้หัวคอลัมน์ Supplier แบบ comma (ก่อน S155) ต้องถูกปฏิเสธด้วย header error ชัดเจน ไม่ใช่ misparse เงียบๆ', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('สินค้า');
  ws.addRow(['รหัสสินค้า', 'ชื่อสินค้า *', 'ชื่อ Supplier * (คั่นด้วย , ถ้ามากกว่า 1)', 'กลุ่มสินค้า *', 'หน่วยนับ *', 'Inspection Level', 'AQL Value', 'หมายเหตุ', 'รุ่น/Model', 'สี']);
  ws.addRow(['PRD-OLD', 'สินค้าไฟล์เก่า', 'Supplier PA', 'กลุ่ม P', 'ชิ้น', 'GEN_II', '2.5', '', '', '']);
  const buf = await wb.xlsx.writeBuffer();

  const r = await apiUpload('/api/master/products/import?preview=1', buf);
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Header ไม่ตรงกับ template/);
});

test('PR-11 import: แถว error ที่ตรงกับสินค้าเดิมในระบบ (code ตรงกัน) ต้องมี _data.id ให้ frontend เสนอปุ่มลบได้ (S155)', async () => {
  // PRD-01 มีอยู่แล้วจาก PR-03 — ทำให้แถวนี้ error ด้วยกลุ่มสินค้าไม่มีจริง
  const buf = await buildProductsXlsx([
    ['PRD-01', 'สินค้า 1', 'Supplier PA', 'กลุ่มไม่มีจริง', 'ชิ้น', 'GEN_II', '2.5', '', '', ''],
  ]);
  const r = await apiUpload('/api/master/products/import?preview=1', buf);
  assert.equal(r.body.results[0].status, 'error');
  assert.ok(r.body.results[0].errors.some(e => e.includes('กลุ่มไม่มีจริง')));
  assert.ok(r.body.results[0]._data?.id, '_data.id ต้องถูก resolve แม้ status เป็น error เพราะ code ตรงกับสินค้าเดิม');
});

test('PR-12 DELETE /products/:id: สินค้าที่ไม่มีประวัติการใช้งานเลย → ลบถาวรจริง', async () => {
  const created = await apiJson('POST', '/api/master/products', {
    name: 'สินค้าไม่มีประวัติ', supplier_ids: [supAId], product_group_id: grpId, unit_id: unitId,
  });
  const id = created.body.id;
  assert.ok(id);

  const r = await apiDelete(`/api/master/products/${id}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.deleted, true);
  assert.equal(r.body.deactivated, false);
  assert.equal(db.prepare('SELECT * FROM products WHERE id = ?').get(id), undefined);
});

test('PR-13 DELETE /products/:id: สินค้าที่มีประวัติการใช้งาน (bill_items ผูกอยู่) → ปิดการใช้งานแทน ไม่ลบถาวร', async () => {
  const created = await apiJson('POST', '/api/master/products', {
    name: 'สินค้ามีประวัติการรับเข้า', supplier_ids: [supAId], product_group_id: grpId, unit_id: unitId,
  });
  const productId = created.body.id;
  const billId = db.prepare("INSERT INTO bills (invoice_no, po_no, supplier_id, received_date, status, created_by) VALUES ('INV-HIST', 'PO-HIST', ?, '2026-01-10', 'approved', ?)")
    .run(supAId, uid('admin')).lastInsertRowid;
  db.prepare('INSERT INTO bill_items (bill_id, product_id, item_name, qty_received, qty_sampled, qty_passed, qty_failed) VALUES (?, ?, ?, 10, 10, 10, 0)')
    .run(billId, productId, 'สินค้ามีประวัติการรับเข้า');

  const r = await apiDelete(`/api/master/products/${productId}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.deleted, false);
  assert.equal(r.body.deactivated, true);
  assert.match(r.body.message, /ประวัติการใช้งาน/);

  const prod = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  assert.ok(prod, 'record ต้องยังอยู่ ไม่ถูกลบถาวร');
  assert.equal(prod.is_active, 0);
});

test('PR-14 DELETE /products/:id: id ไม่มีจริง → 404', async () => {
  const r = await apiDelete('/api/master/products/999999');
  assert.equal(r.status, 404);
});

test('PR-15 export: สินค้าที่ถูกปิดการใช้งาน (is_active=0) ต้องไม่โผล่ใน export อีกต่อไป (S155 — กันเจอ error ซ้ำวนไม่จบ)', async () => {
  const created = await apiJson('POST', '/api/master/products', {
    code: 'PRD-INACTIVE', name: 'สินค้าปิดใช้งานทดสอบ export', supplier_ids: [supAId], product_group_id: grpId, unit_id: unitId,
  });
  const id = created.body.id;
  await apiJson('PATCH', `/api/master/products/${id}/toggle`);

  const buf = await apiGetBuffer('/api/master/products/export');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet('สินค้า');
  let found = false;
  ws.eachRow((row, n) => { if (n > 1 && row.getCell(1).value === 'PRD-INACTIVE') found = true; });
  assert.equal(found, false, 'สินค้าที่ปิดใช้งานแล้วไม่ควรอยู่ใน export');
});
