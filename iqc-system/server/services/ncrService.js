// ===== NCR domain service (สกัดจาก routes/ncr.js — CLAUDE.md §2.2/§8) =====
// รวม business transaction ของ NCR ไว้ที่เดียว — route handler เหลือแค่ validate + response
// throw error พร้อม .status เพื่อให้ controller map เป็น HTTP status ที่ถูกต้อง
const db = require('../db/database');
const { getUsersByRole, getReceivingQCStaff, createNotification, sendTelegram } = require('../lib/notify');
const { resolveNotifyTargetIds, getPurchasingManagerIds, getCooUsers, getSupplierAssigneeMentions } = require('../lib/purchasingScope');
const { sendEmail } = require('../lib/mailer');
const { buildNcrInfoHtml, buildNcrInfoText } = require('../lib/ncrEmailTemplate');

function httpError(message, status) { const e = new Error(message); e.status = status; return e; }

// NCR items พร้อมรหัสสินค้า (join ผ่าน bill_item_id → products เหมือน exports.js PDF) — ใช้ทั้ง GET /ncr/:id และอีเมลแจ้ง COO
// bill_item_product_id (S162) — product_id ปัจจุบันของ bill_item ที่ผูกอยู่ ใช้ pre-populate ตัวเลือกสินค้าตอน
// แก้ไขรหัสสินค้าผิด (correctNcrItemProduct) ไม่ต้อง query แยก
function getFullNcrItems(ncrId) {
  return db.prepare(`
    SELECT ni.*, dc.name as defect_category_name, p.code as product_code, bi.product_id as bill_item_product_id
    FROM ncr_items ni
    LEFT JOIN defect_categories dc ON dc.id = ni.defect_category_id
    LEFT JOIN bill_items bi ON bi.id = ni.bill_item_id
    LEFT JOIN products p ON p.id = bi.product_id
    WHERE ni.ncr_id = ?
  `).all(ncrId);
}

// user id ที่ควรแจ้งเตือนแทน "จัดซื้อทุกคน" — เฉพาะผู้ดูแลจัดซื้อของ Supplier นี้ (fallback จัดซื้อทุกคนถ้าไม่มีใครถูกตั้ง)
function purchasingTargetsForBill(billId) {
  const row = db.prepare('SELECT supplier_id FROM bills WHERE id = ?').get(billId);
  return resolveNotifyTargetIds(row ? row.supplier_id : null);
}

// S154 — บรรทัด @mention (ถ้ามี) ต่อหน้าข้อความกลุ่ม Telegram จัดซื้อ — @ เฉพาะผู้ดูแลจัดซื้อของ Supplier ของบิลนี้
// ที่ตั้งค่า telegram_username ไว้แล้ว (getSupplierAssigneeMentions) คืน '' เปล่าถ้าไม่มีใคร mention ได้เลย
function purchasingMentionsForBill(billId) {
  const row = db.prepare('SELECT supplier_id FROM bills WHERE id = ?').get(billId);
  const mentions = getSupplierAssigneeMentions(row ? row.supplier_id : null);
  return mentions.length ? `${mentions.join(' ')}\n` : '';
}

