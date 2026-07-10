// Unit tests — backupService.js / r2Client.js (Render free-tier deployment plan)
// mock ทุกฟังก์ชันของ r2Client โดยตรง (reassign export) แบบเดียวกับที่ authService.test.js mock
// adGatewayClient.postLogin — ไม่ยิง network จริงไป Cloudflare R2 เลยในเทสชุดนี้
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.IQC_DB_PATH = path.join(os.tmpdir(), `iqc-backupsvc-${process.pid}-${Date.now()}.db`);

const test = require('node:test');
const assert = require('node:assert');
const RawDatabase = require('better-sqlite3');
const r2 = require('../lib/r2Client');
const backupService = require('../lib/backupService');

// สร้างไฟล์ sqlite ที่ valid ขั้นต่ำไว้ที่ IQC_DB_PATH — ไม่ require('../db/database') เพื่อไม่ต้องแบก
// schema/migration/seed เต็มระบบ (backupService เองก็ตั้งใจไม่พึ่ง db/database.js เช่นกัน ดู comment ในไฟล์จริง)
test.before(() => {
  const db = new RawDatabase(process.env.IQC_DB_PATH);
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
  db.prepare('INSERT INTO t (v) VALUES (?)').run('hello');
  db.close();
});
test.after(() => {
  for (const f of [process.env.IQC_DB_PATH, process.env.IQC_DB_PATH + '-wal', process.env.IQC_DB_PATH + '-shm']) {
    try { fs.unlinkSync(f); } catch {}
  }
});

function setR2Env() {
  process.env.R2_ACCOUNT_ID = 'test-account';
  process.env.R2_ACCESS_KEY_ID = 'test-key';
  process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
  process.env.R2_BUCKET = 'test-bucket';
}
function unsetR2Env() {
  delete process.env.R2_ACCOUNT_ID;
  delete process.env.R2_ACCESS_KEY_ID;
  delete process.env.R2_SECRET_ACCESS_KEY;
  delete process.env.R2_BUCKET;
}

// ===== bangkokDateString / bangkokWeekdayIndex — pure date math, ไม่ต้อง mock =====
test('BACKUP-01 bangkokDateString: format YYYY-MM-DD ตาม Asia/Bangkok', () => {
  const d = new Date('2026-07-09T20:00:00Z'); // 03:00 09-Jul Bangkok ของวันถัดไป (UTC+7)
  assert.equal(backupService.bangkokDateString(d), '2026-07-10');
});

test('BACKUP-02 bangkokWeekdayIndex: ข้าม UTC-day boundary ตามเวลาไทยถูกต้อง (0=Sun..6=Sat)', () => {
  // 2026-07-09 คือวันพฤหัส (Thu) ตามปฏิทินจริง — 21:00 UTC ของวันพุธ = 04:00 พฤหัส เวลาไทย
  const d = new Date('2026-07-08T21:00:00Z');
  assert.equal(backupService.bangkokWeekdayIndex(d), 4); // Thu = 4
});

// ===== r2Client.isConfigured =====
test('BACKUP-03 r2Client.isConfigured: false ถ้าตั้งค่าไม่ครบ, true ถ้าครบ', () => {
  unsetR2Env();
  assert.equal(r2.isConfigured(), false);
  setR2Env();
  assert.equal(r2.isConfigured(), true);
  unsetR2Env();
});

// ===== runHotBackup =====
test('BACKUP-04 runHotBackup: no-op (ไม่เรียก R2 เลย) ถ้ายังไม่ได้ตั้งค่า R2', async () => {
  unsetR2Env();
  let called = false;
  const orig = r2.putObjectFromFile;
  r2.putObjectFromFile = async () => { called = true; };
  try {
    await backupService.runHotBackup();
    assert.equal(called, false);
  } finally {
    r2.putObjectFromFile = orig;
  }
});

