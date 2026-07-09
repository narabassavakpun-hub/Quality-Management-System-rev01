// ===== Active Directory Gateway Client — CLAUDE.md §24 =====
// ยิง POST ไปที่ AD Gateway ภายนอกตามสัญญาที่ ADAuthen.md กำหนด (§1-§3)
// - URL/app_id/secret_key/timeout/retry ต้องมาจาก settings (caller ส่งเข้ามา) — ไฟล์นี้ไม่อ่าน settings เอง
// - timestamp: เวลาไทย (+07:00) แต่ format ปิดท้ายด้วย Z ไม่มีมิลลิวินาที ห้ามใช้ .toISOString() จริง
//   (ห้ามพึ่ง process.env.TZ เพราะ dev/test ไม่ได้ตั้งเป็น Asia/Bangkok เสมอไป — .env.production เท่านั้นที่ตั้ง TZ)
// - retry เฉพาะ network-level error (timeout/ECONNREFUSED/DNS/AbortError) เท่านั้น — ห้าม retry เมื่อได้ response
//   กลับมาแล้วไม่ว่าจะ reason อะไร (แม้ parse ไม่ออก) เพราะจะไปเร่ง account lockout policy ของ AD จริงฝั่ง Windows
const fetch = require('node-fetch');
const { parseAdGatewayResponse } = require('./adResponseParser');

function formatAdTimestamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(date).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  // บาง JS engine คืน hour='24' แทน '00' ตอนเที่ยงคืนพอดีเมื่อ hour12:false — normalize กันพัง
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}:${parts.second}Z`;
}

async function postLogin(gatewayUrl, { appId, secretKey, username, password }, opts = {}) {
  const timeoutMs = Number(opts.timeoutMs) || 5000;
  const attempts = Math.max(1, 1 + (Number(opts.retryCount) || 0));
  const body = JSON.stringify({
    app_id: appId,
    secret_key: secretKey,
    username,
    password,
    timestamp: formatAdTimestamp(),
  });

  let lastNetworkError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();
    try {
      const res = await fetch(gatewayUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });
      clearTimeout(timer);
      const responseTimeMs = Date.now() - startedAt;
      let json = null;
      try { json = await res.json(); } catch { json = null; }
      // ได้ response กลับมาแล้ว (ไม่ว่า reject/success) → หยุด ไม่ retry ต่อ
      return { ...parseAdGatewayResponse(res.status, json), httpStatus: res.status, responseTimeMs };
    } catch (e) {
      clearTimeout(timer);
      lastNetworkError = e;
      if (attempt < attempts) continue; // network-level error เท่านั้นถึง retry
    }
  }
  return {
    ok: false,
    reason: 'unreachable',
    rawMessage: lastNetworkError?.message || 'ไม่สามารถเชื่อมต่อ AD Gateway ได้',
    httpStatus: null,
    responseTimeMs: null,
  };
}

module.exports = { formatAdTimestamp, postLogin };
