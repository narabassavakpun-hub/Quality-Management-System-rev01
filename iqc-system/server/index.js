require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

// ===== Fail-fast: JWT secret ต้องแข็งแรงใน production (DEVMORE C2) =====
(() => {
  const s = process.env.JWT_SECRET || '';
  if (process.env.NODE_ENV === 'production') {
    if (s.length < 32 || s.includes('change-in-production')) {
      console.error('[FATAL] JWT_SECRET ไม่ปลอดภัยสำหรับ production — ตั้งค่าใหม่ (สุ่ม ≥ 64 ตัวอักษร) ใน .env');
      process.exit(1);
    }
  } else if (!s) {
    console.warn('[WARN] ยังไม่ได้ตั้ง JWT_SECRET');
  }
})();

// ===== SETTINGS_ENCRYPTION_KEY — เข้ารหัส secret ใน settings table (เช่น ad_secret_key) — CLAUDE.md §24 =====
// ไม่ fail-fast/exit ตอน boot (ต่างจาก JWT_SECRET) เพราะ AD เป็น feature เสริม — ระบบเดิมที่ไม่ใช้ AD ต้องบูตได้
// ปกติแม้ไม่ได้ตั้งค่านี้ไว้; ค่านี้จะถูก require จริงแบบ lazy ตอนมีการ save/read secret setting เท่านั้น
// (server/lib/secretsCrypto.js — โยน error ชัดเจนตอนนั้นแทน)
(() => {
  const k = process.env.SETTINGS_ENCRYPTION_KEY || '';
  if (k && k.length !== 64) {
    console.warn('[WARN] SETTINGS_ENCRYPTION_KEY ต้องเป็น hex 64 ตัวอักษร (32 bytes) — ค่าปัจจุบันไม่ถูกต้อง');
  } else if (!k) {
    console.warn('[WARN] ยังไม่ได้ตั้ง SETTINGS_ENCRYPTION_KEY — ต้องตั้งก่อนใช้งาน Active Directory settings');
  }
})();

const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('./db/database');
const auth = require('./middleware/auth');
const uploads = require('./middleware/upload');

const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3001;

// อยู่หลัง reverse proxy ใน production → req.ip / secure cookie ถูกต้อง
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

// ===== Compression (gzip/brotli) — เดิมไม่มีเลยทั้งระบบ (Render ไม่มี nginx อยู่หน้า ต่างจาก VPS ที่มี gzip
// ใน nginx.conf) ทำให้ JSON response + SPA bundle (~1.8MB) ถูกส่งแบบไม่บีบอัดทุกครั้ง — วางไว้แถวบนสุดของ
// middleware chain ให้ครอบคลุมทุก response ที่ตามมา (static files/API/SPA) =====
app.use(compression());

// ===== Security headers (helmet-equivalent, zero-dependency — DEVMORE H2/A05) =====
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '0');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
});

app.use(cors({
  origin: process.env.APP_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// ===== Health check (สำหรับ Docker/reverse proxy/uptime monitor) — ไม่ต้อง auth, ไม่ติด rate limit =====
app.get(['/api/health', '/healthz'], (req, res) => {
  try {
    db.prepare('SELECT 1').get(); // ยืนยันว่า DB เปิดและตอบได้
    res.json({ status: 'ok', uptime: process.uptime(), time: new Date().toISOString() });
  } catch (e) {
    res.status(503).json({ status: 'error' });
  }
});

// ===== Rate limiting (DEVMORE H2 — ตาม CLAUDE.md 3.4) =====
app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false }));
app.use('/api/supplier', rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false }));
app.use('/api/exports', rateLimit({ windowMs: 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false }));

