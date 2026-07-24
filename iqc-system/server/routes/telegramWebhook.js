// ===== S168 — Telegram webhook: รับปุ่ม inline "อนุมัติผ่าน Telegram" กลับมาจาก Telegram =====
// จุดเดียวในระบบที่ "รับ" ข้อมูลจาก Telegram (ของเดิมทั้งหมดเป็นแค่ sendTelegram ทางเดียว) — ไม่มี session/JWT
// เพราะ Telegram เรียกเข้ามาเอง ยืนยันตัวด้วย secret_token header ที่ Telegram ส่งมาเทียบกับค่าที่ตั้งไว้ตอน
// setWebhook (ดู services/telegramWebhookService.js's registerWebhook) — เทียบแบบ timing-safe กัน timing attack
// S170 — เพิ่มปุ่ม "❌ ไม่อนุมัติ" (เฉพาะขั้น COO/CMO/CPO — ดู uaiService.js's notifySignerTelegramButton) เพราะ
// เหตุผลปฏิเสธเป็น field บังคับ กดปุ่มเดียวส่งไม่ได้ ต้องรอข้อความถัดไปจากผู้ใช้ — เก็บ state ชั่วคราวไว้ใน
// telegram_pending_rejects (1 แถว/1 chat_id) ระหว่างรอ
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const router = express.Router();
const db = require('../db/database');
const uaiService = require('../services/uaiService');
const { generateStampImage } = require('../lib/stampImage');

const SIG_DIR = path.join(__dirname, '../../uploads/uai');
function saveStampBuffer(buf) {
  fs.mkdirSync(SIG_DIR, { recursive: true });
  const name = `sig-${crypto.randomUUID()}.png`;
  fs.writeFileSync(path.join(SIG_DIR, name), buf);
  return name;
}

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(String(a || ''));
  const bufB = Buffer.from(String(b || ''));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

async function callTelegramApi(method, payload) {
  const token = db.getSetting('telegram_bot_token');
  if (!token) return;
  try {
    const fetch = require('node-fetch');
    await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error(`[telegramWebhook] ${method} error:`, e.message);
  }
}
const answerCallbackQuery = (id, text, showAlert = false) =>
  callTelegramApi('answerCallbackQuery', { callback_query_id: id, text, show_alert: showAlert });
const editMessageText = (chatId, messageId, text) =>
  callTelegramApi('editMessageText', { chat_id: chatId, message_id: messageId, text });
const sendMessage = (chatId, text) =>
  callTelegramApi('sendMessage', { chat_id: chatId, text });

function resolveTelegramUser(chatId) {
  return db.prepare('SELECT * FROM users WHERE telegram_chat_id = ? AND is_active = 1').get(chatId);
}

