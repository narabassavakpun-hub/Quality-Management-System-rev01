// Unit tests — lib/mailer.js (S128 email notifications)
// ไม่ยิง network จริง — ทดสอบเฉพาะ "SMTP ยังไม่ได้ตั้งค่า → no-op เงียบๆ ไม่ throw" (เหมือน backupService's R2-not-configured test)
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.IQC_DB_PATH = path.join(os.tmpdir(), `iqc-mailer-${process.pid}-${Date.now()}.db`);
process.env.NODE_ENV = 'test';
process.env.SETTINGS_ENCRYPTION_KEY = 'a'.repeat(64);

const test = require('node:test');
const assert = require('node:assert');
const db = require('../db/database');
const { sendEmail, getTransporter } = require('../lib/mailer');

test.after(() => {
  try { db.close(); } catch {}
  for (const f of [process.env.IQC_DB_PATH, process.env.IQC_DB_PATH + '-wal', process.env.IQC_DB_PATH + '-shm']) {
    try { fs.unlinkSync(f); } catch {}
  }
});

test('MAIL-01 SMTP ยังไม่ได้ตั้งค่า → getTransporter คืน null', () => {
  assert.equal(getTransporter(), null);
});

// S128e — บั๊กจริงที่ user เจอ: ปุ่ม "ทดสอบส่งอีเมล" ขึ้น "สำเร็จ" ทั้งที่ SMTP auth ล้มเหลวจริง เพราะ sendEmail()
// เดิมกลืน error ทิ้งไม่คืนผลลัพธ์อะไรเลย (ทำให้ route /test เห็นแค่ promise resolve แล้วตอบ ok:true เสมอ) — แก้แล้ว
// ให้คืน { ok, error? } เสมอ (ไม่ throw — ยังปลอดภัยสำหรับ fire-and-forget call site เดิม) เทสนี้คือ regression guard
test('MAIL-02 SMTP ยังไม่ได้ตั้งค่า → sendEmail ไม่ throw แต่คืน { ok: false } (ไม่ใช่ ok:true ลอยๆ)', async () => {
  const result = await sendEmail('someone@example.com', 'subject', '<p>body</p>');
  assert.equal(result.ok, false);
  assert.ok(result.error);
});

test('MAIL-03 ไม่มีผู้รับ (to ว่าง) → sendEmail ไม่ throw แต่คืน { ok: false }', async () => {
  const result = await sendEmail('', 'subject', '<p>body</p>');
  assert.equal(result.ok, false);
  assert.ok(result.error);
});

test('MAIL-04 ตั้งค่า SMTP ครบ → getTransporter คืน transporter object', () => {
  db.setSetting('smtp_host', 'smtp.example.com');
  db.setSetting('smtp_port', '587');
  db.setSetting('smtp_user', 'notify@example.com');
  db.setSecretSetting('smtp_password', 'app-password');
  const t = getTransporter();
  assert.ok(t, 'ควรได้ transporter เมื่อตั้งค่าครบ');
  assert.equal(typeof t.sendMail, 'function');
});
