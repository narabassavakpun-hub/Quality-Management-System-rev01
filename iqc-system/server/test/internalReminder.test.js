// S152 — แจ้งเตือนส่วนตัว (Telegram + in-app) เมื่อ NCR ค้างอยู่ที่ขั้นอนุมัติภายใน (Supervisor/Manager/QMR)
// ก่อนถึงจัดซื้อ เกินจำนวนวันที่ตั้งไว้ (default 3) นับจากวันที่คนก่อนหน้าส่งต่อมา — แจ้งซ้ำทุก N วัน
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.IQC_DB_PATH = path.join(os.tmpdir(), `iqc-internal-reminder-${process.pid}-${Date.now()}.db`);
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-internal-reminder';

const test = require('node:test');
const assert = require('node:assert');
const db = require('../db/database');
const ncrService = require('../services/ncrService');
const { checkInternalApprovalReminders } = require('../lib/internalReminder');

const uid = (un) => db.prepare('SELECT id FROM users WHERE username = ?').get(un).id;
const supervisorId = uid('supervisor1');
const qcManagerId = uid('manager1');
const qmrId = uid('qmr1');
const qcStaffId = uid('qc_staff1');

const supplierId = db.prepare("INSERT INTO suppliers (name, approval_status) VALUES ('ผู้ผลิตทดสอบ internal reminder','approved')").run().lastInsertRowid;

function notifTitlesFor(userId) {
  return db.prepare('SELECT title FROM notifications WHERE user_id = ? ORDER BY id DESC').all(userId).map(r => r.title);
}
function daysAgo(n) {
  return db.prepare("SELECT datetime('now', '-' || ? || ' days') AS t").get(n).t;
}

let seq = 0;
// สร้าง NCR ที่ status/created_at กำหนดเอง — ไม่ผ่าน createNcr() service เพื่อคุม created_at ได้ตรงๆ (จำลอง
// NCR ที่สร้างมาแล้ว N วัน ยังไม่มีใครอนุมัติเลย = ขั้น pending_supervisor แรกสุด)
function makeBillNcr({ status = 'pending_supervisor', createdAt = null, severity = 'major' } = {}) {
  seq += 1;
  const billId = db.prepare("INSERT INTO bills (invoice_no, po_no, supplier_id, received_date, status, created_by) VALUES (?, ?, ?, '2026-01-10', 'approved', ?)")
    .run(`INV-IR-${seq}`, 'PO-IR', supplierId, qcStaffId).lastInsertRowid;
  const ncrId = db.prepare(`INSERT INTO ncrs (ncr_code, bill_id, po_no, invoice_no, severity, status, created_by, created_at)
    VALUES (?, ?, 'PO-IR', 'INV-IR', ?, ?, ?, COALESCE(?, datetime('now')))`)
    .run(`NCR-IR-${seq}`, billId, severity, status, qcStaffId, createdAt).lastInsertRowid;
  return db.prepare('SELECT * FROM ncrs WHERE id = ?').get(ncrId);
}

test('IR-01 ไม่แจ้งเตือนถ้ายังไม่เกินจำนวนวันที่ตั้งไว้ (default 3)', async () => {
  const ncr = makeBillNcr({ status: 'pending_supervisor', createdAt: daysAgo(1) });
  checkInternalApprovalReminders();
  const row = db.prepare('SELECT internal_reminder_last_sent_at FROM ncrs WHERE id = ?').get(ncr.id);
  assert.equal(row.internal_reminder_last_sent_at, null);
});

test('IR-02 แจ้งเตือน qc_supervisor เมื่อค้างที่ pending_supervisor เกิน default 3 วัน (นับจาก created_at)', async () => {
  const ncr = makeBillNcr({ status: 'pending_supervisor', createdAt: daysAgo(5) });
  const n = checkInternalApprovalReminders();
  assert.ok(n >= 1);
  assert.ok(notifTitlesFor(supervisorId).includes('NCR รออนุมัติ (ค้างเกินกำหนด)'));
  const row = db.prepare('SELECT internal_reminder_last_sent_at FROM ncrs WHERE id = ?').get(ncr.id);
  assert.ok(row.internal_reminder_last_sent_at);
});

