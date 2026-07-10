# Brand Guidelines — IQC Quality Management System

**Version:** 3.0 | **Updated:** 2026-07-02

> เพิ่มใน v3.0: §13 Dashboard Design Language (light + dark theme tokens จากโค้ดจริง),
> §14 Charts & Data-viz, §15 State Patterns (empty/loading/error), §16 อ้างอิงข้ามเอกสาร
> — ดูสเปก dashboard เต็มใน [`design-dashboard.md`](design-dashboard.md), design token ผูกกับ `client/tailwind.config.js`

---

## 1. Brand Voice

ระบบนี้คือเครื่องมือทำงานจริงในโรงงานอุตสาหกรรม ไม่ใช่แอปผู้บริโภค

**ค่านิยมหลัก:**
- **ความน่าเชื่อถือ** — ข้อมูลถูกต้อง ติดตามได้ ตรวจสอบได้
- **ความชัดเจน** — ผู้ใช้รู้ว่าตัวเองต้องทำอะไร สถานะอยู่ที่ไหน
- **ความมีประสิทธิภาพ** — ขั้นตอนน้อยที่สุด เพื่อเป้าหมายเดียวกัน

**ห้าม:**
- Gradient ในส่วน UI หลัก
- Emoji ในข้อความระบบ
- Animation ที่ไม่มีประโยชน์
- Hover-only interaction บน mobile

---

## 2. Color System

### 2.1 Primary Palette

| Token | Hex | Tailwind | ใช้ที่ |
|-------|-----|----------|--------|
| `primary` | `#1A3A5C` | custom | Header, Primary Button, Active Nav, Heading |
| `accent` | `#2E6DA4` | custom | Link, Icon Active, Secondary Action |
| `bg` | `#F5F6F8` | custom | Page Background |
| `surface` | `#FFFFFF` | white | Card, Table, Form, Modal |
| `border` | `#D1D5DB` | gray-300 | เส้นตาราง, ขอบ Input |
| `text` | `#1F2937` | gray-800 | ข้อความหลัก |
| `muted` | `#6B7280` | gray-500 | Label, Helper text, Placeholder |

### 2.2 Semantic Colors

| Token | Hex | Tailwind | ใช้ที่ |
|-------|-----|----------|--------|
| `success` | `#16A34A` | green-600 | ผ่าน, อนุมัติ, Closed |
| `danger` | `#DC2626` | red-600 | ไม่ผ่าน, ปฏิเสธ, Error, Delete |
| `warning` | `#D97706` | amber-600 | รอดำเนินการ, ต้องทำ, Overdue |
| `info` | `#0891B2` | cyan-600 | ข้อมูลเพิ่มเติม, Neutral |

### 2.3 Status Badge Colors

| สถานะ | Background | Text | ใช้กับ |
|-------|-----------|------|--------|
| ร่าง | `gray-100` | `gray-600` | Bill draft |
| รออนุมัติ | `yellow-100` | `yellow-700` | pending_approval |
| รอตรวจ / รอดำเนินการ | `blue-100` | `blue-700` | pending_* (NCR) |
| ผ่าน / อนุมัติ / เสร็จสิ้น | `green-100` | `green-700` | approved, closed |
| ไม่ผ่าน / ปฏิเสธ | `red-100` | `red-700` | rejected, cancelled |
| รอ Supplier | `orange-100` | `orange-700` | pending_supplier |
| ถูกส่งกลับ | `red-100` | `red-700` | pending_supplier_resubmit |
| ยกเลิก | `red-100` | `red-600` | cancelled |
| NCP ปิดแล้ว | `teal-100` | `teal-700` | ncp_closed |
| UAI ดำเนินการ | `purple-100` | `purple-700` | uai_pending_* |
| UAI เสร็จสิ้น | `green-100` | `green-700` | uai_completed |

### 2.4 DO NOT

- ห้ามใช้สี primary/accent สำหรับ error state
- ห้ามใช้ gradient บน button หรือ card
- ห้าม overload สีในหน้าเดียวกัน (เลือกใช้ semantic ตาม context)

