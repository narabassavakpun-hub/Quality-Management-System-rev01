-- ===== USERS =====
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN (
    'admin','qc_staff','qc_supervisor','qc_manager',
    'qmr','purchasing','cco','cmo','cpo','production_manager'
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
  late_reason TEXT,
  rescheduled_date DATE,
  acknowledged_at DATETIME,
  acknowledged_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
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
