# 💪 Jaini Fitness Center — Gym Management System

A complete gym-management web app — members, plans, payments (online + offline), membership
expiry, attendance check-in, trainers, blog, and email notifications.

**Author:** Sanjay Prajapati

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

## Project Structure

```
~/gym-app/
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
├── .env                   # secrets — never committed
├── docker-compose.yml
├── start.sh / stop.sh / status.sh / logs.sh
└── .github/workflows/deploy.yml   # CI/CD: push → auto deploy on this machine
```

---

## Quick Start

```bash
cd ~/gym-app
./start.sh          # build + start everything (first run 3–5 min)
```

Then open in a browser:

| URL                              | What it is                    |
|----------------------------------|-------------------------------|
| `http://localhost:2311`          | Main app (backup port)        |
| `http://jainifitness.test`       | Member/admin site (dev alias) |
| `http://admin.jainifitness.test` | Admin login (dev alias)       |

The dev aliases `.jainifitness.test` need a `hosts` entry (`/etc/hosts` on Linux):
`127.0.0.1 jainifitness.test admin.jainifitness.test`

### First login (admin)

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

### Raw Docker Compose (same as scripts)

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
sudo docker compose exec db psql -U gym -d gymdb     # psql shell
sudo docker compose exec db pg_dump -U gym gymdb ~/backup   # (redirect to a file)
```

Schema (auto-applied on first start): `~/gym-app/database/schema.sql`

### Frontend local build (optional, without Docker)

```bash
cd ~/gym-app/frontend
npm install
npm run build      # output in frontend/dist/
```

---

## Environment Variables (`~/gym-app/.env`)

Not committed. Required keys:

| Variable            | Used for                          |
|---------------------|-----------------------------------|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | database |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`             | online payments (test mode: `rzp_test_...`) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | email notifications |

`docker-compose.yml` also sets `JWT_SECRET` and `APP_URL` internally.

---

## Features

- **Dashboard** — total members, active, expiring in 7 days, expired, this month's income,
  today's check-ins
- **Members** — add / edit / delete, search, assign plan & trainer, set expiry
- **Payments** — record payments; **"plan renew"** checkbox extends the member's expiry
- **Plans** — Membership plans (Monthly / Quarterly / Yearly pre-created)
- **Trainers** — trainer list
- **Notifications** — expiry alert email configuration
- **Members self-service** — register, login, view own plan/payments, check-in, upload photo
- **Online payments** — Razorpay checkout for new inquiries (test mode)
- **Public site** — hero slider, plans, trainers, blog, membership inquiry form

---

## CI/CD — Push → Auto Deploy

`~/gym-app/.github/workflows/deploy.yml` runs on every push to `main`.
A GitHub Actions **self-hosted runner** runs on this machine and does:

1. `git pull` (latest code into `~/gym-app`)
2. `docker compose up -d --build` (rebuild + restart)
3. Health check `curl http://localhost:2311/api/health` (non-fatal warning if it fails)

One-time setup (done on this machine):

```bash
sudo usermod -aG docker sanjayprajapati    # let the app user run docker without sudo
# then restart WSL (wsl --shutdown from Windows) so the group applies
~/actions-runner/run.sh &                  # runner process (start in the user session)
```

---

## Deploying to the Cloud (later)

No IPs are hard-coded — everything is inside Docker. For Kubernetes / Terraform on AWS/Azure:
point `frontend/nginx.conf`'s backend upstream at the backend service and set the database
URL in `.env`.

---

## Notes

- `photos/` and `.env` are git-ignored.
- Frontend is built **inside** the Docker image, so code changes need a container rebuild
  (done automatically by CI/CD, or manually with `sudo docker compose up -d --build`).
- Backend API base is `/api` (Nginx proxies `admin.jainifitness.test/api` and main site
  `/api` to the backend service on port 3000).