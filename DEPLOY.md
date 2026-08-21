# Deploying Construction ERP

Everything runs on **one server** with Docker: the web app, the background
worker (reminders, day-close, audits, AI), the photogrammetry/LiDAR scan engine,
PostgreSQL, and Caddy (automatic HTTPS). This is the simplest setup that keeps
**every feature** working.

- Your data (database + uploaded photos) lives on the server on Docker volumes.
- HTTPS is automatic and free via Caddy + Let's Encrypt — needed for push
  notifications and the installable app.

---

## 1. Create the server

Any provider works. Pick **Ubuntu 22.04**, **8 GB RAM / 4 vCPU**, an India
region, and add your SSH key.

| Provider | Region | Note |
|---|---|---|
| DigitalOcean | Bangalore | Easiest console; recommended |
| Linode / Akamai | Mumbai | Similar to DO |
| E2E Networks | India | Indian company, INR + GST invoice |
| AWS Lightsail | Mumbai | 2 vCPU tiers — scans slower |
| Hetzner | EU (no India) | Cheapest, ~130 ms further |

A 2 vCPU / 4 GB box also works for a pilot — scans just take longer.

Note the server's **public IP** (e.g. `203.0.113.10`).

---

## 2. Choose your URL — two options, both give real HTTPS

You set one value, `APP_HOST`, either way. Caddy fetches the certificate
automatically once DNS points at the server.

### Option A — Free URL (start here, zero cost, instant)
Use **sslip.io**, which needs no signup: your host is simply

```
<server-ip>.sslip.io      e.g.  203.0.113.10.sslip.io
```

(Or make a free name at https://duckdns.org → `yoursite.duckdns.org`.)

### Option B — Your own purchased domain
In your domain registrar's DNS settings, add an **A record**:

```
Type: A     Name: erp   (or @ for the root)     Value: <server-ip>
```

Your host becomes `erp.yourcompany.com`. DNS usually resolves within minutes.

> **Switching later** (free → your domain, or changing domain): edit `APP_HOST`
> in `.env`, then run `docker compose -f docker-compose.prod.yml up -d caddy`.
> Caddy fetches the new certificate automatically.

---

## 3. Install and start (one command)

SSH into the server, then:

```bash
# Install git, clone the repo, run the bootstrap.
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/constructionking/construction-erp.git /opt/construction-erp
cd /opt/construction-erp
sudo bash setup.sh
```

`setup.sh` installs Docker, generates all secrets (`AUTH_SECRET`, database
password, VAPID push keys), asks for your `APP_HOST`, and starts everything.
The first build takes several minutes.

---

## 4. Create your owner login

```bash
docker compose -f docker-compose.prod.yml run --rm worker \
  pnpm tsx scripts/bootstrap-owner.ts
```

Enter your name, email and a strong password (min 10 characters). This is the
only account created from the command line — everyone else you add from inside
the app.

---

## 5. You're live

Open **`https://<your-APP_HOST>`**, sign in, and add sites, engineers, accounts
users and schedules. Push notifications, LiDAR scans, AI estimates, day-close,
audits and the 6 pm reminder all run automatically.

Verify quickly:
```bash
curl https://<your-APP_HOST>/api/health      # -> {"status":"ok","db":"up"}
docker compose -f docker-compose.prod.yml ps  # all services "running"/"healthy"
```

---

## Backups & data safety

> ⚠️ **On-server storage caveat.** Your photos and database live on this one
> server. **If the server is destroyed and you have no off-server copy, data
> since your last off-server backup is lost.** Do all three of the following.

**1. Nightly on-box backup (built in).** Schedule it with cron:
```bash
crontab -e
# add:
0 2 * * * cd /opt/construction-erp && ./scripts/backup.sh >> /var/log/erp-backup.log 2>&1
```
Backups (14-day retention) land in `/opt/construction-erp/backups`.

**2. Provider VM snapshots.** In your provider console, enable weekly automatic
snapshots (~₹400/mo, one checkbox). This is your whole-server safety net.

**3. Off-box copy (recommended).** Periodically download the `backups/` folder
to your laptop, or copy it to another location.

**Restore / verify recoverability** (safe — uses a scratch database):
```bash
./scripts/restore.sh ./backups/db-YYYYmmdd-HHMMSS.sql.gz
```
Full disaster recovery (overwrites live data): add `--into-prod` and pass the
storage archive too. See the header of `scripts/restore.sh`.

---

## Later: move photos to cloud storage (Cloudflare R2)

When you want true durability for uploads, move them to Cloudflare R2 (cheap, no
egress fees). **I'll walk you through this and re-flag the caveats when you're
ready.** Outline:

1. Create an R2 bucket + API token; put the credentials in `.env` (keep
   `STORAGE_DRIVER=local` for now).
2. Copy existing files up:
   ```bash
   docker compose -f docker-compose.prod.yml run --rm worker \
     pnpm tsx scripts/migrate-storage-to-r2.ts --dry-run   # preview
   docker compose -f docker-compose.prod.yml run --rm worker \
     pnpm tsx scripts/migrate-storage-to-r2.ts             # real copy
   ```
3. Set `STORAGE_DRIVER=s3` in `.env`, then
   `docker compose -f docker-compose.prod.yml up -d web worker`.
4. Confirm a photo loads, **then** keep the local copy as a backup for a while.

---

## Updating the app

- **Manual:** `cd /opt/construction-erp && git pull && docker compose -f docker-compose.prod.yml up -d --build`
- **Automatic (optional):** the included `.github/workflows/deploy.yml` deploys
  on every push to your deploy branch. Add the `DEPLOY_HOST`, `DEPLOY_USER`,
  `DEPLOY_SSH_KEY`, `DEPLOY_PATH` repo secrets to enable it.

Migrations (including the immutability triggers) are applied automatically on
every start by the compose `migrate` service — no manual step.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Certificate not issued | DNS must point at the server and ports **80 + 443** must be open. Check: `docker compose -f docker-compose.prod.yml logs caddy` |
| `/api/health` not ok | `docker compose -f docker-compose.prod.yml logs web postgres` |
| Push not working | Needs HTTPS (works on sslip.io/DuckDNS/your domain) and VAPID keys in `.env` (setup.sh generates them). |
| Scans stuck | `docker compose -f docker-compose.prod.yml logs worker-photogrammetry`; scans are CPU-heavy (5–15 min). |
| Reminders/day-close not firing | `docker compose -f docker-compose.prod.yml logs worker` — should list the active queues on start. |
| Out of disk | `docker system prune -f`; check `backups/` size and retention. |
