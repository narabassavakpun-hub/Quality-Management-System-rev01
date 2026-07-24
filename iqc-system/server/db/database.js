const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const migrate = require('./migrate');

// IQC_DB_PATH override — สำหรับ test/migration dry-run + production volume (เช่น /data/iqc.db)
const DB_PATH = process.env.IQC_DB_PATH || path.join(__dirname, '../../iqc.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

// สร้างโฟลเดอร์ปลายทางก่อนเปิด DB (กรณี IQC_DB_PATH ชี้ไป volume เปล่า เช่น /data)
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

// ===== NCR status — validate ที่ app layer แทน DB CHECK (DEVMORE H4) =====
// เพิ่มสถานะใหม่ = แก้ที่นี่ที่เดียว ไม่ต้อง rebuild ตารางอีกต่อไป
const VALID_NCR_STATUSES = new Set([
  'pending_supervisor', 'pending_manager', 'pending_qmr_open',
  'pending_purchasing_review', 'pending_purchasing_manager_review', 'pending_supplier', 'pending_manager_review',
  'pending_qmr_close', 'pending_supplier_resubmit', 'pending_uai',
  'closed', 'uai_pending_qc_manager', 'cancelled', 'ncp_closed',
  // S161 — ส่งกลับให้ QC รับเข้าแก้ไขข้อมูล item ได้จากทุกขั้นก่อนถึง Supplier (supervisor/manager/qmr/
  // purchasing/purchasing_manager) — แก้แล้วส่งใหม่ = เริ่มอนุมัติใหม่ทั้งหมดจาก pending_supervisor
  'pending_staff_revision',
]);

const db = new Database(DB_PATH);

// 1. WAL Mode — performance + concurrent read
db.pragma('journal_mode = WAL');

// 1b. Busy timeout — รอ lock สูงสุด 5s กัน SQLITE_BUSY ตอน concurrent write (DEVMORE)
db.pragma('busy_timeout = 5000');

// 2. Foreign Keys — must enable every connection
db.pragma('foreign_keys = ON');

// 3. Verify FK is actually on
const fkCheck = db.pragma('foreign_keys', { simple: true });
if (fkCheck !== 1) throw new Error('Foreign keys pragma failed to enable');

// 3b. Integrity guard ตอน boot — กันเหตุการณ์แบบ Session 84 (DB corrupt แต่ error ปลายทางสับสน)
// quick_check เร็วกว่า integrity_check; ผ่าน = 'ok'. Production → fail-fast (อย่ารันบน DB ที่พัง)
try {
  const qc = db.pragma('quick_check', { simple: true });
  if (qc !== 'ok') {
    console.error('\n[DB] ⚠️  DATABASE INTEGRITY CHECK FAILED:', qc);
    console.error('[DB] ⚠️  ไฟล์ DB อาจ corrupt — กู้คืนจาก backup ก่อนใช้งานจริง (ดู DEPLOYMENT.md)\n');
    if (process.env.NODE_ENV === 'production') throw new Error('Database integrity check failed: ' + qc);
  }
} catch (e) {
  if (process.env.NODE_ENV === 'production') throw e;
  console.error('[DB] integrity check error (non-fatal in dev):', e.message);
}

// ===== SCHEMA INIT (CREATE TABLE IF NOT EXISTS) =====
function initSchema() {
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);
}

// ===== COLUMN MIGRATIONS (ALTER TABLE ADD COLUMN — idempotent) =====
function safeAddColumn(table, column, definition) {
  try {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  } catch (e) {
    // duplicate column = already migrated; no such table = fresh DB, initSchema() will create it
    if (!e.message.includes('duplicate column') && !e.message.includes('no such table')) throw e;
  }
}

function safeDropColumn(table, column) {
  try {
    db.prepare(`ALTER TABLE ${table} DROP COLUMN ${column}`).run();
  } catch (e) {
    // Column doesn't exist or already dropped — ignore
  }
}

