const express = require('express');
const router = express.Router();
const db = require('../db/database');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');

const QC_STATIONS = [
  { value: 'incoming',    label: 'QC รับเข้า' },
  { value: 'plant1',     label: 'QC โรง1' },
  { value: 'plant2',     label: 'QC โรง2' },
  { value: 'plant4',     label: 'QC โรง4' },
  { value: 'special',    label: 'QC บานพิเศษ' },
  { value: 'calibration',label: 'QC Calibration' },
  { value: 'qc_admin',   label: 'QC Admin' },
  { value: 'supervisor', label: 'QC Supervisor' },
];
const stationLabel = (v) => QC_STATIONS.find(s => s.value === v)?.label || v || '—';

// Haversine distance (meters)
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getGeofence() {
  const lat = parseFloat(db.getSetting('factory_lat') || '');
  const lon = parseFloat(db.getSetting('factory_lon') || '');
  const radius = parseFloat(db.getSetting('factory_radius_m') || '200');
  return { lat, lon, radius, configured: !isNaN(lat) && !isNaN(lon) };
}

function getShiftSettings() {
  return {
    start: db.getSetting('shift_start_time') || '08:00',
    end:   db.getSetting('shift_end_time')   || '17:00',
    grace: parseInt(db.getSetting('shift_late_grace_minutes') || '0'),
  };
}

// Returns minutes late (0 if on time). checkInAt = "YYYY-MM-DD HH:MM:SS" UTC string
function calcLateMinutes(checkInAt, shiftStart, graceMinutes) {
  if (!checkInAt) return 0;
  const dt = new Date(checkInAt.includes('Z') ? checkInAt : checkInAt + 'Z');
  const bkkH = (dt.getUTCHours() + 7) % 24;
  const bkkM = dt.getUTCMinutes();
  const checkInMins = bkkH * 60 + bkkM;
  const [sh, sm] = shiftStart.split(':').map(Number);
  const shiftMins = sh * 60 + sm + (graceMinutes || 0);
  return Math.max(0, checkInMins - shiftMins);
}

function calcWorkMinutes(checkInAt, checkOutAt) {
  if (!checkInAt || !checkOutAt) return null;
  const inMs  = new Date(checkInAt.includes('Z')  ? checkInAt  : checkInAt  + 'Z').getTime();
  const outMs = new Date(checkOutAt.includes('Z') ? checkOutAt : checkOutAt + 'Z').getTime();
  return Math.max(0, Math.round((outMs - inMs) / 60000));
}

function nowUTC() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function todayLocal() {
  return new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD in local tz
}

// ─── GET /stations ───────────────────────────────────────────────────────────
router.get('/stations', auth, (req, res) => {
  res.json(QC_STATIONS);
});

// ─── GET /shift-settings ─────────────────────────────────────────────────────
router.get('/shift-settings', auth, (req, res) => {
  res.json(getShiftSettings());
});

// ─── GET /my-status ──────────────────────────────────────────────────────────
router.get('/my-status', auth, (req, res) => {
  const today = todayLocal();
  const row = db.prepare('SELECT * FROM qc_attendance WHERE user_id = ? AND date = ?').get(req.user.id, today);
  const geo = getGeofence();
  const shift = getShiftSettings();
  res.json({
    today,
    checked_in:    !!row?.check_in_at,
    checked_out:   !!row?.check_out_at,
    check_in_at:   row?.check_in_at  || null,
    check_out_at:  row?.check_out_at || null,
    late_minutes:  row?.late_minutes  || 0,
    work_minutes:  row?.work_minutes  || null,
    geofence_ok:   !!row?.geofence_ok,
    factory_lat:   geo.lat || null,
    factory_lon:   geo.lon || null,
    factory_radius_m: geo.radius,
    geofence_configured: geo.configured,
    shift_start: shift.start,
    shift_end:   shift.end,
  });
});