// Serve uploaded files (DEVMORE C3 — hardened)
// - nosniff: บังคับ browser เคารพ Content-Type ไม่ MIME-sniff
// - นามสกุลที่ execute ได้ (html/svg/js/...) → force download + octet-stream กัน Stored XSS
const UNSAFE_INLINE_EXT = /\.(html?|svg|xml|js|mjs|xhtml|shtml|php|css)$/i;
const UPLOADS_DIR = path.join(__dirname, '../uploads');
app.use('/uploads', (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (UNSAFE_INLINE_EXT.test(req.path)) {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment');
  }
  next();
}, express.static(UPLOADS_DIR), async (req, res) => {
  // ไฟล์ไม่มีบน local disk (เช่น หลัง restore-on-boot ที่ตั้งใจไม่ eager-restore uploads — ดู DEPLOYMENT.md /
  // server/lib/restoreService.js) — lazy fetch-through จาก R2 แล้ว cache ไว้ local ต่อให้ครั้งถัดไปเจอเลย
  try {
    const r2 = require('./lib/r2Client');
    if (req.method !== 'GET' || !r2.isConfigured()) return res.status(404).end();
    const rel = decodeURIComponent(req.path).replace(/^\/+/, '');
    if (!rel || rel.includes('..')) return res.status(400).end();
    const localPath = path.join(UPLOADS_DIR, rel);
    const tmpPath = `${localPath}.fetch-tmp-${Date.now()}`;
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    await r2.getObjectToFile(`backups/uploads/${rel}`, tmpPath);
    fs.renameSync(tmpPath, localPath);
    // ไฟล์นี้ตรงกับ R2 อยู่แล้ว (เพิ่งโหลดมาจากคีย์เดียวกันเป๊ะ) — mark ไว้กัน syncUploads() รอบถัดไป
    // เข้าใจผิดว่าเป็นไฟล์ใหม่/เปลี่ยน (mtime ที่เพิ่งเขียนจะไม่ตรงกับ state เดิม) แล้วอัปโหลดกลับไปซ้ำโดยเปล่าประโยชน์
    require('./lib/backupService').markLocalFileSynced(rel, fs.statSync(localPath));
    res.sendFile(localPath);
  } catch (e) {
    res.status(404).end();
  }
});

// ===== SSE (Server-Sent Events) =====
// DEVMORE M12 — เก็บเป็น Set ต่อ user รองรับหลายแท็บ + ไม่ leak connection เดิม
// หมายเหตุ scale: เก็บใน memory จึงรองรับ instance เดียว — ถ้า scale หลาย instance ต้องใช้ Redis pub-sub
const sseClients = new Map(); // userId -> Set<res>

app.get('/api/sse', auth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let set = sseClients.get(req.user.id);
  if (!set) { set = new Set(); sseClients.set(req.user.id, set); }
  set.add(res);

  // Heartbeat every 30s to keep connection alive
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch {}
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    const s = sseClients.get(req.user.id);
    if (s) { s.delete(res); if (s.size === 0) sseClients.delete(req.user.id); }
  });
});

// Push SSE event to specific users (ส่งทุกแท็บของ user นั้น)
function pushSSE(userIds, eventType, data) {
  const payload = `data: ${JSON.stringify({ type: eventType, ...data })}\n\n`;
  for (const uid of userIds) {
    const set = sseClients.get(uid);
    if (set) for (const res of set) { try { res.write(payload); } catch {} }
  }
}

// Broadcast SSE event to ALL connected users (status changes that affect shared views)
function broadcastSSE(eventType, data) {
  const payload = `data: ${JSON.stringify({ type: eventType, ...data })}\n\n`;
  for (const [, set] of sseClients) {
    for (const res of set) { try { res.write(payload); } catch {} }
  }
}

// Make pushSSE available globally via db module
db.pushSSE = pushSSE;
db.broadcastSSE = broadcastSSE;
db.sseClients = sseClients;

// ===== CSRF TOKEN =====
app.get('/api/csrf-token', (req, res) => {
  const token = crypto.randomBytes(16).toString('hex');
  res.json({ token });
});

// ===== ADMIN SETTINGS =====
const adminOnly = [auth, require('./middleware/requireRole')(['admin'])];

app.get('/api/admin/settings/telegram', ...adminOnly, (req, res) => {
  // DEVMORE H3 — bot token เป็น write-only: ไม่ส่งค่าจริงออก API (เคยรั่วทั้งค่าจริง+masked)
  res.json({
    telegram_bot_token: '',
    telegram_bot_token_set: !!db.getSetting('telegram_bot_token'),
    telegram_group_qc: db.getSetting('telegram_group_qc') || '',
    telegram_group_purchasing: db.getSetting('telegram_group_purchasing') || '',
    app_url: db.getSetting('app_url') || '',
  });
});

app.post('/api/admin/settings/telegram', ...adminOnly, (req, res) => {
  const { telegram_bot_token, telegram_group_qc, telegram_group_purchasing, app_url } = req.body;
  // อัปเดต token เฉพาะเมื่อกรอกค่ามาใหม่ (กัน save ฟิลด์อื่นแล้วลบ token ทิ้ง)
  if (telegram_bot_token) db.setSetting('telegram_bot_token', telegram_bot_token);
  if (telegram_group_qc !== undefined) db.setSetting('telegram_group_qc', telegram_group_qc);
  if (telegram_group_purchasing !== undefined) db.setSetting('telegram_group_purchasing', telegram_group_purchasing);
  if (app_url !== undefined) db.setSetting('app_url', app_url);
  db.auditLog('settings', 0, 'UPDATE', null, { telegram_group_qc, telegram_group_purchasing, app_url }, req.user.id, req.ip);
  res.json({ ok: true });
});

