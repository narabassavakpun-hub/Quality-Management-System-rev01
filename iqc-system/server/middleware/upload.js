const multer = require('multer');
const path = require('path');
const fs = require('fs');

const UPLOADS_BASE = path.join(__dirname, '../../uploads');

// ===== Original filename encoding fix (multer/busboy quirk) =====
// busboy ถอดค่า filename จาก Content-Disposition header เป็น 'latin1' เสมอ (ตาม HTTP header spec ดั้งเดิม)
// แต่ browser ส่ง UTF-8 bytes ของชื่อไฟล์จริงมา — ชื่อไฟล์ที่ไม่ใช่ ASCII (เช่น ภาษาไทย) จึงถูก decode ผิด
// กลายเป็นตัวอักษรมั่ว (mojibake) ก่อนถูกเก็บเป็น original_name ใน DB
// แก้โดยตีความ string ที่ decode ผิดกลับเป็น byte เดิม แล้ว decode ใหม่เป็น utf8 (lossless round-trip
// เพราะ latin1 map byte 0-255 ↔ char code 0-255 ตรงตัว — ปลอดภัยแม้ชื่อไฟล์เป็น ASCII ล้วนอยู่แล้ว)
function fixOriginalName(name) {
  if (!name) return name;
  try { return Buffer.from(name, 'latin1').toString('utf8'); } catch { return name; }
}

function makeStorage(folder) {
  return multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(UPLOADS_BASE, folder);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      file.originalname = fixOriginalName(file.originalname);
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
  ipqc: multer({ storage: makeStorage('ipqc'), fileFilter: imageFilter, limits: { fileSize: 15 * 1024 * 1024 } }),
  fqc: multer({ storage: makeStorage('fqc'), fileFilter: imageFilter, limits: { fileSize: 15 * 1024 * 1024 } }),
  fgDefect: multer({ storage: makeStorage('fg-defect'), fileFilter: imageFilter, limits: { fileSize: 15 * 1024 * 1024 } }),
  fgFix:    multer({ storage: makeStorage('fg-fix'),    fileFilter: imageFilter, limits: { fileSize: 15 * 1024 * 1024 } }),
};

// Excel import (PDPlan / ProCodeSAP) — kept in memory, parsed then discarded
const xlsxUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    file.originalname = fixOriginalName(file.originalname); // memoryStorage ไม่มี filename callback — แก้ที่นี่แทน
    if (/\.xlsx?$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('รองรับเฉพาะไฟล์ Excel (.xlsx)'), false);
  },
});

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

// ===== Image Compression Middleware =====
// ลดขนาดรูปภาพหลัง verifyMagic — JPEG/PNG/WebP เท่านั้น (GIF/PDF/Video ข้าม)
// Max dimension: 1920px, คุณภาพ 82%, ใช้ compressed ก็ต่อเมื่อไฟล์เล็กกว่าต้นฉบับ

const COMPRESS_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp']);
const MAX_PX = 1920;

let sharp;
try { sharp = require('sharp'); } catch { sharp = null; }

async function compressImages(req, res, next) {
  if (!sharp) return next();
  const files = collectFiles(req);
  const imgs = files.filter(f => COMPRESS_EXTS.has(path.extname(f.filename).slice(1).toLowerCase()));
  if (!imgs.length) return next();

  await Promise.all(imgs.map(async f => {
    const ext = path.extname(f.filename).slice(1).toLowerCase();
    const tmp = f.path + '.comp';
    try {
      let pipeline = sharp(f.path)
        .rotate()  // auto-orient ตาม EXIF
        .resize(MAX_PX, MAX_PX, { fit: 'inside', withoutEnlargement: true });

      if (ext === 'png') {
        pipeline = pipeline.png({ compressionLevel: 8 });
      } else if (ext === 'webp') {
        pipeline = pipeline.webp({ quality: 82 });
      } else {
        pipeline = pipeline.jpeg({ quality: 82, progressive: true });
      }

      await pipeline.toFile(tmp);

      const newSize = fs.statSync(tmp).size;
      if (newSize < f.size) {
        fs.renameSync(tmp, f.path);
        f.size = newSize;
      } else {
        fs.unlinkSync(tmp); // compressed ใหญ่กว่า — คงต้นฉบับ
      }
    } catch (err) {
      console.error('[compressImages]', f.filename, err.message);
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
      // ไม่ crash — ใช้ไฟล์ต้นฉบับต่อไป
    }
  }));
  next();
}

