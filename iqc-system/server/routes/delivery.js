const express = require('express');
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const router = express.Router();
const db = require('../db/database');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const uploads = require('../middleware/upload');
const { getUsersByRole, getReceivingQCStaff, createNotification, sendTelegram } = require('../lib/notify');
const { requireReceivingQC } = require('../middleware/requireRole');
const { canPurchasingActOnSupplier } = require('../lib/purchasingScope');
const deliveryService = require('../services/deliveryService');

// role='purchasing' เท่านั้นที่ถูกจำกัด (purchasing_manager/qc_staff/qc_supervisor ผ่านเสมอ — มี guard ของตัวเองอยู่แล้ว)
function blockIfNotAssignedPurchasing(req, res, supplierId) {
  if (req.user.role !== 'purchasing') return false;
  if (canPurchasingActOnSupplier(req.user.id, supplierId)) return false;
  res.status(403).json({ error: 'ไม่มีสิทธิ์ดำเนินการ — Delivery Schedule ของ Supplier นี้มีผู้ดูแลจัดซื้อคนอื่นรับผิดชอบอยู่' });
  return true;
}

// ===== GET /api/delivery =====
router.get('/', auth, (req, res) => {
  const { from, to, supplier_id, status, is_unplanned, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;
  let where = '1=1';
  const params = [];
  if (from) { where += ' AND ds.scheduled_date >= ?'; params.push(from); }
  if (to) { where += ' AND ds.scheduled_date <= ?'; params.push(to); }
  if (supplier_id) { where += ' AND ds.supplier_id = ?'; params.push(supplier_id); }
  if (status) { where += ' AND ds.status = ?'; params.push(status); }
  if (is_unplanned !== undefined) { where += ' AND ds.is_unplanned = ?'; params.push(Number(is_unplanned)); }
  // จัดซื้อเห็นปฏิทินแผนส่งของทุก Supplier เหมือน QC (ตัดสินใจโดย user — เดิม scope ตามผู้ดูแลเหมือน NCR/UAI ทำให้
  // ตัวเลข tag สรุปผลระหว่างจัดซื้อกับ QC ไม่ตรงกัน) — สิทธิ์แก้ไข/acknowledge ยังคง scope ตามผู้ดูแลเหมือนเดิมที่
  // blockIfNotAssignedPurchasing ด้านล่าง ไม่เกี่ยวกัน

  const rows = db.prepare(`
    SELECT ds.*, s.name as supplier_name, u.full_name as created_by_name, ru.full_name as received_by_name
    FROM delivery_schedules ds
    LEFT JOIN suppliers s ON s.id = ds.supplier_id
    LEFT JOIN users u ON u.id = ds.created_by
    LEFT JOIN users ru ON ru.id = ds.received_by
    WHERE ${where}
    ORDER BY ds.scheduled_date DESC, ds.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const total = db.prepare(`SELECT COUNT(*) as c FROM delivery_schedules ds WHERE ${where}`).get(...params);

  // Attach items
  for (const row of rows) {
    row.items = db.prepare('SELECT * FROM delivery_schedule_items WHERE schedule_id = ?').all(row.id);
    row.attachments = db.prepare('SELECT id, file_path, original_name, file_type, uploaded_at FROM delivery_schedule_attachments WHERE schedule_id = ?').all(row.id);
  }

  res.json({ data: rows, total: total.c, page: +page, limit: +limit });
});

// ===== POST /api/delivery — Purchasing สร้างแผน =====
router.post('/', auth, requireRole(['purchasing', 'purchasing_manager']), (req, res) => {
  const { supplier_id, scheduled_date, time_slot, notes, items, has_sample } = req.body;
  if (!supplier_id || !scheduled_date || !time_slot) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูล Supplier, วันที่ และช่วงเวลา' });
  }

  try {
    const id = deliveryService.createSchedule({
      supplier_id, scheduled_date, time_slot, notes, items, has_sample,
      actorId: req.user.id, actorIp: req.ip,
    });
    const schedule = db.prepare('SELECT * FROM delivery_schedules WHERE id = ?').get(id);
    res.json(schedule);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== POST /api/delivery/unplanned — QC Staff บันทึกส่งนอกแผน =====
router.post('/unplanned', auth, requireRole(['qc_staff', 'qc_supervisor']), requireReceivingQC, (req, res) => {
  const { supplier_id, scheduled_date, time_slot, notes, items } = req.body;
  if (!supplier_id || !scheduled_date) {
    return res.status(400).json({ error: 'กรุณากรอก Supplier และวันที่' });
  }

  try {
    const id = deliveryService.createUnplanned({
      supplier_id, scheduled_date, time_slot, notes, items,
      actorId: req.user.id, actorName: req.user.full_name, actorIp: req.ip,
    });
    res.json(db.prepare('SELECT * FROM delivery_schedules WHERE id = ?').get(id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== GET /api/delivery/export/excel — export รายการตาม tag สรุป (คลิก tag ในปฏิทิน) =====
// ต้องอยู่ก่อน GET /:id ไม่งั้น express จะจับ 'export' เป็น :id
const DELIVERY_BUCKET_SQL = {
  pending:      "ds.status = 'pending' AND ds.is_unplanned = 0",
  _all_waiting: "ds.status IN ('pending','acknowledged') AND ds.is_unplanned = 0",
  on_time:      "ds.status = 'on_time' AND ds.is_unplanned = 0",
  late:         "ds.status = 'late' AND ds.is_unplanned = 0",
  _unplanned:   'ds.is_unplanned = 1',
  // ส่งเสร็จสิ้น = รับเข้าแล้วจริง ไม่ว่าจะตามแผนหรือนอกแผน (ตรงกับ summaryBadgeCount ฝั่ง client)
  _completed:   "ds.status IN ('on_time','late')",
};
const DELIVERY_STATUS_LABEL = { pending: 'รอดำเนินการ', acknowledged: 'QC รับทราบแล้ว', on_time: 'ส่งตามแผน', late: 'ส่งนอกแผน', cancelled: 'ยกเลิก', rescheduled: 'เลื่อนวันส่ง' };

router.get('/export/excel', auth, async (req, res) => {
  try {
    const { from, to, bucket } = req.query;
    let where = '1=1';
    const params = [];
    if (from) { where += ' AND ds.scheduled_date >= ?'; params.push(from); }
    if (to)   { where += ' AND ds.scheduled_date <= ?'; params.push(to); }
    if (bucket && DELIVERY_BUCKET_SQL[bucket]) where += ' AND ' + DELIVERY_BUCKET_SQL[bucket];

    const rows = db.prepare(`
      SELECT ds.scheduled_date, ds.time_slot, ds.status, ds.is_unplanned, ds.actual_date, ds.actual_time, ds.notes, ds.late_reason,
             s.name as supplier_name, ru.full_name as received_by_name
      FROM delivery_schedules ds
      LEFT JOIN suppliers s ON s.id = ds.supplier_id
      LEFT JOIN users ru ON ru.id = ds.received_by
      WHERE ${where}
      ORDER BY ds.scheduled_date DESC, ds.time_slot ASC
    `).all(...params);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('สรุปแผนส่งของ');
    ws.columns = [
      { header: 'ผู้ผลิต', key: 'supplier_name', width: 28 },
      { header: 'สถานะ', key: 'status_label', width: 16 },
      { header: 'แผนส่งวันที่', key: 'plan_date', width: 14 },
      { header: 'แผนส่งเวลา', key: 'plan_time', width: 12 },
      { header: 'ส่งจริงวันที่', key: 'actual_date', width: 14 },
      { header: 'ส่งจริงเวลา', key: 'actual_time', width: 12 },
      { header: 'QC ผู้รับ', key: 'received_by_name', width: 18 },
      { header: 'หมายเหตุ', key: 'notes', width: 30 },
      { header: 'เหตุผล', key: 'late_reason', width: 30 },
    ];
    ws.getRow(1).eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3A5C' } };
      cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
    });
    rows.forEach(r => {
      // ไม่มีแผนส่ง (unplanned) — วันที่/เวลาที่กรอกตอนบันทึกคือเวลาที่มาส่งจริง ไม่ใช่แผน ย้ายไปช่อง "ส่งจริง" แทน
      const planDate   = r.is_unplanned ? '-' : r.scheduled_date;
      const planTime   = r.is_unplanned ? '-' : (r.time_slot || '-');
      const actualDate = r.is_unplanned ? r.scheduled_date : (r.actual_date || '-');
      const actualTime = r.is_unplanned ? (r.time_slot || '-') : (r.actual_time || '-');
      ws.addRow({
        supplier_name: r.supplier_name || '-',
        status_label: r.is_unplanned ? 'ไม่มีแผนส่ง' : (DELIVERY_STATUS_LABEL[r.status] || r.status),
        plan_date: planDate,
        plan_time: planTime,
        actual_date: actualDate,
        actual_time: actualTime,
        received_by_name: r.received_by_name || '-',
        notes: r.notes || '',
        late_reason: r.late_reason || '',
      });
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="delivery-${bucket || 'all'}-${from || 'all'}-${to || 'all'}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: 'Export ไม่สำเร็จ: ' + e.message });
  }
});

// ===== GET /api/delivery/:id =====
router.get('/:id', auth, (req, res) => {
  const row = db.prepare(`
    SELECT ds.*, s.name as supplier_name, u.full_name as created_by_name, ru.full_name as received_by_name
    FROM delivery_schedules ds
    LEFT JOIN suppliers s ON s.id = ds.supplier_id
    LEFT JOIN users u ON u.id = ds.created_by
    LEFT JOIN users ru ON ru.id = ds.received_by
    WHERE ds.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
  if (blockIfNotAssignedPurchasing(req, res, row.supplier_id)) return;

  row.items = db.prepare('SELECT * FROM delivery_schedule_items WHERE schedule_id = ?').all(row.id);
  row.attachments = db.prepare('SELECT id, file_path, original_name, file_type, uploaded_at FROM delivery_schedule_attachments WHERE schedule_id = ?').all(row.id);

  res.json(row);
});

// ===== PATCH /api/delivery/:id — Purchasing แก้ไข (เฉพาะ pending) =====
router.patch('/:id', auth, requireRole(['purchasing', 'purchasing_manager']), (req, res) => {
  const schedule = db.prepare('SELECT * FROM delivery_schedules WHERE id = ?').get(req.params.id);
  if (!schedule) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
  if (blockIfNotAssignedPurchasing(req, res, schedule.supplier_id)) return;
  if (schedule.is_unplanned) return res.status(403).json({ error: 'ไม่สามารถแก้ไข schedule ที่ QC บันทึกเป็น unplanned' });
  if (!['pending', 'acknowledged'].includes(schedule.status)) return res.status(400).json({ error: 'แก้ไขได้เฉพาะรายการที่ยังไม่ดำเนินการ' });

  const { scheduled_date, time_slot, notes } = req.body;
  deliveryService.updateSchedule({ schedule, scheduled_date, time_slot, notes, actorId: req.user.id, actorIp: req.ip });
  res.json(db.prepare('SELECT * FROM delivery_schedules WHERE id = ?').get(req.params.id));
});

// ===== DELETE /api/delivery/:id =====
router.delete('/:id', auth, requireRole(['purchasing', 'purchasing_manager']), (req, res) => {
  const schedule = db.prepare('SELECT * FROM delivery_schedules WHERE id = ?').get(req.params.id);
  if (!schedule) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
  if (blockIfNotAssignedPurchasing(req, res, schedule.supplier_id)) return;
  if (schedule.status !== 'pending') return res.status(400).json({ error: 'ลบได้เฉพาะ status=pending' });
  if (schedule.is_unplanned) return res.status(403).json({ error: 'ไม่สามารถลบ unplanned schedule' });
  const deliveryDt = new Date(schedule.scheduled_date);
  const tp = (schedule.time_slot || '23:59').match(/^(\d{2}):(\d{2})/);
  if (tp) deliveryDt.setHours(+tp[1], +tp[2], 0, 0);
  if (deliveryDt < new Date()) return res.status(400).json({ error: 'ไม่สามารถลบรายการที่เลยเวลาส่งของแล้ว QC Staff เป็นผู้ปิดรายการ' });

  const attachFiles = db.prepare('SELECT file_path FROM delivery_schedule_attachments WHERE schedule_id = ?').all(req.params.id);

  deliveryService.deleteSchedule({ schedule, actorId: req.user.id, actorIp: req.ip });

  for (const { file_path } of attachFiles) {
    try { fs.unlinkSync(path.join(__dirname, '../../uploads/general', file_path)); } catch (_) {}
  }

  res.json({ ok: true });
});

// ===== POST /api/delivery/:id/acknowledge — คลัง (หัวหน้าคลัง/ผู้จัดการคลัง) รับทราบ =====
// ย้ายจาก qc_staff/qc_supervisor มาเป็นคลังทั้งหมด (ตามคำขอ user) — qc_staff เหลือแค่หน้าที่บันทึกวันเวลา
// มาส่งจริงผ่าน PATCH /:id/status เท่านั้น ดู isQC/isWarehouse split ใน client (Delivery/index.jsx)
router.post('/:id/acknowledge', auth, requireRole(['warehouse_supervisor', 'warehouse_manager']), (req, res) => {
  const schedule = db.prepare('SELECT * FROM delivery_schedules WHERE id = ?').get(req.params.id);
  if (!schedule) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
  if (schedule.status !== 'pending') return res.status(400).json({ error: 'รับทราบได้เฉพาะ status=pending' });

  deliveryService.acknowledgeSchedule({ schedule, actorId: req.user.id, actorName: req.user.full_name, actorIp: req.ip });
  res.json(db.prepare('SELECT * FROM delivery_schedules WHERE id = ?').get(req.params.id));
});

// ===== PATCH /api/delivery/:id/status — อัปเดตสถานะจริง =====
// QC Staff/Supervisor: on_time / late เมื่อ acknowledged (ของมาถึง บันทึกผล)
// Purchasing: ทุก status เมื่อ pending / acknowledged
router.patch('/:id/status', auth, requireRole(['purchasing', 'purchasing_manager', 'qc_staff', 'qc_supervisor']), requireReceivingQC, (req, res) => {
  const { status, late_reason, rescheduled_date, actual_date, actual_time } = req.body;
  const isQC = ['qc_staff', 'qc_supervisor'].includes(req.user.role);
  const allowed = isQC ? ['on_time', 'late'] : ['on_time', 'late', 'cancelled', 'rescheduled'];
  if (!allowed.includes(status)) return res.status(400).json({ error: isQC ? 'QC บันทึกได้เฉพาะ on_time / late' : 'สถานะไม่ถูกต้อง' });
  // ส่งนอกแผน (late) ไม่บังคับกรอกเหตุผลแล้วตามที่ user ขอ (จะตอบหรือไม่ก็ได้) — คงบังคับเฉพาะ
  // cancelled/rescheduled เพราะเป็น action ที่กระทบแผนเดิมมากกว่า ควรมี audit trail เหตุผลเสมอ
  if ((status === 'cancelled' || status === 'rescheduled') && !late_reason) {
    return res.status(400).json({ error: 'กรุณากรอกเหตุผล' });
  }
  if (status === 'rescheduled' && !rescheduled_date) {
    return res.status(400).json({ error: 'กรุณาระบุวันใหม่' });
  }

  const schedule = db.prepare('SELECT * FROM delivery_schedules WHERE id = ?').get(req.params.id);
  if (!schedule) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
  if (blockIfNotAssignedPurchasing(req, res, schedule.supplier_id)) return;
  if (isQC && schedule.status !== 'acknowledged') {
    return res.status(400).json({ error: 'QC บันทึกผลได้เฉพาะรายการที่รับทราบแล้ว (acknowledged)' });
  }
  if (!isQC && !['pending', 'acknowledged'].includes(schedule.status)) {
    return res.status(400).json({ error: 'ไม่สามารถอัปเดตสถานะนี้ได้' });
  }

  deliveryService.updateStatus({ schedule, status, late_reason, rescheduled_date, actual_date, actual_time, actorId: req.user.id, actorName: req.user.full_name, actorIp: req.ip });
  res.json(db.prepare('SELECT * FROM delivery_schedules WHERE id = ?').get(req.params.id));
});

// ===== POST /api/delivery/:id/attachments =====
router.post('/:id/attachments', auth, requireRole(['purchasing', 'purchasing_manager', 'qc_staff', 'qc_supervisor']), uploads.general.array('files', 10), uploads.verifyMagic, uploads.compressImages, (req, res) => {
  const schedule = db.prepare('SELECT id, supplier_id FROM delivery_schedules WHERE id = ?').get(req.params.id);
  if (!schedule) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
  if (blockIfNotAssignedPurchasing(req, res, schedule.supplier_id)) return;

  const isSample = req.query.type === 'sample';
  const ins = db.prepare('INSERT INTO delivery_schedule_attachments (schedule_id, file_path, original_name, file_type) VALUES (?, ?, ?, ?)');
  for (const file of req.files || []) {
    let fileType = isSample ? 'sample_image' : (['image/jpeg', 'image/png'].includes(file.mimetype) ? 'image' : 'pdf');
    ins.run(req.params.id, file.filename, file.originalname, fileType);
  }
  res.json({ ok: true });
});

// ===== DELETE /api/delivery/:id/attachments/:attachId =====
router.delete('/:id/attachments/:attachId', auth, requireRole(['purchasing', 'purchasing_manager']), (req, res) => {
  const att = db.prepare('SELECT file_path FROM delivery_schedule_attachments WHERE id = ? AND schedule_id = ?').get(req.params.attachId, req.params.id);
  if (!att) return res.status(404).json({ error: 'ไม่พบไฟล์' });
  const schedule = db.prepare('SELECT supplier_id FROM delivery_schedules WHERE id = ?').get(req.params.id);
  if (blockIfNotAssignedPurchasing(req, res, schedule?.supplier_id)) return;
  db.prepare('DELETE FROM delivery_schedule_attachments WHERE id = ? AND schedule_id = ?').run(req.params.attachId, req.params.id);
  if (att.file_path) {
    try { fs.unlinkSync(path.join(__dirname, '../../uploads/general', att.file_path)); } catch (_) {}
  }
  res.json({ ok: true });
});

// ===== GET /api/delivery/:id/history =====
router.get('/:id/history', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT al.action, al.old_value, al.new_value, al.created_at,
           u.full_name as actor_name
    FROM audit_logs al
    LEFT JOIN users u ON u.id = al.user_id
    WHERE al.table_name = 'delivery_schedules' AND al.record_id = ?
    ORDER BY al.created_at ASC
  `).all(req.params.id);

  const history = rows.map(r => ({
    action: r.action,
    old_values: r.old_value ? JSON.parse(r.old_value) : null,
    new_values: r.new_value ? JSON.parse(r.new_value) : null,
    created_at: r.created_at,
    actor_name: r.actor_name,
  }));
  res.json(history);
});

module.exports = router;
