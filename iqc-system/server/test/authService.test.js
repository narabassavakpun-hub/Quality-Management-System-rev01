// Integration/unit tests — Authentication Provider Framework (node --test)
// ครอบ: local login regression, AD provider (cache/gateway/self-heal), resolveProvider hard rule,
// account lockout (durable), retry-safety (ไม่ retry ตอนถูก reject), secretsCrypto, environment preset apply
// CLAUDE.md §24
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.IQC_DB_PATH = path.join(os.tmpdir(), `iqc-auth-${process.pid}-${Date.now()}.db`);
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-auth';
process.env.SETTINGS_ENCRYPTION_KEY = 'a'.repeat(64);

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/database');
const adGatewayClient = require('../lib/adGatewayClient');
const { encryptSecret, decryptSecret } = require('../lib/secretsCrypto');
const { resolveProvider } = require('../services/auth/resolveProvider');
const localProvider = require('../services/auth/localProvider');
const adProvider = require('../services/auth/adProvider');
const environmentService = require('../services/environmentService');

const origPostLogin = adGatewayClient.postLogin;

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/auth', require('../routes/auth'));
app.use('/api/admin/system-settings', require('../routes/systemSettings'));

let server, base;
test.before(async () => {
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  adGatewayClient.postLogin = origPostLogin;
  try { server.close(); } catch {}
  try { db.close(); } catch {}
  for (const f of [process.env.IQC_DB_PATH, process.env.IQC_DB_PATH + '-wal', process.env.IQC_DB_PATH + '-shm']) {
    try { fs.unlinkSync(f); } catch {}
  }
});

async function api(method, p, { cookie, body } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json; try { json = await res.json(); } catch { json = null; }
  const setCookie = res.headers.get('set-cookie');
  return { status: res.status, body: json, cookie: setCookie ? setCookie.split(';')[0] : null };
}

const adminSessionToken = 'admin-sess-1';
db.prepare("UPDATE users SET session_token=? WHERE username='admin'").run(adminSessionToken);
const adminCookie = 'token=' + jwt.sign(
  { id: db.prepare("SELECT id FROM users WHERE username='admin'").get().id, sessionToken: adminSessionToken },
  process.env.JWT_SECRET
);

// ── ผู้ใช้ทดสอบ AD ──
const adUserHash = bcrypt.hashSync('cachedpass123', 12);
db.prepare("INSERT INTO users (username, password_hash, full_name, role, auth_provider) VALUES (?,?,?,?,?)")
  .run('ad_user1', adUserHash, 'AD Test User', 'qc_staff', 'ad');

