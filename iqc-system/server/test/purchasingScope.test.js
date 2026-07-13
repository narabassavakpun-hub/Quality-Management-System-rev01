// Integration tests — Supplier-scoped purchasing permissions (NCR/UAI/Delivery) via HTTP (node --test)
// จัดซื้อ (role='purchasing') เห็น/ทำ action ได้เฉพาะ Supplier ที่ตัวเองถูกตั้งเป็นผู้ดูแล (supplier_purchasing_assignees)
// — ถ้า Supplier ไม่มีผู้ดูแลเลย เปิดให้จัดซื้อทุกคนทำได้เหมือนเดิม; purchasing_manager/admin ไม่ถูกจำกัด
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.IQC_DB_PATH = path.join(os.tmpdir(), `iqc-purchasing-scope-${process.pid}-${Date.now()}.db`);
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-purchasing-scope';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const db = require('../db/database');

const uid = (un) => db.prepare('SELECT id FROM users WHERE username = ?').get(un).id;
const setSess = (un, s) => db.prepare('UPDATE users SET session_token=? WHERE username=?').run(s, un);
db.prepare("UPDATE users SET qc_station='incoming' WHERE username='qc_staff1'").run();

// จัดซื้อคนที่ 2 + purchasing_manager ไม่ได้ seed มาเป็นค่าเริ่มต้น — สร้างเพิ่มเพื่อทดสอบ
db.prepare("INSERT INTO users (username, password_hash, full_name, role, is_active) VALUES ('purchasing2','x','คนที่ไม่ได้รับมอบหมาย','purchasing',1)").run();
db.prepare("INSERT INTO users (username, password_hash, full_name, role, is_active) VALUES ('pur_mgr','x','ผู้จัดการจัดซื้อ','purchasing_manager',1)").run();

const C = {};
for (const [k, un] of [
  ['staff', 'qc_staff1'], ['sup', 'supervisor1'], ['mgr', 'manager1'], ['qmr', 'qmr1'],
  ['pur1', 'purchasing1'], ['pur2', 'purchasing2'], ['purMgr', 'pur_mgr'],
  ['cco', 'cco1'], ['cmo', 'cmo1'], ['cpo', 'cpo1'], ['prod', 'prodmgr1'],
]) {
  const row = db.prepare('SELECT id FROM users WHERE username = ?').get(un);
  if (!row) continue; // บาง seed username อาจไม่ตรง — ข้ามถ้าไม่มี (เช็คจริงด้านล่างจาก assigneeId ที่ resolve ได้)
  setSess(un, k);
  C[k] = 'token=' + jwt.sign({ id: row.id, sessionToken: k }, process.env.JWT_SECRET);
}

// Supplier ที่มีผู้ดูแล = purchasing1 เท่านั้น
const supAssigned = db.prepare("INSERT INTO suppliers (name, approval_status) VALUES ('ผู้ผลิตมีผู้ดูแล','approved')").run().lastInsertRowid;
db.prepare('INSERT INTO supplier_purchasing_assignees (supplier_id, user_id) VALUES (?, ?)').run(supAssigned, uid('purchasing1'));
// Supplier ที่ไม่มีผู้ดูแลเลย — fallback เปิดให้จัดซื้อทุกคนทำได้
const supOpen = db.prepare("INSERT INTO suppliers (name, approval_status) VALUES ('ผู้ผลิตไม่มีผู้ดูแล','approved')").run().lastInsertRowid;

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/ncr', require('../routes/ncr'));
app.use('/api/uai', require('../routes/uai'));
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

function makeBill(supplierId) {
  return db.prepare("INSERT INTO bills (invoice_no, po_no, supplier_id, received_date, status, created_by) VALUES (?, ?, ?, '2026-01-10', 'approved', ?)")
    .run('INV-' + Math.random().toString(36).slice(2, 7), 'PO-1', supplierId, uid('qc_staff1')).lastInsertRowid;
}
function makeNcrAtPendingPurchasingReview(supplierId) {
  const billId = makeBill(supplierId);
  const ncrId = db.prepare("INSERT INTO ncrs (ncr_code, bill_id, po_no, invoice_no, severity, status, created_by) VALUES (?, ?, 'PO-1', 'INV-1', 'major', 'pending_purchasing_review', ?)")
    .run('NCR-TEST-' + Math.random().toString(36).slice(2, 7), billId, uid('qc_staff1')).lastInsertRowid;
  return ncrId;
}