// สร้าง NCR/NCP + items + images + status branch + notifications + audit (1 transaction) → คืน ncrId
function createNcr({ bill, items, severity, isNCP, files, actorId, actorRole, actorIp }) {
  const create = db.transaction(() => {
    const ncr_code = isNCP ? db.nextNCPCode() : db.nextNCRCode();
    let supplier_token = null;
    let tokenExpiry = null;
    if (!isNCP) {
      supplier_token = db.generateSecureToken();
      tokenExpiry = new Date();
      tokenExpiry.setDate(tokenExpiry.getDate() + Number(db.getSetting('token_expiry_days') || 90));
    }

    const ncrResult = db.prepare(`
      INSERT INTO ncrs (ncr_code, bill_id, po_no, invoice_no, severity, supplier_token, token_expires_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(ncr_code, bill.id, bill.po_no, bill.invoice_no, severity, supplier_token, tokenExpiry ? tokenExpiry.toISOString() : null, actorId);

    const ncrId = ncrResult.lastInsertRowid;

    const insItem = db.prepare(`
      INSERT INTO ncr_items (ncr_id, bill_item_id, item_name, qty_received, qty_sampled, qty_failed, defect_category_id, defect_detail)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of items) {
      insItem.run(ncrId, item.bill_item_id || null, item.item_name, item.qty_received || 0, item.qty_sampled || 0, item.qty_failed || 0, item.defect_category_id || null, item.defect_detail || item.problem_description || null);
    }

    if (files?.length) {
      const insImg = db.prepare('INSERT INTO ncr_images (ncr_id, file_path) VALUES (?, ?)');
      for (const file of files) insImg.run(ncrId, file.filename);
    }

    const docLabel = isNCP ? 'NCP' : 'NCR';

    if (actorRole === 'qc_supervisor' && isNCP) {
      // Supervisor สร้าง NCP (minor) เอง = อนุมัติปิดในตัว → ปิด NCP ทันที
      db.prepare("UPDATE ncrs SET status='ncp_closed', closed_at=datetime('now') WHERE id=?").run(ncrId);
      db.prepare('INSERT INTO ncr_approvals (ncr_id, action, role, user_id, comment) VALUES (?, ?, ?, ?, ?)').run(ncrId, 'approved', 'qc_supervisor', actorId, 'สร้างและปิด NCP โดย QC Supervisor');
      createNotification(actorId, 'NCP ปิดแล้ว', `${ncr_code} ปิดเอกสาร NCP แล้ว`, `/ncr/${ncrId}`);
      for (const u of getUsersByRole('qc_manager')) {
        createNotification(u.id, 'NCP ปิดแล้ว', `${ncr_code} ปิดเอกสาร NCP แล้ว`, `/ncr/${ncrId}`);
      }
      sendTelegram(db.getSetting('telegram_group_qc'),
        `[IQC] NCP ใหม่ (ปิดแล้ว)\n${ncr_code}\nBill: ${bill.invoice_no}\nรายการ: ${items.length} รายการ\nระดับ: Minor (NCP)\nสร้างและปิดโดย QC Supervisor`
      );
    } else if (actorRole === 'qc_supervisor') {
      // Supervisor สร้าง NCR Major เอง → auto-approve L1, ข้ามไป pending_manager ทันที
      db.prepare("UPDATE ncrs SET status='pending_manager' WHERE id=?").run(ncrId);
      db.prepare('INSERT INTO ncr_approvals (ncr_id, action, role, user_id, comment) VALUES (?, ?, ?, ?, ?)').run(ncrId, 'approved', 'qc_supervisor', actorId, 'สร้างโดย QC Supervisor');
      for (const mgr of getUsersByRole('qc_manager')) {
        createNotification(mgr.id, `${docLabel} ใหม่รอ QC Manager อนุมัติ`, `${ncr_code} รอ QC Manager อนุมัติ`, `/ncr/${ncrId}`);
      }
      sendTelegram(db.getSetting('telegram_group_qc'),
        `[IQC] ${docLabel} ใหม่\n${ncr_code}\nBill: ${bill.invoice_no}\nรายการ: ${items.length} รายการ\nระดับ: Major\nสร้างโดย QC Supervisor — รอ QC Manager อนุมัติ`
      );
    } else {
      for (const sv of getUsersByRole('qc_supervisor')) {
        createNotification(sv.id, `${docLabel} ใหม่รออนุมัติ`, `${ncr_code} รออนุมัติ`, `/ncr/${ncrId}`);
      }
      sendTelegram(db.getSetting('telegram_group_qc'),
        `[IQC] ${docLabel} ใหม่\n${ncr_code}\nBill: ${bill.invoice_no}\nรายการ: ${items.length} รายการ\nระดับ: ${severity === 'minor' ? 'Minor (NCP)' : 'Major'}\nรอ QC Supervisor อนุมัติ`
      );
    }

    db.auditLog('ncrs', ncrId, 'CREATE', null, { ncr_code, bill_id: bill.id, severity }, actorId, actorIp);

    // NCP repeat alert — ถ้า SKU เดิมมี NCP >= 3 ครั้ง แจ้งเตือน
    if (isNCP) {
      for (const item of items) {
        if (!item.bill_item_id) continue;
        const biRow = db.prepare('SELECT product_id FROM bill_items WHERE id = ?').get(item.bill_item_id);
        if (!biRow?.product_id) continue;
        const ncpCount = db.prepare(`
          SELECT COUNT(*) as c FROM ncrs n
          JOIN ncr_items ni ON ni.ncr_id = n.id
          JOIN bill_items bi ON bi.id = ni.bill_item_id
          WHERE bi.product_id = ? AND n.severity = 'minor' AND n.status != 'cancelled'
        `).get(biRow.product_id)?.c || 0;
        if (ncpCount >= 3) {
          const prod = db.prepare('SELECT name FROM products WHERE id = ?').get(biRow.product_id);
          const msg = `NCP ครบ ${ncpCount} ครั้งสำหรับ ${prod?.name || 'สินค้านี้'} — ควรพิจารณาแจ้ง Supplier`;
          for (const u of [...getReceivingQCStaff(), ...getUsersByRole('qc_supervisor', 'qc_manager')]) {
            createNotification(u.id, 'แจ้งเตือน NCP ซ้ำ', msg, `/ncr/${ncrId}`);
          }
          sendTelegram(db.getSetting('telegram_group_qc'), `[IQC] ${msg}`);
        }
      }
    }

    return ncrId;
  });
  return create();
}

