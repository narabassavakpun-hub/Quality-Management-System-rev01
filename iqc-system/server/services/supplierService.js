// ===== Supplier response service (สกัดจาก routes/supplier.js — CLAUDE.md §2.2/§8) =====
const db = require('../db/database');
const { getUsersByRole, createNotification, sendTelegram } = require('../lib/notify');
const { resolveNotifyTargetIds } = require('../lib/purchasingScope');

// Supplier ตอบกลับ NCR (public) — บันทึก response + attachments + ncr → pending_manager_review → คืน responseId
function submitSupplierResponse({ ncr, respondent_name, root_cause, corrective_action, preventive_action, completion_date, files }) {
  const respond = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO supplier_responses (ncr_id, respondent_name, root_cause, corrective_action, preventive_action, completion_date)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(ncr.id, respondent_name.trim(), root_cause, corrective_action, preventive_action, completion_date || null);

    if (files?.length) {
      const ins = db.prepare('INSERT INTO supplier_response_attachments (response_id, file_path) VALUES (?, ?)');
      for (const file of files) ins.run(result.lastInsertRowid, file.filename);
    }

    db.prepare("UPDATE ncrs SET status='pending_manager_review' WHERE id=?").run(ncr.id);

    for (const u of getUsersByRole('qc_manager')) {
      createNotification(u.id, 'Supplier ตอบ NCR แล้ว', `${ncr.ncr_code} — รอ QC Manager ตรวจสอบ`, `/ncr/${ncr.id}`);
    }
    // Req 6 — "Supplier Response" ต้องแจ้ง Purchasing Owner ด้วย (เดิมแจ้งแค่ QC Manager)
    const billRow = db.prepare('SELECT supplier_id FROM bills WHERE id = ?').get(ncr.bill_id);
    for (const uid of resolveNotifyTargetIds(billRow ? billRow.supplier_id : null)) {
      createNotification(uid, 'Supplier ตอบ NCR แล้ว', `${ncr.ncr_code} — Supplier ส่งคำตอบแล้ว รอ QC Manager ตรวจสอบ`, `/ncr/${ncr.id}`);
    }
    sendTelegram(db.getSetting('telegram_group_qc'), `[IQC] Supplier ตอบกลับ\n${ncr.ncr_code}\nรอ QC Manager ตรวจสอบ`);

    db.auditLog('supplier_responses', result.lastInsertRowid, 'CREATE', null, { ncr_id: ncr.id }, null, null);
    return result.lastInsertRowid;
  });
  return respond();
}

module.exports = { submitSupplierResponse };
