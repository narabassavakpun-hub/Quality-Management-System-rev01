// Integration tests — Bills lifecycle via HTTP (node --test)
// ครอบ routes/bills.js: create → add item → submit → approve/reject + guards
// safety net ก่อนสกัด billService (AUDIT.md §12)
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.IQC_DB_PATH = path.join(os.tmpdir(), `iqc-bills-${process.pid}-${Date.now()}.db`);
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-bills';

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
for (const [k, un] of [['staff', 'qc_staff1'], ['sup', 'supervisor1'], ['mgr', 'manager1']]) { setSess(un, k); C[k] = 'token=' + jwt.sign({ id: uid(un), sessionToken: k }, process.env.JWT_SECRET); }

const supOk = db.prepare("INSERT INTO suppliers (name, approval_status) VALUES ('ผู้ผลิตดี','approved')").run().lastInsertRowid;
const supBad = db.prepare("INSERT INTO suppliers (name, approval_status) VALUES ('ผู้ผลิตบล็อก','blacklisted')").run().lastInsertRowid;

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/bills', require('../routes/bills'));
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
const billBody = (over = {}) => ({ invoice_no: 'INV-' + Math.random().toString(36).slice(2, 7), po_no: 'PO-1', supplier_id: supOk, received_date: '2026-01-10', ...over });
const cleanItem = (over = {}) => ({ item_name: 'สินค้า', qty_received: 100, qty_sampled: 10, qty_passed: 10, qty_failed: 0, ...over });

let billId;

test('BILL-01 qc_staff creates bill → draft', async () => {
  const r = await api('POST', '/api/bills', { cookie: C.staff, body: billBody() });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'draft');
  billId = r.body.id;
});

test('BILL-02 permission: qc_supervisor cannot create bill → 403', async () => {
  const r = await api('POST', '/api/bills', { cookie: C.sup, body: billBody() });
  assert.equal(r.status, 403);
});

test('BILL-03 blacklisted supplier → 400', async () => {
  const r = await api('POST', '/api/bills', { cookie: C.staff, body: billBody({ supplier_id: supBad }) });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /blacklisted/);
});

test('BILL-04 add item → ok', async () => {
  const r = await api('POST', `/api/bills/${billId}/items`, { cookie: C.staff, body: cleanItem() });
  assert.equal(r.status, 200);
  assert.ok(r.body.id);
});

test('BILL-05 add item with expiry < received → 400 (BUG-004)', async () => {
  const r = await api('POST', `/api/bills/${billId}/items`, { cookie: C.staff, body: cleanItem({ expiry_date: '2026-01-01' }) });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /หมดอายุ|expiry/);
});

test('BILL-06 add item qty invalid (passed+failed > sampled) → 400', async () => {
  const r = await api('POST', `/api/bills/${billId}/items`, { cookie: C.staff, body: cleanItem({ qty_sampled: 5, qty_passed: 4, qty_failed: 4 }) });
  assert.equal(r.status, 400);
});

test('BILL-07 submit bill with no items → 400', async () => {
  const empty = await api('POST', '/api/bills', { cookie: C.staff, body: billBody() });
  const r = await api('POST', `/api/bills/${empty.body.id}/submit`, { cookie: C.staff });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /รายการ/);
});

test('BILL-08 submit bill (with clean item) → pending_approval', async () => {
  const r = await api('POST', `/api/bills/${billId}/submit`, { cookie: C.staff });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'pending_approval');
});

test('BILL-09 approve wrong-status (already pending twice) guarded', async () => {
  // supervisor approve pending → approved
  const ok = await api('POST', `/api/bills/${billId}/approve`, { cookie: C.sup });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.status, 'approved');
  // approve again → 400 (not pending)
  const again = await api('POST', `/api/bills/${billId}/approve`, { cookie: C.sup });
  assert.equal(again.status, 400);
});

test('BILL-10 permission: qc_staff cannot approve → 403', async () => {
  const b = await api('POST', '/api/bills', { cookie: C.staff, body: billBody() });
  await api('POST', `/api/bills/${b.body.id}/items`, { cookie: C.staff, body: cleanItem() });
  await api('POST', `/api/bills/${b.body.id}/submit`, { cookie: C.staff });
  const r = await api('POST', `/api/bills/${b.body.id}/approve`, { cookie: C.staff });
  assert.equal(r.status, 403);
});

test('BILL-11 supervisor reject pending → back to draft', async () => {
  const b = await api('POST', '/api/bills', { cookie: C.staff, body: billBody() });
  await api('POST', `/api/bills/${b.body.id}/items`, { cookie: C.staff, body: cleanItem() });
  await api('POST', `/api/bills/${b.body.id}/submit`, { cookie: C.staff });
  const r = await api('POST', `/api/bills/${b.body.id}/reject`, { cookie: C.sup, body: { comment: 'แก้ไข' } });
  assert.equal(r.status, 200);
  const detail = await api('GET', `/api/bills/${b.body.id}`, { cookie: C.staff });
  assert.equal(detail.body.status, 'draft');
});

