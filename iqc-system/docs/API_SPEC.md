> 📁 **IPQC/FQC module doc** — API ทั้งระบบดู [`../../AUDIT.md`](../../AUDIT.md) §6 · [index](README.md) · ⚠️ IPQC/FQC record routes ยัง "planned" (ยังไม่มี `/api/fqc`, `/api/ipqc` จริง)

# API Spec — IPQC/FQC Module

**Base URL:** `/api` · **Auth:** JWT in httpOnly cookie `token` (obtain via `POST /api/auth/login`)
**Status:** Phase 0 (ProCodeSAP + PDPlan) and Phase 1 (Master data) — **implemented & tested**. IPQC/FQC record endpoints — *planned (Phase 2–3)*.

Conventions:
- List endpoints return `{ data: [...], total, page, limit }`.
- Write endpoints require role per the matrix; unauthorized → `403 { error }`.
- Validation failure → `400 { error, errors: [...] }` (first message in `error`).
- Duplicate unique → `409`. Missing → `404`. Unauthenticated → `401`.
- All writes are wrapped in a DB transaction and recorded in `audit_logs`.

---

## 1. Master data — `/api/ipqc/master`

All write operations require role **admin** (thresholds also allow **qc_manager**). All reads require any authenticated user.

### 1.1 Common CRUD shape (production-lines, fm-categories, shifts, process-steps, defect-types, thresholds)

| Method | Path | Role | Notes |
|--------|------|------|-------|
| GET | `/{entity}` | any | `?page&limit&q&active=1\|0` + entity filters |
| GET | `/{entity}/:id` | any | 404 if missing |
| POST | `/{entity}` | admin | validated; 201 `{ id }` |
| PATCH | `/{entity}/:id` | admin | partial update |
| DELETE | `/{entity}/:id` | admin | soft-delete (`is_active=0`) except thresholds (hard) |

### 1.2 production-lines
Body (POST): `code*`, `name*`, `line_type*` (`alu|upvc|other`), `factory*`, `factory_code*`, `pdplan_sheet`
- GET returns each row with `managers: [{ user_id, full_name }]`.
- `POST /production-lines/:id/managers` `{ user_id }` — assign a `production_manager`; 400 if user role ≠ production_manager.
- `DELETE /production-lines/:id/managers/:userId` — unassign.
- `GET /manager-users` — list assignable `production_manager` users.

### 1.3 fm-categories
Body: `name*`, `code*` (unique). Used in Defect Code generation.

### 1.4 shifts
Body: `name*`, `start_time`, `end_time`.

### 1.5 process-steps
Body: `production_line_id` (NULL = all lines), `name*`, `code*`, `sort_order`.
Filter: `?line_id=` (matches that line **or** global NULL). Returns `line_name`.

### 1.6 defect-types
Body: `production_line_id`, `fm_category_id`, `name*`, `code*`.
Filters: `?line_id=` (line or global), `?fm_category_id=`. Returns `line_name`, `fm_name`.

### 1.7 thresholds (`defect_rate_thresholds`)
Role: **admin, qc_manager**. Hard delete. NULL line + NULL product = global default (seeded 3%).
Body: `production_line_id`, `pro_code_sap_id`, `threshold_pct*` (0–100), `effective_date` (YYYY-MM-DD). `created_by` stamped server-side.

---

## 2. ProCodeSAP — `/api/pro-code-sap`

Finished-goods master with auto-classified attributes (replaces Excel Sheet8).

| Method | Path | Role | Notes |
|--------|------|------|-------|
| GET | `/` | any | `?status&q&brand&line_type&page&limit`; pending/auto sorted first |
| GET | `/search` | any | `?q&limit` — **confirmed only**, for IPQC/FQC product picker |
| GET | `/filter-options` | any | distinct confirmed values per attribute (dropdowns) |
| GET | `/:id` | any | |
| POST | `/` | admin | `{ product_no*, product_desc }` → auto-classify, status `auto`, returns `{ id, suggested, confidence }` |
| PATCH | `/:id` | admin | edit any attribute (`line_type, brand, panel_color, ...` + `product_desc`) |
| POST | `/:id/confirm` | admin | status→`confirmed` (optimistic lock); back-links `pd_plans` rows |
| POST | `/:id/reject` | admin | status→`rejected` |
| POST | `/auto-classify` | admin | re-run classifier on all `pending`/`auto` → `{ updated }` |
| GET | `/export/excel` | admin, qc_manager | xlsx download |

`classify_status`: `pending → auto → confirmed` (or `rejected`). `auto_confidence` 0–100.

---

## 3. PDPlan — `/api/pd-plan`

Production plan imported from the Planning team's Excel (replaces Excel Sheet3).

| Method | Path | Role | Notes |
|--------|------|------|-------|
| POST | `/import` | admin | multipart `file` (.xlsx). Scans every sheet, auto-detects header row, maps sheet→line via `pdplan_sheet`, auto-creates unknown SAP codes. |
| GET | `/` | any | `?line_id&product_no&due_from&due_to&q&page&limit` |

**Import response:**
```json
{
  "imported": 115, "updated": 0, "skipped": 30192,
  "new_sap_codes": ["FUS09-W22612-120110", "..."],
  "unmapped_sheets": [],
  "sheets": [{ "sheet": "0115", "rows": 35, "line_id": 1 }],
  "errors": []
}
```
Import notes:
- Header row located by scanning rows 1–12 for `Product No.` (ALU files use row 5, uPVC row 3).
- Doc number read from `Doc. No.`, falling back to a `SO.` column when blank (sheets 0117/0119/0121).
- Rows whose Product No. isn't a `X-X-N` SAP code are skipped (footers/blank rows).
- Upsert key: `(doc_no, product_no)`.

