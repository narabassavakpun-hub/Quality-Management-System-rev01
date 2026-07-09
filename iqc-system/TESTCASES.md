> ⚠️ **DEPRECATED (2026-07-02)** — รวมเข้า [`../testcase.md`](../testcase.md) แล้ว เก็บไว้เป็นประวัติ

# TESTCASES.md — IQC System

> วันที่: 2026-06-19
> ขอบเขต: Unit / Integration / API / UI / Security / Edge / Regression — มี Expected Result ทุกข้อ
> สถานะปัจจุบัน: **โปรเจกต์ยังไม่มี test ใด ๆ** (ไม่มี test runner/ไฟล์) — เอกสารนี้คือ test plan ตั้งต้น
> Stack แนะนำ: **Vitest** (unit/integration ทั้ง client+server), **Supertest** (API), **Playwright** (E2E/UI), seed ผ่าน `npm run clear-db:force`

รหัสอ้างอิงปัญหา (Cx/Hx/Mx) ดูใน [DEVMORE.md](DEVMORE.md)

---

## 0. Test Setup / Strategy

| ระดับ | เครื่องมือ | ขอบเขต | Mock |
|---|---|---|---|
| Unit | Vitest | helper บริสุทธิ์: `haversine`, `parseBool`, AQL lookup, sequence format, `esc()` | ไม่ต้อง |
| Integration (DB) | Vitest + better-sqlite3 (DB ชั่วคราว `:memory:`/temp file) | transaction, optimistic lock, migration, sequence race | DB จริง in-memory |
| API | Supertest + Express app | ทุก route + auth + role + validation | `sendTelegram`/`fetch` ต้อง mock |
| UI/E2E | Playwright | login, สร้างบิล, NCR flow, ลงนาม UAI, supplier respond | network จริง local |
| Security | Vitest/Playwright + payload list | XSS, upload, authz, rate limit | — |

**Mock strategy:** `node-fetch` (Telegram) ต้อง mock เสมอ; เวลา/`Date.now` ใช้ fake timers สำหรับ token expiry; geolocation ใช้ Playwright `context.setGeolocation`.

---

## 1. Unit Test Cases

| ID | ฟังก์ชัน/จุด | Input | Expected Result |
|---|---|---|---|
| U-01 | `haversine` (attendance.js) | (13.736,100.523)→(13.736,100.523) | ระยะ = 0 (±0.5 m) |
| U-02 | `haversine` | 2 จุดห่างจริง ~200 m | คืนค่า 195–205 m |
| U-03 | `parseBool` (master.js) | 'ใช่' / 'yes' / '1' / 'true' / 'Y' | `true` ทุกตัว |
| U-04 | `parseBool` | '' / 'no' / undefined / 'ไม่' | `false` ทุกตัว |
| U-05 | sequence format | doc='NCR', year=2026, seq=1 | `'NCR-2026-0001'` (pad 4 หลัก) |
| U-06 | sequence format | seq=12345 | `'NCR-2026-12345'` (ไม่ตัด) |
| U-07 | AQL grade (master.js eval) | avg=92 / 80 / 65 / 50 | `'A' / 'B' / 'C' / 'D'` |
| U-08 | AQL lookup FULL | inspection_level='FULL', qty=37 | `sample_size=37, accept=0, reject=1, is_full_inspection=true` |
| U-09 | AQL lookup GEN_II/2.5 | qty=100 | คืน row ที่ batch_from≤100≤batch_to (sample 20, ac1/re2) |
| U-10 | AQL lookup ไม่พบช่วง | level ที่ไม่มี seed | `sample_size=null` (ไม่ throw) |
| U-11 | `esc()` (หลังแก้ C1) | `'<img onerror=x>'` | `'&lt;img onerror=x&gt;'` |
| U-12 | `safeSig()` (หลังแก้ C1) | `'data:image/png;base64,AAAA'` / `'"><script>'` | คืนค่าเดิม / คืน `''` |
| U-13 | `statusLabel` (exports.js) | 'pending_supplier' / 'unknown_x' | `'รอ Supplier'` / `'unknown_x'` (fallback) |
| U-14 | `getKeysFromLink` (useSSE) | `'/ncr/55'` | มี `['ncrs']` และ `['ncr','55']` |

