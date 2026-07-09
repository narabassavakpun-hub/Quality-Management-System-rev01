const CAMERA_ICON = (
  <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const GALLERY_ICON = (
  <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
);

/**
 * Two-button image upload: ถ่ายรูป (camera) | คลังภาพ (gallery)
 * Props:
 *   onChange  — input onChange handler
 *   multiple  — allow multiple files (default true)
 *   disabled  — gray out + block interaction
 *   variant   — 'normal' | 'danger' (border/text color)
 */
export default function ImageUploadPair({ onChange, multiple = true, disabled = false, variant = 'normal' }) {
  const base = 'flex-1 flex items-center justify-center gap-1.5 border rounded-lg min-h-[44px] cursor-pointer text-small transition-colors';
  const cls = variant === 'danger'
    ? `${base} border-danger text-danger bg-surface hover:bg-red-50`
    : `${base} border-border text-muted bg-surface hover:bg-bg hover:border-accent hover:text-accent`;

  return (
    <div className={`flex gap-2${disabled ? ' opacity-50 pointer-events-none' : ''}`}>
      <label className={cls}>
        {CAMERA_ICON}
        ถ่ายรูป
        <input type="file" accept="image/*" capture="environment" multiple={multiple} className="hidden" onChange={onChange} />
      </label>
      <label className={cls}>
        {GALLERY_ICON}
        คลังภาพ
        <input type="file" accept="image/*" multiple={multiple} className="hidden" onChange={onChange} />
      </label>
    </div>
  );
}
