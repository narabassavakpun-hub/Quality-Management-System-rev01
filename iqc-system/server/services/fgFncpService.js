// ===== FG FNCP domain service (สกัดจาก routes/fgFncp.js — CLAUDE.md §2.2/§8) =====
// สกัด transition ที่เป็น transaction จริง (supervisor-approve / manager-approve) + cascade ปิด defect record
const db = require('../db/database');
const { notifyRoles, notifyUser } = require('../lib/fgNotify');

// waiting_verify → closed (minor) | supervisor_approved (major/critical) — คืน newStatus
function supervisorApprove({ old, comment, actorId, actorIp }) {
  const link = `/fg-production/fncp/${old.id}`;
  const isMinor = old.severity === 'minor';
  const newStatus = isMinor ? 'closed' : 'supervisor_approved';

  db.transaction(() => {
    if (isMinor) {
      db.prepare(`UPDATE fg_fncp SET status='closed', supervisor_approved_by=?, supervisor_approved_at=datetime('now'), closed_by=?, closed_at=datetime('now'), close_date=date('now') WHERE id=?`)
        .run(actorId, actorId, old.id);
      if (old.defect_record_id) {
        db.prepare("UPDATE fg_defect_records SET status='closed', updated_at=datetime('now') WHERE id=?").run(old.defect_record_id);
      }
      notifyRoles(['production_manager', 'qc_supervisor'], `FNCP ${old.fncp_no} ปิดแล้ว`, 'Supervisor อนุมัติและปิด FNCP (Minor)', link);
      notifyUser(old.opened_by, `FNCP ${old.fncp_no} ปิดแล้ว`, 'QC Supervisor อนุมัติและปิดเอกสาร FNCP เรียบร้อย', link);
    } else {
      db.prepare(`UPDATE fg_fncp SET status='supervisor_approved', supervisor_approved_by=?, supervisor_approved_at=datetime('now') WHERE id=?`)
        .run(actorId, old.id);
      notifyRoles(['qc_manager'], `FNCP ${old.fncp_no} รอ QC Manager อนุมัติ`, `Severity: ${old.severity} — Supervisor อนุมัติแล้ว`, link);
    }
    db.prepare("INSERT INTO fg_fncp_timeline (fncp_id, action, comment, created_by) VALUES (?,?,?,?)")
      .run(old.id, 'supervisor_approve', comment || (isMinor ? 'Supervisor อนุมัติ (Minor) — ปิดทันที' : 'Supervisor อนุมัติแล้ว รอ Manager'), actorId);
    db.auditLog('fg_fncp', old.id, 'SUPERVISOR_APPROVE', { status: old.status }, { status: newStatus }, actorId, actorIp);
  })();

  return newStatus;
}

// supervisor_approved → closed (+ cascade ปิด defect record)
function managerApprove({ old, comment, actorId, actorIp }) {
  const link = `/fg-production/fncp/${old.id}`;

  db.transaction(() => {
    db.prepare(`UPDATE fg_fncp SET status='closed', manager_approved_by=?, manager_approved_at=datetime('now'), closed_by=?, closed_at=datetime('now'), close_date=date('now') WHERE id=?`)
      .run(actorId, actorId, old.id);
    if (old.defect_record_id) {
      db.prepare("UPDATE fg_defect_records SET status='closed', updated_at=datetime('now') WHERE id=?").run(old.defect_record_id);
    }
    db.prepare("INSERT INTO fg_fncp_timeline (fncp_id, action, comment, created_by) VALUES (?,?,?,?)")
      .run(old.id, 'manager_approve', comment || 'QC Manager อนุมัติและปิด FNCP', actorId);
    db.auditLog('fg_fncp', old.id, 'MANAGER_APPROVE', { status: old.status }, { status: 'closed' }, actorId, actorIp);
    notifyRoles(['production_manager', 'qc_supervisor'], `FNCP ${old.fncp_no} ปิดแล้ว`, 'QC Manager อนุมัติและปิด FNCP', link);
    notifyUser(old.opened_by, `FNCP ${old.fncp_no} ปิดแล้ว`, 'QC Manager อนุมัติและปิดเอกสาร FNCP เรียบร้อย', link);
  })();
}

// open/reject → in_progress (production เริ่มแก้)
function start({ old, comment, department_responsible, root_cause, correction, corrective_action, preventive_action, due_date, actorId, actorIp }) {
  db.transaction(() => {
    db.prepare(`
      UPDATE fg_fncp SET status='in_progress', in_progress_by=?, in_progress_at=datetime('now'),
        department_responsible=COALESCE(?,department_responsible),
        root_cause=COALESCE(?,root_cause), correction=COALESCE(?,correction),
        corrective_action=COALESCE(?,corrective_action), preventive_action=COALESCE(?,preventive_action),
        due_date=COALESCE(?,due_date)
      WHERE id=?
    `).run(actorId, department_responsible || null, root_cause || null, correction || null, corrective_action || null, preventive_action || null, due_date || null, old.id);
    db.prepare("INSERT INTO fg_fncp_timeline (fncp_id, action, comment, created_by) VALUES (?,?,?,?)").run(old.id, 'start', comment || 'เริ่มดำเนินการแก้ไข', actorId);
    db.auditLog('fg_fncp', old.id, 'START', { status: old.status }, { status: 'in_progress' }, actorId, actorIp);
    notifyRoles(['qc_manager', 'qc_supervisor'], `FNCP ${old.fncp_no} เริ่มดำเนินการ`, 'ฝ่ายผลิตเริ่มแก้ไข', `/fg-production/fncp/${old.id}`);
  })();
}

