// ===== FG notification helpers (แชร์ระหว่าง routes/fgFncp.js + services/fgFncpService.js) =====
// insert notification + push SSE (guard db.pushSSE — undefined ตอน test/standalone)
const db = require('../db/database');

function notifyRoles(roles, title, message, link) {
  const users = db.prepare(`SELECT id FROM users WHERE role IN (${roles.map(() => '?').join(',')}) AND is_active=1`).all(...roles);
  const ins = db.prepare('INSERT INTO notifications (user_id, title, message, link) VALUES (?,?,?,?)');
  for (const u of users) ins.run(u.id, title, message, link);
  if (db.pushSSE) db.pushSSE(users.map(u => u.id), 'notification', { title });
}

function notifyUser(userId, title, message, link) {
  if (!userId) return;
  db.prepare('INSERT INTO notifications (user_id, title, message, link) VALUES (?,?,?,?)').run(userId, title, message, link);
  if (db.pushSSE) db.pushSSE([userId], 'notification', { title });
}

function notifyStation(station, title, message, link) {
  const users = db.prepare("SELECT id FROM users WHERE qc_station=? AND is_active=1").all(station);
  const ins = db.prepare('INSERT INTO notifications (user_id, title, message, link) VALUES (?,?,?,?)');
  for (const u of users) ins.run(u.id, title, message, link);
  if (db.pushSSE && users.length) db.pushSSE(users.map(u => u.id), 'notification', { title });
}

module.exports = { notifyRoles, notifyUser, notifyStation };
