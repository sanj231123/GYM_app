#!/usr/bin/env bash
# ============================================================
# GYM_app one-shot setup — clone ke baad bas yeh chalao:
#   git clone https://github.com/sanj231123/GYM_app
#   cd GYM_app && bash setup.sh
# Ant me browser me app khul jayegi (http://localhost:2311)
#
# Kya karta hai:
#   1. .env (agar na ho) — random JWT_SECRET + admin password
#   2. docker compose up --build  (pehli baar me 3-5 min)
#   3. Health check — backend jab tak up nahi hota wait karta hai
#   4. Browser me app khol deta hai (WSL pe Windows browser khulega)
#
# Zaroori: docker installed hona chahiye (Docker Desktop + WSL2
# integration ON, ya Linux me Docker Engine). Nahi hai to message
# dikhata hai, script khud install nahi karti.
# ============================================================
set -euo pipefail

cd "$(dirname "$0")"          # repo ke root me chale hamein
APP_URL="${APP_URL:-http://localhost:2311}"
OPEN_URL="${OPEN_URL:-http://localhost:2311}"

warn_box() {
  echo ""
  echo "⚠️  $1"
  echo ""
}

# ---------- 0. docker check ----------
DOCKER="docker"
if ! docker info >/dev/null 2>&1; then
  # docker group fresh session me hi milta hai (WSL quirk)
  if sg docker -c "docker info >/dev/null 2>&1"; then
    DOCKER="sg docker -c"
  else
    warn_box "Docker chal nahi raha. Pehle install karo: https://docs.docker.com/get-docker/
   - Windows: Docker Desktop → WSL2 integration me 'Ubuntu' enable karo
   - Linux:   curl -fsSL https://get.docker.com | sh
Phir yeh script dobara chalao: bash setup.sh"
    exit 1
  fi
fi
echo "✓ Docker theek hai"

# ---------- 1. purani install ka collision-check ----------
# Compose project ka naam hardcoded hai (jaini-fitness) — is machine pe pehle
# se install ho to ye script usi ke containers/volumes ko chhu lega. Suraksha!
if [ ! -f .env ] && [ -z "${COMPOSE_PROJECT_NAME:-}" ]; then
  if docker volume inspect jaini-fitness_dbdata >/dev/null 2>&1; then
    warn_box "Is machine pe pehle se GYM app ka data volume hai (jaini-fitness_dbdata), lekin is clone me .env nahi.
   - Isi machine ki asli install chalani hai → original folder me jao (wahan .env already hai), clone ka use nahi
   - Fresh sab kuch chahiye → pehle volume hatao:  docker volume rm jaini-fitness_dbdata
   (Dhyan: volume me saare members/payments ki data hoti hai — sochkar delete karna!)"
    exit 1
  fi
fi

# ---------- 2. .env (pehli baar) ----------
if [ ! -f .env ]; then
  JWT="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  ADMIN_PASS="$(head -c 8 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 10)"
  [ "${#ADMIN_PASS}" -lt 8 ] && ADMIN_PASS="A${ADMIN_PASS}Z7x"
  cat > .env <<EOF
POSTGRES_USER=gym
POSTGRES_PASSWORD=$(openssl rand -hex 16 2>/dev/null || echo gym-db-secret)
POSTGRES_DB=gymdb
JWT_SECRET=${JWT}
NODE_ENV=production
APP_URL=${APP_URL}
BOOTSTRAP_ADMIN_EMAIL=admin@gym.com
BOOTSTRAP_ADMIN_PASSWORD=${ADMIN_PASS}
TRIAL_DAYS=14
FRONTEND_ORIGINS=
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
WHATSAPP_TOKEN=
WHATSAPP_PHONE_ID=
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
PLATFORM_DOMAIN=
PLATFORM_ADMIN_EMAIL=
PLATFORM_ADMIN_PASSWORD=
CADDY_EMAIL=
EOF
  chmod 600 .env
  echo "✓ Naya .env banaya (600 perms, gitignored — GitHub pe kabhi nahi jayega)"
  echo ""
  echo "═══════════════════════════════════════════"
  echo " ADMIN LOGIN (yahi likh lo abhi!):"
  echo "   admin@gym.com / ${ADMIN_PASS}"
  echo "═══════════════════════════════════════════"
else
  echo "✓ .env pehle se hai (use hi rahne dete hain)"
fi

# ---------- 3. build + up ----------
echo "→ Containers build + start kar raha hoon (pehli baar me 3-5 min lagenge)…"
$DOCKER compose up -d --build 2>&1 | tail -3

# ---------- 4. health wait ----------
echo "→ Backend ka wait… "
for i in $(seq 1 60); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "${APP_URL}/api/health" || true)"
  if [ "$code" = "200" ]; then
    echo "✓ Backend 200 OK (try $i)"
    break
  fi
  sleep 2
  if [ "$i" = "60" ]; then
    warn_box "60 try me backend up nahi hua. Logs batao: $DOCKER compose logs backend --tail 50"
    exit 1
  fi
done

# ---------- 5. browser khol ----------
echo "→ Browser khol raha hoon…"
if grep -qi microsoft /proc/version 2>/dev/null; then
  explorer.exe "${OPEN_URL}" >/dev/null 2>&1 || true           # WSL → Windows browser
else
  xdg-open "${OPEN_URL}" >/dev/null 2>&1 || true || echo "Manually kholo: ${OPEN_URL}"
fi

echo ""
echo "=========================================================="
echo " 🏋️  GYM_app chal rahi hai:  ${OPEN_URL}"
echo "    Member signup/portal bhi wahin hai."
echo "    RAM chahiye to band: $DOCKER compose stop"
echo "    Wapas on:            $DOCKER compose start"
echo "=========================================================="