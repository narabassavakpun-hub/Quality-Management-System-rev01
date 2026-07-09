const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const db = require('../db/database');
const auth = require('../middleware/auth');
const uploads = require('../middleware/upload');
const { createNotification, sendTelegram } = require('./notifications');

const VALID_STATUSES = ['open', 'waiting_info', 'waiting_action', 'waiting_decision', 'resolved', 'closed'];

function getAccess(issueId, userId) {
  const issue = db.prepare('SELECT * FROM issue_talks WHERE id = ?').get(issueId);
  if (!issue) return null;
  if (issue.created_by === userId) return { issue, isCreator: true };
  const part = db.prepare(
    'SELECT 1 FROM issue_talk_participants WHERE issue_id = ? AND user_id = ?'
  ).get(issueId, userId);
  return part ? { issue, isCreator: false } : null;
}

function getParticipants(issueId) {
  return db.prepare(`
    SELECT p.id as part_id, p.added_at, u.id, u.full_name, u.role
    FROM issue_talk_participants p
    JOIN users u ON u.id = p.user_id
    WHERE p.issue_id = ?
    ORDER BY p.added_at
  `).all(issueId);
}

function notifyParticipants(issue, excludeUserId, title, message) {
  const userIds = [
    issue.created_by,
    ...db.prepare('SELECT user_id FROM issue_talk_participants WHERE issue_id = ?')
      .all(issue.id).map(p => p.user_id),
  ].filter((uid, i, arr) => uid !== excludeUserId && arr.indexOf(uid) === i);

  for (const uid of userIds) {
    createNotification(uid, title, message, `/issue-talk/${issue.id}`);
  }
  return userIds;
}

// GET /users — list all active users (for tagging)
router.get('/users', auth, (req, res) => {
  const rows = db.prepare(
    'SELECT id, full_name, role FROM users WHERE is_active = 1 AND id != ? ORDER BY full_name'
  ).all(req.user.id);
  res.json(rows);
});

// GET /suppliers — list active suppliers (for issue context)
router.get('/suppliers', auth, (req, res) => {
  const rows = db.prepare(
    "SELECT id, code, name FROM suppliers WHERE is_active = 1 ORDER BY name"
  ).all();
  res.json(rows);
});

// GET /facets — distinct filter options scoped to user's accessible issues
router.get('/facets', auth, (req, res) => {
  const { filter = 'all' } = req.query;
  const userId = req.user.id;

  let filterSQL, params;
  if (filter === 'mine') {
    filterSQL = 'it.created_by = ?';
    params = [userId];
  } else if (filter === 'tagged') {
    filterSQL = '(it.created_by != ? AND EXISTS (SELECT 1 FROM issue_talk_participants ip WHERE ip.issue_id = it.id AND ip.user_id = ?))';
    params = [userId, userId];
  } else {
    filterSQL = '(it.created_by = ? OR EXISTS (SELECT 1 FROM issue_talk_participants ip WHERE ip.issue_id = it.id AND ip.user_id = ?))';
    params = [userId, userId];
  }

  const statuses = db.prepare(
    `SELECT DISTINCT it.status FROM issue_talks it WHERE ${filterSQL} ORDER BY it.status`
  ).all(...params).map(r => r.status);

  const suppliers = db.prepare(`
    SELECT DISTINCT s.id, s.code, s.name
    FROM issue_talks it
    JOIN suppliers s ON s.id = it.supplier_id
    WHERE ${filterSQL} AND it.supplier_id IS NOT NULL
    ORDER BY s.name
  `).all(...params);

  const taggedUsers = db.prepare(`
    SELECT DISTINCT u.id, u.full_name
    FROM issue_talks it
    JOIN issue_talk_participants itp ON itp.issue_id = it.id
    JOIN users u ON u.id = itp.user_id
    WHERE ${filterSQL}
    ORDER BY u.full_name
  `).all(...params);

  res.json({ statuses, suppliers, tagged_users: taggedUsers });
});

