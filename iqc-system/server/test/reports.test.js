// Integration tests — Reports (Summary/Receiving) via HTTP (node --test)
// คำขอ user: (1) หน้ารายงานของ COO กด Export PDF ไม่ได้ — พบว่า GET /api/reports/summary/pdf ไม่มี route
// เลยสักตัว (ไม่ใช่ปัญหาสิทธิ์ COO) (2) "รายการรับเข้า"/"อัตราผ่าน" เดิมคำนวณจากผลรวมจำนวนชิ้น (SUM qty_received/
// qty_passed) ทำให้ตัวเลขดูเหมือนนับผิด (เช่น "500") — แก้เป็นนับจากแถว bill_items (รายการ) และอัตราผ่านคำนวณจาก
// "รายการที่มีการออก NCR" เทียบกับรายการทั้งหมด แทน
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.IQC_DB_PATH = path.join(os.tmpdir(), `iqc-reports-${process.pid}-${Date.now()}.db`);
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-reports';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const ExcelJS = require('exceljs');
const db = require('../db/database');

const uid = (un) => db.prepare('SELECT id FROM users WHERE username = ?').get(un).id;
const setSess = (un, s) => db.prepare('UPDATE users SET session_token=? WHERE username=?').run(s, un);
// cco1 ('วิชัย COO'), supervisor1 ('วิไล หัวหน้า QC') seed มาให้แล้ว (database.js) — purchasing_manager ไม่มี seed
// เริ่มต้น (S125 เพิ่ง introduce role นี้) ต้องสร้างเอง
db.prepare("UPDATE users SET qc_station='incoming' WHERE username='qc_staff1'").run();
db.prepare("INSERT INTO users (username, password_hash, full_name, role, is_active) VALUES ('pur_mgr_rpt','x','ผู้จัดการจัดซื้อ','purchasing_manager',1)").run();

const C = {};
for (const [k, un] of [['staff', 'qc_staff1'], ['coo', 'cco1'], ['mgr', 'manager1'], ['sup', 'supervisor1'], ['purMgr', 'pur_mgr_rpt']]) {
  setSess(un, k);
  C[k] = 'token=' + jwt.sign({ id: uid(un), sessionToken: k }, process.env.JWT_SECRET);
}

const supId = db.prepare("INSERT INTO suppliers (name, approval_status) VALUES ('ผู้ผลิต รายงาน', 'approved')").run().lastInsertRowid;
const staffId = uid('qc_staff1');

function makeBill(itemCount, { ncrOnFirstN = 0 } = {}) {
  const billId = db.prepare(`INSERT INTO bills (invoice_no, po_no, supplier_id, received_date, status, created_by)
    VALUES (?, 'PO-RPT', ?, '2026-01-10', 'approved', ?)`).run(`INV-RPT-${billId_seq()}`, supId, staffId).lastInsertRowid;
  const itemIds = [];
  const insItem = db.prepare(`INSERT INTO bill_items (bill_id, item_name, qty_received, qty_sampled, qty_passed, qty_failed)
    VALUES (?, ?, 10, 10, 10, 0)`);
  for (let i = 0; i < itemCount; i++) {
    itemIds.push(insItem.run(billId, `รายการ ${i + 1}`).lastInsertRowid);
  }
  if (ncrOnFirstN > 0) {
    const ncrId = db.prepare(`INSERT INTO ncrs (ncr_code, bill_id, po_no, invoice_no, severity, status, created_by)
      VALUES (?, ?, 'PO-RPT', 'INV-RPT', 'major', 'pending_supervisor', ?)`)
      .run(`NCR-RPT-${billId}`, billId, staffId).lastInsertRowid;
    const insNi = db.prepare(`INSERT INTO ncr_items (ncr_id, bill_item_id, item_name, qty_received, qty_sampled, qty_failed)
      VALUES (?, ?, 'รายการเสีย', 10, 10, 2)`);
    for (let i = 0; i < ncrOnFirstN; i++) insNi.run(ncrId, itemIds[i]);
  }
  return billId;
}
let _seq = 0;
function billId_seq() { _seq += 1; return _seq; }