// State machine transition (validate + transaction) → คืน nextStatus (throw httpError ถ้าไม่ผ่าน)
function approveNcr({ ncr, actorId, actorRole, actorIp, comment, action, disposition, disposition_note, disposition_due_date, effectiveness_check_date }) {
  const status = ncr.status;
  const transitions = ncr.severity === 'minor'
    ? { pending_supervisor: { role: 'qc_supervisor', next: 'ncp_closed' } }
    : {
        pending_supervisor: { role: 'qc_supervisor', next: 'pending_manager' },
        pending_manager: { role: 'qc_manager', next: 'pending_qmr_open' },
        pending_qmr_open: { role: 'qmr', next: 'pending_purchasing_review' },
        // S128 — purchasing_manager ต้องตรวจสอบก่อนพนักงานจัดซื้อจะ copy link ส่ง Supplier ได้ (maker-checker gate)
        pending_purchasing_manager_review: { role: 'purchasing_manager', next: 'pending_supplier' },
        pending_manager_review: { role: 'qc_manager', next: 'pending_qmr_close' },
        pending_qmr_close: { role: 'qmr', next: 'closed' },
      };

  const t = transitions[status];
  if (!t) throw httpError(`ไม่สามารถอนุมัติสถานะ ${status}`, 400);
  if (t.role !== actorRole) throw httpError('ไม่มีสิทธิ์อนุมัติขั้นตอนนี้', 403);
  // BUG-005: disposition required before manager can close pending_manager
  if (status === 'pending_manager' && !ncr.disposition && !disposition) {
    throw httpError('กรุณาระบุ disposition ก่อนอนุมัติ', 400);
  }

  const approve = db.transaction(() => {
    // Optimistic lock — atomic status check + update
    const isClosing = t.next === 'closed' || t.next === 'ncp_closed';
    // S150 — QMR อนุมัติเปิดจริง (pending_qmr_open → pending_purchasing_review) บันทึกเวลาไว้เป็นจุดเริ่มนับวัน
    // overdue (แทน disposition_due_date เดิมที่ QC Manager กรอกเองก่อน QMR จะอนุมัติด้วยซ้ำ — ดู overdueNotifier.js)
    const isQmrOpening = t.next === 'pending_purchasing_review';
    // S152 — ทุก transition ต้อง reset internal_reminder_last_sent_at เป็น NULL เสมอ (ขั้นใหม่ = เริ่มนับรอบ
    // แจ้งเตือนค้างอนุมัติใหม่ ไม่สืบทอดรอบเก่าจากขั้นก่อนหน้า — ดู internalReminder.js)
    const changed = isClosing
      ? db.prepare("UPDATE ncrs SET status=?, closed_at=datetime('now'), internal_reminder_last_sent_at=NULL WHERE id=? AND status=?").run(t.next, ncr.id, status)
      : isQmrOpening
      ? db.prepare("UPDATE ncrs SET status=?, qmr_opened_at=datetime('now'), internal_reminder_last_sent_at=NULL WHERE id=? AND status=?").run(t.next, ncr.id, status)
      : db.prepare("UPDATE ncrs SET status=?, internal_reminder_last_sent_at=NULL WHERE id=? AND status=?").run(t.next, ncr.id, status);
    if (changed.changes === 0) throw new Error('เอกสารถูกดำเนินการแล้ว กรุณารีเฟรชหน้า');

    if (status === 'pending_manager' && disposition) {
      db.prepare(`UPDATE ncrs SET disposition=?, disposition_note=?, disposition_due_date=?, effectiveness_check_date=?, disposition_by=? WHERE id=?`)
        .run(disposition, disposition_note || null, disposition_due_date || null, effectiveness_check_date, actorId, ncr.id);
    }

    db.prepare('INSERT INTO ncr_approvals (ncr_id, action, role, user_id, comment) VALUES (?, ?, ?, ?, ?)').run(ncr.id, action || 'approved', actorRole, actorId, comment || null);
    db.auditLog('ncrs', ncr.id, 'APPROVE', { status }, { status: t.next, role: actorRole }, actorId, actorIp);

    // Per-transition notifications
    if (t.next === 'pending_manager') {
      createNotification(ncr.created_by, 'NCR ผ่าน Supervisor แล้ว', `${ncr.ncr_code} หัวหน้า QC อนุมัติแล้ว รอ QC Manager`, `/ncr/${ncr.id}`);
      for (const u of getUsersByRole('qc_manager')) createNotification(u.id, 'NCR รออนุมัติ', `${ncr.ncr_code} รออนุมัติจาก QC Manager`, `/ncr/${ncr.id}`);
      sendTelegram(db.getSetting('telegram_group_qc'), `[IQC] ${ncr.ncr_code} ผ่านอนุมัติ Supervisor แล้ว รอ QC Manager`);
    } else if (t.next === 'pending_qmr_open') {
      createNotification(ncr.created_by, 'NCR ผ่าน QC Manager แล้ว', `${ncr.ncr_code} QC Manager อนุมัติแล้ว รอ QMR เปิด`, `/ncr/${ncr.id}`);
      for (const u of getUsersByRole('qc_supervisor')) createNotification(u.id, 'NCR ผ่าน QC Manager แล้ว', `${ncr.ncr_code} QC Manager อนุมัติแล้ว รอ QMR เปิด`, `/ncr/${ncr.id}`);
      for (const u of getUsersByRole('qmr')) createNotification(u.id, 'NCR รอ QMR อนุมัติเปิด', `${ncr.ncr_code} รอ QMR อนุมัติ`, `/ncr/${ncr.id}`);
      sendTelegram(db.getSetting('telegram_group_qc'), `[IQC] ${ncr.ncr_code} ผ่าน QC Manager\n${disposition ? 'Disposition: ' + disposition + '\n' : ''}รอ QMR อนุมัติเปิด`);
    } else if (t.next === 'pending_purchasing_review') {
      createNotification(ncr.created_by, 'NCR QMR อนุมัติเปิดแล้ว', `${ncr.ncr_code} QMR อนุมัติเปิด NCR แล้ว`, `/ncr/${ncr.id}`);
      for (const u of getUsersByRole('qc_supervisor')) createNotification(u.id, 'NCR QMR อนุมัติเปิดแล้ว', `${ncr.ncr_code} QMR อนุมัติเปิด NCR แล้ว`, `/ncr/${ncr.id}`);
      for (const u of getUsersByRole('qc_manager')) createNotification(u.id, 'NCR QMR อนุมัติเปิดแล้ว', `${ncr.ncr_code} QMR อนุมัติแล้ว รอจัดซื้อ Review`, `/ncr/${ncr.id}`);
      for (const uid of purchasingTargetsForBill(ncr.bill_id)) createNotification(uid, 'NCR รอ Review จัดซื้อ', `${ncr.ncr_code} QMR อนุมัติแล้ว รอจัดซื้อ Review + แปลภาษาก่อนส่ง Supplier`, `/ncr/${ncr.id}`);
      // Req 6 — "NCR ใหม่"/"Waiting Review" ต้องแจ้ง Purchasing Manager ด้วย (ไม่ใช่แค่ผู้ดูแล Supplier)
      for (const u of getPurchasingManagerIds()) createNotification(u, 'NCR รอ Review จัดซื้อ', `${ncr.ncr_code} QMR อนุมัติแล้ว รอจัดซื้อ Review + แปลภาษาก่อนส่ง Supplier`, `/ncr/${ncr.id}`);
      sendTelegram(db.getSetting('telegram_group_qc'), `[IQC] ${ncr.ncr_code} QMR อนุมัติเปิด NCR แล้ว`);
      sendTelegram(db.getSetting('telegram_group_purchasing'),
        `${purchasingMentionsForBill(ncr.bill_id)}[IQC] ${ncr.ncr_code}\nQMR อนุมัติเปิดแล้ว — กรุณา Review NCR และแปลภาษาอังกฤษก่อนส่ง Link ให้ Supplier`
      );
    } else if (t.next === 'pending_qmr_close') {
      for (const u of getUsersByRole('qmr')) createNotification(u.id, 'NCR รอ QMR ปิด', `${ncr.ncr_code} QC Manager ลงชื่อแล้ว`, `/ncr/${ncr.id}`);
      sendTelegram(db.getSetting('telegram_group_qc'), `[IQC] ${ncr.ncr_code} QC Manager ตรวจสอบคำตอบแล้ว — รอ QMR ปิด NCR`);
    } else if (t.next === 'pending_supplier') {
      // S128 — purchasing_manager อนุมัติแล้ว: ลิงก์พร้อมส่ง Supplier จริง (ย้ายมาจาก purchasingReview() เดิม)
      const appUrl = db.getSetting('app_url') || '';
      const supplierLink = `${appUrl}/supplier/ncr/${ncr.supplier_token}`;
      for (const uid of purchasingTargetsForBill(ncr.bill_id)) {
        createNotification(uid, 'NCR พร้อมส่ง Supplier', `${ncr.ncr_code} — คัดลอก Link แล้วส่งให้ Supplier`, `/ncr/${ncr.id}`);
      }
      sendTelegram(db.getSetting('telegram_group_purchasing'),
        `${purchasingMentionsForBill(ncr.bill_id)}[IQC] ${ncr.ncr_code}\nผู้จัดการจัดซื้ออนุมัติแล้ว — พร้อมส่ง Supplier\n\nLink:\n${supplierLink}`
      );

      // COO รับทราบ NCR (email + Telegram ส่วนตัว) — แจ้งเตือนเฉยๆ ไม่มีปุ่ม/สถานะ acknowledge ในระบบ (ยืนยันกับ user แล้ว)
      // S128f — bug จริง: `ncr` ที่รับมาจาก routes/ncr.js's POST /:id/approve มาจาก `SELECT * FROM ncrs` เปล่าๆ
      // (ไม่ join bills/suppliers เหมือน GET /:id) จึงไม่มี ncr.supplier_name เลย ต้อง query เพิ่มเอง
      const supplierRow = db.prepare(`
        SELECT s.name as supplier_name FROM bills b LEFT JOIN suppliers s ON s.id = b.supplier_id WHERE b.id = ?
      `).get(ncr.bill_id);
      const ncrWithSupplier = { ...ncr, supplier_name: supplierRow?.supplier_name || '-' };
      const fullItems = getFullNcrItems(ncr.id);
      const subject = `${ncr.ncr_code} (${ncrWithSupplier.supplier_name}) จำนวน ${fullItems.length} รายการ`;
      const html = buildNcrInfoHtml(ncrWithSupplier, fullItems);
      const text = buildNcrInfoText(ncrWithSupplier, fullItems);
      for (const coo of getCooUsers()) {
        if (coo.email) sendEmail(coo.email, subject, html);
        if (coo.telegram_chat_id) sendTelegram(coo.telegram_chat_id, `[IQC] ${subject}\n\n${text}`);
      }
    } else if (t.next === 'closed') {
      createNotification(ncr.created_by, 'NCR ปิดแล้ว', `${ncr.ncr_code} QMR ปิดเอกสารแล้ว`, `/ncr/${ncr.id}`);
      for (const u of getUsersByRole('qc_supervisor')) createNotification(u.id, 'NCR ปิดแล้ว', `${ncr.ncr_code} QMR ปิดเอกสารแล้ว`, `/ncr/${ncr.id}`);
      for (const u of getUsersByRole('qc_manager')) createNotification(u.id, 'NCR ปิดแล้ว', `${ncr.ncr_code} QMR ปิดเอกสารแล้ว`, `/ncr/${ncr.id}`);
      for (const uid of purchasingTargetsForBill(ncr.bill_id)) createNotification(uid, 'NCR ปิดแล้ว', `${ncr.ncr_code} QMR ปิดเอกสารแล้ว`, `/ncr/${ncr.id}`);
      // Req 6 — "Closed" ต้องแจ้ง Purchasing Manager ด้วย
      for (const u of getPurchasingManagerIds()) createNotification(u, 'NCR ปิดแล้ว', `${ncr.ncr_code} QMR ปิดเอกสารแล้ว`, `/ncr/${ncr.id}`);
      sendTelegram(db.getSetting('telegram_group_qc'), `[IQC] ${ncr.ncr_code} ปิดแล้ว`);
      sendTelegram(db.getSetting('telegram_group_purchasing'), `${purchasingMentionsForBill(ncr.bill_id)}[IQC] ${ncr.ncr_code} ปิดแล้ว`);
    } else if (t.next === 'ncp_closed') {
      createNotification(ncr.created_by, 'NCP อนุมัติแล้ว', `${ncr.ncr_code} ปิดเอกสาร NCP แล้ว`, `/ncr/${ncr.id}`);
      for (const u of getUsersByRole('qc_supervisor')) createNotification(u.id, 'NCP ปิดแล้ว', `${ncr.ncr_code} ปิดเอกสาร NCP แล้ว`, `/ncr/${ncr.id}`);
      for (const u of getUsersByRole('qc_manager')) createNotification(u.id, 'NCP ปิดแล้ว', `${ncr.ncr_code} ปิดเอกสาร NCP แล้ว`, `/ncr/${ncr.id}`);
      sendTelegram(db.getSetting('telegram_group_qc'), `[IQC] ${ncr.ncr_code} NCP ปิดแล้ว (Minor — บันทึกภายใน)`);
    }
  });

  approve();
  return t.next;
}

