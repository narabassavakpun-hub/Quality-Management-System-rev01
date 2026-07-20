// Integration tests — Suppliers Excel export/import: ผู้ดูแลจัดซื้อ (Y/N per purchasing user) + กลุ่มสินค้า
// (คอลัมน์เดียว comma-separated, S149 — เปลี่ยนจาก Y/N-matrix ของ S148 เพราะจำนวนกลุ่มสินค้าจริงเยอะกว่าที่คาด)
// + diff-aware update/skip logic (S128k) via HTTP (node --test)
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.IQC_DB_PATH = path.join(os.tmpdir(), `iqc-suppliers-import-export-${process.pid}-${Date.now()}.db`);
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-suppliers-import-export';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const ExcelJS = require('exceljs');
const db = require('../db/database');

const uid = (un) => db.prepare('SELECT id FROM users WHERE username = ?').get(un).id;
const setSess = (un, s) => db.prepare('UPDATE users SET session_token=? WHERE username=?').run(s, un);

// purchasing2/purchasing3 ไม่ได้ seed มาเป็นค่าเริ่มต้น (มีแค่ purchasing1 "นภา จัดซื้อ") — สร้างเพิ่มเพื่อทดสอบ
// export/import คอลัมน์ผู้ดูแลจัดซื้อมากกว่า 1 คน
db.prepare("INSERT INTO users (username, password_hash, full_name, role, is_active) VALUES ('purchasing2','x','สมชาย จัดซื้อ','purchasing',1)").run();
db.prepare("INSERT INTO users (username, password_hash, full_name, role, is_active) VALUES ('purchasing3','x','สมหญิง จัดซื้อ','purchasing',1)").run();

const C = {};
for (const [k, un] of [['admin', 'admin']]) { setSess(un, k); C[k] = 'token=' + jwt.sign({ id: uid(un), sessionToken: k }, process.env.JWT_SECRET); }

const pur1Id = uid('purchasing1'); // seed default — full_name 'นภา จัดซื้อ'
const pur2Id = uid('purchasing2'); // 'สมชาย จัดซื้อ'
const pur3Id = uid('purchasing3'); // 'สมหญิง จัดซื้อ'

// กลุ่มสินค้า 2 กลุ่ม (S148) — ไม่มี seed เริ่มต้น สร้างเพิ่มเพื่อทดสอบคอลัมน์ "กลุ่มสินค้า" ใน export/import
const groupAId = db.prepare("INSERT INTO product_groups (name) VALUES ('กลุ่ม A')").run().lastInsertRowid;
const groupBId = db.prepare("INSERT INTO product_groups (name) VALUES ('กลุ่ม B')").run().lastInsertRowid;

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

async function api(method, p, { cookie, body } = {}) {
  const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json; try { json = await res.json(); } catch { json = null; }
  return { status: res.status, body: json };
}

async function apiGetBuffer(p, cookie) {
  const res = await fetch(base + p, { headers: { cookie } });
  return Buffer.from(await res.arrayBuffer());
}

async function apiUpload(p, cookie, buffer) {
  const fd = new FormData();
  fd.append('file', new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'import.xlsx');
  const res = await fetch(base + p, { method: 'POST', headers: { cookie }, body: fd });
  let json; try { json = await res.json(); } catch { json = null; }
  return { status: res.status, body: json };
}

// สร้างไฟล์ xlsx จำลอง (ไม่ต้องผ่าน export จริงเสมอไป — จำลองไฟล์ที่ user แก้ไขเองก่อน import กลับเข้าระบบ)
// คอลัมน์ 6 = "กลุ่มสินค้า" (comma-separated เดียว, S149) เป็นคอลัมน์คงที่เสมอ (ไม่ใช่ dynamic เหมือนผู้ดูแลจัดซื้อ)
// rows แต่ละแถวจึงต้องมี [code, name, email, phone, notes, groupsCommaStr, ...assigneeYN] ตามลำดับ
async function buildImportXlsx(assigneeHeaders, rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('ผู้ผลิต');
  ws.addRow(['รหัสผู้ผลิต', 'ชื่อผู้ผลิต *', 'อีเมล', 'เบอร์โทร', 'หมายเหตุ', 'กลุ่มสินค้า (คั่นด้วย , ถ้ามากกว่า 1)', ...assigneeHeaders]);
  for (const r of rows) ws.addRow(r);
  return wb.xlsx.writeBuffer();
}

let supAId;

