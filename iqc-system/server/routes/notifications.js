const express = require('express');
const router = express.Router();
const db = require('../db/database');
const auth = require('../middleware/auth');

function createNotification(userId, title, message, link) {
  try {
    db.prepare('INSERT INTO notifications (user_id, title, message, link) VALUES (?, ?, ?, ?)').run(userId, title, message, link);
    // Push SSE ให้ browser ของ user นั้น invalidate query ทันที (ไม่ต้องรอ polling)
    if (db.pushSSE) db.pushSSE([userId], 'notification', { link });
    // Broadcast ให้ทุก user ที่ online เพื่ออัปเดต list/detail ที่เกี่ยวข้องทันที
    if (db.broadcastSSE) db.broadcastSSE('status_change', { link });
    // ส่งแจ้งเตือนเดียวกันเข้า Telegram ส่วนตัวของ user คนนั้น (ถ้า admin ตั้ง chat id ไว้)
    notifyUserTelegram(userId, title, message, link);
  } catch (e) {
    console.error('Notification error:', e.message);
  }
}

// ส่งแจ้งเตือนกระดิ่งเข้า Telegram ส่วนตัวของผู้ใช้ — fire-and-forget, ห้าม block/crash
function notifyUserTelegram(userId, title, message, link) {
  try {
    const row = db.prepare('SELECT telegram_chat_id FROM users WHERE id = ?').get(userId);
    const chatId = row && row.telegram_chat_id ? String(row.telegram_chat_id).trim() : '';
    if (!chatId) return;
    let text = `[IQC] ${title}`;
    if (message) text += `\n${message}`;
    const appUrl = db.getSetting('app_url');
    if (appUrl && link) text += `\n${appUrl.replace(/\/+$/, '')}${link}`;
    // ไม่ await — Telegram ส่งไม่ได้ต้อง log แล้วไปต่อ (CLAUDE.md §12)
    sendTelegram(chatId, text);
  } catch (e) {
    console.error('User Telegram notify error:', e.message);
  }
}

async function sendTelegram(chatId, text) {
  const token = db.getSetting('telegram_bot_token');
  if (!token || !chatId) return;
  try {
    const fetch = require('node-fetch');
    // DEVMORE M6 — ส่งเป็น plain text (ไม่ใช้ parse_mode:HTML) กัน HTML injection/parse error
    // จากค่าที่ผู้ใช้/Supplier กรอก เช่น ชื่อสินค้า, comment, root_cause
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (e) {
    console.error('Telegram error:', e.message);
  }
}

router.get('/', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM notifications
    WHERE user_id = ?
    ORDER BY is_read ASC, created_at DESC
    LIMIT 100
  `).all(req.user.id);
  res.json(rows);
});

router.patch('/read-all', auth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

router.patch('/:id/read', auth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

module.exports = router;
module.exports.createNotification = createNotification;
module.exports.sendTelegram = sendTelegram;
module.exports.notifyUserTelegram = notifyUserTelegram;
