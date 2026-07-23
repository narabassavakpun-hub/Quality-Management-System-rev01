const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const rateLimit = require('express-rate-limit');
const db = require('../db/database');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { FONT_FACE_CSS } = require('../lib/pdfFont');
const purchasingDashboardService = require('../services/purchasingDashboardService');

// BUG-006: 5 PDF exports per minute per IP (CLAUDE.md spec)
const pdfRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Export rate limit exceeded — ลองใหม่อีก 1 นาที' },
  standardHeaders: true,
  legacyHeaders: false,
});

const UPLOADS_BASE = path.join(__dirname, '../../uploads');
const PRIMARY = '1A3A5C';

// ===== HTML escape (กัน Stored XSS/HTML injection ใน PDF — DEVMORE C1) =====
// ทุกค่าที่มาจากผู้ใช้/Supplier ต้องผ่าน esc() ก่อนต่อเป็น HTML string เสมอ
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// วันที่แบบไทย DD/MM/BE (พ.ศ.) เช่น 2026-07-03 -> 03/07/2569 — ใช้ในหัวข้อ "รับเมื่อวันที่"
function thShortDate(dateStr) {
  if (!dateStr) return '-';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
// อนุญาตเฉพาะ data-url รูปภาพจริงสำหรับ <img src> ของลายเซ็น (กัน attribute breakout/SSRF)
function safeSig(dataUrl) {
  return /^data:image\/(png|jpe?g);base64,[A-Za-z0-9+/=]+$/.test(dataUrl || '') ? dataUrl : '';
}
// DEVMORE M2 — ลายเซ็นอาจเป็น data-url (legacy) หรือ filename (ใหม่) → คืน data-url ที่ inline ลง PDF ได้
function sigDataUrl(v) {
  if (!v) return '';
  if (v.startsWith('data:')) return safeSig(v);
  return imgToBase64('uai', v) || '';
}

function headerStyle(ws, row, count) {
  for (let col = 1; col <= count; col++) {
    const cell = ws.getCell(row, col);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + PRIMARY } };
    cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  }
}

function autoWidth(ws) {
  ws.columns.forEach(col => {
    let max = 10;
    col.eachCell({ includeEmpty: true }, cell => {
      const len = cell.value ? String(cell.value).length : 0;
      if (len > max) max = len;
    });
    col.width = Math.min(max + 2, 60);
  });
}

function statusLabel(status) {
  const map = {
    draft: 'ร่าง', pending_approval: 'รออนุมัติ', approved: 'อนุมัติแล้ว',
    pending_supervisor: 'รอหัวหน้า QC', pending_manager: 'รอ QC Manager',
    pending_qmr_open: 'รอ QMR เปิด', pending_purchasing_review: 'รอจัดซื้อ Review',
    pending_purchasing_manager_review: 'รอผู้จัดการจัดซื้อตรวจสอบ', pending_supplier: 'รอ Supplier',
    pending_manager_review: 'รอ Manager ตรวจ', pending_supplier_resubmit: 'ถูกส่งกลับ', pending_qmr_close: 'รอ QMR ปิด',
    pending_staff_revision: 'ส่งกลับแก้ไข (QC รับเข้า)',
    closed: 'ปิดแล้ว', pending_uai: 'รอดำเนินการ UAI', uai_pending_qc_manager: 'UAI รอ QC Manager',
    uai_pending_purchasing: 'UAI รอจัดซื้อ', uai_pending_cco: 'UAI รอ COO',
    uai_pending_cmo: 'UAI รอ CMO', uai_pending_cpo: 'UAI รอ CPO',
    uai_pending_qc_ack: 'UAI รอ QC รับทราบ', uai_pending_production_ack: 'UAI รอผลิตรับทราบ',
    uai_pending_qmr_ack: 'UAI รอ QMR รับทราบ', uai_completed: 'UAI เสร็จสมบูรณ์',
    uai_rejected: 'UAI ปฏิเสธ',
  };
  return map[status] || status;
}

// DEVMORE M12 — จำกัด PDF ที่ generate พร้อมกัน (แต่ละครั้งเปิด Chromium → กัน RAM/CPU พุ่ง)
const MAX_PDF_CONCURRENT = 2;
let pdfActive = 0;
const pdfWaiters = [];
function acquirePdfSlot() {
  if (pdfActive < MAX_PDF_CONCURRENT) { pdfActive++; return Promise.resolve(); }
  return new Promise(resolve => pdfWaiters.push(resolve));
}
function releasePdfSlot() {
  const next = pdfWaiters.shift();
  if (next) next();          // ส่งต่อ slot ให้คิวถัดไป (pdfActive คงเดิม)
  else pdfActive--;
}

// ===== Singleton Chromium — reuse ข้าม request (ไม่ launch ใหม่ทุกครั้ง → เร็วขึ้นมาก) =====
let _browserPromise = null;
function _launchBrowser() {
  let puppeteer;
  try { puppeteer = require('puppeteer'); } catch (_) {
    const hpnDir = path.dirname(require.resolve('html-pdf-node'));
    puppeteer = require(path.join(hpnDir, 'node_modules', 'puppeteer'));
  }
  return puppeteer.launch({
    headless: true,
    // Docker/production: ใช้ Chromium ของระบบ (apt) ผ่าน PUPPETEER_EXECUTABLE_PATH; dev: undefined = ใช้ที่ puppeteer ดาวน์โหลด
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    // index.js เป็นผู้คุม graceful shutdown เอง (ปิด browser ใน shutdown) → ปิด signal handler ของ puppeteer กันชนกัน
    handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', // กัน /dev/shm เต็มใน container (เขียนลง /tmp แทน)
      '--disable-gpu',
    ],
  });
}
async function getBrowser() {
  if (_browserPromise) {
    try {
      const b = await _browserPromise;
      const ok = typeof b.isConnected === 'function' ? b.isConnected() : b.connected;
      if (ok) return b;
    } catch (_) { /* ตกลงมา relaunch */ }
  }
  _browserPromise = _launchBrowser();
  const b = await _browserPromise;
  b.on('disconnected', () => { _browserPromise = null; });
  return b;
}
// ปิด Chromium singleton (เรียกตอน graceful shutdown ใน index.js)
async function closeBrowser() {
  if (!_browserPromise) return;
  const p = _browserPromise;
  _browserPromise = null;
  try { const b = await p; await b.close(); } catch (_) {}
}

// เปิด page ใน incognito context แยกต่อ request (กัน state รั่วข้ามผู้ใช้) + retry 1 ครั้งถ้า browser หลุด
async function openIsolatedPage() {
  const attempt = async () => {
    const browser = await getBrowser();
    const create = browser.createBrowserContext
      ? browser.createBrowserContext.bind(browser)            // puppeteer ใหม่
      : browser.createIncognitoBrowserContext.bind(browser);  // puppeteer เก่า
    const context = await create();
    const page = await context.newPage();
    return { page, context };
  };
  try {
    return await attempt();
  } catch (_) {
    _browserPromise = null; // browser อาจหลุด → บังคับ relaunch แล้วลองใหม่ 1 ครั้ง
    return await attempt();
  }
}

// ปิด context (ปิด page ในตัว) แบบมี timeout + ไม่ throw — รับประกัน releasePdfSlot ได้ทำงานเสมอ (กัน slot รั่ว)
async function closeIsolated(context) {
  if (!context) return;
  try {
    await Promise.race([
      context.close(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('context.close timeout')), 5000)),
    ]);
  } catch (e) {
    console.error('[pdf] ปิด context ไม่สำเร็จ:', e.message);
  }
}

function getCompanyHeader() {
  const name    = db.getSetting('company_name')    || '';
  const address = db.getSetting('company_address') || '';
  const logoFile = db.getSetting('company_logo')   || '';

  let logoHtml = '';
  if (logoFile) {
    const src = imgToBase64('general', logoFile);
    if (src) logoHtml = `<img src="${src}" style="max-height:54px;max-width:160px;object-fit:contain;flex-shrink:0;" />`;
  }

  if (!name && !logoHtml) return '';

  return `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;padding-bottom:10px;border-bottom:2px solid #1A3A5C;">
      ${logoHtml}
      <div>
        ${name    ? `<div style="font-size:14px;font-weight:700;color:#1A3A5C;">${esc(name)}</div>` : ''}
        ${address ? `<div style="font-size:10px;color:#6B7280;white-space:pre-line;">${esc(address)}</div>` : ''}
      </div>
    </div>`;
}

// ===== Paginated PDF (หัวเอกสารซ้ำทุกหน้า + เลขหน้า current/total) — ใช้ร่วมทุก PDF เอกสาร =====
function docHeaderTemplate(title, dateRange) {
  const name = db.getSetting('company_name') || '';
  const logoFile = db.getSetting('company_logo') || '';
  const logoSrc = logoFile ? (imgToBase64('general', logoFile) || '') : '';
  // หมายเหตุ: header/footer ไม่ฝัง @font-face (data-URI ในเทมเพลตทำให้ printToPDF ค้างเป็นบางครั้ง)
  // ใช้ระบบฟอนต์ไทย (Tahoma/Leelawadee) แทน — ข้อความหัว/ท้ายสั้น ๆ พอ; เนื้อหา body ยังใช้ IBM Plex ฝัง
  return `
    <div style="font-family:'IBM Plex Sans Thai','Tahoma','Leelawadee UI',sans-serif;width:100%;padding:0 12mm;box-sizing:border-box;color:#1F2937;">
      <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px;border-bottom:2px solid #1A3A5C;padding-bottom:5px;">
        <div style="display:flex;align-items:flex-end;gap:10px;">
          ${logoSrc ? `<img src="${logoSrc}" style="max-height:32px;max-width:120px;object-fit:contain;" />` : ''}
          <div style="line-height:1.35;">
            ${name ? `<div style="font-size:11px;font-weight:700;color:#1A3A5C;">${esc(name)}</div>` : ''}
            <div style="font-size:8px;color:#6B7280;">${dateRange ? `ช่วงวันที่: ${esc(dateRange)} &nbsp;|&nbsp; ` : ''}Export: ${new Date().toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Bangkok' })}</div>
          </div>
        </div>
        <div style="font-size:11px;font-weight:700;color:#1A3A5C;text-align:right;white-space:nowrap;">${esc(title)}</div>
      </div>
    </div>`;
}
// เลขหน้า current/total เช่น "หน้า 1/2"
const PAGE_FOOTER_TEMPLATE = `<div style="font-family:'IBM Plex Sans Thai','Tahoma','Leelawadee UI',sans-serif;font-size:9px;color:#6B7280;width:100%;text-align:center;">หน้า <span class="pageNumber"></span>/<span class="totalPages"></span></div>`;

// ชื่อเอกสารตัวใหญ่กลางหน้า บนสุดของ body (ไม่มีเลขที่เอกสาร — เลขที่แสดงที่หัวกระดาษ/running header อยู่แล้ว)
function docTitleHtml(name) {
  return `<div style="font-size:22px;font-weight:700;color:#1A3A5C;text-align:center;margin:0 0 18px;">${esc(name)}</div>`;
}

async function renderDocPdf({ title, dateRange = '', bodyHtml, landscape = false }) {
  const html = `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>${esc(title)}</title><style>
    ${FONT_FACE_CSS}
    body { font-family: 'IBM Plex Sans Thai', sans-serif; font-size: 12px; color: #1F2937; margin: 0; }
    h1, h2 { color: #1A3A5C; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
    thead { display: table-header-group; }
    th { background: #1A3A5C; color: #fff; padding: 6px 8px; font-size: 11px; text-align: left; }
    td { padding: 5px 8px; border-bottom: 1px solid #E5E7EB; font-size: 11px; word-break: break-word; overflow-wrap: break-word; }
    tr { page-break-inside: avoid; }
    tr:nth-child(even) td { background: #F9FAFB; }
    .badge-pass { color: #16A34A; font-weight: 600; }
    .badge-fail { color: #DC2626; font-weight: 600; }
    .section-title { font-size: 14px; font-weight: 700; color: #1A3A5C; margin: 16px 0 8px; border-bottom: 2px solid #1A3A5C; padding-bottom: 4px; page-break-after: avoid; }
    .section-title:first-child { margin-top: 0; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; margin-bottom: 12px; }
    .info-row { font-size: 11px; } .info-label { color: #6B7280; } .info-value { font-weight: 600; white-space: pre-wrap; word-break: break-word; overflow-wrap: break-word; }
    .signature-box { border: 1px solid #D1D5DB; padding: 8px; text-align: center; min-height: 80px; }
    .sig-img { max-width: 160px; max-height: 60px; }
  </style></head><body>${bodyHtml}</body></html>`;

  await acquirePdfSlot();
  let ctx;
  try {
    const { page, context } = await openIsolatedPage();
    ctx = context;
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => { await document.fonts.ready; });
    return await page.pdf({
      format: 'A4',
      landscape,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: docHeaderTemplate(title, dateRange),
      footerTemplate: PAGE_FOOTER_TEMPLATE,
      margin: { top: '30mm', bottom: '14mm', left: '12mm', right: '12mm' },
    });
  } finally {
    await closeIsolated(ctx);
    releasePdfSlot();
  }
}

// helper: อ่านรูปเป็น base64 inline src
function imgToBase64(folder, filePath) {
  const fullPath = path.join(UPLOADS_BASE, folder, filePath);
  if (!fs.existsSync(fullPath)) return null;
  const base64 = fs.readFileSync(fullPath).toString('base64');
  const mime = filePath.match(/\.png$/i) ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${base64}`;
}

// ===== NCR PROCESS LABEL (shared between PDF and Excel) =====
function getNcrProcessLabel(a, allApprovals, idx, severity) {
  if (a.action === 'rejected_response') return 'QC Manager ไม่อนุมัติคำตอบ Supplier';
  if (a.action === 'resubmit') return 'จัดซื้อส่ง Supplier ตอบใหม่';
  if (a.role === 'qc_supervisor') return severity === 'minor' ? 'หัวหน้า QC อนุมัติปิด NCP' : 'หัวหน้า QC ตรวจสอบ NCR';
  if (a.role === 'qc_manager') return 'QC Manager พิจารณาอนุมัติ';
  if (a.role === 'qmr') {
    const qmrsBefore = allApprovals.slice(0, idx).filter(x => x.role === 'qmr').length;
    return qmrsBefore === 0 ? 'QMR อนุมัติเปิด NCR' : 'QMR อนุมัติปิด NCR';
  }
  if (a.role === 'purchasing') return 'จัดซื้อ ส่ง Link Supplier';
  return a.role;
}

// ===== BILL EXPORTS =====
router.get('/bill/:id/pdf', auth, pdfRateLimit, async (req, res) => {
  const bill = db.prepare(`
    SELECT b.*, s.name as supplier_name, u.full_name as created_by_name
    FROM bills b
    LEFT JOIN suppliers s ON s.id = b.supplier_id
    LEFT JOIN users u ON u.id = b.created_by
    WHERE b.id = ?
  `).get(req.params.id);
  if (!bill) return res.status(404).json({ error: 'ไม่พบบิล' });
  if (bill.status !== 'approved') return res.status(400).json({ error: 'Export ได้เฉพาะบิลที่ผ่านการอนุมัติแล้ว' });

  const items = db.prepare(`
    SELECT bi.*, p.name as product_name, p.code as product_code,
           dc.name as defect_category_name, pg.name as product_group_name
    FROM bill_items bi
    LEFT JOIN products p ON p.id = bi.product_id
    LEFT JOIN defect_categories dc ON dc.id = bi.defect_category_id
    LEFT JOIN product_groups pg ON pg.id = p.product_group_id
    WHERE bi.bill_id = ? ORDER BY bi.id
  `).all(req.params.id);

  for (const item of items) {
    item.images = db.prepare('SELECT * FROM bill_item_images WHERE bill_item_id = ?').all(item.id);
  }

  const billImages = db.prepare('SELECT * FROM bill_images WHERE bill_id = ?').all(req.params.id);

  const totalReceived = items.reduce((s, it) => s + (it.qty_received || 0), 0);
  const totalFailed   = items.reduce((s, it) => s + (it.qty_failed   || 0), 0);
  const passRate = totalReceived > 0
    ? ((1 - totalFailed / totalReceived) * 100).toFixed(1) + '%'
    : '-';

  const billImgTags = billImages.map(img => {
    const src = imgToBase64('bills', img.file_path);
    return src ? `<img src="${src}" style="width:120px;height:90px;object-fit:cover;border:1px solid #E5E7EB;border-radius:4px;margin:2px;" />` : '';
  }).filter(Boolean);

  const billImagesHtml = billImgTags.length
    ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;">${billImgTags.join('')}</div>`
    : '';

  const itemsHtml = items.map((item, i) => {
    const hasFail = item.qty_failed > 0;
    const imgTags = item.images.map(img => {
      const src = imgToBase64('bill-items', img.file_path);
      return src ? `<img src="${src}" style="width:72px;height:54px;object-fit:cover;border:1px solid #E5E7EB;border-radius:3px;" />` : '';
    }).filter(Boolean);
    return `
      <tr style="${hasFail ? 'background:#FEF2F2;' : ''}">
        <td>${i + 1}</td>
        <td>
          <div style="font-weight:600;">${esc(item.product_name || item.item_name || '-')}</div>
          ${item.product_group_name ? `<div style="font-size:10px;color:#6B7280;">${esc(item.product_group_name)}</div>` : ''}
        </td>
        <td style="text-align:center;">${esc(item.qty_received)}</td>
        <td style="text-align:center;">${esc(item.qty_sampled)}</td>
        <td style="text-align:center;color:#16A34A;font-weight:600;">${esc(item.qty_passed)}</td>
        <td style="text-align:center;${hasFail ? 'color:#DC2626;font-weight:700;' : ''}">${esc(item.qty_failed)}</td>
        <td>${hasFail ? esc(item.defect_category_name || '-') : '<span style="color:#16A34A;">ผ่าน</span>'}</td>
        <td style="font-size:10px;">${hasFail ? esc(item.defect_detail || '-') : '-'}</td>
        <td>${imgTags.length ? `<div style="display:flex;flex-wrap:wrap;gap:3px;">${imgTags.join('')}</div>` : '-'}</td>
      </tr>`;
  }).join('');

  const body = `
    <div class="section-title">ข้อมูลบิล</div>
    <div class="info-grid">
      <div class="info-row"><span class="info-label">Invoice No.: </span><span class="info-value">${esc(bill.invoice_no)}</span></div>
      <div class="info-row"><span class="info-label">PO No.: </span><span class="info-value">${esc(bill.po_no)}</span></div>
      <div class="info-row"><span class="info-label">Supplier: </span><span class="info-value">${esc(bill.supplier_name || '-')}</span></div>
      <div class="info-row"><span class="info-label">วันที่รับเข้า: </span><span class="info-value">${esc(bill.received_date)}</span></div>
      <div class="info-row"><span class="info-label">Container No.: </span><span class="info-value">${esc(bill.container_no || '-')}</span></div>
      <div class="info-row"><span class="info-label">Tracking No.: </span><span class="info-value">${esc(bill.tracking_no || '-')}</span></div>
      <div class="info-row"><span class="info-label">ผู้ออกเอกสาร: </span><span class="info-value">${esc(bill.created_by_name || '-')}</span></div>
      <div class="info-row"><span class="info-label">อัตราผ่าน: </span><span class="info-value">${esc(passRate)}</span></div>
    </div>
    ${billImagesHtml ? `<div class="section-title">รูปถ่ายบิล</div>${billImagesHtml}` : ''}
    <div class="section-title">รายการสินค้า (${items.length} รายการ)</div>
    <table>
      <tr><th>#</th><th>สินค้า</th><th>รับเข้า</th><th>สุ่มตรวจ</th><th>ผ่าน</th><th>ไม่ผ่าน</th><th>กลุ่มปัญหา</th><th>รายละเอียด</th><th>รูปภาพ</th></tr>
      ${itemsHtml || '<tr><td colspan="9" style="text-align:center;color:#6B7280;">ไม่มีรายการสินค้า</td></tr>'}
    </table>
  `;

  try {
    const pdf = await renderDocPdf({ title: `บิลรับเข้า — ${bill.invoice_no}`, bodyHtml: body });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Bill-${encodeURIComponent(bill.invoice_no)}.pdf"`);
    res.send(pdf);
  } catch (e) {
    res.status(500).json({ error: 'ไม่สามารถ export PDF ได้: ' + e.message });
  }
});

router.get('/bill/:id/excel', auth, async (req, res) => {
  try {
    const bill = db.prepare(`
      SELECT b.*, s.name as supplier_name, u.full_name as created_by_name
      FROM bills b
      LEFT JOIN suppliers s ON s.id = b.supplier_id
      LEFT JOIN users u ON u.id = b.created_by
      WHERE b.id = ?
    `).get(req.params.id);
    if (!bill) return res.status(404).json({ error: 'ไม่พบบิล' });
    if (bill.status !== 'approved') return res.status(400).json({ error: 'Export ได้เฉพาะบิลที่ผ่านการอนุมัติแล้ว' });

    const items = db.prepare(`
      SELECT bi.*, p.name as product_name, p.code as product_code,
             dc.name as defect_category_name, pg.name as product_group_name
      FROM bill_items bi
      LEFT JOIN products p ON p.id = bi.product_id
      LEFT JOIN defect_categories dc ON dc.id = bi.defect_category_id
      LEFT JOIN product_groups pg ON pg.id = p.product_group_id
      WHERE bi.bill_id = ? ORDER BY bi.id
    `).all(req.params.id);

    const wb = new ExcelJS.Workbook();

    // Sheet 1: ข้อมูลบิล
    const ws1 = wb.addWorksheet('ข้อมูลบิล');
    ws1.addRow(['ฟิลด์', 'ข้อมูล']);
    headerStyle(ws1, 1, 2);
    const totalReceived = items.reduce((s, it) => s + (it.qty_received || 0), 0);
    const totalFailed   = items.reduce((s, it) => s + (it.qty_failed   || 0), 0);
    const passRate = totalReceived > 0
      ? ((1 - totalFailed / totalReceived) * 100).toFixed(1) + '%' : '-';
    [
      ['Invoice No.',      bill.invoice_no],
      ['PO No.',           bill.po_no],
      ['Container No.',    bill.container_no || '-'],
      ['Tracking No.',     bill.tracking_no  || '-'],
      ['Supplier',         bill.supplier_name || '-'],
      ['วันที่รับเข้า',    bill.received_date],
      ['ผู้ออกเอกสาร',    bill.created_by_name || '-'],
      ['จำนวนรายการ',      items.length],
      ['รับเข้ารวม',       totalReceived],
      ['ไม่ผ่านรวม',       totalFailed],
      ['อัตราผ่าน',        passRate],
    ].forEach(row => ws1.addRow(row));
    autoWidth(ws1);

    // Sheet 2: รายการสินค้า
    const ws2 = wb.addWorksheet('รายการสินค้า');
    ws2.addRow(['#', 'รหัสสินค้า', 'ชื่อสินค้า', 'กลุ่มสินค้า', 'รับเข้า', 'สุ่มตรวจ', 'ผ่าน', 'ไม่ผ่าน', 'ผลตรวจ', 'กลุ่มปัญหา', 'รายละเอียดปัญหา']);
    headerStyle(ws2, 1, 11);
    items.forEach((item, i) => {
      ws2.addRow([
        i + 1,
        item.product_code || '-',
        item.product_name || item.item_name || '-',
        item.product_group_name || '-',
        item.qty_received,
        item.qty_sampled,
        item.qty_passed,
        item.qty_failed,
        item.qty_failed > 0 ? 'ไม่ผ่าน' : 'ผ่าน',
        item.qty_failed > 0 ? (item.defect_category_name || '-') : '-',
        item.qty_failed > 0 ? (item.defect_detail || '-') : '-',
      ]);
    });
    autoWidth(ws2);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Bill-${encodeURIComponent(bill.invoice_no)}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: 'Export ไม่สำเร็จ: ' + e.message });
  }
});

