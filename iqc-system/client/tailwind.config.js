/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class', // toggle ผ่าน .dark class บน <html> (ThemeContext) — ไม่ใช้ media strategy เพราะต้องรองรับ auto ตามเวลานาฬิกา ไม่ใช่ OS preference
  theme: {
    extend: {
      colors: {
        // ── Core semantic tokens (คงชื่อเดิมทั้งหมด — ใช้อยู่ทั่วทั้ง 51 หน้า) ──
        // ผูกกับ CSS variable (index.css :root / .dark) แทน hex ตรงๆ เพื่อสลับ light/dark โดยไม่ต้องแก้ className
        // ทีละไฟล์ — pattern "rgb(var(...) / <alpha-value>)" ทำให้ opacity modifier เดิม (เช่น bg-primary/50) ยังใช้ได้
        primary: 'rgb(var(--color-primary) / <alpha-value>)',
        accent: 'rgb(var(--color-accent) / <alpha-value>)',
        bg: 'rgb(var(--color-bg) / <alpha-value>)',
        surface: 'rgb(var(--color-surface) / <alpha-value>)',
        border: 'rgb(var(--color-border) / <alpha-value>)',
        text: 'rgb(var(--color-text) / <alpha-value>)',
        muted: 'rgb(var(--color-muted) / <alpha-value>)',
        success: 'rgb(var(--color-success) / <alpha-value>)',
        danger: 'rgb(var(--color-danger) / <alpha-value>)',
        warning: 'rgb(var(--color-warning) / <alpha-value>)',
        // ── Window Asia brand extension tokens (ใหม่ — สำหรับ hero/glass/motion surfaces) ──
        'primary-dark': '#081B32', // near-black navy — ก้นภาพ gradient, hero background
        'accent-glow': '#4F9CFF',  // ฟ้าสว่าง — focus ring glow, hover glow, highlight
        aluminum: {
          50: '#F7F8FA',
          100: '#EEF1F4',
          200: '#DDE3E9',
          300: '#C6CFD8',
          400: '#9CA8B5',
          500: '#798794',
          600: '#5C6873',
          700: '#434C55',
        },
      },
      boxShadow: {
        'glow-sm': '0 0 0 3px rgba(79,156,255,0.18)',
        glow: '0 8px 30px -4px rgba(18,58,107,0.35), 0 0 0 1px rgba(79,156,255,0.08)',
        elevated: '0 20px 60px -12px rgba(8,27,50,0.25), 0 4px 16px -4px rgba(8,27,50,0.12)',
      },
      keyframes: {
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        floatY: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        gradientPan: {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        fadeInUp: 'fadeInUp 0.6s cubic-bezier(0.16,1,0.3,1) both',
        floatY: 'floatY 6s ease-in-out infinite',
        gradientPan: 'gradientPan 12s ease infinite',
        shimmer: 'shimmer 2.5s linear infinite',
      },
      fontFamily: {
        sans: ['IBM Plex Sans Thai', 'sans-serif'],
        // ตั้งใจไม่ใช้ IBM Plex Mono จริง — glyph เลข 0 ของฟอนต์นี้มีจุดกลางตายตัว แก้ด้วย CSS ไม่ได้เลย
        // (ทดสอบแล้วทั้ง font-variant-numeric และ font-feature-settings 'zero') ทำให้อ่านสับสนกับตัวเลขอื่น
        // จึงชี้ font-mono มาที่ font เดียวกับ sans แทน เพื่อให้ทุกที่ที่เคยใช้ font-mono (รหัส/ตัวเลข) ทั้งโปรเจกต์
        // ไม่มีเลข 0 มีจุดอีกต่อไป โดยไม่ต้องแก้ className ทีละไฟล์
        mono: ['IBM Plex Sans Thai', 'sans-serif'],
      },
      fontSize: {
        h1: ['24px', { lineHeight: '1.3' }],
        h2: ['20px', { lineHeight: '1.3' }],
        h3: ['16px', { lineHeight: '1.4' }],
        body: ['14px', { lineHeight: '1.5' }],
        small: ['12px', { lineHeight: '1.4' }],
      },
    },
  },
  plugins: [require('@tailwindcss/forms')],
};
