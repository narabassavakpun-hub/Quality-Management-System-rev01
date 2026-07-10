# testcase.md — Test Plan & Coverage (Consolidated)

**ระบบ:** IQC / Quality Management System rev01 · **Updated:** 2026‑07‑02

> รวม test spec เดิม (`TESTCASES.md`, `iqc-system/TESTCASES.md`, `iqc-system/docs/TESTCASE.md`) เป็นฉบับเดียว
> และ **map กับ test suite จริง** ที่รันได้ · อ้างอิงผลวิเคราะห์ใน [`AUDIT.md`](AUDIT.md) §11

---

## สารบัญ
1. [สถานะ Test ปัจจุบัน (ยืนยันจากการรันจริง)](#1-สถานะ-test-ปัจจุบัน-ยืนยันจากการรันจริง)
2. [Test Suite ที่มีจริง (map)](#2-test-suite-ที่มีจริง-map)
3. [Coverage Gap](#3-coverage-gap)
4. [Test Cases รายโมดูล](#4-test-cases-รายโมดูล)
5. [Non‑Functional Tests](#5-non-functional-tests)
6. [แผนต่อยอด (Automation)](#6-แผนต่อยอด-automation)

---

## 1. สถานะ Test ปัจจุบัน (ยืนยันจากการรันจริง)

รัน `cd iqc-system/server && npm test` (= `node --test`) — ล่าสุด 2026‑07‑03 (Session 104):

| ผล | จำนวน | หมายเหตุ |
|----|-------|----------|
| ✅ ผ่าน | **161** | logic + integration (NCR/UAI, Bills, Delivery, KPI report+entries+action plan+master/targets/actuals, FG FNCP/FUAI/IPNCR) |
| ⏭️ skip | 0 | **`ipqc.test.js`/`fqc.test.js` ลบแล้ว (Session 104)** — ทดสอบ table/route ที่ไม่เคยมีจริง (`ipqc_records`/`fqc_records` — ดูรายละเอียดใน §3) ไม่ใช่ gap ของฟีเจอร์ที่ใช้งานจริง |
| ✖ ล้ม | 0 | — |
| **รวม** | **161** | สุขภาพ suite: เขียว, ไม่มี skip ค้าง |

> **ประวัติ:** เดิม (ก่อน Session 87) integration ล้มทั้งหมดที่ setup ด้วย `CHECK constraint failed: role IN (...)` — **แก้แล้ว Session 87** (test fixture)
> แยกต่างหาก: AUDIT.md D1 เคยเข้าใจว่า `users.role CHECK` มีแค่ 10 roles (ไม่มี `prod_supervisor`) — ตรวจซ้ำพบว่าไม่จริง (schema มี 11 roles อยู่แล้ว)
> gap จริงอยู่ที่ frontend `CREATABLE_ROLES` เท่านั้น — **แก้แล้ว Session 105** (ดู AUDIT.md D1/§11, DEVLOG Session 105)

---

## 2. Test Suite ที่มีจริง (map)

| ไฟล์ | ประเภท | ครอบคลุม | สถานะ |
|------|--------|----------|-------|
| `server/test/unit.test.js` | Unit | validate helper (required/int range/enum/date), classifier logic | ✅ |
| `server/test/ipqcUnit.test.js` | Unit | IPQC helper/logic ล้วน | ✅ |
| `server/test/integration.test.js` | Integration | sequence race, optimistic lock, FK RESTRICT, audit/settings helper, migration | ✅ |
| `server/test/ipqcMaster.test.js` | Integration | Master IPQC + import/export | ✅ |
| `server/test/ncrUai.test.js` | Integration (HTTP) | **NCR lifecycle เต็ม + UAI 7‑step sign chain + reject/resubmit branch (mgr reject คำตอบ→purchasing resubmit→supplier ตอบใหม่) + exec reject + guards** | ✅ **31 tests (S89 + S93)** |
| `server/test/bills.test.js` | Integration (HTTP) | **Bills lifecycle (create→add item→submit→approve/reject) + guards (permission, blacklisted supplier, expiry<received, qty sanity, optimistic lock)** | ✅ **11 tests (Session 91)** |
| `server/test/delivery.test.js` | Integration (HTTP) | **Delivery (create/unplanned/acknowledge/status/edit/delete) + guards (permission purchasing↔qc, unplanned lock, late reason, ลบเฉพาะ pending)** | ✅ **13 tests (Session 92)** |
| `server/test/kpiReport.test.js` | Integration (HTTP) | **KPI report approval (create→submit→qcm→cpo→qmr→approved / reject→revise) + guards (duplicate, permission, wrong role/status, reject reason)** | ✅ **11 tests (Session 94)** |
| `server/test/kpiActionPlan.test.js` | Integration (HTTP) | **KPI action plan approval (create→submit→qcm→cpo→qmr→approved / reject→draft+revision) + guards (permission, wrong role/status, reject reason, submit non-draft 409)** | ✅ **10 tests (Session 95)** |
| `server/test/kpiMaster.test.js` | Integration (HTTP) | **KPI master/targets/actuals CRUD (groups create/update/delete-blocked-by-items, title-templates/units/no-patterns create+duplicate guard, items auto-kpi_no+update+reorder, targets single+bulk upsert+delete-year, actuals upsert-overwrite+bulk)** | ✅ **15 tests (Session 102)** |
| `server/test/fgFncp.test.js` | Integration (HTTP) | **FG FNCP state machine (start→submit-verify→verify→close / reject / supervisor→manager approve, minor vs major) + guards (PROD/QC roles, wrong status 409, reject reason)** | ✅ **9 tests (Session 96)** |
| `server/test/fgFuai.test.js` | Integration (HTTP) | **FG FUAI approval/ack (prod_manager→cpo→qc_manager→staff_ack→supervisor_ack→closed / cpo+qcm reject reopen FNCP) + guards (permission, wrong status 409, reject reason)** | ✅ **6 tests (Session 97)** |
| `server/test/ipncr.test.js` | Integration (HTTP) | **IPNCR (create→acknowledge→start-recheck→submit-for-qc→qc-reinspect pass/fail loop→close / cancel) + guards (permission QC/PROD, optimistic lock, required fields)** | ✅ **12 tests (Session 98)** |
| ~~`server/test/ipqc.test.js`~~ | — | **ลบแล้ว (Session 104)** — เดิมทดสอบ `ipqc_records`/`routes/ipqc` ซึ่งพิสูจน์แล้วว่าเป็น**ตารางที่ไม่เคยมี route จริงเลย** (ไม่ใช่แค่ path ผิด — ข้อมูลเดิมสมมติผิดว่า IPQC ใช้ `ipqc_records`) ตารางจริงที่ใช้งานคือ `ipqc_inspections` ผ่าน `ipqcInspection.js` ซึ่ง**ยังไม่มี integration test คลุม flow create→submit เลย** — ดู §3 gap ใหม่ |
| ~~`server/test/fqc.test.js`~~ | — | **ลบแล้ว (Session 104)** พร้อมตาราง `fqc_records`+3 child tables ออกจาก schema — ยืนยันไม่มี route/reference ค้าง (0 แถวใน production DB ด้วย); ฟีเจอร์ FQC ถูกแทนที่ด้วย `fgqc_records` ภายใต้ FG Production module สมบูรณ์แล้ว |

Framework: **node:test (built‑in)** + express + fetch (HTTP integration) — ไม่มี vitest/jest; ไม่มี E2E (Playwright); ไม่มี load test

---

## 3. Coverage Gap

| พื้นที่ | มี test? | Priority เพิ่ม |
|--------|----------|----------------|
| ProCodeSAP classifier | ✅ | — |
| Bills lifecycle (create→approve/reject) | ✅ **bills.test.js (Session 91)** | — |
| Delivery (create/ack/status/edit/delete) | ✅ **delivery.test.js (Session 92)** | — |
| KPI report approval flow | ✅ **kpiReport.test.js (Session 94)** | — |
| KPI action plan approval flow | ✅ **kpiActionPlan.test.js (Session 95)** | — |
| KPI master/targets/actuals CRUD | ✅ **kpiMaster.test.js (Session 102)** | — |
| FG FNCP state machine | ✅ **fgFncp.test.js (Session 96)** | — |
| FG FUAI approval/ack flow | ✅ **fgFuai.test.js (Session 97)** | — |
| FG IPNCR in-process defect flow | ✅ **ipncr.test.js (Session 98)** | — |
| NCR flow (create→closed) | ✅ **ncrUai.test.js (Session 89)** | — |
| UAI sign flow (7 ขั้น → completed) | ✅ **ncrUai.test.js (Session 89)** | — |
| Supplier response (public token) | ✅ **ncrUai.test.js** | — |
| NCR/UAI permission + state guards | ✅ **ncrUai.test.js** | — |
| IPQC master data (lines/defect types/thresholds) | ✅ `ipqcMaster.test.js` | — |
| **IPQC inspection create→submit flow (`ipqc_inspections`, ตัวจริงที่ใช้งาน)** | ❌ **gap ใหม่ (พบ Session 104)** — draft→submit, AQL calc, checklist items, images ไม่มี integration test เลย (เพิ่งพบว่า `ipqc.test.js` เดิมทดสอบ `ipqc_records` คนละตารางที่ไม่เคยมี route จริง) | **P1** |
| FQC create+status | N/A — ฟีเจอร์/ตาราง `fqc_records` ถูกลบแล้ว (Session 104, superseded by `fgqc_records` สมบูรณ์) | — |
| FNCP → FUAI flow | ❌ | P1 |
| Auth / login rate‑limit / session_token | ❌ | P1 |
| Permission matrix (ทุก route) | ⚠️ บางส่วน (NCR/UAI แล้ว) | P1 |
| Optimistic lock (double‑approve) | ✅ integration (DB) | — |
| File upload magic‑number reject | ❌ | P2 |
| Sequence race condition | ❌ | P2 |
| E2E (login→bill→NCR→export) | ❌ | P2 |
| Load / concurrency (10–200 users) | ❌ | P3 |

---

## 4. Test Cases รายโมดูล

รูปแบบ: **ID · Module · Scenario · Precondition · Steps · Expected · (Neg/Boundary/Perm) · Priority**

### Auth & Security
| ID | Scenario | Steps | Expected | Prio |
|----|----------|-------|----------|------|
| A‑01 | Login สำเร็จ | POST /auth/login (user/pass ถูก) | 200 + set cookie httpOnly + session_token | P0 |
| A‑02 | Login ผิด 5 ครั้ง/15นาที | POST ผิด ×5 | ครั้งที่ 6 ถูก block (429) | P0 |
| A‑03 | Single‑login | login เครื่อง B | session เครื่อง A ใช้ไม่ได้ | P1 |
| A‑04 | Upload ไฟล์ปลอม (.exe เปลี่ยนเป็น .jpg) | upload | ปฏิเสธ (magic‑number ไม่ตรง) | P2 |
| A‑05 | เปลี่ยนรหัสผ่านต้องกรอกเดิม | POST /auth/change-password (เดิมผิด) | 400 | P1 |

### Bills / NCR / UAI
| ID | Scenario | Expected | Prio |
|----|----------|----------|------|
| B‑01 | สร้าง→submit→approve | สถานะ approved + audit | P0 |
| B‑02 | supplier blacklisted | block การสร้างบิล | P1 |
| B‑03 | expiry < received | hard block | P1 |
| N‑01 | เปิด NCR จาก bill_item fail | สร้างสำเร็จ + token 64‑hex | P0 |
| N‑02 | bill_item ซ้ำใน NCR | ปฏิเสธ | P1 |
| N‑03 | double‑approve (optimistic lock) | ครั้งที่ 2 error "ถูกดำเนินการแล้ว" | P1 |
| N‑04 | supplier ตอบผ่าน token หมดอายุ | block | P1 |
| U‑01 | UAI ครบ 9 ลายเซ็น | uai_completed | P1 |
| U‑02 | exec reject | uai_rejected_by_exec | P1 |

### IPQC / FQC / FG
| ID | Scenario | Expected | Prio |
|----|----------|----------|------|
| I‑01 | สร้าง IPQC | defect_code gen ฝั่ง server, immutable | P0 |
| I‑02 | ProCodeSAP dropdown | เห็นเฉพาะ confirmed | P1 |
| F‑01 | FQC defect_rate | เก็บ ณ save, list ไม่ recompute | P0 |
| F‑02 | FQC monthly approval ซ้ำ | UNIQUE block | P1 |
| FN‑01 | FNCP FM=Material | ผู้ตอบ = "QC รับเข้า" | P1 |

### Master / Attendance / KPI
| ID | Scenario | Expected | Prio |
|----|----------|----------|------|
| M‑01 | ลบ master ที่มี FK | block (RESTRICT) → soft delete | P1 |
| M‑02 | import Excel header ย้ายคอลัมน์ | map ด้วยชื่อ ไม่ใช่ตำแหน่ง | P2 |
| AT‑01 | check‑in นอก geofence | geofence_ok=0 (server verify) | P1 |
| AT‑02 | check‑in ซ้ำวันเดียว | UNIQUE block | P2 |
| K‑01 | KPI approve flow | admin→qcm→cpo→qmr → approved | P2 |

---

## 5. Non‑Functional Tests

| ID | ประเภท | Scenario | KPI |
|----|--------|----------|-----|
| P‑01 | Load | 10/20/50/100/200 concurrent: login, bills CRUD, search, export, dashboard | response < 1s (p95), error < 1% |
| P‑02 | Stress | เปิด NCR พร้อมกัน 50 | ไม่ duplicate code (atomic sequence) |
| P‑03 | Backup/Restore | `.backup` ระหว่าง online → restore | integrity_check = ok |
| P‑04 | Migration | fresh DB + old DB → start | ครบ 105 ตาราง, ไม่ crash |
| P‑05 | SSE | 50 client เชื่อม + status change | ทุก client ได้ event ตรง role |

---

## 6. แผนต่อยอด (Automation)

1. **P0:** แก้ role fixture/constraint → ให้ integration test 6 ไฟล์รันเขียว
2. **P1:** ตั้ง CI (GitHub Actions): `npm test` + `npm run build` ทุก PR (ปัจจุบันไม่มี CI)
3. **P1:** เพิ่ม API integration (supertest) — auth, NCR/UAI flow, permission matrix
4. **P2:** Playwright smoke (login/bill/NCR/export) — mobile + desktop viewport
5. **P3:** k6/Artillery load test ตาม §5 (10–200 users)

> ทุก test ใช้ DB แยก (temp) + seed คงที่ เพื่อรันพร้อมกันได้ (10–20 คน) และ reset ได้

*จบเอกสาร testcase.md — ปรับปรุงล่าสุด 2026‑07‑02*