function runMigrations() {
  // users: single-session enforcement
  safeAddColumn('users', 'session_token', 'TEXT');

  // pd_plans: เพิ่ม column ใหม่จาก Excel (งานออกประจำวัน, SO.ประจำวัน, STOCK, คงเหลือ, หมายเหตุ, รายวัน, OT)
  safeAddColumn('pd_plans', 'daily_output', 'INTEGER DEFAULT 0');
  safeAddColumn('pd_plans', 'so_daily',     'TEXT');
  safeAddColumn('pd_plans', 'stock_qty',    'INTEGER DEFAULT 0');
  safeAddColumn('pd_plans', 'remaining_qty','INTEGER DEFAULT 0');
  safeAddColumn('pd_plans', 'remarks',      'TEXT');
  safeAddColumn('pd_plans', 'daily_plan',   'INTEGER DEFAULT 0');
  safeAddColumn('pd_plans', 'ot_qty',       'INTEGER DEFAULT 0');

  // delivery_schedules: remove old CHECK constraint on time_slot (was morning/afternoon/evening/fullday)
  // and add has_sample column — must recreate table since SQLite can't drop constraints
  const dsInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='delivery_schedules'").get();
  if (dsInfo?.sql?.includes("time_slot IN ('morning'")) {
    db.pragma('foreign_keys = OFF');
    db.prepare(`
      CREATE TABLE delivery_schedules_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supplier_id INTEGER REFERENCES suppliers(id) ON DELETE RESTRICT,
        scheduled_date DATE NOT NULL,
        time_slot TEXT NOT NULL,
        is_unplanned INTEGER DEFAULT 0,
        notes TEXT,
        has_sample INTEGER DEFAULT 0,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending','acknowledged','on_time','late','cancelled','rescheduled')),
        actual_date DATE,
        late_reason TEXT,
        rescheduled_date DATE,
        acknowledged_at DATETIME,
        acknowledged_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
        created_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    db.prepare(`
      INSERT INTO delivery_schedules_v2
        (id, supplier_id, scheduled_date, time_slot, is_unplanned, notes, status,
         actual_date, late_reason, rescheduled_date, acknowledged_at, acknowledged_by,
         created_by, created_at, updated_at)
      SELECT id, supplier_id, scheduled_date, time_slot, is_unplanned, notes, status,
             actual_date, late_reason, rescheduled_date, acknowledged_at, acknowledged_by,
             created_by, created_at, updated_at
      FROM delivery_schedules
    `).run();
    db.prepare('DROP TABLE delivery_schedules').run();
    db.prepare('ALTER TABLE delivery_schedules_v2 RENAME TO delivery_schedules').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_delivery_date     ON delivery_schedules(scheduled_date)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_delivery_status   ON delivery_schedules(status)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_delivery_supplier ON delivery_schedules(supplier_id)').run();
    db.pragma('foreign_keys = ON');
  }

  // delivery_schedules: QC ที่กด "บันทึก" ปิดสถานะสุดท้าย (on_time/late) — ใช้แสดง "QC ผู้รับ" ใน tag summary/export
  safeAddColumn('delivery_schedules', 'received_by', 'INTEGER REFERENCES users(id) ON DELETE RESTRICT');
  // delivery_schedules: เวลาที่ของมาถึงจริง (คู่กับ actual_date เดิมที่มีแต่วันที่ ไม่มีเวลา)
  safeAddColumn('delivery_schedules', 'actual_time', 'TEXT');

  // delivery_schedule_items: urgent flag + make item_name nullable (now uses product dropdown)
  safeAddColumn('delivery_schedule_items', 'is_urgent', 'INTEGER DEFAULT 0');
  const dsiInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='delivery_schedule_items'").get();
  if (dsiInfo?.sql?.includes('item_name TEXT NOT NULL')) {
    db.pragma('foreign_keys = OFF');
    db.prepare(`
      CREATE TABLE delivery_schedule_items_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        schedule_id INTEGER REFERENCES delivery_schedules(id) ON DELETE RESTRICT,
        product_id INTEGER REFERENCES products(id) ON DELETE RESTRICT,
        item_name TEXT,
        qty_expected INTEGER,
        notes TEXT,
        is_urgent INTEGER DEFAULT 0
      )
    `).run();
    db.prepare(`INSERT INTO delivery_schedule_items_v2 SELECT id, schedule_id, product_id, item_name, qty_expected, notes, COALESCE(is_urgent, 0) FROM delivery_schedule_items`).run();
    db.prepare('DROP TABLE delivery_schedule_items').run();
    db.prepare('ALTER TABLE delivery_schedule_items_v2 RENAME TO delivery_schedule_items').run();
    db.pragma('foreign_keys = ON');
  }

  // bills: missing columns from old schema
  safeAddColumn('bills', 'cancelled_at', 'DATETIME');
  safeAddColumn('bills', 'cancelled_by', 'INTEGER REFERENCES users(id)');
  // bills: หมายเหตุตอน qc_supervisor ส่งกลับ (reject) ให้ qc_staff เห็นสาเหตุ+แก้ไขได้ (S159) — เคลียร์กลับ
  // เป็น NULL ตอน submit ใหม่ (billService.submitBill) กันโน้ตเก่าค้างข้ามรอบ reject ถัดไป
  safeAddColumn('bills', 'reject_comment', 'TEXT');

  // bill_items: ISO compliance columns
  safeAddColumn('bill_items', 'inspector_id', 'INTEGER REFERENCES users(id)');
  safeAddColumn('bill_items', 'inspected_at', 'DATETIME');
  safeAddColumn('bill_items', 'inspection_note', 'TEXT');
  safeAddColumn('bill_items', 'drawing_revision_id', 'INTEGER REFERENCES product_drawings(id)');
  safeAddColumn('bill_items', 'lot_number', 'TEXT');
  safeAddColumn('bill_items', 'batch_number', 'TEXT');
  safeAddColumn('bill_items', 'manufacturing_date', 'DATE');
  safeAddColumn('bill_items', 'expiry_date', 'DATE');
  safeAddColumn('bill_items', 'country_of_origin', 'TEXT');

  // ncrs: drop old single-item columns (moved to ncr_items table)
  safeDropColumn('ncrs', 'item_name');
  safeDropColumn('ncrs', 'qty_failed');
  safeDropColumn('ncrs', 'problem_description');

  // ncrs: missing columns
  safeAddColumn('ncrs', 'token_expires_at', 'DATETIME');
  safeAddColumn('ncrs', 'cancelled_at', 'DATETIME');
  safeAddColumn('ncrs', 'cancelled_by', 'INTEGER REFERENCES users(id)');
  safeAddColumn('ncrs', 'disposition', 'TEXT');
  safeAddColumn('ncrs', 'disposition_note', 'TEXT');
  safeAddColumn('ncrs', 'disposition_due_date', 'DATE');
  safeAddColumn('ncrs', 'disposition_completed_at', 'DATETIME');
  safeAddColumn('ncrs', 'disposition_by', 'INTEGER REFERENCES users(id)');
  safeAddColumn('ncrs', 'closed_at', 'DATETIME');
  safeAddColumn('ncrs', 'effectiveness_check_date', 'DATE');
  safeAddColumn('ncrs', 'effectiveness_result', 'TEXT');
  safeAddColumn('ncrs', 'effectiveness_note', 'TEXT');
  safeAddColumn('ncrs', 'effectiveness_checked_by', 'INTEGER REFERENCES users(id)');
  safeAddColumn('ncrs', 'effectiveness_checked_at', 'DATETIME');

  // ncr_items: bilingual fields for supplier communication
  safeAddColumn('ncr_items', 'item_name_en', 'TEXT');
  safeAddColumn('ncr_items', 'defect_detail_en', 'TEXT');
  // ncr_items: มูลค่าสินค้าเคลม (S128) — TEXT เพราะอนุญาตให้กรอก "-" แทนกรณีไม่มีมูลค่า
  safeAddColumn('ncr_items', 'claim_value_thb', 'TEXT');
  safeAddColumn('ncr_items', 'claim_value_usd', 'TEXT');

  // ncrs: purchasing acknowledgment + link copy tracking
  safeAddColumn('ncrs', 'purchasing_received_at', 'DATETIME');
  safeAddColumn('ncrs', 'purchasing_received_by', 'INTEGER REFERENCES users(id)');
  safeAddColumn('ncrs', 'link_copied_at', 'DATETIME');
  safeAddColumn('ncrs', 'link_copied_by', 'INTEGER REFERENCES users(id)');
  safeAddColumn('ncrs', 'link_copied_count', 'INTEGER DEFAULT 0');
  // Req 6 (Purchasing dashboard) — กันแจ้งเตือน "เกินกำหนด" ซ้ำทุกรอบที่ scheduler รัน (แจ้งครั้งเดียวต่อรายการ)
  safeAddColumn('ncrs', 'overdue_notified_at', 'DATETIME');
  // S150 — เวลาที่ QMR อนุมัติเปิด NCR จริง (pending_qmr_open → pending_purchasing_review) ใช้เป็นจุดเริ่มนับวัน
  // overdue แทน disposition_due_date เดิม (เคยแจ้งเตือนก่อน QMR เปิดเอกสารด้วยซ้ำ — ดู overdueNotifier.js)
  safeAddColumn('ncrs', 'qmr_opened_at', 'DATETIME');
  // S152 — เวลาที่ส่งแจ้งเตือนส่วนตัว "ค้างอนุมัติ" ครั้งล่าสุด (เฉพาะ 3 ขั้นก่อนถึงจัดซื้อ — ดู internalReminder.js)
  // reset เป็น NULL ทุกครั้งที่ status เปลี่ยน (ncrService.js's approveNcr) เพราะขั้นใหม่ต้องเริ่มนับรอบใหม่เสมอ
  safeAddColumn('ncrs', 'internal_reminder_last_sent_at', 'DATETIME');

  // supplier_responses: respondent name + track superseded responses
  safeAddColumn('supplier_responses', 'respondent_name', 'TEXT');
  safeAddColumn('supplier_responses', 'superseded_at', 'DATETIME');

  // ncr_images: add ncr_item_id
  safeAddColumn('ncr_images', 'ncr_item_id', 'INTEGER REFERENCES ncr_items(id)');

  // uai_signatures: add comment
  safeAddColumn('uai_signatures', 'comment', 'TEXT');

  // uai_documents: add created_by (purchasing user who requested UAI)
  safeAddColumn('uai_documents', 'created_by', 'INTEGER REFERENCES users(id)');

  // uai_documents: UAI request form fields (purchasing fills in)
  safeAddColumn('uai_documents', 'product_type', 'TEXT');
  safeAddColumn('uai_documents', 'work_type', 'TEXT');
  safeAddColumn('uai_documents', 'defect_description', 'TEXT');
  safeAddColumn('uai_documents', 'root_cause_purchasing', 'TEXT');
  safeAddColumn('uai_documents', 'corrective_action_purchasing', 'TEXT');
  safeAddColumn('uai_documents', 'preventive_action_purchasing', 'TEXT');

  // ncrs: stamp when closed via UAI approval
  safeAddColumn('ncrs', 'uai_close_remark', 'TEXT');

  // suppliers: ASL columns
  safeAddColumn('suppliers', 'approval_status', "TEXT DEFAULT 'trial'");
  safeAddColumn('suppliers', 'approval_date', 'DATE');
  safeAddColumn('suppliers', 'approval_by', 'INTEGER REFERENCES users(id)');
  safeAddColumn('suppliers', 'suspension_reason', 'TEXT');
  safeAddColumn('suppliers', 'next_evaluation_date', 'DATE');

  // product_groups: ISO flags
  safeAddColumn('product_groups', 'require_lot_number', 'INTEGER DEFAULT 0');
  safeAddColumn('product_groups', 'require_expiry_date', 'INTEGER DEFAULT 0');
  safeAddColumn('product_groups', 'require_certificate', 'INTEGER DEFAULT 0');
  safeAddColumn('product_groups', 'has_shelf_life', 'INTEGER DEFAULT 0');
  safeAddColumn('product_groups', 'shelf_life_days', 'INTEGER');

  // products: model, inspection level
  safeAddColumn('products', 'model_id', 'INTEGER REFERENCES models(id)');
  safeAddColumn('products', 'inspection_level', "TEXT DEFAULT 'GEN_II'");
  safeAddColumn('products', 'aql_value', "TEXT DEFAULT '2.5'");

  // users: is_active
  safeAddColumn('users', 'is_active', 'INTEGER DEFAULT 1');

  // product_suppliers: many-to-many junction (product can have multiple suppliers)
  db.prepare(`CREATE TABLE IF NOT EXISTS product_suppliers (
    product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
    PRIMARY KEY (product_id, supplier_id)
  )`).run();
  // Migrate existing supplier_id → product_suppliers (idempotent via INSERT OR IGNORE)
  db.prepare(`INSERT OR IGNORE INTO product_suppliers (product_id, supplier_id)
    SELECT id, supplier_id FROM products WHERE supplier_id IS NOT NULL`).run();

  // supplier_purchasing_assignees: many-to-many junction (supplier can have >1 ผู้ดูแลจัดซื้อ)
  db.prepare(`CREATE TABLE IF NOT EXISTS supplier_purchasing_assignees (
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    PRIMARY KEY (supplier_id, user_id)
  )`).run();

  // supplier_product_groups: many-to-many junction (supplier ผลิต/ส่งได้มากกว่า 1 กลุ่มสินค้า) — คำขอ user
  // (S146) ใช้กรอง Supplier ตามกลุ่มสินค้าในฟอร์มเพิ่มสินค้าใหม่
  db.prepare(`CREATE TABLE IF NOT EXISTS supplier_product_groups (
    supplier_id      INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    product_group_id INTEGER NOT NULL REFERENCES product_groups(id) ON DELETE CASCADE,
    PRIMARY KEY (supplier_id, product_group_id)
  )`).run();

  // product_images: image_type (product vs quality_issue)
  safeAddColumn('product_images', 'image_type', "TEXT DEFAULT 'product'");

  // issue_talks: supplier context
  safeAddColumn('issue_talks', 'supplier_id', 'INTEGER');

  // users: QC station assignment for attendance
  safeAddColumn('users', 'qc_station', 'TEXT');

  // users: factory assignment for IPQC/FGQC module (โรง1-4 / อาคารA)
  safeAddColumn('users', 'factory_assignment', 'TEXT');

  // users: personal Telegram chat id — ส่งแจ้งเตือนกระดิ่งเข้า Telegram ส่วนตัวของแต่ละคน
  safeAddColumn('users', 'telegram_chat_id', 'TEXT');
  // uai_signatures: วิธียืนยัน (S168) — signature/approve_button/telegram (ดู schema.sql comment)
  safeAddColumn('uai_signatures', 'signature_method', "TEXT NOT NULL DEFAULT 'signature'");
  // users: อีเมลส่วนตัว (S128) — ใช้ส่งแจ้งเตือนอีเมล (เช่น COO รับทราบ NCR) เหมือน telegram_chat_id
  safeAddColumn('users', 'email', 'TEXT');
  // users: Telegram @username สาธารณะ (S153) — เก็บไม่มี '@' นำหน้า, ใช้ @mention ในข้อความกลุ่ม (เช่น
  // แจ้งเตือน NCR เกินกำหนด ไปกลุ่มจัดซื้อ) ต่างจาก telegram_chat_id ที่ใช้ส่ง DM ส่วนตัวเท่านั้น — plain-text
  // "@username" ถูก Telegram parse เป็น mention entity อัตโนมัติแม้ไม่ตั้ง parse_mode (ไม่ต้องเสี่ยง HTML
  // injection จากข้อความที่มีค่าผู้ใช้กรอกปนอยู่ — ดู sendTelegram()'s comment เดิมใน routes/notifications.js)
  safeAddColumn('users', 'telegram_username', 'TEXT');

  // users: Authentication Provider Framework — local (default) หรือ ad (ผูก Active Directory)
  // validate ที่ application layer เท่านั้น (ไม่ทำ CHECK rebuild) เหมือน qc_station/factory_assignment
  safeAddColumn('users', 'auth_provider', "TEXT NOT NULL DEFAULT 'local'");
  // users: persistent account lockout (ทนรอด server restart ต่างจาก express-rate-limit เดิมที่เป็น in-memory)
  safeAddColumn('users', 'failed_login_count', 'INTEGER NOT NULL DEFAULT 0');
  safeAddColumn('users', 'locked_until', 'DATETIME');
  // users: เวลาที่ password hash cache ถูก sync จาก AD Gateway ล่าสุด (self-healing mirrored sync — ช่วย debug)
  safeAddColumn('users', 'ad_last_synced_at', 'DATETIME');

  // qc_attendance: check-out, late tracking, work hours
  safeAddColumn('qc_attendance', 'check_out_at', 'DATETIME');
  safeAddColumn('qc_attendance', 'late_minutes', 'INTEGER DEFAULT 0');
  safeAddColumn('qc_attendance', 'work_minutes', 'INTEGER');
  safeAddColumn('qc_attendance', 'admin_note', 'TEXT');

  // kpi_items: target direction (gte = ไม่ต่ำกว่า, lte = ไม่เกิน)
  safeAddColumn('kpi_items', 'target_direction', "TEXT DEFAULT 'gte'");
  // kpi_items: annual summary type (average = เฉลี่ย, sum = รวม)
  safeAddColumn('kpi_items', 'summary_type', "TEXT DEFAULT 'average'");
  // kpi_action_plans: เพิ่ม QMR step (Admin→QCM→CPO→QMR) — recreate table if needed
  migrateKpiActionPlansQmr();
  // kpi_action_plans: เก็บข้อมูลผู้ตีกลับและเวลา
  safeAddColumn('kpi_action_plans', 'rejected_by', 'INTEGER');
  safeAddColumn('kpi_action_plans', 'rejected_at', 'TEXT');
  // kpi_title_templates: ชื่อหัวข้อ KPI สำหรับ dropdown
  db.prepare(`
    CREATE TABLE IF NOT EXISTS kpi_title_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      display_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `).run();
  // kpi_title_templates: เพิ่ม group_id + unit_id เพื่อ auto-fill group/unit เมื่อเลือกหัวข้อ
  safeAddColumn('kpi_title_templates', 'group_id', 'INTEGER');
  safeAddColumn('kpi_title_templates', 'unit_id', 'INTEGER');
  // kpi_units: หน่วยวัด KPI สำหรับ dropdown
  db.prepare(`
    CREATE TABLE IF NOT EXISTS kpi_units (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `).run();

  // kpi_no_patterns: รูปแบบ KPI No. — ครั้งแรกที่สร้างตาราง ให้ clear KPI data ทั้งหมดก่อน
  const kpiNoPatternsExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='kpi_no_patterns'"
  ).get();
  if (!kpiNoPatternsExists) {
    db.pragma('foreign_keys = OFF');
    const kpiTables = [
      'kpi_action_plans','kpi_approvals','kpi_targets','kpi_reports',
      'kpi_items','kpi_title_templates','kpi_groups','kpi_units',
    ];
    for (const t of kpiTables) {
      try { db.prepare(`DELETE FROM ${t}`).run(); } catch (_) {}
    }
    db.pragma('foreign_keys = ON');
  }
  db.prepare(`
    CREATE TABLE IF NOT EXISTS kpi_no_patterns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prefix TEXT NOT NULL UNIQUE,
      description TEXT,
      is_active INTEGER DEFAULT 1,
      display_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `).run();

  // ipncr_records: IPQC status machine v2 — เพิ่ม columns สำหรับ prod_manager approval + qc reinspect
  safeAddColumn('ipncr_records', 'recheck_attempt',          'INTEGER DEFAULT 1');
  safeAddColumn('ipncr_records', 'prod_manager_approved_by', 'INTEGER');
  safeAddColumn('ipncr_records', 'prod_manager_approved_at', 'TEXT');
  safeAddColumn('ipncr_records', 'prod_manager_remarks',     'TEXT');
  safeAddColumn('ipncr_records', 'qc_reinspect_result',      'TEXT');
  safeAddColumn('ipncr_records', 'qc_reinspect_by',          'INTEGER');
  safeAddColumn('ipncr_records', 'qc_reinspect_at',          'TEXT');
  safeAddColumn('ipncr_records', 'qc_reinspect_remarks',     'TEXT');
  safeAddColumn('ipncr_records', 'inspection_id',            'INTEGER');

  // ipqc_check_templates: spec-based matching — กรองหา template ที่ตรงกับสินค้าที่ตรวจ
  safeAddColumn('ipqc_check_templates', 'spec_series',       'TEXT');  // product_series เช่น FA, uPVC
  safeAddColumn('ipqc_check_templates', 'spec_brand',        'TEXT');  // brand
  safeAddColumn('ipqc_check_templates', 'spec_product_type', 'TEXT');  // panel_type เช่น หน้าต่าง, ประตู
  safeAddColumn('ipqc_check_templates', 'spec_window_type',  'TEXT');  // panel_style เช่น บานเปิดเดี่ยว
  safeAddColumn('ipqc_check_templates', 'spec_color',        'TEXT');  // panel_color เช่น สีขาว
  safeAddColumn('ipqc_check_templates', 'spec_size',         'TEXT');  // panel_size เช่น 60x150
  db.prepare('CREATE INDEX IF NOT EXISTS idx_ipqc_tmpl_spec ON ipqc_check_templates(spec_series, spec_product_type)').run();

  // ipqc_check_items: reference fields สำหรับแสดงให้พนักงานรู้ว่าวัดตรงไหน
  safeAddColumn('ipqc_check_items', 'target_dimension',   'TEXT');  // เช่น "ความยาว ด้านบน"
  safeAddColumn('ipqc_check_items', 'position_reference', 'TEXT');  // เช่น "วัดที่มุม 90° จากขอบซ้าย"
  safeAddColumn('ipqc_check_items', 'tags',               'TEXT');  // JSON array เพิ่มเติม

  // fg_defect_records + fg_fncp: FM Category (FG-specific) + supervisor/manager approval columns
  safeAddColumn('fg_defect_records', 'fm_category_id',           'INTEGER');
  safeAddColumn('fg_fncp',           'fm_category_id',           'INTEGER');
  safeAddColumn('fg_fncp',           'supervisor_approved_by',    'INTEGER');
  safeAddColumn('fg_fncp',           'supervisor_approved_at',    'TEXT');
  safeAddColumn('fg_fncp',           'manager_approved_by',       'INTEGER');
  safeAddColumn('fg_fncp',           'manager_approved_at',       'TEXT');

  // FQC เก่า (Session 104) — ไม่เคยมี route จริง (`/api/fqc` ไม่เคย mount), แทนที่ด้วย fgqc_records แล้ว
  // ลบตารางออกจาก DB ที่มีอยู่เดิม (schema.sql ตัด CREATE TABLE ออกไปแล้ว — กัน error ตอน initSchema ถ้ามีข้อมูลเก่าค้าง)
  db.prepare('DROP TABLE IF EXISTS fqc_monthly_approvals').run();
  db.prepare('DROP TABLE IF EXISTS fqc_defect_items').run();
  db.prepare('DROP TABLE IF EXISTS fqc_images').run();
  db.prepare('DROP TABLE IF EXISTS fqc_records').run();

  // line_types / factories: dropdown master สำหรับฟอร์ม "สายผลิต" (เพิ่มได้ผ่านปุ่ม +)
  // ต้องสร้างที่นี่ด้วย (ไม่ใช่แค่ schema.sql) เพราะ DB เดิมที่มีอยู่แล้วไม่ได้รัน schema.sql ซ้ำ
  db.prepare(`CREATE TABLE IF NOT EXISTS line_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`).run();
  db.prepare(`CREATE TABLE IF NOT EXISTS factories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    factory_code TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`).run();
  db.prepare(`CREATE TABLE IF NOT EXISTS production_line_seq (
    factory TEXT NOT NULL,
    line_type TEXT NOT NULL,
    last_seq INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (factory, line_type)
  )`).run();

  // environment_presets: preset ของ endpoint ต่อ environment (Dev/UAT/Prod/OnPrem/Cloud) — กด "Apply" แล้ว
  // copy ค่าเข้า settings จริง (app_url/ad_gateway_url/ad_domain) ไม่มี query runtime ไหน join ตารางนี้ตรงๆ
  db.prepare(`CREATE TABLE IF NOT EXISTS environment_presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    env_key TEXT UNIQUE NOT NULL,
    label TEXT NOT NULL,
    api_url TEXT,
    ad_gateway_url TEXT,
    ad_domain TEXT,
    is_current INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`).run();

  // production_lines.line_type: เดิมมี CHECK(line_type IN ('alu','upvc','other')) — DB เก่าต้อง rebuild ตารางออก
  migrateProductionLinesLineTypeConstraint();
}

// ===== MIGRATE production_lines — drop fixed CHECK(line_type IN (...)) constraint =====
// เดิม line_type ถูก enum ตายตัว ('alu','upvc','other') — ตอนนี้ตัวเลือกมาจาก line_types table แทน (ขยายได้)
function migrateProductionLinesLineTypeConstraint() {
  const info = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='production_lines'").get();
  if (!info || !info.sql.includes("CHECK(line_type IN")) return; // already up-to-date (or fresh DB)

  console.log('[Migration] Dropping production_lines.line_type CHECK constraint...');
  const oldColSet = new Set(db.prepare('PRAGMA table_info(production_lines)').all().map(c => c.name));
  const newColList = ['id', 'code', 'name', 'line_type', 'factory', 'factory_code', 'pdplan_sheet', 'is_active', 'created_at'];
  const shared = newColList.filter(c => oldColSet.has(c)).join(',');
  if (!shared) { console.error('[Migration] production_lines: no shared columns — aborting to avoid data loss'); return; }

  db.pragma('foreign_keys = OFF');
  db.pragma('legacy_alter_table = ON');
  try {
    db.transaction(() => {
      db.prepare('ALTER TABLE production_lines RENAME TO production_lines_old').run();
      db.prepare(`
        CREATE TABLE production_lines (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          code         TEXT UNIQUE NOT NULL,
          name         TEXT NOT NULL,
          line_type    TEXT NOT NULL,
          factory      TEXT NOT NULL,
          factory_code TEXT NOT NULL,
          pdplan_sheet TEXT,
          is_active    INTEGER DEFAULT 1,
          created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `).run();
      db.prepare(`INSERT INTO production_lines (${shared}) SELECT ${shared} FROM production_lines_old`).run();
      db.prepare('DROP TABLE production_lines_old').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_prod_line_active ON production_lines(is_active)').run();
    })();
    console.log('[Migration] production_lines.line_type constraint dropped');
  } catch (e) {
    console.error('[Migration] production_lines line_type migration failed:', e.message);
    try {
      const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='production_lines'").get();
      if (!exists) db.prepare('ALTER TABLE production_lines_old RENAME TO production_lines').run();
    } catch {}
    throw e;
  } finally {
    db.pragma('legacy_alter_table = OFF');
    db.pragma('foreign_keys = ON');
  }
}

function migrateKpiActionPlansQmr() {
  const cols = db.prepare("PRAGMA table_info(kpi_action_plans)").all().map(c => c.name);
  if (cols.includes('qmr_signed_by')) return; // already migrated
  db.exec(`
    CREATE TABLE IF NOT EXISTS kpi_action_plans_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kpi_item_id INTEGER NOT NULL REFERENCES kpi_items(id) ON DELETE CASCADE,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK(status IN ('draft','pending_qcm','pending_cpo','pending_qmr','approved')),
      fail_cause TEXT,
      corrective_action TEXT,
      preventive_action TEXT,
      remark TEXT,
      reject_reason TEXT,
      revision INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER REFERENCES users(id),
      submitted_at TEXT,
      qcm_signed_by INTEGER REFERENCES users(id),
      qcm_signed_at TEXT,
      cpo_signed_by INTEGER REFERENCES users(id),
      cpo_signed_at TEXT,
      qmr_signed_by INTEGER REFERENCES users(id),
      qmr_signed_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(kpi_item_id, year, month)
    );
    INSERT OR IGNORE INTO kpi_action_plans_v2
      (id,kpi_item_id,year,month,status,fail_cause,corrective_action,preventive_action,
       remark,reject_reason,revision,created_by,submitted_at,
       qcm_signed_by,qcm_signed_at,cpo_signed_by,cpo_signed_at,created_at,updated_at)
      SELECT id,kpi_item_id,year,month,status,fail_cause,corrective_action,preventive_action,
             remark,reject_reason,revision,created_by,submitted_at,
             qcm_signed_by,qcm_signed_at,cpo_signed_by,cpo_signed_at,created_at,updated_at
      FROM kpi_action_plans;
    DROP TABLE kpi_action_plans;
    ALTER TABLE kpi_action_plans_v2 RENAME TO kpi_action_plans;
    CREATE INDEX IF NOT EXISTS idx_kpi_ap_item   ON kpi_action_plans(kpi_item_id, year, month);
    CREATE INDEX IF NOT EXISTS idx_kpi_ap_status ON kpi_action_plans(status);
  `);
}

// ===== SEED DATA =====
function seedData() {
  // document_sequences
  const seqNCR = db.prepare("SELECT 1 FROM document_sequences WHERE doc_type = 'NCR'").get();
  if (!seqNCR) {
    db.prepare("INSERT INTO document_sequences (doc_type, year, last_seq) VALUES ('NCR', ?, 0)").run(new Date().getFullYear());
    db.prepare("INSERT INTO document_sequences (doc_type, year, last_seq) VALUES ('UAI', ?, 0)").run(new Date().getFullYear());
    db.prepare("INSERT INTO document_sequences (doc_type, year, last_seq) VALUES ('NCP', ?, 0)").run(new Date().getFullYear());
  }
  // Ensure NCP sequence exists (for existing installs that didn't have it)
  const seqNCP = db.prepare("SELECT 1 FROM document_sequences WHERE doc_type = 'NCP'").get();
  if (!seqNCP) {
    db.prepare("INSERT INTO document_sequences (doc_type, year, last_seq) VALUES ('NCP', ?, 0)").run(new Date().getFullYear());
  }

  // Ensure KPI sequence exists
  const seqKPI = db.prepare("SELECT 1 FROM document_sequences WHERE doc_type = 'KPI'").get();
  if (!seqKPI) {
    db.prepare("INSERT INTO document_sequences (doc_type, year, last_seq) VALUES ('KPI', ?, 0)").run(new Date().getFullYear());
  }

  // Ensure IPQC/FGQC sequences exist (production-floor QC module) — FQC ตัดออกแล้ว (Session 104, dead feature)
  for (const dt of ['IPQC', 'FGQC', 'IPNCR', 'IPNCP']) {
    const seq = db.prepare('SELECT 1 FROM document_sequences WHERE doc_type = ?').get(dt);
    if (!seq) {
      db.prepare('INSERT INTO document_sequences (doc_type, year, last_seq) VALUES (?, ?, 0)').run(dt, new Date().getFullYear());
    }
  }

  // return_stations default seed
  const rsCount = db.prepare('SELECT COUNT(*) as c FROM return_stations').get();
  if (rsCount.c === 0) {
    const insRs = db.prepare('INSERT INTO return_stations (name, factory, sort_order) VALUES (?, ?, ?)');
    const stations = [
      ['ห้องทดสอบบาน', null, 1],
      ['ติดมุ้ง', null, 2],
      ['ติดกระจก', null, 3],
      ['ประกอบเฟรม', null, 4],
      ['ทำสี / พ่นสี', null, 5],
      ['ตัดอลูมิเนียม', null, 6],
      ['แพ็คกิ้ง', null, 7],
    ];
    db.transaction(() => { for (const [n, f, o] of stations) insRs.run(n, f, o); })();
    console.log('[DB] Seeded default return_stations');
  }

  // Default FM categories (Man/Machine/Material/Method) — codes used in Defect Code
  const fmCount = db.prepare('SELECT COUNT(*) as c FROM fm_categories').get();
  if (fmCount.c === 0) {
    const insFm = db.prepare('INSERT INTO fm_categories (name, code) VALUES (?, ?)');
    [['Man', 'Mn'], ['Machine', 'Mc'], ['Material', 'Mt'], ['Method', 'Md']].forEach(([n, c]) => insFm.run(n, c));
    console.log('[DB] Seeded default FM categories');
  }

  // Default line_types (ประเภทสาย dropdown ในฟอร์มสายผลิต) — ตรงกับ enum เดิม เพิ่มเองต่อได้ผ่านปุ่ม +
  const ltCount = db.prepare('SELECT COUNT(*) as c FROM line_types').get();
  if (ltCount.c === 0) {
    const insLt = db.prepare('INSERT INTO line_types (code, name) VALUES (?, ?)');
    [['alu', 'ALU'], ['upvc', 'uPVC'], ['other', 'อื่นๆ']].forEach(([c, n]) => insLt.run(c, n));
    console.log('[DB] Seeded default line_types');
  }

  // factories (โรงงาน dropdown) — backfill จาก production_lines เดิมที่มีอยู่ (กัน dropdown ว่างตอนอัปเกรด)
  const facCount = db.prepare('SELECT COUNT(*) as c FROM factories').get();
  if (facCount.c === 0) {
    const existing = db.prepare(`
      SELECT factory AS name, factory_code, MIN(id) AS first_id
      FROM production_lines GROUP BY factory ORDER BY first_id
    `).all();
    if (existing.length) {
      const insFac = db.prepare('INSERT OR IGNORE INTO factories (name, factory_code) VALUES (?, ?)');
      db.transaction(() => { for (const f of existing) insFac.run(f.name, f.factory_code); })();
      console.log(`[DB] Backfilled ${existing.length} factories from existing production_lines`);
    }
  }

  // Default shifts
  const shiftCount = db.prepare('SELECT COUNT(*) as c FROM shifts').get();
  if (shiftCount.c === 0) {
    const insShift = db.prepare('INSERT INTO shifts (name, start_time, end_time) VALUES (?, ?, ?)');
    [['กะเช้า', '08:00', '17:00'], ['กะบ่าย', '17:00', '01:00'], ['กะดึก', '01:00', '08:00']].forEach(([n, s, e]) => insShift.run(n, s, e));
    console.log('[DB] Seeded default shifts');
  }

  // Default process steps (line-agnostic — NULL production_line_id) from legacy AddProblem.frm
  const psCount = db.prepare('SELECT COUNT(*) as c FROM process_steps').get();
  if (psCount.c === 0) {
    const insPs = db.prepare('INSERT INTO process_steps (production_line_id, name, code, sort_order) VALUES (NULL, ?, ?, ?)');
    const steps = [
      ['ขั้นตอนการตัด', 'TC', 1],
      ['ขั้นตอนการเล้าเตอร์ล้อมุ้ง', 'RT', 2],
      ['ขั้นตอนการเล้าเตอร์มือจับมุ้ง', 'RH', 3],
      ['ขั้นตอนการใส่สักหลาด', 'FL', 4],
      ['ขั้นตอนการเข้าฉาก', 'CN', 5],
      ['ขั้นตอนการเข้ามุ้ง', 'NT', 6],
      ['ขั้นตอนการใส่กระจก', 'GL', 7],
      ['ขั้นตอนการประกอบเฟรม', 'AF', 8],
      ['ขั้นตอนการประกอบบาน', 'AP', 9],
      ['ขั้นตอนการประกอบเหล็กดัด', 'AI', 10],
      ['ขั้นตอนการทดสอบบาน', 'TP', 11],
      ['ขั้นตอนการแพ็คกิ้ง', 'PK', 12],
    ];
    db.transaction(() => { for (const [n, c, o] of steps) insPs.run(n, c, o); })();
    console.log('[DB] Seeded default process steps (line-agnostic)');
  }

  // IPQC Stations — 5 stations เริ่มต้น
  const ipqcStCount = db.prepare('SELECT COUNT(*) as c FROM ipqc_stations').get();
  if (ipqcStCount.c === 0) {
    const insIpqcSt = db.prepare('INSERT INTO ipqc_stations (name, code, sort_order) VALUES (?, ?, ?)');
    db.transaction(() => {
      [
        ['ตัดเส้น',     'cutting',    1],
        ['ประกอบเฟรม',  'frame',      2],
        ['ประกอบบาน',   'door',       3],
        ['ประกอบมุ้ง',  'screen',     4],
        ['เทสบาน',      'final_test', 5],
      ].forEach(([n, c, o]) => insIpqcSt.run(n, c, o));
    })();
    console.log('[DB] Seeded IPQC stations (5)');
  }

  // Default global defect-rate threshold (3% — NULL line + NULL product)
  const thrCount = db.prepare('SELECT COUNT(*) as c FROM defect_rate_thresholds').get();
  if (thrCount.c === 0) {
    db.prepare('INSERT INTO defect_rate_thresholds (production_line_id, pro_code_sap_id, threshold_pct) VALUES (NULL, NULL, 3.0)').run();
    console.log('[DB] Seeded default global defect-rate threshold (3%)');
  }

  // settings defaults
  const settingKeys = [
    'telegram_bot_token','telegram_group_qc','telegram_group_purchasing','app_url','token_expiry_days',
    // S168 — Telegram webhook (อนุมัติ UAI ผ่านปุ่ม inline) — telegram_webhook_secret เข้ารหัสผ่าน
    // getSecretSetting/setSecretSetting (pattern เดียวกับ ad_secret_key) ต่างจาก telegram_bot_token เดิม
    'telegram_webhook_secret', 'telegram_webhook_enabled',
    'company_name','company_address','company_logo',
    'ncr_img_cols','ncr_img_max_width','uai_img_cols','uai_img_max_width',
    'factory_lat','factory_lon','factory_radius_m',
    // General (Authentication Provider Framework — DEVMORE AUTH-1)
    'system_name','ui_language','timezone','session_timeout_minutes','remember_login_enabled',
    // Authentication — mode ที่ใช้งานจริงมีแค่ 'local'/'hybrid' (ดู CLAUDE.md §24 — AD ต้องเป็นระบบเสริมเสมอ)
    'auth_mode','ad_enabled','ad_gateway_url','ad_app_id','ad_secret_key','ad_domain',
    'ad_use_ssl','ad_timeout_ms','ad_retry_count',
    // Security
    'jwt_expiration_hours','refresh_token_enabled','login_attempt_max','lock_account_minutes',
    'password_min_length','password_require_complexity',
    // Advanced
    'api_version','debug_mode','health_check_enabled','custom_header_name','custom_header_value',
  ];
  const defaults = {
    telegram_bot_token: '', telegram_group_qc: '', telegram_group_purchasing: '',
    telegram_webhook_secret: '', telegram_webhook_enabled: '0',
    app_url: 'http://localhost:5173', token_expiry_days: '90',
    company_name: '', company_address: '', company_logo: '',
    ncr_img_cols: '3', ncr_img_max_width: '180',
    uai_img_cols: '3', uai_img_max_width: '160',
    factory_lat: '', factory_lon: '', factory_radius_m: '200',
    system_name: 'IQC System', ui_language: 'th', timezone: 'Asia/Bangkok',
    session_timeout_minutes: '30', remember_login_enabled: '1',
    auth_mode: 'local', ad_enabled: '0', ad_gateway_url: '', ad_app_id: '', ad_secret_key: '',
    ad_domain: '', ad_use_ssl: '1', ad_timeout_ms: '5000', ad_retry_count: '1',
    jwt_expiration_hours: '8', refresh_token_enabled: '0', login_attempt_max: '5',
    lock_account_minutes: '15', password_min_length: '8', password_require_complexity: '0',
    api_version: 'v1', debug_mode: '0', health_check_enabled: '1',
    custom_header_name: '', custom_header_value: '',
  };
  for (const key of settingKeys) {
    const exists = db.prepare('SELECT 1 FROM settings WHERE key = ?').get(key);
    if (!exists) {
      db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(key, defaults[key]);
    }
  }

  // Default KPI groups
  const kpiGroupCount = db.prepare('SELECT COUNT(*) as c FROM kpi_groups').get();
  if (kpiGroupCount.c === 0) {
    const insKpiGroup = db.prepare('INSERT INTO kpi_groups (name, display_order) VALUES (?, ?)');
    [['งานคุณภาพ', 1], ['ความปลอดภัย', 2], ['สิ่งแวดล้อม', 3], ['การผลิต', 4]].forEach(([n, o]) => insKpiGroup.run(n, o));
    console.log('[DB] Seeded default KPI groups');
  }

  // AQL tables — ISO 2859-1 standard seed data
  const aqlCount = db.prepare('SELECT COUNT(*) as c FROM aql_tables').get();
  if (aqlCount.c === 0) {
    const insAQL = db.prepare(
      'INSERT INTO aql_tables (inspection_level, aql_value, batch_from, batch_to, sample_size, accept_number, reject_number) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const aqlRows = [
      // GEN_II + AQL 2.5  (ค่าเริ่มต้นที่ใช้บ่อยที่สุด)
      ['GEN_II','2.5',2,8,3,0,1],
      ['GEN_II','2.5',9,15,3,0,1],
      ['GEN_II','2.5',16,25,5,0,1],
      ['GEN_II','2.5',26,50,8,0,1],
      ['GEN_II','2.5',51,90,13,1,2],
      ['GEN_II','2.5',91,150,20,1,2],
      ['GEN_II','2.5',151,280,32,2,3],
      ['GEN_II','2.5',281,500,50,3,4],
      ['GEN_II','2.5',501,1200,80,5,6],
      ['GEN_II','2.5',1201,3200,125,7,8],
      ['GEN_II','2.5',3201,10000,200,10,11],
      ['GEN_II','2.5',10001,null,315,14,15],
      // GEN_II + AQL 1.5
      ['GEN_II','1.5',2,8,5,0,1],
      ['GEN_II','1.5',9,15,5,0,1],
      ['GEN_II','1.5',16,25,5,0,1],
      ['GEN_II','1.5',26,50,8,0,1],
      ['GEN_II','1.5',51,90,13,0,1],
      ['GEN_II','1.5',91,150,20,1,2],
      ['GEN_II','1.5',151,280,32,1,2],
      ['GEN_II','1.5',281,500,50,2,3],
      ['GEN_II','1.5',501,1200,80,3,4],
      ['GEN_II','1.5',1201,3200,125,5,6],
      ['GEN_II','1.5',3201,10000,200,7,8],
      ['GEN_II','1.5',10001,null,315,10,11],
      // GEN_II + AQL 4.0
      ['GEN_II','4.0',2,8,3,0,1],
      ['GEN_II','4.0',9,15,5,0,1],
      ['GEN_II','4.0',16,25,8,0,1],
      ['GEN_II','4.0',26,50,13,1,2],
      ['GEN_II','4.0',51,90,13,1,2],
      ['GEN_II','4.0',91,150,20,2,3],
      ['GEN_II','4.0',151,280,32,3,4],
      ['GEN_II','4.0',281,500,50,5,6],
      ['GEN_II','4.0',501,1200,80,7,8],
      ['GEN_II','4.0',1201,3200,125,10,11],
      ['GEN_II','4.0',3201,10000,200,14,15],
      ['GEN_II','4.0',10001,null,315,21,22],
      // GEN_II + AQL 6.5
      ['GEN_II','6.5',2,8,3,0,1],
      ['GEN_II','6.5',9,15,5,0,1],
      ['GEN_II','6.5',16,25,8,1,2],
      ['GEN_II','6.5',26,50,13,1,2],
      ['GEN_II','6.5',51,90,20,2,3],
      ['GEN_II','6.5',91,150,32,3,4],
      ['GEN_II','6.5',151,280,50,5,6],
      ['GEN_II','6.5',281,500,80,7,8],
      ['GEN_II','6.5',501,1200,125,10,11],
      ['GEN_II','6.5',1201,3200,200,14,15],
      ['GEN_II','6.5',3201,10000,315,21,22],
      ['GEN_II','6.5',10001,null,500,21,22],
      // GEN_I + AQL 2.5
      ['GEN_I','2.5',2,15,2,0,1],
      ['GEN_I','2.5',16,25,3,0,1],
      ['GEN_I','2.5',26,90,5,0,1],
      ['GEN_I','2.5',91,150,8,0,1],
      ['GEN_I','2.5',151,280,13,1,2],
      ['GEN_I','2.5',281,500,20,1,2],
      ['GEN_I','2.5',501,1200,32,2,3],
      ['GEN_I','2.5',1201,3200,50,3,4],
      ['GEN_I','2.5',3201,10000,80,5,6],
      ['GEN_I','2.5',10001,null,125,7,8],
      // GEN_III + AQL 2.5
      ['GEN_III','2.5',2,8,5,0,1],
      ['GEN_III','2.5',9,15,8,0,1],
      ['GEN_III','2.5',16,25,13,1,2],
      ['GEN_III','2.5',26,50,20,1,2],
      ['GEN_III','2.5',51,90,32,2,3],
      ['GEN_III','2.5',91,150,50,3,4],
      ['GEN_III','2.5',151,280,80,5,6],
      ['GEN_III','2.5',281,500,125,7,8],
      ['GEN_III','2.5',501,1200,200,10,11],
      ['GEN_III','2.5',1201,3200,315,14,15],
      ['GEN_III','2.5',3201,10000,500,21,22],
      ['GEN_III','2.5',10001,null,800,21,22],
    ];
    db.transaction(() => { for (const r of aqlRows) insAQL.run(...r); })();
    console.log('[DB] Seeded AQL tables (ISO 2859-1)');
  }

  // AQL S1-S4 special inspection levels — ISO 2859-1 Table I (correct lot size ranges)
  // S1: A(2-50)→n=2, B(51-500)→n=3, C(501-35000)→n=5, D(35001+)→n=8
  // S2: A(2-15)→n=2, B(16-150)→n=3, C(151-1200)→n=5, D(1201-35000)→n=8, E(35001+)→n=13
  // S3: A(2-15)→n=2, B(16-50)→n=3, C(51-150)→n=5, D(151-500)→n=8, E(501-3200)→n=13, F(3201-35000)→n=20, G(35001+)→n=32
  // S4: A(2-15)→n=2, B(16-25)→n=3, C(26-90)→n=5, D(91-150)→n=8, E(151-500)→n=13, F(501-1200)→n=20, G(1201-10000)→n=32, H(10001-35000)→n=50, J(35001+)→n=80
  const s1Wrong = db.prepare("SELECT 1 FROM aql_tables WHERE inspection_level='S1' AND batch_from=151 LIMIT 1").get();
  if (s1Wrong) {
    // Delete wrong S1-S4 data and re-insert correctly
    db.prepare("DELETE FROM aql_tables WHERE inspection_level IN ('S1','S2','S3','S4')").run();
    console.log('[DB] Removed incorrect S1-S4 AQL data (wrong lot ranges)');
  }
  const s1Exists = db.prepare("SELECT 1 FROM aql_tables WHERE inspection_level='S1' LIMIT 1").get();
  if (!s1Exists) {
    const insAQL2 = db.prepare(
      'INSERT INTO aql_tables (inspection_level, aql_value, batch_from, batch_to, sample_size, accept_number, reject_number) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    // Ac/Re by sample size (n) and AQL from Table 2-A:
    // n=2:  AQL any  → 0/1
    // n=3:  AQL any  → 0/1
    // n=5:  AQL≤4.0  → 0/1 | 6.5 → 1/2
    // n=8:  AQL≤1.5  → 0/1 | 2.5 → 0/1 | 4.0 → 1/2 | 6.5 → 1/2
    // n=13: AQL≤2.5  → 0/1(0.65/1.0) or 1/2(1.5/2.5) | 4.0 → 1/2 | 6.5 → 2/3
    // n=20: AQL 0.65/1.0 → 0/1 | 1.5/2.5 → 1/2 | 4.0 → 2/3 | 6.5 → 3/4
    // n=32: AQL 0.65 → 0/1 | 1.0 → 1/2 | 1.5/2.5 → 1/2 | 4.0 → 3/4 | 6.5 → 5/6
    // n=50: AQL 0.65 → 1/2 | 1.0/1.5 → 2/3 | 2.5 → 3/4 | 4.0 → 5/6 | 6.5 → 7/8
    // n=80: AQL 0.65 → 1/2 | 1.0 → 2/3 | 1.5 → 3/4 | 2.5 → 5/6 | 4.0/6.5 → 7/8
    const specialRows = [
      // ── S1: 2-50→n=2, 51-500→n=3, 501-35000→n=5, 35001+→n=8 ──
      ['S1','0.65',2,50,2,0,1],    ['S1','0.65',51,500,3,0,1],   ['S1','0.65',501,35000,5,0,1],  ['S1','0.65',35001,null,8,0,1],
      ['S1','1.0', 2,50,2,0,1],    ['S1','1.0', 51,500,3,0,1],   ['S1','1.0', 501,35000,5,0,1],  ['S1','1.0', 35001,null,8,0,1],
      ['S1','1.5', 2,50,2,0,1],    ['S1','1.5', 51,500,3,0,1],   ['S1','1.5', 501,35000,5,0,1],  ['S1','1.5', 35001,null,8,0,1],
      ['S1','2.5', 2,50,2,0,1],    ['S1','2.5', 51,500,3,0,1],   ['S1','2.5', 501,35000,5,0,1],  ['S1','2.5', 35001,null,8,0,1],
      ['S1','4.0', 2,50,2,0,1],    ['S1','4.0', 51,500,3,0,1],   ['S1','4.0', 501,35000,5,0,1],  ['S1','4.0', 35001,null,8,1,2],
      ['S1','6.5', 2,50,2,0,1],    ['S1','6.5', 51,500,3,0,1],   ['S1','6.5', 501,35000,5,1,2],  ['S1','6.5', 35001,null,8,1,2],

      // ── S2: 2-15→n=2, 16-150→n=3, 151-1200→n=5, 1201-35000→n=8, 35001+→n=13 ──
      ['S2','0.65',2,15,2,0,1],  ['S2','0.65',16,150,3,0,1],  ['S2','0.65',151,1200,5,0,1],  ['S2','0.65',1201,35000,8,0,1],  ['S2','0.65',35001,null,13,0,1],
      ['S2','1.0', 2,15,2,0,1],  ['S2','1.0', 16,150,3,0,1],  ['S2','1.0', 151,1200,5,0,1],  ['S2','1.0', 1201,35000,8,0,1],  ['S2','1.0', 35001,null,13,0,1],
      ['S2','1.5', 2,15,2,0,1],  ['S2','1.5', 16,150,3,0,1],  ['S2','1.5', 151,1200,5,0,1],  ['S2','1.5', 1201,35000,8,0,1],  ['S2','1.5', 35001,null,13,0,1],
      ['S2','2.5', 2,15,2,0,1],  ['S2','2.5', 16,150,3,0,1],  ['S2','2.5', 151,1200,5,0,1],  ['S2','2.5', 1201,35000,8,0,1],  ['S2','2.5', 35001,null,13,1,2],
      ['S2','4.0', 2,15,2,0,1],  ['S2','4.0', 16,150,3,0,1],  ['S2','4.0', 151,1200,5,0,1],  ['S2','4.0', 1201,35000,8,1,2],  ['S2','4.0', 35001,null,13,1,2],
      ['S2','6.5', 2,15,2,0,1],  ['S2','6.5', 16,150,3,0,1],  ['S2','6.5', 151,1200,5,1,2],  ['S2','6.5', 1201,35000,8,1,2],  ['S2','6.5', 35001,null,13,2,3],

      // ── S3: 2-15→n=2, 16-50→n=3, 51-150→n=5, 151-500→n=8, 501-3200→n=13, 3201-35000→n=20, 35001+→n=32 ──
      ['S3','0.65',2,15,2,0,1],  ['S3','0.65',16,50,3,0,1],  ['S3','0.65',51,150,5,0,1],  ['S3','0.65',151,500,8,0,1],  ['S3','0.65',501,3200,13,0,1],  ['S3','0.65',3201,35000,20,0,1],  ['S3','0.65',35001,null,32,1,2],
      ['S3','1.0', 2,15,2,0,1],  ['S3','1.0', 16,50,3,0,1],  ['S3','1.0', 51,150,5,0,1],  ['S3','1.0', 151,500,8,0,1],  ['S3','1.0', 501,3200,13,0,1],  ['S3','1.0', 3201,35000,20,0,1],  ['S3','1.0', 35001,null,32,1,2],
      ['S3','1.5', 2,15,2,0,1],  ['S3','1.5', 16,50,3,0,1],  ['S3','1.5', 51,150,5,0,1],  ['S3','1.5', 151,500,8,0,1],  ['S3','1.5', 501,3200,13,1,2],  ['S3','1.5', 3201,35000,20,1,2],  ['S3','1.5', 35001,null,32,2,3],
      ['S3','2.5', 2,15,2,0,1],  ['S3','2.5', 16,50,3,0,1],  ['S3','2.5', 51,150,5,0,1],  ['S3','2.5', 151,500,8,0,1],  ['S3','2.5', 501,3200,13,1,2],  ['S3','2.5', 3201,35000,20,1,2],  ['S3','2.5', 35001,null,32,2,3],
      ['S3','4.0', 2,15,2,0,1],  ['S3','4.0', 16,50,3,0,1],  ['S3','4.0', 51,150,5,0,1],  ['S3','4.0', 151,500,8,1,2],  ['S3','4.0', 501,3200,13,1,2],  ['S3','4.0', 3201,35000,20,2,3],  ['S3','4.0', 35001,null,32,3,4],
      ['S3','6.5', 2,15,2,0,1],  ['S3','6.5', 16,50,3,0,1],  ['S3','6.5', 51,150,5,1,2],  ['S3','6.5', 151,500,8,1,2],  ['S3','6.5', 501,3200,13,2,3],  ['S3','6.5', 3201,35000,20,3,4],  ['S3','6.5', 35001,null,32,5,6],

      // ── S4: 2-15→n=2, 16-25→n=3, 26-90→n=5, 91-150→n=8, 151-500→n=13, 501-1200→n=20, 1201-10000→n=32, 10001-35000→n=50, 35001+→n=80 ──
      ['S4','0.65',2,15,2,0,1],  ['S4','0.65',16,25,3,0,1],  ['S4','0.65',26,90,5,0,1],  ['S4','0.65',91,150,8,0,1],  ['S4','0.65',151,500,13,0,1],  ['S4','0.65',501,1200,20,0,1],  ['S4','0.65',1201,10000,32,1,2],  ['S4','0.65',10001,35000,50,1,2],  ['S4','0.65',35001,null,80,1,2],
      ['S4','1.0', 2,15,2,0,1],  ['S4','1.0', 16,25,3,0,1],  ['S4','1.0', 26,90,5,0,1],  ['S4','1.0', 91,150,8,0,1],  ['S4','1.0', 151,500,13,0,1],  ['S4','1.0', 501,1200,20,0,1],  ['S4','1.0', 1201,10000,32,1,2],  ['S4','1.0', 10001,35000,50,2,3],  ['S4','1.0', 35001,null,80,2,3],
      ['S4','1.5', 2,15,2,0,1],  ['S4','1.5', 16,25,3,0,1],  ['S4','1.5', 26,90,5,0,1],  ['S4','1.5', 91,150,8,0,1],  ['S4','1.5', 151,500,13,1,2],  ['S4','1.5', 501,1200,20,1,2],  ['S4','1.5', 1201,10000,32,2,3],  ['S4','1.5', 10001,35000,50,3,4],  ['S4','1.5', 35001,null,80,3,4],
      ['S4','2.5', 2,15,2,0,1],  ['S4','2.5', 16,25,3,0,1],  ['S4','2.5', 26,90,5,0,1],  ['S4','2.5', 91,150,8,0,1],  ['S4','2.5', 151,500,13,1,2],  ['S4','2.5', 501,1200,20,1,2],  ['S4','2.5', 1201,10000,32,2,3],  ['S4','2.5', 10001,35000,50,3,4],  ['S4','2.5', 35001,null,80,5,6],
      ['S4','4.0', 2,15,2,0,1],  ['S4','4.0', 16,25,3,0,1],  ['S4','4.0', 26,90,5,0,1],  ['S4','4.0', 91,150,8,1,2],  ['S4','4.0', 151,500,13,1,2],  ['S4','4.0', 501,1200,20,2,3],  ['S4','4.0', 1201,10000,32,3,4],  ['S4','4.0', 10001,35000,50,5,6],  ['S4','4.0', 35001,null,80,7,8],
      ['S4','6.5', 2,15,2,0,1],  ['S4','6.5', 16,25,3,0,1],  ['S4','6.5', 26,90,5,1,2],  ['S4','6.5', 91,150,8,1,2],  ['S4','6.5', 151,500,13,2,3],  ['S4','6.5', 501,1200,20,3,4],  ['S4','6.5', 1201,10000,32,5,6],  ['S4','6.5', 10001,35000,50,7,8],  ['S4','6.5', 35001,null,80,7,8],
    ];
    db.transaction(() => { for (const r of specialRows) insAQL2.run(...r); })();
    console.log('[DB] Seeded AQL special inspection levels S1-S4 (ISO 2859-1 Table I)');
  }

  // AQL 0.65 and 1.0 for GEN levels (not in initial seed)
  const aql065Exists = db.prepare("SELECT 1 FROM aql_tables WHERE aql_value='0.65' AND inspection_level='GEN_II' LIMIT 1").get();
  if (!aql065Exists) {
    const insAQL3 = db.prepare(
      'INSERT INTO aql_tables (inspection_level, aql_value, batch_from, batch_to, sample_size, accept_number, reject_number) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    // GEN_I sample sizes: 2-90→5, 91-150→8, 151-280→13, 281-500→20, 501-1200→32, 1201-3200→50, 3201-10000→80, 10001+→125
    // GEN_II sample sizes: 2-8→2(or use 13 resolved), 9-15→3, 16-25→5, 26-50→8, 51-90→13, 91-150→20, ...
    // For AQL 0.65/1.0 with small n (↑ arrows), use n of code E(13) as minimum effective sample
    const genAqlRows = [
      // GEN_I + AQL 0.65 (n from GEN_I table, conservative for small lots)
      ['GEN_I','0.65',2,90,5,0,1],
      ['GEN_I','0.65',91,150,8,0,1],
      ['GEN_I','0.65',151,280,13,0,1],
      ['GEN_I','0.65',281,500,20,0,1],
      ['GEN_I','0.65',501,1200,32,1,2],
      ['GEN_I','0.65',1201,3200,50,1,2],
      ['GEN_I','0.65',3201,10000,80,2,3],
      ['GEN_I','0.65',10001,null,125,3,4],

      // GEN_I + AQL 1.0
      ['GEN_I','1.0',2,90,5,0,1],
      ['GEN_I','1.0',91,150,8,0,1],
      ['GEN_I','1.0',151,280,13,0,1],
      ['GEN_I','1.0',281,500,20,0,1],
      ['GEN_I','1.0',501,1200,32,1,2],
      ['GEN_I','1.0',1201,3200,50,2,3],
      ['GEN_I','1.0',3201,10000,80,3,4],
      ['GEN_I','1.0',10001,null,125,5,6],

      // GEN_II + AQL 0.65 (code E n=13 is minimum effective for AQL 0.65)
      ['GEN_II','0.65',2,8,13,0,1],
      ['GEN_II','0.65',9,15,13,0,1],
      ['GEN_II','0.65',16,25,13,0,1],
      ['GEN_II','0.65',26,50,13,0,1],
      ['GEN_II','0.65',51,90,13,0,1],
      ['GEN_II','0.65',91,150,20,0,1],
      ['GEN_II','0.65',151,280,32,1,2],
      ['GEN_II','0.65',281,500,50,1,2],
      ['GEN_II','0.65',501,1200,80,2,3],
      ['GEN_II','0.65',1201,3200,125,3,4],
      ['GEN_II','0.65',3201,10000,200,5,6],
      ['GEN_II','0.65',10001,null,315,7,8],

      // GEN_II + AQL 1.0 (code D n=8 is minimum effective for AQL 1.0)
      ['GEN_II','1.0',2,8,8,0,1],
      ['GEN_II','1.0',9,15,8,0,1],
      ['GEN_II','1.0',16,25,8,0,1],
      ['GEN_II','1.0',26,50,8,0,1],
      ['GEN_II','1.0',51,90,13,0,1],
      ['GEN_II','1.0',91,150,20,0,1],
      ['GEN_II','1.0',151,280,32,1,2],
      ['GEN_II','1.0',281,500,50,1,2],
      ['GEN_II','1.0',501,1200,80,2,3],
      ['GEN_II','1.0',1201,3200,125,5,6],
      ['GEN_II','1.0',3201,10000,200,7,8],
      ['GEN_II','1.0',10001,null,315,10,11],

      // GEN_III + AQL 0.65
      ['GEN_III','0.65',2,8,13,0,1],
      ['GEN_III','0.65',9,15,13,0,1],
      ['GEN_III','0.65',16,25,20,0,1],
      ['GEN_III','0.65',26,50,32,1,2],
      ['GEN_III','0.65',51,90,50,1,2],
      ['GEN_III','0.65',91,150,80,2,3],
      ['GEN_III','0.65',151,280,125,3,4],
      ['GEN_III','0.65',281,500,200,5,6],
      ['GEN_III','0.65',501,1200,315,7,8],
      ['GEN_III','0.65',1201,3200,500,14,15],
      ['GEN_III','0.65',3201,10000,800,21,22],
      ['GEN_III','0.65',10001,null,1250,21,22],

      // GEN_III + AQL 1.0
      ['GEN_III','1.0',2,8,8,0,1],
      ['GEN_III','1.0',9,15,13,0,1],
      ['GEN_III','1.0',16,25,20,0,1],
      ['GEN_III','1.0',26,50,32,1,2],
      ['GEN_III','1.0',51,90,50,2,3],
      ['GEN_III','1.0',91,150,80,3,4],
      ['GEN_III','1.0',151,280,125,5,6],
      ['GEN_III','1.0',281,500,200,7,8],
      ['GEN_III','1.0',501,1200,315,10,11],
      ['GEN_III','1.0',1201,3200,500,14,15],
      ['GEN_III','1.0',3201,10000,800,21,22],
      ['GEN_III','1.0',10001,null,1250,21,22],
    ];
    db.transaction(() => { for (const r of genAqlRows) insAQL3.run(...r); })();
    console.log('[DB] Seeded AQL 0.65 and 1.0 for GEN levels');
  }

  // FG FM Categories (5M+E — สำหรับ FG Production, แยกจาก fm_categories ของ IPQC/FQC)
  const fgFmCount = db.prepare("SELECT COUNT(*) as c FROM fg_fm_categories").get();
  if (fgFmCount.c === 0) {
    const insFgFm = db.prepare('INSERT INTO fg_fm_categories (code, name, is_material, sort_order) VALUES (?,?,?,?)');
    const fgFmCats = [
      ['MATERIAL', 'Material', 1, 1],
      ['MACHINE',  'Machine',  0, 2],
      ['METHOD',   'Method',   0, 3],
      ['MAN',      'Man',      0, 4],
      ['MEASURE',  'Measure',  0, 5],
      ['ENV',      'Environment', 0, 6],
    ];
    db.transaction(() => { for (const [c, n, m, o] of fgFmCats) insFgFm.run(c, n, m, o); })();
    console.log('[DB] Seeded FG FM categories');
  }

  // FG Defect + FNCP + FUAI sequences
  for (const dt of ['FNCP', 'FDR', 'FUAI']) {
    const seq = db.prepare('SELECT 1 FROM document_sequences WHERE doc_type = ?').get(dt);
    if (!seq) {
      db.prepare('INSERT INTO document_sequences (doc_type, year, last_seq) VALUES (?, ?, 0)').run(dt, new Date().getFullYear());
    }
  }

  // FG Defect Groups — กลุ่มอาการเสีย FG
  const fgDgCount = db.prepare("SELECT COUNT(*) as c FROM fg_defect_groups").get();
  if (fgDgCount.c === 0) {
    const insDg = db.prepare('INSERT INTO fg_defect_groups (code, name, sort_order) VALUES (?, ?, ?)');
    const groups = [
      ['DSIZE',    'ด้านขนาด',   1],
      ['DCOLOR',   'ด้านสี',      2],
      ['DSURFACE', 'ด้านผิว',     3],
      ['DASM',     'ด้านประกอบ',  4],
      ['DGLASS',   'ด้านกระจก',  5],
      ['DPACK',    'ด้านแพ็ค',    6],
      ['DOTHER',   'อื่นๆ',        7],
    ];
    db.transaction(() => { for (const [c, n, o] of groups) insDg.run(c, n, o); })();
    console.log('[DB] Seeded FG defect groups');

    // FG Defect Types — อาการเสียรายการ
    const grpMap = {};
    for (const [c] of groups) {
      const r = db.prepare('SELECT id FROM fg_defect_groups WHERE code=?').get(c);
      if (r) grpMap[c] = r.id;
    }
    const insDt = db.prepare('INSERT INTO fg_defect_types (defect_group_id, code, name, severity_default, sort_order) VALUES (?, ?, ?, ?, ?)');
    const types = [
      [grpMap['DSIZE'],    'DSZ001', 'ขนาดผิด',           'major',    1],
      [grpMap['DSIZE'],    'DSZ002', 'ความยาวผิด',         'major',    2],
      [grpMap['DSIZE'],    'DSZ003', 'มุมไม่ฉาก',          'minor',    3],
      [grpMap['DSIZE'],    'DSZ004', 'ขยักไม่ตรง',         'minor',    4],
      [grpMap['DCOLOR'],   'DCL001', 'สีไม่สม่ำเสมอ',     'major',    1],
      [grpMap['DCOLOR'],   'DCL002', 'สีไม่ถูกต้อง',      'major',    2],
      [grpMap['DCOLOR'],   'DCL003', 'สีลอก/ล่อน',        'critical', 3],
      [grpMap['DSURFACE'], 'DSF001', 'รอยขีดข่วน',        'minor',    1],
      [grpMap['DSURFACE'], 'DSF002', 'รอยบุ๋ม',           'minor',    2],
      [grpMap['DSURFACE'], 'DSF003', 'รอยขนแมว',          'minor',    3],
      [grpMap['DSURFACE'], 'DSF004', 'ผิวหยาบ/ไม่เรียบ', 'minor',    4],
      [grpMap['DASM'],     'DAS001', 'ประกอบผิด',          'major',    1],
      [grpMap['DASM'],     'DAS002', 'ฝ้าไม่เท่ากัน',     'minor',    2],
      [grpMap['DASM'],     'DAS003', 'เหล็กดัดไม่เข้า',   'major',    3],
      [grpMap['DASM'],     'DAS004', 'น็อตหลวม/หัก',      'major',    4],
      [grpMap['DASM'],     'DAS005', 'เทสไม่ผ่าน',         'critical', 5],
      [grpMap['DGLASS'],   'DGL001', 'กระจกโยก',           'minor',    1],
      [grpMap['DGLASS'],   'DGL002', 'ซีลไม่แน่น',         'major',    2],
      [grpMap['DGLASS'],   'DGL003', 'กระจกแตก',           'critical', 3],
      [grpMap['DGLASS'],   'DGL004', 'กระจกเปื้อน',        'minor',    4],
      [grpMap['DPACK'],    'DPK001', 'แพ็คผิด/ไม่ครบ',    'major',    1],
      [grpMap['DPACK'],    'DPK002', 'ฉลากผิด',            'major',    2],
      [grpMap['DPACK'],    'DPK003', 'กล่องเสียหาย',       'minor',    3],
      [grpMap['DOTHER'],   'DOT001', 'ปัญหาอื่นๆ',         'minor',    1],
    ];
    db.transaction(() => { for (const [g, c, n, s, o] of types) insDt.run(g, c, n, s, o); })();
    console.log('[DB] Seeded FG defect types');
  }

  // FG Process Areas — ส่วนงานที่พบของเสีย
  const fgPaCount = db.prepare("SELECT COUNT(*) as c FROM fg_process_areas").get();
  if (fgPaCount.c === 0) {
    const insPa = db.prepare('INSERT INTO fg_process_areas (code, name, sort_order) VALUES (?, ?, ?)');
    const areas = [
      ['CUT',  'ส่วนงานตัด',             1],
      ['DRILL','ส่วนงานเจาะ',            2],
      ['DOOR', 'ส่วนงานประกอบบาน',      3],
      ['SCREEN','ส่วนงานประกอบมุ้ง',    4],
      ['FRAME','ส่วนงานประกอบเฟรม',     5],
      ['GLASS','ส่วนงานใส่กระจก',       6],
      ['SEAL', 'ส่วนงานซีล',             7],
      ['PACK', 'ส่วนงานแพ็ค',            8],
      ['TEST', 'ส่วนงานเทสบาน',         9],
      ['OTHER','อื่นๆ',                  10],
    ];
    db.transaction(() => { for (const [c, n, o] of areas) insPa.run(c, n, o); })();
    console.log('[DB] Seeded FG process areas');
  }

  // default users
  const adminExists = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
  if (!adminExists) {
    const hash = bcrypt.hashSync('admin1234', 12);
    const roles = [
      ['admin', 'admin', 'ผู้ดูแลระบบ'],
      ['qc_staff1', 'qc_staff', 'สมชาย QC'],
      ['supervisor1', 'qc_supervisor', 'วิไล หัวหน้า QC'],
      ['manager1', 'qc_manager', 'ประยุทธ ผู้จัดการ QC'],
      ['qmr1', 'qmr', 'สุรชัย QMR'],
      ['purchasing1', 'purchasing', 'นภา จัดซื้อ'],
      ['cco1', 'cco', 'วิชัย COO'],
      ['cmo1', 'cmo', 'สมหญิง CMO'],
      ['cpo1', 'cpo', 'ประเสริฐ CPO'],
      ['production1', 'production_manager', 'สมศักดิ์ ผจก.ผลิต'],
      ['prod_sup1', 'prod_supervisor', 'สมปอง หัวหน้าผลิต'],
    ];
    const ins = db.prepare('INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)');
    for (const [username, role, full_name] of roles) {
      ins.run(username, hash, full_name, role);
    }
    // ไม่พิมพ์รหัสผ่านจริงใน production (DEVMORE C2)
    if (process.env.NODE_ENV === 'production') {
      console.warn('[DB] Seeded default users — ⚠️ เปลี่ยนรหัสผ่าน admin ทันทีก่อนใช้งานจริง');
    } else {
      console.log('[DB] Seeded default users (default password: admin1234 — เปลี่ยนทันทีหลัง login)');
    }
  }
}

// ===== ATOMIC SEQUENCE GENERATION (race-condition safe) — แยกไป db/sequences.js (CLAUDE.md §8) =====
require('./sequences')(db);

// fg_fncp: production response token + respondent (migration ถ้ายังไม่มี)
safeAddColumn('fg_fncp', 'prod_token',            'TEXT');
safeAddColumn('fg_fncp', 'prod_token_expires_at', 'TEXT');
safeAddColumn('fg_fncp', 'respondent_name',       'TEXT');

// pro_code_sap: derived description จาก confirmed field values (ใช้สำหรับ Tier-0 matching)
safeAddColumn('pro_code_sap', 'derived_desc', 'TEXT');

// ===== MIGRATE fg_fncp — ADD supervisor_approved + fuai_opened STATUS =====
function migrateFncpStatusConstraint() {
  const info = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='fg_fncp'").get();
  if (!info || info.sql.includes('supervisor_approved')) return; // already migrated

  console.log('[Migration] Adding supervisor_approved/fuai_opened status to fg_fncp...');

  const oldColSet = new Set(db.prepare('PRAGMA table_info(fg_fncp)').all().map(c => c.name));
  const newColList = [
    'id','fncp_no','defect_record_id','doc_no','pro_code_sap_id','production_line_id',
    'defect_group_id','defect_type_id','defect_qty','defect_unit','severity',
    'department_responsible','root_cause','correction','corrective_action','preventive_action',
    'pic_user_id','due_date','verification_result','close_date','reject_reason','status',
    'opened_by','opened_at','in_progress_by','in_progress_at',
    'submit_verify_by','submit_verify_at',
    'verified_by','verified_at',
    'rejected_by','rejected_at',
    'closed_by','closed_at',
    'prod_token','prod_token_expires_at','respondent_name',
    'fm_category_id','supervisor_approved_by','supervisor_approved_at',
    'manager_approved_by','manager_approved_at',
    'created_by','created_at',
  ];
  const shared = newColList.filter(c => oldColSet.has(c)).join(',');
  if (!shared) { console.error('[Migration] migrateFncpStatusConstraint: No shared columns — aborting'); return; }

  db.pragma('foreign_keys = OFF');
  db.pragma('legacy_alter_table = ON');
  try {
    db.transaction(() => {
      db.prepare('ALTER TABLE fg_fncp RENAME TO fg_fncp_old').run();
      db.prepare(`
        CREATE TABLE fg_fncp (
          id                  INTEGER PRIMARY KEY AUTOINCREMENT,
          fncp_no             TEXT NOT NULL UNIQUE,
          defect_record_id    INTEGER REFERENCES fg_defect_records(id) ON DELETE RESTRICT,
          doc_no              TEXT,
          pro_code_sap_id     INTEGER REFERENCES pro_code_sap(id) ON DELETE RESTRICT,
          production_line_id  INTEGER REFERENCES production_lines(id) ON DELETE RESTRICT,
          defect_group_id     INTEGER REFERENCES fg_defect_groups(id) ON DELETE SET NULL,
          defect_type_id      INTEGER REFERENCES fg_defect_types(id) ON DELETE SET NULL,
          defect_qty          INTEGER DEFAULT 0,
          defect_unit         TEXT DEFAULT 'pcs',
          severity            TEXT DEFAULT 'minor',
          fm_category_id      INTEGER REFERENCES fg_fm_categories(id) ON DELETE SET NULL,
          department_responsible TEXT,
          root_cause          TEXT,
          correction          TEXT,
          corrective_action   TEXT,
          preventive_action   TEXT,
          pic_user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
          due_date            DATE,
          verification_result TEXT,
          close_date          DATE,
          reject_reason       TEXT,
          status              TEXT NOT NULL DEFAULT 'open'
            CHECK(status IN ('open','in_progress','waiting_verify',
                             'supervisor_approved','verified','closed','reject','fuai_opened')),
          opened_by           INTEGER REFERENCES users(id),
          opened_at           TEXT DEFAULT (datetime('now')),
          in_progress_by      INTEGER REFERENCES users(id),
          in_progress_at      TEXT,
          submit_verify_by    INTEGER REFERENCES users(id),
          submit_verify_at    TEXT,
          supervisor_approved_by INTEGER REFERENCES users(id),
          supervisor_approved_at TEXT,
          verified_by         INTEGER REFERENCES users(id),
          verified_at         TEXT,
          manager_approved_by INTEGER REFERENCES users(id),
          manager_approved_at TEXT,
          rejected_by         INTEGER REFERENCES users(id),
          rejected_at         TEXT,
          closed_by           INTEGER REFERENCES users(id),
          closed_at           TEXT,
          prod_token          TEXT,
          prod_token_expires_at TEXT,
          respondent_name     TEXT,
          created_by          INTEGER REFERENCES users(id),
          created_at          TEXT DEFAULT (datetime('now'))
        )
      `).run();
      db.prepare(`INSERT INTO fg_fncp (${shared}) SELECT ${shared} FROM fg_fncp_old`).run();
      db.prepare('DROP TABLE fg_fncp_old').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_fg_fncp_docno   ON fg_fncp(doc_no)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_fg_fncp_status  ON fg_fncp(status)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_fg_fncp_line    ON fg_fncp(production_line_id)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_fg_fncp_due     ON fg_fncp(due_date)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_fg_fncp_defect  ON fg_fncp(defect_record_id)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_fg_fncp_token   ON fg_fncp(prod_token)').run();
    })();
    console.log('[Migration] fg_fncp: supervisor_approved + fuai_opened status added');
  } catch (e) {
    console.error('[Migration] migrateFncpStatusConstraint failed:', e.message);
    try {
      const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='fg_fncp'").get();
      if (!exists) db.prepare('ALTER TABLE fg_fncp_old RENAME TO fg_fncp').run();
    } catch {}
    throw e;
  } finally {
    db.pragma('legacy_alter_table = OFF');
    db.pragma('foreign_keys = ON');
  }
}
migrateFncpStatusConstraint();

// ===== AUDIT LOG / SETTINGS / SECURE TOKEN — แยกไป db/audit.js (CLAUDE.md §8/§14) =====
require('./audit')(db);

// ===== MIGRATE NCR STATUS CHECK CONSTRAINT =====
function migrateNcrStatusConstraint() {
  const info = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ncrs'").get();
  if (!info || info.sql.includes('pending_purchasing_review')) return; // already up-to-date

  console.log('[Migration] Updating ncrs.status CHECK constraint...');

  // Query column names BEFORE the transaction — PRAGMA table_info may not see renamed tables
  // inside the same transaction in some SQLite/better-sqlite3 versions
  const oldColSet = new Set(db.prepare('PRAGMA table_info(ncrs)').all().map(c => c.name));

  // All columns in the new ncrs table — intersection with oldColSet determines what to copy
  const newColList = [
    'id','ncr_code','bill_id','po_no','invoice_no','severity','status',
    'cancelled_at','cancelled_by','supplier_token','token_expires_at',
    'disposition','disposition_note','disposition_due_date','disposition_completed_at','disposition_by',
    'effectiveness_check_date','effectiveness_result','effectiveness_note',
    'effectiveness_checked_by','effectiveness_checked_at',
    'created_by','created_at',
  ];
  const shared = newColList.filter(c => oldColSet.has(c)).join(',');

  if (!shared) {
    console.error('[Migration] No shared columns detected — aborting to avoid data loss');
    return;
  }

  db.pragma('foreign_keys = OFF');
  db.pragma('legacy_alter_table = ON'); // prevent SQLite ≥3.26 from auto-updating FK refs in child tables
  try {
    db.transaction(() => {
      db.prepare('ALTER TABLE ncrs RENAME TO ncrs_old').run();

      db.prepare(`
        CREATE TABLE ncrs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ncr_code TEXT UNIQUE NOT NULL,
          bill_id INTEGER REFERENCES bills(id) ON DELETE RESTRICT,
          po_no TEXT NOT NULL,
          invoice_no TEXT NOT NULL,
          severity TEXT CHECK(severity IN ('major','minor')),
          status TEXT DEFAULT 'pending_supervisor' CHECK(status IN (
            'pending_supervisor','pending_manager','pending_qmr_open',
            'pending_purchasing_review','pending_supplier','pending_manager_review','pending_qmr_close',
            'closed','uai_pending_qc_manager','cancelled'
          )),
          cancelled_at DATETIME,
          cancelled_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
          supplier_token TEXT UNIQUE NOT NULL,
          token_expires_at DATETIME,
          disposition TEXT CHECK(disposition IN ('return','rework','uai','scrap','re_inspect')),
          disposition_note TEXT,
          disposition_due_date DATE,
          disposition_completed_at DATETIME,
          disposition_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
          effectiveness_check_date DATE,
          effectiveness_result TEXT CHECK(effectiveness_result IN ('effective','not_effective')),
          effectiveness_note TEXT,
          effectiveness_checked_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
          effectiveness_checked_at DATETIME,
          created_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `).run();

      // Use pre-fetched column list — no PRAGMA inside transaction
      db.prepare(`INSERT INTO ncrs (${shared}) SELECT ${shared} FROM ncrs_old`).run();

      db.prepare('DROP TABLE ncrs_old').run();

      db.prepare('CREATE INDEX IF NOT EXISTS idx_ncrs_status ON ncrs(status)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_ncrs_bill ON ncrs(bill_id)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_ncrs_token ON ncrs(supplier_token)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_ncrs_created_at ON ncrs(created_at)').run();
    })();

    console.log('[Migration] ncrs.status constraint updated — pending_purchasing_review added');
  } catch (e) {
    console.error('[Migration] Failed:', e.message);
    try {
      const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ncrs'").get();
      if (!exists) db.prepare('ALTER TABLE ncrs_old RENAME TO ncrs').run();
    } catch {}
    throw e;
  } finally {
    db.pragma('legacy_alter_table = OFF');
    db.pragma('foreign_keys = ON');
  }
}

// ===== MIGRATE USERS — add 'prod_supervisor' to role CHECK constraint =====
// role prod_supervisor ถูก seed (prod_sup1) + ใช้จริงใน routes/ipqcInspection & routes/ipncr + frontend
// แต่ CHECK เดิมมีแค่ 10 roles → DB เก่าสร้าง user role นี้ไม่ได้ (ติด CHECK). SQLite เปลี่ยน CHECK ตรง ๆ ไม่ได้
// จึงต้อง recreate ตาราง (ตาม pattern migrateNcrStatusConstraint) — idempotent, gate ด้วย includes('prod_supervisor')
function migrateUsersRoleConstraint() {
  const info = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
  if (!info || info.sql.includes('purchasing_manager')) return; // already up-to-date

  console.log('[Migration] Updating users.role CHECK constraint (add purchasing_manager)...');

  // Query columns BEFORE the transaction (PRAGMA ภายใน transaction อาจไม่เห็นตารางที่ rename)
  const oldColSet = new Set(db.prepare('PRAGMA table_info(users)').all().map(c => c.name));
  const newColList = [
    'id','username','password_hash','full_name','role','is_active','created_at',
    'session_token','qc_station','telegram_chat_id','factory_assignment',
  ];
  const shared = newColList.filter(c => oldColSet.has(c)).join(',');
  if (!shared) { console.error('[Migration] users: no shared columns — aborting to avoid data loss'); return; }

  db.pragma('foreign_keys = OFF');
  db.pragma('legacy_alter_table = ON'); // กัน SQLite ≥3.26 auto-update FK refs ใน child tables
  try {
    db.transaction(() => {
      db.prepare('ALTER TABLE users RENAME TO users_old').run();
      db.prepare(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          full_name TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN (
            'admin','qc_staff','qc_supervisor','qc_manager',
            'qmr','purchasing','purchasing_manager','cco','cmo','cpo','production_manager','prod_supervisor'
          )),
          is_active INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          session_token TEXT,
          qc_station TEXT,
          telegram_chat_id TEXT,
          factory_assignment TEXT
        )
      `).run();
      db.prepare(`INSERT INTO users (${shared}) SELECT ${shared} FROM users_old`).run();
      db.prepare('DROP TABLE users_old').run();
    })();
    console.log('[Migration] users.role constraint updated — purchasing_manager added');
  } catch (e) {
    console.error('[Migration] users role migration failed:', e.message);
    try {
      const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
      if (!exists) db.prepare('ALTER TABLE users_old RENAME TO users').run();
    } catch {}
    throw e;
  } finally {
    db.pragma('legacy_alter_table = OFF');
    db.pragma('foreign_keys = ON');
  }
}

