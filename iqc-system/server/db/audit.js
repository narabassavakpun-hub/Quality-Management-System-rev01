// ===== AUDIT LOG / SETTINGS / SECURE TOKEN HELPERS =====
// แยกจาก database.js ตาม CLAUDE.md §8/§14 — attach helpers ให้ db object ผ่าน factory pattern
// กฎ (CLAUDE.md §14): auditLog() ต้องเรียกภายใน transaction เดียวกับ operation เสมอ
//
// การใช้งาน: require('./audit')(db)  → ผูก db.auditLog / db.getSetting / db.setSetting / db.generateSecureToken
//           / db.getSecretSetting / db.setSecretSetting

const crypto = require('crypto');
const { encryptSecret, decryptSecret } = require('../lib/secretsCrypto');

module.exports = function attachAudit(db) {
  // ---- Audit log ----
  db.auditLog = function(tableName, recordId, action, oldValue, newValue, userId, ip) {
    try {
      db.prepare(`INSERT INTO audit_logs (table_name, record_id, action, old_value, new_value, user_id, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(tableName, recordId, action, oldValue ? JSON.stringify(oldValue) : null, newValue ? JSON.stringify(newValue) : null, userId || null, ip || null);
    } catch (e) {
      console.error('[AuditLog Error]', e.message);
    }
  };

  // ---- Settings key/value ----
  db.getSetting = function(key) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : null;
  };
  db.setSetting = function(key, value) {
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP").run(key, value);
  };

  // ---- Secret settings (เข้ารหัส at-rest — เช่น ad_secret_key) — CLAUDE.md §24 ----
  // เก็บจริงเป็น "enc:v1:<base64>" ผ่าน settings table เดียวกัน ไม่มีตารางแยก
  db.getSecretSetting = function(key) {
    return decryptSecret(db.getSetting(key));
  };
  db.setSecretSetting = function(key, plaintext) {
    db.setSetting(key, plaintext ? encryptSecret(plaintext) : '');
  };

  // ---- Secure token (CLAUDE.md §3.6: crypto.randomBytes เท่านั้น — ห้าม Math.random/uuid) ----
  db.generateSecureToken = function() {
    return crypto.randomBytes(32).toString('hex');
  };
};
