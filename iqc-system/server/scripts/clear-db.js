/**
 * clear-db.js — เคลียร์ข้อมูลทั้งหมดและ re-seed ค่าเริ่มต้น
 * ใช้งาน: node server/scripts/clear-db.js
 *         node server/scripts/clear-db.js --confirm  (ข้าม prompt)
 */

const readline = require('readline');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, '../../iqc.db');

const TABLES_ORDERED = [
  // ลบจาก child → parent ตาม FK
  'audit_logs',
  'notifications',
  'password_reset_logs',
  'delivery_schedule_attachments',
  'delivery_schedule_items',
  'delivery_schedules',
  'uai_signatures',
  'uai_documents',
  'supplier_response_attachments',
  'supplier_responses',
  're_inspection_images',
  're_inspections',
  'ncr_approvals',
  'ncr_images',
  'ncr_items',
  'ncrs',
  'bill_item_equipment',
  'bill_item_certificates',
  'bill_item_inspection_docs',
  'bill_item_images',
  'bill_items',
  'bill_images',
  'bills',
  'supplier_risks',
  'supplier_evaluations',
  'supplier_approval_history',
  'product_drawings',
  'product_images',
  'product_colors',
  'products',
  'measuring_equipment',
  'aql_tables',
  'colors',
  'models',
  'defect_categories',
  'units',
  'product_groups',
  'suppliers',
  'users',
  'document_sequences',
  'settings',
];

async function main() {
  const skipConfirm = process.argv.includes('--confirm');

  if (!skipConfirm) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await new Promise((resolve, reject) => {
      rl.question('⚠️  จะลบข้อมูลทั้งหมดใน DB และ re-seed ใหม่ พิมพ์ "YES" เพื่อยืนยัน: ', (ans) => {
        rl.close();
        if (ans.trim() !== 'YES') {
          console.log('ยกเลิก');
          process.exit(0);
        }
        resolve();
      });
    });
  }

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = OFF'); // ปิดชั่วคราวเพื่อลบได้โดยไม่ติด FK

  console.log('[clear-db] เริ่มเคลียร์ข้อมูล...');

  const clear = db.transaction(() => {
    for (const table of TABLES_ORDERED) {
      try {
        const result = db.prepare(`DELETE FROM ${table}`).run();
        if (result.changes > 0) {
          console.log(`  ✓ ${table}: ลบ ${result.changes} แถว`);
        }
      } catch (e) {
        // Table might not exist yet
        console.log(`  - ${table}: ข้าม (${e.message.slice(0, 60)})`);
      }
    }

    // Reset autoincrement counters
    try {
      db.prepare("DELETE FROM sqlite_sequence WHERE name NOT IN ('settings')").run();
    } catch {}
  });

  clear();

  db.pragma('foreign_keys = ON');

  // Re-seed sequences
  const year = new Date().getFullYear();
  db.prepare("INSERT OR REPLACE INTO document_sequences (doc_type, year, last_seq) VALUES ('NCR', ?, 0)").run(year);
  db.prepare("INSERT OR REPLACE INTO document_sequences (doc_type, year, last_seq) VALUES ('UAI', ?, 0)").run(year);
  console.log('[clear-db] Reset document sequences');

  // Re-seed settings
  const defaults = {
    telegram_bot_token: '',
    telegram_group_qc: '',
    telegram_group_purchasing: '',
    app_url: 'http://localhost:5173',
    token_expiry_days: '90',
  };
  for (const [key, value] of Object.entries(defaults)) {
    db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").run(key, value);
  }
  console.log('[clear-db] Re-seed settings');

  // Re-seed default users (password: admin1234)
  const hash = bcrypt.hashSync('admin1234', 12);
  const users = [
    ['admin',       'admin',              'ผู้ดูแลระบบ'],
    ['qc_staff1',   'qc_staff',           'สมชาย QC'],
    ['supervisor1', 'qc_supervisor',      'วิไล หัวหน้า QC'],
    ['manager1',    'qc_manager',         'ประยุทธ ผู้จัดการ QC'],
    ['qmr1',        'qmr',                'สุรชัย QMR'],
    ['purchasing1', 'purchasing',         'นภา จัดซื้อ'],
    ['cco1',        'cco',                'วิชัย CCO'],
    ['cmo1',        'cmo',                'สมหญิง CMO'],
    ['cpo1',        'cpo',                'ประเสริฐ CPO'],
    ['production1', 'production_manager', 'สมศักดิ์ ผจก.ผลิต'],
  ];
  const insUser = db.prepare('INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)');
  for (const [username, role, full_name] of users) {
    insUser.run(username, hash, full_name, role);
  }
  console.log('[clear-db] Re-seed users (default password: admin1234 — เปลี่ยนทันทีหลัง login)');

  db.close();
  console.log('[clear-db] เสร็จแล้ว!');
}

main().catch(e => { console.error(e); process.exit(1); });
