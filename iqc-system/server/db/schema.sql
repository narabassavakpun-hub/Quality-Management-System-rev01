-- ===== USERS =====
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN (
    'admin','qc_staff','qc_supervisor','qc_manager',
    'qmr','purchasing','purchasing_manager','cco','cmo','cpo','production_manager','prod_supervisor'
  )),
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ===== MASTER LIST =====

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  notes TEXT,
  approval_status TEXT DEFAULT 'trial' CHECK(approval_status IN ('approved','trial','suspended','blacklisted')),
  approval_date DATE,
  approval_by INTEGER REFERENCES users(id),
  suspension_reason TEXT,
  next_evaluation_date DATE,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS supplier_approval_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE RESTRICT,
  old_status TEXT,
  new_status TEXT NOT NULL,
  reason TEXT NOT NULL,
  changed_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  changed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  require_inspection_doc INTEGER DEFAULT 0,
  require_lot_number INTEGER DEFAULT 0,
  require_expiry_date INTEGER DEFAULT 0,
  require_certificate INTEGER DEFAULT 0,
  has_shelf_life INTEGER DEFAULT 0,
  shelf_life_days INTEGER,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  abbreviation TEXT,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS colors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  hex_code TEXT,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS aql_tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_level TEXT NOT NULL CHECK(inspection_level IN (
    'GEN_I','GEN_II','GEN_III','S1','S2','S3','S4','FULL'
  )),
  aql_value TEXT,
  batch_from INTEGER NOT NULL,
  batch_to INTEGER,
  sample_size INTEGER,
  accept_number INTEGER,
  reject_number INTEGER,
  is_active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE RESTRICT,
  product_group_id INTEGER REFERENCES product_groups(id) ON DELETE RESTRICT,
  unit_id INTEGER REFERENCES units(id) ON DELETE RESTRICT,
  model_id INTEGER REFERENCES models(id) ON DELETE RESTRICT,
  inspection_level TEXT DEFAULT 'GEN_II',
  aql_value TEXT DEFAULT '2.5',
  notes TEXT,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product_colors (
  product_id INTEGER REFERENCES products(id) ON DELETE RESTRICT,
  color_id INTEGER REFERENCES colors(id) ON DELETE RESTRICT,
  PRIMARY KEY (product_id, color_id)
);

CREATE TABLE IF NOT EXISTS product_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER REFERENCES products(id) ON DELETE RESTRICT,
  file_path TEXT NOT NULL,
  original_name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product_drawings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER REFERENCES products(id) ON DELETE RESTRICT,
  revision TEXT NOT NULL,
  file_path TEXT NOT NULL,
  original_name TEXT NOT NULL,
  effective_date DATE NOT NULL,
  approved_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  approved_at DATETIME,
  is_current INTEGER DEFAULT 0,
  change_description TEXT,
  obsoleted_at DATETIME,
  created_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS defect_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  notes TEXT,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS measuring_equipment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  serial_number TEXT,
  location TEXT,
  calibration_interval_days INTEGER NOT NULL DEFAULT 365,
  last_calibrated_date DATE,
  calibrated_by TEXT,
  certificate_file_path TEXT,
  status TEXT DEFAULT 'active' CHECK(status IN ('active','out_of_service','calibrating')),
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS supplier_evaluations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE RESTRICT,
  eval_period TEXT NOT NULL,
  eval_date DATE NOT NULL,
  score_quality INTEGER,
  score_delivery INTEGER,
  score_response INTEGER,
  grade TEXT,
  recommendation TEXT,
  evaluator_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  approved_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS supplier_risks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE RESTRICT,
  risk_type TEXT NOT NULL CHECK(risk_type IN (
    'sole_source','geographic','quality_history','financial','lead_time','other'
  )),
  description TEXT NOT NULL,
  likelihood INTEGER NOT NULL CHECK(likelihood BETWEEN 1 AND 5),
  impact INTEGER NOT NULL CHECK(impact BETWEEN 1 AND 5),
  mitigation TEXT,
  owner_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  review_date DATE,
  status TEXT DEFAULT 'open' CHECK(status IN ('open','mitigated','accepted','closed')),
  created_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ===== BILL =====

CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no TEXT NOT NULL,
  po_no TEXT NOT NULL,
  container_no TEXT,
  tracking_no TEXT,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE RESTRICT,
  received_date DATE NOT NULL,
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft','pending_approval','approved','cancelled','editing')),
  cancelled_at DATETIME,
  cancelled_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  created_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bill_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id INTEGER REFERENCES bills(id) ON DELETE RESTRICT,
  file_path TEXT NOT NULL,
  uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bill_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id INTEGER REFERENCES bills(id) ON DELETE RESTRICT,
  product_id INTEGER REFERENCES products(id),
  item_name TEXT NOT NULL,
  qty_received INTEGER NOT NULL,
  qty_sampled INTEGER NOT NULL,
  qty_passed INTEGER NOT NULL,
  qty_failed INTEGER NOT NULL,
  defect_category_id INTEGER REFERENCES defect_categories(id) ON DELETE RESTRICT,
  defect_detail TEXT,
  inspector_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  inspected_at DATETIME,
  inspection_note TEXT,
  drawing_revision_id INTEGER REFERENCES product_drawings(id) ON DELETE RESTRICT,
  lot_number TEXT,
  batch_number TEXT,
  manufacturing_date DATE,
  expiry_date DATE,
  country_of_origin TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bill_item_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_item_id INTEGER REFERENCES bill_items(id) ON DELETE RESTRICT,
  file_path TEXT NOT NULL,
  uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bill_item_inspection_docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_item_id INTEGER REFERENCES bill_items(id) ON DELETE RESTRICT,
  file_path TEXT NOT NULL,
  file_type TEXT NOT NULL,
  original_name TEXT NOT NULL,
  uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bill_item_certificates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_item_id INTEGER REFERENCES bill_items(id) ON DELETE RESTRICT,
  cert_type TEXT NOT NULL CHECK(cert_type IN ('coc','mill_cert','test_report','other')),
  cert_number TEXT,
  file_path TEXT NOT NULL,
  original_name TEXT NOT NULL,
  issued_date DATE,
  issued_by TEXT,
  uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bill_item_equipment (
  bill_item_id INTEGER REFERENCES bill_items(id) ON DELETE RESTRICT,
  equipment_id INTEGER REFERENCES measuring_equipment(id) ON DELETE RESTRICT,
  PRIMARY KEY (bill_item_id, equipment_id)
);

-- ===== NCR =====

CREATE TABLE IF NOT EXISTS ncrs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ncr_code TEXT UNIQUE NOT NULL,
  bill_id INTEGER REFERENCES bills(id) ON DELETE RESTRICT,
  po_no TEXT NOT NULL,
  invoice_no TEXT NOT NULL,
  severity TEXT CHECK(severity IN ('major','minor')),
  -- DEVMORE H4: status เป็น TEXT ไม่มี CHECK — validate ที่ app layer (db.VALID_NCR_STATUSES)
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
  created_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ncr_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ncr_id INTEGER REFERENCES ncrs(id) ON DELETE RESTRICT,
  bill_item_id INTEGER REFERENCES bill_items(id) ON DELETE RESTRICT,
  item_name TEXT NOT NULL,
  qty_received INTEGER NOT NULL,
  qty_sampled INTEGER NOT NULL,
  qty_failed INTEGER NOT NULL,
  defect_category_id INTEGER REFERENCES defect_categories(id) ON DELETE RESTRICT,
  defect_detail TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ncr_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ncr_id INTEGER REFERENCES ncrs(id) ON DELETE RESTRICT,
  ncr_item_id INTEGER REFERENCES ncr_items(id) ON DELETE RESTRICT,
  file_path TEXT NOT NULL,
  uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ncr_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ncr_id INTEGER REFERENCES ncrs(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  role TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  comment TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS supplier_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ncr_id INTEGER REFERENCES ncrs(id) ON DELETE RESTRICT,
  respondent_name TEXT,
  root_cause TEXT NOT NULL,
  corrective_action TEXT NOT NULL,
  preventive_action TEXT NOT NULL,
  completion_date DATE,
  submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  superseded_at DATETIME
);

