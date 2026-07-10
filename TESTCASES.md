> ⚠️ **DEPRECATED (2026-07-02)** — รวมเข้า [`testcase.md`](testcase.md) แล้ว (map กับ test suite จริง) เก็บไว้เป็นประวัติ

# TESTCASES.md — IQC Quality Management System

**Version:** 2.0 | **Updated:** 2026-06-16  
**Level:** QA Senior Engineer  
**Symbols:** ✅ Pass | ❌ Fail | ⬜ Not Tested | ⚠️ Blocked

---

## สารบัญ

1. [Authentication & Session](#1-authentication--session)
2. [Master Data Management](#2-master-data-management)
3. [Bill Incoming Inspection](#3-bill-incoming-inspection)
4. [NCR Workflow](#4-ncr-workflow)
5. [NCP Workflow](#5-ncp-workflow-minor)
6. [UAI Workflow](#6-uai-workflow)
7. [Supplier Portal (Public)](#7-supplier-portal-public)
8. [Delivery Schedule](#8-delivery-schedule)
9. [Notifications & SSE](#9-notifications--sse)
10. [Export (PDF/Excel)](#10-export-pdfexcel)
11. [Reports](#11-reports)
12. [Admin](#12-admin)
13. [Security & Authorization](#13-security--authorization)
14. [File Upload](#14-file-upload)
15. [Concurrency — 10–20 Users](#15-concurrency--1020-users)
16. [Regression Scenarios](#16-regression-scenarios)

---

## 1. Authentication & Session

### TC-AUTH-001 — Login สำเร็จ

**Pre-condition:** Server รัน, user `admin` / pw `admin1234` มีอยู่ใน DB  
**Steps:**
1. POST `/api/auth/login` body: `{ username: 'admin', password: 'admin1234' }`  
**Expected:**
- HTTP 200
- Response: `{ ok: true, user: { id, username, full_name, role: 'admin' } }`
- Cookie `token` set: httpOnly=true, sameSite=strict, maxAge=8h
- audit_logs บันทึก action=LOGIN

### TC-AUTH-002 — Login ผิด Password

**Steps:** POST login พร้อม password ผิด  
**Expected:**
- HTTP 401
- `{ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' }`
- audit_logs บันทึก action=LOGIN_FAILED

### TC-AUTH-003 — Rate Limit Login (5 ครั้ง / 15 นาที)

**Steps:** POST login ผิด 5 ครั้งติดต่อกัน → ครั้งที่ 6  
**Expected:**
- ครั้งที่ 1-5: HTTP 401
- ครั้งที่ 6: HTTP 429 `{ error: 'ลองใหม่ได้ใน 15 นาที' }`

### TC-AUTH-004 — Access Protected Route โดยไม่มี Cookie

**Steps:** GET `/api/bills` โดยไม่มี cookie  
**Expected:** HTTP 401 `{ error: 'กรุณาเข้าสู่ระบบ' }`

### TC-AUTH-005 — JWT Expired

**Steps:** ใช้ JWT ที่ expire แล้ว (mock หรือรอ 8h)  
**Expected:** HTTP 401 `{ error: 'Session หมดอายุ กรุณาเข้าสู่ระบบใหม่' }`

### TC-AUTH-006 — Logout

**Steps:** POST `/api/auth/logout` พร้อม valid cookie  
**Expected:**
- HTTP 200
- Cookie `token` cleared (maxAge=0)
- Subsequent request return 401

### TC-AUTH-007 — GET /api/auth/me

**Steps:** GET `/api/auth/me` พร้อม valid cookie  
**Expected:** HTTP 200 `{ id, username, full_name, role }`

### TC-AUTH-008 — User Inactive ถูก Block

**Pre-condition:** Admin set is_active=0 สำหรับ user X  
**Steps:** User X พยายาม login  
**Expected:** HTTP 401 `{ error: 'บัญชีถูกระงับ' }` หรือ login ไม่สำเร็จ

### TC-AUTH-009 — Change Password สำเร็จ

**Steps:** POST `/api/auth/change-password` `{ currentPassword, newPassword: 'NewPass123' }`  
**Expected:** HTTP 200, login ด้วย password ใหม่ได้

### TC-AUTH-010 — Change Password ผิด Password เดิม

**Expected:** HTTP 400 `{ error: 'รหัสผ่านเดิมไม่ถูกต้อง' }`

### TC-AUTH-011 — Change Password สั้นกว่า 8 ตัว

**Expected:** HTTP 400 validation error

### TC-AUTH-012 — Admin Reset Password User

**Steps:** POST `/api/admin/users/:id/reset-password` by admin  
**Expected:** HTTP 200, user login ด้วย password ใหม่ได้, บันทึกใน password_reset_logs

---

## 2. Master Data Management

### TC-MASTER-001 — สร้าง Supplier (Admin)

**Steps:** POST `/api/master/suppliers` `{ code: 'SUP-001', name: 'Test Supplier', ... }`  
**Expected:**
- HTTP 201
- Supplier ปรากฏใน GET `/api/master/suppliers`
- approval_status default = 'trial'

### TC-MASTER-002 — สร้าง Supplier (Non-Admin)

**Steps:** qc_staff POST `/api/master/suppliers`  
**Expected:** HTTP 403

### TC-MASTER-003 — Supplier Code ซ้ำ

**Steps:** POST supplier พร้อม code ที่มีอยู่แล้ว  
**Expected:** HTTP 409 หรือ 400 duplicate error

### TC-MASTER-004 — Toggle Supplier Inactive

**Steps:** PATCH `/api/master/suppliers/:id/toggle` by admin  
**Expected:** is_active เปลี่ยนเป็น 0, ไม่ปรากฏใน dropdown (active only)

### TC-MASTER-005 — เปลี่ยน Approval Status ของ Supplier

**Steps:** PATCH `/api/master/suppliers/:id/approval-status`  
Body: `{ approval_status: 'suspended', reason: 'คุณภาพต่ำกว่าเกณฑ์' }`  
**Expected:**
- HTTP 200
- supplier_approval_history บันทึก reason
- Supplier ที่ suspended ไม่ขึ้น dropdown

### TC-MASTER-006 — เปลี่ยน Approval Status โดยไม่กรอก Reason

**Expected:** HTTP 400 `{ error: 'กรุณากรอกเหตุผล' }`

### TC-MASTER-007 — สร้าง Product

**Steps:** POST `/api/master/products` พร้อม supplier_id, product_group_id, unit_id  
**Expected:** HTTP 201, product ปรากฏในรายการ

### TC-MASTER-008 — อัปโหลด Drawing Revision

**Steps:** POST `/api/master/products/:id/drawing` ไฟล์ PDF + revision='Rev.B'  
**Expected:**
- HTTP 200
- Drawing Rev.B: is_current=1
- Drawing Rev.A (เก่า): is_current=0, obsoleted_at set
- ทั้งหมดใน transaction เดียว (ถ้าล้มกลางทาง ทั้งคู่ไม่เปลี่ยน)

### TC-MASTER-009 — Product Group require_lot_number Flag

**Steps:** สร้าง product group: require_lot_number=1 → เลือก product นี้ในบิล → ไม่กรอก lot_number  
**Expected:** ระบบ block ไม่บันทึก + error message

### TC-MASTER-010 — Equipment Overdue Calibration

**Pre-condition:** Equipment next_calibration_date < today  
**Steps:** เปิดฟอร์มสร้างบิล → เลือก equipment นี้  
**Expected:** Warning แสดง "เครื่องมือเกินกำหนดสอบเทียบ" + ต้องยืนยันก่อน

### TC-MASTER-011 — Equipment Out of Service ไม่ขึ้น Dropdown

**Pre-condition:** Equipment status='out_of_service'  
**Expected:** ไม่ปรากฏใน dropdown เมื่อสร้างบิล

### TC-MASTER-012 — AQL Auto-lookup

**Steps:** เลือก product ที่มี inspection_level='GEN_II', aql_value='2.5' + qty_received=200  
**Expected:** ระบบ auto-fill qty_sampled=32, accept=10, reject=11 (ตาม ISO 2859-1)

---

## 3. Bill Incoming Inspection

### TC-BILL-001 — สร้างบิล Draft

**Role:** qc_staff  
**Steps:** POST `/api/bills` `{ invoice_no, po_no, supplier_id, received_date }`  
**Expected:**
- HTTP 201
- status='draft'
- audit_logs CREATE

### TC-BILL-002 — สร้างบิล Role ไม่ถูกต้อง

**Role:** purchasing  
**Expected:** HTTP 403

### TC-BILL-003 — เพิ่ม Bill Item

**Steps:** POST `/api/bills/:id/items` พร้อม product, qty_received=100, qty_sampled=13, qty_passed=13, qty_failed=0  
**Expected:** HTTP 201, bill_items เพิ่มสำเร็จ

### TC-BILL-004 — Expiry Date < Received Date

**Steps:** POST bill_item พร้อม expiry_date='2024-01-01' (ก่อน received_date)  
**Expected:** HTTP 400 `{ error: 'สินค้าหมดอายุแล้ว' }`

### TC-BILL-005 — Expiry Date ภายใน 30 วัน

**Steps:** POST bill_item พร้อม expiry_date = วันนี้ + 20 วัน  
**Expected:** HTTP 201 แต่ response มี `warning: 'สินค้าใกล้หมดอายุ (20 วัน)'`

### TC-BILL-006 — Product Group require_lot_number ไม่กรอก

**Pre-condition:** product_group มี require_lot_number=1  
**Steps:** POST bill_item โดยไม่กรอก lot_number  
**Expected:** HTTP 400 `{ error: 'กรุณากรอก Lot Number' }`

### TC-BILL-007 — Submit บิล (pending_approval)

**Steps:** POST `/api/bills/:id/submit`  
**Expected:**
- HTTP 200
- status='pending_approval'
- Notification ถึง qc_supervisor
- audit_logs APPROVE

### TC-BILL-008 — Submit บิลที่ไม่ใช่ Draft

**Pre-condition:** bill.status='pending_approval'  
**Steps:** POST `/api/bills/:id/submit` อีกครั้ง  
**Expected:** HTTP 400 `{ error: 'เอกสารถูกดำเนินการแล้ว กรุณารีเฟรชหน้า' }` (optimistic lock)

### TC-BILL-009 — QC Supervisor อนุมัติบิล

**Role:** qc_supervisor  
**Steps:** POST `/api/bills/:id/approve`  
**Expected:**
- HTTP 200
- status='approved'
- Notification ถึง qc_staff เจ้าของ
- audit_logs APPROVE

### TC-BILL-010 — QC Supervisor ส่งกลับแก้ไข

**Steps:** POST `/api/bills/:id/reject` พร้อม comment  
**Expected:**
- status='editing'
- Notification ถึง qc_staff

### TC-BILL-011 — ลบบิล (Draft, เจ้าของ)

**Steps:** DELETE `/api/bills/:id` by qc_staff เจ้าของ  
**Expected:** HTTP 200, bill cancelled (soft delete)

### TC-BILL-012 — ลบบิล (ที่มี NCR ผูกอยู่)

**Expected:** HTTP 400 `{ error: 'ไม่สามารถลบบิลที่มี NCR ผูกอยู่' }`

### TC-BILL-013 — ลบบิล (ไม่ใช่เจ้าของ)

**Steps:** qc_staff B พยายามลบบิลของ qc_staff A  
**Expected:** HTTP 403

### TC-BILL-014 — Filter "วันนี้รับเข้า"

**Steps:** GET `/api/bills` → enable todayOnly filter บน client  
**Expected:** แสดงเฉพาะบิลที่ received_date = วันนี้

### TC-BILL-015 — Filter ผู้ออกเอกสาร

**Steps:** GET `/api/bills/creators` → dropdown แสดงชื่อผู้สร้างจริงจาก DB  
**Expected:** รายชื่อเรียง A-Z, unique

### TC-BILL-016 — Pagination 10 แถว/หน้า

**Steps:** สร้างบิล 25 รายการ → เปิดหน้ารายการ  
**Expected:**
- หน้า 1: แสดง No.1–10
- หน้า 2: แสดง No.11–20
- หน้า 3: แสดง No.21–25
- info: "แสดง 1–10 จาก 25 รายการ"

### TC-BILL-017 — Computed Status Filter "รอเปิดเอกสาร NCR/NCP"

**Pre-condition:** บิล approved + มี failed items + ไม่มี NCR  
**Steps:** เลือก filter "รอเปิดเอกสาร NCR/NCP"  
**Expected:** แสดงเฉพาะบิลที่ตรงเงื่อนไข

### TC-BILL-018 — Computed Status Filter "เสร็จสิ้น"

**Pre-condition:** บิล approved + qty_failed=0 หรือ NCR ทั้งหมดปิดแล้ว  
**Expected:** แสดงเฉพาะบิลที่เสร็จสมบูรณ์

### TC-BILL-019 — Auto-draft Restore

**Steps:** กรอกข้อมูล Bill form บางส่วน → ปิด browser → เปิดใหม่ไปหน้าสร้างบิล  
**Expected:** Prompt "พบ draft ที่ยังไม่ได้บันทึก ต้องการกู้คืนไหม?" → เลือก Yes → ข้อมูลกลับมา

---

## 4. NCR Workflow

### TC-NCR-001 — สร้าง NCR

**Role:** qc_staff  
**Pre-condition:** บิล approved, bill_item มี qty_failed > 0  
**Steps:** POST `/api/ncr` `{ bill_id, severity:'major', items:[...] }`  
**Expected:**
- HTTP 201
- ncr_code format: `NCR-2026-0001`
- status='pending_supervisor'
- Notification ถึง qc_supervisor
- audit_logs CREATE

### TC-NCR-002 — NCR Code ไม่ซ้ำ (Sequence Atomic)

**Steps:** สร้าง NCR พร้อมกัน 2 request ในเวลาเดียวกัน  
**Expected:** Code ต่างกัน (NCR-2026-0001 และ NCR-2026-0002) ไม่มี duplicate

### TC-NCR-003 — Bill Item ที่มี NCR แล้วเลือกซ้ำ

**Steps:** สร้าง NCR ที่รวม bill_item_id ที่ถูก include ใน NCR อื่นแล้ว  
**Expected:** HTTP 400 `{ error: 'รายการนี้มี NCR อยู่แล้ว' }`

### TC-NCR-004 — QC Supervisor อนุมัติ NCR L1

**Role:** qc_supervisor  
**Steps:** POST `/api/ncr/:id/approve-supervisor`  
**Expected:**
- status='pending_manager'
- Notification ถึง qc_manager
- audit_logs action='approved'

### TC-NCR-005 — QC Supervisor อนุมัติ NCR ที่ไม่ใช่ pending_supervisor

**Pre-condition:** status='pending_manager'  
**Expected:** HTTP 400 optimistic lock error

### TC-NCR-006 — QC Manager อนุมัติ NCR L2 + Set Disposition

**Role:** qc_manager  
**Steps:**
1. POST `/api/ncr/:id/set-disposition` `{ disposition: 'return', note: 'ส่งคืน Supplier' }`
2. POST `/api/ncr/:id/approve-manager`  
**Expected:** status='pending_qmr_open', Notification ถึง qmr

### TC-NCR-007 — ปิด NCR โดยไม่มี Disposition

**Steps:** POST `/api/ncr/:id/approve-manager` โดยไม่ set disposition ก่อน  
**Expected:** HTTP 400 `{ error: 'กรุณาเลือก Disposition ก่อน' }`

### TC-NCR-008 — QMR อนุมัติเปิด NCR

**Role:** qmr  
**Steps:** POST `/api/ncr/:id/approve-qmr-open`  
**Expected:** status='pending_purchasing_review', Notification ถึง purchasing

### TC-NCR-009 — Purchasing รับทราบเอกสาร (Acknowledge)

**Role:** purchasing  
**Steps:** POST `/api/ncr/:id/purchasing-acknowledge`  
**Expected:**
- purchasing_received_at set
- purchasing_received_by set
- ทำซ้ำไม่ได้ (เรียกครั้งที่ 2 → ไม่เปลี่ยนค่า หรือ 400)

### TC-NCR-010 — Purchasing Copy Link

**Steps:** POST `/api/ncr/:id/record-link-copy`  
**Expected:**
- link_copied_at set
- link_copied_count increment
- เรียก 3 ครั้ง → link_copied_count=3

### TC-NCR-011 — Purchasing ส่ง NCR ไปยัง Supplier

**Steps:** POST `/api/ncr/:id/send-to-supplier`  
**Expected:**
- status='pending_supplier'
- supplier_token set (64-char hex)
- token_expires_at = now + 90 วัน
- Notification ถึง purchasing (Telegram link copy)

### TC-NCR-012 — QC Manager Review Supplier Response (อนุมัติ)

**Pre-condition:** Supplier ตอบแล้ว, status='pending_manager_review'  
**Steps:** POST `/api/ncr/:id/approve-response`  
**Expected:** status='pending_qmr_close', Notification ถึง qmr

### TC-NCR-013 — QC Manager ปฏิเสธ Supplier Response

**Steps:** POST `/api/ncr/:id/reject-supplier-response` `{ comment: 'คำตอบไม่ครบถ้วน' }`  
**Expected:**
- status='pending_supplier_resubmit'
- ncr_approvals บันทึก action='rejected_response'
- Notification ถึง purchasing

### TC-NCR-014 — ปฏิเสธ Response โดยไม่กรอก Comment

**Expected:** HTTP 400 `{ error: 'กรุณากรอกเหตุผลการปฏิเสธ' }`

### TC-NCR-015 — Purchasing Resubmit ไปยัง Supplier

**Pre-condition:** status='pending_supplier_resubmit'  
**Steps:** POST `/api/ncr/:id/resubmit-to-supplier`  
**Expected:**
- Old supplier_response: superseded_at set
- status='pending_purchasing_review'
- token extended
- ncr_approvals action='resubmit'

### TC-NCR-016 — Supplier เปิด Link หลัง Reset

**Steps:** Supplier เปิด Link หลัง Purchasing Resubmit  
**Expected:** ฟอร์มว่าง (already_responded=false) เพราะ old response superseded

### TC-NCR-017 — QMR ปิด NCR

**Steps:** POST `/api/ncr/:id/approve-qmr-close`  
**Expected:** status='closed', audit_logs CLOSE

### TC-NCR-018 — Timeline การดำเนินการ — ครบทุก Event

**Steps:** ทำ NCR ผ่าน full workflow → GET `/api/ncr/:id`  
**Expected:** approvals array + supplier_response + purchasing_received_at + link_copied_at ทั้งหมดปรากฏ เรียงตาม timestamp

### TC-NCR-019 — Re-inspection Round 1

**Role:** qc_staff  
**Steps:** POST `/api/ncr/:id/re-inspect` `{ round:1, result:'fail', note:'ยังพบปัญหา' }`  
**Expected:** re_inspections บันทึก round=1, inspector_id, inspected_at

### TC-NCR-020 — Re-inspection เกิน 3 รอบ

**Steps:** POST re-inspect ครั้งที่ 4  
**Expected:** HTTP 200 แต่ Notification พิเศษถึง qmr "ตรวจซ้ำมากกว่า 3 ครั้ง"

### TC-NCR-021 — Effectiveness Check

**Steps:** POST `/api/ncr/:id/effectiveness-check` `{ result:'effective', note:'แก้ไขสำเร็จ' }`  
**Expected:** effectiveness_result, effectiveness_checked_by, effectiveness_checked_at set

### TC-NCR-022 — ลบ NCR โดยเจ้าของ (pending_supervisor)

**Role:** qc_staff เจ้าของ  
**Expected:** HTTP 200, status='cancelled'

### TC-NCR-023 — ลบ NCR หลัง Supervisor อนุมัติแล้ว

**Pre-condition:** status='pending_manager'  
**Expected:** HTTP 400 `{ error: 'ไม่สามารถลบเอกสารในสถานะนี้' }`

### TC-NCR-024 — Export NCR PDF

**Steps:** GET `/api/export/ncr/:id`  
**Expected:**
- HTTP 200
- Content-Type: application/pdf
- PDF มี: header, NCR code, items, Timeline, Supplier response พร้อม labeled lines
- Timeline supplier row: "สาเหตุของปัญหา: ... \n การแก้ไขปัญหา: ... \n การป้องกันปัญหา: ..."

---

## 5. NCP Workflow (Minor)

### TC-NCP-001 — สร้าง NCP

**Steps:** POST `/api/ncr` `{ severity:'minor', ... }`  
**Expected:** ncr_code format `NCP-2026-0001`, supplier_token=NULL

### TC-NCP-002 — QC Supervisor ปิด NCP โดยตรง

**Steps:** POST `/api/ncr/:id/approve-supervisor` (minor → ncp_closed)  
**Expected:** status='ncp_closed', ไม่ผ่าน pending_manager/qmr/supplier

---

## 6. UAI Workflow

### TC-UAI-001 — NCR disposition='uai' Trigger UAI Status

**Steps:** POST `/api/ncr/:id/set-disposition` `{ disposition:'uai' }`  
**Expected:** NCR status เปลี่ยนเป็น `uai_pending_qc_manager`

### TC-UAI-002 — สร้าง UAI

**Role:** purchasing  
**Steps:** POST `/api/uai` `{ ncr_id, reason, conditions, department, issued_date }`  
**Expected:**
- HTTP 201
- uai_code format: `UAI-2026-0001`
- status='uai_pending_qc_manager'

### TC-UAI-003 — QC Manager Review UAI

**Role:** qc_manager  
**Steps:** POST `/api/uai/:id/qc-manager-review` `{ approved:true, comment:'...' }`  
**Expected:** status='uai_pending_purchasing', Notification ถึง purchasing

### TC-UAI-004 — Purchasing Sign UAI (ออกเอกสาร)

**Role:** purchasing  
**Steps:** POST `/api/uai/:id/sign` พร้อม signature image (base64)  
**Expected:** status='uai_pending_cco', uai_signatures บันทึก

### TC-UAI-005 — CCO Sign (อนุมัติ)

**Steps:** POST `/api/uai/:id/sign` by cco  
**Expected:** status='uai_pending_cmo'

### TC-UAI-006 — CCO ปฏิเสธ UAI

**Steps:** POST `/api/uai/:id/reject` `{ reason:'ไม่เห็นด้วย' }` by cco  
**Expected:** status='uai_rejected_by_exec'

### TC-UAI-007 — CCO ปฏิเสธโดยไม่กรอกเหตุผล

**Expected:** HTTP 400 `{ error: 'กรุณากรอกเหตุผลการไม่อนุมัติ' }`

### TC-UAI-008 — CMO/CPO Sign ตามลำดับ

**Steps:** cmo sign → cpo sign  
**Expected:** uai_pending_cmo → uai_pending_cpo → uai_pending_qc_ack

### TC-UAI-009 — ห้าม Sign ก่อนถึงคิว

**Pre-condition:** status='uai_pending_cmo'  
**Steps:** cpo พยายาม sign  
**Expected:** HTTP 400 `{ error: 'ยังไม่ถึงคิวของคุณ' }` หรือ 403

### TC-UAI-010 — QC Manager / Production / QMR Acknowledge

**Steps:** qc_manager → production_manager → qmr ack ตามลำดับ  
**Expected:** uai_completed

### TC-UAI-011 — Export UAI PDF ก่อน Completed

**Pre-condition:** status='uai_pending_qmr_ack'  
**Expected:** HTTP 400 `{ error: 'ส่งออกได้เมื่อ UAI เสร็จสมบูรณ์เท่านั้น' }`

### TC-UAI-012 — Export UAI PDF หลัง Completed

**Expected:** PDF มีลายเซ็นครบทุกช่อง + Timeline

### TC-UAI-013 — ลบ UAI ก่อน Sign

**Role:** purchasing (เจ้าของ)  
**Steps:** DELETE `/api/uai/:id`  
**Expected:** HTTP 200

### TC-UAI-014 — ลบ UAI หลัง Purchasing Sign แล้ว

**Expected:** HTTP 400

---

## 7. Supplier Portal (Public)

### TC-SUP-001 — Supplier เปิด NCR Link ถูกต้อง

**Steps:** GET `/api/supplier/ncr/:token`  
**Expected:**
- HTTP 200
- มี ncr_code, supplier_name, items, defect photos
- already_responded=false

### TC-SUP-002 — Link หมดอายุ

**Pre-condition:** token_expires_at ผ่านไปแล้ว  
**Expected:** HTTP 403 `{ error: 'ลิ้งค์หมดอายุแล้ว...' }`

### TC-SUP-003 — Token ไม่ถูกต้อง

**Expected:** HTTP 404 `{ error: 'ไม่พบเอกสาร NCR' }`

### TC-SUP-004 — Supplier ส่งคำตอบสำเร็จ

**Steps:** POST `/api/supplier/ncr/:token/respond`  
Body: `{ respondent_name:'John Smith', root_cause:'...', corrective_action:'...', preventive_action:'...', completion_date:'2026-07-01' }`  
**Expected:**
- HTTP 200
- supplier_responses บันทึก respondent_name ครบ
- NCR status='pending_manager_review'
- Notification ถึง qc_manager
- Telegram QC group แจ้งเตือน

### TC-SUP-005 — Supplier ส่งโดยไม่กรอก respondent_name

**Expected:** HTTP 400 `{ error: 'กรุณากรอกชื่อผู้ตอบ' }`

### TC-SUP-006 — Supplier ส่งโดยไม่กรอก root_cause

**Expected:** HTTP 400

### TC-SUP-007 — Supplier ส่งซ้ำ (already responded)

**Pre-condition:** มี supplier_response (superseded_at IS NULL) อยู่แล้ว  
**Steps:** POST respond อีกครั้ง  
**Expected:** HTTP 400 `{ error: 'ส่งคำตอบแล้ว ไม่สามารถส่งซ้ำได้' }`

### TC-SUP-008 — Supplier เปิด Link เมื่อ NCR ไม่ใช่ pending_supplier

**Pre-condition:** status='pending_manager_review'  
**Expected:** HTTP 400 `{ error: 'NCR นี้ไม่ได้อยู่ในสถานะรอ Supplier ตอบกลับ' }`

### TC-SUP-009 — Respondent Name แสดงใน NCR Detail

**Steps:** Supplier ส่ง response พร้อม respondent_name → QC Manager เปิด NCR detail  
**Expected:** "ผู้ตอบ / Respondent: John Smith" ปรากฏในการ์ด "คำตอบ Supplier"

### TC-SUP-010 — Rate Limit Supplier Portal

**Steps:** POST supplier respond 31 ครั้ง / นาที  
**Expected:** ครั้งที่ 31 → HTTP 429

---

## 8. Delivery Schedule

### TC-DEL-001 — Purchasing สร้าง Planned Delivery

**Role:** purchasing  
**Steps:** POST `/api/delivery` `{ supplier_id, scheduled_date, time_slot:'morning', items:[...] }`  
**Expected:** HTTP 201, status='pending', SSE push `delivery_created`

### TC-DEL-002 — QC Staff Acknowledge Delivery

**Steps:** POST `/api/delivery/:id/acknowledge`  
**Expected:** status='acknowledged', acknowledged_at set

### TC-DEL-003 — QC Staff บันทึกส่งนอกแผน

**Steps:** POST `/api/delivery/unplanned` `{ supplier_id, actual_date, ... }`  
**Expected:** is_unplanned=1, status='on_time', ปฏิทิน badge "นอกแผน" สีแดง

### TC-DEL-004 — อัปเดตสถานะ Late โดยไม่กรอกเหตุผล

**Steps:** PATCH `/api/delivery/:id` `{ status:'late' }` โดยไม่มี late_reason  
**Expected:** HTTP 400

### TC-DEL-005 — ลบ Schedule หลัง Acknowledge

**Pre-condition:** status='acknowledged'  
**Steps:** DELETE `/api/delivery/:id`  
**Expected:** HTTP 400 `{ error: 'ไม่สามารถลบ Schedule ที่ดำเนินการแล้ว' }`

### TC-DEL-006 — Purchasing แก้ไข Unplanned Schedule

**Steps:** PATCH `/api/delivery/:id` บน is_unplanned=1 record  
**Expected:** HTTP 403 `{ error: 'ไม่สามารถแก้ไข Delivery นอกแผนได้' }`

---

## 9. Notifications & SSE

### TC-NOTIF-001 — SSE Connection

**Steps:** GET `/api/sse` พร้อม valid cookie  
**Expected:** HTTP 200, Content-Type: text/event-stream, connection keep-alive

### TC-NOTIF-002 — SSE Event เมื่อสร้างบิลใหม่

**Pre-condition:** qc_supervisor เชื่อม SSE  
**Steps:** qc_staff สร้างบิลใหม่  
**Expected:** qc_supervisor รับ event `{ type:'bill_created', ... }` ภายใน 1 วินาที

### TC-NOTIF-003 — SSE ไม่ Push ข้ามสิทธิ์

**Pre-condition:** user2 (qc_staff) เชื่อม SSE  
**Steps:** admin ทำการอนุมัติ NCR ที่ไม่เกี่ยวกับ user2  
**Expected:** user2 ไม่รับ event ที่ไม่เกี่ยวข้อง

### TC-NOTIF-004 — Mark Notification as Read

**Steps:** PATCH `/api/notifications/:id/read`  
**Expected:** is_read=1, Notification ย้ายไปท้ายรายการ (sort: unread first)

### TC-NOTIF-005 — Mark All Read

**Steps:** PATCH `/api/notifications/read-all`  
**Expected:** ทุก notification ของ user: is_read=1

### TC-NOTIF-006 — Telegram ส่งไม่ได้ ระบบไม่ Crash

**Pre-condition:** telegram_bot_token ผิดหรือไม่มี network  
**Steps:** trigger action ที่ส่ง Telegram  
**Expected:** HTTP 200 (action สำเร็จ), Telegram log error แต่ไม่ throw

---

## 10. Export (PDF/Excel)

### TC-EXP-001 — Export NCR PDF Individual

**Steps:** GET `/api/export/ncr/:id`  
**Expected:**
- HTTP 200
- Content-Disposition: attachment; filename="NCR-2026-0001.pdf"
- PDF มี: Company header, NCR detail, Items table, Timeline (labeled lines), Supplier response section

### TC-EXP-002 — NCR PDF Timeline Supplier Response Format

**Pre-condition:** NCR มี supplier response  
**Expected:** Timeline row แสดง:
```
สาเหตุของปัญหา: [root_cause]
การแก้ไขปัญหา: [corrective_action]
การป้องกันปัญหา: [preventive_action]
```
(ไม่ใช่ joined ด้วย " / ")

### TC-EXP-003 — NCR PDF — Respondent Name ใน Timeline

**Expected:** column "ผู้ดำเนินการ" แสดง `{respondent_name} ({supplier_name})`

### TC-EXP-004 — Export UAI PDF (Completed)

**Steps:** GET `/api/export/uai/:id` พร้อม uai_completed  
**Expected:** PDF มีลายเซ็นครบ 8 ช่อง + timestamp

### TC-EXP-005 — Export UAI PDF ก่อน Completed

**Expected:** HTTP 400

### TC-EXP-006 — Export NCR Excel

**Steps:** GET `/api/export/ncr` (list)  
**Expected:** Excel ไฟล์: worksheet 1 (summary), ws2 (items), ws3 (timeline)

### TC-EXP-007 — Export Rate Limit

**Steps:** POST export 6 ครั้ง / นาที  
**Expected:** ครั้งที่ 6 → HTTP 429

### TC-EXP-008 — Export หน้าที่ไม่มีสิทธิ์

**Role:** qc_staff  
**Steps:** GET `/api/reports/ncr` (requires qc_manager)  
**Expected:** HTTP 403

---

## 11. Reports

### TC-RPT-001 — NCR Analytics

**Steps:** GET `/api/reports/ncr?from=2026-01-01&to=2026-12-31`  
**Expected:** counts ถูกต้อง (open, closed, major, minor, by supplier)

### TC-RPT-002 — Supplier Performance

**Expected:** score + grade ถูกต้องตาม formula (quality + delivery + response)

### TC-RPT-003 — Receiving Report by Date Range

**Steps:** GET `/api/reports/receiving?from=2026-06-01&to=2026-06-16`  
**Expected:** เฉพาะบิลใน range ที่กำหนด

---

## 12. Admin

### TC-ADMIN-001 — สร้าง User ใหม่

**Role:** admin  
**Steps:** POST `/api/admin/users` `{ username, password, full_name, role:'qc_staff' }`  
**Expected:** HTTP 201, user login ได้

### TC-ADMIN-002 — Toggle User Inactive

**Steps:** PATCH `/api/admin/users/:id/toggle`  
**Expected:** is_active=0, user ไม่สามารถ login ได้

### TC-ADMIN-003 — Telegram Settings

**Steps:** POST `/api/admin/settings/telegram` `{ bot_token, group_qc, group_purchasing, app_url }`  
**Expected:** บันทึกใน settings table, Test message ส่งได้

### TC-ADMIN-004 — PDF Template Settings

**Steps:** POST `/api/admin/settings/pdf-template` `{ company_name, company_address, ncr_img_cols:2 }`  
**Expected:** PDF ที่ export ใช้ค่าใหม่

### TC-ADMIN-005 — Logo Upload

**Steps:** POST `/api/admin/settings/logo` ไฟล์รูป  
**Expected:** logo ปรากฏใน PDF header

---

## 13. Security & Authorization

### TC-SEC-001 — CSRF Protection

**Steps:** POST mutating endpoint โดยไม่มี X-CSRF-Token header  
**Expected:** HTTP 403

### TC-SEC-002 — Role Escalation (qc_staff ทำ Admin Action)

**Steps:** qc_staff POST `/api/master/suppliers` (admin only)  
**Expected:** HTTP 403

### TC-SEC-003 — Access Other User's Resource

**Steps:** qc_staff A พยายามลบบิลของ qc_staff B  
**Expected:** HTTP 403

### TC-SEC-004 — JWT Tampering

**Steps:** แก้ไข payload ใน JWT cookie แล้ว request  
**Expected:** HTTP 401 (signature mismatch)

### TC-SEC-005 — SQL Injection

**Steps:** GET `/api/bills?q='; DROP TABLE bills; --`  
**Expected:** HTTP 200 (parameterized query, no effect on DB)

### TC-SEC-006 — Path Traversal ใน File Upload

**Steps:** Upload file พร้อม originalname='../../etc/passwd'  
**Expected:** file บันทึกเป็น UUID name, ไม่มี path traversal

### TC-SEC-007 — File Type Spoofing

**Steps:** Upload ไฟล์ .exe เปลี่ยน extension เป็น .jpg  
**Expected:** HTTP 400 `{ error: 'ประเภทไฟล์ไม่ถูกต้อง' }` (magic number detection)

### TC-SEC-008 — Supplier Token ใช้ซ้ำหลัง Reset

**Pre-condition:** Purchasing resubmit (token regenerated)  
**Steps:** ใช้ old token เปิด link  
**Expected:** HTTP 403 หรือ 400 (token ไม่ตรงกับ ncr อีกต่อไป)

### TC-SEC-009 — Audit Log ทุก Action

**Steps:** ทำ CREATE/APPROVE/SIGN/EXPORT แต่ละอย่าง  
**Expected:** audit_logs บันทึกทุก action พร้อม user_id, ip_address, timestamp

### TC-SEC-010 — Inactive User Session Invalidation

**Steps:**
1. User A login → ได้ JWT
2. Admin set is_active=0 สำหรับ User A
3. User A พยายาม request ด้วย JWT เดิม  
**Expected:** HTTP 401 (ถ้า middleware check is_active ทุก request) หรือ session ถูก block

---

## 14. File Upload

### TC-FILE-001 — Upload รูปบิล (JPEG)

**Steps:** POST `/api/bills/:id/images` ไฟล์ JPEG < 30MB  
**Expected:** HTTP 200, file บันทึกเป็น UUID.jpg ใน uploads/bills/

### TC-FILE-002 — Upload ไฟล์ขนาดเกิน Limit

**Steps:** POST bill image ขนาด 35MB (limit=30MB)  
**Expected:** HTTP 400 `{ error: 'ไฟล์ใหญ่เกินไป' }`

### TC-FILE-003 — Upload Drawing PDF

**Steps:** POST `/api/master/products/:id/drawing` ไฟล์ PDF  
**Expected:** HTTP 200, บันทึกใน uploads/drawings/

### TC-FILE-004 — Upload Supplier Response Attachment

**Steps:** POST `/api/supplier/ncr/:token/respond` พร้อม attachments[] (PDF/Image)  
**Expected:** บันทึกใน supplier_response_attachments

### TC-FILE-005 — Delete Image

**Steps:** DELETE `/api/bills/:id/images/:imgId`  
**Expected:** HTTP 200, file ถูกลบจาก disk + DB

---

## 15. Concurrency — 10–20 Users

### TC-CONC-001 — 20 Users Login พร้อมกัน

**Setup:** 20 concurrent HTTP requests POST `/api/auth/login`  
**Expected:**
- ทุก request ได้ HTTP 200 ภายใน 2 วินาที
- แต่ละ request ได้ JWT ของตัวเอง
- ไม่มี race condition ใน cookie/session

### TC-CONC-002 — Double Approve NCR (Optimistic Lock)

**Setup:** 2 users (qc_supervisor) กด "อนุมัติ" NCR เดียวกัน พร้อมกัน (< 100ms ห่าง)  
**Expected:**
- 1 request: HTTP 200, status='pending_manager'
- อีก 1 request: HTTP 400 `{ error: 'เอกสารถูกดำเนินการแล้ว กรุณารีเฟรชหน้า' }`
- DB: status เปลี่ยนแค่ครั้งเดียว

### TC-CONC-003 — NCR Code Uniqueness (Race Condition)

**Setup:** 10 concurrent requests POST `/api/ncr` พร้อมกัน  
**Expected:**
- ทุก request ได้ ncr_code ที่ไม่ซ้ำ (NCR-2026-0001 ถึง NCR-2026-0010)
- ไม่มี UNIQUE constraint error ใน DB

### TC-CONC-004 — UAI Code Uniqueness

**Setup:** 5 concurrent requests POST `/api/uai`  
**Expected:** UAI-2026-0001 ถึง UAI-2026-0005, ไม่มี duplicate

### TC-CONC-005 — 20 Users Read Bills List พร้อมกัน

**Setup:** 20 concurrent GET `/api/bills`  
**Expected:**
- ทุก request ได้ response ภายใน 1 วินาที
- ไม่มี lock contention (WAL mode รองรับ concurrent reads)
- Data ถูกต้องสำหรับแต่ละ user

### TC-CONC-006 — 10 Users Upload ไฟล์พร้อมกัน

**Setup:** 10 concurrent POST `/api/bills/:id/images` ต่าง bill_id  
**Expected:**
- ทุกไฟล์บันทึกสำเร็จ
- UUID filename ไม่ซ้ำกัน
- ไม่มี disk write conflict

### TC-CONC-007 — 15 Users SSE Connections

**Setup:** 15 users เชื่อม SSE พร้อมกัน  
**Steps:** qc_staff สร้างบิลใหม่  
**Expected:**
- qc_supervisor ทุกคน (สมมุติมี 3) รับ event ภายใน 2 วินาที
- Users อื่นไม่รับ event ที่ไม่เกี่ยวข้อง
- SSE connections ไม่ memory leak

### TC-CONC-008 — Supplier ส่ง Response พร้อมกัน (Token เดียว)

**Setup:** 2 concurrent POST `/api/supplier/ncr/:token/respond`  
**Expected:**
- 1 request: HTTP 200
- อีก 1 request: HTTP 400 `{ error: 'ส่งคำตอบแล้ว' }` (transaction lock)
- supplier_responses มีแค่ 1 record

### TC-CONC-009 — Purchasing Copy Link ซ้ำ (Race)

**Setup:** purchasing กด Copy 5 ครั้งรวดเร็ว (debounce อาจหลุด)  
**Expected:** link_copied_count นับถูกต้อง (atomic increment), ไม่มี race condition

### TC-CONC-010 — 20 Users Export PDF พร้อมกัน

**Setup:** 20 concurrent GET `/api/export/ncr/:id`  
**Expected:**
- ครั้งที่ 6-20 ของแต่ละ user → HTTP 429 (rate limit 5/min)
- ครั้งที่ 1-5 → PDF ถูกต้อง ไม่ corrupt

### TC-CONC-011 — Bill Approve ขณะ Edit (Editing Status Race)

**Setup:**
1. QC Supervisor ส่ง bill กลับ (status='editing')
2. QC Staff กำลัง save (status='pending_approval' ใน browser เก่า)
3. QC Supervisor กด approve ขณะ QC Staff กำลัง re-submit  
**Expected:** ไม่มีสถานะกำกวม — optimistic lock ป้องกัน

### TC-CONC-012 — Drawing Revision Upload พร้อมกัน (is_current Integrity)

**Setup:** 2 concurrent POST drawing upload สำหรับ product เดียว  
**Expected:**
- 1 request สำเร็จ → is_current=1 สำหรับ revision ใหม่
- อีก 1 request: retry หรือ error แต่ DB ยังมี is_current=1 เพียง 1 record

### TC-CONC-013 — 10 Users Notification Read พร้อมกัน

**Setup:** 10 users PATCH `/api/notifications/read-all` พร้อมกัน  
**Expected:** แต่ละ user mark read เฉพาะ notifications ของตัวเอง, ไม่ cross-contaminate

### TC-CONC-014 — NCR Approve ขณะ Supplier ส่ง Response (Status Conflict)

**Setup:**
- QC Manager กำลัง POST approve-qmr-open
- Supplier กำลัง POST respond (token valid, status='pending_supplier')
- ทั้งสอง request ส่งพร้อมกัน  
**Expected:**
- ถ้า NCR ยังเป็น 'pending_supplier' → Supplier response สำเร็จ
- ถ้า NCR เปลี่ยน status แล้ว → Supplier response ได้ 400

### TC-CONC-015 — Login Rate Limit ต่าง IP

**Setup:** 10 users ต่าง IP login ผิดพร้อมกัน  
**Expected:** แต่ละ IP นับแยกกัน (rate limit per IP), ไม่ block cross-IP

---

## 16. Regression Scenarios

### TC-REG-001 — Bill Filter Dropdown ผู้ออกเอกสาร Auto-width

**Steps:** เลือกชื่อผู้ออกเอกสารที่ยาว 30 ตัวอักษร  
**Expected:** dropdown กว้างขึ้นตามชื่อ (canvas measurement), ไม่ truncate

### TC-REG-002 — Bill Pagination Reset เมื่อ Filter เปลี่ยน

**Steps:**
1. ไปหน้า 3
2. เปลี่ยน status filter เป็น "เสร็จสิ้น"  
**Expected:** กลับมาหน้า 1 อัตโนมัติ

### TC-REG-003 — NCR "Timeline การดำเนินการ" Label

**Steps:** เปิด NCR Detail ที่มีการอนุมัติแล้ว  
**Expected:** header section ระบุ "Timeline การดำเนินการ" (ไม่ใช่ "อนุมัติ")

### TC-REG-004 — Supplier Response superseded ไม่โผล่ใน NCR Detail

**Steps:**
1. Supplier ส่ง response (response A)
2. QC Manager reject → Purchasing resubmit
3. Supplier ส่ง response ใหม่ (response B)
4. GET `/api/ncr/:id`  
**Expected:** `supplier_response` = response B, response A มี superseded_at set, ไม่ถูก return

### TC-REG-005 — Soft Delete Supplier ไม่หายจาก Historical Data

**Steps:** Soft delete (is_active=0) supplier ที่มีบิลผูกอยู่  
**Expected:** Supplier ไม่ขึ้น dropdown ใหม่, แต่ยังปรากฏใน bills เก่า (supplier_name ยังแสดง)

### TC-REG-006 — AQL Lookup ถูกต้อง

**Steps:**
- Product: inspection_level='GEN_II', aql_value='2.5'
- qty_received=500  
**Expected:** qty_sampled=50, accept=10, reject=11 (ตาม ISO 2859-1 table)

### TC-REG-007 — Drawing is_current ถูกต้องหลัง Upload ใหม่

**Steps:**
1. Product มี Drawing Rev.A (is_current=1)
2. Upload Rev.B  
**Expected:** Rev.A: is_current=0, obsoleted_at set | Rev.B: is_current=1

### TC-REG-008 — NCR Export Excel Timeline — Supplier Row Format

**Steps:** Export Excel NCR ที่มี supplier response  
**Expected:** ws3 (Timeline) supplier row — "หมายเหตุ" column:
```
สาเหตุของปัญหา: [text]
การแก้ไขปัญหา: [text]
การป้องกันปัญหา: [text]
```
(newline \n แยกบรรทัด)

### TC-REG-009 — Dashboard ใช้งานได้ทุก Role

**Steps:** Login ด้วยแต่ละ role → GET `/`  
**Expected:** ทุก role เห็น dashboard (ไม่ 403)

### TC-REG-010 — Supplier NCR Response Form — respondent_name

**Steps:** Supplier เปิด link → กรอกฟอร์ม (มีช่อง Respondent Name) → Submit  
**Expected:** respondent_name บันทึกใน supplier_responses

### TC-REG-011 — Bills List No. ต่อเนื่องข้ามหน้า

**Steps:** เปิดหน้า Bills (หน้า 2)  
**Expected:** No. เริ่มจาก 11, ไม่เริ่ม 1 ใหม่

### TC-REG-012 — Token Expiry Check ทั้ง GET และ POST

**Steps:** Supplier เปิด link ที่ expired token  
- GET `/api/supplier/ncr/:token` → HTTP 403
- POST `/api/supplier/ncr/:token/respond` → HTTP 403

### TC-REG-013 — Telegram Config ว่าง — Degraded Mode

**Pre-condition:** telegram_bot_token ว่างใน settings  
**Steps:** trigger action ที่ควรส่ง Telegram  
**Expected:** HTTP 200 (action สำเร็จ), skip Telegram silently

### TC-REG-014 — UAI Reject by Exec — Status Correct

**Steps:** CCO reject UAI  
**Expected:**
- status='uai_rejected_by_exec'
- เหตุผลบันทึกใน uai_signatures
- QC Manager และ Purchasing ได้รับ notification

### TC-REG-015 — Multiple NCR per Bill

**Steps:** บิลที่มี 3 รายการ failed → สร้าง NCR ที่รวม 2 รายการ → สร้าง NCR อีกอันที่รวม 1 รายการ  
**Expected:** NCR ทั้งสองสร้างสำเร็จ, รายการที่ 1-2 ไม่สามารถ include ใน NCR ที่ 3

---

## หมายเหตุสำหรับ QA Team

### Environment Setup

```bash
# Fresh DB สำหรับ test
npm run clear-db:force

# Seed test data
node server/scripts/seed-test.js

# Run server
npm run dev:server

# Run client
npm run dev:client
```

### Concurrency Test Tools

```bash
# Apache Bench (TC-CONC-*)
ab -n 20 -c 20 -H "Cookie: token=..." http://localhost:3001/api/bills

# Artillery (load test)
artillery quick --count 20 --num 50 http://localhost:3001/api/bills

# k6 script (custom concurrent scenarios)
k6 run concurrency-test.js
```

### Database Verification Queries

```sql
-- ตรวจ NCR code ซ้ำ
SELECT ncr_code, COUNT(*) FROM ncrs GROUP BY ncr_code HAVING COUNT(*) > 1;

-- ตรวจ is_current ซ้ำ
SELECT product_id, COUNT(*) FROM product_drawings WHERE is_current=1 GROUP BY product_id HAVING COUNT(*) > 1;

-- ตรวจ supplier_response active
SELECT ncr_id, COUNT(*) FROM supplier_responses WHERE superseded_at IS NULL GROUP BY ncr_id HAVING COUNT(*) > 1;

-- ตรวจ audit log ครบ
SELECT action, COUNT(*) FROM audit_logs GROUP BY action ORDER BY COUNT(*) DESC;
```

### Known Test Data Dependencies

- ต้อง seed ก่อน: users (10 roles), suppliers, products, product_groups, units, defect_categories, aql_tables
- NCR/UAI tests ต้องมี Bill approved อยู่ก่อน
- Supplier portal tests ต้องมี NCR ที่ status='pending_supplier' + valid token
