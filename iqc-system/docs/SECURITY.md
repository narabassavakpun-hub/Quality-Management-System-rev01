> 📁 **IPQC/FQC module doc** — security ทั้งระบบ (OWASP‑ranked) ดู [`../../AUDIT.md`](../../AUDIT.md) §7 · [index](README.md)

# Security — IPQC/FQC Module

The module reuses the system's existing security middleware. This documents what it enforces and the module-specific controls.

## 1. Authentication
- JWT in an **httpOnly cookie** (`token`), `secure` in production, `sameSite=strict`.
- Every request re-validates against the DB: `session_token` must match (single active session) and the user must be `is_active=1`. Role is read **live** from the DB each request, so a role change / deactivation takes effect immediately ([middleware/auth.js](../server/middleware/auth.js)).
- All IPQC/FQC routes require auth; public/supplier endpoints are not part of this module.

## 2. Authorization (least privilege)
- `requireRole([...])` on every write. Matrix highlights:
  - create IPQC/FQC → `qc_staff`, `qc_supervisor` only
  - IPQC status change → `qc_supervisor`, `qc_manager`
  - master data + ProCodeSAP + PDPlan import → `admin`
  - monthly approve → role-specific (`qc_manager` / `production_manager` / `cpo`) with **enforced order**
- **Row-level scoping**: `production_manager` is filtered to assigned lines (`production_line_managers`) in every list / detail / summary / export / monthly query — both for visibility (list omits) and access (detail → 403).
- Edit windows: record owners may edit only their own **open** record within **24h**; otherwise supervisor/manager.

## 3. Input validation
- Server-side schema validation ([lib/validate.js](../server/lib/validate.js)) on all master + record creates (type/range/enum/length/date). Client validation is convenience only.
- Business-rule checks server-side: date window (≤today, ≥today-7), `defect_qty ≤ total_qty`, FK existence, defect-item integrity.
- All SQL uses **parameterized** statements (better-sqlite3 prepared statements) — no string interpolation of user input into SQL.

## 4. File upload hardening ([middleware/upload.js](../server/middleware/upload.js))
- **Magic-number check** (`verifyMagic`) — file content, not the client MIME/extension, decides type; mismatches rejected (blocks SVG/HTML masquerading as images → stored XSS).
- Files renamed to random names; extension forced to match detected type. Originals kept only in DB `original_name`.
- Image-only filter for IPQC/FQC; xlsx import kept in memory (`memoryStorage`), parsed, discarded.
- Limits: 15 images/record, 15 MB each (xlsx 25 MB); sharp downscales to ≤1920px.

## 5. Rate limiting
- Global `/api` 200/min; **exports** `/api/{ipqc,fqc}/export` **5/min** (CLAUDE §13); login 5/15min.

## 6. Auditability
- Every create/update/status/approve/export runs `db.auditLog(table, recordId, action, old, new, userId, ip)` **inside the same transaction** as the write — no audit gaps on rollback.
- Actions recorded: CREATE / UPDATE / CLOSE / APPROVE / DEACTIVATE / ACTIVATE / DELETE / EXPORT.

## 7. Data integrity
- Writes wrapped in `db.transaction` (atomic record + items + images + audit + notify).
- Optimistic-lock on IPQC status transitions (`UPDATE ... WHERE id=? AND status=?`).
- Document codes generated server-side only; immutable after insert.
- Foreign keys `ON` with RESTRICT from records to master (no orphaning / no deleting referenced master).

## 8. Notifications
- Telegram send is fire-and-forget and never blocks or crashes a request (CLAUDE §12); sent as plain text (no HTML parse_mode) to avoid injection.
- SSE pushes only invalidation hints (`{ link }`), no sensitive payloads.

## 9. Known gaps / follow-ups
- No automated frontend security tests (covered by build only).
- ProCodeSAP edit is admin-trusted (free-text attributes); values are display-only, not executed.
