#!/usr/bin/env node
/**
 * clear-data.js — เครื่องมือเคลียร์ข้อมูลทดสอบ IQC System
 *
 * วิธีใช้:
 *   node scripts/clear-data.js <module>
 *
 *   bills          ใบรับสินค้า + รายการตรวจ
 *   ncr            NCR ทั้งหมด (+ re-inspection, supplier response)
 *   uai            UAI ทั้งหมด
 *   delivery       ตารางส่งสินค้า
 *   ipqc           IPQC records
 *   fqc            FQC records
 *   pdplan         แผนการผลิต (PDPlan)
 *   procode        ProCodeSAP + cache + rules
 *   kpi            KPI ทั้งหมด
 *   issue-talk     Issue Talk
 *   notifications  การแจ้งเตือน
 *   audit          Audit Logs
 *   master-iqc     Master Data IQC (สินค้า, ผู้จัดจำหน่าย ฯลฯ)
 *   prod-master    Production Master (สายผลิต, FM, Process Step ฯลฯ)
 *   attendance     QC Attendance
 *   all            *** เคลียร์ทั้งหมด (ยกเว้น users + settings) ***
 */

const path      = require('path');
const readline  = require('readline');
const Database  = require('better-sqlite3');

const DB_PATH = process.env.IQC_DB_PATH || path.join(__dirname, '../../iqc.db');

// ─── Helpers ────────────────────────────────────────────────────────────────

function openDb() {
  if (!require('fs').existsSync(DB_PATH)) {
    console.error(`❌ ไม่พบไฟล์ Database: ${DB_PATH}`);
    process.exit(1);
  }
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = OFF');   // ปิดเพื่อลบข้ามตารางได้
  return db;
}

function closeDb(db) {
  db.pragma('foreign_keys = ON');
  db.close();
}

function confirm(msg) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`\n⚠️  ${msg}\n   พิมพ์ YES (พิมพ์ใหญ่ทั้งหมด) เพื่อยืนยัน: `, ans => {
      rl.close();
      resolve(ans.trim() === 'YES');
    });
  });
}

function run(db, tables) {
  const result = {};
  db.transaction(() => {
    for (const t of tables) {
      try {
        result[t] = db.prepare(`DELETE FROM ${t}`).run().changes;
      } catch (e) {
        result[t] = `ERROR: ${e.message}`;
      }
    }
  })();
  return result;
}

function printResult(result) {
  for (const [t, c] of Object.entries(result)) {
    if (typeof c === 'number' && c > 0) console.log(`   ✓ ${t}: ลบ ${c} แถว`);
    else if (typeof c === 'string')     console.log(`   ⚠ ${t}: ${c}`);
  }
}

function resetSeq(db, ...types) {
  const year = new Date().getFullYear();
  for (const t of types) {
    db.prepare('UPDATE document_sequences SET last_seq=0, year=? WHERE doc_type=?').run(year, t);
  }
}

function resetAutoInc(db, ...tables) {
  for (const t of tables) {
    try { db.prepare(`DELETE FROM sqlite_sequence WHERE name=?`).run(t); } catch (_) {}
  }
}

// ─── Module Functions ────────────────────────────────────────────────────────

function clearBills(db) {
  console.log('\n🗑️  เคลียร์ข้อมูล Bills (ใบรับสินค้า)...');
  const r = run(db, [
    'bill_item_equipment',
    'bill_item_certificates',
    'bill_item_inspection_docs',
    'bill_item_images',
    'bill_items',
    'bill_images',
    'bills',
  ]);
  resetAutoInc(db, 'bills', 'bill_items', 'bill_images', 'bill_item_images',
    'bill_item_inspection_docs', 'bill_item_certificates');
  printResult(r);
  console.log('✅ Bills เคลียร์เรียบร้อย');
  console.log('ℹ️  ไฟล์รูปใน /uploads/bills ยังคงอยู่ — ลบเองถ้าต้องการ');
}

function clearNcr(db) {
  console.log('\n🗑️  เคลียร์ข้อมูล NCR...');
  const r = run(db, [
    're_inspection_images',
    're_inspections',
    'supplier_response_attachments',
    'supplier_responses',
    'ncr_approvals',
    'ncr_images',
    'ncr_items',
    'ncrs',
  ]);
  resetSeq(db, 'NCR');
  resetAutoInc(db, 'ncrs', 'ncr_items', 'ncr_images', 'ncr_approvals',
    'supplier_responses', 'supplier_response_attachments',
    're_inspections', 're_inspection_images');
  printResult(r);
  console.log('✅ NCR เคลียร์เรียบร้อย (Sequence NCR รีเซ็ตแล้ว)');
}