// เพิ่ม role คลัง (warehouse_supervisor/warehouse_manager) — รับหน้าที่กด "รับทราบ" แผนรับเข้าแทน
// qc_staff/qc_supervisor เดิม (ตามคำขอ user) — pattern เดียวกับ migrateUsersRoleConstraint() ด้านบนเป๊ะ
// (rebuild ตาราง + shared column intersection กัน DB เก่าข้าม generation)
function migrateUsersRoleConstraintWarehouse() {
  const info = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
  if (!info || info.sql.includes('warehouse_manager')) return; // already up-to-date

  console.log('[Migration] Updating users.role CHECK constraint (add warehouse_supervisor/warehouse_manager)...');

  const oldColSet = new Set(db.prepare('PRAGMA table_info(users)').all().map(c => c.name));
  const newColList = [
    'id','username','password_hash','full_name','role','is_active','created_at',
    'session_token','qc_station','telegram_chat_id','factory_assignment',
  ];
  const shared = newColList.filter(c => oldColSet.has(c)).join(',');
  if (!shared) { console.error('[Migration] users: no shared columns — aborting to avoid data loss'); return; }

  db.pragma('foreign_keys = OFF');
  db.pragma('legacy_alter_table = ON');
  try {
    db.transaction(() => {
      db.prepare('ALTER TABLE users RENAME TO users_old').run();
      db.prepare(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          full_name TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN (
            'admin','qc_staff','qc_supervisor','qc_manager',
            'qmr','purchasing','purchasing_manager','cco','cmo','cpo','production_manager','prod_supervisor',
            'warehouse_supervisor','warehouse_manager'
          )),
          is_active INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          session_token TEXT,
          qc_station TEXT,
          telegram_chat_id TEXT,
          factory_assignment TEXT
        )
      `).run();
      db.prepare(`INSERT INTO users (${shared}) SELECT ${shared} FROM users_old`).run();
      db.prepare('DROP TABLE users_old').run();
    })();
    console.log('[Migration] users.role constraint updated — warehouse_supervisor/warehouse_manager added');
  } catch (e) {
    console.error('[Migration] users role migration failed:', e.message);
    try {
      const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
      if (!exists) db.prepare('ALTER TABLE users_old RENAME TO users').run();
    } catch {}
    throw e;
  } finally {
    db.pragma('legacy_alter_table = OFF');
    db.pragma('foreign_keys = ON');
  }
}

// ===== SYNC SEQUENCES — ensure sequence counters never collide with existing codes =====
// Format: NCR-2026-0001 and UAI-2026-0001 → sequence starts at position 10
function syncSequences() {
  const year = new Date().getFullYear();

  const lastNCR = db.prepare(
    `SELECT MAX(CAST(SUBSTR(ncr_code, 10) AS INTEGER)) as last FROM ncrs WHERE ncr_code LIKE ?`
  ).get(`NCR-${year}-%`);
  if (lastNCR?.last) {
    db.prepare(
      `UPDATE document_sequences SET last_seq = MAX(last_seq, ?) WHERE doc_type = 'NCR' AND year = ?`
    ).run(lastNCR.last, year);
  }

  const lastUAI = db.prepare(
    `SELECT MAX(CAST(SUBSTR(uai_code, 10) AS INTEGER)) as last FROM uai_documents WHERE uai_code LIKE ?`
  ).get(`UAI-${year}-%`);
  if (lastUAI?.last) {
    db.prepare(
      `UPDATE document_sequences SET last_seq = MAX(last_seq, ?) WHERE doc_type = 'UAI' AND year = ?`
    ).run(lastUAI.last, year);
  }

  const lastNCP = db.prepare(
    `SELECT MAX(CAST(SUBSTR(ncr_code, 10) AS INTEGER)) as last FROM ncrs WHERE ncr_code LIKE ?`
  ).get(`NCP-${year}-%`);
  if (lastNCP?.last) {
    db.prepare(
      `UPDATE document_sequences SET last_seq = MAX(last_seq, ?) WHERE doc_type = 'NCP' AND year = ?`
    ).run(lastNCP.last, year);
  }

  // production_line_seq: sync ค่าล่าสุดจาก code ที่มีอยู่แล้ว (รูปแบบ "{factory}-{LINE_TYPE}-{seq}")
  // กันชนกันตอน genLineCode() รันครั้งถัดไป — parse จาก code จริง ไม่ใช้ SELECT MAX() ตอน generate (กฎ 2.3)
  const lines = db.prepare('SELECT code, factory, line_type FROM production_lines').all();
  const maxByKey = new Map(); // key: JSON.stringify([factory, line_type])
  for (const l of lines) {
    if (!l.factory || !l.line_type) continue;
    const escFactory = l.factory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^${escFactory}-${l.line_type.toUpperCase()}-(\\d+)$`);
    const m = l.code.match(re);
    if (!m) continue;
    const key = JSON.stringify([l.factory, l.line_type]);
    const num = parseInt(m[1], 10);
    if (!maxByKey.has(key) || num > maxByKey.get(key)) maxByKey.set(key, num);
  }
  const upsertSeq = db.prepare(`
    INSERT INTO production_line_seq (factory, line_type, last_seq) VALUES (?, ?, ?)
    ON CONFLICT(factory, line_type) DO UPDATE SET last_seq = MAX(last_seq, excluded.last_seq)
  `);
  for (const [key, num] of maxByKey) {
    const [factory, lineType] = JSON.parse(key);
    upsertSeq.run(factory, lineType, num);
  }
}

