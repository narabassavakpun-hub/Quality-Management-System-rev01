// ===== NCR domain service (สกัดจาก routes/ncr.js — CLAUDE.md §2.2/§8) =====
// รวม business transaction ของ NCR ไว้ที่เดียว — route handler เหลือแค่ validate + response
// throw error พร้อม .status เพื่อให้ controller map เป็น HTTP status ที่ถูกต้อง
const db = require('../db/database');
const { getUsersByRole, getReceivingQCStaff, createNotification, sendTelegram } = require('../lib/notify');

function httpError(message, status) { const e = new Error(message); e.status = status; return e; }

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
    const changed = isClosing
      ? db.prepare("UPDATE ncrs SET status=?, closed_at=datetime('now') WHERE id=? AND status=?").run(t.next, ncr.id, status)
      : db.prepare('UPDATE ncrs SET status=? WHERE id=? AND status=?').run(t.next, ncr.id, status);
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
      for (const u of getUsersByRole('purchasing')) createNotification(u.id, 'NCR รอ Review จัดซื้อ', `${ncr.ncr_code} QMR อนุมัติแล้ว รอจัดซื้อ Review + แปลภาษาก่อนส่ง Supplier`, `/ncr/${ncr.id}`);
      sendTelegram(db.getSetting('telegram_group_qc'), `[IQC] ${ncr.ncr_code} QMR อนุมัติเปิด NCR แล้ว`);
      sendTelegram(db.getSetting('telegram_group_purchasing'),
        `[IQC] ${ncr.ncr_code}\nQMR อนุมัติเปิดแล้ว — กรุณา Review NCR และแปลภาษาอังกฤษก่อนส่ง Link ให้ Supplier`
      );
    } else if (t.next === 'pending_qmr_close') {
      for (const u of getUsersByRole('qmr')) createNotification(u.id, 'NCR รอ QMR ปิด', `${ncr.ncr_code} QC Manager ลงชื่อแล้ว`, `/ncr/${ncr.id}`);
      sendTelegram(db.getSetting('telegram_group_qc'), `[IQC] ${ncr.ncr_code} QC Manager ตรวจสอบคำตอบแล้ว — รอ QMR ปิด NCR`);
    } else if (t.next === 'closed') {
      createNotification(ncr.created_by, 'NCR ปิดแล้ว', `${ncr.ncr_code} QMR ปิดเอกสารแล้ว`, `/ncr/${ncr.id}`);
      for (const u of getUsersByRole('qc_supervisor')) createNotification(u.id, 'NCR ปิดแล้ว', `${ncr.ncr_code} QMR ปิดเอกสารแล้ว`, `/ncr/${ncr.id}`);
      for (const u of getUsersByRole('qc_manager')) createNotification(u.id, 'NCR ปิดแล้ว', `${ncr.ncr_code} QMR ปิดเอกสารแล้ว`, `/ncr/${ncr.id}`);
      for (const u of getUsersByRole('purchasing')) createNotification(u.id, 'NCR ปิดแล้ว', `${ncr.ncr_code} QMR ปิดเอกสารแล้ว`, `/ncr/${ncr.id}`);
      sendTelegram(db.getSetting('telegram_group_qc'), `[IQC] ${ncr.ncr_code} ปิดแล้ว`);
      sendTelegram(db.getSetting('telegram_group_purchasing'), `[IQC] ${ncr.ncr_code} ปิดแล้ว`);
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

// Purchasing Review — บันทึกคำแปล EN + ต่ออายุ token + pending_purchasing_review → pending_supplier
function purchasingReview({ ncr, items, actorId, actorIp }) {
  const review = db.transaction(() => {
    const updateItem = db.prepare('UPDATE ncr_items SET item_name_en=?, defect_detail_en=? WHERE id=? AND ncr_id=?');
    for (const item of items) {
      updateItem.run(item.item_name_en || null, item.defect_detail_en || null, item.id, ncr.id);
    }

    const expiry = new Date();
    expiry.setDate(expiry.getDate() + Number(db.getSetting('token_expiry_days') || 90));

    const changed = db.prepare(`UPDATE ncrs SET status='pending_supplier', token_expires_at=?,
      purchasing_received_at=datetime('now'), purchasing_received_by=?
      WHERE id=? AND status='pending_purchasing_review'`)
      .run(expiry.toISOString(), actorId, ncr.id);
    if (changed.changes === 0) throw new Error('เอกสารถูกดำเนินการแล้ว กรุณารีเฟรชหน้า');

    const appUrl = db.getSetting('app_url') || '';
    const supplierLink = `${appUrl}/supplier/ncr/${ncr.supplier_token}`;
    for (const u of getUsersByRole('purchasing')) {
      createNotification(u.id, 'NCR พร้อมส่ง Supplier', `${ncr.ncr_code} — คัดลอก Link แล้วส่งให้ Supplier`, `/ncr/${ncr.id}`);
    }
    sendTelegram(db.getSetting('telegram_group_purchasing'),
      `[IQC] ${ncr.ncr_code}\nReview เสร็จแล้ว — พร้อมส่ง Supplier\n\nLink:\n${supplierLink}`
    );

    db.auditLog('ncrs', ncr.id, 'PURCHASING_REVIEW', { status: 'pending_purchasing_review' }, { status: 'pending_supplier' }, actorId, actorIp);
  });
  review();
}

// QC Manager ไม่อนุมัติคำตอบ Supplier (pending_manager_review → pending_supplier_resubmit)
function rejectSupplierResponse({ ncr, comment, actorId, actorIp }) {
  const reject = db.transaction(() => {
    const changed = db.prepare("UPDATE ncrs SET status='pending_supplier_resubmit' WHERE id=? AND status='pending_manager_review'").run(ncr.id);
    if (changed.changes === 0) throw new Error('เอกสารถูกดำเนินการแล้ว กรุณารีเฟรชหน้า');

    db.prepare('INSERT INTO ncr_approvals (ncr_id, action, role, user_id, comment) VALUES (?, ?, ?, ?, ?)').run(ncr.id, 'rejected_response', 'qc_manager', actorId, comment);

    for (const u of getUsersByRole('purchasing')) {
      createNotification(u.id, 'NCR ถูกส่งกลับ', `${ncr.ncr_code} QC Manager ไม่อนุมัติคำตอบ Supplier — รอจัดซื้อดำเนินการ`, `/ncr/${ncr.id}`);
    }
    sendTelegram(db.getSetting('telegram_group_purchasing'),
      `[IQC] ${ncr.ncr_code}\nQC Manager ไม่อนุมัติคำตอบ Supplier\nเหตุผล: ${comment}\nรอจัดซื้อส่ง Supplier ตอบใหม่`
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
    for (const u of getUsersByRole('purchasing')) {
      createNotification(u.id, 'NCR พร้อมส่ง Supplier (ตอบใหม่)', `${ncr.ncr_code} — คัดลอก Link แล้วส่งให้ Supplier ตอบใหม่`, `/ncr/${ncr.id}`);
    }
    sendTelegram(db.getSetting('telegram_group_purchasing'),
      `[IQC] ${ncr.ncr_code}\nส่ง Supplier ตอบใหม่ (ข้าม Review)\n\nLink:\n${supplierLink}`
    );

    db.auditLog('ncrs', ncr.id, 'RESUBMIT', { status: 'pending_supplier_resubmit' }, { status: 'pending_supplier' }, actorId, actorIp);
  });
  resubmit();
}

module.exports = { createNcr, approveNcr, requestUai, purchasingReview, rejectSupplierResponse, resubmitToSupplier };
