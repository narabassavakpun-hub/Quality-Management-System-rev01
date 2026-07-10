> ⚠️ **DEPRECATED (2026-07-02)** — เนื้อหาถูกรวมเข้า [`PRD.md`](PRD.md) v3.0 (consolidated) แล้ว เก็บไว้เป็นประวัติเท่านั้น

# PRD — ระบบบันทึก IPQC & FQC
**Version:** 2.0 | **Date:** 2026-06-24 | **Project:** IQC System rev01

---

## 1. ที่มาและวัตถุประสงค์

### 1.1 ระบบเดิม (Excel VBA)

ไฟล์ `ระบบบันทึก QC.xlsm` มี VBA Forms หลัก 2 ส่วน:

| Form | หน้าที่ | Sheet เก็บข้อมูล |
|------|---------|-----------------|
| `RecordProblem.frm` | **IPQC** — บันทึกของเสียระหว่างผลิต | Sheet6 (DataDefect) |
| `ProductionOutput.frm` | **FQC** — บันทึกผลผลิตรายวัน | Sheet7 (ProductionOutput) |
| `ReportDefect.frm` | รายงานประจำเดือน + อนุมัติรับทราบ | Sheet13 (PivotTable) |
| `PartSearch.frm` | ค้นหา/จัดการ Master Part | Sheet4 (DataPart) |
| `AddProCodeSAP.frm` | เพิ่มรหัส SAP + รายละเอียดสินค้า | Sheet8 (ProCodeSAP) |

### 1.2 ปัญหาของระบบเดิม

| ปัญหา | ผลกระทบ |
|-------|---------|
| ไฟล์ Excel เดียว — หลายคนใช้พร้อมกันไม่ได้ | ต้องรอคิว, ข้อมูลชนกัน |
| Photos เก็บ Local folder (`ProblemPic/`) | คนอื่นเปิดดูไม่ได้, ย้ายเครื่องหาย |
| ต้องใช้ PC ที่ติดตั้ง Excel เท่านั้น | พนักงานหน้างานเข้าไม่ได้จาก Tablet/Mobile |
| Defect Code ซับซ้อน (ต่อ 4 รหัสเอง) | Error-prone, ใช้เวลา |
| ProCodeSAP: รหัส SAP ใหม่ต้องจำแนก Manual | พนักงานดูรหัสแล้วแยก 13 attribute ด้วยตัวเองทำให้ผิดพลาด |
| Advanced Filter ช้าสำหรับข้อมูลมาก | ประสิทธิภาพลดลงเมื่อข้อมูลสะสม |
| ไม่มี Real-time Notification | Supervisor ไม่รู้ทันทีเมื่อเกิดของเสีย |
| Approval รายเดือนทำบน Form (ReportDefect) | ไม่มีหลักฐาน Audit trail |

### 1.3 เป้าหมาย

1. พนักงานหน้างานบันทึกข้อมูลได้เอง จากมือถือหรือ Tablet — **ไม่ต้องพึ่ง PC**
2. Admin ตั้งค่า Master data ผ่าน Web UI — **ไม่ต้องแก้ Excel**
3. Supervisor รับ Notification ทันทีเมื่อมีของเสีย
4. รายงานรายเดือนพร้อม Approval workflow มี Audit trail

---

## 2. ความเข้าใจระบบเดิมโดยละเอียด

### 2.1 โครงสร้างข้อมูล IPQC (RecordProblem → Sheet6)

```
ฟิลด์ที่บันทึกใน Sheet6 (DataDefect):
- No (auto increment)
- วันที่พบปัญหา (Date - N วัน จาก ComboBox8)
- วันที่บันทึก
- PO Number (TextBox)
- รหัส SAP (TextBox8) — lookup จาก Sheet8 (ProCodeSAP)
- ชื่อสินค้า
- โรงงาน (ComboBox4: 1=F01, 2=F02, 4=F04)
- กระบวนการที่พบปัญหา (ComboBox5)
- FM Category (ComboBox3: Man/Machine/Material/Method)
- Defect Code (auto-gen: FactoryCode+FMCode+ProcessCode+ProblemCode)
- รายละเอียดปัญหา (TextBox6)
- พนักงานที่รับผิดชอบ (ComboBox6)
- จำนวนของเสีย (TextBox11)
- รูปภาพ 1-15 ใบ (เก็บใน ProblemPic\{SAPCode}\{DefectCode}\{n}.JPG)
- Username ผู้บันทึก
```

### 2.2 โครงสร้างข้อมูล FQC (ProductionOutput → Sheet7)

```
ฟิลด์ที่บันทึกใน Sheet7:
- No (auto increment)
- รหัส SAP → lookup จาก Sheet8 (ProCodeSAP) ได้ attributes ทั้งหมด
- ชื่อสินค้า
- PO Number
- จำนวนผลิต (TextBox6)
- จำนวนของเสีย (TextBox5)
- วันที่ตรวจสอบ
- วันที่บันทึก
- บริษัท/โรงงานที่ผลิต (ComboBox9)
- กะการผลิต (ComboBox10)
- เดือน/ปี (auto)
- ผู้บันทึก
- Attributes จาก ProCodeSAP:
  ชนิดเส้น, รุ่นสินค้า, แบรนด์, ชนิดบาน, รูปแบบบาน,
  ลายเหล็กดัด, สีเหล็กดัด, ชนิดกระจก, สถานะมุ้ง,
  สีบาน, ขนาดบาน, รุ่นออกแบบ, อื่นๆ
```

### 2.3 Logic การสร้าง Defect Code

```
DefectCode = FactoryCode + FMCode + ProcessCode + ProblemCode

แต่ละส่วนมาจากตารางอ้างอิงใน Sheet5
ตัวอย่าง: "01MTC001"
  01  = Factory F01
  M   = FM Category: Machine
  TC  = Process: ตัด
  001 = Defect Type: ขอบบิ่น (สำหรับ F01)
```

### 2.4 กระบวนการผลิต (Process Steps จาก AddProblem.frm)

1. ขั้นตอนการตัด
2. ขั้นตอนการเล้าเตอร์ล้อมุ้ง
3. ขั้นตอนการเล้าเตอร์มือจับมุ้ง
4. ขั้นตอนการใส่สักหลาด
5. ขั้นตอนการเข้าฉาก
6. ขั้นตอนการเข้ามุ้ง
7. ขั้นตอนการใส่กระจก
8. ขั้นตอนการประกอบเฟรม
9. ขั้นตอนการประกอบบาน
10. ขั้นตอนการประกอบเหล็กดัด
11. ขั้นตอนการทดสอบบาน
12. ขั้นตอนการแพ็คกิ้ง

### 2.5 Approval Flow รายเดือน (ReportDefect.frm)

