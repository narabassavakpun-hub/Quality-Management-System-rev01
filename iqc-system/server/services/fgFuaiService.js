// ===== FG FUAI domain service (สกัดจาก routes/fgFuai.js — CLAUDE.md §2.2/§8) =====
// approval/ack state machine: pending_prod_manager → pending_cpo → pending_qc_manager
//   → pending_qc_staff_ack → pending_qc_supervisor_ack → closed  (+ cpo/qc_manager reject → reopen FNCP)
// validation (role/status) อยู่ใน controller; service ทำ transaction เท่านั้น
const db = require('../db/database');
const { notifyRoles } = require('../lib/fgNotify');

const addTimeline = (fuai_id, action, comment, user_id) =>
  db.prepare('INSERT INTO fg_fuai_timeline (fuai_id, action, comment, created_by) VALUES (?,?,?,?)').run(fuai_id, action, comment || null, user_id || null);

// pending_prod_manager → pending_cpo
function prodManagerApprove({ fuai, comment, actorId, actorIp }) {
  const link = `/fg-production/fuai/${fuai.id}`;
  db.transaction(() => {
    db.prepare(`UPDATE fg_fuai SET status='pending_cpo', prod_manager_approved_by=?, prod_manager_approved_at=datetime('now'), prod_manager_remarks=? WHERE id=?`)
      .run(actorId, comment || null, fuai.id);
    addTimeline(fuai.id, 'prod_manager_approve', comment || 'ผู้จัดการฝ่ายผลิตอนุมัติ', actorId);
    db.auditLog('fg_fuai', fuai.id, 'PROD_MANAGER_APPROVE', { status: fuai.status }, { status: 'pending_cpo' }, actorId, actorIp);
    notifyRoles(['cpo'], `FUAI ${fuai.fuai_no} รอ CPO อนุมัติ`, 'ผู้จัดการฝ่ายผลิตอนุมัติแล้ว', link);
  })();
}

// pending_cpo → pending_qc_manager
function cpoApprove({ fuai, comment, actorId, actorIp }) {
  const link = `/fg-production/fuai/${fuai.id}`;
  db.transaction(() => {
    db.prepare(`UPDATE fg_fuai SET status='pending_qc_manager', cpo_approved_by=?, cpo_approved_at=datetime('now'), cpo_remarks=? WHERE id=?`)
      .run(actorId, comment || null, fuai.id);
    addTimeline(fuai.id, 'cpo_approve', comment || 'CPO อนุมัติ', actorId);
    db.auditLog('fg_fuai', fuai.id, 'CPO_APPROVE', { status: fuai.status }, { status: 'pending_qc_manager' }, actorId, actorIp);
    notifyRoles(['qc_manager'], `FUAI ${fuai.fuai_no} รอ QC Manager อนุมัติ`, 'CPO อนุมัติแล้ว', link);
  })();
}

// pending_cpo → rejected (+ reopen FNCP)
function cpoReject({ fuai, reason, actorId, actorIp }) {
  const link = `/fg-production/fncp/${fuai.fncp_id}`;
  db.transaction(() => {
    db.prepare(`UPDATE fg_fuai SET status='rejected', cpo_rejected_at=datetime('now'), cpo_reject_reason=?, rejected_at=datetime('now'), reject_reason=? WHERE id=?`)
      .run(reason.trim(), reason.trim(), fuai.id);
    addTimeline(fuai.id, 'cpo_reject', reason.trim(), actorId);
    db.prepare(`UPDATE fg_fncp SET status='reject', rejected_by=?, rejected_at=datetime('now'), reject_reason=? WHERE id=?`)
      .run(actorId, `FUAI ${fuai.fuai_no} ถูกปฏิเสธโดย CPO: ${reason.trim()}`, fuai.fncp_id);
    db.prepare("INSERT INTO fg_fncp_timeline (fncp_id, action, comment, created_by) VALUES (?,?,?,?)")
      .run(fuai.fncp_id, 'fuai_rejected', `FUAI ${fuai.fuai_no} — CPO ปฏิเสธ: ${reason.trim()}`, actorId);
    db.auditLog('fg_fuai', fuai.id, 'CPO_REJECT', { status: fuai.status }, { status: 'rejected' }, actorId, actorIp);
    notifyRoles(['production_manager', 'qc_supervisor'], `FUAI ${fuai.fuai_no} ถูกปฏิเสธ`, `CPO ปฏิเสธ: ${reason.trim()}`, link);
  })();
}

