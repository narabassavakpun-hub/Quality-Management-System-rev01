# IQC System — Production Deployment Guide

คู่มือ deploy ระบบ IQC ขึ้น production ด้วย Docker (แนะนำ) หรือ PM2 บน VPS

---

## 1. สถาปัตยกรรม (Architecture)

```
                 (HTTPS)                         (HTTP, internal network)
Browser ───► Cloudflare ───► nginx (reverse proxy) ───► app (Node :3001)
                              - TLS / gzip / body 110MB        ├─ Express API (/api/*)
                              - SSE buffering off              ├─ เสิร์ฟ SPA (client/dist)
                              - real client IP                 ├─ เสิร์ฟ /uploads
                                                               ├─ SQLite (better-sqlite3, WAL)  → volume /data
                                                               ├─ Chromium singleton (PDF/JPG)  → /usr/bin/chromium
                                                               └─ uploads                        → volume /app/uploads
```

- **single origin**: Node เสิร์ฟทั้ง SPA + API + ไฟล์แนบ → frontend เรียก `/api` แบบ relative (ไม่มีปัญหา CORS/cookie)
- **stateful**: SQLite + uploads ต้องอยู่บน **named volume / persistent disk** เท่านั้น (ห้าม ephemeral) —
  ยกเว้น deployment ที่เลือกใช้ restore-on-boot จาก Cloudflare R2 แทนโดยตั้งใจ (Render Free tier, ดู §8.2)
- **1 instance เท่านั้น**: SQLite (single-writer), SSE (in-memory), Chromium singleton → **scale แนวนอนไม่ได้** จนกว่าจะย้ายไป Postgres + Redis (ดูข้อ 9)

---

## 2. สิ่งที่ต้องมี (Prerequisites)

- Ubuntu VPS (≥ 2 vCPU / 2 GB RAM แนะนำ — Chromium กิน RAM ตอน export)
- Docker Engine + Docker Compose plugin
  ```bash
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker $USER   # logout/login ใหม่
  ```
- โดเมน + (ทางเลือก) Cloudflare

---

## 3. Deploy ด้วย Docker Compose (แนะนำ)

```bash
# 1) ดึงโค้ดขึ้น server
git clone <repo> && cd <repo>/iqc-system

# 2) ตั้งค่า env
cp .env.production.example .env.production
nano .env.production           # ตั้ง JWT_SECRET (openssl rand -hex 48), APP_URL=https://โดเมนจริง

# 3) build + start
docker compose up -d --build

# 4) ตรวจสถานะ
docker compose ps             # app ต้องเป็น healthy
docker compose logs -f app
curl -fsS http://localhost/api/health
```

ครั้งแรก ระบบจะสร้าง schema + seed admin อัตโนมัติ (user: `admin` / pass: `admin1234`)
→ **เปลี่ยนรหัส admin ทันที** หลัง login

### โครงสร้างไฟล์ที่เพิ่ม
```
iqc-system/
├── Dockerfile                  # multi-stage (client build / server deps / runtime)
├── .dockerignore
├── docker-compose.yml          # app + nginx + volumes
├── .env.production.example
├── ecosystem.config.js         # PM2 (ทางเลือกสำหรับ deploy ตรงบน VPS)
└── nginx/
    ├── nginx.conf
    ├── certs/                  # (ใส่ fullchain.pem + privkey.pem ถ้าใช้ TLS ที่ nginx)
    └── www/                    # (ACME webroot ถ้าใช้ certbot)
```

---

## 4. Environment Variables

| ตัวแปร | จำเป็น | ค่า/หมายเหตุ |
|--------|:---:|------|
| `JWT_SECRET` | ✅ | สุ่ม ≥ 64 ตัว (`openssl rand -hex 48`) — ถ้าอ่อน server จะ **ไม่ start** |
| `APP_URL` | ✅ | origin จริง เช่น `https://iqc.example.com` (ใช้กับ CORS) |
| `NODE_ENV` | ✅ | `production` (เปิด secure cookie / HSTS / trust proxy) |
| `PORT` | – | default 3001 |
| `TZ` | – | `Asia/Bangkok` (ตั้งใน image แล้ว) |
| `BCRYPT_ROUNDS` | – | default 12 |
| `IQC_DB_PATH` | ✅(prod) | `/data/iqc.db` (บน volume) |
| `PUPPETEER_EXECUTABLE_PATH` | ✅(prod) | `/usr/bin/chromium` |

