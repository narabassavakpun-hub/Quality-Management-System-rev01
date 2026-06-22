// ===== Migration framework (DEVMORE H4 / TD-1) =====
// แทนการ rebuild ตาราง ncrs ทั้งก้อนทุกครั้งที่เพิ่มสถานะ
// ติดตาม migration ที่รันแล้วใน schema_migrations → รันครั้งเดียว, idempotent

function init(db) {
  db.prepare(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT PRIMARY KEY,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`).run();
}

function isApplied(db, version) {
  return !!db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(version);
}

function markApplied(db, version) {
  db.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)').run(version);
}

// รัน fn ครั้งเดียวต่อ version (คืน true ถ้าเพิ่งรัน)
function apply(db, version, fn) {
  if (isApplied(db, version)) return false;
  fn();
  markApplied(db, version);
  console.log(`[migrate] applied ${version}`);
  return true;
}

// ncrs ยังมี CHECK constraint บน status อยู่หรือไม่ (true = ยังเป็นสคีมาเก่า)
function hasStatusCheck(db) {
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ncrs'").get()?.sql || '';
  return /CHECK\s*\(\s*status\s+IN/i.test(sql);
}

module.exports = { init, isApplied, markApplied, apply, hasStatusCheck };
