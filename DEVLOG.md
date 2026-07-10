> ⚠️ **DEPRECATED (2026-07-02)** — DEVLOG ที่ใช้งานจริง (ล่าสุด) อยู่ที่ [`iqc-system/DEVLOG.md`](iqc-system/DEVLOG.md) ไฟล์นี้เป็นบันทึกเก่า (Session 1–60) เก็บไว้เป็นประวัติ

# DEVLOG — IQC System

บันทึกการแก้ไขและพัฒนาระบบตามลำดับเวลา

---

## 2026-06-22 — Session 57: ทุก PDF เอกสาร — หัวเอกสารซ้ำทุกหน้า + เลขหน้า (current/total)

### ความต้องการ
ทุก export PDF (และ JPG) เมื่อขึ้นหน้าใหม่ให้รันเลขหน้า (เช่น 1/2, 2/2) + มีหัวข้อมูลเอกสารทุกหน้า

### แก้ไข (`server/routes/exports.js`)
- เพิ่ม `renderDocPdf({ title, dateRange, bodyHtml, landscape })` — ใช้ puppeteer `page.pdf({ displayHeaderFooter, headerTemplate, footerTemplate })`:
  - `docHeaderTemplate`: โลโก้ + ชื่อบริษัท + ชื่อเอกสาร + Export date → ซ้ำทุกหน้า
  - `PAGE_FOOTER_TEMPLATE`: "หน้า {pageNumber}/{totalPages}" (current/total) → ทุกหน้า
  - `thead{display:table-header-group}` + `tr{page-break-inside:avoid}`
- เปลี่ยน PDF เอกสาร บิล / NCR / UAI จาก `generatePDF(pdfHtmlWrapper(...))` (html-pdf-node, ไม่มีเลขหน้า/หัวซ้ำ) → `renderDocPdf(...)`
- รวมรูปแบบเลขหน้าทั้งโปรเจกต์เป็น current/total (รวมรายงานสรุปรับเข้า PDF ที่เดิมเป็น total/current)
- `generatePDF`/`pdfHtmlWrapper` เดิมไม่ถูกเรียกแล้ว (คงไว้ไม่ลบ)

### หมายเหตุ
- JPG (สรุปรับเข้า) เป็นภาพเดียว — มีหัวเอกสารด้านบนอยู่แล้ว; การแบ่งหน้า/เลขหน้าจริงอยู่ที่ไฟล์ PDF

---

## 2026-06-22 — Session 65: แก้ compose error (.env.production) + COOKIE_SECURE toggle

### ปัญหา
`docker compose up` ฟ้อง `.env.production not found` (compose ระบุ `env_file` บังคับ)

