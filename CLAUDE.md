# CLAUDE.md — กฎเหล็กสำหรับ IQC System

**Updated:** 2026-07-08

> 📌 **อ่านคู่กัน:** [`AUDIT.md`](AUDIT.md) (ผลวิเคราะห์ + refactor roadmap), [`PRD.md`](PRD.md) (requirement),
> [`brand.md`](brand.md) (design system), [`design-dashboard.md`](design-dashboard.md) (dashboard spec),
> [`testcase.md`](testcase.md) (test plan), [`iqc-system/DEVLOG.md`](iqc-system/DEVLOG.md) (ประวัติพัฒนา)
>
> **ขอบเขตจริงของระบบ ณ ปัจจุบัน:** Backend มี **102 ตาราง** (+`environment_presets`, S118) + ~32 route files, Frontend **51 หน้า / 11 roles**
> ครอบคลุมเกินกฎเดิม — โมดูลเพิ่มเติม (IPQC rounds/schedules, FGQC, FG defect→FNCP→FUAI, KPI, Attendance,
> Issue Talk, Holidays) ดู §22. **Known deviation ระหว่างเอกสารกับโค้ด** ดู §23. **Authentication Provider
> Framework (Local + Active Directory)** ดู §24

---

## 1. Tech Stack

| ส่วน | เทคโนโลยี | Version |
|-----|-----------|---------|
| Frontend | React + Vite | 18.2 / 5.1 |
| Styling | Tailwind CSS | 3.4 |
| Backend | Express.js (Node.js) | 4.18 |
| Database | SQLite via better-sqlite3 | 12.10 |
| Auth | JWT (httpOnly cookie) | 9.0 |
| File Storage | Local `/uploads` folder | — |
| Server State | React Query (@tanstack) | 5.24 |
| Local State | useState / useRef / useEffect | — |
| Charts | recharts | 2.12 |
| Signature | react-signature-canvas | 1.0 |
| Notification | Telegram Bot API (server-side) | — |
| Export PDF | html-pdf-node | 1.0 |
| Export Excel | exceljs | 4.4 |
| Real-time | SSE (Server-Sent Events) — built-in |
| File Upload | multer | 1.4 |

---

## 2. กฎ SQLite — อ่านก่อนสร้าง database.js

### 2.1 Database Initialization (บังคับทุกข้อ)

```javascript
// server/db/database.js
const Database = require('better-sqlite3')
const db = new Database('./db/data/iqc.db')

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

const fkCheck = db.pragma('foreign_keys', { simple: true })
if (fkCheck !== 1) throw new Error('Foreign keys pragma failed to enable')

module.exports = db
```

**Init sequence บังคับ (ลำดับสำคัญ):**
```javascript
initSchema()
runMigrations()
migrateNcrStatusConstraint()
migrateNcrAddNcp()
migrateNcrAddResubmit()
seedData()
syncSequences()
```

### 2.2 Transaction — บังคับทุก operation ที่มีหลาย step

```javascript
// ✅ ถูก
const saveBill = db.transaction((billData, items) => {
  const bill = insertBill.run(billData)
  for (const item of items) insertBillItem.run(bill.lastInsertRowid, item)
  auditLog('bills', bill.lastInsertRowid, 'CREATE', null, billData, userId, ip)
  return bill
})

// ❌ ผิด — insert หลายครั้งใน route handler โดยไม่ห่อ transaction
```

**Operations ที่บังคับใช้ Transaction:**

| Operation | ขั้นตอนที่ต้องห่อรวม |
|-----------|-------------------|
| Save Bill | bill + images + items + item images + docs + notifications + audit |
| Create NCR | NCR + items + images + update bill_item + notifications + audit |
| Approve (ทุกขั้น) | update status (optimistic lock) + approval record + notifications + audit |
| Create UAI | uai + update NCR status + notifications + audit |
| Sign UAI | uai_signature + update UAI status + notifications + audit |
| Supplier Response | response + attachments + update NCR status + notifications + audit |
| Reject Response | update status + ncr_approvals + notifications + audit |
| Resubmit to Supplier | supersede old response + update status + extend token + audit |

- ❌ ห้ามสร้าง transaction แบบ async — `better-sqlite3` synchronous เท่านั้น
- ✅ **สภาพจริง (Session 90):** business transaction ของ **flow NCR→UAI ทั้ง happy-path** สกัดไป
  `services/ncrService.js` (createNcr/approveNcr/requestUai/purchasingReview) + `services/uaiService.js` (reviewUai/signUai)
  + `services/supplierService.js` (submitSupplierResponse) แล้ว
  (`transactions.js` ตามเจตนา CLAUDE.md เดิม realized เป็น **domain service ต่อโมดูล** ซึ่ง maintainable กว่าไฟล์เดียว)
- ✅ Bills (S91) · Delivery (S92) · NCR/UAI (S93) · KPI ครบทั้งหมด (S94-95, S101-102) · **FG FNCP ครบ/FUAI/IPNCR (S96-99)** — 9 service, 161 tests
- 🏁 **Service-layer extraction ปิดครบแล้ว (S88–102)** — ไม่มี business transaction/CRUD หลักเหลือ inline ใน route handler
  → โค้ดใหม่ให้อยู่ใน `services/<domain>Service.js` เสมอ (pattern: controller validate → service ทำ transaction → return);
  service throw `error.status` เพื่อ map HTTP; ต้องมี integration test ครอบก่อนแก้ของเดิม (ดู `test/ncrUai.test.js`)

### 2.3 Sequence Generation — Race Condition Safe

❌ ห้ามใช้ `SELECT MAX()` หรือ `SELECT COUNT()` generate รหัสเด็ดขาด

```javascript
const nextSequence = db.transaction((docType) => {
  const year = new Date().getFullYear()
  db.prepare(`UPDATE document_sequences SET last_seq=0, year=? WHERE doc_type=? AND year!=?`)
    .run(year, docType, year)
  const r = db.prepare(`UPDATE document_sequences SET last_seq=last_seq+1
    WHERE doc_type=? AND year=? RETURNING last_seq, year`).get(docType, year)
  return `${docType}-${r.year}-${String(r.last_seq).padStart(4,'0')}`
})
```

### 2.4 Optimistic Lock — ป้องกัน Double Approve

```javascript
const result = db.prepare(`UPDATE bills SET status=? WHERE id=? AND status=?`)
  .run(newStatus, id, expectedStatus)
if (result.changes === 0) throw new Error('เอกสารถูกดำเนินการแล้ว กรุณารีเฟรชหน้า')
```

ใช้กับ **ทุก** status transition: Bill, NCR ทุกขั้น, UAI ทุกขั้น

### 2.5 Foreign Keys + ON DELETE RESTRICT

```sql
supplier_id INTEGER REFERENCES suppliers(id) ON DELETE RESTRICT,
```

- ❌ ห้าม DELETE Master data ที่มี FK ชี้อยู่ — Soft delete (`is_active=0`) เสมอ

### 2.6 Index — บังคับครบทุกตัว

```sql
CREATE INDEX idx_bills_supplier   ON bills(supplier_id);
CREATE INDEX idx_bills_date       ON bills(received_date);
CREATE INDEX idx_bills_status     ON bills(status);
CREATE INDEX idx_bills_created_by ON bills(created_by);
CREATE INDEX idx_bill_items_bill    ON bill_items(bill_id);
CREATE INDEX idx_bill_items_product ON bill_items(product_id);
CREATE INDEX idx_ncrs_status     ON ncrs(status);
CREATE INDEX idx_ncrs_bill       ON ncrs(bill_id);
CREATE INDEX idx_ncrs_token      ON ncrs(supplier_token);
CREATE INDEX idx_ncrs_created_at ON ncrs(created_at);
CREATE INDEX idx_uai_status ON uai_documents(status);
CREATE INDEX idx_uai_ncr    ON uai_documents(ncr_id);
CREATE INDEX idx_notif_user_read ON notifications(user_id, is_read);
CREATE INDEX idx_notif_created   ON notifications(created_at);
CREATE INDEX idx_audit_table_record ON audit_logs(table_name, record_id);
CREATE INDEX idx_audit_user         ON audit_logs(user_id);
CREATE INDEX idx_audit_created      ON audit_logs(created_at);
```

### 2.7 Pagination + Search — บังคับทุก list API

❌ ห้าม `SELECT *` โดยไม่มี `LIMIT` ใน list API เด็ดขาด

```javascript
const { page=1, limit=20, q='' } = req.query
const offset = (page-1) * limit
// ... WHERE + LIMIT ? OFFSET ?
res.json({ data: rows, total: total.c, page: +page, limit: +limit })
```

### 2.8 Soft Delete สำหรับเอกสาร

Bills, NCR, UAI — ใช้ status `cancelled` แทนการลบจริง

### 2.9 Supplier Response — superseded_at แทน DELETE

```javascript
// Mark เก่าเมื่อ Purchasing Reset
db.prepare("UPDATE supplier_responses SET superseded_at=datetime('now') WHERE ncr_id=? AND superseded_at IS NULL").run(ncrId)

// Query ใช้งาน — เสมอใช้ AND superseded_at IS NULL
db.prepare('SELECT * FROM supplier_responses WHERE ncr_id=? AND superseded_at IS NULL ORDER BY id DESC LIMIT 1').get(ncrId)
```

### 2.10 Notification Archiving

```sql
DELETE FROM notifications
WHERE created_at < datetime('now', '-180 days') AND is_read = 1;
```

