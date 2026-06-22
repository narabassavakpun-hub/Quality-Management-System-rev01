# PRD — IQC Quality Management System (rev01)

**Version:** 2.0 | **Updated:** 2026-06-16 | **Status:** Production

---

## 1. Executive Summary

ระบบ IQC (Incoming Quality Control) เป็น Web Application สำหรับจัดการกระบวนการตรวจรับสินค้าเข้า ออกเอกสาร NCR/NCP ติดตาม Supplier Response และอนุมัติเอกสาร UAI ออกแบบให้รองรับ ISO 9001:2015 §8.4 (Approved Supplier) §8.7 (Non-conforming outputs) รองรับผู้ใช้งาน 20 คนพร้อมกัน

**Stack:** React 18 + Vite / Express.js / SQLite (better-sqlite3) / JWT Cookie / SSE

---

## 2. User Roles & Permissions Matrix

| Role | Bills | NCR/NCP | UAI | Master | Reports | Admin | Delivery |
|------|-------|---------|-----|--------|---------|-------|----------|
| `admin` | R | R | R | CRUD | R | CRUD | R |
| `qc_staff` | Create/Edit | Create | - | - | - | - | R/Unplanned |
| `qc_supervisor` | Approve | Approve L1 | - | - | - | - | Acknowledge |
| `qc_manager` | R | Approve L2 / Disposition / Check Response | Sign | - | R | - | R |
| `qmr` | - | Approve Open/Close | Sign (ack) | - | - | - | - |
| `purchasing` | - | Send to Supplier / Copy Link | Create / Sign | - | - | - | CRUD |
| `cco` | - | - | Sign (approve) | - | R | - | - |
| `cmo` | - | - | Sign (approve) | - | R | - | - |
| `cpo` | - | - | Sign (approve) | - | R | - | - |
| `production_manager` | - | - | Sign (ack) | - | - | - | - |
| `supplier` (no login) | - | Respond via token link | - | - | - | - | - |

---

## 3. Master Data (Admin Only)

### 3.1 Suppliers — Approved Supplier List (ASL)

- Fields: code, name, email, phone, notes, approval_status, approval_date, next_evaluation_date
- `approval_status`: `approved` / `trial` / `suspended` / `blacklisted`
- การเปลี่ยนสถานะ **ต้องกรอกเหตุผล** → บันทึกใน `supplier_approval_history`
- Supplier ที่ `suspended`/`blacklisted` ไม่ขึ้น dropdown ทุกที่
- Soft delete (`is_active=0`) — ห้าม DELETE จริง
- Evaluation: คะแนน 3 ด้าน (quality/delivery/response) → Grade A(≥90) B(75-89) C(60-74) D(<60)
- Risk Register: likelihood × impact = risk_score, Level Low/Medium/High/Critical

### 3.2 Products

- Fields: code, name, supplier, product_group, unit, model, inspection_level, aql_value
- Many-to-many: สี (product_colors), Supplier (product_suppliers)
- รูปสินค้า: type `product` / `quality_issue`
- Drawing Revision: `is_current=1` มีได้ 1 record/product (enforce ด้วย transaction)
- เมื่ออัปโหลด revision ใหม่ → set `is_current=0` ของเดิม + `obsoleted_at=now()`

### 3.3 Product Groups — Compliance Flags

| Flag | ผลลัพธ์ |
|------|---------|
| `require_lot_number` | บังคับกรอก lot_number บน bill_item |
| `require_expiry_date` | บังคับกรอก expiry_date |
| `require_inspection_doc` | บังคับแนบเอกสาร |
| `require_certificate` | บังคับแนบ certificate |
| `has_shelf_life` + `shelf_life_days` | auto-check expiry warning/block |

### 3.4 Measuring Equipment (Calibration)

- Fields: equipment_code, name, serial_number, location, calibration_interval_days, last_calibrated_date
- status: `active` / `out_of_service` / `calibrating`
- next_calibration = last_calibrated_date + interval
- เครื่องมือ overdue หรือ `out_of_service` → ไม่ขึ้น dropdown + แสดง warning

### 3.5 AQL Tables

- Pre-seeded ตาม ISO 2859-1: GEN_I, GEN_II, GEN_III, S1, S2, S3, S4
- ระบบ auto-lookup sample_size, accept_number, reject_number จาก batch size

### 3.6 อื่นๆ

Units (หน่วยนับ) | Defect Categories (กลุ่มปัญหา) | Colors (สีสินค้า + hex_code)

---

## 4. Bill Incoming Inspection

### 4.1 การสร้างและกรอกข้อมูล