app.post('/api/admin/settings/telegram/test', ...adminOnly, async (req, res) => {
  const { sendTelegram } = require('./routes/notifications');
  const token = db.getSetting('telegram_bot_token');
  const qcGroup = db.getSetting('telegram_group_qc');
  const purchGroup = db.getSetting('telegram_group_purchasing');

  if (!token || !qcGroup || !purchGroup) {
    return res.status(400).json({ error: 'ยังไม่ตั้งค่า Telegram ครบถ้วน' });
  }

  try {
    await sendTelegram(qcGroup, '[IQC] ทดสอบการส่งข้อความ — กลุ่ม QC');
    await sendTelegram(purchGroup, '[IQC] ทดสอบการส่งข้อความ — กลุ่มจัดซื้อ');
    res.json({ ok: true, message: 'ส่งข้อความทดสอบสำเร็จ' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== EMAIL (SMTP) SETTINGS — S128, mirror ของ Telegram settings ด้านบน =====
app.get('/api/admin/settings/email', ...adminOnly, (req, res) => {
  res.json({
    smtp_host: db.getSetting('smtp_host') || '',
    smtp_port: db.getSetting('smtp_port') || '587',
    smtp_secure: db.getSetting('smtp_secure') === '1',
    smtp_user: db.getSetting('smtp_user') || '',
    smtp_password: '',
    smtp_password_set: !!db.getSecretSetting('smtp_password'),
    smtp_from: db.getSetting('smtp_from') || '',
  });
});

app.post('/api/admin/settings/email', ...adminOnly, (req, res) => {
  const { smtp_host, smtp_port, smtp_secure, smtp_user, smtp_password, smtp_from } = req.body;
  if (smtp_host !== undefined) db.setSetting('smtp_host', smtp_host);
  if (smtp_port !== undefined) db.setSetting('smtp_port', String(smtp_port));
  if (smtp_secure !== undefined) db.setSetting('smtp_secure', smtp_secure ? '1' : '0');
  if (smtp_user !== undefined) db.setSetting('smtp_user', smtp_user);
  // เว้นว่าง = ใช้ค่าเดิม (write-only เหมือน ad_secret_key)
  if (smtp_password) db.setSecretSetting('smtp_password', smtp_password);
  if (smtp_from !== undefined) db.setSetting('smtp_from', smtp_from);
  db.auditLog('settings', 0, 'UPDATE', null, { smtp_host, smtp_port, smtp_secure, smtp_user, smtp_from }, req.user.id, req.ip);
  res.json({ ok: true });
});

app.post('/api/admin/settings/email/test', ...adminOnly, async (req, res) => {
  const { sendEmail } = require('./lib/mailer');
  const to = req.body.to || req.user.email;
  if (!to) return res.status(400).json({ error: 'ไม่มีอีเมลปลายทางสำหรับทดสอบ — กรอกอีเมลผู้รับทดสอบ' });
  if (!db.getSetting('smtp_host') || !db.getSetting('smtp_user') || !db.getSecretSetting('smtp_password')) {
    return res.status(400).json({ error: 'ยังไม่ตั้งค่า SMTP ครบถ้วน' });
  }
  const result = await sendEmail(to, 'ทดสอบระบบอีเมล IQC', '<p>นี่คืออีเมลทดสอบจากระบบ IQC QMS</p>');
  if (!result.ok) return res.status(500).json({ error: `ส่งอีเมลไม่สำเร็จ: ${result.error}` });
  res.json({ ok: true, message: `ส่งอีเมลทดสอบไปที่ ${to} แล้ว` });
});

// ===== PDF TEMPLATE SETTINGS =====
const PDF_SETTING_KEYS = ['company_name','company_address','company_logo','ncr_img_cols','ncr_img_max_width','uai_img_cols','uai_img_max_height','uai_img_inbox_max_height'];

app.get('/api/admin/settings/pdf-template', ...adminOnly, (req, res) => {
  const result = {};
  for (const k of PDF_SETTING_KEYS) result[k] = db.getSetting(k) || '';
  if (result.company_logo) result.company_logo_url = `/uploads/general/${result.company_logo}`;
  res.json(result);
});

app.post('/api/admin/settings/pdf-template', ...adminOnly, (req, res) => {
  const allowed = ['company_name','company_address','ncr_img_cols','ncr_img_max_width','uai_img_cols','uai_img_max_height','uai_img_inbox_max_height'];
  for (const k of allowed) {
    if (req.body[k] !== undefined) db.setSetting(k, req.body[k]);
  }
  db.auditLog('settings', 0, 'UPDATE', null, req.body, req.user.id, req.ip);
  res.json({ ok: true });
});

app.post('/api/admin/settings/logo', ...adminOnly, uploads.logo.single('logo'), uploads.verifyMagic, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'ไม่พบไฟล์' });
  const old = db.getSetting('company_logo');
  if (old) {
    const oldPath = path.join(__dirname, '../uploads/general', old);
    try { if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath); } catch {}
  }
  db.setSetting('company_logo', req.file.filename);
  res.json({ ok: true, url: `/uploads/general/${req.file.filename}` });
});

app.delete('/api/admin/settings/logo', ...adminOnly, (req, res) => {
  const old = db.getSetting('company_logo');
  if (old) {
    const oldPath = path.join(__dirname, '../uploads/general', old);
    try { if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath); } catch {}
    db.setSetting('company_logo', '');
  }
  res.json({ ok: true });
});

