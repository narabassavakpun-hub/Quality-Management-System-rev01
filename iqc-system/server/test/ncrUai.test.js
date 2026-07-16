// Integration tests — NCR + UAI full workflow via HTTP (node --test)
// ครอบ state machine จริงของ routes/ncr.js, routes/supplier.js, routes/uai.js
// เป้าหมาย: safety net ก่อน refactor service layer (AUDIT.md §12)
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.IQC_DB_PATH = path.join(os.tmpdir(), `iqc-ncruai-${process.pid}-${Date.now()}.db`);
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-ncruai';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const db = require('../db/database');

// ---- users / sessions / cookies ----
const uid = (un) => db.prepare('SELECT id FROM users WHERE username = ?').get(un).id;
const setSess = (un, s) => db.prepare('UPDATE users SET session_token=? WHERE username=?').run(s, un);
// qc_staff1 ต้องเป็นสถานี incoming จึงเปิด NCR ได้ (router.use guard ใน ncr.js)
db.prepare("UPDATE users SET qc_station='incoming' WHERE username='qc_staff1'").run();

// purchasing_manager ไม่ได้ seed มาเป็นค่าเริ่มต้น — สร้างเพิ่มเพื่อทดสอบ S128 gate (เหมือน purchasingScope.test.js)
db.prepare("INSERT INTO users (username, password_hash, full_name, role, is_active) VALUES ('purmgr1','x','ผู้จัดการจัดซื้อทดสอบ','purchasing_manager',1)").run();

const ACTORS = {
  staff: 'qc_staff1', sup: 'supervisor1', mgr: 'manager1', qmr: 'qmr1',
  pur: 'purchasing1', cco: 'cco1', cmo: 'cmo1', cpo: 'cpo1', prod: 'production1',
  purMgr: 'purmgr1',
};
const C = {};
for (const [k, un] of Object.entries(ACTORS)) { setSess(un, k); C[k] = 'token=' + jwt.sign({ id: uid(un), sessionToken: k }, process.env.JWT_SECRET); }

// ---- fixtures ----
const supId = db.prepare("INSERT INTO suppliers (name) VALUES ('ผู้ผลิตทดสอบ')").run().lastInsertRowid;
const grp = db.prepare("INSERT INTO product_groups (name) VALUES ('กลุ่มทดสอบ')").run().lastInsertRowid;
const unit = db.prepare("INSERT INTO units (name) VALUES ('ชิ้น')").run().lastInsertRowid;
const prod = db.prepare("INSERT INTO products (name,supplier_id,product_group_id,unit_id) VALUES ('สินค้าทดสอบ',?,?,?)").run(supId, grp, unit).lastInsertRowid;
const dcat = db.prepare("INSERT INTO defect_categories (name) VALUES ('ผิวไม่เรียบ')").run().lastInsertRowid;
const bill = db.prepare("INSERT INTO bills (invoice_no,po_no,supplier_id,received_date,status,created_by) VALUES ('INV-001','PO-001',?, '2026-01-05','approved',?)").run(supId, uid('qc_staff1')).lastInsertRowid;
const mkItem = () => db.prepare("INSERT INTO bill_items (bill_id,product_id,item_name,qty_received,qty_sampled,qty_passed,qty_failed,defect_category_id) VALUES (?,?,'สินค้าทดสอบ',100,10,7,3,?)").run(bill, prod, dcat).lastInsertRowid;
const itemA = mkItem(); // for NCR happy-path
const itemB = mkItem(); // for UAI flow
const itemC = mkItem(); // for reject/resubmit branch
const itemD = mkItem(); // for reject-exec branch

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/ncr', require('../routes/ncr'));
app.use('/api/supplier', require('../routes/supplier'));
app.use('/api/uai', require('../routes/uai'));