---

## 3. Typography

### 3.1 Font Stack

```css
/* หลัก — ภาษาไทย + ภาษาอังกฤษ */
font-family: 'IBM Plex Sans Thai', 'IBM Plex Sans', sans-serif;

/* ตัวเลข, รหัสเอกสาร, Code */
font-family: 'IBM Plex Mono', monospace;
```

**Import (Google Fonts):**
```html
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
```

### 3.2 Type Scale

| Token | Size | Weight | Line-height | ใช้ที่ |
|-------|------|--------|------------|--------|
| h1 | 24px / 1.5rem | 700 | 1.3 | Page title |
| h2 | 20px / 1.25rem | 600 | 1.35 | Section heading |
| h3 | 16px / 1rem | 600 | 1.4 | Card title, Subsection |
| body | 14px / 0.875rem | 400 | 1.5 | ข้อความทั่วไป |
| small | 12px / 0.75rem | 400 | 1.5 | Label, Helper, Meta |
| mono | 14px / 0.875rem | 400 | 1.5 | Invoice No., รหัส, ตัวเลข |

### 3.3 Tailwind Classes

```javascript
// ใช้ใน tailwind.config.js / CSS
'.text-h1': { fontSize: '1.5rem', fontWeight: '700' }
'.text-h2': { fontSize: '1.25rem', fontWeight: '600' }
'.text-h3': { fontSize: '1rem', fontWeight: '600' }
'.text-body': { fontSize: '0.875rem' }
'.text-small': { fontSize: '0.75rem' }
```

---

## 4. Spacing & Layout

### 4.1 Breakpoints

| Name | Width | Device |
|------|-------|--------|
| `xs` | 375px | iPhone SE |
| `sm` | 640px | มือถือทั่วไป |
| `md` | 768px | Tablet portrait |
| `lg` | 1024px | Tablet landscape / Desktop |
| `xl` | 1280px+ | Desktop wide |

### 4.2 Layout Grid

**Mobile (< 640px):**
- Bottom Navigation Bar (5 items)
- Content เต็มจอ, padding 16px
- ตาราง: horizontal scroll
- Sidebar: ซ่อน

**Tablet portrait (768px–1023px):**
- Sidebar collapsible + hamburger menu
- Content padding 20px

**Desktop (≥ 1024px):**
- Sidebar ถาวร 240px (fixed left)
- Content padding 24px
- Max content width: 1200px

### 4.3 Spacing Scale

```
4px / 8px / 12px / 16px / 20px / 24px / 32px / 48px
(Tailwind: p-1 / p-2 / p-3 / p-4 / p-5 / p-6 / p-8 / p-12)
```

---

## 5. Components

### 5.1 Buttons

**Variants:**

| Variant | Background | Text | Border | ใช้กับ |
|---------|-----------|------|--------|--------|
| primary | `#1A3A5C` | white | none | CTA หลัก, Submit |
| secondary | white | `#1A3A5C` | `#1A3A5C` | Action รอง |
| danger | `#DC2626` | white | none | ลบ, ปฏิเสธ |
| success | `#16A34A` | white | none | อนุมัติ, Confirm |
| warning | `#D97706` | white | none | ส่งคืน, รีเซ็ต |
| ghost | transparent | `#1F2937` | none | Icon button, Subtle action |

**Size:**
- Min height: **44px** ทุก device
- Padding: 8px 16px (desktop), 10px 20px (touch)
- Border-radius: 6px

**States:**
- `:disabled` → opacity 40%, cursor-not-allowed
- `:loading` → spinner inline, text dimmed

### 5.2 Form Inputs

```css
.input {
  height: 44px;          /* min touch target */
  padding: 8px 12px;
  border: 1px solid #D1D5DB;
  border-radius: 6px;
  font-size: 14px;
  background: white;
}
.input:focus {
  border-color: #2E6DA4;
  outline: 2px solid rgba(46,109,164,0.2);
}
.input.error {
  border-color: #DC2626;
}
```