// Purchasing ขอ UAI จาก NCR (pending_supplier → pending_uai) + สร้าง uai_documents → คืน { uai_id, uai_code }
function requestUai({ ncr, reason, conditions, department, product_type, work_type, defect_description, root_cause_purchasing, corrective_action_purchasing, preventive_action_purchasing, actorId, actorIp }) {
  const createUai = db.transaction(() => {
    // DEVMORE H7 — optimistic lock: ย้ายสถานะ NCR ก่อน กัน purchasing 2 คนสร้าง UAI ซ้อน
    const moved = db.prepare("UPDATE ncrs SET status='pending_uai' WHERE id=? AND status='pending_supplier'").run(ncr.id);
    if (moved.changes === 0) throw new Error('เอกสารถูกดำเนินการแล้ว กรุณารีเฟรชหน้า');

    const uai_code = db.nextUAICode();

    const uaiResult = db.prepare(`
      INSERT INTO uai_documents
        (uai_code, ncr_id, reason, conditions, department,
         product_type, work_type, defect_description,
         root_cause_purchasing, corrective_action_purchasing, preventive_action_purchasing,
         status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uai_pending_qc_manager', ?)
    `).run(
      uai_code, ncr.id, reason, conditions || null, department || null,
      product_type, work_type, defect_description,
      root_cause_purchasing, corrective_action_purchasing, preventive_action_purchasing,
      actorId
    );

    for (const u of getUsersByRole('qc_manager')) {
      createNotification(u.id, 'ขอ UAI รอตรวจสอบ', `${uai_code} (${ncr.ncr_code}) รอ QC Manager ตรวจสอบ`, `/uai/${uaiResult.lastInsertRowid}`);
    }
    sendTelegram(db.getSetting('telegram_group_qc'), `[IQC] ขอ UAI\n${uai_code} (อ้างอิง ${ncr.ncr_code})\nรอ QC Manager ตรวจสอบ`);

    db.auditLog('uai_documents', uaiResult.lastInsertRowid, 'CREATE', null, { uai_code, ncr_id: ncr.id }, actorId, actorIp);
    return { uai_id: uaiResult.lastInsertRowid, uai_code };
  });
  return createUai();
}

