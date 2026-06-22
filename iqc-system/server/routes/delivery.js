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

  const createSchedule = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO delivery_schedules (supplier_id, scheduled_date, time_slot, notes, is_unplanned, status, has_sample, created_by)
      VALUES (?, ?, ?, ?, 0, 'pending', ?, ?)
    `).run(supplier_id, scheduled_date, time_slot, notes || null, has_sample ? 1 : 0, req.user.id);

    const scheduleId = result.lastInsertRowid;

    if (Array.isArray(items)) {
      const insItem = db.prepare('INSERT INTO delivery_schedule_items (schedule_id, product_id, item_name, qty_expected, notes, is_urgent) VALUES (?, ?, ?, ?, ?, ?)');
      for (const item of items) {
        insItem.run(scheduleId, item.product_id || null, item.item_name || null, item.qty_expected || null, item.notes || null, item.is_urgent ? 1 : 0);
      }
    }

    const supplier = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(supplier_id);

    // Notify QC Staff + Supervisor ปกติ
    for (const u of [...getReceivingQCStaff(), ...getUsersByRole('qc_supervisor')]) {
      createNotification(u.id, 'แจ้งกำหนดส่งสินค้า', `${supplier?.name} วันที่ ${scheduled_date} เวลา ${time_slot}`, `/delivery`);
    }
    sendTelegram(db.getSetting('telegram_group_qc'),
      `[IQC] แจ้งกำหนดส่งสินค้า\nSupplier: ${supplier?.name}\nวันที่: ${scheduled_date} (${time_slot})\nหมายเหตุ: ${notes || '-'}`
    );

    // แจ้งเตือนพิเศษเมื่อนัดนอกเวลาทำงาน (07:xx หรือ 18:xx)
    const slotHour = time_slot ? parseInt(time_slot.split(':')[0], 10) : -1;
    if (slotHour === 7 || slotHour === 18) {
      const offLabel = slotHour === 7 ? 'ก่อนเข้างาน (07:xx)' : 'หลังเลิกงาน (18:xx)';
      const offMsg   = `${supplier?.name} นัดส่งวันที่ ${scheduled_date} เวลา ${time_slot} — ${offLabel}`;
      for (const u of getUsersByRole('qc_supervisor')) createNotification(u.id, 'แจ้งนัดส่งนอกเวลาทำงาน', offMsg, `/delivery`);
      for (const u of getUsersByRole('qc_manager'))   createNotification(u.id, 'แจ้งนัดส่งนอกเวลาทำงาน', offMsg, `/delivery`);
      for (const u of getUsersByRole('purchasing'))   createNotification(u.id, 'แจ้งนัดส่งนอกเวลาทำงาน', offMsg, `/delivery`);
      sendTelegram(db.getSetting('telegram_group_qc'),
        `[IQC] แจ้งเตือน: นัดส่งสินค้านอกเวลาทำงาน\nSupplier: ${supplier?.name}\nวันที่: ${scheduled_date} เวลา: ${time_slot} (${offLabel})`
      );
      sendTelegram(db.getSetting('telegram_group_purchasing'),
        `[IQC] แจ้งเตือน: นัดส่งสินค้านอกเวลาทำงาน\nSupplier: ${supplier?.name}\nวันที่: ${scheduled_date} เวลา: ${time_slot} (${offLabel})`
      );
    }

    // แจ้งเตือนพิเศษเมื่อนัดส่งวันหยุด (เสาร์-อาทิตย์ หรือวันหยุดบริษัท)
    const dow = new Date(scheduled_date).getDay(); // 0=Sun, 6=Sat
    const companyHoliday = db.prepare("SELECT name FROM company_holidays WHERE holiday_date = ?").get(scheduled_date);
    const isHoliday = dow === 0 || dow === 6 || !!companyHoliday;
    if (isHoliday) {
      let dayName = '';
      if (dow === 0) dayName = 'วันอาทิตย์';
      else if (dow === 6) dayName = 'วันเสาร์';
      else dayName = `วันหยุดบริษัท (${companyHoliday.name})`;
      const weekendMsg = `${supplier?.name} นัดส่งสินค้า${dayName} ${scheduled_date} เวลา ${time_slot}`;
      for (const u of getReceivingQCStaff())      createNotification(u.id, `แจ้งนัดส่งวันหยุด`, weekendMsg, `/delivery`);
      for (const u of getUsersByRole('qc_supervisor')) createNotification(u.id, `แจ้งนัดส่งวันหยุด`, weekendMsg, `/delivery`);
      for (const u of getUsersByRole('qc_manager'))   createNotification(u.id, `แจ้งนัดส่งวันหยุด`, weekendMsg, `/delivery`);
      for (const u of getUsersByRole('purchasing'))   createNotification(u.id, `แจ้งนัดส่งวันหยุด`, weekendMsg, `/delivery`);
      sendTelegram(db.getSetting('telegram_group_qc'),
        `[IQC] แจ้งเตือน: นัดส่งสินค้า${dayName}\nSupplier: ${supplier?.name}\nวันที่: ${scheduled_date} เวลา: ${time_slot}`
      );
      sendTelegram(db.getSetting('telegram_group_purchasing'),
        `[IQC] แจ้งเตือน: นัดส่งสินค้า${dayName}\nSupplier: ${supplier?.name}\nวันที่: ${scheduled_date} เวลา: ${time_slot}`
      );
    }

    db.auditLog('delivery_schedules', scheduleId, 'CREATE', null, { supplier_id, scheduled_date, time_slot }, req.user.id, req.ip);
    return scheduleId;
  });

  try {
    const id = createSchedule();
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

  const createUnplanned = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO delivery_schedules (supplier_id, scheduled_date, time_slot, notes, is_unplanned, status, created_by)
      VALUES (?, ?, ?, ?, 1, 'on_time', ?)
    `).run(supplier_id, scheduled_date, time_slot || 'fullday', notes || null, req.user.id);

    const scheduleId = result.lastInsertRowid;

    if (Array.isArray(items)) {
      const insItem = db.prepare('INSERT INTO delivery_schedule_items (schedule_id, product_id, item_name, qty_expected, notes, is_urgent) VALUES (?, ?, ?, ?, ?, ?)');
      for (const item of items) {
        insItem.run(scheduleId, item.product_id || null, item.item_name || null, item.qty_expected || null, item.notes || null, item.is_urgent ? 1 : 0);
      }
    }

    const purchasings = getUsersByRole('purchasing');
    const supplier = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(supplier_id);
    for (const u of purchasings) {
      createNotification(u.id, 'สินค้าส่งนอกแผน', `มีสินค้าส่งนอกแผนจาก ${supplier?.name} — กรุณาตรวจสอบ`, `/delivery`);
    }

    sendTelegram(db.getSetting('telegram_group_purchasing'),
      `[IQC] สินค้าส่งนอกแผน\nSupplier: ${supplier?.name}\nวันที่: ${scheduled_date}\nบันทึกโดย: ${req.user.full_name}`
    );

    db.auditLog('delivery_schedules', scheduleId, 'CREATE', null, { supplier_id, is_unplanned: 1 }, req.user.id, req.ip);
    return scheduleId;
  });

  try {
    const id = createUnplanned();
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
  const newDate = scheduled_date || schedule.scheduled_date;
  const newTime = time_slot || schedule.time_slot;

  const update = db.transaction(() => {
    // ถ้าเคย acknowledged แล้ว → reset กลับ pending เพื่อให้ QC รับทราบวันใหม่อีกครั้ง
    const resetAck = schedule.status === 'acknowledged';
    db.prepare(`UPDATE delivery_schedules
      SET scheduled_date=?, time_slot=?, notes=?,
          status=CASE WHEN status='acknowledged' THEN 'pending' ELSE status END,
          acknowledged_at=CASE WHEN status='acknowledged' THEN NULL ELSE acknowledged_at END,
          acknowledged_by=CASE WHEN status='acknowledged' THEN NULL ELSE acknowledged_by END,
          updated_at=CURRENT_TIMESTAMP
      WHERE id=?`)
      .run(newDate, newTime, notes !== undefined ? notes : schedule.notes, req.params.id);

    const supplier = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(schedule.supplier_id);
    const editMsg = `${supplier?.name} เปลี่ยนวันส่ง ${schedule.scheduled_date} ${schedule.time_slot} → ${newDate} ${newTime}${resetAck ? ' (กรุณารับทราบใหม่)' : ''}`;
    const qcStaff = getReceivingQCStaff();
    const qcSupervisors = getUsersByRole('qc_supervisor');
    const title = resetAck ? 'กำหนดส่งสินค้าเปลี่ยนแปลง — กรุณารับทราบใหม่' : 'แก้ไขกำหนดส่งสินค้า';
    for (const u of [...qcStaff, ...qcSupervisors]) {
      createNotification(u.id, title, editMsg, `/delivery`);
    }

    // แจ้งเตือนพิเศษเมื่อวันใหม่ตรงกับวันหยุด
    if (newDate !== schedule.scheduled_date) {
      const dow = new Date(newDate).getDay();
      const companyHoliday = db.prepare('SELECT name FROM company_holidays WHERE holiday_date = ?').get(newDate);
      const isHoliday = dow === 0 || dow === 6 || !!companyHoliday;
      if (isHoliday) {
        let dayName = dow === 0 ? 'วันอาทิตย์' : dow === 6 ? 'วันเสาร์' : `วันหยุดบริษัท (${companyHoliday.name})`;
        const holidayMsg = `${supplier?.name} แก้ไขวันส่งเป็น${dayName} ${newDate} เวลา ${newTime}`;
        for (const u of [...getReceivingQCStaff(), ...getUsersByRole('qc_supervisor'), ...getUsersByRole('qc_manager'), ...getUsersByRole('purchasing')]) {
          createNotification(u.id, `แจ้งแก้ไขวันส่ง (วันหยุด)`, holidayMsg, `/delivery`);
        }
        sendTelegram(db.getSetting('telegram_group_qc'),
          `[IQC] แจ้งเตือน: แก้ไขวันส่งสินค้าเป็นวันหยุด\nSupplier: ${supplier?.name}\nวันที่ใหม่: ${newDate} (${dayName}) เวลา: ${newTime}`);
        sendTelegram(db.getSetting('telegram_group_purchasing'),
          `[IQC] แจ้งเตือน: แก้ไขวันส่งสินค้าเป็นวันหยุด\nSupplier: ${supplier?.name}\nวันที่ใหม่: ${newDate} (${dayName}) เวลา: ${newTime}`);
      }
    }

    db.auditLog('delivery_schedules', req.params.id, 'UPDATE',
      { scheduled_date: schedule.scheduled_date, time_slot: schedule.time_slot, notes: schedule.notes },
      { scheduled_date: newDate, time_slot: newTime, notes: notes !== undefined ? notes : schedule.notes },
      req.user.id, req.ip);
  });

  update();
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

  const del = db.transaction(() => {
    db.prepare('DELETE FROM delivery_schedule_items WHERE schedule_id = ?').run(req.params.id);
    db.prepare('DELETE FROM delivery_schedule_attachments WHERE schedule_id = ?').run(req.params.id);
    db.prepare('DELETE FROM delivery_schedules WHERE id = ?').run(req.params.id);

    const qcStaff = getReceivingQCStaff();
    const qcSupervisors = getUsersByRole('qc_supervisor');
    for (const u of [...qcStaff, ...qcSupervisors]) {
      createNotification(u.id, 'ยกเลิกกำหนดส่งสินค้า', `กำหนดส่งวันที่ ${schedule.scheduled_date} ถูกยกเลิก`, `/delivery`);
    }
    db.auditLog('delivery_schedules', req.params.id, 'DELETE', schedule, null, req.user.id, req.ip);
  });

  del();

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

  const ack = db.transaction(() => {
    db.prepare(`UPDATE delivery_schedules SET status='acknowledged', acknowledged_at=CURRENT_TIMESTAMP, acknowledged_by=? WHERE id = ?`).run(req.user.id, req.params.id);

    const purchasings = getUsersByRole('purchasing');
    for (const u of purchasings) {
      createNotification(u.id, 'QC รับทราบ Delivery', `${req.user.full_name} รับทราบกำหนดส่งวันที่ ${schedule.scheduled_date}`, `/delivery`);
    }
    db.auditLog('delivery_schedules', req.params.id, 'ACKNOWLEDGE', null, { acknowledged_by: req.user.id }, req.user.id, req.ip);
  });

  ack();
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

  const upd = db.transaction(() => {
    const newDate = status === 'rescheduled' && rescheduled_date ? rescheduled_date : schedule.scheduled_date;
    db.prepare(`UPDATE delivery_schedules SET status=?, late_reason=?, rescheduled_date=?, actual_date=?, scheduled_date=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(status, late_reason || null, rescheduled_date || null, actual_date || null, newDate, req.params.id);

    if (status === 'rescheduled') {
      const supplier = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(schedule.supplier_id);
      const reschedMsg = `${supplier?.name} เลื่อนวันส่งจาก ${schedule.scheduled_date} เป็น ${rescheduled_date}`;
      for (const u of [...getReceivingQCStaff(), ...getUsersByRole('qc_supervisor')]) {
        createNotification(u.id, 'เลื่อนวันส่งสินค้า', reschedMsg, `/delivery`);
      }

      // แจ้งเตือนพิเศษเมื่อวันใหม่ตรงกับวันหยุด
      const dow = new Date(rescheduled_date).getDay();
      const companyHoliday = db.prepare('SELECT name FROM company_holidays WHERE holiday_date = ?').get(rescheduled_date);
      const isHoliday = dow === 0 || dow === 6 || !!companyHoliday;
      if (isHoliday) {
        let dayName = dow === 0 ? 'วันอาทิตย์' : dow === 6 ? 'วันเสาร์' : `วันหยุดบริษัท (${companyHoliday.name})`;
        const holidayMsg = `${supplier?.name} เลื่อนวันส่งเป็น${dayName} ${rescheduled_date}`;
        for (const u of [...getReceivingQCStaff(), ...getUsersByRole('qc_supervisor'), ...getUsersByRole('qc_manager'), ...getUsersByRole('purchasing')]) {
          createNotification(u.id, `แจ้งเลื่อนวันส่ง (วันหยุด)`, holidayMsg, `/delivery`);
        }
        sendTelegram(db.getSetting('telegram_group_qc'),
          `[IQC] แจ้งเตือน: เลื่อนวันส่งสินค้าเป็นวันหยุด\nSupplier: ${supplier?.name}\nวันที่ใหม่: ${rescheduled_date} (${dayName})\nเหตุผล: ${late_reason}`);
        sendTelegram(db.getSetting('telegram_group_purchasing'),
          `[IQC] แจ้งเตือน: เลื่อนวันส่งสินค้าเป็นวันหยุด\nSupplier: ${supplier?.name}\nวันที่ใหม่: ${rescheduled_date} (${dayName})\nเหตุผล: ${late_reason}`);
      }
    }
    db.auditLog('delivery_schedules', req.params.id, 'STATUS_UPDATE',
      { status: schedule.status, scheduled_date: schedule.scheduled_date },
      { status, scheduled_date: newDate, rescheduled_date: rescheduled_date || null, late_reason: late_reason || null },
      req.user.id, req.ip);
  });

  upd();
  res.json(db.prepare('SELECT * FROM delivery_schedules WHERE id = ?').get(req.params.id));
});

// ===== POST /api/delivery/:id/attachments =====
router.post('/:id/attachments', auth, requireRole(['purchasing', 'qc_staff', 'qc_supervisor']), uploads.general.array('files', 10), uploads.verifyMagic, (req, res) => {
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
