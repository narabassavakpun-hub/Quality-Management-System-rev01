// Unit tests — restoreService.js (restore-on-boot จาก Cloudflare R2, Render free-tier deployment plan)
// mock r2Client โดยตรงเหมือน backupService.test.js — ไม่ยิง network จริง
// แยกไฟล์ทดสอบจาก backupService.test.js โดยตั้งใจ + ใช้ IQC_DB_PATH คนละไฟล์ — restoreService ต้องลบ/ทับไฟล์
// ที่ IQC_DB_PATH ได้อิสระระหว่างเทส (จำลอง "container ใหม่ ไม่มี DB") ซึ่งจะชนกับ open handle ถ้าเทสอื่นใน
// process เดียวกันเปิด DB ค้างไว้ที่ path เดียวกันอยู่ (โดยเฉพาะบน Windows ที่ลบไฟล์ที่เปิดค้างไม่ได้)
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.IQC_DB_PATH = path.join(os.tmpdir(), `iqc-restoresvc-${process.pid}-${Date.now()}.db`);

const test = require('node:test');
const assert = require('node:assert');
const RawDatabase = require('better-sqlite3');
const r2 = require('../lib/r2Client');
const restoreService = require('../lib/restoreService');

const DB_PATH = process.env.IQC_DB_PATH;