1. QC Staff สร้างบิล (draft): invoice_no, po_no, container_no, supplier, received_date
2. เพิ่มรายการตรวจ (bill_items): เลือก product → auto-fill group + unit
3. กรอก qty_received → ระบบ lookup AQL → แสดง qty_sampled แนะนำ
4. กรอก qty_passed, qty_failed, defect_category, defect_detail
5. อัปโหลด: รูปบิล, รูปปัญหา, inspection docs, certificates, equipment used
6. Auto-draft sessionStorage ทุก 30 วินาที + beforeunload
7. เมื่อกลับมาหน้า → ถามว่า "พบ draft ที่ยังไม่ได้บันทึก ต้องการกู้คืนไหม?"

### 4.2 Validation Rules

| Rule | Type |
|------|------|
| require_lot_number + lot_number ว่าง | Hard block |
| expiry_date < received_date | Hard block |
| expiry_date - today < 30 วัน | Warning (orange) |
| เครื่องมือ next_calibration < today | Warning (ต้องยืนยัน) |
| qty_failed > 0 แต่ไม่มี defect_category | Hard block |

### 4.3 Status Machine

```
draft → pending_approval → approved
pending_approval → editing (QC Supervisor ส่งกลับ)
editing → pending_approval
draft/pending_approval → cancelled (เจ้าของ, ไม่มี NCR)
```

### 4.4 List Page Features

- Filter: ค้นหา (Invoice/PO/Supplier), สถานะ (computed), วันนี้รับเข้า, ผู้ออกเอกสาร
- Pagination: 10 แถว/หน้า, No. รันเลขต่อเนื่อง
- Computed status: ร่าง / รออนุมัติ / รอเปิดเอกสาร NCR/NCP / รอดำเนินการ / เสร็จสิ้น / ยกเลิก

---

## 5. NCR — Non-Conformance Report

### 5.1 การสร้าง

- QC Staff เปิดจาก bill_id → เลือกรายการที่มี qty_failed > 0 และยังไม่มี NCR
- 1 NCR = หลายรายการจากบิลเดียว (ncr_items)
- NCR Code: `NCR-YYYY-0001` (atomic sequence, reset ทุกปี)
- severity: `major` → NCR workflow / `minor` → NCP workflow

### 5.2 NCR Workflow (Major)

| สถานะ | ผู้ดำเนินการ | Action |
|-------|------------|--------|
| `pending_supervisor` | qc_supervisor | อนุมัติ / ส่งกลับ |
| `pending_manager` | qc_manager | อนุมัติ + กำหนด disposition |
| `pending_qmr_open` | qmr | อนุมัติเปิด NCR |
| `pending_purchasing_review` | purchasing | รับทราบ + Review + Copy Link |
| `pending_supplier` | supplier (token) | ตอบกลับ (respondent_name บังคับ) |
| `pending_manager_review` | qc_manager | ตรวจสอบคำตอบ |
| `pending_supplier_resubmit` | purchasing | Reset → ส่ง Supplier ตอบใหม่ |
| `pending_qmr_close` | qmr | อนุมัติปิด |
| `closed` | — | ปิดแล้ว |

### 5.3 NCP Workflow (Minor)

`pending_supervisor` → QC Supervisor อนุมัติปิด → `ncp_closed`

### 5.4 Disposition

| ตัวเลือก | ผลลัพธ์ |
|---------|---------|
| `return` | ส่งคืน Supplier |
| `rework` | แก้ไขก่อนใช้ |
| `scrap` | ทำลาย |
| `uai` | ขอใช้แบบมีเงื่อนไข → trigger UAI |
| `re_inspect` | ตรวจซ้ำ → ต้องผ่านก่อนปิด NCR |

### 5.5 Supplier Response Loop

```
pending_purchasing_review
  → (Purchasing Copy Link)
pending_supplier
  → (Supplier กรอก: respondent_name*, root_cause*, corrective_action*, preventive_action*)
pending_manager_review
  → [อนุมัติ] → pending_qmr_close
  → [ปฏิเสธ] → pending_supplier_resubmit
                  → (Purchasing กด "ทุกอย่างกลับมาเหมือนเดิม")
                  → pending_purchasing_review (วนซ้ำ, old response superseded)
```

### 5.6 Timeline การดำเนินการ

รวม events จาก: ncr_approvals + supplier_responses + purchasing_received_at + link_copied_at เรียง timestamp

### 5.7 Re-inspection

- บันทึกได้หลายรอบ (round 1, 2, 3…)
- Round > 3 → แจ้งเตือน QMR พิเศษ
- ทุก round: inspector_id + inspected_at + result

### 5.8 Effectiveness Check

- QC Manager กำหนด effectiveness_check_date
- ห้ามปิด NCR ถ้า check_date ยังไม่ถึง
- result: `effective` / `not_effective` → ถ้าไม่ผ่านต้องกำหนด date ใหม่

---

## 6. UAI — Use-As-Is Authorization

### 6.1 Trigger

NCR disposition = `uai` → NCR status ข้ามไป `uai_pending_qc_manager` → Purchasing สร้าง UAI