---

## 3. กฎ Security

### 3.1 Authentication

```javascript
const ACCESS_TOKEN_TTL = '8h'
res.cookie('token', jwt, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 8 * 60 * 60 * 1000
})
```

- Idle timeout 30 นาที → logout อัตโนมัติ
- Warning popup ก่อน logout 2 นาที

### 3.2 Password Management

- เปลี่ยนรหัสผ่าน: ต้องกรอก password เดิม (ยกเว้น admin reset)
- Password ใหม่: ≥ 8 ตัวอักษร
- Hash: bcrypt rounds 12

### 3.3 Login Attempt Limit

```javascript
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'ลองใหม่ได้ใน 15 นาที' },
})
```

### 3.4 Rate Limit

```javascript
app.use(rateLimit({ windowMs: 60000, max: 200 }))           // global
app.use('/api/supplier', rateLimit({ windowMs: 60000, max: 30 }))
app.use(['/api/ncr/:id/pdf', '/api/uai/:id/pdf'],
  rateLimit({ windowMs: 60000, max: 5 }))
```

### 3.5 File Upload Security

- ตรวจ Magic Number (ไม่เชื่อ extension หรือ MIME จาก client)
- Rename เป็น UUID ป้องกัน path traversal
- เก็บชื่อต้นฉบับไว้ใน DB field `original_name` เท่านั้น
- ✅ **`original_name` ต้องผ่าน `fixOriginalName()` เสมอ (แก้ Session 106)** — multer/busboy decode
  `Content-Disposition` filename header เป็น `latin1` เสมอ (quirk เก่าของ Node http header spec) ทำให้ชื่อไฟล์
  ที่ไม่ใช่ ASCII (เช่น ภาษาไทย) กลายเป็น mojibake ก่อนถูกเก็บ DB — `middleware/upload.js` export
  `fixOriginalName(name)` (`Buffer.from(name,'latin1').toString('utf8')`, lossless round-trip แม้ชื่อเป็น ASCII ล้วน)
  ใช้แก้ใน `filename`/`fileFilter` callback ของทุก multer instance (`makeStorage()`, `xlsxUpload`, `kpiStorage`
  ใน routes/kpi.js) — ถ้าเพิ่ม multer instance ใหม่ (diskStorage หรือ memoryStorage) **ต้องเรียก `fixOriginalName()`
  กับ `file.originalname` ก่อนใช้งานเสมอ** ไม่งั้นชื่อไฟล์ภาษาไทย/ที่ไม่ใช่ ASCII จะเพี้ยน

### 3.6 Supplier Token

```javascript
const token = require('crypto').randomBytes(32).toString('hex')  // 64 char hex
```

- ❌ ห้ามใช้ `Math.random()` หรือ `uuid`
- Token อายุ 90 วัน — Purchasing regenerate ได้

---

## 4. NCR Status Flow (ครบทุกสถานะ)

```
pending_supervisor          → QC Supervisor อนุมัติ
pending_manager             → QC Manager อนุมัติ + disposition
pending_qmr_open            → QMR อนุมัติเปิด
pending_purchasing_review   → Purchasing รับทราบ + Review (มูลค่าเคลม THB/USD + แปลอังกฤษ) — ยังคัดลอก Link ไม่ได้ (S128)
pending_purchasing_manager_review → รอผู้จัดการจัดซื้ออนุมัติ (maker-checker gate, S128) ก่อนถึงจะคัดลอก Link ได้
pending_supplier            → Supplier ตอบกลับ (respondent_name บังคับ) — Link คัดลอกได้จากสถานะนี้เป็นต้นไป
pending_manager_review      → QC Manager ตรวจสอบคำตอบ
pending_supplier_resubmit   → QC Manager ปฏิเสธ → Purchasing Reset
pending_qmr_close           → QMR อนุมัติปิด
closed                      → ปิดแล้ว
ncp_closed                  → ปิด NCP (minor)
uai_pending_qc_manager      → เมื่อ disposition = uai
cancelled                   → ยกเลิก
```

---

## 5. กฎ Backup

```bash
sqlite3 $DB_PATH ".backup '$BACKUP_DIR/iqc_$DATE.db'"
# Cron: 0 2 * * *
# เก็บ 7 วัน rotating
```

---

## 6. กฎ Auto-Draft (Bill)

```javascript
useEffect(() => {
  const save = () => sessionStorage.setItem('bill_draft', JSON.stringify(formData))
  const timer = setInterval(save, 30000)
  window.addEventListener('beforeunload', save)
  return () => { clearInterval(timer); window.removeEventListener('beforeunload', save) }
}, [formData])
```

- ล้าง draft เมื่อ save สำเร็จ
- แจ้ง user เมื่อพบ draft ที่ยังไม่ได้บันทึก

---

## 7. กฎ Mobile — Signature & Camera

- Signature pad → full-page route แยก เช่น `/uai/:id/sign`
- ❌ ห้ามใช้ Modal ซ้อนกันบน mobile สำหรับ Signature และ Camera

---

## 8. โครงสร้าง Project

```
iqc-system/
├── client/src/
│   ├── pages/
│   │   ├── Bills/       (index.jsx, New.jsx, Detail.jsx)
│   │   ├── NCR/         (index.jsx, New.jsx, Detail.jsx)
│   │   ├── UAI/         (index.jsx, Detail.jsx)
│   │   ├── Master/      (index, Suppliers, Products, ProductGroups, Units, DefectCategories, Colors)
│   │   ├── Admin/       (Users.jsx, Settings.jsx)
│   │   ├── Supplier/    (NCRResponse.jsx — public, no auth)
│   │   ├── Reports/     (index, Summary, Receiving, NCRReport, UAIReport)
│   │   └── Dashboard/   (index.jsx = role→component map, shared.jsx + 8 component ต่อ role — แยกไฟล์ Session 103)
│   ├── components/
│   │   ├── Layout/      (AppLayout, Sidebar, BottomNav)
│   │   ├── UI/          (Badge, Button, Modal, ConfirmDialog, FilterBar,
│   │   │                 MultiSelect, SummaryCard, ToggleSwitch, SortTh, ProcessingToast)
│   │   └── Signature/   (SignatureCanvas.jsx)
│   ├── contexts/        (AuthContext.jsx, ProcessingContext.jsx)
│   ├── hooks/           (useNotifications.js, useSortable.js)
│   └── utils/           (api.js, rolePermissions.js)
├── server/
│   ├── routes/          IQC: auth, bills, ncr, supplier, uai, notifications, reports, delivery,
│   │                    holidays, issue-talk, attendance, master, exports, dashboard (GET /stats — server aggregate, Session 103)
│   │                    Production: ipqcInspection, ipqcMaster, ipncr, pdPlan, proCodeSap,
│   │                    fgMaster, fgFuai, fgMaterialDefects, fgDefect, fgFncp, fgFncpResponse, fgProduction, kpi
│   ├── middleware/      (auth.js, requireRole.js, upload.js)
│   ├── services/        (billService, ncrService, uaiService, supplierService, deliveryService, kpiService, fgFncpService, fgFuaiService, ipncrService, proCodeClassifier)  ← service/transaction layer
│   ├── lib/             (notify.js, fgNotify.js)  ← notification helpers
│   ├── utils/           (aqlCalc.js)
│   ├── db/              (schema.sql, database.js, migrate.js, sequences.js, audit.js)
│   │                    ✅ sequences.js (atomic seq) + audit.js (auditLog/settings/token) แยกแล้ว (Session 88)
│   │                    ⚠️ transactions.js (business tx) ยังไม่แยก — อยู่ใน route handler (ดู §23)
│   ├── test/            (unit, integration, ipqcUnit, ipqcMaster + service tests — รันด้วย `node --test`;
│   │                    ipqc.test.js/fqc.test.js ลบแล้ว Session 104, ทดสอบ table dead ไม่มี route จริง)
│   └── index.js         (port 3001, + admin settings/users/audit/stats, SSE, rate-limit)
└── uploads/             (bills, bill-items, inspection-docs, drawings, ncr, general, uai, ipqc — fqc ลบแล้ว S104)
```

---

## 9. สี (Color Tokens)

| Token | Hex | ใช้ที่ |
|-------|-----|--------|
| `primary` | `#1A3A5C` | Header, Primary Button, Active Nav |
| `accent` | `#2E6DA4` | Link, Icon Active |
| `bg` | `#F5F6F8` | พื้นหลังทั้งหมด |
| `surface` | `#FFFFFF` | Card, Table, Form |
| `border` | `#D1D5DB` | เส้นตาราง, ขอบ input |
| `text` | `#1F2937` | ข้อความหลัก |
| `muted` | `#6B7280` | Label, Helper text |
| `success` | `#16A34A` | ผ่าน, อนุมัติ |
| `danger` | `#DC2626` | ไม่ผ่าน, ปฏิเสธ |
| `warning` | `#D97706` | รอดำเนินการ, ต้องทำ |

---

## 10. ฟอนต์และ Layout