// ===== NCR: assigned Supplier =====
test('SCOPE-NCR-01 จัดซื้อที่ไม่ได้ถูกมอบหมาย → 403 ทั้ง GET detail และ purchasing-review', async () => {
  const ncrId = makeNcrAtPendingPurchasingReview(supAssigned);
  const detail = await api('GET', `/api/ncr/${ncrId}`, { cookie: C.pur2 });
  assert.equal(detail.status, 403);
  const act = await api('PATCH', `/api/ncr/${ncrId}/purchasing-review`, { cookie: C.pur2, body: { items: [] } });
  assert.equal(act.status, 403);
});

test('SCOPE-NCR-02 จัดซื้อที่ถูกมอบหมาย (purchasing1) → เข้าดู + ทำ action ได้ปกติ', async () => {
  const ncrId = makeNcrAtPendingPurchasingReview(supAssigned);
  const detail = await api('GET', `/api/ncr/${ncrId}`, { cookie: C.pur1 });
  assert.equal(detail.status, 200);
  const act = await api('PATCH', `/api/ncr/${ncrId}/purchasing-review`, { cookie: C.pur1, body: { items: [] } });
  assert.equal(act.status, 200);
});

test('SCOPE-NCR-03 purchasing_manager ข้ามข้อจำกัดได้เสมอ แม้ไม่ได้เป็นผู้ดูแล', async () => {
  const ncrId = makeNcrAtPendingPurchasingReview(supAssigned);
  const detail = await api('GET', `/api/ncr/${ncrId}`, { cookie: C.purMgr });
  assert.equal(detail.status, 200);
  const act = await api('PATCH', `/api/ncr/${ncrId}/purchasing-review`, { cookie: C.purMgr, body: { items: [] } });
  assert.equal(act.status, 200);
});

test('SCOPE-NCR-04 Supplier ไม่มีผู้ดูแลเลย → จัดซื้อคนไหนก็ทำได้ (fallback)', async () => {
  const ncrId = makeNcrAtPendingPurchasingReview(supOpen);
  const detail = await api('GET', `/api/ncr/${ncrId}`, { cookie: C.pur2 });
  assert.equal(detail.status, 200);
  const act = await api('PATCH', `/api/ncr/${ncrId}/purchasing-review`, { cookie: C.pur2, body: { items: [] } });
  assert.equal(act.status, 200);
});

test('SCOPE-NCR-05 GET list: จัดซื้อที่ไม่ได้รับมอบหมายไม่เห็น NCR ของ Supplier ที่มีผู้ดูแล แต่เห็น Supplier ที่ไม่มีผู้ดูแล', async () => {
  const ncrAssigned = makeNcrAtPendingPurchasingReview(supAssigned);
  const ncrOpen = makeNcrAtPendingPurchasingReview(supOpen);
  const list = await api('GET', '/api/ncr?limit=100', { cookie: C.pur2 });
  const ids = list.body.data.map(r => r.id);
  assert.ok(!ids.includes(ncrAssigned), 'ไม่ควรเห็น NCR ของ Supplier ที่มีผู้ดูแลคนอื่น');
  assert.ok(ids.includes(ncrOpen), 'ควรเห็น NCR ของ Supplier ที่ไม่มีผู้ดูแล');
});

test('SCOPE-NCR-06 GET list: purchasing_manager เห็นทุก NCR ไม่ถูกกรอง', async () => {
  const ncrAssigned = makeNcrAtPendingPurchasingReview(supAssigned);
  const list = await api('GET', '/api/ncr?limit=100', { cookie: C.purMgr });
  const ids = list.body.data.map(r => r.id);
  assert.ok(ids.includes(ncrAssigned));
});

// ===== UAI =====
function makeUaiPendingPurchasing(supplierId) {
  const ncrId = (() => {
    const billId = makeBill(supplierId);
    return db.prepare("INSERT INTO ncrs (ncr_code, bill_id, po_no, invoice_no, severity, status, created_by) VALUES (?, ?, 'PO-1', 'INV-1', 'major', 'pending_uai', ?)")
      .run('NCR-UAI-' + Math.random().toString(36).slice(2, 7), billId, uid('qc_staff1')).lastInsertRowid;
  })();
  const uaiId = db.prepare(`INSERT INTO uai_documents (uai_code, ncr_id, reason, product_type, work_type, defect_description, status, created_by)
    VALUES (?, ?, 'r', 'raw_material', 'rework', 'd', 'uai_pending_purchasing', ?)`)
    .run('UAI-TEST-' + Math.random().toString(36).slice(2, 7), ncrId, uid('qc_staff1')).lastInsertRowid;
  return uaiId;
}