// ===== ADMIN USERS =====
app.get('/api/admin/users', ...adminOnly, (req, res) => {
  const rows = db.prepare('SELECT id, username, full_name, role, qc_station, telegram_chat_id, email, auth_provider, is_active, created_at FROM users ORDER BY created_at').all();
  res.json(rows);
});

const VALID_AUTH_PROVIDERS = new Set(['local', 'ad']);

app.post('/api/admin/users', ...adminOnly, (req, res) => {
  const bcrypt = require('bcryptjs');
  const { username, password, full_name, role, qc_station, telegram_chat_id, email, auth_provider } = req.body;
  if (!username || !password || !full_name || !role) return res.status(400).json({ error: 'กรุณากรอกข้อมูลครบ' });
  const minLength = parseInt(db.getSetting('password_min_length'), 10) || 8;
  if (password.length < minLength) return res.status(400).json({ error: `รหัสผ่านต้องยาวอย่างน้อย ${minLength} ตัว` });
  if (auth_provider !== undefined && !VALID_AUTH_PROVIDERS.has(auth_provider)) {
    return res.status(400).json({ error: 'auth_provider ไม่ถูกต้อง' });
  }
  try {
    const hash = bcrypt.hashSync(password, parseInt(process.env.BCRYPT_ROUNDS) || 12);
    const result = db.prepare('INSERT INTO users (username, password_hash, full_name, role, qc_station, telegram_chat_id, email, auth_provider) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(username, hash, full_name, role, qc_station || null, telegram_chat_id ? String(telegram_chat_id).trim() : null, email ? String(email).trim() : null, auth_provider || 'local');
    db.auditLog('users', result.lastInsertRowid, 'CREATE', null, { username, full_name, role, qc_station, telegram_chat_id, email, auth_provider }, req.user.id, req.ip);
    res.json(db.prepare('SELECT id, username, full_name, role, qc_station, telegram_chat_id, email, auth_provider, is_active, created_at FROM users WHERE id = ?').get(result.lastInsertRowid));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'username ซ้ำ' });
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/admin/users/:id', ...adminOnly, (req, res) => {
  const { username, full_name, role, qc_station, telegram_chat_id, email, auth_provider } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'ไม่พบ user' });
  if (username && username !== user.username) {
    const exists = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, req.params.id);
    if (exists) return res.status(409).json({ error: `Username "${username}" ถูกใช้งานแล้ว` });
  }
  if (auth_provider !== undefined && !VALID_AUTH_PROVIDERS.has(auth_provider)) {
    return res.status(400).json({ error: 'auth_provider ไม่ถูกต้อง' });
  }
  db.prepare('UPDATE users SET username=?, full_name=?, role=?, qc_station=?, telegram_chat_id=?, email=?, auth_provider=? WHERE id=?').run(
    username || user.username,
    full_name || user.full_name,
    role || user.role,
    qc_station !== undefined ? (qc_station || null) : user.qc_station,
    telegram_chat_id !== undefined ? (telegram_chat_id ? String(telegram_chat_id).trim() : null) : user.telegram_chat_id,
    email !== undefined ? (email ? String(email).trim() : null) : user.email,
    auth_provider !== undefined ? auth_provider : user.auth_provider,
    req.params.id
  );
  db.auditLog('users', req.params.id, 'UPDATE', user, { username, full_name, role, qc_station, telegram_chat_id, email, auth_provider }, req.user.id, req.ip);
  res.json(db.prepare('SELECT id, username, full_name, role, qc_station, telegram_chat_id, email, auth_provider, is_active, created_at FROM users WHERE id = ?').get(req.params.id));
});

