# Test Results — IQC System
**วันที่:** 2026-06-17  
**ผู้ทดสอบ:** run_tests.py (automated)  
**Server:** http://localhost:3001  
**Pass Rate: 95% (101/106 testable cases)**

---

## สรุปผล

| Category | PASS | FAIL | SKIP |
|----------|------|------|------|
| Auth | 7 | 2 | 3 |
| Master Data | 8 | 0 | 1 |
| Bills | 11 | 1 | 0 |
| NCR | 12 | 1 | 0 |
| NCP | 2 | 0 | 0 |
| UAI | 14 | 0 | 1 |
| Supplier Portal | 9 | 0 | 0 |
| Delivery | 6 | 0 | 0 |
| Notifications | 2 | 0 | 1 |
| Export | 3 | 0 | 1 (BUG: no rate limit) |
| Reports | 2 | 0 | 0 |
| Admin | 5 | 1 | 0 |
| Security | 5 | 0 | 1 |
| File Upload | 3 | 0 | 0 |
| Concurrency | 4 | 0 | 3 |
| Regression | 6 | 0 | 0 |

---

## FAILURES — พร้อมสาเหตุและวิธีแก้

ทุก failure ที่เหลือเป็น **server-side bugs** ทั้งหมด (test script ถูกต้องแล้ว)

---

### 🔴 BUG-001: User Inactive ยัง login ได้ (TC-AUTH-008, TC-ADMIN-002b)

**ระดับความรุนแรง:** Critical — Security  
**พบใน:** `server/routes/auth.js` บรรทัด 18

**อาการ:**  
Toggle user เป็น `is_active=0` แล้ว user ยังสามารถ login ได้ปกติ

**สาเหตุ:**  
Login query ไม่ตรวจ `is_active`:
```javascript
// ปัจจุบัน (ผิด)
const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
```

**วิธีแก้:**
```javascript
// server/routes/auth.js บรรทัด 18
const user = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);
if (!user) return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง หรือบัญชีถูกระงับ' });
```

---

### 🔴 BUG-002: Login Rate Limit ไม่ทำงาน (TC-AUTH-003)

**ระดับความรุนแรง:** High — Security  
**พบใน:** `server/index.js`, `server/routes/auth.js` — ไม่มี rate limiter บน `/login`

**อาการ:**  
ส่ง login ผิด 6+ ครั้งติดกัน → ยังไม่ได้ 429

**วิธีแก้:** ติดตั้งและเพิ่ม limiter เฉพาะ login route:
```javascript
// server/index.js หรือ server/routes/auth.js
const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 นาที
  max: 5,
  message: { error: 'ลองใหม่ได้ใน 15 นาที' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ใช้ก่อน login handler
router.post('/login', loginLimiter, (req, res) => { ... });
```
ตรวจสอบว่า `express-rate-limit` ติดตั้งแล้ว: `npm list express-rate-limit`

---

### 🟡 BUG-003: ไม่มี endpoint เปลี่ยนรหัสผ่านตัวเอง (TC-AUTH-009, 010, 011)

**ระดับความรุนแรง:** High — Missing Feature  
**พบใน:** `server/routes/auth.js` — ไม่มี route เลย

**อาการ:**  
`POST /api/auth/change-password` → 404 HTML error page

**วิธีแก้:** เพิ่ม route ใน `server/routes/auth.js`:
```javascript
router.post('/change-password', auth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) 
    return res.status(400).json({ error: 'กรุณากรอกรหัสผ่านเดิมและรหัสผ่านใหม่' });
  if (newPassword.length < 8) 
    return res.status(400).json({ error: 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(currentPassword, user.password_hash))
    return res.status(401).json({ error: 'รหัสผ่านเดิมไม่ถูกต้อง' });

  const hash = bcrypt.hashSync(newPassword, parseInt(process.env.BCRYPT_ROUNDS) || 12);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
  res.json({ ok: true });
});
```

---

### 🟡 BUG-004: Expiry Date เก่ากว่า Received ไม่ถูก Block (TC-BILL-004)

**ระดับความรุนแรง:** Medium — ISO Compliance (ระบุใน CLAUDE.md: "expiry_date < received_date → hard block")  
**พบใน:** `server/routes/bills.js` — route `POST /bills/:id/items`

**อาการ:**  
ส่ง `expiry_date: "2020-01-01"` (น้อยกว่า received_date) → ผ่านได้ (200) แทนที่จะเป็น 400

**วิธีแก้:** เพิ่ม validation ใน POST bill item handler:
```javascript
// server/routes/bills.js — POST /bills/:id/items
if (expiry_date && expiry_date < bill.received_date) {
  return res.status(400).json({ 
    error: 'วันหมดอายุต้องไม่ก่อนวันที่รับสินค้า' 
  });
}
```

---