- Label: 12px, `#6B7280`, margin-bottom 4px
- Error message: 12px, `#DC2626`, margin-top 4px
- Required indicator: `*` สีแดง (`text-danger`)

### 5.3 Cards

```css
.card {
  background: white;
  border: 1px solid #D1D5DB;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}
```

### 5.4 Tables

```css
.table-container { overflow-x: auto; }
.table { width: 100%; border-collapse: collapse; font-size: 14px; }
th { background: #F9FAFB; font-weight: 600; padding: 10px 12px; text-align: left; border-bottom: 2px solid #D1D5DB; }
td { padding: 10px 12px; border-bottom: 1px solid #E5E7EB; }
tr:hover { background: #F9FAFB; cursor: pointer; }
```

### 5.5 Badges / Status Pills

```css
.badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 9999px;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}
```

### 5.6 Modals

- Desktop: max-width 600px, centered overlay
- Mobile (< 640px): full-screen สำหรับ Signature, Camera, Long forms
- **ห้าม** Modal ซ้อน Modal บน mobile สำหรับ Signature/Camera

### 5.7 Sidebar Navigation

- Width: 240px (desktop), overlay (mobile)
- Active state: background `rgba(#1A3A5C, 0.1)`, left border 3px `#1A3A5C`
- Icon + label layout
- Sub-items: indent 16px, smaller font

### 5.8 Pagination

- แสดง: ก่อนหน้า | 1 | 2 | … | N | ถัดไป
- Current page: `bg-primary text-white`
- Disabled: opacity-40
- Info: "แสดง X–Y จาก Z รายการ" (text-muted text-small)

---

## 6. Timeline Component

ใช้ใน NCR Detail และ UAI Detail:

```
[dot สีตาม role] — [label bold] — [ชื่อผู้ดำเนินการ] — [เวลา]
                                   [comment/detail ถ้ามี]
[vertical line เชื่อม dot]
```

**สีของ dot:**
| Event | สี |
|-------|---|
| qc_staff | blue |
| qc_supervisor | teal |
| qc_manager | indigo |
| qmr | purple |
| purchasing | orange |
| Supplier ตอบกลับ | amber |
| CCO/CMO/CPO | violet |
| Production Manager | slate |
| จัดซื้อได้รับ NCR | teal |
| จัดซื้อ Copy Link | amber |
| QC Manager ไม่อนุมัติ | red |

---

## 7. PDF Export Design

### 7.1 Header

```
[Company Logo]  [Company Name]
                [Company Address]
                ─────────────────
                [Document Type] — [Document Code]
```

### 7.2 Typography (PDF)

- h1: 18px bold (document title)
- section-title: 12px bold, background `#EFF6FF`, padding 4px 8px
- body: 11px
- monospace: 10px

### 7.3 Table (PDF)

- Header row: background `#1A3A5C`, text white, 10px bold
- Alt row: background `#F9FAFB`
- Border: 1px solid `#D1D5DB`

### 7.4 Timeline (PDF)

- Event rows แยกสีตามประเภท
- Supplier response: background `#FFF7ED`
- Purchasing actions: background `#FFFBEB` / `#F0FDFA`
- Approved: background `#F0FDF4`
- Rejected: background `#FEF2F2`

---

## 8. Iconography

- ใช้ไอคอน SVG inline หรือ Heroicons
- Size: 16px (inline), 20px (button), 24px (nav)
- Color: inherit จาก text
- ห้ามใช้ emoji แทน icon ใน UI หลัก

---

## 9. Writing Style (UI Text)

### 9.1 ภาษาไทย

- ข้อความ UI หลัก: **ภาษาไทย**
- ฟิลด์ที่ Supplier เห็น: ภาษาอังกฤษ + ไทย (bilingual)
- รหัสเอกสาร (NCR-2025-0001): ภาษาอังกฤษ / ตัวเลขเสมอ
- ชื่อ column ในตาราง: สั้น กระชับ ไม่เกิน 3 คำ
- Error message: บอกสาเหตุ + วิธีแก้ เช่น "กรุณากรอกชื่อผู้ตอบ"

