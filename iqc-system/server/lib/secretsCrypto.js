// ===== SECRETS ENCRYPTION (AES-256-GCM) =====
// เข้ารหัส/ถอดรหัส secret ที่เก็บใน settings table (เช่น ad_secret_key) — CLAUDE.md §24
// Master key มาจาก env var SETTINGS_ENCRYPTION_KEY (hex 64 ตัว = 32 bytes) เท่านั้น — ห้ามเก็บใน DB
// (chicken-and-egg: จะเข้ารหัสค่าที่เก็บใน DB ด้วย key ที่ก็เก็บใน DB เดียวกันไม่ได้) เหมือน JWT_SECRET เดิม
const crypto = require('crypto');

const ENC_PREFIX = 'enc:v1:';
const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey() {
  const hex = process.env.SETTINGS_ENCRYPTION_KEY || '';
  if (hex.length !== 64) {
    throw new Error('SETTINGS_ENCRYPTION_KEY ไม่ถูกต้อง — ต้องเป็น hex 64 ตัวอักษร (32 bytes) ตั้งค่าใน .env');
  }
  return Buffer.from(hex, 'hex');
}

function encryptSecret(plaintext) {
  if (!plaintext) return '';
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return ENC_PREFIX + Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

function decryptSecret(stored) {
  if (!stored) return '';
  if (!stored.startsWith(ENC_PREFIX)) return stored; // ค่าเก่า/ค่าว่างที่ยังไม่เคยเข้ารหัส
  const key = getKey();
  const raw = Buffer.from(stored.slice(ENC_PREFIX.length), 'base64');
  const iv = raw.subarray(0, IV_LEN);
  const authTag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = raw.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

module.exports = { encryptSecret, decryptSecret, ENC_PREFIX };
