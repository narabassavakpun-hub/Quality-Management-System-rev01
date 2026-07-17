// Integration tests — diff-aware Excel import (skip/update/error) สำหรับ ProductGroups/Units/DefectCategories/Colors
// (S129 generalization round) + zebra-stripe smoke check บน Colors export (node --test)
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.IQC_DB_PATH = path.join(os.tmpdir(), `iqc-master-diff-import-${process.pid}-${Date.now()}.db`);
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-master-diff-import';

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
async function buildXlsx(sheetName, headers, rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r);
  return wb.xlsx.writeBuffer();
}

// ===== ProductGroups =====
test('PG-01 setup: สร้างกลุ่มสินค้า', async () => {
  const res = await fetch(base + '/api/master/product-groups', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ code: 'PG-A', name: 'กลุ่ม A', require_lot_number: 1, has_shelf_life: 0 }) });
  assert.equal(res.status, 200);
});

test('PG-02 import: แถวเหมือนเดิมทุก field (รวม has_shelf_life/shelf_life_days) → skip', async () => {
  const buf = await buildXlsx('กลุ่มสินค้า',
    ['รหัสกลุ่ม', 'ชื่อกลุ่มสินค้า *', 'บังคับเอกสารตรวจ', 'บังคับ Lot Number', 'บังคับวันหมดอายุ', 'บังคับ Certificate', 'มีอายุการเก็บ', 'อายุการเก็บ (วัน)'],
    [['PG-A', 'กลุ่ม A', '', 'ใช่', '', '', '', '']],
  );
  const r = await apiUpload('/api/master/product-groups/import?preview=1', buf);
  assert.equal(r.status, 200);
  assert.equal(r.body.results[0].status, 'skip');
});

test('PG-03 import: เพิ่ม has_shelf_life=ใช่ + shelf_life_days=30 → update จริง', async () => {
  const buf = await buildXlsx('กลุ่มสินค้า',
    ['รหัสกลุ่ม', 'ชื่อกลุ่มสินค้า *', 'บังคับเอกสารตรวจ', 'บังคับ Lot Number', 'บังคับวันหมดอายุ', 'บังคับ Certificate', 'มีอายุการเก็บ', 'อายุการเก็บ (วัน)'],
    [['PG-A', 'กลุ่ม A', '', 'ใช่', '', '', 'ใช่', '30']],
  );
  const preview = await apiUpload('/api/master/product-groups/import?preview=1', buf);
  assert.equal(preview.body.results[0].status, 'update');
  assert.ok(preview.body.results[0].changes.some(c => c.includes('มีอายุการเก็บ')));
  assert.ok(preview.body.results[0].changes.some(c => c.includes('อายุการเก็บ (วัน)')));
  const r = await apiUpload('/api/master/product-groups/import', buf);
  assert.equal(r.body.updated, 1);
  const row = db.prepare("SELECT * FROM product_groups WHERE code='PG-A'").get();
  assert.equal(row.has_shelf_life, 1);
  assert.equal(row.shelf_life_days, 30);
});

test('PG-04 import: อายุการเก็บ (วัน) ไม่ใช่ตัวเลข → error', async () => {
  const buf = await buildXlsx('กลุ่มสินค้า',
    ['รหัสกลุ่ม', 'ชื่อกลุ่มสินค้า *', 'บังคับเอกสารตรวจ', 'บังคับ Lot Number', 'บังคับวันหมดอายุ', 'บังคับ Certificate', 'มีอายุการเก็บ', 'อายุการเก็บ (วัน)'],
    [['PG-A', 'กลุ่ม A', '', 'ใช่', '', '', 'ใช่', 'abc']],
  );
  const r = await apiUpload('/api/master/product-groups/import?preview=1', buf);
  assert.equal(r.body.results[0].status, 'error');
  assert.ok(r.body.results[0].errors.some(e => e.includes('ตัวเลข')));
});

test('PG-05 import: รหัสซ้ำกันเองในไฟล์ → error (ไม่ใช่ update)', async () => {
  const buf = await buildXlsx('กลุ่มสินค้า',
    ['รหัสกลุ่ม', 'ชื่อกลุ่มสินค้า *', 'บังคับเอกสารตรวจ', 'บังคับ Lot Number', 'บังคับวันหมดอายุ', 'บังคับ Certificate', 'มีอายุการเก็บ', 'อายุการเก็บ (วัน)'],
    [
      ['PG-D', 'กลุ่ม D1', '', '', '', '', '', ''],
      ['PG-D', 'กลุ่ม D2', '', '', '', '', '', ''],
    ],
  );
  const r = await apiUpload('/api/master/product-groups/import?preview=1', buf);
  assert.equal(r.body.results[1].status, 'error');
  assert.ok(r.body.results[1].errors.some(e => e.includes('ซ้ำในไฟล์')));
});

// ===== Units =====
test('UN-01 setup: สร้างหน่วยนับ', async () => {
  const res = await fetch(base + '/api/master/units', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: 'กล่อง', abbreviation: 'BOX' }) });
  assert.equal(res.status, 200);
});

test('UN-02 import: เหมือนเดิม (match ด้วยชื่อ ไม่มี code) → skip', async () => {
  const buf = await buildXlsx('หน่วยนับ', ['ชื่อหน่วยนับ *', 'ตัวย่อ'], [['กล่อง', 'BOX']]);
  const r = await apiUpload('/api/master/units/import?preview=1', buf);
  assert.equal(r.body.results[0].status, 'skip');
});