```
ทุกเดือน ทุกสายผลิต ต้องได้รับ "รับทราบ" จาก 3 ระดับ:
1. QC Manager (ทุกสาย)
2. Production Manager ของแต่ละสาย (ALU/UPVC แยกกัน)
3. CPO (ภาพรวม)

สถานะใน Form เดิม: รอตรวจสอบ (เหลือง) | รับทราบ (เขียว) | ไม่มีของเสีย (ฟ้า)
```

---

## 3. การออกแบบระบบใหม่

### 3.1 หลักการออกแบบ

**Worker-first design:**
- 4 step บันทึกข้อมูลได้ — เลือกสินค้า → ข้อมูลการผลิต → รายละเอียดของเสีย → รูปภาพ → บันทึก
- ทำงานได้บน Tablet/Mobile ที่หน้างาน (44px touch targets ทุกปุ่ม)
- Defect Code Auto-generate — ไม่ต้องจำ
- Dropdown มาจาก Master ที่ Admin ตั้งไว้

**Admin: Zero Excel:**
- ตั้งค่า Master data ทั้งหมดผ่าน Web UI
- ไม่ต้องแก้ VBA หรือ Excel

### 3.2 ข้อแตกต่างสำคัญจากระบบ IQC รับเข้า

> ⚠️ **IPQC/FQC ใช้ `pro_code_sap` ไม่ใช่ `products` table**
>
> | Table | ใช้กับ | ประเภทสินค้า |
> |-------|--------|------------|
> | `products` | Bills, NCR (IQC รับเข้า) | วัตถุดิบจาก Supplier |
> | `pro_code_sap` | IPQC, FQC | สินค้าผลิตสำเร็จรูป (SAP code) |
>
> ทั้งสองเป็นคนละ domain อย่าสับสน

---

## 4. Data Model

### 4.0 ProCodeSAP — ระบบจำแนก SAP Code

**ปัญหา:** SAP code ใหม่ปรากฏตลอดเวลา พนักงานต้องจำแนก 13 attributes ด้วยตัวเอง → ผิดพลาดสูง

#### 4.0.1 ตาราง pro_code_sap

```sql
CREATE TABLE IF NOT EXISTS pro_code_sap (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  product_no       TEXT UNIQUE NOT NULL,       -- รหัสสินค้า SAP เช่น 'FA00-W0313-240110'
  product_desc     TEXT,                       -- ชื่อสินค้า (จาก PDPlan)
  sap_part1        TEXT,                       -- ส่วนแรก เช่น 'FA00'
  sap_part2        TEXT,                       -- ส่วนกลาง เช่น 'W0313'
  sap_part3        TEXT,                       -- ส่วนท้าย เช่น '240110'

  -- Attributes (ดู brand.md สำหรับ parsing rules)
  line_type        TEXT,                       -- FA, FU, RU, WO
  product_series   TEXT,                       -- F100, S85, ECO 60, ECO 60-100, ORM, ...
  brand            TEXT,                       -- WINDOW ASIA, FRAMEX, FINEXT, ...
  panel_type       TEXT,                       -- หน้าต่าง, ประตู, ช่องแสง
  panel_style      TEXT,                       -- SS, FSSF, SSSS, SFS, ...
  iron_pattern     TEXT,                       -- ลายเหล็กดัด
  iron_color       TEXT,                       -- สีเหล็กดัด
  glass_type       TEXT,                       -- กระจก, ไม่มีกระจก
  mosquito_net     TEXT,                       -- มุ้ง, ไม่มีมุ้ง
  panel_color      TEXT,                       -- สีขาว, สีชา, สีดำ, ...
  panel_size       TEXT,                       -- '240x110', '120x110', ...
  width_mm         INTEGER,                    -- ความกว้าง mm (parsed จาก Part3 × 10)
  height_mm        INTEGER,                    -- ความสูง mm (parsed จาก Part3 × 10)
  design_version   TEXT,                       -- รุ่นออกแบบ
  remarks          TEXT,                       -- อื่นๆ

  -- Classification workflow
  classify_status  TEXT NOT NULL DEFAULT 'pending'
                   CHECK(classify_status IN ('pending','auto','confirmed','rejected')),
  auto_confidence  INTEGER DEFAULT 0,          -- 0-100 %
  classified_by    INTEGER REFERENCES users(id),
  classified_at    DATETIME,
  created_at       DATETIME DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pro_code_no       ON pro_code_sap(product_no);
CREATE INDEX IF NOT EXISTS idx_pro_code_brand    ON pro_code_sap(brand);
CREATE INDEX IF NOT EXISTS idx_pro_code_type     ON pro_code_sap(line_type);
CREATE INDEX IF NOT EXISTS idx_pro_code_status   ON pro_code_sap(classify_status);
CREATE INDEX IF NOT EXISTS idx_pro_code_color    ON pro_code_sap(panel_color);
CREATE INDEX IF NOT EXISTS idx_pro_code_size     ON pro_code_sap(panel_size);
```

#### 4.0.2 ตาราง sap_parse_rules (Rule Editor)

```sql
CREATE TABLE IF NOT EXISTS sap_parse_rules (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_type    TEXT NOT NULL CHECK(rule_type IN ('part1_prefix','part2_prefix','desc_contains')),
  match_value  TEXT NOT NULL,                  -- ค่าที่ match (เช่น 'FA22', 'ECO')
  target_field TEXT NOT NULL,                  -- attribute ที่จะ set (เช่น 'brand')
  set_value    TEXT NOT NULL,                  -- ค่าที่จะ set (เช่น 'WINDOW ASIA')
  priority     INTEGER DEFAULT 0,              -- สูงกว่า = ใช้ก่อน
  is_active    INTEGER DEFAULT 1,
  created_by   INTEGER REFERENCES users(id),
  created_at   DATETIME DEFAULT (datetime('now'))
);
```

**Classify Status Lifecycle:**
```
pending  → ค้นพบจาก PDPlan import แต่ยังไม่ classify
auto     → auto-classify รันแล้ว (confidence ≥ 40%) รอ admin ยืนยัน
confirmed → admin ยืนยันแล้ว — ใช้งานได้ใน IPQC/FQC filter
rejected  → admin ปฏิเสธ (reclassify ใหม่ได้)
```

**Auto-classify Rules (ดู `brand.md` สำหรับรายละเอียดครบ):**
1. Part1 → line_type (2 ตัวแรก) + FU series (ตัวที่ 3) + brand (2 หลักท้าย)
2. Part2 → panel_type (ตัวแรก) + color (2 หลักท้าย) + FU F100/S85 rule
3. Part3 → width_mm, height_mm, panel_size (split half strategy)
4. Description → mosquito_net, glass_type, panel_style
5. Similarity → Part1+Part2 match → copy attributes (confidence 90%)

