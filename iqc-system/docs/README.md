# docs/ — IPQC/FQC Module Reference

**อัปเดต:** 2026‑07‑02

โฟลเดอร์นี้เป็น **เอกสารเจาะลึกเฉพาะโมดูล IPQC/FQC** (production‑floor QC) ที่ต่อยอดบนระบบ IQC เดิม
ไม่ใช่เอกสารระดับทั้งระบบ — สำหรับภาพรวมทั้งระบบให้ยึด **canonical docs ที่ root** เป็นหลัก

## Canonical (source of truth — ที่ root ของโปรเจกต์)

| ต้องการ | ไฟล์ |
|---------|------|
| ผลวิเคราะห์ / refactor / security / ปัญหาจัดอันดับ | [`../../AUDIT.md`](../../AUDIT.md) |
| Requirement / workflow / business rule (ทั้งระบบ) | [`../../PRD.md`](../../PRD.md) |
| กฎการพัฒนา / DB / API / security rule | [`../../CLAUDE.md`](../../CLAUDE.md) |
| Design system / dashboard | [`../../brand.md`](../../brand.md) · [`../../design-dashboard.md`](../../design-dashboard.md) |
| Test plan (ทั้งระบบ) | [`../../testcase.md`](../../testcase.md) |
| ประวัติการพัฒนา | [`../DEVLOG.md`](../DEVLOG.md) |
| Deploy (ทั้งระบบ) | [`../DEPLOYMENT.md`](../DEPLOYMENT.md) · [`../PRODUCTION_CHECKLIST.md`](../PRODUCTION_CHECKLIST.md) |

## ไฟล์ในโฟลเดอร์นี้ (module‑scoped)

| ไฟล์ | เนื้อหา | สถานะ |
|------|---------|-------|
| `SYSTEM_ARCHITECTURE.md` | สถาปัตยกรรมโมดูล IPQC/FQC | ✅ อ้างอิงได้ |
| `DATABASE_DESIGN.md` | ตาราง IPQC/FQC (16 ตาราง) | ✅ อ้างอิงได้ |
| `API_SPEC.md` | endpoint spec (บาง endpoint ระบุ "planned") | ⚠️ IPQC/FQC record routes ยัง "planned" |
| `SECURITY.md` | security controls เฉพาะโมดูล | ✅ อ้างอิงได้ |
| `UI_FLOW.md` | user flow IPQC/FQC | ✅ อ้างอิงได้ |
| `DEPLOYMENT.md` | หมายเหตุ deploy เฉพาะโมดูล | ดู `../DEPLOYMENT.md` เป็นหลัก |
| `IPQC-FQC.postman_collection.json` | Postman collection ทดสอบ API | — |
| `TESTCASE.md` | test cases IPQC/FQC | ⚠️ DEPRECATED → [`../../testcase.md`](../../testcase.md) |

> ⚠️ เอกสารในโฟลเดอร์นี้อาจ **ไม่ครอบคลุมโมดูล FG/FNCP/FUAI/Material Defects** (เพิ่ม Session 82–87)
> ให้ตรวจกับโค้ดจริงหรือ `../../AUDIT.md` ก่อนยึดถือ
