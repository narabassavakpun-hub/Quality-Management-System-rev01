// Integration tests — FG FUAI approval/ack flow via HTTP (node --test)
// ครอบ routes/fgFuai.js: prod_manager→cpo→qc_manager→qc_staff_ack→qc_supervisor_ack→closed + reject (reopen FNCP)
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.IQC_DB_PATH = path.join(os.tmpdir(), `iqc-fuai-${process.pid}-${Date.now()}.db`);
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-fuai';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const db = require('../db/database');

const uid = (un) => db.prepare('SELECT id FROM users WHERE username = ?').get(un).id;
const setSess = (un, s) => db.prepare('UPDATE users SET session_token=? WHERE username=?').run(s, un);
const C = {};
for (const [k, un] of [['pm', 'production1'], ['cpo', 'cpo1'], ['mgr', 'manager1'], ['staff', 'qc_staff1'], ['sup', 'supervisor1'], ['admin', 'admin']]) { setSess(un, k); C[k] = 'token=' + jwt.sign({ id: uid(un), sessionToken: k }, process.env.JWT_SECRET); }

const sap = db.prepare("INSERT INTO pro_code_sap (product_no, classify_status) VALUES ('FA00-W0313-240110','confirmed')").run().lastInsertRowid;
const line = db.prepare("INSERT INTO production_lines (code,name,line_type,factory,factory_code) VALUES ('L1','สาย1','alu','F01','01')").run().lastInsertRowid;
let seq = 0;
// สร้าง fncp (fuai_opened) + fuai(status) ที่ผูกกัน → คืน { fuaiId, fncpId }
const mkFuai = (status = 'pending_prod_manager') => {
  seq++;
  const fncpId = db.prepare(`INSERT INTO fg_fncp (fncp_no, doc_no, pro_code_sap_id, production_line_id, defect_qty, severity, status, opened_by, created_by)
    VALUES (?,?,?,?,5,'major','fuai_opened',?,?)`).run(`FNCP-U${seq}`, `D-U${seq}`, sap, line, uid('production1'), uid('production1')).lastInsertRowid;
  const fuaiId = db.prepare(`INSERT INTO fg_fuai (fuai_no, fncp_id, pro_code_sap_id, production_line_id, defect_qty, severity, status, opened_by)
    VALUES (?,?,?,?,5,'major',?,?)`).run(`FUAI-T${seq}`, fncpId, sap, line, status, uid('production1')).lastInsertRowid;
  return { fuaiId, fncpId };
};

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/fg-fuai', require('../routes/fgFuai'));
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
const fuStatus = (id) => db.prepare('SELECT status FROM fg_fuai WHERE id=?').get(id).status;
const fnStatus = (id) => db.prepare('SELECT status FROM fg_fncp WHERE id=?').get(id).status;

test('FU-01 full chain: prod_manager→cpo→qc_manager→staff_ack→supervisor_ack→closed', async () => {
  const { fuaiId } = mkFuai();
  assert.equal((await api('PATCH', `/api/fg-fuai/${fuaiId}/prod-manager-approve`, { cookie: C.pm, body: {} })).status, 200);
  assert.equal(fuStatus(fuaiId), 'pending_cpo');
  assert.equal((await api('PATCH', `/api/fg-fuai/${fuaiId}/cpo-approve`, { cookie: C.cpo, body: {} })).status, 200);
  assert.equal(fuStatus(fuaiId), 'pending_qc_manager');
  assert.equal((await api('PATCH', `/api/fg-fuai/${fuaiId}/qc-manager-approve`, { cookie: C.mgr, body: {} })).status, 200);
  assert.equal(fuStatus(fuaiId), 'pending_qc_staff_ack');
  assert.equal((await api('PATCH', `/api/fg-fuai/${fuaiId}/qc-staff-ack`, { cookie: C.staff, body: {} })).status, 200);
  assert.equal(fuStatus(fuaiId), 'pending_qc_supervisor_ack');
  assert.equal((await api('PATCH', `/api/fg-fuai/${fuaiId}/qc-supervisor-ack`, { cookie: C.sup, body: {} })).status, 200);
  assert.equal(fuStatus(fuaiId), 'closed');
});

test('FU-02 permission: cpo cannot prod-manager-approve → 403', async () => {
  const { fuaiId } = mkFuai();
  const r = await api('PATCH', `/api/fg-fuai/${fuaiId}/prod-manager-approve`, { cookie: C.cpo, body: {} });
  assert.equal(r.status, 403);
});

test('FU-03 wrong status: cpo-approve on pending_prod_manager → 409', async () => {
  const { fuaiId } = mkFuai();
  const r = await api('PATCH', `/api/fg-fuai/${fuaiId}/cpo-approve`, { cookie: C.cpo, body: {} });
  assert.equal(r.status, 409);
});

test('FU-04 cpo-reject without reason → 400', async () => {
  const { fuaiId } = mkFuai('pending_cpo');
  const r = await api('PATCH', `/api/fg-fuai/${fuaiId}/cpo-reject`, { cookie: C.cpo, body: {} });
  assert.equal(r.status, 400);
});

test('FU-05 cpo-reject with reason → fuai rejected + FNCP reopened', async () => {
  const { fuaiId, fncpId } = mkFuai('pending_cpo');
  const r = await api('PATCH', `/api/fg-fuai/${fuaiId}/cpo-reject`, { cookie: C.cpo, body: { reason: 'ไม่ยอมรับ' } });
  assert.equal(r.status, 200);
  assert.equal(fuStatus(fuaiId), 'rejected');
  assert.equal(fnStatus(fncpId), 'reject');
});

test('FU-06 qc-manager-reject with reason → fuai rejected + FNCP reopened', async () => {
  const { fuaiId, fncpId } = mkFuai('pending_qc_manager');
  const r = await api('PATCH', `/api/fg-fuai/${fuaiId}/qc-manager-reject`, { cookie: C.mgr, body: { reason: 'ตีกลับ' } });
  assert.equal(r.status, 200);
  assert.equal(fuStatus(fuaiId), 'rejected');
  assert.equal(fnStatus(fncpId), 'reject');
});
