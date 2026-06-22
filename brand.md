# Brand Guidelines — IQC Quality Management System

**Version:** 2.0 | **Updated:** 2026-06-16

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
