// ===== UAI domain service (สกัดจาก routes/uai.js — CLAUDE.md §2.2/§8) =====
// business transaction ของ UAI (review + sign) + status sequence/role map (single source)
const db = require('../db/database');
const { getUsersByRole, createNotification, sendTelegram } = require('../lib/notify');
const { resolveNotifyTargetIds } = require('../lib/purchasingScope');

// user id ที่ควรแจ้งเตือนแทน "จัดซื้อทุกคน" — เฉพาะผู้ดูแลจัดซื้อของ Supplier เจ้าของ NCR ที่ UAI นี้อ้างอิงอยู่
function purchasingTargetsForNcr(ncrId) {
  const row = db.prepare(`
    SELECT b.supplier_id FROM ncrs n LEFT JOIN bills b ON b.id = n.bill_id WHERE n.id = ?
  `).get(ncrId);
  return resolveNotifyTargetIds(row ? row.supplier_id : null);
}

// S169 — magic link ดูรายละเอียด UAI แบบไม่ต้อง login อายุ 24 ชม./token (token ใหม่ทุกครั้ง ไม่ reuse ของเก่า
// แม้ยังไม่หมดอายุ — ง่ายกว่า และแต่ละ token อายุสั้นพออยู่แล้วไม่ต้องกังวลตารางบวม)
function createUaiViewToken(uaiId) {
  const token = db.generateSecureToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO uai_view_tokens (uai_id, token, expires_at) VALUES (?, ?, ?)').run(uaiId, token, expiresAt);
  return token;
}

// S168/S169/S170 — ส่ง Telegram DM แยกต่างหาก (นอกเหนือจาก createNotification ปกติ) ให้คนที่ถึงคิวเซ็นขั้นถัดไป —
// แนบลิงก์ดูรายละเอียดแบบไม่ต้อง login เสมอ (ไม่ผูกกับการเปิดใช้ webhook — อยากให้ดูได้แม้ปิดปุ่มอนุมัติผ่าน
// Telegram อยู่) ส่วนปุ่ม inline "อนุมัติ"/"ไม่อนุมัติ" แนบเพิ่มเฉพาะตอน telegram_webhook_enabled='1' เท่านั้น
// (กันโชว์ปุ่มที่กดแล้วไม่มีอะไรรับ callback) — ไม่ส่งอะไรเลยถ้า user คนนั้นไม่ได้ตั้ง telegram_chat_id ไว้
// allowReject: true เฉพาะขั้น COO/CMO/CPO เท่านั้น (มีแค่ 3 role นี้ที่ปฏิเสธ UAI เองได้ในเว็บ — ดู reject-exec/
// canRejectExec ใน routes/uai.js's client — ขั้นอื่น (purchasing/qc_ack/production_ack/qmr_ack) ไม่มีปุ่ม
// "ไม่อนุมัติ" ในเว็บเลยเช่นกัน จึงไม่โชว์ใน Telegram ด้วยเพื่อให้พฤติกรรมตรงกัน)
function notifySignerTelegramButton(userId, uai, label, { allowReject = false } = {}) {
  const row = db.prepare('SELECT telegram_chat_id FROM users WHERE id = ?').get(userId);
  const chatId = row?.telegram_chat_id ? String(row.telegram_chat_id).trim() : '';
  if (!chatId) return;

  const token = createUaiViewToken(uai.id);
  const appUrl = (db.getSetting('app_url') || '').replace(/\/+$/, '');
  let text = `${uai.uai_code} — ${label}`;
  if (appUrl) text += `\n\nดูรายละเอียด (ไม่ต้อง login, ใช้ได้ 24 ชม.):\n${appUrl}/uai/view/${token}`;

  const extra = {};
  if (db.getSetting('telegram_webhook_enabled') === '1') {
    text += `\n\nหรือกดปุ่มด้านล่างเพื่อดำเนินการทันทีผ่าน Telegram (ไม่ต้องเข้าเว็บ)`;
    const buttons = [{ text: '✅ อนุมัติ', callback_data: `uai_sign:${uai.id}` }];
    if (allowReject) buttons.push({ text: '❌ ไม่อนุมัติ', callback_data: `uai_reject:${uai.id}` });
    extra.reply_markup = { inline_keyboard: [buttons] };
  }
  sendTelegram(chatId, text, extra);
}