// GET / — list accessible issues
router.get('/', auth, (req, res) => {
  const { filter = 'all', page = 1, limit = 20, q = '', status = '', tagged_user_id = '', supplier_id = '' } = req.query;
  const userId = req.user.id;
  const offset = (+page - 1) * +limit;
  const search = `%${q}%`;

  let filterSQL, params;
  if (filter === 'mine') {
    filterSQL = 'it.created_by = ?';
    params = [userId];
  } else if (filter === 'tagged') {
    filterSQL = '(it.created_by != ? AND EXISTS (SELECT 1 FROM issue_talk_participants ip WHERE ip.issue_id = it.id AND ip.user_id = ?))';
    params = [userId, userId];
  } else {
    filterSQL = '(it.created_by = ? OR EXISTS (SELECT 1 FROM issue_talk_participants ip WHERE ip.issue_id = it.id AND ip.user_id = ?))';
    params = [userId, userId];
  }

  // Extra filters
  let extraSQL = '';
  const extraParams = [];
  if (status && VALID_STATUSES.includes(status)) {
    extraSQL += ' AND it.status = ?';
    extraParams.push(status);
  }
  if (tagged_user_id && !isNaN(+tagged_user_id)) {
    extraSQL += ' AND EXISTS (SELECT 1 FROM issue_talk_participants ip WHERE ip.issue_id = it.id AND ip.user_id = ?)';
    extraParams.push(+tagged_user_id);
  }
  if (supplier_id && !isNaN(+supplier_id)) {
    extraSQL += ' AND it.supplier_id = ?';
    extraParams.push(+supplier_id);
  }

  const rows = db.prepare(`
    SELECT it.id, it.title, it.body, it.status, it.created_by, it.supplier_id, it.created_at, it.updated_at,
      u.full_name as creator_name,
      s.name as supplier_name, s.code as supplier_code,
      (SELECT COUNT(*) FROM issue_talk_participants WHERE issue_id = it.id) as participant_count,
      (SELECT COUNT(*) FROM issue_talk_messages WHERE issue_id = it.id) as message_count,
      (SELECT COUNT(*) FROM issue_talk_attachments WHERE issue_id = it.id AND message_id IS NULL) as opening_attachment_count,
      (SELECT body FROM issue_talk_messages WHERE issue_id = it.id ORDER BY created_at DESC LIMIT 1) as last_message_body,
      (SELECT u2.full_name FROM users u2 JOIN issue_talk_messages m2 ON m2.user_id = u2.id
        WHERE m2.issue_id = it.id ORDER BY m2.created_at DESC LIMIT 1) as last_message_by,
      (SELECT COUNT(*) FROM issue_talk_messages itm
        WHERE itm.issue_id = it.id
        AND itm.user_id != ?
        AND itm.id > COALESCE(
          (SELECT last_read_message_id FROM issue_talk_reads itr
           WHERE itr.issue_id = it.id AND itr.user_id = ?), 0
        )
      ) as unread_count
    FROM issue_talks it
    JOIN users u ON u.id = it.created_by
    LEFT JOIN suppliers s ON s.id = it.supplier_id
    WHERE ${filterSQL}${extraSQL} AND (it.title LIKE ? OR COALESCE(it.body,'') LIKE ?)
    ORDER BY it.updated_at DESC
    LIMIT ? OFFSET ?
  `).all(userId, userId, ...params, ...extraParams, search, search, +limit, offset);

  const total = db.prepare(`
    SELECT COUNT(*) as c FROM issue_talks it
    WHERE ${filterSQL}${extraSQL} AND (it.title LIKE ? OR COALESCE(it.body,'') LIKE ?)
  `).get(...params, ...extraParams, search, search).c;

  res.json({ data: rows, total, page: +page, limit: +limit });
});