// ===== NCR EXPORTS =====
router.get('/ncr/:id/pdf', auth, pdfRateLimit, async (req, res) => {
  const ncr = db.prepare(`
    SELECT n.*, s.name as supplier_name, u.full_name as created_by_name,
           b.invoice_no, b.po_no, b.received_date, bu.full_name as bill_received_by_name
    FROM ncrs n
    LEFT JOIN bills b ON b.id = n.bill_id
    LEFT JOIN suppliers s ON s.id = b.supplier_id
    LEFT JOIN users u ON u.id = n.created_by
    LEFT JOIN users bu ON bu.id = b.created_by
    WHERE n.id = ?
  `).get(req.params.id);
  if (!ncr) return res.status(404).json({ error: 'ไม่พบ NCR' });

  if (ncr.purchasing_received_by) {
    const pu = db.prepare('SELECT full_name FROM users WHERE id = ?').get(ncr.purchasing_received_by);
    ncr.purchasing_received_by_name = pu?.full_name || null;
  }
  if (ncr.link_copied_by) {
    const lu = db.prepare('SELECT full_name FROM users WHERE id = ?').get(ncr.link_copied_by);
    ncr.link_copied_by_name = lu?.full_name || null;
  }

  // ncr_items พร้อม defect category, รหัสสินค้า และรูปจาก bill_item_images
  const ncrItems = db.prepare(`
    SELECT ni.*, dc.name as defect_category_name, p.code as product_code
    FROM ncr_items ni
    LEFT JOIN defect_categories dc ON dc.id = ni.defect_category_id
    LEFT JOIN bill_items bi ON bi.id = ni.bill_item_id
    LEFT JOIN products p ON p.id = bi.product_id
    WHERE ni.ncr_id = ?
  `).all(ncr.id);

  for (const item of ncrItems) {
    item.bill_item_images = item.bill_item_id
      ? db.prepare('SELECT * FROM bill_item_images WHERE bill_item_id = ?').all(item.bill_item_id)
      : [];
  }

  // รูปเพิ่มเติมที่แนบตอนออก NCR
  const ncrImages = db.prepare('SELECT * FROM ncr_images WHERE ncr_id = ?').all(ncr.id);

  const approvals = db.prepare(`
    SELECT na.*, u.full_name FROM ncr_approvals na
    LEFT JOIN users u ON u.id = na.user_id
    WHERE na.ncr_id = ? ORDER BY na.created_at
  `).all(ncr.id);

  const supplierResp = db.prepare('SELECT * FROM supplier_responses WHERE ncr_id = ? AND superseded_at IS NULL ORDER BY id DESC LIMIT 1').get(ncr.id);

  // รวม timeline events: approvals + supplier response + purchasing actions เรียง timestamp
  const timelineEvents = [
    ...approvals.map(a => ({ type: 'approval', ts: a.created_at, data: a })),
    ...(supplierResp ? [{ type: 'supplier', ts: supplierResp.submitted_at, data: supplierResp }] : []),
    ...(ncr.purchasing_received_at ? [{ type: 'purchasing_received', ts: ncr.purchasing_received_at, data: { name: ncr.purchasing_received_by_name } }] : []),
    ...(ncr.link_copied_at ? [{ type: 'link_copied', ts: ncr.link_copied_at, data: { name: ncr.link_copied_by_name, count: ncr.link_copied_count } }] : []),
  ].sort((a, b) => new Date(a.ts) - new Date(b.ts));
  const supplierAttachments = supplierResp
    ? db.prepare('SELECT * FROM supplier_response_attachments WHERE response_id = ?').all(supplierResp.id)
    : [];

  // อ่าน layout settings
  const ncrImgCols     = parseInt(db.getSetting('ncr_img_cols')      || '3');
  const ncrImgMaxWidth = parseInt(db.getSetting('ncr_img_max_width') || '180');
  const ncrImgMaxHeight = Math.round(ncrImgMaxWidth * 0.75);

  // สร้าง HTML รายการสินค้า + รูปภาพปัญหา
  // รูป ≤2 → อยู่ข้อมูลด้านขวา, รูป >2 → อยู่ด้านล่าง (grid)
  const itemsHtml = ncrItems.map((item, i) => {
    const imgs = (item.bill_item_images || [])
      .map(img => imgToBase64('bill-items', img.file_path))
      .filter(Boolean);
    const sideBySide = imgs.length >= 1 && imgs.length <= 2;

    const infoHtml = `
      <div style="font-weight:700;font-size:12px;margin-bottom:4px;">${i + 1}. ${esc(item.item_name)}</div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:11px;">
        <div><span style="color:#6B7280;">รับเข้า: </span><strong>${esc(item.qty_received)}</strong></div>
        <div><span style="color:#6B7280;">สุ่มตรวจ: </span><strong>${esc(item.qty_sampled)}</strong></div>
        <div><span style="color:#6B7280;">ไม่ผ่าน: </span><strong style="color:#DC2626;">${esc(item.qty_failed)}</strong></div>
      </div>
      ${item.defect_category_name ? `<div style="font-size:11px;margin-top:2px;"><span style="color:#6B7280;">กลุ่มปัญหา: </span>${esc(item.defect_category_name)}</div>` : ''}
      ${item.defect_detail ? `<div style="font-size:11px;"><span style="color:#6B7280;">รายละเอียด: </span>${esc(item.defect_detail)}</div>` : ''}
      ${item.product_code ? `<div style="font-size:11px;font-weight:700;margin-top:2px;">(รหัสสินค้า: ${esc(item.product_code)})</div>` : ''}`;

    if (sideBySide) {
      const sideImgs = imgs.map(src => `<img src="${src}" style="width:130px;max-height:${ncrImgMaxHeight}px;object-fit:cover;border:1px solid #E5E7EB;border-radius:4px;" />`).join('');
      return `
        <div style="border:1px solid #E5E7EB;border-radius:6px;margin-bottom:12px;overflow:hidden;page-break-inside:avoid;">
          <div style="background:#FEF2F2;padding:8px 12px;display:flex;gap:12px;align-items:flex-start;">
            <div style="flex:1;min-width:0;">${infoHtml}</div>
            <div style="display:flex;gap:6px;flex-shrink:0;">${sideImgs}</div>
          </div>
        </div>`;
    }

    const belowImgs = imgs.length
      ? `<div style="padding:8px 12px;background:#fff;"><div style="display:grid;grid-template-columns:repeat(${ncrImgCols},1fr);gap:6px;">${imgs.map(src => `<img src="${src}" style="width:100%;max-height:${ncrImgMaxHeight}px;object-fit:cover;border:1px solid #E5E7EB;border-radius:4px;" />`).join('')}</div></div>`
      : '';
    return `
      <div style="border:1px solid #E5E7EB;border-radius:6px;margin-bottom:12px;overflow:hidden;page-break-inside:avoid;">
        <div style="background:#FEF2F2;padding:8px 12px;">${infoHtml}</div>
        ${belowImgs}
      </div>`;
  }).join('');

  // รูปเพิ่มเติม NCR
  const extraNcrImgTags = ncrImages
    .map(img => {
      const src = imgToBase64('ncr', img.file_path);
      return src ? `<img src="${src}" style="width:100%;max-height:${ncrImgMaxHeight}px;object-fit:cover;border:1px solid #E5E7EB;border-radius:4px;" />` : '';
    })
    .filter(Boolean);
  const extraImgsHtml = extraNcrImgTags.length
    ? `<div style="display:grid;grid-template-columns:repeat(${ncrImgCols},1fr);gap:6px;">${extraNcrImgTags.join('')}</div>`
    : '';

  const approvalOnlyList = timelineEvents.filter(e => e.type === 'approval').map(e => e.data);
  const approvalsHtml = timelineEvents.map((ev) => {
    if (ev.type === 'purchasing_received') {
      return `<tr style="background:#F0FDFA;"><td style="color:#0F766E;font-weight:600;">จัดซื้อได้รับเอกสาร NCR</td><td>${esc(ev.data.name || 'จัดซื้อ')}</td><td>purchasing</td><td>-</td><td>${new Date(ev.ts + 'Z').toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}</td></tr>`;
    }
    if (ev.type === 'link_copied') {
      const countNote = ev.data.count > 1 ? ` (คัดลอก ${esc(ev.data.count)} ครั้ง)` : '';
      return `<tr style="background:#FFFBEB;"><td style="color:#D97706;font-weight:600;">จัดซื้อ Copy Link ให้ Supplier</td><td>${esc(ev.data.name || 'จัดซื้อ')}</td><td>purchasing</td><td>ล่าสุด${countNote}</td><td>${new Date(ev.ts + 'Z').toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}</td></tr>`;
    }
    if (ev.type === 'supplier') {
      const sr = ev.data;
      const detailLines = [
        sr.root_cause ? `<b>สาเหตุของปัญหา:</b> ${esc(sr.root_cause)}` : '',
        sr.corrective_action ? `<b>การแก้ไขปัญหา:</b> ${esc(sr.corrective_action)}` : '',
        sr.preventive_action ? `<b>การป้องกันปัญหา:</b> ${esc(sr.preventive_action)}` : '',
      ].filter(Boolean).join('<br>');
      const responder = sr.respondent_name ? `${esc(sr.respondent_name)}${ncr.supplier_name ? ` (${esc(ncr.supplier_name)})` : ''}` : esc(ncr.supplier_name || 'Supplier');
      return `<tr style="background:#FFF7ED;"><td style="color:#EA580C;font-weight:600;">Supplier ตอบกลับ</td><td>${responder}</td><td>supplier</td><td style="line-height:1.6;">${detailLines || '-'}</td><td>${new Date(sr.submitted_at + 'Z').toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}</td></tr>`;
    }
    const a = ev.data;
    const idx = approvalOnlyList.findIndex(x => x.id === a.id);
    const process = getNcrProcessLabel(a, approvalOnlyList, idx, ncr.severity);
    const isReject = a.action === 'rejected_response';
    const rowStyle = isReject ? 'background:#FEF2F2;' : '';
    const labelColor = isReject ? '#DC2626' : '#2E6DA4';
    return `<tr style="${rowStyle}"><td style="color:${labelColor};font-weight:600;">${esc(process)}</td><td>${esc(a.full_name || '-')}</td><td>${esc(a.role)}</td><td>${esc(a.comment || '-')}</td><td>${new Date(a.created_at + 'Z').toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}</td></tr>`;
  }).join('');

  // รูปหลักฐานการแก้ไข: ≤2 → อยู่ข้อมูลด้านขวา, >2 → อยู่ด้านล่าง (หลักการเดียวกับรายการสินค้า)
  const respImgs = supplierAttachments
    .map(att => imgToBase64('ncr', att.file_path))
    .filter(Boolean);
  const respSideBySide = respImgs.length >= 1 && respImgs.length <= 2;

  const respFieldsHtml = supplierResp ? `
      ${supplierResp.respondent_name ? `<div style="margin-bottom:6px;font-size:11px;"><span style="color:#6B7280;">ผู้ตอบ (Respondent): </span><span style="font-weight:600;">${esc(supplierResp.respondent_name)}</span></div>` : ''}
      <div style="margin-bottom:6px;font-size:11px;">
        <span style="color:#6B7280;">สาเหตุหลัก (Root Cause): </span>
        <span style="font-weight:600;">${esc(supplierResp.root_cause || '-')}</span>
      </div>
      <div style="margin-bottom:6px;font-size:11px;">
        <span style="color:#6B7280;">การแก้ไข (Corrective Action): </span>
        <span style="font-weight:600;">${esc(supplierResp.corrective_action || '-')}</span>
      </div>
      <div style="margin-bottom:6px;font-size:11px;">
        <span style="color:#6B7280;">การป้องกัน (Preventive Action): </span>
        <span style="font-weight:600;">${esc(supplierResp.preventive_action || '-')}</span>
      </div>
      <div style="font-size:11px;">
        <span style="color:#6B7280;">วันที่แก้ไขแล้วเสร็จ: </span>
        <span style="font-weight:600;">${esc(supplierResp.completion_date || '-')}</span>
      </div>` : '';

  const respHtml = supplierResp ? `
    <div class="section-title">คำตอบ Supplier</div>
    ${respSideBySide ? `
      <div style="border:1px solid #D1FAE5;border-radius:6px;padding:12px;background:#F0FDF4;margin-bottom:12px;display:flex;gap:12px;align-items:flex-start;">
        <div style="flex:1;min-width:0;">${respFieldsHtml}</div>
        <div style="display:flex;gap:6px;flex-shrink:0;">${respImgs.map(src => `<img src="${src}" style="width:150px;max-height:150px;object-fit:cover;border:1px solid #E5E7EB;border-radius:4px;" />`).join('')}</div>
      </div>
    ` : `
      <div style="border:1px solid #D1FAE5;border-radius:6px;padding:12px;background:#F0FDF4;margin-bottom:12px;">${respFieldsHtml}</div>
      ${respImgs.length ? `
        <div style="font-size:11px;color:#6B7280;margin-bottom:4px;">หลักฐานการแก้ไข (${respImgs.length} ไฟล์)</div>
        <div>${respImgs.map(src => `<img src="${src}" style="max-width:200px;max-height:150px;margin:4px;border:1px solid #E5E7EB;border-radius:4px;" />`).join('')}</div>
      ` : ''}
    `}
  ` : '';

  // NCP (minor) ใช้เทมเพลต/หัวกระดาษเดียวกับ NCR แต่ป้ายชื่อเอกสารตามชนิดจริง
  const docType = ncr.severity === 'minor' ? 'NCP' : 'NCR';

  const body = `
    ${docTitleHtml('เอกสาร Non-Conformance Report(NCR)')}
    <div class="section-title">ข้อมูล ${docType}</div>
    <div class="info-grid">
      <div class="info-row"><span class="info-label">รหัส ${docType}: </span><span class="info-value">${esc(ncr.ncr_code)}</span></div>
      <div class="info-row"><span class="info-label">สถานะ: </span><span class="info-value">${esc(statusLabel(ncr.status))}</span></div>
      <div class="info-row"><span class="info-label">Invoice No.: </span><span class="info-value">${esc(ncr.invoice_no)}</span></div>
      <div class="info-row"><span class="info-label">PO No.: </span><span class="info-value">${esc(ncr.po_no)}</span></div>
      <div class="info-row"><span class="info-label">Supplier: </span><span class="info-value">${esc(ncr.supplier_name || '-')}</span></div>
      <div class="info-row"><span class="info-label">ระดับความรุนแรง: </span><span class="info-value">${ncr.severity === 'major' ? 'Major' : 'Minor'}</span></div>
      <div class="info-row"><span class="info-label">วันที่เปิด: </span><span class="info-value">${esc(ncr.created_at?.slice(0, 10) || '-')}</span></div>
      <div class="info-row"><span class="info-label">ผู้เปิด ${docType}: </span><span class="info-value">${esc(ncr.created_by_name || '-')}</span></div>
      <div class="info-row"><span class="info-label">พนักงานรับเข้า: </span><span class="info-value">${esc(ncr.bill_received_by_name || '-')}</span></div>
      <div class="info-row"><span class="info-label">รับเมื่อวันที่: </span><span class="info-value">${thShortDate(ncr.received_date)}</span></div>
    </div>
    <div class="section-title">รายการสินค้า (${ncrItems.length} รายการ)</div>
    ${itemsHtml || '<p style="color:#6B7280;">ไม่มีข้อมูลรายการ</p>'}
    ${extraImgsHtml ? `<div class="section-title">รูปภาพเพิ่มเติม</div><div>${extraImgsHtml}</div>` : ''}
    ${respHtml}
    <div class="section-title">Timeline การอนุมัติ</div>
    <table><tr><th>ขั้นตอน</th><th>ผู้ดำเนินการ</th><th>Role</th><th>หมายเหตุ</th><th>วันที่/เวลา</th></tr>${approvalsHtml || '<tr><td colspan="5" style="text-align:center;color:#6B7280;">ยังไม่มีการอนุมัติ</td></tr>'}</table>
  `;

  try {
    const pdf = await renderDocPdf({ title: `เอกสาร ${docType} — ${ncr.ncr_code}`, bodyHtml: body });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${ncr.ncr_code}.pdf"`);
    res.send(pdf);
  } catch (e) {
    res.status(500).json({ error: 'ไม่สามารถ export PDF ได้: ' + e.message });
  }
});

