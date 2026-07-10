# AUDIT.md — Enterprise Audit & Refactor Analysis

**ระบบ:** IQC / Quality Management System rev01
**วันที่ตรวจ:** 2026‑07‑02 · **ผู้ตรวจ:** Enterprise Review (AI, จาก source code จริง)
**สถานะโค้ด ณ วันตรวจ:** DEVLOG Session 85 (2026‑07‑01) · Git branch `main`

> เอกสารนี้เป็น **แหล่งความจริงกลาง (source of truth)** ของผลวิเคราะห์ทั้งระบบ
> ไฟล์อื่น (CLAUDE.md / prd.md / design‑dashboard.md / testcase.md) อ้างอิงข้อสรุปจากที่นี่
> ทุกข้อความอิงจากการอ่าน source code จริง — ส่วนที่เป็นการคาดการณ์กำกับด้วย **(ข้อสันนิษฐาน)**

---

## สารบัญ

1. [Executive Summary](#1-executive-summary)
2. [Architecture](#2-architecture)
3. [Business Logic รายโมดูล](#3-business-logic-รายโมดูล)
4. [Workflow & State Machines](#4-workflow--state-machines)
5. [Database](#5-database)
6. [API](#6-api)
7. [Security (OWASP‑ranked)](#7-security-owasp-ranked)
8. [Performance](#8-performance)
9. [Code Quality](#9-code-quality)
10. [UX/UI](#10-uxui)
11. [Testing & CI/CD](#11-testing--cicd)
12. [Technical Debt & Refactor Roadmap](#12-technical-debt--refactor-roadmap)
13. [Bug / Edge‑Case Analysis](#13-bug--edge-case-analysis)
14. [สรุปรายการปัญหาจัดอันดับ](#14-สรุปรายการปัญหาจัดอันดับ)

**ระดับความสำคัญ:** 🔴 Critical · 🟠 High · 🟡 Medium · 🟢 Low · ℹ️ Informational

---

## 1. Executive Summary

IQC System เป็น **Quality Management System (ISO 9001)** ระดับ enterprise สำหรับโรงงานผลิตประตู/หน้าต่าง
(อลูมิเนียม FA / uPVC FU) ครอบคลุมตั้งแต่ตรวจรับวัตถุดิบ (IQC) จนถึง QC ระหว่างผลิต (IPQC) และ QC สุดท้าย (FGQC — FQC ถูกลบแล้ว Session 104, dead feature)
พร้อมกระบวนการจัดการของไม่เป็นไปตามข้อกำหนด (NCR/NCP/FNCP), การอนุญาตใช้งานแบบมีเงื่อนไข (UAI/FUAI),
KPI, การเช็คชื่อ QC, และระบบจำแนกรหัสสินค้า SAP อัตโนมัติ

**ภาพรวมคุณภาพ**

| ด้าน | คะแนน | สรุป |
|------|-------|------|
| Workflow / Domain modeling | 🟢 ดีมาก | State machine ครบ, บังคับ optimistic lock ทุก transition, ISO features จริง |
| Security | 🟢 ดี | Magic‑number upload, atomic sequence, session‑token single‑login, audit log, rate limit |
| Database integrity | 🟡 ปานกลาง | FK + index ครบ แต่ schema เคย corrupt (Session 84, มี integrity check บรรเทาแล้ว S88); ~~role constraint drift~~ ✅ แก้แล้ว (S105) |
| Architecture / Maintainability | 🟠 ต้องปรับ | Monolith route‑centric, ไม่มี service layer, God files, logic กระจายใน handler |
| Testing / CI | 🟠 ต้องปรับ | มี test 6 ไฟล์ แต่ integration ทั้งหมด **fail** (fixture drift), ไม่มี CI/CD |
| Documentation | 🟡 ปานกลาง | เอกสารเยอะแต่ซ้ำ/ล้าสมัย (เอกสารชุดนี้แก้ปัญหานั้น) |

**3 เรื่องเร่งด่วนที่สุด**
1. ~~🟠 **Test suite แตก** — integration/DB tests ล้มทั้งหมดที่ setup ด้วย `CHECK constraint failed: role IN (...)` → fixture/schema drift~~ ✅ **แก้แล้ว (Session 87)** — test 161/161 เขียว, 0 skip (ดู §11)
2. ~~🟠 **Role drift** — schema `users.role` อนุญาต 10 roles แต่ frontend อ้าง `prod_supervisor` เป็น role ที่ 11~~ ✅ **แก้แล้ว (Session 105)** — schema อนุญาต 11 roles จริงอยู่แล้ว (verify ด้วย INSERT ทดสอบ + migration `migrateUsersRoleConstraint()`); ที่ค้างจริงคือ frontend `CREATABLE_ROLES` กันเองไว้ แก้แล้ว (ดู §5.4 D1)
3. ~~🟠 **Architecture debt** — business logic + transaction + audit + notification รวมอยู่ใน route handler เดียว, ไม่มี service/repository layer~~ ✅ **service layer แก้แล้ว (S90-102)** — logic ย้ายเข้า `services/*.js` ครบทุกโดเมน; repository/DAO layer ยังไม่มี (ไม่ใช่เป้าหมายของ refactor รอบนี้) ดู §2, §12

---

## 2. Architecture

### 2.1 ภาพรวม (ตามโค้ดจริง)

```
┌────────────────────────────────────────────────────────────┐
│  Client (React 18 + Vite 5 + Tailwind 3.4)                 │
│  - React Router 6  · React Query 5 (server state)          │
│  - Context: Auth, Processing   · Hooks: SSE, Notifications  │
│  - rolePermissions.js = ศูนย์กลาง nav + สิทธิ์ (client‑side)  │
└───────────────┬────────────────────────────────────────────┘
                │ axios (withCredentials) → /api, /uploads (Vite proxy dev)
                ▼
┌────────────────────────────────────────────────────────────┐
│  Server (Express 4.18, port 3001, CommonJS)                │
│  index.js: security headers → CORS → body → cookie →       │
│            rate‑limit → routes → SSE → static /uploads      │
│  routes/*.js  (~31 ไฟล์)  ── validate → เรียก service       │
│  middleware/  auth · requireRole · upload (magic‑number)    │
│  services/    9+ domain service + proCodeClassifier (S90-102) │
│  db/          database.js (init + helpers) · schema.sql     │
└───────────────┬────────────────────────────────────────────┘
                │ better-sqlite3 (synchronous, WAL, FK=ON)
                ▼
        SQLite  iqc.db  (101 ตาราง — ลด 4 จาก fqc_* ที่ลบ S104)   +   /uploads (ไฟล์แนบ)
                │
                └── Telegram Bot API (fire‑and‑forget), SSE (in‑memory Map)
```

### 2.2 Layering — ตามจริง

| Layer | มีจริงหรือไม่ | หมายเหตุ |
|-------|--------------|----------|
| Routing / Controller | ✅ `routes/*.js` | ควบคุมเฉพาะ validate → เรียก service → return (S90-102) |
| Service layer | ~~❌ ไม่มี (ยกเว้น `proCodeClassifier.js`)~~ ✅ **มีแล้ว (S90-102)** | `services/*.js` 9+ domain (billService, ncrService, uaiService, deliveryService, kpiService, fgFncpService, fgFuaiService, ipncrService, proCodeClassifier) |
| Repository / DAO | ❌ ไม่มี | เขียน SQL ตรงใน handler/service ผ่าน prepared statement — **ยังไม่แก้** (ไม่ใช่เป้าหมาย service-layer refactor) |
| Transaction module | ~~❌ ไม่มีไฟล์แยก~~ ✅ **realized เป็น domain service แทน (S90-102)** | `db.transaction()` อยู่ใน `services/*.js` ต่อโดเมน แทนที่จะเป็น `transactions.js` ไฟล์เดียว (maintainable กว่า) |
| DB helper | ✅ `database.js` | รวม init + migration + seed + sequence(ย้าย `sequences.js`) + audit(ย้าย `audit.js`) + settings + SSE helper |

> **ข้อค้นพบสำคัญ:** ~~CLAUDE.md เดิม §8 ระบุโครง `server/db/transactions.js`, `sequences.js`, `audit.js`
> เป็นไฟล์แยก **แต่ในโค้ดจริงไม่มี**~~ ✅ **แก้แล้ว** — `sequences.js`/`audit.js` แยกจริงแล้ว (Session 88);
> `transactions.js` ไม่มีไฟล์เดียวเพราะแยกเป็น `services/*.js` ต่อโดเมนแทน (เจตนา, ไม่ใช่ gap)
> เอกสาร ↔ โค้ด ไม่ตรงกัน → แก้ใน CLAUDE.md แล้ว

### 2.3 ข้อดี

- **Domain modeling แข็งแรง** — state machine ของ NCR/UAI/FNCP/FUAI/IPNCR ชัดเจน แยกสถานะครบทุกขั้น approval
- **better‑sqlite3 synchronous** — เหมาะกับ transaction เชิงธุรกิจ (atomic, ไม่ต้องจัดการ async race)
- **Single source of permission (client)** — `rolePermissions.js` รวม nav + role ไว้ที่เดียว ลด hardcode ใน component
- **Real‑time เบา** — SSE (ไม่ใช่ WebSocket) เพียงพอกับ use‑case แจ้งเตือน + invalidate React Query
- **ISO features เป็นรูปธรรม** — drawing revision, lot/expiry, calibration, supplier evaluation/risk, disposition

### 2.4 ข้อเสีย / ความเสี่ยงเชิงสถาปัตยกรรม

| # | ประเด็น | ระดับ | ผล |
|---|---------|-------|-----|
| A1 | ~~Route handler ทำหลายหน้าที่ (validate + SQL + tx + audit + notify + Telegram + SSE)~~ | ✅ | **แก้แล้ว (S90-102)** — tx+audit+notify ย้ายเข้า `services/*.js` ครบ; route handler เหลือแค่ validate → เรียก service → return |
| A2 | ~~ไม่มี service/repository layer~~ | ✅ | **service layer แก้แล้ว (S90-102)**; repository/DAO ยังไม่มี (ไม่ใช่เป้าหมาย refactor รอบนี้) |
| A3 | `database.js` เป็น God file (init + migration + seed + helper + sequence + audit) | 🟡 | แก้จุดเดียวกระทบทั้งระบบ — **ยังไม่แก้** (sequence/audit แยกออกไปบางส่วนแล้ว S88 แต่ตัวไฟล์หลักยังใหญ่) |
| A4 | SSE (in‑memory `Map<userId, Set<res>>`) + Chromium singleton (PDF) | 🟡 | **ผูกกับ single‑instance** — scale horizontal ไม่ได้ถ้าไม่เพิ่ม Redis pub/sub — **ยังไม่แก้** (P3) |
| A5 | Migration แบบ imperative ใน `database.js` (`safeAddColumn`, table recreate) | 🟠 | เปราะ — เคยทำ DB corrupt (Session 84) และเคย crash "no such table" (Session 83) — **รูปแบบเดิมยังใช้อยู่** (ล่าสุดใช้ทำ migration ลบ `fqc_records` เอง S104) มีแค่ boot-time integrity check (S88) เป็นตาข่ายนิรภัยเพิ่ม ไม่ได้แก้ pattern ที่เปราะ |
| A6 | ~~Coupling frontend↔backend ผ่าน role string literal~~ | ✅ | เพิ่ม/แก้ role ต้องแก้หลายที่ — **role label centralize แล้ว (S103, ROLE_LABELS)**; ตัวอย่าง drift ที่ยกมา (`prod_supervisor`) **แก้แล้ว (S105)** ดู D1 |

### 2.5 Scalability & Future Expansion

- **แนวตั้ง (vertical):** เพียงพอสำหรับโรงงานเดียว (SQLite 2.9 MB, ผู้ใช้ ~36) — ปัจจุบันดีพอ
- **แนวนอน (horizontal):** ติดที่ A4 (SSE + Chromium in‑process) → ต้องทำ Redis adapter + แยก PDF service ก่อน
- **เปลี่ยนฐานข้อมูล:** DEPLOYMENT.md ระบุ path ไป PostgreSQL อนาคต — ควรมี repository layer (A2) ก่อนจึงจะย้ายได้ปลอดภัย

---

## 3. Business Logic รายโมดูล

รูปแบบ: **Purpose / Input / Process / Output / Rule / Risk**

### 3.1 Bills (ตรวจรับเข้า — IQC)
- **Purpose:** บันทึกการรับวัตถุดิบจาก supplier + ผลตรวจ (sampling ตาม AQL)
- **Input:** invoice_no, po_no, supplier_id, received_date, รายการ items (qty_received/sampled/passed/failed, defect, lot/expiry, drawing revision), รูปภาพ
- **Process:** `qc_staff` (station=incoming) สร้าง → submit → `qc_manager` อนุมัติ; ทุกขั้นห่อ transaction + audit
- **Output:** bill สถานะ draft→pending_approval→approved; item ที่ fail เป็นแหล่งเปิด NCR
- **Rule:** block supplier `suspended`/`blacklisted`; `expiry_date < received_date` → hard block; qty sanity (received ≥ sampled ≥ passed+failed)
- **Risk:** 🟢 — คุมด้วย transaction + optimistic lock

### 3.2 NCR / NCP (ของไม่เป็นไปตามข้อกำหนด)
- **Purpose:** จัดการของเสียจาก supplier แบบเป็นทางการ (major=NCR, minor=NCP)
- **Process:** flow 12 สถานะ (ดู §4.1); `qc_supervisor` เปิด NCP → auto‑approve+close ทันที; `qc_staff` เปิด → เข้า `pending_supervisor`
- **Rule:** bill_item ห้ามซ้ำใน NCR, disposition บังคับก่อนปิด, `re_inspect` block ปิดจน re‑inspection pass, supplier token 64‑hex อายุ 90 วัน
- **Risk:** 🟢 — optimistic lock ทุก transition; supplier response ใช้ `superseded_at` ไม่ลบจริง

### 3.3 UAI (Use‑As‑Is)
- **Purpose:** อนุญาตใช้ของที่ไม่ผ่านแบบมีเงื่อนไข ต้องลงนามหลายฝ่าย
- **Process:** 9 ขั้น sign (qc_manager→purchasing→cco→cmo→cpo→qc_ack→production_ack→qmr_ack→completed); ลายเซ็นเก็บเป็นไฟล์
- **Rule:** trigger เมื่อ NCR disposition=`uai`; reject ย้อนสถานะ; role sign ต้องตรง `SIGN_ROLE_MAP`
- **Risk:** 🟢

### 3.4 IPQC (In‑Process QC)
- ⚠️ **แก้ไข (Session 104):** คำอธิบายเดิมด้านล่างนี้อ้างอิงผิดจากตาราง `ipqc_records` ซึ่งพิสูจน์แล้วว่าเป็น**ตาราง dead ไม่เคยมี route จริง** (เหมือน `fqc_records` — ดู D6) ตัวจริงที่ใช้งานคือ `ipqc_inspections` ผ่าน `routes/ipqcInspection.js`
- **Purpose:** ตรวจ AQL-sampling ระหว่างผลิตต่อ station/line (อ้าง `pro_code_sap` ไม่ใช่ `products`) พร้อม checklist items จาก template
- **Process:** สร้าง record สถานะ `draft` (auto-stub checklist items จาก template ตาม station+line) → กรอกผลตรวจทีละ item (PUT) → `POST /:id/submit` คำนวณ `overall_result` (fail ถ้ามี item ใดๆ fail) → status → `completed` (optimistic lock ผ่าน `WHERE status='draft'`) → notify qc_supervisor/qc_manager/production_manager/prod_supervisor ถ้า fail
- **Rule:** แก้ไขได้เฉพาะ status=`draft`; `record_no` gen จาก atomic sequence; AQL sample/accept/reject คำนวณจาก `lot_qty` ผ่าน `utils/aqlCalc.js`
- **Risk:** 🟡 — มี IPQC หลายชั้น (inspections / items / images / templates / check‑items) ความซับซ้อนสูง; 🔴 **ไม่มี integration test คลุม create→submit flow เลย** (ดู D6, testcase.md §3 P1)

### 3.5 FGQC (Finished‑Goods QC)
- ⚠️ **แก้ไข (Session 104):** `fqc_records` (FQC) ถูกลบแล้ว — ไม่เคยมี route จริง เป็น dead feature มาตั้งแต่ต้น (ดู D4) เหลือเฉพาะ FGQC ที่ใช้งานจริง
- **Purpose:** ตรวจสินค้าสำเร็จ (AQL/100%); คำนวณ `defect_rate` ณ save
- **Rule:** `defect_rate` เก็บ ณ save ห้าม recompute ใน list; monthly approval unique (year,month,line,role)
- **Risk:** 🟢 — เหลือ entity เดียว (`fgqc_records`) หลังลบ `fqc_records` แล้ว ไม่มีความสับสนอีกต่อไป

### 3.6 FG Defect → FNCP → FUAI
- **Purpose:** ของเสียสินค้าสำเร็จ → เปิด NCP ฝ่ายผลิต (FNCP) → ถ้าใช้ต่อ ขอ FUAI
- **Process:** FNCP flow (open→in_progress→waiting_verify→supervisor_approved→verified→closed / reject / fuai_opened); มี `prod_token` ให้ฝ่ายผลิตตอบกลับ (คล้าย supplier NCR); FM category = 5M+E
- **Rule:** ถ้า FM=Material → ผู้ตอบคือ "QC รับเข้า" (ไม่ใช่ฝ่ายผลิต) — conditional text (Session 83)
- **Risk:** 🟡 — โมดูลใหม่ (Session 82‑85) เปลี่ยนบ่อย, schema เคย crash (Session 83)

### 3.7 KPI
- **Purpose:** ตั้ง KPI, target รายเดือน, บันทึกผล, อนุมัติ (admin→qc_manager→cpo→qmr)
- **สภาพจริงที่ใช้งาน (ยืนยันจาก UI, Session 103 audit):** flow ที่ user ใช้จริงคือ `kpi_items`+`kpi_targets` (Setup) → **`kpi_actuals`** (บันทึกค่าจริงรายเดือน ไม่มี approval — แท็บ "บันทึก KPI") → **`kpi_action_plans`** (CAPA เมื่อ fail — สร้าง/อนุมัติจากแท็บ "สรุป KPI", 3-step qcm→cpo→qmr)
- **`kpi_reports`/`kpi_report_entries`/`kpi_report_files`/`kpi_approvals` (3-step approval report เดิม): ไม่มี entry point ใน UI เลย** — ไม่มีปุ่มสร้าง, ไม่มีหน้า list, ไม่มี `<Link>`/`navigate()` ใดๆ ชี้ไป `/kpi/reports/:id` ในทั้ง codebase; ตรวจสอบแล้ว `client/src/pages/KPI/index.jsx` ไม่ import/เรียก endpoint กลุ่มนี้เลย มีแค่ route `/kpi/reports/:id` ค้างใน `App.jsx` + หน้า `ReportDetail.jsx` ที่เข้าไม่ถึงจาก UI ปกติ
- **ที่มา (DEVLOG):** Session 40 สร้าง `kpi_reports` flow ก่อน ต่อมามี session ที่เขียนทับ tab "รายงาน KPI" ด้วย tab "บันทึก KPI" (ผูก `kpi_actuals` แทน — DEVLOG ระบุชัดว่า "แท็บ บันทึก KPI (แทน รายงาน KPI)") แต่ backend/route/ReportDetail.jsx ไม่ถูกถอดออก — Session 94/101/102 ยังคงขยาย service+test ของ `kpi_reports` ต่อ (ทำให้ debt สะสมมากขึ้นโดยไม่รู้ตัวว่า UI ไม่ได้ใช้แล้ว)
- **ผลคือไม่ใช่ "3 กลไกซ้ำซ้อนเชิงหน้าที่" ตามที่เข้าใจเดิม แต่เป็น 2 กลไกที่ใช้งานจริง (`kpi_actuals`+`kpi_action_plans`) + 1 กลไก orphaned (`kpi_reports`)**
- ✅ **มติ product owner (Session 104):** คง `kpi_reports` ไว้ใน DB/backend (ไม่ลบ) แต่ mark **DEPRECATED** ด้วย comment กำกับทุกจุด (schema.sql, routes/kpi.js, kpiService.js, App.jsx, ReportDetail.jsx) — ยังไม่สร้าง UI ใหม่ในรอบนี้

### 3.8 QC Attendance
- **Purpose:** เช็คชื่อ QC ด้วยพิกัด + geofence (haversine ฝั่ง server), แจ้ง Telegram
- **Rule:** unique (user_id, date), geofence_ok ตรวจฝั่ง server เท่านั้น, คำนวณ late/work minutes
- **Risk:** 🟢

### 3.9 Issue Talk / Delivery / Master / ProCodeSAP‑PDPlan
- **Issue Talk:** กระทู้ + participant + message + attachment + read tracking
- **Delivery:** ตารางส่งของ (purchasing สร้าง, QC ack/บันทึกนอกแผน), SSE push
- **Master:** CRUD suppliers/products/groups/units/colors/defect‑categories + import/export Excel, soft delete (`is_active`)
- **ProCodeSAP/PDPlan:** import Excel + classifier 5 ชั้น (ดู §3.10)

### 3.10 ProCodeSAP Classifier (Tier 0‑4)
- Tier 0: derived‑desc fuzzy match (65% token overlap, ขยายคำย่อไทย) — ยิ่ง confirm มากยิ่งแม่น
- Tier 1: `sap_master_lookup` (training data นำเข้า)
- Tier 2: `sap_prediction_cache` (majority vote ต่อ part1/part2/field)
- Tier 3: deterministic parse (Part1/2/3 → line/series/brand/type/color/size, จัดการ encoding 0.1cm)
- Tier 4: keyword จาก description
- **Risk:** 🟢 logic แยกอยู่ใน service (ต่างจากโมดูลอื่น) + มี unit test ที่ **ผ่าน**

---

## 4. Workflow & State Machines

### 4.1 NCR (12 สถานะ)
```
[qc_staff เปิด] → pending_supervisor → pending_manager(+disposition)
   → pending_qmr_open → pending_purchasing_review → pending_supplier
   → pending_manager_review ──approve→ pending_qmr_close → closed
                          └─reject→ pending_supplier_resubmit ─(purchasing reset)→ pending_supplier
disposition=uai → uai_pending_qc_manager (เข้า UAI flow)
minor + supervisor เปิด → ncp_closed (ปิดทันที)
ยกเลิกได้ทุกจุด → cancelled
```

### 4.2 UAI (9 ขั้นลงนาม)
```
uai_pending_qc_manager → _purchasing → _cco → _cmo → _cpo
   → _qc_ack → _production_ack → _qmr_ack → uai_completed
reject ที่ exec → uai_rejected_by_exec ; reject อื่น → uai_rejected
```

### 4.3 FNCP → FUAI
```
FNCP: open → in_progress → waiting_verify → supervisor_approved → verified → closed
                                         └→ reject   └→ fuai_opened → [FUAI flow]
FUAI: pending_qc_manager → … → approved/rejected (ลายเซ็นหลายฝ่าย)
```

### 4.4 IPNCR (ผลิต)
```
pending_review → acknowledged → in_progress → (prod_manager_approved)
   → waiting_verify → verified → closed   |   rejected → rechecking …
```

### 4.5 KPI Report
```
draft → pending_qcm → pending_cpo → pending_qmr → approved
reject ที่ขั้นใด → กลับ draft (reject_reason, rejected_by_role)
```

> ทุก transition ใช้ **optimistic lock** (`UPDATE … WHERE id=? AND status=?`, ตรวจ `changes===0`) — ป้องกัน double‑approve

---

## 5. Database

### 5.1 ภาพรวม
- **101 ตาราง** (จาก schema.sql + migration ใน `database.js`) — ครอบคลุม 12 domain (ลด 4 จาก `fqc_records`+3 child table ที่ลบ Session 104)
- WAL mode, `foreign_keys=ON` (ตรวจตอน boot), busy_timeout 5s
- Sequence: atomic `UPDATE … RETURNING` ต่อ (doc_type, year) — **ไม่ใช้ `SELECT MAX/COUNT`** ✅

### 5.2 กลุ่มตาราง (ย่อ)
| Domain | ตัวอย่างตาราง |
|--------|--------------|
| Users/Auth | users, password_reset_logs, settings, document_sequences, audit_logs, notifications |
| Supplier | suppliers, supplier_approval_history, supplier_evaluations, supplier_risks |
| Master | product_groups, products, units, product_colors/images/drawings, defect_categories, measuring_equipment |
| Bills | bills, bill_items, bill_images, bill_item_images/inspection_docs/certificates/equipment |
| NCR | ncrs, ncr_items, ncr_images, ncr_approvals, supplier_responses(+attachments), re_inspections |
| UAI | uai_documents, uai_signatures, uai_images |
| Delivery | delivery_schedules(+items/attachments), company_holidays |
| KPI | kpi_groups/items/targets/reports/report_entries/report_files/approvals/actuals/action_plans (+lookup) |
| IssueTalk | issue_talks(+participants/messages/attachments/reads) |
| Attendance | qc_attendance |
| ProCodeSAP | pro_code_sap, sap_parse_rules, sap_prediction_cache, sap_master_lookup |
| Production/IPQC/FGQC/FG | production_lines(+managers), fm_categories, process_steps, defect_types, ipqc_stations, shifts, defect_rate_thresholds, pd_plans, ipqc_inspections(+items/images)/stations/check_templates/check_items, ~~ipqc_records/images~~(dead table, ดู D6), fgqc_records/defect_items, fg_defect_groups/types/records, fg_fm_categories, fg_process_areas, fg_fncp(+responses/attachments), fg_fuai(+signatures/images), ipncr_records, ipncp_records, return_stations, fg_productions — ⚠️ `fqc_records`+3 child table ลบแล้ว Session 104 |

### 5.3 Index / Constraint (ตามจริง)
- FK มี index กำกับครบตามที่ CLAUDE.md ระบุ (bills, bill_items, ncrs, uai, notifications, audit_logs, ipqc/pd_plans/pro_code_sap ฯลฯ) ✅
- CHECK constraint ใช้จริงในหลายตาราง (เช่น ~~`ipqc_records.defect_qty>0`~~ dead table ดู D6, `fgqc_records.defect_qty≥0`)
- NCR status **ไม่ใช้ DB CHECK** แต่ validate ใน app (`VALID_NCR_STATUSES`) — ตั้งใจ (flexible migration)

### 5.4 ข้อค้นพบ

| # | ประเด็น | ระดับ | รายละเอียด |
|---|---------|-------|-----------|
| D1 | ~~**Role constraint drift**~~ | ✅ | **ปิดแล้ว (Session 105) — แต่ root cause ไม่ตรงกับที่เข้าใจเดิม:** ตรวจโค้ดจริงพบว่า `schema.sql:7‑10` `users.role IN` มี **11 roles อยู่แล้ว** (รวม `prod_supervisor`) และมี migration `migrateUsersRoleConstraint()` อัปเกรด DB เก่าให้ครบ 11 roles ด้วย — ยืนยันด้วย `INSERT` ทดสอบสำเร็จจริงทั้งบน schema.sql (fresh) และ dev DB จริง (มี migration ใช้แล้ว) **ตัว gap จริงอยู่ที่ frontend**: `rolePermissions.js`'s `CREATABLE_ROLES` (สร้าง Session 103 ตามความเข้าใจผิดจาก D1 เดิม) กันไม่ให้เลือก `prod_supervisor` ในฟอร์มสร้าง user เอง — แก้แล้วโดยเอาเงื่อนไขกรองออก, verify end-to-end จริง (login admin → สร้าง user role `prod_supervisor` ผ่าน UI จริง → สำเร็จ → ลบ test user ออก) |
| D2 | **Schema migration เปราะ** | 🟠 | migration imperative + table recreate เคยทำ corrupt (Session 84) — ~~ควรมี migration versioned + integrity check ก่อน start~~ ✅ **integrity check เพิ่มแล้ว (S88)** — `quick_check` ตอน boot (prod fail-fast) เป็นตาข่ายนิรภัย แต่ **pattern imperative migration เดิมยังใช้อยู่จริง** (ยืนยันจากการใช้ทำ migration ลบ `fqc_records` เอง S104) — ความเสี่ยง "เปราะ" ยังไม่หมดไป แค่ตรวจจับได้เร็วขึ้นถ้าเกิดซ้ำ |
| D3 | ~~KPI 3 กลไกคู่ขนาน~~ → **`kpi_reports` DEPRECATED** | ✅ | **ปิดแล้ว (Session 104):** ตามมติ product owner — คง `kpi_reports`(+entries/files/approvals) ไว้ใน DB/backend (ไม่ลบ) แต่ mark deprecated ด้วย comment ใน schema.sql/routes/kpi.js/kpiService.js/App.jsx/ReportDetail.jsx ทุกจุด อ้าง §3.7 นี้เป็นแหล่งอ้างอิง ไม่สร้าง UI ใหม่ |
| D4 | ~~fqc vs fgqc ตารางคล้ายกัน~~ → **`fqc_records` ลบแล้ว** | ✅ | **ปิดแล้ว (Session 104):** ยืนยัน 0 แถวทุกตาราง (`fqc_records`+3 child) ในทั้ง test DB และ production dev DB จริง ก่อนลบ — ลบ 4 ตาราง+index จาก schema.sql, เพิ่ม migration `DROP TABLE IF EXISTS` ใน `runMigrations()`, ลบทุก reference (`proCodeSap.js` reset-all, `scripts/clear-data.js`), ลบ `test/fqc.test.js`; **verify กับ dev DB จริง** (boot server, migration รันสำเร็จ, ตาราง sqlite_master ยืนยันหายครบ) — ฟีเจอร์ถูกแทนที่ด้วย `fgqc_records` (FG Production module) สมบูรณ์แล้ว |
| **D6** | **`ipqc_records`/`ipqc_images` เป็น dead table เหมือน `fqc_records` (พบใหม่ Session 104)** | 🟠 | ระหว่างลบ `test/ipqc.test.js` (ทดสอบ path ผิดเดิม) พบว่า test นั้นทดสอบตาราง **`ipqc_records`** (defect_code/fm_category_id/status open→closed) ซึ่งเป็นคนละ data model จาก **`ipqc_inspections`** (AQL-sampling+checklist, draft→completed) ที่ `routes/ipqcInspection.js` ใช้งานจริง — `ipqc_records`/`ipqc_images` **ไม่มี route ไหนแตะเลยนอกจาก FK-cleanup ใน `proCodeSap.js`** เหมือน fqc_records ทุกประการ ยืนยัน 0 แถวใน dev DB — **ยังไม่ได้ลบ** (นอกขอบเขตคำขอ S104 รอ user ตัดสินใจ); ถ้าลบต้องแก้ **CLAUDE.md §21.3/21.9 ด้วย** เพราะอธิบาย `ipqc_records`+`generateDefectCode` เป็นกฎที่ enforce จริงอยู่ (เอกสารไม่ตรงกับโค้ด); เปิด gap คู่กัน: `ipqc_inspections` (ตัวจริง) ไม่มี integration test คลุม create→submit flow เลย (ดู testcase.md §3, P1) |
| D5 | ไม่มี online backup อัตโนมัติ | 🟡 | DEPLOYMENT.md แนะนำ cron `.backup` แต่ยังไม่ automate; มี `.corrupt.bak` เป็นหลักฐานความเสี่ยง |

---

## 6. API

### 6.1 ลักษณะทั่วไป
- ทุก route ใต้ `/api/*`; auth ผ่าน JWT httpOnly cookie + ตรวจ `session_token` จาก DB ทุก request
- Role gate ด้วย `requireRole([...])` + `requireReceivingQC` (qc_staff ต้อง station=incoming)
- Public (ไม่ auth): `GET/POST /api/supplier/ncr/:token`, `GET/POST /fncp-response/:token`, `/api/health`
- Response list: pattern `{ data, total, page, limit }` + LIMIT/OFFSET ✅ (ตาม CLAUDE.md 2.7)

### 6.2 กลุ่ม endpoint (ย่อ ~31 routers)
auth · bills · ncr · supplier · uai · dashboard (ใหม่ S103 — GET /stats aggregate) · notifications · reports · delivery · holidays · issue‑talk ·
attendance · kpi · master · exports · ipqcInspection · ipqcMaster · ipncr · pdPlan · proCodeSap ·
fgMaster · fgFuai · fgMaterialDefects · fgDefect · fgFncp · fgFncpResponse · fgProduction
(+ admin settings/users/audit/stats mount ใน `index.js`)

### 6.3 ข้อค้นพบ

| # | ประเด็น | ระดับ | รายละเอียด |
|---|---------|-------|-----------|
| API1 | ไม่มี versioning (`/api/v1`) | 🟡 | เปลี่ยน contract แล้ว client เก่าพัง — ควรวาง prefix ก่อนมี client ภายนอกเพิ่ม |
| API2 | ไม่มี OpenAPI/Swagger รวมศูนย์ | 🟡 | มี `docs/API_SPEC.md` + Postman collection แต่ไม่ generate จากโค้ด → เสี่ยง drift |
| API3 | rate‑limit เฉพาะ global/supplier/export | 🟢 | ครอบคลุมจุดเสี่ยงหลักแล้ว (login มี limiter แยกด้วย) |
| API4 | error response ซ่อน detail ใน prod | 🟢 | dev เห็น stack, prod แสดง "เกิดข้อผิดพลาด" — ดี |

---

## 7. Security (OWASP‑ranked)

### 7.1 จุดแข็ง (ยืนยันจากโค้ด)
- **A01 Broken Access Control:** `requireRole` ทุก write + ตรวจ role สดจาก DB ทุก request (revoke ทันที); token ผู้ผลิตเห็นเฉพาะ purchasing/admin
- **A02 Crypto:** bcrypt rounds 12; JWT secret ตรวจตอน boot (prod บังคับ ≥64 char, fail‑fast); token ผู้ผลิต `crypto.randomBytes(32)` (ไม่ใช่ Math.random/uuid) ✅
- **A03 Injection:** better‑sqlite3 prepared statement ทุกจุด (parameterized) → SQL injection risk ต่ำ; Telegram ส่ง plain‑text (ไม่ parse HTML) กัน injection
- **A04 Insecure Design:** optimistic lock กัน double‑approve; sequence atomic กัน duplicate code
- **A05 Misconfiguration:** security headers (nosniff, X‑Frame‑Options, Referrer‑Policy, HSTS); `/uploads` บังคับ octet‑stream+attachment สำหรับ .html/.svg/.js ฯลฯ (กัน stored XSS)
- **A07 Auth Failures:** login rate‑limit 5/15นาที ต่อ username; `session_token` single‑login (invalidate อุปกรณ์อื่น); idle timeout 30 นาที (client) + warn 2 นาที
- **A08 Integrity (upload):** **magic‑number check** อ่าน 16 byte แรก, rename เป็นชื่อสุ่ม, ปฏิเสธไฟล์ที่ magic ไม่ตรง — กัน path traversal + polyglot
- **A09 Logging:** audit_logs (table/record/action/old/new/user/ip) + LOGIN/LOGIN_FAILED/CHANGE_PASSWORD

### 7.2 ข้อสังเกต / ช่องโหว่ที่เหลือ

| # | ประเด็น | ระดับ | รายละเอียด & แนวทาง |
|---|---------|-------|--------------------|
| S1 | Default `JWT_SECRET` ใน `.env` local | 🟢 | **ยืนยันแล้วว่า `.env` ไม่ถูก commit** (git ติดตามเฉพาะ `.env.production.example`) → เป็น dev‑hygiene เท่านั้น; prod บังคับ secret ≥64 char ตอน boot อยู่แล้ว |
| S2 | CSRF อาศัย `sameSite=strict` อย่างเดียว | 🟡 | เพียงพอสำหรับ browser สมัยใหม่ แต่ควรพิจารณา CSRF token สำหรับ endpoint mutation สำคัญ (defense‑in‑depth) |
| S3 | SSRF ใน PDF export (html‑pdf‑node/Chromium) | 🟡 | DEVMORE เดิมชี้ C1 — ต้องยืนยันว่า template render จาก data ภายในเท่านั้น ไม่ fetch URL จาก user input **(ข้อสันนิษฐาน — ควรตรวจ `exports.js` เพิ่ม)** |
| S4 | ไม่มี dependency scanning | 🟡 | `html-pdf-node`, `puppeteer` เก่า — ควรตั้ง `npm audit`/Dependabot |
| S5 | single‑instance security ok แต่ไม่มี WAF/CSP header | 🟢 | มี nginx ข้างหน้า (Cloudflare option) — เพิ่ม `Content-Security-Policy` ได้ |

---

## 8. Performance

| # | ประเด็น | ระดับ | รายละเอียด |
|---|---------|-------|-----------|
| P1 | ~~Dashboard ดึง `limit=500` หลาย endpoint พร้อมกัน~~ | ✅ | **แก้แล้ว (Session 103)** — `GET /api/dashboard/stats` (SQL COUNT/GROUP BY aggregate) แทนที่ `useStats()` เดิม; ยืนยันตัวเลขตรงเดิมด้วย Playwright เทียบ before/after |
| P2 | React Query refetch 30s (notifications) | 🟢 | โอเคที่สเกลปัจจุบัน; ระวังเมื่อ user เยอะ |
| P3 | `SELECT *` ใน admin/report | 🟢 | อยู่นอก hot path; list หลักมี LIMIT แล้ว |
| P4 | N+1 ในบางรายงาน | 🟡 | **(ข้อสันนิษฐาน)** ควรตรวจ report/stats ที่ loop query ต่อ supplier/line |
| P5 | ไม่มี index บนบางคอลัมน์ filter ใหม่ | 🟡 | ตรวจ filter ของโมดูลใหม่ (fg_*, ipncr) ว่ามี index ครบตาม CLAUDE.md 21.9 |
| P6 | Chromium warm singleton | 🟢 | ดี — ไม่ cold start ทุกครั้ง; แต่ผูก single‑instance (A4) |

---

## 9. Code Quality

| # | ประเด็น | ระดับ | รายละเอียด |
|---|---------|-------|-----------|
| Q1 | ~~**God file**~~ (Dashboard) | ✅ | **แก้แล้ว (Session 103)** — `Dashboard/index.jsx` (1559 บรรทัด) แตกเป็น 9 ไฟล์ (`shared.jsx` + 8 role component), `index.jsx` เหลือ 28 บรรทัด; `database.js` ยังรวมทุกอย่างอยู่ (ไม่อยู่ในขอบเขต S103) |
| Q2 | ~~**Dead dependency**~~ | ✅ | `fabric@5.5.2` — **ถอดแล้ว (Session 103)**: ไม่มี import ใน client/src, `npm install` ลบ 104 transitive packages, build ผ่านปกติ |
| Q3 | ~~DRY: logic tx+audit+notify ซ้ำข้าม route~~ | ✅ | **แก้แล้ว (S90-102)** — สกัดเป็น `services/*.js` ต่อโดเมนครบแล้ว (ดู §12) |
| Q4 | ~~ตรรกะซ้ำ KPI (reports/action_plans/actuals) และ fqc/fgqc~~ | ✅ | **ปิดครบ (Session 104)** — `kpi_reports` mark deprecated (คงไว้), `fqc_records` ลบแล้ว ดู §3.7, D3, D4; พบ D6 ใหม่ (`ipqc_records` dead table คล้ายกัน) ระหว่างทำ |
| Q5 | ~~Magic strings (role, status) กระจาย~~ | ✅ | **role label centralize แล้ว (Session 103)** — `utils/rolePermissions.js` export `ROLE_LABELS`/`CREATABLE_ROLES` เดียว ใช้แทนที่ dict ซ้ำใน `Admin/Users.jsx`+`UAI/Detail.jsx` (แก้ text drift "ผู้จัดการผลิต" vs "ผู้จัดการฝ่ายผลิต" ไปด้วย); `status` centralize อยู่แล้วผ่าน `STATUS_LABELS` (ดู Q6) — เหลือเฉพาะ per-route authorization arrays (`requireRole([...])`) ซึ่งไม่ใช่ duplication ที่แท้จริง (แต่ละ route มีสิทธิ์ต่างกันโดยเจตนา) |
| Q6 | Naming/consistency | 🟢 | โดยรวมสม่ำเสมอ (Thai label + English code), STATUS_LABELS รวมศูนย์ |
| Q7 | ไม่มี type safety (JS ล้วน, ไม่มี TS) | 🟡 | โปรเจกต์ขนาดนี้ TypeScript จะช่วยลด role/status drift แบบที่เพิ่งเจอใน D1 (ปิดแล้ว S105) ได้ตั้งแต่ compile time — ยังไม่ทำ (P3) |

---

## 10. UX/UI

| # | ประเด็น | ระดับ | รายละเอียด |
|---|---------|-------|-----------|
| U1 | KPI/summary card ไม่ลิงก์ไป filtered list | 🟡 | คลิกการ์ดควรพาไปหน้ารายการที่กรองแล้ว (ลด friction) |
| U2 | Empty / loading / error state ไม่สม่ำเสมอ | 🟡 | ควรมี component มาตรฐาน (skeleton, empty‑state) ใช้ทุกหน้า |
| U3 | Dark theme (QC Staff dashboard) ใช้ inline style/gradient | 🟢 | ควรย้ายเป็น token ใน tailwind (brand.md v3.0 ระบุ token ให้แล้ว) |
| U4 | Accessibility | 🟢 | มี min 44px touch, WCAG AA contrast, label ครบ — ดี; ตรวจ aria บน icon‑only button เพิ่ม |
| U5 | Mobile รองรับดี | 🟢 | Bottom nav, full‑page signature route, ไม่มี modal ซ้อนบน mobile — ตรงกฎ |
| U6 | ความสม่ำเสมอ | 🟢 | design system (Badge/Button/Modal/FilterBar/Pagination) ใช้ทั่วถึง |

---

## 11. Testing & CI/CD

> ⚠️ **§11.1-11.2 ด้านล่างเป็นสถานะเก่า ณ วันตรวจครั้งแรก (2026‑07‑02, ก่อน Session 87) — คงไว้เพื่อบันทึกประวัติ**
> **สถานะปัจจุบัน (Session 104, ยืนยันจากการรันจริง):** `npm test` = **161 tests · 161 pass · 0 fail · 0 skip** เขียวหมด

### 11.1 สถานะจริง ณ วันตรวจครั้งแรก (2026‑07‑02, ก่อนแก้)
- ✅ **Logic tests ผ่าน 11** — `unit.test.js` (validate/enum/date) + classifier (ALU/FU/parsePart3/mosquito‑net)
- ~~✖ **DB/integration tests fail ทั้งหมด 5 ไฟล์** — `fqc`, `integration`, `ipqc`, `ipqcMaster`, `unit(บางส่วน)`
  ล้มที่ **setup** ด้วย `SqliteError: CHECK constraint failed: role IN (...)` (`SQLITE_CONSTRAINT_CHECK`)~~
  ✅ **แก้แล้ว (Session 87)** — fixture ตรงกับ constraint แล้ว ทุก suite รันผ่าน

### 11.2 Root cause (ของปัญหาเดิม — ปิดแล้ว)
~~Test setup seed user ด้วย role ที่ **ไม่อยู่ใน** `users.role CHECK` ปัจจุบัน (schema.sql:7‑10) → fixture/schema drift
เกี่ยวโยงกับ D1 (role `prod_supervisor` ไม่อยู่ใน constraint) — test เขียนไว้ก่อน schema เปลี่ยน หรือ constraint ตกหล่น role ใหม่~~
✅ **แก้แล้ว (Session 87)** — root cause นี้แก้เฉพาะฝั่ง test fixture; **D1 (role drift ตัวจริงใน schema/frontend) แก้แล้วเช่นกัน (Session 105)** — คนละประเด็น คนละ session ที่แก้ แต่ปิดครบทั้งคู่แล้ว

### 11.3 Gap
- ~~ไม่มี test สำหรับ NCR/UAI/FNCP/FUAI workflow~~ ✅ **แก้แล้ว (S89-99)** — `ncrUai.test.js`(31)+`fgFncp.test.js`(9)+`fgFuai.test.js`(6)+`ipncr.test.js`(12)
- ไม่มี test สำหรับ auth/rate‑limit, permission matrix (บางส่วนคลุมผ่าน NCR/UAI guard tests) — **ยังเป็น gap อยู่** (P1)
- ไม่มี E2E ถาวรใน repo (Playwright ยังไม่ตั้งเป็น CI suite — มีแค่ใช้ ad-hoc ตรวจ Dashboard ครั้งเดียวใน S103 ไม่ได้ commit เป็น test), ไม่มี load/stress test — **ยังเป็น gap อยู่**
- ~~**ไม่มี CI/CD** (`.github/workflows` ไม่มี) → test แตกไม่มีใครเห็นจนรันเอง~~ ✅ **แก้แล้ว (Session 88)** — `.github/workflows/ci.yml` (server `npm test` + client `npm run build`)

### 11.4 คำแนะนำ (สถานะล่าสุด)
1. ~~แก้ fixture/constraint ให้ test setup ผ่านก่อน (blocker)~~ ✅ เสร็จ (S87)
2. ~~เพิ่ม CI (GitHub Actions): `npm test` + `npm run build` ทุก PR~~ ✅ เสร็จ (S88)
3. ~~เพิ่ม integration test workflow NCR→UAI, supertest API + permission~~ ✅ เสร็จ (S89-99, ครอบ NCR/UAI/Bills/Delivery/KPI/FG FNCP/FUAI/IPNCR)
4. Playwright smoke (login/bills/NCR/export) + k6 load (10‑200 concurrent) — **ยังไม่ทำเป็น permanent suite** (มีแค่ ad-hoc run ครั้งเดียว S103)
> รายละเอียดใน `testcase.md`

---

## 12. Technical Debt & Refactor Roadmap

> **หลักการ:** คง Business Logic / Workflow / UX เดิม 100% — ปรับโครงสร้างภายในเท่านั้น

| Priority | รายการ | Before | After | Benefit | Risk |
|----------|--------|--------|-------|---------|------|
| ✅ P0 | ~~แก้ test suite (fixture/role constraint)~~ | integration fail ทั้งหมด | **เสร็จ (Session 87)** — เขียวหมด, ปัจจุบัน 161/161, 0 skip | ปลดล็อก regression safety | — |
| ✅ P0 | ~~ปิด role drift D1~~ | schema เข้าใจผิดว่ามี 10 / client 11 | **ปิดแล้ว (S105)** — schema มี 11 roles อยู่แล้วจริง (migration ทำไว้แล้ว), แก้แค่ `CREATABLE_ROLES` ฝั่ง client ที่กันตัวเองไว้ผิดๆ — verify end-to-end จริงผ่าน UI | ป้องกัน bug สิทธิ์ | — |
| ✅ P1 | ~~สกัด service layer จาก route~~ | logic ใน handler | `services/*.js` (9 domain) | ทดสอบ+reuse ง่าย | **ปิดครบ (S90-102):** NCR/UAI/Supplier/Bills/Delivery/KPI(ครบทั้ง report/entries/action_plan/master/targets/actuals)/FG FNCP/FUAI/IPNCR — **ทุก business transaction + CRUD หลักสกัดหมดแล้ว ไม่เหลือค้าง**, test 161 เขียว (S104: ลบ 2 dead test file), 112 integration |
| ✅ P1 | ~~ทำ `sequences.js`/`audit.js` จริง~~ | inline ใน database.js | **เสร็จ Session 88** — `db/sequences.js` + `db/audit.js` (attach(db) pattern); `transactions.js` เหลือ = ทำพร้อม service layer | อ่านง่าย, ตรงเอกสาร | — |
| ✅ P1 | ~~integrity check ตอน boot~~ | — | **เสร็จ Session 88** — `quick_check` ตอน open DB (prod fail-fast); versioned migration ใช้ `migrate.js` (schema_migrations) อยู่แล้ว | **ลดความเสี่ยง** corrupt ซ้ำ (D2) — บรรเทาเท่านั้น (mitigation) pattern imperative migration เดิมยังใช้อยู่ ยังไม่ปิดสนิท (ดู D2, B4) | — |
| ✅ P1 | ~~ตั้ง CI/CD (test+build)~~ | ไม่มี | **เสร็จ Session 88** — `.github/workflows/ci.yml` (server `npm test` + client `npm run build`) | จับ regression | — |
| ✅ P2 | ~~แตก `Dashboard/index.jsx` เป็น component ต่อ role~~ | 1560 บรรทัด | **เสร็จ (S103):** 9 ไฟล์ + `GET /api/dashboard/stats` (server aggregate) — verify ด้วย Playwright จริง | maintain + performance | — |
| ✅ P2 | ~~รวม/นิยามขอบเขต KPI (reports/action_plans/actuals) + fqc/fgqc~~ | ซ้ำซ้อน (เข้าใจผิดว่าเป็น 3 flow คู่ขนาน) | **ปิดครบ (S103 นิยาม → S104 ทำตามมติ):** `kpi_reports` mark deprecated (คงไว้ตามคำสั่ง), `fqc_records` ลบแล้ว (ยืนยัน 0 แถว + verify กับ dev DB จริง) — ดู §3.7, D3, D4 | ลด bug/สับสน — เสร็จสมบูรณ์ |
| ✅ P2 | ~~ถอด `fabric` ที่ไม่ใช้ + centralize enum role/status~~ | dead dep + magic string | **เสร็จ (S103):** ลบ `fabric` (104 packages); `ROLE_LABELS`/`CREATABLE_ROLES` รวมศูนย์ใน `rolePermissions.js` (status label centralize อยู่แล้วเดิม) | bundle เล็ก, drift น้อย | — |
| 🟢 P3 | เตรียม horizontal scale (Redis SSE adapter, แยก PDF service) | single‑instance | scalable | รองรับโต | สูง |
| 🟢 P3 | พิจารณา migrate เป็น TypeScript (ทีละส่วน) | JS | TS | type safety | สูง |

---

## 13. Bug / Edge‑Case Analysis

| # | ประเด็น | สถานะ |
|---|---------|-------|
| B1 | Race condition double‑approve | ✅ กันแล้วด้วย optimistic lock |
| B2 | Duplicate document code | ✅ กันแล้วด้วย atomic sequence |
| B3 | ~~Test setup role CHECK fail~~ | ✅ **แก้แล้ว (Session 87)** — ทุก test fixture ตรงกับ constraint (§11) |
| B4 | Schema corruption จาก kill กลาง migration | ⚠️ เคยเกิด (Session 84) — มี boot-time integrity check แล้ว (S88) เป็นตาข่ายนิรภัย แต่ pattern imperative migration ที่เป็นสาเหตุยังใช้อยู่ (ดู D2, A5) — **เสี่ยงซ้ำได้ ยังไม่ปิดสนิท** |
| B5 | `no such table` ตอน fresh DB (safeAddColumn ก่อน initSchema) | ✅ แก้แล้ว (Session 83, catch 'no such table') |
| B6 | ~~prod_supervisor สร้าง user ไม่ได้ (constraint)~~ | ✅ **แก้แล้ว (S105)** — verify จริงแล้ว: constraint รองรับอยู่แล้ว, gap อยู่ที่ frontend `CREATABLE_ROLES` ซึ่งแก้แล้ว (D1) |
| B7 | Offline / network failure ฝั่ง client | 🟡 ไม่มี offline cache/service worker (acceptable สำหรับ internal tool) |
| B8 | Telegram ส่งไม่ได้ | ✅ fire‑and‑forget, log แล้วไปต่อ (ไม่ crash) |

---

## 14. สรุปรายการปัญหาจัดอันดับ

**🔴 Critical / P0**
1. ~~Test suite (integration) fail ทั้งหมด — fixture/role constraint drift~~ ✅ **แก้แล้ว (Session 87)** (§11, B3)
2. ~~Role drift: schema 10 roles vs frontend 11 (`prod_supervisor`)~~ ✅ **แก้แล้ว (Session 105)** — schema มี 11 roles อยู่แล้วจริง, แก้ที่ frontend `CREATABLE_ROLES` (D1, B6)

**🟠 High / P1**
3. ~~Architecture: ไม่มี service/repository layer, God files, logic กระจาย~~ — **service layer + Dashboard god file แก้แล้ว (S90-103)**; `database.js` god file (A3) และ repository/DAO layer **ยังไม่แก้** (A1‑A3, Q1, Q3)
4. Migration เปราะ → เสี่ยง corrupt ซ้ำ — มี integrity check เป็นตาข่ายนิรภัยแล้ว (S88) แต่ pattern เดิมยังใช้อยู่ **ยังไม่ปิดสนิท** (D2, B4)
5. ~~เอกสาร ↔ โค้ด ไม่ตรง (transactions.js ที่ไม่มีจริง)~~ ✅ **แก้ใน CLAUDE.md แล้ว**
6. ~~ไม่มี CI/CD~~ ✅ **แก้แล้ว (Session 88)** — `.github/workflows/ci.yml`

**🟡 Medium / P2**
7. ~~KPI/fqc‑fgqc ตรรกะซ้ำซ้อน~~ → **ปิดครบ (S104)**: `kpi_reports` deprecated (คงไว้), `fqc_records` ลบแล้ว (D3, D4, Q4) — พบ **D6 ใหม่** (`ipqc_records` dead table เหมือนกัน) รอตัดสินใจ
8. Single‑instance lock‑in (SSE + Chromium) (A4)
9. ~~Performance: dashboard aggregate ฝั่ง client (P1)~~ **แก้แล้ว (S103)**, N+1 (P4) ยังเหลือ
10. UX: card ไม่ลิงก์, empty/error state ไม่สม่ำเสมอ (U1, U2)
11. No API versioning / OpenAPI drift (API1, API2), CSRF defense‑in‑depth (S2), SSRF ตรวจเพิ่ม (S3)

**🟢 Low / Informational**
12. ~~`fabric` dead dep~~ **ถอดแล้ว (S103)** · ~~magic strings (role label)~~ **centralize แล้ว (S103, ดู `ROLE_LABELS`)** · no TypeScript (Q7)
13. Default JWT secret ใน `.env` local (ไม่ถูก commit) (S1)
14. Dark theme inline style (U3), dependency scanning (S4)

---

*จบเอกสาร AUDIT.md — วิเคราะห์ครั้งแรก 2026‑07‑02 · ปรับปรุงล่าสุด 2026‑07‑03 (Session 105 — ปิด D1 role drift ตัวสุดท้ายใน P0, ดู DEVLOG.md Session 103-105 สำหรับรายละเอียดการแก้)*