// ─── POST /check-in ──────────────────────────────────────────────────────────
router.post('/check-in', auth, (req, res) => {
  const roles = ['qc_staff', 'qc_supervisor'];
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'ไม่มีสิทธิ์เช็คชื่อ' });

  const { lat, lon } = req.body;
  if (lat === undefined || lon === undefined) return res.status(400).json({ error: 'กรุณาส่งพิกัด GPS' });

  const today = todayLocal();
  const existing = db.prepare('SELECT id, check_in_at FROM qc_attendance WHERE user_id = ? AND date = ?').get(req.user.id, today);
  if (existing?.check_in_at) return res.status(400).json({ error: 'เช็คชื่อวันนี้แล้ว' });

  const geo = getGeofence();
  let geofenceOk = 0;
  if (geo.configured) {
    const dist = haversine(lat, lon, geo.lat, geo.lon);
    geofenceOk = dist <= geo.radius ? 1 : 0;
    if (!geofenceOk) {
      return res.status(400).json({
        error: `อยู่นอกเขตโรงงาน (ห่าง ${Math.round(dist)} เมตร / รัศมี ${geo.radius} เมตร)`,
      });
    }
  }

  const now = nowUTC();
  const shift = getShiftSettings();
  const lateMin = calcLateMinutes(now, shift.start, shift.grace);

  db.prepare(`
    INSERT INTO qc_attendance (user_id, date, check_in_at, lat, lon, geofence_ok, late_minutes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, date) DO UPDATE SET
      check_in_at  = excluded.check_in_at,
      lat          = excluded.lat,
      lon          = excluded.lon,
      geofence_ok  = excluded.geofence_ok,
      late_minutes = excluded.late_minutes
  `).run(req.user.id, today, now, lat, lon, geofenceOk, lateMin);

  db.auditLog('qc_attendance', req.user.id, 'CHECK_IN', null, { date: today, lat, lon, geofence_ok: geofenceOk, late_minutes: lateMin }, req.user.id, req.ip);
  db.broadcastSSE('attendance_update', { date: today, user_id: req.user.id, action: 'check_in' });

  res.json({ ok: true, check_in_at: now, geofence_ok: geofenceOk, late_minutes: lateMin });
});

// ─── POST /check-out ─────────────────────────────────────────────────────────
router.post('/check-out', auth, (req, res) => {
  const roles = ['qc_staff', 'qc_supervisor'];
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'ไม่มีสิทธิ์' });

  const { lat, lon } = req.body;
  if (lat === undefined || lon === undefined) return res.status(400).json({ error: 'กรุณาส่งพิกัด GPS' });

  const today = todayLocal();
  const row = db.prepare('SELECT * FROM qc_attendance WHERE user_id = ? AND date = ?').get(req.user.id, today);
  if (!row?.check_in_at) return res.status(400).json({ error: 'ยังไม่ได้เช็คชื่อเข้างานวันนี้' });
  if (row?.check_out_at) return res.status(400).json({ error: 'เช็คออกวันนี้แล้ว' });

  const geo = getGeofence();
  if (geo.configured) {
    const dist = haversine(lat, lon, geo.lat, geo.lon);
    if (dist > geo.radius) {
      return res.status(400).json({
        error: `อยู่นอกเขตโรงงาน (ห่าง ${Math.round(dist)} เมตร / รัศมี ${geo.radius} เมตร)`,
      });
    }
  }

  const now = nowUTC();
  const workMin = calcWorkMinutes(row.check_in_at, now);

  db.prepare(`UPDATE qc_attendance SET check_out_at = ?, work_minutes = ? WHERE user_id = ? AND date = ?`)
    .run(now, workMin, req.user.id, today);

  db.auditLog('qc_attendance', req.user.id, 'CHECK_OUT', null, { date: today, lat, lon, work_minutes: workMin }, req.user.id, req.ip);
  db.broadcastSSE('attendance_update', { date: today, user_id: req.user.id, action: 'check_out' });

  res.json({ ok: true, check_out_at: now, work_minutes: workMin });
});

// ─── GET /today ──────────────────────────────────────────────────────────────
router.get('/today', auth, requireRole(['qc_supervisor', 'qc_manager', 'admin']), (req, res) => {
  const date = req.query.date || todayLocal();

  const staff = db.prepare(`
    SELECT u.id, u.full_name, u.role, u.qc_station,
      a.check_in_at, a.check_out_at, a.geofence_ok,
      a.lat, a.lon, a.late_minutes, a.work_minutes, a.admin_note
    FROM users u
    LEFT JOIN qc_attendance a ON a.user_id = u.id AND a.date = ?
    WHERE u.is_active = 1
      AND u.role IN ('qc_staff', 'qc_supervisor')
    ORDER BY u.qc_station, u.full_name
  `).all(date);

  const grouped = {};
  for (const s of QC_STATIONS) grouped[s.value] = [];
  grouped['unassigned'] = [];
  for (const row of staff) {
    const key = row.qc_station && grouped[row.qc_station] !== undefined ? row.qc_station : 'unassigned';
    grouped[key].push(row);
  }

  const summary = {
    total:      staff.length,
    checked_in: staff.filter(s => s.check_in_at).length,
    checked_out:staff.filter(s => s.check_out_at).length,
    late:       staff.filter(s => (s.late_minutes || 0) > 0).length,
    absent:     staff.filter(s => !s.check_in_at).length,
  };

  res.json({ date, groups: grouped, station_labels: QC_STATIONS, summary, shift: getShiftSettings() });
});

