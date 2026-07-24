// ===== Delivery domain service (สกัดจาก routes/delivery.js — CLAUDE.md §2.2/§8) =====
// business transaction ของ Delivery: create / unplanned / acknowledge / updateStatus
// (edit + delete ยังอยู่ใน route — notification/file-heavy)
const db = require('../db/database');
const { getUsersByRole, createNotification, sendTelegram } = require('../lib/notify');
const { resolveNotifyTargetIds } = require('../lib/purchasingScope');

// คลัง (หัวหน้าคลัง/ผู้จัดการคลัง) เป็นผู้รับแจ้งเตือน "ต้องรับทราบแผนรับเข้า" ทั้งหมดแทน qc_staff/qc_supervisor
// เดิม (ตามคำขอ user, ดู routes/delivery.js's acknowledge endpoint) — รวมไว้จุดเดียวกันซ้ำใช้หลาย notification
function getWarehouseStaff() {
  return [...getUsersByRole('warehouse_supervisor'), ...getUsersByRole('warehouse_manager')];
}

// Purchasing สร้างแผนส่ง (pending) + items + notify (off-hours/holiday) + audit → คืน scheduleId
function createSchedule({ supplier_id, scheduled_date, time_slot, notes, items, has_sample, actorId, actorIp }) {
  const createTx = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO delivery_schedules (supplier_id, scheduled_date, time_slot, notes, is_unplanned, status, has_sample, created_by)
      VALUES (?, ?, ?, ?, 0, 'pending', ?, ?)
    `).run(supplier_id, scheduled_date, time_slot, notes || null, has_sample ? 1 : 0, actorId);

    const scheduleId = result.lastInsertRowid;

    if (Array.isArray(items)) {
      const insItem = db.prepare('INSERT INTO delivery_schedule_items (schedule_id, product_id, item_name, qty_expected, notes, is_urgent) VALUES (?, ?, ?, ?, ?, ?)');
      for (const item of items) {
        insItem.run(scheduleId, item.product_id || null, item.item_name || null, item.qty_expected || null, item.notes || null, item.is_urgent ? 1 : 0);
      }
    }

    const supplier = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(supplier_id);

    const scheduleLink = `/delivery?schedule=${scheduleId}`;

    for (const u of getWarehouseStaff()) {
      createNotification(u.id, 'แจ้งกำหนดส่งสินค้า', `${supplier?.name} วันที่ ${scheduled_date} เวลา ${time_slot}`, scheduleLink);
    }
    sendTelegram(db.getSetting('telegram_group_qc'),
      `แจ้งกำหนดส่งสินค้า\nSupplier: ${supplier?.name}\nวันที่: ${scheduled_date} (${time_slot})\nหมายเหตุ: ${notes || '-'}`
    );

    // แจ้งเตือนพิเศษเมื่อนัดนอกเวลาทำงาน (07:xx หรือ 18:xx)
    const slotHour = time_slot ? parseInt(time_slot.split(':')[0], 10) : -1;
    if (slotHour === 7 || slotHour === 18) {
      const offLabel = slotHour === 7 ? 'ก่อนเข้างาน (07:xx)' : 'หลังเลิกงาน (18:xx)';
      const offMsg   = `${supplier?.name} นัดส่งวันที่ ${scheduled_date} เวลา ${time_slot} — ${offLabel}`;
      for (const u of getWarehouseStaff()) createNotification(u.id, 'แจ้งนัดส่งนอกเวลาทำงาน', offMsg, scheduleLink);
      for (const uid of resolveNotifyTargetIds(supplier_id)) createNotification(uid, 'แจ้งนัดส่งนอกเวลาทำงาน', offMsg, scheduleLink);
      sendTelegram(db.getSetting('telegram_group_qc'),
        `แจ้งเตือน: นัดส่งสินค้านอกเวลาทำงาน\nSupplier: ${supplier?.name}\nวันที่: ${scheduled_date} เวลา: ${time_slot} (${offLabel})`
      );
      sendTelegram(db.getSetting('telegram_group_purchasing'),
        `แจ้งเตือน: นัดส่งสินค้านอกเวลาทำงาน\nSupplier: ${supplier?.name}\nวันที่: ${scheduled_date} เวลา: ${time_slot} (${offLabel})`
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
      for (const u of getWarehouseStaff()) createNotification(u.id, `แจ้งนัดส่งวันหยุด`, weekendMsg, scheduleLink);
      for (const uid of resolveNotifyTargetIds(supplier_id)) createNotification(uid, `แจ้งนัดส่งวันหยุด`, weekendMsg, scheduleLink);
      sendTelegram(db.getSetting('telegram_group_qc'),
        `แจ้งเตือน: นัดส่งสินค้า${dayName}\nSupplier: ${supplier?.name}\nวันที่: ${scheduled_date} เวลา: ${time_slot}`
      );
      sendTelegram(db.getSetting('telegram_group_purchasing'),
        `แจ้งเตือน: นัดส่งสินค้า${dayName}\nSupplier: ${supplier?.name}\nวันที่: ${scheduled_date} เวลา: ${time_slot}`
      );
    }

    db.auditLog('delivery_schedules', scheduleId, 'CREATE', null, { supplier_id, scheduled_date, time_slot }, actorId, actorIp);
    return scheduleId;
  });
  return createTx();
}

// QC Staff/Supervisor บันทึกส่งนอกแผน (is_unplanned=1, on_time) → คืน scheduleId
function createUnplanned({ supplier_id, scheduled_date, time_slot, notes, items, actorId, actorName, actorIp }) {
  const createTx = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO delivery_schedules (supplier_id, scheduled_date, time_slot, notes, is_unplanned, status, created_by, received_by)
      VALUES (?, ?, ?, ?, 1, 'on_time', ?, ?)
    `).run(supplier_id, scheduled_date, time_slot || 'fullday', notes || null, actorId, actorId);

    const scheduleId = result.lastInsertRowid;

    if (Array.isArray(items)) {
      const insItem = db.prepare('INSERT INTO delivery_schedule_items (schedule_id, product_id, item_name, qty_expected, notes, is_urgent) VALUES (?, ?, ?, ?, ?, ?)');
      for (const item of items) {
        insItem.run(scheduleId, item.product_id || null, item.item_name || null, item.qty_expected || null, item.notes || null, item.is_urgent ? 1 : 0);
      }
    }

    const supplier = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(supplier_id);
    for (const uid of resolveNotifyTargetIds(supplier_id)) {
      createNotification(uid, 'สินค้าส่งนอกแผน', `มีสินค้าส่งนอกแผนจาก ${supplier?.name} — กรุณาตรวจสอบ`, `/delivery?schedule=${scheduleId}`);
    }

    sendTelegram(db.getSetting('telegram_group_purchasing'),
      `สินค้าส่งนอกแผน\nSupplier: ${supplier?.name}\nวันที่: ${scheduled_date}\nบันทึกโดย: ${actorName}`
    );

    db.auditLog('delivery_schedules', scheduleId, 'CREATE', null, { supplier_id, is_unplanned: 1 }, actorId, actorIp);
    return scheduleId;
  });
  return createTx();
}

