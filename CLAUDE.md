# CLAUDE.md — กฎเหล็กสำหรับ IQC System

**Updated:** 2026-06-16

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
- ✅ รวม transaction ทั้งหมดไว้ใน `server/db/transactions.js`

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
pending_purchasing_review   → Purchasing รับทราบ + Review + Copy Link
pending_supplier            → Supplier ตอบกลับ (respondent_name บังคับ)
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
│   │   └── Dashboard/   (index.jsx)
│   ├── components/
│   │   ├── Layout/      (AppLayout, Sidebar, BottomNav)
│   │   ├── UI/          (Badge, Button, Modal, ConfirmDialog, FilterBar,
│   │   │                 MultiSelect, SummaryCard, ToggleSwitch, SortTh, ProcessingToast)
│   │   └── Signature/   (SignatureCanvas.jsx)
│   ├── contexts/        (AuthContext.jsx, ProcessingContext.jsx)
│   ├── hooks/           (useNotifications.js, useSortable.js)
│   └── utils/           (api.js, rolePermissions.js)
├── server/
│   ├── routes/          (auth, bills, ncr, supplier, uai, notifications, reports, delivery, exports)
│   ├── middleware/       (auth.js, requireRole.js, upload.js)
│   ├── db/              (schema.sql, database.js, transactions.js, sequences.js, audit.js)
│   └── index.js         (port 3001)
└── uploads/             (bills, bill-items, inspection-docs, drawings, ncr, general)
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

- **หลัก:** IBM Plex Sans Thai | **ตัวเลข/รหัส:** IBM Plex Mono
- h1=24px h2=20px h3=16px body=14px small=12px
- Mobile: Bottom Nav, padding 16px
- Tablet: Sidebar collapsible
- Desktop: Sidebar 240px fixed, padding 24px
- ปุ่มและ Input สูงอย่างน้อย **44px**

---

## 11. Role Matrix (สรุป)

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

**Telegram กลุ่ม QC:** บิลใหม่, NCR ทุกขั้น, UAI QC steps, Delivery ทุก event  
**Telegram กลุ่มจัดซื้อ:** NCR+link, UAI purchasing steps, QC acknowledge delivery

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
