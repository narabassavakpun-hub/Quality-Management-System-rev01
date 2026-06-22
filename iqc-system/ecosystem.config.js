// ============================================================================
// PM2 ecosystem — สำหรับ deploy ตรงบน Ubuntu VPS (ไม่ใช้ Docker)
// ใช้เมื่อ: ติดตั้ง Node 20 + Chromium + ฟอนต์ไทยบนเครื่องเอง
//   sudo apt install -y chromium-browser fonts-thai-tlwg   (ชื่อ package อาจต่างตาม distro)
//   cd client && npm ci && npm run build
//   cd ../server && npm ci --omit=dev
//   pm2 start ecosystem.config.js && pm2 save && pm2 startup
//
// สำคัญ: instances = 1 + fork เท่านั้น —
//   SQLite (single-writer), SSE (in-memory), Chromium singleton แชร์ข้าม worker ไม่ได้
//   ห้ามใช้ exec_mode: 'cluster'
// ============================================================================

module.exports = {
  apps: [
    {
      name: 'iqc-system',
      cwd: './server',
      script: 'index.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '700M',   // กัน memory leak ลาม (Chromium) → restart อัตโนมัติ
      kill_timeout: 15000,          // ให้เวลา graceful shutdown (ปิด Chromium + flush WAL)
      wait_ready: false,
      autorestart: true,
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        TZ: 'Asia/Bangkok',
        // ตั้งให้ตรงกับเครื่อง:
        IQC_DB_PATH: '/var/lib/iqc/iqc.db',
        PUPPETEER_EXECUTABLE_PATH: '/usr/bin/chromium',
        // JWT_SECRET / APP_URL ควรตั้งผ่าน server/../.env หรือ env ของ pm2 (อย่า hardcode ในไฟล์ที่ commit)
      },
    },
  ],
};
