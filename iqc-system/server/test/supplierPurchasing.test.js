// Integration tests — Suppliers ผู้ดูแลจัดซื้อ (many-to-many) via HTTP (node --test)
// ครอบ routes/master.js: POST/PATCH/GET /suppliers กับ purchasing_user_ids + supplier_purchasing_assignees junction
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.IQC_DB_PATH = path.join(os.tmpdir(), `iqc-supplier-purchasing-${process.pid}-${Date.now()}.db`);
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-supplier-purchasing';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const db = require('../db/database');

const uid = (un) => db.prepare('SELECT id FROM users WHERE username = ?').get(un).id;
const setSess = (un, s) => db.prepare('UPDATE users SET session_token=? WHERE username=?').run(s, un);

// purchasing2/pur_mgr ไม่ได้ seed มาเป็นค่าเริ่มต้น (มีแค่ purchasing1) — สร้างเพิ่มเพื่อทดสอบ "มากกว่า 1 คน" +
// permission ของ purchasing/purchasing_manager เอง (Req 1 — จัดการ Supplier ได้เอง)
db.prepare("INSERT INTO users (username, password_hash, full_name, role, is_active) VALUES ('purchasing2','x','สมชาย จัดซื้อ','purchasing',1)").run();
db.prepare("INSERT INTO users (username, password_hash, full_name, role, is_active) VALUES ('pur_mgr','x','ผู้จัดการจัดซื้อ','purchasing_manager',1)").run();

const C = {};
for (const [k, un] of [['admin', 'admin'], ['staff', 'qc_staff1'], ['pur1', 'purchasing1'], ['purMgr', 'pur_mgr']]) {
  setSess(un, k);
  C[k] = 'token=' + jwt.sign({ id: uid(un), sessionToken: k }, process.env.JWT_SECRET);
}
const purchasing1Id = uid('purchasing1');
const purchasing2Id = uid('purchasing2');

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

let supplierId;

test('SUP-PUR-01 admin สร้าง supplier พร้อม purchasing_user_ids 1 คน → ได้ purchasing_assignees กลับมา', async () => {
  const r = await api('POST', '/api/master/suppliers', { cookie: C.admin, body: { name: 'ผู้ผลิตทดสอบ', purchasing_user_ids: [purchasing1Id] } });
  assert.equal(r.status, 200);
  assert.equal(r.body.purchasing_user_ids.length, 1);
  assert.equal(r.body.purchasing_user_ids[0], purchasing1Id);
  assert.equal(r.body.purchasing_assignees[0].full_name, 'นภา จัดซื้อ');
  supplierId = r.body.id;
});

test('SUP-PUR-02 GET /suppliers (แบบ paginate) แสดง purchasing_user_ids ของ supplier ที่สร้างไว้', async () => {
  const r = await api('GET', '/api/master/suppliers?page=1&limit=50', { cookie: C.admin });
  assert.equal(r.status, 200);
  const row = r.body.data.find(s => s.id === supplierId);
  assert.ok(row, 'ต้องเจอ supplier ที่สร้างไว้ใน list');
  assert.deepEqual(row.purchasing_user_ids, [purchasing1Id]);
});

