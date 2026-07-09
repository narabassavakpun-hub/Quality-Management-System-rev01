const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const router = express.Router();
const db = require('../db/database');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const uploads = require('../middleware/upload');
const { getUsersByRole, createNotification, sendTelegram } = require('../lib/notify');

// ===== DEVMORE M2 — เก็บลายเซ็นเป็นไฟล์แทน base64 ใน DB =====
const SIG_DIR = path.join(__dirname, '../../uploads/uai');
// decode data-url → เขียนไฟล์ → คืน filename (กัน DB bloat + จำกัดขนาด)
function saveSignatureImage(dataUrl) {
  if (!dataUrl) return '';
  const m = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new Error('รูปลายเซ็นไม่ถูกต้อง');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 2 * 1024 * 1024) throw new Error('ลายเซ็นมีขนาดใหญ่เกินไป');
  fs.mkdirSync(SIG_DIR, { recursive: true });
  const name = `sig-${crypto.randomUUID()}.${m[1] === 'png' ? 'png' : 'jpg'}`;
  fs.writeFileSync(path.join(SIG_DIR, name), buf);
  return name;
}
// แปลงค่าใน DB → src ที่ frontend ใช้ได้ (รองรับ legacy data-url + filename ใหม่)
function sigSrc(v) {
  if (!v) return '';
  return v.startsWith('data:') ? v : `/uploads/uai/${v}`;
}

// status sequence + role map + business transactions ย้ายไป services/uaiService.js (CLAUDE.md §8)
const uaiService = require('../services/uaiService');
const { UAI_STATUS_SEQUENCE, SIGN_ROLE_MAP } = uaiService;

