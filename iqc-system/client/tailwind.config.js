/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#1A3A5C',
        accent: '#2E6DA4',
        bg: '#F5F6F8',
        surface: '#FFFFFF',
        border: '#D1D5DB',
        text: '#1F2937',
        muted: '#6B7280',
        success: '#16A34A',
        danger: '#DC2626',
        warning: '#D97706',
      },
      fontFamily: {
        sans: ['IBM Plex Sans Thai', 'sans-serif'],
        mono: ['IBM Plex Mono', 'monospace'],
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
