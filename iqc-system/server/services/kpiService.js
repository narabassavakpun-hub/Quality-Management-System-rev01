// ===== KPI domain service — report approval flow (สกัดจาก routes/kpi.js — CLAUDE.md §2.2/§8) =====
// สกัดเฉพาะ transaction ของ report state machine (submit/approve/reject/revise)
// validation (role/status) ยังอยู่ใน controller; service คืน void, throw ข้อความ 'รีเฟรช' เมื่อ optimistic lock ชน
//
// ⚠️ DEPRECATED (Session 104): createReport/updateReportEntries/submitReport/approveReport/rejectReport/reviseReport
// ทั้งหมดนี้รองรับ kpi_reports ซึ่งไม่มี UI entry point แล้ว (ถูกแทนที่ด้วย kpi_actuals+kpi_action_plans)
// ดู AUDIT.md §3.7/D3, CLAUDE.md §22.3 — ห้ามใช้เป็น pattern อ้างอิงสำหรับ service ใหม่
const db = require('../db/database');
const { getUsersByRole, createNotification, sendTelegram } = require('../lib/notify');

const AP_MONTH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];

// ดึงค่า KPI จาก data source ในระบบ (สำหรับ item ที่ data_source_type='database') — ย้ายจาก routes/kpi.js
function fetchDbSourceValue(key, year, month) {
  const y = String(year);
  const m = String(month).padStart(2, '0');
  if (key === 'ncr_count') {
    return db.prepare(
      `SELECT COUNT(*) as v FROM ncrs WHERE strftime('%Y',created_at)=? AND strftime('%m',created_at)=? AND status!='cancelled'`
    ).get(y, m)?.v ?? 0;
  }
  if (key === 'ncr_closed_rate') {
    const total = db.prepare(
      `SELECT COUNT(*) as v FROM ncrs WHERE strftime('%Y',created_at)=? AND strftime('%m',created_at)=? AND status!='cancelled'`
    ).get(y, m)?.v ?? 0;
    const closed = db.prepare(
      `SELECT COUNT(*) as v FROM ncrs WHERE strftime('%Y',created_at)=? AND strftime('%m',created_at)=? AND status IN ('closed','ncp_closed')`
    ).get(y, m)?.v ?? 0;
    return total === 0 ? 0 : Math.round(closed / total * 100 * 10) / 10;
  }
  if (key === 'bills_count') {
    return db.prepare(
      `SELECT COUNT(*) as v FROM bills WHERE strftime('%Y',received_date)=? AND strftime('%m',received_date)=? AND status!='cancelled'`
    ).get(y, m)?.v ?? 0;
  }
  if (key === 'pass_rate') {
    const total = db.prepare(
      `SELECT COUNT(*) as v FROM bill_items WHERE strftime('%Y',created_at)=? AND strftime('%m',created_at)=?`
    ).get(y, m)?.v ?? 0;
    const passed = db.prepare(
      `SELECT COUNT(*) as v FROM bill_items WHERE strftime('%Y',created_at)=? AND strftime('%m',created_at)=? AND result='passed'`
    ).get(y, m)?.v ?? 0;
    return total === 0 ? 0 : Math.round(passed / total * 100 * 10) / 10;
  }
  return null;
}

// admin submit report (draft/rejected → pending_qc_manager)
function submitReport({ report, actorId, actorIp }) {
  db.transaction(() => {
    const result = db.prepare(`
      UPDATE kpi_reports SET status='pending_qc_manager', submitted_at=datetime('now'), updated_at=datetime('now'),
        reject_reason=NULL, rejected_by_role=NULL
      WHERE id=? AND status IN ('draft','rejected')
    `).run(report.id);
    if (result.changes === 0) throw new Error('เอกสารถูกดำเนินการแล้ว กรุณารีเฟรชหน้า');

    db.prepare('INSERT INTO kpi_approvals (report_id, action, role, created_by) VALUES (?, ?, ?, ?)').run(report.id, 'submit', 'admin', actorId);

    for (const u of getUsersByRole('qc_manager')) {
      createNotification(u.id, 'รายงาน KPI รออนุมัติ',
        `รายงาน ${report.report_no} เดือน ${report.month}/${report.year} รอ QC Manager อนุมัติ`,
        `/kpi/reports/${report.id}`);
    }
    sendTelegram(db.getSetting('telegram_group_qc'),
      `[IQC] รายงาน KPI ส่งอนุมัติ\n${report.report_no} (${report.month}/${report.year})\nรอ QC Manager อนุมัติ`
    );

    db.auditLog('kpi_reports', report.id, 'SUBMIT', { status: report.status }, { status: 'pending_qc_manager' }, actorId, actorIp);
  })();
}