// POST / — create issue (multipart/form-data)
router.post('/', auth, uploads.issueTalk.array('files', 10), uploads.verifyMagic, uploads.compressImages, (req, res) => {
  const { title, body, participant_ids, supplier_id } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'กรุณากรอกหัวเรื่อง' });

  let participantIds = [];
  try { participantIds = JSON.parse(participant_ids || '[]'); } catch { participantIds = []; }
  participantIds = participantIds.filter(uid => uid !== req.user.id);

  const supplierId = supplier_id ? +supplier_id : null;

  const createIssue = db.transaction(() => {
    const result = db.prepare(
      "INSERT INTO issue_talks (title, body, status, supplier_id, created_by) VALUES (?, ?, 'open', ?, ?)"
    ).run(title.trim(), body?.trim() || null, supplierId, req.user.id);
    const issueId = result.lastInsertRowid;

    const insParticipant = db.prepare(
      'INSERT OR IGNORE INTO issue_talk_participants (issue_id, user_id) VALUES (?, ?)'
    );
    for (const uid of participantIds) insParticipant.run(issueId, uid);

    if (req.files?.length) {
      const insAttach = db.prepare(
        'INSERT INTO issue_talk_attachments (issue_id, message_id, file_path, original_name, mime_type, size, uploaded_by) VALUES (?, NULL, ?, ?, ?, ?, ?)'
      );
      for (const f of req.files) insAttach.run(issueId, f.filename, f.originalname, f.mimetype, f.size, req.user.id);
    }

    db.auditLog('issue_talks', issueId, 'CREATE', null, { title: title.trim(), participants: participantIds.length }, req.user.id, req.ip);
    return issueId;
  });

  const issueId = createIssue();
  const issue = db.prepare('SELECT * FROM issue_talks WHERE id = ?').get(issueId);
  const creator = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user.id);

  const taggedUsers = participantIds
    .map(uid => db.prepare('SELECT id, full_name, role FROM users WHERE id = ?').get(uid))
    .filter(Boolean);

  for (const u of taggedUsers) {
    createNotification(u.id, `Issue Talk: ${title.trim()}`, `${creator.full_name} ได้ Tag คุณในการสนทนาใหม่`, `/issue-talk/${issueId}`);
  }

  const telegramMsg = `[Issue Talk] ${creator.full_name} เปิดประเด็นใหม่\n${title.trim()}${body ? '\n' + body.trim().slice(0, 120) : ''}\nTag: ${taggedUsers.map(u => u.full_name).join(', ') || '(ไม่มี)'}`;
  const hasPurchasing = taggedUsers.some(u => u.role === 'purchasing');
  const qcGroup = db.getSetting('telegram_group_qc');
  const purchGroup = db.getSetting('telegram_group_purchasing');
  if (qcGroup) sendTelegram(qcGroup, telegramMsg).catch(() => {});
  if (hasPurchasing && purchGroup) sendTelegram(purchGroup, telegramMsg).catch(() => {});

  res.json(issue);
});

// GET /unread-total — total unread messages across all accessible rooms
router.get('/unread-total', auth, (req, res) => {
  const userId = req.user.id;
  const result = db.prepare(`
    SELECT COALESCE(SUM(
      (SELECT COUNT(*) FROM issue_talk_messages itm
        WHERE itm.issue_id = it.id
        AND itm.user_id != ?
        AND itm.id > COALESCE(
          (SELECT last_read_message_id FROM issue_talk_reads itr
           WHERE itr.issue_id = it.id AND itr.user_id = ?), 0
        )
      )
    ), 0) as total
    FROM issue_talks it
    WHERE (it.created_by = ? OR EXISTS (
      SELECT 1 FROM issue_talk_participants ip WHERE ip.issue_id = it.id AND ip.user_id = ?
    ))
  `).get(userId, userId, userId, userId);
  res.json({ total: result.total });
});