// ===== Video Compression Middleware (Issue Talk) =====
// ลดขนาดวิดีโอหลัง verifyMagic — เฉพาะ mp4/webm (avi ข้าม เพราะเป็น container เก่า/หายาก ไม่คุ้มความซับซ้อนที่
// ต้อง maintain encode profile เพิ่ม) — ย่อความละเอียดสูงสุด 1280px ด้านยาว (ไม่ขยายถ้าเล็กกว่าอยู่แล้ว) + re-encode
// bitrate ต่ำลง ใช้ compressed ก็ต่อเมื่อไฟล์เล็กกว่าต้นฉบับจริง (pattern เดียวกับ compressImages ทุกอย่าง)
// รันทีละไฟล์ (ไม่ Promise.all แบบรูปภาพ) เพราะ ffmpeg transcode กิน CPU/RAM มากกว่า sharp resize เยอะ — ถ้ามีคน
// แนบวิดีโอหลายไฟล์ในข้อความเดียว (Issue Talk อนุญาตสูงสุด 10 ไฟล์) การรันขนาน 10 ffmpeg process พร้อมกันเสี่ยง
// CPU พุ่งเกินจำเป็น — ต้องมี ffmpeg binary ในระบบ (ดู Dockerfile runtime stage) ถ้าไม่มีจะ skip เงียบๆ ไม่ crash
const COMPRESS_VIDEO_EXTS = new Set(['mp4', 'webm']);
const MAX_VIDEO_PX = 1280;

let ffmpeg;
let ffmpegAvailable = false;
try {
  ffmpeg = require('fluent-ffmpeg');
  // เช็คว่ามี ffmpeg binary จริงบนเครื่อง/container นี้ไหม (fluent-ffmpeg เป็นแค่ wrapper เรียก CLI ข้างนอก
  // ไม่ได้ bundle binary มาด้วย) — เช็คครั้งเดียวตอน module load กันเรียก spawn ซ้ำทุก request โดยไม่จำเป็น
  const { execFileSync } = require('child_process');
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  ffmpegAvailable = true;
} catch {
  ffmpegAvailable = false;
}

function transcodeVideo(inputPath, outputPath, ext) {
  return new Promise((resolve, reject) => {
    let cmd = ffmpeg(inputPath)
      .videoFilters(`scale='min(${MAX_VIDEO_PX},iw)':-2`)
      .outputOptions(['-movflags +faststart']);

    if (ext === 'webm') {
      cmd = cmd.videoCodec('libvpx-vp9').outputOptions(['-crf 32', '-b:v 0']).audioCodec('libopus').audioBitrate('96k');
    } else {
      cmd = cmd.videoCodec('libx264').outputOptions(['-crf 28', '-preset medium']).audioCodec('aac').audioBitrate('128k');
    }

    cmd.on('end', resolve).on('error', reject).save(outputPath);
  });
}

async function compressVideo(req, res, next) {
  if (!ffmpegAvailable) return next();
  const files = collectFiles(req);
  const vids = files.filter(f => COMPRESS_VIDEO_EXTS.has(path.extname(f.filename).slice(1).toLowerCase()));
  if (!vids.length) return next();

  for (const f of vids) {
    const ext = path.extname(f.filename).slice(1).toLowerCase();
    const tmp = f.path + '.comp';
    try {
      await transcodeVideo(f.path, tmp, ext);
      const newSize = fs.statSync(tmp).size;
      if (newSize < f.size) {
        fs.renameSync(tmp, f.path);
        f.size = newSize;
      } else {
        fs.unlinkSync(tmp); // compressed ใหญ่กว่า — คงต้นฉบับ
      }
    } catch (err) {
      console.error('[compressVideo]', f.filename, err.message);
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
      // ไม่ crash — ใช้ไฟล์ต้นฉบับต่อไป
    }
  }
  next();
}

module.exports = uploads;
module.exports.verifyMagic = verifyMagic;
module.exports.compressImages = compressImages;
module.exports.compressVideo = compressVideo;
module.exports.detectExt = detectExt; // สำหรับ unit test
module.exports.xlsxUpload = xlsxUpload;
module.exports.fixOriginalName = fixOriginalName; // ใช้ซ้ำใน multer instance อื่นนอกไฟล์นี้ (เช่น routes/kpi.js, routes/master.js)
