import React from 'react';

export default function EditButton({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="แก้ไข"
      className="w-8 h-8 flex items-center justify-center rounded-md border border-border text-muted hover:text-accent hover:border-accent hover:bg-blue-50 transition-colors"
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
    </button>
  );
}
