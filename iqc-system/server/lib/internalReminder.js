// S152 — แจ้งเตือนส่วนตัว (in-app + Telegram ส่วนตัวอัตโนมัติผ่าน createNotification) เมื่อ NCR ค้างอยู่ที่ขั้น
// อนุมัติภายใน 3 ขั้นแรก (ก่อนถึงจัดซื้อ) เกินจำนวนวันที่ตั้งไว้ (Admin > ตั้งค่า > Telegram, key
// 'ncr_internal_reminder_days', default 3) — นับจากเวลาที่ "คนก่อนหน้า" ส่งต่อมา (แถวล่าสุดใน ncr_approvals
// ของ NCR นั้น หรือ created_at ถ้ายังไม่มีใครอนุมัติเลย = ขั้น pending_supervisor แรกสุด) แจ้งซ้ำทุก N วัน
// จนกว่าจะอนุมัติผ่านขั้นนั้นไป (internal_reminder_last_sent_at reset เป็น NULL ทุกครั้งที่ status เปลี่ยน ใน
// ncrService.js's approveNcr — ขั้นถัดไปจึงเริ่มนับรอบใหม่เสมอ ไม่สืบทอดรอบเก่า)
//
// ขอบเขต (ตกลงกับ user แล้ว): เฉพาะ pending_supervisor/pending_manager/pending_qmr_open — 3 ขั้นก่อนเอกสาร
// "ถึงจัดซื้อ" (qmr_opened_at ยังไม่ถูกตั้ง) ขั้นหลังจากนี้ (pending_purchasing_review เป็นต้นไป รวม
// pending_manager_review/pending_qmr_close ที่วนกลับมา QC ภายใน) ใช้ overdueNotifier.js แทน (นับจาก
// qmr_opened_at ต่อเนื่องไม่สนใจว่าขั้นย่อยตอนนี้คืออะไร)
const db = require('../db/database');
const { createNotification, getUsersByRole } = require('../lib/notify');

const STAGE_ROLE = {
  pending_supervisor: 'qc_supervisor',
  pending_manager: 'qc_manager',
  pending_qmr_open: 'qmr',
};

function checkInternalApprovalReminders() {
  const reminderDays = Number(db.getSetting('ncr_internal_reminder_days')) || 3;
  const statuses = Object.keys(STAGE_ROLE);
  const placeholders = statuses.map(() => '?').join(',');

  const rows = db.prepare(`
    SELECT n.id, n.ncr_code, n.status, n.internal_reminder_last_sent_at,
      COALESCE((SELECT MAX(created_at) FROM ncr_approvals WHERE ncr_id = n.id), n.created_at) AS stage_started_at
    FROM ncrs n
    WHERE n.status IN (${placeholders})
  `).all(...statuses);

  let count = 0;
  for (const row of rows) {
    const stageOverdue = db.prepare(
      "SELECT date(?, '+' || ? || ' days') < date('now') AS overdue"
    ).get(row.stage_started_at, reminderDays).overdue;
    if (!stageOverdue) continue;

    // เคยแจ้งไปแล้ว — ต้องรอครบรอบ reminderDays จากครั้งล่าสุดก่อนถึงจะแจ้งซ้ำได้
    if (row.internal_reminder_last_sent_at) {
      const dueAgain = db.prepare(
        "SELECT date(?, '+' || ? || ' days') < date('now') AS due"
      ).get(row.internal_reminder_last_sent_at, reminderDays).due;
      if (!dueAgain) continue;
    }

    const daysStuck = db.prepare(
      "SELECT CAST(julianday('now') - julianday(?) AS INTEGER) AS d"
    ).get(row.stage_started_at).d;
    const msg = `${row.ncr_code} ค้างอนุมัติมาแล้ว ${daysStuck} วัน กรุณาดำเนินการ`;

    for (const u of getUsersByRole(STAGE_ROLE[row.status])) {
      createNotification(u.id, 'NCR รออนุมัติ (ค้างเกินกำหนด)', msg, `/ncr/${row.id}`);
      count++;
    }
    db.prepare("UPDATE ncrs SET internal_reminder_last_sent_at = datetime('now') WHERE id = ?").run(row.id);
  }
  return count;
}

module.exports = { checkInternalApprovalReminders };