// approve 1 ขั้น (t = { from, to }) — qc_manager→cpo→qmr→approved
function approveReport({ report, role, t, comment, actorId, actorIp }) {
  db.transaction(() => {
    const ts = "datetime('now')";
    const byField = { qc_manager: 'qc_manager_by', cpo: 'cpo_by', qmr: 'qmr_by' }[role];
    const atField = { qc_manager: 'qc_manager_at', cpo: 'cpo_at', qmr: 'qmr_at' }[role];

    const result = db.prepare(`
      UPDATE kpi_reports SET status=?, ${atField}=${ts}, ${byField}=?, updated_at=${ts}
      WHERE id=? AND status=?
    `).run(t.to, actorId, report.id, t.from);
    if (result.changes === 0) throw new Error('เอกสารถูกดำเนินการแล้ว กรุณารีเฟรชหน้า');

    db.prepare('INSERT INTO kpi_approvals (report_id, action, role, comment, created_by) VALUES (?, ?, ?, ?, ?)').run(report.id, 'approve', role, comment || null, actorId);

    if (role === 'qc_manager') {
      for (const u of getUsersByRole('cpo')) {
        createNotification(u.id, 'รายงาน KPI รออนุมัติ',
          `รายงาน ${report.report_no} เดือน ${report.month}/${report.year} รอ CPO อนุมัติ`,
          `/kpi/reports/${report.id}`);
      }
      sendTelegram(db.getSetting('telegram_group_qc'),
        `[IQC] รายงาน KPI ผ่าน QC Manager\n${report.report_no} (${report.month}/${report.year})\nรอ CPO อนุมัติ`
      );
    } else if (role === 'cpo') {
      for (const u of getUsersByRole('qmr')) {
        createNotification(u.id, 'รายงาน KPI รออนุมัติ',
          `รายงาน ${report.report_no} เดือน ${report.month}/${report.year} รอ QMR อนุมัติ`,
          `/kpi/reports/${report.id}`);
      }
      sendTelegram(db.getSetting('telegram_group_qc'),
        `[IQC] รายงาน KPI ผ่าน CPO\n${report.report_no} (${report.month}/${report.year})\nรอ QMR อนุมัติ`
      );
    } else if (role === 'qmr') {
      const notifyRoles = ['admin', 'qc_manager', 'cpo'];
      for (const u of getUsersByRole(...notifyRoles)) {
        createNotification(u.id, 'รายงาน KPI อนุมัติแล้ว',
          `รายงาน ${report.report_no} เดือน ${report.month}/${report.year} ได้รับการอนุมัติครบถ้วน`,
          `/kpi/reports/${report.id}`);
      }
      sendTelegram(db.getSetting('telegram_group_qc'),
        `[IQC] รายงาน KPI อนุมัติแล้ว\n${report.report_no} (${report.month}/${report.year})\nอนุมัติโดย QMR — สถานะ: Approved`
      );
    }

    db.auditLog('kpi_reports', report.id, 'APPROVE', { status: report.status }, { status: t.to, role }, actorId, actorIp);
  })();
}

// reject (fromStatus ตาม role) → rejected
function rejectReport({ report, role, fromStatus, reason, actorId, actorIp }) {
  db.transaction(() => {
    const result = db.prepare(`
      UPDATE kpi_reports SET status='rejected', reject_reason=?, rejected_by_role=?, updated_at=datetime('now')
      WHERE id=? AND status=?
    `).run(reason.trim(), role, report.id, fromStatus);
    if (result.changes === 0) throw new Error('เอกสารถูกดำเนินการแล้ว กรุณารีเฟรชหน้า');

    db.prepare('INSERT INTO kpi_approvals (report_id, action, role, comment, created_by) VALUES (?, ?, ?, ?, ?)').run(report.id, 'reject', role, reason.trim(), actorId);

    for (const u of getUsersByRole('admin')) {
      createNotification(u.id, 'รายงาน KPI ถูกปฏิเสธ',
        `รายงาน ${report.report_no} เดือน ${report.month}/${report.year} ถูกปฏิเสธโดย ${role}: ${reason.trim()}`,
        `/kpi/reports/${report.id}`);
    }
    sendTelegram(db.getSetting('telegram_group_qc'),
      `[IQC] รายงาน KPI ถูกปฏิเสธ\n${report.report_no} (${report.month}/${report.year})\nโดย ${role}: ${reason.trim()}`
    );

    db.auditLog('kpi_reports', report.id, 'REJECT', { status: report.status }, { status: 'rejected', role, reason }, actorId, actorIp);
  })();
}

