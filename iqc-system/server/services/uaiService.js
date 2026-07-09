// ===== UAI domain service (สกัดจาก routes/uai.js — CLAUDE.md §2.2/§8) =====
// business transaction ของ UAI (review + sign) + status sequence/role map (single source)
const db = require('../db/database');
const { getUsersByRole, createNotification, sendTelegram } = require('../lib/notify');

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
      for (const u of getUsersByRole('purchasing')) {
        createNotification(u.id, 'UAI ไม่อนุมัติ', `${uai.uai_code} ถูกปฏิเสธ${reviewComment ? ': ' + reviewComment : ''}`, `/uai/${uai.id}`);
      }
      sendTelegram(db.getSetting('telegram_group_purchasing'), `[IQC] ${uai.uai_code} — QC Manager ไม่อนุมัติ UAI${reviewComment ? '\nเหตุผล: ' + reviewComment : ''}`);
      db.auditLog('uai_documents', uai.id, 'REJECT', { status: uai.status }, { status: 'uai_rejected' }, actorId, actorIp);
      return 'uai_rejected';
    }

    db.prepare("UPDATE uai_documents SET status='uai_pending_purchasing' WHERE id=?").run(uai.id);
    db.prepare('INSERT INTO uai_signatures (uai_id, role, user_id, signature_image, action, comment) VALUES (?, ?, ?, ?, ?, ?)')
      .run(uai.id, 'qc_manager', actorId, '', 'review_approved', reviewComment);

    for (const u of getUsersByRole('purchasing')) {
      createNotification(u.id, 'UAI อนุมัติ รอลงนาม', `${uai.uai_code} ผ่านการตรวจสอบแล้ว รอจัดซื้อลงนาม`, `/uai/${uai.id}`);
    }
    sendTelegram(db.getSetting('telegram_group_purchasing'), `[IQC] ${uai.uai_code} — QC Manager อนุมัติ\nรอจัดซื้อลงนาม UAI`);
    db.auditLog('uai_documents', uai.id, 'APPROVE', { status: uai.status }, { status: 'uai_pending_purchasing' }, actorId, actorIp);
    return 'uai_pending_purchasing';
  });
  return review();
}

// ลงนาม UAI 1 ขั้น (sigFile = filename ที่ controller เซฟไว้แล้ว) — คืน nextStatus
function signUai({ uai, actorId, actorRole, actorIp, sigFile, action, comment }) {
  const sign = db.transaction(() => {
    const currentIndex = UAI_STATUS_SEQUENCE.indexOf(uai.status);
    const nextStatus = UAI_STATUS_SEQUENCE[currentIndex + 1];

    const changed = db.prepare('UPDATE uai_documents SET status=? WHERE id=? AND status=?').run(nextStatus, uai.id, uai.status);
    if (changed.changes === 0) throw new Error('เอกสารถูกดำเนินการแล้ว กรุณารีเฟรชหน้า');

    db.prepare('INSERT INTO uai_signatures (uai_id, role, user_id, signature_image, action, comment) VALUES (?, ?, ?, ?, ?, ?)')
      .run(uai.id, actorRole, actorId, sigFile, action, comment || null);

    db.auditLog('uai_documents', uai.id, 'SIGN', { status: uai.status }, { status: nextStatus, role: actorRole }, actorId, actorIp);

    // Per-step notifications
    if (nextStatus === 'uai_pending_cco') {
      for (const u of getUsersByRole('cco')) createNotification(u.id, 'UAI รอลงนาม CCO', `${uai.uai_code} รอ CCO ลงนาม`, `/uai/${uai.id}`);
    } else if (nextStatus === 'uai_pending_cmo') {
      for (const u of getUsersByRole('cmo')) createNotification(u.id, 'UAI รอลงนาม CMO', `${uai.uai_code} รอ CMO ลงนาม`, `/uai/${uai.id}`);
    } else if (nextStatus === 'uai_pending_cpo') {
      for (const u of getUsersByRole('cpo')) createNotification(u.id, 'UAI รอลงนาม CPO', `${uai.uai_code} รอ CPO ลงนาม`, `/uai/${uai.id}`);
    } else if (nextStatus === 'uai_pending_qc_ack') {
      for (const u of getUsersByRole('qc_manager')) createNotification(u.id, 'UAI รอรับทราบ QC', `${uai.uai_code} ผู้บริหารลงนามแล้ว รอ QC รับทราบ`, `/uai/${uai.id}`);
      sendTelegram(db.getSetting('telegram_group_qc'), `[IQC] ${uai.uai_code} — ผู้บริหารลงนามแล้ว รอ QC Manager รับทราบ`);
    } else if (nextStatus === 'uai_pending_production_ack') {
      for (const u of getUsersByRole('production_manager')) createNotification(u.id, 'UAI รอรับทราบ ผลิต', `${uai.uai_code} รอผู้จัดการผลิตรับทราบ`, `/uai/${uai.id}`);
    } else if (nextStatus === 'uai_pending_qmr_ack') {
      for (const u of getUsersByRole('qmr')) createNotification(u.id, 'UAI รอรับทราบ QMR', `${uai.uai_code} รอ QMR รับทราบ`, `/uai/${uai.id}`);
    } else if (nextStatus === 'uai_completed') {
      // ปิด NCR พร้อม stamp อ้างอิง UAI เมื่อ UAI ครบทุกขั้นตอน
      const ncr = db.prepare('SELECT ncr_code FROM ncrs WHERE id=?').get(uai.ncr_id);
      const closeRemark = `ยอมรับใช้พิเศษ — อ้างอิงเลข UAI: ${uai.uai_code}`;
      db.prepare("UPDATE ncrs SET status='closed', uai_close_remark=? WHERE id=?")
        .run(closeRemark, uai.ncr_id);
      db.auditLog('ncrs', uai.ncr_id, 'CLOSE', { status: 'pending_uai' }, { status: 'closed', uai_close_remark: closeRemark }, actorId, actorIp);

      for (const u of getUsersByRole('purchasing', 'qc_manager', 'qmr')) {
        createNotification(u.id, 'UAI เสร็จสมบูรณ์ — NCR ปิดแล้ว', `${uai.uai_code} ปิดครบทุกขั้นตอน — NCR ${ncr?.ncr_code} ปิดแล้ว`, `/uai/${uai.id}`);
      }
      sendTelegram(db.getSetting('telegram_group_qc'), `[IQC] ${uai.uai_code} — UAI เสร็จสมบูรณ์\nNCR ${ncr?.ncr_code} ปิดแล้ว (ยอมรับใช้พิเศษ)`);
      sendTelegram(db.getSetting('telegram_group_purchasing'), `[IQC] ${uai.uai_code} — UAI เสร็จสมบูรณ์\nNCR ${ncr?.ncr_code} ปิดแล้ว (ยอมรับใช้พิเศษ)`);
    }

    return nextStatus;
  });
  return sign();
}

