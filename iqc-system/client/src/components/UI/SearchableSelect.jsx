import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

export default function SearchableSelect({ options = [], value, onChange, placeholder = 'ค้นหา...', required, disabled, wrap = false, className = '', multiple = false }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [dropPos, setDropPos] = useState({ top: 0, bottom: undefined, left: 0, width: 0, flip: false });
  const wrapRef = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  const DROPDOWN_MAX_H = 280; // estimated: search bar ~50px + list max-h-52 ~208px + padding

  const selectedValues = multiple ? (Array.isArray(value) ? value.map(String) : []) : [];
  const selected = multiple ? null : options.find(o => String(o.value) === String(value));
  const selectedMulti = multiple ? options.filter(o => selectedValues.includes(String(o.value))) : [];
  const hasSelection = multiple ? selectedMulti.length > 0 : !!selected;
  const filtered = query
    ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  // Close on outside click (trigger or portal list)
  useEffect(() => {
    function handler(e) {
      const inTrigger = wrapRef.current?.contains(e.target);
      const inList = listRef.current?.contains(e.target);
      if (!inTrigger && !inList) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function calcPos() {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const spaceBelow = window.innerHeight - rect.bottom;
    const flip = spaceBelow < DROPDOWN_MAX_H && rect.top > DROPDOWN_MAX_H;
    setDropPos({
      top: flip ? undefined : rect.bottom + 4,
      bottom: flip ? (window.innerHeight - rect.top + 4) : undefined,
      left: rect.left,
      width: rect.width,
      flip,
    });
  }

  // Reposition dropdown on scroll/resize while open
  useEffect(() => {
    if (!open) return;
    window.addEventListener('scroll', calcPos, true);
    window.addEventListener('resize', calcPos);
    return () => {
      window.removeEventListener('scroll', calcPos, true);
      window.removeEventListener('resize', calcPos);
    };
  }, [open]);

  function openDropdown() {
    if (disabled) return;
    calcPos();
    setOpen(true);
    setQuery('');
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function select(opt) {
    if (multiple) {
      const v = String(opt.value);
      onChange(selectedValues.includes(v) ? selectedValues.filter(x => x !== v) : [...selectedValues, v]);
      setQuery('');
      inputRef.current?.focus();
      return; // เลือกได้หลายรายการติดกัน — ไม่ปิด dropdown
    }
    onChange(opt.value);
    setOpen(false);
    setQuery('');
  }

  function clear(e) {
    e.stopPropagation();
    onChange(multiple ? [] : '');
    setOpen(false);
    setQuery('');
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') { setOpen(false); setQuery(''); }
    if (e.key === 'Enter' && filtered.length === 1) { e.preventDefault(); select(filtered[0]); }
  }

  const dropdown = open && createPortal(
    <div
      ref={listRef}
      style={{ position: 'fixed', top: dropPos.top, bottom: dropPos.bottom, left: dropPos.left, minWidth: dropPos.width, width: 'max-content', maxWidth: `calc(100vw - ${Math.round(dropPos.left)}px - 8px)`, zIndex: 9999 }}
      className="bg-surface border border-border rounded-md shadow-lg"
    >
      <div className="p-2 border-b border-border">
        <input
          ref={inputRef}
          type="text"
          className="input py-1.5 text-small w-full"
          placeholder="พิมพ์เพื่อค้นหา..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>
      <div className="max-h-52 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="px-3 py-3 text-small text-muted text-center">ไม่พบรายการ</div>
        )}
        {filtered.map(opt => {
          const isSelected = multiple ? selectedValues.includes(String(opt.value)) : String(opt.value) === String(value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => select(opt)}
              className={`w-full text-left px-3 py-2 text-body hover:bg-bg min-h-[44px] flex items-center gap-2 ${isSelected ? 'bg-blue-50 dark:bg-blue-900 text-accent font-medium' : 'text-text'}`}
            >
              {multiple && (
                <span className={`w-4 h-4 flex-shrink-0 rounded border flex items-center justify-center ${isSelected ? 'bg-primary border-primary' : 'border-border'}`}>
                  {isSelected && (
                    <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                    </svg>
                  )}
                </span>
              )}
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>,
    document.body
  );

  return (
    <div className={`relative ${className}`} ref={wrapRef}>
      {required && (
        <input
          tabIndex={-1}
          required
          value={hasSelection ? 'x' : ''}
          onChange={() => {}}
          className="absolute inset-0 opacity-0 pointer-events-none w-full"
          aria-hidden="true"
        />
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={openDropdown}
        className={`input text-left flex ${wrap ? 'items-start' : 'items-center'} justify-between w-full gap-2 ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span className={hasSelection ? `text-text min-w-0 ${wrap ? 'break-words' : 'truncate'}` : 'text-muted truncate'}>
          {multiple
            ? (selectedMulti.length ? selectedMulti.map(s => s.label).join(', ') : placeholder)
            : (selected ? selected.label : placeholder)}
        </span>
        <div className="flex items-center gap-1 flex-shrink-0">
          {hasSelection && !disabled && (
            <span
              onClick={clear}
              className="w-4 h-4 text-muted hover:text-danger flex items-center justify-center rounded-full hover:bg-red-50 cursor-pointer"
              title="ล้าง"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </span>
          )}
          <svg className={`w-4 h-4 text-muted transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>
      {dropdown}
    </div>
  );
}
