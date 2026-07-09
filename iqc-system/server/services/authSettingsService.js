// ===== General/Authentication/Security/Advanced Settings Service — CLAUDE.md §24 =====
// เก็บใน settings table เดิม (key-value) — pattern เดียวกับ Telegram/PDF-template ที่มีอยู่แล้ว
const db = require('../db/database');
const adGatewayClient = require('../lib/adGatewayClient');

function httpError(message, status) { const e = new Error(message); e.status = status; return e; }

const GENERAL_KEYS = ['system_name', 'ui_language', 'timezone', 'session_timeout_minutes', 'remember_login_enabled'];
const SECURITY_KEYS = [
  'jwt_expiration_hours', 'refresh_token_enabled', 'login_attempt_max',
  'lock_account_minutes', 'password_min_length', 'password_require_complexity',
];
const ADVANCED_KEYS = ['api_version', 'debug_mode', 'health_check_enabled', 'custom_header_name', 'custom_header_value'];

function getGeneralSettings() {
  const result = {};
  for (const k of GENERAL_KEYS) result[k] = db.getSetting(k) || '';
  return result;
}
function saveGeneralSettings(body, actorId, ip) {
  for (const k of GENERAL_KEYS) if (body[k] !== undefined) db.setSetting(k, String(body[k]));
  db.auditLog('settings', 0, 'UPDATE', null, body, actorId, ip);
}

function getSecuritySettings() {
  const result = {};
  for (const k of SECURITY_KEYS) result[k] = db.getSetting(k) || '';
  return result;
}
function saveSecuritySettings(body, actorId, ip) {
  for (const k of SECURITY_KEYS) if (body[k] !== undefined) db.setSetting(k, String(body[k]));
  db.auditLog('settings', 0, 'UPDATE', null, body, actorId, ip);
}

function getAdvancedSettings() {
  const result = {};
  for (const k of ADVANCED_KEYS) result[k] = db.getSetting(k) || '';
  return result;
}
function saveAdvancedSettings(body, actorId, ip) {
  for (const k of ADVANCED_KEYS) if (body[k] !== undefined) db.setSetting(k, String(body[k]));
  db.auditLog('settings', 0, 'UPDATE', null, body, actorId, ip);
}

// ---- Authentication (Local/AD) ----
// DEVMORE AUTH-1 — secret เป็น write-only เสมอ (ไม่คืนค่าจริงออก API) เหมือน telegram_bot_token เดิม
function getAuthSettings() {
  return {
    auth_mode: db.getSetting('auth_mode') || 'local',
    ad_enabled: db.getSetting('ad_enabled') === '1',
    ad_gateway_url: db.getSetting('ad_gateway_url') || '',
    ad_app_id: db.getSetting('ad_app_id') || '',
    ad_secret_key: '',
    ad_secret_key_set: !!db.getSetting('ad_secret_key'),
    ad_domain: db.getSetting('ad_domain') || '',
    ad_use_ssl: db.getSetting('ad_use_ssl') !== '0',
    ad_timeout_ms: db.getSetting('ad_timeout_ms') || '5000',
    ad_retry_count: db.getSetting('ad_retry_count') || '1',
  };
}

// กฎเหล็ก (CLAUDE.md §24): mode ที่ใช้งานจริงมีแค่ 'local'/'hybrid' — 'ad' (strict, deny local user ตาม
// ADAuthen.md §4.1) ไม่รองรับในรุ่นนี้เพราะขัดกับกฎที่ AD ต้องเป็นระบบเสริมเท่านั้น
function saveAuthSettings(body, actorId, ip) {
  const { auth_mode, ad_enabled, ad_gateway_url, ad_app_id, ad_secret_key, ad_domain, ad_use_ssl, ad_timeout_ms, ad_retry_count } = body;

  if (auth_mode !== undefined) {
    if (!['local', 'hybrid'].includes(auth_mode)) {
      throw httpError('auth_mode ไม่ถูกต้อง — รองรับเฉพาะ local/hybrid ในรุ่นนี้ (AD ต้องเป็นระบบเสริมเสมอ)', 400);
    }
  }
  const useSsl = ad_use_ssl !== undefined ? !!ad_use_ssl : db.getSetting('ad_use_ssl') !== '0';
  if (ad_gateway_url) {
    if (!/^https?:\/\//i.test(ad_gateway_url)) {
      throw httpError('AD Gateway URL ต้องขึ้นต้นด้วย http:// หรือ https://', 400);
    }
    if (useSsl && !/^https:\/\//i.test(ad_gateway_url)) {
      throw httpError('เปิด Use SSL ไว้ — AD Gateway URL ต้องขึ้นต้นด้วย https://', 400);
    }
  }

  if (auth_mode !== undefined) db.setSetting('auth_mode', auth_mode);
  if (ad_enabled !== undefined) db.setSetting('ad_enabled', ad_enabled ? '1' : '0');
  if (ad_gateway_url !== undefined) db.setSetting('ad_gateway_url', ad_gateway_url);
  if (ad_app_id !== undefined) db.setSetting('ad_app_id', ad_app_id);
  if (ad_secret_key) db.setSecretSetting('ad_secret_key', ad_secret_key); // เว้นว่าง = ใช้ค่าเดิม (write-only)
  if (ad_domain !== undefined) db.setSetting('ad_domain', ad_domain);
  if (ad_use_ssl !== undefined) db.setSetting('ad_use_ssl', ad_use_ssl ? '1' : '0');
  if (ad_timeout_ms !== undefined) db.setSetting('ad_timeout_ms', String(ad_timeout_ms));
  if (ad_retry_count !== undefined) db.setSetting('ad_retry_count', String(ad_retry_count));

  db.auditLog('settings', 0, 'UPDATE', null,
    { auth_mode, ad_enabled, ad_gateway_url, ad_app_id, ad_domain, ad_use_ssl, ad_timeout_ms, ad_retry_count },
    actorId, ip);
}

// AD Gateway มี endpoint เดียว (/login) ไม่มี health-check เฉพาะ — ยิง probe ด้วย username ปลอมเพื่อเช็คว่า
// "เชื่อมต่อถึง/ตอบกลับมา" หรือไม่ (ไม่สนใจผลอนุมัติ) retryCount=0 เสมอ (ไม่ retry ตอน test เพื่อไม่รอนาน)
async function testAdConnection() {
  const gatewayUrl = db.getSetting('ad_gateway_url');
  if (!gatewayUrl) throw httpError('ยังไม่ได้ตั้งค่า AD Gateway URL', 400);
  const appId = db.getSetting('ad_app_id');
  const secretKey = db.getSecretSetting('ad_secret_key');
  const timeoutMs = Number(db.getSetting('ad_timeout_ms')) || 5000;

  const result = await adGatewayClient.postLogin(
    gatewayUrl,
    { appId, secretKey, username: '__connection_test__', password: '__connection_test__' },
    { timeoutMs, retryCount: 0 }
  );

  if (result.reason === 'unreachable') {
    throw httpError(result.rawMessage || 'เชื่อมต่อ AD Gateway ไม่สำเร็จ', 502);
  }
  return {
    connected: true,
    httpStatus: result.httpStatus,
    responseTimeMs: result.responseTimeMs,
    message: result.rawMessage || 'AD Gateway ตอบกลับสำเร็จ (เชื่อมต่อได้)',
  };
}

module.exports = {
  getGeneralSettings, saveGeneralSettings,
  getSecuritySettings, saveSecuritySettings,
  getAdvancedSettings, saveAdvancedSettings,
  getAuthSettings, saveAuthSettings,
  testAdConnection,
};
