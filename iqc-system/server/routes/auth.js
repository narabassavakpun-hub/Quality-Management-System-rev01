const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const db = require('../db/database');
const auth = require('../middleware/auth');

// DEVMORE H1 — secure cookie (HTTPS-only) ใน production
// ค่าเริ่มต้น = true เมื่อ NODE_ENV=production; override ได้ด้วย COOKIE_SECURE
//   COOKIE_SECURE=false → สำหรับทดสอบ local ผ่าน http เท่านั้น (production ผ่าน https ห้ามตั้ง false)
const COOKIE_SECURE = process.env.COOKIE_SECURE !== undefined
  ? process.env.COOKIE_SECURE === 'true'
  : process.env.NODE_ENV === 'production';

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'strict',
  secure: COOKIE_SECURE,
  maxAge: 8 * 60 * 60 * 1000,
};
// ใช้ option เดียวกัน (ตัด maxAge) ตอน clearCookie เพื่อให้ลบ cookie ได้จริง
const CLEAR_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'strict',
  secure: COOKIE_SECURE,
};

// BUG-002: 5 failed attempts per 15 min per username
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

router.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });

  // BUG-001: filter inactive users at query level
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);
  if (!user) {
    db.auditLog('users', 0, 'LOGIN_FAILED', null, { username }, null, req.ip); // DEVMORE H8
    return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง หรือบัญชีถูกระงับ' });
  }

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) {
    db.auditLog('users', user.id, 'LOGIN_FAILED', null, { username }, user.id, req.ip); // DEVMORE H8
    return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง หรือบัญชีถูกระงับ' });
  }

  // สร้าง session token ใหม่ → ทำให้ session เก่าจากอุปกรณ์อื่นหมดอายุทันที
  const sessionToken = crypto.randomBytes(16).toString('hex');
  db.prepare('UPDATE users SET session_token = ? WHERE id = ?').run(sessionToken, user.id);

  const token = jwt.sign(
    { id: user.id, username: user.username, full_name: user.full_name, role: user.role, sessionToken },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.cookie('token', token, COOKIE_OPTIONS);
  db.auditLog('users', user.id, 'LOGIN', null, null, user.id, req.ip); // DEVMORE H8
  res.json({ id: user.id, username: user.username, full_name: user.full_name, role: user.role, qc_station: user.qc_station || null });
});

router.post('/logout', (req, res) => {
  try {
    const jwtToken = req.cookies?.token;
    if (jwtToken) {
      const payload = jwt.verify(jwtToken, process.env.JWT_SECRET);
      db.prepare('UPDATE users SET session_token = NULL WHERE id = ?').run(payload.id);
    }
  } catch {}
  res.clearCookie('token', CLEAR_COOKIE_OPTIONS);
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
  if (newPassword.length < 8)
    return res.status(400).json({ error: 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(currentPassword, user.password_hash))
    return res.status(401).json({ error: 'รหัสผ่านเดิมไม่ถูกต้อง' });

  const hash = bcrypt.hashSync(newPassword, parseInt(process.env.BCRYPT_ROUNDS) || 12);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
  db.auditLog('users', req.user.id, 'CHANGE_PASSWORD', null, null, req.user.id, req.ip);
  res.json({ ok: true });
});

module.exports = router;
