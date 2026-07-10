# PRD.md — Product Requirements Document (Consolidated)

**ระบบ:** IQC / Quality Management System rev01
**Version:** 3.0 (รวม PRD เดิม + PRD‑IPQC‑FQC.md) · **Updated:** 2026‑07‑02 · **Status:** Production

> เอกสารนี้เป็น **PRD ฉบับรวมล่าสุด** (ไฟล์เดียว) แทน PRD v2.0 เดิม และรวมเนื้อหาจาก `PRD-IPQC-FQC.md` (ถูก deprecate)
> อ้างอิงกฎการพัฒนาใน [`CLAUDE.md`](CLAUDE.md), design ใน [`brand.md`](brand.md), ผลวิเคราะห์ใน [`AUDIT.md`](AUDIT.md)

---

## สารบัญ

1. [Business Goal & Problem Statement](#1-business-goal--problem-statement)
2. [Personas & Roles](#2-personas--roles)
3. [Scope & Module Map](#3-scope--module-map)
4. [Functional Requirements รายโมดูล](#4-functional-requirements-รายโมดูล)
5. [Workflow & State Machines](#5-workflow--state-machines)
6. [Business Rules (ISO 9001)](#6-business-rules-iso-9001)
7. [Non‑Functional Requirements](#7-non-functional-requirements)
8. [Acceptance Criteria (ตัวอย่าง)](#8-acceptance-criteria-ตัวอย่าง)
9. [KPI ความสำเร็จของระบบ](#9-kpi-ความสำเร็จของระบบ)
10. [Future Roadmap](#10-future-roadmap)

---

## 1. Business Goal & Problem Statement

**เป้าหมายธุรกิจ:** ยกระดับการควบคุมคุณภาพของโรงงานผลิตประตู/หน้าต่าง (อลูมิเนียม FA / uPVC FU)
ให้เป็นดิจิทัลครบวงจรตามมาตรฐาน **ISO 9001** — ตั้งแต่รับวัตถุดิบ → ผลิต → สินค้าสำเร็จ
พร้อม traceability, การอนุมัติหลายชั้น, และหลักฐานตรวจสอบย้อนหลังได้ (audit trail)

**ปัญหาเดิม (ก่อนมีระบบ):**
- การตรวจรับ/NCR/UAI ใช้กระดาษ → ติดตามสถานะยาก, หาเอกสารย้อนหลังช้า
- การอนุมัติข้ามแผนก (QC → Manager → QMR → Purchasing → Executive) ไม่มี trail ชัดเจน
- ข้อมูลของเสีย/ผลตรวจกระจัดกระจาย ทำ KPI/รายงานคุณภาพลำบาก
- Supplier ตอบกลับ NCR ผ่านช่องทางไม่เป็นทางการ

**ผลลัพธ์ที่ต้องการ:**
- ทุกเอกสาร (Bill/NCR/UAI/IPQC/FQC/FNCP/FUAI) มีรหัสอัตโนมัติ + สถานะ + timeline + ผู้รับผิดชอบชัดเจน
- แจ้งเตือน real‑time (in‑app SSE + Telegram) ทุกขั้นที่ต้องการการดำเนินการ
- รายงาน/KPI/Dashboard ตาม role เพื่อการตัดสินใจ

---

## 2. Personas & Roles

11 roles ภายใน + 1 external (Supplier ผ่าน public token)

| Role | หน้าที่หลัก |
|------|-------------|
| `admin` | จัดการ Master data, ผู้ใช้, ตั้งค่าระบบ, ProCodeSAP/PDPlan, audit log |
| `qc_staff` | สร้างบิลรับเข้า (ต้อง station=incoming), เปิด NCR/NCP, IPQC/FQC, เช็คชื่อ |
| `qc_supervisor` | อนุมัติรับเข้า L1, เปิด/อนุมัติ NCP, verify FNCP |
| `qc_manager` | อนุมัติ NCR L2 + disposition, ตรวจคำตอบ supplier, sign UAI (QC ack), อนุมัติ KPI |
| `qmr` | เปิด/ปิด NCR (QMR), sign UAI (QMR ack), อนุมัติ KPI ขั้นสุดท้าย |
| `purchasing` | รับ NCR + copy link supplier, ขอ UAI, วางแผน delivery |
| `cco` / `cmo` / `cpo` | Executive sign‑off UAI; CPO อนุมัติ KPI + FQC monthly |
| `production_manager` | รับทราบ UAI (ฝ่ายผลิต), จัดการ production line |
| `prod_supervisor` | หัวหน้าฝ่ายผลิต (⚠️ ดู role drift ใน AUDIT.md §5.4 — ยังไม่อยู่ใน DB constraint) |
| **Supplier (external)** | ตอบกลับ NCR ผ่าน public token (root cause / CA / PA) — ไม่ต้อง login |

---

## 3. Scope & Module Map

| # | Module | หน้าจอ (client) | Route (server) |
|---|--------|----------------|----------------|
| 1 | IQC รับเข้า (Bills) | `pages/Bills/*` | `bills.js` |
| 2 | NCR / NCP | `pages/NCR/*`, `pages/Supplier/NCRResponse` | `ncr.js`, `supplier.js` |
| 3 | UAI | `pages/UAI/*` | `uai.js` |
| 4 | Delivery | `pages/Delivery/*` | `delivery.js`, `holidays.js` |
| 5 | Master data | `pages/Master/*` | `master.js` |
| 6 | Admin | `pages/Admin/*` | `index.js` (admin mounts) |
| 7 | Reports | `pages/Reports/*` | `reports.js`, `exports.js` |
| 8 | Dashboard | `pages/Dashboard/*` | `index.js` (stats), หลาย list endpoint |
| 9 | IPQC / IPNCR | `pages/ProductionQC/*` | `ipqcInspection.js`, `ipqcMaster.js`, `ipncr.js` |
| 10 | FQC / FGQC | `pages/FQC/*` | (ipqc/fg routes) |
| 11 | FG Production / FNCP / FUAI | `pages/FGProduction/*` | `fgProduction.js`, `fgFncp.js`, `fgFncpResponse.js`, `fgFuai.js`, `fgDefect.js`, `fgMaterialDefects.js`, `fgMaster.js` |
| 12 | KPI | `pages/KPI/*` | `kpi.js` |
| 13 | QC Attendance | `pages/QCAttendance/*` | `attendance.js` |
| 14 | Issue Talk | `pages/IssueTalk/*` | `issue-talk.js` |
| 15 | ProCodeSAP / PDPlan | `pages/Admin/ProCodeSap` | `proCodeSap.js`, `pdPlan.js` |

---

## 4. Functional Requirements รายโมดูล

รูปแบบ: **Purpose / Input / Process / Output / Rule / Edge case**

### FR‑1 Bills (ตรวจรับเข้า)
- **Purpose:** บันทึกรับวัตถุดิบ + ผลตรวจ sampling (AQL ISO 2859‑1)
- **Input:** invoice_no, po_no, container/tracking, supplier, received_date, items (qty received/sampled/passed/failed, defect, lot/batch, mfg/expiry, country, drawing revision), รูป
- **Process:** qc_staff สร้าง (draft) → submit (pending_approval) → qc_manager approve (approved)
- **Output:** bill + item ที่ fail เป็น input เปิด NCR; auto‑draft ทุก 30 วิ (sessionStorage)
- **Rule:** block supplier suspended/blacklisted; `expiry < received` → hard block; qty sanity check
- **Edge:** draft ค้าง → เตือน user เมื่อกลับเข้าหน้า; approve ซ้ำ → optimistic lock error

### FR‑2 NCR / NCP
- **Purpose:** จัดการของไม่เป็นตามข้อกำหนดจาก supplier (major=NCR, minor=NCP)
- **Input:** bill + items ที่ fail, severity, defect category/detail (ไทย+อังกฤษ), รูป
- **Process:** flow 12 สถานะ (§5.1); supervisor เปิด NCP → auto close; disposition (return/rework/uai/scrap/re_inspect)
- **Output:** เอกสาร NCR + supplier link (64‑hex token, 90 วัน) + timeline
- **Rule:** bill_item ห้ามซ้ำใน NCR; disposition บังคับก่อนปิด; supplier response ใช้ superseded_at
- **Edge:** token หมดอายุ → supplier เปิดไม่ได้ (purchasing regenerate); reject คำตอบ → resubmit

### FR‑3 UAI (Use‑As‑Is)
- **Purpose:** อนุญาตใช้ของไม่ผ่านแบบมีเงื่อนไข ต้องลงนามหลายฝ่าย
- **Input:** NCR (disposition=uai), เหตุผล/เงื่อนไข, root/corrective/preventive (purchasing), รูป
- **Process:** 9 ขั้นลงนาม (§5.2), ลายเซ็นเก็บเป็นไฟล์ (ไม่ใช่ base64)
- **Rule:** role sign ต้องตรง `SIGN_ROLE_MAP`; reject ย้อนสถานะ
- **Edge:** exec reject → uai_rejected_by_exec

### FR‑4 IPQC (In‑Process QC)
- **Purpose:** บันทึกของเสียระหว่างผลิต (อ้าง `pro_code_sap` ไม่ใช่ `products`)
- **Process:** สร้าง → gen defect_code (server) → open→in_progress→closed; มี rounds/schedules/check‑templates สำหรับตรวจตามแผน
- **Rule:** defect_code/record_no immutable; ProCodeSAP dropdown เฉพาะ confirmed; รูปลบได้เฉพาะ open
- **Edge:** IPNCR เปิดจากของเสียที่ต้องแก้ (flow §5.4)

### FR‑5 FQC / FGQC (Final / Finished‑Goods QC)
- **Purpose:** ตรวจสินค้าสำเร็จ; FQC = daily lot, FGQC = AQL หรือ 100%
- **Process:** บันทึก total/defect → คำนวณ defect_rate ณ save → pass/fail/conditional; monthly approval (qc_manager→production_manager→cpo)
- **Rule:** defect_rate เก็บ ณ save; FQC ไม่มี cancel (correction ใหม่); monthly approval unique (year,month,line,role)

### FR‑6 FG Defect → FNCP → FUAI
- **Purpose:** ของเสียสินค้าสำเร็จ → NCP ฝ่ายผลิต → ขอใช้ต่อ (FUAI)
- **Process:** FNCP flow (§5.3); FM=5M+E; prod_token ให้ฝ่ายผลิต/QC ตอบกลับ (public link)
- **Rule:** FM=Material → ผู้ตอบ = "QC รับเข้า"; prod_token crypto 64‑hex

### FR‑7 KPI
- **Purpose:** ตั้ง KPI + target รายเดือน + บันทึกผล + อนุมัติ
- **Process:** admin ตั้ง group/item/target → บันทึก report → อนุมัติ (admin→qc_manager→cpo→qmr)
- **Rule:** unique (item,year,month); optimistic lock ทุกขั้น (⚠️ มี 3 กลไกคู่ขนาน — ดู AUDIT.md D3)

### FR‑8 QC Attendance
- **Purpose:** เช็คชื่อ QC ด้วยพิกัด + geofence
- **Rule:** geofence ตรวจฝั่ง server (haversine); unique (user,date); คำนวณ late/work minutes; Telegram + SSE

### FR‑9 Delivery / Holidays
- **Purpose:** วางแผน/ติดตามการส่งของ supplier
- **Rule:** purchasing สร้าง/แก้/ลบเฉพาะ status=pending; หลัง QC ack ลบไม่ได้ (ใช้ยกเลิก); late/rescheduled บังคับเหตุผล; QC บันทึกนอกแผน (is_unplanned)

### FR‑10 Issue Talk / Master / ProCodeSAP‑PDPlan / Reports
- **Issue Talk:** กระทู้ + participant + thread message + attachment + read tracking
- **Master:** CRUD + import/export Excel, soft delete (is_active), FK ON DELETE RESTRICT
- **ProCodeSAP/PDPlan:** import Excel (scan‑based header detection) + classifier 5 ชั้น; admin confirm ก่อนใช้งาน
- **Reports/Export:** PDF/Excel ฝั่ง server เท่านั้น, `Content-Disposition: attachment`, rate‑limit 5/นาที

---

## 5. Workflow & State Machines

### 5.1 NCR
`pending_supervisor → pending_manager(+disposition) → pending_qmr_open → pending_purchasing_review → pending_supplier → pending_manager_review → pending_qmr_close → closed`
แยก: `pending_supplier_resubmit`, `uai_pending_qc_manager`, `ncp_closed`, `cancelled`

### 5.2 UAI
`uai_pending_qc_manager → _purchasing → _cco → _cmo → _cpo → _qc_ack → _production_ack → _qmr_ack → uai_completed` (+ `uai_rejected`, `uai_rejected_by_exec`)

### 5.3 FNCP → FUAI
`open → in_progress → waiting_verify → supervisor_approved → verified → closed` (+ `reject`, `fuai_opened → FUAI sign flow`)

### 5.4 IPNCR
`pending_review → acknowledged → in_progress → (prod_manager_approved) → waiting_verify → verified → closed` (+ `rejected → rechecking`)

### 5.5 KPI Report
`draft → pending_qcm → pending_cpo → pending_qmr → approved` (reject → กลับ draft)

> ทุก transition ใช้ **optimistic lock** — ดู CLAUDE.md §2.4

---

## 6. Business Rules (ISO 9001)

- **Disposition NCR:** บังคับเลือกก่อน sign; `uai` → trigger UAI; `re_inspect` → block ปิดจน re‑inspection pass
- **Drawing Revision:** `is_current=1` unique/product; อัปโหลดใหม่ set เดิม obsolete (transaction); ห้ามลบ
- **Lot/Batch Traceability:** require_lot_number / require_expiry_date ตาม product_group; expiry < received → block
- **Calibration:** out_of_service ไม่ขึ้น dropdown; next_calibration < today → warning
- **Supplier Evaluation:** Grade A(≥90) B(75‑89) C(60‑74) D(<60); Risk score = likelihood × impact (ห้ามลบ → closed)
- **Defect Code (IPQC):** generate server‑side, immutable
- **Soft Delete:** เอกสารใช้ status cancelled; master ใช้ is_active — ห้าม hard delete ที่มี FK

---

## 7. Non‑Functional Requirements

| ด้าน | ข้อกำหนด |
|------|----------|
| Security | JWT httpOnly (8h) + session_token single‑login; bcrypt 12; login limit 5/15นาที; magic‑number upload; rate‑limit global/supplier/export; audit log |
| Performance | list ต้อง pagination + LIMIT; sequence atomic; index ครบทุก FK/filter |
| Availability | single‑instance (SSE/Chromium in‑process); graceful shutdown; healthcheck `/api/health`; backup SQLite `.backup` (แนะนำ cron 7 วัน) |
| i18n | UI ภาษาไทยหลัก; ฟิลด์ supplier bilingual; รหัสเอกสาร/ตัวเลข mono |
| Mobile | Bottom nav; ปุ่ม/input ≥ 44px; signature/camera = full‑page route (ไม่ modal ซ้อน) |
| Compliance | ISO 9001 traceability + approval trail + audit |
| Real‑time | SSE (ไม่ WebSocket); Telegram fire‑and‑forget (ส่งไม่ได้ไม่ crash) |

---

## 8. Acceptance Criteria (ตัวอย่าง)

- **AC‑Bill‑1:** qc_staff (incoming) สร้างบิล + item → submit → qc_manager approve → สถานะ approved + audit log ครบ
- **AC‑NCR‑1:** เปิด NCR จาก bill_item ที่ fail → ไม่สามารถเลือก bill_item เดิมซ้ำได้
- **AC‑NCR‑2:** supplier เปิด link (token valid) → ตอบ root cause/CA/PA → สถานะ → pending_manager_review
- **AC‑UAI‑1:** ครบ 9 ลายเซ็น → uai_completed; ถ้า exec reject → uai_rejected_by_exec (ไม่ปิด)
- **AC‑IPQC‑1:** สร้าง IPQC → defect_code ถูก gen ฝั่ง server และแก้ไม่ได้หลัง save
- **AC‑FQC‑1:** defect_rate ที่แสดงใน list = ค่าที่เก็บตอน save (ไม่ recompute)
- **AC‑Attn‑1:** check‑in นอก geofence → geofence_ok=0 (ตรวจฝั่ง server)
- **AC‑Sec‑1:** login ผิด 5 ครั้ง/15นาที → ถูก block; upload ไฟล์ปลอม extension → ถูกปฏิเสธด้วย magic‑number

---

## 9. KPI ความสำเร็จของระบบ

- NCR cycle time (เปิด→ปิด) ลดลง
- % เอกสารมี disposition/approval ครบตาม flow = 100%
- Supplier response rate ผ่าน link เพิ่มขึ้น
- Defect rate (IPQC/FQC) ต่ำกว่า threshold (ค่าเริ่ม 3%)
- FQC monthly approval ตรงเวลา

---

## 10. Future Roadmap

**ระยะสั้น (P0/P1 จาก AUDIT.md §12):** แก้ role drift + test suite, ตั้ง CI/CD, versioned migration, สกัด service layer
**ระยะกลาง:** รวม/นิยาม KPI (reports/action_plans/actuals), แตก Dashboard god file + endpoint aggregate, API versioning + OpenAPI
**ระยะยาว:** horizontal scale (Redis SSE + แยก PDF service), พิจารณา PostgreSQL + TypeScript migration, offline PWA (อ่านอย่างเดียว)

*จบเอกสาร PRD.md v3.0 (consolidated) — ปรับปรุงล่าสุด 2026‑07‑02*