function clearUai(db) {
  console.log('\n🗑️  เคลียร์ข้อมูล UAI...');
  const r = run(db, ['uai_images', 'uai_signatures', 'uai_documents']);
  resetSeq(db, 'UAI');
  resetAutoInc(db, 'uai_documents', 'uai_signatures', 'uai_images');
  printResult(r);
  console.log('✅ UAI เคลียร์เรียบร้อย (Sequence UAI รีเซ็ตแล้ว)');
}

function clearDelivery(db) {
  console.log('\n🗑️  เคลียร์ข้อมูล Delivery Schedule...');
  const r = run(db, [
    'delivery_schedule_attachments',
    'delivery_schedule_items',
    'delivery_schedules',
  ]);
  resetAutoInc(db, 'delivery_schedules', 'delivery_schedule_items', 'delivery_schedule_attachments');
  printResult(r);
  console.log('✅ Delivery เคลียร์เรียบร้อย');
}

function clearIpqc(db) {
  console.log('\n🗑️  เคลียร์ข้อมูล IPQC...');
  const r = run(db, ['ipqc_images', 'ipqc_records']);
  resetSeq(db, 'IPQC');
  resetAutoInc(db, 'ipqc_records', 'ipqc_images');
  printResult(r);
  console.log('✅ IPQC เคลียร์เรียบร้อย (Sequence IPQC รีเซ็ตแล้ว)');
  console.log('ℹ️  ไฟล์รูปใน /uploads/ipqc ยังคงอยู่');
}

function clearPdplan(db) {
  console.log('\n🗑️  เคลียร์ข้อมูล PDPlan (แผนการผลิต)...');
  const r = run(db, ['pd_plans']);
  resetAutoInc(db, 'pd_plans');
  printResult(r);
  console.log('✅ PDPlan เคลียร์เรียบร้อย');
}

function clearProcode(db) {
  console.log('\n🗑️  เคลียร์ข้อมูล ProCodeSAP...');

  // ตรวจว่าตารางที่ FK ชี้มายัง pro_code_sap ว่างแล้วหรือยัง
  const checks = {
    ipqc_records: db.prepare('SELECT COUNT(*) AS c FROM ipqc_records').get().c,
    pd_plans:     db.prepare('SELECT COUNT(*) AS c FROM pd_plans').get().c,
  };
  const hasData = Object.entries(checks).filter(([, v]) => v > 0);
  if (hasData.length > 0) {
    console.log('⚠️  ยังมีข้อมูลที่อ้างอิง ProCodeSAP:');
    hasData.forEach(([t, c]) => console.log(`   ${t}: ${c} แถว`));
    console.log('   กรุณาเคลียร์ ipqc, pdplan ก่อน แล้วค่อยเคลียร์ procode');
    return false;
  }

  const r = run(db, [
    'sap_prediction_cache',
    'sap_master_lookup',
    'sap_parse_rules',
    'pro_code_sap',
  ]);
  resetAutoInc(db, 'pro_code_sap', 'sap_parse_rules');
  printResult(r);
  console.log('✅ ProCodeSAP เคลียร์เรียบร้อย');
  return true;
}

function clearKpi(db) {
  console.log('\n🗑️  เคลียร์ข้อมูล KPI...');
  const r = run(db, [
    'kpi_report_files',
    'kpi_report_entries',
    'kpi_approvals',
    'kpi_reports',
    'kpi_actuals',
    'kpi_action_plans',
    'kpi_targets',
    'kpi_items',
    'kpi_groups',
  ]);
  resetAutoInc(db, 'kpi_groups', 'kpi_items', 'kpi_targets', 'kpi_reports',
    'kpi_report_entries', 'kpi_report_files', 'kpi_approvals',
    'kpi_actuals', 'kpi_action_plans');
  printResult(r);
  console.log('✅ KPI เคลียร์เรียบร้อย');
}

function clearIssueTalk(db) {
  console.log('\n🗑️  เคลียร์ข้อมูล Issue Talk...');
  const r = run(db, [
    'issue_talk_reads',
    'issue_talk_attachments',
    'issue_talk_messages',
    'issue_talk_participants',
    'issue_talks',
  ]);
  resetAutoInc(db, 'issue_talks', 'issue_talk_participants',
    'issue_talk_messages', 'issue_talk_attachments', 'issue_talk_reads');
  printResult(r);
  console.log('✅ Issue Talk เคลียร์เรียบร้อย');
}

function clearNotifications(db) {
  console.log('\n🗑️  เคลียร์ Notifications...');
  const r = run(db, ['notifications']);
  resetAutoInc(db, 'notifications');
  printResult(r);
  console.log('✅ Notifications เคลียร์เรียบร้อย');
}

function clearAudit(db) {
  console.log('\n🗑️  เคลียร์ Audit Logs...');
  const r = run(db, ['audit_logs', 'password_reset_logs']);
  resetAutoInc(db, 'audit_logs', 'password_reset_logs');
  printResult(r);
  console.log('✅ Audit Logs เคลียร์เรียบร้อย');
}