// ทดสอบส่งข้อความเข้า Telegram ส่วนตัวของ user คนนั้น — ให้ admin verify chat id ที่กรอก
app.post('/api/admin/users/:id/telegram-test', ...adminOnly, async (req, res) => {
  const { sendTelegram } = require('./routes/notifications');
  const user = db.prepare('SELECT id, full_name, telegram_chat_id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'ไม่พบ user' });
  const chatId = user.telegram_chat_id ? String(user.telegram_chat_id).trim() : '';
  if (!chatId) return res.status(400).json({ error: 'ผู้ใช้นี้ยังไม่ได้ตั้งค่า Telegram Chat ID' });
  if (!db.getSetting('telegram_bot_token')) return res.status(400).json({ error: 'ยังไม่ได้ตั้งค่า Telegram Bot Token (ที่ตั้งค่าระบบ)' });
  try {
    await sendTelegram(chatId, `[IQC] ทดสอบการแจ้งเตือนส่วนตัว — ${user.full_name}\nหากคุณเห็นข้อความนี้ แสดงว่าตั้งค่า Chat ID ถูกต้องแล้ว`);
    res.json({ ok: true, message: 'ส่งข้อความทดสอบสำเร็จ' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== GEOFENCE SETTINGS =====
app.get('/api/admin/settings/geofence', ...adminOnly, (req, res) => {
  res.json({
    factory_lat:      db.getSetting('factory_lat') || '',
    factory_lon:      db.getSetting('factory_lon') || '',
    factory_radius_m: db.getSetting('factory_radius_m') || '200',
  });
});
app.post('/api/admin/settings/geofence', ...adminOnly, (req, res) => {
  const { factory_lat, factory_lon, factory_radius_m } = req.body;
  if (factory_lat !== undefined) db.setSetting('factory_lat', String(factory_lat));
  if (factory_lon !== undefined) db.setSetting('factory_lon', String(factory_lon));
  if (factory_radius_m !== undefined) db.setSetting('factory_radius_m', String(factory_radius_m));
  db.auditLog('settings', 0, 'UPDATE', null, { factory_lat, factory_lon, factory_radius_m }, req.user.id, req.ip);
  res.json({ ok: true });
});

// ===== ATTENDANCE SHIFT SETTINGS =====
app.get('/api/admin/settings/attendance', ...adminOnly, (req, res) => {
  res.json({
    shift_start_time:       db.getSetting('shift_start_time')       || '08:00',
    shift_end_time:         db.getSetting('shift_end_time')         || '17:00',
    shift_late_grace_minutes: db.getSetting('shift_late_grace_minutes') || '0',
  });
});
app.post('/api/admin/settings/attendance', ...adminOnly, (req, res) => {
  const { shift_start_time, shift_end_time, shift_late_grace_minutes } = req.body;
  if (shift_start_time)         db.setSetting('shift_start_time', shift_start_time);
  if (shift_end_time)           db.setSetting('shift_end_time', shift_end_time);
  if (shift_late_grace_minutes !== undefined) db.setSetting('shift_late_grace_minutes', String(shift_late_grace_minutes));
  db.auditLog('settings', 0, 'UPDATE', null, { shift_start_time, shift_end_time }, req.user.id, req.ip);
  res.json({ ok: true });
});

app.post('/api/admin/users/:id/reset-password', ...adminOnly, (req, res) => {
  const bcrypt = require('bcryptjs');
  const { new_password } = req.body;
  const minLength = parseInt(db.getSetting('password_min_length'), 10) || 8;
  if (!new_password || new_password.length < minLength) return res.status(400).json({ error: `รหัสผ่านต้องยาวอย่างน้อย ${minLength} ตัว` });
  const hash = bcrypt.hashSync(new_password, parseInt(process.env.BCRYPT_ROUNDS) || 12);
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, req.params.id);
  db.prepare('INSERT INTO password_reset_logs (user_id, reset_by) VALUES (?, ?)').run(req.params.id, req.user.id);
  db.auditLog('users', req.params.id, 'RESET_PASSWORD', null, null, req.user.id, req.ip);
  res.json({ ok: true });
});

// ===== ADMIN STATS =====
app.get('/api/admin/stats', ...adminOnly, (req, res) => {
  // bills last 7 days for area chart
  const bills_last7 = (() => {
    const result = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const label = `${d.getDate()}/${d.getMonth() + 1}`;
      const row = db.prepare("SELECT COUNT(*) as c FROM bills WHERE DATE(created_at)=?").get(dateStr);
      result.push({ date: label, count: row.c });
    }
    return result;
  })();

  // NCR all 12 months of current year (ม.ค.–ธ.ค.) — always in Jan→Dec order
  const thaiMonths = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  const ncr_last12months = (() => {
    const year = new Date().getFullYear();
    return thaiMonths.map((month, m) => {
      const ym = `${year}-${String(m + 1).padStart(2, '0')}`;
      const row = db.prepare("SELECT COUNT(*) as c FROM ncrs WHERE strftime('%Y-%m', created_at)=?").get(ym);
      return { month, c: row.c };
    });
  })();

  // Supplier quality ranking (top 8 by NCR count, only suppliers with bills)
  const supplier_quality = db.prepare(`
    SELECT s.name as supplier_name,
           COUNT(DISTINCT b.id) as bill_count,
           COUNT(DISTINCT n.id) as ncr_count,
           ROUND(100.0 * SUM(CASE WHEN bi.qty_failed = 0 THEN 1 ELSE 0 END)
                       / NULLIF(COUNT(bi.id), 0), 1) as pass_rate
    FROM suppliers s
    LEFT JOIN bills b ON b.supplier_id = s.id AND b.status = 'approved'
    LEFT JOIN bill_items bi ON bi.bill_id = b.id
    LEFT JOIN ncr_items ni ON ni.bill_item_id = bi.id
    LEFT JOIN ncrs n ON n.id = ni.ncr_id AND n.status != 'cancelled'
    WHERE s.is_active = 1
    GROUP BY s.id
    HAVING bill_count > 0
    ORDER BY ncr_count DESC, bill_count DESC
    LIMIT 8
  `).all();

  // Bills this month
  const month_bills = db.prepare(
    "SELECT COUNT(*) as c FROM bills WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')"
  ).get().c;

  // Pass rate: % of inspection line items where qty_failed = 0 (consistent with supplier quality ranking)
  const pass_fail_items = db.prepare(`
    SELECT COUNT(*) as qty_total,
           SUM(CASE WHEN bi.qty_failed = 0 THEN 1 ELSE 0 END) as qty_passed,
           SUM(CASE WHEN bi.qty_failed > 0 THEN 1 ELSE 0 END) as qty_failed
    FROM bill_items bi JOIN bills b ON b.id = bi.bill_id
    WHERE b.status = 'approved'
  `).get() || { qty_failed: 0, qty_passed: 0, qty_total: 0 };

  // NCR by severity
  const ncr_by_severity = db.prepare(
    "SELECT severity, COUNT(*) as c FROM ncrs WHERE status != 'cancelled' GROUP BY severity"
  ).all();

  // UAI stats
  const total_uai     = db.prepare("SELECT COUNT(*) as c FROM uai_documents").get().c;
  const completed_uai = db.prepare("SELECT COUNT(*) as c FROM uai_documents WHERE status='uai_completed'").get().c;

  // Bills last 30 days (single query)
  const bills_last30_raw = db.prepare(`
    SELECT DATE(created_at, 'localtime') as date, COUNT(*) as c
    FROM bills WHERE DATE(created_at, 'localtime') >= DATE('now', 'localtime', '-29 days')
    GROUP BY DATE(created_at, 'localtime')
  `).all();
  const bills_last30 = (() => {
    const map = {};
    bills_last30_raw.forEach(r => { map[r.date] = r.c; });
    const result = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const ds = d.toISOString().slice(0, 10);
      result.push({ date: `${d.getDate()}/${d.getMonth() + 1}`, count: map[ds] || 0 });
    }
    return result;
  })();

  res.json({
    suppliers:         db.prepare("SELECT COUNT(*) as c FROM suppliers WHERE is_active=1").get().c,
    products:          db.prepare("SELECT COUNT(*) as c FROM products WHERE is_active=1").get().c,
    product_groups:    db.prepare("SELECT COUNT(*) as c FROM product_groups WHERE is_active=1").get().c,
    defect_categories: db.prepare("SELECT COUNT(*) as c FROM defect_categories WHERE is_active=1").get().c,
    units:             db.prepare("SELECT COUNT(*) as c FROM units WHERE is_active=1").get().c,
    users:             db.prepare("SELECT COUNT(*) as c FROM users WHERE is_active=1").get().c,
    open_ncr:          db.prepare("SELECT COUNT(*) as c FROM ncrs WHERE status NOT IN ('closed','cancelled')").get().c,
    total_ncr:         db.prepare("SELECT COUNT(*) as c FROM ncrs").get().c,
    total_bills:       db.prepare("SELECT COUNT(*) as c FROM bills").get().c,
    pending_bills:     db.prepare("SELECT COUNT(*) as c FROM bills WHERE status='pending_approval'").get().c,
    today_bills:       db.prepare("SELECT COUNT(*) as c FROM bills WHERE DATE(created_at)=DATE('now')").get().c,
    month_bills, supplier_quality, pass_fail_items, ncr_by_severity, total_uai, completed_uai,
    bills_last7, bills_last30,
    ncr_by_status: db.prepare("SELECT status, COUNT(*) as c FROM ncrs GROUP BY status").all(),
    ncr_last12months,
    recent_bills: db.prepare(`
      SELECT b.invoice_no, b.po_no, b.status, b.created_at, s.name as supplier_name
      FROM bills b LEFT JOIN suppliers s ON s.id=b.supplier_id
      ORDER BY b.created_at DESC LIMIT 6
    `).all(),
  });
});

app.delete('/api/admin/users/:id', ...adminOnly, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'ไม่สามารถลบตัวเองได้' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'ไม่พบ user' });
  // ป้องกันลบ admin คนสุดท้าย
  if (user.role === 'admin') {
    const adminCount = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role='admin' AND is_active=1").get().c;
    if (adminCount <= 1) return res.status(400).json({ error: 'ไม่สามารถลบ Admin คนสุดท้ายได้' });
  }
  try {
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    db.auditLog('users', id, 'DELETE', user, null, req.user.id, req.ip);
    res.json({ ok: true });
  } catch (e) {
    if (e.message.includes('FOREIGN KEY') || e.message.includes('RESTRICT')) {
      return res.status(400).json({ error: 'ผู้ใช้นี้มีข้อมูลในระบบ (บิล, NCR, หรืออื่นๆ) — กรุณาปิดใช้งานแทนการลบ' });
    }
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/admin/users/:id/toggle', ...adminOnly, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'ไม่พบ user' });
  const newActive = user.is_active ? 0 : 1;
  db.prepare('UPDATE users SET is_active=? WHERE id=?').run(newActive, req.params.id);
  db.auditLog('users', req.params.id, newActive ? 'ACTIVATE' : 'DEACTIVATE', null, null, req.user.id, req.ip);
  res.json({ ok: true, is_active: newActive });
});

app.get('/api/admin/audit-logs', ...adminOnly, (req, res) => {
  const { q = '', action = '', table_name = '', from = '', to = '', page = 1, limit = 30 } = req.query;
  const offset = (Math.max(1, +page) - 1) * +limit;

  const conds = []; const params = [];
  if (q.trim()) {
    conds.push('(u.username LIKE ? OR u.full_name LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  if (action)     { conds.push('al.action = ?');     params.push(action); }
  if (table_name) { conds.push('al.table_name = ?'); params.push(table_name); }
  if (from)       { conds.push("al.created_at >= ?"); params.push(from + ' 00:00:00'); }
  if (to)         { conds.push("al.created_at <= ?"); params.push(to   + ' 23:59:59'); }

  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const base = `FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id ${where}`;

  const rows  = db.prepare(`SELECT al.*, u.username, u.full_name ${base} ORDER BY al.created_at DESC LIMIT ? OFFSET ?`).all(...params, +limit, offset);
  const total = db.prepare(`SELECT COUNT(*) as c ${base}`).get(...params).c;

  // dropdown options สำหรับ filter
  const actions = db.prepare('SELECT DISTINCT action FROM audit_logs ORDER BY action').all().map(r => r.action);
  const tables  = db.prepare('SELECT DISTINCT table_name FROM audit_logs ORDER BY table_name').all().map(r => r.table_name);

  res.json({ data: rows, total, page: +page, limit: +limit, actions, tables });
});

// ===== ROUTES =====
app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin/system-settings', require('./routes/systemSettings'));
app.use('/api/master', require('./routes/master'));
app.use('/api/bills', require('./routes/bills'));
app.use('/api/ncr', require('./routes/ncr'));
app.use('/api/supplier', require('./routes/supplier'));
app.use('/api/uai', require('./routes/uai'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/purchasing/dashboard', require('./routes/purchasingDashboard'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/delivery', require('./routes/delivery'));
app.use('/api/holidays', require('./routes/holidays'));
app.use('/api/issue-talk', require('./routes/issue-talk'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/kpi', require('./routes/kpi'));
app.use('/api/ipqc/master', require('./routes/ipqcMaster'));
app.use('/api/ipqc-inspection', require('./routes/ipqcInspection'));
app.use('/api/ipncr', require('./routes/ipncr'));
app.use('/api/pro-code-sap', require('./routes/proCodeSap'));
app.use('/api/pd-plan', require('./routes/pdPlan'));
app.use('/api/fg-production',  require('./routes/fgProduction'));
app.use('/api/fg-master',      require('./routes/fgMaster'));
app.use('/api/fg-defect',      require('./routes/fgDefect'));
app.use('/api/fg-fncp',        require('./routes/fgFncp'));
app.use('/api/fncp-response',  require('./routes/fgFncpResponse')); // public — no auth
app.use('/api/fg-fuai',            require('./routes/fgFuai'));
app.use('/api/fg-material-defects', require('./routes/fgMaterialDefects'));
app.use('/api', require('./routes/exports'));

// Serve React build in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  });
}

app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    const limitsMB = { docs: 50, images: 30, files: 20 };
    const mb = limitsMB[err.field] || 50;
    return res.status(400).json({ error: `ไฟล์มีขนาดใหญ่เกินไป (สูงสุด ${mb} MB ต่อไฟล์)` });
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ error: `ประเภทไฟล์ไม่ถูกต้อง: ${err.field}` });
  }
  console.error(err);
  // DEVMORE H9 — ไม่เปิดเผย internal error/SQL/stack ออก client ใน production
  const msg = process.env.NODE_ENV === 'production'
    ? 'เกิดข้อผิดพลาดภายในระบบ'
    : (err.message || 'เกิดข้อผิดพลาดภายในระบบ');
  res.status(500).json({ error: msg });
});