CREATE TABLE IF NOT EXISTS supplier_response_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  response_id INTEGER REFERENCES supplier_responses(id) ON DELETE RESTRICT,
  file_path TEXT NOT NULL,
  uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS re_inspections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ncr_id INTEGER REFERENCES ncrs(id) ON DELETE RESTRICT,
  round INTEGER NOT NULL DEFAULT 1,
  inspector_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  inspected_at DATETIME NOT NULL,
  qty_re_inspected INTEGER NOT NULL,
  qty_passed INTEGER NOT NULL,
  qty_failed INTEGER NOT NULL,
  result TEXT NOT NULL CHECK(result IN ('passed','failed')),
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS re_inspection_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  re_inspection_id INTEGER REFERENCES re_inspections(id) ON DELETE RESTRICT,
  file_path TEXT NOT NULL,
  uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ===== UAI =====

CREATE TABLE IF NOT EXISTS uai_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uai_code TEXT UNIQUE NOT NULL,
  ncr_id INTEGER REFERENCES ncrs(id) ON DELETE RESTRICT,
  reason TEXT,
  conditions TEXT,
  department TEXT,
  issued_date DATE,
  status TEXT DEFAULT 'uai_pending_qc_manager' CHECK(status IN (
    'uai_pending_qc_manager','uai_pending_purchasing',
    'uai_pending_cco','uai_pending_cmo','uai_pending_cpo',
    'uai_pending_qc_ack','uai_pending_production_ack',
    'uai_pending_qmr_ack','uai_completed','uai_rejected','uai_rejected_by_exec'
  )),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS uai_signatures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uai_id INTEGER REFERENCES uai_documents(id) ON DELETE RESTRICT,
  role TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  signature_image TEXT NOT NULL,
  action TEXT NOT NULL,
  comment TEXT,
  signed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS uai_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uai_id INTEGER REFERENCES uai_documents(id) ON DELETE RESTRICT,
  file_path TEXT NOT NULL,
  original_name TEXT,
  uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_uai_images_uai ON uai_images(uai_id);

-- ===== COMPANY HOLIDAYS =====

CREATE TABLE IF NOT EXISTS company_holidays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  holiday_date DATE NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_holidays_date ON company_holidays(holiday_date);

-- ===== DELIVERY SCHEDULE =====

CREATE TABLE IF NOT EXISTS delivery_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE RESTRICT,
  scheduled_date DATE NOT NULL,
  time_slot TEXT NOT NULL,
  is_unplanned INTEGER DEFAULT 0,
  notes TEXT,
  has_sample INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending' CHECK(status IN (
    'pending','acknowledged','on_time','late','cancelled','rescheduled'
  )),
  actual_date DATE,
  actual_time TEXT,
  late_reason TEXT,
  rescheduled_date DATE,
  acknowledged_at DATETIME,
  acknowledged_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  received_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  created_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS delivery_schedule_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id INTEGER REFERENCES delivery_schedules(id) ON DELETE RESTRICT,
  product_id INTEGER REFERENCES products(id) ON DELETE RESTRICT,
  item_name TEXT,
  qty_expected INTEGER,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS delivery_schedule_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id INTEGER REFERENCES delivery_schedules(id) ON DELETE RESTRICT,
  file_path TEXT NOT NULL,
  original_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ===== SEQUENCES =====

CREATE TABLE IF NOT EXISTS document_sequences (
  doc_type TEXT PRIMARY KEY,
  year INTEGER NOT NULL,
  last_seq INTEGER DEFAULT 0
);

-- ===== AUDIT LOG =====

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  record_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  ip_address TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ===== SETTINGS =====

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ===== PASSWORD RESET LOG =====

CREATE TABLE IF NOT EXISTS password_reset_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  reset_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ===== NOTIFICATIONS =====

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT NOT NULL,
  is_read INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ===== ISSUE TALK =====

CREATE TABLE IF NOT EXISTS issue_talks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','waiting_info','waiting_action','waiting_decision','resolved','closed')),
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS issue_talk_participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id INTEGER NOT NULL REFERENCES issue_talks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(issue_id, user_id)
);

