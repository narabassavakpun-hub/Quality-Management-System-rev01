// Integration tests — FG FNCP workflow via HTTP (node --test)
// ครอบ routes/fgFncp.js state machine: start→submit-verify→verify→close / reject / supervisor→manager approve
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.IQC_DB_PATH = path.join(os.tmpdir(), `iqc-fncp-${process.pid}-${Date.now()}.db`);
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-fncp';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const db = require('../db/database');

const uid = (un) => db.prepare('SELECT id FROM users WHERE username = ?').get(un).id;
const setSess = (un, s) => db.prepare('UPDATE users SET session_token=? WHERE username=?').run(s, un);
const C = {};
for (const [k, un] of [['pm', 'production1'], ['sup', 'supervisor1'], ['mgr', 'manager1'], ['staff', 'qc_staff1'], ['admin', 'admin']]) { setSess(un, k); C[k] = 'token=' + jwt.sign({ id: uid(un), sessionToken: k }, process.env.JWT_SECRET); }

// fixtures
const sap = db.prepare("INSERT INTO pro_code_sap (product_no, classify_status) VALUES ('FA00-W0313-240110','confirmed')").run().lastInsertRowid;
const line = db.prepare("INSERT INTO production_lines (code,name,line_type,factory,factory_code) VALUES ('L1','สาย1','alu','F01','01')").run().lastInsertRowid;
let seq = 0;
const mkFncp = (severity, status = 'open') => {
  seq++;
  return db.prepare(`INSERT INTO fg_fncp (fncp_no, doc_no, pro_code_sap_id, production_line_id, defect_qty, severity, status, opened_by, created_by)
    VALUES (?, ?, ?, ?, 5, ?, ?, ?, ?)`)
    .run(`FNCP-T-${seq}`, `D-${seq}`, sap, line, severity, status, uid('production1'), uid('production1')).lastInsertRowid;
};

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/fg-fncp', require('../routes/fgFncp'));
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
const statusOf = (id) => db.prepare('SELECT status FROM fg_fncp WHERE id=?').get(id).status;
// pipeline helper: open → waiting_verify
async function toWaitingVerify(id) {
  await api('PATCH', `/api/fg-fncp/${id}/start`, { cookie: C.pm, body: {} });
  await api('PATCH', `/api/fg-fncp/${id}/submit-verify`, { cookie: C.pm, body: {} });
}

test('FN-01 start (open → in_progress) by production_manager', async () => {
  const id = mkFncp('major');
  const r = await api('PATCH', `/api/fg-fncp/${id}/start`, { cookie: C.pm, body: {} });
  assert.equal(r.status, 200);
  assert.equal(statusOf(id), 'in_progress');
});

test('FN-02 permission: qc_staff cannot start (PROD_ROLES) → 403', async () => {
  const id = mkFncp('major');
  const r = await api('PATCH', `/api/fg-fncp/${id}/start`, { cookie: C.staff, body: {} });
  assert.equal(r.status, 403);
});

test('FN-03 submit-verify (in_progress → waiting_verify)', async () => {
  const id = mkFncp('major');
  await api('PATCH', `/api/fg-fncp/${id}/start`, { cookie: C.pm, body: {} });
  const r = await api('PATCH', `/api/fg-fncp/${id}/submit-verify`, { cookie: C.pm, body: {} });
  assert.equal(r.status, 200);
  assert.equal(statusOf(id), 'waiting_verify');
});

test('FN-04 submit-verify wrong status (open) → 409', async () => {
  const id = mkFncp('major');
  const r = await api('PATCH', `/api/fg-fncp/${id}/submit-verify`, { cookie: C.pm, body: {} });
  assert.equal(r.status, 409);
});

test('FN-05 verify (waiting_verify → verified) → close (verified → closed)', async () => {
  const id = mkFncp('major');
  await toWaitingVerify(id);
  const v = await api('PATCH', `/api/fg-fncp/${id}/verify`, { cookie: C.sup, body: {} });
  assert.equal(v.status, 200);
  assert.equal(statusOf(id), 'verified');
  const c = await api('PATCH', `/api/fg-fncp/${id}/close`, { cookie: C.mgr, body: {} });
  assert.equal(c.status, 200);
  assert.equal(statusOf(id), 'closed');
});

test('FN-06 reject without reason → 400; with reason → reject', async () => {
  const id = mkFncp('major');
  await toWaitingVerify(id);
  const bad = await api('PATCH', `/api/fg-fncp/${id}/reject`, { cookie: C.sup, body: {} });
  assert.equal(bad.status, 400);
  const ok = await api('PATCH', `/api/fg-fncp/${id}/reject`, { cookie: C.sup, body: { reject_reason: 'แก้ไม่ครบ' } });
  assert.equal(ok.status, 200);
  assert.equal(statusOf(id), 'reject');
});

test('FN-07 supervisor-approve minor → closed (ปิดทันที)', async () => {
  const id = mkFncp('minor');
  await toWaitingVerify(id);
  const r = await api('PATCH', `/api/fg-fncp/${id}/supervisor-approve`, { cookie: C.sup, body: {} });
  assert.equal(r.status, 200);
  assert.equal(r.body.new_status, 'closed');
  assert.equal(statusOf(id), 'closed');
});

test('FN-08 supervisor-approve major → supervisor_approved → manager-approve → closed', async () => {
  const id = mkFncp('major');
  await toWaitingVerify(id);
  const sa = await api('PATCH', `/api/fg-fncp/${id}/supervisor-approve`, { cookie: C.sup, body: {} });
  assert.equal(sa.body.new_status, 'supervisor_approved');
  assert.equal(statusOf(id), 'supervisor_approved');
  const ma = await api('PATCH', `/api/fg-fncp/${id}/manager-approve`, { cookie: C.mgr, body: {} });
  assert.equal(ma.status, 200);
  assert.equal(statusOf(id), 'closed');
});

test('FN-09 manager-approve wrong status (waiting_verify) → 409', async () => {
  const id = mkFncp('major');
  await toWaitingVerify(id);
  const r = await api('PATCH', `/api/fg-fncp/${id}/manager-approve`, { cookie: C.mgr, body: {} });
  assert.equal(r.status, 409);
});
