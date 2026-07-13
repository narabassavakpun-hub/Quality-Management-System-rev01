// Integration tests — Purchasing Manager "Team" dashboard (Req 3): /team, /team/:memberId
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.IQC_DB_PATH = path.join(os.tmpdir(), `iqc-purchasing-team-${process.pid}-${Date.now()}.db`);
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-purchasing-team';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const db = require('../db/database');

const uid = (un) => db.prepare('SELECT id FROM users WHERE username = ?').get(un).id;
const setSess = (un, s) => db.prepare('UPDATE users SET session_token=? WHERE username=?').run(s, un);

db.prepare("INSERT INTO users (username, password_hash, full_name, role, is_active) VALUES ('purchasing2','x','สมชาย จัดซื้อ','purchasing',1)").run();
db.prepare("INSERT INTO users (username, password_hash, full_name, role, is_active) VALUES ('pur_mgr','x','ผู้จัดการจัดซื้อ','purchasing_manager',1)").run();

const C = {};
for (const [k, un] of [['staff', 'qc_staff1'], ['pur1', 'purchasing1'], ['pur2', 'purchasing2'], ['purMgr', 'pur_mgr']]) {
  setSess(un, k);
  C[k] = 'token=' + jwt.sign({ id: uid(un), sessionToken: k }, process.env.JWT_SECRET);
}
const purchasing1Id = uid('purchasing1');
const purchasing2Id = uid('purchasing2');

const supX = db.prepare("INSERT INTO suppliers (name, approval_status) VALUES ('ผู้ผลิต X (purchasing1)','approved')").run().lastInsertRowid;
db.prepare('INSERT INTO supplier_purchasing_assignees (supplier_id, user_id) VALUES (?, ?)').run(supX, purchasing1Id);
const supY = db.prepare("INSERT INTO suppliers (name, approval_status) VALUES ('ผู้ผลิต Y (purchasing2)','approved')").run().lastInsertRowid;
db.prepare('INSERT INTO supplier_purchasing_assignees (supplier_id, user_id) VALUES (?, ?)').run(supY, purchasing2Id);

let seq = 0;
function makeNcr(supplierId, { status = 'pending_purchasing_review', createdAt = null, closedAt = null, linkCopiedAt = null } = {}) {
  seq += 1;
  const billId = db.prepare("INSERT INTO bills (invoice_no, po_no, supplier_id, received_date, status, created_by) VALUES (?, ?, ?, '2026-01-01', 'approved', ?)")
    .run(`INV-TEAM-${seq}`, 'PO-TEAM', supplierId, uid('qc_staff1')).lastInsertRowid;
  const ncrId = db.prepare(`INSERT INTO ncrs (ncr_code, bill_id, po_no, invoice_no, severity, status, link_copied_at, created_by)
    VALUES (?, ?, 'PO-TEAM', 'INV-TEAM', 'major', ?, ?, ?)`)
    .run(`NCR-TEAM-${seq}`, billId, status, linkCopiedAt, uid('qc_staff1')).lastInsertRowid;
  if (createdAt) db.prepare('UPDATE ncrs SET created_at = ? WHERE id = ?').run(createdAt, ncrId);
  if (closedAt) db.prepare('UPDATE ncrs SET closed_at = ? WHERE id = ?').run(closedAt, ncrId);
  return ncrId;
}

// purchasing1 (supX): waiting_review, closed(3 วันพอดี), pending_supplier+response(1.5 วัน)
makeNcr(supX, { status: 'pending_purchasing_review' });
makeNcr(supX, { status: 'closed', createdAt: '2026-01-01 00:00:00', closedAt: '2026-01-04 00:00:00' });
const ncrWithResponse = makeNcr(supX, { status: 'pending_supplier', linkCopiedAt: '2026-01-01 00:00:00' });
db.prepare(`INSERT INTO supplier_responses (ncr_id, respondent_name, root_cause, corrective_action, preventive_action, submitted_at)
  VALUES (?, 'ผู้ตอบทดสอบ', 'สาเหตุ', 'แก้ไข', 'ป้องกัน', '2026-01-02 12:00:00')`).run(ncrWithResponse);
