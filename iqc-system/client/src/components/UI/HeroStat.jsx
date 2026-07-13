import React from 'react';

// การ์ดสรุปตัวเลขแบบเน้นสี+ตัวเลขใหญ่ (ใช้ใน Purchasing/Purchasing Manager Dashboard) — คงโทนสี token เดิมของระบบ
// (primary/warning/success/danger) ไม่ใช้สีนอกระบบ ตาม CLAUDE.md §15/§25.3
export const HeroIcons = {
  building: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>,
  tasks: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>,
  check: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  alert: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>,
  users: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>,
};

const TONES = {
  primary: { iconBg: 'bg-blue-100 dark:bg-blue-900', iconText: 'text-blue-600 dark:text-blue-200', numText: 'text-primary' },
  accent: { iconBg: 'bg-indigo-100 dark:bg-indigo-900', iconText: 'text-indigo-600 dark:text-indigo-200', numText: 'text-accent' },
  warning: { iconBg: 'bg-orange-100 dark:bg-orange-900', iconText: 'text-orange-600 dark:text-orange-200', numText: 'text-warning' },
  success: { iconBg: 'bg-green-100 dark:bg-green-900', iconText: 'text-green-600 dark:text-green-200', numText: 'text-success' },
  danger: { iconBg: 'bg-red-100 dark:bg-red-900', iconText: 'text-red-600 dark:text-red-200', numText: 'text-danger' },
};

export default function HeroStat({ icon, value, label, tone = 'primary', emphasize }) {
  const t = TONES[tone];
  return (
    <div className={`card flex items-center gap-3 ${emphasize ? 'ring-2 ring-danger/40' : ''}`}>
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${t.iconBg} ${t.iconText}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className={`font-mono font-bold leading-none ${emphasize ? 'text-4xl' : 'text-3xl'} ${t.numText}`}>{value}</div>
        <div className="text-small text-muted mt-1 truncate">{label}</div>
      </div>
    </div>
  );
}