**API ProCodeSAP:**
```
GET    /api/pro-code-sap?status=&q=&brand=&line_type=&page=&limit=
GET    /api/pro-code-sap/:id
POST   /api/pro-code-sap                     เพิ่มด้วยตนเอง
PATCH  /api/pro-code-sap/:id                 แก้ไข attributes
POST   /api/pro-code-sap/:id/confirm         ยืนยัน classification
POST   /api/pro-code-sap/auto-classify       รัน auto-classify ทุก pending
GET    /api/pro-code-sap/export              Export Excel (แทน Sheet8)
GET    /api/pro-code-sap/filter-options      unique values ทุก attribute (สำหรับ dropdown)
```

---

### 4.1 PDPlan — แผนการผลิต (Import จาก Excel)

**โครงสร้างไฟล์จริง (ยืนยันจาก ALU + uPVC):**
- แต่ละ Sheet = 1 สายผลิต (ชื่อ Sheet = รหัสสาย 4 หลัก เช่น `0115`, `0416`)
- Header row ไม่คงที่: ALU = Row 5, uPVC = Row 3 → ต้อง **scan by column name**
- บาง Sheet มีคอลัมน์ `SO.` พิเศษ → column offset เลื่อน

**Columns (ค้นหาโดยชื่อ ไม่ใช่ตำแหน่ง):**
```
"Doc. No."            → doc_no
"Product No."         → product_no  (SAP code)
"Product Description" → product_desc
"Planned"             → plan_qty
"Completed"           → completed_qty
"Open"                → open_qty
"Order Date"          → order_date
"Start Date"          → start_date
"Due Date"            → due_date
```

#### 4.1.1 ตาราง pd_plans

```sql
CREATE TABLE IF NOT EXISTS pd_plans (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_no             TEXT NOT NULL,
  product_no         TEXT NOT NULL,
  product_desc       TEXT,
  plan_qty           INTEGER NOT NULL DEFAULT 0,
  completed_qty      INTEGER DEFAULT 0,
  open_qty           INTEGER DEFAULT 0,
  order_date         DATE,
  start_date         DATE,
  due_date           DATE,
  production_line_id INTEGER REFERENCES production_lines(id),
  pro_code_sap_id    INTEGER REFERENCES pro_code_sap(id),   -- auto-link หลัง classify
  source_file        TEXT,
  source_sheet       TEXT,                                   -- ชื่อ Sheet เช่น '0115'
  imported_at        DATETIME DEFAULT (datetime('now')),
  imported_by        INTEGER REFERENCES users(id),
  UNIQUE(doc_no, product_no)
);

CREATE INDEX IF NOT EXISTS idx_pd_plan_no     ON pd_plans(product_no);
CREATE INDEX IF NOT EXISTS idx_pd_plan_due    ON pd_plans(due_date);
CREATE INDEX IF NOT EXISTS idx_pd_plan_line   ON pd_plans(production_line_id);
CREATE INDEX IF NOT EXISTS idx_pd_plan_sap    ON pd_plans(pro_code_sap_id);
```

**Import Logic:**
1. Scan row ตั้งแต่ Row 1 จนพบ `"Product No."` → ใช้เป็น header row
2. อ่านทุก Sheet → map ชื่อ Sheet กับ `production_lines.pdplan_sheet`
3. Skip row ที่ `product_no` เป็น null หรือไม่ใช่ string `{xxx}-{xxx}-{xxx}`
4. ค้นหา product_no ใน `pro_code_sap`:
   - พบ → link `pro_code_sap_id`, ถ้า status=confirmed ดี
   - ไม่พบ → auto-create `pro_code_sap` record (status=pending) + รัน auto-classify
5. UPSERT by `(doc_no, product_no)`

**API:**
```
POST /api/pd-plan/import   multipart (admin only)
  Response: { imported, updated, skipped, new_sap_codes: [...], errors: [...] }

GET  /api/pd-plan?line_id=&due_date_from=&due_date_to=&product_no=
```

---

### 4.2 Master Tables

```sql
-- โรงงาน/สายผลิต
CREATE TABLE IF NOT EXISTS production_lines (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT UNIQUE NOT NULL,       -- 'F01-ALU-15', 'F01-UPVC-16'
  name         TEXT NOT NULL,              -- 'สาย ALU 15 โรงงาน 1'
  line_type    TEXT CHECK(line_type IN ('alu','upvc','other')),
  factory      TEXT NOT NULL,              -- 'F01', 'F02', 'F04'
  factory_code TEXT NOT NULL,              -- '01','02','04' ใช้ใน Defect Code
  pdplan_sheet TEXT,                       -- '0115,0116' (comma-separated ถ้ามีหลาย Sheet)
  is_active    INTEGER DEFAULT 1
);

-- ผู้รับผิดชอบสายผลิต
CREATE TABLE IF NOT EXISTS production_line_managers (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  production_line_id INTEGER NOT NULL REFERENCES production_lines(id) ON DELETE CASCADE,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_at        DATETIME DEFAULT (datetime('now')),
  UNIQUE(production_line_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_prod_line_mgr ON production_line_managers(production_line_id);

-- FM Category (ประเภทสาเหตุ Man/Machine/Material/Method)
CREATE TABLE IF NOT EXISTS fm_categories (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL,                   -- 'Man', 'Machine', 'Material', 'Method'
  code      TEXT NOT NULL UNIQUE,            -- 'Mn', 'Mc', 'Mt', 'Md' (ใช้ใน Defect Code)
  is_active INTEGER DEFAULT 1
);

-- กระบวนการผลิต (Process Steps)
CREATE TABLE IF NOT EXISTS process_steps (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  production_line_id INTEGER REFERENCES production_lines(id),  -- NULL = ใช้ได้ทุกสาย
  name               TEXT NOT NULL,             -- 'ขั้นตอนการตัด'
  code               TEXT NOT NULL,             -- 'TC' (ใช้ใน Defect Code)
  sort_order         INTEGER DEFAULT 0,
  is_active          INTEGER DEFAULT 1
);

-- ประเภทของเสีย (แยกตามสาย + FM Category)
CREATE TABLE IF NOT EXISTS defect_types (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  production_line_id INTEGER REFERENCES production_lines(id),  -- NULL = ใช้ได้ทุกสาย
  fm_category_id     INTEGER REFERENCES fm_categories(id),     -- FM ที่เกี่ยวข้อง
  name               TEXT NOT NULL,             -- 'ขอบบิ่น', 'สีด่าง'
  code               TEXT NOT NULL,             -- '001' (3 หลัก, ใช้ใน Defect Code)
  is_active          INTEGER DEFAULT 1
);

-- กะการผลิต (ใช้ทั้ง IPQC และ FQC)
CREATE TABLE IF NOT EXISTS shifts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,                     -- 'กะเช้า', 'กะบ่าย', 'กะดึก'
  start_time TEXT,                              -- '08:00'
  end_time   TEXT,                              -- '17:00'
  is_active  INTEGER DEFAULT 1
);

-- เกณฑ์ defect rate (FQC pass/fail threshold)
CREATE TABLE IF NOT EXISTS defect_rate_thresholds (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  production_line_id INTEGER REFERENCES production_lines(id),  -- NULL = ทุกสาย (default)
  pro_code_sap_id    INTEGER REFERENCES pro_code_sap(id),      -- NULL = ทุกสินค้า (default)
  threshold_pct      REAL NOT NULL DEFAULT 3.0,                -- % ที่ถือว่า fail
  effective_date     DATE NOT NULL DEFAULT (date('now')),
  created_by         INTEGER REFERENCES users(id),
  created_at         DATETIME DEFAULT (datetime('now'))
);
```

