import React, { useState, useRef, useEffect } from 'react';

export default function MultiSelect({ options = [], value = [], onChange, placeholder = 'เลือก...', className = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function toggle(id) {
    if (value.includes(id)) onChange(value.filter(v => v !== id));
    else onChange([...value, id]);
  }

  const selected = options.filter(o => value.includes(o.value));

  return (
    <div className={`relative ${className}`} ref={ref}>
      <button
        type="button"
        className="input text-left flex items-center justify-between"
        onClick={() => setOpen(p => !p)}
      >
        <span className={selected.length ? 'text-text' : 'text-muted'}>
          {selected.length ? selected.map(s => s.label).join(', ') : placeholder}
        </span>
        <svg className={`w-4 h-4 ml-2 flex-shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full bg-surface border border-border rounded-md shadow-lg max-h-56 overflow-y-auto">
          {options.length === 0 && <div className="px-3 py-2 text-small text-muted">ไม่มีตัวเลือก</div>}
          {options.map(opt => (
            <label key={opt.value} className="flex items-center gap-2 px-3 py-2 hover:bg-bg cursor-pointer min-h-[44px]">
              <input
                type="checkbox"
                checked={value.includes(opt.value)}
                onChange={() => toggle(opt.value)}
                className="rounded border-border text-accent"
              />
              <span className="text-body">{opt.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
