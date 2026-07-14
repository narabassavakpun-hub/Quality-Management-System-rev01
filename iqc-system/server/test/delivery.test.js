// Integration tests — Delivery schedule via HTTP (node --test)
// ครอบ routes/delivery.js: create/unplanned/acknowledge/status/edit/delete + guards
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.IQC_DB_PATH = path.join(os.tmpdir(), `iqc-delivery-${process.pid}-${Date.now()}.db`);
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-delivery';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const db = require('../db/database');

const uid = (un) => db.prepare('SELECT id FROM users WHERE username = ?').get(un).id;
const setSess = (un, s) => db.prepare('UPDATE users SET session_token=? WHERE username=?').run(s, un);
db.prepare("UPDATE users SET qc_station='incoming' WHERE username='qc_staff1'").run();
const C = {};
for (const [k, un] of [['pur', 'purchasing1'], ['staff', 'qc_staff1'], ['sup', 'supervisor1']]) { setSess(un, k); C[k] = 'token=' + jwt.sign({ id: uid(un), sessionToken: k }, process.env.JWT_SECRET); }

const supId = db.prepare("INSERT INTO suppliers (name) VALUES ('ผู้ผลิตส่งของ')").run().lastInsertRowid;
const FUTURE = '2026-12-31'; // อนาคต (กัน guard 'ลบรายการที่เลยเวลาส่ง')

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/delivery', require('../routes/delivery'));
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
const planBody = (over = {}) => ({ supplier_id: supId, scheduled_date: FUTURE, time_slot: '10:00', notes: 'ปกติ', ...over });
const mkPending = async () => (await api('POST', '/api/delivery', { cookie: C.pur, body: planBody() })).body.id;

let schedId, unplannedId;

test('DEL-01 purchasing creates schedule → pending', async () => {
  const r = await api('POST', '/api/delivery', { cookie: C.pur, body: planBody() });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'pending');
  assert.equal(r.body.is_unplanned, 0);
  schedId = r.body.id;
});

test('DEL-02 permission: qc_staff cannot create planned schedule → 403', async () => {
  const r = await api('POST', '/api/delivery', { cookie: C.staff, body: planBody() });
  assert.equal(r.status, 403);
});

test('DEL-03 create missing fields → 400', async () => {
  const r = await api('POST', '/api/delivery', { cookie: C.pur, body: { supplier_id: supId } });
  assert.equal(r.status, 400);
});

test('DEL-04 qc_staff records unplanned → is_unplanned=1, status on_time', async () => {
  const r = await api('POST', '/api/delivery/unplanned', { cookie: C.staff, body: { supplier_id: supId, scheduled_date: FUTURE, notes: 'นอกแผน' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.is_unplanned, 1);
  assert.equal(r.body.status, 'on_time');
  unplannedId = r.body.id;
});

test('DEL-05 qc acknowledge pending → acknowledged', async () => {
  const r = await api('POST', `/api/delivery/${schedId}/acknowledge`, { cookie: C.staff });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'acknowledged');
});

test('DEL-06 acknowledge non-pending → 400', async () => {
  const r = await api('POST', `/api/delivery/${schedId}/acknowledge`, { cookie: C.staff });
  assert.equal(r.status, 400);
});

test('DEL-07 QC status on_time after acknowledged → on_time', async () => {
  const r = await api('PATCH', `/api/delivery/${schedId}/status`, { cookie: C.staff, body: { status: 'on_time', actual_date: FUTURE } });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'on_time');
});

test('DEL-08 QC status late without reason → 200 (ไม่บังคับเหตุผลแล้วตาม user request)', async () => {
  const id = await mkPending();
  await api('POST', `/api/delivery/${id}/acknowledge`, { cookie: C.staff });
  const r = await api('PATCH', `/api/delivery/${id}/status`, { cookie: C.staff, body: { status: 'late' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'late');
});

test('DEL-09 QC cannot set cancelled (only on_time/late) → 400', async () => {
  const id = await mkPending();
  await api('POST', `/api/delivery/${id}/acknowledge`, { cookie: C.staff });
  const r = await api('PATCH', `/api/delivery/${id}/status`, { cookie: C.staff, body: { status: 'cancelled', late_reason: 'x' } });
  assert.equal(r.status, 400);
});

test('DEL-10 purchasing cancels pending (with reason) → cancelled', async () => {
  const id = await mkPending();
  const r = await api('PATCH', `/api/delivery/${id}/status`, { cookie: C.pur, body: { status: 'cancelled', late_reason: 'ยกเลิกออเดอร์' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'cancelled');
});

test('DEL-11 purchasing edits pending (new date) → updated', async () => {
  const id = await mkPending();
  const r = await api('PATCH', `/api/delivery/${id}`, { cookie: C.pur, body: { scheduled_date: '2026-12-30', time_slot: '13:00' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.scheduled_date, '2026-12-30');
});

test('DEL-12 purchasing cannot edit unplanned → 403', async () => {
  const r = await api('PATCH', `/api/delivery/${unplannedId}`, { cookie: C.pur, body: { notes: 'แก้' } });
  assert.equal(r.status, 403);
});

test('DEL-13 purchasing deletes pending → ok', async () => {
  const id = await mkPending();
  const r = await api('DELETE', `/api/delivery/${id}`, { cookie: C.pur });
  assert.equal(r.status, 200);
});