let server, base;
test.before(async () => { server = app.listen(0); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => {
  // ลบไฟล์ลายเซ็นที่ test สร้างใน uploads/uai (DB นี้เป็น temp isolated — sig ทั้งหมดมาจาก test นี้)
  let sigs = [];
  try { sigs = db.prepare("SELECT signature_image FROM uai_signatures WHERE signature_image IS NOT NULL AND signature_image != ''").all().map(r => r.signature_image); } catch {}
  try { server.close(); } catch {}
  try { db.close(); } catch {}
  const uaiDir = path.join(__dirname, '../../uploads/uai');
  for (const s of sigs) { try { fs.unlinkSync(path.join(uaiDir, s)); } catch {} }
  for (const f of [process.env.IQC_DB_PATH, process.env.IQC_DB_PATH + '-wal', process.env.IQC_DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch {} }
});

async function api(method, p, { cookie, body } = {}) {
  const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json; try { json = await res.json(); } catch { json = null; }
  return { status: res.status, body: json };
}
const ncrItems = (bill_item_id) => [{ bill_item_id, item_name: 'สินค้าทดสอบ', qty_received: 100, qty_sampled: 10, qty_failed: 3, defect_category_id: dcat, defect_detail: 'ผิวไม่เรียบ' }];
// 1x1 PNG data-url สำหรับลายเซ็น (ผ่าน regex saveSignatureImage)
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

// ================= GROUP A: NCR full lifecycle → closed =================
let ncrId, token;

test('NCR-01 qc_staff (incoming) creates major NCR → pending_supervisor', async () => {
  const r = await api('POST', '/api/ncr', { cookie: C.staff, body: { bill_id: bill, severity: 'major', items: ncrItems(itemA) } });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'pending_supervisor');
  assert.match(r.body.ncr_code, /^NCR-\d{4}-\d{4,}$/);
  assert.equal(r.body.items.length, 1);
  assert.ok(r.body.supplier_token, 'major NCR ต้องมี supplier_token');
  ncrId = r.body.id; token = r.body.supplier_token;
});

test('NCR-02 permission: qc_manager cannot create NCR → 403', async () => {
  const r = await api('POST', '/api/ncr', { cookie: C.mgr, body: { bill_id: bill, severity: 'major', items: ncrItems(itemA) } });
  assert.equal(r.status, 403);
});

test('NCR-03 duplicate bill_item in another NCR → 400', async () => {
  const r = await api('POST', '/api/ncr', { cookie: C.staff, body: { bill_id: bill, severity: 'major', items: ncrItems(itemA) } });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /NCR อื่น/);
});

test('NCR-04 supervisor approve → pending_manager', async () => {
  const r = await api('POST', `/api/ncr/${ncrId}/approve`, { cookie: C.sup, body: {} });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'pending_manager');
});

test('NCR-05 permission: supervisor cannot approve pending_manager step → 403', async () => {
  const r = await api('POST', `/api/ncr/${ncrId}/approve`, { cookie: C.sup, body: {} });
  assert.equal(r.status, 403);
});

test('NCR-06 manager approve without disposition → 400 (BUG-005)', async () => {
  const r = await api('POST', `/api/ncr/${ncrId}/approve`, { cookie: C.mgr, body: {} });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /disposition/);
});