> Telegram (bot token / กลุ่ม) ตั้งในแอปที่ **Admin → Settings** (เก็บใน DB) — ไม่ใช่ env

---

## 5. Persistence & Backup

Volumes (สร้างอัตโนมัติโดย compose):
- `iqc_data` → `/data` : `iqc.db`, `iqc.db-wal`, `iqc.db-shm`
- `iqc_uploads` → `/app/uploads` : ไฟล์แนบทั้งหมด

### Backup (SQLite แบบปลอดภัยขณะรันอยู่ — ใช้ .backup ไม่ใช่ cp)
```bash
# DB (online backup — รวม WAL ให้อัตโนมัติ)
docker compose exec app node -e "require('better-sqlite3')('/data/iqc.db').backup('/data/backup-'+Date.now()+'.db').then(()=>process.exit(0))"

# คัดลอกออกมาเก็บนอกเครื่อง
docker run --rm -v iqc-system_iqc_data:/data -v $PWD:/out alpine \
  sh -c "cp /data/backup-*.db /out/ && cp -r /data /out/data-snapshot || true"

# uploads
docker run --rm -v iqc-system_iqc_uploads:/u -v $PWD:/out alpine \
  tar czf /out/uploads-$(date +%F).tar.gz -C /u .
```
ตั้ง cron รายวันเก็บ rotating 7 วัน (ดู `server/scripts/backup-db.js` ที่มีอยู่)

### Restore
```bash
docker compose down
docker run --rm -v iqc-system_iqc_data:/data -v $PWD:/in alpine sh -c "cp /in/backup-XXXX.db /data/iqc.db && rm -f /data/iqc.db-wal /data/iqc.db-shm"
docker compose up -d
```

---

## 6. TLS / HTTPS

### ตัวเลือก A — Cloudflare (ง่ายสุด)
1. ชี้ DNS A record → IP ของ VPS, เปิด proxy (เมฆส้ม)
2. SSL/TLS mode = **Full** (แนะนำ) หรือ Flexible
3. nginx รันที่ :80 (ค่าเริ่มต้น) — Cloudflare ทำ TLS ที่ edge
4. (Full mode) ออก **Origin Certificate** จาก Cloudflare → วางใน `nginx/certs/` แล้ว uncomment บล็อก 443 ใน `nginx.conf`
5. uncomment ส่วน `set_real_ip_from` (Cloudflare ranges) ใน `nginx.conf` เพื่อให้ได้ IP จริง

### ตัวเลือก B — Let's Encrypt ที่ nginx
```bash
# ออก cert ด้วย certbot (webroot ใช้โฟลเดอร์ nginx/www)
docker run --rm -v $PWD/nginx/certs:/etc/letsencrypt -v $PWD/nginx/www:/var/www/certbot \
  certbot/certbot certonly --webroot -w /var/www/certbot -d your-domain.com
# คัดลอก fullchain.pem + privkey.pem ไป nginx/certs/ แล้ว uncomment บล็อก 443 + reload
docker compose exec nginx nginx -s reload
```

---

## 7. การอัปเดต (Redeploy)
```bash
git pull
docker compose up -d --build      # rebuild เฉพาะ layer ที่เปลี่ยน (cache)
docker image prune -f
```
ตอน stop docker จะส่ง SIGTERM → ระบบ **graceful shutdown** (ปิด SSE, ปิด Chromium, flush WAL) ภายใน 20s

---

## 8. Render.com (ทางเลือก PaaS — ไม่ใช้ docker-compose)

Render รัน 1 container จาก Dockerfile + ให้ TLS/proxy เอง (ไม่ต้องใช้ nginx) — มี 2 ทางเลือกตาม budget:

