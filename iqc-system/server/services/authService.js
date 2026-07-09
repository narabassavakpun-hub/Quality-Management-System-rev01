// ===== Auth Service — orchestration ของ login (Local/AD strategy) — CLAUDE.md §24 =====
// สกัดจาก routes/auth.js — route handler เหลือแค่ validate + response, service ทำ transaction
// throw error พร้อม .status ให้ controller map เป็น HTTP status (เหมือน service อื่นในระบบ เช่น ncrService.js)
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../db/database');
const { resolveProvider } = require('./auth/resolveProvider');
const adProvider = require('./auth/adProvider');

function httpError(message, status) { const e = new Error(message); e.status = status; return e; }

function recordFailedLogin(user, ip) {
  const maxAttempts = Number(db.getSetting('login_attempt_max')) || 5;
  const lockMinutes = Number(db.getSetting('lock_account_minutes')) || 15;

  db.transaction(() => {
    const failedCount = (user.failed_login_count || 0) + 1;
    const lockedUntil = failedCount >= maxAttempts
      ? new Date(Date.now() + lockMinutes * 60000).toISOString()
      : null;
    db.prepare('UPDATE users SET failed_login_count = ?, locked_until = ? WHERE id = ?')
      .run(failedCount, lockedUntil, user.id);
    db.auditLog('users', user.id, 'LOGIN_FAILED', null, { username: user.username }, user.id, ip);
  })();
}

async function login({ username, password, ip, forceAdGateway = false }) {
  if (!username || !password) throw httpError('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน', 400);

  // BUG-001 (เดิม): filter inactive users ที่ query level
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);
  if (!user) {
    db.transaction(() => {
      db.auditLog('users', 0, 'LOGIN_FAILED', null, { username }, null, ip);
    })();
    throw httpError('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง หรือบัญชีถูกระงับ', 401);
  }

  // Account lockout — ทน restart ได้ (ต่างจาก express-rate-limit เดิมที่เป็น in-memory เท่านั้น)
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw httpError('บัญชีถูกล็อกชั่วคราวจากการพยายามเข้าสู่ระบบผิดหลายครั้ง กรุณาลองใหม่ภายหลัง', 423);
  }

  const authMode = db.getSetting('auth_mode') || 'local';
  const adEnabled = db.getSetting('ad_enabled') === '1';
  const adActive = authMode === 'hybrid' && adEnabled;

  let provider;
  let authenticateOpts = { user, password };

  if (forceAdGateway) {
    // ปุ่ม "Internal AP System" — บังคับเช็คกับ AD Gateway โดยตรง ข้าม Local Pass Bypass เสมอ
    // (ต่างจาก resolveProvider ปกติที่ cache-first) — ต้องเป็น account ที่เปิด AD ไว้จริงเท่านั้น
    if ((user.auth_provider || 'local') !== 'ad') {
      throw httpError('บัญชีนี้ยังไม่ได้เปิดใช้งาน Active Directory — ติดต่อผู้ดูแลระบบเพื่อเปิดใช้งานก่อน', 400);
    }
    if (!adActive) {
      throw httpError('ระบบยังไม่ได้เปิดใช้งาน Active Directory ในขณะนี้ — ติดต่อผู้ดูแลระบบ', 503);
    }
    provider = adProvider;
    authenticateOpts = { user, password, skipCache: true };
  } else {
    // กฎเหล็ก: local user ต้องไม่มีวันถูกบล็อกเพราะ AD — ดู services/auth/resolveProvider.js
    provider = resolveProvider({ authMode, adEnabled, userAuthProvider: user.auth_provider || 'local' });
  }

  let providerResult;
  try {
    providerResult = await provider.authenticate(authenticateOpts);
  } catch (e) {
    if (e.lockoutExempt) {
      // ปัญหาโครงสร้าง/เวลาเครื่อง (AD unreachable/ยังไม่ตั้งค่า/timestamp หมดอายุ) — ไม่ใช่ความผิดของ user
      db.transaction(() => {
        db.auditLog('users', user.id, 'LOGIN_FAILED', null, { username, reason: 'ad_unavailable' }, user.id, ip);
      })();
    } else {
      recordFailedLogin(user, ip);
    }
    throw e;
  }

  const sessionToken = crypto.randomBytes(16).toString('hex');
  const jwtExpirationHours = Number(db.getSetting('jwt_expiration_hours')) || 8;

  db.transaction(() => {
    if (providerResult.synced && providerResult.newPasswordHash) {
      db.prepare('UPDATE users SET password_hash = ?, ad_last_synced_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(providerResult.newPasswordHash, user.id);
    }
    db.prepare('UPDATE users SET session_token = ?, failed_login_count = 0, locked_until = NULL WHERE id = ?')
      .run(sessionToken, user.id);
    db.auditLog('users', user.id, 'LOGIN', null, null, user.id, ip);
  })();

  const token = jwt.sign(
    { id: user.id, username: user.username, full_name: user.full_name, role: user.role, sessionToken },
    process.env.JWT_SECRET,
    { expiresIn: `${jwtExpirationHours}h` }
  );

  return {
    token,
    jwtExpirationHours,
    user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role, qc_station: user.qc_station || null },
  };
}

module.exports = { login };
