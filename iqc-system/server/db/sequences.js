// ===== ATOMIC SEQUENCE GENERATION (race-condition safe) =====
// แยกจาก database.js ตาม CLAUDE.md §8 — attach helpers ให้ db object ผ่าน factory pattern
// กฎ (CLAUDE.md §2.3): ห้ามใช้ SELECT MAX/COUNT — ใช้ UPDATE ... RETURNING (atomic) เท่านั้น
//
// การใช้งาน: require('./sequences')(db)  → ผูก db.nextNCRCode() ... db.nextFUAICode()

module.exports = function attachSequences(db) {
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
  db.nextKPICode = () => nextSequence('KPI');
  db.nextIPQCCode = () => nextSequence('IPQC');
  db.nextFQCCode = () => nextSequence('FQC');
  db.nextFGQCCode = () => nextSequence('FGQC');
  db.nextIPNCRCode = () => nextSequence('IPNCR');
  db.nextIPNCPCode = () => nextSequence('IPNCP');
  db.nextFNCPCode  = () => nextSequence('FNCP');
  db.nextFDRCode   = () => nextSequence('FDR');
  db.nextFUAICode  = () => nextSequence('FUAI');
};