test('BACKUP-05 runHotBackup: อัปโหลด backups/db/latest.db + อัปเดต manifest.latest', async () => {
  setR2Env();
  const origPut = r2.putObjectFromFile;
  const origPutJson = r2.putJson;
  const origGetJson = r2.getJson;
  let uploadedKey = null;
  let manifestWritten = null;
  r2.putObjectFromFile = async (key) => { uploadedKey = key; return { size: 1234 }; };
  r2.getJson = async () => ({});
  r2.putJson = async (key, obj) => { manifestWritten = { key, obj }; };
  try {
    await backupService.runHotBackup();
    assert.equal(uploadedKey, 'backups/db/latest.db');
    assert.equal(manifestWritten.key, 'backups/manifest.json');
    assert.equal(manifestWritten.obj.latest.sizeBytes, 1234);
    assert.ok(manifestWritten.obj.latest.uploadedAt);
  } finally {
    r2.putObjectFromFile = origPut;
    r2.putJson = origPutJson;
    r2.getJson = origGetJson;
    unsetR2Env();
  }
});

test('BACKUP-06 runHotBackup: ไม่ throw แม้ R2 upload ล้มเหลว (alertFailure กิน error เอง)', async () => {
  setR2Env();
  const origPut = r2.putObjectFromFile;
  r2.putObjectFromFile = async () => { throw new Error('network down'); };
  try {
    await assert.doesNotReject(() => backupService.runHotBackup());
  } finally {
    r2.putObjectFromFile = origPut;
    unsetR2Env();
  }
});

// ===== runDailyFifoBackup =====
test('BACKUP-07 runDailyFifoBackup: skip ถ้า slot ของวันนี้ทำไปแล้ว (manifest.day[day-N].date = วันนี้)', async () => {
  setR2Env();
  const today = backupService.bangkokDateString();
  const dayIdx = backupService.bangkokWeekdayIndex();
  const origGetJson = r2.getJson;
  const origPut = r2.putObjectFromFile;
  let putCalled = false;
  r2.getJson = async () => ({ day: { [`day-${dayIdx}`]: { date: today, uploadedAt: new Date().toISOString(), sizeBytes: 1 } } });
  r2.putObjectFromFile = async () => { putCalled = true; };
  try {
    await backupService.runDailyFifoBackup();
    assert.equal(putCalled, false);
  } finally {
    r2.getJson = origGetJson;
    r2.putObjectFromFile = origPut;
    unsetR2Env();
  }
});

test('BACKUP-08 runDailyFifoBackup: อัปโหลด day-N.db ตาม weekday ปัจจุบัน ถ้ายังไม่ได้ทำวันนี้', async () => {
  setR2Env();
  const dayIdx = backupService.bangkokWeekdayIndex();
  const origGetJson = r2.getJson;
  const origPut = r2.putObjectFromFile;
  const origPutJson = r2.putJson;
  let uploadedKey = null;
  let manifestWritten = null;
  r2.getJson = async () => ({}); // manifest ว่าง — ยังไม่เคยทำวันนี้
  r2.putObjectFromFile = async (key) => { uploadedKey = key; return { size: 999 }; };
  r2.putJson = async (key, obj) => { manifestWritten = obj; };
  try {
    await backupService.runDailyFifoBackup();
    assert.equal(uploadedKey, `backups/db/day-${dayIdx}.db`);
    assert.equal(manifestWritten.day[`day-${dayIdx}`].sizeBytes, 999);
  } finally {
    r2.getJson = origGetJson;
    r2.putObjectFromFile = origPut;
    r2.putJson = origPutJson;
    unsetR2Env();
  }
});