const UAI_STATUS_SEQUENCE = [
  'uai_pending_qc_manager',
  'uai_pending_purchasing',
  'uai_pending_cco',
  'uai_pending_cmo',
  'uai_pending_cpo',
  'uai_pending_qc_ack',
  'uai_pending_production_ack',
  'uai_pending_qmr_ack',
  'uai_completed',
];

const SIGN_ROLE_MAP = {
  uai_pending_purchasing: 'purchasing',
  uai_pending_cco: 'cco',
  uai_pending_cmo: 'cmo',
  uai_pending_cpo: 'cpo',
  uai_pending_qc_ack: 'qc_manager',
  uai_pending_production_ack: 'production_manager',
  uai_pending_qmr_ack: 'qmr',
};

// QC Manager ตรวจสอบ UAI (approve/reject) — คืน nextStatus (throw ถ้า lock fail)
function reviewUai({ uai, actorId, actorIp, isApproved, reviewComment }) {
  const review = db.transaction(() => {
    // DEVMORE H7 — optimistic lock กันกดซ้อน
    const lock = db.prepare("UPDATE uai_documents SET status=status WHERE id=? AND status='uai_pending_qc_manager'").run(uai.id);
    if (lock.changes === 0) throw new Error('เอกสารถูกดำเนินการแล้ว กรุณารีเฟรชหน้า');
    if (!isApproved) {
      db.prepare("UPDATE uai_documents SET status='uai_rejected' WHERE id=?").run(uai.id);
      db.prepare("UPDATE ncrs SET status='pending_supplier', uai_close_remark=NULL WHERE id=?").run(uai.ncr_id);
      db.prepare('INSERT INTO uai_signatures (uai_id, role, user_id, signature_image, action, comment) VALUES (?, ?, ?, ?, ?, ?)')
        .run(uai.id, 'qc_manager', actorId, '', 'review_rejected', reviewComment);
      for (const uid of purchasingTargetsForNcr(uai.ncr_id)) {
        createNotification(uid, 'UAI ไม่อนุมัติ', `${uai.uai_code} ถูกปฏิเสธ${reviewComment ? ': ' + reviewComment : ''}`, `/uai/${uai.id}`);
      }
      sendTelegram(db.getSetting('telegram_group_purchasing'), `${uai.uai_code} — QC Manager ไม่อนุมัติ UAI${reviewComment ? '\nเหตุผล: ' + reviewComment : ''}`);
      db.auditLog('uai_documents', uai.id, 'REJECT', { status: uai.status }, { status: 'uai_rejected' }, actorId, actorIp);
      return 'uai_rejected';
    }

    db.prepare("UPDATE uai_documents SET status='uai_pending_purchasing' WHERE id=?").run(uai.id);
    db.prepare('INSERT INTO uai_signatures (uai_id, role, user_id, signature_image, action, comment) VALUES (?, ?, ?, ?, ?, ?)')
      .run(uai.id, 'qc_manager', actorId, '', 'review_approved', reviewComment);

    for (const uid of purchasingTargetsForNcr(uai.ncr_id)) {
      createNotification(uid, 'UAI อนุมัติ รอลงนาม', `${uai.uai_code} ผ่านการตรวจสอบแล้ว รอจัดซื้อลงนาม`, `/uai/${uai.id}`);
      notifySignerTelegramButton(uid, uai, 'ผ่านการตรวจสอบแล้ว รอจัดซื้อลงนาม');
    }
    sendTelegram(db.getSetting('telegram_group_purchasing'), `${uai.uai_code} — QC Manager อนุมัติ\nรอจัดซื้อลงนาม UAI`);
    db.auditLog('uai_documents', uai.id, 'APPROVE', { status: uai.status }, { status: 'uai_pending_purchasing' }, actorId, actorIp);
    return 'uai_pending_purchasing';
  });
  return review();
}

