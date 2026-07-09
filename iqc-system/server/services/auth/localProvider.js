// ===== Local Auth Provider — bcrypt ตรงกับ users.password_hash =====
const bcrypt = require('bcryptjs');

function httpError(message, status) { const e = new Error(message); e.status = status; return e; }

function authenticate({ user, password }) {
  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) throw httpError('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง หรือบัญชีถูกระงับ', 401);
  return { synced: false };
}

module.exports = { name: 'local', authenticate };