**Defect Code Formula:**
```
DefectCode = {factory_code}{fm_code}{process_code}{defect_type_code}

factory_code   = production_lines.factory_code (เช่น '01')
fm_code        = fm_categories.code (เช่น 'Mc')
process_code   = process_steps.code (เช่น 'TC')
defect_type_code = defect_types.code (เช่น '001')

ตัวอย่าง: "01McTC001"
- Auto-generate ฝั่ง server ใน transaction
- ไม่มี separator, ใช้ case ตาม code ที่ admin กำหนด
- ห้าม client generate — server เท่านั้น
- ห้าม edit หลัง save
```

---

### 4.3 IPQC Records

```sql
CREATE TABLE IF NOT EXISTS ipqc_records (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  record_no          TEXT UNIQUE NOT NULL,   -- 'IPQC-2026-0001' (auto sequence)
  found_date         DATE NOT NULL,          -- วันที่พบปัญหา (≤ 7 วันย้อนหลัง)
  recorded_at        DATETIME DEFAULT (datetime('now')),

  -- สินค้า (ใช้ pro_code_sap — ไม่ใช่ products table)
  pro_code_sap_id    INTEGER REFERENCES pro_code_sap(id) ON DELETE RESTRICT,
  po_number          TEXT,                   -- PO Number (optional)
  pd_plan_id         INTEGER REFERENCES pd_plans(id),  -- link แผนผลิต (optional)

  -- การผลิต
  production_line_id INTEGER NOT NULL REFERENCES production_lines(id) ON DELETE RESTRICT,
  process_step_id    INTEGER NOT NULL REFERENCES process_steps(id) ON DELETE RESTRICT,
  shift_id           INTEGER REFERENCES shifts(id),

  -- ของเสีย
  fm_category_id     INTEGER NOT NULL REFERENCES fm_categories(id) ON DELETE RESTRICT,
  defect_type_id     INTEGER NOT NULL REFERENCES defect_types(id) ON DELETE RESTRICT,
  defect_code        TEXT NOT NULL,          -- auto-generated, immutable
  defect_qty         INTEGER NOT NULL,
  total_qty          INTEGER,               -- จำนวนที่ตรวจทั้งหมด (optional)
  description        TEXT,

  -- พนักงาน
  responsible_user_id INTEGER REFERENCES users(id),
  responsible_name    TEXT,                 -- fallback ถ้าไม่มีใน users

  -- สถานะ
  status             TEXT NOT NULL DEFAULT 'open'
                     CHECK(status IN ('open','in_progress','closed','cancelled')),
  closed_at          DATETIME,
  closed_by          INTEGER REFERENCES users(id),

  -- Metadata
  created_by         INTEGER NOT NULL REFERENCES users(id),
  created_ip         TEXT,
  CONSTRAINT ipqc_qty_positive CHECK(defect_qty > 0)
);

CREATE TABLE IF NOT EXISTS ipqc_images (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ipqc_record_id  INTEGER NOT NULL REFERENCES ipqc_records(id) ON DELETE CASCADE,
  file_path       TEXT NOT NULL,
  original_name   TEXT,
  sort_order      INTEGER DEFAULT 0,
  uploaded_at     DATETIME DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ipqc_date       ON ipqc_records(found_date);
CREATE INDEX IF NOT EXISTS idx_ipqc_sap        ON ipqc_records(pro_code_sap_id);
CREATE INDEX IF NOT EXISTS idx_ipqc_line       ON ipqc_records(production_line_id);
CREATE INDEX IF NOT EXISTS idx_ipqc_status     ON ipqc_records(status);
CREATE INDEX IF NOT EXISTS idx_ipqc_created_by ON ipqc_records(created_by);
CREATE INDEX IF NOT EXISTS idx_ipqc_defect_code ON ipqc_records(defect_code);
CREATE INDEX IF NOT EXISTS idx_ipqc_images     ON ipqc_images(ipqc_record_id);
```

**IPQC Status Transitions:**
```
open          → qc_supervisor, qc_manager สามารถ → in_progress
in_progress   → qc_supervisor, qc_manager สามารถ → closed / open
open/in_progress → qc_manager สามารถ → cancelled

กฎ: ห้าม edit record ที่ status=closed หรือ cancelled
กฎ: owner (created_by) แก้ไขได้เฉพาะ status=open และภายใน 24 ชั่วโมง
```

---

### 4.4 FQC Records

```sql
CREATE TABLE IF NOT EXISTS fqc_records (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  record_no          TEXT UNIQUE NOT NULL,   -- 'FQC-2026-0001'
  inspect_date       DATE NOT NULL,

  -- สินค้า (ใช้ pro_code_sap — ไม่ใช่ products table)
  pro_code_sap_id    INTEGER REFERENCES pro_code_sap(id) ON DELETE RESTRICT,
  po_number          TEXT,
  pd_plan_id         INTEGER REFERENCES pd_plans(id),  -- link แผนผลิต (optional)

  -- การผลิต
  production_line_id INTEGER NOT NULL REFERENCES production_lines(id) ON DELETE RESTRICT,
  shift_id           INTEGER REFERENCES shifts(id),

  -- ผลการตรวจ
  total_qty          INTEGER NOT NULL CHECK(total_qty > 0),
  defect_qty         INTEGER NOT NULL DEFAULT 0 CHECK(defect_qty >= 0),
  defect_rate        REAL NOT NULL DEFAULT 0,   -- stored: defect_qty/total_qty*100 (2 decimal)
  -- pass_qty ไม่เก็บ — compute ที่ query: total_qty - defect_qty

  -- ผลตัดสิน (auto-calculate จาก defect_rate vs threshold)
  result             TEXT NOT NULL DEFAULT 'pass'
                     CHECK(result IN ('pass','fail','conditional_pass')),
  remarks            TEXT,

  -- Metadata
  created_by         INTEGER NOT NULL REFERENCES users(id),
  created_ip         TEXT,
  recorded_at        DATETIME DEFAULT (datetime('now')),
  CONSTRAINT fqc_qty_check CHECK(defect_qty <= total_qty)
);

-- ของเสียแยกตามประเภท (1 FQC มีหลาย defect type)
CREATE TABLE IF NOT EXISTS fqc_defect_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  fqc_record_id  INTEGER NOT NULL REFERENCES fqc_records(id) ON DELETE CASCADE,
  defect_type_id INTEGER NOT NULL REFERENCES defect_types(id) ON DELETE RESTRICT,
  qty            INTEGER NOT NULL CHECK(qty > 0)
);

CREATE TABLE IF NOT EXISTS fqc_images (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  fqc_record_id  INTEGER NOT NULL REFERENCES fqc_records(id) ON DELETE CASCADE,
  file_path      TEXT NOT NULL,
  original_name  TEXT,
  sort_order     INTEGER DEFAULT 0,
  uploaded_at    DATETIME DEFAULT (datetime('now'))
);

-- Monthly Approval
CREATE TABLE IF NOT EXISTS fqc_monthly_approvals (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  year               INTEGER NOT NULL,
  month              INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
  production_line_id INTEGER REFERENCES production_lines(id), -- NULL = ภาพรวม (QC Manager/CPO)
  approver_role      TEXT NOT NULL CHECK(approver_role IN ('qc_manager','production_manager','cpo')),
  approved_by        INTEGER NOT NULL REFERENCES users(id),
  approved_at        DATETIME NOT NULL DEFAULT (datetime('now')),
  remarks            TEXT,
  UNIQUE(year, month, production_line_id, approver_role)
);

CREATE INDEX IF NOT EXISTS idx_fqc_date         ON fqc_records(inspect_date);
CREATE INDEX IF NOT EXISTS idx_fqc_sap          ON fqc_records(pro_code_sap_id);
CREATE INDEX IF NOT EXISTS idx_fqc_line         ON fqc_records(production_line_id);
CREATE INDEX IF NOT EXISTS idx_fqc_result       ON fqc_records(result);
CREATE INDEX IF NOT EXISTS idx_fqc_created      ON fqc_records(created_by);
CREATE INDEX IF NOT EXISTS idx_fqc_defect_items ON fqc_defect_items(fqc_record_id);
CREATE INDEX IF NOT EXISTS idx_fqc_images       ON fqc_images(fqc_record_id);
CREATE INDEX IF NOT EXISTS idx_fqc_approval     ON fqc_monthly_approvals(year, month, production_line_id);
```