### 9.2 Confirmation Dialogs

- Title: กริยา + Object เช่น "ลบบิล BL-001?"
- Body: ผลที่จะเกิด + ย้อนกลับได้หรือไม่
- Buttons: [ยืนยัน / ยกเลิก] — danger action อยู่ขวา

### 9.3 Success/Error Toasts

- Success: ข้อความสั้น "บันทึกสำเร็จ" / "ส่งอนุมัติแล้ว" — ไม่เกิน 3 วินาที
- Error: ระบุสาเหตุชัดเจน — ไม่ auto-dismiss

---

## 10. Accessibility

- Color contrast ratio: ≥ 4.5:1 (WCAG AA)
- Focus visible บน keyboard navigation
- Input fields มี label ทุกตัว (ไม่ใช้ placeholder เป็น label)
- Button มี aria-label ถ้ามีแค่ icon
- Table มี scope="col" บน header

---

## 11. IPQC/FQC Status Badges

### 11.1 IPQC Status

| สถานะ | label | Background | Text |
|-------|-------|-----------|------|
| `open` | เปิด | `blue-100` | `blue-700` |
| `in_progress` | กำลังแก้ไข | `yellow-100` | `yellow-700` |
| `closed` | ปิดแล้ว | `green-100` | `green-700` |
| `cancelled` | ยกเลิก | `red-100` | `red-600` |

### 11.2 FQC Result

| ผล | label | Background | Text |
|----|-------|-----------|------|
| `pass` | ผ่าน | `green-100` | `green-700` |
| `fail` | ไม่ผ่าน | `red-100` | `red-700` |
| `conditional_pass` | ผ่านมีเงื่อนไข | `yellow-100` | `yellow-700` |

### 11.3 FQC Monthly Approval Status (per cell)

| สถานะ | Display | Background | Text |
|-------|---------|-----------|------|
| ไม่มีของเสียเดือนนี้ | — | `gray-50` | `gray-400` |
| รอรับทราบ (มีสิทธิ์) | รับทราบ + ปุ่ม | `yellow-50` | `yellow-700` |
| รอรับทราบ (ไม่มีสิทธิ์) | รอ... | `gray-50` | `gray-500` |
| รับทราบแล้ว | ✓ ชื่อ + วันที่ | `green-50` | `green-700` |

### 11.4 ProCodeSAP Classify Status

| สถานะ | label | Background | Text | ใช้เมื่อ |
|-------|-------|-----------|------|---------|
| `pending` | รอจำแนก | `orange-100` | `orange-700` | ยังไม่ได้ auto-classify |
| `auto` | รอยืนยัน | `yellow-100` | `yellow-700` | auto-classify แล้ว, admin ยังไม่ confirm |
| `confirmed` | ยืนยันแล้ว | `green-100` | `green-700` | พร้อมใช้งาน |
| `rejected` | ปฏิเสธ | `red-100` | `red-600` | admin reject, ต้องจำแนกใหม่ |

### 11.5 ProCodeSAP Confidence Indicator

```
confidence ≥ 80%: ████████ 85%   (text-green-600)
confidence 50-79%: █████░░░ 60%  (text-yellow-600)
confidence < 50%:  ██░░░░░░ 25%  (text-red-600)
```

---

## 12. SAP Product Number Parsing Rules

> Reference document สำหรับ `server/services/proCodeClassifier.js`  
> ดูตัวอย่างโค้ด product numbers จริงใน `ตัวอย่างไฟล์ Planing.xlsx` และ `ตัวอย่างไฟล์ Planing uPVC.xlsx`
>
> **Classifier ทำงาน 5 ชั้น (Tier 0–4):** Tier 0 = derived-desc fuzzy match (65% token overlap, ขยายคำย่อไทย
> `นต.→หน้าต่าง`), Tier 1 = master lookup, Tier 2 = prediction cache (majority vote), Tier 3 = deterministic
> parse (§12.2–12.4), Tier 4 = keyword จาก description (§12.5). ยิ่ง confirm มาก Tier 0 ยิ่งแม่นขึ้น