### 8.1 Starter+ ผูก Persistent Disk (แนะนำ — ไม่มี data-loss window)

1. New → **Web Service** → เลือก repo, Root Directory = `iqc-system`, Runtime = **Docker**, Plan = **Starter ขึ้นไป**
2. เพิ่ม **Disk** (persistent):
   - Mount `/data` (สำหรับ SQLite) — ขนาดตามต้องการ
   - Mount `/app/uploads` (สำหรับไฟล์แนบ) *(Render รองรับ disk เดียวต่อ service — ดูหมายเหตุ)*
3. Environment: ตั้ง `JWT_SECRET`, `APP_URL=https://<service>.onrender.com`, `NODE_ENV=production`, `IQC_DB_PATH=/data/iqc.db`, `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`, `TZ=Asia/Bangkok`, `RESTORE_ON_BOOT=false` (หรือปล่อยว่าง — มี disk จริงแล้วไม่ต้องใช้)
4. Health Check Path (ตั้งใน Render dashboard — **คนละจุดกับ Dockerfile `HEALTHCHECK`**) = `/api/health`
5. Starter ขึ้นไปไม่ sleep — ไม่ต้องตั้ง keep-alive ping (ข้าม §8.2)

> หมายเหตุ Render มี disk ได้หลายตัวต่อ service (ตรวจแพลนปัจจุบัน) — ถ้าได้ disk เดียว ให้ตั้ง `IQC_DB_PATH=/data/db/iqc.db` และย้าย uploads ไปใต้ `/data/uploads` โดยอาจ symlink `ln -s /data/uploads /app/uploads` ใน entrypoint (หรือ mount disk ที่ `/data` แล้วเก็บทั้งสองใต้ `/data`)

### 8.2 Free tier + restore-on-boot จาก Cloudflare R2 (ทางเลือกที่เลือกใช้จริง — งบ $0, มี data-loss window ที่ยอมรับได้)

⚠️ **Deliberate exception ต่อกฎ "SQLite ต้องอยู่บน volume เท่านั้น ห้าม ephemeral" ด้านบน** — Free tier ของ
Render ไม่มี persistent Disk เลย ตกลงกับ user แล้วให้ใช้แนวทางนี้แทน (ตัดสินใจเมื่อรู้ tradeoff ครบแล้ว):
เก็บ DB/uploads บน ephemeral disk ของ container ตามปกติ แต่ sync ไป Cloudflare R2 อัตโนมัติ แล้ว**กู้กลับมาเอง
ตอน boot** ถ้า container เป็นตัวใหม่ (fresh ephemeral filesystem)

**RPO (ข้อมูลสูญเสียได้มากสุด) ~10 นาที ไม่ใช่ ~24 ชม.** — เหตุผล: container ephemeral หายได้จากหลายทางไม่ใช่แค่
redeploy (sleep/wake หลัง idle 15 นาที, Render maintenance restart, OOM-kill จาก Chromium ตอน export PDF) ซึ่ง
เกิดบ่อยกว่า redeploy มาก สำหรับ internal tool ที่มีคนใช้งานทั้งวัน จึงต้อง backup รอบถี่ (~10 นาที) ไม่ใช่แค่วันละครั้ง
— ดู `server/lib/backupService.js`

**สถาปัตยกรรม:**
- `server/lib/r2Client.js` — S3-compatible client คุยกับ R2
- `server/lib/backupService.js` — snapshot DB (VACUUM INTO + `PRAGMA quick_check`) ทุก ~10 นาที ขึ้น
  `backups/db/latest.db` (RPO หลัก) + ทุกวัน (ครั้งแรกของวัน) ขึ้น `backups/db/day-N.db` (N=0..6 ตามวันในสัปดาห์
  Asia/Bangkok — คือ FIFO 7 ไฟล์ที่ผู้ใช้ต้องการเป๊ะๆ: วันที่ 8 = สัปดาห์ถัดไป วันเดียวกัน จะทับ slot เดิมของมันเอง
  โดยธรรมชาติ ไม่ต้องมี counter) + sync ไฟล์แนบใหม่/เปลี่ยนแปลงไป `backups/uploads/**` แบบ incremental (ไม่ tar
  ทั้งโฟลเดอร์ทุกรอบ — กันไฟล์โตไม่จบ) — เขียน `backups/manifest.json` "หลังสุด" เสมอ (หลัง object อัปโหลดสำเร็จ)
