# Deploying Hoteldesk (SLDT Stay Inn)

Production architecture:

```
  sldtstayinn.com / www   ──▶  Vercel Pro          ──▶  web (Vite static build)
  api.sldtstayinn.com     ──▶  Hostinger VPS       ──▶  nginx (HTTPS) ──▶ Docker container :3000  ──▶ API
                                                                  │
                                          Supabase (Postgres + Auth)  +  Upstash (Redis)
```

- **Web** → Vercel Pro (static SPA).
- **API** → Hostinger VPS, running as a Docker container, fronted by nginx which terminates HTTPS.
- **Database / Auth** → the existing Supabase project (reused for production).
- **Redis** → the existing Upstash instance (reused for production).

Only the **API** and the **web bundle** are deployed by you. The data layer is already cloud-hosted.

---

## 0. One-time prerequisites

- A domain `sldtstayinn.com` you control DNS for.
- Hostinger VPS with SSH access and a public IP (call it `VPS_IP`).
- Vercel Pro account, GitHub repo connected.
- The two production env files filled in (see step 1).

---

## 1. Fill the production env files

Two git-ignored files hold real values. They were pre-filled with the reused
Supabase/Upstash credentials — you only need to confirm/replace a few fields.

### `apps/api/.env.production`
Open it and replace:
- `SEED_ADMIN_PASSWORD` → a strong password (only used if you re-seed; the
  admin already exists in the DB, so this is low-stakes).
- `TWILIO_WHATSAPP_FROM` → your **approved** WhatsApp Business sender.
  If WhatsApp isn't approved yet, instead set `NOTIFICATIONS_PROVIDER=stub`
  to keep messaging disabled — the app works fine without it.

Everything else (DB, Supabase, Upstash, encryption key, `FRONTEND_URL`) is
already correct for the reused-infra setup. **Do not regenerate
`ENCRYPTION_KEY`** — it must match the key that encrypted data already in
the DB, or KYC fields become unreadable.

### `apps/web/.env.production`
Already set: `VITE_API_URL=https://api.sldtstayinn.com/api/v1`, Supabase URL +
anon key, `VITE_UI_PREVIEW=false`. Nothing to change unless the API subdomain
differs.

> The web build on Vercel does **not** read this local file — see step 4 for
> setting the same keys in the Vercel dashboard. This local file is only used
> by a local `npm run build`.

---

## 2. DNS records

In your domain registrar / DNS provider, add:

| Type  | Name  | Value                         | Purpose                |
|-------|-------|-------------------------------|------------------------|
| A     | `api` | `VPS_IP`                      | API → Hostinger VPS    |
| A     | `@`   | `76.76.21.21`                 | apex → Vercel          |
| CNAME | `www` | `cname.vercel-dns.com`        | www → Vercel           |

> Vercel shows the exact apex A-record IP / CNAME under the project's
> **Domains** tab — use whatever Vercel tells you there; the apex value above
> is Vercel's standard but confirm it.

Wait for `api.sldtstayinn.com` to resolve to `VPS_IP` before doing the SSL
step (`dig api.sldtstayinn.com` or `nslookup`).

---

## 3. Deploy the API to the Hostinger VPS

SSH in as a sudo-capable user.

### 3a. Install Docker + nginx + certbot
```bash
# Docker (official convenience script)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER          # re-login after this for non-sudo docker

# nginx + certbot
sudo apt-get update
sudo apt-get install -y nginx certbot python3-certbot-nginx git
```

### 3b. Get the code onto the VPS
```bash
cd /opt
sudo git clone <YOUR_REPO_URL> hoteldesk
sudo chown -R $USER:$USER hoteldesk
cd hoteldesk
```

### 3c. Create the API env file on the VPS
`apps/api/.env.production` is git-ignored, so it is NOT in the clone. Copy it
from your machine, or create it on the VPS:
```bash
# from your local machine:
scp apps/api/.env.production  user@VPS_IP:/opt/hoteldesk/apps/api/.env.production
```
Or `nano apps/api/.env.production` on the VPS and paste the filled contents.
Lock it down:
```bash
chmod 600 apps/api/.env.production
```

### 3d. Build & start the API container
```bash
cd /opt/hoteldesk
docker compose -f deploy/docker-compose.prod.yml up -d --build
```
First build takes a few minutes (it installs Chromium + fonts). Check it:
```bash
docker compose -f deploy/docker-compose.prod.yml ps          # State should be "healthy"
docker compose -f deploy/docker-compose.prod.yml logs -f api # watch the boot log
curl -s http://127.0.0.1:3000/health                         # {"status":"ok",...}
```

### 3e. Apply database migrations
The Supabase DB needs the latest schema. Run the migration script once,
from inside the container (it has the script + `DATABASE_URL`):
```bash
docker compose -f deploy/docker-compose.prod.yml exec api \
  node apps/api/scripts/migrate.mjs
```
It prints which migrations applied. Safe to re-run — already-applied ones skip.