### แก้
- สร้าง `.env.production` (generate JWT_SECRET ด้วย `openssl rand -hex 48`); ค่า local: `APP_URL=http://localhost`, `COOKIE_SECURE=false`
- `server/routes/auth.js`: เพิ่ม override `COOKIE_SECURE` (default = `NODE_ENV==='production'`) → ตั้ง `false` เพื่อทดสอบ local ผ่าน http ได้ (ไม่งั้น secure cookie ทำให้ login ไม่ติดบน http://localhost); production ผ่าน https ปล่อยว่าง = secure
- `.gitignore`: เพิ่ม `.env.production`, `.env.*` (ยกเว้น example), `nginx/certs/`, `nginx/www/`
- `.env.production.example`: เพิ่มหมายเหตุ `COOKIE_SECURE`

### ทดสอบ (full stack ผ่าน nginx :80)
- `docker compose up -d --build` → app **healthy** → nginx start (depends_on healthy)
- `GET /api/health` ผ่าน nginx = ok · SPA index HTTP 200 · login admin ผ่าน http → **cookie `token` ถูก set** (COOKIE_SECURE=false ทำงาน)

### ก่อนขึ้น production จริง
แก้ `.env.production`: `APP_URL=https://โดเมน`, **ลบ `COOKIE_SECURE=false`**, เข้าผ่าน https

---

## 2026-06-22 — Session 64: Production Docker deployment (multi-stage + nginx + persistence)

### Code refactor (เตรียม production)
- **`server/index.js`**:
  - เพิ่ม healthcheck `GET /api/health` + `/healthz` (query DB จริง, ไม่ต้อง auth, ไม่ติด rate limit)
  - เพิ่ม **graceful shutdown** (SIGTERM/SIGINT): ปิด SSE → `server.close()` → `closeBrowser()` (Chromium) → `db.close()` (flush WAL) + force-exit 12s; `keepAliveTimeout=75s` กัน 502 หลัง proxy
- **`server/routes/exports.js`**: `_launchBrowser` รับ `PUPPETEER_EXECUTABLE_PATH` (Chromium ของระบบใน Docker), `headless:true`, `--disable-gpu`, ปิด `handleSIGINT/SIGTERM/SIGHUP` (ให้ index.js คุม shutdown), export `closeBrowser()`
- **`server/db/database.js`**: `mkdirSync(dirname(IQC_DB_PATH))` ก่อนเปิด DB (รองรับ volume เปล่า `/data`)

### ไฟล์ deployment ที่สร้าง (ใน `iqc-system/`)
- `Dockerfile` — multi-stage: client build / server deps (compile better-sqlite3, skip Chromium download) / runtime (Debian slim + apt chromium + fonts-thai-tlwg + dumb-init, non-root `node`, healthcheck, TZ=Asia/Bangkok)
- `.dockerignore` — ตัด node_modules/dist/.env/*.db/uploads ออกจาก context
- `docker-compose.yml` — `app` (volumes `iqc_data:/data` + `iqc_uploads:/app/uploads`, shm 512m, mem limit, healthcheck, restart) + `nginx` (reverse proxy 80/443)
- `nginx/nginx.conf` — proxy → app:3001, SSE `proxy_buffering off`, body 110MB, gzip, Cloudflare real-IP, บล็อก HTTPS (templated)
- `.env.production.example`, `ecosystem.config.js` (PM2 fork 1 instance สำหรับ VPS-direct)
- `DEPLOYMENT.md` (ครบ: Docker/Render/PM2, TLS, backup/restore, scaling→Postgres, troubleshooting) + `PRODUCTION_CHECKLIST.md`

### หลักการ
- single origin: Node เสิร์ฟ SPA + API + uploads; frontend เรียก `/api` relative → ไม่มีปัญหา cookie/CORS
- stateful → 1 instance เท่านั้น (SQLite single-writer, SSE in-memory, Chromium singleton); persistence บน named volume (ห้าม ephemeral)
- Chromium: ใช้ของระบบ (apt) แทน download; dumb-init reap zombie; graceful shutdown ปิด browser เอง

### ทดสอบ (build + run จริงผ่านครบ)
- `docker build` สำเร็จ (multi-stage, better-sqlite3 compile, image 1.38GB)
- container start → DB seed + `IQC Server running`
- `GET /api/health` = `{"status":"ok"}` · Docker HEALTHCHECK = **healthy**
- non-root = `node` · Chromium 149 (bookworm) · ฟอนต์ TLWG (Garuda/Loma/...) ครบ · TZ = +07
- **Puppeteer render PDF จริงในคอนเทนเนอร์**: system chromium + IBM Plex ฝัง + ข้อความไทย → valid multi-page %PDF
- graceful shutdown: `docker stop` → SIGTERM → log `[shutdown] ปิดเรียบร้อย` (ปิดนุ่มนวล ไม่ถูก kill)

---

## 2026-06-22 — Session 63: เอกสาร NCP ใช้ format/หัวกระดาษเดียวกับ NCR + ป้ายชื่อตามชนิด

### บริบท
NCP กับ NCR เป็น record เดียวกัน (`ncrs`, severity minor/major) และใช้ endpoint export เดียวกัน (`/ncr/:id/pdf`, `/ncr/:id/excel`) → **format/หัวกระดาษ/layout เหมือนกันอยู่แล้ว** (ได้ปรับปรุงล่าสุดทั้งหัว 2 ฝั่ง, qty ชิด, รูปข้างขวา/ล่าง, เลขหน้า ครบ)
แต่ป้ายชื่อ hardcode เป็น "NCR" ทั้งหมด → เอกสาร NCP เลยขึ้น "เอกสาร NCR — NCP-2026-xxxx" สับสน

### แก้ (`server/routes/exports.js`)
- เพิ่ม `docType = ncr.severity === 'minor' ? 'NCP' : 'NCR'`
- **PDF** (`/ncr/:id/pdf`): title → `เอกสาร ${docType} — code`, section "ข้อมูล ${docType}", label "รหัส ${docType}", "ผู้เปิด ${docType}", filename `${docType}-code.pdf`
- **Excel** (`/ncr/:id/excel`): sheet "ข้อมูล ${docType}", label "รหัส ${docType}", filename `${docType}-code.xlsx`
- เนื้อหา/หัวกระดาษ/template เหมือน NCR ทุกอย่าง — เปลี่ยนเฉพาะป้ายชนิดเอกสารให้ตรงความจริง

---

## 2026-06-22 — Session 62: แก้หัวกระดาษ PDF ทับเนื้อหา (margin top น้อยไป)

### ปัญหา (จากภาพ "หัวกระดาษ ตก.png")
หัวเอกสาร (โลโก้/ชื่อบริษัท/Export/ชื่อเอกสาร + เส้นใต้) **ทับกับ "ข้อมูล NCR" และตาราง** — เพราะ Session 61 ลด page margin top เป็น 18mm ซึ่งน้อยกว่าความสูงหัวที่ Chromium render จริงใน print context (วัด DOM ได้ ~12mm แต่ใน PDF จริงสูงกว่า)

### แก้ (`server/routes/exports.js` — `renderDocPdf`)
- margin top `18mm → 30mm` (ค่าเดียวกับรายงานสรุปรับเข้า PDF ที่หัวสูงกว่า/3 บรรทัด แต่ไม่เคยทับ → ยืนยันปลอดภัย)
- ลดโลโก้ใน `docHeaderTemplate` `40px → 32px` (เท่ารายงานสรุป)

### เหตุผล
หัวเอกสารตอนนี้ (โลโก้ 32px + 2 บรรทัดข้างกัน) เตี้ยกว่าหัวรายงานสรุป (โลโก้ 32px + 3 บรรทัด) ที่ใช้ 30mm แล้วไม่ทับ → ที่ 30mm เอกสารจึงไม่ทับแน่นอน

---

## 2026-06-22 — Session 61: ปรับหัวเอกสาร PDF + แก้บั๊ก printToPDF ค้าง (font ใน header/footer)

### 1. ปรับ layout หัวเอกสาร (`docHeaderTemplate`)
- เปลี่ยนจากเรียงตั้ง (ชื่อบริษัท→ชื่อเอกสาร→Export) เป็น 2 ฝั่ง:
  - ซ้าย: โลโก้ + ชื่อบริษัท + Export (ชื่อบริษัทอยู่ติดเหนือ Export)
  - ขวา: ชื่อเอกสาร "เอกสาร NCR — ..." ชิดขวา (`justify-content:space-between`, `align-items:flex-end`)
- เส้นใต้ (border-bottom) อยู่ใต้ทั้งแถวรวมใต้โลโก้
- โลโก้ใหญ่ขึ้น (34→40px), ลด page margin top 24→18mm (หัวเป็นแถวเดียวเตี้ยลง → เนื้อหาชิดเส้นบนเท่าเดิม)

### 2. แก้บั๊กสำคัญ — printToPDF ค้าง 30s เป็นบางครั้ง
- **สาเหตุ**: Session 58 ฝัง `<style>${FONT_FACE_CSS}</style>` (woff2 data-URI ~80KB) ใน `headerTemplate`/`footerTemplate` → Chromium ใน context ของ header/footer โหลดฟอนต์ค้าง ทำให้ `page.pdf` timeout เป็นครั้งคราว (พิสูจน์ด้วย differential test: font+text ใน header → hang)
- **แก้**: ถอด `FONT_FACE_CSS` ออกจาก `docHeaderTemplate` + `PAGE_FOOTER_TEMPLATE` (และคง fallback ระบบ) — ใช้ `font-family:'IBM Plex Sans Thai','Tahoma','Leelawadee UI',sans-serif` (Windows มีฟอนต์ไทยอยู่แล้ว); **body ยังฝัง IBM Plex เหมือนเดิม** (เนื้อหาหลักฟอนต์ถูกต้อง เพราะ body `await document.fonts.ready`)
- เพิ่ม fallback ไทยให้ header/footer ของรายงานสรุปรับเข้า PDF ด้วย
- `pdfFont.js`: `font-display:block` → `swap` (กันบล็อกการ render)

### ทดสอบ
- render หัวเอกสารใหม่ 3 รอบติด → OK ทุกครั้ง ~250-330ms (เดิมค้าง 30s timeout)

---

## 2026-06-22 — Session 60: ปรับ layout PDF เอกสาร NCR

### แก้ตามที่ขอ (`server/routes/exports.js`)
1. **เส้นใต้หัวเอกสารตรงกับ section** — header template `padding:0 12mm` ตรงกับ body margin 12mm (ยืนยันชิดขอบเท่ากัน)
2. **"ข้อมูล NCR" ชิดเส้นบนขึ้น** — `renderDocPdf`: เพิ่ม `.section-title:first-child{margin-top:0}` + ลด page margin top `30mm → 24mm`
3. **รับเข้า/สุ่มตรวจ/ไม่ผ่าน อยู่ใกล้กัน** — เปลี่ยนจาก `grid repeat(3,1fr)` (กระจายเต็มแถว) → `flex; gap:16px` (ชิดกัน)
4. **รูปรายการสินค้า ≤2 รูป → อยู่ขวาของข้อมูล, >2 รูป → อยู่ด้านล่าง (grid)** — เขียน itemsHtml ใหม่: side-by-side (flex) เมื่อ imgs 1-2, layout เดิม (text + grid ล่าง) เมื่อ ≥3 หรือไม่มีรูป
5. **คำตอบ Supplier ใช้หลักการเดียวกัน** — แยก `respFieldsHtml`; ถ้าไฟล์แนบ 1-2 → รูปอยู่ขวาของข้อมูล (flex), >2 → อยู่ด้านล่างเหมือนเดิม

### ทดสอบ
- render PDF ผ่านทั้ง layout 1/2 รูป (ขวา) และ 3 รูป (ล่าง) → valid %PDF
- เปลี่ยนเฉพาะ NCR body (#3-#5); #1-#2 เป็น renderDocPdf shared มีผลกับ บิล/NCR/UAI สม่ำเสมอ

---

## 2026-06-22 — Session 59: Hardening PDF/JPG export (จาก code review)

### แก้ตามผลตรวจสอบ (memory leak / zombie / race / unclosed page / shared session)
**`server/routes/exports.js`:**
1. **กัน slot รั่วเมื่อ close แฮงค์** — เพิ่ม `closeIsolated(context)` ปิดด้วย `Promise.race` + timeout 5s และไม่ throw → `releasePdfSlot()` ใน finally ได้ทำงานเสมอ (เดิม `await page.close()` ถ้าแฮงค์ slot จะรั่วถาวร)
2. **ลบ dead code** — ลบ `generatePDF` (ยังใช้ html-pdf-node launch browser แยก) + `pdfHtmlWrapper` ที่ไม่มีคนเรียกแล้ว (`getCompanyHeader` ยังใช้กับ JPG จึงคงไว้)
3. **retry เมื่อ browser หลุด** — `openIsolatedPage()` ถ้า `getBrowser/newPage` ล้ม → set `_browserPromise=null` แล้วลองใหม่ 1 ครั้ง (กัน 500 เมื่อ Chromium หลุดกลางคัน)
4. **incognito context ต่อ request** — แต่ละ export เปิด `createIncognitoBrowserContext()` (fallback จาก `createBrowserContext`) แยก storage เด็ดขาด แล้ว `context.close()` ทิ้ง (defense-in-depth กัน state รั่วข้ามผู้ใช้)
5. แก้ `page.evaluateHandle('document.fonts.ready')` → `page.evaluate(async()=>{await document.fonts.ready})` (ไม่เหลือ JSHandle ค้าง + รอ font จริง)

ใช้ `openIsolatedPage()` + `closeIsolated()` ทั้ง 3 endpoint (renderDocPdf, receiving JPG, receiving PDF)

### ผลทดสอบ
- 3 render พร้อมกัน → PDF valid ครบ; หลัง cleanup เหลือ context เดียว (default) = ไม่มี context/page รั่ว
- ยืนยัน pages เป็น opaque origin (ตั้ง cookie ไม่ได้) → ไม่มี shared session/state ข้ามผู้ใช้

### สรุปผลตรวจ (ก่อนแก้)
- memory leak: ครบดี เหลือเคส close แฮงค์ → แก้แล้ว (#1)
- zombie chromium: ต่ำ (puppeteer ปิดให้ตอน exit/signal)
- race condition: ไม่มี (single-thread, getBrowser ไม่มี await คั่น check/set)
- unclosed page: ครบคู่ → เปลี่ยนเป็น context.close ครอบทั้งหมด
- shared session security: ปลอดภัย (setContent, ไม่มี cookie/storage/navigation/fetch ภายนอก) + เสริม incognito ต่อ request

---

## 2026-06-22 — Session 58: เพิ่มความเร็ว Export PDF/JPG — ฟอนต์ฝังในเครื่อง + Chromium singleton

### ปัญหา
Export PDF ช้ากว่า Excel มาก เพราะ (1) เปิด Chromium ใหม่ทุกครั้ง (2) รอโหลดฟอนต์ IBM Plex Sans Thai จาก Google Fonts CDN ผ่านเน็ตด้วย `waitUntil:networkidle0`

### แก้ไข
**1. ฟอนต์ฝังในเครื่อง (offline)**
- ดาวน์โหลด woff2 subset (thai+latin, weight 400/700) ไว้ที่ `server/assets/fonts/` (~60KB)
- `server/lib/pdfFont.js` (ใหม่): อ่าน+base64 ครั้งเดียวตอน load module → export `FONT_FACE_CSS` (@font-face data-URI + unicode-range)
- `exports.js`: แทน `@import url(fonts.googleapis.com...)` ทุกจุดด้วย `${FONT_FACE_CSS}` (body + headerTemplate + footerTemplate) → ตัดการต่อเน็ตออกหมด
- เปลี่ยน `waitUntil` `networkidle0` → `domcontentloaded` + `page.evaluateHandle('document.fonts.ready')` (รอเฉพาะฟอนต์ที่โหลดทันทีจาก data-URI), ลบ `setTimeout 800ms` ของ JPG

**2. Chromium singleton**
- เพิ่ม `getBrowser()` — launch ครั้งเดียวแล้ว reuse ข้าม request, auto-relaunch เมื่อ `disconnected`
- ทุก endpoint (renderDocPdf, receiving JPG, receiving PDF) เปลี่ยนจาก `puppeteer.launch()`/`browser.close()` ต่อ request → `getBrowser()` + เปิด/ปิดเฉพาะ `page` (ปิดใน finally)
- คง `acquirePdfSlot` (จำกัด 2 งานพร้อมกัน) ไว้; ไม่ปิด browser เอง (puppeteer ปิดให้ตอน process exit)

### ผลทดสอบ
- ฟอนต์ IBM Plex Sans Thai โหลดได้แบบ offline (`document.fonts → loaded`)
- launch ครั้งแรก ~560ms (ครั้งเดียว), render ต่อไฟล์ ~270ms (เดิมต้อง launch ใหม่ + รอโหลดฟอนต์ทุกครั้ง)

---

## 2026-06-22 — Session 56: หน้าบิลรับเข้า — Export แบบมีเงื่อนไข + คอลัมน์/ค้นหา Container No.

### 1. Export ข้อมูลบิลแบบมีเงื่อนไข
**Backend (`server/routes/exports.js`)** — เพิ่ม `GET /reports/bills/excel`:
- filters: `supplier_id`, `from`/`to` (received_date), `invoice`, `po`, `container` (LIKE บางส่วนได้), `doc_filter`
- `doc_filter`: `all` / `ncr` (มี Major) / `ncp` (มี Minor) / `both` (มีทั้งคู่) / `any` (มีอย่างใดอย่างหนึ่ง) / `none` (ไม่มีเอกสาร) — ใช้ EXISTS subquery ตาม severity
- Excel: No., Invoice, PO, Container, Tracking, ผู้ผลิต, วันที่รับ, จำนวนรายการ, รายการไม่ผ่าน, เอกสาร NCR, เอกสาร NCP, สถานะบิล + แถวสรุปเงื่อนไข + ผู้ออก/เวลา/จำนวนบิล (LIMIT 5000)

**Frontend (`client/src/pages/Bills/index.jsx`)**:
- ปุ่ม "Export ข้อมูลบิล" → modal เลือกเงื่อนไข (ผู้ผลิต dropdown, ช่วงวันที่, Invoice, PO, Container, เอกสาร NCR/NCP) → `window.open('/api/reports/bills/excel?...')`
- ดึงรายชื่อผู้ผลิตจาก `/master/suppliers`

### 2. Container No. ในตาราง + ค้นหา
- **Frontend**: เพิ่มคอลัมน์ "Container No." (ถัดจาก PO No.), เพิ่ม container_no ใน client-side search + placeholder, ปรับ colSpan 11/12 → 12/13
- **Backend (`server/routes/bills.js`)**: เพิ่ม `b.container_no LIKE ?` ใน q filter ของ `GET /bills`

### ทดสอบ
- SQL doc_filter ทุกค่ารันถูกต้อง (all 13 / ncr 4 / ncp 3 / both 1 / any 6 / none 7 — ตรงตาม set math)

---

## 2026-06-22 — Session 55: รายงานสรุปการรับเข้า — Export PDF หลายหน้า (หัวซ้ำ + เลขหน้า)

### ความต้องการ
เมื่อข้อมูลตกหน้า ให้แบ่งหลายหน้าอัตโนมัติ + เลขหน้าด้านล่าง (เช่น "หน้า 2/1", "หน้า 2/2" = รวม/ปัจจุบัน) + หัวเอกสารซ้ำทุกหน้า (รายงานสรุปการรับเข้าสินค้า + วันที่ export + ผู้ออก + จำนวนราย) + เพิ่มปุ่ม Export PDF

### ไฟล์ที่แก้ไข (`server/routes/exports.js`)
- เพิ่ม helper `receivingTablePieces(rows)` — คืน `{ dataRows, theadRow, summaryCells, totalItems }` ใช้ร่วมกันทั้ง JPG + PDF (DRY, แหล่งความจริงเดียว)
- refactor `GET /reports/receiving/today/jpg` ให้ใช้ helper (ผลลัพธ์เหมือนเดิม)
- เพิ่ม `GET /reports/receiving/today/pdf` (ใหม่):
  - ใช้ puppeteer `page.pdf({ displayHeaderFooter, headerTemplate, footerTemplate })` — A4 แนวนอน
  - `headerTemplate`: โลโก้ + ชื่อบริษัท + "รายงานสรุปการรับเข้าสินค้า" + meta (วันที่/Export/ผู้ออก/จำนวนราย) → ซ้ำทุกหน้า
  - `footerTemplate`: "หน้า {totalPages}/{pageNumber}" → เลขหน้าด้านล่างทุกหน้า
  - `thead{display:table-header-group}` → หัวตารางซ้ำทุกหน้า; `tr{page-break-inside:avoid}` กันแถวขาดกลางหน้า
  - แถวสรุปวางเป็น `<tr class="sumrow">` ท้าย tbody (ไม่ใช้ tfoot ใน PDF เพื่อไม่ให้สรุปซ้ำทุกหน้า)
  - rate limit 5/นาที (pdfRateLimit), จำกัด concurrency ผ่าน acquirePdfSlot

### Frontend (`client/src/pages/Bills/index.jsx`)
- เพิ่มเมนู "Export PDF" ในดรอปดาวน์ "สรุปรับเข้าวันนี้" (ถัดจาก JPG, ก่อน Excel)

### ทดสอบ
- puppeteer `page.pdf` + header/footer template สร้าง PDF หลายหน้าได้จริง (smoke test 120 แถว → valid %PDF)

---

## 2026-06-22 — Session 54: รายงานสรุปการรับเข้า — เพิ่มคอลัมน์ Container No.

### สิ่งที่ทำ (`server/routes/exports.js`)
- `buildDailyReportData()`: เพิ่ม `b.container_no` ใน SELECT (มีอยู่ในตาราง bills แล้ว)
- `GET /reports/receiving/today/jpg`: เพิ่มคอลัมน์ "Container No." (ถัดจาก PO No.) ใน thead + row, bump tfoot colspan 5 → 6
- `GET /reports/receiving/today/excel`: เพิ่มคอลัมน์ "Container No." ใน `ws.columns` + addRow, ปรับ index แถวสรุป + info row ให้ตรงกับคอลัมน์ที่เพิ่ม

---

## 2026-06-22 — Session 53: รายงานสรุปการรับเข้า — เปลี่ยน label แถวสรุป

เปลี่ยนข้อความแถวสรุปจาก "สรุป จำนวนรายการรับเข้าทั้งหมด" → **"สรุป รายการรับเข้า ทั้งหมด"** ทั้ง JPG และ Excel (`server/routes/exports.js`)

---

## 2026-06-22 — Session 52: รายงานสรุปการรับเข้า — NCP = "ผ่าน (มีเงื่อนไข)" นับเป็นผ่าน

### ความต้องการ
ในรายงานสรุปการรับเข้าสินค้า รายการที่มีเอกสาร **NCP (minor)** ให้ถือว่า **ผ่าน (แบบมีเงื่อนไข)** และนับเป็น "ผ่าน" ในแถวสรุป — มีเพียงรายการที่มี **NCR (major)** เท่านั้นที่นับเป็น "ไม่ผ่าน"
- ตัวอย่าง: รับเข้า 10 รายการ มี NCP 2 + NCR 1 → ผ่าน 9, ไม่ผ่าน 1, คิดเป็น 90%

### ไฟล์ที่แก้ไข (`server/routes/exports.js`)
- เพิ่ม helper `rowVerdict(row)` (ใช้ร่วม JPG + Excel):
  - `fail` = มีเอกสาร NCR (major) **หรือ** พบของเสีย (`qty_failed > 0`) แต่ยังไม่ออกเอกสาร
  - `conditional` = มีเฉพาะเอกสาร NCP (minor) → ผ่านแบบมีเงื่อนไข (นับเป็นผ่าน)
  - มิฉะนั้น = ผ่าน
- `GET /reports/receiving/today/jpg`:
  - ช่องผล: 3 สถานะ — ไม่ผ่าน (แดง) / **ผ่าน (มีเงื่อนไข)** (ส้ม #D97706) / ผ่าน (เขียว); พื้นแถว NCP = เหลืองอ่อน (#FFFBEB)
  - แถวสรุป: `failItems` นับเฉพาะ `rowVerdict().fail` → NCP ไม่ถูกนับเป็นไม่ผ่านอีกต่อไป, passPct ปรับตาม
- `GET /reports/receiving/today/excel`: ช่องผลการตรวจ + สีตามสถานะเดียวกัน, แถวสรุปใช้ logic เดียวกัน

### หมายเหตุ
- เปลี่ยนเฉพาะ **ช่องผล (verdict)** + แถวสรุป — คอลัมน์จำนวนชิ้น (รับเข้า/ผ่าน/ไม่ผ่าน รายแถว) ยังเป็นจำนวนชิ้นจริงเหมือนเดิม
- ความเชื่อมโยง: สอดคล้องกับ Session 51 ที่ NCP เป็นเอกสารบันทึกภายใน (ปิดโดย QC Supervisor) ไม่ถือเป็นการ reject สินค้า

---

## 2026-06-22 — Session 51: แก้บั๊ก NCP ค้างสถานะ pending_manager เมื่อ Supervisor สร้างเอง

### ปัญหา
เมื่อ QC Supervisor สร้างเอกสาร NCP (minor) เอง สถานะถูกตั้งเป็น `pending_manager` ("รอ QC Manager อนุมัติ") แต่ QC Manager ไม่มีปุ่มอนุมัติ → เอกสารค้างถาวร

### สาเหตุ (`server/routes/ncr.js` — POST `/`)
โค้ดสร้าง NCR ตั้ง `status='pending_manager'` ให้ **ทุกเอกสารที่ supervisor สร้าง** โดยไม่แยก severity
- แต่ flow ของ NCP (minor) มีแค่ transition เดียว: `pending_supervisor → ncp_closed` (โดย qc_supervisor) — **ไม่มีขั้น pending_manager เลย**
- ผล: NCP ไป `pending_manager` แต่ทั้ง frontend (`canApprove` ของ NCP รองรับแค่ supervisor+pending_supervisor) และ backend (`transitions` ของ minor ไม่มี key `pending_manager`) ไม่มีใครดำเนินการต่อได้ → ค้าง

### การแก้ไข
**`server/routes/ncr.js`** — แยกเงื่อนไขตอน supervisor สร้าง:
- **NCP (minor)**: supervisor สร้างเอง = อนุมัติปิดในตัว → ปิดเป็น `ncp_closed` ทันที + บันทึก approval "สร้างและปิด NCP โดย QC Supervisor" + แจ้งเตือน qc_manager/ผู้สร้าง + Telegram QC (สอดคล้องกับที่ supervisor สร้าง NCR Major แล้ว auto-approve L1)
- **NCR Major**: คงพฤติกรรมเดิม → `pending_manager` รอ QC Manager

**`server/db/database.js`** — Data-heal (วางหลัง NCR migrations + status-as-text rebuild, idempotent):
- `UPDATE ncrs SET status='ncp_closed', closed_at=... WHERE severity='minor' AND status='pending_manager'` — ปิดเอกสาร NCP ที่ค้างจาก bug เดิมอัตโนมัติตอน start
- เอกสารที่ค้างจริงในระบบ: NCP-2026-0002 (1 รายการ) — heal เรียบร้อยแล้ว

### หมายเหตุ
- qc_staff สร้าง NCP → `pending_supervisor` → supervisor กด "อนุมัติปิดเอกสาร NCP" → `ncp_closed` (เหมือนเดิม ไม่กระทบ)

---

## 2026-06-22 — Session 50: รายงานสรุปการรับเข้า — แถวรวมแสดงเป็น "จำนวนรายการ" + ย้าย % ไปช่องผล

### ความต้องการ
แถวสรุปล่างสุด (tfoot) ของรายงานสรุปการรับเข้าสินค้า เดิมรวม **จำนวนชิ้น** (qty) — ปรับให้นับเป็น **จำนวนรายการ** (ตัวเลขล้วน ไม่มีคำว่า "รายการ" ในช่อง) ตามรูปแบบ:
- ช่อง **รายการสินค้า** (colspan): "สรุป จำนวนรายการรับเข้าทั้งหมด" (เดิม "รวม X รายการ")
- ช่อง **รับเข้า**: จำนวนรายการทั้งหมด เช่น `10`
- ช่อง **ผ่าน**: จำนวนรายการที่ผ่าน เช่น `9`
- ช่อง **ไม่ผ่าน**: จำนวนรายการที่ไม่ผ่าน เช่น `1`
- ช่อง **ผล**: เปอร์เซ็นต์ผ่าน เช่น `90.0%` (เดิมไม่มี / เคยอยู่ใต้ตัวเลข)

### ไฟล์ที่แก้ไข (`server/routes/exports.js`)
- `GET /reports/receiving/today/jpg` (รายงานภาพ "รายงานสรุปการรับเข้าสินค้า"):
  - ใช้ `totalItems/passItems/failItems` (นับรายการ; รายการไม่ผ่าน = `qty_failed > 0`) + `passPct`
  - tfoot: รายการสินค้า="สรุป จำนวนรายการรับเข้าทั้งหมด", รับเข้า=totalItems, ผ่าน=passItems, ไม่ผ่าน=failItems, ผล=passPct%
- `GET /reports/receiving/today/excel` (Excel "สรุปรับเข้าวันนี้"): แถวสรุปปรับแบบเดียวกัน — ผลผ่าน% อยู่ช่อง "ผลการตรวจ"

### หมายเหตุ
- รายงานนี้มีเฉพาะรูปแบบ export (JPG/Excel) จากปุ่ม "สรุปรับเข้าวันนี้" ในหน้า Bills — ไม่มีตารางแสดงบนหน้าจอ
- รายการในตารางแต่ละแถว (qty รายชิ้น) ยังแสดงจำนวนชิ้นเหมือนเดิม เปลี่ยนเฉพาะแถวรวมล่างสุด
- % คิดจาก **จำนวนรายการ** (passItems / totalItems) ไม่ใช่จำนวนชิ้น

---

## 2026-06-22 — Session 49: แจ้งเตือนกระดิ่งเข้า Telegram ส่วนตัวของแต่ละ User

### สิ่งที่ทำ

ทุกการแจ้งเตือนที่ขึ้นกระดิ่งของ user คนใด จะถูกส่งเข้า Telegram ส่วนตัวของคนนั้นทันที (แยกจาก Telegram กลุ่ม QC/จัดซื้อเดิม) โดย admin ตั้งค่า Chat ID ราย user ได้ที่หน้า "จัดการผู้ใช้งาน"

**DB (`server/db/database.js`):**
- `runMigrations()`: เพิ่ม `safeAddColumn('users', 'telegram_chat_id', 'TEXT')` (idempotent)

**Backend (`server/routes/notifications.js`):**
- เพิ่มฟังก์ชัน `notifyUserTelegram(userId, title, message, link)` — อ่าน `users.telegram_chat_id`, ถ้ามีค่า → ส่งข้อความ `[IQC] <title>\n<message>\n<app_url+link>` แบบ fire-and-forget (ไม่ await, ส่งไม่ได้ → log แล้วไปต่อ ตาม CLAUDE.md §12)
- `createNotification()`: เรียก `notifyUserTelegram()` ต่อจาก SSE push — ครอบคลุมทุก notification อัตโนมัติ (ทุก route + `lib/notify.js` funnel ผ่าน createNotification ตัวเดียวกัน)
- export `notifyUserTelegram` เพิ่ม

**Backend (`server/index.js`) — Admin User CRUD:**
- `GET/POST/PATCH /api/admin/users`: เพิ่มฟิลด์ `telegram_chat_id` (trim, ว่าง → NULL) ใน select/insert/update + audit log
- เพิ่ม endpoint `POST /api/admin/users/:id/telegram-test` — ส่งข้อความทดสอบเข้า Telegram ส่วนตัวของ user เพื่อให้ admin verify chat id (ตรวจ bot token + chat id ก่อนส่ง)

**Frontend (`client/src/pages/Admin/Users.jsx`):**
- `UserForm`: เพิ่ม input "Telegram Chat ID" (numeric, mono) + คำอธิบายวิธีหา Chat ID ผ่าน @userinfobot
- ตาราง: เพิ่มคอลัมน์ "Telegram" แสดง chat id (badge) + ปุ่ม "ทดสอบ" ยิง `telegram-test`
- เพิ่ม `telegramTest` mutation + toast แจ้งผลส่ง (สำเร็จ/ล้มเหลว, auto-hide 4s)
- ปรับ colSpan empty state 7 → 8

### พฤติกรรม
- User ที่ admin กรอก Chat ID → ได้รับแจ้งเตือนทุกเรื่องที่ขึ้นกระดิ่ง เข้า Telegram ส่วนตัวทันที พร้อมลิงก์ไปหน้าที่เกี่ยวข้อง
- User ที่เว้นว่าง Chat ID → ไม่ส่งเข้า Telegram ส่วนตัว (กระดิ่งในระบบทำงานปกติ)
- Telegram กลุ่ม QC/จัดซื้อเดิม ยังทำงานเหมือนเดิม ไม่กระทบ

---

## 2026-06-19 — Session 48: Products Export/Import Excel

### สิ่งที่ทำ

**Backend (`server/routes/master.js`):**
- เพิ่ม `ExcelJS` + `multer` (memory storage) สำหรับ Excel upload
- `GET /master/products/export` — ส่ง .xlsx:
  - Sheet "สินค้า": รหัส, ชื่อ, Supplier, กลุ่ม, หน่วย, Inspection Level, AQL, หมายเหตุ พร้อมข้อมูลปัจจุบันทั้งหมด
  - Sheet "Reference": รายการ Supplier / กลุ่ม / หน่วย / Inspection Level / AQL ที่ใช้ได้ (สำหรับ reference ตอน fill)
- `POST /master/products/import?preview=1` — ตรวจสอบ: required fields, FK lookup (supplier/group/unit by name), valid level/AQL, code unique vs DB + dup in file, name dup warning → return `{ results, total, errorCount, warningCount }`
- `POST /master/products/import` — import จริง: insert products + product_suppliers + auditLog ใน transaction

**Frontend (`client/src/pages/Master/Products.jsx`):**
- ปุ่ม "Export Excel": download blob จาก `/api/master/products/export`
- ปุ่ม "Import Excel": เปิด modal state machine (pick → previewing → preview → importing → done)
  - Step pick: file picker .xlsx + ปุ่มตรวจสอบ
  - Step preview: ตารางผลตรวจสอบแถวต่อแถว (สี error=แดง, warning=เหลือง, ok=ขาว), summary chips, ปุ่ม "นำเข้า" disable ถ้ามี error
  - Step done: success screen พร้อม invalidate query

---

## 2026-06-18 — Session 47: QC Attendance — ระบบเช็คชื่อพนักงาน QC + Geofence

### สิ่งที่ทำ

**DB:**
- `schema.sql`: เพิ่ม table `qc_attendance` (user_id, date UNIQUE, check_in_at, lat, lon, geofence_ok)
- `database.js`: migration `users.qc_station TEXT` + seed settings `factory_lat/lon/radius_m`

**Backend:**
- `server/routes/attendance.js` (ใหม่):
  - `GET /stations` — รายการสถานี QC
  - `GET /my-status` — สถานะเช็คชื่อวันนี้ของตัวเอง + geofence config
  - `POST /check-in` — เช็คชื่อพร้อม server-side Haversine verify
  - `GET /today?date=` — overview ทุก QC staff (supervisor/manager/admin)
  - `GET /history?date=&user_id=` — ประวัติ
- `server/index.js`: เพิ่ม user CRUD รองรับ `qc_station`, เพิ่ม `GET/POST /admin/settings/geofence`, register `/api/attendance`

**Frontend:**
- `Admin/Users.jsx`: dropdown "สถานีปฏิบัติงาน QC" (เห็นเฉพาะ qc_staff/qc_supervisor), column ในตาราง
- `QCAttendance/index.jsx` (ใหม่): Overview แบ่งกลุ่มตาม station, summary cards, filter วันที่, ปุ่มเช็คชื่อสำหรับ QC staff
- `QCAttendance/CheckIn.jsx` (ใหม่): Geolocation + Haversine client-side, แสดงสถานะ GPS, ปุ่ม check-in enable เมื่ออยู่ใน geofence
- `App.jsx`: routes `/qc-attendance` + `/qc-attendance/checkin`
- `rolePermissions.js`: nav item "เช็คชื่อ QC" (admin/qc_staff/qc_supervisor/qc_manager)
- Sidebar + BottomNav: icon `checkin` ใหม่

**สถานี QC:** รับเข้า, โรง1, โรง2, โรง4, บานพิเศษ, Calibration, Admin, Supervisor (qc_manager ไม่เช็คชื่อ)

---

## 2026-06-18 — Session 46: Issue Talk — Group Read Count ("อ่านแล้ว X คน")

### สิ่งที่ทำ (`client/src/pages/IssueTalk/Detail.jsx`)

- เปลี่ยนจาก boolean `showRead` → `readCount` (int) + `totalOthers` (int) ต่อ message
- คำนวณ `readCount` ต่อ message = จำนวนคนอื่นที่ `last_read_message_id >= msg.id`
- แสดงใต้ฟองข้อความของตัวเอง:
  - 1-on-1 (`totalOthers === 1`): "อ่านแล้ว"
  - กลุ่ม (`totalOthers > 1`): "อ่านแล้ว X คน"
- แสดงทุก message ที่ `readCount > 0` (ไม่จำกัดแค่ข้อความล่าสุด)

---

## 2026-06-18 — Session 45: Issue Talk — Faceted Filter Dropdowns

### สิ่งที่ทำ

**Backend** (`server/routes/issue-talk.js`):
- เพิ่ม `GET /facets?filter=all|mine|tagged` endpoint ใหม่ (วางก่อน `GET /`)
- ส่งกลับ 3 ชุด: `statuses[]`, `tagged_users[]`, `suppliers[]` scoped ตาม access control เดิม
- ไม่รับ sub-filter params — แสดงทุก value ที่มีอยู่จริงใน issues ที่ user เข้าถึงได้

**Frontend** (`client/src/pages/IssueTalk/index.jsx`):
- แทน `['issue-talk-users']` + `['issue-talk-suppliers']` ด้วย query `['issue-talk-facets', filter]` เดียว
- Dropdown ทั้งสาม (สถานะ / ผู้ Tag / Supplier) แสดงเฉพาะค่าที่มีจริงใน card
- เพิ่ม `useEffect` ล้าง sub-filter ที่ไม่มีใน facets ใหม่อัตโนมัติเมื่อสลับแท็บ

---

## 2026-06-18 — Session 44: Issue Talk — Supplier Filter + "อ่านแล้ว" indicator

### สิ่งที่ทำ

**Supplier filter** (`server/routes/issue-talk.js`, `client/src/pages/IssueTalk/index.jsx`):
- Backend: รับ `supplier_id` param → `AND it.supplier_id = ?` ใน extraSQL
- Frontend: เพิ่ม `supplierFilter` state + query `['issue-talk-suppliers']` → dropdown ในแถว grid 3 คอลัมน์ (สถานะ / ผู้ Tag / Supplier)
- hasFilter + resetFilters ครอบ supplierFilter ด้วย

**"อ่านแล้ว" indicator** (`server/routes/issue-talk.js`, `client/src/pages/IssueTalk/Detail.jsx`):
- Backend GET /:id: return `reads: [{user_id, last_read_message_id}]` จาก `issue_talk_reads`
- Frontend Detail.jsx:
  - คำนวณ `otherMemberIds` = ผู้ร่วมห้องทุกคนยกเว้นตัวเอง
  - `allReadUpTo = Math.min(...others' last_read_message_id)` — ถ้า 0 แปลว่ายังไม่มีใครอ่าน
  - `lastReadMsgId` = id ของข้อความของตัวเองล่าสุดที่ทุกคนอ่านแล้ว
  - MessageBubble รับ `showRead` prop → แสดง checkmark เขียว + "อ่านแล้ว" ใต้ข้อความ (ขวา) เฉพาะ message นั้น

---

## 2026-06-18 — Session 43: Issue Talk — Filter Panel (กรองสถานะ / ผู้ถูก Tag / ค้นหาชื่อ)

### สิ่งที่ทำ

**Backend** (`server/routes/issue-talk.js` — `GET /`):
- รับ query params `status` + `tagged_user_id` เพิ่มเติม
- Build `extraSQL` + `extraParams` แบบ conditional:
  - `status` → whitelist จาก `VALID_STATUSES` → `AND it.status = ?`
  - `tagged_user_id` → `AND EXISTS (SELECT 1 FROM issue_talk_participants ...)`
- ใส่ `extraSQL` ใน WHERE ทั้ง rows query และ count query

**Frontend** (`client/src/pages/IssueTalk/index.jsx` — `IssueTalkList`):
- เพิ่ม state `statusFilter`, `taggedUserId`
- เพิ่ม `useQuery` ดึง users list (`/issue-talk/users`) สำหรับ dropdown
- อัปเดต query key → `['issue-talks', filter, q, statusFilter, taggedUserId]`
- อัปเดต API params → ส่ง `status` + `tagged_user_id`
- เพิ่ม `hasFilter` computed + `resetFilters()` function
- Filter panel UI: card สีขาว ล้อม search input + สองปุ่ม dropdown (สถานะ / ผู้ถูก Tag) + ปุ่ม "รีเซ็ต" (แสดงเมื่อ hasFilter)
- Empty state: ถ้า hasFilter แสดง "ไม่พบ" + ลิงก์ล้างตัวกรอง; ถ้าไม่มีแสดงปุ่มสร้างใหม่

---

## 2026-06-18 — Session 42: Issue Talk — Chat Layout Lock (หน้าไม่เลื่อนลงเมื่อ scroll แชท)

### ปัญหา
`<main>` มี `overflow-y-auto` — เมื่อ scroll ข้อความในแชทจนสุด `<main>` จะเลื่อนต่อไปด้านล่าง ทำให้ช่อง reply หายไปจากหน้าจอ

### วิธีแก้ (`client/src/pages/IssueTalk/Detail.jsx`)
- **useEffect lock**: override `main.style.overflowY = 'hidden'` + `main.style.padding = '0'` ขณะอยู่หน้า Detail; คืนค่าเดิมเมื่อ unmount
- **3-zone flex layout**: เปลี่ยน root div เป็น `flex flex-col h-full`:
  - Zone 1 (header): `flex-shrink-0` — ไม่ขยับ, แสดง title + supplier + status
  - Zone 2 (messages): `flex-1 min-h-0 overflow-y-auto` — เลื่อนได้เฉพาะ zone นี้
  - Zone 3 (reply form): `flex-shrink-0 pb-20 lg:pb-0` — ติดด้านล่างเสมอ, `pb-20` ป้องกัน bottom nav ทับบน mobile

### พฤติกรรมที่ได้
- Header (title/supplier/status) ติดบนตลอด
- scroll ข้อความได้ภายใน Zone 2 เท่านั้น
- ช่องพิมพ์ข้อความ (Zone 3) ไม่หายแม้มีข้อความเยอะ
- navigate ออก → padding ของ main คืนค่าเดิมอัตโนมัติ (ไม่กระทบหน้าอื่น)

---

## 2026-06-18 — Session 41: Issue Talk — Bug fixes × 7

### ปัญหาและวิธีแก้

| # | ปัญหา | แก้ที่ | วิธี |
|---|-------|--------|------|
| 1 | ปิดห้องแล้วยังตอบได้ 1 ข้อความ | server route + refetchInterval | server ตรวจ `status === closed` ก่อน insert; client poll 3s |
| 2 | ไม่มีปุ่ม download รูป/VDO/ไฟล์ | `AttachmentItem` | รูป: overlay download บน hover; VDO: link ใต้; ไฟล์: ปุ่ม download ชัดเจน |
| 3 | เวลาแสดง 7 ชม. ที่แล้วทั้งที่ใหม่ | `fmtTime` in index.jsx | SQLite UTC ไม่มี 'Z' → ต่อ 'Z' ก่อน parse |
| 4 | อัปโหลดไม่มี progress bar | `sendReply` mutation + Detail UI | `onUploadProgress` ใน axios config; progress bar ใต้ชื่อไฟล์แต่ละไฟล์ |
| 5 | header ไม่ lock เมื่อ scroll | Detail.jsx layout | `sticky top-0 bg-bg z-10 -mx-4 px-4` |
| 6 | title/supplier ไม่ใช่ highlighted tag | Detail.jsx header | title: `bg-primary/10 text-primary rounded-lg`; supplier: `bg-cyan-50 rounded-lg` |
| 7 | คู่สนทนาไม่ real-time | Detail.jsx query | `refetchInterval: 3000` (poll ทุก 3 วินาที) |

### ไฟล์ที่แก้ไข
- `server/routes/issue-talk.js` — `POST /:id/messages`: เพิ่มตรวจ `issue.status === 'closed'` ก่อน transaction
- `client/src/pages/IssueTalk/index.jsx` — `fmtTime`: ต่อ 'Z' เมื่อ timestamp ไม่มี timezone suffix
- `client/src/pages/IssueTalk/Detail.jsx`
  - `AttachmentItem`: download overlay บนรูป, download link ใต้ VDO, ปุ่ม download ชัดเจนบนไฟล์อื่น
  - query: `refetchInterval: 3000`
  - state: `uploadProgress` + `onUploadProgress` callback + reset on success/error
  - sticky header (title + supplier highlighted tags + status)
  - ลบ standalone supplier section เดิม (ย้ายเข้า sticky header)
  - progress bar ใต้ชื่อแต่ละไฟล์เมื่อกำลัง upload

---

## 2026-06-18 — Session 40: Issue Talk — Badge บน Sidebar/BottomNav แทน Bell Notification

### ไฟล์ที่แก้ไข
- `server/routes/issue-talk.js`
  - เพิ่ม `GET /unread-total` endpoint (ก่อน `GET /:id`) → คืน `{ total: N }` รวมทุก room ที่ user เข้าถึงได้
  - `POST /:id/messages`: ลบ `notifyParticipants` call ออก — ไม่ส่ง notification ไปกระดิ่งสำหรับ reply
- `client/src/hooks/useSSE.js` — เพิ่ม `['issue-talk-unread']` ใน invalidation keys เมื่อ issue-talk event ยิง
- `client/src/pages/IssueTalk/Detail.jsx` — เพิ่ม `useEffect` invalidate `['issue-talk-unread']` + `['issue-talks']` ทันทีที่เปิดห้องหรือมี message ใหม่ (badge หายทันที)
- `client/src/components/Layout/Sidebar.jsx`
  - import `useQuery`
  - เพิ่ม `useQuery(['issue-talk-unread'])` + `refetchInterval: 30000` เป็น fallback
  - เพิ่ม `<IssueTalkBadge>` component (วงกลมแดง) บน menu Issue Talk
- `client/src/components/Layout/BottomNav.jsx`
  - import `useQuery` + `api`
  - เพิ่ม badge ซ้อนบนไอคอน Issue Talk (mainItems) หรือข้างชื่อใน popup (moreItems)
  - ถ้า Issue Talk อยู่ใน moreItems → แสดง dot แดงเล็กบน "เพิ่มเติม" ปุ่มด้วย

### พฤติกรรม
- Reply ใน chat → **ไม่** ส่งไปกระดิ่ง, แต่ badge บน menu Issue Talk ขึ้น
- เปิดอ่านห้องนั้น (GET /:id) → server mark as read + client invalidate → badge ลดทันที
- ถ้ามีหลายห้อง ต้องเปิดอ่านทุกห้องจึงจะ badge = 0
- polling ทุก 30 วินาที เพราะ reply ไม่มี SSE event อีกต่อไป

---

## 2026-06-18 — Session 39: Issue Talk — Unread Badge (วงกลมแดงข้อความยังไม่ได้อ่าน)

### ไฟล์ที่แก้ไข
- `server/db/schema.sql` — เพิ่มตาราง `issue_talk_reads` (track `last_read_message_id` ต่อ user ต่อ issue) + index
- `server/routes/issue-talk.js`
  - `GET /` list: เพิ่ม subquery `unread_count` (นับ messages จากคนอื่นที่ id > last_read_message_id ของ user นั้น)
  - `GET /:id` detail: หลัง fetch messages → upsert `issue_talk_reads` ด้วย `MAX()` (ไม่ถอย pointer)
  - `POST /:id/messages`: auto-mark sender as read ภายใน transaction เดียวกัน
- `client/src/pages/IssueTalk/index.jsx` — เพิ่ม red badge (วงกลมแดง) ใน IssueCard ถ้า `unread_count > 0`

### พฤติกรรม
- วงกลมแดงแสดงจำนวนข้อความใหม่จากคนอื่น (ไม่นับข้อความของตัวเอง)
- เมื่อเปิดห้องสนทนา (GET /:id) → badge หายอัตโนมัติ (React Query invalidate list)
- เมื่อส่งข้อความ → sender ถูก mark as read ทันที ไม่มี badge ของตัวเอง
- ป้องกัน pointer ถอยหลังด้วย `MAX(last_read_message_id, ...)`

---

## 2026-06-18 — Session 38: Issue Talk — เพิ่ม Supplier dropdown + แก้ File Picker ใน CreateModal

### ไฟล์ที่แก้ไข
- `client/src/pages/IssueTalk/index.jsx`
  - ลบ `useRef` import (ไม่ใช้แล้ว) + ลบ `fileRef`
  - เพิ่ม `supplierId` state + `useQuery` ดึง `/issue-talk/suppliers`
  - เพิ่ม `<select>` dropdown เลือก Supplier จาก Master list (optional)
  - แก้ file input จาก `ref.click()` → `<label htmlFor>` + `<input id className="sr-only">` (รองรับทุก browser)
  - แก้ `handleFileChange` ใช้ `Array.from(e.target.files)` + reset `e.target.value`
  - append `supplier_id` ใน FormData เมื่อ submit
  - เพิ่มแสดงชื่อ Supplier (badge สีฟ้าอ่อน) ใน `IssueCard` list

### สาเหตุที่แก้
- `ref.current?.click()` บน `display:none` input ถูก block ใน Firefox/WebKit บางเวอร์ชัน → ใช้ label/id แทน
- `ROLE_LABEL` ย้ายออกนอก function เพื่อไม่ต้อง recreate ทุก render

---

## 2026-06-18 — Session 37: Issue Talk — ระบบห้องสนทนาภายในองค์กร

### ไฟล์ที่สร้างใหม่
- `server/routes/issue-talk.js` — API ครบ: GET list, POST create, GET detail, POST reply, PATCH status, PATCH participants + GET `/users`
- `client/src/pages/IssueTalk/index.jsx` — หน้าแสดงรายการห้องสนทนา (filter: ทั้งหมด/ของฉัน/ถูก Tag) + CreateModal
- `client/src/pages/IssueTalk/Detail.jsx` — หน้าห้องสนทนา: opening post, chat bubbles, reply form, add participants modal

### ไฟล์ที่แก้ไข
- `server/db/schema.sql` — เพิ่ม 4 tables: `issue_talks`, `issue_talk_participants`, `issue_talk_messages`, `issue_talk_attachments` + 8 indexes
- `server/middleware/upload.js` — เพิ่ม `issueTalkFilter` (รูป/วีดีโอ/PDF) + `issueTalk` multer config (100MB limit)
- `server/index.js` — register `/api/issue-talk`
- `client/src/hooks/useSSE.js` — เพิ่ม `issue-talk` และ `delivery` ใน `getKeysFromLink()`
- `client/src/App.jsx` — import + Route `/issue-talk` + `/issue-talk/:id`
- `client/src/utils/rolePermissions.js` — เพิ่ม Issue Talk nav item (ทุก role)
- `client/src/components/Layout/BottomNav.jsx` — เพิ่ม `chat` icon
- `client/src/components/Layout/Sidebar.jsx` — เพิ่ม `chat` icon

### สิ่งที่เปลี่ยน
- **สร้างห้อง**: กรอกหัวเรื่อง + รายละเอียด + Tag ผู้ใช้งานได้หลายคน + แนบไฟล์ (รูป/VDO/PDF) ตั้งแต่ตอนสร้าง
- **สิทธิ์เข้าถึง**: เห็นเฉพาะผู้สร้างและคนที่ถูก Tag เท่านั้น
- **Chat UI**: opening post แสดงที่ด้านบน, ข้อความของตัวเองชิดขวา (bubble สีน้ำเงิน), คนอื่นชิดซ้าย (bubble สีเทา)
- **ไฟล์แนบ**: รูปแสดงเป็น thumbnail, VDO ใช้ `<video controls>`, PDF/อื่นๆ เป็น download link
- **สถานะ**: open / รอข้อมูล / รอดำเนินการ / รอการตัดสินใจ / แก้ไขแล้ว / ปิด (ผู้สร้างเปลี่ยนได้)
- **Notification**: SSE + Telegram (QC group) เมื่อสร้างห้อง/ตอบกลับ; ส่ง Telegram purchasing group ด้วยถ้า Tag role purchasing
- **เพิ่มผู้เข้าร่วมทีหลัง**: ผู้สร้างกด "+ เพิ่ม" ในหน้าห้องสนทนา
- **Reply**: Enter = ส่ง, Shift+Enter = ขึ้นบรรทัดใหม่
- **ปิดห้อง**: status=closed → ปิดช่อง reply, ข้อความแจ้งว่าปิดแล้ว
- Navigation: เมนู "Issue Talk" (Sidebar desktop) + icon chat (BottomNav mobile, label "Issues")

## 2026-06-18 — Session 36: Delivery — ระบบวันหยุดบริษัท + วันอาทิตย์เป็นวันหยุดถาวร

### ไฟล์ที่แก้ไข
- `server/db/schema.sql` — เพิ่ม table `company_holidays` + index `idx_holidays_date`
- `server/routes/holidays.js` — สร้างใหม่: GET `/?year=X`, POST `/`, DELETE `/:id` (admin only)
- `server/index.js` — register `/api/holidays`
- `server/routes/delivery.js` — POST `/`: เช็ค `company_holidays` + วันอาทิตย์ ส่ง notification วันหยุดบริษัทด้วย
- `client/src/pages/Admin/Holidays.jsx` — สร้างใหม่: หน้า admin จัดการวันหยุด
- `client/src/App.jsx` — import + Route `/admin/holidays`
- `client/src/utils/rolePermissions.js` — เพิ่ม "วันหยุดบริษัท" ใน admin children
- `client/src/pages/Delivery/index.jsx` — fetch holidays, holiday helper, ปฏิทินแสดงวันหยุด

### สิ่งที่เปลี่ยน
- **วันหยุดบริษัท**: Admin เพิ่ม/ลบวันหยุดได้ที่ `/admin/holidays` กรอกวันที่ + ชื่อวันหยุด
- **วันอาทิตย์ = วันหยุดถาวร**: ไม่ต้องบันทึกในตาราง — `holidayReason()` เช็ค `getDay() === 0` อัตโนมัติ
- **ปฏิทิน**: เซลล์วันอาทิตย์ + วันหยุดบริษัท แสดงพื้นหลังแดงอ่อนและ label "หยุด" / ชื่อวันหยุด
- **CreateModal**: `handleSave()` ตรวจวันหยุดบริษัทด้วย (เดิมเช็คแค่เสาร์-อาทิตย์) → แสดง popup ยืนยันเมื่อนัดวันหยุด
- **Server notification**: POST `/delivery` ตรวจ `company_holidays` table หากวันนั้นเป็นวันหยุดบริษัท ส่ง notification + Telegram เหมือนกับวันเสาร์-อาทิตย์
- `weekendReason()` ปรับให้ return เฉพาะวันเสาร์ (วันอาทิตย์ย้ายไป `holidayReason()`)

## 2026-06-18 — Session 35: Delivery — Reschedule ย้ายวันในปฏิทิน + History Log

### ไฟล์ที่แก้ไข
- `server/routes/delivery.js` — PATCH status: อัปเดต `scheduled_date` เมื่อ rescheduled, ปรับ audit log ให้เก็บ date เดิม/ใหม่, เพิ่ม GET `/:id/history`
- `client/src/pages/Delivery/index.jsx` — staleTime: 0, `updateStatus.onSuccess` invalidate ทั้ง delivery + delivery-history, เพิ่ม History section ใน DetailModal

### สิ่งที่เปลี่ยน
- เมื่อ purchasing เลือก rescheduled + วันใหม่ → server อัปเดต `scheduled_date` ให้เป็นวันใหม่ ปฏิทินย้าย entry ไปกล่องวันที่ถูกต้องทันที
- `staleTime: 0` → query refetch ทันทีหลัง invalidate ไม่มี cache delay
- `invalidateQueries` เปลี่ยนเป็น object format (React Query v5) เพื่อ prefix match ถูกต้อง
- History section ใน DetailModal: กด "ประวัติการดำเนินการ" เพื่อ toggle แสดง timeline สถานะทุกครั้งที่มีการเปลี่ยนแปลง พร้อมวันใหม่และเหตุผล

## 2026-06-18 — Session 34: Delivery — ส่งงานตัวอย่าง + แนบรูป

### ไฟล์ที่แก้ไข
- `server/db/database.js` — migration `has_sample INTEGER DEFAULT 0` ใน `delivery_schedules`
- `server/routes/delivery.js` — POST `/` บันทึก `has_sample`; POST `/:id/attachments` รองรับ `?type=sample` → `file_type='sample_image'`
- `client/src/pages/Delivery/index.jsx` — CreateModal + DetailModal

### สิ่งที่เปลี่ยน
- **CreateModal**:
  - Checkbox "ส่งงานตัวอย่าง" ใต้ช่อง Packing List
  - ถ้าติ๊ก → แสดงกล่อง "แนบรูปงานตัวอย่าง" พร้อม preview thumbnail ก่อนบันทึก
  - Upload sample files แยก endpoint `?type=sample`; ยกเลิกติ๊ก → ล้างไฟล์
- **DetailModal**:
  - Badge "ส่งงานตัวอย่าง" ข้าง StatusBadge ถ้า `has_sample=1`
  - แยก attachments: docs (Packing List ฯลฯ) vs รูปงานตัวอย่าง (sample_image)
  - รูปตัวอย่างแสดง thumbnail grid; hover → ปุ่ม × ลบ (purchasing เท่านั้น)
  - Purchasing แนบรูปเพิ่มทีหลังได้

## 2026-06-18 — Session 33: Delivery — Items Section: Product Dropdown + is_urgent

### ไฟล์ที่แก้ไข
- `server/db/database.js` — เพิ่ม migration `safeAddColumn('delivery_schedule_items', 'is_urgent', 'INTEGER DEFAULT 0')`
- `server/routes/delivery.js` — อัปเดต INSERT ทั้ง planned (`POST /`) และ unplanned (`POST /unplanned`) ให้บันทึก `is_urgent`
- `client/src/pages/Delivery/index.jsx` — CreateModal + DetailModal

### สิ่งที่เปลี่ยน
- **CreateModal items section**:
  - เปลี่ยน label จาก "รายการสินค้า (ไม่บังคับ)" → "รายการสินค้า (ระบุรายการด่วนห้ามขาดส่ง)"
  - เพิ่ม `useQuery(['products-by-supplier', supplier_id])` ดึงสินค้าจาก `/master/products?supplier_id=X` (filter by junction table `product_suppliers`)
  - เปลี่ยน item row จาก free-text input → `<select>` dropdown เลือกสินค้าจาก Master List
  - เลือกสินค้าแล้ว auto-fill `item_name` จากชื่อสินค้า
  - เพิ่ม checkbox "ด่วน! ห้ามขาดส่ง" ต่อ item แสดงเป็นสีแดง
  - ปุ่ม "+ เพิ่มรายการ" disable ถ้ายังไม่ได้เลือก supplier
  - เปลี่ยน supplier → ล้าง items อัตโนมัติ (ป้องกัน product_id ข้าม supplier)
- **DetailModal items table**:
  - เปลี่ยน label หัวตาราง ให้ตรงกับ CreateModal
  - แถว `is_urgent = 1` แสดง bg-red-50 + badge "ด่วน! ห้ามขาดส่ง" สีแดง

## 2026-06-18 — Session 32: Delivery — Off-hours Confirmation + Notification

### แก้ไข
- **`client/src/pages/Delivery/index.jsx`**
  - `offHoursReason()` helper ตรวจ hour 07 / 18
  - `CreateModal`: ปุ่มบันทึกแผน → ถ้านอกเวลา แสดง confirmation card (ส้ม) ก่อน พร้อมคำอธิบายและปุ่ม "ยืนยัน — บันทึกและแจ้งเตือน" / "ย้อนกลับแก้ไขเวลา"
  - Label ปุ่มเปลี่ยนเป็น "บันทึกแผน (นอกเวลา)" เมื่อเวลาอยู่นอกช่วงทำงาน

- **`server/routes/delivery.js`**
  - POST `/` — ตรวจ `time_slot` hour 07/18 หลัง insert
  - ส่ง notification พิเศษ "แจ้งนัดส่งนอกเวลาทำงาน" ไปยัง qc_supervisor, qc_manager, purchasing ทุกคน
  - ส่ง Telegram ทั้ง 2 กลุ่ม (QC + Purchasing)

---

## 2026-06-18 — Session 31: ปฏิทินแผนส่งของ (Delivery Calendar) — สร้างใหม่ทั้งหมด

### ไฟล์ใหม่
- **`client/src/pages/Delivery/index.jsx`** — หน้า Delivery Calendar (client สมบูรณ์)

### ไฟล์แก้ไข
- **`client/src/App.jsx`** — เพิ่ม route `/delivery`
- **`client/src/utils/rolePermissions.js`** — เพิ่ม NAV_ITEMS `ปฏิทินส่งของ` (purchasing, qc_staff, qc_supervisor, qc_manager, admin)
- **`client/src/components/Layout/Sidebar.jsx`** — เพิ่ม icon `calendar`

### ฟีเจอร์
- **รายเดือน**: Calendar grid 7 คอลัมน์ แสดงชื่อ Supplier + เวลาในแต่ละวัน, คลิกวันเข้าดู daily view
- **รายวัน**: List เรียงตามเวลา, แสดงสถานะ, แนบไฟล์
- **Chip สีตามสถานะ**: pending=น้ำเงิน, acknowledged=teal, on_time=เขียว, late=แดง, cancelled=เทา, rescheduled=ส้ม, unplanned=เหลือง
- **CreateModal** (purchasing): Supplier dropdown, วันที่, เวลา, รายการสินค้า, แนบ Packing List
- **UnplannedModal** (qc_staff/supervisor): บันทึกส่งนอกแผน พร้อม notice คำอธิบาย
- **DetailModal**: ดูรายละเอียด, แก้ไข (เฉพาะ pending+ยังไม่ถึงเวลา), ปุ่มรับทราบ (QC), อัปเดตสถานะ (purchasing), แนบไฟล์/ลบไฟล์
- **Lock หลังเวลาส่ง**: ตรวจ `scheduled_date + time_slot < now()` ระดับนาที — ไม่สามารถแก้ไขได้
- **Summary badges**: แสดงจำนวนรายการแต่ละสถานะในเดือนนั้น

### Backend (มีอยู่แล้ว)
- `server/routes/delivery.js` — ครบทุก endpoint
- `server/db/schema.sql` — ตาราง delivery_schedules, _items, _attachments

---

## 2026-06-18 — Session 30: NCR — Notification ครบทุก Transition ทุก Role

### ปัญหา
`qc_supervisor` ไม่เคยได้รับแจ้งเตือนใน step ใดเลย, `qc_staff (created_by)` ขาดใน step กลาง

### matrix แจ้งเตือนที่แก้ไข — `server/routes/ncr.js`

| Transition | qc_staff | qc_supervisor | qc_manager | qmr | purchasing |
|---|---|---|---|---|---|
| → pending_manager | ✅ add | — | ✅ | — | — |
| → pending_qmr_open | ✅ add | ✅ add | — | ✅ | — |
| → pending_purchasing_review | ✅ | ✅ add | ✅ | — | ✅ |
| → pending_qmr_close | — | — | — | ✅ | — |
| → closed | ✅ | ✅ add | ✅ | — | ✅ |
| → ncp_closed | ✅ | ✅ add | ✅ add | — | — |

---

## 2026-06-18 — Session 29: NCR — เพิ่ม Notification ขั้นตอน QMR เปิด/ปิด

### ปัญหา
- QMR เปิด NCR (`pending_qmr_open → pending_purchasing_review`): แจ้งแค่ purchasing ไม่แจ้ง qc_manager, created_by, Telegram QC
- QMR ปิด NCR (`pending_qmr_close → closed`): แจ้งแค่ created_by และ Telegram QC ไม่แจ้ง qc_manager, purchasing, Telegram purchasing
- `pending_qmr_close` ไม่มี Telegram เลย

### แก้ไข — `server/routes/ncr.js`

**QMR เปิด** (`→ pending_purchasing_review`):
- เพิ่ม notify: `created_by`, `qc_manager` ทุกคน (รับทราบว่า QMR อนุมัติแล้ว)
- เพิ่ม Telegram QC group

**QMR ปิด** (`→ closed`):
- เพิ่ม notify: `qc_manager` ทุกคน, `purchasing` ทุกคน
- เพิ่ม Telegram purchasing group

**`pending_qmr_close`** (รอ QMR ปิด):
- เพิ่ม Telegram QC group แจ้งว่า QC Manager ตรวจสอบแล้ว รอ QMR

---

## 2026-06-18 — Session 28: Single-Session Enforcement — ป้องกัน Login ซ้อน

### ปัญหา
User เดียวกันสามารถ login พร้อมกันได้ 2 เครื่อง

### วิธีการ
ใช้ `session_token` (16-byte hex) เก็บใน `users` table — embed ใน JWT — ตรวจทุก request

### ไฟล์ที่แก้ไข
- **`server/db/database.js`**: `safeAddColumn('users', 'session_token', 'TEXT')` ใน `runMigrations()`
- **`server/routes/auth.js`**:
  - Login: `crypto.randomBytes(16)` → บันทึกใน DB → embed `sessionToken` ใน JWT payload (login ใหม่ทำให้ session เก่าจากอุปกรณ์อื่นหมดอายุทันที)
  - Logout: `UPDATE users SET session_token = NULL` → JWT decode แล้ว clear
- **`server/middleware/auth.js`**: หลัง verify JWT → query `SELECT session_token FROM users` → ถ้า mismatch → 401 "มีการเข้าสู่ระบบจากอุปกรณ์อื่น กรุณาเข้าสู่ระบบใหม่"
- **`client/src/utils/api.js`**: เก็บ error message ใน `sessionStorage` ก่อน redirect `/login`
- **`client/src/pages/Login.jsx`**: อ่าน `sessionStorage` แสดง notice สีเหลือง (warning) ก่อน login form

### พฤติกรรม
- Login เครื่อง 2 → เครื่อง 1 request ถัดไปได้ 401 + redirect `/login` พร้อม notice "มีการเข้าสู่ระบบจากอุปกรณ์อื่น"
- Logout ปกติ → clear `session_token` ใน DB → ป้องกัน JWT เก่า reuse ได้

---

## 2026-06-18 — Session 27: NCR Resubmit — ข้าม Review form ไป pending_supplier โดยตรง

### เปลี่ยนแปลง
**`server/routes/ncr.js`** — route `POST /:id/resubmit-to-supplier`
- เดิม: `pending_supplier_resubmit` → `pending_purchasing_review` (ต้องทำ Review + แปล EN อีกรอบ)
- ใหม่: `pending_supplier_resubmit` → `pending_supplier` โดยตรง ใช้ข้อมูลเดิมทั้งหมด
- ตั้ง `purchasing_received_at=datetime('now'), purchasing_received_by=?` ณ ตอน resubmit
- ส่ง notification + Telegram แจ้ง purchasing ว่าพร้อม copy link ได้เลย
- ไม่มีการแก้ไข client — `canCopyLink` ครอบคลุม `pending_supplier` อยู่แล้ว

### ผล
หลัง QC Manager ปฏิเสธคำตอบ → Purchasing กดปุ่ม "ส่ง Supplier ตอบใหม่" → Copy Link ขึ้นทันที ไม่ต้องผ่าน Review form อีกรอบ

---

## 2026-06-18 — Session 26: Real-time Update — แก้ปัญหา delay 15-20 วินาที (SSE + staleTime)

### ปัญหา
หลังจาก qc_staff หรือผู้ใช้คนอื่น action แล้ว ผู้ที่เปิดหน้าเดียวกันต้องรอ 15-20 วินาทีถึงจะเห็นข้อมูลใหม่

### สาเหตุ
1. `staleTime: 30000` ใน QueryClient ทำให้ React Query ถือว่าข้อมูล "ยังสด" อีก 30 วิ ไม่ re-fetch เมื่อ navigate กลับมา
2. ไม่มี SSE client listener — แม้ server มี `/api/sse` endpoint แต่ไม่มีโค้ด client ที่เปิด `EventSource` เลย
3. `pushSSE` ไม่ถูกเรียกใน `createNotification` ทำให้ SSE ไม่มี event ส่งไปหา client

### แก้ไข

**`client/src/main.jsx`**
- เปลี่ยน `staleTime: 30000` → `staleTime: 0`

**`server/routes/notifications.js`**
- เพิ่ม `if (db.pushSSE) db.pushSSE([userId], 'notification', { link })` หลัง INSERT notification

**`client/src/hooks/useSSE.js`** (ไฟล์ใหม่)
- Hook ที่เปิด `EventSource('/api/sse')` พร้อม credentials
- รับ SSE event → parse `link` → invalidate query keys ที่เกี่ยวข้อง (`bills`, `ncrs`, `uais`, `notifications`, `dashboard-stats`)
- Auto-reconnect หลัง 5 วินาทีถ้า connection ตก

**`client/src/components/Layout/AppLayout.jsx`**
- Mount `useSSE()` ใน AppLayout — ทำให้ทุก authenticated user ได้รับ real-time update ตลอดเวลาที่ login อยู่

### ผล
Update ทันทีเมื่อมี action ในระบบ — ไม่ต้องรอ polling 30 วิอีกต่อไป

---

## 2026-06-18 — Session 25: NCR — สถานะ `pending_uai` + ปิด NCR เมื่อ UAI สำเร็จครบ

### เปลี่ยน Flow NCR ↔ UAI ใหม่ทั้งหมด

**เดิม:**
- Purchasing ขอ UAI → NCR → `uai_pending_qc_manager`
- QC Manager อนุมัติ UAI review → NCR ปิดทันที (`closed`)

**ใหม่:**
- Purchasing ขอ UAI → NCR → `pending_uai` (รอดำเนินการ UAI)
- QC Manager อนุมัติ UAI review → NCR **ยังคง** `pending_uai`
- UAI ครบทุกขั้นตอน (`uai_completed`) → NCR → `closed` + stamp "ยอมรับใช้พิเศษ — อ้างอิงเลข UAI: xxx" + notify purchasing/qc_manager/qmr
- UAI ถูกปฏิเสธ (ทุกกรณี) → NCR กลับเป็น `pending_supplier`

### ไฟล์ที่แก้ไข

**`server/db/database.js`**
- เพิ่มฟังก์ชัน `migrateNcrAddPendingUai()` — recreate `ncrs` table ด้วย CHECK constraint ใหม่ที่รวม `'pending_uai'`
- เรียกใน init sequence หลัง `migrateNcrAddResubmit()`

**`server/routes/ncr.js`**
- `POST /:id/request-uai`: เปลี่ยน `UPDATE ncrs SET status='uai_pending_qc_manager'` → `'pending_uai'`

**`server/routes/uai.js`**
- `qc-manager-review` approve: ลบ NCR closing code ออก (NCR ไม่ปิดตอนนี้แล้ว)
- `qc-manager-review` reject: เพิ่ม `uai_close_remark=NULL` ตอนคืน NCR → `pending_supplier`
- `DELETE /:id` (purchasing self-delete): เพิ่ม `uai_close_remark=NULL` ตอนคืน NCR
- `sign` route `nextStatus === 'uai_completed'`: **เพิ่ม NCR closing** — UPDATE ncrs `status='closed'`, stamp `uai_close_remark`, auditLog NCR CLOSE, notify purchasing/qc_manager/qmr ทั้งสอง Telegram group

**`client/src/utils/rolePermissions.js`**
- เพิ่ม `pending_uai: { label: 'รอดำเนินการ UAI', color: 'bg-violet-100 text-violet-800' }`

**`client/src/pages/NCR/Detail.jsx`**
- `canCopyLink`: เพิ่ม `'pending_uai'` → purchasing ยังคัดลอก Link Supplier ได้ขณะ UAI ดำเนินอยู่

**`client/src/pages/NCR/index.jsx`**
- เพิ่ม filter option `<option value="pending_uai">รอดำเนินการ UAI</option>`

**`client/src/pages/Dashboard/index.jsx`**
- `ncrStages`: เปลี่ยน key `uai_pending_qc_manager` → `pending_uai`, label "รอดำเนินการ UAI"
- `openStatuses` (ManagerDash + QMRDash): เปลี่ยน `uai_pending_qc_manager` → `pending_uai`

**`server/routes/reports.js`**
- `openStatuses`: เปลี่ยน `uai_pending_qc_manager` → `pending_uai`

**`server/routes/exports.js`**
- เพิ่ม `pending_uai: 'รอดำเนินการ UAI'` ใน status label map

---

## 2026-06-18 — Session 24: UAI — C-Level ไม่อนุมัติ (ปิด UAI + คืน NCR → Supplier)

### ฟีเจอร์ใหม่: CCO/CMO/CPO กดไม่อนุมัติได้

**`server/routes/uai.js` — `POST /:id/reject-exec`** (มีอยู่แล้ว แต่ขาด NCR revert)
- เพิ่ม `UPDATE ncrs SET status='pending_supplier', uai_close_remark=NULL` → NCR กลับรอ Supplier
- เพิ่ม QMR ใน notify recipients (purchasing + qc_manager + qmr)
- เพิ่ม `auditLog('ncrs', ..., 'REOPEN', ...)` สำหรับ NCR reopen event
- ส่ง Telegram ทั้ง QC group และ Purchasing group พร้อมข้อความระบุชื่อ C-Level ที่ปฏิเสธ

**`client/src/pages/UAI/Detail.jsx`**
- เพิ่ม state: `rejectExecOpen`, `rejectExecReason`
- เพิ่ม `rejectExec` mutation (`POST /uai/:id/reject-exec`)
- เพิ่ม `canRejectExec = ['cco','cmo','cpo'].includes(user?.role) && isMyTurn`
- Header: แสดงปุ่ม "ไม่อนุมัติ" (danger) + "อนุมัติ (ลงนาม)" (success) คู่กันเมื่อถึงคิว C-Level
- เพิ่ม Reject Exec Modal: คำเตือน + textarea เหตุผล (required) + ปุ่มยืนยัน
- Signature grid: card ของ step ที่ปฏิเสธแสดงกรอบสีแดง + ป้าย "ไม่อนุมัติ" พร้อมชื่อและเหตุผล
- `isStepDone`: ไม่นับ step ว่า done เมื่อ `uai_rejected_by_exec` — ใช้ `sig`/`rejSig` แทน
- `ACTION_LABELS.rejected` → "ไม่อนุมัติ (C-Level)" ใน Timeline
- `STATUS_ORDER`: เพิ่ม `uai_rejected_by_exec` ใน array

**`client/src/utils/rolePermissions.js`**
- เพิ่ม `uai_rejected_by_exec: { label: 'UAI ไม่อนุมัติโดย C-Level', color: 'bg-red-100 text-red-800' }`

**`client/src/pages/UAI/index.jsx`**
- เพิ่ม filter option "ไม่อนุมัติ (C-Level)" → `uai_rejected_by_exec`

**`client/src/pages/Dashboard/index.jsx`**
- `pendingUAI` filter: เพิ่ม `uai_rejected_by_exec` ใน excluded statuses

---

## 2026-06-18 — Session 23: UAI Detail — รูปภาพประกอบจากผู้ผลิต

### เพิ่ม image upload/display ในหน้า UAI Detail สำหรับ Purchasing

**`client/src/pages/UAI/Detail.jsx`**
- เพิ่ม state `uploadingImg`
- เพิ่ม `handleUploadImages()`: POST multipart → `/uai/:id/images` → invalidate query
- เพิ่ม `deleteImage(imgId)`: DELETE → `/uai/:id/images/:imgId` → invalidate query
- Section "รูปภาพประกอบจากผู้ผลิต" (แสดงเฉพาะ read-only mode `!detailsForm`):
  - ปุ่ม "+ เพิ่มรูป" เห็นเฉพาะ `canEditDetails` (purchasing ขณะ UAI ยังไม่เกิน CPO)
  - Thumbnail grid 80×80px คลิกเปิดในแท็บใหม่ได้
  - ปุ่ม × ลบ (hover) เห็นเฉพาะ `canEditDetails`
  - ถ้าไม่มีรูป: แสดง "ยังไม่มีรูปภาพ"

*(Backend infrastructure — `POST/DELETE /api/uai/:id/images` + `uai_images` table + multer `uai` — implement ไปใน Session 22 แล้ว)*

---

## 2026-06-14 — Session 22: UAI Form — 4 ปรับปรุง

### 1. Purchasing ต้องกรอกข้อมูลก่อนลงนาม + แสดงชื่อผู้ขอ

**ไฟล์**: `client/src/pages/UAI/Detail.jsx`

- เพิ่ม `useEffect` ที่ auto-เปิด details form เมื่อ purchasing เปิด UAI และ `reason` ยังว่าง
  - trigger เมื่อ status เป็น `uai_pending_qc_manager` หรือ `uai_pending_purchasing`
- เพิ่ม `canEditDetails` ครอบคลุม `uai_pending_qc_manager` ด้วย (purchasing กรอกได้ตั้งแต่แรก)
- Block `canSign` ถ้า purchasing ยังไม่กรอก `reason` → แสดงข้อความแจ้งเตือนแทนปุ่มลงนาม
- เพิ่ม `uai.created_by_name` ที่ด้านล่างของ Details card (ผู้ขอยอมรับใช้)

**ไฟล์**: `server/routes/uai.js`

- GET /:id — เพิ่ม `LEFT JOIN users usr ON usr.id = u.created_by` ส่ง `created_by_name` กลับ

### 2. แสดงรูปภาพงานเสีย + ข้อมูลตรวจสอบในฟอร์ม UAI

**ไฟล์**: `server/routes/uai.js`

- GET /:id — อัปเดต ncr_items query: เพิ่ม JOIN `bill_items` (qty_passed, inspected_at) และ JOIN `users` (inspector_name)
- GET /:id — เพิ่ม loop ดึง `bill_item_images` ต่อ ncr_item

**ไฟล์**: `client/src/pages/UAI/Detail.jsx`

- เปลี่ยนตารางรายการสินค้าเป็น card layout แสดงต่อรายการ:
  - รับเข้า / ตรวจสอบ / ผ่าน / ไม่ผ่าน (4 badge)
  - ผู้ตรวจ (inspector_name)
  - รูปภาพงานเสีย (bill_item_images) — clickable thumbnail
- เพิ่ม section แสดง NCR images ใต้ items

### 3. Timeline การอนุมัติล่างสุดของฟอร์ม UAI

**ไฟล์**: `client/src/pages/UAI/Detail.jsx`

- เพิ่ม Section 4: Timeline card ต่อจาก Signatures
- แสดง `uai.signatures` เรียงตาม `signed_at`
- Action labels: review_approved / review_rejected / approved / acknowledged / rejected
- แสดงชื่อผู้ดำเนินการ, เหตุผล (comment), timestamp
- รูปลายเซ็น (ถ้ามี) แสดงทางขวา
- สีเส้น border-left: success (อนุมัติ/รับทราบ) / danger (ปฏิเสธ)

**ไฟล์**: `server/routes/uai.js`

- `POST /:id/qc-manager-review` — INSERT into `uai_signatures`:
  - อนุมัติ: `action='review_approved'`, signature_image='', comment
  - ปฏิเสธ: `action='review_rejected'`, signature_image='', comment
- เพิ่ม backward-compat: รับ `approved` field นอกจาก `decision`

### 4. ทุกระดับระบุเหตุผลได้ในการลงนาม — แสดงใน Timeline

**ไฟล์**: `client/src/pages/UAI/Detail.jsx`

- เพิ่ม `sigComment` state
- Sign Modal: เพิ่ม textarea "เหตุผล / ข้อเสนอแนะ (ไม่บังคับ)" ด้านบน SignatureCanvas
- `sign.mutate({ signature_image: dataURL, comment: sigComment })`
- Review Modal: เพิ่ม textarea สำหรับ comment ทั้ง กรณีอนุมัติ (ไม่บังคับ) และปฏิเสธ (บังคับ)
- Fix review mutation: ส่ง `decision: 'approve'/'reject'` แทน `approved: true/false` ให้ตรงกับ backend
- แสดง `sig.comment` ใน Signature card และ Timeline

---

## 2026-06-14 — Session 21: NCR — ย้าย Timeline การอนุมัติไปล่างสุด + แก้ PDF ขาด Supplier Attachments

### ปัญหา 1: Timeline การอนุมัติไม่อยู่ล่างสุด

ลำดับเดิมใน NCR Detail page และ PDF:
1. ข้อมูล NCR
2. รายการสินค้า
3. รูปภาพเพิ่มเติม
4. **Timeline การอนุมัติ** ← อยู่ก่อน "คำตอบ Supplier"
5. คำตอบ Supplier (conditional)

ลำดับที่ถูกต้อง (Timeline ล่างสุดเสมอ):
1. ข้อมูล NCR
2. รายการสินค้า
3. รูปภาพเพิ่มเติม
4. คำตอบ Supplier (conditional)
5. **Timeline การอนุมัติ** ← ล่างสุด

### ปัญหา 2: PDF NCR ขาดรูปภาพ/ไฟล์แนบที่ Supplier ส่งมาพร้อมคำตอบ

`supplier_response_attachments` table ไม่ถูก query และไม่แสดงใน PDF เลย

### การแก้ไข

**`client/src/pages/NCR/Detail.jsx`:**
- ย้าย card "คำตอบ Supplier" ขึ้นมาก่อน card "Timeline การอนุมัติ"

**`server/routes/exports.js` — `GET /ncr/:id/pdf`:**
- เพิ่ม query ดึง `supplier_response_attachments WHERE response_id = supplierResp.id`
- แปลงรูปเป็น base64 ด้วย `imgToBase64('ncr', att.file_path)`
- แสดงรูปในหัวข้อ "หลักฐานการแก้ไข (N ไฟล์)" ใต้ข้อมูล root_cause/corrective/preventive
- ปรับ layout section "คำตอบ Supplier" จาก `info-grid` 2 คอลัมน์ → block layout เพื่อให้ข้อความยาวอ่านง่าย
- ย้าย `${respHtml}` ขึ้นมาก่อน section "Timeline การอนุมัติ"

---

## 2026-06-13 — Session 19: NCR — แก้ 500 error เมื่อ Staff สร้าง NCR หลังบิลได้รับอนุมัติ

### สาเหตุ (3 จุด)
1. **Frontend ซ่อน server error**: `onError` ใน NCR/New.jsx ตรวจ `err.message` ก่อน (axios generic "Request failed with status code 500") ทำให้ `err.response?.data?.error` ไม่ถูกแสดงเลย → ไม่รู้ว่า error จริงคืออะไร
2. **Migration ใช้ PRAGMA ใน transaction (root cause)**: `PRAGMA table_info(ncrs_old)` ถูกเรียกข้างใน `db.transaction()` หลัง `ALTER TABLE ncrs RENAME TO ncrs_old` — SQLite/better-sqlite3 ไม่อัปเดต schema cache ในบาง version ทำให้ PRAGMA คืนค่าว่าง → `shared = ''` → `INSERT INTO ncrs () SELECT  FROM ncrs_old` → error "no such table: main.ncrs_old"
3. **Sequence อาจ out-of-sync**: หลัง migration recreate ตาราง, sequence counter อาจตามหลัง NCR codes จริง

### การแก้ไข
- `client/src/pages/NCR/New.jsx`: สลับลำดับ → `err.response?.data?.error || err.message` (แสดง server error จริงก่อน)
- `server/db/database.js` — `migrateNcrStatusConstraint()`: 
  - Query `PRAGMA table_info(ncrs)` **ก่อน** transaction เริ่ม (ขณะที่ ncrs ยังมีชื่อเดิม)
  - Hardcode list columns ของ new table (`newColList`)
  - ใน transaction ใช้ pre-fetched `shared` — ไม่มี PRAGMA ข้างใน transaction อีกแล้ว
  - เพิ่ม guard: `if (!shared) return` ป้องกัน data loss
- `server/db/database.js` — เพิ่ม `syncSequences()`: อ่าน MAX seq จาก ncrs/uai_documents และ UPDATE document_sequences ถ้า counter ต่ำกว่า → ป้องกัน UNIQUE collision

---

## 2026-06-13 — Session 18: NCR — แก้ CHECK constraint failed เมื่อ QMR อนุมัติเปิด

### สาเหตุ
สถานะ `pending_purchasing_review` ที่เพิ่มใน Session 16 ไม่ได้อยู่ใน CHECK constraint ของ `ncrs.status`  
SQLite enforce CHECK constraint → UPDATE ล้มเหลวทุกครั้งที่ QMR กดอนุมัติ

### การแก้ไข
- `server/db/schema.sql`: เพิ่ม `pending_purchasing_review` ใน CHECK constraint (สำหรับ fresh install)
- `server/db/database.js`: เพิ่มฟังก์ชัน `migrateNcrStatusConstraint()` — recreate table ด้วย:
  - `ALTER TABLE ncrs RENAME TO ncrs_old`
  - `CREATE TABLE ncrs` พร้อม constraint ใหม่
  - `INSERT INTO ncrs SELECT <shared columns> FROM ncrs_old` (explicit column names)
  - `DROP TABLE ncrs_old` + recreate indexes
  - ปิด/เปิด `PRAGMA foreign_keys` รอบ transaction (SQLite ไม่อนุญาต PRAGMA ใน transaction)
  - ตรวจก่อนว่า constraint เก่าอยู่ไหม — skip ถ้า up-to-date แล้ว

---

## 2026-06-13 — Session 17: Bills — แก้ "file too large" เมื่ออัปโหลดรูปภาพปัญหา

### สาเหตุ
รูปจากกล้องมือถือ (iPhone Pro JPEG) อาจใหญ่กว่า 10MB ซึ่งเกิน multer limit ของ `billItems`

### การแก้ไข
- `server/middleware/upload.js`: เพิ่ม limit `bills` และ `billItems` จาก 10MB → 30MB
- `server/index.js`: เพิ่ม body-parser limit จาก 20MB → 50MB
- `client/src/pages/Bills/New.jsx`: เพิ่มฟังก์ชัน `compressImage()` ใช้ canvas API
  - ย่อขนาดสูงสุด 2000×2000px, JPEG quality 85%
  - ข้ามไฟล์ที่เล็กกว่า 500KB
  - ใช้กับรูปถ่ายบิล (Step1) และรูปภาพปัญหาของ item (Step2)
  - compress ตอน stage → preview แสดงรูปที่ compress แล้วด้วย

---

## 2026-06-13 — Session 16: NCR — Purchasing Review + Supplier Bilingual Form

### Flow ใหม่
QMR อนุมัติ → `pending_purchasing_review` → Purchasing Review + แปล EN → `pending_supplier` → copy link ส่ง Supplier

### DB Migration (`server/db/database.js`)
- `ncr_items.item_name_en TEXT` — ชื่อสินค้าภาษาอังกฤษ
- `ncr_items.defect_detail_en TEXT` — รายละเอียดปัญหาภาษาอังกฤษ

### Status Label (`rolePermissions.js`)
- เพิ่ม `pending_purchasing_review`: "รอจัดซื้อ Review" (cyan badge)

### Server `ncr.js`
- Transition `pending_qmr_open` → เปลี่ยนจาก `pending_supplier` เป็น `pending_purchasing_review`
- Notification ใหม่: แจ้ง Purchasing เมื่อ QMR อนุมัติ
- Endpoint ใหม่: `PATCH /api/ncr/:id/purchasing-review`
  - บันทึก `item_name_en`, `defect_detail_en` ต่อ ncr_item
  - เปลี่ยน status → `pending_supplier` + ต่ออายุ `token_expires_at`
  - ส่ง Telegram + notification

### Server `supplier.js`
- GET `/ncr/:token`: เพิ่ม `bill_item_images` ต่อ item ใน response

### Frontend `NCR/Detail.jsx`
- ปุ่ม "Review + เพิ่มคำแปลภาษาอังกฤษ" เห็นเฉพาะ `purchasing` + `pending_purchasing_review`
- Modal แสดงแต่ละ item: ชื่อไทย (readonly) / EN input, ปัญหาไทย (readonly) / EN textarea
- Mutation `purchasingReview` → PATCH endpoint

### Frontend `Supplier/NCRResponse.jsx`
- Header bilingual: "NCR Supplier Response / ตอบกลับ NCR"
- แสดง NCR items ครบ: ชื่อ (EN/ไทย), qty received/sampled/failed, defect detail (EN/ไทย), รูปภาพปัญหาจาก bill_item_images
- Form labels bilingual ทุกฟิลด์
- Validation client-side ก่อน submit

---

## 2026-06-13 — Session 15: NCR — ปุ่ม Copy Link Supplier สำหรับ Purchasing

### เพิ่มฟีเจอร์ Copy Link
- `server/routes/ncr.js` GET `/:id`: เพิ่ม `ncr.supplier_link` = `app_url + /supplier/ncr/ + supplier_token` ใน response
- `client/src/pages/NCR/Detail.jsx`:
  - เพิ่ม state `copyToast`
  - เพิ่ม mutation `regenerateToken` (`POST /api/ncr/:id/regenerate-token`)
  - ฟังก์ชัน `handleCopyLink`: ตรวจ token หมดอายุ → ถ้าหมด regenerate ก่อน copy → ถ้าไม่หมด copy ทันที
  - ปุ่ม "คัดลอก Link Supplier" / "สร้าง Token ใหม่ + คัดลอก Link" — แสดงเฉพาะ `role === 'purchasing'` และ `status === 'pending_supplier'`
  - Toast ขึ้น 2 วินาทีหลัง copy สำเร็จ

---

## 2026-06-13 — Session 14: NCR — เปลี่ยนชื่อปุ่ม QMR

- `NCR/Detail.jsx`: เปลี่ยน `approveLabel` ของ `pending_qmr_open` จาก "อนุมัติเปิด (ส่ง Supplier)" → "อนุมัติเปิดเอกสาร NCR"

---

## 2026-06-13 — Session 13: NCR Timeline — แสดง Disposition + เปลี่ยนคำ

- `ApprovalTimeline` รับ prop `ncr` เพิ่ม — แสดง Disposition block ใต้ row แรกของ `qc_manager`
- แสดง: การจัดการ, หมายเหตุ, วันกำหนดดำเนินการ, วันตรวจสอบการแก้ไข
- เปลี่ยนคำ "วันตรวจสอบประสิทธิผล" → "วันตรวจสอบการแก้ไข" ทุกจุด (modal, error msg, server)

---

## 2026-06-13 — Session 12: NCR Detail — QC Manager Disposition Modal

### ปัญหา
QC Manager กด "อนุมัติเปิด NCR (ส่ง QMR)" แล้ว server แจ้ง "QC Manager ต้องเลือก disposition ก่อนอนุมัติ" แต่ modal ไม่มี field ให้เลือก

### การแก้ไข — `client/src/pages/NCR/Detail.jsx`

เพิ่ม state: `disposition`, `dispositionNote`, `dispositionDueDate`, `effectivenessCheckDate`, `approveError`

Modal approve เมื่อ `ncr.status === 'pending_manager'` แสดง fields เพิ่ม:
- **Disposition ***: dropdown `return | rework | uai | scrap | re_inspect`
- หมายเหตุ Disposition (optional)
- วันกำหนดดำเนินการ (optional)
- **วันตรวจสอบประสิทธิผล \*** (required)

Mutation ส่ง `disposition`, `disposition_note`, `disposition_due_date`, `effectiveness_check_date` ไปพร้อมกัน

Client-side validation: ตรวจ `disposition` และ `effectiveness_check_date` ก่อน submit

---

## 2026-06-13 — Session 11: Fix NCR/UAI PDF Export — รูปภาพปัญหาไม่แสดง + คอลัมน์เก่า

### ปัญหา
1. PDF Export NCR ไม่มีรูปภาพปัญหา — ดึงแค่ `ncr_images` (รูปแนบตอนออก NCR) ไม่ดึง `bill_item_images`
2. PDF ยังใช้คอลัมน์ที่ drop ไปแล้ว (`ncr.item_name`, `ncr.qty_failed`, `ncr.problem_description`) → undefined ใน PDF
3. UAI PDF มีปัญหาเดียวกัน

### การแก้ไข — `server/routes/exports.js`

**เพิ่ม helper `imgToBase64(folder, filePath)`** อ่านไฟล์จาก disk แปลงเป็น base64 data URL (ใช้ร่วมกันทั้ง NCR และ UAI)

**NCR PDF:**
- Query ดึง `ncr_items` + `defect_category_name` แทนคอลัมน์เก่า
- Loop ดึง `bill_item_images` ต่อ ncr_item ด้วย `bill_item_id`
- แต่ละ item แสดงเป็น card: ชื่อสินค้า, qty, กลุ่มปัญหา, รายละเอียด + รูปภาพปัญหา (base64)
- รูปเพิ่มเติม NCR (`ncr_images`) แสดงแยก section

**NCR Excel:**
- เพิ่ม sheet "รายการสินค้า" แทน row เดิมที่ใช้ `ncr.item_name`
- ลบ references ถึง `item_name`, `qty_failed`, `problem_description`

**UAI PDF:**
- Query ลบ `n.item_name`, `n.qty_failed`, `n.problem_description` จาก SELECT
- ดึง `ncr_items` + `bill_item_images` เช่นเดียวกับ NCR PDF
- แสดงรายการสินค้า + รูปปัญหาก่อน section ลายเซ็น

---

## 2026-06-13 — Session 10: NCR Detail — รูปภาพปัญหา + Invoice No. เปิด Modal รูปถ่ายบิล

### ปัญหา
1. NCR Detail ไม่แสดงรูปภาพปัญหาที่บันทึกตอนรับเข้า
2. Invoice No. แสดงเป็นข้อความธรรมดา ควรเปิด modal รูปถ่ายบิล (ตาม CLAUDE.md ข้อ 15)

### การแก้ไข

**`server/routes/ncr.js` — GET /:id:**
- เพิ่ม `bill_item_images[]` ให้แต่ละ item ใน `ncr.items`
- เพิ่ม `bill_images[]` ดึงรูปถ่ายบิลจาก `bill_images` table สำหรับแสดงใน modal

**`client/src/pages/NCR/Detail.jsx`:**
- Invoice No. เปลี่ยนจาก `<a href>` เป็น `<button>` เปิด modal รูปถ่ายบิล
- Modal แสดง `ncr.bill_images[]` เป็น gallery คลิกดูขนาดเต็มได้
- Items section เปลี่ยนจาก table เป็น cards แสดง bill_item_images ใต้แต่ละรายการ

---

### ปัญหา
1. ฟอร์ม NCR Detail ไม่แสดงรูปภาพปัญหาที่บันทึกตอนรับเข้า
2. Invoice No. แสดงเป็นข้อความธรรมดา คลิกไปดูบิลไม่ได้

### การแก้ไข

**`server/routes/ncr.js` — GET /:id:**
- หลัง fetch `ncr.items` เพิ่ม loop ดึง `bill_item_images` ต่อรายการ:
  ```javascript
  for (const item of ncr.items) {
    item.bill_item_images = item.bill_item_id
      ? db.prepare('SELECT * FROM bill_item_images WHERE bill_item_id = ?').all(item.bill_item_id)
      : [];
  }
  ```

**`client/src/pages/NCR/Detail.jsx`:**
- Invoice No. เปลี่ยนจาก plain text เป็น `<a href="/bills/:bill_id">` สี accent + underline
- เปลี่ยน items section จาก table เป็น cards เพื่อรองรับรูปภาพ
- แต่ละ card แสดง: ชื่อสินค้า, qty received/sampled/failed, กลุ่มปัญหา, รายละเอียด, รูปภาพจาก `bill_item_images`
- Section "รูปภาพเพิ่มเติม" แสดงเฉพาะเมื่อมี `ncr.images` (รูปที่แนบตอนออก NCR)

---

## 2026-06-13 — Session 9: Fix NCR Create 500 Error (ncrs table legacy columns)

### สาเหตุ

`ncrs` table ใน DB มีคอลัมน์เก่าจาก schema single-item:
- `item_name TEXT NOT NULL`
- `qty_failed INTEGER NOT NULL`
- `problem_description TEXT NOT NULL`

`CREATE TABLE IF NOT EXISTS` ไม่ recreate table ถ้ามีอยู่แล้ว → คอลัมน์เก่าค้างใน DB
INSERT ปัจจุบันไม่ส่งค่าให้ → `NOT NULL constraint failed: ncrs.item_name` → 500

### การแก้ไข

**`server/db/database.js`:**
1. เพิ่ม helper `safeDropColumn(table, column)` ที่ใช้ `ALTER TABLE DROP COLUMN` (SQLite 3.35+)
2. เพิ่ม migration ใน `runMigrations()`:
   ```javascript
   safeDropColumn('ncrs', 'item_name');
   safeDropColumn('ncrs', 'qty_failed');
   safeDropColumn('ncrs', 'problem_description');
   ```
3. แก้ `document_sequences` ที่ corrupt จากการทดสอบ (NCR: 7, UAI: 4)

Migration รันอัตโนมัติเมื่อ server restart (ทุกครั้ง)

---

## 2026-06-13 — Session 8: NCR Form — กรองเฉพาะรายการไม่ผ่าน + ใช้ข้อมูลจากบิล

### ปัญหา
- ฟอร์มออกเอกสาร NCR แสดงรายการทั้งหมดที่ยังไม่มี NCR รวมถึงรายการที่ผ่านการตรวจ
- เมื่อเลือกรายการต้องกรอกข้อมูลปัญหาซ้ำอีกครั้ง ทั้งที่บันทึกไว้แล้วตอนรับเข้า

### การแก้ไข — `client/src/pages/NCR/New.jsx`

| จุด | เดิม | ใหม่ |
|-----|------|------|
| Filter | `!i.in_ncr` | `!i.in_ncr && qty_failed > 0` |
| selectedItems | object พร้อม editable fields | `Set<id>` เท่านั้น |
| กรอกข้อมูลหลังเลือก | qty_sampled, qty_failed, defect_category, defect_detail | ไม่ต้องกรอก |
| แสดงข้อมูล | form inputs | read-only จาก bill item |
| รูปภาพปัญหา | upload ใหม่ | แสดงรูปจากบิล + รูปเพิ่มเติม optional |

- เมื่อติ๊กเลือก → แสดง section ด้านล่าง card แสดงข้อมูลแบบ read-only: กลุ่มปัญหา, รายละเอียด, รูปภาพปัญหา (thumbnail คลิกขยายได้)
- Submit ดึงข้อมูล qty/defect_category_id/defect_detail จาก bill items response โดยตรง
- มีช่อง "รูปภาพเพิ่มเติม" แยกต่างหากสำหรับภาพที่ถ่ายใหม่ตอนออก NCR

---

## 2026-06-13 — Session 7: Fix Inspection Document Preview in Item Row

### Bug: แนบเอกสารตรวจแล้วไม่มี Preview

**ไฟล์:** `client/src/pages/Bills/New.jsx` — `ItemRow` component (col-span-2 docs section)

**สาเหตุ:**
1. ปุ่มตรวจสอบแค่ `item.inspection_docs?.length > 0` (server data จาก edit mode) แต่ไม่เช็ค `item.docs_files` (File objects ที่เพิ่งเลือก) → ปุ่มยังแสดง "แนบเอกสารตรวจ" สีส้ม แม้จะเลือกไฟล์แล้ว
2. ไม่มีรายชื่อไฟล์แสดงให้เห็นหลังเลือก

**การแก้:**
- คำนวณ `newDocs = item.docs_files ?? []` และ `existingDocs = inspection_docs ที่เป็น object` แยกกัน
- ปุ่มเช็ค `totalCount = newDocs.length + existingDocs.length` → สีเขียวเมื่อมีอย่างน้อย 1 ไฟล์
- แสดงรายชื่อไฟล์ใหม่ (`docs_files`) เป็น icon + ชื่อไฟล์ สีเขียว
- แสดงไฟล์เดิม (`inspection_docs` จาก server, edit mode) เป็น anchor link คลิกเปิดได้
- เปลี่ยน layout จาก `flex items-center` เป็น `space-y-1` เพื่อแสดงรายการแนวตั้งได้

---

## 2026-06-13 — Session 6: Fix Bills Form — Image Preview, Defect Validation, Edit Mode

### Bug 1: ไม่มี Preview รูปภาพหลังเลือกไฟล์

**ไฟล์:** `client/src/pages/Bills/New.jsx`

**สาเหตุ:** Step 1 แสดงแค่ข้อความ "เลือก N ไฟล์" ไม่มี thumbnail

**การแก้:**
- Step 1 (รูปถ่ายบิล): แสดง thumbnail 80×80px ทันทีด้วย `URL.createObjectURL()` + ชื่อไฟล์ + ปุ่ม x ลบทีละรูป (hover เพื่อเห็น)
- Step 2 (รูปภาพปัญหาต่อรายการ): แสดง thumbnail 56×56px สำหรับไฟล์ที่เลือกใหม่ + แสดงรูปที่อัปโหลดแล้วในกรณี edit mode

---

### Bug 2: เลือกกลุ่มปัญหาแล้วแต่บันทึกไม่ได้ (error "ยังไม่เลือกกลุ่มปัญหา")

**ไฟล์:** `client/src/pages/Bills/New.jsx`

**สาเหตุ:** `handleSave` ส่ง `item` object ทั้งก้อนรวมถึง `images_files: [File, File]` ไปใน JSON body → `JSON.stringify(File)` คืน `{}` → request body เสียหาย → `defect_category_id` อาจไม่ถูกส่งถูกต้อง นอกจากนี้ไม่มี client-side validation ทำให้ error ออกมาจาก server

**การแก้:**
- เพิ่ม **client-side validation** ก่อน API call: ตรวจ `defect_category_id`, `defect_detail`, รูปภาพ ก่อน hit server
- **Strip File objects** ก่อนส่ง POST: `const { images_files, docs_files, images, inspection_docs, _id, ...itemData } = item` ส่งแค่ `itemData`
- Upload รูปภาพแยกหลังสร้าง item แล้วเท่านั้น

---

### Bug 3: กดปุ่ม Edit บิลแล้วต้องกรอกข้อมูลใหม่ทั้งหมด

**ไฟล์:** `client/src/pages/Bills/New.jsx`

**สาเหตุ:** `BillNew` component ไม่ได้อ่าน query param `?edit=:id` เลย ไม่มี logic โหลดข้อมูลเดิมใส่ฟอร์ม

**การแก้:**

| ส่วน | สิ่งที่เพิ่ม |
|------|------------|
| `BillNew` | อ่าน `?edit=:id` → set `billId` ทันที → `useQuery` โหลดบิลเดิม + รายการสินค้า |
| Step 1 | `useEffect` ดัก `existingBill` → pre-fill form ทุก field (invoice_no, po_no, supplier_id, received_date ฯลฯ) + แสดงรูปเดิม |
| Step 1 คลิก "ถัดไป" | มี `billId` แล้ว → ส่ง `PATCH /bills/:id` แทน `POST` |
| Step 2 | รับ `initialItems` prop → `useEffect` แปลงเป็น items state รวมถึง `_id`, `defect_category_id`, `images` เดิม |
| Step 2 บันทึก | items มี `_id` → `PATCH /bills/:id/items/:itemId` / items ใหม่ → `POST` |
| ชื่อหน้า | แสดง "แก้ไขบิล" แทน "สร้างบิลใหม่" เมื่อ edit mode |

---

## 2026-06-13 — Session 5: Fix Blank Page After Login (API Format Mismatch)

### สาเหตุ

Backend API ทุก list endpoint เปลี่ยนจาก plain array เป็น `{ data, total, page, limit }` แต่ frontend ยังใช้ pattern เก่าที่ treat response เป็น array โดยตรง → `.filter()`, `.map()`, `.length` crash → React blank white page

### ไฟล์ที่แก้ไข

| ไฟล์ | ปัญหา | การแก้ |
|------|-------|--------|
| `client/src/pages/Bills/index.jsx` | `data: bills = []` ได้ `{data,total}` → filter crash | extract `.data`, ส่ง `q` param ไปกับ query |
| `client/src/pages/NCR/index.jsx` | paginated response + `n.item_name` ไม่มีใน ncrs table | extract `.data`, ค้นหาผ่าน `n.items[].item_name` แทน |
| `client/src/pages/UAI/index.jsx` | paginated response + `u.item_name` ไม่มี | extract `.data`, ลบคอลัมน์ item_name |
| `client/src/pages/NCR/Detail.jsx` | `ncr.item_name`, `ncr.qty_failed`, `ncr.problem_description` ไม่มีใน ncrs | แสดง `ncr.items[]` เป็น table แทน |
| `client/src/pages/UAI/Detail.jsx` | เหมือน NCR แต่ `uai.ncr_items[]` | แสดง `uai.ncr_items[]` เป็น table |
| `client/src/pages/Reports/NCRReport.jsx` | `n.item_name` ไม่มี | แสดง `item_count` แทน |
| `client/src/pages/Reports/UAIReport.jsx` | `u.item_name` ไม่มี | ลบคอลัมน์นั้น |
| `server/routes/reports.js` | NCR query JOIN `n.bill_item_id` ที่ถูกลบไปแล้ว + UAI query มี `n.item_name` | JOIN ผ่าน `ncr_items` table แทน |
| `client/src/pages/NCR/New.jsx` | เขียนแบบ single-item เก่า + ส่ง `bill_item_id` เดียว | Rewrite ใหม่ให้เลือก multi-item จาก bill ที่เลือก พร้อม checkbox + per-item inputs |
| `client/src/pages/Bills/Detail.jsx` | `item.item_name` (field เก่า) + NCR button link ผิด | ใช้ `item.product_name`, แก้ link เป็น `/ncr/new?bill_id=` |

### Verified
- `node --check` ผ่านทั้ง reports.js, ncr.js, bills.js
- `npx vite build` ผ่าน ไม่มี compilation error

---

## 2026-06-13 — Session 4: Implement ISO Compliance Features & Master Data Expansion

### สิ่งที่ implement ใหม่ทั้งหมด

---

#### `server/db/schema.sql` — Schema ครบ ISO 9001

เพิ่มตารางใหม่ที่ขาดไปจาก PRD:

| ตาราง | วัตถุประสงค์ |
|-------|------------|
| `colors` | สีสินค้า |
| `models` | รุ่นสินค้า |
| `aql_tables` | ตาราง AQL sampling plan |
| `product_colors` | mapping สินค้า–สี |
| `product_images` | รูปภาพสินค้า |
| `product_drawings` | Drawing revision control (is_current=1 per product) |
| `bill_item_certificates` | CoC/Mill cert/Test report |
| `bill_item_equipment` | เครื่องมือวัดที่ใช้ตรวจ |
| `measuring_equipment` | เครื่องมือวัด + calibration tracking |
| `supplier_approval_history` | ประวัติ ASL status change |
| `supplier_evaluations` | ผลประเมิน Supplier รายไตรมาส |
| `supplier_risks` | Risk Register |
| `ncr_items` | multi-item NCR (1 NCR หลาย bill_item) |
| `re_inspections` + `re_inspection_images` | บันทึกผล re-inspection รายรอบ |
| `document_sequences` | Atomic sequence สำหรับ NCR/UAI code |
| `audit_logs` | Audit trail ทุก operation |
| `settings` | Config table (Telegram, APP_URL ฯลฯ) |
| `password_reset_logs` | Log การ reset password |

เพิ่ม columns ใน existing tables: `bills` (cancelled_at/by), `ncrs` (disposition, effectiveness, token_expires_at), `bill_items` (lot_number, batch_number, expiry_date, manufacturing_date, drawing_revision_id), `suppliers` (approval_status, next_evaluation_date), `product_groups` (require_lot_number, require_expiry_date, require_certificate)

---

#### `server/db/database.js` — Helpers และ Migrations

- `safeAddColumn()` — idempotent `ALTER TABLE ADD COLUMN` ป้องกัน crash เมื่อ column มีอยู่แล้ว
- `runMigrations()` — migrate existing DB โดยไม่ต้อง recreate
- `db.nextNCRCode()` / `db.nextUAICode()` — Atomic sequence ผ่าน `UPDATE ... RETURNING` ใน transaction (แก้ race condition จาก `SELECT MAX()` เดิม)
- `db.generateSecureToken()` — `crypto.randomBytes(32).toString('hex')` แทน uuid
- `db.auditLog()` — helper ฝัง audit ใน transaction เดียวกับ operation หลัก
- `db.getSetting()` / `db.setSetting()` — อ่าน/เขียน settings table
- `db.pushSSE()` — inject จาก index.js สำหรับ real-time push

---

#### `server/routes/master.js` — Master Data ครบ

เพิ่มใหม่:
- **Colors** — GET/POST/PATCH/toggle
- **Models** — GET/POST/PATCH/toggle
- **AQL Tables** — GET/POST/PATCH/toggle + `GET /aql/lookup?qty=&product_id=` (auto-calculate sample size จาก inspection level + batch size)
- **Measuring Equipment** — GET/POST/PATCH + `GET /equipment/overdue` + `POST /:id/calibrate`
- **Supplier Approval Status (ASL)** — `PATCH /suppliers/:id/approval-status` + `GET /suppliers/:id/approval-history` (บันทึก history ทุก status change)
- **Supplier Evaluations** — GET/POST per supplier, auto-grade A(≥90)/B(75-89)/C(60-74)/D(<60)
- **Supplier Risks** — GET/POST/PATCH พร้อม risk_score = likelihood × impact
- **Product Images** — POST/GET/DELETE
- **Product Drawings (Revision Control)** — `POST /products/:id/drawings` auto-obsolete revision เก่าใน transaction เดียว

---

#### `server/routes/ncr.js` — เขียนใหม่ทั้งหมด

**Multi-item NCR:**
```javascript
// items เป็น JSON array ของ bill_items ที่ไม่ผ่าน
// ตรวจสอบก่อนว่า bill_item ไม่ได้อยู่ใน NCR อื่นแล้ว
// Insert ทุก item ใน ncr_items table ใน transaction เดียว
```

**Race-condition safe code generation:**
- แทน `generateNCRCode()` ด้วย `db.nextNCRCode()` (atomic UPDATE ... RETURNING)

**Supplier token:**
- แทน `uuidv4()` ด้วย `db.generateSecureToken()` + `token_expires_at` (90 วัน)
- `POST /:id/regenerate-token` — Purchasing reset token เมื่อหมดอายุ

**Disposition (ISO):**
- QC Manager ต้องเลือก disposition + effectiveness_check_date ก่อน approve `pending_manager`
- `PATCH /:id/disposition` — endpoint แยกสำหรับ set disposition

**Effectiveness Check (ISO):**
- `POST /:id/effectiveness` — บันทึกผล effective/not_effective หลัง NCR closed

**Re-inspection:**
- `POST /:id/re-inspect` — round auto-increment
- แจ้ง QMR พิเศษถ้า round > 3
- ถ้า result=passed → auto เปลี่ยน status → `pending_manager_review`

**Self-delete:**
- qc_staff เจ้าของลบได้เฉพาะ `pending_supervisor`

---

#### `server/routes/bills.js` — ISO Compliance Fields

- `POST /api/bills/:id/items` รองรับ: `lot_number`, `batch_number`, `manufacturing_date`, `expiry_date`, `country_of_origin`, `drawing_revision_id`
- **Expiry validation**: client-side warning, server hard-block เมื่อ submit ถ้า expiry < received_date
- **Certificate upload**: `POST /:id/items/:itemId/certificates` (cert_type: coc/mill_cert/test_report/other)
- **Equipment tracking**: `POST /:id/items/:itemId/equipment` พร้อม calibration overdue warning
- **Supplier suspension check**: block bill ถ้า supplier เป็น suspended/blacklisted
- **Self-delete**: qc_staff ลบได้ถ้าไม่มี NCR ผูก (draft/pending_approval)
- **Pagination**: response `{ data, total, page, limit }` ตาม standard
- Wrap submit/approve ด้วย transaction + optimistic lock

---

#### `server/routes/uai.js` — เขียนใหม่

- ใช้ `db.getSetting()` แทน `process.env.*` ทั้งหมด
- Optimistic lock ใน `POST /:id/sign`
- รองรับ `comment` field ใน UAI signatures
- `POST /:id/reject-exec` — CCO/CMO/CPO ปฏิเสธ (บังคับกรอก reason)
- GET /:id รองรับ `ncr_items` table (multi-item NCR)
- `DELETE /:id` — Purchasing self-delete ได้ถ้ายัง pending_qc_manager/pending_purchasing

---

#### `server/routes/supplier.js` — Token Expiry Check

- ตรวจ `token_expires_at` ทั้ง GET และ POST respond
- ส่ง 403 พร้อมข้อความไทยถ้าลิ้งค์หมดอายุ
- Wrap respond ใน transaction

#### `server/routes/notifications.js` — Settings-based Telegram

- `sendTelegram()` ใช้ `db.getSetting('telegram_bot_token')` แทน env var
- Sort: `ORDER BY is_read ASC, created_at DESC` ตาม spec
- Response: `{ data, unread }` แทน plain array

---

#### `server/index.js` — SSE + Admin Routes

- SSE endpoint `GET /api/sse` — Map userId → res, heartbeat 30s
- `db.pushSSE(userIds, eventType, data)` — push real-time ไปทุก client ที่เกี่ยวข้อง
- Admin Settings: GET/POST `/api/admin/settings/telegram` + test endpoint
- Admin Users: CRUD + reset-password + toggle active
- `GET /api/csrf-token`

---

#### `server/routes/delivery.js` — Delivery Schedule

- `POST /api/delivery` — Purchasing สร้างแผน + notify QC via SSE + Telegram กลุ่ม QC
- `POST /api/delivery/unplanned` — QC Staff บันทึกนอกแผน + notify Purchasing
- `POST /:id/acknowledge` — QC รับทราบ
- `PATCH /:id/status` — update on_time/late/cancelled/rescheduled (ต้องกรอก reason ถ้าไม่ใช่ on_time)
- Attachment upload/delete

---

#### `server/scripts/clear-db.js` — คำสั่ง Clear Database

```bash
npm run clear-db          # เคลียร์ข้อมูลทั้งหมด (มี prompt ยืนยัน)
npm run clear-db:force    # เคลียร์ทันทีไม่ถาม (ใช้ใน CI/test)
```

- ลบข้อมูลทุก table ตาม FK order (child → parent)
- Reset sqlite_sequence
- Re-seed: document_sequences, settings defaults, 10 default users (password: admin1234)

---

*อัปเดตล่าสุด: 2026-06-13*

---

## 2026-06-12 — Session 3: แก้ไข Login page refresh loop

### การแก้ไข

#### `client/src/utils/api.js` — Axios interceptor วนซ้ำ

**ปัญหา:**
Axios interceptor จับ 401 ทุกตัวแล้วทำ `window.location.href = '/login'` (full page reload)
ทำให้เกิด infinite loop:
1. โหลดที่ `/` → เรียก `GET /auth/me` → ได้ 401 → interceptor redirect ไป `/login` (reload)
2. โหลดที่ `/login` → เรียก `GET /auth/me` อีก → 401 → redirect ซ้ำ → วนไม่หยุด

**การแก้ไข:**
ยกเว้น `/auth/me` จาก redirect เพราะ 401 จากเส้นนี้เป็นเรื่องปกติ (ยังไม่ได้ login) — `AuthContext` จัดการ redirect ผ่าน `<Navigate>` เองอยู่แล้ว

```javascript
// ก่อน
if (err.response?.status === 401) {
  window.location.href = '/login';
}

// หลัง
if (err.response?.status === 401 && !err.config?.url?.includes('/auth/me')) {
  window.location.href = '/login';
}
```

Interceptor ยังทำงานปกติสำหรับ API อื่นๆ ที่ได้ 401 (session หมดอายุขณะใช้งาน)

---

## 2026-06-12 — Session 2: ทดสอบ TESTCASES.md และแก้ไขข้อบกพร่อง

### สรุปผลการทดสอบ

| ชุดทดสอบ | ผ่าน | ไม่ผ่าน | ไฟล์ |
|-----------|------|---------|------|
| AUTH + SEC + Master + Bill | 36/36 | 0 | `test_api.py` |
| NCR + UAI + Reports + Notifications | 51/51 | 0 | `test_ncr_uai.py` |
| **รวม** | **87/87** | **0** | — |

---

### การแก้ไขที่ทำในวันนี้

#### 1. `server/routes/ncr.js` — NCR creation รับ JSON และ auto-derive จาก bill_item_id

**ปัญหา:**
- Route ใช้ `multer` middleware แต่ต้องการ field `po_no`, `invoice_no`, `item_name`, `qty_failed`, `problem_description` ที่ต้อง explicit ส่งมา
- Test ส่งแค่ `bill_id`, `bill_item_id`, `severity`, `description` — ไม่ส่ง field ที่เหลือ
- ชื่อ field `description` ≠ `problem_description`

**การแก้ไข:**
- เพิ่ม alias: `description` → `problem_description`
- เพิ่ม auto-derive: เมื่อมี `bill_item_id` ระบบ lookup จาก DB เพื่อดึง `po_no`, `invoice_no`, `item_name`, `qty_failed` อัตโนมัติ
- Validation เหลือเพียง `problem_description` + `severity` เท่านั้น
- คง multer ไว้เพื่อรองรับ multipart upload จาก frontend

```javascript
// Accept 'description' as alias for 'problem_description'
if (!problem_description && description) problem_description = description;

// Auto-derive fields from bill_item_id when not explicitly provided
if (bill_item_id && (!po_no || !invoice_no || !item_name || !qty_failed)) {
  const bi = db.prepare(`
    SELECT bi.item_name, bi.qty_failed, b.po_no, b.invoice_no, b.id as bill_id
    FROM bill_items bi JOIN bills b ON b.id = bi.bill_id WHERE bi.id = ?
  `).get(bill_item_id);
  if (bi) { /* fill missing fields */ }
}
```

---

#### 2. `server/routes/uai.js` — QC Manager review ใช้ `decision` field

**ปัญหา:**
- Route ตรวจสอบ `req.body.approved` (boolean) แต่ test ส่ง `decision: "approve"` / `decision: "reject"`
- เมื่อ `approved` เป็น `undefined` → ทุก request ถูก reject เสมอ → UAI-011 fail

**การแก้ไข:**
- เพลี่ยน `const { approved, reason }` → `const { decision, approved, comment, reason }`
- ตรวจสอบ `decision === 'approve' || approved === true` เพื่อ backward-compat กับ frontend

```javascript
const isApproved = decision === 'approve' || approved === true || approved === 'true';
```

---

#### 3. `server/routes/uai.js` — UAI details update คืน `{ok: true}`

**ปัญหา:**
- `PATCH /uai/:id/details` คืน full UAI document แต่ test ตรวจ `r.get("ok") == True`

**การแก้ไข:**
```javascript
// เปลี่ยนจาก
res.json(db.prepare('SELECT * FROM uai_documents WHERE id = ?').get(req.params.id));
// เป็น
res.json({ ok: true });
```

---

#### 4. Chromium สำหรับ PDF export

**ปัญหา:**
- `html-pdf-node` ต้องการ Chromium browser แต่ `chrome-win.zip` ถูก download แล้วแต่ยังไม่ได้ extract
- Error: `Could not find expected browser (chrome) locally`

**การแก้ไข:**
- Extract `chrome-win.zip` → `node_modules/puppeteer/.local-chromium/win64-901912/chrome-win/`
- ใช้ Python `zipfile` module เพื่อ extract (ไม่ต้อง install เพิ่ม)

---

### การแก้ไขจาก Session ก่อนหน้า (ก่อนสรุป)

#### `server/routes/ncr.js` — SEC-002: role check ก่อน DB lookup
- เพิ่ม `requireRole(APPROVE_ROLES)` ก่อน handler ใน POST `/:id/approve`
- เพื่อให้ return 403 แทน 404 เมื่อ role ไม่ถูกต้อง

#### `server/routes/bills.js` — Bill submit/approve response format
- เพิ่ม `status` ใน response body ทั้ง submit (`pending_approval`) และ approve (`approved`)
- ช่วยให้ test และ frontend รู้ผลโดยไม่ต้อง GET ซ้ำ

#### `server/routes/exports.js` — Report Excel export routes
- เพิ่ม 4 routes: `/reports/receiving/excel`, `/reports/ncr/excel`, `/reports/uai/excel`, `/reports/summary/excel`
- แต่ละ route ใช้ ExcelJS สร้าง .xlsx พร้อม header สี `#1A3A5C` ตัวอักษรขาว