// GET /:id — full detail
router.get('/:id', auth, (req, res) => {
  const access = getAccess(+req.params.id, req.user.id);
  if (!access) return res.status(403).json({ error: 'ไม่มีสิทธิ์เข้าถึง' });

  const { issue } = access;
  const creator = db.prepare('SELECT id, full_name, role FROM users WHERE id = ?').get(issue.created_by);
  const supplier = issue.supplier_id
    ? db.prepare('SELECT id, code, name FROM suppliers WHERE id = ?').get(issue.supplier_id)
    : null;
  const participants = getParticipants(issue.id);
  const openingAttachments = db.prepare(
    'SELECT * FROM issue_talk_attachments WHERE issue_id = ? AND message_id IS NULL ORDER BY created_at'
  ).all(issue.id);

  const messages = db.prepare(`
    SELECT m.*, u.full_name as user_name, u.role as user_role
    FROM issue_talk_messages m
    JOIN users u ON u.id = m.user_id
    WHERE m.issue_id = ?
    ORDER BY m.created_at
  `).all(issue.id);

  for (const msg of messages) {
    msg.attachments = db.prepare(
      'SELECT * FROM issue_talk_attachments WHERE message_id = ? ORDER BY created_at'
    ).all(msg.id);
  }

  // Mark all current messages as read for this user
  if (messages.length > 0) {
    const lastMsgId = messages[messages.length - 1].id;
    db.prepare(`
      INSERT INTO issue_talk_reads (issue_id, user_id, last_read_message_id, read_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(issue_id, user_id) DO UPDATE SET
        last_read_message_id = MAX(issue_talk_reads.last_read_message_id, excluded.last_read_message_id),
        read_at = CURRENT_TIMESTAMP
    `).run(issue.id, req.user.id, lastMsgId);
  }

  const reads = db.prepare(
    'SELECT user_id, last_read_message_id FROM issue_talk_reads WHERE issue_id = ?'
  ).all(issue.id);

  res.json({
    ...issue,
    creator,
    supplier,
    participants,
    opening_attachments: openingAttachments,
    messages,
    reads,
    is_creator: access.isCreator,
  });
});

