// Integration tests — Purchasing Dashboard aggregate endpoints (Req 2/3/8) via HTTP (node --test)
// ครอบ services/purchasingDashboardService.js ผ่าน routes/purchasingDashboard.js: scoping — 2 แบบต่างกันโดยตั้งใจ
// (S128b): "ผู้ผลิตของฉัน" (getSuppliers) ยังคงเข้มงวด ไม่รวม supplier ที่ยังไม่มีผู้ดูแล (ต้องตรงกับ Master List
// assignment เป๊ะๆ — bug เดิมที่เคยโชว์ปนกันหมด) แต่ summary KPI + "NCR/NCP ของฉัน" (getSummary/getNcrList) รวม
// supplier ที่ยังไม่มีผู้ดูแลด้วย (fallback เหมือน NCR/UAI/Delivery action-permission — กัน NCR ตกหล่นไม่มีใครเห็น)
// ดู purchasingScope.js, bucket mapping ถูกต้อง, pagination/filter
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.IQC_DB_PATH = path.join(os.tmpdir(), `iqc-purchasing-dashboard-${process.pid}-${Date.now()}.db`);
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-purchasing-dashboard';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const db = require('../db/database');

const uid = (un) => db.prepare('SELECT id FROM users WHERE username = ?').get(un).id;
const setSess = (un, s) => db.prepare('UPDATE users SET session_token=? WHERE username=?').run(s, un);
db.prepare("UPDATE users SET qc_station='incoming' WHERE username='qc_staff1'").run();

db.prepare("INSERT INTO users (username, password_hash, full_name, role, is_active) VALUES ('purchasing2','x','สมชาย จัดซื้อ','purchasing',1)").run();
db.prepare("INSERT INTO users (username, password_hash, full_name, role, is_active) VALUES ('pur_mgr','x','ผู้จัดการจัดซื้อ','purchasing_manager',1)").run();
// cco1 ('วิชัย COO') seed มาให้แล้ว (database.js) — ไม่ต้องสร้างเพิ่ม

const C = {};
for (const [k, un] of [['staff', 'qc_staff1'], ['pur1', 'purchasing1'], ['pur2', 'purchasing2'], ['purMgr', 'pur_mgr'], ['coo', 'cco1']]) {
  setSess(un, k);
  C[k] = 'token=' + jwt.sign({ id: uid(un), sessionToken: k }, process.env.JWT_SECRET);
}
const purchasing1Id = uid('purchasing1');
const purchasing2Id = uid('purchasing2');

const supAssigned = db.prepare("INSERT INTO suppliers (name, approval_status) VALUES ('ผู้ผลิต A (มี purchasing1 ดูแล)','approved')").run().lastInsertRowid;
db.prepare('INSERT INTO supplier_purchasing_assignees (supplier_id, user_id) VALUES (?, ?)').run(supAssigned, purchasing1Id);
const supOther = db.prepare("INSERT INTO suppliers (name, approval_status) VALUES ('ผู้ผลิต B (มี purchasing2 ดูแล)','approved')").run().lastInsertRowid;
db.prepare('INSERT INTO supplier_purchasing_assignees (supplier_id, user_id) VALUES (?, ?)').run(supOther, purchasing2Id);
const supOpen = db.prepare("INSERT INTO suppliers (name, approval_status) VALUES ('ผู้ผลิต C (ไม่มีผู้ดูแล)','approved')").run().lastInsertRowid;

let seq = 0;
function makeNcr(supplierId, { severity = 'major', status = 'pending_purchasing_review', linkCopiedAt = null, dueDate = null } = {}) {
  seq += 1;
  const billId = db.prepare("INSERT INTO bills (invoice_no, po_no, supplier_id, received_date, status, created_by) VALUES (?, ?, ?, '2026-01-10', 'approved', ?)")
    .run(`INV-DASH-${seq}`, 'PO-DASH', supplierId, uid('qc_staff1')).lastInsertRowid;
  const ncrId = db.prepare(`INSERT INTO ncrs (ncr_code, bill_id, po_no, invoice_no, severity, status, link_copied_at, disposition_due_date, created_by)
    VALUES (?, ?, 'PO-DASH', 'INV-DASH', ?, ?, ?, ?, ?)`)
    .run(`NCR-DASH-${seq}`, billId, severity, status, linkCopiedAt, dueDate, uid('qc_staff1')).lastInsertRowid;
  return ncrId;
}

