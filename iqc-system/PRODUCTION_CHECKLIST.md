# Production Checklist — IQC System

ตรวจให้ครบก่อน/หลัง go-live

## ก่อน Deploy (Security & Config)
- [ ] `.env.production` สร้างแล้ว (จาก `.env.production.example`) และ **ไม่ commit เข้า git**
- [ ] `JWT_SECRET` สุ่มใหม่ ≥ 64 ตัว (`openssl rand -hex 48`) — ไม่ใช่ค่า default/`change-in-production`
- [ ] `APP_URL` = origin จริง (https://โดเมน)
- [ ] `NODE_ENV=production` (เปิด secure cookie, HSTS, trust proxy, ซ่อน error detail)
- [ ] `TZ=Asia/Bangkok`
- [ ] `BCRYPT_ROUNDS=12`
- [ ] ตรวจว่า `IQC_DB_PATH=/data/iqc.db` และ `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`

## Persistence (ห้ามพลาด)
- [ ] volume `iqc_data` (/data) สำหรับ SQLite — **persistent ไม่ใช่ ephemeral**
- [ ] volume `iqc_uploads` (/app/uploads) สำหรับไฟล์แนบ
- [ ] ทดสอบ: restart container แล้ว DB + ไฟล์แนบยังอยู่ (`docker compose restart app`)
- [ ] ตั้ง backup รายวัน (DB ด้วย `.backup`, uploads ด้วย tar) + เก็บนอกเครื่อง 7 วัน
- [ ] ทดสอบ restore จาก backup ได้จริง

### ถ้า deploy บน Render Free tier (ephemeral + restore-on-boot จาก R2 — ดู DEPLOYMENT.md §8.2 แทนหัวข้อบน)
- [ ] `R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET` ตั้งครบใน Render env vars
- [ ] `RESTORE_ON_BOOT=true` ตั้งไว้
- [ ] `TELEGRAM_BOOT_ALERT_TOKEN`/`TELEGRAM_BOOT_ALERT_CHAT_ID` ตั้งไว้ (alert ตอน restore ล้มเหลวก่อน DB พร้อม)
- [ ] Render dashboard **Health Check Path** = `/api/health` (ตั้งแยกจาก Dockerfile `HEALTHCHECK`)
- [ ] **Instance Count = 1 เสมอ** — ไม่เปิด autoscale (SQLite single-writer)
- [ ] ทดสอบ **restore drill**: `node scripts/restore-from-r2.js` กู้ DB จาก R2 สำเร็จจริง
- [ ] ทดสอบ **sleep→wake พร้อมมี write คั่นกลาง** (ไม่ใช่แค่ redeploy) แล้วข้อมูลไม่หาย
- [ ] จำลอง backup ล้มเหลว (เช่น R2 credential ผิดชั่วคราว) → Telegram alert ยิงจริง
- [ ] Keep-alive หลัก (UptimeRobot/cron-job.org, ~5 นาที) ตั้งแล้ว **พร้อมเปิด failure-alert**
- [ ] (optional) `.github/workflows/keep-alive.yml` ตั้ง repo variable `RENDER_APP_URL` แล้ว

## Build / Image
- [ ] `docker compose build` ผ่าน (multi-stage)
- [ ] image รัน non-root (`USER node`) — ตรวจ `docker compose exec app whoami` = `node`
- [ ] better-sqlite3 โหลดได้ (`docker compose exec app node -e "require('better-sqlite3')"`)
- [ ] Chromium รันได้ (`docker compose exec app chromium --version`)
- [ ] ฟอนต์ไทยติดตั้ง (export PDF แล้วหัวภาษาไทยไม่เป็นกล่อง)

## Runtime / Process
- [ ] `dumb-init` เป็น PID 1 (reap zombie Chromium) — ENTRYPOINT ไม่ถูก override
- [ ] `restart: unless-stopped` ตั้งแล้ว
- [ ] graceful shutdown ทำงาน: `docker compose stop app` แล้ว log ขึ้น `[shutdown] ปิดเรียบร้อย`
- [ ] healthcheck = healthy (`docker compose ps`)
- [ ] `stop_grace_period`/`kill_timeout` ≥ 15s
- [ ] memory limit ตั้งเหมาะกับ VPS (เริ่ม 1GB)

## Reverse Proxy / Network
- [ ] nginx proxy → app:3001 ทำงาน (`curl http://localhost/api/health`)
- [ ] `client_max_body_size` ≥ 110m (รองรับไฟล์แนบ 100MB)
- [ ] `/api/sse` ตั้ง `proxy_buffering off` + `proxy_read_timeout` ยาว
- [ ] HTTPS เปิดใช้ (Cloudflare Full / Let's Encrypt) — login ผ่าน https ได้ + cookie ติด
- [ ] (Cloudflare) เปิด `set_real_ip_from` + `real_ip_header CF-Connecting-IP`
- [ ] app **ไม่ publish port ออกตรง** (เข้าผ่าน nginx เท่านั้น) — firewall เปิดเฉพาะ 80/443

## Functional smoke test (หลัง deploy)
- [ ] Login admin + **เปลี่ยนรหัส admin ทันที** (default admin1234)
- [ ] สร้างบิล + อัปโหลดรูป → ไฟล์เข้า /app/uploads
- [ ] เปิด NCR / NCP → flow ครบ
- [ ] Export PDF (NCR/NCP/UAI/บิล) + JPG/Excel สรุปรับเข้า → ได้ไฟล์ + หัวกระดาษ/เลขหน้าถูก
- [ ] Notification กระดิ่ง + Telegram (ถ้าตั้ง) ทำงาน
- [ ] SSE real-time (เปิด 2 แท็บ คนละ action → อัปเดตทันที)
- [ ] Idle/timeout + single-session enforcement ทำงาน

## หลัง go-live
- [ ] ตรวจ `docker stats` — RAM นิ่ง (ไม่ leak) หลัง export หลายครั้ง
- [ ] ตั้ง uptime monitor ยิง `/api/health`
- [ ] เก็บ log / log rotation (`docker compose logs` หรือ driver json-file + max-size)
- [ ] เอกสาร DR (backup/restore) ให้ทีม
