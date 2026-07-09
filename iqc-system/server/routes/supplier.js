const express = require('express');
const router = express.Router();
const db = require('../db/database');
const uploads = require('../middleware/upload');
const { getUsersByRole, createNotification, sendTelegram } = require('../lib/notify');
const supplierService = require('../services/supplierService');

// GET /api/supplier/ncr/:token  (no auth — public URL for supplier)
router.get('/ncr/:token', (req, res) => {
  const ncr = db.prepare(`
    SELECT n.*, s.name as supplier_name, b.invoice_no, b.po_no as bill_po, b.received_date
    FROM ncrs n
    LEFT JOIN bills b ON b.id = n.bill_id
    LEFT JOIN suppliers s ON s.id = b.supplier_id
    WHERE n.supplier_token = ?
  `).get(req.params.token);

  if (!ncr) return res.status(404).json({ error: 'ไม่พบเอกสาร NCR' });

  // Check token expiry
  if (ncr.token_expires_at && new Date(ncr.token_expires_at) < new Date()) {
    return res.status(403).json({ error: 'ลิ้งค์หมดอายุแล้ว กรุณาติดต่อฝ่ายจัดซื้อเพื่อขอลิ้งค์ใหม่' });
  }

  if (ncr.status !== 'pending_supplier') {
    return res.status(400).json({ error: 'NCR นี้ไม่ได้อยู่ในสถานะรอ Supplier ตอบกลับ' });
  }

  ncr.items = db.prepare(`
    SELECT ni.*, dc.name as defect_category_name
    FROM ncr_items ni LEFT JOIN defect_categories dc ON dc.id = ni.defect_category_id
    WHERE ni.ncr_id = ?
  `).all(ncr.id);

  // รูปภาพปัญหาจาก bill_item_images ของแต่ละรายการ
  for (const item of ncr.items) {
    item.bill_item_images = item.bill_item_id
      ? db.prepare('SELECT * FROM bill_item_images WHERE bill_item_id = ?').all(item.bill_item_id)
      : [];
  }

  ncr.images = db.prepare('SELECT * FROM ncr_images WHERE ncr_id = ?').all(ncr.id);

  const response = db.prepare('SELECT id FROM supplier_responses WHERE ncr_id = ? AND superseded_at IS NULL').get(ncr.id);
  ncr.already_responded = !!response;

  res.json(ncr);
});

// POST /api/supplier/ncr/:token/respond  (no auth)
router.post('/ncr/:token/respond', uploads.supplierResponse.array('attachments', 10), uploads.verifyMagic, uploads.compressImages, (req, res) => {
  const ncr = db.prepare('SELECT * FROM ncrs WHERE supplier_token = ?').get(req.params.token);
  if (!ncr) return res.status(404).json({ error: 'ไม่พบเอกสาร NCR' });

  // Check token expiry
  if (ncr.token_expires_at && new Date(ncr.token_expires_at) < new Date()) {
    return res.status(403).json({ error: 'ลิ้งค์หมดอายุแล้ว กรุณาติดต่อฝ่ายจัดซื้อ' });
  }

  if (ncr.status !== 'pending_supplier') {
    return res.status(400).json({ error: 'NCR นี้ไม่ได้อยู่ในสถานะรอตอบ' });
  }

  const existing = db.prepare('SELECT id FROM supplier_responses WHERE ncr_id = ? AND superseded_at IS NULL').get(ncr.id);
  if (existing) return res.status(400).json({ error: 'ส่งคำตอบแล้ว ไม่สามารถส่งซ้ำได้' });

  const { root_cause, corrective_action, preventive_action, completion_date, respondent_name } = req.body;
  if (!respondent_name || !respondent_name.trim()) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อผู้ตอบ' });
  }
  if (!root_cause || !corrective_action || !preventive_action) {
    return res.status(400).json({ error: 'กรุณากรอกสาเหตุหลัก, การแก้ไข และการป้องกัน' });
  }

  try {
    supplierService.submitSupplierResponse({
      ncr, respondent_name, root_cause, corrective_action, preventive_action, completion_date, files: req.files,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
