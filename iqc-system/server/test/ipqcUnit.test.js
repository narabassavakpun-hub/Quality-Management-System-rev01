// Unit tests for validator + ProCodeSAP classifier — node:test, zero-DB
const os = require('node:os');
const path = require('node:path');
process.env.IQC_DB_PATH = path.join(os.tmpdir(), `iqc_ipqcunit_${process.pid}.db`);

const { test } = require('node:test');
const assert = require('node:assert');
const { validate } = require('../lib/validate');
const clf = require('../services/proCodeClassifier');

// ===== validate =====
test('validate: required missing → error', () => {
  const { valid, errors } = validate({}, { name: { required: true, label: 'ชื่อ' } });
  assert.equal(valid, false);
  assert.match(errors[0], /ชื่อ/);
});

test('validate: int range', () => {
  assert.equal(validate({ n: 5 }, { n: { type: 'int', min: 0, max: 10 } }).valid, true);
  assert.equal(validate({ n: 11 }, { n: { type: 'int', min: 0, max: 10 } }).valid, false);
  assert.equal(validate({ n: 'x' }, { n: { type: 'int' } }).valid, false);
});

test('validate: enum', () => {
  assert.equal(validate({ t: 'alu' }, { t: { enum: ['alu', 'upvc'] } }).valid, true);
  assert.equal(validate({ t: 'wood' }, { t: { enum: ['alu', 'upvc'] } }).valid, false);
});

test('validate: optional absent passes', () => {
  assert.equal(validate({}, { x: { type: 'string', maxLength: 3 } }).valid, true);
});

test('validate: date format', () => {
  assert.equal(validate({ d: '2026-06-24' }, { d: { type: 'date' } }).valid, true);
  assert.equal(validate({ d: '24/06/2026' }, { d: { type: 'date' } }).valid, false);
});

// ===== classifier (parseProductNo — no DB) =====
test('classifier: ALU standard', () => {
  const { attrs } = clf.parseProductNo('FA00-W0313-240110', 'FA น.พ. SS ขาว 240x110');
  assert.equal(attrs.line_type, 'FA');
  assert.equal(attrs.brand, '(Standard)');
  assert.equal(attrs.panel_type, 'หน้าต่าง');
  assert.equal(attrs.panel_color, 'สีชา'); // code 13
  assert.equal(attrs.panel_size, '240x110');
});

test('classifier: FU F100 vs S85 by panel type', () => {
  assert.equal(clf.parseProductNo('FUS09-W22512-120110', 'x').attrs.product_series, 'F100');
  assert.equal(clf.parseProductNo('FUS00-D0112-200205', 'x').attrs.product_series, 'S85');
});

test('classifier: FU ECO series', () => {
  assert.equal(clf.parseProductNo('FUE00-W0112-080050', 'x').attrs.product_series, 'ECO 60');
  assert.equal(clf.parseProductNo('FUW22-W7012-120110', 'x').attrs.product_series, 'ECO 60-100');
});

test('classifier: brand codes', () => {
  assert.equal(clf.parseProductNo('FUS09-W0112-100110', '').attrs.brand, 'FRAMEX');
  assert.equal(clf.parseProductNo('FA22-W0412-080050', '').attrs.brand, 'WINDOW ASIA');
});

test('classifier: parsePart3 size split + decimals', () => {
  assert.deepEqual(clf.parsePart3('240110'), { width_mm: 2400, height_mm: 1100, panel_size: '240x110' });
  assert.deepEqual(clf.parsePart3('060040'), { width_mm: 600, height_mm: 400, panel_size: '60x40' });
});

test('classifier: mosquito-net negative form not misread', () => {
  assert.equal(clf.parseProductNo('FUW22-W7012-120110', 'ก (ไม่มีมุ้ง) ข').attrs.mosquito_net, 'ไม่มีมุ้ง');
  assert.equal(clf.parseProductNo('FA22-W0412-080050', 'ประตูมุ้ง').attrs.mosquito_net, 'มุ้ง');
});