test('UN-03 import: เปลี่ยนตัวย่อ → update จริง + audit log', async () => {
  const before = db.prepare("SELECT id FROM units WHERE name='กล่อง'").get().id;
  const beforeAudit = db.prepare("SELECT COUNT(*) as c FROM audit_logs WHERE table_name='units' AND record_id=?").get(before).c;
  const buf = await buildXlsx('หน่วยนับ', ['ชื่อหน่วยนับ *', 'ตัวย่อ'], [['กล่อง', 'BX']]);
  const preview = await apiUpload('/api/master/units/import?preview=1', buf);
  assert.equal(preview.body.results[0].status, 'update');
  const r = await apiUpload('/api/master/units/import', buf);
  assert.equal(r.body.updated, 1);
  const row = db.prepare("SELECT * FROM units WHERE id=?").get(before);
  assert.equal(row.abbreviation, 'BX');
  const afterAudit = db.prepare("SELECT COUNT(*) as c FROM audit_logs WHERE table_name='units' AND record_id=?").get(before).c;
  assert.equal(afterAudit, beforeAudit + 1);
});

test('UN-04 import: ชื่อซ้ำกันเองในไฟล์ → error', async () => {
  const buf = await buildXlsx('หน่วยนับ', ['ชื่อหน่วยนับ *', 'ตัวย่อ'], [['ถุง', ''], ['ถุง', '']]);
  const r = await apiUpload('/api/master/units/import?preview=1', buf);
  assert.equal(r.body.results[1].status, 'error');
});

// ===== DefectCategories =====
test('DC-01 setup: สร้างกลุ่มปัญหา', async () => {
  const res = await fetch(base + '/api/master/defect-categories', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ code: 'DC-A', name: 'ปัญหา A', notes: 'เดิม' }) });
  assert.equal(res.status, 200);
});

test('DC-02 import: เหมือนเดิม → skip, เปลี่ยนหมายเหตุ → update', async () => {
  const bufSame = await buildXlsx('กลุ่มปัญหา', ['รหัส', 'ชื่อกลุ่มปัญหา *', 'หมายเหตุ'], [['DC-A', 'ปัญหา A', 'เดิม']]);
  const same = await apiUpload('/api/master/defect-categories/import?preview=1', bufSame);
  assert.equal(same.body.results[0].status, 'skip');

  const bufDiff = await buildXlsx('กลุ่มปัญหา', ['รหัส', 'ชื่อกลุ่มปัญหา *', 'หมายเหตุ'], [['DC-A', 'ปัญหา A', 'ใหม่']]);
  const preview = await apiUpload('/api/master/defect-categories/import?preview=1', bufDiff);
  assert.equal(preview.body.results[0].status, 'update');
  const r = await apiUpload('/api/master/defect-categories/import', bufDiff);
  assert.equal(r.body.updated, 1);
  const row = db.prepare("SELECT * FROM defect_categories WHERE code='DC-A'").get();
  assert.equal(row.notes, 'ใหม่');
});

// ===== Colors =====
test('CL-01 setup: สร้างสี', async () => {
  const res = await fetch(base + '/api/master/colors', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ code: 'CL-A', name: 'สีแดง', hex_code: '#FF0000' }) });
  assert.equal(res.status, 200);
});

test('CL-02 import: เหมือนเดิม → skip, เปลี่ยน hex → update', async () => {
  const bufSame = await buildXlsx('สีสินค้า', ['รหัสสี', 'ชื่อสี *', 'Hex Code'], [['CL-A', 'สีแดง', '#FF0000']]);
  const same = await apiUpload('/api/master/colors/import?preview=1', bufSame);
  assert.equal(same.body.results[0].status, 'skip');

  const bufDiff = await buildXlsx('สีสินค้า', ['รหัสสี', 'ชื่อสี *', 'Hex Code'], [['CL-A', 'สีแดง', '#00FF00']]);
  const preview = await apiUpload('/api/master/colors/import?preview=1', bufDiff);
  assert.equal(preview.body.results[0].status, 'update');
  const r = await apiUpload('/api/master/colors/import', bufDiff);
  assert.equal(r.body.updated, 1);
  const row = db.prepare("SELECT * FROM colors WHERE code='CL-A'").get();
  assert.equal(row.hex_code, '#00FF00');
});

test('CL-03 import: hex code ผิดรูปแบบ → error', async () => {
  const buf = await buildXlsx('สีสินค้า', ['รหัสสี', 'ชื่อสี *', 'Hex Code'], [['CL-B', 'สีเขียว', 'not-a-hex']]);
  const r = await apiUpload('/api/master/colors/import?preview=1', buf);
  assert.equal(r.body.results[0].status, 'error');
  assert.ok(r.body.results[0].errors.some(e => e.includes('Hex Code')));
});

test('CL-04 export: zebra stripe สลับสี — แถวข้อมูลแรกกับแถวถัดไปมี fill ต่างกัน', async () => {
  await fetch(base + '/api/master/colors', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ code: 'CL-C', name: 'สีเหลือง' }) });
  const buf = await apiGetBuffer('/api/master/colors/export');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet('สีสินค้า');
  const fillRow2 = ws.getRow(2).getCell(1).fill;
  const fillRow3 = ws.getRow(3).getCell(1).fill;
  const argb2 = fillRow2?.fgColor?.argb;
  const argb3 = fillRow3?.fgColor?.argb;
  assert.notEqual(argb2, argb3, `แถว 2 (${argb2}) และแถว 3 (${argb3}) ควรมีสี fill ต่างกัน (zebra stripe)`);
});
