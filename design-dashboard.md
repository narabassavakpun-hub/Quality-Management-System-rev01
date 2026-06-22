# Design Dashboard — กฎและ Pattern สำหรับ IQC System

**Updated:** 2026-06-17  
**ใช้อ้างอิงเมื่อสร้าง Dashboard ของ Role อื่นๆ**

---

## 1. หลักการหลัก

1. **1 หน้า ไม่ scroll** — Dashboard ทุก role ต้องแสดงข้อมูลทั้งหมดในหน้าจอเดียว ไม่ให้ผู้ใช้ scroll ขึ้นลง
2. **แบ่งหมวดหมู่ชัดเจน** — แต่ละ section มี Category Label บอกว่าข้อมูลหมวดนี้คืออะไร
3. **Interactive** — ทุก KPI tile และ chart item คลิกได้ นำไปยังหน้าที่เกี่ยวข้อง
4. **Real-time data** — ใช้ `useStats()` + `refetchInterval` ดึงข้อมูลสดเสมอ
5. **Count-up animation** — ตัวเลข KPI ใช้ `useCountUp()` ทุกตัว

---

## 2. Layout Structure (บังคับทุก Dashboard)

```
┌─ HEADER (flex-none, ~40px) ──────────────────────────────────────────┐
│  ชื่อ Dashboard + Role badge       วันที่     [ปุ่ม Action หลัก]    │
├─ KPI ROW (flex-none, ~72px) ─────────────────────────────────────────┤
│  [KPI 1]    [KPI 2]    [KPI 3]    [KPI 4]   ← 4 ช่อง เสมอ         │
├─ MAIN AREA (flex-1 min-h-0) ─────────────────────────────────────────┤
│                                                                       │
│  [LEFT COLUMN]    [CENTER COLUMN]    [RIGHT COLUMN]                  │
│  Category A       Category B         Category C                      │
│  (30%)            (40%)              (30%)                           │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

### CSS ที่บังคับใช้บน root container

```jsx
<div
  className="flex flex-col -m-4 overflow-hidden"
  style={{ height: 'calc(100vh - 64px)', background: D.bg }}
>
```

- `-m-4` — ยกเลิก padding ของ `<main>` (p-4 = 16px)
- `height: calc(100vh - 64px)` — 64px คือความสูง top header ของ AppLayout
- `overflow-hidden` — ป้องกัน scroll ออกนอก container
- `flex flex-col` — จัดลำดับ Header → KPI → Main แนวตั้ง

### Column ภายใน MAIN AREA

```jsx
/* แต่ละคอลัมน์ */
<div className="flex flex-col gap-2 min-h-0">
  <CatLabel color={D.xxx} text="ชื่อหมวด" />
  {/* Card ที่ยืดเต็มพื้นที่ */}
  <div className="flex-1 min-h-0 rounded-xl p-3 flex flex-col" style={cardStyle}>
    <p className="flex-none ...">ชื่อ card</p>
    <div className="flex-1 min-h-0"> {/* chart wrapper */}
      <ResponsiveContainer width="100%" height="100%">
        ...
      </ResponsiveContainer>
    </div>
  </div>
  {/* Card ความสูงคงที่ */}
  <div className="flex-none rounded-xl p-3" style={cardStyle}>
    ...
  </div>
</div>
```

**กฎ flex สำหรับ card ภายในคอลัมน์:**

| ต้องการ | className |
|---------|-----------|
| Card ยืดเต็มพื้นที่ที่เหลือ | `flex-1 min-h-0` |
| Card ความสูงตามเนื้อหา | `flex-none` |
| Chart ภายใน flex-1 card | ห่อด้วย `<div className="flex-1 min-h-0">` แล้ว `height="100%"` บน ResponsiveContainer |

---

## 3. Dark Color Palette (บังคับใช้ทุก Role)

```javascript
const D = {
  bg:     '#0B1929',   // พื้นหลัง dashboard
  card:   '#0F2236',   // พื้น card
  border: '#1E3A5F',   // เส้นขอบ, แถบ inactive
  text:   '#E2EAF4',   // ข้อความหลัก
  muted:  '#7B9AB8',   // ข้อความรอง, label
  cyan:   '#38BDF8',   // accent หลัก, link
  green:  '#22C55E',   // ผ่าน, approve, complete
  orange: '#F97316',   // ไม่ผ่าน, warning, pending
  yellow: '#EAB308',   // รอดำเนินการ
  purple: '#A78BFA',   // secondary metric
};
```

ห้ามใช้สีนอกตารางนี้ ยกเว้น `#EF4444` สำหรับ Major NCR เท่านั้น

---

## 4. Typography ภายใน Dashboard

| องค์ประกอบ | ขนาด | class |
|-----------|------|-------|
| ชื่อ Dashboard | 15px | `text-[15px] font-bold` |
| หัว Category | 10px | `text-[10px] font-semibold uppercase tracking-widest` |
| หัว Card | 11px | `text-[11px] font-semibold` |
| KPI number | 24px | `text-2xl font-bold tabular-nums` |
| ป้ายกำกับ KPI | 11px | `text-[11px] font-semibold` |
| Sub-label | 9px | `text-[9px]` |
| ตัวเลขใน list | 10px | `text-[10px] font-mono font-bold` |
| label ใน list | 10px | `text-[10px]` |
| Axis labels (chart) | 9px | `fontSize: 9, fill: D.muted` |

