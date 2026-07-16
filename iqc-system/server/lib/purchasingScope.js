// ===== Supplier-scoped purchasing permissions =====
// จำกัดสิทธิ์ role='purchasing' ให้เห็น/ดำเนินการเฉพาะ NCR/UAI/Delivery ของ supplier ที่ตัวเองถูกตั้งเป็น
// "ผู้ดูแลจัดซื้อ" (supplier_purchasing_assignees, ตั้งค่าที่ Master > ผู้ผลิต) — ถ้า supplier ไม่มีใครถูกตั้งไว้เลย
// เปิดให้จัดซื้อทุกคนเห็น/ทำได้เหมือนเดิม (fallback) — role='purchasing_manager'/'admin' ไม่ถูกจำกัด เห็น/ทำได้ทุกอย่าง
const db = require('../db/database');
const { getUsersByRole } = require('./notify');

function getSupplierAssigneeIds(supplierId) {
  if (!supplierId) return [];
  return db.prepare('SELECT user_id FROM supplier_purchasing_assignees WHERE supplier_id = ?').all(supplierId).map(r => r.user_id);
}

// user id ที่ควรได้รับแจ้งเตือน (in-app + Telegram ส่วนตัวอัตโนมัติผ่าน createNotification) สำหรับ supplier นี้
// — มีผู้ดูแล แจ้งเฉพาะผู้ดูแล, ไม่มีผู้ดูแล fallback แจ้งจัดซื้อทุกคนเหมือนพฤติกรรมเดิมก่อนมีฟีเจอร์นี้
function resolveNotifyTargetIds(supplierId) {
  const assignees = getSupplierAssigneeIds(supplierId);
  if (assignees.length) return assignees;
  return getUsersByRole('purchasing').map(u => u.id);
}

// จัดซื้อ (role='purchasing') ทำ action กับเอกสารของ supplier นี้ได้ไหม — เรียกเฉพาะตอน req.user.role==='purchasing'
// เท่านั้น (purchasing_manager/admin ไม่ต้องเช็ค ผ่านเสมอ, role อื่นมี guard ของตัวเองอยู่แล้วไม่เกี่ยวกับฟังก์ชันนี้)
function canPurchasingActOnSupplier(userId, supplierId) {
  const assignees = getSupplierAssigneeIds(supplierId);
  return assignees.length === 0 || assignees.includes(userId);
}

// ผู้จัดการจัดซื้อทุกคน (active) — ใช้เสริม resolveNotifyTargetIds เฉพาะ event ที่ spec (CLAUDE.md §22 Req 6 เดิม)
// ระบุให้แจ้ง manager ด้วย: NCR รอ Review/ปิดแล้ว/เกินกำหนด — ไม่ใช่ทุก event (Waiting Send Link/Supplier Response
// แจ้งเฉพาะ Purchasing Owner ตาม spec) จึงแยกเป็นฟังก์ชันของตัวเอง ไม่รวมเข้า resolveNotifyTargetIds ตรงๆ
function getPurchasingManagerIds() {
  return getUsersByRole('purchasing_manager').map(u => u.id);
}

// COO (role='cco' — โชว์เป็น "COO" ในหน้าจอ, ดู CLAUDE.md §11) ที่ต้องแจ้ง email/telegram ส่วนตัวเมื่อ NCR ผ่าน
// purchasing_manager — ต้องการ contact info เต็ม (ไม่ใช่แค่ id) จึง query ตรงแทนใช้ getUsersByRole
function getCooUsers() {
  return db.prepare(`SELECT id, full_name, email, telegram_chat_id FROM users WHERE role = 'cco' AND is_active = 1`).all();
}

// SQL fragment ต่อท้าย WHERE เพื่อกรอง list ให้ purchasing เห็นเฉพาะ supplier ที่ไม่มีผู้ดูแล หรือตัวเองเป็นผู้ดูแล
// — ใช้ `supplierIdExpr` เป็น column/expression ของ supplier_id ในคิวรีนั้น (เช่น 'b.supplier_id')
// ต้อง push userId เข้า params ต่อจาก param อื่นๆ ตามตำแหน่ง `?` ที่ปรากฏ (มี 1 ตัวใน fragment นี้)
// ใช้กับ NCR/UAI/Delivery action-permission + list visibility เท่านั้น (canPurchasingActOnSupplier คู่กัน) —
// เจตนา fallback นี้คือ "อย่าให้ supplier ที่ยังไม่มีใคร assign ตกค้างไม่มีใครทำงานได้เลย" ไม่ใช่ scope สำหรับ
// dashboard ส่วนตัว (ดู purchasingStrictAssignedSQL ด้านล่าง — คนละความหมายกัน อย่าใช้ปนกัน)
function purchasingVisibilitySQL(supplierIdExpr) {
  return `(
    NOT EXISTS (SELECT 1 FROM supplier_purchasing_assignees spa WHERE spa.supplier_id = ${supplierIdExpr})
    OR EXISTS (SELECT 1 FROM supplier_purchasing_assignees spa WHERE spa.supplier_id = ${supplierIdExpr} AND spa.user_id = ?)
  )`;
}

// SQL fragment สำหรับ Purchasing Dashboard "ผู้ผลิตของฉัน" โดยเฉพาะ — เข้มงวดกว่า purchasingVisibilitySQL
// (ไม่มี fallback รวม supplier ที่ยังไม่มีผู้ดูแล) เพราะ dashboard ต้องแสดงตรงกับที่ตั้งค่าไว้ใน Master List เป๊ะๆ
// (พบจริง: user รายงานว่า "ผู้ผลิตของฉัน" โชว์ supplier ทั้ง 112 รายแทนที่จะเป็นแค่ 3 ที่ assign ไว้จริง เพราะ
// supplier ส่วนใหญ่ในระบบยังไม่เคยถูก assign เลยจึงเข้าเงื่อนไข fallback ของ purchasingVisibilitySQL) — ต้อง push
// userId เข้า params เหมือน purchasingVisibilitySQL (มี 1 ตัวใน fragment นี้)
function purchasingStrictAssignedSQL(supplierIdExpr) {
  return `EXISTS (SELECT 1 FROM supplier_purchasing_assignees spa WHERE spa.supplier_id = ${supplierIdExpr} AND spa.user_id = ?)`;
}

module.exports = {
  getSupplierAssigneeIds, resolveNotifyTargetIds, canPurchasingActOnSupplier,
  purchasingVisibilitySQL, purchasingStrictAssignedSQL, getPurchasingManagerIds, getCooUsers,
};
