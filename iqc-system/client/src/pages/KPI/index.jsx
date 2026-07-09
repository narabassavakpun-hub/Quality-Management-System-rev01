import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import api, { downloadFile } from '../../utils/api';
import Button from '../../components/UI/Button';
import Modal from '../../components/UI/Modal';
import ConfirmDialog from '../../components/UI/ConfirmDialog';
import ToggleSwitch from '../../components/UI/ToggleSwitch';
import {
  BarChart, Bar, Cell, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, ReferenceLine,
} from 'recharts';

// ─── TOAST ───────────────────────────────────────────────────────────────────
function useToast() {
  const [toast, setToast] = useState(null);
  const timerRef = useRef(null);
  const show = useCallback((msg, type = 'success') => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast({ msg, type });
    timerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);
  const ToastPortal = toast ? createPortal(
    <div style={{
      position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)',
      zIndex: 99999, borderRadius: 10, padding: '12px 24px',
      background: toast.type === 'success' ? '#16A34A' : '#DC2626',
      color: '#fff', fontSize: 14, fontWeight: 600,
      boxShadow: '0 6px 24px rgba(0,0,0,0.28)',
      display: 'flex', alignItems: 'center', gap: 8, minWidth: 240,
      fontFamily: 'IBM Plex Sans Thai, sans-serif',
    }}>
      <span style={{ fontSize: 18 }}>{toast.type === 'success' ? '✓' : '✕'}</span>
      {toast.msg}
    </div>,
    document.body
  ) : null;
  return { showToast: show, ToastPortal };
}

const YEAR_COLORS    = ['#1A3A5C', '#2E6DA4', '#0891B2'];
const REF_LINE_COLORS = ['#DC2626', '#EA580C', '#16A34A', '#2563EB']; // แดง, ส้ม, เขียว, น้ำเงิน

const FAIL_COLOR  = '#DC2626';

