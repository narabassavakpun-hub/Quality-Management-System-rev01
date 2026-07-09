// ===== ProCodeSAP auto-classifier =====
// Parses SAP product numbers into structured attributes.
//   Product No. = {Part1}-{Part2}-{Part3}
//   e.g. FA00-W0313-240110, FUS09-W22512-120110, FAC22-L1332-060040
//
// Classification priority (highest → lowest):
//   Tier 0: derivedDescMatch() — fuzzy match product_desc vs confirmed records' derived_desc
//   Tier 1: masterLookup()    — sap_master_lookup (imported from training data)
//   Tier 2: cacheAttrs()      — sap_prediction_cache (confirmed production records)
//   Tier 3: parseProductNo()  — deterministic code-parse (Part1/Part2/Part3)
//   Tier 4: description keyword parse

// ---- Derived description helpers (Tier 0) ----
// Order matters: produces a human-readable string that mirrors what appears in PDPlan product names
const DERIVED_FIELD_ORDER = [
  'line_type', 'product_series', 'brand',
  'panel_type', 'panel_style',
  'panel_color', 'panel_size',
  'glass_type', 'mosquito_net',
  'iron_pattern', 'iron_color',
  'design_version', 'remarks',
];

// Concatenate a confirmed record's field values into one searchable string
function generateDerivedDesc(record) {
  return DERIVED_FIELD_ORDER
    .map(k => record[k])
    .filter(v => v != null && String(v).trim() !== '')
    .join(' ');
}

// Thai abbreviations used in PDPlan product descriptions → expand before tokenizing
const THAI_ABBR = { 'นต.': 'หน้าต่าง', 'ปต.': 'ประตู', 'ช.แสง': 'ช่องแสง' };

function tokenizeForMatch(text) {
  let s = String(text || '');
  for (const [abbr, full] of Object.entries(THAI_ABBR)) s = s.split(abbr).join(full);
  return s
    .split(/[\s,;/()+\\]+/)
    .map(t => t.trim().toUpperCase())
    .filter(t => t.length >= 2);
}

// Tier 0: match productDesc against derived_desc of all confirmed records.
// Returns attrs + confidence = 100% if near-perfect match, else null.
// The more confirmed records exist, the smarter this becomes.
function derivedDescMatch(db, productNo, productDesc) {
  if (!productDesc || String(productDesc).trim().length < 4) return null;
  const { part1 } = splitParts(productNo);

  let candidates;
  try {
    // Same sap_part1 first (same product family) — fast path
    candidates = part1
      ? db.prepare(`SELECT * FROM pro_code_sap WHERE classify_status='confirmed' AND derived_desc IS NOT NULL AND derived_desc!='' AND sap_part1=? LIMIT 400`).all(part1)
      : [];
    if (candidates.length === 0) {
      candidates = db.prepare(`SELECT * FROM pro_code_sap WHERE classify_status='confirmed' AND derived_desc IS NOT NULL AND derived_desc!='' LIMIT 800`).all();
    }
  } catch { return null; }
  if (candidates.length === 0) return null;

  const inputTokens = tokenizeForMatch(productDesc);
  if (inputTokens.length < 2) return null;
  const inputSet = new Set(inputTokens);

  let bestCand = null;
  let bestScore = 0;
  for (const cand of candidates) {
    const derivedSet = new Set(tokenizeForMatch(cand.derived_desc));
    let matches = 0;
    for (const t of inputSet) { if (derivedSet.has(t)) matches++; }
    const score = matches / inputSet.size;
    if (score > bestScore) { bestScore = score; bestCand = cand; }
  }

  // Require at least 65% of input tokens present in derived desc
  if (!bestCand || bestScore < 0.65) return null;

  const conf = Math.min(Math.round(bestScore * 100), 100);
  const attrs = {};
  const fieldConfidence = {};
  for (const f of ATTR_FIELDS) {
    if (bestCand[f] != null && String(bestCand[f]).trim() !== '') {
      attrs[f] = bestCand[f];
      fieldConfidence[f] = conf;
    }
  }
  return {
    attrs,
    confidence: conf,
    fieldConfidence,
    sampleSize: 1,
    basis: 'derived_match',
    matchedProductNo: bestCand.product_no,
    matchScore: bestScore,
  };
}

// ---- Lookup tables ----
const LINE_TYPE = { FA: 'FA', FU: 'FU', RU: 'RU', WO: 'WO' };

const BRAND_BY_CODE = {
  '00': '(Standard)',
  '09': 'FRAMEX',
  '12': 'FINEXT',
  '17': 'HOOMDOT THUNDER',
  '22': 'WINDOW ASIA',
  '26': 'WIND FAME',
  '28': 'WINDOW ASIA',
  '29': 'WELLINGTAN',
  '32': 'FRAMEX',
  '33': 'ENZO',
  '34': 'FINEXT',
  '35': 'HOOMDOT',
};

