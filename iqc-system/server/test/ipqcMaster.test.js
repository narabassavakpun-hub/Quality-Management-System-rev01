// Integration tests for IPQC/FQC master CRUD — run with: node --test
const path = require('node:path');
const os = require('node:os');

// Must be set BEFORE requiring db/app
process.env.IQC_DB_PATH = path.join(os.tmpdir(), `iqc-master-test-${Date.now()}.db`);
process.env.JWT_SECRET = 'test-secret-master';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const db = require('../db/database');

// ---- seed sessions + mint cookies ----
db.prepare("UPDATE users SET session_token='sess-admin' WHERE username='admin'").run();
db.prepare("UPDATE users SET session_token='sess-staff' WHERE username='qc_staff1'").run();
const adminId = db.prepare("SELECT id FROM users WHERE username='admin'").get().id;
const staffId = db.prepare("SELECT id FROM users WHERE username='qc_staff1'").get().id;
const pmId = db.prepare("SELECT id FROM users WHERE username='production1'").get().id;

const ck = (id, sess) => 'token=' + jwt.sign({ id, sessionToken: sess }, process.env.JWT_SECRET);
const ADMIN = ck(adminId, 'sess-admin');
const STAFF = ck(staffId, 'sess-staff');

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/ipqc/master', require('../routes/ipqcMaster'));

let server, base;
test.before(async () => {
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

async function api(method, p, { cookie, body } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, body: json };
}

let lineId;

test('auth required — no cookie → 401', async () => {
  const r = await api('GET', '/api/ipqc/master/fm-categories');
  assert.equal(r.status, 401);
});

test('seeded FM categories present (4)', async () => {
  const r = await api('GET', '/api/ipqc/master/fm-categories', { cookie: ADMIN });
  assert.equal(r.status, 200);
  assert.equal(r.body.total, 4);
});

test('seeded line_types present (alu/upvc/other)', async () => {
  const r = await api('GET', '/api/ipqc/master/line-types', { cookie: ADMIN });
  assert.equal(r.status, 200);
  assert.ok(r.body.data.some(t => t.code === 'alu'));
});

test('create factory (admin) → 201', async () => {
  const r = await api('POST', '/api/ipqc/master/factories', {
    cookie: ADMIN,
    body: { name: 'F01', factory_code: '01' },
  });
  assert.equal(r.status, 201);
});

test('create production line (admin) → 201, code auto-generated', async () => {
  const r = await api('POST', '/api/ipqc/master/production-lines', {
    cookie: ADMIN,
    body: { name: 'สาย ALU 15', line_type: 'alu', factory: 'F01', pdplan_sheet: '0115,0116' },
  });
  assert.equal(r.status, 201);
  assert.ok(r.body.id);
  lineId = r.body.id;
  const g = await api('GET', `/api/ipqc/master/production-lines/${lineId}`, { cookie: ADMIN });
  assert.equal(g.body.code, 'F01-ALU-1'); // auto-gen: {factory}-{LINE_TYPE}-{running seq}
  assert.equal(g.body.factory_code, '01'); // auto-fill จาก factories table
});

test('create line — validation: missing name → 400 with errors', async () => {
  const r = await api('POST', '/api/ipqc/master/production-lines', {
    cookie: ADMIN,
    body: { line_type: 'alu', factory: 'F01' },
  });
  assert.equal(r.status, 400);
  assert.ok(Array.isArray(r.body.errors));
  assert.match(r.body.error, /ชื่อสาย/);
});

test('create line — unknown line_type → 400', async () => {
  const r = await api('POST', '/api/ipqc/master/production-lines', {
    cookie: ADMIN,
    body: { name: 'Y', line_type: 'wood', factory: 'F01' },
  });
  assert.equal(r.status, 400);
});

test('create line — unknown factory → 400', async () => {
  const r = await api('POST', '/api/ipqc/master/production-lines', {
    cookie: ADMIN,
    body: { name: 'Y', line_type: 'alu', factory: 'F99' },
  });
  assert.equal(r.status, 400);
});

test('create line twice with same factory+line_type → sequential codes', async () => {
  const r1 = await api('POST', '/api/ipqc/master/production-lines', { cookie: ADMIN, body: { name: 'สาย ALU 16', line_type: 'alu', factory: 'F01' } });
  const r2 = await api('POST', '/api/ipqc/master/production-lines', { cookie: ADMIN, body: { name: 'สาย ALU 17', line_type: 'alu', factory: 'F01' } });
  assert.equal(r1.status, 201);
  assert.equal(r2.status, 201);
  const g1 = await api('GET', `/api/ipqc/master/production-lines/${r1.body.id}`, { cookie: ADMIN });
  const g2 = await api('GET', `/api/ipqc/master/production-lines/${r2.body.id}`, { cookie: ADMIN });
  assert.equal(g1.body.code, 'F01-ALU-2');
  assert.equal(g2.body.code, 'F01-ALU-3');
});

test('permission — qc_staff cannot create line → 403', async () => {
  const r = await api('POST', '/api/ipqc/master/production-lines', {
    cookie: STAFF,
    body: { name: 'Z', line_type: 'alu', factory: 'F01' },
  });
  assert.equal(r.status, 403);
});

test('get line by id → includes managers array', async () => {
  const r = await api('GET', `/api/ipqc/master/production-lines/${lineId}`, { cookie: ADMIN });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.managers));
});