// purchasing2 (supY)
makeNcr(supY, { status: 'pending_purchasing_review' });

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/purchasing/dashboard', require('../routes/purchasingDashboard'));
let server, base;
test.before(async () => { server = app.listen(0); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => {
  try { server.close(); } catch {}
  try { db.close(); } catch {}
  for (const f of [process.env.IQC_DB_PATH, process.env.IQC_DB_PATH + '-wal', process.env.IQC_DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch {} }
});
async function api(method, p, { cookie } = {}) {
  const res = await fetch(base + p, { method, headers: { ...(cookie ? { cookie } : {}) } });
  let json; try { json = await res.json(); } catch { json = null; }
  return { status: res.status, body: json };
}

test('TEAM-01 permission: plain purchasing เข้า /team ไม่ได้ → 403 (เฉพาะ manager/admin)', async () => {
  const r1 = await api('GET', '/api/purchasing/dashboard/team', { cookie: C.pur1 });
  assert.equal(r1.status, 403);
  const r2 = await api('GET', `/api/purchasing/dashboard/team/${purchasing1Id}`, { cookie: C.pur1 });
  assert.equal(r2.status, 403);
});

test('TEAM-02 permission: qc_staff เข้าไม่ได้ → 403', async () => {
  const r = await api('GET', '/api/purchasing/dashboard/team', { cookie: C.staff });
  assert.equal(r.status, 403);
});

test('TEAM-03 GET /team: summary.team_member_count และตัวเลขรวมถูกต้อง', async () => {
  const r = await api('GET', '/api/purchasing/dashboard/team', { cookie: C.purMgr });
  assert.equal(r.status, 200);
  assert.equal(r.body.summary.team_member_count, 2); // purchasing1, purchasing2
  assert.equal(r.body.summary.supplier_count, 2); // supX, supY (manager unscoped)
  assert.equal(r.body.summary.ncr_waiting_review, 2); // 1 ต่อ supplier
});

test('TEAM-04 GET /team: members list มี 2 คน พร้อมตัวเลขต่อคนถูกต้อง', async () => {
  const r = await api('GET', '/api/purchasing/dashboard/team', { cookie: C.purMgr });
  assert.equal(r.body.members.length, 2);
  const m1 = r.body.members.find(m => m.id === purchasing1Id);
  assert.equal(m1.supplier_count, 1);
  assert.equal(m1.ncr_total, 3);
  assert.equal(m1.waiting_review_count, 1);
  assert.equal(m1.closed_count, 1);
  const m2 = r.body.members.find(m => m.id === purchasing2Id);
  assert.equal(m2.supplier_count, 1);
  assert.equal(m2.ncr_total, 1);
});

test('TEAM-05 GET /team/:memberId: KPI คำนวณถูกต้อง (closing time, response time, closing rate)', async () => {
  const r = await api('GET', `/api/purchasing/dashboard/team/${purchasing1Id}`, { cookie: C.purMgr });
  assert.equal(r.status, 200);
  assert.equal(r.body.member.full_name, 'นภา จัดซื้อ');
  assert.equal(r.body.kpi.total, 3);
  assert.equal(r.body.kpi.closed, 1);
  assert.equal(r.body.kpi.waiting_review, 1);
  assert.equal(r.body.kpi.closing_rate, 33.3);
  assert.equal(r.body.kpi.avg_closing_days, 3);
  assert.equal(r.body.kpi.avg_supplier_response_days, 1.5);
  assert.equal(r.body.suppliers.data.length, 1);
  assert.equal(r.body.suppliers.data[0].id, supX);
});

test('TEAM-06 GET /team/:memberId: id ที่ไม่ใช่ purchasing (เช่น admin) → 404', async () => {
  const r = await api('GET', `/api/purchasing/dashboard/team/${uid('admin')}`, { cookie: C.purMgr });
  assert.equal(r.status, 404);
});

test('TEAM-07 permission: admin เข้า /team ได้เหมือน manager', async () => {
  const adminRow = db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get();
  setSess('admin', 'adm');
  const cookie = 'token=' + jwt.sign({ id: adminRow.id, sessionToken: 'adm' }, process.env.JWT_SECRET);
  const res = await api('GET', '/api/purchasing/dashboard/team', { cookie });
  assert.equal(res.status, 200);
});