// คลัง (หัวหน้าคลัง/ผู้จัดการคลัง) รับทราบกำหนดส่ง (pending → acknowledged) + notify purchasing + audit
function acknowledgeSchedule({ schedule, actorId, actorName, actorIp }) {
  const ack = db.transaction(() => {
    db.prepare(`UPDATE delivery_schedules SET status='acknowledged', acknowledged_at=CURRENT_TIMESTAMP, acknowledged_by=? WHERE id = ?`).run(actorId, schedule.id);

    // ระบุชื่อผู้ผลิตในข้อความแจ้งเตือน + ลิงก์เจาะจงไปที่รายการนี้เลย (ไม่ใช่แค่ /delivery เฉยๆ) —
    // DeliveryCalendar อ่าน query param นี้แล้วเปิด DetailModal ให้อัตโนมัติ (ดู client Delivery/index.jsx)
    const supplier = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(schedule.supplier_id);
    const supplierName = supplier?.name || '-';
    for (const uid of resolveNotifyTargetIds(schedule.supplier_id)) {
      createNotification(uid, 'คลังรับทราบ Delivery', `${actorName} รับทราบกำหนดส่งวันที่ ${schedule.scheduled_date} — ผู้ผลิต: ${supplierName}`, `/delivery?schedule=${schedule.id}`);
    }
    db.auditLog('delivery_schedules', schedule.id, 'ACKNOWLEDGE', null, { acknowledged_by: actorId }, actorId, actorIp);
  });
  ack();
}

