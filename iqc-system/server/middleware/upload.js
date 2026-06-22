const multer = require('multer');
const path = require('path');
const fs = require('fs');

const UPLOADS_BASE = path.join(__dirname, '../../uploads');

function makeStorage(folder) {
  return multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(UPLOADS_BASE, folder);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  });
}

const imageFilter = (req, file, cb) => {
  if (/image\/(jpeg|jpg|png|gif|webp)/.test(file.mimetype)) cb(null, true);
  else cb(new Error('รองรับเฉพาะไฟล์รูปภาพ'), false);
};

const pdfFilter = (req, file, cb) => {
  if (file.mimetype === 'application/pdf' && /\.pdf$/i.test(file.originalname)) cb(null, true);
  else cb(new Error('รองรับเฉพาะไฟล์ PDF'), false);
};

const docFilter = (req, file, cb) => {
  if (/image\/(jpeg|jpg|png)/.test(file.mimetype) || file.mimetype === 'application/pdf') cb(null, true);
  else cb(new Error('รองรับ PDF และรูปภาพ (jpg, png) เท่านั้น'), false);
};

const issueTalkFilter = (req, file, cb) => {
  const ok = /image\/(jpeg|jpg|png|gif|webp)/.test(file.mimetype)
    || /video\/(mp4|quicktime|x-msvideo|webm)/.test(file.mimetype)
    || file.mimetype === 'application/pdf';
  ok ? cb(null, true) : cb(new Error('รองรับรูปภาพ, วีดีโอ (mp4, mov) และ PDF เท่านั้น'), false);
};

const uploads = {
  bills: multer({ storage: makeStorage('bills'), fileFilter: imageFilter, limits: { fileSize: 30 * 1024 * 1024 } }),
  billItems: multer({ storage: makeStorage('bill-items'), fileFilter: imageFilter, limits: { fileSize: 30 * 1024 * 1024 } }),
  inspectionDocs: multer({ storage: makeStorage('inspection-docs'), fileFilter: docFilter, limits: { fileSize: 50 * 1024 * 1024 } }),
  drawings: multer({ storage: makeStorage('drawings'), fileFilter: pdfFilter, limits: { fileSize: 50 * 1024 * 1024 } }),
  ncr: multer({ storage: makeStorage('ncr'), fileFilter: imageFilter, limits: { fileSize: 10 * 1024 * 1024 } }),
  supplierResponse: multer({ storage: makeStorage('ncr'), fileFilter: docFilter, limits: { fileSize: 20 * 1024 * 1024 } }),
  general: multer({ storage: makeStorage('general'), fileFilter: docFilter, limits: { fileSize: 20 * 1024 * 1024 } }),
  logo: multer({ storage: makeStorage('general'), fileFilter: imageFilter, limits: { fileSize: 5 * 1024 * 1024 } }),
  uai: multer({ storage: makeStorage('uai'), fileFilter: imageFilter, limits: { fileSize: 10 * 1024 * 1024 } }),
  issueTalk: multer({ storage: makeStorage('issue-talk'), fileFilter: issueTalkFilter, limits: { fileSize: 100 * 1024 * 1024 } }),
};

// ===== Magic-number validation (DEVMORE C3) =====
// ตรวจ "เนื้อหาไฟล์จริง" ไม่เชื่อ extension/MIME จาก client + rename นามสกุลตาม magic
// กันอัปโหลด HTML/SVG ปลอม mimetype เป็นรูป (Stored XSS)
const MAGIC = [
  { ext: 'png',  test: b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 },
  { ext: 'jpg',  test: b => b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF },
  { ext: 'gif',  test: b => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 },
  { ext: 'webp', test: b => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 },
  { ext: 'pdf',  test: b => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 },
  { ext: 'mp4',  test: b => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 },      // ....ftyp
  { ext: 'webm', test: b => b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3 },
  { ext: 'avi',  test: b => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 },      // RIFF (ตรวจหลัง webp)
];

function detectExt(buf) {
  const m = MAGIC.find(x => { try { return x.test(buf); } catch { return false; } });
  return m ? m.ext : null;
}

function collectFiles(req) {
  if (req.files) return Array.isArray(req.files) ? req.files : Object.values(req.files).flat();
  return req.file ? [req.file] : [];
}

function cleanupFiles(files) {
  for (const f of files) { try { if (f?.path && fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch {} }
}

// Middleware: ใส่ต่อจาก multer ทุก upload route
function verifyMagic(req, res, next) {
  const files = collectFiles(req);
  for (const f of files) {
    let fd = null;
    try {
      const buf = Buffer.alloc(16);
      fd = fs.openSync(f.path, 'r');
      fs.readSync(fd, buf, 0, 16, 0);
      fs.closeSync(fd); fd = null;

      const ext = detectExt(buf);
      if (!ext) {
        cleanupFiles(files);
        return res.status(400).json({ error: 'ไฟล์ไม่ถูกต้อง: เนื้อหาไฟล์ไม่ตรงกับชนิดที่อนุญาต (รูปภาพ/PDF/วิดีโอ)' });
      }
      // บังคับนามสกุลให้ตรง magic — กันไฟล์ .svg/.html/.js ที่ execute ได้
      const desired = '.' + ext;
      if (path.extname(f.filename).toLowerCase() !== desired) {
        const newName = f.filename.replace(/\.[^.]*$/, '') + desired;
        const newPath = path.join(path.dirname(f.path), newName);
        fs.renameSync(f.path, newPath);
        f.filename = newName;
        f.path = newPath;
      }
    } catch (e) {
      if (fd !== null) { try { fs.closeSync(fd); } catch {} }
      cleanupFiles(files);
      return res.status(400).json({ error: 'ไม่สามารถตรวจสอบไฟล์ได้' });
    }
  }
  next();
}

module.exports = uploads;
module.exports.verifyMagic = verifyMagic;
module.exports.detectExt = detectExt; // สำหรับ unit test
