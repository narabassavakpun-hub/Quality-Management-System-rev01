// ===== Notification service (DEVMORE — service-layer extraction) =====
// รวม helper ที่เคย copy-paste ใน bills/ncr/uai/supplier/delivery ไว้ที่เดียว
const db = require('../db/database');
const { createNotification, sendTelegram } = require('../routes/notifications');

// คืน users ที่ active ตาม role (รับได้ทั้ง 1 หรือหลาย role)
function getUsersByRole(...roles) {
  if (!roles.length) return [];
  const ph = roles.map(() => '?').join(',');
  return db.prepare(`SELECT id FROM users WHERE role IN (${ph}) AND is_active = 1`).all(...roles);
}

// เฉพาะ qc_staff สถานี incoming (QC รับเข้า) — ใช้แทน getUsersByRole('qc_staff') ในทุก notification
function getReceivingQCStaff() {
  return db.prepare(`SELECT id FROM users WHERE role='qc_staff' AND qc_station='incoming' AND is_active=1`).all();
}

// แจ้งเตือนทุก user ในกลุ่ม role ที่ระบุ
function notifyRoles(roles, { title, message, link }) {
  for (const u of getUsersByRole(...roles)) createNotification(u.id, title, message, link);
}

module.exports = { getUsersByRole, getReceivingQCStaff, notifyRoles, createNotification, sendTelegram };