router.get('/ncr/:id/excel', auth, async (req, res) => {
  const ncr = db.prepare(`
    SELECT n.*, s.name as supplier_name, b.invoice_no, b.po_no, b.received_date
    FROM ncrs n LEFT JOIN bills b ON b.id = n.bill_id LEFT JOIN suppliers s ON s.id = b.supplier_id WHERE n.id = ?
  `).get(req.params.id);
  if (!ncr) return res.status(404).json({ error: 'ไม่พบ NCR' });

  if (ncr.purchasing_received_by) {
    const pu = db.prepare('SELECT full_name FROM users WHERE id = ?').get(ncr.purchasing_received_by);
    ncr.purchasing_received_by_name = pu?.full_name || null;
  }
  if (ncr.link_copied_by) {
    const lu = db.prepare('SELECT full_name FROM users WHERE id = ?').get(ncr.link_copied_by);
    ncr.link_copied_by_name = lu?.full_name || null;
  }

  const ncrItems = db.prepare(`
    SELECT ni.*, dc.name as defect_category_name
    FROM ncr_items ni LEFT JOIN defect_categories dc ON dc.id = ni.defect_category_id
    WHERE ni.ncr_id = ?
  `).all(ncr.id);

  const approvals = db.prepare('SELECT na.*, u.full_name FROM ncr_approvals na LEFT JOIN users u ON u.id = na.user_id WHERE na.ncr_id = ? ORDER BY na.created_at').all(ncr.id);
  const supplierResp = db.prepare('SELECT * FROM supplier_responses WHERE ncr_id = ? LIMIT 1').get(ncr.id);

  const docType = ncr.severity === 'minor' ? 'NCP' : 'NCR';

  const wb = new ExcelJS.Workbook();
  const ws1 = wb.addWorksheet(`ข้อมูล ${docType}`);
  ws1.addRow(['ฟิลด์', 'ข้อมูล']);
  headerStyle(ws1, 1, 2);
  const rows = [
    [`รหัส ${docType}`, ncr.ncr_code], ['Invoice No.', ncr.invoice_no], ['PO No.', ncr.po_no],
    ['Supplier', ncr.supplier_name || '-'], ['ระดับความรุนแรง', ncr.severity],
    ['สถานะ', statusLabel(ncr.status)], ['วันที่เปิด', ncr.created_at?.slice(0, 10)],
  ];
  if (supplierResp) {
    if (supplierResp.respondent_name) rows.push(['ผู้ตอบ / Respondent', supplierResp.respondent_name]);
    rows.push(['Root Cause', supplierResp.root_cause], ['Corrective Action', supplierResp.corrective_action], ['Preventive Action', supplierResp.preventive_action]);
  }
  for (const row of rows) ws1.addRow(row);
  autoWidth(ws1);

  const ws2 = wb.addWorksheet('รายการสินค้า');
  ws2.addRow(['รายการ', 'รับเข้า', 'สุ่มตรวจ', 'ไม่ผ่าน', 'กลุ่มปัญหา', 'รายละเอียด']);
  headerStyle(ws2, 1, 6);
  for (const item of ncrItems) {
    ws2.addRow([item.item_name, item.qty_received, item.qty_sampled, item.qty_failed, item.defect_category_name || '-', item.defect_detail || '-']);
  }
  autoWidth(ws2);

  const xlTimelineEvents = [
    ...approvals.map(a => ({ type: 'approval', ts: a.created_at, data: a })),
    ...(supplierResp ? [{ type: 'supplier', ts: supplierResp.submitted_at, data: supplierResp }] : []),
    ...(ncr.purchasing_received_at ? [{ type: 'purchasing_received', ts: ncr.purchasing_received_at, data: { name: ncr.purchasing_received_by_name } }] : []),
    ...(ncr.link_copied_at ? [{ type: 'link_copied', ts: ncr.link_copied_at, data: { name: ncr.link_copied_by_name, count: ncr.link_copied_count } }] : []),
  ].sort((a, b) => new Date(a.ts) - new Date(b.ts));
  const xlApprovalOnly = xlTimelineEvents.filter(e => e.type === 'approval').map(e => e.data);

  const ws3 = wb.addWorksheet('Timeline');
  ws3.addRow(['ขั้นตอน', 'ผู้ดำเนินการ', 'Role', 'หมายเหตุ', 'วันที่/เวลา']);
  headerStyle(ws3, 1, 5);
  xlTimelineEvents.forEach((ev) => {
    if (ev.type === 'purchasing_received') {
      ws3.addRow(['จัดซื้อได้รับเอกสาร NCR', ev.data.name || 'จัดซื้อ', 'purchasing', '-', ev.ts]);
    } else if (ev.type === 'link_copied') {
      const countNote = ev.data.count > 1 ? `คัดลอก ${ev.data.count} ครั้ง` : 'คัดลอก 1 ครั้ง';
      ws3.addRow(['จัดซื้อ Copy Link ให้ Supplier', ev.data.name || 'จัดซื้อ', 'purchasing', countNote, ev.ts]);
    } else if (ev.type === 'supplier') {
      const sr = ev.data;
      const xlResponder = sr.respondent_name ? `${sr.respondent_name}${ncr.supplier_name ? ` (${ncr.supplier_name})` : ''}` : (ncr.supplier_name || 'Supplier');
      const xlDetail = [
        sr.root_cause ? `สาเหตุของปัญหา: ${sr.root_cause}` : '',
        sr.corrective_action ? `การแก้ไขปัญหา: ${sr.corrective_action}` : '',
        sr.preventive_action ? `การป้องกันปัญหา: ${sr.preventive_action}` : '',
      ].filter(Boolean).join('\n');
      ws3.addRow(['Supplier ตอบกลับ', xlResponder, 'supplier', xlDetail, sr.submitted_at]);
    } else {
      const a = ev.data;
      const idx = xlApprovalOnly.findIndex(x => x.id === a.id);
      const process = getNcrProcessLabel(a, xlApprovalOnly, idx, ncr.severity);
      ws3.addRow([process, a.full_name || '-', a.role, a.comment || '-', a.created_at]);
    }
  });
  autoWidth(ws3);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${ncr.ncr_code}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

// ===== UAI EXPORTS =====
router.get('/uai/:id/pdf', auth, pdfRateLimit, async (req, res) => {
  const uai = db.prepare(`
    SELECT u.*, n.ncr_code, n.severity, n.invoice_no, n.po_no, n.bill_id,
           s.name as supplier_name, cu.full_name as created_by_name,
           b.received_date as bill_received_date, bu.full_name as bill_received_by_name
    FROM uai_documents u
    LEFT JOIN ncrs n ON n.id = u.ncr_id
    LEFT JOIN bills b ON b.id = n.bill_id
    LEFT JOIN suppliers s ON s.id = b.supplier_id
    LEFT JOIN users cu ON cu.id = u.created_by
    LEFT JOIN users bu ON bu.id = b.created_by
    WHERE u.id = ?
  `).get(req.params.id);
  if (!uai) return res.status(404).json({ error: 'ไม่พบ UAI' });
  if (uai.status !== 'uai_completed') return res.status(400).json({ error: 'UAI ยังไม่เสร็จสมบูรณ์' });

  // ncr_items จาก NCR ที่อ้างอิง (รวมรหัสสินค้า)
  const ncrItems = db.prepare(`
    SELECT ni.*, dc.name as defect_category_name, p.code as product_code
    FROM ncr_items ni
    LEFT JOIN defect_categories dc ON dc.id = ni.defect_category_id
    LEFT JOIN bill_items bi ON bi.id = ni.bill_item_id
    LEFT JOIN products p ON p.id = bi.product_id
    WHERE ni.ncr_id = (SELECT ncr_id FROM uai_documents WHERE id = ?)
  `).all(req.params.id);

  for (const item of ncrItems) {
    item.bill_item_images = item.bill_item_id
      ? db.prepare('SELECT * FROM bill_item_images WHERE bill_item_id = ?').all(item.bill_item_id)
      : [];
  }

  const signatures = db.prepare('SELECT us.*, usr.full_name FROM uai_signatures us LEFT JOIN users usr ON usr.id = us.user_id WHERE us.uai_id = ? ORDER BY us.signed_at').all(req.params.id);

  // อ่าน UAI layout settings — ความสูงสูงสุดกำหนดตรงๆ ไม่ derive จาก width อีกต่อไป
  const uaiImgCols          = parseInt(db.getSetting('uai_img_cols')             || '3');
  const uaiImgMaxHeight     = parseInt(db.getSetting('uai_img_max_height')      || '160');
  const uaiImgInboxMaxHeight = parseInt(db.getSetting('uai_img_inbox_max_height') || '200');

  // รูปปัญหาจาก bill_item_images — object-fit:contain ให้เห็นรูปเต็มไม่ครอบตัด
  // รูป ≤2 → อยู่ข้อมูลด้านขวา, รูป >2 → อยู่ด้านล่าง (grid) — pattern เดียวกับ NCR PDF
  const itemsWithImagesHtml = ncrItems.map((item, i) => {
    const imgs = item.bill_item_images
      .map(img => imgToBase64('bill-items', img.file_path))
      .filter(Boolean);
    const sideBySide = imgs.length >= 1 && imgs.length <= 2;

    const infoHtml = `
      <div style="font-weight:700;font-size:11px;">${i + 1}. ${esc(item.item_name)}</div>
      <div style="font-size:11px;margin-top:2px;">
        รับ: <strong>${esc(item.qty_received)}</strong> &nbsp;|&nbsp;
        สุ่ม: <strong>${esc(item.qty_sampled)}</strong> &nbsp;|&nbsp;
        ไม่ผ่าน: <strong style="color:#DC2626;">${esc(item.qty_failed)}</strong>
      </div>
      ${item.defect_category_name ? `<div style="font-size:11px;">กลุ่มปัญหา: ${esc(item.defect_category_name)}</div>` : ''}
      ${item.defect_detail ? `<div style="font-size:11px;">รายละเอียด: ${esc(item.defect_detail)}</div>` : ''}
      ${item.product_code ? `<div style="font-size:11px;font-weight:700;margin-top:2px;">(รหัสสินค้า: ${esc(item.product_code)})</div>` : ''}`;

    if (sideBySide) {
      const sideImgs = imgs.map(src => `<img src="${src}" style="width:130px;max-height:${uaiImgMaxHeight}px;object-fit:contain;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:4px;" />`).join('');
      return `
        <div style="border:1px solid #E5E7EB;border-radius:6px;margin-bottom:10px;overflow:hidden;">
          <div style="background:#FEF2F2;padding:8px 12px;display:flex;gap:12px;align-items:flex-start;">
            <div style="flex:1;min-width:0;">${infoHtml}</div>
            <div style="display:flex;gap:6px;flex-shrink:0;">${sideImgs}</div>
          </div>
        </div>`;
    }

    const belowImgs = imgs.length
      ? `<div style="padding:8px 12px;"><div style="display:grid;grid-template-columns:repeat(${uaiImgCols},1fr);gap:6px;">${imgs.map(src => `<img src="${src}" style="width:100%;max-height:${uaiImgMaxHeight}px;object-fit:contain;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:4px;" />`).join('')}</div></div>`
      : '';
    return `
      <div style="border:1px solid #E5E7EB;border-radius:6px;margin-bottom:10px;overflow:hidden;">
        <div style="background:#FEF2F2;padding:8px 12px;">${infoHtml}</div>
        ${belowImgs}
      </div>`;
  }).join('');

  // รูปเพิ่มเติม NCR
  const ncrImages = db.prepare('SELECT * FROM ncr_images WHERE ncr_id = (SELECT ncr_id FROM uai_documents WHERE id = ?)').all(req.params.id);
  const extraUaiImgTags = ncrImages
    .map(img => {
      const src = imgToBase64('ncr', img.file_path);
      return src ? `<img src="${src}" style="width:100%;max-height:${uaiImgMaxHeight}px;object-fit:contain;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:4px;" />` : '';
    })
    .filter(Boolean);
  const extraImgsHtml = extraUaiImgTags.length
    ? `<div style="display:grid;grid-template-columns:repeat(${uaiImgCols},1fr);gap:6px;">${extraUaiImgTags.join('')}</div>`
    : '';

  // รูปภาพประกอบจากผู้ผลิต (uai_images) — รูปเดียวย้ายเข้ากล่องข้อมูลฝั่งขวา, หลายรูปแสดงเป็น grid แยกหัวข้อ
  const uaiImages = db.prepare('SELECT * FROM uai_images WHERE uai_id = ? ORDER BY id').all(req.params.id);
  const producerImgSrcs = uaiImages.map(img => imgToBase64('uai', img.file_path)).filter(Boolean);
  let producerImagesInboxHtml = '';
  let producerImagesSectionHtml = '';
  if (producerImgSrcs.length === 1) {
    producerImagesInboxHtml = `<img src="${producerImgSrcs[0]}" style="width:100%;max-height:${uaiImgInboxMaxHeight}px;object-fit:contain;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:4px;" />`;
  } else {
    const grid = producerImgSrcs.length
      ? `<div style="display:grid;grid-template-columns:repeat(${uaiImgCols},1fr);gap:6px;">${producerImgSrcs.map(src => `<img src="${src}" style="width:100%;max-height:${uaiImgMaxHeight}px;object-fit:contain;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:4px;" />`).join('')}</div>`
      : `<p style="color:#6B7280;font-size:11px;margin-left:16px;">ยังไม่มีรูปภาพ</p>`;
    producerImagesSectionHtml = `
      <div style="margin-top:8px;">
        <div style="font-size:12px;font-weight:700;color:#1A3A5C;margin-bottom:6px;">รูปภาพประกอบจากผู้ผลิต</div>
        ${grid}
      </div>`;
  }

  // ข้อมูลการขอยอมรับใช้ — mirror ตรงกับ UAI/Detail.jsx Section 2
  const requestInfoGridHtml = `
    <div class="info-grid">
      <div class="info-row"><span class="info-label">ประเภทผลิตภัณฑ์: </span><span class="info-value">${esc(uai.product_type || '-')}</span></div>
      <div class="info-row"><span class="info-label">ประเภทงาน: </span><span class="info-value">${esc(uai.work_type || '-')}</span></div>
      <div class="info-row"><span class="info-label">เหตุผล: </span><span class="info-value">${esc(uai.reason || '-')}</span></div>
      <div class="info-row"><span class="info-label">เงื่อนไข: </span><span class="info-value">${esc(uai.conditions || '-')}</span></div>
      <div class="info-row"><span class="info-label">แผนก: </span><span class="info-value">${esc(uai.department || '-')}</span></div>
      <div class="info-row"><span class="info-label">วันที่ออกเอกสาร: </span><span class="info-value">${esc(uai.issued_date || '-')}</span></div>
    </div>`;

  const producerRespItems = [
    ['ข้อบกพร่องที่เกิดขึ้น', uai.defect_description],
    ['สาเหตุของปัญหา', uai.root_cause_purchasing],
    ['การดำเนินการแก้ไข', uai.corrective_action_purchasing],
    ['วิธีการป้องกัน', uai.preventive_action_purchasing],
  ].filter(([, v]) => v);
  const producerRespHtml = producerRespItems.length ? `
    <div style="margin-top:8px;">
      <div style="font-size:12px;font-weight:700;color:#1A3A5C;margin-bottom:6px;">ข้อมูลที่ได้รับจากผู้ผลิต</div>
      <div class="info-grid">
        ${producerRespItems.map(([label, value]) => `
          <div class="info-row">
            <div class="info-label">${esc(label)}</div>
            <div class="info-value">${esc(value)}</div>
          </div>`).join('')}
      </div>
    </div>` : '';

  const requestInfoBoxHtml = producerImagesInboxHtml ? `
    <div style="display:flex;gap:12px;align-items:flex-start;">
      <div style="flex:1;min-width:0;">${requestInfoGridHtml}${producerRespHtml}</div>
      <div style="width:180px;flex-shrink:0;">
        <div style="font-size:12px;font-weight:700;color:#1A3A5C;margin-bottom:6px;">รูปภาพประกอบจากผู้ผลิต</div>
        ${producerImagesInboxHtml}
      </div>
    </div>` : `${requestInfoGridHtml}${producerRespHtml}`;

  const requesterLineHtml = uai.created_by_name
    ? `<div style="margin-top:10px;font-size:11px;color:#6B7280;">ผู้ขอยอมรับใช้: <strong style="color:#1F2937;">${esc(uai.created_by_name)}</strong></div>`
    : '';

  const actionLabels = {
    review_approved: 'QC Manager อนุมัติคำขอ UAI',
    review_rejected: 'QC Manager ไม่อนุมัติคำขอ',
    approved: 'อนุมัติ',
    acknowledged: 'รับทราบ',
    rejected: 'ปฏิเสธ',
  };
  const roleLabelsFull = {
    qc_manager: 'QC Manager', purchasing: 'จัดซื้อ', cco: 'COO', cmo: 'CMO',
    cpo: 'CPO', production_manager: 'ผู้จัดการผลิต', qmr: 'QMR',
  };

  const timelineRows = [...signatures]
    .sort((a, b) => new Date(a.signed_at) - new Date(b.signed_at))
    .map(s => {
      const isNeg = s.action === 'rejected' || s.action === 'review_rejected';
      // ขั้น QC Manager อนุมัติ/ไม่อนุมัติคำขอ UAI เป็นการคลิกปุ่มตัดสินใจเท่านั้น ไม่มีการเซ็นจริง — ไม่แสดงกรอบลายเซ็น
      const isReviewStep = s.action === 'review_approved' || s.action === 'review_rejected';
      const color = isNeg ? '#DC2626' : '#16A34A';
      const safe = sigDataUrl(s.signature_image);
      // mix-blend-mode:multiply — รูปลายเซ็นที่เก็บไว้มีพื้นหลังขาวทึบเสมอ (มาจาก signature pad)
      // multiply ทำให้พื้นขาวนั้น "หายไป" กลืนกับสีพื้นหลังของแถว/ตาราง (ไม่ว่าจะเป็นสีอะไร) แทนที่จะทับเป็นสี่เหลี่ยมขาวทึบ
      const sigInner = safe ? `<img src="${safe}" style="max-width:100%;max-height:100%;object-fit:contain;mix-blend-mode:multiply;" />` : '';
      const sigCell = isReviewStep
        ? ''
        : `<div style="width:90px;height:40px;border:1px solid #D1D5DB;border-radius:3px;display:flex;align-items:center;justify-content:center;margin:0 auto;overflow:hidden;">${sigInner}</div>`;
      return `
        <tr>
          <td style="color:${color};font-weight:600;font-size:10px;">${esc(actionLabels[s.action] || s.action)}</td>
          <td style="font-size:10px;">${esc(roleLabelsFull[s.role] || s.role)}</td>
          <td style="font-size:10px;">${esc(s.full_name || '-')}</td>
          <td style="font-size:10px;font-style:italic;color:#6B7280;white-space:pre-wrap;">${esc(s.comment || '-')}</td>
          <td style="font-size:10px;">${new Date(s.signed_at + 'Z').toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Bangkok' })}</td>
          <td style="text-align:center;">${sigCell}</td>
        </tr>`;
    }).join('');

  const timelineHtml = `
    <div class="section-title">Timeline การอนุมัติ</div>
    <table>
      <thead>
        <tr style="background:#F3F4F6;">
          <th style="font-size:10px;padding:4px 6px;text-align:left;">การดำเนินการ</th>
          <th style="font-size:10px;padding:4px 6px;text-align:left;">ตำแหน่ง</th>
          <th style="font-size:10px;padding:4px 6px;text-align:left;">ชื่อ</th>
          <th style="font-size:10px;padding:4px 6px;text-align:left;">เหตุผล/หมายเหตุ</th>
          <th style="font-size:10px;padding:4px 6px;text-align:left;">วันเวลา</th>
          <th style="font-size:10px;padding:4px 6px;text-align:center;">ลายเซ็น</th>
        </tr>
      </thead>
      <tbody>${timelineRows || '<tr><td colspan="6" style="color:#6B7280;font-size:10px;">ไม่มีประวัติ</td></tr>'}</tbody>
    </table>`;

  const body = `
    ${docTitleHtml('เอกสารขอใช้พิเศษ(UAI)')}
    <div class="section-title">ข้อมูล UAI</div>
    <div class="info-grid">
      <div class="info-row"><span class="info-label">รหัส UAI: </span><span class="info-value">${esc(uai.uai_code)}</span></div>
      <div class="info-row"><span class="info-label">อ้างอิง NCR: </span><span class="info-value">${esc(uai.ncr_code)}</span></div>
      <div class="info-row"><span class="info-label">Invoice No.: </span><span class="info-value">${esc(uai.invoice_no)}</span></div>
      <div class="info-row"><span class="info-label">PO No.: </span><span class="info-value">${esc(uai.po_no)}</span></div>
      <div class="info-row"><span class="info-label">Supplier: </span><span class="info-value">${esc(uai.supplier_name || '-')}</span></div>
      <div class="info-row"><span class="info-label">ระดับความรุนแรง: </span><span class="info-value">${uai.severity === 'major' ? 'Major' : 'Minor'}</span></div>
      <div class="info-row"><span class="info-label">พนักงานรับเข้า: </span><span class="info-value">${esc(uai.bill_received_by_name || '-')}</span></div>
      <div class="info-row"><span class="info-label">รับเมื่อวันที่: </span><span class="info-value">${thShortDate(uai.bill_received_date)}</span></div>
    </div>
    <div class="section-title">รายการสินค้า + รูปภาพปัญหา</div>
    ${itemsWithImagesHtml || '<p style="color:#6B7280;">ไม่มีข้อมูลรายการ</p>'}
    ${extraImgsHtml ? `<div class="section-title">รูปภาพเพิ่มเติม</div><div>${extraImgsHtml}</div>` : ''}
    <div class="section-title">ข้อมูลการขอยอมรับใช้</div>
    ${requestInfoBoxHtml}
    ${producerImagesSectionHtml}
    ${requesterLineHtml}
    ${timelineHtml}
  `;

  try {
    const pdf = await renderDocPdf({ title: `เอกสาร UAI — ${uai.uai_code}`, bodyHtml: body });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${uai.uai_code}.pdf"`);
    res.send(pdf);
  } catch (e) {
    res.status(500).json({ error: 'ไม่สามารถ export PDF ได้: ' + e.message });
  }
});

router.get('/uai/:id/excel', auth, async (req, res) => {
  try {
    const uai = db.prepare(`
      SELECT u.*, n.ncr_code, n.invoice_no, n.po_no, s.name as supplier_name
      FROM uai_documents u LEFT JOIN ncrs n ON n.id = u.ncr_id LEFT JOIN bills b ON b.id = n.bill_id LEFT JOIN suppliers s ON s.id = b.supplier_id
      WHERE u.id = ?
    `).get(req.params.id);
    if (!uai) return res.status(404).json({ error: 'ไม่พบ UAI' });
    if (uai.status !== 'uai_completed') return res.status(400).json({ error: 'UAI ยังไม่เสร็จสมบูรณ์' });

    const ncrItems = db.prepare('SELECT item_name, qty_failed FROM ncr_items WHERE ncr_id = ?').all(uai.ncr_id);
    const itemNameStr = ncrItems.map(i => i.item_name).filter(Boolean).join(', ');
    const totalQtyFailed = ncrItems.reduce((sum, i) => sum + (i.qty_failed || 0), 0);

    const signatures = db.prepare('SELECT us.*, usr.full_name FROM uai_signatures us LEFT JOIN users usr ON usr.id = us.user_id WHERE us.uai_id = ? ORDER BY us.signed_at').all(req.params.id);

    const wb = new ExcelJS.Workbook();
    const ws1 = wb.addWorksheet('ข้อมูล UAI');
    ws1.addRow(['ฟิลด์', 'ข้อมูล']);
    headerStyle(ws1, 1, 2);
    const rows = [
      ['รหัส UAI', uai.uai_code], ['อ้างอิง NCR', uai.ncr_code], ['Invoice No.', uai.invoice_no],
      ['PO No.', uai.po_no], ['Supplier', uai.supplier_name || '-'], ['รายการสินค้า', itemNameStr],
      ['จำนวนไม่ผ่าน', totalQtyFailed], ['เหตุผล', uai.reason || '-'],
      ['เงื่อนไข', uai.conditions || '-'], ['แผนก', uai.department || '-'],
      ['วันที่ออกเอกสาร', uai.issued_date || '-'],
    ];
    for (const row of rows) ws1.addRow(row);
    autoWidth(ws1);

    const ws2 = wb.addWorksheet('ลายเซ็น');
    ws2.addRow(['ตำแหน่ง', 'ชื่อผู้ลงนาม', 'ประเภท', 'วันเวลาลงนาม']);
    headerStyle(ws2, 1, 4);
    for (const s of signatures) {
      ws2.addRow([s.role, s.full_name || '-', s.action === 'approved' ? 'อนุมัติ' : 'รับทราบ', s.signed_at]);
    }
    autoWidth(ws2);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${uai.uai_code}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: 'Export ไม่สำเร็จ: ' + e.message });
  }
});

// ===== REPORT EXPORTS =====
const REPORT_ROLES = ['qc_supervisor', 'qc_manager', 'purchasing_manager', 'cco', 'cmo', 'cpo'];

function buildDateFilter(from, to, col) {
  const parts = [];
  const params = [];
  if (from) { parts.push(`DATE(${col}) >= ?`); params.push(from); }
  if (to) { parts.push(`DATE(${col}) <= ?`); params.push(to); }
  return { sql: parts.length ? ' AND ' + parts.join(' AND ') : '', params };
}

// ข้อความช่วงเวลาของข้อมูล — ใส่เป็นแถวแรก (merge เต็มความกว้าง) เหนือหัวตารางของทุก report export (คำขอ user:
// เดิม export excel ไม่มีช่วงวันที่ติดไปกับไฟล์เลย เปิดไฟล์แล้วไม่รู้ว่าข้อมูลกรองช่วงไหนไว้)
function dateRangeLabel(from, to) {
  if (from && to) return `ช่วงข้อมูล: ${from} ถึง ${to}`;
  if (from) return `ช่วงข้อมูล: ตั้งแต่ ${from}`;
  if (to) return `ช่วงข้อมูล: ถึง ${to}`;
  return 'ช่วงข้อมูล: ทั้งหมด (ไม่ได้กรองช่วงวันที่)';
}

// เขียนแถวช่วงเวลา (merge เต็มความกว้างตาม colCount) ลงแถว 1 ของ worksheet ที่ column ถูกกำหนดไว้แล้ว (key/width
// เท่านั้น ไม่มี header — header จริงเขียนเป็นแถว 2 แยกต่างหากโดยผู้เรียก)
function writeDateRangeRow(ws, colCount, from, to) {
  ws.mergeCells(1, 1, 1, colCount);
  const cell = ws.getCell(1, 1);
  cell.value = dateRangeLabel(from, to);
  cell.font = { italic: true, color: { argb: 'FF6B7280' } };
  cell.alignment = { horizontal: 'left', vertical: 'middle' };
  ws.getRow(1).height = 20;
}

// ===== Shared shell สำหรับ Export PDF ของเมนู "รายงาน" ทุกหน้า (ภาพรวม/การรับเข้า/NCR/UAI) =====
// รูปแบบสั้นกว่า dateRangeLabel ข้างบน (ใช้ inline ในบรรทัดเดียวของ header PDF ไม่ใช่ merge cell แยกแถวแบบ Excel)
function pdfRangeLabel(from, to) {
  return (from || to) ? `${esc(from || '-')} ถึง ${esc(to || '-')}` : 'ทั้งหมด';
}

// CSS ใช้ร่วมกันทุก report PDF (hero KPI row, split 2 คอลัมน์, ตารางหลัก) — คัดลอกมาจาก /reports/summary/pdf เดิม
function reportPdfStyle() {
  return `
  ${FONT_FACE_CSS}
  body{font-family:'IBM Plex Sans Thai','Segoe UI',Arial,sans-serif;font-size:11px;color:#1F2937;margin:0;}
  .section-title{font-size:14px;font-weight:700;color:#1A3A5C;margin:16px 0 8px;border-bottom:2px solid #1A3A5C;padding-bottom:4px;page-break-after:avoid;}
  .section-title:first-child{margin-top:0;}
  .hero-row{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;}
  .hero-box{flex:1;min-width:90px;border:1px solid #D1D5DB;border-radius:6px;padding:10px 10px;background:#F5F6F8;}
  .hero-value{font-size:22px;font-weight:700;line-height:1.1;}
  .hero-label{font-size:9px;color:#6B7280;margin-top:4px;}
  .split-row{display:flex;gap:16px;margin-bottom:8px;}
  .split-col{flex:1;border:1px solid #D1D5DB;border-radius:6px;padding:12px;}
  .split-heading{font-size:11px;font-weight:700;color:#1A3A5C;margin-bottom:8px;}
  table{width:100%;border-collapse:collapse;margin-bottom:6px;}
  thead{display:table-header-group;}
  th{background:#1A3A5C;color:#fff;padding:6px;font-size:10px;text-align:left;white-space:nowrap;}
  td{padding:5px 6px;border-bottom:1px solid #E5E7EB;font-size:10px;vertical-align:middle;}
  tr{page-break-inside:avoid;}
  tr:nth-child(even) td{background:#F9FAFB;}
  .no-data{text-align:center;color:#6B7280;padding:40px;font-size:14px;}
  .no-data-inline{color:#6B7280;font-size:10px;text-align:center;}
  `;
}

