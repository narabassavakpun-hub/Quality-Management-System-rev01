// ===== Lightweight schema validator (no deps) =====
// schema = { field: { required, type, min, max, minLength, maxLength, enum, pattern, label } }
// type: 'string' (default) | 'int' | 'number' | 'date'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function fieldErrors(name, value, rules) {
  const label = rules.label || name;
  const present = value !== undefined && value !== null && value !== '';

  if (!present) {
    return rules.required ? [`กรุณากรอก${label}`] : [];
  }

  const errs = [];
  const type = rules.type || 'string';

  if (type === 'int' || type === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n) || (type === 'int' && !Number.isInteger(n))) {
      errs.push(`${label} ต้องเป็นตัวเลข${type === 'int' ? 'จำนวนเต็ม' : ''}`);
    } else {
      if (rules.min != null && n < rules.min) errs.push(`${label} ต้องไม่น้อยกว่า ${rules.min}`);
      if (rules.max != null && n > rules.max) errs.push(`${label} ต้องไม่เกิน ${rules.max}`);
    }
  } else if (type === 'date') {
    if (!DATE_RE.test(String(value))) errs.push(`${label} ต้องเป็นวันที่รูปแบบ YYYY-MM-DD`);
  } else {
    const s = String(value);
    if (rules.maxLength && s.length > rules.maxLength) errs.push(`${label} ยาวเกิน ${rules.maxLength} ตัวอักษร`);
    if (rules.minLength && s.length < rules.minLength) errs.push(`${label} ต้องยาวอย่างน้อย ${rules.minLength} ตัวอักษร`);
  }

  if (rules.enum && !rules.enum.includes(value)) errs.push(`${label} ไม่ถูกต้อง`);
  if (rules.pattern && !rules.pattern.test(String(value))) errs.push(`${label} รูปแบบไม่ถูกต้อง`);
  return errs;
}

function validate(body, schema) {
  const errors = [];
  for (const [field, rules] of Object.entries(schema)) {
    errors.push(...fieldErrors(field, body?.[field], rules));
  }
  return { valid: errors.length === 0, errors };
}

// Express middleware factory
function validateBody(schema) {
  return (req, res, next) => {
    const { valid, errors } = validate(req.body || {}, schema);
    if (!valid) return res.status(400).json({ error: errors[0], errors });
    next();
  };
}

// Make every field optional (for PATCH) — keeps type/range rules
function asPartial(schema) {
  const out = {};
  for (const [k, v] of Object.entries(schema)) out[k] = { ...v, required: false };
  return out;
}

module.exports = { validate, validateBody, asPartial, fieldErrors };
