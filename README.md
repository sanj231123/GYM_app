# 💪 GymFit Platform — Multi-Tenant Gym Management System

A complete, sellable **gym-management SaaS** — every gym gets its own private website and
dashboard: members, plans, payments (online + offline), membership expiry alerts,
attendance check-in, trainers, blog, and email/WhatsApp notifications. Gyms self-signup
with a free trial; the platform owner manages them from one panel.

A fresh install seeds **Jaini Fitness Center** as the first gym (the original tenant).

**Author:** Sanjay Prajapati ([GitHub: sanj231123](https://github.com/sanj231123) ·
[Docker Hub: sanj231123](https://hub.docker.com/u/sanj231123))

> **Anyone can run this project** by following this README from top to bottom — no prior
> knowledge of the codebase is needed.

---

## Tech Stack

| Layer      | Technology                              |
|------------|------------------------------------------|
| Frontend   | React 18 + Vite, served by Nginx         |
| Backend    | Node.js (Express) + JWT auth             |
| Database   | PostgreSQL 16 (Docker volume `dbdata`)   |
| Payments   | Razorpay (test mode)                     |
| Email      | Nodemailer (SMTP)                        |
| Runtime    | Docker Compose                           |
| CI/CD      | GitHub Actions + self-hosted runner      |

---

## Prerequisites (install once)

| Tool | Minimum version | Why |
|------|-----------------|-----|
| Docker + Docker Compose (v2) | Docker 24+ | runs everything |
| Git | 2.x | clone / pull the code |
| Node.js 20+ | — | only if building the frontend outside Docker |

Check them:

```bash
docker --version && docker compose version
git --version
node --version        # optional
```

> On **Windows**, use WSL2 (Ubuntu) — everything below is run inside WSL.
> Add your user to the docker group so `sudo` is not needed every time:
> `sudo usermod -aG docker $USER` → then restart WSL (`wsl --shutdown` from Windows).

---

## Project Structure

```
gym-app/
├── backend/
│   ├── server.js          # all API routes, JWT, Razorpay, SMTP
│   ├── Dockerfile
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.jsx        # whole UI (public site + login + admin + member)
│   │   ├── api.js         # fetch helper, token (cookie + localStorage)
│   │   └── styles.css
│   ├── public/            # images used by the UI
│   ├── nginx.conf
│   └── Dockerfile
├── database/
│   └── schema.sql         # tables + default plans/admin (auto-applied on first start)
├── photos/                # runtime uploads (member photos / check-ins) — not in git
├── .env                   # secrets — never committed (create from .env.example)
├── docker-compose.yml
├── start.sh / stop.sh / status.sh / logs.sh
└── .github/workflows/deploy.yml   # CI/CD: push → auto deploy
```

---

## Quick Start (3 steps)

### 1. Clone and enter the project

```bash
git clone https://github.com/sanj231123/GYM_app.git ~/gym-app
cd ~/gym-app
```

### 2. Create the `.env` file

```bash
cp .env.example .env
nano .env     # or: vim .env / gedit .env
```

Minimum required values:

```bash
POSTGRES_USER=gym
POSTGRES_PASSWORD=change_me_strong        # 8+ characters, the app refuses to start with a weak one
POSTGRES_DB=gymdb
JWT_SECRET=paste_a_long_random_string_here  # 32+ random characters (required)

# First admin account — created automatically once, when no admin exists
BOOTSTRAP_ADMIN_EMAIL=you@example.com
BOOTSTRAP_ADMIN_PASSWORD=your_strong_password   # 8+ characters
```

Tip — generate a strong `JWT_SECRET` with:
`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

Optional (fill only if you want those features online):

```bash
RAZORPAY_KEY_ID=rzp_test_xxxx      # online payments (get keys from dashboard.razorpay.com)
RAZORPAY_KEY_SECRET=xxxx
SMTP_HOST=smtp.gmail.com           # email alerts (use a Gmail app-password)
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=xxxx
SMTP_FROM=you@gmail.com
WHATSAPP_TOKEN=xxxx
WHATSAPP_PHONE_ID=xxxx
APP_URL=http://localhost:2311      # external link used in messages
```

> The app **starts fine without** Razorpay/SMTP/WhatsApp keys — those features
> simply stay in "not configured" mode.

### 3. Build and start

```bash
./start.sh          # = sudo docker compose up -d --build (first run: 3–5 min)
```

Then verify:

```bash
./status.sh         # db / backend / web should all be Up
curl http://localhost:2311/api/health
```

Open in a browser: **http://localhost:2311**

---

## First Login (admin)

| URL                        | What it is                    |
|----------------------------|-------------------------------|
| `http://localhost:2311`    | Main app (admin and members)  |

The app decides between the admin panel and the member dashboard from the
logged-in user's role — there are no separate admin URLs anymore.

Admin credentials come from the `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`
values you set in `.env` (created automatically on first start until you log in).
They no longer exist, since seeded/default passwords are a security risk.

---

## Command Reference

### Helper scripts (all from `~/gym-app/`)

```bash
./start.sh            # build (if needed) and start all three services
./stop.sh             # stop everything (data is kept in the docker volume)
./status.sh           # what is running: db / backend / web
./logs.sh backend     # tail backend logs
./logs.sh web         # tail nginx logs
./logs.sh db          # tail postgres logs
```

### Raw Docker Compose (same thing, more control)

```bash
sudo docker compose up -d --build     # start / rebuild after code changes
sudo docker compose down              # stop
sudo docker compose ps                # status
sudo docker compose logs -f backend   # backend logs
sudo docker compose logs -f web       # frontend (nginx) logs
sudo docker compose restart backend   # restart one service
```

### Database access

```bash
sudo docker compose exec db psql -U gym -d gymdb     # psql shell (in the terminal)
sudo docker compose exec db pg_dump -U gym -d gymdb > ~/backup.sql    # backup
```

Schema (auto-applied on first start): `database/schema.sql`

#### Restoring a backup (verified procedure)

```bash
# 1. make the target database (a fresh container, or an existing one)
sudo docker run -d --name gymdb-restore -e POSTGRES_PASSWORD=choose-strong postgres:16-alpine
sudo docker exec gymdb-restore createdb -U postgres restoretest
# the dump runs "OWNER TO gym" — create that role first
sudo docker exec gymdb-restore psql -U postgres -d restoretest -c "CREATE ROLE gym;"

# 2. restore (ON_ERROR_STOP makes any problem loud instead of silent)
sudo docker exec -i gymdb-restore psql -U postgres -v ON_ERROR_STOP=1 -d restoretest -q < ~/backup.sql

# 3. check it matches the live data (same row counts)
sudo docker exec gymdb-restore psql -U postgres -d restoretest -t \
  -c "SELECT 'gyms=' || count(*) FROM public.gyms;" \
  -c "SELECT 'members=' || count(*) FROM public.users WHERE role='member';"

# 4. throw the test container away
sudo docker rm -f gymdb-restore
```

This restore path was tested — a dump from the live database restored with the
same row counts in a throwaway container.

#### Sales demo gym

For a walkthrough with a new customer (sample members, plans, payments, check-ins):

```bash
sudo docker compose exec backend node scripts/seed-demo-gym.js
# → Website: /g/demo-fit · Admin login: demo@demo.example (prints the password)
```

Delete it afterwards from the platform admin panel (its data cascades away).

### Frontend local build (optional, without Docker)

```bash
cd ~/gym-app/frontend
npm install
npm run build      # output in frontend/dist/
```

---

## Environment Variables (`~/gym-app/.env`)

Not committed to git — always create it from `.env.example`.

| Variable | Used for |
|----------|----------|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | database (password 8+ chars, required strong) |
| `JWT_SECRET` | login-token signing (32+ chars, required strong) |
| `NODE_ENV` | `production` on a live server (adds the Secure cookie flag) |
| `FRONTEND_ORIGINS` | allowed browser origins (comma-separated; empty = `APP_URL` only) |
| `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` | first admin account (created once) |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | online payments (test mode: `rzp_test_...`) |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay webhook signature check (dashboard → Webhooks) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | email notifications |
| `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_ID` | WhatsApp confirmations |
| `APP_URL` | the public address put inside messages (e.g. password-reset links) |
| `PLATFORM_DOMAIN` | the platform's own domain (e.g. `example.com`) — enables subdomains and the landing page |
| `TRIAL_DAYS` | free-trial length for new gyms (default `14`) |
| `PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD` | platform owner account (created once) |
| `CADDY_EMAIL` | email for HTTPS certificates in the production compose |

---

## Multi-Tenant SaaS Mode (run many gyms from one deployment)

This app is a **platform**: every gym that signs up gets its own private site and
dashboard, with its data fully separated from every other gym.

- **New gym signup** — open `/register` on the platform domain → "Register your gym"
  (gym name, web address/slug, owner login). The owner gets a **14-day free trial**
  (`TRIAL_DAYS` in `.env`) and lands directly in `/g/<slug>`.
- **The gym's web address** — `https://<slug>.<PLATFORM_DOMAIN>` (set up automatically
  by Caddy with on-demand TLS) or the path fallback `https://<domain>/g/<slug>`.
- **Platform landing page** — `/register` markets the platform and hosts the signup form.
- **Platform owner panel** — log in with `PLATFORM_ADMIN_EMAIL` on the **bare platform
  domain** (no `/g/...`): list all gyms with member and revenue counts, **suspend /
  activate** a gym, and **Mark paid** (enter months → extends `paid_until`).
- **Trial / subscription behaviour** — once the trial or paid period ends, the gym's
  site and dashboards still **read** fine but admin **writes** are blocked with a
  clear "Subscription required" screen; the gym owner sees a renewal banner.
- **Per-gym branding** — the gym admin opens **Settings** (admin panel) and sets the
  logo, gym name, brand color, address, phone, timings, map link and its **own
  Razorpay keys** (stored masked; falls back to the platform's shared key).
- **Demo gym for sales demos** — `docker compose exec backend node scripts/seed-demo-gym.js`
  creates `demo-fit` with sample data and prints the demo login.
- **HTTPS + backups** — `docker-compose.prod.yml` runs Caddy (HTTPS for the platform
  domain and every gym subdomain) and a nightly database backup into `./backups`
  (daily dump, keeps the last 14).

Tenant isolation is tested on every deploy — the CI **"Multi-tenant isolation
check"** step proves one gym can never read or write another gym's data.

---

## Features

- **Dashboard** — total members, active, expiring in 7 days, expired, this month's income,
  today's check-ins
- **Members** — add / edit / delete, search, assign plan & trainer, set expiry
- **Payments** — record payments; **"plan renew"** checkbox extends the member's expiry
- **Plans** — membership plans (Monthly / Quarterly / Yearly pre-created)
- **Trainers** — trainer list
- **Notifications** — expiry alert email configuration
- **Members self-service** — register, login, view own plan/payments, check-in, upload photo
- **Online payments** — Razorpay checkout for new inquiries (test mode)
- **Public site** — hero slider, plans, trainers, blog, membership inquiry form
- **Multi-tenant SaaS** — per-gym branding, data isolation, trials, platform admin panel (see above)
- **Custom message templates** — per-gym welcome / payment / inquiry texts with `{{placeholders}}` in Settings
- **Platform fee automation** — Razorpay subscription per gym; charges extend the paid period automatically
- **Analytics** (admin) — revenue per month, new members per month, daily check-ins (14 days),
  members per plan — inline SVG charts with hover tooltips
- **PWA** — installable on phone/desktop; works offline for the cached app shell (`manifest.webmanifest` +
  `sw.js` service worker; `/api` is always fetched live)

---

## CI/CD — Push → Auto Deploy

`.github/workflows/deploy.yml` runs on every push to `main`. A GitHub Actions
**self-hosted runner** runs on the target machine and does:

1. `git pull --ff-only origin main`
2. Backup the database (`pg_dump` saved into `backups/`, last 15 kept)
3. `docker compose up -d --build` (rebuild + restart)
4. Health check: `curl http://localhost:2311/api/health` (warning only if it fails)

### One-time runner setup (on the machine that should auto-deploy)

```bash
# 1. Download the runner (GitHub rejects older versions with a 404 — use the latest)
mkdir -p ~/actions-runner && cd ~/actions-runner
curl -o runner.tar.gz -L --retry 10 --retry-all-errors \
  https://github.com/actions/runner/releases/latest/download/actions-runner-linux-x64-2.338.0.tar.gz
tar -xzf runner.tar.gz

# 2. Create a registration token in GitHub:
#    Repo → Settings → Actions → Runners → New self-hosted runner → shows the same commands
#    Copy the --token value from that page (expires in ~1 hour), then run:
./config.sh --url https://github.com/sanj231123/GYM_app --token <TOKEN>

# 3. Start the runner (keeps listening for jobs):
./run.sh            # foreground; or: nohup ./run.sh > runner.log 2>&1 &

# 4. Docker permission for the app user:
sudo usermod -aG docker $USER   # then restart WSL: wsl --shutdown (from Windows)
```

Now every `git push origin main` deploys automatically.

---

## Deploying to a VPS (step by step)

Works on a fresh Ubuntu 22.04/24.04 server (1 GB RAM is enough). The installer
does not need a domain — HTTPS is switched on later, when you have one.

```bash
# on the VPS (SSH in as root):
# 1. get the code (token = GitHub → Settings → Developer settings → Personal
#    access tokens; it needs read access to this repo)
git clone <this-repo-url> && cd GYM_app
# 2. run the installer
GIT_TOKEN=ghp_xxxxx bash deploy/install-vps.sh
```

(The token is only used once by the installer to clone the private repo —
revoke it after the install if you don't want it around.)

The script installs Docker, clones the repo into `/opt/gym-app`, generates strong
secrets (`JWT_SECRET`, `POSTGRES_PASSWORD`, admin accounts) into `.env`, prints
them once, and starts the platform on `http://<server-ip>`.

**When the domain arrives** (point its `A` record at the VPS IP first):
edit `/opt/gym-app/.env` — set `PLATFORM_DOMAIN`, `CADDY_EMAIL`,
`FRONTEND_ORIGINS=https://yourdomain.com,https://*.yourdomain.com`,
`APP_URL=https://yourdomain.com` — then:

```bash
cd /opt/gym-app
docker compose down
docker compose -f docker-compose.prod.yml up -d --build
```

That switches to HTTPS (`Caddy` with on-demand TLS, including
`<slug>.yourdomain.com` for every gym) and turns on the nightly backup service.
Afterwards install the GitHub self-hosted runner on the VPS (see the CI/CD
section) so future `git push`es deploy automatically.

For Kubernetes / Terraform on AWS/Azure instead: point `frontend/nginx.conf`'s
backend upstream at the backend service and set the database URL in `.env`.

---

## Platform fee (auto collection)

One month of platform access per gym can be collected automatically instead of
the manual **Mark paid** button:

1. In the Razorpay dashboard of the **platform's own account**, create a
   recurring **Subscription Plan** (e.g. `₹499 / month`) and copy its `plan_…` id.
2. Put it in `.env` as `PLATFORM_RZP_PLAN_ID=plan_…` (plus the platform's
   `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`) and in the Razorpay dashboard add
   a webhook (`<your api url>/api/webhooks/razorpay`, event
   `subscription.charged` + `subscription.cancelled`) with the same secret as
   `RAZORPAY_WEBHOOK_SECRET`.
3. In the platform admin panel use **Auto-fee** on a gym — Razorpay emails the
   gym owner a payment link. Every successful charge extends that gym's
   `paid_until` by one month automatically (verified webhook flow); a cancelled
   subscription is recorded next to the gym.

The manual workflows (**Mark paid**, suspend/activate) keep working as before.

---

## Troubleshooting

| Problem | Check / Fix |
|---------|-------------|
| Page doesn't open | `./status.sh` — is `web` Up? Is port `2311` free? |
| Changes not visible | hard refresh in browser (`Ctrl + Shift + R`); frontend is built inside the image — `sudo docker compose up -d --build` |
| Backend errors | `./logs.sh backend` |
| DB connection error | `./logs.sh db`; check `.env` DB values |
| Forgot admin password | reset it directly in the DB (`admins` table) or recreate the volume |
| `permission denied ... docker.sock` | run with `sudo`, or add user to the docker group (see Prerequisites) |

---

## Notes

- `photos/` and `.env` are git-ignored.
- Join-page slider photos (join-slide-*.jpg) come from [Pexels](https://www.pexels.com/license/) (free license, no attribution required).
- Frontend is built **inside** the Docker image, so code changes need a container rebuild
  (done automatically by CI/CD, or manually with `sudo docker compose up -d --build`).
- Backend API base is `/api` (Nginx proxies `admin.jainifitness.test/api` and main-site
  `/api` to the backend service on port 3000).

---

**Author:** Sanjay Prajapati — built as a sellable gym-management product (2026).