- **หลัก + ตัวเลข/รหัส:** IBM Plex Sans Thai ทั้งหมด
- ⚠️ **ห้ามใช้ IBM Plex Mono / `font-mono` เป็น monospace จริงอีก (แก้ Session 114):** glyph เลข 0 ของ
  IBM Plex Mono มีจุดกลางตายตัว แก้ด้วย CSS ไม่ได้เลย (ทดสอบแล้วทั้ง `font-variant-numeric` และ
  `font-feature-settings 'zero'`) ทำให้อ่านสับสนกับตัวเลขอื่นเวลาอ่านจำนวนเร็วๆ — `tailwind.config.js`'s
  `fontFamily.mono` ชี้ไปที่ IBM Plex Sans Thai เหมือน `sans` แล้ว (ไม่ใช่ Mono จริง) เพื่อให้ `font-mono`
  class เดิมที่ใช้อยู่ทั่วโปรเจกต์ (รหัสเอกสาร/PO/Invoice/จำนวน ฯลฯ) ไม่มีเลข 0 มีจุดอีกต่อไปโดยอัตโนมัติ —
  Google Fonts import ของ IBM Plex Mono ถูกลบออกจาก `index.html` แล้วเช่นกัน (ไม่ได้ใช้จริง)
- h1=24px h2=20px h3=16px body=14px small=12px
- Mobile: Bottom Nav, padding 16px
- Tablet: Sidebar collapsible
- Desktop: Sidebar 240px fixed, padding 24px
- ปุ่มและ Input สูงอย่างน้อย **44px**

---

## 11. Role Matrix (สรุป)

> ✅ **Role drift ปิดแล้ว (Session 105, เดิมเป็น P0 ใน AUDIT.md §5.4/§14 D1):** ตรวจโค้ดจริงพบว่า `schema.sql`
> (`users.role CHECK`) มี **11 roles อยู่แล้วจริง** (รวม `prod_supervisor`) และมี migration
> `migrateUsersRoleConstraint()` อัปเกรด DB เก่าให้ครบด้วย — ยืนยันด้วย `INSERT` ทดสอบสำเร็จทั้งบน schema.sql
> (fresh) และ dev DB จริง ตัว gap จริงอยู่ที่ frontend: `rolePermissions.js`'s `CREATABLE_ROLES` เดิมกันไม่ให้
> เลือก `prod_supervisor` ในฟอร์มสร้าง user เอง (สร้างเงื่อนไขนี้ไว้ผิดเองใน Session 103 ตามความเข้าใจผิดขณะนั้น)
> — แก้แล้ว, verify end-to-end ผ่าน UI จริงแล้ว (สร้าง user role นี้ผ่าน Admin/Users.jsx สำเร็จ)
> ตารางด้านล่างยังเขียนย่อเป็น `prod_mgr` (10 คอลัมน์) — role จริงที่ 11 คือ `prod_supervisor` ดู §22.2 สำหรับ role list เต็ม

| Feature | admin | qc_staff | qc_supervisor | qc_manager | qmr | purchasing | cco | cmo | cpo | prod_mgr |
|---------|-------|----------|---------------|------------|-----|------------|-----|-----|-----|----------|
| จัดการ Master | ✅ | — | — | — | — | — | — | — | — | — |
| สร้างบิล | — | ✅ | — | — | — | — | — | — | — | — |
| อนุมัติรับเข้า | — | — | ✅ | — | — | — | — | — | — | — |
| เปิด NCR/NCP | — | ✅ | ✅ | — | — | — | — | — | — | — |
| อนุมัติ NCR L1 | — | — | ✅ | — | — | — | — | — | — | — |
| อนุมัติ NCR L2 + Disposition | — | — | — | ✅ | — | — | — | — | — | — |
| QMR เปิด/ปิด NCR | — | — | — | — | ✅ | — | — | — | — | — |
| Purchasing Review + Copy Link | — | — | — | — | — | ✅ | — | — | — | — |
| ตรวจสอบคำตอบ NCR | — | — | — | ✅ | — | — | — | — | — | — |
| ขอ UAI / Sign (ออกเอกสาร) | — | — | — | — | — | ✅ | — | — | — | — |
| Sign UAI (อนุมัติ) | — | — | — | — | — | — | ✅ | ✅ | ✅ | — |
| Sign UAI (รับทราบ QC) | — | — | — | ✅ | — | — | — | — | — | — |
| Sign UAI (รับทราบ ผลิต) | — | — | — | — | — | — | — | — | — | ✅ |
| Sign UAI (รับทราบ QMR) | — | — | — | — | ✅ | — | — | — | — | — |
| Export Report | — | — | — | ✅ | — | — | ✅ | ✅ | ✅ | — |
| วางแผน Delivery | — | — | — | — | — | ✅ | — | — | — | — |
| บันทึกส่งนอกแผน | — | ✅ | ✅ | — | — | — | — | — | — | — |

---

## 12. กฎ Real-time & Notification

- ❌ ห้ามใช้ WebSocket — SSE เพียงพอ
- ❌ ห้าม push ข้ามสิทธิ์ — ตรวจ role ก่อน push
- Telegram: ส่งไม่ได้ → log แล้วไปต่อ ไม่ crash
- Email (S128, `lib/mailer.js`): SMTP ยังไม่ได้ตั้งค่า → log แล้วไปต่อเหมือน Telegram (ไม่ crash) — settings
  เก็บใน `settings` table เหมือน Telegram (`smtp_host`/`smtp_port`/`smtp_secure`/`smtp_user`/`smtp_from`),
  `smtp_password` เข้ารหัสผ่าน `getSecretSetting`/`setSecretSetting` (ต่างจาก `telegram_bot_token` ที่เป็น
  plain write-only) — ใช้ครั้งแรกกับ COO รับทราบ NCR หลัง purchasing_manager อนุมัติ (ดู §4)

**Telegram กลุ่ม QC:** บิลใหม่, NCR ทุกขั้น, UAI QC steps, Delivery ทุก event  
**Telegram กลุ่มจัดซื้อ:** NCR+link, UAI purchasing steps, QC acknowledge delivery  
**Email + Telegram ส่วนตัว COO (S128):** NCR ที่ purchasing_manager อนุมัติแล้ว (ก่อนส่ง Supplier) — แจ้งเตือนเฉยๆ
ไม่มีปุ่ม/สถานะ acknowledge ในระบบ (ตัดสินใจแล้ว ดู session log)

---

## 13. กฎ Export

- ❌ ห้าม generate PDF/Excel บน frontend
- `Content-Disposition: attachment` ทุก response
- Rate limit: 5 req/นาที/user

---

## 14. กฎ Audit Log

- `auditLog()` ต้องอยู่ใน transaction เดียวกันเสมอ
- ❌ ห้าม audit นอก transaction
- Events: CREATE/APPROVE/SIGN/CLOSE/EXPORT + LOGIN/LOGIN_FAILED

---

## 15. กฎ UI ทั่วไป

- ❌ ห้ามใช้ gradient / emoji ใน UI หลัก
- ❌ ห้ามลบโดยไม่มี confirmation
- ❌ ห้าม hover-only interaction บน mobile
- ❌ ห้าม hardcode role ใน component
- ❌ ห้าม role ที่ไม่มีสิทธิ์เห็น action button

---

## 16. กฎ Bills (ปัจจุบัน)

- Pagination: 10 แถว/หน้า + No. รันต่อเนื่อง
- Computed status filter: backend ส่ง `approved` + client-side filter
- Dropdown ผู้ออกเอกสาร: `/api/bills/creators` (cache 5 min), auto-width ตาม canvas measurement
- Filter วันนี้รับเข้า: checkbox เปรียบเทียบ YYYY-MM-DD

---

## 17. กฎ NCR Timeline

- Label: **"Timeline การดำเนินการ"**
- รวม events: approvals + supplier_responses + purchasing_received_at + link_copied_at

---

## 18. Environment Variables (.env)

```
NODE_ENV=production
PORT=3001
JWT_SECRET=           # random 64+ chars
BCRYPT_ROUNDS=12
```

> Telegram config เก็บใน `settings` table ผ่าน `/admin/settings/telegram`

---

## 19. ISO Compliance Features

### Disposition NCR

- บังคับเลือก disposition ก่อน sign
- `uai` → trigger UAI workflow
- `re_inspect` → บล็อกปิด NCR จนกว่า re-inspection จะ pass

### Drawing Revision

- `is_current=1` unique per product
- อัปโหลดใหม่ → set เดิม `is_current=0` + `obsoleted_at=now()` ใน transaction
- ❌ ห้ามลบ

### Lot/Batch Traceability

- `require_lot_number=1` → บังคับ lot_number
- `require_expiry_date=1` → บังคับ expiry_date
- expiry_date < received_date → hard block

### Calibration

- `out_of_service` ไม่ขึ้น dropdown
- next_calibration < today → warning บังคับ

### Supplier Evaluation

- Grade: A(≥90) B(75-89) C(60-74) D(<60)

### Risk Register

- score = likelihood × impact
- ❌ ห้าม delete — ใช้ `closed`

---

## 20. กฎ Delivery Schedule

- Purchasing สร้าง/แก้ไข/ลบได้เฉพาะ status=`pending`
- ลบหลัง QC acknowledge ไม่ได้ → ใช้ "ยกเลิก"
- `late`/`rescheduled` → บังคับกรอกเหตุผล
- QC Staff บันทึกส่งนอกแผน: `is_unplanned=1`, `status=on_time`
- ❌ ห้าม Purchasing แก้ unplanned schedule
- SSE push `delivery_created` และ `delivery_updated` ทันที

---

## 21. กฎ IPQC