// ===== walkFiles (uploads sync helper) =====
test('BACKUP-09 walkFiles: เดินไฟล์ nested directory ครบทุกไฟล์', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iqc-walkfiles-'));
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'sub', 'b.txt'), 'b');
  try {
    const files = backupService.walkFiles(dir).map(f => path.relative(dir, f).split(path.sep).join('/')).sort();
    assert.deepEqual(files, ['a.txt', 'sub/b.txt']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('BACKUP-10 walkFiles: คืน [] ถ้าโฟลเดอร์ไม่มีอยู่จริง (เช่น container ใหม่ยังไม่เคยมี uploads เลย)', () => {
  assert.deepEqual(backupService.walkFiles(path.join(os.tmpdir(), 'iqc-does-not-exist-' + Date.now())), []);
});

// ===== sendEnvTelegram — alert ตอน boot/backup ล้มเหลว ผ่าน env var ตรงๆ (ไม่ผ่าน DB setting) =====
// mock 'node-fetch' ผ่าน require.cache (node-fetch@2 เป็น CJS ธรรมดา — resolve path เดียวกับที่
// backupService.js require ใช้ ณ runtime) กันยิง network จริงไป Telegram API ระหว่างเทส
const nodeFetchPath = require.resolve('node-fetch');
function mockNodeFetch(impl) {
  const orig = require.cache[nodeFetchPath];
  require.cache[nodeFetchPath] = { id: nodeFetchPath, filename: nodeFetchPath, loaded: true, exports: impl };
  return () => { if (orig) require.cache[nodeFetchPath] = orig; else delete require.cache[nodeFetchPath]; };
}
function setTelegramEnv() {
  process.env.TELEGRAM_BOOT_ALERT_TOKEN = 'test-token';
  process.env.TELEGRAM_BOOT_ALERT_CHAT_ID = 'test-chat-id';
}
function unsetTelegramEnv() {
  delete process.env.TELEGRAM_BOOT_ALERT_TOKEN;
  delete process.env.TELEGRAM_BOOT_ALERT_CHAT_ID;
}

test('BACKUP-11 sendEnvTelegram: ไม่ตั้ง TELEGRAM_BOOT_ALERT_* → false, ไม่ยิง network เลย', async () => {
  unsetTelegramEnv();
  let called = false;
  const restore = mockNodeFetch(async () => { called = true; });
  try {
    const ok = await backupService.sendEnvTelegram('test message');
    assert.equal(ok, false);
    assert.equal(called, false);
  } finally {
    restore();
  }
});

test('BACKUP-12 sendEnvTelegram: ตั้ง token/chat id ครบ → เรียก Telegram API ด้วย chat_id/text ที่ถูกต้อง, คืน true', async () => {
  setTelegramEnv();
  let calledUrl = null;
  let calledBody = null;
  const restore = mockNodeFetch(async (url, opts) => {
    calledUrl = url;
    calledBody = JSON.parse(opts.body);
    return { ok: true };
  });
  try {
    const ok = await backupService.sendEnvTelegram('⚠️ ทดสอบ');
    assert.equal(ok, true);
    assert.equal(calledUrl, 'https://api.telegram.org/bottest-token/sendMessage');
    assert.equal(calledBody.chat_id, 'test-chat-id');
    assert.equal(calledBody.text, '⚠️ ทดสอบ');
  } finally {
    restore();
    unsetTelegramEnv();
  }
});

test('BACKUP-13 sendEnvTelegram: fetch ล้มเหลว (network down) → ไม่ throw, คืน false', async () => {
  setTelegramEnv();
  const restore = mockNodeFetch(async () => { throw new Error('network down'); });
  try {
    const ok = await backupService.sendEnvTelegram('x');
    assert.equal(ok, false);
  } finally {
    restore();
    unsetTelegramEnv();
  }
});

// ===== warnNotConfigured (ผ่าน runDailyFifoBackup/syncUploads) — ปิดช่องว่างเดิมที่มีแค่ runHotBackup
// (BACKUP-04) ที่ทดสอบ R2-not-configured no-op — ให้ครบทั้ง 3 entry point ที่เรียก warnNotConfigured =====
test('BACKUP-14 runDailyFifoBackup: no-op (ไม่เรียก R2 เลย) ถ้ายังไม่ได้ตั้งค่า R2', async () => {
  unsetR2Env();
  let called = false;
  const orig = r2.putObjectFromFile;
  r2.putObjectFromFile = async () => { called = true; };
  try {
    await backupService.runDailyFifoBackup();
    assert.equal(called, false);
  } finally {
    r2.putObjectFromFile = orig;
  }
});

test('BACKUP-15 syncUploads: no-op (ไม่เรียก R2 เลย) ถ้ายังไม่ได้ตั้งค่า R2', async () => {
  unsetR2Env();
  let called = false;
  const orig = r2.putObjectFromFile;
  r2.putObjectFromFile = async () => { called = true; };
  try {
    await backupService.syncUploads();
    assert.equal(called, false);
  } finally {
    r2.putObjectFromFile = orig;
  }
});