// supAssigned: waiting_review, waiting_send_link, waiting_supplier_response, closed(major), overdue(in_progress+due วันก่อน), NCP open, NCP closed
makeNcr(supAssigned, { status: 'pending_purchasing_review' });
makeNcr(supAssigned, { status: 'pending_supplier', linkCopiedAt: null });
makeNcr(supAssigned, { status: 'pending_supplier', linkCopiedAt: '2026-01-11 10:00:00' });
makeNcr(supAssigned, { status: 'closed' });
makeNcr(supAssigned, { status: 'pending_manager_review', dueDate: '2020-01-01' }); // overdue
makeNcr(supAssigned, { severity: 'minor', status: 'pending_supervisor' }); // NCP open
makeNcr(supAssigned, { severity: 'minor', status: 'ncp_closed' }); // NCP closed
// supOther: waiting_review เฉพาะของ purchasing2
makeNcr(supOther, { status: 'pending_purchasing_review' });
// supOpen: ไม่มีผู้ดูแล — ต้อง "ไม่" ปรากฏใน dashboard ของใครเลย (เข้มงวด ไม่มี fallback ต่างจาก NCR/UAI/Delivery)
makeNcr(supOpen, { status: 'pending_purchasing_review' });

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

test('DASH-01 permission: qc_staff เข้าไม่ได้ทั้ง 3 endpoint → 403', async () => {
  for (const p of ['/summary', '/suppliers', '/ncrs']) {
    const r = await api('GET', `/api/purchasing/dashboard${p}`, { cookie: C.staff });
    assert.equal(r.status, 403, p);
  }
});

test('DASH-02 summary: purchasing1 — supplier_count เข้มงวด (supAssigned เท่านั้น) แต่ NCR counts รวม supOpen ด้วย (S128b)', async () => {
  const r = await api('GET', '/api/purchasing/dashboard/summary', { cookie: C.pur1 });
  assert.equal(r.status, 200);
  assert.equal(r.body.supplier_count, 1); // supAssigned เท่านั้น — ยังเข้มงวดเหมือนเดิม
  assert.equal(r.body.ncr_waiting_review, 2); // supAssigned(1) + supOpen(1) — รวม supplier ที่ยังไม่มีผู้ดูแล
  assert.equal(r.body.ncr_waiting_send_link, 1);
  assert.equal(r.body.ncr_waiting_supplier_response, 1);
  assert.equal(r.body.ncr_closed, 1);
  assert.equal(r.body.ncr_in_progress, 1);
  assert.equal(r.body.overdue, 1);
  assert.equal(r.body.ncp_open, 1);
  assert.equal(r.body.ncp_closed, 1);
});

test('DASH-03 summary: purchasing2 — supplier_count เข้มงวด (supOther เท่านั้น) แต่ NCR counts รวม supOpen ด้วย (S128b)', async () => {
  const r = await api('GET', '/api/purchasing/dashboard/summary', { cookie: C.pur2 });
  assert.equal(r.status, 200);
  assert.equal(r.body.supplier_count, 1); // supOther เท่านั้น — ยังเข้มงวดเหมือนเดิม
  assert.equal(r.body.ncr_waiting_review, 2); // supOther(1) + supOpen(1)
});

test('DASH-04 summary: purchasing_manager เห็นทุก supplier ไม่ถูกกรอง', async () => {
  const r = await api('GET', '/api/purchasing/dashboard/summary', { cookie: C.purMgr });
  assert.equal(r.status, 200);
  assert.equal(r.body.supplier_count, 3);
  assert.equal(r.body.ncr_waiting_review, 3);
});

test('DASH-05 suppliers list: purchasing1 เห็นเฉพาะ 1 ราย (supAssigned) พร้อม bucket counts ถูกต้อง — ไม่รวม supOpen', async () => {
  const r = await api('GET', '/api/purchasing/dashboard/suppliers?limit=50', { cookie: C.pur1 });
  assert.equal(r.status, 200);
  assert.equal(r.body.total, 1);
  const ids = r.body.data.map(s => s.id);
  assert.ok(ids.includes(supAssigned));
  assert.ok(!ids.includes(supOpen), 'ไม่ควรเห็น supplier ที่ยังไม่มีผู้ดูแล');
  assert.ok(!ids.includes(supOther));

  const row = r.body.data.find(s => s.id === supAssigned);
  assert.equal(row.ncr_total, 5); // major: waiting_review, waiting_send_link, waiting_supplier_response, closed, overdue(in_progress)
  assert.equal(row.ncp_total, 2);
  assert.equal(row.waiting_review_count, 1);
  assert.equal(row.waiting_send_link_count, 1);
  assert.equal(row.waiting_supplier_response_count, 1);
  assert.equal(row.in_progress_count, 1);
  assert.equal(row.closed_count, 2); // major closed + minor ncp_closed
  assert.equal(row.overdue_count, 1);
});