**Updated:** 2026-06-24 · ⚠️ ชื่อตารางใน §21.1-21.2 แก้เป็น `ipqc_inspections` แล้ว (Session 104 — `ipqc_records` เดิมที่เอกสารนี้อ้างถึง
พิสูจน์แล้วว่าเป็น dead table ไม่มี route จริงใช้, ดู AUDIT.md D6); FQC ตัดออกทั้งหมด (`fqc_records` ลบแล้ว Session 104, dead feature)

### 21.1 Product Reference — ห้ามสับสน products กับ pro_code_sap

```
❌ ผิด — IPQC ใช้ products table
ipqc_inspections.product_id INTEGER REFERENCES products(id)

✅ ถูก — IPQC ใช้ pro_code_sap table
ipqc_inspections.pro_code_sap_id INTEGER REFERENCES pro_code_sap(id)
```

| Table | Domain | ใช้กับ |
|-------|--------|--------|
| `products` | วัตถุดิบจาก Supplier | Bills, NCR, IQC รับเข้า |
| `pro_code_sap` | สินค้าผลิตสำเร็จ (SAP codes) | IPQC, FGQC |

### 21.2 Transaction Operations บังคับ

| Operation | ต้องรวมใน transaction |
|-----------|---------------------|
| Create IPQC inspection | record (draft) + stub items จาก template + sequence + audit |
| Submit IPQC | compute overall_result + status update (optimistic lock ผ่าน `WHERE status='draft'`) + notifications (ถ้า fail) + audit |
| Monthly Approve (FGQC) | UNIQUE check + approval record + notifications + audit |
| PDPlan Import | upsert pd_plan + pro_code_sap create/link (per row) |
| Confirm ProCodeSAP | status update + pd_plans.pro_code_sap_id update |

### 21.3 Defect Code — Server-side Only

⚠️ **เอกสาร ↔ โค้ดไม่ตรง (พบ Session 104, ดู AUDIT.md D6):** กฎด้านล่างนี้อธิบาย `ipqc_records`/`defect_code`
ซึ่งพิสูจน์แล้วว่าเป็น**ตาราง dead ไม่เคยมี route จริงใช้งานเลย** (เหมือน `fqc_records` ที่ลบไปแล้ว Session 104) —
`generateDefectCode`/`defect_code` **ไม่มีอยู่จริงในโค้ดปัจจุบัน** ตัว IPQC จริงที่ใช้งานคือ `ipqc_inspections`
ผ่าน `routes/ipqcInspection.js` (AQL-sampling + checklist items, ไม่มี defect_code generation แบบนี้) — ดู §3.4 ใน AUDIT.md
**ยังไม่ได้ลบตาราง `ipqc_records` ออก** (รอ user ตัดสินใจ) — โค้ดตัวอย่างด้านล่างเป็น**ของเดิมที่ไม่ได้ enforce จริง**:

```javascript
// ✅ ถูก — generate ใน transaction ฝั่ง server
function generateDefectCode(line, fm, process, defectType) {
  return `${line.factory_code}${fm.code}${process.code}${defectType.code}`
  // ตัวอย่าง: "01McTC001"
}

// ❌ ผิด — ห้าม client generate
// ❌ ผิด — ห้าม edit defect_code หลัง save
```

### 21.4 defect_rate — Store ที่ Save เท่านั้น

```javascript
// ✅ ถูก — store ณ เวลา save
const defect_rate = Math.round((defect_qty / total_qty) * 100 * 100) / 100

// ❌ ผิด — ห้าม recompute ใน list query
// SELECT defect_qty * 100.0 / total_qty AS defect_rate ...

// pass_qty — ไม่เก็บ DB, compute ที่ SELECT
// SELECT total_qty - defect_qty AS pass_qty
```

### 21.5 ProCodeSAP — ห้าม serve pending ใน IPQC/FGQC dropdown

```javascript
// ✅ ถูก — เฉพาะ confirmed
db.prepare('SELECT * FROM pro_code_sap WHERE classify_status=? AND product_no LIKE ?')
  .all('confirmed', `%${q}%`)

// ❌ ผิด — รวม pending/auto ทำให้ worker เห็นสินค้าที่ยังไม่ verified
```

### 21.6 PDPlan Import — Scan-based Header Detection

```javascript
// ✅ ถูก — หา header row โดย scan หาชื่อ column
function findHeaderRow(worksheet) {
  for (const row of worksheet.getRows(1, 10)) {
    const vals = row.values.map(v => String(v || '').trim().toLowerCase())
    if (vals.includes('product no.')) return row.number
  }
  throw new Error('ไม่พบ header row')
}

// ✅ ถูก — map column โดยชื่อ ไม่ใช่ตำแหน่ง
function buildColumnMap(headerRow) {
  const map = {}
  headerRow.eachCell((cell, col) => {
    const name = String(cell.value || '').trim().toLowerCase()
    if (name === 'product no.')         map.product_no = col
    if (name === 'product description') map.product_desc = col
    if (name === 'planned')             map.plan_qty = col
    // ...
  })
  return map
}

// ❌ ผิด — hard-code column letter (A=1, B=2, ...)
// const product_no = row.getCell(2).value  ← หัก ถ้า Sheet มี SO. column พิเศษ
```

### 21.7 Upload Paths (IPQC)

⚠️ FQC ตัดออกแล้ว (Session 104 — `fqc_records` ลบ, dead feature)

```
/uploads/ipqc/{record_no}/{uuid}.jpg     ← IPQC images
```

- `record_no` เช่น `IPQC-2026-0001` — ใช้เป็น folder name
- ✅ Rename เป็น UUID (ป้องกัน path traversal)
- ✅ ตรวจ Magic Number ก่อน save
- ❌ ห้ามเก็บ original filename เป็น path

### 21.8 Sequence Keys (Seed บังคับ)

⚠️ `FQC` ตัดออกจาก seed แล้ว (Session 104 — table `fqc_records` ถูกลบ, dead feature) เหลือเฉพาะ IPQC:

```sql
INSERT OR IGNORE INTO document_sequences(doc_type, last_seq, year)
VALUES ('IPQC', 0, strftime('%Y', 'now'));
```

เรียกใน `seedData()` ของ `database.js`

### 21.9 Indexes บังคับเพิ่มเติม (IPQC)

⚠️ **`ipqc_records`/`fqc_records` ด้านล่างเป็นตาราง dead (ดู AUDIT.md D6, §21.3)** — `fqc_records` ถูกลบแล้ว
(Session 104); `ipqc_records` ยังไม่ได้ลบแต่ไม่มี route ใช้จริง — index เหล่านี้มีอยู่ในตารางแต่ไม่มี query ไหนพึ่งพา
index ของตัวจริง (`ipqc_inspections`) ดูได้จาก `schema.sql` โดยตรง (ไม่ทวนซ้ำในเอกสารนี้เพื่อกัน drift):

```sql
-- pro_code_sap
CREATE INDEX IF NOT EXISTS idx_pro_code_no     ON pro_code_sap(product_no);
CREATE INDEX IF NOT EXISTS idx_pro_code_brand  ON pro_code_sap(brand);
CREATE INDEX IF NOT EXISTS idx_pro_code_type   ON pro_code_sap(line_type);
CREATE INDEX IF NOT EXISTS idx_pro_code_status ON pro_code_sap(classify_status);

-- pd_plans
CREATE INDEX IF NOT EXISTS idx_pd_plan_no    ON pd_plans(product_no);
CREATE INDEX IF NOT EXISTS idx_pd_plan_due   ON pd_plans(due_date);
CREATE INDEX IF NOT EXISTS idx_pd_plan_line  ON pd_plans(production_line_id);

-- ipqc_records (⚠️ dead table — ดูหมายเหตุด้านบน)
CREATE INDEX IF NOT EXISTS idx_ipqc_date        ON ipqc_records(found_date);
CREATE INDEX IF NOT EXISTS idx_ipqc_sap         ON ipqc_records(pro_code_sap_id);
CREATE INDEX IF NOT EXISTS idx_ipqc_line        ON ipqc_records(production_line_id);
CREATE INDEX IF NOT EXISTS idx_ipqc_status      ON ipqc_records(status);
CREATE INDEX IF NOT EXISTS idx_ipqc_defect_code ON ipqc_records(defect_code);
```

### 21.10 กฎ Soft Delete / Immutability

- IPQC status=`closed` หรือ `cancelled` → ห้าม edit ทุก field
- `defect_code` ห้าม update หลัง INSERT (⚠️ ใช้ไม่ได้จริง — `ipqc_records` เป็น dead table, ดู §21.3)
- `record_no` ห้าม update หลัง INSERT
- รูปภาพ IPQC — ลบได้เฉพาะเมื่อ status=open

### 21.11 IPQC ใน Role Matrix

เพิ่มใน `rolePermissions.js`:

```javascript
// Group แยกต่างหากจาก IQC รับเข้า
{
  path: '/production-qc', label: 'QC หน้างาน', icon: 'clipboard',
  roles: ['admin','qc_staff','qc_supervisor','qc_manager','cpo','prod_mgr'],
  children: [
    { path: '/ipqc/new',   label: 'บันทึก IPQC',    icon: 'plus',     roles: ['admin','qc_staff','qc_supervisor'] },
    { path: '/ipqc',       label: 'รายการ IPQC',    icon: 'list',     roles: ['admin','qc_staff','qc_supervisor','qc_manager','cpo','prod_mgr'] },
  ],
},
```

> **หมายเหตุ:** `rolePermissions.js` จริงใช้ `production_manager` (ไม่ใช่ `prod_mgr`) และ nav group จริงคือ
> `/production-qc` + `/fg-production` (ดูโครงจริงใน §22.2)