// ===== MIGRATE NCR — ADD ncp_closed STATUS + MAKE supplier_token NULLABLE =====
function migrateNcrAddNcp() {
  const info = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ncrs'").get();
  if (!info) return;
  // Already migrated if ncp_closed is in CHECK and supplier_token allows NULL
  if (info.sql.includes('ncp_closed')) return;

  console.log('[Migration] Adding ncp_closed status + nullable supplier_token to ncrs...');

  const oldColSet = new Set(db.prepare('PRAGMA table_info(ncrs)').all().map(c => c.name));
  const newColList = [
    'id','ncr_code','bill_id','po_no','invoice_no','severity','status',
    'cancelled_at','cancelled_by','supplier_token','token_expires_at',
    'disposition','disposition_note','disposition_due_date','disposition_completed_at','disposition_by',
    'effectiveness_check_date','effectiveness_result','effectiveness_note',
    'effectiveness_checked_by','effectiveness_checked_at',
    'created_by','created_at',
  ];
  const shared = newColList.filter(c => oldColSet.has(c)).join(',');

  db.pragma('foreign_keys = OFF');
  db.pragma('legacy_alter_table = ON');
  try {
    db.transaction(() => {
      db.prepare('ALTER TABLE ncrs RENAME TO ncrs_old').run();
      db.prepare(`
        CREATE TABLE ncrs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ncr_code TEXT UNIQUE NOT NULL,
          bill_id INTEGER REFERENCES bills(id) ON DELETE RESTRICT,
          po_no TEXT NOT NULL,
          invoice_no TEXT NOT NULL,
          severity TEXT CHECK(severity IN ('major','minor')),
          status TEXT DEFAULT 'pending_supervisor' CHECK(status IN (
            'pending_supervisor','pending_manager','pending_qmr_open',
            'pending_purchasing_review','pending_supplier','pending_manager_review','pending_qmr_close',
            'closed','uai_pending_qc_manager','cancelled','ncp_closed'
          )),
          cancelled_at DATETIME,
          cancelled_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
          supplier_token TEXT UNIQUE,
          token_expires_at DATETIME,
          disposition TEXT CHECK(disposition IN ('return','rework','uai','scrap','re_inspect')),
          disposition_note TEXT,
          disposition_due_date DATE,
          disposition_completed_at DATETIME,
          disposition_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
          effectiveness_check_date DATE,
          effectiveness_result TEXT CHECK(effectiveness_result IN ('effective','not_effective')),
          effectiveness_note TEXT,
          effectiveness_checked_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
          effectiveness_checked_at DATETIME,
          created_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `).run();

      db.prepare(`INSERT INTO ncrs (${shared}) SELECT ${shared} FROM ncrs_old`).run();
      db.prepare('DROP TABLE ncrs_old').run();

      db.prepare('CREATE INDEX IF NOT EXISTS idx_ncrs_status ON ncrs(status)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_ncrs_bill ON ncrs(bill_id)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_ncrs_token ON ncrs(supplier_token)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_ncrs_created_at ON ncrs(created_at)').run();
    })();
    console.log('[Migration] ncrs: ncp_closed added, supplier_token now nullable');
  } catch (e) {
    console.error('[Migration] migrateNcrAddNcp failed:', e.message);
    try {
      const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ncrs'").get();
      if (!exists) db.prepare('ALTER TABLE ncrs_old RENAME TO ncrs').run();
    } catch {}
    throw e;
  } finally {
    db.pragma('legacy_alter_table = OFF');
    db.pragma('foreign_keys = ON');
  }
}

