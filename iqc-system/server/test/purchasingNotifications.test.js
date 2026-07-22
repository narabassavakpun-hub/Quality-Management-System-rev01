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
function makeBillNcr({ status = 'pending_qmr_open', severity = 'major', qmrOpenedAt = null } = {}) {
  seq += 1;
  const billId = db.prepare("INSERT INTO bills (invoice_no, po_no, supplier_id, received_date, status, created_by) VALUES (?, ?, ?, '2026-01-10', 'approved', ?)")
    .run(`INV-NOTIF-${seq}`, 'PO-NOTIF', supplierId, qcStaffId).lastInsertRowid;
  const ncrId = db.prepare(`INSERT INTO ncrs (ncr_code, bill_id, po_no, invoice_no, severity, status, qmr_opened_at, created_by)
    VALUES (?, ?, 'PO-NOTIF', 'INV-NOTIF', ?, ?, ?, ?)`)
    .run(`NCR-NOTIF-${seq}`, billId, severity, status, qmrOpenedAt, qcStaffId).lastInsertRowid;
  return db.prepare('SELECT * FROM ncrs WHERE id = ?').get(ncrId);
}
// วันที่ผ่านมาแล้ว N วันจากตอนนี้ (format ตรงกับ datetime('now') ของ SQLite: 'YYYY-MM-DD HH:MM:SS')
function daysAgo(n) {
  return db.prepare("SELECT datetime('now', '-' || ? || ' days') AS t").get(n).t;
}

