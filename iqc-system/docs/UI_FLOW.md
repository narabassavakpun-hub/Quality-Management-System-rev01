> 📁 **IPQC/FQC module doc** — dashboard/flow ทั้งระบบดู [`../../design-dashboard.md`](../../design-dashboard.md) · [index](README.md) · ⚠️ path บางรายการ (`/ipqc`, `/fqc`) อาจต่างจาก route จริง (`/production-qc/*`) — ตรวจ `rolePermissions.js`

# UI Flow — IPQC/FQC Module

## 1. Navigation (sidebar group "QC หน้างาน", icon: factory)

| Item | Path | Roles |
|------|------|-------|
| Dashboard | `/production-qc/dashboard` | all QC roles + cpo + production_manager |
| IPQC ของเสีย | `/ipqc` | admin, qc_staff, qc_supervisor, qc_manager, cpo, production_manager |
| FQC ผลผลิต | `/fqc` | same |
| รายงานรายเดือน | `/fqc/monthly` | admin, qc_manager, cpo, production_manager |

Admin section adds: **Master หน้างาน** (`/admin/production-master`) and **ProCodeSAP & PDPlan** (`/admin/procode-sap`).

## 2. Admin setup flow (one-time / ongoing)

```
/admin/production-master
  สายผลิต tab → create line (code,name,type,factory,factory_code,pdplan_sheet)
              → ผู้รับผิดชอบ → assign production_manager(s)
  ประเภทของเสีย tab → create defect types (line/global + FM + code)
  (process/fm/shifts/thresholds as needed)

/admin/procode-sap
  นำเข้า PDPlan tab → upload Planning .xlsx → summary (added/updated/new SAP codes)
  จำแนก ProCodeSAP tab → review auto-classified codes
              → [ยืนยัน] (confirm) / [แก้ไข] (edit 14 attrs) / [ปฏิเสธ]
   only confirmed codes appear in IPQC/FQC product pickers
```

## 3. Worker — record IPQC (`/ipqc/new`, 4 steps)

```
1 สินค้า   search ProCodeSAP (confirmed only) → attribute chips; optional PO
2 การผลิต  found_date (≤today, ≥today-7), line → process (line-filtered), shift
3 ของเสีย  FM (radio) → defect type (line+FM); LIVE defect_code preview;
           qty, total, responsible, notes
4 รูปภาพ   camera/upload grid ≤15
→ submit: POST /ipqc then POST /ipqc/:id/images → redirect to detail
```

IPQC detail: info + gallery + status buttons (supervisor/manager): open→in_progress→closed; cancel (manager only).

## 4. Worker — record FQC (`/fqc/new`, 4 steps)

```
1 สินค้า   search ProCodeSAP; optional PO
2 การตรวจ  inspect_date, line, shift
3 ของเสีย  total_qty + dynamic defect rows (type+qty);
           LIVE rate + estimated pass/fail vs resolved threshold
4 รูปภาพ   ≤15
→ submit: server computes authoritative result → detail
```

FQC detail: info + defect-items table + gallery + result badge.

## 5. Monthly approval (`/fqc/monthly`)

```
month/year selector → grid
  Overall:  QC Manager [รับทราบ] ──▶ enables ──▶ CPO [รับทราบ]
  Per line: Production Manager [รับทราบ] (only assigned lines with defects)
Order enforced by backend; months with no defects show "—".
Buttons appear only for the matching role with prerequisites met.
```

## 6. Lists & Dashboard

- **List pages**: filters (search/line/status-or-result/date range) + pagination (20) + **Export Excel** + responsive (mobile cards / desktop table). production_manager sees only assigned lines.
- **Dashboard**: 4 summary cards (IPQC today/open, FQC today/rate) + FQC rate line chart (7d) + IPQC defect bar (7d) + Pareto of top defects (30d).

## 7. Status colors (Badge / STATUS_LABELS)
IPQC: open=blue, in_progress=yellow, closed=green, cancelled=red.
FQC: pass=green, fail=red, conditional_pass=yellow.
ProCodeSAP: pending=orange, auto=yellow, confirmed=green, rejected=red.
