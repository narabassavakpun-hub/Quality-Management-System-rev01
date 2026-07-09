// ===== AD Gateway Response Parser — CLAUDE.md §24 =====
// ADAuthen.md ไม่มีตัวอย่าง response body เลย (ทั้ง success และ fail ทุกแบบ) — ตามที่ตกลงกับผู้ใช้ไว้
// (ดู plan/AUTH_ARCHITECTURE.md "หมายเหตุที่ยังต้องรอ IT ยืนยัน") ไฟล์นี้เป็นจุดเดียวที่ต้องแก้เมื่อ IT
// ยืนยัน schema จริงจาก AD Gateway — ห้ามกระจาย logic parse response ไปที่อื่น
//
// สมมติฐานปัจจุบัน:
//   - HTTP 2xx + body.status/success บ่งชี้ success → ok:true
//   - message มีคำว่า "expired" (case-insensitive) → reason:'expired' (ตรงกับคำใบ้เดียวที่มีจริงใน
//     ADAuthen.md §3: "ระบบจะปฏิเสธคำขอและตอบกลับเป็น Expired ทันที")
//   - อื่นๆ ที่ได้ response กลับมาแต่ไม่ใช่ success → reason:'rejected' (รหัสผ่าน/secret_key ผิด ฯลฯ)
//   - reason:'rejected'/'expired' ต้องไม่ถูก retry (ดู adGatewayClient.js) — retry เฉพาะ reason:'unreachable'
function parseAdGatewayResponse(httpStatus, body) {
  const message = String(body?.message || body?.error || body?.msg || '').trim();
  const statusField = String(body?.status || '').toLowerCase();

  const looksSuccess = httpStatus >= 200 && httpStatus < 300 &&
    (statusField === 'success' || statusField === 'ok' || body?.success === true);

  if (looksSuccess) {
    return { ok: true, reason: null, rawMessage: message };
  }

  if (/expired/i.test(message)) {
    return { ok: false, reason: 'expired', rawMessage: message || 'Expired' };
  }

  return { ok: false, reason: 'rejected', rawMessage: message || `AD Gateway ปฏิเสธคำขอ (HTTP ${httpStatus})` };
}

module.exports = { parseAdGatewayResponse };
