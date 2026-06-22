// Unit tests — node:test (zero dependency)  รัน: npm test
// ตั้ง IQC_DB_PATH เป็น temp ก่อน require โมดูลที่ดึง database.js เข้ามา
const os = require('node:os');
const path = require('node:path');
process.env.IQC_DB_PATH = path.join(os.tmpdir(), `iqc_unit_${process.pid}.db`);
process.env.NODE_ENV = 'test';

const { test } = require('node:test');
const assert = require('node:assert');

const { esc, safeSig } = require('../routes/exports');
const { detectExt } = require('../middleware/upload');
const { validateQty } = require('../routes/bills');

// ── esc (DEVMORE C1) — U-11 ──
test('esc escapes HTML special chars', () => {
  assert.strictEqual(esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.strictEqual(esc(`a&b"c'`), 'a&amp;b&quot;c&#39;');
  assert.strictEqual(esc(null), '');
  assert.strictEqual(esc(undefined), '');
  assert.strictEqual(esc(123), '123');
});

// ── safeSig (DEVMORE C1) — U-12 ──
test('safeSig allows only image data-urls', () => {
  assert.strictEqual(safeSig('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
  assert.strictEqual(safeSig('data:image/jpeg;base64,/9j/'), 'data:image/jpeg;base64,/9j/');
  assert.strictEqual(safeSig('"><script>alert(1)</script>'), '');
  assert.strictEqual(safeSig('data:text/html;base64,AAAA'), '');
  assert.strictEqual(safeSig(''), '');
});

// ── magic-number detection (DEVMORE C3) — SEC-03 ──
test('detectExt identifies real file types by magic bytes', () => {
  assert.strictEqual(detectExt(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])), 'png');
  assert.strictEqual(detectExt(Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])), 'jpg');
  assert.strictEqual(detectExt(Buffer.from('%PDF-1.7 ........', 'binary')), 'pdf');
  assert.strictEqual(detectExt(Buffer.from('GIF89a .........', 'binary')), 'gif');
  // HTML/SVG payload ต้อง reject (ไม่ใช่ binary ที่อนุญาต)
  assert.strictEqual(detectExt(Buffer.from('<html><svg onload=alert(1)>', 'utf8')), null);
  assert.strictEqual(detectExt(Buffer.from('<?xml version="1.0"?>', 'utf8')), null);
});

// ── validateQty (DEVMORE M5) — B-11 ──
test('validateQty enforces quantity sanity', () => {
  assert.strictEqual(validateQty(100, 10, 8, 2), null);   // valid
  assert.strictEqual(validateQty(100, 10, 10, 0), null);  // valid (all pass)
  assert.ok(validateQty(10, 20, 0, 0));                   // sampled > received
  assert.ok(validateQty(100, 10, 8, 5));                  // passed+failed > sampled
  assert.ok(validateQty(-1, 0, 0, 0));                    // negative
  assert.ok(validateQty('x', 1, 1, 0));                   // non-numeric
});