// Purchasing Review — บันทึกคำแปล EN + มูลค่าเคลม + ต่ออายุ token + pending_purchasing_review → pending_purchasing_manager_review
// (S128 — ไม่ไป pending_supplier ตรงๆ อีกต่อไป ต้องรอ purchasing_manager อนุมัติก่อน ดู approveNcr's pending_supplier branch)
function purchasingReview({ ncr, items, actorId, actorIp }) {
  // มูลค่าสินค้าเคลม (THB/USD) บังคับกรอกทุกรายการ — "-" ถือว่ากรอกแล้ว (ไม่มีมูลค่า)
  for (const item of items) {
    if (!String(item.claim_value_thb ?? '').trim() || !String(item.claim_value_usd ?? '').trim()) {
      throw httpError('กรุณากรอกมูลค่าสินค้าเคลม (THB/USD) ให้ครบทุกรายการ — ถ้าไม่มีมูลค่าให้ใส่ "-"', 400);
    }
  }

  const review = db.transaction(() => {
    const updateItem = db.prepare('UPDATE ncr_items SET item_name_en=?, defect_detail_en=?, claim_value_thb=?, claim_value_usd=? WHERE id=? AND ncr_id=?');
    for (const item of items) {
      updateItem.run(item.item_name_en || null, item.defect_detail_en || null, item.claim_value_thb.trim(), item.claim_value_usd.trim(), item.id, ncr.id);
    }

    const expiry = new Date();
    expiry.setDate(expiry.getDate() + Number(db.getSetting('token_expiry_days') || 90));

    const changed = db.prepare(`UPDATE ncrs SET status='pending_purchasing_manager_review', token_expires_at=?,
      purchasing_received_at=datetime('now'), purchasing_received_by=?
      WHERE id=? AND status='pending_purchasing_review'`)
      .run(expiry.toISOString(), actorId, ncr.id);
    if (changed.changes === 0) throw new Error('เอกสารถูกดำเนินการแล้ว กรุณารีเฟรชหน้า');

    for (const u of getPurchasingManagerIds()) {
      createNotification(u, 'NCR รอผู้จัดการจัดซื้อตรวจสอบ', `${ncr.ncr_code} — จัดซื้อ Review เสร็จแล้ว รอผู้จัดการจัดซื้อตรวจสอบก่อนส่งลิงก์ให้ Supplier`, `/ncr/${ncr.id}`);
    }
    sendTelegram(db.getSetting('telegram_group_purchasing'),
      `${purchasingMentionsForBill(ncr.bill_id)}[IQC] ${ncr.ncr_code}\nจัดซื้อ Review เสร็จแล้ว — รอผู้จัดการจัดซื้อตรวจสอบก่อนส่งลิงก์ให้ Supplier`
    );

    db.auditLog('ncrs', ncr.id, 'PURCHASING_REVIEW', { status: 'pending_purchasing_review' }, { status: 'pending_purchasing_manager_review' }, actorId, actorIp);
  });
  review();
}

// Purchasing Manager ไม่อนุมัติ Review (pending_purchasing_manager_review → pending_purchasing_review, ให้จัดซื้อ
// Review ใหม่อีกครั้ง — S128c) ไม่ล้างค่า claim_value/EN ที่กรอกไว้แล้ว (จัดซื้อแก้ไขต่อได้ ไม่ต้องกรอกใหม่ทั้งหมด)
function rejectPurchasingManagerReview({ ncr, comment, actorId, actorIp }) {
  const reject = db.transaction(() => {
    const changed = db.prepare("UPDATE ncrs SET status='pending_purchasing_review' WHERE id=? AND status='pending_purchasing_manager_review'").run(ncr.id);
    if (changed.changes === 0) throw new Error('เอกสารถูกดำเนินการแล้ว กรุณารีเฟรชหน้า');

    db.prepare('INSERT INTO ncr_approvals (ncr_id, action, role, user_id, comment) VALUES (?, ?, ?, ?, ?)').run(ncr.id, 'rejected_purchasing_review', 'purchasing_manager', actorId, comment);

    for (const uid of purchasingTargetsForBill(ncr.bill_id)) {
      createNotification(uid, 'NCR ถูกส่งกลับให้ Review ใหม่', `${ncr.ncr_code} ผู้จัดการจัดซื้อไม่อนุมัติ — กรุณา Review ใหม่อีกครั้ง`, `/ncr/${ncr.id}`);
    }
    sendTelegram(db.getSetting('telegram_group_purchasing'),
      `${purchasingMentionsForBill(ncr.bill_id)}[IQC] ${ncr.ncr_code}\nผู้จัดการจัดซื้อไม่อนุมัติ Review\nเหตุผล: ${comment}\nกรุณา Review ใหม่อีกครั้ง`
    );
    db.auditLog('ncrs', ncr.id, 'REJECT_PURCHASING_REVIEW', { status: 'pending_purchasing_manager_review' }, { status: 'pending_purchasing_review', comment }, actorId, actorIp);
  });
  reject();
}