### 12.1 โครงสร้าง Product Number

```
{Part1}-{Part2}-{Part3}
FA00-W0313-240110      ← ALU standard
FUS09-W22512-120110    ← FU (uPVC) F100 FRAMEX ขาว
FUE22-W40112-120100    ← FU ECO 60 WINDOW ASIA
FAC22-L1332-060040     ← FA Super ECO WINDOW ASIA
```

### 12.2 Part1 — Line Type + Series + Brand

**Line Type (2 ตัวแรก):**
| Prefix | line_type |
|--------|-----------|
| FA | FA (อลูมิเนียม) |
| FU | FU (uPVC) |

**FU Series (ตัวที่ 3, เฉพาะ FU):**
| Code | product_series |
|------|---------------|
| FUS + W | F100 |
| FUS + D | S85 |
| FUE | ECO 60 |
| FUW | ECO 60-100 |

**FA Series prefix (ก่อน brand code):**
| Code | หมายความ |
|------|---------|
| FA | Standard |
| FAC | Super ECO |
| FAR | ORM / Special |
| FAE | ECO |

**Brand Code (2 หลักท้าย Part1):**
| Code | brand |
|------|-------|
| 00 | (Standard) |
| 09 | FRAMEX |
| 12 | FINEXT |
| 17 | HOOMDOT THUNDER |
| 22 | WINDOW ASIA |
| 28 | WINDOW ASIA |
| 29 | WELLINGTAN |
| 32 | FRAMEX ECO |

### 12.3 Part2 — Panel Type + Color

**Panel Type (ตัวอักษรแรก):**
| Prefix | panel_type | FU rule |
|--------|-----------|---------|
| W | หน้าต่าง | FUS+W = F100 |
| D | ประตู | FUS+D = S85 |
| F | ช่องแสง / Fix | — |
| L | หน้าต่าง (พิเศษ) | — |

**Color Code (2 หลักท้าย Part2):**
| Code | panel_color |
|------|-----------|
| 11, 12, 22 | สีขาว |
| 13 | สีชา |
| 14 | สีดำ |

### 12.4 Part3 — ขนาด (Size)

```javascript
// {width_cm}{height_cm} ต่อกันโดยไม่มีตัวคั่น
// Split ครึ่ง (floor สำหรับกว้าง, ceil สำหรับสูง)
function parsePart3(part3) {
  const s = String(part3).replace(/\D/g, '')
  const mid = Math.floor(s.length / 2)
  const w = parseFloat(s.slice(0, mid)) || 0
  const h = parseFloat(s.slice(mid)) || 0
  return {
    width_mm:   Math.round(w * 10),
    height_mm:  Math.round(h * 10),
    panel_size: `${w}x${h}`
  }
}
// "240110" → { width_mm: 2400, height_mm: 1100, panel_size: "240x110" }
// "060040" → { width_mm: 600,  height_mm: 400,  panel_size: "60x40" }
```

### 12.5 Description Keyword Parsing

| Keyword | Attribute | Value |
|---------|-----------|-------|
| มุ้ง | mosquito_net | "มุ้ง" |
| (ไม่มี "มุ้ง") | mosquito_net | "ไม่มีมุ้ง" |
| กระจก | glass_type | "กระจก" |
| FSSF | panel_style | "FSSF" |
| SSSS | panel_style | "SSSS" |
| SFS | panel_style | "SFS" |
| SS (standalone) | panel_style | "SS" |
| F100 | product_series | "F100" |
| S85 | product_series | "S85" |
| ECO 60-100 | product_series | "ECO 60-100" |
| ECO 60 | product_series | "ECO 60" |
| ORM | product_series | "ORM" |
| สีขาว/ขาว | panel_color | "สีขาว" |
| สีชา/ชา | panel_color | "สีชา" |
| สีดำ/ดำ | panel_color | "สีดำ" |
| เหล็กดัด | iron_pattern | (extract from context) |

