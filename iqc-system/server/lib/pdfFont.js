// ===== ฟอนต์ IBM Plex Sans Thai แบบฝังในเครื่อง (offline) สำหรับ PDF/JPG =====
// อ่าน woff2 + base64 ครั้งเดียวตอน load module → ไม่ต้องโหลดจาก Google Fonts ทุกครั้ง
// (ตัด network wait ออก ทำให้ export PDF เร็วขึ้นมาก)
const fs = require('fs');
const path = require('path');

const FONT_DIR = path.join(__dirname, '../assets/fonts');
function b64(file) {
  try { return fs.readFileSync(path.join(FONT_DIR, file)).toString('base64'); }
  catch (e) { console.error('[pdfFont] อ่านฟอนต์ไม่สำเร็จ:', file, e.message); return ''; }
}

const FILES = {
  thai400:  'ibm-plex-sans-thai-thai-400-normal.woff2',
  latin400: 'ibm-plex-sans-thai-latin-400-normal.woff2',
  thai700:  'ibm-plex-sans-thai-thai-700-normal.woff2',
  latin700: 'ibm-plex-sans-thai-latin-700-normal.woff2',
};

const THAI_RANGE  = 'U+0E01-0E5B, U+200C-200D, U+25CC';
const LATIN_RANGE = 'U+0000-00FF, U+0131, U+0152-0153, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';

function face(weight, file, range) {
  const data = b64(file);
  if (!data) return '';
  return `@font-face{font-family:'IBM Plex Sans Thai';font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${data}) format('woff2');unicode-range:${range};}`;
}

// CSS @font-face ทั้งชุด (ไม่มี <style> ครอบ) — weight 400 + 700 (600 จะ match 700 ใกล้สุด)
const FONT_FACE_CSS =
  face(400, FILES.thai400,  THAI_RANGE) +
  face(400, FILES.latin400, LATIN_RANGE) +
  face(700, FILES.thai700,  THAI_RANGE) +
  face(700, FILES.latin700, LATIN_RANGE);

module.exports = { FONT_FACE_CSS };
