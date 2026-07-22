// Req 6 (Purchasing Dashboard) — แจ้งเตือน NCR ที่เกินกำหนด ให้ Purchasing Owner + Purchasing Manager +
// กลุ่ม Telegram จัดซื้อ เรียกจาก index.js scheduler (pattern เดียวกับ archiveOldNotifications/backupService:
// รันตอนบูต + ทุก 1 ชม.)
//
// S150 — แก้บั๊ก: เดิมนับ "เกินกำหนด" จาก disposition_due_date ที่ QC Manager กรอกเองตอนส่ง NCR ให้ QMR อนุมัติ
// เปิด (ขั้น pending_manager) ทำให้แจ้งเตือนไปถึงจัดซื้อได้ทั้งที่ QMR ยังไม่ได้อนุมัติเปิดเอกสารเลย — เปลี่ยนมานับจาก
// ncrs.qmr_opened_at (เวลาที่ QMR อนุมัติเปิดจริง, ตั้งค่าใน ncrService.js's approveNcr) + จำนวนวันที่ตั้งค่าได้
// (Admin > ตั้งค่า > Telegram, key 'ncr_overdue_days', default 7 ถ้ายังไม่ได้ตั้ง) — NCR ที่ QMR ยังไม่เปิด
// (qmr_opened_at ยัง NULL) จะไม่ถูกนับว่าเกินกำหนดเด็ดขาด ไม่ว่า disposition_due_date จะเป็นอะไรก็ตาม
//
// S152 — เปลี่ยนจากแจ้งครั้งเดียว (gate ด้วย overdue_notified_at IS NULL) เป็น**แจ้งซ้ำทุก N วัน**จนกว่าจะปิด/
// ยกเลิกเอกสาร (key 'ncr_overdue_repeat_days', default 3) — overdue_notified_at เปลี่ยนความหมายจาก "เคยแจ้งหรือ
// ยัง" เป็น "แจ้งครั้งล่าสุดเมื่อไร" ใช้เป็นทั้ง flag และ cursor ของรอบถัดไปในตัวเดียว — ข้อความเพิ่มจำนวนวันที่
// เกินกำหนดมาแล้ว (ไม่ใช่แค่วันที่ครบกำหนด) + แนบลิงก์เข้าดูเอกสารตรงในข้อความ Telegram กลุ่มด้วย (เดิมมีแค่ในแจ้งเตือน
// ส่วนตัวผ่าน notifyUserTelegram อัตโนมัติ — กลุ่มไม่มี link มาก่อน)
//
// S153 — @mention ผู้ดูแลจัดซื้อของ supplier นั้นๆ นำหน้าข้อความกลุ่ม (ถ้าตั้งค่า telegram_username ไว้) — ใช้
// plain-text "@username" (ไม่ใช้ parse_mode:HTML/text_mention) เพราะ sendTelegram() ส่งแบบ plain text เสมอ
// (กัน HTML injection จากข้อความที่มีค่าผู้ใช้กรอกปนอยู่ เช่น ชื่อสินค้า/comment — ดู routes/notifications.js)
// Telegram parse "@username" เป็น mention entity ให้อัตโนมัติแม้ไม่มี parse_mode — ping เฉพาะถ้า user คนนั้น
// อยู่ในกลุ่มจริงและมี username สาธารณะตรงกับที่ตั้งไว้ (ไม่งั้นเป็นแค่ข้อความเฉยๆ ไม่ throw/error) ถ้า supplier
// ไม่มีผู้ดูแล specific เลย ไม่ mention ใคร (เหมือน resolveNotifyTargetIds fallback เดิม)
const db = require('../db/database');
const { createNotification, sendTelegram } = require('../lib/notify');
const { resolveNotifyTargetIds, getPurchasingManagerIds, getSupplierAssigneeMentions } = require('./purchasingScope');

function checkOverdueNcrNotifications() {
  const overdueDays = Number(db.getSetting('ncr_overdue_days')) || 7;
  const repeatDays = Number(db.getSetting('ncr_overdue_repeat_days')) || 3;
  const appUrl = (db.getSetting('app_url') || '').replace(/\/+$/, '');

  const rows = db.prepare(`
    SELECT n.id, n.ncr_code, n.qmr_opened_at, b.supplier_id
    FROM ncrs n
    JOIN bills b ON b.id = n.bill_id
    WHERE n.qmr_opened_at IS NOT NULL
      AND date(n.qmr_opened_at, '+' || ? || ' days') < date('now')
      AND n.status NOT IN ('closed', 'ncp_closed', 'cancelled')
      AND (n.overdue_notified_at IS NULL OR date(n.overdue_notified_at, '+' || ? || ' days') < date('now'))
  `).all(overdueDays, repeatDays);

  const managerIds = getPurchasingManagerIds();
  for (const row of rows) {
    const daysOverdue = db.prepare(
      "SELECT CAST(julianday('now') - julianday(date(?, '+' || ? || ' days')) AS INTEGER) AS d"
    ).get(row.qmr_opened_at, overdueDays).d;
    const link = appUrl ? `/ncr/${row.id}` : null;
    const msg = `${row.ncr_code} เกินกำหนดมาแล้ว ${daysOverdue} วัน (QMR อนุมัติเปิดเมื่อ ${row.qmr_opened_at}) — กรุณาติดตาม`;

    const targets = new Set([...resolveNotifyTargetIds(row.supplier_id), ...managerIds]);
    for (const uid of targets) {
      createNotification(uid, 'NCR เกินกำหนด', msg, `/ncr/${row.id}`); // auto ส่ง Telegram ส่วนตัว + แนบ link ให้เอง (notifyUserTelegram)
    }
    const mentions = getSupplierAssigneeMentions(row.supplier_id);
    const mentionLine = mentions.length ? `${mentions.join(' ')}\n` : '';
    sendTelegram(
      db.getSetting('telegram_group_purchasing'),
      `${mentionLine}[IQC] ${msg}${link ? `\n${appUrl}${link}` : ''}`
    );
    db.prepare("UPDATE ncrs SET overdue_notified_at = datetime('now') WHERE id = ?").run(row.id);
  }
  return rows.length;
}

module.exports = { checkOverdueNcrNotifications };