function clearMasterIqc(db) {
  console.log('\n🗑️  เคลียร์ Master Data IQC (สินค้า/ผู้จัดจำหน่าย/etc.)...');
  console.log('ℹ️  ควรเคลียร์ Bills, NCR, UAI ก่อน เพราะมี FK ชี้ไปที่ Master');
  const r = run(db, [
    'bill_item_equipment',     // FK → measuring_equipment
    'product_colors',
    'product_images',
    'product_drawings',
    'measuring_equipment',
    'supplier_evaluations',
    'supplier_risks',
    'supplier_approval_history',
    'products',
    'product_groups',
    'units',
    'colors',
    'models',
    'defect_categories',
    'aql_tables',
    'company_holidays',
    'suppliers',
  ]);
  resetAutoInc(db, 'suppliers', 'supplier_approval_history', 'supplier_evaluations',
    'supplier_risks', 'products', 'product_groups', 'units', 'colors', 'models',
    'defect_categories', 'measuring_equipment', 'product_images',
    'product_drawings', 'aql_tables', 'company_holidays');
  printResult(r);
  console.log('✅ Master Data IQC เคลียร์เรียบร้อย');
}

function clearProdMaster(db) {
  console.log('\n🗑️  เคลียร์ Production Master (สายผลิต, FM, etc.)...');
  console.log('ℹ️  ควรเคลียร์ IPQC, FQC, PDPlan, ProCodeSAP ก่อน');
  const r = run(db, [
    'defect_rate_thresholds',
    'production_line_managers',
    'process_steps',
    'defect_types',
    'fm_categories',
    'shifts',
    'production_lines',
  ]);
  resetAutoInc(db, 'production_lines', 'production_line_managers', 'fm_categories',
    'process_steps', 'defect_types', 'shifts', 'defect_rate_thresholds');
  printResult(r);
  console.log('✅ Production Master เคลียร์เรียบร้อย');
}

function clearAttendance(db) {
  console.log('\n🗑️  เคลียร์ QC Attendance...');
  const r = run(db, ['qc_attendance']);
  resetAutoInc(db, 'qc_attendance');
  printResult(r);
  console.log('✅ QC Attendance เคลียร์เรียบร้อย');
}

// ─── Clear ALL ───────────────────────────────────────────────────────────────

function clearAll(db) {
  console.log('\n🗑️  เคลียร์ข้อมูลทั้งหมด...');

  db.transaction(() => {
    const tables = [
      // IPQC Inspection (ระบบใหม่) + IPNCR
      'ipncr_recheck_logs',
      'ipncr_records',
      'ipqc_inspection_images',
      'ipqc_inspection_items',
      'ipqc_inspections',
      // IPQC (ระบบเก่า / legacy) — fqc_* ถูกลบออกจาก schema แล้ว (Session 104, ไม่เคยมี route จริง)
      'ipqc_images', 'ipqc_records',
      'pd_plans',
      // ProCode
      'sap_prediction_cache', 'sap_master_lookup', 'sap_parse_rules', 'pro_code_sap',
      // UAI
      'uai_images', 'uai_signatures', 'uai_documents',
      // NCR
      're_inspection_images', 're_inspections',
      'supplier_response_attachments', 'supplier_responses',
      'ncr_approvals', 'ncr_images', 'ncr_items', 'ncrs',
      // Bills
      'bill_item_equipment', 'bill_item_certificates',
      'bill_item_inspection_docs', 'bill_item_images',
      'bill_items', 'bill_images', 'bills',
      // Delivery
      'delivery_schedule_attachments', 'delivery_schedule_items', 'delivery_schedules',
      // KPI
      'kpi_report_files', 'kpi_report_entries', 'kpi_approvals', 'kpi_reports',
      'kpi_actuals', 'kpi_action_plans', 'kpi_targets', 'kpi_items', 'kpi_groups',
      // Issue Talk
      'issue_talk_reads', 'issue_talk_attachments',
      'issue_talk_messages', 'issue_talk_participants', 'issue_talks',
      // Others
      'qc_attendance', 'notifications', 'audit_logs', 'password_reset_logs',
      // Production Master
      'defect_rate_thresholds', 'production_line_managers',
      'process_steps', 'defect_types', 'fm_categories', 'shifts', 'production_lines',
      // IQC Master
      'product_colors', 'product_images', 'product_drawings',
      'measuring_equipment', 'supplier_evaluations', 'supplier_risks',
      'supplier_approval_history', 'products', 'product_groups',
      'units', 'colors', 'models', 'defect_categories',
      'aql_tables', 'company_holidays', 'suppliers',
    ];

    for (const t of tables) {
      try {
        const c = db.prepare(`DELETE FROM ${t}`).run().changes;
        if (c > 0) console.log(`   ✓ ${t}: ลบ ${c} แถว`);
      } catch (e) {
        console.log(`   ⚠ ${t}: ${e.message}`);
      }
    }

    // Reset document sequences
    const year = new Date().getFullYear();
    for (const t of ['NCR', 'UAI', 'IPQC', 'IPNCR', 'FGQC', 'IPNCP']) {
      db.prepare('UPDATE document_sequences SET last_seq=0, year=? WHERE doc_type=?').run(year, t);
    }

    // Reset AUTOINCREMENT counters (ยกเว้น users, settings, document_sequences)
    try {
      db.prepare(`
        DELETE FROM sqlite_sequence
        WHERE name NOT IN ('users','document_sequences','settings')
      `).run();
    } catch (_) {}

  })();

  // คืนพื้นที่หลังลบ
  console.log('\n   ⏳ VACUUM...');
  db.pragma('foreign_keys = ON');
  db.prepare('VACUUM').run();
  db.pragma('foreign_keys = OFF');

  console.log('\n✅ เคลียร์ข้อมูลทั้งหมดเรียบร้อย');
  console.log('ℹ️  สิ่งที่ยังคงอยู่: users, settings, document_sequences');
  console.log('ℹ️  ไฟล์ใน /uploads ยังคงอยู่ — ลบเองถ้าต้องการ\n');
}

