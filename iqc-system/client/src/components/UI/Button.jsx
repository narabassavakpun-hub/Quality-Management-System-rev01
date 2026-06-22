import React, { useContext, useEffect } from 'react';
import { useProcessingCtx } from '../../contexts/ProcessingContext';

const variants = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  danger: 'btn-danger',
  warning: 'btn-warning',
  success: 'btn-success',
};

function extractText(children) {
  if (typeof children === 'string') return children.trim();
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) {
    return children.map(extractText).filter(Boolean).join('').trim() || null;
  }
  if (children?.props?.children) return extractText(children.props.children);
  return null;
}

export default function Button({
  variant = 'primary',
  children,
  className = '',
  loading = false,
  loadingMessage,
  ...props
}) {
  const { show, hide } = useProcessingCtx();

  useEffect(() => {
    if (!loading) return;
    const msg = loadingMessage ?? extractText(children) ?? 'กำลังดำเนินการ...';
    show(msg);
    return () => hide();
  }, [loading]);

  return (
    <button
      className={`${variants[variant]} ${className}`}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading && (
        <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {children}
    </button>
  );
}
