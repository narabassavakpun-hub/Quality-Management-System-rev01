import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // ผูก 0.0.0.0 — ทดสอบผ่านมือถือ (WiFi เดียวกัน) ด้วยข้อมูล dev จริงได้โดยไม่ต้องใช้ Docker
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