// Ordered longest-first so "HOOMDOT THUNDER" matches before "HOOMDOT"
const KNOWN_BRANDS = [
  'HOOMDOT THUNDER', 'UNIX EXTRA', 'AZLE PLUS', 'WIND FAME',
  'WINDOW ASIA', 'FRAMEX', 'FINEXT', 'WELLINGTAN',
  'HOOMDOT', 'KOEN', 'ENZO', 'AZLE', 'UNIX',
];

function extractBrandFromDesc(desc) {
  const u = String(desc || '').toUpperCase();
  for (const b of KNOWN_BRANDS) {
    if (u.includes(b)) return b;
  }
  return null;
}

const FA_SERIES = { C: 'Super ECO', R: 'ORM', E: 'ECO' };
const FU_SERIES = { S: 'F100/S85', E: 'ECO 60', W: 'ECO 60-100' };

// ข้อ 3: ใช้ 'ช่องแสง' เดียว ไม่ใช้ '/ Fix'
const PANEL_TYPE = { W: 'หน้าต่าง', D: 'ประตู', F: 'ช่องแสง', L: 'หน้าต่าง' };

// ลำดับสำคัญ: ยาว/เฉพาะเจาะจงก่อน เพื่อป้องกัน "บานเปิด" ชนะ "บานเปิดคู่"
const PANEL_STYLE_MAP = [
  ['บานเปิดเดี่ยว+ช่องแสง', 'บานเปิดเดี่ยว+ช่องแสง'],
  ['บานเปิดแม่ลูก+ช่องแสง',  'บานเปิดแม่ลูก+ช่องแสง'],
  ['บานเปิดแม่ลูก',          'บานเปิดแม่ลูก'],
  ['บานเปิด4ช่อง',           'บานเปิด4ช่อง'],
  ['บานเปิด3ช่อง',           'บานเปิด3ช่อง'],
  ['บานเปิด2ช่อง',           'บานเปิด2ช่อง'],
  ['บานเปิดคู่',             'บานเปิดคู่'],
  ['บานเปิดเดี่ยว L',        'บานเปิดเดี่ยว L'],
  ['บานเปิดเดี่ยวL',         'บานเปิดเดี่ยว L'],  // normalize → มีช่องว่าง
  ['บานเปิดเดี่ยวR',         'บานเปิดเดี่ยว R'],  // normalize → มีช่องว่าง
  ['บานเปิดเดี่ยว',          'บานเปิดเดี่ยว'],
  ['บานเปิด',                'บานเปิด'],
  ['กระทุ้งคู่',             'กระทุ้งคู่'],
  ['บานกระทุ้ง',             'บานกระทุ้ง'],
  ['กระทุ้ง',               'กระทุ้ง'],
  ['บานเกล็ดซ้อน',           'บานเกล็ดซ้อน'],
  ['บานเกล็ด',              'บานเกล็ด'],
  ['บานสวิงเดี่ยว',          'บานสวิงเดี่ยว'],
  ['สวิงเดี่ยว',             'สวิงเดี่ยว'],
  ['บานสวิงคู่',             'บานสวิงคู่'],
  ['สวิง',                  'บานสวิง'],
  ['บานเฟี้ยม',              'บานเฟี้ยม'],
  ['รางแขวน',               'รางแขวน'],
  ['บานวงกลม',              'บานวงกลม'],
  ['SS+ลูกฟัก',                        'SS+ลูกฟัก'],
  ['ช่องแสง ดัดโค้งวงกลม 360 องศา',   'ช่องแสง ดัดโค้งวงกลม 360 องศา'],
  ['ช่องแสง 2 ช่อง Fix +คิ้ว',        'ช่องแสง 2 ช่อง Fix +คิ้ว'],
];

const COLOR_BY_CODE = {
  '11': 'สีขาว', '12': 'สีขาว', '22': 'สีขาว',
  '13': 'สีชา',
  '14': 'สีดำ',
  '15': 'สีเทา',
  '16': 'สีครีม',
  '17': 'สีน้ำตาล',
  '18': 'สีซิลเวอร์',
  '19': 'สีทอง',
};

// Longest-first to avoid partial matches (e.g. "SS" inside "FSSF")
const PANEL_STYLE_CODES = ['FSSF', 'SSSS', 'SFSF', 'SFS', 'FSF', 'SS', 'FF', 'SF', 'FS', 'FIX'];

const ATTR_FIELDS = [
  'line_type', 'product_series', 'brand', 'panel_type', 'panel_style',
  'iron_pattern', 'iron_color', 'glass_type', 'mosquito_net',
  'panel_color', 'panel_size', 'width_mm', 'height_mm', 'design_version', 'remarks',
];

// Dimension fields excluded from prediction cache (size is product-specific)
const CACHE_EXCLUDE = new Set(['panel_size', 'width_mm', 'height_mm']);

// Fields that are always derived deterministically from the SAP code itself
const PARSED_DOMINANT = ['line_type', 'brand', 'product_series', 'panel_type',
  'panel_color', 'panel_size', 'width_mm', 'height_mm'];