// ===== GET /api/uai =====
router.get('/', auth, (req, res) => {
  const { status, from, to, supplier_id, page = 1, limit = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  let where = '1=1';
  const params = [];
  if (status) { where += ' AND u.status = ?'; params.push(status); }
  if (supplier_id) { where += ' AND b.supplier_id = ?'; params.push(supplier_id); }
  if (from) { where += ' AND DATE(u.created_at) >= ?'; params.push(from); }
  if (to) { where += ' AND DATE(u.created_at) <= ?'; params.push(to); }

  const rows = db.prepare(`
    SELECT u.*, n.ncr_code, n.severity, n.invoice_no, n.po_no,
           s.name as supplier_name
    FROM uai_documents u
    LEFT JOIN ncrs n ON n.id = u.ncr_id
    LEFT JOIN bills b ON b.id = n.bill_id
    LEFT JOIN suppliers s ON s.id = b.supplier_id
    WHERE ${where}
    ORDER BY u.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, Number(limit), offset);

  const total = db.prepare(`
    SELECT COUNT(*) as c FROM uai_documents u
    LEFT JOIN ncrs n ON n.id = u.ncr_id
    LEFT JOIN bills b ON b.id = n.bill_id
    WHERE ${where}
  `).get(...params);

  // Attach ncr_items count to each UAI
  for (const row of rows) {
    row.ncr_items_count = db.prepare('SELECT COUNT(*) as c FROM ncr_items WHERE ncr_id = ?').get(row.ncr_id)?.c || 0;
  }

  res.json(rows);
});

// ===== GET /api/uai/:id =====
router.get('/:id', auth, (req, res) => {
  const uai = db.prepare(`
    SELECT u.*, n.ncr_code, n.severity, n.invoice_no, n.po_no,
           n.disposition, n.disposition_note, n.supplier_token,
           s.name as supplier_name, usr.full_name as created_by_name
    FROM uai_documents u
    LEFT JOIN ncrs n ON n.id = u.ncr_id
    LEFT JOIN bills b ON b.id = n.bill_id
    LEFT JOIN suppliers s ON s.id = b.supplier_id
    LEFT JOIN users usr ON usr.id = u.created_by
    WHERE u.id = ?
  `).get(req.params.id);
  if (!uai) return res.status(404).json({ error: 'ไม่พบ UAI' });

  // supplier_token เปิดเผยเฉพาะ purchasing/admin (DEVMORE M9)
  if (!['purchasing', 'admin'].includes(req.user.role)) delete uai.supplier_token;

  uai.signatures = db.prepare(`
    SELECT us.*, usr.full_name FROM uai_signatures us
    LEFT JOIN users usr ON usr.id = us.user_id
    WHERE us.uai_id = ? ORDER BY us.signed_at
  `).all(req.params.id).map(s => ({ ...s, signature_image: sigSrc(s.signature_image) })); // DEVMORE M2

  // NCR items (multi-item support) with inspector name and qty_passed from bill_items
  uai.ncr_items = db.prepare(`
    SELECT ni.*, dc.name as defect_category_name,
           bi.qty_passed, bi.inspected_at, bi.inspection_note,
           insp.full_name as inspector_name
    FROM ncr_items ni
    LEFT JOIN defect_categories dc ON dc.id = ni.defect_category_id
    LEFT JOIN bill_items bi ON bi.id = ni.bill_item_id
    LEFT JOIN users insp ON insp.id = bi.inspector_id
    WHERE ni.ncr_id = ?
  `).all(uai.ncr_id);

  for (const item of uai.ncr_items) {
    item.bill_item_images = item.bill_item_id
      ? db.prepare('SELECT * FROM bill_item_images WHERE bill_item_id = ?').all(item.bill_item_id)
      : [];
  }

  // NCR images
  uai.ncr_images = db.prepare('SELECT * FROM ncr_images WHERE ncr_id = ?').all(uai.ncr_id);

  // Supplier response
  uai.supplier_response = db.prepare('SELECT * FROM supplier_responses WHERE ncr_id = ? ORDER BY id DESC LIMIT 1').get(uai.ncr_id);

  // UAI images (uploaded by purchasing)
  uai.images = db.prepare('SELECT * FROM uai_images WHERE uai_id = ? ORDER BY uploaded_at').all(uai.id);

  res.json(uai);
});

// ===== DELETE /api/uai/:id — self-delete by purchasing =====
router.delete('/:id', auth, requireRole(['purchasing']), (req, res) => {
  const uai = db.prepare('SELECT * FROM uai_documents WHERE id = ?').get(req.params.id);
  if (!uai) return res.status(404).json({ error: 'ไม่พบ UAI' });
  if (!['uai_pending_qc_manager', 'uai_pending_purchasing'].includes(uai.status)) {
    return res.status(400).json({ error: 'ลบ UAI ได้เฉพาะสถานะ uai_pending_qc_manager หรือ uai_pending_purchasing' });
  }

  const sigFiles = db.prepare('SELECT signature_image FROM uai_signatures WHERE uai_id = ? AND signature_image IS NOT NULL').all(uai.id);

  const del = db.transaction(() => {
    // Revert NCR status back to waiting for supplier
    db.prepare("UPDATE ncrs SET status='pending_supplier', uai_close_remark=NULL WHERE id=?").run(uai.ncr_id);
    db.prepare('DELETE FROM uai_signatures WHERE uai_id=?').run(uai.id);
    db.prepare('DELETE FROM uai_documents WHERE id=?').run(uai.id);
    db.auditLog('uai_documents', uai.id, 'DELETE', uai, null, req.user.id, req.ip);
  });

  del();

  for (const { signature_image } of sigFiles) {
    try { fs.unlinkSync(path.join(__dirname, '../../uploads/uai', signature_image)); } catch (_) {}
  }

  res.json({ ok: true });
});

// ===== POST /api/uai/:id/qc-manager-review =====
router.post('/:id/qc-manager-review', auth, requireRole(['qc_manager']), (req, res) => {
  const uai = db.prepare('SELECT * FROM uai_documents WHERE id = ?').get(req.params.id);
  if (!uai) return res.status(404).json({ error: 'ไม่พบ UAI' });
  if (uai.status !== 'uai_pending_qc_manager') return res.status(400).json({ error: 'UAI นี้ไม่ได้รอการตรวจสอบ' });

  const { decision, approved, comment, reason } = req.body;
  const isApproved = decision === 'approve' || approved === true || approved === 'true';
  const reviewComment = comment || reason || null;

  try {
    const nextStatus = uaiService.reviewUai({ uai, actorId: req.user.id, actorIp: req.ip, isApproved, reviewComment });
    res.json({ ok: true, status: nextStatus });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ===== PATCH /api/uai/:id/details — Purchasing กรอก/แก้ไขข้อมูล =====
router.patch('/:id/details', auth, requireRole(['purchasing']), (req, res) => {
  const uai = db.prepare('SELECT * FROM uai_documents WHERE id = ?').get(req.params.id);
  if (!uai) return res.status(404).json({ error: 'ไม่พบ UAI' });
  if (!['uai_pending_purchasing', 'uai_pending_qc_manager'].includes(uai.status)) {
    return res.status(400).json({ error: 'ไม่สามารถแก้ไขข้อมูลในขั้นตอนนี้' });
  }
  const { reason, conditions, department, issued_date,
    product_type, work_type, defect_description,
    root_cause_purchasing, corrective_action_purchasing, preventive_action_purchasing } = req.body;
  db.prepare(`UPDATE uai_documents SET reason=?, conditions=?, department=?, issued_date=?,
    product_type=?, work_type=?, defect_description=?,
    root_cause_purchasing=?, corrective_action_purchasing=?, preventive_action_purchasing=?
    WHERE id=?`)
    .run(reason || null, conditions || null, department || null, issued_date || null,
      product_type || null, work_type || null, defect_description || null,
      root_cause_purchasing || null, corrective_action_purchasing || null, preventive_action_purchasing || null,
      uai.id);
  res.json({ ok: true });
});

// ===== POST /api/uai/:id/images — Purchasing อัปโหลดรูปภาพ =====
router.post('/:id/images', auth, requireRole(['purchasing']), uploads.uai.array('images', 10), uploads.verifyMagic, uploads.compressImages, (req, res) => {
  const uai = db.prepare('SELECT * FROM uai_documents WHERE id = ?').get(req.params.id);
  if (!uai) return res.status(404).json({ error: 'ไม่พบ UAI' });
  if (!req.files?.length) return res.status(400).json({ error: 'ไม่พบไฟล์รูปภาพ' });

  const ins = db.prepare('INSERT INTO uai_images (uai_id, file_path, original_name) VALUES (?, ?, ?)');
  for (const f of req.files) {
    ins.run(uai.id, f.filename, f.originalname);
  }
  res.json(db.prepare('SELECT * FROM uai_images WHERE uai_id = ? ORDER BY uploaded_at').all(uai.id));
});

// ===== DELETE /api/uai/:id/images/:imgId — ลบรูป =====
router.delete('/:id/images/:imgId', auth, requireRole(['purchasing']), (req, res) => {
  const uai = db.prepare('SELECT * FROM uai_documents WHERE id = ?').get(req.params.id);
  if (!uai) return res.status(404).json({ error: 'ไม่พบ UAI' });

  const img = db.prepare('SELECT * FROM uai_images WHERE id = ? AND uai_id = ?').get(req.params.imgId, uai.id);
  if (!img) return res.status(404).json({ error: 'ไม่พบรูปภาพ' });

  try {
    const filePath = path.join(__dirname, '../../uploads/uai', img.file_path);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (_) {}

  db.prepare('DELETE FROM uai_images WHERE id = ?').run(img.id);
  res.json({ ok: true });
});

// ===== POST /api/uai/:id/sign =====
router.post('/:id/sign', auth, (req, res) => {
  const uai = db.prepare('SELECT * FROM uai_documents WHERE id = ?').get(req.params.id);
  if (!uai) return res.status(404).json({ error: 'ไม่พบ UAI' });

  const expectedRole = SIGN_ROLE_MAP[uai.status];
  if (!expectedRole) return res.status(400).json({ error: 'ไม่ใช่ขั้นตอนการลงนาม' });
  if (req.user.role !== expectedRole) return res.status(403).json({ error: 'ไม่ใช่คิวของคุณในการลงนาม' });

  const { signature_image, comment } = req.body;
  if (!signature_image) return res.status(400).json({ error: 'กรุณาวาดลายเซ็น' });

  // DEVMORE M2 — เซฟลายเซ็นเป็นไฟล์ก่อน transaction (เก็บ filename ใน DB)
  let sigFile;
  try { sigFile = saveSignatureImage(signature_image); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  const action = ['uai_pending_cco', 'uai_pending_cmo', 'uai_pending_cpo', 'uai_pending_purchasing'].includes(uai.status) ? 'approved' : 'acknowledged';

  try {
    const nextStatus = uaiService.signUai({ uai, actorId: req.user.id, actorRole: req.user.role, actorIp: req.ip, sigFile, action, comment });
    res.json({ ok: true, status: nextStatus });
  } catch (e) {
    // DEVMORE M2 — ลบไฟล์ลายเซ็นที่ค้างถ้า transaction ล้มเหลว
    try { if (sigFile) fs.unlinkSync(path.join(SIG_DIR, sigFile)); } catch {}
    res.status(400).json({ error: e.message });
  }
});

// ===== POST /api/uai/:id/reject-exec — CCO/CMO/CPO ปฏิเสธ =====
router.post('/:id/reject-exec', auth, requireRole(['cco', 'cmo', 'cpo']), (req, res) => {
  const uai = db.prepare('SELECT * FROM uai_documents WHERE id = ?').get(req.params.id);
  if (!uai) return res.status(404).json({ error: 'ไม่พบ UAI' });

  const expectedRole = SIGN_ROLE_MAP[uai.status];
  if (req.user.role !== expectedRole) return res.status(403).json({ error: 'ไม่ใช่คิวของคุณ' });

  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: 'กรุณากรอกเหตุผลการปฏิเสธ' });

  try {
    uaiService.rejectExec({ uai, reason, actorId: req.user.id, actorRole: req.user.role, actorIp: req.ip });
    res.json({ ok: true, status: 'uai_rejected_by_exec' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