// ===== MIGRATE NCR — ADD pending_supplier_resubmit STATUS =====
function migrateNcrAddResubmit() {
  const info = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ncrs'").get();
  if (!info || info.sql.includes('pending_supplier_resubmit')) return;

  console.log('[Migration] Adding pending_supplier_resubmit status to ncrs...');

  const oldColSet = new Set(db.prepare('PRAGMA table_info(ncrs)').all().map(c => c.name));
  const newColList = [
    'id','ncr_code','bill_id','po_no','invoice_no','severity','status',
    'cancelled_at','cancelled_by','supplier_token','token_expires_at',
    'disposition','disposition_note','disposition_due_date','disposition_completed_at','disposition_by',
    'effectiveness_check_date','effectiveness_result','effectiveness_note',
    'effectiveness_checked_by','effectiveness_checked_at',
    'purchasing_received_at','purchasing_received_by',
    'link_copied_at','link_copied_by','link_copied_count',
    'closed_at','created_by','created_at',
  ];
  const shared = newColList.filter(c => oldColSet.has(c)).join(',');
  if (!shared) { console.error('[Migration] No shared columns — aborting'); return; }

  db.pragma('foreign_keys = OFF');
  db.pragma('legacy_alter_table = ON');
  try {
    db.transaction(() => {
      db.prepare('ALTER TABLE ncrs RENAME TO ncrs_old').run();
      db.prepare(`
        CREATE TABLE ncrs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ncr_code TEXT UNIQUE NOT NULL,
          bill_id INTEGER REFERENCES bills(id) ON DELETE RESTRICT,
          po_no TEXT NOT NULL,
          invoice_no TEXT NOT NULL,
          severity TEXT CHECK(severity IN ('major','minor')),
          status TEXT DEFAULT 'pending_supervisor' CHECK(status IN (
            'pending_supervisor','pending_manager','pending_qmr_open',
            'pending_purchasing_review','pending_supplier','pending_manager_review','pending_qmr_close',
            'pending_supplier_resubmit',
            'closed','uai_pending_qc_manager','cancelled','ncp_closed'
          )),
          cancelled_at DATETIME,
          cancelled_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
          supplier_token TEXT UNIQUE,
          token_expires_at DATETIME,
          disposition TEXT CHECK(disposition IN ('return','rework','uai','scrap','re_inspect')),
          disposition_note TEXT,
          disposition_due_date DATE,
          disposition_completed_at DATETIME,
          disposition_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
          effectiveness_check_date DATE,
          effectiveness_result TEXT CHECK(effectiveness_result IN ('effective','not_effective')),
          effectiveness_note TEXT,
          effectiveness_checked_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
          effectiveness_checked_at DATETIME,
          purchasing_received_at DATETIME,
          purchasing_received_by INTEGER REFERENCES users(id),
          link_copied_at DATETIME,
          link_copied_by INTEGER REFERENCES users(id),
          link_copied_count INTEGER DEFAULT 0,
          closed_at DATETIME,
          created_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `).run();
      db.prepare(`INSERT INTO ncrs (${shared}) SELECT ${shared} FROM ncrs_old`).run();
      db.prepare('DROP TABLE ncrs_old').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_ncrs_status ON ncrs(status)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_ncrs_bill ON ncrs(bill_id)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_ncrs_token ON ncrs(supplier_token)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_ncrs_created_at ON ncrs(created_at)').run();
    })();
    console.log('[Migration] ncrs: pending_supplier_resubmit status added');
  } catch (e) {
    console.error('[Migration] migrateNcrAddResubmit failed:', e.message);
    try {
      const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ncrs'").get();
      if (!exists) db.prepare('ALTER TABLE ncrs_old RENAME TO ncrs').run();
    } catch {}
    throw e;
  } finally {
    db.pragma('legacy_alter_table = OFF');
    db.pragma('foreign_keys = ON');
  }
}

