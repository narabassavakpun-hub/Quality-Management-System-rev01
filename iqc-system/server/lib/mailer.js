// ===== Email sender (SMTP via nodemailer) — S128 =====
// Mirror ของ sendTelegram (routes/notifications.js): log แล้วไปต่อถ้าส่งไม่ได้/ยังไม่ได้ตั้งค่า ห้าม crash (CLAUDE.md §12)
const db = require('../db/database');

let cachedTransporter = null;
let cachedKey = null;

function getTransporter() {
  const host = db.getSetting('smtp_host');
  const user = db.getSetting('smtp_user');
  const pass = db.getSecretSetting('smtp_password');
  if (!host || !user || !pass) return null;

  const port = Number(db.getSetting('smtp_port') || 587);
  const secure = db.getSetting('smtp_secure') === '1';
  const key = `${host}:${port}:${user}:${secure}`;
  if (cachedTransporter && cachedKey === key) return cachedTransporter;

  const nodemailer = require('nodemailer');
  cachedTransporter = nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
  cachedKey = key;
  return cachedTransporter;
}

// คืน { ok, error? } เสมอ (ไม่ throw — fire-and-forget call site เช่น COO notify ยังปลอดภัยแม้ไม่ await/catch)
// แต่ต่างจากเดิมตรงที่ "ไม่กลืนผลลัพธ์ทิ้ง" — ให้ผู้เรียกที่สนใจผล (เช่น ปุ่มทดสอบส่งอีเมล) เช็ค .ok ได้จริง
async function sendEmail(to, subject, html) {
  if (!to) return { ok: false, error: 'ไม่มีอีเมลปลายทาง' };
  const transporter = getTransporter();
  if (!transporter) {
    const msg = 'SMTP ยังไม่ได้ตั้งค่า (smtp_host/smtp_user/smtp_password)';
    console.error(`[mailer] ${msg} — ข้ามการส่งอีเมล`);
    return { ok: false, error: msg };
  }
  try {
    const from = db.getSetting('smtp_from') || db.getSetting('smtp_user');
    await transporter.sendMail({ from, to, subject, html });
    return { ok: true };
  } catch (e) {
    console.error('[mailer] ส่งอีเมลไม่สำเร็จ:', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { sendEmail, getTransporter };
