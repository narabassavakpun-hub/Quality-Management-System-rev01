// ===== System Settings routes — General/Authentication/Environment/Security/Advanced — CLAUDE.md §24 =====
// Controller บาง: validate เบื้องต้น → เรียก service → ตอบ HTTP (เหมือน routes/ncr.js เรียก ncrService)
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const authSettingsService = require('../services/authSettingsService');
const environmentService = require('../services/environmentService');

const adminOnly = [auth, requireRole(['admin'])];

// ---- General ----
router.get('/general', ...adminOnly, (req, res) => {
  res.json(authSettingsService.getGeneralSettings());
});
router.post('/general', ...adminOnly, (req, res) => {
  authSettingsService.saveGeneralSettings(req.body, req.user.id, req.ip);
  res.json({ ok: true });
});

// ---- Authentication (Local/AD) ----
router.get('/auth', ...adminOnly, (req, res) => {
  res.json(authSettingsService.getAuthSettings());
});
router.post('/auth', ...adminOnly, (req, res) => {
  try {
    authSettingsService.saveAuthSettings(req.body, req.user.id, req.ip);
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});
router.post('/auth/test', ...adminOnly, async (req, res) => {
  try {
    const result = await authSettingsService.testAdConnection();
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ---- Security ----
router.get('/security', ...adminOnly, (req, res) => {
  res.json(authSettingsService.getSecuritySettings());
});
router.post('/security', ...adminOnly, (req, res) => {
  authSettingsService.saveSecuritySettings(req.body, req.user.id, req.ip);
  res.json({ ok: true });
});

// ---- Advanced ----
router.get('/advanced', ...adminOnly, (req, res) => {
  res.json(authSettingsService.getAdvancedSettings());
});
router.post('/advanced', ...adminOnly, (req, res) => {
  authSettingsService.saveAdvancedSettings(req.body, req.user.id, req.ip);
  res.json({ ok: true });
});

// ---- Environment presets ----
router.get('/environments', ...adminOnly, (req, res) => {
  res.json(environmentService.listPresets());
});
router.post('/environments', ...adminOnly, (req, res) => {
  try {
    const id = environmentService.upsertPreset(req.body, req.user.id, req.ip);
    res.json({ ok: true, id });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});
router.delete('/environments/:id', ...adminOnly, (req, res) => {
  try {
    environmentService.deletePreset(Number(req.params.id), req.user.id, req.ip);
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});
router.post('/environments/:id/apply', ...adminOnly, (req, res) => {
  try {
    environmentService.applyPreset(Number(req.params.id), req.user.id, req.ip);
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

module.exports = router;
