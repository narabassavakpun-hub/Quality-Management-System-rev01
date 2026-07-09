> ⚠️ **DEPRECATED (2026-07-02)** — รวมเข้า [`../../testcase.md`](../../testcase.md) แล้ว เก็บไว้เป็นประวัติ

# Test Cases — IPQC/FQC Module

Runner: Node's built-in `node:test`. **Run:** `cd server && npm test` (i.e. `node --test`). Each test file sets `IQC_DB_PATH` to a temp DB so runs are isolated and non-destructive.

**Current status: 82 passing / 0 failing** (full suite, incl. pre-existing IQC tests).

## Test files

| File | Type | Focus |
|------|------|-------|
| `test/ipqcUnit.test.js` | unit | validator + ProCodeSAP classifier (no DB) |
| `test/ipqcMaster.test.js` | integration | master CRUD factory + managers |
| `test/ipqc.test.js` | integration | IPQC records + summary/export |
| `test/fqc.test.js` | integration | FQC records + monthly approval + summary/export |
| `test/unit.test.js`, `test/integration.test.js` | (pre-existing) | IQC receiving / security helpers |

## Coverage by area

### Validator + Classifier (unit)
- required/int-range/enum/optional/date validation
- parse ALU + FU codes (line_type, series F100/S85/ECO, brand, color, size)
- `parsePart3` split + decimals; mosquito-net negative-form ("ไม่มีมุ้ง") not misread

### Master CRUD (integration)
- auth required (401); seeded FM categories present
- create line 201; validation 400 (missing/invalid enum); duplicate 409; permission 403 (qc_staff)
- get-with-managers; PATCH update; soft-delete excludes from `active=1`; **toggle reactivates**
- assign/unassign production_manager (role check → 400 for non-PM); defect-type line+FM filter
- threshold create → hard delete → 404; audit rows (CREATE/UPDATE/DEACTIVATE)

### IPQC records (integration)
- create 201 with `record_no` + computed `defect_code`
- validation: missing field, future date, backdate >7d, total<defect, missing responsible (all 400)
- permission: qc_manager cannot create (403)
- list filter; detail (images + joins); **production_manager line scoping** (hidden + 403)
- status: staff blocked (403); open→in_progress→closed; invalid closed→open (400); edit-when-closed (403); owner edit (200)
- summary (today/trend/pareto); export returns xlsx attachment; audit CREATE+CLOSE

### FQC records + monthly (integration)
- create pass (2% ≤ 3%) and fail (6% > 3%) with correct `defect_rate`/`result`
- validation: defect sum > total, future date, missing total (400); qc_manager create (403)
- list `result` filter + `pass_qty`; detail with `defect_items`; PM scoping
- **edit recompute**: change items → result flips fail→pass
- **monthly approval chain**: cpo/pm before qc → 409; qc → 201; double qc → 409;
  pm unassigned line → 403; cpo before pm done → 409; pm assigned → 201; cpo after all → 201
- summary (rate/trend/pareto); export xlsx

## Manual / not automated
- Frontend (built & type-checked via `npm run build`; no component tests)
- Telegram delivery, SSE push (fire-and-forget; logged, never block)
- PDF export (not implemented)
