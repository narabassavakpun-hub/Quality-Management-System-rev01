> 📁 **IPQC/FQC module doc** — deploy ทั้งระบบ (canonical) ดู [`../DEPLOYMENT.md`](../DEPLOYMENT.md) + [`../PRODUCTION_CHECKLIST.md`](../PRODUCTION_CHECKLIST.md) · [index](README.md)

# Deployment — IPQC/FQC Module

The IPQC/FQC module ships inside the same app as the IQC system — no separate service. These notes cover what the module adds to an existing deploy.

## 1. Run modes

### Local dev
```
cd server && npm install && npm run dev      # nodemon, port 3001, DB at server/../iqc.db
cd client && npm install && npm run dev       # Vite dev server, proxies /api → 3001
```

### Production (Docker — existing setup)
```
docker compose up -d --build
```
- Multi-stage [Dockerfile](../Dockerfile): builds client → `dist`, compiles `better-sqlite3`, runs `node index.js`.
- `IQC_DB_PATH=/data/iqc.db` on the `iqc_data` volume (SQLite + WAL must be on persistent storage, never ephemeral).
- nginx reverse-proxy in front; healthcheck hits `/api/health`.

### Production (bare)
```
cd client && npm ci && npm run build          # → client/dist (served by Express in prod)
cd server && npm ci --omit=dev && NODE_ENV=production node index.js
```

## 2. Environment variables (`.env`)
```
NODE_ENV=production
PORT=3001
JWT_SECRET=            # random 64+ chars (required)
IQC_DB_PATH=/data/iqc.db   # optional override; default server/../iqc.db
TZ=Asia/Bangkok        # affects "today" in IPQC/FQC summaries + date windows
```
Telegram tokens/groups are stored in the `settings` table via `/admin/settings`, not env.

## 3. Schema migration on boot (automatic, zero-downtime-safe)
`database.js` runs on every start, idempotently:
```
initSchema()      # CREATE TABLE IF NOT EXISTS — adds the 16 IPQC/FQC tables on first boot
migrate.init()    # migration ledger
runMigrations()   # safeAddColumn / table rebuilds (existing IQC)
seedData()        # seeds IPQC+FQC sequences, FM categories, shifts, 12 process steps, 3% threshold
syncSequences()
```
No manual migration step. Deploying this module onto an existing DB just creates the new tables + seeds on first start; existing data untouched.

## 4. First-run checklist (admin)
1. Log in as `admin`, change the default password.
2. `/admin/production-master` → create production lines (set `factory_code` + `pdplan_sheet`), assign production managers, add defect types.
3. `/admin/procode-sap` → import a Planning Excel, then confirm classified SAP codes.
4. (optional) adjust defect-rate thresholds per line/product.
5. QC staff can now file IPQC/FQC from `/ipqc` and `/fqc`.

## 5. Uploads
Images go to `/uploads/ipqc/` and `/uploads/fqc/`. In Docker, mount/persist `uploads` (same volume strategy as the DB). Max 15 images/record, 15 MB each, auto-compressed.

## 6. Backup
```
cd server && npm run backup        # scripts/backup-db.js — SQLite .backup
# recommended cron: 0 2 * * *  (keep 7 rotating)
```
WAL mode: back up `iqc.db` with the SQLite backup API (the npm script), not a raw file copy.

## 7. Rate limits to be aware of
- global `/api`: 200/min; exports `/api/{ipqc,fqc}/export`: 5/min; login: 5/15min.
Behind a proxy, ensure `X-Forwarded-For` is trusted so per-IP limits and `req.ip` (audit) are correct.
