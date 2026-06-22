import React from 'react';

export default function SortTh({ col, sortKey, sortDir, onSort, children, className = '' }) {
  const active = sortKey === col;
  return (
    <th
      className={`cursor-pointer select-none hover:bg-black/5 transition-colors ${className}`}
      onClick={() => onSort(col)}
    >
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        {children}
        <span className={`text-[10px] leading-none ${active ? 'text-accent' : 'text-border'}`}>
          {active && sortDir === 'desc' ? '▼' : '▲'}
        </span>
      </span>
    </th>
  );
}