// admin revise (rejected → draft)
function reviseReport({ report, actorId, actorIp }) {
  db.transaction(() => {
    const result = db.prepare(`
      UPDATE kpi_reports SET status='draft', updated_at=datetime('now')
      WHERE id=? AND status='rejected'
    `).run(report.id);
    if (result.changes === 0) throw new Error('เอกสารถูกดำเนินการแล้ว กรุณารีเฟรชหน้า');

    db.prepare('INSERT INTO kpi_approvals (report_id, action, role, created_by) VALUES (?, ?, ?, ?)').run(report.id, 'revise', 'admin', actorId);
    db.auditLog('kpi_reports', report.id, 'REVISE', { status: 'rejected' }, { status: 'draft' }, actorId, actorIp);
  })();
}

// ===== KPI Action Plans (state machine อีกชุด: draft→pending_qcm→pending_cpo→pending_qmr→approved) =====
// controller คำนวณ nextStatus/signField ก่อน (validation role/status); apPlanWithJoins (read) เรียกใน controller หลัง commit

// admin submit action plan (draft → pending_qcm)
function submitActionPlan({ plan, actorId, actorIp }) {
  db.transaction(() => {
    db.prepare(`UPDATE kpi_action_plans SET status='pending_qcm', submitted_at=datetime('now'),
      reject_reason=NULL, updated_at=datetime('now') WHERE id=?`).run(plan.id);
    db.auditLog('kpi_action_plans', plan.id, 'SUBMIT', { status: 'draft' }, { status: 'pending_qcm' }, actorId, actorIp);
    const item = db.prepare('SELECT kpi_no, name FROM kpi_items WHERE id=?').get(plan.kpi_item_id);
    const label = `${item?.kpi_no} (${AP_MONTH[plan.month - 1]} ${plan.year + 543})`;
    const apLink = `/kpi/summary?ap_id=${plan.id}&year=${plan.year}&month=${plan.month}`;
    for (const u of getUsersByRole('qc_manager'))
      createNotification(u.id, 'Action Plan KPI รออนุมัติ', `${label} รอ QC Manager ลงชื่ออนุมัติ`, apLink);
  })();
}

// approve 1 ขั้น (nextStatus/signField/signAtField คำนวณจาก controller)
function approveActionPlan({ plan, nextStatus, signField, signAtField, actorId, actorIp }) {
  db.transaction(() => {
    const r = db.prepare(`
      UPDATE kpi_action_plans SET status=?, ${signField}=?, ${signAtField}=datetime('now'), updated_at=datetime('now')
      WHERE id=? AND status=?
    `).run(nextStatus, actorId, plan.id, plan.status);
    if (r.changes === 0) throw new Error('สถานะเปลี่ยนแล้ว กรุณารีเฟรช');
    db.auditLog('kpi_action_plans', plan.id, 'APPROVE', { status: plan.status }, { status: nextStatus }, actorId, actorIp);
    const item = db.prepare('SELECT kpi_no, name FROM kpi_items WHERE id=?').get(plan.kpi_item_id);
    const label = `${item?.kpi_no} (${AP_MONTH[plan.month - 1]} ${plan.year + 543})`;
    const apLink = `/kpi/summary?ap_id=${plan.id}&year=${plan.year}&month=${plan.month}`;
    if (nextStatus === 'pending_cpo') {
      for (const u of getUsersByRole('cpo', 'cmo'))
        createNotification(u.id, 'Action Plan KPI รอ CPO อนุมัติ', `${label} QC Manager อนุมัติแล้ว`, apLink);
      if (plan.created_by) createNotification(plan.created_by, 'Action Plan ผ่าน QC Manager', `${label} รอ CPO`, apLink);
    } else if (nextStatus === 'pending_qmr') {
      for (const u of getUsersByRole('qmr'))
        createNotification(u.id, 'Action Plan KPI รอ QMR อนุมัติ', `${label} CPO อนุมัติแล้ว`, apLink);
      if (plan.created_by) createNotification(plan.created_by, 'Action Plan ผ่าน CPO', `${label} รอ QMR`, apLink);
    } else {
      if (plan.created_by) createNotification(plan.created_by, 'Action Plan อนุมัติเสร็จสมบูรณ์', `${label} QMR อนุมัติแล้ว`, apLink);
      for (const u of getUsersByRole('qc_manager'))
        createNotification(u.id, 'Action Plan KPI สมบูรณ์', `${label} QMR อนุมัติแล้ว`, apLink);
    }
  })();
}