### 12.6 Similarity Matching (Confidence)

| เงื่อนไข | Confidence |
|---------|-----------|
| Part1+Part2 เหมือนกัน (ต่างแค่ Part3/ขนาด) | 90% |
| Part1 เหมือน + Part2 type prefix เหมือน | 75% |
| Part1 เหมือนอย่างเดียว | 60% |
| Parse จาก code + description ได้ครบ | 50% |
| Parse ได้บางส่วน | 30% |
| ไม่พบเลย | 10% |

### 12.7 Known Product Examples

| Product No. | line | series | brand | type | color | size |
|-------------|------|--------|-------|------|-------|------|
| FA00-W0313-240110 | FA | - | Standard | หน้าต่าง | สีชา | 240x110 |
| FA22-W0412-080050 | FA | - | WINDOW ASIA | หน้าต่าง | สีขาว | 80x50 |
| FAC22-L1332-060040 | FA | Super ECO | WINDOW ASIA | หน้าต่าง(พิเศษ) | สีขาว | 60x40 |
| FUS00-W0112-120110 | FU | F100 | Standard | หน้าต่าง | สีขาว | 120x110 |
| FUS00-D0112-200205 | FU | S85 | Standard | ประตู | สีขาว | 200x205 |
| FUS09-W22512-120110 | FU | F100 | FRAMEX | หน้าต่าง | สีขาว | 120x110 |
| FUS28-D2212-240196 | FU | S85 | WINDOW ASIA | ประตู | สีขาว | 240x196 |
| FUE00-W0112-080050 | FU | ECO 60 | Standard | หน้าต่าง | สีขาว | 80x50 |
| FUW22-W7012-120110 | FU | ECO 60-100 | WINDOW ASIA | หน้าต่าง | สีขาว | 120x110 |

---

## 13. Dashboard Design Language

Dashboard มี **2 โหมดสี** ตาม context — ดูสเปกเต็ม (widget/layout ต่อ role) ใน [`design-dashboard.md`](design-dashboard.md)

### 13.1 Light Theme (มาตรฐาน — ทุก role ยกเว้น QC Staff)
ใช้ palette หลัก (§2) บนพื้น `bg #F5F6F8`, card `surface #FFFFFF`, ตัวเลข KPI ใช้ `font-mono`, accent = semantic color ตาม context

### 13.2 Dark Theme (QC Staff Operational Dashboard)
โหมดมืดสำหรับหน้างาน/กะกลางคืน — token จากโค้ด `Dashboard/index.jsx` จริง:

| Token | Hex | ใช้ที่ |
|-------|-----|--------|
| `dash-bg` | `#0B1929` | พื้นหลัง dashboard |
| `dash-card` | `#0F2236` | Card, panel |
| `dash-border` | `#1E3A5F` | เส้นขอบ card |
| `dash-text` | `#E2EAF4` | ข้อความหลัก |
| accent-cyan | `#38BDF8` | ตัวเลข primary, area chart |
| accent-green | `#22C55E` | ผ่าน / positive |
| accent-orange | `#F97316` | เตือน / NCR |
| accent-yellow | `#EAB308` | รอดำเนินการ |
| accent-purple | `#A78BFA` | NCP / secondary |

**กฎเดิม (ก่อน Session 121):** dark theme ใช้เฉพาะ operational dashboard เท่านั้น — หน้ารายการ/ฟอร์มยังเป็น light theme
เพื่อ contrast ในการอ่านข้อมูลนาน ๆ · เป้าหมาย refactor: ย้าย inline style/gradient เป็น token ใน tailwind (AUDIT.md U3)

