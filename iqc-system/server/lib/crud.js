// ===== Reusable master-data CRUD router factory =====
// Builds list/get/create/update/delete with validation + audit + soft-delete.
// Entity-specific behaviour via hooks (mapRow, beforeWrite, afterCreate, afterUpdate)
// and `filters` / `joins` / `select` for richer list queries.

const express = require('express');
const db = require('../db/database');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { validateBody, asPartial } = require('./validate');

// keep only known fields; normalise '' → null
function pick(body, fields) {
  const out = {};
  for (const f of fields) {
    if (body[f] !== undefined) out[f] = body[f] === '' ? null : body[f];
  }
  return out;
}

function handleDbError(e, res) {
  if (e.status) return res.status(e.status).json({ error: e.message });
  if (e.code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE constraint/i.test(e.message)) {
    return res.status(409).json({ error: 'ข้อมูลซ้ำ — มีรหัส/ชื่อนี้อยู่แล้ว' });
  }
  if (e.code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || /FOREIGN KEY/i.test(e.message)) {
    return res.status(409).json({ error: 'ข้อมูลนี้ถูกอ้างอิงอยู่ ไม่สามารถดำเนินการได้' });
  }
  console.error('[crud]', e.message);
  return res.status(500).json({ error: 'เกิดข้อผิดพลาดในระบบ' });
}

function makeCrudRouter(cfg) {
  const {
    table,
    schema,
    updateSchema = asPartial(schema),
    searchable = [],
    filters = [],            // [{ param, column, mode? 'eq'|'eq_or_null' }]
    orderBy = 'id DESC',
    writeRoles = ['admin'],
    softDelete = true,       // DELETE → is_active=0 (else hard DELETE)
    select = 't.*',
    joins = '',
    alias = 't',
    hooks = {},
  } = cfg;

  const fields = Object.keys(schema);
  const router = express.Router();

  // ---- LIST ----
  router.get('/', auth, (req, res) => {
    const { page = 1, limit = 50, q = '', active } = req.query;
    const lim = Math.min(Math.max(1, +limit || 50), 200);
    const offset = (Math.max(1, +page) - 1) * lim;
    let where = '1=1';
    const params = [];

    if (active === '1' || active === '0') { where += ` AND ${alias}.is_active = ?`; params.push(+active); }

    for (const f of filters) {
      const val = req.query[f.param];
      if (val === undefined || val === '') continue;
      if (f.mode === 'eq_or_null') { where += ` AND (${alias}.${f.column} = ? OR ${alias}.${f.column} IS NULL)`; params.push(val); }
      else { where += ` AND ${alias}.${f.column} = ?`; params.push(val); }
    }

    if (q && searchable.length) {
      where += ' AND (' + searchable.map(c => `${alias}.${c} LIKE ?`).join(' OR ') + ')';
      searchable.forEach(() => params.push(`%${q}%`));
    }

    let rows = db.prepare(
      `SELECT ${select} FROM ${table} ${alias} ${joins} WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
    ).all(...params, lim, offset);
    const total = db.prepare(`SELECT COUNT(*) AS c FROM ${table} ${alias} ${joins} WHERE ${where}`).get(...params);
    if (hooks.mapRow) rows = rows.map(r => hooks.mapRow(db, r));
    res.json({ data: rows, total: total.c, page: +page, limit: lim });
  });

  // ---- GET ONE ----
  router.get('/:id', auth, (req, res) => {
    let row = db.prepare(`SELECT ${select} FROM ${table} ${alias} ${joins} WHERE ${alias}.id = ?`).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
    if (hooks.mapRow) row = hooks.mapRow(db, row);
    res.json(row);
  });

  // ---- CREATE ----
  router.post('/', auth, requireRole(writeRoles), validateBody(schema), (req, res) => {
    const data = pick(req.body, fields);
    try {
      if (hooks.beforeWrite) hooks.beforeWrite(data, req);
      const cols = Object.keys(data);
      if (!cols.length) return res.status(400).json({ error: 'ไม่มีข้อมูล' });
      const id = db.transaction(() => {
        const info = db.prepare(
          `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`
        ).run(...cols.map(c => data[c]));
        if (hooks.afterCreate) hooks.afterCreate(db, info.lastInsertRowid, req);
        db.auditLog(table, info.lastInsertRowid, 'CREATE', null, data, req.user.id, req.ip);
        return info.lastInsertRowid;
      })();
      res.status(201).json({ id });
    } catch (e) { handleDbError(e, res); }
  });

  // ---- UPDATE ----
  router.patch('/:id', auth, requireRole(writeRoles), validateBody(updateSchema), (req, res) => {
    const existing = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
    const data = pick(req.body, fields);
    try {
      if (hooks.beforeWrite) hooks.beforeWrite(data, req);
      const cols = Object.keys(data);
      if (!cols.length) return res.status(400).json({ error: 'ไม่มีข้อมูลที่ต้องแก้ไข' });
      db.transaction(() => {
        db.prepare(`UPDATE ${table} SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`)
          .run(...cols.map(c => data[c]), existing.id);
        if (hooks.afterUpdate) hooks.afterUpdate(db, existing.id, req);
        db.auditLog(table, existing.id, 'UPDATE', existing, data, req.user.id, req.ip);
      })();
      res.json({ ok: true });
    } catch (e) { handleDbError(e, res); }
  });

  // ---- TOGGLE is_active (soft-delete entities only) ----
  if (softDelete) {
    router.patch('/:id/toggle', auth, requireRole(writeRoles), (req, res) => {
      const existing = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
      if (!existing) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
      const nextVal = existing.is_active ? 0 : 1;
      db.transaction(() => {
        db.prepare(`UPDATE ${table} SET is_active = ? WHERE id = ?`).run(nextVal, existing.id);
        db.auditLog(table, existing.id, nextVal ? 'ACTIVATE' : 'DEACTIVATE', { is_active: existing.is_active }, { is_active: nextVal }, req.user.id, req.ip);
      })();
      res.json({ ok: true, is_active: nextVal });
    });
  }

  // ---- DELETE (soft by default) ----
  router.delete('/:id', auth, requireRole(writeRoles), (req, res) => {
    const existing = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
    try {
      db.transaction(() => {
        if (softDelete) db.prepare(`UPDATE ${table} SET is_active = 0 WHERE id = ?`).run(existing.id);
        else db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(existing.id);
        db.auditLog(table, existing.id, softDelete ? 'DEACTIVATE' : 'DELETE', existing, null, req.user.id, req.ip);
      })();
      res.json({ ok: true });
    } catch (e) { handleDbError(e, res); }
  });

  return router;
}

module.exports = { makeCrudRouter, pick, handleDbError };