// mock 'node-fetch' ผ่าน require.cache แบบเดียวกับ backupService.test.js — sendTelegram() ใน
// routes/notifications.js เรียก require('node-fetch') แบบ lazy (ในฟังก์ชัน ไม่ใช่ top-level) ทำให้ trick นี้ใช้ได้
const nodeFetchPath = require.resolve('node-fetch');
function mockNodeFetch(impl) {
  const orig = require.cache[nodeFetchPath];
  require.cache[nodeFetchPath] = { id: nodeFetchPath, filename: nodeFetchPath, loaded: true, exports: impl };
  return () => { if (orig) require.cache[nodeFetchPath] = orig; else delete require.cache[nodeFetchPath]; };
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

test('NOTIF-04 Overdue: แจ้งเตือนครั้งเดียวต่อรายการ ทั้ง Purchasing Owner + Manager, รันซ้ำไม่แจ้งซ้ำ (นับจาก qmr_opened_at, default 7 วัน)', async () => {
  const ncr = makeBillNcr({ status: 'pending_manager_review', qmrOpenedAt: daysAgo(30) });
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

test('NOTIF-05 Overdue: ไม่แจ้งรายการที่ยังไม่เกินกำหนด (เพิ่ง QMR เปิด) หรือปิดแล้ว', async () => {
  const notYetDue = makeBillNcr({ status: 'pending_manager_review', qmrOpenedAt: daysAgo(1) }); // เปิดมาแค่ 1 วัน < default 7
  const closedButPastDue = makeBillNcr({ status: 'closed', qmrOpenedAt: daysAgo(30) });
  checkOverdueNcrNotifications();
  const rowNotYet = db.prepare('SELECT overdue_notified_at FROM ncrs WHERE id = ?').get(notYetDue.id);
  const rowClosed = db.prepare('SELECT overdue_notified_at FROM ncrs WHERE id = ?').get(closedButPastDue.id);
  assert.equal(rowNotYet.overdue_notified_at, null);
  assert.equal(rowClosed.overdue_notified_at, null);
});

test('NOTIF-06 Overdue: NCR ที่ QMR ยังไม่อนุมัติเปิด (qmr_opened_at NULL) ต้องไม่ถูกแจ้งเตือนเด็ดขาด — บั๊กที่ user รายงาน', async () => {
  // จำลองเคสจริง: qc_manager อนุมัติส่งต่อ QMR แล้ว (pending_qmr_open) แต่ QMR ยังไม่กดอนุมัติเปิดเอกสารเลย
  const ncr = makeBillNcr({ status: 'pending_qmr_open', qmrOpenedAt: null });
  checkOverdueNcrNotifications();
  const row = db.prepare('SELECT overdue_notified_at FROM ncrs WHERE id = ?').get(ncr.id);
  assert.equal(row.overdue_notified_at, null, 'ห้ามแจ้งเตือนก่อน QMR อนุมัติเปิดเอกสาร ไม่ว่าจะผ่านมากี่วันแล้วก็ตาม');
  const linked = db.prepare("SELECT COUNT(*) AS c FROM notifications WHERE link = ?").get(`/ncr/${ncr.id}`).c;
  assert.equal(linked, 0, 'ไม่ควรมี notification ใดๆ ผูกกับ NCR นี้เลยจากการเรียก checkOverdueNcrNotifications()');
});

test('NOTIF-07 Overdue: จำนวนวันตั้งค่าได้ผ่าน settings (ncr_overdue_days), default 7 ถ้ายังไม่ได้ตั้ง', async () => {
  const stateBefore = db.getSetting('ncr_overdue_days');
  try {
    db.setSetting('ncr_overdue_days', '3');
    const ncr = makeBillNcr({ status: 'pending_manager_review', qmrOpenedAt: daysAgo(4) }); // เกิน 3 วัน แต่ยังไม่เกิน default 7
    checkOverdueNcrNotifications();
    const row = db.prepare('SELECT overdue_notified_at FROM ncrs WHERE id = ?').get(ncr.id);
    assert.ok(row.overdue_notified_at, 'ต้องแจ้งเตือนเพราะตั้งค่าไว้ที่ 3 วัน และเปิดมาแล้ว 4 วัน');
  } finally {
    db.setSetting('ncr_overdue_days', stateBefore ?? '');
  }
});

test('NOTIF-08 Overdue: แจ้งซ้ำอีกครั้งหลังผ่านไปครบ repeat_days (default 3) นับจากแจ้งครั้งล่าสุด', async () => {
  const ncr = makeBillNcr({ status: 'pending_manager_review', qmrOpenedAt: daysAgo(30) });
  checkOverdueNcrNotifications();
  const first = db.prepare('SELECT overdue_notified_at FROM ncrs WHERE id = ?').get(ncr.id).overdue_notified_at;
  assert.ok(first);

  // จำลองว่าผ่านไปแล้ว 4 วันตั้งแต่แจ้งครั้งล่าสุด (เกิน default repeat 3 วัน)
  db.prepare('UPDATE ncrs SET overdue_notified_at = ? WHERE id = ?').run(daysAgo(4), ncr.id);
  const countBefore = notifTitlesFor(purchasing1Id).filter(t => t === 'NCR เกินกำหนด').length;
  checkOverdueNcrNotifications();
  const countAfter = notifTitlesFor(purchasing1Id).filter(t => t === 'NCR เกินกำหนด').length;
  assert.equal(countAfter, countBefore + 1, 'ต้องแจ้งซ้ำอีกครั้งเพราะผ่าน repeat_days แล้ว');

  const second = db.prepare('SELECT overdue_notified_at FROM ncrs WHERE id = ?').get(ncr.id).overdue_notified_at;
  assert.notEqual(second, daysAgo(4), 'overdue_notified_at ต้องถูกอัปเดตเป็นเวลาปัจจุบัน ไม่ใช่ค่าที่ backdate ไว้');
});

test('NOTIF-09 Overdue: ข้อความแจ้งเตือนมีจำนวนวันที่เกินกำหนดจริง + ลิงก์เข้าดูเอกสาร', async () => {
  db.setSetting('app_url', 'https://iqc.example.com');
  try {
    const ncr = makeBillNcr({ status: 'pending_manager_review', qmrOpenedAt: daysAgo(10) }); // 10 วัน - default 7 วัน = เกิน 3 วัน
    checkOverdueNcrNotifications();
    const row = db.prepare('SELECT message FROM notifications WHERE user_id = ? AND link = ? ORDER BY id DESC LIMIT 1')
      .get(purMgrId, `/ncr/${ncr.id}`);
    assert.ok(row, 'ต้องมี notification ผูกกับ NCR นี้');
    assert.match(row.message, /เกินกำหนดมาแล้ว 3 วัน/, `ข้อความควรระบุจำนวนวันที่เกินกำหนดจริง ได้ค่า: ${row.message}`);
  } finally {
    db.setSetting('app_url', '');
  }
});

test('NOTIF-10 Overdue: @mention ผู้ดูแลจัดซื้อของ supplier ในข้อความกลุ่ม Telegram ถ้าตั้งค่า telegram_username ไว้', async () => {
  db.setSetting('telegram_bot_token', 'test-token');
  db.setSetting('telegram_group_purchasing', '-100999');
  db.prepare('UPDATE users SET telegram_username = ? WHERE id = ?').run('somchai_pur', purchasing1Id);
  let capturedBody = null;
  const restore = mockNodeFetch(async (url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return { ok: true };
  });
  try {
    makeBillNcr({ status: 'pending_manager_review', qmrOpenedAt: daysAgo(30) });
    checkOverdueNcrNotifications();
    assert.ok(capturedBody, 'ต้องมีการเรียก sendTelegram ไปกลุ่มจัดซื้อ');
    assert.match(capturedBody.text, /^@somchai_pur\n\[IQC\]/, `ข้อความต้องขึ้นต้นด้วย @mention: ${capturedBody.text}`);
  } finally {
    restore();
    db.prepare('UPDATE users SET telegram_username = NULL WHERE id = ?').run(purchasing1Id);
    db.setSetting('telegram_bot_token', '');
    db.setSetting('telegram_group_purchasing', '');
  }
});

test('NOTIF-11 Overdue: ไม่มี @mention ถ้าผู้ดูแลจัดซื้อยังไม่ได้ตั้งค่า telegram_username', async () => {
  db.setSetting('telegram_bot_token', 'test-token');
  db.setSetting('telegram_group_purchasing', '-100999');
  let capturedBody = null;
  const restore = mockNodeFetch(async (url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return { ok: true };
  });
  try {
    makeBillNcr({ status: 'pending_manager_review', qmrOpenedAt: daysAgo(30) });
    checkOverdueNcrNotifications();
    assert.ok(capturedBody);
    assert.match(capturedBody.text, /^\[IQC\]/, `ไม่ควรมี @mention นำหน้าถ้าไม่ได้ตั้งค่า username: ${capturedBody.text}`);
  } finally {
    restore();
    db.setSetting('telegram_bot_token', '');
    db.setSetting('telegram_group_purchasing', '');
  }
});

test('NOTIF-12 getSupplierAssigneeMentions: คืน @username เฉพาะผู้ดูแลที่ตั้งค่าไว้ ข้ามคนที่ยังไม่ตั้ง', () => {
  const { getSupplierAssigneeMentions } = require('../lib/purchasingScope');
  db.prepare('INSERT INTO supplier_purchasing_assignees (supplier_id, user_id) VALUES (?, ?)').run(supplierId, purMgrId);
  try {
    assert.deepEqual(getSupplierAssigneeMentions(supplierId), [], 'ยังไม่มีใครตั้ง telegram_username เลย');
    db.prepare('UPDATE users SET telegram_username = ? WHERE id = ?').run('nApa_qc', purchasing1Id);
    const mentions = getSupplierAssigneeMentions(supplierId);
    assert.deepEqual(mentions, ['@nApa_qc'], 'ต้องมีแค่คนที่ตั้ง username ไว้เท่านั้น (pur_mgr ไม่ตั้ง ไม่ควรติดมา)');
  } finally {
    db.prepare('UPDATE users SET telegram_username = NULL WHERE id = ?').run(purchasing1Id);
    db.prepare('DELETE FROM supplier_purchasing_assignees WHERE supplier_id = ? AND user_id = ?').run(supplierId, purMgrId);
  }
});

test('NOTIF-13 QMR อนุมัติเปิด NCR: ข้อความกลุ่มจัดซื้อ ("รอ Review จัดซื้อ") มี @mention ผู้ดูแลจัดซื้อของ supplier ด้วย (S154)', async () => {
  db.setSetting('telegram_bot_token', 'test-token');
  db.setSetting('telegram_group_purchasing', '-100999');
  db.prepare('UPDATE users SET telegram_username = ? WHERE id = ?').run('somchai_pur', purchasing1Id);
  let capturedBody = null;
  const restore = mockNodeFetch(async (url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return { ok: true };
  });
  try {
    const ncr = makeBillNcr({ status: 'pending_qmr_open' });
    ncrService.approveNcr({ ncr, actorId: qmrId, actorRole: 'qmr', actorIp: '127.0.0.1', action: 'approve' });
    assert.ok(capturedBody, 'ต้องมีการเรียก sendTelegram ไปกลุ่มจัดซื้อ');
    assert.equal(capturedBody.chat_id, '-100999');
    assert.match(capturedBody.text, /^@somchai_pur\n\[IQC\].*กรุณา Review NCR/s, `ข้อความต้องขึ้นต้นด้วย @mention: ${capturedBody.text}`);
  } finally {
    restore();
    db.prepare('UPDATE users SET telegram_username = NULL WHERE id = ?').run(purchasing1Id);
    db.setSetting('telegram_bot_token', '');
    db.setSetting('telegram_group_purchasing', '');
  }
});

test.after(() => {
  try { db.close(); } catch {}
  for (const f of [process.env.IQC_DB_PATH, process.env.IQC_DB_PATH + '-wal', process.env.IQC_DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch {} }
});