**defect_rate Computation Rule:**
```javascript
// ✅ ถูก — store ที่เวลา save
const defect_rate = Math.round((defect_qty / total_qty) * 100 * 100) / 100

// ❌ ผิด — ห้าม recompute ใน query (ช้า และไม่ consistent)
// SELECT defect_qty * 100.0 / total_qty AS defect_rate FROM fqc_records

// pass_qty — ไม่เก็บในDB, compute ที่ SELECT
// SELECT total_qty - defect_qty AS pass_qty FROM fqc_records
```

**ลำดับ Approval รายเดือน:**
1. QC Manager อนุมัติก่อน (overview ทุกสาย)
2. Production Manager แต่ละสายอนุมัติ (เฉพาะสายที่ assigned)
3. CPO อนุมัติสุดท้าย (ต้องรอทั้ง QC Manager และ Production Manager ของทุกสายครบ)

**กฎ Monthly Approval:**
- เดือนที่ไม่มีของเสีย (defect_qty = 0 ทั้งเดือน) → ไม่ต้องรับทราบ แสดง "—"
- เดือนที่มีของเสีย → ต้องครบทุก role จึงถือว่า "ปิด"
- ใช้ UNIQUE constraint ป้องกัน double-approve

---

### 4.5 Document Sequences (Seed Required)

เพิ่มใน `seedData()` ของ `database.js`:

```javascript
const seqs = [
  { doc_type: 'IPQC', last_seq: 0, year: new Date().getFullYear() },
  { doc_type: 'FQC',  last_seq: 0, year: new Date().getFullYear() },
]
seqs.forEach(s => {
  db.prepare(`INSERT OR IGNORE INTO document_sequences(doc_type, last_seq, year)
              VALUES(?, ?, ?)`).run(s.doc_type, s.last_seq, s.year)
})
```

---

## 5. Features

### 5.1 IPQC — บันทึกของเสียระหว่างผลิต

#### 5.1.1 หน้าบันทึก (Worker View — 4 Step)

**Step 1 — เลือกสินค้า**
- Autocomplete ค้นหาจาก `pro_code_sap` (status=confirmed เท่านั้น)
- ค้นได้จาก: รหัส SAP, ชื่อสินค้า
- แสดง chip: line_type, brand, panel_type, panel_color, panel_size
- Optional: ระบุ PO Number (ค้นหาจาก `pd_plans` ก็ได้)

**Step 2 — ข้อมูลการผลิต**
- วันที่พบปัญหา (default = วันนี้, ย้อนหลังได้ ≤ 7 วัน)
- สายผลิต (Dropdown — filter เฉพาะสายที่ user มีสิทธิ์บันทึก)
- กระบวนการ (Dropdown — filter ตามสายผลิตที่เลือก)
- กะการผลิต (Dropdown: เช้า/บ่าย/ดึก — optional)

**Step 3 — รายละเอียดของเสีย**
- ประเภทสาเหตุ (FM): Man / Machine / Material / Method (Radio 4 ตัว)
- ประเภทของเสีย (Dropdown — filter ตามสาย + FM Category)
- **Defect Code: Preview** → แสดง auto-generated code ทันทีที่เลือกครบ (read-only)
- จำนวนของเสีย (Number ≥ 1)
- จำนวนที่ตรวจ (optional)
- พนักงานรับผิดชอบ: Dropdown users หรือพิมพ์ชื่อ (fallback responsible_name)
- รายละเอียด (Textarea, optional)

**Step 4 — รูปภาพ**
- ถ่ายรูปกล้อง: `<input type="file" accept="image/*" capture="environment">`
- อัปโหลดจากไฟล์ก็ได้
- สูงสุด **15 ใบ** (3×5 grid thumbnail)
- ช่องว่าง: icon กล้อง | ช่องมีรูป: thumbnail + ปุ่มลบ

**บันทึก:**
- Confirm dialog → POST `/api/ipqc`
- แจ้ง SSE + Telegram (กลุ่ม QC) → qc_supervisor ของสายนั้น

#### 5.1.2 IPQC List View

- Filter: วันที่ from/to, สายผลิต, สถานะ, ประเภทของเสีย, brand, สีบาน
- Sort: วันที่ (default desc), Defect Code
- Pagination: 20 แถว/หน้า
- Column: No., วันที่, รหัส SAP, สายผลิต, FM, Defect Code, จำนวน, สถานะ
- Export Excel/PDF

#### 5.1.3 IPQC Detail View

- ข้อมูลทั้งหมด + Gallery รูป
- Timeline: บันทึก → เปิด → กำลังแก้ไข → ปิด
- ปุ่มเปลี่ยนสถานะ (ตาม role + transition rules ข้อ 4.3)
- Audit log

---

### 5.2 FQC — บันทึกผลผลิตรายวัน

#### 5.2.1 หน้าบันทึก (Worker View — 4 Step)

