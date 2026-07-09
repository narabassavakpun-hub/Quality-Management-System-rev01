import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../utils/api';
import CrudPanel from '../../components/UI/CrudPanel';
import Modal from '../../components/UI/Modal';
import Button from '../../components/UI/Button';

const M_BASE = '/ipqc/master';

// Modal to assign/unassign production_manager users to a line
function ManagersModal({ line, onClose }) {
  const qc = useQueryClient();
  const [sel, setSel] = useState('');
  const { data: detail } = useQuery({
    queryKey: ['pm-line-detail', line.id],
    queryFn: () => api.get(`${M_BASE}/production-lines/${line.id}`).then(r => r.data),
  });
  const { data: usersRes } = useQuery({
    queryKey: ['pm-manager-users'],
    queryFn: () => api.get(`${M_BASE}/manager-users`).then(r => r.data),
  });
  const managers = detail?.managers || [];
  const users = usersRes?.data || [];
  const available = users.filter(u => !managers.some(m => m.user_id === u.id));

  const refresh = () => { qc.invalidateQueries({ queryKey: ['pm-line-detail', line.id] }); qc.invalidateQueries({ queryKey: ['pm-lines-list'] }); };
  const add = useMutation({ mutationFn: (user_id) => api.post(`${M_BASE}/production-lines/${line.id}/managers`, { user_id }), onSuccess: () => { setSel(''); refresh(); } });
  const remove = useMutation({ mutationFn: (uid) => api.delete(`${M_BASE}/production-lines/${line.id}/managers/${uid}`), onSuccess: refresh });

  return (
    <Modal open onClose={onClose} title={`ผู้รับผิดชอบ — ${line.name}`}>
      <div className="space-y-3">
        <div className="flex gap-2">
          <select className="input" value={sel} onChange={e => setSel(e.target.value)}>
            <option value="">— เลือกผู้รับผิดชอบ (production_manager) —</option>
            {available.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
          <Button disabled={!sel || add.isPending} onClick={() => add.mutate(+sel)}>เพิ่ม</Button>
        </div>
        {add.error && <div className="text-danger text-small">{add.error.response?.data?.error}</div>}
        <div className="divide-y border border-border rounded">
          {managers.length === 0 && <div className="p-3 text-small text-muted">ยังไม่มีผู้รับผิดชอบ</div>}
          {managers.map(m => (
            <div key={m.user_id} className="flex items-center justify-between p-2">
              <span className="text-body">{m.full_name}</span>
              <button className="text-danger text-small" onClick={() => remove.mutate(m.user_id)}>ลบ</button>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

const TABS = [
  ['lines', 'สายผลิต'],
  ['process', 'กระบวนการ'],
  ['defects', 'ประเภทของเสีย'],
  ['fm', 'FM Category'],
  ['shifts', 'กะการผลิต'],
  ['thresholds', 'เกณฑ์ของเสีย'],
  ['ipqc-stations', 'IPQC Stations'],
  ['check-templates', 'Check Templates'],
  ['check-items', 'Check Items'],
];

const M = '/ipqc/master';

export default function ProductionMaster() {
  const qc = useQueryClient();
  const [tab, setTab] = useState('lines');
  const [managingLine, setManagingLine] = useState(null);

  const { data: linesRes } = useQuery({ queryKey: ['pm-lines'], queryFn: () => api.get(`${M}/production-lines?active=1&limit=200`).then(r => r.data) });
  const { data: lineTypesRes } = useQuery({ queryKey: ['pm-line-types'], queryFn: () => api.get(`${M}/line-types?active=1&limit=200`).then(r => r.data) });
  const { data: factoriesRes } = useQuery({ queryKey: ['pm-factories'], queryFn: () => api.get(`${M}/factories?active=1&limit=200`).then(r => r.data) });
  const { data: fmRes } = useQuery({ queryKey: ['pm-fm'], queryFn: () => api.get(`${M}/fm-categories?active=1`).then(r => r.data) });
  const { data: ipqcStRes } = useQuery({ queryKey: ['pm-ipqc-stations-list'], queryFn: () => api.get(`${M}/ipqc-stations`).then(r => r.data) });
  const { data: checkTmplRes } = useQuery({ queryKey: ['pm-check-templates-list'], queryFn: () => api.get(`${M}/check-templates?limit=200`).then(r => r.data) });
  const { data: specOpts = {} } = useQuery({
    queryKey: ['pm-spec-options'],
    queryFn: () => api.get(`${M}/spec-options`).then(r => r.data),
    staleTime: 5 * 60 * 1000,
  });
  const lineOptions = (linesRes?.data ?? []).map(l => ({ value: l.id, label: `${l.name} (${l.factory})` }));
  const lineTypeList = lineTypesRes?.data ?? [];
  const factoryList = factoriesRes?.data ?? [];
  const lineTypeOptions = lineTypeList.map(t => ({ value: t.code, label: t.name }));
  const factoryOptions = factoryList.map(f => ({ value: f.name, label: f.name }));
  const factoryByName = Object.fromEntries(factoryList.map(f => [f.name, f]));

  const addLineType = {
    title: 'เพิ่มประเภทสายใหม่',
    inputs: [{ label: 'ชื่อประเภทสาย', placeholder: 'เช่น WOOD' }],
    onAdd: async ([label]) => {
      const text = (label || '').trim();
      if (!text) return null;
      const code = text.toLowerCase().replace(/\s+/g, '_');
      await api.post(`${M}/line-types`, { code, name: text });
      qc.invalidateQueries({ queryKey: ['pm-line-types'] });
      return code;
    },
  };
  const addFactory = {
    title: 'เพิ่มโรงงานใหม่',
    inputs: [{ label: 'ชื่อโรงงาน', placeholder: 'F02' }, { label: 'รหัสโรงงาน', placeholder: '02' }],
    onAdd: async ([name, factoryCode]) => {
      const n = (name || '').trim(), fc = (factoryCode || '').trim();
      if (!n || !fc) return null;
      await api.post(`${M}/factories`, { name: n, factory_code: fc });
      qc.invalidateQueries({ queryKey: ['pm-factories'] });
      return n;
    },
  };

  const fmOptions = (fmRes?.data ?? []).map(f => ({ value: f.id, label: f.name }));
  const stationOptions = (ipqcStRes?.data ?? []).map(s => ({ value: s.id, label: s.name }));
  const templateOptions = (checkTmplRes?.data ?? []).map(t => ({ value: t.id, label: `${t.name} [${t.station_name}]` }));
  const toOpts = (arr) => (arr || []).map(v => ({ value: v, label: v }));

  return (
    <div>
      <h1 className="text-h2 font-bold text-text mb-4">ตั้งค่า Master — QC หน้างาน</h1>

      <div className="flex gap-1 mb-5 border-b border-border overflow-x-auto">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 text-small whitespace-nowrap border-b-2 -mb-px ${tab === k ? 'border-primary text-primary font-semibold' : 'border-transparent text-muted'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'lines' && (
        <CrudPanel
          exportable importable
          title="สายผลิต" endpoint={`${M}/production-lines`} queryKey="pm-lines-list"
          columns={[
            { key: 'code', label: 'รหัส', mono: true },
            { key: 'name', label: 'ชื่อสาย' },
            { key: 'line_type', label: 'ประเภท' },
            { key: 'factory', label: 'โรงงาน' },
            { key: 'pdplan_sheet', label: 'PDPlan Sheet', mono: true },
            { key: 'managers', label: 'ผู้รับผิดชอบ', render: r => (r.managers?.length || 0) + ' คน' },
          ]}
          fields={[
            { key: 'name', label: 'ชื่อสาย', required: true },
            {
              key: 'line_type', label: 'ประเภทสาย', type: 'select', required: true,
              options: lineTypeOptions, creatable: addLineType,
              disabled: (initial) => !!initial, // เปลี่ยนหลังสร้างไม่ได้ — รหัสสายผูกกับค่านี้ไปแล้ว
            },
            {
              key: 'factory', label: 'โรงงาน', type: 'select', required: true,
              options: factoryOptions, creatable: addFactory,
              disabled: (initial) => !!initial,
            },
            {
              key: 'factory_code', label: 'รหัสโรงงาน',
              computed: (form) => factoryByName[form.factory]?.factory_code || '',
              help: 'เติมอัตโนมัติตามโรงงานที่เลือก — ใช้สร้าง Defect Code',
            },
            {
              key: 'code', label: 'รหัสสาย',
              computed: (form, initial) => initial?.code
                || (form.factory && form.line_type ? `${form.factory}-${String(form.line_type).toUpperCase()}-…` : ''),
              help: (form, initial) => initial
                ? 'รหัสสายไม่สามารถแก้ไขได้หลังสร้าง'
                : 'ระบบสร้างอัตโนมัติจากโรงงาน + ประเภทสาย + ลำดับที่ เมื่อบันทึก',
            },
            { key: 'pdplan_sheet', label: 'รหัส Sheet PDPlan', placeholder: '0115,0116', help: 'คั่นหลายค่าด้วยจุลภาค' },
          ]}
          extraActions={[{ label: 'ผู้รับผิดชอบ', onClick: r => setManagingLine(r) }]}
        />
      )}

      {managingLine && <ManagersModal line={managingLine} onClose={() => setManagingLine(null)} />}

      {tab === 'process' && (
        <CrudPanel
          exportable importable
          title="กระบวนการ" endpoint={`${M}/process-steps`} queryKey="pm-process-list"
          columns={[
            { key: 'name', label: 'ชื่อกระบวนการ' },
            { key: 'code', label: 'รหัส', mono: true },
            { key: 'line', label: 'สายผลิต', render: r => r.line_name || 'ทุกสาย' },
            { key: 'sort_order', label: 'ลำดับ' },
          ]}
          fields={[
            { key: 'production_line_id', label: 'สายผลิต', type: 'select', options: lineOptions, placeholder: '— ทุกสาย —' },
            { key: 'name', label: 'ชื่อกระบวนการ', required: true },
            { key: 'code', label: 'รหัสกระบวนการ', required: true, help: 'ใช้ใน Defect Code (เช่น TC)' },
            { key: 'sort_order', label: 'ลำดับ', type: 'number' },
          ]}
        />
      )}

      {tab === 'defects' && (
        <CrudPanel
          exportable importable
          title="ประเภทของเสีย" endpoint={`${M}/defect-types`} queryKey="pm-defect-list"
          columns={[
            { key: 'name', label: 'ชื่อของเสีย' },
            { key: 'code', label: 'รหัส', mono: true },
            { key: 'fm', label: 'FM', render: r => r.fm_name || '-' },
            { key: 'line', label: 'สายผลิต', render: r => r.line_name || 'ทุกสาย' },
          ]}
          fields={[
            { key: 'production_line_id', label: 'สายผลิต', type: 'select', options: lineOptions, placeholder: '— ทุกสาย —' },
            { key: 'fm_category_id', label: 'FM Category', type: 'select', options: fmOptions },
            { key: 'name', label: 'ชื่อของเสีย', required: true },
            { key: 'code', label: 'รหัสของเสีย', required: true, help: 'ใช้ใน Defect Code (เช่น 001)' },
          ]}
        />
      )}

      {tab === 'fm' && (
        <CrudPanel
          exportable importable
          title="FM Category" endpoint={`${M}/fm-categories`} queryKey="pm-fm-list"
          columns={[{ key: 'name', label: 'ชื่อ' }, { key: 'code', label: 'รหัส', mono: true }]}
          fields={[
            { key: 'name', label: 'ชื่อ FM', required: true, placeholder: 'Machine' },
            { key: 'code', label: 'รหัส FM', required: true, placeholder: 'Mc' },
          ]}
        />
      )}

      {tab === 'shifts' && (
        <CrudPanel
          exportable importable
          title="กะการผลิต" endpoint={`${M}/shifts`} queryKey="pm-shift-list" searchable={false}
          columns={[{ key: 'name', label: 'ชื่อกะ' }, { key: 'start_time', label: 'เริ่ม' }, { key: 'end_time', label: 'สิ้นสุด' }]}
          fields={[
            { key: 'name', label: 'ชื่อกะ', required: true, placeholder: 'กะเช้า' },
            { key: 'start_time', label: 'เวลาเริ่ม', placeholder: '08:00' },
            { key: 'end_time', label: 'เวลาสิ้นสุด', placeholder: '17:00' },
          ]}
        />
      )}

      {tab === 'thresholds' && (
        <CrudPanel
          exportable importable
          title="เกณฑ์ของเสีย (FQC)" endpoint={`${M}/thresholds`} queryKey="pm-threshold-list" searchable={false} softDelete={false}
          columns={[
            { key: 'line', label: 'สายผลิต', render: r => r.line_name || 'ทุกสาย' },
            { key: 'product', label: 'สินค้า', render: r => r.product_no || 'ทุกสินค้า' },
            { key: 'pct', label: 'เกณฑ์', render: r => `${r.threshold_pct}%` },
            { key: 'effective_date', label: 'มีผลตั้งแต่' },
          ]}
          fields={[
            { key: 'production_line_id', label: 'สายผลิต', type: 'select', options: lineOptions, placeholder: '— ทุกสาย (ค่าเริ่มต้น) —' },
            { key: 'threshold_pct', label: 'เกณฑ์ % (เกินถือว่าไม่ผ่าน)', type: 'number', required: true, placeholder: '3.0' },
            { key: 'effective_date', label: 'วันที่มีผล', type: 'date' },
          ]}
        />
      )}

      {tab === 'ipqc-stations' && (
        <CrudPanel
          title="IPQC Stations" endpoint={`${M}/ipqc-stations`} queryKey="pm-ipqc-stations-list" softDelete={false}
          columns={[
            { key: 'sort_order', label: 'ลำดับ' },
            { key: 'code', label: 'Code', mono: true },
            { key: 'name', label: 'ชื่อ Station' },
            { key: 'is_active', label: 'ใช้งาน', render: r => r.is_active ? 'ใช้งาน' : 'ปิด' },
          ]}
          fields={[
            { key: 'sort_order', label: 'ลำดับ', type: 'number', placeholder: '1' },
            { key: 'code', label: 'Code', required: true, placeholder: 'cutting', help: 'ตัวพิมพ์เล็ก ไม่มีช่องว่าง' },
            { key: 'name', label: 'ชื่อ Station', required: true, placeholder: 'ตัดเส้น' },
            { key: 'is_active', label: 'ใช้งาน', type: 'select', default: 1, options: [{ value: 1, label: 'ใช้งาน' }, { value: 0, label: 'ปิด' }] },
          ]}
        />
      )}

      {tab === 'check-templates' && (() => {
        const combos = specOpts.combinations || [];

        // helper: distinct sorted values จาก combinations ที่ผ่าน filter
        const distinct = (arr, key) =>
          [...new Set(arr.map(c => c[key]).filter(Boolean))].sort().map(v => ({ value: v, label: v }));

        // cascade: แต่ละ field กรองตาม field ก่อนหน้าที่เลือกแล้ว
        const windowTypeOpts = (form) => {
          const f = form.spec_product_type
            ? combos.filter(c => c.product_type === form.spec_product_type)
            : combos;
          return distinct(f, 'window_type');
        };
        const colorOpts = (form) => {
          const f = combos.filter(c =>
            (!form.spec_product_type || c.product_type === form.spec_product_type) &&
            (!form.spec_window_type  || c.window_type  === form.spec_window_type)
          );
          return distinct(f, 'color');
        };
        const sizeOpts = (form) => {
          const f = combos.filter(c =>
            (!form.spec_product_type || c.product_type === form.spec_product_type) &&
            (!form.spec_window_type  || c.window_type  === form.spec_window_type)  &&
            (!form.spec_color        || c.color        === form.spec_color)
          );
          return distinct(f, 'size');
        };

        return (
          <CrudPanel
            title="Check Templates" endpoint={`${M}/check-templates`} queryKey="pm-check-templates-list" softDelete={false}
            columns={[
              { key: 'station_name', label: 'Station' },
              { key: 'name', label: 'ชื่อ Template' },
              { key: 'spec', label: 'Spec ที่ตรงกัน', render: r => {
                const tags = [r.spec_series, r.spec_brand, r.spec_product_type, r.spec_window_type, r.spec_color, r.spec_size].filter(Boolean);
                return tags.length ? tags.map((t, i) => (
                  <span key={i} className="inline-block mr-1 mb-0.5 px-1.5 py-0.5 rounded text-[10px] bg-blue-50 dark:bg-blue-900 text-blue-700 dark:text-blue-200 border border-blue-200 dark:border-blue-700">{t}</span>
                )) : <span className="text-muted text-[11px]">Generic (ทุกสินค้า)</span>;
              }},
              { key: 'line_name', label: 'สายผลิต', render: r => r.line_name || 'ทุกสาย' },
              { key: 'is_active', label: 'ใช้งาน', render: r => <span className={`badge ${r.is_active ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200' : 'bg-gray-100 dark:bg-gray-900 text-gray-500 dark:text-gray-200'}`}>{r.is_active ? 'ใช้งาน' : 'ปิด'}</span> },
            ]}
            fields={[
              { key: 'station_id',         label: 'Station',                      type: 'select', options: stationOptions,              required: true },
              { key: 'production_line_id', label: 'สายผลิต',                      type: 'select', options: lineOptions,                 placeholder: '— ทุกสาย —' },
              { key: 'name',               label: 'ชื่อ Template',                required: true, placeholder: 'ตัดเส้น FA หน้าต่าง v1' },
              { key: 'spec_series',        label: 'Series (ว่าง = ทุก series)',   type: 'select', options: toOpts(specOpts.series),       placeholder: '— ทุก series —' },
              { key: 'spec_brand',         label: 'Brand (ว่าง = ทุก brand)',     type: 'select', options: toOpts(specOpts.brand),        placeholder: '— ทุก brand —' },
              { key: 'spec_product_type',  label: 'ประเภทสินค้า (ว่าง = ทุกประเภท)', type: 'select', options: toOpts(specOpts.product_type), placeholder: '— ทุกประเภท —' },
              { key: 'spec_window_type',   label: 'สไตล์ (ว่าง = ทุกสไตล์)',     type: 'select', optionsFn: windowTypeOpts, dependsOn: 'spec_product_type', placeholder: '— ทุกสไตล์ —' },
              { key: 'spec_color',         label: 'สี (ว่าง = ทุกสี)',            type: 'select', optionsFn: colorOpts,      dependsOn: 'spec_window_type',  placeholder: '— ทุกสี —' },
              { key: 'spec_size',          label: 'ขนาด (ว่าง = ทุกขนาด)',        type: 'select', optionsFn: sizeOpts,       dependsOn: 'spec_color',        placeholder: '— ทุกขนาด —' },
              { key: 'is_active',          label: 'ใช้งาน',                       type: 'select', default: 1, options: [{ value: 1, label: 'ใช้งาน' }, { value: 0, label: 'ปิด' }] },
            ]}
          />
        );
      })()}

      {tab === 'check-items' && (
        <CrudPanel
          title="Check Items" endpoint={`${M}/check-items`} queryKey="pm-check-items-list" softDelete={false} searchable={false}
          columns={[
            { key: 'template_name', label: 'Template' },
            { key: 'item_no', label: 'No.' },
            { key: 'item_name', label: 'หัวข้อตรวจ' },
            { key: 'target_dimension', label: 'จุดวัด', render: r => r.target_dimension || '-' },
            { key: 'std_info', label: 'Std / Tol', render: r => r.input_type === 'number' ? `${r.std_value ?? '-'} ±(+${r.tol_plus}/-${r.tol_minus}) ${r.unit}` : r.input_type },
            { key: 'check_type', label: 'ประเภท' },
          ]}
          fields={[
            { key: 'template_id', label: 'Template', type: 'select', options: templateOptions, required: true },
            { key: 'item_no', label: 'ลำดับที่', type: 'number', required: true },
            { key: 'sort_order', label: 'ลำดับแสดง', type: 'number' },
            { key: 'item_name', label: 'ชื่อหัวข้อตรวจ', required: true, placeholder: 'ความยาวเส้น A (ด้านบน)' },
            { key: 'target_dimension', label: 'จุดวัด / อ้างอิง', placeholder: 'ความยาว ด้านบน' },
            { key: 'position_reference', label: 'ตำแหน่งตรวจ', placeholder: 'วัดจากขอบซ้าย ที่ตำแหน่ง 10mm' },
            { key: 'check_type', label: 'ประเภท', type: 'select', options: [{ value: 'dimension', label: 'ขนาด (dimension)' }, { value: 'visual', label: 'ตรวจตา (visual)' }, { value: 'functional', label: 'ทดสอบ (functional)' }] },
            { key: 'input_type', label: 'รูปแบบกรอก', type: 'select', options: [{ value: 'number', label: 'ตัวเลข (วัดค่า)' }, { value: 'pass_fail', label: 'ผ่าน/ไม่ผ่าน' }, { value: 'text', label: 'ข้อความ' }] },
            { key: 'std_value', label: 'ค่า Std', type: 'number', placeholder: '2400' },
            { key: 'tol_plus', label: 'Tolerance +', type: 'number', placeholder: '1' },
            { key: 'tol_minus', label: 'Tolerance -', type: 'number', placeholder: '1' },
            { key: 'unit', label: 'หน่วย', placeholder: 'mm' },
            { key: 'is_required', label: 'บังคับ', type: 'select', default: 1, options: [{ value: 1, label: 'บังคับ' }, { value: 0, label: 'ไม่บังคับ' }] },
          ]}
        />
      )}
    </div>
  );
}
