// Integration tests — IPNCR workflow via HTTP (node --test)
// ครอบ routes/ipncr.js: create → acknowledge → start-recheck → submit-for-qc → qc-reinspect pass/fail → close / cancel
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.IQC_DB_PATH = path.join(os.tmpdir(), `iqc-ipncr-${process.pid}-${Date.now()}.db`);
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-ipncr';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const db = require('../db/database');

const uid = (un) => db.prepare('SELECT id FROM users WHERE username = ?').get(un).id;
const setSess = (un, s) => db.prepare('UPDATE users SET session_token=? WHERE username=?').run(s, un);
const C = {};
for (const [k, un] of [['staff', 'qc_staff1'], ['pm', 'production1'], ['sup', 'supervisor1'], ['mgr', 'manager1'], ['admin', 'admin']]) { setSess(un, k); C[k] = 'token=' + jwt.sign({ id: uid(un), sessionToken: k }, process.env.JWT_SECRET); }

const sap = db.prepare("INSERT INTO pro_code_sap (product_no, classify_status) VALUES ('FA00-W0313-240110','confirmed')").run().lastInsertRowid;
const line = db.prepare("INSERT INTO production_lines (code,name,line_type,factory,factory_code) VALUES ('L1','สาย1','alu','F01','01')").run().lastInsertRowid;
// IPNCR สร้างจาก ipqc inspection (source_id NOT NULL) → ต้องมี station + inspection
const station = db.prepare("INSERT INTO ipqc_stations (name, code, sort_order) VALUES ('สถานี1','st1',1)").run().lastInsertRowid;
const insp = db.prepare("INSERT INTO ipqc_inspections (record_no, inspect_date, inspect_time, station_id, doc_no) VALUES ('IPQC-T-1','2026-01-10','10:00',?,'D-INSP')").run(station).lastInsertRowid;

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/ipncr', require('../routes/ipncr'));
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
const stat = (id) => db.prepare('SELECT status FROM ipncr_records WHERE id=?').get(id).status;
const attemptOf = (id) => db.prepare('SELECT recheck_attempt FROM ipncr_records WHERE id=?').get(id).recheck_attempt;
let seq = 0;
const mkOpen = async () => { seq++; return (await api('POST', '/api/ipncr', { cookie: C.staff, body: { inspection_id: insp, doc_no: `D-${seq}`, pro_code_sap_id: sap, production_line_id: line, defect_description: 'ผิวไม่เรียบ' } })).body.id; };
const submitBody = { root_cause: 'เครื่องจักร', corrective_action: 'ปรับตั้ง', qty_rechecked: 100, qty_pass: 95, qty_fail: 5 };

let ipId;

test('IPN-01 qc_staff creates IPNCR → 201 open', async () => {
  const r = await api('POST', '/api/ipncr', { cookie: C.staff, body: { inspection_id: insp, doc_no: 'D-100', pro_code_sap_id: sap, production_line_id: line, defect_description: 'บิ่น' } });
  assert.equal(r.status, 201);
  ipId = r.body.id;
  assert.equal(stat(ipId), 'open');
});

test('IPN-02 create missing fields → 400', async () => {
  const r = await api('POST', '/api/ipncr', { cookie: C.staff, body: { doc_no: 'D-x' } });
  assert.equal(r.status, 400);
});

test('IPN-03 permission: production_manager cannot create → 403', async () => {
  const r = await api('POST', '/api/ipncr', { cookie: C.pm, body: { doc_no: 'D-y', defect_description: 'z' } });
  assert.equal(r.status, 403);
});

test('IPN-04 acknowledge (open → prod_acknowledged)', async () => {
  const r = await api('PATCH', `/api/ipncr/${ipId}/acknowledge`, { cookie: C.pm, body: {} });
  assert.equal(r.status, 200);
  assert.equal(stat(ipId), 'prod_acknowledged');
});

test('IPN-05 acknowledge again → 400 (optimistic lock)', async () => {
  const r = await api('PATCH', `/api/ipncr/${ipId}/acknowledge`, { cookie: C.pm, body: {} });
  assert.equal(r.status, 400);
});

test('IPN-06 start-recheck (prod_acknowledged → rechecking)', async () => {
  const r = await api('PATCH', `/api/ipncr/${ipId}/start-recheck`, { cookie: C.pm, body: {} });
  assert.equal(r.status, 200);
  assert.equal(stat(ipId), 'rechecking');
});

test('IPN-07 submit-for-qc without root_cause → 400', async () => {
  const r = await api('PATCH', `/api/ipncr/${ipId}/submit-for-qc`, { cookie: C.pm, body: { corrective_action: 'x' } });
  assert.equal(r.status, 400);
});

test('IPN-08 submit-for-qc → prod_manager_approved', async () => {
  const r = await api('PATCH', `/api/ipncr/${ipId}/submit-for-qc`, { cookie: C.pm, body: submitBody });
  assert.equal(r.status, 200);
  assert.equal(stat(ipId), 'prod_manager_approved');
});

test('IPN-09 qc-reinspect-fail → rechecking + attempt+1', async () => {
  const r = await api('PATCH', `/api/ipncr/${ipId}/qc-reinspect-fail`, { cookie: C.sup, body: { qty_fail: 3, remarks: 'ยังไม่ผ่าน' } });
  assert.equal(r.status, 200);
  assert.equal(stat(ipId), 'rechecking');
  assert.equal(attemptOf(ipId), 2);
});

test('IPN-10 re-submit → qc-reinspect-pass → qc_supervisor_verified', async () => {
  await api('PATCH', `/api/ipncr/${ipId}/submit-for-qc`, { cookie: C.pm, body: submitBody });
  const r = await api('PATCH', `/api/ipncr/${ipId}/qc-reinspect-pass`, { cookie: C.sup, body: { qty_pass: 100, qty_fail: 0 } });
  assert.equal(r.status, 200);
  assert.equal(stat(ipId), 'qc_supervisor_verified');
});

test('IPN-11 qc_manager close → closed', async () => {
  const r = await api('PATCH', `/api/ipncr/${ipId}/close`, { cookie: C.mgr, body: {} });
  assert.equal(r.status, 200);
  assert.equal(stat(ipId), 'closed');
});

test('IPN-12 admin cancel (open) → cancelled; cancel closed → 400', async () => {
  const id = await mkOpen();
  const c = await api('PATCH', `/api/ipncr/${id}/cancel`, { cookie: C.admin, body: {} });
  assert.equal(c.status, 200);
  assert.equal(stat(id), 'cancelled');
  const bad = await api('PATCH', `/api/ipncr/${ipId}/cancel`, { cookie: C.admin, body: {} }); // ipId ปิดแล้ว
  assert.equal(bad.status, 400);
});