const AP_STATUS = {
  draft:       { label: 'แบบร่าง',       cls: 'bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-200' },
  pending_qcm: { label: 'รอ QC Manager',  cls: 'bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-200' },
  pending_cpo: { label: 'รอ CPO',         cls: 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200' },
  pending_qmr: { label: 'รอ QMR',         cls: 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-200' },
  approved:    { label: 'อนุมัติแล้ว',    cls: 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200' },
};

function calcSummary(records, type) {
  const values = (records ?? []).map(r => r?.actual).filter(v => v !== null && v !== undefined);
  if (values.length === 0) return null;
  const total = values.reduce((a, b) => a + Number(b), 0);
  return type === 'sum' ? +total.toFixed(2) : +(total / values.length).toFixed(2);
}

function checkFail(actual, target, direction) {
  if (actual === null || actual === undefined || target === null || target === undefined) return false;
  return direction === 'lte' ? Number(actual) > Number(target) : Number(actual) < Number(target);
}

// Build lookup: item_id → { month → { target, actual } }
function buildItemMonthMap(apiData) {
  const map = {};
  if (!apiData?.groups) return map;
  for (const { items } of apiData.groups) {
    for (const { item, currentYear } of items) {
      map[item.id] = {};
      for (const d of currentYear) map[item.id][d.month] = d;
    }
  }
  return map;
}

const CY = new Date().getFullYear();
const MONTH_SHORT = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const MONTH_FULL  = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];

function yearRange(from = CY - 2, to = CY + 2) {
  const r = [];
  for (let y = from; y <= to; y++) r.push(y);
  return r;
}

// ─── YEAR PICKER (popup grid 2567–2577) ──────────────────────────────────────
const PICK_YEARS = Array.from({ length: 11 }, (_, i) => 2024 + i); // 2024–2034 (พ.ศ. 2567–2577)

function YearPicker({ value, onChange, tag, clearable }) {
  const [open, setOpen] = useState(false);
  const displayBE = value ? value + 543 : null;
  return (
    <div className="flex items-center gap-1.5 relative">
      <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${value ? 'bg-primary text-white' : 'bg-bg border border-border text-muted'}`}>{tag}</span>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="input min-h-[36px] min-w-[80px] text-left flex items-center justify-between gap-1 px-2">
        <span className="font-mono">{displayBE ?? '—'}</span>
        <svg className="w-3 h-3 text-muted flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
        </svg>
      </button>
      {clearable && value && (
        <button type="button" onClick={() => onChange('')}
          className="text-muted hover:text-danger w-5 h-5 flex items-center justify-center text-lg leading-none">×</button>
      )}
      {open && (
        <>
          <div className="fixed inset-0 z-[100]" onClick={() => setOpen(false)} />
          <div className="absolute z-[101] top-full mt-1 left-0 bg-surface shadow-xl rounded-xl border border-border p-2 w-[200px]">
            <div className="grid grid-cols-3 gap-1">
              {clearable && (
                <button type="button" onClick={() => { onChange(''); setOpen(false); }}
                  className="col-span-3 py-1 text-[11px] text-muted hover:bg-bg rounded text-center border-b border-border mb-1 pb-2">
                  ไม่เลือก
                </button>
              )}
              {PICK_YEARS.map(y => (
                <button key={y} type="button" onClick={() => { onChange(y); setOpen(false); }}
                  className={`py-1.5 rounded text-small text-center font-mono transition-colors ${
                    value === y ? 'bg-primary text-white font-bold' : 'hover:bg-bg text-text'
                  }`}>
                  {y + 543}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── DASHBOARD TAB ────────────────────────────────────────────────────────────
function DashboardTab() {
  const [yearA, setYearA] = useState(CY);
  const [yearB, setYearB] = useState('');
  const [yearC, setYearC] = useState('');

  const fetchYear = (y) => api.get(`/kpi/dashboard?year=${y}`).then(r => r.data);
  const { data: dataA, isLoading: loadA } = useQuery({ queryKey: ['kpi-dash', yearA], queryFn: () => fetchYear(yearA), staleTime: 30000 });
  const { data: dataB } = useQuery({ queryKey: ['kpi-dash', yearB], queryFn: () => fetchYear(yearB), enabled: !!yearB, staleTime: 30000 });
  const { data: dataC } = useQuery({ queryKey: ['kpi-dash', yearC], queryFn: () => fetchYear(yearC), enabled: !!yearC, staleTime: 30000 });

  const mapB = buildItemMonthMap(dataB);
  const mapC = buildItemMonthMap(dataC);

  const lblA = `ปี ${+yearA + 543}`;
  const lblB = yearB ? `ปี ${+yearB + 543}` : null;
  const lblC = yearC ? `ปี ${+yearC + 543}` : null;

  const multiYear = !!(lblB || lblC);
  // Custom legend
  const legendItems = [
    { color: YEAR_COLORS[0], label: lblA },
    ...(lblB ? [{ color: YEAR_COLORS[1], label: lblB }] : []),
    ...(lblC ? [{ color: YEAR_COLORS[2], label: lblC }] : []),
    ...(multiYear
      ? [
          { color: REF_LINE_COLORS[0], label: 'KPI ปัจจุบัน', dashed: true, note: '(เป้าเท่ากันทุกปี)' },
          { color: REF_LINE_COLORS[0], label: `เป้า ${lblA}`, dashed: true, note: '(ต่างปี)' },
          ...(lblB ? [{ color: REF_LINE_COLORS[1], label: `เป้า ${lblB}`, dashed: true, note: '(ต่างปี)' }] : []),
          ...(lblC ? [{ color: REF_LINE_COLORS[2], label: `เป้า ${lblC}`, dashed: true, note: '(ต่างปี)' }] : []),
        ]
      : [{ color: REF_LINE_COLORS[0], label: 'เป้าหมาย', dashed: true }]
    ),
  ];

  return (
    <div>
      <div className="card mb-6">
        <div className="text-small font-semibold text-text mb-3">เลือกปีที่ต้องการเปรียบเทียบ</div>
        <div className="flex flex-wrap items-center gap-3">
          <YearPicker tag="ปี A" value={yearA} onChange={v => setYearA(v || CY)} />
          <span className="text-muted text-small font-medium">vs</span>
          <YearPicker tag="ปี B" value={yearB} onChange={setYearB} clearable />
          <span className="text-muted text-small font-medium">vs</span>
          <YearPicker tag="ปี C" value={yearC} onChange={setYearC} clearable />
        </div>
        <div className="flex flex-wrap gap-4 mt-4 pt-3 border-t border-border">
          {legendItems.map((li, i) => (
            <span key={i} className="flex items-center gap-1 text-[11px] text-muted">
              {li.dashed ? (
                <span className="w-5 h-0 inline-block border-t-2 border-dashed flex-shrink-0" style={{ borderColor: li.color }} />
              ) : (
                <span className="w-3 h-3 rounded-sm inline-block flex-shrink-0" style={{ background: li.color }} />
              )}
              <span>{li.label}</span>
              {li.note && <span className="text-[10px] opacity-60">{li.note}</span>}
            </span>
          ))}
        </div>
      </div>

      {loadA && <div className="text-center py-16 text-muted text-small">กำลังโหลด...</div>}
      {!loadA && !dataA?.groups?.length && (
        <div className="card text-center py-16 text-muted text-small">
          ยังไม่มีข้อมูล KPI — เพิ่มรายการ KPI ในเมนู Setup ก่อน
        </div>
      )}

      {dataA?.groups?.map(({ group, items }) => items.length === 0 ? null : (
        <div key={group.id} className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-1 h-5 rounded-full bg-primary" />
            <h3 className="text-h3 font-bold text-text">{group.name}</h3>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {items.map(({ item, currentYear: currA }) => {
              const bMonths    = mapB[item.id] ?? {};
              const cMonths    = mapC[item.id] ?? {};
              const dir        = item.target_direction ?? 'gte';
              const summaryType = item.summary_type ?? 'average';
              const summaryLabel = summaryType === 'sum' ? 'รวม' : 'เฉลี่ย';

              // Target per year (representative = first non-null month)
              const targetA = currA.find(d => d.target !== null)?.target ?? null;
              const targetB = yearB ? (Object.values(bMonths).find(d => d?.target !== null)?.target ?? null) : null;
              const targetC = yearC ? (Object.values(cMonths).find(d => d?.target !== null)?.target ?? null) : null;

              // Reference lines: show separate per year only if targets differ
              const activeRefs = [
                { target: targetA, color: REF_LINE_COLORS[0], label: lblA },
                ...(lblB && targetB !== null ? [{ target: targetB, color: REF_LINE_COLORS[1], label: lblB }] : []),
                ...(lblC && targetC !== null ? [{ target: targetC, color: REF_LINE_COLORS[2], label: lblC }] : []),
              ].filter(r => r.target !== null);
              const uniqueTargets = [...new Set(activeRefs.map(r => r.target))];
              const sameTarget = uniqueTargets.length <= 1;

              // Annual summary (average or sum of months with actual data)
              const summaryA = calcSummary(currA, summaryType);
              const summaryB = yearB ? calcSummary(Object.values(bMonths), summaryType) : null;
              const summaryC = yearC ? calcSummary(Object.values(cMonths), summaryType) : null;
              const hasSummary = summaryA !== null || summaryB !== null || summaryC !== null;

              const annualPass = summaryA !== null && targetA !== null
                ? !checkFail(summaryA, targetA, dir) : null;

              const chartData = [
                // แท่งสรุปทั้งปี — อยู่หน้าสุด ก่อน ม.ค.
                ...(hasSummary ? [{
                  name: summaryLabel,
                  isSummary: true,
                  [lblA]: summaryA, _tA: targetA,
                  ...(lblB ? { [lblB]: summaryB, _tB: targetB } : {}),
                  ...(lblC ? { [lblC]: summaryC, _tC: targetC } : {}),
                }] : []),
                ...MONTH_SHORT.map((name, idx) => {
                  const m = idx + 1;
                  const dA = currA.find(d => d.month === m) ?? {};
                  const dB = bMonths[m] ?? {};
                  const dC = cMonths[m] ?? {};
                  return {
                    name,
                    [lblA]: dA.actual ?? null, _tA: dA.target ?? null,
                    ...(lblB ? { [lblB]: dB.actual ?? null, _tB: dB.target ?? null } : {}),
                    ...(lblC ? { [lblC]: dC.actual ?? null, _tC: dC.target ?? null } : {}),
                  };
                }),
              ];

              // Label renderer — แสดงเลขสีแดงบนแท่งที่ไม่ผ่าน + แสดงเลขเสมอบนแท่งสรุปปี
              const mkLabel = (tgtKey, dimColor) => ({ x, y, width, value, index }) => {
                if (value === null || value === undefined) return null;
                const entry = chartData[index];
                if (!entry) return null;
                const tgt  = entry[tgtKey];
                const fail = checkFail(value, tgt, dir);
                const isSummary = !!entry.isSummary;
                if (!fail && !isSummary) return null;
                return (
                  <text key={`lbl-${index}`}
                    x={x + width / 2} y={y - 4}
                    textAnchor="middle"
                    fontSize={isSummary ? 10 : 9}
                    fontWeight="700"
                    fill={fail ? '#DC2626' : dimColor}>
                    {value}
                  </text>
                );
              };

              return (
                <div key={item.id} className="card">
                  <div className="flex items-start justify-between mb-1">
                    <div>
                      <span className="text-[11px] font-mono text-muted">{item.kpi_no}</span>
                      <div className="font-semibold text-text">{item.name}</div>
                      <div className="flex flex-wrap items-center gap-2 mt-0.5">
                        {item.unit && <span className="text-small text-muted">{item.unit}</span>}
                        <span className={`text-[10px] font-medium ${dir === 'lte' ? 'text-orange-500 dark:text-orange-200' : 'text-blue-500 dark:text-blue-200'}`}>
                          {dir === 'lte' ? 'ไม่เกิน' : 'ไม่ต่ำกว่า'}
                        </span>
                        {/* แสดงเป้าหมายแยกปีถ้าต่างกัน */}
                        {sameTarget ? (
                          <span className="text-[10px] text-muted">{targetA ?? '—'}</span>
                        ) : (
                          activeRefs.map((r, i) => (
                            <span key={i} className="text-[10px] font-medium" style={{ color: r.color }}>
                              {r.label.replace('ปี ', '')}: {r.target}
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                    {annualPass !== null && (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${annualPass ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200' : 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200'}`}>
                        {annualPass ? 'ผ่านเป้า' : 'ไม่ผ่านเป้า'}
                      </span>
                    )}
                  </div>

                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={chartData} barCategoryGap="25%" barGap={1}
                      margin={{ bottom: 28 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                        <XAxis dataKey="name" interval={0}
                          tick={{ fontSize: 11, angle: -35, textAnchor: 'end', dy: 4 }} />
                        <YAxis tick={{ fontSize: 11 }} width={40}
                          domain={[0, (dataMax) => dataMax > 0 ? +(dataMax * 1.2).toFixed(4) : 1]} />
                        <Tooltip
                          formatter={(v, name) => [v !== null ? v : '—', name]}
                          contentStyle={{ fontSize: 12, borderRadius: 8 }}
                          labelFormatter={(label, payload) => {
                            const entry = payload?.[0]?.payload;
                            if (entry?.isSummary) return `${label}ทั้งปี (${summaryLabel})`;
                            return label;
                          }}
                        />
                        {/* Reference lines */}
                        {multiYear ? (
                          sameTarget ? (
                            activeRefs[0]?.target != null &&
                            <ReferenceLine y={activeRefs[0].target} stroke={REF_LINE_COLORS[0]} strokeWidth={2} strokeDasharray="6 3"
                              label={{ value: `KPI ปัจจุบัน: ${activeRefs[0].target}`, position: 'insideTopRight', fontSize: 10, fontWeight: 600, fill: REF_LINE_COLORS[0] }} />
                          ) : (
                            activeRefs.map((rl, i) => (
                              <ReferenceLine key={i} y={rl.target} stroke={rl.color} strokeWidth={2} strokeDasharray="6 3"
                                label={{ value: `เป้า ${rl.label}: ${rl.target}`, position: i === 0 ? 'insideTopRight' : 'insideBottomRight', fontSize: 10, fontWeight: 600, fill: rl.color }} />
                            ))
                          )
                        ) : (
                          targetA !== null &&
                          <ReferenceLine y={targetA} stroke={REF_LINE_COLORS[0]} strokeWidth={2} strokeDasharray="6 3"
                            label={{ value: `${targetA}`, position: 'insideTopRight', fontSize: 10, fontWeight: 600, fill: REF_LINE_COLORS[0] }} />
                        )}
                        <Bar dataKey={lblA} fill={YEAR_COLORS[0]} radius={[2,2,0,0]} legendType="none" label={mkLabel('_tA', YEAR_COLORS[0])}>
                          {chartData.map((e, i) => <Cell key={i} fill={YEAR_COLORS[0]} />)}
                        </Bar>
                        {lblB && (
                          <Bar dataKey={lblB} fill={YEAR_COLORS[1]} radius={[2,2,0,0]} legendType="none" label={mkLabel('_tB', YEAR_COLORS[1])}>
                            {chartData.map((e, i) => <Cell key={i} fill={YEAR_COLORS[1]} />)}
                          </Bar>
                        )}
                        {lblC && (
                          <Bar dataKey={lblC} fill={YEAR_COLORS[2]} radius={[2,2,0,0]} legendType="none" label={mkLabel('_tC', YEAR_COLORS[2])}>
                            {chartData.map((e, i) => <Cell key={i} fill={YEAR_COLORS[2]} />)}
                          </Bar>
                        )}
                      </BarChart>
                    </ResponsiveContainer>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── บันทึก KPI TAB ──────────────────────────────────────────────────────────
function BantukTab({ canEdit }) {
  const qc = useQueryClient();
  const { showToast, ToastPortal } = useToast();
  const [year, setYear]   = useState(CY);
  const [month, setMonth] = useState(new Date().getMonth() + 1);

  const { data: itemsData } = useQuery({
    queryKey: ['kpi-items-active'],
    queryFn: () => api.get('/kpi/items').then(r => r.data),
  });
  const items = (itemsData?.data ?? itemsData ?? []).filter(i => i.is_active !== 0);

  const { data: targetsData, isLoading: loadingTargets } = useQuery({
    queryKey: ['kpi-targets', year],
    queryFn: () => api.get(`/kpi/targets?year=${year}`).then(r => r.data),
  });
  const targetMap = {};
  (targetsData?.items ?? []).forEach(t => { targetMap[t.kpi_item_id] = t.months ?? {}; });
  // แสดงเฉพาะ item ที่มีเป้าหมายในปีที่เลือก
  const itemsWithTarget = new Set((targetsData?.items ?? []).map(t => t.kpi_item_id));
  const displayItems = loadingTargets ? items : items.filter(i => itemsWithTarget.has(i.id));

  const { data: actualsData, refetch: refetchActuals } = useQuery({
    queryKey: ['kpi-actuals', year, month],
    queryFn: () => api.get(`/kpi/actuals?year=${year}&month=${month}`).then(r => r.data),
  });
  const actualsMap = {};
  (actualsData?.data ?? []).forEach(a => { actualsMap[a.kpi_item_id] = a; });

  // ดึง Action Plan ของเดือนนั้น — ถ้ามี AP (status ≠ draft) ล็อกการแก้ไข
  const { data: plansData } = useQuery({
    queryKey: ['kpi-action-plans', year, month],
    queryFn: () => api.get(`/kpi/action-plans?year=${year}&month=${month}`).then(r => r.data),
  });
  const apMap = {};
  (plansData?.data ?? []).forEach(ap => {
    if (ap.status !== 'draft') apMap[ap.kpi_item_id] = ap;
  });

  const [form, setForm] = useState({});
  useEffect(() => {
    const init = {};
    items.forEach(item => {
      const a = actualsMap[item.id] || {};
      init[item.id] = {
        actual_value:      a.actual_value ?? '',
        fail_cause:        a.fail_cause ?? '',
        corrective_action: a.corrective_action ?? '',
        preventive_action: a.preventive_action ?? '',
        remark:            a.remark ?? '',
      };
    });
    setForm(init);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actualsData, items.length, year, month]);

  const setField = (itemId, field, val) =>
    setForm(p => ({ ...p, [itemId]: { ...(p[itemId] ?? {}), [field]: val } }));

  const saveMutation = useMutation({
    mutationFn: (entries) => api.post('/kpi/actuals/bulk', { year, month, entries }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kpi-actuals', year, month] });
      qc.invalidateQueries({ queryKey: ['kpi-dashboard'] });
      refetchActuals();
      showToast(`บันทึกข้อมูล KPI ${MONTH_FULL[month - 1]} ${year + 543} สำเร็จ`);
    },
    onError: (e) => showToast(e?.response?.data?.error || 'บันทึกไม่สำเร็จ', 'error'),
  });

  function handleSave() {
    const entries = displayItems
      .filter(i => i.data_source_type === 'manual' && !apMap[i.id])
      .map(item => {
        const f = form[item.id] ?? {};
        return {
          kpi_item_id:       item.id,
          actual_value:      f.actual_value !== '' ? Number(f.actual_value) : null,
          fail_cause:        f.fail_cause || null,
          corrective_action: f.corrective_action || null,
          preventive_action: f.preventive_action || null,
          remark:            f.remark || null,
        };
      });
    saveMutation.mutate(entries);
  }

  function isFail(item) {
    const f = form[item.id];
    const target = targetMap[item.id]?.[month];
    if (!f || f.actual_value === '' || target === undefined || target === null) return false;
    return item.target_direction === 'lte'
      ? Number(f.actual_value) > Number(target)
      : Number(f.actual_value) < Number(target);
  }

  const failCount = displayItems.filter(i => isFail(i)).length;
  const lockedCount = displayItems.filter(i => !!apMap[i.id]).length;

  return (
    <div>
      {/* Filter + action bar */}
      <div className="card mb-4 flex flex-wrap items-center gap-3 py-3">
        <div className="flex items-center gap-2">
          <span className="text-small text-muted whitespace-nowrap">ปี</span>
          <select className="input py-1.5 h-9 w-auto text-small" value={year} onChange={e => setYear(+e.target.value)}>
            {yearRange().map(y => <option key={y} value={y}>{y + 543}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-small text-muted whitespace-nowrap">เดือน</span>
          <select className="input py-1.5 h-9 w-auto text-small" value={month} onChange={e => setMonth(+e.target.value)}>
            {MONTH_FULL.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-3 ml-auto text-small">
          {failCount > 0 && <span className="text-danger font-semibold">{failCount} ไม่ผ่าน</span>}
          {lockedCount > 0 && <span className="text-muted">{lockedCount} รายการ มี AP แล้ว</span>}
          <span className="text-muted">{displayItems.length} รายการ</span>
        </div>
        {canEdit && (
          <Button size="sm" loading={saveMutation.isPending} onClick={handleSave}>
            บันทึก {MONTH_FULL[month-1]} {year + 543}
          </Button>
        )}
      </div>

      {!loadingTargets && displayItems.length === 0 && (
        <div className="card text-center py-12 text-muted text-small">
          {items.length === 0 ? 'ยังไม่มีรายการ KPI — เพิ่มในเมนู Setup ก่อน' : `ไม่มีรายการ KPI ที่ตั้งเป้าหมายไว้สำหรับปี ${year + 543}`}
        </div>
      )}

      {displayItems.length > 0 && (
        <div className="card overflow-hidden p-0">
          {/* Table header */}
          <div className="grid text-[11px] font-semibold text-white bg-primary px-3 py-2"
            style={{ gridTemplateColumns: '90px 1fr 60px 100px 64px 110px' }}>
            <div>KPI No.</div>
            <div>ชื่อ / กลุ่ม</div>
            <div className="text-center">เป้า</div>
            <div className="text-center">ค่าจริง</div>
            <div className="text-center">ผล</div>
            <div className="text-center">AP / หมายเหตุ</div>
          </div>

          <div className="divide-y divide-border">
            {displayItems.map(item => {
              const target  = targetMap[item.id]?.[month];
              const f       = form[item.id] ?? {};
              const isManual = item.data_source_type === 'manual';
              const fail    = isFail(item);
              const ap      = apMap[item.id];
              const isLocked = !!ap;
              const editable = canEdit && isManual && !isLocked;

              return (
                <React.Fragment key={item.id}>
                  {/* Main row */}
                  <div className={`grid items-center px-3 py-2 gap-2 text-small
                    ${fail ? 'bg-red-50 dark:bg-red-900' : ''}
                    ${isLocked ? 'opacity-80' : ''}`}
                    style={{ gridTemplateColumns: '90px 1fr 60px 100px 64px 110px' }}>

                    {/* KPI No */}
                    <div className="font-mono text-[10px] text-muted leading-tight">{item.kpi_no}</div>

                    {/* Name */}
                    <div className="min-w-0">
                      <div className="font-semibold text-text truncate">{item.name}</div>
                      <div className="text-[10px] text-muted truncate">{item.group_name}{item.unit && ` · ${item.unit}`}</div>
                    </div>

                    {/* Target */}
                    <div className="text-center">
                      <div className={`font-bold ${target !== undefined && target !== null ? 'text-warning' : 'text-muted'}`}>
                        {target !== undefined && target !== null ? target : '—'}
                      </div>
                      <div className="text-[9px] text-muted">{item.target_direction === 'lte' ? '≤' : '≥'}</div>
                    </div>

                    {/* Actual input */}
                    <div className="text-center">
                      {isManual ? (
                        <input
                          type="number" step="any"
                          className={`input h-8 text-center text-small w-full px-2 ${fail ? 'border-danger' : ''} ${!editable ? 'bg-bg text-muted cursor-not-allowed' : ''}`}
                          value={f.actual_value ?? ''}
                          onChange={e => setField(item.id, 'actual_value', e.target.value)}
                          placeholder="—"
                          disabled={!editable}
                        />
                      ) : (
                        <span className="text-muted text-[11px]">
                          {actualsMap[item.id]?.actual_value ?? 'auto'}
                        </span>
                      )}
                    </div>

                    {/* Pass/fail badge */}
                    <div className="text-center">
                      {f.actual_value !== '' && target !== null && target !== undefined ? (
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold
                          ${!fail ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200' : 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200'}`}>
                          {!fail ? 'ผ่าน' : 'ไม่ผ่าน'}
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted">—</span>
                      )}
                    </div>

                    {/* AP badge OR remark */}
                    <div className="text-center">
                      {ap ? (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${AP_STATUS[ap.status]?.cls}`}>
                          <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                          </svg>
                          {AP_STATUS[ap.status]?.label}
                        </span>
                      ) : isManual ? (
                        <input
                          className="input h-8 text-small w-full px-2"
                          value={f.remark ?? ''}
                          onChange={e => setField(item.id, 'remark', e.target.value)}
                          placeholder="หมายเหตุ"
                          disabled={!editable}
                        />
                      ) : null}
                    </div>
                  </div>

                  {/* Sub-row: fail details */}
                  {isManual && fail && (
                    <div className={`px-3 py-2 border-t border-dashed ${isLocked ? 'border-muted/30 bg-bg' : 'border-danger/30 bg-red-50/60 dark:bg-red-900'}`}>
                      {isLocked ? (
                        // Read-only view when AP exists
                        <div className="grid grid-cols-3 gap-3 text-[11px]">
                          <div><span className="text-muted">สาเหตุ: </span>{f.fail_cause || <span className="text-muted/50">—</span>}</div>
                          <div><span className="text-muted">แก้ไข: </span>{f.corrective_action || <span className="text-muted/50">—</span>}</div>
                          <div><span className="text-muted">ป้องกัน: </span>{f.preventive_action || <span className="text-muted/50">—</span>}</div>
                        </div>
                      ) : (
                        // Editable when no AP
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                          <div>
                            <label className="text-[10px] font-semibold text-danger block mb-0.5">สาเหตุที่ไม่ผ่าน *</label>
                            <textarea className="input text-small resize-none w-full" rows={2}
                              value={f.fail_cause ?? ''} onChange={e => setField(item.id, 'fail_cause', e.target.value)}
                              placeholder="ระบุสาเหตุ..." disabled={!editable} />
                          </div>
                          <div>
                            <label className="text-[10px] font-semibold text-warning block mb-0.5">วิธีการแก้ไข *</label>
                            <textarea className="input text-small resize-none w-full" rows={2}
                              value={f.corrective_action ?? ''} onChange={e => setField(item.id, 'corrective_action', e.target.value)}
                              placeholder="ระบุวิธีแก้ไข..." disabled={!editable} />
                          </div>
                          <div>
                            <label className="text-[10px] font-semibold text-accent block mb-0.5">วิธีการป้องกัน *</label>
                            <textarea className="input text-small resize-none w-full" rows={2}
                              value={f.preventive_action ?? ''} onChange={e => setField(item.id, 'preventive_action', e.target.value)}
                              placeholder="ระบุวิธีป้องกัน..." disabled={!editable} />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}
      {ToastPortal}
    </div>
  );
}

// ─── SETUP TAB ───────────────────────────────────────────────────────────────

// ─── TITLE TEMPLATE FORM ─────────────────────────────────────────────────────
function TitleTemplateForm({ initial = {}, groups = [], kpiUnits = [], onSave, loading, onClose }) {
  const [form, setForm] = useState({ name: '', group_id: '', unit_id: '', ...initial });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  return (
    <form onSubmit={e => { e.preventDefault(); onSave(form); }} className="space-y-3">
      <div>
        <label className="label">ชื่อหัวข้อ KPI <span className="text-danger">*</span></label>
        <input className="input" value={form.name} onChange={e => set('name', e.target.value)}
          required placeholder="เช่น อัตราของเสีย, อัตราการผ่านตรวจ" autoFocus />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">กลุ่ม KPI <span className="text-danger">*</span></label>
          <select className="input" value={form.group_id} onChange={e => set('group_id', e.target.value)} required>
            <option value="">-- เลือกกลุ่ม --</option>
            {groups.filter(g => g.is_active !== 0).map(g => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">หน่วย KPI <span className="text-danger">*</span></label>
          <select className="input" value={form.unit_id} onChange={e => set('unit_id', e.target.value)} required>
            <option value="">-- เลือกหน่วย --</option>
            {kpiUnits.filter(u => u.is_active !== 0).map(u => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-[11px] text-muted">กลุ่มและหน่วยจะถูก auto-fill ในรายการ KPI เมื่อเลือกหัวข้อนี้</p>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" type="button" onClick={onClose}>ยกเลิก</Button>
        <Button type="submit" loading={loading}>บันทึก</Button>
      </div>
    </form>
  );
}

function UnitForm({ initial = {}, onSave, loading, onClose }) {
  const [form, setForm] = useState({ name: '', ...initial });
  return (
    <form onSubmit={e => { e.preventDefault(); onSave(form); }} className="space-y-3">
      <div>
        <label className="label">ชื่อหน่วย <span className="text-danger">*</span></label>
        <input className="input" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
          required placeholder="เช่น %, ครั้ง, ชิ้น, PPM" autoFocus />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" type="button" onClick={onClose}>ยกเลิก</Button>
        <Button type="submit" loading={loading}>บันทึก</Button>
      </div>
    </form>
  );
}

function NoPatternForm({ initial = {}, onSave, loading, onClose }) {
  const [form, setForm] = useState({ prefix: '', description: '', ...initial });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  return (
    <form onSubmit={e => { e.preventDefault(); onSave(form); }} className="space-y-3">
      <div>
        <label className="label">Prefix (รูปแบบ) <span className="text-danger">*</span></label>
        <input className="input font-mono uppercase" value={form.prefix}
          onChange={e => set('prefix', e.target.value.replace(/[^A-Za-z0-9\-]/g, '').toUpperCase())}
          required placeholder="เช่น KPI, QC, IQC" maxLength={10} autoFocus />
        <p className="text-[11px] text-muted mt-1">ตัวอักษรพิมพ์ใหญ่ A-Z, ตัวเลข 0-9, เครื่องหมาย - เท่านั้น</p>
      </div>
      <div>
        <label className="label">คำอธิบาย</label>
        <input className="input" value={form.description}
          onChange={e => set('description', e.target.value)}
          placeholder="เช่น KPI หลัก, QC Incoming" />
      </div>
      {form.prefix && (
        <p className="text-small text-muted bg-bg px-3 py-2 rounded-lg">
          ตัวอย่าง KPI No.: <span className="font-mono font-semibold text-text">{form.prefix}-001</span>, <span className="font-mono text-text">{form.prefix}-002</span>
        </p>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" type="button" onClick={onClose}>ยกเลิก</Button>
        <Button type="submit" loading={loading}>บันทึก</Button>
      </div>
    </form>
  );
}

function GroupForm({ initial = {}, onSave, loading, onClose }) {
  const [form, setForm] = useState({ name: '', ...initial });
  return (
    <form onSubmit={e => { e.preventDefault(); onSave(form); }} className="space-y-3">
      <div>
        <label className="label">ชื่อกลุ่ม KPI <span className="text-danger">*</span></label>
        <input
          className="input"
          value={form.name}
          onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
          required
          placeholder="เช่น งานคุณภาพ"
          autoFocus
        />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" type="button" onClick={onClose}>ยกเลิก</Button>
        <Button type="submit" loading={loading}>บันทึก</Button>
      </div>
    </form>
  );
}

function ItemForm({ initial = {}, groups = [], dbSources = [], titleTemplates = [], kpiUnits = [], noPatterns = [], onSave, loading, onClose }) {
  const isEdit = !!initial.id;

  // target_years: array of selected years (instead of single target_year)
  const initYears = initial.target_years_arr
    ? initial.target_years_arr
    : initial.target_year ? [Number(initial.target_year)] : [CY];

  const [form, setForm] = useState({
    group_id: '',
    name: '',
    unit: '',
    description: '',
    data_source_type: 'manual',
    data_source_key: '',
    ...initial,
    target_direction: initial.target_direction ?? 'gte',
    summary_type: initial.summary_type ?? 'average',
    target_years: initYears,
    target_value: initial.target_value ?? '',
    kpi_no_prefix: initial.kpi_no_prefix ?? 'KPI',
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const toggleYear = (y) => {
    const cur = form.target_years ?? [];
    if (cur.includes(y)) {
      if (cur.length === 1) return; // ต้องเลือกอย่างน้อย 1 ปี
      set('target_years', cur.filter(x => x !== y));
    } else {
      set('target_years', [...cur, y].sort((a, b) => a - b));
    }
  };

  return (
    <form onSubmit={e => { e.preventDefault(); onSave(form); }} className="space-y-3">
      {/* 1. ปีที่ใช้ KPI — multi-select */}
      <div>
        <label className="label">ปีที่ใช้ KPI <span className="text-danger">*</span></label>
        <div className="flex flex-wrap gap-2 mt-1">
          {PICK_YEARS.map(y => (
            <button key={y} type="button"
              onClick={() => toggleYear(y)}
              className={`px-3 py-1.5 rounded-lg text-small font-mono border transition-colors ${
                (form.target_years ?? []).includes(y)
                  ? 'bg-primary text-white border-primary'
                  : 'bg-bg border-border text-text hover:border-accent'
              }`}>
              {y + 543}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted mt-1">เลือกได้หลายปี — เป้าหมายเดียวกันใช้กับทุกปีที่เลือก</p>
      </div>

      {/* 2. ชื่อ KPI — dropdown เท่านั้น (เลือกแล้ว auto-fill กลุ่ม + หน่วยด้วย) */}
      <div>
        <label className="label">ชื่อ KPI <span className="text-danger">*</span></label>
        <select
          className="input"
          value={form.name}
          onChange={e => {
            const tmpl = titleTemplates.find(t => t.name === e.target.value);
            setForm(p => ({
              ...p,
              name: e.target.value,
              ...(tmpl?.group_id ? { group_id: String(tmpl.group_id) } : {}),
              ...(tmpl?.unit_name ? { unit: tmpl.unit_name } : {}),
            }));
          }}
          required
        >
          <option value="">-- เลือกหัวข้อ KPI --</option>
          {titleTemplates.map(t => (
            <option key={t.id} value={t.name}>{t.name}</option>
          ))}
        </select>
        {titleTemplates.length === 0 && (
          <p className="text-[11px] text-warning mt-1">ยังไม่มีหัวข้อ KPI — กรุณาเพิ่มหัวข้อใน Setup → หัวข้อ KPI ก่อน</p>
        )}
      </div>

      {/* 3. หน่วย KPI + กลุ่ม KPI — auto จากหัวข้อ KPI (read-only) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">หน่วย KPI <span className="text-[11px] text-muted font-normal">(Auto)</span></label>
          <div className={`input bg-bg cursor-not-allowed flex items-center ${!form.unit ? 'text-muted' : 'text-text font-medium'}`}>
            {form.unit || <span className="text-muted text-[11px]">— เลือกชื่อ KPI ก่อน —</span>}
          </div>
        </div>
        <div>
          <label className="label">กลุ่ม KPI <span className="text-[11px] text-muted font-normal">(Auto)</span></label>
          <div className={`input bg-bg cursor-not-allowed flex items-center ${!form.group_id ? 'text-muted' : 'text-text font-medium'}`}>
            {form.group_id
              ? (groups.find(g => String(g.id) === String(form.group_id))?.name || <span className="text-muted text-[11px]">—</span>)
              : <span className="text-muted text-[11px]">— เลือกชื่อ KPI ก่อน —</span>}
          </div>
        </div>
      </div>

      {/* 4. รูปแบบ KPI No. — เฉพาะตอนเพิ่มใหม่ / KPI No. — ตอนแก้ไข */}
      {!isEdit ? (
        <div>
          <label className="label">รูปแบบ KPI No. <span className="text-danger">*</span> <span className="text-[11px] text-muted font-normal">(ระบบต่อเลขอัตโนมัติ)</span></label>
          <div className="flex items-center gap-3">
            <select
              className="input w-40 font-mono"
              value={form.kpi_no_prefix}
              onChange={e => set('kpi_no_prefix', e.target.value)}
              required
            >
              <option value="">-- เลือกรูปแบบ --</option>
              {noPatterns.map(p => (
                <option key={p.id} value={p.prefix}>{p.prefix}{p.description ? ` — ${p.description}` : ''}</option>
              ))}
            </select>
            {form.kpi_no_prefix && (
              <span className="text-small text-muted">
                → <span className="font-mono font-semibold text-text">{form.kpi_no_prefix}-001</span>
              </span>
            )}
          </div>
          {noPatterns.length === 0 && (
            <p className="text-[11px] text-warning mt-1">ยังไม่มีรูปแบบ — เพิ่มใน Setup → รูปแบบ KPI ก่อน</p>
          )}
        </div>
      ) : (
        <div>
          <label className="label">KPI No. <span className="text-[11px] text-muted font-normal">(ไม่สามารถเปลี่ยนได้)</span></label>
          <div className="input bg-bg text-muted font-mono cursor-not-allowed">{initial.kpi_no}</div>
        </div>
      )}

      {/* เป้าหมาย KPI + เงื่อนไข — อยู่แถวเดียวกัน */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">
            เป้าหมาย KPI <span className="text-danger">*</span>
          </label>
          <input
            type="number"
            step="any"
            className="input"
            value={form.target_value}
            onChange={e => set('target_value', e.target.value)}
            placeholder="ตัวเลขเป้าหมาย"
            required
          />
        </div>
        <div>
          <label className="label">เงื่อนไขเป้าหมาย <span className="text-danger">*</span></label>
          <div className="flex gap-0 mt-1">
            {[
              { value: 'gte', label: 'ไม่ต่ำกว่า', sub: '≥ เป้า = ผ่าน' },
              { value: 'lte', label: 'ไม่เกิน',    sub: '≤ เป้า = ผ่าน' },
            ].map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => set('target_direction', opt.value)}
                className={`flex-1 px-3 py-2 text-small border transition-colors first:rounded-l-lg last:rounded-r-lg -ml-px first:ml-0 ${
                  form.target_direction === opt.value
                    ? 'bg-primary text-white border-primary z-10 font-medium'
                    : 'bg-surface text-muted border-border hover:bg-bg'
                }`}
              >
                <div>{opt.label}</div>
                <div className="text-[10px] opacity-75">{opt.sub}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* สรุปข้อมูลทั้งปี */}
      <div>
        <label className="label">สรุปข้อมูลทั้งปี <span className="text-danger">*</span></label>
        <div className="flex gap-0 mt-1">
          {[
            { value: 'average', label: 'เฉลี่ย', sub: 'ข้อมูลของทุกเดือน' },
            { value: 'sum',     label: 'รวม',    sub: 'ข้อมูลของทุกเดือน' },
          ].map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => set('summary_type', opt.value)}
              className={`flex-1 px-3 py-2 text-small border transition-colors first:rounded-l-lg last:rounded-r-lg -ml-px first:ml-0 ${
                form.summary_type === opt.value
                  ? 'bg-primary text-white border-primary z-10 font-medium'
                  : 'bg-surface text-muted border-border hover:bg-bg'
              }`}
            >
              <div>{opt.label}</div>
              <div className="text-[10px] opacity-75">{opt.sub}</div>
            </button>
          ))}
        </div>
      </div>

      {/* แหล่งข้อมูล */}
      <div>
        <label className="label">แหล่งข้อมูล</label>
        <div className="flex gap-6 mt-1.5">
          {['manual','database'].map(t => (
            <label key={t} className="flex items-center gap-2 cursor-pointer text-small min-h-[44px]">
              <input
                type="radio"
                name="data_source_type"
                checked={form.data_source_type === t}
                onChange={() => set('data_source_type', t)}
              />
              {t === 'manual' ? 'Manual (กรอกเอง)' : 'จากฐานข้อมูลระบบ'}
            </label>
          ))}
        </div>
      </div>

      {form.data_source_type === 'database' && (
        <div>
          <label className="label">ฟิลด์ข้อมูล</label>
          <select
            className="input"
            value={form.data_source_key}
            onChange={e => set('data_source_key', e.target.value)}
          >
            <option value="">-- เลือกแหล่งข้อมูล --</option>
            {dbSources.map(s => (
              <option key={s.key} value={s.key}>{s.label} ({s.unit})</option>
            ))}
          </select>
        </div>
      )}

      {/* คำอธิบาย */}
      <div>
        <label className="label">คำอธิบาย</label>
        <textarea
          className="input"
          rows={2}
          value={form.description}
          onChange={e => set('description', e.target.value)}
          placeholder="รายละเอียดเพิ่มเติม (ถ้ามี)"
        />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" type="button" onClick={onClose}>ยกเลิก</Button>
        <Button type="submit" loading={loading}>บันทึก</Button>
      </div>
    </form>
  );
}

function SetupTab() {
  const qc = useQueryClient();
  const { showToast, ToastPortal } = useToast();
  const [section, setSection] = useState('patterns');

  // ── Title Templates ──────────────────────────────────────────────
  const { data: titleTemplatesData, refetch: refetchTitles } = useQuery({
    queryKey: ['kpi-title-templates'],
    queryFn: () => api.get('/kpi/title-templates').then(r => r.data?.data ?? []),
  });
  const titleTemplates = titleTemplatesData ?? [];

  const [titleModal, setTitleModal] = useState(false);
  const [editingTitle, setEditingTitle] = useState(null);

  const saveTitleTemplate = useMutation({
    mutationFn: (body) => body.id
      ? api.patch(`/kpi/title-templates/${body.id}`, body)
      : api.post('/kpi/title-templates', body),
    onSuccess: (_, vars) => {
      refetchTitles();
      setTitleModal(false);
      setEditingTitle(null);
      showToast(vars.id ? 'แก้ไขหัวข้อ KPI สำเร็จ' : 'เพิ่มหัวข้อ KPI สำเร็จ');
    },
    onError: (e) => showToast(e?.response?.data?.error || 'บันทึกไม่สำเร็จ', 'error'),
  });

  const toggleTitleTemplate = useMutation({
    mutationFn: ({ id, is_active }) => api.patch(`/kpi/title-templates/${id}`, { is_active }),
    onSuccess: () => refetchTitles(),
    onError: (e) => showToast(e?.response?.data?.error || 'เปลี่ยนสถานะไม่สำเร็จ', 'error'),
  });

  // ── Groups ──────────────────────────────────────────────
  const { data: groupsData, refetch: refetchGroups } = useQuery({
    queryKey: ['kpi-groups'],
    queryFn: () => api.get('/kpi/groups').then(r => r.data),
  });
  const groups = groupsData?.data ?? groupsData ?? [];

  const [groupModal, setGroupModal] = useState(false);
  const [editingGroup, setEditingGroup] = useState(null);

  const saveGroup = useMutation({
    mutationFn: (body) => body.id
      ? api.patch(`/kpi/groups/${body.id}`, body)
      : api.post('/kpi/groups', body),
    onSuccess: (_, vars) => {
      refetchGroups();
      setGroupModal(false);
      setEditingGroup(null);
      showToast(vars.id ? 'แก้ไขกลุ่ม KPI สำเร็จ' : 'เพิ่มกลุ่ม KPI สำเร็จ');
    },
    onError: (e) => showToast(e?.response?.data?.error || 'บันทึกไม่สำเร็จ', 'error'),
  });

  const toggleGroup = useMutation({
    mutationFn: ({ id, is_active }) => api.patch(`/kpi/groups/${id}`, { is_active }),
    onSuccess: () => refetchGroups(),
    onError: (e) => showToast(e?.response?.data?.error || 'เปลี่ยนสถานะไม่สำเร็จ', 'error'),
  });

  // ── Items ──────────────────────────────────────────────
  const { data: itemsData, refetch: refetchItems } = useQuery({
    queryKey: ['kpi-items'],
    queryFn: () => api.get('/kpi/items?limit=200').then(r => r.data),
  });
  const items = itemsData?.data ?? itemsData ?? [];

  const { data: dbSourcesData } = useQuery({
    queryKey: ['kpi-db-sources'],
    queryFn: () => api.get('/kpi/db-sources').then(r => r.data),
  });
  const dbSources = Array.isArray(dbSourcesData)
    ? dbSourcesData
    : Object.entries(dbSourcesData ?? {}).map(([key, v]) => ({ key, ...v }));

  const [itemModal, setItemModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);

  const saveItem = useMutation({
    mutationFn: async (body) => {
      const { target_years, target_value, kpi_no_prefix, target_years_arr, year_targets, ...itemBody } = body;
      let itemRes;
      if (body.id) {
        itemRes = await api.patch(`/kpi/items/${body.id}`, itemBody);
      } else {
        itemRes = await api.post('/kpi/items', { ...itemBody, kpi_no_prefix });
      }
      const itemId = itemRes.data?.id ?? body.id;
      const yearsToSave = (target_years ?? [CY]).map(Number);

      // ลบปีที่ถูก deselect ออก (เฉพาะตอน edit)
      if (body.id && year_targets) {
        const existingYears = Object.keys(year_targets).map(Number);
        const yearsToRemove = existingYears.filter(y => !yearsToSave.includes(y));
        for (const yr of yearsToRemove) {
          await api.delete(`/kpi/targets/${itemId}/year/${yr}`);
        }
      }

      // upsert ปีที่เลือกไว้
      if (yearsToSave.length && target_value !== '' && target_value !== undefined && target_value !== null) {
        for (const yr of yearsToSave) {
          const entries = Array.from({ length: 12 }, (_, i) => ({
            kpi_item_id: itemId,
            month: i + 1,
            target_value: Number(target_value),
          }));
          await api.post('/kpi/targets', { year: yr, entries });
        }
      }
      return itemRes.data;
    },
    onSuccess: (_, vars) => {
      refetchItems().then(r => {
        const fresh = r.data?.data ?? [];
        if (fresh.length) setLocalItems(fresh);
      });
      qc.invalidateQueries({ queryKey: ['kpi-items-active'] });
      qc.invalidateQueries({ queryKey: ['kpi-targets'] });
      setItemModal(false);
      setEditingItem(null);
      showToast(vars.id ? 'แก้ไขรายการ KPI สำเร็จ' : 'เพิ่มรายการ KPI สำเร็จ');
    },
    onError: (e) => showToast(e?.response?.data?.error || 'บันทึกไม่สำเร็จ', 'error'),
  });

  const toggleItem = useMutation({
    mutationFn: ({ id, is_active }) => api.patch(`/kpi/items/${id}`, { is_active }),
    onSuccess: () => {
      refetchItems();
      qc.invalidateQueries({ queryKey: ['kpi-items-active'] });
    },
    onError: (e) => showToast(e?.response?.data?.error || 'เปลี่ยนสถานะไม่สำเร็จ', 'error'),
  });

  // ── KPI Units ──────────────────────────────────────────────
  const { data: kpiUnitsData, refetch: refetchUnits } = useQuery({
    queryKey: ['kpi-units'],
    queryFn: () => api.get('/kpi/units?all=1').then(r => r.data),
  });
  const kpiUnits = Array.isArray(kpiUnitsData) ? kpiUnitsData : [];

  const [unitModal, setUnitModal] = useState(false);
  const [editingUnit, setEditingUnit] = useState(null);

  const saveUnit = useMutation({
    mutationFn: (body) => body.id
      ? api.patch(`/kpi/units/${body.id}`, body)
      : api.post('/kpi/units', body),
    onSuccess: (_, vars) => {
      refetchUnits();
      setUnitModal(false);
      setEditingUnit(null);
      showToast(vars.id ? 'แก้ไขหน่วย KPI สำเร็จ' : 'เพิ่มหน่วย KPI สำเร็จ');
    },
    onError: (e) => showToast(e?.response?.data?.error || 'บันทึกไม่สำเร็จ', 'error'),
  });

  const toggleUnit = useMutation({
    mutationFn: ({ id, is_active }) => api.patch(`/kpi/units/${id}`, { is_active }),
    onSuccess: () => refetchUnits(),
    onError: (e) => showToast(e?.response?.data?.error || 'เปลี่ยนสถานะไม่สำเร็จ', 'error'),
  });

  // ── KPI No. Patterns ──────────────────────────────────────────────────────
  const { data: noPatternsData, refetch: refetchNoPatterns } = useQuery({
    queryKey: ['kpi-no-patterns'],
    queryFn: () => api.get('/kpi/no-patterns?all=1').then(r => r.data),
  });
  const noPatterns = Array.isArray(noPatternsData) ? noPatternsData : [];

  const [noPatternModal, setNoPatternModal] = useState(false);
  const [editingNoPattern, setEditingNoPattern] = useState(null);

  const saveNoPattern = useMutation({
    mutationFn: (body) => body.id
      ? api.patch(`/kpi/no-patterns/${body.id}`, body)
      : api.post('/kpi/no-patterns', body),
    onSuccess: (_, vars) => {
      refetchNoPatterns();
      setNoPatternModal(false);
      setEditingNoPattern(null);
      showToast(vars.id ? 'แก้ไขรูปแบบ KPI No. สำเร็จ' : 'เพิ่มรูปแบบ KPI No. สำเร็จ');
    },
    onError: (e) => showToast(e?.response?.data?.error || 'บันทึกไม่สำเร็จ', 'error'),
  });

  const toggleNoPattern = useMutation({
    mutationFn: ({ id, is_active }) => api.patch(`/kpi/no-patterns/${id}`, { is_active }),
    onSuccess: () => refetchNoPatterns(),
    onError: (e) => showToast(e?.response?.data?.error || 'เปลี่ยนสถานะไม่สำเร็จ', 'error'),
  });

  // ── Drag-to-reorder items ──────────────────────────────────────────────────
  const [localItems, setLocalItems] = useState([]);
  const [draggingId, setDraggingId] = useState(null);
  const dragOverId = useRef(null);

  useEffect(() => { setLocalItems(items); }, [items]);

  const reorderMutation = useMutation({
    mutationFn: (ordered) => api.patch('/kpi/items/reorder', {
      items: ordered.map((item, i) => ({ id: item.id, display_order: i + 1 })),
    }),
    onError: (e) => showToast(e?.response?.data?.error || 'จัดลำดับไม่สำเร็จ', 'error'),
  });

  const handleDragStart = (e, id) => {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragOver = (e, id) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    dragOverId.current = id;
  };
  // targetId = row ที่ถูก drop ลง, draggingId = source ที่ถูกลาก
  const handleDrop = (targetId) => {
    const sourceId = draggingId;
    setDraggingId(null);
    dragOverId.current = null;
    if (!sourceId || sourceId === targetId) return;
    const arr = [...localItems];
    const fromIdx = arr.findIndex(i => i.id === sourceId);
    const toIdx   = arr.findIndex(i => i.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = arr.splice(fromIdx, 1);
    arr.splice(toIdx, 0, moved);
    setLocalItems(arr);
    reorderMutation.mutate(arr);
  };

  const SUB_TABS = [
    { key: 'patterns', label: 'รูปแบบ KPI' },
    { key: 'titles',   label: 'หัวข้อ KPI' },
    { key: 'units',    label: 'หน่วย KPI' },
    { key: 'groups',   label: 'กลุ่ม KPI' },
    { key: 'items',    label: 'รายการ KPI' },
  ];

  return (
    <div>
      <div className="flex gap-1 mb-6 border-b border-border">
        {SUB_TABS.map(s => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSection(s.key)}
            className={`px-4 py-2.5 text-body font-medium border-b-2 -mb-px transition-colors min-h-[44px] ${
              section === s.key ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-text'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* ── รูปแบบ KPI No. ── */}
      {section === 'patterns' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-h3 font-semibold text-text">รูปแบบ KPI No.</h3>
              <p className="text-[11px] text-muted mt-0.5">Prefix ที่ใช้ต่อหน้าเลขลำดับ เช่น KPI-001, QC-001</p>
            </div>
            <Button type="button" onClick={() => { setEditingNoPattern(null); setNoPatternModal(true); }}>
              + เพิ่มรูปแบบ
            </Button>
          </div>
          <div className="card overflow-x-auto">
            <table className="w-full text-small">
              <thead className="bg-bg border-b border-border">
                <tr>
                  <th className="th text-left px-4 py-3 w-32">Prefix</th>
                  <th className="th text-left px-3 py-3">คำอธิบาย</th>
                  <th className="th text-left px-3 py-3 w-32">ตัวอย่าง</th>
                  <th className="th text-right px-4 py-3 w-24">จัดการ</th>
                  <th className="th text-center px-3 py-3 w-28">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {noPatterns.length === 0 && (
                  <tr><td colSpan={5} className="text-center py-8 text-muted">ยังไม่มีรูปแบบ — กด "+ เพิ่มรูปแบบ" เพื่อเริ่ม</td></tr>
                )}
                {noPatterns.map(p => (
                  <tr key={p.id} className={`hover:bg-bg ${p.is_active === 0 ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-3 font-mono font-semibold text-primary">{p.prefix}</td>
                    <td className="px-3 py-3 text-muted">{p.description || '—'}</td>
                    <td className="px-3 py-3 font-mono text-[11px] text-muted">{p.prefix}-001</td>
                    <td className="px-4 py-3 text-right">
                      <button type="button"
                        onClick={() => { setEditingNoPattern(p); setNoPatternModal(true); }}
                        className="text-accent text-small hover:underline min-h-[36px] px-2">
                        แก้ไข
                      </button>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <div className="flex justify-center">
                        <ToggleSwitch
                          active={p.is_active !== 0}
                          onClick={() => toggleNoPattern.mutate({ id: p.id, is_active: p.is_active !== 0 ? 0 : 1 })}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── หัวข้อ KPI ── */}
      {section === 'titles' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-h3 font-semibold text-text">หัวข้อ KPI</h3>
            <Button type="button" onClick={() => { setEditingTitle(null); setTitleModal(true); }}>
              + เพิ่มหัวข้อ
            </Button>
          </div>
          <div className="card overflow-x-auto">
            <table className="w-full text-small">
              <thead className="bg-bg border-b border-border">
                <tr>
                  <th className="th text-left px-4 py-3">ชื่อหัวข้อ KPI</th>
                  <th className="th text-left px-3 py-3 w-36">กลุ่ม KPI</th>
                  <th className="th text-left px-3 py-3 w-28">หน่วย KPI</th>
                  <th className="th text-right px-4 py-3 w-24">จัดการ</th>
                  <th className="th text-center px-3 py-3 w-28">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {titleTemplates.length === 0 && (
                  <tr><td colSpan={5} className="text-center py-8 text-muted">ยังไม่มีหัวข้อ KPI — กด "+ เพิ่มหัวข้อ" เพื่อเริ่ม</td></tr>
                )}
                {titleTemplates.map(t => (
                  <tr key={t.id} className={`hover:bg-bg ${t.is_active === 0 ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-3 font-medium text-text">{t.name}</td>
                    <td className="px-3 py-3">
                      {t.group_name
                        ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200">{t.group_name}</span>
                        : <span className="text-muted text-[11px]">—</span>}
                    </td>
                    <td className="px-3 py-3">
                      {t.unit_name
                        ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-teal-100 dark:bg-teal-900 text-teal-700 dark:text-teal-200">{t.unit_name}</span>
                        : <span className="text-muted text-[11px]">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button type="button"
                        onClick={() => { setEditingTitle(t); setTitleModal(true); }}
                        className="text-accent text-small hover:underline min-h-[36px] px-2">
                        แก้ไข
                      </button>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <div className="flex justify-center">
                        <ToggleSwitch
                          active={t.is_active !== 0}
                          onClick={() => toggleTitleTemplate.mutate({ id: t.id, is_active: t.is_active !== 0 ? 0 : 1 })}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── หน่วย KPI ── */}
      {section === 'units' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-h3 font-semibold text-text">หน่วย KPI</h3>
              <p className="text-[11px] text-muted mt-0.5">ใช้เป็น dropdown บังคับเลือกในหน้าเพิ่มรายการ KPI</p>
            </div>
            <Button type="button" onClick={() => { setEditingUnit(null); setUnitModal(true); }}>
              + เพิ่มหน่วย
            </Button>
          </div>
          <div className="card overflow-x-auto">
            <table className="w-full text-small">
              <thead className="bg-bg border-b border-border">
                <tr>
                  <th className="th text-left px-4 py-3">ชื่อหน่วย</th>
                  <th className="th text-right px-4 py-3 w-24">จัดการ</th>
                  <th className="th text-center px-3 py-3 w-28">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {kpiUnits.length === 0 && (
                  <tr><td colSpan={3} className="text-center py-8 text-muted">ยังไม่มีหน่วย KPI — กด "+ เพิ่มหน่วย" เพื่อเริ่ม</td></tr>
                )}
                {kpiUnits.map(u => (
                  <tr key={u.id} className={`hover:bg-bg ${u.is_active === 0 ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-3 font-medium text-text">{u.name}</td>
                    <td className="px-4 py-3 text-right">
                      <button type="button"
                        onClick={() => { setEditingUnit(u); setUnitModal(true); }}
                        className="text-accent text-small hover:underline min-h-[36px] px-2">
                        แก้ไข
                      </button>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <div className="flex justify-center">
                        <ToggleSwitch
                          active={u.is_active !== 0}
                          onClick={() => toggleUnit.mutate({ id: u.id, is_active: u.is_active !== 0 ? 0 : 1 })}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── กลุ่ม KPI ── */}
      {section === 'groups' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-h3 font-semibold text-text">กลุ่ม KPI</h3>
            <Button
              type="button"
              onClick={() => { setEditingGroup(null); setGroupModal(true); }}
            >
              + เพิ่มกลุ่ม
            </Button>
          </div>
          <div className="card overflow-x-auto">
            <table className="w-full text-small">
              <thead className="bg-bg border-b border-border">
                <tr>
                  <th className="th text-left px-4 py-3">ชื่อกลุ่ม</th>
                  <th className="th text-right px-4 py-3 w-24">จัดการ</th>
                  <th className="th text-center px-3 py-3 w-28">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {groups.length === 0 && (
                  <tr>
                    <td colSpan={3} className="text-center py-8 text-muted">ยังไม่มีกลุ่ม KPI</td>
                  </tr>
                )}
                {groups.map(g => (
                  <tr key={g.id} className={`hover:bg-bg ${g.is_active === 0 ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-3 font-medium text-text">{g.name}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => { setEditingGroup(g); setGroupModal(true); }}
                        className="text-accent text-small hover:underline min-h-[36px] px-2"
                      >
                        แก้ไข
                      </button>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <div className="flex justify-center">
                        <ToggleSwitch
                          active={g.is_active !== 0}
                          onClick={() => toggleGroup.mutate({ id: g.id, is_active: g.is_active !== 0 ? 0 : 1 })}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── รายการ KPI ── */}
      {section === 'items' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <h3 className="text-h3 font-semibold text-text">รายการ KPI</h3>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200">
                {localItems.filter(i => i.is_active !== 0).length} รายการ
              </span>
            </div>
            <Button
              type="button"
              onClick={() => { setEditingItem(null); setItemModal(true); }}
            >
              + เพิ่ม KPI
            </Button>
          </div>

          <p className="text-[11px] text-muted mb-3">
            ลาก <span className="font-medium text-text">☰</span> เพื่อจัดลำดับ — ระบบบันทึกลำดับให้อัตโนมัติ
          </p>
          <div className="card overflow-x-auto">
            <table className="w-full text-small min-w-[760px]">
              <thead className="bg-bg border-b border-border">
                <tr>
                  <th className="th text-center px-2 py-3 w-8"></th>
                  <th className="th text-left px-4 py-3 w-24">KPI No.</th>
                  <th className="th text-left px-3 py-3">ชื่อ KPI</th>
                  <th className="th text-left px-3 py-3 w-28">กลุ่ม</th>
                  <th className="th text-center px-3 py-3 w-20">หน่วย</th>
                  <th className="th text-center px-3 py-3 w-28">เงื่อนไข</th>
                  <th className="th text-center px-3 py-3 w-24">เป้าหมาย</th>
                  <th className="th text-center px-3 py-3 w-32">ปีข้อมูล</th>
                  <th className="th text-center px-3 py-3 w-20">สรุปปี</th>
                  <th className="th text-center px-3 py-3 w-20">แหล่งข้อมูล</th>
                  <th className="th text-right px-4 py-3 w-24">จัดการ</th>
                  <th className="th text-center px-3 py-3 w-24">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {localItems.length === 0 && (
                  <tr>
                    <td colSpan={12} className="text-center py-8 text-muted">ยังไม่มีรายการ KPI</td>
                  </tr>
                )}
                {/* Expand items: แยก row ต่อปีถ้าเป้าหมายต่างกัน */}
                {(() => {
                  const expandedRows = [];
                  for (const item of localItems) {
                    const yt = item.year_targets;
                    const years = yt ? Object.keys(yt).sort((a, b) => Number(a) - Number(b)) : [];
                    if (years.length <= 1) {
                      expandedRows.push({ ...item, _displayYear: years[0] ? +years[0] : null, _displayTarget: years[0] != null ? yt[years[0]] : null, _allYears: null, _isFirstOfItem: true });
                    } else {
                      const uniqueTargets = [...new Set(years.map(y => yt[y]))];
                      if (uniqueTargets.length === 1) {
                        // เป้าเหมือนกันทุกปี → แสดงแถวเดียว
                        expandedRows.push({ ...item, _displayYear: null, _displayTarget: uniqueTargets[0], _allYears: years.map(Number), _isFirstOfItem: true });
                      } else {
                        // เป้าต่างกัน → แยกแถวต่อปี
                        years.forEach((year, idx) => {
                          expandedRows.push({ ...item, _displayYear: +year, _displayTarget: yt[year], _allYears: null, _isFirstOfItem: idx === 0 });
                        });
                      }
                    }
                  }
                  return expandedRows.map(row => {
                    const isSub = !row._isFirstOfItem;
                    return (
                      <tr key={`${row.id}-${row._displayYear ?? 'all'}`}
                        draggable={row._isFirstOfItem}
                        onDragStart={row._isFirstOfItem ? (e) => handleDragStart(e, row.id) : undefined}
                        onDragOver={row._isFirstOfItem ? (e) => handleDragOver(e, row.id) : undefined}
                        onDrop={row._isFirstOfItem ? () => handleDrop(row.id) : undefined}
                        onDragEnd={() => setDraggingId(null)}
                        className={`hover:bg-bg ${row.is_active === 0 ? 'opacity-60' : ''} ${isSub ? 'bg-blue-50/30 dark:bg-blue-900' : ''} ${draggingId === row.id ? 'opacity-40' : ''} ${row._isFirstOfItem ? 'cursor-default' : ''}`}>

                        {/* Drag handle */}
                        <td className="px-2 py-3 text-center text-muted/40">
                          {row._isFirstOfItem && (
                            <span className="cursor-grab select-none text-base leading-none" title="ลากเพื่อจัดลำดับ">☰</span>
                          )}
                        </td>

                        {/* KPI No. */}
                        <td className="px-4 py-3 font-mono text-muted text-[11px]">
                          {isSub
                            ? <span className="text-muted/40 pl-2 text-[13px]">└</span>
                            : row.kpi_no}
                        </td>

                        {/* ชื่อ KPI */}
                        <td className="px-3 py-3">
                          {row._isFirstOfItem && <div className="font-medium text-text">{row.name}</div>}
                          {row._isFirstOfItem && row.description && <div className="text-[11px] text-muted mt-0.5 line-clamp-1">{row.description}</div>}
                          {isSub && <div className="text-[11px] text-muted pl-3">{row.name}</div>}
                        </td>

                        {/* กลุ่ม */}
                        <td className="px-3 py-3 text-muted">{row._isFirstOfItem ? row.group_name : ''}</td>

                        {/* หน่วย */}
                        <td className="px-3 py-3 text-center text-muted">{row._isFirstOfItem ? (row.unit || '—') : ''}</td>

                        {/* เงื่อนไข */}
                        <td className="px-3 py-3 text-center">
                          {row._isFirstOfItem && (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                              row.target_direction === 'lte' ? 'bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-200' : 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200'
                            }`}>
                              {row.target_direction === 'lte' ? 'ไม่เกิน' : 'ไม่ต่ำกว่า'}
                            </span>
                          )}
                        </td>

                        {/* เป้าหมาย */}
                        <td className="px-3 py-3 text-center">
                          {row._displayTarget !== null && row._displayTarget !== undefined
                            ? <span className="font-bold text-warning">{row._displayTarget}</span>
                            : <span className="text-muted text-[11px]">—</span>}
                        </td>

                        {/* ปีข้อมูล */}
                        <td className="px-3 py-3 text-center">
                          {row._displayYear ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-primary/10 text-primary font-semibold">
                              {row._displayYear + 543}
                            </span>
                          ) : row._allYears ? (
                            <div className="flex flex-wrap gap-1 justify-center">
                              {row._allYears.map(y => (
                                <span key={y} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-200">
                                  {y + 543}
                                </span>
                              ))}
                            </div>
                          ) : <span className="text-muted text-[11px]">—</span>}
                        </td>

                        {/* สรุปปี */}
                        <td className="px-3 py-3 text-center">
                          {row._isFirstOfItem && (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                              (row.summary_type ?? 'average') === 'sum' ? 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-200' : 'bg-teal-100 dark:bg-teal-900 text-teal-700 dark:text-teal-200'
                            }`}>
                              {(row.summary_type ?? 'average') === 'sum' ? 'รวม' : 'เฉลี่ย'}
                            </span>
                          )}
                        </td>

                        {/* แหล่งข้อมูล */}
                        <td className="px-3 py-3 text-center">
                          {row._isFirstOfItem && (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                              row.data_source_type === 'manual' ? 'bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-200' : 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200'
                            }`}>
                              {row.data_source_type === 'manual' ? 'Manual' : 'DB'}
                            </span>
                          )}
                        </td>

                        {/* จัดการ */}
                        <td className="px-4 py-3 text-right">
                          <button type="button"
                            onClick={() => {
                              const yt = row.year_targets ?? {};
                              const allYrs = Object.keys(yt).map(Number).sort((a, b) => a - b);
                              const prefixFromNo = row.kpi_no?.split('-')[0] ?? 'KPI';
                              if (isSub && row._displayYear != null) {
                                // แก้เป้าปีเดียว
                                setEditingItem({ ...row, target_value: row._displayTarget ?? '', target_years_arr: [row._displayYear], kpi_no_prefix: prefixFromNo });
                              } else {
                                // แก้ไขทั้งหมด — pre-fill ปีทั้งหมดที่มีเป้า + target ล่าสุด
                                const latestYr = allYrs[allYrs.length - 1];
                                const preTgt = latestYr != null ? (yt[latestYr] ?? '') : '';
                                setEditingItem({ ...row, target_value: preTgt, target_years_arr: allYrs.length ? allYrs : [CY], kpi_no_prefix: prefixFromNo });
                              }
                              setItemModal(true);
                            }}
                            className={`text-small hover:underline min-h-[36px] px-2 ${isSub ? 'text-muted text-[11px]' : 'text-accent'}`}>
                            {isSub ? 'แก้เป้า' : 'แก้ไข'}
                          </button>
                        </td>

                        {/* สถานะ */}
                        <td className="px-3 py-3 text-center">
                          {row._isFirstOfItem && (
                            <div className="flex justify-center">
                              <ToggleSwitch
                                active={row.is_active !== 0}
                                onClick={() => toggleItem.mutate({ id: row.id, is_active: row.is_active !== 0 ? 0 : 1 })}
                              />
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>

          <TargetsSection />
        </div>
      )}

      {/* Title Template modal */}
      <Modal
        open={titleModal}
        onClose={() => { setTitleModal(false); setEditingTitle(null); }}
        title={editingTitle ? 'แก้ไขหัวข้อ KPI' : 'เพิ่มหัวข้อ KPI'}
      >
        <TitleTemplateForm
          initial={editingTitle || {}}
          groups={groups}
          kpiUnits={kpiUnits}
          onSave={body => saveTitleTemplate.mutate(editingTitle ? { ...body, id: editingTitle.id } : body)}
          loading={saveTitleTemplate.isPending}
          onClose={() => { setTitleModal(false); setEditingTitle(null); }}
        />
        {saveTitleTemplate.isError && (
          <p className="text-danger text-small mt-2">{saveTitleTemplate.error?.response?.data?.error}</p>
        )}
      </Modal>

      {/* Unit modal */}
      <Modal
        open={unitModal}
        onClose={() => { setUnitModal(false); setEditingUnit(null); }}
        title={editingUnit ? 'แก้ไขหน่วย KPI' : 'เพิ่มหน่วย KPI'}
      >
        <UnitForm
          initial={editingUnit || {}}
          onSave={body => saveUnit.mutate(editingUnit ? { ...body, id: editingUnit.id } : body)}
          loading={saveUnit.isPending}
          onClose={() => { setUnitModal(false); setEditingUnit(null); }}
        />
        {saveUnit.isError && (
          <p className="text-danger text-small mt-2">{saveUnit.error?.response?.data?.error}</p>
        )}
      </Modal>

      {/* No Pattern modal */}
      <Modal
        open={noPatternModal}
        onClose={() => { setNoPatternModal(false); setEditingNoPattern(null); }}
        title={editingNoPattern ? 'แก้ไขรูปแบบ KPI No.' : 'เพิ่มรูปแบบ KPI No.'}
      >
        <NoPatternForm
          initial={editingNoPattern || {}}
          onSave={body => saveNoPattern.mutate(editingNoPattern ? { ...body, id: editingNoPattern.id } : body)}
          loading={saveNoPattern.isPending}
          onClose={() => { setNoPatternModal(false); setEditingNoPattern(null); }}
        />
      </Modal>

      {/* Group modal */}
      <Modal
        open={groupModal}
        onClose={() => { setGroupModal(false); setEditingGroup(null); }}
        title={editingGroup ? 'แก้ไขกลุ่ม KPI' : 'เพิ่มกลุ่ม KPI'}
      >
        <GroupForm
          initial={editingGroup || {}}
          onSave={body => saveGroup.mutate(editingGroup ? { ...body, id: editingGroup.id } : body)}
          loading={saveGroup.isPending}
          onClose={() => { setGroupModal(false); setEditingGroup(null); }}
        />
      </Modal>

      {/* Item modal */}
      <Modal
        open={itemModal}
        onClose={() => { setItemModal(false); setEditingItem(null); }}
        title={editingItem ? 'แก้ไขรายการ KPI' : 'เพิ่มรายการ KPI'}
        size="lg"
      >
        <ItemForm
          initial={editingItem || {}}
          groups={groups}
          dbSources={dbSources}
          titleTemplates={titleTemplates.filter(t => t.is_active !== 0)}
          kpiUnits={kpiUnits.filter(u => u.is_active !== 0)}
          noPatterns={noPatterns.filter(p => p.is_active !== 0)}
          onSave={body => saveItem.mutate(editingItem ? { ...body, id: editingItem.id } : body)}
          loading={saveItem.isPending}
          onClose={() => { setItemModal(false); setEditingItem(null); }}
        />
      </Modal>
      {ToastPortal}
    </div>
  );
}

// ─── เป้าหมาย KPI Grid ───────────────────────────────────────────────────────
function TargetsSection() {
  const qc = useQueryClient();
  const [year, setYear] = useState(CY);

  const { data: itemsData } = useQuery({
    queryKey: ['kpi-items-active'],
    queryFn: () => api.get('/kpi/items').then(r => r.data),
  });
  const items = (itemsData?.data ?? itemsData ?? []).filter(i => i.is_active !== 0);

  const { data: targetsData, isLoading: loadingTargets } = useQuery({
    queryKey: ['kpi-targets', year],
    queryFn: () => api.get(`/kpi/targets?year=${year}`).then(r => r.data),
  });

  // แสดงเฉพาะ item ที่มีเป้าหมายในปีที่เลือก (หรือทุก item ถ้ายังโหลดอยู่)
  const itemsForYear = loadingTargets
    ? items
    : (() => {
        const withTarget = new Set((targetsData?.items ?? []).map(t => t.kpi_item_id));
        return items.filter(i => withTarget.has(i.id));
      })();

  const [targetValues, setTargetValues] = useState({});
  useEffect(() => {
    const map = {};
    (targetsData?.items ?? []).forEach(t => {
      map[t.kpi_item_id] = {};
      Object.entries(t.months ?? {}).forEach(([m, v]) => { map[t.kpi_item_id][+m] = v; });
    });
    setTargetValues(map);
  }, [targetsData]);

  const setVal = (itemId, month, val) =>
    setTargetValues(p => ({ ...p, [itemId]: { ...(p[itemId] ?? {}), [month]: val } }));

  const saveMutation = useMutation({
    mutationFn: (payload) => api.post('/kpi/targets', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kpi-targets', year] }),
  });

  function handleSave() {
    const entries = [];
    itemsForYear.forEach(item => {
      for (let m = 1; m <= 12; m++) {
        const val = targetValues[item.id]?.[m];
        if (val !== undefined && val !== '') {
          entries.push({ kpi_item_id: item.id, month: m, target_value: +val });
        }
      }
    });
    saveMutation.mutate({ year, entries });
  }

  return (
    <div className="mt-8 pt-6 border-t border-border">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h3 className="text-h3 font-semibold text-text">เป้าหมาย KPI รายเดือน</h3>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="label mb-0 whitespace-nowrap">ปี</label>
            <select className="input w-auto" value={year} onChange={e => setYear(+e.target.value)}>
              {yearRange().map(y => <option key={y} value={y}>{y + 543}</option>)}
            </select>
          </div>
          <Button loading={saveMutation.isPending} onClick={handleSave}>บันทึกเป้าหมาย</Button>
        </div>
      </div>
      {saveMutation.isSuccess && (
        <div className="mb-3 text-small text-success font-medium">บันทึกเป้าหมายสำเร็จ</div>
      )}
      {items.length === 0
          ? <div className="text-center py-8 text-muted text-small">ยังไม่มีรายการ KPI ที่ใช้งาน</div>
          : itemsForYear.length === 0
            ? <div className="text-center py-8 text-muted text-small">ไม่มีรายการ KPI ที่ตั้งเป้าหมายไว้สำหรับปี {year + 543}</div>
            : (
        <div className="overflow-x-auto card p-0">
          <table className="w-full min-w-[960px] text-small">
            <thead className="bg-bg border-b border-border">
              <tr>
                <th className="th text-left px-4 py-2.5 sticky left-0 bg-bg z-10 min-w-[180px]">รายการ KPI</th>
                {MONTH_SHORT.map((m, i) => (
                  <th key={i} className="th text-center px-1.5 py-2.5 w-16">{m}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {itemsForYear.map(item => (
                <tr key={item.id} className="hover:bg-bg/50">
                  <td className="px-4 py-2.5 sticky left-0 bg-surface hover:bg-bg z-10">
                    <div className="font-medium text-text text-[13px]">{item.name}</div>
                    <div className="text-[11px] text-muted">{item.unit}</div>
                  </td>
                  {MONTH_SHORT.map((_, idx) => {
                    const m = idx + 1;
                    return (
                      <td key={m} className="px-1 py-2 text-center">
                        <input
                          type="number"
                          step="any"
                          className="w-14 h-9 text-center border border-border rounded-md px-1 text-small focus:outline-none focus:ring-1 focus:ring-primary"
                          value={targetValues[item.id]?.[m] ?? ''}
                          onChange={e => setVal(item.id, m, e.target.value)}
                          placeholder="—"
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      {saveMutation.isSuccess && (
        <div className="mb-3 mt-2 text-small text-success font-medium">บันทึกเป้าหมายสำเร็จ</div>
      )}
    </div>
  );
}

function fmtThaiDate(isoStr) {
  if (!isoStr) return '&nbsp;';
  try {
    // SQLite datetime('now') ส่งกลับ UTC โดยไม่มี 'T' หรือ 'Z' — แปลงให้ถูกต้องก่อน parse
    const d = new Date(isoStr.includes('T') ? isoStr : isoStr.replace(' ', 'T') + 'Z');
    return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
  } catch { return isoStr; }
}

// ─── printActionPlan ──────────────────────────────────────────────────────────
function printActionPlan({ item, groupName, month, year, target, actual, actualRecord, actionPlan }) {
  const dirLabel = item.target_direction === 'lte' ? 'ไม่เกิน' : 'ไม่ต่ำกว่า';
  const printDate = new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
  const ap = actionPlan ?? {};
  const statusLabel = AP_STATUS[ap.status]?.label ?? '';
  const html = `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<title>Action Plan - ${item.kpi_no ?? ''}</title>
<style>
  @page { margin: 18mm 20mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Sarabun','IBM Plex Sans Thai',sans-serif; font-size: 13px; color: #1F2937; margin:0; }
  h1 { font-size: 17px; text-align: center; margin: 0 0 2px; font-weight: 700; }
  .sub { text-align: center; color: #6B7280; font-size: 11px; margin-bottom: 18px; }
  .sec { font-size: 13px; font-weight: 700; border-bottom: 2px solid #1A3A5C; padding-bottom: 3px; margin: 16px 0 8px; color: #1A3A5C; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  td, th { border: 1px solid #D1D5DB; padding: 7px 10px; vertical-align: top; }
  th { background: #F5F6F8; font-weight: 600; width: 28%; white-space: nowrap; }
  .red { color: #DC2626; font-weight: 700; }
  .sign td { border: none; text-align: center; padding: 32px 10px 2px; }
  .sign td span { display: block; border-top: 1px solid #374151; padding-top: 3px; font-size: 11px; color: #374151; }
  .note { font-size: 10px; color: #9CA3AF; text-align: right; margin-top: 10px; }
  .blank { color: #D1D5DB; }
</style>
</head>
<body>
  <h1>แบบฟอร์ม Action Plan KPI</h1>
  <div class="sub">ระบบบริหารคุณภาพ IQC</div>

  <div class="sec">1. ข้อมูล KPI</div>
  <table>
    <tr><th>KPI No.</th><td>${item.kpi_no ?? '—'}</td><th>กลุ่ม KPI</th><td>${groupName ?? '—'}</td></tr>
    <tr><th>ชื่อ KPI</th><td colspan="3">${item.name}</td></tr>
    <tr><th>ปี / เดือน</th><td>${year + 543} / ${MONTH_FULL[month - 1]}</td><th>หน่วย</th><td>${item.unit ?? '—'}</td></tr>
    <tr><th>เงื่อนไขผ่าน</th><td>${dirLabel}</td><th>เป้าหมาย</th><td>${target ?? '—'}</td></tr>
    <tr><th>ค่าจริง</th><td class="red">${actual ?? '—'}</td><th>ผล</th><td class="red">ไม่ผ่านเป้าหมาย</td></tr>
  </table>

  <div class="sec">2. การวิเคราะห์และแก้ไขปัญหา</div>
  <table>
    <tr>
      <th>สาเหตุที่ไม่ผ่าน</th>
      <td>${actualRecord?.fail_cause ? actualRecord.fail_cause.replace(/\n/g,'<br>') : '<span class="blank">—</span>'}</td>
    </tr>
    <tr>
      <th>วิธีการแก้ไข<br><small style="font-weight:400">(Corrective Action)</small></th>
      <td>${actualRecord?.corrective_action ? actualRecord.corrective_action.replace(/\n/g,'<br>') : '<span class="blank">—</span>'}</td>
    </tr>
    <tr>
      <th>วิธีการป้องกัน<br><small style="font-weight:400">(Preventive Action)</small></th>
      <td>${actualRecord?.preventive_action ? actualRecord.preventive_action.replace(/\n/g,'<br>') : '<span class="blank">—</span>'}</td>
    </tr>
    <tr><th>หมายเหตุ</th><td>${actualRecord?.remark ? actualRecord.remark.replace(/\n/g,'<br>') : ''}</td></tr>
  </table>

  <div class="sec">3. การลงนามอนุมัติ (Online)</div>
  <table>
    <thead><tr><th style="text-align:center">บทบาท</th><th style="text-align:center">ชื่อ</th><th style="text-align:center">วันที่ลงนาม</th><th style="text-align:center">สถานะ</th></tr></thead>
    <tbody>
      <tr>
        <td>Admin (ผู้จัดทำ)</td>
        <td>${ap.created_by_name ?? '—'}</td>
        <td style="font-size:11px">${fmtThaiDate(ap.submitted_at)}</td>
        <td style="color:${ap.submitted_at ? '#16A34A' : '#6B7280'}">${ap.submitted_at ? '✓ ส่งอนุมัติแล้ว' : 'ยังไม่ส่ง'}</td>
      </tr>
      <tr>
        <td>QC Manager</td>
        <td>${ap.qcm_signed_by_name ?? '—'}</td>
        <td style="font-size:11px">${fmtThaiDate(ap.qcm_signed_at)}</td>
        <td style="color:${ap.qcm_signed_at ? '#16A34A' : '#6B7280'}">${ap.qcm_signed_at ? '✓ อนุมัติแล้ว' : 'รอลงนาม'}</td>
      </tr>
      <tr>
        <td>CPO</td>
        <td>${ap.cpo_signed_by_name ?? '—'}</td>
        <td style="font-size:11px">${fmtThaiDate(ap.cpo_signed_at)}</td>
        <td style="color:${ap.cpo_signed_at ? '#16A34A' : '#6B7280'}">${ap.cpo_signed_at ? '✓ อนุมัติแล้ว' : 'รอลงนาม'}</td>
      </tr>
      <tr>
        <td>QMR</td>
        <td>${ap.qmr_signed_by_name ?? '—'}</td>
        <td style="font-size:11px">${fmtThaiDate(ap.qmr_signed_at)}</td>
        <td style="color:${ap.qmr_signed_at ? '#16A34A' : '#6B7280'}">${ap.qmr_signed_at ? '✓ อนุมัติแล้ว' : 'รอลงนาม'}</td>
      </tr>
    </tbody>
  </table>
  ${statusLabel ? `<div style="text-align:right;font-weight:700;color:${ap.status === 'approved' ? '#16A34A' : '#D97706'}">สถานะ: ${statusLabel}</div>` : ''}
  <div class="note">พิมพ์วันที่ ${printDate}</div>
</body>
</html>`;
  const w = window.open('', '_blank', 'width=900,height=720');
  if (!w) { alert('กรุณาอนุญาต popup ในเบราว์เซอร์เพื่อพิมพ์เอกสาร'); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 500);
}

// ─── ACTION PLAN MODAL (approval flow: Admin → QC Manager → CPO) ─────────────
function ActionPlanModal({ open, onClose, item, groupName, month, year, target, actual, actualRecord, actionPlan, refetchPlans }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { showToast, ToastPortal } = useToast();
  const [form, setForm] = useState({ fail_cause: '', corrective_action: '', preventive_action: '', remark: '' });
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  // localPlan: อัปเดตทันทีจาก server response โดยไม่รอ parent re-render
  const [localPlan, setLocalPlan] = useState(actionPlan ?? null);

  useEffect(() => {
    if (open) {
      setLocalPlan(actionPlan ?? null);
      setForm({
        fail_cause:        actionPlan?.fail_cause ?? actualRecord?.fail_cause ?? '',
        corrective_action: actionPlan?.corrective_action ?? actualRecord?.corrective_action ?? '',
        preventive_action: actionPlan?.preventive_action ?? actualRecord?.preventive_action ?? '',
        remark:            actionPlan?.remark ?? actualRecord?.remark ?? '',
      });
      setShowReject(false);
      setRejectReason('');
    }
  }, [open, actionPlan, actualRecord]);

  if (!item) return null;

  const ap      = localPlan;
  const role    = user?.role;
  const ps      = ap?.status ?? null;
  const canEdit = role === 'admin' && (!ps || ps === 'draft');
  const canQCM  = role === 'qc_manager' && ps === 'pending_qcm';
  const canCPO  = ['cpo','cmo'].includes(role) && ps === 'pending_cpo';
  const canQMR  = role === 'qmr' && ps === 'pending_qmr';
  const canSign = canQCM || canCPO || canQMR;
  const dirLabel = item.target_direction === 'lte' ? 'ไม่เกิน' : 'ไม่ต่ำกว่า';
  const isFailed = actual !== null && target !== null && checkFail(actual, target, item.target_direction);

  // อัปเดต cache ทันทีจาก server response — ตารางเปลี่ยนโดยไม่รอ refetch
  const patchCache = (updatedPlan) => {
    const key = ['kpi-action-plans', year, month];
    const cached = qc.getQueryData(key);
    if (cached?.data) {
      const list = cached.data;
      const exists = list.some(p => p.id === updatedPlan.id);
      const newList = exists
        ? list.map(p => p.id === updatedPlan.id ? updatedPlan : p)
        : [...list, updatedPlan];
      qc.setQueryData(key, { ...cached, data: newList });
    }
    // background sync ครั้งเดียว เฉพาะ key นี้
    qc.invalidateQueries({ queryKey: key, exact: true });
  };

  const saveMut = useMutation({
    mutationFn: () => api.post('/kpi/action-plans', { kpi_item_id: item.id, year, month, ...form }).then(r => r.data),
    onSuccess: (data) => { setLocalPlan(data); patchCache(data); showToast('บันทึกแบบร่างสำเร็จ'); },
    onError: (e) => showToast(e?.response?.data?.error || 'บันทึกไม่สำเร็จ', 'error'),
  });
  const submitMut = useMutation({
    mutationFn: async () => {
      const res = await api.post('/kpi/action-plans', { kpi_item_id: item.id, year, month, ...form });
      return api.post(`/kpi/action-plans/${res.data.id}/submit`).then(r => r.data);
    },
    onSuccess: (data) => { setLocalPlan(data); patchCache(data); showToast('ส่งอนุมัติสำเร็จ — รอ QC Manager ตรวจสอบ'); setTimeout(onClose, 1500); },
    onError: (e) => showToast(e?.response?.data?.error || 'ส่งอนุมัติไม่สำเร็จ', 'error'),
  });
  const approveMut = useMutation({
    mutationFn: () => api.post(`/kpi/action-plans/${ap.id}/approve`).then(r => r.data),
    onSuccess: (data) => { setLocalPlan(data); patchCache(data); showToast('อนุมัติสำเร็จ'); setTimeout(onClose, 1200); },
    onError: (e) => showToast(e?.response?.data?.error || 'อนุมัติไม่สำเร็จ', 'error'),
  });
  const rejectMut = useMutation({
    mutationFn: () => api.post(`/kpi/action-plans/${ap.id}/reject`, { reason: rejectReason }).then(r => r.data),
    onSuccess: (data) => { setLocalPlan(data); patchCache(data); setShowReject(false); setRejectReason(''); showToast('ส่งกลับแก้ไขสำเร็จ'); },
    onError: (e) => showToast(e?.response?.data?.error || 'ดำเนินการไม่สำเร็จ', 'error'),
  });

  const busy = saveMut.isPending || submitMut.isPending || approveMut.isPending || rejectMut.isPending;
  const errMsg = (saveMut.error || submitMut.error || approveMut.error || rejectMut.error)?.response?.data?.error;

  const steps = [
    { label: 'Admin', sub: ap?.submitted_at ? 'ส่งอนุมัติแล้ว' : ps ? 'ส่งอนุมัติแล้ว' : 'ยังไม่ส่ง', done: !!ap?.submitted_at || !!ps, who: ap?.created_by_name, at: ap?.submitted_at },
    { label: 'QC Manager', sub: ap?.qcm_signed_at ? 'อนุมัติแล้ว' : ps === 'pending_qcm' ? 'กำลังรอ' : '—', done: !!ap?.qcm_signed_at, active: ps === 'pending_qcm', who: ap?.qcm_signed_by_name, at: ap?.qcm_signed_at },
    { label: 'CPO', sub: ap?.cpo_signed_at ? 'อนุมัติแล้ว' : ps === 'pending_cpo' ? 'กำลังรอ' : '—', done: !!ap?.cpo_signed_at, active: ps === 'pending_cpo', who: ap?.cpo_signed_by_name, at: ap?.cpo_signed_at },
    { label: 'QMR', sub: ap?.qmr_signed_at ? 'อนุมัติแล้ว' : ps === 'pending_qmr' ? 'กำลังรอ' : '—', done: !!ap?.qmr_signed_at, active: ps === 'pending_qmr', who: ap?.qmr_signed_by_name, at: ap?.qmr_signed_at },
  ];

  return (
    <>
    <Modal open={open} onClose={onClose} title={`Action Plan — ${item.kpi_no ?? item.name}`} size="lg">
      {/* KPI Info */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-small mb-3">
        <div><span className="text-muted">KPI No.: </span><span className="font-mono">{item.kpi_no}</span></div>
        <div><span className="text-muted">กลุ่ม: </span>{groupName}</div>
        <div className="col-span-2"><span className="text-muted">ชื่อ KPI: </span><strong>{item.name}</strong></div>
        <div><span className="text-muted">ปี/เดือน: </span>{year + 543} / {MONTH_FULL[month - 1]}</div>
        <div><span className="text-muted">หน่วย: </span>{item.unit ?? '—'}</div>
        <div><span className="text-muted">เงื่อนไข: </span>{dirLabel}</div>
        <div><span className="text-muted">เป้าหมาย: </span><strong>{target ?? '—'}</strong></div>
      </div>

      {/* ผลจริง + status badge */}
      <div className={`rounded-lg px-4 py-2.5 mb-3 flex items-center gap-3 ${isFailed ? 'bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700' : 'bg-green-50 dark:bg-green-900 border border-green-200 dark:border-green-700'}`}>
        <span className={`font-semibold text-small ${isFailed ? 'text-danger' : 'text-success'}`}>{isFailed ? 'ไม่ผ่านเป้าหมาย' : 'ผ่านเป้าหมาย'}</span>
        <span className="text-muted text-small">ค่าจริง:</span>
        <span className={`text-h3 font-bold ${isFailed ? 'text-danger' : 'text-success'}`}>{actual ?? '—'}</span>
        {item.unit && <span className="text-muted text-small">{item.unit}</span>}
        {ap && (
          <span className={`ml-auto inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${AP_STATUS[ps]?.cls}`}>
            {AP_STATUS[ps]?.label}
          </span>
        )}
      </div>

      {/* Reject reason */}
      {ap?.reject_reason && (
        <div className="bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded-lg px-3 py-2 mb-3">
          <div className="text-[11px] font-semibold text-danger mb-0.5">ส่งกลับแก้ไข (ครั้งที่ {ap.revision})</div>
          {ap.rejected_by_name && (
            <div className="text-[11px] text-muted mb-1">
              โดย <span className="font-semibold text-text">{ap.rejected_by_name}</span>
              {ap.rejected_at && <span> · {fmtThaiDate(ap.rejected_at)}</span>}
            </div>
          )}
          <div className="text-small text-text">{ap.reject_reason}</div>
        </div>
      )}

      {/* Content */}
      {canEdit ? (
        <div className="space-y-2.5 mb-3">
          {[
            { key: 'fail_cause', label: 'สาเหตุที่ไม่ผ่าน *' },
            { key: 'corrective_action', label: 'วิธีการแก้ไข (Corrective Action) *' },
            { key: 'preventive_action', label: 'วิธีการป้องกัน (Preventive Action) *' },
            { key: 'remark', label: 'หมายเหตุ' },
          ].map(({ key, label }) => (
            <div key={key}>
              <label className="text-small font-semibold text-text mb-1 block">{label}</label>
              <textarea className="input w-full min-h-[60px] resize-y text-small" value={form[key]}
                onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} placeholder="—" disabled={busy} />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2.5 mb-3">
          {[
            { key: 'fail_cause', label: 'สาเหตุที่ไม่ผ่าน' },
            { key: 'corrective_action', label: 'วิธีการแก้ไข (Corrective Action)' },
            { key: 'preventive_action', label: 'วิธีการป้องกัน (Preventive Action)' },
            { key: 'remark', label: 'หมายเหตุ' },
          ].map(({ key, label }) => {
            const val = ap?.[key] ?? actualRecord?.[key];
            if (key === 'remark' && !val) return null;
            return (
              <div key={key}>
                <div className="text-small font-semibold text-text mb-1">{label}</div>
                <div className="rounded-md border border-border bg-bg px-3 py-2 text-small text-text min-h-[44px] whitespace-pre-wrap">
                  {val || <span className="text-muted">— ยังไม่ได้บันทึก —</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Approval Timeline */}
      <div className="mb-3 py-3 border-t border-border">
        <div className="text-[11px] font-semibold text-muted mb-2">Timeline การดำเนินการ</div>
        <div className="flex items-stretch gap-1.5">
          {steps.map((step, i) => (
            <React.Fragment key={i}>
              <div className={`flex-1 text-center p-2 rounded-lg text-[11px] ${step.done ? 'bg-green-50 dark:bg-green-900 border border-green-200 dark:border-green-700' : step.active ? 'bg-amber-50 dark:bg-amber-900 border border-amber-200 dark:border-amber-700' : 'bg-bg border border-border'}`}>
                <div className={`font-bold ${step.done ? 'text-success' : step.active ? 'text-warning' : 'text-muted'}`}>
                  {step.done ? '✓ ' : step.active ? '● ' : ''}{step.label}
                </div>
                <div className={`mt-0.5 ${step.active ? 'text-warning font-medium' : 'text-muted'}`}>{step.sub}</div>
                {step.who && <div className="text-muted mt-0.5 truncate text-[10px]">{step.who}</div>}
                {step.at && <div className="text-[10px] text-muted mt-0.5">{fmtThaiDate(step.at)}</div>}
              </div>
              {i < steps.length - 1 && <div className="self-center text-muted text-small flex-shrink-0">›</div>}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Reject form */}
      {showReject && (
        <div className="bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded-lg p-3 mb-3">
          <label className="text-small font-semibold text-danger mb-1 block">เหตุผลที่ส่งกลับแก้ไข *</label>
          <textarea className="input w-full min-h-[56px] resize-y text-small" value={rejectReason}
            onChange={e => setRejectReason(e.target.value)} placeholder="ระบุเหตุผล..." disabled={rejectMut.isPending} autoFocus />
          <div className="flex gap-2 mt-2">
            <Button variant="secondary" type="button" onClick={() => setShowReject(false)} disabled={rejectMut.isPending}>ยกเลิก</Button>
            <button type="button" disabled={!rejectReason.trim() || rejectMut.isPending}
              onClick={() => rejectMut.mutate()}
              className="btn disabled:opacity-50" style={{ background:'#DC2626', color:'#fff' }}>
              {rejectMut.isPending ? 'กำลังส่ง...' : 'ยืนยันส่งกลับ'}
            </button>
          </div>
        </div>
      )}

      {errMsg && <div className="text-small text-danger bg-red-50 dark:bg-red-900 rounded px-3 py-2 mb-3">{errMsg}</div>}

      {/* Footer */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-border">
        <div className="flex flex-wrap gap-2">
          {canEdit && <>
            <Button variant="secondary" type="button" disabled={busy} onClick={() => saveMut.mutate()}>
              {saveMut.isPending ? '...' : 'บันทึกแบบร่าง'}
            </Button>
            <button type="button" disabled={busy || !form.fail_cause.trim()}
              onClick={() => submitMut.mutate()}
              className="btn btn-primary disabled:opacity-50">
              {submitMut.isPending ? 'กำลังส่ง...' : 'ส่งอนุมัติ →'}
            </button>
          </>}
          {canSign && !showReject && <>
            <button type="button" disabled={busy} onClick={() => approveMut.mutate()}
              className="btn disabled:opacity-50" style={{ background:'#16A34A', color:'#fff' }}>
              {approveMut.isPending ? '...' : '✓ อนุมัติ (ลงชื่อ online)'}
            </button>
            <button type="button" disabled={busy} onClick={() => setShowReject(true)}
              className="btn disabled:opacity-50" style={{ background:'#DC2626', color:'#fff' }}>
              ✕ ส่งกลับแก้ไข
            </button>
          </>}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" type="button" onClick={onClose}>ปิด</Button>
          {ps === 'approved' && ap?.id && (
            <button
              onClick={() => downloadFile(`/kpi/action-plans/${ap.id}/pdf`, {}, `action_plan_${ap.id}.pdf`)}
              className="btn btn-primary flex items-center gap-1.5"
              title="Export PDF (มีหัวกระดาษบริษัทจาก Settings)">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Export PDF
            </button>
          )}
        </div>
      </div>
    </Modal>
    {ToastPortal}
    </>
  );
}

// ─── SUMMARY TAB ─────────────────────────────────────────────────────────────
function SummaryTab({ autoApId = null, autoYear = null, autoMonth = null }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [year, setYear]   = useState(autoYear || CY);
  const [month, setMonth] = useState(autoMonth || new Date().getMonth() + 1);
  const [apModal, setApModal] = useState(null);
  const autoUrlConsumedRef = useRef(false);

  const { data: itemsData } = useQuery({ queryKey: ['kpi-items-active'], queryFn: () => api.get('/kpi/items?limit=200').then(r => r.data) });
  const items = (itemsData?.data ?? itemsData ?? []).filter(i => i.is_active !== 0);

  const { data: targetsData } = useQuery({ queryKey: ['kpi-targets', year], queryFn: () => api.get(`/kpi/targets?year=${year}`).then(r => r.data) });
  const targetItems = targetsData?.items ?? [];

  const { data: actualsData, isLoading } = useQuery({ queryKey: ['kpi-actuals-month', year, month], queryFn: () => api.get(`/kpi/actuals?year=${year}&month=${month}`).then(r => r.data) });
  const actualRecords = actualsData?.data ?? [];

  const { data: plansData, refetch: refetchPlans } = useQuery({
    queryKey: ['kpi-action-plans', year, month],
    queryFn: () => api.get(`/kpi/action-plans?year=${year}&month=${month}`).then(r => r.data),
  });
  const actionPlans = plansData?.data ?? [];

  const rows = items.map(item => {
    const tItem  = targetItems.find(t => t.kpi_item_id === item.id);
    const target = tItem?.months?.[month] ?? null;
    const ar     = actualRecords.find(a => a.kpi_item_id === item.id) ?? null;
    const actual = ar?.actual_value ?? null;
    const failed = actual !== null && target !== null && checkFail(actual, target, item.target_direction);
    const ap     = actionPlans.find(p => p.kpi_item_id === item.id) ?? null;
    return { item, groupName: item.group_name ?? tItem?.group_name ?? '—', target, ar, actual, failed, ap };
  });

  const failCount   = rows.filter(r => r.failed).length;
  const passCount   = rows.filter(r => !r.failed && r.actual !== null).length;
  const noDataCount = rows.filter(r => r.actual === null).length;
  const isAdmin     = user?.role === 'admin';

  // auto-open modal จาก URL param ap_id
  useEffect(() => {
    if (!autoApId) {
      // URL ถูกล้างแล้ว (หลัง replaceState) — reset เพื่อให้คลิก notification ครั้งถัดไปทำงานได้
      autoUrlConsumedRef.current = false;
      return;
    }
    if (autoUrlConsumedRef.current) return;
    if (!plansData || rows.length === 0) return;
    const plan = actionPlans.find(p => p.id === autoApId);
    if (!plan) return;
    const row = rows.find(r => r.item.id === plan.kpi_item_id);
    if (!row) return;
    setApModal({ item: row.item, groupName: row.groupName, target: row.target, actual: row.actual, ar: row.ar, ap: plan });
    autoUrlConsumedRef.current = true;
    // ล้าง URL — React Router จะ re-render KPIPage ด้วย autoApId=null → reset ref ในรอบถัดไป
    window.history.replaceState({}, '', window.location.pathname);
  }, [autoApId, plansData, rows, actionPlans]);

  return (
    <div>
      {/* Filter bar */}
      <div className="card mb-5 flex flex-wrap items-center gap-4">
        <YearPicker tag="ปี" value={year} onChange={v => setYear(v || CY)} />
        <div className="flex items-center gap-2">
          <span className="text-small text-muted">เดือน:</span>
          <select className="input w-auto" value={month} onChange={e => setMonth(+e.target.value)}>
            {MONTH_FULL.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-4 ml-auto text-small">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-danger" /><span className="text-danger font-semibold">{failCount}</span><span className="text-muted">ไม่ผ่าน</span></span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-success" /><span className="text-success font-semibold">{passCount}</span><span className="text-muted">ผ่าน</span></span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-border" /><span className="text-muted font-semibold">{noDataCount}</span><span className="text-muted">ยังไม่บันทึก</span></span>
        </div>
      </div>

      {isLoading && <div className="text-center py-16 text-muted text-small">กำลังโหลด...</div>}

      {!isLoading && (
        <div className="card overflow-x-auto">
          <table className="w-full text-small min-w-[760px]">
            <thead className="bg-bg border-b border-border">
              <tr>
                <th className="th text-left px-4 py-3 w-28">KPI No.</th>
                <th className="th text-left px-3 py-3">ชื่อ KPI</th>
                <th className="th text-left px-3 py-3 w-28">กลุ่ม</th>
                <th className="th text-center px-3 py-3 w-20">หน่วย</th>
                <th className="th text-center px-3 py-3 w-22">เงื่อนไข</th>
                <th className="th text-center px-3 py-3 w-20">เป้า</th>
                <th className="th text-center px-3 py-3 w-20">จริง</th>
                <th className="th text-center px-3 py-3 w-24">สถานะ</th>
                <th className="th text-center px-3 py-3 w-36">Action Plan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.length === 0 && <tr><td colSpan={9} className="text-center py-10 text-muted">ยังไม่มีรายการ KPI</td></tr>}
              {rows.map(({ item, groupName, target, ar, actual, failed, ap }) => (
                <tr key={item.id} className={`hover:bg-bg ${failed ? 'bg-red-50 dark:bg-red-900' : ''}`}>
                  <td className="px-4 py-3 font-mono text-[11px] text-muted">{item.kpi_no}</td>
                  <td className="px-3 py-3">
                    <div className="font-medium text-text">{item.name}</div>
                    {item.description && <div className="text-[11px] text-muted line-clamp-1">{item.description}</div>}
                  </td>
                  <td className="px-3 py-3 text-muted text-[12px]">{groupName}</td>
                  <td className="px-3 py-3 text-center text-muted">{item.unit || '—'}</td>
                  <td className="px-3 py-3 text-center">
                    <span className={`text-[11px] font-medium ${item.target_direction === 'lte' ? 'text-orange-600 dark:text-orange-200' : 'text-blue-600 dark:text-blue-200'}`}>
                      {item.target_direction === 'lte' ? 'ไม่เกิน' : 'ไม่ต่ำกว่า'}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center font-medium text-[13px]">{target ?? <span className="text-muted">—</span>}</td>
                  <td className={`px-3 py-3 text-center font-bold text-[13px] ${failed ? 'text-danger' : actual !== null ? 'text-success' : 'text-muted'}`}>{actual ?? '—'}</td>
                  <td className="px-3 py-3 text-center">
                    {actual === null
                      ? <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] bg-gray-100 dark:bg-gray-900 text-gray-500 dark:text-gray-200">ยังไม่บันทึก</span>
                      : failed
                        ? <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 dark:bg-red-900 text-danger">ไม่ผ่าน</span>
                        : <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 dark:bg-green-900 text-success">ผ่าน</span>
                    }
                  </td>
                  <td className="px-3 py-3 text-center">
                    {(failed || ap) ? (
                      <button type="button"
                        onClick={() => setApModal({ item, groupName, target, actual, ar, ap })}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors min-h-[30px] ${
                          ap ? `${AP_STATUS[ap.status]?.cls} border` : 'bg-primary text-white hover:bg-accent'
                        }`}>
                        {ap ? AP_STATUS[ap.status]?.label : '+ สร้าง Action Plan'}
                      </button>
                    ) : <span className="text-muted text-[11px]">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {apModal && (
        <ActionPlanModal
          open={true}
          onClose={() => setApModal(null)}
          item={apModal.item}
          groupName={apModal.groupName}
          month={month}
          year={year}
          target={apModal.target}
          actual={apModal.actual}
          actualRecord={apModal.ar}
          actionPlan={apModal.ap}
          refetchPlans={refetchPlans}
        />
      )}
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function KPIPage() {
  const { user } = useAuth();
  const location = useLocation();
  const isAdmin = user?.role === 'admin';
  const canEdit = ['admin', 'qc_manager'].includes(user?.role);

  // tab จาก pathname: /kpi/dashboard → 'dashboard'
  const pathTab = location.pathname.split('/').pop();
  const activeTab = ['dashboard','summary','bantuk','setup'].includes(pathTab) ? pathTab : 'dashboard';

  const _urlParams = new URLSearchParams(location.search);
  const autoApId    = _urlParams.get('ap_id')  ? +_urlParams.get('ap_id')  : null;
  const autoApYear  = _urlParams.get('year')   ? +_urlParams.get('year')   : null;
  const autoApMonth = _urlParams.get('month')  ? +_urlParams.get('month')  : null;

  const TAB_TITLES = { dashboard: 'Dashboard', summary: 'สรุป KPI', bantuk: 'บันทึก KPI', setup: 'Setup' };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">KPI — {TAB_TITLES[activeTab]}</h1>
      </div>

      <div>
        {activeTab === 'dashboard' && <DashboardTab />}
        {activeTab === 'summary'   && <SummaryTab autoApId={autoApId} autoYear={autoApYear} autoMonth={autoApMonth} />}
        {activeTab === 'bantuk'    && <BantukTab canEdit={canEdit} />}
        {activeTab === 'setup'     && isAdmin && <SetupTab />}
      </div>
    </div>
  );
}
