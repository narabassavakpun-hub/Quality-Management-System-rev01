import React, { createContext, useContext, useState, useEffect, useCallback, useLayoutEffect } from 'react';

// ค่าเดียวกันกับ inline script ใน index.html (กัน flash-of-wrong-theme ตอนโหลดหน้าแรก) — แก้ที่นี่ต้องแก้ที่นั่นด้วย
const STORAGE_KEY = 'iqc_theme_preference'; // 'light' | 'dark' | 'auto'
const START_HOUR_KEY = 'iqc_theme_auto_start_hour'; // ชั่วโมงที่เริ่มเข้าสู่ dark (ค่าเริ่มต้น 18 = 18:00)
const END_HOUR_KEY = 'iqc_theme_auto_end_hour';     // ชั่วโมงที่กลับเป็น light (ค่าเริ่มต้น 6 = 06:00)

const DEFAULT_DARK_START = 18;
const DEFAULT_DARK_END = 6;

const ThemeContext = createContext(null);

// รองรับช่วงข้ามเที่ยงคืน (เช่น start=18, end=6 → dark ตั้งแต่ 18:00 ถึง 05:59 ของอีกวัน)
function isDarkHour(hour, start, end) {
  if (start === end) return false;
  return start < end ? (hour >= start && hour < end) : (hour >= start || hour < end);
}

// โหมด auto (ตามเวลา) ใช้เฉพาะอุปกรณ์มือถือ/แท็บเล็ตแบบสัมผัส — เปิดจากคอม/โน้ตบุ๊ค (มีเมาส์/hover) ให้เป็นกลางวันเสมอ
// (คำขอ user) เช็คด้วย pointer/hover แทน user-agent หรือความกว้างหน้าจอ เพราะทนต่อการย่อ/ขยายหน้าต่างบนคอมได้
// (ไม่นับว่าเป็นมือถือแค่เพราะหน้าต่างแคบ) — ต้อง sync logic เดียวกันกับ index.html
function isMobileDevice() {
  try {
    return window.matchMedia('(pointer: coarse) and (hover: none)').matches;
  } catch {
    return false;
  }
}

function readStorage(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch {
    return fallback;
  }
}

export function ThemeProvider({ children }) {
  const [preference, setPreferenceState] = useState(() => readStorage(STORAGE_KEY, 'auto'));
  const [autoStartHour, setAutoStartHourState] = useState(() => Number(readStorage(START_HOUR_KEY, DEFAULT_DARK_START)));
  const [autoEndHour, setAutoEndHourState] = useState(() => Number(readStorage(END_HOUR_KEY, DEFAULT_DARK_END)));

  const computeEffective = useCallback(() => {
    if (preference === 'dark') return 'dark';
    if (preference === 'light') return 'light';
    if (!isMobileDevice()) return 'light'; // auto บนคอม/โน้ตบุ๊ค → กลางวันเสมอ
    return isDarkHour(new Date().getHours(), autoStartHour, autoEndHour) ? 'dark' : 'light';
  }, [preference, autoStartHour, autoEndHour]);

  const [effectiveTheme, setEffectiveTheme] = useState(computeEffective);

  // useLayoutEffect (ไม่ใช่ useEffect) — apply ก่อน paint กันจอกระพริบตอนสลับ preference/auto
  useLayoutEffect(() => {
    const eff = computeEffective();
    setEffectiveTheme(eff);
    document.documentElement.classList.toggle('dark', eff === 'dark');
  }, [computeEffective]);

  // auto mode: เช็คซ้ำทุกนาที เผื่อเปิดหน้าค้างไว้ข้ามช่วงเวลาที่ตั้งไว้ (เช่น เปิดค้างตั้งแต่ 17:55 ถึง 18:00)
  useEffect(() => {
    if (preference !== 'auto') return;
    const id = setInterval(() => {
      const eff = computeEffective();
      setEffectiveTheme(prev => {
        if (prev !== eff) document.documentElement.classList.toggle('dark', eff === 'dark');
        return eff;
      });
    }, 60 * 1000);
    return () => clearInterval(id);
  }, [preference, computeEffective]);

  const setPreference = useCallback((next) => {
    setPreferenceState(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch {}
  }, []);

  const setAutoHours = useCallback((startHour, endHour) => {
    setAutoStartHourState(startHour);
    setAutoEndHourState(endHour);
    try {
      localStorage.setItem(START_HOUR_KEY, String(startHour));
      localStorage.setItem(END_HOUR_KEY, String(endHour));
    } catch {}
  }, []);

  return (
    <ThemeContext.Provider value={{ preference, setPreference, effectiveTheme, autoStartHour, autoEndHour, setAutoHours }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
