import { useEffect, useRef } from 'react';

// DEVMORE H6 / CLAUDE.md 3.1 — idle 30 นาที → logout, เตือนก่อน 2 นาที (ที่ 28 นาที)
// onWarn() เรียกตอนใกล้หมดเวลา, onTimeout() เรียกตอนหมดเวลา, activity ใด ๆ จะ reset
export function useIdleTimeout({ onWarn, onTimeout, warnMs = 28 * 60 * 1000, timeoutMs = 30 * 60 * 1000, enabled = true }) {
  const warnRef = useRef(null);
  const timeoutRef = useRef(null);

  useEffect(() => {
    if (!enabled) return;

    const clear = () => {
      if (warnRef.current) clearTimeout(warnRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };

    const reset = () => {
      clear();
      warnRef.current = setTimeout(() => { onWarn?.(); }, warnMs);
      timeoutRef.current = setTimeout(() => { onTimeout?.(); }, timeoutMs);
    };

    // throttle การ reset (ไม่ reset ถี่เกินจาก mousemove)
    let last = 0;
    const onActivity = () => {
      const now = Date.now();
      if (now - last < 1000) return;
      last = now;
      reset();
    };

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
    events.forEach(e => window.addEventListener(e, onActivity, { passive: true }));
    reset();

    return () => {
      clear();
      events.forEach(e => window.removeEventListener(e, onActivity));
    };
  }, [enabled, warnMs, timeoutMs, onWarn, onTimeout]);
}