---

## 4. IPQC records — `/api/ipqc`

In-process QC defect records (1 defect per record + up to 15 photos).

| Method | Path | Role | Notes |
|--------|------|------|-------|
| POST | `/` | qc_staff, qc_supervisor | create; atomic `record_no` + `defect_code` gen + notify + audit |
| GET | `/` | any* | `?page&limit&date_from&date_to&line_id&status&defect_type_id&fm_category_id&q` |
| GET | `/:id` | any* | full detail + `images[]` + joined names |
| PATCH | `/:id` | owner (≤24h, open) / supervisor / manager | edit `defect_qty,total_qty,description,responsible_*,shift_id` |
| PATCH | `/:id/status` | qc_supervisor, qc_manager | transition (optimistic lock) |
| POST | `/:id/images` | owner / supervisor / manager | multipart `images` (≤15 total), magic-number checked + compressed |
| DELETE | `/:id/images/:imageId` | owner / supervisor / manager | removes file + row |

`*` **production_manager** sees/accesses only lines assigned in `production_line_managers` (list filtered, detail → 403 otherwise).

**Create body:**
```json
{
  "found_date": "2026-06-24",      // ≤ today, ≥ today-7
  "pro_code_sap_id": 12,
  "production_line_id": 1,
  "process_step_id": 3,
  "fm_category_id": 2,
  "defect_type_id": 8,
  "defect_qty": 5,                  // > 0
  "total_qty": 100,                 // optional, ≥ defect_qty
  "shift_id": 1,                    // optional
  "po_number": "...",               // optional
  "description": "...",             // optional
  "responsible_user_id": 4,         // user_id OR responsible_name required
  "responsible_name": "สมชาย"
}
```
Response: `{ id, record_no: "IPQC-2026-0001", defect_code: "01McTC001" }`
Defect code = `factory_code + fm.code + process_step.code + defect_type.code`.

**Status transitions:**
| From | To (role) |
|------|-----------|
| open | in_progress / closed (supervisor, manager), cancelled (manager) |
| in_progress | open / closed (supervisor, manager), cancelled (manager) |
| closed / cancelled | — (terminal) |

Closing stamps `closed_at`/`closed_by` and notifies the creator.

---

## 5. Error codes

| Code | Meaning |
|------|---------|
| 400 | Validation failed (`errors[]`) or no updatable fields |
| 401 | Not logged in / session invalid |
| 403 | Role not permitted |
| 404 | Record not found |
| 409 | Unique conflict / FK-referenced / already confirmed |
| 500 | Unexpected server error |

---

## 6. FQC records — `/api/fqc`

Final-QC daily lot output with multi-defect breakdown + monthly approval.

| Method | Path | Role | Notes |
|--------|------|------|-------|
| POST | `/` | qc_staff, qc_supervisor | create; auto defect_qty/defect_rate/result vs threshold + notify on fail |
| GET | `/` | any* | `?page&limit&date_from&date_to&line_id&result&q`; returns `pass_qty` |
| GET | `/monthly` | qc_manager, cpo, production_manager, admin | `?year&month` → per-line totals + approval state |
| POST | `/monthly/approve` | qc_manager, production_manager, cpo | `{year,month,production_line_id?,remarks?}` |
| GET | `/:id` | any* | detail + `defect_items[]` + `images[]` + `pass_qty` |
| PATCH | `/:id` | owner (≤24h) / supervisor / manager | edit total/items/remarks → recomputes rate+result |
| POST | `/:id/images`, DELETE `/:id/images/:imageId` | owner / supervisor / manager | ≤15 |

`*` production_manager scoped to assigned lines.

**Create body:**
```json
{
  "inspect_date": "2026-06-25",
  "pro_code_sap_id": 12, "production_line_id": 1, "shift_id": 1,
  "total_qty": 100,
  "defect_items": [{ "defect_type_id": 8, "qty": 4 }, { "defect_type_id": 9, "qty": 2 }],
  "po_number": "...", "remarks": "..."
}
```
Response: `{ id, record_no: "FQC-2026-0001", defect_rate: 6, result: "fail" }`
- `defect_qty` = Σ items; `defect_rate` = defect_qty/total_qty×100 (2dp, stored)
- `result` = `pass` if defect_rate ≤ threshold else `fail`. Threshold resolves: product-specific → line-specific → global (default 3%).

**Monthly approval order (enforced):** QC Manager (overall) → Production Manager (per assigned line, only lines with defects) → CPO (overall, requires QC + all line PMs done). Re-approval → 409.

---

## 7. Dashboard + Export

| Method | Path | Role | Notes |
|--------|------|------|-------|
| GET | `/api/ipqc/summary` | any* | `{ today_count, today_defect_qty, open_count, trend[7d], pareto[top10/30d] }` |
| GET | `/api/fqc/summary` | any* | `{ today_lots, today_produced, today_defect_rate, trend[7d], pareto, results }` |
| GET | `/api/ipqc/export` | any* | Excel (xlsx) of records; filters `date_from/to,line_id,status`; **5 req/min** |
| GET | `/api/fqc/export` | any* | Excel; filters `date_from/to,line_id,result`; **5 req/min** |

`*` production_manager scoped to assigned lines. Both export endpoints write an `EXPORT` audit row and stream `Content-Disposition: attachment`.

## 8. Planned — not yet implemented
- PDF export of records / monthly report (Excel done)