// อัปเดตสถานะจริง (on_time/late/cancelled/rescheduled) + notify (reschedule/holiday/รับของแล้ว) + audit
function updateStatus({ schedule, status, late_reason, rescheduled_date, actual_date, actual_time, actorId, actorName, actorIp }) {
  const upd = db.transaction(() => {
    const newDate = status === 'rescheduled' && rescheduled_date ? rescheduled_date : schedule.scheduled_date;
    // received_by = QC ที่กด "บันทึก" ปิดสถานะสุดท้าย — เก็บเฉพาะตอน on_time/late (ไม่ใช่ cancelled/rescheduled)
    db.prepare(`UPDATE delivery_schedules SET status=?, late_reason=?, rescheduled_date=?, actual_date=?, actual_time=?, scheduled_date=?,
        received_by=CASE WHEN ? IN ('on_time','late') THEN ? ELSE received_by END, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(status, late_reason || null, rescheduled_date || null, actual_date || null, actual_time || null, newDate, status, actorId, schedule.id);

    // แจ้งเตือนจัดซื้อทันทีเมื่อ QC บันทึกผลรับของ (ตามแผน/นอกแผน) — เดิม branch นี้ไม่มีการแจ้งเตือนเลย
    // ทำให้ทั้งกระดิ่งจัดซื้อไม่เด้ง และปฏิทินจัดซื้อไม่ invalidate (ไม่มี createNotification = ไม่มี SSE broadcast)
    // ต้อง refresh หน้าเองถึงจะเห็นสถานะใหม่ (บั๊กที่ user รายงาน)
    if (status === 'on_time' || status === 'late') {
      const supplier = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(schedule.supplier_id);
      const doneMsg = `${actorName} บันทึกรับสินค้าจาก ${supplier?.name} วันที่ ${schedule.scheduled_date} เรียบร้อยแล้ว (${status === 'on_time' ? 'ตามแผน' : 'นอกแผน'})`;
      for (const uid of resolveNotifyTargetIds(schedule.supplier_id)) {
        createNotification(uid, 'QC รับสินค้าเรียบร้อยแล้ว', doneMsg, `/delivery?schedule=${schedule.id}`);
      }
    }

    // S171 — จัดซื้อยกเลิกแผนส่ง (มักเกิดตอน supplier เปลี่ยนแผนกระทันหันหลังคลังรับทราบไปแล้ว) — เดิม branch นี้
    // ไม่มีการแจ้งเตือนเลยเหมือน on_time/late/rescheduled ด้านบน ทำให้คลัง/กลุ่ม QC ไม่รู้ว่ารายการที่รับทราบไปแล้ว
    // ถูกยกเลิก (ต่างจาก deleteSchedule ที่แจ้งคลังอยู่แล้ว — cancel ควรแจ้งเหมือนกันเพราะทดแทน delete ในเคส acknowledged)
    if (status === 'cancelled') {
      const scheduleLink = `/delivery?schedule=${schedule.id}`;
      const supplier = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(schedule.supplier_id);
      const cancelMsg = `${actorName} ยกเลิกกำหนดส่งวันที่ ${schedule.scheduled_date} (${schedule.time_slot}) — ผู้ผลิต: ${supplier?.name}\nเหตุผล: ${late_reason}`;
      for (const u of getWarehouseStaff()) {
        createNotification(u.id, 'ยกเลิกกำหนดส่งสินค้า', cancelMsg, scheduleLink);
      }
      sendTelegram(db.getSetting('telegram_group_qc'),
        `แจ้งยกเลิกกำหนดส่งสินค้า\nSupplier: ${supplier?.name}\nวันที่เดิม: ${schedule.scheduled_date} (${schedule.time_slot})\nเหตุผล: ${late_reason}`
      );
    }

    if (status === 'rescheduled') {
      const scheduleLink = `/delivery?schedule=${schedule.id}`;
      const supplier = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(schedule.supplier_id);
      const reschedMsg = `${supplier?.name} เลื่อนวันส่งจาก ${schedule.scheduled_date} เป็น ${rescheduled_date}`;
      for (const u of getWarehouseStaff()) {
        createNotification(u.id, 'เลื่อนวันส่งสินค้า', reschedMsg, scheduleLink);
      }

      // แจ้งเตือนพิเศษเมื่อวันใหม่ตรงกับวันหยุด
      const dow = new Date(rescheduled_date).getDay();
      const companyHoliday = db.prepare('SELECT name FROM company_holidays WHERE holiday_date = ?').get(rescheduled_date);
      const isHoliday = dow === 0 || dow === 6 || !!companyHoliday;
      if (isHoliday) {
        let dayName = dow === 0 ? 'วันอาทิตย์' : dow === 6 ? 'วันเสาร์' : `วันหยุดบริษัท (${companyHoliday.name})`;
        const holidayMsg = `${supplier?.name} เลื่อนวันส่งเป็น${dayName} ${rescheduled_date}`;
        for (const u of getWarehouseStaff()) {
          createNotification(u.id, `แจ้งเลื่อนวันส่ง (วันหยุด)`, holidayMsg, scheduleLink);
        }
        for (const uid of resolveNotifyTargetIds(schedule.supplier_id)) {
          createNotification(uid, `แจ้งเลื่อนวันส่ง (วันหยุด)`, holidayMsg, scheduleLink);
        }
        sendTelegram(db.getSetting('telegram_group_qc'),
          `แจ้งเตือน: เลื่อนวันส่งสินค้าเป็นวันหยุด\nSupplier: ${supplier?.name}\nวันที่ใหม่: ${rescheduled_date} (${dayName})\nเหตุผล: ${late_reason}`);
        sendTelegram(db.getSetting('telegram_group_purchasing'),
          `แจ้งเตือน: เลื่อนวันส่งสินค้าเป็นวันหยุด\nSupplier: ${supplier?.name}\nวันที่ใหม่: ${rescheduled_date} (${dayName})\nเหตุผล: ${late_reason}`);
      }
    }
    db.auditLog('delivery_schedules', schedule.id, 'STATUS_UPDATE',
      { status: schedule.status, scheduled_date: schedule.scheduled_date },
      { status, scheduled_date: newDate, rescheduled_date: rescheduled_date || null, late_reason: late_reason || null },
      actorId, actorIp);
  });
  upd();
}

// Purchasing แก้ไขแผน (pending/acknowledged) — ถ้า acknowledged → reset เป็น pending ให้ QC รับทราบใหม่
function updateSchedule({ schedule, scheduled_date, time_slot, notes, actorId, actorIp }) {
  const newDate = scheduled_date || schedule.scheduled_date;
  const newTime = time_slot || schedule.time_slot;
  db.transaction(() => {
    const resetAck = schedule.status === 'acknowledged';
    db.prepare(`UPDATE delivery_schedules
      SET scheduled_date=?, time_slot=?, notes=?,
          status=CASE WHEN status='acknowledged' THEN 'pending' ELSE status END,
          acknowledged_at=CASE WHEN status='acknowledged' THEN NULL ELSE acknowledged_at END,
          acknowledged_by=CASE WHEN status='acknowledged' THEN NULL ELSE acknowledged_by END,
          updated_at=CURRENT_TIMESTAMP
      WHERE id=?`)
      .run(newDate, newTime, notes !== undefined ? notes : schedule.notes, schedule.id);

    const scheduleLink = `/delivery?schedule=${schedule.id}`;
    const supplier = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(schedule.supplier_id);
    const editMsg = `${supplier?.name} เปลี่ยนวันส่ง ${schedule.scheduled_date} ${schedule.time_slot} → ${newDate} ${newTime}${resetAck ? ' (กรุณารับทราบใหม่)' : ''}`;
    const title = resetAck ? 'กำหนดส่งสินค้าเปลี่ยนแปลง — กรุณารับทราบใหม่' : 'แก้ไขกำหนดส่งสินค้า';
    for (const u of getWarehouseStaff()) {
      createNotification(u.id, title, editMsg, scheduleLink);
    }

    // แจ้งเตือนพิเศษเมื่อวันใหม่ตรงกับวันหยุด
    if (newDate !== schedule.scheduled_date) {
      const dow = new Date(newDate).getDay();
      const companyHoliday = db.prepare('SELECT name FROM company_holidays WHERE holiday_date = ?').get(newDate);
      const isHoliday = dow === 0 || dow === 6 || !!companyHoliday;
      if (isHoliday) {
        let dayName = dow === 0 ? 'วันอาทิตย์' : dow === 6 ? 'วันเสาร์' : `วันหยุดบริษัท (${companyHoliday.name})`;
        const holidayMsg = `${supplier?.name} แก้ไขวันส่งเป็น${dayName} ${newDate} เวลา ${newTime}`;
        for (const u of getWarehouseStaff()) {
          createNotification(u.id, `แจ้งแก้ไขวันส่ง (วันหยุด)`, holidayMsg, scheduleLink);
        }
        for (const uid of resolveNotifyTargetIds(schedule.supplier_id)) {
          createNotification(uid, `แจ้งแก้ไขวันส่ง (วันหยุด)`, holidayMsg, scheduleLink);
        }
        sendTelegram(db.getSetting('telegram_group_qc'),
          `แจ้งเตือน: แก้ไขวันส่งสินค้าเป็นวันหยุด\nSupplier: ${supplier?.name}\nวันที่ใหม่: ${newDate} (${dayName}) เวลา: ${newTime}`);
        sendTelegram(db.getSetting('telegram_group_purchasing'),
          `แจ้งเตือน: แก้ไขวันส่งสินค้าเป็นวันหยุด\nSupplier: ${supplier?.name}\nวันที่ใหม่: ${newDate} (${dayName}) เวลา: ${newTime}`);
      }
    }

    db.auditLog('delivery_schedules', schedule.id, 'UPDATE',
      { scheduled_date: schedule.scheduled_date, time_slot: schedule.time_slot, notes: schedule.notes },
      { scheduled_date: newDate, time_slot: newTime, notes: notes !== undefined ? notes : schedule.notes },
      actorId, actorIp);
  })();
}

// ลบแผน (pending, non-unplanned) — ไฟล์แนบลบใน controller หลัง commit
function deleteSchedule({ schedule, actorId, actorIp }) {
  db.transaction(() => {
    db.prepare('DELETE FROM delivery_schedule_items WHERE schedule_id = ?').run(schedule.id);
    db.prepare('DELETE FROM delivery_schedule_attachments WHERE schedule_id = ?').run(schedule.id);
    db.prepare('DELETE FROM delivery_schedules WHERE id = ?').run(schedule.id);

    for (const u of getWarehouseStaff()) {
      createNotification(u.id, 'ยกเลิกกำหนดส่งสินค้า', `กำหนดส่งวันที่ ${schedule.scheduled_date} ถูกยกเลิก`, `/delivery`);
    }
    db.auditLog('delivery_schedules', schedule.id, 'DELETE', schedule, null, actorId, actorIp);
  })();
}

module.exports = { createSchedule, createUnplanned, acknowledgeSchedule, updateStatus, updateSchedule, deleteSchedule };