test('IMPEXP-01 setup: สร้าง supplier พื้นฐานพร้อมผู้ดูแล 2 คน (นภา, สมชาย)', async () => {
  const r = await api('POST', '/api/master/suppliers', { cookie: C.admin, body: {
    code: 'SUP-A', name: 'ผู้ผลิต A', email: 'a@x.com', phone: '021234567', notes: 'หมายเหตุเดิม',
    purchasing_user_ids: [pur1Id, pur2Id],
  } });
  assert.equal(r.status, 200);
  supAId = r.body.id;
});

test('IMPEXP-02 export: มีคอลัมน์ผู้ดูแลจัดซื้อครบทุกคน และ Y ตรงกับที่ assign ไว้จริง', async () => {
  const buf = await apiGetBuffer('/api/master/suppliers/export', C.admin);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet('ผู้ผลิต');
  const headers = [];
  ws.getRow(1).eachCell((cell) => headers.push(String(cell.value)));
  assert.ok(headers.includes('นภา จัดซื้อ'));
  assert.ok(headers.includes('สมชาย จัดซื้อ'));
  assert.ok(headers.includes('สมหญิง จัดซื้อ'));

  let foundRow = null;
  ws.eachRow((row, rowNum) => { if (rowNum > 1 && row.getCell(1).value === 'SUP-A') foundRow = row; });
  assert.ok(foundRow, 'ควรเจอแถว SUP-A ในไฟล์ export');
  const col = (name) => headers.indexOf(name) + 1;
  assert.equal(String(foundRow.getCell(col('นภา จัดซื้อ')).value || ''), 'Y');
  assert.equal(String(foundRow.getCell(col('สมชาย จัดซื้อ')).value || ''), 'Y');
  assert.equal(String(foundRow.getCell(col('สมหญิง จัดซื้อ')).value || ''), '');
});

test('IMPEXP-03 preview: แถวเหมือนเดิมทุกอย่าง (รวมผู้ดูแล) → status skip', async () => {
  const buf = await buildImportXlsx(
    ['นภา จัดซื้อ', 'สมชาย จัดซื้อ', 'สมหญิง จัดซื้อ'],
    [['SUP-A', 'ผู้ผลิต A', 'a@x.com', '021234567', 'หมายเหตุเดิม', '', 'Y', 'Y', '']],
  );
  const r = await apiUpload('/api/master/suppliers/import?preview=1', C.admin, buf);
  assert.equal(r.status, 200);
  assert.equal(r.body.results.length, 1);
  assert.equal(r.body.results[0].status, 'skip');
  assert.equal(r.body.skipCount, 1);
});

test('IMPEXP-04 import จริง: แถวเหมือนเดิมทุกอย่าง → ข้าม ไม่เขียน DB เลย (ไม่มี audit log ใหม่)', async () => {
  const before = db.prepare("SELECT COUNT(*) as c FROM audit_logs WHERE table_name='suppliers' AND record_id=?").get(supAId).c;
  const buf = await buildImportXlsx(
    ['นภา จัดซื้อ', 'สมชาย จัดซื้อ', 'สมหญิง จัดซื้อ'],
    [['SUP-A', 'ผู้ผลิต A', 'a@x.com', '021234567', 'หมายเหตุเดิม', '', 'Y', 'Y', '']],
  );
  const r = await apiUpload('/api/master/suppliers/import', C.admin, buf);
  assert.equal(r.status, 200);
  assert.equal(r.body.imported, 0);
  assert.equal(r.body.updated, 0);
  assert.equal(r.body.skipped, 1);
  const after = db.prepare("SELECT COUNT(*) as c FROM audit_logs WHERE table_name='suppliers' AND record_id=?").get(supAId).c;
  assert.equal(after, before);
});

test('IMPEXP-05 import จริง: เปลี่ยนอีเมล/หมายเหตุ → status update, DB อัปเดตจริง + audit log UPDATE', async () => {
  const buf = await buildImportXlsx(
    ['นภา จัดซื้อ', 'สมชาย จัดซื้อ', 'สมหญิง จัดซื้อ'],
    [['SUP-A', 'ผู้ผลิต A', 'new-a@x.com', '021234567', 'หมายเหตุใหม่', '', 'Y', 'Y', '']],
  );
  const preview = await apiUpload('/api/master/suppliers/import?preview=1', C.admin, buf);
  assert.equal(preview.body.results[0].status, 'update');
  assert.ok(preview.body.results[0].changes.some(c => c.includes('อีเมล')));
  assert.ok(preview.body.results[0].changes.some(c => c.includes('หมายเหตุ')));

  const r = await apiUpload('/api/master/suppliers/import', C.admin, buf);
  assert.equal(r.body.updated, 1);
  const row = db.prepare('SELECT * FROM suppliers WHERE id=?').get(supAId);
  assert.equal(row.email, 'new-a@x.com');
  assert.equal(row.notes, 'หมายเหตุใหม่');
  const auditRow = db.prepare("SELECT * FROM audit_logs WHERE table_name='suppliers' AND record_id=? ORDER BY id DESC LIMIT 1").get(supAId);
  assert.equal(auditRow.action, 'UPDATE');
});

