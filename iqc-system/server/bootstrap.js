// ===== Container entrypoint — restore-on-boot (Render free tier) แล้วค่อยเริ่ม index.js =====
// เฉพาะ deployment ที่ตั้ง RESTORE_ON_BOOT=true (เช่น Render free tier ที่ไม่มี persistent disk) เท่านั้น
// VPS/docker-compose ที่มี persistent volume ไม่ต้องตั้งค่านี้ — ข้ามไป require('./index.js') ตรงๆ เหมือนเดิม
//
// CommonJS ไม่มี top-level await — ต้องห่อด้วย async IIFE
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

// แจ้งเตือนก่อน DB จะเปิดสำเร็จ (restore ล้มเหลว) ต้องใช้ env var ตรงๆ — ห้ามพึ่ง lib/notify.js
// (อ่าน telegram_bot_token จาก db.getSetting ซึ่งต้องมี DB connection ที่ยังไม่แน่ใจว่าพร้อมใช้งาน ณ จุดนี้)
async function alertBootFailure(message) {
  const token = process.env.TELEGRAM_BOOT_ALERT_TOKEN;
  const chatId = process.env.TELEGRAM_BOOT_ALERT_CHAT_ID;
  if (!token || !chatId) return;
  try {
    const fetch = require('node-fetch');
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message }),
    });
  } catch (e) {
    console.error('[bootstrap] แจ้งเตือน Telegram ล้มเหลว:', e.message);
  }
}

(async () => {
  if (process.env.RESTORE_ON_BOOT === 'true') {
    try {
      const { restoreLatest } = require('./lib/restoreService');
      const result = await restoreLatest();
      if (result.restored) {
        console.log(`[bootstrap] กู้ DB จาก R2 สำเร็จ: ${result.key} (อัปโหลดเมื่อ ${result.uploadedAt})`);
      } else if (result.reason === 'all_candidates_failed') {
        console.error('[bootstrap] กู้ DB จาก R2 ล้มเหลวทุก candidate — boot ด้วย DB ว่าง:', result.error);
        await alertBootFailure(`⚠️ [IQC Boot] กู้ DB จาก R2 ล้มเหลวทุก candidate — boot ด้วย DB ว่าง: ${result.error}`);
      } else {
        console.log(`[bootstrap] ไม่ได้กู้ DB จาก R2: ${result.reason}`);
      }
    } catch (e) {
      console.error('[bootstrap] restore-on-boot error — boot ด้วย DB ว่างต่อไป:', e);
      await alertBootFailure(`⚠️ [IQC Boot] restore-on-boot error: ${e.message}`);
    }
  }
  require('./index.js');
})();