---

## 5. Components ที่ใช้ซ้ำ

### CatLabel — หัว category ของแต่ละคอลัมน์

```jsx
function CatLabel({ color, text }) {
  return (
    <div className="flex-none flex items-center gap-2 mb-1">
      <div className="w-1 h-4 rounded-full" style={{ background: color }} />
      <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: D.muted }}>
        {text}
      </span>
    </div>
  );
}
```

### DarkCard — wrapper พื้นฐาน

```jsx
function DarkCard({ children, className = '', style = {} }) {
  return (
    <div className={`rounded-xl p-3 ${className}`}
      style={{ background: D.card, border: `1px solid ${D.border}`, ...style }}>
      {children}
    </div>
  );
}
```

### RadialGauge — donut progress วงกลม

```jsx
function RadialGauge({ value, total, label, color }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  const animated = useCountUp(pct);
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: 88, height: 88 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={[{ v: pct }, { v: Math.max(0, 100 - pct) }]}
              dataKey="v" cx="50%" cy="50%"
              innerRadius={28} outerRadius={40}
              startAngle={90} endAngle={-270} stroke="none"
              isAnimationActive animationDuration={1400}>
              <Cell fill={color} />
              <Cell fill={D.border} />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-base font-bold tabular-nums" style={{ color }}>{animated}%</span>
        </div>
      </div>
      <p className="text-[10px] text-center leading-tight" style={{ color: D.muted }}>{label}</p>
      <p className="text-[9px]" style={{ color: D.border }}>{value}/{total}</p>
    </div>
  );
}
```

### DarkTip — Tooltip สำหรับทุก chart

```jsx
const DarkTip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#1E3A5F', border: '1px solid #2E5080', borderRadius: 8, padding: '8px 12px' }}>
      {label && <p style={{ color: D.muted, fontSize: 10, marginBottom: 4 }}>{label}</p>}
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.stroke || p.fill || D.cyan, fontSize: 12, fontWeight: 600 }}>
          {p.value} {p.name}
        </p>
      ))}
    </div>
  );
};
```

---

## 6. KPI Row — กฎ

- **ต้องมีเสมอ** — ทุก dashboard มี KPI row 4 ช่อง (`grid-cols-4`)
- ใช้ `useCountUp()` สำหรับแต่ละตัวเลข — **ห้ามเรียก useCountUp ใน .map()** ต้องประกาศแยก
  ```javascript
  const kpiN0 = useCountUp(isLoading ? 0 : value0);
  const kpiN1 = useCountUp(isLoading ? 0 : value1);
  const kpiN2 = useCountUp(isLoading ? 0 : value2);
  const kpiN3 = useCountUp(isLoading ? 0 : value3);
  ```
- แต่ละ tile คลิกได้ → navigate ไปหน้าที่เกี่ยวข้อง
- เมื่อ `isLoading` แสดง `'—'` แทน

---

## 7. Chart — กฎ

| กฎ | รายละเอียด |
|----|-----------|
| Tooltip | ใช้ `<Tooltip content={<DarkTip />} />` ทุกตัว |
| Animation | `isAnimationActive animationDuration={1200}` ทุก chart |
| Grid | `<CartesianGrid strokeDasharray="3 3" stroke={D.border} vertical={false} />` |
| Axis | `axisLine={false} tickLine={false}`, font 9px สี `D.muted` |
| Donut center text | ใช้ `position: absolute, inset: 0` overlay บน ResponsiveContainer |
| Empty state | Donut ที่ไม่มีข้อมูล → แสดง `[{ name: '-', value: 1 }]` สี `D.border` |
| Area gradient | ใช้ `<defs><linearGradient>` เสมอ, id ห้ามซ้ำกันระหว่าง chart |
| Donut padding | `paddingAngle={data.length > 1 ? 3 : 0}` เสมอ |

### Chart ในพื้นที่ flex-1 (ยืดหด):
```jsx
<div className="flex-1 min-h-0">
  <ResponsiveContainer width="100%" height="100%">
    <AreaChart ...>
  </ResponsiveContainer>
</div>
```

### Progress bar แนวนอน (ranking list):
```jsx
<div className="h-1 rounded-full" style={{ background: D.border }}>
  <div className="h-full rounded-full"
    style={{ width: `${percent}%`, background: color, transition: 'width 1s ease-out' }} />
</div>
```

---

## 8. Recent Item List — Pattern

ใช้สำหรับแสดงรายการล่าสุด (bills, NCR, UAI) ภายใน flex-1 card ที่ scroll ได้:

```jsx
<div className="flex-1 min-h-0 overflow-y-auto space-y-1"
  style={{ scrollbarWidth: 'thin', scrollbarColor: `${D.border} transparent` }}>
  {items.map(item => (
    <button key={item.id} onClick={() => navigate(`/path/${item.id}`)}
      className="w-full text-left rounded-lg px-2.5 py-1.5 transition-colors"
      style={{ background: D.bg }}
      onMouseEnter={e => e.currentTarget.style.background = D.border}
      onMouseLeave={e => e.currentTarget.style.background = D.bg}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] font-semibold" style={{ color: D.cyan }}>{item.code}</span>
        <StatusPill status={item.status} />
      </div>
      <div className="flex justify-between mt-0.5">
        <span className="text-[9px] truncate mr-2" style={{ color: D.muted }}>{item.name}</span>
        <span className="text-[9px] flex-shrink-0" style={{ color: D.muted }}>{item.date}</span>
      </div>
    </button>
  ))}
</div>
```

---

## 9. Content Plan แต่ละ Role

| Role | Category A (Left) | Category B (Center) | Category C (Right) |
|------|-------------------|--------------------|--------------------|
| **qc_staff** | คุณภาพการรับเข้า (Pass/Fail donut + bar 7d) | แนวโน้มรับเข้า (Area chart + 3 gauges) | NCR Monitor (status + stages + recent bills) |
| **qc_supervisor** | บิลรออนุมัติ (list + donut) | ปริมาณรายวัน (bar 7d + area) | NCR รออนุมัติ (list + KPI) |
| **qc_manager** | NCR Overview (severity donut + trend) | UAI Monitor (status + stages) | Disposition breakdown (bar + gauges) |
| **qmr** | NCR เปิด/ปิด (donut + timeline) | KPI ระบบ (4 gauges + summary) | Pending approval list (NCR + UAI) |
| **purchasing** | Delivery Monitor (status donut + timeline) | NCR รอ Supplier (list + aging bar) | UAI รออนุมัติ (list + donut) |
| **cco/cmo/cpo** | Quality Index (big gauge + trend) | NCR Summary (bar by month + donut) | Top Supplier Issues (ranking bars) |
| **admin** | System Stats (users + activity) | Bills + NCR + UAI (3 area charts) | Recent activity log |

KPI 4 ช่องต้องสื่อถึงงานหลักของ role นั้น เช่น:
- qc_supervisor: บิลรออนุมัติ / บิลวันนี้ / NCR รออนุมัติ / NCR ทั้งหมด
- purchasing: Delivery วันนี้ / รอยืนยัน / NCR รอ link / UAI รอลงนาม

---

## 10. ข้อห้าม (สำหรับทุก Dashboard)

- ❌ ห้ามใช้ `space-y-*` เป็น layout หลัก — ใช้ `flex flex-col gap-2` แทน
- ❌ ห้ามกำหนด `height` ตายตัวบน chart ที่อยู่ใน `flex-1` card — ใช้ `height="100%"` + wrapper `min-h-0`
- ❌ ห้ามใช้ `minHeight: calc(100vh - ...)` — ใช้ `height: calc(100vh - 64px)` + `overflow-hidden`
- ❌ ห้ามเรียก hook (`useCountUp`, `useState` ฯลฯ) ใน `.map()` callback
- ❌ ห้ามใช้สีนอก palette `D` ยกเว้น `#EF4444` (Major NCR)
- ❌ ห้าม gradient บน button หรือ card background — gradient ใช้ได้เฉพาะใน chart fill
- ❌ ห้าม emoji ใน UI
- ❌ ห้าม hover-only interaction บน mobile — ใช้ `onMouseEnter/Leave` คู่กับ `style` โดยตรง

---

## 11. Data Source

Dashboard ทุก role ดึงข้อมูลผ่าน `useStats()`:

```javascript
function useStats() {
  return useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => Promise.all([
      api.get('/bills?status=pending_approval&limit=500').then(toArr),
      api.get('/ncr?limit=500').then(toArr),
      api.get('/uai?limit=500').then(toArr),
      api.get('/bills?limit=500').then(toArr),
    ]).then(([pendingBills, ncrs, uais, allBills]) => ({ pendingBills, ncrs, uais, allBills })),
    refetchInterval: 30000,
  });
}
```

สำหรับข้อมูลเพิ่มเติมที่ role-specific (เช่น admin stats) ให้เพิ่ม `useQuery` แยกใน component นั้น

---

## 12. ลำดับการสร้าง Dashboard ใหม่

1. ระบุ **3 หมวดหมู่** ที่ role นี้ต้องเห็น (ดูตารางใน section 9)
2. กำหนด **4 KPI** ที่สำคัญที่สุด
3. เลือก **chart type** ให้เหมาะกับข้อมูล:
   - สัดส่วน → Donut (PieChart + innerRadius)
   - แนวโน้ม → AreaChart
   - เปรียบเทียบรายวัน → BarChart
   - % เสร็จ → RadialGauge
   - Ranking → Progress bar list
4. วาง layout: Left (flex-none + flex-1), Center (flex-1 + flex-none), Right (flex-none + flex-none + flex-1)
5. ใช้ `CatLabel` นำหน้าแต่ละคอลัมน์
6. Build test: `npm run build` ต้องไม่มี error
