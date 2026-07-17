import React, { useState, useRef, useEffect } from 'react';
import { useTheme } from '../../contexts/ThemeContext';

const OPTIONS = [
  {
    value: 'light', label: 'สว่าง',
    icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>,
  },
  {
    value: 'dark', label: 'มืด',
    icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>,
  },
  {
    value: 'auto', label: 'อัตโนมัติ (ตามเวลา — มือถือเท่านั้น)',
    icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  },
];

// ปุ่มสลับธีม ส่วนตัวต่อ user (localStorage — ไม่ผูก backend/login) — CLAUDE.md §25
export default function ThemeToggle() {
  const { preference, setPreference, effectiveTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const current = OPTIONS.find(o => o.value === preference) || OPTIONS[2];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(p => !p)}
        title={`ธีม: ${current.label}${preference === 'auto' ? ` — ตอนนี้: ${effectiveTheme === 'dark' ? 'มืด' : 'สว่าง'}` : ''}`}
        className="w-10 h-10 flex items-center justify-center rounded-md hover:bg-bg text-muted"
        aria-label="เปลี่ยนธีม"
      >
        {current.icon}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-surface border border-border rounded-lg shadow-xl z-50 overflow-hidden py-1">
          {OPTIONS.map(o => (
            <button
              key={o.value}
              type="button"
              onClick={() => { setPreference(o.value); setOpen(false); }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-small text-left hover:bg-bg transition-colors ${
                preference === o.value ? 'text-accent font-medium' : 'text-text'
              }`}
            >
              {o.icon}
              {o.label}
              {preference === o.value && (
                <svg className="w-3.5 h-3.5 ml-auto flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
