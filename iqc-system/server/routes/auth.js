const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const db = require('../db/database');
const auth = require('../middleware/auth');
const authService = require('../services/authService');

// DEVMORE H1 — secure cookie (HTTPS-only) ใน production
// ค่าเริ่มต้น = true เมื่อ NODE_ENV=production; override ได้ด้วย COOKIE_SECURE
//   COOKIE_SECURE=false → สำหรับทดสอบ local ผ่าน http เท่านั้น (production ผ่าน https ห้ามตั้ง false)
const COOKIE_SECURE = process.env.COOKIE_SECURE !== undefined
  ? process.env.COOKIE_SECURE === 'true'
  : process.env.NODE_ENV === 'production';

// maxAge มาจาก settings.jwt_expiration_hours เสมอ (CLAUDE.md §24/§7) — กันปัญหา cookie/JWT หมดอายุไม่ตรงกัน
// ไม่ส่ง maxAgeMs (undefined) → cookie แบบ session (ใช้ตอน clearCookie ให้ลบได้จริงเหมือนเดิม)
function cookieOptions(maxAgeMs) {
  return { httpOnly: true, sameSite: 'strict', secure: COOKIE_SECURE, ...(maxAgeMs ? { maxAge: maxAgeMs } : {}) };
}

// BUG-002: 5 failed attempts per 15 min per username (ด่านแรก in-memory เร็ว — ด่านสองแบบทน restart อยู่ใน authService)
// skipSuccessfulRequests=true → only failed logins (401) consume quota; successful logins don't
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.body?.username ? req.body.username.toLowerCase() : ipKeyGenerator(req),
  skipSuccessfulRequests: true,
  message: { error: 'ลองใหม่ได้ใน 15 นาที' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/login', loginLimiter, async (req, res) => {
  const { username, password, forceAdGateway } = req.body;
  try {
    const { token, jwtExpirationHours, user } = await authService.login({ username, password, ip: req.ip, forceAdGateway: !!forceAdGateway });
    res.cookie('token', token, cookieOptions(jwtExpirationHours * 60 * 60 * 1000));
    res.json(user);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.post('/logout', (req, res) => {
  try {
    const jwtToken = req.cookies?.token;
    if (jwtToken) {
      const payload = jwt.verify(jwtToken, process.env.JWT_SECRET);
      db.prepare('UPDATE users SET session_token = NULL WHERE id = ?').run(payload.id);
    }
  } catch {}
  res.clearCookie('token', cookieOptions());
  res.json({ ok: true });
});

router.get('/me', auth, (req, res) => {
  res.json(req.user);
});

// BUG-003: allow user to change their own password
router.post('/change-password', auth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: 'กรุณากรอกรหัสผ่านเดิมและรหัสผ่านใหม่' });

  const minLength = parseInt(db.getSetting('password_min_length'), 10) || 8;
  if (newPassword.length < minLength)
    return res.status(400).json({ error: `รหัสผ่านใหม่ต้องยาวอย่างน้อย ${minLength} ตัวอักษร` });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(currentPassword, user.password_hash))
    return res.status(401).json({ error: 'รหัสผ่านเดิมไม่ถูกต้อง' });

  const hash = bcrypt.hashSync(newPassword, parseInt(process.env.BCRYPT_ROUNDS) || 12);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
  db.auditLog('users', req.user.id, 'CHANGE_PASSWORD', null, null, req.user.id, req.ip);
  res.json({ ok: true });
});

module.exports = router;