// บิลที่ 1: 10 รายการ, 5 รายการมีการออก NCR (ตัวอย่างจากคำขอ user: 10 รายการ, NCR 5 ราย → อัตราผ่าน 50%)
const bill1 = makeBill(10, { ncrOnFirstN: 5 });
// บิลที่ 2: 15 รายการ ไม่มี NCR เลย — รวม 2 บิล = 25 รายการ (ตัวอย่างจากคำขอ user)
const bill2 = makeBill(15);

// Fixture สำหรับ "สัดส่วน NCR ตามกลุ่มปัญหา" — แท็ก defect_category ให้ 2 ใน 5 ของ ncr_items ที่มีอยู่แล้วของ
// NCR-RPT-{bill1} (ไม่สร้างบิล/NCR ใหม่ กัน total_bills/total_items/pass_rate ของ REP-02..04 เปลี่ยนไป) — คำขอ
// user: เดิมกราฟ "สัดส่วน NCR ตามกลุ่มปัญหา" ขึ้น "อื่นๆ" ทั้งหมดเพราะ query ของ /reports/ncr ไม่เคย join
// defect_categories เลย
const catWet   = db.prepare("INSERT INTO defect_categories (name) VALUES ('เปียกน้ำ')").run().lastInsertRowid;
const catColor = db.prepare("INSERT INTO defect_categories (name) VALUES ('สีเพี้ยน')").run().lastInsertRowid;
const bill1NcrId = db.prepare("SELECT id FROM ncrs WHERE ncr_code = ?").get(`NCR-RPT-${bill1}`).id;
const bill1NcrItemIds = db.prepare('SELECT id FROM ncr_items WHERE ncr_id = ? ORDER BY id').all(bill1NcrId).map(r => r.id);
db.prepare('UPDATE ncr_items SET defect_category_id = ? WHERE id = ?').run(catWet, bill1NcrItemIds[0]);
db.prepare('UPDATE ncr_items SET defect_category_id = ? WHERE id = ?').run(catColor, bill1NcrItemIds[1]);

// Fixture สำหรับ "Top 5 Supplier มี UAI มากที่สุด" (คำขอ user — เดิมหน้า UAI report ไม่มีกราฟ/ตารางนี้เลย)
db.prepare(`INSERT INTO uai_documents (uai_code, ncr_id, status) VALUES ('UAI-RPT-1', ?, 'uai_completed')`).run(bill1NcrId);

