import React from 'react';
import { createPortal } from 'react-dom';
import { useProcessingCtx } from '../../contexts/ProcessingContext';

export default function ProcessingToast() {
  const { message } = useProcessingCtx();
  if (!message) return null;

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: '28px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 99999,
        background: 'rgba(26,58,92,0.95)',
        color: '#fff',
        borderRadius: '10px',
        padding: '12px 22px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        boxShadow: '0 6px 24px rgba(0,0,0,0.28)',
        minWidth: '260px',
        maxWidth: '90vw',
        backdropFilter: 'blur(4px)',
        animation: 'slideUp 0.2s ease-out',
      }}
    >
      <svg
        style={{ width: '18px', height: '18px', flexShrink: 0, animation: 'spin 0.8s linear infinite' }}
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle style={{ opacity: 0.25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path style={{ opacity: 0.85 }} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <span style={{ fontSize: '14px', fontFamily: 'IBM Plex Sans Thai, sans-serif' }}>
        กำลังดำเนินการ: <strong>{message}</strong>
      </span>
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateX(-50%) translateY(12px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>,
    document.body
  );
}