// ลงนาม UAI 1 ขั้น (sigFile = filename ที่ controller เซฟไว้แล้ว) — คืน nextStatus
// signatureMethod (S168): 'signature' (วาดจริง, ค่าเดิม) | 'approve_button' (กดอนุมัติในเว็บ) | 'telegram'
// (กดผ่านปุ่ม inline ใน Telegram) — ทั้ง 3 แบบ sigFile ต้องมีค่าเสมอ (approve_button/telegram = ไฟล์ตราประทับ
// ที่ generateStampImage สร้างไว้แล้วโดย caller) เพราะ signature_image ยังเป็น NOT NULL เหมือนเดิม
function signUai({ uai, actorId, actorRole, actorIp, sigFile, action, comment, signatureMethod = 'signature' }) {
  const sign = db.transaction(() => {
    const currentIndex = UAI_STATUS_SEQUENCE.indexOf(uai.status);
    const nextStatus = UAI_STATUS_SEQUENCE[currentIndex + 1];

    const changed = db.prepare('UPDATE uai_documents SET status=? WHERE id=? AND status=?').run(nextStatus, uai.id, uai.status);
    if (changed.changes === 0) throw new Error('เอกสารถูกดำเนินการแล้ว กรุณารีเฟรชหน้า');

    db.prepare('INSERT INTO uai_signatures (uai_id, role, user_id, signature_image, action, comment, signature_method) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(uai.id, actorRole, actorId, sigFile, action, comment || null, signatureMethod);

    db.auditLog('uai_documents', uai.id, 'SIGN', { status: uai.status }, { status: nextStatus, role: actorRole, signatureMethod }, actorId, actorIp);

    // Per-step notifications
    if (nextStatus === 'uai_pending_cco') {
      for (const u of getUsersByRole('cco')) {
        createNotification(u.id, 'UAI รอลงนาม COO', `${uai.uai_code} รอ COO ลงนาม`, `/uai/${uai.id}`);
        notifySignerTelegramButton(u.id, uai, 'รอ COO ลงนาม', { allowReject: true });
      }
    } else if (nextStatus === 'uai_pending_cmo') {
      for (const u of getUsersByRole('cmo')) {
        createNotification(u.id, 'UAI รอลงนาม CMO', `${uai.uai_code} รอ CMO ลงนาม`, `/uai/${uai.id}`);
        notifySignerTelegramButton(u.id, uai, 'รอ CMO ลงนาม', { allowReject: true });
      }
    } else if (nextStatus === 'uai_pending_cpo') {
      for (const u of getUsersByRole('cpo')) {
        createNotification(u.id, 'UAI รอลงนาม CPO', `${uai.uai_code} รอ CPO ลงนาม`, `/uai/${uai.id}`);
        notifySignerTelegramButton(u.id, uai, 'รอ CPO ลงนาม', { allowReject: true });
      }
    } else if (nextStatus === 'uai_pending_qc_ack') {
      for (const u of getUsersByRole('qc_manager')) {
        createNotification(u.id, 'UAI รอรับทราบ QC', `${uai.uai_code} ผู้บริหารลงนามแล้ว รอ QC รับทราบ`, `/uai/${uai.id}`);
        notifySignerTelegramButton(u.id, uai, 'ผู้บริหารลงนามแล้ว รอ QC รับทราบ');
      }
      sendTelegram(db.getSetting('telegram_group_qc'), `${uai.uai_code} — ผู้บริหารลงนามแล้ว รอ QC Manager รับทราบ`);
    } else if (nextStatus === 'uai_pending_production_ack') {
      for (const u of getUsersByRole('production_manager')) {
        createNotification(u.id, 'UAI รอรับทราบ ผลิต', `${uai.uai_code} รอผู้จัดการผลิตรับทราบ`, `/uai/${uai.id}`);
        notifySignerTelegramButton(u.id, uai, 'รอผู้จัดการผลิตรับทราบ');
      }
    } else if (nextStatus === 'uai_pending_qmr_ack') {
      for (const u of getUsersByRole('qmr')) {
        createNotification(u.id, 'UAI รอรับทราบ QMR', `${uai.uai_code} รอ QMR รับทราบ`, `/uai/${uai.id}`);
        notifySignerTelegramButton(u.id, uai, 'รอ QMR รับทราบ');
      }
    } else if (nextStatus === 'uai_completed') {
      // ปิด NCR พร้อม stamp อ้างอิง UAI เมื่อ UAI ครบทุกขั้นตอน
      const ncr = db.prepare('SELECT ncr_code FROM ncrs WHERE id=?').get(uai.ncr_id);
      const closeRemark = `ยอมรับใช้พิเศษ — อ้างอิงเลข UAI: ${uai.uai_code}`;
      db.prepare("UPDATE ncrs SET status='closed', uai_close_remark=? WHERE id=?")
        .run(closeRemark, uai.ncr_id);
      db.auditLog('ncrs', uai.ncr_id, 'CLOSE', { status: 'pending_uai' }, { status: 'closed', uai_close_remark: closeRemark }, actorId, actorIp);

      for (const u of getUsersByRole('qc_manager', 'qmr')) {
        createNotification(u.id, 'UAI เสร็จสมบูรณ์ — NCR ปิดแล้ว', `${uai.uai_code} ปิดครบทุกขั้นตอน — NCR ${ncr?.ncr_code} ปิดแล้ว`, `/uai/${uai.id}`);
      }
      for (const uid of purchasingTargetsForNcr(uai.ncr_id)) {
        createNotification(uid, 'UAI เสร็จสมบูรณ์ — NCR ปิดแล้ว', `${uai.uai_code} ปิดครบทุกขั้นตอน — NCR ${ncr?.ncr_code} ปิดแล้ว`, `/uai/${uai.id}`);
      }
      sendTelegram(db.getSetting('telegram_group_qc'), `${uai.uai_code} — UAI เสร็จสมบูรณ์\nNCR ${ncr?.ncr_code} ปิดแล้ว (ยอมรับใช้พิเศษ)`);
      sendTelegram(db.getSetting('telegram_group_purchasing'), `${uai.uai_code} — UAI เสร็จสมบูรณ์\nNCR ${ncr?.ncr_code} ปิดแล้ว (ยอมรับใช้พิเศษ)`);
    }

    return nextStatus;
  });
  return sign();
}

// COO/CMO/CPO ปฏิเสธ UAI (→ uai_rejected_by_exec, NCR กลับ pending_supplier)
function rejectExec({ uai, reason, actorId, actorRole, actorIp }) {
  const ncr = db.prepare('SELECT ncr_code FROM ncrs WHERE id=?').get(uai.ncr_id);
  const rejectorLabel = { cco: 'COO', cmo: 'CMO', cpo: 'CPO' }[actorRole] || actorRole;

  const reject = db.transaction(() => {
    // DEVMORE H7 — optimistic lock: เปลี่ยนสถานะเฉพาะเมื่อยังอยู่ในคิวของผู้ปฏิเสธ
    const locked = db.prepare("UPDATE uai_documents SET status='uai_rejected_by_exec' WHERE id=? AND status=?").run(uai.id, uai.status);
    if (locked.changes === 0) throw new Error('เอกสารถูกดำเนินการแล้ว กรุณารีเฟรชหน้า');
    db.prepare('INSERT INTO uai_signatures (uai_id, role, user_id, signature_image, action, comment) VALUES (?, ?, ?, ?, ?, ?)')
      .run(uai.id, actorRole, actorId, '', 'rejected', reason);

    // คืนสถานะ NCR กลับไปรอผู้ผลิตตอบกลับ
    db.prepare("UPDATE ncrs SET status='pending_supplier', uai_close_remark=NULL WHERE id=?").run(uai.ncr_id);

    const msg = `${uai.uai_code} — ${rejectorLabel} ไม่อนุมัติ\nNCR ${ncr?.ncr_code} กลับสู่สถานะรอผู้ผลิตตอบ\nเหตุผล: ${reason}`;
    for (const u of getUsersByRole('qc_manager', 'qmr')) {
      createNotification(u.id, `UAI ไม่อนุมัติโดย ${rejectorLabel}`, `${uai.uai_code} — ${reason}`, `/uai/${uai.id}`);
    }
    for (const uid of purchasingTargetsForNcr(uai.ncr_id)) {
      createNotification(uid, `UAI ไม่อนุมัติโดย ${rejectorLabel}`, `${uai.uai_code} — ${reason}`, `/uai/${uai.id}`);
    }
    sendTelegram(db.getSetting('telegram_group_qc'), `${msg}`);
    sendTelegram(db.getSetting('telegram_group_purchasing'), `${msg}`);

    db.auditLog('uai_documents', uai.id, 'REJECT_EXEC', { status: uai.status }, { status: 'uai_rejected_by_exec', reason }, actorId, actorIp);
    db.auditLog('ncrs', uai.ncr_id, 'REOPEN', { status: 'pending_uai' }, { status: 'pending_supplier', note: `UAI ${uai.uai_code} ถูกปฏิเสธโดย ${rejectorLabel}` }, actorId, actorIp);
  });
  reject();
}

module.exports = { UAI_STATUS_SEQUENCE, SIGN_ROLE_MAP, reviewUai, signUai, rejectExec };
