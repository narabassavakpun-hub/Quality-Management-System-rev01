// ===== IPNCR domain service (สกัดจาก routes/ipncr.js — CLAUDE.md §2.2/§8) =====
// state machine: open → prod_acknowledged → rechecking → prod_manager_approved
//   → qc_supervisor_verified → closed  (+ qc-reinspect-fail loop, attempt+1)
// validation (role/status/required fields) อยู่ใน controller; service ทำ transaction เท่านั้น
const db = require('../db/database');
const { getUsersByRole, createNotification, sendTelegram } = require('../lib/notify');

// สร้าง IPNCR (จาก ipqc inspection fail) → คืน id
function createIpncr({ inspection_id, doc_no, pro_code_sap_id, production_line_id, defect_description, total_qty_affected, action_required, deadline, actorId, actorIp }) {
  const create = db.transaction(() => {
    const record_no = db.nextIPNCRCode();
    const r = db.prepare(`
      INSERT INTO ipncr_records
        (record_no, source_type, source_id, doc_no, pro_code_sap_id, production_line_id,
         defect_description, total_qty_affected, action_required, deadline,
         status, recheck_attempt, created_by)
      VALUES (?, 'ipqc_inspection', ?, ?, ?, ?, ?, ?, ?, ?, 'open', 1, ?)
    `).run(
      record_no,
      inspection_id ? +inspection_id : null,
      doc_no,
      pro_code_sap_id ? +pro_code_sap_id : null,
      production_line_id ? +production_line_id : null,
      defect_description,
      total_qty_affected ? +total_qty_affected : 0,
      action_required || 'recheck_100pct',
      deadline || null,
      actorId
    );
    const id = r.lastInsertRowid;

    if (inspection_id) {
      db.prepare('UPDATE ipqc_inspections SET status = ? WHERE id = ?').run('has_ipncr', +inspection_id);
    }

    db.auditLog('ipncr_records', id, 'CREATE', null, { record_no, doc_no }, actorId, actorIp);

    for (const u of getUsersByRole('production_manager', 'prod_supervisor')) {
      createNotification(u.id, 'IPNCR ใหม่ — ต้องรับทราบ', `${record_no}: ${defect_description}`, `/production-qc/ipncr/${id}`);
    }
    sendTelegram(db.getSetting('telegram_group_qc'), `[IPNCR] ${record_no} — ${doc_no}\n${defect_description}`);

    if (db.pushSSE) db.pushSSE(
      getUsersByRole('production_manager', 'prod_supervisor').map(u => u.id),
      'ipncr_new', { id, record_no }
    );

    return id;
  });
  return create();
}

// open → prod_acknowledged (optimistic lock)
function acknowledge({ r, actorId, actorIp }) {
  db.transaction(() => {
    const ch = db.prepare(
      "UPDATE ipncr_records SET status='prod_acknowledged', prod_acknowledged_by=?, prod_acknowledged_at=datetime('now') WHERE id=? AND status='open'"
    ).run(actorId, r.id);
    if (ch.changes === 0) throw new Error('รายการนี้ถูกดำเนินการแล้ว กรุณารีเฟรช');
    db.auditLog('ipncr_records', r.id, 'ACKNOWLEDGE', { status: 'open' }, { status: 'prod_acknowledged' }, actorId, actorIp);
    createNotification(r.created_by, 'IPNCR รับทราบแล้ว', `${r.record_no} — ฝ่ายผลิตรับทราบแล้ว`, `/production-qc/ipncr/${r.id}`);
  })();
}

// prod_acknowledged → rechecking
function startRecheck({ r, actorId, actorIp }) {
  db.transaction(() => {
    const ch = db.prepare("UPDATE ipncr_records SET status='rechecking' WHERE id=? AND status='prod_acknowledged'").run(r.id);
    if (ch.changes === 0) throw new Error('สถานะไม่ถูกต้อง กรุณารีเฟรช');
    db.auditLog('ipncr_records', r.id, 'START_RECHECK', { status: 'prod_acknowledged' }, { status: 'rechecking' }, actorId, actorIp);
  })();
}

// rechecking → prod_manager_approved (+ recheck log)
function submitForQc({ r, root_cause, corrective_action, qty_rechecked, qty_pass, qty_fail, qty_scrap, remarks, actorId, actorIp }) {
  db.transaction(() => {
    const ch = db.prepare(`
      UPDATE ipncr_records SET
        status='prod_manager_approved',
        root_cause=?, corrective_action=?,
        prod_manager_approved_by=?, prod_manager_approved_at=datetime('now'),
        prod_manager_remarks=?,
        recheck_date=date('now'),
        recheck_pass_qty=?, recheck_fail_qty=?, recheck_scrap_qty=?
      WHERE id=? AND status='rechecking'
    `).run(
      root_cause, corrective_action,
      actorId, remarks || null,
      qty_pass ? +qty_pass : 0, qty_fail ? +qty_fail : 0, qty_scrap ? +qty_scrap : 0,
      r.id
    );
    if (ch.changes === 0) throw new Error('สถานะไม่ถูกต้อง กรุณารีเฟรช');

    db.prepare(`
      INSERT INTO ipncr_recheck_logs (ipncr_id, attempt, action, qty_rechecked, qty_pass, qty_fail, qty_scrap, remarks, created_by)
      VALUES (?, ?, 'recheck_submitted', ?, ?, ?, ?, ?, ?)
    `).run(r.id, r.recheck_attempt || 1, qty_rechecked ? +qty_rechecked : 0, qty_pass ? +qty_pass : 0, qty_fail ? +qty_fail : 0, qty_scrap ? +qty_scrap : 0, remarks || null, actorId);

    db.auditLog('ipncr_records', r.id, 'SUBMIT_FOR_QC', { status: 'rechecking' }, { status: 'prod_manager_approved' }, actorId, actorIp);

    for (const u of getUsersByRole('qc_staff', 'qc_supervisor')) {
      createNotification(u.id, 'IPNCR รอ QC ตรวจซ้ำ', `${r.record_no} — ฝ่ายผลิตส่งผลให้ QC ตรวจซ้ำ (ครั้งที่ ${r.recheck_attempt || 1})`, `/production-qc/ipncr/${r.id}`);
    }
    if (db.pushSSE) db.pushSSE(
      getUsersByRole('qc_staff', 'qc_supervisor').map(u => u.id),
      'ipncr_ready_for_qc', { id: r.id, record_no: r.record_no }
    );
  })();
}

