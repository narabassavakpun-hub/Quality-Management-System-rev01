// ===== Bill domain service (สกัดจาก routes/bills.js — CLAUDE.md §2.2/§8) =====
// business transaction ของ Bills (create/submit/approve) — validation (ISO per-item ฯลฯ) ยังอยู่ใน controller
const db = require('../db/database');
const { getUsersByRole, createNotification, sendTelegram } = require('../lib/notify');

// สร้างบิล draft + audit → คืน billId
function createBill({ invoice_no, po_no, container_no, tracking_no, supplier_id, received_date, actorId, actorIp }) {
  const create = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO bills (invoice_no, po_no, container_no, tracking_no, supplier_id, received_date, status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, 'draft', ?)
    `).run(invoice_no, po_no, container_no || null, tracking_no || null, supplier_id, received_date, actorId);
    db.auditLog('bills', result.lastInsertRowid, 'CREATE', null, { invoice_no, po_no, supplier_id }, actorId, actorIp);
    return result.lastInsertRowid;
  });
  return create();
}

// submit บิล (draft → pending_approval) + notify supervisor + audit
function submitBill({ bill, actorId, actorIp }) {
  const submit = db.transaction(() => {
    db.prepare("UPDATE bills SET status='pending_approval' WHERE id=?").run(bill.id);
    for (const sv of getUsersByRole('qc_supervisor')) {
      createNotification(sv.id, 'บิลรออนุมัติ', `Invoice ${bill.invoice_no} รอการอนุมัติ`, `/bills/${bill.id}`);
    }
    sendTelegram(db.getSetting('telegram_group_qc'), `[IQC] บิลใหม่รออนุมัติ\nInvoice: ${bill.invoice_no}\nPO: ${bill.po_no}`);
    db.auditLog('bills', bill.id, 'SUBMIT', { status: 'draft' }, { status: 'pending_approval' }, actorId, actorIp);
  });
  submit();
}

// approve บิล (pending_approval → approved, optimistic lock) + notify creator + audit
function approveBill({ bill, actorId, actorIp }) {
  const approve = db.transaction(() => {
    const changed = db.prepare("UPDATE bills SET status='approved' WHERE id=? AND status='pending_approval'").run(bill.id);
    if (changed.changes === 0) throw new Error('บิลถูกดำเนินการแล้ว กรุณารีเฟรชหน้า');
    createNotification(bill.created_by, 'บิลได้รับการอนุมัติ', `Invoice ${bill.invoice_no} อนุมัติแล้ว`, `/bills/${bill.id}`);
    db.auditLog('bills', bill.id, 'APPROVE', { status: 'pending_approval' }, { status: 'approved' }, actorId, actorIp);
  });
  approve();
}

module.exports = { createBill, submitBill, approveBill };
