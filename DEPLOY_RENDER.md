# Deploying BookShelf to Render

## 1. Services (both Docker Web Services)

| Service | Type | Notes |
|---|---|---|
| `bookshelf-server` | Web Service (Docker) | Dockerfile Path: `docker/Dockerfile.server`, Docker Build Context Directory: `.` |
| `bookshelf-client` | Web Service (Docker) | Dockerfile Path: `docker/Dockerfile.client`, Docker Build Context Directory: `.` |

Both are deployed as Docker services rather than Render's Node-native runtime or
a Static Site - this reuses the exact Dockerfiles already built and tested for
local `docker compose`, so nginx handles the client↔API proxying the same way
locally and on Render (no Render "Redirects/Rewrites" rules to get right, no
Node-native build-command/start-command scripting). Client and server are still
two independent Render services with separate URLs and no shared internal
network (Render doesn't run `docker-compose.yml` directly) - the client's nginx
reaches the server via its public URL (see `API_UPSTREAM` in §7), not via
Docker Compose's `server:4000` internal DNS name.

## 2. Persistent disks (server only, paid instance types)

- 1 GB at `/app/data` — SQLite DB (`bookshelf.db`) + nightly backups (`data/backups/`)
- 2 GB at `/app/uploads` — book cover images

Attach both before the first deploy; the app creates its own subdirectories on
boot. **Render's Free instance type doesn't support persistent disks at all** -
see §7 for the free-tier alternative (Cloudflare R2 via Litestream), which
works on any instance type including Free.

## 3. Environment variables (server)

Set these in the Render dashboard (see `.env.example` for the full list):

- `NODE_ENV=production`
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` — two different 64-char random strings
- `CLIENT_URL` — the deployed client's URL (`https://...`), used for CORS
- `TELEGRAM_BOT_TOKEN` — optional; leave blank to disable Telegram notifications
- `ADMIN_SEED_EMAIL`, `ADMIN_SEED_PASSWORD` — read by `ensureAdminAccount()`, which
  runs on every boot and creates the admin user (username `admin`) if and only if
  no `admin` username already exists - safe to leave running permanently
- On a paid instance type with a disk attached: `DATABASE_PATH=/app/data/bookshelf.db`,
  `UPLOADS_DIR=/app/uploads`, `BACKUPS_DIR=/app/data/backups`. On Free (no disk),
  leave these three unset - see §7.

## 4. Environment variables (client)

- `API_UPSTREAM` — the server's public URL, e.g. `https://bookshelf-server-xxxx.onrender.com`
  (no trailing slash). Rendered into nginx's config at container start by
  `docker/05-render-api-upstream.sh`; defaults to `http://server:4000` (Docker
  Compose's internal DNS name) when unset, which is only correct for local dev.

## 5. Health check & auto-deploy

- Server health check path: `/api/v1/health`
- Client health check: default (`/`) is fine
- Auto-deploy on push to `master` (or whichever branch each service is configured to track)
- Migrations run automatically on server boot (`runMigrations()` in `src/index.js`) — idempotent, safe to run on every deploy

## 6. Backups

- Nightly cron (`server/src/jobs/backup.job.js`) writes to `/app/data/backups/{daily,weekly}`
  — only meaningful with a persistent disk (§2); on Free tier (§7), Litestream's
  continuous replication to R2 is the actual backup mechanism instead
- Manual run: `npm run backup` (inside the server container/shell)
- Test notifications end-to-end with `SEND_TEST_NOTIFICATION=true`

## 7. Region

Singapore or Frankfurt — whichever measures lower latency to your users; test both if serving a mixed TH/international team.

## 8. Free-tier deployment (no persistent disk)

Render's **Free** instance type doesn't support persistent disks at all - anything
written to local disk is wiped on every restart, redeploy, or sleep/wake cycle
(free services sleep after 15 min of inactivity).

**Database**: `server/litestream.yml` + [Litestream](https://litestream.io) (baked
into `docker/Dockerfile.server`, no extra setup needed) continuously stream the
DB's WAL to a private Cloudflare R2 bucket, restoring the latest snapshot back to
local disk before the app starts each time. `docker/server-entrypoint.sh` only
runs Litestream when `R2_BUCKET`/`R2_ENDPOINT`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`
are all set - unset (local Docker dev), it just runs `node src/index.js` directly.

**Cover images**: plain files, not part of the SQLite db, so Litestream doesn't
cover them - `server/src/services/image.service.js` instead uploads covers
directly to a second, *public* R2 bucket when `R2_UPLOADS_BUCKET` + `R2_PUBLIC_URL`
are set, falling back to local disk when they're not (normal for local/Docker dev).
Both buckets can live under the same Cloudflare account/API token.

**Nightly backups**: `server/src/jobs/backup.job.js` runs at midnight server time,
writing a dated snapshot to local disk (`BACKUPS_DIR`, keeping the last 7 daily +
4 weekly) and, when `R2_BUCKET` is set, also uploading it to that same private
bucket under a `backups/` prefix - separate from Litestream's own replica data -
keeping only the most recent 7 there too.

Setup:

1. Create two free Cloudflare R2 buckets + an API token (R2 dashboard → **Manage API
   tokens** → create a token scoped to both buckets):
   - one private bucket for the Litestream DB replica (e.g. `bookshelf-litestream`)
   - one bucket for cover images (e.g. `bookshelf-uploads`) with **public access**
     enabled (bucket **Settings → Public Access → Allow Access** via the r2.dev
     subdomain) - note the public `https://pub-<hash>.r2.dev` URL it gives you

   Note the Access Key ID, Secret Access Key, and the account's S3 endpoint
   (`https://<account_id>.r2.cloudflarestorage.com`, same for both buckets).
2. Add these env vars on the **server** service in Render: `R2_BUCKET` (Litestream's
   bucket), `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
   `R2_UPLOADS_BUCKET` (the public bucket), `R2_PUBLIC_URL` (its `pub-<hash>.r2.dev`
   URL). Leave `DATABASE_PATH`/`UPLOADS_DIR`/`BACKUPS_DIR` unset so they default to
   relative paths under the project directory.
3. That's it for Build/Start Commands - Docker deploys use the Dockerfile's own
   `CMD` (`docker/server-entrypoint.sh`), no Render Settings changes needed.

## 9. Post-deploy checklist

See `CLAUDE.md` §15 for the full production checklist (secrets rotated, admin password changed after first login, Telegram bot added to expected chats, load test, etc.).
