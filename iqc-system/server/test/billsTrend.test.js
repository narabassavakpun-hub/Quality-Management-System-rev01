// Integration tests — /api/dashboard/bills-trend + /api/dashboard/bills-by-supplier (Session 127, QC Staff
// dashboard drill-down widget: granularity day/month/year + เปรียบเทียบ mom/yoy) via HTTP (node --test)
// ครอบ computePeriod()/parseGranularity()/parseCompare() ใน routes/dashboard.js — bucket boundaries, mom/yoy
// window alignment, และ supplier ranking order+comparison ต้องตรงกับข้อมูลจริงที่ seed ไว้
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.IQC_DB_PATH = path.join(os.tmpdir(), `iqc-bills-trend-${process.pid}-${Date.now()}.db`);
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-bills-trend';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const db = require('../db/database');

const uid = (un) => db.prepare('SELECT id FROM users WHERE username = ?').get(un).id;
const setSess = (un, s) => db.prepare('UPDATE users SET session_token=? WHERE username=?').run(s, un);

const C = {};
for (const [k, un] of [['staff', 'qc_staff1']]) {
  setSess(un, k);
  C[k] = 'token=' + jwt.sign({ id: uid(un), sessionToken: k }, process.env.JWT_SECRET);
}
const staffId = uid('qc_staff1');

const supA = db.prepare("INSERT INTO suppliers (name, approval_status) VALUES ('ผู้ผลิต A','approved')").run().lastInsertRowid;
const supB = db.prepare("INSERT INTO suppliers (name, approval_status) VALUES ('ผู้ผลิต B','approved')").run().lastInsertRowid;
const supC = db.prepare("INSERT INTO suppliers (name, approval_status) VALUES ('ผู้ผลิต C','approved')").run().lastInsertRowid;

let seq = 0;
function makeBill(supplierId, createdAt) {
  seq += 1;
  db.prepare(`INSERT INTO bills (invoice_no, po_no, supplier_id, received_date, status, created_by, created_at)
    VALUES (?, ?, ?, ?, 'approved', ?, ?)`)
    .run(`INV-TREND-${seq}`, 'PO-TREND', supplierId, createdAt.slice(0, 10), staffId, createdAt);
}

// เดือนปัจจุบัน (กรกฎาคม 2026) — ranking ที่แตกต่างกันชัดเจน: B=3 > A=2 > C=1
makeBill(supA, '2026-07-01 09:00:00'); makeBill(supA, '2026-07-01 10:00:00');
makeBill(supB, '2026-07-15 09:00:00'); makeBill(supB, '2026-07-15 10:00:00'); makeBill(supB, '2026-07-15 11:00:00');
makeBill(supC, '2026-07-20 09:00:00');

// เดือนก่อน (มิถุนายน 2026) — สำหรับ compare=mom
makeBill(supA, '2026-06-10 09:00:00'); makeBill(supA, '2026-06-10 10:00:00'); makeBill(supA, '2026-06-10 11:00:00');
makeBill(supA, '2026-06-10 12:00:00'); makeBill(supA, '2026-06-10 13:00:00');

// เดือนเดียวกันปีก่อน (กรกฎาคม 2025) — สำหรับ compare=yoy
makeBill(supB, '2025-07-05 09:00:00'); makeBill(supB, '2025-07-05 10:00:00');
makeBill(supB, '2025-07-05 11:00:00'); makeBill(supB, '2025-07-05 12:00:00');

// เดือนอื่นในปี 2026 — สำหรับ granularity=month bucket coverage
makeBill(supA, '2026-01-10 09:00:00');
makeBill(supC, '2026-03-05 09:00:00'); makeBill(supC, '2026-03-05 10:00:00');