// ===== S166 — QMR ไม่อนุมัติเปิด NCR (pending_qmr_open → pending_manager, ย้อนกลับไปให้ QC Manager ตรวจสอบใหม่
// คนละกรณีกับ rejectToStaff/S161 ที่ QMR เคยใช้ก่อนหน้า — user ขอเปลี่ยนให้ QMR "ไม่อนุมัติ" ย้อนกลับแค่ 1 ขั้น
// ไปหา QC Manager แทนที่จะข้าม manager ไปถึง QC รับเข้าเลย) — pattern เดียวกับ rejectPurchasingManagerReview
function rejectQmrOpen({ ncr, comment, actorId, actorIp }) {
  if (ncr.status !== 'pending_qmr_open') throw httpError('ไม่อนุมัติได้เฉพาะสถานะ pending_qmr_open เท่านั้น', 400);
  if (!comment || !comment.trim()) throw httpError('กรุณาระบุเหตุผลที่ไม่อนุมัติ', 400);

  const reject = db.transaction(() => {
    const changed = db.prepare("UPDATE ncrs SET status='pending_manager' WHERE id=? AND status='pending_qmr_open'").run(ncr.id);
    if (changed.changes === 0) throw new Error('เอกสารถูกดำเนินการแล้ว กรุณารีเฟรชหน้า');

    db.prepare('INSERT INTO ncr_approvals (ncr_id, action, role, user_id, comment) VALUES (?, ?, ?, ?, ?)').run(ncr.id, 'rejected_qmr_open', 'qmr', actorId, comment);

    for (const u of getUsersByRole('qc_manager')) {
      createNotification(u.id, 'NCR ถูกส่งกลับให้ตรวจสอบใหม่', `${ncr.ncr_code} QMR ไม่อนุมัติ — กรุณาตรวจสอบใหม่อีกครั้ง: ${comment}`, `/ncr/${ncr.id}`);
    }
    sendTelegram(db.getSetting('telegram_group_qc'),
      `[IQC] ${ncr.ncr_code}\nQMR ไม่อนุมัติเปิด NCR — ส่งกลับให้ QC Manager ตรวจสอบใหม่\nเหตุผล: ${comment}`
    );

    db.auditLog('ncrs', ncr.id, 'REJECT_QMR_OPEN', { status: 'pending_qmr_open' }, { status: 'pending_manager', comment }, actorId, actorIp);
  });
  reject();
}

// QC Manager ไม่อนุมัติคำตอบ Supplier (pending_manager_review → pending_supplier_resubmit)
function rejectSupplierResponse({ ncr, comment, actorId, actorIp }) {
  const reject = db.transaction(() => {
    const changed = db.prepare("UPDATE ncrs SET status='pending_supplier_resubmit' WHERE id=? AND status='pending_manager_review'").run(ncr.id);
    if (changed.changes === 0) throw new Error('เอกสารถูกดำเนินการแล้ว กรุณารีเฟรชหน้า');

    db.prepare('INSERT INTO ncr_approvals (ncr_id, action, role, user_id, comment) VALUES (?, ?, ?, ?, ?)').run(ncr.id, 'rejected_response', 'qc_manager', actorId, comment);

    for (const uid of purchasingTargetsForBill(ncr.bill_id)) {
      createNotification(uid, 'NCR ถูกส่งกลับ', `${ncr.ncr_code} QC Manager ไม่อนุมัติคำตอบ Supplier — รอจัดซื้อดำเนินการ`, `/ncr/${ncr.id}`);
    }
    sendTelegram(db.getSetting('telegram_group_purchasing'),
      `${purchasingMentionsForBill(ncr.bill_id)}[IQC] ${ncr.ncr_code}\nQC Manager ไม่อนุมัติคำตอบ Supplier\nเหตุผล: ${comment}\nรอจัดซื้อส่ง Supplier ตอบใหม่`
    );
    db.auditLog('ncrs', ncr.id, 'REJECT_RESPONSE', { status: 'pending_manager_review' }, { status: 'pending_supplier_resubmit', comment }, actorId, actorIp);
  });
  reject();
}

// Purchasing ส่ง Supplier ตอบใหม่ (pending_supplier_resubmit → pending_supplier, supersede คำตอบเก่า)
function resubmitToSupplier({ ncr, actorId, actorIp }) {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + Number(db.getSetting('token_expiry_days') || 90));

  const resubmit = db.transaction(() => {
    // ข้าม pending_purchasing_review — ใช้ข้อมูลเดิม ไปเป็น pending_supplier ทันที
    const changed = db.prepare(`
      UPDATE ncrs SET status='pending_supplier',
        purchasing_received_at=datetime('now'), purchasing_received_by=?,
        token_expires_at=?
      WHERE id=? AND status='pending_supplier_resubmit'
    `).run(actorId, expiry.toISOString(), ncr.id);
    if (changed.changes === 0) throw new Error('เอกสารถูกดำเนินการแล้ว กรุณารีเฟรชหน้า');

    // Mark เก่าเป็น superseded เพื่อให้ Supplier ส่งใหม่ได้
    db.prepare("UPDATE supplier_responses SET superseded_at=datetime('now') WHERE ncr_id=? AND superseded_at IS NULL").run(ncr.id);

    db.prepare('INSERT INTO ncr_approvals (ncr_id, action, role, user_id, comment) VALUES (?, ?, ?, ?, ?)').run(ncr.id, 'resubmit', 'purchasing', actorId, 'ส่ง Supplier ตอบใหม่');

    const appUrl = db.getSetting('app_url') || '';
    const supplierLink = `${appUrl}/supplier/ncr/${ncr.supplier_token}`;
    for (const uid of purchasingTargetsForBill(ncr.bill_id)) {
      createNotification(uid, 'NCR พร้อมส่ง Supplier (ตอบใหม่)', `${ncr.ncr_code} — คัดลอก Link แล้วส่งให้ Supplier ตอบใหม่`, `/ncr/${ncr.id}`);
    }
    sendTelegram(db.getSetting('telegram_group_purchasing'),
      `${purchasingMentionsForBill(ncr.bill_id)}[IQC] ${ncr.ncr_code}\nส่ง Supplier ตอบใหม่ (ข้าม Review)\n\nLink:\n${supplierLink}`
    );

    db.auditLog('ncrs', ncr.id, 'RESUBMIT', { status: 'pending_supplier_resubmit' }, { status: 'pending_supplier' }, actorId, actorIp);
  });
  resubmit();
}

// ===== S161 — ส่งกลับให้ QC รับเข้าแก้ไขข้อมูล item ได้จากทุกขั้นก่อนถึง Supplier =====
// role ที่มีสิทธิ์กดส่งกลับ ต่อ status ปัจจุบัน (ตรงกับ transitions map ของ approveNcr — คนละฝั่งของ action เดียวกัน)
const STAFF_REJECT_ROLES = {
  pending_supervisor: 'qc_supervisor',
  pending_manager: 'qc_manager',
  pending_qmr_open: 'qmr',
  pending_purchasing_review: 'purchasing',
  pending_purchasing_manager_review: 'purchasing_manager',
};

