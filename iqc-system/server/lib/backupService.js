// ===== Backup service — DB snapshot + uploads sync ไป Cloudflare R2 =====
// ใช้ร่วมกันทั้ง scripts/backup-db.js (CLI, VPS/manual) และ index.js (in-process scheduler, Render free tier)
// ตั้งใจไม่ require('../db/database') ที่ top-level — เปิด raw better-sqlite3 connection เองเสมอ
// (เหมือน scripts/backup-db.js เดิม) กัน side-effect ของ initSchema/runMigrations/seedData ตอนแค่จะ backup
// เฉพาะ path แจ้งเตือน Telegram เท่านั้นที่ lazy-require db/database (มีผลเฉพาะตอน backup ล้มเหลวจริง)
const fs = require('fs');
const os = require('os');
const path = require('path');
const RawDatabase = require('better-sqlite3');
const r2 = require('./r2Client');

const DB_PATH = process.env.IQC_DB_PATH || path.join(__dirname, '../../iqc.db');
const UPLOADS_BASE = path.join(__dirname, '../../uploads');
const SYNC_STATE_PATH = path.join(UPLOADS_BASE, '..', 'upload-sync-state.json');
const MANIFEST_KEY = 'backups/manifest.json';

const WEEKDAY_MAP = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function bangkokParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  }).formatToParts(date).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  return parts;
}
function bangkokDateString(date = new Date()) {
  const p = bangkokParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}
function bangkokWeekdayIndex(date = new Date()) {
  return WEEKDAY_MAP[bangkokParts(date).weekday];
}

// สร้าง consistent snapshot ด้วย VACUUM INTO (เหมือน scripts/backup-db.js เดิม) + ตรวจ integrity ก่อนเชื่อถือ
// (กันเคส DB ต้นทาง corrupt แล้ว backup ทับไฟล์ดีอันเก่าไปด้วย — ดู DEVLOG Session 119)
function createVerifiedSnapshot() {
  const outPath = path.join(os.tmpdir(), `iqc-backup-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const src = new RawDatabase(DB_PATH, { readonly: true });
  try {
    src.exec(`VACUUM INTO '${outPath.replace(/'/g, "''")}'`);
  } finally {
    src.close();
  }
  const check = new RawDatabase(outPath, { readonly: true });
  let result;
  try {
    result = check.pragma('quick_check', { simple: true });
  } finally {
    check.close();
  }
  if (result !== 'ok') {
    try { fs.unlinkSync(outPath); } catch {}
    throw new Error(`Backup snapshot integrity check ล้มเหลว: ${result}`);
  }
  return outPath;
}

// ส่ง Telegram ผ่าน env var ตรงๆ (TELEGRAM_BOOT_ALERT_TOKEN/_CHAT_ID) — ใช้ได้แม้ deployment ใหม่เอี่ยม
// ที่ยังไม่มีใครไปตั้งค่า Telegram ในหน้า Admin > Settings เลย (ต่างจาก db.getSetting ที่ต้องมีคนตั้งก่อน
// ถึงจะใช้ได้ — เจอจริงเป็นสาเหตุที่ทำให้ alert เงียบสนิทตอน deploy ครั้งแรกบน Render)
async function sendEnvTelegram(text) {
  const token = process.env.TELEGRAM_BOOT_ALERT_TOKEN;
  const chatId = process.env.TELEGRAM_BOOT_ALERT_CHAT_ID;
  if (!token || !chatId) return false;
  try {
    const fetch = require('node-fetch');
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    return true;
  } catch (e) {
    console.error('[backupService] sendEnvTelegram ล้มเหลว:', e.message);
    return false;
  }
}

// alert ผ่าน Telegram — ลองทั้ง 2 ทาง: DB setting (telegram_group_qc, ใช้ได้ถ้ามีคนตั้งค่าแอปแล้ว) และ
// env var (TELEGRAM_BOOT_ALERT_*, ใช้ได้ทันทีตั้งแต่ deploy แรกไม่ต้องพึ่งใครตั้งค่าอะไรก่อน) — ต้องไม่ throw
// ต่อ ไม่งั้น caller (setInterval/shutdown handler) จะพังไปด้วย
async function alertFailure(context, err) {
  const text = `⚠️ [IQC Backup] ${context} ล้มเหลว: ${err?.message || err}`;
  console.error(`[backupService] ${context}:`, err?.message || err);
  await sendEnvTelegram(text);
  try {
    const db = require('../db/database');
    const { sendTelegram } = require('./notify');
    const chatId = db.getSetting('telegram_group_qc');
    if (chatId) await sendTelegram(chatId, text);
  } catch (e2) {
    console.error('[backupService] alertFailure (DB path) ล้มเหลว:', e2.message);
  }
}

// R2 ไม่ได้ตั้งค่าไว้เลย (env var ขาด/ผิด) — เงียบแบบเดิมอันตรายมาก เพราะแปลว่าไม่มี backup เกิดขึ้นจริง
// สักครั้งเดียวโดยไม่มีสัญญาณอะไรเตือนเลย จนกว่าจะเสียข้อมูลจริง — เตือนดังๆ ทาง console + Telegram
// (ครั้งเดียวต่อ process กัน spam ทุก 10 นาที แต่ log ทุกครั้งเพื่อเห็นใน live log ได้ตลอด)
let notConfiguredWarned = false;
async function warnNotConfigured() {
  console.error('[backupService] R2 ยังไม่ได้ตั้งค่า (R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET) — ข้าม backup รอบนี้');
  if (notConfiguredWarned) return;
  notConfiguredWarned = true;
  await sendEnvTelegram('⚠️ [IQC Backup] R2 ยังไม่ได้ตั้งค่าใน environment variables — ระบบไม่มี backup ขึ้น cloud เลยตอนนี้');
}