**Step 1 — เลือกสินค้า**
- ค้นจาก PO Number (ค้นใน `pd_plans` → auto-fill สินค้า) **หรือ** SAP Code โดยตรง
- ถ้าค้นจาก PO → auto-fill: product_no, product_desc, production_line, due_date
- แสดง chip attributes จาก ProCodeSAP

**Step 2 — ข้อมูลการตรวจ**
- วันที่ตรวจสอบ (default = วันนี้, ย้อนหลัง ≤ 7 วัน)
- สายผลิต (auto-fill จาก PO หรือเลือกเอง)
- กะการผลิต

**Step 3 — ผลการตรวจ**
- จำนวนผลิตทั้งหมด
- ของเสียแยกประเภท (Dynamic rows):

```
[ ประเภทของเสีย ▼ ]   [ จำนวน ]   [ ลบ ]
[ + เพิ่มประเภทของเสีย ]
รวมของเสีย: xx ชิ้น   อัตรา: x.xx%
ผล: [ผ่าน / ไม่ผ่าน] — auto-calculate
```

- Auto-calculate: defect_rate = sum(defect_items) / total_qty × 100
- ผ่าน/ไม่ผ่าน: compare กับ `defect_rate_thresholds` (ดู threshold ตามสาย/สินค้า)
- หมายเหตุ (optional)

**Step 4 — รูปภาพ** (เหมือน IPQC)

**บันทึก:**
- Store defect_rate ณ เวลา save
- ถ้า result=fail → แจ้ง SSE + Telegram QC Manager

#### 5.2.2 FQC List View

- Filter: วันที่, สายผลิต, ผล (ผ่าน/ไม่ผ่าน/conditional_pass), brand, สีบาน, PO
- Summary bar: ผลิตรวม, ของเสียรวม, อัตราของเสียเฉลี่ย
- Export Excel/PDF

#### 5.2.3 FQC Monthly Report + Approval

```
รายงาน FQC — มิ.ย. 2026    [เลือกเดือน ▼]

          │ สาย ALU (F01)                     │ สาย UPVC (F01)
เดือน     │ ของเสีย │ QC Mgr │ ผจก.ALU │ CPO │ ของเสีย │ QC Mgr │ ผจก.UPVC │ CPO
ม.ค.      │   15    │   ✓    │    ✓    │  ?  │    8    │   ✓    │    ✓     │  ✓
ก.พ.      │    0    │   —    │    —    │  —  │    3    │   ✓    │    ?     │  ?
```

- ปุ่ม "รับทราบ" แสดงเฉพาะ role ที่มีสิทธิ์ + ยังไม่รับทราบ + เดือนนั้นมีของเสีย
- `prod_mgr` เห็นเฉพาะสายที่ assigned
- `cpo` ต้องรอ QC Manager + Production Manager ทุกสายครบก่อนจึง enable ปุ่มรับทราบ

---

## 6. Admin Configuration

ทั้งหมดทำผ่าน Web UI ใต้ `/admin/settings` หรือ `/master/production`

### 6.1 จัดการสายผลิต (Production Lines)

- เพิ่ม/แก้ไข/ปิดใช้งาน Production Lines
- กำหนด: รหัส, ชื่อ, ประเภท (ALU/UPVC/Other), โรงงาน (F01/F02/F04), factory_code, pdplan_sheet
- Assign Production Manager (หลายคนได้)

| code | name | factory | factory_code | pdplan_sheet |
|------|------|---------|-------------|-------------|
| F01-ALU-15 | สาย ALU 15 โรงงาน 1 | F01 | 01 | 0115 |
| F01-ALU-16 | สาย ALU 16 โรงงาน 1 | F01 | 01 | 0116 |
| F01-UPVC-21 | สาย uPVC 21 โรงงาน 1 | F01 | 01 | 0121 |
| F02-ALU-17 | สาย ALU 17 โรงงาน 2 | F02 | 02 | 0217 |
| F04-UPVC-16 | สาย uPVC 16 โรงงาน 4 | F04 | 04 | 0416 |

### 6.2 นำเข้า PDPlan (PDPlan Import)

- Drag-drop / เลือกไฟล์ Excel (.xlsx)
- Preview Sheet list + 5 แถวแรกต่อ Sheet
- Mode: เพิ่มเติม (UPSERT) หรือ แทนที่ช่วงวันที่
- หลัง import: แสดงสรุป `new_sap_codes` ที่พบ → link ไปหน้า ProCodeSAP Queue

### 6.3 จัดการ ProCodeSAP

- **Queue** — รายการ status=pending/auto รอยืนยัน, แสดง confidence %
- **[จำแนกทั้งหมด]** — รัน auto-classify batch บน pending
- **[ยืนยัน]** — confirm ทีละรายการ (ถ้า confidence สูง)
- **[แก้ไข]** — inline edit 13 attributes
- **Rule Editor** — กำหนด parsing rules เพิ่มเติม (sap_parse_rules)
- **Export Excel** — ส่งออก ProCodeSAP ทั้งหมด (แทน Sheet8)

### 6.4 จัดการกระบวนการผลิต

- เพิ่ม/แก้ไข/เรียง Process Steps
- กำหนดรหัสย่อ (code) สำหรับ Defect Code
- เลือกว่าใช้กับสายใด (NULL = ทุกสาย)

### 6.5 จัดการประเภทของเสีย

- เพิ่ม Defect Types แยกตามสาย + FM Category
- กำหนดรหัส 3 หลัก (code) สำหรับ Defect Code

### 6.6 จัดการ FM Categories

- Man / Machine / Material / Method + code 2 ตัวอักษร

### 6.7 จัดการกะการผลิต

- เพิ่ม Shifts + เวลาเริ่ม-สิ้นสุด

### 6.8 ตั้งค่า Defect Rate Threshold

- Default: 3% (global)
- กำหนดแยกตามสายผลิต หรือแยกตามสินค้า (override)
- `defect_rate_thresholds` — เลือก production_line หรือ pro_code_sap หรือทั้ง null (global)

---

## 7. Role Matrix

| Feature | admin | qc_staff | qc_supervisor | qc_manager | cpo | prod_mgr |
|---------|-------|----------|---------------|------------|-----|----------|
| บันทึก IPQC | — | ✅ | ✅ | — | — | — |
| ดู IPQC List | — | ✅ | ✅ | ✅ | ✅ | ✅ (เฉพาะสายที่ assigned) |
| แก้ไข IPQC (owner, ≤24h) | — | ✅ | ✅ | — | — | — |
| เปลี่ยนสถานะ IPQC | — | — | ✅ | ✅ | — | — |
| บันทึก FQC | — | ✅ | ✅ | — | — | — |
| ดู FQC List | — | ✅ | ✅ | ✅ | ✅ | ✅ (เฉพาะสายที่ assigned) |
| รับทราบรายงานเดือน (QC) | — | — | — | ✅ | — | — |
| รับทราบรายงานเดือน (ผจก.สาย) | — | — | — | — | — | ✅ (เฉพาะสายที่ assigned) |
| รับทราบรายงานเดือน (CPO) | — | — | — | — | ✅ | — |
| นำเข้า PDPlan | ✅ | — | — | — | — | — |
| จัดการ ProCodeSAP | ✅ | — | — | — | — | — |
| จัดการ Master IPQC/FQC | ✅ | — | — | — | — | — |
| ตั้งค่า Defect Rate Threshold | ✅ | — | — | ✅ | — | — |
| Export Report IPQC/FQC | — | — | — | ✅ | ✅ | ✅ |
| ดู Dashboard | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**หมายเหตุ:**
- `prod_mgr` ดูและรับทราบเฉพาะสายผลิตที่ assigned ใน `production_line_managers`
- `cco`, `cmo` ไม่มีบทบาทใน IPQC/FQC (removed per requirement)

