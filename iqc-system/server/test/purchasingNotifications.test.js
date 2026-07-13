// Phase 5 — Notification verification/fixes (Req 6): purchasing_manager ต้องได้รับแจ้งเตือนที่ NCR รอ Review /
// ปิดแล้ว / เกินกำหนด; Purchasing Owner ต้องได้รับแจ้งเตือนตอน Supplier ตอบกลับ (เดิมไม่มีทั้งสองจุดนี้)
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.IQC_DB_PATH = path.join(os.tmpdir(), `iqc-purchasing-notif-${process.pid}-${Date.now()}.db`);
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-purchasing-notif';

const test = require('node:test');
const assert = require('node:assert');
const db = require('../db/database');
const ncrService = require('../services/ncrService');
const supplierService = require('../services/supplierService');
const { checkOverdueNcrNotifications } = require('../lib/overdueNotifier');

const uid = (un) => db.prepare('SELECT id FROM users WHERE username = ?').get(un).id;
db.prepare("INSERT INTO users (username, password_hash, full_name, role, is_active) VALUES ('pur_mgr','x','ผู้จัดการจัดซื้อ','purchasing_manager',1)").run();
const purchasing1Id = uid('purchasing1');
const purMgrId = uid('pur_mgr');
const qmrId = uid('qmr1');
const qcManagerId = uid('manager1');
const qcStaffId = uid('qc_staff1');

const supplierId = db.prepare("INSERT INTO suppliers (name, approval_status) VALUES ('ผู้ผลิตทดสอบแจ้งเตือน','approved')").run().lastInsertRowid;
db.prepare('INSERT INTO supplier_purchasing_assignees (supplier_id, user_id) VALUES (?, ?)').run(supplierId, purchasing1Id);

function notifTitlesFor(userId) {
  return db.prepare('SELECT title FROM notifications WHERE user_id = ? ORDER BY id DESC').all(userId).map(r => r.title);
}

let seq = 0;
function makeBillNcr({ status = 'pending_qmr_open', severity = 'major', dueDate = null } = {}) {
  seq += 1;
  const billId = db.prepare("INSERT INTO bills (invoice_no, po_no, supplier_id, received_date, status, created_by) VALUES (?, ?, ?, '2026-01-10', 'approved', ?)")
    .run(`INV-NOTIF-${seq}`, 'PO-NOTIF', supplierId, qcStaffId).lastInsertRowid;
  const ncrId = db.prepare(`INSERT INTO ncrs (ncr_code, bill_id, po_no, invoice_no, severity, status, disposition_due_date, created_by)
    VALUES (?, ?, 'PO-NOTIF', 'INV-NOTIF', ?, ?, ?, ?)`)
    .run(`NCR-NOTIF-${seq}`, billId, severity, status, dueDate, qcStaffId).lastInsertRowid;
  return db.prepare('SELECT * FROM ncrs WHERE id = ?').get(ncrId);
}

test('NOTIF-01 QMR อนุมัติเปิด (pending_purchasing_review) แจ้ง purchasing_manager ด้วย ไม่ใช่แค่ผู้ดูแล supplier', async () => {
  const ncr = makeBillNcr({ status: 'pending_qmr_open' });
  ncrService.approveNcr({ ncr, actorId: qmrId, actorRole: 'qmr', actorIp: '127.0.0.1', action: 'approve' });
  assert.ok(notifTitlesFor(purchasing1Id).includes('NCR รอ Review จัดซื้อ'), 'ผู้ดูแล supplier ต้องได้รับแจ้ง');
  assert.ok(notifTitlesFor(purMgrId).includes('NCR รอ Review จัดซื้อ'), 'purchasing_manager ต้องได้รับแจ้งด้วย');
});

test('NOTIF-02 QMR ปิด NCR (closed) แจ้ง purchasing_manager ด้วย', async () => {
  const ncr = makeBillNcr({ status: 'pending_qmr_close' });
  ncrService.approveNcr({ ncr, actorId: qmrId, actorRole: 'qmr', actorIp: '127.0.0.1', action: 'approve' });
  assert.ok(notifTitlesFor(purchasing1Id).includes('NCR ปิดแล้ว'));
  assert.ok(notifTitlesFor(purMgrId).includes('NCR ปิดแล้ว'), 'purchasing_manager ต้องได้รับแจ้งตอนปิด NCR ด้วย');
});

test('NOTIF-03 Supplier ตอบกลับ แจ้ง Purchasing Owner ด้วย (เดิมแจ้งแค่ QC Manager)', async () => {
  const ncr = makeBillNcr({ status: 'pending_supplier' });
  supplierService.submitSupplierResponse({
    ncr, respondent_name: 'ผู้ตอบทดสอบ', root_cause: 'สาเหตุ', corrective_action: 'แก้ไข', preventive_action: 'ป้องกัน',
  });
  assert.ok(notifTitlesFor(qcManagerId).includes('Supplier ตอบ NCR แล้ว'), 'QC Manager ต้องได้รับแจ้งเหมือนเดิม');
  assert.ok(notifTitlesFor(purchasing1Id).includes('Supplier ตอบ NCR แล้ว'), 'Purchasing Owner ต้องได้รับแจ้งด้วย (เดิมไม่มี)');
});

test('NOTIF-04 Overdue: แจ้งเตือนครั้งเดียวต่อรายการ ทั้ง Purchasing Owner + Manager, รันซ้ำไม่แจ้งซ้ำ', async () => {
  const ncr = makeBillNcr({ status: 'pending_manager_review', dueDate: '2020-01-01' });
  const n1 = checkOverdueNcrNotifications();
  assert.ok(n1 >= 1);
  assert.ok(notifTitlesFor(purchasing1Id).includes('NCR เกินกำหนด'));
  assert.ok(notifTitlesFor(purMgrId).includes('NCR เกินกำหนด'));

  const countBefore = notifTitlesFor(purchasing1Id).filter(t => t === 'NCR เกินกำหนด').length;
  checkOverdueNcrNotifications(); // รันซ้ำ
  const countAfter = notifTitlesFor(purchasing1Id).filter(t => t === 'NCR เกินกำหนด').length;
  assert.equal(countAfter, countBefore, 'ห้ามแจ้งซ้ำสำหรับ NCR เดิมที่แจ้งไปแล้ว');

  const row = db.prepare('SELECT overdue_notified_at FROM ncrs WHERE id = ?').get(ncr.id);
  assert.ok(row.overdue_notified_at);
});

test('NOTIF-05 Overdue: ไม่แจ้งรายการที่ยังไม่เกินกำหนด หรือปิดแล้ว', async () => {
  const notYetDue = makeBillNcr({ status: 'pending_manager_review', dueDate: '2099-01-01' });
  const closedButPastDue = makeBillNcr({ status: 'closed', dueDate: '2020-01-01' });
  checkOverdueNcrNotifications();
  const rowNotYet = db.prepare('SELECT overdue_notified_at FROM ncrs WHERE id = ?').get(notYetDue.id);
  const rowClosed = db.prepare('SELECT overdue_notified_at FROM ncrs WHERE id = ?').get(closedButPastDue.id);
  assert.equal(rowNotYet.overdue_notified_at, null);
  assert.equal(rowClosed.overdue_notified_at, null);
});

test.after(() => {
  try { db.close(); } catch {}
  for (const f of [process.env.IQC_DB_PATH, process.env.IQC_DB_PATH + '-wal', process.env.IQC_DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch {} }
});
