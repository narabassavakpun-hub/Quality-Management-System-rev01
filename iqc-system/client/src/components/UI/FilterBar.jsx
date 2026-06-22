import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../utils/api';
import MultiSelect from './MultiSelect';
import Button from './Button';

const DATE_PRESETS = [
  { label: 'วันนี้', value: 'today' },
  { label: '7 วัน', value: '7d' },
  { label: '30 วัน', value: '30d' },
  { label: 'เดือนนี้', value: 'month' },
  { label: 'ปีนี้', value: 'year' },
  { label: 'กำหนดเอง', value: 'custom' },
];

function getDateRange(preset) {
  const today = new Date();
  const fmt = (d) => d.toISOString().slice(0, 10);
  if (preset === 'today') return { from: fmt(today), to: fmt(today) };
  if (preset === '7d') { const d = new Date(today); d.setDate(d.getDate() - 6); return { from: fmt(d), to: fmt(today) }; }
  if (preset === '30d') { const d = new Date(today); d.setDate(d.getDate() - 29); return { from: fmt(d), to: fmt(today) }; }
  if (preset === 'month') { const d = new Date(today.getFullYear(), today.getMonth(), 1); return { from: fmt(d), to: fmt(today) }; }
  if (preset === 'year') { return { from: `${today.getFullYear()}-01-01`, to: fmt(today) }; }
  return { from: '', to: '' };
}

const DEFAULT_FILTERS = { preset: '30d', from: '', to: '', suppliers: [], groups: [], status: [] };

export default function FilterBar({ storageKey = 'filter', statusOptions = [], onFilter }) {
  const sessionKey = `iqc_filter_${storageKey}`;
  const [filters, setFilters] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(sessionKey)) || DEFAULT_FILTERS; } catch { return DEFAULT_FILTERS; }
  });

  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get('/master/suppliers').then(r => r.data) });
  const { data: groups = [] } = useQuery({ queryKey: ['product-groups'], queryFn: () => api.get('/master/product-groups').then(r => r.data) });

  useEffect(() => { sessionStorage.setItem(sessionKey, JSON.stringify(filters)); }, [filters, sessionKey]);
  useEffect(() => { applyFilter(filters); }, []);

  function update(key, val) {
    const next = { ...filters, [key]: val };
    if (key === 'preset' && val !== 'custom') {
      const range = getDateRange(val);
      next.from = range.from;
      next.to = range.to;
    }
    setFilters(next);
  }

  function applyFilter(f = filters) {
    const range = f.preset !== 'custom' ? getDateRange(f.preset) : { from: f.from, to: f.to };
    onFilter({ ...f, from: range.from, to: range.to });
  }

  function reset() {
    setFilters(DEFAULT_FILTERS);
    applyFilter(DEFAULT_FILTERS);
  }

  const isDefault = JSON.stringify(filters) === JSON.stringify(DEFAULT_FILTERS);

  return (
    <div className="card mb-4 sticky top-0 z-20">
      <div className="flex flex-wrap gap-2 items-end">
        <div>
          <label className="label">ช่วงวันที่</label>
          <div className="flex gap-1 flex-wrap">
            {DATE_PRESETS.map(p => (
              <button
                key={p.value}
                type="button"
                onClick={() => update('preset', p.value)}
                className={`px-2 py-1 text-small rounded border min-h-[36px] ${filters.preset === p.value ? 'bg-primary text-white border-primary' : 'bg-surface text-text border-border hover:bg-bg'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {filters.preset === 'custom' && (
            <div className="flex gap-2 mt-1">
              <input type="date" value={filters.from} onChange={e => update('from', e.target.value)} className="input py-1 min-h-[36px]" />
              <span className="self-center text-muted">—</span>
              <input type="date" value={filters.to} onChange={e => update('to', e.target.value)} className="input py-1 min-h-[36px]" />
            </div>
          )}
        </div>

        <div className="min-w-[180px]">
          <label className="label">Supplier</label>
          <MultiSelect
            options={suppliers.map(s => ({ value: String(s.id), label: s.name }))}
            value={filters.suppliers}
            onChange={v => update('suppliers', v)}
            placeholder="ทุก Supplier"
          />
        </div>

        <div className="min-w-[180px]">
          <label className="label">กลุ่มสินค้า</label>
          <MultiSelect
            options={groups.map(g => ({ value: String(g.id), label: g.name }))}
            value={filters.groups}
            onChange={v => update('groups', v)}
            placeholder="ทุกกลุ่ม"
          />
        </div>

        {statusOptions.length > 0 && (
          <div className="min-w-[160px]">
            <label className="label">สถานะ</label>
            <MultiSelect
              options={statusOptions}
              value={filters.status}
              onChange={v => update('status', v)}
              placeholder="ทุกสถานะ"
            />
          </div>
        )}

        <div className="flex gap-2 pb-0.5">
          <Button onClick={() => applyFilter()}>แสดงข้อมูล</Button>
          {!isDefault && <Button variant="secondary" onClick={reset}>ล้าง Filter</Button>}
        </div>
      </div>
    </div>
  );
}