**อัปเดต (Session 121):** เพิ่ม **App-wide Dark Mode** ที่ผู้ใช้แต่ละคนเลือกเองได้ (Light/Dark/Auto ตามเวลานาฬิกา)
ครอบคลุมหน้ารายการ/ฟอร์มทั้งหมดแล้ว ผ่าน CSS variable token (`--color-*` ใน `index.css` + `.dark` class บน
`<html>`) — ดู CLAUDE.md §25 สำหรับรายละเอียด token/convention เต็ม **ข้อยกเว้นเดียว:** operational dashboard
(role-based `Dashboard/*.jsx` 8 ไฟล์ + `shared.jsx`) ยังคงมืดถาวรตาม `D` token เดิมด้านบนเสมอ ไม่ผูกกับ toggle
ของผู้ใช้ (การออกแบบเดิมตั้งใจให้มืดเพื่อ contrast งาน operational โดยเฉพาะ ไม่ใช่ข้อจำกัดทางเทคนิคอีกต่อไป)

### 13.3 KPI Summary Card
- โครง: `[icon] [label เล็ก muted] · [ตัวเลขใหญ่ mono] · [หน่วย/เดลต้า]`
- คลิกได้ → พาไปหน้ารายการที่ **กรองแล้ว** (แนวทางปรับปรุง — AUDIT.md U1)
- สีขอบ/ไอคอนตาม semantic ของ metric (danger=ของเสีย, warning=ค้าง, success=ผ่าน)

---

## 14. Charts & Data Visualization

ใช้ **recharts** เท่านั้น (สอดคล้อง stack) — ห้ามใส่ library chart อื่น

| Chart | ใช้กับ | หมายเหตุ |
|-------|--------|----------|
| BarChart | เปรียบเทียบรายวัน/หมวด (received vs failed) | แกน mono font |
| PieChart (donut) | สัดส่วน pass/fail | กลางวงแสดง % |
| AreaChart (gradient) | เทรนด์ 7 วัน | gradient เฉพาะใน chart เท่านั้น (ไม่ผิดกฎ no-gradient ของ UI หลัก) |
| RadialGauge (custom SVG) | quality overview % | 3 เกจต่อแถว |

- Animation: `useCountUp` สำหรับตัวเลข KPI (transition สั้น มีประโยชน์ — ไม่ผิดกฎ)
- Tooltip: dark theme ใช้ custom `DarkTip` ให้อ่านออกบนพื้นมืด
- ทุก chart ต้องมี label + หน่วยชัดเจน, สีตาม semantic (ไม่สุ่มสี)

---

## 15. State Patterns (Empty / Loading / Error)

มาตรฐานที่ **ทุกหน้ารายการ/dashboard** ต้องมี (ปัจจุบันยังไม่สม่ำเสมอ — AUDIT.md U2):

| State | รูปแบบ |
|-------|--------|
| Loading | Skeleton (โครงสีเทาอ่อน) หรือ spinner inline — ไม่ค้างหน้าขาว |
| Empty | ไอคอน + ข้อความ "ยังไม่มีข้อมูล" + ปุ่ม action หลัก (ถ้ามีสิทธิ์) |
| Error | ข้อความสาเหตุ (ไม่ auto-dismiss) + ปุ่ม "ลองใหม่" |
| Permission denied | ไม่แสดง action button ที่ไม่มีสิทธิ์ (ตรวจผ่าน `canAccess`) — ห้าม disable แล้วโชว์เฉย ๆ |

---

## 16. อ้างอิงข้ามเอกสาร

| ต้องการ | เปิดไฟล์ |
|---------|---------|
| กฎการเขียนโค้ด / DB / security | [`CLAUDE.md`](CLAUDE.md) |
| requirement / workflow / business rule | [`PRD.md`](PRD.md) |
| สเปก dashboard ต่อ role | [`design-dashboard.md`](design-dashboard.md) |
| ผลวิเคราะห์ / refactor / ปัญหาจัดอันดับ | [`AUDIT.md`](AUDIT.md) |
| test plan / coverage | [`testcase.md`](testcase.md) |
| ประวัติการพัฒนา | [`iqc-system/DEVLOG.md`](iqc-system/DEVLOG.md) |

*จบเอกสาร brand.md v3.0 — ปรับปรุงล่าสุด 2026‑07‑02*
