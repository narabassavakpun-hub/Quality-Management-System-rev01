// ===== Environment Preset Service — CLAUDE.md §24/§6 =====
// preset = "ปุ่มจำค่า/กดคืนค่า" เท่านั้น ไม่ใช่ตัวตัดสินใจ runtime — กด Apply แล้ว copy ค่าเข้า settings จริง
// (app_url/ad_gateway_url/ad_domain) โค้ดทุกจุดที่ต้องรู้ endpoint อ่านจาก settings เสมอ ไม่ join ตารางนี้ตรงๆ
const db = require('../db/database');

function httpError(message, status) { const e = new Error(message); e.status = status; return e; }

function listPresets() {
  return db.prepare('SELECT * FROM environment_presets ORDER BY id').all();
}

function upsertPreset({ id, env_key, label, api_url, ad_gateway_url, ad_domain }, actorId, ip) {
  if (!env_key || !label) throw httpError('env_key และ label ต้องไม่ว่าง', 400);

  const run = db.transaction(() => {
    if (id) {
      const existing = db.prepare('SELECT * FROM environment_presets WHERE id = ?').get(id);
      if (!existing) throw httpError('ไม่พบ environment preset', 404);
      db.prepare(`UPDATE environment_presets
        SET env_key=?, label=?, api_url=?, ad_gateway_url=?, ad_domain=?, updated_at=CURRENT_TIMESTAMP
        WHERE id=?`).run(env_key, label, api_url || '', ad_gateway_url || '', ad_domain || '', id);
      db.auditLog('environment_presets', id, 'UPDATE', existing, { env_key, label, api_url, ad_gateway_url, ad_domain }, actorId, ip);
      return id;
    }
    const result = db.prepare(`INSERT INTO environment_presets (env_key, label, api_url, ad_gateway_url, ad_domain)
      VALUES (?, ?, ?, ?, ?)`).run(env_key, label, api_url || '', ad_gateway_url || '', ad_domain || '');
    db.auditLog('environment_presets', result.lastInsertRowid, 'CREATE', null, { env_key, label, api_url, ad_gateway_url, ad_domain }, actorId, ip);
    return result.lastInsertRowid;
  });

  try {
    return run();
  } catch (e) {
    if (e.message?.includes('UNIQUE')) throw httpError(`env_key "${env_key}" ถูกใช้งานแล้ว`, 409);
    throw e;
  }
}

function deletePreset(id, actorId, ip) {
  const run = db.transaction(() => {
    const existing = db.prepare('SELECT * FROM environment_presets WHERE id = ?').get(id);
    if (!existing) throw httpError('ไม่พบ environment preset', 404);
    db.prepare('DELETE FROM environment_presets WHERE id = ?').run(id);
    db.auditLog('environment_presets', id, 'DELETE', existing, null, actorId, ip);
  });
  run();
}

function applyPreset(id, actorId, ip) {
  const run = db.transaction(() => {
    const preset = db.prepare('SELECT * FROM environment_presets WHERE id = ?').get(id);
    if (!preset) throw httpError('ไม่พบ environment preset', 404);

    db.setSetting('app_url', preset.api_url || '');
    db.setSetting('ad_gateway_url', preset.ad_gateway_url || '');
    db.setSetting('ad_domain', preset.ad_domain || '');

    db.prepare('UPDATE environment_presets SET is_current = 0').run();
    db.prepare('UPDATE environment_presets SET is_current = 1 WHERE id = ?').run(id);

    db.auditLog('environment_presets', id, 'APPLY', null, { env_key: preset.env_key, label: preset.label }, actorId, ip);
  });
  run();
}

module.exports = { listPresets, upsertPreset, deletePreset, applyPreset };