test('IMPEXP-06 import จริง: เปลี่ยนแค่ผู้ดูแลจัดซื้อ (เอา สมชาย ออก) → update, junction table sync ถูกต้อง', async () => {
  const buf = await buildImportXlsx(
    ['นภา จัดซื้อ', 'สมชาย จัดซื้อ', 'สมหญิง จัดซื้อ'],
    [['SUP-A', 'ผู้ผลิต A', 'new-a@x.com', '021234567', 'หมายเหตุใหม่', '', 'Y', '', '']],
  );
  const preview = await apiUpload('/api/master/suppliers/import?preview=1', C.admin, buf);
  assert.equal(preview.body.results[0].status, 'update');
  assert.ok(preview.body.results[0].changes.some(c => c.includes('ผู้ดูแลจัดซื้อ') && c.includes('-สมชาย')));

  await apiUpload('/api/master/suppliers/import', C.admin, buf);
  const assignees = db.prepare('SELECT user_id FROM supplier_purchasing_assignees WHERE supplier_id=?').all(supAId).map(r => r.user_id);
  assert.ok(assignees.includes(pur1Id));
  assert.ok(!assignees.includes(pur2Id));
});

test('IMPEXP-07 setup: คืนผู้ดูแลให้ SUP-A เป็น นภา+สมชาย อีกครั้ง (ผ่าน PATCH ปกติ ไม่ใช่ import)', async () => {
  const r = await api('PATCH', `/api/master/suppliers/${supAId}`, { cookie: C.admin, body: {
    code: 'SUP-A', name: 'ผู้ผลิต A', email: 'new-a@x.com', phone: '021234567', notes: 'หมายเหตุใหม่',
    purchasing_user_ids: [pur1Id, pur2Id],
  } });
  assert.equal(r.status, 200);
});

test('IMPEXP-08 import (ไฟล์เก่าไม่มีคอลัมน์ "สมชาย จัดซื้อ" เลย) → ไม่แตะผู้ดูแลของสมชาย', async () => {
  const buf = await buildImportXlsx(
    ['นภา จัดซื้อ'], // จำลองไฟล์เก่า — ไม่มีคอลัมน์ของ สมชาย/สมหญิง เลย
    [['SUP-A', 'ผู้ผลิต A', 'new-a@x.com', '021234567', 'หมายเหตุใหม่', '', 'Y']],
  );
  const preview = await apiUpload('/api/master/suppliers/import?preview=1', C.admin, buf);
  assert.equal(preview.body.results[0].status, 'skip'); // นภา ยัง Y เหมือนเดิม, ไฟล์ไม่พูดถึงสมชายเลยจึงไม่ถือว่าเปลี่ยน
  await apiUpload('/api/master/suppliers/import', C.admin, buf);
  const assignees = db.prepare('SELECT user_id FROM supplier_purchasing_assignees WHERE supplier_id=?').all(supAId).map(r => r.user_id);
  assert.ok(assignees.includes(pur1Id));
  assert.ok(assignees.includes(pur2Id), 'สมชาย ต้องยังอยู่เพราะไฟล์ไม่มีคอลัมน์ของเขาเลย (ไม่ใช่ N)');
});

test('IMPEXP-09 import: header คอลัมน์ผู้ดูแลจัดซื้อไม่รู้จัก → เตือนใน headerWarnings แต่ไม่ block, คอลัมน์ถูกข้าม', async () => {
  const buf = await buildImportXlsx(
    ['นภา จัดซื้อ', 'ไม่มีคนนี้ในระบบ'],
    [['SUP-A', 'ผู้ผลิต A', 'new-a@x.com', '021234567', 'หมายเหตุใหม่', '', 'Y', 'Y']],
  );
  const preview = await apiUpload('/api/master/suppliers/import?preview=1', C.admin, buf);
  assert.equal(preview.status, 200);
  assert.ok(preview.body.headerWarnings?.some(w => w.includes('ไม่มีคนนี้ในระบบ')));
  assert.equal(preview.body.results[0].status, 'skip'); // คอลัมน์แปลกถูกข้าม ส่วนที่เหลือไม่มีอะไรเปลี่ยน
});