// header/footer template (Puppeteer headerTemplate ต้องกำหนด style เองทั้งหมด ไม่รับ CSS จาก body) — title/
// rangeLabel/extraInfo ต่างกันตามรายงาน
function reportPdfHeaderFooter(req, title, rangeLabel, extraInfo) {
  const companyName = db.getSetting('company_name') || '';
  const logoFile = db.getSetting('company_logo') || '';
  const logoSrc = logoFile ? (imgToBase64('general', logoFile) || '') : '';
  const exportTime = new Date().toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Bangkok' });
  const headerTemplate = `
    <div style="font-family:'IBM Plex Sans Thai','Tahoma','Leelawadee UI',sans-serif;width:100%;padding:0 8mm;box-sizing:border-box;color:#1F2937;">
      <div style="display:flex;align-items:center;gap:8px;border-bottom:2px solid #1A3A5C;padding-bottom:4px;">
        ${logoSrc ? `<img src="${logoSrc}" style="max-height:32px;max-width:110px;object-fit:contain;" />` : ''}
        <div style="flex:1;">
          ${companyName ? `<div style="font-size:10px;font-weight:700;color:#1A3A5C;">${esc(companyName)}</div>` : ''}
          <div style="font-size:12px;font-weight:700;color:#1A3A5C;">${esc(title)}</div>
          <div style="font-size:8px;color:#6B7280;">ช่วงวันที่: ${rangeLabel} &nbsp;|&nbsp; Export: ${esc(exportTime)} &nbsp;|&nbsp; ผู้ออกรายงาน: ${esc(req.user.full_name)}${extraInfo ? ` &nbsp;|&nbsp; ${extraInfo}` : ''}</div>
        </div>
      </div>
    </div>`;
  const footerTemplate = `
    <div style="font-family:'IBM Plex Sans Thai','Tahoma','Leelawadee UI',sans-serif;font-size:9px;color:#6B7280;width:100%;text-align:center;">
      หน้า <span class="pageNumber"></span>/<span class="totalPages"></span>
    </div>`;
  return { headerTemplate, footerTemplate };
}

// เรนเดอร์ + ส่ง PDF (acquire/release slot + isolated page เหมือนทุก PDF route อื่นในไฟล์นี้)
async function sendReportPdf(res, html, headerTemplate, footerTemplate, filename) {
  await acquirePdfSlot();
  let ctx;
  try {
    const { page, context } = await openIsolatedPage();
    ctx = context;
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => { await document.fonts.ready; });
    const buffer = await page.pdf({
      format: 'A4',
      landscape: true,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate,
      footerTemplate,
      margin: { top: '30mm', bottom: '14mm', left: '8mm', right: '8mm' },
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } finally {
    await closeIsolated(ctx);
    releasePdfSlot();
  }
}

// รายการ/ผ่าน/ไม่ผ่าน นับจากแถว bill_items (ไม่ใช่ผลรวมจำนวนชิ้น) — ไม่ผ่าน = มีการออก NCR อ้างอิงถึง (เหมือน
// routes/reports.js GET /receiving — คำขอ user, ดู DEVLOG)
router.get('/reports/receiving/excel', auth, requireRole(REPORT_ROLES), async (req, res) => {
  const { from, to } = req.query;
  const dateFilter = buildDateFilter(from, to, 'b.received_date');
  const bills = db.prepare(`
    SELECT b.invoice_no, b.po_no, s.name as supplier_name, b.received_date, b.status,
           COUNT(DISTINCT bi.id) as item_count,
           COUNT(DISTINCT ni.bill_item_id) as ncr_item_count
    FROM bills b LEFT JOIN suppliers s ON s.id = b.supplier_id
    LEFT JOIN bill_items bi ON bi.bill_id = b.id
    LEFT JOIN ncr_items ni ON ni.bill_item_id = bi.id
    WHERE 1=1 ${dateFilter.sql} GROUP BY b.id ORDER BY b.received_date DESC
  `).all(...dateFilter.params);
  bills.forEach(b => { b.passed_item_count = b.item_count - b.ncr_item_count; });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('รายงานการรับเข้า');
  ws.columns = [
    { key: 'invoice_no', width: 18 },
    { key: 'po_no', width: 18 },
    { key: 'supplier_name', width: 25 },
    { key: 'received_date', width: 14 },
    { key: 'item_count', width: 10 },
    { key: 'passed_item_count', width: 10 },
    { key: 'ncr_item_count', width: 14 },
    { key: 'status', width: 18 },
  ];
  writeDateRangeRow(ws, ws.columns.length, from, to);
  ws.addRow(['Invoice No.', 'PO No.', 'Supplier', 'วันที่รับ', 'รายการ', 'ผ่าน', 'ไม่ผ่าน (มี NCR)', 'สถานะ']);
  ws.getRow(2).eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3A5C' } };
    cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
  });
  bills.forEach(r => ws.addRow(r));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="report-receiving-${from||'all'}-${to||'all'}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

router.get('/reports/ncr/excel', auth, requireRole(REPORT_ROLES), async (req, res) => {
  try {
    const { from, to } = req.query;
    const dateFilter = buildDateFilter(from, to, 'n.created_at');
    const ncrs = db.prepare(`
      SELECT n.ncr_code, ni.item_name, s.name as supplier_name, n.severity, dc.name as defect_category_name,
             b.invoice_no, n.status, n.created_at
      FROM ncrs n LEFT JOIN bills b ON b.id = n.bill_id
      LEFT JOIN suppliers s ON s.id = b.supplier_id
      LEFT JOIN ncr_items ni ON ni.ncr_id = n.id
      LEFT JOIN defect_categories dc ON dc.id = ni.defect_category_id
      WHERE 1=1 ${dateFilter.sql} ORDER BY n.created_at DESC
    `).all(...dateFilter.params);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('รายงาน NCR');
    ws.columns = [
      { key: 'ncr_code', width: 16 },
      { key: 'item_name', width: 30 },
      { key: 'supplier_name', width: 25 },
      { key: 'invoice_no', width: 18 },
      { key: 'severity', width: 10 },
      { key: 'defect_category_name', width: 20 },
      { key: 'status', width: 22 },
      { key: 'created_at', width: 20 },
    ];
    writeDateRangeRow(ws, ws.columns.length, from, to);
    ws.addRow(['รหัส NCR', 'รายการ', 'Supplier', 'Invoice No.', 'ระดับ', 'กลุ่มปัญหา', 'สถานะ', 'วันที่เปิด']);
    ws.getRow(2).eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3A5C' } };
      cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
    });
    ncrs.forEach(r => ws.addRow(r));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="report-ncr-${from||'all'}-${to||'all'}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: 'Export ไม่สำเร็จ: ' + e.message });
  }
});

router.get('/reports/uai/excel', auth, requireRole(REPORT_ROLES), async (req, res) => {
  const { from, to } = req.query;
  const dateFilter = buildDateFilter(from, to, 'u.created_at');
  const uais = db.prepare(`
    SELECT u.uai_code, n.ncr_code, GROUP_CONCAT(ni.item_name, ', ') as item_name,
           s.name as supplier_name, u.status, u.created_at
    FROM uai_documents u LEFT JOIN ncrs n ON n.id = u.ncr_id
    LEFT JOIN bills b ON b.id = n.bill_id LEFT JOIN suppliers s ON s.id = b.supplier_id
    LEFT JOIN ncr_items ni ON ni.ncr_id = n.id
    WHERE 1=1 ${dateFilter.sql} GROUP BY u.id ORDER BY u.created_at DESC
  `).all(...dateFilter.params);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('รายงาน UAI');
  ws.columns = [
    { key: 'uai_code', width: 16 },
    { key: 'ncr_code', width: 16 },
    { key: 'item_name', width: 30 },
    { key: 'supplier_name', width: 25 },
    { key: 'status', width: 25 },
    { key: 'created_at', width: 20 },
  ];
  writeDateRangeRow(ws, ws.columns.length, from, to);
  ws.addRow(['รหัส UAI', 'NCR อ้างอิง', 'รายการ', 'Supplier', 'สถานะ', 'วันที่สร้าง']);
  ws.getRow(2).eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3A5C' } };
    cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
  });
  uais.forEach(r => ws.addRow(r));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="report-uai-${from||'all'}-${to||'all'}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

router.get('/reports/summary/excel', auth, requireRole(REPORT_ROLES), async (req, res) => {
  const { from, to } = req.query;
  const dateFilter = buildDateFilter(from, to, 'b.received_date');
  const scorecard = db.prepare(`
    SELECT s.name as supplier_name, COUNT(DISTINCT b.id) as total_bills,
           COUNT(n.id) as total_ncr, COUNT(u.id) as total_uai
    FROM suppliers s
    LEFT JOIN bills b ON b.supplier_id = s.id ${dateFilter.sql}
    LEFT JOIN ncrs n ON n.bill_id = b.id
    LEFT JOIN uai_documents u ON u.ncr_id = n.id
    WHERE s.is_active = 1 GROUP BY s.id ORDER BY total_ncr DESC
  `).all(...dateFilter.params);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Supplier Scorecard');
  ws.columns = [
    { key: 'supplier_name', width: 30 },
    { key: 'total_bills', width: 14 },
    { key: 'total_ncr', width: 14 },
    { key: 'ncr_rate', width: 16 },
    { key: 'total_uai', width: 14 },
  ];
  writeDateRangeRow(ws, ws.columns.length, from, to);
  ws.addRow(['Supplier', 'บิลทั้งหมด', 'NCR ทั้งหมด', 'อัตรา NCR (%)', 'UAI ทั้งหมด']);
  ws.getRow(2).eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3A5C' } };
    cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
  });
  scorecard.forEach(r => ws.addRow({
    ...r,
    ncr_rate: r.total_bills > 0 ? ((r.total_ncr / r.total_bills) * 100).toFixed(1) + '%' : '0.0%',
  }));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="report-summary-${from||'all'}-${to||'all'}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

// ===== GET /api/reports/summary/pdf — รายงานภาพรวม (ตรงกับหน้าจอ Reports/Summary.jsx) =====
// เดิมหน้าจอมีปุ่ม Export PDF อยู่แล้วแต่ไม่มี route นี้เลย (กด export ไม่สำเร็จทุก role — ไม่ใช่ปัญหาสิทธิ์ COO
// โดยเฉพาะ) — สร้างใหม่ครั้งแรก คำนวณตรงกับ GET /api/reports/summary เป๊ะ (รายการรับเข้า/อัตราผ่านนับจาก
// bill_items แถว ไม่ใช่ผลรวมจำนวนชิ้น — ดู DEVLOG)
router.get('/reports/summary/pdf', auth, requireRole(REPORT_ROLES), pdfRateLimit, async (req, res) => {
  try {
    const { from, to, supplier_id } = req.query;
    const dateFilter = buildDateFilter(from, to, 'b.received_date');
    const params = [...dateFilter.params];
    let extra = dateFilter.sql;
    if (supplier_id) { extra += ' AND b.supplier_id = ?'; params.push(supplier_id); }

    const billStats = db.prepare(`
      SELECT COUNT(DISTINCT b.id) as total_bills,
             COUNT(DISTINCT bi.id) as total_items,
             COUNT(DISTINCT ni.bill_item_id) as ncr_item_count
      FROM bills b LEFT JOIN bill_items bi ON bi.bill_id = b.id
      LEFT JOIN ncr_items ni ON ni.bill_item_id = bi.id WHERE 1=1 ${extra}
    `).get(...params);

    const ncrDateFilter = buildDateFilter(from, to, 'n.created_at');
    const ncrParams = [...ncrDateFilter.params];
    let ncrExtra = ncrDateFilter.sql;
    if (supplier_id) { ncrExtra += ' AND b2.supplier_id = ?'; ncrParams.push(supplier_id); }

    const ncrStats = db.prepare(`
      SELECT COUNT(*) as total_ncr,
             SUM(CASE WHEN n.status NOT IN ('closed') THEN 1 ELSE 0 END) as open_ncr
      FROM ncrs n LEFT JOIN bills b2 ON b2.id = n.bill_id WHERE 1=1 ${ncrExtra}
    `).get(...ncrParams);

    const uaiStats = db.prepare(`
      SELECT COUNT(*) as total_uai FROM uai_documents u
      LEFT JOIN ncrs n ON n.id = u.ncr_id
      LEFT JOIN bills b3 ON b3.id = n.bill_id
      WHERE 1=1 ${ncrDateFilter.sql.replace(/b2\./g, 'b3.')}
    `).get(...ncrDateFilter.params, ...(supplier_id ? [supplier_id] : []));

    const topNcrSuppliers = db.prepare(`
      SELECT s.name, COUNT(n.id) as ncr_count
      FROM ncrs n
      LEFT JOIN bills b ON b.id = n.bill_id
      LEFT JOIN suppliers s ON s.id = b.supplier_id
      WHERE 1=1 ${ncrExtra}
      GROUP BY s.id ORDER BY ncr_count DESC LIMIT 5
    `).all(...ncrParams);

    const topDefects = db.prepare(`
      SELECT dc.name, COUNT(DISTINCT n.id) as ncr_count
      FROM ncrs n
      LEFT JOIN ncr_items ni ON ni.ncr_id = n.id
      LEFT JOIN defect_categories dc ON dc.id = ni.defect_category_id
      LEFT JOIN bills b ON b.id = n.bill_id
      WHERE 1=1 ${ncrExtra}
      GROUP BY dc.id ORDER BY ncr_count DESC LIMIT 5
    `).all(...ncrParams);

    const supplierScorecard = db.prepare(`
      SELECT s.name as supplier_name,
             COUNT(DISTINCT b.id) as total_bills,
             COUNT(n.id) as total_ncr,
             COUNT(u.id) as total_uai
      FROM suppliers s
      LEFT JOIN bills b ON b.supplier_id = s.id ${extra ? 'AND 1=1 ' + extra : ''}
      LEFT JOIN ncrs n ON n.bill_id = b.id
      LEFT JOIN uai_documents u ON u.ncr_id = n.id
      GROUP BY s.id ORDER BY total_ncr DESC
    `).all(...params);

    const totalItems = billStats.total_items || 0;
    const ncrItemCount = billStats.ncr_item_count || 0;
    const passRate = totalItems > 0 ? (((totalItems - ncrItemCount) / totalItems) * 100).toFixed(1) : '0.0';

    const rangeLabel = pdfRangeLabel(from, to);

    const HERO_STATS = [
      { value: billStats.total_bills || 0, label: 'บิลทั้งหมด', color: '#1A3A5C' },
      { value: totalItems, label: 'รายการรับเข้า', color: '#2E6DA4' },
      { value: `${passRate}%`, label: 'อัตราผ่าน', color: '#16A34A' },
      { value: ncrStats.total_ncr || 0, label: 'NCR ทั้งหมด', color: '#D97706' },
      { value: ncrStats.open_ncr || 0, label: 'NCR เปิดอยู่', color: '#DC2626' },
      { value: uaiStats.total_uai || 0, label: 'UAI ทั้งหมด', color: '#1A3A5C' },
    ];
    const heroCells = HERO_STATS.map(h => `
      <div class="hero-box" style="border-top:4px solid ${h.color};">
        <div class="hero-value" style="color:${h.color};">${esc(h.value)}</div>
        <div class="hero-label">${esc(h.label)}</div>
      </div>`).join('');

    const topSuppliersRows = topNcrSuppliers.length
      ? topNcrSuppliers.map(s => `<tr><td>${esc(s.name || '-')}</td><td style="text-align:right;">${s.ncr_count}</td></tr>`).join('')
      : `<tr><td colspan="2" class="no-data-inline">ไม่มีข้อมูล</td></tr>`;
    const topDefectsRows = topDefects.length
      ? topDefects.map(d => `<tr><td>${esc(d.name || '-')}</td><td style="text-align:right;">${d.ncr_count}</td></tr>`).join('')
      : `<tr><td colspan="2" class="no-data-inline">ไม่มีข้อมูล</td></tr>`;

    const scorecardTheadRow = `<tr><th>Supplier</th><th style="text-align:right;">บิลทั้งหมด</th><th style="text-align:right;">NCR ทั้งหมด</th><th style="text-align:right;">อัตรา NCR (%)</th><th style="text-align:right;">UAI ทั้งหมด</th></tr>`;
    const scorecardRows = supplierScorecard.map(s => `
      <tr>
        <td>${esc(s.supplier_name)}</td>
        <td style="text-align:right;">${s.total_bills}</td>
        <td style="text-align:right;">${s.total_ncr}</td>
        <td style="text-align:right;">${s.total_bills > 0 ? ((s.total_ncr / s.total_bills) * 100).toFixed(1) : '0.0'}%</td>
        <td style="text-align:right;">${s.total_uai}</td>
      </tr>`).join('');

    const { headerTemplate, footerTemplate } = reportPdfHeaderFooter(req, 'รายงานภาพรวม (Summary Report)', rangeLabel);

    const html = `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8">
<style>${reportPdfStyle()}</style>
</head><body>
<div class="hero-row">${heroCells}</div>
<div class="split-row">
  <div class="split-col">
    <div class="split-heading">Top 5 Supplier มี NCR มากที่สุด</div>
    <table><thead><tr><th>Supplier</th><th style="text-align:right;">NCR</th></tr></thead><tbody>${topSuppliersRows}</tbody></table>
  </div>
  <div class="split-col">
    <div class="split-heading">Top 5 กลุ่มปัญหา</div>
    <table><thead><tr><th>กลุ่มปัญหา</th><th style="text-align:right;">NCR</th></tr></thead><tbody>${topDefectsRows}</tbody></table>
  </div>
</div>
<div class="section-title">Supplier Scorecard (${supplierScorecard.length})</div>
${supplierScorecard.length === 0
  ? '<div class="no-data">ไม่มีข้อมูล Supplier</div>'
  : `<table><thead>${scorecardTheadRow}</thead><tbody>${scorecardRows}</tbody></table>`}
</body></html>`;

    await sendReportPdf(res, html, headerTemplate, footerTemplate, `report-summary-${from||'all'}-${to||'all'}.pdf`);
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: 'Export ไม่สำเร็จ: ' + e.message });
  }
});

// ===== GET /api/reports/receiving/pdf — รายงานการรับเข้า (ตรงกับหน้าจอ Reports/Receiving.jsx) =====
router.get('/reports/receiving/pdf', auth, requireRole(REPORT_ROLES), pdfRateLimit, async (req, res) => {
  try {
    const { from, to, supplier_id } = req.query;
    const dateFilter = buildDateFilter(from, to, 'b.received_date');
    const params = [...dateFilter.params];
    let extra = dateFilter.sql;
    if (supplier_id) { extra += ' AND b.supplier_id = ?'; params.push(supplier_id); }

    const bills = db.prepare(`
      SELECT b.invoice_no, b.po_no, s.name as supplier_name, b.received_date, b.status,
             COUNT(DISTINCT bi.id) as item_count,
             COUNT(DISTINCT ni.bill_item_id) as ncr_item_count
      FROM bills b LEFT JOIN suppliers s ON s.id = b.supplier_id
      LEFT JOIN bill_items bi ON bi.bill_id = b.id
      LEFT JOIN ncr_items ni ON ni.bill_item_id = bi.id
      WHERE 1=1 ${extra} GROUP BY b.id ORDER BY b.received_date DESC
    `).all(...params);
    bills.forEach(b => { b.passed_item_count = b.item_count - b.ncr_item_count; });

    const agg = db.prepare(`
      SELECT COUNT(DISTINCT b.id) as total_bills, COUNT(DISTINCT bi.id) as total_items,
             COUNT(DISTINCT ni.bill_item_id) as ncr_item_count
      FROM bills b LEFT JOIN bill_items bi ON bi.bill_id = b.id
      LEFT JOIN ncr_items ni ON ni.bill_item_id = bi.id WHERE 1=1 ${extra}
    `).get(...params);
    const totalItems = agg.total_items || 0;
    const ncrItemCount = agg.ncr_item_count || 0;
    const passedItemCount = totalItems - ncrItemCount;
    const passRate = totalItems > 0 ? ((passedItemCount / totalItems) * 100).toFixed(1) : '0.0';

    const HERO_STATS = [
      { value: agg.total_bills || 0, label: 'บิลทั้งหมด', color: '#1A3A5C' },
      { value: totalItems, label: 'รายการทั้งหมด', color: '#2E6DA4' },
      { value: passedItemCount, label: 'ผ่าน', color: '#16A34A' },
      { value: ncrItemCount, label: 'ไม่ผ่าน (มี NCR)', color: '#DC2626' },
      { value: `${passRate}%`, label: 'อัตราผ่าน', color: '#16A34A' },
    ];
    const heroCells = HERO_STATS.map(h => `
      <div class="hero-box" style="border-top:4px solid ${h.color};">
        <div class="hero-value" style="color:${h.color};">${esc(h.value)}</div>
        <div class="hero-label">${esc(h.label)}</div>
      </div>`).join('');

    const theadRow = `<tr><th>Invoice No.</th><th>PO No.</th><th>Supplier</th><th>วันที่รับ</th><th style="text-align:right;">รายการ</th><th style="text-align:right;">ผ่าน</th><th style="text-align:right;">ไม่ผ่าน (มี NCR)</th><th>สถานะ</th></tr>`;
    const dataRows = bills.map(b => `
      <tr>
        <td>${esc(b.invoice_no)}</td>
        <td>${esc(b.po_no)}</td>
        <td>${esc(b.supplier_name || '-')}</td>
        <td>${esc(b.received_date)}</td>
        <td style="text-align:right;">${b.item_count}</td>
        <td style="text-align:right;color:#16A34A;">${b.passed_item_count}</td>
        <td style="text-align:right;${b.ncr_item_count > 0 ? 'color:#DC2626;font-weight:700;' : ''}">${b.ncr_item_count}</td>
        <td>${esc(statusLabel(b.status))}</td>
      </tr>`).join('');

    const rangeLabel = pdfRangeLabel(from, to);
    const { headerTemplate, footerTemplate } = reportPdfHeaderFooter(req, 'รายงานการรับเข้า (Receiving Report)', rangeLabel);

    const html = `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8">
<style>${reportPdfStyle()}</style>
</head><body>
<div class="hero-row">${heroCells}</div>
<div class="section-title">รายการบิล (${bills.length})</div>
${bills.length === 0
  ? '<div class="no-data">ไม่มีข้อมูล</div>'
  : `<table><thead>${theadRow}</thead><tbody>${dataRows}</tbody></table>`}
</body></html>`;

    await sendReportPdf(res, html, headerTemplate, footerTemplate, `report-receiving-${from||'all'}-${to||'all'}.pdf`);
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: 'Export ไม่สำเร็จ: ' + e.message });
  }
});