// POST /:id/messages — post reply (multipart/form-data)
router.post('/:id/messages', auth, uploads.issueTalk.array('files', 10), uploads.verifyMagic, uploads.compressImages, (req, res) => {
  const access = getAccess(+req.params.id, req.user.id);
  if (!access) return res.status(403).json({ error: 'ไม่มีสิทธิ์เข้าถึง' });

  const { body } = req.body;
  if (!body?.trim() && !req.files?.length) {
    return res.status(400).json({ error: 'กรุณากรอกข้อความหรือแนบไฟล์' });
  }

  const { issue } = access;
  if (issue.status === 'closed') {
    return res.status(400).json({ error: 'การสนทนานี้ถูกปิดแล้ว ไม่สามารถตอบกลับได้' });
  }

  const postMsg = db.transaction(() => {
    const msgResult = db.prepare(
      'INSERT INTO issue_talk_messages (issue_id, user_id, body) VALUES (?, ?, ?)'
    ).run(issue.id, req.user.id, body?.trim() || '');
    const msgId = msgResult.lastInsertRowid;

    if (req.files?.length) {
      const insAttach = db.prepare(
        'INSERT INTO issue_talk_attachments (issue_id, message_id, file_path, original_name, mime_type, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      for (const f of req.files) insAttach.run(issue.id, msgId, f.filename, f.originalname, f.mimetype, f.size, req.user.id);
    }

    db.prepare('UPDATE issue_talks SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(issue.id);

    // Auto-mark sender's own message as read
    db.prepare(`
      INSERT INTO issue_talk_reads (issue_id, user_id, last_read_message_id, read_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(issue_id, user_id) DO UPDATE SET
        last_read_message_id = MAX(issue_talk_reads.last_read_message_id, excluded.last_read_message_id),
        read_at = CURRENT_TIMESTAMP
    `).run(issue.id, req.user.id, msgId);

    return msgId;
  });

  const msgId = postMsg();

  // ไม่ส่ง notification ไปที่กระดิ่ง — ใช้ badge บน menu แทน

  const msg = db.prepare(`
    SELECT m.*, u.full_name as user_name, u.role as user_role
    FROM issue_talk_messages m JOIN users u ON u.id = m.user_id
    WHERE m.id = ?
  `).get(msgId);
  msg.attachments = db.prepare(
    'SELECT * FROM issue_talk_attachments WHERE message_id = ? ORDER BY created_at'
  ).all(msgId);

  res.json(msg);
});

// PATCH /:id/status — update status (creator only)
router.patch('/:id/status', auth, (req, res) => {
  const access = getAccess(+req.params.id, req.user.id);
  if (!access || !access.isCreator) return res.status(403).json({ error: 'เฉพาะผู้สร้างเท่านั้น' });

  const { status } = req.body;
  if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'สถานะไม่ถูกต้อง' });

  const { issue } = access;
  db.prepare('UPDATE issue_talks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, issue.id);
  db.auditLog('issue_talks', issue.id, 'STATUS_CHANGE', { status: issue.status }, { status }, req.user.id, req.ip);

  res.json({ ok: true, status });
});

// PATCH /:id/participants — add more participants (creator only)
router.patch('/:id/participants', auth, (req, res) => {
  const access = getAccess(+req.params.id, req.user.id);
  if (!access || !access.isCreator) return res.status(403).json({ error: 'เฉพาะผู้สร้างเท่านั้น' });

  const { user_ids } = req.body;
  if (!Array.isArray(user_ids) || !user_ids.length) return res.status(400).json({ error: 'ระบุ user_ids' });

  const { issue } = access;
  const ins = db.prepare('INSERT OR IGNORE INTO issue_talk_participants (issue_id, user_id) VALUES (?, ?)');
  const adder = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user.id);

  for (const uid of user_ids) {
    if (uid === req.user.id) continue;
    const r = ins.run(issue.id, uid);
    if (r.changes > 0) {
      createNotification(uid, `Issue Talk: ${issue.title}`, `${adder.full_name} ได้เพิ่มคุณเข้าในการสนทนา`, `/issue-talk/${issue.id}`);
    }
  }

  db.prepare('UPDATE issue_talks SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(issue.id);
  res.json({ ok: true, participants: getParticipants(issue.id) });
});

// DELETE /:id — ลบห้องสนทนาพร้อมไฟล์ทั้งหมด (เฉพาะผู้สร้าง + ต้องปิดแล้วเท่านั้น)
router.delete('/:id', auth, (req, res) => {
  const access = getAccess(+req.params.id, req.user.id);
  if (!access || !access.isCreator) return res.status(403).json({ error: 'เฉพาะผู้สร้างห้องเท่านั้นที่ลบได้' });

  const { issue } = access;
  if (issue.status !== 'closed') return res.status(400).json({ error: 'ลบได้เฉพาะห้องที่ปิดแล้ว (closed) เท่านั้น' });

  const allFiles = db.prepare('SELECT file_path FROM issue_talk_attachments WHERE issue_id = ?').all(issue.id);

  const doDelete = db.transaction(() => {
    db.prepare('DELETE FROM issue_talk_reads WHERE issue_id = ?').run(issue.id);
    db.prepare('DELETE FROM issue_talk_attachments WHERE issue_id = ?').run(issue.id);
    db.prepare('DELETE FROM issue_talk_messages WHERE issue_id = ?').run(issue.id);
    db.prepare('DELETE FROM issue_talk_participants WHERE issue_id = ?').run(issue.id);
    db.prepare('DELETE FROM issue_talks WHERE id = ?').run(issue.id);
    db.auditLog('issue_talks', issue.id, 'DELETE', { title: issue.title, status: 'closed' }, null, req.user.id, req.ip);
  });

  doDelete();

  const uploadDir = path.join(__dirname, '../../uploads/issue-talk');
  for (const { file_path } of allFiles) {
    try { fs.unlinkSync(path.join(uploadDir, file_path)); } catch (_) {}
  }

  res.json({ ok: true });
});

module.exports = router;