// prod_manager_approved → qc_supervisor_verified (+ log)
function qcReinspectPass({ r, qty_pass, qty_fail, remarks, actorId, actorIp }) {
  db.transaction(() => {
    const ch = db.prepare(`
      UPDATE ipncr_records SET
        status='qc_supervisor_verified',
        qc_reinspect_result='pass',
        qc_reinspect_by=?, qc_reinspect_at=datetime('now'),
        qc_reinspect_remarks=?,
        verified_by=?, verified_at=datetime('now')
      WHERE id=? AND status='prod_manager_approved'
    `).run(actorId, remarks || null, actorId, r.id);
    if (ch.changes === 0) throw new Error('สถานะไม่ถูกต้อง กรุณารีเฟรช');

    db.prepare(`
      INSERT INTO ipncr_recheck_logs (ipncr_id, attempt, action, qty_pass, qty_fail, remarks, created_by)
      VALUES (?, ?, 'qc_pass', ?, ?, ?, ?)
    `).run(r.id, r.recheck_attempt || 1, qty_pass ? +qty_pass : 0, qty_fail ? +qty_fail : 0, remarks || null, actorId);

    db.auditLog('ipncr_records', r.id, 'QC_REINSPECT_PASS', { status: 'prod_manager_approved' }, { status: 'qc_supervisor_verified' }, actorId, actorIp);

    for (const u of getUsersByRole('qc_manager')) {
      createNotification(u.id, 'IPNCR QC ผ่าน — รอปิด', `${r.record_no} — QC ตรวจซ้ำผ่าน รอ QC Manager ปิด`, `/production-qc/ipncr/${r.id}`);
    }
    sendTelegram(db.getSetting('telegram_group_qc'), `[IPNCR] ${r.record_no} ✅ QC ตรวจซ้ำผ่าน (ครั้งที่ ${r.recheck_attempt || 1}) — รอ QC Manager ปิด`);
  })();
}

// prod_manager_approved → rechecking (attempt+1) — คืน nextAttempt
function qcReinspectFail({ r, qty_fail, remarks, actorId, actorIp }) {
  const nextAttempt = (r.recheck_attempt || 1) + 1;
  db.transaction(() => {
    const ch = db.prepare(`
      UPDATE ipncr_records SET
        status='rechecking',
        recheck_attempt=?,
        qc_reinspect_result='fail',
        qc_reinspect_by=?, qc_reinspect_at=datetime('now'),
        qc_reinspect_remarks=?
      WHERE id=? AND status='prod_manager_approved'
    `).run(nextAttempt, actorId, remarks, r.id);
    if (ch.changes === 0) throw new Error('สถานะไม่ถูกต้อง กรุณารีเฟรช');

    db.prepare(`
      INSERT INTO ipncr_recheck_logs (ipncr_id, attempt, action, qty_fail, remarks, created_by)
      VALUES (?, ?, 'qc_fail', ?, ?, ?)
    `).run(r.id, r.recheck_attempt || 1, qty_fail ? +qty_fail : 0, remarks, actorId);

    db.auditLog('ipncr_records', r.id, 'QC_REINSPECT_FAIL', { status: 'prod_manager_approved', attempt: r.recheck_attempt }, { status: 'rechecking', attempt: nextAttempt }, actorId, actorIp);

    for (const u of getUsersByRole('production_manager', 'prod_supervisor')) {
      createNotification(u.id, `IPNCR QC ไม่ผ่าน (ครั้งที่ ${r.recheck_attempt || 1})`, `${r.record_no} — QC ตรวจซ้ำไม่ผ่าน: ${remarks}`, `/production-qc/ipncr/${r.id}`);
    }
    sendTelegram(db.getSetting('telegram_group_qc'), `[IPNCR] ${r.record_no} ❌ QC ตรวจซ้ำไม่ผ่าน (ครั้งที่ ${r.recheck_attempt || 1})\n${remarks}`);
  })();
  return nextAttempt;
}

// qc_supervisor_verified → closed
function close({ r, remarks, actorId, actorIp }) {
  db.transaction(() => {
    const ch = db.prepare(`
      UPDATE ipncr_records SET
        status='closed', closed_by=?, closed_at=datetime('now'), recheck_remarks=?
      WHERE id=? AND status='qc_supervisor_verified'
    `).run(actorId, remarks || null, r.id);
    if (ch.changes === 0) throw new Error('สถานะไม่ถูกต้อง กรุณารีเฟรช');
    db.auditLog('ipncr_records', r.id, 'CLOSE', { status: 'qc_supervisor_verified' }, { status: 'closed' }, actorId, actorIp);
    createNotification(r.created_by, 'IPNCR ปิดแล้ว', `${r.record_no} — ปิดเอกสาร IPNCR แล้ว`, `/production-qc/ipncr/${r.id}`);
  })();
}

module.exports = { createIpncr, acknowledge, startRecheck, submitForQc, qcReinspectPass, qcReinspectFail, close };