### 6.2 Signature Cascade (ตามลำดับ บล็อกจนกว่าจะถึงคิว)

```
1. qc_manager review/approve
2. purchasing signs (ออกเอกสาร)
3. cco approves
4. cmo approves
5. cpo approves
6. qc_manager acknowledges
7. production_manager acknowledges
8. qmr acknowledges → uai_completed
```

### 6.3 Rules

- CCO/CMO/CPO: มีปุ่ม "ไม่อนุมัติ" + บังคับกรอกเหตุผล → `uai_rejected_by_exec`
- แต่ละช่อง signature มี textarea ข้อเสนอแนะ (optional)
- ห้าม export PDF ก่อน `uai_completed`
- Purchasing ลบ UAI ได้เฉพาะก่อน sign

---

## 7. Delivery Schedule

### 7.1 Planned Delivery (Purchasing)

- สร้าง: supplier, scheduled_date, time_slot, items, notes
- แก้ไข/ลบ: เฉพาะ status=`pending`
- ลบหลัง QC acknowledge ไม่ได้ → ใช้ "ยกเลิก"

### 7.2 Unplanned Delivery (QC Staff/Supervisor)

- `POST /api/delivery/unplanned` → is_unplanned=1, status=`on_time`
- ปฏิทินแสดง badge "นอกแผน" สีแดง

### 7.3 Status Flow

`pending` → `acknowledged` (QC) → `on_time` / `late` (ต้องกรอกเหตุผล) / `rescheduled` / `cancelled`

### 7.4 Cron Jobs

| เวลา | Action |
|------|--------|
| 08:00 ทุกวัน | แจ้งเตือนถ้ามี delivery พรุ่งนี้ |
| 18:00 ทุกวัน | แจ้ง Purchasing ถ้า delivery วันนี้ยังไม่อัปเดต |

---

## 8. Notifications

### 8.1 In-App (SSE)

| Event | Push ถึง |
|-------|---------|
| `bill_created` | qc_supervisor |
| `bill_status_changed` | เจ้าของบิล |
| `ncr_created` | qc_supervisor |
| `ncr_status_changed` | role ที่เกี่ยวข้องตาม workflow |
| `uai_status_changed` | role ที่เกี่ยวข้อง |
| `delivery_created` | qc_staff + qc_supervisor |
| `delivery_updated` | qc_staff + qc_supervisor + purchasing |
| `notification_new` | user ที่รับ |

### 8.2 Telegram

| กลุ่ม | รับ |
|-------|-----|
| กลุ่ม QC | บิลใหม่, NCR ทุกขั้น, UAI QC steps, Delivery ทุก event |
| กลุ่มจัดซื้อ | NCR ที่ต้องส่ง Supplier (พร้อม link), UAI purchasing steps, QC acknowledge delivery |

---

## 9. Export

| ประเภท | Format | Rate Limit |
|--------|--------|-----------|
| Bills list | Excel | 5/min |
| NCR list | Excel + PDF | 5/min |
| NCR individual | PDF (full detail) | 5/min |
| UAI individual | PDF (with signatures) | 5/min |
| Reports | PDF | 5/min |

---

## 10. Non-Functional Requirements

### 10.1 Performance

| Metric | Target |
|--------|--------|
| API response (simple) | < 300ms |
| API response (JOIN + aggregate) | < 1s |
| PDF generation | < 10s |
| Concurrent users | 20 users |
| SQLite DB size | 10GB+ supported (WAL mode) |

### 10.2 Security

- JWT httpOnly cookie, 8h TTL
- bcrypt rounds 12
- CSRF token ทุก mutating request
- Rate limit: login 5/15min, supplier 30/min, export 5/min
- File: magic number validation + UUID rename
- Supplier token: crypto.randomBytes(32), 90 วัน expiry

### 10.3 Reliability

- SQLite WAL mode
- db.transaction() ทุก multi-step operation
- Optimistic lock: `UPDATE ... WHERE status=expected`
- Sequence atomic: prevent duplicate NCR/UAI codes

### 10.4 Compliance

- Audit log: CREATE/APPROVE/SIGN/CLOSE/EXPORT ทุกเอกสาร + LOGIN/LOGIN_FAILED
- Soft delete เอกสารทั้งหมด
- supplier_responses: superseded แทน DELETE
- product_drawings: ห้ามลบ

### 10.5 Usability

- Responsive: xs(375px) sm(640px) md(768px) lg(1024px) xl(1280px)
- Mobile: Bottom Nav Bar + full-page routes สำหรับ Signature/Camera
- Min touch target: 44px
- ห้าม hover-only interaction บน mobile

---

## 11. Out of Scope (v1)

- Email notifications
- Mobile native app (iOS/Android)
- SSO / LDAP
- Barcode/QR scanning
- ERP integration (SAP, Oracle)
- Multi-tenant