---

## 2. Integration Test Cases (DB / Transaction / Migration)

| ID | สถานการณ์ | ขั้นตอน | Expected Result |
|---|---|---|---|
| I-01 | Sequence race-safe | เรียก `nextNCRCode()` 100 ครั้งพร้อมกัน (loop sync) | ได้รหัส **ไม่ซ้ำ** 100 ค่า, last_seq=100 |
| I-02 | Sequence reset ข้ามปี | ตั้ง year ใน document_sequences เป็นปีก่อน แล้วเรียก | seq กลับเป็น 0001 + year อัปเดต |
| I-03 | Bill approve optimistic lock | 2 transaction approve bill เดียว (pending_approval) | สำเร็จ 1, อีกอันได้ error 'เอกสารถูกดำเนินการแล้ว' (changes=0) |
| I-04 | NCR transition lock | approve NCR pending_supervisor 2 ครั้งซ้อน | สำเร็จ 1 ครั้ง, status=pending_manager ครั้งเดียว |
| I-05 | request-uai race (H7) | purchasing 2 คนขอ UAI จาก NCR เดียว (pending_supplier) | **หลังแก้:** สร้าง UAI ใบเดียว / **ก่อนแก้:** ทดสอบ reproduce 2 ใบ (regression guard) |
| I-06 | supplier_responses supersede | สร้าง response → resubmit-to-supplier → supplier ตอบใหม่ | response เก่ามี `superseded_at`, query active คืนใบล่าสุดใบเดียว |
| I-07 | FK RESTRICT | ลบ supplier ที่มี product ชี้อยู่ | throw FK constraint (ห้ามลบ) → ใช้ soft delete `is_active=0` |
| I-08 | audit ใน transaction | สร้าง bill (transaction rollback กลางคัน) | ไม่มี row ใน bills **และ** ไม่มี audit_log (atomic) |
| I-09 | Migration idempotent | รัน `initSchema→runMigrations→migrateNcr*` ซ้ำ 2 รอบ | ไม่ error, ไม่มี `ncrs_old` ค้าง, จำนวนคอลัมน์คงที่ |
| I-10 | Migration crash recovery (H4) | จำลอง throw หลัง RENAME | rollback คืน `ncrs` (ไม่เหลือ ncrs_old) — ถ้าไม่คืน = ยืนยันบั๊ก |
| I-11 | Drawing revision | อัปโหลด drawing ใหม่ทับของเดิม | เดิม `is_current=0`+`obsoleted_at` set, ใหม่ `is_current=1` (unique current) |
| I-12 | Excel import transaction | import 3 แถว แถวที่ 3 ชน UNIQUE | rollback ทั้งหมด, ไม่มีสินค้าใหม่ถูกเพิ่ม |
| I-13 | Notification archiving (M10, หลังทำ) | สร้าง notif read เก่ากว่า 180 วัน + รัน job | ลบเฉพาะ read+เก่า, ของใหม่/unread คงอยู่ |

---

## 3. API Test Cases