// ===== อนุมัติ (ปุ่ม "✅ อนุมัติ") =====
async function processSign(cq, uaiId) {
  const chatId = String(cq.message?.chat?.id ?? cq.from?.id ?? '');
  const user = resolveTelegramUser(chatId);
  if (!user) { await answerCallbackQuery(cq.id, 'ไม่พบบัญชีผู้ใช้ที่ผูกกับ Telegram นี้ในระบบ', true); return; }

  const uai = db.prepare('SELECT * FROM uai_documents WHERE id = ?').get(uaiId);
  if (!uai) { await answerCallbackQuery(cq.id, 'ไม่พบเอกสาร UAI นี้', true); return; }

  const expectedRole = uaiService.SIGN_ROLE_MAP[uai.status];
  const isPurchasingManagerOverride = expectedRole === 'purchasing' && user.role === 'purchasing_manager';
  if (!expectedRole || (user.role !== expectedRole && !isPurchasingManagerOverride)) {
    await answerCallbackQuery(cq.id, 'ไม่ใช่คิวของคุณแล้ว (อาจมีคนอื่นดำเนินการไปก่อนหน้านี้)', true);
    return;
  }

  let sigFile;
  try {
    const buf = await generateStampImage(user.full_name, new Date());
    sigFile = saveStampBuffer(buf);
  } catch (e) {
    await answerCallbackQuery(cq.id, 'สร้างตราประทับไม่สำเร็จ กรุณาลองใหม่หรือเข้าเว็บแทน', true);
    return;
  }

  const signAction = ['uai_pending_cco', 'uai_pending_cmo', 'uai_pending_cpo', 'uai_pending_purchasing'].includes(uai.status)
    ? 'approved' : 'acknowledged';

  try {
    uaiService.signUai({
      uai, actorId: user.id, actorRole: user.role, actorIp: 'telegram-webhook',
      sigFile, action: signAction, comment: null, signatureMethod: 'telegram',
    });
    await answerCallbackQuery(cq.id, '✅ อนุมัติสำเร็จ');
    if (cq.message?.chat?.id && cq.message?.message_id) {
      await editMessageText(cq.message.chat.id, cq.message.message_id, `${cq.message.text}\n\n✅ อนุมัติแล้วผ่าน Telegram โดย ${user.full_name}`);
    }
  } catch (e) {
    try { fs.unlinkSync(path.join(SIG_DIR, sigFile)); } catch {}
    await answerCallbackQuery(cq.id, e.message || 'เกิดข้อผิดพลาด กรุณาลองใหม่', true);
  }
}

// ===== เริ่มขั้นตอนไม่อนุมัติ (ปุ่ม "❌ ไม่อนุมัติ") — แค่เปิด flow รอเหตุผล ยังไม่ reject จริง =====
// เฉพาะ cco/cmo/cpo เท่านั้น (มีแค่ 3 role นี้ที่ปฏิเสธ UAI เองได้ — ดู reject-exec ใน routes/uai.js)
async function processRejectStart(cq, uaiId) {
  const chatId = String(cq.message?.chat?.id ?? cq.from?.id ?? '');
  const user = resolveTelegramUser(chatId);
  if (!user) { await answerCallbackQuery(cq.id, 'ไม่พบบัญชีผู้ใช้ที่ผูกกับ Telegram นี้ในระบบ', true); return; }

  const uai = db.prepare('SELECT * FROM uai_documents WHERE id = ?').get(uaiId);
  if (!uai) { await answerCallbackQuery(cq.id, 'ไม่พบเอกสาร UAI นี้', true); return; }

  const expectedRole = uaiService.SIGN_ROLE_MAP[uai.status];
  if (!['cco', 'cmo', 'cpo'].includes(user.role) || user.role !== expectedRole) {
    await answerCallbackQuery(cq.id, 'ไม่ใช่คิวของคุณแล้ว (อาจมีคนอื่นดำเนินการไปก่อนหน้านี้)', true);
    return;
  }

  db.prepare('INSERT OR REPLACE INTO telegram_pending_rejects (chat_id, uai_id) VALUES (?, ?)').run(chatId, uaiId);
  await answerCallbackQuery(cq.id, 'กรุณาพิมพ์เหตุผลที่ไม่อนุมัติ แล้วส่งข้อความกลับมา');
  await sendMessage(chatId, `${uai.uai_code} — กรุณาพิมพ์เหตุผลที่ไม่อนุมัติ แล้วส่งข้อความกลับมาในแชทนี้ (พิมพ์ "ยกเลิก" เพื่อยกเลิก)`);
}

// ประมวลผล callback_query แบบ async — แยกจาก handler หลักเพื่อให้ตอบ Telegram 200 ได้เร็ว (Telegram retry ถ้าไม่ตอบ
// ภายในไม่กี่วินาที) โดยไม่ต้องรอ sign transaction/Telegram API call อื่นๆ ให้เสร็จก่อน
async function processCallbackQuery(cq) {
  try {
    if (!cq?.data) return;
    const [action, idStr] = String(cq.data).split(':');
    const uaiId = parseInt(idStr, 10);
    if (!uaiId) return;
    if (action === 'uai_sign') await processSign(cq, uaiId);
    else if (action === 'uai_reject') await processRejectStart(cq, uaiId);
  } catch (e) {
    console.error('[telegramWebhook] processCallbackQuery error:', e.message);
  }
}