// ===== Telegram กลุ่ม QC — ข้อความรูปแบบใหม่ตอน submit/approve (คำขอ user, S143) =====
// mock 'node-fetch' ผ่าน require.cache (pattern เดียวกับ test/backupService.test.js's mockNodeFetch) กันยิง
// network จริงไป Telegram API ระหว่างเทส — sendTelegram() ใน routes/notifications.js ไม่ await โดยผู้เรียก
// (fire-and-forget) แต่ mock function เองไม่ใช่ async จึง set ตัวแปรจับค่า synchronous ทันทีตอนถูกเรียก ไม่ต้อง
// รอ tick เพิ่ม
const nodeFetchPath = require.resolve('node-fetch');
function mockNodeFetch(impl) {
  const orig = require.cache[nodeFetchPath];
  require.cache[nodeFetchPath] = { id: nodeFetchPath, filename: nodeFetchPath, loaded: true, exports: impl };
  return () => { if (orig) require.cache[nodeFetchPath] = orig; else delete require.cache[nodeFetchPath]; };
}

test('BILL-12 Telegram (submit): ข้อความมีรายละเอียดครบ + emoji สถานะรออนุมัติ', async () => {
  db.setSetting('telegram_bot_token', 'test-token');
  db.setSetting('telegram_group_qc', 'test-group-chat-id');
  db.setSetting('app_url', 'https://qms-d5fm.onrender.com');

  let calledUrl = null, calledText = null;
  const restore = mockNodeFetch((url, opts) => {
    calledUrl = url;
    calledText = JSON.parse(opts.body).text;
    return Promise.resolve({ ok: true });
  });
  try {
    const b = await api('POST', '/api/bills', { cookie: C.staff, body: billBody({ po_no: 'PO-TG-1', invoice_no: 'INV-TG-1', received_date: '2026-01-10' }) });
    await api('POST', `/api/bills/${b.body.id}/items`, { cookie: C.staff, body: cleanItem() });
    const r = await api('POST', `/api/bills/${b.body.id}/submit`, { cookie: C.staff });
    assert.equal(r.status, 200);

    assert.equal(calledUrl, 'https://api.telegram.org/bottest-token/sendMessage');
    assert.match(calledText, /^\[IQC\] 📥 มีบันทึกรับเข้าบิลใหม่/);
    assert.match(calledText, /PO: PO-TG-1/);
    assert.match(calledText, /Invoice: INV-TG-1/);
    assert.match(calledText, /บริษัท: ผู้ผลิตดี/);
    assert.match(calledText, /จำนวนรายการ 1 รายการ/);
    assert.match(calledText, /วันที่บิล: 10\/01\/2569/); // BE year (2026+543)
    assert.match(calledText, /ผู้รับเข้า: .+/);
    assert.match(calledText, /สถานะ: ⏳ รออนุมัติ/);
    assert.match(calledText, new RegExp(`Link: https://qms-d5fm\\.onrender\\.com/bills/${b.body.id}$`));
  } finally {
    restore();
  }
});

test('BILL-13 Telegram (approve): ข้อความกรอบดาว + emoji ✅ อนุมัติแล้ว', async () => {
  db.setSetting('telegram_bot_token', 'test-token');
  db.setSetting('telegram_group_qc', 'test-group-chat-id');

  const b = await api('POST', '/api/bills', { cookie: C.staff, body: billBody({ po_no: 'PO-TG-2', invoice_no: 'INV-TG-2' }) });
  await api('POST', `/api/bills/${b.body.id}/items`, { cookie: C.staff, body: cleanItem() });
  await api('POST', `/api/bills/${b.body.id}/submit`, { cookie: C.staff });

  let calledText = null;
  const restore = mockNodeFetch((url, opts) => {
    calledText = JSON.parse(opts.body).text;
    return Promise.resolve({ ok: true });
  });
  try {
    const r = await api('POST', `/api/bills/${b.body.id}/approve`, { cookie: C.sup });
    assert.equal(r.status, 200);

    const lines = calledText.split('\n');
    assert.equal(lines[0], '***************************');
    assert.match(calledText, /PO: PO-TG-2/);
    assert.match(calledText, /Invoice: INV-TG-2/);
    assert.match(calledText, /บริษัท: ผู้ผลิตดี/);
    assert.match(calledText, /จำนวนรายการ 1 รายการ/);
    assert.match(calledText, /✅ ได้รับการอนุมัติแล้ว/);
    // กรอบดาวคั่นก่อน/หลังบล็อกข้อมูล และปิดท้าย
    assert.equal(lines.filter(l => l === '***************************').length, 3);
  } finally {
    restore();
  }
});