// reject (pending_* → draft, revision+1, clear signatures) + notify (ไม่รวมผู้ตีกลับ)
function rejectActionPlan({ plan, role, reason, actorId, actorIp }) {
  db.transaction(() => {
    db.prepare(`
      UPDATE kpi_action_plans SET status='draft', reject_reason=?,
        rejected_by=?, rejected_at=datetime('now'),
        revision=revision+1,
        qcm_signed_by=NULL, qcm_signed_at=NULL,
        cpo_signed_by=NULL, cpo_signed_at=NULL,
        qmr_signed_by=NULL, qmr_signed_at=NULL,
        submitted_at=NULL, updated_at=datetime('now')
      WHERE id=?
    `).run(reason.trim(), actorId, plan.id);
    db.auditLog('kpi_action_plans', plan.id, 'REJECT', { status: plan.status }, { status: 'draft', reason: reason.trim() }, actorId, actorIp);
    const item = db.prepare('SELECT kpi_no, name FROM kpi_items WHERE id=?').get(plan.kpi_item_id);
    const label = `${item?.kpi_no} (${AP_MONTH[plan.month - 1]} ${plan.year + 543})`;
    const apLink = `/kpi/summary?ap_id=${plan.id}&year=${plan.year}&month=${plan.month}`;
    const who = role === 'qc_manager' ? 'QC Manager' : role === 'qmr' ? 'QMR' : 'CPO';
    const notifyTitle = 'Action Plan ถูกส่งกลับแก้ไข';
    const notifyBody = `${label} ${who} ไม่อนุมัติ: ${reason.trim()}`;
    const notifyIds = new Set();
    if (plan.created_by) notifyIds.add(plan.created_by);
    for (const u of getUsersByRole('admin')) notifyIds.add(u.id);
    if (plan.status === 'pending_cpo' || plan.status === 'pending_qmr') {
      for (const u of getUsersByRole('qc_manager')) notifyIds.add(u.id);
    }
    if (plan.status === 'pending_qmr') {
      for (const u of getUsersByRole('cpo', 'cmo')) notifyIds.add(u.id);
    }
    notifyIds.delete(actorId);
    for (const uid of notifyIds) createNotification(uid, notifyTitle, notifyBody, apLink);
  })();
}