#### `client/src/pages/Master/ProductGroups.jsx` + `Products.jsx` — duplicate key warning
- แก้ไข spread object ที่มี duplicate keys ใน `useState` initial value

#### better-sqlite3 native build สำหรับ Node.js v24
- `npm install better-sqlite3@latest` เพื่อรับ pre-built binary ที่รองรับ Node 24

---

## 2026-06-12 — Session 1: สร้างระบบ IQC ครั้งแรก

ระบบถูกสร้างทั้งหมดจาก PRD.md ตาม tech stack:
- **Backend**: Express.js + SQLite (better-sqlite3) + JWT httpOnly cookie
- **Frontend**: React (Vite) + Tailwind CSS
- **โครงสร้าง**: `iqc-system/client/` + `iqc-system/server/`

### สิ่งที่สร้าง (ครบทั้งระบบ)
- Database schema + seed data (admin + 10 test users ครบทุก role)
- Auth routes (login/logout/me) + JWT middleware
- Master List: Suppliers, Product Groups, Products, Units, Defect Categories
- Bill workflow: สร้างบิล → บันทึกรายการ → upload รูป → submit → approve
- NCR workflow: สร้าง NCR → approval 5 ขั้น → Supplier response → close
- UAI workflow: request → QC Manager review → signing 7 ขั้น → export
- Supplier public page (ไม่ต้อง login ด้วย token)
- Notification system (in-app polling + Telegram bot)
- Reports: receiving, NCR, UAI, summary + export Excel/PDF
- Frontend pages ครบทุก role พร้อม responsive design
- Bottom Navigation bar สำหรับ mobile

---

*อัปเดตล่าสุด: 2026-06-12*
