import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../utils/api';

const SUNDAY_LABEL = 'วันอาทิตย์ (ทุกสัปดาห์)';

const currentYear = new Date().getFullYear();
const yearOptions = [currentYear - 1, currentYear, currentYear + 1];

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function Holidays() {
  const qc = useQueryClient();
  const [year, setYear] = useState(currentYear);
  const [form, setForm] = useState({ holiday_date: '', name: '' });
  const [error, setError] = useState('');

  const { data: holidays = [], isLoading } = useQuery({
    queryKey: ['holidays', year],
    queryFn: () => api.get(`/holidays?year=${year}`).then(r => r.data),
  });

  const add = useMutation({
    mutationFn: (body) => api.post('/holidays', body).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['holidays'] });
      setForm({ holiday_date: '', name: '' });
      setError('');
    },
    onError: (e) => setError(e.response?.data?.error || 'เกิดข้อผิดพลาด'),
  });

  const remove = useMutation({
    mutationFn: (id) => api.delete(`/holidays/${id}`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['holidays'] }),
    onError: (e) => alert(e.response?.data?.error || 'ลบไม่ได้'),
  });

  const handleAdd = (e) => {
    e.preventDefault();
    setError('');
    if (!form.holiday_date || !form.name.trim()) {
      setError('กรุณากรอกวันที่และชื่อวันหยุด');
      return;
    }
    add.mutate(form);
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-primary mb-1">จัดการวันหยุดบริษัท</h1>
      <p className="text-sm text-muted mb-6">วันอาทิตย์เป็นวันหยุดประจำทุกสัปดาห์โดยอัตโนมัติ</p>

      {/* Sunday fixed notice */}
      <div className="mb-6 flex items-center gap-3 px-4 py-3 bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded-lg">
        <span className="w-3 h-3 rounded-full bg-red-500 flex-shrink-0" />
        <span className="text-sm text-red-700 dark:text-red-200 font-medium">{SUNDAY_LABEL} — วันหยุดถาวร ไม่สามารถแก้ไขได้</span>
      </div>

      {/* Add form */}
      <div className="bg-surface rounded-xl border border-border p-5 mb-6">
        <h2 className="text-base font-semibold text-text mb-4">เพิ่มวันหยุดบริษัท</h2>
        <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-3">
          <input
            type="date"
            value={form.holiday_date}
            onChange={e => setForm(f => ({ ...f, holiday_date: e.target.value }))}
            className="border border-border rounded-lg px-3 h-11 text-sm flex-shrink-0"
            required
          />
          <input
            type="text"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="ชื่อวันหยุด เช่น วันสงกรานต์"
            className="border border-border rounded-lg px-3 h-11 text-sm flex-1"
            required
          />
          <button
            type="submit"
            disabled={add.isPending}
            className="h-11 px-5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-accent disabled:opacity-50 flex-shrink-0"
          >
            {add.isPending ? 'กำลังบันทึก...' : '+ เพิ่มวันหยุด'}
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      </div>

      {/* Holiday list */}
      <div className="bg-surface rounded-xl border border-border">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-base font-semibold text-text">รายการวันหยุดบริษัท</h2>
          <select
            value={year}
            onChange={e => setYear(+e.target.value)}
            className="border border-border rounded-lg px-3 h-9 text-sm"
          >
            {yearOptions.map(y => (
              <option key={y} value={y}>{y + 543}</option>
            ))}
          </select>
        </div>

        {isLoading ? (
          <p className="text-center text-muted text-sm py-8">กำลังโหลด...</p>
        ) : holidays.length === 0 ? (
          <p className="text-center text-muted text-sm py-8">ไม่มีวันหยุดที่กำหนดไว้สำหรับปี {year + 543}</p>
        ) : (
          <ul className="divide-y divide-border">
            {holidays.map(h => (
              <li key={h.id} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50">
                <div>
                  <p className="text-sm font-medium text-text">{h.name}</p>
                  <p className="text-xs text-muted">{formatDate(h.holiday_date)}</p>
                </div>
                <button
                  onClick={() => {
                    if (window.confirm(`ลบวันหยุด "${h.name}" (${formatDate(h.holiday_date)}) ออกจากระบบ?`)) {
                      remove.mutate(h.id);
                    }
                  }}
                  className="text-sm text-danger hover:underline disabled:opacity-50"
                  disabled={remove.isPending}
                >
                  ลบ
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