// pending_qc_manager → pending_qc_staff_ack
function qcManagerApprove({ fuai, comment, actorId, actorIp }) {
  const link = `/fg-production/fuai/${fuai.id}`;
  db.transaction(() => {
    db.prepare(`UPDATE fg_fuai SET status='pending_qc_staff_ack', qc_manager_approved_by=?, qc_manager_approved_at=datetime('now'), qc_manager_remarks=? WHERE id=?`)
      .run(actorId, comment || null, fuai.id);
    addTimeline(fuai.id, 'qc_manager_approve', comment || 'QC Manager อนุมัติ', actorId);
    db.auditLog('fg_fuai', fuai.id, 'QC_MANAGER_APPROVE', { status: fuai.status }, { status: 'pending_qc_staff_ack' }, actorId, actorIp);
    notifyRoles(['qc_staff'], `FUAI ${fuai.fuai_no} รอ QC Staff รับทราบ`, 'QC Manager อนุมัติแล้ว รอการรับทราบ', link);
  })();
}

// pending_qc_manager → rejected (+ reopen FNCP)
function qcManagerReject({ fuai, reason, actorId, actorIp }) {
  const link = `/fg-production/fncp/${fuai.fncp_id}`;
  db.transaction(() => {
    db.prepare(`UPDATE fg_fuai SET status='rejected', qc_manager_rejected_at=datetime('now'), qc_manager_reject_reason=?, rejected_at=datetime('now'), reject_reason=? WHERE id=?`)
      .run(reason.trim(), reason.trim(), fuai.id);
    addTimeline(fuai.id, 'qc_manager_reject', reason.trim(), actorId);
    db.prepare(`UPDATE fg_fncp SET status='reject', rejected_by=?, rejected_at=datetime('now'), reject_reason=? WHERE id=?`)
      .run(actorId, `FUAI ${fuai.fuai_no} ถูกปฏิเสธโดย QC Manager: ${reason.trim()}`, fuai.fncp_id);
    db.prepare("INSERT INTO fg_fncp_timeline (fncp_id, action, comment, created_by) VALUES (?,?,?,?)")
      .run(fuai.fncp_id, 'fuai_rejected', `FUAI ${fuai.fuai_no} — QC Manager ปฏิเสธ: ${reason.trim()}`, actorId);
    db.auditLog('fg_fuai', fuai.id, 'QC_MANAGER_REJECT', { status: fuai.status }, { status: 'rejected' }, actorId, actorIp);
    notifyRoles(['production_manager', 'qc_supervisor'], `FUAI ${fuai.fuai_no} ถูกปฏิเสธ`, `QC Manager ปฏิเสธ: ${reason.trim()}`, link);
  })();
}

// pending_qc_staff_ack → pending_qc_supervisor_ack
function qcStaffAck({ fuai, comment, actorId, actorIp }) {
  const link = `/fg-production/fuai/${fuai.id}`;
  db.transaction(() => {
    db.prepare(`UPDATE fg_fuai SET status='pending_qc_supervisor_ack', qc_staff_ack_by=?, qc_staff_ack_at=datetime('now') WHERE id=?`)
      .run(actorId, fuai.id);
    addTimeline(fuai.id, 'qc_staff_ack', comment || 'QC Staff รับทราบแล้ว', actorId);
    db.auditLog('fg_fuai', fuai.id, 'QC_STAFF_ACK', { status: fuai.status }, { status: 'pending_qc_supervisor_ack' }, actorId, actorIp);
    notifyRoles(['qc_supervisor'], `FUAI ${fuai.fuai_no} รอ QC Supervisor รับทราบ`, 'QC Staff รับทราบแล้ว', link);
  })();
}

// pending_qc_supervisor_ack → closed
function qcSupervisorAck({ fuai, comment, actorId, actorIp }) {
  const link = `/fg-production/fuai/${fuai.id}`;
  db.transaction(() => {
    db.prepare(`UPDATE fg_fuai SET status='closed', qc_supervisor_ack_by=?, qc_supervisor_ack_at=datetime('now'), closed_at=datetime('now') WHERE id=?`)
      .run(actorId, fuai.id);
    addTimeline(fuai.id, 'qc_supervisor_ack', comment || 'QC Supervisor รับทราบ — ปิด FUAI', actorId);
    db.auditLog('fg_fuai', fuai.id, 'QC_SUPERVISOR_ACK', { status: fuai.status }, { status: 'closed' }, actorId, actorIp);
    notifyRoles(['production_manager', 'qc_staff'], `FUAI ${fuai.fuai_no} ปิดแล้ว`, 'QC Supervisor รับทราบ — เอกสาร FUAI ปิดเรียบร้อย', link);
  })();
}

module.exports = { prodManagerApprove, cpoApprove, cpoReject, qcManagerApprove, qcManagerReject, qcStaffAck, qcSupervisorAck };
