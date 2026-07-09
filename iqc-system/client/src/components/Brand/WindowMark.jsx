import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';

/**
 * Decorative abstract "layered window pane" motif — เป็นภาพประกอบ (ไม่ใช่ logo จริง)
 * ใช้บนหน้า Login/hero เท่านั้น ให้ใช้ logo-window-asia.png สำหรับ brand lockup จริง (Sidebar ฯลฯ)
 */
export default function WindowMark({ size = 220, floating = true }) {
  const reduceMotion = useReducedMotion();
  const shouldFloat = floating && !reduceMotion;
  const content = (
    <svg width={size} height={size} viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="wm-blue" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4F9CFF" />
          <stop offset="100%" stopColor="#1D6FC9" />
        </linearGradient>
        <linearGradient id="wm-silver" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#EEF1F4" />
          <stop offset="100%" stopColor="#C6CFD8" />
        </linearGradient>
        <clipPath id="wm-front-clip">
          <rect x="58" y="58" width="90" height="90" rx="8" />
        </clipPath>
      </defs>

      {/* back pane — silver aluminum, rotated */}
      <g transform="rotate(-8 100 100)">
        <rect x="46" y="40" width="100" height="100" rx="6" fill="url(#wm-silver)" opacity="0.9" />
        <rect x="46" y="40" width="100" height="100" rx="6" stroke="#9CA8B5" strokeWidth="2" />
        <rect x="46" y="40" width="50" height="100" fill="#798794" opacity="0.35" />
      </g>

      {/* front pane — glass blue + white frame, cross mullion */}
      <g transform="rotate(4 100 100)">
        <rect x="58" y="58" width="90" height="90" rx="8" fill="white" />
        <rect x="58" y="58" width="90" height="90" rx="8" stroke="#1F2937" strokeWidth="3" />
        <rect x="103" y="103" width="45" height="45" rx="2" fill="url(#wm-blue)" />
        <line x1="103" y1="58" x2="103" y2="148" stroke="#9CA8B5" strokeWidth="2.5" />
        <line x1="58" y1="103" x2="148" y2="103" stroke="#9CA8B5" strokeWidth="2.5" />
        {/* light reflection sweep — clipped to the front pane */}
        {!reduceMotion && (
          <g clipPath="url(#wm-front-clip)">
            <motion.rect
              y="58" width="20" height="90"
              fill="white" opacity="0.5"
              initial={{ x: 40 }}
              animate={{ x: 170 }}
              transition={{ duration: 3, repeat: Infinity, repeatDelay: 2.5, ease: 'easeInOut' }}
              style={{ mixBlendMode: 'overlay' }}
            />
          </g>
        )}
      </g>
    </svg>
  );

  if (!shouldFloat) {
    return <div style={{ filter: 'drop-shadow(0 20px 40px rgba(8,27,50,0.35))' }}>{content}</div>;
  }

  return (
    <motion.div
      animate={{ y: [0, -10, 0] }}
      transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
      style={{ filter: 'drop-shadow(0 20px 40px rgba(8,27,50,0.35))' }}
    >
      {content}
    </motion.div>
  );
}
