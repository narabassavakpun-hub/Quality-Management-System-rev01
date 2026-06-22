function requireRole(roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'ไม่มีสิทธิ์เข้าถึง' });
    next();
  };
}

// qc_staff ต้องเป็นสถานี 'incoming' (QC รับเข้า) — role อื่นผ่านได้เสมอ
function requireReceivingQC(req, res, next) {
  if (req.user?.role === 'qc_staff' && req.user?.qc_station !== 'incoming') {
    return res.status(403).json({ error: 'เฉพาะ QC รับเข้า (สถานี incoming) เท่านั้น' });
  }
  next();
}

module.exports = requireRole;
module.exports.requireReceivingQC = requireReceivingQC;
