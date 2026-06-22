/**
 * fix-fk.js — repair broken ncrs_old FK references left by migrateNcrStatusConstraint
 * Usage: node fix-fk.js (from iqc-system directory)
 */
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../iqc.db');
const db = new Database(DB_PATH);

// Check if there are broken references
const broken = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND sql LIKE '%ncrs_old%'").all();
if (broken.length === 0) {
  console.log('No broken FK references found. Nothing to fix.');
  db.close();
  process.exit(0);
}

console.log(`Found ${broken.length} table(s) with broken ncrs_old FK:`, broken.map(r => r.name).join(', '));

// Use writable_schema to fix the FK references directly in sqlite_master
db.pragma('writable_schema = ON');
db.exec("UPDATE sqlite_master SET sql = REPLACE(sql, '\"ncrs_old\"', 'ncrs') WHERE sql LIKE '%ncrs_old%' AND type IN ('table','index','trigger','view')");
db.pragma('writable_schema = OFF');
console.log('Fixed broken ncrs_old FK references in sqlite_master');

// Verify integrity
const integ = db.pragma('integrity_check');
console.log('Integrity check:', integ[0]?.integrity_check || JSON.stringify(integ));

db.close();
console.log('Done. Restart server to pick up schema changes.');
