// ===== Bill domain service (สกัดจาก routes/bills.js — CLAUDE.md §2.2/§8) =====
// business transaction ของ Bills (create/submit/approve) — validation (ISO per-item ฯลฯ) ยังอยู่ใน controller
const db = require('../db/database');
const { getUsersByRole, createNotification, sendTelegram } = require('../lib/notify');

// วันที่แบบไทย DD/MM/BE (พ.ศ.) — เช่น 2026-07-18 → 18/07/2569 — คัดลอก convention เดียวกับ
// routes/exports.js's thShortDate() (ใช้ในหัวข้อ PDF "รับเมื่อวันที่") มาใช้ในข้อความ Telegram ให้ตรงกัน
function thShortDate(dateStr) {
  if (!dateStr) return '-';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ข้อมูลเสริมสำหรับข้อความ Telegram (ชื่อ supplier/ผู้สร้าง/จำนวนรายการ) — bill object ที่ route ส่งเข้ามาเป็น
// SELECT * ธรรมดา (ไม่ join) จึงต้อง query เพิ่มเองที่นี่
function getBillNotifyInfo(billId) {
  return db.prepare(`
    SELECT s.name as supplier_name, u.full_name as created_by_name,
           (SELECT COUNT(*) FROM bill_items WHERE bill_id = b.id) as item_count
    FROM bills b
    LEFT JOIN suppliers s ON s.id = b.supplier_id
    LEFT JOIN users u ON u.id = b.created_by
    WHERE b.id = ?
  `).get(billId);
}

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
    // เคลียร์ reject_comment รอบก่อน (ถ้ามี) — ตั้งใจ: ส่งอนุมัติใหม่ = ถือว่าแก้ตามที่ supervisor แจ้งแล้ว
    db.prepare("UPDATE bills SET status='pending_approval', reject_comment=NULL WHERE id=?").run(bill.id);
    for (const sv of getUsersByRole('qc_supervisor')) {
      createNotification(sv.id, 'บิลรออนุมัติ', `Invoice ${bill.invoice_no} รอการอนุมัติ`, `/bills/${bill.id}`);
    }

    // ข้อความ Telegram กลุ่ม QC ตอนส่งบิลรออนุมัติ — คำขอ user (S143): แสดงรายละเอียดครบ + emoji บอกสถานะ
    const info = getBillNotifyInfo(bill.id);
    const appUrl = db.getSetting('app_url');
    const link = appUrl ? `${appUrl.replace(/\/+$/, '')}/bills/${bill.id}` : `/bills/${bill.id}`;
    const text = [
      '📥 มีบันทึกรับเข้าบิลใหม่',
      `PO: ${bill.po_no}`,
      `Invoice: ${bill.invoice_no}`,
      `บริษัท: ${info?.supplier_name || '-'}`,
      `จำนวนรายการ ${info?.item_count ?? 0} รายการ`,
      `วันที่บิล: ${thShortDate(bill.received_date)}`,
      `ผู้รับเข้า: ${info?.created_by_name || '-'}`,
      'สถานะ: ⏳ รออนุมัติ',
      `Link: ${link}`,
    ].join('\n');
    sendTelegram(db.getSetting('telegram_group_qc'), text);

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

    // ข้อความ Telegram กลุ่ม QC ตอนหัวหน้างานอนุมัติ — คำขอ user (S143): เดิมไม่มีข้อความ Telegram ตอน approve เลย
    const info = getBillNotifyInfo(bill.id);
    const text = [
      '***************************',
      `PO: ${bill.po_no}`,
      `Invoice: ${bill.invoice_no}`,
      `บริษัท: ${info?.supplier_name || '-'}`,
      `จำนวนรายการ ${info?.item_count ?? 0} รายการ`,
      `วันที่บิล: ${thShortDate(bill.received_date)}`,
      `ผู้รับเข้า: ${info?.created_by_name || '-'}`,
      '***************************',
      '✅ ได้รับการอนุมัติแล้ว',
      '***************************',
    ].join('\n');
    sendTelegram(db.getSetting('telegram_group_qc'), text);

    db.auditLog('bills', bill.id, 'APPROVE', { status: 'pending_approval' }, { status: 'approved' }, actorId, actorIp);
  });
  approve();
}

module.exports = { createBill, submitBill, approveBill };
