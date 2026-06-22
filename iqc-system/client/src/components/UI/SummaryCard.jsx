import React from 'react';

export default function SummaryCard({ value, label, color, onClick }) {
  const borderColors = {
    primary: 'border-l-primary',
    danger: 'border-l-danger',
    warning: 'border-l-warning',
    success: 'border-l-success',
    accent: 'border-l-accent',
  };

  return (
    <div
      className={`card border-l-4 ${borderColors[color] || 'border-l-primary'} ${onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}
      onClick={onClick}
    >
      <div className="font-mono text-3xl font-bold text-primary">{value ?? '-'}</div>
      <div className="text-small text-muted mt-1">{label}</div>
    </div>
  );
}