---

## 22. โมดูลเพิ่มเติม (ที่ยังไม่มีในกฎเดิม)

**Updated:** 2026-07-02 — เพิ่มจากการ audit โค้ดจริง (ดูรายละเอียด business logic ใน `prd.md` และ `AUDIT.md §3`)

### 22.1 กฎ FG Production (FG Defect → FNCP → FUAI)

| Operation | ต้องรวมใน transaction |
|-----------|---------------------|
| Create FG defect record | record + sequence + notifications + audit |
| Create FNCP | fncp + prod_token (crypto 64-hex) + update defect status + notifications + audit |
| FNCP transition (ทุกขั้น) | status update (optimistic lock) + approval trail + notifications + audit |
| Prod response (public token) | response + attachments + supersede เก่า + update status + audit |
| Create FUAI | fuai + update FNCP=fuai_opened + notifications + audit |
| Sign FUAI (ทุกฝ่าย) | signature (ไฟล์) + status transition + notifications + audit |

- **FM Category = 5M+E** (`fg_fm_categories`: MATERIAL/MACHINE/METHOD/MAN/MEASURE/ENV, มี flag `is_material`)
- ✅ **FM=Material → ผู้ตอบกลับคือ "QC รับเข้า"** (ไม่ใช่ "ฝ่ายผลิต") — conditional text ทั้ง form/notification/timeline
- Defect taxonomy: `fg_defect_groups` (DSIZE/DCOLOR/DSURFACE/DASM/DGLASS/DPACK/DOTHER) → `fg_defect_types` (severity_default)
- FNCP status: `open → in_progress → waiting_verify → supervisor_approved → verified → closed | reject | fuai_opened`
- ❌ prod_token ห้ามใช้ `Math.random()` — `crypto.randomBytes(32)` เท่านั้น (เหมือน supplier token)

### 22.2 Nav Group จริง (จาก `rolePermissions.js`)

```
ALL_QC_ROLES  = admin, qc_staff, qc_supervisor, qc_manager, qmr, purchasing, cco, cmo, cpo, production_manager, prod_supervisor
PROD_QC_ROLES = admin, qc_staff, qc_supervisor, qc_manager, cpo, production_manager, prod_supervisor
onlyReceivingQC(user) = role !== 'qc_staff' || qc_station === 'incoming'

/ หน้าหลัก · /iqc (bills, ncr, uai, delivery, material-defects) [condition: onlyReceivingQC]
/production-qc (dashboard, ipqc, ipncr) · /fg-production (record, fncp, fuai)
/issue-talk · /qc-attendance · /reports · /kpi (dashboard/summary/bantuk/setup)
/admin (users, settings, production-master, procode-sap, holidays, audit-logs) · /master (6 CRUD)
```

### 22.3 กฎ KPI

- Flow จริงที่ UI ใช้ (ยืนยันแล้ว Session 103 — ดู AUDIT.md §3.7/D3): `kpi_items`+`kpi_targets` (Setup) →
  **`kpi_actuals`** (บันทึกค่าจริงรายเดือน ไม่มี approval — แท็บ "บันทึก KPI") →
  **`kpi_action_plans`** (CAPA เมื่อ fail เป้า — สร้าง/อนุมัติจากแท็บ "สรุป KPI", `draft→pending_qcm→pending_cpo→pending_qmr→approved`, optimistic lock ทุกขั้น)
- ⚠️ **`kpi_reports`/`kpi_report_entries`/`kpi_report_files`/`kpi_approvals` = DEPRECATED (ยืนยันมติแล้ว Session 104)**
  ไม่มี UI entry point เลย (ไม่มีปุ่มสร้าง/หน้า list/ลิงก์ไป `/kpi/reports/:id` ที่ไหนใน `client/src`) ถูกเขียนทับด้วย `kpi_actuals` ตั้งแต่ก่อน Session 89
  **มติ:** คงตาราง/endpoint ไว้ (ไม่ลบ) แต่ห้ามขยาย/ใช้เป็น pattern สำหรับโค้ดใหม่ และห้ามสร้าง UI ใหม่โดยไม่ปรึกษา product owner ก่อน
  (มี comment กำกับ DEPRECATED ใน schema.sql, routes/kpi.js, services/kpiService.js, App.jsx, ReportDetail.jsx แล้ว)
- UNIQUE `(kpi_item_id, year, month)` — กัน target/actual ซ้ำ

### 22.4 กฎ QC Attendance

- Geofence ตรวจ **ฝั่ง server เท่านั้น** (haversine กับ `factory_lat/lon/radius_m` ใน settings) — ห้ามเชื่อ client
- UNIQUE `(user_id, date)` — เช็คชื่อได้ครั้งเดียว/วัน; คำนวณ `late_minutes`, `work_minutes` ตอน check-out
- แจ้ง Telegram เมื่อ check-in; SSE event `attendance_update`

### 22.5 กฎ Issue Talk / Holidays

- Issue Talk: กระทู้ + participant (m:n) + message + attachment (magic-number) + read tracking (`last_read_message_id`)
- Holidays: `company_holidays` (unique `holiday_date`) — admin only; ใช้คำนวณ working day (delivery/attendance)

---

## 23. Known Deviations (เอกสาร ↔ โค้ด)

รายการที่กฎ/เอกสารเดิม **ไม่ตรง** กับโค้ดจริง — บันทึกไว้เพื่อไม่ให้ AI รุ่นถัดไปหลงทาง (แก้ตาม roadmap ใน AUDIT.md §12):

| # | กฎเดิมบอกว่า | ความจริงในโค้ด | แผน |
|---|-------------|----------------|-----|
| 1 | มี `db/transactions.js`, `sequences.js`, `audit.js` แยก | ✅ `sequences.js`+`audit.js` (Session 88); ✅ business tx ทุกโดเมน (NCR/UAI/Supplier/Bills/Delivery/KPI/FG FNCP/FUAI/IPNCR) สกัดเป็น `services/*.js` ครบแล้ว (S90–102) — ไม่มี `transactions.js` ไฟล์เดียวเพราะแยกเป็น domain service แทน | ปิดประเด็น — service layer ครบแล้ว |
| 2 | ~~Role มี 10 (จบที่ `prod_mgr`)~~ | **แก้แล้ว (S105):** schema มี 11 roles อยู่แล้วจริง (รวม `prod_supervisor`) + migration รองรับ DB เก่า — เข้าใจผิดเดิมว่า schema มีแค่ 10; gap จริงคือ frontend `CREATABLE_ROLES` กันเอง แก้แล้ว | ปิดประเด็น — role matrix §11 ยังเขียนย่อ 10 คอลัมน์ (ไม่ใช่ bug แค่เอกสารสรุป) |
| 3 | IPQC/FQC ~2 ตารางหลัก | **แก้แล้ว (S104):** FQC ทั้งฟีเจอร์ถูกลบ (`fqc_records`+3 child table ไม่เคยมี route จริง); IPQC จริงมี `ipqc_inspections`/`ipqc_stations`/`ipqc_check_templates`/`ipqc_check_items` หลายตัว — **`ipqc_records`/`ipqc_images` (§21.3/21.9 เดิมอ้างถึง) ก็เป็น dead table เหมือนกัน** (D6) ยังไม่ลบ รอ user ตัดสินใจ | เอกสารครอบใน prd.md แล้ว + §21 แก้ชื่อตารางแล้ว (S104) |
| 4 | Test มีแต่ spec | มี test 12 ไฟล์ (161 tests) — **เขียวหมด, 0 skip** (S104 ลบ `ipqc.test.js`/`fqc.test.js` ที่ทดสอบ dead table ออก) | ปิดประเด็น |
| 5 | `.env` เสี่ยง secret รั่ว | `.env` **ไม่ถูก commit** (git track เฉพาะ `.env.production.example`) | ปิดประเด็น (dev-hygiene) |
| 6 | `ipqc_records` คือตารางที่ IPQC ใช้งานจริง (§21.3 เดิม) | **ไม่จริง (พบ S104)** — `ipqc_records` ไม่มี route ใดใช้เลย (เหมือน `fqc_records` เดิมก่อนลบ) ตัวจริงคือ `ipqc_inspections` ผ่าน `ipqcInspection.js` ซึ่งไม่มี integration test คลุม create→submit เลย | รอตัดสินใจ: ลบ `ipqc_records` เหมือน fqc + เขียน test ให้ `ipqc_inspections` (ดู AUDIT.md D6, testcase.md §3) |

> ✅ ส่วนที่ยัง **ถูกต้องและ enforce จริง**: WAL + FK ON, atomic sequence (ไม่ใช้ SELECT MAX), optimistic lock ทุก transition,
> magic-number upload, session_token single-login, rate-limit (global/supplier/export), audit log ใน transaction

---

## 24. กฎ Authentication Provider Framework (Local + Active Directory)

**Added:** 2026-07-08 (Session 118) — ตอบสนอง `ADAuthen.md` ที่ฝ่าย IT ส่งมา (AD Gateway integration guide)

### 24.1 หลักการ — AD เป็นระบบเสริมเท่านั้น (กฎเหล็ก ห้ามฝ่าฝืน)

- ผู้ใช้ที่ `users.auth_provider = 'local'` ต้อง login ด้วย local bcrypt ได้ปกติเสมอ **ไม่ว่า** `auth_mode`/
  `ad_enabled` (settings) จะตั้งเป็นอะไรก็ตาม — ห้ามมี code path ใดที่ deny local user เพราะเหตุผลของ AD
