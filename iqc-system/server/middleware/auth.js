const jwt = require('jsonwebtoken');
const db = require('../db/database');

function authMiddleware(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // ตรวจ session_token ป้องกัน login ซ้อนจากอุปกรณ์อื่น + ดึง role/full_name สดจาก DB
    // (DEVMORE M14 — เปลี่ยน role/ระงับสิทธิ์มีผลทันที ไม่ต้องรอ login ใหม่)
    const dbUser = db.prepare('SELECT session_token, role, full_name, qc_station FROM users WHERE id = ? AND is_active = 1').get(payload.id);
    if (!dbUser) return res.status(401).json({ error: 'บัญชีผู้ใช้ไม่พบหรือถูกระงับ' });
    if (dbUser.session_token !== payload.sessionToken) {
      return res.status(401).json({ error: 'มีการเข้าสู่ระบบจากอุปกรณ์อื่น กรุณาเข้าสู่ระบบใหม่' });
    }

    req.user = { ...payload, role: dbUser.role, full_name: dbUser.full_name, qc_station: dbUser.qc_station };
    next();
  } catch {
    res.status(401).json({ error: 'Session หมดอายุ กรุณาเข้าสู่ระบบใหม่' });
  }
}

module.exports = authMiddleware;