// ส่งกลับ (status ปัจจุบัน → pending_staff_revision) — ไม่ล้าง disposition/qmr_opened_at ตรงนี้ (เก็บไว้ audit
// ว่าเคยไปถึงไหนมาแล้ว) ล้างจริงตอน resubmitAfterStaffRevision() แทน (ดูด้านล่าง เหตุผลเดียวกับ resubmit)
function rejectToStaff({ ncr, actorId, actorRole, actorIp, comment }) {
  const requiredRole = STAFF_REJECT_ROLES[ncr.status];
  if (!requiredRole) throw httpError(`ไม่สามารถส่งกลับจากสถานะ ${ncr.status}`, 400);
  if (requiredRole !== actorRole) throw httpError('ไม่มีสิทธิ์ส่งกลับขั้นตอนนี้', 403);
  if (!comment || !comment.trim()) throw httpError('กรุณาระบุเหตุผลที่ส่งกลับ', 400);

  const reject = db.transaction(() => {
    const changed = db.prepare("UPDATE ncrs SET status='pending_staff_revision', internal_reminder_last_sent_at=NULL WHERE id=? AND status=?").run(ncr.id, ncr.status);
    if (changed.changes === 0) throw new Error('เอกสารถูกดำเนินการแล้ว กรุณารีเฟรชหน้า');

    db.prepare('INSERT INTO ncr_approvals (ncr_id, action, role, user_id, comment) VALUES (?, ?, ?, ?, ?)').run(ncr.id, 'rejected_to_staff', actorRole, actorId, comment);

    const targets = new Set([ncr.created_by, ...getReceivingQCStaff().map(u => u.id)]);
    for (const uid of targets) {
      createNotification(uid, 'NCR ถูกส่งกลับให้แก้ไข', `${ncr.ncr_code} ถูกส่งกลับให้แก้ไขข้อมูล — ${comment}`, `/ncr/${ncr.id}`);
    }
    sendTelegram(db.getSetting('telegram_group_qc'), `[IQC] ${ncr.ncr_code}\nถูกส่งกลับให้ QC รับเข้าแก้ไขข้อมูล\nเหตุผล: ${comment}`);

    db.auditLog('ncrs', ncr.id, 'REJECT_TO_STAFF', { status: ncr.status }, { status: 'pending_staff_revision', comment }, actorId, actorIp);
  });
  reject();
}

// QC staff/supervisor แก้ไขข้อมูล item ตอนสถานะ pending_staff_revision — แก้ได้เฉพาะ defect_category_id/
// defect_detail/qty_* (ไม่แตะ item_name/bill_item_id — อ้างอิงสินค้าเดิมเสมอ กันข้อมูลไม่ตรงกับ bill ต้นทาง)
// รูปภาพใช้ endpoint เดิม (POST/DELETE /ncr/:id/images) อยู่แล้ว ไม่ต้องทำใหม่ — endpoint นั้นไม่เคย gate ด้วย
// status อยู่แล้ว (qc_staff/qc_supervisor แก้รูปได้ตลอดอายุเอกสาร)
function updateNcrItemsAsStaff({ ncr, items, actorId, actorIp }) {
  if (ncr.status !== 'pending_staff_revision') throw httpError('แก้ไขข้อมูล item ได้เฉพาะตอนสถานะ "ส่งกลับแก้ไข" เท่านั้น', 400);
  if (!items?.length) throw httpError('ไม่มีรายการให้แก้ไข', 400);

  const update = db.transaction(() => {
    const updateItem = db.prepare(`
      UPDATE ncr_items SET qty_received=?, qty_sampled=?, qty_failed=?, defect_category_id=?, defect_detail=?
      WHERE id=? AND ncr_id=?
    `);
    for (const item of items) {
      const r = updateItem.run(item.qty_received, item.qty_sampled, item.qty_failed, item.defect_category_id || null, item.defect_detail || null, item.id, ncr.id);
      if (r.changes === 0) throw httpError(`ไม่พบรายการ item id=${item.id} ใน NCR นี้`, 400);
    }
    db.auditLog('ncr_items', ncr.id, 'UPDATE', null, { items }, actorId, actorIp);
  });
  update();
}

// QC staff/supervisor ส่งกลับเข้าระบบใหม่หลังแก้ไข (pending_staff_revision → pending_supervisor) — เริ่มอนุมัติ
// ใหม่ทั้งหมดจากต้น (ตกลงกับ user แล้ว: ปลอดภัยกว่าข้ามขั้นที่เคยอนุมัติไปแล้วบนข้อมูลที่เพิ่งแก้ไข) เคลียร์
// disposition/effectiveness/qmr_opened_at ที่อาจตั้งไว้จากรอบก่อนหน้า กันข้อมูลค้างแสดงผิด (แต่ละขั้นจะตั้งค่าใหม่
// สดๆ เองตอนอนุมัติซ้ำรอบนี้ผ่าน approveNcr ปกติ)
function resubmitAfterStaffRevision({ ncr, actorId, actorRole, actorIp }) {
  const resubmit = db.transaction(() => {
    const changed = db.prepare(`
      UPDATE ncrs SET status='pending_supervisor',
        disposition=NULL, disposition_note=NULL, disposition_due_date=NULL, disposition_completed_at=NULL, disposition_by=NULL,
        effectiveness_check_date=NULL, effectiveness_result=NULL, effectiveness_note=NULL, effectiveness_checked_by=NULL, effectiveness_checked_at=NULL,
        qmr_opened_at=NULL, internal_reminder_last_sent_at=NULL
      WHERE id=? AND status='pending_staff_revision'
    `).run(ncr.id);
    if (changed.changes === 0) throw new Error('เอกสารถูกดำเนินการแล้ว กรุณารีเฟรชหน้า');

    db.prepare('INSERT INTO ncr_approvals (ncr_id, action, role, user_id, comment) VALUES (?, ?, ?, ?, ?)').run(ncr.id, 'staff_resubmit', actorRole, actorId, null);

    for (const sv of getUsersByRole('qc_supervisor')) {
      createNotification(sv.id, 'NCR แก้ไขแล้ว รออนุมัติใหม่', `${ncr.ncr_code} QC รับเข้าแก้ไขข้อมูลแล้ว รออนุมัติจาก QC Supervisor อีกครั้ง`, `/ncr/${ncr.id}`);
    }
    sendTelegram(db.getSetting('telegram_group_qc'), `[IQC] ${ncr.ncr_code}\nQC รับเข้าแก้ไขข้อมูลแล้ว — รออนุมัติใหม่ตั้งแต่ QC Supervisor`);

    db.auditLog('ncrs', ncr.id, 'STAFF_RESUBMIT', { status: 'pending_staff_revision' }, { status: 'pending_supervisor' }, actorId, actorIp);
  });
  resubmit();
}