- Mode ที่ทำงานจริงมีแค่ `local` (ปิด AD ทั้งระบบ) และ `hybrid` (เปิด AD เฉพาะ user ที่ `auth_provider='ad'`)
- ตัวเลือก "Active Directory (บังคับทุกคน, deny local user)" ตาม ADAuthen.md §4.1 ตรงตัว — **ไม่ implement
  จริง** เพราะขัดกับกฎเหล็กข้างต้น โชว์ใน dropdown แบบ disabled เท่านั้น (เหมือน LDAP/Azure AD ที่เป็น future stub)

### 24.2 Provider Strategy Pattern

```
server/services/auth/
  localProvider.js     — bcrypt compare ตรงกับ users.password_hash (ของเดิม)
  adProvider.js        — Local Pass Bypass (bcrypt กับ cache ก่อน) → AD Gateway fallback → self-heal cache
  resolveProvider.js   — เลือก provider จาก { auth_mode, ad_enabled, user.auth_provider } (บังคับกฎเหล็ก §24.1)
services/authService.js         — orchestration (login) แทน logic เดิมใน routes/auth.js
services/authSettingsService.js — General/Authentication/Security/Advanced settings + testAdConnection()
services/environmentService.js  — environment preset (list/upsert/delete/apply)
lib/adGatewayClient.js   — HTTP client เรียก AD Gateway จริง (timeout+retry)
lib/adResponseParser.js  — parse response ของ AD Gateway (**จุดเดียว** ที่ต้องแก้เมื่อ IT ยืนยัน schema จริง)
lib/secretsCrypto.js     — AES-256-GCM เข้ารหัส secret ใน settings (ad_secret_key)
```

ทุก provider export `{ name, authenticate({ user, password }) }` — throw `httpError(status)` เมื่อไม่ผ่าน
(`e.lockoutExempt = true` สำหรับกรณีที่ไม่ใช่ความผิดของ user เช่น AD unreachable/timestamp หมดอายุ — authService
จะไม่นับเป็น failed login attempt) หรือคืน `{ synced: boolean, newPasswordHash? }` เมื่อผ่าน

**Login modes (2 ทาง, `POST /api/auth/login`):**
- ปกติ (ปุ่ม "เข้าสู่ระบบ"): `authService.login({ username, password })` → `resolveProvider()` เลือก provider จาก
  account (cache-first เสมอสำหรับ AD user — กฎเหล็ก §24.1)
- บังคับ AD (ปุ่ม "Internal AP System", `forceAdGateway: true`): ข้าม `resolveProvider()` ไปเรียก `adProvider`
  ตรงๆ ด้วย `{ skipCache: true }` (ข้าม Local Pass Bypass เสมอ ไปเช็คกับ AD Gateway จริงทุกครั้ง) — ใช้ได้เฉพาะ
  account ที่ `auth_provider='ad'` เท่านั้น (ไม่งั้น 400 "บัญชีนี้ยังไม่ได้เปิดใช้งาน Active Directory") และต้อง
  `auth_mode='hybrid' && ad_enabled` ทั้งระบบด้วย (ไม่งั้น 503) — error message ต้องชัดเจน ห้าม silently fallback

### 24.3 AD Gateway Integration — กฎเฉพาะจาก ADAuthen.md

- **Timestamp**: เวลาไทย (+07:00) แต่ format ปิดท้าย `Z` ไม่มีมิลลิวินาที เช่น `2026-06-24T11:15:49Z` — ใช้
  `adGatewayClient.formatAdTimestamp()` (`Intl.DateTimeFormat` timeZone `Asia/Bangkok`) **ห้าม** ใช้
  `Date.toISOString()` ตรงๆ และห้ามพึ่ง `process.env.TZ` (dev/test ไม่ได้ตั้งเป็น Asia/Bangkok เสมอไป)
- **Retry**: retry เฉพาะ network-level error (timeout/ECONNREFUSED/AbortError) เท่านั้น — **ห้าม retry** เมื่อ
  AD Gateway ตอบกลับมาแล้วไม่ว่า reason อะไร (แม้ parse ไม่ออก) เพราะจะไปเร่ง account lockout policy ของ Windows
  AD จริง
- **Local Pass Bypass**: ทุก login ของ AD user ต้อง bcrypt compare กับ cache ก่อนเสมอ ผ่านแล้วห้ามยิง network
  ไปหา AD Gateway อีก (ลด traffic ตามที่ ADAuthen.md ระบุ)
- **Self-healing sync**: AD Gateway ตอบสำเร็จ → hash รหัสใหม่ทับ `users.password_hash` เดิมในทรานแซกชันเดียวกับ
  login (authService เป็นเจ้าของ transaction ไม่ใช่ adProvider)
- ⚠️ **Response schema ของ AD Gateway ยังไม่ได้ยืนยันจาก IT** (ADAuthen.md ไม่มีตัวอย่าง response เลย ทั้ง
  success/fail) — `adResponseParser.js` ใช้ heuristic ชั่วคราว (2xx+status success → ok, message มีคำว่า
  "expired" → reason expired, อื่นๆ → rejected) **ต้องแก้ไฟล์นี้ไฟล์เดียว** เมื่อ IT ยืนยัน schema จริง

### 24.4 Settings — ห้าม hardcode endpoint/secret

- ทุกค่าที่เกี่ยวกับ AD (`ad_gateway_url`, `ad_app_id`, `ad_secret_key`, `ad_domain`, `ad_timeout_ms`,
  `ad_retry_count` ฯลฯ) เก็บใน `settings` table ผ่าน `db.getSetting`/`db.setSetting` เหมือน Telegram config เดิม
  — `ad_secret_key` ใช้ `db.getSecretSetting`/`db.setSecretSetting` (เข้ารหัส AES-256-GCM, prefix `enc:v1:`)
- `ad_secret_key` เป็น **write-only** ใน API เสมอ (GET คืน `ad_secret_key_set: boolean` ไม่คืนค่าจริง) — pattern
  เดียวกับ `telegram_bot_token`
- Master key เข้ารหัส (`SETTINGS_ENCRYPTION_KEY`, hex 64 ตัว) เป็น env var เท่านั้น (chicken-and-egg — เข้ารหัส
  ค่าใน DB ด้วย key ที่เก็บใน DB เดียวกันไม่ได้) **ไม่ fail-fast ตอน boot** ต่างจาก `JWT_SECRET` เพราะ AD เป็น
  feature เสริม ระบบเดิมต้อง boot ได้ปกติแม้ไม่ได้ตั้งค่านี้ (throw เฉพาะตอนมีการ encrypt/decrypt จริงถ้าไม่ได้ตั้ง)

### 24.5 Environment Preset

- `environment_presets` table = preset เก็บ endpoint ไว้ล่วงหน้า (Dev/UAT/Prod/OnPrem/Cloud) — กด **Apply** แล้ว
  copy ค่าเข้า `settings` จริง (`app_url`/`ad_gateway_url`/`ad_domain`) ทันที ไม่ต้อง restart/deploy ใหม่
- Runtime **ห้าม** query join ตาราง `environment_presets` ตรงๆ — โค้ดทุกจุดอ่านจาก `settings` เท่านั้นเสมอ (กัน
  2 source of truth)

### 24.6 Account Lockout — durable, configurable

- `users.failed_login_count`/`locked_until` — เพิ่มเติมจาก `express-rate-limit` เดิม (in-memory, reset ทุก
  restart) ให้ทนรอด restart + configurable ผ่าน settings (`login_attempt_max`, `lock_account_minutes`)
- ความพยายาม login ที่ไม่ใช่ความผิดของ user (AD gateway unreachable, timestamp หมดอายุ) **ต้องไม่นับ** เข้า
  `failed_login_count` — provider throw error พร้อม `e.lockoutExempt = true` เพื่อบอก authService

### 24.7 Known scope decisions (ตกลงกับ user แล้ว, Session 118)

- Dark Mode: **ไม่ทำ** ในหน้า Settings ใหม่ (ระบบไม่มี dark-mode infra เลยทั้งระบบ) — เป็นงานแยกในอนาคต
- LDAP / Azure AD / OAuth: โชว์เป็น disabled option ใน UI เท่านั้น (`Login.jsx` มีปุ่ม SSO disabled อยู่แล้วเป็น
  จุดต่อในอนาคต) — **ยังไม่ implement provider จริง**
- Refresh Token: มี toggle ใน Security settings แต่ **inert** (ไม่ผูก logic จริง) — ระบบยังใช้ JWT expiry เดียว
- ไม่ migrate เป็น TypeScript (โปรเจกต์เป็น plain JS ทั้งระบบ) — "Type Safety" ตีความเป็น JSDoc + runtime
  validation ที่จุดเข้า

---

## 25. กฎ Dark Mode (App-wide, per-user)

**Added:** 2026-07-08 (Session 121) — Light/Dark/Auto ที่ผู้ใช้แต่ละคนเลือกเอง (localStorage, ไม่ผูก backend/login)

### 25.1 สถาปัตยกรรม

