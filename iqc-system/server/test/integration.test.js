// Integration tests — node:test + better-sqlite3 บน temp DB (fresh install path)
// ตั้ง IQC_DB_PATH ก่อน require database.js
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const TMP = path.join(os.tmpdir(), `iqc_it_${process.pid}_${Date.now()}.db`);
process.env.IQC_DB_PATH = TMP;
process.env.NODE_ENV = 'test';

const { test, after } = require('node:test');
const assert = require('node:assert');
const db = require('../db/database');

after(() => {
  try { db.close(); } catch {}
  for (const f of [TMP, TMP + '-wal', TMP + '-shm']) { try { fs.unlinkSync(f); } catch {} }
});

// ── I-01 sequence race-safe + I-05/U-05 format ──
test('document sequence: unique + correct format', () => {
  const codes = new Set();
  for (let i = 0; i < 100; i++) codes.add(db.nextNCRCode());
  assert.strictEqual(codes.size, 100, 'ต้องไม่ซ้ำ 100 ค่า');
  assert.match([...codes][0], /^NCR-\d{4}-\d{4,}$/);
});

// ── H4: fresh install มี ncrs status เป็น TEXT (ไม่มี CHECK) + migration recorded ──
test('H4: ncrs has no status CHECK and migration is recorded', () => {
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE name='ncrs'").get().sql;
  assert.ok(!/CHECK\s*\(\s*status\s+IN/i.test(sql), 'ต้องไม่มี CHECK บน status');
  assert.ok(db.prepare("SELECT 1 FROM schema_migrations WHERE version='003_ncrs_status_as_text'").get());
});

// ── H4: app-layer validator ──
test('H4: isValidNcrStatus', () => {
  assert.ok(db.isValidNcrStatus('pending_supplier'));
  assert.ok(db.isValidNcrStatus('ncp_closed'));
  assert.ok(!db.isValidNcrStatus('not_a_status'));
});

// ── H4: เพิ่มสถานะใหม่ได้โดยไม่ติด CHECK (พิสูจน์เลิก rebuild) ──
test('H4: can store an arbitrary new status without CHECK violation', () => {
  const sup = db.prepare("INSERT INTO suppliers (name) VALUES ('TS')").run().lastInsertRowid;
  const bill = db.prepare("INSERT INTO bills (invoice_no,po_no,supplier_id,received_date,status,created_by) VALUES ('I','P',?, '2026-01-01','draft',1)").run(sup).lastInsertRowid;
  const ncr = db.prepare("INSERT INTO ncrs (ncr_code,bill_id,po_no,invoice_no,severity,status,supplier_token,created_by) VALUES ('NCR-X-9999',?, 'P','I','major','some_future_status','tok'||?,1)").run(bill, Date.now());
  assert.ok(ncr.changes === 1);
});

// ── I-03/I-04 optimistic lock — double transition กันได้ ──
test('optimistic lock prevents double transition', () => {
  const sup = db.prepare("INSERT INTO suppliers (name) VALUES ('OL')").run().lastInsertRowid;
  const bill = db.prepare("INSERT INTO bills (invoice_no,po_no,supplier_id,received_date,status,created_by) VALUES ('I2','P2',?, '2026-01-01','pending_approval',1)").run(sup).lastInsertRowid;
  const r1 = db.prepare("UPDATE bills SET status='approved' WHERE id=? AND status='pending_approval'").run(bill);
  const r2 = db.prepare("UPDATE bills SET status='approved' WHERE id=? AND status='pending_approval'").run(bill);
  assert.strictEqual(r1.changes, 1, 'ครั้งแรกสำเร็จ');
  assert.strictEqual(r2.changes, 0, 'ครั้งสองถูกบล็อก');
});

// ── I-07 FK RESTRICT — ห้ามลบ supplier ที่มี product ชี้อยู่ ──
test('FK RESTRICT blocks deleting referenced supplier', () => {
  const sup = db.prepare("INSERT INTO suppliers (name) VALUES ('FK')").run().lastInsertRowid;
  const grp = db.prepare("INSERT INTO product_groups (name) VALUES ('G')").run().lastInsertRowid;
  const unit = db.prepare("INSERT INTO units (name) VALUES ('U')").run().lastInsertRowid;
  db.prepare("INSERT INTO products (name,supplier_id,product_group_id,unit_id) VALUES ('P',?,?,?)").run(sup, grp, unit);
  assert.throws(() => db.prepare('DELETE FROM suppliers WHERE id=?').run(sup), /FOREIGN KEY/i);
});

// ── settings + auditLog helpers ──
test('settings and auditLog helpers work', () => {
  db.setSetting('unit_test_key', 'v1');
  assert.strictEqual(db.getSetting('unit_test_key'), 'v1');
  db.setSetting('unit_test_key', 'v2');
  assert.strictEqual(db.getSetting('unit_test_key'), 'v2', 'upsert');
  db.auditLog('test_table', 1, 'UNIT_TEST', null, { a: 1 }, null, '127.0.0.1');
  assert.ok(db.prepare("SELECT 1 FROM audit_logs WHERE action='UNIT_TEST'").get());
});

// ── migration idempotency: schema_migrations มี 003 ครั้งเดียว ──
test('migration recorded exactly once', () => {
  const c = db.prepare("SELECT COUNT(*) c FROM schema_migrations WHERE version='003_ncrs_status_as_text'").get().c;
  assert.strictEqual(c, 1);
});