test.beforeEach(() => {
  for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm', DB_PATH + '.download-tmp']) {
    try { fs.unlinkSync(f); } catch {}
  }
});
test.after(() => {
  for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm', DB_PATH + '.download-tmp']) {
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

function writeValidSqlite(destPath) {
  const db = new RawDatabase(destPath);
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
  db.close();
}

test('RESTORE-01 restoreLatest: R2 ยังไม่ได้ตั้งค่า → r2_not_configured, ไม่แตะไฟล์ local เลย', async () => {
  unsetR2Env();
  const result = await restoreService.restoreLatest();
  assert.equal(result.restored, false);
  assert.equal(result.reason, 'r2_not_configured');
  assert.equal(fs.existsSync(DB_PATH), false);
});

test('RESTORE-02 restoreLatest: มี DB local อยู่แล้ว (ไม่ว่าง) → local_db_already_exists, ไม่เรียก R2 เลย', async () => {
  setR2Env();
  writeValidSqlite(DB_PATH);
  const origGetJson = r2.getJson;
  let called = false;
  r2.getJson = async () => { called = true; return null; };
  try {
    const result = await restoreService.restoreLatest();
    assert.equal(result.restored, false);
    assert.equal(result.reason, 'local_db_already_exists');
    assert.equal(called, false, 'ไม่ควรเรียก r2.getJson เลยถ้ามี DB local อยู่แล้ว');
  } finally {
    r2.getJson = origGetJson;
    unsetR2Env();
  }
});

test('RESTORE-03 restoreLatest: ไม่มี DB local + R2 มี candidate ที่ valid → กู้สำเร็จ, verify quick_check ผ่าน', async () => {
  setR2Env();
  const origGetJson = r2.getJson;
  const origGetObjectToFile = r2.getObjectToFile;
  r2.getJson = async () => ({ latest: { uploadedAt: '2026-07-09T10:00:00Z', sizeBytes: null } });
  r2.getObjectToFile = async (key, destPath) => { writeValidSqlite(destPath); };
  try {
    const result = await restoreService.restoreLatest();
    assert.equal(result.restored, true);
    assert.equal(result.key, 'backups/db/latest.db');
    assert.ok(fs.existsSync(DB_PATH));
    assert.equal(fs.existsSync(DB_PATH + '.download-tmp'), false, 'ไฟล์ temp ต้องถูก rename ทิ้งแล้ว ไม่ใช่ค้างอยู่');
  } finally {
    r2.getJson = origGetJson;
    r2.getObjectToFile = origGetObjectToFile;
    unsetR2Env();
  }
});

test('RESTORE-04 restoreLatest: candidate เดียวและไฟล์ corrupt → all_candidates_failed, ไม่ทิ้งไฟล์เสียไว้ที่ DB_PATH จริง', async () => {
  setR2Env();
  const origGetJson = r2.getJson;
  const origGetObjectToFile = r2.getObjectToFile;
  r2.getJson = async () => ({ latest: { uploadedAt: '2026-07-09T10:00:00Z', sizeBytes: null } });
  r2.getObjectToFile = async (key, destPath) => { fs.writeFileSync(destPath, 'not a real sqlite file'); };
  try {
    const result = await restoreService.restoreLatest();
    assert.equal(result.restored, false);
    assert.equal(result.reason, 'all_candidates_failed');
    assert.equal(fs.existsSync(DB_PATH), false, 'ห้ามมีไฟล์ (แม้ corrupt) ค้างอยู่ที่ path จริง — กัน crash-loop ทุก boot');
  } finally {
    r2.getJson = origGetJson;
    r2.getObjectToFile = origGetObjectToFile;
    unsetR2Env();
  }
});

test('RESTORE-05 restoreLatest: candidate แรก size ไม่ตรง manifest → ลอง candidate ถัดไปที่ valid', async () => {
  setR2Env();
  const origGetJson = r2.getJson;
  const origGetObjectToFile = r2.getObjectToFile;
  r2.getJson = async () => ({
    latest: { uploadedAt: '2026-07-09T10:00:00Z', sizeBytes: 999999 }, // ขนาดไม่ตรงของจริงแน่ๆ
    day: { 'day-3': { uploadedAt: '2026-07-08T10:00:00Z', sizeBytes: null } },
  });
  r2.getObjectToFile = async (key, destPath) => { writeValidSqlite(destPath); };
  try {
    const result = await restoreService.restoreLatest();
    assert.equal(result.restored, true);
    assert.equal(result.key, 'backups/db/day-3.db', 'ต้อง fallback ไป candidate ถัดไปหลัง size mismatch');
  } finally {
    r2.getJson = origGetJson;
    r2.getObjectToFile = origGetObjectToFile;
    unsetR2Env();
  }
});

test('RESTORE-06 pickCandidates: เรียงตาม uploadedAt ใหม่สุดก่อน', async () => {
  setR2Env();
  const origGetJson = r2.getJson;
  r2.getJson = async () => ({
    latest: { uploadedAt: '2026-07-09T10:00:00Z', sizeBytes: 1 },
    day: {
      'day-0': { uploadedAt: '2026-07-06T10:00:00Z', sizeBytes: 2 },
      'day-3': { uploadedAt: '2026-07-09T09:00:00Z', sizeBytes: 3 }, // ใหม่กว่า day-0 แต่เก่ากว่า latest
    },
  });
  try {
    const candidates = await restoreService.pickCandidates();
    assert.deepEqual(candidates.map(c => c.key), ['backups/db/latest.db', 'backups/db/day-3.db', 'backups/db/day-0.db']);
  } finally {
    r2.getJson = origGetJson;
    unsetR2Env();
  }
});

test('RESTORE-07 pickCandidates: manifest หายไป/อ่านไม่ออก → fallback ไป listObjects', async () => {
  setR2Env();
  const origGetJson = r2.getJson;
  const origListObjects = r2.listObjects;
  r2.getJson = async () => null; // manifest ไม่มี
  r2.listObjects = async (prefix) => {
    assert.equal(prefix, 'backups/db/');
    return [
      { key: 'backups/db/day-2.db', lastModified: new Date('2026-07-07T00:00:00Z'), size: 10 },
      { key: 'backups/db/latest.db', lastModified: new Date('2026-07-09T00:00:00Z'), size: 20 },
    ];
  };
  try {
    const candidates = await restoreService.pickCandidates();
    assert.equal(candidates.length, 2);
    assert.equal(candidates[0].key, 'backups/db/latest.db'); // ใหม่สุดตาม LastModified
  } finally {
    r2.getJson = origGetJson;
    r2.listObjects = origListObjects;
    unsetR2Env();
  }
});