- **CSS variable token**: `client/src/index.css` นิยาม `--color-{primary,accent,bg,surface,border,text,muted,
  success,danger,warning}` เป็น RGB space-separated ใน `:root` (light) และ override ใน `.dark` (dark) —
  `tailwind.config.js` ผูก 10 token เดิม (`primary`/`accent`/`bg`/`surface`/`border`/`text`/`muted`/`success`/
  `danger`/`warning`) เป็น `rgb(var(--color-x) / <alpha-value>)` แทน hex ตรงๆ — ทำให้ `bg-surface`, `text-text`
  ฯลฯ ที่ใช้อยู่ทั่ว 51+ หน้าเดิม **สลับ theme เองอัตโนมัติโดยไม่ต้องแก้ className แม้แต่บรรทัดเดียว**
- **`darkMode: 'class'`** ใน tailwind.config.js — toggle ผ่าน `.dark` class บน `<html>` (ไม่ใช้ `media` strategy
  เพราะต้องรองรับ auto-ตามเวลานาฬิกา ไม่ใช่ OS `prefers-color-scheme`)
- **`ThemeContext.jsx`** (`client/src/contexts/`) — เก็บ `preference` (`'light'|'dark'|'auto'`) ใน
  `localStorage['iqc_theme_preference']` โหมด `auto` เช็คชั่วโมงปัจจุบันเทียบกับ `iqc_theme_auto_start_hour`/
  `iqc_theme_auto_end_hour` (default 18:00–06:00 = dark) ทุก 1 นาที (`setInterval`) เผื่อเปิดหน้าค้างข้ามช่วงเวลา
- **Inline script ใน `index.html`** — apply `.dark` class ก่อน CSS/JS bundle โหลด (sync logic เดียวกับ
  ThemeContext) กัน flash-of-wrong-theme ตอนโหลดหน้าแรก — **แก้ logic ต้องแก้ทั้ง 2 ที่พร้อมกัน**
- **`ThemeToggle.jsx`** (`components/UI/`) — ปุ่มในหัวข้อ header (`AppLayout.jsx`) ให้ user เลือก Light/Dark/Auto เอง

### 25.2 ขอบเขต — Operational Dashboard ยกเว้น (ไม่ผูกกับ toggle)

`pages/Dashboard/*.jsx` (8 ไฟล์ตาม role + `shared.jsx`) ใช้ `D` token object เดิม (`dash-bg #0B1929` ฯลฯ ตาม
brand.md §13.2) เป็น **มืดถาวรเสมอ** ไม่ผูกกับ preference ของ user — เป็นการออกแบบเดิมตั้งใจ (contrast สำหรับงาน
operational) ไม่ใช่ข้อจำกัดทางเทคนิค **ห้ามแตะไฟล์กลุ่มนี้เวลาทำงาน dark-mode เพิ่มเติม**

### 25.3 Raw Tailwind color utility (badge/alert/chip สีดิบ)

- Token หลัก (§25.1) ครอบคลุมแค่ layout/card/table/form โครงสร้าง — badge/alert/chip ที่ใช้ raw palette
  (เช่น `bg-red-50 text-red-700`, `bg-purple-100 text-purple-700`) ต้องมี `dark:` variant คู่กันเสมอ
  **shade-mapping convention (แก้แล้ว Session 122 — ดู "แก้ contrast" ด้านล่าง):**
  `bg-X-50/100/200/300`→`dark:bg-X-900/800` (**solid ไม่มี opacity**), `bg-X-400`→`dark:bg-X-700`,
  `border-X-100..400`→`dark:border-X-700/600/500` (solid), `text-X-500..900`→`dark:text-X-200` (solid) —
  ตัวเลข shade 500-800 ของ `bg-`/`ring-` (ปุ่ม/solid fill ที่มี contrast กับพื้นหลังอยู่แล้ว) ไม่ต้องมี dark: variant
  - ⚠️ **ห้ามใช้ opacity บน dark: badge background อีก** (เช่น `dark:bg-red-950/40`) — Session 121 ทำแบบนี้ตอนแรก
    แล้ว user feedback ว่า "สีดูยากกว่าเดิม" เพราะพื้นหลังโปร่งแสงผสมกับพื้นเข้มของหน้าเว็บแบบคาดเดาผลไม่ได้ (มืด+มืด
    ผสมกันกลายเป็นเกือบดำ contrast ต่ำ) — Session 122 แก้เป็น **solid เต็มที่เสมอ** (ไม่มี `/NN`) + เลื่อน text
    shade ให้สว่างขึ้นอีกขั้น (300/400→200) เพื่อความชัดเจนแน่นอนไม่ขึ้นกับพื้นหลังด้านหลัง
- **ห้าม hardcode hex ใน className ใหม่** (เช่น `text-[#1F2937]`, `bg-[#F5F6F8]`) — ใช้ semantic token
  (`text-text`, `bg-bg` ฯลฯ) เสมอ เพื่อให้ได้ dark mode ฟรีโดยอัตโนมัติ (เจอไฟล์เก่าที่ hardcode ไว้ใน
  `FNCPResponse.jsx`/`ProCodeSap.jsx` แก้เป็น token แล้วใน Session 121)
- `.btn-secondary`, `.glass-card` (index.css) เดิมใช้ `bg-white` ตรงๆ — แก้เป็น `bg-surface`/
  `dark:bg-surface/95` แล้ว; ปุ่ม toggle switch (thumb วงกลมเล็ก) ยังคง `bg-white` ตรงๆ ได้ (ใช้งานบน track
  สีเข้มอยู่แล้ว ไม่ต้องปรับ)

---

## 26. กฎหน้าตาราง (Table Redesign)

**Added:** 2026-07-08 (Session 122) — ปรับ `.table`/`.table-container`/`.card` (index.css) ให้ดูเป็น panel เดียว
กับ header สีแบรนด์ (อ้างอิงจาก reference image ที่ user ส่งมา, reskin เป็นโทนกรมท่า/น้ำเงินของ Window Asia แทนสีแดง/
ส้ม/เหลืองในภาพตัวอย่าง) — เพราะเป็น shared class ที่ `<table className="table">` ใช้อยู่แล้ว 32 ไฟล์
(ผ่าน `<div className="table-container"><table className="table">`) **การแก้ที่ index.css จุดเดียวจึงกระจายไป
ทุกหน้าอัตโนมัติ ไม่ต้องแก้ทีละไฟล์**

- `.table-container`: เพิ่ม `sm:rounded-xl sm:border sm:border-border sm:shadow-sm bg-surface` (มุมโค้ง+กรอบ+เงา
  ทำให้ตารางดูเป็น panel เดียว) — คง `-mx-4 sm:mx-0` เดิมไว้เพื่อ full-bleed บนจอมือถือเล็กสุด (เผื่อบางหน้าไม่ได้
  ซ่อนด้วย `hidden md:block`)
- `.table th`: เปลี่ยนจาก `bg-bg text-muted` (จมกับพื้นหลังการ์ดในโหมดมืด) → ลองแล้ว `bg-primary text-white`
  (solid) → **สุดท้าย (ล่าสุด) `bg-blue-50 text-blue-900` / dark: `bg-blue-900 text-blue-200`** (ฟ้าอ่อนตาม
  feedback user "ปรับเป็นสีฟ้าอ่อนๆ") — เคยเพิ่ม `border-r` คั่นระหว่างคอลัมน์ตาม feedback รอบหนึ่งแล้วด้วย แต่
  user ขอเอาออกในรอบถัดมา (**ไม่มี border-r แล้ว** — อย่าเพิ่มกลับโดยไม่ถาม) — `SortTh.jsx` แก้ hover เป็น
  `hover:bg-black/5 dark:hover:bg-white/10`, ไอคอนลูกศร sort ใช้ `currentColor` (สืบสีจาก `.table th`) + toggle
  แค่ `opacity-100/40` แทนการ hardcode สีขาว/น้ำเงิน ให้ปรับตาม header color อัตโนมัติถ้าแก้สีอีกในอนาคต
  - ⚠️ **ห้ามใช้ gradient กับ `.table th`** (ลองแล้วตอนแรก `bg-gradient-to-r from-primary to-accent`, user feedback
    ว่า "หัวตารางไม่สวย") — เพราะ `.table th` apply กับ `<th>` แต่ละ cell แยกกัน ไม่ใช่ทั้งแถว `<tr>`/`<thead>`
    เดียว ทำให้แต่ละคอลัมน์วาด gradient ของตัวเองเต็ม (primary→accent) เรียงต่อกัน กลายเป็นแถบไล่สีซ้ำเป็นลายๆ
    ทีละคอลัมน์แทนที่จะเป็นแถบสีเดียวกันทั้งแถวตามที่ตั้งใจ — ใช้สีทึบ (solid) ตัวเดียวเท่านั้นกับ `.table th`
- `.table td`: เพิ่ม padding (`py-2`→`py-3`) ให้ดูโปร่งขึ้น
- `.table tbody tr`: hover เปลี่ยนจาก flat `bg-bg` เป็น `hover:bg-accent/5 dark:hover:bg-white/5` (นุ่มนวลกว่า)
- ⚠️ **specificity note**: `.table th`/`.table td` (compound selector) มี specificity สูงกว่า utility class เดี่ยว
  (เช่น `text-left`, `text-muted` ที่ใส่ตรง `<th>`) เจตนาเดิมของโค้ด (ก่อน Session 122) — ทำให้ `<th>` ที่เคยพยายาม
  set สีเอง (เช่น `IPNCRList.jsx`/`IPQCList.jsx` ที่ใช้ `className="table w-full"` + `<th className="text-muted">`)
  ถูก override เป็นสีขาว/กึ่งกลางเสมอ (ผลลัพธ์ตรงกับ design ใหม่พอดี ไม่ใช่ bug) — ตารางที่ **ไม่ได้ใช้** class
  `"table"` บน `<table>` เอง (เช่น `ProCodeSap.jsx`, `KPI/index.jsx` ใช้ `className="w-full text-small"` เอง)
  **ไม่ได้รับผลกระทบ** จากการแก้นี้เลย