### 3.1 Auth
| ID | Request | Expected |
|---|---|---|
| A-01 | POST /auth/login รหัสถูก | 200 + set-cookie `token` (httpOnly), body มี role |
| A-02 | POST /auth/login รหัสผิด | 401 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง...' |
| A-03 | POST /auth/login user `is_active=0` | 401 (filter ที่ query) |
| A-04 | login ผิด 6 ครั้งติด (username เดียว) | ครั้งที่ 6 = 429 'ลองใหม่ได้ใน 15 นาที' |
| A-05 | login สำเร็จไม่กิน quota | login ถูก 10 ครั้ง ไม่โดน 429 (`skipSuccessfulRequests`) |
| A-06 | เรียก protected ไม่มี cookie | 401 'กรุณาเข้าสู่ระบบ' |
| A-07 | login เครื่อง B แล้วใช้ token เครื่อง A | เครื่อง A ได้ 401 'เข้าสู่ระบบจากอุปกรณ์อื่น' (session_token) |
| A-08 | change-password รหัสเดิมผิด | 401 'รหัสผ่านเดิมไม่ถูกต้อง' |
| A-09 | change-password ใหม่ < 8 ตัว | 400 'อย่างน้อย 8 ตัวอักษร' |
| A-10 (H8) | login สำเร็จ/ล้มเหลว | **หลังแก้:** มี audit_log `LOGIN`/`LOGIN_FAILED` |

### 3.2 Bills
| ID | Request | Expected |
|---|---|---|
| B-01 | POST /bills role=qc_supervisor | 403 'ไม่มีสิทธิ์เข้าถึง' (requireRole qc_staff) |
| B-02 | POST /bills ขาด invoice_no | 400 'กรุณากรอกข้อมูลที่จำเป็น...' |
| B-03 | POST /bills supplier=blacklisted | 400 'Supplier นี้มีสถานะ blacklisted...' |
| B-04 | POST item expiry < received | 400 'วันหมดอายุต้องไม่ก่อนวันที่รับ...' |
| B-05 (M1) | PATCH item เป็น expiry < received | **หลังแก้:** 400 เช่นเดียวกับ POST (ปัจจุบันผ่าน = บั๊ก) |
| B-06 | submit bill ที่ไม่มี item | 400 'เพิ่มรายการสินค้าอย่างน้อย 1' |
| B-07 | submit item qty_failed>0 ไม่มีรูป | 400 'ยังไม่มีรูปภาพปัญหา' |
| B-08 | approve bill ที่ status≠pending_approval | 400 'บิลนี้ไม่ได้รออนุมัติ' |
| B-09 | PATCH bill ของผู้อื่น | 403 'ไม่มีสิทธิ์แก้ไขบิลของผู้อื่น' |
| B-10 | DELETE bill ที่มี NCR ผูก | 400 'ไม่สามารถลบบิลที่มี NCR ผูกอยู่' |
| B-11 (M5) | POST item qty_passed+qty_failed≠qty_sampled | **หลังแก้:** 400 validation qty |

### 3.3 NCR / UAI
| ID | Request | Expected |
|---|---|---|
| N-01 | POST /ncr severity ว่าง | 400 'กรุณาระบุ bill_id, severity...' |
| N-02 | POST /ncr bill_item ที่อยู่ใน NCR อื่นแล้ว | 400 'ถูก include ใน NCR อื่นแล้ว: NCR-...' |
| N-03 | POST /ncr severity=minor | สร้าง NCP code, `supplier_token=null` |
| N-04 | approve โดย role ผิดขั้น | 403 'ไม่มีสิทธิ์อนุมัติขั้นตอนนี้' |
| N-05 | approve pending_manager ไม่มี disposition | 400 'กรุณาระบุ disposition ก่อนอนุมัติ' |
| N-06 | purchasing-review status≠pending_purchasing_review | 400 |
| N-07 | UAI sign โดย role ที่ไม่ใช่คิว | 403 'ไม่ใช่คิวของคุณในการลงนาม' |
| N-08 | UAI sign จนครบ qmr_ack | status=`uai_completed` + NCR ที่อ้างอิง status=`closed` + `uai_close_remark` set |
| N-09 | reject-exec (cco) ไม่กรอกเหตุผล | 400 'กรุณากรอกเหตุผลการปฏิเสธ' |
| N-10 | regenerate-token | คืน token 64-char hex ใหม่ + expires_at อนาคต |
| N-11 | export NCR PDF เกิน 5 ครั้ง/นาที | ครั้งที่ 6 = 429 (pdfRateLimit) |

