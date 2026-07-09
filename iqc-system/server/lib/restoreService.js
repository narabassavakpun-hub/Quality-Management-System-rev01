// ===== Restore service — กู้ DB จาก Cloudflare R2 (restore-on-boot + manual DR) =====
// ใช้โดย server/bootstrap.js (auto, ตอน container ว่างเปล่า) และ scripts/restore-from-r2.js (manual CLI)
// เฉพาะ DB เท่านั้น — ไฟล์แนบ (uploads) ใช้ lazy fetch-through ตอน request จริงแทน (ดู index.js) ไม่ต้อง
// restore ล่วงหน้าตอน boot เพราะโตขึ้นเรื่อยๆ ตามเวลา ทำให้ cold start ช้าขึ้นเรื่อยๆ ถ้า eager restore
const fs = require('fs');
const path = require('path');
const RawDatabase = require('better-sqlite3');
const r2 = require('./r2Client');

const DB_PATH = process.env.IQC_DB_PATH || path.join(__dirname, '../../iqc.db');
const MANIFEST_KEY = 'backups/manifest.json';

// รวม candidate จาก manifest.json (เร็ว, มี sizeBytes ให้ verify) — ถ้าไม่มี/อ่านไม่ออก fallback ไป
// ListObjectsV2 แล้วเรียงตาม LastModified ที่ R2 คืนมาเอง (ไม่ต้องพึ่ง bookkeeping ของเราเอง)
async function pickCandidates() {
  const candidates = [];
  const manifest = await r2.getJson(MANIFEST_KEY).catch(() => null);
  if (manifest) {
    if (manifest.latest?.uploadedAt) {
      candidates.push({ key: 'backups/db/latest.db', uploadedAt: manifest.latest.uploadedAt, sizeBytes: manifest.latest.sizeBytes });
    }
    for (const [dayKey, info] of Object.entries(manifest.day || {})) {
      if (info?.uploadedAt) candidates.push({ key: `backups/db/${dayKey}.db`, uploadedAt: info.uploadedAt, sizeBytes: info.sizeBytes });
    }
  }
  if (!candidates.length) {
    const listed = await r2.listObjects('backups/db/').catch(() => []);
    for (const o of listed) {
      candidates.push({ key: o.key, uploadedAt: o.lastModified, sizeBytes: o.size });
    }
  }
  candidates.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  return candidates;
}

// ดาวน์โหลดไป temp path ก่อนเสมอ — verify (ขนาด + quick_check) แล้วค่อย rename แบบ atomic เข้าที่จริง
// กัน container ถูกฆ่ากลางทางแล้วเหลือไฟล์ที่ดาวน์โหลดครึ่งๆ กลางๆ อยู่ที่ DB_PATH จริง (จะ crash-loop ทุก boot)
async function tryRestoreCandidate(candidate) {
  const dir = path.dirname(DB_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${DB_PATH}.download-tmp`;

  await r2.getObjectToFile(candidate.key, tmpPath);

  if (candidate.sizeBytes != null) {
    const actualSize = fs.statSync(tmpPath).size;
    if (actualSize !== candidate.sizeBytes) {
      fs.unlinkSync(tmpPath);
      throw new Error(`ขนาดไฟล์ไม่ตรงกับ manifest (คาด ${candidate.sizeBytes}, ได้จริง ${actualSize})`);
    }
  }

  const check = new RawDatabase(tmpPath, { readonly: true });
  let result;
  try { result = check.pragma('quick_check', { simple: true }); } finally { check.close(); }
  if (result !== 'ok') {
    fs.unlinkSync(tmpPath);
    throw new Error(`quick_check ล้มเหลว: ${result}`);
  }

  fs.renameSync(tmpPath, DB_PATH); // atomic เพราะอยู่บน filesystem/volume เดียวกัน
  for (const suffix of ['-wal', '-shm']) {
    try { fs.unlinkSync(DB_PATH + suffix); } catch {}
  }
}

// กู้ DB ล่าสุดจาก R2 มาไว้ที่ IQC_DB_PATH — no-op ถ้ามี DB local อยู่แล้ว (เช่น VPS ที่มี persistent volume)
// ลองสูงสุด 2 candidate ที่ fresh สุด — ถ้า verify ไม่ผ่านทั้งคู่ ปล่อยให้ app boot ด้วย DB ว่าง (seedData เดิม)
async function restoreLatest() {
  if (!r2.isConfigured()) {
    return { restored: false, reason: 'r2_not_configured' };
  }
  if (fs.existsSync(DB_PATH) && fs.statSync(DB_PATH).size > 0) {
    return { restored: false, reason: 'local_db_already_exists' };
  }

  const candidates = await pickCandidates();
  if (!candidates.length) {
    return { restored: false, reason: 'no_backup_found_in_r2' };
  }

  let lastError = null;
  for (const candidate of candidates.slice(0, 2)) {
    try {
      await tryRestoreCandidate(candidate);
      return { restored: true, key: candidate.key, uploadedAt: candidate.uploadedAt };
    } catch (e) {
      lastError = e;
      console.error(`[restoreService] restore จาก ${candidate.key} ล้มเหลว:`, e.message);
    }
  }
  return { restored: false, reason: 'all_candidates_failed', error: lastError?.message };
}

module.exports = { restoreLatest, pickCandidates };