test('SUP-PUR-03 PATCH เพิ่มเป็น 2 คน (เลือกจัดซื้อทั้งหมด) → junction table อัปเดตครบทั้งคู่', async () => {
  const r = await api('PATCH', `/api/master/suppliers/${supplierId}`, {
    cookie: C.admin,
    body: { name: 'ผู้ผลิตทดสอบ', purchasing_user_ids: [purchasing1Id, purchasing2Id] },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.purchasing_user_ids.length, 2);
  assert.ok(r.body.purchasing_user_ids.includes(purchasing1Id));
  assert.ok(r.body.purchasing_user_ids.includes(purchasing2Id));
  const rows = db.prepare('SELECT * FROM supplier_purchasing_assignees WHERE supplier_id = ?').all(supplierId);
  assert.equal(rows.length, 2);
});

test('SUP-PUR-04 PATCH ล้าง purchasing_user_ids เป็น [] → junction rows หายหมด (ไม่ใช่ leftover)', async () => {
  const r = await api('PATCH', `/api/master/suppliers/${supplierId}`, {
    cookie: C.admin,
    body: { name: 'ผู้ผลิตทดสอบ', purchasing_user_ids: [] },
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.purchasing_user_ids, []);
  const rows = db.prepare('SELECT * FROM supplier_purchasing_assignees WHERE supplier_id = ?').all(supplierId);
  assert.equal(rows.length, 0);
});

test('SUP-PUR-05 permission: qc_staff สร้าง supplier ไม่ได้ → 403', async () => {
  const r = await api('POST', '/api/master/suppliers', { cookie: C.staff, body: { name: 'ควรถูกบล็อก', purchasing_user_ids: [purchasing1Id] } });
  assert.equal(r.status, 403);
});

test('SUP-PUR-06 permission: purchasing สร้าง/แก้ไข/toggle supplier ได้เอง (Req 1)', async () => {
  const created = await api('POST', '/api/master/suppliers', { cookie: C.pur1, body: { name: 'ผู้ผลิตสร้างโดยจัดซื้อ', purchasing_user_ids: [purchasing1Id] } });
  assert.equal(created.status, 200);
  const id = created.body.id;

  const patched = await api('PATCH', `/api/master/suppliers/${id}`, { cookie: C.pur1, body: { name: 'ผู้ผลิตแก้ไขโดยจัดซื้อ', purchasing_user_ids: [purchasing1Id] } });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.name, 'ผู้ผลิตแก้ไขโดยจัดซื้อ');

  const toggled = await api('PATCH', `/api/master/suppliers/${id}/toggle`, { cookie: C.pur1 });
  assert.equal(toggled.status, 200);
  assert.equal(toggled.body.is_active, 0);
});

test('SUP-PUR-07 permission: purchasing_manager สร้าง supplier ได้เอง (Req 1)', async () => {
  const r = await api('POST', '/api/master/suppliers', { cookie: C.purMgr, body: { name: 'ผู้ผลิตสร้างโดยผจก จัดซื้อ' } });
  assert.equal(r.status, 200);
});

test('SUP-PUR-08 GET /master/purchasing-users: purchasing เข้าถึงได้ (dropdown เลือกผู้ดูแล), qc_staff เข้าไม่ได้', async () => {
  const ok = await api('GET', '/api/master/purchasing-users', { cookie: C.pur1 });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.some(u => u.id === purchasing1Id));
  assert.ok(ok.body.every(u => 'full_name' in u && !('telegram_chat_id' in u)), 'ต้องคืนเฉพาะ id/full_name ไม่รวมข้อมูล user อื่น');

  const blocked = await api('GET', '/api/master/purchasing-users', { cookie: C.staff });
  assert.equal(blocked.status, 403);
});

// ===== Master List filter: assigned_to / unassigned (จัดซื้อกรองดู "ที่ฉันดูแล" / "ยังไม่มีผู้ดูแล") =====
test('SUP-PUR-09 GET /suppliers?assigned_to=<id>: คืนเฉพาะ supplier ที่คนนั้นเป็นผู้ดูแล', async () => {
  const purchasing2Id = uid('purchasing2');
  const mineOnly = await api('POST', '/api/master/suppliers', { cookie: C.admin, body: { name: 'กรองทดสอบ-ของฉัน', purchasing_user_ids: [purchasing1Id] } });
  const otherOnly = await api('POST', '/api/master/suppliers', { cookie: C.admin, body: { name: 'กรองทดสอบ-คนอื่น', purchasing_user_ids: [purchasing2Id] } });
  assert.equal(mineOnly.status, 200);
  assert.equal(otherOnly.status, 200);

  const r = await api('GET', `/api/master/suppliers?page=1&limit=50&q=${encodeURIComponent('กรองทดสอบ')}&assigned_to=${purchasing1Id}`, { cookie: C.pur1 });
  assert.equal(r.status, 200);
  const ids = r.body.data.map(s => s.id);
  assert.ok(ids.includes(mineOnly.body.id));
  assert.ok(!ids.includes(otherOnly.body.id));
});

test('SUP-PUR-10 GET /suppliers?unassigned=1: คืนเฉพาะ supplier ที่ยังไม่มีผู้ดูแลเลย', async () => {
  const assigned = await api('POST', '/api/master/suppliers', { cookie: C.admin, body: { name: 'กรองว่าง-มีผู้ดูแล', purchasing_user_ids: [purchasing1Id] } });
  const unassigned = await api('POST', '/api/master/suppliers', { cookie: C.admin, body: { name: 'กรองว่าง-ไม่มีผู้ดูแล' } });
  assert.equal(assigned.status, 200);
  assert.equal(unassigned.status, 200);

  const r = await api('GET', `/api/master/suppliers?page=1&limit=50&q=${encodeURIComponent('กรองว่าง')}&unassigned=1`, { cookie: C.pur1 });
  assert.equal(r.status, 200);
  const ids = r.body.data.map(s => s.id);
  assert.ok(ids.includes(unassigned.body.id));
  assert.ok(!ids.includes(assigned.body.id));
});