> Since production reuses the dev Supabase project, the schema is likely
> already up to date. The script will just report "already applied".

### 3f. nginx reverse proxy
```bash
sudo mkdir -p /var/www/certbot
sudo cp deploy/nginx/api.sldtstayinn.com.conf \
        /etc/nginx/sites-available/api.sldtstayinn.com.conf
sudo ln -s /etc/nginx/sites-available/api.sldtstayinn.com.conf \
           /etc/nginx/sites-enabled/
sudo nginx -t          # must say "syntax is ok" / "test is successful"
sudo systemctl reload nginx
```

### 3g. HTTPS via Let's Encrypt
With DNS for `api.sldtstayinn.com` already pointing at the VPS:
```bash
sudo certbot --nginx -d api.sldtstayinn.com
```
Certbot fills the `ssl_certificate*` lines into the nginx config and reloads.
Renewal is automatic (a systemd timer). Verify:
```bash
curl -s https://api.sldtstayinn.com/health    # {"status":"ok",...} over HTTPS
```

### 3h. Firewall (if using ufw)
```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'    # opens 80 + 443
sudo ufw enable
```
Port 3000 is **not** opened — the container binds to `127.0.0.1` only, nginx
is the public door.

---

## 4. Deploy the web to Vercel

### 4a. Import the project
- Vercel → **Add New… → Project** → pick the GitHub repo.
- **Root Directory:** leave as the repo root (`.`). The build is a monorepo
  build — do **not** set it to `apps/web`.
- Framework / build / output are read from the repo's `vercel.json`
  (`build:web`, output `apps/web/dist`). Don't override them.

### 4b. Environment variables (Production scope)
Vercel builds in its own environment and ignores the local
`apps/web/.env.production`. Add these in **Project → Settings → Environment
Variables**, scope **Production**:

| Key                       | Value                                          |
|---------------------------|------------------------------------------------|
| `VITE_API_URL`            | `https://api.sldtstayinn.com/api/v1`           |
| `VITE_SUPABASE_URL`       | `https://wujndnaasfyzxpmaatcj.supabase.co`     |
| `VITE_SUPABASE_ANON_KEY`  | (the anon key from `apps/web/.env.production`)  |
| `VITE_UI_PREVIEW`         | `false`                                        |

### 4c. Custom domain
- Project → **Domains** → add `sldtstayinn.com` and `www.sldtstayinn.com`.
- Vercel verifies via the DNS records from step 2.
- Set `www` to redirect to the apex (or vice-versa) — your call.

### 4d. Deploy
Push to the production branch (or hit **Deploy**). Vercel runs the build and
serves the SPA. Every later push auto-deploys.

---

## 5. Point Supabase Auth at the production domain

In the Supabase dashboard → **Authentication → URL Configuration**:
- **Site URL:** `https://sldtstayinn.com`
- **Redirect URLs:** add `https://sldtstayinn.com/**` (and `www` if used).

Without this, sign-in / password-reset links resolve to localhost.

---

## 6. Smoke test

1. `https://sldtstayinn.com` loads, no console errors.
2. Log in as the admin (`sldt@sldtstayinn.com`).
3. Dashboard loads data — confirms web → API → Supabase + Upstash all wired.
4. Open a reservation → **Preview Invoice** — confirms Puppeteer/Chromium
   renders a PDF inside the container.
5. `curl -s https://api.sldtstayinn.com/health` → `{"status":"ok"}`.

---

## 7. Updating after a code change

**Web:** `git push` → Vercel auto-builds and deploys. Nothing else.

**API (on the VPS):**
```bash
cd /opt/hoteldesk
git pull
docker compose -f deploy/docker-compose.prod.yml up -d --build
# if the change includes a new migration:
docker compose -f deploy/docker-compose.prod.yml exec api \
  node apps/api/scripts/migrate.mjs
```
`up -d --build` rebuilds the image and replaces the running container with
near-zero downtime. The old container is stopped only after the new one is up.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Web loads but every API call fails (CORS) | `FRONTEND_URL` in `apps/api/.env.production` must exactly equal `https://sldtstayinn.com` (no trailing slash, right scheme). Restart the container after editing. |
| Container shows `unhealthy` | `docker compose -f deploy/docker-compose.prod.yml logs api` — usually a bad env value (DB unreachable, malformed `ENCRYPTION_KEY`). The env schema prints exactly which key failed. |
| `502 Bad Gateway` from nginx | API container isn't up, or not on `127.0.0.1:3000`. Check `docker ps` and `curl http://127.0.0.1:3000/health` on the VPS. |
| PDF preview hangs / errors | Chromium issue in the container — `docker compose ... logs api` around the request. The image bundles Chromium + fonts; a clean rebuild usually fixes a corrupted layer. |
| Login redirects to localhost | Supabase Auth URL Configuration not updated — see step 5. |
| certbot fails | DNS for `api.sldtstayinn.com` not yet pointing at `VPS_IP`, or port 80 blocked by the firewall. |