### 3.4 Supplier (Public)
| ID | Request | Expected |
|---|---|---|
| S-01 | GET /supplier/ncr/<token ผิด> | 404 'ไม่พบเอกสาร NCR' |
| S-02 | GET token หมดอายุ | 403 'ลิ้งค์หมดอายุแล้ว...' |
| S-03 | GET NCR status≠pending_supplier | 400 'ไม่ได้อยู่ในสถานะรอ Supplier ตอบกลับ' |
| S-04 | POST respond ขาด respondent_name | 400 'กรุณากรอกชื่อผู้ตอบ' |
| S-05 | POST respond ซ้ำ (มี response แล้ว) | 400 'ส่งคำตอบแล้ว ไม่สามารถส่งซ้ำได้' |
| S-06 | POST respond สำเร็จ | 200, NCR → pending_manager_review, notify qc_manager |
| S-07 (H2) | ยิง /api/supplier > 30 ครั้ง/นาที | **หลังแก้:** 429 (ปัจจุบันไม่จำกัด = บั๊ก) |

### 3.5 Master / Reports / Admin
| ID | Request | Expected |
|---|---|---|
| M-01 | POST /master/suppliers role≠admin | 403 |
| M-02 | products import preview=1 มี error | 200 + `errorCount>0`, **ไม่** insert |
| M-03 | products import จริงมี error | 400 'มีข้อมูลที่ไม่ถูกต้อง...' |
| M-04 | products import supplier ไม่มีในระบบ | row error 'ไม่พบ Supplier "X"' |
| M-05 | reports/* role=qc_staff | 403 (REPORT_ROLES) |
| M-06 (H3) | GET /admin/settings/telegram | **หลังแก้:** response **ไม่มี** `telegram_bot_token` (มีแต่ masked) |
| M-07 | GET /admin/audit-logs | paginate (data/total/limit/offset) |

---

## 4. UI / E2E Test Cases (Playwright)

| ID | Flow | Expected |
|---|---|---|
| E-01 | Login ผิด → ขึ้น error → ถูก → ไป Dashboard | error แดงแสดง, สำเร็จ redirect '/' |
| E-02 | qc_staff สร้างบิล + item + submit | บิลขึ้นสถานะ 'รออนุมัติ' |
| E-03 | qc_supervisor approve บิล | สถานะ 'อนุมัติแล้ว', qc_staff ได้ notification (กระดิ่ง) |
| E-04 | NCR flow ครบ (staff→supervisor→manager+disposition→qmr→purchasing→supplier→manager→qmr close) | จบที่ 'ปิดแล้ว', timeline ครบทุกขั้น |
| E-05 | Supplier เปิด link ตอบ NCR (no login) | ฟอร์มแสดง 2 ภาษา, ส่งแล้วขึ้น 'ส่งคำตอบเรียบร้อย' |
| E-06 | UAI ลงนามด้วย signature pad (mobile route) | ลายเซ็นบันทึก, ไปขั้นถัดไป |
| E-07 | Role ไม่มีสิทธิ์เข้า /master ตรง URL | redirect '/' (ProtectedRoute) |
| E-08 | SSE realtime | เปิด 2 เบราว์เซอร์, สร้าง NCR ใน A → กระดิ่ง B เด้งโดยไม่ refresh |
| E-09 | QC check-in นอก geofence | 400 'อยู่นอกเขตโรงงาน (ห่าง X เมตร)' |
| E-10 | QC check-in ในเขต | สำเร็จ, my-status `checked_in=true` |
| E-11 (H6) | เปิดทิ้งไว้ 30 นาที | **หลังแก้:** popup เตือน 2 นาที → auto logout ไป /login |
| E-12 (M8) | กรอกบิลครึ่งทาง ปิดแท็บ เปิดใหม่ | **หลังแก้:** ถาม restore draft จาก sessionStorage |
| E-13 | Excel: export products → แก้ไข → import | dropdown ใน Reference sheet ใช้ได้, import preview ตรง, สำเร็จเพิ่มข้อมูล |
| E-14 | Mobile bottom nav + responsive | < lg แสดง BottomNav, ปุ่ม/อินพุตสูง ≥ 44px |

---

## 5. Security Test Cases

| ID | การโจมตี | วิธีทดสอบ | Expected (หลังแก้) |
|---|---|---|---|
| SEC-01 (C1) | Stored XSS ผ่าน PDF | supplier respond `root_cause = '<img src=x onerror=alert(1)>'` → export NCR PDF | ค่าถูก escape เป็นข้อความ, ไม่มี element รัน, ไม่มี outbound request |
| SEC-02 (C1) | SSRF ผ่าน PDF | ใส่ `<img src="http://127.0.0.1:3001/api/admin/users">` ในฟิลด์ supplier → export | renderer ปิด network / ไม่โหลด resource ภายนอก |
| SEC-03 (C3) | Upload HTML/SVG ปลอม mimetype | POST รูปที่ content เป็น `<svg onload=...>` แต่ส่ง mimetype `image/png` | 400 (magic number ไม่ผ่าน) — ไฟล์ไม่ถูกเซฟ |
| SEC-04 (C3) | เข้าถึงไฟล์โดยไม่ login | GET `/uploads/ncr/<file>` โดยไม่มี cookie | **หลังแก้:** 401/403 หรือบังคับ download (ไม่ execute) |
| SEC-05 (C2) | JWT secret default | ตั้ง NODE_ENV=production + secret default แล้วบูต | server **fail-fast** ไม่ start |
| SEC-06 (H1) | Cookie ไม่มี secure | ตรวจ set-cookie ตอน NODE_ENV=production | มี `Secure; HttpOnly; SameSite=Strict` |
| SEC-07 | SQL Injection | login username `' OR '1'='1`; bills `?q=%' OR 1=1--` | ไม่ bypass (parameterized) — คืนผลปกติ/ว่าง |
| SEC-08 | IDOR | qc_staff PATCH bill ของคนอื่น (B-09) | 403 |
| SEC-09 | IDOR Issue Talk | user ที่ไม่ใช่ creator/participant GET /issue-talk/:id | 403 'ไม่มีสิทธิ์เข้าถึง' |
| SEC-10 (M9) | Token leak scope | role ที่ไม่ใช่ purchasing GET /ncr/:id | **หลังแก้:** response ไม่มี `supplier_token`/`supplier_link` |
| SEC-11 | Privilege escalation | สร้าง user role=`superadmin` (ไม่อยู่ใน CHECK) | 400/500 จาก CHECK constraint role |
| SEC-12 | CSRF | ส่ง POST จาก origin อื่นพร้อม cookie | ถูกบล็อก (sameSite=strict ไม่แนบ cookie) |
| SEC-13 | Mass upload DoS | ยิง /supplier respond แนบไฟล์รัว ๆ | **หลังแก้:** 429 rate limit |
| SEC-14 | Geofence spoof | check-in ส่ง lat/lon ปลอมในเขต | สำเร็จได้ (จำกัดของ GPS) — แต่ตรวจ server-side ทำงาน (นอกเขต = บล็อก) |

---

## 6. Edge Cases

| ID | Edge | Expected |
|---|---|---|
| ED-01 | Sequence ข้ามปีตอนเที่ยงคืน 31 ธ.ค. → 1 ม.ค. | รหัสปีใหม่เริ่ม 0001 ไม่ชนปีเก่า |
| ED-02 | NCR ที่ supplier_token=null (NCP) เปิด /supplier/ncr/null | 404 (ไม่ match) |
| ED-03 | token expiry = พอดี now | ถือว่าหมดอายุ (`< new Date()`) → 403 |
| ED-04 | bill item qty ติดลบ / qty_sampled > qty_received | **หลังแก้ M5:** 400 |
| ED-05 | upload 0 ไฟล์ ไปยัง endpoint images | 400 'กรุณาเลือกไฟล์' |
| ED-06 | ไฟล์เกิน limit (รูป > 30MB) | 400 'ไฟล์มีขนาดใหญ่เกินไป (สูงสุด ... MB)' |
| ED-07 | Excel import sheet ผิดชื่อ | fallback worksheets[0] หรือ 400 'ไม่พบ Sheet' |
| ED-08 | Excel import ไฟล์ว่าง/ไม่ใช่ .xlsx | 400 'ไฟล์ไม่ถูกต้อง' |
| ED-09 | delivery ลบหลังเลยเวลาส่ง | 400 'ไม่สามารถลบรายการที่เลยเวลาส่ง...' |
| ED-10 | Telegram ส่งไม่ได้ (token ว่าง/เน็ตล่ม) | flow ดำเนินต่อ ไม่ crash (log error) |
| ED-11 | re-inspection round > 3 | บันทึกได้ + notify QMR 'ตรวจซ้ำมากกว่า 3 ครั้ง' |
| ED-12 | concurrent SSE: user login 2 แท็บ | ทั้ง 2 รับ event (หรือยอมรับ override — ดู M12) |
| ED-13 | expiry_date = received_date (เท่ากันพอดี) | ผ่าน (เงื่อนไขเป็น `<` ไม่ใช่ `<=`) |
| ED-14 | unicode/emoji ในชื่อสินค้า/หมายเหตุ | บันทึก/แสดง/export ได้ถูกต้อง (UTF-8) |

---

## 7. Regression Test Suite (รันทุก release)

| ID | สิ่งที่ป้องกันการถดถอย | อ้างอิง |
|---|---|---|
| R-01 | NCR full flow 9 สถานะจบที่ closed | E-04 |
| R-02 | NCP (minor) flow ปิดที่ supervisor → ncp_closed | N-03 + approve |
| R-03 | UAI 7 ลายเซ็น → uai_completed → ปิด NCR | N-08 |
| R-04 | Optimistic lock กัน double-approve ทุกเอกสาร | I-03, I-04, I-05 |
| R-05 | Migration idempotent + ไม่เหลือ ncrs_old | I-09, I-10 |
| R-06 | Sequence ไม่ซ้ำภายใต้ concurrency | I-01 |
| R-07 | Role matrix: ทุก role เข้าได้เฉพาะที่ควร (ตาราง CLAUDE.md 11) | A-01, M-01, M-05, E-07 |
| R-08 | Excel import/export ครบ 6 master + preview/insert | E-13, M-02..04 |
| R-09 | Supplier respond + supersede + resubmit | S-06, I-06 |
| R-10 | Security baseline: SEC-01..06 ผ่าน | §5 |

---

## 8. Coverage Goal & ลำดับการเขียนเทสต์

**เป้า coverage:** business logic (transactions.js หลัง refactor, sequences, state machine) ≥ 80%, route handler ≥ 60%

**ลำดับแนะนำ:**
1. **Security suite ก่อน (SEC-01..06)** — ผูกกับ hotfix Sprint 1, เป็น gate ก่อน prod
2. Integration: optimistic lock + sequence + migration (I-01..10) — กันหนี้ TD-1 ถดถอย
3. API smoke: auth + NCR/UAI happy path + role guard
4. E2E: 3 flow หลัก (บิล, NCR, UAI) + supplier respond
5. Unit: helper ล้วน (เขียนเร็ว, คุ้ม)

**CI:** รัน unit+integration+API ทุก PR; E2E nightly; block merge ถ้า security suite แดง
