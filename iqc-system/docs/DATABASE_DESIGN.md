> 📁 **IPQC module doc** — DB ทั้งระบบ (101 ตาราง) ดู [`../../AUDIT.md`](../../AUDIT.md) §5 · [index](README.md) · ⚠️ อาจไม่รวม FG/FNCP/FUAI (Session 82–87)
>
> ⚠️ **เอกสารนี้ล้าสมัยอย่างมาก (พบ Session 104):** ส่วน "Records" ด้านล่างอธิบาย `ipqc_records`/`fqc_records`
> ซึ่งพิสูจน์แล้วว่าเป็น **dead table ทั้งคู่** — ไม่มี route ใดใช้งานจริงเลย (`fqc_records` ถูกลบออกจาก schema แล้ว
> Session 104; `ipqc_records` ยังไม่ลบแต่ก็ dead เหมือนกัน รอ user ตัดสินใจ — ดู `AUDIT.md` D6)
> ตัวจริงที่ใช้งานคือ **`ipqc_inspections`** ผ่าน `server/routes/ipqcInspection.js` (data model ต่างจากที่เอกสารนี้อธิบายทั้งหมด
> — AQL-sampling + checklist items แทนที่จะเป็น 1-defect-per-record) **ควรเขียนเอกสารนี้ใหม่ทั้งหมดโดยอ้างอิงจาก
> `ipqcInspection.js` จริง** (ไม่ทำในรอบนี้ — นอกขอบเขต) ห้ามใช้เนื้อหาด้านล่างเป็นอ้างอิงสำหรับโค้ดใหม่

# Database Design — IPQC Module (⚠️ ล้าสมัย ดูคำเตือนด้านบน)

SQLite (better-sqlite3), WAL mode, `foreign_keys = ON`. All tables are `CREATE TABLE IF NOT EXISTS` in [server/db/schema.sql](../server/db/schema.sql).

## 1. Entity groups (⚠️ ล้าสมัย — ดูคำเตือนบนสุด)

```
ProCodeSAP / Planning            Master
─────────────────────            ──────
pro_code_sap ◀──┐                production_lines ◀──┐
sap_parse_rules │                production_line_managers
pd_plans ───────┘                fm_categories
                                 process_steps
                                 defect_types ──▶ fm_categories
                                 shifts
                                 defect_rate_thresholds
```

## 2. Tables

### ProCodeSAP & Planning
| Table | Purpose | Key columns |
|-------|---------|-------------|
| `pro_code_sap` | finished-goods master (replaces Excel Sheet8) | `product_no` UNIQUE, sap_part1/2/3, 13 attribute cols, `classify_status` (pending/auto/confirmed/rejected), `auto_confidence` |
| `sap_parse_rules` | admin parse rules applied by classifier | `rule_type`, `match_value`, `target_field`, `set_value`, `priority` |
| `pd_plans` | imported production plan (replaces Sheet3) | UNIQUE(`doc_no`,`product_no`), `production_line_id`, `pro_code_sap_id`, `source_sheet` |

### Master
| Table | Purpose | Notes |
|-------|---------|-------|
| `production_lines` | line/factory | `factory_code` (used in defect code), `pdplan_sheet` (CSV of sheet codes), `is_active` |
| `production_line_managers` | line ↔ production_manager user | UNIQUE(line,user), ON DELETE CASCADE |
| `fm_categories` | Man/Machine/Material/Method | `code` UNIQUE |
| `process_steps` | NULL line = global | `code`, `sort_order` |
| `defect_types` | NULL line = global | FK `fm_category_id`, `code` |
| `shifts` | production shifts | |
| `defect_rate_thresholds` | pass/fail threshold | NULL line + NULL product = global default (seeded 3%) |

### Records — ⚠️ DEAD TABLES, ไม่ตรงกับความจริง (ดูคำเตือนบนสุด)
| Table | สถานะ |
|-------|-------|
| ~~`ipqc_records`~~ | **Dead** — ไม่มี route ใช้ (ดู AUDIT.md D6) ตัวจริงคือ `ipqc_inspections` (`ipqcInspection.js`) |
| ~~`ipqc_images`~~ | Dead (child ของ `ipqc_records`) — ตัวจริงคือ `ipqc_inspection_images` |
| ~~`fqc_records`/`fqc_defect_items`/`fqc_images`/`fqc_monthly_approvals`~~ | **ลบออกจาก schema แล้ว (Session 104)** — dead feature, superseded by `fgqc_records` |

## 3. Indexes (all `IF NOT EXISTS`)

Every FK / filter column is indexed: `pro_code_sap(product_no,brand,line_type,status,color,size)`, `pd_plans(product_no,due_date,line,sap)` — ดู `ipqc_inspections`/`fgqc_records` indexes ใน `schema.sql` โดยตรง (ไม่ทวนซ้ำที่นี่เพื่อกัน drift ซ้ำ)

## 4. Integrity rules

- **Soft delete** for master (`is_active=0` via `/toggle` or DELETE); **hard delete** only for `defect_rate_thresholds`.
- **ON DELETE RESTRICT** from records to master (can't delete a line/defect-type in use).
- **defect_rate/overall_result** is computed once at write and stored; never recomputed in SELECT.

## 5. Seed data (on first init)
FM categories (Mn/Mc/Mt/Md), 12 process steps (global), 3 shifts, global 3% threshold, IPQC sequence (FQC sequence removed Session 104). Lines and defect types are admin-created (no seed).
