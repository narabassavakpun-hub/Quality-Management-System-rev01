// ===== Active Directory Auth Provider — CLAUDE.md §24 =====
// Flow ตาม ADAuthen.md §4: bcrypt compare กับ cache ก่อนเสมอ (ไม่ยิง network ถ้าตรง) → ถ้าไม่ตรง
// ยิง AD Gateway จริง → สำเร็จแล้วคืน hash รหัสใหม่ให้ authService เขียนทับ cache เดิม
// ("self-healing mirrored sync") — ไฟล์นี้ไม่เขียน DB เอง (authService เป็นเจ้าของ transaction เดียว)
const bcrypt = require('bcryptjs');
const db = require('../../db/database');
const adGatewayClient = require('../../lib/adGatewayClient');

// lockoutExempt: true → ไม่นับเป็นความพยายาม login ผิดของ user (ปัญหาโครงสร้าง/เวลาเครื่อง ไม่ใช่ความผิดของ user)
// ใช้กับ AD Gateway unreachable/ยังไม่ตั้งค่า/timestamp หมดอายุ — นับเฉพาะกรณีรหัสผ่านผิดจริงเท่านั้น (authService.js)
function httpError(message, status, opts = {}) {
  const e = new Error(message);
  e.status = status;
  if (opts.lockoutExempt) e.lockoutExempt = true;
  return e;
}

// skipCache: true → ข้าม Local Pass Bypass ไปเช็คกับ AD Gateway ตรงๆ เสมอ (ใช้กับปุ่ม "Internal AP System"
// ที่ผู้ใช้ต้องการบังคับยืนยันตัวตนกับ AD จริงๆ ไม่ใช่ passthrough จาก cache — authService.js เป็นผู้ตั้ง flag นี้)
async function authenticate({ user, password, skipCache = false }) {
  // 1) Local Pass Bypass (ADAuthen.md §4.2) — ตรงกับ cache แล้วผ่านทันที ไม่ยิง network ไปหา AD เลย
  if (!skipCache && user.password_hash && bcrypt.compareSync(password, user.password_hash)) {
    return { synced: false };
  }

  // 2) ไม่ตรง cache (login ครั้งแรก หรือรหัส AD เพิ่งเปลี่ยน) → ยิง AD Gateway จริง
  const gatewayUrl = db.getSetting('ad_gateway_url');
  if (!gatewayUrl) throw httpError('ยังไม่ได้ตั้งค่า AD Gateway — ติดต่อผู้ดูแลระบบ', 503, { lockoutExempt: true });

  const appId = db.getSetting('ad_app_id');
  const secretKey = db.getSecretSetting('ad_secret_key');
  const timeoutMs = Number(db.getSetting('ad_timeout_ms')) || 5000;
  const retryCount = Number(db.getSetting('ad_retry_count')) || 0;

  const result = await adGatewayClient.postLogin(
    gatewayUrl,
    { appId, secretKey, username: user.username, password },
    { timeoutMs, retryCount }
  );

  if (!result.ok) {
    if (result.reason === 'unreachable') {
      throw httpError('ไม่สามารถเชื่อมต่อ Active Directory ได้ กรุณาลองใหม่หรือติดต่อผู้ดูแลระบบ', 503, { lockoutExempt: true });
    }
    if (result.reason === 'expired') {
      throw httpError('คำขอเข้าสู่ระบบหมดอายุ (เวลาเครื่องไม่ตรงกัน) กรุณาลองใหม่', 401, { lockoutExempt: true });
    }
    // reason === 'rejected' — รหัสผ่าน/username ผิดจริงตาม AD → นับเป็นความพยายาม login ผิด (lockout ปกติ)
    throw httpError('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง หรือบัญชีถูกระงับ', 401);
  }

  // 3) AD ตอบสำเร็จ → hash รหัสใหม่ไว้ให้ authService เขียนทับ cache เดิมในทรานแซกชันเดียวกับการ login
  const newPasswordHash = bcrypt.hashSync(password, parseInt(process.env.BCRYPT_ROUNDS) || 12);
  return { synced: true, newPasswordHash };
}

module.exports = { name: 'ad', authenticate };