// ===== MIGRATE NCR — ADD pending_uai STATUS =====
function migrateNcrAddPendingUai() {
  const info = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ncrs'").get();
  if (!info || info.sql.includes("'pending_uai'")) return;

  console.log('[Migration] Adding pending_uai status to ncrs...');

  const oldColSet = new Set(db.prepare('PRAGMA table_info(ncrs)').all().map(c => c.name));
  const newColList = [
    'id','ncr_code','bill_id','po_no','invoice_no','severity','status',
    'cancelled_at','cancelled_by','supplier_token','token_expires_at',
    'disposition','disposition_note','disposition_due_date','disposition_completed_at','disposition_by',
    'effectiveness_check_date','effectiveness_result','effectiveness_note',
    'effectiveness_checked_by','effectiveness_checked_at',
    'purchasing_received_at','purchasing_received_by',
    'link_copied_at','link_copied_by','link_copied_count',
    'closed_at','uai_close_remark','created_by','created_at',
  ];
  const shared = newColList.filter(c => oldColSet.has(c)).join(',');
  if (!shared) { console.error('[Migration] No shared columns — aborting'); return; }

  db.pragma('foreign_keys = OFF');
  db.pragma('legacy_alter_table = ON');
  try {
    db.transaction(() => {
      db.prepare('ALTER TABLE ncrs RENAME TO ncrs_old').run();
      db.prepare(`
        CREATE TABLE ncrs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ncr_code TEXT UNIQUE NOT NULL,
          bill_id INTEGER REFERENCES bills(id) ON DELETE RESTRICT,
          po_no TEXT NOT NULL,
          invoice_no TEXT NOT NULL,
          severity TEXT CHECK(severity IN ('major','minor')),
          status TEXT DEFAULT 'pending_supervisor' CHECK(status IN (
            'pending_supervisor','pending_manager','pending_qmr_open',
            'pending_purchasing_review','pending_supplier','pending_manager_review','pending_qmr_close',
            'pending_supplier_resubmit','pending_uai',
            'closed','uai_pending_qc_manager','cancelled','ncp_closed'
          )),
          cancelled_at DATETIME,
          cancelled_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
          supplier_token TEXT UNIQUE,
          token_expires_at DATETIME,
          disposition TEXT CHECK(disposition IN ('return','rework','uai','scrap','re_inspect')),
          disposition_note TEXT,
          disposition_due_date DATE,
          disposition_completed_at DATETIME,
          disposition_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
          effectiveness_check_date DATE,
          effectiveness_result TEXT CHECK(effectiveness_result IN ('effective','not_effective')),
          effectiveness_note TEXT,
          effectiveness_checked_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
          effectiveness_checked_at DATETIME,
          purchasing_received_at DATETIME,
          purchasing_received_by INTEGER REFERENCES users(id),
          link_copied_at DATETIME,
          link_copied_by INTEGER REFERENCES users(id),
          link_copied_count INTEGER DEFAULT 0,
          closed_at DATETIME,
          uai_close_remark TEXT,
          created_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `).run();
      db.prepare(`INSERT INTO ncrs (${shared}) SELECT ${shared} FROM ncrs_old`).run();
      db.prepare('DROP TABLE ncrs_old').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_ncrs_status ON ncrs(status)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_ncrs_bill ON ncrs(bill_id)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_ncrs_token ON ncrs(supplier_token)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_ncrs_created_at ON ncrs(created_at)').run();
    })();
    console.log('[Migration] ncrs: pending_uai status added');
  } catch (e) {
    console.error('[Migration] migrateNcrAddPendingUai failed:', e.message);
    try {
      const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ncrs'").get();
      if (!exists) db.prepare('ALTER TABLE ncrs_old RENAME TO ncrs').run();
    } catch {}
    throw e;
  } finally {
    db.pragma('legacy_alter_table = OFF');
    db.pragma('foreign_keys = ON');
  }
}