const todayForTest = '2026-02-01'; // ใช้ในเทส REP-11 ด้านล่าง (fixture สร้างสดในเทสเอง — ดูเหตุผลตรงนั้น)

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/reports', require('../routes/reports'));
app.use('/api', require('../routes/exports')); // exports.js เอง define path '/reports/summary/pdf' ไว้แล้ว (mount ที่ /api เหมือน index.js จริง)
let server, base;
test.before(async () => { server = app.listen(0); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => {
  try { server.close(); } catch {}
  try { db.close(); } catch {}
  for (const f of [process.env.IQC_DB_PATH, process.env.IQC_DB_PATH + '-wal', process.env.IQC_DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch {} }
});

async function apiJson(p, cookie) {
  const res = await fetch(base + p, { headers: { cookie } });
  let json; try { json = await res.json(); } catch { json = null; }
  return { status: res.status, body: json };
}

async function loadExcel(p, cookie) {
  const res = await fetch(base + p, { headers: { cookie } });
  const buf = Buffer.from(await res.arrayBuffer());
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return { status: res.status, ws: wb.worksheets[0] };
}

test('REP-01 permission: qc_staff เข้า /reports/summary ไม่ได้ → 403', async () => {
  const r = await apiJson('/api/reports/summary', C.staff);
  assert.equal(r.status, 403);
});

// คำขอ user (S139) — เพิ่มเมนูรายงานให้ qc_supervisor/purchasing_manager เข้าถึงได้ด้วย (เดิมมีแค่ qc_manager/
// cco/cmo/cpo) — ตรวจว่า role ใหม่ทั้ง 2 ตัวเข้าได้จริง (backend REPORT_ROLES ทั้ง reports.js/exports.js)
test('REP-01b permission: qc_supervisor เข้า /reports/summary ได้แล้ว (เมนูรายงานเพิ่ม role นี้)', async () => {
  const r = await apiJson('/api/reports/summary', C.sup);
  assert.equal(r.status, 200);
});

test('REP-01c permission: purchasing_manager เข้า /reports/summary ได้แล้ว (เมนูรายงานเพิ่ม role นี้)', async () => {
  const r = await apiJson('/api/reports/summary', C.purMgr);
  assert.equal(r.status, 200);
});

test('REP-02 GET /reports/summary: รายการรับเข้า = จำนวนแถว bill_items (25) ไม่ใช่ผลรวมจำนวนชิ้น', async () => {
  const r = await apiJson('/api/reports/summary', C.coo);
  assert.equal(r.status, 200);
  assert.equal(r.body.summary.total_bills, 2);
  assert.equal(r.body.summary.total_items, 25); // 10 + 15 รายการ (ไม่ใช่ 250 ชิ้นจาก qty_received)
});

test('REP-03 GET /reports/summary: อัตราผ่านคำนวณจากรายการที่มีการออก NCR (25 รายการ, NCR 5 ราย → 80%)', async () => {
  const r = await apiJson('/api/reports/summary', C.coo);
  assert.equal(r.status, 200);
  assert.equal(r.body.summary.pass_rate, '80.0'); // (25-5)/25*100
});

test('REP-04 GET /reports/receiving: ต่อบิล — item_count/passed_item_count/ncr_item_count ถูกต้อง', async () => {
  const r = await apiJson('/api/reports/receiving', C.coo);
  assert.equal(r.status, 200);
  const b1 = r.body.bills.find(b => b.id === bill1);
  const b2 = r.body.bills.find(b => b.id === bill2);
  assert.equal(b1.item_count, 10);
  assert.equal(b1.ncr_item_count, 5);
  assert.equal(b1.passed_item_count, 5);
  assert.equal(b2.item_count, 15);
  assert.equal(b2.ncr_item_count, 0);
  assert.equal(b2.passed_item_count, 15);
  assert.equal(r.body.summary.total_items, 25);
  assert.equal(r.body.summary.ncr_item_count, 5);
  assert.equal(r.body.summary.passed_item_count, 20);
  assert.equal(r.body.summary.pass_rate, '80.0');
});

test('REP-04b GET /reports/ncr: defect_breakdown ส่งชื่อกลุ่มปัญหาจริง ไม่ใช่ "อื่นๆ" ทั้งหมด', async () => {
  // ไม่ระบุ from/to — n.created_at ของ NCR fixture เป็นค่า default CURRENT_TIMESTAMP (เวลาจริงตอนรัน test)
  // ไม่ใช่ received_date ของบิลที่ตั้งไว้ตายตัว ('2026-01-...') กรองช่วงวันที่ตายตัวจะพลาดข้อมูลเหล่านี้ไปหมด
  const r = await apiJson('/api/reports/ncr', C.coo);
  assert.equal(r.status, 200);
  const byName = Object.fromEntries(r.body.defect_breakdown.map(d => [d.name, d.value]));
  assert.equal(byName['เปียกน้ำ'], 1);
  assert.equal(byName['สีเพี้ยน'], 1);
});

test('REP-04c GET /reports/uai: top_uai_suppliers มีข้อมูลจริง (Top 5 Supplier มี UAI มากที่สุด)', async () => {
  const r = await apiJson('/api/reports/uai', C.coo);
  assert.equal(r.status, 200);
  const row = r.body.top_uai_suppliers.find(s => s.name === 'ผู้ผลิต รายงาน');
  assert.ok(row, 'ควรเจอ supplier ในผลลัพธ์ top_uai_suppliers');
  assert.equal(row.uai_count, 1);
});

// หมายเหตุ: ไม่มี test ไหนในระบบ (ทั้ง bill/ncr/uai/purchasing-dashboard pdf) เรียก route /pdf จริงผ่าน Puppeteer
// เลยสักตัว (คงไว้ตามธรรมเนียมเดิม) — เคยลองเรียกจริงระหว่างพัฒนาแล้วเจอ chrome.exe ค้างเป็น orphan process บน
// Windows ถึง 18 ตัวหลัง test จบ (ปัญหา known upstream ของ Puppeteer บน Windows ไม่เกี่ยวกับ route ที่แก้)
// — verify ว่า route คืน PDF จริง (200, content-type ถูก, buffer มีเนื้อหา) ทำแบบ manual ไปแล้วนอก suite นี้
// ที่นี่ทดสอบแค่ permission gate (เร็ว/ไม่แตะ Puppeteer เลย เพราะ requireRole reject ก่อนถึง route handler)
test('REP-05 permission: qc_staff กด /reports/summary/pdf ไม่ได้ → 403 (ไม่ใช่ 404 — เดิม route หายไปเลย)', async () => {
  const res = await fetch(base + '/api/reports/summary/pdf', { headers: { cookie: C.staff } });
  assert.equal(res.status, 403);
});

test('REP-05b permission: qc_staff กด /reports/receiving/pdf ไม่ได้ → 403 (route ใหม่)', async () => {
  const res = await fetch(base + '/api/reports/receiving/pdf', { headers: { cookie: C.staff } });
  assert.equal(res.status, 403);
});

test('REP-05c permission: qc_staff กด /reports/ncr/pdf ไม่ได้ → 403 (route ใหม่)', async () => {
  const res = await fetch(base + '/api/reports/ncr/pdf', { headers: { cookie: C.staff } });
  assert.equal(res.status, 403);
});

test('REP-05d permission: qc_staff กด /reports/uai/pdf ไม่ได้ → 403 (route ใหม่)', async () => {
  const res = await fetch(base + '/api/reports/uai/pdf', { headers: { cookie: C.staff } });
  assert.equal(res.status, 403);
});

// Excel export ทุก route ของเมนูรายงาน — เดิมเปิดไฟล์แล้วไม่รู้เลยว่ากรองช่วงวันที่ไหนไว้ (คำขอ user) —
// แถวที่ 1 (merge เต็มความกว้าง) ต้องมีข้อความช่วงเวลา, แถวที่ 2 คือหัวตารางจริง (ขยับลงมา 1 แถวจากเดิม)
test('REP-06 GET /reports/receiving/excel: แถว 1 มีช่วงเวลา, แถว 2 คือหัวตาราง', async () => {
  const { status, ws } = await loadExcel('/api/reports/receiving/excel?from=2026-01-01&to=2026-01-31', C.coo);
  assert.equal(status, 200);
  assert.equal(ws.getCell(1, 1).value, 'ช่วงข้อมูล: 2026-01-01 ถึง 2026-01-31');
  assert.equal(ws.getCell(2, 1).value, 'Invoice No.');
  assert.equal(ws.getCell(2, 5).value, 'รายการ');
});

test('REP-07 GET /reports/ncr/excel: แถว 1 มีช่วงเวลา, แถว 2 คือหัวตาราง', async () => {
  const { status, ws } = await loadExcel('/api/reports/ncr/excel?from=2026-01-01&to=2026-01-31', C.coo);
  assert.equal(status, 200);
  assert.equal(ws.getCell(1, 1).value, 'ช่วงข้อมูล: 2026-01-01 ถึง 2026-01-31');
  assert.equal(ws.getCell(2, 1).value, 'รหัส NCR');
});

test('REP-08 GET /reports/uai/excel: แถว 1 มีช่วงเวลา, แถว 2 คือหัวตาราง', async () => {
  const { status, ws } = await loadExcel('/api/reports/uai/excel?from=2026-01-01&to=2026-01-31', C.coo);
  assert.equal(status, 200);
  assert.equal(ws.getCell(1, 1).value, 'ช่วงข้อมูล: 2026-01-01 ถึง 2026-01-31');
  assert.equal(ws.getCell(2, 1).value, 'รหัส UAI');
});

test('REP-09 GET /reports/summary/excel: แถว 1 มีช่วงเวลา, แถว 2 คือหัวตาราง', async () => {
  const { status, ws } = await loadExcel('/api/reports/summary/excel?from=2026-01-01&to=2026-01-31', C.coo);
  assert.equal(status, 200);
  assert.equal(ws.getCell(1, 1).value, 'ช่วงข้อมูล: 2026-01-01 ถึง 2026-01-31');
  assert.equal(ws.getCell(2, 1).value, 'Supplier');
});

test('REP-10 GET /reports/receiving/excel: ไม่ระบุช่วงวันที่เลย → ข้อความ "ทั้งหมด"', async () => {
  const { status, ws } = await loadExcel('/api/reports/receiving/excel', C.coo);
  assert.equal(status, 200);
  assert.equal(ws.getCell(1, 1).value, 'ช่วงข้อมูล: ทั้งหมด (ไม่ได้กรองช่วงวันที่)');
});

// S159 — user รายงาน: กด export "สรุปรับเข้าวันนี้" แล้วรายการ "ไม่ผ่าน" ที่ยังไม่มีใครออกเอกสาร NCR/NCP
// ช่องเอกสารว่างเปล่าเป็น "-" ทั้งที่มีสาเหตุของเสียบันทึกไว้แล้วตั้งแต่ตอนรับเข้า (bill_items.defect_category_id/
// defect_detail) — root cause: buildDailyReportData() ไม่เคย SELECT 2 field นี้เลย ทำให้ไม่มีข้อมูลมาแสดงแทน "-"
// fixture สร้างสดในเทสนี้เอง (ไม่ใช่ module-level เหมือนตัวอื่น) เพราะ REP-02/03/04 นับ bill_items ทั้ง DB
// แบบ global (ไม่ scope ตามวันที่) — ถ้าสร้างไว้ตั้งแต่ต้นไฟล์จะไปเพิ่ม/เปลี่ยนตัวเลขที่เทสก่อนหน้าคาดหวังไว้
test('REP-11 GET /reports/receiving/today/excel: รายการไม่ผ่านที่ยังไม่มี NCR/NCP แสดงสาเหตุของเสียแทน "-"', async () => {
  const billToday = db.prepare(`INSERT INTO bills (invoice_no, po_no, supplier_id, received_date, status, created_by)
    VALUES ('INV-TODAY-1', 'PO-TODAY', ?, ?, 'approved', ?)`).run(supId, todayForTest, staffId).lastInsertRowid;
  const catThick = db.prepare("INSERT INTO defect_categories (name) VALUES ('ความหนาเกินกำหนด')").run().lastInsertRowid;
  db.prepare(`INSERT INTO bill_items (bill_id, item_name, qty_received, qty_sampled, qty_passed, qty_failed, defect_category_id, defect_detail)
    VALUES (?, 'รายการของเสียยังไม่ออกเอกสาร', 100, 5, 3, 2, ?, 'พบความหนาเกินสเปค')`).run(billToday, catThick);

  const { status, ws } = await loadExcel(`/api/reports/receiving/today/excel?date=${todayForTest}`, C.staff);
  assert.equal(status, 200);
  let found = null;
  ws.eachRow(row => { if (row.getCell(6).value === 'รายการของเสียยังไม่ออกเอกสาร') found = row; });
  assert.ok(found, 'ต้องเจอแถวของ item ที่สร้างไว้ (received_date ตรงกับ ?date= ที่ส่งไป)');
  const ncrCell = String(found.getCell(12).value || '');
  assert.match(ncrCell, /ความหนาเกินกำหนด/);
  assert.match(ncrCell, /พบความหนาเกินสเปค/);
  assert.match(ncrCell, /รอออกเอกสาร/);
});