// admin สร้างรายงาน KPI เดือน/ปี + entries สำหรับทุก active item (auto-fill ค่า database source) → คืน reportId
function createReport({ year, month, actorId, actorIp }) {
  return db.transaction(() => {
    const report_no = db.nextKPICode();
    const r = db.prepare(`
      INSERT INTO kpi_reports (report_no, year, month, status, created_by)
      VALUES (?, ?, ?, 'draft', ?)
    `).run(report_no, Number(year), Number(month), actorId);
    const reportId = r.lastInsertRowid;

    const activeItems = db.prepare('SELECT * FROM kpi_items WHERE is_active=1 ORDER BY group_id, display_order, id').all();
    const insEntry = db.prepare(`
      INSERT INTO kpi_report_entries (report_id, kpi_item_id, target_value, actual_value, updated_by)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const item of activeItems) {
      const target = db.prepare('SELECT target_value FROM kpi_targets WHERE kpi_item_id=? AND year=? AND month=?').get(item.id, Number(year), Number(month));
      let actual_value = null;
      if (item.data_source_type === 'database' && item.data_source_key) {
        actual_value = fetchDbSourceValue(item.data_source_key, Number(year), Number(month));
      }
      insEntry.run(reportId, item.id, target?.target_value ?? null, actual_value, actorId);
    }

    db.auditLog('kpi_reports', reportId, 'CREATE', null, { report_no, year, month }, actorId, actorIp);
    return reportId;
  })();
}

// admin แก้ค่า entries (draft/rejected) — bulk update actual/remark/note
function updateReportEntries({ reportId, updates, actorId, actorIp }) {
  db.transaction(() => {
    const upd = db.prepare(`
      UPDATE kpi_report_entries SET
        actual_value = ?, remark = ?, data_source_note = ?, updated_by = ?, updated_at = datetime('now')
      WHERE report_id = ? AND kpi_item_id = ?
    `);
    for (const u of updates) {
      upd.run(u.actual_value ?? null, u.remark ?? null, u.data_source_note ?? null, actorId, reportId, u.kpi_item_id);
    }
    db.prepare("UPDATE kpi_reports SET updated_at=datetime('now') WHERE id=?").run(reportId);
    db.auditLog('kpi_reports', reportId, 'UPDATE_ENTRIES', null, { count: updates.length }, actorId, actorIp);
  })();
}

// ===== KPI Master/Targets/Actuals — CRUD ล้วน (สกัดจาก routes/kpi.js — Session 102) =====
// validation (required field/enum/duplicate) ยังอยู่ใน controller; service ทำ tx+audit เท่านั้น
// title-templates/units/no-patterns เดิมไม่มี transaction/audit ในโค้ด route — คงพฤติกรรมเดิม (ไม่เพิ่ม)

// admin สร้างกลุ่ม KPI
function createGroup({ name, display_order, actorId, actorIp }) {
  return db.transaction(() => {
    const r = db.prepare('INSERT INTO kpi_groups (name, display_order, created_by) VALUES (?, ?, ?)')
      .run(name.trim(), Number(display_order), actorId);
    db.auditLog('kpi_groups', r.lastInsertRowid, 'CREATE', null, { name, display_order }, actorId, actorIp);
    return r.lastInsertRowid;
  })();
}

// admin แก้ไขกลุ่ม KPI
function updateGroup({ id, before, name, display_order, is_active, actorId, actorIp }) {
  db.transaction(() => {
    db.prepare(`
      UPDATE kpi_groups SET
        name = COALESCE(?, name),
        display_order = COALESCE(?, display_order),
        is_active = COALESCE(?, is_active)
      WHERE id = ?
    `).run(
      name !== undefined ? name.trim() : null,
      display_order !== undefined ? Number(display_order) : null,
      is_active !== undefined ? Number(is_active) : null,
      id
    );
    db.auditLog('kpi_groups', id, 'UPDATE', before, { name, display_order, is_active }, actorId, actorIp);
  })();
}

// admin ปิดใช้งานกลุ่ม KPI (soft delete — ต้องไม่มี item ค้าง ตรวจใน controller)
function deactivateGroup({ id, before, actorId, actorIp }) {
  db.transaction(() => {
    db.prepare('UPDATE kpi_groups SET is_active=0 WHERE id=?').run(id);
    db.auditLog('kpi_groups', id, 'DEACTIVATE', before, null, actorId, actorIp);
  })();
}

// admin สร้างหัวข้อ template (ไม่มี transaction/audit ในโค้ดเดิม — คงเดิม)
function createTitleTemplate({ name, group_id, unit_id }) {
  const r = db.prepare('INSERT INTO kpi_title_templates (name, group_id, unit_id) VALUES (?, ?, ?)')
    .run(name.trim(), group_id || null, unit_id || null);
  return r.lastInsertRowid;
}

function updateTitleTemplate({ id, name, is_active, group_id, unit_id }) {
  const gid = group_id !== undefined ? (group_id || null) : undefined;
  const uid = unit_id !== undefined ? (unit_id || null) : undefined;
  db.prepare(`
    UPDATE kpi_title_templates
    SET name    = COALESCE(?, name),
        is_active = COALESCE(?, is_active),
        group_id = CASE WHEN ? IS NOT NULL THEN ? ELSE group_id END,
        unit_id  = CASE WHEN ? IS NOT NULL THEN ? ELSE unit_id  END
    WHERE id=?
  `).run(
    name ?? null,
    is_active ?? null,
    gid !== undefined ? 1 : null, gid ?? null,
    uid !== undefined ? 1 : null, uid ?? null,
    id
  );
}

function createUnit({ name }) {
  const r = db.prepare('INSERT INTO kpi_units (name) VALUES (?)').run(name.trim());
  return r.lastInsertRowid;
}

function updateUnit({ id, name, is_active }) {
  db.prepare('UPDATE kpi_units SET name=COALESCE(?,name), is_active=COALESCE(?,is_active) WHERE id=?')
    .run(name?.trim() ?? null, is_active ?? null, id);
}

function createNoPattern({ prefix, description }) {
  const r = db.prepare('INSERT INTO kpi_no_patterns (prefix, description) VALUES (?, ?)')
    .run(prefix, description?.trim() || null);
  return r.lastInsertRowid;
}

function updateNoPattern({ id, prefix, description, is_active, display_order }) {
  db.prepare(`
    UPDATE kpi_no_patterns SET
      prefix        = COALESCE(?, prefix),
      description   = CASE WHEN ? IS NOT NULL THEN ? ELSE description END,
      is_active     = COALESCE(?, is_active),
      display_order = COALESCE(?, display_order)
    WHERE id=?
  `).run(
    prefix || null,
    description !== undefined ? 1 : null, description !== undefined ? (description?.trim() || null) : null,
    is_active ?? null,
    display_order !== undefined ? Number(display_order) : null,
    id
  );
}

// drag-and-drop reorder (ไม่มี audit ในโค้ดเดิม — คงเดิม)
function reorderItems(items) {
  db.transaction(() => {
    for (const { id, display_order } of items) {
      db.prepare('UPDATE kpi_items SET display_order=? WHERE id=?').run(Number(display_order), id);
    }
  })();
}

// admin สร้าง KPI item — auto-generate kpi_no แบบ prefix-global seq (MAX+1 ต่อ prefix)
function createItem({ group_id, name, unit, description, data_source_type, data_source_key, display_order, target_direction, summary_type, kpi_no_prefix, actorId, actorIp }) {
  return db.transaction(() => {
    const prefix = ((kpi_no_prefix || 'KPI').trim()).replace(/[^A-Za-z0-9\-]/g, '').toUpperCase() || 'KPI';
    const maxSeq = db.prepare(
      `SELECT MAX(CAST(SUBSTR(kpi_no, ?) AS INTEGER)) as m FROM kpi_items WHERE kpi_no LIKE ?`
    ).get(prefix.length + 2, `${prefix}-%`)?.m ?? 0;
    const kpi_no = `${prefix}-${String(maxSeq + 1).padStart(3, '0')}`;

    const r = db.prepare(`
      INSERT INTO kpi_items (kpi_no, group_id, name, unit, description, data_source_type, data_source_key, display_order, target_direction, summary_type, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      kpi_no, group_id, name.trim(),
      unit || null, description || null,
      data_source_type, data_source_key || null,
      Number(display_order), target_direction, summary_type, actorId
    );
    db.auditLog('kpi_items', r.lastInsertRowid, 'CREATE', null,
      { kpi_no, group_id, name, data_source_type, data_source_key, target_direction, summary_type }, actorId, actorIp);
    return r.lastInsertRowid;
  })();
}

// admin แก้ไข KPI item
function updateItem({ id, before, name, unit, group_id, description, data_source_type, data_source_key, display_order, is_active, target_direction, summary_type, actorId, actorIp }) {
  db.transaction(() => {
    db.prepare(`
      UPDATE kpi_items SET
        name             = COALESCE(?, name),
        group_id         = COALESCE(?, group_id),
        unit             = CASE WHEN ? IS NOT NULL THEN ? ELSE unit END,
        description      = CASE WHEN ? IS NOT NULL THEN ? ELSE description END,
        data_source_type = COALESCE(?, data_source_type),
        data_source_key  = CASE WHEN ? IS NOT NULL THEN ? ELSE data_source_key END,
        display_order    = COALESCE(?, display_order),
        is_active        = COALESCE(?, is_active),
        target_direction = COALESCE(?, target_direction),
        summary_type     = COALESCE(?, summary_type)
      WHERE id=?
    `).run(
      name !== undefined ? name.trim() : null,
      group_id !== undefined ? Number(group_id) : null,
      unit !== undefined ? 1 : null, unit !== undefined ? (unit || null) : null,
      description !== undefined ? 1 : null, description !== undefined ? (description || null) : null,
      data_source_type || null,
      data_source_key !== undefined ? 1 : null, data_source_key !== undefined ? (data_source_key || null) : null,
      display_order !== undefined ? Number(display_order) : null,
      is_active !== undefined ? Number(is_active) : null,
      target_direction || null,
      summary_type || null,
      id
    );
    db.auditLog('kpi_items', id, 'UPDATE', before,
      { name, group_id, unit, description, data_source_type, data_source_key, display_order, is_active, target_direction, summary_type },
      actorId, actorIp);
  })();
}

// admin upsert targets (bulk หรือ single — normalize เป็น array ใน controller)
function upsertTargets({ year, entries, actorId, actorIp }) {
  const upsert = db.prepare(`
    INSERT INTO kpi_targets (kpi_item_id, year, month, target_value, created_by)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(kpi_item_id, year, month) DO UPDATE SET target_value=excluded.target_value
  `);
  db.transaction(() => {
    for (const e of entries) {
      const id = e.kpi_item_id ?? e.item_id;
      if (!id || !e.month) continue;
      if (e.month < 1 || e.month > 12) continue;
      upsert.run(id, Number(year), Number(e.month), e.target_value ?? null, actorId);
    }
    db.auditLog('kpi_targets', null, 'UPSERT', null, { year, count: entries.length }, actorId, actorIp);
  })();
}

// admin ลบ targets ทั้งปีของ item
function deleteTargetsYear({ itemId, year, actorId, actorIp }) {
  const r = db.prepare('DELETE FROM kpi_targets WHERE kpi_item_id=? AND year=?').run(Number(itemId), Number(year));
  db.auditLog('kpi_targets', itemId, 'DELETE_YEAR', { year: Number(year) }, null, actorId, actorIp);
  return r.changes;
}

// บันทึกค่าจริงรายเดือน (ไม่มี approval flow) — upsert เดี่ยว
function upsertActual({ kpi_item_id, year, month, actual_value, fail_cause, corrective_action, preventive_action, remark, actorId, actorIp }) {
  return db.transaction(() => {
    db.prepare(`
      INSERT INTO kpi_actuals (kpi_item_id, year, month, actual_value, fail_cause, corrective_action, preventive_action, remark, created_by, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(kpi_item_id, year, month) DO UPDATE SET
        actual_value=excluded.actual_value,
        fail_cause=excluded.fail_cause,
        corrective_action=excluded.corrective_action,
        preventive_action=excluded.preventive_action,
        remark=excluded.remark,
        updated_by=excluded.updated_by,
        updated_at=datetime('now')
    `).run(kpi_item_id, Number(year), Number(month),
           actual_value ?? null, fail_cause ?? null, corrective_action ?? null,
           preventive_action ?? null, remark ?? null, actorId, actorId);
    db.auditLog('kpi_actuals', kpi_item_id, 'UPSERT', null,
      { kpi_item_id, year, month, actual_value }, actorId, actorIp);
    return db.prepare('SELECT * FROM kpi_actuals WHERE kpi_item_id=? AND year=? AND month=?')
      .get(kpi_item_id, Number(year), Number(month));
  })();
}

// บันทึกค่าจริงทุก KPI ของเดือนนั้นพร้อมกัน
function bulkUpsertActuals({ year, month, entries, actorId, actorIp }) {
  const upsert = db.prepare(`
    INSERT INTO kpi_actuals (kpi_item_id, year, month, actual_value, fail_cause, corrective_action, preventive_action, remark, created_by, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(kpi_item_id, year, month) DO UPDATE SET
      actual_value=excluded.actual_value,
      fail_cause=excluded.fail_cause,
      corrective_action=excluded.corrective_action,
      preventive_action=excluded.preventive_action,
      remark=excluded.remark,
      updated_by=excluded.updated_by,
      updated_at=datetime('now')
  `);
  db.transaction(() => {
    for (const e of entries) {
      if (!e.kpi_item_id) continue;
      upsert.run(e.kpi_item_id, Number(year), Number(month),
        e.actual_value ?? null, e.fail_cause ?? null, e.corrective_action ?? null,
        e.preventive_action ?? null, e.remark ?? null, actorId, actorId);
    }
    db.auditLog('kpi_actuals', null, 'BULK_UPSERT', null, { year, month, count: entries.length }, actorId, actorIp);
  })();
}

module.exports = {
  createReport, updateReportEntries, submitReport, approveReport, rejectReport, reviseReport,
  submitActionPlan, approveActionPlan, rejectActionPlan,
  createGroup, updateGroup, deactivateGroup,
  createTitleTemplate, updateTitleTemplate,
  createUnit, updateUnit,
  createNoPattern, updateNoPattern,
  reorderItems, createItem, updateItem,
  upsertTargets, deleteTargetsYear,
  upsertActual, bulkUpsertActuals,
};
