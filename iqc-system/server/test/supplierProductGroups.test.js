// Integration tests — Suppliers กลุ่มสินค้าที่ผลิต/ส่งได้ (many-to-many) via HTTP (node --test)
// ครอบ routes/master.js: POST/PATCH/GET /suppliers กับ product_group_ids + supplier_product_groups junction
// (คำขอ user, S146 — ใช้กรอง Supplier ตามกลุ่มสินค้าในฟอร์มเพิ่มสินค้าใหม่ ฝั่ง client)
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.IQC_DB_PATH = path.join(os.tmpdir(), `iqc-supplier-product-groups-${process.pid}-${Date.now()}.db`);
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-supplier-product-groups';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const db = require('../db/database');

const uid = (un) => db.prepare('SELECT id FROM users WHERE username = ?').get(un).id;
const setSess = (un, s) => db.prepare('UPDATE users SET session_token=? WHERE username=?').run(s, un);

const C = {};
for (const [k, un] of [['admin', 'admin'], ['staff', 'qc_staff1']]) {
  setSess(un, k);
  C[k] = 'token=' + jwt.sign({ id: uid(un), sessionToken: k }, process.env.JWT_SECRET);
}

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

let group1Id, group2Id, supplierId;

test('SUP-PG-00 setup: สร้างกลุ่มสินค้า 2 กลุ่มไว้ทดสอบ', async () => {
  const g1 = await api('POST', '/api/master/product-groups', { cookie: C.admin, body: { name: 'กลุ่ม 1' } });
  const g2 = await api('POST', '/api/master/product-groups', { cookie: C.admin, body: { name: 'กลุ่ม 2' } });
  assert.equal(g1.status, 200);
  assert.equal(g2.status, 200);
  group1Id = g1.body.id;
  group2Id = g2.body.id;
});

test('SUP-PG-01 admin สร้าง supplier พร้อม product_group_ids 1 กลุ่ม → ได้ product_groups กลับมา', async () => {
  const r = await api('POST', '/api/master/suppliers', { cookie: C.admin, body: { name: 'SupA', product_group_ids: [group1Id] } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.product_group_ids, [group1Id]);
  assert.equal(r.body.product_groups[0].name, 'กลุ่ม 1');
  supplierId = r.body.id;
});

test('SUP-PG-02 GET /suppliers (แบบ paginate) แสดง product_group_ids ของ supplier ที่สร้างไว้', async () => {
  const r = await api('GET', '/api/master/suppliers?page=1&limit=50', { cookie: C.admin });
  assert.equal(r.status, 200);
  const row = r.body.data.find(s => s.id === supplierId);
  assert.ok(row, 'ต้องเจอ supplier ที่สร้างไว้ใน list');
  assert.deepEqual(row.product_group_ids, [group1Id]);
});

test('SUP-PG-03 GET /suppliers (แบบไม่ paginate, all list) แสดง product_group_ids ด้วยเหมือนกัน', async () => {
  const r = await api('GET', '/api/master/suppliers', { cookie: C.admin });
  assert.equal(r.status, 200);
  const row = r.body.find(s => s.id === supplierId);
  assert.ok(row);
  assert.deepEqual(row.product_group_ids, [group1Id]);
});

test('SUP-PG-04 PATCH เพิ่มเป็น 2 กลุ่ม (1 ผู้ผลิต 2 กลุ่ม) → junction table อัปเดตครบทั้งคู่', async () => {
  const r = await api('PATCH', `/api/master/suppliers/${supplierId}`, {
    cookie: C.admin,
    body: { name: 'SupA', product_group_ids: [group1Id, group2Id] },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.product_group_ids.length, 2);
  assert.ok(r.body.product_group_ids.includes(group1Id));
  assert.ok(r.body.product_group_ids.includes(group2Id));
  const rows = db.prepare('SELECT * FROM supplier_product_groups WHERE supplier_id = ?').all(supplierId);
  assert.equal(rows.length, 2);
});

test('SUP-PG-05 PATCH ล้าง product_group_ids เป็น [] → junction rows หายหมด (ไม่ใช่ leftover)', async () => {
  const r = await api('PATCH', `/api/master/suppliers/${supplierId}`, {
    cookie: C.admin,
    body: { name: 'SupA', product_group_ids: [] },
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.product_group_ids, []);
  const rows = db.prepare('SELECT * FROM supplier_product_groups WHERE supplier_id = ?').all(supplierId);
  assert.equal(rows.length, 0);
});

test('SUP-PG-06 permission: qc_staff สร้าง supplier ไม่ได้ → 403 (ไม่กระทบพฤติกรรมเดิม)', async () => {
  const r = await api('POST', '/api/master/suppliers', { cookie: C.staff, body: { name: 'ควรถูกบล็อก', product_group_ids: [group1Id] } });
  assert.equal(r.status, 403);
});

test('SUP-PG-07 ตัวอย่างจากคำขอ user: SupA/SupB กลุ่ม 1, SupC กลุ่ม 2 — GET /suppliers แยกกลุ่มถูกต้อง', async () => {
  const supB = await api('POST', '/api/master/suppliers', { cookie: C.admin, body: { name: 'SupB', product_group_ids: [group1Id] } });
  const supC = await api('POST', '/api/master/suppliers', { cookie: C.admin, body: { name: 'SupC', product_group_ids: [group2Id] } });
  assert.equal(supB.status, 200);
  assert.equal(supC.status, 200);

  const all = await api('GET', '/api/master/suppliers?page=1&limit=100', { cookie: C.admin });
  const byName = Object.fromEntries(all.body.data.map(s => [s.name, s.product_group_ids]));
  assert.deepEqual(byName['SupB'], [group1Id]);
  assert.deepEqual(byName['SupC'], [group2Id]);
});