test('AUTH-01 local login regression: admin/admin1234 → 200 + cookie + role', async () => {
  const r = await api('POST', '/api/auth/login', { body: { username: 'admin', password: 'admin1234' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.role, 'admin');
  assert.ok(r.cookie?.startsWith('token='));
});

test('AUTH-02 local login: wrong password → 401', async () => {
  const r = await api('POST', '/api/auth/login', { body: { username: 'admin', password: 'wrongpass' } });
  assert.equal(r.status, 401);
});

test('AUTH-03 กฎเหล็ก: local user login ได้ปกติแม้เปิด Hybrid + AD enabled ทั้งระบบ', async () => {
  // เปิด AD ทั้งระบบก่อน — เพื่อพิสูจน์ว่า local user (admin) ไม่ถูกกระทบเลย
  db.setSetting('auth_mode', 'hybrid');
  db.setSetting('ad_enabled', '1');
  db.setSetting('ad_gateway_url', 'https://fake-ad-gateway.invalid/api/v2/login');
  db.setSetting('ad_app_id', 'QMS');
  db.setSecretSetting('ad_secret_key', 'test-secret-key-value');

  const r = await api('POST', '/api/auth/login', { body: { username: 'admin', password: 'admin1234' } });
  assert.equal(r.status, 200, 'local user ต้อง login ผ่านได้เสมอไม่ว่า AD จะเปิดหรือปิด');
  assert.equal(r.body.role, 'admin');
});

test('AUTH-04 ad user: cache hit (Local Pass Bypass) → login ผ่านโดยไม่ยิง AD Gateway', async () => {
  adGatewayClient.postLogin = async () => { throw new Error('ไม่ควรถูกเรียก — รหัสตรงกับ cache อยู่แล้ว'); };
  try {
    const r = await api('POST', '/api/auth/login', { body: { username: 'ad_user1', password: 'cachedpass123' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.username, 'ad_user1');
  } finally {
    adGatewayClient.postLogin = origPostLogin;
  }
});

test('AUTH-05 ad user: ad_enabled=0 → fallback ใช้ local cache แม้ auth_provider=ad', async () => {
  db.setSetting('ad_enabled', '0');
  adGatewayClient.postLogin = async () => { throw new Error('ไม่ควรถูกเรียก — AD ปิดอยู่ ต้อง fallback ไป local'); };
  try {
    const r = await api('POST', '/api/auth/login', { body: { username: 'ad_user1', password: 'cachedpass123' } });
    assert.equal(r.status, 200);
  } finally {
    adGatewayClient.postLogin = origPostLogin;
    db.setSetting('ad_enabled', '1');
  }
});

test('AUTH-06 ad user: cache miss + AD Gateway success → login ผ่าน + self-heal cache', async () => {
  adGatewayClient.postLogin = async () => ({ ok: true, reason: null, rawMessage: 'success', httpStatus: 200, responseTimeMs: 15 });
  try {
    const r = await api('POST', '/api/auth/login', { body: { username: 'ad_user1', password: 'newAdPass456' } });
    assert.equal(r.status, 200);
  } finally {
    adGatewayClient.postLogin = origPostLogin;
  }
  const row = db.prepare('SELECT password_hash, ad_last_synced_at FROM users WHERE username=?').get('ad_user1');
  assert.ok(bcrypt.compareSync('newAdPass456', row.password_hash), 'password_hash ต้องถูกเขียนทับด้วยรหัสใหม่ (self-healing mirrored sync)');
  assert.ok(row.ad_last_synced_at);
});

test('AUTH-07 ad user: หลัง self-heal แล้ว login ครั้งถัดไปใช้ cache ไม่ยิง AD Gateway ซ้ำ', async () => {
  adGatewayClient.postLogin = async () => { throw new Error('ไม่ควรถูกเรียก — cache ควรตรงแล้วหลัง self-heal'); };
  try {
    const r = await api('POST', '/api/auth/login', { body: { username: 'ad_user1', password: 'newAdPass456' } });
    assert.equal(r.status, 200);
  } finally {
    adGatewayClient.postLogin = origPostLogin;
  }
});

test('AUTH-08 ad user: AD Gateway ปฏิเสธจริง (รหัสผิด) → 401 + นับ failed_login_count', async () => {
  const before = db.prepare('SELECT failed_login_count FROM users WHERE username=?').get('ad_user1').failed_login_count;
  adGatewayClient.postLogin = async () => ({ ok: false, reason: 'rejected', rawMessage: 'Invalid credentials', httpStatus: 401, responseTimeMs: 20 });
  try {
    const r = await api('POST', '/api/auth/login', { body: { username: 'ad_user1', password: 'totally-wrong' } });
    assert.equal(r.status, 401);
  } finally {
    adGatewayClient.postLogin = origPostLogin;
  }
  const after = db.prepare('SELECT failed_login_count FROM users WHERE username=?').get('ad_user1').failed_login_count;
  assert.equal(after, before + 1, 'รหัสผ่านผิดจริงต้องนับเป็นความพยายาม login ผิด');
});

test('AUTH-09 ad user: AD Gateway unreachable → 503 แต่ "ไม่" นับเป็น failed_login_count (lockoutExempt)', async () => {
  const before = db.prepare('SELECT failed_login_count FROM users WHERE username=?').get('ad_user1').failed_login_count;
  adGatewayClient.postLogin = async () => ({ ok: false, reason: 'unreachable', rawMessage: 'timeout', httpStatus: null, responseTimeMs: null });
  try {
    const r = await api('POST', '/api/auth/login', { body: { username: 'ad_user1', password: 'some-uncached-pass' } });
    assert.equal(r.status, 503);
  } finally {
    adGatewayClient.postLogin = origPostLogin;
  }
  const after = db.prepare('SELECT failed_login_count FROM users WHERE username=?').get('ad_user1').failed_login_count;
  assert.equal(after, before, 'ปัญหาโครงสร้าง (AD ล่ม) ไม่ใช่ความผิดของ user ต้องไม่นับ lockout');
});

test('AUTH-10 account lockout: ผิดครบ login_attempt_max ครั้ง → ล็อกบัญชี (ทนรอด — ไม่ใช่ rate-limit ธรรมดา)', async () => {
  db.prepare("INSERT INTO users (username, password_hash, full_name, role) VALUES (?,?,?,?)")
    .run('lockout_user1', bcrypt.hashSync('correctpass1', 12), 'Lockout Test User', 'qc_staff');
  db.setSetting('login_attempt_max', '3');
  db.setSetting('lock_account_minutes', '15');

  for (let i = 0; i < 3; i++) {
    const r = await api('POST', '/api/auth/login', { body: { username: 'lockout_user1', password: 'wrong' } });
    assert.equal(r.status, 401);
  }
  // ครั้งที่ 4 แม้รหัสถูกต้องก็ต้องถูกบล็อกเพราะ locked_until
  const r4 = await api('POST', '/api/auth/login', { body: { username: 'lockout_user1', password: 'correctpass1' } });
  assert.equal(r4.status, 423);

  db.setSetting('login_attempt_max', '5');
  db.prepare("UPDATE users SET failed_login_count=0, locked_until=NULL WHERE username='lockout_user1'").run();
});

test('AUTH-11 resolveProvider: local user → localProvider เสมอ ไม่ว่า mode/ad_enabled จะเป็นอะไร', () => {
  assert.strictEqual(resolveProvider({ authMode: 'hybrid', adEnabled: true, userAuthProvider: 'local' }), localProvider);
  assert.strictEqual(resolveProvider({ authMode: 'local', adEnabled: false, userAuthProvider: 'local' }), localProvider);
});

test('AUTH-12 resolveProvider: ad user + hybrid + ad_enabled → adProvider', () => {
  assert.strictEqual(resolveProvider({ authMode: 'hybrid', adEnabled: true, userAuthProvider: 'ad' }), adProvider);
});

test('AUTH-13 resolveProvider: ad user + ad ปิด → fallback localProvider', () => {
  assert.strictEqual(resolveProvider({ authMode: 'hybrid', adEnabled: false, userAuthProvider: 'ad' }), localProvider);
});

test('AUTH-14 secretsCrypto: encrypt/decrypt round trip', () => {
  const enc = encryptSecret('my-secret-value');
  assert.ok(enc.startsWith('enc:v1:'));
  assert.equal(decryptSecret(enc), 'my-secret-value');
});

test('AUTH-15 secretsCrypto/db: empty string passthrough + setSecretSetting/getSecretSetting round trip', () => {
  assert.equal(encryptSecret(''), '');
  db.setSecretSetting('ad_secret_key', 'super-secret-123');
  const raw = db.getSetting('ad_secret_key');
  assert.ok(raw.startsWith('enc:v1:'), 'ต้องเก็บเป็นค่าเข้ารหัส ไม่ใช่ plaintext');
  assert.equal(db.getSecretSetting('ad_secret_key'), 'super-secret-123');
});

test('AUTH-16 adGatewayClient.formatAdTimestamp: เวลาไทย +7 ปิดท้าย Z ไม่มีมิลลิวินาที (ตัวอย่างจาก ADAuthen.md §3)', () => {
  const ts = adGatewayClient.formatAdTimestamp(new Date('2026-06-24T04:15:49.123Z')); // UTC 04:15:49 → ไทย 11:15:49
  assert.equal(ts, '2026-06-24T11:15:49Z');
});

test('AUTH-17 adGatewayClient: ไม่ retry เมื่อ AD Gateway ตอบกลับมาแล้ว (แม้จะ reject) — กันเร่ง lockout ของ AD จริง', async () => {
  let callCount = 0;
  const fakeApp = express();
  fakeApp.use(express.json());
  fakeApp.post('/login', (req, res) => { callCount++; res.status(401).json({ status: 'failed', message: 'Invalid credentials' }); });
  const fakeServer = fakeApp.listen(0);
  await new Promise(r => fakeServer.once('listening', r));
  const fakeUrl = `http://127.0.0.1:${fakeServer.address().port}/login`;

  const result = await adGatewayClient.postLogin(fakeUrl, { appId: 'x', secretKey: 'y', username: 'u', password: 'p' }, { timeoutMs: 2000, retryCount: 2 });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'rejected');
  assert.equal(callCount, 1, 'ต้องไม่ retry ตอนถูก reject จริง แม้ retryCount จะตั้งไว้ > 0');

  fakeServer.close();
});

test('AUTH-18 adGatewayClient: unreachable → คืน reason=unreachable (ไม่ throw, ไม่ hang)', async () => {
  const result = await adGatewayClient.postLogin(
    'http://127.0.0.1:1/login',
    { appId: 'x', secretKey: 'y', username: 'u', password: 'p' },
    { timeoutMs: 500, retryCount: 1 }
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unreachable');
});

test('AUTH-19 environmentService: create preset + apply → copy ค่าเข้า settings จริง', () => {
  const id = environmentService.upsertPreset({
    env_key: 'test_env', label: 'Test Env',
    api_url: 'https://test.example', ad_gateway_url: 'https://test-ad.example/login', ad_domain: 'TESTDOMAIN',
  }, 1, '127.0.0.1');

  environmentService.applyPreset(id, 1, '127.0.0.1');

  assert.equal(db.getSetting('app_url'), 'https://test.example');
  assert.equal(db.getSetting('ad_gateway_url'), 'https://test-ad.example/login');
  assert.equal(db.getSetting('ad_domain'), 'TESTDOMAIN');
  const row = db.prepare('SELECT is_current FROM environment_presets WHERE id = ?').get(id);
  assert.equal(row.is_current, 1);
});

test('AUTH-20 system-settings routes: ไม่ใช่ admin → 401/403', async () => {
  const r = await api('GET', '/api/admin/system-settings/auth', {});
  assert.equal(r.status, 401);
});

test('AUTH-21 system-settings routes: admin ตั้งค่า auth mode ผ่าน HTTP → บันทึกจริง', async () => {
  // AUTH-01/03 login จริงผ่าน authService ทำให้ session_token ของ admin เปลี่ยนไปแล้ว — sync กลับให้ตรงกับ adminCookie
  db.prepare("UPDATE users SET session_token=? WHERE username='admin'").run(adminSessionToken);
  const r = await api('POST', '/api/admin/system-settings/auth', { cookie: adminCookie, body: { auth_mode: 'hybrid' } });
  assert.equal(r.status, 200);
  const get = await api('GET', '/api/admin/system-settings/auth', { cookie: adminCookie });
  assert.equal(get.body.auth_mode, 'hybrid');
  assert.equal(get.body.ad_secret_key, '', 'secret ต้อง write-only ไม่คืนค่าจริงออก API');
  assert.equal(get.body.ad_secret_key_set, true);
});

test('AUTH-22 system-settings routes: auth_mode ที่ไม่รองรับ (strict ad) → 400', async () => {
  db.prepare("UPDATE users SET session_token=? WHERE username='admin'").run(adminSessionToken);
  const r = await api('POST', '/api/admin/system-settings/auth', { cookie: adminCookie, body: { auth_mode: 'ad' } });
  assert.equal(r.status, 400);
});

// ── ปุ่ม "Internal AP System" (forceAdGateway) — บังคับเช็คกับ AD Gateway ตรงๆ ข้าม local cache เสมอ ──

test('AUTH-23 forceAdGateway: บัญชี local (ไม่ได้เปิด AD) → 400 ชัดเจน ไม่ fallback เงียบๆ', async () => {
  const r = await api('POST', '/api/auth/login', { body: { username: 'admin', password: 'admin1234', forceAdGateway: true } });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Active Directory/);
});

test('AUTH-24 forceAdGateway: ad_enabled=0 ทั้งระบบ → 503 ชัดเจน', async () => {
  db.setSetting('ad_enabled', '0');
  try {
    const r = await api('POST', '/api/auth/login', { body: { username: 'ad_user1', password: 'newAdPass456', forceAdGateway: true } });
    assert.equal(r.status, 503);
    assert.match(r.body.error, /Active Directory/);
  } finally {
    db.setSetting('ad_enabled', '1');
  }
});

test('AUTH-25 forceAdGateway: ข้าม local cache จริง — รหัสตรงกับ cache แต่ AD Gateway reject ก็ต้อง fail', async () => {
  // ad_user1's cache คือ 'newAdPass456' (ตั้งไว้ตั้งแต่ AUTH-06) — ถ้าไม่ skip cache จริง จะผ่านโดยไม่ยิง gateway เลย
  let gatewayWasCalled = false;
  adGatewayClient.postLogin = async () => {
    gatewayWasCalled = true;
    return { ok: false, reason: 'rejected', rawMessage: 'Invalid credentials', httpStatus: 401, responseTimeMs: 10 };
  };
  try {
    const r = await api('POST', '/api/auth/login', { body: { username: 'ad_user1', password: 'newAdPass456', forceAdGateway: true } });
    assert.equal(r.status, 401, 'ต้อง fail เพราะ forceAdGateway ข้าม cache ไปเช็ค gateway ตรงๆ (mock ให้ reject)');
    assert.equal(gatewayWasCalled, true, 'ต้องยิง AD Gateway จริง แม้รหัสจะตรงกับ cache ก็ตาม');
  } finally {
    adGatewayClient.postLogin = origPostLogin;
  }
});

test('AUTH-26 forceAdGateway: สำเร็จจริงเมื่อ AD Gateway ตอบ success (ยัง self-heal cache ตามปกติ)', async () => {
  adGatewayClient.postLogin = async () => ({ ok: true, reason: null, rawMessage: 'success', httpStatus: 200, responseTimeMs: 12 });
  try {
    const r = await api('POST', '/api/auth/login', { body: { username: 'ad_user1', password: 'freshAdPass789', forceAdGateway: true } });
    assert.equal(r.status, 200);
  } finally {
    adGatewayClient.postLogin = origPostLogin;
  }
  const row = db.prepare('SELECT password_hash FROM users WHERE username=?').get('ad_user1');
  assert.ok(bcrypt.compareSync('freshAdPass789', row.password_hash));
});