---

## 8. API Endpoints

### 8.1 Master Data

```
GET  /api/ipqc/master/production-lines?active=1           สายผลิตทั้งหมด
POST /api/ipqc/master/production-lines                    เพิ่ม (admin)
PATCH /api/ipqc/master/production-lines/:id               แก้ไข (admin)
POST /api/ipqc/master/production-lines/:id/managers       assign production manager
DELETE /api/ipqc/master/production-lines/:id/managers/:uid unassign

GET  /api/ipqc/master/process-steps?line_id=              (null = ทุกสาย)
POST /api/ipqc/master/process-steps
PATCH /api/ipqc/master/process-steps/:id
PATCH /api/ipqc/master/process-steps/:id/reorder

GET  /api/ipqc/master/fm-categories
POST /api/ipqc/master/fm-categories
PATCH /api/ipqc/master/fm-categories/:id

GET  /api/ipqc/master/defect-types?line_id=&fm_category_id=
POST /api/ipqc/master/defect-types
PATCH /api/ipqc/master/defect-types/:id

GET  /api/ipqc/master/shifts
POST /api/ipqc/master/shifts
PATCH /api/ipqc/master/shifts/:id

GET  /api/ipqc/master/thresholds?line_id=&pro_code_sap_id=
POST /api/ipqc/master/thresholds
PATCH /api/ipqc/master/thresholds/:id
```

### 8.2 IPQC

```
GET  /api/ipqc?page=&limit=20&date_from=&date_to=&line_id=&status=&defect_type_id=&q=
  Response: { data: [...], total, page, limit }

GET  /api/ipqc/:id
POST /api/ipqc
  Body: { pro_code_sap_id, found_date, production_line_id, process_step_id,
          shift_id?, fm_category_id, defect_type_id, defect_qty, total_qty?,
          description?, responsible_user_id?, responsible_name?, po_number? }
  → auto-generate defect_code + record_no (sequence) + notify

PATCH /api/ipqc/:id          แก้ไข (owner ≤24h หรือ supervisor/manager)
PATCH /api/ipqc/:id/status   เปลี่ยน status (supervisor/manager)
  Body: { status, remarks? }

POST  /api/ipqc/:id/images   อัปโหลดรูป (multipart, max 15)
DELETE /api/ipqc/:id/images/:imageId

GET  /api/ipqc/export?format=excel|pdf&date_from=&date_to=&line_id=
```

### 8.3 FQC

```
GET  /api/fqc?page=&limit=20&date_from=&date_to=&line_id=&result=&q=
  Response: { data: [..., pass_qty: total_qty-defect_qty], total, page, limit }

GET  /api/fqc/:id
POST /api/fqc
  Body: { pro_code_sap_id, inspect_date, production_line_id, shift_id?,
          total_qty, defect_items: [{defect_type_id, qty}],
          remarks?, po_number?, pd_plan_id? }
  → auto-compute defect_qty, defect_rate, result + record_no (sequence) + notify if fail

PATCH /api/fqc/:id           แก้ไข (owner เท่านั้น, ≤24h)

POST  /api/fqc/:id/images
DELETE /api/fqc/:id/images/:imageId

GET  /api/fqc/monthly?year=&month=&line_id=
  Response: { lines: [{ id, name, defect_total, approvals: { qc_manager, production_manager, cpo } }] }

POST /api/fqc/monthly/approve
  Body: { year, month, production_line_id?, remarks? }
  → role extracted from JWT → ตรวจ prerequisite (QC before Prod, Prod+QC before CPO)

GET  /api/fqc/export?format=excel|pdf&year=&month=&line_id=
```

---

## 9. Transaction Requirements (ห้ามละเมิด)

| Operation | ต้องรวมใน transaction เดียว |
|-----------|---------------------------|
| Create IPQC | record + defect_code_gen + sequence + images + notifications + audit |
| Update IPQC status | status update (optimistic lock) + notifications + audit |
| Create FQC | record + defect_items + defect_rate_compute + sequence + images + notifications + audit |
| Monthly Approve | approval record (check UNIQUE) + notifications + audit |
| PDPlan Import (per row) | upsert pd_plan + pro_code_sap create/link |
| Confirm ProCodeSAP | status update + pd_plans.pro_code_sap_id update |

```javascript
// ตัวอย่าง Create IPQC
const createIpqc = db.transaction((data, userId, ip) => {
  const defect_code = generateDefectCode(data)   // ใน transaction
  const record_no   = nextSequence('IPQC')        // ใน transaction
  const rec = db.prepare('INSERT INTO ipqc_records ...').run({ ...data, defect_code, record_no })
  // insert images...
  notify(...)    // ใน transaction
  auditLog('ipqc_records', rec.lastInsertRowid, 'CREATE', null, data, userId, ip)
  return rec
})
```

---

## 10. Notification

| Event | ผู้รับ | ช่องทาง |
|-------|--------|---------|
| IPQC record ใหม่ | qc_supervisor ของสายนั้น | SSE + Telegram (กลุ่ม QC) |
| FQC result = fail | qc_manager | SSE + Telegram (กลุ่ม QC) |
| FQC record ใหม่ (pass) | ไม่แจ้ง | — |
| รายงานเดือนรอรับทราบ (QC) | qc_manager | SSE + Telegram |
| รายงานเดือนรอรับทราบ (ผจก.สาย) | production_manager assigned | SSE + Telegram |
| รายงานเดือนรอรับทราบ (CPO) | cpo | SSE + Telegram |
| ProCodeSAP ใหม่รอยืนยัน | admin | SSE (in-app เท่านั้น) |
| IPQC status → closed | ผู้บันทึก (created_by) | SSE |

---

## 11. Sidebar Navigation

```
QC หน้างาน   (icon: clipboard)
├── บันทึก IPQC          /ipqc/new      (qc_staff, qc_supervisor)
├── รายการ IPQC          /ipqc          (qc_staff, qc_supervisor, qc_manager, cpo, prod_mgr)
├── บันทึก FQC           /fqc/new       (qc_staff, qc_supervisor)
├── รายการ FQC           /fqc           (qc_staff, qc_supervisor, qc_manager, cpo, prod_mgr)
└── รายงานรายเดือน       /fqc/monthly   (qc_manager, cpo, prod_mgr)
```