// in_progress → waiting_verify
function submitVerify({ old, comment, actorId, actorIp }) {
  db.transaction(() => {
    db.prepare(`UPDATE fg_fncp SET status='waiting_verify', submit_verify_by=?, submit_verify_at=datetime('now') WHERE id=?`).run(actorId, old.id);
    db.prepare("INSERT INTO fg_fncp_timeline (fncp_id, action, comment, created_by) VALUES (?,?,?,?)").run(old.id, 'submit_verify', comment || 'ส่ง QC ตรวจสอบ', actorId);
    db.auditLog('fg_fncp', old.id, 'SUBMIT_VERIFY', { status: 'in_progress' }, { status: 'waiting_verify' }, actorId, actorIp);
    notifyRoles(['qc_manager', 'qc_supervisor', 'qc_staff'], `FNCP ${old.fncp_no} รอ QC ตรวจ`, 'ฝ่ายผลิตส่งงานรอตรวจสอบ', `/fg-production/fncp/${old.id}`);
  })();
}

// waiting_verify → verified
function verify({ old, comment, verification_result, actorId, actorIp }) {
  db.transaction(() => {
    db.prepare(`UPDATE fg_fncp SET status='verified', verified_by=?, verified_at=datetime('now'), verification_result=? WHERE id=?`)
      .run(actorId, verification_result || null, old.id);
    db.prepare("INSERT INTO fg_fncp_timeline (fncp_id, action, comment, created_by) VALUES (?,?,?,?)").run(old.id, 'verify', comment || 'QC ตรวจสอบผ่าน', actorId);
    db.auditLog('fg_fncp', old.id, 'VERIFY', { status: 'waiting_verify' }, { status: 'verified' }, actorId, actorIp);
    notifyRoles(['qc_manager', 'production_manager'], `FNCP ${old.fncp_no} QC ยืนยันแล้ว`, 'รอผู้จัดการปิดงาน', `/fg-production/fncp/${old.id}`);
  })();
}

// waiting_verify → reject
function reject({ old, comment, reject_reason, actorId, actorIp }) {
  const rejectLink = `/fg-production/fncp/${old.id}`;
  db.transaction(() => {
    db.prepare(`UPDATE fg_fncp SET status='reject', rejected_by=?, rejected_at=datetime('now'), reject_reason=? WHERE id=?`)
      .run(actorId, reject_reason, old.id);
    db.prepare("INSERT INTO fg_fncp_timeline (fncp_id, action, comment, created_by) VALUES (?,?,?,?)").run(old.id, 'reject', comment || reject_reason, actorId);
    db.auditLog('fg_fncp', old.id, 'REJECT', { status: 'waiting_verify' }, { status: 'reject' }, actorId, actorIp);
    notifyRoles(['production_manager'], `FNCP ${old.fncp_no} QC ปฏิเสธ`, reject_reason, rejectLink);
    notifyUser(old.opened_by, `FNCP ${old.fncp_no} ถูกปฏิเสธ`, `QC ปฏิเสธ — ${reject_reason}`, rejectLink);
  })();
}

// verified → closed (+ cascade ปิด defect record)
function close({ old, comment, actorId, actorIp }) {
  db.transaction(() => {
    db.prepare(`UPDATE fg_fncp SET status='closed', closed_by=?, closed_at=datetime('now'), close_date=date('now') WHERE id=?`).run(actorId, old.id);
    db.prepare("INSERT INTO fg_fncp_timeline (fncp_id, action, comment, created_by) VALUES (?,?,?,?)").run(old.id, 'close', comment || 'ปิด FNCP', actorId);
    db.auditLog('fg_fncp', old.id, 'CLOSE', { status: 'verified' }, { status: 'closed' }, actorId, actorIp);
    if (old.defect_record_id) {
      db.prepare("UPDATE fg_defect_records SET status='closed', updated_at=datetime('now') WHERE id=?").run(old.defect_record_id);
    }
    notifyRoles(['production_manager', 'qc_supervisor'], `FNCP ${old.fncp_no} ปิดแล้ว`, 'ปิดเอกสาร FNCP เรียบร้อย', `/fg-production/fncp/${old.id}`);
  })();
}

module.exports = { supervisorApprove, managerApprove, start, submitVerify, verify, reject, close };