// ===== ROOT MIGRATION (DEVMORE H4) — ncrs.status เป็น TEXT (เลิก CHECK constraint) =====
// rebuild ครั้งสุดท้าย: หลังจากนี้เพิ่มสถานะใหม่ไม่ต้อง rebuild ตารางอีก
function rebuildNcrsStatusAsText() {
  if (!migrate.hasStatusCheck(db)) return; // ไม่มี CHECK แล้ว — no-op (fresh install)

  console.log('[Migration] เปลี่ยน ncrs.status เป็น TEXT (เลิก CHECK constraint)...');
  const oldColSet = new Set(db.prepare('PRAGMA table_info(ncrs)').all().map(c => c.name));
  const newColList = [
    'id','ncr_code','bill_id','po_no','invoice_no','severity','status',
    'cancelled_at','cancelled_by','supplier_token','token_expires_at',
    'disposition','disposition_note','disposition_due_date','disposition_completed_at','disposition_by',
    'effectiveness_check_date','effectiveness_result','effectiveness_note',
    'effectiveness_checked_by','effectiveness_checked_at',
    'purchasing_received_at','purchasing_received_by',
    'link_copied_at','link_copied_by','link_copied_count',
    'closed_at','uai_close_remark','created_by','created_at',
  ];
  const shared = newColList.filter(c => oldColSet.has(c)).join(',');
  if (!shared) { console.error('[Migration] No shared columns — aborting'); return; }

  db.pragma('foreign_keys = OFF');
  db.pragma('legacy_alter_table = ON');
  try {
    db.transaction(() => {
      db.prepare('ALTER TABLE ncrs RENAME TO ncrs_old').run();
      db.prepare(`
        CREATE TABLE ncrs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ncr_code TEXT UNIQUE NOT NULL,
          bill_id INTEGER REFERENCES bills(id) ON DELETE RESTRICT,
          po_no TEXT NOT NULL,
          invoice_no TEXT NOT NULL,
          severity TEXT CHECK(severity IN ('major','minor')),
          status TEXT NOT NULL DEFAULT 'pending_supervisor',
          cancelled_at DATETIME,
          cancelled_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
          supplier_token TEXT UNIQUE,
          token_expires_at DATETIME,
          disposition TEXT CHECK(disposition IN ('return','rework','uai','scrap','re_inspect')),
          disposition_note TEXT,
          disposition_due_date DATE,
          disposition_completed_at DATETIME,
          disposition_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
          effectiveness_check_date DATE,
          effectiveness_result TEXT CHECK(effectiveness_result IN ('effective','not_effective')),
          effectiveness_note TEXT,
          effectiveness_checked_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
          effectiveness_checked_at DATETIME,
          purchasing_received_at DATETIME,
          purchasing_received_by INTEGER REFERENCES users(id),
          link_copied_at DATETIME,
          link_copied_by INTEGER REFERENCES users(id),
          link_copied_count INTEGER DEFAULT 0,
          closed_at DATETIME,
          uai_close_remark TEXT,
          created_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `).run();
      db.prepare(`INSERT INTO ncrs (${shared}) SELECT ${shared} FROM ncrs_old`).run();
      db.prepare('DROP TABLE ncrs_old').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_ncrs_status ON ncrs(status)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_ncrs_bill ON ncrs(bill_id)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_ncrs_token ON ncrs(supplier_token)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_ncrs_created_at ON ncrs(created_at)').run();
    })();
    console.log('[Migration] ncrs.status → TEXT สำเร็จ — เพิ่มสถานะใหม่ไม่ต้อง rebuild อีก');
  } catch (e) {
    console.error('[Migration] rebuildNcrsStatusAsText failed:', e.message);
    try {
      const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ncrs'").get();
      if (!exists) db.prepare('ALTER TABLE ncrs_old RENAME TO ncrs').run();
    } catch {}
    throw e;
  } finally {
    db.pragma('legacy_alter_table = OFF');
    db.pragma('foreign_keys = ON');
  }
}