- `server/bootstrap.js` — container entrypoint ใหม่ (Dockerfile `CMD`) — ถ้า `RESTORE_ON_BOOT=true` และ DB local
  ที่ `IQC_DB_PATH` ไม่มี/ว่างเปล่า จะดาวน์โหลด backup ที่ fresh สุดจาก R2 มาก่อน (verify ขนาด + `quick_check`
  ก่อน rename เข้าที่จริงแบบ atomic) แล้วค่อย `require('./index.js')` ต่อ — no-op ถ้าไม่ได้ตั้ง flag นี้
- **ไฟล์แนบ (uploads) ไม่ eager-restore ตอน boot** — ใช้ lazy fetch-through แทน (`/uploads` middleware ใน
  `index.js` จะดึงจาก R2 อัตโนมัติถ้าไม่เจอไฟล์ local แล้ว cache ไว้) กัน cold-start ช้าลงเรื่อยๆ ตามขนาด uploads
  ที่โตขึ้นเรื่อยๆ ตามอายุระบบ
- `runHotBackup()` ยังถูกเรียกใน SIGTERM shutdown handler (`index.js`) ก่อน `db.close()` ด้วย — ปิดช่องว่างของ
  redeploy/graceful-restart ให้เกือบ real-time (ไม่ต้องรอรอบ 10 นาทีถัดไป)

**ขั้นตอน setup:**
1. **Cloudflare R2**: สร้าง bucket (เช่น `qms-iqc-backups`) → สร้าง API token ขอบเขตเฉพาะ bucket นี้ (Object Read
   & Write) → จด Account ID / Access Key ID / Secret Access Key