test('DASH-06 suppliers list: search ตามชื่อทำงาน', async () => {
  const r = await api('GET', '/api/purchasing/dashboard/suppliers?limit=50&q=' + encodeURIComponent('ผู้ผลิต C'), { cookie: C.purMgr });
  assert.equal(r.status, 200);
  assert.equal(r.body.total, 1);
  assert.equal(r.body.data[0].id, supOpen);
});

test('DASH-07 ncrs list: purchasing1 filter bucket=waiting_review เห็นของ supAssigned + supOpen (ไม่เห็นของ supOther) — S128b', async () => {
  const r = await api('GET', '/api/purchasing/dashboard/ncrs?bucket=waiting_review&limit=50', { cookie: C.pur1 });
  assert.equal(r.status, 200);
  assert.equal(r.body.total, 2);
  const supplierIds = r.body.data.map(n => n.supplier_id);
  assert.ok(supplierIds.includes(supAssigned));
  assert.ok(supplierIds.includes(supOpen));
  assert.ok(!supplierIds.includes(supOther));
});

test('DASH-08 ncrs list: filter overdue=1 คืนเฉพาะรายการเกินกำหนด', async () => {
  const r = await api('GET', '/api/purchasing/dashboard/ncrs?overdue=1&limit=50', { cookie: C.purMgr });
  assert.equal(r.status, 200);
  assert.equal(r.body.total, 1);
  assert.equal(r.body.data[0].is_overdue, 1);
});

test('DASH-09 ncrs list: filter severity=minor คืนเฉพาะ NCP', async () => {
  const r = await api('GET', '/api/purchasing/dashboard/ncrs?severity=minor&limit=50', { cookie: C.purMgr });
  assert.equal(r.status, 200);
  assert.equal(r.body.total, 2);
  assert.ok(r.body.data.every(n => n.severity === 'minor'));
});

test('DASH-10 ncrs list: pagination limit/page ทำงานถูกต้อง', async () => {
  const r1 = await api('GET', '/api/purchasing/dashboard/ncrs?limit=2&page=1', { cookie: C.purMgr });
  assert.equal(r1.status, 200);
  assert.equal(r1.body.data.length, 2);
  assert.equal(r1.body.total, 9); // ทุก NCR/NCP ที่สร้างไว้
});

// COO dashboard (read-only) — เพิ่มสิทธิ์ cco เข้า /team + /team/:memberId เพื่อเห็นสรุปจัดซื้อทั้งบริษัท
test('DASH-11 permission: qc_staff เข้า /team ไม่ได้ → 403 (cco เท่านั้นที่เพิ่มสิทธิ์ใหม่)', async () => {
  const r = await api('GET', '/api/purchasing/dashboard/team', { cookie: C.staff });
  assert.equal(r.status, 403);
});

test('DASH-12 permission: purchasing (ธรรมดา) เข้า /team ไม่ได้ → 403 (ยังคง manager/admin/cco เท่านั้น)', async () => {
  const r = await api('GET', '/api/purchasing/dashboard/team', { cookie: C.pur1 });
  assert.equal(r.status, 403);
});

test('DASH-13 cco เข้า /team ได้ เห็นทุก supplier ไม่ถูกกรอง (เหมือน purchasing_manager)', async () => {
  const r = await api('GET', '/api/purchasing/dashboard/team', { cookie: C.coo });
  assert.equal(r.status, 200);
  assert.equal(r.body.summary.supplier_count, 3);
  assert.equal(r.body.summary.ncr_waiting_review, 3);
  assert.equal(r.body.summary.team_member_count, 2); // purchasing1 + purchasing2
  assert.equal(r.body.members.length, 2);
});

test('DASH-14 cco เข้า /team/:memberId ได้ (read-only member detail)', async () => {
  const r = await api('GET', `/api/purchasing/dashboard/team/${purchasing1Id}`, { cookie: C.coo });
  assert.equal(r.status, 200);
  assert.equal(r.body.member.id, purchasing1Id);
});