// app-layer validator (แทน DB CHECK)
db.VALID_NCR_STATUSES = VALID_NCR_STATUSES;
db.isValidNcrStatus = (s) => VALID_NCR_STATUSES.has(s);

// Run init
initSchema();
migrate.init(db);
runMigrations();

// Legacy ncrs rebuilds — รันเฉพาะ DB เก่าที่ยังมี CHECK บน status (gate ป้องกันรันซ้ำ)
if (migrate.hasStatusCheck(db)) {
  migrateNcrStatusConstraint();
  migrateNcrAddNcp();
  migrateNcrAddResubmit();
  migrateNcrAddPendingUai();
}

// Root migration ผ่าน framework — รันครั้งเดียว
migrate.apply(db, '003_ncrs_status_as_text', rebuildNcrsStatusAsText);

// Data-heal: NCP (minor) ที่ค้างสถานะ pending_manager จาก bug เดิม (supervisor สร้าง NCP เอง
// แล้วถูกส่งไป pending_manager ทั้งที่ NCP ไม่ผ่าน QC Manager) → ปิดให้เป็น ncp_closed
// วางหลัง NCR migrations ทั้งหมด (status เป็น TEXT แล้ว / CHECK รวม ncp_closed) — idempotent
try {
  const stuck = db.prepare(
    "UPDATE ncrs SET status='ncp_closed', closed_at=datetime('now') WHERE severity='minor' AND status='pending_manager'"
  ).run();
  if (stuck.changes > 0) console.log(`[Migration] Closed ${stuck.changes} stuck NCP(s) (minor stuck at pending_manager)`);
} catch (e) {
  console.error('[Migration] NCP heal failed:', e.message);
}

// Data-heal (S150): backfill qmr_opened_at ให้ NCR เก่าที่ผ่านขั้น QMR เปิดไปแล้วก่อน column นี้ถูกเพิ่ม —
// ไม่งั้น overdueNotifier.js จะไม่มีวันแจ้งเตือน "เกินกำหนด" ให้เอกสารเก่าเหล่านี้อีกเลย (qmr_opened_at ค้าง NULL
// ตลอดไป) ใช้เวลา approve แรกสุดของ role='qmr' ใน ncr_approvals (ขั้นเปิดมาก่อนขั้นปิดเสมอตาม state machine —
// ดู ncrService.js's transitions) fallback เป็น created_at ถ้าหาไม่เจอ (กันชนกว่าไม่มีค่าเลย) — exclude สถานะ
// ก่อนหน้า QMR เปิด (ยังไม่ควรมีค่า) และ ncp_closed (minor ไม่ผ่าน QMR เลย) — idempotent (WHERE qmr_opened_at IS NULL)
try {
  const needBackfill = db.prepare(`
    SELECT id, created_at FROM ncrs
    WHERE qmr_opened_at IS NULL
      AND status NOT IN ('pending_supervisor','pending_manager','pending_qmr_open','ncp_closed','cancelled')
  `).all();
  for (const row of needBackfill) {
    const firstQmrApproval = db.prepare(
      "SELECT MIN(created_at) AS t FROM ncr_approvals WHERE ncr_id = ? AND role = 'qmr'"
    ).get(row.id).t;
    db.prepare('UPDATE ncrs SET qmr_opened_at = ? WHERE id = ?').run(firstQmrApproval || row.created_at, row.id);
  }
  if (needBackfill.length > 0) console.log(`[Migration] Backfilled qmr_opened_at for ${needBackfill.length} existing NCR(s)`);
} catch (e) {
  console.error('[Migration] qmr_opened_at backfill failed:', e.message);
}

// Relax users.role CHECK for DB เก่า (เพิ่ม prod_supervisor) — ต้องรันก่อน seedData() ที่ seed prod_sup1
migrateUsersRoleConstraint();
// Relax users.role CHECK for DB เก่า (เพิ่ม warehouse_supervisor/warehouse_manager)
migrateUsersRoleConstraintWarehouse();

seedData();
syncSequences();

module.exports = db;