test('NCR-07 manager approve with disposition=return → pending_qmr_open', async () => {
  const r = await api('POST', `/api/ncr/${ncrId}/approve`, { cookie: C.mgr, body: { disposition: 'return', disposition_note: 'คืนของ', disposition_due_date: '2026-02-01' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'pending_qmr_open');
});

test('NCR-08 qmr approve → pending_purchasing_review', async () => {
  const r = await api('POST', `/api/ncr/${ncrId}/approve`, { cookie: C.qmr, body: {} });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'pending_purchasing_review');
});

test('NCR-09 purchasing review → pending_purchasing_manager_review', async () => {
  const r = await api('PATCH', `/api/ncr/${ncrId}/purchasing-review`, { cookie: C.pur, body: { items: [] } });
  assert.equal(r.status, 200);
  const ncr = await api('GET', `/api/ncr/${ncrId}`, { cookie: C.mgr });
  assert.equal(ncr.body.status, 'pending_purchasing_manager_review');
});

test('NCR-09b qc_manager/purchasing cannot approve pending_purchasing_manager_review → 403', async () => {
  assert.equal((await api('POST', `/api/ncr/${ncrId}/approve`, { cookie: C.mgr, body: {} })).status, 403);
  assert.equal((await api('POST', `/api/ncr/${ncrId}/approve`, { cookie: C.pur, body: {} })).status, 403);
});

test('NCR-09c purchasing_manager approve → pending_supplier (link becomes copyable)', async () => {
  const before = await api('POST', `/api/ncr/${ncrId}/record-link-copy`, { cookie: C.pur, body: {} });
  assert.equal(before.status, 400); // ยังไม่ถึง pending_supplier — copy link ไม่ได้

  const r = await api('POST', `/api/ncr/${ncrId}/approve`, { cookie: C.purMgr, body: {} });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'pending_supplier');

  const after = await api('POST', `/api/ncr/${ncrId}/record-link-copy`, { cookie: C.pur, body: {} });
  assert.equal(after.status, 200);
});

