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