// ปีอื่นๆ — สำหรับ granularity=year
makeBill(supA, '2022-05-01 09:00:00');
makeBill(supA, '2023-05-01 09:00:00');
makeBill(supA, '2024-05-01 09:00:00');

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/dashboard', require('../routes/dashboard'));
let server, base;
test.before(async () => { server = app.listen(0); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => {
  try { server.close(); } catch {}
  try { db.close(); } catch {}
  for (const f of [process.env.IQC_DB_PATH, process.env.IQC_DB_PATH + '-wal', process.env.IQC_DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch {} }
});
async function api(p, { cookie = C.staff } = {}) {
  const res = await fetch(base + p, { headers: { cookie } });
  return { status: res.status, body: await res.json() };
}

const ANCHOR = '2026-07-15';

test('TREND-01 day granularity, ไม่เปรียบเทียบ: bucket 31 วัน, ตรงกับข้อมูล seed', async () => {
  const r = await api(`/api/dashboard/bills-trend?granularity=day&date=${ANCHOR}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.granularity, 'day');
  assert.equal(r.body.compare, 'none');
  assert.equal(r.body.current.length, 31); // กรกฎาคมมี 31 วัน
  assert.equal(r.body.current[0].value, 2);  // วันที่ 1
  assert.equal(r.body.current[14].value, 3); // วันที่ 15
  assert.equal(r.body.current[19].value, 1); // วันที่ 20
  assert.equal(r.body.comparison, null);
});

test('TREND-02 day granularity + compare=mom: เทียบกับมิถุนายน (30 วัน), วันที่ 10 = 5', async () => {
  const r = await api(`/api/dashboard/bills-trend?granularity=day&compare=mom&date=${ANCHOR}`);
  assert.equal(r.body.compare, 'mom');
  assert.equal(r.body.comparison.length, 30); // มิถุนายนมี 30 วัน
  assert.equal(r.body.comparison[9].value, 5); // วันที่ 10
});

test('TREND-03 day granularity + compare=yoy: เทียบกับกรกฎาคม 2025, วันที่ 5 = 4', async () => {
  const r = await api(`/api/dashboard/bills-trend?granularity=day&compare=yoy&date=${ANCHOR}`);
  assert.equal(r.body.compare, 'yoy');
  assert.equal(r.body.comparison.length, 31);
  assert.equal(r.body.comparison[4].value, 4); // วันที่ 5
});

test('TREND-04 month granularity + compare=yoy: bucket 12 เดือนของปี 2026 vs 2025', async () => {
  const r = await api(`/api/dashboard/bills-trend?granularity=month&compare=yoy&date=${ANCHOR}`);
  assert.equal(r.body.current.length, 12);
  assert.equal(r.body.current[0].value, 1);  // ม.ค. = 1
  assert.equal(r.body.current[2].value, 2);  // มี.ค. = 2
  assert.equal(r.body.current[5].value, 5);  // มิ.ย. = 5
  assert.equal(r.body.current[6].value, 6);  // ก.ค. = 2+3+1
  assert.equal(r.body.comparison[6].value, 4); // ก.ค. 2025 = 4
});

test('TREND-05 month granularity + compare=mom (ไม่รองรับ): server บังคับเป็น none', async () => {
  const r = await api(`/api/dashboard/bills-trend?granularity=month&compare=mom&date=${ANCHOR}`);
  assert.equal(r.body.compare, 'none');
  assert.equal(r.body.comparison, null);
});

test('TREND-06 year granularity: bucket 5 ปีล่าสุด, ไม่รองรับเปรียบเทียบแม้ขอมา', async () => {
  const r = await api(`/api/dashboard/bills-trend?granularity=year&compare=yoy&date=${ANCHOR}`);
  assert.equal(r.body.compare, 'none');
  assert.equal(r.body.comparison, null);
  assert.equal(r.body.current.length, 5); // 2022-2026
  assert.equal(r.body.current[0].value, 1);  // 2022
  assert.equal(r.body.current[1].value, 1);  // 2023
  assert.equal(r.body.current[2].value, 1);  // 2024
  assert.equal(r.body.current[3].value, 4);  // 2025 (ก.ค. 2025 มี 4 บิล — อยู่ในช่วง 5 ปีนี้ด้วย)
  assert.equal(r.body.current[4].value, 14); // 2026: ม.ค.(1) + มี.ค.(2) + มิ.ย.(5) + ก.ค.(6)
});

test('TREND-07 ค่า query แปลกๆ → fallback เป็นค่า default (day/none)', async () => {
  const r = await api(`/api/dashboard/bills-trend?granularity=bogus&compare=bogus&date=${ANCHOR}`);
  assert.equal(r.body.granularity, 'day');
  assert.equal(r.body.compare, 'none');
});

test('SUPPLIER-01 day granularity ranking: B(3) > A(2) > C(1)', async () => {
  const r = await api(`/api/dashboard/bills-by-supplier?granularity=day&date=${ANCHOR}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.ranking.length, 3);
  assert.equal(r.body.ranking[0].supplier_name, 'ผู้ผลิต B');
  assert.equal(r.body.ranking[0].current, 3);
  assert.equal(r.body.ranking[1].supplier_name, 'ผู้ผลิต A');
  assert.equal(r.body.ranking[1].current, 2);
  assert.equal(r.body.ranking[2].supplier_name, 'ผู้ผลิต C');
  assert.equal(r.body.ranking[2].current, 1);
  assert.equal(r.body.ranking[0].comparison, null); // compare=none default
});

test('SUPPLIER-02 day granularity + compare=mom: comparison ของ A=5 (มิถุนายน), B/C=0', async () => {
  const r = await api(`/api/dashboard/bills-by-supplier?granularity=day&compare=mom&date=${ANCHOR}`);
  const byName = Object.fromEntries(r.body.ranking.map(x => [x.supplier_name, x]));
  assert.equal(byName['ผู้ผลิต A'].comparison, 5);
  assert.equal(byName['ผู้ผลิต B'].comparison, 0);
  assert.equal(byName['ผู้ผลิต C'].comparison, 0);
});

test('SUPPLIER-03 day granularity + compare=yoy: comparison ของ B=4 (ก.ค. 2025), A/C=0', async () => {
  const r = await api(`/api/dashboard/bills-by-supplier?granularity=day&compare=yoy&date=${ANCHOR}`);
  const byName = Object.fromEntries(r.body.ranking.map(x => [x.supplier_name, x]));
  assert.equal(byName['ผู้ผลิต B'].comparison, 4);
  assert.equal(byName['ผู้ผลิต A'].comparison, 0);
  assert.equal(byName['ผู้ผลิต C'].comparison, 0);
});

test('SUPPLIER-04 month granularity (ทั้งปี 2026): A=8 มากสุด', async () => {
  const r = await api(`/api/dashboard/bills-by-supplier?granularity=month&date=${ANCHOR}`);
  assert.equal(r.body.ranking[0].supplier_name, 'ผู้ผลิต A');
  assert.equal(r.body.ranking[0].current, 8); // Jan(1) + Jun(5) + Jul(2)
});

test('SUPPLIER-05 limit param: จำกัดจำนวนแถวได้', async () => {
  const r = await api(`/api/dashboard/bills-by-supplier?granularity=day&date=${ANCHOR}&limit=1`);
  assert.equal(r.body.ranking.length, 1);
  assert.equal(r.body.ranking[0].supplier_name, 'ผู้ผลิต B');
});