เพิ่มใน `rolePermissions.js` เป็น group ใหม่ (ไม่รวมกับ IQC รับเข้า)

---

## 12. Mobile UX

### 12.1 Multi-step Form

```
[●]—[○]—[○]—[○]
สินค้า  ผลิต  ปัญหา  รูป

[← ย้อนกลับ]   Step 2 / 4   [ถัดไป →]
```

- Sticky progress bar ด้านบน
- ปุ่ม "ถัดไป" ด้านล่าง (full-width บน mobile)
- Validate เฉพาะ Step ปัจจุบันเมื่อกด "ถัดไป"

### 12.2 Photo Grid

```
[📷][📷][📷]
[📷][  ][  ]   ← ช่องว่าง = icon กล้อง
[  ][  ][  ]   (3×5 = 15 ช่อง)
```

- Tap ช่องว่าง → เปิดกล้อง
- Long-press รูป → ลบ
- แสดงจำนวน: "4 / 15 ใบ"

### 12.3 Autocomplete SAP

- Debounce 300ms
- แสดง 10 ผลลัพธ์แรก
- ค้นได้จาก product_no หรือ product_desc
- เฉพาะ status=confirmed (ไม่แสดง pending)

---

## 13. Dashboard Widgets

เพิ่มใน Dashboard หลัก:

```
┌─────────────────┬─────────────────┐
│  IPQC วันนี้    │  FQC วันนี้     │
│  12 รายการ      │  8 Lot          │
│  ของเสีย 45 ชิ้น│  อัตรา 2.3%    │
└─────────────────┴─────────────────┘
[กราฟ Defect Rate รายสัปดาห์ — recharts]
[แยกตาม factory/สาย]
```

---

## 14. Export

| Report | Format | รายละเอียด |
|--------|--------|-----------|
| IPQC รายวัน/สัปดาห์/เดือน | Excel, PDF | กรองได้ตาม วันที่/สาย/สถานะ |
| FQC รายวัน | Excel, PDF | รวม defect_items แต่ละประเภท |
| FQC สรุปรายเดือน | Excel, PDF | Defect Rate แยก Factory + Approval status |
| Pareto ประเภทของเสีย | Excel | Top N defect types ช่วงเวลาที่เลือก |

Rate limit: 5 req/นาที (ตามกฎ CLAUDE.md)

---

## 15. ลำดับ Implement

### Phase 0 — ProCodeSAP + PDPlan (2-3 วัน)

1. `pro_code_sap` + `sap_parse_rules` tables + indexes
2. `pd_plans` table + indexes
3. Service: `server/services/proCodeClassifier.js` — auto-classify engine (ดู `brand.md`)
4. API: `/api/pro-code-sap/*`
5. API: `POST /api/pd-plan/import` (scan-based header, all sheets, SAP detect)
6. Admin UI: PDPlan Import page
7. Admin UI: ProCodeSAP Queue + inline edit
8. Admin UI: ProCodeSAP List + Rule Editor
9. Seed: import Sheet8 เดิมเป็น initial data

### Phase 1 — Master & Infrastructure (1-2 วัน)

1. Tables: `production_lines`, `production_line_managers`, `fm_categories`, `process_steps`, `defect_types`, `shifts`, `defect_rate_thresholds`
2. Seed: `document_sequences` entries (IPQC, FQC)
3. API: `/api/ipqc/master/*` (CRUD ทั้งหมด)
4. Admin UI: จัดการ Master data ทั้งหมด

### Phase 2 — IPQC (2-3 วัน)

1. Tables: `ipqc_records`, `ipqc_images`
2. Service: `generateDefectCode()` ใน transactions.js
3. API: `/api/ipqc/*`
4. UI: บันทึก IPQC (multi-step, mobile-first)
5. UI: IPQC List + Detail
6. SSE + Telegram notification

### Phase 3 — FQC (2-3 วัน)

1. Tables: `fqc_records`, `fqc_defect_items`, `fqc_images`, `fqc_monthly_approvals`
2. API: `/api/fqc/*`
3. UI: บันทึก FQC (multi-step)
4. UI: FQC List + Detail
5. UI: Monthly Report + Approval workflow
6. SSE + Telegram notification

### Phase 4 — Reports & Dashboard (1-2 วัน)

1. Export Excel/PDF (server-side, exceljs + html-pdf-node)
2. Dashboard widgets + recharts
3. Pareto chart

---

## 16. ความเชื่อมโยงกับระบบที่มีอยู่

| ระบบเดิม | เชื่อมกับ IPQC/FQC | หมายเหตุ |
|---------|-------------------|---------| 
| `users` | created_by, responsible_user_id, approved_by | ใช้ role: qc_staff, qc_supervisor, qc_manager, cpo, prod_mgr |
| `audit_logs` | ทุก CREATE/UPDATE | ใน transaction เดียวกัน |
| `notifications` | แจ้งเตือน in-app | ตรวจ role ก่อน push |
| `document_sequences` | IPQC-YYYY-NNNN, FQC-YYYY-NNNN | Seed ใน initSchema |
| `/uploads/ipqc/` | รูป IPQC | `/uploads/ipqc/{record_no}/{uuid}.jpg` |
| `/uploads/fqc/` | รูป FQC | `/uploads/fqc/{record_no}/{uuid}.jpg` |
| `products` (IQC) | **ไม่เชื่อม** | products = วัตถุดิบ, IPQC/FQC ใช้ pro_code_sap |
| `bills`, `ncrs` | ไม่เชื่อมโดยตรง | คนละ workflow |

---

## 17. สิ่งที่ยังต้องยืนยัน

1. **รหัสและชื่อสายผลิตจริง** — mapping sheet code (0115...) ↔ ชื่อสาย
2. **Defect Rate Threshold default** — global ที่ 3%? หรือแตกต่างตามสาย?
3. **Responsible Person** — ต้องเลือกจาก Users เท่านั้น หรือพิมพ์ชื่อเองได้?
4. **PDPlan Format ✅** — scan-based header, column by name, รองรับ ALU+uPVC
5. **PO Number link** — IPQC/FQC link กับ Bills ในระบบ IQC หรือแยกอิสระ?
6. **Shift ใน IPQC** — บังคับระบุหรือ optional?
7. **Photo บังคับ** — required หรือ optional?
8. **Approval รายเดือน** — ต้องการ Signature (canvas) หรือปุ่ม "รับทราบ" พร้อม remarks?
9. **ProCodeSAP Brand Codes** — 00=standard, 09=FRAMEX, 22/28=WINDOW ASIA, 32=FRAMEX ECO — ถูกต้องครบไหม?
10. **ProCodeSAP Initial Data** — มีข้อมูล Sheet8 เดิมให้ import หรือเริ่มใหม่?
