# DEVLOG — IQC Quality Management System

---

## 2026-06-20 | Session 34 — Admin Dashboard เปิดเมนู + Power BI Excel Export

### Admin Dashboard — เปลี่ยน header buttons
- **`client/src/pages/Dashboard/index.jsx`** (component `AdminDash`):
  - ลบปุ่ม "จัดการผู้ใช้" และ "ตั้งค่า" ออก
  - เพิ่ม `menuRef` + `menuOpen` state + click-outside handler (เหมือน pattern ของ bell notification)
  - เพิ่มปุ่ม **"Export Excel"**: `<a href="/api/exports/powerbi">` + ไอคอน download, สีเขียว (`D.green`)
  - เพิ่มปุ่ม **"เปิดเมนู"** dropdown (สีม่วง) พร้อม 3 รายการ:
    - จัดการผู้ใช้ → `/admin/users`
    - ตั้งค่า → `/admin/settings`
    - วันหยุด → `/admin/holidays`

### Backend — GET /api/exports/powerbi
- **`server/routes/exports.js`**: เพิ่ม endpoint ใหม่ก่อน `module.exports`
  - Auth: `admin` เท่านั้น, rate limit ใช้ `pdfRateLimit` (5 req/min)
  - ใช้ ExcelJS สร้าง multi-sheet workbook พร้อม ETL relationships สำหรับ Power BI:
    - **Dimension sheets**: `dim_Suppliers`, `dim_ProductGroups`, `dim_Products`, `dim_DefectCategories`, `dim_Users`
    - **Fact sheets**: `fact_Bills`, `fact_BillItems`, `fact_NCRs`, `fact_NCRItems`, `fact_NCRApprovals`, `fact_SupplierResponses`, `fact_ReInspections`, `fact_UAIDocuments`, `fact_UAISignatures`, `fact_DeliverySchedules`, `fact_SupplierEvaluations`, `fact_QCAttendance`
    - **`_Relationships`**: เอกสาร FK relationships ทั้งหมด (28 rows) พร้อม Cardinality สำหรับ Power BI auto-detect
  - ทุก sheet: header row สีน้ำเงิน (#1A3A5C), frozen row 1, autoFilter
  - ชื่อ FK column สม่ำเสมอ (`supplier_id`, `user_id`, etc.) เพื่อให้ Power BI auto-detect relationships
  - `Content-Disposition: attachment; filename="IQC_PowerBI_Export_YYYY-MM-DD.xlsx"`

---

## 2026-06-20 | Session 33 — NCR Flow + Export + Issue Talk Delete

### สรุปรับเข้าวันนี้ — เพิ่มสาเหตุปัญหา ([server/routes/exports.js](server/routes/exports.js))
- `buildDailyReportData`: query `getNcrCodes` เพิ่ม `dc.name as defect_category, ni.defect_detail` (LEFT JOIN defect_categories)
- **Export JPG**: แสดง `ประเภทปัญหา — รายละเอียด` ด้านล่าง NCR/NCP code (font-size 10px, สีเทาเข้ม)
- **Export Excel**: column "เอกสาร NCR/NCP" แสดงเป็น `NCR-XXXX (ประเภท — รายละเอียด)` + wrapText

### File Cleanup — ลบไฟล์จริงทุกจุดที่ขาดหาย
- **`server/routes/bills.js`** — `DELETE /bills/:id/items/:itemId/certificates/:certId`: ดึง `file_path` ก่อน DELETE row แล้ว `fs.unlinkSync` ไฟล์จาก `uploads/inspection-docs/`
- **`server/routes/delivery.js`** — เพิ่ม `require('path')` + `require('fs')`
  - `DELETE /delivery/:id/attachments/:attachId`: ดึง `file_path` ก่อน DELETE row แล้ว `fs.unlinkSync` จาก `uploads/general/`
  - `DELETE /delivery/:id`: เก็บ `attachFiles` ก่อน transaction ลบ attachment ทั้งหมดหลัง commit
- **`server/routes/uai.js`** — `DELETE /uai/:id`: เก็บ `sigFiles` จาก `uai_signatures` ก่อน transaction แล้วลบไฟล์ signature จาก `uploads/uai/` หลัง commit
- **ข้อมูล**: Drawing revisions (product_drawings) ไม่ลบไฟล์เก่าโดยตั้งใจ — historical records ยังต้องดาวน์โหลดได้ (ISO)

### บิลรับเข้า — ลบบิลสถานะร่าง (qc_staff)
- **`client/src/pages/Bills/index.jsx`** (frontend เท่านั้น — backend DELETE /bills/:id มีอยู่แล้ว):
  - import เพิ่ม `useMutation`, `useQueryClient`
  - เพิ่ม `deleteConfirmId` state + `deleteBill` useMutation
  - เพิ่ม column ว่างในตาราง (เฉพาะ `qc_staff`) + ไอคอน trash แสดงเฉพาะแถว `status === 'draft'`
  - `e.stopPropagation()` ใน `<td>` ป้องกัน navigate เมื่อกดลบ
  - Confirmation modal: แสดง Invoice No. + ลบถาวร + error จาก server
  - colSpan dynamic: 12 สำหรับ `qc_staff`, 11 สำหรับ role อื่น

### Issue Talk — ลบห้องสนทนา
- **`server/routes/issue-talk.js`**: เพิ่ม `DELETE /:id` route
  - ตรวจสิทธิ์: เฉพาะผู้สร้างห้อง (`isCreator`) + status ต้องเป็น `closed`
  - Transaction: ลบ reads → attachments → messages → participants → issue_talks + auditLog
  - หลัง commit: ลบไฟล์จริงใน `uploads/issue-talk/` ทุกไฟล์ (`fs.unlinkSync`)
- **`client/src/pages/IssueTalk/Detail.jsx`**:
  - เพิ่ม `showDeleteConfirm` state + `deleteIssue` useMutation
  - ปุ่ม "ลบห้อง" (ไอคอน trash + สีแดง) แสดงใน header เฉพาะเมื่อ `is_creator && isClosed`
  - Confirmation modal ยืนยันก่อนลบ แสดง error จาก server ถ้าลบไม่ได้
  - ลบสำเร็จ → navigate กลับ `/issue-talk`

### NCR Flow — Supervisor ออก NCR/NCP ได้โดยตรง
- **`server/routes/ncr.js`**:
  - `POST /` + `DELETE /:id`: เพิ่ม `'qc_supervisor'` เข้า `requireRole` (เดิม `['qc_staff']` เท่านั้น)
  - เมื่อ `req.user.role === 'qc_supervisor'` สร้าง NCR:
    - Auto-advance status → `pending_manager` ทันที (ข้าม `pending_supervisor`)
    - Insert `ncr_approvals` record: action=`approved`, role=`qc_supervisor` เพื่อ audit trail
    - แจ้ง `qc_manager` แทน `qc_supervisor`
    - Telegram message ระบุ "สร้างโดย QC Supervisor — รอ QC Manager อนุมัติ"
  - `qc_staff` flow เดิมไม่เปลี่ยน

### Frontend
- **`client/src/App.jsx`**: route `ncr/new` เปลี่ยน roles เป็น `['qc_staff', 'qc_supervisor']`
- **`client/src/pages/Bills/Detail.jsx`**: ปุ่ม "ออกเอกสาร NCR/NCP" เปลี่ยนเงื่อนไขจาก `user?.role === 'qc_staff'` → `['qc_staff', 'qc_supervisor'].includes(user?.role)`
- **`CLAUDE.md`**: อัปเดต Role Matrix (เปิด NCR/NCP เพิ่ม qc_supervisor)

---

## 2026-06-19 | Session 32 — Attendance: Employee Selector + สรุปสถิติ QC

### Backend
- **`server/routes/attendance.js`**: เพิ่ม `GET /attendance/monthly-summary?month=YYYY-MM`
  - คืน employees ทุกคนพร้อม stats: `total_present`, `total_late`, `total_absent`, `attendance_pct`, `avg_late_minutes`, `avg_work_minutes`
  - คำนวณ `working_days` (วัน จ–ศ ในเดือน จนถึงวันนี้) ใน JS
  - รวม `shift` config + `working_days` ใน response

### Frontend
- **`EmployeeHistory.jsx`**:
  - เพิ่ม `canViewHistory` variable (qc_supervisor/qc_manager/admin)
  - fetch `/attendance/employees` list จริง — populate `<select>` dropdown แยก optgroup "ของฉัน" กับ "พนักงาน QC ทั้งหมด"
  - Selector แสดงสำหรับ supervisor/manager/admin ทุกกรณี (ไม่ใช่แค่ canEdit)
  - เพิ่มปุ่ม "สรุปสถิติ QC" → navigate `/qc-attendance/stats`
- **`AttendanceStats.jsx`** (ใหม่) → route `/qc-attendance/stats`:
  - Month navigator + KPI 4 cards: จำนวนพนักงาน, เฉลี่ยการมา%, มาสายรวม, ไม่เคยขาด/สาย
  - ตารางหลัก: ชื่อ, สถานี, มา, ขาด, สาย, อัตราการมา (progress bar + %), เฉลี่ยงาน, เกรด chip
  - Sort: สถานี | เปอร์เซ็นต์ | สาย | ขาด
  - Filter: dropdown ตามสถานี
  - Station summary cards (เมื่อ sort=station, filter=all): avg% + สาย ต่อสถานี
  - คลิกแถว → navigate ไปหน้าประวัติพนักงานคนนั้น
  - เกรด: ดีเยี่ยม(≥95%), ดี(85%), พอใช้(75%), ต้องปรับปรุง(<75%)
- **`App.jsx`**: import + route `/qc-attendance/stats` (supervisor/manager/admin เท่านั้น)

---

## 2026-06-19 | Session 31 — Time Attendance System (Full Feature)

### Backend
- **`server/db/database.js`**: migration เพิ่มคอลัมน์ใน `qc_attendance`: `check_out_at DATETIME`, `late_minutes INTEGER DEFAULT 0`, `work_minutes INTEGER`, `admin_note TEXT`
- **`server/index.js`**: เพิ่ม `GET/POST /api/admin/settings/attendance` — ตั้งค่า `shift_start_time`, `shift_end_time`, `shift_late_grace_minutes`
- **`server/routes/attendance.js`**: เขียนใหม่ทั้งหมด:
  - `GET /shift-settings` — คืน shift config ให้ทุก role
  - `GET /my-status` — เพิ่ม `checked_out`, `check_out_at`, `late_minutes`, `work_minutes`, `shift_start/end`
  - `POST /check-in` — คำนวณ `late_minutes` เทียบกับ shift start + grace, broadcast SSE `attendance_update`
  - `POST /check-out` — GPS geofence, คำนวณ `work_minutes`, broadcast SSE
  - `GET /today` — เพิ่ม `check_out_at`, `late_minutes`, `work_minutes`, `admin_note`, summary: `late` + `absent` + `checked_out`
  - `GET /my-history?month=YYYY-MM` — ประวัติรายเดือนของตัวเอง
  - `GET /employee/:userId/monthly?month=YYYY-MM` — ประวัติรายเดือนต่อคน (supervisor/admin)
  - `GET /employees` — รายชื่อ QC staff ทั้งหมด
  - `POST /admin/override` — admin/qc_manager แก้ไขเวลาเข้า-ออก + note, broadcast SSE

### Frontend
- **`client/src/hooks/useSSE.js`**: เพิ่ม handler `attendance_update` — invalidate `qc-attendance-today`, `attendance-my-status`, `attendance-employee`
- **`client/src/pages/QCAttendance/index.jsx`**: redesign เป็น real-time dashboard
  - `LiveClock` component อัปเดตทุกวินาที
  - `SummaryBar` แสดงสัดส่วนมา/สาย/ขาด + progress bar สีตามเปอร์เซ็นต์
  - `StationCard` per-station table: ชื่อ, status badge (มา/สาย N น./ยังไม่เช็ค), เวลาเข้า, เวลาออก, ชั่วโมงทำงาน, geofence icon, admin note
  - QC Staff เห็น: own status card + ลิงก์ history; Supervisor/Admin เห็น summary + station cards ทั้งหมด
  - SSE-driven: ไม่ต้อง polling สำหรับวันนี้
- **`client/src/pages/QCAttendance/CheckIn.jsx`**: เขียนใหม่ — รองรับ check-in และ check-out
  - Mode เปลี่ยนอัตโนมัติตาม status (checked_in=true+checked_out=null → checkout mode)
  - แสดงเวลาเริ่ม/เลิกงานจาก settings
  - แสดง "มาสาย X นาที" หรือ "ตรงเวลา" ทันทีหลัง check-in
  - `LiveWorkTimer` component แสดงชั่วโมงทำงาน live (อัปเดตทุก 30 วิ)
  - แสดงสรุป check-in + check-out เมื่อเสร็จทั้งคู่
- **`client/src/pages/QCAttendance/EmployeeHistory.jsx`**: หน้าใหม่ — ประวัติรายเดือนต่อคน
  - Calendar grid (จ–อา) color-coded: เขียว=ตรงเวลา, ส้ม=สาย, แดง=ขาด, เทา=หยุด
  - เส้นสีบอก Today + ring
  - Stats row: มาแล้ว, อัตราการมา%, มาสาย, เฉลี่ยชั่วโมงงาน
  - History table: วันที่, เข้า, ออก, สาย, ชั่วโมงงาน, edit (admin)
  - `OverrideModal` สำหรับ admin/qc_manager แก้ไขเวลาเข้า-ออก + note per วัน
  - Route: `/qc-attendance/employee/:userId` — qc_staff เห็นเฉพาะตัวเอง, supervisor/admin เห็นทุกคน
- **`client/src/pages/Admin/Settings.jsx`**: เพิ่ม `AttendanceTab` — ตั้งค่าเวลางาน (start, end, grace minutes) พร้อม preview คำนวณ
- **`client/src/App.jsx`**: เพิ่ม route `/qc-attendance/employee/:userId`

---

## 2026-06-19 | Session 30 — Admin Dashboard Redesign + Geofence Settings Tab

### Admin Dashboard — Full-screen redesign (client/src/pages/Dashboard/index.jsx)
- **`AdminDash` component เขียนใหม่ทั้งหมด** — ออกแบบเพื่อนำเสนอผู้บริหาร
- **Layout**: `height: 100vh` ไม่มี sidebar/header (AppLayout ข้ามออก สำหรับ admin ที่ `/`)
- **Header bar** ใน dashboard เอง: ชื่อ "IQC Dashboard" | badge "Admin" | วันที่ | Bell แจ้งเตือน | ชื่อผู้ใช้ | ปุ่มจัดการผู้ใช้ + ตั้งค่า
  - Bell ดึง `useNotifications` — แสดง dropdown notification panel, unread count badge, ปุ่ม "อ่านทั้งหมด"
- **KPI Row (5 cards)**: บิลวันนี้, บิลเดือนนี้, NCR เปิดอยู่, อัตราผ่านตรวจ%, ผู้ใช้งาน — animate count-up, คลิกนำทาง
- **3 คอลัมน์หลัก**:
  - **Left — คุณภาพ Supplier**: ตารางอันดับ 8 supplier (bill count, NCR count, pass% bar) เรียง NCR มากสุด + NCR แยก Major/Minor cards
  - **Center — แนวโน้ม**: Area chart 30 วัน + Bar chart NCR รายเดือน (12 เดือน)
  - **Right — ภาพรวม**: 3 RadialGauges (NCR ปิดแล้ว, อัตราผ่าน%, UAI เสร็จ) + master data mini cards + recent bills list
- **`server/index.js`** ขยาย `/api/admin/stats` (session ก่อน): เพิ่ม `supplier_quality` (top 8), `month_bills`, `pass_fail_items`, `ncr_by_severity`, `total_uai`, `completed_uai`, `bills_last30` (30-day array)

### Geofence Settings Tab (client/src/pages/Admin/Settings.jsx)
- เพิ่ม `GeofenceTab` component — form 3 field: `factory_lat`, `factory_lon`, `factory_radius_m`
- Preview block แสดงพิกัด + ลิงก์ "ดูบน Google Maps" เมื่อกรอกพิกัดครบ
- คู่มือ inline วิธีหาพิกัดจาก Google Maps (3 ขั้นตอน)
- บันทึกผ่าน `POST /api/admin/settings/geofence` (endpoint มีอยู่แล้วใน `server/index.js`)
- เพิ่มใน `TABS` array → tab ที่ 3 "Geofence"

---

## 2026-06-19 | Session 29 — Daily Receiving Report (JPG + Excel) + Bill Export

### สรุปรับเข้าวันนี้ (Today's Receiving Report)
- **`server/routes/exports.js`**: เพิ่ม 2 routes ใต้ `DAILY RECEIVING REPORT` section:
  - `GET /api/reports/receiving/today/excel`: Excel สรุปรายการรับเข้าวันนี้ — 11 คอลัมน์ (#, ผู้ผลิต, Invoice, PO, รายการ, รับเข้า, สุ่ม, ผ่าน, ไม่ผ่าน, ผลการตรวจ, เอกสาร NCR/NCP) + summary row + color coding (แดง=ไม่ผ่าน, เขียว=ผ่าน) — ทุก auth user ใช้ได้
  - `GET /api/reports/receiving/today/jpg`: JPG screenshot ผ่าน puppeteer (จาก html-pdf-node) — HTML table เดียวกัน + company header + summary Pass Rate — ใช้ pdfRateLimit (5 req/นาที)
  - Helper `getTodayBKK(dateParam)`: default today ใน Bangkok timezone, รับ `?date=YYYY-MM-DD` override
  - Helper `buildDailyReportData(date)`: query bills + items + NCR codes (per item via prepared statement)
  - puppeteer: `require('puppeteer')` → fallback `html-pdf-node/node_modules/puppeteer`, viewport 1280×800 @1.5x, `domcontentloaded` + 800ms wait
- **`client/src/pages/Bills/index.jsx`**: เพิ่มปุ่ม "สรุปรับเข้าวันนี้" ใน page-header (dropdown 2 ตัวเลือก: Export JPG / Export Excel) — `useRef` + outside-click close, แสดงทุก role

### Session 28 ก่อนหน้า: Bill Export PDF + Excel
- `GET /api/bill/:id/pdf` — ส่งออก PDF บิลรับเข้า (ต้อง status=approved)
- `GET /api/bill/:id/excel` — ส่งออก Excel บิลรับเข้า 2 sheet (info + items)
- `client/src/pages/Bills/Detail.jsx`: ปุ่ม Export PDF + Export Excel เมื่อ `bill.status === 'approved'`

---

## 2026-06-19 | Session 28 — Real-time Status Broadcast ทุกหน้า

### SSE Broadcast ให้ทุก User เมื่อ Status เปลี่ยน
- **`server/index.js`**: เพิ่ม `broadcastSSE(eventType, data)` — ส่ง SSE ไปทุก connection ที่ online (`sseClients` Map ทุก userId)
- **`server/routes/notifications.js`**: ใน `createNotification()` เพิ่ม `db.broadcastSSE('status_change', { link })` หลัง push ส่วนตัว → ทุก status transition ที่ผ่าน createNotification จะ broadcast อัตโนมัติ (bills 4, ncr 27, uai 11, delivery 16, issue-talk 4, supplier 2 จุด)
- **`client/src/hooks/useSSE.js`**: แยก handler:
  - `notification` → invalidate `notifications` + `dashboard-stats` + entity (เฉพาะ recipient)
  - `status_change` → invalidate `dashboard-stats` + entity เท่านั้น (ทุก user ที่เปิดหน้าเดิม) ไม่ยุ่ง notification bell ของคนอื่น
- ผล: เมื่อ User A อนุมัติบิล/NCR/UAI/Delivery → User B, C ที่เปิดหน้า list หรือ detail อยู่เห็นสถานะเปลี่ยนทันทีโดยไม่ต้อง refresh

## 2026-06-19 | Session 27 — SearchableSelect ทุก Dropdown ใน Project

### SearchableSelect component ครบทุก dynamic dropdown
- **`SearchableSelect.jsx`** (ใหม่, `client/src/components/UI/`): combobox พิมพ์ค้นหาได้ — hidden required input, clear (×), keyboard Escape/Enter, outside-click close
- อัปเดต dropdown ทุกจุดที่ข้อมูลมาจาก master data:
  - `Bills/New.jsx`: supplier select → SearchableSelect
  - `Bills/index.jsx`: creator filter → SearchableSelect + ลบ `creatorSelectRef` + `useEffect` auto-width canvas
  - `NCR/New.jsx`: bill select → SearchableSelect
  - `Delivery/index.jsx`: supplier (CreateModal + UnplannedModal) + product per-item → SearchableSelect
  - `IssueTalk/index.jsx`: create-issue supplier + filter tagged-user + filter supplier → SearchableSelect
  - `Master/Products.jsx`: กลุ่มสินค้า + หน่วยนับ form + supplier filter list → SearchableSelect
- Static enum dropdowns (status, role, AQL, severity) คงเป็น `<select>` ตามเดิม

## 2026-06-19 | Session 26 — Master List Pagination + QC Station Access Control

### Master List Pagination (server-side search + pagination)
- **Backend** (`server/routes/master.js`): เพิ่ม paginated mode ให้ทุก GET endpoint (suppliers, product-groups, units, defect-categories, colors, products) — เมื่อส่ง `?page=N` จะคืน `{ data, total, page, limit }` ส่วน call โดยไม่มี `page` ยังคืน array เดิม (dropdown ทั่วระบบไม่ต้องแก้)
- Products: refactor เป็น `attachProductSubqueries()` helper + รองรับ `q` (server-side search ใน name/code) + `supplier_id` filter
- **Frontend** (`Pagination.jsx` ใหม่): component prev/next พร้อมแสดง "X–Y จาก Z รายการ"
- อัปเดตทุก Master page (Suppliers, ProductGroups, Units, DefectCategories, Colors, Products): debounced search 300ms → backend, `page` state, remove client-side filter/sort-all, ใช้ `useSortable` บน current page

### QC Station-based Access Control (Session ก่อนหน้า)
- `requireReceivingQC` middleware, `getReceivingQCStaff()`, `qc_station` ใน auth/login, nav condition `onlyReceivingQC`
- bills.js / ncr.js router-level guard, delivery.js per-route guard

---

## 2026-06-19 | DEVMORE Sprint 3 — Migration framework, Perf/Scale, Service layer, Tests

### Summary
สาน Sprint 3+ ต่อ: แก้รากหนี้ migration (H4), เก็บลายเซ็นเป็นไฟล์ (M2), perf/scale (M12/M13), role สด (M14), เริ่ม service layer + ชุดเทสต์ — ทั้งหมด zero new dependency, ผ่าน 12 tests + server boot + client build

### H4 — Migration framework (แก้รากหนี้ TD-1) ✅
- `server/db/migrate.js` (ใหม่): ตาราง `schema_migrations` + runner `apply(version, fn)` รันครั้งเดียว idempotent + `hasStatusCheck()`
- Root migration `003_ncrs_status_as_text`: rebuild ncrs **ครั้งสุดท้าย** → `status` เป็น TEXT (เลิก CHECK) → **เพิ่มสถานะใหม่ไม่ต้อง rebuild ตารางอีก**
- validate ที่ app layer แทน: `db.VALID_NCR_STATUSES` + `db.isValidNcrStatus()`
- gate legacy `migrateNcrAdd*` ด้วย `hasStatusCheck()` (รันเฉพาะ DB เก่า), update `schema.sql` (fresh install ได้ status TEXT + supplier_token nullable)
- **ทดสอบบนสำเนา iqc.db จริงก่อน** (VACUUM INTO) → integrity ok, 8 rows + statuses preserved, 0 FK violations, set สถานะใหม่ได้ → **apply กับ DB จริง** (backup ไว้ที่ `backups/iqc_pre-H4_*`) → boot ซ้ำ = idempotent (ไม่รันซ้ำ)
- `IQC_DB_PATH` override (สำหรับ test/dry-run) + `scripts/backup-db.js` (VACUUM INTO + rotate 7 วัน, CLAUDE.md §5)

### M2 — ลายเซ็น UAI เป็นไฟล์ (เลิกเก็บ base64 ใน DB) ✅
- `/uai/:id/sign`: decode data-url → เขียนไฟล์ `uploads/uai/sig-<uuid>.png` (จำกัด 2MB) → เก็บ filename, ลบไฟล์ถ้า transaction ล้ม
- GET คืน `/uploads/uai/...` URL, PDF inline ผ่าน `sigDataUrl()` — **รองรับ legacy base64 เดิม** (ไม่ต้อง migrate ข้อมูลเก่า)

### Perf / Scale
- **M12** SSE เก็บเป็น `Set` ต่อ user (รองรับหลายแท็บ + ไม่ leak connection เดิม) + PDF concurrency limiter (สูงสุด 2 Chromium พร้อมกัน) — note: SSE→Redis ต้องทำเมื่อ scale หลาย instance
- **M13** reports (receiving/ncr/uai): summary คำนวณจาก SQL aggregate (ครบทั้งชุด) + cap list ที่ 2000 แถว + flag `truncated`
- **M14** auth middleware ดึง role/full_name สดจาก DB ทุก request → เปลี่ยน role/ระงับมีผลทันที

### Service layer (เริ่ม) + Tests
- `server/lib/notify.js` (ใหม่): รวม `getUsersByRole`+`notifyRoles`+`createNotification`+`sendTelegram` — เลิก copy-paste `getUsersByRole` ใน 5 ไฟล์ (bills/ncr/uai/supplier/delivery)
- ชุดเทสต์ `node:test` (zero-dep): `npm test` → **12 ผ่าน** (unit: esc/safeSig/detectExt/validateQty · integration: sequence-unique, H4 no-CHECK, optimistic lock, FK RESTRICT, settings/audit, migration-once)

### Files Changed
| File | สิ่งที่ทำ |
|---|---|
| `server/db/migrate.js` | + framework (ใหม่) |
| `server/db/database.js` | + root migration 003 + VALID_NCR_STATUSES + IQC_DB_PATH + gate legacy |
| `server/db/schema.sql` | ncrs status TEXT (ไม่มี CHECK) + supplier_token nullable |
| `server/scripts/backup-db.js` | + backup tool (ใหม่) |
| `server/lib/notify.js` | + service (ใหม่) |
| `server/middleware/auth.js` | role/full_name สดจาก DB (M14) |
| `server/routes/uai.js` | ลายเซ็นเป็นไฟล์ (M2) + ใช้ lib/notify |
| `server/routes/exports.js` | sigDataUrl + PDF concurrency limiter + export esc/safeSig |
| `server/routes/reports.js` | LIMIT cap + SQL summary (M13) |
| `server/index.js` | SSE Set ต่อ user (M12) |
| `server/routes/{bills,ncr,supplier,delivery}.js` | ใช้ lib/notify |
| `server/test/{unit,integration}.test.js` | + ชุดเทสต์ (ใหม่) |
| `server/package.json` | + `test`, `backup` scripts |

> ยังเหลือ: SSE→Redis (ต้องมี Redis infra), full service/repository refactor ทุก route, E2E (Playwright) + API tests (supertest), M11 (optimize bills list query)

---

## 2026-06-19 | Security Hardening ตาม DEVMORE.md (Sprint 1–2)

### Summary
แก้ช่องโหว่/หนี้เทคนิคตาม [DEVMORE.md](DEVMORE.md) — Critical 3 + High 6 + Medium/Low อีกชุด แบบ **zero new dependency** (ไม่ลง helmet/file-type) ทั้งหมด syntax ผ่าน, server boot ผ่าน, client build ผ่าน

### Critical
- **C1 — PDF XSS/SSRF** (`server/routes/exports.js`): เพิ่ม `esc()` HTML-escape + `safeSig()` validate data-url ลายเซ็น — escape ทุกจุดที่ interpolate ข้อมูลผู้ใช้/Supplier ใน NCR PDF + UAI PDF (company header, items, timeline, supplier response, signatures, body)
- **C3 — Upload security** (`server/middleware/upload.js`, `index.js` + 16 route call-sites): เพิ่ม `verifyMagic` middleware ตรวจ magic number จริง (ไม่เชื่อ MIME client) + rename นามสกุลตาม magic + ลบไฟล์ที่ไม่ผ่าน; harden `/uploads` static (nosniff + force-download `.html/.svg/.js/...`)
- **C2 — Secrets**: เพิ่ม `.gitignore` + `.env.example`, JWT fail-fast ใน production (secret สั้น/default → exit), เลิก log รหัสผ่าน default ใน production

### High
- **H1** cookie `secure` flag (production) + fix `clearCookie` options
- **H2** global rate limit `/api` (200/min) + `/api/supplier` (30/min) + security headers (nosniff/X-Frame-Options/Referrer-Policy/HSTS) + `trust proxy` + ลด JSON limit 50mb→10mb
- **H3** Telegram bot token เป็น write-only (GET ไม่ส่งค่าจริง, POST อัปเดตเฉพาะเมื่อกรอกใหม่) + UI hint
- **H7** optimistic lock เพิ่ม: `request-uai` (กัน UAI ซ้อน), UAI qc-manager-review, reject-exec, bill reject
- **H8** audit `LOGIN` / `LOGIN_FAILED`
- **H9** mask `err.message` ใน production

### Medium / Low
- **M1/M5** PATCH bill item: re-validate expiry + ownership + qty sanity (`validateQty`) ใช้ทั้ง POST/PATCH/DELETE item
- **M4** เพิ่ม FK index ที่ขาด 16 ตัว (`schema.sql`)
- **M6** Telegram ส่ง plain text (เลิก `parse_mode:HTML`) กัน injection
- **M9** `supplier_token`/`supplier_link` เปิดเผยเฉพาะ purchasing/admin (NCR + UAI GET)
- **H6** client idle timeout 30 นาที + เตือนก่อน 2 นาที (`useIdleTimeout` + dialog ใน AppLayout)
- **L6** เอา admin ออกจาก nav รายงาน (ให้ตรง backend/role matrix)
- **M3** ลบไฟล์จริงบน disk เมื่อลบบิล/รายการ/NCR (`safeUnlink`, ลบหลัง commit) กัน storage leak
- **M8** Bill auto-draft (sessionStorage ทุก 30 วิ + beforeunload + กู้คืน/ละทิ้ง + เคลียร์เมื่อสร้างสำเร็จ)
- **M10** Notification archiving — ลบ read+เก่ากว่า 180 วัน (บูต + ทุก 24 ชม.)
- **L1** ลบ dead code (`uaiInfo`, no-op `.replace('AND ','AND ')`)
- busy_timeout=5000 + audit REOPEN status ให้ตรงจริง (`pending_uai`)

### Files Changed
| File | สิ่งที่ทำ |
|---|---|
| `server/index.js` | JWT fail-fast, security headers, rate limits, harden /uploads, mask error, telegram write-only, verifyMagic บน logo |
| `server/middleware/upload.js` | + `verifyMagic` (magic number) |
| `server/routes/exports.js` | + `esc()`/`safeSig()` escape ทุก PDF |
| `server/routes/auth.js` | secure cookie + audit LOGIN/LOGIN_FAILED |
| `server/routes/bills.js` | validateQty + ownership/expiry (POST/PATCH/DELETE item) + lock bill reject + verifyMagic |
| `server/routes/ncr.js` | lock request-uai + M9 token scope + verifyMagic |
| `server/routes/uai.js` | lock review/reject-exec + M9 token scope + verifyMagic + audit fix |
| `server/routes/{supplier,delivery,issue-talk,master}.js` | verifyMagic บนทุก upload |
| `server/routes/notifications.js` | telegram plain text |
| `server/db/database.js` | busy_timeout + ไม่ log password (prod) |
| `server/db/schema.sql` | + 16 FK indexes |
| `client/src/hooks/useIdleTimeout.js` | สร้างใหม่ |
| `client/src/components/Layout/AppLayout.jsx` | idle warning + auto-logout |
| `client/src/pages/Admin/Settings.jsx` | hint token write-only |
| `client/src/utils/rolePermissions.js` | reports nav ไม่รวม admin |
| `.gitignore`, `.env.example` | สร้างใหม่ |

> หมายเหตุ: ยังเหลือ (Sprint 3+) — migration framework (แก้ราก H4/TD-1), แตก service layer, pagination products/reports (H5/M13), SSE→Redis, PDF pool, ชุด test (TESTCASES.md), เก็บลายเซ็น base64 เป็นไฟล์ (M2), เปลี่ยน role ใน JWT ให้ดึงจาก DB ต่อ request (M14)

---

## 2026-06-15 | Admin Dashboard + Product Master Upgrade

### Summary
ปรับปรุงส่วน Admin ทั้งหมด: Sidebar sub-menu, Dashboard แสดงข้อมูลจริง, แบบฟอร์มสินค้าใหม่พร้อม AQL + รูปภาพ + Drawing preview

---

### 1. Sidebar — Admin Sub-menu (Collapsible)

**ไฟล์ที่แก้ไข:**
- `client/src/utils/rolePermissions.js`
- `client/src/components/Layout/Sidebar.jsx`

**สิ่งที่ทำ:**
- เพิ่ม `children` array ใน NAV_ITEMS สำหรับ Master List group
  - ผู้ผลิต → `/master/suppliers`
  - สินค้า → `/master/products`
  - กลุ่มสินค้า → `/master/product-groups`
  - กลุ่มปัญหา → `/master/defect-categories`
  - หน่วยนับ → `/master/units`
- Sidebar render sub-menu แบบ collapsible (expand/collapse ด้วยลูกศร)
- Auto-expand เมื่อ URL ตรงกับ child path
- เพิ่ม icons ให้ sub-menu items (building, box, folder, tag, ruler)

---

### 2. Admin Dashboard — Real Data

**ไฟล์ที่แก้ไข:**
- `server/index.js` — เพิ่ม `GET /api/admin/stats`
- `client/src/pages/Dashboard/index.jsx` — อัปเดต `AdminDash` component

**สิ่งที่ทำ:**
- เพิ่ม endpoint `/api/admin/stats` คืนค่า:
  - จำนวน: suppliers, products, product_groups, defect_categories, units, users
  - สถานการณ์: open_ncr, pending_bills, today_bills
  - recent_bills (6 รายการล่าสุด)
- AdminDash แสดง:
  - Operations cards (NCR เปิดอยู่ / บิลรออนุมัติ / บิลวันนี้)
  - Master List cards พร้อม count จริง — คลิกเข้าหน้าจัดการได้ทันที
  - ตารางบิลล่าสุด 6 รายการ
- ข้อมูล refetch ทุก 60 วินาที

---

### 2b. Product Form — Color Picker

**ไฟล์ที่แก้ไข:** `client/src/pages/Master/Products.jsx`

- เพิ่ม color chip picker ในฟอร์มสร้าง/แก้ไขสินค้า
- โหลดสีจาก `/api/master/colors`
- แสดงเป็น pill buttons พร้อม color swatch (hex_code)
- กดเพื่อ toggle เลือก/ยกเลิก — แสดง checkmark เมื่อเลือก
- เมื่อ editing: pre-select สีที่ผูกไว้แล้วจาก `initial.colors`
- ส่ง `color_ids` array ไปพร้อม form data (server รับได้อยู่แล้ว)

---

### 3. AQL Inspection Plan Dropdown

**ไฟล์ที่แก้ไข:**
- `client/src/pages/Master/Products.jsx`

**options ที่เพิ่ม:**
| inspection_level | label |
|---|---|
| GEN_I | General I |
| GEN_II | General II (มาตรฐาน) |
| GEN_III | General III (เข้มงวด) |
| S1–S3 | Special S-1 ถึง S-3 |
| **S4** | **Special S-4 / I-S4** |
| **FULL** | **ตรวจ 100% (ทุกชิ้น)** |

**AQL Values:**
- 0.65 (เข้มงวดมาก), 1.0, 1.5, **2.5 (default)**, 4.0, 6.5
- Disabled อัตโนมัติเมื่อเลือก FULL

---

### 4. Product Form — Image Upload + PDF Preview

**ไฟล์ที่แก้ไข:**
- `client/src/pages/Master/Products.jsx`
- `server/routes/master.js`
- `server/db/database.js`

**รูปภาพสินค้า:**
- Upload หลายไฟล์พร้อมกัน (multiple)
- Preview thumbnail ทันทีหลังเลือก (URL.createObjectURL)
- ลบรูปรายชิ้นได้ก่อน upload (ยกเลิก pending)
- หลัง save: โหลดรูปที่มีอยู่จาก server + ลบรูปเดิมได้

**รูปภาพปัญหาคุณภาพ:**
- section แยกชัดเจน (ขอบสีแดง)
- เพิ่มได้ทุกเวลา (ทั้ง new และ edit mode)
- เก็บใน `product_images` ด้วย `image_type = 'quality_issue'`

**PDF Drawing:**
- ถ้ามี Drawing อยู่แล้ว: แสดงชื่อไฟล์ + Revision + ปุ่ม "ดู PDF" (เปิดใน new tab)
- Upload Revision ใหม่ได้พร้อมกรอก revision code เช่น Rev.B

**DB Migration:**
- `product_images.image_type TEXT DEFAULT 'product'` (idempotent via safeAddColumn)

---

### Files Changed

| File | Action |
|---|---|
| `server/db/database.js` | + migration: product_images.image_type |
| `server/index.js` | + GET /api/admin/stats |
| `server/routes/master.js` | ~ product images: support image_type param |
| `client/src/utils/rolePermissions.js` | + children sub-menu for Master List |
| `client/src/components/Layout/Sidebar.jsx` | + collapsible sub-menu rendering |
| `client/src/pages/Dashboard/index.jsx` | ~ AdminDash: real stats + layout |
| `client/src/pages/Master/Products.jsx` | ~ Full upgrade: AQL + images + drawing preview |

---

---

## 2026-06-15 | สีสินค้า (Colors) — Master List Menu + CRUD Page

### Summary
เพิ่มเมนู "สีสินค้า" ใน Master List Sidebar และสร้างหน้าจัดการสีแบบ CRUD พร้อม live color swatch preview

### สิ่งที่ทำ

**1. Sidebar — เพิ่มเมนู สีสินค้า**
- `client/src/utils/rolePermissions.js` — เพิ่ม `{ path: '/master/colors', label: 'สีสินค้า', icon: 'palette' }` ใน children ของ Master List
- `client/src/components/Layout/Sidebar.jsx` — เพิ่ม `palette` icon (SVG)

**2. Route — เพิ่ม /master/colors**
- `client/src/App.jsx` — import `Colors` + เพิ่ม `<Route path="colors" element={<Colors />} />`

**3. หน้าจัดการสี — Colors.jsx (ใหม่)**
- `client/src/pages/Master/Colors.jsx`
- ตารางแสดง: ตัวอย่างสี (circle swatch), รหัส, ชื่อสี, Hex Code, สถานะ
- ฟอร์มเพิ่ม/แก้ไข:
  - `type="color"` native picker + Hex text input + preview swatch — sync กัน
  - รหัสสี (optional), ชื่อสี (required), hex_code
- Toggle active/inactive พร้อม confirm dialog
- ค้นหาตาม name หรือ code
- Checkbox "แสดงที่ปิดใช้งาน"

### Files Changed

| File | Action |
|---|---|
| `client/src/utils/rolePermissions.js` | + สีสินค้า child menu |
| `client/src/components/Layout/Sidebar.jsx` | + palette icon |
| `client/src/App.jsx` | + Colors import + route |
| `client/src/pages/Master/Colors.jsx` | + สร้างใหม่ทั้งหมด |

---

## 2026-06-19 | Export/Import Excel — Master List ทุกรายการ

### Summary
เพิ่มปุ่ม Export (ดาวน์โหลด .xlsx พร้อม dropdown จาก DB) และ Import (validate + preview + insert) ใน Master List ทุกหน้า: สินค้า, ผู้ผลิต, กลุ่มสินค้า, หน่วยนับ, กลุ่มปัญหา, สีสินค้า

---

### 1. Backend — server/routes/master.js

**เพิ่ม helper functions ที่ใช้ร่วมกัน:**
- `styleExcelHeader(ws, colCount)` — header row สีน้ำเงิน (#1A3A5C) + ขาว bold
- `parseImportFile(buffer)` — โหลด ExcelJS Workbook จาก buffer
- `cellStr(row, n)` — อ่าน cell เป็น string trim
- `importResponse(results)` — สร้าง response standard `{ results, total, errorCount, warningCount }`
- `makeResult(row, display, errors, warnings)` — สร้าง row result พร้อม status
- `parseBool(v)` — แปลง "ใช่"/"yes"/"y"/"1"/"true" → boolean

**เพิ่ม routes สำหรับแต่ละ Master:**

| Entity | Export route | Import route | Dropdown |
|---|---|---|---|
| Products | `GET /products/export` | `POST /products/import` | Supplier, กลุ่ม, หน่วย, Insp Level, AQL (Reference sheet) |
| Suppliers | `GET /suppliers/export` | `POST /suppliers/import` | ไม่มี |
| ProductGroups | `GET /product-groups/export` | `POST /product-groups/import` | Y/N inline dropdown (4 คอลัมน์) |
| Units | `GET /units/export` | `POST /units/import` | ไม่มี |
| DefectCategories | `GET /defect-categories/export` | `POST /defect-categories/import` | ไม่มี |
| Colors | `GET /colors/export` | `POST /colors/import` | ไม่มี |

**Pattern สำคัญ:**
- `?preview=1` → validate เท่านั้น ไม่ insert (two-step validate-then-import)
- Row-level error/warning tracking พร้อม display เป็น Thai keys
- auditLog ใน transaction ทุก insert
- Sequence safety: code uniqueness ตรวจทั้งใน file (seenCodes Set) และ DB

**Products Export — Reference sheet:**
- Column A: ชื่อ Supplier (จาก DB)
- Column B: ชื่อกลุ่มสินค้า
- Column C: ชื่อหน่วย, Column D: ตัวย่อ
- Column E: Inspection Level, Column F: label
- Column G: AQL Value
- dataValidation cross-sheet `Reference!$A$2:$A$N` สำหรับแถว 2–500

---

### 2. Frontend — ExcelImportModal Component (ใหม่)

**ไฟล์:** `client/src/components/UI/ExcelImportModal.jsx`

- Self-contained state machine: `pick → previewing → preview → importing → done`
- อ่านชื่อคอลัมน์จาก `Object.keys(result.display)` — backend กำหนด columns
- แถว error: `bg-red-50`, แถว warning: `bg-amber-50`
- Summary chips: total / error / warning / พร้อม Import
- ปุ่ม "นำเข้า" disabled เมื่อมี error
- ใช้กับ: Suppliers, ProductGroups, Units, DefectCategories, Colors

---

### 3. Frontend — Pages Updated

| Page | สิ่งที่เพิ่ม |
|---|---|
| `Products.jsx` | Export/Import buttons + inline import modal (custom columns) |
| `Suppliers.jsx` | import ExcelImportModal + handleExport + buttons + modal |
| `ProductGroups.jsx` | import ExcelImportModal + handleExport + buttons + modal |
| `Units.jsx` | import ExcelImportModal + handleExport + buttons + modal |
| `DefectCategories.jsx` | import ExcelImportModal + handleExport + buttons + modal |
| `Colors.jsx` | import ExcelImportModal + handleExport + buttons + modal |

---

### Files Changed

| File | Action |
|---|---|
| `server/routes/master.js` | + helper fns + 12 routes (export+import ×6 master types) |
| `client/src/components/UI/ExcelImportModal.jsx` | + สร้างใหม่ทั้งหมด |
| `client/src/pages/Master/Products.jsx` | + Export/Import inline modal |
| `client/src/pages/Master/Suppliers.jsx` | + ExcelImportModal integration |
| `client/src/pages/Master/ProductGroups.jsx` | + ExcelImportModal integration |
| `client/src/pages/Master/Units.jsx` | + ExcelImportModal integration |
| `client/src/pages/Master/DefectCategories.jsx` | + ExcelImportModal integration |
| `client/src/pages/Master/Colors.jsx` | + ExcelImportModal integration |

---

## Known Issues (ก่อนหน้า)

- `[NCR CREATE] no such table: main.ncrs_old` — เกิดจาก migration `migrateNcrStatusConstraint()` ที่ทำ ALTER TABLE RENAME แต่ DB อยู่ในสถานะเก่า ให้รัน `npm run clear-db` เพื่อ reset หรือตรวจสอบ DB ด้วย `sqlite3 iqc.db ".tables"` ว่ามี `ncrs_old` ค้างอยู่หรือไม่

---