// ─── Commands Map ────────────────────────────────────────────────────────────

const COMMANDS = {
  bills:         { fn: clearBills,        desc: 'ใบรับสินค้า + รายการตรวจ',             needConfirm: false },
  ncr:           { fn: clearNcr,          desc: 'NCR (+ re-inspection, supplier res.)', needConfirm: false },
  uai:           { fn: clearUai,          desc: 'UAI',                                   needConfirm: false },
  delivery:      { fn: clearDelivery,     desc: 'Delivery Schedule',                     needConfirm: false },
  ipqc:          { fn: clearIpqc,         desc: 'IPQC records',                          needConfirm: false },
  pdplan:        { fn: clearPdplan,       desc: 'PDPlan แผนการผลิต',                     needConfirm: false },
  procode:       { fn: clearProcode,      desc: 'ProCodeSAP + cache + rules',            needConfirm: false },
  kpi:           { fn: clearKpi,          desc: 'KPI ทั้งหมด',                           needConfirm: false },
  'issue-talk':  { fn: clearIssueTalk,    desc: 'Issue Talk',                            needConfirm: false },
  notifications: { fn: clearNotifications,desc: 'Notifications',                         needConfirm: false },
  audit:         { fn: clearAudit,        desc: 'Audit Logs',                            needConfirm: false },
  'master-iqc':  { fn: clearMasterIqc,    desc: 'Master Data IQC (สินค้า/ผู้จัดจำหน่าย)', needConfirm: true },
  'prod-master': { fn: clearProdMaster,   desc: 'Production Master (สายผลิต/FM/Process)', needConfirm: true },
  attendance:    { fn: clearAttendance,   desc: 'QC Attendance',                         needConfirm: false },
  all:           { fn: clearAll,          desc: '*** ทั้งหมด (ยกเว้น users + settings) ***', needConfirm: true },
};

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const cmd = process.argv[2];

  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║    IQC System — Clear Data Tool              ║');
  console.log('╚══════════════════════════════════════════════╝');

  if (!cmd || !COMMANDS[cmd]) {
    const scriptName = path.basename(process.argv[1]);
    console.log(`\nDB: ${DB_PATH}`);
    console.log(`\nวิธีใช้: node ${scriptName} <module>\n`);
    console.log('Module ที่ใช้ได้:');
    console.log('─'.repeat(56));
    for (const [k, v] of Object.entries(COMMANDS)) {
      const tag = v.needConfirm ? ' ⚠️ ' : '    ';
      console.log(`  ${tag}${k.padEnd(16)} ${v.desc}`);
    }
    console.log('─'.repeat(56));
    console.log('  ⚠️  = ต้องพิมพ์ YES ยืนยัน');
    console.log('');
    process.exit(0);
  }

  const { fn, desc, needConfirm } = COMMANDS[cmd];

  console.log(`\n  DB      : ${DB_PATH}`);
  console.log(`  Module  : ${cmd} — ${desc}`);

  if (needConfirm) {
    const ok = await confirm(`กำลังจะลบข้อมูล "${desc}" ทั้งหมด ไม่สามารถย้อนกลับได้!`);
    if (!ok) { console.log('\n  ยกเลิก\n'); process.exit(0); }
  }

  const db = openDb();
  try {
    fn(db);
  } catch (e) {
    console.error(`\n❌ เกิดข้อผิดพลาด: ${e.message}`);
    process.exit(1);
  } finally {
    closeDb(db);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