// ─── GET /my-history?month=YYYY-MM ──────────────────────────────────────────
router.get('/my-history', auth, (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7); // YYYY-MM
  const rows = db.prepare(`
    SELECT date, check_in_at, check_out_at, late_minutes, work_minutes, geofence_ok, admin_note
    FROM qc_attendance
    WHERE user_id = ? AND date LIKE ?
    ORDER BY date ASC
  `).all(req.user.id, `${month}%`);
  res.json({ month, records: rows, shift: getShiftSettings() });
});

// ─── GET /employee/:userId/monthly?month=YYYY-MM ──────────────────────────────
router.get('/employee/:userId/monthly', auth, requireRole(['qc_supervisor', 'qc_manager', 'admin']), (req, res) => {
  const userId = parseInt(req.params.userId);
  const month = req.query.month || new Date().toISOString().slice(0, 7);

  const user = db.prepare('SELECT id, full_name, role, qc_station FROM users WHERE id = ? AND is_active = 1').get(userId);
  if (!user) return res.status(404).json({ error: 'ไม่พบผู้ใช้งาน' });

  const records = db.prepare(`
    SELECT date, check_in_at, check_out_at, late_minutes, work_minutes, geofence_ok, admin_note
    FROM qc_attendance WHERE user_id = ? AND date LIKE ?
    ORDER BY date ASC
  `).all(userId, `${month}%`);

  // Monthly stats for this employee (last 3 months for trends)
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_present,
      SUM(CASE WHEN late_minutes > 0 THEN 1 ELSE 0 END) as total_late,
      ROUND(AVG(late_minutes), 0) as avg_late_minutes,
      ROUND(AVG(CASE WHEN work_minutes IS NOT NULL THEN work_minutes END), 0) as avg_work_minutes
    FROM qc_attendance WHERE user_id = ? AND date LIKE ?
  `).get(userId, `${month}%`);

  res.json({ month, user, records, stats: stats || {}, shift: getShiftSettings() });
});

// ─── GET /employees ──────────────────────────────────────────────────────────
router.get('/employees', auth, requireRole(['qc_supervisor', 'qc_manager', 'admin']), (req, res) => {
  const staff = db.prepare(`
    SELECT id, full_name, role, qc_station
    FROM users
    WHERE is_active = 1 AND role IN ('qc_staff', 'qc_supervisor')
    ORDER BY qc_station, full_name
  `).all();
  res.json(staff);
});

// ─── POST /admin/override ─────────────────────────────────────────────────────
router.post('/admin/override', auth, requireRole(['admin', 'qc_manager']), (req, res) => {
  const { user_id, date, check_in_at, check_out_at, admin_note } = req.body;
  if (!user_id || !date) return res.status(400).json({ error: 'กรุณาระบุ user_id และ date' });

  const shift = getShiftSettings();
  const lateMin = check_in_at ? calcLateMinutes(check_in_at + ':00', shift.start, shift.grace) : 0;
  const workMin = (check_in_at && check_out_at) ? calcWorkMinutes(check_in_at + ':00', check_out_at + ':00') : null;

  // Normalize to full datetime strings
  const ciAt = check_in_at  ? (check_in_at.length  === 16 ? check_in_at  + ':00' : check_in_at)  : null;
  const coAt = check_out_at ? (check_out_at.length  === 16 ? check_out_at + ':00' : check_out_at) : null;

  db.prepare(`
    INSERT INTO qc_attendance (user_id, date, check_in_at, check_out_at, late_minutes, work_minutes, geofence_ok, admin_note)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(user_id, date) DO UPDATE SET
      check_in_at  = COALESCE(excluded.check_in_at, check_in_at),
      check_out_at = COALESCE(excluded.check_out_at, check_out_at),
      late_minutes = excluded.late_minutes,
      work_minutes = excluded.work_minutes,
      admin_note   = excluded.admin_note
  `).run(user_id, date, ciAt, coAt, lateMin, workMin, admin_note || null);

  db.auditLog('qc_attendance', user_id, 'ADMIN_OVERRIDE', null, { date, check_in_at: ciAt, check_out_at: coAt, admin_note }, req.user.id, req.ip);
  db.broadcastSSE('attendance_update', { date, user_id, action: 'override' });

  res.json({ ok: true });
});

// ─── GET /monthly-summary?month=YYYY-MM ──────────────────────────────────────
router.get('/monthly-summary', auth, requireRole(['qc_supervisor', 'qc_manager', 'admin']), (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);

  // All active QC staff
  const staff = db.prepare(`
    SELECT id, full_name, role, qc_station
    FROM users WHERE is_active = 1 AND role IN ('qc_staff', 'qc_supervisor')
    ORDER BY qc_station, full_name
  `).all();

  // All attendance records for the month
  const allRecords = db.prepare(`
    SELECT user_id, date, check_in_at, check_out_at, late_minutes, work_minutes
    FROM qc_attendance WHERE date LIKE ?
  `).all(`${month}%`);

  // Map userId → records[]
  const recsByUser = {};
  for (const r of allRecords) {
    if (!recsByUser[r.user_id]) recsByUser[r.user_id] = [];
    recsByUser[r.user_id].push(r);
  }

  // Calculate working days in month (Mon–Fri, up to today in Bangkok TZ)
  const todayLocal = new Date().toLocaleDateString('sv-SE');
  const [y, m] = month.split('-').map(Number);
  let workingDays = 0;
  const daysInMonth = new Date(y, m, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${month}-${String(d).padStart(2, '0')}`;
    if (ds > todayLocal) break;
    const dow = new Date(ds).getDay();
    if (dow !== 0 && dow !== 6) workingDays++;
  }

  const employees = staff.map(u => {
    const recs = recsByUser[u.id] || [];
    const present  = recs.filter(r => r.check_in_at).length;
    const late     = recs.filter(r => (r.late_minutes || 0) > 0).length;
    const lateRecs = recs.filter(r => (r.late_minutes || 0) > 0);
    const avgLate  = lateRecs.length
      ? Math.round(lateRecs.reduce((s, r) => s + r.late_minutes, 0) / lateRecs.length)
      : 0;
    const workedRecs = recs.filter(r => r.work_minutes != null);
    const avgWork  = workedRecs.length
      ? Math.round(workedRecs.reduce((s, r) => s + r.work_minutes, 0) / workedRecs.length)
      : null;
    const absent = Math.max(0, workingDays - present);
    const pct    = workingDays > 0 ? Math.round((present / workingDays) * 100) : null;
    return {
      id: u.id,
      full_name: u.full_name,
      role: u.role,
      qc_station: u.qc_station,
      total_present:    present,
      total_late:       late,
      total_absent:     absent,
      attendance_pct:   pct,
      avg_late_minutes: avgLate,
      avg_work_minutes: avgWork,
    };
  });

  res.json({ month, working_days: workingDays, shift: getShiftSettings(), employees });
});

// ─── GET /history ─────────────────────────────────────────────────────────────
router.get('/history', auth, requireRole(['qc_supervisor', 'qc_manager', 'admin']), (req, res) => {
  const { date, user_id } = req.query;
  if (!date) return res.status(400).json({ error: 'กรุณาระบุวันที่' });

  let sql = `
    SELECT u.id as user_id, u.full_name, u.role, u.qc_station,
      a.check_in_at, a.check_out_at, a.geofence_ok,
      a.late_minutes, a.work_minutes, a.admin_note
    FROM users u
    LEFT JOIN qc_attendance a ON a.user_id = u.id AND a.date = ?
    WHERE u.is_active = 1 AND u.role IN ('qc_staff','qc_supervisor')
  `;
  const params = [date];
  if (user_id) { sql += ' AND u.id = ?'; params.push(+user_id); }
  sql += ' ORDER BY u.qc_station, u.full_name';

  res.json(db.prepare(sql).all(...params));
});

module.exports = router;