test('update line name (PATCH)', async () => {
  const r = await api('PATCH', `/api/ipqc/master/production-lines/${lineId}`, { cookie: ADMIN, body: { name: 'สาย ALU 15 (แก้ไข)' } });
  assert.equal(r.status, 200);
  const g = await api('GET', `/api/ipqc/master/production-lines/${lineId}`, { cookie: ADMIN });
  assert.equal(g.body.name, 'สาย ALU 15 (แก้ไข)');
});

test('assign production_manager → 201, appears in managers', async () => {
  const r = await api('POST', `/api/ipqc/master/production-lines/${lineId}/managers`, { cookie: ADMIN, body: { user_id: pmId } });
  assert.equal(r.status, 201);
  const g = await api('GET', `/api/ipqc/master/production-lines/${lineId}`, { cookie: ADMIN });
  assert.ok(g.body.managers.some(m => m.user_id === pmId));
});

test('assign non-production_manager (admin user) → 400', async () => {
  const r = await api('POST', `/api/ipqc/master/production-lines/${lineId}/managers`, { cookie: ADMIN, body: { user_id: adminId } });
  assert.equal(r.status, 400);
});

test('unassign manager → 200', async () => {
  const r = await api('DELETE', `/api/ipqc/master/production-lines/${lineId}/managers/${pmId}`, { cookie: ADMIN });
  assert.equal(r.status, 200);
});

test('defect type with line + fm, filter by line_id', async () => {
  const fm = db.prepare("SELECT id FROM fm_categories WHERE code='Mc'").get().id;
  const c = await api('POST', '/api/ipqc/master/defect-types', {
    cookie: ADMIN,
    body: { production_line_id: lineId, fm_category_id: fm, name: 'ขอบบิ่น', code: '001' },
  });
  assert.equal(c.status, 201);
  const r = await api('GET', `/api/ipqc/master/defect-types?line_id=${lineId}`, { cookie: ADMIN });
  assert.ok(r.body.data.some(d => d.name === 'ขอบบิ่น' && d.fm_name === 'Machine'));
});

test('threshold create → list → hard delete → 404', async () => {
  const c = await api('POST', '/api/ipqc/master/thresholds', { cookie: ADMIN, body: { production_line_id: lineId, threshold_pct: 2.5, effective_date: '2026-06-01' } });
  assert.equal(c.status, 201);
  const id = c.body.id;
  const g1 = await api('GET', `/api/ipqc/master/thresholds/${id}`, { cookie: ADMIN });
  assert.equal(g1.status, 200);
  assert.equal(g1.body.created_by, adminId); // beforeWrite hook stamped it
  const d = await api('DELETE', `/api/ipqc/master/thresholds/${id}`, { cookie: ADMIN });
  assert.equal(d.status, 200);
  const g2 = await api('GET', `/api/ipqc/master/thresholds/${id}`, { cookie: ADMIN });
  assert.equal(g2.status, 404);
});

test('threshold invalid pct (>100) → 400', async () => {
  const r = await api('POST', '/api/ipqc/master/thresholds', { cookie: ADMIN, body: { threshold_pct: 250 } });
  assert.equal(r.status, 400);
});

test('soft delete line → excluded from active=1 list', async () => {
  const d = await api('DELETE', `/api/ipqc/master/production-lines/${lineId}`, { cookie: ADMIN });
  assert.equal(d.status, 200);
  const active = await api('GET', '/api/ipqc/master/production-lines?active=1', { cookie: ADMIN });
  assert.ok(!active.body.data.some(l => l.id === lineId));
  const all = await api('GET', '/api/ipqc/master/production-lines', { cookie: ADMIN });
  assert.ok(all.body.data.some(l => l.id === lineId));
});

test('toggle reactivates a soft-deleted line', async () => {
  const t = await api('PATCH', `/api/ipqc/master/production-lines/${lineId}/toggle`, { cookie: ADMIN });
  assert.equal(t.status, 200);
  assert.equal(t.body.is_active, 1);
  const active = await api('GET', '/api/ipqc/master/production-lines?active=1', { cookie: ADMIN });
  assert.ok(active.body.data.some(l => l.id === lineId));
});

test('audit log written for line create/update/delete', async () => {
  const rows = db.prepare("SELECT action FROM audit_logs WHERE table_name='production_lines' AND record_id=?").all(lineId);
  const actions = rows.map(r => r.action);
  assert.ok(actions.includes('CREATE'));
  assert.ok(actions.includes('UPDATE'));
  assert.ok(actions.includes('DEACTIVATE'));
});