// ===== GET /api/reports/ncr/pdf — รายงาน NCR (ตรงกับหน้าจอ Reports/NCRReport.jsx) =====
router.get('/reports/ncr/pdf', auth, requireRole(REPORT_ROLES), pdfRateLimit, async (req, res) => {
  try {
    const { from, to, supplier_id } = req.query;
    const dateFilter = buildDateFilter(from, to, 'n.created_at');
    const params = [...dateFilter.params];
    let extra = dateFilter.sql;
    if (supplier_id) { extra += ' AND b.supplier_id = ?'; params.push(supplier_id); }

    const ncrs = db.prepare(`
      SELECT n.ncr_code, s.name as supplier_name, n.severity, n.status, n.created_at, COUNT(ni.id) as item_count
      FROM ncrs n
      LEFT JOIN bills b ON b.id = n.bill_id
      LEFT JOIN suppliers s ON s.id = b.supplier_id
      LEFT JOIN ncr_items ni ON ni.ncr_id = n.id
      WHERE 1=1 ${extra} GROUP BY n.id ORDER BY n.created_at DESC
    `).all(...params);

    const openStatuses = ['pending_supervisor', 'pending_manager', 'pending_qmr_open', 'pending_supplier', 'pending_manager_review', 'pending_qmr_close', 'pending_uai'];
    const openIn = openStatuses.map(() => '?').join(',');
    const agg = db.prepare(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN n.status IN (${openIn}) THEN 1 ELSE 0 END) as open,
             SUM(CASE WHEN n.status = 'closed' THEN 1 ELSE 0 END) as closed,
             SUM(CASE WHEN n.severity = 'major' THEN 1 ELSE 0 END) as major,
             SUM(CASE WHEN n.severity = 'minor' THEN 1 ELSE 0 END) as minor
      FROM ncrs n LEFT JOIN bills b ON b.id = n.bill_id WHERE 1=1 ${extra}
    `).get(...openStatuses, ...params);

    const defectBreakdown = db.prepare(`
      SELECT COALESCE(dc.name, 'อื่นๆ') as name, COUNT(DISTINCT n.id) as value
      FROM ncrs n
      LEFT JOIN bills b ON b.id = n.bill_id
      LEFT JOIN ncr_items ni ON ni.ncr_id = n.id
      LEFT JOIN defect_categories dc ON dc.id = ni.defect_category_id
      WHERE 1=1 ${extra}
      GROUP BY dc.id ORDER BY value DESC LIMIT 5
    `).all(...params);

    const HERO_STATS = [
      { value: agg.total || 0, label: 'NCR ทั้งหมด', color: '#1A3A5C' },
      { value: agg.open || 0, label: 'เปิดอยู่', color: '#DC2626' },
      { value: agg.closed || 0, label: 'ปิดแล้ว', color: '#16A34A' },
      { value: agg.major || 0, label: 'Major', color: '#DC2626' },
      { value: agg.minor || 0, label: 'Minor', color: '#D97706' },
    ];
    const heroCells = HERO_STATS.map(h => `
      <div class="hero-box" style="border-top:4px solid ${h.color};">
        <div class="hero-value" style="color:${h.color};">${esc(h.value)}</div>
        <div class="hero-label">${esc(h.label)}</div>
      </div>`).join('');

    const defectRows = defectBreakdown.length
      ? defectBreakdown.map(d => `<tr><td>${esc(d.name)}</td><td style="text-align:right;">${d.value}</td></tr>`).join('')
      : `<tr><td colspan="2" class="no-data-inline">ไม่มีข้อมูล</td></tr>`;

    const theadRow = `<tr><th>รหัส NCR</th><th>Supplier</th><th style="text-align:right;">รายการ</th><th>ระดับ</th><th>วันที่เปิด</th><th>สถานะ</th></tr>`;
    const dataRows = ncrs.map(n => `
      <tr>
        <td>${esc(n.ncr_code)}</td>
        <td>${esc(n.supplier_name || '-')}</td>
        <td style="text-align:right;">${n.item_count}</td>
        <td>${n.severity === 'major' ? 'Major' : 'Minor'}</td>
        <td>${esc((n.created_at || '').slice(0, 10))}</td>
        <td>${esc(statusLabel(n.status))}</td>
      </tr>`).join('');

    const rangeLabel = pdfRangeLabel(from, to);
    const { headerTemplate, footerTemplate } = reportPdfHeaderFooter(req, 'รายงาน NCR (NCR Report)', rangeLabel);

    const html = `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8">
<style>${reportPdfStyle()}</style>
</head><body>
<div class="hero-row">${heroCells}</div>
<div class="split-row">
  <div class="split-col">
    <div class="split-heading">สัดส่วน NCR ตามกลุ่มปัญหา (Top 5)</div>
    <table><thead><tr><th>กลุ่มปัญหา</th><th style="text-align:right;">NCR</th></tr></thead><tbody>${defectRows}</tbody></table>
  </div>
</div>
<div class="section-title">รายการ NCR (${ncrs.length})</div>
${ncrs.length === 0
  ? '<div class="no-data">ไม่มีข้อมูล</div>'
  : `<table><thead>${theadRow}</thead><tbody>${dataRows}</tbody></table>`}
</body></html>`;

    await sendReportPdf(res, html, headerTemplate, footerTemplate, `report-ncr-${from||'all'}-${to||'all'}.pdf`);
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: 'Export ไม่สำเร็จ: ' + e.message });
  }
});

// ===== GET /api/reports/uai/pdf — รายงาน UAI (ตรงกับหน้าจอ Reports/UAIReport.jsx) =====
router.get('/reports/uai/pdf', auth, requireRole(REPORT_ROLES), pdfRateLimit, async (req, res) => {
  try {
    const { from, to, supplier_id } = req.query;
    const dateFilter = buildDateFilter(from, to, 'u.created_at');
    const params = [...dateFilter.params];
    let extra = dateFilter.sql;
    if (supplier_id) { extra += ' AND b.supplier_id = ?'; params.push(supplier_id); }

    const uais = db.prepare(`
      SELECT u.uai_code, n.ncr_code, s.name as supplier_name, u.status, u.created_at
      FROM uai_documents u
      LEFT JOIN ncrs n ON n.id = u.ncr_id
      LEFT JOIN bills b ON b.id = n.bill_id
      LEFT JOIN suppliers s ON s.id = b.supplier_id
      WHERE 1=1 ${extra} ORDER BY u.created_at DESC
    `).all(...params);

    const agg = db.prepare(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN u.status = 'uai_completed' THEN 1 ELSE 0 END) as completed,
             SUM(CASE WHEN u.status NOT IN ('uai_completed','uai_rejected') THEN 1 ELSE 0 END) as pending,
             SUM(CASE WHEN u.status = 'uai_rejected' THEN 1 ELSE 0 END) as rejected
      FROM uai_documents u
      LEFT JOIN ncrs n ON n.id = u.ncr_id
      LEFT JOIN bills b ON b.id = n.bill_id WHERE 1=1 ${extra}
    `).get(...params);

    // Top 5 Supplier มี UAI มากที่สุด (คำขอ user — เดิมหน้านี้ไม่มีกราฟ/ตารางนี้เลย)
    const topUaiSuppliers = db.prepare(`
      SELECT s.name, COUNT(u.id) as uai_count
      FROM uai_documents u
      LEFT JOIN ncrs n ON n.id = u.ncr_id
      LEFT JOIN bills b ON b.id = n.bill_id
      LEFT JOIN suppliers s ON s.id = b.supplier_id
      WHERE 1=1 ${extra}
      GROUP BY s.id ORDER BY uai_count DESC LIMIT 5
    `).all(...params);

    const HERO_STATS = [
      { value: agg.total || 0, label: 'UAI ทั้งหมด', color: '#1A3A5C' },
      { value: agg.completed || 0, label: 'เสร็จสมบูรณ์', color: '#16A34A' },
      { value: agg.pending || 0, label: 'รอดำเนินการ', color: '#D97706' },
      { value: agg.rejected || 0, label: 'ปฏิเสธ', color: '#DC2626' },
    ];
    const heroCells = HERO_STATS.map(h => `
      <div class="hero-box" style="border-top:4px solid ${h.color};">
        <div class="hero-value" style="color:${h.color};">${esc(h.value)}</div>
        <div class="hero-label">${esc(h.label)}</div>
      </div>`).join('');

    const topSuppliersRows = topUaiSuppliers.length
      ? topUaiSuppliers.map(s => `<tr><td>${esc(s.name || '-')}</td><td style="text-align:right;">${s.uai_count}</td></tr>`).join('')
      : `<tr><td colspan="2" class="no-data-inline">ไม่มีข้อมูล</td></tr>`;

    const theadRow = `<tr><th>รหัส UAI</th><th>NCR อ้างอิง</th><th>Supplier</th><th>วันที่ขอ</th><th>สถานะ</th></tr>`;
    const dataRows = uais.map(u => `
      <tr>
        <td>${esc(u.uai_code)}</td>
        <td>${esc(u.ncr_code || '-')}</td>
        <td>${esc(u.supplier_name || '-')}</td>
        <td>${esc((u.created_at || '').slice(0, 10))}</td>
        <td>${esc(statusLabel(u.status))}</td>
      </tr>`).join('');

    const rangeLabel = pdfRangeLabel(from, to);
    const { headerTemplate, footerTemplate } = reportPdfHeaderFooter(req, 'รายงาน UAI (UAI Report)', rangeLabel);

    const html = `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8">
<style>${reportPdfStyle()}</style>
</head><body>
<div class="hero-row">${heroCells}</div>
<div class="split-row">
  <div class="split-col">
    <div class="split-heading">Top 5 Supplier มี UAI มากที่สุด</div>
    <table><thead><tr><th>Supplier</th><th style="text-align:right;">UAI</th></tr></thead><tbody>${topSuppliersRows}</tbody></table>
  </div>
</div>
<div class="section-title">รายการ UAI (${uais.length})</div>
${uais.length === 0
  ? '<div class="no-data">ไม่มีข้อมูล</div>'
  : `<table><thead>${theadRow}</thead><tbody>${dataRows}</tbody></table>`}
</body></html>`;

    await sendReportPdf(res, html, headerTemplate, footerTemplate, `report-uai-${from||'all'}-${to||'all'}.pdf`);
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: 'Export ไม่สำเร็จ: ' + e.message });
  }
});

// ===== DAILY RECEIVING REPORT =====
function getTodayBKK(dateParam) {
  if (dateParam) return dateParam;
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}

function buildDailyReportData(date) {
  const rows = db.prepare(`
    SELECT b.id as bill_id, b.invoice_no, b.po_no, b.container_no, b.received_date, b.status as bill_status,
           s.name as supplier_name,
           bi.id as item_id,
           COALESCE(p.name, bi.item_name) as item_name,
           bi.qty_received, bi.qty_sampled, bi.qty_passed, bi.qty_failed,
           dc.name as defect_category_name, bi.defect_detail
    FROM bills b
    LEFT JOIN suppliers s ON s.id = b.supplier_id
    LEFT JOIN bill_items bi ON bi.bill_id = b.id
    LEFT JOIN products p ON p.id = bi.product_id
    LEFT JOIN defect_categories dc ON dc.id = bi.defect_category_id
    WHERE b.received_date = ? AND b.status != 'cancelled' AND bi.id IS NOT NULL
    ORDER BY b.id, bi.id
  `).all(date);

  const getNcrCodes = db.prepare(`
    SELECT n.ncr_code, n.severity, dc.name as defect_category, ni.defect_detail
    FROM ncr_items ni
    JOIN ncrs n ON n.id = ni.ncr_id
    LEFT JOIN defect_categories dc ON dc.id = ni.defect_category_id
    WHERE ni.bill_item_id = ? AND n.status != 'cancelled'
  `);

  return rows.map(row => ({ ...row, ncr_docs: getNcrCodes.all(row.item_id) }));
}

// ผลตรวจรายแถวสำหรับรายงานสรุปการรับเข้า:
//   ไม่ผ่าน (fail)        = มีเอกสาร NCR (major) หรือพบของเสียแต่ยังไม่ออกเอกสาร
//   ผ่านมีเงื่อนไข (cond) = มีเฉพาะเอกสาร NCP (minor) → ในสรุปนับเป็น "ผ่าน"
//   ผ่าน                  = ไม่มีเอกสารและไม่มีของเสีย
function rowVerdict(row) {
  const docs = row.ncr_docs || [];
  const hasMajor = docs.some(n => n.severity === 'major');
  const hasMinor = docs.some(n => n.severity === 'minor');
  const fail = hasMajor || ((row.qty_failed || 0) > 0 && !hasMinor);
  const conditional = !fail && hasMinor;
  return { fail, conditional };
}

// เหตุผลของเสียดิบจาก bill_items เอง (บันทึกตอน QC ตรวจพบของเสีย ก่อนจะออกเอกสาร NCR/NCP จริง) — ใช้แสดง
// แทน "-" ในรายงาน กรณี qty_failed > 0 แต่ยังไม่มีใครออกเอกสาร NCR/NCP ให้รายการนี้เลย (คนละขั้นตอนกัน:
// พบของเสีย → บันทึกสาเหตุตอนรับเข้า → (ภายหลัง) QC staff/Supervisor ค่อยออกเอกสาร NCR/NCP อีกที)
function rawDefectCauseText(row) {
  return [row.defect_category_name, row.defect_detail].filter(Boolean).join(' — ') || null;
}

// ===== ชิ้นส่วน HTML ตาราง รายงานสรุปการรับเข้า (ใช้ร่วม JPG + PDF) =====
function receivingTablePieces(rows) {
  const dataRows = rows.map((row, i) => {
    const { fail, conditional } = rowVerdict(row);
    const rawCause = rawDefectCauseText(row);
    const ncrHtml = row.ncr_docs.length > 0
      ? row.ncr_docs.map(n => {
          const cause = [n.defect_category, n.defect_detail].filter(Boolean).join(' — ');
          const causeHtml = cause ? `<br/><span style="font-size:10px;color:#374151;">${esc(cause)}</span>` : '';
          return `<span style="font-weight:700;color:${n.severity === 'major' ? '#DC2626' : '#D97706'};">${esc(n.ncr_code)}</span>${causeHtml}`;
        }).join('<br/>')
      : (fail && rawCause
          ? `<span style="font-size:10px;color:#374151;">${esc(rawCause)}</span><br/><span style="font-size:9px;color:#D97706;">(รอออกเอกสาร)</span>`
          : '');
    const resultHtml = fail
      ? `<span style="color:#DC2626;font-weight:700;">ไม่ผ่าน</span>`
      : conditional
        ? `<span style="color:#D97706;font-weight:700;">ผ่าน (มีเงื่อนไข)</span>`
        : `<span style="color:#16A34A;font-weight:700;">ผ่าน</span>`;
    const rowBg = fail ? 'background:#FFF5F5;' : conditional ? 'background:#FFFBEB;' : (i % 2 === 1 ? 'background:#F9FAFB;' : '');
    return `<tr style="${rowBg}">
      <td style="text-align:center;">${i + 1}</td>
      <td>${esc(row.supplier_name || '-')}</td>
      <td style="font-family:monospace;font-size:11px;">${esc(row.invoice_no || '-')}</td>
      <td style="font-family:monospace;font-size:11px;">${esc(row.po_no || '-')}</td>
      <td style="font-family:monospace;font-size:11px;">${esc(row.container_no || '-')}</td>
      <td>${esc(row.item_name || '-')}</td>
      <td style="text-align:right;">${row.qty_received || 0}</td>
      <td style="text-align:right;">${row.qty_sampled || 0}</td>
      <td style="text-align:right;color:#16A34A;font-weight:600;">${row.qty_passed || 0}</td>
      <td style="text-align:right;${fail ? 'color:#DC2626;font-weight:700;' : ''}">${row.qty_failed || 0}</td>
      <td style="text-align:center;">${resultHtml}</td>
      <td>${ncrHtml || '<span style="color:#9CA3AF;">-</span>'}</td>
    </tr>`;
  }).join('');

  const totalItems = rows.length;
  const failItems  = rows.filter(r => rowVerdict(r).fail).length;
  const passItems  = totalItems - failItems;
  const passPct    = totalItems > 0 ? ((passItems / totalItems) * 100).toFixed(1) : '0.0';

  const theadRow = `<tr>
    <th style="width:36px;text-align:center;">#</th>
    <th style="min-width:120px;">ผู้ผลิต</th>
    <th style="width:110px;">Invoice No.</th>
    <th style="width:110px;">PO No.</th>
    <th style="width:110px;">Container No.</th>
    <th style="min-width:140px;">รายการสินค้า</th>
    <th style="width:60px;text-align:right;">รับเข้า</th>
    <th style="width:60px;text-align:right;">สุ่มตรวจ</th>
    <th style="width:50px;text-align:right;">ผ่าน</th>
    <th style="width:65px;text-align:right;">ไม่ผ่าน</th>
    <th style="width:80px;text-align:center;">ผล</th>
    <th style="min-width:110px;">เอกสาร NCR/NCP</th>
  </tr>`;

  const summaryCells = `
    <td colspan="6" style="text-align:right;padding-right:12px;">สรุป รายการรับเข้า ทั้งหมด</td>
    <td style="text-align:right;">${totalItems}</td>
    <td></td>
    <td style="text-align:right;color:#16A34A;">${passItems}</td>
    <td style="text-align:right;color:#DC2626;">${failItems}</td>
    <td style="text-align:center;">${passPct}%</td>
    <td></td>`;

  return { dataRows, theadRow, summaryCells, totalItems };
}

router.get('/reports/receiving/today/excel', auth, async (req, res) => {
  try {
    const date = getTodayBKK(req.query.date);
    const rows = buildDailyReportData(date);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('สรุปรับเข้าวันนี้');
    ws.columns = [
      { header: '#',               key: 'no',            width: 6  },
      { header: 'ผู้ผลิต',         key: 'supplier_name', width: 25 },
      { header: 'Invoice No.',     key: 'invoice_no',    width: 18 },
      { header: 'PO No.',          key: 'po_no',         width: 18 },
      { header: 'Container No.',   key: 'container_no',  width: 18 },
      { header: 'รายการสินค้า',    key: 'item_name',     width: 30 },
      { header: 'รับเข้า',         key: 'qty_received',  width: 10 },
      { header: 'สุ่มตรวจ',        key: 'qty_sampled',   width: 10 },
      { header: 'ผ่าน',            key: 'qty_passed',    width: 10 },
      { header: 'ไม่ผ่าน',         key: 'qty_failed',    width: 10 },
      { header: 'ผลการตรวจ',       key: 'result',        width: 12 },
      { header: 'เอกสาร NCR/NCP',  key: 'ncr_codes',     width: 30 },
    ];
    ws.getRow(1).eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3A5C' } };
      cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    rows.forEach((row, i) => {
      const { fail, conditional } = rowVerdict(row);
      const rawCause = rawDefectCauseText(row);
      const ncrCodes = row.ncr_docs.length > 0
        ? row.ncr_docs.map(n => {
            const cause = [n.defect_category, n.defect_detail].filter(Boolean).join(' — ');
            return cause ? `${n.ncr_code} (${cause})` : n.ncr_code;
          }).join('\n')
        : (fail && rawCause ? `${rawCause} (รอออกเอกสาร)` : '');
      const exRow = ws.addRow({
        no: i + 1,
        supplier_name: row.supplier_name || '-',
        invoice_no:    row.invoice_no    || '-',
        po_no:         row.po_no         || '-',
        container_no:  row.container_no  || '-',
        item_name:     row.item_name     || '-',
        qty_received:  row.qty_received  || 0,
        qty_sampled:   row.qty_sampled   || 0,
        qty_passed:    row.qty_passed    || 0,
        qty_failed:    row.qty_failed    || 0,
        result:        fail ? 'ไม่ผ่าน' : conditional ? 'ผ่าน (มีเงื่อนไข)' : 'ผ่าน',
        ncr_codes:     ncrCodes          || '-',
      });
      exRow.getCell('ncr_codes').alignment = { wrapText: true, vertical: 'top' };
      if (fail) {
        exRow.getCell('result').font   = { color: { argb: 'FFDC2626' }, bold: true };
        exRow.getCell('qty_failed').font = { color: { argb: 'FFDC2626' }, bold: true };
      } else if (conditional) {
        exRow.getCell('result').font = { color: { argb: 'FFD97706' }, bold: true };
      } else {
        exRow.getCell('result').font = { color: { argb: 'FF16A34A' }, bold: true };
      }
    });

    if (rows.length > 0) {
      ws.addRow([]);
      // นับเป็น "รายการ": ไม่ผ่าน = มีเอกสาร NCR (major); NCP (minor) นับเป็นผ่านแบบมีเงื่อนไข
      const totalItems = rows.length;
      const failItems  = rows.filter(r => rowVerdict(r).fail).length;
      const passItems  = totalItems - failItems;
      const passPct    = totalItems > 0 ? ((passItems / totalItems) * 100).toFixed(1) : '0.0';
      // รับเข้า/ผ่าน/ไม่ผ่าน = จำนวนรายการ (ตัวเลขล้วน), เปอร์เซ็นต์ผ่านไปอยู่ช่อง "ผลการตรวจ"
      const sumRow = ws.addRow(['', 'สรุป รายการรับเข้า ทั้งหมด', '', '', '', '',
        totalItems, '', passItems, failItems, `${passPct}%`, '']);
      sumRow.font = { bold: true };
    }

    ws.addRow([]);
    const infoRow = ws.addRow([`ผู้ออกรายงาน: ${req.user.full_name}`, '', '', '', '',
      '', '', '', '', '', '', `วันที่: ${new Date().toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Bangkok' })}`]);
    infoRow.font = { italic: true, color: { argb: 'FF6B7280' } };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="receiving-today-${date}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: 'Export ไม่สำเร็จ: ' + e.message });
  }
});

router.get('/reports/receiving/today/jpg', auth, pdfRateLimit, async (req, res) => {
  try {
    const date = getTodayBKK(req.query.date);
    const rows = buildDailyReportData(date);
    const companyHeader = getCompanyHeader();
    const thDate = new Date(date + 'T00:00:00').toLocaleDateString('th-TH', { dateStyle: 'long', timeZone: 'Asia/Bangkok' });

    const { dataRows, theadRow, summaryCells } = receivingTablePieces(rows);

    const html = `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8">
<style>
  ${FONT_FACE_CSS}
  body{font-family:'IBM Plex Sans Thai','Segoe UI',Arial,sans-serif;font-size:13px;color:#1F2937;padding:24px;background:#fff;}
  h1{font-size:20px;color:#1A3A5C;margin:0 0 4px;}
  .meta{font-size:11px;color:#6B7280;margin-bottom:16px;}
  table{width:100%;border-collapse:collapse;}
  th{background:#1A3A5C;color:#fff;padding:7px 8px;font-size:12px;text-align:left;white-space:nowrap;}
  td{padding:6px 8px;border-bottom:1px solid #E5E7EB;font-size:12px;vertical-align:middle;}
  tfoot td{border-top:2px solid #1A3A5C;font-weight:700;background:#F3F4F6;}
  .no-data{text-align:center;color:#6B7280;padding:40px;font-size:14px;}
</style>
</head><body>
${companyHeader}
<h1>รายงานสรุปการรับเข้าสินค้า</h1>
<div class="meta">วันที่: ${esc(thDate)} &nbsp;|&nbsp; Export: ${new Date().toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Bangkok' })} &nbsp;|&nbsp; ผู้ออกรายงาน: ${esc(req.user.full_name)} &nbsp;|&nbsp; ${rows.length} รายการ</div>
${rows.length === 0
  ? '<div class="no-data">ไม่มีข้อมูลรับเข้าวันนี้</div>'
  : `<table>
  <thead>${theadRow}</thead>
  <tbody>${dataRows}</tbody>
  <tfoot><tr>${summaryCells}</tr></tfoot>
</table>`}
</body></html>`;

    await acquirePdfSlot();
    let ctx;
    try {
      const { page, context } = await openIsolatedPage();
      ctx = context;
      await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1.5 });
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      await page.evaluate(async () => { await document.fonts.ready; });
      const buffer  = await page.screenshot({ type: 'jpeg', quality: 92, fullPage: true });
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Content-Disposition', `attachment; filename="receiving-today-${date}.jpg"`);
      res.send(buffer);
    } finally {
      await closeIsolated(ctx);
      releasePdfSlot();
    }
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: 'Export ไม่สำเร็จ: ' + e.message });
  }
});