// CCO/CMO/CPO ปฏิเสธ UAI (→ uai_rejected_by_exec, NCR กลับ pending_supplier)
function rejectExec({ uai, reason, actorId, actorRole, actorIp }) {
  const ncr = db.prepare('SELECT ncr_code FROM ncrs WHERE id=?').get(uai.ncr_id);
  const rejectorLabel = { cco: 'CCO', cmo: 'CMO', cpo: 'CPO' }[actorRole] || actorRole;

  const reject = db.transaction(() => {
    // DEVMORE H7 — optimistic lock: เปลี่ยนสถานะเฉพาะเมื่อยังอยู่ในคิวของผู้ปฏิเสธ
    const locked = db.prepare("UPDATE uai_documents SET status='uai_rejected_by_exec' WHERE id=? AND status=?").run(uai.id, uai.status);
    if (locked.changes === 0) throw new Error('เอกสารถูกดำเนินการแล้ว กรุณารีเฟรชหน้า');
    db.prepare('INSERT INTO uai_signatures (uai_id, role, user_id, signature_image, action, comment) VALUES (?, ?, ?, ?, ?, ?)')
      .run(uai.id, actorRole, actorId, '', 'rejected', reason);

    // คืนสถานะ NCR กลับไปรอผู้ผลิตตอบกลับ
    db.prepare("UPDATE ncrs SET status='pending_supplier', uai_close_remark=NULL WHERE id=?").run(uai.ncr_id);

    const msg = `${uai.uai_code} — ${rejectorLabel} ไม่อนุมัติ\nNCR ${ncr?.ncr_code} กลับสู่สถานะรอผู้ผลิตตอบ\nเหตุผล: ${reason}`;
    for (const u of getUsersByRole('purchasing', 'qc_manager', 'qmr')) {
      createNotification(u.id, `UAI ไม่อนุมัติโดย ${rejectorLabel}`, `${uai.uai_code} — ${reason}`, `/uai/${uai.id}`);
    }
    sendTelegram(db.getSetting('telegram_group_qc'), `[IQC] ${msg}`);
    sendTelegram(db.getSetting('telegram_group_purchasing'), `[IQC] ${msg}`);

    db.auditLog('uai_documents', uai.id, 'REJECT_EXEC', { status: uai.status }, { status: 'uai_rejected_by_exec', reason }, actorId, actorIp);
    db.auditLog('ncrs', uai.ncr_id, 'REOPEN', { status: 'pending_uai' }, { status: 'pending_supplier', note: `UAI ${uai.uai_code} ถูกปฏิเสธโดย ${rejectorLabel}` }, actorId, actorIp);
  });
  reject();
}

module.exports = { UAI_STATUS_SEQUENCE, SIGN_ROLE_MAP, reviewUai, signUai, rejectExec };