- `.card`: ปรับ `rounded-lg`→`rounded-xl` ให้เข้าชุดกับตารางใหม่ (ไม่แตะ property อื่น เพราะใช้กว้างมากทั่วระบบ)
- ยังไม่ทำ: pill-badge สำหรับคอลัมน์รหัส/ID และสีเขียวสำหรับตัวเลขเงิน ตามภาพตัวอย่าง — เป็น content-specific
  ต้องทำทีละหน้า ไม่ใช่ shared class เดียวแก้ได้ครบ (นอกขอบเขตรอบนี้ ทำได้ถ้า user ต้องการเจาะจงหน้าไหน)

---

## 27. กฎ Deploy / Backup / Restore (Render + Cloudflare R2)

**Added:** 2026-07-10 — เอกสารสถาปัตยกรรมที่**มีอยู่แล้วจริงในโค้ด**จากเซสชันก่อนหน้าที่ไม่ได้ถูกบันทึกใน
DEVLOG (พบระหว่างตรวจก่อนทำ deploy redesign ตาม reference ของโปรเจกต์อื่น — ดู AUDIT.md D5 ที่แก้ไขแล้ว)
รายละเอียดขั้นตอนเต็มดู `iqc-system/DEPLOYMENT.md` §8 — ที่นี่สรุปเฉพาะกฎที่ต้องรู้ก่อนแก้โค้ดส่วนนี้

### 27.1 หลักการ — single Dockerfile ทุก environment

- `iqc-system/Dockerfile` (multi-stage: build client → build server deps → runtime) ใช้ไฟล์**เดียวกัน**
  ทั้ง local (`docker-compose.local.yml`), VPS/self-host (`docker-compose.yml`), และ Render (Docker
  runtime) — พฤติกรรมต่างกันด้วย **environment variable เท่านั้น** ห้าม fork Dockerfile
- server เสิร์ฟ SPA (`client/dist`) + API + `/uploads` จาก **origin เดียว** (single Node process) —
  ไม่มี CORS ให้ต้องแก้ระหว่าง client/server เพราะไม่ใช่ 2 service แยกกัน — **ห้ามแยกเป็น client
  service/server service คนละตัว** โดยไม่ปรึกษา user ก่อน (ขัดกับสถาปัตยกรรมนี้ที่ตั้งใจให้ง่ายกว่า)

### 27.2 Persistence — 2 โหมด สลับด้วย ENV เท่านั้น

| โหมด | ใช้เมื่อ | กลไก |
|------|---------|------|
| Persistent volume | VPS (`docker-compose.yml`)/Render Starter+ (มี Disk) | Named volume (`iqc_data`/`iqc_uploads`) mount ตรงเข้า `/data`+`/app/uploads` — ห้าม bind-mount ไฟล์เดี่ยวจาก host (ดู §27.5) |
| Restore-on-boot | Render Free (ไม่มี persistent disk) | `RESTORE_ON_BOOT=true` — ephemeral local disk + backup ต่อเนื่องขึ้น R2 + กู้กลับตอน boot |

**Restore-on-boot เป็น deliberate exception** ต่อกฎ "SQLite ต้องอยู่บน volume เท่านั้น" (§2 เดิม) — ใช้เฉพาะ
deployment ที่เลือกใช้จริง (งบ $0) ยอมรับ RPO ~10 นาที ไม่ใช่ bug

### 27.3 Boot sequence (Render Free / restore-on-boot)

```
Dockerfile CMD = node bootstrap.js
  → RESTORE_ON_BOOT=true และ DB local ว่าง/ไม่มี? → restoreService.restoreLatest()
      → เลือก candidate จาก backups/manifest.json (fallback: listObjects เรียงตาม LastModified)
      → ดาวน์โหลดไป temp path → verify ขนาดไฟล์ + PRAGMA quick_check → rename แบบ atomic เข้า IQC_DB_PATH จริง
      → verify ไม่ผ่านทุก candidate → alert Telegram (env var ตรง, ไม่พึ่ง DB) → boot ด้วย DB ว่าง (seedData เดิม)
  → require('./index.js') → initSchema/runMigrations/seedData ตามปกติ (CLAUDE.md §1 เดิม) → listen → healthy
```

- ไฟล์แนบ (uploads) **ไม่ restore ล่วงหน้าตอน boot** — ใช้ lazy fetch-through แทน (middleware `/uploads` ใน
  `index.js`: ไม่เจอไฟล์ local → ดึงจาก `backups/uploads/**` ใน R2 → cache ไว้ local → serve) กัน cold-start
  ช้าลงเรื่อยๆ ตามขนาด uploads ที่โตขึ้นตามอายุระบบ
- `runHotBackup()` ถูกเรียกอีกครั้งใน SIGTERM shutdown handler (`index.js`) ก่อน `db.close()` — ปิดช่องว่างของ
  redeploy/graceful-restart ให้เกือบ real-time ไม่ต้องรอ scheduler รอบถัดไป

### 27.4 Backup service — ทำไมไม่ใช้ Litestream

`server/lib/backupService.js` (เรียกจาก `index.js` scheduler ทุก ~10 นาที + shutdown handler + CLI
`scripts/backup-db.js`) ทำ 3 อย่างต่อรอบ (`runFullCycle`): `runHotBackup` (→ `backups/db/latest.db`,
RPO หลัก) + `runDailyFifoBackup` (→ `backups/db/day-N.db`, N=weekday Asia/Bangkok, FIFO 7 slot ธรรมชาติ
จากปฏิทิน ไม่ต้องมี counter) + `syncUploads` (incremental, เทียบ size+mtime กับ `upload-sync-state.json`
กันส่งซ้ำไฟล์ที่ไม่เปลี่ยน)

- ทุก snapshot สร้างด้วย `VACUUM INTO` (ไม่ copy ไฟล์ดิบ) + verify `PRAGMA quick_check` ก่อนเชื่อถือ —
  กัน DB ต้นทาง corrupt แล้ว backup ทับไฟล์ดีอันเก่าไปด้วย (บทเรียนจาก DEVLOG Session 119)
- เลือกไม่ใช้ Litestream (WAL-streaming ต่อเนื่อง) เพราะ: (1) ไม่ต้องเพิ่ม sidecar binary/dependency ใหม่
  เข้า image, (2) snapshot ที่ verify แล้วเชื่อถือได้มากกว่า WAL replica ดิบที่ยังไม่ผ่าน integrity check,
  (3) เข้ากับโมเดล single-connection ของ `db/database.js` เดิมโดยไม่ต้องเปลี่ยนอะไร
- R2 ไม่ได้ตั้งค่า (env ขาด) → **ไม่ fail เงียบ** — เตือนทั้ง console (ทุกรอบ) และ Telegram (ครั้งเดียวต่อ
  process กัน spam) ผ่าน `sendEnvTelegram`/`warnNotConfigured` — เพราะ silent no-backup อันตรายกว่าการแจ้งเตือนถี่

### 27.5 ⚠️ ห้าม bind-mount ไฟล์ SQLite เดี่ยวจาก Windows host เข้า container

**บทเรียนจริง (DEVLOG Session 119):** `iqc.db` corrupt ซ้ำ 3 ครั้ง (2026-06-25/07-01/07-08) จาก
`docker-compose.local.yml` เดิมที่ bind-mount `./iqc.db:/data/iqc.db` ตรงจาก Windows host เข้า container —
SQLite WAL mode พึ่ง shared-memory mmap (`-shm`/`-wal`) + byte-range lock ซึ่ง Docker Desktop's
Windows↔Linux file-sharing layer ไม่รองรับ semantics นี้สมบูรณ์ **แก้แล้ว (2026-07-10):**
`docker-compose.local.yml` เปลี่ยนไปใช้ named volume (`iqc_local_data`/`iqc_local_uploads`, DB แยก/seed
ใหม่ทุกครั้ง — ใช้ตรวจ image ก่อน deploy เท่านั้น ไม่ใช่ DB dev จริง) — ทดสอบมือถือด้วยข้อมูล dev จริงให้ใช้
`npm run dev` แทน (`client/vite.config.js` ตั้ง `server.host: true` ไว้แล้ว ให้ Vite bind `0.0.0.0`, Express
bind 0.0.0.0 อยู่แล้วโดย default) — **ห้ามย้อนกลับไป bind-mount ไฟล์ DB เดี่ยวจาก host เข้า container บน
Windows อีกโดยไม่ปรึกษา user**

### 27.6 Env vars ที่เกี่ยวข้อง (ดู `.env.production.example` เป็นแหล่งจริง)

`RESTORE_ON_BOOT`, `R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET`,
`TELEGRAM_BOOT_ALERT_TOKEN`/`TELEGRAM_BOOT_ALERT_CHAT_ID` — ทุกตัวเป็น **optional/feature เสริม** ระบบต้อง
boot ได้ปกติแม้ไม่ได้ตั้งค่าอะไรเลย (เหมือน `SETTINGS_ENCRYPTION_KEY` ใน §24) มีแค่ `JWT_SECRET` เท่านั้นที่
fail-fast ตอน production boot