test('IR-03 แจ้งเตือน qc_manager เมื่อค้างที่ pending_manager (นับจากเวลา approve ล่าสุดใน ncr_approvals ไม่ใช่ created_at)', async () => {
  const ncr = makeBillNcr({ status: 'pending_manager', createdAt: daysAgo(20) }); // สร้างมานานแล้ว แต่เพิ่งถูกส่งต่อไม่นาน
  db.prepare('INSERT INTO ncr_approvals (ncr_id, action, role, user_id, comment, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(ncr.id, 'approved', 'qc_supervisor', supervisorId, null, daysAgo(1)); // เพิ่งส่งต่อมา 1 วัน — ยังไม่เกิน
  checkInternalApprovalReminders();
  let row = db.prepare('SELECT internal_reminder_last_sent_at FROM ncrs WHERE id = ?').get(ncr.id);
  assert.equal(row.internal_reminder_last_sent_at, null, 'ยังไม่ควรแจ้ง เพราะเพิ่งถูกส่งต่อมา 1 วัน (สร้าง NCR นานแล้วไม่เกี่ยว)');

  // อัปเดต approval ให้เป็น 5 วันก่อนแทน (จำลองว่าค้างมานาน)
  db.prepare('UPDATE ncr_approvals SET created_at = ? WHERE ncr_id = ?').run(daysAgo(5), ncr.id);
  checkInternalApprovalReminders();
  assert.ok(notifTitlesFor(qcManagerId).includes('NCR รออนุมัติ (ค้างเกินกำหนด)'));
  row = db.prepare('SELECT internal_reminder_last_sent_at FROM ncrs WHERE id = ?').get(ncr.id);
  assert.ok(row.internal_reminder_last_sent_at);
});

test('IR-04 แจ้งเตือน qmr เมื่อค้างที่ pending_qmr_open', async () => {
  const ncr = makeBillNcr({ status: 'pending_qmr_open', createdAt: daysAgo(10) });
  db.prepare('INSERT INTO ncr_approvals (ncr_id, action, role, user_id, comment, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(ncr.id, 'approved', 'qc_manager', qcManagerId, null, daysAgo(4));
  checkInternalApprovalReminders();
  assert.ok(notifTitlesFor(qmrId).includes('NCR รออนุมัติ (ค้างเกินกำหนด)'));
});

test('IR-05 ไม่แจ้งเตือนซ้ำทันทีในรอบถัดไป (ต้องรอครบ reminder_days จากครั้งล่าสุด)', async () => {
  const ncr = makeBillNcr({ status: 'pending_supervisor', createdAt: daysAgo(10) });
  checkInternalApprovalReminders();
  const countBefore = notifTitlesFor(supervisorId).filter(t => t === 'NCR รออนุมัติ (ค้างเกินกำหนด)').length;
  checkInternalApprovalReminders(); // รันซ้ำทันที
  const countAfter = notifTitlesFor(supervisorId).filter(t => t === 'NCR รออนุมัติ (ค้างเกินกำหนด)').length;
  assert.equal(countAfter, countBefore, 'ไม่ควรแจ้งซ้ำทันทีในรอบถัดไป');
});

test('IR-06 แจ้งซ้ำอีกครั้งหลังผ่านไปครบ reminder_days นับจากครั้งล่าสุด', async () => {
  const ncr = makeBillNcr({ status: 'pending_supervisor', createdAt: daysAgo(10) });
  checkInternalApprovalReminders();
  const countBefore = notifTitlesFor(supervisorId).filter(t => t === 'NCR รออนุมัติ (ค้างเกินกำหนด)').length;

  // จำลองว่าผ่านไปแล้ว 4 วันตั้งแต่แจ้งครั้งล่าสุด (เกิน default 3 วัน)
  db.prepare('UPDATE ncrs SET internal_reminder_last_sent_at = ? WHERE id = ?').run(daysAgo(4), ncr.id);
  checkInternalApprovalReminders();
  const countAfter = notifTitlesFor(supervisorId).filter(t => t === 'NCR รออนุมัติ (ค้างเกินกำหนด)').length;
  assert.equal(countAfter, countBefore + 1, 'ต้องแจ้งซ้ำอีกครั้งเพราะผ่าน reminder_days แล้ว');
});

test('IR-07 reset รอบแจ้งเตือนเมื่อ status เปลี่ยน (อนุมัติผ่านขั้นไปแล้ว ไม่สืบทอดรอบเก่า)', async () => {
  const ncr = makeBillNcr({ status: 'pending_supervisor', createdAt: daysAgo(10) });
  checkInternalApprovalReminders();
  let row = db.prepare('SELECT internal_reminder_last_sent_at FROM ncrs WHERE id = ?').get(ncr.id);
  assert.ok(row.internal_reminder_last_sent_at, 'ต้องเคยแจ้งไปแล้วที่ pending_supervisor');

  ncrService.approveNcr({ ncr, actorId: supervisorId, actorRole: 'qc_supervisor', actorIp: '127.0.0.1', action: 'approve' });
  row = db.prepare('SELECT internal_reminder_last_sent_at, status FROM ncrs WHERE id = ?').get(ncr.id);
  assert.equal(row.status, 'pending_manager');
  assert.equal(row.internal_reminder_last_sent_at, null, 'ต้อง reset เป็น NULL ทันทีที่ status เปลี่ยน — ขั้นใหม่เริ่มนับรอบใหม่');
});

test('IR-08 จำนวนวันตั้งค่าได้ผ่าน settings (ncr_internal_reminder_days), default 3 ถ้ายังไม่ได้ตั้ง', async () => {
  const stateBefore = db.getSetting('ncr_internal_reminder_days');
  try {
    db.setSetting('ncr_internal_reminder_days', '1');
    const ncr = makeBillNcr({ status: 'pending_supervisor', createdAt: daysAgo(2) }); // เกิน 1 วัน แต่ยังไม่เกิน default 3
    checkInternalApprovalReminders();
    const row = db.prepare('SELECT internal_reminder_last_sent_at FROM ncrs WHERE id = ?').get(ncr.id);
    assert.ok(row.internal_reminder_last_sent_at, 'ต้องแจ้งเตือนเพราะตั้งค่าไว้ที่ 1 วัน และค้างมาแล้ว 2 วัน');
  } finally {
    db.setSetting('ncr_internal_reminder_days', stateBefore ?? '');
  }
});

test('IR-09 ไม่แจ้งเตือน NCR minor severity ที่ปิดไปแล้ว (ncp_closed) แม้ว่างมานาน', async () => {
  const ncr = makeBillNcr({ status: 'ncp_closed', severity: 'minor', createdAt: daysAgo(30) });
  checkInternalApprovalReminders();
  const row = db.prepare('SELECT internal_reminder_last_sent_at FROM ncrs WHERE id = ?').get(ncr.id);
  assert.equal(row.internal_reminder_last_sent_at, null);
});

test.after(() => {
  try { db.close(); } catch {}
  for (const f of [process.env.IQC_DB_PATH, process.env.IQC_DB_PATH + '-wal', process.env.IQC_DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch {} }
});