2. **Render**: New Web Service → Docker, Root Directory `iqc-system`, Plan = **Free**, **Instance Count = 1
   เสมอ ห้าม autoscale** (SQLite single-writer + SSE client เก็บใน memory + Chromium singleton ต่อ process —
   ดู §9) — ตั้ง env vars: ค่าพื้นฐานเหมือน §8.1 บวก `R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/
   `R2_BUCKET`/`RESTORE_ON_BOOT=true`/`TELEGRAM_BOOT_ALERT_TOKEN`/`TELEGRAM_BOOT_ALERT_CHAT_ID` (ดู
   `.env.production.example`) — ตั้ง Health Check Path = `/api/health` ใน Render dashboard (คนละจุดกับ
   Dockerfile `HEALTHCHECK`)
3. **Keep-alive หลัก (สำคัญ — ต้องมี failure-alert ในตัว)**: สมัคร UptimeRobot หรือ cron-job.org (ฟรี) ยิง
   `/api/health` ทุก ~5 นาที **เปิดแจ้งเตือนเมื่อ ping ล้มเหลวด้วย** — เพราะถ้า keep-alive เองหยุดทำงานเงียบๆ
   ทั้ง app (รวม Telegram alert ที่อยู่ใน process เดียวกัน) ก็จะไม่ทำงานไปด้วย ต้องมีตัวเฝ้านอก process
4. **Keep-alive สำรอง** (optional): `.github/workflows/keep-alive.yml` (ตั้ง repo variable `RENDER_APP_URL`
   ก่อนใช้) — GitHub Actions schedule อาจถูก delay ได้เวลา platform โหลดสูง (GitHub เอกสารเอง) จึงเป็นแค่ตัวเสริม
   ไม่ใช่ตัวหลัก

**Checklist ก่อนใช้งานจริง** (เพิ่มจาก `PRODUCTION_CHECKLIST.md`):
- ทดสอบ **restore drill**: `node scripts/restore-from-r2.js` กู้ DB จริงจาก R2 มาทดสอบได้ถูกต้อง
- ทดสอบ **sleep→wake พร้อมมี write คั่นกลาง** (ไม่ใช่แค่ redeploy เฉยๆ) — sleep ทิ้งไว้ → wake → สร้างข้อมูล
  ทดสอบ → รอ ~10-15 นาทีให้ hot-backup รอบถัดไปทำงาน → sleep/redeploy อีกรอบ → ยืนยันข้อมูลที่สร้างไว้ยังอยู่
- จำลอง backup ล้มเหลว (เช่น ใส่ R2 credential ผิดชั่วคราว) → ยืนยัน Telegram alert ยิงจริง
- ยืนยัน UptimeRobot/cron-job.org ping ผ่านจริง + alert เมื่อ ping ล้มเหลวทำงานจริง (ลองชี้ไป URL ผิดชั่วคราว)

---

## 9. Scaling & Future PostgreSQL

ตอนนี้ผูกกับ **1 instance** เพราะ:
- SQLite = single-writer/ไฟล์เดียว
- SSE = เก็บ client ใน memory (`sseClients` Map)
- Chromium singleton = ต่อ process

**เมื่อต้อง scale หลาย instance:**
1. ย้าย DB → PostgreSQL: ชั้น data access อยู่ที่ `server/db/*` + `db.prepare(...)` ทั่วโค้ด → ต้องเปลี่ยนเป็น query layer ที่รองรับ pg (เช่น Kysely/Knex) แล้ว map prepared statements; ย้ายข้อมูลด้วย ETL จาก SQLite
2. SSE → ใช้ Redis pub/sub broadcast ข้าม instance (มีหมายเหตุไว้แล้วใน `index.js`)
3. uploads → ย้ายไป object storage (S3/R2) แทน local volume
4. แยก PDF worker (Chromium) ออกเป็น service ของตัวเอง

จนกว่าจะทำข้างบน: **vertical scale** (เพิ่ม RAM/CPU) เท่านั้น

---

## 10. Monitoring / Logs / Healthcheck
```bash
docker compose logs -f app          # log แอป
docker compose ps                   # สถานะ + health
docker stats iqc-app                # RAM/CPU realtime
curl -fsS https://โดเมน/api/health  # {"status":"ok",...}
```
- Healthcheck เช็ค `/api/health` (query DB จริง) ทุก 30s → ถ้า fail 3 ครั้ง Docker mark unhealthy
- `restart: unless-stopped` → แอป crash จะถูก restart อัตโนมัติ

---

## 11. Troubleshooting

| อาการ | สาเหตุ/วิธีแก้ |
|------|----------------|
| Export PDF/JPG พัง / `Failed to launch chromium` | ตรวจ `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium` มีจริงใน container (`docker compose exec app chromium --version`) |
| ตัวอักษรไทยในหัว PDF เป็นกล่อง | ฟอนต์ไทยไม่ติดตั้ง → image มี `fonts-thai-tlwg` แล้ว; ถ้า build เอง ตรวจ stage runtime |
| PDF ค้าง/timeout | RAM ไม่พอ → เพิ่ม memory limit; ตรวจ `shm_size`/`--disable-dev-shm-usage` |
| SSE ไม่ real-time | nginx ต้อง `proxy_buffering off` ที่ `/api/sse` (มีในไฟล์แล้ว); Cloudflare อาจ buffer — ใช้ได้แต่หน่วงเล็กน้อย |
| `secure cookie` login ไม่ติด | ต้องเข้าผ่าน **https** + `NODE_ENV=production` + `trust proxy` (ตั้งไว้แล้ว) |
| DB locked / WAL | SQLite busy_timeout 5s ตั้งไว้แล้ว; อย่ารันหลาย instance เขียน DB เดียวกัน |
| ไฟล์อัปโหลดหาย หลัง redeploy | ต้องใช้ volume `iqc_uploads` (อย่าลบ volume ตอน `docker compose down -v`) |
| Chromium zombie process | `dumb-init` เป็น PID 1 reap ให้แล้ว — ตรวจว่า ENTRYPOINT ไม่ถูก override |

> ⚠️ `docker compose down -v` จะ **ลบ volume (DB + uploads)** — อย่าใช้ใน production