async function readManifest() {
  try {
    return (await r2.getJson(MANIFEST_KEY)) || {};
  } catch (e) {
    console.error('[backupService] อ่าน manifest.json ไม่ได้:', e.message);
    return {};
  }
}

// อัปโหลด snapshot ไป backups/db/latest.db — รอบ ~10 นาที ใช้เป็น RPO หลักสำหรับ restore-on-boot
async function runHotBackup() {
  if (!r2.isConfigured()) { await warnNotConfigured(); return; }
  const snapshotPath = createVerifiedSnapshot();
  try {
    const { size } = await r2.putObjectFromFile('backups/db/latest.db', snapshotPath);
    const manifest = await readManifest();
    manifest.latest = { uploadedAt: new Date().toISOString(), sizeBytes: size };
    await r2.putJson(MANIFEST_KEY, manifest);
  } catch (e) {
    await alertFailure('Hot backup (latest.db)', e);
  } finally {
    try { fs.unlinkSync(snapshotPath); } catch {}
  }
}

// อัปโหลด snapshot ไป backups/db/day-N.db (N=0..6, Sun..Sat, Asia/Bangkok) — เฉพาะถ้ายังไม่ทำวันนี้
// FIFO 7 slot ธรรมชาติจากปฏิทิน: วันที่ 8 (สัปดาห์ถัดไป วันเดียวกัน) จะทับ slot เดิมของมันเองพอดี
async function runDailyFifoBackup() {
  if (!r2.isConfigured()) { await warnNotConfigured(); return; }
  const today = bangkokDateString();
  const dayIdx = bangkokWeekdayIndex();
  const manifest = await readManifest();
  const dayKey = `day-${dayIdx}`;
  if (manifest.day?.[dayKey]?.date === today) return; // ทำไปแล้ววันนี้ — no-op

  const snapshotPath = createVerifiedSnapshot();
  try {
    const r2Key = `backups/db/${dayKey}.db`;
    const { size } = await r2.putObjectFromFile(r2Key, snapshotPath);
    const fresh = await readManifest(); // อ่านใหม่กันชน concurrent write จากรอบก่อนหน้า
    fresh.day = fresh.day || {};
    fresh.day[dayKey] = { date: today, uploadedAt: new Date().toISOString(), sizeBytes: size };
    await r2.putJson(MANIFEST_KEY, fresh); // เขียน manifest "หลังสุด" เสมอ — object อัปโหลดสำเร็จแล้วเท่านั้น
  } catch (e) {
    await alertFailure(`Daily FIFO backup (${dayKey})`, e);
  } finally {
    try { fs.unlinkSync(snapshotPath); } catch {}
  }
}

function walkFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

function loadSyncState() {
  try { return JSON.parse(fs.readFileSync(SYNC_STATE_PATH, 'utf8')); } catch { return {}; }
}
function saveSyncState(state) {
  try { fs.writeFileSync(SYNC_STATE_PATH, JSON.stringify(state)); } catch (e) {
    console.error('[backupService] เขียน upload-sync-state.json ไม่ได้:', e.message);
  }
}

// sync ไฟล์แนบใหม่/เปลี่ยนแปลงไป R2 แบบ incremental (ไม่ tar ทั้งโฟลเดอร์ทุกรอบ — กันไฟล์ archive โตไม่จบ)
// ไฟล์ที่อัปโหลดแล้วไม่เปลี่ยน (ปกติไฟล์แนบเป็น immutable หลัง upload) จะไม่ถูกส่งซ้ำ
async function syncUploads() {
  if (!r2.isConfigured()) { await warnNotConfigured(); return; }
  const state = loadSyncState();
  const files = walkFiles(UPLOADS_BASE);
  let changed = false;
  for (const full of files) {
    const rel = path.relative(UPLOADS_BASE, full).split(path.sep).join('/');
    const stat = fs.statSync(full);
    const prev = state[rel];
    if (prev && prev.size === stat.size && prev.mtimeMs === stat.mtimeMs) continue; // ไม่เปลี่ยน — ข้าม
    try {
      await r2.putObjectFromFile(`backups/uploads/${rel}`, full);
      state[rel] = { size: stat.size, mtimeMs: stat.mtimeMs };
      changed = true;
    } catch (e) {
      await alertFailure(`Uploads sync (${rel})`, e);
    }
  }
  if (changed) saveSyncState(state);
}

// เรียกจาก scheduler (index.js) และ CLI (scripts/backup-db.js) — รวม 3 ขั้นตอนต่อรอบ
// ทุกฟังก์ชันย่อยกิน error เองแล้ว (alertFailure) — ฟังก์ชันนี้จึงไม่ throw ออกไปหา caller
async function runFullCycle() {
  await runHotBackup();
  await runDailyFifoBackup();
  await syncUploads();
}

module.exports = {
  runHotBackup, runDailyFifoBackup, syncUploads, runFullCycle,
  bangkokDateString, bangkokWeekdayIndex, walkFiles, sendEnvTelegram, // export ไว้ทดสอบ/ใช้ซ้ำ
};