// ===== Notification archiving (DEVMORE M10 / CLAUDE.md 2.10) =====
// ลบ notification ที่อ่านแล้วและเก่ากว่า 180 วัน — รันตอนบูต + ทุก 24 ชม.
function archiveOldNotifications() {
  try {
    const r = db.prepare("DELETE FROM notifications WHERE created_at < datetime('now', '-180 days') AND is_read = 1").run();
    if (r.changes > 0) console.log(`[archive] ลบ notification เก่า ${r.changes} รายการ`);
  } catch (e) {
    console.error('[archive] error:', e.message);
  }
}
archiveOldNotifications();
setInterval(archiveOldNotifications, 24 * 60 * 60 * 1000).unref();

// ===== Overdue NCR notification (Req 6 — Purchasing Dashboard) =====
// แจ้ง Purchasing Owner + Purchasing Manager ครั้งเดียวต่อ NCR ที่เกินกำหนด — รันตอนบูต + ทุก 1 ชม.
const { checkOverdueNcrNotifications } = require('./lib/overdueNotifier');
function runOverdueCheck() {
  try {
    const n = checkOverdueNcrNotifications();
    if (n > 0) console.log(`[overdue] แจ้งเตือน NCR เกินกำหนด ${n} รายการ`);
  } catch (e) {
    console.error('[overdue] check error:', e.message);
  }
}
runOverdueCheck();
setInterval(runOverdueCheck, 60 * 60 * 1000).unref();

