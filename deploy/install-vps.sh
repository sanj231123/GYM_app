#!/usr/bin/env bash
# GymFit platform — one-shot VPS installer.
# For a fresh Ubuntu 22.04/24.04 server. Run as root:
#
#   GIT_TOKEN=ghp_xxx bash install-vps.sh
#
# (The token needs read access to the private repo — create one on GitHub:
#  Settings → Developer settings → Personal access tokens → generate, copy,
#  and revoke it after the install if you don't want it around.)
#
# What it does: installs Docker, clones the repo to /opt/gym-app, generates
# strong secrets in .env, and starts the platform on plain HTTP (port 80).
# A domain is NOT required — when you have it, follow the instructions this
# script prints at the end (switch to docker-compose.prod.yml for HTTPS).

set -euo pipefail

if [ "$EUID" -ne 0 ]; then echo "Please run as root (sudo -i)"; exit 1; fi
REPO_URL="${REPO_URL:-https://github.com/sanj231123/GYM_app.git}"
DEST=/opt/gym-app

say() { echo; echo "==> $1"; }

say "1/5 — installing Docker"
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ca-certificates curl git openssl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
systemctl enable --now docker

say "2/5 — getting the code"
if [ ! -d "$DEST/.git" ]; then
  if [ -z "${GIT_TOKEN:-}" ]; then
    echo "Enter a GitHub token with read access to the repo (input hidden):"
    read -rs GIT_TOKEN
  fi
  git clone "https://x-access-token:${GIT_TOKEN}@${REPO_URL#https://}" "$DEST"
else
  echo "repo already present, pulling latest"
  git -C "$DEST" pull --ff-only || true
fi
cd "$DEST"

say "3/5 — writing .env (strong secrets are generated for you)"
if [ ! -f .env ]; then cp .env.example .env; fi
gen() { openssl rand -hex 24; }
set_var() { grep -qE "^$1=" .env && sed -i "s|^$1=.*|$1=$2|" .env || echo "$1=$2" >> .env; }
if ! grep -qE "^JWT_SECRET=.{32,}" .env; then set_var JWT_SECRET "$(gen)"; echo "  generated JWT_SECRET"; fi
if ! grep -qE "^POSTGRES_PASSWORD=.{8,}" .env || grep -qiE "^POSTGRES_PASSWORD=(change|password)" .env; then
  set_var POSTGRES_PASSWORD "$(openssl rand -hex 12)"; echo "  generated POSTGRES_PASSWORD"
fi
set_var NODE_ENV production
if ! grep -qE "^BOOTSTRAP_ADMIN_EMAIL=.+" .env; then set_var BOOTSTRAP_ADMIN_EMAIL "$(openssl rand -hex 8)@admin.local"; fi
if ! grep -qE "^BOOTSTRAP_ADMIN_PASSWORD=.{8,}" .env; then set_var BOOTSTRAP_ADMIN_PASSWORD "$(gen | head -c 16)"; fi
if ! grep -qE "^PLATFORM_ADMIN_EMAIL=.+" .env; then set_var PLATFORM_ADMIN_EMAIL "$(openssl rand -hex 8)@admin.local"; fi
if ! grep -qE "^PLATFORM_ADMIN_PASSWORD=.{8,}" .env; then set_var PLATFORM_ADMIN_PASSWORD "$(gen | head -c 16)"; fi

say "4/5 — starting the platform (HTTP only — no domain needed yet)"
docker compose up -d --build

say "5/5 — done. Your details (copy them somewhere safe — shown once):"
grep -E "^(BOOTSTRAP_ADMIN_EMAIL|BOOTSTRAP_ADMIN_PASSWORD|PLATFORM_ADMIN_EMAIL|PLATFORM_ADMIN_PASSWORD)=" .env | sed 's/^/    /'
SERVER_IP=$(curl -fs https://api.ipify.org 2>/dev/null || echo "<server-ip>")
echo
echo "The site should be live at:  http://$SERVER_IP  (HTTP for now)"
echo
echo "----------------------------------------------------------------"
echo "After you get a domain (with its A record pointing to $SERVER_IP):"
echo
echo "1. edit /opt/gym-app/.env :"
echo "     PLATFORM_DOMAIN=yourdomain.com"
echo "     CADDY_EMAIL=your@email.com"
echo "     FRONTEND_ORIGINS=https://yourdomain.com,https://*.yourdomain.com"
echo "     APP_URL=https://yourdomain.com"
echo
echo "2. switch off the HTTP stack and start the HTTPS one:"
echo "     cd /opt/gym-app"
echo "     docker compose down"
echo "     docker compose -f docker-compose.prod.yml up -d --build"
echo
echo "   This switches the platform to HTTPS and enables <slug>.yourdomain.com"
echo "   for every gym automatically, via Caddy on-demand TLS."
echo "----------------------------------------------------------------"
echo
echo "Tip: to make 'git push' deploy automatically after this, install a GitHub"
echo "self-hosted runner here — README section 'CI/CD — Push → Auto Deploy'."