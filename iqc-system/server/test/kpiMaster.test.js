// Integration tests — KPI master/targets/actuals CRUD via HTTP (node --test)
// ครอบ routes/kpi.js: groups, title-templates, units, no-patterns, items, targets, actuals (Session 102)
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.IQC_DB_PATH = path.join(os.tmpdir(), `iqc-kpimaster-${process.pid}-${Date.now()}.db`);
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-kpimaster';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const db = require('../db/database');

const uid = (un) => db.prepare('SELECT id FROM users WHERE username = ?').get(un).id;
const setSess = (un, s) => db.prepare('UPDATE users SET session_token=? WHERE username=?').run(s, un);
const C = {};
for (const [k, un] of [['admin', 'admin'], ['mgr', 'manager1']]) { setSess(un, k); C[k] = 'token=' + jwt.sign({ id: uid(un), sessionToken: k }, process.env.JWT_SECRET); }

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/kpi', require('../routes/kpi'));
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

// ===== Groups =====
let groupId;
test('MST-01 admin creates group', async () => {
  const r = await api('POST', '/api/kpi/groups', { cookie: C.admin, body: { name: 'กลุ่ม M1', display_order: 1 } });
  assert.equal(r.status, 200);
  assert.equal(r.body.name, 'กลุ่ม M1');
  groupId = r.body.id;
});

test('MST-02 permission: qc_manager cannot create group → 403', async () => {
  const r = await api('POST', '/api/kpi/groups', { cookie: C.mgr, body: { name: 'ไม่ควรสร้างได้' } });
  assert.equal(r.status, 403);
});

test('MST-03 admin updates group name', async () => {
  const r = await api('PATCH', `/api/kpi/groups/${groupId}`, { cookie: C.admin, body: { name: 'กลุ่ม M1 แก้ไข' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.name, 'กลุ่ม M1 แก้ไข');
});

test('MST-04 delete group blocked when it has items', async () => {
  const item = await api('POST', '/api/kpi/items', { cookie: C.admin, body: { group_id: groupId, name: 'KPI ทดสอบ' } });
  assert.equal(item.status, 200);
  const del = await api('DELETE', `/api/kpi/groups/${groupId}`, { cookie: C.admin });
  assert.equal(del.status, 400);
});

// ===== Title templates / Units / No-patterns =====
test('MST-05 title-template create + duplicate name rejected', async () => {
  const r1 = await api('POST', '/api/kpi/title-templates', { cookie: C.admin, body: { name: 'หัวข้อ A' } });
  assert.equal(r1.status, 200);
  const r2 = await api('POST', '/api/kpi/title-templates', { cookie: C.admin, body: { name: 'หัวข้อ A' } });
  assert.equal(r2.status, 400);
});

test('MST-06 unit create + update', async () => {
  const r1 = await api('POST', '/api/kpi/units', { cookie: C.admin, body: { name: '%' } });
  assert.equal(r1.status, 200);
  const r2 = await api('PATCH', `/api/kpi/units/${r1.body.id}`, { cookie: C.admin, body: { name: 'ครั้ง' } });
  assert.equal(r2.status, 200);
  assert.equal(r2.body.name, 'ครั้ง');
});

test('MST-07 no-pattern create normalizes prefix + rejects duplicate', async () => {
  const r1 = await api('POST', '/api/kpi/no-patterns', { cookie: C.admin, body: { prefix: 'test-1' } });
  assert.equal(r1.status, 200);
  assert.equal(r1.body.prefix, 'TEST-1');
  const r2 = await api('POST', '/api/kpi/no-patterns', { cookie: C.admin, body: { prefix: 'TEST-1' } });
  assert.equal(r2.status, 400);
});

// ===== Items =====
let itemId;
test('MST-08 admin creates item with auto kpi_no', async () => {
  const r = await api('POST', '/api/kpi/items', { cookie: C.admin, body: { group_id: groupId, name: 'ของเสีย %', kpi_no_prefix: 'MST' } });
  assert.equal(r.status, 200);
  assert.match(r.body.kpi_no, /^MST-\d{3}$/);
  itemId = r.body.id;
});

test('MST-09 second item with same prefix increments sequence', async () => {
  const r = await api('POST', '/api/kpi/items', { cookie: C.admin, body: { group_id: groupId, name: 'ของเสีย 2', kpi_no_prefix: 'MST' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.kpi_no, 'MST-002');
});

test('MST-10 admin updates item', async () => {
  const r = await api('PATCH', `/api/kpi/items/${itemId}`, { cookie: C.admin, body: { name: 'ของเสีย % (แก้ไข)', unit: '%' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.name, 'ของเสีย % (แก้ไข)');
  assert.equal(r.body.unit, '%');
});

test('MST-11 reorder items', async () => {
  const r = await api('PATCH', '/api/kpi/items/reorder', { cookie: C.admin, body: { items: [{ id: itemId, display_order: 5 }] } });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});

// ===== Targets =====
test('MST-12 upsert single target then bulk entries', async () => {
  const single = await api('POST', '/api/kpi/targets', { cookie: C.admin, body: { kpi_item_id: itemId, year: 2026, month: 1, target_value: 3 } });
  assert.equal(single.status, 200);
  assert.equal(single.body.saved, 1);

  const bulk = await api('POST', '/api/kpi/targets', { cookie: C.admin, body: { year: 2026, entries: [{ kpi_item_id: itemId, month: 2, target_value: 4 }, { kpi_item_id: itemId, month: 1, target_value: 3.5 }] } });
  assert.equal(bulk.status, 200);
  assert.equal(bulk.body.saved, 2);

  const list = await api('GET', '/api/kpi/targets?year=2026', { cookie: C.admin });
  const row = list.body.items.find(i => i.kpi_item_id === itemId);
  assert.equal(row.months[1], 3.5); // upsert overwrote
  assert.equal(row.months[2], 4);
});

test('MST-13 delete targets for a year', async () => {
  const del = await api('DELETE', `/api/kpi/targets/${itemId}/year/2026`, { cookie: C.admin });
  assert.equal(del.status, 200);
  assert.equal(del.body.deleted, 2);
  const list = await api('GET', '/api/kpi/targets?year=2026', { cookie: C.admin });
  assert.ok(!list.body.items.find(i => i.kpi_item_id === itemId));
});

// ===== Actuals =====
test('MST-14 upsert single actual (any authenticated role)', async () => {
  const r = await api('POST', '/api/kpi/actuals', { cookie: C.mgr, body: { kpi_item_id: itemId, year: 2026, month: 3, actual_value: 2.2, remark: 'ok' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.actual_value, 2.2);

  const upd = await api('POST', '/api/kpi/actuals', { cookie: C.mgr, body: { kpi_item_id: itemId, year: 2026, month: 3, actual_value: 5 } });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.actual_value, 5);
});

test('MST-15 bulk upsert actuals for a month', async () => {
  const item2 = await api('POST', '/api/kpi/items', { cookie: C.admin, body: { group_id: groupId, name: 'ของเสีย 3', kpi_no_prefix: 'MST' } });
  const r = await api('POST', '/api/kpi/actuals/bulk', { cookie: C.admin, body: { year: 2026, month: 4, entries: [{ kpi_item_id: itemId, actual_value: 1 }, { kpi_item_id: item2.body.id, actual_value: 2 }] } });
  assert.equal(r.status, 200);
  assert.equal(r.body.saved, 2);

  const list = await api('GET', '/api/kpi/actuals?year=2026&month=4', { cookie: C.admin });
  assert.equal(list.body.data.length, 2);
});