test('IMPEXP-10 import: supplier ใหม่ (ไม่มี match เดิม) → insert พร้อมผู้ดูแลจากคอลัมน์ Y', async () => {
  const buf = await buildImportXlsx(
    ['นภา จัดซื้อ', 'สมชาย จัดซื้อ', 'สมหญิง จัดซื้อ'],
    [['SUP-B', 'ผู้ผลิต B', 'b@x.com', '029999999', '', '', '', '', 'Y']],
  );
  const preview = await apiUpload('/api/master/suppliers/import?preview=1', C.admin, buf);
  assert.equal(preview.body.results[0].status, 'ok');
  const r = await apiUpload('/api/master/suppliers/import', C.admin, buf);
  assert.equal(r.body.imported, 1);
  const newSup = db.prepare("SELECT * FROM suppliers WHERE code='SUP-B'").get();
  assert.ok(newSup);
  const assignees = db.prepare('SELECT user_id FROM supplier_purchasing_assignees WHERE supplier_id=?').all(newSup.id).map(r => r.user_id);
  assert.deepEqual(assignees, [pur3Id]);
});

test('IMPEXP-11 import: รหัสซ้ำกันเองในไฟล์เดียวกัน → error (ไม่ใช่ update)', async () => {
  const buf = await buildImportXlsx(
    ['นภา จัดซื้อ'],
    [
      ['SUP-C', 'ผู้ผลิต C1', '', '', '', '', ''],
      ['SUP-C', 'ผู้ผลิต C2', '', '', '', '', ''],
    ],
  );
  const preview = await apiUpload('/api/master/suppliers/import?preview=1', C.admin, buf);
  assert.equal(preview.body.results[1].status, 'error');
  assert.ok(preview.body.results[1].errors.some(e => e.includes('ซ้ำในไฟล์')));
});

// ===== S149 — คอลัมน์ "กลุ่มสินค้า" comma-separated เดียว (แทน Y/N-matrix ของ S148 — ดูเหตุผลกลับคำที่ comment
// เหนือ router.get('/suppliers/export') ใน master.js) ให้สัมพันธ์กับ multi-select ที่เพิ่มใน S146 =====
test('IMPEXP-12 setup: SUP-A มีกลุ่มสินค้า A (ผ่าน PATCH ปกติ)', async () => {
  const r = await api('PATCH', `/api/master/suppliers/${supAId}`, { cookie: C.admin, body: {
    code: 'SUP-A', name: 'ผู้ผลิต A', email: 'new-a@x.com', phone: '021234567', notes: 'หมายเหตุใหม่',
    purchasing_user_ids: [pur1Id, pur2Id], product_group_ids: [groupAId],
  } });
  assert.equal(r.status, 200);
});

test('IMPEXP-13 export: คอลัมน์กลุ่มสินค้าเป็นคอลัมน์เดียว comma-separated ตรงกับที่ตั้งไว้จริง', async () => {
  const buf = await apiGetBuffer('/api/master/suppliers/export', C.admin);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet('ผู้ผลิต');
  const headers = [];
  ws.getRow(1).eachCell((cell) => headers.push(String(cell.value)));
  assert.ok(headers.includes('กลุ่มสินค้า (คั่นด้วย , ถ้ามากกว่า 1)'));
  assert.ok(!headers.includes('กลุ่ม A'), 'ไม่ควรมีคอลัมน์แยกต่อกลุ่มอีกต่อไป (S149 เลิกใช้ Y/N-matrix)');
  assert.ok(!headers.includes('กลุ่ม B'));

  let foundRow = null;
  ws.eachRow((row, rowNum) => { if (rowNum > 1 && row.getCell(1).value === 'SUP-A') foundRow = row; });
  assert.ok(foundRow);
  const col = headers.indexOf('กลุ่มสินค้า (คั่นด้วย , ถ้ามากกว่า 1)') + 1;
  assert.equal(String(foundRow.getCell(col).value || ''), 'กลุ่ม A');
});