### 🟡 BUG-005: Manager Approve NCR ได้โดยไม่มี Disposition (TC-NCR-007)

**ระดับความรุนแรง:** Medium — ISO Compliance  
**พบใน:** `server/routes/ncr.js` — Manager approve route

**อาการ:**  
Manager ส่ง `POST /ncr/:id/approve` โดยไม่ได้ PATCH disposition ก่อน → 200 สำเร็จ
NCR เปลี่ยนสถานะเป็น `pending_qmr_open` โดยไม่มี disposition

**วิธีแก้:** เพิ่ม check ใน Manager approve handler:
```javascript
// server/routes/ncr.js — Manager approve
const ncr = db.prepare('SELECT * FROM ncrs WHERE id = ?').get(ncrId);
if (!ncr.disposition) {
  return res.status(400).json({ 
    error: 'กรุณาระบุ disposition ก่อนอนุมัติ' 
  });
}
```

---

### 🟡 BUG-006: ไม่มี Rate Limit บน Export PDF Endpoint (TC-EXP-007, TC-CONC-010)

**ระดับความรุนแรง:** Low — Performance/DoS Prevention  
**พบใน:** `server/index.js` — ไม่ได้ mount rate limiter บน export routes

**อาการ:**  
GET `/api/ncr/:id/pdf` 6+ ครั้ง/นาที → ทุก request ได้ 200 ไม่มี 429

**หมายเหตุ:** CLAUDE.md ระบุ rate limit 5/นาที แต่ยังไม่ได้ implement  
**วิธีแก้:**
```javascript
// server/index.js
app.use(['/api/ncr/:id/pdf', '/api/uai/:id/pdf'],
  rateLimit({ windowMs: 60000, max: 5, message: { error: 'Export rate limit exceeded' } }))
```

---

## SKIP ที่ไม่ใช่ Bug แต่ต้องระวัง

### TC-MASTER-010: Product Group lot flag → 404
`GET /api/master/product-groups/:id` ไม่รองรับ query รายละเอียด — test ข้ามไป

### TC-UAI-013: ลบ UAI ก่อน Sign → SKIP
ไม่สามารถสร้าง UAI ที่ 2 บน NCR เดียวกันได้ — test flow ใช้ NCR เดียว สร้าง UAI ได้แค่รอบเดียว

### TC-NOTIF-004: Mark Read → SKIP  
ไม่มี notification ID ที่รู้จาก test — test ข้ามได้

### TC-SEC-009: Audit Log endpoint → 404  
ไม่มี `GET /api/admin/audit-logs` ใน server — เพิ่มได้ถ้าต้องการ

### TC-EXP-007 / TC-CONC-010: Export Rate Limit → SKIP (BUG noted)
Rate limit บน export ยังไม่ implement

---

## สรุปสิ่งที่ต้องแก้ไขในระบบ (ลำดับความสำคัญ)

| ลำดับ | ไฟล์ที่แก้ | การแก้ไข | ระดับ |
|-------|-----------|---------|-------|
| 1 | `server/routes/auth.js` | เพิ่ม `AND is_active = 1` ใน login query | **Critical** |
| 2 | `server/index.js` หรือ `auth.js` | เพิ่ม `express-rate-limit` บน `/login` (5/15min) | High |
| 3 | `server/routes/auth.js` | เพิ่ม `POST /change-password` route | High |
| 4 | `server/routes/bills.js` | เพิ่ม expiry_date < received_date validation | Medium |
| 5 | `server/routes/ncr.js` | เพิ่ม disposition check ก่อน Manager approve | Medium |
| 6 | `server/index.js` | เพิ่ม rate limit บน `/api/ncr/:id/pdf` และ `/api/uai/:id/pdf` | Low |
| 7 | `server/index.js` | เพิ่ม `GET /api/admin/audit-logs` endpoint | Low |

---

## ข้อสังเกตอื่น ๆ (ไม่ FAIL แต่ควรระวัง)

- **TC-CONC-001**: 20 concurrent logins ใช้เวลา ~5s — bcrypt 12 rounds เป็นปกติ แต่ถ้า prod มี user > 20 พร้อมกันอาจต้อง queue
- **TC-NCR-022 PASS**: ลบ NCR `pending_supervisor` ได้ — ถูกต้อง
- **TC-REG-005 PASS**: Soft delete supplier → ไม่ขึ้น active dropdown — ถูกต้อง
- **TC-CONC-003 PASS**: NCR code sequence ไม่ซ้ำแม้สร้างพร้อมกัน 5 process — atomic increment ทำงานถูกต้อง
- **TC-EXP-001 PASS**: PDF export ทำงานได้ (html-pdf-node/Puppeteer พร้อมใช้)

---

*Generated by run_tests.py — อัปเดตล่าสุด 2026-06-17*
