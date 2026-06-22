import React from 'react';

export default function Pagination({ page, totalPages, total, limit, onChange }) {
  if (totalPages <= 1 && total <= limit) return null;
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  return (
    <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
      <span className="text-small text-muted">
        {total === 0 ? 'ไม่พบข้อมูล' : `${from}–${to} จาก ${total} รายการ`}
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onChange(1)}
          disabled={page <= 1}
          className="px-2 py-1 text-small rounded border border-border bg-surface hover:bg-bg disabled:opacity-40 disabled:cursor-not-allowed min-h-[36px]"
        >«</button>
        <button
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
          className="px-3 py-1 text-small rounded border border-border bg-surface hover:bg-bg disabled:opacity-40 disabled:cursor-not-allowed min-h-[36px]"
        >ก่อนหน้า</button>
        <span className="px-3 py-1 text-small text-text">หน้า {page} / {totalPages || 1}</span>
        <button
          onClick={() => onChange(page + 1)}
          disabled={page >= totalPages}
          className="px-3 py-1 text-small rounded border border-border bg-surface hover:bg-bg disabled:opacity-40 disabled:cursor-not-allowed min-h-[36px]"
        >ถัดไป</button>
        <button
          onClick={() => onChange(totalPages)}
          disabled={page >= totalPages}
          className="px-2 py-1 text-small rounded border border-border bg-surface hover:bg-bg disabled:opacity-40 disabled:cursor-not-allowed min-h-[36px]"
        >»</button>
      </div>
    </div>
  );
}