// ===== S170 — ข้อความธรรมดา (ไม่ใช่ callback_query) — ใช้เป็นเหตุผลของ flow "ไม่อนุมัติ" ที่ค้างอยู่เท่านั้น =====
// เพิกเฉยเงียบๆ ถ้าไม่มี flow ค้างสำหรับ chat นี้ (กันบอทไปตอบข้อความทั่วไปที่ไม่เกี่ยวข้อง)
async function processTextMessage(msg) {
  try {
    if (!msg?.text || !msg?.chat?.id) return;
    const chatId = String(msg.chat.id);
    const pending = db.prepare('SELECT * FROM telegram_pending_rejects WHERE chat_id = ?').get(chatId);
    if (!pending) return;

    const text = msg.text.trim();
    if (!text) return;
    if (text === 'ยกเลิก' || text.toLowerCase() === '/cancel') {
      db.prepare('DELETE FROM telegram_pending_rejects WHERE chat_id = ?').run(chatId);
      await sendMessage(chatId, 'ยกเลิกการไม่อนุมัติแล้ว');
      return;
    }

    // consume ทันที ไม่ว่าผลจะสำเร็จหรือพัง — กันข้อความถัดไปของ user โดนตีความเป็นเหตุผลซ้ำผิดๆ
    db.prepare('DELETE FROM telegram_pending_rejects WHERE chat_id = ?').run(chatId);

    const user = resolveTelegramUser(chatId);
    const uai = db.prepare('SELECT * FROM uai_documents WHERE id = ?').get(pending.uai_id);
    if (!user || !uai) { await sendMessage(chatId, 'เกิดข้อผิดพลาด กรุณาเข้าเว็บแทน'); return; }

    const expectedRole = uaiService.SIGN_ROLE_MAP[uai.status];
    if (!['cco', 'cmo', 'cpo'].includes(user.role) || user.role !== expectedRole) {
      await sendMessage(chatId, 'ไม่ใช่คิวของคุณแล้ว (อาจมีคนอื่นดำเนินการไปก่อนหน้านี้)');
      return;
    }

    try {
      uaiService.rejectExec({ uai, reason: text, actorId: user.id, actorRole: user.role, actorIp: 'telegram-webhook' });
      await sendMessage(chatId, `❌ ไม่อนุมัติ ${uai.uai_code} สำเร็จ\nเหตุผล: ${text}`);
    } catch (e) {
      await sendMessage(chatId, e.message || 'เกิดข้อผิดพลาด กรุณาลองใหม่หรือเข้าเว็บแทน');
    }
  } catch (e) {
    console.error('[telegramWebhook] processTextMessage error:', e.message);
  }
}

// รอให้ processCallbackQuery/processTextMessage ทำงานจบก่อนค่อยตอบ 200 (งานเบา — DB local + เรียก Telegram API
// 1-2 ครั้ง ไม่เกินเวลาที่ Telegram ยอมรอ) ง่ายต่อการทดสอบกว่า fire-and-forget และเห็น error ได้ตรงจุดกว่าถ้ามีปัญหาจริง
router.post('/webhook', async (req, res) => {
  const expectedSecret = db.getSecretSetting('telegram_webhook_secret');
  const gotSecret = req.headers['x-telegram-bot-api-secret-token'];
  if (!expectedSecret || !timingSafeEqualStr(gotSecret, expectedSecret)) {
    return res.status(401).end();
  }
  if (req.body?.callback_query) await processCallbackQuery(req.body.callback_query);
  else if (req.body?.message) await processTextMessage(req.body.message);
  res.status(200).end();
});

module.exports = router;
