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

const UAI_STATUS_SEQUENCE = [
  'uai_pending_qc_manager',
  'uai_pending_purchasing',
  'uai_pending_cco',
  'uai_pending_cmo',
  'uai_pending_cpo',
  'uai_pending_qc_ack',
  'uai_pending_production_ack',
  'uai_pending_qmr_ack',
  'uai_completed',
];

const SIGN_ROLE_MAP = {
  uai_pending_purchasing: 'purchasing',
  uai_pending_cco: 'cco',
  uai_pending_cmo: 'cmo',
  uai_pending_cpo: 'cpo',
  uai_pending_qc_ack: 'qc_manager',
  uai_pending_production_ack: 'production_manager',
  uai_pending_qmr_ack: 'qmr',
};

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

  const review = db.transaction(() => {
    // DEVMORE H7 — optimistic lock กันกดซ้อน
    const lock = db.prepare("UPDATE uai_documents SET status=status WHERE id=? AND status='uai_pending_qc_manager'").run(uai.id);
    if (lock.changes === 0) throw new Error('เอกสารถูกดำเนินการแล้ว กรุณารีเฟรชหน้า');
    if (!isApproved) {
      db.prepare("UPDATE uai_documents SET status='uai_rejected' WHERE id=?").run(uai.id);
      db.prepare("UPDATE ncrs SET status='pending_supplier', uai_close_remark=NULL WHERE id=?").run(uai.ncr_id);
      db.prepare('INSERT INTO uai_signatures (uai_id, role, user_id, signature_image, action, comment) VALUES (?, ?, ?, ?, ?, ?)')
        .run(uai.id, 'qc_manager', req.user.id, '', 'review_rejected', reviewComment);
      for (const u of getUsersByRole('purchasing')) {
        createNotification(u.id, 'UAI ไม่อนุมัติ', `${uai.uai_code} ถูกปฏิเสธ${reviewComment ? ': ' + reviewComment : ''}`, `/uai/${uai.id}`);
      }
      sendTelegram(db.getSetting('telegram_group_purchasing'), `[IQC] ${uai.uai_code} — QC Manager ไม่อนุมัติ UAI${reviewComment ? '\nเหตุผล: ' + reviewComment : ''}`);
      db.auditLog('uai_documents', uai.id, 'REJECT', { status: uai.status }, { status: 'uai_rejected' }, req.user.id, req.ip);
      return 'uai_rejected';
    }

    db.prepare("UPDATE uai_documents SET status='uai_pending_purchasing' WHERE id=?").run(uai.id);
    db.prepare('INSERT INTO uai_signatures (uai_id, role, user_id, signature_image, action, comment) VALUES (?, ?, ?, ?, ?, ?)')
      .run(uai.id, 'qc_manager', req.user.id, '', 'review_approved', reviewComment);

    for (const u of getUsersByRole('purchasing')) {
      createNotification(u.id, 'UAI อนุมัติ รอลงนาม', `${uai.uai_code} ผ่านการตรวจสอบแล้ว รอจัดซื้อลงนาม`, `/uai/${uai.id}`);
    }
    sendTelegram(db.getSetting('telegram_group_purchasing'), `[IQC] ${uai.uai_code} — QC Manager อนุมัติ\nรอจัดซื้อลงนาม UAI`);
    db.auditLog('uai_documents', uai.id, 'APPROVE', { status: uai.status }, { status: 'uai_pending_purchasing' }, req.user.id, req.ip);
    return 'uai_pending_purchasing';
  });

  try {
    const nextStatus = review();
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
router.post('/:id/images', auth, requireRole(['purchasing']), uploads.uai.array('images', 10), uploads.verifyMagic, (req, res) => {
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

  const sign = db.transaction(() => {
    // Optimistic lock
    const currentIndex = UAI_STATUS_SEQUENCE.indexOf(uai.status);
    const nextStatus = UAI_STATUS_SEQUENCE[currentIndex + 1];

    const changed = db.prepare('UPDATE uai_documents SET status=? WHERE id=? AND status=?').run(nextStatus, uai.id, uai.status);
    if (changed.changes === 0) throw new Error('เอกสารถูกดำเนินการแล้ว กรุณารีเฟรชหน้า');

    db.prepare('INSERT INTO uai_signatures (uai_id, role, user_id, signature_image, action, comment) VALUES (?, ?, ?, ?, ?, ?)')
      .run(uai.id, req.user.role, req.user.id, sigFile, action, comment || null);

    db.auditLog('uai_documents', uai.id, 'SIGN', { status: uai.status }, { status: nextStatus, role: req.user.role }, req.user.id, req.ip);

    // Per-step notifications
    if (nextStatus === 'uai_pending_cco') {
      for (const u of getUsersByRole('cco')) createNotification(u.id, 'UAI รอลงนาม CCO', `${uai.uai_code} รอ CCO ลงนาม`, `/uai/${uai.id}`);
    } else if (nextStatus === 'uai_pending_cmo') {
      for (const u of getUsersByRole('cmo')) createNotification(u.id, 'UAI รอลงนาม CMO', `${uai.uai_code} รอ CMO ลงนาม`, `/uai/${uai.id}`);
    } else if (nextStatus === 'uai_pending_cpo') {
      for (const u of getUsersByRole('cpo')) createNotification(u.id, 'UAI รอลงนาม CPO', `${uai.uai_code} รอ CPO ลงนาม`, `/uai/${uai.id}`);
    } else if (nextStatus === 'uai_pending_qc_ack') {
      for (const u of getUsersByRole('qc_manager')) createNotification(u.id, 'UAI รอรับทราบ QC', `${uai.uai_code} ผู้บริหารลงนามแล้ว รอ QC รับทราบ`, `/uai/${uai.id}`);
      sendTelegram(db.getSetting('telegram_group_qc'), `[IQC] ${uai.uai_code} — ผู้บริหารลงนามแล้ว รอ QC Manager รับทราบ`);
    } else if (nextStatus === 'uai_pending_production_ack') {
      for (const u of getUsersByRole('production_manager')) createNotification(u.id, 'UAI รอรับทราบ ผลิต', `${uai.uai_code} รอผู้จัดการผลิตรับทราบ`, `/uai/${uai.id}`);
    } else if (nextStatus === 'uai_pending_qmr_ack') {
      for (const u of getUsersByRole('qmr')) createNotification(u.id, 'UAI รอรับทราบ QMR', `${uai.uai_code} รอ QMR รับทราบ`, `/uai/${uai.id}`);
    } else if (nextStatus === 'uai_completed') {
      // ปิด NCR พร้อม stamp อ้างอิง UAI เมื่อ UAI ครบทุกขั้นตอน
      const ncr = db.prepare('SELECT ncr_code FROM ncrs WHERE id=?').get(uai.ncr_id);
      const closeRemark = `ยอมรับใช้พิเศษ — อ้างอิงเลข UAI: ${uai.uai_code}`;
      db.prepare("UPDATE ncrs SET status='closed', uai_close_remark=? WHERE id=?")
        .run(closeRemark, uai.ncr_id);
      db.auditLog('ncrs', uai.ncr_id, 'CLOSE', { status: 'pending_uai' }, { status: 'closed', uai_close_remark: closeRemark }, req.user.id, req.ip);

      for (const u of getUsersByRole('purchasing', 'qc_manager', 'qmr')) {
        createNotification(u.id, 'UAI เสร็จสมบูรณ์ — NCR ปิดแล้ว', `${uai.uai_code} ปิดครบทุกขั้นตอน — NCR ${ncr?.ncr_code} ปิดแล้ว`, `/uai/${uai.id}`);
      }
      sendTelegram(db.getSetting('telegram_group_qc'), `[IQC] ${uai.uai_code} — UAI เสร็จสมบูรณ์\nNCR ${ncr?.ncr_code} ปิดแล้ว (ยอมรับใช้พิเศษ)`);
      sendTelegram(db.getSetting('telegram_group_purchasing'), `[IQC] ${uai.uai_code} — UAI เสร็จสมบูรณ์\nNCR ${ncr?.ncr_code} ปิดแล้ว (ยอมรับใช้พิเศษ)`);
    }

    return nextStatus;
  });

  try {
    const nextStatus = sign();
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

  const ncr = db.prepare('SELECT ncr_code FROM ncrs WHERE id=?').get(uai.ncr_id);
  const rejectorLabel = { cco: 'CCO', cmo: 'CMO', cpo: 'CPO' }[req.user.role] || req.user.role;

  const reject = db.transaction(() => {
    // DEVMORE H7 — optimistic lock: เปลี่ยนสถานะเฉพาะเมื่อยังอยู่ในคิวของผู้ปฏิเสธ
    const locked = db.prepare("UPDATE uai_documents SET status='uai_rejected_by_exec' WHERE id=? AND status=?").run(uai.id, uai.status);
    if (locked.changes === 0) throw new Error('เอกสารถูกดำเนินการแล้ว กรุณารีเฟรชหน้า');
    db.prepare('INSERT INTO uai_signatures (uai_id, role, user_id, signature_image, action, comment) VALUES (?, ?, ?, ?, ?, ?)')
      .run(uai.id, req.user.role, req.user.id, '', 'rejected', reason);

    // คืนสถานะ NCR กลับไปรอผู้ผลิตตอบกลับ
    db.prepare("UPDATE ncrs SET status='pending_supplier', uai_close_remark=NULL WHERE id=?").run(uai.ncr_id);

    const msg = `${uai.uai_code} — ${rejectorLabel} ไม่อนุมัติ\nNCR ${ncr?.ncr_code} กลับสู่สถานะรอผู้ผลิตตอบ\nเหตุผล: ${reason}`;
    for (const u of getUsersByRole('purchasing', 'qc_manager', 'qmr')) {
      createNotification(u.id, `UAI ไม่อนุมัติโดย ${rejectorLabel}`, `${uai.uai_code} — ${reason}`, `/uai/${uai.id}`);
    }
    sendTelegram(db.getSetting('telegram_group_qc'), `[IQC] ${msg}`);
    sendTelegram(db.getSetting('telegram_group_purchasing'), `[IQC] ${msg}`);

    db.auditLog('uai_documents', uai.id, 'REJECT_EXEC', { status: uai.status }, { status: 'uai_rejected_by_exec', reason }, req.user.id, req.ip);
    db.auditLog('ncrs', uai.ncr_id, 'REOPEN', { status: 'pending_uai' }, { status: 'pending_supplier', note: `UAI ${uai.uai_code} ถูกปฏิเสธโดย ${rejectorLabel}` }, req.user.id, req.ip);
  });

  try {
    reject();
    res.json({ ok: true, status: 'uai_rejected_by_exec' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
