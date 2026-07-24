// ===== S168 — สร้างตราประทับอัตโนมัติ (ชื่อ+เวลา) แทนลายเซ็นจริง เมื่อผู้ใช้เลือก "กดอนุมัติ" แทนการวาดลายเซ็น =====
// ใช้ร่วมกันทั้ง path "กดอนุมัติ" บนเว็บ และ path "อนุมัติผ่าน Telegram" (webhook) — ทั้งคู่ไม่มีลายเซ็นจริงให้บันทึก
// แต่ uai_signatures.signature_image เป็น NOT NULL (ของเดิม) จึงสร้างรูปแทนไว้ ให้หน้าจอ/PDF ที่ดึงรูปมาแสดงผล
// ทำงานได้เหมือนเดิมทุกจุดโดยไม่ต้องแก้โค้ดแสดงผล — บันทึกวิธีจริงแยกไว้ที่ uai_signatures.signature_method
const sharp = require('sharp');

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// คืน Buffer รูป PNG ขนาด 360x140 — กรอบ+เครื่องหมายถูก+ชื่อ+เวลา (โทนสีเขียว success ตาม CLAUDE.md §9)
function generateStampImage(fullName, when = new Date()) {
  const timeLabel = when.toLocaleString('th-TH', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Bangkok',
  });
  const svg = `
    <svg width="360" height="140" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="356" height="136" rx="10" fill="#F0FDF4" stroke="#16A34A" stroke-width="3"/>
      <circle cx="44" cy="70" r="24" fill="#16A34A"/>
      <path d="M32 70 L40 78 L58 58" stroke="#FFFFFF" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="82" y="56" font-family="'IBM Plex Sans Thai','Noto Sans Thai',sans-serif" font-size="20" font-weight="700" fill="#166534">อนุมัติแล้ว</text>
      <text x="82" y="84" font-family="'IBM Plex Sans Thai','Noto Sans Thai',sans-serif" font-size="16" fill="#1F2937">${esc(fullName || '-')}</text>
      <text x="82" y="108" font-family="'IBM Plex Sans Thai','Noto Sans Thai',sans-serif" font-size="13" fill="#6B7280">${esc(timeLabel)}</text>
    </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

module.exports = { generateStampImage };
