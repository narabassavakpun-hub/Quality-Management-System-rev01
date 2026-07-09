const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const db = require('../db/database');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const uploads = require('../middleware/upload');
const { getUsersByRole, getReceivingQCStaff, createNotification, sendTelegram } = require('../lib/notify');
const { requireReceivingQC } = require('../middleware/requireRole');
const deliveryService = require('../services/deliveryService');

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

  const rows = db.prepare(`
    SELECT ds.*, s.name as supplier_name, u.full_name as created_by_name
    FROM delivery_schedules ds
    LEFT JOIN suppliers s ON s.id = ds.supplier_id
    LEFT JOIN users u ON u.id = ds.created_by
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
router.post('/', auth, requireRole(['purchasing']), (req, res) => {
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

// ===== GET /api/delivery/:id =====
router.get('/:id', auth, (req, res) => {
  const row = db.prepare(`
    SELECT ds.*, s.name as supplier_name, u.full_name as created_by_name
    FROM delivery_schedules ds
    LEFT JOIN suppliers s ON s.id = ds.supplier_id
    LEFT JOIN users u ON u.id = ds.created_by
    WHERE ds.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'ไม่พบข้อมูล' });

  row.items = db.prepare('SELECT * FROM delivery_schedule_items WHERE schedule_id = ?').all(row.id);
  row.attachments = db.prepare('SELECT id, file_path, original_name, file_type, uploaded_at FROM delivery_schedule_attachments WHERE schedule_id = ?').all(row.id);

  res.json(row);
});

// ===== PATCH /api/delivery/:id — Purchasing แก้ไข (เฉพาะ pending) =====
router.patch('/:id', auth, requireRole(['purchasing']), (req, res) => {
  const schedule = db.prepare('SELECT * FROM delivery_schedules WHERE id = ?').get(req.params.id);
  if (!schedule) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
  if (schedule.is_unplanned) return res.status(403).json({ error: 'ไม่สามารถแก้ไข schedule ที่ QC บันทึกเป็น unplanned' });
  if (!['pending', 'acknowledged'].includes(schedule.status)) return res.status(400).json({ error: 'แก้ไขได้เฉพาะรายการที่ยังไม่ดำเนินการ' });

  const { scheduled_date, time_slot, notes } = req.body;
  deliveryService.updateSchedule({ schedule, scheduled_date, time_slot, notes, actorId: req.user.id, actorIp: req.ip });
  res.json(db.prepare('SELECT * FROM delivery_schedules WHERE id = ?').get(req.params.id));
});

// ===== DELETE /api/delivery/:id =====
router.delete('/:id', auth, requireRole(['purchasing']), (req, res) => {
  const schedule = db.prepare('SELECT * FROM delivery_schedules WHERE id = ?').get(req.params.id);
  if (!schedule) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
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

// ===== POST /api/delivery/:id/acknowledge — QC รับทราบ =====
router.post('/:id/acknowledge', auth, requireRole(['qc_staff', 'qc_supervisor']), requireReceivingQC, (req, res) => {
  const schedule = db.prepare('SELECT * FROM delivery_schedules WHERE id = ?').get(req.params.id);
  if (!schedule) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
  if (schedule.status !== 'pending') return res.status(400).json({ error: 'รับทราบได้เฉพาะ status=pending' });

  deliveryService.acknowledgeSchedule({ schedule, actorId: req.user.id, actorName: req.user.full_name, actorIp: req.ip });
  res.json(db.prepare('SELECT * FROM delivery_schedules WHERE id = ?').get(req.params.id));
});

// ===== PATCH /api/delivery/:id/status — อัปเดตสถานะจริง =====
// QC Staff/Supervisor: on_time / late เมื่อ acknowledged (ของมาถึง บันทึกผล)
// Purchasing: ทุก status เมื่อ pending / acknowledged
router.patch('/:id/status', auth, requireRole(['purchasing', 'qc_staff', 'qc_supervisor']), requireReceivingQC, (req, res) => {
  const { status, late_reason, rescheduled_date, actual_date } = req.body;
  const isQC = ['qc_staff', 'qc_supervisor'].includes(req.user.role);
  const allowed = isQC ? ['on_time', 'late'] : ['on_time', 'late', 'cancelled', 'rescheduled'];
  if (!allowed.includes(status)) return res.status(400).json({ error: isQC ? 'QC บันทึกได้เฉพาะ on_time / late' : 'สถานะไม่ถูกต้อง' });
  if ((status === 'late' || status === 'cancelled' || status === 'rescheduled') && !late_reason) {
    return res.status(400).json({ error: 'กรุณากรอกเหตุผล' });
  }
  if (status === 'rescheduled' && !rescheduled_date) {
    return res.status(400).json({ error: 'กรุณาระบุวันใหม่' });
  }

  const schedule = db.prepare('SELECT * FROM delivery_schedules WHERE id = ?').get(req.params.id);
  if (!schedule) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
  if (isQC && schedule.status !== 'acknowledged') {
    return res.status(400).json({ error: 'QC บันทึกผลได้เฉพาะรายการที่รับทราบแล้ว (acknowledged)' });
  }
  if (!isQC && !['pending', 'acknowledged'].includes(schedule.status)) {
    return res.status(400).json({ error: 'ไม่สามารถอัปเดตสถานะนี้ได้' });
  }

  deliveryService.updateStatus({ schedule, status, late_reason, rescheduled_date, actual_date, actorId: req.user.id, actorIp: req.ip });
  res.json(db.prepare('SELECT * FROM delivery_schedules WHERE id = ?').get(req.params.id));
});

// ===== POST /api/delivery/:id/attachments =====
router.post('/:id/attachments', auth, requireRole(['purchasing', 'qc_staff', 'qc_supervisor']), uploads.general.array('files', 10), uploads.verifyMagic, uploads.compressImages, (req, res) => {
  const schedule = db.prepare('SELECT id FROM delivery_schedules WHERE id = ?').get(req.params.id);
  if (!schedule) return res.status(404).json({ error: 'ไม่พบข้อมูล' });

  const isSample = req.query.type === 'sample';
  const ins = db.prepare('INSERT INTO delivery_schedule_attachments (schedule_id, file_path, original_name, file_type) VALUES (?, ?, ?, ?)');
  for (const file of req.files || []) {
    let fileType = isSample ? 'sample_image' : (['image/jpeg', 'image/png'].includes(file.mimetype) ? 'image' : 'pdf');
    ins.run(req.params.id, file.filename, file.originalname, fileType);
  }
  res.json({ ok: true });
});

// ===== DELETE /api/delivery/:id/attachments/:attachId =====
router.delete('/:id/attachments/:attachId', auth, requireRole(['purchasing']), (req, res) => {
  const att = db.prepare('SELECT file_path FROM delivery_schedule_attachments WHERE id = ? AND schedule_id = ?').get(req.params.attachId, req.params.id);
  if (!att) return res.status(404).json({ error: 'ไม่พบไฟล์' });
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
