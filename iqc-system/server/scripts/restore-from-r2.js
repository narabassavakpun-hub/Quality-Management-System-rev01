// restore-from-r2.js — กู้ DB ล่าสุดจาก Cloudflare R2 มาไว้ที่ IQC_DB_PATH (manual DR / ทดสอบ restore)
// ใช้งาน: node scripts/restore-from-r2.js
// ⚠️ จะทับไฟล์ DB local ปัจจุบันถ้ามีอยู่แล้ว — ใช้เฉพาะตอนกู้คืนจริง หรือซ้อมทดสอบบนเครื่อง/DB ที่ไม่ใช่ของจริง
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.IQC_DB_PATH || path.join(__dirname, '../../iqc.db');

async function main() {
  const r2 = require('../lib/r2Client');
  if (!r2.isConfigured()) {
    console.error('[restore] R2 ยังไม่ได้ตั้งค่า — ต้องมี R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET');
    process.exit(1);
  }

  if (fs.existsSync(DB_PATH)) {
    console.log(`[restore] พบ DB local อยู่แล้วที่ ${DB_PATH} — ย้ายสำรองก่อนทับ`);
    fs.renameSync(DB_PATH, `${DB_PATH}.before-restore-${Date.now()}.bak`);
  }

  const { pickCandidates, restoreLatest } = require('../lib/restoreService');
  const candidates = await pickCandidates();
  if (!candidates.length) {
    console.error('[restore] ไม่พบ backup ใน R2 เลย');
    process.exit(1);
  }
  console.log(`[restore] พบ ${candidates.length} candidate — จะใช้ตัว fresh สุด: ${candidates[0].key} (${candidates[0].uploadedAt})`);

  const result = await restoreLatest();
  if (result.restored) {
    console.log(`[restore] สำเร็จ: ${result.key} → ${DB_PATH}`);
  } else {
    console.error(`[restore] ล้มเหลว: ${result.reason}`, result.error || '');
    process.exit(1);
  }
}

main().catch(e => { console.error('[restore] error:', e); process.exit(1); });