test('IMPEXP-14 import จริง: เปลี่ยนกลุ่มสินค้า (A→B ผ่านคอลัมน์เดียว) → update, junction table สลับถูกต้อง', async () => {
  const buf = await buildImportXlsx(
    ['นภา จัดซื้อ', 'สมชาย จัดซื้อ', 'สมหญิง จัดซื้อ'],
    [['SUP-A', 'ผู้ผลิต A', 'new-a@x.com', '021234567', 'หมายเหตุใหม่', 'กลุ่ม B', 'Y', 'Y', '']],
  );
  const preview = await apiUpload('/api/master/suppliers/import?preview=1', C.admin, buf);
  assert.equal(preview.body.results[0].status, 'update');
  assert.ok(preview.body.results[0].changes.some(c => c.includes('กลุ่มสินค้า') && c.includes('+กลุ่ม B') && c.includes('-กลุ่ม A')));

  await apiUpload('/api/master/suppliers/import', C.admin, buf);
  const groups = db.prepare('SELECT product_group_id FROM supplier_product_groups WHERE supplier_id=?').all(supAId).map(r => r.product_group_id);
  assert.deepEqual(groups, [groupBId]);
});

test('IMPEXP-15 import ซ้ำ (คอลัมน์กลุ่มสินค้าเป็น "กลุ่ม B" เหมือนเดิม) → skip, ไม่แตะกลุ่มสินค้าของ SUP-A', async () => {
  const buf = await buildImportXlsx(
    ['นภา จัดซื้อ', 'สมชาย จัดซื้อ', 'สมหญิง จัดซื้อ'],
    [['SUP-A', 'ผู้ผลิต A', 'new-a@x.com', '021234567', 'หมายเหตุใหม่', 'กลุ่ม B', 'Y', 'Y', '']],
  );
  const preview = await apiUpload('/api/master/suppliers/import?preview=1', C.admin, buf);
  assert.equal(preview.body.results[0].status, 'skip'); // ค่าเหมือนเดิมทุก field รวมกลุ่มสินค้า
  await apiUpload('/api/master/suppliers/import', C.admin, buf);
  const groups = db.prepare('SELECT product_group_id FROM supplier_product_groups WHERE supplier_id=?').all(supAId).map(r => r.product_group_id);
  assert.deepEqual(groups, [groupBId]);
});

test('IMPEXP-16 import: ชื่อกลุ่มสินค้าในคอลัมน์ไม่รู้จัก → เตือนในแถวนั้น (ไม่ error ทั้งแถว) และไม่นับชื่อนั้นเป็นกลุ่ม', async () => {
  const buf = await buildImportXlsx(
    ['นภา จัดซื้อ'],
    [['SUP-A', 'ผู้ผลิต A', 'new-a@x.com', '021234567', 'หมายเหตุใหม่', 'กลุ่มไม่มีจริง', 'Y']],
  );
  const preview = await apiUpload('/api/master/suppliers/import?preview=1', C.admin, buf);
  assert.equal(preview.status, 200);
  assert.ok(preview.body.results[0].warnings.some(w => w.includes('กลุ่มไม่มีจริง')));
  // "กลุ่มไม่มีจริง" ไม่ถูกนับ (resolve ไม่ได้) → กลุ่มของแถวนี้กลายเป็นว่าง ต่างจากกลุ่ม B เดิม (จาก IMPEXP-14/15) → update
  assert.equal(preview.body.results[0].status, 'update');
  assert.ok(preview.body.results[0].changes.some(c => c.includes('กลุ่มสินค้า') && c.includes('-กลุ่ม B')));
});

test('IMPEXP-17 import: supplier ใหม่ พร้อมกลุ่มสินค้าหลายกลุ่มคั่นด้วย comma → insert สำเร็จ', async () => {
  const buf = await buildImportXlsx(
    ['นภา จัดซื้อ', 'สมชาย จัดซื้อ', 'สมหญิง จัดซื้อ'],
    [['SUP-D', 'ผู้ผลิต D', 'd@x.com', '028888888', '', 'กลุ่ม A, กลุ่ม B', '', '', 'Y']],
  );
  const preview = await apiUpload('/api/master/suppliers/import?preview=1', C.admin, buf);
  assert.equal(preview.body.results[0].status, 'ok');
  const r = await apiUpload('/api/master/suppliers/import', C.admin, buf);
  assert.equal(r.body.imported, 1);
  const newSup = db.prepare("SELECT * FROM suppliers WHERE code='SUP-D'").get();
  assert.ok(newSup);
  const groups = db.prepare('SELECT product_group_id FROM supplier_product_groups WHERE supplier_id=?').all(newSup.id).map(r => r.product_group_id).sort();
  assert.deepEqual(groups, [groupAId, groupBId].sort());
});
