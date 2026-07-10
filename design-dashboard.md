# Design Dashboard — Redesign Spec ทุก Role

**ระบบ:** IQC / Quality Management System rev01 · **Updated:** 2026‑07‑02

> เอกสารนี้ออกแบบ Dashboard ใหม่ **ทุก role** โดยอิงข้อมูล/endpoint จริงในระบบ — คง theme + design language เดิม
> (ดู token ใน [`brand.md`](brand.md) §13) ปรับให้ enterprise + อ่านง่ายขึ้น
> ทุก widget ระบุ **data source จริง** และ **permission** — ห้ามคาดเดา metric ที่ระบบยังไม่มี

---

## สารบัญ
1. [หลักการออกแบบ](#1-หลักการออกแบบ)
2. [Widget Catalog + Data Source](#2-widget-catalog--data-source)
3. [Dashboard ต่อ Role](#3-dashboard-ต่อ-role)
4. [Admin Dashboard](#4-admin-dashboard)
5. [Executive Dashboard (CCO/CMO/CPO)](#5-executive-dashboard-ccocmocpo)
6. [Performance & Security ของ Dashboard](#6-performance--security-ของ-dashboard)

---

## 1. หลักการออกแบบ

- **Role‑aware:** เปิดมาเห็น "งานที่ฉันต้องทำ" ก่อนเสมอ (pending action ของ role นั้น)
- **1‑minute rule (executive):** เปิดมาใน 1 นาทีต้องตอบได้ว่า วันนี้เกิดอะไร / งานค้างเท่าไร / ความเสี่ยงตรงไหน
- **Drill‑down:** ทุก KPI card คลิกได้ → ไปหน้ารายการที่กรองแล้ว (ปัจจุบันยังไม่ทำ — ปรับปรุงตาม AUDIT.md U1)
- **Theme:** QC Staff = dark operational theme; role อื่น = light theme (brand.md §13)
- **Data honesty:** แสดงเฉพาะ metric ที่มี endpoint จริง; ส่วนที่เป็นข้อเสนอใหม่กำกับ **(ใหม่ — ต้องเพิ่ม endpoint)**

---

## 2. Widget Catalog + Data Source

| Widget | ที่มา (endpoint จริง) | Refresh |
|--------|----------------------|---------|
| KPI card (bills วันนี้/สัปดาห์) | `GET /api/bills?limit=500` (คำนวณ client) → **ใหม่:** ควรมี `/api/dashboard/summary` | on‑load + SSE |
| Pass/Fail donut | จาก bill items (`/api/bills`) | on‑load |
| 7‑day bar/area (received vs failed) | `/api/admin/stats` (มี bills/NCR 7+30 วัน) | on‑load |
| NCR/NCP open, stage ranking | `GET /api/ncr?limit=500` | on‑load + SSE `status_change` |
| UAI signature queue | `GET /api/uai?limit=500` | on‑load + SSE |
| Supplier quality ranking (top 8) | `GET /api/admin/stats` (มีอยู่แล้ว) | on‑load |
| Pending approval (ตาม role) | list endpoint กรอง status | SSE |
| Notifications | `GET /api/notifications` | 30s poll |
| Delivery วันนี้ | `GET /api/delivery` | SSE `delivery_*` |
| Defect rate vs threshold (FG) | `GET /api/fg-production/monitor` | on‑load |
| Attendance วันนี้ | `GET /api/attendance` | SSE `attendance_update` |

> **หมายเหตุ performance (AUDIT.md P1):** ปัจจุบัน dashboard ดึง `limit=500` หลาย endpoint แล้วคำนวณฝั่ง client
> — เสนอสร้าง `GET /api/dashboard/summary?role=` คืนเฉพาะตัวเลขสรุป (ลด payload + query)

---

## 3. Dashboard ต่อ Role

### 3.1 QC Staff (Operational — Dark Theme)
```
┌──────────────────────────────────────────────────────────┐
│ [+ สร้างบิล]                       สวัสดี, <ชื่อ> · <สถานี> │
│ ┌ บิลวันนี้ ┐ ┌ บิลสัปดาห์ ┐ ┌ NCR เปิด ┐ ┌ NCP เปิด ┐  │  ← KPI row (mono, cyan)
│ └──────────┘ └───────────┘ └─────────┘ └─────────┘      │
│ ┌ Quality ─────┐ ┌ Trends ────────┐ ┌ NCR Monitor ────┐ │
│ │ donut pass%  │ │ area 7 วัน     │ │ NCR/NCP split   │ │
│ │ bar 7 วัน    │ │ 3 radial gauge │ │ stage ranking   │ │
│ └──────────────┘ └────────────────┘ │ recent bills ↓  │ │
│                                      └─────────────────┘ │
└──────────────────────────────────────────────────────────┘
```
- **ตอบโจทย์:** งานรับเข้าวันนี้ + คุณภาพ + NCR ที่ต้องตาม · **Quick action:** สร้างบิล

### 3.2 QC Supervisor
- **แถวบน:** การ์ด "รออนุมัติ" — บิลรออนุมัติ (L1), NCR/NCP รอหัวหน้า
- **กลาง:** รายการรออนุมัติ (คลิก → หน้าอนุมัติ), FNCP รอ verify
- **Quick action:** อนุมัติรับเข้า, เปิด/อนุมัติ NCP

### 3.3 QC Manager
- **การ์ด:** NCR รอ L2 + disposition, คำตอบ supplier รอตรวจ, UAI รอ QC ack, KPI รออนุมัติ, FQC monthly รับทราบ
- **กลาง:** NCR lifecycle (stage), supplier ranking
- **Quick action:** อนุมัติ + disposition, ตรวจคำตอบ supplier

### 3.4 QMR
- **การ์ด:** NCR รอเปิด (QMR), NCR รอปิด (QMR), UAI รอ QMR ack, KPI รออนุมัติสุดท้าย
- **กลาง:** NCR เปิด/ปิด timeline, จำนวน UAI

### 3.5 Purchasing
- **การ์ด:** NCR รอรับ/ส่ง supplier (+ copy link), supplier รอตอบ, UAI ที่ต้องขอ/ดำเนินการ
- **กลาง:** delivery ที่วางแผน + สถานะ · **Quick action:** copy supplier link, สร้าง delivery, ขอ UAI

### 3.6 Production Manager / Prod Supervisor
- **การ์ด:** UAI/FUAI รอรับทราบ (ฝ่ายผลิต), FNCP ของไลน์, defect rate vs threshold
- **กลาง:** FG production monitor (`/api/fg-production/monitor`)

---

## 4. Admin Dashboard

เป้าหมาย: เห็นสุขภาพระบบ + งานค้างทั้งระบบในหน้าเดียว

| กลุ่ม Widget | เนื้อหา | Data source |
|--------------|---------|-------------|
| System Health | `/api/health` (DB connectivity), uptime | healthcheck |
| Storage / DB | ขนาด `iqc.db`, จำนวนตาราง (105), uploads | **(ใหม่ — ต้องเพิ่ม endpoint)** |
| Online users / SSE | จำนวน client SSE ที่เชื่อม (`db.sseClients`) | **(ใหม่)** |
| Master counts | suppliers / products / users | `GET /api/admin/stats` |
| Quality KPI | open/total NCR, pass rate, UAI counts, bills 7/30 วัน | `GET /api/admin/stats` |
| Pending approval (ทั้งระบบ) | รวมทุก flow ที่ค้าง | list endpoints |
| Audit log ล่าสุด | 10 รายการล่าสุด | `GET /api/admin/audit-logs` |
| Backup status | ครั้งล่าสุด/สถานะ | **(ใหม่ — ผูกกับ cron `.backup`)** |

> 🔒 ทุก widget admin ต้องผ่าน `requireRole(['admin'])` ฝั่ง server (ไม่พึ่งการซ่อน UI อย่างเดียว)

---

## 5. Executive Dashboard (CCO/CMO/CPO)

**1‑minute view** — 3 แถว ตอบคำถามผู้บริหาร:

```
แถว 1  [UAI รอลงนามของฉัน]  [NCR เปิดรวม]  [Defect rate เดือนนี้]  [Supplier เสี่ยง]
แถว 2  เทรนด์คุณภาพ 30 วัน (area)        |   Top defect / supplier (bar)
แถว 3  งานค้างที่ต้องตัดสินใจ (list, คลิก→ลงนาม)  |  Critical issues / risk register
```

- **CCO/CMO/CPO:** คิว UAI ที่รอลายเซ็นของ role ตน (`/api/uai?status=uai_pending_<role>`) เป็นอันดับแรก
- **CPO เพิ่ม:** FQC monthly approval, KPI รออนุมัติ, defect rate ต่อไลน์ (`/api/fg-production/monitor`)
- **Decision support:** supplier grade (A–D) + risk score (likelihood×impact) จาก supplier evaluation/risk
- แสดงเฉพาะสรุป + คลิกลงลึก (drill‑down) — ไม่ยัด raw data

---

## 6. Performance & Security ของ Dashboard

- **Aggregate ฝั่ง server:** สร้าง `/api/dashboard/summary?role=` แทนการดึง `limit=500` หลายเส้น (AUDIT.md P1)
- **Realtime เฉพาะที่จำเป็น:** SSE invalidate เฉพาะ key ที่เกี่ยวข้อง (bills/ncr/uai/delivery/attendance)
- **Cache:** ตัวเลขสรุปที่เปลี่ยนช้า (supplier ranking, KPI เดือน) cache ได้ 1–5 นาที
- **Lazy load:** chart หนักโหลดเมื่อ scroll ถึง
- **Row‑level security:** production_manager เห็นเฉพาะไลน์ที่รับผิดชอบ (`production_line_managers`) — บังคับฝั่ง server
- **Permission ต่อ widget:** ตรวจ role ก่อน push/return ทุก widget — ห้ามส่งข้อมูลข้ามสิทธิ์

*จบเอกสาร design-dashboard.md — ปรับปรุงล่าสุด 2026‑07‑02*