CREATE TABLE IF NOT EXISTS issue_talk_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id INTEGER NOT NULL REFERENCES issue_talks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS issue_talk_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id INTEGER NOT NULL REFERENCES issue_talks(id) ON DELETE CASCADE,
  message_id INTEGER REFERENCES issue_talk_messages(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER,
  uploaded_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS issue_talk_reads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id INTEGER NOT NULL REFERENCES issue_talks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_message_id INTEGER DEFAULT 0,
  read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(issue_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_issue_talks_by      ON issue_talks(created_by);
CREATE INDEX IF NOT EXISTS idx_issue_talks_status  ON issue_talks(status);
CREATE INDEX IF NOT EXISTS idx_issue_talks_updated ON issue_talks(updated_at);
CREATE INDEX IF NOT EXISTS idx_issue_part_issue    ON issue_talk_participants(issue_id);
CREATE INDEX IF NOT EXISTS idx_issue_part_user     ON issue_talk_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_issue_msg_issue     ON issue_talk_messages(issue_id);
CREATE INDEX IF NOT EXISTS idx_issue_att_issue     ON issue_talk_attachments(issue_id);
CREATE INDEX IF NOT EXISTS idx_issue_att_msg       ON issue_talk_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_issue_reads         ON issue_talk_reads(issue_id, user_id);

-- ===== QC ATTENDANCE =====

CREATE TABLE IF NOT EXISTS qc_attendance (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  date         TEXT NOT NULL,         -- YYYY-MM-DD (local date)
  check_in_at  DATETIME,             -- UTC timestamp of check-in
  lat          REAL,
  lon          REAL,
  geofence_ok  INTEGER DEFAULT 0,    -- server-verified: 1=within geofence
  note         TEXT,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_date    ON qc_attendance(date);
CREATE INDEX IF NOT EXISTS idx_attendance_user    ON qc_attendance(user_id);

-- ===== INDEXES =====

CREATE INDEX IF NOT EXISTS idx_bills_supplier    ON bills(supplier_id);
CREATE INDEX IF NOT EXISTS idx_bills_date        ON bills(received_date);
CREATE INDEX IF NOT EXISTS idx_bills_status      ON bills(status);
CREATE INDEX IF NOT EXISTS idx_bills_created_by  ON bills(created_by);
CREATE INDEX IF NOT EXISTS idx_bill_items_bill   ON bill_items(bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_items_product ON bill_items(product_id);
CREATE INDEX IF NOT EXISTS idx_ncrs_status       ON ncrs(status);
CREATE INDEX IF NOT EXISTS idx_ncrs_bill         ON ncrs(bill_id);
CREATE INDEX IF NOT EXISTS idx_ncrs_token        ON ncrs(supplier_token);
CREATE INDEX IF NOT EXISTS idx_ncrs_created_at   ON ncrs(created_at);
CREATE INDEX IF NOT EXISTS idx_ncr_items_ncr     ON ncr_items(ncr_id);
CREATE INDEX IF NOT EXISTS idx_ncr_items_bi      ON ncr_items(bill_item_id);
CREATE INDEX IF NOT EXISTS idx_uai_status        ON uai_documents(status);
CREATE INDEX IF NOT EXISTS idx_uai_ncr           ON uai_documents(ncr_id);
CREATE INDEX IF NOT EXISTS idx_delivery_date     ON delivery_schedules(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_delivery_status   ON delivery_schedules(status);
CREATE INDEX IF NOT EXISTS idx_delivery_supplier ON delivery_schedules(supplier_id);
CREATE INDEX IF NOT EXISTS idx_notif_user_read   ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notif_created     ON notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_table_record ON audit_logs(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_user        ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created     ON audit_logs(created_at);

-- ===== FK indexes ที่ขาด (DEVMORE M4) — SQLite ไม่ auto-index FK =====
CREATE INDEX IF NOT EXISTS idx_supplier_resp_ncr   ON supplier_responses(ncr_id);
CREATE INDEX IF NOT EXISTS idx_resp_attach_resp    ON supplier_response_attachments(response_id);
CREATE INDEX IF NOT EXISTS idx_ncr_approvals_ncr   ON ncr_approvals(ncr_id);
CREATE INDEX IF NOT EXISTS idx_ncr_images_ncr      ON ncr_images(ncr_id);
CREATE INDEX IF NOT EXISTS idx_reinspections_ncr   ON re_inspections(ncr_id);
CREATE INDEX IF NOT EXISTS idx_uai_signatures_uai  ON uai_signatures(uai_id);
CREATE INDEX IF NOT EXISTS idx_bill_images_bill    ON bill_images(bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_item_images_bi ON bill_item_images(bill_item_id);
CREATE INDEX IF NOT EXISTS idx_bill_item_docs_bi   ON bill_item_inspection_docs(bill_item_id);
CREATE INDEX IF NOT EXISTS idx_bill_item_certs_bi  ON bill_item_certificates(bill_item_id);
CREATE INDEX IF NOT EXISTS idx_product_images_prod ON product_images(product_id);
CREATE INDEX IF NOT EXISTS idx_product_drawings_prod ON product_drawings(product_id);
CREATE INDEX IF NOT EXISTS idx_products_supplier   ON products(supplier_id);
CREATE INDEX IF NOT EXISTS idx_products_group      ON products(product_group_id);
CREATE INDEX IF NOT EXISTS idx_products_unit       ON products(unit_id);
CREATE INDEX IF NOT EXISTS idx_uai_documents_created ON uai_documents(created_at);

-- ══ KPI MANAGEMENT ══
CREATE TABLE IF NOT EXISTS kpi_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  display_order INTEGER DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kpi_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kpi_no TEXT NOT NULL UNIQUE,
  group_id INTEGER NOT NULL REFERENCES kpi_groups(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  unit TEXT,
  description TEXT,
  data_source_type TEXT NOT NULL DEFAULT 'manual',
  data_source_key TEXT,
  display_order INTEGER DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kpi_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kpi_item_id INTEGER NOT NULL REFERENCES kpi_items(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  target_value REAL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(kpi_item_id, year, month)
);

-- ⚠️ DEPRECATED (Session 104) — kpi_reports/kpi_report_entries/kpi_report_files/kpi_approvals
-- ไม่มี UI entry point ใน client/src เลย (ไม่มีปุ่มสร้าง/หน้า list/ลิงก์ไป /kpi/reports/:id ที่ไหน)
-- ถูกแทนที่ด้วย kpi_actuals (บันทึกค่าจริง) + kpi_action_plans (CAPA) ตั้งแต่ก่อน Session 89 — ดู AUDIT.md §3.7/D3, CLAUDE.md §22.3
-- คงตารางไว้ (ไม่ลบ) เพราะ backend/service/test ยังมีอยู่ครบและอาจมีข้อมูลเก่า — ห้ามใช้เป็น pattern สำหรับโค้ดใหม่
-- และห้ามสร้าง UI ใหม่โดยไม่ปรึกษา product owner ก่อน (decision เปิดอยู่: ลบทิ้ง หรือ สร้างหน้า UI ให้จบ)
CREATE TABLE IF NOT EXISTS kpi_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_no TEXT NOT NULL UNIQUE,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  reject_reason TEXT,
  rejected_by_role TEXT,
  submitted_at TEXT,
  qc_manager_at TEXT,
  qc_manager_by INTEGER REFERENCES users(id),
  cpo_at TEXT,
  cpo_by INTEGER REFERENCES users(id),
  qmr_at TEXT,
  qmr_by INTEGER REFERENCES users(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kpi_report_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES kpi_reports(id) ON DELETE CASCADE,
  kpi_item_id INTEGER NOT NULL REFERENCES kpi_items(id),
  target_value REAL,
  actual_value REAL,
  remark TEXT,
  data_source_note TEXT,
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(report_id, kpi_item_id)
);

CREATE TABLE IF NOT EXISTS kpi_report_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES kpi_report_entries(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kpi_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES kpi_reports(id),
  action TEXT NOT NULL,
  role TEXT NOT NULL,
  comment TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_kpi_items_group ON kpi_items(group_id);
CREATE INDEX IF NOT EXISTS idx_kpi_targets_item ON kpi_targets(kpi_item_id, year, month);
CREATE INDEX IF NOT EXISTS idx_kpi_reports_status ON kpi_reports(status);
CREATE INDEX IF NOT EXISTS idx_kpi_reports_year ON kpi_reports(year, month);
CREATE INDEX IF NOT EXISTS idx_kpi_entries_report ON kpi_report_entries(report_id);
CREATE INDEX IF NOT EXISTS idx_kpi_approvals_report ON kpi_approvals(report_id);

-- KPI simple data entry (ไม่ใช้ approval flow)
CREATE TABLE IF NOT EXISTS kpi_actuals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kpi_item_id INTEGER NOT NULL REFERENCES kpi_items(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
  actual_value REAL,
  fail_cause TEXT,
  corrective_action TEXT,
  preventive_action TEXT,
  remark TEXT,
  created_by INTEGER REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(kpi_item_id, year, month)
);
CREATE INDEX IF NOT EXISTS idx_kpi_actuals_item ON kpi_actuals(kpi_item_id, year, month);
CREATE INDEX IF NOT EXISTS idx_kpi_actuals_year ON kpi_actuals(year, month);

-- KPI Action Plan (Online approval flow: Admin → QC Manager → CPO)
CREATE TABLE IF NOT EXISTS kpi_action_plans (
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
CREATE INDEX IF NOT EXISTS idx_kpi_ap_item   ON kpi_action_plans(kpi_item_id, year, month);
CREATE INDEX IF NOT EXISTS idx_kpi_ap_status ON kpi_action_plans(status);

-- =====================================================================
-- IPQC / FQC MODULE (Production-floor QC) — added 2026-06-24
-- IPQC = In-Process QC (defect during production)
-- FQC  = Final QC (daily lot output)
-- NOTE: uses pro_code_sap (finished goods) — NOT products (raw material)
-- =====================================================================

-- ProCodeSAP — finished-goods master with auto-classified attributes (replaces Excel Sheet8)
CREATE TABLE IF NOT EXISTS pro_code_sap (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  product_no      TEXT UNIQUE NOT NULL,       -- 'FA00-W0313-240110'
  product_desc    TEXT,
  sap_part1       TEXT,                        -- 'FA00'
  sap_part2       TEXT,                        -- 'W0313'
  sap_part3       TEXT,                        -- '240110'
  line_type       TEXT,                        -- FA, FU, RU, WO
  product_series  TEXT,                        -- F100, S85, ECO 60, ECO 60-100, ORM
  brand           TEXT,                        -- WINDOW ASIA, FRAMEX, ...
  panel_type      TEXT,                        -- หน้าต่าง, ประตู, ช่องแสง
  panel_style     TEXT,                        -- SS, FSSF, SSSS, SFS
  iron_pattern    TEXT,
  iron_color      TEXT,
  glass_type      TEXT,
  mosquito_net    TEXT,
  panel_color     TEXT,
  panel_size      TEXT,                        -- '240x110'
  width_mm        INTEGER,
  height_mm       INTEGER,
  design_version  TEXT,
  remarks         TEXT,
  classify_status TEXT NOT NULL DEFAULT 'pending'
                  CHECK(classify_status IN ('pending','auto','confirmed','rejected')),
  auto_confidence INTEGER DEFAULT 0,           -- 0-100
  classified_by   INTEGER REFERENCES users(id),
  classified_at   DATETIME,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pro_code_no     ON pro_code_sap(product_no);
CREATE INDEX IF NOT EXISTS idx_pro_code_brand  ON pro_code_sap(brand);
CREATE INDEX IF NOT EXISTS idx_pro_code_type   ON pro_code_sap(line_type);
CREATE INDEX IF NOT EXISTS idx_pro_code_status ON pro_code_sap(classify_status);
CREATE INDEX IF NOT EXISTS idx_pro_code_color  ON pro_code_sap(panel_color);
CREATE INDEX IF NOT EXISTS idx_pro_code_size   ON pro_code_sap(panel_size);

-- SAP parse rules (admin-editable, applied by classifier on top of built-in rules)
CREATE TABLE IF NOT EXISTS sap_parse_rules (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_type    TEXT NOT NULL CHECK(rule_type IN ('part1_prefix','part1_suffix','part2_prefix','desc_contains')),
  match_value  TEXT NOT NULL,
  target_field TEXT NOT NULL,                  -- column name in pro_code_sap to set
  set_value    TEXT NOT NULL,
  priority     INTEGER DEFAULT 0,
  is_active    INTEGER DEFAULT 1,
  created_by   INTEGER REFERENCES users(id),
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sap_rule_type ON sap_parse_rules(rule_type, is_active);

-- Pre-computed majority-vote prediction cache (rebuilt on confirm / attribute update)
-- Keyed on (sap_part1, sap_part2, field_name) — one row per field per code group
CREATE TABLE IF NOT EXISTS sap_prediction_cache (
  sap_part1       TEXT NOT NULL,
  sap_part2       TEXT NOT NULL DEFAULT '',
  field_name      TEXT NOT NULL,
  top_value       TEXT NOT NULL,
  frequency       INTEGER NOT NULL DEFAULT 0,
  sample_size     INTEGER NOT NULL DEFAULT 0,
  confidence_pct  INTEGER NOT NULL DEFAULT 0,
  updated_at      TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (sap_part1, sap_part2, field_name)
);
CREATE INDEX IF NOT EXISTS idx_pred_cache_lookup ON sap_prediction_cache(sap_part1, sap_part2);

-- Master lookup derived from training data (never wiped by rebuildPredictionCache)
-- Populated via POST /api/pro-code-sap/import-master-training (admin only)
CREATE TABLE IF NOT EXISTS sap_master_lookup (
  sap_part1       TEXT NOT NULL,
  sap_part2       TEXT NOT NULL DEFAULT '',
  field_name      TEXT NOT NULL,
  top_value       TEXT NOT NULL,
  frequency       INTEGER NOT NULL DEFAULT 0,
  sample_size     INTEGER NOT NULL DEFAULT 0,
  confidence_pct  INTEGER NOT NULL DEFAULT 0,
  imported_at     TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (sap_part1, sap_part2, field_name)
);
CREATE INDEX IF NOT EXISTS idx_master_lookup ON sap_master_lookup(sap_part1, sap_part2);

-- Production lines / factories
-- line_type/factory ไม่ CHECK enum แบบ fixed แล้ว — ตัวเลือกจริงมาจาก line_types/factories table
-- (ขยายได้ผ่านปุ่ม + ในฟอร์ม "สายผลิต", ดู routes/ipqcMaster.js) code auto-gen จาก factory-LINE_TYPE-seq
CREATE TABLE IF NOT EXISTS production_lines (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT UNIQUE NOT NULL,           -- 'F01-ALU-15' — server-generated, ห้าม update หลัง INSERT
  name         TEXT NOT NULL,
  line_type    TEXT NOT NULL,                  -- ต้องตรงกับ line_types.code ที่ is_active=1
  factory      TEXT NOT NULL,                  -- ต้องตรงกับ factories.name ที่ is_active=1
  factory_code TEXT NOT NULL,                  -- '01' — auto-fill จาก factories.factory_code เสมอ
  pdplan_sheet TEXT,                           -- '0115,0116' comma-separated sheet codes
  is_active    INTEGER DEFAULT 1,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_prod_line_active ON production_lines(is_active);

-- ตัวเลือก dropdown "ประเภทสาย" ในฟอร์มสายผลิต — เพิ่มได้ผ่านปุ่ม + (ไม่ fixed enum อีกต่อไป)
CREATE TABLE IF NOT EXISTS line_types (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT NOT NULL UNIQUE,             -- ค่าที่เก็บใน production_lines.line_type เช่น 'alu'
  name       TEXT NOT NULL,                    -- label ที่แสดง เช่น 'ALU'
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ตัวเลือก dropdown "โรงงาน" — factory_code ผูกกับโรงงานแต่ละแห่ง (auto-fill ตอนเลือก ไม่ต้องพิมพ์ซ้ำ)
CREATE TABLE IF NOT EXISTS factories (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL UNIQUE,           -- ค่าที่เก็บใน production_lines.factory เช่น 'F01'
  factory_code TEXT NOT NULL,                  -- '01'
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT DEFAULT (datetime('now'))
);

-- Atomic running number สำหรับ auto-generate รหัสสาย ต่อ (factory, line_type) — ห้าม SELECT MAX() (กฎ 2.3)
CREATE TABLE IF NOT EXISTS production_line_seq (
  factory   TEXT NOT NULL,
  line_type TEXT NOT NULL,
  last_seq  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (factory, line_type)
);

-- Production-line managers (many-to-many: line ↔ production_manager user)
CREATE TABLE IF NOT EXISTS production_line_managers (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  production_line_id INTEGER NOT NULL REFERENCES production_lines(id) ON DELETE CASCADE,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(production_line_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_prod_line_mgr_line ON production_line_managers(production_line_id);
CREATE INDEX IF NOT EXISTS idx_prod_line_mgr_user ON production_line_managers(user_id);

-- FM Category (Man/Machine/Material/Method)
CREATE TABLE IF NOT EXISTS fm_categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  code       TEXT NOT NULL UNIQUE,             -- used in Defect Code
  is_active  INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Process steps (NULL line = applies to all lines)
CREATE TABLE IF NOT EXISTS process_steps (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  production_line_id INTEGER REFERENCES production_lines(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  code               TEXT NOT NULL,            -- used in Defect Code
  sort_order         INTEGER DEFAULT 0,
  is_active          INTEGER DEFAULT 1,
  created_at         DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_process_steps_line ON process_steps(production_line_id);

-- Defect types (NULL line = all lines; linked to an FM category)
CREATE TABLE IF NOT EXISTS defect_types (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  production_line_id INTEGER REFERENCES production_lines(id) ON DELETE CASCADE,
  fm_category_id     INTEGER REFERENCES fm_categories(id) ON DELETE RESTRICT,
  name               TEXT NOT NULL,
  code               TEXT NOT NULL,            -- 3-digit, used in Defect Code
  is_active          INTEGER DEFAULT 1,
  created_at         DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_defect_types_line ON defect_types(production_line_id);
CREATE INDEX IF NOT EXISTS idx_defect_types_fm   ON defect_types(fm_category_id);

-- Shifts (used by IPQC + FQC)
CREATE TABLE IF NOT EXISTS shifts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  start_time TEXT,
  end_time   TEXT,
  is_active  INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Defect-rate pass/fail thresholds (NULL line + NULL product = global default)
CREATE TABLE IF NOT EXISTS defect_rate_thresholds (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  production_line_id INTEGER REFERENCES production_lines(id) ON DELETE CASCADE,
  pro_code_sap_id    INTEGER REFERENCES pro_code_sap(id) ON DELETE CASCADE,
  threshold_pct      REAL NOT NULL DEFAULT 3.0,
  effective_date     DATE NOT NULL DEFAULT (date('now')),
  created_by         INTEGER REFERENCES users(id),
  created_at         DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_threshold_line ON defect_rate_thresholds(production_line_id);
CREATE INDEX IF NOT EXISTS idx_threshold_sap  ON defect_rate_thresholds(pro_code_sap_id);

-- PDPlan — production plan imported from Planning Excel (replaces Excel Sheet3)
CREATE TABLE IF NOT EXISTS pd_plans (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_no             TEXT NOT NULL,
  product_no         TEXT NOT NULL,
  product_desc       TEXT,
  plan_qty           INTEGER NOT NULL DEFAULT 0,
  completed_qty      INTEGER DEFAULT 0,
  open_qty           INTEGER DEFAULT 0,
  daily_output       INTEGER DEFAULT 0,  -- งานออกประจำวัน
  so_daily           TEXT,               -- SO.ประจำวัน
  stock_qty          INTEGER DEFAULT 0,  -- STOCK
  remaining_qty      INTEGER DEFAULT 0,  -- คงเหลือ
  remarks            TEXT,               -- หมายเหตุ
  daily_plan         INTEGER DEFAULT 0,  -- รายวัน
  ot_qty             INTEGER DEFAULT 0,  -- OT
  order_date         DATE,
  start_date         DATE,
  due_date           DATE,
  production_line_id INTEGER REFERENCES production_lines(id) ON DELETE SET NULL,
  pro_code_sap_id    INTEGER REFERENCES pro_code_sap(id) ON DELETE SET NULL,
  source_file        TEXT,
  source_sheet       TEXT,
  imported_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  imported_by        INTEGER REFERENCES users(id),
  UNIQUE(doc_no, product_no)
);
CREATE INDEX IF NOT EXISTS idx_pd_plan_no   ON pd_plans(product_no);
CREATE INDEX IF NOT EXISTS idx_pd_plan_due  ON pd_plans(due_date);
CREATE INDEX IF NOT EXISTS idx_pd_plan_line ON pd_plans(production_line_id);
CREATE INDEX IF NOT EXISTS idx_pd_plan_sap  ON pd_plans(pro_code_sap_id);

-- IPQC records (in-process defect; 1 defect per record)
CREATE TABLE IF NOT EXISTS ipqc_records (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  record_no           TEXT UNIQUE NOT NULL,    -- 'IPQC-2026-0001'
  found_date          DATE NOT NULL,
  recorded_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  pro_code_sap_id     INTEGER REFERENCES pro_code_sap(id) ON DELETE RESTRICT,
  po_number           TEXT,
  pd_plan_id          INTEGER REFERENCES pd_plans(id) ON DELETE SET NULL,
  production_line_id  INTEGER NOT NULL REFERENCES production_lines(id) ON DELETE RESTRICT,
  process_step_id     INTEGER NOT NULL REFERENCES process_steps(id) ON DELETE RESTRICT,
  shift_id            INTEGER REFERENCES shifts(id) ON DELETE SET NULL,
  fm_category_id      INTEGER NOT NULL REFERENCES fm_categories(id) ON DELETE RESTRICT,
  defect_type_id      INTEGER NOT NULL REFERENCES defect_types(id) ON DELETE RESTRICT,
  defect_code         TEXT NOT NULL,
  defect_qty          INTEGER NOT NULL CHECK(defect_qty > 0),
  total_qty           INTEGER,
  description         TEXT,
  responsible_user_id INTEGER REFERENCES users(id),
  responsible_name    TEXT,
  status              TEXT NOT NULL DEFAULT 'open'
                      CHECK(status IN ('open','in_progress','closed','cancelled')),
  closed_at           DATETIME,
  closed_by           INTEGER REFERENCES users(id),
  created_by          INTEGER NOT NULL REFERENCES users(id),
  created_ip          TEXT
);
CREATE INDEX IF NOT EXISTS idx_ipqc_date        ON ipqc_records(found_date);
CREATE INDEX IF NOT EXISTS idx_ipqc_sap         ON ipqc_records(pro_code_sap_id);
CREATE INDEX IF NOT EXISTS idx_ipqc_line        ON ipqc_records(production_line_id);
CREATE INDEX IF NOT EXISTS idx_ipqc_status      ON ipqc_records(status);
CREATE INDEX IF NOT EXISTS idx_ipqc_created_by  ON ipqc_records(created_by);
CREATE INDEX IF NOT EXISTS idx_ipqc_defect_code ON ipqc_records(defect_code);

CREATE TABLE IF NOT EXISTS ipqc_images (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ipqc_record_id INTEGER NOT NULL REFERENCES ipqc_records(id) ON DELETE CASCADE,
  file_path      TEXT NOT NULL,
  original_name  TEXT,
  sort_order     INTEGER DEFAULT 0,
  uploaded_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ipqc_images ON ipqc_images(ipqc_record_id);

-- fqc_records/fqc_defect_items/fqc_images/fqc_monthly_approvals ถูกลบแล้ว (Session 104)
-- เหตุผล: ไม่เคยมี route จริง (`/api/fqc` ไม่เคย mount ใน index.js) — ฟีเจอร์ FQC ถูกแทนที่ด้วย
-- fgqc_records (ดูด้านล่าง) ตั้งแต่การพัฒนา FG Production module — ยืนยันไม่มี reference เหลือ (AUDIT.md D4)

-- ══════════════════════════════════════════════════════════════════
-- FG INSPECTION / IPNCR / IPNCP MODULE
-- ══════════════════════════════════════════════════════════════════

-- สถานีแก้ไขงาน (IPNCP dropdown) — Admin จัดการผ่าน Master
CREATE TABLE IF NOT EXISTS return_stations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  factory     TEXT,
  sort_order  INTEGER DEFAULT 0,
  is_active   INTEGER DEFAULT 1,
  created_at  TEXT DEFAULT (datetime('now'))
);

-- ยอดผลิตรายวัน — Admin บันทึกตามรายงานผลผลิต
CREATE TABLE IF NOT EXISTS fg_productions (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_no             TEXT NOT NULL,
  pro_code_sap_id    INTEGER REFERENCES pro_code_sap(id) ON DELETE RESTRICT,
  production_line_id INTEGER REFERENCES production_lines(id) ON DELETE RESTRICT,
  shift_id           INTEGER REFERENCES shifts(id) ON DELETE SET NULL,
  produce_date       DATE NOT NULL,
  qty_produced       INTEGER NOT NULL DEFAULT 0,
  source_doc         TEXT,
  remarks            TEXT,
  created_by         INTEGER REFERENCES users(id),
  created_at         TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fg_prod_docno ON fg_productions(doc_no);
CREATE INDEX IF NOT EXISTS idx_fg_prod_date  ON fg_productions(produce_date);
CREATE INDEX IF NOT EXISTS idx_fg_prod_line  ON fg_productions(production_line_id);

-- ตารางงาน IPQC ที่ระบบสร้างให้รายวัน (auto-generate จาก pd_plans)
CREATE TABLE IF NOT EXISTS ipqc_schedules (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_date      DATE NOT NULL,
  doc_no             TEXT NOT NULL,
  pro_code_sap_id    INTEGER REFERENCES pro_code_sap(id) ON DELETE SET NULL,
  production_line_id INTEGER REFERENCES production_lines(id) ON DELETE SET NULL,
  process_step_id    INTEGER REFERENCES process_steps(id) ON DELETE SET NULL,
  assigned_to        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status             TEXT DEFAULT 'pending',  -- pending|in_progress|completed|skipped
  generated_at       TEXT DEFAULT (datetime('now')),
  UNIQUE(schedule_date, doc_no, process_step_id)
);
CREATE INDEX IF NOT EXISTS idx_ipqc_sched_date ON ipqc_schedules(schedule_date);
CREATE INDEX IF NOT EXISTS idx_ipqc_sched_line ON ipqc_schedules(production_line_id);

-- IPQC รอบตรวจทุก 2 ชม. ต่อ process step
CREATE TABLE IF NOT EXISTS ipqc_rounds (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  record_no          TEXT NOT NULL UNIQUE,
  schedule_id        INTEGER REFERENCES ipqc_schedules(id) ON DELETE SET NULL,
  doc_no             TEXT NOT NULL,
  pro_code_sap_id    INTEGER REFERENCES pro_code_sap(id) ON DELETE RESTRICT,
  production_line_id INTEGER REFERENCES production_lines(id) ON DELETE RESTRICT,
  process_step_id    INTEGER REFERENCES process_steps(id) ON DELETE SET NULL,
  shift_id           INTEGER REFERENCES shifts(id) ON DELETE SET NULL,
  inspect_date       DATE NOT NULL,
  inspect_time       TEXT,
  sample_qty         INTEGER NOT NULL DEFAULT 0,
  pass_qty           INTEGER DEFAULT 0,
  defect_qty         INTEGER DEFAULT 0,
  result             TEXT DEFAULT 'pass',  -- pass|fail|warning
  status             TEXT DEFAULT 'open',  -- open|completed
  remarks            TEXT,
  created_by         INTEGER REFERENCES users(id),
  created_at         TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ipqc_round_date    ON ipqc_rounds(inspect_date);
CREATE INDEX IF NOT EXISTS idx_ipqc_round_docno   ON ipqc_rounds(doc_no);
CREATE INDEX IF NOT EXISTS idx_ipqc_round_line    ON ipqc_rounds(production_line_id);
CREATE INDEX IF NOT EXISTS idx_ipqc_round_status  ON ipqc_rounds(status);

-- รายการของเสียต่อ IPQC round
CREATE TABLE IF NOT EXISTS ipqc_round_defects (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id       INTEGER NOT NULL REFERENCES ipqc_rounds(id) ON DELETE RESTRICT,
  defect_type_id INTEGER REFERENCES defect_types(id) ON DELETE SET NULL,
  qty            INTEGER NOT NULL DEFAULT 0,
  severity       TEXT NOT NULL DEFAULT 'minor'  -- major|minor
);
CREATE INDEX IF NOT EXISTS idx_ipqc_round_def ON ipqc_round_defects(round_id);

-- FGQC records — ผลตรวจสอบงาน FG (AQL หรือ 100%)
CREATE TABLE IF NOT EXISTS fgqc_records (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  record_no          TEXT NOT NULL UNIQUE,  -- FGQC-2026-0001
  doc_no             TEXT NOT NULL,
  pro_code_sap_id    INTEGER REFERENCES pro_code_sap(id) ON DELETE RESTRICT,
  production_line_id INTEGER REFERENCES production_lines(id) ON DELETE RESTRICT,
  shift_id           INTEGER REFERENCES shifts(id) ON DELETE SET NULL,
  inspect_date       DATE NOT NULL,

  -- เงื่อนไขการตรวจ
  producer_type      TEXT NOT NULL DEFAULT 'window_asia',  -- window_asia|kono
  job_type           TEXT NOT NULL DEFAULT 'standard',      -- standard|special_door|showroom|custom_cut|diy
  inspection_mode    TEXT NOT NULL DEFAULT 'aql',           -- aql|full_100pct

  -- AQL basis
  lot_qty            INTEGER NOT NULL DEFAULT 0,
  aql_sample_qty     INTEGER,
  accept_criteria    INTEGER,
  reject_criteria    INTEGER,

  -- ผลตรวจ
  inspect_qty        INTEGER NOT NULL DEFAULT 0,
  pass_qty           INTEGER DEFAULT 0,
  defect_qty         INTEGER DEFAULT 0,
  defect_rate        REAL DEFAULT 0,
  result             TEXT DEFAULT 'pass',  -- pass|fail
  status             TEXT DEFAULT 'open',  -- open|completed|closed

  remarks            TEXT,
  created_by         INTEGER REFERENCES users(id),
  created_at         TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fgqc_date    ON fgqc_records(inspect_date);
CREATE INDEX IF NOT EXISTS idx_fgqc_docno   ON fgqc_records(doc_no);
CREATE INDEX IF NOT EXISTS idx_fgqc_line    ON fgqc_records(production_line_id);
CREATE INDEX IF NOT EXISTS idx_fgqc_result  ON fgqc_records(result);
CREATE INDEX IF NOT EXISTS idx_fgqc_status  ON fgqc_records(status);

-- รายการของเสียแยกประเภทต่อ FGQC record
CREATE TABLE IF NOT EXISTS fgqc_defect_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  fgqc_id        INTEGER NOT NULL REFERENCES fgqc_records(id) ON DELETE RESTRICT,
  defect_type_id INTEGER REFERENCES defect_types(id) ON DELETE SET NULL,
  qty            INTEGER NOT NULL DEFAULT 0,
  severity       TEXT NOT NULL DEFAULT 'minor',  -- major|minor
  notes          TEXT
);
CREATE INDEX IF NOT EXISTS idx_fgqc_def_items ON fgqc_defect_items(fgqc_id);

-- รูปภาพ + annotation data — ใช้ร่วมกัน FGQC / IPQC round / IPNCR / IPNCP
CREATE TABLE IF NOT EXISTS qc_images (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ref_type        TEXT NOT NULL,  -- fgqc|ipqc_round|ipncr|ipncp
  ref_id          INTEGER NOT NULL,
  filename        TEXT NOT NULL,
  original_name   TEXT,
  annotation_data TEXT,           -- JSON: fabric.js canvas state
  created_by      INTEGER REFERENCES users(id),
  created_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_qc_images_ref ON qc_images(ref_type, ref_id);

-- IPNCR — Major defect: สั่ง Recheck/Rework 100%
CREATE TABLE IF NOT EXISTS ipncr_records (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  record_no            TEXT NOT NULL UNIQUE,  -- IPNCR-2026-0001
  source_type          TEXT NOT NULL,          -- fgqc|ipqc_round
  source_id            INTEGER NOT NULL,
  doc_no               TEXT NOT NULL,
  pro_code_sap_id      INTEGER REFERENCES pro_code_sap(id) ON DELETE RESTRICT,
  production_line_id   INTEGER REFERENCES production_lines(id) ON DELETE RESTRICT,

  defect_description   TEXT,
  total_qty_affected   INTEGER NOT NULL DEFAULT 0,
  action_required      TEXT NOT NULL DEFAULT 'recheck_100pct',  -- recheck_100pct|rework|scrap
  deadline             DATE,
  root_cause           TEXT,
  corrective_action    TEXT,

  -- Status flow
  status               TEXT NOT NULL DEFAULT 'open',
  -- open → prod_acknowledged → rechecking → completed → qc_verified → closed

  -- ผล recheck
  recheck_date         DATE,
  recheck_pass_qty     INTEGER,
  recheck_fail_qty     INTEGER,
  recheck_scrap_qty    INTEGER,
  recheck_remarks      TEXT,

  -- Approvals
  prod_acknowledged_by INTEGER REFERENCES users(id),
  prod_acknowledged_at TEXT,
  completed_by         INTEGER REFERENCES users(id),
  completed_at         TEXT,
  verified_by          INTEGER REFERENCES users(id),
  verified_at          TEXT,
  closed_by            INTEGER REFERENCES users(id),
  closed_at            TEXT,

  created_by           INTEGER REFERENCES users(id),
  created_at           TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ipncr_docno  ON ipncr_records(doc_no);
CREATE INDEX IF NOT EXISTS idx_ipncr_status ON ipncr_records(status);
CREATE INDEX IF NOT EXISTS idx_ipncr_line   ON ipncr_records(production_line_id);

-- IPNCP — Minor defect: ส่งกลับสถานีแก้ไข
CREATE TABLE IF NOT EXISTS ipncp_records (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  record_no             TEXT NOT NULL UNIQUE,  -- IPNCP-2026-0001
  source_type           TEXT NOT NULL,          -- fgqc|ipqc_round
  source_id             INTEGER NOT NULL,
  doc_no                TEXT NOT NULL,
  pro_code_sap_id       INTEGER REFERENCES pro_code_sap(id) ON DELETE RESTRICT,
  production_line_id    INTEGER REFERENCES production_lines(id) ON DELETE RESTRICT,

  defect_description    TEXT,
  qty_returned          INTEGER NOT NULL DEFAULT 0,
  return_station_id     INTEGER REFERENCES return_stations(id) ON DELETE SET NULL,
  correction_detail     TEXT,
  deadline              DATE,

  -- Status flow
  status                TEXT NOT NULL DEFAULT 'open',
  -- open → prod_acknowledged → correcting → correction_done → qc_accepted → closed

  corrected_qty         INTEGER,
  remaining_defect_qty  INTEGER,
  correction_remarks    TEXT,

  prod_acknowledged_by  INTEGER REFERENCES users(id),
  prod_acknowledged_at  TEXT,
  correction_done_by    INTEGER REFERENCES users(id),
  correction_done_at    TEXT,
  accepted_by           INTEGER REFERENCES users(id),
  accepted_at           TEXT,
  closed_by             INTEGER REFERENCES users(id),
  closed_at             TEXT,

  created_by            INTEGER REFERENCES users(id),
  created_at            TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ipncp_docno  ON ipncp_records(doc_no);
CREATE INDEX IF NOT EXISTS idx_ipncp_status ON ipncp_records(status);
CREATE INDEX IF NOT EXISTS idx_ipncp_line   ON ipncp_records(production_line_id);

-- ===== IPQC CHECK SHEET MASTER =====

-- สถานี IPQC (5 stations เริ่มต้น: cutting|frame|door|screen|final_test)
CREATE TABLE IF NOT EXISTS ipqc_stations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  code       TEXT NOT NULL UNIQUE,
  sort_order INTEGER DEFAULT 0,
  is_active  INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Template check sheet ต่อ station (+ optional per production_line)
CREATE TABLE IF NOT EXISTS ipqc_check_templates (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id         INTEGER NOT NULL REFERENCES ipqc_stations(id) ON DELETE RESTRICT,
  production_line_id INTEGER REFERENCES production_lines(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  is_active          INTEGER DEFAULT 1,
  created_by         INTEGER REFERENCES users(id),
  created_at         TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ipqc_tmpl_station ON ipqc_check_templates(station_id);
CREATE INDEX IF NOT EXISTS idx_ipqc_tmpl_line    ON ipqc_check_templates(production_line_id);

-- หัวข้อตรวจในแต่ละ template
CREATE TABLE IF NOT EXISTS ipqc_check_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id  INTEGER NOT NULL REFERENCES ipqc_check_templates(id) ON DELETE CASCADE,
  item_no      INTEGER NOT NULL,
  item_name    TEXT NOT NULL,
  check_type   TEXT DEFAULT 'dimension',   -- dimension|visual|functional
  std_value    REAL,
  tol_plus     REAL DEFAULT 0,
  tol_minus    REAL DEFAULT 0,
  unit         TEXT DEFAULT 'mm',
  input_type   TEXT DEFAULT 'number',      -- number|pass_fail|text
  sample_count INTEGER DEFAULT 1,
  is_required  INTEGER DEFAULT 1,
  sort_order   INTEGER DEFAULT 0,
  is_active    INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_ipqc_citems_tmpl ON ipqc_check_items(template_id);

-- ===== IPQC INSPECTION RECORDS =====

-- บันทึกการตรวจ 1 รอบ (ทุก 2 ชม.) ต่อ Station ต่อ PO
CREATE TABLE IF NOT EXISTS ipqc_inspections (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  record_no          TEXT NOT NULL UNIQUE,  -- IPQC-2026-0001
  inspect_date       DATE NOT NULL,
  inspect_time       TEXT NOT NULL,         -- '08:00'
  station_id         INTEGER NOT NULL REFERENCES ipqc_stations(id),
  production_line_id INTEGER REFERENCES production_lines(id),
  shift_id           INTEGER REFERENCES shifts(id),
  doc_no             TEXT NOT NULL,
  pro_code_sap_id    INTEGER REFERENCES pro_code_sap(id),
  pd_plan_id         INTEGER REFERENCES pd_plans(id),
  template_id        INTEGER REFERENCES ipqc_check_templates(id),
  lot_qty            INTEGER,
  sample_qty         INTEGER,
  accept_criteria    INTEGER,
  reject_criteria    INTEGER,
  overall_result     TEXT DEFAULT 'pending',  -- pending|pass|fail
  status             TEXT DEFAULT 'draft',    -- draft|completed
  remarks            TEXT,
  created_by         INTEGER REFERENCES users(id),
  created_at         TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ipqc_insp_date    ON ipqc_inspections(inspect_date);
CREATE INDEX IF NOT EXISTS idx_ipqc_insp_station ON ipqc_inspections(station_id);
CREATE INDEX IF NOT EXISTS idx_ipqc_insp_line    ON ipqc_inspections(production_line_id);
CREATE INDEX IF NOT EXISTS idx_ipqc_insp_docno   ON ipqc_inspections(doc_no);
CREATE INDEX IF NOT EXISTS idx_ipqc_insp_result  ON ipqc_inspections(overall_result);

-- ผลตรวจแต่ละหัวข้อในรอบนั้น
CREATE TABLE IF NOT EXISTS ipqc_inspection_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_id INTEGER NOT NULL REFERENCES ipqc_inspections(id) ON DELETE CASCADE,
  check_item_id INTEGER NOT NULL REFERENCES ipqc_check_items(id),
  measured_values TEXT,         -- JSON array [240.1, 239.8, ...] สำหรับ number multi-sample
  measured_value  REAL,         -- ค่าเดียว (sample_count=1)
  pass_fail_value INTEGER,      -- 1=pass, 0=fail สำหรับ pass_fail type
  text_value      TEXT,
  result          TEXT DEFAULT 'pending',  -- pass|fail|pending
  fail_count      INTEGER DEFAULT 0,
  remarks         TEXT
);
CREATE INDEX IF NOT EXISTS idx_ipqc_items_insp ON ipqc_inspection_items(inspection_id);

-- รูปภาพประกอบการตรวจ (linked to inspection, optional link to check_item)
CREATE TABLE IF NOT EXISTS ipqc_inspection_images (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_id INTEGER NOT NULL REFERENCES ipqc_inspections(id) ON DELETE CASCADE,
  check_item_id INTEGER REFERENCES ipqc_check_items(id),
  filename      TEXT NOT NULL,
  original_name TEXT,
  sort_order    INTEGER DEFAULT 0,
  created_at    TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ipqc_imgs_insp ON ipqc_inspection_images(inspection_id);

-- ===== IPNCR RECHECK HISTORY =====

-- ประวัติการ recheck แต่ละครั้ง (ครั้งที่ 1, 2, 3...)
CREATE TABLE IF NOT EXISTS ipncr_recheck_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ipncr_id      INTEGER NOT NULL REFERENCES ipncr_records(id) ON DELETE CASCADE,
  attempt       INTEGER NOT NULL,   -- 1, 2, 3...
  action        TEXT NOT NULL,      -- recheck_submitted|qc_pass|qc_fail
  qty_rechecked INTEGER,
  qty_pass      INTEGER,
  qty_fail      INTEGER,
  qty_scrap     INTEGER,
  remarks       TEXT,
  created_by    INTEGER REFERENCES users(id),
  created_at    TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ipncr_recheck_log ON ipncr_recheck_logs(ipncr_id);

-- =====================================================================
-- FG DEFECT + FNCP MODULE — บันทึกยอดผลิต/ของเสีย FG + FNCP
-- Added 2026-06-29
-- =====================================================================

-- Master: กลุ่มอาการเสีย FG (ด้านขนาด, ด้านสี, ด้านผิว, ...)
CREATE TABLE IF NOT EXISTS fg_defect_groups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  is_active  INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Master: อาการเสียรายการ (ขึ้นกับ group)
CREATE TABLE IF NOT EXISTS fg_defect_types (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  defect_group_id  INTEGER NOT NULL REFERENCES fg_defect_groups(id) ON DELETE RESTRICT,
  code             TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  severity_default TEXT DEFAULT 'minor' CHECK(severity_default IN ('minor','major','critical')),
  sort_order       INTEGER DEFAULT 0,
  is_active        INTEGER DEFAULT 1,
  created_at       TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fg_defect_types_group ON fg_defect_types(defect_group_id);

-- Master: ส่วนงานที่พบของเสีย (ส่วนงานตัด, ส่วนงานประกอบบาน, ...)
CREATE TABLE IF NOT EXISTS fg_process_areas (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  is_active  INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- บันทึกของเสีย FG (detailed defect record)
CREATE TABLE IF NOT EXISTS fg_defect_records (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  record_no          TEXT NOT NULL UNIQUE,          -- FDR-2026-0001
  found_date         DATE NOT NULL,
  found_time         TEXT,                           -- 'HH:MM'
  shift_id           INTEGER REFERENCES shifts(id) ON DELETE SET NULL,
  doc_no             TEXT,
  pro_code_sap_id    INTEGER REFERENCES pro_code_sap(id) ON DELETE RESTRICT,
  production_line_id INTEGER REFERENCES production_lines(id) ON DELETE RESTRICT,
  lot_no             TEXT,
  machine_no         TEXT,
  line_leader        TEXT,
  defect_group_id    INTEGER REFERENCES fg_defect_groups(id) ON DELETE SET NULL,
  defect_type_id     INTEGER REFERENCES fg_defect_types(id) ON DELETE SET NULL,
  process_area_id    INTEGER REFERENCES fg_process_areas(id) ON DELETE SET NULL,
  defect_qty         INTEGER NOT NULL DEFAULT 0,
  defect_unit        TEXT DEFAULT 'pcs' CHECK(defect_unit IN ('pcs','set','unit','frame','sash')),
  severity           TEXT DEFAULT 'minor' CHECK(severity IN ('minor','major','critical')),
  initial_cause      TEXT,                           -- สาเหตุเบื้องต้น
  root_cause         TEXT,
  corrective_action  TEXT,
  preventive_action  TEXT,
  pic_user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  due_date           DATE,
  status             TEXT DEFAULT 'open' CHECK(status IN ('open','fncp_generated','closed')),
  created_by         INTEGER REFERENCES users(id),
  created_at         TEXT DEFAULT (datetime('now')),
  updated_at         TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fg_defect_date    ON fg_defect_records(found_date);
CREATE INDEX IF NOT EXISTS idx_fg_defect_docno   ON fg_defect_records(doc_no);
CREATE INDEX IF NOT EXISTS idx_fg_defect_line    ON fg_defect_records(production_line_id);
CREATE INDEX IF NOT EXISTS idx_fg_defect_status  ON fg_defect_records(status);
CREATE INDEX IF NOT EXISTS idx_fg_defect_severity ON fg_defect_records(severity);

-- รูปภาพประกอบการบันทึกของเสีย FG
CREATE TABLE IF NOT EXISTS fg_defect_images (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  defect_record_id INTEGER NOT NULL REFERENCES fg_defect_records(id) ON DELETE CASCADE,
  filename         TEXT NOT NULL,
  original_name    TEXT,
  sort_order       INTEGER DEFAULT 0,
  created_at       TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fg_defect_images_rec ON fg_defect_images(defect_record_id);

-- เอกสาร FNCP (Finished Non-Conformance Product)
CREATE TABLE IF NOT EXISTS fg_fncp (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  fncp_no             TEXT NOT NULL UNIQUE,          -- FNCP-2026-0001
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
  correction          TEXT,                          -- การแก้ไขเฉพาะหน้า
  corrective_action   TEXT,
  preventive_action   TEXT,
  pic_user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  due_date            DATE,
  verification_result TEXT,
  close_date          DATE,
  reject_reason       TEXT,
  status              TEXT NOT NULL DEFAULT 'open'
    CHECK(status IN ('open','in_progress','waiting_verify','supervisor_approved','verified','closed','reject','fuai_opened')),
  -- Public production response token
  prod_token          TEXT,
  prod_token_expires_at TEXT,
  respondent_name     TEXT,
  -- Approval timestamps
  opened_by           INTEGER REFERENCES users(id),
  opened_at           TEXT DEFAULT (datetime('now')),
  in_progress_by      INTEGER REFERENCES users(id),
  in_progress_at      TEXT,
  submit_verify_by    INTEGER REFERENCES users(id),
  submit_verify_at    TEXT,
  supervisor_approved_by INTEGER REFERENCES users(id),
  supervisor_approved_at TEXT,
  manager_approved_by INTEGER REFERENCES users(id),
  manager_approved_at TEXT,
  verified_by         INTEGER REFERENCES users(id),
  verified_at         TEXT,
  rejected_by         INTEGER REFERENCES users(id),
  rejected_at         TEXT,
  closed_by           INTEGER REFERENCES users(id),
  closed_at           TEXT,
  created_by          INTEGER REFERENCES users(id),
  created_at          TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fg_fncp_docno   ON fg_fncp(doc_no);
CREATE INDEX IF NOT EXISTS idx_fg_fncp_status  ON fg_fncp(status);
CREATE INDEX IF NOT EXISTS idx_fg_fncp_line    ON fg_fncp(production_line_id);
CREATE INDEX IF NOT EXISTS idx_fg_fncp_due     ON fg_fncp(due_date);
CREATE INDEX IF NOT EXISTS idx_fg_fncp_defect  ON fg_fncp(defect_record_id);

-- Timeline events ของแต่ละ FNCP
CREATE TABLE IF NOT EXISTS fg_fncp_timeline (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  fncp_id    INTEGER NOT NULL REFERENCES fg_fncp(id) ON DELETE CASCADE,
  action     TEXT NOT NULL,   -- create|start|submit_verify|verify|close|reject|comment
  comment    TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fg_fncp_timeline ON fg_fncp_timeline(fncp_id);

-- รูปภาพการแก้ไขจากฝ่ายผลิต (ตอบผ่าน public link)
CREATE TABLE IF NOT EXISTS fg_fncp_fix_images (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  fncp_id       INTEGER NOT NULL REFERENCES fg_fncp(id) ON DELETE CASCADE,
  filename      TEXT NOT NULL,
  original_name TEXT,
  sort_order    INTEGER DEFAULT 0,
  created_at    TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fg_fncp_fix_img ON fg_fncp_fix_images(fncp_id);
CREATE INDEX IF NOT EXISTS idx_fg_fncp_token   ON fg_fncp(prod_token);

-- =====================================================================
-- FG FM CATEGORY + FUAI + MATERIAL DEFECT MODULE — Added 2026-06-30
-- =====================================================================

-- FM Category สำหรับ FG Production (5M+E: Material/Machine/Method/Man/Measure/Environment)
-- แยกจาก fm_categories (ที่ใช้กับ IPQC/FQC) โดยเจตนา
CREATE TABLE IF NOT EXISTS fg_fm_categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  is_material INTEGER DEFAULT 0,   -- 1 = trigger material defect escalation to รับเข้า station
  sort_order INTEGER DEFAULT 0,
  is_active  INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- FUAI — ขออนุมัติใช้พิเศษ (Finished Goods Use-As-Is Approval)
-- สร้างจาก FNCPResponse.jsx โดย production เมื่อของเสีย severity=critical
CREATE TABLE IF NOT EXISTS fg_fuai (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fuai_no TEXT NOT NULL UNIQUE,
  fncp_id INTEGER NOT NULL REFERENCES fg_fncp(id) ON DELETE RESTRICT,
  production_line_id INTEGER REFERENCES production_lines(id),
  pro_code_sap_id INTEGER REFERENCES pro_code_sap(id),
  defect_qty INTEGER DEFAULT 0,
  defect_unit TEXT DEFAULT 'pcs',
  severity TEXT DEFAULT 'critical',
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending_prod_manager'
    CHECK(status IN ('pending_prod_manager','pending_cpo','pending_qc_manager',
                     'pending_qc_staff_ack','pending_qc_supervisor_ack','closed','rejected')),
  prod_manager_approved_by INTEGER REFERENCES users(id),
  prod_manager_approved_at TEXT,
  prod_manager_remarks TEXT,
  cpo_approved_by INTEGER REFERENCES users(id),
  cpo_approved_at TEXT,
  cpo_remarks TEXT,
  cpo_rejected_at TEXT,
  cpo_reject_reason TEXT,
  qc_manager_approved_by INTEGER REFERENCES users(id),
  qc_manager_approved_at TEXT,
  qc_manager_remarks TEXT,
  qc_manager_rejected_at TEXT,
  qc_manager_reject_reason TEXT,
  qc_staff_ack_by INTEGER REFERENCES users(id),
  qc_staff_ack_at TEXT,
  qc_supervisor_ack_by INTEGER REFERENCES users(id),
  qc_supervisor_ack_at TEXT,
  rejected_at TEXT,
  reject_reason TEXT,
  closed_at TEXT,
  opened_by TEXT NOT NULL,          -- respondent_name จาก public form
  opened_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fg_fuai_fncp   ON fg_fuai(fncp_id);
CREATE INDEX IF NOT EXISTS idx_fg_fuai_status ON fg_fuai(status);
CREATE INDEX IF NOT EXISTS idx_fg_fuai_line   ON fg_fuai(production_line_id);

-- FUAI Timeline
CREATE TABLE IF NOT EXISTS fg_fuai_timeline (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fuai_id INTEGER NOT NULL REFERENCES fg_fuai(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  comment TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fg_fuai_tl ON fg_fuai_timeline(fuai_id);

-- Material Defect Acknowledgment — qc_staff ที่ qc_station='รับเข้า' รับทราบ
CREATE TABLE IF NOT EXISTS fg_material_defects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fncp_id INTEGER NOT NULL REFERENCES fg_fncp(id) ON DELETE RESTRICT,
  defect_record_id INTEGER REFERENCES fg_defect_records(id),
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','acknowledged')),
  product_name TEXT,
  lot_number TEXT,
  lot_bill_id INTEGER REFERENCES bills(id),
  supplier_name TEXT,
  defect_type_noted TEXT,
  qty_found INTEGER DEFAULT 0,
  remarks TEXT,
  images TEXT,                      -- JSON array of filenames
  acknowledge_by INTEGER REFERENCES users(id),
  acknowledge_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fg_matdef_fncp   ON fg_material_defects(fncp_id);
CREATE INDEX IF NOT EXISTS idx_fg_matdef_status ON fg_material_defects(status);
