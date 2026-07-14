# ============================================================================
# IQC System — Production Dockerfile (multi-stage)
# Base: Debian bookworm-slim (glibc) — จำเป็นสำหรับ Chromium + better-sqlite3
#   (Alpine/musl ใช้กับ Chromium ของ puppeteer ไม่ได้)
# ============================================================================

# ---------- Stage 1: build frontend (React + Vite) ----------
FROM node:22-bookworm-slim AS client-build
WORKDIR /build/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build
# ผลลัพธ์: /build/client/dist

# ---------- Stage 2: build backend deps (native better-sqlite3) ----------
FROM node:22-bookworm-slim AS server-deps
WORKDIR /build/server
# build tools สำหรับ compile better-sqlite3
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY server/package*.json ./
# ข้ามการดาวน์โหลด Chromium ของ puppeteer (จะใช้ Chromium ของระบบใน runtime แทน → image เล็กลง/เร็วขึ้น)
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    npm_config_build_from_source=false
RUN npm ci --omit=dev && npm cache clean --force

# ---------- Stage 3: runtime ----------
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3001 \
    TZ=Asia/Bangkok \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PUPPETEER_SKIP_DOWNLOAD=true \
    IQC_DB_PATH=/data/iqc.db

# Chromium + ฟอนต์ไทย/ลาติน + tzdata + dumb-init (reaper สำหรับ zombie ของ Chromium) + ffmpeg (บีบอัดวิดีโอ
# Issue Talk ผ่าน fluent-ffmpeg — เฉพาะ runtime stage เท่านั้น ไม่ต้องมีตอน build)
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      ffmpeg \
      fonts-thai-tlwg fonts-liberation fonts-dejavu-core \
      ca-certificates tzdata dumb-init \
    && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo "$TZ" > /etc/timezone \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# โค้ด backend + node_modules (native module ที่ compile ไว้แล้วจาก stage 2)
COPY --chown=node:node server/ /app/server/
COPY --from=server-deps --chown=node:node /build/server/node_modules /app/server/node_modules
# frontend ที่ build แล้ว (server เสิร์ฟจาก ../client/dist)
COPY --from=client-build --chown=node:node /build/client/dist /app/client/dist

# โฟลเดอร์ persistence (จะถูก override ด้วย volume) — ต้องให้ user node เขียนได้
RUN mkdir -p /app/uploads /data && chown -R node:node /app/uploads /data

USER node
WORKDIR /app/server
EXPOSE 3001

# Healthcheck (ไม่ต้องพึ่ง curl — ใช้ node http ในตัว)
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# dumb-init เป็น PID 1 → forward signal (SIGTERM ถึง node = graceful shutdown) + reap zombie Chromium
ENTRYPOINT ["dumb-init", "--"]
# bootstrap.js = restore-on-boot (เฉพาะ deployment ที่ตั้ง RESTORE_ON_BOOT=true เช่น Render free tier ที่ไม่มี
# persistent disk — ดู DEPLOYMENT.md) แล้วค่อย require('./index.js') ต่อ — no-op ถ้าไม่ได้ตั้งค่านี้
CMD ["node", "bootstrap.js"]
