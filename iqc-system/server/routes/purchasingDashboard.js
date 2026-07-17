// Purchasing Dashboard (Req 2/3/8) — สรุป/รายการ NCR-NCP ต่อ Supplier ที่ purchasing ดูแล
// แยกจาก /api/dashboard (GET /stats เดิมใช้ร่วมกันทุก role อื่น, ไม่แตะ)
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const svc = require('../services/purchasingDashboardService');

const purchasingRoles = [auth, requireRole(['purchasing', 'purchasing_manager', 'admin'])];
// Team Summary/Members/Member Detail (Req 3) — เห็นข้อมูลเพื่อนร่วมทีมคนอื่นได้ ต้องเป็น manager/admin เท่านั้น
// + cco (read-only — ขอเห็นภาพรวมจัดซื้อทั้งหมดในหน้า Dashboard ของตัวเอง ไม่มี endpoint เขียนใดๆ ในไฟล์นี้เลย)
const managerOnly = [auth, requireRole(['purchasing_manager', 'admin', 'cco'])];

router.get('/summary', ...purchasingRoles, (req, res) => {
  res.json(svc.getSummary(req.user));
});

router.get('/suppliers', ...purchasingRoles, (req, res) => {
  res.json(svc.getSuppliers(req.user, req.query));
});

router.get('/ncrs', ...purchasingRoles, (req, res) => {
  res.json(svc.getNcrList(req.user, req.query));
});

router.get('/team', ...managerOnly, (req, res) => {
  res.json({ summary: svc.getTeamSummary(req.user), members: svc.getTeamMembers() });
});

router.get('/team/:memberId', ...managerOnly, (req, res) => {
  const detail = svc.getMemberDetail(Number(req.params.memberId), req.query);
  if (!detail) return res.status(404).json({ error: 'ไม่พบพนักงาน' });
  res.json(detail);
});

module.exports = router;
