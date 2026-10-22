# 💪 Jaini Fitness Center — Gym Management System

A complete gym-management web application — members, plans, payments (online + offline),
membership expiry alerts, attendance check-in, trainers, blog, and email/SMS notifications.

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
POSTGRES_PASSWORD=change_me_strong
POSTGRES_DB=gymdb
JWT_SECRET=paste_a_long_random_string_here
```

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

| URL                              | What it is                    |
|----------------------------------|-------------------------------|
| `http://localhost:2311`          | Main app                      |
| `http://jainifitness.test`       | Member/admin site (dev alias) |
| `http://admin.jainifitness.test` | Admin login (dev alias)       |

The `.jainifitness.test` aliases need a hosts entry (`/etc/hosts` inside WSL/Linux):

```bash
sudo sh -c 'echo "127.0.0.1 jainifitness.test admin.jainifitness.test" >> /etc/hosts'
```

Admin credentials (created automatically by `database/schema.sql` on first start):

- Email: `admin@gym.com`
- Password: `admin123`

⚠️ **First task:** change the admin password using the **Password** button in the top bar.

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
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | database |
| `JWT_SECRET` | login-token signing (long random string) |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | online payments (test mode: `rzp_test_...`) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | email notifications |
| `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_ID` | WhatsApp confirmations |
| `APP_URL` | the public address put inside messages |

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

---

## CI/CD — Push → Auto Deploy

`.github/workflows/deploy.yml` runs on every push to `main`. A GitHub Actions
**self-hosted runner** runs on the target machine and does:

1. `git pull --ff-only origin main`
2. `docker compose up -d --build` (rebuild + restart)
3. Health check: `curl http://localhost:2311/api/health` (warning only if it fails)

### One-time runner setup (on the machine that should auto-deploy)

```bash
# 1. Download the runner (version pinned in repo)
mkdir -p ~/actions-runner && cd ~/actions-runner
curl -o actions-runner-linux-x64-2.328.0.tar.gz -L \
  https://github.com/actions/runner/releases/download/v2.328.0/actions-runner-linux-x64-2.328.0.tar.gz
tar -xzf actions-runner-linux-x64-2.328.0.tar.gz

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

## Deploying to the Cloud (later)

No IPs are hard-coded — everything is inside Docker. For Kubernetes / Terraform on
AWS/Azure: point `frontend/nginx.conf`'s backend upstream at the backend service and set
the database URL in `.env`.

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
- Frontend is built **inside** the Docker image, so code changes need a container rebuild
  (done automatically by CI/CD, or manually with `sudo docker compose up -d --build`).
- Backend API base is `/api` (Nginx proxies `admin.jainifitness.test/api` and main-site
  `/api` to the backend service on port 3000).

---

**Author:** Sanjay Prajapati — built as a sellable gym-management product (2026).