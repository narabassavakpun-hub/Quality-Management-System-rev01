> 📁 **IPQC/FQC module doc** — ภาพรวมทั้งระบบดู [`../../AUDIT.md`](../../AUDIT.md) §2 · [`../../CLAUDE.md`](../../CLAUDE.md) · [index](README.md) · ⚠️ อาจไม่รวม FG/FNCP/FUAI (Session 82–87)

# System Architecture — IPQC/FQC Module

Part of the IQC Quality Management System. This document covers the production-floor QC module (IPQC + FQC) added on top of the existing IQC (receiving) system.

## 1. Stack

| Layer | Tech |
|-------|------|
| Frontend | React 18 + Vite 5, Tailwind 3, React Router 6, React Query 5, recharts 2 |
| Backend | Express 4 (Node), better-sqlite3 12 (synchronous) |
| Auth | JWT in httpOnly cookie + per-user `session_token` (single-session) |
| Files | local `/uploads`, multer + magic-number check + sharp compression |
| Realtime | SSE (`db.pushSSE` / `db.broadcastSSE`) |
| Notify | in-app `notifications` + Telegram (group + per-user) |
| Export | exceljs (xlsx) |

## 2. Backend layout (`iqc-system/server`)

```
db/
  schema.sql        all CREATE TABLE IF NOT EXISTS (incl. 16 IPQC/FQC tables)
  database.js       opens DB, runs initSchema → migrate → seedData; exposes
                    db.auditLog, db.getSetting, db.next{IPQC,FQC}Code, sequences
  migrate.js        one-time migration framework (schema_migrations table)
lib/
  validate.js       schema validator + validateBody() middleware + asPartial()
  crud.js           makeCrudRouter() — reusable master CRUD (list/get/create/
                    update/toggle/delete + audit + transaction)
  notify.js         getUsersByRole, notifyRoles, createNotification, sendTelegram
services/
  proCodeClassifier.js  SAP product-no → attributes (parse + similarity + rules)
middleware/
  auth.js           verifies JWT cookie + session_token, attaches req.user
  requireRole.js    requireRole([...]) guard
  upload.js         multer buckets (ipqc/fqc images) + xlsxUpload + verifyMagic + compress
routes/
  ipqcMaster.js     /api/ipqc/master/*  (lines, managers, process, defect-types, fm, shifts, thresholds)
  ipqc.js           /api/ipqc/*         (records, status, images, summary, export)
  fqc.js            /api/fqc/*          (records, monthly, approve, summary, export)
  proCodeSap.js     /api/pro-code-sap/* (queue, classify, confirm, export)
  pdPlan.js         /api/pd-plan/*      (Excel import, list)
index.js            app wiring, rate limits, static, route mounts
```

## 3. Frontend layout (`iqc-system/client/src`)

```
pages/IPQC/    index (list), New (4-step form), Detail
pages/FQC/     index (list), New (4-step form), Detail, Monthly (approval grid), Dashboard
pages/Admin/   ProductionMaster (6-tab master), ProCodeSap (import + classify queue)
components/UI/ CrudPanel (reusable table+modal CRUD), Badge, Button, Modal, ConfirmDialog, Pagination
utils/         api.js (axios, baseURL /api, withCredentials), rolePermissions.js (NAV_ITEMS, STATUS_LABELS)
```

## 4. Request lifecycle

```
Browser ──(cookie token)──▶ Express
  rateLimit → auth (JWT+session) → requireRole → validateBody
    → handler: db.transaction { writes + db.auditLog + notify }
  ◀── JSON { data,total,page,limit } | { id, ... } | { error, errors[] }
SSE pushes invalidate React Query caches; Telegram fire-and-forget.
```

## 5. Key design patterns

- **Reusable CRUD factory** (`lib/crud.js`): master entities are declared as config (table, schema, filters, joins, hooks); the factory generates REST + audit + soft-delete. Frontend mirror is `CrudPanel`.
- **Atomic document codes**: `record_no` (IPQC/FQC-YYYY-NNNN) via `document_sequences` race-safe `UPDATE ... RETURNING`; `defect_code` = `factory_code+fm+process+defect_type` generated server-side inside the create transaction.
- **Classifier service**: pure functions (`parseProductNo`, `parsePart3`) + DB-aware `classify()` (similarity match against confirmed rows + admin rules). Documented in `/brand.md`.
- **Threshold resolution** (FQC): product-specific → line-specific → global default (3%) decides pass/fail at write time; `defect_rate` stored, never recomputed in list queries.
- **Role scoping**: `production_manager` is filtered to assigned lines (`production_line_managers`) in every list/detail/summary/export query.

## 6. Domain boundary (important)

`products` (raw material, IQC receiving) and `pro_code_sap` (finished goods, IPQC/FQC) are **different domains**. IPQC/FQC reference `pro_code_sap_id`, never `products`.