// ===== Backup ไป Cloudflare R2 (optional — no-op ถ้าไม่ได้ตั้ง R2_* env, ดู DEPLOYMENT.md) =====
// รอบทุก 2 ชม. (S150 เดิม 10 นาที — ปรับตามคำขอ user เพื่อลด Service-Initiated bandwidth เพิ่มเติม จาก
// runHotBackup()'s hash-dedup ที่ข้าม upload อยู่แล้วถ้าข้อมูลไม่เปลี่ยน — ยิ่งรอบห่างขึ้น ยิ่งลดจำนวนรอบที่ต้อง
// เช็ค/อัปโหลดต่อวัน แลกกับ RPO ที่กว้างขึ้นเป็น ~2 ชม. แทน ~10 นาทีเดิม, ตกลงกับ user แล้ว) —
// runFullCycle() กิน error ของทุกขั้นตอนย่อยเอง (ส่ง Telegram alert แทน) จึงไม่ทำให้ setInterval พัง
const backupService = require('./lib/backupService');
backupService.runFullCycle().catch(e => console.error('[backup] initial cycle error:', e.message));
setInterval(() => backupService.runFullCycle().catch(e => console.error('[backup] cycle error:', e.message)), 2 * 60 * 60 * 1000).unref();

const server = app.listen(PORT, () => {
  console.log(`IQC Server running on port ${PORT}`);
});
// keep-alive ยาวกว่า idle timeout ของ reverse proxy (nginx 75s / CF) กัน 502 จาก connection reuse
server.keepAliveTimeout = 75000;
server.headersTimeout = 76000;

// ===== Graceful shutdown (Docker ส่ง SIGTERM ตอน stop) =====
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ได้รับ ${signal} — ปิดระบบอย่างนุ่มนวล...`);

  // ปิด SSE ทุก connection ก่อน เพื่อให้ server.close() จบได้ (keep-alive ไม่ค้าง)
  try { for (const [, set] of sseClients) for (const r of set) { try { r.end(); } catch {} } } catch {}

  // บังคับออกถ้าปิดไม่จบใน 12 วินาที
  const force = setTimeout(() => { console.error('[shutdown] timeout — บังคับปิด'); process.exit(1); }, 12000);
  force.unref();

  server.close(async () => {
    try { await require('./routes/exports').closeBrowser?.(); } catch {}  // ปิด Chromium singleton
    try { await backupService.runHotBackup(); } catch {}                  // best-effort backup ก่อนปิด (bound ด้วย force timer ด้านบน)
    try { db.close(); } catch {}                                          // flush WAL + ปิด DB
    clearTimeout(force);
    console.log('[shutdown] ปิดเรียบร้อย');
    process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
