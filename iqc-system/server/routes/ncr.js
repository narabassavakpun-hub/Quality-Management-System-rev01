const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const db = require('../db/database');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const uploads = require('../middleware/upload');
const { getUsersByRole, getReceivingQCStaff, createNotification, sendTelegram } = require('../lib/notify');
const ncrService = require('../services/ncrService');

// qc_staff ที่เป็น actor ใน NCR (สร้าง/ลบ/re-inspect/upload) ต้องเป็นสถานี incoming
router.use((req, res, next) => {
  if (req.user?.role === 'qc_staff' && req.user?.qc_station !== 'incoming') {
    // อนุญาตเฉพาะ GET (ดูข้อมูล NCR) กับ qc_staff สถานีอื่น — action อื่นบล็อก
    if (req.method !== 'GET') {
      return res.status(403).json({ error: 'เฉพาะ QC รับเข้า (สถานี incoming) เท่านั้น' });
    }
  }
  next();
});

// ===== GET /api/ncr =====
router.get('/', auth, (req, res) => {
  const { status, supplier_id, from, to, search, page = 1, limit = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  let where = '1=1';
  const params = [];
  if (status) { where += ' AND n.status = ?'; params.push(status); }
  if (supplier_id) { where += ' AND b.supplier_id = ?'; params.push(supplier_id); }
  if (from) { where += ' AND DATE(n.created_at) >= ?'; params.push(from); }
  if (to) { where += ' AND DATE(n.created_at) <= ?'; params.push(to); }
  if (search) { where += ' AND (n.ncr_code LIKE ? OR n.po_no LIKE ? OR n.invoice_no LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }

  const rows = db.prepare(`
    SELECT n.*, s.name as supplier_name, u.full_name as created_by_name,
           b.invoice_no as bill_invoice, b.po_no as bill_po
    FROM ncrs n
    LEFT JOIN bills b ON b.id = n.bill_id
    LEFT JOIN suppliers s ON s.id = b.supplier_id
    LEFT JOIN users u ON u.id = n.created_by
    WHERE ${where}
    ORDER BY n.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, Number(limit), offset);

  const total = db.prepare(`
    SELECT COUNT(*) as c FROM ncrs n
    LEFT JOIN bills b ON b.id = n.bill_id WHERE ${where}
  `).get(...params);

  // Attach items summary for each NCR
  for (const row of rows) {
    row.items = db.prepare('SELECT ni.*, dc.name as defect_category_name FROM ncr_items ni LEFT JOIN defect_categories dc ON dc.id = ni.defect_category_id WHERE ni.ncr_id = ?').all(row.id);
  }

  res.json({ data: rows, total: total.c, page: Number(page), limit: Number(limit) });
});

// ===== POST /api/ncr =====
router.post('/', auth, requireRole(['qc_staff', 'qc_supervisor']), uploads.ncr.array('images', 10), uploads.verifyMagic, uploads.compressImages, (req, res) => {
  const { bill_id, severity, items } = req.body;
  // items: JSON string array of { bill_item_id, item_name, qty_received, qty_sampled, qty_failed, defect_category_id, defect_detail, problem_description }
  let parsedItems = [];
  try {
    parsedItems = typeof items === 'string' ? JSON.parse(items) : (Array.isArray(items) ? items : []);
  } catch { return res.status(400).json({ error: 'รูปแบบข้อมูล items ไม่ถูกต้อง' }); }

  // Backward compat: legacy single-item format (bill_item_id + description)
  const legacyDesc = req.body.description || req.body.problem_description;
  if (!parsedItems.length && req.body.bill_item_id && legacyDesc) {
    const bi = db.prepare('SELECT * FROM bill_items WHERE id = ?').get(req.body.bill_item_id);
    if (bi) {
      parsedItems = [{
        bill_item_id: bi.id,
        item_name: bi.item_name || '',
        qty_received: bi.qty_received || 0,
        qty_sampled: bi.qty_sampled || 0,
        qty_failed: bi.qty_failed || 0,
        defect_category_id: bi.defect_category_id || null,
        defect_detail: legacyDesc,
      }];
    }
  }

  if (!bill_id || !parsedItems.length || !severity) {
    return res.status(400).json({ error: 'กรุณาระบุ bill_id, severity และรายการที่ไม่ผ่าน (items)' });
  }

  const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(bill_id);
  if (!bill) return res.status(404).json({ error: 'ไม่พบบิล' });

  // Check each bill_item_id isn't already included in another NCR
  const alreadyIncluded = [];
  for (const item of parsedItems) {
    if (item.bill_item_id) {
      const existing = db.prepare(`
        SELECT n.ncr_code FROM ncr_items ni JOIN ncrs n ON n.id = ni.ncr_id
        WHERE ni.bill_item_id = ? AND n.status NOT IN ('cancelled')
      `).get(item.bill_item_id);
      if (existing) alreadyIncluded.push({ bill_item_id: item.bill_item_id, ncr_code: existing.ncr_code });
    }
  }
  if (alreadyIncluded.length) {
    return res.status(400).json({ error: `รายการ bill_item บางรายการถูก include ใน NCR อื่นแล้ว: ${alreadyIncluded.map(a => a.ncr_code).join(', ')}` });
  }

  const isNCP = severity === 'minor';

  try {
    const id = ncrService.createNcr({
      bill, items: parsedItems, severity, isNCP, files: req.files,
      actorId: req.user.id, actorRole: req.user.role, actorIp: req.ip,
    });
    const ncr = db.prepare('SELECT * FROM ncrs WHERE id = ?').get(id);
    ncr.items = db.prepare('SELECT * FROM ncr_items WHERE ncr_id = ?').all(id);
    ncr.images = db.prepare('SELECT * FROM ncr_images WHERE ncr_id = ?').all(id);
    res.json(ncr);
  } catch (e) {
    console.error('[NCR CREATE]', e);
    res.status(500).json({ error: e.message });
  }
});

// ===== GET /api/ncr/:id =====
router.get('/:id', auth, (req, res) => {
  const ncr = db.prepare(`
    SELECT n.*, s.name as supplier_name, b.invoice_no as bill_invoice, b.po_no as bill_po,
           b.received_date as bill_received_date, bu.full_name as bill_received_by_name,
           u.full_name as created_by_name
    FROM ncrs n
    LEFT JOIN bills b ON b.id = n.bill_id
    LEFT JOIN suppliers s ON s.id = b.supplier_id
    LEFT JOIN users bu ON bu.id = b.created_by
    LEFT JOIN users u ON u.id = n.created_by
    WHERE n.id = ?
  `).get(req.params.id);
  if (!ncr) return res.status(404).json({ error: 'ไม่พบ NCR' });

  ncr.items = db.prepare(`
    SELECT ni.*, dc.name as defect_category_name
    FROM ncr_items ni LEFT JOIN defect_categories dc ON dc.id = ni.defect_category_id
    WHERE ni.ncr_id = ?
  `).all(ncr.id);

  // ดึงรูปภาพปัญหาจาก bill_item_images ของแต่ละรายการ
  for (const item of ncr.items) {
    item.bill_item_images = item.bill_item_id
      ? db.prepare('SELECT * FROM bill_item_images WHERE bill_item_id = ?').all(item.bill_item_id)
      : [];
  }

  // รูปถ่ายบิล (สำหรับเปิด modal ตอนคลิก Invoice No.)
  ncr.bill_images = ncr.bill_id
    ? db.prepare('SELECT * FROM bill_images WHERE bill_id = ?').all(ncr.bill_id)
    : [];

  ncr.images = db.prepare('SELECT * FROM ncr_images WHERE ncr_id = ?').all(ncr.id);

  ncr.approvals = db.prepare(`
    SELECT na.*, u.full_name
    FROM ncr_approvals na LEFT JOIN users u ON u.id = na.user_id
    WHERE na.ncr_id = ? ORDER BY na.created_at
  `).all(ncr.id);

  // Supplier link/token — เปิดเผยเฉพาะ purchasing/admin (DEVMORE M9)
  const canSeeLink = ['purchasing', 'admin'].includes(req.user.role);
  if (canSeeLink && ncr.supplier_token) {
    const appUrl = db.getSetting('app_url') || '';
    ncr.supplier_link = `${appUrl}/supplier/ncr/${ncr.supplier_token}`;
  } else {
    delete ncr.supplier_token;
  }

  if (ncr.purchasing_received_by) {
    const pu = db.prepare('SELECT full_name FROM users WHERE id = ?').get(ncr.purchasing_received_by);
    ncr.purchasing_received_by_name = pu?.full_name || null;
  }
  if (ncr.link_copied_by) {
    const lu = db.prepare('SELECT full_name FROM users WHERE id = ?').get(ncr.link_copied_by);
    ncr.link_copied_by_name = lu?.full_name || null;
  }

  ncr.supplier_response = db.prepare('SELECT * FROM supplier_responses WHERE ncr_id = ? AND superseded_at IS NULL ORDER BY id DESC LIMIT 1').get(ncr.id);
  if (ncr.supplier_response) {
    ncr.supplier_response.attachments = db.prepare('SELECT * FROM supplier_response_attachments WHERE response_id = ?').all(ncr.supplier_response.id);
  }

  ncr.re_inspections = db.prepare('SELECT * FROM re_inspections WHERE ncr_id = ? ORDER BY round').all(ncr.id);

  // Backward compat: expose first item's fields at root level
  if (ncr.items.length > 0) {
    ncr.item_name = ncr.items[0].item_name;
    ncr.qty_failed = ncr.items[0].qty_failed;
  }

  res.json(ncr);
});

// ===== DELETE /api/ncr/:id — self-delete (qc_staff เจ้าของ, pending_supervisor เท่านั้น) =====
router.delete('/:id', auth, requireRole(['qc_staff', 'qc_supervisor']), (req, res) => {
  const ncr = db.prepare('SELECT * FROM ncrs WHERE id = ?').get(req.params.id);
  if (!ncr) return res.status(404).json({ error: 'ไม่พบ NCR' });
  if (ncr.created_by !== req.user.id) return res.status(403).json({ error: 'ไม่มีสิทธิ์ลบ NCR ของผู้อื่น' });
  if (ncr.status !== 'pending_supervisor') return res.status(400).json({ error: 'ลบ NCR ได้เฉพาะสถานะ pending_supervisor' });

  // DEVMORE M3 — เก็บ path รูป NCR ก่อนลบ row เพื่อลบไฟล์จริงหลัง commit
  const ncrImageFiles = db.prepare('SELECT file_path FROM ncr_images WHERE ncr_id = ?').all(ncr.id).map(r => r.file_path);

  const del = db.transaction(() => {
    db.prepare('DELETE FROM ncr_images WHERE ncr_id = ?').run(ncr.id);
    db.prepare('DELETE FROM ncr_items WHERE ncr_id = ?').run(ncr.id);
    db.prepare('DELETE FROM ncrs WHERE id = ?').run(ncr.id);
    db.auditLog('ncrs', ncr.id, 'DELETE', ncr, null, req.user.id, req.ip);
  });

  del();
  // DEVMORE M3 — ลบไฟล์จริง (uploads/ncr)
  for (const f of ncrImageFiles) {
    try {
      const p = path.join(__dirname, '../../uploads/ncr', f);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {}
  }
  res.json({ ok: true });
});

// ===== POST /api/ncr/:id/approve  (state machine) =====
router.post('/:id/approve', auth, requireRole(['qc_supervisor', 'qc_manager', 'qmr']), (req, res) => {
  const ncr = db.prepare('SELECT * FROM ncrs WHERE id = ?').get(req.params.id);
  if (!ncr) return res.status(404).json({ error: 'ไม่พบ NCR' });

  const { comment, action, disposition, disposition_note, disposition_due_date, effectiveness_check_date } = req.body;

  try {
    const next = ncrService.approveNcr({
      ncr, actorId: req.user.id, actorRole: req.user.role, actorIp: req.ip,
      comment, action, disposition, disposition_note, disposition_due_date, effectiveness_check_date,
    });
    res.json({ ok: true, status: next });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

// ===== PATCH /api/ncr/:id/disposition — QC Manager บันทึก disposition (แยก endpoint) =====
router.patch('/:id/disposition', auth, requireRole(['qc_manager']), (req, res) => {
  const ncr = db.prepare('SELECT * FROM ncrs WHERE id = ?').get(req.params.id);
  if (!ncr) return res.status(404).json({ error: 'ไม่พบ NCR' });
  if (!['pending_manager', 'pending_manager_review'].includes(ncr.status)) {
    return res.status(400).json({ error: 'บันทึก disposition ได้เฉพาะ pending_manager หรือ pending_manager_review' });
  }
  const { disposition, disposition_note, disposition_due_date, effectiveness_check_date } = req.body;
  if (!disposition) return res.status(400).json({ error: 'กรุณาเลือก disposition' });

  db.prepare(`UPDATE ncrs SET disposition=?, disposition_note=?, disposition_due_date=?, effectiveness_check_date=?, disposition_by=? WHERE id=?`)
    .run(disposition, disposition_note || null, disposition_due_date || null, effectiveness_check_date || null, req.user.id, ncr.id);

  res.json({ ok: true, ...db.prepare('SELECT * FROM ncrs WHERE id = ?').get(ncr.id) });
});

// ===== POST /api/ncr/:id/effectiveness — QC Manager บันทึกผล effectiveness =====
router.post('/:id/effectiveness', auth, requireRole(['qc_manager']), (req, res) => {
  const ncr = db.prepare('SELECT * FROM ncrs WHERE id = ?').get(req.params.id);
  if (!ncr) return res.status(404).json({ error: 'ไม่พบ NCR' });
  if (ncr.status !== 'closed') return res.status(400).json({ error: 'บันทึก effectiveness ได้เฉพาะ NCR สถานะ closed' });

  const { effectiveness_result, effectiveness_note, effectiveness_check_date: new_check_date } = req.body;
  if (!effectiveness_result) return res.status(400).json({ error: 'กรุณาระบุผล effectiveness (effective/not_effective)' });

  db.prepare(`UPDATE ncrs SET effectiveness_result=?, effectiveness_note=?, effectiveness_checked_by=?, effectiveness_checked_at=CURRENT_TIMESTAMP${new_check_date ? ', effectiveness_check_date=?' : ''} WHERE id=?`)
    .run(effectiveness_result, effectiveness_note || null, req.user.id, ...(new_check_date ? [new_check_date] : []), ncr.id);

  if (effectiveness_result === 'not_effective' && new_check_date) {
    createNotification(req.user.id, 'กำหนด effectiveness check ใหม่', `${ncr.ncr_code} ต้องตรวจซ้ำ ${new_check_date}`, `/ncr/${ncr.id}`);
  }

  res.json(db.prepare('SELECT * FROM ncrs WHERE id = ?').get(ncr.id));
});

// ===== POST /api/ncr/:id/re-inspect — บันทึกผล re-inspection =====
router.post('/:id/re-inspect', auth, requireRole(['qc_staff', 'qc_supervisor']), uploads.ncr.array('images', 10), uploads.verifyMagic, uploads.compressImages, (req, res) => {
  const ncr = db.prepare('SELECT * FROM ncrs WHERE id = ?').get(req.params.id);
  if (!ncr) return res.status(404).json({ error: 'ไม่พบ NCR' });
  if (!['pending_supplier', 'pending_manager_review'].includes(ncr.status)) {
    return res.status(400).json({ error: 'Re-inspection ได้เฉพาะสถานะ pending_supplier หรือ pending_manager_review' });
  }
  if (ncr.disposition && ncr.disposition !== 're_inspect') {
    return res.status(400).json({ error: 'NCR นี้ไม่ได้กำหนด disposition = re_inspect' });
  }

  const { qty_re_inspected, qty_passed, qty_failed, result, notes } = req.body;
  if (!qty_re_inspected || !result) return res.status(400).json({ error: 'กรุณากรอกจำนวนตรวจซ้ำและผล' });

  // Auto increment round
  const lastRound = db.prepare('SELECT MAX(round) as r FROM re_inspections WHERE ncr_id = ?').get(ncr.id);
  const round = (lastRound?.r || 0) + 1;

  const save = db.transaction(() => {
    const result2 = db.prepare(`
      INSERT INTO re_inspections (ncr_id, round, inspector_id, inspected_at, qty_re_inspected, qty_passed, qty_failed, result, notes)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?)
    `).run(ncr.id, round, req.user.id, qty_re_inspected, qty_passed || 0, qty_failed || 0, result, notes || null);

    if (req.files?.length) {
      const insImg = db.prepare('INSERT INTO re_inspection_images (re_inspection_id, file_path) VALUES (?, ?)');
      for (const file of req.files) insImg.run(result2.lastInsertRowid, file.filename);
    }

    // Warn QMR if round > 3
    if (round > 3) {
      for (const u of getUsersByRole('qmr')) {
        createNotification(u.id, 'ตรวจซ้ำมากกว่า 3 ครั้ง', `${ncr.ncr_code} ตรวจซ้ำรอบที่ ${round} แล้ว`, `/ncr/${ncr.id}`);
      }
    }

    // If re_inspect passed → move to pending_manager_review for closing
    if (result === 'passed' && ncr.status === 'pending_supplier') {
      db.prepare("UPDATE ncrs SET status='pending_manager_review' WHERE id=?").run(ncr.id);
      for (const u of getUsersByRole('qc_manager')) {
        createNotification(u.id, 'Re-inspection ผ่าน รอปิด NCR', `${ncr.ncr_code} ผ่านการตรวจซ้ำแล้ว`, `/ncr/${ncr.id}`);
      }
    }

    db.auditLog('re_inspections', result2.lastInsertRowid, 'CREATE', null, { ncr_id: ncr.id, round, result }, req.user.id, req.ip);
    return result2.lastInsertRowid;
  });

  const id = save();
  res.json(db.prepare('SELECT * FROM re_inspections WHERE id = ?').get(id));
});

// ===== POST /api/ncr/:id/request-uai =====
router.post('/:id/request-uai', auth, requireRole(['purchasing']), (req, res) => {
  const ncr = db.prepare('SELECT * FROM ncrs WHERE id = ?').get(req.params.id);
  if (!ncr) return res.status(404).json({ error: 'ไม่พบ NCR' });
  if (ncr.status !== 'pending_supplier') return res.status(400).json({ error: 'สามารถขอ UAI ได้เฉพาะ NCR สถานะ pending_supplier' });

  const {
    reason, conditions, department,
    product_type, work_type,
    defect_description, root_cause_purchasing,
    corrective_action_purchasing, preventive_action_purchasing,
  } = req.body;

  if (!reason?.trim())                       return res.status(400).json({ error: 'กรุณากรอกเหตุผลที่ขอยอมรับใช้' });
  if (!product_type)                         return res.status(400).json({ error: 'กรุณาเลือกประเภทของผลิตภัณฑ์' });
  if (!work_type)                            return res.status(400).json({ error: 'กรุณาเลือกประเภทของงาน' });
  if (!defect_description?.trim())           return res.status(400).json({ error: 'กรุณากรอกข้อบกพร่องที่เกิดขึ้น' });
  if (!root_cause_purchasing?.trim())        return res.status(400).json({ error: 'กรุณากรอกสาเหตุของปัญหา' });
  if (!corrective_action_purchasing?.trim()) return res.status(400).json({ error: 'กรุณากรอกการดำเนินการแก้ไขปัญหา' });
  if (!preventive_action_purchasing?.trim()) return res.status(400).json({ error: 'กรุณากรอกวิธีการป้องกันการเกิดปัญหาซ้ำ' });

  try {
    const result = ncrService.requestUai({
      ncr, reason, conditions, department, product_type, work_type, defect_description,
      root_cause_purchasing, corrective_action_purchasing, preventive_action_purchasing,
      actorId: req.user.id, actorIp: req.ip,
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ===== PATCH /api/ncr/:id/purchasing-review — Purchasing แปล EN + ยืนยันส่ง Supplier =====
router.patch('/:id/purchasing-review', auth, requireRole(['purchasing']), (req, res) => {
  const ncr = db.prepare('SELECT * FROM ncrs WHERE id = ?').get(req.params.id);
  if (!ncr) return res.status(404).json({ error: 'ไม่พบ NCR' });
  if (ncr.status !== 'pending_purchasing_review') {
    return res.status(400).json({ error: 'NCR ไม่ได้อยู่ในสถานะรอจัดซื้อ Review' });
  }

  let items = [];
  try {
    items = typeof req.body.items === 'string' ? JSON.parse(req.body.items) : (req.body.items || []);
  } catch { return res.status(400).json({ error: 'รูปแบบข้อมูล items ไม่ถูกต้อง' }); }

  try {
    ncrService.purchasingReview({ ncr, items, actorId: req.user.id, actorIp: req.ip });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ===== POST /api/ncr/:id/regenerate-token — Purchasing รีเจเนอเรต token =====
router.post('/:id/regenerate-token', auth, requireRole(['purchasing']), (req, res) => {
  const ncr = db.prepare('SELECT * FROM ncrs WHERE id = ?').get(req.params.id);
  if (!ncr) return res.status(404).json({ error: 'ไม่พบ NCR' });
  if (ncr.status !== 'pending_supplier') return res.status(400).json({ error: 'Regenerate ได้เฉพาะ NCR สถานะ pending_supplier' });

  const token = db.generateSecureToken();
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + Number(db.getSetting('token_expiry_days') || 90));

  db.prepare('UPDATE ncrs SET supplier_token=?, token_expires_at=? WHERE id=?').run(token, expiry.toISOString(), ncr.id);
  db.auditLog('ncrs', ncr.id, 'REGENERATE_TOKEN', null, null, req.user.id, req.ip);

  const appUrl = db.getSetting('app_url') || '';
  res.json({ ok: true, token, link: `${appUrl}/supplier/ncr/${token}`, expires_at: expiry.toISOString() });
});

// ===== POST /api/ncr/:id/reject-supplier-response — QC Manager ไม่อนุมัติคำตอบ Supplier =====
router.post('/:id/reject-supplier-response', auth, requireRole(['qc_manager']), (req, res) => {
  const ncr = db.prepare('SELECT * FROM ncrs WHERE id = ?').get(req.params.id);
  if (!ncr) return res.status(404).json({ error: 'ไม่พบ NCR' });
  if (ncr.status !== 'pending_manager_review') return res.status(400).json({ error: 'ไม่อนุมัติได้เฉพาะ NCR สถานะ pending_manager_review' });

  const { comment } = req.body;
  if (!comment || !comment.trim()) return res.status(400).json({ error: 'กรุณาระบุเหตุผลที่ไม่อนุมัติ' });

  try {
    ncrService.rejectSupplierResponse({ ncr, comment, actorId: req.user.id, actorIp: req.ip });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ===== POST /api/ncr/:id/resubmit-to-supplier — Purchasing ส่ง Supplier ตอบใหม่ =====
router.post('/:id/resubmit-to-supplier', auth, requireRole(['purchasing']), (req, res) => {
  const ncr = db.prepare('SELECT * FROM ncrs WHERE id = ?').get(req.params.id);
  if (!ncr) return res.status(404).json({ error: 'ไม่พบ NCR' });
  if (ncr.status !== 'pending_supplier_resubmit') return res.status(400).json({ error: 'ส่งใหม่ได้เฉพาะ NCR สถานะ pending_supplier_resubmit' });

  try {
    ncrService.resubmitToSupplier({ ncr, actorId: req.user.id, actorIp: req.ip });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ===== POST /api/ncr/:id/purchasing-acknowledge — Purchasing รับทราบเอกสาร NCR =====
router.post('/:id/purchasing-acknowledge', auth, requireRole(['purchasing']), (req, res) => {
  const ncr = db.prepare('SELECT * FROM ncrs WHERE id = ?').get(req.params.id);
  if (!ncr) return res.status(404).json({ error: 'ไม่พบ NCR' });
  if (ncr.status !== 'pending_supplier') return res.status(400).json({ error: 'รับทราบได้เฉพาะ NCR สถานะ pending_supplier' });
  if (ncr.purchasing_received_at) return res.status(400).json({ error: 'รับทราบแล้ว' });

  const ack = db.transaction(() => {
    db.prepare("UPDATE ncrs SET purchasing_received_at=datetime('now'), purchasing_received_by=? WHERE id=?")
      .run(req.user.id, ncr.id);
    db.auditLog('ncrs', ncr.id, 'PURCHASING_RECEIVED', null, { purchasing_received_by: req.user.id }, req.user.id, req.ip);
  });
  ack();
  res.json({ ok: true });
});

// ===== POST /api/ncr/:id/record-link-copy — บันทึกการ Copy Link ให้ Supplier =====
router.post('/:id/record-link-copy', auth, requireRole(['purchasing']), (req, res) => {
  const ncr = db.prepare('SELECT id, status FROM ncrs WHERE id = ?').get(req.params.id);
  if (!ncr) return res.status(404).json({ error: 'ไม่พบ NCR' });
  if (!['pending_purchasing_review', 'pending_supplier', 'uai_pending_qc_manager'].includes(ncr.status))
    return res.status(400).json({ error: 'ไม่สามารถบันทึก Copy Link ในสถานะนี้' });

  db.prepare("UPDATE ncrs SET link_copied_at=datetime('now'), link_copied_by=?, link_copied_count=COALESCE(link_copied_count,0)+1 WHERE id=?")
    .run(req.user.id, ncr.id);
  res.json({ ok: true });
});

// ===== POST /api/ncr/:id/images — เพิ่มรูปภาพ NCR =====
router.post('/:id/images', auth, requireRole(['qc_staff', 'qc_supervisor']), uploads.ncr.array('images', 10), uploads.verifyMagic, uploads.compressImages, (req, res) => {
  const ncr = db.prepare('SELECT id FROM ncrs WHERE id = ?').get(req.params.id);
  if (!ncr) return res.status(404).json({ error: 'ไม่พบ NCR' });
  const ins = db.prepare('INSERT INTO ncr_images (ncr_id, file_path) VALUES (?, ?)');
  for (const file of req.files || []) ins.run(req.params.id, file.filename);
  res.json(db.prepare('SELECT * FROM ncr_images WHERE ncr_id = ?').all(req.params.id));
});

// ===== DELETE /api/ncr/:id/images/:imageId — ลบรูปภาพ NCR ทีละไฟล์ =====
router.delete('/:id/images/:imageId', auth, requireRole(['qc_staff', 'qc_supervisor']), (req, res) => {
  const img = db.prepare('SELECT * FROM ncr_images WHERE id = ? AND ncr_id = ?').get(req.params.imageId, req.params.id);
  if (!img) return res.status(404).json({ error: 'ไม่พบรูปภาพ' });
  const filePath = path.join(__dirname, '../../uploads/ncr', img.file_path);
  try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) { console.error('[delete ncr image]', e.message); }
  db.prepare('DELETE FROM ncr_images WHERE id = ?').run(req.params.imageId);
  res.json({ ok: true });
});

module.exports = router;