// ===== S162 — ยกเลิก NCR ทั้งฉบับตอนสถานะ pending_staff_revision (คนละกรณีกับ DELETE /:id เดิมที่ hard-delete
// เฉพาะ pending_supervisor+ผู้สร้างเท่านั้น ไม่ใช้ route นั้นตรงนี้เพราะ semantics/permission ต่างกัน) — ใช้เมื่อ
// เอกสารทั้งฉบับผิดตั้งแต่ต้น (เช่น ออกจากรหัสสินค้าผิด) ต้องเริ่มใหม่ทั้งฉบับ ไม่ใช่แค่แก้ไขข้อมูล item
function cancelNcrFromStaffRevision({ ncr, actorId, actorRole, actorIp, comment }) {
  if (ncr.status !== 'pending_staff_revision') throw httpError('ยกเลิกได้เฉพาะสถานะ "ส่งกลับแก้ไข" เท่านั้น', 400);
  if (!comment || !comment.trim()) throw httpError('กรุณาระบุเหตุผลที่ยกเลิก', 400);

  const cancel = db.transaction(() => {
    const changed = db.prepare(
      "UPDATE ncrs SET status='cancelled', cancelled_at=datetime('now'), cancelled_by=? WHERE id=? AND status='pending_staff_revision'"
    ).run(actorId, ncr.id);
    if (changed.changes === 0) throw new Error('เอกสารถูกดำเนินการแล้ว กรุณารีเฟรชหน้า');

    db.prepare('INSERT INTO ncr_approvals (ncr_id, action, role, user_id, comment) VALUES (?, ?, ?, ?, ?)').run(ncr.id, 'cancelled_staff_revision', actorRole, actorId, comment);

    const targets = new Set([ncr.created_by, ...getUsersByRole('qc_supervisor').map(u => u.id)]);
    for (const uid of targets) {
      createNotification(uid, 'NCR ถูกยกเลิก', `${ncr.ncr_code} ถูกยกเลิกระหว่างขั้นตอนแก้ไขข้อมูล — ${comment}`, `/ncr/${ncr.id}`);
    }
    sendTelegram(db.getSetting('telegram_group_qc'), `[IQC] ${ncr.ncr_code}\nถูกยกเลิกระหว่างขั้นตอนแก้ไขข้อมูล QC\nเหตุผล: ${comment}`);

    db.auditLog('ncrs', ncr.id, 'CANCEL', { status: 'pending_staff_revision' }, { status: 'cancelled', comment }, actorId, actorIp);
  });
  cancel();
}

// ===== S162 — แก้ไขรหัสสินค้า (product_id) ของ bill_item ที่ผูกกับ item นี้ ตอนสถานะ pending_staff_revision
// เท่านั้น (จงใจไม่ใช่ "แก้ไขบิลที่อนุมัติแล้ว" แบบทั่วไป — ผูกกับ workflow นี้เพื่อจำกัดขอบเขต/ความเสี่ยงตาม
// แนวทาง compliance ของระบบ) แก้ทั้ง bill_items (ต้นทาง, มีผลกับทุก NCR ในอนาคตที่อ้าง bill_item นี้) และ
// ncr_items.item_name (สำเนาที่ denormalize ไว้ ต้องอัปเดตพร้อมกันไม่งั้นจะไม่ตรงกันทันที) ในธุรกรรมเดียว —
// แยก function ต่างหากจาก updateNcrItemsAsStaff โดยตั้งใจ (คนละความเสี่ยง/audit trail คนละเรื่อง)
function correctNcrItemProduct({ ncr, ncrItemId, newProductId, actorId, actorIp }) {
  if (ncr.status !== 'pending_staff_revision') throw httpError('แก้ไขรหัสสินค้าได้เฉพาะตอนสถานะ "ส่งกลับแก้ไข" เท่านั้น', 400);
  if (!newProductId) throw httpError('กรุณาเลือกสินค้า', 400);

  const item = db.prepare('SELECT * FROM ncr_items WHERE id = ? AND ncr_id = ?').get(ncrItemId, ncr.id);
  if (!item) throw httpError('ไม่พบรายการ item นี้ใน NCR', 400);
  if (!item.bill_item_id) throw httpError('รายการนี้ไม่ได้ผูกกับ bill_item (สร้างแบบไม่อ้างอิงบิล) แก้ไขรหัสสินค้าไม่ได้', 400);

  const product = db.prepare('SELECT id, name FROM products WHERE id = ?').get(newProductId);
  if (!product) throw httpError('ไม่พบสินค้าที่เลือก', 400);

  const correct = db.transaction(() => {
    const before = db.prepare('SELECT product_id, item_name FROM bill_items WHERE id = ?').get(item.bill_item_id);

    db.prepare('UPDATE bill_items SET product_id=?, item_name=? WHERE id=?').run(product.id, product.name, item.bill_item_id);
    db.prepare('UPDATE ncr_items SET item_name=? WHERE id=?').run(product.name, item.id);

    db.auditLog('bill_items', item.bill_item_id, 'CORRECT_PRODUCT', before, { product_id: product.id, item_name: product.name }, actorId, actorIp);
    db.auditLog('ncr_items', item.id, 'UPDATE', { item_name: item.item_name }, { item_name: product.name }, actorId, actorIp);
  });
  correct();
  return { product_id: product.id, product_name: product.name };
}

module.exports = {
  createNcr, approveNcr, requestUai, purchasingReview, rejectPurchasingManagerReview, rejectSupplierResponse, resubmitToSupplier, getFullNcrItems,
  rejectToStaff, updateNcrItemsAsStaff, resubmitAfterStaffRevision, STAFF_REJECT_ROLES,
  cancelNcrFromStaffRevision, correctNcrItemProduct, rejectQmrOpen,
};