test('SCOPE-UAI-01 จัดซื้อที่ไม่ได้ถูกมอบหมาย → 403 ทั้ง GET detail และแก้ไข details', async () => {
  const uaiId = makeUaiPendingPurchasing(supAssigned);
  const detail = await api('GET', `/api/uai/${uaiId}`, { cookie: C.pur2 });
  assert.equal(detail.status, 403);
  const act = await api('PATCH', `/api/uai/${uaiId}/details`, { cookie: C.pur2, body: { reason: 'x' } });
  assert.equal(act.status, 403);
});

test('SCOPE-UAI-02 จัดซื้อที่ถูกมอบหมาย (purchasing1) → ทำได้ปกติ', async () => {
  const uaiId = makeUaiPendingPurchasing(supAssigned);
  const act = await api('PATCH', `/api/uai/${uaiId}/details`, { cookie: C.pur1, body: { reason: 'x' } });
  assert.equal(act.status, 200);
});

test('SCOPE-UAI-03 purchasing_manager ลงนามแทนคิวจัดซื้อได้ (sign override)', async () => {
  const uaiId = makeUaiPendingPurchasing(supAssigned);
  const res = await api('POST', `/api/uai/${uaiId}/sign`, {
    cookie: C.purMgr,
    body: { signature_image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'uai_pending_cco');
});

// ===== Delivery Schedule =====
function makeDeliverySchedule(supplierId, status = 'pending') {
  return db.prepare(`INSERT INTO delivery_schedules (supplier_id, scheduled_date, time_slot, status, created_by)
    VALUES (?, '2026-08-01', '10:00', ?, ?)`).run(supplierId, status, uid('purchasing1')).lastInsertRowid;
}

test('SCOPE-DEL-01 จัดซื้อที่ไม่ได้ถูกมอบหมาย → 403 แก้ไข schedule ของ Supplier ที่มีผู้ดูแล', async () => {
  const id = makeDeliverySchedule(supAssigned);
  const res = await api('PATCH', `/api/delivery/${id}`, { cookie: C.pur2, body: { notes: 'x' } });
  assert.equal(res.status, 403);
});

test('SCOPE-DEL-02 จัดซื้อที่ถูกมอบหมาย (purchasing1) → แก้ไขได้ปกติ', async () => {
  const id = makeDeliverySchedule(supAssigned);
  const res = await api('PATCH', `/api/delivery/${id}`, { cookie: C.pur1, body: { notes: 'x' } });
  assert.equal(res.status, 200);
});

test('SCOPE-DEL-03 purchasing_manager แก้ไขได้แม้ไม่ได้เป็นผู้ดูแล', async () => {
  const id = makeDeliverySchedule(supAssigned);
  const res = await api('PATCH', `/api/delivery/${id}`, { cookie: C.purMgr, body: { notes: 'x' } });
  assert.equal(res.status, 200);
});

test('SCOPE-DEL-04 GET list: จัดซื้อเห็นปฏิทินแผนส่งของทุก Supplier เหมือน QC (ตัดสินใจ user — ต่างจาก NCR/UAI ที่ยัง scope ตามผู้ดูแล)', async () => {
  const idAssigned = makeDeliverySchedule(supAssigned);
  const idOpen = makeDeliverySchedule(supOpen);
  const list = await api('GET', '/api/delivery?limit=100', { cookie: C.pur2 });
  const ids = list.body.data.map(r => r.id);
  assert.ok(ids.includes(idAssigned), 'จัดซื้อต้องเห็น schedule ของ Supplier ที่มีผู้ดูแลคนอื่นด้วย (ไม่ scope การเห็นอีกต่อไป)');
  assert.ok(ids.includes(idOpen));
  // แต่สิทธิ์แก้ไขยังคง scope ตามผู้ดูแลเหมือนเดิม (ดู SCOPE-DEL-01/02/03) — เห็นได้ ไม่ได้แปลว่าแก้ไขได้
  const patchOther = await api('PATCH', `/api/delivery/${idAssigned}`, { cookie: C.pur2, body: { notes: 'x' } });
  assert.equal(patchOther.status, 403);
});

test('SCOPE-DEL-05 qc_staff ไม่ถูกกรองด้วย logic นี้ (ไม่ใช่ purchasing) — ยังเห็น/acknowledge schedule ได้ปกติ', async () => {
  const id = makeDeliverySchedule(supAssigned, 'pending');
  const list = await api('GET', '/api/delivery?limit=100', { cookie: C.staff });
  assert.ok(list.body.data.map(r => r.id).includes(id));
  const ack = await api('POST', `/api/delivery/${id}/acknowledge`, { cookie: C.staff });
  assert.equal(ack.status, 200);
});
