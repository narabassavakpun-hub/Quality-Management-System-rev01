import React from 'react';

export default function ToggleSwitch({ active, onClick, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title || (active ? 'ปิดใช้งาน' : 'เปิดใช้งาน')}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none ${
        active ? 'bg-success' : 'bg-border'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
          active ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}
