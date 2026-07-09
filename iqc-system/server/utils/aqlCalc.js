// ตารางการสุ่มตัวอย่างมาตรฐานบริษัท — Ac=0, Re=1 ทุกช่วง (พบ defect 1 ชิ้น = reject)
const S1_TABLE = [
  { min: 1,   max: 1,        n: 1, ac: 0, re: 1 },  // แผน 1
  { min: 2,   max: 50,       n: 2, ac: 0, re: 1 },  // แผน 2–50
  { min: 51,  max: 500,      n: 3, ac: 0, re: 1 },  // แผน 51–500
  { min: 501, max: Infinity, n: 5, ac: 0, re: 1 },  // แผน 501+
];

function calcAQL(lotQty) {
  if (!lotQty || lotQty < 1) return { n: 1, ac: 0, re: 1 };
  const row = S1_TABLE.find(r => lotQty >= r.min && lotQty <= r.max);
  return row ? { n: row.n, ac: row.ac, re: row.re } : { n: 5, ac: 0, re: 1 };
}

module.exports = { calcAQL };
