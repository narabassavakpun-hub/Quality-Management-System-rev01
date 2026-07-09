// backup-db.js — snapshot iqc.db แบบ consistent (DEVMORE / CLAUDE.md §5)
// ใช้งาน: node scripts/backup-db.js [label]
// เก็บไว้ใน ../backups/ และลบไฟล์เก่าเกิน 7 วันอัตโนมัติ (VPS/local — พฤติกรรมเดิมไม่เปลี่ยน)
// ถ้ามี R2_* env vars ตั้งไว้ (ดู server/lib/r2Client.js) จะ sync ไป Cloudflare R2 เพิ่มด้วย (weekday FIFO
// 7 slot + uploads sync) ผ่าน server/lib/backupService.js — ตัวเดียวกับที่ index.js เรียกใช้ตอน scheduler
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.IQC_DB_PATH || path.join(__dirname, '../../iqc.db');
const BACKUP_DIR = path.join(__dirname, '../../backups');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

async function main() {
  const label = (process.argv[2] || 'manual').replace(/[^\w-]/g, '');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const out = path.join(BACKUP_DIR, `iqc_${label}_${stamp}.db`);

  const db = new Database(DB_PATH, { readonly: true });
  db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
  db.close();
  console.log('[backup] created:', out);

  // rotate — ลบ backup ที่เก่ากว่า 7 วัน
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const f of fs.readdirSync(BACKUP_DIR)) {
    if (!f.endsWith('.db')) continue;
    const full = path.join(BACKUP_DIR, f);
    try { if (fs.statSync(full).mtimeMs < cutoff) { fs.unlinkSync(full); console.log('[backup] rotated old:', f); } } catch {}
  }

  const r2 = require('../lib/r2Client');
  if (r2.isConfigured()) {
    console.log('[backup] R2 ตั้งค่าไว้ — sync ไป Cloudflare R2...');
    const backupService = require('../lib/backupService');
    await backupService.runFullCycle();
    console.log('[backup] R2 sync เสร็จสิ้น');
  }
}

if (require.main === module) {
  main().catch(e => { console.error('[backup] ล้มเหลว:', e); process.exit(1); });
}

module.exports = { main };
