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
  'pending_purchasing_review', 'pending_supplier', 'pending_manager_review',
  'pending_qmr_close', 'pending_supplier_resubmit', 'pending_uai',
  'closed', 'uai_pending_qc_manager', 'cancelled', 'ncp_closed',
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
    // Column already exists — ignore
    if (!e.message.includes('duplicate column')) throw e;
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

  // ncrs: purchasing acknowledgment + link copy tracking
  safeAddColumn('ncrs', 'purchasing_received_at', 'DATETIME');
  safeAddColumn('ncrs', 'purchasing_received_by', 'INTEGER REFERENCES users(id)');
  safeAddColumn('ncrs', 'link_copied_at', 'DATETIME');
  safeAddColumn('ncrs', 'link_copied_by', 'INTEGER REFERENCES users(id)');
  safeAddColumn('ncrs', 'link_copied_count', 'INTEGER DEFAULT 0');

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

  // product_images: image_type (product vs quality_issue)
  safeAddColumn('product_images', 'image_type', "TEXT DEFAULT 'product'");

  // issue_talks: supplier context
  safeAddColumn('issue_talks', 'supplier_id', 'INTEGER');

  // users: QC station assignment for attendance
  safeAddColumn('users', 'qc_station', 'TEXT');

  // users: personal Telegram chat id — ส่งแจ้งเตือนกระดิ่งเข้า Telegram ส่วนตัวของแต่ละคน
  safeAddColumn('users', 'telegram_chat_id', 'TEXT');

  // qc_attendance: check-out, late tracking, work hours
  safeAddColumn('qc_attendance', 'check_out_at', 'DATETIME');
  safeAddColumn('qc_attendance', 'late_minutes', 'INTEGER DEFAULT 0');
  safeAddColumn('qc_attendance', 'work_minutes', 'INTEGER');
  safeAddColumn('qc_attendance', 'admin_note', 'TEXT');
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

  // settings defaults
  const settingKeys = [
    'telegram_bot_token','telegram_group_qc','telegram_group_purchasing','app_url','token_expiry_days',
    'company_name','company_address','company_logo',
    'ncr_img_cols','ncr_img_max_width','uai_img_cols','uai_img_max_width',
    'factory_lat','factory_lon','factory_radius_m',
  ];
  const defaults = {
    telegram_bot_token: '', telegram_group_qc: '', telegram_group_purchasing: '',
    app_url: 'http://localhost:5173', token_expiry_days: '90',
    company_name: '', company_address: '', company_logo: '',
    ncr_img_cols: '3', ncr_img_max_width: '180',
    uai_img_cols: '3', uai_img_max_width: '160',
    factory_lat: '', factory_lon: '', factory_radius_m: '200',
  };
  for (const key of settingKeys) {
    const exists = db.prepare('SELECT 1 FROM settings WHERE key = ?').get(key);
    if (!exists) {
      db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(key, defaults[key]);
    }
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
      ['cco1', 'cco', 'วิชัย CCO'],
      ['cmo1', 'cmo', 'สมหญิง CMO'],
      ['cpo1', 'cpo', 'ประเสริฐ CPO'],
      ['production1', 'production_manager', 'สมศักดิ์ ผจก.ผลิต'],
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

// ===== ATOMIC SEQUENCE GENERATION (race-condition safe) =====
const nextSequence = db.transaction((docType) => {
  const year = new Date().getFullYear();
  // Reset if new year
  db.prepare(`UPDATE document_sequences SET last_seq=0, year=? WHERE doc_type=? AND year!=?`).run(year, docType, year);
  // Atomic increment + RETURNING
  const r = db.prepare(`UPDATE document_sequences SET last_seq=last_seq+1 WHERE doc_type=? AND year=? RETURNING last_seq, year`).get(docType, year);
  if (!r) {
    // Insert if missing
    db.prepare(`INSERT OR IGNORE INTO document_sequences (doc_type, year, last_seq) VALUES (?, ?, 1)`).run(docType, year);
    return `${docType}-${year}-0001`;
  }
  return `${docType}-${r.year}-${String(r.last_seq).padStart(4, '0')}`;
});

db.nextNCRCode = () => nextSequence('NCR');
db.nextUAICode = () => nextSequence('UAI');
db.nextNCPCode = () => nextSequence('NCP');

// ===== AUDIT LOG HELPER =====
db.auditLog = function(tableName, recordId, action, oldValue, newValue, userId, ip) {
  try {
    db.prepare(`INSERT INTO audit_logs (table_name, record_id, action, old_value, new_value, user_id, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(tableName, recordId, action, oldValue ? JSON.stringify(oldValue) : null, newValue ? JSON.stringify(newValue) : null, userId || null, ip || null);
  } catch (e) {
    console.error('[AuditLog Error]', e.message);
  }
};

// ===== SETTINGS HELPER =====
db.getSetting = function(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
};
db.setSetting = function(key, value) {
  db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP").run(key, value);
};

// ===== SECURE TOKEN GENERATOR =====
db.generateSecureToken = function() {
  return crypto.randomBytes(32).toString('hex');
};

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

seedData();
syncSequences();

module.exports = db;
