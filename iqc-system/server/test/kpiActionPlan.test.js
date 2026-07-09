// Integration tests — KPI action-plan approval flow via HTTP (node --test)
// ครอบ routes/kpi.js action-plans: create → submit → approve chain (qcm→cpo→qmr) / reject → draft + guards
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.IQC_DB_PATH = path.join(os.tmpdir(), `iqc-kpiap-${process.pid}-${Date.now()}.db`);
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-kpiap';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const db = require('../db/database');

const uid = (un) => db.prepare('SELECT id FROM users WHERE username = ?').get(un).id;
const setSess = (un, s) => db.prepare('UPDATE users SET session_token=? WHERE username=?').run(s, un);
const C = {};
for (const [k, un] of [['admin', 'admin'], ['mgr', 'manager1'], ['cpo', 'cpo1'], ['qmr', 'qmr1']]) { setSess(un, k); C[k] = 'token=' + jwt.sign({ id: uid(un), sessionToken: k }, process.env.JWT_SECRET); }

const grp = db.prepare("INSERT INTO kpi_groups (name, display_order, created_by) VALUES ('กลุ่ม',1,?)").run(uid('admin')).lastInsertRowid;
const item = db.prepare("INSERT INTO kpi_items (kpi_no, group_id, name, data_source_type, is_active, created_by) VALUES ('K001',?,'ของเสีย','manual',1,?)").run(grp, uid('admin')).lastInsertRowid;

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
// สร้าง draft action-plan สำหรับเดือนที่ระบุ → คืน id
const mkPlan = async (month) => {
  const r = await api('POST', '/api/kpi/action-plans', { cookie: C.admin, body: { kpi_item_id: item, year: 2026, month, fail_cause: 'x', corrective_action: 'y', preventive_action: 'z' } });
  return r.body.id;
};

let apId;

test('AP-01 admin creates action-plan → draft', async () => {
  const r = await api('POST', '/api/kpi/action-plans', { cookie: C.admin, body: { kpi_item_id: item, year: 2026, month: 1, fail_cause: 'ของเสียสูง', corrective_action: 'ปรับ', preventive_action: 'ดูแล' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'draft');
  apId = r.body.id;
});

test('AP-02 permission: qc_manager cannot create → 403', async () => {
  const r = await api('POST', '/api/kpi/action-plans', { cookie: C.mgr, body: { kpi_item_id: item, year: 2026, month: 5 } });
  assert.equal(r.status, 403);
});

test('AP-03 admin submit → pending_qcm', async () => {
  const r = await api('POST', `/api/kpi/action-plans/${apId}/submit`, { cookie: C.admin });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'pending_qcm');
});

test('AP-04 submit non-draft → 409', async () => {
  const r = await api('POST', `/api/kpi/action-plans/${apId}/submit`, { cookie: C.admin });
  assert.equal(r.status, 409);
});

test('AP-05 permission: admin approve (not reviewer) → 403', async () => {
  const r = await api('POST', `/api/kpi/action-plans/${apId}/approve`, { cookie: C.admin, body: {} });
  assert.equal(r.status, 403);
});

test('AP-06 qc_manager approve → pending_cpo', async () => {
  const r = await api('POST', `/api/kpi/action-plans/${apId}/approve`, { cookie: C.mgr, body: {} });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'pending_cpo');
});

test('AP-07 wrong-status approve (qmr at pending_cpo) → 403', async () => {
  const r = await api('POST', `/api/kpi/action-plans/${apId}/approve`, { cookie: C.qmr, body: {} });
  assert.equal(r.status, 403);
});

test('AP-08 cpo approve → pending_qmr, qmr approve → approved', async () => {
  assert.equal((await api('POST', `/api/kpi/action-plans/${apId}/approve`, { cookie: C.cpo, body: {} })).body.status, 'pending_qmr');
  assert.equal((await api('POST', `/api/kpi/action-plans/${apId}/approve`, { cookie: C.qmr, body: {} })).body.status, 'approved');
});

test('AP-09 reject without reason → 400', async () => {
  const id = await mkPlan(2);
  await api('POST', `/api/kpi/action-plans/${id}/submit`, { cookie: C.admin });
  const r = await api('POST', `/api/kpi/action-plans/${id}/reject`, { cookie: C.mgr, body: {} });
  assert.equal(r.status, 400);
});

test('AP-10 qc_manager reject (reason) → draft + revision+1', async () => {
  const id = await mkPlan(3);
  await api('POST', `/api/kpi/action-plans/${id}/submit`, { cookie: C.admin });
  const r = await api('POST', `/api/kpi/action-plans/${id}/reject`, { cookie: C.mgr, body: { reason: 'ไม่ครบ' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'draft');
  assert.equal(r.body.revision, 1);
});
