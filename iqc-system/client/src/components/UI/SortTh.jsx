import React from 'react';

export default function SortTh({ col, sortKey, sortDir, onSort, children, className = '' }) {
  const active = sortKey === col;
  return (
    <th
      className={`cursor-pointer select-none hover:bg-black/5 dark:hover:bg-white/10 transition-colors ${className}`}
      onClick={() => onSort(col)}
    >
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        {children}
        {/* สืบสีจาก .table th (text-blue-900 dark:text-blue-200) ผ่าน currentColor — ปรับแค่ opacity ตาม active */}
        <span className={`text-[10px] leading-none ${active ? 'opacity-100' : 'opacity-40'}`}>
          {active && sortDir === 'desc' ? '▼' : '▲'}
        </span>
      </span>
    </th>
  );
}
