# DEVLOG — IQC Quality Management System

---

## 📌 Current State (2026-07-23)

**Version:** rev01 · Production · **Latest code:** Session 161 (2026-07-23)

**Architecture Summary**
- Backend: Express 4.18 + better-sqlite3 (WAL, FK ON), **102 ตาราง** (+`environment_presets`, S118; +`supplier_purchasing_assignees`, S125), ~33 route files, SSE + Telegram + **Email/SMTP (S128, `lib/mailer.js`)**, port 3001
- Frontend: React 18 + Vite 5 + Tailwind 3.4, **51+ หน้า / 14 roles** (+`purchasing_manager`, S125; +`warehouse_supervisor`/`warehouse_manager`, S127), React Query + SSE, `rolePermissions.js` รวมสิทธิ์ + `ROLE_LABELS`/`CREATABLE_ROLES` (จุดรวม role label เดียว, S103; รองรับครบ 11 roles จริง, S105), **App-wide Dark Mode (Light/Dark/Auto ต่อ user, S121, contrast แก้แล้ว S122 — ดู §25 ใน CLAUDE.md)**, **Table redesign แบรนด์ (gradient header, S122 — ดู §26)**
- โมดูล: IQC (Bills→NCR→UAI), Production QC (IPQC/FGQC), FG (defect→FNCP→FUAI), KPI, Attendance, Issue Talk, Delivery, Master, ProCodeSAP/PDPlan (FQC ถูกลบแล้ว — ดู S104), **Authentication Provider Framework (Local + Active Directory แบบ pluggable, S118 — ดู §24 ใน CLAUDE.md)**, **Purchasing Supplier-Assignment + Dashboards (S125 — ดูรายละเอียดด้านล่าง)**

**Completed Features** ✅ Bills · NCR/NCP · UAI · IPQC/IPNCR · FGQC · FNCP/FUAI · KPI · Attendance · Issue Talk · Delivery · Master + Excel I/O · ProCodeSAP classifier (Tier 0–4) · Audit log · SSE · PDF/Excel export

**Known Issues (ดู [`../AUDIT.md`](../AUDIT.md))**
- ✅ Test fixture (role CHECK) แก้แล้ว (Session 87) — **test 43/43 เขียว ณ ตอนนั้น**; ✅ **Role drift ตัวจริง (D1, schema/frontend) แก้แล้วแยกต่างหาก (Session 105)** — คนละปัญหากับ S87 ที่เคยเข้าใจปนกัน (ดู bullet ด้านล่าง)
- ✅ **2 test skip (`fqc`/`ipqc`) ปิดครบแล้ว (S104)** — ลบทั้งคู่ (ไม่ใช่แค่ update path): `fqc.test.js` + `fqc_records`(+3 child tables) ลบทั้งฟีเจอร์ (dead, superseded by `fgqc_records`); `ipqc.test.js` ลบเช่นกัน — **พบว่าไม่ใช่แค่ path ผิด แต่ทดสอบ `ipqc_records` ซึ่งเป็นตารางที่ไม่เคยมี route จริงเลยเหมือนกัน** (ตัวจริงคือ `ipqc_inspections` ผ่าน `ipqcInspection.js`) → เปิด gap ใหม่: **`ipqc_inspections` create→submit flow ไม่มี integration test เลย** (ดู testcase.md §3, P1)
- ✅ P1 infra (S88) · ✅ service+test: NCR/UAI (S89-90,93) · Bills (S91) · Delivery (S92) · KPI ครบทั้งหมด (S94-95,101-102) · **FG FNCP ครบ/FUAI/IPNCR (S96-99)** — 9 service, **161 tests เขียว, 0 skip**
- 🏁 **Service-layer extraction milestone ปิดครบแล้ว (S88–102)** — ไม่มี domain CRUD/transaction เหลือ inline ใน route handler อีก (ยกเว้น title-templates/units/no-patterns ที่เดิมไม่มี transaction/audit — ย้ายที่อยู่เฉยๆ คงพฤติกรรมเดิม)
- 🏁 **P2 roadmap ปิดครบแล้ว (S103):** ถอด `fabric` dead dep · centralize `ROLE_LABELS` · นิยามขอบเขต KPI/fqc-fgqc ชัดเจน · แตก `Dashboard/index.jsx` (1559 บรรทัด) เป็น 9 ไฟล์ต่อ role + `GET /api/dashboard/stats` (server aggregate แทน 4×limit=500 client-side filter)
- 🏁 **Cleanup ตามมติ product owner ปิดแล้ว (S104):** `fqc_records`+child tables ลบจาก schema+migration+scripts/clear-data.js+proCodeSap.js reset-all (ยืนยัน 0 แถวใน production DB ก่อนลบ, migration รันจริงกับ dev DB สำเร็จ) · `kpi_reports`(+entries/files/approvals) mark **DEPRECATED** ด้วย comment ใน schema.sql/routes/kpi.js/services/kpiService.js/App.jsx/ReportDetail.jsx (ไม่ลบ ไม่สร้าง UI ใหม่ ตามมติ) · `ipqc.test.js`/`fqc.test.js` ลบทั้งคู่
- 🏁 **P0 role drift (D1) ปิดครบแล้ว (S105)** — ตรวจโค้ดจริงพบว่า `schema.sql` มี **11 roles อยู่แล้วจริง** (รวม `prod_supervisor`) + มี migration `migrateUsersRoleConstraint()` อัปเกรด DB เก่าครบด้วย (ยืนยันด้วย `INSERT` ทดสอบสำเร็จทั้ง fresh schema และ dev DB จริง) — ตัว gap จริงอยู่ที่ frontend `rolePermissions.js`'s `CREATABLE_ROLES` ที่กันไม่ให้เลือก `prod_supervisor` เอง (ตั้งไว้ผิดใน S103 ตามความเข้าใจผิดขณะนั้น) แก้โดยเอาเงื่อนไขกรองออก — **verify end-to-end จริงผ่าน Playwright**: login admin → สร้าง user role `prod_supervisor` ผ่าน UI จริงสำเร็จ → ลบ test user ออก **P0 ทั้งหมดใน roadmap ปิดครบแล้ว**
- 🔴 **พบ gap ใหม่ (S104, ต้องตัดสินใจ):** `ipqc_records`/`ipqc_images` (คนละตารางจาก `ipqc_inspections` ที่ใช้จริง) **ก็เป็น dead table เหมือน fqc_records** — ไม่มี route ไหนแตะเลยนอกจาก FK-cleanup ใน `proCodeSap.js`, ยืนยัน 0 แถวใน dev DB — **ยังไม่ได้ลบ** (นอกขอบเขตคำขอเดิม รอ confirm จาก user ก่อน) — ถ้าลบ ต้องแก้ `proCodeSap.js`, `scripts/clear-data.js`, schema.sql เหมือน fqc_records; นอกจากนี้ CLAUDE.md §21.3/21.9 อธิบาย `ipqc_records`+`generateDefectCode` เป็นกฎที่ใช้งานจริง — **เอกสารไม่ตรงกับโค้ดจริง** ต้องแก้ด้วยถ้าตัดสินใจลบ
- 🟡 พบ bug แฝง (ไม่ได้แก้ — คงพฤติกรรมเดิม): `kpi_targets`/`kpi_actuals` bulk upsert เรียก `auditLog(table, null, ...)` แต่ `audit_logs.record_id` เป็น NOT NULL → insert audit ล้มเงียบ (catch แล้ว log error, ไม่ throw) ทุกครั้งที่ upsert หลายแถวพร้อมกัน — ควรแก้เป็น audit ต่อแถวหรือ relax constraint ในรอบถัดไป
- 🟡 พบระหว่าง verify (S103): user `supervisor1` (seed) login ไม่ผ่านในเครื่อง dev จริง (บัญชีถูกเปลี่ยนรหัส/ระงับนอกรอบ seed) — ไม่เกี่ยวกับโค้ด ไม่ได้แก้
- 🟡 พบระหว่างแก้ proCodeSap reset-all (S104): `fgqc_records.pro_code_sap_id` เป็น `ON DELETE RESTRICT` เหมือน `ipqc_records`/`fqc_records` เดิม แต่ route `/reset-all` ไม่เคย NULL ออกให้เลย — เป็น gap เดิมที่มีอยู่ก่อนแล้ว (ไม่ใช่สิ่งที่ session นี้ทำให้แย่ลง) ยังไม่ได้แก้
- ✅ **Bug user report (S106): ชื่อไฟล์ภาษาไทยเพี้ยนหลัง upload** — root cause = multer/busboy decode `Content-Disposition` filename header เป็น `latin1` เสมอ (Node http header spec เก่า) แก้ด้วย `fixOriginalName()` ใน `middleware/upload.js` ใช้ครอบคลุมทุก multer instance ในระบบ (verify ด้วย HTTP round-trip จริงผ่าน pipeline เต็ม — ไม่ใช่แค่ unit test) — ดู bullet รายละเอียดด้านล่าง

- 🏁 **Deploy/Backup/Restore architecture เอกสารครบแล้ว (S124)** — R2 backup/restore/bootstrap system (`bootstrap.js`/`lib/backupService.js`/`lib/restoreService.js`/`lib/r2Client.js`, สร้างไว้ตั้งแต่ก่อน S110 แต่ไม่เคยถูกบันทึกใน DEVLOG) มี **CLAUDE.md §27** เอกสารแล้ว + แก้ **AUDIT.md D5** ที่บอกข้อมูลผิด (ว่ายังไม่มี auto-backup) + แก้ root cause DB corrupt ซ้ำ 3 ครั้งใน S119 (`docker-compose.local.yml` bind-mount → named volume) + เปิดทาง phone-testing แบบ native (`vite.config.js` host:true) + เพิ่ม test คลุม `backupService.js` alerting ที่ค้าง uncommitted อยู่ก่อนหน้า
- 🏁 **Purchasing Supplier-Assignment + Dashboards (S125)** — เพิ่ม role `purchasing_manager`, ตาราง `supplier_purchasing_assignees` (m:n), scope ทั้ง visibility/action/notification ของ NCR-UAI-Delivery ตามผู้ดูแล Supplier, เปิดสิทธิ์ Purchasing/Manager จัดการ Supplier เอง, สร้าง Purchasing Dashboard + Purchasing Manager Dashboard (Team Summary/Members/Member Detail + KPI) ครบ, แก้ notification gap (purchasing_manager/Supplier Response/Overdue) — รายละเอียดเต็มดู session log ด้านล่าง; **CLAUDE.md §11 Role Matrix ยังไม่ได้เพิ่มคอลัมน์ `purchasing_manager`** (เอกสารสรุปเดิม 10 คอลัมน์ ไม่ครอบ role ใหม่นี้ — รอปรับรอบถัดไป, ไม่กระทบโค้ด)
- 🏁 **Delivery notification/real-time bugs + tag drill-down + yearly view + actual-time (S126)** — user รายงาน
  3 รอบ: (1) กระดิ่ง acknowledge เด้งลิงก์ค้าง + กระดิ่งอื่นๆ ไม่ deep-link เฉพาะจุด, (2) ปฏิทินจัดซื้อไม่
  auto-update ตอน QC ปิดสถานะ + ไม่มีกระดิ่งแจ้งรับของ, (3) tag summary modal ขาดคอลัมน์สถานะ/เวลาส่งจริง +
  เปลี่ยนชื่อ "นอกแผน"→"ไม่มีแผนส่ง" กันสับสนกับสถานะ "ส่งนอกแผน" — แก้ครบทั้ง route-effect bug (React Router ไม่
  remount ตอน query param เปลี่ยน), missing deep-link ในเกือบทุก notification call site, บั๊กจริงใน
  `useSSE.js`'s `keysFromLink()` (ไม่ตัด query string ก่อน match), เพิ่มคอลัมน์ `received_by`/`actual_time`,
  tag สรุปสถานะคลิกดูรายการ+export Excel ได้, มุมมองปฏิทินรายปี — รายละเอียดเต็มดู session log ด้านล่าง
- 🏁 **Deploy-safety Q&A + Purchasing Manager nav fix (S127)** — (1) user ถามว่า schema migration ที่เพิ่ม
  รอบ S126 จะทำให้ deploy ใหม่บน Render (restore-on-boot จาก R2) พังไหม — ตอบด้วยหลักฐานโค้ดจริง (ไม่ใช่แค่เดา):
  ปลอดภัย เพราะ restore เกิดเฉพาะตอน local DB ว่าง + migration รันต่อทุกครั้งแบบ idempotent เสมอไม่ว่าจะ restore
  มาหรือไม่ (ไม่มีการแก้โค้ด เป็นคำถามล้วนๆ) (2) เพิ่ม `purchasing_manager` เข้า roles ของเมนู Issue Talk ใน
  `rolePermissions.js` (เดิมตกหล่นตั้งแต่เพิ่ม role นี้ใน S125 — backend ไม่ได้ล็อก role อยู่แล้ว ตกแค่ sidebar)
  (3) `Sidebar.jsx` เพิ่ม `ALWAYS_EXPAND_ROLES` — จัดซื้อ/ผู้จัดการจัดซื้อเห็นหัวข้อย่อยของทุกกลุ่มที่มีสิทธิ์
  ทันทีโดยไม่ต้องคลิกเปิด accordion เหมือน role อื่น (role อื่นยัง accordion เดิม) (4) เพิ่ม role ใหม่
  `warehouse_supervisor`/`warehouse_manager` — รับหน้าที่กด "รับทราบ" แผนรับเข้าแทน qc_staff/qc_supervisor เดิม
  ทั้งหมด (ถาม `AskUserQuestion` ยืนยันขอบเขตก่อนเริ่มเพราะกระทบ schema+workflow) qc_staff เหลือแค่บันทึกวันเวลา
  มาส่งจริง sidebar คลังโชว์เฉพาะ "ปฏิทินส่งของ" เท่านั้น
- 🏁 **NCR: มูลค่าเคลม/รหัสสินค้า/disposition visibility/purchasing_manager gate/COO email (S128)** — เพิ่ม
  `claim_value_thb`/`claim_value_usd` บังคับกรอกใน Purchasing Review modal (รับ `"-"` เป็นค่าถูกต้อง), เพิ่มรหัส
  สินค้าต่อท้ายชื่อสินค้าใน "ข้อมูล NCR" (join `bill_items→products` ที่ไม่เคยมีใน `GET /ncr/:id` มาก่อน — PDF
  export มีอยู่แล้วแต่หน้าจอไม่มี), เพิ่มกล่อง "ข้อมูลการจัดการของ QC Manager" (disposition) ใต้รายการสินค้า,
  หมายเหตุแดง "ตีกลับสินค้า 100%..." (TH+EN) เฉพาะ `disposition='return'`, สถานะใหม่
  `pending_purchasing_manager_review` (maker-checker gate — purchasing_manager ต้องอนุมัติก่อนจัดซื้อจะ copy
  link ได้ ปิด gap เดิมที่ copy ได้ตั้งแต่ `pending_purchasing_review`), Email/SMTP infra ใหม่ทั้งหมด
  (`lib/mailer.js` + Admin Settings "Email" tab + `users.email` column) ส่งแจ้ง COO (role `cco`) + Telegram
  ส่วนตัวเมื่อ purchasing_manager อนุมัติ, แก้ label "CCO"→"COO" ทุกจุด (role id `cco` เดิมไม่แตะ) — **รอบที่ 2:**
  แก้ "NCR/NCP ของฉัน" + KPI summary ให้รวม NCR ของ supplier ที่ยังไม่มีผู้ดูแลด้วย (fallback เหมือน `/ncr` หลัก)
  โดย "ผู้ผลิตของฉัน" ยังคงเข้มงวดเหมือนเดิมตามมติ user — **รอบที่ 3:** เพิ่มปุ่ม "ไม่อนุมัติ" ให้ purchasing_manager
  ที่ขั้น review — ไม่อนุมัติแล้วย้อนกลับให้จัดซื้อ Review ใหม่ (ค่าที่กรอกไว้ไม่ถูกล้าง) — **รอบที่ 4:** เพิ่มรหัส
  สินค้า/disposition/หมายเหตุแดง (return) ในหน้า Supplier Response ด้วยตามคำขอใหม่ (เดิมตกลงไว้ว่าไม่แตะหน้านี้ —
  รอบนี้ user ขอตรงๆ) พร้อมปิด info-leak เล็กๆ ที่เจอระหว่างแก้ (`claim_value_thb`/`usd` เคยรั่วไปให้ Supplier เห็น
  โดยไม่ตั้งใจผ่าน `ni.*`) — รายละเอียดเต็มดู session log ด้านล่าง
- 🏁 **Suppliers Export/Import: คอลัมน์ผู้ดูแลจัดซื้อ + diff-aware update/skip (S129)** — Export เพิ่มคอลัมน์ Y/ว่าง
  1 คอลัมน์ต่อ 1 purchasing user (Excel dropdown เดียวเลือกได้หลายคนในเซลล์เดียวไม่ได้จริงถ้าไม่พึ่ง VBA macro ที่
  exceljs เขียนไม่ได้ — ยืนยันแนวทางกับ user แล้วเลือกแบบตาราง Y/N แทน) Import เปลี่ยนจาก insert-only ที่ error ทันที
  เมื่อรหัส/ชื่อซ้ำของเดิม เป็น diff-aware: เทียบทุก field (รวมผู้ดูแลจัดซื้อ) กับ supplier เดิม — เหมือนกันหมด
  → skip เงียบๆ ไม่แตะ DB เลย, ต่างอย่างน้อย 1 จุด → update จริงพร้อมโชว์ว่าเปลี่ยนอะไรบ้าง — สถานะใหม่ 2 ตัว
  (`update`/`skip`) เพิ่มเข้า `ExcelImportModal.jsx` (shared component ที่ Products/Units/ProductGroups/
  DefectCategories/Colors ใช้ร่วมด้วย) แบบ additive เท่านั้น ไม่กระทบ import route อื่นเลย — รายละเอียดเต็มดู
  session log ด้านล่าง
- 🏁 **Suppliers↔ProductGroup m:n + Products form filter (S146-147)** — 1 supplier มีได้หลายกลุ่มสินค้า, ฟอร์ม
  เพิ่มสินค้ากรอง Supplier ตามกลุ่มที่เลือก (strict filter หลัง S147 แก้ fallback ที่บังตา bug)
- 🏁 **Suppliers export/import คอลัมน์กลุ่มสินค้า: Y/N-matrix (S148) → comma-separated (S149)** — S148 เพิ่มคอลัมน์
  Y/ว่าง ต่อ 1 กลุ่ม ให้สัมพันธ์กับตาราง, ทันทีหลังทำเสร็จ user feedback ว่าคอลัมน์เยอะดูยาก → S149 กลับคำเป็นคอลัมน์
  เดียว comma-separated เหมือน Products.jsx's Supplier field (S129) — คอลัมน์ผู้ดูแลจัดซื้อยังเป็น Y/N-matrix เดิม
  (จำนวนน้อยจริง ไม่ได้อยู่ในขอบเขต)
- 🏁 **Render Bandwidth Audit รอบ 2: syncUploads() re-upload ไฟล์ lazy-fetch ซ้ำ (S150)** — bandwidth ยังสูงอยู่
  (~1GB/วัน) หลัง S141's hot-backup dedup fix แล้ว 3 วัน (ยังไม่เคย verify กับ Render จริง) — พบสาเหตุใหม่ที่ S141
  ไม่ครอบคลุม: deployment จริงใช้ Free tier + `RESTORE_ON_BOOT=true` (ephemeral disk, `DEPLOYMENT.md` §8.2) —
  ไฟล์แนบเก่าที่ถูก lazy-fetch กลับจาก R2 หลัง restart (`index.js`'s `/uploads` cache-miss handler) ได้ mtime
  ใหม่เป็น "ตอนนี้" เสมอ (`r2Client.js`'s `getObjectToFile` ไม่รักษา mtime เดิม) แต่ `upload-sync-state.json`
  ไม่เคยถูก restore (`restoreService.js` restore เฉพาะ DB) → `syncUploads()` รอบถัดไป (≤10 นาที) เข้าใจผิดว่า
  ไฟล์เปลี่ยน แล้วอัปโหลดกลับไป R2 คีย์เดิมที่เพิ่งโหลดมาโดยไม่มีประโยชน์เลย แก้ด้วย `markLocalFileSynced()`
  (`backupService.js`) เรียกทันทีหลัง lazy-fetch สำเร็จ กัน false-positive นี้ — รายงานวิเคราะห์เต็ม (evidence/
  ranking/priority) อยู่นอก repo (plan file ของ session นี้ผ่าน Plan Mode) — **รอบที่ 2 (คำขอเพิ่มเติม):** ยืด
  รอบ scheduler ของ `runFullCycle()` จาก 10 นาที → **2 ชม.** (`server/index.js`) ลด bandwidth เพิ่มเติมโดยยอมรับ
  RPO ที่กว้างขึ้น — เงื่อนไข "backup เฉพาะถ้าข้อมูลเปลี่ยนในช่วงนั้น" มีอยู่แล้วจาก hash-dedup ของ `runHotBackup()`
  (S141) ไม่ต้องแก้ logic เพิ่ม แค่เปลี่ยนค่า interval — รายละเอียดแก้ไขดู session log ด้านล่าง
- 🏁 **Bug user report (S151): NCR แจ้ง "เกินกำหนด" ไปกลุ่มจัดซื้อก่อน QMR อนุมัติเปิดเอกสารด้วยซ้ำ** — root cause:
  `overdueNotifier.js` นับ "เกินกำหนด" จาก `disposition_due_date` ที่ QC Manager กรอกเองตอนส่ง NCR ให้ QMR อนุมัติ
  (ขั้น `pending_manager`) ไม่เกี่ยวกับว่า QMR อนุมัติเปิดจริงหรือยัง — เพิ่มคอลัมน์ `ncrs.qmr_opened_at` (ตั้งค่าใน
  `ncrService.js`'s `approveNcr()` ตอน transition `pending_qmr_open → pending_purchasing_review` จริง) เปลี่ยน
  `overdueNotifier.js` ให้นับจากจุดนี้ + N วัน (ตั้งค่าได้ที่ Admin > ตั้งค่า > Telegram, key `ncr_overdue_days`,
  default 7 ถ้ายังไม่ได้ตั้ง) — NCR ที่ QMR ยังไม่เปิด (`qmr_opened_at IS NULL`) จะไม่มีวันถูกนับว่าเกินกำหนดอีกต่อไป
  — มี data-heal backfill `qmr_opened_at` ให้ NCR เก่าที่ผ่านขั้น QMR เปิดไปแล้วก่อน deploy (จาก
  `ncr_approvals` ของ role='qmr' ที่เก่าสุด) กัน overdue tracking หายไปเงียบๆ สำหรับเอกสารที่ค้างอยู่ — รายละเอียด
  ดู session log ด้านล่าง
- 🏁 **Feature request (S152): แจ้งเตือน NCR ค้างอนุมัติ — แบบส่วนตัว (ก่อนถึงจัดซื้อ) + แบบซ้ำ (หลังถึงจัดซื้อ)**
  ต่อยอดจาก S151 เป็น 2 กลไกคู่ขนาน: **(1) ใหม่** `lib/internalReminder.js` — แจ้ง Telegram ส่วนตัว (auto ผ่าน
  `createNotification`) ให้ Supervisor/Manager/QMR เมื่อ NCR ค้างอยู่ที่ขั้นของตนเกิน N วัน (setting
  `ncr_internal_reminder_days`, default 3) นับจากเวลา approve ล่าสุดใน `ncr_approvals` (หรือ `created_at` ถ้า
  ยังไม่มีใครอนุมัติเลย = ขั้นแรกสุด) แจ้งซ้ำทุก N วันจนกว่าจะอนุมัติผ่านขั้นไป — ครอบคลุมเฉพาะ 3 ขั้นก่อนเอกสาร
  "ถึงจัดซื้อ" (`pending_supervisor`/`pending_manager`/`pending_qmr_open`) ตามที่ user ยืนยันขอบเขต — เพิ่ม
  `ncrs.internal_reminder_last_sent_at` reset เป็น `NULL` ทุกครั้งที่ status เปลี่ยน (`ncrService.js`) กันขั้นใหม่
  สืบทอดรอบแจ้งเตือนจากขั้นเก่า **(2) ต่อยอด** `overdueNotifier.js` (ฝั่งจัดซื้อจาก S151) เปลี่ยนจากแจ้งครั้งเดียว
  เป็น**แจ้งซ้ำทุก N วัน** (setting ใหม่ `ncr_overdue_repeat_days`, default 3) จนกว่าจะปิดเอกสาร +
  ข้อความเพิ่มจำนวนวันที่เกินกำหนดมาแล้วจริง (ไม่ใช่แค่วันครบกำหนด) + แนบ link เข้าดูเอกสารตรงในข้อความกลุ่ม Telegram
  ด้วย (เดิมมีแค่ในแจ้งเตือนส่วนตัว) — settings ทั้ง 3 ตัว (`ncr_overdue_days`/`ncr_overdue_repeat_days`/
  `ncr_internal_reminder_days`) ตั้งค่าได้ที่ Admin > ตั้งค่า > Telegram — scheduler เดิม (`runOverdueCheck`,
  ทุก 1 ชม.) เรียกทั้ง 2 กลไกในรอบเดียวกัน ไม่เพิ่ม interval ใหม่ — รายละเอียดดู session log ด้านล่าง
- 🏁 **Feature request (S153): @mention ผู้ดูแลจัดซื้อในข้อความกลุ่ม Telegram เกินกำหนด** — เพิ่มคอลัมน์
  `users.telegram_username` (แยกจาก `telegram_chat_id` เดิมที่ใช้ส่ง DM ส่วนตัวเท่านั้น) ตั้งค่าได้ที่ Admin >
  จัดการผู้ใช้ — `overdueNotifier.js` (S151/S152) แปะ `@username` ของผู้ดูแลจัดซื้อของ supplier นั้นๆ นำหน้า
  ข้อความกลุ่ม Telegram ที่แจ้ง NCR เกินกำหนด (ใหม่: `purchasingScope.js`'s `getSupplierAssigneeMentions()`) —
  ใช้ plain-text `@username` (Telegram parse เป็น mention entity อัตโนมัติแม้ไม่ตั้ง parse_mode) **ไม่ใช้**
  parse_mode:HTML/text_mention เพราะ `sendTelegram()` ส่งแบบ plain text เสมอตามที่ตั้งใจไว้ (กัน HTML injection
  จากข้อความที่มีค่าผู้ใช้กรอกปนอยู่) — ถ้า supplier ไม่มีผู้ดูแล specific หรือผู้ดูแลยังไม่ตั้ง username ไม่ mention
  ใครเลย (ไม่ throw) — รายละเอียดดู session log ด้านล่าง
- 🏁 **ขยายผล (S154): @mention ครบทุกข้อความกลุ่ม Telegram จัดซื้อใน `ncrService.js`** — ต่อยอด S153 ทันที (user
  ตอบรับข้อเสนอ) เพิ่ม `purchasingMentionsForBill(billId)` helper ใหม่ใน `ncrService.js` (reuse
  `getSupplierAssigneeMentions()` เดิม) แล้วแปะ @mention นำหน้าข้อความกลุ่มจัดซื้อ**ครบทั้ง 7 จุด** ใน
  `ncrService.js` (QMR อนุมัติเปิด/พร้อมส่ง Supplier/ปิดแล้ว/รอผู้จัดการจัดซื้อตรวจสอบ/ไม่อนุมัติ Review/QC
  Manager ไม่อนุมัติคำตอบ Supplier/ส่ง Supplier ตอบใหม่) — ยังไม่แตะ `deliveryService.js`/`uaiService.js` (นอก
  ขอบเขตคำขอ ยังไม่ได้ระบุ) — รายละเอียดดู session log ด้านล่าง
- 🏁 **Bug user report (S155): Products Excel import error 332/2029 แถวหลัง export→import — root cause คือตัวคั่น
  comma ชนกับชื่อ Supplier ที่มี comma อยู่ในตัวเอง ไม่ใช่สินค้าเก่า** — ตรวจ DB จริงพบ Supplier 13 รายมี comma ใน
  ชื่อจริง (เช่น `"...CO.,LTD"`) กระทบสินค้าอยู่ 202/2042 รายการ — เดิม `products/export`+`/import`
  (`master.js`) ใช้ comma คั่นทั้งระหว่าง Supplier หลายรายและอยู่ในชื่อ Supplier เอง ทำให้ import กลับมา split
  ชื่อผิด **แก้ root cause**: เปลี่ยนตัวคั่นเป็น `;` (semicolon, ไม่มี Supplier รายไหนใช้อักขระนี้จริง) ทั้ง
  export header/join, import split, dropdown validation error text, checkHeaders — ไฟล์เก่าที่ export ด้วย
  header แบบ comma จะถูกปฏิเสธด้วย header-mismatch error ชัดเจนแทนที่จะ misparse เงียบๆ (ต้อง export ใหม่เท่านั้น
  ไฟล์เก่าใช้ต่อไม่ได้) — **เพิ่มเติม**: export กรองเฉพาะ `is_active=1` แล้ว (เดิมส่งออกสินค้าปิดใช้งานด้วย ทำให้
  ปิดใช้งานแล้วก็ยัง export→error ซ้ำวนไม่จบ) + เพิ่มปุ่ม **"ลบสินค้านี้ออกจากระบบ"** ที่แถว error ใน preview modal
  (ลบถาวรถ้าไม่มีประวัติผูก FK เลย ไม่งั้น fallback ปิดใช้งานอัตโนมัติตาม CLAUDE.md §2.5) สำหรับสินค้าที่เหลือจริงๆ
  ที่เลิกใช้แล้วหลังแก้ root cause แล้ว — รายละเอียดดู session log ด้านล่าง

**Technical Debt / Roadmap:** ดู [`../AUDIT.md`](../AUDIT.md) §12 (Refactor Roadmap) — **P0 ปิดครบแล้ว (S105)**; P1 ปิดครบ; P2 ปิดครบ (S103); เหลือ P3 (horizontal scale, TypeScript) + gap ใหม่ (ipqc_records removal decision, ipqc_inspections test coverage, fgqc reset-all FK gap) + restore-drill ยังไม่ automate ใน CI (ดู AUDIT.md D5) + CLAUDE.md §11 Role Matrix ต้องเพิ่ม purchasing_manager (S125) + purchasing_manager review step (S128)

**เอกสารอ้างอิง:** [`../CLAUDE.md`](../CLAUDE.md) · [`../PRD.md`](../PRD.md) · [`../brand.md`](../brand.md) · [`../design-dashboard.md`](../design-dashboard.md) · [`../testcase.md`](../testcase.md) · [`../AUDIT.md`](../AUDIT.md)

---

## 2026-07-23 | Session 161 — NCR: เพิ่ม status ใหม่ `pending_staff_revision` ให้ส่งกลับแก้ไขได้จากทุกขั้นก่อนถึง Supplier (supervisor→manager→qmr→purchasing→purchasing_manager) กลับไป qc_staff รับเข้า

**คำขอ:** "ปรับให้เอกสาร NCR สามารถส่งกลับแก้ไขได้ตั้งแต่ผู้จัดการจัดซื้อย้อนกลับไปจนถึง qc_staff รับเข้า" — เดิม
มีแค่ `rejectPurchasingManagerReview` ที่ purchasing_manager กดได้ แต่ส่งกลับแค่ 1 ขั้น (ไปหา purchasing) ไม่ใช่
ไปถึง qc_staff ที่เป็นต้นตอข้อมูล และไม่มีกลไกแบบนี้เลยที่ขั้นอื่น (supervisor/manager/qmr/purchasing)

**ขอบเขต (ถามและตกลงกับ user ก่อนแก้ เพราะกระทบ NCR state machine ซึ่งเป็นแกน ISO compliance):**
1. จุดที่กดส่งกลับได้ — **ทุกขั้นตอน**: supervisor/manager/qmr/purchasing/purchasing_manager (ไม่ใช่แค่
   purchasing_manager ตามคำขอตัวอักษรเป๊ะๆ — user เลือกให้ครอบคลุมกว้างกว่านั้น)
2. หลัง qc_staff แก้ไขแล้วส่งกลับเข้าระบบ — **เริ่มอนุมัติใหม่ทั้งหมดตั้งแต่ `pending_supervisor`** (ปลอดภัยกว่า
   ข้ามขั้นที่เคยอนุมัติไปแล้วบนข้อมูลที่เพิ่งแก้ไข)
3. สิ่งที่แก้ไขได้ — เฉพาะข้อมูล item: กลุ่มปัญหา/รายละเอียด/จำนวน/รูป (ไม่ใช่แค่หมายเหตุ+ส่งกลับเข้าระบบเฉยๆ
   แบบ Bills reject — ต้องมี edit UI จริง)

**Schema:** เดิมกังวลว่าต้อง rebuild ตาราง `ncrs` (ตาม pattern `migrateNcrAddPendingUai`) แต่พบว่า **`ncrs.status`
ไม่มี CHECK constraint จริงมาตั้งแต่ DEVMORE H4** (validate ที่ app layer ผ่าน `db.VALID_NCR_STATUSES` แทน) —
เพิ่ม `'pending_staff_revision'` เข้า Set นั้นที่เดียวพอ ไม่ต้อง migration ใดๆ เลย

**Backend (`services/ncrService.js`):**
- `STAFF_REJECT_ROLES` — map status ปัจจุบัน → role ที่มีสิทธิ์กดส่งกลับ (คู่กับ `role` ใน `approveNcr`'s
  transitions map, คนละทิศทางของ action เดียวกัน)
- `rejectToStaff()` — status ปัจจุบัน → `pending_staff_revision` (optimistic lock) + บันทึกลง `ncr_approvals`
  (action='rejected_to_staff') + แจ้ง `ncr.created_by` + `getReceivingQCStaff()` (กลุ่ม qc_staff สถานี incoming) + Telegram
- `updateNcrItemsAsStaff()` — แก้ `ncr_items` (qty_received/qty_sampled/qty_failed/defect_category_id/
  defect_detail) เฉพาะตอนสถานะ `pending_staff_revision` เท่านั้น — รูปภาพใช้ endpoint เดิม (`POST`/`DELETE
  /ncr/:id/images`) ที่มีอยู่แล้วและไม่เคย gate ด้วย status (ตรวจแล้ว) ไม่ต้องสร้างใหม่ แค่เพิ่ม UI เรียกใช้
- `resubmitAfterStaffRevision()` — `pending_staff_revision` → `pending_supervisor` + **เคลียร์
  disposition/disposition_note/disposition_due_date/disposition_completed_at/disposition_by/
  effectiveness_*/qmr_opened_at/internal_reminder_last_sent_at ทั้งหมดเป็น NULL** (กันข้อมูลรอบก่อนค้างแสดงผิด
  ตอนเข้ารอบอนุมัติใหม่ — แต่ละขั้นจะตั้งค่าใหม่สดๆ เองผ่าน `approveNcr` ปกติ) — ทดสอบยืนยันแล้วว่า state
  machine เดินต่อได้ปกติหลัง resubmit (SR-13)

**Routes (`routes/ncr.js`):** `POST /:id/reject-to-staff` (role ตรวจใน service ตาม status ปัจจุบัน) ·
`PATCH /:id/staff-revision` (แก้ items) · `POST /:id/resubmit-staff-revision` (ทั้งคู่ gate `qc_staff`/`qc_supervisor`)

**`lib/overdueNotifier.js`:** เพิ่ม `pending_staff_revision` เข้า exclusion list (`status NOT IN (...)`) — เอกสาร
อยู่กับ QC รับเข้า ไม่ใช่ค้างที่จัดซื้อ/ผู้อนุมัติ ไม่ควรถูกนับเกินกำหนดแจ้งจัดซื้อผิดที่ (ตรวจแล้ว: `internalReminder.js`
ใช้ whitelist ของตัวเองอยู่แล้ว ไม่รวม status นี้โดยธรรมชาติ ไม่ต้องแก้)

**Frontend (`NCR/Detail.jsx`):**
- ปุ่ม "ส่งกลับแก้ไข (QC รับเข้า)" + modal (เหตุผลบังคับกรอก) — โชว์ตาม `STAFF_REJECT_ROLES[ncr.status] ===
  user?.role` (mirror ฝั่ง server) ปรากฏที่ทุกขั้นที่เกี่ยวข้องอัตโนมัติ ไม่ต้องเขียนซ้ำ 5 จุด
- Banner แดงตอน `pending_staff_revision` (pattern เดียวกับ banner เดิมของ `pending_supplier_resubmit`) ดึงจาก
  `ncr.approvals` action='rejected_to_staff' ล่าสุด
- การ์ด "แก้ไขข้อมูล item" (เฉพาะ `qc_staff`/`qc_supervisor` ตอนสถานะนี้) — ฟอร์มแก้ไขต่อ item (จำนวน 3 ช่อง +
  dropdown กลุ่มปัญหา + textarea รายละเอียด) + อัปโหลด/ลบรูปภาพ (เรียก endpoint เดิม) + ปุ่ม "ส่งกลับเข้าระบบ"
- เพิ่ม label `pending_staff_revision` ใน `rolePermissions.js`'s `STATUS_LABELS` + `exports.js`'s `statusLabel()`
  (ให้ Badge/PDF export แสดงผลถูกต้อง ไม่ fallback เป็น raw status string)

**Known limitation (ไม่ใช่ bug แต่ไม่ได้ทำรอบนี้):** dashboard/report บาง endpoint (เช่น purchasing dashboard
summary) อาจไม่แสดง `pending_staff_revision` เป็น bucket แยกต่างหาก (ยังคงถูกนับรวมใน query ทั่วไปที่กรองแค่
`status NOT IN (closed,...)` แต่ไม่มี label เฉพาะในกราฟสรุป) — ไม่กระทบ core flow ที่ทำรอบนี้ รอ user ตัดสินใจ
ว่าต้องการ breakdown แยกไหมถ้าเจอปัญหาจริง

**Test:** เพิ่ม **GROUP F (SR-01 ถึง SR-13)** ใน `test/ncrUai.test.js` ครอบ: reject ไม่ใส่เหตุผล (400),
permission role ผิด (403) ทั้งฝั่ง reject/edit/resubmit, บันทึกเหตุผลลง `ncr_approvals` ถูกต้อง, แก้ไขข้อมูล
item จริง, resubmit กลับ `pending_supervisor` + เคลียร์ disposition/qmr_opened_at เมื่อ reject มาจากขั้นลึก
(ทดสอบเคสจริงจาก `pending_purchasing_manager_review` ที่ผ่าน disposition มาแล้ว), และยืนยัน state machine เดิน
ต่อได้ปกติหลัง resubmit — `npm run build` (client) ผ่าน, `node --test` (server) → **407/407 เขียว**

### Files Changed

| File | สิ่งที่ทำ |
|---|---|
| `server/db/database.js` | เพิ่ม `'pending_staff_revision'` ใน `VALID_NCR_STATUSES` |
| `server/services/ncrService.js` | เพิ่ม `STAFF_REJECT_ROLES`, `rejectToStaff()`, `updateNcrItemsAsStaff()`, `resubmitAfterStaffRevision()` |
| `server/routes/ncr.js` | เพิ่ม 3 routes: reject-to-staff, staff-revision (PATCH), resubmit-staff-revision |
| `server/lib/overdueNotifier.js` | เพิ่ม `pending_staff_revision` เข้า exclusion list |
| `server/routes/exports.js` | เพิ่ม label ใน `statusLabel()` |
| `client/src/utils/rolePermissions.js` | เพิ่ม `pending_staff_revision` ใน `STATUS_LABELS` |
| `client/src/pages/NCR/Detail.jsx` | ปุ่ม+modal ส่งกลับ, banner, การ์ดแก้ไขข้อมูล item + รูปภาพ, mutations ที่เกี่ยวข้อง |
| `server/test/ncrUai.test.js` | เพิ่ม GROUP F (SR-01–13) |

---

## 2026-07-23 | Session 160 — Bills: เพิ่มหมายเหตุตอน qc_supervisor "ส่งกลับ" บิล ให้ qc_staff เห็นสาเหตุ+แก้ไข

**คำขอ:** user ส่งภาพหน้าจอ dialog "ส่งกลับ" ของ qc_supervisor (ยืนยันอย่างเดียว ไม่มีช่องกรอกเหตุผล) — ขอให้
เพิ่มหมายเหตุตอนส่งกลับ ให้ qc_staff ผู้รับเข้าเห็นว่าต้องแก้อะไร

**พบว่า backend รองรับ `comment` อยู่แล้วบางส่วน:** `POST /bills/:id/reject` เดิมรับ `comment` จาก body และใส่ใน
ข้อความ notification (`createNotification`) กับ `audit_logs.new_value` อยู่แล้ว — **แต่ frontend ไม่เคยส่ง
`comment` เลย** (ไม่มี input ให้กรอก, `reject.mutate()` เรียกเปล่าๆ) และต่อให้ส่งมา ก็ไม่เคย persist ไว้ที่ตัวบิล
เอง (อยู่แค่ในข้อความ notification ที่หายไปหลังอ่าน + audit log ที่ user ทั่วไปเข้าไม่ถึง) — พอ qc_staff เปิดบิล
กลับมาแก้ภายหลัง (ไม่ได้เห็น notification ตอนนั้นพอดี) จะไม่มีทางรู้เหตุผลเลยนอกจากไปถามปากเปล่า

**การแก้:**
- Schema: เพิ่มคอลัมน์ `bills.reject_comment TEXT` (schema.sql + `safeAddColumn` migration ใน database.js)
- `POST /bills/:id/reject`: persist `comment` ลง `reject_comment` ในการ UPDATE เดียวกับที่เปลี่ยน status (ยังอยู่
  ใน optimistic-lock query เดิม ไม่เพิ่ม query แยก)
- `billService.submitBill()`: เคลียร์ `reject_comment` กลับเป็น `NULL` ตอน qc_staff กด "ส่งอนุมัติ" ใหม่ (ถือว่า
  แก้ตามที่แจ้งแล้ว กันโน้ตเก่าค้างข้ามรอบ reject ถัดไป)
- `Bills/Detail.jsx`: เปลี่ยน dialog "ส่งกลับ" จาก `ConfirmDialog` ธรรมดา (ยืนยันอย่างเดียว) เป็น `Modal` กำหนดเอง
  + `<textarea>` หมายเหตุ (ไม่บังคับ) — pattern เดียวกับที่ `NCR/Detail.jsx` ใช้อยู่แล้วสำหรับ reject-with-reason
  (`.input`/`.label` class จริงที่มี CSS นิยามอยู่ — ต่างจาก `.input-field` ที่เจอว่าเป็น class ผีไม่มี CSS จริง
  ตอนแก้ audit log filter bar ก่อนหน้านี้)
- เพิ่ม banner แดงแสดง `reject_comment` ค้างไว้ทั้งที่ `Bills/Detail.jsx` (ตอน `status==='draft'`) และ
  `Bills/New.jsx` (`?edit=id`, หน้าที่ qc_staff ใช้แก้ไขจริง) — โชว์จนกว่าจะ submit ใหม่ (ตาม logic เคลียร์ด้านบน)

**Test:** เพิ่ม **BILL-11b** ใน `test/bills.test.js` — ยืนยัน `reject_comment` ถูกบันทึกหลัง reject และถูกเคลียร์
กลับเป็น `null` หลัง resubmit — `npm run build` (client) ผ่าน, `node --test` (server) → **394/394 เขียว**

### Files Changed

| File | สิ่งที่ทำ |
|---|---|
| `server/db/schema.sql` | เพิ่ม `bills.reject_comment TEXT` |
| `server/db/database.js` | `safeAddColumn('bills', 'reject_comment', 'TEXT')` ใน `runMigrations()` |
| `server/routes/bills.js` | `POST /:id/reject` persist `comment` ลง `reject_comment` |
| `server/services/billService.js` | `submitBill()` เคลียร์ `reject_comment` เป็น NULL ตอน resubmit |
| `client/src/pages/Bills/Detail.jsx` | dialog ส่งกลับมี textarea หมายเหตุ + banner แดงแสดง `reject_comment` |
| `client/src/pages/Bills/New.jsx` | banner แดงแสดง `reject_comment` ในหน้าแก้ไข (`?edit=id`) |
| `server/test/bills.test.js` | เพิ่ม BILL-11b |

---

## 2026-07-22 | Session 159 — Bug: รายงานสรุปการรับเข้าวันนี้ (PDF/JPEG/Excel) รายการ "ไม่ผ่าน" ที่ยังไม่มี NCR/NCP ช่องเอกสารว่างเป็น "-" ทั้งที่มีสาเหตุของเสียบันทึกไว้แล้ว

**คำขอ:** user ส่งภาพหน้าจอ export "สรุปรับเข้าวันนี้" (ปุ่มบนหน้า qc_staff สถานีรับเข้า) — รายการที่ขึ้น
"ไม่ผ่าน" หลายแถวช่อง "เอกสาร NCR/NCP" ว่างเปล่าเป็น "-" ทั้ง PDF และ JPEG ถามว่าทำไมไม่มีทั้งข้อมูลสาเหตุของเสีย
และเลขที่เอกสาร NCR/NCP

**Root cause:** `server/routes/exports.js`'s `buildDailyReportData()` (ใช้ร่วมทั้ง 3 format: PDF/JPG ผ่าน
`receivingTablePieces()` + Excel) query `bill_items` โดย**ไม่เคย SELECT `defect_category_id`/`defect_detail`
เลย** ทั้งที่ 2 field นี้มีอยู่แล้วบน `bill_items` ตั้งแต่ตอน QC บันทึกของเสียตอนรับเข้า (ก่อนจะมีใครออกเอกสาร
NCR/NCP จริงๆ อีกที — คนละขั้นตอนกัน เหมือนที่ `Bills/Detail.jsx` แสดง "กลุ่มปัญหา/รายละเอียด" อยู่แล้วโดยไม่ต้อง
รอ NCR) ช่อง "เอกสาร NCR/NCP" เดิมจึงสร้างจาก `row.ncr_docs` (ผูกกับ `ncr_items`) **เท่านั้น** — ถ้ายังไม่มีใคร
ออกเอกสาร NCR/NCP ให้ item นั้น (ขั้นตอนที่ทำทีหลัง ไม่ได้ทำพร้อมกับตอนรับเข้าเสมอไป) `ncr_docs` จะว่าง แล้ว
fallback ไปที่ "-" ทันที ทั้งที่ระบบมีข้อมูล "ทำไมถึงไม่ผ่าน" อยู่แล้วในมือ

**การแก้:** เพิ่ม `dc.name as defect_category_name, bi.defect_detail` เข้า SELECT ของ `buildDailyReportData()`
(join `defect_categories`) + เพิ่ม helper `rawDefectCauseText(row)` + แก้ทั้ง `receivingTablePieces()` (ใช้ร่วม
PDF/JPG) และ Excel export: ถ้า `row.ncr_docs.length > 0` แสดงโค้ด NCR/NCP + สาเหตุเหมือนเดิม; ถ้าไม่มีเอกสารแต่
`qty_failed > 0` (fail จากของเสียดิบ) แสดงสาเหตุของเสีย (`defect_category_name — defect_detail`) พร้อม label
"(รอออกเอกสาร)" กำกับให้ชัดว่าเป็นสาเหตุเบื้องต้น ไม่ใช่เลขเอกสารจริง; ถ้าผ่านปกติยังแสดง "-" เหมือนเดิม —
ไม่แตะ `rowVerdict()` (ตรรกะ fail/conditional/pass เดิมถูกต้องอยู่แล้ว ไม่ใช่ต้นตอปัญหา)

**Test:** เพิ่ม fixture bill+item (received_date คงที่ผ่าน `?date=` กัน flaky) + **REP-11** ใน
`test/reports.test.js` ยืนยันว่า item ที่ `qty_failed>0` ไม่มี NCR ผูกอยู่ แต่มี `defect_category_id`/
`defect_detail` → Excel export column "เอกสาร NCR/NCP" มีทั้งชื่อกลุ่มปัญหา รายละเอียด และ "(รอออกเอกสาร)" —
fixture สร้างสดในเทสเอง (ไม่ใช่ module-level) เพราะ REP-02/03/04 นับ `bill_items` ทั้ง DB แบบ global ถ้าเพิ่ม
fixture ไว้ตั้งแต่ต้นไฟล์จะไปเปลี่ยนตัวเลขที่เทสก่อนหน้าคาดหวังไว้ (เจอจริงตอนรันเทสรอบแรก แก้แล้ว) —
`node --test` → **393/393 เขียว**

### Files Changed

| File | สิ่งที่ทำ |
|---|---|
| `server/routes/exports.js` | `buildDailyReportData()` เพิ่ม SELECT defect_category_name/defect_detail; เพิ่ม `rawDefectCauseText()`; `receivingTablePieces()` + Excel export แสดงสาเหตุของเสียดิบ+"(รอออกเอกสาร)" แทน "-" เมื่อ fail แต่ยังไม่มี NCR/NCP |
| `server/test/reports.test.js` | เพิ่ม REP-11 (คลุม fix นี้โดยเฉพาะ) |

---

## 2026-07-22 | Session 158 — Bug: ลิงก์ NCR/NCP บนหน้า Bills/Detail.jsx เห็นเฉพาะ qc_staff/qc_supervisor — role อื่นไม่เห็นแม้ item มี NCR อยู่แล้ว

**คำขอ:** user ส่งภาพหน้าจอบิลที่มีรายการออกเอกสาร NCP-2026-0001 แล้ว (มี badge ลิงก์คลิกไปเอกสารได้) — รายงาน
ว่า role อื่นนอกจาก qc_staff (สถานีรับเข้า) เปิดหน้าเดียวกันแล้ว **ไม่เห็น badge นี้เลย** ทั้งที่ item มี NCR
ผูกอยู่จริง ขอให้ทุก role เห็นเหมือนกับที่ qc_staff เห็น

**Root cause:** `client/src/pages/Bills/Detail.jsx` เดิม (บรรทัด ~153) ห่อทั้ง 2 กรณี (badge ลิงก์เอกสารที่มีอยู่
แล้ว **และ** ปุ่ม "ออกเอกสาร NCR/NCP" สำหรับสร้างใหม่) ไว้ใน condition เดียวกัน:
`['qc_staff','qc_supervisor'].includes(user?.role) && bill.status==='approved'` — ทำให้ role อื่นทั้งหมด
(qc_manager, qmr, purchasing, cco/cmo/cpo, production_manager ฯลฯ) ไม่เห็นทั้ง badge และปุ่มเลย แม้จะมีสิทธิ์
เปิดดูหน้า Bill Detail นี้อยู่แล้ว (`GET /api/bills/:id` ฝั่ง server มีแค่ `auth` ไม่มี `requireRole` เจาะจง —
ยืนยันว่า `item.in_ncr` ถูกส่งมาให้ทุก role ที่ authenticated แล้วอยู่แล้วจากเดิม ไม่ใช่ backend filter) — ตรง
กับกฎ CLAUDE.md §15 "ห้าม hardcode role ใน component" ที่เจตนาป้องกันบั๊กแบบนี้ไว้อยู่แล้วแต่หลุดมาจุดนี้

**การแก้:** แยก 2 กรณีออกจากกัน — badge ลิงก์เอกสารที่มีอยู่แล้ว (`item.in_ncr` truthy) แสดงให้**ทุก role**
เห็นเสมอ (readonly, ไม่ต้อง gate เพราะแค่ลิงก์ไปเอกสารที่มีอยู่จริง) ส่วนปุ่ม "ออกเอกสาร NCR/NCP" (สร้างใหม่)
ยัง gate ด้วย role เดิม (`qc_staff`/`qc_supervisor` เท่านั้น) ตรงตาม CLAUDE.md §11 role matrix ("เปิด NCR/NCP"
เป็นสิทธิ์เฉพาะ 2 role นี้) — ไม่กระทบสิทธิ์การสร้างเอกสารเลย แก้แค่การมองเห็นลิงก์ readonly

**Test:** `npm run build` (client) ผ่านสำเร็จ

### Files Changed

| File | สิ่งที่ทำ |
|---|---|
| `client/src/pages/Bills/Detail.jsx` | แยก badge ลิงก์ NCR/NCP ที่มีอยู่แล้วออกจาก role gate (แสดงทุก role) ส่วนปุ่มสร้างใหม่ยัง gate `qc_staff`/`qc_supervisor` เหมือนเดิม |

---

## 2026-07-22 | Session 157 — Admin/AuditLogs.jsx: filter ผู้ใช้ (dropdown) + redesign มุมมอง desktop เป็น log stream แบบ Render

**คำขอ:** user เห็นหน้า Application Logs ของ Render (log stream เรียบๆ, ขึ้นตามเวลา, มี tag สี, กรุ๊ปตามวัน)
แล้วขอให้ปรับหน้า "Log การใช้งาน" (`Admin/AuditLogs.jsx`) ให้ดูคล้ายแบบนั้น + เพิ่ม dropdown กรองแยกตาม
ผู้ใช้แต่ละคน — ระบุชัดว่า **มือถือ/iPad ให้คงดีไซน์เดิม (card list) ไว้ ปรับแค่ desktop** แต่ทั้งสอง breakpoint
ต้องมี filter ผู้ใช้เพิ่มเข้ามา

**การทำ:**
- Backend (`server/index.js`'s `GET /api/admin/audit-logs`): เพิ่ม query param `user` (match ตรงกับ
  `u.username`) + เพิ่ม `users` ใน response (`SELECT DISTINCT u.username, u.full_name FROM audit_logs al
  JOIN users u ...`) สำหรับ populate dropdown — ตาม pattern เดิมที่มีอยู่แล้วสำหรับ `actions`/`tables`
- Frontend `FilterBar`: เพิ่ม select "ผู้ใช้" (เดิมมีแค่ text search `q` ที่ค้นด้วย LIKE) — เพราะ `FilterBar`
  เป็น component เดียวใช้ร่วมกันทั้ง desktop (แสดงตลอด) และ mobile (toggle ผ่านปุ่ม "ตัวกรอง") อยู่แล้ว
  การเพิ่ม field ใหม่จุดเดียวจึงได้ทั้ง 2 breakpoint พร้อมกันโดยไม่ต้องแก้ mobile เลย
- Desktop เดิมเป็น `.table`/`.table-container` (บรรทัดสูง มีเส้นแบ่งคอลัมน์ชัด ตามดีไซน์ §26) — เปลี่ยนเป็น
  panel เดียว (`bg-surface border rounded-xl`) ที่แต่ละแถวเป็น flex-row บรรทัดเดียว (เวลา → ActionBadge →
  ผู้ใช้ → หมวด/ID → IP → chevron ขยาย) คั่นด้วย `border-t` บางๆ + กรุ๊ปหัวข้อวันที่ (คำนวณจาก `fmtDate` ของ
  แถวก่อนหน้าเทียบกับแถวปัจจุบัน, แถวเรียง DESC จาก backend อยู่แล้วจึงกรุ๊ปแบบ consecutive ได้เลยไม่ต้อง sort
  ใหม่) ใกล้เคียงความหนาแน่นของ log viewer ที่ user อ้างอิง — คงพฤติกรรมคลิกขยายดู before/after JSON เดิมไว้ทั้งหมด
  (state/logic `expanded`/`toggleExpand`/`JsonDetail` ไม่แตะเลย)
- **Mobile card block (`md:hidden`) ไม่แตะแม้บรรทัดเดียว** ตามที่ user ระบุชัดว่าให้คงเดิม

**Test:** `npm run build` (client) ผ่านสำเร็จ (มีแค่ pre-existing chunk-size warning เดิมไม่เกี่ยวกับรอบนี้) +
`node -c index.js` (server) ผ่าน syntax check — ไม่มี unit test อัตโนมัติคลุมหน้า UI นี้โดยเฉพาะ (เป็น
frontend page, pattern เดิมของโปรเจกต์ก็ไม่มี component test ให้หน้า admin listing ทั่วไปอยู่แล้ว)

**รอบที่ 2 (bug หลัง deploy):** user ส่งภาพหน้าจอ dropdown "ผู้ใช้" ทับซ้อนกับ "ประเภท Action" ไม่สวย — root
cause เป็น CSS Grid ปกติ: grid item มี `min-width: auto` โดย default ทำให้ `<select>` ที่มีข้อความยาว (เช่น
"ผู้ดูแลระบบ (admin)") ปฏิเสธไม่ยอมหดเหลือความกว้างของ track (1fr) แล้วล้นทับคอลัมน์ถัดไป — select อื่น
(action/table) ไม่เคยเจอปัญหานี้มาก่อนเพราะ option label สั้น (เช่น "ทั้งหมด") ไม่เคยยาวพอจะ trigger ให้เห็น
บั๊กที่แฝงอยู่แล้ว — แก้ด้วย `min-w-0` บน grid item div ทุกตัวใน `FilterBar` (defensive กันเผื่อ label อื่นยาว
ขึ้นในอนาคตด้วย ไม่ใช่แค่ตัว user) + `w-full min-w-0` บน `<select>`/`<input>` เอง — `npm run build` ผ่านซ้ำ

**รอบที่ 3 (ยังไม่หายสนิท):** user รายงานช่องค้นหา (search) ยังเกินอยู่ — ตรวจพบว่า `.input-field` **ไม่มี
นิยาม CSS จริงเลยในระบบ** (grep ทั้ง repo ไม่เจอ `.input-field {` ที่ไหน — เป็น class เปล่าที่ไม่ทำอะไร ต้องพึ่ง
utility class อื่นที่ผูกมาด้วยเสมอ) และ `<input>` ของช่องค้นหา (ต่างจาก `from`/`to` ที่มี `w-full` เดิมอยู่แล้ว)
ไม่เคยมี `w-full` เลยตั้งแต่แรก ประกอบกับ wrapper เดิมใช้ `sm:col-span-2 lg:col-span-1` (กว้าง 2 คอลัมน์ตอน
`sm`, แคบเหลือ 1 คอลัมน์ตอน `lg`) เป็นความไม่สมมาตรที่เสี่ยงพังที่รอยต่อ breakpoint — แก้โดยเปลี่ยนเป็น
`sm:col-span-2 lg:col-span-2` (กว้าง 2 คอลัมน์เสมอทั้ง 2 breakpoint, ไม่สลับขนาด) + เพิ่ม grid รวมจาก
`lg:grid-cols-6` เป็น `lg:grid-cols-7` (2 ของ search + 5 ฟิลด์เดี่ยว = 7 พอดี) + เพิ่ม `w-full min-w-0` ให้
input ค้นหาด้วย — **verify จริงด้วย Puppeteer screenshot** (ไม่ใช่แค่เดา) โดยสร้างหน้า static HTML จำลอง
markup+class เดียวกับ `FilterBar` จริง โหลด CSS ที่ build แล้วจริง แล้ว screenshot ที่ 900px/1023px/1024px/
1600px (คร่อมรอยต่อ `lg` breakpoint 1024px พอดี) — ไม่มี overlap ที่ความกว้างไหนเลย ทั้ง 2-column wrap
(sm) และ 7-column แถวเดียว (lg) — เลือกวิธีนี้แทนการ login เข้า dev server จริงเพราะ port 3001 มี process
เดิมที่ user ใช้งานจริงอยู่ (มี active connection จาก LAN) ไม่ต้องการรบกวน/เสี่ยง rate-limit login ของบัญชีจริง

### Files Changed

| File | สิ่งที่ทำ |
|---|---|
| `server/index.js` | `GET /api/admin/audit-logs`: เพิ่ม `user` filter param + `users` distinct list ใน response |
| `client/src/pages/Admin/AuditLogs.jsx` | เพิ่ม state/filter `user` ทั้งหน้า + dropdown "ผู้ใช้" ใน `FilterBar`; เปลี่ยนมุมมอง desktop จาก `.table` เป็น log-stream panel กรุ๊ปตามวัน; มุมมอง mobile ไม่เปลี่ยน |

---

## 2026-07-22 | Session 156 — Render Bandwidth Audit รอบ 3: `upload-sync-state.json` เขียนไม่ได้จริงบน production (EACCES) — root cause ตัวจริงของ Service-Initiated bandwidth

**คำขอ:** user รายงาน Render bandwidth วันนี้ 250MB ทั้งที่ DB มีแค่ ~3MB และ R2 storage (`qms-backups` bucket)
รวม 84MB (231 objects) — ต่อยอดจากรายงาน audit ระบบ backup/restore เต็มรูปแบบที่ทำไปก่อนหน้า (12 หัวข้อตามคำขอ
เดิม: ไฟล์ที่เกี่ยวข้อง, ลำดับ backup, ขนาดข้อมูล, ประเภท backup, bandwidth ประเมิน ฯลฯ — สรุปว่าไม่มี ZIP,
DB ใช้ hash-dedup, uploads ใช้ incremental sync ถูกต้องตามทฤษฎี)

**การวิเคราะห์ (ทำเป็นขั้น ไม่เดา — ยืนยันด้วยหลักฐานจาก Render dashboard จริงที่ user ส่งมาทีละรอบ):**
1. รอบแรกตั้งสมมติฐานจาก `DEPLOYMENT.md:177-179` (เอกสารเดิมของโปรเจกต์เอง) ว่า Render Free tier
   sleep/wake หลัง idle 15 นาที + OOM-kill จาก Chromium ตอน export PDF อาจเป็นสาเหตุ (เกิดบ่อยกว่า redeploy
   มาก) — เสนอ 3 ทางเลือกให้ user (keep-alive ping / ลด PDF concurrency / thumbnail รูป)
2. user แจ้งว่าใช้ UptimeRobot ยิงทุก 12 นาทีอยู่แล้ว (ตัด idle-sleep ออกจากสาเหตุหลักได้) + ให้ข้อมูลใหม่จาก
   Render dashboard: **HTTP Responses = 50MB, Service-Initiated = 200MB** — ยืนยันว่าปัญหาไม่ได้มาจาก
   traffic ผู้ใช้จริง (ดูรูป/หน้าเว็บ) แต่มาจาก server เรียกออกไปหา R2 เอง ตัด "thumbnail รูป" ออกจาก
   priority ทันที (แก้จุดที่ bandwidth ต่ำอยู่แล้วไม่ช่วยอะไร)
3. คำนวณย้อนกลับ: ถ้า 200MB มาจาก DB restore+re-upload ต่อรอบ restart (~6MB/รอบ) อย่างเดียว ต้องมี
   restart ~30+ ครั้ง/วัน — สูงเกินกว่า "OOM ตอน export เป็นครั้งคราว" จะอธิบายได้ครบ → ขอให้ user เช็ค
   Render Events/Logs tab จริงเพื่อยืนยันแทนเดาต่อ
4. user ส่งภาพ Application logs จริง (Last 24 hours) — พบ **`[backupService] เขียน upload-sync-state.json
   ไม่ได้: EACCES: permission denied, open '/app/upload-sync-state.json'`** ซ้ำต่อเนื่องตลอดทั้งวัน (ทั้ง
   burst ช่วงเช้าจาก `markLocalFileSynced()` ที่เรียกจาก lazy fetch-through ใน `index.js:115` และเป็นชุดที่
   ห่างกัน ~2 ชม. ตรงกับรอบ scheduler ปกติของ `runFullCycle()`)

**Root cause ที่แท้จริง (ยืนยันด้วย log จริง + `Dockerfile`):** `backupService.js`'s `SYNC_STATE_PATH` เดิม
คำนวณจาก `path.join(UPLOADS_BASE, '..', 'upload-sync-state.json')` = `/app/upload-sync-state.json` บน
production แต่ `Dockerfile:58-59` (`RUN mkdir -p /app/uploads /data && chown -R node:node /app/uploads
/data`) ให้สิทธิ์เขียนแก่ user `node` **เฉพาะ `/app/uploads` กับ `/data` เท่านั้น** — ไม่ใช่ `/app` เอง —
ทำให้เขียนไฟล์นี้ล้มเหลวด้วย `EACCES` มาตลอดตั้งแต่ feature นี้ถูกสร้าง (`saveSyncState()` catch error
เงียบ ไม่ throw, `backupService.js:186-188`) ผลคือ `loadSyncState()` คืน `{}` เสมอ (ไม่เคย persist จริง) →
`syncUploads()` มองทุกไฟล์ใน `uploads/` เป็น "ใหม่" ทุกครั้ง → **อัปโหลดทั้งโฟลเดอร์ uploads/ (~84MB) ซ้ำทั้งหมด
ทุกรอบ scheduler (~2 ชม./ครั้ง)** แทนที่จะเป็น incremental จริงตามที่ตั้งใจออกแบบไว้ — อธิบายตัวเลข
Service-Initiated 200MB ได้พอดี (84MB × 2-3 รอบ active วันนี้) และอธิบายด้วยว่าทำไม fix ของ Session 150
(`markLocalFileSynced()` กันอัปโหลดซ้ำหลัง lazy-fetch) ถึงไม่ได้ผลจริงบน production — เพราะมันก็เรียก
`saveSyncState()` ตัวเดียวกันที่พังด้วย EACCES เหมือนกัน ทั้งที่ logic ถูกต้องทุกจุด พังแค่เพราะเขียนไฟล์ผิดที่

**การแก้:** ย้าย `SYNC_STATE_PATH` ไปที่ `path.join(path.dirname(DB_PATH), 'upload-sync-state.json')` —
โฟลเดอร์เดียวกับ DB (`IQC_DB_PATH=/data/iqc.db` ใน `Dockerfile:38`, พิสูจน์แล้วว่าเขียนได้จริงเพราะ `/data`
ถูก chown ให้ user `node` ด้วย) แทนที่จะอยู่นอก `uploads/` ขึ้นไป 1 level แบบเดิม — ไม่ต้องแก้
`walkFiles()`/`syncUploads()` เลย (ไฟล์ state ไม่ถูกเดินเจอเพราะอยู่คนละโฟลเดอร์กับ `uploads/` อยู่แล้ว) และ
behavior บน local dev ไม่เปลี่ยน (path เดิมเขียนได้อยู่แล้วเพราะไม่มีข้อจำกัด permission แบบ Docker)

**Test:** อัปเดต `REAL_SYNC_STATE_PATH` ใน `backupService.test.js` ให้ตรงสูตรใหม่ (เดิมอ้างอิง `UPLOADS_BASE`
เหมือน production code เก่า ถ้าไม่แก้เทสจะ false-pass เพราะยัง compute path แบบเดิม) + เพิ่ม **BACKUP-18**
(assert ว่า sync-state path ต้องอยู่นอก `UPLOADS_BASE` เสมอ — กัน regression กลับไปจุดเดิม) และ **BACKUP-19**
(`markLocalFileSynced` เขียน/อ่านได้จริงที่โฟลเดอร์เดียวกับ DB แม้ `IQC_DB_PATH` อยู่คนละที่กับ `uploads/`) —
`node --test` → **392/392 เขียว** (388 baseline + 4 เคสใหม่ นับรวม BACKUP-16/17 เดิมที่ยังผ่านหลังแก้สูตร path)

**Verify:** ยังไม่ได้ verify กับ Render bandwidth จริง (ต้อง deploy ก่อน) — แนะนำ deploy แล้วดู Application
logs ว่า error `EACCES ... upload-sync-state.json` หายไป + ติดตาม Service-Initiated bandwidth บน Render
dashboard 24-48 ชม. เทียบ baseline 200MB/วันที่เจอวันนี้ ควรลดลงมากเพราะ `syncUploads()` จะกลับมา
incremental จริง (อัปโหลดเฉพาะไฟล์ใหม่/เปลี่ยนต่อรอบ ไม่ใช่ทั้งโฟลเดอร์)

### Files Changed

| File | สิ่งที่ทำ |
|---|---|
| `server/lib/backupService.js` | `SYNC_STATE_PATH`: `path.join(UPLOADS_BASE, '..', ...)` (เขียนไม่ได้บน production) → `path.join(path.dirname(DB_PATH), ...)` (เขียนได้จริง, โฟลเดอร์เดียวกับ DB) |
| `server/test/backupService.test.js` | `REAL_SYNC_STATE_PATH` แก้สูตรให้ตรงโค้ดจริง + เพิ่ม BACKUP-18/19 (regression: path ต้องอยู่นอก uploads/, เขียน/อ่านได้จริงข้ามโฟลเดอร์) |

---

## 2026-07-22 | Session 155 — Products Excel import error 332 แถว: แก้ root cause (comma delimiter) + ปุ่มลบสินค้าเก่า

**คำขอ:** user ส่งภาพหน้าจอ Import สินค้าจาก Excel แสดง error 332/2029 แถว (export แล้ว import กลับเข้าไปทันที) —
ขอให้เพิ่มปุ่มลบสินค้าแถวนั้นออกจาก database เลย ถ้าประเมินว่าไม่ได้ใช้งานแล้ว เพราะถ้าไม่เคลียร์ระบบจะ
export→import ไม่ได้เพราะติด error เรื่อยๆ

**Root cause (ตรวจจากโค้ด+DB จริง ก่อนเชื่อสมมติฐาน "สินค้าเก่า" ของ user):** ข้อความ error ตัวอย่างในภาพ
("ไม่พบ Supplier 'JINAN FENSTEK INTERNATIONAL TRADE CO.' / ไม่พบ Supplier 'LTD'") ชี้ว่าเป็นปัญหาการ split ชื่อ
ผิด — เช็ค `server/routes/master.js` พบว่า `products/export`'s Supplier column ใช้ **comma** คั่นระหว่าง
Supplier หลายรายต่อ 1 สินค้า (`.join(', ')`) และ `products/import` ก็ split ด้วย comma เดียวกัน
(`supplierCell.split(',')`) — เช็ค DB จริง (`iqc.db`) พบ **Supplier 13 รายมี comma อยู่ในชื่อตัวเองจริง**
(เช่น `"JINAN FENSTEK INTERNATIONAL TRADE CO.,LTD"` ตรงกับตัวอย่างในภาพเป๊ะ) export ออกมาแล้วดูเหมือนมี 2
Supplier คั่น comma ทั้งที่จริงเป็นชื่อเดียว พอ import กลับมาเลย split ผิดเป็น 2 ชื่อที่หาไม่เจอทั้งคู่ — query
นับสินค้าที่ผูกกับ Supplier กลุ่มนี้ได้ **202 จาก 2,042 รายการ** (~61% ของ error ที่รายงานมา) ยืนยันว่า error
ส่วนใหญ่เป็น **สินค้าที่ยังใช้งานจริง ติด bug** ไม่ใช่ของเก่าเลิกใช้ตามที่ user สันนิษฐาน — ถ้าเพิ่มปุ่มลบแล้วกด
ลบตาม error list ทันทีมีความเสี่ยงสูงที่จะลบสินค้าที่ยังขายอยู่จริงไปโดยไม่ตั้งใจ

**ถามยืนยันแนวทางกับ user ก่อนทำ (AskUserQuestion):** เสนอ 2 ทาง (1) แก้ root cause ก่อนค่อยเพิ่มปุ่มลบสำหรับที่
เหลือจริง (2) เพิ่มปุ่มลบตามที่ขอเลยไม่ต้องแก้ root cause — **user เลือกทางที่ 1**

**การแก้ (2 ส่วน, `server/routes/master.js` เป็นหลัก):**

**(1) Root cause — เปลี่ยนตัวคั่น Supplier จาก `,` เป็น `;`:**
- Export: header column เปลี่ยนเป็น `'ชื่อ Supplier * (คั่นด้วย ; ถ้ามากกว่า 1)'`, join เปลี่ยนเป็น `.join('; ')`
  + เพิ่ม `WHERE p.is_active = 1` ในคิวรีสินค้าที่ export (เดิมส่งออกสินค้าปิดใช้งานด้วย — ถ้าไม่กรอง สินค้าที่ถูก
  ปิดใช้งาน/ลบผ่านฟีเจอร์ใหม่ข้อ (2) จะยังโผล่ใน export รอบถัดไปแล้ว error ซ้ำเดิมไม่จบสักที)
- Import: `checkHeaders` เปลี่ยน header string ที่ต้องตรง, `supplierCell.split(';')` แทน `split(',')`, ข้อความ
  dropdown validation error ปรับตาม — ยืนยันว่าไม่มี Supplier รายไหนใช้ `;` ในชื่อจริงเลย (เช็ค DB แล้ว)
- ไฟล์เก่าที่ export ด้วย header แบบ comma (ก่อน fix นี้) จะโดน **header-mismatch error ชัดเจน** ("Header ไม่ตรง
  กับ template") แทนที่จะ silently misparse เหมือนเดิม — **ต้อง export ใหม่เท่านั้น ไฟล์เก่าใช้ต่อไม่ได้**
- ย้าย logic resolve `existing` product (match by code/name) ให้ทำงาน**ก่อน**เช็ค error เสมอ (เดิมทำแค่ตอนไม่
  error) เพื่อให้แถว error ที่ตรงกับสินค้าเดิมในระบบมี `_data.id` ให้ frontend ใช้ต่อได้ในข้อ (2)

**(2) ปุ่ม "ลบสินค้านี้ออกจากระบบ" (สำหรับสินค้าที่เหลือจริงๆ หลังแก้ root cause แล้ว):**
- `DELETE /api/master/products/:id` (ใหม่) — พยายามลบถาวรในทรานแซกชันก่อนเสมอ (`product_suppliers` มี
  `ON DELETE CASCADE` ลบเองอัตโนมัติ) ถ้ามีแถวลูกที่เป็น `ON DELETE RESTRICT` ผูกอยู่จริง (bill_items/
  delivery_schedule_items/product_images/product_drawings/product_colors) SQLite จะ throw FK constraint
  error เอง — **ไม่ต้องเช็คทีละตารางเอง** ปล่อยให้ FK enforcement (CLAUDE.md §2.5: ห้าม DELETE master data ที่มี
  FK ชี้อยู่) เป็นตัวตัดสิน แล้ว catch มา fallback เป็น soft-delete (`is_active=0`) อัตโนมัติพร้อมข้อความอธิบาย
  ชัดเจนว่าทำไมลบถาวรไม่ได้ — audit log ทั้ง 2 กรณี (DELETE/UPDATE)
- `client/src/pages/Master/Products.jsx` — แถว error ในหน้า preview import ที่มี `_data.id` (ตรงกับสินค้าเดิม
  ในระบบ) มีปุ่ม "ลบสินค้านี้ออกจากระบบ" ยืนยันผ่าน `ConfirmDialog` แล้วเรียก DELETE เปลี่ยนสถานะแถวนั้นเป็น
  "✓ ลบออกจากระบบแล้ว" หรือ "✓ ปิดการใช้งานแล้ว (มีประวัติการใช้งานอยู่)" ตามผลจริงจาก server — **ไม่พยายาม
  unblock ปุ่ม "นำเข้า" ในไฟล์เดิมที่เปิดค้างอยู่** (ลบสินค้าออกจาก DB ไม่ได้แก้ปัญหาข้อมูลในไฟล์ Excel ที่ยังโหลด
  ค้างอยู่ — แถวนั้นจะ error เหมือนเดิมถ้า Import จริงจากไฟล์นี้ต่อ) มีข้อความแนะนำให้ export ใหม่หลังลบครบแล้ว

**Test:** `server/test/productsImportExport.test.js` — เปลี่ยน PR-03/05 ให้ใช้ `;` แทน `,`, PR-04 เพิ่ม assert
header/delimiter ตรง, **PR-04b ใหม่** (regression test ตรงเป้า: สร้าง Supplier ชื่อมี comma จริง import+export
round-trip ถูกต้อง), **PR-10 ใหม่** (ไฟล์ header แบบเก่าถูกปฏิเสธด้วย header error), **PR-11 ใหม่** (`_data.id`
ติดมาแม้ status เป็น error), **PR-12/13/14 ใหม่** (DELETE: ลบถาวรถ้าไม่มีประวัติ / fallback ปิดใช้งานถ้ามี
bill_items ผูกอยู่ / 404 ถ้าไม่มี id), **PR-15 ใหม่** (export กรอง is_active=1 จริง) — `node --test` →
**390/390 เขียว** (383 baseline + 7 เคสใหม่), `npm run build` (client) ผ่าน

**Verify:** ยังไม่ได้ verify ผ่านมือจริงกับไฟล์ 2029 แถวจริงของ user — แนะนำ: (1) Export ใหม่จากระบบ (ไฟล์เก่าที่
ใช้ในภาพ screenshot ใช้ต่อไม่ได้แล้ว จะโดน header-mismatch) (2) Import ไฟล์ใหม่กลับเข้าไปดูว่า error ลดจาก 332
เหลือประมาณเท่าไร (คาดว่าลดลงมากเพราะ 202/332 น่าจะเป็น false-positive จาก comma bug) (3) สำหรับแถว error ที่
เหลือจริง (สินค้าที่กลุ่ม/หน่วยนับ/ฯลฯ ไม่มีอยู่ในระบบแล้วจริงๆ) ให้ประเมินทีละรายการแล้วใช้ปุ่ม "ลบสินค้านี้ออกจาก
ระบบ" เฉพาะรายที่มั่นใจว่าเลิกใช้แล้วจริง

### Files Changed

| File | สิ่งที่ทำ |
|---|---|
| `server/routes/master.js` | Products export/import Supplier delimiter `,`→`;`, export กรอง `is_active=1`, resolve `existing` ก่อนเช็ค error, + `DELETE /products/:id` (hard delete + FK fallback เป็น soft-delete) |
| `client/src/pages/Master/Products.jsx` | ปุ่ม "ลบสินค้านี้ออกจากระบบ" ในแถว error ของ import preview + `ConfirmDialog` + `deleteProduct` mutation |
| `server/test/productsImportExport.test.js` | ปรับ PR-03/04/05 เป็น `;`, + PR-04b/10/11/12/13/14/15 (7 เคสใหม่) |

---

## 2026-07-22 | Session 154 — ขยาย @mention ไปข้อความกลุ่ม Telegram จัดซื้ออื่นๆ ใน ncrService.js ครบทุกจุด

**คำขอ:** ต่อยอดจาก S153 — user ตอบรับข้อเสนอที่ถามไว้ท้าย S153 ว่าต้องการให้เพิ่ม @mention ในข้อความกลุ่มจัดซื้อ
อื่นๆ ด้วย (ตัวอย่างที่ยกไว้: "NCR รอ Review จัดซื้อ", "พร้อมส่ง Supplier")

**การแก้ (`server/services/ncrService.js`):**
- เพิ่ม `purchasingMentionsForBill(billId)` — resolve `bill_id → supplier_id` แล้วเรียก
  `getSupplierAssigneeMentions()` (S153) คืนบรรทัด `@user1 @user2\n` พร้อมใช้ต่อหน้าข้อความ หรือ `''` เปล่าถ้า
  ไม่มีใคร mention ได้ (pattern เดียวกับ `purchasingTargetsForBill()` ที่มีอยู่แล้วสำหรับ resolve เป้าหมาย
  in-app notification — เพิ่มคู่กันแยกหน้าที่ชัดเจน: ตัวหนึ่ง resolve "ใครควรได้ notification", อีกตัว resolve
  "จะ mention ใครในข้อความกลุ่ม")
- แปะ `purchasingMentionsForBill(ncr.bill_id)` นำหน้าข้อความ `sendTelegram(telegram_group_purchasing, ...)`
  ครบทั้ง **7 จุด** ใน service นี้: `approveNcr()`'s `pending_purchasing_review` (QMR อนุมัติเปิด),
  `pending_supplier` (พร้อมส่ง Supplier), `closed` (ปิดแล้ว), `purchasingReview()` (รอผู้จัดการจัดซื้อตรวจสอบ),
  `rejectPurchasingManagerReview()` (ผู้จัดการจัดซื้อไม่อนุมัติ Review), `rejectSupplierResponse()` (QC Manager
  ไม่อนุมัติคำตอบ Supplier), `resubmitToSupplier()` (ส่ง Supplier ตอบใหม่)

**ขอบเขตที่ตั้งใจไม่แตะ:** `deliveryService.js`/`uaiService.js` ก็มี `sendTelegram(telegram_group_purchasing, ...)`
เหมือนกัน (5 + 4 จุดตามลำดับ) แต่ user ไม่ได้ระบุถึง — ยังไม่แตะรอบนี้ ถ้าต้องการเพิ่มด้วยทำได้ทันทีด้วย pattern
เดียวกัน (Delivery ต้อง resolve supplier_id จาก delivery record แทน bill_id, UAI อาจต้อง join ผ่าน ncr_id →
bill_id → supplier_id เพิ่มอีกชั้น เพราะ UAI ไม่มี supplier_id ตรงๆ)

**Test:** เพิ่ม NOTIF-13 ใน `purchasingNotifications.test.js` — จำลอง QMR อนุมัติเปิด NCR จริงผ่าน
`ncrService.approveNcr()` (mock `node-fetch` แบบเดียวกับ NOTIF-10) เช็คว่าข้อความกลุ่มที่ส่งจริงขึ้นต้นด้วย
`@username` ของผู้ดูแลจัดซื้อ — `node --test` → **383/383 เขียว** (382 baseline + 1 เคสใหม่) — ไม่มี frontend
เปลี่ยนรอบนี้ (แก้แค่ service layer)

**Verify:** ยังไม่ได้ verify ผ่าน Telegram จริง — ใช้วิธี verify เดียวกับที่แนะนำใน S153 (ตั้ง
`telegram_username` ให้ผู้ดูแลจัดซื้อจริง แล้วลอง flow NCR ผ่านแต่ละขั้นทั้ง 7 จุด เช็คว่ามี @mention ขึ้นทุกครั้ง)

### Files Changed

| File | สิ่งที่ทำ |
|---|---|
| `server/services/ncrService.js` | + `purchasingMentionsForBill(billId)`, แปะ @mention นำหน้าข้อความกลุ่มจัดซื้อครบ 7 จุด |
| `server/test/purchasingNotifications.test.js` | + NOTIF-13 |

---

## 2026-07-22 | Session 153 — @mention ผู้ดูแลจัดซื้อในข้อความกลุ่ม Telegram NCR เกินกำหนด

**คำขอ:** telegram สามารถ @ ชื่อคนในกลุ่มได้ไหม ถ้าได้ให้ @ ชื่อจัดซื้อที่ดูแล Sup นั้นๆ (ต่อยอดข้อความแจ้งเตือน
กลุ่มจัดซื้อจาก S151/S152)

**คำตอบ + แนวทาง:** Telegram mention ได้ 2 แบบ — (1) `@username` แบบ plain text (Telegram auto-parse เป็น
mention entity เองแม้ไม่ตั้ง parse_mode ใดๆ) ต้องมี public username และอยู่ในกลุ่มจริงถึงจะได้ push notification
(2) `text_mention` ผ่าน HTML (`<a href="tg://user?id=X">ชื่อ</a>`) ใช้ user ID แทน username ได้ แต่ต้องเปิด
`parse_mode:HTML` — เลือกแบบ (1) เพราะ `sendTelegram()` (`routes/notifications.js`) ตั้งใจส่งแบบ plain text
เสมอ (comment เดิมในโค้ด: กัน HTML injection จากข้อความที่มีค่าผู้ใช้กรอกปนอยู่ เช่น ชื่อสินค้า/comment/root_cause)
เปลี่ยนเป็น parse_mode:HTML จะต้อง escape ทุกจุดที่มีค่าผู้ใช้กรอกในข้อความทั้งหมดใหม่ ความเสี่ยงไม่คุ้มกับ
ประโยชน์ที่ต่างกันแค่ "ไม่ต้องมี public username" — แบบ (1) ใช้ได้ทันทีไม่ต้องแตะ `sendTelegram()` เลย

**การแก้:**
- เพิ่มคอลัมน์ `users.telegram_username TEXT` (`database.js`'s `safeAddColumn`) — เก็บไม่มี `@` นำหน้าเสมอ
  (`normalizeTelegramUsername()` ใหม่ใน `index.js` ตัด `@` ที่ user พิมพ์มาออกให้) แยกจาก `telegram_chat_id`
  เดิมโดยสิ้นเชิง (chat_id = DM ส่วนตัว, username = mention ในกลุ่ม — คนละวัตถุประสงค์ คนละ field)
- `purchasingScope.js` เพิ่ม `getSupplierAssigneeMentions(supplierId)` — query
  `supplier_purchasing_assignees JOIN users` เอาเฉพาะคนที่ active + ตั้ง `telegram_username` ไว้แล้ว คืน
  `['@username', ...]` — ถ้า supplier ไม่มีผู้ดูแล specific คนไหนเลย คืน `[]` (ไม่ mention ทุกคนในกลุ่มแบบสุ่มสี่
  สุ่มห้า ไม่ตรงเจตนา "เฉพาะคนที่ดูแล Sup นั้น")
- `overdueNotifier.js` — เรียก `getSupplierAssigneeMentions()` แปะบรรทัดแรกของข้อความกลุ่ม Telegram ก่อน
  `[IQC] ...` เดิม (ถ้ามี mention) — ไม่กระทบแจ้งเตือนส่วนตัว (`createNotification`/`notifyUserTelegram`) ที่
  ระบุ target ชัดเจนอยู่แล้วผ่าน DM ไม่ต้อง mention
- `index.js` — `GET/POST/PATCH /api/admin/users` เพิ่ม `telegram_username` เข้า SELECT/INSERT/UPDATE + audit log
- `client/src/pages/Admin/Users.jsx` — ฟอร์มเพิ่มช่องกรอก "Telegram Username" (auto-strip `@`) พร้อมคำอธิบาย
  แยกจาก Chat ID ชัดเจน + ตาราง desktop/การ์ดมือถือ เพิ่ม badge `@username` (สีม่วง แยกจาก badge chat_id สีฟ้า
  เดิม) ต่อจากที่มีอยู่แล้ว

**ขอบเขตที่ตั้งใจไม่แตะ:** ข้อความกลุ่ม Telegram อื่นๆ ที่ส่งไป `telegram_group_purchasing` (เช่น
`ncrService.js`'s "NCR รอ Review จัดซื้อ"/"พร้อมส่ง Supplier") ยังไม่ได้เพิ่ม @mention — คำขอนี้เจาะจงเฉพาะ
ข้อความ "เกินกำหนด" ที่กำลังคุยกันอยู่ ถ้าต้องการ mention ในข้อความอื่นด้วย บอกแยกได้ (pattern
`getSupplierAssigneeMentions()` reuse ได้ทันที ไม่ต้องเขียนใหม่)

**Test:** `purchasingNotifications.test.js` เพิ่ม NOTIF-10 (mock `node-fetch` แบบเดียวกับ `backupService.test.js`
— ตั้ง `telegram_username` ให้ผู้ดูแล supplier แล้วเช็คว่าข้อความที่ส่งจริงขึ้นต้นด้วย `@username`), NOTIF-11
(ไม่ตั้ง username → ไม่มี mention), NOTIF-12 (unit test `getSupplierAssigneeMentions()` ตรงๆ — คืนเฉพาะคนที่
ตั้ง username ไว้ ข้ามคนที่ยังไม่ตั้ง) — `node --test` → **382/382 เขียว** (379 baseline + 3 เคสใหม่),
`npm run build` (client) ผ่าน

**Verify:** ยังไม่ได้ verify ผ่าน Telegram จริง — แนะนำให้ user ตั้งค่า `telegram_username` ให้ผู้ดูแลจัดซื้อสัก
1 คนที่หน้า Admin > จัดการผู้ใช้ (ต้องเป็น username จริงที่มีอยู่ใน Telegram และคนนั้นต้องอยู่ในกลุ่มจัดซื้อที่ตั้ง
ค่า Chat ID ไว้จริง) แล้วรอ/บังคับให้ NCR เกินกำหนด เช็คว่าข้อความกลุ่มมี `@username` ขึ้นก่อนและคนนั้นได้รับ push
notification จริงจาก Telegram (ไม่ใช่แค่ข้อความ plain เฉยๆ)

### Files Changed

| File | สิ่งที่ทำ |
|---|---|
| `server/db/database.js` | + `safeAddColumn('users','telegram_username','TEXT')` |
| `server/lib/purchasingScope.js` | + `getSupplierAssigneeMentions(supplierId)` |
| `server/lib/overdueNotifier.js` | ข้อความกลุ่ม Telegram แปะ `@mention` ผู้ดูแลจัดซื้อของ supplier นำหน้า |
| `server/index.js` | `GET/POST/PATCH /api/admin/users` เพิ่ม `telegram_username` + `normalizeTelegramUsername()` |
| `client/src/pages/Admin/Users.jsx` | ฟอร์ม + ตาราง/การ์ด เพิ่มช่องกรอก/แสดง Telegram Username |
| `server/test/purchasingNotifications.test.js` | + NOTIF-10/11/12 |

---

## 2026-07-22 | Session 152 — NCR: แจ้งเตือนค้างอนุมัติส่วนตัว (ก่อนถึงจัดซื้อ) + แจ้งซ้ำ (หลังถึงจัดซื้อ)

**คำขอ:** ต่อยอดจาก S151 — เพิ่มให้แจ้ง Telegram ส่วนตัวพร้อม link ติดตามอนุมัติ เมื่อเอกสารค้างอยู่ที่พนักงานคนใด
คนหนึ่งเกิน 3 วัน (นับจากวันที่คนก่อนหน้าส่งขออนุมัติ) แต่ถ้าเอกสารถึงจัดซื้อแล้วให้นับจากวันที่ตั้งค่าไว้ในระบบแทน
(เช่น 7 วัน) แล้วแจ้งกลุ่มจัดซื้อพร้อม link เข้าตรวจสอบ และถ้ายังเกินกำหนดอยู่ให้แจ้งซ้ำในกลุ่มทุกๆ 3 วัน พร้อมบอก
ด้วยว่าเกินกำหนดมาแล้วกี่วัน

**Clarify ก่อนเริ่ม (AskUserQuestion):** ข้อความต้นฉบับตีความได้หลายแบบ ถามยืนยัน 3 จุด — (1) ขอบเขตขั้นตอนของแจ้ง
เตือนส่วนตัว: user เลือก **เฉพาะ 3 ขั้นก่อนถึงจัดซื้อเท่านั้น** (`pending_supervisor`/`pending_manager`/
`pending_qmr_open`) ไม่รวมขั้นหลังจัดซื้อที่วนกลับมา QC ภายใน (2) แจ้งเตือนส่วนตัวควรแจ้งซ้ำหรือครั้งเดียว: user
เลือก **แจ้งซ้ำทุก 3 วันเหมือนกลุ่มจัดซื้อ** (3) จำนวนวัน 3 วันของแจ้งเตือนส่วนตัวควรตั้งค่าได้ไหม: user เลือก
**ตั้งค่าได้จาก Admin เหมือนกัน**

**การแก้ (2 กลไกคู่ขนาน แบ่งตามว่าเอกสาร "ถึงจัดซื้อ" หรือยัง — เช็คจาก `qmr_opened_at` ที่เพิ่มใน S151):**

**(1) `lib/internalReminder.js` (ใหม่ทั้งไฟล์)** — เฉพาะ 3 ขั้นก่อนถึงจัดซื้อ:
- `STAGE_ROLE` map: `pending_supervisor→qc_supervisor`, `pending_manager→qc_manager`, `pending_qmr_open→qmr`
- "วันที่คนก่อนหน้าส่งขออนุมัติ" = `COALESCE((SELECT MAX(created_at) FROM ncr_approvals WHERE ncr_id=n.id),
  n.created_at)` — ใช้แถวล่าสุดใน `ncr_approvals` ของ NCR นั้น (ไม่ filter role เพราะในขอบเขต 3 ขั้นนี้มีแค่
  1 แถวต่อครั้งอยู่แล้ว) หรือ `created_at` ถ้ายังไม่มีใครอนุมัติเลย (ขั้น `pending_supervisor` แรกสุด)
- เกิน `ncr_internal_reminder_days` (default 3) วัน → แจ้งทุก user ของ role นั้น ผ่าน `createNotification()`
  (ส่ง Telegram ส่วนตัว + แนบ link อัตโนมัติอยู่แล้วผ่าน `notifyUserTelegram`, ไม่ต้องเขียนโค้ดส่ง Telegram เอง)
  ข้อความบอกจำนวนวันที่ค้างจริง (`ค้างอนุมัติมาแล้ว N วัน`)
- แจ้งซ้ำทุก `ncr_internal_reminder_days` วัน จาก `ncrs.internal_reminder_last_sent_at` (คอลัมน์ใหม่, เก็บเวลา
  แจ้งครั้งล่าสุด) — เงื่อนไข: `internal_reminder_last_sent_at IS NULL OR date(+N days) < date('now')`
- `ncrService.js`'s `approveNcr()` — **ทุก** transition (ไม่ใช่แค่ 3 ขั้นนี้) reset `internal_reminder_last_sent_at
  = NULL` ในทรานแซกชันเดียวกับเปลี่ยน status เสมอ — ขั้นใหม่ต้องเริ่มนับรอบแจ้งเตือนใหม่ ไม่สืบทอดรอบเก่า

**(2) `overdueNotifier.js` (ต่อยอดจาก S151)** — หลังเอกสารถึงจัดซื้อแล้ว (`qmr_opened_at IS NOT NULL`):
- เปลี่ยน `overdue_notified_at` จาก flag "เคยแจ้งหรือยัง" (gate ครั้งเดียว) เป็น cursor "แจ้งครั้งล่าสุดเมื่อไร"
  — เงื่อนไขแจ้งซ้ำ: `overdue_notified_at IS NULL OR date(+ncr_overdue_repeat_days days) < date('now')`
  (setting ใหม่, default 3) — แจ้งไปเรื่อยๆ จนกว่า NCR จะปิด/ยกเลิก (status filter เดิมกันไว้อยู่แล้ว)
- ข้อความเปลี่ยนจาก "เกินกำหนด N วัน" (ค่าคงที่ = threshold) เป็น **"เกินกำหนดมาแล้ว X วัน"** (X คำนวณจริงจาก
  `julianday('now') - julianday(date(qmr_opened_at, '+overdueDays days'))` — จำนวนวันที่ผ่านเส้นตายมาแล้วจริง
  เพิ่มขึ้นเรื่อยๆ ทุกครั้งที่แจ้งซ้ำ ไม่ใช่ค่าคงที่)
- ข้อความ Telegram กลุ่มจัดซื้อเพิ่ม link เข้าดูเอกสารตรงๆ (`${app_url}/ncr/{id}`) — เดิมมีแค่ในแจ้งเตือนส่วนตัว
  ผ่าน `notifyUserTelegram` อัตโนมัติ กลุ่มไม่เคยมี link เลย (ต้องต่อ URL เองเพราะ `sendTelegram()` ดิบไม่ทำให้)

**Settings ใหม่ (Admin > ตั้งค่า > Telegram, extend `GET/POST /api/admin/settings/telegram`):**
`ncr_overdue_repeat_days` (default 3, กลุ่มจัดซื้อแจ้งซ้ำทุกกี่วัน) และ `ncr_internal_reminder_days` (default 3,
แจ้งส่วนตัวครั้งแรก+รอบแจ้งซ้ำ ใช้ค่าเดียวกันทั้งคู่ตามที่ user ระบุ) — validate จำนวนเต็มบวกเหมือน
`ncr_overdue_days` เดิม (refactor เป็น loop เดียวคุม 3 ฟิลด์แทนโค้ดซ้ำ) — `Admin/Settings.jsx`'s `TelegramTab`
เพิ่ม 3 ช่องกรอก (จัดกลุ่ม "เกินกำหนด" 2 ช่องคู่กัน + "ค้างอนุมัติส่วนตัว" อีก 1 ช่องแยก)

**Scheduler:** ไม่เพิ่ม `setInterval` ใหม่ — `runOverdueCheck()` (`index.js`, เดิมรันตอนบูต + ทุก 1 ชม.) เรียก
`checkInternalApprovalReminders()` เพิ่มในรอบเดียวกัน (กัน error แยกกันด้วย try/catch คนละก้อน กันกลไกหนึ่งพังแล้ว
ลากอีกกลไกไม่ทำงานไปด้วย)

**Test:** `server/test/internalReminder.test.js` ใหม่ทั้งไฟล์ (IR-01..09) — ครอบ: ไม่แจ้งถ้ายังไม่เกิน (IR-01),
แจ้งแต่ละ role ถูกต้องตามขั้น (IR-02/03/04, IR-03 พิสูจน์นับจาก `ncr_approvals` ไม่ใช่ `created_at`), ไม่แจ้งซ้ำ
ทันที (IR-05), แจ้งซ้ำหลังครบรอบ (IR-06), reset รอบตอน status เปลี่ยน (IR-07), setting ใช้งานได้จริง (IR-08),
ไม่แจ้ง NCP ที่ปิดแล้ว (IR-09) — `purchasingNotifications.test.js` เพิ่ม NOTIF-08 (แจ้งซ้ำหลังครบ repeat_days)
และ NOTIF-09 (ข้อความมีจำนวนวันจริง + link) — `node --test` → **379/379 เขียว** (368 baseline + 2 + 9 เคสใหม่),
`npm run build` (client) ผ่าน

**Verify:** ยังไม่ได้ verify ผ่านมือจริงในเบราว์เซอร์ — แนะนำให้ user ทดสอบ flow จริง: สร้าง NCR ทิ้งไว้ที่ขั้น
Supervisor/Manager/QMR เกิน 3 วัน (หรือลดค่า `ncr_internal_reminder_days` เป็น 0 ไม่ได้เพราะ validate ≥1 — ใช้ 1
วันแทนเพื่อทดสอบเร็วขึ้น) เช็คว่า Telegram ส่วนตัวของ role นั้นได้รับข้อความพร้อม link แล้วลองอนุมัติผ่านขั้นไป เช็คว่า
รอบแจ้งเตือนของขั้นถัดไปเริ่มนับใหม่ไม่ต่อจากขั้นเก่า — ฝั่งจัดซื้อ ลองตั้ง `ncr_overdue_days`/
`ncr_overdue_repeat_days` เป็นค่าน้อยๆ เพื่อทดสอบว่าแจ้งซ้ำจริงพร้อมจำนวนวันที่เพิ่มขึ้นเรื่อยๆ และมี link ในข้อความ
กลุ่ม Telegram

### Files Changed

| File | สิ่งที่ทำ |
|---|---|
| `server/lib/internalReminder.js` | ใหม่ทั้งไฟล์ — `checkInternalApprovalReminders()` |
| `server/lib/overdueNotifier.js` | เปลี่ยนจากแจ้งครั้งเดียวเป็นแจ้งซ้ำทุก `ncr_overdue_repeat_days` วัน + ข้อความจำนวนวันเกินจริง + link |
| `server/db/database.js` | + `safeAddColumn('ncrs','internal_reminder_last_sent_at','DATETIME')` |
| `server/services/ncrService.js` | `approveNcr()` reset `internal_reminder_last_sent_at=NULL` ทุก transition |
| `server/index.js` | `runOverdueCheck()` เรียก `checkInternalApprovalReminders()` เพิ่ม, settings API เพิ่ม `ncr_overdue_repeat_days`/`ncr_internal_reminder_days` |
| `client/src/pages/Admin/Settings.jsx` | `TelegramTab` เพิ่ม 3 ช่องกรอกจำนวนวัน |
| `server/test/internalReminder.test.js` | ใหม่ทั้งไฟล์ — IR-01..09 |
| `server/test/purchasingNotifications.test.js` | + NOTIF-08/09 |

---

## 2026-07-22 | Session 151 — Bug: NCR แจ้ง "เกินกำหนด" ก่อน QMR อนุมัติเปิดเอกสาร + จำนวนวันตั้งค่าได้

**คำขอ:** user (qc_manager) รายงานว่าอนุมัติ NCR ส่งต่อให้ QMR อนุมัติวันที่ 22/07/2569 แล้วสักพักระบบแจ้งเตือนไป
กลุ่มจัดซื้อว่า "NCR-2026-0001 เกินกำหนดวันที่ 2026-07-21 แล้ว กรุณาติดตาม" ทั้งที่ QMR ยังไม่ได้อนุมัติเปิดเอกสารเลย
— ขอให้แก้เป็น: เริ่มนับวันแจ้งเตือนหลัง QMR อนุมัติเปิดเอกสารแล้วเท่านั้น โดยจำนวนวันตั้งค่าได้ที่เมนูตั้งค่าระบบ
(Admin) แต่ถ้ายังไม่ได้ตั้งค่าให้ default ไว้ 7 วัน

**Root cause:** `overdueNotifier.js` (เดิม) นับ "เกินกำหนด" จาก `ncrs.disposition_due_date` เทียบกับ
`date('now')` ตรงๆ — ฟิลด์นี้เป็นวันที่ QC Manager **กรอกเอง** ตอนอนุมัติ NCR ที่ขั้น `pending_manager` (ส่งต่อให้
QMR อนุมัติเปิด) เป็น "วันกำหนดดำเนินการ" (target action date) ที่แสดงในหน้า NCR/Purchasing Dashboard/PDF/Email
อยู่แล้ว — ไม่มีความเกี่ยวข้องกับว่า QMR อนุมัติเปิดเอกสารจริงหรือยัง เคสนี้ QC Manager กรอกวันที่ 2026-07-21 ซึ่ง
ผ่านไปแล้วตอนที่อนุมัติจริง (22/07) ทำให้ scheduler รอบถัดไป (ทุก 1 ชม., `checkOverdueNcrNotifications`) เจอเงื่อนไข
overdue ทันทีทั้งที่เอกสารยังไม่ถึงมือ QMR เลยด้วยซ้ำ

**การแก้:**
- เพิ่มคอลัมน์ `ncrs.qmr_opened_at DATETIME` (`database.js`'s `safeAddColumn`) — บันทึกเวลาที่ QMR อนุมัติเปิด
  NCR จริง
- `services/ncrService.js`'s `approveNcr()` — ตอน transition `pending_qmr_open → pending_purchasing_review`
  (ขั้นที่ QMR กดอนุมัติเปิดจริง) เซ็ต `qmr_opened_at = datetime('now')` ในทรานแซกชันเดียวกับการเปลี่ยน status
  (pattern เดียวกับ `closed_at` ตอนปิดเอกสาร)
- `lib/overdueNotifier.js` — เปลี่ยน query ทั้งหมด: ต้อง `qmr_opened_at IS NOT NULL` ก่อน (เอกสารที่ QMR ยังไม่
  เปิดจะไม่ถูกพิจารณาเลย ไม่ว่า `disposition_due_date` จะเป็นอะไร) แล้วเทียบ `date(qmr_opened_at, '+N days') <
  date('now')` โดย N อ่านจาก `db.getSetting('ncr_overdue_days')` (`Number(...) || 7` — default 7 ถ้ายังไม่ตั้ง)
  ข้อความแจ้งเตือนเปลี่ยนเป็นอ้างอิงวันที่ QMR เปิด + จำนวนวันที่ตั้งไว้ แทนวันที่ QC Manager กรอกเอง — ไม่แตะ
  `disposition_due_date` field เดิม (ยังคงเป็น "วันกำหนดดำเนินการ" แสดงในหน้าจอ/PDF/Email ตามเดิม แค่เลิกใช้เป็น
  ตัวกระตุ้นแจ้งเตือนอัตโนมัติ)
- **Setting ใหม่:** `ncr_overdue_days` เก็บผ่าน `db.getSetting`/`setSetting` เหมือน Telegram config เดิม — extend
  `GET/POST /api/admin/settings/telegram` (`index.js`) ให้ครอบคลุมฟิลด์นี้ด้วย (validate เป็นจำนวนเต็มบวก, 400 ถ้า
  ไม่ใช่) เพราะเป็น setting ที่คุมพฤติกรรม Telegram notification ไปกลุ่มจัดซื้อโดยตรง อยู่หน้าเดียวกับ "Chat ID —
  กลุ่มจัดซื้อ" ใน `Admin/Settings.jsx`'s `TelegramTab` — เพิ่มช่องกรอกตัวเลข "แจ้งเตือน NCR เกินกำหนด (วัน หลัง QMR
  อนุมัติเปิดเอกสาร)" พร้อมคำอธิบาย
- **Data-heal (backfill):** NCR เก่าที่ผ่านขั้น QMR เปิดไปแล้วก่อน column นี้จะถูกเพิ่ม จะมี `qmr_opened_at` เป็น
  `NULL` ค้างตลอดไปถ้าไม่ backfill (ทำให้ overdue tracking หายไปเงียบๆ สำหรับเอกสารค้างอยู่ตอน deploy) — เพิ่ม
  migration step ใน `database.js` (รันหลัง `runMigrations()`/legacy rebuilds ทั้งหมด, ก่อน `seedData()`):
  หา NCR ทุกตัวที่ `qmr_opened_at IS NULL` และสถานะอยู่หลังขั้น QMR เปิดไปแล้ว (ไม่ใช่
  `pending_supervisor`/`pending_manager`/`pending_qmr_open`/`ncp_closed`/`cancelled`) แล้วเติมด้วยเวลา approve
  แรกสุดของ role='qmr' ใน `ncr_approvals` (ขั้นเปิดมาก่อนขั้นปิดเสมอตาม state machine) fallback เป็น
  `created_at` ถ้าหาไม่เจอ — idempotent (WHERE `qmr_opened_at IS NULL`)

**ขอบเขตที่ตั้งใจไม่แตะ:** `services/purchasingDashboardService.js`'s `OVERDUE_EXPR` (badge สีแดงในหน้า
Purchasing Dashboard) ยังอิง `disposition_due_date` แบบเดิมอยู่ — user รายงานปัญหาเฉพาะที่ Telegram notification
เท่านั้น ยังไม่ได้ขอให้เปลี่ยนหน้า dashboard ด้วย (ถ้าต้องการ consistency ระหว่าง 2 จุดนี้ต้องแจ้งแยกต่างหาก)

**Test:** `server/test/purchasingNotifications.test.js` — ปรับ `makeBillNcr()` helper จาก `dueDate` param เป็น
`qmrOpenedAt` (insert ตรงเข้า `ncrs.qmr_opened_at` แทน `disposition_due_date`) เพิ่ม helper `daysAgo(n)` (ใช้
`datetime('now', '-N days')` ของ SQLite เอง กัน format ไม่ตรงกัน) ปรับ NOTIF-04/05 เดิมให้ตั้งค่าผ่าน
`qmrOpenedAt` แทน + เพิ่ม 2 เคสใหม่: **NOTIF-06** (NCR ที่ `qmr_opened_at` ยัง NULL ต้องไม่ถูกแจ้งเตือนเด็ดขาด — เคส
ตรงกับบั๊กที่ user รายงาน) และ **NOTIF-07** (ตั้งค่า `ncr_overdue_days=3` แล้ว NCR ที่เปิดมา 4 วันต้องถูกแจ้งเตือน
ทั้งที่ยังไม่เกิน default 7 วัน — ยืนยันว่า setting มีผลจริง) — `node --test` → **368/368 เขียว** (366 baseline +
2 เคสใหม่), `npm run build` (client) ผ่าน

**Verify:** ยังไม่ได้ verify ผ่านมือจริงในเบราว์เซอร์ — แนะนำให้ user ลอง flow จริง: qc_manager อนุมัติ NCR ส่งต่อ
QMR (จะไม่มี qmr_opened_at ตอนนี้) รอ 1 ชม. เช็คว่ายังไม่มี notification "เกินกำหนด" ไปกลุ่มจัดซื้อ แล้วให้ QMR
อนุมัติเปิดจริง เช็คว่า `qmr_opened_at` ถูกบันทึก แล้วลองตั้งค่า `ncr_overdue_days` ที่ Admin > ตั้งค่า > Telegram
เป็นค่าน้อยๆ (เช่น 1) ทดสอบว่า notification มาตามจำนวนวันที่ตั้งไว้จริง — สำหรับ production DB ที่มี NCR ค้างอยู่
ควรเช็ค log `[Migration] Backfilled qmr_opened_at for N existing NCR(s)` ตอน deploy เพื่อยืนยันว่า backfill
รันสำเร็จ

### Files Changed

| File | สิ่งที่ทำ |
|---|---|
| `server/db/database.js` | + `safeAddColumn('ncrs','qmr_opened_at','DATETIME')`, + data-heal backfill สำหรับ NCR เก่า |
| `server/services/ncrService.js` | `approveNcr()` เซ็ต `qmr_opened_at` ตอน transition `pending_qmr_open → pending_purchasing_review` |
| `server/lib/overdueNotifier.js` | เปลี่ยนเกณฑ์ overdue จาก `disposition_due_date` เป็น `qmr_opened_at` + N วัน (setting `ncr_overdue_days`, default 7) |
| `server/index.js` | `GET/POST /api/admin/settings/telegram` เพิ่มฟิลด์ `ncr_overdue_days` (validate จำนวนเต็มบวก) |
| `client/src/pages/Admin/Settings.jsx` | `TelegramTab` เพิ่มช่องกรอก "แจ้งเตือน NCR เกินกำหนด (วัน หลัง QMR อนุมัติเปิดเอกสาร)" |
| `server/test/purchasingNotifications.test.js` | ปรับ helper เป็น `qmrOpenedAt`, + NOTIF-06/07 |

---

## 2026-07-21 | Session 150 — Render Bandwidth Audit รอบ 2: syncUploads() re-upload ไฟล์ lazy-fetch ซ้ำ

**คำขอ:** Service-Initiated Bandwidth บน Render ยังสูงอยู่ (~1GB ภายใน 1 วัน) ทั้งที่ activity จริงเบามาก (~16
บิลรับเข้า) — ให้วิเคราะห์สาเหตุจากโค้ดจริงเท่านั้น ห้ามเดา (ครอบคลุม cron/scheduler, R2, SQLite backup,
email, Telegram, upload API, external API calls, polling, ทุก endpoint, log) แล้วสรุปเป็นรายงาน + จัดอันดับ
bandwidth + patch ที่พร้อมใช้งาน

**บริบท:** Session 141 (2026-07-18) เคยวิเคราะห์เรื่องนี้มาแล้วครั้งหนึ่ง พบว่า `runHotBackup()` อัปโหลด DB
snapshot เต็มไฟล์ทับ R2 ทุก 10 นาทีโดยไม่มีเงื่อนไข → แก้ด้วย SHA-256 hash-dedup (`4e82eb8`) deploy ไปแล้ว
แต่ **ไม่เคย verify กับ Render bandwidth จริง** (DEVLOG เดิมบันทึกไว้ชัดว่า "ยังไม่ได้ verify") — รอบนี้ 3 วัน
หลัง deploy fix เดิม bandwidth ยังสูงอยู่ แปลว่ามีสาเหตุอื่นที่ fix เดิมไม่ครอบคลุม

**การวิเคราะห์:** ใช้ 3 Explore agent คู่ขนาน (backup/R2/scheduler, Telegram/email/HTTP ภายนอก, SSE/client
polling) + ตรวจโค้ดจริงมือเองเพิ่มที่จุดสำคัญ (`backupService.js`, `r2Client.js`, `index.js`'s `/uploads`
middleware, `restoreService.js`, `DEPLOYMENT.md` §8) ก่อนสรุป — Telegram/Email/SSE/client-polling ทั้งหมด
ตัดออกจากสาเหตุ (ข้อความ/JSON เล็กระดับ KB, หรือเป็น "HTTP Responses" ไม่ใช่ "Service-Initiated" ตามนิยาม
Render) พบสาเหตุใหม่ที่ยังไม่เคยถูกแก้:

**Root cause:** deployment จริงที่ใช้งานคือ **Render Free tier + `RESTORE_ON_BOOT=true`**
(`DEPLOYMENT.md:170-173` ยืนยันว่าเป็น "ทางเลือกที่เลือกใช้จริง") — ดิสก์เป็น ephemeral หายทุกครั้งที่
container restart/redeploy DB ถูก restore จาก R2 ตอน boot แต่ **ไฟล์แนบ (uploads) ไม่ถูก restore ล่วงหน้า**
ใช้ lazy fetch-through แทน (`restoreService.js:3-4`) — เมื่อไฟล์แนบเก่าถูกเปิดดู (cache miss หลัง restart)
`index.js:100-117` ดาวน์โหลดจาก R2 มาเขียนไฟล์ local ใหม่ ซึ่ง `r2Client.js`'s `getObjectToFile()`
(`fs.createWriteStream` ธรรมดา) **ไม่รักษา mtime เดิมจาก R2** → ไฟล์ได้ mtime เป็น "ตอนนี้" เสมอ ในขณะที่
`upload-sync-state.json` (ใช้เทียบ `size`+`mtimeMs` ใน `syncUploads()`, `backupService.js:193-212`) **ก็ไม่
เคยถูก restore เช่นกัน** (ไม่อยู่ใน `restoreService.js` เลย, restore เฉพาะ DB) → `syncUploads()` รอบถัดไป
(≤10 นาที) มองไฟล์ที่เพิ่งเปิดดูนี้ว่า "ใหม่/เปลี่ยน" แล้ว **อัปโหลดกลับไป R2 คีย์เดิมที่เพิ่งโหลดมา — content
เหมือนเดิมทุกไบต์ เสีย bandwidth ทั้งขาลง (fetch) และขาขึ้น (re-upload) โดยไม่มีประโยชน์เลย** ปริมาณจึงไม่ได้
แปรผันตาม "บิลใหม่วันนี้" แต่แปรผันตาม "จำนวนไฟล์เก่าทุกยุคสมัยที่ถูกเปิดดูวันนี้" อธิบายได้ว่าทำไม activity เบา
(16 บิล) ถึงกิน bandwidth เกินสัดส่วน — สาเหตุรอง (ยังไม่ปิดสนิทจาก S141): `runHotBackup()` มี dedup แล้วแต่
ยังอัปโหลดเต็มไฟล์ทุกครั้งที่ DB เปลี่ยนจริง (audit_log/notification เขียนแทบทุก action) ซ้อนกับ
`runDailyFifoBackup()` ที่อัปโหลดแยกอีก 1 ครั้ง/วันไม่มี dedup — ทั้งสองยังเป็น cost ที่มีอยู่จริง ไม่ใช่ bug
เหมือนตัวแรก (RPO vs bandwidth tradeoff)

**การแก้:** เพิ่ม `markLocalFileSynced(rel, stat)` ใน `backupService.js` (reuse `loadSyncState`/
`saveSyncState` เดิม) บันทึกว่าไฟล์นี้ตรงกับ R2 อยู่แล้ว — เรียกจาก `index.js`'s lazy fetch-through handler
ทันทีหลัง `fs.renameSync(tmpPath, localPath)` สำเร็จ กัน `syncUploads()` รอบถัดไปเข้าใจผิดว่าเป็นไฟล์ใหม่แล้ว
อัปโหลดกลับไปซ้ำ — ไม่แตะ `runHotBackup()`/`runDailyFifoBackup()` เลยรอบนี้ (เป็น tradeoff ที่ต้องให้ user
ตัดสินใจแยกต่างหาก ไม่ใช่สิ่งที่ควรแก้เงียบๆ)

**Test:** เพิ่ม BACKUP-16 (`markLocalFileSynced` บันทึก `size`/`mtimeMs` ถูกต้องลง `upload-sync-state.json`
จริง) และ BACKUP-17 (จำลอง lazy-fetch: mark ไฟล์แล้วเรียก `syncUploads()` → ไฟล์นั้นไม่ถูกอัปโหลดซ้ำ) ใน
`server/test/backupService.test.js` — `UPLOADS_BASE`/`SYNC_STATE_PATH` เป็น path จริงของ repo (hardcode ไม่
ผ่าน env var เหมือน `IQC_DB_PATH`) จึงสร้าง/ลบไฟล์ทดสอบจริงใน `iqc-system/uploads/_test-marklocal/` +
backup/restore `upload-sync-state.json` เดิมใน `finally` เสมอ (ถ้าไฟล์ไม่มีอยู่ก่อนเทส ลบทิ้งแทนเขียน `{}`
กัน fresh checkout โดนสร้างไฟล์ค้างไว้) — `node --test` → **366/366 เขียว** (364 baseline + 2 เคสใหม่)

**Verify:** ยังไม่ได้ verify กับ Render bandwidth จริง (ต้อง deploy ก่อน) — แนะนำเปิดดูไฟล์บิล/NCR เก่าทันทีหลัง
deploy ใหม่ (cache หายแน่นอน) แล้วเช็คว่า `syncUploads()` รอบถัดไปไม่พยายามอัปโหลดไฟล์นั้นซ้ำ + ติดตาม Service-
Initiated bandwidth บน Render dashboard 24-48 ชม. เทียบ baseline ~1GB/วัน — รายงานวิเคราะห์เต็ม (evidence
table ทุกไฟล์/บรรทัด, bandwidth ranking, priority, คำแนะนำเพิ่ม logging เพื่อวัดสัดส่วนจริง) อยู่ใน plan file
ของ session นี้ (นอก repo, ผ่าน Plan Mode) — เจตนาไม่คัดลอกซ้ำที่นี่เพื่อกัน DEVLOG บวมเกินไป

**รอบที่ 2 (คำขอเพิ่มเติมในวันเดียวกัน):** user ถามก่อนว่าถ้าข้อมูลเปลี่ยน 5 ครั้งในหน้าต่าง 15 นาที ระบบจะ backup
กี่ครั้ง — ตอบตามกลไกจริง: ไม่ใช่ per-event แต่ผูกกับรอบ `setInterval` (ตอนนั้นทุก 10 นาที) ผ่าน hash-dedup ของ
`runHotBackup()` (S141) ดังนั้นในหน้าต่าง 15 นาทีจะมี tick ตกแค่ 1-2 ครั้ง (ไม่ใช่ 5 ครั้งตามจำนวนการเปลี่ยนแปลง)
— ตามด้วยคำขอเปลี่ยนรอบจริงเป็น **backup ทุก 2 ชม.** โดยยังคงเงื่อนไข "backup เฉพาะถ้ามีการเปลี่ยนแปลงข้อมูลใน
ช่วงนั้น" (มีอยู่แล้วจาก hash-dedup เดิม ไม่ต้องเพิ่ม logic ใหม่) — แก้แค่ค่า interval เดียวที่
`server/index.js`'s `setInterval(() => backupService.runFullCycle()..., 2 * 60 * 60 * 1000)` (เดิม
`10 * 60 * 1000`) ซึ่งควบคุมทั้ง 3 sub-task ของ `runFullCycle()` (hot backup + daily FIFO + syncUploads)
พร้อมกันเพราะเป็น scheduler เดียวใช้ร่วม — RPO หลักจึงขยับจาก ~10 นาที เป็น ~2 ชม. (ตกลงกับ user แล้วว่ายอมรับ
tradeoff นี้เพื่อลด bandwidth เพิ่ม) — shutdown handler (`runHotBackup()` ใน SIGTERM) ยังทำงานเหมือนเดิม ช่วย
ปิดช่องว่างตอน redeploy/graceful-restart ให้เกือบ real-time โดยไม่ต้องรอ 2 ชม. — อัปเดต comment ใน
`backupService.js`, `DEPLOYMENT.md` §8.2, `CLAUDE.md` §27.2-27.4 ให้ตรงกับรอบใหม่ทั้งหมด (ของเดิมอ้างอิง
"10 นาที" หลายจุด) — ไม่มีการแก้ logic/test เพิ่ม (ค่า interval ไม่มี unit test คลุมโดยตรงอยู่แล้ว) —
`node --test` → ยังคง **366/366 เขียว** (ไม่กระทบ)

### Files Changed

| File | สิ่งที่ทำ |
|---|---|
| `server/lib/backupService.js` | + `markLocalFileSynced(rel, stat)` (export ใหม่); อัปเดต comment cadence เป็น "ทุก 2 ชม." |
| `server/index.js` | `/uploads` lazy fetch-through handler เรียก `markLocalFileSynced()` ทันทีหลังดาวน์โหลด+cache ไฟล์จาก R2 สำเร็จ; `runFullCycle()` scheduler interval 10 นาที → 2 ชม. |
| `server/test/backupService.test.js` | + BACKUP-16/17 (คลุม `markLocalFileSynced` + `syncUploads` skip behavior) |
| `iqc-system/DEPLOYMENT.md` | §8.2 อัปเดต RPO/cadence จาก ~10 นาที → ~2 ชม. + note `markLocalFileSynced()` fix |
| `CLAUDE.md` | §27.2-27.4 อัปเดต RPO/cadence จาก ~10 นาที → ~2 ชม. + note `markLocalFileSynced()` fix |

---

## 2026-07-16 | Session 128 — NCR: มูลค่าเคลม/รหัสสินค้า/disposition visibility/purchasing_manager gate/COO email

**คำขอ:** user รายงาน 5 เรื่องที่ฟอร์ม NCR-2026-0004 (มุมมองจัดซื้อ) — (1) จัดซื้อต้องกรอกมูลค่าสินค้าเคลม (THB/USD)
ก่อนกด Review + เพิ่มคำแปลอังกฤษ, บังคับกรอกแต่ใส่ "-" ได้ถ้าไม่มีมูลค่า, แสดงในกล่อง "ข้อมูล NCR" ใต้รายละเอียด
สินค้า + เพิ่มรหัสสินค้าต่อท้ายชื่อสินค้า (2) เพิ่มข้อมูลการจัดการของ QC Manager ใต้รายละเอียดสินค้าด้วย (3) เพิ่ม
หมายเหตุแดง "ตีกลับสินค้า 100% เนื่องจากไม่ผ่านมาตรฐานการสุ่มตรวจ" (+อังกฤษ) (4) เพิ่มให้ผู้จัดการจัดซื้อต้องตรวจสอบ
หลังพนักงานจัดซื้อ Review เสร็จ ก่อนจะกด copy link ส่ง Supplier ได้ (เพิ่มสถานะ+notification ทั้งระบบ) (5) เพิ่มให้
COO รับทราบ NCR หลังผู้จัดการจัดซื้อตรวจสอบผ่าน ผ่าน Email (เพิ่มการตั้งค่า Email + ช่องอีเมลที่หน้าผู้ใช้งาน) +
ส่งต่อ Telegram ส่วนตัว พร้อมแก้ label "CCO" ที่ควรเป็น "COO" ในฟอร์มสร้าง user

**วิธีทำงาน:** Phase 1 อ่าน DEVLOG.md/CLAUDE.md/AUDIT.md ทั้งหมด + ส่ง Explore agent 3 ตัวขนานกันสำรวจ (1)
NCR/Detail.jsx + product/disposition display (2) ncrService.js/notify pattern/role cco/email infra (3) schema
ncr_items/products/bills + migration pattern ก่อนเข้า Plan mode — พบจากการสำรวจว่า: `item_name_en`/
`defect_detail_en` (คอลัมน์ `_en` sibling pattern) มีอยู่แล้วใน Purchasing Review modal เป็นจุดต่อยอด, `ncrs.status`
ไม่มี DB CHECK แล้ว (DEVMORE H4) เพิ่ม status ใหม่แค่เติม `VALID_NCR_STATUSES` Set ไม่ต้อง rebuild ตาราง,
`products.code` มีอยู่แล้วแต่ query `GET /ncr/:id` ไม่เคย join (PDF export join อยู่แล้วแยกกันคนละที่), ไม่มี
email/SMTP infra ในระบบเลย (Telegram-only มาตลอด), role `cco` ถูกใช้อยู่แล้วในขั้นตอนเซ็น UAI (คนละเรื่องกับ NCR)
— **ถาม `AskUserQuestion` 3 ข้อก่อนสรุปแผน** เพราะกระทบ scope/schema/UX ชัดเจน: (1) COO "รับทราบ" ต้องมีปุ่ม
กดจริงในระบบไหม — user เลือก **"แจ้งเตือนอย่างเดียว"** (ไม่มีปุ่ม/สถานะ/audit trail เพิ่ม) (2) หมายเหตุแดงแสดงเมื่อไหร่
— user เลือก **"เฉพาะ disposition=return"** (ไม่ใช่ทุก NCR) (3) แก้ Detail.jsx เฉพาะหน้าภายในใช่ไหม — user ยืนยัน
**"ใช่ เฉพาะหน้าภายใน"** (ไม่แตะ `Supplier/NCRResponse.jsx`)

**Phase 0 (schema, additive เท่านั้น):** `safeAddColumn` เพิ่ม `ncr_items.claim_value_thb`/`claim_value_usd`
(TEXT — อนุญาต `"-"`), `users.email` (TEXT, คู่กับ `telegram_chat_id` เดิม); เพิ่ม
`'pending_purchasing_manager_review'` เข้า `VALID_NCR_STATUSES`; แก้ seed `'วิชัย CCO'`→`'วิชัย COO'`

**Phase 1 (มูลค่าเคลม + รหัสสินค้า):** `ncrService.js` เพิ่ม `getFullNcrItems(ncrId)` (join `ncr_items→bill_items→
products` ดึง `product_code` — reuse ทั้ง `GET /ncr/:id` และอีเมล COO แทนเขียนซ้ำ 3 ที่), `routes/ncr.js`'s
`GET /:id` เปลี่ยนมาเรียกฟังก์ชันนี้แทน inline query เดิม; `purchasingReview()` validate
`claim_value_thb`/`claim_value_usd` ต้องไม่ว่างทุกรายการก่อน (throw 400 ถ้าขาด) แล้วบันทึกพร้อม `item_name_en`/
`defect_detail_en`; ฝั่ง frontend `Detail.jsx`'s Review modal เพิ่ม 2 ช่องกรอกต่อรายการ + validate ก่อน submit
(`alert()` รายการที่ขาด เหมือน pattern เดิมของ Delivery S127) + แสดงรหัสสินค้า/มูลค่าเคลมใน "ข้อมูล NCR"

**Phase 2 (disposition visibility):** เพิ่มกล่อง "ข้อมูลการจัดการของ QC Manager" ใหม่ต่อจากรายการสินค้าใน
"ข้อมูล NCR" การ์ด (frontend-only, ข้อมูลมีอยู่แล้วจาก `GET /ncr/:id`) — คนละตำแหน่งจากที่เดิมโชว์อยู่แล้วใน
ApprovalTimeline (ไม่ได้ลบของเดิม เพิ่มจุดแสดงที่สอง)

**Phase 3 (หมายเหตุแดง):** ข้อความ TH/EN คงที่ (ไม่ใช่ DB column — ข้อความเดียวกันทุกครั้ง) แสดงต่อ item เมื่อ
`ncr.disposition === 'return'` เท่านั้น

**Phase 4 (purchasing_manager gate — ส่วนสำคัญสุด):** ใช้ประโยชน์จาก `approveNcr()`'s generic transitions map
(ที่ qc_supervisor/qc_manager/qmr ใช้ร่วมกันอยู่แล้ว) เพิ่ม entry
`pending_purchasing_manager_review: { role: 'purchasing_manager', next: 'pending_supplier' }` — ได้ optimistic
lock/audit log/role-check ฟรีไม่ต้องเขียน endpoint ใหม่ `purchasingReview()` เปลี่ยนปลายทางจาก `pending_supplier`
เป็น `pending_purchasing_manager_review` (แจ้ง purchasing_manager แทนแจ้งว่า "พร้อมส่ง Supplier" ซึ่งยังไม่จริง) —
เพิ่ม branch ใหม่ `t.next === 'pending_supplier'` ใน `approveNcr()` เป็นจุดที่ "พร้อมส่ง Supplier" ตัวจริง (ย้าย
notification เดิมมาจาก `purchasingReview()`) `routes/ncr.js`'s `POST /:id/approve` เพิ่ม `'purchasing_manager'`
เข้า `requireRole` (ไม่เพิ่ม supplier-scoping ให้ role นี้ — ตรวจพบว่า `purchasingScope.js` ออกแบบไว้แล้วว่า
purchasing_manager ไม่ถูก scope ตาม supplier เหมือน purchasing ทั่วไป), `record-link-copy` ตัด
`pending_purchasing_review` ออกจาก allowed-status (ปิด gap เดิมที่ copy link ได้ตั้งแต่ก่อน review เสร็จด้วยซ้ำ);
frontend `canCopyLink`/`canApprove`/`approveLabel` อัปเดตตาม — ปุ่ม "อนุมัติ" เดิม (generic, ใช้ modal เดียวกับ
qc_supervisor/qmr) ใช้ได้ทันทีไม่ต้องสร้าง UI ใหม่ (ตรวจแล้ว disposition dropdown gate เฉพาะ `pending_manager`
ไม่รั่วมาสถานะใหม่)

**Phase 5 (Email infra + COO notification + CCO→COO label fix):** เพิ่ม `nodemailer@9.0.3` (0 vulnerability จาก
dependency tree ของตัวเอง, ตรวจก่อน commit) + `lib/mailer.js` (`sendEmail`, cached transporter, log-and-continue
ถ้า SMTP ไม่ครบ — เหมือน `sendTelegram` เป๊ะ) + `lib/ncrEmailTemplate.js` (HTML/plain-text template ของกล่อง
"ข้อมูล NCR" ใช้ทั้งอีเมลและ Telegram ส่วนตัว) + `purchasingScope.js`'s `getCooUsers()` (role `cco`, คืน
`email`/`telegram_chat_id` เต็ม) — ผูกเข้า `approveNcr()`'s `pending_supplier` branch: ส่ง email (ถ้ามี) +
forward Telegram ส่วนตัว (ถ้ามี) ให้ COO ทุกคน หัวเรื่องตรงตามที่ user ระบุเป๊ะ
("มีเอกสาร NCR สร้างใหม่ เลขที่ ... จำนวน x รายการ") `server/index.js` เพิ่ม
`GET/POST/POST-test /api/admin/settings/email` (mirror pattern เดียวกับ Telegram settings เป๊ะ,
`smtp_password` เข้ารหัสผ่าน `setSecretSetting` ต่างจาก Telegram token ที่เป็น plain write-only) + เพิ่ม `email`
เข้า 3 จุดของ Users routes (GET/POST/PATCH, เหมือน `telegram_chat_id`) — frontend: `Admin/Users.jsx` เพิ่มช่อง
"อีเมล" (form+table+mobile card), `Admin/Settings.jsx` เพิ่ม tab "Email" ใหม่ (mirror `TelegramTab` เป๊ะ รวม
show/hide password + placeholder `_set` + ปุ่มทดสอบส่ง) — แก้ label "CCO"→"COO" 9 จุด (`rolePermissions.js`
×2, `IssueTalk/index.jsx`, `IssueTalk/Detail.jsx`, `UAI/index.jsx`, `uaiService.js` ×2, `exports.js` ×2) **role
identifier `cco` ไม่แตะเลย** (ยังผูกอยู่กับ UAI exec sign-off flow เดิมทั้งหมด — เปลี่ยนแค่ label ที่ user เห็น)

**Test:** เพิ่ม fixture user `purmgr1` (role `purchasing_manager`, ไม่มี seed มาเป็นค่าเริ่มต้น — เหมือน
`purchasingScope.test.js` ทำไว้ก่อนหน้า) ใน `ncrUai.test.js`, แก้ NCR-09 (assert สถานะใหม่แทน `pending_supplier`
ตรงๆ) + เพิ่ม NCR-09b/09c (403 ก่อนอนุมัติ, 200 หลังอนุมัติ + link คัดลอกได้เฉพาะหลัง), เพิ่ม step
purchasing_manager approve ใน `walkToManagerReview`/UAI-01/RX-01 setup helper (fixture เดิมเดินสถานะเต็มเส้นทาง
ต้องผ่านขั้นใหม่ด้วย), เพิ่ม GROUP E ใหม่ (CV-01..05) คลุม claim value validation (400 ตอนขาด, 200 + persist
ตอนกรอกครบรวม `"-"`) + `product_code` join + `record-link-copy` gate; เพิ่ม `test/mailer.test.js` ใหม่ (4 เคส —
SMTP ไม่ครบ → no-op ไม่ throw, ครบ → ได้ transporter จริง) — `node --test` → **283/283 เขียว, 0 skip** (272
baseline + 11 เคสใหม่)

**Verify:** `npm run build` (client) ผ่านไม่มี error/warning ใหม่ (มีแค่ chunk-size warning เดิมที่ไม่เกี่ยวกับรอบนี้)
— ยังไม่ได้ verify ผ่าน Playwright ของจริง (ต่างจาก session ก่อนๆ ที่ verify ผ่าน UI จริงเสมอ) เพราะรอบนี้เป็นงาน
implementation ตามแผนที่ user อนุมัติแล้วผ่าน plan mode ไม่ใช่ debug-and-verify loop — แนะนำให้ QA/user ทดสอบ
flow เต็มจริงก่อน deploy: (1) จัดซื้อกรอกมูลค่าเคลม+EN แล้ว submit (2) ผู้จัดการจัดซื้ออนุมัติ (3) จัดซื้อ copy
link ได้ (4) ตั้งค่า SMTP จริง + อีเมล COO แล้วเช็คว่าอีเมล/Telegram ส่วนตัวส่งถึงจริง

### Files Changed

| File | สิ่งที่ทำ |
|---|---|
| `server/db/database.js` | + `claim_value_thb`/`usd`, `users.email`, `pending_purchasing_manager_review` ใน status Set, แก้ seed CCO→COO |
| `server/services/ncrService.js` | + `getFullNcrItems()`, `purchasingReview()` validate+เปลี่ยนปลายทาง, `approveNcr()` เพิ่ม transition+`pending_supplier` branch (link ready + COO notify) |
| `server/routes/ncr.js` | `GET /:id` ใช้ `getFullNcrItems`, `/approve` เพิ่ม `purchasing_manager`, `/record-link-copy` แก้ status guard |
| `server/lib/purchasingScope.js` | + `getCooUsers()` |
| `server/lib/mailer.js` | ใหม่ทั้งหมด — SMTP sender |
| `server/lib/ncrEmailTemplate.js` | ใหม่ทั้งหมด — HTML/text template อีเมล COO |
| `server/index.js` | + Email settings routes ×3, + `email` เข้า Users routes ×3 |
| `server/package.json` | + `nodemailer@^9.0.3` |
| `client/src/pages/NCR/Detail.jsx` | + claim value fields, product_code display, disposition block, red note, purchasing_manager approve/label/copy-link gate |
| `client/src/utils/rolePermissions.js` | + `pending_purchasing_manager_review` label, CCO→COO ×2 |
| `client/src/pages/Admin/Users.jsx` | + ช่องอีเมล (form/table/mobile) |
| `client/src/pages/Admin/Settings.jsx` | + tab "Email" ใหม่ |
| `client/src/pages/IssueTalk/{index,Detail}.jsx`, `UAI/index.jsx`, `server/services/uaiService.js`, `server/routes/exports.js` | CCO→COO label (9 จุดรวม) |
| `server/test/ncrUai.test.js` | + fixture `purmgr1`, แก้/เพิ่ม NCR-09*, GROUP E (CV-01..05) |
| `server/test/mailer.test.js` | ใหม่ทั้งหมด — 4 เคส |
| `CLAUDE.md` | §4 เพิ่มสถานะใหม่, §12 เพิ่มกฎ Email |

---

**รอบที่ 2 (S128b):** user รายงานต่อว่าที่หน้าจัดซื้อ (หน้าหลัก) NCR ของ supplier ที่ยังไม่ได้ตั้งผู้ดูแล (@ ผู้ดูแล)
ไม่ขึ้นในแท็บ "NCR/NCP ของฉัน" เลยสำหรับใครทั้งนั้น ต้องการให้ขึ้นให้จัดซื้อทุกคนเห็นด้วย

**สิ่งที่พบ:** `purchasingDashboardService.js`'s `scopeClause()` ใช้ `purchasingStrictAssignedSQL` (ไม่มี fallback
รวม supplier ที่ยังไม่มีผู้ดูแล) ร่วมกันทั้ง 3 ฟังก์ชัน — `getSuppliers`/`getSummary`/`getNcrList` — ความเข้มงวดนี้
ตั้งใจแก้ไว้ตั้งแต่ S125 เฉพาะสำหรับ "ผู้ผลิตของฉัน" (กัน bug เดิมที่เคยโชว์ supplier ที่ไม่มีผู้ดูแลปนกันหมด) แต่ดัน
กระทบ `getNcrList`/`getSummary` ไปด้วยเพราะใช้ scope function เดียวกัน ทำให้ NCR ของ supplier ที่ยังไม่มีผู้ดูแลไม่มี
ใครเห็นเลยใน "NCR/NCP ของฉัน" — ต่างจากหน้า `/ncr` หลัก และ UAI list ที่มี fallback (`purchasingVisibilitySQL`)
อยู่แล้วให้ทุกคนเห็น — **ถาม `AskUserQuestion` 2 ข้อก่อนแก้** เพราะกระทบตัวเลข KPI การ์ดด้านบนด้วย: (1) ต้องแก้ตัวเลข
สรุป KPI (การ์ดบนสุด) ให้ตรงกับ list ด้วยไหม — user เลือก **"แก้ทั้งคู่ให้ตรงกัน"** (2) "ผู้ผลิตของฉัน" อีก tab ที่ใช้
scope เข้มงวดเหมือนกัน ต้องแก้ด้วยไหม — user เลือก **"คงพฤติกรรมเดิม"** (ตรงกับ Master List assignment เป๊ะๆ)

**การแก้:** `scopeClause(user, supplierIdExpr, { includeUnassigned })` เพิ่ม option ใหม่ — `includeUnassigned:
true` สลับไปใช้ `purchasingVisibilitySQL` (มี fallback) แทน `purchasingStrictAssignedSQL` เฉพาะตอนเรียกจาก
`getNcrList` และ (เฉพาะส่วน NCR count queries ของ) `getSummary` — ส่วน `supplier_count` ใน `getSummary` ยังคงเรียก
scope แบบเข้มงวดแยกต่างหาก (จับคู่กับ "ผู้ผลิตของฉัน" ที่คงพฤติกรรมเดิม) ไม่ให้ตัวเลขพอง `getSuppliers` ไม่แตะเลย —
ผลพลอยได้: PDF export ("รายการเกินกำหนด" ใน `/purchasing-dashboard/pdf`) ก็เห็น NCR ของ supplier ไม่มีผู้ดูแลด้วย
โดยอัตโนมัติเพราะเรียก `getNcrList` เดียวกัน (ไม่ต้องแก้แยก)

**Test:** แก้ `purchasingDashboard.test.js` — DASH-02/03 (`ncr_waiting_review` รวม `supOpen` แล้ว, `supplier_count`
ยังเข้มงวดเหมือนเดิม), DASH-07 (`total` เป็น 2 รวม `supOpen`, เช็ค supplier_id ทั้งคู่แทนสมมติ order) — DASH-04/05/06
(purchasing_manager/getSuppliers) ไม่ต้องแก้เพราะพฤติกรรมเดิม — `node --test` → **283/283 เขียว** (ไม่มีเคสใหม่ แก้แค่
assertion เดิมให้ตรงพฤติกรรมใหม่)

**Verify:** ยังไม่ได้ verify ผ่าน Playwright จริง — แนะนำให้ทดสอบ: seed supplier ที่ไม่มีผู้ดูแล + NCR อย่างน้อย 1 ใบ
แล้ว login เป็น purchasing คนใดก็ได้ (ที่ไม่ใช่ผู้ดูแล supplier นั้น) เช็คว่าเห็นใน "NCR/NCP ของฉัน" + ตัวเลข KPI
การ์ดด้านบนตรงกับจำนวนแถวใน list

### Files Changed (รอบที่ 2)

| File | สิ่งที่ทำ |
|---|---|
| `server/services/purchasingDashboardService.js` | `scopeClause()` เพิ่ม `includeUnassigned` option, ใช้กับ `getSummary` (NCR counts เท่านั้น)/`getNcrList` |
| `server/test/purchasingDashboard.test.js` | แก้ DASH-02/03/07 assertion ให้ตรงพฤติกรรมใหม่ |

---

**รอบที่ 3 (S128c):** user ขอเพิ่มปุ่ม "ไม่อนุมัติ" ให้ผู้จัดการจัดซื้อที่ขั้น `pending_purchasing_manager_review` —
ถ้าไม่อนุมัติให้ย้อนกลับไปที่จัดซื้อ Review ใหม่อีกครั้ง (เดิมมีแค่ปุ่ม "อนุมัติ" ทางเดียว ไม่มีทางส่งกลับ)

**การแก้:** มิเรอร์ pattern เดียวกับ "QC Manager ไม่อนุมัติคำตอบ Supplier" (`rejectSupplierResponse`) ที่มีอยู่แล้ว
เป๊ะๆ — เพิ่ม `ncrService.js`'s `rejectPurchasingManagerReview({ ncr, comment, actorId, actorIp })`
(`pending_purchasing_manager_review → pending_purchasing_review`, บันทึก `ncr_approvals` action
`rejected_purchasing_review`, แจ้งเตือนจัดซื้อ + telegram กลุ่มจัดซื้อ, audit log) **ไม่ล้างค่า
`claim_value_thb`/`usd`/EN translation ที่กรอกไว้แล้ว** เพื่อให้จัดซื้อแก้ไขต่อได้ไม่ต้องกรอกใหม่ทั้งหมด —
`routes/ncr.js` เพิ่ม `POST /:id/reject-purchasing-review` (`requireRole(['purchasing_manager'])`, บังคับ status
`pending_purchasing_manager_review` + comment) — frontend `Detail.jsx` เพิ่ม state/mutation/ปุ่ม "ไม่อนุมัติ"
(`canRejectPurchasingReview`) คู่กับปุ่ม "อนุมัติ" เดิม + modal ใหม่ (มิเรอร์ modal เดิมของ QC Manager) — เผื่อจับได้
ระหว่างแก้: `getProcessLabel()` ใน `ApprovalTimeline` ไม่เคยมี case ให้ role `purchasing_manager` เลย (ทั้งตอน
อนุมัติปกติและไม่อนุมัติ) จะ fallback ไปโชว์ raw string `"purchasing_manager"` ในไทม์ไลน์ — เป็น gap ที่ค้างมาตั้งแต่
S128 ตอนเพิ่ม step นี้ครั้งแรก แก้พร้อมกันในรอบนี้ (เพิ่ม label ทั้งกรณีอนุมัติ/ไม่อนุมัติ)

**Test:** เพิ่ม CV-06..09 ใน `ncrUai.test.js` ต่อจาก GROUP E เดิม — 403 สำหรับ qc_manager/purchasing, 400 เมื่อไม่ใส่
เหตุผล, ไม่อนุมัติแล้วกลับไป `pending_purchasing_review` พร้อมยืนยันค่าที่กรอกไว้ไม่ถูกล้าง, จัดซื้อ Review ใหม่
อีกครั้งแล้ว manager อนุมัติผ่านจนถึง `pending_supplier` ได้จริง (full round-trip) — `node --test` → **287/287
เขียว** (283 + 4 เคสใหม่)

**Verify:** `npm run build` (client) ผ่านไม่มี error — ยังไม่ได้ verify ผ่าน Playwright จริง แนะนำทดสอบ: purchasing
review NCR → purchasing_manager กด "ไม่อนุมัติ" พร้อมเหตุผล → เช็คว่า badge สถานะกลับเป็น "รอจัดซื้อ Review" +
ปุ่ม "Review" กลับมาให้จัดซื้อกดอีกครั้ง + ค่าที่กรอกไว้เดิมยังอยู่ในฟอร์ม + ไทม์ไลน์แสดง "ผู้จัดการจัดซื้อไม่อนุมัติ
Review" สีแดงพร้อมเหตุผล

### Files Changed (รอบที่ 3)

| File | สิ่งที่ทำ |
|---|---|
| `server/services/ncrService.js` | + `rejectPurchasingManagerReview()` |
| `server/routes/ncr.js` | + `POST /:id/reject-purchasing-review` |
| `client/src/pages/NCR/Detail.jsx` | + ปุ่ม/modal "ไม่อนุมัติ" สำหรับ purchasing_manager, แก้ `getProcessLabel()` เพิ่ม label ให้ role `purchasing_manager` (ทั้งอนุมัติ/ไม่อนุมัติ) |
| `server/test/ncrUai.test.js` | + CV-06..09 |

---

**รอบที่ 4 (S128d):** user ขอให้หน้า Supplier Response (ตอบกลับ NCR — public, ไม่ auth) เพิ่ม (1) รหัสสินค้าต่อท้าย
ชื่อสินค้า เหมือนหน้าภายใน (2) รายละเอียดผลการพิจารณาว่า "return supplier" (3) หมายเหตุแดง "ตีกลับสินค้า 100%
เนื่องจากไม่ผ่านมาตรฐานการสุ่มตรวจ / 100% product return — failed the sampling inspection standard" เหมือนหน้า
ภายใน — **ข้อสังเกต:** หน้านี้คือหน้าเดียวกับที่ตกลงไว้ตอน S128 ว่า "ไม่แตะ" (เฉพาะหน้าภายในเท่านั้น) แต่รอบนี้ user
ขอตรงๆ ให้เพิ่มที่หน้านี้เอง จึงทำตามคำขอใหม่ (ไม่ใช่การตีความขยายขอบเขตเอง)

**สิ่งที่พบ:** `routes/supplier.js`'s `GET /ncr/:token` มี query ของตัวเองแยกจาก `ncrService.getFullNcrItems()` (ที่
หน้าภายในใช้) — เดิม `SELECT ni.*, dc.name ...` ไม่ join `products` เลยจึงไม่มี `product_code`; ส่วน `disposition`/
`disposition_note`/`disposition_due_date` มีอยู่แล้วในเพย์โหลด (คอลัมน์ตรงบน `ncrs`, query header ใช้ `SELECT n.*`
อยู่แล้ว) เพียงแต่ frontend ไม่เคยอ่านมาแสดง — **จุดที่ต้องระวัง:** `ni.*` เดิมของ route นี้ (ก่อนแก้) ก็คืน
`claim_value_thb`/`claim_value_usd` (มูลค่าเคลมภายใน, เพิ่มจาก S128) ออกไปให้ Supplier อยู่แล้วโดยไม่ตั้งใจ (แค่
frontend ไม่เคยอ่านมาโชว์) — ถือเป็น info-leak เล็กๆ ที่ต้องปิดพร้อมกันตอนแก้ query นี้ ไม่ใช่แค่เพิ่ม
`product_code` เฉยๆ

**การแก้:** `routes/supplier.js` เปลี่ยน items query จาก `ni.*` เป็น**ระบุคอลัมน์ชัดเจนทีละตัว** (ไม่รวม
`claim_value_thb`/`usd`) + เพิ่ม `LEFT JOIN bill_items→products` ดึง `product_code` (เหมือน
`getFullNcrItems` แต่แยก query ของตัวเอง ไม่ reuse ตรงๆ เพราะต้อง whitelist คอลัมน์ต่างกัน) — frontend
`NCRResponse.jsx` (หน้านี้เป็น bilingual EN/TH ทั้งหน้า ต่างจากหน้าภายในที่เป็นไทยล้วน) เพิ่ม `DISPOSITION_LABELS`
map แบบสองภาษาในตัวเอง (local const ใหม่ — ของหน้าภายในเป็น local const ไม่ได้ export ใช้ร่วมไม่ได้), แสดงแถว
"Disposition / ผลการพิจารณา" ใน "NCR Information" card เมื่อ `ncr.disposition` มีค่า, แสดงรหัสสินค้าต่อท้ายชื่อ
สินค้าต่อ item, และหมายเหตุแดง (ข้อความ EN ขึ้นก่อน TH ตามลำดับภาษาที่หน้านี้ใช้ทั้งหน้า) เมื่อ
`ncr.disposition === 'return'` — เงื่อนไขเดียวกับหน้าภายในเป๊ะ

**Test:** เพิ่ม CV-10 ใน `ncrUai.test.js` — เรียก `GET /api/supplier/ncr/:token` จริงของ NCR ที่มี disposition=return
(ใช้ ncrE เดิมจาก GROUP E ที่เดินไปถึง `pending_supplier` แล้วใน CV-09) ยืนยัน `product_code`/`disposition` มาครบ
และ `claim_value_thb`/`usd` เป็น `undefined` (ไม่รั่วออกไป) — `node --test` → **288/288 เขียว**

**Verify:** `npm run build` (client) ผ่าน — ยังไม่ได้ verify ผ่าน Playwright จริง แนะนำเปิดลิงก์ supplier ของ NCR ที่มี
disposition=return จริง เช็คว่าเห็นรหัสสินค้า/แถว Disposition/กล่องแดงครบ และเช็ค Network tab ว่า response ไม่มี
`claim_value_thb`/`usd` ติดมาด้วย

### Files Changed (รอบที่ 4)

| File | สิ่งที่ทำ |
|---|---|
| `server/routes/supplier.js` | items query: whitelist คอลัมน์ (ตัด claim_value ออก) + join `products` ได้ `product_code` |
| `client/src/pages/Supplier/NCRResponse.jsx` | + `DISPOSITION_LABELS` (bilingual), แถว disposition, รหัสสินค้าต่อชื่อสินค้า, หมายเหตุแดง (return only) |
| `server/test/ncrUai.test.js` | + CV-10 |

---

**รอบที่ 5 (S128e) — บั๊ก:** user ตั้งค่า SMTP (Gmail, `windowasiaqc@gmail.com`, port 587, TLS/SSL ปิด) แล้วกด
"ทดสอบส่งอีเมล" ได้ข้อความ "ส่งอีเมลทดสอบไปที่ ... แล้ว" (สีเขียว, ok) แต่อีเมลไม่เข้าจริง

**Root cause:** `lib/mailer.js`'s `sendEmail()` (เขียนตอน S128) จับ error จาก `transporter.sendMail()` แล้ว
`console.error` เฉยๆ ไม่ throw/ไม่คืนผลลัพธ์อะไรกลับเลย (`try { await sendMail(...) } catch (e) { console.error(...) }`
จบแค่นั้น) — ตั้งใจให้เป็น fire-and-forget สำหรับจุดแจ้งเตือน COO (ห้าม throw กระทบ transaction NCR หลัก ตาม
CLAUDE.md §12) แต่ปุ่ม **"ทดสอบส่งอีเมล"** ที่ `server/index.js`'s `/api/admin/settings/email/test` เรียกใช้ตัวเดียวกัน
แล้ว `await` เฉยๆ ไม่เช็คอะไรต่อ จึงตอบ `{ ok: true }` เสมอไม่ว่า SMTP จะสำเร็จจริงหรือไม่ — เป็น bug จริง (ไม่ใช่
ปัญหาการตั้งค่า SMTP ของ user) ที่ทำให้ผลทดสอบไม่มีความหมายเลยตั้งแต่ S128

**การแก้:** `sendEmail()` เปลี่ยนให้คืน `{ ok, error? }` เสมอ (ยังไม่ throw — fire-and-forget call site เดิม
(`ncrService.js`'s COO notify) ยังปลอดภัย ไม่ต้องแก้) — `/api/admin/settings/email/test` เช็ค `result.ok` แล้วตอบ
500 พร้อม error message จริงจาก nodemailer ถ้าส่งไม่สำเร็จ แทนที่จะตอบ 200 เสมอ

**สาเหตุที่เป็นไปได้มากที่สุดสำหรับ Gmail โดยเฉพาะ (ยังไม่ยืนยันได้จริงเพราะไม่มีสิทธิ์เข้าบัญชี Gmail ของ user):**
Gmail ปิดการล็อกอินด้วยรหัสผ่านบัญชีปกติผ่าน SMTP มาตั้งแต่ปี 2022 (less secure apps) — ต้องเปิด 2-Step
Verification แล้วสร้าง **App Password** (16 ตัวอักษร, Google Account → Security → App Passwords → เลือก "Mail")
มาใช้แทนรหัสผ่านจริงในช่อง SMTP Password — ถ้ากรอกรหัสผ่านบัญชีปกติจะ auth fail แต่เงียบเพราะบั๊กข้างต้น ส่วน
Host/Port/TLS ที่ตั้งไว้ (`smtp.gmail.com`, 587, TLS/SSL ปิด) ถูกต้องแล้ว (port 587 ใช้ STARTTLS อัตโนมัติ ไม่ต้อง
เปิด toggle) — หลังแก้บั๊กแล้ว ให้กดทดสอบอีกครั้งจะเห็น error message จริงจาก Gmail ถ้ายังไม่สำเร็จ (เช่น
`Invalid login: 535-5.7.8 Username and Password not accepted`)

**Test:** แก้ `mailer.test.js`'s MAIL-02/03 ให้เช็ค return shape `{ ok: false, error }` จริง (regression guard กัน
บั๊กนี้กลับมา) — `node --test` → **288/288 เขียว**

**Verify:** ยังไม่ได้ verify กับ Gmail จริง (ไม่มีสิทธิ์เข้าบัญชี) — แนะนำ user restart server (หรือรอ nodemon
auto-reload ถ้ารัน `npm run dev`) แล้วกด "ทดสอบส่งอีเมล" อีกครั้งเพื่อดู error message จริง

### Files Changed (รอบที่ 5)

| File | สิ่งที่ทำ |
|---|---|
| `server/lib/mailer.js` | `sendEmail()` คืน `{ ok, error? }` แทนกลืน error ทิ้งเงียบๆ |
| `server/index.js` | `/api/admin/settings/email/test` เช็ค `result.ok` ก่อนตอบ 200 |
| `server/test/mailer.test.js` | แก้ MAIL-02/03 ให้เช็ค return shape จริง |

---

**รอบที่ 6 (S128f) — บั๊ก:** SMTP ใช้งานได้แล้วจริง (Gmail app password ผ่านหลังรอบที่ 5) แต่ user รายงานว่าอีเมล COO
ที่ได้รับจริง หัวเรื่องขึ้น "NCR-2026-0005 (undefined)" และเนื้อหาช่อง "ผู้ผลิต:" ว่างเปล่า

**Root cause:** ระหว่างช่วยดีบัก SMTP (รอบที่ 5) พบว่า container `iqc-local` ที่รันอยู่จริงบนเครื่อง user
(`docker ps` เจอ, ฟัง port 3001) ใช้ **DB คนละไฟล์กับที่อ่านจาก host โดยตรง** — `docker-compose.local.yml` mount
named volume `iqc_local_data:/data` แยกจาก `iqc-system/iqc.db` บน host (ตามที่ตั้งใจไว้ตั้งแต่ S119 กัน DB corrupt)
จึงต้อง `docker exec` เข้าไปอ่าน/ทดสอบค่า config จริงแทนการอ่านไฟล์ host ตรงๆ (เขียน diagnostic script รันผ่าน
`docker exec iqc-local node -e "..."` เรียก `db.getSetting`/`transporter.verify()` ตรงๆ ไม่ผ่าน UI — **ระวังไม่พิมพ์
เนื้อหา/ความยาว/ตัวอักษรของ password ออกมาเลย** เพราะ auto mode classifier บล็อกแล้วครั้งหนึ่งตอนพิมพ์ length +
first/last char ของ password ออกมา ถูกต้องแล้วที่บล็อก — แก้ script ให้เช็คแค่ `!!pass` ไม่พิมพ์เนื้อหาเลย) —
ยืนยัน SMTP auth สำเร็จจริงหลัง user สร้าง app password ใหม่ (ของเก่าถูก revoke เพราะเคย paste ลง chat)

เมื่อ SMTP ทำงานจริงแล้ว บั๊กที่ 2 โผล่ตาม: `ncrService.js`'s `approveNcr()` (`pending_supplier` branch, S128)
เขียน `${ncr.supplier_name}` ลงหัวเรื่องอีเมลตรงๆ — แต่ `ncr` object ที่ `approveNcr()` ได้รับมาจาก
`routes/ncr.js`'s `POST /:id/approve` คือผลลัพธ์ของ `SELECT * FROM ncrs WHERE id = ?` **เปล่าๆ ไม่ join
bills/suppliers เลย** (ต่างจาก `GET /api/ncr/:id` ที่ join เต็ม) — `ncr.supplier_name` จึงเป็น `undefined` เสมอ
ไม่ว่า NCR ไหน — **เทสเดิม (S128) จับบั๊กนี้ไม่ได้เพราะ seed user `cco1` ไม่มี `email` ตั้งไว้** เงื่อนไข
`if (coo.email)` ใน `approveNcr()` เลย skip การเรียก `sendEmail`/`buildNcrInfoHtml` ทั้งหมดเงียบๆ ทุกเทสที่ผ่านมา —
โค้ด build อีเมลจริงไม่เคยถูกรันเลยสักครั้งในเทสจนกระทั่ง user ทดสอบผ่าน UI จริงเป็นคนแรก

**การแก้:** ใน `pending_supplier` branch เพิ่ม query เล็กๆ ดึง `supplier_name` จาก `bills→suppliers` ตรงด้วย
`ncr.bill_id` แล้วประกอบเป็น `ncrWithSupplier = { ...ncr, supplier_name }` ใช้แทน `ncr` ตรงๆ ทั้งใน subject line
และที่ส่งเข้า `buildNcrInfoHtml`/`buildNcrInfoText` (ฟิลด์อื่นที่ template ต้องการ เช่น `invoice_no`/`po_no`/
`disposition` เป็นคอลัมน์ตรงบน `ncrs` อยู่แล้ว ไม่ต้อง join เพิ่ม มีแค่ `supplier_name` ตัวเดียวที่ขาด)

**Test:** เพิ่ม CV-11 ใน `ncrUai.test.js` — ตั้ง `email` ให้ `cco1` จริง + mock `nodemailer.createTransport` (ไม่ยิง
network จริง) เดิน NCR ใหม่ทั้งเส้นทางจนถึง purchasing_manager อนุมัติ แล้ว assert ว่า subject/html ที่ capture ได้
**ไม่มีคำว่า "undefined"** และมีชื่อผู้ผลิตจริง ("ผู้ผลิตทดสอบ") ปรากฏอยู่ — เป็น regression test ตัวแรกที่ครอบ
โค้ด build อีเมล COO จริงๆ (เทสเดิมทั้งหมดไม่เคยครอบเพราะ email ไม่ได้ตั้งไว้) — ต้องเพิ่ม
`process.env.SETTINGS_ENCRYPTION_KEY` ที่หัวไฟล์ด้วย (ต้องมีก่อนเรียก `setSecretSetting`) — `node --test` →
**289/289 เขียว**

**Verify:** ยืนยันกับ user จริงแล้วว่าอีเมลส่งถึงจริง (รอบที่ 5) — รอ user ยืนยันรอบนี้ว่าหัวเรื่อง/เนื้อหาแสดงชื่อ
ผู้ผลิตถูกต้องแล้วหลัง deploy โค้ดที่แก้

### Files Changed (รอบที่ 6)

| File | สิ่งที่ทำ |
|---|---|
| `server/services/ncrService.js` | `pending_supplier` branch: query `supplier_name` เพิ่มก่อนสร้างอีเมล COO |
| `server/test/ncrUai.test.js` | + `SETTINGS_ENCRYPTION_KEY` env, + CV-11 (regression test ครอบโค้ด build อีเมล COO เป็นครั้งแรก) |

---

**รอบที่ 7 (S128g):** user ขอตัดคำนำหน้าหัวเรื่องอีเมล COO ออก — จาก "มีเอกสาร NCR สร้างใหม่ เลขที่ NCR-2026-0006
(Foshan Fengziyu Home Co., Ltd) จำนวน 1 รายการ" เหลือแค่ "NCR-2026-0006 (Foshan Fengziyu Home Co., Ltd) จำนวน 1
รายการ" — แก้ `subject` template literal ใน `approveNcr()`'s `pending_supplier` branch บรรทัดเดียว (ตัด "มีเอกสาร
NCR สร้างใหม่ เลขที่ " ออก) — CV-11 เดิม (assert แค่ "ไม่มี undefined" + "มีชื่อผู้ผลิต") ไม่กระทบ ยังผ่านเหมือนเดิม
— `node --test` → **289/289 เขียว**

### Files Changed (รอบที่ 7)

| File | สิ่งที่ทำ |
|---|---|
| `server/services/ncrService.js` | ตัดคำนำหน้าหัวเรื่องอีเมล COO |

---

**รอบที่ 8 (S128h):** user ขอให้คำแปลภาษาอังกฤษที่จัดซื้อกรอกใน Purchasing Review modal แสดงในฟอร์ม NCR-2026-0007
(หน้า "ข้อมูล NCR" หลัก) ด้วย เพื่อให้ผู้จัดการจัดซื้อเห็น/ตรวจสอบความถูกต้องได้ก่อนอนุมัติ

**สิ่งที่พบ:** `item_name_en`/`defect_detail_en` ถูก `GET /api/ncr/:id` ส่งมาอยู่แล้ว (`getFullNcrItems`'s
`SELECT ni.*` รวมทั้งคู่) แต่ `Detail.jsx`'s item block ไม่เคยเอามาแสดงเลย — โชว์แค่ในตอน compose (Review modal)
ตอนกำลังกรอกเท่านั้น พอ submit แล้วปิด modal ไปคำแปลก็หายไปจากมุมมองทันที ไม่มีที่ไหนให้ purchasing_manager (ที่ดู
หน้าเดียวกันตอนจะอนุมัติ) เห็นคำแปลที่กรอกไว้แล้วเลย

**การแก้ (frontend เท่านั้น ไม่มี backend เปลี่ยน):** เพิ่มใน item block ของ "ข้อมูล NCR": (1) `item.item_name_en`
แสดงเป็นบรรทัดย่อยตัวเอียงใต้ชื่อสินค้า (ไทย) + รหัสสินค้า (2) `item.defect_detail_en` แสดงต่อจาก
`defect_detail` (ไทย) ในบล็อกเดียวกัน — ทั้งคู่แสดงแบบมีเงื่อนไข (แสดงเฉพาะเมื่อมีค่า คือหลัง Review เสร็จแล้ว
เท่านั้น) เข้าถึงได้ทุก role ที่ดูหน้านี้อยู่แล้ว (qc_staff/supervisor/manager/qmr/purchasing/purchasing_manager)
ไม่ต้องเพิ่ม role gate ใหม่

**Test:** ไม่มีการเปลี่ยน backend/logic — `npm run build` (client) ผ่าน, `node --test` (server) → **289/289 เขียว**
(ไม่กระทบ)

**Verify:** ยังไม่ได้ verify ผ่าน Playwright จริง — แนะนำเปิด NCR ที่ผ่าน Purchasing Review แล้วเช็คว่าเห็นบรรทัด
"EN: ..." ใต้ชื่อสินค้า และ "รายละเอียด (EN): ..." ใต้รายละเอียดภาษาไทย

### Files Changed (รอบที่ 8)

| File | สิ่งที่ทำ |
|---|---|
| `client/src/pages/NCR/Detail.jsx` | แสดง `item_name_en`/`defect_detail_en` ใน item block ของ "ข้อมูล NCR" |

---

**รอบที่ 9 (S128i):** user ขอให้หลัง purchasing_manager อนุมัติแล้ว สถานะเอกสารขึ้นเป็น "รอส่ง Link ให้ Supplier"
ก่อน แล้วค่อยเปลี่ยนเป็น "รอ Supplier ตอบ" ก็ต่อเมื่อจัดซื้อกด Copy Link แล้วจริงๆ (เดิม badge ขึ้น "รอ Supplier"
ทันทีที่ manager อนุมัติ ทั้งที่ยังไม่ได้ copy link เลย)

**สิ่งที่พบ:** `ncrs.status` จริงเป็น `pending_supplier` **สถานะเดียว** ครอบคลุมทั้ง 2 ช่วง (ไม่มี status แยกใน DB
สำหรับ "ยังไม่ copy link" กับ "copy link แล้ว") — แต่มีคอลัมน์ `link_copied_at` อยู่แล้วที่ set ตอนกด Copy Link
พอดี ตรงกับที่ต้องใช้แยก 2 ช่วงนี้ทุกประการ (Purchasing Dashboard's `BUCKET_CASE` ก็ใช้ตรรกะเดียวกันนี้แบ่ง
`waiting_send_link`/`waiting_supplier_response` อยู่แล้วในหน้า dashboard — แค่ badge หน้า NCR เองไม่เคยเอามาใช้)

**การแก้ (frontend เท่านั้น — ไม่แตะ backend/status จริงใน DB เลย):** เพิ่ม `ncrDisplayStatusKey(ncr)` ใน
`rolePermissions.js` — คืน key เสมือน `pending_supplier_link` เมื่อ `status==='pending_supplier' &&
!link_copied_at`, ไม่งั้นคืน `status` เดิม — เพิ่ม `STATUS_LABELS.pending_supplier_link` ("รอส่ง Link ให้
Supplier") และแก้ label เดิมของ `pending_supplier` จาก "รอ Supplier" เป็น **"รอ Supplier ตอบ"** ให้ชัดเจนขึ้นว่า
เป็นช่วงหลัง copy link แล้ว — เปลี่ยน `<Badge status={ncr.status}/>` เป็น
`<Badge status={ncrDisplayStatusKey(ncr)}/>` ทั้งใน `NCR/Detail.jsx` (หน้าเอกสาร) และ `NCR/index.jsx` (หน้า list,
ทั้ง mobile card + desktop table) — **ขอบเขตตั้งใจไม่แตะ**: filter dropdown ใน `NCR/index.jsx` (ยังกรองด้วย
status จริง `pending_supplier` เป็น umbrella term เดิม), Reports summary card, Bills index tag, Dashboard
funnel chart labels — เป็น aggregate/filter context ไม่ใช่ per-document badge ที่ user หมายถึง ("เอกสาร")
Purchasing Dashboard ไม่ต้องแก้เพราะมี bucket แยกถูกต้องอยู่แล้วตั้งแต่เดิม

**Action permission ทุกจุด (canRequestUAI/canCopyLink ฯลฯ) ไม่กระทบเลย** เพราะยังเช็ค `ncr.status ===
'pending_supplier'` ตรงๆ เหมือนเดิมทุกที่ — เปลี่ยนแค่ตัวที่ส่งเข้า `<Badge/>` เพื่อแสดงผลเท่านั้น ไม่ใช่ค่าที่ตรวจ
สิทธิ์จริง

**Test:** ไม่มีการเปลี่ยน backend/status — `npm run build` (client) ผ่าน, `node --test` (server) → **289/289
เขียว** (ไม่กระทบ, เป็น frontend display-only)

**Verify:** ยังไม่ได้ verify ผ่าน Playwright จริง — แนะนำ: NCR ที่ purchasing_manager เพิ่งอนุมัติ (ยังไม่ copy
link) badge ควรขึ้น "รอส่ง Link ให้ Supplier" สีฟ้าอมเขียว (cyan) ทั้งในหน้า list และหน้าเอกสาร → กด "คัดลอก Link
Supplier" แล้ว badge เปลี่ยนเป็น "รอ Supplier ตอบ" ทันที (ไม่ต้องรีเฟรชถ้า query invalidate ถูกต้องอยู่แล้ว)

### Files Changed (รอบที่ 9)

| File | สิ่งที่ทำ |
|---|---|
| `client/src/utils/rolePermissions.js` | + `ncrDisplayStatusKey()`, + `STATUS_LABELS.pending_supplier_link`, แก้ label `pending_supplier` |
| `client/src/pages/NCR/Detail.jsx` | Badge ใช้ `ncrDisplayStatusKey(ncr)` แทน `ncr.status` ตรงๆ |
| `client/src/pages/NCR/index.jsx` | Badge (mobile card + desktop table) ใช้ `ncrDisplayStatusKey(n)` แทน `n.status` ตรงๆ |

---

**รอบที่ 10 (S128j):** user ขอให้หน้า Supplier Response (`NCR-2026-0007`) ไม่ต้องตามโหมดมืดของผู้ใช้ — ให้สว่างเสมอ

**สิ่งที่พบ:** หน้านี้ public ไม่ auth ผู้ผลิตภายนอกเห็น — ใช้ semantic token เดิม (`bg-surface`/`text-text`/`.card`
ฯลฯ ที่สลับสีตาม CSS variable `--color-x` ใน `index.css` ซึ่งเปลี่ยนค่าตาม class `.dark` บน `<html>`) ผสมกับ raw
Tailwind class ที่มี `dark:` variant ตรงๆ อีก 8 จุด (`dark:bg-red-900` ฯลฯ) — ถ้าพนักงานที่ copy link ให้ผู้ผลิต
ตั้ง dark mode ไว้ที่บัญชีตัวเอง หน้านี้จะ**ไม่**มืดตามเพราะเป็นคนละ browser/session ของผู้ผลิต — แต่ประเด็นคือ
ทฤษฎีนี้เข้าใจผิด: dark mode เก็บใน `localStorage` ต่อ browser (`iqc_theme_preference`) ไม่ใช่ต่อ user account
ดังนั้นถ้าผู้ผลิตเปิดลิงก์บน browser ที่เคย set dark mode ไว้ (เช่น เปิดจากเครื่องเดียวกับพนักงาน หรือ browser
ของตัวเองที่เคยเข้าหน้าอื่นของระบบแล้วตั้งไว้) หน้านี้ก็จะมืดตามไปด้วยจริง — ตรงกับที่ user สังเกตเห็น

**การแก้:** สร้าง class ใหม่ `.theme-light-only` ใน `index.css` (copy ค่า `:root` เดิมทั้ง 10 ตัวแปรสี) —
override ตัวแปรสีกลับเป็น light เสมอสำหรับ subtree ที่ครอบ (custom property ที่ set ใหม่บน descendant ชนะค่าจาก
`.dark` ของ `<html>` ที่อยู่สูงกว่าเสมอ ตามกลไก CSS cascade ปกติ) ใส่ class นี้ที่ wrapper `div.min-h-screen`
ทั้ง 4 จุดใน `NCRResponse.jsx` (loading/not-found/submitted/ฟอร์มหลัก) — แต่ CSS variable override นี้แก้ได้แค่
semantic token เท่านั้น **ไม่ช่วย raw `dark:` utility class** (คนละกลไกกัน — Tailwind compile เป็น
`.dark .dark\:bg-red-900{...}` ตรงๆ ไม่ผ่านตัวแปร) จึงต้องตัด `dark:` variant ออกจาก JSX ตรงๆ อีก 8 จุดด้วย
(เหลือแค่สี base เดิม เช่น `bg-red-50 dark:bg-red-900` → `bg-red-50`)

**Test:** ไม่มีการเปลี่ยน backend เลย — `npm run build` (client) ผ่าน, `node --test` (server) → **289/289 เขียว**
(ไม่กระทบ)

**Verify:** ยังไม่ได้ verify ผ่าน Playwright จริง — แนะนำ: ตั้ง `localStorage.iqc_theme_preference='dark'` แล้วรี
โหลดหน้า supplier response เช็คว่ายังคงสว่างเหมือนเดิมทุกส่วน (การ์ด/ปุ่ม/กล่องแดง) ไม่มีส่วนไหนมืดตาม

**บั๊กที่พบตามมาทันที (แก้ในรอบเดียวกัน):** user ส่ง screenshot จริงหลังแก้ — พื้นหลังสว่างถูกต้องแล้ว แต่ตัวหนังสือ
ค่าข้อมูล (Invoice No./PO No./Supplier/Disposition/คำแปลอังกฤษ ฯลฯ) จางมากจนมองแทบไม่เห็นบนพื้นขาว

**Root cause:** `.theme-light-only` ที่แก้ไว้ override แค่ CSS **custom property** (`--color-text` ฯลฯ) แต่
`body { @apply text-text }` ใน `index.css`'s `@layer base` set `color` (property จริง ไม่ใช่ variable) ไว้ที่
`<body>` ซึ่งอยู่ "เหนือ" `.theme-light-only` div (แค่ห่อ subtree ข้างในหน้า ไม่ใช่ทั้ง body) — ตอน `.dark` ยังอยู่บน
`<html>`, `body`'s `color` ถูก resolve เป็นค่าสว่างเกือบขาว (โหมดมืดใช้ text สีอ่อนบนพื้นเข้ม) แล้ว **สืบทอดเป็นค่า
คงที่ลงมา** — element ใดๆ ที่ไม่มี Tailwind text-color class ของตัวเอง (เช่น `<div className="font-mono
font-medium">{ncr.invoice_no}</div>` ที่ไม่มี `text-*` เลย) จะรับค่าที่สืบทอดมานี้ตรงๆ ไม่ได้คำนวณใหม่จากตัวแปรที่
override ไว้ (custom property ≠ inherited computed color — คนละกลไกอีกแล้ว)

**การแก้:** เพิ่ม `color: rgb(31 41 55);` (ค่า light ของ `--color-text`) ตรงๆ ใน `.theme-light-only` เอง (ไม่ใช่แค่
ตัวแปร) — เพราะ `color` เป็น inherited property ตัว element ลูกที่ไม่มี text class ของตัวเองจะรับค่านี้ต่อแทนค่าที่
เคย resolve มาจาก `<body>`

**Test:** `npm run build` (client) ผ่าน — ไม่แตะ backend

**Verify:** ยังไม่ได้ verify ผ่าน Playwright จริง (ผู้ใช้ verify ผ่าน screenshot จริงเป็นหลักรอบนี้) — แนะนำเช็คซ้ำ
อีกครั้งหลัง deploy ว่าตัวเลข/ข้อความค่าข้อมูลอ่านชัดเจนแล้วบนพื้นขาว ไม่จางอีก

### Files Changed (รอบที่ 10)

| File | สิ่งที่ทำ |
|---|---|
| `client/src/index.css` | + `.theme-light-only` (override ตัวแปรสีกลับเป็น light + `color` ตรงๆ กัน text สืบทอดจาก `<body>` มาจางเกินไป) |
| `client/src/pages/Supplier/NCRResponse.jsx` | ใส่ `.theme-light-only` ที่ wrapper 4 จุด + ตัด `dark:` utility class ออกทั้งหมด (8 จุด) |

---

## 2026-07-17 | Session 129 — Suppliers Export/Import: คอลัมน์ผู้ดูแลจัดซื้อ + diff-aware update/skip

**คำขอ:** ที่หน้า admin > Master List > ผู้ผลิต — (1) Export เพิ่มหัวข้อ "ผู้ดูแลจัดซื้อ" โดยให้เลือกได้มากกว่า 1 คน
ผ่าน Excel dropdown (2) Import ให้ตรวจสอบไฟล์ที่จะอัปเดต — ถ้าข้อมูลซ้ำแต่มีบางช่องต่างจากเดิม ให้แจ้งเตือนและนำเข้า
อัปเดตให้เป็นปัจจุบันได้ ถ้าซ้ำทุกช่องไม่มีอะไรเปลี่ยนเลยให้ข้ามการนำเข้าทันที

**สิ่งที่พบก่อนเริ่ม (blocker ต้องแก้ก่อนออกแบบ):** Excel data validation (`type: 'list'`, ที่ Products export ใช้
สร้าง Reference-sheet dropdown อยู่แล้ว) รองรับแค่**เลือกค่าเดียวต่อเซลล์**ตามธรรมชาติ — multi-select ในเซลล์เดียว
ของ Excel จริงๆ ต้องพึ่ง VBA macro (`Worksheet_Change` ต่อค่าเป็น comma list) ซึ่งต้องมี `vbaProject.bin` ฝังใน
ไฟล์ `.xlsm` — `exceljs` (library ที่ใช้ทั้งระบบ) เขียนส่วนนี้ไม่ได้เลย — **ถาม `AskUserQuestion`** ก่อนออกแบบว่าจะ
ใช้วิธีไหนแทน: user เลือก **"1 คอลัมน์ต่อ 1 คน (ตาราง Y/N)"** แทนแบบ comma-separated + dropdown ช่วยอ้างอิงชื่อ
(หลีกเลี่ยงความกำกวมตอน parse ชื่อคืนจาก comma string เลย)

Explore agent สำรวจพบว่า **ไม่มี import route ไหนในไฟล์ `master.js` มี diff/update logic เลยสักตัว** — ทั้ง 5
master-data import routes (รวม Suppliers เดิม) ถือว่ารหัส/ชื่อที่ซ้ำกับของเดิมเป็น blocking error เสมอ, transaction
มีแต่ `INSERT` ไม่มี `UPDATE` เลยสักที่ — เป็นโค้ดใหม่ทั้งหมด ไม่ใช่การ copy pattern เดิม — **เข้า Plan mode** ออกแบบ
ก่อนแก้เพราะกระทบ shared component (`ExcelImportModal.jsx`) ที่ import route อื่นอีก 5 ตัวใช้ร่วมด้วย

**การแก้ (Export):** `routes/master.js`'s `GET /suppliers/export` — เพิ่ม query
`getActivePurchasingUsers()` (helper ใหม่, query เดียวกับ `/purchasing-users` เดิม) แล้วเพิ่ม 1 คอลัมน์ต่อ 1 คน
(header = full_name, cell = `'Y'`/ว่าง ตาม `attachSupplierPurchasingAssignees` เดิมที่มีอยู่แล้ว) — ไม่มี
Reference sheet/dataValidation เลยเพราะเป็นตาราง ไม่ใช่ dropdown

**การแก้ (Import — ส่วนที่ยากสุด):** `POST /suppliers/import` เขียนใหม่เกือบทั้งฟังก์ชัน:
- คอลัมน์ 6 เป็นต้นไป: จับคู่ header กับ purchasing user ที่ **active อยู่ ณ ตอน import** (อาจต่างจากตอน export ถ้า
  มีคนเพิ่ม/ปิดใช้งานหลังจากนั้น) — header ที่จำไม่ได้ → เก็บใน `headerWarnings` (เตือน ไม่ block) คอลัมน์นั้นถูกข้าม
- **จุดออกแบบสำคัญ:** sync ผู้ดูแลจัดซื้อ **จำกัดเฉพาะ user ที่คอลัมน์ปรากฏอยู่จริงในไฟล์** — ถ้าไฟล์เก่าไม่มีคอลัมน์
  ของ user คนใหม่ที่เพิ่งถูกเพิ่มเข้าระบบทีหลังเลย จะไม่แตะสถานะผู้ดูแลของคนนั้น (ต่างจาก column ที่ปรากฏแต่เว้นว่าง
  ซึ่งถือเป็น "ไม่ assign" ชัดเจน) กันไฟล์เก่าจาก import ไปล้างผู้ดูแลที่เพิ่มเข้ามาทีหลังโดยไม่ตั้งใจ — implement
  ด้วย `DELETE ... WHERE supplier_id=? AND user_id IN (<เฉพาะ user id ที่คอลัมน์ปรากฏ>)` แล้ว re-insert เฉพาะที่
  เป็น Y เท่านั้น (ไม่ใช่ `DELETE ALL` แบบ PATCH ปกติของ `SupplierForm`)
- match existing supplier: `code` ก่อน (ถ้ามี) ไม่งั้น fallback ไปที่ `name` — ตรงกันแล้ว fetch record เดิมมาเทียบ
  ทีละ field (`name`/`email`/`phone`/`notes`, normalize null/undefined/'' ให้เท่ากัน) + เทียบ assignee id set ที่
  จำกัดเฉพาะคอลัมน์ที่ไฟล์นี้จำได้ — ไม่มี diff เลย → `status:'skip'` (ไม่แตะ DB, ไม่มี audit log) มี diff อย่างน้อย
  1 จุด → `status:'update'` พร้อม `changes: string[]` อธิบายว่าเปลี่ยนอะไร (เช่น `อีเมล: "a@x.com" → "b@x.com"`,
  `ผู้ดูแลจัดซื้อ: +สมชาย, -สมหญิง`)
- ซ้ำกันเอง**ภายในไฟล์เดียวกัน** (2 แถวรหัสเดียวกัน) ยังคง error เหมือนเดิม — กำกวมจริง ไม่ใช่ update ที่ถูกต้อง
- Transaction แยก 3 branch ตาม status: `skip` = no-op, `update` = `UPDATE` + sync assignees ที่ scope ไว้ + audit
  log `UPDATE`, `ok`/`warning` (ไม่มี match เดิม) = `INSERT` เหมือนเดิม + seed assignees ใหม่ — response เปลี่ยนเป็น
  `{ success, imported, updated, skipped }` (แยก 3 ตัวเลข แทน `imported` รวมตัวเดียวแบบเดิม)

**การแก้ (Shared component, additive only):** `importResponse()` เพิ่ม `updateCount`/`skipCount` (+ optional
`extra` param สำหรับ `headerWarnings`) — เป็น 0 เสมอสำหรับ 5 import route อื่นที่ไม่เคยผลิต status พวกนี้ —
`ExcelImportModal.jsx`: เพิ่ม `STATUS_BG.update`/`.skip`, summary chip "อัปเดต N"/"ข้าม N (ไม่มีการเปลี่ยนแปลง)"
(render เมื่อ count > 0 เท่านั้น), แสดง `r.changes` ในตาราง preview, notice box สำหรับ `headerWarnings`, และหน้า
"เสร็จสิ้น" แสดง "เพิ่มใหม่/อัปเดต/ข้าม" แยกกันถ้า response มี `updated`/`skipped` (route อื่นไม่มีฟิลด์นี้เลยจึง
fallback ไปข้อความเดิมเป๊ะ — ไม่กระทบ Products/Units/ProductGroups/DefectCategories/Colors import เลย)

**Test:** สร้าง `server/test/suppliersImportExport.test.js` ใหม่ทั้งหมด (11 เคส) — export มีคอลัมน์ผู้ดูแลครบ+ค่า
Y ถูกต้อง, preview/import จริงของแถวเหมือนเดิมทุกอย่าง → skip ไม่แตะ DB เลย (เช็ค audit_logs count ไม่เพิ่ม), แก้
อีเมล/หมายเหตุ → update จริง+audit log, แก้แค่ผู้ดูแล → update+junction sync ถูกต้อง, ไฟล์เก่าไม่มีคอลัมน์ของ user
ที่เพิ่มทีหลัง → ไม่ถูกแตะ, header ไม่รู้จัก → เตือนไม่ block, supplier ใหม่ → insert+assignees ถูกต้อง, รหัสซ้ำใน
ไฟล์เดียวกัน → error เหมือนเดิม — `node --test` → **300/300 เขียว** (289 baseline + 11 เคสใหม่), `npm run build`
(client) ผ่าน

**Verify:** ยังไม่ได้ verify ผ่าน Playwright จริง (verify ผ่าน integration test ที่ยิง HTTP จริงครบทุก endpoint
แทน เพราะเป็น backend-heavy feature — ทดสอบผ่านการสร้าง .xlsx buffer จริงด้วย ExcelJS แล้วอัปโหลดผ่าน
`multipart/form-data` เหมือนที่ browser จะทำจริง ไม่ใช่แค่ mock) — แนะนำให้ user ทดสอบ export→แก้ไฟล์เอง→import
กลับหนึ่งรอบเต็มก่อนใช้งานจริง

### Files Changed

| File | สิ่งที่ทำ |
|---|---|
| `server/routes/master.js` | `GET/POST /suppliers/{export,import}` เขียนใหม่เกือบทั้งหมด, + `getActivePurchasingUsers()`, `importResponse()` เพิ่ม `updateCount`/`skipCount`/`extra` |
| `client/src/components/UI/ExcelImportModal.jsx` | + status `update`/`skip`, chips, `changes` display, `headerWarnings` notice, done-screen breakdown (additive only) |
| `server/test/suppliersImportExport.test.js` | ใหม่ทั้งหมด — 11 เคส |

---

## 2026-07-17 | Session 130 — Master List (ทั้ง 6 หน้า): Export ตรง schema จริง + diff-aware Import + Zebra Stripe

**คำขอ:** (1) ที่ Master List ทุกหน้าที่มี export ให้อัปเดตให้ตรงตามตารางปัจจุบัน คอลัมน์ไหนทำ dropdown ได้ให้ทำไว้เลย
และปรับ import ให้ตรวจสอบ diff-aware แบบเดียวกับที่ทำให้ Suppliers ไปแล้ว (S129) ทุกหน้า (2) เพิ่มไฮไลท์แถบสีสลับแถว
(zebra stripe) ให้ทุก export sheet ของ Master List กันกรอกผิดแถวตอนแก้ไฟล์เอง

**Scope:** ProductGroups, Units, DefectCategories, Colors (4 หน้า, schema ไม่มี gap อยู่แล้ว) + Products (หน้าใหญ่
สุด/ซับซ้อนสุด, มี gap จริงหลายจุด) — Suppliers ทำไปแล้วใน S129 ไม่ต้องแตะซ้ำ (ยกเว้นเพิ่ม zebra stripe)

**สิ่งที่พบจาก schema audit (ก่อนเริ่มแก้):**
- **ProductGroups** export/import ขาด 2 คอลัมน์จริงที่ JSON CRUD route มีอยู่แล้ว: `has_shelf_life`,
  `shelf_life_days`
- **Products** stale เทียบกับฟอร์มจริงที่ใช้งานอยู่มากที่สุด: (a) ฟอร์มจริงเลือก **supplier ได้มากกว่า 1 ต่อสินค้า**
  (`product_suppliers` m:n) แต่ export/import เดิมอ่าน/เขียนแค่ legacy column เดียว `products.supplier_id` — ทำให้
  export→แก้→import ทับ supplier ตัวที่ 2 ขึ้นไปหายไปเงียบๆ ทุกครั้ง (b) `model_id`/สี (`product_colors`) มีอยู่ใน
  DB/CRUD routes จริงแต่ export/import ไม่รู้จักเลยแม้แต่คอลัมน์เดียว
- Units/DefectCategories/Colors: schema ตรงกับ export/import อยู่แล้ว ต้องการแค่ diff-aware import + zebra stripe
- ไม่มี export route ไหนในระบบมี zebra stripe เลยสักตัว (ของใหม่ทุกหน้า ไม่ใช่ pattern เดิมที่มีอยู่แล้ว)

**Multi-supplier ของ Products — ทำไมไม่ใช้ pattern Y/N matrix แบบ Suppliers ใน S129:** ถาม `AskUserQuestion` อีกรอบ
เพราะ trade-off กลับด้าน — S129 มีผู้ดูแลจัดซื้อแค่ ~3 คน ตาราง Y/N คอลัมน์ต่อคนจึงคุ้ม แต่ Products มี **131
suppliers ที่ active** การทำคอลัมน์ต่อคนจะกลายเป็น 131 คอลัมน์ในชีตเดียว ใช้งานจริงไม่ได้ — user เลือก **คอลัมน์เดียว
คั่นด้วย comma** (`"Supplier A, Supplier B"`) แทน พร้อม dropdown แบบ single-pick-แล้วพิมพ์ต่อเองใน Reference sheet
(ช่วยแค่จำชื่อ ไม่ได้ auto-list ให้ครบ)

**Shared helper ใหม่ (`routes/master.js` ด้านบน):**
- `normVal(v)` — hoist จาก inline `norm()` เดิมที่มีแค่ใน Suppliers import block ของ S129 (เอาไปใช้ร่วมกันทุก route
  ตอนนี้)
- `applyZebraStripes(ws, firstDataRow, lastDataRow, colCount)` — สีพื้น `FFF5F6F8` (ตรงกับ `--color-bg` light
  token) แถวคู่นับจากแถวข้อมูลแรก, แถวคี่ปล่อยขาว

**Phase 1 (zebra stripe, ทุกหน้ารวม Suppliers):** เรียก `applyZebraStripes(...)` หลัง data-row loop ของทุก export
route — Products เรียก 2 ครั้ง (ชีต "สินค้า" + ชีต "Reference")

**Phase 2 (diff-aware import — Units/DefectCategories/Colors, ตรงไปตรงมา mirror S129):** เหมือนกันทุก field →
`status:'skip'` (ไม่แตะ DB เลย), ต่างจุดใดจุดหนึ่ง → `status:'update'` พร้อม `changes[]` + audit log `UPDATE`, ซ้ำกัน
เองในไฟล์เดียวกัน → ยัง error เหมือนเดิม (กำกวมจริง) — match ด้วย `code||name` (Units ไม่มี code จึง match ด้วยชื่อ
อย่างเดียว) — `ExcelImportModal.jsx` (shared component ที่ 3 หน้านี้ใช้ร่วมกันอยู่แล้ว) render `update`/`skip`/
`changes` มาตั้งแต่ S129 แล้ว **ไม่ต้องแก้ frontend เลยสักไฟล์** สำหรับ 3 หน้านี้

**Phase 2b (ProductGroups — diff-aware + 2 คอลัมน์ใหม่):** เพิ่ม `has_shelf_life` (dropdown ใช่/ว่าง แบบเดียวกับ
boolean column อีก 4 ตัวเดิม) + `shelf_life_days` (ตัวเลขธรรมดา ไม่มี dropdown) — `checkHeaders` ขยายจาก 6 →
8 หัวข้อ, diff ครบ `name` + boolean/numeric ทั้ง 6 ตัว

**Phase 3 (Products — ใหญ่สุด):**
- **Export:** Reference sheet ขยาย 8 → 10 คอลัมน์ (เพิ่ม รุ่น/Model จาก `models`, สี จาก `colors`) — ชีต "สินค้า"
  เปลี่ยน header คอลัมน์ Supplier เป็น "ชื่อ Supplier * (คั่นด้วย , ถ้ามากกว่า 1)", query ดึงจาก `product_suppliers`
  โดยตรง (ไม่ใช่ legacy `supplier_id` อีกต่อไป) แล้ว comma-join ชื่อ supplier ทั้งหมดของสินค้านั้น (sorted) เพิ่ม
  คอลัมน์ รุ่น/Model (จาก `model_id`) และ สี (จาก `product_colors` — single-value ตรงกับ behavior จริงของฟอร์มแม้
  schema จะเป็น m:n) พร้อม dropdown ทั้งคู่ (`errorStyle:'warning'`, ไม่ block)
- **Import:** parse คอลัมน์ Supplier ด้วยการ split `,` แล้ว resolve ทีละชื่อผ่าน `supplierMap` เดิม — ชื่อไม่รู้จัก
  = **error** (Supplier ยังคงเป็น required field เหมือนเดิม) ส่วน Model/สี เป็น **optional** — ชื่อไม่รู้จัก =
  **warning** เฉยๆ ปล่อย field ว่างไว้ ไม่ block การ import — match สินค้าเดิมด้วย `code||name` แล้ว diff scalar
  fields ทั้งหมด (`name`/`product_group_id`/`unit_id`/`inspection_level`/`aql_value`/`notes`/`model_id`/
  `color_id`) บวก **supplier id set แบบเทียบ array** (เหมือน assignee diff ของ Suppliers ใน S129) — ไม่ต่างเลย →
  skip, ต่าง → update พร้อม `changes[]` (เช่น `Supplier: +Supplier PA -Supplier PB`) — transaction: `update` =
  `UPDATE products` + **full replace** `product_suppliers`/`product_colors` ทั้งคู่ (mirror `PATCH /products/:id`
  เดิมเป๊ะ — `DELETE ... WHERE product_id=?` แล้ว re-insert ใหม่ทั้งชุด ไม่ใช่ scoped-by-column แบบ Suppliers เพราะ
  ชีตนี้ระบุ supplier ครบทุกคนในเซลล์เดียวเสมอ ไม่มีทางที่บางคอลัมน์จะไม่ปรากฏแบบ Y/N matrix) + audit log `UPDATE`
- **Frontend (`Products.jsx`):** หน้านี้มี import modal แบบ hand-rolled ของตัวเอง (ไม่ใช้ `ExcelImportModal.jsx`
  ที่ 5 หน้าอื่นใช้ร่วมกัน) ต้องแก้เองแยกต่างหาก — เพิ่ม `IMPORT_STATUS_CLASS.update/.skip`, summary chip
  "อัปเดต N"/"ข้าม N", results table แสดง `r.changes`, หน้า "เสร็จสิ้น" แยกเพิ่มใหม่/อัปเดต/ข้าม (fallback ข้อความ
  เดิมถ้า response ไม่มี field พวกนี้)

**Test:** `server/test/masterDiffImport.test.js` ใหม่ (15 เคส — ProductGroups/Units/DefectCategories/Colors
ครอบ skip/update/error รวม 2 คอลัมน์ใหม่ของ ProductGroups + zebra-stripe smoke check บน Colors export),
`server/test/productsImportExport.test.js` ใหม่ (9 เคส — export มีคอลัมน์ Reference ครบ+comma-join ถูกต้อง,
insert สินค้าใหม่พร้อม 2 suppliers+model+color, re-import ไฟล์เดิมทุก field → skip ไม่แตะ DB, เอา supplier ออก
1 คน → update+junction sync ถูกต้อง, ชื่อ supplier ไม่รู้จัก → error, ชื่อ model/สี ไม่รู้จัก → warning ไม่ block,
รหัสซ้ำในไฟล์ → error) — `node --test` → **324/324 เขียว** (300 baseline + 15 + 9 เคสใหม่), `npm run build`
(client) ผ่าน

**Verify:** เหมือน S129 — verify ผ่าน integration test ที่ยิง HTTP จริง + สร้าง `.xlsx` buffer จริงด้วย ExcelJS
แล้วอัปโหลดผ่าน `multipart/form-data` จริง ยังไม่ได้ verify ผ่าน Playwright/มือจริง — แนะนำให้ user ทดสอบ
export→แก้ไฟล์เอง→import กลับ ให้ครบทั้ง 6 หน้าก่อนใช้งานจริง โดยเฉพาะ Products ที่ซับซ้อนสุด (multi-supplier +
model + color ในไฟล์เดียว)

### Files Changed

| File | สิ่งที่ทำ |
|---|---|
| `server/routes/master.js` | + `normVal()`/`applyZebraStripes()` (hoisted/shared), zebra stripe ทุก export (6 หน้า), diff-aware import: ProductGroups (+2 คอลัมน์)/Units/DefectCategories/Colors/Products (เขียนใหม่เกือบทั้งหมด — multi-supplier comma-parse, model/color optional) |
| `client/src/pages/Master/Products.jsx` | import modal (hand-rolled, ไม่ใช้ shared component) เพิ่ม status `update`/`skip`, `changes` display, done-screen breakdown |
| `server/test/masterDiffImport.test.js` | ใหม่ทั้งหมด — 15 เคส (ProductGroups/Units/DefectCategories/Colors) |
| `server/test/productsImportExport.test.js` | ใหม่ทั้งหมด — 9 เคส |

---

## 2026-07-17 | Session 131 — COO Dashboard: เพิ่มสรุปข้อมูลจัดซื้อทั้งบริษัท

**คำขอ:** ปรับหน้า dashboard ของ ID COO ให้เห็นข้อมูลสรุปของจัดซื้อทั้งหมด

**สิ่งที่พบ:** `cco` เดิม map ไปที่ `ExecutiveDash.jsx` ใช้ร่วมกับ `cmo`/`cpo` (แสดงแค่ UAI รอลงนาม + KPI พื้นฐาน 4
ตัว) — ข้อมูลสรุปจัดซื้อทั้งบริษัทที่ต้องการ (สถานะ NCR/NCP ทั้งทีม, closing rate, รายชื่อพนักงานจัดซื้อ) มีอยู่แล้ว
จริงที่ endpoint `GET /api/purchasing/dashboard/team` (ใช้โดย `ManagerPurchasingDash.jsx` ของผู้จัดการจัดซื้อ) แต่
route เดิม gate ไว้เฉพาะ `purchasing_manager`/`admin` เท่านั้น (`managerOnly` ใน `routes/purchasingDashboard.js`)

**การแก้:**
- แก้เฉพาะ `cco` — ไม่แตะ `cmo`/`cpo` เพราะ user ระบุเจาะจง "ID COO" เท่านั้น จึงสร้าง `COODash.jsx` แยกใหม่แทนที่
  จะแก้ `ExecutiveDash.jsx` ตรงๆ (ซึ่งจะกระทบ cmo/cpo ไปด้วยโดยไม่ได้ขอ)
- `routes/purchasingDashboard.js`: เพิ่ม `'cco'` เข้า `managerOnly` role list (คุม `/team` + `/team/:memberId`
  ทั้งคู่) — endpoint ทั้งไฟล์นี้เป็น read-only ล้วน (ไม่มี POST/PATCH/DELETE เลย) จึงเป็นการเปิด "เห็นได้" ไม่ใช่
  "แก้ได้" — `getSummary()`/`scopeClause()` เดิม (`server/services/purchasingDashboardService.js`) already คืน
  scope `1=1` (เห็นทุก supplier ไม่ถูกกรอง) ให้ role ใดๆ ที่ไม่ใช่ `'purchasing'` อยู่แล้ว — ไม่ต้องแก้ service เลย
- `client/src/pages/Dashboard/COODash.jsx` (ใหม่): ครึ่งบนเหมือน `ExecutiveDash.jsx` เดิม (UAI รอลงนามของคุณ + 4
  SummaryCard) เพราะ COO ยังต้องเซ็น UAI เหมือน cmo/cpo (role matrix เดิม CLAUDE.md §11) ครึ่งล่างเพิ่มส่วน "สรุป
  ข้อมูลจัดซื้อทั้งหมด" — ดึงจาก `/purchasing/dashboard/team` เดียวกับที่ `ManagerPurchasingDash.jsx` ใช้ (HeroStat
  5 ตัว, bar chart แยก bucket สถานะ NCR/NCP, donut อัตราปิดงาน, ตารางทีมจัดซื้อคลิกดู detail ต่อคนได้) — ต่างจาก
  ผู้จัดการจัดซื้อตรงที่ไม่มีส่วน "งานเกินกำหนด — ต้องติดตามด่วน" (การ์ดเตือนสำหรับ manager ใช้ตามงาน ไม่ใช่ executive
  view) และไม่มีปุ่มจัดการทีมใดๆ (pure read-only)
- `App.jsx`: เพิ่ม `'cco'` เข้า roles ของ route `/purchasing/team/:memberId` (`PurchasingMemberDetail.jsx`) — ไม่งั้น
  คลิกแถวพนักงานจากตาราง COODash แล้วเจอ ProtectedRoute บล็อก 403 ทันที (หน้านี้ read-only เหมือนกัน ไม่มีปุ่มแก้ไข)
- `client/src/pages/Dashboard/index.jsx`: `cco: <COODash navigate={navigate} />` (เดิมชี้ `ExecutiveDash`)

**Test:** เพิ่ม 4 เคสใน `server/test/purchasingDashboard.test.js` (DASH-11..14) — qc_staff/purchasing (ธรรมดา) ยัง
เข้า `/team` ไม่ได้ (403, ไม่มี privilege escalation เกินตั้งใจ), cco เข้า `/team` ได้เห็นทุก supplier ไม่ถูกกรอง
(เหมือน purchasing_manager เป๊ะ), cco เข้า `/team/:memberId` ได้ — `node --test` → **328/328 เขียว** (324 baseline +
4 เคสใหม่), `npm run build` (client) ผ่าน

**Verify:** ยังไม่ได้ verify ผ่าน Playwright/มือจริง — แนะนำให้ user login ด้วย user role `cco` แล้วดูหน้าแรกจริง
อีกครั้งก่อนใช้งาน

### Files Changed

| File | สิ่งที่ทำ |
|---|---|
| `server/routes/purchasingDashboard.js` | `managerOnly` เพิ่ม `'cco'` (คุม `/team`, `/team/:memberId`) |
| `client/src/pages/Dashboard/COODash.jsx` | ใหม่ — UAI รอลงนาม (เหมือน ExecutiveDash) + สรุปจัดซื้อทั้งบริษัท (เหมือน ManagerPurchasingDash แบบ read-only) |
| `client/src/pages/Dashboard/index.jsx` | `cco` ชี้ไป `COODash` แทน `ExecutiveDash` (cmo/cpo ไม่เปลี่ยน) |
| `client/src/App.jsx` | route `/purchasing/team/:memberId` เพิ่ม role `cco` |
| `server/test/purchasingDashboard.test.js` | + DASH-11..14 (4 เคสใหม่) |

---

## 2026-07-17 | Session 132 — Dark Mode Auto: จำกัดเฉพาะมือถือ, คอมให้เป็นกลางวันเสมอ

**คำขอ:** โหมด "อัตโนมัติ (ตามเวลา)" ให้ทำงานเฉพาะตอนดูในมือถือเท่านั้น ถ้าเปิดในคอมให้เป็นโหมดกลางวันเสมอ แต่ยังกด
เปลี่ยนเป็น Light/Dark เองได้ตามปกติ (ไม่แตะ manual override)

**การแก้:** ตรวจจับ "มือถือ" ด้วย `window.matchMedia('(pointer: coarse) and (hover: none)')` (สัมผัส+ไม่มี hover)
แทน user-agent sniffing หรือความกว้างหน้าจอ — เหตุผลที่ไม่ใช้ความกว้างหน้าจอ: ย่อหน้าต่างคอมให้แคบไม่ควรถูกนับว่า
เป็นมือถือ ส่วน user-agent string ปลอมง่ายและไม่จำเป็นเมื่อมี media query ที่ตรงจุดกว่าอยู่แล้ว
- `ThemeContext.jsx`: เพิ่ม `isMobileDevice()`, `computeEffective()` ใน branch `auto` เช็คก่อนว่าเป็นมือถือไหม —
  ถ้าไม่ใช่ (คอม/โน้ตบุ๊ค มี hover) คืน `'light'` ทันที ไม่คำนวณช่วงเวลาเลย ถ้าใช่ค่อยคำนวณตามชั่วโมงเหมือนเดิม —
  `preference === 'dark'`/`'light'` (manual) ไม่ถูกแตะเลย ยังคืนตามที่ user เลือกเสมอไม่ว่าอุปกรณ์ไหน
- `index.html` (inline script กัน flash-of-wrong-theme ก่อน React โหลด) — sync logic เดียวกันเป๊ะ (คอมเมนต์เดิม
  เตือนไว้แล้วว่าต้องแก้คู่กันเสมอ)
- `ThemeToggle.jsx`: label ตัวเลือก auto เปลี่ยนเป็น "อัตโนมัติ (ตามเวลา — มือถือเท่านั้น)" ให้ user เข้าใจ scope
  ชัดเจนตอนเลือก ไม่ใช่มาเจอเอาว่าทำไมเปิดคอมไม่มืดตามเวลา

**Test:** ไม่มี server test เกี่ยวข้อง (frontend-only, localStorage-based, ไม่มี backend endpoint) — verify ผ่าน
`npm run build` (client) ผ่านเท่านั้น, `node --test` เดิมไม่กระทบ (328/328 เขียวเหมือนเดิม)

**Verify:** ยังไม่ได้ verify ผ่านมือจริงทั้งมือถือ/คอม — แนะนำให้ user ทดสอบเปิดหน้าเว็บบนมือถือจริงช่วงกลางคืน
(ควรเห็นมืดถ้าตั้ง auto) เทียบกับเปิดคอมช่วงเวลาเดียวกัน (ควรเห็นสว่างเสมอถ้าตั้ง auto)

### Files Changed

| File | สิ่งที่ทำ |
|---|---|
| `client/src/contexts/ThemeContext.jsx` | + `isMobileDevice()`, `computeEffective()` auto branch เช็คก่อนคำนวณเวลา |
| `client/index.html` | inline script sync logic เดียวกัน |
| `client/src/components/UI/ThemeToggle.jsx` | label auto option ชัดเจนขึ้น |

---

## 2026-07-17 | Session 133 — COO Dashboard: ตัดคำต่อท้าย role ออกจากหัวข้อ + กวาดล้าง "CCO" ที่เหลือทั้งระบบ

**คำขอ:** หน้าหลักของ ID COO เดิมขึ้น "หน้าหลัก CCO" (มาจาก `user.role.toUpperCase()` ซึ่งพ่น slug ตัวพิมพ์ใหญ่ของ
role `cco` ออกมาตรงๆ) ให้เปลี่ยนเป็น "หน้าหลัก" เฉยๆ (ตัดคำต่อท้ายออกทั้งหมด ไม่ใช่เปลี่ยนเป็น "หน้าหลัก COO") และ
กวาดหาคำว่า "CCO" ที่เหลืออยู่ในระบบ (label เดิมเคยแก้ไปแล้วบางส่วนใน S128) แก้เป็น "COO" ให้หมด

**การแก้:**
- `client/src/pages/Dashboard/COODash.jsx` (สร้างใหม่ใน S131): `<h1>หน้าหลัก {user?.role?.toUpperCase()}</h1>` →
  `<h1>หน้าหลัก</h1>` เฉยๆ — ลบ `useAuth()`/ตัวแปร `user` ที่ไม่ได้ใช้ที่ไหนอีกแล้วออกด้วย (ไม่แตะ
  `ExecutiveDash.jsx` ที่ cmo/cpo ยังใช้ร่วมกัน เพราะ user ระบุเจาะจง COO เท่านั้น — หน้านั้นยังโชว์ "หน้าหลัก
  CMO"/"หน้าหลัก CPO" เหมือนเดิม)
- กวาดหา `\bCCO\b` (whole-word, กันชนกับ `ACCOUNT_ID` ที่มี substring "CCO" ปนอยู่โดยบังเอิญ) ทั่วทั้ง repo — เจอ
  เหลือแค่ 2 จุดเป็น**คอมเมนต์**ในโค้ด (ไม่ใช่ label ที่ user เห็นจริง, ของจริงแก้หมดแล้วใน S128): `routes/uai.js`
  บรรทัดคอมเมนต์เหนือ `POST /:id/reject-exec` และ `services/uaiService.js` คอมเมนต์เหนือฟังก์ชัน reject UAI ทั้งคู่
  → แก้เป็น "COO/CMO/CPO" ให้ตรงกับ label จริงที่ใช้ในระบบ
- **ไม่แตะ:** role id `'cco'` (string literal ที่ใช้เป็น DB/auth identifier ทั้งระบบ — เปลี่ยนจะพังทุก
  `requireRole`/seed/query ที่พึ่งค่านี้), entry เก่าใน `DEVLOG.md` ที่พูดถึงการแก้ "CCO"→"COO" ในอดีต (เป็น log
  ประวัติศาสตร์ ไม่ใช่หน้าในระบบ), และ `backups/iqc_dump_attempt.sql` (ไฟล์ SQL dump สำรองข้อมูลเก่าที่มี "CCO"
  ค้างอยู่ในข้อมูล seed/notification ของ snapshot ก่อนหน้า S128 — เป็น static backup artifact ไม่ใช่หน้าที่ระบบ
  serve จริง แก้ไปก็ไม่มีผลอะไรกับระบบที่รันอยู่)

**Test:** ไม่มี test ใหม่ (comment-only 2 จุด + JSX label เดียว) — `node --test` → **328/328 เขียวเหมือนเดิม**
(ไม่มีจุดไหนถูกทดสอบพฤติกรรม เพราะเป็นข้อความล้วน), `npm run build` (client) ผ่าน

### Files Changed

| File | สิ่งที่ทำ |
|---|---|
| `client/src/pages/Dashboard/COODash.jsx` | หัวข้อ "หน้าหลัก" ตัดคำต่อท้าย role ออก, ลบ `useAuth()`/`user` ที่ไม่ได้ใช้แล้ว |
| `server/routes/uai.js` | คอมเมนต์ CCO→COO |
| `server/services/uaiService.js` | คอมเมนต์ CCO→COO |

---

## 2026-07-17 | Session 134 — Reports: เพิ่ม route Export PDF ที่หายไป + แก้ "รายการรับเข้า"/"อัตราผ่าน" นับผิด

**คำขอ:** (1) หน้ารายงานของ COO กด Export PDF ไม่ได้ (2) "รายการรับเข้า" ขึ้น "500" ซึ่งดูเหมือนเป็นจำนวนชิ้นไม่ใช่
รายการ — ให้แสดงเป็นจำนวนรายการจริง (เช่น 2 บิล บิลละ 10/15 รายการ → รวม 25 รายการ) ส่วนอัตราผ่านให้คำนวณจาก
"รายการที่มีการออก NCR" เทียบกับรายการทั้งหมด (เช่น รับเข้า 10 รายการ ออก NCR 5 ราย → อัตราผ่าน 50%) — ให้ปรับหน้า
"การรับเข้า" ด้วยเช่นกัน ไม่ใช่แค่หน้า "ภาพรวม"

**สิ่งที่พบ (ปัญหา #1):** `client/src/pages/Reports/Summary.jsx` มีปุ่ม Export PDF เรียก
`downloadFile('/reports/summary/pdf', ...)` อยู่แล้ว แต่ **ไม่มี route `GET /api/reports/summary/pdf` อยู่จริงเลย
สักตัวในเซิร์ฟเวอร์** (มีแต่ `/reports/summary/excel`) — ไม่ใช่ปัญหาสิทธิ์เฉพาะ COO แต่พังสำหรับทุก role ที่กดปุ่มนี้
กด export ล้มเหลวแบบเงียบ (404 ไม่มี error message ให้เห็นบนหน้าจอ)

**สิ่งที่พบ (ปัญหา #2):** `GET /api/reports/summary` (backend) ส่ง field `total_received` = `SUM(bi.qty_received)`
(ผลรวม**จำนวนชิ้น**ที่รับเข้าทุกบิล) แต่ frontend เอาไปแสดงเป็น label "รายการรับเข้า" ตรงๆ — ตัวเลขจึงดูเหมือนนับ
รายการผิดทั้งที่จริงเป็นคนละหน่วย (ชิ้น vs รายการ/แถว) เช่นบิลเดียวรับของ 500 ชิ้นก็ขึ้น "500" ทันที และ `pass_rate`
เดิมคำนวณจาก `SUM(qty_passed)/SUM(qty_received)` (สัดส่วนชิ้นผ่าน/ชิ้นรับ) ไม่ใช่ "สัดส่วนรายการที่ไม่มี NCR" ตามที่
user ต้องการ — `GET /api/reports/receiving` (หน้า "การรับเข้า") มี `total_items` (นับแถว `bill_items` ถูกต้องอยู่
แล้ว) แต่ "ผ่าน"/"ไม่ผ่าน"/"อัตราผ่าน" ยังคงคำนวณจาก `qty_passed`/`qty_failed` (จำนวนชิ้น) เหมือนกัน ไม่ตรงกับสูตรใหม่
ที่ user ระบุ

**การแก้ (ปัญหา #2 ก่อน เพราะกระทบ schema การตอบกลับที่ปัญหา #1 ต้องอ้างอิงตาม):**
- `server/routes/reports.js`: ทั้ง `GET /summary` และ `GET /receiving` เปลี่ยนมานับ **"รายการ" = จำนวนแถว
  `bill_items`** (`COUNT(DISTINCT bi.id)`) แทนผลรวม `qty_received` เสมอ + เพิ่ม `COUNT(DISTINCT ni.bill_item_id)`
  (join `ncr_items.bill_item_id = bill_items.id`) เป็น "รายการที่มีการออก NCR" — `pass_rate` = `(total_items -
  ncr_item_count) / total_items * 100` ทั้ง 2 endpoint ตรงตามสูตรที่ user ให้ตัวอย่างมาเป๊ะ (10 รายการ, NCR 5 ราย
  → 50%) — ลบ field เดิมที่กำกวม (`total_received`/`total_passed`/`total_failed`, หน่วยชิ้น) ออกทั้งคู่ เปลี่ยนเป็น
  `total_items`/`ncr_item_count`/`passed_item_count` (ต่อบิลด้วยสำหรับ `/receiving`) ให้ชัดเจนไม่กำกวมอีก
- `client/src/pages/Reports/Summary.jsx`: `total_received` → `total_items` (label "รายการรับเข้า" เดิมไม่เปลี่ยน
  ค่าที่ผูกถูกต้องแล้ว)
- `client/src/pages/Reports/Receiving.jsx`: การ์ดสรุป "ผ่าน"/"ไม่ผ่าน" และคอลัมน์ตารางต่อบิล เปลี่ยนจาก
  `total_passed`/`total_failed` (ชิ้น) → `passed_item_count`/`ncr_item_count` (รายการ) — ให้ตรงกับ `pass_rate` ที่
  แสดงข้างกัน (เดิมถ้าไม่แก้จุดนี้ด้วย ตัวเลข "ผ่าน+ไม่ผ่าน" จะไม่บวกกันเท่ากับ "รายการทั้งหมด" อีกต่อไป เพราะ
  `pass_rate` เปลี่ยนฐานคำนวณไปแล้วแต่การ์ดตัวเลขยังเป็นฐานเดิม) — label "ไม่ผ่าน" เพิ่มวงเล็บ "(มี NCR)" ให้ชัดว่า
  หมายถึงอะไร
- `server/routes/exports.js`'s `/reports/receiving/excel` แก้ตามเป๊ะ (คอลัมน์ "ผ่าน"/"ไม่ผ่าน (มี NCR)" นับรายการ
  แทน qty) กันไม่ให้ไฟล์ export กับหน้าจอโชว์ตัวเลขไม่ตรงกัน — `/reports/summary/excel` ไม่ได้แสดง total_received/
  pass_rate อยู่แล้ว (มีแค่ Supplier Scorecard sheet) จึงไม่ต้องแก้

**การแก้ (ปัญหา #1):** เพิ่ม `GET /api/reports/summary/pdf` ใหม่ใน `server/routes/exports.js` (ไม่เคยมีมาก่อนเลย)
— คำนวณ summary/top-NCR-suppliers/top-defects/supplier-scorecard ด้วย query เดียวกับ `GET /api/reports/summary`
เป๊ะ (รายการ/อัตราผ่านสูตรใหม่ด้วย) เรนเดอร์เป็น PDF แนวนอนผ่าน Puppeteer (`acquirePdfSlot`/`openIsolatedPage`
เหมือน PDF route อื่นในไฟล์เดียวกันทั้งหมด, header/footer template + `pdfRateLimit` แบบเดียวกับ
`/purchasing-dashboard/pdf`) — เนื้อหา: Hero KPI 6 ช่อง (บิลทั้งหมด/รายการรับเข้า/อัตราผ่าน/NCR ทั้งหมด/NCR เปิดอยู่/
UAI ทั้งหมด) + ตาราง Top 5 Supplier มี NCR + Top 5 กลุ่มปัญหา + ตาราง Supplier Scorecard เต็ม ตรงกับที่หน้าจอ
`Summary.jsx` แสดงทุกส่วน

**Test:** `server/test/reports.test.js` ใหม่ทั้งหมด (5 เคส) — permission gate `/reports/summary` (403 สำหรับ
qc_staff), `total_items`=25 จาก 2 บิล (10+15 รายการ ไม่ใช่ผลรวมชิ้น), `pass_rate`='80.0' จาก 25 รายการ/NCR 5 ราย,
`/reports/receiving` ต่อบิล item_count/ncr_item_count/passed_item_count ถูกต้องทั้งระดับบิลและ aggregate,
permission gate `/reports/summary/pdf` (403 ไม่ใช่ 404 อีกต่อไป) — **ไม่ได้เขียน test เรียก Puppeteer จริง**
(ลองแล้วระหว่างพัฒนา พบว่า route ทำงานถูกต้อง 100% แต่ทิ้ง `chrome.exe` ค้างเป็น orphan process บน Windows ถึง 18
ตัวหลัง test จบทุกครั้ง แม้เรียก `closeBrowser()` ใน `test.after` แล้วก็ตาม — ปัญหา known upstream ของ Puppeteer
บน Windows ไม่เกี่ยวกับโค้ดที่แก้ ไม่มี route `/pdf` ไหนในทั้งระบบ (bill/ncr/uai/purchasing-dashboard) ที่มี
automated test เรียกจริงอยู่แล้วเหมือนกัน จึงตามธรรมเนียมเดิม — verify ว่า route คืน PDF จริง (200, content-type,
buffer มีเนื้อหา) ทำ manual ไปแล้วนอก suite) — `node --test` → **333/333 เขียว** (328 baseline + 5 เคสใหม่),
`npm run build` (client) ผ่าน

**Verify:** ยังไม่ได้ verify ผ่านมือจริงในเบราว์เซอร์ (กด Export PDF จริงจากหน้า Summary.jsx) — แนะนำให้ user ลอง
กดปุ่ม Export PDF ที่หน้ารายงาน > ภาพรวม อีกครั้ง และเช็คตัวเลข "รายการรับเข้า"/"อัตราผ่าน" ทั้ง 2 หน้า (ภาพรวม/
การรับเข้า) ว่าตรงกับข้อมูลจริงแล้ว

### Files Changed

| File | สิ่งที่ทำ |
|---|---|
| `server/routes/reports.js` | `GET /summary`, `GET /receiving` — รายการ/อัตราผ่านนับจากแถว bill_items + NCR แทนผลรวมจำนวนชิ้น |
| `server/routes/exports.js` | + `GET /reports/summary/pdf` (ใหม่ทั้งหมด — route หายไปเดิม), `/reports/receiving/excel` แก้ตามสูตรใหม่ |
| `client/src/pages/Reports/Summary.jsx` | `total_received` → `total_items` |
| `client/src/pages/Reports/Receiving.jsx` | การ์ด/ตาราง "ผ่าน"/"ไม่ผ่าน" เปลี่ยนฐานจากจำนวนชิ้น → จำนวนรายการที่มี/ไม่มี NCR |
| `server/test/reports.test.js` | ใหม่ทั้งหมด — 5 เคส |

---

## 2026-07-17 | Session 135 — Reports: เพิ่ม sort หัวตารางทั้ง 4 หน้า (ภาพรวม/การรับเข้า/NCR/UAI)

**คำขอ:** เมนูรายงานทั้ง 4 หน้า (ภาพรวม, การรับเข้า, NCR, UAI) หัวตารางกดเพื่อ sort ไม่ได้เลย ให้เพิ่มให้ครบทุกหน้า

**การแก้:** ใช้ pattern ที่มีอยู่แล้วในระบบ (`hooks/useSortable.js` + `components/UI/SortTh.jsx` — ใช้อยู่แล้วใน
Master List 6 หน้า/Admin Users) ไม่ต้องสร้างกลไก sort ใหม่ — แทนที่ `<th>` ธรรมดาด้วย `<SortTh col="..." sortKey
sortDir onSort>` ทุกคอลัมน์ + สลับแหล่งข้อมูลที่ map เป็น array จาก `useSortable(...).sorted` แทน raw array จาก API
ทั้ง 4 หน้า:

- `Summary.jsx` (Supplier Scorecard): sort ได้ Supplier/บิลทั้งหมด/NCR ทั้งหมด/อัตรา NCR (%)/UAI ทั้งหมด — คอลัมน์
  "อัตรา NCR (%)" เดิม compute ตอน render เฉยๆ ไม่มี field ตรงให้ sort ได้ จึงเพิ่ม `ncr_rate` (ตัวเลข) เข้าไปใน
  แต่ละแถวด้วย `useMemo` ก่อนส่งเข้า `useSortable` (การแสดงผลยังคง format `.toFixed(1)` ทีหลังเหมือนเดิม ไม่กระทบ)
- `Receiving.jsx`: sort ได้ทุกคอลัมน์ (Invoice No./PO No./Supplier/วันที่/รายการ/ผ่าน/ไม่ผ่าน (มี NCR)/สถานะ)
- `NCRReport.jsx`: sort ได้ทุกคอลัมน์ (รหัส NCR/รายการ/Supplier/ระดับ/วันที่เปิด/สถานะ)
- `UAIReport.jsx`: sort ได้ทุกคอลัมน์ (รหัส UAI/NCR อ้างอิง/Supplier/วันที่ขอ/สถานะ)

ไม่แตะ backend เลย (`useSortable` sort ฝั่ง client จาก array ที่ได้มาแล้ว) — เป็นการเปลี่ยน UI ล้วนๆ

**Test:** ไม่มี backend เปลี่ยน — `node --test` ยัง **333/333 เขียวเหมือนเดิม** (ไม่แตะ), `npm run build` (client)
ผ่าน — ไม่ได้เขียน frontend component test ใหม่ (โปรเจกต์นี้ไม่มี frontend test suite อยู่แล้ว ทั้งระบบ verify ด้วย
manual/build เท่านั้นตามธรรมเนียมเดิม)

**Verify:** ยังไม่ได้ verify ผ่านมือจริงในเบราว์เซอร์ — แนะนำให้ user ลองกดหัวตารางแต่ละคอลัมน์ทั้ง 4 หน้า เช็คว่า
ลูกศร sort ขึ้น/สลับทิศถูกต้อง โดยเฉพาะคอลัมน์ "อัตรา NCR (%)" ที่เพิ่ง derive field ใหม่

### Files Changed

| File | สิ่งที่ทำ |
|---|---|
| `client/src/pages/Reports/Summary.jsx` | Supplier Scorecard table sortable + derive `ncr_rate` สำหรับ sort |
| `client/src/pages/Reports/Receiving.jsx` | ตารางรายการบิล sortable ทุกคอลัมน์ |
| `client/src/pages/Reports/NCRReport.jsx` | ตารางรายการ NCR sortable ทุกคอลัมน์ |
| `client/src/pages/Reports/UAIReport.jsx` | ตารางรายการ UAI sortable ทุกคอลัมน์ |

---

## 2026-07-17 | Session 136 — Reports: เพิ่มช่วงเวลาของข้อมูลลงในไฟล์ Excel ที่ export ทุกหน้า

**คำขอ:** เมนูรายงาน เมื่อ export เป็น excel แล้วให้มีช่วงเวลาของข้อมูลอยู่ในไฟล์ด้วย (เดิมเปิดไฟล์มาไม่มีบอกเลยว่า
กรองช่วงวันที่ไหนไว้ — ต้องกลับไปดูชื่อไฟล์ `report-xxx-{from}-{to}.xlsx` เอาเอง)

**การแก้:** เพิ่ม helper 2 ตัวใน `server/routes/exports.js` (ใช้ร่วมกันทั้ง 4 route): `dateRangeLabel(from, to)`
คืนข้อความไทย ("ช่วงข้อมูล: {from} ถึง {to}" / "ตั้งแต่ {from}" / "ถึง {to}" / "ทั้งหมด (ไม่ได้กรองช่วงวันที่)"
ถ้าไม่ระบุเลย) และ `writeDateRangeRow(ws, colCount, from, to)` เขียนข้อความนี้ลง**แถวที่ 1** ของ worksheet แบบ
merge เต็มความกว้างตามจำนวนคอลัมน์ (ตัวเอียง สีเทา) — ปรับทั้ง 4 route (`/reports/{receiving,ncr,uai,summary}/
excel`) ให้ `ws.columns` มีแค่ `key`/`width` (ไม่มี `header` อีกต่อไป กัน ExcelJS auto-generate หัวตารางที่แถว 1 ทับ
กับแถวช่วงเวลา) แล้วเขียนหัวตารางเองเป็น**แถวที่ 2** แทน (`ws.addRow([...labels])` + สไตล์ fill/font เดิมย้ายไปที่
`ws.getRow(2)`) — ข้อมูลจริงเริ่มแถว 3 เป็นต้นไปเหมือนเดิม (ไม่กระทบ query/คำนวณใดๆ เลย เป็นแค่ presentation)

ไม่แตะ `/reports/receiving/today/excel` (daily receiving report บนหน้า Bills — คนละฟีเจอร์ ใช้วันเดียวไม่ใช่ช่วง
from/to แบบเมนูรายงาน ไม่อยู่ในขอบเขตคำขอ)

**Test:** เพิ่ม 5 เคสใน `server/test/reports.test.js` (REP-06..10) — ทั้ง 4 route มีแถว 1 = ข้อความช่วงเวลา + แถว
2 = หัวตารางจริง (ขยับลงมาถูกต้อง), กรณีไม่ระบุ `from`/`to` เลย → ข้อความ fallback "ทั้งหมด" — `node --test` →
**338/338 เขียว** (333 baseline + 5 เคสใหม่), `npm run build` (client) ผ่าน (ไม่มีจุดไหนแตะ frontend เลยรอบนี้)

**Verify:** ยังไม่ได้ verify ผ่านมือจริง (เปิดไฟล์ Excel จริงดูหน้าตา) — แนะนำให้ user export ลองทั้ง 4 หน้าดูว่า
แถวช่วงเวลาอ่านง่าย ไม่ชนกับความกว้างคอลัมน์ที่ตั้งไว้เดิม

### Files Changed

| File | สิ่งที่ทำ |
|---|---|
| `server/routes/exports.js` | + `dateRangeLabel()`/`writeDateRangeRow()`, ปรับ 4 route (`/reports/{receiving,ncr,uai,summary}/excel`) ให้เขียนแถวช่วงเวลาที่แถว 1 + หัวตารางย้ายไปแถว 2 |
| `server/test/reports.test.js` | + REP-06..10 (5 เคสใหม่) |

---

## 2026-07-17 | Session 137 — Reports (NCR): แก้กราฟ "สัดส่วน NCR ตามกลุ่มปัญหา" ขึ้น "อื่นๆ" ทั้งหมด

**คำขอ:** ในรายงาน NCR กราฟ "สัดส่วน NCR ตามกลุ่มปัญหา" ทำไมขึ้นแต่ "อื่นๆ" ทั้งๆ ที่มีกลุ่มปัญหาจริง เช่น
เปียกน้ำ, สีเพี้ยน, สินค้าไม่ตรงตาม DWG/ผิด Spec

**สิ่งที่พบ (root cause):** `client/src/pages/Reports/NCRReport.jsx` คำนวณกราฟนี้จาก `n.defect_category_name` ของ
แต่ละแถวใน `data.ncrs` — แต่ query จริงของ `GET /api/reports/ncr` (`server/routes/reports.js`) **ไม่เคย join
`defect_categories` เลยสักครั้ง**:
```sql
SELECT n.*, s.name as supplier_name, b.invoice_no, b.po_no as bill_po, COUNT(ni.id) as item_count
FROM ncrs n LEFT JOIN bills b ... LEFT JOIN suppliers s ... LEFT JOIN ncr_items ni ON ni.ncr_id = n.id
GROUP BY n.id ...
```
`defect_category_id` เป็น field ของ `ncr_items` (ไม่ใช่ของ `ncrs`) และ query นี้ query ระดับ NCR (`GROUP BY n.id`,
ไม่ join `defect_categories`) ทำให้ `n.defect_category_name` เป็น `undefined` **ทุกแถวเสมอ** — frontend เลย fallback
เป็น `'อื่นๆ'` 100% ของเวลา ไม่ว่าจะมีกลุ่มปัญหาจริงกี่กลุ่มก็ตาม (บั๊กมีมาตั้งแต่ endpoint นี้ถูกสร้าง ไม่ใช่ regression
ของ session ก่อนหน้า)

**ทำไมแก้ตรงๆ ด้วยการ join defect_categories เข้า query เดิมไม่ได้:** 1 NCR มีได้หลาย `ncr_items` และแต่ละ item
มี `defect_category_id` ของตัวเอง (ไม่จำเป็นต้องเป็นกลุ่มเดียวกัน) — join ตรงๆ เข้า query ระดับ-NCR (ที่มี `GROUP BY
n.id` อยู่แล้วสำหรับ `item_count`) จะทำให้ต้องเลือกว่าใช้กลุ่มปัญหาของ item ไหนเป็นตัวแทนทั้ง NCR ซึ่งไม่มีคำตอบที่
ถูกต้องเดียว

**การแก้:** เพิ่ม query แยกใหม่ใน `GET /api/reports/ncr` ชื่อ `defect_breakdown` — นับ NCR ต่อกลุ่มปัญหาแบบเดียวกับ
`topDefects` ใน `GET /api/reports/summary` ที่มีอยู่แล้ว (pattern เดิมในระบบ, แก้ปัญหาเดียวกันได้ถูกต้องอยู่แล้ว):
`GROUP BY dc.id` + `COUNT(DISTINCT n.id)` — 1 NCR ที่มีหลายรายการคนละกลุ่มปัญหาจะถูกนับใน**ทุกกลุ่ม**ที่เกี่ยวข้อง
(ไม่ mutually exclusive แต่สอดคล้องกับ topDefects เดิม), item ที่ไม่มี `defect_category_id` (หรือ NCR ที่ไม่มี
item เลย) ถูกจัดกลุ่มเป็น `COALESCE(dc.name, 'อื่นๆ')` — ส่ง field ใหม่ `defect_breakdown` กลับไปพร้อม response —
`client/src/pages/Reports/NCRReport.jsx` เปลี่ยนจาก client-side aggregation ที่พังอยู่แล้ว (`n.defect_category_name`)
มาใช้ `data.defect_breakdown` ที่ backend ส่งมาให้ตรงๆ แทน (ลบ `React.useMemo` เดิมออกทั้งก้อน)

**Test:** เพิ่ม `REP-04b` ใน `server/test/reports.test.js` — แท็ก `defect_category_id` ให้ 2 ใน 5 ของ
`ncr_items` ที่มีอยู่แล้วในฟิกซ์เจอร์เดิม (ไม่สร้างบิล/NCR ใหม่ กัน `total_bills`/`total_items`/`pass_rate` ของ
REP-02..04 เปลี่ยนไปโดยไม่ตั้งใจ) แล้วยืนยันว่า `defect_breakdown` มีชื่อกลุ่มปัญหาจริง ("เปียกน้ำ"=1, "สีเพี้ยน"=1)
ไม่ใช่ "อื่นๆ" ทั้งหมด — `node --test` → **339/339 เขียว** (338 baseline + 1 เคสใหม่), `npm run build` (client) ผ่าน

**Verify:** ยังไม่ได้ verify ผ่านมือจริง — แนะนำให้ user เปิดหน้ารายงาน > NCR อีกครั้งแล้วเช็คว่ากราฟวงกลมแยกกลุ่ม
ปัญหาจริงถูกต้องแล้ว (เปียกน้ำ/สีเพี้ยน/DWG-Spec ฯลฯ แยกกันตามจริง ไม่ใช่ "อื่นๅ" รวมกันหมด)

### Files Changed

| File | สิ่งที่ทำ |
|---|---|
| `server/routes/reports.js` | `GET /ncr` — เพิ่ม query `defect_breakdown` (นับ NCR ต่อกลุ่มปัญหา, pattern เดียวกับ `topDefects` ใน `/summary`) |
| `client/src/pages/Reports/NCRReport.jsx` | เลิกคำนวณ `defectData` จาก field ที่ไม่เคยมีอยู่จริง ใช้ `data.defect_breakdown` จาก backend แทน |
| `server/test/reports.test.js` | + REP-04b |

---

## 2026-07-17 | Session 138 — Reports (UAI): เพิ่ม Top 5 Supplier + Export PDF ครบทุกหน้า (การรับเข้า/NCR/UAI)

**คำขอ:** (1) หน้ารายงาน UAI เพิ่ม "Top 5 Supplier มี UAI มากที่สุด" (2) ปรับให้ export เป็น PDF ได้ทุกหน้า —
การรับเข้า, NCR, UAI (เดิมมีแค่หน้าภาพรวมที่ export PDF ได้ ตั้งแต่ S134)

**การแก้ (backend, `server/routes/exports.js`):**
- Refactor `/reports/summary/pdf` เดิมก่อน — สกัด CSS/header-footer-template/ตัวเรนเดอร์ PDF (acquire/release
  slot + isolated page) ที่เคย copy-paste มาก่อน ให้เป็น shared helper 4 ตัว: `pdfRangeLabel(from,to)`,
  `reportPdfStyle()`, `reportPdfHeaderFooter(req,title,rangeLabel,extraInfo)`, `sendReportPdf(res,html,header,
  footer,filename)` — ลด duplication ก่อนเพิ่ม route ใหม่อีก 3 ตัวที่หน้าตาเหมือนกันเกือบหมด (behavior เดิมของ
  `/summary/pdf` ไม่เปลี่ยน แค่เปลี่ยนวิธีประกอบโค้ด — verify ด้วย manual PDF check ว่ายังคืนไฟล์ถูกต้องเหมือนเดิม)
- เพิ่ม 3 route ใหม่ ใช้ query เดียวกับ JSON endpoint คู่กันเป๊ะ (ตรงกับหน้าจอ):
  - `GET /reports/receiving/pdf` — Hero KPI 5 ช่อง (บิลทั้งหมด/รายการทั้งหมด/ผ่าน/ไม่ผ่าน (มี NCR)/อัตราผ่าน) +
    ตารางรายการบิลเต็ม
  - `GET /reports/ncr/pdf` — Hero KPI 5 ช่อง (NCR ทั้งหมด/เปิดอยู่/ปิดแล้ว/Major/Minor) + ตาราง Top 5 กลุ่มปัญหา +
    ตารางรายการ NCR เต็ม
  - `GET /reports/uai/pdf` — Hero KPI 4 ช่อง (UAI ทั้งหมด/เสร็จสมบูรณ์/รอดำเนินการ/ปฏิเสธ) + ตาราง **Top 5
    Supplier มี UAI มากที่สุด** (ใหม่) + ตารางรายการ UAI เต็ม
- `GET /reports/uai` (JSON endpoint ที่หน้าจอเรียก) เพิ่ม query `top_uai_suppliers` แบบเดียวกัน (`GROUP BY s.id
  ORDER BY uai_count DESC LIMIT 5`) ให้หน้าจอ `UAIReport.jsx` ใช้แสดงกราฟได้ ไม่ใช่แค่ตอน export PDF เท่านั้น

**การแก้ (frontend):**
- `client/src/pages/Reports/UAIReport.jsx` — เพิ่มการ์ดกราฟแท่ง "Top 5 Supplier มี UAI มากที่สุด" (BarChart จาก
  recharts, dataKey `uai_count`, สไตล์เดียวกับกราฟ Top 5 NCR ของหน้าภาพรวม) ต่อจาก summary card ก่อนตารางรายการ
  UAI + เพิ่มปุ่ม "Export PDF"
- `Receiving.jsx`, `NCRReport.jsx` — เพิ่มปุ่ม "Export PDF" ข้าง Export Excel เดิม (เรียก route ใหม่ตรงๆ)

**Test:** เพิ่ม 4 เคสใน `server/test/reports.test.js` — `top_uai_suppliers` มีข้อมูล supplier ถูกต้อง +
permission gate (403 ไม่ใช่ 404) ของ PDF route ใหม่ทั้ง 3 ตัว — ไม่ได้เขียน test เรียก Puppeteer จริงในสวีท (ตาม
เหตุผลเดิมที่บันทึกไว้ใน S134 — chrome.exe ค้างบน Windows) แต่**ทำ manual verification ครั้งเดียวนอก suite**
ยิงทั้ง 4 PDF route จริง (summary/receiving/ncr/uai) ยืนยันคืน `200`, `application/pdf`, ขนาดไฟล์จริง 52-59KB
ทุกตัว แล้วลบสคริปต์ + เคลียร์ chrome.exe ที่ค้างทิ้งหลังจบ — `node --test` → **343/343 เขียว** (339 baseline +
4 เคสใหม่), `npm run build` (client) ผ่าน

**Verify:** ยังไม่ได้ verify ผ่านมือจริงในเบราว์เซอร์ (กดปุ่มจริงจากหน้าเว็บ) — แนะนำให้ user ลองกด Export PDF ทั้ง
3 หน้าใหม่ (การรับเข้า/NCR/UAI) และดูกราฟ Top 5 Supplier บนหน้า UAI ว่าตรงกับข้อมูลจริง

### Files Changed

| File | สิ่งที่ทำ |
|---|---|
| `server/routes/exports.js` | + shared PDF helpers (`pdfRangeLabel`/`reportPdfStyle`/`reportPdfHeaderFooter`/`sendReportPdf`), refactor `/reports/summary/pdf` ให้ใช้ helper เหล่านี้, + `GET /reports/{receiving,ncr,uai}/pdf` ใหม่ทั้งหมด |
| `server/routes/reports.js` | `GET /uai` เพิ่ม query `top_uai_suppliers` |
| `client/src/pages/Reports/UAIReport.jsx` | + กราฟ Top 5 Supplier มี UAI มากที่สุด, ปุ่ม Export PDF |
| `client/src/pages/Reports/Receiving.jsx`, `NCRReport.jsx` | + ปุ่ม Export PDF |
| `server/test/reports.test.js` | + REP-04c, REP-05b/c/d (4 เคสใหม่) |

---

## 2026-07-17 | Session 139 — เมนูรายงาน: เพิ่มสิทธิ์ QC Supervisor, ผู้จัดการจัดซื้อ (COO/CMO/CPO/ผู้จัดการ QC มีอยู่แล้ว)

**คำขอ:** เพิ่มเมนู "รายงาน" ให้ QC supervisor, ผู้จัดการ QC, COO, CMO, CPO, ผู้จัดการจัดซื้อ — ตรวจแล้วพบว่า
`qc_manager`/`cco`/`cmo`/`cpo` เข้าถึงได้อยู่แล้วเดิม (`REPORT_ROLES` เดิมมี 4 role นี้) เหลือแค่ **`qc_supervisor`**
กับ **`purchasing_manager`** ที่ยังไม่มีสิทธิ์ — เพิ่ม 2 role นี้เข้าไปทั้ง 4 จุดที่ gate สิทธิ์เมนูนี้ (backend 2 ไฟล์
+ frontend 2 ไฟล์ ต้องแก้ให้ตรงกันทั้งหมด ไม่งั้นเมนูขึ้นแต่กด endpoint จริงแล้ว 403):

- `server/routes/reports.js`, `server/routes/exports.js` — `REPORT_ROLES` (const แยกกันคนละไฟล์ ไม่ได้ share
  module เดียวกัน ต้องแก้ทั้งคู่) จาก `['qc_manager','cco','cmo','cpo']` → `['qc_supervisor','qc_manager',
  'purchasing_manager','cco','cmo','cpo']` — คุมทุก endpoint ของเมนูรายงาน (JSON 4 ตัว + Excel 4 ตัว + PDF 4 ตัว)
- `client/src/utils/rolePermissions.js` — nav item `/reports` roles list เดียวกัน (ควบคุมว่าเมนูโชว์ใน Sidebar/
  BottomNav ให้ role ไหนเห็น)
- `client/src/App.jsx` — `ProtectedRoute` ของ route `reports` (ครอบทั้ง 4 หน้าลูก summary/receiving/ncr/uai
  ในทีเดียว เพราะ nested route เดียวกันหมด ไม่ต้องแก้ทีละหน้า)

**Test:** เพิ่ม 2 เคสใน `server/test/reports.test.js` (REP-01b/c) — สร้าง user role `purchasing_manager` ใหม่
(ไม่มี seed เริ่มต้น) ยืนยันว่า `qc_supervisor` (seed `supervisor1`) และ `purchasing_manager` เข้า `/reports/summary`
ได้ 200 แล้ว (เดิมจะเป็น 403) — `node --test` → **345/345 เขียว** (343 baseline + 2 เคสใหม่), `npm run build`
(client) ผ่าน

**Verify:** ยังไม่ได้ verify ผ่านมือจริง — แนะนำให้ user login ด้วย user จริงที่เป็น QC supervisor และผู้จัดการ
จัดซื้อ เช็คว่าเห็นเมนู "รายงาน" ใน Sidebar/มือถือแล้ว และกดเข้าทั้ง 4 หน้าได้จริง (รวม Export Excel/PDF)

### Files Changed

| File | สิ่งที่ทำ |
|---|---|
| `server/routes/reports.js` | `REPORT_ROLES` เพิ่ม `qc_supervisor`, `purchasing_manager` |
| `server/routes/exports.js` | `REPORT_ROLES` เพิ่ม `qc_supervisor`, `purchasing_manager` (const แยกจาก reports.js) |
| `client/src/utils/rolePermissions.js` | nav item `/reports` roles เพิ่ม 2 role เดียวกัน |
| `client/src/App.jsx` | `ProtectedRoute` ของ route `reports` เพิ่ม 2 role เดียวกัน |
| `server/test/reports.test.js` | + REP-01b, REP-01c |

---

## 2026-07-18 | Session 141 — Render Bandwidth Audit + Phase 1 Fix: Backup ข้าม R2 upload ถ้า DB ไม่เปลี่ยน

**คำขอ:** Render ใช้ Outbound Bandwidth สูงผิดปกติ — ให้อ่านโค้ดทั้งโปรเจกต์วิเคราะห์หาสาเหตุ (ห้ามเดา ต้องอ้างอิง
ไฟล์/บรรทัด) ครอบคลุม 18 หัวข้อ (API polling, React re-render, network payload, static files, Express
middleware, logging, database, dashboard, file download, upload, socket, cron, Litestream, Render config,
third-party API, memory leak, client cache, security) แล้วทำรายงาน + Optimization Plan เป็น Phase 1/2/3

**การวิเคราะห์:** ใช้ 3 Explore agent คู่ขนานอ่านทั้ง client (React/Vite), ทั้ง server (Express/better-sqlite3),
และ deploy config ทั้งหมด (Dockerfile, docker-compose, DEPLOYMENT.md, `.github/workflows`,
`.env.production.example`, `vite.config.js`) แล้ว manual-verify ข้อค้นพบที่รุนแรงที่สุด 2-3 จุดตรงกับ source จริง
ก่อนสรุปรายงาน (ไม่เชื่อ agent summary เฉยๆ) — รายงานเต็มอยู่ใน plan file ของ session นี้ (ผ่าน Plan Mode)

**พบ 2 สาเหตุระดับ Critical:**
1. `server/lib/backupService.js:116-129` (`runHotBackup`, เรียกทุก 10 นาทีจาก `server/index.js:664`) — VACUUM
   snapshot DB (วัดจริง 2,998,272 bytes/~2.86MB) แล้วอัปโหลดทับ R2 **ทุกครั้งไม่มีเงื่อนไข** แม้ข้อมูลไม่เปลี่ยนเลย
   ตั้งแต่รอบก่อน → ~144 ครั้ง/วัน (คงที่ตลอด 24 ชม. เพราะ keep-alive ping กันไม่ให้ Render Free sleep)
2. **ไม่มี `compression()` middleware เลยในเส้นทาง deploy จริงบน Render** — nginx gzip (VPS-only) ไม่มีบน Render
   (`DEPLOYMENT.md:154-156` ยืนยัน Render จัดการ proxy/TLS เอง ไม่ใช้ nginx) ทุก JSON response + JS bundle
   (วัดจริง 1,893,828 bytes) ส่งแบบไม่บีบอัดเลย

**ยืนยันด้วยข้อมูลจริงจาก user (Render dashboard, ระหว่าง session):** 4.31GB/5GB ใช้ไปแล้ว แบ่งเป็น
**Service-Initiated 3.91GB (90.7%)** vs **HTTP Responses 412MB (9.5%)** — "Service-Initiated" = traffic ที่
backend เป็นฝ่ายเรียกออกเอง (ไม่ใช่ตอบ request ผู้ใช้) ซึ่งในโค้ดทั้งระบบมีแค่ backup→R2 เท่านั้นที่มีขนาดระดับ MB
(Telegram/SMTP เป็นข้อความสั้นระดับ KB) — **ยืนยันเด็ดขาดว่าข้อ 1 (backup re-upload) คือสาเหตุหลักของ bandwidth
เกือบทั้งหมด ไม่ใช่แค่ผู้ต้องสงสัยอันดับ 1 เฉยๆ** — ส่วนข้อ 2 (compression) กระทบแค่ 412MB "HTTP Responses" เท่านั้น
คนละช่องทางกับปัญหาหลัก

**การแก้ (Phase 1, เฉพาะข้อ 1 ตามที่ user ขอ — ข้อ 2/3/6/11 ยังไม่แตะ รอ user สั่งต่อ):**
`server/lib/backupService.js` — `runHotBackup()` เพิ่ม SHA-256 hash ของ snapshot ก่อนอัปโหลด เทียบกับ hash ของ
รอบก่อนหน้า (`_lastHotBackupHash`, module-level in-memory — รีเซ็ตเป็น `null` ทุกครั้ง process restart ตั้งใจ
เพราะ restart ควรอัปโหลดอย่างน้อย 1 ครั้งเพื่อความชัวร์) — hash ตรงกัน = ไม่มีอะไรเปลี่ยนเลยตั้งแต่รอบก่อน → ข้าม
`r2.putObjectFromFile`/`putJson` ทั้งคู่ทันที (ลบ tmp snapshot ทิ้งใน `finally` เหมือนเดิม) — hash ต่างกัน (หรือ
ครั้งแรกหลัง restart ที่ `_lastHotBackupHash` ยัง `null`) → อัปโหลดตามปกติ แล้วค่อยอัปเดต `_lastHotBackupHash`
**หลัง**อัปโหลดสำเร็จเท่านั้น (ถ้า `putObjectFromFile` throw จะไม่อัปเดต hash — รอบถัดไปจะลองอัปโหลด content เดิม
ซ้ำ ไม่ข้ามไปเงียบๆ ทั้งที่ยังไม่เคยอัปโหลดสำเร็จจริง) — คง 10 นาที/รอบเดิมไว้ (ไม่กระทบ RPO ตาม CLAUDE.md §27.3
ที่ตั้งใจ 10 นาทีไว้อยู่แล้ว) แค่ข้าม network call ตอนไม่มีอะไรเปลี่ยน — `runDailyFifoBackup()`/`syncUploads()`
ไม่แตะ (มี guard ของตัวเองอยู่แล้ว/incremental diff อยู่แล้ว ปริมาณเล็กเทียบกับ hot backup)

**Test:** เพิ่ม `resetHotBackupDedup()` (export เฉพาะไว้ทดสอบ — จำลอง "process restart" ระหว่างเทสหลายเคสในไฟล์
เดียวกัน) เรียกใน BACKUP-05/06 เดิม (กัน hash ค้างจากเทสก่อนหน้าทำให้ทดสอบ path ผิดไปเงียบๆ) + เพิ่ม 2 เคสใหม่:
BACKUP-05b (เรียกซ้ำ 2 ครั้งติดกัน DB ไม่เปลี่ยน → ครั้งที่ 2 ไม่เรียก `putObjectFromFile` เลย) และ BACKUP-05c
(insert แถวใหม่จริงเข้า DB ระหว่างรอบ → รอบถัดไปอัปโหลดใหม่เพราะ hash เปลี่ยนจริง) — `node --test` →
**347/347 เขียว** (345 baseline + 2 เคสใหม่) — ไม่มีการเปลี่ยน client เลย รอบนี้ไม่ต้อง `npm run build`

**Verify:** ยังไม่ได้ verify กับ Render bandwidth จริง (ต้อง deploy ก่อน) — แนะนำเช็ค Render dashboard เทียบ
Service-Initiated bandwidth ก่อน/หลัง deploy ~24-48 ชม. เพื่อยืนยันตัวเลขจริง (รายงานเดิมประมาณจากขนาด DB วัดจริง
คำนวณย้อนหลัง ไม่ใช่ traffic log จริง) — Phase 1 ที่เหลือ (compression, cache-control, Excel rate limit) ยังไม่ทำ
ตามที่ user ขอให้ทำแค่ Patch 1 ก่อน

### Files Changed

| File | สิ่งที่ทำ |
|---|---|
| `server/lib/backupService.js` | `runHotBackup()` เพิ่ม hash-check ข้าม R2 upload ถ้า snapshot ไม่เปลี่ยนจากรอบก่อน, + `resetHotBackupDedup()` (test-only export) |
| `server/test/backupService.test.js` | BACKUP-05/06 เรียก `resetHotBackupDedup()` กันเทสเก่าพัง, + BACKUP-05b/05c (2 เคสใหม่) |
| `C:\Users\Narabas.s\.claude\plans\squishy-purring-hammock.md` | Bandwidth Analysis Report เต็ม (นอก repo — plan file, ไม่ commit) |

---

## 2026-07-20 | Session 149 — Suppliers export/import: กลับคำ S148 — "กลุ่มสินค้า" เปลี่ยนจาก Y/N-matrix เป็น comma-separated

**คำขอ:** ที่ผู้ผลิตปรับ export/import excel ใหม่ สำหรับชื่อกลุ่มสินค้าให้ใช้เป็น comma แทน (เช่น "SupA,SubB,SubC")
ไม่ต้องเพิ่มหัวข้อแยกซับแล้วใส่ Y เพราะซับเยอะมากดูยาก — กลับคำการตัดสินใจของ Session 148 ทันทีหลังทำเสร็จ (จำนวน
กลุ่มสินค้าจริงในระบบมากกว่าที่ประเมินไว้ตอน S148 พอเห็นไฟล์จริงแล้วคอลัมน์เยอะเกินไป)

**การแก้ (`server/routes/master.js`):**
- `GET /suppliers/export`: เอาคอลัมน์ Y/N ต่อกลุ่มสินค้าออกทั้งหมด แทนด้วยคอลัมน์เดียว "กลุ่มสินค้า (คั่นด้วย , ถ้า
  มากกว่า 1)" อยู่ตำแหน่งคงที่ (คอลัมน์ 6 ต่อจาก "หมายเหตุ") ค่าเป็น comma-separated เช่น "กลุ่ม A, กลุ่ม B" —
  รูปแบบเดียวกับ Products.jsx's Supplier field (S129) เป๊ะๆ (ตอนนั้นเลือก comma เพราะ Supplier มีเป็นร้อย ตอนนี้
  ใช้เหตุผลเดียวกันกับกลุ่มสินค้าที่มีมากกว่าที่คาด) — คอลัมน์ผู้ดูแลจัดซื้อยังเป็น Y/N-matrix เหมือนเดิม (จำนวนน้อย
  จริง ~3 คน ไม่ได้อยู่ในขอบเขตคำขอนี้) เลื่อนไปเริ่มที่คอลัมน์ 7
- `POST /suppliers/import`: parse คอลัมน์ 6 แบบ comma-separated (`split(',').map(trim).filter(Boolean)`) resolve
  ชื่อกลุ่มแบบ case-insensitive ผ่าน `groupNameToId` — ชื่อไม่รู้จัก = **warning ต่อแถว** (ไม่ error ทั้งแถว เพราะ
  กลุ่มสินค้าไม่ใช่ field บังคับของ supplier ต่างจาก Supplier field ของ Products ที่บังคับ) diff เทียบ set กลุ่ม
  เดิม/ใหม่เหมือน S148 (`+เพิ่ม -ลบ`) แต่ sync แบบ **full-replace ไม่ scope อีกต่อไป** (`DELETE ... WHERE
  supplier_id=?` ล้วนๆ ไม่ต้อง scope ด้วย recognized column ids เหมือน matrix เดิม เพราะคอลัมน์เดียวแทนสมาชิก
  ทั้งหมดของ supplier นั้นเสมอ ไม่มีแนวคิด "คอลัมน์ที่ไฟล์นี้จำได้บางส่วน" อีกแล้ว) — คอลัมน์ผู้ดูแลจัดซื้อ (dynamic,
  เริ่ม col 7) ยังใช้ scoped-delete แบบเดิมไม่เปลี่ยน
- header ที่ import ตรวจ (`checkHeaders`) เพิ่ม "กลุ่มสินค้า (คั่นด้วย , ถ้ามากกว่า 1)" เป็น header ตัวที่ 6 บังคับ
  (fixed position ต่างจาก assignee/group เดิมที่เป็น dynamic ทั้งคู่)

**Test:** เขียน `server/test/suppliersImportExport.test.js` ใหม่ทั้งหมดสำหรับ IMPEXP-12..17 (แทนที่ 6 เคส Y/N-matrix
เดิมของ S148) — export คอลัมน์เดียว comma-separated ค่าตรง, import เปลี่ยนกลุ่ม A→B ผ่านคอลัมน์เดียว → update+
junction sync ถูกต้อง, import ซ้ำค่าเดิม → skip, ชื่อกลุ่มไม่รู้จักในคอลัมน์ → warning ต่อแถว (ไม่ error) +
กลุ่มนั้นไม่ถูกนับ, supplier ใหม่พร้อมหลายกลุ่มคั่น comma → insert ถูกต้องทั้งคู่ — ปรับ `buildImportXlsx()` helper
เอา `groupHeaders` param ออก (ไม่ต้องมีแล้วเพราะกลุ่มเป็น fixed column ไม่ใช่ dynamic) เปลี่ยนเป็นใส่ header กลุ่ม
สินค้าคงที่เสมอ + rows ทุกแถวต้องมี groups-comma-cell แทรกที่ตำแหน่ง 6 ก่อนคอลัมน์ผู้ดูแลจัดซื้อ — ปรับ IMPEXP-01..11
เดิมให้มี cell ว่างที่ตำแหน่งกลุ่มสินค้าด้วย (header บังคับ exact-match แล้ว) — `node --test` → **364/364 เขียว**
(จำนวนเทสเท่าเดิม เพราะแทนที่ ไม่ได้เพิ่ม) — ไม่มี frontend เปลี่ยนรอบนี้ (Suppliers.jsx's badge-button multi-select
ในฟอร์มไม่แตะ — คำขอเจาะจงแค่ฝั่ง Excel round-trip)

**Verify:** ยังไม่ได้ verify ผ่านมือจริง — แนะนำให้ user export ไฟล์ Suppliers ใหม่ เช็คว่าคอลัมน์กลุ่มสินค้าเหลือ
คอลัมน์เดียว ค่าเป็น comma-separated ตามที่ตั้งไว้ แล้วลองแก้ค่าแล้ว import กลับดูว่า diff แสดงถูกต้อง

### Files Changed

| File | สิ่งที่ทำ |
|---|---|
| `server/routes/master.js` | `GET/POST /suppliers/{export,import}` เปลี่ยนคอลัมน์กลุ่มสินค้าจาก Y/N-matrix (S148) เป็นคอลัมน์เดียว comma-separated |
| `server/test/suppliersImportExport.test.js` | เขียน IMPEXP-12..17 ใหม่ทั้งหมด (comma format), `buildImportXlsx()` เอา `groupHeaders` param ออก, ปรับ IMPEXP-01..11 ให้มี group cell ว่าง |

---

## 2026-07-20 | Session 148 — Master List: Suppliers export/import เพิ่มคอลัมน์ "กลุ่มสินค้า" ให้สัมพันธ์กับตาราง

**คำขอ:** ปรับปุ่ม export/import ในเมนู Master List ให้สัมพันธ์กับตารางทุกหน้า

**สิ่งที่พบ (ตรวจครบทั้ง 6 หน้า Master List):** ตรวจ header ตาราง vs. คอลัมน์ export ทีละหน้า — ProductGroups/
Units/DefectCategories/Colors ยังตรงกับตาราง/ฟอร์มครบตั้งแต่ S129 (ไม่มี field ใหม่เพิ่มหลังจากนั้น), Products
export/import ก็ยังตรงกับฟอร์มครบ (มี Model/สี/multi-supplier ตั้งแต่ S129) — **มีจุดเดียวที่ไม่สัมพันธ์กันจริง:
Suppliers** — ตาราง/ฟอร์มหน้า "ผู้ผลิต" เพิ่งได้ multi-select "กลุ่มสินค้าที่ผลิต/ส่งได้" ใน S146 (แสดงเป็น badge
สีม่วงในตาราง) แต่ export/import Excel (เดิมจาก S128k/S129) ยังไม่มีคอลัมน์นี้เลย

**การแก้ (`server/routes/master.js`):**
- เพิ่ม `getActiveProductGroups()` (คู่กับ `getActivePurchasingUsers()` เดิม)
- `GET /suppliers/export`: เพิ่มคอลัมน์ Y/ว่าง ต่อ 1 กลุ่มสินค้า (matrix แบบเดียวกับ "ผู้ดูแลจัดซื้อ" ที่มีอยู่แล้ว
  บนชีตเดียวกัน — เหตุผลเดียวกับตอนตัดสินใจให้ Suppliers ใช้ matrix ใน S129: จำนวนกลุ่มสินค้าน้อย ต่างจากคอลัมน์
  Supplier ของ Products ที่ใช้ comma-separated เพราะมี Supplier เป็นร้อย) วางต่อท้ายคอลัมน์ผู้ดูแลจัดซื้อ (ไม่แทรก
  กลาง กันไฟล์เก่าที่มีอยู่แล้วขยับตำแหน่งคอลัมน์)
- `POST /suppliers/import`: จับคู่ header คอลัมน์ตั้งแต่ col 6 เป็นต้นไปกับ**ทั้งชื่อผู้ดูแลจัดซื้อและชื่อกลุ่มสินค้า
  พร้อมกัน**(เช็คชื่อ user ก่อน ไม่เจอค่อยเช็คชื่อกลุ่ม) — ไม่อิงตำแหน่ง/จำนวนคอลัมน์คงที่เลย (จับคู่ด้วยชื่อล้วนๆ
  เหมือนเดิม) กันปัญหาตำแหน่งขยับเวลาจำนวนผู้ดูแลจัดซื้อหรือกลุ่มสินค้าเปลี่ยนระหว่าง export กับ import — diff-aware
  sync กลุ่มสินค้าเหมือนผู้ดูแลจัดซื้อทุกกระเบียดนิ้ว (scoped-by-recognized-column กันไฟล์เก่าไม่มีคอลัมน์กลุ่มใหม่
  ไปล้างกลุ่มที่เพิ่งเพิ่มทีหลัง, `changes[]` แสดง `+กลุ่ม B -กลุ่ม A`, skip ถ้าไม่มีอะไรเปลี่ยนจริง)

**ขอบเขต:** ตรวจครบ 6 หน้าแล้วพบว่าต้องแก้แค่ Suppliers เท่านั้น — Products/ProductGroups/Units/
DefectCategories/Colors export/import ยังสัมพันธ์กับตาราง/ฟอร์มของตัวเองอยู่แล้ว ไม่ต้องแก้อะไรเพิ่ม

**Test:** `server/test/suppliersImportExport.test.js` เพิ่ม 6 เคสใหม่ (IMPEXP-12..17, สร้างกลุ่มสินค้าทดสอบ 2 กลุ่ม
เป็น fixture ใหม่) — export มีคอลัมน์กลุ่มสินค้าครบ+ค่าถูกต้อง, import เปลี่ยนกลุ่ม A→B → update+junction sync
ถูกต้อง, ไฟล์เก่าไม่มีคอลัมน์กลุ่มใหม่ → ไม่ถูกแตะ, header กลุ่มไม่รู้จัก → เตือนไม่ block, supplier ใหม่ → insert
พร้อมกลุ่มถูกต้อง — เทสเดิม 11 เคส (ที่ไฟล์ import ไม่มีคอลัมน์กลุ่มเลย) ยังผ่านหมดไม่ต้องแก้อะไร (พิสูจน์ backward
compatible จริง) — `node --test` → **364/364 เขียว** (358 baseline + 6 เคสใหม่) — ไม่มี frontend เปลี่ยนรอบนี้
(`ExcelImportModal.jsx` เดิม render `changes[]`/`headerWarnings` generic อยู่แล้ว ไม่ต้องแก้)

**Verify:** ยังไม่ได้ verify ผ่านมือจริง — แนะนำให้ user export ไฟล์ Suppliers ใหม่ เช็คว่ามีคอลัมน์กลุ่มสินค้าที่ตั้ง
ไว้ครบ แล้วลองแก้ค่า Y/ว่าง แล้ว import กลับดูว่า diff แสดงถูกต้อง

### Files Changed

| File | สิ่งที่ทำ |
|---|---|
| `server/routes/master.js` | + `getActiveProductGroups()`, `GET/POST /suppliers/{export,import}` เพิ่มคอลัมน์กลุ่มสินค้า (Y/ว่าง ต่อกลุ่ม) แบบ diff-aware |
| `server/test/suppliersImportExport.test.js` | + IMPEXP-12..17 (6 เคสใหม่), `buildImportXlsx()` เพิ่ม param `groupHeaders` (optional) |

---

## 2026-07-20 | Session 147 — แก้ Products form: filter Supplier ตามกลุ่มดูเหมือนไม่ทำงาน (ตัด fallback ออก)

**คำขอ:** หลัง S146 deploy — เลือกกลุ่มสินค้าในฟอร์มเพิ่มสินค้าใหม่แล้ว Supplier ยังโชว์ทุกรายเหมือนเดิม ไม่กรองตาม
กลุ่มที่บันทึกไว้ที่หน้า "ผู้ผลิต" เลย (ตามภาพหน้าจอที่ user ส่งมา)

**Root cause:** `client/src/pages/Master/Products.jsx`'s `filteredSuppliers` ที่เพิ่งเขียนใน S146 ตั้งใจใส่
fallback ไว้ตอนแรก — "Supplier ที่ยังไม่เคยถูกตั้งกลุ่มสินค้าเลย (`product_group_ids` ว่าง) ให้โชว์ทุกกลุ่มไว้ก่อน"
(เหตุผลตอนนั้น: กันฟอร์มใช้ไม่ได้เลยทันทีหลัง deploy เพราะยังไม่มี Supplier รายไหนถูกตั้งกลุ่มเลย) — แต่ในทางปฏิบัติ
ระบบมี Supplier ~131 ราย และ user เพิ่งเริ่มตั้งกลุ่มให้แค่บางรายเท่านั้น ทำให้ Supplier ส่วนใหญ่ที่ยังไม่ถูกตั้งกลุ่ม
**ยังคงโชว์อยู่ทุกกลุ่มตาม fallback** บดบังผลของการกรองจนดูเหมือนฟีเจอร์ไม่ทำงานเลย (ทั้งที่ label "กรองตามกลุ่ม..."
ที่หัวช่องแสดงถูกต้อง ยืนยันว่า logic ทำงานอยู่จริง แค่ fallback กว้างเกินไป)

**การแก้:** ตัด fallback ออก เปลี่ยนเป็นกรองแบบเข้มงวด — โชว์เฉพาะ Supplier ที่มี `product_group_ids` ตรงกับกลุ่มที่
เลือกจริงๆ เท่านั้น (`suppliers.filter(s => (s.product_group_ids || []).map(String).includes(String(form.
product_group_id)))`) ตรงกับสเปกเดิมที่ user ให้ตัวอย่างมาตั้งแต่แรก (SupA/SupB กลุ่ม 1 → เลือกกลุ่ม 1 เห็นแค่ 2
รายนี้) — ข้อความ "ไม่มี Supplier ในกลุ่มสินค้านี้ — ไปเพิ่มกลุ่มสินค้าให้ Supplier ที่หน้า 'ผู้ผลิต' ก่อน" ที่มีอยู่
แล้วจะขึ้นบ่อยกว่าเดิมตอนนี้ (ทุกกลุ่มที่ยังไม่มี Supplier ถูกตั้งไว้เลย) ซึ่งเป็นพฤติกรรมที่ตั้งใจแล้ว — user ต้อง
ไปตั้งกลุ่มให้ Supplier แต่ละรายที่หน้า "ผู้ผลิต" ก่อนถึงจะเลือกได้ในฟอร์มสินค้า

**Test:** ไม่มี backend เปลี่ยน (แก้แค่ client-side filter logic ที่ไม่เคยมี automated test คลุมอยู่แล้ว — ทดสอบ
ผ่าน backend test เดิมของ S146 ยัง 358/358 เขียวเหมือนเดิม เพราะ backend ไม่ได้แตะ), `npm run build` (client) ผ่าน

**Verify:** ยังไม่ได้ verify ผ่านมือจริง — แนะนำให้ user ลองอีกครั้งกับกลุ่ม/Supplier ที่ตั้งค่าไว้แล้ว (เช่นตัวอย่าง
"สินค้า FG" ในภาพ ต้องไปตั้งที่หน้า "ผู้ผลิต" ก่อนว่ามี Supplier รายไหนอยู่กลุ่มนี้บ้าง ถึงจะเห็นผลกรอง)

### Files Changed

| File | สิ่งที่ทำ |
|---|---|
| `client/src/pages/Master/Products.jsx` | `filteredSuppliers` ตัด fallback (Supplier ที่ยังไม่ตั้งกลุ่มโชว์ทุกกลุ่ม) ออก เปลี่ยนเป็นกรองเข้มงวด |

---

## 2026-07-20 | Session 146 — ผู้ผลิต↔กลุ่มสินค้า (m:n) + Products form: กรอง Supplier ตามกลุ่ม

**คำขอ:** (1) หน้า Master List > ผู้ผลิต ให้เพิ่มกลุ่มสินค้าที่ผู้ผลิตได้ 1 ผู้ผลิตเลือกได้มากกว่า 1 กลุ่ม
(2) ฟอร์มเพิ่มสินค้าใหม่ ให้ช่องเลือกกลุ่มสินค้าขึ้นก่อน Supplier แล้วพอเลือกกลุ่มเสร็จให้กรอง Supplier ที่มีในกลุ่ม
นั้นเท่านั้น + มีปุ่มเลือก Supplier ทั้งหมด (ตัวอย่าง: SupA/SupB อยู่กลุ่ม 1, SupC อยู่กลุ่ม 2 — เลือกกลุ่ม 1 ต้องเห็น
แค่ SupA/SupB)

**การแก้ (backend):**
- `server/db/database.js` — เพิ่ม junction table `supplier_product_groups` (m:n, `PRIMARY KEY (supplier_id,
  product_group_id)`, `ON DELETE CASCADE` ทั้งคู่) — คัดลอก pattern เดียวกับ `supplier_purchasing_assignees`
  ที่มีอยู่แล้ว (S125) ทุกจุด
- `server/routes/master.js` — เพิ่ม `attachSupplierProductGroups(rows)` (batch-attach `product_groups`/
  `product_group_ids` ให้แต่ละแถว, เหมือน `attachSupplierPurchasingAssignees` เป๊ะ) แล้ว wire เข้า `GET /suppliers`
  ทั้ง 2 branch (paginate + all list), `POST /suppliers` (insert junction ใน transaction เดียวกับสร้าง
  supplier), `PATCH /suppliers/:id` (full-replace: `DELETE` ทั้งหมดของ supplier นั้นแล้ว insert ใหม่ — เหมือน
  `purchasing_user_ids` เป๊ะ)

**การแก้ (frontend, `client/src/pages/Master/Suppliers.jsx`):**
- `SupplierForm`: เพิ่ม multi-select "กลุ่มสินค้าที่ผลิต/ส่งได้" แบบ badge-button + ปุ่ม "เลือกทั้งหมด/ยกเลิกทั้งหมด"
  (คัดลอก UI pattern จาก "ผู้ดูแลจัดซื้อ" ที่มีอยู่แล้วในฟอร์มเดียวกันทุกกระเบียดนิ้ว) — fetch `product-groups` ที่
  parent component แล้วส่งเป็น prop `productGroups`
- ตาราง desktop + card มือถือ: เพิ่มคอลัมน์/badge แสดงกลุ่มสินค้าที่ผู้ผลิตแต่ละรายมี (สีม่วง แยกจาก badge
  ผู้ดูแลจัดซื้อสีฟ้าเดิม) — `colSpan` ของแถว loading/empty ปรับจาก 7 → 8 ตามคอลัมน์ที่เพิ่ม

**การแก้ (frontend, `client/src/pages/Master/Products.jsx` — ฟอร์มเพิ่ม/แก้สินค้า):**
- สลับตำแหน่ง: ย้าย "กลุ่มสินค้า *" (จับคู่กับ "หน่วยนับ *" เหมือนเดิม) ขึ้นมาอยู่**ก่อน** "Supplier *" (เดิม
  Supplier อยู่บนสุด, กลุ่มสินค้าอยู่ล่าง)
- เลือกกลุ่มสินค้าแล้ว **เคลียร์ `supplier_ids` ทันที** (กันเลือก supplier ค้างจากกลุ่มเก่าที่ตอนนี้ถูกกรองออกไปแล้ว
  มองไม่เห็นในลิสต์แต่ยังนับว่าเลือกอยู่ ซึ่งจะสับสน) — clear เกิดเฉพาะตอน user เปลี่ยน dropdown เอง ไม่กระทบตอน
  เปิดฟอร์มแก้ไขสินค้าเดิม (initial state set ครั้งเดียวตอน mount ไม่ผ่าน onChange นี้)
- คำนวณ `filteredSuppliers` จาก `suppliers` ที่ query มาแล้ว (ไม่มี query ใหม่เพิ่ม) — logic กรอง: **Supplier ที่ยัง
  ไม่เคยถูกตั้งกลุ่มสินค้าเลย (`product_group_ids` ว่าง) ให้โชว์ทุกกลุ่มไว้ก่อนเป็นค่าเริ่มต้น (fallback)** — เหตุผล:
  ฟีเจอร์นี้เพิ่งเพิ่ม ถ้ากรองเข้มงวด (โชว์เฉพาะที่ระบุกลุ่มตรงเท่านั้น) ฟอร์มนี้จะใช้งานแทบไม่ได้เลยทันทีหลัง deploy
  เพราะยังไม่มี supplier รายไหนถูกตั้งกลุ่มเลยสักราย จนกว่า admin จะไปตั้งค่าให้ทีละราย (131 รายตาม audit ก่อนหน้า)
  — ตรงกับ convention เดิมที่ระบบใช้อยู่แล้วหลายจุด (เช่น `purchasingVisibilitySQL`) ที่ให้ของที่ยังไม่ถูก assign
  แสดงเป็น fallback เสมอแทนที่จะหายไปเงียบๆ
- ปุ่ม "เลือก Supplier ทั้งหมด" (toggle เป็น "ยกเลิก Supplier ทั้งหมด" เมื่อเลือกครบ) เลือกจาก `filteredSuppliers`
  ปัจจุบันเท่านั้น (ไม่ใช่ supplier ทั้งหมดในระบบ) — ข้าง label "Supplier *" มีข้อความบอกด้วยว่ากำลังกรองตามกลุ่ม
  ไหนอยู่ ถ้า filteredSuppliers ว่างเปล่า (มี supplier ระบุกลุ่มไว้แล้วแต่ไม่มีใครอยู่กลุ่มนี้เลย) โชว์ข้อความแนะนำให้
  ไปตั้งกลุ่มที่หน้า "ผู้ผลิต" ก่อน

**ขอบเขตที่ตั้งใจไม่ทำรอบนี้:** ไม่ได้เพิ่ม `product_group_ids` เข้า Excel export/import ของ Suppliers (S128k/S129
เดิม) — user ระบุแค่หน้าฟอร์ม Master List ไม่ได้พูดถึง Excel เลย จะเพิ่มให้ทีหลังถ้าต้องการ

**Test:** `server/test/supplierProductGroups.test.js` ใหม่ทั้งหมด (8 เคส) — คัดลอกโครง
`supplierPurchasing.test.js` (S125) มาปรับ: สร้าง supplier พร้อม `product_group_ids`, GET ทั้ง 2 branch
(paginate/all list) แสดงค่าถูกต้อง, PATCH เพิ่มเป็น 2 กลุ่ม + junction ครบ, PATCH ล้างเป็น `[]` → junction
row หายหมด (ไม่ leftover), permission qc_staff สร้างไม่ได้, และเคสตรงตามตัวอย่างที่ user ให้มาเป๊ะ (SupA/SupB
กลุ่ม 1, SupC กลุ่ม 2 — query แยกกลุ่มถูกต้อง) — `node --test` → **358/358 เขียว** (350 baseline + 8 เคสใหม่),
`npm run build` (client) ผ่าน

**Verify:** ยังไม่ได้ verify ผ่านมือจริงในเบราว์เซอร์ — แนะนำให้ user ไปตั้งกลุ่มสินค้าให้ supplier สัก 2-3 รายที่หน้า
"ผู้ผลิต" ก่อน แล้วลองเปิดฟอร์มเพิ่มสินค้าใหม่ดูว่าเลือกกลุ่มแล้ว Supplier กรองถูกต้องตามที่ตั้งไว้

### Files Changed

| File | สิ่งที่ทำ |
|---|---|
| `server/db/database.js` | + junction table `supplier_product_groups` |
| `server/routes/master.js` | + `attachSupplierProductGroups()`, wire เข้า `GET/POST/PATCH /suppliers` ทุกจุด |
| `client/src/pages/Master/Suppliers.jsx` | ฟอร์มเพิ่ม multi-select กลุ่มสินค้า, ตาราง/การ์ดเพิ่มคอลัมน์แสดงกลุ่ม |
| `client/src/pages/Master/Products.jsx` | สลับลำดับกลุ่มสินค้า/Supplier, กรอง Supplier ตามกลุ่ม (มี fallback), ปุ่มเลือก Supplier ทั้งหมด |
| `server/test/supplierProductGroups.test.js` | ใหม่ทั้งหมด — 8 เคส |

---

## 2026-07-18 | Session 145 — บิลรับเข้า: เพิ่ม sort ที่หัวตารางทุกช่อง

**คำขอ:** หน้า "บิลรับเข้า" (`/bills`) เพิ่มการ sort ที่หัวตารางทุกคอลัมน์

**การแก้ (`client/src/pages/Bills/index.jsx`):** ใช้ pattern เดิมที่มีอยู่แล้วในระบบ (`hooks/useSortable.js` +
`components/UI/SortTh.jsx`) แทรกขั้น sort เข้าไประหว่าง filter (`filtered`) กับ pagination (`pageRows`) — เดิม
`pageRows = filtered.slice(...)` ตรงๆ เปลี่ยนเป็น `pageRows = sorted.slice(...)` โดย `sorted` มาจาก
`useSortable(sortableRows, '')` (default key ว่าง = ไม่ sort เอง คงลำดับเดิมจาก backend `ORDER BY created_at
DESC` ไว้จนกว่า user จะกดหัวตาราง)

คอลัมน์ตรงตัว 9 ใน 12 sort จาก field ที่มีอยู่แล้วตรงๆ (`seq_no`/`invoice_no`/`po_no`/`container_no`/
`supplier_name`/`received_date`/`item_count`/`created_by_name`/`created_at`) — อีก 3 คอลัมน์ (ขั้นตอนถัดไป/
วันที่ปิดเอกสาร/สถานะ) เป็นเซลล์ derived ที่ render จากหลาย NCR/NCP doc พร้อมกัน (`NextStepCell`/`CloseDateCell`/
`OverallStatusBadge`) ไม่มี field เดี่ยวให้ sort ตรงๆ อยู่แล้ว จึงคำนวณ proxy field ก่อนส่งเข้า `useSortable`
(`sortableRows = filtered.map(...)`, เหมือน pattern เดียวกับที่ทำกับคอลัมน์ "อัตรา NCR (%)" ของหน้ารายงานภาพรวม
ใน Session 135): `next_step_sort` = `uncovered_failed_count` (จำนวนรายการที่ยังไม่มี NCR/NCP), `close_date_sort`
= timestamp ล่าสุดของ NCR/NCP doc ที่เกี่ยวข้อง (หรือ `created_at` ถ้ายังไม่มี doc เลย), `status_sort` = label
ข้อความสถานะที่คำนวณจริงจาก `getOverallStatus()` (ตัวเดียวกับที่ badge แสดง ไม่ใช่ raw `bill.status`)

Mobile card list ใช้ `pageRows` เดิมอยู่แล้ว จึงได้ผล sort ตามไปด้วยอัตโนมัติโดยไม่ต้องแก้แยก

**Test:** ไม่มี backend เปลี่ยนเลย (sort ฝั่ง client ล้วนๆ จาก array ที่ได้มาแล้ว) — `node --test` ยัง
**350/350 เขียวเหมือนเดิม**, `npm run build` (client) ผ่าน — ไม่ได้เขียน frontend test ใหม่ (ตามธรรมเนียมเดิมของ
โปรเจกต์นี้ที่ไม่มี frontend test suite)

**Verify:** ยังไม่ได้ verify ผ่านมือจริงในเบราว์เซอร์ — แนะนำให้ user ลองกดหัวตารางแต่ละคอลัมน์ โดยเฉพาะ 3 คอลัมน์
derived (ขั้นตอนถัดไป/วันที่ปิดเอกสาร/สถานะ) เพื่อเช็คว่าลำดับที่ได้สมเหตุสมผล

### Files Changed

| File | สิ่งที่ทำ |
|---|---|
| `client/src/pages/Bills/index.jsx` | เพิ่ม sort ทุกคอลัมน์ (`SortTh`/`useSortable`), คำนวณ proxy sort field สำหรับ 3 คอลัมน์ derived |

---

## 2026-07-18 | Session 144 — บิลรับเข้า: "No." เปลี่ยนเป็นลำดับบันทึกจริง (บิลแรกสุด = 1)

**คำขอ:** ที่หน้า "บิลรับเข้า" (`/bills`) คอลัมน์ "No." เดิมไม่ใช่เลขที่รันจริง แค่บอกตำแหน่งแถวในตารางที่เห็นอยู่
เฉยๆ — ขอเพิ่ม "ลำดับบันทึก" จริง

**สิ่งที่พบ:** `client/src/pages/Bills/index.jsx`'s "No." เดิมคำนวณจาก `(safePage - 1) * PAGE_SIZE + i + 1` —
ตำแหน่งของแถวใน `pageRows` (ผลลัพธ์หลัง filter/search/pagination ฝั่ง client) **ไม่ใช่**ลำดับที่บิลถูกบันทึกเข้า
ระบบจริง — reset/เปลี่ยนทุกครั้งที่กรอง/ค้นหา/เปลี่ยนหน้า ตรงกับที่ user สังเกต

**ถาม `AskUserQuestion` ก่อนแก้** เพราะทิศทางการเรียงมีนัยสำคัญและกระทบทุกแถวของหน้าหลักที่ใช้บ่อย: บิลแรกสุด=1
(ตามลำดับเวลาบันทึกจริง, บิลใหม่ที่โชว์บนสุดจะได้เลขใหญ่ที่สุด) vs. เรียงตามที่แสดงในตาราง (บนสุด=1 เสมอ ไม่ว่าจะ
บิลใหม่แค่ไหน) — user เลือก**บิลแรกสุด = เลข 1** (ตรงกับความหมายจริงของ "ลำดับบันทึก" แบบทะเบียนรับของ)

**การแก้ (`server/routes/bills.js`, `GET /`):** ครอบ query เดิมด้วย CTE `numbered_bills` ที่คำนวณ
`ROW_NUMBER() OVER (ORDER BY created_at ASC) as seq_no` จาก **บิลทั้งหมดในระบบ** (ก่อน apply WHERE filter ใดๆ)
แล้วค่อย join/filter ตามปกติในชั้นนอก (เปลี่ยนแค่ `FROM bills b` → `FROM numbered_bills b`, ทุกอย่างอื่นเดิมหมด
รวม `where` string เดิมที่ยังอ้าง `b.status`/`b.supplier_id` ฯลฯ ได้ตรงเพราะ CTE เก็บ column เดิมไว้ครบ + เพิ่ม
`seq_no`) — ผลคือ `seq_no` เป็นเลขคงที่ต่อบิล ไม่ขึ้นกับ filter/search/pagination ที่ query ปัจจุบันเลย, บิลที่
บันทึกก่อน = เลขน้อยกว่าเสมอ

**การแก้ (`client/src/pages/Bills/index.jsx`):** เปลี่ยนคอลัมน์ "No." จาก `(safePage-1)*PAGE_SIZE+i+1` (คำนวณเอง)
เป็น `b.seq_no` (ใช้ค่าจาก backend ตรงๆ)

**Test:** เพิ่ม `BILL-14` ใน `server/test/bills.test.js` — สร้างบิล 2 ใบ ยืนยัน `seq_no` เรียงต่อจากบิลที่มีอยู่
เดิมถูกต้อง (บิลที่สร้างก่อน = เลขน้อยกว่า) และยืนยันว่าเมื่อกรองด้วย search ให้เหลือแค่บิลเดียวในผลลัพธ์
`seq_no` ของบิลนั้น**ยังเป็นค่าเดิม ไม่ reset เป็น 1** — `node --test` → **350/350 เขียว** (349 baseline + 1
เคสใหม่), `npm run build` (client) ผ่าน

**Verify:** ยังไม่ได้ verify ผ่านมือจริงในเบราว์เซอร์ — แนะนำให้ user เปิดหน้าบิลรับเข้าอีกครั้ง เช็คว่า No. ของ
บิลแรกสุดในระบบ (เลื่อนไปหน้าสุดท้าย) อ่านค่าเป็น 1 และ No. คงที่แม้จะกรอง/ค้นหา/เปลี่ยนหน้า

### Files Changed

| File | สิ่งที่ทำ |
|---|---|
| `server/routes/bills.js` | `GET /` — ครอบ query ด้วย CTE `ROW_NUMBER() OVER (ORDER BY created_at ASC)` คำนวณ `seq_no` คงที่จากบิลทั้งหมดก่อน filter |
| `client/src/pages/Bills/index.jsx` | คอลัมน์ "No." ใช้ `b.seq_no` จาก backend แทนตำแหน่งแถวที่คำนวณเอง |
| `server/test/bills.test.js` | + BILL-14 |

---

## 2026-07-18 | Session 143 — Telegram กลุ่ม QC: ปรับข้อความบิลใหม่/อนุมัติแล้วให้มีรายละเอียด+emoji

**คำขอ:** ข้อความ Telegram กลุ่ม QC ตอน qc_staff สร้าง/ส่งบิลใหม่ ให้แสดง PO/Invoice/บริษัท/จำนวนรายการ/วันที่บิล/
ผู้รับเข้า/สถานะ/Link หน้าอนุมัติของหัวหน้างาน และตอนหัวหน้างานอนุมัติ ให้ส่งอีกข้อความแบบมีกรอบดาวคั่น + "ได้รับการ
อนุมัติแล้ว" — มี emoji แสดงสถานะให้ดูง่ายทั้งคู่

**สิ่งที่พบ:** ข้อความเดิมทั้งสองจุดอยู่ใน `services/billService.js` — ตอน submit (`submitBill()`) มีข้อความ
Telegram อยู่แล้วแต่สั้นมาก (`[IQC] บิลใหม่รออนุมัติ\nInvoice: ...\nPO: ...`) ส่วนตอน approve (`approveBill()`)
**ไม่มีข้อความ Telegram เลยสักตัว** (มีแค่ in-app notification ให้ผู้สร้างบิลคนเดียว) — `bill` object ที่ทั้งสอง
ฟังก์ชันรับมาเป็น `SELECT * FROM bills` ธรรมดา (ไม่ join) จึงไม่มีชื่อ supplier/ผู้สร้าง/จำนวนรายการให้ใช้ตรงๆ

**การแก้ (`services/billService.js`):**
- เพิ่ม `getBillNotifyInfo(billId)` — query แยกดึง `supplier_name`/`created_by_name`/`item_count` (subquery
  COUNT จาก `bill_items`) เฉพาะตอนจะส่ง Telegram เท่านั้น ไม่กระทบ query หลักของ transaction เดิม
- เพิ่ม `thShortDate(dateStr)` — วันที่แบบไทย DD/MM/**พ.ศ.** (เช่น `2026-01-10` → `10/01/2569`) คัดลอก
  convention เดียวกับ `routes/exports.js`'s `thShortDate()` (ใช้ในหัวข้อ PDF "รับเมื่อวันที่" อยู่แล้ว) มาใช้ให้
  ตรงกันทั้งระบบ แทนที่จะคิดฟอร์แมตใหม่
- `submitBill()`: เขียนข้อความ Telegram ใหม่ทั้งหมด — `[IQC] 📥 มีบันทึกรับเข้าบิลใหม่` ตามด้วย PO/Invoice/บริษัท/
  จำนวนรายการ/วันที่บิล/ผู้รับเข้า/`สถานะ: ⏳ รออนุมัติ`/`Link: {app_url}/bills/{id}` (ลิงก์ไปหน้าเดียวกับที่ในแอป
  ใช้เป็น "หน้าอนุมัติ" ของหัวหน้างานอยู่แล้ว — ไม่มีหน้าแยกต่างหาก)
- `approveBill()`: เพิ่มข้อความ Telegram ใหม่ (เดิมไม่มี) — กรอบดาวคั่น (`***...***`) ก่อน/หลังบล็อกข้อมูล
  (PO/Invoice/บริษัท/จำนวนรายการ/วันที่บิล/ผู้รับเข้า) แล้วปิดท้ายด้วย `✅ ได้รับการอนุมัติแล้ว` + กรอบดาว — ตาม
  template ที่ user ให้มาเป๊ะ (ไม่มี Link ในข้อความนี้ตามที่ user ระบุ ต่างจากข้อความตอน submit ที่มี Link)
- ไม่แตะ flow `/reject` (นอกขอบเขตคำขอ — user ระบุแค่ 2 จุดคือ submit กับ approve)

**Test:** เพิ่ม 2 เคสใน `server/test/bills.test.js` (BILL-12/13) — mock `node-fetch` ผ่าน `require.cache`
(pattern เดียวกับ `test/backupService.test.js`'s `mockNodeFetch`) กันยิง network จริงไป Telegram API ระหว่างเทส
ตรวจข้อความจริงที่จะส่งครบทุกฟิลด์ (PO/Invoice/บริษัท/จำนวนรายการ/วันที่แบบ พ.ศ./สถานะ+emoji/Link) สำหรับ submit
และกรอบดาว 3 จุด + `✅ ได้รับการอนุมัติแล้ว` สำหรับ approve — `node --test` → **349/349 เขียว** (347 baseline +
2 เคสใหม่)

**Verify:** ยังไม่ได้ verify ผ่าน Telegram จริง (ต้องมี `telegram_bot_token`/`telegram_group_qc` ตั้งค่าไว้จริงใน
production) — แนะนำให้ user ทดสอบสร้าง+ส่งบิลจริงหนึ่งใบ แล้วให้หัวหน้างานอนุมัติ เช็คข้อความทั้ง 2 จุดในกลุ่ม
Telegram QC ว่าตรงตามที่ขอ

### Files Changed

| File | สิ่งที่ทำ |
|---|---|
| `server/services/billService.js` | + `thShortDate()`, `getBillNotifyInfo()`, เขียนข้อความ Telegram ใหม่ทั้ง `submitBill()`/`approveBill()` |
| `server/test/bills.test.js` | + BILL-12, BILL-13 (mock node-fetch ตรวจเนื้อหาข้อความ) |

---

## 2026-07-18 | Session 142 — Bandwidth Phase 1 (ต่อ): เปิด compression (gzip) ทั้งระบบ

**คำขอ:** Patch 2 จาก Bandwidth Analysis Report (Session 141) — เปิด `compression()` middleware เพราะเดิมไม่มี
การบีบอัด response เลยทั้งระบบบน Render (ไม่มี nginx อยู่หน้าเหมือน VPS) — ถามก่อนว่าจำเป็นไหมหลังจาก Patch 1
(backup dedup) แก้สาเหตุหลัก 90.7% ไปแล้ว ตอบว่าไม่เร่งด่วนแต่คุ้มทำเพราะความเสี่ยงต่ำมาก+ประโยชน์ต่อผู้ใช้จริง
(หน้าโหลดเร็วขึ้น ไม่ใช่แค่ bandwidth) — user ให้ทำเลย

**การแก้:** `npm install compression` (เพิ่มใน `server/package.json` dependencies, `^1.8.1`) — เพิ่ม
`app.use(compression())` ใน `server/index.js` เป็นด่านแรกสุดของ middleware chain (ก่อน security headers/cors)
ให้ครอบคลุมทุก response ที่ตามมา (static files/API JSON/SPA bundle) — ไม่ต้องตั้งค่า option เพิ่มเติม
(default threshold 1KB, ข้าม response เล็กๆ อัตโนมัติ เช่น `/api/health` 67 bytes ไม่ถูกบีบเพราะเล็กเกินคุ้ม)

**Verify (manual, เปิด server จริงชั่วคราวด้วย temp DB + `NODE_ENV=production` แล้วปิดทันทีหลังเช็ค):**
- `/api/health` (67 bytes): ไม่มี `Content-Encoding` แต่มี `Vary: Accept-Encoding` ยืนยันว่า middleware ทำงานอยู่
  (แค่เลือกไม่บีบเพราะเล็กกว่า threshold — พฤติกรรมถูกต้องตามที่ตั้งใจ)
- SPA JS bundle (`client/dist/assets/index-D5spnP1s.js`, 1,893,828 bytes บนดิสก์): request จริงได้
  `Content-Encoding: gzip` กลับมา และขนาดจริงที่ส่งผ่าน wire วัดได้ **454,663 bytes** — ลดลง **~76%**
  ตรงกับตัวเลข gzip ที่ Vite build log เคยรายงานไว้พอดี (`gzip: 454.66 kB`) ยืนยันว่าใช้งานได้จริงตามคาด

**Test:** ไม่มี route/logic เปลี่ยน (middleware ล้วนๆ, ไม่กระทบ response body ที่ route ส่งออกมา) — `node --test`
→ **347/347 เขียวเหมือนเดิม** (ไม่มี test ใหม่ เพราะพฤติกรรม compression ทดสอบผ่าน manual header check ข้างบนแล้ว
ไม่ใช่ unit-testable logic ของแอปเอง)

**Verify เพิ่มเติมที่ยังไม่ได้ทำ:** ยังไม่ได้ deploy ขึ้น Render จริง — ตัวเลข "HTTP Responses" ใน dashboard ควรลดลง
ตามสัดส่วนนี้หลัง deploy (Patch 1 จาก Session 141 แก้ก้อน Service-Initiated 90.7% ไปแล้ว ก้อนนี้แก้ HTTP
Responses 9.5% ที่เหลือ)

### Files Changed

| File | สิ่งที่ทำ |
|---|---|
| `server/package.json` | + `compression: ^1.8.1` |
| `server/index.js` | เพิ่ม `app.use(compression())` เป็นด่านแรกของ middleware chain |

---

## 2026-07-17 | Session 140 — LINE link preview ขึ้น "IQC System" แทน "QMS" + favicon เดิม 404 มาตลอด

**คำขอ:** ส่ง link `https://qms-d5fm.onrender.com/login` เข้า LINE แล้วการ์ด preview ขึ้นชื่อ "IQC System" ทั้งที่
ในระบบเปลี่ยนเป็น "QMS" แล้ว (Login.jsx โชว์ "Window Asia QMS" จริง) เกิดจากอะไร แก้ยังไง

**สิ่งที่พบ (root cause):** LINE (เหมือน Facebook/Slack/Discord ฯลฯ) สร้างการ์ด preview โดยดึง HTML ดิบของหน้า
เว็บมาอ่าน Open Graph meta tag (`og:title`/`og:description`/`og:image`) — **ไม่รัน JavaScript เลย** ถ้าไม่มี
tag พวกนี้ จะ fallback ไปใช้ `<title>` ธรรมดาแทน — `client/index.html` มีแค่ `<title>Window Asia · IQC System
</title>` ค้างชื่อเดิมอยู่ (ไม่เคยอัปเดตตอนเปลี่ยนชื่อในระบบเป็น QMS) และ**ไม่มี Open Graph tag เลยสักตัว** — LINE
เลย fallback ไปอ่าน `<title>` เดิมที่ยังไม่ได้แก้ นี่คือทั้งหมดของปัญหา (ไม่ใช่ปัญหา cache ฝั่ง LINE อย่างเดียว
เพราะ title จริงในไฟล์ก็ยังผิดอยู่)

**เจอเพิ่มระหว่างตรวจ:** `<link rel="icon" href="/favicon.svg">` **ไม่มีไฟล์ `favicon.svg` อยู่จริงในโปรเจกต์เลย**
(404 มาตั้งแต่แรกเริ่ม ไม่ใช่ regression) — `client/` ไม่มีโฟลเดอร์ `public/` มาก่อนด้วยซ้ำ

**การแก้:**
- สร้างโฟลเดอร์ `client/public/` (ไม่เคยมีมาก่อน) + คัดลอกโลโก้ที่มีอยู่แล้ว (`src/assets/logo-window-asia.png`,
  960×960) เข้าไปเป็น `public/og-image.png` — Vite copy ไฟล์ใน `public/` ไปที่ root ของ `dist/` อัตโนมัติ ทำให้เข้าถึง
  ได้ที่ `/og-image.png` บน production จริง (verify แล้วด้วย `npm run build`)
- `client/index.html`: แก้ `<title>` → "Window Asia QMS" (ตรงกับ Login.jsx), เพิ่ม `<meta name="description">` +
  ชุด Open Graph tag เต็ม (`og:type`/`og:site_name`/`og:title`/`og:description`/`og:url`/`og:image`) — `og:url`/
  `og:image` เป็น absolute URL ของ production จริง (`https://qms-d5fm.onrender.com/...`) เพราะ crawler ภายนอกไม่
  รู้จัก origin ของหน้าที่ fetch มาเสมอไป (ต้องแก้มือถ้าเปลี่ยนโดเมนในอนาคต — ข้อจำกัดของ static meta tag ในระบบที่
  ไม่มี SSR) — แก้ favicon ที่เสียไปในตัวด้วย เปลี่ยนไปชี้ `/og-image.png` (type image/png) แทน `/favicon.svg`
  ที่ไม่มีไฟล์จริง

**Test:** ไม่มี test อัตโนมัติ (เนื้อหา `<head>` ล้วน ไม่มี logic ให้ทดสอบ) — verify ด้วย `npm run build` แล้วเปิด
`dist/index.html` อ่านตรงๆ ยืนยัน meta tag ครบถูกต้อง + `dist/og-image.png` มีไฟล์จริง

**Verify:** ยังไม่ได้ verify ผ่าน LINE จริง (ต้อง deploy ขึ้น production ก่อน) — **สำคัญ: LINE (เหมือน Facebook)
cache ผลลัพธ์ unfurl ต่อ URL ไว้นานได้เป็นวันๆ** ต่างจาก Facebook ที่มี "Sharing Debugger" ให้ force refresh cache
ได้ LINE ไม่มีเครื่องมือ public แบบนี้ — หลัง deploy แล้วส่ง link เดิมซ้ำอาจยังเห็นการ์ดเก่าอยู่ชั่วคราว แนะนำให้ผู้ใช้
ลองส่งลิงก์ใหม่พร้อม query string ปลอมๆ ต่อท้าย (เช่น `?v=2`) เพื่อบังคับให้ LINE มองเป็น URL ใหม่ที่ต้อง fetch สด
แทนที่จะรอ cache หมดอายุเอง

### Files Changed

| File | สิ่งที่ทำ |
|---|---|
| `client/public/og-image.png` | ใหม่ — คัดลอกจาก `src/assets/logo-window-asia.png` ใช้เป็นทั้ง og:image และ favicon |
| `client/index.html` | `<title>` แก้เป็น QMS, เพิ่ม meta description + Open Graph tags เต็มชุด, แก้ favicon ที่เสีย |

---

## 2026-07-13 | Session 126 — Delivery: notification deep-link bugs, real-time sync bug, tag drill-down + export, yearly calendar view, actual-time + unplanned rename

**คำขอ (รอบที่ 1):** user รายงาน 2 บั๊ก — (1) หลัง QC กด "รับทราบ" กระดิ่งจัดซื้อเด้งแจ้งเตือนถูกต้อง แต่คลิกลิงก์
ที่กระดิ่งไปหน้ารายละเอียดส่งของแล้ว modal ไม่เปิด ค้างอยู่ ต้องรีเฟรชเองถึงจะขึ้น (2) หน้า qc_staff กระดิ่งกดแล้ว
ไม่เด้งไปที่ปุ่ม "รับทราบ" ของ supplier นั้นให้เลย ต้องหาเองคลิกเอง

**Root cause รอบ 1:**
- Bug 1: `Delivery/index.jsx`'s deep-link `useEffect` (อ่าน query param `?schedule=` แล้วเปิด DetailModal)
  มี dependency เป็น `[]` เฉยๆ ทำงานแค่ตอน mount ครั้งแรก — ถ้าผู้ใช้อยู่หน้า `/delivery` อยู่แล้วแล้วกดลิงก์
  แจ้งเตือนใหม่ (path เดิม แค่ query string เปลี่ยน) React Router ไม่ remount component เลย effect ไม่ทำงานซ้ำ
  จนกว่าจะรีเฟรชหน้าเอง — แก้เป็น dep บนค่า `scheduleParam` จริง
- Bug 2: มีแค่ notification "QC รับทราบ" อันเดียวที่มี deep link `?schedule=<id>` ส่วน notification อื่นที่ QC
  ได้รับ (แจ้งกำหนดส่งใหม่, นอกเวลาทำงาน, วันหยุด, เลื่อนวัน, แก้ไขแผน) ใน `deliveryService.js` ยังลิงก์ไปหน้า
  `/delivery` เฉยๆ ไม่มี id — เพิ่ม deep link ให้ทุกจุด (ยกเว้น `deleteSchedule` เพราะ record ถูกลบไปแล้วตอน
  notification ยิง ลิงก์เจาะจงจะ 404)

**Verify รอบ 1:** Playwright บน server แยก + DB ใหม่ — ฝั่งจัดซื้ออยู่หน้า `/delivery` อยู่แล้ว กดกระดิ่ง → modal
เปิดทันทีไม่ต้องรีเฟรช, ฝั่ง QC อยู่หน้าอื่น กดกระดิ่งแจ้งกำหนดส่งใหม่ → เด้งตรงไปที่ modal ของ supplier นั้นพร้อม
ปุ่ม "รับทราบ" ทันที — commit `c107f8c`

---

**คำขอ (รอบที่ 2):** user รายงานต่อ 3 เรื่อง — (1) QC กดปุ่ม "บันทึก" (ปิดสถานะตามแผน/นอกแผน) ปฏิทินจัดซื้อไม่
อัปเดตทันที ต้องรีเฟรชเอง และกระดิ่งจัดซื้อไม่เด้งแจ้งว่ารับสินค้าเรียบร้อยแล้วเลย (2) tag สรุปสถานะ (ส่งตามแผน/
ส่งนอกแผน/ส่งเสร็จสิ้น ฯลฯ) ให้คลิกดูรายการข้างในได้ (ผู้ผลิต/แผนส่ง/ส่งจริง/QC ผู้รับ/comment) + export Excel
(3) เพิ่มมุมมอง "รายปี" ในปฏิทิน (มีรายเดือน/รายวันอยู่แล้ว)

**Root cause (1) — 2 บั๊กซ้อนกัน:**
- บั๊กจริงใน `useSSE.js`'s `keysFromLink()`: split link ด้วย `/` โดยไม่ตัด query string ออกก่อน ทำให้ลิงก์แบบ
  `/delivery?schedule=123` (ที่เพิ่มไปรอบ 1) กลายเป็น segment `"delivery?schedule=123"` ทั้งท่อน ไม่ตรงกับ
  `=== 'delivery'` เลย — SSE invalidate query เงียบๆ ไม่ทำงานเลยสำหรับ notification ที่มี deep link เกือบทั้งหมด
  (กระทบกว้างกว่าที่ user รายงานแค่ 1 จุด)
- `updateStatus`'s branch on_time/late ไม่เคยเรียก `createNotification` เลยสักครั้ง (มีแต่ branch rescheduled) —
  ไม่มีทั้ง SSE push และกระดิ่งจัดซื้อ แก้โดยเพิ่ม notification "QC รับสินค้าเรียบร้อยแล้ว" ไปยัง
  `resolveNotifyTargetIds(supplier)` พร้อม deep link, และ stamp คอลัมน์ใหม่ `delivery_schedules.received_by`
  (migration แบบ safeAddColumn) ไว้ใช้ต่อใน (2)

**การแก้ (2)/(3):** tag คลิกเปิด `TagSummaryModal` ใหม่ (ตาราง ผู้ผลิต/แผนส่ง/ส่งจริง/QC ผู้รับ/หมายเหตุ, กรอง
จาก schedules ที่โหลดในเดือนปัจจุบันอยู่แล้ว ใช้ predicate เดียวกับตัวนับ tag) + ปุ่ม Export Excel เรียก endpoint
ใหม่ `GET /api/delivery/export/excel?bucket=&from=&to=` (generate ฝั่ง server ตาม CLAUDE.md §13, bucket mapping
ชุดเดียวกับฝั่ง client) · เพิ่ม viewMode `'year'` คู่ `month`/`day` — grid 12 mini-month ต่อปี (query แยก
`['delivery-year', year]` โหลดเฉพาะตอนสลับมาดู), จุดสีบอกวันที่มีรายการ, คลิกหัวเดือนเข้ารายเดือน/คลิกวันเข้า
รายวัน

**Test:** `node --test` → 258/258 เขียว, 0 skip (ไม่เพิ่ม test ใหม่ — ยืนยันด้วย Playwright live-verify แทนตาม
methodology ที่ใช้ทั้ง session นี้)

**Verify รอบ 2:** Playwright บน server แยก + DB ใหม่อีกครั้ง — ปฏิทินจัดซื้อ flip เป็น "ส่งของแล้ว" + กระดิ่งขึ้น
ภายใน ~2 วิ โดยไม่รีเฟรชเลย, tag "ส่งเสร็จสิ้น" เปิด modal ถูก supplier/QC ผู้รับ + export คืนไฟล์ xlsx
(`Content-Type` ถูกต้อง), มุมมองรายปีขึ้นครบ 12 เดือน คลิกวันที่สลับไปรายวันด้วยวันที่ถูกต้อง — commit `1be6f53`

---

**คำขอ (รอบที่ 3):** user รายงานต่อ 6 เรื่องละเอียดขึ้นจาก tag summary modal ที่เพิ่งทำในรอบ 2 — (1) ตาราง "ส่งจริง"
มีแต่วันที่ไม่มีเวลา และไม่มีคอลัมน์สถานะ (คลิก "ส่งเสร็จสิ้น" แล้วแยกไม่ออกว่าแถวไหนตามแผน/นอกแผน) (2) หน้า
รายละเอียดฝั่ง QC ให้กรอกเวลาที่ของมาส่งได้ด้วย ไม่ใช่แค่วันที่ (3) เปลี่ยนชื่อ tag "นอกแผน" เป็น "ไม่มีแผนส่ง" (กัน
สับสนกับสถานะ "ส่งนอกแผน" ที่เป็นคนละความหมาย) (4) เปลี่ยนชื่อปุ่ม/หัวฟอร์มบันทึกนอกแผนของ qc_staff ตามข้อ 3
(5) ในตารางนอกแผน ถ้า QC บันทึกวันเวลาแล้วให้ย้ายจากช่อง "แผนส่ง" ไปช่อง "ส่งจริง" (แผนส่งโชว์ "-" แทน เพราะของที่
ไม่มีแผนไม่มี "แผน" จริงๆ) (6) ปรับขนาดกล่อง modal ให้พอกับข้อมูลที่เพิ่มขึ้น

**การแก้:**
- เพิ่มคอลัมน์ใหม่ `delivery_schedules.actual_time` (migration แบบ safeAddColumn คู่กับ `actual_date` เดิมที่มีแต่
  วันที่) — เพิ่ม input `type="time"` ในฟอร์ม "อัปเดตสถานะ" ของ QC (`DetailModal`), thread ผ่าน
  `updateStatus`/`PATCH /:id/status`/export ครบ
- `TagSummaryModal` เพิ่มคอลัมน์ "สถานะ" (badge ต่อแถวจาก `STATUS_CFG` เดิม, override เป็น "ไม่มีแผนส่ง" เมื่อ
  `is_unplanned`) และคอลัมน์ "ส่งจริง" โชว์เวลาด้วย — ตรงกับ Excel export ที่ปรับ column เดียวกัน
- เปลี่ยนข้อความ "นอกแผน" → "ไม่มีแผนส่ง" ที่ summary tag (`_unplanned` bucket), ปุ่ม "+" หน้า qc_staff, และ
  modal บันทึก unplanned (ทั้ง title และปุ่ม submit) — คำว่า "ส่งนอกแผน" (สถานะ `late`) ไม่ถูกแตะเพราะเป็นคนละ
  concept กัน (ของมาช้ากว่าแผน vs ไม่มีแผนตั้งแต่แรก)
- `TagSummaryModal`/export: แถว `is_unplanned` แสดง "แผนส่ง" เป็น "-" และย้าย `scheduled_date`+`time_slot`
  (ค่าเดียวที่มีจริงตอนสร้าง unplanned record) ไปแสดงใน "ส่งจริง" แทน — ตรงกับความจริงที่ไม่มี "แผน" มาก่อน
- `Modal` ของ `TagSummaryModal` ขยายจาก `size="lg"` เป็น `size="xl"` ให้พอกับคอลัมน์ที่เพิ่ม

**Test:** `node --test` → 258/258 เขียว, 0 skip

**Verify:** Playwright บน server แยก + DB ใหม่ — actual_time input โผล่ในฟอร์ม QC และ round-trip ไปจนถึง export,
ปุ่ม/หัวฟอร์ม unplanned อ่านว่า "ไม่มีแผนส่ง"/"บันทึกการส่งของไม่มีในแผน" ถูกต้อง, modal tag "ส่งเสร็จสิ้น" โชว์
สถานะ + เวลาที่บันทึกจริง, modal tag "ไม่มีแผนส่ง" โชว์ "-" ใต้แผนส่งและวันเวลาจริงใต้ส่งจริง — commit `47a15b3`

---

**คำขอ (รอบที่ 4):** user รายงาน "ตรง ประวัติการดำเนินการ เวลาไม่ได้ +7"

**Root cause:** `audit_logs.created_at` เก็บด้วย SQLite `CURRENT_TIMESTAMP` (UTC ดิบ ไม่มี timezone marker) —
History list ใน `DetailModal` (`Delivery/index.jsx`) เดิมแค่ `.slice(0,16).replace('T',' ')` ตัดสตริงดิบมาโชว์
ตรงๆ ไม่ได้แปลง timezone เลย ทำให้เวลาที่เห็นช้ากว่าเวลาไทยจริง 7 ชั่วโมง — คนละจุดกับ `NCR/Detail.jsx`/
`UAI/Detail.jsx` ที่มี pattern แปลงถูกต้องอยู่แล้ว (`new Date(ts + 'Z').toLocaleString('th-TH', { timeZone:
'Asia/Bangkok' })`) แก้โดยใช้ pattern เดียวกันให้ตรงกับที่อื่นในระบบ

**Verify:** seed audit_logs row ตรงด้วย raw `created_at` UTC "08:49:38" ยืนยันหน้าเว็บโชว์ "15:49" (ถูกต้อง
+7) แทนที่จะโชว์ "08:49" ดิบ — commit `52c3315`

---

**คำขอ (รอบที่ 5):** user รายงาน "เวลาเลื่อก รายปี รายเดือน รายวัน ทำไมข้อมูลใน tag แต่ละสถานะถึงไม่เปลี่ยนไปตามที่
เลือก เช่น เดือน 7 มี 10 ข้อมูล(ส่งเสร็จสิ้น) เดือน 8 มี 20 ข้อมูล(ส่งเสร็จสิ้น) เมื่อเลือกรายปีต้องแสดง 30"

**Root cause:** ตัวนับ tag สรุป (`summaryBadgeCount`) อ่านจาก `schedules` ซึ่ง scope ตามเดือนของ `currentDate`
เสมอ ไม่ว่า `viewMode` จะเป็นอะไร — สลับไปรายปีแล้วตัวเลขยังโชว์แค่เดือนเดียวที่โหลดไว้ ไม่รวมทั้งปี พบบั๊กแฝงอีก
จุด: `openDay()` (ใช้ตอนคลิกวันจากปฏิทิน) ไม่เคย sync `currentDate` (เดือน) ตามวันที่คลิกเลย — ถ้าคลิกวันจากมุมมอง
รายปีที่เป็นเดือนอื่นจาก `currentDate` เดิม รายวันจะหาไม่เจอข้อมูลเพราะ query เดือนที่โหลดไว้ผิดเดือน

**การแก้:** เพิ่ม `badgeSchedules`/`badgeFrom`/`badgeTo` เลือก source ตาม `viewMode` — `yearSchedules` (ทั้งปี)
ตอน 'year', `schedules` กรองเฉพาะ `selectedDate` ตอน 'day', `schedules` เดิมตอน 'month' — ใช้ทั้งกับตัวนับ tag
และ `TagSummaryModal`/export ให้ scope ตรงกัน · แก้ `openDay()` ให้ sync `setCurrentDate` ไปเดือนของวันที่คลิก
เสมอ (แก้ปัญหาบั๊กแฝงด้วยในตัว)

**Test:** `node --test` → 258/258 เขียว, 0 skip

**Verify:** seed 3 รายการส่งเสร็จสิ้นเดือน ก.ค. + 5 รายการเดือน ส.ค. — มุมมองรายเดือนโชว์ "3" แล้ว "5" ถูกต้องตาม
เดือนที่เลื่อนไป, มุมมองรายปีโชว์ "8" (รวมถูกต้อง), คลิกวันที่ 1 ก.ค. จากตารางรายปี (ขณะปฏิทินอยู่เดือน ส.ค.)
สลับไปรายวันแล้วโชว์ "1" พร้อมข้อมูล supplier ถูกต้อง (ยืนยัน `openDay` sync เดือนทำงาน) — commit `ef18e73`

---

**คำขอ (รอบที่ 6):** user ส่ง screenshot กล่อง "รายละเอียดการส่งของ" ของรายการที่บันทึกผ่าน "+ไม่มีแผนส่ง" —
โชว์ 2 tag พร้อมกัน "ส่งตามแผน" (เขียว) + "ไม่ได้แจ้งล่วงหน้า" (เหลือง) ขัดแย้งกันเอง (ของที่ไม่มีแผนไม่ควรมี tag
บอกว่า "ตามแผน") ขอให้เหลือ tag เดียวคือ "ไม่ได้แจ้งล่วงหน้า" พร้อมเปลี่ยนชื่อเป็น "ไม่มีแผนส่ง" ให้ตรงกับรอบก่อน

**Root cause:** `StatusBadge` component (ใช้ทั้งใน `DetailModal` header และ Daily View list) โชว์ badge สถานะดิบ
(`STATUS_CFG[status].label`) เสมอ ไม่ว่า `is_unplanned` จะเป็นอะไร แล้วค่อยโชว์ badge "ไม่ได้แจ้งล่วงหน้า" เพิ่ม
ต่อท้ายถ้า `is_unplanned` — เพราะ record แบบไม่มีแผนส่งเก็บ `status='on_time'` เสมอในฐานข้อมูล (ไม่มี status
เฉพาะของตัวเอง) เลยโชว์ "ส่งตามแผน" ควบคู่กับ "ไม่มีแผนส่ง" ซึ่งขัดแย้งกันเอง — จุดเดียวที่ยังไม่ได้ sync กับ
`rowStatusBadge()` logic ที่ทำไว้ให้ `TagSummaryModal` แล้วในรอบ 3 (override เป็น "ไม่มีแผนส่ง" ป้ายเดียวตอน
`is_unplanned`)

**การแก้:** `StatusBadge` เพิ่ม early return เมื่อ `isUnplanned` — โชว์เฉพาะ badge "ไม่มีแผนส่ง" ป้ายเดียว (เปลี่ยน
ชื่อจาก "ไม่ได้แจ้งล่วงหน้า" ให้ตรงกับ tag/ปุ่ม/หัวฟอร์มที่เปลี่ยนไปแล้วในรอบ 3) ไม่โชว์ raw status badge คู่กันอีก

**Test:** `node --test` → 258/258 เขียว, 0 skip

**Verify:** seed record จำลองจาก screenshot จริงของ user (FOSHAN, unplanned, 16:00) ยืนยันกล่องรายละเอียดโชว์
เฉพาะ "ไม่มีแผนส่ง" ป้ายเดียว ไม่มี "ส่งตามแผน"/"ไม่ได้แจ้งล่วงหน้า" (คำเก่า) หลงเหลืออยู่เลย — commit `e4c115f`

---

**คำขอ (รอบที่ 7, นอกโมดูล Delivery):** user ขอที่หน้า NCR — ช่อง qc_manager "อนุมัติเปิด NCR (ส่ง QMR)" ตรง
dropdown เลือกมาตรการจัดการ (Disposition) ให้เอาตัวเลือก "ยอมรับใช้พิเศษ(UAI)" และ "ตรวจซ้ำ" ออก

**การแก้:** `NCR/Detail.jsx` ลบ `<option value="uai">`/`<option value="re_inspect">` ออกจาก dropdown Disposition
ที่โชว์ตอน qc_manager กด "อนุมัติ" NCR major (`status === 'pending_manager'`) เหลือแค่ Return/Rework/Scrap — ไม่
กระทบปุ่ม "ขอยอมรับใช้พิเศษ (UAI)" แยกต่างหากที่ purchasing กดตอน `pending_supplier` (`canRequestUAI`, ไม่ได้อ่าน
`ncr.disposition` เลย) และไม่แตะ DB CHECK constraint (`ncrs.disposition IN (...)` ยังอนุญาต `uai`/`re_inspect`
เหมือนเดิม — เป็นการจำกัดแค่ระดับ UI)

**Test:** `node --test` → 258/258 เขียว, 0 skip

**Verify:** seed NCR major ที่ status `pending_manager` ตรงๆ ผ่าน SQL ยืนยัน dropdown เหลือแค่ 3 ตัวเลือกจริง
(Return/Rework/Scrap) ไม่มี UAI/ตรวจซ้ำเหลืออยู่เลย — commit `a3cec52`

---

**คำขอ (รอบที่ 8):** user รายงาน "หน้า ID จัดซื้อที่ Dashboard ไม่ Real-time เมื่อมีการอนุมัติออกเอกสาร NCR จาก
QMR แล้ว ที่หน้า dashboard ID จัดซื้อไม่อัพเดท"

**Root cause:** `PurchasingDash.jsx` ใช้ query key เฉพาะของตัวเอง (`purchasing-dashboard-summary`/`-suppliers`/
`-suppliers-all`/`-ncrs`) แต่ `useSSE.js`'s `keysFromLink()` (ตัวกลาง invalidate query จาก SSE event) รู้จักแค่
`['ncrs']`/`['ncr', id]` สำหรับ segment `ncr` — ไม่เคย invalidate query ของ dashboard นี้เลยสักครั้ง ทั้งที่ฝั่ง
server ยิง `createNotification(..., '/ncr/${id}')` ถูกต้องอยู่แล้วตอน QMR อนุมัติเปิด NCR (transition
`pending_qmr_open` → `pending_purchasing_review`, เห็นได้จาก `ncrService.js`) — SSE ไปถึง browser จริง แค่ query
ที่ผิด key เลยไม่ refetch จนกว่าจะรีเฟรชหน้าเอง

**การแก้:** เพิ่ม `purchasing-dashboard-*` keys ทั้ง 4 ตัวเข้า `keysFromLink()` ทั้ง branch `ncr` และ `uai`
(UAI status ผูกกับ `ncrs.status` ด้วย เช่น `uai_pending_qc_manager` กระทบ bucket ใน dashboard เหมือนกัน) — ไม่ต้อง
เพิ่ม branch `delivery` เพราะ dashboard นี้คำนวณจาก `ncrs` join `bills`/`suppliers` ล้วนๆ ไม่มีข้อมูล delivery ปน

**Test:** `node --test` → 258/258 เขียว, 0 skip

**Verify:** seed NCR ที่ status `pending_qmr_open` ผูกกับ supplier ที่ purchasing1 ดูแล — เปิด dashboard
purchasing1 ค้างไว้ (การ์ด "งานที่ต้องดำเนินการ" = 0), ให้ qmr1 คนละ session กดอนุมัติเปิด NCR แล้วกลับมาดูหน้า
purchasing1 โดยไม่รีเฟรช ยืนยันตัวเลขเปลี่ยนเป็น 1 เองภายใน ~2 วิ — commit `2c04efc`

---

**คำขอ (รอบที่ 9):** user ขอปรับ "หน้าหลัก ผู้จัดการจัดซื้อ" ให้ดูง่ายขึ้น รูปแบบเหมือน admin dashboard แต่ข้อมูลครบ
ในเรื่องที่ ผจก. จัดซื้อต้องรู้ แยกเป็นสัดส่วนชัดเจน — **ถาม `AskUserQuestion` ก่อนเริ่ม** เพราะ "เหมือน admin
dashboard" กำกวมว่าหมายถึงแค่สไตล์เนื้อหา หรือรวม header/sidebar เฉพาะตัวแบบเต็มจอด้วย (AdminDash.jsx เป็น
role เดียวที่ `AppLayout.jsx` bypass sidebar/header ปกติให้) — user เลือก "ปรับแค่เนื้อหาในหน้า" (คง
sidebar/header เดิม)

**สิ่งที่พบ:** `ManagerPurchasingDash.jsx` เดิมใช้ theme token ธรรมดา (HeroStat/SummaryCard/`.table`) ตาม
มติ S125 ที่ตั้งใจคงพฤติกรรมเดิมไว้ก่อน — แต่ dashboard อื่นๆ ส่วนใหญ่ (QCStaffDash/SupervisorDash/ManagerDash/
QMRDash/ExecutiveDash/ProductionDash) ใช้ dark `D` token จาก `shared.jsx` (ตาม CLAUDE.md §25.2) **อยู่แล้วโดย
ฝังอยู่ใน AppLayout ปกติ** (ไม่ได้ bypass เหมือน admin) — พิสูจน์ว่า pattern "dark card ฝังใน light chrome เดิม"
ใช้งานจริงอยู่แล้วทั้งระบบ ไม่ใช่เรื่องใหม่/เสี่ยง

**การแก้:** เขียน `ManagerPurchasingDash.jsx` ใหม่ทั้งไฟล์ตาม pattern เดียวกับ AdminDash/QCStaffDash — KPI card
5 ใบ (ลูกทีม/Supplier/งานที่ต้องดำเนินการ/ปิดแล้ว/เกินกำหนด), 3-column พร้อม `CatLabel`: ซ้าย "ทีมจัดซื้อ"
(อันดับภาระงาน + progress bar ต่อคน), กลาง "สถานะงาน NCR/NCP" (bar chart pipeline + panel เกินกำหนดสีแดง),
ขวา "ภาพรวมระบบ" (RadialGauge 3 ตัว + สรุปย่อ + team quick list) — mobile เป็น single-column ตาม pattern เดียวกัน
— **ไม่แก้ backend เลย** ข้อมูลทั้งหมดมาจาก endpoint เดิม `/api/purchasing/dashboard/team`

**Test:** `node --test` → 258/258 เขียว, 0 skip

**Verify:** seed purchasing_manager + ลูกทีม 2 คน + supplier/NCR 8 รายการคละสถานะ/เกินกำหนด ผ่าน Playwright ทั้ง
desktop (1600px) และ mobile (390px) — screenshot ยืนยันตัวเลข/gauge/ranking ตรงกับข้อมูลที่ seed ไว้ทุกจุด, ไม่มี
console error เลย — commit `4692c10`

---

## 2026-07-14 | Session 127 — Deploy-safety Q&A, Purchasing Manager nav/dashboard fixes, delivery status-form fixes, warehouse roles + dashboard, sidebar label, today-delivery lists

**คำขอ (รอบที่ 1):** user ถาม (ไม่ใช่คำสั่งแก้โค้ด) — ตอนนี้ deploy บน Render + backup ไป Cloudflare R2 การที่
พัฒนาเพิ่มแล้วกระทบ `.db` (เช่น migration ใหม่ที่เพิ่มใน S126) จะทำให้ deploy รอบใหม่ที่ restore backup มาแทน
เว็บพังไหม ถ้าพังมีวิธีป้องกันอย่างไร

**วิธีตอบ:** ส่ง Explore agent ไปตรวจโค้ดจริงแทนการเดา — อ่าน `bootstrap.js`/`restoreService.js`/`database.js`'s
`runMigrations()`/`backupService.js`/`DEPLOYMENT.md` ครบ พบว่า **ปลอดภัย**: (1) restore-on-boot
(`restoreService.js`) ทำงานเฉพาะตอน local DB ว่าง/ไม่มีเท่านั้น — ไม่เคยทับ DB ที่มีอยู่แล้ว (2) ไม่ว่าจะ restore
มาหรือไม่ ลำดับ boot รัน `initSchema→runMigrations→seedData` เสมอแบบไม่มีเงื่อนไข — DB เก่าที่ restore มาจะถูก
migrate ให้ทันสมัยทันทีก่อนเปิดใช้งานจริง (3) `safeAddColumn()` ที่ column ใหม่ของ S126 ใช้ เป็น pattern
idempotent ที่ปลอดภัยที่สุดในไฟล์อยู่แล้ว เหมือนกับอีก ~90 จุดเดิม (4) migration แบบ rebuild ตาราง (เช่น
`migrateNcrStatusConstraint`) ก็เขียนป้องกัน DB เก่าข้ามหลาย generation ไว้แล้ว (เช็ค `sqlite_master.sql` ก่อน +
shared-column intersection + rollback ใน catch) (5) backup รันทุก 10 นาทีจาก DB ที่ migrate แล้วจริงของ process
ที่รันอยู่ — ช่วง "backup เก่ากว่า schema ใหม่" มีแค่ ≤10 นาทีและหายไปเองรอบ backup ถัดไป — **สรุป: deploy ต่อไป
ไม่พัง ไม่ต้องทำอะไรเพิ่ม** พบ gap เดียว (ไม่ใช่เรื่องใหม่จาก S126): ไม่เคยมี automated test พิสูจน์ flow
"restore DB เก่า → migrate forward" ตรงๆ เลย — ถาม user ว่าจะปิด gap นี้ไหม (เพิ่ม test / ทำ dry-run) user เลือก
**"แค่คำอธิบาย พอแล้ว"** — ไม่มีการแก้โค้ดในรอบนี้เลย

---

**คำขอ (รอบที่ 2):** user ขอเพิ่มเมนู Issue Talk ที่ sidebar ของ ID ผู้จัดการจัดซื้อ (`purchasing_manager`)

**Root cause:** `rolePermissions.js`'s Issue Talk `NAV_ITEMS` entry มี roles array เก่าตั้งแต่ก่อน role
`purchasing_manager` จะถูกเพิ่มใน S125 — ไม่เคยอัปเดตตามให้ครบ (เหมือน gap แบบ `CREATABLE_ROLES`/disposition
dropdown ที่เจอมาก่อนหน้านี้ในซีรีส์นี้) ตรวจ backend (`routes/issue-talk.js`) แล้วพบว่า**ไม่มี `requireRole`
เลย** — purchasing_manager เข้าถึง `/issue-talk` ผ่าน URL ตรงได้อยู่แล้ว แค่ไม่มีลิงก์ใน sidebar ให้กด

**การแก้:** เพิ่ม `'purchasing_manager'` เข้า roles array ของ Issue Talk nav item บรรทัดเดียว

**Test:** `node --test` → 258/258 เขียว, 0 skip

**Verify:** seed user role `purchasing_manager` ผ่าน Playwright ยืนยัน sidebar โชว์ "Issue Talk" และคลิกเข้าไป
หน้าโหลดได้ปกติไม่มี error — commit `56f32aa`

---

**คำขอ (รอบที่ 3):** user ขอให้ sidebar ของ ID จัดซื้อ/ผู้จัดการจัดซื้อ แสดงหัวข้อย่อยทุกหัวข้อเลย ไม่ต้องกดคลิก

**สิ่งที่พบ:** `Sidebar.jsx` เดิมใช้ accordion (เปิดได้ทีละกลุ่ม, ยุบอัตโนมัติตาม route ปัจจุบันผ่าน
`findOpenGroupPath` + `useEffect`) — สอง role นี้เห็นกลุ่มที่มี children แค่ 2 กลุ่ม (`/iqc`: NCR/NCP, UAI,
ปฏิทินส่งของ · `/master`: ผู้ผลิต) จึงจำกัดขอบเขตแก้แค่ 2 กลุ่มนี้พอ ไม่กระทบ role อื่น (admin เห็น KPI/จัดการ
ระบบ/Master เต็มที่ยังต้องคง accordion เดิมไว้)

**การแก้:** เพิ่ม `ALWAYS_EXPAND_ROLES = ['purchasing','purchasing_manager']` ใน `Sidebar.jsx` — ถ้า role อยู่ใน
list นี้: `openGroups` เริ่มต้นเป็นทุกกลุ่มที่มี children (ไม่ใช่แค่กลุ่มที่ path ปัจจุบันตรง), `useEffect` ที่ยุบ
ตาม route เปลี่ยนจะ skip ไปเลย (ไม่ยุบ), ปุ่ม toggle กลุ่มไม่มี `onClick` และซ่อน chevron ไอคอนออก (ไม่มี
affordance ให้กดเพราะกดไม่ได้แล้วจริงๆ) — ขอบเขตแค่ `Sidebar.jsx` (desktop) ตามคำว่า "sidebar" ที่ user ใช้ตรงๆ
ไม่แตะ `BottomNav.jsx` (mobile ใช้ bottom-sheet คนละ pattern ที่ "ขยายค้างไว้ inline" ใช้ไม่ได้อยู่แล้ว)

**Test:** `node --test` → 258/258 เขียว, 0 skip

**Verify:** Playwright ยืนยัน purchasing/purchasing_manager เห็นหัวข้อย่อยครบทั้ง 2 กลุ่มทันทีไม่ต้องคลิก, ยังคง
เปิดอยู่หลังนำทางไปหน้าอื่น (ไม่ยุบ), และ admin ยัง accordion ปกติเหมือนเดิม (Master children ซ่อนอยู่จนกว่าจะ
อยู่ใน route นั้นจริง) — commit `53dfd36`

---

**คำขอ (รอบที่ 4):** user ขอปรับ dashboard ผู้จัดการจัดซื้ออีกรอบ — ปรับ layout ใหม่, ปรับขนาดตัวอักษรให้อ่านง่าย
เห็นชัด, และให้ dashboard มีโหมดกลางวัน/กลางคืน

**สิ่งที่พบ:** รอบก่อน (ดูรอบที่ 9 ของ S126 ด้านบน) ใช้ dark `D` token แบบ hardcode ตายตัวเหมือน AdminDash —
ได้สไตล์ที่ user ขอตอนนั้น แต่ผลข้างเคียงคือ (1) ไม่มีโหมดกลางวันเลย (สีล็อกมืดถาวรตาม CLAUDE.md §25.2 ของกลุ่ม
"8 ไฟล์เดิม") (2) font size เล็กมาก (9-11px) ตามสไตล์ operational dashboard หนาแน่นที่ AdminDash ใช้ ซึ่งกลับมา
เป็นปัญหาอ่านยากตามที่ user feedback รอบนี้

**การแก้:** เปลี่ยนจาก `D` token (shared.jsx) มาใช้ semantic theme token ของระบบทั้งหมด (`bg-surface`/`text-text`/
`text-muted`/`.card`/`.table`) แบบเดียวกับ `PurchasingDash.jsx` — token กลุ่มนี้ผูกกับ ThemeContext อยู่แล้ว
(CLAUDE.md §25) ได้โหมดกลางวัน/กลางคืน/auto ฟรีโดยไม่ต้องเขียน logic toggle เพิ่มเลย และเปลี่ยนขนาดตัวอักษรจาก
px เล็กๆ เป็น class มาตรฐาน (`text-h1`/`h2`/`h3`/`body`) + เปลี่ยน layout จาก fixed 100vh 3-column หนาแน่น เป็น
หน้าปกติ scroll ได้ตามธรรมชาติ (HeroStat KPI row, bar chart+donut, panel เกินกำหนดไฮไลต์แดง, ตารางทีมเต็ม) —
สีกราฟใช้ `rgb(var(--color-x))` (เทคนิคเดียวกับ donut ของ `PurchasingDash.jsx`) ให้สลับสีเองตาม theme โดยไม่ต้อง
ตรวจ JS เลย — ไม่แตะ `shared.jsx` เลย (ยังใช้กับ dashboard มืดถาวรตัวอื่นอยู่)

**Test:** `node --test` → 258/258 เขียว, 0 skip

**Verify:** Playwright ยืนยันทั้ง light mode (ค่าเริ่มต้น) และ dark mode (สลับผ่าน `iqc_theme_preference` +
reload) — screenshot ทั้งสองโหมด ทุก section อ่านง่ายชัดเจน ไม่มี console error — commit `0144d69`

---

**คำขอ (รอบที่ 5):** user รายงาน 3 เรื่องที่ฟอร์ม "อัปเดตสถานะ" (DetailModal ฝั่ง qc_staff) — (1) ช่อง "เวลาที่มาส่ง"
ให้เป็น 24 ชม. ไม่ต้องมี AM/PM ให้เลือก (2) ปุ่มบันทึกถ้ากรอกข้อมูลไม่ครบ (เช่น วันที่ส่งจริง/เวลาที่มาส่ง) ให้มี
popup แจ้งเตือน (3) เหตุผลตอน "ส่งนอกแผน" (late) ให้ตอบหรือไม่ตอบก็ได้ ไม่ต้องบังคับ

**การแก้:**
- `<input type="time">` เพิ่ม `lang="en-GB"` — Chromium ใช้ locale นี้ตัดสิน 24 ชม./AM-PM ของ time picker พื้นเมือง
  ไม่ใช่ locale ของเครื่อง/browser ผู้ใช้ (fix มาตรฐานที่รู้จักกันดี)
- `handleStatusSave()` เพิ่ม validation ก่อน submit — เช็ค `actual_date`/`actual_time` (ตอน on_time/late),
  `rescheduled_date` (ตอน rescheduled), `late_reason` (เฉพาะ cancelled/rescheduled) แล้ว `alert()` รายชื่อฟิลด์
  ที่ขาดก่อนเรียก mutation — เดิมปุ่ม disabled เช็คแค่ `!statusForm.status` ทำให้กดบันทึกทั้งที่ค่าอื่นว่างเงียบๆ ได้
- `routes/delivery.js`'s required-reason check ตัด `status === 'late'` ออกจากเงื่อนไข เหลือบังคับเฉพาะ
  `cancelled`/`rescheduled` (action ที่กระทบแผนเดิมมากกว่า ควรมี audit trail เสมอ) — อัปเดต `DEL-08` ใน
  `delivery.test.js` ให้ assert 200 แทน 400 เดิม

**Test:** `node --test` → 258/258 เขียว (รวม DEL-08 ที่แก้ assertion แล้ว), 0 skip

**Verify:** Playwright ยืนยัน `lang="en-GB"` บน time input, popup แสดงชื่อฟิลด์ที่ขาดถูกต้องตอนกดบันทึกฟอร์มว่าง,
และบันทึกสถานะ "ส่งนอกแผน" โดยไม่กรอกเหตุผลสำเร็จ (ไม่มี popup ขึ้น, badge แสดง "ส่งนอกแผน" ถูกต้อง) —
commit `a8aa9c3`

---

**คำขอ (รอบที่ 6):** user ส่ง screenshot ยืนยันว่า "เวลาที่มาส่ง" ยังมี AM/PM ให้เลือกอยู่ ทั้งที่เพิ่ง `lang="en-GB"`
ไปในรอบก่อน

**Root cause:** `lang="en-GB"` ไม่ได้ผลจริงกับทุกเครื่อง — native time picker widget ของ `<input type="time">`
ยึดตาม regional format ของ Windows/browser ที่เครื่อง user เอง ไม่ใช่ HTML `lang` attribute (screenshot จริง
ยืนยันชัดเจนว่ายังมีคอลัมน์ AM/PM อยู่) เป็นข้อจำกัดของ native widget ที่แก้ด้วย attribute ไม่ได้จริง

**การแก้:** เปลี่ยนจาก `<input type="time">` เป็น `TimePicker` component เดิมที่ใช้กับ `time_slot` (นัดหมาย) อยู่แล้ว
ในไฟล์เดียวกัน — เป็น `<select>` ธรรมดา 2 ตัว (ชั่วโมง 07-18, นาที 00/15/30/45) ไม่พึ่ง native widget เลย จึงไม่มี
ทางโผล่ AM/PM ได้อีก

**Test:** `node --test` → 258/258 เขียว, 0 skip

**Verify:** Playwright ยืนยันไม่มี `input[type=time]` เหลืออยู่เลย, ตัวเลือกชั่วโมงเป็นเลข 24 ชม.ล้วน (07-18 ไม่มี
AM/PM), และตรวจ DB ตรงๆ หลังบันทึกยืนยัน `actual_time='15:45'` ถูกต้องตรงกับที่เลือก (15 ชม. + 45 นาที) พร้อม
`late_reason=null` (ยืนยันว่า fix รอบก่อนยังทำงานถูกต้องคู่กัน) — commit `e29d62d`

---

**คำขอ (รอบที่ 7, นอกโมดูล Delivery):** user ส่ง screenshot หน้า "บิลรับเข้า" (`Bills/index.jsx`) — ตารางมีแถวว่าง
เปล่าต่อท้ายข้อมูลจริงเต็มหน้า ขอให้เอาออก เหลือเฉพาะแถวที่มีข้อมูลจริง

**สิ่งที่พบ:** ตารางมี logic pad แถวว่างให้ครบ `PAGE_SIZE` (10 แถว/หน้า ตาม CLAUDE.md §16) เสมอ
(`Array.from({ length: PAGE_SIZE - pageRows.length }, ...)` ต่อท้าย `pageRows.map`) ไว้กันความสูงตารางกระโดด
เวลาสลับหน้าที่มีจำนวนแถวไม่เท่ากัน — user เห็นว่าดูรกเกินไปเมื่อมีข้อมูลน้อย ขอให้ตัดออก

**การแก้:** ลบ block pad แถวว่างออกทั้งหมด เหลือแค่แถวข้อมูลจริงจาก `pageRows.map`

**Test:** `node --test` → 258/258 เขียว, 0 skip (ไม่กระทบ backend เลย เป็น frontend-only)

**Verify:** Playwright ยืนยัน seed ข้อมูล 1 แถวแล้วตารางแสดงแค่ 1 แถวจริง ไม่มีแถวว่างเหลือ — **หมายเหตุ:** การแก้นี้
ถูก sweep เข้า auto-commit ภายนอก `b95c66e "Deploy 2026-07-14 09:55"` (deploy script อัตโนมัติของเครื่อง user เอง
commit ทับไปพร้อมกัน — pattern นี้มีมาก่อนแล้วตั้งแต่ต้น session เห็นได้จาก commit "Deploy 2026-07-09/07-10" ใน log
เดิม) ไม่ใช่ commit ที่ตัว assistant สร้างเองในรอบนี้

---

**คำขอ (รอบที่ 8):** user ขอเพิ่ม role "หัวหน้าคลัง" และ "ผู้จัดการคลัง" — ให้ดู "ปฏิทินการรับเข้า" ได้ + รับแจ้งเตือน
แผนรับเข้าจากจัดซื้อ + กดปุ่ม "รับทราบ" แทน qc_staff เดิม โดย qc_staff เหลือหน้าที่แค่บันทึกวันเวลาที่มาส่งของจริง
อย่างเดียว — **ถาม `AskUserQuestion` 2 ข้อก่อนเริ่ม** เพราะเป็นการเพิ่ม role ใหม่ (แก้ schema) + ปรับ workflow ข้าม
role ซึ่งกลับยากถ้าตีความผิด: (1) qc_supervisor ยังกดรับทราบได้เป็น backup ไหม — user เลือก **"คลังทำเพียงฝ่าย
เดียว"** (ตัด qc_supervisor ออกจากสิทธิ์รับทราบด้วย ไม่ใช่แค่ qc_staff) (2) เมนู sidebar ของคลังควรมีแค่ปฏิทิน หรือ
มี Master List (ดู Supplier) ด้วย — user เลือก **"แค่ปฏิทินรับเข้าอย่างเดียว"**

**การแก้ (backend):**
- `schema.sql` + migration ใหม่ `migrateUsersRoleConstraintWarehouse()` ใน `database.js` (pattern เดียวกับ
  `migrateUsersRoleConstraint()` เดิมเป๊ะ — rebuild ตาราง + shared column intersection + gate กันรันซ้ำ) เพิ่ม
  `warehouse_supervisor`/`warehouse_manager` เข้า `users.role` CHECK
- `routes/delivery.js`'s `POST /:id/acknowledge` เปลี่ยน `requireRole` จาก `['qc_staff','qc_supervisor']` เป็น
  `['warehouse_supervisor','warehouse_manager']` — `PATCH /:id/status` (บันทึกวันเวลามาส่งจริง) ไม่แตะเลย
- `deliveryService.js` เพิ่ม `getWarehouseStaff()` helper แล้วเปลี่ยนทุกจุดที่เคยแจ้งเตือน "กรุณารับทราบ" (แผนใหม่/
  นอกเวลาทำงาน/วันหยุด/เลื่อนวัน/แก้ไข/ยกเลิก) จาก `getReceivingQCStaff()`+`qc_supervisor`(+`qc_manager` บาง
  จุด) ไปเป็นคลังทั้งหมด — แก้ข้อความแจ้งเตือน/ประวัติที่เคยเขียน "QC รับทราบ..." ให้ตรงกับผู้กระทำจริง

**การแก้ (frontend):**
- `rolePermissions.js`: เพิ่ม `ROLE_LABELS` 2 role ใหม่, เพิ่มเข้า `ALL_QC_ROLES` (หน้าหลัก + กลุ่ม IQC) และเข้า
  roles array ของ child `/delivery` เท่านั้น (ไม่แตะ children อื่นในกลุ่มเดียวกัน) — ผลคือกลุ่ม "ส่วนงานรับเข้า
  (IQC)" ของคลังโชว์แค่ "ปฏิทินส่งของ" ตัวเดียวอัตโนมัติ ไม่ต้องสร้าง nav item แยกใหม่
- `Delivery/index.jsx`: เพิ่ม `isWarehouse` แยกจาก `isQC` เดิม — `canAck` ผูกกับ `isWarehouse`, `canUpdateStatus`
  ยังผูกกับ `isQC` เหมือนเดิม (คนละสิทธิ์กันแล้ว)
- อัปเดต `test/delivery.test.js`/`test/purchasingScope.test.js` ให้ตรงกับขอบเขตสิทธิ์ใหม่ (เพิ่ม fixture user
  คลัง + assertion 403 สำหรับ qc_staff กด acknowledge)

**Test:** `node --test` → 260/260 เขียว (+2 เคสใหม่), 0 skip

**Verify:** Playwright ยืนยัน flow เต็ม — จัดซื้อสร้างแผน → คลัง (`warehouse_supervisor`) ได้กระดิ่งแจ้งเตือน +
sidebar โชว์แค่ "ปฏิทินส่งของ" ใต้กลุ่ม IQC (ไม่มีบิล/NCR/UAI) → กดรับทราบสำเร็จ → qc_staff ไม่มีปุ่มรับทราบเลย
แต่กดอัปเดตสถานะ (บันทึกวันเวลามาส่งจริง) ได้หลังคลังรับทราบแล้ว ตรงตามที่ user ต้องการเป๊ะ — commit `14fac2e`

---

**คำขอ (รอบที่ 9):** user ขอเพิ่มหน้า dashboard ให้กับ ID หัวหน้าคลัง/ผู้จัดการคลัง (2 role ที่เพิ่งเพิ่มในรอบที่ 8)

**สิ่งที่พบ:** `Dashboard/index.jsx`'s `roleMap` ไม่มี entry ให้ 2 role ใหม่นี้เลย — ตกไปโชว์ fallback ว่างเปล่า
"ยินดีต้อนรับ" ที่หน้า `/` เพราะ role อื่นทุกตัวมี component เฉพาะของตัวเองแต่ role คลังไม่มี

**การแก้:** สร้าง `WarehouseDash.jsx` ใหม่ 1 ไฟล์ ใช้ร่วมกันทั้ง 2 role (เหมือน `ExecutiveDash` ที่ cco/cmo/cpo ใช้
ร่วมกัน) — เนื้อหาเน้นตามขอบเขตงานที่ตกลงกันไว้ในรอบที่ 8 (ดูปฏิทิน + รับทราบเท่านั้น ไม่มี Master List/รายงานอื่น):
4 การ์ด HeroStat (รอรับทราบวันนี้/รอรับทราบทั้งหมดเดือนนี้/รับทราบแล้วรอของเข้า/รับของเสร็จวันนี้), รายการ "รอรับทราบ"
ที่กดแล้วเปิด `DetailModal` เดิมจาก `Delivery/index.jsx` ได้ทันที (มีปุ่ม "รับทราบ" ให้กดในนั้นเลย ไม่ต้องเข้าไปหน้า
ปฏิทินก่อน), และฝัง `MiniDeliveryCalendar` เดิม — ไม่เขียน calendar/modal ใหม่ซ้ำ ใช้ query key `['delivery', from,
to]` เดียวกับ `MiniDeliveryCalendar`/หน้าปฏิทินเต็ม เพื่อแชร์ cache + ให้ `invalidateQueries(['delivery'])` จากที่
อื่น (เช่นกดรับทราบใน modal) รีเฟรชการ์ด/รายการนี้ให้อัตโนมัติ ใช้ semantic theme token (`bg-surface`/`text-text`/
`.card`/`HeroStat`) แบบเดียวกับ `PurchasingDash.jsx`/`ManagerPurchasingDash.jsx` (รอบที่ 4 ด้านบน) — ไม่ใช้ dark `D`
token ตายตัว เพื่อให้อ่านง่าย + รองรับ light/dark ทันที แล้วเพิ่ม import + 2 entry ใน `roleMap` ของ
`Dashboard/index.jsx`

**Test:** `node --test` → 260/260 เขียว (ไม่กระทบ backend เลย เป็น frontend-only)

**Verify:** ตั้ง server แยก + seed ข้อมูลจำลอง (2 แผนรอรับทราบวันนี้/1 รอรับทราบในอีก 2 วัน/1 รับทราบแล้ว/1 รับของ
เสร็จวันนี้) แล้ว Playwright ยืนยัน: การ์ด KPI ตรงเลขทั้ง 4 ใบ (2/3/1/1), รายการรอรับทราบโชว์ 3 supplier ถูกต้องพร้อม
badge "วันนี้" 2 อัน, คลิกแถวเปิด modal พร้อมปุ่ม "รับทราบ" (ยืนยันด้วย screenshot), กดรับทราบแล้วเลขการ์ด+รายการ
อัปเดตสดถูกต้อง (เหลือ 1 รอรับทราบวันนี้ supplier ที่กดไปหายจากรายการ) — commit `5c9c04b`

---

**คำขอ (รอบที่ 10):** user ขอเปลี่ยนชื่อหัวข้อ sidebar จาก "ส่วนงานรับเข้า (IQC)" เป็น "กลุ่มงานรับเข้าสินค้า"

**การแก้:** แก้ `label` ของ nav group `/iqc` ใน `rolePermissions.js` บรรทัดเดียว (`mobileLabel: 'IQC'` เดิมไม่แตะ —
คนละ prop กัน ใช้กับ bottom nav มือถือที่ไม่มีที่พอสำหรับข้อความยาว)

**Test:** ไม่กระทบ backend — frontend label เปลี่ยนอย่างเดียว

**Verify:** grep ยืนยันเป็นจุดเดียวในโค้ดที่กำหนด label นี้ (ไม่มี hardcode ซ้ำที่ไหนอีก) — commit `702a336`

---

**คำขอ (รอบที่ 11):** user ขอเปลี่ยน section "รายการรอรับทราบ" ในหน้าหลักคลัง (หัวหน้าคลัง/ผู้จัดการคลัง) เป็น
"รายการสินค้าที่รอรับเข้าวันนี้" แทน และขอเพิ่ม section เดียวกันนี้ในหน้าหลักของ qc_staff และ qc_supervisor ด้วย

**การแก้ (`WarehouseDash.jsx`):** section เดิมโชว์ทุกแผนที่ `status='pending'` ทั้งเดือน (ไม่กรองวันที่) เปลี่ยนเป็น
`todayAwaiting` — กรอง `scheduled_date === today` **และ** `status ใน [pending, acknowledged]` (กว้างกว่าฉบับเดิมที่
กรองแค่ pending เพราะ acknowledged ก็ยังถือว่า "รอรับเข้า" อยู่ ยังไม่มีของมาจริง) — badge "วันนี้" เดิม (ซ้ำซ้อนเพราะ
ทุกแถวเป็นวันนี้อยู่แล้ว) เปลี่ยนเป็น badge สถานะ (รอรับทราบ/รับทราบแล้ว) แทน — การ์ด KPI ด้านบนไม่แตะ (user ขอแค่ตัว
list)

**การแก้ (`QCStaffDash.jsx`/`SupervisorDash.jsx`):** เพิ่ม query `/delivery?from=today&to=today` ใหม่ + filter
เดียวกับข้างต้น + reuse `DetailModal` เดิมจาก `Delivery/index.jsx` (`suppliers=[]` เพราะชื่อผู้ผลิต fallback ไปที่
`schedule.supplier_name` อยู่แล้วถ้าไม่มี array ให้ค้น, `holidays=[]` เพราะ 2 role นี้ไม่มีสิทธิ์แก้ไขตาราง — ไม่ใช้
ทั้งคู่) — `SupervisorDash.jsx` ใช้ semantic token (`.card` เดิมของไฟล์) ตรงไปตรงมา ส่วน `QCStaffDash.jsx` ต้องเขียน
การ์ดด้วย `D` token (dark ตายตัว) แทนเพราะทั้งหน้าใช้ inline dark palette ถาวรอยู่แล้ว (CLAUDE.md §25.2 — หน้านี้
ยกเว้นจาก dark-mode toggle) ถ้าใช้ semantic token (`bg-surface` ฯลฯ) จะขัดกันตอน user ตั้ง light mode เพราะพื้นหลัง
รอบข้างยังมืดถาวรอยู่ — เพิ่มทั้ง mobile block (การ์ดเต็มความกว้างแบบ "บิลล่าสุด") และ desktop 3-column block (การ์ด
กะทัดรัดใน column ขวา ก่อน "NCR/NCP", จำกัดความสูง scroll ภายในกัน layout เพี้ยนเพราะ column เดิมเป็น fixed-height)

**Test:** `node --test` → 260/260 เขียว (ไม่กระทบ backend เลย เป็น frontend-only)

**Verify:** seed แผนวันนี้ 3 แบบ (pending 1/acknowledged 1/completed 1) แล้ว Playwright ยืนยันทั้ง 3 หน้า: โชว์ 2
รายการที่ยังไม่เสร็จถูกต้อง (ไม่โชว์รายการที่ completed แล้ว), badge สถานะถูกต้อง, และคลิกแถว acknowledged ใน
`QCStaffDash` เปิด modal พร้อมปุ่ม "อัปเดตสถานะ" ถูกต้องตามสิทธิ์ (screenshot ยืนยันทั้ง dark QCStaffDash/light
SupervisorDash/WarehouseDash ที่แก้ label ใหม่) — commit `c7c6a7d`

---

**คำขอ (รอบที่ 12):** user ขอย้ายกล่อง "รอรับเข้าวันนี้" ใน `QCStaffDash.jsx` (desktop) จากคอลัมน์ "NCR Monitor" ไป
อยู่ในคอลัมน์ "แนวโน้มรับเข้า" แทน (รู้สึกว่าไม่เข้าพวกกับการ์ด NCR อื่นๆ ในคอลัมน์เดิม)

**การแก้:** ย้าย JSX block เดิมทั้งก้อนจากคอลัมน์ขวาไปไว้บนสุดของคอลัมน์กลาง (เหนือกราฟพื้นที่ 7 วัน) — ไม่แตะ
logic/data ใดๆ ทั้งสิ้น ย้ายตำแหน่งอย่างเดียว

**Test:** `node --test` → 260/260 เขียว (ไม่กระทบ backend)

**Verify:** screenshot ยืนยันตำแหน่งใหม่ถูกต้อง คอลัมน์ NCR Monitor โล่งขึ้น — commit `a45c18a`

---

**คำขอ (รอบที่ 13):** user ขอ 3 เรื่องใน `QCStaffDash.jsx` (desktop): (1) สลับกล่อง "บิลล่าสุด" กับ "ภาพรวมคุณภาพ"
ระหว่างคอลัมน์กลาง/ขวา (2) เปลี่ยนชื่อคอลัมน์ "NCR Monitor" เป็น "NCR/NCP Monitor" (3) เปลี่ยนชื่อกล่อง "ภาพรวม
คุณภาพ" เป็น "สรุปภาพรวม NCR/NCP"

**การแก้:** สลับตำแหน่ง JSX block "บิลล่าสุด"↔"ภาพรวมคุณภาพ" ระหว่าง 2 คอลัมน์ (ไม่แตะ logic/data) + เปลี่ยนข้อความ
`CatLabel` และ `<p>` หัวข้อกล่องตามที่ขอ

**Test:** `node --test` → 260/260 เขียว (ไม่กระทบ backend)

**Verify:** screenshot ยืนยันลำดับใหม่: คอลัมน์กลาง = รอรับเข้าวันนี้→กราฟ 7 วัน→บิลล่าสุด, คอลัมน์ขวา (ชื่อใหม่
"NCR/NCP Monitor") = NCR/NCP→NCR ตามขั้นตอน→สรุปภาพรวม NCR/NCP — commit `b01088a`

---

**คำขอ (รอบที่ 14):** user ขอ 2 เรื่องใหญ่ใน `QCStaffDash.jsx` (desktop): (1) เปลี่ยนกล่อง "อัตราผ่านการตรวจ" ในคอลัมน์
"คุณภาพการรับเข้า" เป็น "ปฏิทินส่งของ" แทน + ย้าย "รอรับเข้าวันนี้"/"บิลล่าสุด" มาอยู่ใต้ปฏิทินนี้ (ตามลำดับ) + ย้าย
"บิลรายวัน 7 วัน" (เดิมอยู่คอลัมน์นี้) ไปแทนที่ "รับเข้า / ไม่ผ่าน 7 วัน" ในคอลัมน์กลาง (เอาตัวหลังออก) (2) อัปเกรด
"บิลรายวัน 7 วัน" จาก fix 7 วันตายตัว เป็น filter ได้ (รายวัน/รายเดือน/รายปี + เปรียบเทียบ YoY/MoM) แบ่งครึ่งช่อง
ครึ่งบนเป็นกราฟแนวโน้ม ครึ่งล่างเป็นหลอดจัดอันดับผู้ผลิตที่รับเข้ามากสุด→น้อยสุด filter ได้เหมือนกัน — ถาม
`AskUserQuestion` 2 ข้อก่อนเริ่มเพราะเป็นงาน backend aggregation ใหม่ทั้งหมด เดางานผิดจะเสียเวลาสร้างซ้ำ: (1) เกณฑ์
จัดอันดับ "รับเข้ามากสุด" — user เลือก **"จำนวนบิลที่รับเข้า (นับบิล)"** ไม่ใช่ผลรวม qty (2) รูปแบบเปรียบเทียบ
YoY/MoM — user เลือก **"กราฟซ้อน 2 ชุดข้อมูล"** (แนะนำ) ไม่ใช่แค่ตัวเลข %

**การแก้ (backend, `routes/dashboard.js`):** เพิ่ม `computePeriod(granularity, compare, anchorDate)` helper กลาง
คำนวณช่วงวันที่ current+comparison ให้ 2 endpoint ใหม่ใช้ร่วมกัน (period ต้องตรงกันเป๊ะระหว่างกราฟกับหลอดจัดอันดับ):
`GET /bills-trend` (bucket ตาม granularity, คืน current+comparison array) และ `GET /bills-by-supplier` (จัดอันดับ
ตามจำนวนบิล, คืน current+comparison ต่อ supplier) — กฎการรองรับเปรียบเทียบ: `day` รองรับทั้ง mom/yoy, `month`
รองรับเฉพาะ yoy (mom ไม่มีความหมายเมื่อ bucket เป็นเดือนอยู่แล้ว), `year` ไม่รองรับเปรียบเทียบเลย (ไม่มี "ช่วงเดียวกัน
ปีก่อน" ที่สมเหตุสมผลของ bucket ปี) — บังคับทั้ง client (`<select disabled>`) และ server (`parseCompare` เขียนทับ
เป็น `none` เสมอถ้า granularity ไม่รองรับ)

**บั๊กที่เจอระหว่างพัฒนา (แก้แล้วก่อน commit):** `fetchBuckets()` ตอนแรกใช้ `period.bucketCount` (จำนวนวันของ "เดือน
ปัจจุบัน" เท่านั้น) เป็นความยาว array ให้ทั้ง current และ comparison bucket — ทำให้ตอนเทียบ ก.ค.(31 วัน) กับ
มิ.ย.(30 วัน) แบบ MoM กราฟเปรียบเทียบจะมีวันที่ 31 หลอกที่ไม่มีจริงโผล่มา — แก้โดยอ่านจำนวนวันจาก `end` date ของแต่ละ
ช่วงเอง (`Number(end.slice(8,10))`) แทน — เขียน `test/billsTrend.test.js` (12 เคส) ครอบ bucket boundary/mom-yoy
window/ranking order ไว้ด้วย จับบั๊กนี้ได้จริงตอนรัน test ครั้งแรก (ไม่ใช่แค่เขียนดักไว้เฉยๆ)

**การแก้ (frontend):** สร้าง `MiniDeliveryCalendarDark.jsx` ใหม่ (คัดลอก logic ปฏิทิน/click-to-detail/holiday จาก
`MiniDeliveryCalendar.jsx` เดิม แต่เปลี่ยนจาก semantic token เป็น `D` token — เหตุผลเดียวกับที่แก้ "รอรับเข้าวันนี้"/
"บิลล่าสุด" ไปก่อนหน้านี้ในไฟล์นี้: หน้า `QCStaffDash` มืดถาวรเสมอตาม CLAUDE.md §25.2 ใช้ `.card` เดิมตรงๆ จะกลาย
เป็นกล่องขาวลอยตอน light mode — `CreateModal`/`DetailModal` เป็น overlay คนละชั้นจากพื้นหลังหน้าเลยใช้ของเดิมได้ปกติ
ไม่ต้อง reskin) และ `BillsTrendPanel.jsx` ใหม่ (filter bar ใช้ dropdown เดียวกันควบคุมทั้ง 2 ครึ่ง ไม่แยก dropdown
ต่อครึ่งเพื่อกันสับสนว่ามองคนละช่วงเวลา — กราฟบนใช้ recharts `BarChart` 2 `dataKey` (current/comparison) ซ้อนกัน,
หลอดจัดอันดับล่างใช้ horizontal bar 2 แถบซ้อนต่อ supplier เมื่อเปิดโหมดเปรียบเทียบ)

**Test:** `node --test` → 272/272 เขียว (260 เดิม + 12 ใหม่จาก `billsTrend.test.js`)

**Verify:** ตั้ง server แยก + seed บิลหลายเดือน/หลาย supplier + Playwright ยืนยัน: มุมมองเริ่มต้น (รายวัน) โชว์
ปฏิทิน+รายการ+อันดับถูกต้อง (เรียง กระจกไทย(6) > อลูมิเนียม(4) > ยูพีวีซี(2) > ฮาร์ดแวร์(1)), สลับเป็นรายเดือน+YoY
กราฟ/legend ("ปีนี้"/"ปีก่อน")/หลอดจัดอันดับ 2 แถบอัปเดตถูกต้อง, สลับเป็นรายปี dropdown เปรียบเทียบถูก disable
อัตโนมัติและกราฟ 5 ปีถูกต้อง (screenshot ยืนยันทั้ง 3 มุมมอง) — commit `f599424`

---

**คำขอ (รอบที่ 15):** user ส่ง screenshot ของ `QCStaffDash.jsx` (desktop) พร้อมข้อความ "เปลี่ยนเป็น UAI และปรับข้อมูล
ให้สัมพันธ์กับ UAI" คั่นอยู่กลางกล่อง NCR/NCP ที่ดูเหมือนซ้อนกัน 2 กล่องในภาพ — **ถาม `AskUserQuestion` 2 ข้อก่อนแก้**
เพราะภาพมี artifact ที่ตีความยาก (sidebar/header หาย, เส้นแบ่งแนวนอนพาดกลางจอ, กล่อง NCR/NCP ซ้ำ): (1) ข้อความ
หมายถึงอยากได้กล่องสรุป UAI ใหม่แทนกล่องซ้ำใช่ไหม — user ยืนยัน **"ใช่ เพิ่มกล่องสรุป UAI ใหม่"** (2) ส่วนอื่นที่ดู
ผิดปกติในภาพเป็น artifact จากการจับภาพหรือไม่ — user ยืนยัน **"เป็น artifact ไม่ต้องสนใจ"**

**การแก้:** เพิ่มการ์ด "UAI" ใหม่ในคอลัมน์ "NCR/NCP Monitor" คั่นระหว่างการ์ด "NCR / NCP" กับ "NCR ตามขั้นตอน" — โชว์
`เปิดอยู่` (`uai_not_final_count`) คู่กับ `เสร็จแล้ว` (`uai_completed_count`) พร้อม progress bar % เสร็จแล้ว —
ข้อมูลดึงจาก `/api/dashboard/stats` ที่มีอยู่แล้ว (`uai_total`/`uai_completed_count`/`uai_not_final_count`) ไม่ต้อง
แก้ backend เลย — **ไม่มีปุ่ม "ดูทั้งหมด"** ต่างจากการ์ดอื่นในคอลัมน์เดียวกัน เพราะ qc_staff ไม่มีสิทธิ์เข้า `/uai`
ตาม `rolePermissions.js` (ปุ่มลิงก์ไปจะเจอ permission เด้งกลับเปล่าประโยชน์) เหมือนกับที่การ์ด "NCR / NCP" split เดิม
ก็ไม่มีปุ่มนี้อยู่แล้วเช่นกัน (สอดคล้องกับ pattern เดิมในไฟล์)

**Test:** `node --test` → 272/272 เขียว (ไม่กระทบ backend เลย เป็น frontend-only)

**Verify:** seed เอกสาร UAI หลายสถานะ (เปิดอยู่/เสร็จแล้ว) แล้ว Playwright + screenshot ยืนยันการ์ดใหม่แสดงตัวเลขและ
progress bar ถูกต้อง ตำแหน่งอยู่ระหว่าง NCR/NCP กับ NCR ตามขั้นตอนตามที่ user ต้องการ — commit `d26e445`

---

**คำขอ (รอบที่ 16):** user ขอ 4 เรื่องใน `QCStaffDash.jsx` (desktop): (1) เพิ่มปุ่มเลือกมุมมองปฏิทิน รายปี/รายเดือน/
รายวัน + ปรับกล่องปฏิทินให้สูงเท่ากล่อง "บิลรับเข้า" (2) ย้าย "รอรับเข้าวันนี้" ไปอยู่ระดับเดียวกับ "ผู้ผลิตที่รับเข้า
มากสุด" + สูงครึ่งหนึ่งของกล่องนั้น (3) "บิลล่าสุด" สูงครึ่งหนึ่งของกล่อง "ผู้ผลิตที่รับเข้ามากสุด" เหมือนกัน (4) เพิ่ม
โหมดสว่างให้ dashboard นี้ด้วย (เดิมมืดตายตัวตาม CLAUDE.md §25.2 — user ขอยกเว้นเฉพาะหน้านี้ตรงๆ)

**สิ่งที่พบ (ข้อ 1-3):** โครง flex ของ 3 คอลัมน์เดิมทำให้ข้อ 2/3 แก้พร้อมกับข้อ 1 ได้ในตาโครงสร้างเดียว — ถ้าคอลัมน์
ซ้ายมี top-level children แค่ 2 ตัวเป็น `flex-1`/`flex-1` เหมือนคอลัมน์กลาง (แนวโน้มรับเข้า: กราฟ/หลอดจัดอันดับ)
ความสูงจะเท่ากันโดยอัตโนมัติจาก CSS ไม่ต้องคำนวณ pixel เอง — เลยยุบ "รอรับเข้าวันนี้"+"บิลล่าสุด" ให้อยู่ใน wrapper
`flex-1` เดียวกัน (ตัวที่ 2 ของคอลัมน์) แล้วแบ่งข้างในเป็น `flex-1`/`flex-1` อีกที ได้ผลลัพธ์ตรงตามคำขอทั้ง 3 ข้อ
พร้อมกัน

**การแก้ (ข้อ 1):** สร้าง `QCDeliveryCalendar.jsx` ใหม่แทน `MiniDeliveryCalendarDark.jsx` เดิม (ลบไฟล์เดิมทิ้ง) —
เพิ่มปุ่ม รายปี/รายเดือน/รายวัน: รายเดือน = grid ปฏิทินเดิม, รายวัน = agenda list วันเดียว (prev/next วัน), รายปี =
grid 12 เดือนพร้อมจำนวนแผนต่อเดือน คลิกแล้วสลับไปโหมดรายเดือนของเดือนนั้นทันที — แยกไฟล์ต่างหากจาก
`MiniDeliveryCalendar.jsx` ต้นฉบับ (ที่ PurchasingDash/WarehouseDash/SupervisorDash ใช้ร่วมกัน) เพราะ feature นี้
user ขอเฉพาะกล่องปฏิทินในหน้านี้ ไม่ได้ขอให้กระทบ dashboard อื่น

**การแก้ (ข้อ 4, ใหญ่สุด):** เพิ่ม `T` object ใหม่ใน `shared.jsx` (เพิ่มเข้าไปเฉยๆ ไม่แก้ `D` เดิม — dashboard มืด
ตายตัวอื่น เช่น AdminDash ไม่กระทบ) แมป `bg/surface/border/text/muted/accent/success` เป็น `rgb(var(--color-x))`
(theme-reactive ตรงๆ ในค่า inline style/recharts prop) — **ค้นพบสำคัญ:** ค่า dark-mode ของ CSS variable เหล่านี้ใน
`index.css` ถูกตั้งให้ตรงกับ hex ของ `D` object เป๊ะอยู่แล้วตั้งแต่ต้น (เช่น `--color-bg` dark = `#0B1929` = `D.bg`)
เพราะงั้นแปลงจาก `D`→`T` **ไม่เปลี่ยนหน้าตาตอน dark mode เลยแม้แต่พิกเซลเดียว** เปลี่ยนแค่ตอน light mode เท่านั้น —
orange/yellow/purple **ไม่แมป** เป็น semantic token เพราะชุด 10 token หลักไม่มีช่องสำหรับสีกลุ่มนี้แยกจากกัน (ลอง
แมป orange→warning แล้วพบว่า dark-mode warning ดันเท่ากับ yellow token พอดี ทำให้ NCR-major กับ NCP-minor กลาย
เป็นสีเดียวกันในโหมดมืด) จึงเก็บเป็น hex คงที่เหมือนเดิมทั้ง 2 โหมด (ใช้แยกหมวดหมู่ ไม่ใช่สีโครงสร้างที่ต้องสลับ) —
แปลง `QCStaffDash.jsx` (ทั้ง mobile+desktop) และ `BillsTrendPanel.jsx` จาก `D`→`T` ทั้งหมด — `DarkTip`/
`RadialGauge`/`CatLabel` (helper ใน `shared.jsx` ที่ dashboard มืดตายตัวอื่นใช้ร่วม) **ไม่แตะ** ยังคง chrome มืด
ภายในของตัวเอง (เช่น พื้น tooltip) เป็น trade-off ที่ยอมรับได้ ดีกว่าเสี่ยงแก้ของที่ dashboard อื่นพึ่งพาอยู่

**Test:** `node --test` → 272/272 เขียว (ไม่กระทบ backend เลย เป็น frontend-only)

**Verify:** ตั้ง server แยก + seed ข้อมูลจำลอง + Playwright บังคับ `iqc_theme_preference` เป็น light/dark ผ่าน
`localStorage` ก่อน login แล้ว screenshot ทั้ง 2 โหมด: light mode การ์ด/พื้นหลัง/ตัวอักษรสลับเป็นสีอ่อนถูกต้องหมด,
ปุ่มเลือกมุมมองปฏิทินทำงานถูกต้องทั้ง 3 โหมด (year แสดง 12 เดือน+จำนวน, day แสดง agenda วันเดียว), ความสูงกล่อง
ซ้าย-กลางตรงกันตามที่ตั้งใจ; dark mode เทียบกับ screenshot ก่อนหน้า **เหมือนเดิมทุกพิกเซล** ตามที่คาดไว้ — commit
`b554a4b`

---

**คำขอ (รอบที่ 17):** user ส่ง screenshot พร้อมข้อความ "layout ไม่สมส่วน ปรับใหม่ให้ดูดีอ่านง่าย ใช้ฟร้อนเดียวกันขนาด
หัวข้อ ขนาดข้อมูล ให้สมสวน" — ตัวอักษรในหน้า `QCStaffDash.jsx` (desktop) กระจายตั้งแต่ `text-[8px]` ถึง `text-[14px]`
ไม่มีสเกลที่แน่นอน (มรดกจากดีไซน์ dense dark-cockpit เดิมตาม CLAUDE.md §25.2 ที่รอบก่อนหน้าแก้แค่สี ไม่ได้แก้ขนาด
ตัวอักษร) — `QCDeliveryCalendar.jsx` ที่เพิ่งสร้างใหม่ในรอบก่อนใช้สเกล `text-h3`/`text-small` ของระบบอยู่แล้ว ทำให้
เห็นชัดว่าใหญ่กว่า/อ่านง่ายกว่ากล่องข้างเคียงที่ยังไม่ได้แก้ — นี่คือต้นตอของ "ไม่สมส่วน" ที่ user เห็น

**การแก้:** แทนที่ `text-[Npx]` กระจัดกระจายทั้งหมดด้วยสเกลมาตรฐาน `text-h1/h2/h3/body/small` ของระบบ (CLAUDE.md §10)
ใช้กฎเดียวกันทุกกล่อง: หัวข้อการ์ด/section ทั้งหมด = `text-h3 font-semibold`, ตัวเลขเน้น (KPI, NCR/UAI count) =
`text-h1`/`text-h2`, เนื้อหาหลัก (ชื่อ supplier, invoice no.) = `text-body`, ข้อความรอง/meta/ลิงก์ = `text-small`
ทั่วทั้ง `QCStaffDash.jsx` (เฉพาะ desktop), `BillsTrendPanel.jsx`, `QCDeliveryCalendar.jsx` — เพิ่ม padding
(`p-3`→`p-4`) และ gap (`gap-2`→`gap-3`) ให้หายใจได้มากขึ้นตามตัวอักษรที่ใหญ่ขึ้น

**ผลข้างเคียงที่ต้องแก้ตาม:** ตัวอักษรใหญ่ขึ้น ~40-45% ยัดใน fixed-viewport เดิม (`height: calc(100vh-64px)` +
`overflow-hidden`) ไม่พอแน่นอน — เอา constraint นี้ออก เปลี่ยนเป็นหน้า scroll ธรรมชาติ (ตามแนวทางเดียวกับที่ทำกับ
`ManagerPurchasingDash.jsx` ไปแล้วก่อนหน้านี้ใน session) — คอลัมน์ยังสูงเท่ากันต่อแถวเพราะ CSS Grid
`items-stretch` (ค่า default) ทำงานได้โดยไม่ต้องพึ่ง fixed viewport, เพิ่ม `min-h` ให้กราฟ/ลิสต์ (280-320px) กัน
collapse ตอนข้อมูลน้อย

**Test:** `node --test` → 272/272 เขียว (ไม่กระทบ backend เลย เป็น frontend-only)

**Verify:** ตั้ง server แยก + seed ข้อมูล + Playwright ทั้ง light/dark mode — วัด rendered height จริงของ DOM ยืนยัน
คอลัมน์ซ้าย (ปฏิทิน 463px / กล่องล่าง 463px) กับคอลัมน์กลาง (กราฟ 439px / อันดับ 439px) ยังสัดส่วนตรงกันตามตั้งใจ,
scroll ลงไปดูส่วนล่าง (บิลล่าสุด, NCR/NCP Monitor cards) ยืนยันแสดงผลถูกต้องไม่ถูกตัด (เจอ Playwright `fullPage`
screenshot capture ไม่ครบตอนแรกเพราะ nested-scroll container ของ AppLayout — ไม่ใช่บั๊กจริงของหน้า ยืนยันด้วยการ
scroll+screenshot เพิ่มแทน) — commit `fa10134`

---

**คำขอ (รอบที่ 18):** user รายงาน 3 เรื่องจากผลของรอบที่ 17: (1) "ปฏิทินส่งของ วันที่หลุดกรอบ" (2) ขอให้ dropdown
ของ "บิลรับเข้า" อยู่ในกรอบการ์ดเหมือนปุ่มเลือกมุมมองของปฏิทิน (3) ขอให้หน้า dashboard พอดีจอ ไม่ต้อง scroll เมาส์
(ย้อนกลับมติ fixed-height ที่เพิ่งถอดออกไปในรอบที่ 17 เอง — เหตุผลตอนนั้นคือกลัวฟอนต์ใหญ่ขึ้นไม่พอที่ ผิดคาด)

**Root cause (ข้อ 1):** เซลล์วันที่ที่ขยายเป็น `w-9` ในรอบตัวอักษร (17) ต้องการพื้นที่แนวตั้งมากกว่ากล่องปฏิทิน
จัดสรรให้จริงตอนเดือนไหนต้อง 6 แถว (เช่นเดือนเริ่มวันเสาร์) และไม่มี scroll container ใดๆ ครอบไว้ — แถวสุดท้ายเลย
เรนเดอร์ทะลุขอบการ์ดออกไปเฉยๆ

**การแก้:**
- (ข้อ 1) ห่อเนื้อหาที่ความสูงแปรผันของปฏิทิน (grid เดือน/agenda วัน/grid ปี) ด้วย `flex-1 min-h-0 overflow-y-auto`
  + ลดขนาด chrome ทั้งหมดของปฏิทิน (หัวข้อ/ปุ่มมุมมอง/แถว nav จาก `mb-3`→`mb-1.5`, เซลล์วันที่ `w-9`→`w-7`) ให้ 6
  แถวพอดีจริงในพื้นที่ที่จัดสรรโดยแทบไม่ต้อง scroll เลย (ทดสอบเลื่อนเดือนไปข้างหน้า 24 เดือน เจอเดือน 6 แถวหลายรอบ
  ไม่มีวันไหนหลุดกรอบอีก)
- (ข้อ 2) ย้าย `<select>` granularity/compare ของ `BillsTrendPanel.jsx` จากแถวลอยเหนือกรอบการ์ด เข้าไปอยู่ในกรอบ
  การ์ด "บิลรับเข้า" เดียวกัน (เหมือน pattern ปุ่มมุมมองของปฏิทิน)
- (ข้อ 3) เอา fixed-viewport (`height: calc(100vh-64px)` + `overflow-hidden`) กลับมาใส่ในคอลัมน์ `QCStaffDash.jsx`
  desktop เหมือนก่อนรอบที่ 17 — ความกังวลเดิมว่าฟอนต์ใหญ่ขึ้นจะไม่พอที่เกินจริง เพราะการ์ดที่มีรายการยาวแปรผัน
  (บิลล่าสุด, รอรับเข้าวันนี้, ผู้ผลิตที่รับเข้ามากสุด) มี `overflow-y-auto` ของตัวเองอยู่แล้วรองรับได้โดยไม่ต้องให้
  หน้าทั้งหน้าโตขึ้น — ขยายรูปแบบเดียวกันไปที่คอลัมน์ RIGHT ทั้งคอลัมน์ด้วย (ห่อด้วย `flex-1 min-h-0
  overflow-y-auto` เพราะจำนวนการ์ด "NCR ตามขั้นตอน" ผันแปรตามข้อมูลจริงมาก) แล้วลบ `min-h-[280px]`/`[320px]` floor
  ที่เคยใส่ไว้ตอนใช้ layout scroll-ธรรมชาติออก (ขัดกับการ shrink-to-fit ใน viewport จำกัด)

**Test:** `node --test` → 272/272 เขียว (ไม่กระทบ backend เลย เป็น frontend-only)

**Verify:** ตั้ง server แยก + seed บิล/NCR หลายสถานะ (ให้ "NCR ตามขั้นตอน" ยาวจนต้องทดสอบ RIGHT column scroll) +
Playwright ทั้ง light/dark mode — ยืนยัน `document.documentElement.scrollHeight` ไม่เกิน `clientHeight` (ไม่ต้อง
scroll ทั้งหน้า), เลื่อนปฏิทินไปข้างหน้า 24 เดือนแล้ววัด bounding rect ของปุ่มวันที่ทุกปุ่มเทียบกับกรอบการ์ด (0
overflow ทุกเดือน รวมเดือน 6 แถว), เช็ค DOM ยืนยัน `<select>` ทั้ง 2 ตัวอยู่ใน subtree เดียวกับการ์ด "บิลรับเข้า" —
screenshot ยืนยันภาพจริงตรงกับผลตรวจสอบทั้งหมด — commit `029593a`

---

**คำขอ (รอบที่ 19):** user ขอให้ปฏิทินส่งของมุมมอง "รายปี" ปรับขนาดตัวเลขจำนวนต่อเดือนให้เล็กลง (เดิม `text-h3`
16px ดูใหญ่เกินไปเทียบกับ grid 12 ช่องเล็กๆ และ label เดือนที่เป็น `text-small`)

**การแก้:** ลดตัวเลขจำนวนจาก `text-h3` เป็น `text-small` ให้ขนาดเดียวกับ label เดือน + ลด padding/gap ของ grid
เล็กน้อย (`p-2`→`p-1.5`, `gap-2`→`gap-1.5`) ให้กระชับขึ้นตามสัดส่วนใหม่

**Test:** `node --test` → 272/272 เขียว (ไม่กระทบ backend เลย เป็น frontend-only)

**Verify:** screenshot มุมมองรายปียืนยันตัวเลขเล็กลงตามสัดส่วน label เดือน อ่านง่ายไม่ล้นเด่นเกินไป — commit
`bf32c4c`

---

**คำขอ (รอบที่ 20):** user ขอ "update PDF export ในหน้าจัดซื้อใหม่ทั้งหมด" — คำสั่งกว้างมาก **ถาม
`AskUserQuestion`** ก่อนเพราะพบว่าหน้าจัดซื้อมี PDF ที่เกี่ยวข้องอยู่ 3 จุด (Purchasing Dashboard summary / NCR /
UAI) เดาผิดจะแก้ผิดจุดทั้งไฟล์ — user เลือก **"PDF สรุป Purchasing Dashboard"** (`GET
/purchasing-dashboard/pdf`, `exports.js`) ซึ่งเป็น PDF เดียวที่สร้างเฉพาะสำหรับ role จัดซื้อจริงๆ (อีก 2 จุดใช้ร่วม
กับ QC หลาย role)

**สิ่งที่พบ:** PDF เดิมเขียนไว้ก่อนที่ `PurchasingDash.jsx` จะถูก redesign ใหม่ (Session 125-127 รอบก่อนๆ ในไฟล์นี้
— Hero KPI + bucket bar chart + closing-rate donut) แล้วไม่เคยอัปเดต PDF ให้ตรงกันเลย — PDF เดิมมีแค่กล่อง
stat-box แบนราบ 11 ช่องไม่มีลำดับความสำคัญ + ตาราง supplier เดียว ไม่มีข้อมูล "รายการเกินกำหนด" เลยทั้งที่หน้าจอเน้น
วง "เกินกำหนด" ด้วย `emphasize`/ขอบแดงอยู่แล้ว

**การแก้:** เขียนใหม่ทั้ง route (`exports.js`'s `/purchasing-dashboard/pdf`) ให้ตรงกับหน้าจอ: (1) Hero KPI 4 ช่อง
สีตรงกับ primary/warning/success/danger ของหน้าจอเป๊ะ (2) แถบ bucket breakdown แบบ CSS bar (6 หมวดสีเดียวกับ
`BucketBarChart`) (3) วงกลม % ปิดงานด้วย CSS `conic-gradient` ล้วน (ไม่ต้องพึ่ง chart library ฝั่ง server — Chromium
ที่ Puppeteer ใช้เรนเดอร์ได้เต็มที่) (4) เพิ่มตาราง **"รายการเกินกำหนด" ใหม่ทั้งหมด** (ข้อมูลที่ actionable ที่สุดแต่
PDF เดิมไม่เคยมีเลย) ดึงจาก `purchasingDashboardService.getNcrList(user, {overdue:'1'})` โชว์จำนวนวันที่เกินมาสีแดง
ต่อรายการ (5) คงตาราง supplier summary เดิมไว้ (scope ตาม role เดิมทุกอย่าง) จัดสไตล์ใหม่ให้เข้าชุด

**Test:** `node --test` → 272/272 เขียว (ไม่แตะ schema/service เลย แก้แค่ route)

**Verify:** ตั้ง server แยก + seed supplier/NCR หลายสถานะ (รวม 3 เกินกำหนด, 3 ปิดแล้ว) + login เป็น `purchasing1`
จริงผ่าน Playwright แล้วกดปุ่ม "Export PDF" ดาวน์โหลดไฟล์จริง — อ่านเนื้อหา PDF ที่ได้ตรงๆ ยืนยันทุก section
เรนเดอร์ถูกต้อง ตัวเลขตรงกับข้อมูลที่ seed ไว้ทั้งหมด (งานที่ต้องดำเนินการ=7, ปิดแล้ว=3, เกินกำหนด=3, อัตราปิดงาน
30%, breakdown ต่อ supplier ถูกต้อง) — commit `76f3488`

---

**คำขอ (รอบที่ 21):** user รายงาน "Issue Talk การแจ้งเตือนว่ายังไม่ได้อ่านข้อความ (กลมแดง 1) ไม่ real-time" — ต้อง
รอ 30 วิ (refetchInterval ของ react-query) หรือ navigate/reload ถึงจะเห็นตัวเลขอัปเดต

**Root cause:** `POST /:id/messages` (`routes/issue-talk.js`) ไม่เคยยิง SSE event เลยตอน insert ข้อความใหม่ —
คอมเมนต์เดิมบรรทัดนั้น ("ไม่ส่ง notification ไปที่กระดิ่ง — ใช้ badge บน menu แทน") ตั้งใจแค่ข้าม
`createNotification()` สำหรับข้อความตอบกลับ แต่ในโค้ดนี้ SSE push ผูกอยู่กับ `createNotification()` เท่านั้น (ไม่มี
broadcast แยกที่อื่น) — พอข้าม `createNotification()` เลยข้าม SSE ไปด้วยโดยไม่ตั้งใจ ทั้งที่ `useSSE.js`'s
`keysFromLink()` มี case `'issue-talk'` (invalidate `issue-talks`/`issue-talk-unread`/`issue-talk,id`) ครบอยู่แล้ว
ฝั่ง client ไม่ต้องแก้เลย

**การแก้:** เพิ่ม `db.broadcastSSE('status_change', { link: \`/issue-talk/\${id}\` })` ตรงๆ หลัง insert ข้อความ
แทนที่จะเรียก `createNotification()` — event type `'status_change'` (ต่างจาก `'notification'`) เป็น pattern
ที่มีอยู่แล้วในระบบสำหรับ "อัปเดต cache โดยไม่แตะกระดิ่ง" ตรงตาม intent เดิมเป๊ะ แค่เปลี่ยนจาก poll-only เป็น
push-driven

**Test:** `node --test` → 272/272 เขียว (ไม่แตะ schema/behavior เดิมของ notifications table — การสร้างกระทู้ +
เพิ่ม participant ยังแจ้งกระดิ่งเหมือนเดิมทุกอย่าง)

**Verify:** ตั้ง server แยก + เปิด Playwright 2 session พร้อมกัน (ผู้สร้างกระทู้ + ผู้ร่วมสนทนา) — ผู้สร้างตอบกลับ
ข้อความจาก session หนึ่ง แล้วยืนยันว่า badge ใน sidebar ของอีก session อัปเดตภายใน 2 วินาทีโดยไม่ reload หน้าเลย
(จากเดิมต้องรอนานสุด 30 วิ) — commit `4579120`

---

**คำขอ (รอบที่ 22):** user ถามต่อเนื่องจากบทสนทนาเรื่อง R2 backup (นอก session round ที่เป็นโค้ด) ว่า "ลดขนาดของ
วีดีโอที่อัพโหลดได้ไหม" (Issue Talk เป็นจุดเดียวในระบบที่รับไฟล์วีดีโอ) — **ถาม `AskUserQuestion`** ก่อนเพราะการ
บีบอัดวีดีโอจริงต้องมี `ffmpeg` binary ซึ่งระบบยังไม่มี ต้องเพิ่มเข้า Docker image (กระทบขนาด image + เวลา
build/deploy) — user ยืนยัน **"โอเค เพิ่ม ffmpeg เข้า Docker image"**

**การแก้:**
- เพิ่ม `ffmpeg` เข้า `Dockerfile`'s runtime stage `apt-get install` (อยู่แถวเดียวกับ `chromium` ที่มีอยู่แล้วสำหรับ
  PDF export)
- เพิ่ม `fluent-ffmpeg@2.1.3` เป็น server dependency ใหม่ (มี npm deprecation notice แต่ยังเป็น wrapper มาตรฐานที่
  ใช้กันแพร่หลายที่สุดสำหรับเรียก ffmpeg CLI จาก Node — `npm audit` ยืนยัน 0 vulnerability ที่มาจาก dependency
  tree ของตัวมันเอง)
- สร้าง `compressVideo` middleware ใหม่ใน `middleware/upload.js` (pattern เดียวกับ `compressImages` เป๊ะ): รันหลัง
  `verifyMagic`, บีบอัดเฉพาะ mp4 (libx264/aac) และ webm (libvpx-vp9/opus) — ข้าม avi (container เก่า/หายาก ไม่คุ้ม
  ต้อง maintain encode profile เพิ่มอันที่ 3) — ย่อความละเอียดสูงสุด 1280px ด้านยาว (ไม่ขยายถ้าเล็กกว่าอยู่แล้ว) ใช้
  ไฟล์บีบอัดก็ต่อเมื่อเล็กกว่าต้นฉบับจริง (เก็บต้นฉบับถ้าบีบแล้วใหญ่ขึ้น) — ต่างจาก `compressImages` ตรงที่ประมวลผล
  ทีละไฟล์ (ไม่ `Promise.all`) เพราะ ffmpeg transcode กิน CPU/RAM หนักกว่า sharp resize มาก และ Issue Talk
  อนุญาตแนบได้ถึง 10 ไฟล์/ข้อความ
- เช็คว่ามี `ffmpeg` binary จริงบนเครื่องแค่ครั้งเดียวตอน module load (`execFileSync('ffmpeg',['-version'])`) —
  ถ้าไม่มี (เช่นเครื่อง dev ที่ไม่ได้ลง) จะ skip เงียบๆ ไม่ crash upload เลย เหมือน `compressImages`'s
  `if (!sharp) return next()`
- ผูกเข้า route ทั้ง 2 จุดที่ใช้ `uploads.issueTalk` (`POST /` สร้างกระทู้ + `POST /:id/messages` ตอบกลับ) ต่อจาก
  `compressImages` เดิม

**Test:** `node --test` → 272/272 เขียว (ไม่มี test เดิมที่ต้องแก้ — เป็น middleware ใหม่ ไม่กระทบพฤติกรรมที่มี
test คลุมอยู่)

**Verify:** ทดสอบ 2 ทาง — (1) เครื่อง dev นี้ไม่มี ffmpeg ลงจริง ยืนยัน `compressVideo` detect แล้ว skip เงียบๆ
เรียก `next()` ทันทีไม่แตะไฟล์เลย (พิสูจน์ path ปลอดภัยเวลาไม่มี binary) (2) รัน `transcodeVideo` logic จริงใน
container `node:22-bookworm-slim` ชั่วคราว (image ฐานเดียวกับ Dockerfile production) ที่ลง ffmpeg แล้ว สร้างวีดีโอ
ทดสอบสังเคราะห์ 1920x1080 5 วินาที แล้วบีบอัดจริง: 302,963 bytes → 113,974 bytes (เล็กลง 62%) ยืนยัน command
ที่เขียนไว้ใช้งานได้จริง ไม่ใช่แค่ผ่าน syntax check — commit `9f9937c`

---

## 2026-07-13 | Session 125 — Purchasing/Supplier Management + Dashboards (Supplier Assignment, Purchasing Dashboard, Manager Dashboard, Notification fixes)

**คำขอ:** ปรับปรุงระบบ Purchasing/Supplier Management/Dashboard ให้ครบวงจร — (1) Purchasing/Purchasing Manager
จัดการ Supplier เองได้ (2) Purchasing Dashboard ที่ scope ตาม Supplier ที่รับผิดชอบ (3) Purchasing Manager
Dashboard เห็นภาพรวมทีม + drill-down รายคน (4) Supplier Assignment (5) Permission ผูก RBAC เดิม (6)
Notification ผูก Supplier Assignment (7) DB migration ปลอดภัย (8) Performance/aggregate query (9) UI ตาม
theme เดิม (10) วิเคราะห์ architecture ก่อนเขียนโค้ด + phased delivery พร้อม commit แยกแต่ละ phase

**สิ่งที่พบก่อนเริ่ม (สำคัญ):** repo มีงานค้าง **uncommitted จากเซสชันก่อนหน้าที่ไม่เคยถูกบันทึกใน DEVLOG** — ทำ
`supplier_purchasing_assignees` (m:n, ดีกว่าที่คำขอระบุที่เป็น single-assignee), role `purchasing_manager`,
`lib/purchasingScope.js` (scope helper) และ wiring เข้า NCR/UAI/Delivery ไว้แล้วบางส่วนพร้อม test 18 เคส —
ตรวจสอบแล้วของดีและถูกต้อง จึงต่อยอดจากของเดิมแทนที่จะเขียนใหม่ตาม schema ที่คำขอระบุเป๊ะๆ (ยืนยันกับ user แล้ว)

**Phase 1 — Supplier CRUD permission:** `master.js` เปิด POST/PATCH/toggle suppliers ให้
`purchasing`/`purchasing_manager` (export/import/approval-status ยังคง adminOnly — นอกขอบเขตคำขอ) +
`App.jsx` แยก gate ต่อ child route ใต้ `/master` (เฉพาะ suppliers เปิด, Products/Units/ฯลฯ ยังคง admin-only) +
`rolePermissions.js` เปิด nav group + เพิ่ม endpoint `GET /master/purchasing-users` (id/full_name เท่านั้น)
แทนการเปิด `/admin/users` เต็ม (กัน purchasing เห็นข้อมูล user อื่นทั้งระบบ)

**Phase 2 — Purchasing Dashboard backend:** `services/purchasingDashboardService.js` — `GET
/api/purchasing/dashboard/{summary,suppliers,ncrs}` server-aggregate ทั้งหมด (ไม่แตะ `/api/dashboard/stats`
เดิม), bucket mapping จาก NCR status เดิม (ไม่มี status/column ใหม่ยกเว้น `overdue_notified_at` ใน S125 ช่วงหลัง)

**Phase 3 — Purchasing Dashboard UI:** `PurchasingDash.jsx` — 11 summary card, ตาราง "ผู้ผลิตของฉัน" (ทำหน้าที่
เป็นทั้ง My Suppliers และ Supplier Health เพราะคอลัมน์ที่คำขอเหมือนกันทุกตัว), tab "NCR/NCP ของฉัน" พร้อม filter
ครบ (Supplier/Status/Priority/วันที่/Overdue) — verify ผ่าน Playwright จริง (ไม่ใช่แค่ unit test) กับ server
instance + seed data แยก พบ bug เล็กจากการเขียนโค้ดเอง (checkbox handler ผิด) แก้ก่อน commit

**Phase 4 — Purchasing Manager Dashboard:** เพิ่ม `getTeamSummary/getTeamMembers/getMemberDetail` — "ทีม" = ทุก
user role `purchasing` (ไม่มี hierarchy table แยก), Member KPI (avg closing time/avg supplier response
time/closing rate) จาก column เดิมที่มีอยู่แล้ว (`closed_at`/`link_copied_at`/`supplier_responses.submitted_at`)
`ManagerPurchasingDash.jsx` + `PurchasingMemberDetail.jsx` (route `purchasing/team/:memberId` แบบเดียวกับ
`qc-attendance/employee/:userId`) — verify ผ่าน Playwright จริงอีกครั้ง ตัวเลข KPI ตรงกับที่คำนวณมือทุกตัว

**Phase 5 — Notification verification (พบ gap จริง ไม่ใช่แค่ verify เฉยๆ):** user สั่งตรวจ checklist dashboard
ครบไหม (ตรวจแล้วครบทั้ง 2 dashboard) แล้วให้ไป Phase 5 ต่อ — ตรวจ notification flow ละเอียดพบ 3 gap จริงเทียบกับ
recipient matrix ที่คำขอ (Requirement 6): (1) `purchasing_manager` ไม่เคยถูกแจ้งเตือนเลยสักที่ (2) Supplier ตอบ
กลับ แจ้งแค่ QC Manager ไม่แจ้ง Purchasing Owner (3) ไม่มีกลไกแจ้งเตือน "เกินกำหนด" เลย — แก้ทั้ง 3: เพิ่ม
`getPurchasingManagerIds()` (purchasingScope.js) wire เข้าจุด NCR รอ Review/ปิดแล้ว, เพิ่ม
`resolveNotifyTargetIds` เข้า `supplierService.js`, สร้าง `lib/overdueNotifier.js` (scheduler ทุก 1 ชม. แบบ
เดียวกับ `archiveOldNotifications`) + column ใหม่ `ncrs.overdue_notified_at` (safeAddColumn, กันแจ้งซ้ำ)

**Test:** `node --test` → 256/256 เขียว, 0 skip (เพิ่มจาก 212 baseline S124: +19 pre-existing scope tests
ที่ commit ครั้งแรกใน S125 + 3 permission test + 10 dashboard test + 7 team test + 5 notification test)

**Verify:** ทุก phase verify ผ่านการรันแอปจริง (ไม่ใช่แค่ unit test) — Phase 1 ผ่าน test suite, Phase 3/4 ผ่าน
Playwright ต่อ server instance + seed data แยก (ไม่แตะ dev DB จริง), Phase 5 ผ่าน service-level test ตรง +
boot smoke-test ยืนยัน scheduler ใหม่ไม่ทำให้ server พังตอนบูต

**ปัญหาเฉพาะหน้าที่เจอระหว่างทำ (ไม่เกี่ยวกับโค้ด):** better-sqlite3 native binary ABI mismatch (rebuild ไม่ผ่าน)
เพราะมี process `node bootstrap.js` (PORT=3099) ค้างจากเซสชันก่อนหน้าที่ไม่เคยถูกปิด ถือ handle ไฟล์ .node ไว้ —
ระบุ root cause ผ่าน `Get-Process | Modules` แล้วขอ confirm จาก user ก่อน kill (ไม่ใช่ dev server ของ user เอง)

**ยังไม่ได้ทำ (นอกขอบเขต/รอ Phase 6):** อัปเดต CLAUDE.md §11 Role Matrix ให้มี `purchasing_manager` (คอลัมน์ที่
11), ยังไม่มี Export ปุ่มในหน้า dashboard ใหม่ (Req 9 "Export" อยู่ในหัวข้อ UI ทั่วไป — dashboard นี้ยังไม่มี เพราะ
ไม่ได้อยู่ใน checklist ที่ user ขอตรวจสอบรอบนี้)

---

## 2026-07-10 | Session 124 — Render deploy gap-analysis: เอกสาร R2 backup/restore ที่ตกหล่น + แก้ DB corrupt root cause

**คำขอ:** ผู้ใช้ให้อ่าน `DEPLOY_RENDER.md` ของอีกโปรเจกต์ (BookShelf, เอาไปวางไว้ที่ root เป็นไฟล์อ้างอิงเฉยๆ)
แล้วนำแนวคิดมาออกแบบระบบ deploy Render ของ QMS ใหม่ทั้งหมด (Docker เดียวกันทั้ง local/prod, R2 backup,
restore-on-boot, zero data-loss, DR) — สั่งชัดเจนว่าห้ามแก้โค้ดก่อนสรุปผลวิเคราะห์

**สิ่งที่พบ (ประเด็นหลักของ session นี้):** สถาปัตยกรรมที่ขอเกือบทั้งหมด**มีอยู่แล้วจริงในโค้ด** —
`server/bootstrap.js` + `lib/backupService.js` + `lib/restoreService.js` + `lib/r2Client.js` +
`scripts/backup-db.js`/`restore-from-r2.js` + `DEPLOYMENT.md §8` ครอบคลุม single Dockerfile ทุก
environment, R2 backup ทุก ~10 นาที + daily FIFO, restore-on-boot สำหรับ Render Free, lazy fetch-through
uploads, graceful shutdown + hot backup, health check, fail-fast JWT_SECRET ครบแล้ว — แต่**ไม่เคยถูกบันทึก
ใน DEVLOG เลยสักครั้ง** (สร้างในเซสชันก่อนหน้าที่ไม่ได้ log) ทำให้ `AUDIT.md` (D5) บอกข้อมูลผิดว่ายังไม่มี
auto-backup และ `CLAUDE.md` ไม่มี section อธิบายเรื่องนี้เลย (ต่างจาก Auth Framework งานคู่ขนานที่มี §24)
— นอกจากนี้พบไฟล์ `lib/backupService.js` มีการแก้ไข (เพิ่ม `sendEnvTelegram`/`warnNotConfigured` alert
ตอน R2 ไม่ได้ตั้งค่า) ที่ยังไม่ commit และไม่มี test คลุม

**บัคจริงที่เจอระหว่างตรวจ (ไม่ใช่แค่เอกสาร):** อ่าน Session 119 ย้อนหลังพบว่า DB corrupt ที่กู้คืนตอนนั้น
เกิดซ้ำมาแล้ว 3 ครั้ง (2026-06-25/07-01/07-08) และ entry นั้นสงสัยไว้ (ไม่ยืนยัน) ว่าเป็นเพราะ
"SQLite WAL mode ผ่าน Docker Desktop bind-mount บน Windows" — ตรวจแล้วยืนยันสาเหตุจริง:
`docker-compose.local.yml` เดิม bind-mount `./iqc.db:/data/iqc.db` (ไฟล์เดี่ยวจาก Windows host ตรงเข้า
container) ซึ่ง SQLite WAL ต้องพึ่ง shared-memory mmap (`-shm`/`-wal`) + byte-range lock ที่ Docker
Desktop's Windows↔Linux file-sharing layer ไม่รองรับสมบูรณ์ — ตรงกันข้ามกับ `docker-compose.yml`
production ที่ใช้ named volume (ปลอดภัย, ไม่เคยมีปัญหานี้เลย)

**ถามผู้ใช้ก่อนแก้ (ตามที่สั่งห้ามแก้ก่อนสรุปผล):** confirm 3 เรื่อง — (1) ให้อัปเดตเอกสารที่มีอยู่แล้ว
(CLAUDE.md/DEVLOG.md/AUDIT.md/DEPLOYMENT.md) ไม่ใช่สร้าง README.md/DEPLOY_RENDER.md ใหม่ตามชื่อไฟล์ของ
BookShelf ที่ไม่มีอยู่จริงในโปรเจกต์นี้ (2) คง upload strategy เดิม (local-primary + R2 backup/lazy-restore)
ไม่เปลี่ยนเป็น R2-primary แบบ BookShelf (3) แก้ bind-mount โดยแยก 2 use-case ออกจากกัน — ผู้ใช้ยืนยันทั้ง 3
ข้อตามที่แนะนำ

**การแก้ (หลัง confirm แล้ว):**
- `docker-compose.local.yml` — เปลี่ยนจาก bind-mount ไฟล์ `./iqc.db`/`./uploads` เป็น **named volume**
  (`iqc_local_data`/`iqc_local_uploads`) — compose นี้เปลี่ยนวัตถุประสงค์เป็น "ตรวจ Docker image ก่อน
  deploy" (DB แยก/seed ใหม่ทุกครั้ง) ไม่ใช่ DB dev จริงอีกต่อไป — แก้ comment header + `run-local.ps1`
  ให้สื่อสารชัดเจน
- `client/vite.config.js` — เพิ่ม `server.host: true` — เปิดทางให้ `npm run dev` (native, ไม่ใช้ Docker)
  เข้าถึงได้จากมือถือ WiFi เดียวกัน (Express bind 0.0.0.0 อยู่แล้วโดย default) ใช้ข้อมูล dev จริงบน
  Windows filesystem ตรงๆ ไม่มีความเสี่ยง WAL/bind-mount เลย — นี่คือทางแก้แทนการใช้ Docker สำหรับ
  phone-testing (ของเดิมที่ `docker-compose.local.yml` เคยทำ)
- `lib/backupService.js` — commit การแก้ที่ค้างไว้ (`sendEnvTelegram`/`warnNotConfigured`) + export
  `sendEnvTelegram` เพิ่มเพื่อ unit test ได้ตรงๆ
- `test/backupService.test.js` — เพิ่ม 5 test ใหม่ (BACKUP-11..15): `sendEnvTelegram` ครบ 3 เคส (ไม่ตั้ง
  env → false ไม่ยิง network, ตั้งครบ → เรียก Telegram API ถูก payload, fetch ล้มเหลว → ไม่ throw) mock
  `node-fetch` ผ่าน `require.cache` (node-fetch@2 เป็น CJS ธรรมดา) กันยิง network จริง + ปิดช่องว่างเดิมที่
  `runDailyFifoBackup`/`syncUploads` ไม่เคยมี test เคส "R2 ไม่ได้ตั้งค่า → no-op" (มีแต่ `runHotBackup`)
- `AUDIT.md` D5 — แก้ finding ที่ผิด (บอกว่ายังไม่มี auto-backup) ให้ตรงกับโค้ดจริง เหลือ gap จริงแค่
  restore-drill ยังไม่ automate ใน CI
- `CLAUDE.md` — เพิ่ม **§27** (Deploy/Backup/Restore) สรุปสถาปัตยกรรม, boot sequence, เหตุผลที่ไม่ใช้
  Litestream, และกฎห้าม bind-mount ไฟล์ SQLite เดี่ยวจาก Windows host เข้า container อีก

**Test:** `npm test` → 212/212 เขียว (207 เดิม + 5 ใหม่), 0 fail, 0 skip

**Verify:** อ่าน `docker-compose.yml` (production) ยืนยันไม่ถูกแตะเลย — ยังเป็น named volume เดิมทั้งหมด

**ยังไม่ได้ทำ (นอกขอบเขต/รอ user):** restore-drill อัตโนมัติใน CI (ปัจจุบันกู้จริงทดสอบผ่าน
`scripts/restore-from-r2.js` แบบ manual + unit test เท่านั้น) — บันทึกไว้เป็น gap ที่เหลือใน AUDIT.md D5

---

## 2026-07-08 | Session 123 — แก้ Sidebar: submenu ไม่หุบกัน + กลุ่มผิดเปิดตามกัน

**คำขอ:** (1) คลิกหัวข้อ sidebar แล้ว submenu เลื่อนลง แต่คลิกหัวข้ออื่นแล้ว submenu แรกไม่หุบ (2) คลิก
"ของเสียวัตถุดิบ" แล้วหัวข้อ "QC หน้างาน" เปิดตามไปด้วยทั้งที่ไม่เกี่ยวกัน

**Root cause ข้อ 2 (สำคัญกว่า):** `rolePermissions.js` มี path ซ้อนกันข้ามกลุ่ม — กลุ่ม `/production-qc` มี child
`/fg-production` (ตั้ง `end:true` ไว้แล้วสำหรับ NavLink ของตัวเอง กัน active ค้างตอนอยู่หน้าลูก) แต่กลุ่ม `/iqc` มี
child `/fg-production/material-defects` ("ของเสียวัตถุดิบ") — `Sidebar.jsx` เช็คว่า group ไหนควร auto-expand
ด้วย `location.pathname.startsWith(child.path)` ตรงๆ โดย**ไม่เคารพ `end` flag เลย** ทำให้ตอนอยู่หน้า
`/fg-production/material-defects`, เช็คกับ `/production-qc`'s child `/fg-production` แล้ว
`'/fg-production/material-defects'.startsWith('/fg-production')` = true (ผิด!) — กลุ่ม production-qc เลยเปิด
ตามไปด้วยทั้งที่ path จริงเป็นของกลุ่ม iqc

**แก้:**
- เพิ่ม `matchesChild(pathname, child)` ใน `rolePermissions.js` (export ใช้ร่วมกัน): ถ้า `child.end` ต้อง match
  ตรงเป๊ะ (`pathname === child.path`) เหมือนที่ `NavLink`'s `end` prop ทำอยู่แล้ว ไม่ใช่ prefix เฉยๆ
- `Sidebar.jsx`: แทน `location.pathname.startsWith(c.path)` ทั้ง 3 จุด (auto-expand เริ่มต้น, useEffect sync ตอน
  เปลี่ยนหน้า, group header active state) ด้วย `matchesChild`
- `BottomNav.jsx`: มี collision เดียวกันแบบ cosmetic (tab highlight ผิด, bottom-sheet child highlight ผิด) —
  แก้ 2 จุดด้วย `matchesChild` เช่นกัน (สถาปัตยกรรม BottomNav ใช้ `useState(null)` เดี่ยวอยู่แล้วเลยไม่มีปัญหา
  "เปิดพร้อมกันหลายกลุ่ม" แบบ Sidebar)
- `toggleGroup()` ใน `Sidebar.jsx`: เปลี่ยนจาก toggle ทีละกลุ่มอิสระ (Set ที่เพิ่ม/ลบเฉพาะ path ที่คลิก ไม่แตะ
  path อื่น) เป็น **accordion แท้** — คลิกกลุ่มที่ปิดอยู่ = เปิดกลุ่มนั้นกลุ่มเดียว (ปิดกลุ่มอื่นทั้งหมด), คลิกกลุ่ม
  ที่เปิดอยู่ซ้ำ = ปิด — แก้ทั้ง initial state และ `useEffect` (sync ตอนเปลี่ยนหน้า) ให้ replace ทั้ง Set แทนที่จะ
  add เข้าไปเรื่อยๆ

**Verify:** `npm run build` ผ่าน — ยังไม่ได้ verify การคลิกจริงในเบราว์เซอร์ (ข้อจำกัดเดิม ไม่มี screenshot tool
ใน session, dev-server launch ยังโดน auto-mode classifier บล็อกจาก session ก่อนๆ)

---

## 2026-07-08 | Session 122 — Table redesign (แบรนด์) + แก้ dark mode contrast ที่ user feedback ว่าดูยากขึ้น

**คำขอ:** (1) user ส่ง reference image (ตารางพนักงานสีแดง/ส้ม/เหลือง) ขอปรับรูปแบบตารางทั้ง project ให้ดูง่าย/สวย
ใกล้เคียงภาพตัวอย่าง **แต่เข้ากับธีมบริษัท** (navy/blue ตาม CLAUDE.md §9 ไม่ใช่สีในภาพตรงๆ) (2) ทดสอบ dark mode
จาก Session 121 แล้ว "สีดูยากกว่าเดิม" — ต้อง regression-fix

**Root cause ของ dark mode contrast แย่ลง (Session 121):** codemod เดิมใช้ dark background แบบ**โปร่งแสง**
(เช่น `dark:bg-red-950/40`) วางทับพื้นหลังหน้าเว็บที่เป็นสีเข้มอยู่แล้ว (`--color-bg` โหมดมืด = navy เข้มมาก) — สี
โปร่งแสงเข้ม 2 ชั้นผสมกันกลายเป็นเกือบดำ ทำให้ contrast กับตัวอักษร (300/400) ต่ำกว่าที่ตั้งใจ — เป็นความเสี่ยงที่รู้
อยู่แล้วตอนออกแบบ (ไม่มีเครื่องมือ screenshot ตรวจสอบภาพจริงได้ใน session ก่อนหน้า) แต่ไม่ได้คาดว่าจะแย่ขนาดนี้จน
user feedback ว่า "ยากกว่าเดิม"

**แก้ (Session 122):** เขียน fix-up codemod ตัวที่ 2 (ทับของเดิม) เปลี่ยน dark badge/alert ทั้งหมดจาก
โปร่งแสง→**solid เต็มที่เสมอ** (`dark:bg-X-950/40`→`dark:bg-X-900`, `dark:bg-X-900/60`→`dark:bg-X-800` ฯลฯ ไม่มี
`/NN` opacity อีกต่อไป) + เลื่อน text ให้สว่างขึ้นอีกขั้น (`dark:text-X-300/400`→`dark:text-X-200` เดียวหมด) —
solid + สว่างขึ้น = contrast แน่นอนไม่ขึ้นกับพื้นหลังใต้มัน (**1180 classes ทั่ว 51 ไฟล์**) ปรับ mapping table ใน
CLAUDE.md §25.3 ให้ตรงของจริงด้วย

**Table redesign (§26 ใหม่):** แก้ shared class ใน `index.css` เท่านั้น (`.table`/`.table-container`/`.card`) —
เพราะ `<table className="table">` ใน `<div className="table-container">` ใช้ร่วมกัน **32 ไฟล์** แก้จุดเดียว
กระจายอัตโนมัติ:
- `.table-container`: เพิ่มมุมโค้ง+กรอบ+เงา (`sm:rounded-xl sm:border sm:shadow-sm`) ให้ดูเป็น panel เดียวกับตาราง
- `.table th`: จาก `bg-bg text-muted` (จมกับพื้นในโหมดมืด) → ลอง `bg-gradient-to-r from-primary to-accent
  text-white` ก่อน แต่ user feedback ว่า "หัวตารางไม่สวย" — root cause: `.table th` apply กับ `<th>` แต่ละ cell
  แยกกัน ไม่ใช่ทั้งแถวเดียว ทำให้แต่ละคอลัมน์วาด gradient เต็มของตัวเอง กลายเป็นแถบไล่สีซ้ำเรียงกันทีละคอลัมน์
  (ลายๆ) — เปลี่ยนเป็นสีทึบ (solid) `bg-primary text-white` ก่อน แล้ว user feedback รอบสองขอ "สีฟ้าอ่อนๆ" +
  "ขีดเล็กๆ คั่นระหว่างหัวข้อ" → เพิ่มเป็น `bg-blue-50 text-blue-900` (dark: `bg-blue-900 text-blue-200`) +
  `border-r border-blue-200 dark:border-blue-800 last:border-r-0` แล้ว user feedback รอบสามขอเอาเส้นคั่นออก →
  **ค่าสุดท้าย: สีฟ้าอ่อนเหมือนเดิม แต่ไม่มี `border-r` แล้ว** — แก้ `SortTh.jsx` (hover เปลี่ยนเป็น
  `hover:bg-black/5 dark:hover:bg-white/10`, ไอคอนลูกศร sort ใช้ `currentColor` สืบจาก `.table th` + toggle
  `opacity-100/40` แทน hardcode สีขาว กันต้องแก้ 2 ที่ทุกครั้งที่เปลี่ยนสี header อีก)
- `.table td`: เพิ่ม padding ให้โปร่งขึ้น; `.table tbody tr`: hover นุ่มนวลขึ้น (`accent/5` แทน flat `bg-bg`)
- ตรวจแล้วว่า specificity ของ `.table th` (compound selector) จะ override utility class เดี่ยวบน `<th>` ที่หน้า
  อื่นเคยพยายาม custom สี/align เอง (`IPNCRList.jsx`/`IPQCList.jsx`) — ผลลัพธ์ตรงกับ design ใหม่พอดี (ไม่ใช่ bug)
  ตารางที่ไม่ได้ใช้ class `"table"` เอง (`ProCodeSap.jsx`, `KPI/index.jsx`) ไม่กระทบ
- **ยังไม่ทำ**: pill-badge สำหรับคอลัมน์ ID และสีเขียวตัวเลขเงินตามภาพตัวอย่าง — content-specific ต้องทำทีละหน้า
  (แจ้ง user แล้วว่านอกขอบเขต shared-class รอบนี้)

**Verify:** `npm run build` ผ่าน 3 รอบ (table redesign / contrast fix-up / cleanup), grep หา `dark:dark:` และ
opacity ค้างบน dark badge = 0 ทั้งคู่ — **ยังไม่ได้ verify ภาพจริงในเบราว์เซอร์อีกครั้ง** (เครื่องมือ run/dev-server
ถูก auto-mode classifier บล็อกต่อเนื่องจาก session ก่อน ไม่ได้พยายามซ้ำ) — ต้องให้ user ตรวจตาก่อนถือว่าปิดงานจริง

---

## 2026-07-08 | Session 121 — App-wide Dark Mode (Light/Dark/Auto ต่อ user)

**คำขอ:** "ช่วยสร้าง dark mode และสามารถปรับให้ตั้งเป็น auto ตามเวลาที่ใช้ได้ด้วย" — ยืนยันขอบเขตกับ user ก่อนเริ่ม
(ระบบไม่มี dark-mode infra เลย, สี hardcode hex ทั้ง 51+ หน้า): **(1)** ทำครบทั้งระบบ (ไม่ใช่แค่ token หลัก)
**(2)** ควบคุมแบบ personal ต่อ user เอง (ไม่ผูก backend/login) **(3)** Auto = ตามช่วงเวลานาฬิกา (ไม่ใช่ OS
`prefers-color-scheme`)

**สถาปัตยกรรม:**
- `tailwind.config.js`: เพิ่ม `darkMode: 'class'` + ผูก 10 semantic token เดิม (primary/accent/bg/surface/
  border/text/muted/success/danger/warning) เป็น `rgb(var(--color-x) / <alpha-value>)` แทน hex ตรงๆ
- `index.css`: นิยาม `--color-*` ใน `:root` (light) + `.dark` (dark, ปรับให้ตรงกับ dash-bg/dash-card/
  dash-border/dash-text เดิมของ operational dashboard เพื่อความสอดคล้องของแบรนด์) — แก้ `.btn-secondary`
  (`bg-white`→`bg-surface`) และ `.glass-card` (เพิ่ม `dark:bg-surface/95 dark:border-border`) ด้วย
- `contexts/ThemeContext.jsx` (ใหม่): `preference` (`light`/`dark`/`auto`) เก็บ `localStorage` ล้วน ไม่มี
  backend endpoint ใดๆ — auto mode เช็คชั่วโมงปัจจุบันเทียบ default 18:00–06:00 (ปรับได้ผ่าน `setAutoHours`)
  ทุก 1 นาทีกันเปิดหน้าค้างข้ามช่วงเวลา — apply `.dark` class ผ่าน `useLayoutEffect` (ไม่ใช่ `useEffect`) กันจอกระพริบ
- `index.html`: เพิ่ม inline script sync logic เดียวกับ ThemeContext ให้ apply `.dark` **ก่อน** CSS/JS bundle
  โหลด กัน flash-of-wrong-theme ตอนโหลดหน้าแรก
- `components/UI/ThemeToggle.jsx` (ใหม่) + wire เข้า `AppLayout.jsx` header (ข้าง bell icon)

**ขอบเขตที่ตัดออก (ตกลงกับ user แล้ว):** `pages/Dashboard/*.jsx` (8 ไฟล์ตาม role + `shared.jsx`) ใช้ `D` token
object เดิมที่ **มืดถาวรอยู่แล้ว** ตาม brand.md §13.2 (ออกแบบมาเพื่อ contrast งาน operational) — ไม่แตะ ไม่ผูกกับ
toggle ใหม่นี้เลย (ทั้งทางเทคนิคก็ไม่ได้ใช้ Tailwind token เดียวกัน เป็น inline style object แยกต่างหาก)

**Codemod สำหรับ raw Tailwind color utility:** grep เจอ raw palette class (`bg-red-50`, `text-purple-700` ฯลฯ)
มากกว่า 900 จุด/150 combination กระจายทั่ว 51 ไฟล์ (badge สี role, alert box, status chip) — เขียน codemod script
(`node`, regex-based) ใส่ `dark:` variant คู่กันตาม shade-mapping table (`bg-X-50/100`→`dark:bg-X-950/40-50`,
`border-X-100..400`→`dark:border-X-800/50..600`, `text-X-500..900`→`dark:text-X-400/300`; shade 500-800 ของ
`bg-`/`ring-` ไม่ต้องมี dark: variant เพราะ contrast พอทั้ง 2 theme อยู่แล้ว) — dry-run บนไฟล์เดียวก่อนตรวจสอบ
mapping ถูกต้อง แล้วรันจริงทั้ง repo (excluding `pages/Dashboard/`) → **51 ไฟล์เปลี่ยน, 1177 `dark:` variant ใหม่**

**Manual follow-up หลัง codemod:** เจอไฟล์ที่ hardcode hex ตรงๆ ใน className (ไม่ใช่ raw palette class ที่
codemod จับได้) — `FNCPResponse.jsx` (public token page) ใช้ `text-[#1F2937]`/`bg-[#F5F6F8]`/`text-[#6B7280]`/
`bg-[#1A3A5C]` ตรงๆ 42 จุด แก้เป็น semantic token (`text-text`/`bg-bg`/`text-muted`/`bg-primary`) แทน (ได้ dark
mode ฟรีเป็นผลพลอยได้); `ProCodeSap.jsx` confidence badge ใช้ hex ตรงกับ success/warning/danger token พอดี
แก้เป็น token; แก้ `bg-white` แข็งๆ (ไม่ใช่ semantic token) เป็น `bg-surface` ใน 7 ไฟล์ (Holidays/FNCPList/
FNCPResponse/Delivery/Colors/NCR-Detail/IPQCNew) — เว้น toggle-switch thumb 2 จุดที่ตั้งใจให้ขาวตรงๆ ตลอด (ToggleSwitch.jsx/ProCodeSap.jsx บรรทัด 243)

**Verify:** `npm run build` ผ่าน 2 รอบ (ก่อน/หลัง manual follow-up) ไม่มี error, ตรวจ `dark:dark:` ซ้ำซ้อน = 0,
grep หา raw hex/`bg-white` ที่เหลือ = 0 (ยกเว้นที่ตั้งใจ) — **ไม่ได้ทดสอบ visual/pixel จริงในเบราว์เซอร์** (ไม่มี
เครื่องมือ screenshot ในเซสชันนี้ และ auto-mode classifier บล็อกการรัน dev server เอง — ต้องให้ user ตรวจตาด้วยตัวเองก่อนถือว่าปิดงาน)

---

## 2026-07-08 | Session 120 — Users.jsx: AD เป็น on/off toggle ต่อ user + ปุ่ม "Internal AP System" บังคับเช็ค AD ตรงๆ

**คำขอ:** ผู้ใช้เข้าถึงหน้า Login ใหม่ (S118) แล้วถามว่ากดปุ่ม "Internal AP System" ตอนนี้ใช้รหัสผ่าน AD หรือ local —
คำตอบตอนนั้นคือ "ไม่ต่างกันเลย" (ปุ่มทั้งสอง alias กัน 100%, provider เลือกจาก account เท่านั้น) ผู้ใช้เลือกให้เปลี่ยน
เป็น: ปุ่มนี้ต้อง **บังคับเช็คกับ AD Gateway โดยตรง ข้าม local cache เสมอ** (ต่างจาก flow ปกติที่ cache-first)
พร้อมกันนี้ปรับหน้า "จัดการผู้ใช้งาน" จาก dropdown Local/AD (exclusive) เป็น toggle เปิด/ปิด AD ต่อ user (local ใช้ได้
เสมออยู่แล้วเป็น baseline)

**Backend (`services/authService.js`):** เพิ่ม param `forceAdGateway` ใน `login()` — เมื่อ true:
- ต้องเป็น account ที่ `auth_provider='ad'` เท่านั้น ไม่งั้น 400 "บัญชีนี้ยังไม่ได้เปิดใช้งาน Active Directory"
  (ไม่ silently fallback ไป local เหมือน flow ปกติ — ผู้ใช้กดปุ่มนี้ตั้งใจจะเช็คกับ AD จริงๆ)
- ต้อง `auth_mode='hybrid' && ad_enabled` ทั้งระบบด้วย ไม่งั้น 503
- เรียก `adProvider.authenticate({ user, password, skipCache: true })` ตรงๆ (ข้าม `resolveProvider()`) —
  `adProvider.js` เพิ่ม param `skipCache` ข้าม Local Pass Bypass (บรรทัด `if (!skipCache && ...)`)
- ยัง self-heal cache ตามปกติเมื่อ AD ตอบสำเร็จ (แค่ข้ามการ "เช็ค" cache ก่อน ไม่ได้ข้ามการ "sync" หลังสำเร็จ)

**Frontend:**
- `Login.jsx`: ปุ่ม "Internal AP System" ส่ง `{ forceAdGateway: true }` ไปกับ login(); ปุ่มหลักยังเป็น flow ปกติ
  (`AuthContext.jsx`'s `login(username, password, opts)` เพิ่ม opts param ส่งต่อเข้า POST body)
- `Admin/Users.jsx`: เปลี่ยน `<select>` "วิธีเข้าสู่ระบบ" เป็น `<ToggleSwitch>` "เข้าสู่ระบบด้วย Active Directory" —
  ไม่มี option ให้เลือก "local เท่านั้น" เพราะ local ใช้ได้เสมอเป็นค่าเริ่มต้นอยู่แล้ว (DB column `auth_provider`
  เดิมไม่ต้องแก้ ยังเป็น `'local'|'ad'` string เหมือนเดิม แค่เปลี่ยน UI representation)

**Test:** เพิ่ม 4 tests ใหม่ (AUTH-23 ถึง 26, รวม 190 tests ทั้งระบบ, 0 fail) — ที่สำคัญสุดคือ AUTH-25 ที่พิสูจน์ด้วย
mock counter ว่า `skipCache` ทำงานจริง (ใช้รหัสผ่านที่ตรงกับ cache เป๊ะ แต่ mock ให้ AD Gateway reject แล้วยืนยันว่า
login ต้อง fail — ถ้า skipCache ไม่ทำงานจริง test นี้จะพังเพราะ cache จะ match ผ่านไปโดยไม่ยิง gateway เลย)

**Verify:** `npm test` (190/190) · frontend `npm run build` ผ่าน

---

## 2026-07-08 | Session 119 — กู้คืน `iqc.db` corrupt ที่ทำให้ container `iqc-local` crash-loop (connection refused)

**คำขอ:** ผู้ใช้แจ้งว่าเปิด `http://192.168.12.196:3001` แล้วขึ้น "refused to connect"

**Root cause:** `iqc-system/iqc.db` (ไฟล์เดียวกับที่ bind-mount เข้า container `iqc-local` เป็น `/data/iqc.db`) มี
SQLite corruption จริง (pre-existing — เจอ warning เดียวกันนี้ตั้งแต่ครั้งแรกที่แตะไฟล์ในเซสชันนี้ ก่อนเริ่มงาน
auth ด้วยซ้ำ, และมีหลักฐานว่าเคยเกิดมาก่อนแล้ว — เจอ `iqc.db.corrupt.bak` + `recovered_20260701*.db` ใน
`backups/` จากรอบก่อนหน้า 2026-06-25→07-01) — container รัน `NODE_ENV=production` ทำให้ integrity check เดิม
(non-fatal ใน dev) กลายเป็น fatal (`throw e`) ทุกครั้งที่ boot → crash-loop วนไม่รู้จบ ไม่เคย bind port 3001 ได้เลย
(ไม่เกี่ยวกับงาน Authentication Framework ที่ทำใน S118 — เป็นแค่ ALTER TABLE/CREATE TABLE เดิมที่ไม่กระทบ)

**กู้คืน (non-destructive จนถึงขั้นตอนสุดท้าย):**
1. `sqlite3 iqc.db ".dump"` → ไม่มี error เลยตอน export (สัญญาณดี — corruption ไม่รุนแรงถึงขั้น row อ่านไม่ได้)
2. reload dump เข้าไฟล์ใหม่ → เจอ error เฉพาะ `notifications` table (duplicate id จาก page ที่ถูกอ้างอิงซ้ำ) รอด
   ทุก table ธุรกิจหลัก (users/bills/ncrs/uai_documents/audit_logs/settings) — `PRAGMA integrity_check` = `ok`
3. Cross-check กับ `.recover` (อีก method หนึ่ง, page-level salvage) แยกกัน — row count ตรงกันทุกตารางเป๊ะ
   (พิสูจน์ว่าตัวเลขที่ได้คือข้อมูลจริงที่ deduplicate แล้ว ไม่ใช่ recovery ที่ทำข้อมูลหาย — ตัวเลขที่เคยอ่านได้สูงกว่า
   จากไฟล์ corrupt ตรงๆ เช่น ncrs 15 แถว เป็น double-count จาก "2nd reference to page" ไม่ใช่ข้อมูลจริง)
4. **หยุดถาม user ก่อนสลับไฟล์จริง** (เป็นระบบ shared/production ทั้งบริษัท ต้องได้รับอนุญาตก่อน) — ผู้ใช้ยืนยันให้สลับ
5. หยุด container → backup ไฟล์ corrupt เดิมเป็น `iqc.db.corrupt_2026-07-08_181917.bak` → สลับไฟล์กู้คืนเข้าแทน
   (ลบ `-wal`/`-shm` เก่าทิ้งด้วย กัน stale journal ค้าง) → start container ใหม่ → `healthy`, `curl` คืน `HTTP 200`

**ข้อมูลที่เสีย:** เฉพาะ notification บางรายการ (ui bell/toast แจ้งเตือน — ไม่ใช่เอกสารธุรกิจ, regenerate ได้) —
ธุรกิจหลักทั้งหมด (23 users, 16 bills, 10 ncrs, 4 uai_documents, 2644 audit_logs, 42 settings) ไม่เสียเลย

**ยังไม่ได้ทำ (แจ้ง user แล้ว):** สืบสาเหตุว่าทำไม corrupt ซ้ำเป็นครั้งที่ 2 (2026-06-25 → 07-01 → 07-08) — สงสัยว่า
เป็น SQLite WAL mode ผ่าน Docker Desktop bind-mount บน Windows ที่ file-locking ระหว่าง host/container ไม่ประสาน
กันสมบูรณ์ — ยังไม่ได้ตรวจสอบเชิงลึก รอ user ตัดสินใจว่าจะให้ทำต่อหรือไม่

---

## 2026-07-08 | Session 118 — Authentication Provider Framework (Local + Active Directory, pluggable)

**คำขอ:** ฝ่าย IT ส่ง `ADAuthen.md` (root) มาให้เชื่อม login เข้ากับ AD Gateway ภายใน — ขอออกแบบเป็น Enterprise
Authentication Framework แบบ Strategy Pattern (รองรับ Local/AD วันนี้, เปิดช่อง LDAP/Azure AD/OAuth อนาคต),
ห้าม hardcode endpoint/secret ทั้งหมดต้องตั้งค่าผ่านหน้า Admin > ตั้งค่าระบบ, ไม่กระทบ local login เดิม
**ผู้ใช้ยืนยันกฎเหล็กเพิ่ม:** AD ต้องเป็นระบบเสริมเท่านั้น — พนักงานไม่มี AD ต้อง login local ได้ปกติเสมอ

**Analysis gap สำคัญ:** `ADAuthen.md` ไม่มีตัวอย่าง response body จาก AD Gateway เลย (ทั้ง success/fail) — สมมติ
schema แบบ isolate ไว้จุดเดียว (`adResponseParser.js`) ตามที่ user ตัดสินใจ ("สมมติไปก่อน แก้ทีหลัง")

**Architecture:**
- Provider Strategy: `services/auth/{localProvider,adProvider,resolveProvider}.js` — resolveProvider บังคับ
  กฎเหล็ก: `auth_provider='local'` → localProvider เสมอ ไม่ว่า `auth_mode`/`ad_enabled` จะเป็นอะไร; ตัด "Active
  Directory (strict, deny local user)" ตาม ADAuthen.md §4.1 ออกจาก behavior จริง (โชว์ disabled ใน UI เท่านั้น)
  เหลือ mode ที่ทำงานจริงแค่ `local`/`hybrid`
- `services/authService.js` ทำหน้าที่ orchestration แทน logic เดิมใน `routes/auth.js` — คง contract
  request/response เดิมทุกจุด (BUG-001/002/003 เดิมยังอยู่ครบ), เพิ่ม persistent account lockout
  (`users.failed_login_count`/`locked_until`, configurable ผ่าน settings) คู่กับ `express-rate-limit` เดิม —
  แยก "lockoutExempt" (AD unreachable/timestamp expired) ออกจาก "รหัสผ่านผิดจริง" ไม่ให้ infra ที่ล่มไปนับเป็น
  ความผิดของ user
- `lib/adGatewayClient.js` — timestamp ไทย +7 ปิดท้าย `Z` ไม่มี ms (ใช้ `Intl.DateTimeFormat` timeZone
  Asia/Bangkok ไม่พึ่ง `process.env.TZ`), timeout จริงผ่าน AbortController, **retry เฉพาะ network-level error
  เท่านั้น ไม่ retry ตอนถูก reject จริง** (กันเร่ง lockout ของ AD จริงฝั่ง Windows — ระบุเป็นความเสี่ยงเด่นจาก
  field "Retry" ที่ IT ขอ)
- `lib/secretsCrypto.js` — AES-256-GCM เข้ารหัส secret ใน `settings` table (`ad_secret_key`), master key จาก
  env var ใหม่ `SETTINGS_ENCRYPTION_KEY` (ไม่ fail-fast ตอน boot ต่างจาก `JWT_SECRET` เพราะ AD เป็น feature
  เสริม ระบบเดิมต้อง boot ได้ปกติแม้ไม่ได้ตั้งค่านี้)
- Environment preset (`environment_presets` table + `environmentService.js`) — ไม่ใช่ตารางที่ runtime query
  ตรงๆ เป็นแค่ "ปุ่มจำค่า/Apply แล้ว copy เข้า settings จริง" กัน 2 source of truth

**DB:** เพิ่ม `users.auth_provider/failed_login_count/locked_until/ad_last_synced_at` (safeAddColumn ไม่ rebuild
CHECK), 26 settings key ใหม่ (General/Authentication/Security/Advanced), ตาราง `environment_presets` ใหม่

**Frontend:** เพิ่ม 5 tab ใน `Admin/Settings.jsx` เดิม (ทั่วไป/Authentication/Environment/Security/Advanced) ตาม
recipe เดิมของ `TelegramTab` เป๊ะ (useQuery/useMutation/secret write-only pattern/Test Connection); เพิ่ม field
"วิธีเข้าสู่ระบบ" (Local/AD) ใน `Admin/Users.jsx` form + badge "AD" ในตาราง — ไม่ต้องเพิ่มเมนูใหม่ (`/admin/settings`
มีอยู่แล้ว); ไม่แตะ `Login.jsx` (ฟอร์ม username/password เดียวใช้ได้ทั้ง 2 provider อยู่แล้วตามที่ต้องการ)

**Scope ตัดออกจากรอบนี้ (ตกลงกับ user ไว้ล่วงหน้า):** Dark Mode (ระบบไม่มี infra เลย, ทำแยกทีหลัง), LDAP/Azure
AD/OAuth (โชว์ disabled ใน UI, ยังไม่ implement), refresh token จริง (toggle มีแต่ inert), TypeScript migration

**Test:** เพิ่ม `test/authService.test.js` (22 tests ใหม่ รวมทั้งหมด 186 tests, 0 fail, 0 skip) ครอบ: local login
regression, กฎเหล็ก local user ไม่ถูกบล็อกแม้เปิด AD ทั้งระบบ, AD cache-hit/cache-miss+gateway-success+self-heal/
gateway-reject/gateway-unreachable, account lockout ทนรอด restart, resolveProvider ทุก branch, secretsCrypto
round-trip, retry-safety (ยืนยันด้วย fake HTTP server จริงว่า callCount=1 ตอนถูก reject แม้ retryCount=2),
formatAdTimestamp ตรงกับตัวอย่างจริงใน ADAuthen.md §3 เป๊ะ, environment preset apply, system-settings routes

**Verify:** `npm test` (186/186 เขียว) · frontend `npm run build` ผ่าน (no errors) · migration รันจริงกับ dev DB
สำเร็จ (เพิ่ม column/table โดยไม่กระทบข้อมูลเดิม) · server module load สำเร็จ (แค่ชนพอร์ตกับ container `iqc-local`
ที่รันอยู่ก่อนแล้ว — ไม่ใช่ bug ของโค้ดนี้)

**พบระหว่างทำ (ไม่เกี่ยวกับ session นี้ ไม่ได้แก้):** dev DB (`iqc.db`) fail `quick_check` integrity — "2nd reference
to page X", "Rowid out of order" หลายจุด เป็น pre-existing corruption (ไม่ throw เพราะ `NODE_ENV != production`)
ไม่เกี่ยวกับ schema migration ของ session นี้ (แค่ ALTER TABLE ADD COLUMN/CREATE TABLE IF NOT EXISTS) — แนะนำ
กู้คืนจาก backup ก่อนใช้งาน production จริงตาม DEPLOYMENT.md

**ยังไม่ได้ทำ (รอ user):** เอกสาร `AUTH_ARCHITECTURE.md`/`AUTH_DEPLOYMENT.md` ตามที่ระบุใน plan §9 (สรุป
architecture/flow/sequence diagram/DB design/API design/security design + environment config guide/cloud
migration guide) — ยังไม่เขียน รอ user ยืนยันว่าต้องการหรือไม่

---

## 2026-07-06 | Session 117 — Login.jsx: ล็อกไม่ให้เลื่อนขึ้นลงได้ ทั้งมือถือและเดสก์ท็อป

**คำขอ:** user แนบ screenshot หน้า login เดสก์ท็อปที่มี scrollbar ปรากฏ (เนื้อหาสูงเกิน viewport เล็กน้อยที่จอ
กว้างแต่เตี้ย เช่น 1920×945) ขอ "จัดใหม่ให้เต็มหน้าพอดี ทั้งมือถือและ WebApp" — กว้างกว่าคำขอมือถืออย่างเดียวที่เคย
ทำและ revert ไปก่อนหน้านี้ (ครั้งนี้ครอบคลุมเดสก์ท็อปด้วยจริง เป็นคำขอที่ยืนยันแล้ว ไม่ใช่ทดลอง)

**Root cause:** container นอกใช้ `min-h-screen` (ความสูงขั้นต่ำ) ไม่ใช่ fixed height; วัดจริงพบ overflow ทั้ง 2 breakpoint:
- มือถือ 375×667: เนื้อหาสูง 841px (เกิน 174px) — WindowMark 110px+margin เป็นก้อนใหญ่สุด
- เดสก์ท็อป 1280×720/1366×768 (จอกว้างแต่เตี้ย ค่อนข้างพบบ่อย): panel ซ้าย (`justify-between` แต่เนื้อหาภายในไม่ยืดหด)
  สูงธรรมชาติ 800px คงที่ไม่ว่า viewport จะสูงเท่าไหร่ ⇒ ล้นที่จอเตี้ย

**แก้ (ครอบคลุมทั้ง 2 breakpoint พร้อมกัน):**
- ล็อก scroll: container นอก `h-screen` + inline `style={{height:'min(100dvh,100svh)'}}` (progressive enhancement —
  browser ที่ไม่รู้จัก dvh/svh จะ fallback ไป `h-screen` เพราะ `min()` กับ unit ที่ไม่รู้จักทำทั้ง property invalid)
  + `overflow-hidden overscroll-none` + `useEffect` ล็อก `document.documentElement`/`body` overflow ตอน mount
  คืนค่าเดิมตอน unmount (pattern เดียวกับ `Modal.jsx`)
- **มือถือ:** ซ่อน `WindowMark` (ภาพประกอบล้วนๆ ไม่ใช่ logo จริง) ที่ `hidden sm:flex`, ลด padding/margin/spacing
  ของ card/form/divider/footer เป็นค่า compact เฉพาะ breakpoint มือถือ — inputs ไม่แตะ (คง 44px ตามกฎ CLAUDE.md §10)
- **เดสก์ท็อป:** panel ซ้าย ลด padding `p-10 xl:p-14`→`p-8 xl:p-10` + ลด margin/padding ของ heading/checklist/badge
  (`mb-8`→`mb-5`, badge `p-4`→`p-3`); panel ขวา (card) เพิ่ม step `lg:` ให้ padding/margin ไล่ลงจากเดิม (เช่น
  `sm:p-8`→`sm:p-6 lg:p-8`) + ลดขนาด `WindowMark` จาก 110→96px (คงเห็นทุก breakpoint ตั้งแต่ sm ขึ้นไป ไม่ซ่อนบน
  เดสก์ท็อป)

**Verify:** รัน `npx vite` ชี้ backend เดิม (ไม่แตะ container `iqc-local` port 3001) ขับด้วย Playwright วัด
bounding box จริง (ไม่ใช่แค่เทียบ `scrollHeight` เพราะ container ที่ fix height + overflow-hidden จะรายงาน
`scrollHeight===innerHeight` เสมอไม่ว่าเนื้อหาข้างในจะ clip จริงหรือไม่ — ต้องเช็ค bounding rect ของ element
จริงเทียบ viewport) ครอบคลุม 320×568 (มือถือเก่าสุด) ถึง 390×844/414×896 (มือถือทั่วไป) และ 1280×720/1366×768
(laptop เตี้ย ที่เคยมีปัญหาโดยตรงตาม screenshot user) ถึง 1920×945/1440×900 — ทุกขนาด element สุดท้าย (footer,
features grid, card) อยู่ในกรอบ viewport ครบ (คลาดเคลื่อนสูงสุด 1px ที่ 1280×720 ซึ่งเป็น sub-pixel rounding
ไม่กระทบสายตา), ลองยิง `mouse.wheel` แล้ว `scrollY` คงที่ 0 ทุกกรณี

---

## 2026-07-06 | Session 116 — สายผลิต: ประเภทสาย/โรงงาน เป็น dropdown ขยายได้ (+ quick-add) + auto-gen รหัสสาย

**คำขอ:** user ขอที่หน้า Admin → ตั้งค่า Master → สายผลิต ให้ "ประเภทสาย" และ "โรงงาน" เป็น dropdown ที่มีปุ่ม +
เพิ่มตัวเลือกใหม่ได้เอง (เดิม line_type เป็น fixed enum 3 ค่า, factory เป็น text พิมพ์เอง) และให้ "รหัสสาย" สร้าง
auto จาก ประเภทสาย+โรงงาน+รหัสโรงงาน รันเลขต่อเนื่องไปเรื่อยๆ (เดิมพิมพ์เองตาม placeholder `F01-ALU-15`)

**ตัดสินใจร่วมกับ user (ถาม 2 คำถามก่อนทำ):**
1. รูปแบบรหัสสาย = `{factory}-{LINE_TYPE}-{seq}` เช่น `F01-ALU-15` ตาม placeholder เดิม (ไม่ผสม factory_code
   เข้าไปในสตริงตรงๆ — factory_code ใช้เป็นตัวกำหนด per-factory sequence key แทน)
2. รหัสโรงงาน (factory_code) ผูกกับ "โรงงาน" แบบ auto-fill — กรอกครั้งเดียวตอนเพิ่มโรงงานใหม่ผ่านปุ่ม + จากนั้น
   ทุกสายที่เลือกโรงงานนั้นจะเติมอัตโนมัติ ไม่ต้องพิมพ์ซ้ำทุกครั้ง (เดิมพิมพ์เองทุกแถว)

**Data model ใหม่:**
- ตาราง `line_types` (code/name) + `factories` (name/factory_code) — master list สำหรับ dropdown, ขยายได้
  ผ่าน `POST /api/ipqc/master/line-types` และ `/factories` (generic `makeCrudRouter`, admin only)
- ตาราง `production_line_seq` (factory, line_type, last_seq) — atomic running number ต่อคู่ (factory, line_type)
  ผ่าน `UPDATE ... RETURNING` ในทรานแซกชัน (ตามกฎ 2.3 ห้าม SELECT MAX ตอน generate) — self-healing ถ้าเผลอชนกัน
  เพราะ `code` มี UNIQUE constraint อยู่แล้ว (retry ได้เลขใหม่อัตโนมัติ)
- `production_lines.line_type` เดิมมี `CHECK(line_type IN ('alu','upvc','other'))` — ตาราง DB เก่าต้อง rebuild
  ออก (`migrateProductionLinesLineTypeConstraint()`, pattern เดียวกับ `migrateUsersRoleConstraint()` เดิม)
- Backfill ตอน boot: seed `line_types` เริ่มต้น (alu/upvc/other ตาม enum เดิม) + backfill `factories` จาก
  `production_lines` ที่มีอยู่แล้ว (กัน dropdown ว่างตอนอัปเกรด DB จริง) + sync `production_line_seq.last_seq`
  จาก code เดิมที่ parse ได้ (เพิ่มใน `syncSequences()` เดิม, ไม่ใช้ SELECT MAX ตอน request-time)

**Backend hook (`routes/ipqcMaster.js` linesRouter):** `hooks.beforeWrite` — POST validate factory/line_type
มีอยู่จริงใน master table (ไม่งั้น throw `httpError(..., 400)`), auto-fill `factory_code` จาก factories table,
auto-gen `code`; PATCH ลบ `code`/`factory_code`/`factory`/`line_type` ออกจาก payload เสมอ (immutable หลังสร้าง
เหมือน record_no/defect_code ที่อื่นในระบบ — เพราะ code ผูกกับค่า 2 ตัวนี้ไปแล้ว)

**lib/crud.js:** เพิ่ม `handleDbError` รองรับ `e.status` (pattern `httpError()` ที่ services/*.js ใช้อยู่แล้ว
ตาม CLAUDE.md 2.2) + ย้าย `hooks.beforeWrite` เข้าไปใน try/catch ของ POST/PATCH (เดิมอยู่นอก try — ถ้า hook throw
จะหลุดเป็น unhandled error แทนที่จะ map เป็น 400/409 ที่ถูกต้อง)

**Frontend (`CrudPanel.jsx` FormBody — generic, ใช้ร่วมกับทุกหน้า Master):** เพิ่ม field option `disabled`
(bool หรือ `(initial) => bool`), `computed(form, initial)` (แสดง preview แบบ read-only ไม่ผูกกับ form state),
`help` รองรับ function, และ `creatable` (`{title, inputs[], onAdd}`) → component `QuickAddOption` ปุ่ม + เปิด
popover เล็กเติมค่าใหม่แล้วเลือกอัตโนมัติโดยไม่ต้องปิด modal — ทุก field อื่นที่เป็น `type:'select'` ในระบบใช้
`creatable` นี้เพิ่มได้ทันทีถ้าต้องการในอนาคต

**Import Excel:** เดิม `line_type` validate ด้วย `enum:['alu','upvc','other']` ตายตัว — เปลี่ยนเป็น `isRef`
เทียบกับ `line_types`/`factories` ที่ active จริง (dynamic), `factory_code` ตอน import ยึดจาก factories table
เป็นหลัก (ไม่เชื่อค่าที่พิมพ์มาใน Excel ถ้าโรงงานนั้นมีอยู่ในระบบแล้ว)

**Test:** อัปเดต `ipqcMaster.test.js` (schema/behavior เปลี่ยนจริง ตาม CLAUDE.md ต้องมี integration test คลุมก่อนแก้ของเดิม)
— เพิ่ม test สร้าง factory ก่อนสร้างสาย, ยืนยัน code auto-gen ตรง pattern, ยืนยัน sequential code (2 สายเดียวกัน
factory+line_type ได้เลขต่อกัน), เปลี่ยน "duplicate code → 409" เดิม (ใช้ไม่ได้แล้วเพราะ code auto-gen ไม่ชนกันเอง)
เป็น "unknown line_type/factory → 400" — **164/164 tests เขียวทั้งระบบ**

**Verify:** รัน server จริง (port 3010, temp DB) + `npx vite` (port 5183 ชั่วคราว ชี้ proxy ไป 3010 แล้ว revert
คืนกลับ 3001 หลังเทส) ขับเคลื่อนด้วย Playwright จริงผ่าน login → เพิ่มสายผลิต → กดปุ่ม + เพิ่มประเภทสาย/โรงงานใหม่
→ auto-select → factory_code/code preview อัปเดตสด → บันทึกสำเร็จได้ `F11-STEEL-1` จริง → เปิดแก้ไขยืนยัน
factory/line_type/code เป็น disabled ครบ — **ไม่ได้แตะ container `iqc-local` ที่ยึด port 3001 อยู่ (โปรดระวังทุกครั้ง
ที่ทดสอบ local, ดู memory `project-docker-local-dev`)**

---

## 2026-07-03 | Session 115 — Window Asia brand redesign: Login.jsx เต็มรูปแบบ + design token cascade ทั้งระบบ

**คำขอ:** user แนบ `design login.png` (mockup หน้า Login แบบ split-screen premium) + `logo4.png` (โลโก้จริง "Window Asia" —
บริษัทประตูหน้าต่าง Alu/uPVC ที่ระบบนี้เป็น internal QMS ให้) สั่ง redesign UX/UI ทั้งระบบให้เป็น theme เดียวกับโลโก้
(สไตล์ SaaS Enterprise + Glassmorphism + Industrial Premium) พร้อม request เต็มรูปแบบ 18 หัวข้อ (รวม Next.js/shadcn/ui,
OAuth2/SSO, full dashboard/table/KPI redesign ฯลฯ) — **conflict สำคัญ:** request ขอ Next.js แต่ `CLAUDE.md` ปักหมุด
stack เป็น Vite+React+Tailwind อยู่แล้ว (ตัดสินใจไม่ migrate — แจ้ง user ตรงๆ แทนที่จะเงียบทำครึ่งเดียว) — ถาม
scope ผ่าน `AskUserQuestion` ก่อนเริ่ม (ตัวเลือก: design system+Login+cascade / +bespoke Dashboard / bespoke ทุกโมดูล)
→ user เลือก **"Design system + Login + cascade"** (ตัวเลือกแนะนำ, เร็วและ low-risk เพราะทั้ง 51 หน้าผูกกับ
Tailwind semantic token/class ชุดเดียวกันอยู่แล้ว)

**สำคัญ — บริบทบริษัท:** ชื่อบริษัทจริงของระบบนี้คือ **"Window Asia"** (ประตูหน้าต่าง Alu/uPVC) — ไม่เคยถูกบันทึกไว้ใน
CLAUDE.md/เอกสารก่อนหน้านี้เลย ควรใช้ชื่อนี้อ้างอิงแทน "IQC System" เปล่าๆ ในงาน branding ต่อไป

**แก้:**
- `client/tailwind.config.js` — ปรับค่า `primary`/`accent` เข้ม/อิ่มตัวขึ้นเล็กน้อย (คงชื่อ token เดิมทุกตัว ไม่กระทบ
  51 หน้าที่ผูก class เดิม) + เพิ่ม token ใหม่ `primary-dark`/`accent-glow`/`aluminum.{50-700}` + `boxShadow`
  (`glow-sm`/`glow`/`elevated`) + `keyframes`/`animation` (`fadeInUp`/`floatY`/`gradientPan`/`shimmer`) — **ไม่แตะ**
  `success`/`danger`/`warning` (functional status color, เปลี่ยนไม่ได้)
- `client/src/index.css` — `.btn-primary` เปลี่ยนเป็น gradient (`primary→accent`) + glow shadow ตอน hover, `.input`
  focus เปลี่ยนจาก ring บางเป็น glow ring (`accent-glow/25`), `.card` เพิ่ม `shadow-sm`, เพิ่ม class ใหม่
  `.glass-panel`/`.glass-card`/`.brand-gradient` — เพราะ 3 class เดิม (`.btn-primary`/`.input`/`.card`) ถูกใช้ทั่ว
  51 หน้าอยู่แล้ว แก้จุดเดียวนี้ = cascade ธีมใหม่ทั้งระบบทันทีแบบเดียวกับที่ S114 ทำกับ `font-mono`
  - เพิ่ม `@media (prefers-reduced-motion: reduce)` global override (ตัด animation/transition duration เหลือ ~0)
    — WCAG 2.2 (2.3.3), mockup ต้นฉบับไม่ได้พูดถึงเรื่องนี้เลยแต่ต้องมีเพราะ request เน้น "ไม่เวียนหัว"+"WCAG friendly"
- `client/src/pages/Login.jsx` — เขียนใหม่ทั้งหมด: split-screen (ซ้าย brand panel gradient + checklist + warranty
  badge + feature icon row, ขวา glass-card form) ด้วย Framer Motion (fadeInUp entrance, floating blob, gradient
  pan, staggered reveal) — **reskin ตาม mockup แต่ตรงกับ backend จริง ไม่ตรงแค่ภาพ:** ฟอร์มยังเป็น username/password
  (ไม่ใช่ email — เช็คแล้วจาก `routes/auth.js` ไม่มี OAuth/email login), password toggle เปลี่ยนจาก hold-to-show
  เดิมเป็น click-to-toggle มาตรฐาน, เพิ่ม "จดจำฉัน" จริง (เก็บ username ใน localStorage เท่านั้น ไม่ได้ขยายอายุ
  session เพราะ backend ไม่มี remember-me จริง), "ลืมรหัสผ่าน" เปิด popover แจ้งให้ติดต่อ Admin (ไม่มี self-service
  reset จริงในระบบ), ปุ่ม "Internal AP System"/"Microsoft" ใส่เป็น disabled+badge "เร็วๆ นี้" (ไม่มี OAuth backend
  จริง — เตรียม UI ไว้ก่อนตามที่ขอ แต่ไม่หลอกว่าใช้งานได้), ตัด "สมัครสมาชิก" ออกเพราะระบบปิด ไม่มี self-registration
- `client/src/components/Brand/WindowMark.jsx` (ใหม่) — SVG motif เรขาคณิต "หน้าต่างซ้อนชั้น" ตกแต่ง (ไม่ใช่โลโก้จริง)
  animate ด้วย Framer Motion (float, light-reflection sweep clip ในกรอบ) — ใช้แทนภาพสถาปัตยกรรมลิขสิทธิ์ใน mockup;
  respect `useReducedMotion()`
- `client/src/assets/logo-window-asia.png` (ใหม่) — คัดลอกจาก `logo4.png` ที่ user แนบมา ใช้เป็น brand lockup จริง
  ใน Sidebar + Login (ต่างจาก WindowMark ที่เป็นแค่ decorative motif)
- `client/src/components/Layout/Sidebar.jsx` — header เปลี่ยนจาก solid `bg-primary` + "IQC System" เป็น
  `brand-gradient` + โลโก้ Window Asia จริง
- `client/index.html` — title เปลี่ยนเป็น "Window Asia · IQC System"
- เพิ่ม dependency `framer-motion` ใน `client/package.json`

**Verify:** เปิด Vite dev server จริง (`npm run dev`, ไม่แตะ container `iqc-local` ที่ครอง port 3001 อยู่ — เห็นจาก
`curl localhost:3001` ตอบ 200 แต่**ไม่ได้ลอง login เดา credential ใส่ container นั้น** ตามหลักการเดิมที่ห้ามแตะ
container โดยไม่ถาม), ใช้ `puppeteer` (มีอยู่แล้วใน `server/node_modules` สำหรับ PDF export) เป็น headless browser
เปิด `/login` จริง จับ screenshot desktop (1440×900) + mobile (390×844) — เทียบกับ mockup ตรงกันเกือบทุกจุด, เจอ
bug 2 จุดจาก screenshot จริง (ไม่ใช่แค่อ่านโค้ด): reflection sweep ของ `WindowMark` หลุดกรอบ (ไม่มี `clipPath`) กับ
badge "เร็วๆ นี้" ตัดคำ (ไม่มี `whitespace-nowrap`) — แก้ทั้งคู่แล้ว screenshot ซ้ำยืนยันหาย · `console --errors`
เจอแค่ 401 จาก `/auth/me` (คาดหวังอยู่แล้วตอนยังไม่ login ไม่ใช่ bug) · **ยังไม่ได้ verify การ cascade ไปหน้าอื่น
(Dashboard ฯลฯ) แบบ end-to-end จริง** เพราะต้อง login เข้า container ที่ถูกสั่งห้ามแตะโดยไม่ถาม — ประเมินจาก CSS diff
ว่า risk ต่ำ (additive เท่านั้น: gradient แทน solid, shadow เพิ่ม, glow ring แทน ring บาง) แต่ยังไม่ยืนยันด้วยตา

**ขอบเขตที่ตัดสินใจไม่ทำรอบนี้ (บันทึกไว้กัน AI รุ่นถัดไปสับสน):** Next.js/shadcn migration (ขัด CLAUDE.md stack),
bespoke Dashboard/Table/KPI redesign (เกิน scope ที่ user เลือก), full dark-mode toggle wiring (มี token ต้นแบบใน
design-system artifact แล้วแต่ยังไม่ได้ต่อเข้า app), OAuth2/SSO backend จริง (ปุ่มใน UI เป็น placeholder เท่านั้น)

**ไฟล์:** `client/tailwind.config.js`, `client/src/index.css`, `client/src/pages/Login.jsx`,
`client/src/components/Brand/WindowMark.jsx` (ใหม่), `client/src/assets/logo-window-asia.png` (ใหม่),
`client/src/components/Layout/Sidebar.jsx`, `client/index.html`, `client/package.json`

---

## 2026-07-03 | Session 114 — เลข 0 จุดกลาง (IBM Plex Mono) แก้ทั้ง Project ด้วย Tailwind config เดียว

**คำขอ:** user สั่งเปลี่ยนเลข 0 แบบมีจุดกลางเป็นแบบไม่มีจุด "ทุกฟอร์ม" "ทั้ง Project" — ต่อยอดจาก bug เดิมที่เคยแก้เฉพาะจุดเดียวใน `Bills/Detail.jsx` (ต้น session ก่อนสรุป, ยืนยันด้วย Playwright ว่า CSS แก้ glyph ไม่ได้เลย ต้องเลิกใช้ font-mono สำหรับตัวเลข)

**ขอบเขตจริง:** `grep font-mono` เจอ **51 ไฟล์** ใน `client/src` — ใช้กับ Invoice No./PO No./รหัสสินค้า/จำนวน/วันที่ ฯลฯ แทบทุกหน้า

**แก้ (จุดเดียว แก้ทั้งหมด แทนที่จะไล่แก้ 51 ไฟล์):**
- `client/tailwind.config.js`'s `theme.extend.fontFamily.mono` — เปลี่ยนจาก `['IBM Plex Mono', 'monospace']` เป็น `['IBM Plex Sans Thai', 'sans-serif']` (เหมือน `sans` เป๊ะ) — เพราะ `font-mono` เป็น Tailwind utility class ที่ resolve ผ่าน config นี้จุดเดียว การแก้ที่นี่ทำให้ทุกที่ที่มี `className="font-mono"` อยู่แล้วทั่วโปรเจกต์ (51 ไฟล์) ไม่มีเลข 0 จุดกลางอีกต่อไปทันที โดยไม่ต้องแก้ JSX แม้แต่บรรทัดเดียว — trade-off ที่ยอมรับ (ตามที่ user ทำมาแล้วกับ `Bills/Detail.jsx`): เสียคุณสมบัติ monospace true alignment แลกกับความชัดเจนของตัวเลข 0
- `client/index.html` — ลบ `IBM+Plex+Mono` ออกจาก Google Fonts `<link>` (เหลือแค่ `IBM+Plex+Sans+Thai`) เพราะไม่มีจุดไหนอ้างถึง font นี้จริงแล้ว (`grep` ยืนยันไม่มี `font-mono`/`Plex Mono` เหลือใน `server/` เลย — ฝั่ง PDF export ไม่เคยมีปัญหานี้ตั้งแต่แรกเพราะใช้ IBM Plex Sans Thai อยู่แล้ว)
- `CLAUDE.md` §10 — อัปเดตกฎ font ให้ตรงกับโค้ดจริง (ห้ามใช้ IBM Plex Mono เป็น monospace จริงอีก พร้อมอธิบาย root cause)

**Verify:** `npm run build` (client) ผ่าน, เปิดเบราว์เซอร์จริงผ่าน `iqc-local` container ของ user (read-only, login+ดูหน้า `/bills` เท่านั้น ไม่มีการเขียนข้อมูล) — zoom ดูแถวที่มีเลข 0 หลายตัว ("4001393764", "250610067") ยืนยันเป็นเลข 0 ไม่มีจุดกลางแล้วทุกตัว · `npm test` (server) = 161/161 เขียว (ไม่กระทบ เพราะเป็น client-only change)

**ไฟล์:** `client/tailwind.config.js`, `client/index.html`, `CLAUDE.md`

---

## 2026-07-03 | Session 113 — UAI PDF "ข้อมูลที่ได้รับจากผู้ผลิต": เอาเลขนำหน้าออก + จัด 2 คอลัมน์ + เยื้อง "ยังไม่มีรูปภาพ"

**คำขอ:** user แนบภาพ (ไม่มีชื่อไฟล์ ส่งตรงในแชท) ของ section "ข้อมูลการขอยอมรับใช้" สั่งปรับให้ตรงตามภาพ

**Diff จากภาพ (เทียบ output จริงปัจจุบัน):**
1. เดิม label 4 ข้อมีเลขนำหน้า "1. ข้อบกพร่องที่เกิดขึ้น" ฯลฯ — ภาพไม่มีเลขนำหน้าแล้ว
2. เดิมจัด layout แบบ stack แนวตั้งเต็มความกว้าง (1 คอลัมน์) — ภาพจัดเป็น **2 คอลัมน์** (defect/cause แถวบน, corrective/preventive แถวล่าง) แบบเดียวกับ info-grid ด้านบน
3. ข้อความ "ยังไม่มีรูปภาพ" (กรณีไม่มีรูป) เดิมชิดซ้ายเท่ากับหัวข้ออื่น — ภาพมีระยะเยื้องเข้ามาเล็กน้อย

**แก้ (`server/routes/exports.js`):**
- `producerRespItems` — ลบเลขนำหน้า "1./2./3./4." ออกจาก label ทั้ง 4
- `producerRespHtml` — เปลี่ยนจาก stacked `<div style="margin-bottom">` เป็น `<div class="info-grid">` ครอบ `<div class="info-row"><div class="info-label">...</div><div class="info-value">...</div></div>` ต่อรายการ (ใช้ CSS class เดิมที่มีอยู่แล้ว `.info-grid`/`.info-label`/`.info-value` — ได้ 2 คอลัมน์ + word-wrap ฟรีโดยไม่ต้องเขียน style ใหม่)
- "ยังไม่มีรูปภาพ" `<p>` เพิ่ม `margin-left:16px`

**Verify:** re-export PDF จาก temp DB เดิม (`PORT=3099`, restart process ให้โหลดโค้ดใหม่เพราะรันแบบ `node index.js` ตรงๆ ไม่มี nodemon, ไม่แตะ container `iqc-local`) — เทียบ screenshot ก่อน/หลังตรงกับภาพอ้างอิงทั้ง 3 จุด (ไม่มีเลข, 2 คอลัมน์, เยื้อง) — เอกสารสั้นลงจาก 2 หน้าเหลือ 1 หน้าเป็นผลพลอยได้จาก layout กระชับขึ้น · `npm test` = 161/161 เขียว

**ไฟล์:** `server/routes/exports.js`

---

## 2026-07-03 | Session 112 — ย้อนสีแถว Timeline กลับไปแบบเดิม (คง mix-blend-mode ไว้)

**คำขอ:** user ยืนยันการ blend ลายเซ็น (S111) ใช้ได้แล้ว แต่ขอให้ "ปรับสีตารางให้เป็นแบบเดิม" — ยืนยันว่า row background สีเขียว/แดงที่เพิ่มใน S110 ไม่ใช่สิ่งที่ต้องการ (ตีความ "เปลี่ยนผิด" ใน feedback ก่อนหน้า S111 ถูกต้องแล้วจริงๆ ว่าหมายถึง revert ไม่ใช่ "เปลี่ยนถูกแล้ว") — ยัง "ขอให้ bg กลมกลืนกันด้วย" คือย้ำให้กรอบลายเซ็นยังต้อง blend เข้ากับพื้นหลังจริง ไม่ใช่โผล่เป็นกล่องขาว

**แก้ (`server/routes/exports.js`):** ลบตัวแปร `rowBg` และการใช้ `background:${rowBg}` ออกจากทุก `<td>` ของแถว Timeline — กลับไปใช้ zebra striping ปกติ (`tr:nth-child(even) td { background:#F9FAFB }` จาก global CSS) เหมือนก่อน S110 ทุกประการ; เอา `background:${rowBg}` ออกจาก sig-box div ด้วย (กลับเป็น transparent ให้เห็นพื้นหลังจริงของ td ที่มันอยู่) — **คง `mix-blend-mode:multiply` ไว้ที่ `<img>` ตามเดิมจาก S111** เพราะเป็นสิ่งที่ทำให้พื้นขาวทึบของรูปลายเซ็นกลืนกับพื้นหลังใดๆ ก็ตามที่อยู่ข้างหลัง (ตอนนี้คือสีขาว/เทาอ่อนจาก zebra แทนที่จะเป็นเขียว/แดง) — เทคนิคนี้ใช้ได้กับพื้นหลังทุกสีอยู่แล้ว ไม่ต้องแก้อะไรเพิ่มเมื่อ revert row color

**สถานะหลังแก้ (สิ่งที่ยังคงอยู่จาก S110):** แถว "QC Manager อนุมัติ/ไม่อนุมัติคำขอ UAI" ยังไม่มีกรอบลายเซ็น (ถูกต้องแล้ว ไม่มีการ complain เรื่องนี้)

**Verify:** re-export PDF จาก temp DB เดิม (`PORT=3099`, ไม่แตะ container `iqc-local`) — ยืนยันแถว Timeline กลับเป็นสีขาว/เทาสลับปกติเหมือนก่อน S110, กรอบลายเซ็นกลืนกับพื้นหลังจริง (ขาว/เทาอ่อน) สนิทไม่มีขอบขาวหลุด · `npm test` = 161/161 เขียว

**ไฟล์:** `server/routes/exports.js`

---

## 2026-07-03 | Session 111 — แก้ต่อ S110: สีพื้นหลังลายเซ็นยังไม่ตรงกับแถว (รูปลายเซ็นพื้นขาวทึบบัง)

**คำขอ:** user แนบ `UAI form timeline .png` (screenshot จาก container จริงของ user เอง) พร้อมลูกศรชี้ที่กล่องลายเซ็นแถว QMR — สีพื้นหลังกล่องลายเซ็นยังเป็นสีขาว ไม่ตรงกับสีพื้นหลังของแถว (เขียว/แดง) ที่ตั้งไว้ใน S110 ยืนยันว่า "สีตารางเดิม [หลัง S110] ดีอยู่แล้ว" (ไม่ต้อง revert row tinting) — ปัญหาคือเฉพาะกล่องลายเซ็น

**Root cause:** `background:${rowBg}` ที่ตั้งไว้บน `<div>` ครอบกล่องลายเซ็นใน S110 ถูกต้องแล้ว แต่**รูปลายเซ็นที่เก็บจริง (จาก signature pad) เป็น PNG ที่มีพื้นหลังขาวทึบเต็มภาพเสมอ** (ไม่ transparent) — เมื่อ `<img>` วางทับ (`object-fit:contain` เกือบเต็มกล่อง 90×40px) พื้นขาวทึบของรูปเองจะบังสี `background` ของ div ด้านหลังจนมองไม่เห็นสีที่ตั้งไว้เลย — เป็นข้อจำกัดของภาพ raster ไม่ใช่ bug ของ CSS ที่ตั้งไว้

**แก้ (`server/routes/exports.js`):** เพิ่ม `mix-blend-mode:multiply` ให้ `<img>` ของลายเซ็นใน Timeline — เทคนิค CSS blend mode มาตรฐานสำหรับวางรูปพื้นขาวทับพื้นสี: พิกเซลขาว × สีพื้นหลัง = สีพื้นหลัง (พื้นขาว "หายไป" กลืนกับสีด้านหลัง) ในขณะที่พิกเซลเข้ม (เส้นลายเซ็น) ยังเข้มอยู่ตามปกติ (สีเข้ม × อะไรก็ตาม ≈ ยังเข้ม) — ไม่ต้องแก้ไฟล์รูปจริงหรือ image processing ใดๆ, ใช้ได้กับรูปเดิมที่มีอยู่แล้วทุกใบ

**Verify:** สร้างรูปลายเซ็นทดสอบจริงจำลอง signature-pad export (canvas พื้นขาวทึบ + เส้นลายมือ) แทนที่รูป 1×1 transparent ที่ใช้ทดสอบก่อนหน้า (ไม่ได้เจอปัญหานี้เพราะโปร่งใสอยู่แล้ว) ใน temp DB แยก (`PORT=3099`, ไม่แตะ container `iqc-local`) → export PDF จริง, render ด้วย `pdfjs-dist` — ยืนยันกล่องลายเซ็นแถว "อนุมัติ" กลืนเป็นพื้นเขียว, แถว "ปฏิเสธ" กลืนเป็นพื้นแดง ตรงกับแถวเป๊ะ ไม่มีสี่เหลี่ยมขาวหลงเหลือ · `npm test` = 161/161 เขียว

**ไฟล์:** `server/routes/exports.js`

---

## 2026-07-03 | Session 110 — UAI PDF Timeline: เอากรอบลายเซ็นออกจากขั้น QC Manager review + สีพื้นหลังกรอบลายเซ็นตรงกับแถว

**คำขอ:** (1) แถว "QC Manager อนุมัติคำขอ UAI" ใน Timeline ไม่ควรมีกรอบลายเซ็น เพราะขั้นนี้เป็นการคลิกปุ่มอนุมัติ/ไม่อนุมัติเท่านั้น ไม่มีการเซ็นจริง (2) กรอบลายเซ็นควรมีสีพื้นหลังตรงกับสีของแถวนั้นๆ

**ยืนยัน root cause จากโค้ด:** `services/uaiService.js`'s `reviewUai()` insert แถว `uai_signatures` สำหรับขั้นนี้ด้วย `signature_image=''` เสมอ (บรรทัด 38, 49) — ไม่เคยมีการเซ็นจริงตั้งแต่ระดับ business logic (คนละ endpoint กับ `/uai/:id/sign` ที่ใช้ signature canvas จริง) ยืนยันว่า action `review_approved`/`review_rejected` ไม่มี signature จริงเสมอ ไม่ใช่แค่บางเคส

**แก้ (`server/routes/exports.js`, UAI PDF Timeline `timelineRows`):**
- เพิ่มเช็ค `isReviewStep = action === 'review_approved' || action === 'review_rejected'` — ถ้าใช่ ไม่ render กรอบลายเซ็นเลย (cell ว่าง แทนที่จะเป็นกรอบเปล่า)
- เพิ่ม `rowBg` (`#FEF2F2` แดงอ่อนถ้า reject, `#F0FDF4` เขียวอ่อนถ้าไม่ใช่ — ใช้ logic เดียวกับ `isNeg` ที่มีอยู่แล้วสำหรับสีตัวอักษร) apply เป็น `background` ให้ **ทุก `<td>` ของแถว** (ไม่ใช่แค่ `<tr>`) — เพราะ CSS rule `tr:nth-child(even) td { background:#F9FAFB }` (zebra striping) มี specificity สูงกว่า inline style ที่ตั้งแค่ระดับ `<tr>` จะโดน override ในแถวคู่ ต้องตั้งที่ `<td>` โดยตรงถึงจะชนะแน่นอน
- กรอบลายเซ็น (เมื่อแสดง) ตั้ง `background:${rowBg}` ให้ตรงกับแถวเป๊ะ ไม่ใช้ transparent/white

**Verify:** seed แถว `uai_signatures` ทดสอบ 3 แบบ (`review_approved` ไม่มีลายเซ็น, `approved` มีลายเซ็น, `rejected` มีลายเซ็น) ใน temp DB แยก (`PORT=3099`, ไม่แตะ container `iqc-local` — ดู S108), export PDF จริง, render ด้วย `pdfjs-dist` — ยืนยันแถว QC Manager review ไม่มีกรอบลายเซ็นเลย, แถว "อนุมัติ" มีกรอบพื้นเขียวตรงกับแถว, แถว "ปฏิเสธ" มีกรอบพื้นแดงตรงกับแถว · `npm test` = 161/161 เขียว

**ไฟล์:** `server/routes/exports.js`

---

## 2026-07-03 | Session 109 — PDF UAI/NCR: เพิ่มข้อมูลรับเข้า + รหัสสินค้า + จัดรูปแบบรูปให้ตรง reference form (v2)

**คำขอ:** user แนบ `form UAI_NCR.jpg` เวอร์ชันใหม่ (มีเนื้อหาต่างจาก S108's version — ไม่ใช่แค่หัวกระดาษแล้ว) สั่งปรับ "รูปแบบทั้งฟอร์ม" อีกครั้ง — ยืนยันด้วย mtime ไฟล์เปลี่ยนจริงหลัง S108

**Diff จาก reference image (เทียบ output จริงของ S108):**
1. การ์ด "ข้อมูล UAI" มีแถวเพิ่ม: "พนักงานรับเข้า {ชื่อ}" / "รับเมื่อวันที่ {DD/MM/พ.ศ.}" — ข้อมูลเดียวกับที่เพิ่มใน NCR Detail page (ต้นๆ session ก่อนหน้า) แต่ยังไม่เคยอยู่ใน PDF export เลยทั้ง UAI และ NCR
2. รายการสินค้าแต่ละแถวมีบรรทัดเพิ่ม "(รหัสสินค้า: {code})" ตัวหนา — มาจาก `products.code` (เดิม query ไม่เคย join `products` เข้ามาเลย)
3. Layout รูปภาพของ item เปลี่ยนจาก "ข้อความเต็มความกว้าง แล้วรูป grid ด้านล่าง" → **"ข้อความซ้าย รูปด้านขวาในกล่องเดียวกัน (side-by-side) เมื่อมี ≤2 รูป"** — พบว่า pattern นี้**มีอยู่แล้วจริงใน NCR PDF** (`respSideBySide`/`sideBySide` ในโค้ดคำตอบ supplier + รายการสินค้า NCR) แต่ **UAI PDF ไม่เคย apply pattern เดียวกัน** — เป็นการทำให้ 2 เอกสารสอดคล้องกัน ไม่ใช่ดีไซน์ใหม่

**แก้ (`server/routes/exports.js`):**
- เพิ่ม helper `thShortDate(dateStr)` — แปลงวันที่เป็น DD/MM/พ.ศ. ผ่าน `toLocaleDateString('th-TH', {day:'2-digit',month:'2-digit',year:'numeric'})` (ทดสอบแล้ว `2026-07-03` → `03/07/2569` ตรงกับภาพ)
- **UAI PDF query**: เพิ่ม join `users bu ON bu.id = b.created_by` → `bill_received_by_name`, `b.received_date as bill_received_date`; `ncrItems` query เพิ่ม join `bill_items`→`products` → `product_code`
- **UAI PDF**: เขียนใหม่ `itemsWithImagesHtml` ให้ใช้ pattern side-by-side เดียวกับ NCR (`imgs.length >= 1 && imgs.length <= 2` → flex row ข้อความซ้าย/รูปขวา, มากกว่า 2 → grid ด้านล่างเหมือนเดิม) + เพิ่มบรรทัดรหัสสินค้า + เพิ่มแถว "พนักงานรับเข้า"/"รับเมื่อวันที่" ใน info-grid หลัก
- **NCR PDF**: เพิ่ม join เดียวกัน (`bill_received_by_name`) — `received_date` มีอยู่แล้วเดิม, เพิ่ม `product_code` join ใน `ncrItems`, เพิ่มบรรทัดรหัสสินค้าใน `infoHtml`, เพิ่มแถว "พนักงานรับเข้า"/"รับเมื่อวันที่" ใน info-grid (layout รูปภาพไม่ต้องแก้ — มี side-by-side pattern อยู่แล้ว)

**ขอบเขตที่ตัดสินใจเอง (ไม่มี reference ยืนยันตรงๆ):** เพิ่ม "พนักงานรับเข้า"/"รับเมื่อวันที่" + รหัสสินค้าให้ **ทั้ง UAI และ NCR PDF** (ไม่ใช่แค่ UAI ตาม reference ที่แนบ) เพราะโครงสร้าง query/render ของทั้งคู่แทบเหมือนกันทุกจุด และ field พวกนี้เพิ่งถูกเพิ่มใน NCR Detail page ไปแล้วก่อนหน้าแต่ตกหล่นจาก PDF export — เป็นการทำให้ครบตาม intent เดิมมากกว่าฟีเจอร์ใหม่

**Verify:** สร้าง Bill→NCR→UAI ทดสอบ (พร้อมรูป bill_item_image จริง) ใน temp DB แยกอีกครั้ง (`PORT=3099`, ไม่แตะ container `iqc-local` ของ user — ดู S108), export ทั้ง UAI/NCR PDF, render ผ่าน `pdfjs-dist` เทียบกับ `form UAI_NCR.jpg` เวอร์ชันล่าสุด — ตรงกันทั้ง 3 จุดที่แก้ (แถวรับเข้า, รหัสสินค้า, รูปด้านข้าง) · `npm test` = 161/161 เขียว

**ไฟล์:** `server/routes/exports.js`

---

## 2026-07-03 | Session 108 — PDF letterhead/title format ตาม reference form (UAI/NCR) + Docker port discovery

**คำขอ:** user แนบไฟล์ `form UAI_NCR.jpg` (mockup ปรับ title text) สั่งปรับหัวกระดาษ PDF ให้ตรงตาม form: UAI ใช้ "เอกสารขอใช้พิเศษ(UAI)", NCR ใช้ "เอกสาร Non-Conformance Report(NCR)"

**เทียบกับ Session 107:** reference image ที่แนบมาไม่ตรงกับโค้ดที่เพิ่งแก้ใน S107 เป๊ะ — running header (มุมขวาบน) ในภาพเป็นแบบ **แถวเดียวกับข้อมูลบริษัท ชิดขวา** (ของเดิมก่อน S107) ไม่ใช่แบบที่ S107 ย้ายไปแถวใหม่ชิดซ้ายใต้เส้น ส่วน body title ใหญ่กลางหน้าที่ภาพโชว์ ("เอกสารขอใช้พิเศษ(UAI)") เป็นข้อความที่ไม่เคยมีในโค้ดจริงมาก่อนเลย (S107 ใส่ "เอกสาร UAI — {code}" ชิดซ้าย ไม่ใช่ข้อความนี้) → สรุปว่า reference เป็น mockup ที่ user แก้ title text เอาไว้สื่อสาร ไม่ใช่ screenshot ของโค้ดจริง ณ เวลาใดเวลาหนึ่ง

**แก้ (`server/routes/exports.js`):**
- `docHeaderTemplate` (running header ทุกหน้า, ใช้ร่วมทุก PDF export ในระบบ): ย้าย title กลับไปแถวเดียวกับข้อมูลบริษัท ชิดขวา ตามภาพ (revert ส่วนหนึ่งของ S107's item 1.5)
- เพิ่ม helper `docTitleHtml(name)` — title ใหญ่ (22px, bold, กึ่งกลางหน้า, สี primary) ไม่มีเลขที่เอกสาร (เลขที่ยังอยู่ที่ running header เหมือนเดิม)
- UAI PDF: เปลี่ยนจาก "เอกสาร UAI — {code}" ชิดซ้าย → `docTitleHtml('เอกสารขอใช้พิเศษ(UAI)')`
- NCR/NCP PDF: เดิมไม่มี body title เลย → เพิ่ม `docTitleHtml('เอกสาร Non-Conformance Report(NCR)')` (ใช้ข้อความเดียวกันทั้ง NCR/NCP severity ตามที่ user ระบุ ไม่แยก NCP variant)

**🔴 พบระหว่าง verify (สำคัญ — ต้องแจ้ง user):** port 3001 ที่เข้าใจว่าเป็น dev server ของ session นี้ แท้จริงถูก **container Docker `iqc-local`** (จาก `docker-compose.local.yml`, สร้างไว้สำหรับทดสอบผ่านมือถือ) ยึดอยู่ — เกิดจาก node process ที่รันด้วย `npm run dev` ของ session ก่อนหน้าตายไปเงียบๆ แล้ว container (ที่มีอยู่ก่อนแล้วหรือ user เปิดเอง) เข้ามาแทนที่ container นี้ **build code เข้า image ตอน build เท่านั้น ไม่ได้ bind-mount source code สด** (mount แค่ `./iqc.db` และ `./uploads`) → การแก้ไขโค้ดใน session จึงไม่ถูกสะท้อนใน container จนกว่าจะ `docker compose -f docker-compose.local.yml up --build` ใหม่ — สิ่งนี้ทำให้การ verify รอบแรกของ session นี้เห็นผลลัพธ์เก่าที่ไม่ตรงกับโค้ดที่เพิ่งแก้ (หลอกว่าโค้ด revert เอง)
- **ไม่ได้แตะ container นี้เลย** (ไม่ stop/restart/rebuild) เพราะเป็น environment จริงของ user ที่กำลัง healthy ใช้งานอยู่ (`Up`, `healthy`, สร้างไว้ก่อนคำขอนี้ไม่นาน) — เปลี่ยนวิธี verify มาใช้ node process แยกต่างหาก (`PORT=3099`, `IQC_DB_PATH` ชี้ไป temp file คนละไฟล์) + seed ข้อมูลทดสอบเองแทน เพื่อไม่แตะ `iqc.db` จริงและไม่เสี่ยง concurrent-access กับ container
- **ข้อสังเกตเพิ่มเติมที่ยังไม่ยืนยัน:** ถ้า node process (native Windows) กับ container (Docker Desktop/WSL2) เคยเปิด `iqc.db` ไฟล์เดียวกันพร้อมกันในช่วงก่อนหน้า อาจเป็นสาเหตุ (หรือสาเหตุร่วม) ของ `DATABASE INTEGRITY CHECK FAILED: wrong # of entries in index idx_audit_user` ที่เห็นซ้ำๆ ทุกครั้งที่ server เริ่มทำงาน — SQLite WAL mode ข้าม Windows↔WSL2 filesystem boundary มีปัญหา locking ที่รู้จักกันทั่วไป ยังไม่ได้สืบสวนลึกกว่านี้ (นอกขอบเขตคำขอนี้) — ถ้าต้องการให้ debug ต่อ แจ้งได้

**Verify:** สร้าง Bill→NCR→UAI ทดสอบใน temp DB แยก (`IQC_DB_PATH` custom), export ทั้ง UAI/NCR PDF จริงผ่าน node process แยก, render ด้วย `pdfjs-dist` เทียบกับ `form UAI_NCR.jpg` — layout header/title ตรงกันทั้งสองแบบ (UAI + NCR) · `npm test` = 161/161 เขียว (ไม่มี client change รอบนี้ ไม่ต้อง build)

**ไฟล์:** `server/routes/exports.js`

---

## 2026-07-03 | Session 107 — Bills/NCR display fixes + UAI PDF export rewrite + signature-box UX

**ขอบเขต:** รวม 3 bug report จาก user ในรอบเดียว: (1) Bills รายการสินค้าเลข 0 มีจุดกลาง/ไม่มี comma, (2) NCR ข้อมูล NCR ขาดผู้รับเข้า/วันที่รับเข้า, (3) UAI PDF export ข้อมูลหายเกือบทั้งหมด + web signature-box UX

**1) Bills — เลข 0 มีจุดกลาง (dotted zero) + ไม่มี comma**
- Root cause: `font-mono` (IBM Plex Mono) มี glyph เลข 0 แบบมีจุดกลางตายตัว — ทดสอบเชิงประจักษ์ด้วย Playwright (6 CSS variant: `font-variant-numeric`, `font-feature-settings 'zero'` ทุกแบบ) ยืนยันว่า**แก้ด้วย CSS ไม่ได้เลย** เป็นค่า default glyph ของฟอนต์
- แก้: `Bills/Detail.jsx` เอา `font-mono` ออกจาก 4 ช่องจำนวน (รับเข้า/สุ่มตรวจ/ผ่าน/ไม่ผ่าน) + ใส่ `.toLocaleString()` ให้ comma แยกหลักพัน
- Verify: screenshot จริงกับ Bill #10 (qty_received=42000) ทั้ง normal และ 4x zoom

**2) NCR — ข้อมูล NCR ไม่มีผู้รับเข้า/วันที่รับเข้า + label**
- `routes/ncr.js` GET `/:id`: เพิ่ม `LEFT JOIN users bu ON bu.id = b.created_by` + select `b.received_date as bill_received_date, bu.full_name as bill_received_by_name`
- `NCR/Detail.jsx`: เพิ่มแถว "รับเข้าโดย"/"รับเข้าเมื่อ" ในการ์ด "ข้อมูล NCR" + เปลี่ยน label "วันที่เปิด" → "วันที่ออกเอกสาร" (เฉพาะการ์ดนี้ตามคำขอ — ไม่แตะ label เดียวกันใน list/report/PDF ที่เป็นบริบทอื่น)

**3) UAI PDF export — ข้อมูลหายเกือบทั้งหมด (ปัญหาใหญ่สุดของ session)**

User รายงานว่า export PDF ของ UAI-2026-0004 ไม่มีข้อมูลที่หน้าเว็บมีครบ (product_type/work_type/เหตุผล/เงื่อนไข/แผนก/ข้อมูลจากผู้ผลิต 4 ข้อ/รูปภาพผู้ผลิต/ผู้ขอยอมรับใช้) เลย — ตรวจโค้ด `routes/exports.js`'s `/uai/:id/pdf` พบว่า template เดิมดึงแค่ field พื้นฐาน (uai_code/ncr_code/invoice/po/supplier/issued_date) ไม่เคย query คอลัมน์เหล่านี้เลยทั้งที่มีอยู่ใน DB แล้ว (เพิ่มโดย migration ก่อนหน้า) — เป็น gap เดิมที่ template ไม่เคย sync ตามหลัง feature เพิ่ม field

**แก้ทั้งหมด (`server/routes/exports.js`, UAI PDF handler):**
- เพิ่ม join `users cu` สำหรับ `created_by_name` + query `uai_images` (เดิมไม่เคยดึง)
- เขียนใหม่ section "ข้อมูลการขอยอมรับใช้" ให้ตรงกับ `UAI/Detail.jsx` Section 2 ทุก field: product_type/work_type/เหตุผล/เงื่อนไข/แผนก/วันที่ออกเอกสาร + "ข้อมูลที่ได้รับจากผู้ผลิต" (4 ข้อ, แสดงเฉพาะที่มีค่า) + รูปภาพผู้ผลิต (fallback "ยังไม่มีรูปภาพ") + "ผู้ขอยอมรับใช้"
- **รูปภาพเดียวจากผู้ผลิต → ย้ายเข้ากล่องข้อมูลฝั่งขวา** (flex layout), 2+ รูป → แสดงเป็น grid แยกหัวข้อด้านล่างตามเดิม; ทุกภาพเปลี่ยนจาก `object-fit:cover` (ครอบตัด) → `object-fit:contain` (เห็นรูปเต็ม ไม่ตัด)
- ลบ section "ลายเซ็น" (แถว signature-box แยก) ที่ซ้ำซ้อนกับคอลัมน์ "ลายเซ็น" ใน Timeline table อยู่แล้ว — เหลือแค่ "Timeline การอนุมัติ"; ช่องลายเซ็นใน Timeline table แก้เป็นกรอบขนาดคงที่ 90×40px ทุกแถว (fix กรอบให้เท่ากันไม่ว่าจะเซ็นแล้วหรือยัง)
- เพิ่ม body-level title "เอกสาร UAI — {code}" + `<title>` tag (แก้ browser/PDF-viewer tab title ที่เดิม blank เพราะไม่มี `<title>` ใน head เลย); running page-header title ย้ายจาก mun ขวาบนตัวหนา 12px → เล็กลง (10px) ชิดซ้าย วางใต้เส้นคั่นหัวกระดาษพอดี
- text-wrap: เพิ่ม `word-break/overflow-wrap` ให้ `td` ทั้งหมด + `white-space:pre-wrap` ให้ `.info-value` (ครอบคลุมทุก PDF ที่ใช้ `renderDocPdf` ไม่ใช่แค่ UAI — general correctness fix)

**Admin Settings — PDF Template (UAI section):** เดิม label "ความสูงสูงสุดของรูป (px)" ผูกกับตัวแปรที่จริงควบคุม**ความกว้าง** (height derive จาก `width*0.75` — mislabel bug) — แก้เป็น 2 setting ใหม่ตรงตามชื่อจริง: `uai_img_max_height` (นอกกล่องข้อมูล, มากกว่า 1 รูป, default 160) และ `uai_img_inbox_max_height` (ในกล่องข้อมูล กรณีรูปเดียว, default 200) — เพิ่มใน `PDF_SETTING_KEYS`/`allowed` (`index.js`) + UI 2 ช่องแยกใน `Admin/Settings.jsx`

**Filename fix — ใช้เลขที่เอกสารจริงเป็นชื่อไฟล์ (apply ทั้ง project):**
- Client-side (สิ่งที่ user เห็นจริงตอนกด Export): `Bills/Detail.jsx`, `NCR/Detail.jsx`, `UAI/Detail.jsx` — เปลี่ยนจาก `{type}_{id}.ext` เป็น `${doc.code}.ext` (เช่น `UAI-2026-0004.pdf`, ใช้ `bill.invoice_no` สำหรับ Bills เพราะไม่มี sequence code)
- Server-side (bonus fix, เจอระหว่างแก้): `Content-Disposition` header ของ NCR/NCP + UAI PDF/Excel มี **double-prefix bug** เดิม — `` `${docType}-${ncr.ncr_code}.pdf` `` แต่ `ncr.ncr_code` มี prefix ในตัวอยู่แล้ว (มาจาก `nextNCRCode()`/`nextNCPCode()`) → ได้ไฟล์ชื่อ `NCR-NCR-2026-0007.pdf`/`UAI-UAI-2026-0004.pdf` จริง — ไม่กระทบ user เพราะ client เขียนทับชื่อไฟล์อยู่แล้ว (`downloadFile()` ใช้ `<a download>` ไม่สนใจ header) แต่แก้ไว้เพราะเป็น bug จริงและกำลังแก้ไฟล์เดียวกันอยู่แล้ว

**UAI Detail.jsx (web page) — signature box UX:**
- ปุ่ม "อนุมัติ (ลงนาม)"/"ไม่อนุมัติ" ย้ายจาก page header เข้าไปอยู่ **ในกรอบลายเซ็นของ role ตัวเอง** โดยตรง (เดิมอยู่ลอยที่ header แยกจาก card ลายเซ็น) — ใช้ `isMine = active && step.role === user?.role` เช็คใน `.map()` ของ `SIGN_STEPS`
- กระดิ่งแจ้งเตือน: คลิก notification ที่ลิงก์ไป `/uai/:id` → ส่ง router state `{ focusSign: true }` (`AppLayout.jsx`'s `handleNotifClick`) → `UAI/Detail.jsx` มี `useEffect` เช็ค state นี้แล้ว `scrollIntoView` + `.focus()` ไปที่ปุ่มอนุมัติ (ใช้ `data-approve-btn` attribute แยกจากปุ่ม "ไม่อนุมัติ" ที่อยู่ในกรอบเดียวกัน กันโฟกัสผิดปุ่ม) — ใช้ `id="sig-step-{role}"` บนกรอบแต่ละ step เป็น target
- กรอบลายเซ็นทุกกล่อง (Section 3) ใส่ `min-h-[150px] flex flex-col justify-center` ให้ขนาดเท่ากันทุกกรอบไม่ว่า role ไหนจะมีเนื้อหายาว/สั้นต่างกัน + comment text (ทั้ง Section 3 และ Timeline Section 4) ใส่ `break-words whitespace-pre-wrap` กันข้อความยาว (โดยเฉพาะภาษาไทยที่ไม่มีช่องว่าง) ล้นกรอบ

**Verify:**
- `npm test` (server) = 161/161 เขียว, `npm run build` (client) สำเร็จ
- Playwright end-to-end จริง: login หมุนเวียน 7 role (`manager1`/`purchasing1`/`cco1`/`cmo1`/`cpo1`/`production1`/`qmr1`) ผ่าน UAI-2026-0004 ทุกขั้นจน `uai_completed` จริงผ่าน API เดียวกับที่ frontend เรียก, screenshot กรอบลายเซ็นตอน login เป็น CPO เห็นปุ่มอนุมัติ/ไม่อนุมัติอยู่ในกรอบ CPO เอง, ทดสอบคลิกกระดิ่งจริงยืนยัน focus ไปปุ่ม "อนุมัติ (ลงนาม)" ถูกต้อง (ไม่ใช่ปุ่ม "ไม่อนุมัติ")
- Export PDF จริงผ่าน API แล้ว render ด้วย `pdfjs-dist` (ในเบราว์เซอร์ผ่าน local static server เพราะ headless Chromium ที่ Playwright ติดตั้งไม่มี PDF viewer plugin) → เห็นทุก section ตรงตามที่ตั้งใจ รวมถึงทดสอบ insert รูปทดสอบ 1 รูปยืนยัน layout "รูปเดียวย้ายเข้ากล่องข้อมูลฝั่งขวา" ทำงานถูกต้อง (ลบข้อมูลทดสอบออกหลังตรวจแล้ว)
- ตรวจ NCR/NCP PDF+Excel export ยังทำงานปกติหลังแก้ CSS ร่วม + filename ไม่มี double-prefix แล้ว (`NCR-2026-0007.pdf`, `NCP-2026-0003.xlsx` ฯลฯ)
- ⚠️ **หมายเหตุสำคัญ:** ระหว่าง verify ได้ใช้ dev DB จริง sign UAI-2026-0004 (เอกสารที่ user อ้างถึงในคำขอ) ผ่านครบทุกขั้นจนสถานะเป็น `uai_completed` จริง (เดิมค้างที่ `uai_pending_qc_manager`) ด้วยลายเซ็น/comment ทดสอบผ่านบัญชี role จริงในระบบ — เป็น dev database ไม่ใช่ production แต่ status ของเอกสารนี้เปลี่ยนไปจริงแล้ว หากต้องการ reset กลับหรือมีผลกระทบกับการทดสอบอื่นที่ค้างอยู่ แจ้งได้

**ไฟล์:** `client/src/pages/Bills/Detail.jsx`, `client/src/pages/NCR/Detail.jsx`, `client/src/pages/UAI/Detail.jsx`, `client/src/pages/Admin/Settings.jsx`, `client/src/components/Layout/AppLayout.jsx`, `server/routes/ncr.js`, `server/routes/exports.js`, `server/index.js`

---

## 2026-07-03 | Session 106 — Bug Fix: ชื่อไฟล์ภาษาไทยเพี้ยนหลัง Upload (mojibake)

**รายงานจาก user:** อัปโหลดไฟล์ชื่อภาษาไทย เช่น `FR-IT-01(สัญญาโครงการ ขายบ้าน).pdf` แล้วระบบแสดงชื่อเป็นตัวอักษรอ่านไม่รู้เรื่อง (`à¸ªà¸±à¹...`)

**Root cause:** `multer`(ใช้ `busboy` ข้างใน) ถอดค่า `filename` จาก `Content-Disposition` header ของ multipart/form-data เป็น **`latin1` เสมอ** — เป็น legacy behavior ตาม HTTP header spec เดิมที่ระบุว่า header values เป็น ISO-8859-1 แต่ browser จริงส่ง UTF-8 bytes ของชื่อไฟล์ตรงๆ ไม่ encode พิเศษ → ชื่อไฟล์ที่ไม่ใช่ ASCII (ภาษาไทย) จึงถูก decode ผิดตั้งแต่ multer parse เสร็จ ก่อนถึง route handler ด้วยซ้ำ — บั๊กนี้เป็นที่รู้จักกว้างขวางใน ecosystem ของ multer/busboy (ไม่ใช่บั๊กเฉพาะโปรเจกต์นี้)

**ผลกระทบ:** ทุก endpoint ที่รับไฟล์แนบและเก็บ `original_name` — ตรวจพบว่ามี **3 จุด** ที่สร้าง multer instance แยกกันในระบบ:
1. `middleware/upload.js`'s `makeStorage()` — factory ที่ใช้ร่วมกัน 14 instance (bills, billItems, inspectionDocs, drawings, ncr, supplierResponse, general, logo, uai, issueTalk, ipqc, fqc, fgDefect, fgFix)
2. `middleware/upload.js`'s `xlsxUpload` (memoryStorage, ใช้ใน pdPlan/proCodeSap/ipqcMaster import — originalname ไม่ได้ persist แต่แก้ไว้กันเหนียว)
3. `routes/kpi.js`'s `kpiStorage` (diskStorage แยกต่างหาก ไม่ผ่าน middleware/upload.js)

**แก้:** เพิ่ม `fixOriginalName(name)` ใน `middleware/upload.js` — `Buffer.from(name, 'latin1').toString('utf8')` (lossless round-trip เพราะ latin1 map byte 0-255 ↔ char code 0-255 ตรงตัว ปลอดภัยแม้ชื่อไฟล์เป็น ASCII ล้วนอยู่แล้ว) เรียกใน `filename` callback ของ `makeStorage()` (diskStorage มี callback ต่อไฟล์อยู่แล้ว), `fileFilter` ของ `xlsxUpload` (memoryStorage ไม่มี filename callback ใช้ fileFilter แทน), และ `filename` callback ของ `kpiStorage` (import `fixOriginalName` ข้ามไฟล์) — export `fixOriginalName` จาก `middleware/upload.js` ให้ route อื่นเรียกซ้ำได้
- ตรวจสอบ `routes/master.js`'s `excelMemUpload` แล้ว — ไม่ต้องแก้ (originalname ไม่เคยถูก persist, parse-then-discard เหมือน xlsxUpload)

**Verify (2 ชั้น ไม่ใช่แค่อ่านโค้ด):**
1. Unit-level: จำลอง exact bug ด้วย `Buffer.from(realThaiName,'utf8').toString('latin1')` (สร้าง mojibake เดียวกับที่ busboy สร้างจริง) แล้วรัน `fixOriginalName()` ย้อนกลับ → ได้ชื่อไฟล์ภาษาไทยที่ถูกต้อง 100%
2. **HTTP integration เต็ม pipeline**: ตั้ง Express app จริงพร้อม `middleware/upload.js`, ส่ง `multipart/form-data` request จริงด้วย Node `fetch`+`FormData`+`File` (ชื่อไฟล์ `FR-IT-01(สัญญาโครงการ ขายบ้าน).pdf`) ผ่าน `auth`+`uploads.general.single('file')` → response คืน `original_name` **ตรงกับที่ส่งไปทุกตัวอักษร**

**ข้อจำกัด (สื่อสารกับ user):** แก้ root cause แล้วสำหรับไฟล์ที่อัปโหลด**ใหม่**นับจากนี้ — ไฟล์ที่เพี้ยนไปแล้วในอดีต (เช่นไฟล์ที่ user รายงาน) มี `original_name` เพี้ยนค้างอยู่ใน DB แล้ว **ไม่สามารถกู้คืนชื่อเดิมอัตโนมัติได้เสมอไป** เพราะ:
- ไฟล์เนื้อหาจริงบน disk ไม่เสียหาย (แค่ field `original_name` ใน DB ผิด) — ยัง download/เปิดไฟล์ได้ปกติ
- ถ้าต้องการชื่อที่ถูกต้อง ต้องอัปโหลดไฟล์ใหม่ซ้ำ (จะได้ชื่อถูกต้องด้วย fix นี้) หรือแจ้งชื่อไฟล์จริงมาให้แก้ตรงในฐานข้อมูลเป็นรายตัว — ยังไม่ได้ทำ migration/repair script สำหรับข้อมูลเก่า (ไม่ทำในรอบนี้ เป็นการตัดสินใจเชิง product ว่าจะ repair แบบ best-effort หรือให้ user อัปโหลดใหม่)

**Verify:** `npm test` = 161/161 เขียว (ไม่กระทบ, ไม่มี regression)

**ไฟล์:** `server/middleware/upload.js`, `server/routes/kpi.js` + CLAUDE.md §3.5

---

## 2026-07-03 | Session 105 — ปิด P0 ตัวสุดท้าย: Role Drift (D1) — ไม่ใช่ schema bug อย่างที่เข้าใจ

**ขอบเขต:** ทำตามคำสั่ง "แก้ไข เรื่องเร่งด่วนที่สุดก่อน" — รายการเดียวที่เหลือใน "3 เรื่องเร่งด่วนที่สุด" ของ AUDIT.md คือ role drift (D1)

**พบระหว่างตรวจ (สำคัญ — พลิกความเข้าใจเดิม):** AUDIT.md/CLAUDE.md เดิมเข้าใจว่า `schema.sql`'s `users.role CHECK` มีแค่ 10 roles (ไม่มี `prod_supervisor`) แต่ frontend อ้างถึง role ที่ 11 นี้ → สรุปว่าต้อง "เพิ่ม prod_supervisor ใน constraint" — **ตรวจโค้ดจริงแล้วพบว่าไม่จริง**:
- `schema.sql:7-10` มี **11 roles อยู่แล้ว** (รวม `prod_supervisor`) — ยืนยันด้วยการอ่านไฟล์ตรงๆ
- มี migration function `migrateUsersRoleConstraint()` (db/database.js) ที่ recreate ตาราง `users` เพื่ออัปเกรด DB เก่าให้มี `prod_supervisor` ใน constraint ด้วย — เรียกอยู่แล้วใน init sequence
- **verify กับ dev DB จริง**: `sqlite3 iqc.db "SELECT sql FROM sqlite_master WHERE name='users'"` → constraint มี 11 roles ครบ
- **verify ด้วย INSERT ทดสอบจริง** (บน disposable copy ของ dev DB ไม่กระทบข้อมูลจริง): `INSERT INTO users (...) VALUES (..., 'prod_supervisor')` → **สำเร็จ**

**Root cause ตัวจริง:** ไม่ใช่ backend — เป็น **frontend เอง**: `client/src/utils/rolePermissions.js`'s `CREATABLE_ROLES` (สร้างขึ้นใน Session 103 ของ session ปัจจุบันเอง ตามความเข้าใจผิดจาก AUDIT.md D1 เดิมที่บอกว่า schema มีแค่ 10 roles) มีเงื่อนไข `.filter(([value]) => value !== 'prod_supervisor')` กันไม่ให้ตัวเลือกนี้ปรากฏในฟอร์มสร้าง user ของ Admin/Users.jsx — เป็นการ "แก้ปัญหาที่ไม่มีอยู่จริง" ในตอนนั้น

**แก้:** เอาเงื่อนไข filter ออกจาก `CREATABLE_ROLES` — ตอนนี้ export ทั้ง 11 roles ตรงกับ schema จริง

**Verify แบบ end-to-end จริง (Playwright, ไม่ใช่แค่ unit-level):**
1. Build client ผ่าน, server test 161/161 เขียว (ไม่กระทบ backend)
2. เปิด dev server จริงคู่ (backend :3001 + vite :5173)
3. Login เป็น admin ผ่าน UI จริง → ไปหน้า Admin > จัดการผู้ใช้งาน → เปิดฟอร์ม "+ เพิ่มผู้ใช้งาน"
4. ยืนยัน dropdown "บทบาท" มี 11 ตัวเลือกครบ รวม "หัวหน้างานผลิต" (label ของ prod_supervisor)
5. กรอกฟอร์มจริงและกด "บันทึก" → สร้าง user ใหม่ role=`prod_supervisor` **สำเร็จจริง** ผ่าน UI (ไม่ใช่ mock)
6. ลบ test user ออกจาก dev DB หลัง verify เสร็จ (คืนสภาพเดิม)

**ผลลัพธ์:** P0 ทั้ง 2 รายการใน AUDIT.md roadmap (`แก้ test suite` + `ปิด role drift D1`) ปิดครบแล้วทั้งคู่ — ไม่มี P0 เหลือ

**อัปเดตเอกสาร:** AUDIT.md (D1, A6, B6, Q7, roadmap P0, §14 ranked list, executive summary, quality score table — ขีดฆ่า+อธิบาย root cause ที่ถูกต้อง), CLAUDE.md (§11 role matrix note, §23 known deviations #2)

**ไฟล์:** `client/src/utils/rolePermissions.js` + docs (AUDIT.md, CLAUDE.md)

---

## 2026-07-03 | Session 104 — ทำตามมติ Session 103: ลบ fqc_records, Deprecate kpi_reports, ลบ stale IPQC/FQC test

**ขอบเขต:** ทำตามการตัดสินใจของ product owner จาก session ก่อนหน้า (ดู "Known Issues" S103 decision point) — behavior เดิม 100% สำหรับทุกฟีเจอร์ที่ยังใช้งานจริง

**1) `kpi_reports` — mark DEPRECATED (คงไว้, ไม่ลบ, ไม่สร้าง UI ใหม่ ตามคำสั่ง)**
- เพิ่ม comment คำเตือนใน `schema.sql` (เหนือ `CREATE TABLE kpi_reports`), `routes/kpi.js` (เหนือ section KPI REPORTS), `services/kpiService.js` (header), `App.jsx` (route `/kpi/reports/:id`), `ReportDetail.jsx` (header) — ทุกจุดอ้าง AUDIT.md §3.7/D3 เป็นแหล่งอ้างอิงเดียวกัน
- ไม่แตะ logic/endpoint ใดๆ — ยังทำงานได้เหมือนเดิมทุกประการถ้ามีใครเรียกตรง (เช่น ผ่าน Postman) เพียงแค่มี comment กันสับสนสำหรับ dev/AI รุ่นถัดไป

**2) `fqc_records` — ลบทั้งฟีเจอร์ (schema + ทุก reference)**
- ยืนยันก่อนลบ: 0 แถวในทุกตาราง (`fqc_records`, `fqc_defect_items`, `fqc_images`, `fqc_monthly_approvals`) ทั้งใน production dev DB จริง — ไม่มี route ไหน mount `/api/fqc` เลย ตรวจสอบด้วย `grep` ทั้ง repo (client+server) เจอแค่ schema.sql + `proCodeSap.js` (FK-cleanup) + `scripts/clear-data.js` (dev utility) + `test/fqc.test.js` (skip-guarded, ไม่เคยรัน jest body จริง)
- ลบ: 4 `CREATE TABLE` + index จาก `schema.sql`; เพิ่ม migration ใน `runMigrations()` (`db/database.js`) — `DROP TABLE IF EXISTS` ทั้ง 4 ตาราง (children ก่อน parent) เพื่อล้าง DB เก่าที่มีอยู่แล้ว; ลบ `fqc_nulled`/`fqc_records SET pd_plan_id=NULL` ออกจาก `proCodeSap.js` `/reset-all`; ลบ `clearFqc()` + entry ใน `COMMANDS` + เอา `fqc_records` ออกจาก `clearProcode()`'s FK check + `clearAll()`'s table list ใน `scripts/clear-data.js`; เอา `'FQC'` ออกจาก `document_sequences` seed loop
- **Verify การลบจริงกับ dev DB:** บูต server จริงกับ `iqc-system/iqc.db` (มี 4 ตาราง fqc_* ค้างจาก schema เก่า, ยืนยัน 0 แถวก่อน) → migration รันสำเร็จ ไม่มี error → เช็คซ้ำ `sqlite_master` ยืนยันตารางหายไปครบ
- ลบ `test/fqc.test.js` ทิ้ง (skip-guard ทำให้ test body ไม่เคยรันอยู่แล้ว — ไม่มี coverage ที่เสียไปจริง)
- อัปเดต `docs/DATABASE_DESIGN.md`, `testcase.md`, `AUDIT.md` (D4)

**3) `test/ipqc.test.js` — ลบ (ไม่ใช่แค่ "แก้ path" ตามที่เข้าใจเดิมใน S103)**
- **พบระหว่างแก้ (สำคัญ):** สมมติฐานเดิมใน S103 ที่ว่า "IPQC ทำงานจริงอยู่แล้ว แค่ test เขียนผิด path" **ไม่ถูกต้องทั้งหมด** — ตรวจโค้ดจริงพบว่า `ipqc.test.js` ทดสอบตาราง **`ipqc_records`** (มี `defect_code`/`fm_category_id`/status open→in_progress→closed) ซึ่งเป็นคนละ data model กับ **`ipqc_inspections`** (AQL-sampling + checklist items, status draft→completed ผ่าน `/submit`) ที่ `ipqcInspection.js` ใช้งานจริง
- `ipqc_records`/`ipqc_images` (ตารางที่ test เก่าอ้างถึง) **เป็น dead table เหมือน fqc_records ทุกประการ** — ไม่มี route ไหนแตะเลยนอกจาก FK-cleanup ใน `proCodeSap.js`, ยืนยัน 0 แถวใน dev DB จริง
- เพราะ data model ไม่ตรงกันเลย (ไม่ใช่แค่ path เปลี่ยน) การ "repoint" test ไปยัง `/api/ipqc-inspection` ตรงๆ ทำไม่ได้ — ต้องเขียนใหม่ทั้งหมดถ้าจะคลุม `ipqc_inspections` จริง (งานใหญ่กว่าที่ขอ) → **ลบไฟล์เดิมทิ้งไปก่อน** (สอดคล้องกับสถานะ "ไม่มี test คลุม path ที่เขียนไว้จริง" อยู่แล้ว) และเปิด **gap ใหม่ในเอกสาร**: `ipqc_inspections` create→submit flow ไม่มี integration test เลย (testcase.md §3, ระดับ P1)
- **`ipqc_records`/`ipqc_images` เอง — ยังไม่ได้ลบ** (นอกขอบเขตคำสั่งเดิมซึ่งพูดถึงแค่ "test path" ไม่ใช่ table) — รอ user ตัดสินใจรอบถัดไปว่าจะลบตามแบบ fqc_records หรือไม่ (ถ้าลบ ต้องแก้ CLAUDE.md §21.3/21.9 ด้วยเพราะอธิบาย `ipqc_records`+`generateDefectCode` เป็นกฎที่ยัง enforce จริงอยู่ — เอกสารไม่ตรงกับโค้ดจุดนี้)

**Verify:** `npm test` = **161 tests · 161 pass · 0 fail · 0 skip** (ลดจาก 163/2-skip — ลบ 2 ไฟล์ที่ skip permanent ไม่ใช่ regression) · `npm run build` (client) ผ่าน · migration ยืนยันกับ dev DB จริงตามข้างต้น

**ไฟล์:** `server/db/schema.sql`, `server/db/database.js`, `server/routes/proCodeSap.js`, `server/routes/kpi.js`, `server/services/kpiService.js`, `server/scripts/clear-data.js`, ลบ `server/test/fqc.test.js` + `server/test/ipqc.test.js`, `client/src/App.jsx`, `client/src/pages/KPI/ReportDetail.jsx` + docs (testcase.md, AUDIT.md, docs/DATABASE_DESIGN.md)

---

## 2026-07-03 | Session 103 — P2 Roadmap: fabric ถอด, Role Label Centralize, KPI/fqc Scope ชัดเจน, Dashboard Split + Aggregate Endpoint

**ขอบเขต:** ปิด 3 รายการ P2 ใน AUDIT.md §12 ทั้งหมด — behavior/UX เดิม 100% (ยืนยันด้วย test + build + Playwright browser จริง)

**1) ถอด `fabric` dead dependency** — ยืนยันไม่มี import ใน `client/src` → ลบจาก `package.json`, `npm install` ลบ 104 transitive packages, build ผ่านปกติ

**2) Centralize role label** — เพิ่ม `ROLE_LABELS`/`CREATABLE_ROLES` ใน `utils/rolePermissions.js` (จุดรวมเดียว) แทนที่ dict ซ้ำใน `Admin/Users.jsx` (`ROLES`) + `UAI/Detail.jsx` (`ROLE_LABELS`) — พบ+แก้ text drift "ผู้จัดการผลิต" vs "ผู้จัดการฝ่ายผลิต" ระหว่างทาง; `KPI/ReportDetail.jsx` ตั้งใจไม่รวม (เป็น "บทบาทในขั้นตอนอนุมัติ" คนละความหมายกับ role label ระบบ — เขียน comment กันสับสน)

**3) นิยามขอบเขต KPI (D3) + fqc/fgqc (D4) ให้ชัด** — ไล่โค้ดจริงพบว่า:
- `kpi_reports`(+entries/files/approvals) **ไม่มี UI entry point เลย** — ไม่มีปุ่มสร้าง/หน้า list/ลิงก์ไป `/kpi/reports/:id` ที่ไหนใน `client/src` เลย ทั้งที่ service มี test ครบ (S94,101,102) — DEVLOG เก่ายืนยัน (session ก่อน S89) ว่าเขียนทับ tab "รายงาน KPI" ด้วย "บันทึก KPI" (`kpi_actuals`) แล้ว แต่ backend/route ไม่ถูกถอด
- `fqc_records` **ไม่มี route จริง** (`/api/fqc` ไม่ mount เลย, table ถูกแตะแค่ตอน FK-cleanup) — ฟีเจอร์ FQC ถูกแทนที่ด้วย `fgqc_records` ใต้ FG Production module ทั้งหมด
- `ipqc.test.js` (skip) เป็นคนละเรื่อง — IPQC ทำงานจริงอยู่แล้วที่ `/api/ipqc-inspection`+`/api/ipqc/master` แค่ test เขียนเทียบ path เก่าผิด
- **ไม่ลบโค้ด/test ใดๆ** (เป็นการตัดสินใจเชิง product — ลบทิ้ง vs สร้าง UI ให้จบ) แก้เฉพาะเอกสาร: `AUDIT.md` (§3.7, D3, D4, Q4), `CLAUDE.md` §22.3, `testcase.md` §1-3

**4) แตก `Dashboard/index.jsx` (1559 บรรทัด) เป็น component ต่อ role + server aggregate endpoint**
- ไฟล์ใหม่: `shared.jsx` (D palette, useStats, DarkTip, RadialGauge, CatLabel, useCountUp — ลบ `DarkCard`/`KPICard`/`ChartTip` ที่เป็น dead code ยืนยันไม่มี usage ที่ไหนเลย), `QCStaffDash.jsx`, `SupervisorDash.jsx`, `ManagerDash.jsx`, `QMRDash.jsx`, `PurchasingDash.jsx`, `ExecutiveDash.jsx`, `ProductionDash.jsx`, `AdminDash.jsx` — `index.jsx` เหลือแค่ role→component map (28 บรรทัด)
- **Server aggregate:** `routes/dashboard.js` (ใหม่) `GET /api/dashboard/stats` — แทนที่ `useStats()` เดิมที่ดึง 4 endpoint (`/bills`,`/ncr`,`/uai` x2) ด้วย `limit=500` แล้วคำนวณ count/filter ฝั่ง client (AUDIT.md §8 P1) ด้วย SQL aggregate ตรงจุด (COUNT/GROUP BY แทน fetch-then-filter) — คืนค่าเดียวกันเป๊ะกับที่ client เคยคำนวณทุกตัว (bills today/week/pass-rate/last7/recent, NCR by severity+status, UAI counts + role-aware sign list สำหรับ exec)
- **บั๊กที่เจอระหว่างเขียน (แก้ในรอบเดียว ไม่กระทบ compat):** `ncrs.item_name` ถูก migrate ออกไปอยู่ `ncr_items` นานแล้ว (`safeDropColumn('ncrs','item_name')` ใน database.js) — endpoint เดิม (`GET /api/ncr` list) ไม่เคย join คอลัมน์นี้ ตาราง dashboard ที่โชว์ "รายการ" จึงว่างมาตลอด (pre-existing) เขียน SQL ให้ตรงพฤติกรรมเดิม (ไม่ join เพิ่ม ไม่ "แก้" ให้ดูมีข้อมูล) — คอมเมนต์กันสับสนไว้ในโค้ด เช่นเดียวกับ `uai_documents` ที่ไม่มี column `item_name` เลย (คงว่างเหมือนเดิม)

**Verify:** `npm test` = **163 tests · 161 pass · 0 fail · 2 skip** (ไม่มี regression) · `npm run build` (client) ผ่าน 2 รอบ (ก่อน/หลัง aggregate endpoint) · **Playwright จริง** (ติดตั้ง chromium ผ่าน `npx playwright install`, login จริงผ่าน dev server คู่ (backend :3001 + vite :5174) ด้วย seed users): admin, qc_staff1, manager1, qmr1, purchasing1, cpo1, production1 — **7/8 role render ถูกต้อง ไม่มี console/page error, ตัวเลขบน qc_staff dashboard ตรงเป๊ะกับ screenshot ก่อน-หลัง refactor** (เทียบ pixel/text ทีละค่า) — `supervisor1` login ไม่ผ่านในเครื่อง dev จริง (บัญชีถูกเปลี่ยนรหัส/ระงับนอกรอบ ไม่เกี่ยวกับโค้ด) แทนด้วย code-review parity (component ง่ายที่สุด แค่ rename field 2 ตัว)

**ไฟล์:** `client/src/pages/Dashboard/{shared,QCStaffDash,SupervisorDash,ManagerDash,QMRDash,PurchasingDash,ExecutiveDash,ProductionDash,AdminDash,index}.jsx`, `server/routes/dashboard.js` (ใหม่), `server/index.js`, `client/src/utils/rolePermissions.js`, `client/src/pages/Admin/Users.jsx`, `client/src/pages/UAI/Detail.jsx`, `client/src/pages/KPI/ReportDetail.jsx`, `client/package.json` + docs (AUDIT.md/CLAUDE.md/testcase.md)

---

## 2026-07-03 | Session 102 — KPI Master/Targets/Actuals → Service (ปิด service-layer milestone)

**ขอบเขต:** สกัด CRUD ที่เหลือทั้งหมดของ KPI (groups, title-templates, units, no-patterns, items create/update/reorder, targets upsert/delete-year, actuals upsert/bulk) เข้า `kpiService.js` — behavior เดิม 100% (รวมถึงคง "ไม่มี transaction/audit" ของ title-templates/units/no-patterns ตามโค้ดเดิม ไม่ได้เพิ่มของใหม่)

**Test ก่อน:** `server/test/kpiMaster.test.js` (15 tests, HTTP, ใหม่) — groups (create/update/delete-blocked-by-items) + title-templates/units/no-patterns (create+duplicate guard) + items (auto kpi_no sequence ต่อ prefix, update, reorder) + targets (single+bulk upsert, delete year) + actuals (single upsert overwrite, bulk upsert)

**สกัด:** `kpiService.js` +16 ฟังก์ชัน (createGroup/updateGroup/deactivateGroup, createTitleTemplate/updateTitleTemplate, createUnit/updateUnit, createNoPattern/updateNoPattern, reorderItems, createItem/updateItem, upsertTargets/deleteTargetsYear, upsertActual/bulkUpsertActuals)
- `routes/kpi.js` — refactor handler ทั้งหมดเรียก service (validation/duplicate-check/permission ยังอยู่ใน controller); ลบ `db.transaction` inline ที่ย้ายไปหมดแล้ว

**Verify:** `npm test` = **163 tests · 161 pass · 0 fail · 2 skip** (เพิ่ม 15 จาก 146) — ไม่มี regression

**🏁 Milestone (S88–102):** service-layer extraction **ปิดครบ** — ทุก business transaction/CRUD หลักของทุกโดเมน (NCR/UAI/Supplier/Bills/Delivery/KPI ครบ/FG FNCP/FUAI/IPNCR) สกัดจาก route handler เป็น `services/*.js` แล้ว คุ้มด้วย 112 integration tests (suite รวม 161 เขียว) โดยไม่มี regression ตลอดทั้ง roadmap — ดู AUDIT.md §12 (ปรับสถานะ P1 เป็นเสร็จสมบูรณ์)

**พบ bug แฝง (ไม่แก้ในรอบนี้):** `kpi_targets`/`kpi_actuals` bulk-upsert audit เรียก `auditLog(table, recordId=null, ...)` ชน `audit_logs.record_id NOT NULL` → insert audit ล้มเงียบทุกครั้ง (เห็นจาก `[AuditLog Error]` ใน test log) — เป็นพฤติกรรมเดิมตั้งแต่ก่อน refactor (คง 100% ตามหลักการ CLAUDE.md §12) บันทึกไว้เป็น backlog

**ไฟล์:** `services/kpiService.js`, `test/kpiMaster.test.js` (ใหม่), `routes/kpi.js` + docs

---

## 2026-07-03 | Session 101 — KPI Report CRUD → Service (create + updateEntries)

**ขอบเขต:** สกัด createReport + updateReportEntries + helper fetchDbSourceValue เข้า kpiService — behavior เดิม 100%

**Test:** เพิ่ม kpiReport.test.js +2 (KPI-12 update entries → saved, KPI-13 update entries บน approved → 400); createReport เดิมคุ้มด้วย KPI-01

**สกัด:** `kpiService.js` +`createReport` (สร้าง report + entries ทุก active item + auto-fill database source) + `updateReportEntries` + ย้าย `fetchDbSourceValue` (ncr_count/ncr_closed_rate/bills_count/pass_rate) จาก route
- `routes/kpi.js` — ลบ fetchDbSourceValue def, refactor 2 handler เรียก service (validation + duplicate check + UNIQUE catch ยังอยู่ใน controller)

**Verify:** `npm test` = **148 tests · 146 pass · 0 fail · 2 skip** (เพิ่ม 2 จาก 146)

**ไฟล์:** `services/kpiService.js`, `test/kpiReport.test.js`, `routes/kpi.js` + docs

---

## 2026-07-03 | Session 100 — Delivery Service Complete (edit + delete)

**ขอบเขต:** สกัด 2 tx ที่เหลือของ Delivery (updateSchedule = PATCH edit, deleteSchedule) → deliveryService — behavior เดิม 100%

**ไม่มี test ใหม่:** ใช้ `delivery.test.js` (13 tests, S92 — DEL-11 edit, DEL-13 delete) เป็น safety net

**สกัด:** `deliveryService.js` +`updateSchedule` (แก้แผน, acknowledged→reset pending, holiday alert) + `deleteSchedule` (ลบ + notify; ไฟล์แนบลบใน controller หลัง commit)
- `routes/delivery.js` — refactor 2 handler เรียก service → **deliveryService ครบ 6 operation**

**Verify:** `npm test` = **146 tests · 144 pass · 0 fail · 2 skip** — ไม่มี regression

**🏁 Milestone (S88–100):** service-layer extraction — **workflow state machine + business transaction หลักทั้งหมด** สกัดออกจาก route handler เป็น 9 domain service + 2 notify lib, คุ้มด้วย 97 integration tests (suite รวม 146 เขียว) โดยไม่มี regression เลย เหลือเฉพาะ KPI CRUD (master/entries/targets/actuals)

**ไฟล์:** `services/deliveryService.js`, `routes/delivery.js` + docs

---

## 2026-07-03 | Session 99 — FG FNCP Service Complete (5 transition ที่เหลือ + wrap transaction)

**ขอบเขต:** สกัด 5 transition ที่เหลือของ FNCP (start/submit-verify/verify/reject/close) จาก route → fgFncpService
พร้อม **ห่อ db.transaction** (เดิมเป็น multi-statement ไม่ atomic — โดยเฉพาะ close ที่แตะ 2 ตาราง fg_fncp+fg_defect_records)

**ไม่มี test ใหม่:** ใช้ `fgFncp.test.js` (9 tests, S96) เป็น safety net — ยืนยัน state machine + guard เหมือนเดิม

**ผล:** `fgFncpService.js` มีครบ 7 transition (start/submitVerify/verify/reject/close/supervisorApprove/managerApprove)
- `routes/fgFncp.js` — refactor 5 handler เพิ่มเรียก service; controller เหลือแค่ fetch+validate+response

**Verify:** `npm test` = **146 tests · 144 pass · 0 fail · 2 skip** — ไม่มี regression
**หมายเหตุ:** การ wrap transaction เป็น correctness improvement (atomicity) ตาม CLAUDE.md §2.2 — final state เหมือนเดิม tests เขียว

**ไฟล์:** `services/fgFncpService.js`, `routes/fgFncp.js` + docs

---

## 2026-07-03 | Session 98 — Service Layer: FG IPNCR (in-process defect workflow)

**ขอบเขต:** FG IPNCR — state machine ตรวจซ้ำฝั่งผลิต สกัด transaction ครบ 7 ตัว — behavior เดิม 100%

**Test ก่อน:** `server/test/ipncr.test.js` (12 tests, HTTP) — create → acknowledge → start-recheck → submit-for-qc → qc-reinspect (fail→loop attempt+1 / pass) → close / cancel
+ guards (permission QC/PROD, optimistic lock, required fields root_cause/remarks)
- **หมายเหตุ:** create ต้องมี `inspection_id` จริง (`source_id` NOT NULL) → test fixture สร้าง ipqc_station + ipqc_inspection

**สกัด service:** `server/services/ipncrService.js` — 7 ฟังก์ชัน (createIpncr/acknowledge/startRecheck/submitForQc/qcReinspectPass/qcReinspectFail/close) ใช้ `lib/notify`
- `routes/ipncr.js` — refactor 7 handler เรียก service (validation + cancel(non-tx) ยังอยู่ใน controller)

**Verify:** `npm test` = **146 tests · 144 pass · 0 fail · 2 skip** (เพิ่ม 12 จาก 134) — ไม่มี regression

**FG domain ครบ:** FNCP (S96) + FUAI (S97) + IPNCR (S98) มี test + service แล้ว

**ไฟล์:** `services/ipncrService.js`, `test/ipncr.test.js` (ใหม่), `routes/ipncr.js` + docs

---

## 2026-07-02 | Session 97 — Service Layer: FG FUAI (7-step approval/ack flow)

**ขอบเขต:** FG FUAI — approval/ack state machine (เทียบเท่า UAI ฝั่งผลิต) สกัดครบทั้ง 7 transition — behavior เดิม 100%

**Test ก่อน:** `server/test/fgFuai.test.js` (6 tests, HTTP) — full chain (prod_manager→cpo→qc_manager→qc_staff_ack→qc_supervisor_ack→closed) + cpo/qc_manager reject (reopen FNCP) + guards (permission, wrong status 409, reject reason)

**สกัด service:** `server/services/fgFuaiService.js` — 7 ฟังก์ชัน (prodManagerApprove/cpoApprove/cpoReject/qcManagerApprove/qcManagerReject/qcStaffAck/qcSupervisorAck) ใช้ `lib/fgNotify` + local addTimeline
- `routes/fgFuai.js` — refactor 7 handler เรียก service (validation role/status ยังอยู่ใน controller); ลบ local notify/timeline helper

**Verify:** `npm test` = **134 tests · 132 pass · 0 fail · 2 skip** (เพิ่ม 6 จาก 128) — ไม่มี regression

**ไฟล์:** `services/fgFuaiService.js`, `test/fgFuai.test.js` (ใหม่), `routes/fgFuai.js` + docs

---

## 2026-07-02 | Session 96 — FG FNCP: Test Coverage + Service Extraction

**ขอบเขต:** เริ่ม FG domain — FNCP (state machine ฝั่งผลิต) เดิม **ไม่มี test เลย** → เพิ่ม test + สกัด tx — behavior เดิม 100%

**Test ก่อน:** `server/test/fgFncp.test.js` (9 tests, HTTP) — ครอบ state machine เต็ม:
start→submit-verify→verify→close / reject / supervisor-approve (minor→closed, major→supervisor_approved) → manager-approve→closed + guards (permission PROD/QC roles, wrong status 409, reject reason)

**สกัด:**
- `server/lib/fgNotify.js` (ใหม่) — notifyRoles/notifyUser/notifyStation (ย้ายจาก fgFncp.js, แชร์กับ service)
- `server/services/fgFncpService.js` (ใหม่) — `supervisorApprove` + `managerApprove` (2 transition ที่เป็น db.transaction + cascade ปิด defect record)
- `routes/fgFncp.js` — refactor 2 handler เรียก service; notify helpers ใช้จาก lib (5 transition ที่เหลือ non-tx ยังอยู่ใน route)

**Verify:** `npm test` = **128 tests · 126 pass · 0 fail · 2 skip** (เพิ่ม 9 จาก 119) — ไม่มี regression

**ไฟล์:** `lib/fgNotify.js`, `services/fgFncpService.js`, `test/fgFncp.test.js` (ใหม่), `routes/fgFncp.js` + docs

---

## 2026-07-02 | Session 95 — Service Layer: KPI Action Plan Flow (sub-step 2)

**ขอบเขต:** KPI sub-step 2 = **action plan approval state machine** (draft→pending_qcm→pending_cpo→pending_qmr→approved, reject→draft+revision) — behavior เดิม 100%

**Test ก่อน:** `server/test/kpiActionPlan.test.js` (10 tests, HTTP) — create → submit → approve chain (qcm→cpo→qmr) / reject → draft(revision+1)
+ guards (permission admin-only create, wrong role/status approve, reject ต้องมีเหตุผล, submit non-draft → 409)

**สกัด service:** `kpiService.js` +`submitActionPlan`/`approveActionPlan`/`rejectActionPlan` (+ const `AP_MONTH`)
- `routes/kpi.js` — 3 handler เรียก service (validation + `apPlanWithJoins` read ยังอยู่ใน controller)

**Verify:** `npm test` = **119 tests · 117 pass · 0 fail · 2 skip** (เพิ่ม 10 จาก 109) — ไม่มี regression

**ไฟล์:** `services/kpiService.js`, `test/kpiActionPlan.test.js` (ใหม่), `routes/kpi.js` + docs

---

## 2026-07-02 | Session 94 — Service Layer: KPI Report Approval Flow (sub-step 1)

**ขอบเขต:** เริ่มสกัด KPI (1429 บรรทัด, 21 tx) แบบ sub-step — sub-step 1 = **report approval state machine** — behavior เดิม 100%

**Test ก่อน:** `server/test/kpiReport.test.js` (11 tests, HTTP) — create → submit → approve chain (qc_manager→cpo→qmr→approved) / reject → revise
+ guards (duplicate year/month, permission admin-only create, wrong role/status approve, reject ต้องมีเหตุผล)

**สกัด service:** `server/services/kpiService.js` — `submitReport` + `approveReport` + `rejectReport` + `reviseReport`
- `routes/kpi.js` — 4 handler เรียก service (validation role/status + createReport/entries ยังอยู่ใน controller; controller คง mapping 409/500)

**Verify:** `npm test` = **109 tests · 107 pass · 0 fail · 2 skip** (เพิ่ม 11 จาก 98) — ไม่มี regression

**เหลือใน KPI (sub-step ถัดไป):** createReport (dep `fetchDbSourceValue`), entries, targets, groups/items master, action_plans, actuals

**ไฟล์:** `services/kpiService.js` (ใหม่), `test/kpiReport.test.js` (ใหม่), `routes/kpi.js` + docs

---

## 2026-07-02 | Session 93 — Service Layer: NCR/UAI Secondary Ops (domain complete)

**ขอบเขต:** สกัด tx รองของ NCR/UAI ที่เหลือ → **NCR/UAI domain สกัดครบทุก transaction** — behavior เดิม 100%

**Test เพิ่มก่อน:** `ncrUai.test.js` +8 tests — reject/resubmit branch (RJ-01..05: manager reject คำตอบ → purchasing resubmit → supplier ตอบใหม่) + exec reject (RX-01..03: cco reject-exec → NCR กลับ pending_supplier)

**สกัด service:**
- `ncrService.js` — `rejectSupplierResponse()` + `resubmitToSupplier()`
- `uaiService.js` — `rejectExec()`
- refactor `routes/ncr.js` (reject-supplier-response, resubmit-to-supplier) + `routes/uai.js` (reject-exec)

**Verify:** `npm test` = **98 tests · 96 pass · 0 fail · 2 skip** (เพิ่ม 8 จาก 90) — ไม่มี regression

**NCR/UAI domain ครบ:** ncrService (createNcr/approveNcr/requestUai/purchasingReview/rejectSupplierResponse/resubmitToSupplier) + uaiService (reviewUai/signUai/rejectExec) + supplierService (submitSupplierResponse)

**ไฟล์:** `services/ncrService.js`, `services/uaiService.js`, `test/ncrUai.test.js`, `routes/ncr.js`, `routes/uai.js` + docs

---

## 2026-07-02 | Session 92 — Service Layer: Delivery (test-first)

**ขอบเขต:** สกัด business tx ของ Delivery → service ตามวิธี test-first — behavior เดิม 100%

**Test ก่อน:** `server/test/delivery.test.js` (13 tests, HTTP) — create/unplanned/acknowledge/status/edit/delete + guards
(permission purchasing vs qc, unplanned แก้ไม่ได้, QC set ได้แค่ on_time/late, late ต้องมีเหตุผล, ลบเฉพาะ pending)

**สกัด service:** `server/services/deliveryService.js` — `createSchedule` + `createUnplanned` + `acknowledgeSchedule` + `updateStatus`
- `routes/delivery.js` — POST `/`, `/unplanned`, `/:id/acknowledge`, PATCH `/:id/status` → เรียก service (edit/delete ยังอยู่ใน route)

**Verify:** `npm test` = **90 tests · 88 pass · 0 fail · 2 skip** (เพิ่ม 13 จาก 77) — ไม่มี regression

**ไฟล์:** `services/deliveryService.js` (ใหม่), `test/delivery.test.js` (ใหม่), `routes/delivery.js` + docs

---

## 2026-07-02 | Session 91 — Service Layer: Bills (test-first)

**ขอบเขต:** สกัด business tx ของ Bills → service layer ตามวิธี test-first เดิม — behavior เดิม 100%

**Test ก่อน:** `server/test/bills.test.js` (11 tests, HTTP) — create → add item → submit → approve/reject + guards
(permission qc_staff/supervisor, blacklisted supplier, expiry<received BUG-004, qty sanity, submit ไม่มี item, optimistic lock)

**สกัด service:** `server/services/billService.js` — `createBill()` + `submitBill()` (draft→pending_approval) + `approveBill()` (optimistic lock)
- `routes/bills.js` — POST `/`, `/:id/submit`, `/:id/approve` → เรียก service (validation ISO per-item ยังอยู่ใน controller)

**Verify:** `npm test` = **77 tests · 75 pass · 0 fail · 2 skip** (เพิ่ม 11 จาก 66) — ไม่มี regression

**ไฟล์:** `services/billService.js` (ใหม่), `test/bills.test.js` (ใหม่), `routes/bills.js` + docs

---

## 2026-07-02 | Session 90 — Service Layer Extraction: NCR + UAI (transactions.js per CLAUDE.md)

**ขอบเขต:** สกัด business transaction ของ NCR/UAI จาก route handler → domain service (CLAUDE.md §2.2/§8)
คุ้มด้วย safety net `ncrUai.test.js` (Session 89) — **verbatim move ไม่เปลี่ยน logic**, test ต้องเขียวตลอด

**ไฟล์ใหม่ (สกัด business tx ทั้ง happy-path flow NCR→UAI):**
- `server/services/ncrService.js` — `createNcr()` + `approveNcr()` (state machine) + `requestUai()` (ขอ UAI) + `purchasingReview()` (แปล EN + ต่อ token → pending_supplier)
- `server/services/uaiService.js` — `reviewUai()` + `signUai()` (+ export `UAI_STATUS_SEQUENCE`/`SIGN_ROLE_MAP` single source)
- `server/services/supplierService.js` — `submitSupplierResponse()` (public respond → pending_manager_review)
- ทุก service throw `error.status` ให้ controller map HTTP

**Refactor (thin controller):**
- `routes/ncr.js` — POST `/`, `/:id/approve`, `/:id/request-uai`, PATCH `/:id/purchasing-review` → เรียก service (ลบโค้ด ~230 บรรทัด)
- `routes/uai.js` — `/:id/qc-manager-review` + `/:id/sign` → service; import constants จาก service
- `routes/supplier.js` — POST `/ncr/:token/respond` → service

**Verify:** `npm test` = **66 tests · 64 pass · 0 fail · 2 skip** (รันหลังแต่ละ extraction) — behavior เดิม 100%

**หมายเหตุ:** `transactions.js` (เจตนา CLAUDE.md เดิม) realized เป็น **service ต่อ domain** (maintainable กว่าไฟล์เดียว)
เหลือสกัด: **ncr/uai ops รอง** (resubmit-to-supplier, reject-supplier-response, reject-exec, purchasing-acknowledge, re-inspect — ยังไม่มี test ครอบ) + **domain อื่น** (bills/fg/kpi/delivery) — pattern เดียวกัน เขียน integration test ก่อนสกัดแต่ละอัน

**ไฟล์:** `services/ncrService.js` (ใหม่), `services/uaiService.js` (ใหม่), `routes/ncr.js`, `routes/uai.js` + docs

---

## 2026-07-02 | Session 89 — Integration Tests: NCR + UAI Full Workflow (Safety Net)

**ขอบเขต:** เขียน integration test ครอบ flow NCR/UAI จริงผ่าน HTTP — ปูทางให้ refactor service layer ปลอดภัย (P1 ถัดไป)
คงโค้ด production เดิม 100% (เพิ่มเฉพาะไฟล์ test)

**ไฟล์ใหม่:** `server/test/ncrUai.test.js` — harness แบบ fqc.test.js (express + fetch + JWT cookie) mount routes จริง (ncr, supplier, uai)

**ครอบคลุม (23 tests):**
- **NCR lifecycle เต็ม:** qc_staff (incoming) สร้าง → supervisor approve → manager approve (+disposition) → qmr → purchasing-review → **supplier respond ผ่าน public token** → manager approve → qmr close = `closed`
- **UAI 7‑step sign chain:** purchasing request-uai → qc-manager-review → sign (purchasing→cco→cmo→cpo→qc_manager→production_manager→qmr) = `uai_completed` → **NCR ปิดอัตโนมัติ** (uai_close_remark)
- **Guards:** permission (qc_manager สร้าง NCR ไม่ได้; supervisor approve ข้ามขั้นไม่ได้), duplicate bill_item, disposition บังคับก่อน manager approve (BUG-005), supplier respond ซ้ำ, sign ผิดคิว/หลังจบ

**ประเด็นที่เจอ & จัดการ (test-only, ไม่แตะ production):**
- `bill_items.qty_passed` NOT NULL → fixture ต้องใส่
- qc_staff seed ไม่มี `qc_station` → test set `incoming` (ncr.js guard บล็อก qc_staff สถานีอื่น)
- multer routes (`uploads.ncr.array` + verifyMagic/compressImages) no-op บน JSON body ไม่มีไฟล์ → ส่ง JSON ได้
- ลายเซ็นใช้ 1x1 PNG data-url; `after` hook ลบ sig files + temp DB (ไม่ทิ้ง residue)

**Verify:** `npm test` = **66 tests · 64 pass · 0 fail · 2 skip** (เพิ่มจาก 43 → 66, ไม่มี regression)

**ไฟล์:** `server/test/ncrUai.test.js` (ใหม่) + `testcase.md`/`iqc-system/DEVLOG.md`

---

## 2026-07-02 | Session 88 — P1 Refactor: CI/CD + Boot Integrity + Extract sequences.js/audit.js

**ขอบเขต:** ทำ P1 roadmap (AUDIT.md §12) ที่ปลอดภัย 3 ข้อ — คง business logic/workflow เดิม 100%, test ต้องเขียวตลอด

**1. CI/CD (`.github/workflows/ci.yml`)** — GitHub Actions บน push/PR → main
- job `server-test`: `cd iqc-system/server && npm ci && npm test` (node --test)
- job `client-build`: `cd iqc-system/client && npm ci && npm run build`
- node 20 + npm cache — จับ regression อัตโนมัติ (เดิมไม่มี CI เลย)

**2. Boot integrity check (`server/db/database.js`)** — เพิ่ม `PRAGMA quick_check` ตอน open DB (หลัง FK verify)
- ไม่ผ่าน → log ⚠️ ชัดเจน + guidance กู้ backup; production = throw (fail-fast, อย่ารันบน DB ที่พัง); dev = warn ต่อได้
- กันเหตุการณ์แบบ Session 84 (DB corrupt แต่ error ปลายทางสับสน)

**3. สกัด helper ออกจาก database.js (ตรง CLAUDE.md §8):**
- `server/db/sequences.js` — atomic sequence gen + `db.next*Code()` (12 ตัว), factory `attach(db)`
- `server/db/audit.js` — `db.auditLog` / `db.getSetting` / `db.setSetting` / `db.generateSecureToken`
- `database.js` แทนที่ block เดิมด้วย `require('./sequences')(db)` + `require('./audit')(db)` — **backward-compatible 100%** (surface `db.*` เดิมไม่เปลี่ยน)

**Verify:**
- Syntax OK ทุกไฟล์ · smoke test (fresh DB): nextNCRCode=`NCR-2026-0001`, token len=64, getSetting/auditLog ทำงาน, quick_check=ok
- **`npm test` = 43/43 เขียว (41 pass, 2 skip)** — ไม่มี regression

**คงเหลือ (P1 ที่ยังไม่ทำ — ตั้งใจเลื่อน):** `transactions.js` (business tx) + service layer สกัดจาก `routes/{ncr,uai,bills}.js`
→ **ต้องมี integration test ครอบ flow NCR/UAI ก่อน** (ปัจจุบันยังไม่มี) — refactor โค้ด workflow ที่ไม่มี test ครอบเสี่ยงพังเงียบ ๆ; ตอนนี้มี CI แล้วเป็นฐานให้เพิ่ม test ต่อได้

**ไฟล์ที่แก้/เพิ่ม:** `.github/workflows/ci.yml` (ใหม่), `server/db/sequences.js` (ใหม่), `server/db/audit.js` (ใหม่), `server/db/database.js` (source) + DEVLOG/CLAUDE.md/AUDIT.md

---

## 2026-07-02 | Session 87 — Fix P0 Role Drift + Test Suite (prod_supervisor)

**ขอบเขต:** แก้บั๊ก P0 ที่พบใน audit (Session 86) — role `prod_supervisor` ไม่อยู่ใน `users.role` CHECK ทำให้ seed/สร้าง user ไม่ได้ และ integration test ล้มทั้งหมดที่ setup

**Root cause:**
- `server/db/schema.sql` `users.role CHECK` มีแค่ 10 roles (ไม่มี `prod_supervisor`)
- แต่ `database.js` seed `prod_sup1` (role `prod_supervisor`) ด้วย `INSERT INTO` (ไม่ใช่ OR IGNORE) + routes `ipqcInspection.js`/`ipncr.js` + `rolePermissions.js` ใช้ role นี้จริง
- fresh DB (รวม test DB) → seed ชน CHECK → `SQLITE_CONSTRAINT_CHECK` ทุก integration test

**การแก้ (source code — เฉพาะ 2 ไฟล์):**
- `schema.sql` — เพิ่ม `'prod_supervisor'` ใน `users.role CHECK` (แก้ fresh DB + test)
- `database.js` — เพิ่ม `migrateUsersRoleConstraint()` (recreate ตาราง users ตาม pattern `migrateNcrStatusConstraint`, idempotent, gate ด้วย `includes('prod_supervisor')`) เรียกก่อน `seedData()` — แก้ DB เก่า (live) ที่มี constraint เดิม

**ผลลัพธ์ (verified):**
- Test: **11/16 → 41/43 ผ่าน** (role blocker หาย)
- ทดสอบ migration บน **copy ของ iqc.db จริง** (VACUUM INTO): constraint อัปเดต, 36 users คงเดิม, `integrity_check=ok`, `foreign_key_check=0`, insert `prod_supervisor` ได้, role ผิดยังถูก reject, รันซ้ำ idempotent (ไม่ migrate ซ้ำ)
- migration จะ auto-apply กับ iqc.db จริงเมื่อ start server ครั้งถัดไป (ปลอดภัย — ทดสอบบน copy แล้ว)

**Test cleanup:** `fqc.test.js` + `ipqc.test.js` require `../routes/fqc` / `../routes/ipqc` ที่ **ไม่มีไฟล์จริง**
(index.js mount เฉพาะ `/api/ipqc-inspection`, `/api/ipqc/master` — ไม่มี `/api/fqc`, `/api/ipqc`; `docs/API_SPEC.md` ระบุ endpoint เหล่านี้ "planned Phase 2–3")
→ ใส่ **skip guard** (try/catch require + skipped test + top-level return) พร้อมเหตุผลชัด → **suite เขียว 43/43 (41 pass, 2 skip)** · รอตัดสินใจว่าจะ implement route หรือลบ test

**Docs housekeeping:** จัดระเบียบ `iqc-system/docs/` (IPQC/FQC module docs) — เพิ่ม `docs/README.md` เป็น index + ใส่ banner ทุกไฟล์ชี้ไป canonical root docs (AUDIT.md/PRD.md/CLAUDE.md) + เตือนว่าอาจไม่รวม FG/FNCP/FUAI (Session 82–87)

**ไฟล์ที่แก้:** `server/db/schema.sql`, `server/db/database.js`, `server/test/{fqc,ipqc}.test.js` (source) + `iqc-system/DEVLOG.md` + `iqc-system/docs/*` (banners + README)

---

## 2026-07-02 | Session 86 — Enterprise Audit & Documentation Rewrite (Docs Only)

**ขอบเขต:** ตรวจทั้งระบบแบบ enterprise + เขียน/รวมเอกสารชุดใหม่ — **ไม่แตะ source code, config, DB ใด ๆ**

**สิ่งที่ทำ:**
- สำรวจทั้ง backend (105 ตาราง, ~30 routes, middleware, services) + frontend (51 หน้า, 11 roles, 8 dashboard) + เอกสารเดิม ~20 ไฟล์
- **สร้าง [`../AUDIT.md`](../AUDIT.md)** — ผลวิเคราะห์ครบ: Architecture, Business Logic, Workflow, Database, API, Security (OWASP-ranked), Performance, Code Quality, UX/UI, Testing, Refactor Roadmap, ปัญหาจัดอันดับ
- **สร้าง [`../testcase.md`](../testcase.md)** — map กับ test suite จริง 6 ไฟล์ + coverage gap
- **รวม PRD** → [`../PRD.md`](../PRD.md) v3.0 (รวม PRD เดิม + PRD-IPQC-FQC); deprecate `../PRD-IPQC-FQC.md`
- **อัปเดต [`../CLAUDE.md`](../CLAUDE.md)** — reconcile กับโค้ดจริง (แก้เรื่อง transactions.js ที่ไม่มีจริง), เพิ่ม §22 โมดูลเพิ่มเติม, §23 known deviations, เตือน role drift
- **อัปเดต [`../brand.md`](../brand.md) → v3.0** — เพิ่ม Dashboard Design Language (light+dark token), charts, state patterns
- **rewrite [`../design-dashboard.md`](../design-dashboard.md)** — redesign dashboard ทุก role + Admin + Executive อิง endpoint จริง
- ใส่ deprecation banner ให้เอกสารเก่าที่ถูกแทน

**ข้อค้นพบสำคัญ (verified):**
- Integration test ล้มทั้งหมดที่ setup: `CHECK constraint failed: role IN (...)` (role fixture drift)
- Role drift: `schema.sql` `users.role` = 10 roles แต่ `rolePermissions.js` อ้าง `prod_supervisor` (role ที่ 11)
- `fabric` เป็น dead dependency (ไม่มี import ใน client/src)
- `.env` **ไม่ถูก commit** (git track เฉพาะ `.env.production.example`) → default JWT secret เป็น dev-hygiene ไม่ใช่ leak

**ไฟล์ที่แก้:** เอกสาร Markdown เท่านั้น — `AUDIT.md`, `testcase.md`, `PRD.md`, `CLAUDE.md`, `brand.md`, `design-dashboard.md`, `iqc-system/DEVLOG.md` + deprecation banners

---

## 2026-07-01 | Session 85 — ProCodeSAP EditForm Polish + Derived-Desc Smart Matching

**ขอบเขต:** 2 เรื่อง

### 1. UI — ลบ Confidence Summary Bar ออกจาก EditForm
- ลบ block `{sm && <div>...ฟิลด์ ≥90%...</div>}` ออกจาก `ProCodeSap.jsx`
- ยัง keep `preview.fieldConfidence` ไว้ให้ `FieldConfidenceBadge` แสดงบน field แต่ละตัว (เพิ่มความฉลาดไม่ได้หาย)

### 2. Backend — Derived-Desc Smart Matching (Tier 0)

**วิธีการ:**
- เมื่อ confirm ProCodeSAP ระบบ generate `derived_desc` จากการต่อค่า field ที่ยืนยันแล้วทั้งหมด  
  เช่น → `"FU ECO 60 WINDOW ASIA หน้าต่าง SS สีขาว 120x110 เขียวใสตัดแสง 4mm. มุ้ง"`
- เก็บใน column `derived_desc` (migration เพิ่มใน `database.js`)
- classifier เพิ่ม **Tier 0** ใหม่: tokenize `product_desc` ใหม่ → เทียบ token กับ derived_desc ของทุก confirmed record
  - Expand abbreviation ไทย: `นต.` → `หน้าต่าง`, `ปต.` → `ประตู`
  - Threshold: 65% ของ input tokens ต้องพบใน derived_desc → match
  - Confidence = % tokens ที่พบ (max 100%)
  - ยิ่ง confirm มาก ระบบยิ่งฉลาดขึ้น

**ไฟล์ที่เปลี่ยน:**
- `server/services/proCodeClassifier.js` — เพิ่ม `generateDerivedDesc()`, `tokenizeForMatch()`, `derivedDescMatch()`, integrate เป็น Tier 0 ใน `classify()`
- `server/db/database.js` — `safeAddColumn('pro_code_sap', 'derived_desc', 'TEXT')`
- `server/routes/proCodeSap.js` — generate `derived_desc` เมื่อ confirm + เมื่อ edit confirmed record + endpoint `/rebuild-derived-desc`
- `client/.../ProCodeSap.jsx` — ลบ confidence bar, คง layout 5-block เหมือนเดิม
- `client/.../Modal.jsx` — prop `tall` เพิ่ม maxHeight เป็น 97svh สำหรับ EditForm modal

**API ใหม่:**
- `POST /api/pro-code-sap/rebuild-derived-desc` — backfill derived_desc สำหรับ confirmed records ที่มีอยู่แล้ว

---

## 2026-07-01 | Session 84 — Database Corruption Recovery + PDPlan Fix

**ขอบเขต:** กู้คืน SQLite database ที่ corrupt ทำให้ PDPlan import ล้มเหลว "database disk image is malformed"

**Root Cause:**
- `iqc.db` corrupt (SQLITE_CORRUPT) — integrity_check ล้มเหลว, พร้อมกัน `iqc.db.corrupt.bak` (2.15 MB จาก 6/25) ก็ corrupt ด้วย
- `iqc.db` ที่มีอยู่เป็น fresh DB จาก session 83 (initSchema() รันบน empty file) แต่ถูก kill กลางคัน → page corruption
- ทำให้ทุก query ใน previewWorkbook() fail ด้วย SQLITE_CORRUPT แทนที่จะ fail ที่ SQL syntax

**Recovery Process:**
1. ตรวจสอบ backup files: `iqc.db.corrupt.bak` (2.15 MB, 6/25), `backups/iqc_pre-H4_2026-06-18T23-57-41.db` (OK, 51 tables)
2. ใช้ `sqlite3 .recover` (SQLite 3.53.2) บน `.corrupt.bak` — ดึงข้อมูลได้สำเร็จแม้ schema page เสียหาย
3. บันทึก recovery output ไป `backups/recover_dump.sql` (2.4 MB)
4. สร้าง `backups/recovered_20260701.db` — integrity_check: ok, 65 tables, 36 users, 13 bills, 10 NCRs
5. หยุด node process, ลบ WAL/SHM files เก่า, copy recovered DB ไปเป็น `iqc.db`
6. Start server → initSchema() + runMigrations() เพิ่ม 46 tables ที่หายไป → ครบ 111 tables

**Result:** iqc.db: 111 tables, integrity ok, 36 users, 13 bills, 10 NCRs — PDPlan import พร้อมใช้งาน

---

## 2026-06-30 | Session 83 — Bug Fixes: Server Crash + FM Category Conditional Text + UI Tweaks

**ขอบเขต:** แก้ server crash (no such table: fg_fncp), ปรับ conditional text เมื่อ FM Category=Material, จำกัด permission ปุ่ม approve/reject

**แก้ Server Crash (`server/db/database.js` + `server/db/schema.sql`):**
- Root cause: `safeAddColumn('fg_fncp', ...)` ที่ top-level module (line 935-937) รันก่อน `initSchema()` (line 1526) บน fresh database — `fg_fncp` ยังไม่มี → crash "no such table"
- Fix 1: `safeAddColumn` เพิ่ม catch `e.message.includes('no such table')` — fresh DB ไม่ crash เพราะ `initSchema()` จะสร้าง table พร้อม column อยู่แล้ว
- Fix 2: `schema.sql` fg_fncp CREATE TABLE เพิ่ม columns ที่หายไป: `fm_category_id`, `prod_token`, `prod_token_expires_at`, `respondent_name`, `supervisor_approved_by/at`, `manager_approved_by/at`; อัปเดต CHECK constraint ให้รวม `supervisor_approved` และ `fuai_opened`
- Fix 3: `fgFncpResponse.js` แก้ duplicate `const responder` ใน transaction — merge เป็น variable เดียว ใช้ค่า `'QC รับเข้า'/'ฝ่ายผลิต'` สอดคล้องกันทั้ง timeline และ notification

**FM Category = Material — Conditional Text:**
- `FNCPResponse.jsx`: form heading "ข้อมูลการแก้ไข (พนักงาน QC รับเข้า)" เมื่อ is_material=1 (แทน "ฝ่ายผลิต"), already-answered notice ปรับตาม
- `FGProduction/index.jsx`: success modal label "ลิงก์สำหรับฝ่าย QC ตอบกลับ" เมื่อ is_material=1
- `fgFncpResponse.js`: timeline + notification ใช้ "QC รับเข้า" เมื่อ is_material=1 (unified responder variable)
- `fgFncp.js` copy-link: label "QC รับเข้า" เมื่อ is_material=1 ทั้ง timeline "คัดลอกลิงก์ QC รับเข้า (ครั้งที่ N)"
- `FNCPDetail.jsx`: แสดง FM Category ใน info grid, ปุ่ม "คัดลอกลิงก์ส่ง QC รับเข้า" เมื่อ is_material=1

**Permission / UI:**
- `fgFncp.js`: ปุ่ม verify (QC ยืนยันผ่าน) ลบออกจาก FNCPDetail.jsx และ backend
- `fgFncp.js`: PATCH /:id/reject ใช้ `requireRole(['admin','qc_supervisor'])` แทน QC_ROLES
- `FNCPDetail.jsx`: `canReject` เปลี่ยนเป็น `['admin','qc_supervisor']`
- Notification: PATCH reject/supervisor-approve(minor)/manager-approve → `notifyUser(old.opened_by, ...)` แจ้งเฉพาะ qc_staff ที่เปิดเอกสาร

**Menu:**
- `rolePermissions.js`: ย้าย "ของเสียวัตถุดิบ" จาก production-qc ไปอยู่ใน `/iqc` section สำหรับ qc_staff qc_station='incoming' เท่านั้น

---

## 2026-06-30 | Session 82 — FNCP Severity Workflow + FUAI + FM Category + Material Defect Escalation

**ขอบเขต:** เพิ่ม severity-based approval workflow ใน FNCP, สร้าง FUAI (ขออนุมัติใช้พิเศษ) document flow ครบ, FM Category (5M+E) พร้อม material defect escalation

**Database:**
- เพิ่ม 4 ตารางใน `schema.sql`: `fg_fm_categories`, `fg_fuai`, `fg_fuai_timeline`, `fg_material_defects`
- `database.js`: `safeAddColumn` → `fg_defect_records.fm_category_id`, `fg_fncp.fm_category_id/supervisor_approved_*/manager_approved_*`
- `migrateFncpStatusConstraint()`: recreate `fg_fncp` table กับ CHECK constraint ใหม่ (`supervisor_approved`, `fuai_opened`)
- Seed: 6 FM categories (MATERIAL[is_material=1], MACHINE, METHOD, MAN, MEASURE, ENV), sequence FUAI
- `db.nextFUAICode()` — atomic sequence generator

**Backend:**
- `fgMaster.js`: เพิ่ม `fg_fm_categories` CRUD + expose ใน `/options`
- `fgFncp.js`: เพิ่ม `PATCH /:id/supervisor-approve` (Minor→closed ทันที, Major/Critical→supervisor_approved) + `PATCH /:id/manager-approve` (→closed), helper `notifyStation()`
- `fgFncpResponse.js`: เพิ่ม `POST /:token/request-fuai` — สร้าง FUAI จาก public form, อัปเดต FNCP status='fuai_opened'
- `fgDefect.js`: รับ `fm_category_id` ใน POST, ถ้า is_material=1 → INSERT `fg_material_defects` + notify qc_staff qc_station='รับเข้า'
- `fgFuai.js` (NEW): 8 endpoints — GET list/detail, PATCH prod-manager-approve, cpo-approve/reject, qc-manager-approve/reject, qc-staff-ack, qc-supervisor-ack; ทุก endpoint ใช้ optimistic lock + transaction + audit
- `fgMaterialDefects.js` (NEW): GET list + PATCH acknowledge
- `index.js`: mount `/api/fg-fuai`, `/api/fg-material-defects`

**Frontend:**
- `rolePermissions.js`: เพิ่ม FUAI + ของเสียวัตถุดิบ ใน production-qc nav; STATUS_LABELS สำหรับ FUAI statuses
- `App.jsx`: route `fg-production/fuai`, `fg-production/fuai/:id`, `fg-production/material-defects`
- `FGProduction/index.jsx` (DefectModal): Severity dropdown → radio buttons 3 สี, เพิ่ม FM Category dropdown + warning material
- `FNCPDetail.jsx`: เพิ่ม `supervisor_approved`/`fuai_opened` status badges, ปุ่ม "QC Supervisor อนุมัติ" + "QC Manager อนุมัติ", link ไป FUAI detail
- `FNCPResponse.jsx`: เพิ่มปุ่ม "ขออนุมัติใช้พิเศษ" (Critical only) + FUAI modal พร้อม success state
- `FUAIList.jsx` (NEW): filter/table/pagination สำหรับ FUAI documents
- `FUAIDetail.jsx` (NEW): 3-col grid (ข้อมูล FUAI + approval chain + timeline), conditional action buttons ตาม role+status
- `MaterialDefects.jsx` (NEW): รายการของเสียวัตถุดิบ + modal รับทราบสำหรับ qc_staff qc_station='รับเข้า'

**Build:** `npm run build` ผ่าน (0 errors, 1013 modules, 6.19s)

---

## 2026-06-30 | Session 81 — FNCP: PDF Layout, Copy Link, Timeline Log, Concurrent Submit Protection

**ขอบเขต:** ปรับปรุง FNCP PDF export + ระบบ Copy Link (copy ได้จาก FNCPDetail, บันทึก timeline ทุกครั้ง, reset token อายุ 7 วัน) + ป้องกัน duplicate submission

**แก้ไข PDF Export (`server/routes/exports.js`):**
- ลบ `${getCompanyHeader()}` ออกจาก FNCP PDF body — ไม่มี logo/ที่อยู่บริษัทใน body อีกต่อไป
- ลบ subtitle "Finished Non-Conformance Product Report" ออก
- ปรับ `margin-top: -12mm` ดึงเนื้อหาขึ้นใกล้เส้นหัวกระดาษ
- เปลี่ยน section title "ข้อมูลของเสีย" เป็น inline style (`font-size:15px; font-weight:700`) แทน CSS class เพื่อให้แน่ใจว่าแสดงครบ
- จัดเรียง info-grid ใหม่ (2 column):
  - สินค้า | สายการผลิต
  - **Doc. No. อ้างอิง** (ย้ายมาใต้สินค้า) | กลุ่มอาการเสีย
  - อาการเสีย | จำนวนของเสีย
  - **วันที่พบปัญหา** (rename จาก "วันที่พบ") | (ว่าง)
  - **ผู้เปิดเอกสาร** (ย้ายมาใต้วันที่พบ) | —

**Copy Link จาก FNCPDetail (`client/src/pages/FGProduction/FNCPDetail.jsx`):**
- เพิ่มปุ่ม "คัดลอกลิงก์ส่งฝ่ายผลิต" ใน header แสดงเฉพาะเมื่อ status = `open`/`in_progress`/`reject` **และ** ยังไม่มี `respondent_name` (ซ่อนทันทีเมื่อฝ่ายผลิตตอบแล้ว)
- Clipboard fallback: ใช้ `navigator.clipboard` (HTTPS) → fallback `document.execCommand('copy')` (HTTP/LAN) — แก้ปัญหา copy ไม่ได้บน HTTP
- เพิ่ม icon `🔗` ใน `TL_ICON` สำหรับ `copy_link`

**Timeline Log เมื่อ Copy Link (`server/routes/fgFncp.js`):**
- เพิ่ม `POST /:id/copy-link` — นับจำนวนครั้งที่เคย copy แล้วบันทึก "คัดลอกลิงก์ส่งฝ่ายผลิต (ครั้งที่ N) — ต่ออายุลิงก์ 7 วัน"
- `UPDATE fg_fncp SET prod_token_expires_at=datetime('now','+7 days')` ทุกครั้งที่กด — reset expiry อัตโนมัติ
- ใช้ transaction ห่อ UPDATE + INSERT timeline
- Frontend เรียก API หลัง copy สำเร็จแล้ว invalidate `fncp-detail` query ให้ timeline refresh

**ป้องกัน Duplicate Submission (`server/routes/fgFncpResponse.js`):**
- Early check: ถ้า status เป็น `waiting_verify`/`verified`/`closed` → return 409 `{ already_submitted: true }` ทันที
- Optimistic lock ใน transaction: `UPDATE ... WHERE id=? AND status NOT IN ('waiting_verify','verified','closed')` → `changes=0` ถ้ามีคนส่งก่อนใน concurrent request
- คนที่แพ้ race condition: ได้รับ `already_submitted: true` → frontend (`FNCPResponse.jsx`) `refetch()` อัตโนมัติ → แสดง "ส่งข้อมูลแล้ว / ผู้ตอบ: ..." แทนฟอร์ม

**คอลัมน์วัน ใน FNCPList (`client/src/pages/FGProduction/FNCPList.jsx`):**
- เพิ่มคอลัมน์ "วัน" แสดง:
  - ยังไม่ปิด: จำนวนวันที่ผ่านมาตั้งแต่เปิด (เกิน 7 วัน → แดง)
  - ปิดแล้ว: จำนวนวันที่ใช้ปิด (เขียว)
  - Tooltip อธิบายความหมายเมื่อ hover

---

## 2026-06-29 | Session 80 — FG Production/ของเสีย + FNCP System: Complete Frontend

**ขอบเขต:** ต่อจาก Session ก่อน (Backend ครบแล้ว) — implement Frontend ทั้งหมดสำหรับระบบ บันทึกยอดผลิต/ของเสีย (FG) + FNCP

**ไฟล์ใหม่ (Client):**
- `client/src/pages/FGProduction/index.jsx` — เขียนใหม่ทั้งหมดเป็น Monitoring Dashboard:
  - 7 Dashboard Cards: แผนทั้งหมด, ผลิตจริง, ของเสียรวม, Defect%, FNCP เปิด, FNCP เกินกำหนด, Top Defect
  - Filter bar: q / สายการผลิต / date range
  - Monitoring Table (pd_plans + aggregate): Doc.No., สินค้า, สาย, Planned, Actual, Defect, Defect%, FNCP count
  - Expand Row: Production Timeline + Defect Timeline (lazy-loaded per row)
  - Modal บันทึกยอดผลิต (ProdModal): POST /api/fg-production
  - Modal บันทึกของเสีย FG (DefectModal): POST /api/fg-defect + auto FNCP toggle สำหรับ major/critical
- `client/src/pages/FGProduction/FNCPList.jsx` — รายการ FNCP:
  - Status filter bar (7 status + เกินกำหนด toggle)
  - Filters: q / severity / สาย / date
  - Table: FNCP No., Doc./สินค้า, สาย, อาการเสีย, จำนวน, Severity, Due Date, สถานะ, ผู้เปิด
  - Overdue highlight
- `client/src/pages/FGProduction/FNCPDetail.jsx` — รายละเอียด FNCP:
  - Info panel: ข้อมูลของเสีย, Root Cause Analysis fields, รูปภาพ (จาก fg_defect_records)
  - Timeline panel: ลำดับสถานะ + Timeline events (create/start/submit_verify/verify/reject/close)
  - Action Panel: ปุ่มตาม role+status (Start, Submit Verify, Verify, Reject, Close, Edit)
  - Action Modals: แต่ละ action มี modal เฉพาะพร้อม input fields

**ไฟล์แก้ไข:**
- `client/src/utils/rolePermissions.js`:
  - เพลี่ยน `'บันทึกยอดผลิต (FG)'` → `'บันทึกยอดผลิต/ของเสีย (FG)'`
  - ขยาย roles จาก `['admin']` → `PROD_QC_ROLES`
  - เพิ่ม nav item FNCP ใต้ FG production
  - เพิ่ม STATUS_LABELS: fncp_open, fncp_in_progress, fncp_waiting_verify, fncp_verified, fncp_closed, fncp_reject, waiting_verify
- `client/src/App.jsx`:
  - import FNCPList, FNCPDetail
  - ขยาย `/fg-production` route roles → PROD_QC_ROLES
  - เพิ่ม routes: `/fg-production/fncp` (FNCPList) + `/fg-production/fncp/:id` (FNCPDetail)

**Build:** `npm run build` ผ่าน — 1009 modules, ไม่มี error

---

## 2026-06-26 | Session 79 — IPQC System: Full Implementation (Schema → Backend → Frontend)

**ขอบเขต:** ระบบ IPQC ครบวงจร — 5 Station, Check Sheet แบบ Template, AQL 0.65 S-1, IPNCR Flow พร้อม Recheck หลายรอบ

**Schema (server/db/schema.sql) — ตารางใหม่:**
- `ipqc_stations` — 5 Station: ตัดเส้น, ประกอบเฟรม, ประกอบบาน, ประกอบมุ้ง, เทสบาน (seed อัตโนมัติ)
- `ipqc_check_templates` — Template check sheet ต่อ station (optional per production_line)
- `ipqc_check_items` — หัวข้อตรวจ: dimension/visual/functional, std_value + tol_plus/minus, input_type (number/pass_fail/text), sample_count
- `ipqc_inspections` — บันทึกการตรวจ 1 รอบ (AQL auto-calc, overall_result server-side)
- `ipqc_inspection_items` — ผลตรวจแต่ละหัวข้อ (measured_values JSON array)
- `ipqc_inspection_images` — รูปภาพประกอบ
- `ipncr_recheck_logs` — ประวัติ recheck แต่ละครั้ง (attempt, action, qty_pass/fail/scrap)

**database.js — Migrations + Seeds:**
- `safeAddColumn` เพิ่ม 9 columns ใน `ipncr_records`: recheck_attempt, prod_manager_approved_by/at/remarks, qc_reinspect_result/by/at/remarks, inspection_id
- Seed 5 IPQC stations อัตโนมัติ + sequence IPNCR (ถ้าไม่มี)

**Backend ใหม่:**
- `server/utils/aqlCalc.js` — AQL 0.65 Level S-1 lookup table (ISO 2859-1)
- `server/routes/ipqcInspection.js` — CRUD inspection: GET list/detail, POST create draft, PUT update items, POST submit (optimistic lock, notify fail), POST/DELETE images (multer + magic number)
- `server/routes/ipncr.js` — IPNCR status machine (open→prod_acknowledged→rechecking→prod_manager_approved→qc_supervisor_verified→closed) พร้อม PATCH endpoints ครบ + recheck_logs + Telegram/SSE

**Backend แก้ไข:**
- `server/routes/ipqcMaster.js` — เพิ่ม CRUD routes: /ipqc-stations, /check-templates, /check-items
- `server/index.js` — mount /api/ipqc-inspection + /api/ipncr

**Frontend ใหม่ (client/src/pages/ProductionQC/):**
- `IPQCList.jsx` — รายการ IPQC: filter station/line/result/date, mobile cards, pagination
- `IPQCNew.jsx` — 3-step form: (1) เลือก Station + ค้นหา PO + AQL calc box (2) กรอก Check Sheet dynamic ตาม template (number multi-sample, pass_fail toggle, text) (3) สรุป + IPNCR form inline ถ้า fail
- `IPQCDetail.jsx` — ผลตรวจ, measured values, linked IPNCR, upload images
- `IPNCRList.jsx` — รายการ IPNCR: filter status/line/date, mobile cards
- `IPNCRDetail.jsx` — Timeline + Recheck logs table + Action Panel per role/status

**Frontend แก้ไข:**
- `App.jsx` — import + 5 routes ใหม่: production-qc/ipqc, /ipqc/new, /ipqc/:id, /ipncr, /ipncr/:id
- `utils/rolePermissions.js` — nav items /production-qc/ipqc + /ipncr; STATUS_LABELS ครบ: prod_acknowledged, prod_manager_approved, qc_supervisor_verified
- `pages/Admin/ProductionMaster.jsx` — เพิ่ม tabs: IPQC Stations, Check Templates, Check Items (CrudPanel)

**Build:** ✅ ผ่าน 8.24s (1007 modules)

---

## 2026-06-26 | Session 78 — FG Inspection System: Frontend Pages

**ขอบเขต:** Frontend ครบ สำหรับ FG Inspection module

**ไฟล์ใหม่:**
- `components/UI/AnnotationEditor.jsx` — fabric.js v5 canvas annotation: วงกลม, สี่เหลี่ยม, text (IText), undo 20 steps, preset colors, line width, delete selected, save JSON+JPEG blob, re-load annotation_data
- `pages/FGProduction/index.jsx` — Admin บันทึกยอดผลิต FG: PO search → stats bar (plan/produced/defect/remaining) → form บันทึก qty_produced + shift + date → history
- `pages/FGQC/index.jsx` — FGQC list พร้อม filter q/result/date
- `pages/FGQC/New.jsx` — 5-step form: (1)ค้นหา PO (2)เงื่อนไข+AQL calc (3)ผลตรวจ+defect items (4)รูป+annotation (5)สรุป+ออก IPNCR/IPNCP
- `pages/FGQC/Detail.jsx` — ดูรายละเอียด, ดู+แก้ไข annotation, link to IPNCR/IPNCP, ออกเอกสาร IPNCR/IPNCP เพิ่มเติม
- `pages/IPNCR/index.jsx` — IPNCR list พร้อม filter status/date
- `pages/IPNCR/Detail.jsx` — detail + timeline + action buttons ตาม status (acknowledge→start-recheck→complete→verify→close)
- `pages/IPNCP/index.jsx` — IPNCP list พร้อม filter status/date
- `pages/IPNCP/Detail.jsx` — detail + timeline + action buttons (acknowledge→correcting→correction-done→accept→close)

**ไฟล์แก้ไข:**
- `utils/rolePermissions.js` — เพิ่ม `prod_supervisor` ใน PROD_QC_ROLES, เพิ่ม nav items: fg-production, fgqc, ipncr, ipncp; เพิ่ม STATUS_LABELS สำหรับ IPNCR/IPNCP statuses
- `App.jsx` — import + routes ครบทุกหน้า: fg-production, fgqc, fgqc/new, fgqc/:id, ipncr, ipncr/:id, ipncp, ipncp/:id; เพิ่ม `prod_supervisor` ใน PROD_QC_ROLES constant

**Build:** ✅ ผ่าน 10s (1021 modules)

---

## 2026-06-26 | Session 77 — FG Inspection System: Schema + Backend Foundation

**ขอบเขต:** วาง Foundation ทั้ง backend สำหรับ FG Inspection / IPNCR / IPNCP module

**Schema (schema.sql) — ตารางใหม่:**
- `return_stations` — สถานีแก้ไขงาน (Master สำหรับ IPNCP)
- `fg_productions` — ยอดผลิตรายวัน (Admin บันทึกตาม PO)
- `ipqc_schedules` — ตาราง IPQC รายวัน (ระบบสร้างให้ตาม pd_plans + factory_assignment)
- `ipqc_rounds` — บันทึก IPQC ทุก 2 ชม. ต่อ process step
- `ipqc_round_defects` — รายการของเสียต่อ round
- `fgqc_records` — ผลตรวจ FQC (AQL S-1 0.65 หรือ 100% ตามเงื่อนไข)
- `fgqc_defect_items` — ของเสียแยกประเภท + severity
- `qc_images` — รูปภาพ + annotation_data JSON (ใช้ร่วม fgqc/ipqc/ipncr/ipncp)
- `ipncr_records` — Major defect: Recheck 100% (status: open→prod_acknowledged→rechecking→completed→qc_verified→closed)
- `ipncp_records` — Minor defect: ส่งกลับสถานี (status: open→prod_acknowledged→correcting→correction_done→qc_accepted→closed)

**database.js:**
- `safeAddColumn('users', 'factory_assignment')` — กำหนดโรงที่ qc_staff รับผิดชอบ
- sequences ใหม่: FGQC, IPNCR, IPNCP
- `db.nextFGQCCode()`, `db.nextIPNCRCode()`, `db.nextIPNCPCode()`
- seed `return_stations` default 7 สถานี
- seed `prod_supervisor` default user

**Routes ใหม่:**
- `server/utils/aql.js` — AQL 0.65 Level S-1 + resolveMode + evalResult
- `server/routes/fgProduction.js` — CRUD ยอดผลิต + `/po-summary` API
- `server/routes/fgqc.js` — FGQC CRUD + image upload + annotation patch
- `server/routes/ipncr.js` — IPNCR + status flow (6 steps) + notifications
- `server/routes/ipncp.js` — IPNCP + status flow (6 steps) + notifications
- `server/routes/ipqcMaster.js` — เพิ่ม `/return-stations` CRUD

**index.js:** mount /api/fg-production, /api/fgqc, /api/ipncr, /api/ipncp

**ยังเหลือ (Phase 2):**
- Frontend: หน้า FG Production บันทึก/Dashboard
- Frontend: หน้า FGQC New (6 steps + AQL display + Image Annotation fabric.js)
- Frontend: หน้า IPNCR / IPNCP Detail + action buttons
- Frontend: IPQC rounds form
- Role permissions update

---

## 2026-06-26 | Session 76 — FQC New: ค้นหาด้วย Doc. No. / PO

**ขอบเขต:** Step 1 ของฟอร์ม "บันทึก FQC" รองรับค้นหาด้วย Doc. No. หรือ PO แล้วเลือกสินค้าเพื่อกด "ถัดไป"

**Backend:**
- เพิ่ม `GET /api/pd-plan/search?q=` ใน `server/routes/pdPlan.js`
  - ค้นหา `pd_plans` ด้วย `doc_no`, `product_no`, หรือ `product_desc`
  - JOIN `production_lines` และ `pro_code_sap` เพื่อดึง line_name, sap_status, attributes
  - คืน: id, doc_no, product_no, product_desc, plan_qty, completed_qty, due_date, line_name, pro_code_sap_id, sap_status, attributes

**Frontend (`client/src/pages/FQC/New.jsx`):**
- เพิ่ม toggle สองโหมดใน Step 1: "ค้นหาด้วย Doc. No. / PO" (default) | "ค้นหาด้วยรหัสสินค้า"
- โหมด Doc. No.: พิมพ์ ≥2 ตัว → แสดง dropdown รายการจาก pd_plans พร้อม: doc_no, ชื่อสินค้า, รหัส SAP, สายผลิต, วันส่ง, plan_qty
  - รายการที่ sap_status ≠ confirmed → dimmed + "รอยืนยัน SAP", คลิกไม่ได้
  - เลือกรายการ → auto-fill: pro_code_sap_id, product, po_number (= doc_no), production_line_id
- โหมดรหัสสินค้า: พฤติกรรมเดิม บวกช่อง Doc. No. แบบ optional
- แสดง card "สินค้าที่เลือก" พร้อมปุ่ม "ล้าง ×" ที่ด้านล่างเสมอหลังเลือกแล้ว

---

## 2026-06-25 | Session 75 — Classifier Enhancement: series/brand/panel_type/glass_type rules

**ขอบเขต:** เพิ่ม 4 กฎ post-processing ใน `proCodeClassifier.js` เพื่อให้ auto-fill แม่นยำขึ้น

**กฎที่เพิ่ม:**
1. **product_series จากชื่อสินค้า override code-parse เสมอ** — ถ้าชื่อมี "F100", "S85", "/85", "(85", "ECO 60", "ECO 80", "SuperECO", "ECO 60-100" → ใช้ค่านั้น แทน "F100/S85" จาก code-parse (ที่ไม่ชัดเจน)
2. **brand `(Standard)` → เช็ค description → fallback WINDOW ASIA** — ค้นชื่อแบรนด์ใน description ก่อน (FRAMEX, HOOMDOT THUNDER, FINEXT ฯลฯ ลำดับยาว-ก่อน-สั้น) ถ้าไม่เจอ → "WINDOW ASIA" (ไม่ใช้ "(Standard)" อีกต่อไป)
3. **panel_type normalize** — `'ช่องแสง / Fix'` → `'ช่องแสง'` (ตัด " / " suffix); ชื่อย่อ "นต." → "หน้าต่าง", "ปต." → "ประตู"
4. **glass_type สำหรับ ECO series** — ถ้า product_series มี "ECO" และชื่อไม่มีกระจกพิเศษ → `'เขียวใสตัดแสง 4mm.'`; ยกเว้น ลามิเนท, เทมเปอร์, ฝ้า, ชาดำ ที่ระบุในชื่อชัดเจน

**ไฟล์ที่แก้ไข:**
- `server/services/proCodeClassifier.js` — เพิ่ม `KNOWN_BRANDS[]`, `extractBrandFromDesc()`, แก้ `PANEL_TYPE.F`, เพิ่ม post-processing block ใน `classify()`

---

## 2026-06-25 | Session 74b — Training Data Management Tab

**ขอบเขต:** เพิ่มหน้าจัดการข้อมูล Training (sap_master_lookup) หลังจากนำเข้า ให้ Admin ดู/แก้ไข/ลบค่าต่อฟิลด์ได้

**ไฟล์ที่แก้ไข:**
- `server/routes/proCodeSap.js` — เพิ่ม 5 routes: GET /master-training/groups, GET /master-training/group-detail, PATCH /master-training/entry, DELETE /master-training/group, DELETE /master-training/entry
- `client/src/pages/Admin/ProCodeSap.jsx` — เพิ่ม TrainingDataTab, GroupDetailPanel, ConfBadge components + แท็บ "Training Data" ที่ 3 ใน ProCodeSapPage; TrainingImportModal เพิ่มปุ่ม "ไปหน้าจัดการ Training Data →" หลังนำเข้าสำเร็จ

**การใช้งาน:**
- แท็บ "Training Data" → ตารางกลุ่มรหัส (Part1-Part2) → คลิกแถว → expand ดูฟิลด์ทั้งหมด
- แก้ไข top_value หรือ confidence_pct แบบ inline → บันทึก
- ลบทีละฟิลด์ หรือลบทั้งกลุ่มพร้อม confirm

---

## 2026-06-25 | Session 74 — ProCodeSAP Master Lookup: 90%+ auto-classify confidence

**ขอบเขต:** เพิ่ม sap_master_lookup table จาก training data เพื่อให้ auto-classify ถูกต้อง 90%+ และแสดง % ความมั่นใจต่อฟิลด์ในหน้าแก้ไข

**ปัญหาเดิม:**
- ProCodeSAP auto-classify ใส่ค่าผิดเกือบทุกฟิลด์ ต้องแก้เองทุกหัวข้อ
- `sap_prediction_cache` อิงจาก confirmed records ในระบบซึ่งยังน้อย → confidence ต่ำ
- decode map มีแค่ ~8 brand codes แต่ training มี 48 unique Part1

**ไฟล์ที่แก้ไข:**
- `server/db/schema.sql` — เพิ่มตาราง `sap_master_lookup` + index
- `server/services/proCodeClassifier.js` — เขียนใหม่ทั้งไฟล์ 4-tier system: masterLookup → cacheAttrs → majorityLookup → parseProductNo; เพิ่ม `fieldConfidence` ต่อฟิลด์; เพิ่ม decode map ครบ 12 brand codes, FA/FU series, panel type/color
- `server/routes/proCodeSap.js` — เพิ่ม 3 routes ใหม่: POST /import-master-training, GET /master-training/stats, GET /:id/classify-preview
- `client/src/pages/Admin/ProCodeSap.jsx` — เพิ่ม FieldConfidenceBadge, summary bar ใน EditForm (useEffect classify-preview), TrainingImportModal, ปุ่ม "นำเข้า Training"

**สถาปัตยกรรม Classifier (4-tier):**
- Tier 1: masterLookup — training data 4,547 rows → ≥80% confidence_pct แสดง 90-95%
- Tier 2: cacheAttrs — confirmed production records
- Tier 3: majorityLookup — ALL confirmed (part1+part2 → part1+type → part1)
- Tier 4: parseProductNo — deterministic SAP code parse
- parsedDominant fields (line_type, brand, panel_type, panel_color, size) override เสมอ

**Usage:** Admin → ProCodeSAP → "นำเข้า Training" → upload Traning SAP ProCode.xlsx → Badge สีเขียว ≥90% ปรากฏในหน้าแก้ไข

---

## 2026-06-25 | Session 73 — Fix export: ทุก export ดาวน์โหลดทันที ไม่เปิดเป็น link

**ขอบเขต:** Review และแก้ไข export ทั้งโปรเจกต์ให้ดาวน์โหลดไฟล์ทันที (ไม่เปิด link/tab ใหม่)

**ปัญหาเดิม:**
- `a.click()` โดยไม่ append ลง DOM ก่อน → Firefox/Safari เปิด blob:// URL แทน download
- `<a href="/api/..." target="_blank">` ไม่มี `download` attribute → เปิด tab ใหม่
- `window.open('/api/...', '_blank')` → เปิด tab ใหม่แทน download
- `<a href="/api/..." download>` → อาจเปิด PDF/JPG inline ใน browser ได้

**วิธีแก้:** สร้าง `downloadFile(endpoint, params, filename)` utility ใน `utils/api.js`
- ใช้ `responseType: 'blob'` ผ่าน axios → server's Content-Type ติดมากับ Blob เอง
- append `<a>` ลง `document.body` ก่อน `.click()` — บังคับ download ทุก browser
- `setTimeout(() => revokeObjectURL(), 100)` ให้ browser เริ่ม download ก่อน revoke

**ไฟล์ที่แก้ไข:**
| ไฟล์ | การเปลี่ยนแปลง |
|------|----------------|
| `utils/api.js` | เพิ่ม `downloadFile`, `downloadExcel`, `downloadPdf` (aliases) |
| `components/UI/CrudPanel.jsx` | ใช้ `downloadExcel` แทน inline blob |
| `pages/IPQC/index.jsx` | ใช้ `downloadFile` + params object แทน URLSearchParams |
| `pages/FQC/index.jsx` | เหมือนกัน |
| `pages/Admin/ProCodeSap.jsx` | ใช้ `downloadFile` |
| `pages/Bills/index.jsx` | `window.open` → `downloadFile`, JPG/PDF/Excel buttons แทน `<a>` |
| `pages/Bills/Detail.jsx` | `<a target="_blank">` → `<button onClick>` + `downloadFile` |
| `pages/NCR/Detail.jsx` | `<a download>` → `<button>` + `downloadFile` |
| `pages/UAI/Detail.jsx` | เหมือนกัน |
| `pages/Reports/Summary.jsx` | `<a download>` → `<button>` (Excel + PDF) |
| `pages/Reports/Receiving.jsx` | เหมือนกัน |
| `pages/Reports/NCRReport.jsx` | เหมือนกัน |
| `pages/Reports/UAIReport.jsx` | เหมือนกัน |
| `pages/KPI/index.jsx` | `<a download>` → `<button>` + `downloadFile` |
| `pages/Master/ProductGroups.jsx` | ใช้ `downloadExcel` |
| `pages/Master/Units.jsx` | เหมือนกัน |
| `pages/Master/Colors.jsx` | เหมือนกัน |
| `pages/Master/DefectCategories.jsx` | เหมือนกัน |
| `pages/Master/Products.jsx` | เหมือนกัน |
| `pages/Master/Suppliers.jsx` | เหมือนกัน |

**ยกเว้น:** `KPI/index.jsx:2019` `window.open('', '_blank')` สำหรับ print preview — ตั้งใจให้เปิด popup ไม่ได้แก้

---

## 2026-06-25 | Session 72 — Export/Import Master + ProCodeSAP prediction cache + decimal fix

**ขอบเขต:**
1. Export/Import Excel สำหรับ Master หน้างาน (6 tabs) และ ProCodeSAP ยืนยันแล้ว
2. `sap_prediction_cache` — pre-computed majority-vote cache เพื่อลดการ query ซ้ำ
3. แก้ bug `parsePart3` ทศนิยม (1205 → 120.5 ซม.)
4. Enhance description parsing: size จาก text, สีเพิ่มเติม, panel_style case-insensitive

**Backend:**
- `schema.sql`: table `sap_prediction_cache (sap_part1, sap_part2, field_name, top_value, frequency, sample_size, confidence_pct)` + index
- `proCodeClassifier.js`:
  - `parsePart3`: ถ้า w>300 หรือ h>300 → หาร 10 (เช่น 1205→120.5)
  - `extractSizeFromDesc`: ดึง WxH จากชื่อสินค้า (120.5×110 ฯลฯ) ให้ precision กว่า Part3
  - panel_style: case-insensitive + longest-match FSSF/SSSS/SFSF/SFS/FSF/SS/FF/SF
  - สีเพิ่ม: เทา, น้ำตาล, ครีม, ทอง, ซิลเวอร์, เขียว
  - `rebuildPredictionCache(db, sap_part1, sap_part2)`: rebuild cache 1 group (เรียกหลัง transaction)
  - `cacheAttrs(db, sap_part1, sap_part2)`: fast lookup จาก cache
  - `classify()`: ลอง cache ก่อน → fallback live majority vote
- `proCodeSap.js`:
  - `GET /export/excel?status=`: filter by status + filename ตาม status
  - `POST /import?dryRun=1`: bulk-edit confirmed records, validate headers, dryRun preview
  - `GET /cache/stats`: จำนวน entries / groups / updatedAt
  - `POST /cache/rebuild-all`: rebuild cache ทุก confirmed pairs
  - `/confirm`, `PATCH /:id`, `/apply-recheck`: rebuild cache หลัง transaction
- `ipqcMaster.js`: addEI factory export/import ครบ 6 entities (ทำในรอบก่อน)

**Frontend:**
- `CrudPanel.jsx`: เพิ่ม `exportable`, `importable` props + `ImportModal` component
- `ProductionMaster.jsx`: ทุก 6 tabs: `exportable importable`
- `ProCodeSap.jsx`: export ส่ง status filter, ปุ่ม Import บน confirmed tab, `SapImportModal`

**Deploy:** `docker compose down` + `up --build` ✓ | Build: 1008 modules ✓

---

## 2026-06-25 | Session 71 — แก้ bug duplicate object keys ใน KPI/index.jsx

**ไฟล์:** `client/src/pages/KPI/index.jsx` (line 782-786 เดิม)

**Bug:** `useState` initializer ของ `ItemForm` มี object keys ซ้ำกัน 5 ตัว:
`target_direction`, `summary_type`, `target_years`, `target_value`, `kpi_no_prefix`

โครงสร้างเดิม:
```js
{ target_direction: 'gte', …ค่า default…, ...initial, target_direction: initial.target_direction ?? 'gte', … }
```
5 keys แรก (lines 782-786) เป็น dead code — ถูก `...initial` และ keys ที่ 2 override ทั้งหมด
ทำให้ Vite build แจ้ง duplicate key warning ทุกครั้ง

**Fix:** ลบ 5 lines แรก (dead defaults) ออก คงเหลือเฉพาะ `...initial` + override หลัง spread

Build: ✓ 1008 modules — ไม่มี duplicate key warning

---

## 2026-06-25 | Session 70 — Documentation (6 ไฟล์) ปิดงาน IPQC/FQC

สร้าง `iqc-system/docs/`:
- **SYSTEM_ARCHITECTURE.md** — stack, layout backend/frontend, request lifecycle, design patterns,
  domain boundary (products vs pro_code_sap)
- **DATABASE_DESIGN.md** — 16 ตาราง, relationships, indexes, integrity rules (NULL-in-UNIQUE caveat), seed
- **UI_FLOW.md** — navigation, admin setup flow, worker IPQC/FQC 4-step, monthly approval, status colors
- **TESTCASE.md** — catalogue 82 tests ตามไฟล์/พื้นที่ + วิธีรัน
- **DEPLOYMENT.md** — dev/Docker/bare, env, auto-migration on boot, first-run checklist, backup
- **SECURITY.md** — auth/session, RBAC + row-scoping, validation, upload hardening, rate limit, audit
รวมกับ API_SPEC.md + Postman ที่มีอยู่ → ครบ 8 ไฟล์เอกสาร

### โมดูล IPQC/FQC เสร็จสมบูรณ์: backend 82 tests, frontend build ✓, docs ครบ
### คงเหลือ optional: PDF export, แก้ duplicate keys ใน KPI/index.jsx (bug เดิม)

---

## 2026-06-25 | Session 69 — Phase 4: Exports + Dashboard + Pareto (tested 82/82)

### Backend
- **`routes/ipqc.js`**: `GET /summary` (today/open/trend7d/pareto30d) + `GET /export` (xlsx) — วางก่อน /:id
- **`routes/fqc.js`**: `GET /summary` (today rate/trend/pareto/result breakdown) + `GET /export` (xlsx)
- ทุก export เขียน audit EXPORT + Content-Disposition attachment; pm scoping ทุก query
- **`index.js`**: rate limit 5/นาที สำหรับ /api/ipqc/export + /api/fqc/export (CLAUDE §13)
- **tests**: +4 (summary + export xlsx ทั้ง IPQC/FQC) → suite รวม **82 pass / 0 fail**

### Frontend
- **`pages/FQC/Dashboard.jsx`** (ใหม่): summary cards (IPQC วันนี้/ค้าง, FQC วันนี้/อัตรา)
  + LineChart อัตราของเสีย FQC 7 วัน + BarChart IPQC 7 วัน + **Pareto** (recharts)
- **`pages/IPQC/index.jsx` + `pages/FQC/index.jsx`**: ปุ่ม Export Excel (download ตาม filter)
- **`App.jsx`** route `/production-qc/dashboard`; **`rolePermissions.js`** เพิ่ม child "Dashboard" (grid)
- `npm run build` → ✓ 1008 modules

### API_SPEC §7 (export/summary). เหลือ: PDF export (optional) + docs ที่เหลือ

---

## 2026-06-25 | Session 68 — Phase 3 FQC UI (form + list + monthly approval grid)

- **`pages/FQC/index.jsx`**: list — filter (q/line/result/date) + summary bar (ผลิต/เสีย/อัตรา) + pagination
- **`pages/FQC/New.jsx`**: 4-step form — สินค้า / การตรวจ / **ของเสีย (dynamic rows + live rate
  + pass/fail ประมาณการเทียบ threshold ที่ resolve ฝั่ง client)** / รูปภาพ ≤15
- **`pages/FQC/Detail.jsx`**: info + defect_items table + gallery + result badge
- **`pages/FQC/Monthly.jsx`**: grid รับทราบรายเดือน — overall (QC Manager/CPO) + per-line
  (ผจก.ฝ่ายผลิต) ปุ่มรับทราบตาม role; เดือนไม่มีของเสีย = "—"
- **backend `routes/fqc.js`**: monthly response เพิ่ม `my_line_ids` (สายที่ pm ดูแล) สำหรับ gate ปุ่ม
- **`App.jsx`**: routes /fqc, /fqc/new, /fqc/monthly (ก่อน :id), /fqc/:id
- **`rolePermissions.js`**: group "QC หน้างาน" เพิ่ม FQC ผลผลิต + รายงานรายเดือน
- `npm run build` → ✓ 1007 modules; FQC tests ยัง 21/21 (รวม **78/78**)

### IPQC + FQC ครบ vertical slice (backend tested + UI) — เหลือ Phase 4 (export/dashboard) + docs

---

## 2026-06-25 | Session 67 — Phase 3 FQC backend + monthly approval (tested 78/78)

### `server/routes/fqc.js` (ใหม่) mount `/api/fqc`
- **POST /** create (qc_staff/supervisor): atomic — record_no(FQC-YYYY-NNNN) + defect_items
  - auto defect_qty=Σitems, defect_rate=defect_qty/total×100 (2dp, stored),
    result=pass ถ้า ≤ threshold (resolve: product→line→global default 3%) ไม่งั้น fail
  - validate: date window, defect sum ≤ total; fail → notify qc_manager + กลุ่ม QC
- **GET /** list: filter date/line/result/q + pass_qty (computed) + pm line-scoping
- **GET /:id** detail + defect_items[] + images[] + pass_qty
- **PATCH /:id** edit (owner ≤24h / supervisor / manager) — แก้ items/total → recompute rate+result
- **POST/DELETE /:id/images** (≤15)
- **GET /monthly** — per-line produced/defects/lots + approval state (qc_manager/cpo/per-line pm)
- **POST /monthly/approve** — บังคับลำดับ: QC Manager → Production Manager (สายที่ assigned
  เฉพาะสายที่มีของเสีย) → CPO (รอ QC + pm ทุกสายครบ); กัน double (NULL-in-UNIQUE → เช็คเอง)

### `server/index.js`: mount `/api/fqc` (หลัง /api/ipqc)

### Tests: `test/fqc.test.js` (ใหม่) 21 — create pass/fail, validation, scoping,
  edit recompute, monthly approval chain ครบ (cpo/pm ก่อน qc → 409, double → 409, ลำดับถูก → 201)
  → suite รวม **78 pass / 0 fail**

### Docs: API_SPEC §6 FQC, Postman +4 (รวม 30 requests)

### ถัดไป: Phase 3 UI — FQC form + list + monthly approval grid

---

## 2026-06-24 | Session 66 — Admin: ProCodeSAP queue + PDPlan import + line managers UI

- **`pages/Admin/ProCodeSap.jsx`** (ใหม่): 2 tabs
  - **นำเข้า PDPlan**: upload .xlsx → POST /pd-plan/import → สรุปผล (เพิ่ม/อัปเดต/ข้าม),
    รหัส SAP ใหม่ (ปุ่มไปหน้าจำแนก), เตือน sheet ที่ยังไม่ผูกสาย, breakdown ต่อ sheet
  - **จำแนก ProCodeSAP**: filter สถานะ (auto/pending/confirmed/rejected/ทั้งหมด) + ค้นหา,
    confidence bar, ยืนยัน/แก้ไข(14 attr modal)/ปฏิเสธ, จำแนกทั้งหมด, Export Excel
- **`components/UI/CrudPanel.jsx`**: เพิ่ม prop `extraActions` (custom row buttons)
- **`pages/Admin/ProductionMaster.jsx`**: เพิ่ม ManagersModal — assign/unassign
  production_manager ต่อสายผลิต (ผ่าน extraActions "ผู้รับผิดชอบ")
- **`App.jsx`** route `/admin/procode-sap`; **`rolePermissions.js`** nav child "ProCodeSAP & PDPlan"
- `npm run build` → ✓ 1003 modules, ไม่มี error จากไฟล์ใหม่

> Data pipeline ครบ: import PDPlan → จำแนก SAP → ยืนยัน → ใช้ใน IPQC
> หมายเหตุ: KPI/index.jsx มี duplicate keys หลายตัว (target_direction/summary_type/
> target_years/target_value/kpi_no_prefix) — bug เดิม ควรแก้แยก

### ถัดไป: Phase 3 — FQC (backend routes + tests ก่อน → form → monthly approval)

---

## 2026-06-24 | Session 65 — Admin Master UI (reusable CrudPanel) + toggle endpoint

### Backend
- **`server/lib/crud.js`**: เพิ่ม `PATCH /:id/toggle` ใน makeCrudRouter (เฉพาะ softDelete)
  — flip is_active + audit (ACTIVATE/DEACTIVATE) สำหรับ reactivate
- **`test/ipqcMaster.test.js`**: +1 test (toggle reactivate) → suite รวม **57 pass / 0 fail**

### Frontend
- **`components/UI/CrudPanel.jsx`** (ใหม่, reusable): list+search+pagination+create/edit Modal+toggle/delete
  — config: columns(render), fields(text/number/select/date), softDelete flag
- **`pages/Admin/ProductionMaster.jsx`** (ใหม่): 6 tabs ใช้ CrudPanel —
  สายผลิต / กระบวนการ / ประเภทของเสีย / FM / กะ / เกณฑ์ของเสีย (threshold = hard delete)
  - lines fields รวม factory_code + pdplan_sheet; process/defect/threshold มี line dropdown; defect มี FM dropdown
- **`App.jsx`**: route `/admin/production-master`; **`rolePermissions.js`**: nav admin child "Master หน้างาน"
- `npm run build` → ✓ 1002 modules, ไม่มี error

> ตอนนี้ admin สร้างสายผลิต + ประเภทของเสียได้ → IPQC ใช้งานได้ครบ end-to-end
> ยังไม่ทำ: line manager assignment UI, ProCodeSAP queue UI, PDPlan import UI

### ถัดไป: ProCodeSAP queue + PDPlan import UI (admin) หรือ Phase 3 FQC

---

## 2026-06-24 | Session 64 — IPQC UI step 2: multi-step form + detail (client builds ✓)

- **`pages/IPQC/New.jsx`** (ใหม่): multi-step form 4 ขั้น
  1. สินค้า — ค้นหา ProCodeSAP (debounce 300ms, /pro-code-sap/search confirmed-only) + chip attributes + PO
  2. การผลิต — found_date (min today-7, max today), สายผลิต → กระบวนการ (filter by line) + กะ
  3. ของเสีย — FM (ปุ่ม radio), ประเภทของเสีย (filter line+fm), **live defect-code preview**
     (factory_code+fm+step+dtype client-side), จำนวน, ผู้รับผิดชอบ, รายละเอียด
  4. รูปภาพ — กล้อง/อัปโหลด grid ≤15 + ลบ
  - validate ต่อ step; submit → POST /ipqc แล้ว POST /ipqc/:id/images → ไปหน้า detail
- **`pages/IPQC/Detail.jsx`** (ใหม่): ข้อมูลครบ + gallery + ปุ่มเปลี่ยนสถานะ
  (mirror backend transitions; cancel เฉพาะ qc_manager) + back
- **`App.jsx`**: routes `/ipqc/new` (qc_staff/supervisor), `/ipqc/:id` (new ก่อน :id)
- `npm run build` → ✓ 1000 modules, ไม่มี error จากไฟล์ IPQC

### IPQC module ครบ vertical slice: nav → list → form 4 step → detail (status/gallery)
### ถัดไป: Admin master UI (จัดการสายผลิต/process/defect-type) หรือ Phase 3 FQC

---

## 2026-06-24 | Session 63 — IPQC UI step 1: nav + routing + list page (client builds ✓)

- **`utils/rolePermissions.js`**: เพิ่ม nav group "QC หน้างาน" (icon factory) + child "IPQC ของเสีย" → /ipqc
  (roles: admin, qc_staff, qc_supervisor, qc_manager, cpo, production_manager)
  + STATUS_LABELS: open/in_progress/cancelled + pass/fail/conditional_pass
- **`components/Layout/Sidebar.jsx` + `BottomNav.jsx`**: เพิ่ม icon `factory` + `clipboard`
- **`pages/IPQC/index.jsx`** (ใหม่): list page — filter (q/line/status/date range) + pagination 20,
  mobile cards + desktop table, Badge, ปุ่ม "+ บันทึก IPQC" (qc_staff/supervisor)
- **`App.jsx`**: import IPQCList + route `/ipqc` (ProtectedRoute roles)
- `npm run build` → ✓ built (998 modules, ไม่มี error จากไฟล์ IPQC)

> หมายเหตุ: พบ warning เดิม (ไม่ใช่ของ IPQC) — duplicate key `kpi_no_prefix` ใน KPI/index.jsx
> (esbuild เตือนแต่ build ผ่าน) — ควรแก้แยกภายหลัง

### ถัดไป (step 2): multi-step record form (New) + detail page

---

## 2026-06-24 | Session 62 — IPQC/FQC Phase 2 backend (IPQC records, tested 56/56)

### `server/routes/ipqc.js` (ใหม่) mount `/api/ipqc`
- **POST /** create (qc_staff, qc_supervisor): atomic ใน transaction —
  gen `record_no` (IPQC-YYYY-NNNN) + `defect_code` = factory_code+fm.code+step.code+dtype.code
  + audit + notify (qc_supervisor in-app/personal TG + กลุ่ม QC)
  - validate: found_date ไม่อนาคต/ย้อนไม่เกิน 7 วัน, total_qty ≥ defect_qty, responsible บังคับ, relational exist
- **GET /** list: filter date/line/status/defect_type/fm/q + pagination;
  production_manager เห็นเฉพาะสายที่ assigned
- **GET /:id** detail + images[] + joined names; production_manager นอกสาย → 403
- **PATCH /:id** edit (owner ≤24h & open หรือ supervisor/manager); closed/cancelled แก้ไม่ได้
- **PATCH /:id/status** transition + optimistic lock (open↔in_progress→closed/cancelled);
  closed stamps closed_at/by + notify ผู้บันทึก
- **POST /:id/images** (≤15, verifyMagic + compress) / **DELETE /:id/images/:imageId**

### `server/index.js`: mount `/api/ipqc` (หลัง `/api/ipqc/master` — ลำดับสำคัญ)

### Tests
- `test/ipqc.test.js` (ใหม่) — 16 integration: create/validation×5/permission/list/detail/
  pm-scoping/status×3/edit×2/audit
- รวมทั้งระบบ `node --test` → **56 pass / 0 fail**

### Docs: API_SPEC.md เพิ่ม §4 IPQC, Postman +5 requests (รวม 26)

### ถัดไป: IPQC UI ทีละ step (API client → list → multi-step form → detail)

---

## 2026-06-24 | Session 61 — IPQC/FQC Phase 1 (Master CRUD + reusable architecture + tests)

### สร้างจริง (Production code, ทดสอบผ่าน 40/40)

**`server/lib/validate.js`** (ใหม่) — schema validator ไม่มี dependency:
- รองรับ required/type(int,number,string,date)/min/max/minLength/maxLength/enum/pattern
- `validateBody(schema)` middleware + `asPartial(schema)` สำหรับ PATCH

**`server/lib/crud.js`** (ใหม่) — `makeCrudRouter(cfg)` factory ใช้ซ้ำได้:
- list (pagination + search + filters + active toggle), get, create, update, soft/hard delete
- ทุก write ห่อ transaction + `db.auditLog` (CREATE/UPDATE/DEACTIVATE/DELETE)
- hooks: mapRow / beforeWrite / afterCreate / afterUpdate
- filters รองรับ `eq` และ `eq_or_null` (สำหรับ NULL=global rows)
- จัดการ error: UNIQUE→409, FK→409, อื่นๆ→500 (ข้อความไทย)

**`server/routes/ipqcMaster.js`** (ใหม่) mount `/api/ipqc/master`:
- production-lines (+ managers many-to-many, validate role=production_manager)
- fm-categories, shifts, process-steps (line filter), defect-types (line+fm filter)
- thresholds (admin+qc_manager, hard delete, created_by stamp)
- `/manager-users` lookup (วางก่อน /:id กัน shadow)

**`server/index.js`**: mount `/api/ipqc/master`

### Tests (server/test/)
- `ipqcMaster.test.js` (ใหม่) — 17 integration: auth/CRUD/validation/permission/409/soft-delete/managers/audit
- `ipqcUnit.test.js` (ใหม่) — 11 unit: validate + classifier
- รันทั้งหมด `node --test` → **40 pass / 0 fail** (รวม 12 test เดิม ไม่ regress)

### Docs (iqc-system/docs/)
- `API_SPEC.md` — endpoint ทั้งหมดของ Phase 0+1 (master/pro-code-sap/pd-plan)
- `IPQC-FQC.postman_collection.json` — 4 groups, 20 requests (login + cookie auth)

### ถัดไป: Phase 2 IPQC — routes (backend ทดสอบก่อน) → UI ทีละ step

---

## 2026-06-24 | Session 60 — IPQC/FQC Phase 0 (backend foundation, built + tested)

### สร้างจริง (Production code, ผ่าน smoke test กับไฟล์จริง)

**`server/db/schema.sql`** — เพิ่ม 16 ตาราง IPQC/FQC ต่อท้าย (CREATE TABLE IF NOT EXISTS + indexes):
- `pro_code_sap`, `sap_parse_rules`, `production_lines`, `production_line_managers`,
  `fm_categories`, `process_steps`, `defect_types`, `shifts`, `defect_rate_thresholds`,
  `pd_plans`, `ipqc_records`, `ipqc_images`, `fqc_records`, `fqc_defect_items`,
  `fqc_images`, `fqc_monthly_approvals`
- ใช้ `production_manager` (ไม่ใช่ prod_mgr — แก้ให้ตรง users.role CHECK จริง)

**`server/db/database.js`**:
- เพิ่ม `db.nextIPQCCode()` / `db.nextFQCCode()` (ใช้ nextSequence pattern เดิม)
- seedData(): seed sequences IPQC+FQC, FM categories (4), shifts (3), process steps (12 line-agnostic), global threshold 3%

**`server/services/proCodeClassifier.js`** (ใหม่) — auto-classify SAP code:
- parse Part1 (line_type/FU series/brand code) + Part2 (panel_type/color) + Part3 (size split-half)
- parse description keywords + similarity match (90/75/60%) + custom rules (sap_parse_rules)
- แก้ bug "ไม่มีมุ้ง" contains "มุ้ง" → ตรวจ negative form ก่อน

**`server/routes/proCodeSap.js`** (ใหม่): list/search/filter-options/CRUD/confirm/reject/auto-classify/export Excel
**`server/routes/pdPlan.js`** (ใหม่): import (scan-based header, all sheets) + list
- จัดการ header ไม่คงที่ (ALU row 5, uPVC row 3) — scan หา "Product No."
- จัดการคอลัมน์ SO. แทน Doc. No. (sheets 0117/0119/0121) — fallback doc number
- map sheet name → production_line ผ่าน pdplan_sheet CSV
- พบ SAP ใหม่ → auto-create pro_code_sap (status=auto) + auto-classify

**`server/middleware/upload.js`**: เพิ่ม buckets `ipqc`/`fqc` (15MB) + `xlsxUpload` (memory, 25MB)
**`server/index.js`**: mount `/api/pro-code-sap` + `/api/pd-plan`

### ผลทดสอบ (ไฟล์ Planning จริง ALU+uPVC)
- import 169 แถว, 0 errors, ทุก sheet map ถูก
- classifier ถูกต้องทุก sample (FA/FU/ECO/S85/F100)
- DB init clean ผ่าน migrations เดิมทั้งหมด

### ยังไม่ทำ (Phase 1-4 + frontend + docs)
Master CRUD UI, IPQC module, FQC module, monthly approval, exports/dashboard,
nav wiring (rolePermissions/App.jsx), 7 doc files — staged ใน todo

---

## 2026-06-24 | Session 59 — Full PRD Rewrite v2.0 + CLAUDE.md Section 21 + brand.md Sections 11-12

### ปัญหาที่พบและแก้ไขใน PRD v1.0

| Bug | แก้ไข |
|-----|-------|
| `production_line_managers` นิยามซ้ำใน Section 4.1 และ 4.3 | ลบออกจาก 4.3 เหลือที่เดียว |
| IPQC/FQC ใช้ `products(id)` ผิด domain | เปลี่ยนเป็น `pro_code_sap_id` ทั้งสองตาราง |
| `defect_types` ไม่มี `fm_category_id` | เพิ่ม FK → fm_categories |
| `fqc_records.pass_qty` NOT NULL แต่เป็น computed value | ลบออก, compute ที่ query = total-defect |
| ไม่มี `defect_rate_thresholds` table | เพิ่ม table พร้อม NULL=global default |
| ไม่มี `sap_parse_rules` table | เพิ่ม (Rule Editor) |
| ไม่มี `shift_id` ใน `ipqc_records` | เพิ่ม (optional) |
| ไม่มี `pd_plan_id` ใน IPQC/FQC records | เพิ่ม (optional FK) |
| Defect Code formula ไม่ชัดเจน | กำหนด `{factory_code}{fm_code}{process_code}{defect_type_code}` |
| IPQC status transition ไม่มีกฎ | กำหนด: supervisor/manager เปลี่ยนได้, owner แก้ได้ ≤24h |
| `fqc_monthly_approvals` ไม่มี index | เพิ่ม idx_fqc_approval |
| Document sequences ไม่มี seed | เพิ่ม IPQC + FQC ใน seedData() |
| Section 6.1.1 พูดถึง Row 6 อย่างเดียว | แก้เป็น scan-based header |
| `production_lines.factory_code` หายไป | เพิ่ม field สำหรับ Defect Code |
| Monthly Approval prerequisite ไม่ชัด | กำหนด: QC → Prod → CPO ลำดับบังคับ |

### ไฟล์ที่แก้ไข/สร้าง

**`PRD-IPQC-FQC.md`** (v2.0 — rewrite ทั้งหมด):
- Section 4.0.1: เพิ่ม `sap_parse_rules` table
- Section 4.1: เปลี่ยน PDPlan เป็น 4.1, เพิ่ม `factory_code` ใน production_lines
- Section 4.2: Master tables — fix `defect_types` (เพิ่ม fm_category_id), เพิ่ม `defect_rate_thresholds`
- Section 4.3: IPQC — `pro_code_sap_id` แทน `product_id`, เพิ่ม `shift_id`, `pd_plan_id`, `closed_at/by`
- Section 4.4: FQC — `pro_code_sap_id` แทน `product_id`, ลบ `pass_qty`, เพิ่ม `pd_plan_id`, fix monthly approval indexes
- Section 4.5: Document Sequences seed (ใหม่)
- Section 9: Transaction table (ใหม่)
- Section 15/16: เพิ่ม note "ไม่เชื่อม products table"

**`CLAUDE.md`** (เพิ่ม Section 21):
- 21.1: ห้ามสับสน products vs pro_code_sap
- 21.2: Transaction operations บังคับ
- 21.3: Defect Code — server-side only
- 21.4: defect_rate — store at save time
- 21.5: ProCodeSAP — ห้าม serve pending ใน dropdown
- 21.6: PDPlan — scan-based header detection
- 21.7: Upload paths /ipqc/ /fqc/
- 21.8: Sequence seed
- 21.9: Indexes บังคับ
- 21.10: Soft delete / immutability rules
- 21.11: rolePermissions.js navigation group

**`brand.md`** (เพิ่ม Section 11-12):
- 11: IPQC/FQC status badge colors
- 12: SAP Product Number parsing rules (ย้ายจาก brand.md แยก + parsePart3 algorithm)

---

## 2026-06-24 | Session 58 — PRD Update: ProCodeSAP + PDPlan Design (ALU + uPVC)

### `PRD-IPQC-FQC.md` — อัปเดต Section 4.0 และเพิ่ม Section 4.0.1

**PDPlan Format (ยืนยันจากไฟล์ ALU + uPVC):**
- แต่ละ Sheet = 1 สายผลิต (ชื่อ Sheet = รหัสสาย 4 หลัก เช่น `0115`, `0416`)
  - ALU Sheets: `0115`,`0116`,`0117`,`0118`,`0119`,`0217`,`0218`
  - uPVC Sheets: `0416`,`0417`,`0121`,`0219`,`0303`
- **Header Row ไม่คงที่**: ALU = Row 5, uPVC = Row 3 → ต้อง scan หา header row by column name
- บาง Sheet (เช่น `0121`) มีคอลัมน์ SO. พิเศษ → ทำให้ column offset เลื่อน
- **กลยุทธ์ import**: ค้นหา column header โดยชื่อ (`"Product No."`, `"Doc. No."`, ...) ไม่ใช่ตำแหน่ง
- `production_lines.pdplan_sheet` — เพิ่ม field ใหม่สำหรับ map ชื่อ Sheet → Production Line

**ProCodeSAP System Design + FU line parsing rules (Section 4.0.1 ใหม่):**
- `pro_code_sap` table: 1 row ต่อ SAP Product No., เก็บ 13 attributes (ชนิดเส้น, แบรนด์, สีบาน, ขนาด, ชนิดกระจก, มุ้ง, ฯลฯ)
- `classify_status`: `pending` → `auto` → `confirmed` (3 state lifecycle)
- `auto_confidence`: % ความมั่นใจของการ auto-classify (0-100)
- **Auto-classify rules (FA + FU lines ยืนยันจากไฟล์จริง):**
  - Parse Part1: line_type (FA/FU/RU/WO), FU series (S→F100orS85, E→ECO60, W→ECO60-100), brand_code 2 หลักท้าย
  - Parse Part2: panel_type (W=หน้าต่าง, D=ประตู, F=ช่องแสง), color_code 2 หลักท้าย (12=ขาว,13=ชา,14=ดำ)
  - FU special: D+FUS → product_series="S85", W+FUS → product_series="F100"
  - Parse Part3: size split ครึ่งๆ → width_cm × height_cm (รองรับทศนิยม)
  - Parse Description → mosquito_net, glass_type, panel_style (SS/FSSF/SSSS/SFS)
  - Similarity matching: Part1+Part2 เหมือนกัน → copy attributes → confidence 90%
- **Classification Queue UI**: inline edit, highlight suggested values สีเหลือง, [ยืนยัน]/[แก้ไข]/[จำแนกทั้งหมด]
- **PDPlan Import flow**: พบ SAP ใหม่ → auto-create pending ProCodeSAP → แจ้ง admin
- **API** เพิ่ม 7 endpoints: GET list/detail, POST, PATCH, POST confirm, POST auto-classify, GET export

**Sections ที่อัปเดต:**
- Section 1.2: เพิ่มปัญหา "ProCodeSAP: รหัส SAP ใหม่ต้องจำแนก Manual"
- Section 4.0: ปรับ pd_plans table, เพิ่ม pdplan column mapping จากไฟล์จริง
- Section 4.0.1: ProCodeSAP table + auto-classify rules (**ใหม่ทั้งหมด**)
- Section 4.1: production_lines เพิ่ม field `pdplan_sheet`
- Section 6: เพิ่ม 6.1.2 จัดการ ProCodeSAP (Queue + Rule Editor)
- Section 7 Role Matrix: เพิ่มแถว ProCodeSAP management (admin only)
- Section 14 Phase: เพิ่ม Phase 0 — ProCodeSAP & PDPlan (implement ก่อน IPQC/FQC)
- Section 15: เพิ่ม pro_code_sap และ pd_plans ใน connections table
- Section 16: อัปเดต Q4 (PDPlan ✅ answered), เพิ่ม Q10 brand codes, Q11 initial data

---

## 2026-06-24 | Session 57 — KPI Sub-nav ย้ายเข้า Sidebar + Unified Sidebar

### KPI Sub-navigation ย้ายจาก tab bar เข้า Sidebar
- **`client/src/utils/rolePermissions.js`**: `/kpi` เปลี่ยนจาก flat item → group มี children (Dashboard, สรุป KPI, บันทึก KPI, Setup); Setup มี `roles: ['admin']`
- **`client/src/components/Layout/Sidebar.jsx`**: เพิ่ม filter `!child.roles || child.roles.includes(user?.role)` ก่อน render children
- **`client/src/App.jsx`**: เพิ่ม nested route ใต้ `kpi`: `index→dashboard`, `dashboard`, `summary`, `bantuk`, `setup(admin)`, `reports/:id`
- **`client/src/pages/KPI/index.jsx`**: ลบ tab bar ออก, import `useLocation`, ใช้ `pathname.split('/').pop()` หา activeTab, ชื่อหน้า "KPI — {tab}"
- **`server/routes/kpi.js`**: อัพเดท notification link 3 จุด: `/kpi?tab=summary&ap_id=...` → `/kpi/summary?ap_id=...`
- **`client/src/pages/KPI/ReportDetail.jsx`**: back button ชี้ไป `/kpi/summary` แทน `/kpi`

### Unified Sidebar: AdminDash ใช้ Sidebar component เดียวกับ AppLayout

### `client/src/pages/Dashboard/index.jsx` — AdminDash
- **ลบ**: custom dark sidebar drawer ทั้งหมด (~100 บรรทัด) + `sidebarGroup` state + `NAV_ITEMS` import
- **เพิ่ม**: `import Sidebar from '../../components/Layout/Sidebar'`
- **เพิ่ม**: Sidebar overlay ใช้ Sidebar component เดียวกับ AppLayout (transition, backdrop, slide-in)
- **เพิ่ม**: hamburger ใน mobile header ของ AdminDash (ก่อนหน้าไม่มี)
- ผล: sidebar admin dashboard มีรูปแบบ (สี, เมนู, animation) เหมือนกับทุกหน้า

### `client/src/components/Layout/AppLayout.jsx`
- **Hamburger button**: เปลี่ยนจาก `hidden lg:flex` → แสดงทุก screen size
- **Mobile drawer**: เพิ่ม overlay sidebar สำหรับ mobile — fixed position, slide-in animation (translate-x), backdrop คลิกปิด
- **Desktop**: ยังคง Sidebar collapse/expand ใน layout flow เหมือนเดิม
- **sidebarOpen initial state**: desktop (≥1024px) = `true`, mobile = `false`
- **Auto-close**: `useEffect` บน `location.pathname` — ปิด sidebar อัตโนมัติเมื่อ navigate บน mobile
- ลบ IQC text label บน mobile (hamburger อยู่ตำแหน่งเดียวกันแทน)

### `client/src/pages/KPI/index.jsx`
- **Fix year removal**: `saveItem.mutationFn` — destructure `year_targets` ออกจาก body, เพิ่ม loop `api.delete('/kpi/targets/${itemId}/year/${yr}')` สำหรับปีที่ถูก deselect ก่อน upsert

---

## 2026-06-24 | Session 56 — KPI: Fix Drag, Fix Table Update, KPI No. Dropdown, Clear Data

### `server/db/database.js`
- Migration: สร้างตาราง `kpi_no_patterns` — ครั้งแรกที่ตารางไม่มี ให้ DELETE KPI data ทั้งหมดก่อน (foreign_keys OFF)

### `server/routes/kpi.js`
- PATCH /kpi/items/:id: เพิ่ม `group_id` ใน UPDATE (ก่อนหน้าไม่ได้อัพเดท group_id เลย)
- เพิ่ม section KPI NO. PATTERNS: GET/POST/PATCH /kpi/no-patterns

### `client/src/pages/KPI/index.jsx`
- **Fix drag-and-drop**: `handleDrop(targetId)` ใช้ `draggingId` state เป็น source (ก่อนหน้าใช้ parameter ผิด — DROP TARGET id ถูก treat เป็น source ทำให้ cancel ตัวเอง)
- **Fix table update**: `saveItem.onSuccess` ทำ `refetchItems().then(r => setLocalItems(r.data.data))` โดยตรง แทนที่จะพึ่ง useEffect
- **NoPatternForm**: เพิ่ม component ใหม่ (prefix input uppercase, description, preview)
- **SetupTab SUB_TABS**: เพิ่ม 'รูปแบบ KPI' เป็น tab แรก, default section เปลี่ยนเป็น 'patterns'
- **SetupTab**: เพิ่ม noPatterns query/mutations (saveNoPattern, toggleNoPattern)
- **section 'patterns'**: table แสดง prefix, คำอธิบาย, ตัวอย่าง KPI No., toggle สถานะ
- **ItemForm**: `kpi_no_prefix` เปลี่ยนจาก text input เป็น select dropdown (noPatterns prop)
- **ItemForm modal**: ส่ง `noPatterns={noPatterns.filter(p => p.is_active !== 0)}`

---

## 2026-06-24 | Session 55 — KPI Setup: แก้ไข Toast + Refetch ทันที

### Bug fix — `client/src/pages/KPI/index.jsx`
- **SetupTab**: เพิ่ม `const { showToast, ToastPortal } = useToast()` (ไม่มีมาก่อน ทำให้ไม่มี popup สำเร็จ/ผิดพลาด)
- **Mutations ทุกตัว**: เพิ่ม `onError: (e) => showToast(...)` ครบทุกตัว (ก่อนหน้า error ถูก swallow ไม่แสดง)
- **Mutations save**: เพิ่ม `showToast(vars.id ? 'แก้ไข...สำเร็จ' : 'เพิ่ม...สำเร็จ')` ใน `onSuccess` (รู้จากตัวแปร `vars.id`)
- **Query → refetch()**: เปลี่ยนจาก `invalidateQueries` เป็น `refetch()` ตรง (refetchTitles, refetchGroups, refetchItems, refetchUnits) เพื่ออัปเดตตารางทันที
- **Return**: เพิ่ม `{ToastPortal}` ก่อนปิด `</div>`
- **Modal errors**: ลบ duplicate error paragraph ออกจาก saveItem modal (ใช้ toast แทน)

---

## 2026-06-24 | Session 54 — KPI: หน่วย KPI ผูกหัวข้อ + ปรับ ItemForm Layout

### `server/db/database.js`
- Migration: `safeAddColumn('kpi_title_templates', 'unit_id', 'INTEGER')`

### `server/routes/kpi.js`
- `TMPL_SELECT` constant: JOIN kpi_groups + kpi_units → return `group_name` + `unit_name`
- GET/POST/PATCH /title-templates: รองรับ `unit_id` field; PATCH ใช้ CASE WHEN (ป้องกัน empty string)

### `client/src/pages/KPI/index.jsx`
- **TitleTemplateForm**: เพิ่ม `kpiUnits` prop + `unit_id` required select (2-col grid กับ group_id); ลบ helper text "ใช้เป็น dropdown"
- **Setup section "titles"**: ลบ subtitle "ใช้เป็น dropdown..."; เพิ่มคอลัมน์ "หน่วย KPI" ในตาราง (badge สีเขียว)
- **ItemForm — ชื่อ KPI onChange**: เพิ่ม auto-fill `unit: tmpl.unit_name` เมื่อเลือกหัวข้อ
- **ItemForm — หน่วย + กลุ่ม**: เปลี่ยนเป็น read-only display box (bg-bg, cursor-not-allowed) แสดง auto จากหัวข้อ KPI
- **ItemForm — เป้าหมาย + เงื่อนไข**: ย้ายอยู่ grid 2-col แถวเดียวกัน (เป้าหมายซ้าย, เงื่อนไขขวา)

---

## 2026-06-24 | Session 53 — KPI: หัวข้อ KPI ผูกกลุ่ม KPI + Auto-fill Group

### `server/db/database.js`
- Migration: `safeAddColumn('kpi_title_templates', 'group_id', 'INTEGER')` — FK ชี้ไปยัง kpi_groups

### `server/routes/kpi.js`
- GET /kpi/title-templates: เพิ่ม JOIN `kpi_groups` → return `group_name` ด้วย
- POST /kpi/title-templates: รับ `group_id`, validate FK, INSERT พร้อม group_id
- PATCH /kpi/title-templates/:id: รับ `group_id`, update ด้วย CASE WHEN (ป้องกัน empty string ด้วย `|| null`)

### `client/src/pages/KPI/index.jsx`
- **TitleTemplateForm**: เพิ่ม `group_id` select (required, dropdown จาก `groups` prop)
- **titles table**: เพิ่มคอลัมน์ "กลุ่ม KPI" แสดง badge `group_name`
- **TitleTemplateModal**: ส่ง `groups={groups}` prop
- **ItemForm ชื่อ KPI select**: `onChange` auto-fill `group_id` จาก template ที่เลือก พร้อมแสดง `(กลุ่ม)` ใน option label

---

## 2026-06-24 | Session 52 — KPI: Multi-Year Picker, Drag Reorder, หน่วย KPI, ปรับ Form

### `server/db/database.js`
- เพิ่ม migration: `CREATE TABLE IF NOT EXISTS kpi_units (id, name UNIQUE, is_active, created_at)`

### `server/routes/kpi.js`
- เพิ่ม `PATCH /kpi/items/reorder` — รับ `{ items: [{id, display_order}] }` อัปเดตลำดับทั้งหมดใน transaction
- เพิ่ม CRUD routes:
  - `GET /kpi/units` — list (all=1 ดึงทั้งหมด, default เฉพาะ active)
  - `POST /kpi/units` — สร้างหน่วยใหม่
  - `PATCH /kpi/units/:id` — แก้ name / is_active

### `client/src/pages/KPI/index.jsx`

**TitleTemplateForm:** ลบ display_order field ออก

**UnitForm (ใหม่):** Form สำหรับ CRUD `kpi_units` (name field only)

**GroupForm:** ลบ display_order field ออก

**ItemForm (แก้หลายจุด):**
- `target_year` (single select) → `target_years: number[]` (multi-year checkbox grid PICK_YEARS 2567–2577)
- ลบ `display_order` field ออก
- ชื่อ KPI: เหลือแค่ `<select required>` (ลบ free text input ออก)
- หน่วย KPI: `<input>` → `<select required>` จาก `kpiUnits` prop
- เพิ่ม `toggleYear()` — เลือกอย่างน้อย 1 ปีเสมอ

**SetupTab (เพิ่ม/แก้):**
- SUB_TABS เพิ่ม `{ key: 'units', label: 'หน่วย KPI' }` ระหว่าง titles และ groups
- Query `['kpi-units']` → `GET /kpi/units?all=1`
- Mutations: `saveUnit`, `toggleUnit`
- Section 'units': CRUD table สำหรับ kpi_units
- `saveItem` mutation: เปลี่ยนจาก `target_year` เป็น `target_years[]` — loop บันทึก targets ทุกปีที่เลือก
- drag-and-drop: `localItems` state + `draggingId` + `dragOverId` ref + `reorderMutation`
  - handler: `handleDragStart`, `handleDragOver`, `handleDrop`
  - `<tr draggable>` เฉพาะ primary rows (_isFirstOfItem=true)
  - drag icon ☰ ใน column แรก
- Items table: เพิ่มคอลัมน์ drag handle, ลบ "แหล่งข้อมูล" column ออก
- Edit action → ส่ง `target_years_arr` แทน `target_year` (single string)
- titles table: ลบคอลัมน์ "ลำดับ" ออก
- groups table: ลบคอลัมน์ "ลำดับ" ออก

---

## 2026-06-24 | Session 51 — Master List Import: Header Validation ทุก Endpoint

### `server/routes/master.js`

**เพิ่ม helper `checkHeaders(ws, expectedHeaders)`:**
- อ่าน row 1 จาก worksheet
- normalize: strip `*`, trim, lowercase ทั้ง expected และ actual
- เปรียบเทียบทีละ column — ถ้าไม่ตรงรวบรายละเอียดไว้ใน array
- return `[]` ถ้าผ่าน, return `[…mismatches]` ถ้าไม่ผ่าน

**เพิ่ม header validation ใน 6 import routes (ทุกตัว):**

| Route | Expected Headers |
|-------|-----------------|
| `POST /suppliers/import` | รหัสผู้ผลิต, ชื่อผู้ผลิต *, อีเมล, เบอร์โทร, หมายเหตุ |
| `POST /product-groups/import` | รหัสกลุ่ม, ชื่อกลุ่มสินค้า *, บังคับเอกสารตรวจ, บังคับ Lot Number, บังคับวันหมดอายุ, บังคับ Certificate |
| `POST /units/import` | ชื่อหน่วยนับ *, ตัวย่อ |
| `POST /defect-categories/import` | รหัส, ชื่อกลุ่มปัญหา *, หมายเหตุ |
| `POST /colors/import` | รหัสสี, ชื่อสี *, Hex Code |
| `POST /products/import` | รหัสสินค้า, ชื่อสินค้า *, ชื่อ Supplier *, กลุ่มสินค้า *, หน่วยนับ *, Inspection Level, AQL Value, หมายเหตุ |

**Response เมื่อ header ไม่ผ่าน:** HTTP 400, `{ error: 'Header ไม่ตรงกับ template — กรุณาใช้ไฟล์ที่ดาวน์โหลดจากระบบ', headerErrors: [...] }`

---

## 2026-06-24 | Session 50 — KPI: หัวข้อ KPI Tab + KPI No. Prefix + Expand Rows ต่อปี + Dashboard Ref Lines

### `server/routes/kpi.js`

**GET /kpi/items:**
- ลบ `target_years` GROUP_CONCAT subquery ออก
- เพิ่ม query แยก: `SELECT kpi_item_id, year, MIN(target_value) as rep_target FROM kpi_targets GROUP BY kpi_item_id, year`
- Build `ytMap[item_id][year] = rep_target` แล้ว attach เป็น `year_targets` object ต่อ item
- Response: `{ ...item, year_targets: { 2024: 0.20, 2025: 0.15 } | null }`

**POST /kpi/items:**
- รับ `kpi_no_prefix` จาก body (optional, default 'KPI')
- sanitize: `replace(/[^A-Za-z0-9\-]/g, '').toUpperCase()` 
- kpi_no generation: `{prefix}-{seq padded 3}` — seq = MAX(SUBSTR(kpi_no, prefix.length+2)) WHERE kpi_no LIKE `{prefix}-%`
- รองรับ prefix ที่แตกต่างกันในแต่ละ item เช่น "QC-001", "PROD-001"

### `client/src/pages/KPI/index.jsx`

**TitleTemplateForm (ใหม่):**
- Form สำหรับ CRUD หัวข้อ KPI (`kpi_title_templates`)
- fields: name (required), display_order

**SetupTab:**
- เพิ่ม subtab "หัวข้อ KPI" เป็น tab แรก (ก่อน กลุ่ม KPI, รายการ KPI)
- Query: `['kpi-title-templates']` → `GET /kpi/title-templates`
- Mutations: `saveTitleTemplate` (POST/PATCH), `toggleTitleTemplate` (PATCH is_active)
- Modal: `titleModal`, `editingTitle`
- Table แสดง title templates + ToggleSwitch + แก้ไข button
- ลบ `targetsData`/`targetSummary` query ออกจาก SetupTab (ไม่จำเป็นแล้ว)
- `saveItem` mutationFn: destructure `kpi_no_prefix` ออกจาก `itemBody` ก่อน PATCH, ส่งให้ POST เท่านั้น
- ส่ง `titleTemplates={titleTemplates.filter(t => t.is_active !== 0)}` ไปที่ `ItemForm`

**ItemForm:**
- รับ `titleTemplates = []` prop (ใหม่)
- รับ `isEdit = !!initial.id`
- เพิ่ม `kpi_no_prefix: 'KPI'` ใน initial state
- ถ้า `!isEdit`: แสดง input "รูปแบบ KPI No." + preview (เช่น KPI-001)
- ถ้า `isEdit`: แสดง `initial.kpi_no` เป็น read-only div
- "ชื่อ KPI": เพิ่ม `<select>` dropdown จาก `titleTemplates` ด้านบน input (กดเลือกแล้ว fill ลง input)
- ยังคง `<input>` ข้างล่างเพื่อให้กรอกเองได้หรือแก้ไขหลังเลือก

**Items table (expand rows ตามปี):**
- ลบการใช้ `targetSummary` ออกทั้งหมด → ใช้ `item.year_targets` แทน
- expand logic: ต่อ item → parse `year_targets` → ถ้า years.length > 1 และ unique targets > 1 → แตกเป็นหลาย row
- โครงสร้าง row: `{ ...item, _displayYear, _displayTarget, _allYears, _isFirstOfItem }`
  - `_isFirstOfItem=true` → row หลัก แสดง name/กลุ่ม/หน่วย/เงื่อนไข/สรุปปี/DB/toggle/แก้ไข
  - `_isFirstOfItem=false` → sub-row สีฟ้าอ่อน แสดงแค่ "└" + ชื่อ + เป้าหมาย + ปี + ปุ่ม "แก้เป้า"
- ปี tag: `_displayYear` → single tag สีน้ำเงิน primary/10; `_allYears` → multiple gray tags (เป้าเท่ากัน)
- ปุ่มจัดการ: `isFirstOfItem` → "แก้ไข" pre-fill latest year; sub-row → "แก้เป้า" pre-fill ปีนั้น

**DashboardTab:**
- Legend: multi-year → เพิ่ม amber "KPI ปัจจุบัน (เป้าเท่ากันทุกปี)" + per-year colored dashes "(ต่างปี)"
- Legend renderer: เพิ่ม `li.note` แสดงข้อความย่อย opacity-60
- Reference lines: ใช้ `sameTarget` (มีอยู่แล้ว) เพื่อตัดสิน:
  - `multiYear && sameTarget` → เส้นส้มเดียว label "KPI ปัจจุบัน: {target}"
  - `multiYear && !sameTarget` → per-year colored dashed lines
  - `!multiYear` → เส้นส้มเดียว label `{targetA}`

---

## 2026-06-24 | Session 49 — KPI Setup Tab: แสดงเป้าหมายในตาราง + บังคับกรอก

### `client/src/pages/KPI/index.jsx`

**SetupTab — ตาราง รายการ KPI:**
- เพิ่มคอลัมน์ "เป้าหมาย" ระหว่างคอลัมน์ "เงื่อนไข" และ "ปีข้อมูล"
- เพิ่มคอลัมน์ "ปีข้อมูล" แสดงปี พ.ศ. ที่มีเป้าหมายตั้งไว้ (เช่น 2569, 2570) เป็น tag สีเทา
- แสดงค่าเป้าหมายปีปัจจุบัน (`CY`) โดยดึงจาก `GET /kpi/targets?year=${CY}` ใน SetupTab
- `targetSummary[kpi_item_id]`: ถ้าทุกเดือนเท่ากัน → แสดงตัวเลข (text-warning bold); ถ้าต่างกัน → "ตามเดือน" (text-accent); ถ้าไม่มีข้อมูล → "—"
- ปุ่ม "แก้ไข": pre-populate `target_value` และ `target_year` จาก `targetSummary` ก่อนเปิด ItemForm (ถ้า varies → ว่าง)

**server/routes/kpi.js — GET /items:**
- เพิ่ม subquery `GROUP_CONCAT(DISTINCT kt.year ORDER BY kt.year)` เป็น field `target_years` ในแต่ละ item (comma-separated string เช่น "2026,2027")

**ItemForm — เพิ่มรายการ KPI:**
- `target_value`: เพิ่ม `required` + เพิ่ม `*` ใน label

---

## 2026-06-23 | Session 48 — KPI Action Plan Flow QMR + Timeline + Real-time Table + Notification Deep Link

### `server/db/database.js`
- เพิ่ม `migrateKpiActionPlansQmr()`: recreate `kpi_action_plans` table ด้วย `pending_qmr` ใน CHECK constraint + คอลัมน์ `qmr_signed_by/at`
- เรียกใน `runMigrations()` ก่อน seed

### `server/db/schema.sql`
- อัปเดต `kpi_action_plans`: status CHECK เพิ่ม `'pending_qmr'`, เพิ่ม `qmr_signed_by/at`

### `server/routes/kpi.js`
- Approve route: เพิ่ม CPO step (`['cpo','cmo']` → `pending_qmr`) และ QMR step (`qmr` → `approved`)
- Reject route: เพิ่ม `pending_qmr` ในเงื่อนไข allowed
- `apPlanWithJoins`: เพิ่ม JOIN `u4 = qmr_signed_by`, return `qmr_signed_by_name`
- GET action-plans list: เพิ่ม JOIN + `qmr_signed_by_name`
- Notification links เปลี่ยนจาก `'/kpi?tab=summary'` เป็น `/kpi?tab=summary&ap_id=${plan.id}&year=${plan.year}&month=${plan.month}` ทุก route (submit/approve/reject)
- Reject `who` label: เพิ่ม `'qmr'` case

### `client/src/components/UI/Modal.jsx`
- Mobile fix: `max-height: min(90svh, calc(100dvh - env(safe-area-inset-top) - 8px))` แทน `max-h-[90vh]`
- เพิ่ม `padding-top: env(safe-area-inset-top)` ป้องกัน header ชิด address bar iOS

### `client/src/pages/KPI/index.jsx`
- `AP_STATUS`: เพิ่ม `pending_qmr: { label: 'รอ QMR', cls: 'bg-purple-100 text-purple-700' }`
- `ActionPlanModal`:
  - approval steps: Admin → QC Manager → CPO → QMR (4 ขั้น)
  - `canCPO`, `canQMR` เพิ่มเงื่อนไขตาม role/status
  - `steps[]`: เพิ่ม CPO step, QMR ชี้ที่ `qmr_signed_at`
  - Timeline: แสดงเสมอ (ไม่ซ่อนหลัง `actionPlan &&`), ลูกศรครบ `i < steps.length - 1`
  - `localPlan` state: update จาก server response ทันที — modal ไม่รอ parent re-render
  - `patchCache(updatedPlan)`: `qc.setQueryData` update ตารางทันที ไม่รอ network refetch
  - Print PDF: เพิ่ม CPO row ใน signature table, QMR ชี้ที่ `qmr_signed_by_name/at`
  - Print button: แสดงเฉพาะ `ps === 'approved'`, text "สร้าง PDF"
- `KPIPage`: อ่าน URL params `ap_id`, `year`, `month` แล้วส่งเป็น props ให้ SummaryTab
- `SummaryTab`:
  - รับ `autoApId/Year/Month` props
  - `useEffect` auto-open modal เมื่อ `plansData` โหลดแล้วพบ `ap_id` ที่ตรง
  - `autoOpened` flag ป้องกัน re-open ซ้ำ

---

## 2026-06-23 | Session 47 — KPI Summary Type (เฉลี่ย/รวม) + Annual Bar + Pass/Fail Annotation

### `server/db/database.js`
- เพิ่ม migration: `safeAddColumn('kpi_items', 'summary_type', "TEXT DEFAULT 'average'")`

### `server/routes/kpi.js`
- POST /kpi/items: รับ `summary_type` (validate: 'average' | 'sum'), เพิ่มใน INSERT
- PATCH /kpi/items: รับ `summary_type`, validate, เพิ่มใน UPDATE SET

### `client/src/pages/KPI/index.jsx`

**Top-level:**
- เพิ่ม `YEAR_COLORS_DIM = ['#4E7EA0', '#6097C8', '#3AACCC']` สำหรับสีแท่งสรุป
- เพิ่ม helper `calcSummary(records, type)`:
  - `type='average'` → ค่าเฉลี่ยของเดือนที่มีข้อมูล (ใช้ toFixed(2))
  - `type='sum'` → ผลรวมสะสม

**DashboardTab — items.map:**
- คำนวณ `summaryType`, `summaryA/B/C` ต่อปี
- เพิ่มแท่งที่ 13 (`isSummary: true`, `name: 'เฉลี่ย'/'รวม'`) ต่อท้าย chartData (เงื่อนไข: hasSummary)
- `annualPass` = checkFail(summaryA, targetA, dir) สำหรับ badge header
- `mkLabel` อัพเดต: แสดง label เสมอสำหรับแท่งสรุป (สี primary ถ้าผ่าน, แดงถ้าไม่ผ่าน); แสดงเฉพาะไม่ผ่านสำหรับรายเดือน
- ใช้ `<Cell>` สีอ่อน (`YEAR_COLORS_DIM`) สำหรับแท่งสรุปเพื่อแยกจากรายเดือน
- เพิ่ม `<div className="relative">` wrapper รอบ ResponsiveContainer
- Overlay "ผ่านเป้า"/"ไม่ผ่านเป้า" มุมขวาบนของ chart area (absolute positioned)
- Tooltip labelFormatter แยก label ระหว่างเดือนกับแท่งสรุป
- Card header badge เปลี่ยนจาก `overallPass` (ล่าสุด) → `annualPass` (สรุปทั้งปี)
- Header แสดง "สรุป: เฉลี่ย/รวม" ต่อจาก direction label

**ItemForm (SetupTab):**
- เพิ่ม `summary_type: initial.summary_type ?? 'average'` ใน initial state
- เพิ่ม UI toggle 2 ปุ่ม: เฉลี่ย (ค่าเฉลี่ยรายเดือน) / รวม (ผลรวมสะสมทั้งปี)
- Helper text อธิบายผลที่จะเห็นในกราฟ

**SetupTab items table:**
- เพิ่มคอลัมน์ "สรุปปี": badge สีม่วง=รวม, สีเขียวน้ำ=เฉลี่ย
- colSpan empty row: 8 → 9

---

## 2026-06-23 | Session 46 — KPI Year Picker + Fail Labels + Per-Year Ref Lines + Action Plan Flow

### `server/db/schema.sql`
- เพิ่ม table `kpi_action_plans` (approval flow: Admin → QC Manager → CPO)
  - fields: status (draft/pending_qcm/pending_cpo/approved), fail_cause, corrective_action, preventive_action, remark, reject_reason, revision, qcm_signed_by/at, cpo_signed_by/at
  - UNIQUE(kpi_item_id, year, month)

### `server/routes/kpi.js`
- เพิ่ม 5 routes สำหรับ Action Plan approval flow:
  - `GET /kpi/action-plans?year&month` — ดึง plans + joins (users, kpi_items, kpi_groups)
  - `POST /kpi/action-plans` — admin save/update draft (ON CONFLICT upsert)
  - `POST /kpi/action-plans/:id/submit` — admin → pending_qcm + notify qc_manager
  - `POST /kpi/action-plans/:id/approve` — qcm→pending_cpo + notify cpo; cpo→approved + notify admin
  - `POST /kpi/action-plans/:id/reject` — qcm/cpo → draft + revision+1 + notify admin + created_by
- optimistic lock: ตรวจ `result.changes === 0` ใน approve

### `client/src/pages/KPI/index.jsx`

**YearPicker component (ใหม่):**
- Popup grid แสดงปี พ.ศ. 2567–2577 (3 คอลัมน์)
- กดปุ่มเปิด popup, กดข้างนอกปิด (fixed inset-0 backdrop)
- clearable prop สำหรับ optional year (ปีB, ปีC)
- ใช้แทน `<select>` ใน DashboardTab และ SummaryTab

**DashboardTab — 3 การเปลี่ยนแปลง:**
1. เปลี่ยน "ปีที่เกินเป้า = แท่งแดง" → แท่งสีปกติ + **ตัวเลขสีแดงบนแท่ง** ที่ไม่ผ่าน
   - ใช้ `label` prop บน `<Bar>` เป็น closure function (`mkLabel(tgtKey)`)
   - ลบ `<Cell>` array ออกจากทุก Bar
2. **Reference line per year** เมื่อ target ต่างกันระหว่างปี:
   - ถ้าทุกปีเป้าเหมือนกัน → เส้นปะสีส้มเส้นเดียว
   - ถ้าเป้าต่างกัน → เส้นปะแยกสีตามปี (navy/blue/cyan)
   - Card header: แสดง "ปีA: X | ปีB: Y" เมื่อเป้าต่างกัน
3. Legend อัพเดต: ลบ "bar แดง" ออก, เพิ่ม "[4.5] = ค่าที่ไม่ผ่านเป้า"

**ActionPlanModal — redesign ทั้งหมด (approval flow):**
- รับ `actionPlan` (plan object จาก API) + `refetchPlans` callback
- state: `form` (editable fields), `showReject`, `rejectReason`
- `useEffect` populate form จาก actionPlan/actualRecord เมื่อ open
- Permission logic: canEdit (admin+draft), canQCM, canCPO, canSign
- Mutations: saveMut, submitMut, approveMut, rejectMut
- UI sections:
  - KPI info header (read-only)
  - ผลจริง + status badge
  - Reject reason box (แสดงเมื่อถูกส่งกลับ)
  - Content: editable textarea (admin+draft) หรือ read-only box
  - Approval Timeline: 3 steps (Admin → QC Manager → CPO) + สถานะ/ชื่อ
  - Reject form (showReject state): textarea + ยืนยัน
  - Footer: save draft / ส่งอนุมัติ / อนุมัติ (ลงชื่อ online) / ส่งกลับ / ปิด / พิมพ์

**SummaryTab — อัพเดต:**
- เพิ่ม query `['kpi-action-plans', year, month]`
- join `ap` (action plan) ลง rows
- Action Plan column: ถ้ามี ap → แสดง status badge ที่คลิกได้; ถ้าไม่มี+ไม่ผ่าน → "+ สร้าง Action Plan"
- ใช้ YearPicker แทน select
- ส่ง `actionPlan` + `refetchPlans` ไปที่ ActionPlanModal

**printActionPlan — อัพเดต:**
- รับ `actionPlan` object
- Section 3 ตาราง signatures: แสดง Admin/QCM/CPO + ชื่อ + วันที่ออนไลน์
- แสดง status ที่มุมขวาของ print

---

## 2026-06-23 | Session 45 — KPI Dashboard Legend Fix + SummaryTab + Action Plan

### `server/routes/kpi.js`
- แก้ dashboard endpoint: เพิ่ม `target_direction` และ `group_name` ใน item object ที่ส่งกลับ
  - เดิม: ไม่มี `target_direction` → chart header แสดงเงื่อนไขไม่ถูกต้อง
  - แก้: `target_direction: item.target_direction ?? 'gte'`, `group_name: item.group_name ?? group.name`

### `client/src/pages/KPI/index.jsx`

**DashboardTab — แก้สีกราฟกับ legend ไม่ตรงกัน:**
- ลบ `<Legend>` ของ recharts ออก (เพราะ recharts ใช้สี `fill` ของ `<Bar>` ไม่ใช่สี `<Cell>`)
- ใส่ custom legend เป็น `flex` badge row ใต้ year selectors — สีตรงกับ chart 100%
- ทุก `<Bar>` ใช้ `legendType="none"` เพื่อป้องกัน legend อัตโนมัติ
- simplify: ใช้ `lblA/lblB/lblC` แทน `activeYears` array (ลด complexity ลง)

**Tab: ลบ "รายการ KPI" / เพิ่ม "สรุป KPI":**
- ลบ tab `รายการ KPI` และ `KpiListTab` component ออก
- เพิ่ม tab `สรุป KPI` → `SummaryTab`

**SummaryTab (ใหม่):**
- Year + Month selector
- Fetch: `kpi-items-active`, `kpi-targets/{year}`, `kpi-actuals?year&month`
- Join ทั้ง 3 dataset → แสดงตาราง KPI No. | ชื่อ | กลุ่ม | หน่วย | เงื่อนไข | เป้าหมาย | ค่าจริง | สถานะ | Action Plan
- Status badge: ผ่าน (เขียว) / ไม่ผ่าน (แดง) / ยังไม่บันทึก (เทา)
- แถวที่ไม่ผ่าน: highlight red-50 + ปุ่ม "Action Plan"
- Summary counters: นับไม่ผ่าน/ผ่าน/ยังไม่บันทึก

**ActionPlanModal (ใหม่):**
- Modal `size="lg"` แสดง KPI info, ค่าจริง vs เป้า, fail_cause/corrective_action/preventive_action
- ข้อมูล read-only (แก้ใน tab "บันทึก KPI")
- ปุ่ม "พิมพ์เอกสาร Action Plan"

**printActionPlan() (ใหม่):**
- เปิด popup window ใหม่ + `window.print()` after 500ms
- HTML layout: ข้อมูล KPI | การวิเคราะห์ | ลายเซ็น 3 ช่อง
- ฟอนต์ IBM Plex Sans Thai / Sarabun

---

## 2026-06-23 | Session 44 — KPI Dashboard Multi-Year + Table Column Reorder

### `client/src/pages/KPI/index.jsx`

**Dashboard (DashboardTab) — redesign ครั้งใหญ่:**
- เพิ่ม helper: `checkFail(actual, target, direction)`, `buildItemMonthMap(apiData)`, `YEAR_COLORS`, `FAIL_COLOR`
- เปลี่ยนจาก 1 year selector → 3 year selectors (ปีA บังคับ, ปีB ปีC optional)
  - ปีA: เปรียบเทียบหลัก — fetch `/kpi/dashboard?year=A`
  - ปีB/C: fetch เพิ่มเติมเมื่อเลือก (`enabled: !!yearB`)
  - Legend color indicator แสดงในแถบเครื่องมือ
- กราฟ: แสดงสูงสุด 3 แท่งต่อเดือน (ปีA=navy, ปีB=accent, ปีC=cyan)
- **Bar สีแดงเมื่อไม่ผ่านเป้า**: ใช้ `<Cell>` ของ recharts ตรวจ `checkFail()` ต่อ cell
  - แต่ละแท่งตรวจ target ของปีตัวเอง (ไม่ใช้ target ของ yearA ทับทุกปี)
- Header KPI card: เพิ่มแสดง direction (ไม่เกิน/ไม่ต่ำกว่า) + target value

**Setup Tables — Reorder columns:**
- กลุ่ม KPI: ลำดับ | ชื่อกลุ่ม | จัดการ | สถานะ (ลำดับมาหน้าสุด, สถานะมาหลังจัดการ)
- รายการ KPI: KPI No. | ชื่อ KPI | กลุ่ม | หน่วย | เงื่อนไข | แหล่งข้อมูล | จัดการ | สถานะ

---

## 2026-06-23 | Session 43 — KPI target_direction (ไม่เกิน / ไม่ต่ำกว่า)

### Backend
- `server/db/database.js`: เพิ่ม migration `safeAddColumn('kpi_items', 'target_direction', "TEXT DEFAULT 'gte'")`
  - `gte` = ไม่ต่ำกว่า (ค่าจริง ≥ เป้า = ผ่าน) — default
  - `lte` = ไม่เกิน (ค่าจริง ≤ เป้า = ผ่าน)
- `server/routes/kpi.js`:
  - POST /kpi/items: รับ `target_direction` + validate ว่าต้องเป็น gte|lte
  - PATCH /kpi/items/:id: รับ `target_direction` + validate + UPDATE

### Frontend — `client/src/pages/KPI/index.jsx`
- **ItemForm**: เพิ่มฟิลด์ "เงื่อนไขเป้าหมาย" เป็น toggle button 2 ตัว (ไม่ต่ำกว่า / ไม่เกิน) พร้อม hint ว่าเงื่อนไข pass คืออะไร; เป้าหมายแสดง hint ตาม direction ที่เลือก
- **Setup items table**: เพิ่มคอลัมน์ "เงื่อนไข" แสดง badge ไม่เกิน (orange) / ไม่ต่ำกว่า (blue)
- **BantukTab**: แสดง label เงื่อนไขใต้ตัวเลขเป้าหมาย; logic `isFail()` ตรวจ direction:
  - `lte`: fail เมื่อ actual > target
  - `gte`: fail เมื่อ actual < target

---

## 2026-06-23 | Session 42 — KPI Setup Bug Fixes + UX Improvements

### `client/src/pages/KPI/index.jsx`
**Bug fixes:**
- แก้ Modal prop: `isOpen` → `open` (Modal component ใช้ `open` ไม่ใช่ `isOpen`) — สาเหตุที่ปุ่ม + เพิ่มกลุ่ม / + เพิ่ม KPI กดแล้วไม่เปิด
- แก้ ConfirmDialog prop: `onCancel` → `onClose` (component ใช้ `onClose`)
- เพิ่ม import `ToggleSwitch` ที่ยังขาดอยู่

**UX Improvements:**
- ลบ MAX_KPI = 9 limit ออก — รายการ KPI ไม่จำกัดจำนวน (Master List concept)
- ฟอร์ม + เพิ่ม KPI เพิ่มฟิลด์: ปีที่ใช้ KPI (year selector) + เป้าหมาย KPI (ตัวเลข)
  - เมื่อบันทึก: หากกรอกเป้าหมาย → บันทึกเป้าหมายทุกเดือน (1-12) ของปีนั้นพร้อมกัน
- คอลัมน์ "สถานะ" ทั้ง กลุ่ม KPI และ รายการ KPI → ToggleSwitch เปิด/ปิดได้ทันที
- ลบปุ่ม "ปิด" แยกต่างหาก (ใช้ toggle แทน)

---

## 2026-06-23 | Session 41 — KPI Major Redesign (kpi_actuals + New UI)

### Backend
- `server/db/schema.sql`: เพิ่มตาราง `kpi_actuals` (id, kpi_item_id, year, month, actual_value, fail_cause, corrective_action, preventive_action, remark, created_by, updated_by, created_at, updated_at) + 2 indexes + UNIQUE(kpi_item_id, year, month)
- `server/routes/kpi.js`: เพิ่ม 3 endpoints:
  - `GET /api/kpi/actuals?year=&month=` — ดึงข้อมูลจริงพร้อม join group/item/user
  - `POST /api/kpi/actuals` — upsert record เดียว (ON CONFLICT DO UPDATE)
  - `POST /api/kpi/actuals/bulk` — บันทึกทุก KPI ของเดือนพร้อมกัน (transaction)
- `server/routes/kpi.js` dashboard: เปลี่ยนจาก `kpi_report_entries` → `kpi_actuals` (ไม่ผูกกับ approval flow)

### Frontend — `client/src/pages/KPI/index.jsx` (เขียนใหม่ทั้งหมด)
**แท็บ Dashboard:**
- เลือกปี + เปรียบเทียบ prevYear vs currentYear
- แสดง grouped bar chart ต่อ KPI item (max 9): 12 เดือน × 2 bars (ปีก่อน + ปีนี้ สีอ่อน/เข้ม)
- ReferenceLine แสดงเป้าหมาย, badge ผ่าน/ไม่ผ่านเป้า

**แท็บ รายการ KPI:**
- ตาราง KPI ที่ active พร้อม badge จำนวน (max 9)
- ตาราง `TargetsSection` ต่อท้าย: grid 12 เดือน × item, บันทึกได้ต่อปี

**แท็บ บันทึก KPI (แทน รายงาน KPI):**
- เลือกปี + เดือน → โหลดข้อมูลจริงของเดือนนั้น
- แสดง KPI ทุกรายการ: info + เป้าหมาย + input ค่าจริง + badge ผ่าน/ไม่ผ่าน
- เฉพาะ `data_source_type=manual` กรอกได้ / ฐานข้อมูลแสดง read-only
- **KPI fail:** แสดง 3 textarea — สาเหตุ, วิธีการแก้ไข, วิธีการป้องกัน (ในขอบสีแดง)
- บันทึกผ่าน `/api/kpi/actuals/bulk` (transaction)

**แท็บ Setup (admin):**
- sub-tab กลุ่ม KPI: ตาราง + Modal form (label/input style ตาม Master List)
- sub-tab รายการ KPI: ตาราง + Modal form (เลือกกลุ่ม, ชื่อ, หน่วย, แหล่งข้อมูล manual/database)
- ตัด "เป้าหมาย KPI" sub-tab ออก (ย้ายไปอยู่ใต้ รายการ KPI แทน)

---

## 2026-06-23 | Session 40 — KPI Management Module (Full Feature)

### Backend
- `server/db/schema.sql`: เพิ่ม 7 ตาราง KPI: `kpi_groups`, `kpi_items`, `kpi_targets`, `kpi_reports`, `kpi_report_entries`, `kpi_report_files`, `kpi_approvals` + 6 indexes
- `server/db/database.js`: เพิ่ม `db.nextKPICode()`, seed sequence KPI, seed default groups (งานคุณภาพ/ความปลอดภัย/สิ่งแวดล้อม/การผลิต)
- `server/routes/kpi.js` (ใหม่, 894 บรรทัด): ครอบคลุมทุก API:
  - Groups: CRUD (soft-delete, block if has items)
  - Items: CRUD + auto-gen kpi_no + GET /db-sources (4 predefined: ncr_count, ncr_closed_rate, bills_count, pass_rate)
  - Targets: GET/POST upsert per year
  - Reports: create, list, detail, update entries, submit, approve (3 ขั้น), reject, revise
  - Files per entry: upload + delete
  - Dashboard: year-over-year comparison (current + prev year) grouped by group→item
  - ทุก write ใช้ transaction + auditLog + notification
- `server/index.js`: mount `/api/kpi`

### Frontend
- `client/src/pages/KPI/index.jsx` (ใหม่, 881 บรรทัด):
  - Tab 1 Dashboard: bar chart 12 เดือน เปรียบเทียบ Target/ปีก่อน/ปีนี้
  - Tab 2 Report List: ตาราง + card mobile, filter year/month/status, modal สร้างรายงาน
  - Tab 3 Setup (admin): Groups inline edit, Items modal (manual/database source), Targets grid 12 เดือน
- `client/src/pages/KPI/ReportDetail.jsx` (ใหม่, 588 บรรทัด): header, role-based buttons, reject modal, KPI table edit mode, file upload, approval timeline
- `client/src/utils/rolePermissions.js`: เพิ่ม KPI nav item (roles: admin, qc_manager, cpo, qmr)
- `client/src/components/Layout/Sidebar.jsx`: เพิ่ม icon `kpi`
- `client/src/components/Layout/BottomNav.jsx`: เพิ่ม icon `kpi`
- `client/src/App.jsx`: เพิ่ม routes `/kpi` และ `/kpi/reports/:id`

### KPI Approval Flow
```
draft → (admin ส่ง) → pending_qc_manager → (QC Manager อนุมัติ) →
pending_cpo → (CPO อนุมัติ) → pending_qmr → (QMR อนุมัติ) → approved
ทุกขั้น: ไม่อนุมัติ → rejected → admin แก้ไข → revise → draft → เริ่มใหม่
```

---

## 2026-06-23 | Session 39 — Admin Desktop Sidebar Drawer

### `client/src/pages/Dashboard/index.jsx`
- นำเข้า `NAV_ITEMS` จาก `utils/rolePermissions.js`
- เปลี่ยน `menuOpen` state (เล็ก 3-item dropdown) → `sidebarOpen` + `sidebarGroup` (Set ของ group ที่ expand)
- ปุ่ม "เปิดเมนู" → ปุ่ม "เมนู" พร้อมไอคอน hamburger
- เพิ่ม Sidebar Drawer (fixed overlay จากซ้าย) ที่แสดงเมื่อกดปุ่ม:
  - Backdrop คลิกเพื่อปิด
  - Panel w-64 มี header (IQC System + ชื่อผู้ใช้ + ปุ่ม X)
  - แสดงทุกเมนูที่ admin เข้าได้จาก NAV_ITEMS (หน้าหลัก, บิลรับเข้า, NCR, UAI, ปฏิทิน, Issue Talk, เช็คชื่อ QC, จัดการระบบ, Master List)
  - กลุ่มที่มี children: accordion toggle (เปิด /admin และ /master ไว้ก่อน)
  - Children: dot bullet + label, indent pl-9
  - ด้านล่าง: ปุ่มเปลี่ยนรหัสผ่าน + ออกจากระบบ (สีแดง)
  - ใช้ dark theme D.* ครบ ไม่มี gradient/emoji

---

## 2026-06-23 | Session 38 — Image Compression + BottomNav Group Popup

### Server: Image Compression (sharp)
- เพิ่ม `sharp ^0.33.5` ใน `server/package.json` + อัปเดต `package-lock.json`
- เพิ่ม `compressImages` async middleware ใน `server/middleware/upload.js`:
  - ทำงานหลัง `verifyMagic` — ประมวลผลเฉพาะ JPEG/PNG/WebP (ข้าม GIF/PDF/Video อัตโนมัติ)
  - Auto-rotate ตาม EXIF → resize max 1920×1920px (`fit: inside`, no upscale)
  - JPEG quality 82 progressive, PNG compressionLevel 8, WebP quality 82
  - ใช้ compressed เฉพาะเมื่อไฟล์เล็กกว่าต้นฉบับ (กัน edge case ที่ compressed ใหญ่กว่า)
  - Non-fatal: ถ้า sharp error → log แล้วใช้ไฟล์ต้นฉบับต่อไป ไม่ crash
- เพิ่ม `uploads.compressImages` หลัง `uploads.verifyMagic` ใน 16 routes ครอบคลุมทั้ง project:
  - `bills.js` (4 routes: bill images, item images, inspection-docs, certificates)
  - `ncr.js` (3 routes: create NCR, re-inspect, add images)
  - `master.js` (3 routes: product images, drawings)
  - `supplier.js`, `uai.js`, `delivery.js`, `issue-talk.js` (1-2 routes each)

### BottomNav: Group Popup/Bottom Sheet (Admin)
- เพิ่ม `useLocation` import + `activeGroup` state
- Main bar items ที่มี `children` (Master List, จัดการระบบ) → render เป็น `<button>` แทน `<NavLink>`
- แตะ icon → เปิด bottom sheet slide-up เหนือ nav bar (z-50, backdrop z-40)
- Sheet แสดง label ของ group + รายการลูกทั้งหมดพร้อม checkmark สำหรับ active path
- ปิดได้โดย: แตะ backdrop, ปุ่ม ✕, หรือกดเลือกรายการ
- Icon ใน nav bar เปลี่ยนสี primary เมื่ออยู่ใน child path

---

## 2026-06-23 | Session 37 — Mobile UX: Master List Cards + Back Buttons

### Master List Pages — Mobile Card Views (6 หน้า)
- **`Master/Suppliers.jsx`**: เพิ่ม mobile card (`md:hidden`): ชื่อ + รหัส, email/phone, badge สถานะ, ปุ่มแก้ไข/toggle; fix form grid-cols-1 sm:grid-cols-2
- **`Master/ProductGroups.jsx`**: card: ชื่อ + รหัส, badge บังคับเอกสาร, ปุ่มแก้ไข/toggle; fix form grid
- **`Master/Units.jsx`**: card: ชื่อ + ตัวย่อ (mono), badge สถานะ, ปุ่มแก้ไข/toggle
- **`Master/DefectCategories.jsx`**: card: ชื่อ + รหัส, หมายเหตุ, badge สถานะ; fix form grid
- **`Master/Colors.jsx`**: card: color swatch circle + ชื่อ + รหัส + hex (mono), badge สถานะ; fix form grid
- **`Master/Products.jsx`**: card: ชื่อ + รหัส, Supplier(s), group badge, AQL badge, สี, Drawing link, รูปสินค้า/งานเสีย; fix form grid ทุก section
- Pattern ทุกไฟล์: Desktop table → `hidden md:block table-container`; Mobile card → `md:hidden space-y-2`

### Back Button — ทุกหน้า Detail
- **`Bills/Detail.jsx`**: เพิ่มปุ่มกลับ `← กลับ` (`navigate(-1)`) ก่อน page-header
- **`NCR/Detail.jsx`**: เพิ่มปุ่มกลับ `← กลับ` ก่อน page-header
- **`UAI/Detail.jsx`**: import `useNavigate`, เพิ่ม `const navigate = useNavigate()`, เพิ่มปุ่มกลับ ก่อน page-header

### Admin Users — Mobile Card View (Session 36.5)
- เพิ่ม mobile card view (md:hidden): username + badge สถานะ, ชื่อ-นามสกุล, role badge + QC station, TG/วันที่สร้าง, ปุ่ม แก้ไข/ทดสอบ TG/Reset PW/toggle (min-h-[44px])
- Fix UserForm grid-cols-1 sm:grid-cols-2, header + button ปรับ responsive

---

## 2026-06-23 | Session 36 — Mobile UX Overhaul

### Mobile Card Views (List Pages)
- **`Bills/index.jsx`**: เพิ่ม mobile card list (`md:hidden`) แสดง Invoice, Supplier, วันที่, สถานะ, NCR info — ซ่อน table 12 คอลัมน์บน mobile (`hidden md:block`)
- **`NCR/index.jsx`**: mobile card list แสดง รหัส NCR, Supplier, ประเภท NCR/NCP, สถานะ
- **`UAI/index.jsx`**: mobile card list แสดง รหัส UAI, NCR อ้างอิง, Supplier, สถานะ

### Bills/index.jsx — Header & UX
- Header buttons (สรุปรับเข้าวันนี้, Export ข้อมูลบิล, + สร้าง) → icon-only บน mobile, แสดงข้อความบน sm+
- Pagination buttons: `py-1.5` → `min-h-[44px]` (touch target)
- Delete button in table: `p-1.5` → `min-h-[44px] min-w-[44px]`
- Export modal: `grid-cols-3` → `grid-cols-1 sm:grid-cols-3`
- Badge text: ลบ `!text-[10px]` override, `text-xs` → `text-[12px]`

### Touch Targets — Delete buttons บน Image Thumbnails
- ทุกไฟล์: `w-5 h-5` / `w-4 h-4` delete buttons → `w-6 h-6`, `text-[10px]` → `text-[12px]`, เพิ่ม `shadow`
- ไฟล์ที่แก้: Bills/New.jsx, NCR/New.jsx, NCR/Detail.jsx, UAI/Detail.jsx, Admin/Settings.jsx, Master/Products.jsx, Delivery/index.jsx

### Text Size Floor: ≥ 12px
- ทุกไฟล์: ยกระดับ `text-[9px]`, `text-[10px]`, `text-[11px]` → `text-[12px]` หรือ `text-small`
- ไฟล์ที่แก้: Bills/New.jsx, Bills/index.jsx, NCR/New.jsx, NCR/Detail.jsx, UAI/Detail.jsx, Admin/Settings.jsx, Admin/Users.jsx, Master/Products.jsx, Delivery/index.jsx

### ImageUploadPair Component (Session 35)
- สร้าง `components/UI/ImageUploadPair.jsx`: 2 ปุ่ม ถ่ายรูป / คลังภาพ
- ใช้งานทุกจุด upload รูปใน 7 ไฟล์ (Bills/New, NCR/New, NCR/Detail, UAI/Detail, Delivery, Master/Products, Admin/Settings)

### AppLayout — Mobile Scroll (Session 35)
- Mobile: เปลี่ยนจาก `h-screen overflow-hidden` → body scroll ตามธรรมชาติ
- Header เลื่อนหายพร้อมเนื้อหา (ไม่ lock)
- Desktop (lg+): เหมือนเดิม

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