test('NCR-10 supplier GET by token → 200 pending_supplier', async () => {
  const r = await api('GET', `/api/supplier/ncr/${token}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'pending_supplier');
});

test('NCR-11 supplier respond (missing respondent_name) → 400', async () => {
  const r = await api('POST', `/api/supplier/ncr/${token}/respond`, { body: { root_cause: 'x', corrective_action: 'y', preventive_action: 'z' } });
  assert.equal(r.status, 400);
});

test('NCR-12 supplier respond ok → NCR pending_manager_review', async () => {
  const r = await api('POST', `/api/supplier/ncr/${token}/respond`, { body: { respondent_name: 'คุณสมชาย', root_cause: 'เครื่องจักร', corrective_action: 'ปรับตั้ง', preventive_action: 'บำรุงรักษา', completion_date: '2026-02-10' } });
  assert.equal(r.status, 200);
  const ncr = await api('GET', `/api/ncr/${ncrId}`, { cookie: C.mgr });
  assert.equal(ncr.body.status, 'pending_manager_review');
});

test('NCR-13 supplier respond twice → 400 (already responded)', async () => {
  const r = await api('POST', `/api/supplier/ncr/${token}/respond`, { body: { respondent_name: 'ซ้ำ', root_cause: 'a', corrective_action: 'b', preventive_action: 'c' } });
  assert.equal(r.status, 400);
});

test('NCR-14 manager approve response → pending_qmr_close', async () => {
  const r = await api('POST', `/api/ncr/${ncrId}/approve`, { cookie: C.mgr, body: {} });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'pending_qmr_close');
});

test('NCR-15 qmr close → closed', async () => {
  const r = await api('POST', `/api/ncr/${ncrId}/approve`, { cookie: C.qmr, body: {} });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'closed');
  const ncr = await api('GET', `/api/ncr/${ncrId}`, { cookie: C.mgr });
  assert.equal(ncr.body.status, 'closed');
});

// ================= GROUP B: NCR (disposition=uai) → UAI full sign flow → completed =================
let ncrB, tokenB, uaiId;

test('UAI-01 setup NCR to pending_supplier with disposition=uai', async () => {
  const c = await api('POST', '/api/ncr', { cookie: C.staff, body: { bill_id: bill, severity: 'major', items: ncrItems(itemB) } });
  assert.equal(c.status, 200);
  ncrB = c.body.id; tokenB = c.body.supplier_token;
  assert.equal((await api('POST', `/api/ncr/${ncrB}/approve`, { cookie: C.sup, body: {} })).body.status, 'pending_manager');
  assert.equal((await api('POST', `/api/ncr/${ncrB}/approve`, { cookie: C.mgr, body: { disposition: 'uai', disposition_note: 'ใช้ต่อได้' } })).body.status, 'pending_qmr_open');
  assert.equal((await api('POST', `/api/ncr/${ncrB}/approve`, { cookie: C.qmr, body: {} })).body.status, 'pending_purchasing_review');
  assert.equal((await api('PATCH', `/api/ncr/${ncrB}/purchasing-review`, { cookie: C.pur, body: { items: [] } })).status, 200);
  assert.equal((await api('POST', `/api/ncr/${ncrB}/approve`, { cookie: C.purMgr, body: {} })).body.status, 'pending_supplier');
});

test('UAI-02 purchasing request-uai → uai_pending_qc_manager', async () => {
  const r = await api('POST', `/api/ncr/${ncrB}/request-uai`, { cookie: C.pur, body: {
    reason: 'ใช้ได้ตามสภาพ', product_type: 'วัตถุดิบ', work_type: 'ประกอบ', defect_description: 'ผิวไม่เรียบ',
    root_cause_purchasing: 'เครื่อง', corrective_action_purchasing: 'ปรับ', preventive_action_purchasing: 'ดูแล',
  } });
  assert.equal(r.status, 200);
  assert.ok(r.body.uai_id);
  uaiId = r.body.uai_id;
  const u = await api('GET', `/api/uai/${uaiId}`, { cookie: C.mgr });
  assert.equal(u.body.status, 'uai_pending_qc_manager');
});

test('UAI-03 request-uai again → 400 (NCR no longer pending_supplier)', async () => {
  const r = await api('POST', `/api/ncr/${ncrB}/request-uai`, { cookie: C.pur, body: {
    reason: 'x', product_type: 'a', work_type: 'b', defect_description: 'c',
    root_cause_purchasing: 'd', corrective_action_purchasing: 'e', preventive_action_purchasing: 'f',
  } });
  assert.equal(r.status, 400);
});

test('UAI-04 qc_manager review approve → uai_pending_purchasing', async () => {
  const r = await api('POST', `/api/uai/${uaiId}/qc-manager-review`, { cookie: C.mgr, body: { decision: 'approve' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'uai_pending_purchasing');
});

test('UAI-05 sign out of turn (cco before purchasing) → 403', async () => {
  const r = await api('POST', `/api/uai/${uaiId}/sign`, { cookie: C.cco, body: { signature_image: SIG } });
  assert.equal(r.status, 403);
});

test('UAI-06 full sign chain purchasing→cco→cmo→cpo→qc→prod→qmr → uai_completed', async () => {
  const steps = [
    [C.pur, 'uai_pending_cco'],
    [C.cco, 'uai_pending_cmo'],
    [C.cmo, 'uai_pending_cpo'],
    [C.cpo, 'uai_pending_qc_ack'],
    [C.mgr, 'uai_pending_production_ack'],
    [C.prod, 'uai_pending_qmr_ack'],
    [C.qmr, 'uai_completed'],
  ];
  for (const [cookie, expected] of steps) {
    const r = await api('POST', `/api/uai/${uaiId}/sign`, { cookie, body: { signature_image: SIG, comment: 'ok' } });
    assert.equal(r.status, 200, `sign → ${expected} ต้อง 200 (ได้ ${JSON.stringify(r.body)})`);
    assert.equal(r.body.status, expected);
  }
});

test('UAI-07 UAI completed closes the NCR', async () => {
  const ncr = await api('GET', `/api/ncr/${ncrB}`, { cookie: C.mgr });
  assert.equal(ncr.body.status, 'closed');
  assert.match(ncr.body.uai_close_remark || '', /UAI/);
});

test('UAI-08 sign after completed → 400 (not a signing step)', async () => {
  const r = await api('POST', `/api/uai/${uaiId}/sign`, { cookie: C.qmr, body: { signature_image: SIG } });
  assert.equal(r.status, 400);
});

// ================= GROUP C: reject supplier response → resubmit =================
async function walkToManagerReview(item) {
  const c = await api('POST', '/api/ncr', { cookie: C.staff, body: { bill_id: bill, severity: 'major', items: ncrItems(item) } });
  const id = c.body.id, tk = c.body.supplier_token;
  await api('POST', `/api/ncr/${id}/approve`, { cookie: C.sup, body: {} });
  await api('POST', `/api/ncr/${id}/approve`, { cookie: C.mgr, body: { disposition: 'return', disposition_note: 'x' } });
  await api('POST', `/api/ncr/${id}/approve`, { cookie: C.qmr, body: {} });
  await api('PATCH', `/api/ncr/${id}/purchasing-review`, { cookie: C.pur, body: { items: [] } });
  await api('POST', `/api/ncr/${id}/approve`, { cookie: C.purMgr, body: {} });
  await api('POST', `/api/supplier/ncr/${tk}/respond`, { body: { respondent_name: 'A', root_cause: 'a', corrective_action: 'b', preventive_action: 'c' } });
  return { id, tk };
}

let rjId, rjToken;
test('RJ-01 setup NCR → pending_manager_review', async () => {
  const r = await walkToManagerReview(itemC); rjId = r.id; rjToken = r.tk;
  assert.equal((await api('GET', `/api/ncr/${rjId}`, { cookie: C.mgr })).body.status, 'pending_manager_review');
});
test('RJ-02 reject-supplier-response without comment → 400', async () => {
  const r = await api('POST', `/api/ncr/${rjId}/reject-supplier-response`, { cookie: C.mgr, body: {} });
  assert.equal(r.status, 400);
});
test('RJ-03 manager reject-supplier-response → pending_supplier_resubmit', async () => {
  const r = await api('POST', `/api/ncr/${rjId}/reject-supplier-response`, { cookie: C.mgr, body: { comment: 'ไม่ครบ' } });
  assert.equal(r.status, 200);
  assert.equal((await api('GET', `/api/ncr/${rjId}`, { cookie: C.mgr })).body.status, 'pending_supplier_resubmit');
});
test('RJ-04 purchasing resubmit-to-supplier → pending_supplier', async () => {
  const r = await api('POST', `/api/ncr/${rjId}/resubmit-to-supplier`, { cookie: C.pur, body: {} });
  assert.equal(r.status, 200);
  assert.equal((await api('GET', `/api/ncr/${rjId}`, { cookie: C.mgr })).body.status, 'pending_supplier');
});
test('RJ-05 supplier respond again (old superseded) → pending_manager_review', async () => {
  const r = await api('POST', `/api/supplier/ncr/${rjToken}/respond`, { body: { respondent_name: 'B', root_cause: 'x', corrective_action: 'y', preventive_action: 'z' } });
  assert.equal(r.status, 200);
  assert.equal((await api('GET', `/api/ncr/${rjId}`, { cookie: C.mgr })).body.status, 'pending_manager_review');
});

// ================= GROUP D: exec reject UAI =================
let rxUai;
test('RX-01 setup UAI → uai_pending_cco', async () => {
  const c = await api('POST', '/api/ncr', { cookie: C.staff, body: { bill_id: bill, severity: 'major', items: ncrItems(itemD) } });
  const id = c.body.id;
  await api('POST', `/api/ncr/${id}/approve`, { cookie: C.sup, body: {} });
  await api('POST', `/api/ncr/${id}/approve`, { cookie: C.mgr, body: { disposition: 'uai', disposition_note: 'x' } });
  await api('POST', `/api/ncr/${id}/approve`, { cookie: C.qmr, body: {} });
  await api('PATCH', `/api/ncr/${id}/purchasing-review`, { cookie: C.pur, body: { items: [] } });
  await api('POST', `/api/ncr/${id}/approve`, { cookie: C.purMgr, body: {} });
  const req = await api('POST', `/api/ncr/${id}/request-uai`, { cookie: C.pur, body: { reason: 'r', product_type: 'p', work_type: 'w', defect_description: 'd', root_cause_purchasing: 'a', corrective_action_purchasing: 'b', preventive_action_purchasing: 'c' } });
  rxUai = req.body.uai_id;
  await api('POST', `/api/uai/${rxUai}/qc-manager-review`, { cookie: C.mgr, body: { decision: 'approve' } });
  const sign = await api('POST', `/api/uai/${rxUai}/sign`, { cookie: C.pur, body: { signature_image: SIG } });
  assert.equal(sign.body.status, 'uai_pending_cco');
});
test('RX-02 cco reject-exec without reason → 400', async () => {
  const r = await api('POST', `/api/uai/${rxUai}/reject-exec`, { cookie: C.cco, body: {} });
  assert.equal(r.status, 400);
});
test('RX-03 cco reject-exec (reason) → uai_rejected_by_exec + NCR pending_supplier', async () => {
  const r = await api('POST', `/api/uai/${rxUai}/reject-exec`, { cookie: C.cco, body: { reason: 'ไม่อนุมัติ' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'uai_rejected_by_exec');
  assert.equal((await api('GET', `/api/uai/${rxUai}`, { cookie: C.mgr })).body.status, 'uai_rejected_by_exec');
});

// ================= GROUP E: S128 — claim value validation + product_code join =================
const prodWithCode = db.prepare("INSERT INTO products (name,code,supplier_id,product_group_id,unit_id) VALUES ('สินค้ามีรหัส','HW-0166-00000',?,?,?)").run(supId, grp, unit).lastInsertRowid;
const itemE = db.prepare("INSERT INTO bill_items (bill_id,product_id,item_name,qty_received,qty_sampled,qty_passed,qty_failed,defect_category_id) VALUES (?,?,'สินค้ามีรหัส',100,10,7,3,?)").run(bill, prodWithCode, dcat).lastInsertRowid;

let ncrE, ncrEItemId, ncrEToken;
test('CV-01 setup NCR → pending_purchasing_review', async () => {
  const c = await api('POST', '/api/ncr', { cookie: C.staff, body: { bill_id: bill, severity: 'major', items: ncrItems(itemE) } });
  ncrE = c.body.id; ncrEItemId = c.body.items[0].id; ncrEToken = c.body.supplier_token;
  await api('POST', `/api/ncr/${ncrE}/approve`, { cookie: C.sup, body: {} });
  await api('POST', `/api/ncr/${ncrE}/approve`, { cookie: C.mgr, body: { disposition: 'return', disposition_note: 'x' } });
  const r = await api('POST', `/api/ncr/${ncrE}/approve`, { cookie: C.qmr, body: {} });
  assert.equal(r.body.status, 'pending_purchasing_review');
});

test('CV-02 GET /api/ncr/:id คืน product_code ต่อ item', async () => {
  const r = await api('GET', `/api/ncr/${ncrE}`, { cookie: C.pur });
  assert.equal(r.body.items[0].product_code, 'HW-0166-00000');
});

test('CV-03 purchasing-review ขาด claim_value_thb/usd → 400', async () => {
  const r = await api('PATCH', `/api/ncr/${ncrE}/purchasing-review`, { cookie: C.pur, body: { items: [{ id: ncrEItemId, item_name_en: 'x', claim_value_thb: '100' }] } });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /มูลค่าสินค้าเคลม/);
});

test('CV-04 purchasing-review กรอกครบ (รวม "-") → 200 + บันทึกค่าไว้', async () => {
  const r = await api('PATCH', `/api/ncr/${ncrE}/purchasing-review`, { cookie: C.pur, body: { items: [{ id: ncrEItemId, item_name_en: 'silicone', claim_value_thb: '500', claim_value_usd: '-' }] } });
  assert.equal(r.status, 200);
  const ncr = await api('GET', `/api/ncr/${ncrE}`, { cookie: C.pur });
  assert.equal(ncr.body.status, 'pending_purchasing_manager_review');
  assert.equal(ncr.body.items[0].claim_value_thb, '500');
  assert.equal(ncr.body.items[0].claim_value_usd, '-');
});

test('CV-05 record-link-copy ที่ pending_purchasing_manager_review → 400 (ยังไม่ผ่าน manager)', async () => {
  const r = await api('POST', `/api/ncr/${ncrE}/record-link-copy`, { cookie: C.pur, body: {} });
  assert.equal(r.status, 400);
});

test('CV-06 reject-purchasing-review: qc_manager/purchasing ทำไม่ได้ → 403', async () => {
  assert.equal((await api('POST', `/api/ncr/${ncrE}/reject-purchasing-review`, { cookie: C.mgr, body: { comment: 'x' } })).status, 403);
  assert.equal((await api('POST', `/api/ncr/${ncrE}/reject-purchasing-review`, { cookie: C.pur, body: { comment: 'x' } })).status, 403);
});

test('CV-07 reject-purchasing-review: purchasing_manager ไม่ใส่เหตุผล → 400', async () => {
  const r = await api('POST', `/api/ncr/${ncrE}/reject-purchasing-review`, { cookie: C.purMgr, body: {} });
  assert.equal(r.status, 400);
});

test('CV-08 reject-purchasing-review: purchasing_manager ไม่อนุมัติ → กลับไป pending_purchasing_review, ค่าที่กรอกไว้ยังอยู่', async () => {
  const r = await api('POST', `/api/ncr/${ncrE}/reject-purchasing-review`, { cookie: C.purMgr, body: { comment: 'มูลค่าเคลมดูไม่สมเหตุสมผล กรุณาตรวจสอบใหม่' } });
  assert.equal(r.status, 200);
  const ncr = await api('GET', `/api/ncr/${ncrE}`, { cookie: C.pur });
  assert.equal(ncr.body.status, 'pending_purchasing_review');
  assert.equal(ncr.body.items[0].claim_value_thb, '500'); // ไม่ถูกล้าง — จัดซื้อแก้ไขต่อได้
  assert.equal(ncr.body.items[0].claim_value_usd, '-');
});

test('CV-09 purchasing-review ใหม่อีกครั้งหลังถูกไม่อนุมัติ → pending_purchasing_manager_review อีกครั้ง → manager อนุมัติ → pending_supplier', async () => {
  const review = await api('PATCH', `/api/ncr/${ncrE}/purchasing-review`, { cookie: C.pur, body: { items: [{ id: ncrEItemId, item_name_en: 'silicone (revised)', claim_value_thb: '450', claim_value_usd: '-' }] } });
  assert.equal(review.status, 200);
  const afterReview = await api('GET', `/api/ncr/${ncrE}`, { cookie: C.pur });
  assert.equal(afterReview.body.status, 'pending_purchasing_manager_review');
  assert.equal(afterReview.body.items[0].claim_value_thb, '450');

  const approve = await api('POST', `/api/ncr/${ncrE}/approve`, { cookie: C.purMgr, body: {} });
  assert.equal(approve.status, 200);
  assert.equal(approve.body.status, 'pending_supplier');
});

test('CV-10 GET /api/supplier/ncr/:token — เห็น product_code + disposition แต่ไม่เห็น claim_value_thb/usd (ข้อมูลภายใน)', async () => {
  const r = await api('GET', `/api/supplier/ncr/${ncrEToken}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.disposition, 'return');
  assert.equal(r.body.items[0].product_code, 'HW-0166-00000');
  assert.equal(r.body.items[0].claim_value_thb, undefined);
  assert.equal(r.body.items[0].claim_value_usd, undefined);
});