// ===== GET /api/reports/receiving/today/pdf — รายงานสรุปการรับเข้า (PDF หลายหน้า) =====
// แบ่งหน้าอัตโนมัติเมื่อข้อมูลตกหน้า + หัวเอกสารซ้ำทุกหน้า + เลขหน้าด้านล่าง (หน้า {รวม}/{ปัจจุบัน})
router.get('/reports/receiving/today/pdf', auth, pdfRateLimit, async (req, res) => {
  try {
    const date = getTodayBKK(req.query.date);
    const rows = buildDailyReportData(date);
    const thDate = new Date(date + 'T00:00:00').toLocaleDateString('th-TH', { dateStyle: 'long', timeZone: 'Asia/Bangkok' });
    const exportTime = new Date().toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Bangkok' });
    const { dataRows, theadRow, summaryCells } = receivingTablePieces(rows);

    // หัวเอกสาร (ซ้ำทุกหน้า) — headerTemplate ของ puppeteer ต้องกำหนด style เอง (ไม่รับ CSS จาก body)
    const companyName = db.getSetting('company_name') || '';
    const logoFile = db.getSetting('company_logo') || '';
    const logoSrc = logoFile ? (imgToBase64('general', logoFile) || '') : '';
    const headerTemplate = `
      <div style="font-family:'IBM Plex Sans Thai','Tahoma','Leelawadee UI',sans-serif;width:100%;padding:0 8mm;box-sizing:border-box;color:#1F2937;">
        <div style="display:flex;align-items:center;gap:8px;border-bottom:2px solid #1A3A5C;padding-bottom:4px;">
          ${logoSrc ? `<img src="${logoSrc}" style="max-height:32px;max-width:110px;object-fit:contain;" />` : ''}
          <div style="flex:1;">
            ${companyName ? `<div style="font-size:10px;font-weight:700;color:#1A3A5C;">${esc(companyName)}</div>` : ''}
            <div style="font-size:12px;font-weight:700;color:#1A3A5C;">รายงานสรุปการรับเข้าสินค้า</div>
            <div style="font-size:8px;color:#6B7280;">วันที่: ${esc(thDate)} &nbsp;|&nbsp; Export: ${esc(exportTime)} &nbsp;|&nbsp; ผู้ออกรายงาน: ${esc(req.user.full_name)} &nbsp;|&nbsp; ${rows.length} ราย</div>
          </div>
        </div>
      </div>`;
    const footerTemplate = `
      <div style="font-family:'IBM Plex Sans Thai','Tahoma','Leelawadee UI',sans-serif;font-size:9px;color:#6B7280;width:100%;text-align:center;">
        หน้า <span class="pageNumber"></span>/<span class="totalPages"></span>
      </div>`;

    const html = `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8">
<style>
  ${FONT_FACE_CSS}
  body{font-family:'IBM Plex Sans Thai','Segoe UI',Arial,sans-serif;font-size:11px;color:#1F2937;margin:0;}
  table{width:100%;border-collapse:collapse;}
  thead{display:table-header-group;}
  th{background:#1A3A5C;color:#fff;padding:6px;font-size:10px;text-align:left;white-space:nowrap;}
  td{padding:5px 6px;border-bottom:1px solid #E5E7EB;font-size:10px;vertical-align:middle;}
  tr{page-break-inside:avoid;}
  .sumrow td{border-top:2px solid #1A3A5C;font-weight:700;background:#F3F4F6;}
  .no-data{text-align:center;color:#6B7280;padding:40px;font-size:14px;}
</style>
</head><body>
${rows.length === 0
  ? '<div class="no-data">ไม่มีข้อมูลรับเข้าวันนี้</div>'
  : `<table><thead>${theadRow}</thead><tbody>${dataRows}<tr class="sumrow">${summaryCells}</tr></tbody></table>`}
</body></html>`;

    await acquirePdfSlot();
    let ctx;
    try {
      const { page, context } = await openIsolatedPage();
      ctx = context;
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      await page.evaluate(async () => { await document.fonts.ready; });
      const buffer = await page.pdf({
        format: 'A4',
        landscape: true,
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate,
        footerTemplate,
        margin: { top: '30mm', bottom: '14mm', left: '8mm', right: '8mm' },
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="receiving-today-${date}.pdf"`);
      res.send(buffer);
    } finally {
      await closeIsolated(ctx);
      releasePdfSlot();
    }
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: 'Export ไม่สำเร็จ: ' + e.message });
  }
});

// ===== GET /api/purchasing-dashboard/pdf — Export Purchasing Dashboard เป็น PDF =====
// scope ตาม role ผู้เรียกเหมือนหน้าจอ (purchasing เห็นเฉพาะ supplier ที่ดูแล, purchasing_manager/admin เห็นทั้งหมด)
// — ใช้ purchasingDashboardService ตัวเดียวกับที่หน้าจอเรียก ไม่มี query ซ้ำ
// ออกแบบใหม่ทั้งหมด (Session 127 ตามคำขอ user) ให้เนื้อหา/สัดส่วนสอดคล้องกับหน้าจอ PurchasingDash.jsx จริงที่ทำ
// ไปก่อนหน้านี้ใน session เดียวกัน (Hero KPI 4 ช่อง + กราฟ bucket + วงกลมอัตราปิดงาน) แทนตาราง stat-box แบนราบ 11
// ช่องเดิมที่ไม่มีลำดับความสำคัญเลย — เพิ่มตาราง "รายการเกินกำหนด" ใหม่ (ข้อมูลที่ actionable ที่สุดแต่ PDF เดิม
// ไม่เคยมีเลย ทั้งที่หน้าจอ hero stat วง "เกินกำหนด" เน้นด้วย emphasize/ขอบแดงอยู่แล้ว) ก่อนตาราง supplier summary
// เดิม (คงไว้แต่จัดสไตล์ใหม่ให้เข้าชุด) — วงกลม % ปิดงานใช้ conic-gradient ล้วน (Chromium ใน Puppeteer เรนเดอร์ได้
// เต็มที่ ไม่ต้องพึ่งรูปภาพ/chart library ฝั่ง server)
router.get('/purchasing-dashboard/pdf', auth, requireRole(['purchasing', 'purchasing_manager', 'admin']), pdfRateLimit, async (req, res) => {
  try {
    const summary = purchasingDashboardService.getSummary(req.user);
    const { data: suppliers } = purchasingDashboardService.getSuppliers(req.user, { limit: 1000, sort: 'name', dir: 'asc' });
    const { data: overdueItems, total: overdueTotal } = purchasingDashboardService.getNcrList(req.user, { overdue: '1', limit: 50, page: 1 });
    const exportTime = new Date().toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Bangkok' });

    const activeWork = (summary.ncr_waiting_review || 0) + (summary.ncr_waiting_send_link || 0)
      + (summary.ncr_waiting_supplier_response || 0) + (summary.ncr_in_progress || 0);
    const closedAll = (summary.ncr_closed || 0) + (summary.ncp_closed || 0);
    const totalAll = (summary.ncr_total || 0) + (summary.ncp_total || 0);
    const closingPct = totalAll > 0 ? Math.round((closedAll / totalAll) * 100) : 0;

    // Hero KPI — 4 ช่องหลัก ตรงกับ HeroStat 4 ใบบนหน้าจอเป๊ะ (primary/warning/success/danger)
    const HERO_STATS = [
      { value: summary.supplier_count, label: 'Supplier ที่ดูแล', color: '#1A3A5C' },
      { value: activeWork, label: 'งานที่ต้องดำเนินการ', color: '#D97706' },
      { value: closedAll, label: 'ปิดแล้ว', color: '#16A34A' },
      { value: summary.overdue, label: 'เกินกำหนด', color: '#DC2626' },
    ];
    const heroCells = HERO_STATS.map(h => `
      <div class="hero-box" style="border-top:4px solid ${h.color};">
        <div class="hero-value" style="color:${h.color};">${esc(h.value ?? 0)}</div>
        <div class="hero-label">${esc(h.label)}</div>
      </div>`).join('');

    // แถบ bucket breakdown — ตรงกับ BucketBarChart บนหน้าจอ (6 หมวดเดียวกัน + สีเดียวกัน)
    const BUCKET_BARS = [
      { label: 'รอ Review', value: summary.ncr_waiting_review || 0, color: '#D97706' },
      { label: 'รอส่ง Link', value: summary.ncr_waiting_send_link || 0, color: '#D97706' },
      { label: 'รอ Supplier ตอบ', value: summary.ncr_waiting_supplier_response || 0, color: '#2E6DA4' },
      { label: 'กำลังดำเนินการ', value: summary.ncr_in_progress || 0, color: '#2E6DA4' },
      { label: 'ปิดแล้ว', value: closedAll, color: '#16A34A' },
      { label: 'เกินกำหนด', value: summary.overdue || 0, color: '#DC2626' },
    ];
    const maxBucket = Math.max(1, ...BUCKET_BARS.map(b => b.value));
    const bucketRows = BUCKET_BARS.map(b => `
      <div class="bucket-row">
        <div class="bucket-label">${esc(b.label)}</div>
        <div class="bucket-track"><div class="bucket-fill" style="width:${Math.round((b.value / maxBucket) * 100)}%;background:${b.color};"></div></div>
        <div class="bucket-value">${b.value}</div>
      </div>`).join('');

    // วงกลมอัตราปิดงาน — conic-gradient ล้วน ไม่พึ่งรูปภาพ/chart library
    const donutHtml = `
      <div class="donut" style="background:conic-gradient(#16A34A 0% ${closingPct}%, #E5E7EB ${closingPct}% 100%);">
        <div class="donut-hole">
          <div class="donut-pct">${closingPct}%</div>
          <div class="donut-sub">ปิดแล้ว (${closedAll}/${totalAll})</div>
        </div>
      </div>`;

    // ตารางรายการเกินกำหนด — ข้อมูลใหม่ที่ PDF เดิมไม่เคยมี (actionable ที่สุดของหน้า dashboard)
    const overdueTheadRow = `<tr><th>รหัส NCR/NCP</th><th>ผู้ผลิต</th><th>ประเภท</th><th>สถานะ</th><th>วันที่เปิด</th><th>กำหนดเสร็จ</th><th>เกินมา (วัน)</th></tr>`;
    const todayMs = Date.now();
    const overdueDataRows = overdueItems.map(n => {
      const dueMs = n.disposition_due_date ? new Date(n.disposition_due_date + 'T00:00:00').getTime() : null;
      const daysOver = dueMs ? Math.max(0, Math.round((todayMs - dueMs) / 86400000)) : '-';
      return `
      <tr>
        <td>${esc(n.ncr_code)}</td>
        <td>${esc(n.supplier_name)}</td>
        <td>${n.severity === 'major' ? 'NCR' : 'NCP'}</td>
        <td>${esc(statusLabel(n.status))}</td>
        <td>${esc((n.created_at || '').slice(0, 10))}</td>
        <td>${esc(n.disposition_due_date || '-')}</td>
        <td style="color:#DC2626;font-weight:700;">${daysOver}</td>
      </tr>`;
    }).join('');
    const overdueSection = summary.overdue > 0 ? `
      <div class="section-title overdue-title">รายการเกินกำหนด (${overdueTotal})</div>
      <table><thead>${overdueTheadRow}</thead><tbody>${overdueDataRows}</tbody></table>
      ${overdueTotal > overdueItems.length ? `<div class="note">แสดง ${overdueItems.length} จาก ${overdueTotal} รายการ — ดูรายการทั้งหมดในระบบ</div>` : ''}
    ` : `
      <div class="section-title">รายการเกินกำหนด</div>
      <div class="no-data-inline">ไม่มีรายการเกินกำหนด</div>
    `;

    const theadRow = `<tr>
      <th>รหัส</th><th>ผู้ผลิต</th><th>สถานะ</th><th>NCR</th><th>NCP</th><th>เปิด</th>
      <th>รอ Review</th><th>รอส่ง Link</th><th>รอ Supplier ตอบกลับ</th><th>กำลังดำเนินการ</th><th>ปิดแล้ว</th><th>เกินกำหนด</th>
    </tr>`;
    const dataRows = suppliers.map(s => `
      <tr>
        <td>${esc(s.code || '-')}</td>
        <td>${esc(s.name)}</td>
        <td>${s.is_active ? 'ใช้งาน' : 'ปิดใช้งาน'}</td>
        <td>${s.ncr_total}</td><td>${s.ncp_total}</td><td>${s.open_count}</td>
        <td>${s.waiting_review_count}</td><td>${s.waiting_send_link_count}</td><td>${s.waiting_supplier_response_count}</td>
        <td>${s.in_progress_count}</td><td>${s.closed_count}</td>
        <td${s.overdue_count > 0 ? ' style="color:#DC2626;font-weight:700;"' : ''}>${s.overdue_count}</td>
      </tr>`).join('');

    const companyName = db.getSetting('company_name') || '';
    const logoFile = db.getSetting('company_logo') || '';
    const logoSrc = logoFile ? (imgToBase64('general', logoFile) || '') : '';
    const headerTemplate = `
      <div style="font-family:'IBM Plex Sans Thai','Tahoma','Leelawadee UI',sans-serif;width:100%;padding:0 8mm;box-sizing:border-box;color:#1F2937;">
        <div style="display:flex;align-items:center;gap:8px;border-bottom:2px solid #1A3A5C;padding-bottom:4px;">
          ${logoSrc ? `<img src="${logoSrc}" style="max-height:32px;max-width:110px;object-fit:contain;" />` : ''}
          <div style="flex:1;">
            ${companyName ? `<div style="font-size:10px;font-weight:700;color:#1A3A5C;">${esc(companyName)}</div>` : ''}
            <div style="font-size:12px;font-weight:700;color:#1A3A5C;">รายงาน Dashboard จัดซื้อ</div>
            <div style="font-size:8px;color:#6B7280;">ผู้ออกรายงาน: ${esc(req.user.full_name)} &nbsp;|&nbsp; Export: ${esc(exportTime)} &nbsp;|&nbsp; ${suppliers.length} Supplier</div>
          </div>
        </div>
      </div>`;
    const footerTemplate = `
      <div style="font-family:'IBM Plex Sans Thai','Tahoma','Leelawadee UI',sans-serif;font-size:9px;color:#6B7280;width:100%;text-align:center;">
        หน้า <span class="pageNumber"></span>/<span class="totalPages"></span>
      </div>`;

    const html = `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8">
<style>
  ${FONT_FACE_CSS}
  body{font-family:'IBM Plex Sans Thai','Segoe UI',Arial,sans-serif;font-size:11px;color:#1F2937;margin:0;}
  .section-title{font-size:14px;font-weight:700;color:#1A3A5C;margin:16px 0 8px;border-bottom:2px solid #1A3A5C;padding-bottom:4px;page-break-after:avoid;}
  .section-title:first-child{margin-top:0;}
  .overdue-title{border-bottom-color:#DC2626;color:#DC2626;}

  /* Hero KPI row */
  .hero-row{display:flex;gap:10px;margin-bottom:16px;}
  .hero-box{flex:1;border:1px solid #D1D5DB;border-radius:6px;padding:10px 12px;background:#F5F6F8;}
  .hero-value{font-size:26px;font-weight:700;line-height:1.1;}
  .hero-label{font-size:10px;color:#6B7280;margin-top:4px;}

  /* Bucket breakdown + donut row */
  .split-row{display:flex;gap:16px;margin-bottom:8px;align-items:stretch;}
  .split-left{flex:2;border:1px solid #D1D5DB;border-radius:6px;padding:12px;}
  .split-right{flex:1;border:1px solid #D1D5DB;border-radius:6px;padding:12px;display:flex;flex-direction:column;align-items:center;justify-content:center;}
  .split-heading{font-size:11px;font-weight:700;color:#1A3A5C;margin-bottom:8px;}
  .bucket-row{display:flex;align-items:center;gap:8px;margin-bottom:6px;}
  .bucket-label{width:100px;font-size:9px;color:#6B7280;flex-shrink:0;}
  .bucket-track{flex:1;height:8px;background:#E5E7EB;border-radius:4px;overflow:hidden;}
  .bucket-fill{height:100%;border-radius:4px;}
  .bucket-value{width:24px;text-align:right;font-size:9px;font-weight:700;color:#1F2937;flex-shrink:0;}
  .donut{width:110px;height:110px;border-radius:50%;display:flex;align-items:center;justify-content:center;}
  .donut-hole{width:76px;height:76px;border-radius:50%;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;}
  .donut-pct{font-size:18px;font-weight:700;color:#16A34A;}
  .donut-sub{font-size:7px;color:#6B7280;text-align:center;}

  table{width:100%;border-collapse:collapse;margin-bottom:6px;}
  thead{display:table-header-group;}
  th{background:#1A3A5C;color:#fff;padding:6px;font-size:10px;text-align:left;white-space:nowrap;}
  td{padding:5px 6px;border-bottom:1px solid #E5E7EB;font-size:10px;vertical-align:middle;}
  tr{page-break-inside:avoid;}
  tr:nth-child(even) td{background:#F9FAFB;}
  .no-data{text-align:center;color:#6B7280;padding:40px;font-size:14px;}
  .no-data-inline{color:#16A34A;font-size:10px;padding:6px 0 12px;}
  .note{color:#6B7280;font-size:9px;margin:-2px 0 12px;}
</style>
</head><body>
<div class="hero-row">${heroCells}</div>
<div class="split-row">
  <div class="split-left">
    <div class="split-heading">สถานะ NCR/NCP</div>
    ${bucketRows}
  </div>
  <div class="split-right">
    <div class="split-heading">อัตราปิดงาน</div>
    ${donutHtml}
  </div>
</div>
${overdueSection}
<div class="section-title">ผู้ผลิตของฉัน (${suppliers.length})</div>
${suppliers.length === 0
  ? '<div class="no-data">ไม่มีข้อมูล Supplier</div>'
  : `<table><thead>${theadRow}</thead><tbody>${dataRows}</tbody></table>`}
</body></html>`;

    await acquirePdfSlot();
    let ctx;
    try {
      const { page, context } = await openIsolatedPage();
      ctx = context;
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      await page.evaluate(async () => { await document.fonts.ready; });
      const buffer = await page.pdf({
        format: 'A4',
        landscape: true,
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate,
        footerTemplate,
        margin: { top: '30mm', bottom: '14mm', left: '8mm', right: '8mm' },
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="purchasing-dashboard-${new Date().toISOString().slice(0, 10)}.pdf"`);
      res.send(buffer);
    } finally {
      await closeIsolated(ctx);
      releasePdfSlot();
    }
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: 'Export ไม่สำเร็จ: ' + e.message });
  }
});

// ===== GET /api/reports/bills/excel — Export ข้อมูลบิลรับเข้าแบบมีเงื่อนไข =====
// filters: supplier_id, from, to (received_date), invoice, po, container,
//          doc_filter = all | ncr | ncp | both | any | none
router.get('/reports/bills/excel', auth, async (req, res) => {
  try {
    const { supplier_id, from, to, invoice, po, container, doc_filter = 'all' } = req.query;

    let where = "b.status != 'cancelled'";
    const params = [];
    if (supplier_id) { where += ' AND b.supplier_id = ?'; params.push(supplier_id); }
    if (from)        { where += ' AND b.received_date >= ?'; params.push(from); }
    if (to)          { where += ' AND b.received_date <= ?'; params.push(to); }
    if (invoice)     { where += ' AND b.invoice_no LIKE ?'; params.push(`%${invoice}%`); }
    if (po)          { where += ' AND b.po_no LIKE ?'; params.push(`%${po}%`); }
    if (container)   { where += ' AND COALESCE(b.container_no,\'\') LIKE ?'; params.push(`%${container}%`); }

    // EXISTS เอกสาร NCR (major) / NCP (minor) ผูกกับ bill_items ของบิลนี้
    const existsSev = (sev) => `EXISTS (
      SELECT 1 FROM ncrs n JOIN ncr_items ni ON ni.ncr_id = n.id
      JOIN bill_items bi ON bi.id = ni.bill_item_id
      WHERE bi.bill_id = b.id AND n.status != 'cancelled' AND n.severity = '${sev}')`;
    const hasMajor = existsSev('major');
    const hasMinor = existsSev('minor');
    if (doc_filter === 'ncr')       where += ` AND ${hasMajor}`;
    else if (doc_filter === 'ncp')  where += ` AND ${hasMinor}`;
    else if (doc_filter === 'both') where += ` AND ${hasMajor} AND ${hasMinor}`;
    else if (doc_filter === 'any')  where += ` AND (${hasMajor} OR ${hasMinor})`;
    else if (doc_filter === 'none') where += ` AND NOT (${hasMajor} OR ${hasMinor})`;

    const rows = db.prepare(`
      SELECT b.id, b.invoice_no, b.po_no, b.container_no, b.tracking_no, b.received_date, b.status,
             s.name as supplier_name,
             (SELECT COUNT(*) FROM bill_items bi WHERE bi.bill_id = b.id) as item_count,
             (SELECT COUNT(*) FROM bill_items bi WHERE bi.bill_id = b.id AND bi.qty_failed > 0) as failed_item_count,
             (SELECT GROUP_CONCAT(DISTINCT n.ncr_code) FROM ncrs n
                JOIN ncr_items ni ON ni.ncr_id = n.id
                JOIN bill_items bi ON bi.id = ni.bill_item_id
                WHERE bi.bill_id = b.id AND n.status != 'cancelled' AND n.severity = 'major') as ncr_codes,
             (SELECT GROUP_CONCAT(DISTINCT n.ncr_code) FROM ncrs n
                JOIN ncr_items ni ON ni.ncr_id = n.id
                JOIN bill_items bi ON bi.id = ni.bill_item_id
                WHERE bi.bill_id = b.id AND n.status != 'cancelled' AND n.severity = 'minor') as ncp_codes
      FROM bills b
      LEFT JOIN suppliers s ON s.id = b.supplier_id
      WHERE ${where}
      GROUP BY b.id
      ORDER BY b.received_date DESC, b.id DESC
      LIMIT 5000
    `).all(...params);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('บิลรับเข้า');
    ws.columns = [
      { header: '#',              key: 'no',            width: 6  },
      { header: 'Invoice No.',    key: 'invoice_no',    width: 18 },
      { header: 'PO No.',         key: 'po_no',         width: 18 },
      { header: 'Container No.',  key: 'container_no',  width: 18 },
      { header: 'Tracking No.',   key: 'tracking_no',   width: 18 },
      { header: 'ผู้ผลิต',        key: 'supplier_name', width: 25 },
      { header: 'วันที่รับเข้า',  key: 'received_date',  width: 14 },
      { header: 'จำนวนรายการ',    key: 'item_count',    width: 12 },
      { header: 'รายการไม่ผ่าน',  key: 'failed_item_count', width: 14 },
      { header: 'เอกสาร NCR',     key: 'ncr_codes',     width: 24 },
      { header: 'เอกสาร NCP',     key: 'ncp_codes',     width: 24 },
      { header: 'สถานะบิล',       key: 'status',        width: 14 },
    ];
    ws.getRow(1).eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3A5C' } };
      cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    rows.forEach((r, i) => {
      ws.addRow({
        no: i + 1,
        invoice_no:   r.invoice_no   || '-',
        po_no:        r.po_no        || '-',
        container_no: r.container_no || '-',
        tracking_no:  r.tracking_no  || '-',
        supplier_name: r.supplier_name || '-',
        received_date: r.received_date || '-',
        item_count:   r.item_count   || 0,
        failed_item_count: r.failed_item_count || 0,
        ncr_codes:    r.ncr_codes    || '-',
        ncp_codes:    r.ncp_codes    || '-',
        status:       statusLabel(r.status),
      });
    });

    ws.addRow([]);
    const docLabel = { all: 'ทั้งหมด', ncr: 'มี NCR', ncp: 'มี NCP', both: 'มีทั้ง NCR และ NCP', any: 'มี NCR หรือ NCP', none: 'ไม่มีเอกสาร' }[doc_filter] || 'ทั้งหมด';
    const fParts = [];
    if (supplier_id) { const sp = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(supplier_id); if (sp) fParts.push(`ผู้ผลิต: ${sp.name}`); }
    if (from || to) fParts.push(`ช่วงรับเข้า: ${from || '...'} ถึง ${to || '...'}`);
    if (invoice)   fParts.push(`Invoice: ${invoice}`);
    if (po)        fParts.push(`PO: ${po}`);
    if (container) fParts.push(`Container: ${container}`);
    fParts.push(`เอกสาร: ${docLabel}`);
    const infoRow = ws.addRow([`เงื่อนไข — ${fParts.join('  |  ')}`]);
    infoRow.font = { italic: true, color: { argb: 'FF6B7280' } };
    const metaRow = ws.addRow([`ผู้ออกรายงาน: ${req.user.full_name}  |  Export: ${new Date().toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Bangkok' })}  |  รวม ${rows.length} บิล`]);
    metaRow.font = { italic: true, color: { argb: 'FF6B7280' } };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="bills-export-${new Date().toISOString().slice(0,10)}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: 'Export ไม่สำเร็จ: ' + e.message });
  }
});

// ===== GET /api/exports/powerbi — Full DB export for Power BI =====
router.get('/powerbi', auth, requireRole(['admin']), pdfRateLimit, async (req, res) => {
  try {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'IQC System';
    wb.created = new Date();

    function sheet(name, cols, rows) {
      const ws = wb.addWorksheet(name);
      ws.columns = cols.map(c => ({ header: c.h, key: c.k, width: c.w || 15 }));
      ws.getRow(1).eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3A5C' } };
        cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 10 };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = { bottom: { style: 'thin', color: { argb: 'FF2E6DA4' } } };
      });
      rows.forEach(r => {
        const row = ws.addRow(r);
        row.eachCell(cell => { cell.font = { size: 10 }; cell.alignment = { vertical: 'middle' }; });
      });
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
    }

    sheet('dim_Suppliers', [
      { h: 'supplier_id', k: 'supplier_id', w: 12 },
      { h: 'code', k: 'code', w: 15 },
      { h: 'name', k: 'name', w: 30 },
      { h: 'email', k: 'email', w: 25 },
      { h: 'phone', k: 'phone', w: 15 },
      { h: 'approval_status', k: 'approval_status', w: 16 },
      { h: 'approval_date', k: 'approval_date', w: 15 },
      { h: 'is_active', k: 'is_active', w: 10 },
      { h: 'notes', k: 'notes', w: 30 },
      { h: 'created_at', k: 'created_at', w: 18 },
    ], db.prepare(`
      SELECT id as supplier_id, code, name, email, phone,
             approval_status, approval_date, is_active, notes, created_at
      FROM suppliers ORDER BY name
    `).all());

    sheet('dim_ProductGroups', [
      { h: 'product_group_id', k: 'product_group_id', w: 16 },
      { h: 'code', k: 'code', w: 12 },
      { h: 'name', k: 'name', w: 25 },
      { h: 'require_inspection_doc', k: 'require_inspection_doc', w: 22 },
      { h: 'require_lot_number', k: 'require_lot_number', w: 18 },
      { h: 'require_expiry_date', k: 'require_expiry_date', w: 18 },
      { h: 'require_certificate', k: 'require_certificate', w: 18 },
      { h: 'has_shelf_life', k: 'has_shelf_life', w: 14 },
      { h: 'shelf_life_days', k: 'shelf_life_days', w: 14 },
      { h: 'is_active', k: 'is_active', w: 10 },
    ], db.prepare(`SELECT id as product_group_id, code, name, require_inspection_doc,
      require_lot_number, require_expiry_date, require_certificate, has_shelf_life, shelf_life_days, is_active
      FROM product_groups ORDER BY name`).all());

    sheet('dim_Products', [
      { h: 'product_id', k: 'product_id', w: 12 },
      { h: 'code', k: 'code', w: 15 },
      { h: 'name', k: 'name', w: 30 },
      { h: 'supplier_id', k: 'supplier_id', w: 12 },
      { h: 'supplier_name', k: 'supplier_name', w: 25 },
      { h: 'product_group_id', k: 'product_group_id', w: 16 },
      { h: 'product_group_name', k: 'product_group_name', w: 22 },
      { h: 'unit_name', k: 'unit_name', w: 12 },
      { h: 'inspection_level', k: 'inspection_level', w: 16 },
      { h: 'aql_value', k: 'aql_value', w: 10 },
      { h: 'is_active', k: 'is_active', w: 10 },
      { h: 'notes', k: 'notes', w: 30 },
    ], db.prepare(`
      SELECT p.id as product_id, p.code, p.name,
             p.supplier_id, s.name as supplier_name,
             p.product_group_id, pg.name as product_group_name,
             un.name as unit_name, p.inspection_level, p.aql_value, p.is_active, p.notes
      FROM products p
      LEFT JOIN suppliers s ON s.id = p.supplier_id
      LEFT JOIN product_groups pg ON pg.id = p.product_group_id
      LEFT JOIN units un ON un.id = p.unit_id
      ORDER BY p.name
    `).all());

    sheet('dim_DefectCategories', [
      { h: 'defect_category_id', k: 'defect_category_id', w: 18 },
      { h: 'code', k: 'code', w: 12 },
      { h: 'name', k: 'name', w: 25 },
      { h: 'notes', k: 'notes', w: 30 },
      { h: 'is_active', k: 'is_active', w: 10 },
    ], db.prepare(`SELECT id as defect_category_id, code, name, notes, is_active FROM defect_categories ORDER BY name`).all());

    sheet('dim_Users', [
      { h: 'user_id', k: 'user_id', w: 10 },
      { h: 'username', k: 'username', w: 18 },
      { h: 'full_name', k: 'full_name', w: 25 },
      { h: 'role', k: 'role', w: 18 },
      { h: 'is_active', k: 'is_active', w: 10 },
      { h: 'created_at', k: 'created_at', w: 18 },
    ], db.prepare(`SELECT id as user_id, username, full_name, role, is_active, created_at FROM users ORDER BY full_name`).all());

    sheet('fact_Bills', [
      { h: 'bill_id', k: 'bill_id', w: 10 },
      { h: 'invoice_no', k: 'invoice_no', w: 18 },
      { h: 'po_no', k: 'po_no', w: 18 },
      { h: 'container_no', k: 'container_no', w: 15 },
      { h: 'supplier_id', k: 'supplier_id', w: 12 },
      { h: 'supplier_name', k: 'supplier_name', w: 28 },
      { h: 'supplier_code', k: 'supplier_code', w: 14 },
      { h: 'received_date', k: 'received_date', w: 14 },
      { h: 'status', k: 'status', w: 18 },
      { h: 'created_by_user_id', k: 'created_by_user_id', w: 16 },
      { h: 'created_by_name', k: 'created_by_name', w: 22 },
      { h: 'created_at', k: 'created_at', w: 18 },
      { h: 'cancelled_at', k: 'cancelled_at', w: 18 },
    ], db.prepare(`
      SELECT b.id as bill_id, b.invoice_no, b.po_no, b.container_no,
             b.supplier_id, s.name as supplier_name, s.code as supplier_code,
             b.received_date, b.status,
             b.created_by as created_by_user_id, u.full_name as created_by_name,
             b.created_at, b.cancelled_at
      FROM bills b
      LEFT JOIN suppliers s ON s.id = b.supplier_id
      LEFT JOIN users u ON u.id = b.created_by
      ORDER BY b.received_date DESC
    `).all());

    sheet('fact_BillItems', [
      { h: 'bill_item_id', k: 'bill_item_id', w: 12 },
      { h: 'bill_id', k: 'bill_id', w: 10 },
      { h: 'invoice_no', k: 'invoice_no', w: 18 },
      { h: 'received_date', k: 'received_date', w: 14 },
      { h: 'supplier_id', k: 'supplier_id', w: 12 },
      { h: 'supplier_name', k: 'supplier_name', w: 25 },
      { h: 'product_id', k: 'product_id', w: 12 },
      { h: 'product_code', k: 'product_code', w: 15 },
      { h: 'product_name', k: 'product_name', w: 28 },
      { h: 'product_group_name', k: 'product_group_name', w: 20 },
      { h: 'item_name', k: 'item_name', w: 28 },
      { h: 'qty_received', k: 'qty_received', w: 12 },
      { h: 'qty_sampled', k: 'qty_sampled', w: 12 },
      { h: 'qty_passed', k: 'qty_passed', w: 12 },
      { h: 'qty_failed', k: 'qty_failed', w: 12 },
      { h: 'defect_category_id', k: 'defect_category_id', w: 18 },
      { h: 'defect_category_name', k: 'defect_category_name', w: 22 },
      { h: 'defect_detail', k: 'defect_detail', w: 30 },
      { h: 'lot_number', k: 'lot_number', w: 15 },
      { h: 'manufacturing_date', k: 'manufacturing_date', w: 18 },
      { h: 'expiry_date', k: 'expiry_date', w: 14 },
      { h: 'inspector_id', k: 'inspector_id', w: 12 },
      { h: 'inspector_name', k: 'inspector_name', w: 22 },
      { h: 'inspected_at', k: 'inspected_at', w: 18 },
      { h: 'created_at', k: 'created_at', w: 18 },
    ], db.prepare(`
      SELECT bi.id as bill_item_id, bi.bill_id,
             b.invoice_no, b.received_date,
             b.supplier_id, s.name as supplier_name,
             bi.product_id, p.code as product_code, COALESCE(p.name, bi.item_name) as product_name,
             pg.name as product_group_name, bi.item_name,
             bi.qty_received, bi.qty_sampled, bi.qty_passed, bi.qty_failed,
             bi.defect_category_id, dc.name as defect_category_name, bi.defect_detail,
             bi.lot_number, bi.manufacturing_date, bi.expiry_date,
             bi.inspector_id, u.full_name as inspector_name, bi.inspected_at, bi.created_at
      FROM bill_items bi
      LEFT JOIN bills b ON b.id = bi.bill_id
      LEFT JOIN suppliers s ON s.id = b.supplier_id
      LEFT JOIN products p ON p.id = bi.product_id
      LEFT JOIN product_groups pg ON pg.id = p.product_group_id
      LEFT JOIN defect_categories dc ON dc.id = bi.defect_category_id
      LEFT JOIN users u ON u.id = bi.inspector_id
      ORDER BY bi.id
    `).all());

    sheet('fact_NCRs', [
      { h: 'ncr_id', k: 'ncr_id', w: 10 },
      { h: 'ncr_code', k: 'ncr_code', w: 18 },
      { h: 'bill_id', k: 'bill_id', w: 10 },
      { h: 'invoice_no', k: 'invoice_no', w: 18 },
      { h: 'po_no', k: 'po_no', w: 18 },
      { h: 'supplier_id', k: 'supplier_id', w: 12 },
      { h: 'supplier_name', k: 'supplier_name', w: 28 },
      { h: 'severity', k: 'severity', w: 10 },
      { h: 'status', k: 'status', w: 28 },
      { h: 'disposition', k: 'disposition', w: 14 },
      { h: 'disposition_due_date', k: 'disposition_due_date', w: 20 },
      { h: 'disposition_completed_at', k: 'disposition_completed_at', w: 22 },
      { h: 'effectiveness_result', k: 'effectiveness_result', w: 18 },
      { h: 'effectiveness_check_date', k: 'effectiveness_check_date', w: 22 },
      { h: 'created_by_user_id', k: 'created_by_user_id', w: 16 },
      { h: 'created_by_name', k: 'created_by_name', w: 22 },
      { h: 'created_at', k: 'created_at', w: 18 },
      { h: 'cancelled_at', k: 'cancelled_at', w: 18 },
    ], db.prepare(`
      SELECT n.id as ncr_id, n.ncr_code, n.bill_id, b.invoice_no, b.po_no,
             b.supplier_id, s.name as supplier_name,
             n.severity, n.status, n.disposition, n.disposition_due_date, n.disposition_completed_at,
             n.effectiveness_result, n.effectiveness_check_date,
             n.created_by as created_by_user_id, u.full_name as created_by_name,
             n.created_at, n.cancelled_at
      FROM ncrs n
      LEFT JOIN bills b ON b.id = n.bill_id
      LEFT JOIN suppliers s ON s.id = b.supplier_id
      LEFT JOIN users u ON u.id = n.created_by
      ORDER BY n.created_at DESC
    `).all());

    sheet('fact_NCRItems', [
      { h: 'ncr_item_id', k: 'ncr_item_id', w: 12 },
      { h: 'ncr_id', k: 'ncr_id', w: 10 },
      { h: 'ncr_code', k: 'ncr_code', w: 18 },
      { h: 'severity', k: 'severity', w: 10 },
      { h: 'bill_item_id', k: 'bill_item_id', w: 12 },
      { h: 'item_name', k: 'item_name', w: 28 },
      { h: 'qty_received', k: 'qty_received', w: 12 },
      { h: 'qty_sampled', k: 'qty_sampled', w: 12 },
      { h: 'qty_failed', k: 'qty_failed', w: 12 },
      { h: 'defect_category_id', k: 'defect_category_id', w: 18 },
      { h: 'defect_category_name', k: 'defect_category_name', w: 22 },
      { h: 'defect_detail', k: 'defect_detail', w: 35 },
      { h: 'created_at', k: 'created_at', w: 18 },
    ], db.prepare(`
      SELECT ni.id as ncr_item_id, ni.ncr_id, n.ncr_code, n.severity,
             ni.bill_item_id, ni.item_name, ni.qty_received, ni.qty_sampled, ni.qty_failed,
             ni.defect_category_id, dc.name as defect_category_name, ni.defect_detail, ni.created_at
      FROM ncr_items ni
      LEFT JOIN ncrs n ON n.id = ni.ncr_id
      LEFT JOIN defect_categories dc ON dc.id = ni.defect_category_id
      ORDER BY ni.ncr_id, ni.id
    `).all());

    sheet('fact_NCRApprovals', [
      { h: 'approval_id', k: 'approval_id', w: 12 },
      { h: 'ncr_id', k: 'ncr_id', w: 10 },
      { h: 'ncr_code', k: 'ncr_code', w: 18 },
      { h: 'action', k: 'action', w: 20 },
      { h: 'role', k: 'role', w: 18 },
      { h: 'user_id', k: 'user_id', w: 10 },
      { h: 'user_name', k: 'user_name', w: 22 },
      { h: 'comment', k: 'comment', w: 35 },
      { h: 'created_at', k: 'created_at', w: 18 },
    ], db.prepare(`
      SELECT na.id as approval_id, na.ncr_id, n.ncr_code,
             na.action, na.role, na.user_id, u.full_name as user_name, na.comment, na.created_at
      FROM ncr_approvals na
      LEFT JOIN ncrs n ON n.id = na.ncr_id
      LEFT JOIN users u ON u.id = na.user_id
      ORDER BY na.ncr_id, na.created_at
    `).all());

    sheet('fact_SupplierResponses', [
      { h: 'response_id', k: 'response_id', w: 12 },
      { h: 'ncr_id', k: 'ncr_id', w: 10 },
      { h: 'ncr_code', k: 'ncr_code', w: 18 },
      { h: 'supplier_id', k: 'supplier_id', w: 12 },
      { h: 'supplier_name', k: 'supplier_name', w: 28 },
      { h: 'respondent_name', k: 'respondent_name', w: 22 },
      { h: 'root_cause', k: 'root_cause', w: 40 },
      { h: 'corrective_action', k: 'corrective_action', w: 40 },
      { h: 'preventive_action', k: 'preventive_action', w: 40 },
      { h: 'completion_date', k: 'completion_date', w: 15 },
      { h: 'submitted_at', k: 'submitted_at', w: 18 },
      { h: 'superseded_at', k: 'superseded_at', w: 18 },
    ], db.prepare(`
      SELECT sr.id as response_id, sr.ncr_id, n.ncr_code,
             b.supplier_id, s.name as supplier_name,
             sr.respondent_name, sr.root_cause, sr.corrective_action, sr.preventive_action,
             sr.completion_date, sr.submitted_at, sr.superseded_at
      FROM supplier_responses sr
      LEFT JOIN ncrs n ON n.id = sr.ncr_id
      LEFT JOIN bills b ON b.id = n.bill_id
      LEFT JOIN suppliers s ON s.id = b.supplier_id
      ORDER BY sr.ncr_id, sr.submitted_at
    `).all());

    sheet('fact_ReInspections', [
      { h: 'reinspection_id', k: 'reinspection_id', w: 15 },
      { h: 'ncr_id', k: 'ncr_id', w: 10 },
      { h: 'ncr_code', k: 'ncr_code', w: 18 },
      { h: 'round', k: 'round', w: 8 },
      { h: 'inspector_id', k: 'inspector_id', w: 12 },
      { h: 'inspector_name', k: 'inspector_name', w: 22 },
      { h: 'inspected_at', k: 'inspected_at', w: 18 },
      { h: 'qty_re_inspected', k: 'qty_re_inspected', w: 16 },
      { h: 'qty_passed', k: 'qty_passed', w: 12 },
      { h: 'qty_failed', k: 'qty_failed', w: 12 },
      { h: 'result', k: 'result', w: 10 },
      { h: 'notes', k: 'notes', w: 30 },
    ], db.prepare(`
      SELECT ri.id as reinspection_id, ri.ncr_id, n.ncr_code,
             ri.round, ri.inspector_id, u.full_name as inspector_name,
             ri.inspected_at, ri.qty_re_inspected, ri.qty_passed, ri.qty_failed, ri.result, ri.notes
      FROM re_inspections ri
      LEFT JOIN ncrs n ON n.id = ri.ncr_id
      LEFT JOIN users u ON u.id = ri.inspector_id
      ORDER BY ri.ncr_id, ri.round
    `).all());

    sheet('fact_UAIDocuments', [
      { h: 'uai_id', k: 'uai_id', w: 10 },
      { h: 'uai_code', k: 'uai_code', w: 18 },
      { h: 'ncr_id', k: 'ncr_id', w: 10 },
      { h: 'ncr_code', k: 'ncr_code', w: 18 },
      { h: 'supplier_id', k: 'supplier_id', w: 12 },
      { h: 'supplier_name', k: 'supplier_name', w: 28 },
      { h: 'reason', k: 'reason', w: 35 },
      { h: 'conditions', k: 'conditions', w: 35 },
      { h: 'department', k: 'department', w: 18 },
      { h: 'issued_date', k: 'issued_date', w: 14 },
      { h: 'status', k: 'status', w: 28 },
      { h: 'created_at', k: 'created_at', w: 18 },
    ], db.prepare(`
      SELECT ud.id as uai_id, ud.uai_code, ud.ncr_id, n.ncr_code,
             b.supplier_id, s.name as supplier_name,
             ud.reason, ud.conditions, ud.department, ud.issued_date, ud.status, ud.created_at
      FROM uai_documents ud
      LEFT JOIN ncrs n ON n.id = ud.ncr_id
      LEFT JOIN bills b ON b.id = n.bill_id
      LEFT JOIN suppliers s ON s.id = b.supplier_id
      ORDER BY ud.created_at DESC
    `).all());

    sheet('fact_UAISignatures', [
      { h: 'signature_id', k: 'signature_id', w: 12 },
      { h: 'uai_id', k: 'uai_id', w: 10 },
      { h: 'uai_code', k: 'uai_code', w: 18 },
      { h: 'role', k: 'role', w: 18 },
      { h: 'user_id', k: 'user_id', w: 10 },
      { h: 'user_name', k: 'user_name', w: 22 },
      { h: 'action', k: 'action', w: 15 },
      { h: 'comment', k: 'comment', w: 30 },
      { h: 'signed_at', k: 'signed_at', w: 18 },
    ], db.prepare(`
      SELECT us.id as signature_id, us.uai_id, ud.uai_code,
             us.role, us.user_id, u.full_name as user_name, us.action, us.comment, us.signed_at
      FROM uai_signatures us
      LEFT JOIN uai_documents ud ON ud.id = us.uai_id
      LEFT JOIN users u ON u.id = us.user_id
      ORDER BY us.uai_id, us.signed_at
    `).all());

    sheet('fact_DeliverySchedules', [
      { h: 'schedule_id', k: 'schedule_id', w: 12 },
      { h: 'supplier_id', k: 'supplier_id', w: 12 },
      { h: 'supplier_name', k: 'supplier_name', w: 28 },
      { h: 'supplier_code', k: 'supplier_code', w: 14 },
      { h: 'scheduled_date', k: 'scheduled_date', w: 15 },
      { h: 'time_slot', k: 'time_slot', w: 12 },
      { h: 'is_unplanned', k: 'is_unplanned', w: 12 },
      { h: 'status', k: 'status', w: 14 },
      { h: 'actual_date', k: 'actual_date', w: 14 },
      { h: 'late_reason', k: 'late_reason', w: 30 },
      { h: 'acknowledged_at', k: 'acknowledged_at', w: 18 },
      { h: 'acknowledged_by_name', k: 'acknowledged_by_name', w: 22 },
      { h: 'created_by_name', k: 'created_by_name', w: 22 },
      { h: 'created_at', k: 'created_at', w: 18 },
    ], db.prepare(`
      SELECT ds.id as schedule_id, ds.supplier_id, s.name as supplier_name, s.code as supplier_code,
             ds.scheduled_date, ds.time_slot, ds.is_unplanned, ds.status, ds.actual_date, ds.late_reason,
             ds.acknowledged_at, u1.full_name as acknowledged_by_name, u2.full_name as created_by_name,
             ds.created_at
      FROM delivery_schedules ds
      LEFT JOIN suppliers s ON s.id = ds.supplier_id
      LEFT JOIN users u1 ON u1.id = ds.acknowledged_by
      LEFT JOIN users u2 ON u2.id = ds.created_by
      ORDER BY ds.scheduled_date DESC
    `).all());

    sheet('fact_SupplierEvaluations', [
      { h: 'evaluation_id', k: 'evaluation_id', w: 14 },
      { h: 'supplier_id', k: 'supplier_id', w: 12 },
      { h: 'supplier_name', k: 'supplier_name', w: 28 },
      { h: 'supplier_code', k: 'supplier_code', w: 14 },
      { h: 'eval_period', k: 'eval_period', w: 14 },
      { h: 'eval_date', k: 'eval_date', w: 14 },
      { h: 'score_quality', k: 'score_quality', w: 14 },
      { h: 'score_delivery', k: 'score_delivery', w: 15 },
      { h: 'score_response', k: 'score_response', w: 15 },
      { h: 'grade', k: 'grade', w: 8 },
      { h: 'recommendation', k: 'recommendation', w: 35 },
      { h: 'evaluator_name', k: 'evaluator_name', w: 22 },
      { h: 'created_at', k: 'created_at', w: 18 },
    ], db.prepare(`
      SELECT se.id as evaluation_id, se.supplier_id, s.name as supplier_name, s.code as supplier_code,
             se.eval_period, se.eval_date, se.score_quality, se.score_delivery, se.score_response,
             se.grade, se.recommendation, u.full_name as evaluator_name, se.created_at
      FROM supplier_evaluations se
      LEFT JOIN suppliers s ON s.id = se.supplier_id
      LEFT JOIN users u ON u.id = se.evaluator_id
      ORDER BY se.eval_date DESC
    `).all());

    sheet('fact_QCAttendance', [
      { h: 'attendance_id', k: 'attendance_id', w: 14 },
      { h: 'user_id', k: 'user_id', w: 10 },
      { h: 'user_name', k: 'user_name', w: 22 },
      { h: 'role', k: 'role', w: 16 },
      { h: 'date', k: 'date', w: 12 },
      { h: 'check_in_at', k: 'check_in_at', w: 18 },
      { h: 'check_out_at', k: 'check_out_at', w: 18 },
      { h: 'late_minutes', k: 'late_minutes', w: 14 },
      { h: 'work_minutes', k: 'work_minutes', w: 14 },
      { h: 'geofence_ok', k: 'geofence_ok', w: 12 },
      { h: 'note', k: 'note', w: 25 },
    ], db.prepare(`
      SELECT a.id as attendance_id, a.user_id, u.full_name as user_name, u.role,
             a.date, a.check_in_at, a.check_out_at, a.late_minutes, a.work_minutes,
             a.geofence_ok, a.note
      FROM qc_attendance a
      LEFT JOIN users u ON u.id = a.user_id
      ORDER BY a.date DESC, a.user_id
    `).all());

    const relWs = wb.addWorksheet('_Relationships');
    relWs.columns = [
      { header: 'From_Sheet', key: 'from', width: 28 },
      { header: 'From_Column', key: 'from_col', width: 22 },
      { header: 'To_Sheet', key: 'to', width: 28 },
      { header: 'To_Column', key: 'to_col', width: 22 },
      { header: 'Cardinality', key: 'cardinality', width: 16 },
    ];
    relWs.getRow(1).eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3A5C' } };
      cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 10 };
    });
    [
      ['fact_Bills', 'supplier_id', 'dim_Suppliers', 'supplier_id', 'Many-to-1'],
      ['fact_Bills', 'created_by_user_id', 'dim_Users', 'user_id', 'Many-to-1'],
      ['fact_BillItems', 'bill_id', 'fact_Bills', 'bill_id', 'Many-to-1'],
      ['fact_BillItems', 'supplier_id', 'dim_Suppliers', 'supplier_id', 'Many-to-1'],
      ['fact_BillItems', 'product_id', 'dim_Products', 'product_id', 'Many-to-1'],
      ['fact_BillItems', 'defect_category_id', 'dim_DefectCategories', 'defect_category_id', 'Many-to-1'],
      ['fact_BillItems', 'inspector_id', 'dim_Users', 'user_id', 'Many-to-1'],
      ['fact_NCRs', 'bill_id', 'fact_Bills', 'bill_id', 'Many-to-1'],
      ['fact_NCRs', 'supplier_id', 'dim_Suppliers', 'supplier_id', 'Many-to-1'],
      ['fact_NCRs', 'created_by_user_id', 'dim_Users', 'user_id', 'Many-to-1'],
      ['fact_NCRItems', 'ncr_id', 'fact_NCRs', 'ncr_id', 'Many-to-1'],
      ['fact_NCRItems', 'bill_item_id', 'fact_BillItems', 'bill_item_id', 'Many-to-1'],
      ['fact_NCRItems', 'defect_category_id', 'dim_DefectCategories', 'defect_category_id', 'Many-to-1'],
      ['fact_NCRApprovals', 'ncr_id', 'fact_NCRs', 'ncr_id', 'Many-to-1'],
      ['fact_NCRApprovals', 'user_id', 'dim_Users', 'user_id', 'Many-to-1'],
      ['fact_SupplierResponses', 'ncr_id', 'fact_NCRs', 'ncr_id', 'Many-to-1'],
      ['fact_SupplierResponses', 'supplier_id', 'dim_Suppliers', 'supplier_id', 'Many-to-1'],
      ['fact_ReInspections', 'ncr_id', 'fact_NCRs', 'ncr_id', 'Many-to-1'],
      ['fact_ReInspections', 'inspector_id', 'dim_Users', 'user_id', 'Many-to-1'],
      ['fact_UAIDocuments', 'ncr_id', 'fact_NCRs', 'ncr_id', '1-to-1'],
      ['fact_UAIDocuments', 'supplier_id', 'dim_Suppliers', 'supplier_id', 'Many-to-1'],
      ['fact_UAISignatures', 'uai_id', 'fact_UAIDocuments', 'uai_id', 'Many-to-1'],
      ['fact_UAISignatures', 'user_id', 'dim_Users', 'user_id', 'Many-to-1'],
      ['fact_DeliverySchedules', 'supplier_id', 'dim_Suppliers', 'supplier_id', 'Many-to-1'],
      ['fact_SupplierEvaluations', 'supplier_id', 'dim_Suppliers', 'supplier_id', 'Many-to-1'],
      ['fact_QCAttendance', 'user_id', 'dim_Users', 'user_id', 'Many-to-1'],
      ['dim_Products', 'supplier_id', 'dim_Suppliers', 'supplier_id', 'Many-to-1'],
      ['dim_Products', 'product_group_id', 'dim_ProductGroups', 'product_group_id', 'Many-to-1'],
    ].forEach(([from, from_col, to, to_col, cardinality]) => relWs.addRow({ from, from_col, to, to_col, cardinality }));

    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="IQC_PowerBI_Export_${date}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error('[POWERBI EXPORT]', e);
    if (!res.headersSent) res.status(500).json({ error: 'Export ไม่สำเร็จ: ' + e.message });
  }
});

// ===== GET /api/kpi/action-plans/:id/pdf — Action Plan PDF (หัวกระดาษบริษัท) =====
const AP_MONTH_TH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const MONTH_FULL_TH = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];

function fmtThaiTs(s) {
  if (!s) return '—';
  return new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z')
    .toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Bangkok' });
}

router.get('/kpi/action-plans/:id/pdf', auth, pdfRateLimit, async (req, res) => {
  try {
    const ap = db.prepare(`
      SELECT ap.*,
        ki.kpi_no, ki.name as kpi_name, ki.unit, ki.target_direction,
        kg.name as group_name,
        u1.full_name as created_by_name,
        u2.full_name as qcm_signed_by_name,
        u3.full_name as cpo_signed_by_name,
        u4.full_name as qmr_signed_by_name,
        u5.full_name as rejected_by_name,
        kt.target_value,
        ka.actual_value
      FROM kpi_action_plans ap
      JOIN kpi_items ki ON ki.id = ap.kpi_item_id
      JOIN kpi_groups kg ON kg.id = ki.group_id
      LEFT JOIN users u1 ON u1.id = ap.created_by
      LEFT JOIN users u2 ON u2.id = ap.qcm_signed_by
      LEFT JOIN users u3 ON u3.id = ap.cpo_signed_by
      LEFT JOIN users u4 ON u4.id = ap.qmr_signed_by
      LEFT JOIN users u5 ON u5.id = ap.rejected_by
      LEFT JOIN kpi_targets kt ON kt.kpi_item_id = ap.kpi_item_id AND kt.year = ap.year AND kt.month = ap.month
      LEFT JOIN kpi_actuals ka ON ka.kpi_item_id = ap.kpi_item_id AND ka.year = ap.year AND ka.month = ap.month
      WHERE ap.id = ?
    `).get(req.params.id);
    if (!ap) return res.status(404).json({ error: 'ไม่พบเอกสาร' });

    const dirLabel = ap.target_direction === 'lte' ? 'ไม่เกิน' : 'ไม่ต่ำกว่า';
    const monthName = MONTH_FULL_TH[ap.month - 1] ?? '';

    const AP_STATUS_LABEL = { draft: 'แบบร่าง', pending_qcm: 'รอ QC Manager', pending_cpo: 'รอ CPO', pending_qmr: 'รอ QMR', approved: 'อนุมัติแล้ว' };
    const statusLabel = AP_STATUS_LABEL[ap.status] ?? ap.status;
    const statusColor = ap.status === 'approved' ? '#16A34A' : '#D97706';

    // helper: แถว label : value แบบไม่มีกรอบ
    const LBL = 'color:#6B7280;font-weight:400;white-space:nowrap;padding:3px 6px 3px 0;vertical-align:top;border:none;font-size:12px;';
    const VAL = 'font-weight:600;padding:3px 20px 3px 0;vertical-align:top;border:none;font-size:12px;';

    function signRow(role, name, at) {
      const tdS = 'padding:5px 8px;border:1px solid #E5E7EB;font-size:11px;';
      return `<tr>
        <td style="${tdS}">${esc(role)}</td>
        <td style="${tdS}">${esc(name || '—')}</td>
        <td style="${tdS}">${fmtThaiTs(at)}</td>
        <td style="${tdS}color:${at ? '#16A34A' : '#6B7280'}">${at ? '✓ อนุมัติแล้ว' : 'รอลงนาม'}</td>
      </tr>`;
    }

    function infoBlock(text) {
      return `<div style="border-left:3px solid #E5E7EB;padding:5px 10px;margin-bottom:6px;background:#FAFAFA;font-size:12px;min-height:28px;">${text || '<span style="color:#D1D5DB">—</span>'}</div>`;
    }

    const body = `
      <h2 style="text-align:center;font-size:16px;margin:0 0 2px;">แบบฟอร์ม Action Plan KPI</h2>
      <div style="text-align:center;color:#6B7280;font-size:11px;margin-bottom:16px;">${esc(ap.kpi_no)} — ${esc(monthName)} ${ap.year + 543}</div>

      <div class="section-title">1. ข้อมูล KPI</div>
      <table style="border:none;border-collapse:collapse;margin-bottom:12px;">
        <tr>
          <td style="${LBL}width:110px">KPI No. :</td>
          <td style="${VAL}width:130px">${esc(ap.kpi_no ?? '—')}</td>
          <td style="${LBL}width:90px">กลุ่ม KPI :</td>
          <td style="${VAL}">${esc(ap.group_name ?? '—')}</td>
        </tr>
        <tr>
          <td style="${LBL}">ชื่อ KPI :</td>
          <td style="${VAL}" colspan="3">${esc(ap.kpi_name)}</td>
        </tr>
        <tr>
          <td style="${LBL}">ปี / เดือน :</td>
          <td style="${VAL}">${ap.year + 543} / ${esc(monthName)}</td>
          <td style="${LBL}">หน่วย :</td>
          <td style="${VAL}">${esc(ap.unit ?? '—')}</td>
        </tr>
        <tr>
          <td style="${LBL}">เงื่อนไขผ่าน :</td>
          <td style="${VAL}">${esc(dirLabel)}</td>
          <td style="${LBL}">เป้าหมาย :</td>
          <td style="${VAL}">${ap.target_value ?? '—'}</td>
        </tr>
        <tr>
          <td style="${LBL}">ค่าจริง :</td>
          <td style="color:#DC2626;font-weight:700;padding:3px 20px 3px 0;border:none;font-size:12px;">${ap.actual_value ?? '—'}</td>
          <td style="${LBL}">ผล :</td>
          <td style="color:#DC2626;font-weight:700;padding:3px 0;border:none;font-size:12px;">ไม่ผ่านเป้าหมาย</td>
        </tr>
      </table>

      <div class="section-title">2. การวิเคราะห์และแก้ไขปัญหา</div>
      <div style="margin-bottom:12px;">
        <div style="color:#6B7280;font-size:11px;margin-bottom:2px;font-weight:600;">สาเหตุที่ไม่ผ่าน</div>
        ${infoBlock(ap.fail_cause ? esc(ap.fail_cause).replace(/\n/g,'<br>') : '')}
        <div style="color:#6B7280;font-size:11px;margin-bottom:2px;font-weight:600;margin-top:6px;">วิธีการแก้ไข <span style="font-weight:400">(Corrective Action)</span></div>
        ${infoBlock(ap.corrective_action ? esc(ap.corrective_action).replace(/\n/g,'<br>') : '')}
        <div style="color:#6B7280;font-size:11px;margin-bottom:2px;font-weight:600;margin-top:6px;">วิธีการป้องกัน <span style="font-weight:400">(Preventive Action)</span></div>
        ${infoBlock(ap.preventive_action ? esc(ap.preventive_action).replace(/\n/g,'<br>') : '')}
        ${ap.remark ? `<div style="color:#6B7280;font-size:11px;margin-bottom:2px;font-weight:600;margin-top:6px;">หมายเหตุ</div>${infoBlock(esc(ap.remark).replace(/\n/g,'<br>'))}` : ''}
      </div>

      <div class="section-title">3. การลงนามอนุมัติ (Online)</div>
      <table style="border-collapse:collapse;margin-bottom:8px;">
        <thead><tr>
          ${['บทบาท','ชื่อ','วันที่/เวลา','สถานะ'].map(h => `<th style="background:#F3F4F6;color:#374151;font-weight:700;padding:5px 8px;border:1px solid #E5E7EB;font-size:11px;text-align:left;">${h}</th>`).join('')}
        </tr></thead>
        <tbody>
          <tr>
            <td style="padding:5px 8px;border:1px solid #E5E7EB;font-size:11px;">Admin (ผู้จัดทำ)</td>
            <td style="padding:5px 8px;border:1px solid #E5E7EB;font-size:11px;">${esc(ap.created_by_name ?? '—')}</td>
            <td style="padding:5px 8px;border:1px solid #E5E7EB;font-size:11px;">${fmtThaiTs(ap.submitted_at)}</td>
            <td style="padding:5px 8px;border:1px solid #E5E7EB;font-size:11px;color:${ap.submitted_at ? '#16A34A' : '#6B7280'}">${ap.submitted_at ? '✓ ส่งอนุมัติแล้ว' : 'ยังไม่ส่ง'}</td>
          </tr>
          ${signRow('QC Manager', ap.qcm_signed_by_name, ap.qcm_signed_at)}
          ${signRow('CPO', ap.cpo_signed_by_name, ap.cpo_signed_at)}
          ${signRow('QMR', ap.qmr_signed_by_name, ap.qmr_signed_at)}
        </tbody>
      </table>
      <div style="text-align:right;font-weight:700;color:${statusColor};margin-top:4px;font-size:12px;">สถานะ: ${esc(statusLabel)}</div>
    `;

    const pdf = await renderDocPdf({ title: `Action Plan — ${ap.kpi_no}`, bodyHtml: body });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="ActionPlan-${encodeURIComponent(ap.kpi_no)}-${ap.year}-${String(ap.month).padStart(2,'0')}.pdf"`);
    res.send(pdf);
  } catch (e) {
    console.error('[KPI AP PDF]', e);
    if (!res.headersSent) res.status(500).json({ error: 'สร้าง PDF ไม่สำเร็จ: ' + e.message });
  }
});

// ── GET /api/fg-fncp/:id/pdf — FNCP PDF export (closed only) ─────────────────
router.get('/fg-fncp/:id/pdf', auth, pdfRateLimit, async (req, res) => {
  try {
    const row = db.prepare(`
      SELECT fn.*,
             pl.name AS line_name,
             pcs.product_no, pcs.product_desc,
             dg.name AS defect_group_name,
             dt.name AS defect_type_name,
             ou.full_name AS opened_by_name,
             vu.full_name AS verified_by_name,
             cu.full_name AS closed_by_name,
             dr.initial_cause, dr.found_date AS dr_found_date, dr.found_time AS dr_found_time, dr.lot_no AS ref_doc_no,
             sh.name AS shift_name
      FROM fg_fncp fn
      LEFT JOIN production_lines pl   ON pl.id = fn.production_line_id
      LEFT JOIN pro_code_sap pcs      ON pcs.id = fn.pro_code_sap_id
      LEFT JOIN fg_defect_groups dg   ON dg.id = fn.defect_group_id
      LEFT JOIN fg_defect_types dt    ON dt.id = fn.defect_type_id
      LEFT JOIN fg_defect_records dr  ON dr.id = fn.defect_record_id
      LEFT JOIN shifts sh             ON sh.id = dr.shift_id
      LEFT JOIN users ou ON ou.id = fn.opened_by
      LEFT JOIN users vu ON vu.id = fn.verified_by
      LEFT JOIN users cu ON cu.id = fn.closed_by
      WHERE fn.id=?
    `).get(req.params.id);

    if (!row) return res.status(404).json({ error: 'ไม่พบ FNCP' });
    if (row.status !== 'closed') return res.status(409).json({ error: 'ออก PDF ได้เฉพาะ FNCP ที่ปิดแล้ว' });

    const images    = row.defect_record_id
      ? db.prepare('SELECT * FROM fg_defect_images WHERE defect_record_id=? ORDER BY sort_order,id').all(row.defect_record_id)
      : [];
    const fixImages = db.prepare('SELECT * FROM fg_fncp_fix_images WHERE fncp_id=? ORDER BY sort_order,id').all(row.id);
    const timeline  = db.prepare(`SELECT tl.*, u.full_name AS actor_name FROM fg_fncp_timeline tl LEFT JOIN users u ON u.id=tl.created_by WHERE tl.fncp_id=? ORDER BY tl.created_at`).all(row.id);

    db.auditLog('fg_fncp', row.id, 'EXPORT', null, { format: 'pdf' }, req.user.id, req.ip);

    // ── คำนวณ ──
    const sevLabel = { minor: 'Minor', major: 'Major', critical: 'Critical' };
    const daysToReply = row.submit_verify_at && row.opened_at
      ? Math.round((new Date(row.submit_verify_at) - new Date(row.opened_at)) / 86400000)
      : null;

    // ── รูปภาพ → base64 ──
    function imgHtml(folder, filename, size = 100) {
      const src = imgToBase64(folder, filename);
      return src ? `<img src="${src}" style="width:${size}px;height:${size}px;object-fit:cover;border-radius:6px;border:1px solid #E5E7EB;" />` : '';
    }

    const problemImgHtml = images.map(i => imgHtml('fg-defect', i.filename)).join('');
    const fixImgHtml     = fixImages.map(i => imgHtml('fg-fix',   i.filename)).join('');

    const tlRows = timeline.map(t => `
      <tr>
        <td style="color:#6B7280;white-space:nowrap;">${esc(t.created_at?.slice(0,16).replace('T',' ') || '')}</td>
        <td>${esc(t.actor_name || 'ระบบ')}</td>
        <td>${esc(t.comment || t.action || '')}</td>
      </tr>`).join('');

    const body = `
      <div style="margin-top:-12mm;">

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <div style="font-size:20px;font-weight:700;color:#1A3A5C;">${esc(row.fncp_no)}</div>
        <div style="text-align:right;">
          <span style="background:#D1FAE5;color:#065F46;padding:4px 10px;border-radius:9999px;font-size:11px;font-weight:700;">ปิดแล้ว</span>
          ${row.severity ? `<span style="margin-left:6px;background:${row.severity==='critical'?'#FEE2E2':row.severity==='major'?'#FFEDD5':'#FEF9C3'};color:${row.severity==='critical'?'#991B1B':row.severity==='major'?'#9A3412':'#713F12'};padding:4px 10px;border-radius:9999px;font-size:11px;font-weight:700;">${esc(sevLabel[row.severity]||row.severity)}</span>` : ''}
        </div>
      </div>

      <div style="font-size:15px;font-weight:700;color:#1A3A5C;border-bottom:2px solid #1A3A5C;padding-bottom:4px;margin-bottom:8px;">ข้อมูลของเสีย</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;margin-bottom:12px;">
        <div class="info-row"><span class="info-label">สินค้า: </span><span class="info-value">${esc(row.product_no||'—')} ${esc(row.product_desc||'')}</span></div>
        <div class="info-row"><span class="info-label">สายการผลิต: </span><span class="info-value">${esc(row.line_name||'—')}</span></div>
        <div class="info-row"><span class="info-label">Doc. No. อ้างอิง: </span><span class="info-value">${esc(row.ref_doc_no||row.doc_no||'—')}</span></div>
        <div class="info-row"><span class="info-label">กลุ่มอาการเสีย: </span><span class="info-value">${esc(row.defect_group_name||'—')}</span></div>
        <div class="info-row"><span class="info-label">อาการเสีย: </span><span class="info-value">${esc(row.defect_type_name||'—')}</span></div>
        <div class="info-row"><span class="info-label">จำนวนของเสีย: </span><span class="info-value" style="color:#DC2626;">${esc(String(row.defect_qty||0))} ${esc(row.defect_unit||'')}</span></div>
        <div class="info-row"><span class="info-label">วันที่พบปัญหา: </span><span class="info-value">${esc(row.dr_found_date||'—')} ${esc(row.dr_found_time||'')} ${row.shift_name?`(${esc(row.shift_name)})`:''}</span></div>
        <div></div>
        <div class="info-row"><span class="info-label">ผู้เปิดเอกสาร: </span><span class="info-value">${esc(row.opened_by_name||'—')} (${esc(row.opened_at?.slice(0,10)||'—')})</span></div>
      </div>

      ${row.initial_cause ? `
      <div class="section-title">ปัญหาที่พบ</div>
      <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:6px;padding:10px;font-size:11px;margin-bottom:12px;">${esc(row.initial_cause)}</div>
      ` : ''}

      ${problemImgHtml ? `
      <div class="section-title">รูปภาพงานเสีย (${images.length})</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;">${problemImgHtml}</div>
      ` : ''}

      <div class="section-title">Root Cause Analysis — ฝ่ายผลิต</div>
      ${row.respondent_name ? `
      <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:6px;padding:10px;margin-bottom:10px;">
        <div style="font-size:11px;color:#1D4ED8;font-weight:700;">ผู้ตอบกลับ: ${esc(row.respondent_name)}</div>
        ${row.submit_verify_at ? `<div style="font-size:10px;color:#3B82F6;margin-top:2px;">วันเวลาที่ตอบ: ${esc(row.submit_verify_at.slice(0,16).replace('T',' '))}${daysToReply!==null ? ` &nbsp;|&nbsp; ใช้เวลา ${daysToReply} วัน` : ''}</div>` : ''}
      </div>` : ''}
      ${[['Root Cause', row.root_cause],['Corrective Action', row.corrective_action],['Preventive Action', row.preventive_action]].map(([l,v]) => v ? `
      <div style="margin-bottom:8px;">
        <div style="font-size:10px;color:#6B7280;margin-bottom:2px;">${esc(l)}</div>
        <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:4px;padding:8px;font-size:11px;">${esc(v)}</div>
      </div>` : '').join('')}

      ${fixImgHtml ? `
      <div class="section-title">รูปภาพการแก้ไข (${fixImages.length})</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;">${fixImgHtml}</div>
      ` : ''}

      ${row.verification_result ? `
      <div class="section-title">ผลการตรวจสอบ QC</div>
      <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:6px;padding:10px;font-size:11px;margin-bottom:12px;">${esc(row.verification_result)}</div>
      <div class="info-grid" style="margin-bottom:12px;">
        <div class="info-row"><span class="info-label">QC ยืนยันโดย: </span><span class="info-value">${esc(row.verified_by_name||'—')}</span></div>
        <div class="info-row"><span class="info-label">วันที่ยืนยัน: </span><span class="info-value">${esc(row.verified_at?.slice(0,10)||'—')}</span></div>
        <div class="info-row"><span class="info-label">ปิดโดย: </span><span class="info-value">${esc(row.closed_by_name||'—')}</span></div>
        <div class="info-row"><span class="info-label">วันที่ปิด: </span><span class="info-value">${esc(row.closed_at?.slice(0,10)||'—')}</span></div>
      </div>` : ''}

      ${tlRows ? `
      <div class="section-title">Timeline การดำเนินการ</div>
      <table>
        <thead><tr><th style="width:140px;">วันเวลา</th><th style="width:140px;">ผู้ดำเนินการ</th><th>รายละเอียด</th></tr></thead>
        <tbody>${tlRows}</tbody>
      </table>` : ''}

      </div>
    `;

    const pdf = await renderDocPdf({ title: `FNCP — ${row.fncp_no}`, bodyHtml: body });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="FNCP-${encodeURIComponent(row.fncp_no)}.pdf"`);
    res.send(pdf);
  } catch (e) {
    console.error('[FNCP PDF]', e);
    if (!res.headersSent) res.status(500).json({ error: 'สร้าง PDF ไม่สำเร็จ: ' + e.message });
  }
});

module.exports = router;
module.exports.closeBrowser = closeBrowser; // ใช้ตอน graceful shutdown
// export pure helpers สำหรับ unit test
module.exports.esc = esc;
module.exports.safeSig = safeSig;
