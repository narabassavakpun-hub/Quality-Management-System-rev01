// Integration tests — KPI report approval flow via HTTP (node --test)
// ครอบ routes/kpi.js reports: create → submit → approve chain (qcm→cpo→qmr) / reject → revise + guards
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.IQC_DB_PATH = path.join(os.tmpdir(), `iqc-kpi-${process.pid}-${Date.now()}.db`);
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-kpi';

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

// fixtures: 1 group + 1 active manual item (createReport จะสร้าง entry ให้)
const grp = db.prepare("INSERT INTO kpi_groups (name, display_order, created_by) VALUES ('กลุ่มทดสอบ',1,?)").run(uid('admin')).lastInsertRowid;
db.prepare("INSERT INTO kpi_items (kpi_no, group_id, name, data_source_type, is_active, created_by) VALUES ('K001',?,'ของเสีย %','manual',1,?)").run(grp, uid('admin'));

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
const mkReport = async (month) => (await api('POST', '/api/kpi/reports', { cookie: C.admin, body: { year: 2026, month } })).body.id;

let rptId;

test('KPI-01 admin creates report → draft + entries', async () => {
  const r = await api('POST', '/api/kpi/reports', { cookie: C.admin, body: { year: 2026, month: 1 } });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'draft');
  assert.match(r.body.report_no, /^KPI-\d{4}-\d{4,}$/);
  rptId = r.body.id;
  const detail = await api('GET', `/api/kpi/reports/${rptId}`, { cookie: C.admin });
  assert.equal(detail.body.entries.length, 1); // 1 active item
});

test('KPI-02 duplicate report (same year/month) → 400', async () => {
  const r = await api('POST', '/api/kpi/reports', { cookie: C.admin, body: { year: 2026, month: 1 } });
  assert.equal(r.status, 400);
});

test('KPI-03 permission: qc_manager cannot create report → 403', async () => {
  const r = await api('POST', '/api/kpi/reports', { cookie: C.mgr, body: { year: 2026, month: 6 } });
  assert.equal(r.status, 403);
});

test('KPI-04 admin submit → pending_qc_manager', async () => {
  const r = await api('POST', `/api/kpi/reports/${rptId}/submit`, { cookie: C.admin });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'pending_qc_manager');
});

test('KPI-05 submit non-draft → 400', async () => {
  const r = await api('POST', `/api/kpi/reports/${rptId}/submit`, { cookie: C.admin });
  assert.equal(r.status, 400);
});

test('KPI-06 permission: admin approve (not a reviewer role) → 403', async () => {
  const r = await api('POST', `/api/kpi/reports/${rptId}/approve`, { cookie: C.admin, body: {} });
  assert.equal(r.status, 403);
});

test('KPI-07 qc_manager approve → pending_cpo', async () => {
  const r = await api('POST', `/api/kpi/reports/${rptId}/approve`, { cookie: C.mgr, body: { comment: 'ok' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'pending_cpo');
});

test('KPI-08 wrong-status approve (qmr at pending_cpo) → 400', async () => {
  const r = await api('POST', `/api/kpi/reports/${rptId}/approve`, { cookie: C.qmr, body: {} });
  assert.equal(r.status, 400);
});

test('KPI-09 cpo approve → pending_qmr, qmr approve → approved', async () => {
  const cpo = await api('POST', `/api/kpi/reports/${rptId}/approve`, { cookie: C.cpo, body: {} });
  assert.equal(cpo.body.status, 'pending_qmr');
  const qmr = await api('POST', `/api/kpi/reports/${rptId}/approve`, { cookie: C.qmr, body: {} });
  assert.equal(qmr.body.status, 'approved');
});

test('KPI-10 reject: qc_manager reject without reason → 400', async () => {
  const id = await mkReport(2);
  await api('POST', `/api/kpi/reports/${id}/submit`, { cookie: C.admin });
  const r = await api('POST', `/api/kpi/reports/${id}/reject`, { cookie: C.mgr, body: {} });
  assert.equal(r.status, 400);
});

test('KPI-11 reject with reason → rejected, admin revise → draft', async () => {
  const id = await mkReport(3);
  await api('POST', `/api/kpi/reports/${id}/submit`, { cookie: C.admin });
  const rej = await api('POST', `/api/kpi/reports/${id}/reject`, { cookie: C.mgr, body: { reason: 'ข้อมูลไม่ครบ' } });
  assert.equal(rej.status, 200);
  assert.equal(rej.body.status, 'rejected');
  const rev = await api('POST', `/api/kpi/reports/${id}/revise`, { cookie: C.admin });
  assert.equal(rev.status, 200);
  assert.equal(rev.body.status, 'draft');
});

test('KPI-12 admin update entries (draft) → saved', async () => {
  const id = await mkReport(4);
  const itemId = db.prepare("SELECT id FROM kpi_items WHERE kpi_no='K001'").get().id;
  const r = await api('PATCH', `/api/kpi/reports/${id}/entries`, { cookie: C.admin, body: [{ kpi_item_id: itemId, actual_value: 3.5, remark: 'ทดสอบ' }] });
  assert.equal(r.status, 200);
  const detail = await api('GET', `/api/kpi/reports/${id}`, { cookie: C.admin });
  const entry = detail.body.entries.find(e => e.kpi_item_id === itemId);
  assert.equal(entry.actual_value, 3.5);
  assert.equal(entry.remark, 'ทดสอบ');
});

test('KPI-13 update entries on approved report → 400', async () => {
  // ใช้ report เดือน 1 ที่ approved แล้ว (KPI-09)
  const r = await api('PATCH', `/api/kpi/reports/${rptId}/entries`, { cookie: C.admin, body: [] });
  assert.equal(r.status, 400);
});
