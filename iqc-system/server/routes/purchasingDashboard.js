// Purchasing Dashboard (Req 2/3/8) — สรุป/รายการ NCR-NCP ต่อ Supplier ที่ purchasing ดูแล
// แยกจาก /api/dashboard (GET /stats เดิมใช้ร่วมกันทุก role อื่น, ไม่แตะ)
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const svc = require('../services/purchasingDashboardService');

const purchasingRoles = [auth, requireRole(['purchasing', 'purchasing_manager', 'admin'])];

router.get('/summary', ...purchasingRoles, (req, res) => {
  res.json(svc.getSummary(req.user));
});

router.get('/suppliers', ...purchasingRoles, (req, res) => {
  res.json(svc.getSuppliers(req.user, req.query));
});

router.get('/ncrs', ...purchasingRoles, (req, res) => {
  res.json(svc.getNcrList(req.user, req.query));
});

module.exports = router;