// ---- Part splitter ----
function splitParts(productNo) {
  const parts = String(productNo || '').trim().toUpperCase().split('-');
  return { part1: parts[0] || '', part2: parts[1] || '', part3: parts[2] || '' };
}

// ---- Part3 → size in cm ----
// SAP encodes half-cm dimensions as integers (120.5 cm → 1205).
// Values > 300 are therefore in 0.1cm units and need dividing by 10.
function parsePart3(part3) {
  const s = String(part3 || '').replace(/[^0-9]/g, '');
  if (s.length < 4) return {};
  const mid = Math.floor(s.length / 2);
  let w = parseFloat(s.slice(0, mid));
  let h = parseFloat(s.slice(mid));
  if (!w || !h) return {};
  if (w > 300) w = w / 10;
  if (h > 300) h = h / 10;
  return {
    width_mm: Math.round(w * 10),
    height_mm: Math.round(h * 10),
    panel_size: `${w}x${h}`,
  };
}

// ---- Extract WxH from product description text ----
// Handles: "120.5x110", "120.5×110", "120,5 x 110 ซม." etc.
function extractSizeFromDesc(desc) {
  const m = String(desc || '').match(/(\d+(?:[.,]\d+)?)\s*[xX×*]\s*(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const w = parseFloat(m[1].replace(',', '.'));
  const h = parseFloat(m[2].replace(',', '.'));
  if (!w || !h || w < 10 || h < 10 || w > 400 || h > 400) return null;
  return {
    width_mm: Math.round(w * 10),
    height_mm: Math.round(h * 10),
    panel_size: `${w}x${h}`,
  };
}

// ---- Parse product no. + description into structured attrs ----
function parseProductNo(productNo, productDesc = '') {
  const { part1, part2, part3 } = splitParts(productNo);
  const attrs = {};
  const desc = String(productDesc || '');

  // Line type from Part1 prefix
  const lt = part1.slice(0, 2);
  if (LINE_TYPE[lt]) attrs.line_type = LINE_TYPE[lt];

  // Product series from Part1 third character
  const third = part1.charAt(2);
  if (lt === 'FU' && FU_SERIES[third]) attrs.product_series = FU_SERIES[third];
  else if (lt === 'FA' && FA_SERIES[third]) attrs.product_series = FA_SERIES[third];

  // Brand from last 2 digits of Part1
  const brandCode = part1.replace(/[^0-9]/g, '').slice(-2);
  if (BRAND_BY_CODE[brandCode]) attrs.brand = BRAND_BY_CODE[brandCode];

  // Panel type from first char of Part2
  const ptype = part2.charAt(0);
  if (PANEL_TYPE[ptype]) attrs.panel_type = PANEL_TYPE[ptype];

  // FU F100 vs S85 disambiguation
  if (lt === 'FU' && third === 'S') {
    if (ptype === 'W') attrs.product_series = 'F100';
    else if (ptype === 'D') attrs.product_series = 'S85';
  }

  // Panel color from last 2 digits of Part2
  const colorCode = part2.replace(/[^0-9]/g, '').slice(-2);
  if (COLOR_BY_CODE[colorCode]) attrs.panel_color = COLOR_BY_CODE[colorCode];

  // Size: description takes priority over Part3 (more reliable for decimals)
  const descSize = extractSizeFromDesc(desc);
  if (descSize) {
    Object.assign(attrs, descSize);
  } else {
    Object.assign(attrs, parsePart3(part3));
  }

  // Description keyword parsing
  if (desc) {
    // Mosquito net
    attrs.mosquito_net = /ไม่มีมุ้ง|ไม่มุ้ง/.test(desc) ? 'ไม่มีมุ้ง'
      : /มุ้ง/.test(desc) ? 'มุ้ง' : 'ไม่มีมุ้ง';

    // Glass
    if (/กระจก/.test(desc)) attrs.glass_type = 'กระจก';

    // Panel style: case-insensitive, longest match wins, requires non-alpha boundary
    const styleMatch = PANEL_STYLE_CODES.find(s =>
      new RegExp(`(?:^|[^A-Za-z])${s}(?:$|[^A-Za-z])`, 'i').test(desc)
    );
    if (styleMatch) attrs.panel_style = styleMatch.toUpperCase();

    // ข้อ 1: Description ชนะ code-parse เสมอสำหรับ product_series
    // ตรวจสอบ pattern ที่ชัดเจนก่อน (longest-specific first)
    if (/ECO\s*60[-–]100/i.test(desc))            attrs.product_series = 'ECO 60-100';
    else if (/ECO\s*80/i.test(desc))              attrs.product_series = 'ECO 80';
    else if (/ECO\s*60/i.test(desc))              attrs.product_series = 'ECO 60';
    else if (/Super\s*ECO/i.test(desc))           attrs.product_series = 'SuperECO';
    else if (/\bS\s*85\b|[/\s(]85\b/.test(desc)) attrs.product_series = 'S85';   // "S85", "/85", " 85", "(85"
    else if (/\bF\s*100\b/.test(desc))            attrs.product_series = 'F100';  // override "F100/S85"
    else if (/\bF\s*10\b/.test(desc))             attrs.product_series = attrs.product_series || 'F10';
    else if (/\bORM\b/.test(desc))                attrs.product_series = attrs.product_series || 'ORM';

    // Color from description (only if Part2 color code didn't resolve it)
    if (!attrs.panel_color) {
      if (/สีชา|ชา/.test(desc)) attrs.panel_color = 'สีชา';
      else if (/สีดำ|ดำ/.test(desc)) attrs.panel_color = 'สีดำ';
      else if (/สีขาว|ขาว/.test(desc)) attrs.panel_color = 'สีขาว';
      else if (/สีเทา|เทา/.test(desc)) attrs.panel_color = 'สีเทา';
      else if (/สีน้ำตาล|น้ำตาล/.test(desc)) attrs.panel_color = 'สีน้ำตาล';
      else if (/สีครีม|ครีม/.test(desc)) attrs.panel_color = 'สีครีม';
      else if (/สีทอง|ทอง/.test(desc)) attrs.panel_color = 'สีทอง';
      else if (/ซิลเวอร์|สีเงิน|เงิน/.test(desc)) attrs.panel_color = 'สีซิลเวอร์';
      else if (/สีเขียว|เขียว/.test(desc)) attrs.panel_color = 'สีเขียว';
    }

    if (/เหล็กดัด/.test(desc)) attrs.iron_pattern = attrs.iron_pattern || 'มีเหล็กดัด';
  }

  return { part1, part2, part3, attrs };
}

// ---- Apply admin-defined custom rules (sap_parse_rules table) ----
function applyCustomRules(db, productNo, productDesc, attrs) {
  let rules;
  try {
    rules = db.prepare('SELECT * FROM sap_parse_rules WHERE is_active = 1 ORDER BY priority DESC, id ASC').all();
  } catch { return attrs; }
  const { part1, part2 } = splitParts(productNo);
  const desc = String(productDesc || '');
  for (const r of rules) {
    if (!ATTR_FIELDS.includes(r.target_field)) continue;
    const mv = String(r.match_value || '').toUpperCase();
    let hit = false;
    if (r.rule_type === 'part1_prefix') hit = part1.startsWith(mv);
    else if (r.rule_type === 'part1_suffix') hit = part1.endsWith(mv);
    else if (r.rule_type === 'part2_prefix') hit = part2.startsWith(mv);
    else if (r.rule_type === 'desc_contains') hit = desc.toUpperCase().includes(mv);
    if (hit) attrs[r.target_field] = r.set_value;
  }
  return attrs;
}

// ---- Tier 1: Master lookup from training data ----
// Returns { attrs, confidence, fieldConfidence, sampleSize, basis:'master' } or null.
function masterLookup(db, sap_part1, sap_part2) {
  let rows;
  try {
    rows = db.prepare(`
      SELECT field_name, top_value, sample_size, confidence_pct
      FROM sap_master_lookup WHERE sap_part1=? AND sap_part2=?
    `).all(sap_part1, sap_part2 || '');
  } catch { return null; }
  if (!rows || rows.length === 0) return null;

  const attrs = {};
  const fieldConfidence = {};
  let maxSamples = 0;

  for (const r of rows) {
    attrs[r.field_name] = r.top_value;
    // Training confidence → reported confidence to UI
    const reportedConf = r.confidence_pct >= 80
      ? Math.min(90 + Math.floor(r.sample_size / 50), 95)
      : r.confidence_pct >= 60 ? 75
      : 50;
    fieldConfidence[r.field_name] = reportedConf;
    if (r.sample_size > maxSamples) maxSamples = r.sample_size;
  }

  // Overall confidence = min of all field confidences (weakest link)
  const minConf = Math.min(...Object.values(fieldConfidence));
  return {
    attrs,
    fieldConfidence,
    confidence: minConf,
    sampleSize: maxSamples,
    basis: 'master',
  };
}

// ---- Tier 2: Fast cache lookup — reads from sap_prediction_cache ----
// Returns { attrs, confidence, fieldConfidence, sampleSize, basis:'cache' } or null.
function cacheAttrs(db, sap_part1, sap_part2) {
  let rows;
  try {
    rows = db.prepare(`
      SELECT field_name, top_value, sample_size, confidence_pct
      FROM sap_prediction_cache WHERE sap_part1=? AND sap_part2=?
    `).all(sap_part1, sap_part2 || '');
  } catch { return null; }
  if (!rows || rows.length === 0) return null;

  const attrs = {};
  const fieldConfidence = {};
  let maxSamples = 0;
  for (const r of rows) {
    attrs[r.field_name] = r.top_value;
    fieldConfidence[r.field_name] = Math.min(
      Math.round(r.confidence_pct * 0.9) + Math.min(Math.floor(r.sample_size / 3), 5),
      95
    );
    if (r.sample_size > maxSamples) maxSamples = r.sample_size;
  }
  return {
    attrs,
    fieldConfidence,
    confidence: Math.min(90 + Math.floor(maxSamples / 3), 95),
    sampleSize: maxSamples,
    basis: 'cache',
  };
}

// ---- Rebuild prediction cache for a (part1, part2) code group ----
// Called after: confirm, attribute update on confirmed record, bulk rebuild.
// Must be called OUTSIDE any existing db.transaction() to avoid nesting.
function rebuildPredictionCache(db, sap_part1, sap_part2) {
  if (!sap_part1) return;
  const key2 = sap_part2 || '';

  let rows;
  try {
    rows = db.prepare(`
      SELECT * FROM pro_code_sap
      WHERE classify_status='confirmed' AND sap_part1=? AND sap_part2=?
    `).all(sap_part1, key2);
  } catch { return; }

  try {
    db.transaction(() => {
      db.prepare("DELETE FROM sap_prediction_cache WHERE sap_part1=? AND sap_part2=?").run(sap_part1, key2);
      if (rows.length === 0) return;

      const THRESHOLD = 0.35;
      for (const field of ATTR_FIELDS) {
        if (CACHE_EXCLUDE.has(field)) continue;
        const counts = {};
        for (const r of rows) {
          const v = r[field];
          if (v != null && v !== '') counts[v] = (counts[v] || 0) + 1;
        }
        const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        if (!entries.length) continue;
        const [topVal, topFreq] = entries[0];
        if (topFreq / rows.length < THRESHOLD) continue;
        db.prepare(`
          INSERT OR REPLACE INTO sap_prediction_cache
            (sap_part1, sap_part2, field_name, top_value, frequency, sample_size, confidence_pct, updated_at)
          VALUES (?,?,?,?,?,?,?,datetime('now'))
        `).run(sap_part1, key2, field, topVal, topFreq, rows.length, Math.round(topFreq / rows.length * 100));
      }
    })();
  } catch (e) {
    console.error('[classifier] rebuildPredictionCache failed:', e.message);
  }
}

// ---- Majority vote from ALL similar confirmed records ----
function majorityLookup(db, productNo) {
  const { part1, part2 } = splitParts(productNo);
  if (!part1) return { attrs: {}, confidence: 0, sampleSize: 0, basis: 'none' };

  const LEVELS = [
    {
      basis: 'part1+part2',
      baseConf: 90,
      exclude: ['panel_size', 'width_mm', 'height_mm'],
      threshold: 0.35,
      sql: `SELECT * FROM pro_code_sap WHERE classify_status='confirmed' AND sap_part1=? AND sap_part2=? AND product_no!=? LIMIT 60`,
      args: (p1, p2, pno) => [p1, p2, pno],
    },
    {
      basis: 'part1+type',
      baseConf: 75,
      exclude: ['panel_size', 'width_mm', 'height_mm'],
      threshold: 0.45,
      sql: `SELECT * FROM pro_code_sap WHERE classify_status='confirmed' AND sap_part1=? AND substr(sap_part2,1,1)=? AND product_no!=? LIMIT 60`,
      args: (p1, p2, pno) => [p1, p2.charAt(0), pno],
    },
    {
      basis: 'part1',
      baseConf: 60,
      exclude: ['panel_size', 'width_mm', 'height_mm', 'panel_type', 'panel_color', 'panel_style'],
      threshold: 0.60,
      sql: `SELECT * FROM pro_code_sap WHERE classify_status='confirmed' AND sap_part1=? AND product_no!=? LIMIT 60`,
      args: (p1, _p2, pno) => [p1, pno],
    },
  ];

  for (const lvl of LEVELS) {
    const rows = db.prepare(lvl.sql).all(...lvl.args(part1, part2, productNo));
    if (rows.length === 0) continue;

    const attrs = {};
    for (const f of ATTR_FIELDS) {
      if (lvl.exclude.includes(f)) continue;
      const counts = {};
      for (const r of rows) {
        if (r[f] != null && r[f] !== '') counts[r[f]] = (counts[r[f]] || 0) + 1;
      }
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      if (top && top[1] / rows.length >= lvl.threshold) attrs[f] = top[0];
    }
    const boost = Math.min(Math.floor(rows.length / 3), 5);
    return { attrs, confidence: Math.min(lvl.baseConf + boost, 95), sampleSize: rows.length, basis: lvl.basis };
  }

  return { attrs: {}, confidence: 0, sampleSize: 0, basis: 'none' };
}

function similarityMatch(db, productNo) {
  const m = majorityLookup(db, productNo);
  if (m.sampleSize === 0) return null;
  return { attrs: m.attrs, confidence: m.confidence, basis: m.basis };
}

// ---- Main classifier entry point ----
// Returns: { sap_part1, sap_part2, sap_part3, attrs, confidence, fieldConfidence, sampleSize, basis }
function classify(db, productNo, productDesc = '') {
  const parsed = parseProductNo(productNo, productDesc);
  const { part1, part2, part3 } = parsed;

  // Track which tier filled each field and at what confidence
  const fieldConfidence = {};

  // ---- Tier 0: Derived desc match (template from confirmed records) ----
  // Highest priority for attribute values — the more confirmed records, the smarter it gets.
  let derived = null;
  try { derived = derivedDescMatch(db, productNo, productDesc); } catch { derived = null; }

  // ---- Tier 1: Training master lookup ----
  let master = null;
  if (part1 && part2) {
    master = masterLookup(db, part1, part2);
  }

  // ---- Tier 2: Production prediction cache ----
  let cache = null;
  if (part1 && part2) {
    cache = cacheAttrs(db, part1, part2);
  }

  // ---- Tier 3+4: Majority vote + code parse ----
  let majority = null;
  if (!master && !cache && !derived) {
    majority = majorityLookup(db, productNo);
  }

  // ---- Merge ----
  let attrs = {};
  let confidence = 0;
  let sampleSize = 0;
  let basis = 'parsed';

  if (derived) {
    // Tier 0 wins — copy all confirmed attrs from matched record
    attrs = { ...derived.attrs };
    Object.assign(fieldConfidence, derived.fieldConfidence);
    confidence = derived.confidence;
    sampleSize = derived.sampleSize;
    basis = derived.basis;
    // Fill remaining gaps from master/cache (for any field not in derived record)
    const fillFrom = (src) => {
      if (!src) return;
      for (const f of ATTR_FIELDS) {
        if (attrs[f] != null && attrs[f] !== '') continue;
        if (src.attrs[f] != null) { attrs[f] = src.attrs[f]; fieldConfidence[f] = src.fieldConfidence?.[f] || 0; }
      }
    };
    fillFrom(cache);
    fillFrom(master);
  } else if (master) {
    attrs = { ...master.attrs };
    Object.assign(fieldConfidence, master.fieldConfidence);
    confidence = master.confidence;
    sampleSize = master.sampleSize;
    basis = master.basis;

    // Cache wins per-field if it has higher confidence (production experience > training)
    if (cache) {
      for (const field of ATTR_FIELDS) {
        if (CACHE_EXCLUDE.has(field)) continue;
        const cacheConf = cache.fieldConfidence[field] || 0;
        const masterConf = fieldConfidence[field] || 0;
        if (cacheConf > masterConf && cache.attrs[field] != null) {
          attrs[field] = cache.attrs[field];
          fieldConfidence[field] = cacheConf;
        }
      }
    }
  } else if (cache) {
    attrs = { ...cache.attrs };
    Object.assign(fieldConfidence, cache.fieldConfidence);
    confidence = cache.confidence;
    sampleSize = cache.sampleSize;
    basis = cache.basis;
  } else if (majority && majority.sampleSize > 0) {
    attrs = { ...majority.attrs };
    confidence = majority.confidence;
    sampleSize = majority.sampleSize;
    basis = majority.basis;
  }

  // ---- parsedDominant fields ALWAYS override learned values (deterministic) ----
  for (const k of PARSED_DOMINANT) {
    if (parsed.attrs[k] != null) {
      attrs[k] = parsed.attrs[k];
      fieldConfidence[k] = 95; // deterministic = very high confidence
    }
  }

  // ---- Fill remaining gaps from description parse ----
  for (const [k, v] of Object.entries(parsed.attrs)) {
    if ((attrs[k] == null || attrs[k] === '') && v != null) {
      attrs[k] = v;
      if (!fieldConfidence[k]) fieldConfidence[k] = 40; // description parse = low confidence
    }
  }

  // ---- Post-processing: กฎจาก description ----
  const descUpper = String(productDesc || '').toUpperCase();

  // ข้อ 1: product_series — description ชนะ "F100/S85" จาก code-parse
  // (ทำซ้ำที่นี่เพื่อ override แม้ค่าจะมาจาก master/cache)
  if (attrs.product_series === 'F100/S85' || !attrs.product_series) {
    if (/ECO\s*60[-–]100/i.test(productDesc))            attrs.product_series = 'ECO 60-100';
    else if (/ECO\s*80/i.test(productDesc))              attrs.product_series = 'ECO 80';
    else if (/ECO\s*60/i.test(productDesc))              attrs.product_series = 'ECO 60';
    else if (/Super\s*ECO/i.test(productDesc))           attrs.product_series = 'SuperECO';
    else if (/\bS\s*85\b|[/\s(]85\b/.test(productDesc)) attrs.product_series = 'S85';
    else if (/\bF\s*100\b/.test(productDesc))            attrs.product_series = 'F100';
    else if (/\bF\s*10\b/.test(productDesc))             attrs.product_series = attrs.product_series || 'F10';
  }
  // fallback จาก product_no prefix เมื่อยังไม่มีรุ่น
  if (!attrs.product_series) {
    if (part1.startsWith('FA'))      { attrs.product_series = 'F10';  fieldConfidence.product_series = 70; }
    else if (part1.startsWith('FU')) { attrs.product_series = 'F100'; fieldConfidence.product_series = 70; }
  }

  // ข้อ 2: brand — ถ้าเป็น "(Standard)" หรือว่าง ให้เช็ค description ก่อน fallback WINDOW ASIA
  if (!attrs.brand || attrs.brand === '(Standard)') {
    const brandFromDesc = extractBrandFromDesc(productDesc);
    attrs.brand = brandFromDesc || 'WINDOW ASIA';
    if (attrs.brand !== '(Standard)') fieldConfidence.brand = brandFromDesc ? 80 : 60;
  }

  // ข้อ 3: panel_type — normalize ค่าที่มี " / " ให้ใช้ชื่อแรก เช่น "ช่องแสง / Fix" → "ช่องแสง"
  if (attrs.panel_type && String(attrs.panel_type).includes(' / ')) {
    attrs.panel_type = String(attrs.panel_type).split(' / ')[0].trim();
  }
  // normalize ชื่อย่อจาก training ("นต." "ปต.") เป็นชื่อเต็ม
  const PANEL_TYPE_NORM = {
    'นต.': 'หน้าต่าง', 'หน้าต่าง': 'หน้าต่าง', 'หน้าต่าง (พิเศษ)': 'หน้าต่าง',
    'ปต.': 'ประตู',   'ประตู': 'ประตู',
    'ช่องแสง': 'ช่องแสง', 'fix': 'ช่องแสง', 'FIX': 'ช่องแสง',
  };
  if (attrs.panel_type) {
    const norm = PANEL_TYPE_NORM[attrs.panel_type] || PANEL_TYPE_NORM[attrs.panel_type?.toLowerCase()];
    if (norm) attrs.panel_type = norm;
  }

  // ข้อ 4: glass_type — ทุกสินค้า
  // ECO = 4mm · ที่เหลือ = 5mm · ยกเว้นถ้าชื่อระบุกระจกพิเศษ
  {
    const isEco = /ECO/i.test(attrs.product_series || '');
    if (/ลามิเนท?|ลามิเนต/i.test(productDesc)) {
      attrs.glass_type = 'กระจกลามิเนท';
      fieldConfidence.glass_type = 90;
    } else if (/เทมเปอร์/i.test(productDesc)) {
      attrs.glass_type = 'กระจกเทมเปอร์';
      fieldConfidence.glass_type = 90;
    } else if (/กระจกฝ้า|ฝ้า/.test(productDesc)) {
      attrs.glass_type = 'กระจกฝ้า';
      fieldConfidence.glass_type = 85;
    } else if (/ชาดำ/.test(productDesc)) {
      attrs.glass_type = 'กระจกชาดำ';
      fieldConfidence.glass_type = 85;
    } else {
      attrs.glass_type = isEco ? 'เขียวใสตัดแสง 4mm.' : 'เขียวใสตัดแสง 5mm.';
      fieldConfidence.glass_type = 85;
    }
  }

  // ข้อ 5: iron_pattern และ iron_color จากชื่อสินค้า
  // รูปแบบ: "เหล็กดัดลาย{ชื่อลาย}" หรือ "เหล็กดัดลาย{ชื่อลาย} ({สีเหล็ก})"
  // ตัวอย่าง: "เหล็กดัดลายผีเสื้อ (แต้มสี)" → iron_pattern="ผีเสื้อ", iron_color="แต้มสี"
  const ironMatch = productDesc.match(/เหล็กดัดลาย\s*([^\s(]+)(?:\s*\(([^)]+)\))?/);
  if (ironMatch) {
    attrs.iron_pattern = ironMatch[1];
    fieldConfidence.iron_pattern = 95;
    if (ironMatch[2]) {
      attrs.iron_color = ironMatch[2];
      fieldConfidence.iron_color = 90;
    }
  }

  // ข้อ 6: panel_style จากชื่อสินค้า (ยาว/เฉพาะก่อน)
  for (const [keyword, value] of PANEL_STYLE_MAP) {
    if (productDesc.includes(keyword)) {
      attrs.panel_style = value;
      fieldConfidence.panel_style = 95;
      break;
    }
  }
  // "ช่องแสง" เดี่ยว (ไม่มี +) → FIX
  if (!attrs.panel_style && productDesc.includes('ช่องแสง')
      && !productDesc.includes('+ช่องแสง') && !productDesc.includes('ช่องแสง+')) {
    attrs.panel_style = 'FIX';
    fieldConfidence.panel_style = 90;
  }

  // ข้อ 7: panel_color — "ลายไม้สักทอง" ในชื่อสินค้า
  if (/ลายไม้สักทอง/.test(productDesc)) {
    attrs.panel_color = 'ลายไม้สักทอง';
    fieldConfidence.panel_color = 95;
  }

  // ข้อ 8: mosquito_net — จากชื่อสินค้า
  if (/ไม่มุ้ง/.test(productDesc)) {
    attrs.mosquito_net = 'ไม่มีมุ้ง';
    fieldConfidence.mosquito_net = 95;
  } else if (/มุ้งครึ่งบาน/.test(productDesc)) {
    attrs.mosquito_net = 'มุ้งครึ่งบาน';
    fieldConfidence.mosquito_net = 95;
  }

  // ข้อ 9: remarks — "เฟรมข้างใหม่" ในชื่อสินค้า
  if (/เฟรมข้างใหม่/.test(productDesc)) {
    attrs.remarks = 'เฟรมข้างใหม่';
    fieldConfidence.remarks = 95;
  }

  // ข้อ 10: design_version — "รุ่นใหม่" ในชื่อสินค้า
  if (/รุ่นใหม่/.test(productDesc)) {
    attrs.design_version = 'รุ่นใหม่';
    fieldConfidence.design_version = 95;
  }

  // ---- Admin custom rules override EVERYTHING (runs last) ----
  applyCustomRules(db, productNo, productDesc, attrs);

  // ---- If no learned source, use parseConfidence for overall score ----
  if (!master && !cache && (!majority || majority.sampleSize === 0)) {
    const core = ['line_type', 'brand', 'panel_type', 'panel_color', 'panel_size'];
    const got = core.filter(k => attrs[k] != null && attrs[k] !== '').length;
    confidence = got >= 5 ? 50 : got >= 3 ? 30 : got >= 1 ? 20 : 10;
  }

  // Build summary counts
  const fieldConf = fieldConfidence;
  let high = 0, medium = 0, low = 0;
  for (const f of ATTR_FIELDS.filter(f => !CACHE_EXCLUDE.has(f))) {
    const c = fieldConf[f] || 0;
    if (c >= 90) high++;
    else if (c >= 60) medium++;
    else low++;
  }

  return {
    sap_part1: part1,
    sap_part2: part2,
    sap_part3: part3,
    attrs,
    confidence,
    fieldConfidence: fieldConf,
    summary: { high, medium, low },
    sampleSize,
    basis,
  };
}

// ---- refreshGroupConfidence ----
// เรียกหลัง save/confirm ทุกครั้ง:
// 1. Rebuild cache ของกลุ่ม
// 2. Confirmed records: ตรวจ consistency vs majority → 100% ถ้าตรงทั้งหมด, ต่ำกว่าถ้ามีค่าผิดปกติ
// 3. Auto/pending records ในกลุ่มเดียวกัน: reclassify → update auto_confidence ทันที
function refreshGroupConfidence(db, sap_part1, sap_part2) {
  if (!sap_part1) return;
  const key2 = sap_part2 || '';

  // Step 1: rebuild cache
  rebuildPredictionCache(db, sap_part1, key2);

  // Step 2: confirmed records — consistency check
  try {
    const confirmedRows = db.prepare(
      `SELECT * FROM pro_code_sap WHERE sap_part1=? AND sap_part2=? AND classify_status='confirmed'`
    ).all(sap_part1, key2);

    if (confirmedRows.length === 0) return;

    // อ่าน majority จาก cache ที่เพิ่ง rebuild (เฉพาะ field ที่ confidence >= 70%)
    const cacheEntries = db.prepare(
      'SELECT field_name, top_value, confidence_pct FROM sap_prediction_cache WHERE sap_part1=? AND sap_part2=?'
    ).all(sap_part1, key2);
    const majorityMap = {};
    for (const e of cacheEntries) {
      if (e.confidence_pct >= 70) majorityMap[e.field_name] = e.top_value;
    }
    const comparableFields = Object.keys(majorityMap);

    db.transaction(() => {
      for (const rec of confirmedRows) {
        let score = 100;
        // ต้องมีข้อมูล confirmed >= 3 รายการ และ comparable fields >= 3 จึงตรวจ outlier
        if (confirmedRows.length >= 3 && comparableFields.length >= 3) {
          let matching = 0, total = 0;
          for (const f of comparableFields) {
            const v = rec[f];
            if (v == null || v === '') continue;
            total++;
            if (v === majorityMap[f]) matching++;
          }
          if (total >= 3) score = Math.round(matching / total * 100);
        }
        db.prepare('UPDATE pro_code_sap SET auto_confidence=? WHERE id=?').run(score, rec.id);
      }
    })();
  } catch (e) {
    console.error('[classifier] refreshGroupConfidence confirmed check:', e.message);
  }

  // Step 3: auto/pending records ในกลุ่มเดียวกัน → reclassify
  try {
    const autoRows = db.prepare(
      `SELECT id, product_no, product_desc FROM pro_code_sap
       WHERE sap_part1=? AND sap_part2=? AND classify_status IN ('auto','pending')`
    ).all(sap_part1, key2);

    if (autoRows.length > 0) {
      db.transaction(() => {
        for (const row of autoRows) {
          const r = classify(db, row.product_no, row.product_desc || '');
          db.prepare('UPDATE pro_code_sap SET auto_confidence=? WHERE id=?').run(r.confidence, row.id);
        }
      })();
    }
  } catch (e) {
    console.error('[classifier] refreshGroupConfidence auto reclassify:', e.message);
  }
}

module.exports = {
  splitParts,
  parsePart3,
  parseProductNo,
  extractSizeFromDesc,
  masterLookup,
  rebuildPredictionCache,
  refreshGroupConfidence,
  similarityMatch,
  classify,
  generateDerivedDesc,
  ATTR_FIELDS,
  CACHE_EXCLUDE,
};
