// ===== Provider Resolution — CLAUDE.md §24 =====
// กฎเหล็ก (ยืนยันจากผู้ใช้): Active Directory เป็นระบบเสริมเท่านั้น — พนักงานที่ auth_provider='local'
// ต้อง login ได้ปกติเสมอ ไม่มีทางถูกบล็อกเพราะ config ของ AD ไม่ว่า auth_mode/ad_enabled จะตั้งเป็นอะไรก็ตาม
// ผลคือ: ไม่มี mode ไหนที่ deny local user (ตัวเลือก "Active Directory strict" ตาม ADAuthen.md §4.1 ที่ deny
// user ที่ไม่ได้ผูก AD ไว้ทันที — ไม่ implement จริงในระบบนี้ โชว์ใน UI แบบ disabled เท่านั้น)
const localProvider = require('./localProvider');
const adProvider = require('./adProvider');

function resolveProvider({ authMode, adEnabled, userAuthProvider }) {
  const adActive = authMode === 'hybrid' && !!adEnabled;
  if (userAuthProvider === 'ad' && adActive) return adProvider;
  // ทุกกรณีอื่น (local user เสมอ, หรือ ad user ตอน AD ปิด/ยังไม่เปิด) → local (ใช้ cache hash เดิม, fallback ปลอดภัย)
  return localProvider;
}

module.exports = { resolveProvider };
