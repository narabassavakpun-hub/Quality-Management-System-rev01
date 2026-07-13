// Req 6 (Purchasing Dashboard) — แจ้งเตือน NCR ที่เกินกำหนด (disposition_due_date) ให้ Purchasing Owner + Purchasing
// Manager ครั้งเดียวต่อรายการ (gate ด้วย ncrs.overdue_notified_at กันแจ้งซ้ำทุกรอบที่ scheduler รัน — ดู database.js)
// เรียกจาก index.js scheduler (pattern เดียวกับ archiveOldNotifications/backupService: รันตอนบูต + ทุก 1 ชม.)
const db = require('../db/database');
const { createNotification, sendTelegram } = require('../lib/notify');
const { resolveNotifyTargetIds, getPurchasingManagerIds } = require('./purchasingScope');

function checkOverdueNcrNotifications() {
  const rows = db.prepare(`
    SELECT n.id, n.ncr_code, n.disposition_due_date, b.supplier_id
    FROM ncrs n
    JOIN bills b ON b.id = n.bill_id
    WHERE n.disposition_due_date IS NOT NULL
      AND n.disposition_due_date < date('now')
      AND n.status NOT IN ('closed', 'ncp_closed', 'cancelled')
      AND n.overdue_notified_at IS NULL
  `).all();

  const managerIds = getPurchasingManagerIds();
  for (const row of rows) {
    const targets = new Set([...resolveNotifyTargetIds(row.supplier_id), ...managerIds]);
    for (const uid of targets) {
      createNotification(uid, 'NCR เกินกำหนด', `${row.ncr_code} เกินกำหนดวันที่ ${row.disposition_due_date} แล้ว`, `/ncr/${row.id}`);
    }
    sendTelegram(db.getSetting('telegram_group_purchasing'), `[IQC] ${row.ncr_code}\nเกินกำหนดวันที่ ${row.disposition_due_date} แล้ว — กรุณาติดตาม`);
    db.prepare("UPDATE ncrs SET overdue_notified_at = datetime('now') WHERE id = ?").run(row.id);
  }
  return rows.length;
}

module.exports = { checkOverdueNcrNotifications };
