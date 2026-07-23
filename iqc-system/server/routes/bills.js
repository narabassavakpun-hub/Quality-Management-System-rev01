const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../db/database');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const uploads = require('../middleware/upload');
const { requireReceivingQC } = require('../middleware/requireRole');
const { getUsersByRole, getReceivingQCStaff, createNotification, sendTelegram } = require('../lib/notify');
const billService = require('../services/billService');

// qc_staff ทุก route ใน bills ต้องเป็นสถานี incoming เท่านั้น
router.use((req, res, next) => {
  if (req.user?.role === 'qc_staff' && req.user?.qc_station !== 'incoming') {
    return res.status(403).json({ error: 'เฉพาะ QC รับเข้า (สถานี incoming) เท่านั้น' });
  }
  next();
});

// DEVMORE M3 — ลบไฟล์จริงบน disk (เรียกหลัง transaction commit)
function safeUnlink(folder, file) {
  if (!file) return;
  try {
    const p = path.join(__dirname, '../../uploads', folder, file);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {}
}

// DEVMORE M5 — ตรวจความสมเหตุสมผลของจำนวน (คืน error string หรือ null)
function validateQty(received, sampled, passed, failed) {
  const r = Number(received), s = Number(sampled), p = Number(passed), f = Number(failed);
  if ([r, s, p, f].some(v => Number.isNaN(v) || v < 0)) return 'จำนวนต้องเป็นตัวเลขไม่ติดลบ';
  if (s > r) return 'จำนวนสุ่มตรวจต้องไม่เกินจำนวนรับเข้า';
  if (p + f > s) return 'จำนวนผ่าน + ไม่ผ่าน ต้องไม่เกินจำนวนสุ่มตรวจ';
  return null;
}

// ===== GET /api/bills =====
router.get('/', auth, (req, res) => {
  const { status, supplier_id, from, to, q = '', page = 1, limit = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  let where = '1=1';
  const params = [];
  if (status) { where += ' AND b.status = ?'; params.push(status); }
  if (supplier_id) { where += ' AND b.supplier_id = ?'; params.push(supplier_id); }
  if (from) { where += ' AND b.received_date >= ?'; params.push(from); }
  if (to) { where += ' AND b.received_date <= ?'; params.push(to); }
  if (q) { where += ' AND (b.invoice_no LIKE ? OR b.po_no LIKE ? OR b.container_no LIKE ? OR s.name LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }

  const rows = db.prepare(`
    WITH numbered_bills AS (
      SELECT *, ROW_NUMBER() OVER (ORDER BY created_at ASC) as seq_no FROM bills
    )
    SELECT b.*, s.name as supplier_name,
           COUNT(bi.id) as item_count,
           u.full_name as created_by_name,
           (SELECT COUNT(*) FROM bill_items bi2 WHERE bi2.bill_id = b.id AND bi2.qty_failed > 0) as failed_item_count,
           (SELECT COUNT(*) FROM bill_items bi3 WHERE bi3.bill_id = b.id AND bi3.qty_failed > 0
            AND NOT EXISTS (
              SELECT 1 FROM ncr_items ni2
              JOIN ncrs n2 ON n2.id = ni2.ncr_id
              WHERE ni2.bill_item_id = bi3.id AND n2.status != 'cancelled'
            )
           ) as uncovered_failed_count,
           (SELECT GROUP_CONCAT(x.info, ';;')
            FROM (
              SELECT DISTINCT n.ncr_code || '|' || n.status || '|' || n.severity || '|' || COALESCE(uc.full_name, '') || '|' || COALESCE(n.closed_at, '') || '|' || COALESCE(n.created_at, '') as info
              FROM ncrs n
              JOIN ncr_items ni ON ni.ncr_id = n.id
              JOIN bill_items bi4 ON bi4.id = ni.bill_item_id AND bi4.bill_id = b.id
              LEFT JOIN users uc ON uc.id = n.created_by
              WHERE n.status != 'cancelled'
            ) x
           ) as ncr_docs
    FROM numbered_bills b
    LEFT JOIN suppliers s ON s.id = b.supplier_id
    LEFT JOIN bill_items bi ON bi.bill_id = b.id
    LEFT JOIN users u ON u.id = b.created_by
    WHERE ${where}
    GROUP BY b.id
    ORDER BY b.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, Number(limit), offset);

  const total = db.prepare(`
    SELECT COUNT(DISTINCT b.id) as c FROM bills b
    LEFT JOIN suppliers s ON s.id = b.supplier_id
    WHERE ${where}
  `).get(...params);

  res.json({ data: rows, total: total.c, page: Number(page), limit: Number(limit) });
});

// ===== POST /api/bills =====
router.post('/', auth, requireRole(['qc_staff']), (req, res) => {
  const { invoice_no, po_no, container_no, tracking_no, supplier_id, received_date } = req.body;
  if (!invoice_no || !po_no || !supplier_id || !received_date) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลที่จำเป็น (Invoice No, PO No, Supplier, วันที่รับ)' });
  }

  // Check supplier approval status
  const supplier = db.prepare('SELECT approval_status FROM suppliers WHERE id = ?').get(supplier_id);
  if (supplier && ['suspended', 'blacklisted'].includes(supplier.approval_status)) {
    return res.status(400).json({ error: `Supplier นี้มีสถานะ ${supplier.approval_status} ไม่สามารถรับสินค้าได้` });
  }

  const id = billService.createBill({
    invoice_no, po_no, container_no, tracking_no, supplier_id, received_date,
    actorId: req.user.id, actorIp: req.ip,
  });
  res.json(db.prepare('SELECT * FROM bills WHERE id = ?').get(id));
});

// ===== GET /api/bills/creators — รายชื่อผู้ออกเอกสารที่มีบิลในระบบ =====
router.get('/creators', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT DISTINCT u.id, u.full_name
    FROM bills b
    JOIN users u ON u.id = b.created_by
    WHERE u.full_name IS NOT NULL
    ORDER BY u.full_name
  `).all();
  res.json(rows);
});

// ===== GET /api/bills/:id =====
router.get('/:id', auth, (req, res) => {
  const bill = db.prepare(`
    SELECT b.*, s.name as supplier_name, u.full_name as created_by_name
    FROM bills b
    LEFT JOIN suppliers s ON s.id = b.supplier_id
    LEFT JOIN users u ON u.id = b.created_by
    WHERE b.id = ?
  `).get(req.params.id);
  if (!bill) return res.status(404).json({ error: 'ไม่พบบิล' });

  bill.images = db.prepare('SELECT * FROM bill_images WHERE bill_id = ?').all(req.params.id);
  bill.items = db.prepare(`
    SELECT bi.*, p.code as product_code, p.name as product_name,
           pg.name as product_group_name, pg.require_inspection_doc,
           pg.require_lot_number, pg.require_expiry_date, pg.require_certificate,
           u.name as unit_name, u.abbreviation as unit_abbreviation,
           dc.name as defect_category_name,
           pd.revision as drawing_revision
    FROM bill_items bi
    LEFT JOIN products p ON p.id = bi.product_id
    LEFT JOIN product_groups pg ON pg.id = p.product_group_id
    LEFT JOIN units u ON u.id = p.unit_id
    LEFT JOIN defect_categories dc ON dc.id = bi.defect_category_id
    LEFT JOIN product_drawings pd ON pd.id = bi.drawing_revision_id
    WHERE bi.bill_id = ?
    ORDER BY bi.id
  `).all(req.params.id);

  for (const item of bill.items) {
    item.images = db.prepare('SELECT * FROM bill_item_images WHERE bill_item_id = ?').all(item.id);
    item.inspection_docs = db.prepare('SELECT * FROM bill_item_inspection_docs WHERE bill_item_id = ?').all(item.id);
    item.certificates = db.prepare('SELECT * FROM bill_item_certificates WHERE bill_item_id = ?').all(item.id);
    item.equipment = db.prepare(`
      SELECT me.* FROM measuring_equipment me
      JOIN bill_item_equipment bie ON bie.equipment_id = me.id
      WHERE bie.bill_item_id = ?
    `).all(item.id);
    // Check if this item is in any active NCR
    item.in_ncr = db.prepare(`
      SELECT n.id, n.ncr_code, n.severity FROM ncr_items ni JOIN ncrs n ON n.id = ni.ncr_id
      WHERE ni.bill_item_id = ? AND n.status NOT IN ('cancelled')
    `).get(item.id) || null;
  }

  res.json(bill);
});

// ===== PATCH /api/bills/:id =====
router.patch('/:id', auth, requireRole(['qc_staff']), (req, res) => {
  const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(req.params.id);
  if (!bill) return res.status(404).json({ error: 'ไม่พบบิล' });
  if (bill.created_by !== req.user.id) return res.status(403).json({ error: 'ไม่มีสิทธิ์แก้ไขบิลของผู้อื่น' });
  if (bill.status !== 'draft') return res.status(400).json({ error: 'แก้ไขได้เฉพาะบิลสถานะ draft' });

  const { invoice_no, po_no, container_no, tracking_no, supplier_id, received_date } = req.body;
  db.prepare(`UPDATE bills SET invoice_no=?, po_no=?, container_no=?, tracking_no=?, supplier_id=?, received_date=? WHERE id=?`)
    .run(invoice_no, po_no, container_no || null, tracking_no || null, supplier_id, received_date, req.params.id);
  res.json(db.prepare('SELECT * FROM bills WHERE id = ?').get(req.params.id));
});

// ===== DELETE /api/bills/:id — self-delete (draft or pending_approval, no linked NCR) =====
router.delete('/:id', auth, requireRole(['qc_staff']), (req, res) => {
  const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(req.params.id);
  if (!bill) return res.status(404).json({ error: 'ไม่พบบิล' });
  if (bill.created_by !== req.user.id) return res.status(403).json({ error: 'ไม่มีสิทธิ์ลบบิลของผู้อื่น' });
  if (!['draft', 'pending_approval'].includes(bill.status)) return res.status(400).json({ error: 'ลบได้เฉพาะ draft หรือ pending_approval' });

  const linkedNCR = db.prepare('SELECT id FROM ncrs WHERE bill_id = ? AND status NOT IN (\'cancelled\') LIMIT 1').get(req.params.id);
  if (linkedNCR) return res.status(400).json({ error: 'ไม่สามารถลบบิลที่มี NCR ผูกอยู่' });

  // DEVMORE M3 — เก็บ path ไฟล์ก่อนลบ row เพื่อลบไฟล์จริงหลัง commit
  const filesToDelete = [];
  const itemsForFiles = db.prepare('SELECT id FROM bill_items WHERE bill_id = ?').all(req.params.id);
  for (const item of itemsForFiles) {
    for (const r of db.prepare('SELECT file_path FROM bill_item_images WHERE bill_item_id = ?').all(item.id)) filesToDelete.push(['bill-items', r.file_path]);
    for (const r of db.prepare('SELECT file_path FROM bill_item_inspection_docs WHERE bill_item_id = ?').all(item.id)) filesToDelete.push(['inspection-docs', r.file_path]);
    for (const r of db.prepare('SELECT file_path FROM bill_item_certificates WHERE bill_item_id = ?').all(item.id)) filesToDelete.push(['inspection-docs', r.file_path]);
  }
  for (const r of db.prepare('SELECT file_path FROM bill_images WHERE bill_id = ?').all(req.params.id)) filesToDelete.push(['bills', r.file_path]);

  const del = db.transaction(() => {
    // Delete images and docs for each item
    const items = db.prepare('SELECT id FROM bill_items WHERE bill_id = ?').all(req.params.id);
    for (const item of items) {
      db.prepare('DELETE FROM bill_item_certificates WHERE bill_item_id = ?').run(item.id);
      db.prepare('DELETE FROM bill_item_equipment WHERE bill_item_id = ?').run(item.id);
      db.prepare('DELETE FROM bill_item_images WHERE bill_item_id = ?').run(item.id);
      db.prepare('DELETE FROM bill_item_inspection_docs WHERE bill_item_id = ?').run(item.id);
    }
    db.prepare('DELETE FROM bill_items WHERE bill_id = ?').run(req.params.id);
    db.prepare('DELETE FROM bill_images WHERE bill_id = ?').run(req.params.id);
    db.prepare('DELETE FROM bills WHERE id = ?').run(req.params.id);
    db.auditLog('bills', req.params.id, 'DELETE', bill, null, req.user.id, req.ip);
  });

  del();
  for (const [folder, f] of filesToDelete) safeUnlink(folder, f); // DEVMORE M3
  res.json({ ok: true });
});

// ===== POST /api/bills/:id/submit =====
router.post('/:id/submit', auth, requireRole(['qc_staff']), (req, res) => {
  const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(req.params.id);
  if (!bill) return res.status(404).json({ error: 'ไม่พบบิล' });
  if (bill.status !== 'draft') return res.status(400).json({ error: 'บิลนี้ไม่ได้อยู่สถานะ draft' });

  const items = db.prepare('SELECT bi.*, p.id as product_id FROM bill_items bi LEFT JOIN products p ON p.id = bi.product_id WHERE bi.bill_id = ?').all(req.params.id);
  if (items.length === 0) return res.status(400).json({ error: 'กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ' });

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const product = item.product_id
      ? db.prepare('SELECT p.*, pg.require_inspection_doc, pg.require_lot_number, pg.require_expiry_date, pg.require_certificate FROM products p LEFT JOIN product_groups pg ON pg.id = p.product_group_id WHERE p.id = ?').get(item.product_id)
      : null;

    if (product?.require_inspection_doc) {
      const docs = db.prepare('SELECT id FROM bill_item_inspection_docs WHERE bill_item_id = ?').all(item.id);
      if (!docs.length) return res.status(400).json({ error: `แถวที่ ${i + 1} (${item.item_name}): ยังไม่แนบเอกสารตรวจเส้น` });
    }
    if (product?.require_lot_number && !item.lot_number) {
      return res.status(400).json({ error: `แถวที่ ${i + 1} (${item.item_name}): กรุณากรอก Lot Number` });
    }
    if (product?.require_expiry_date) {
      if (!item.expiry_date) return res.status(400).json({ error: `แถวที่ ${i + 1} (${item.item_name}): กรุณากรอกวันหมดอายุ` });
      if (item.expiry_date < bill.received_date) return res.status(400).json({ error: `แถวที่ ${i + 1} (${item.item_name}): สินค้าหมดอายุแล้ว (expiry: ${item.expiry_date})` });
    }
    if (product?.require_certificate) {
      const certs = db.prepare('SELECT id FROM bill_item_certificates WHERE bill_item_id = ?').all(item.id);
      if (!certs.length) return res.status(400).json({ error: `แถวที่ ${i + 1} (${item.item_name}): กรุณาแนบ Certificate` });
    }
    if (item.qty_failed > 0) {
      if (!item.defect_category_id) return res.status(400).json({ error: `แถวที่ ${i + 1} (${item.item_name}): ยังไม่เลือกกลุ่มปัญหา` });
      if (!item.defect_detail) return res.status(400).json({ error: `แถวที่ ${i + 1} (${item.item_name}): ยังไม่กรอกรายละเอียดปัญหา` });
      const imgs = db.prepare('SELECT id FROM bill_item_images WHERE bill_item_id = ?').all(item.id);
      if (!imgs.length) return res.status(400).json({ error: `แถวที่ ${i + 1} (${item.item_name}): ยังไม่มีรูปภาพปัญหา` });
    }
  }

  billService.submitBill({ bill, actorId: req.user.id, actorIp: req.ip });
  res.json({ ok: true, status: 'pending_approval' });
});

// ===== POST /api/bills/:id/approve =====
router.post('/:id/approve', auth, requireRole(['qc_supervisor']), (req, res) => {
  const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(req.params.id);
  if (!bill) return res.status(404).json({ error: 'ไม่พบบิล' });
  if (bill.status !== 'pending_approval') return res.status(400).json({ error: 'บิลนี้ไม่ได้รออนุมัติ' });

  try {
    billService.approveBill({ bill, actorId: req.user.id, actorIp: req.ip });
    res.json({ ok: true, status: 'approved' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ===== POST /api/bills/:id/reject =====
router.post('/:id/reject', auth, requireRole(['qc_supervisor']), (req, res) => {
  const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(req.params.id);
  if (!bill) return res.status(404).json({ error: 'ไม่พบบิล' });
  if (bill.status !== 'pending_approval') return res.status(400).json({ error: 'บิลนี้ไม่ได้รออนุมัติ' });

  const { comment } = req.body;
  // DEVMORE H7 — optimistic lock กัน approve/reject ชนกัน
  // S159 — persist comment ลง reject_comment (ไม่ใช่แค่ข้อความ notification ที่ผ่านไปแล้วหายไป) ให้ qc_staff
  // เห็นสาเหตุค้างอยู่บนบิลเองตอนกลับมาแก้ไข (Bills/Detail.jsx + Bills/New.jsx banner)
  const changed = db.prepare("UPDATE bills SET status='draft', reject_comment=? WHERE id=? AND status='pending_approval'")
    .run(comment || null, req.params.id);
  if (changed.changes === 0) return res.status(400).json({ error: 'บิลถูกดำเนินการแล้ว กรุณารีเฟรชหน้า' });
  createNotification(bill.created_by, 'บิลถูกส่งกลับ', `Invoice ${bill.invoice_no} ถูกส่งกลับ${comment ? ': ' + comment : ''}`, `/bills/${bill.id}`);
  db.auditLog('bills', req.params.id, 'REJECT', { status: 'pending_approval' }, { status: 'draft', comment }, req.user.id, req.ip);
  res.json({ ok: true });
});

// ===== POST /api/bills/:id/images =====
router.post('/:id/images', auth, requireRole(['qc_staff']), uploads.bills.array('images', 20), uploads.verifyMagic, uploads.compressImages, (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'กรุณาเลือกไฟล์' });
  const insert = db.prepare('INSERT INTO bill_images (bill_id, file_path) VALUES (?, ?)');
  for (const file of req.files) insert.run(req.params.id, file.filename);
  res.json({ ok: true, count: req.files.length });
});

// ===== DELETE /api/bills/:id/images/:imageId =====
router.delete('/:id/images/:imageId', auth, requireRole(['qc_staff']), (req, res) => {
  const img = db.prepare('SELECT * FROM bill_images WHERE id = ? AND bill_id = ?').get(req.params.imageId, req.params.id);
  if (!img) return res.status(404).json({ error: 'ไม่พบรูปภาพ' });
  const filePath = path.join(__dirname, '../../uploads/bills', img.file_path);
  try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) { console.error('[delete bill image]', e.message); }
  db.prepare('DELETE FROM bill_images WHERE id = ?').run(req.params.imageId);
  res.json({ ok: true });
});

// ===== GET /api/bills/:id/items =====
router.get('/:id/items', auth, (req, res) => {
  const items = db.prepare(`
    SELECT bi.*, p.code as product_code, p.name as product_name,
           pg.name as product_group_name, pg.require_inspection_doc,
           pg.require_lot_number, pg.require_expiry_date, pg.require_certificate,
           u.name as unit_name, dc.name as defect_category_name,
           pd.revision as drawing_revision
    FROM bill_items bi
    LEFT JOIN products p ON p.id = bi.product_id
    LEFT JOIN product_groups pg ON pg.id = p.product_group_id
    LEFT JOIN units u ON u.id = p.unit_id
    LEFT JOIN defect_categories dc ON dc.id = bi.defect_category_id
    LEFT JOIN product_drawings pd ON pd.id = bi.drawing_revision_id
    WHERE bi.bill_id = ?
    ORDER BY bi.id
  `).all(req.params.id);

  for (const item of items) {
    item.images = db.prepare('SELECT * FROM bill_item_images WHERE bill_item_id = ?').all(item.id);
    item.inspection_docs = db.prepare('SELECT * FROM bill_item_inspection_docs WHERE bill_item_id = ?').all(item.id);
    item.certificates = db.prepare('SELECT * FROM bill_item_certificates WHERE bill_item_id = ?').all(item.id);
    item.in_ncr = db.prepare(`
      SELECT n.id, n.ncr_code, n.severity FROM ncr_items ni JOIN ncrs n ON n.id = ni.ncr_id
      WHERE ni.bill_item_id = ? AND n.status NOT IN ('cancelled')
    `).get(item.id) || null;
  }
  res.json(items);
});

// ===== POST /api/bills/:id/items =====
router.post('/:id/items', auth, requireRole(['qc_staff']), (req, res) => {
  const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(req.params.id);
  if (!bill) return res.status(404).json({ error: 'ไม่พบบิล' });
  if (bill.status !== 'draft') return res.status(400).json({ error: 'แก้ไขได้เฉพาะบิล draft' });
  if (bill.created_by !== req.user.id) return res.status(403).json({ error: 'ไม่มีสิทธิ์แก้ไขบิลของผู้อื่น' }); // DEVMORE M1

  const {
    product_id, item_name, qty_received, qty_sampled, qty_passed, qty_failed,
    defect_category_id, defect_detail,
    lot_number, batch_number, manufacturing_date, expiry_date, country_of_origin,
    drawing_revision_id,
  } = req.body;

  if (!item_name || qty_received == null || qty_sampled == null || qty_passed == null || qty_failed == null) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลรายการให้ครบ' });
  }

  // BUG-004: hard-block when expiry_date < received_date (ISO compliance)
  if (expiry_date && expiry_date < bill.received_date) {
    return res.status(400).json({ error: `วันหมดอายุต้องไม่ก่อนวันที่รับสินค้า (expiry: ${expiry_date}, received: ${bill.received_date})` });
  }
  // DEVMORE M5 — ความสมเหตุสมผลของจำนวน
  const qtyErr = validateQty(qty_received, qty_sampled, qty_passed, qty_failed);
  if (qtyErr) return res.status(400).json({ error: qtyErr });

  const result = db.prepare(`
    INSERT INTO bill_items (bill_id, product_id, item_name, qty_received, qty_sampled, qty_passed, qty_failed,
      defect_category_id, defect_detail, lot_number, batch_number, manufacturing_date, expiry_date,
      country_of_origin, drawing_revision_id, inspector_id, inspected_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(
    req.params.id, product_id || null, item_name, qty_received, qty_sampled, qty_passed, qty_failed,
    defect_category_id || null, defect_detail || null,
    lot_number || null, batch_number || null, manufacturing_date || null, expiry_date || null,
    country_of_origin || null, drawing_revision_id || null, req.user.id
  );

  res.json(db.prepare('SELECT * FROM bill_items WHERE id = ?').get(result.lastInsertRowid));
});

// ===== PATCH /api/bills/:id/items/:itemId =====
router.patch('/:id/items/:itemId', auth, requireRole(['qc_staff']), (req, res) => {
  const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(req.params.id);
  if (!bill || bill.status !== 'draft') return res.status(400).json({ error: 'แก้ไขได้เฉพาะบิล draft' });
  if (bill.created_by !== req.user.id) return res.status(403).json({ error: 'ไม่มีสิทธิ์แก้ไขบิลของผู้อื่น' }); // DEVMORE M1
  // ตรวจว่า item อยู่ในบิลนี้จริง
  const existing = db.prepare('SELECT id FROM bill_items WHERE id = ? AND bill_id = ?').get(req.params.itemId, req.params.id);
  if (!existing) return res.status(404).json({ error: 'ไม่พบรายการในบิลนี้' });

  const {
    product_id, item_name, qty_received, qty_sampled, qty_passed, qty_failed,
    defect_category_id, defect_detail,
    lot_number, batch_number, manufacturing_date, expiry_date, country_of_origin,
    drawing_revision_id,
  } = req.body;

  // DEVMORE M1 — re-validate expiry (POST ทำอยู่ PATCH ก็ต้องทำ)
  if (expiry_date && expiry_date < bill.received_date) {
    return res.status(400).json({ error: `วันหมดอายุต้องไม่ก่อนวันที่รับสินค้า (expiry: ${expiry_date}, received: ${bill.received_date})` });
  }
  // DEVMORE M5 — ความสมเหตุสมผลของจำนวน
  const qtyErr = validateQty(qty_received, qty_sampled, qty_passed, qty_failed);
  if (qtyErr) return res.status(400).json({ error: qtyErr });

  db.prepare(`
    UPDATE bill_items SET
      product_id=?, item_name=?, qty_received=?, qty_sampled=?, qty_passed=?, qty_failed=?,
      defect_category_id=?, defect_detail=?,
      lot_number=?, batch_number=?, manufacturing_date=?, expiry_date=?, country_of_origin=?, drawing_revision_id=?
    WHERE id=? AND bill_id=?
  `).run(
    product_id || null, item_name, qty_received, qty_sampled, qty_passed, qty_failed,
    defect_category_id || null, defect_detail || null,
    lot_number || null, batch_number || null, manufacturing_date || null, expiry_date || null,
    country_of_origin || null, drawing_revision_id || null,
    req.params.itemId, req.params.id
  );
  res.json(db.prepare('SELECT * FROM bill_items WHERE id = ?').get(req.params.itemId));
});

// ===== DELETE /api/bills/:id/items/:itemId =====
router.delete('/:id/items/:itemId', auth, requireRole(['qc_staff']), (req, res) => {
  const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(req.params.id);
  if (!bill || bill.status !== 'draft') return res.status(400).json({ error: 'แก้ไขได้เฉพาะบิล draft' });
  if (bill.created_by !== req.user.id) return res.status(403).json({ error: 'ไม่มีสิทธิ์แก้ไขบิลของผู้อื่น' }); // DEVMORE M1

  // DEVMORE M3 — เก็บ path ก่อนลบ
  const filesToDelete = [];
  for (const r of db.prepare('SELECT file_path FROM bill_item_images WHERE bill_item_id = ?').all(req.params.itemId)) filesToDelete.push(['bill-items', r.file_path]);
  for (const r of db.prepare('SELECT file_path FROM bill_item_inspection_docs WHERE bill_item_id = ?').all(req.params.itemId)) filesToDelete.push(['inspection-docs', r.file_path]);
  for (const r of db.prepare('SELECT file_path FROM bill_item_certificates WHERE bill_item_id = ?').all(req.params.itemId)) filesToDelete.push(['inspection-docs', r.file_path]);

  const del = db.transaction(() => {
    db.prepare('DELETE FROM bill_item_certificates WHERE bill_item_id = ?').run(req.params.itemId);
    db.prepare('DELETE FROM bill_item_equipment WHERE bill_item_id = ?').run(req.params.itemId);
    db.prepare('DELETE FROM bill_item_images WHERE bill_item_id = ?').run(req.params.itemId);
    db.prepare('DELETE FROM bill_item_inspection_docs WHERE bill_item_id = ?').run(req.params.itemId);
    db.prepare('DELETE FROM bill_items WHERE id = ? AND bill_id = ?').run(req.params.itemId, req.params.id);
  });
  del();
  for (const [folder, f] of filesToDelete) safeUnlink(folder, f); // DEVMORE M3
  res.json({ ok: true });
});

// ===== POST /api/bills/:id/items/:itemId/images =====
router.post('/:id/items/:itemId/images', auth, requireRole(['qc_staff']), uploads.billItems.array('images', 10), uploads.verifyMagic, uploads.compressImages, (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'กรุณาเลือกไฟล์' });
  const insert = db.prepare('INSERT INTO bill_item_images (bill_item_id, file_path) VALUES (?, ?)');
  for (const file of req.files) insert.run(req.params.itemId, file.filename);
  res.json({ ok: true, count: req.files.length });
});

// ===== DELETE /api/bills/:id/items/:itemId/images/:imageId =====
router.delete('/:id/items/:itemId/images/:imageId', auth, requireRole(['qc_staff']), (req, res) => {
  const img = db.prepare('SELECT * FROM bill_item_images WHERE id = ? AND bill_item_id = ?').get(req.params.imageId, req.params.itemId);
  if (!img) return res.status(404).json({ error: 'ไม่พบรูปภาพ' });
  const filePath = path.join(__dirname, '../../uploads/bill-items', img.file_path);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  db.prepare('DELETE FROM bill_item_images WHERE id = ?').run(req.params.imageId);
  res.json({ ok: true });
});

// ===== POST /api/bills/:id/items/:itemId/inspection-docs =====
router.post('/:id/items/:itemId/inspection-docs', auth, requireRole(['qc_staff']), uploads.inspectionDocs.array('docs', 10), uploads.verifyMagic, uploads.compressImages, (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'กรุณาเลือกไฟล์' });
  const insert = db.prepare('INSERT INTO bill_item_inspection_docs (bill_item_id, file_path, file_type, original_name) VALUES (?, ?, ?, ?)');
  for (const file of req.files) {
    insert.run(req.params.itemId, file.filename, file.mimetype === 'application/pdf' ? 'pdf' : 'image', file.originalname);
  }
  res.json({ ok: true, count: req.files.length });
});

// ===== GET /api/bills/:id/items/:itemId/inspection-docs =====
router.get('/:id/items/:itemId/inspection-docs', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM bill_item_inspection_docs WHERE bill_item_id = ?').all(req.params.itemId));
});

// ===== DELETE /api/bills/:id/items/:itemId/inspection-docs/:docId =====
router.delete('/:id/items/:itemId/inspection-docs/:docId', auth, requireRole(['qc_staff']), (req, res) => {
  const doc = db.prepare('SELECT * FROM bill_item_inspection_docs WHERE id = ? AND bill_item_id = ?').get(req.params.docId, req.params.itemId);
  if (!doc) return res.status(404).json({ error: 'ไม่พบไฟล์' });
  const filePath = path.join(__dirname, '../../uploads/inspection-docs', doc.file_path);
  try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) { console.error('[delete inspection-doc]', e.message); }
  db.prepare('DELETE FROM bill_item_inspection_docs WHERE id = ?').run(req.params.docId);
  res.json({ ok: true });
});

// ===== POST /api/bills/:id/items/:itemId/certificates — Certificate of Conformance =====
router.post('/:id/items/:itemId/certificates', auth, requireRole(['qc_staff']), uploads.inspectionDocs.array('files', 5), uploads.verifyMagic, uploads.compressImages, (req, res) => {
  const { cert_type, cert_number, issued_date, issued_by } = req.body;
  if (!cert_type || !req.files?.length) return res.status(400).json({ error: 'กรุณาระบุประเภท certificate และอัปโหลดไฟล์' });
  const ins = db.prepare('INSERT INTO bill_item_certificates (bill_item_id, cert_type, cert_number, file_path, original_name, issued_date, issued_by) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const file of req.files) {
    ins.run(req.params.itemId, cert_type, cert_number || null, file.filename, file.originalname, issued_date || null, issued_by || null);
  }
  res.json(db.prepare('SELECT * FROM bill_item_certificates WHERE bill_item_id = ?').all(req.params.itemId));
});

// ===== DELETE /api/bills/:id/items/:itemId/certificates/:certId =====
router.delete('/:id/items/:itemId/certificates/:certId', auth, requireRole(['qc_staff']), (req, res) => {
  const cert = db.prepare('SELECT file_path FROM bill_item_certificates WHERE id = ? AND bill_item_id = ?').get(req.params.certId, req.params.itemId);
  if (!cert) return res.status(404).json({ error: 'ไม่พบเอกสาร' });
  db.prepare('DELETE FROM bill_item_certificates WHERE id = ? AND bill_item_id = ?').run(req.params.certId, req.params.itemId);
  if (cert.file_path) {
    try { fs.unlinkSync(path.join(__dirname, '../../uploads/inspection-docs', cert.file_path)); } catch (_) {}
  }
  res.json({ ok: true });
});

// ===== POST /api/bills/:id/items/:itemId/equipment — บันทึกเครื่องมือที่ใช้ตรวจ =====
router.post('/:id/items/:itemId/equipment', auth, requireRole(['qc_staff']), (req, res) => {
  const { equipment_ids } = req.body;
  if (!Array.isArray(equipment_ids) || !equipment_ids.length) return res.status(400).json({ error: 'กรุณาเลือกเครื่องมืออย่างน้อย 1 ชิ้น' });

  const today = new Date().toISOString().slice(0, 10);
  const ins = db.prepare('INSERT OR IGNORE INTO bill_item_equipment (bill_item_id, equipment_id) VALUES (?, ?)');
  const warnings = [];

  for (const eqId of equipment_ids) {
    const eq = db.prepare('SELECT * FROM measuring_equipment WHERE id = ?').get(eqId);
    if (!eq) continue;
    if (eq.status === 'out_of_service') {
      warnings.push(`${eq.equipment_code} อยู่นอกการให้บริการ`);
      continue;
    }
    if (eq.last_calibrated_date) {
      const nextCal = new Date(eq.last_calibrated_date);
      nextCal.setDate(nextCal.getDate() + eq.calibration_interval_days);
      if (nextCal.toISOString().slice(0, 10) < today) {
        warnings.push(`${eq.equipment_code} Calibration เกินกำหนดแล้ว`);
      }
    }
    ins.run(req.params.itemId, eqId);
  }

  res.json({ ok: true, warnings });
});

module.exports = router;
module.exports.validateQty = validateQty; // สำหรับ unit test
